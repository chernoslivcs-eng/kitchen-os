#!/usr/bin/env npx tsx
// Завершення бети — РАЗОВИЙ скрипт, запускати лише в день запуску оплат і
// лише за словом власника. Він змінює стан УСІХ безкоштовних домів одразу.
//
//   npx tsx scripts/billing/end-beta.mts --dry-run   # лише список, нічого не пише
//   npx tsx scripts/billing/end-beta.mts             # виконує й шле листи
//
// Без --dry-run скрипт вимагає підтвердження словом: набрати кількість домів,
// яку він щойно показав. Це не церемонія — у проді це сотні живих домів, і
// «випадково запустив у не тій вкладці» тут коштує дорого.
//
// База береться з PG_URL (як і решта скриптів). Пошта — з SMTP_* через
// pickMailer(): без них лист піде в консоль, а не людям, і це видно в виводі.
import { createInterface } from 'node:readline/promises';
import { pickRepo } from '../../services/api/src/server.ts';
import { pickMailer } from '../../services/api/src/mailer.ts';
import { planEndBeta, applyEndBeta, END_BETA_GRACE_DAYS } from '../../services/api/src/billing-end-beta.ts';

const dryRun = process.argv.includes('--dry-run');

// Без PG_URL pickRepo() мовчки віддає репозиторій у памʼяті — скрипт відпрацює
// на порожній базі й напише «0 домів». Для разової дії такий «успіх» гірший за
// помилку: людина вирішить, що зачіпати нема кого, і піде далі.
if (!process.env.PG_URL) {
  console.error('PG_URL не заданий — скрипт працював би на порожній базі в памʼяті. Зупиняюсь.');
  process.exit(1);
}
const repo = await pickRepo();
const now = new Date();

const plan = await planEndBeta(repo, now);
console.log(`Домів, які зараз живуть безкоштовно: ${plan.length}`);
console.log(`Після запуску: стан cancelled, доступ до ${plan[0]?.access_until ?? '—'} (${END_BETA_GRACE_DAYS} днів).`);
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

const mailer = pickMailer();
const r = await applyEndBeta({ repo, mailer, appUrl: process.env.APP_URL ?? 'http://localhost:5173', now: () => now });
console.log(`\nГотово: домів ${r.households}, листів ${r.mails}, повідомлень у бот ${r.notes}.`);
console.log(`Далі щоденний крон переведе їх у read_only у дату доступу — окремо запускати нічого не треба.`);
