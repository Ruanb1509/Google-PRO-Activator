// Deterministic, fake configuration for tests (no real secrets, no network).
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.HASH_SECRET ??= "test-hash-secret-test-hash-secret-0000";
process.env.CRON_SECRET ??= "test-cron-secret-0000";
process.env.TELEGRAM_BOT_TOKEN ??= "123456:TEST_TOKEN_TEST_TOKEN_TEST";
process.env.TELEGRAM_BOT_USERNAME ??= "test_bot";
process.env.TELEGRAM_WEBHOOK_SECRET ??= "test_webhook_secret_0000";
process.env.PAYMENTS_MOCK_ENABLED ??= "true";
process.env.MOCK_WEBHOOK_SECRET ??= "test-mock-webhook-secret";
process.env.BINANCE_PAY_ID ??= "123456789";
process.env.LOG_LEVEL ??= "error";
