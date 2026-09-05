import { createGhostWallet } from "../base/wallet.js";
import {
  getWalletByTelegramId,
  saveWallet,
  sendMainMenu,
} from "../lib/helpers.js";

export function registerCreateWalletHandler(bot: any) {
  bot.action("create_wallet", async (ctx: any) => {
    await ctx.answerCbQuery();

    const telegramChatId = ctx.from.id;

    const existing = await getWalletByTelegramId(
      telegramChatId,
    );

    if (existing) {
      await ctx.reply(
        `👻 <b>You already have a Ghost Wallet</b>\n\n` +
          `Owner Wallet:\n<code>${existing.wallet_address}</code>\n\n` +
          `Ghost Smart Account:\n<code>${existing.smart_wallet_address}</code>`,
        {
          parse_mode: "HTML",
        },
      );

      return;
    }

    const wallet = await createGhostWallet();

    await saveWallet({
      telegram_chat_id: telegramChatId,
      wallet_address: wallet.ownerAddress,
      smart_wallet_address: wallet.smartAccountAddress,
      display_name: ctx.from.first_name,
    });

    await ctx.reply(
      `👻 <b>Ghost Wallet Created</b>\n\n` +
        `Smart Account:\n<code>${wallet.smartAccountAddress}</code>\n\n` +
        `Owner:\n<code>${wallet.ownerAddress}</code>\n\n` +
        `⚠️ Your private key will be sent in the next message.\n` +
        `It will automatically disappear in <b>15 seconds</b>.`,
      {
        parse_mode: "HTML",
      },
    );

    const privateKeyMessage = await ctx.reply(
      `⚠️ <b>PRIVATE KEY</b>\n\n` +
        `<tg-spoiler><code>${wallet.ownerPrivateKey}</code></tg-spoiler>\n\n` +
        `🚨 <b>Save this private key now.</b>\n` +
        `Tap the hidden text to reveal it.\n\n` +
        `⏱️ This message will disappear in 15 seconds.`,
      {
        parse_mode: "HTML",
      },
    );

    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(
          ctx.chat.id,
          privateKeyMessage.message_id,
        );


        await sendMainMenu(ctx)
      } catch (error) {
        console.error(
          "Failed to delete private key message:",
          error,
        );
      }
    }, 15_000);
  });
}