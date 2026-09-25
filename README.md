# Loja Digital no Telegram

Plataforma de vendas de produtos digitais (links/códigos únicos) integrada ao Telegram, com:

- 🤖 **Bot** PT-BR / EN-US (grammY) — comprar, meus pedidos, preços, saldo, ajuda, idioma
- 💳 **Pagamentos desacoplados** (`PaymentProvider`): **PIX** (Mercado Pago), **cartão internacional** (Stripe), **saldo** (recarga via **Binance Pay**) e um gateway de teste
- 📦 **Estoque em fila** com reserva temporária e venda transacional (`FOR UPDATE SKIP LOCKED`) — o mesmo item nunca vai para dois clientes
- ⚡ **Entrega automática** somente após confirmação do provedor (webhook assinado + consulta à API)
- 🖥️ **Dashboard** (Next.js + Tailwind) — vendas, gráficos, produtos, estoque, pedidos, clientes, depósitos, webhooks, auditoria, configurações, administradores
- 🔐 Sessões seguras, 2FA (TOTP), papéis ADMIN/STAFF/VIEWER, CSRF, rate limiting, auditoria, itens criptografados
- ☁️ **Hospedado na Vercel** + PostgreSQL (Neon)

> Arquitetura detalhada, modelo de dados e fluxos: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 1. Requisitos

- Node.js **22+**
- Um banco **PostgreSQL** (recomendado: Neon via Vercel Marketplace)
- Conta na **Vercel** e a CLI: `npm i -g vercel`
- Um bot criado no **@BotFather**
- Contas nos gateways que for usar (Mercado Pago, Stripe, Binance)

## 2. Instalação

```bash
npm install          # também roda `prisma generate`
cp .env.example .env # preencha as variáveis (seção 4)
```

## 3. Banco de dados (PostgreSQL)

### Na Vercel (recomendado)
```bash
vercel login
vercel link                                   # vincula a pasta a um projeto Vercel
vercel integration add neon --yes             # cria o Postgres e injeta DATABASE_URL / DATABASE_URL_UNPOOLED
vercel env pull .env --yes                    # traz as variáveis para desenvolvimento local
```
Crie o banco na mesma região das funções (`gru1` / São Paulo → Neon `sa-east-1`).

### Local
Qualquer Postgres 14+ serve. Configure `DATABASE_URL` e `DATABASE_URL_UNPOOLED` (podem ser iguais) e aplique as migrations:
```bash
npm run db:migrate        # prisma migrate deploy
```
No deploy da Vercel as migrations rodam automaticamente (`npm run vercel-build`).

## 4. Variáveis de ambiente

Todas estão documentadas em [`.env.example`](.env.example). Nenhuma é exposta ao navegador.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `APP_URL` | ✅ | URL pública (ex.: `https://sualoja.vercel.app`) |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | ✅ | Postgres (pooled / direta para migrations) |
| `ENCRYPTION_KEY` | ✅ | 32 bytes base64 — criptografa itens do estoque e segredos 2FA |
| `HASH_SECRET` | ✅ | segredo do HMAC (sessões, detecção de duplicatas) |
| `CRON_SECRET` | ✅ | autenticação do Vercel Cron |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | ✅ | bot |
| `ADMIN_ALERT_CHAT_IDS` | — | chats que recebem alertas (estoque baixo, falha de entrega) |
| `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_PAYER_EMAIL` | PIX | Mercado Pago |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | cartão | Stripe |
| `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_PAY_ID` | saldo | Binance Pay |
| `METRICS_TOKEN` | — | protege `/api/metrics` |
| `PAYMENTS_MOCK_ENABLED`, `MOCK_WEBHOOK_SECRET` | — | gateway de teste (ignorado em produção) |

Gerar segredos:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"     # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # HASH_SECRET, CRON_SECRET, TELEGRAM_WEBHOOK_SECRET
```

Na Vercel: **Project → Settings → Environment Variables** (ou `vercel env add NOME production`).
Um método de pagamento só aparece no bot se estiver habilitado nas configurações **e** com as variáveis do provider preenchidas.

## 5. Telegram

1. No **@BotFather**: `/newbot` → copie o token para `TELEGRAM_BOT_TOKEN` e o username para `TELEGRAM_BOT_USERNAME`.
2. Depois do deploy, registre o webhook e os comandos:
   ```bash
   npm run bot:set-webhook -- --url https://sualoja.vercel.app
   npm run bot:set-webhook -- --info   # conferir status/erros do webhook
   ```
   O Telegram envia `TELEGRAM_WEBHOOK_SECRET` em cada requisição; requisições sem ele são recusadas.
3. (Opcional) copie o JSON exibido para `TELEGRAM_BOT_INFO`.

Para descobrir seu chat id (para `ADMIN_ALERT_CHAT_IDS`), fale com `@userinfobot`.

## 6. Gateways de pagamento e webhooks

| Provedor | URL do webhook | Eventos |
|---|---|---|
| Mercado Pago | `https://SEU_APP/api/webhooks/mercadopago` | **Pagamentos** |
| Stripe | `https://SEU_APP/api/webhooks/stripe` | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` |

**Mercado Pago (PIX)** — Suas integrações → sua aplicação → *Credenciais de produção* → `MERCADOPAGO_ACCESS_TOKEN`.
Em *Webhooks*, cadastre a URL acima (modo produção), marque **Pagamentos** e copie a *assinatura secreta* para `MERCADOPAGO_WEBHOOK_SECRET`.
A conta precisa ter uma chave PIX cadastrada. `MERCADOPAGO_PAYER_EMAIL` é um e-mail seu, usado como pagador (não enviamos dados do cliente).

**Stripe (cartão internacional)** — Developers → API keys → `STRIPE_SECRET_KEY`. Developers → Webhooks → *Add endpoint* com a URL e os eventos acima → `STRIPE_WEBHOOK_SECRET` (`whsec_…`). O checkout coleta o endereço de cobrança para registrarmos o país.

**Binance Pay (saldo)** — Na Binance: *Gerenciamento de API* → criar chave com **somente “Enable Reading”** → `BINANCE_API_KEY`/`BINANCE_API_SECRET`. Seu *Pay ID* (Binance Pay → Receber) → `BINANCE_PAY_ID`. Depois habilite “Binance Pay” em **Dashboard → Configurações**.
> A Vercel usa IPs dinâmicos; se você restringir a chave por IP, a verificação deixará de funcionar. Mantenha a chave apenas com leitura.

Segurança dos pagamentos:
- A entrega **nunca** acontece porque o cliente voltou ao bot ou disse que pagou; o botão “Verificar pagamento” apenas consulta a API do provedor.
- Todo webhook tem assinatura validada, é registrado (`payment_events`), deduplicado e o status é **re-consultado na API** do provedor.
- Pedido e pagamento têm IDs únicos, chave de idempotência e estados `PENDING, PAID, FAILED, EXPIRED, REFUNDED, CANCELLED`.
- Webhooks perdidos são recuperados pela reconciliação periódica.

## 7. Executar localmente

```bash
npm run db:migrate
npm run admin:create -- --email voce@exemplo.com --name "Seu Nome" --role ADMIN
npm run dev                 # dashboard em http://localhost:3000
npm run bot:polling         # em outro terminal: bot em long polling (sem URL pública)
```

**Testar o fluxo completo sem gateway real:** no `.env` defina `PAYMENTS_MOCK_ENABLED=true` e `MOCK_WEBHOOK_SECRET=<qualquer segredo>`, habilite o método “Pagamento de teste” em Configurações, compre pelo bot e toque em “Pagar agora”: a página de checkout simulado envia um webhook **assinado** pelo mesmo pipeline dos provedores reais. Nunca é ativado com `VERCEL_ENV=production`.

Para receber webhooks reais localmente, use um túnel (ex.: `ngrok http 3000`) e ajuste `APP_URL`.

`npm run seed` cria 3 produtos de demonstração (A R$20/US$4, B R$30/US$6, C R$50/US$10) com estoque de exemplo.

## 8. Deploy na Vercel

```bash
vercel link
vercel integration add neon --yes      # se ainda não tiver banco
# configure as variáveis (seção 4) em Production (e Preview, se usar)
vercel deploy --prod
npm run bot:set-webhook -- --url https://SEU_APP.vercel.app
```

- `vercel.ts` define o build (`prisma generate && prisma migrate deploy && next build`), a região `gru1` e o cron.
- **Cron:** no plano Hobby a Vercel só permite cron diário; o projeto também roda a manutenção de forma oportunista (no máximo a cada 2 min) após updates do bot e webhooks. No plano **Pro**, mude a agenda em `vercel.ts` para `*/5 * * * *`.
- HTTPS é automático na Vercel; os cookies de sessão são `Secure`, `HttpOnly` e `SameSite=Strict`.
- Health checks: `GET /health` (liveness) e `GET /ready` (config + banco). Métricas: `GET /api/metrics` com `Authorization: Bearer $METRICS_TOKEN`.

## 9. Criar administrador

```bash
npm run admin:create -- --email voce@exemplo.com --name "Seu Nome" --role ADMIN
# sem --password, uma senha forte é gerada e exibida uma única vez
npm run admin:create -- --email voce@exemplo.com --reset   # redefine a senha
```
Para produção, rode com o `.env` apontando para o banco de produção (`vercel env pull`).
Ative o **2FA** em *Minha conta*. Outros administradores são criados em *Administradores*:

| Papel | Pode |
|---|---|
| **ADMIN** | tudo: configurações, administradores, reembolsos, excluir produtos, revelar itens, ajustar saldo |
| **STAFF** | produtos, preços, estoque, reenviar entrega, verificar pagamento, bloquear clientes |
| **VIEWER** | somente leitura |

## 10. Produtos e estoque

1. **Produtos → Novo produto**: nome (PT/EN), descrição, categoria, preço BRL, preço USD, ativo, limite de estoque baixo. Quantos produtos quiser, sem mudar código.
2. **Produtos → Produto → Adicionar ao estoque**: cole um link/código por linha **ou** envie um arquivo `.txt`/`.csv` (primeira coluna). O resultado mostra `X itens adicionados · Y duplicados · Z inválidos`. Duplicatas são detectadas **antes** de inserir (no texto enviado e contra todo o estoque já cadastrado).
3. **Estoque**: filtros por produto, status e período; histórico de cada item; marcar inválido; remover itens nunca vendidos; revelar valor (ADMIN, auditado).
4. Alertas de **estoque baixo** no dashboard e no Telegram (`ADMIN_ALERT_CHAT_IDS`); limite global em Configurações ou por produto.

Os valores ficam **criptografados** no banco; listagens mostram apenas uma prévia mascarada.

## 11. Reembolsos

Pedidos → pedido → **Reembolsar** (ADMIN): chama o gateway (Mercado Pago/Stripe) ou devolve ao saldo. O pedido vira `REFUNDED`, tudo fica no histórico e o item **não volta ao estoque** se já foi entregue (volta apenas se nunca foi enviado). Reembolsos feitos direto no painel do gateway também chegam por webhook.

## 12. Testes

```bash
npm test                     # unitários (assinaturas, TOTP RFC 6238, criptografia, parser, i18n…)
npm run typecheck

# Integração com PostgreSQL real (APAGA os dados do banco informado!)
DATABASE_URL=postgresql://…/store_test npm run db:migrate
TEST_DATABASE_URL=postgresql://…/store_test npm run test:integration
```
A suíte de integração cobre: duplicatas no estoque, **20 compradores simultâneos para 6 itens**, webhooks duplicados/concorrentes (entrega exatamente uma vez), assinatura inválida, pago sem estoque, compra com saldo concorrente (sem saldo negativo), reembolso idempotente, depósitos Binance Pay (valor exato, uso único) e expiração com pagamento tardio.

### Roteiro de teste manual
1. `/start` → escolha o idioma → menu aparece no idioma escolhido.
2. 🛒 Comprar → produto → método → pague (ou use o gateway de teste).
3. Confira a mensagem “✅ Pagamento confirmado!” com o item e o número do pedido.
4. 📦 Meus pedidos → abra o pedido → o item continua disponível.
5. No painel: pedido `DELIVERED`, item `SOLD` vinculado, eventos do webhook e auditoria.
6. 👛 Saldo → Adicionar saldo → envie o valor exato pelo Binance Pay → “Já paguei” → informe o Order ID.

## 13. Segurança — resumo

- Senhas com **scrypt**; bloqueio após 5 tentativas; rate limit no login; 2FA TOTP.
- Sessões opacas (hash no banco, revogáveis), cookies `HttpOnly/Secure/SameSite=Strict`, CSRF double-submit nas mutações.
- Validação com **zod** em todas as entradas; Prisma com consultas parametrizadas (sem SQL injection); React escapa saída e mensagens do bot escapam HTML (sem XSS); CSP, HSTS, X-Frame-Options.
- Tokens/chaves somente no servidor; itens do estoque e segredos 2FA criptografados com AES-256-GCM.
- Auditoria de login, preços, produtos, estoque, vendas, reembolsos, webhooks, falhas de pagamento/entrega e configurações.
- Dados mínimos de clientes (id/username/nome do Telegram, idioma, país informado pelo pagamento).

> Use a plataforma apenas para vender produtos/serviços que você está autorizado a comercializar, respeitando os termos dos provedores de pagamento e do Telegram.
