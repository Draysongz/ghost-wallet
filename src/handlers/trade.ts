
import { Markup } from "telegraf";
import { parseTradeInput, resolveAsset, type ParsedTradeInput } from "../engine/parseTrade.js";
import { evaluate, type ProposedTrade, type EvaluationResult } from "../engine/evaluate.js";
import { getPortfolioSnapshot } from "../base/balance.js";
import { storeLesson } from "../memory/client.js";
import { getWalletByTelegramId } from "../lib/helpers.js";
import { sendMainMenu } from "../lib/helpers.js";
import type { ResolvedToken } from "../base/pricing.js";
import type { TradeLesson } from "../memory/schema.js";

interface PendingTrade {
  parsed: ParsedTradeInput;
  evaluatedAsset: ResolvedToken;
  evaluation: EvaluationResult;
}

interface ChatState {
  pending?: PendingTrade;
  awaitingOverrideReason?: boolean;
}

// Short-lived, in-memory only -- these decisions live for seconds to
// minutes while a user taps a button or types a reason. No need for
// Mongo/Sibyl persistence here; if the bot restarts mid-decision, the
// user just re-proposes the trade.
const chatState = new Map<number, ChatState>();

function primaryCategory(tags: string[]): string {
  return tags[0] ?? "general";
}

function formatDecisionMessage(result: EvaluationResult, asset: string, amountUsd: number): string {
  const header =
    result.decision === "block"
      ? "⚠️ <b>TRADE BLOCKED</b>"
      : result.decision === "modify"
      ? "⚠️ <b>TRADE FLAGGED</b>"
      : "✅ <b>TRADE APPROVED</b>";

  let body = `${header}\n\n<b>${asset}</b> — $${amountUsd}\n\n${result.reason}`;

  if (result.decision === "modify" && result.suggested_size_usd !== undefined) {
    body += `\n\nGhost recommends reducing this to <b>$${result.suggested_size_usd}</b>.`;
  }

  return body;
}

// The core pipeline: parse -> resolve -> real balance snapshot ->
// evaluate -> reply with decision (+ buttons if not a plain approve).
// Called identically whether the user tapped the button (then typed a
// follow-up) or typed a trade command with no button involved at all.
async function runTradeProposal(ctx: any, rawText: string) {
  let parsed: ParsedTradeInput;
  try {
    parsed = parseTradeInput(rawText);
  } catch (error: any) {
    await ctx.reply(`❌ ${error.message}`);
    return;
  }

  const user = await getWalletByTelegramId(ctx.from!.id);
  if (!user) {
    await ctx.reply("👻 You don't have a Ghost Wallet yet.\n\nUse /start to create or import one.");
    return;
  }

  if (parsed.action === "sell") {
    await ctx.reply(
      `✅ Selling doesn't trigger your risk rules — proceeding.\n\n` +
        `(Execution isn't wired up yet — this confirms the decision only.)`
    );
    await sendMainMenu(ctx);
    return;
  }

  const assetToResolve = parsed.action === "swap" ? parsed.toAsset! : parsed.asset;

  let resolved: ResolvedToken;
  try {
    resolved = await resolveAsset(assetToResolve);
  } catch (error: any) {
    await ctx.reply(`❌ ${error.message}`);
    return;
  }

  const category = primaryCategory(resolved.category_tags);

  let snapshot;
  try {
    snapshot = await getPortfolioSnapshot(
      user.wallet_address,
      user.smart_wallet_address as `0x${string}`,
      category
    );
  } catch (error: any) {
    console.error("Failed to read portfolio snapshot:", error);
    await ctx.reply("❌ Couldn't read your wallet balance right now. Please try again shortly.");
    return;
  }

  const trade: ProposedTrade = {
    asset: resolved.symbol,
    category_tags: resolved.category_tags,
    position_size_usd: parsed.amountUsd,
    portfolio_value_usd: snapshot.portfolioValueUsd,
    current_category_exposure_usd: snapshot.categoryExposureUsd,
  };

  const evaluation = await evaluate(user.wallet_address, trade);
  const message = formatDecisionMessage(evaluation, trade.asset, trade.position_size_usd);

  if (evaluation.decision === "approve") {
    await ctx.reply(message, { parse_mode: "HTML" });
    await sendMainMenu(ctx);
    return;
  }

  chatState.set(ctx.chat.id, {
    pending: { parsed, evaluatedAsset: resolved, evaluation },
  });

  const buttons =
    evaluation.decision === "block"
      ? [
          [
            Markup.button.callback("Cancel", "trade_cancel"),
            Markup.button.callback("Override", "trade_override"),
          ],
        ]
      : [
          [Markup.button.callback("Confirm reduced size", "trade_confirm_modify")],
          [
            Markup.button.callback("Cancel", "trade_cancel"),
            Markup.button.callback("Override full amount", "trade_override"),
          ],
        ];

  await ctx.reply(message, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard(buttons),
  });
}

async function logExecutedTrade(
  ctx: any,
  pending: PendingTrade,
  opts: { sizeUsd: number; wasOverride: boolean; overrideReason?: string }
) {
  const user = await getWalletByTelegramId(ctx.from!.id);
  if (!user) return;

  const asset = pending.evaluatedAsset;

  const lesson: TradeLesson = {
    asset: asset.symbol,
    category_tags: asset.category_tags,
    position_size_usd: opts.sizeUsd,
    outcome_pct: null,
    lesson: "Pending outcome",
    status: "open",
    coingecko_id: asset.coingecko_id,
    entry_price_usd: asset.price_usd,
    was_override: opts.wasOverride,
    override_reason: opts.overrideReason as string,
  };

  await storeLesson(user.wallet_address, lesson);

  await ctx.reply(
    `✅ Trade logged at $${opts.sizeUsd}${opts.wasOverride ? " (override recorded)" : ""}.\n\n` +
      `(On-chain execution isn't wired up yet — this records the decision and opens the position in memory. ` +
      `Outcome will resolve automatically once price monitoring is built.)`
  );
  await sendMainMenu(ctx);
}

export function registerProposeTradeHandlers(bot: any) {
  // Entry point 1: tapping the menu button. Just prompts -- the user's
  // NEXT message gets caught by the text handler below, same as if
  // they'd typed a trade command with no button involved at all.
  bot.action("propose_trade", async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      "🧠 Type your trade like:\n" +
        "<code>buy PEPE $1000</code>\n" +
        "<code>sell ETH $500</code>\n" +
        "<code>swap ETH for USDC $200</code>",
      { parse_mode: "HTML" }
    );
  });

  // Entry point 2: typing a trade command directly, unprompted, at any
  // time. Also handles the override-reason follow-up, checked FIRST so
  // it doesn't get mistaken for a new trade command.
  bot.on("text", async (ctx: any, next: any) => {
    const text = ctx.message?.text?.trim();
    if (!text) return next();

    const state = chatState.get(ctx.chat.id);

    if (state?.awaitingOverrideReason && state.pending) {
      const pending = state.pending;
      chatState.delete(ctx.chat.id);
      await logExecutedTrade(ctx, pending, {
        sizeUsd: pending.parsed.amountUsd, // full original amount, not reduced
        wasOverride: true,
        overrideReason: text,
      });
      return;
    }

    const looksLikeTrade = /^(buy|sell|swap)\s+/i.test(text);
    if (!looksLikeTrade) return next();

    await runTradeProposal(ctx, text);
  });

  bot.action("trade_cancel", async (ctx: any) => {
    await ctx.answerCbQuery();
    chatState.delete(ctx.chat.id);
    await ctx.reply("Trade cancelled.");
    await sendMainMenu(ctx);
  });

  bot.action("trade_confirm_modify", async (ctx: any) => {
    await ctx.answerCbQuery();
    const state = chatState.get(ctx.chat.id);
    if (!state?.pending) {
      await ctx.reply("This trade proposal has expired. Please propose it again.");
      return;
    }
    chatState.delete(ctx.chat.id);
    await logExecutedTrade(ctx, state.pending, {
      sizeUsd: state.pending.evaluation.suggested_size_usd ?? state.pending.parsed.amountUsd,
      wasOverride: false,
    });
  });

  bot.action("trade_override", async (ctx: any) => {
    await ctx.answerCbQuery();
    const state = chatState.get(ctx.chat.id);
    if (!state?.pending) {
      await ctx.reply("This trade proposal has expired. Please propose it again.");
      return;
    }
    chatState.set(ctx.chat.id, { ...state, awaitingOverrideReason: true });
    await ctx.reply("Why are you overriding Ghost's recommendation?");
  });
}