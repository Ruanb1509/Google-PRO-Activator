import { adminRoute, json, parseBody } from "@/server/common/http";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { getSettings, saveSettings, storeSettingsSchema } from "@/server/settings/settings.service";
import { listProviders } from "@/server/payments/registry";
import { binanceConfigured } from "@/server/wallet/binance-pay.client";
import { env, mockPaymentsEnabled } from "@/server/config/env";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async () => {
  return json({
    settings: await getSettings(),
    providers: listProviders(),
    integrations: {
      binancePay: { configured: binanceConfigured(), payId: env().BINANCE_PAY_ID ?? null },
      mockPayments: mockPaymentsEnabled(),
      telegramBot: env().TELEGRAM_BOT_USERNAME,
    },
  });
});

export const PUT = adminRoute("ADMIN", async ({ req, admin, ip }) => {
  const body = await parseBody(req, storeSettingsSchema);
  const before = await getSettings();
  const saved = await saveSettings(body, admin.id);
  await audit({ actorType: "ADMIN", adminId: admin.id, ip, action: AuditActions.SETTINGS_UPDATED, resourceType: "settings", resourceId: "store", details: { before, after: saved } });
  return json({ settings: saved });
});
