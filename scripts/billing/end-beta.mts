#!/usr/bin/env npx tsx
// Завершення бети — РАЗОВИЙ скрипт, запускати лише в день деплою демо і лише
// за словом власника. Він змінює стан УСІХ безкоштовних домів одразу:
// кожен отримує `demo` на 7 днів і стартове повідомлення (спек 2026-10-01 §3).
//
//   npx tsx scripts/billing/end-beta.mts --dry-run   # лише список, нічого не пише
//   npx tsx scripts/billing/end-beta.mts             # виконує й шле листи
//
// Запускати з кореня репо: .env лежить саме там, і PG_URL із SMTP_* беруться
// звідти самі — експортувати руками нічого не треба.
//
// Без --dry-run скрипт вимагає підтвердження словом: набрати кількість домів,
// яку він щойно показав. Це не церемонія — у проді це сотні живих домів, і
// «випадково запустив у не тій вкладці» тут коштує дорого.
//
// База береться з PG_URL (як і решта скриптів). Пошта — з SMTP_* через
// pickMailer(); без них скрипт зупиняється, бо листи пішли б у консоль, а
// повторити розсилку після зміни станів уже нічим.
import { createInterface } from 'node:readline/promises';
import { pickRepo } from '../../services/api/src/server.ts';
import { pickMailer } from '../../services/api/src/mailer.ts';
import { makeTelegramNotify } from '../../services/api/src/telegram-notify.ts';
import { planEndBeta, applyEndBeta } from '../../services/api/src/billing-end-beta.ts';
import { DEMO_DAYS } from '../../packages/domain/subscription.ts';

const dryRun = process.argv.includes('--dry-run');
const allowNoMail = process.argv.includes('--allow-no-mail');

// Без PG_URL pickRepo() мовчки віддає репозиторій у памʼяті — скрипт відпрацює
// на порожній базі й напише «0 домів». Для разової дії такий «успіх» гірший за
// помилку: людина вирішить, що зачіпати нема кого, і піде далі.
if (!process.env.PG_URL) {
  console.error('PG_URL не заданий — скрипт працював би на порожній базі в памʼяті. Зупиняюсь.');
  process.exit(1);
}
// Мертвий мейлер на разовій дії — найгірший зі збоїв: стани зміняться, листи
// підуть у консоль, а другого шансу не буде. Після запуску planEndBeta
// поверне нуль домів — надіслати їх «ще раз» уже нічим.
//
// Перевірка стоїть ДО підключення до бази навмисно: зупинитись треба раніше,
// ніж ми взагалі щось відкриємо. --dry-run листів не шле, тож його не чіпає.
const mailer = pickMailer();
if (!dryRun && !mailer.delivers && !allowNoMail) {
  console.error('SMTP_HOST не заданий — листи пішли б у консоль, а не людям, і повторити розсилку буде нічим.');
  console.error('Постав SMTP_* (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM) — або, якщо саме цього й хочеш, додай --allow-no-mail.');
  process.exit(1);
}

const repo = await pickRepo();
const now = new Date();

const plan = await planEndBeta(repo, now);
console.log(`Домів, які зараз живуть безкоштовно: ${plan.length}`);
console.log(`Після запуску: стан demo, доступ до ${plan[0]?.demo_ends_at ?? '—'} (${DEMO_DAYS} днів).`);
for (const a of plan) console.log(`  ${a.household_id}  (було: ${a.from ?? 'рядка нема'})`);

if (dryRun) {
  console.log('\n--dry-run: нічого не змінено, листів не надіслано.');
  process.exit(0);
}
if (!plan.length) { console.log('\nНема кого зачіпати.'); process.exit(0); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question(`\nЦе змінить ${plan.length} домів і надішле листи. Набери число ${plan.length}, щоб підтвердити: `)).trim();
rl.close();
if (answer !== String(plan.length)) { console.log('Скасовано.'); process.exit(1); }

// Без цього рядка люди без пошти не отримували нічого, а скрипт друкував
// «повідомлень у бот 0» — не відрізнити від «таких людей немає».
// TELEGRAM_BOT_TOKEN має бути від ПРОДОВОГО бота: chat_id у базі видані ним,
// і чужий бот у ті чати не напише.
const telegramNotify = makeTelegramNotify(repo);
if (!telegramNotify) console.log('TELEGRAM_BOT_TOKEN не заданий — у бот не піде нічого.');
const r = await applyEndBeta({ repo, mailer, appUrl: process.env.APP_URL ?? 'http://localhost:5173', now: () => now, telegramNotify });
console.log(`\nГотово: домів ${r.households}, листів ${r.mails}, повідомлень у бот ${r.notes}.`);
console.log(`Далі щоденний крон сам: за 2 дні до кінця — лист, у дату кінця — read_only. Окремо запускати нічого не треба.`);
