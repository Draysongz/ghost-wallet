import { UserModel } from "../model/user.js";

const GHOST_WALLET_INTRO = `👻 *Welcome to Ghost Wallet*

Your wallet shouldn't just remember your trades.

It should remember *why they went wrong.*

Ghost is an agent-controlled wallet with persistent trading memory.

📜 *Set your rules*

Tell me how you want to trade — for example:

_"Never put more than 20% of my portfolio into speculative assets."_

📉 *Learn from your mistakes*

When a trade goes badly, I remember what happened, what caused it, and what you learned from it.

🛑 *Don't repeat the same mistake*

When you propose a similar trade, I check it against your rules and past experiences. I can *block, resize, or approve* the transaction before it executes.

🔍 *Know why*

Ask me why I approved or rejected a trade, and I'll show you the exact rules and memories behind my decision.

━━━━━━━━━━━━━━━━━━

🧠 *Memory → Judgment → Action*

Ghost is built for deliberate trading decisions, not fast meme-trading.

A little friction can save you from repeating an expensive lesson.

Ready to give your wallet a memory?`;

const MAIN_MENU_KEYBOARD = {
  inline_keyboard: [
    [
      {
        text: "📜 Set a Risk Rule",
        callback_data: "set_rule",
      },
      {
        text: "📉 Log a Trade",
        callback_data: "log_trade",
      },
    ],
    [
      {
        text: "📋 My Rules",
        callback_data: "view_rules",
      },
      {
        text: "📚 My Lessons",
        callback_data: "view_lessons",
      },
    ],
    [
      {
        text: "🧠 Propose a Trade",
        callback_data: "propose_trade",
      },
    ],
  ],
};

export function registerStartHandler(bot: any) {
  bot.start(async (ctx: any) => {
    const telegramId = ctx.from?.id;

    if (!telegramId) {
      await ctx.reply(
        "Couldn't identify your Telegram account. Please try again.",
      );
      return;
    }

    const existingUser = await UserModel.findOne({
      telegram_chat_id: telegramId,
    });

    if (existingUser) {
      const welcomeBackMessage =
        `👻 *Welcome back, ${
          existingUser.display_name || "Ghost User"
        }!*\n\n` +
        `Owner Wallet:\n` +
        `\`${existingUser.wallet_address}\`\n\n` +
        `Ghost Smart Account:\n` +
        `\`${existingUser.smart_wallet_address}\`\n\n` +
        `What would you like to do?`;

      await ctx.reply(welcomeBackMessage, {
        parse_mode: "Markdown",
        reply_markup: MAIN_MENU_KEYBOARD,
      });

      return;
    }

    // New user: wallet creation/import happens through
    // separate callback handlers.
    await ctx.reply(GHOST_WALLET_INTRO, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Create My Ghost Wallet",
              callback_data: "create_wallet",
            },
          ],
          [
            {
              text: "🔐 Import Existing Wallet",
              callback_data: "import_wallet",
            },
          ],
        ],
      },
    });
  });
}