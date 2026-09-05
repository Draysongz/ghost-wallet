import { Scenes, Markup } from "telegraf";
import { storeRule } from "../memory/client.js";
import { getWalletByTelegramId, sendMainMenu } from "../lib/helpers.js";
import type { GhostContext } from "../types/context.js";
import type { RuleType, RiskRule } from "../memory/schema.js";

const messageID: number[] = [];

export const setRuleScene = new Scenes.WizardScene<GhostContext>(
  "set-rule",


  

  // STEP 1 -- rule type
  async (ctx) => {
   const ruleTypeMessage=  await ctx.reply(
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
    messageID.push(ruleTypeMessage.message_id);
    return ctx.wizard.next();
  },

  // STEP 2 -- capture rule type from callback, ask what it applies to
  async (ctx) => {
    if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
      const errorMessage = await ctx.reply("Please tap one of the options above.");
      messageID.push(errorMessage.message_id);
      return;
    }
    const ruleType = ctx.callbackQuery.data.replace("rt_", "") as RuleType;
    await ctx.answerCbQuery();

    (ctx.wizard.state as any).rule_type = ruleType;

   const appliesToMessage = await ctx.reply(
      "What category or asset does this apply to?\n\n" +
        "e.g. <code>meme-tokens</code>, <code>speculative</code>, or <code>*</code> for all trades",
      { parse_mode: "HTML" }
    );
    messageID.push(appliesToMessage.message_id);
    return ctx.wizard.next();
  },

  // STEP 3 -- capture applies_to, ask for threshold
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      const errorMessage = await ctx.reply("Please send this as text.");
      messageID.push(errorMessage.message_id);
      return;
    }
    (ctx.wizard.state as any).applies_to = ctx.message.text.trim();

    const ruleType = (ctx.wizard.state as any).rule_type as RuleType;

    if (ruleType === "avoid_category") {
      const confirmationMessage = await ctx.reply(
        "This rule doesn't need a number. Just type <code>ok</code> to confirm.",
        { parse_mode: "HTML" }
      );
      messageID.push(confirmationMessage.message_id);
    } else {
      const unit = ruleType === "max_position_size" ? "USD" : "%";
      const thresholdMessage = await ctx.reply(`What's the threshold? (number only, in ${unit})`);
      messageID.push(thresholdMessage.message_id);
    }
    return ctx.wizard.next();
  },

  // STEP 4 -- capture threshold (or confirmation for avoid_category), ask for notes
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      const errorMessage = await ctx.reply("Please send this as text.");
      messageID.push(errorMessage.message_id);
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
        const errorMessage = await ctx.reply("That doesn't look like a number. Try again.");
        messageID.push(errorMessage.message_id);
        return;
      }
      (ctx.wizard.state as any).threshold = value;
      (ctx.wizard.state as any).unit =
        ruleType === "max_position_size" ? "usd" : "percent";
    }

    const notesMessage = await ctx.reply("Any notes on why this rule exists? (or send '-' to skip)");
    messageID.push(notesMessage.message_id);
    return ctx.wizard.next();
  },

  // STEP 5 -- capture notes, save the rule
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      const errorMessage = await ctx.reply("Please send this as text.");
      messageID.push(errorMessage.message_id);
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
        const errorMessage = await ctx.reply("You don't have a Ghost Wallet yet. Use /start first.");
        messageID.push(errorMessage.message_id);
        return ctx.scene.leave();
      }

      const result = await storeRule(user.wallet_address, rule);

      if (!result.ok) {
        const errorMessage = await ctx.reply(`❌ Couldn't save that rule: ${result.error || "unknown error"}`);
        messageID.push(errorMessage.message_id);
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

      await ctx.deleteMessages(messageID);

      await sendMainMenu(ctx);
    } catch (error) {
      console.error("Failed to save rule:", error);
      await ctx.reply("❌ Something went wrong saving that rule. Please try again.");
    }

    return ctx.scene.leave();
  }
);