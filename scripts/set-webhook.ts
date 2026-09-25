/**
 * Registers the Telegram webhook (production/preview) and the bot command list.
 *   npm run bot:set-webhook                -> uses APP_URL from .env
 *   npm run bot:set-webhook -- --url https://your-app.vercel.app
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { Api } from "grammy";

const { values } = parseArgs({ options: { url: { type: "string" }, info: { type: "boolean", default: false } } });

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base = values.url ?? process.env.APP_URL;
  if (!token || !secret || !base) throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET e APP_URL são obrigatórios");
  const api = new Api(token);

  if (values.info) {
    console.log(await api.getWebhookInfo());
    return;
  }

  const url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
  await api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
    max_connections: 40,
  });

  await api.setMyCommands([
    { command: "start", description: "Iniciar / menu" },
    { command: "comprar", description: "Comprar" },
    { command: "pedidos", description: "Meus pedidos" },
    { command: "saldo", description: "Saldo" },
    { command: "ajuda", description: "Ajuda" },
    { command: "idioma", description: "Alterar idioma" },
  ], { language_code: "pt" });
  await api.setMyCommands([
    { command: "start", description: "Start / menu" },
    { command: "buy", description: "Buy" },
    { command: "orders", description: "My orders" },
    { command: "balance", description: "Balance" },
    { command: "help", description: "Help" },
    { command: "language", description: "Change language" },
  ]);

  const me = await api.getMe();
  console.log(`Webhook de @${me.username} registrado em ${url}`);
  console.log(`Dica: defina TELEGRAM_BOT_INFO='${JSON.stringify(me)}' para evitar getMe em cold starts.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
