import { Scenes, Markup } from "telegraf";
import { storeRule } from "../memory/client.js";
import { getWalletByTelegramId } from "../lib/helpers.js";
import type { GhostContext } from "../types/context.js";
import type { RuleType, RiskRule } from "../memory/schema.js";


export const setRuleScene = new Scenes.WizardScene<GhostContext>(
  "set-rule",

  // STEP 1 -- rule type
  async (ctx) => {
    await ctx.reply(
      "📜 <b>New Risk Rule</b>\n\nWhat kind of rule is this?",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Max exposure %", "rt_max_exposure_pct")],
          [Markup.button.callback("Avoid a category", "rt_avoid_category")],
          [Markup.button.callback("Max position size ($)", "rt_max_position_size")],
        ]),
      }
    );
    return ctx.wizard.next();
  },

  // STEP 2 -- capture rule type from callback, ask what it applies to
  async (ctx) => {
    if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
      await ctx.reply("Please tap one of the options above.");
      return;
    }
    const ruleType = ctx.callbackQuery.data.replace("rt_", "") as RuleType;
    await ctx.answerCbQuery();

    (ctx.wizard.state as any).rule_type = ruleType;

    await ctx.reply(
      "What category or asset does this apply to?\n\n" +
        "e.g. <code>meme-tokens</code>, <code>speculative</code>, or <code>*</code> for all trades",
      { parse_mode: "HTML" }
    );
    return ctx.wizard.next();
  },

  // STEP 3 -- capture applies_to, ask for threshold
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Please send this as text.");
      return;
    }
    (ctx.wizard.state as any).applies_to = ctx.message.text.trim();

    const ruleType = (ctx.wizard.state as any).rule_type as RuleType;

    if (ruleType === "avoid_category") {
      await ctx.reply(
        "This rule doesn't need a number. Just type <code>ok</code> to confirm.",
        { parse_mode: "HTML" }
      );
    } else {
      const unit = ruleType === "max_position_size" ? "USD" : "%";
      await ctx.reply(`What's the threshold? (number only, in ${unit})`);
    }
    return ctx.wizard.next();
  },

  // STEP 4 -- capture threshold (or confirmation for avoid_category), ask for notes
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Please send this as text.");
      return;
    }

    const ruleType = (ctx.wizard.state as any).rule_type as RuleType;
    const text = ctx.message.text.trim();

    if (ruleType === "avoid_category") {
      (ctx.wizard.state as any).threshold = 0;
      (ctx.wizard.state as any).unit = "none";
    } else {
      const value = parseFloat(text);
      if (isNaN(value)) {
        await ctx.reply("That doesn't look like a number. Try again.");
        return;
      }
      (ctx.wizard.state as any).threshold = value;
      (ctx.wizard.state as any).unit =
        ruleType === "max_position_size" ? "usd" : "percent";
    }

    await ctx.reply("Any notes on why this rule exists? (or send '-' to skip)");
    return ctx.wizard.next();
  },

  // STEP 5 -- capture notes, save the rule
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Please send this as text.");
      return;
    }
    const notesText = ctx.message.text.trim();
    const notes = notesText === "-" ? "" : notesText;

    const state = ctx.wizard.state as any;
    const rule: RiskRule = {
      rule_type: state.rule_type,
      applies_to: state.applies_to,
      threshold: state.threshold,
      unit: state.unit,
      notes,
    };

    try {
      const user = await getWalletByTelegramId(ctx.from!.id);
      if (!user) {
        await ctx.reply("You don't have a Ghost Wallet yet. Use /start first.");
        return ctx.scene.leave();
      }

      const result = await storeRule(user.wallet_address, rule);

      if (!result.ok) {
        await ctx.reply(`❌ Couldn't save that rule: ${result.error || "unknown error"}`);
        return ctx.scene.leave();
      }

      await ctx.reply(
        `✅ <b>Rule saved</b>\n\n` +
          `${rule.rule_type} on <code>${rule.applies_to}</code>` +
          (rule.unit !== "none"
            ? ` — limit: ${rule.threshold}${
                rule.unit === "percent" ? "%" : rule.unit === "usd" ? " USD" : ""
              }`
            : "") +
          (rule.notes ? `\n\n"${rule.notes}"` : ""),
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("Failed to save rule:", error);
      await ctx.reply("❌ Something went wrong saving that rule. Please try again.");
    }

    return ctx.scene.leave();
  }
);