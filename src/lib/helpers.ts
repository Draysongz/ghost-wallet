import { UserModel } from "../model/user.js";
import type { GhostContext } from "../types/context.js";

export async function getWalletByTelegramId(
  telegramChatId: number,
) {
  return UserModel.findOne({
    telegram_chat_id: telegramChatId,
  });
}

export async function saveWallet(data: {
  telegram_chat_id: number;
  wallet_address: string;
  smart_wallet_address: string;
  display_name?: string;
}) {
  return UserModel.create(data);
}



export const MAIN_MENU_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "📜 Set a Risk Rule", callback_data: "set_rule" },
      { text: "📈 Positions", callback_data: "view_positions" },
    ],
    [
      { text: "📋 My Rules", callback_data: "view_rules" },
      { text: "📚 My Lessons", callback_data: "view_lessons" },
    ],
    [{ text: "🧠 Propose a Trade", callback_data: "propose_trade" }],
  ],
};

// Call this at the end of any handler/scene once its work is done, so
// the user always lands back on the same menu, from the same place.
export async function sendMainMenu(ctx: GhostContext, message = "What would you like to do next?") {
  await ctx.reply(message, {
    reply_markup: MAIN_MENU_KEYBOARD,
  });
}