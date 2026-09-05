// Раунд 4, крок 2: міграція 0023 переносить старий профіль у сім речень.
//
// Ганяється в ОКРЕМІЙ тимчасовій базі на тому самому сервері (PG_TEST_URL
// або контейнер testcontainers — той самий вибір, що в контрактного тесту):
// CREATE DATABASE → міграції 0001–0022 → старі дані → 0023 → DROP DATABASE.
// Так перевіряється саме перенесення, а не «таблиці створились»: у головній
// базі 0023 уже застосована контрактним тестом, і старих даних там нема.
//
// Чому база, а не схема з search_path: PG_TEST_URL — Neon pooler (pgbouncer,
// transaction pooling), і SET search_path протікає на чужі серверні конекшени.
// Перевірено 2026-09-05: після такої проби контрактний тест не бачив
// catalog_ingredient.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { migrate } from '../index.js';
import { noteHash, VETO_PRESETS } from '@kitchen/domain';
import { pickBackend } from './backend.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../../../migrations');

const backend = await pickBackend();

if ('skip' in backend) {
  describe.skip(`міграція 0023 · ${backend.skip}`, () => { it('skipped', () => {}); });
} else {
  const url = backend.url;
  describe('міграція 0023: старий профіль → сім речень', () => {
    const dbname = `mig0023_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    const tmpUrl = (() => { const u = new URL(url); u.pathname = `/${dbname}`; return u.toString(); })();
    let pool: pg.Pool;
    const user_id = randomUUID();
    const bare_user_id = randomUUID();
    const lesson_id = randomUUID();
    const intent_id = randomUUID();
    let before: string;

    beforeAll(async () => {
      await admin.query(`CREATE DATABASE ${dbname}`);
      pool = new pg.Pool({ connectionString: tmpUrl, max: 1 });

      // 0001–0022 з тимчасової теки: раннер читає всю теку.
      before = mkdtempSync(join(tmpdir(), 'kos-mig-'));
      for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f < '0023').sort()) {
        copyFileSync(join(MIGRATIONS, f), join(before, f));
      }
      await migrate(pool, before);

      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)', [user_id, 'Пилип', `p-${user_id}@x.local`]);
      await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1,$2,$3)', [bare_user_id, 'Порожній', `b-${bare_user_id}@x.local`]);
      // Копія прод-профілю власника станом на 2026-09-05 + алергія, «немає»
      // й довгий wish — щоб побачити кому, «Немає:» і обрізку.
      await pool.query(
        `INSERT INTO profile (user_id, allergies, wishes, antipatterns, equipment, traditions, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'2026-09-01T00:00:00Z')`,
        [user_id, ['арахіс', 'селера'],
          ['веганство', 'весь наступний тиждень їсти рибу', 'Пісне на Великий піст'],
          ['кінза', 'не їм мʼяса, птиці, риби, яєць і молочного', 'не їм риби'],
          JSON.stringify({ 'гриль': 'has', 'блендер': 'has', 'мікрохвильовка': 'has', 'занурювальний блендер': 'has', 'духовка': 'lacks' }),
          ['orthodox']],
      );
      await pool.query(
        `INSERT INTO profile (user_id, allergies, wishes, antipatterns, equipment) VALUES ($1,'{}','{}','{}','{}')`,
        [bare_user_id],
      );
      await pool.query(
        `INSERT INTO memory_note (id, user_id, text, recipe_title, rating, pinned, created_at, kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [lesson_id, user_id, 'Пармезан сам солоний, воду солити менше.', 'Феттучіне', 4, false, '2026-09-04T10:00:00Z', 'lesson'],
      );
      await pool.query(
        `INSERT INTO memory_note (id, user_id, text, recipe_title, rating, pinned, created_at, kind)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [intent_id, user_id, 'тунець → seared', null, null, true, '2026-09-03T10:00:00Z', 'intent'],
      );

      // Далі йдуть усі міграції з теки (0023 і новіші — 0024 user.plan…);
      // перевіряємо, що 0023 серед застосованих, а не що вона єдина.
      const res = await migrate(pool, MIGRATIONS);
      expect(res.applied).toContain('0023_profile_v2.sql');
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbname} WITH (FORCE)`);
      await admin.end();
      await backend.stop?.();
      rmSync(before, { recursive: true, force: true });
    });

    const fields = async (uid: string) => {
      const { rows } = await pool.query('SELECT key, text, status FROM profile_text WHERE user_id = $1', [uid]);
      return Object.fromEntries(rows.map((r) => [r.key, { text: r.text, status: r.status }]));
    };

    it('allergy → ban через кому', async () => {
      expect((await fields(user_id)).ban).toEqual({ text: 'арахіс, селера', status: 'filled' });
    });

    it('anti → no; wish зі словника пресетів (веганство, пісне) → теж no', async () => {
      expect((await fields(user_id)).no).toEqual({
        text: 'кінза. не їм мʼяса, птиці, риби, яєць і молочного. не їм риби. веганство. Пісне на Великий піст',
        status: 'filled',
      });
    });

    it('решта wish → love', async () => {
      expect((await fields(user_id)).love).toEqual({ text: 'весь наступний тиждень їсти рибу', status: 'filled' });
    });

    it('equip → kit: є через кому, «Немає:» окремим реченням', async () => {
      expect((await fields(user_id)).kit).toEqual({
        text: 'блендер, гриль, занурювальний блендер, мікрохвильовка. Немає: духовка',
        status: 'filled',
      });
    });

    it('name, meh, when не створюються — читаються як empty', async () => {
      const f = await fields(user_id);
      expect(Object.keys(f).sort()).toEqual(['ban', 'kit', 'love', 'no']);
    });

    it('порожній старий профіль не дає жодного рядка', async () => {
      expect(await fields(bare_user_id)).toEqual({});
    });

    it('note → нотатка від людини з тим самим хешем, що рахує домен; intent → «хотів: …»', async () => {
      const { rows } = await pool.query(
        'SELECT id, text, source, subject, deleted_at, norm_hash, created_at FROM profile_note WHERE user_id = $1 ORDER BY created_at DESC',
        [user_id],
      );
      expect(rows.map((r) => r.id)).toEqual([lesson_id, intent_id]);
      expect(rows[0]).toMatchObject({
        text: 'Пармезан сам солоний, воду солити менше.', source: 'user', subject: null, deleted_at: null,
        norm_hash: noteHash('Пармезан сам солоний, воду солити менше.'),
      });
      expect(rows[1]).toMatchObject({ text: 'хотів: тунець → seared', norm_hash: noteHash('хотів: тунець → seared') });
    });

    it('стара таблиця profile і memory_note не чіпаються; traditions лишаються там', async () => {
      const { rows } = await pool.query('SELECT traditions, wishes FROM profile WHERE user_id = $1', [user_id]);
      expect(rows[0]).toEqual({ traditions: ['orthodox'], wishes: ['веганство', 'весь наступний тиждень їсти рибу', 'Пісне на Великий піст'] });
      const { rows: mn } = await pool.query('SELECT count(*)::int AS n FROM memory_note WHERE user_id = $1', [user_id]);
      expect(mn[0].n).toBe(2);
    });

    it('veto_index після міграції порожній — індекс будує крок 4', async () => {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM veto_index');
      expect(rows[0].n).toBe(0);
    });

    it('стеми пресетів у SQL — ті самі, що VETO_PRESETS у домені', async () => {
      const { readFileSync } = await import('node:fs');
      const sql = readFileSync(join(MIGRATIONS, '0023_profile_v2.sql'), 'utf-8');
      const inSql = /~ '\(([^)]*)\)'/.exec(sql)?.[1]?.split('|') ?? [];
      const inDomain = VETO_PRESETS.flatMap((p) => p.stems);
      expect(inSql.sort()).toEqual([...inDomain].sort());
    });
  });
}
