import { Markup } from "telegraf";
import { getMarketSnapshot, type MarketSnapshot } from "../base/pricing.js";
import { listLessons } from "../memory/client.js";
import { getWalletByTelegramId } from "../lib/helpers.js";
import { createForkClients } from "../base/execute-trade.js"; // exposes account/publicClient for balance read
import type { TradeLesson, SibylEntity } from "../memory/schema.js";
import { formatEther } from "viem";

const ANVIL_TEST_PRIVATE_KEY = process.env.ANVIL_TEST_PRIVATE_KEY as `0x${string}`;

function formatElapsed(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const hours = ms / 36e5;
  if (hours < 1) return `${Math.round(ms / 60000)}m ago`;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

function formatPct(pct: number | null): string {
  if (pct === null) return "n/a";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

interface PositionWithMarket {
  name: string;
  asset: string;
  entry_price_usd: number;
  position_size_usd: number;
  opened_at: string;
  market: MarketSnapshot;
  pnl_pct: number;
  pnl_usd: number;
}

async function fetchOpenPositions(tenantId: string): Promise<SibylEntity<TradeLesson>[]> {
  const result = await listLessons(tenantId);
  if (!result.ok || !result.entities) return [];
  return result.entities.filter((e) => e.body.status === "open");
}

async function attachMarketData(entities: SibylEntity<TradeLesson>[]): Promise<PositionWithMarket[]> {
  const validEntities = entities.filter(
    (e) => e.body.coingecko_id && e.body.entry_price_usd !== undefined,
  );

  if (validEntities.length === 0) return [];

  const ids = validEntities.map((e) => e.body.coingecko_id!);
  const snapshots = await getMarketSnapshot(ids);

  const results: PositionWithMarket[] = [];

  for (const entity of validEntities) {
    const lesson = entity.body;
    const market = snapshots.get(lesson.coingecko_id!);

    if (!market) {
      console.error(`No market data returned for ${lesson.coingecko_id} (lesson ${entity.name})`);
      continue;
    }

    const pnlPct = ((market.price_usd - lesson.entry_price_usd!) / lesson.entry_price_usd!) * 100;
    const pnlUsd = (lesson.position_size_usd * pnlPct) / 100;

    results.push({
      name: entity.name,
      asset: lesson.asset,
      entry_price_usd: lesson.entry_price_usd!,
      position_size_usd: lesson.position_size_usd,
      opened_at: entity.created_at,
      market,
      pnl_pct: pnlPct,
      pnl_usd: pnlUsd,
    });
  }

  return results;
}

async function getWalletEthBalance(privateKey: `0x${string}`): Promise<{ eth: number; usd: number; ethPriceUsd: number }> {
  const { publicClient, account } = createForkClients(privateKey);
  const balanceWei = await publicClient.getBalance({ address: account.address });
  const ethBalance = Number(formatEther(balanceWei));

  const snapshot = await getMarketSnapshot(["ethereum"]);
  const ethPrice = snapshot.get("ethereum")?.price_usd ?? 0;

  return { eth: ethBalance, usd: ethBalance * ethPrice, ethPriceUsd: ethPrice };
}

function formatPositionsOverview(positions: PositionWithMarket[]): string {
  if (positions.length === 0) {
    return `<b>Positions Overview:</b>\n\nNo open positions right now.`;
  }

  let message = `<b>Positions Overview:</b>\n\n`;

  positions.forEach((pos, i) => {
    const arrow = pos.pnl_pct >= 0 ? "🟢" : "🔴";
    const sign = pos.pnl_pct >= 0 ? "+" : "";
    const currentValue = pos.position_size_usd * (1 + pos.pnl_pct / 100);

    message +=
      `${arrow} /${i + 1} <b>${pos.asset}</b>\n` +
      `Profit: ${sign}${pos.pnl_pct.toFixed(2)}% / ${sign}$${pos.pnl_usd.toFixed(2)}\n` +
      `Value: $${currentValue.toFixed(2)} (entry $${pos.position_size_usd.toFixed(2)})\n` +
      `Mcap: $${pos.market.market_cap_usd.toLocaleString()}  @  $${pos.market.price_usd}\n` +
      `1h: ${formatPct(pos.market.price_change_pct_1h)}  ·  24h: ${formatPct(pos.market.price_change_pct_24h)}\n` +
      `Opened: ${formatElapsed(pos.opened_at)}\n\n`;
  });

  const totalValue = positions.reduce((sum, p) => sum + p.position_size_usd * (1 + p.pnl_pct / 100), 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl_usd, 0);

  message += `━━━━━━━━━━━━━━━━━━\n` + `Total Value: $${totalValue.toFixed(2)} (${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)})`;

  return message;
}

async function renderPositionsDashboard(ctx: any) {
  const user = await getWalletByTelegramId(ctx.from!.id);
  if (!user) {
    await ctx.reply("👻 You don't have a Ghost Wallet yet.\n\nUse /start to create or import one.");
    return;
  }

  const openEntities = await fetchOpenPositions(user.wallet_address);
  const positions = await attachMarketData(openEntities);

  let ethLine = "";
  try {
    const balance = await getWalletEthBalance(ANVIL_TEST_PRIVATE_KEY);
    ethLine = `\n\n<b>Balance:</b> ${balance.eth.toFixed(4)} ETH / $${balance.usd.toFixed(2)}`;
  } catch (error) {
    console.error("Failed to fetch ETH balance:", error);
  }

  const message = formatPositionsOverview(positions) + ethLine;

  const buttons: any[] = positions.map((pos) => [
    Markup.button.callback(`❌ Close ${pos.asset}`, `close_position:${pos.name}`),
  ]);

  buttons.push([Markup.button.callback("🔄 Refresh", "positions_refresh")]);
  buttons.push([Markup.button.callback("🔙 Back", "back")]);

  const payload = {
    parse_mode: "HTML" as const,
    reply_markup: { inline_keyboard: buttons },
  };

  if (ctx.updateType === "callback_query" && ctx.callbackQuery.message) {
    await ctx.editMessageText(message, payload);
  } else {
    await ctx.reply(message, payload);
  }
}

export function registerPositionsHandler(bot: any) {
  bot.action("view_positions", async (ctx: any) => {
    try {
      await ctx.answerCbQuery();
      await renderPositionsDashboard(ctx);
    } catch (error) {
      console.error("Failed to load positions:", error);
      await ctx.reply("❌ Something went wrong loading your positions.");
    }
  });

  bot.action("positions_refresh", async (ctx: any) => {
    try {
      await ctx.answerCbQuery("Refreshing...");
      await renderPositionsDashboard(ctx);
    } catch (error) {
      console.error("Failed to refresh positions:", error);
      await ctx.answerCbQuery("Refresh failed.");
    }
  });

  bot.action(/^close_position:(.+)$/, async (ctx: any) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "⚠️ Closing positions still needs the sell-swap function confirmed (see earlier note) — not wired up yet.",
    );
  });
}