// «Додати пошту» до акаунта, у якого її нема (Telegram-only) — PR 2
// (TELEGRAM-AUTH-PAY-PLAN-0915). Той самий magic-link конвеєр, що логін,
// лінк лише несе &attach=1: verify не заводить нову сесію, а дописує пошту
// в юзера, з чиєю активною сесією лінк відкрили.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

describe('додати пошту до акаунта без неї', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
  });

  it('без сесії — 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/email/attach/request', payload: { email: 'me@example.com' } });
    expect(res.statusCode).toBe(401);
  });

  it('щасливий шлях: лист із &attach=1, verify без нової сесії дописує пошту в поточного юзера', async () => {
    const me = await signIn(app, mailer, 'owner-before@example.com');
    // Симулюємо акаунт без пошти напряму через repo — реальний шлях (Telegram)
    // ще стаб у PR 2, а логіка attach має працювати незалежно від того, ЯК
    // акаунт спершу зʼявився.
    await repo.updateUserEmail(me.user_id, '');
    const req = await app.inject({
      method: 'POST', url: '/v1/auth/email/attach/request',
      headers: { cookie: me.cookie }, payload: { email: 'new-mail@example.com' },
    });
    expect(req.statusCode).toBe(202);
    const last = mailer.last()!;
    expect(last.link).toContain('&attach=1');
    const url = new URL(last.link);
    const verify = await app.inject({
      method: 'GET', url: `${url.pathname}${url.search}`, headers: { cookie: me.cookie },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ ok: true });
    // Не заводить нову сесію — та сама кука лишається дійсною, кук у відповіді нема.
    expect(verify.headers['set-cookie']).toBeUndefined();
    const user = await repo.getUser(me.user_id);
    expect(user?.email).toBe('new-mail@example.com');
  });

  // Злиття (15.09): зайнята пошта більше не відсікається на запиті — лист іде,
  // відкритий лінк доводить володіння, verify пише конфлікт (підстава для
  // POST /v1/account/merge), а пошта поточного юзера не змінюється.
  it('пошта вже належить іншому акаунту — лист іде, verify 409 + conflict_user_id, пошта не змінюється, конфлікт видно в профілі', async () => {
    const owner = await signIn(app, mailer, 'taken@example.com');
    const me = await signIn(app, mailer, 'owner2@example.com');
    const req = await app.inject({
      method: 'POST', url: '/v1/auth/email/attach/request',
      headers: { cookie: me.cookie }, payload: { email: 'taken@example.com' },
    });
    expect(req.statusCode).toBe(202);
    const url = new URL(mailer.last()!.link);
    const verify = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}`, headers: { cookie: me.cookie } });
    expect(verify.statusCode).toBe(409);
    expect(verify.json()).toMatchObject({ error: 'email_taken', conflict_user_id: owner.user_id });
    expect((await repo.getUser(me.user_id))?.email).toBe('owner2@example.com');
    const conflict = await app.inject({ method: 'GET', url: '/v1/account/conflict', headers: { cookie: me.cookie } });
    expect(conflict.json()).toMatchObject({ kind: 'email', from_user_id: owner.user_id, sole_member: true });
  });

  // Хотфікс 28.09: цей тест закріплював те, що й було вадою — «без куки 401».
  // Саме через це людина з Telegram-акаунтом, яка відкрила лист у іншому
  // браузері, отримала {"error":"no_session"} на цілком законному лінку.
  // Тепер лінк працює: замовника памʼятає сам challenge.
  it('лінк відкритий без активної сесії — пошта таки привʼязується до замовника', async () => {
    const me = await signIn(app, mailer, 'has-session@example.com');
    await repo.updateUserEmail(me.user_id, '');
    await app.inject({
      method: 'POST', url: '/v1/auth/email/attach/request',
      headers: { cookie: me.cookie }, payload: { email: 'no-cookie@example.com' },
    });
    const last = mailer.last()!;
    const url = new URL(last.link);
    const verify = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(verify.statusCode).toBe(200);
    const user = await repo.getUser(me.user_id);
    expect(user?.email).toBe('no-cookie@example.com');
  });

  // А ось challenge БЕЗ замовника (такі лишились у польоті на момент
  // деплою, і такі приходять із чужих рук) працювати не мусить.
  it('challenge без замовника — 401, як і було', async () => {
    const me = await signIn(app, mailer, 'legacy@example.com');
    await repo.updateUserEmail(me.user_id, '');
    await app.inject({
      method: 'POST', url: '/v1/auth/email/attach/request',
      headers: { cookie: me.cookie }, payload: { email: 'legacy-mail@example.com' },
    });
    const url = new URL(mailer.last()!.link);
    // Стираємо замовника — так виглядають challenge, створені до хотфіксу.
    const hash = [...(repo as unknown as { challenges: Map<string, { id: string; token_hash: string }> }).challenges.values()].at(-1)!;
    await repo.attachChallengeUser(hash.id, null as unknown as string);
    const verify = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(verify.statusCode).toBe(401);
    expect((await repo.getUser(me.user_id))?.email).toBe('');
  });

  it('вже своя пошта (той самий юзер) — ідемпотентно ok, без помилки email_taken', async () => {
    const me = await signIn(app, mailer, 'same@example.com');
    const req = await app.inject({
      method: 'POST', url: '/v1/auth/email/attach/request',
      headers: { cookie: me.cookie }, payload: { email: 'same@example.com' },
    });
    expect(req.statusCode).toBe(202);
    const last = mailer.last()!;
    const url = new URL(last.link);
    const verify = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}`, headers: { cookie: me.cookie } });
    expect(verify.statusCode).toBe(200);
  });

  it('невалідна пошта — 400', async () => {
    const me = await signIn(app, mailer, 'valid@example.com');
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/email/attach/request',
      headers: { cookie: me.cookie }, payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('лінк відкрито без сесії або чужою сесією', () => {
    const orderAttach = async (cookie: string, email: string) => {
      const r = await app.inject({
        method: 'POST', url: '/v1/auth/email/attach/request',
        headers: { cookie }, payload: { email },
      });
      expect(r.statusCode).toBe(202);
      const url = new URL(mailer.last()!.link);
      return `${url.pathname}${url.search}`;
    };

    it('замовив A, відкрив без куки → пошта в A, і сесію A нам ставлять', async () => {
      const a = await signIn(app, mailer, 'a-owner@example.com');
      await repo.updateUserEmail(a.user_id, '');
      const link = await orderAttach(a.cookie, 'fresh@example.com');

      // Без cookie — рівно те, що сталось у власника: інший браузер.
      const res = await app.inject({ method: 'GET', url: link });
      expect(res.statusCode).toBe(200);
      expect((await repo.getUser(a.user_id))?.email).toBe('fresh@example.com');

      // Інакше редирект на /profile відкрив би лендінг: сесії в цьому браузері
      // немає, а людина щойно довела, що це вона.
      const setCookie = res.headers['set-cookie'];
      expect(String(Array.isArray(setCookie) ? setCookie[0] : setCookie)).toContain('kos=');
    });

    it('відкрив під кукою ІНШОГО акаунта → 409, нічого не привʼязано', async () => {
      const a = await signIn(app, mailer, 'a2-owner@example.com');
      await repo.updateUserEmail(a.user_id, '');
      const b = await signIn(app, mailer, 'b2-other@example.com');
      const link = await orderAttach(a.cookie, 'fresh2@example.com');

      const res = await app.inject({ method: 'GET', url: link, headers: { cookie: b.cookie } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'other_session' });
      // Ні A, ні B пошти не отримали: мовчки привʼязувати до B не можна, а
      // привʼязувати до A за спиною людини, яка сидить під B, — тим паче.
      expect((await repo.getUser(a.user_id))?.email).toBe('');
      expect((await repo.getUser(b.user_id))?.email).toBe('b2-other@example.com');
    });

    it('браузеру жодного JSON: невідомий токен веде на сторінку, а не в {"error"}', async () => {
      const res = await app.inject({
        method: 'GET', url: '/v1/auth/verify?token=нема-такого&attach=1',
        headers: { accept: 'text/html' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/link/expired');
      expect(res.body).not.toContain('error');
    });

    it('браузеру жодного JSON: чужа сесія теж веде на сторінку', async () => {
      const a = await signIn(app, mailer, 'a3-owner@example.com');
      await repo.updateUserEmail(a.user_id, '');
      const b = await signIn(app, mailer, 'b3-other@example.com');
      const link = await orderAttach(a.cookie, 'fresh3@example.com');
      const res = await app.inject({ method: 'GET', url: link, headers: { cookie: b.cookie, accept: 'text/html' } });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/link/expired');
    });
  });


});
