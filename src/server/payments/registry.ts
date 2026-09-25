import { Errors } from "@/server/common/errors";
import type { PaymentProvider } from "@/server/payments/payment-provider";
import { MercadoPagoProvider } from "@/server/payments/providers/mercadopago.provider";
import { StripeProvider } from "@/server/payments/providers/stripe.provider";
import { BalanceProvider } from "@/server/payments/providers/balance.provider";
import { MockProvider } from "@/server/payments/providers/mock.provider";

/** Register new gateways here. Everything else (orders, webhooks, refunds) works through the interface. */
const providers: Record<string, PaymentProvider> = {
  mercadopago: new MercadoPagoProvider(),
  stripe: new StripeProvider(),
  balance: new BalanceProvider(),
  mock: new MockProvider(),
};

export function getProvider(name: string): PaymentProvider {
  const p = providers[name];
  if (!p) throw Errors.notFound(`Payment provider "${name}"`);
  return p;
}

export function findProvider(name: string): PaymentProvider | undefined {
  return providers[name];
}

export function listProviders(): { name: string; configured: boolean; currencies: readonly string[]; usesWebhooks: boolean }[] {
  return Object.values(providers).map((p) => {
    let configured = false;
    try {
      configured = p.isConfigured();
    } catch {
      configured = false;
    }
    return { name: p.name, configured, currencies: p.supportedCurrencies, usesWebhooks: p.usesWebhooks };
  });
}
