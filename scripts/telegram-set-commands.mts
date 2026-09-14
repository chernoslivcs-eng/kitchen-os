// Р152 (PR 5, «Подивитись без моделі»): один раз реєструє меню бота (кнопка «☰»
// поруч із полем вводу в Telegram). Telegram приймає в меню лише латиницю —
// українські назви йдуть описом; текстова reply-клавіатура (українською) і
// розпізнавання `/комора`, «Комора» тощо — окремо, у telegram-nomodel.ts.
//
//   TELEGRAM_BOT_TOKEN=… pnpm exec tsx scripts/telegram-set-commands.mts        # прод-бот
//   TELEGRAM_DEV_BOT_TOKEN=… pnpm exec tsx scripts/telegram-set-commands.mts --dev
//
// Не з лямбди — той самий IPv4-агент (undici), що бот, бо голий `fetch` до
// api.telegram.org з деяких мереж висить (хотфікс №3, 13.09).
import { config } from '../services/api/node_modules/dotenv/lib/main.js';
config();
const isDev = process.argv.includes('--dev');
const token = isDev ? process.env.TELEGRAM_DEV_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error(`telegram-set-commands: нема ${isDev ? 'TELEGRAM_DEV_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'} у .env`); process.exit(1); }

const { telegramFetch } = await import('../services/api/src/telegram-bot.ts');

const commands = [
  { command: 'pantry', description: 'Комора' },
  { command: 'list', description: 'Список' },
  { command: 'recipes', description: 'Рецепти' },
  { command: 'home', description: 'Дім зараз' },
  { command: 'web', description: 'Відкрити у вебі' },
  { command: 'stop', description: 'Відключити' },
];
const r = await telegramFetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands }),
});
const j = await r.json();
console.log('telegram-set-commands:', r.status, JSON.stringify(j));
if (!r.ok || j.ok !== true) process.exit(1);
