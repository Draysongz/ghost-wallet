import { Scenes, Markup } from "telegraf";
import { editRule, listRules } from "../memory/client.js";
import { getWalletByTelegramId } from "../lib/helpers.js";
import type { RiskRule, SibylEntity } from "../memory/schema.js";
import { type GhostContext } from "../types/context.js";

const VALID_UNITS = ["percent", "usd", "hours", "none"] as const;

interface EditRuleState {
  index: number;
  page: number;
  rule_type: string;
  applies_to: string;
  original: { threshold: number; unit: string; notes: string };
  pending: { threshold?: number; unit?: string; notes?: string };
  awaitingField?: "threshold" | "notes" | undefined;
}

function fieldSummary(state: EditRuleState) {
  const threshold = state.pending.threshold ?? state.original.threshold;
  const unit = state.pending.unit ?? state.original.unit;
  const notes = state.pending.notes ?? state.original.notes;

  return (
    `✏️ <b>Editing Rule</b>\n\n` +
    `Type: <b>${state.rule_type}</b>\n` +
    `Applies to: <b>${state.applies_to}</b>\n\n` +
    `Threshold: <b>${threshold}</b>${state.pending.threshold !== undefined ? " (changed)" : ""}\n` +
    `Unit: <b>${unit}</b>${state.pending.unit !== undefined ? " (changed)" : ""}\n` +
    `Notes: <i>${notes || "—"}</i>${state.pending.notes !== undefined ? " (changed)" : ""}\n\n` +
    `Pick a field to change, or Done to save.`
  );
}

function fieldPickerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Threshold", "field_threshold")],
    [Markup.button.callback("Unit", "field_unit")],
    [Markup.button.callback("Notes", "field_notes")],
    [
      Markup.button.callback("✅ Done", "field_done"),
      Markup.button.callback("❌ Cancel", "field_cancel"),
    ],
  ]);
}

async function renderPicker(ctx: any) {
  const state = ctx.scene.state as EditRuleState;
  await ctx.editMessageText(fieldSummary(state), {
    parse_mode: "HTML",
    ...fieldPickerKeyboard(),
  });
}

export const editRuleScene = new Scenes.BaseScene<GhostContext>(
  "edit_rule_scene",
);

// Entry: expects ctx.scene.enter("edit_rule_scene", { index, page })
editRuleScene.enter(async (ctx: any) => {
  const { index, page } = ctx.scene.state as { index: number; page: number };

  const user = await getWalletByTelegramId(ctx.from!.id);
  if (!user) {
    await ctx.reply("👻 You don't have a Ghost Wallet yet. Use /start.");
    return ctx.scene.leave();
  }

  const result = await listRules(user.wallet_address);
  if (!result.ok) {
    await ctx.reply(`❌ Couldn't load that rule.\n\n${result.error || "Unknown error"}`);
    return ctx.scene.leave();
  }

  const rules = ((result.entities || []) as SibylEntity<RiskRule>[]).sort(
    (a, b) => new Date(a.body.created_at!).getTime() - new Date(b.body.created_at!).getTime(),
  );

  const target = rules[index];
  if (!target) {
    await ctx.reply("⚠️ That rule no longer exists — the list may have changed.");
    return ctx.scene.leave();
  }

  const rule = target.body;

  const state: EditRuleState = {
    index,
    page,
    rule_type: rule.rule_type,
    applies_to: rule.applies_to,
    original: { threshold: rule.threshold, unit: rule.unit, notes: rule.notes ?? "" },
    pending: {},
  };
  ctx.scene.state = state;

  await ctx.editMessageText(fieldSummary(state), {
    parse_mode: "HTML",
    ...fieldPickerKeyboard(),
  });
});

editRuleScene.action("field_threshold", async (ctx: any) => {
  await ctx.answerCbQuery();
  (ctx.scene.state as EditRuleState).awaitingField = "threshold";
  await ctx.editMessageText(
    `Send the new <b>threshold</b> (a number), or type <b>skip</b> to keep it as-is.`,
    { parse_mode: "HTML" },
  );
});

editRuleScene.action("field_notes", async (ctx: any) => {
  await ctx.answerCbQuery();
  (ctx.scene.state as EditRuleState).awaitingField = "notes";
  await ctx.editMessageText(
    `Send the new <b>notes</b>, or type <b>skip</b> to keep it as-is.`,
    { parse_mode: "HTML" },
  );
});

// Unit is a fixed enum -> buttons, not free text
editRuleScene.action("field_unit", async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`Pick the new unit:`, {
    ...Markup.inlineKeyboard(
      VALID_UNITS.map((u) => [Markup.button.callback(u, `set_unit:${u}`)]),
    ),
  });
});

editRuleScene.action(/^set_unit:(.+)$/, async (ctx: any) => {
  await ctx.answerCbQuery();
  const unit = ctx.match[1];
  const state = ctx.scene.state as EditRuleState;
  state.pending.unit = unit;
  await renderPicker(ctx);
});

// Handles the reply after "field_threshold" or "field_notes" prompts
editRuleScene.on("text", async (ctx: any) => {
  const state = ctx.scene.state as EditRuleState;
  if (!state.awaitingField) return; // not expecting free text right now

  const input = ctx.message.text.trim();

  if (state.awaitingField === "threshold") {
    if (input.toLowerCase() !== "skip") {
      const parsed = Number(input);
      if (Number.isNaN(parsed)) {
        await ctx.reply("That's not a valid number. Send a number, or 'skip'.");
        return;
      }
      state.pending.threshold = parsed;
    }
  }

  if (state.awaitingField === "notes") {
    if (input.toLowerCase() !== "skip") {
      state.pending.notes = input;
    }
  }

  state.awaitingField = undefined;

  // Re-send the picker as a fresh message since we're replying to a
  // text message, not a callback -- there's no message to edit here.
  await ctx.reply(fieldSummary(state), {
    parse_mode: "HTML",
    ...fieldPickerKeyboard(),
  });
});

editRuleScene.action("field_done", async (ctx: any) => {
  await ctx.answerCbQuery();
  const state = ctx.scene.state as EditRuleState;

  if (Object.keys(state.pending).length === 0) {
    await ctx.editMessageText("No changes made.", {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back to list", `rules_page:${state.page}`)],
      ]),
    });
    return ctx.scene.leave();
  }

  const user = await getWalletByTelegramId(ctx.from!.id);
  if (!user) return ctx.scene.leave();

  const result = await editRule(user.wallet_address, {
  rule_type: state.rule_type,
  applies_to: state.applies_to,
  ...(state.pending.threshold !== undefined && { threshold: state.pending.threshold }),
  ...(state.pending.unit !== undefined && { unit: state.pending.unit as RiskRule["unit"] }),
  ...(state.pending.notes !== undefined && { notes: state.pending.notes }),
});

  await ctx.scene.leave();

  if (!result.ok) {
    await ctx.editMessageText(`❌ Couldn't save changes.\n\n${result.error || "Unknown error"}`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔙 Back to list", `rules_page:${state.page}`)],
      ]),
    });
    return;
  }

  await ctx.editMessageText(`✅ Rule updated.`, {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🔙 Back to list", `rules_page:${state.page}`)],
    ]),
  });
});

editRuleScene.action("field_cancel", async (ctx: any) => {
  await ctx.answerCbQuery();
  const state = ctx.scene.state as EditRuleState;
  await ctx.editMessageText("Edit cancelled — no changes saved.", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🔙 Back to list", `rules_page:${state.page}`)],
    ]),
  });
  await ctx.scene.leave();
});