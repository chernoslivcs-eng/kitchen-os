// Одноразове очищення дублів інциденту s41 (02.09.2026, ~21:09–21:13 Київ).
//
// Два чеки Metro розібрались тричі: attachment_parse (79 ops), повтор через
// chat (58 ops) і ще раз — у проді 195 активних партій, з них 167 дублі
// (58 назв ×3). Репіт-гард (audit/round-2) запобігає новим; це прибирає старі.
//
// Правило злиття: у межах ОДНОГО дому партії з однаковим ключем
// (label нормалізований + unit + zone), створені у вікні інциденту,
// зливаються в одну — лишається НАЙСТАРІША (перший, справжній розбір),
// решта помічаються depleted з last_action='dedupe-s41'. Не видаляємо:
// ті самі правила, що для «Прибрати з комори» — в історії лишається.
//
// Кількості НЕ додаються: дубль — це не друга покупка, а той самий рядок чека.
//
// Запуск — із packages/db (там живе pg; ESM резолвить від шляху файлу, не від cwd):
//   cd packages/db
//   DRY_RUN=1 node --experimental-strip-types scripts/dedupe-s41-batches.mts   # лише показати
//   node --experimental-strip-types scripts/dedupe-s41-batches.mts             # застосувати
// Потрібен PG_URL у середовищі (.env). Лише один дім: HOUSEHOLD_ID або email власника через OWNER_EMAIL.
// Відкат: update pantry_batch set state='sealed', depleted_at=null where last_action='dedupe-s41';
// Dry-run 04.09.2026: 195 активних у вікні → 86 лишити · 109 злити.

import pg from 'pg';

const DRY = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const FROM = process.env.WINDOW_FROM ?? '2026-09-02T18:00:00Z'; // 21:00 Київ
const TO = process.env.WINDOW_TO ?? '2026-09-02T18:20:00Z';   // 21:20 Київ

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();

const client = new pg.Client({ connectionString: process.env.PG_URL });
await client.connect();

let householdId = process.env.HOUSEHOLD_ID;
if (!householdId) {
  const email = process.env.OWNER_EMAIL ?? 'chernosliv.cs@gmail.com';
  const r = await client.query(
    `select hm.household_id from "user" u join household_member hm on hm.user_id = u.id where u.email = $1 limit 1`,
    [email],
  );
  householdId = r.rows[0]?.household_id;
  if (!householdId) throw new Error(`household for ${email} not found`);
}

const { rows } = await client.query(
  `select id, label, unit, zone, value, provenance, added_at
     from pantry_batch
    where household_id = $1 and state <> 'depleted'
      and added_at >= $2 and added_at < $3
    order by added_at asc`,
  [householdId, FROM, TO],
);

const groups = new Map<string, typeof rows>();
for (const b of rows) {
  const key = `${norm(b.label)}|${b.unit ?? ''}|${b.zone ?? ''}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(b);
}

const keep: string[] = [];
const drop: { id: string; label: string; added_at: string }[] = [];
for (const [, g] of groups) {
  keep.push(g[0].id);
  for (const b of g.slice(1)) drop.push({ id: b.id, label: b.label, added_at: b.added_at });
}

console.log(`дім ${householdId} · вікно ${FROM} → ${TO}`);
console.log(`активних партій у вікні: ${rows.length} · унікальних ключів: ${groups.size} · лишається: ${keep.length} · злити: ${drop.length}`);
for (const [key, g] of groups) if (g.length > 1) console.log(`  ×${g.length}  ${g[0].label}`);

if (DRY) {
  console.log('\nDRY_RUN — нічого не змінено.');
} else if (drop.length) {
  await client.query('begin');
  const r = await client.query(
    `update pantry_batch set state = 'depleted', depleted_at = now(), last_action = 'dedupe-s41'
      where id = any($1::uuid[]) and state <> 'depleted'`,
    [drop.map((d) => d.id)],
  );
  await client.query('commit');
  console.log(`\nпозначено depleted: ${r.rowCount}`);
}
await client.end();
