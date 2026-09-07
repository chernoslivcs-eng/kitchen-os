// Крок А1а: інцидент мусить пережити відповідь.
//
// Що саме тут перевіряється і чому не те, що здається.
//
// Заморозку лямбди в тесті не відтворити — Vercel морозить контейнер після
// того, як закрився потік відповіді, і жодного гачка на це немає. Тому
// перевіряємо ЕКВІВАЛЕНТНЕ твердження, з якого заморозка вже не страшна:
// на момент, коли відповідь готова піти, рядок в `app_event` УЖЕ існує.
//
// Ключ до тесту — повільний репозиторій. На швидкому запис устигає й через
// `void`, і різниці не видно: тест зеленів би на зламаному коді. Шістдесят
// мілісекунд затримки роблять різницю однозначною — обробник відповідає за
// одиниці мілісекунд, тож без очікування рядка на момент відповіді просто не
// може бути.
//
// Дві дороги, і друга важливіша за першу. Аварія (5xx) — очевидна. Запобіжник
// у цілком успішній 200 — той рід інциденту, який ми домовились вважати
// важливішим: аварію видно по 5xx в очі, запобіжник не видно нікому. І летить
// він у фоні всередині нормальної відповіді, тобто рівно в те вікно, де
// заморозка його й з'їдала.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, type IntakeCard } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

/** Затримка запису. Довша за будь-який обробник у тесті — і в цьому вся суть. */
const SLOW_MS = 60;

describe('інцидент завершується ДО відправки відповіді', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;

  /** Чи був запис завершений на момент, коли відповідь уже готова піти. */
  let doneAtSend: boolean | undefined;
  /** Чи лишалась на запиті незавершена телеметрія в ту саму мить. */
  let pendingAtSend: number | undefined;
  let written = 0;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    written = 0;
    doneAtSend = undefined;
    pendingAtSend = undefined;

    // Повільний репозиторій — тільки для подій. Решта роботи не гальмується:
    // інакше ми б міряли не те.
    const realSave = repo.saveAppEvents.bind(repo);
    repo.saveAppEvents = async (rows) => {
      await new Promise((r) => setTimeout(r, SLOW_MS));
      await realSave(rows);
      written += rows.length;
    };

    app = buildApp(repo, new InMemoryStore(), mailer, {
      logger: { level: 'error', stream: { write: () => {} } },
    });
    // Пробний хук ПІСЛЯ того, що ставить buildApp: fastify виконує onSend у
    // порядку реєстрації, тож цей бачить світ рівно в ту мить, коли відповідь
    // уже сформована й ось-ось піде.
    app.addHook('onSend', async (req, _reply, payload) => {
      doneAtSend = written > 0;
      pendingAtSend = req.telemetry?.length ?? 0;
      return payload;
    });
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@example.com';
    me = await signIn(app, mailer, 'owner@example.com');
  });
  afterEach(() => { delete process.env.ADMIN_EMAILS; });

  it('аварія (5xx): рядок в app_event уже є, коли відповідь готова піти', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/admin/boom', headers: { cookie: me.cookie } });
    expect(r.statusCode).toBe(500);

    // Головне твердження: не «колись потім», а ДО відправки.
    expect(doneAtSend).toBe(true);
    expect(pendingAtSend).toBe(0);

    // І рядок справді в стрічці дня — без жодного очікування після запиту.
    const rows = await repo.listAppEvents(me.user_id, {
      from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50,
    });
    expect(rows.map((x) => x.name)).toContain('incident:unhandled-route-error');
  });

  it('запобіжник усередині 200: те саме, хоч нічого й не зламалось', async () => {
    // Справжній шлях продукту, не підставний маршрут: картка з операцією на
    // ціль, якої в коморі немає. applyCard рахує це промахом, cards.ts пише
    // guard — і віддає цілком успішні 200.
    const card: IntakeCard = { type: 'intake_diff', ops: [{ op: 'deplete', label: 'манго, якого нема' }] };
    const card_id = randomUUID();
    const session = await repo.createFreshSession(me.user_id, '2026-09-07');
    await repo.saveMessage({
      id: card_id, session_id: session.id, role: 'assistant',
      text: null, card, applied: 0, created_at: new Date().toISOString(),
    });
    await createPending(repo, { message_id: card_id, household_id: me.household_id, user_id: me.user_id, card });

    const r = await app.inject({
      method: 'POST', url: `/v1/cards/${card_id}/apply`,
      headers: { cookie: me.cookie }, payload: {},
    });
    // Саме 200: продукт відпрацював правильно, просто ціль не знайшлась.
    expect(r.statusCode).toBe(200);
    expect(r.json().missed).toHaveLength(1);

    expect(doneAtSend).toBe(true);
    expect(pendingAtSend).toBe(0);
    const rows = await repo.listAppEvents(me.user_id, {
      from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50,
    });
    expect(rows.map((x) => x.name)).toContain('incident:intake-op-missed');
  });

  it('звичайний хід не платить нічого: телеметрії на запиті не заводиться', async () => {
    // Якщо тут з'явиться масив — значить ми почали створювати роботу там, де
    // її немає, і кожна відповідь продукту платить за нашу бухгалтерію.
    const r = await app.inject({ method: 'GET', url: '/v1/auth/providers' });
    expect(r.statusCode).toBe(200);
    expect(pendingAtSend).toBe(0);
    expect(doneAtSend).toBe(false);
    expect(written).toBe(0);
  });

  it('відповідь таки ЧЕКАЄ на запис — а не випереджає його', async () => {
    // Пряме вимірювання: якщо очікування прибрати, відповідь повернеться
    // швидше за повільний репозиторій і цей поріг упаде.
    const t0 = Date.now();
    await app.inject({ method: 'GET', url: '/v1/admin/boom', headers: { cookie: me.cookie } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SLOW_MS);
  });

  it('падіння запису відповідь не валить — телеметрія не має такого права', async () => {
    repo.saveAppEvents = async () => {
      await new Promise((r) => setTimeout(r, SLOW_MS));
      throw new Error('база лягла');
    };
    const r = await app.inject({ method: 'GET', url: '/v1/admin/boom', headers: { cookie: me.cookie } });
    // 500 від самого димового тесту, а не від нашої бухгалтерії.
    expect(r.statusCode).toBe(500);
    expect(r.json().message).toContain('димовий тест символікації');
    // І чекати ми його все одно чекали: черга розібрана, нічого не висить.
    expect(pendingAtSend).toBe(0);
  });
});
