import { Telegraf, session, Scenes } from "telegraf";
import { configDotenv } from "dotenv";
import { connectDb } from "./db/connection.js";
import { UserModel } from "./model/user.js";
import { registerStartHandler } from "./handlers/start.js";
import { registerCreateWalletHandler } from "./handlers/createWallet.js";
import { importWalletScene } from "./handlers/importWallet.js";
import {type  GhostContext } from "./types/context.js";
import { setRuleScene } from "./handlers/setRule.js";


configDotenv()

connectDb()

const BOT_TOKEN= process.env.TELEGRAM_BOT_TOKEN!

const bot = new Telegraf<GhostContext>(BOT_TOKEN);

const stage = new Scenes.Stage([
    importWalletScene,
    setRuleScene
]);

bot.use(session());
bot.use(stage.middleware());







registerStartHandler(bot);
registerCreateWalletHandler(bot)




bot.action("import_wallet", async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.scene.enter("import-wallet");
});

bot.action("set_rule", async (ctx) => {
  await ctx.answerCbQuery();

  await ctx.scene.enter("set-rule");
});

bot.launch();