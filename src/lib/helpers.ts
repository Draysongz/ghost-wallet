import { UserModel } from "../model/user.js";

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