/**
 * Local development: runs the bot with long polling (no public URL needed).
 * It removes the webhook while running; run `npm run bot:set-webhook` again before going back to Vercel.
 *   npm run bot:polling
 */
import "dotenv/config";
import { getBot } from "@/server/bot/bot";
import { runMaintenance } from "@/server/admin/maintenance.service";

async function main() {
  const bot = getBot();
  await bot.api.deleteWebhook();
  const timer = setInterval(() => runMaintenance().catch((err) => console.error("maintenance", err)), 60_000);
  process.once("SIGINT", () => {
    clearInterval(timer);
    void bot.stop();
  });
  process.once("SIGTERM", () => {
    clearInterval(timer);
    void bot.stop();
  });
  await bot.start({ onStart: (me) => console.log(`Bot @${me.username} rodando em long polling. Ctrl+C para sair.`) });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
