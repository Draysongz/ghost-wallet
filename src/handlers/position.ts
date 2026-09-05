import { Markup } from "telegraf";
import { getCurrentPrice } from "../base/pricing.js"; // adjust path to your actual file


interface MockPosition {
  id: string;
  asset: string;
  coingecko_id: string;
  entry_price_usd: number;
  position_size_usd: number;
  opened_at: string;
}

const MOCK_POSITIONS: MockPosition[] = [
  {
    id: "pos_1",
    asset: "PEPE",
    coingecko_id: "pepe",
    entry_price_usd: 0.0000012,
    position_size_usd: 500,
    opened_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "pos_2",
    asset: "ETH",
    coingecko_id: "ethereum",
    entry_price_usd: 2450,
    position_size_usd: 1000,
    opened_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
];

async function fetchMockPositions(): Promise<MockPosition[]> {
  // Pretend this is async, like a real DB/memory call would be.
  return MOCK_POSITIONS;
}
// ----------------------------------------------------------------------

function formatElapsed(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const hours = ms / 36e5;
  if (hours < 1) return `${Math.round(ms / 60000)}m ago`;
  if (hours < 24) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

interface PositionWithPnl extends MockPosition {
  current_price_usd: number;
  pnl_pct: number;
  pnl_usd: number;
}

async function attachLivePnl(positions: MockPosition[]): Promise<PositionWithPnl[]> {
  const results: PositionWithPnl[] = [];

  for (const pos of positions) {
    try {
      const currentPrice = await getCurrentPrice(pos.coingecko_id);
      const pnlPct = ((currentPrice - pos.entry_price_usd) / pos.entry_price_usd) * 100;
      const pnlUsd = (pos.position_size_usd * pnlPct) / 100;

      results.push({
        ...pos,
        current_price_usd: currentPrice,
        pnl_pct: pnlPct,
        pnl_usd: pnlUsd,
      });
    } catch (error) {
      console.error(`Failed to price position ${pos.id} (${pos.coingecko_id}):`, error);
      // Skip positions we can't price rather than crashing the whole
      // dashboard over one bad lookup.
    }
  }

  return results;
}

function formatPositionCard(pos: PositionWithPnl): string {
  const arrow = pos.pnl_pct >= 0 ? "🟢" : "🔴";
  const sign = pos.pnl_pct >= 0 ? "+" : "";

  return (
    `${arrow} <b>${pos.asset}</b>\n` +
    `Size: <b>$${pos.position_size_usd}</b>  ·  Opened ${formatElapsed(pos.opened_at)}\n` +
    `Entry: <b>$${pos.entry_price_usd}</b>  →  Now: <b>$${pos.current_price_usd}</b>\n` +
    `P&L: <b>${sign}${pos.pnl_pct.toFixed(1)}%</b> (${sign}$${pos.pnl_usd.toFixed(2)})`
  );
}

function positionButtons(pos: PositionWithPnl) {
  return [
    Markup.button.callback(`❌ Close ${pos.asset}`, `close_position:${pos.id}`),
  ];
}

async function renderPositionsDashboard(ctx: any) {
  const positions = await fetchMockPositions();

  if (positions.length === 0) {
    const payload = {
      parse_mode: "HTML" as const,
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Refresh", "positions_refresh")],
        [Markup.button.callback("🔙 Back", "back")],
      ]),
    };
    const text = `📈 <b>Open Positions</b>\n\nNo open positions right now.`;

    if (ctx.updateType === "callback_query") {
      await ctx.editMessageText(text, payload);
    } else {
      await ctx.reply(text, payload);
    }
    return;
  }

  const withPnl = await attachLivePnl(positions);

  let message = `📈 <b>Open Positions</b> (${withPnl.length})\n\n`;
  const buttons: any[] = [];

  withPnl.forEach((pos) => {
    message += formatPositionCard(pos) + `\n\n`;
    buttons.push(positionButtons(pos));
  });

  message += `━━━━━━━━━━━━━━━━━━\n<i>Prices update on refresh.</i>`;

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

  // STUB: closing a position for real means (1) executing the actual
  // close on-chain via thirdweb/Anvil, and (2) calling resolveLesson()
  // with the real final outcome_pct. Neither exists yet -- wiring both
  // in is a one-line swap here once execute-trade + resolveLesson land.
  bot.action(/^close_position:(.+)$/, async (ctx: any) => {
    await ctx.answerCbQuery();
    const positionId = ctx.match[1];

    await ctx.editMessageText(
      `⚠️ Closing positions isn't wired up yet — this button is a placeholder.\n\n(Would close: ${positionId})`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back to positions", "positions_refresh")],
        ]),
      },
    );
  });
}