import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, createPending, applyCard, undoCard, type PantryBatch, type Card } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Раунд 5, крок Ф1: GET /v1/pantry віддає поля для фільтра — cat, БЖВ, days,
// receipt (лише останній чек), no (як ⚠ у промпті), added; нічого не пише.

async function stand() {
  const repo = new InMemoryRepo();
  const mailer = new ConsoleMailer();
  const app = buildApp(repo, new InMemoryStore(), mailer);
  await app.ready();
  const me = await signIn(app, mailer, 'filter@example.com');
  return { repo, app, me };
}
const batch = (household_id: string, label: string, over: Partial<PantryBatch> = {}): PantryBatch => ({
  id: randomUUID(), household_id, catalog_key: null, label, zone: 'fridge', value: 500, unit: 'g', state: 'sealed',
  opened_at: null, expires_at: null, best_before_opened_days: null, added_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  depleted_at: null, confidence: 1, provenance: 'user_statement', staple: false, last_by: null, last_action: null, ...over,
} as PantryBatch);
type Row = PantryBatch & { cat: string | null; kcal: number | null; est: boolean | null; days: number | null; receipt: boolean; no: string | null; added: number; origin: { kind: string; shop: string | null; at: string } };

describe('GET /v1/pantry — поля фільтра', () => {
  it('cat, days, no, added серіалізуються; без каталогу — null', async () => {
    const { repo, app, me } = await stand();
    await repo.patchProfileField(me.user_id, 'no', { text: 'мʼяса' });
    await repo.setVetoIndex(me.user_id, 'no', (await import('@kitchen/domain')).buildVetoIndex(me.user_id, 'no', 'мʼяса'));
    await repo.insertBatch(batch(me.household_id, 'Куряче філе', { catalog_key: 'chicken_fillet', expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }));
    await repo.insertBatch(batch(me.household_id, 'Пармезан', { catalog_key: 'parmesan', zone: 'fridge' }));
    await repo.insertBatch(batch(me.household_id, 'Невідоме xyz', { zone: 'dry' }));
    const res = await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { batches: Row[]; last_receipt_at: string | null };
    const by = (l: string) => body.batches.find((b) => b.label === l)!;
    // Б1: `days` більше не буває null у позиції, яка може псуватись. Філе має
    // ручну дату (2 дні) — вона бʼє і зону, і каталог.
    // Б2: пармезан ручної дати не має, і його строк дає КАТАЛОГ, а не зона —
    // твердий сир живе 60 днів проти плоского 21 у холодильнику, три минуло.
    expect(by('Куряче філе')).toMatchObject({ cat: 'мʼясо', days: 2, no: 'не їм', receipt: false, added: 3, est: false });
    expect(by('Пармезан')).toMatchObject({ cat: 'сири', days: 57, no: null, receipt: false });
    // Позиції поза каталогом строк теж отримують — від зони: dry живе 540 днів.
    expect(by('Невідоме xyz')).toMatchObject({ cat: null, kcal: null, est: null, days: 537, no: null });
    expect(body.last_receipt_at).toBeNull();
  });

  it('receipt — лише партії з ОСТАННЬОГО застосованого чека; скасований чек не рахується', async () => {
    const { repo, app, me } = await stand();
    const receiptCard = (label: string, at: string): Card => ({
      type: 'intake_diff', ops: [{ op: 'add', label, value: 1, unit: 'pcs', zone: 'fridge' }],
      source: { kind: 'chat_receipt', at },
    } as Card);
    const apply = async (card: Card) => {
      const id = randomUUID();
      await createPending(repo, { message_id: id, household_id: me.household_id, user_id: me.user_id, card });
      return { id, r: await applyCard(repo, id, [], me.user_id) };
    };
    // звичайна картка без чека
    await apply({ type: 'intake_diff', ops: [{ op: 'add', label: 'Молоко', value: 1, unit: 'pcs', zone: 'fridge' }] } as Card);
    // перший чек
    await apply(receiptCard('Хліб', '2026-09-01T10:00:00.000Z'));
    // другий чек — останній
    const second = await apply(receiptCard('Сир', '2026-09-03T10:00:00.000Z'));
    // третій чек застосовано й скасовано — не рахується
    const third = await apply(receiptCard('Йогурт', '2026-09-05T10:00:00.000Z'));
    await undoCard(repo, third.id, third.r.undo_token!, me.user_id);

    const body = (await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } })).json() as { batches: Row[]; last_receipt_at: string | null };
    const receipts = body.batches.filter((b) => b.receipt).map((b) => b.label);
    expect(receipts).toEqual(['Сир']);
    expect(body.last_receipt_at).toBe('2026-09-03T10:00:00.000Z');
    void second;
    // Крок Ф2: «звідки» — останній чек з датою чека, решта з розмови/рукою
    const by = (l: string) => body.batches.find((b) => b.label === l)!;
    expect(by('Сир').origin).toEqual({ kind: 'receipt', shop: null, at: '2026-09-03T10:00:00.000Z' });
    expect(by('Молоко').origin.kind).toBe('chat');
  });

  it('origin: «+ Додати» — manual з датою додавання; retail-чек несе магазин', async () => {
    const { repo, app, me } = await stand();
    await app.inject({ method: 'POST', url: '/v1/pantry', headers: { cookie: me.cookie }, payload: { label: 'Сіль', value: 1, unit: 'pack', zone: 'dry' } });
    const id = randomUUID();
    await createPending(repo, { message_id: id, household_id: me.household_id, user_id: me.user_id, card: {
      type: 'intake_diff', ops: [{ op: 'add', label: 'Йогурт', value: 1, unit: 'pcs', zone: 'fridge' }],
      source: { kind: 'retail_receipt', provider: 'silpo', shop: 'Сільпо', at: '2026-09-04T09:00:00.000Z', total: 100, nonfood: [], unmatched: [] },
    } as Card });
    await applyCard(repo, id, [], me.user_id);
    const body = (await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } })).json() as { batches: Row[] };
    const by = (l: string) => body.batches.find((b) => b.label === l)!;
    expect(by('Сіль').origin.kind).toBe('manual');
    expect(by('Йогурт').origin).toEqual({ kind: 'receipt', shop: 'Сільпо', at: '2026-09-04T09:00:00.000Z' });
  });
});

describe('PATCH /v1/pantry/:id — картка (крок Ф2)', () => {
  it('expires_at пишеться і знімається; state opened ставить opened_at, і воно лишається', async () => {
    const { repo, app, me } = await stand();
    const b = batch(me.household_id, 'Молоко');
    await repo.insertBatch(b);
    const set = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/v1/pantry/${b.id}`, headers: { cookie: me.cookie }, payload });
    expect((await set({ expires_at: '2026-09-10' })).statusCode).toBe(200);
    expect((await repo.getBatch(b.id))!.expires_at).toBe('2026-09-10T00:00:00.000Z');
    expect((await set({ expires_at: 'not a date' })).statusCode).toBe(400);
    expect((await set({ expires_at: null })).statusCode).toBe(200);
    expect((await repo.getBatch(b.id))!.expires_at).toBeNull();
    const r = await set({ state: 'opened' });
    const opened = (r.json() as { batch: PantryBatch }).batch.opened_at;
    expect(opened).toBeTruthy();
    // наступна правка кількості не скидає дату відкриття
    await set({ value: 300 });
    expect((await repo.getBatch(b.id))!.opened_at).toBe(opened);
    expect((await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } })).json().batches[0].opened_at).toBe(opened);
  });

  it('Р4: дата з картки підписана ЛЮДИНОЮ, дата з відкриття — правилом каталогу; тест іде через роут', async () => {
    // Контрактний тест у домені пише 'manual' напряму в репозиторій — і тому
    // проходив, коли роут писача ще не ставив. Він міряв, що колонка вміє
    // зберігати слово, а не що картка його ставить. Цей тест іде через
    // PATCH, тобто саме той шар, де «людина» і вирішується.
    const { repo, app, me } = await stand();
    const b = batch(me.household_id, 'Сметана', { catalog_key: 'sour_cream', best_before_opened_days: 5 });
    await repo.insertBatch(b);
    const set = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: `/v1/pantry/${b.id}`, headers: { cookie: me.cookie }, payload });

    // Рука людини — з картки.
    expect((await set({ expires_at: '2026-09-20' })).statusCode).toBe(200);
    expect((await repo.getBatch(b.id))!.expires_source).toBe('manual');
    // І на веб воно виходить тим самим словом — рядок на нього й дивиться.
    const listed = (await app.inject({ method: 'GET', url: '/v1/pantry', headers: { cookie: me.cookie } })).json().batches[0];
    expect(listed.expires_source).toBe('manual');

    // Знято дату — знято й писача: порожня колонка не має лишатись
    // підписаною «поставила людина».
    expect((await set({ expires_at: null })).statusCode).toBe(200);
    expect((await repo.getBatch(b.id))!.expires_source ?? null).toBeNull();

    // Відкриття — писач інший, і той самий expires_at більше не «до 20 вер».
    expect((await set({ state: 'opened' })).statusCode).toBe(200);
    const opened = (await repo.getBatch(b.id))!;
    expect(opened.expires_at).toBeTruthy();
    expect(opened.expires_source).toBe('category');
  });

  it('«Позначити відкритою» запускає годинник — і не подовжує коротший власний строк', async () => {
    // А2, третє місце. Ручна правка стану взагалі не рахувала `expires_at`:
    // «Позначити відкритою» ставило opened_at і мовчки лишало партію без
    // строку, хоч `best_before_opened_days` у неї був. А там, де строк уже
    // стояв, його треба не перезаписати, а взяти менший.
    const { repo, app, me } = await stand();
    const soon = new Date(Date.now() + 1 * 86_400_000).toISOString();

    const fresh = batch(me.household_id, 'Сметана', { best_before_opened_days: 5 });
    await repo.insertBatch(fresh);
    await app.inject({ method: 'PATCH', url: `/v1/pantry/${fresh.id}`, headers: { cookie: me.cookie }, payload: { state: 'opened' } });
    const days = (new Date((await repo.getBatch(fresh.id))!.expires_at!).getTime() - Date.now()) / 86_400_000;
    expect(days, 'годинник стартував на пʼять днів').toBeGreaterThan(4.9);
    expect(days).toBeLessThan(5.1);

    const dying = batch(me.household_id, 'Вершки', { best_before_opened_days: 5, expires_at: soon });
    await repo.insertBatch(dying);
    await app.inject({ method: 'PATCH', url: `/v1/pantry/${dying.id}`, headers: { cookie: me.cookie }, payload: { state: 'opened' } });
    expect((await repo.getBatch(dying.id))!.expires_at, 'власний строк коротший — він і лишається').toBe(soon);
  });
});

describe('причина списання (А1)', () => {
  it('DELETE і PATCH приймають причину; без неї — null, чуже значення — 400', async () => {
    // А1. Метрика питає не «як списали», а «чому»: `last_action` розрізняє
    // спосіб (`user_delete` / `user_edit`), а зʼїдене від зіпсованого — ні.
    //
    // Ключове тут — рядок про null. Обидва шляхи мусять лишати причину
    // порожньою, коли її не передали: дефолт зробив би метрику не
    // відсутньою, а брехливою.
    const { repo, app, me } = await stand();
    const del = (id: string, payload?: Record<string, unknown>) =>
      app.inject({ method: 'DELETE', url: `/v1/pantry/${id}`, headers: { cookie: me.cookie }, payload });

    const rotten = batch(me.household_id, 'Сметана');
    await repo.insertBatch(rotten);
    expect((await del(rotten.id, { reason: 'spoiled' })).statusCode).toBe(200);
    expect((await repo.getBatch(rotten.id))!.depleted_reason).toBe('spoiled');

    const silent = batch(me.household_id, 'Кефір');
    await repo.insertBatch(silent);
    expect((await del(silent.id)).statusCode).toBe(200);
    expect((await repo.getBatch(silent.id))!.state).toBe('depleted');
    expect((await repo.getBatch(silent.id))!.depleted_reason, 'не спитали — не вигадуємо').toBeNull();

    const eaten = batch(me.household_id, 'Йогурт');
    await repo.insertBatch(eaten);
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/v1/pantry/${eaten.id}`, headers: { cookie: me.cookie }, payload });
    expect((await patch({ state: 'depleted', reason: 'eaten' })).statusCode).toBe(200);
    expect((await repo.getBatch(eaten.id))!.depleted_reason).toBe('eaten');

    // Перелік закритий: вільний текст у метрику не потрапляє.
    const bad = batch(me.household_id, 'Молоко');
    await repo.insertBatch(bad);
    expect((await del(bad.id, { reason: 'набридло' })).statusCode).toBe(400);
    expect((await repo.getBatch(bad.id))!.state, 'відмова нічого не списала').toBe('sealed');
  });

  it('повернення партії в комору знімає причину разом зі станом', async () => {
    // Той самий клас, що undo готування: жива партія з міткою «зіпсувалось»
    // порахувалась би вдруге при наступному списанні.
    const { repo, app, me } = await stand();
    const b = batch(me.household_id, 'Вершки');
    await repo.insertBatch(b);
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/v1/pantry/${b.id}`, headers: { cookie: me.cookie }, payload });

    await patch({ state: 'depleted', reason: 'spoiled' });
    expect((await repo.getBatch(b.id))!.depleted_reason).toBe('spoiled');

    await patch({ state: 'sealed' });
    const back = await repo.getBatch(b.id);
    expect(back!.state).toBe('sealed');
    expect(back!.depleted_at).toBeNull();
    expect(back!.depleted_reason, 'причина пішла за станом').toBeNull();
  });
});
