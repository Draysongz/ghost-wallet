import { Scenes } from "telegraf";
import { createGhostSmartAccount, importOwnerWallet } from "../base/wallet.js";
import {
  getWalletByTelegramId,
  saveWallet,
  sendMainMenu,
} from "../lib/helpers.js";
import type { GhostContext } from "../types/context.js";

export const importWalletScene = new Scenes.WizardScene<GhostContext>(
  "import-wallet",

  // STEP 1
  async (ctx) => {
    await ctx.reply(
      `🔐 <b>Import Existing Wallet</b>\n\n` +
        `Send your EVM private key in your next message.\n\n` +
        `⚠️ <b>Important:</b> Your private key will only be used ` +
        `to connect your wallet and will not be stored by Ghost.\n\n` +
        `Your private-key message will be deleted immediately after receiving it.`,
      {
        parse_mode: "HTML",
      },
    );

    return ctx.wizard.next();
  },

  // STEP 2
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply(
        "⚠️ Please send your private key as a text message.",
      );

      return;
    }

    const privateKeyMessageId = ctx.message.message_id;
    const privateKey = ctx.message.text.trim();

    // Delete the private key message immediately.
    try {
      await ctx.telegram.deleteMessage(
        ctx.chat!.id,
        privateKeyMessageId,
      );
    } catch (error) {
      console.error(
        "Failed to delete private key message:",
        error,
      );
    }

    try {
      const owner = importOwnerWallet(privateKey);

      const existing = await getWalletByTelegramId(
        ctx.from!.id,
      );

      if (existing) {
        await ctx.reply(
          `👻 You already have a Ghost Wallet.\n\n` +
            `Ghost Smart Account:\n` +
            `<code>${existing.smart_wallet_address}</code>`,
          {
            parse_mode: "HTML",
          },
        );

        return ctx.scene.leave();
      }

      const smartAccount = await createGhostSmartAccount(
        owner.account,
      );

      await saveWallet({
        telegram_chat_id: ctx.from!.id,
        wallet_address: owner.address,
        smart_wallet_address: smartAccount.address,
        display_name: ctx.from!.first_name,
      });

      await ctx.reply(
        `👻 <b>Wallet Imported Successfully</b>\n\n` +
          `Owner Wallet:\n` +
          `<code>${owner.address}</code>\n\n` +
          `Ghost Smart Account:\n` +
          `<code>${smartAccount.address}</code>\n\n` +
          `🔐 Your existing wallet remains under your control.\n\n` +
          `🧠 Ghost is now ready.`,
        {
          parse_mode: "HTML",
        },
      );

      await sendMainMenu(ctx);

      return ctx.scene.leave();
    } catch (error) {
      console.error("Wallet import failed:", error);

      await ctx.reply(
        `❌ <b>Invalid Private Key</b>\n\n` +
          `The private key could not be imported.\n\n` +
          `Please start the import process again and make sure ` +
          `you're sending a valid EVM private key.`,
        {
          parse_mode: "HTML",
        },
      );

      return ctx.scene.leave();
    }
  },
);