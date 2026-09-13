// Р147/Р149: стенд у памʼяті + Telegram dev-бот polling'ом.
//
//   PORT=3014 pnpm exec tsx scripts/telegram-dev.mts            # без моделі: текст лише записується
//   PORT=3015 pnpm exec tsx scripts/telegram-dev.mts --model    # з моделлю (або TELEGRAM_DEV_MODEL=1)
//   (TELEGRAM_DEV_BOT_TOKEN і ключ моделі — з кореневого .env; APP_URL — адреса vite для
//    посилань, типово :5173; один токен = один polling — другий стенд із тим самим ботом не піднімати)
//
// .env читає services/api/src/env.ts (dotenv) при імпорті стенда — але вже задані змінні
// він не перекриває, тому ключі моделі затираємо ДО імпорту: без --model model.ts іде в стаб.
import { config } from '../services/api/node_modules/dotenv/lib/main.js';
config();
if (!process.env.TELEGRAM_DEV_BOT_TOKEN) { console.error('telegram-dev: нема TELEGRAM_DEV_BOT_TOKEN у .env'); process.exit(1); }
const withModel = process.argv.includes('--model') || process.env.TELEGRAM_DEV_MODEL === '1';
if (!withModel) {
  process.env.OPENROUTER_API_KEY = '';
  process.env.ANTHROPIC_API_KEY = '';
}
console.log(`telegram-dev: модель ${withModel ? 'УВІМКНЕНА (платні виклики)' : 'вимкнена (стаб)'}`);
await import('./stand-seed.mts');
