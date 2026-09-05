import { listRules, deleteRule } from "../memory/client.js";
import { getWalletByTelegramId, sendMainMenu } from "../lib/helpers.js";
import type { RiskRule, SibylEntity } from "../memory/schema.js";

const RULES_PER_PAGE = 5;

function sortRules(rules: SibylEntity<RiskRule>[]) {
  // Stable order is critical since callback_data references rules by
  // index, not by identity. Sorting by created_at keeps index N pointing
  // at the same rule across page loads, as long as nothing is inserted
  // out of order.
  return [...rules].sort(
    (a, b) =>
      new Date(a.body.created_at!).getTime() -
      new Date(b.body!.created_at!).getTime(),
  );
}

function formatRuleText(rule: RiskRule, index: number): string {
  let text = `🛡️ <b>Rule ${index + 1}</b>\n`;

  switch (rule.rule_type) {
    case "max_exposure_pct":
      text += `Maximum exposure: <b>${rule.threshold}%</b>`;
      break;

    case "max_position_size":
      text += `Maximum position size: <b>$${rule.threshold}</b>`;
      break;

    case "cooldown_after_loss":
      text += `Cooldown after loss: <b>${rule.threshold} hours</b>`;
      break;

    case "avoid_category":
      text += `Avoid category: <b>${rule.applies_to}</b>`;
      break;

    default:
      text += `Rule type: <b>${rule.rule_type}</b>\n`;
      text += `Threshold: <b>${rule.threshold} ${rule.unit}</b>`;
  }

  if (rule.rule_type !== "avoid_category") {
    text += `\nApplies to: <b>${
      rule.applies_to === "*" ? "All Assets" : rule.applies_to
    }</b>`;
  }

  if (rule.notes) {
    text += `\nWhy: <i>${rule.notes}</i>`;
  }

  return text;
}

async function renderRulesPage(
  ctx: any,
  rules: SibylEntity<RiskRule>[],
  page: number,
) {
  const totalPages = Math.max(1, Math.ceil(rules.length / RULES_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * RULES_PER_PAGE;
  const pageRules = rules.slice(start, start + RULES_PER_PAGE);

  let message = `📜 <b>Your Risk Rules</b> (page ${safePage + 1}/${totalPages})\n\n`;
  const ruleButtons: any[] = [];

  pageRules.forEach((entity, i) => {
    const index = start + i; // index into the FULL sorted list
    message += formatRuleText(entity.body, index) + `\n\n`;

    ruleButtons.push([
  { text: `✏️ Edit ${index + 1}`, callback_data: `edit_rule:${index}:${safePage}` },
  { text: `🗑️ Delete`, callback_data: `delete_rule:${index}:${safePage}` },
]);
  });

  message +=
    `━━━━━━━━━━━━━━━━━━\n` +
    `🧠 <b>Ghost checks these rules before evaluating your trades.</b>`;

  const navRow = [];
  if (safePage > 0) {
    navRow.push({ text: "⬅️ Prev", callback_data: `rules_page:${safePage - 1}` });
  }
  if (safePage < totalPages - 1) {
    navRow.push({ text: "Next ➡️", callback_data: `rules_page:${safePage + 1}` });
  }
  if (navRow.length) ruleButtons.push(navRow);

  ruleButtons.push([{ text: "📜 Add Rule", callback_data: "set_rule" }]);
  ruleButtons.push([{ text: "🔙 Back", callback_data: "rules_list_back" }]);

  const payload = {
    parse_mode: "HTML" as const,
    reply_markup: { inline_keyboard: ruleButtons },
  };


  if (ctx.updateType === "callback_query" && ctx.callbackQuery.message) {
    await ctx.editMessageText(message, payload);
  } else {
    await ctx.reply(message, payload);
  }
}

async function loadSortedRules(
  ctx: any,
  walletAddress: string,
): Promise<SibylEntity<RiskRule>[] | null> {
  const result = await listRules(walletAddress);

  if (!result.ok) {
    await ctx.reply(
      `❌ <b>Error loading your rules</b>\n\n${result.error || "Unknown error"}`,
      { parse_mode: "HTML" },
    );
    return null;
  }

  return sortRules((result.entities || []) as SibylEntity<RiskRule>[]);
}

export function registerRuleListHandler(bot: any) {
  bot.action("view_rules", async (ctx: any) => {
    try {
      await ctx.answerCbQuery();

      const user = await getWalletByTelegramId(ctx.from!.id);

      if (!user) {
        await ctx.reply(
          "👻 You don't have a Ghost Wallet yet.\n\nUse /start to create or import one.",
        );
        return;
      }

      const rules = await loadSortedRules(ctx, user.wallet_address);
      if (rules === null) return;

      if (rules.length === 0) {
        await ctx.reply(
          `📜 <b>Your Risk Rules</b>\n\n` +
            `You haven't created any risk rules yet.\n\n` +
            `Ghost uses your rules to protect you from decisions that go against your own trading limits.`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📜 Set a Risk Rule", callback_data: "set_rule" }],
                [{ text: "🔙 Back", callback_data: "rules_list_back" }],
              ],
            },
          },
        );
        return;
      }

      await renderRulesPage(ctx, rules, 0);
    } catch (error) {
      console.error("Failed to load rules:", error);
      await ctx.reply(
        "❌ Something went wrong while loading your risk rules. Please try again.",
      );
    }
  });

  bot.action(/^rules_page:(\d+)$/, async (ctx: any) => {
    try {
      await ctx.answerCbQuery();
      const page = parseInt(ctx.match[1], 10);

      const user = await getWalletByTelegramId(ctx.from!.id);
      if (!user) return;

      const rules = await loadSortedRules(ctx, user.wallet_address);
      if (rules === null) return;

      await renderRulesPage(ctx, rules, page);
    } catch (error) {
      console.error("Failed to paginate rules:", error);
      await ctx.reply("❌ Something went wrong while loading that page.");
    }
  });

  // Step 1: show a confirmation prompt, don't delete yet.
  bot.action(/^delete_rule:(\d+):(\d+)$/, async (ctx: any) => {
    try {
      await ctx.answerCbQuery();
      const index = parseInt(ctx.match[1], 10);
      const page = parseInt(ctx.match[2], 10);

      const user = await getWalletByTelegramId(ctx.from!.id);
      if (!user) return;

      const rules = await loadSortedRules(ctx, user.wallet_address);
      if (rules === null) return;

      const target = rules[index];

      if (!target) {
        await ctx.editMessageText(
          "⚠️ That rule no longer exists — the list may have changed. Reopen your rules to see the current list.",
        );
        return;
      }

      const confirmText =
        `⚠️ <b>Delete this rule?</b>\n\n` +
        formatRuleText(target.body, index) +
        `\n\nThis can't be undone.`;

      await ctx.editMessageText(confirmText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, delete", callback_data: `confirm_delete:${index}:${page}` },
              { text: "❌ Cancel", callback_data: `cancel_delete:${page}` },
            ],
          ],
        },
      });
    } catch (error) {
      console.error("Failed to show delete confirmation:", error);
      await ctx.reply("❌ Something went wrong. Please try again.");
    }
  });

  // Step 2: actually delete, then re-render the list.
  bot.action(/^confirm_delete:(\d+):(\d+)$/, async (ctx: any) => {
    try {
      await ctx.answerCbQuery();
      const index = parseInt(ctx.match[1], 10);
      const page = parseInt(ctx.match[2], 10);

      const user = await getWalletByTelegramId(ctx.from!.id);
      if (!user) return;

      const rules = await loadSortedRules(ctx, user.wallet_address);
      if (rules === null) return;

      const target = rules[index];

      if (!target) {
        await ctx.editMessageText(
          "⚠️ That rule no longer exists — it may have already been deleted.",
        );
        return;
      }

      const rule = target.body;
      const result = await deleteRule(user.wallet_address, {
        rule_type: rule.rule_type,
        applies_to: rule.applies_to,
      });

      if (!result.ok) {
        await ctx.editMessageText(
          `❌ Couldn't delete that rule.\n\n${result.error || "Unknown error"}`,
        );
        return;
      }

      const remaining = await loadSortedRules(ctx, user.wallet_address);
      if (remaining === null) return;

      if (remaining.length === 0) {
        await ctx.editMessageText(
          `📜 <b>Your Risk Rules</b>\n\nAll rules deleted. You have none set right now.`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📜 Set a Risk Rule", callback_data: "set_rule" }],
                [{ text: "🔙 Back", callback_data: "rules_list_back" }],
              ],
            },
          },
        );
        return;
      }

      // If we deleted the last rule on this page, step back a page so we don't render an empty page
      const totalPages = Math.ceil(remaining.length / RULES_PER_PAGE);
      const nextPage = Math.min(page, totalPages - 1);

      await renderRulesPage(ctx, remaining, nextPage);
    } catch (error) {
      console.error("Failed to delete rule:", error);
      await ctx.reply("❌ Something went wrong while deleting the rule.");
    }
  });

  // Step 2b: user backed out -just return to the list, no deletion.
  bot.action(/^cancel_delete:(\d+)$/, async (ctx: any) => {
    try {
      await ctx.answerCbQuery();
      const page = parseInt(ctx.match[1], 10);

      const user = await getWalletByTelegramId(ctx.from!.id);
      if (!user) return;

      const rules = await loadSortedRules(ctx, user.wallet_address);
      if (rules === null) return;

      await renderRulesPage(ctx, rules, page);
    } catch (error) {
      console.error("Failed to cancel delete:", error);
      await ctx.reply("❌ Something went wrong. Please try again.");
    }
  });

  bot.action("rules_list_back", async (ctx: any) => {
    await ctx.answerCbQuery();

    try {
     await ctx.deleteMessage(); // remove the rules list
    await sendMainMenu(ctx);  
    } catch (error) {
      console.error("Failed to delete message:", error);
    }
  });

bot.action(/^edit_rule:(\d+):(\d+)$/, async (ctx: any) => {
  await ctx.answerCbQuery();
  const index = parseInt(ctx.match[1], 10);
  const page = parseInt(ctx.match[2], 10);
  await ctx.scene.enter("edit_rule_scene", { index, page });
});
}