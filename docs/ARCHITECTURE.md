# Arquitetura

## Visão geral

Um único projeto **Next.js 16 (App Router)** implantado na **Vercel** contém tudo:

```
                 ┌──────────────────────────── Vercel (Fluid Compute, região gru1) ─────────────────────────────┐
 Telegram ──────▶│ POST /api/telegram/webhook ──▶ bot (grammY) ─┐                                               │
                 │                                              │        src/server (lógica de negócio)          │
 Mercado Pago ──▶│ POST /api/webhooks/mercadopago ─┐            ├──▶ orders · payments · inventory · wallet ... ──┼──▶ PostgreSQL (Neon)
 Stripe ────────▶│ POST /api/webhooks/stripe ──────┼─ webhooks ─┤                                               │
                 │                                 │            │                                               │
 Vercel Cron ───▶│ GET  /api/cron/maintenance ─────┘            │                                               │
 Navegador ─────▶│ /  (dashboard)  +  /api/admin/* ─────────────┘                                               │
                 └───────────────────────────────────────────────────────────────────────────────────────────────┘
                          │ saída: Telegram Bot API, API Mercado Pago, API Stripe, API Binance (somente leitura)
```

- **O Telegram é apenas uma interface.** Os handlers do bot (`src/server/bot/bot.ts`) só traduzem cliques em chamadas aos serviços.
- **Sem Redis/BullMQ** (não se encaixam em serverless): locks usam `SELECT … FOR UPDATE [SKIP LOCKED]` no Postgres, rate limiting usa uma tabela com upsert atômico, e tarefas assíncronas rodam via Vercel Cron + `after()` (manutenção oportunista e limitada a 1 execução a cada 2 min).

## Estrutura de pastas

```
prisma/
  schema.prisma                 modelo relacional
  migrations/                   SQL versionado (+ CHECK constraints extras)
src/
  app/
    (dashboard)/…               páginas do painel (client components)
    login/                      login + 2FA
    api/
      health, ready, metrics    observabilidade
      telegram/webhook          updates do bot
      webhooks/[provider]       webhooks de pagamento (mercadopago | stripe | mock)
      cron/maintenance          Vercel Cron
      dev/mock-pay              checkout simulado (somente fora de produção)
      admin/…                   API do painel (sessão + CSRF + papéis)
  i18n/
    pt-BR/bot.json, en-US/bot.json, index.ts
  server/
    config/        env tipado e validado (zod)
    common/        db, logger JSON, erros, crypto, http (wrappers de rota), rate-limit, money
    auth/          senha (scrypt), TOTP, sessões, papéis, administradores
    audit/         logs de auditoria
    settings/      configurações editáveis (métodos de pagamento, limites, Binance Pay)
    users/         clientes
    products/      catálogo + contagem de estoque
    inventory/     parser, fila de itens, reserva/venda/liberação transacional
    orders/        criação de pedidos, ciclo de vida do pagamento, eventos
    payments/      PaymentProvider + adapters (mercadopago, stripe, balance, mock) + registry
    webhooks/      pipeline de webhooks
    wallet/        saldo (ledger), cliente Binance Pay, depósitos
    notifications/ Telegram (envio) + entrega
    bot/           grammY
    admin/         estatísticas e manutenção
  components/, lib/             UI do painel
scripts/                        create-admin, seed, bot-polling, set-webhook
tests/                          unitários + integração (Postgres real)
```

## Modelo de dados

| Tabela | Função |
|---|---|
| `users` | clientes do Telegram (id, username, nome, idioma, país, **saldo**) |
| `products` | catálogo; preços em centavos BRL/USD; soft delete |
| `inventory_items` | um link/código único por linha, **criptografado (AES-256-GCM)**; `value_hash` (HMAC) único global para detectar duplicatas; `order_id` único ⇒ 1 item ↔ 1 pedido |
| `inventory_item_events` | histórico de cada item |
| `orders` / `order_events` | pedido (número sequencial `#123`) e sua linha do tempo |
| `payments` | 1:1 com pedido; `idempotency_key` = id do pedido; `(provider, provider_payment_id)` único |
| `payment_events` | todo webhook recebido; `(provider, event_id)` único ⇒ dedupe |
| `deposits` | recargas Binance Pay; `provider_tx_id` único ⇒ uma transação só credita uma vez |
| `balance_transactions` | ledger imutável do saldo; `(order_id, type)` e `deposit_id` únicos |
| `admins`, `admin_sessions` | administradores (ADMIN/STAFF/VIEWER), sessões revogáveis, 2FA |
| `audit_logs`, `bot_events` | auditoria e eventos do bot |
| `settings`, `rate_limits` | configuração em runtime e contadores de rate limit |

Garantias extras no banco: `balance_cents >= 0`, preços > 0, item `SOLD`/`RESERVED` sempre com `order_id`.

## Fluxo de compra e proteção contra dupla entrega

1. **Pedido** (`orders.service.createOrder`) — em **uma transação**: cria o pedido `PENDING`, reserva o próximo item
   (`SELECT … FOR UPDATE SKIP LOCKED`, reserva temporária até `expires_at + 10 min`) e cria o registro de pagamento.
   Sem estoque ⇒ rollback e `OUT_OF_STOCK`.
2. **Cobrança** no provedor com chave de idempotência = id do pedido (PIX QR/copia e cola, checkout Stripe, débito de saldo).
3. **Webhook** (`webhook.service.processWebhook`): valida a assinatura → grava o evento (único) → **consulta o status oficial na API do provedor** (o conteúdo do webhook e o que o cliente diz nunca bastam) → aplica.
4. **Aplicação do status** (`payment-lifecycle.applyPaymentStatus`) em **uma transação** com `SELECT … FOR UPDATE` no pedido:
   confere valor/moeda, `RESERVED → SOLD` (ou pega outro item livre se a reserva caiu), vincula ao pedido, grava eventos/auditoria. Idempotente.
5. **Entrega** (`delivery.service.deliverOrder`): lease no banco evita envio duplo; mensagem no idioma do cliente; `DELIVERED`.
   Falhas são registradas e reprocessadas pela manutenção; o item fica **permanentemente** associado ao pedido e visível em "Meus pedidos".
6. **Manutenção**: reconcilia pedidos pendentes com o provedor (recupera webhooks perdidos), expira pedidos (cancelando o checkout no provedor), libera reservas vencidas, reenvia entregas, expira depósitos, limpa sessões.

Estados: pagamento `PENDING | PAID | FAILED | EXPIRED | REFUNDED | CANCELLED`; pedido acrescenta `DELIVERED`.
Item: `AVAILABLE | RESERVED | SOLD | INVALID | CANCELLED`.

## Pagamentos: como adicionar um gateway

1. Crie `src/server/payments/providers/<nome>.provider.ts` implementando `PaymentProvider`
   (`createPayment`, `getPaymentStatus`, `handleWebhook`, `refundPayment`, opcional `cancelPayment`).
2. Registre em `src/server/payments/registry.ts`.
3. No painel → Configurações → adicione um método de pagamento apontando para o provider, com a moeda.
   O webhook fica automaticamente em `/api/webhooks/<nome>`.

### Moeda / país
O preço é definido pelo **método de pagamento escolhido** (cada método tem uma moeda configurável), não pelo idioma.
O idioma só ordena as sugestões. O país reportado pelo provedor (PIX ⇒ BR; Stripe ⇒ país do endereço de cobrança/cartão)
é gravado no pedido e no cliente e usado nos relatórios "Brasil x exterior" (lista de países configurável).

## Binance Pay (saldo)

1. Cliente escolhe um valor → o sistema cria um depósito com **valor exato único** (ex.: 10.37 USDT).
2. Cliente envia pelo Binance Pay para o seu Pay ID e informa o **Order ID** da transferência.
3. O backend consulta **a sua conta** (`GET /sapi/v1/pay/transactions`, chave somente leitura) e exige: transação existe,
   é de entrada, moeda correta, dentro da janela do depósito, **valor exato**, nunca usada antes (`provider_tx_id` único).
4. Crédito atômico no ledger; o cliente compra com o método "Saldo" (débito condicional, nunca negativo).

O valor exato impede que alguém que descubra o ID de transação de outra pessoa o reivindique.
