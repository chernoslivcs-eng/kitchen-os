// Р147: стенд у памʼяті + Telegram dev-бот polling'ом, БЕЗ ключа моделі
// (текст із Telegram лише записується в розмову, модель не викликається).
//
//   TELEGRAM_DEV_BOT_TOKEN=… PORT=3014 pnpm exec tsx scripts/telegram-dev.mts
//   (токен — з .env; APP_URL — адреса vite для посилання на профіль, типово :5173)
//
// Ключі моделі затираємо ДО імпорту стенда: env.ts не перекриває вже задані
// змінні, а model.ts без ключа йде в стаб.
if (!process.env.TELEGRAM_DEV_BOT_TOKEN) {
  const { config } = await import('dotenv');
  config();
}
if (!process.env.TELEGRAM_DEV_BOT_TOKEN) { console.error('telegram-dev: нема TELEGRAM_DEV_BOT_TOKEN у .env'); process.exit(1); }
process.env.OPENROUTER_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
await import('./stand-seed.mts');
