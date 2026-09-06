// П1: картка period із чату — сервер добудовує, людина підтверджує «Записати»,
// підписки/запис зʼявляються лише після apply. Стаб віддає мінімум, як жива модель.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

describe('POST /v1/chat · картка period', () => {
  let app: ReturnType<typeof buildApp>;
  let repo: InMemoryRepo;
  let me: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer, {});
    me = await signIn(app, mailer, 'period@x.local');
  });

  const chat = async (text: string) => {
    const s = (await app.inject({ method: 'POST', url: '/v1/session', headers: { cookie: me.cookie }, payload: {} })).json() as { session: { id: string } };
    const res = await app.inject({ method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie }, payload: { session_id: s.session.id, text } });
    expect(res.statusCode).toBe(200);
    return res.json() as { card: Record<string, unknown> | null; card_id: string | null; auto_applied: boolean };
  };
  const apply = (id: string, selected?: number[]) =>
    app.inject({ method: 'POST', url: `/v1/cards/${id}/apply`, headers: { cookie: me.cookie }, payload: selected ? { selected } : {} });

  it('«ми католики» → список свят із датами, не застосовується сам; після «Записати» — підписки', async () => {
    const body = await chat('ми католики');
    expect(body.card?.type).toBe('period');
    expect(body.auto_applied).toBe(false);
    const items = body.card?.items as { occasion_id: string; from: string; enabled: boolean }[];
    expect(items.map((i) => i.occasion_id)).toContain('advent');
    expect(items.map((i) => i.occasion_id)).toContain('easter');
    expect(items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.from) && i.enabled === false)).toBe(true);
    expect(await repo.listOccasionSubscriptions(me.household_id)).toEqual([]);

    const r = await apply(body.card_id!);
    expect(r.statusCode).toBe(200);
    const subs = await repo.listOccasionSubscriptions(me.household_id);
    expect(subs.map((s) => s.occasion_id).sort()).toEqual(items.map((i) => i.occasion_id).sort());
    expect(subs.every((s) => s.enabled)).toBe(true);
  });

  it('«не показуй мені кавуни» → одна позиція без галочки; після «Записати» — відписка', async () => {
    const body = await chat('не показуй мені кавуни');
    expect(body.card?.type).toBe('period');
    expect(body.card?.unsubscribe).toBe('melon');
    await apply(body.card_id!);
    expect(await repo.listOccasionSubscriptions(me.household_id)).toEqual([expect.objectContaining({ occasion_id: 'melon', enabled: false })]);
  });

  it('«цей місяць білкова» → дієта з датами від сьогодні, мʼяко; після «Записати» — запис дому', async () => {
    const body = await chat('цей місяць білкова');
    expect(body.card?.type).toBe('period');
    expect(body.card?.kind).toBe('diet');
    const resolved = body.card?.resolved as { from: string; to: string };
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(resolved.from).toBe(iso(new Date()));
    expect(resolved.to > resolved.from).toBe(true);
    expect(await repo.listOwnEvents(me.household_id, me.user_id)).toEqual([]);
    await apply(body.card_id!);
    const mine = await repo.listOwnEvents(me.household_id, me.user_id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'diet', title: 'білкова', strict: false, source: 'chat', from: resolved.from, to: resolved.to });
  });
});
