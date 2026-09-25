/**
 * Registers the Telegram webhook (production/preview) and the bot command list.
 *   npm run bot:set-webhook                -> uses APP_URL from .env
 *   npm run bot:set-webhook -- --url https://your-app.vercel.app
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { Api } from "grammy";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    info: { type: "boolean", default: false },
    // Only refresh commands/descriptions (no webhook change, no webhook secret needed).
    "profile-only": { type: "boolean", default: false },
  },
});

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const base = values.url ?? process.env.APP_URL;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN é obrigatório");
  const api = new Api(token);

  if (values.info) {
    console.log(await api.getWebhookInfo());
    return;
  }

  let url = "";
  if (!values["profile-only"]) {
    if (!secret || !base) throw new Error("TELEGRAM_WEBHOOK_SECRET e APP_URL são obrigatórios");
    url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
    await api.setWebhook(url, {
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      max_connections: 40,
    });
  }

  await api.setMyCommands([
    { command: "start", description: "Iniciar / menu" },
    { command: "comprar", description: "Comprar" },
    { command: "pedidos", description: "Meus pedidos" },
    { command: "saldo", description: "Saldo" },
    { command: "suporte", description: "Suporte" },
    { command: "ajuda", description: "Ajuda" },
    { command: "idioma", description: "Alterar idioma" },
  ], { language_code: "pt" });
  await api.setMyCommands([
    { command: "start", description: "Start / menu" },
    { command: "buy", description: "Buy" },
    { command: "orders", description: "My orders" },
    { command: "balance", description: "Balance" },
    { command: "support", description: "Support" },
    { command: "help", description: "Help" },
    { command: "language", description: "Change language" },
  ]);

  // Texts shown in the empty chat ("What can this bot do?") and in the bot profile.
  await api.setMyDescription(
    [
      "🛒 Compre com entrega automática.",
      "",
      "💳 PIX, cartão internacional ou saldo (Binance Pay).",
      "⚡ O produto chega aqui no chat assim que o pagamento é confirmado.",
      "💬 Suporte antes e depois da compra.",
      "",
      "Toque em INICIAR para começar.",
    ].join("\n"),
    { language_code: "pt" },
  );
  await api.setMyDescription(
    [
      "🛒 Buy with automatic delivery.",
      "",
      "💳 PIX, international card or balance (Binance Pay).",
      "⚡ Your product arrives right here as soon as the payment is confirmed.",
      "💬 Support before and after your purchase.",
      "",
      "Tap START to begin.",
    ].join("\n"),
  );
  await api.setMyShortDescription("Loja com entrega automática · PIX, cartão e Binance Pay · Suporte no chat", { language_code: "pt" });
  await api.setMyShortDescription("Store with automatic delivery · PIX, card and Binance Pay · In-chat support");

  const me = await api.getMe();
  console.log(url ? `Webhook de @${me.username} registrado em ${url}` : `Comandos e descrições de @${me.username} atualizados`);
  console.log(`Dica: defina TELEGRAM_BOT_INFO='${JSON.stringify(me)}' para evitar getMe em cold starts.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
