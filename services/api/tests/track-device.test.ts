// Крок А1: пристрій у подіях.
//
// Пілотна людина знайшла на телефоні баг — у картці «Про тебе» не вводиться
// текст, — і продукт про це не знав і не міг знати. Тихий провал на одному
// класі пристроїв був невидимий за побудовою.
//
// Ламається це тихо у двох місцях: якщо пристрій не доїжджає до рядків
// (стовпчик порожній, і ніхто не помічає), і якщо конверт БЕЗ пристрою валить
// запис — у людини може бути відкрита стара вкладка, і її день ми через це
// втратили б цілком.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { readDeviceEnvelope } from '../src/routes/track.js';
import { signIn, type Signed } from './helpers.js';

describe('POST /v1/events/track: пристрій', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    me = await signIn(app, mailer, 'dev@example.com');
  });

  const post = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/v1/events/track', headers: { cookie: me.cookie }, payload: payload as object });
  const saved = () => repo.listAppEvents(me.user_id, {
    from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), limit: 50,
  });

  it('подія несе клас пристрою й ширину', async () => {
    await post({
      events: [{ name: 'onboarding_started' }],
      device: { w: 390, class: 'mobile', ua: 'Safari · iOS' },
    });
    const [e] = await saved();
    expect(e!.viewport_w).toBe(390);
    expect(e!.device_class).toBe('mobile');
    expect(e!.ua_family).toBe('Safari · iOS');
  });

  it('пристрій із конверта лягає на ВСІ рядки пачки, не лише на перший', async () => {
    await post({
      events: [
        { name: 'welcome_started' },
        { name: 'welcome_card_reached', props: { card: 1 } },
        { name: 'welcome_skipped', props: { card: 2 } },
      ],
      device: { w: 1440, class: 'desktop', ua: 'Chrome · macOS' },
    });
    const rows = await saved();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.device_class === 'desktop' && r.viewport_w === 1440)).toBe(true);
  });

  it('конверт БЕЗ пристрою записується нормально — стара вкладка не втрачає дня', async () => {
    const r = await post({ events: [{ name: 'pantry_opened' }] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accepted: 1 });
    const [e] = await saved();
    expect(e!.name).toBe('pantry_opened');
    expect(e!.viewport_w).toBeNull();
    expect(e!.device_class).toBeNull();
    expect(e!.ua_family).toBeNull();
  });

  it('нові події знайомства й «Про тебе» приймаються', async () => {
    const names = [
      'welcome_started', 'welcome_card_reached', 'welcome_finished', 'welcome_skipped',
      'onboarding_started', 'onboarding_panel_reached', 'onboarding_finished', 'onboarding_skipped',
    ];
    const r = await post({ events: names.map((name) => ({ name })) });
    expect(r.json()).toEqual({ accepted: names.length });
  });

  it('у props нових подій — тільки номер, нічого більше', async () => {
    await post({ events: [
      { name: 'welcome_card_reached', props: { card: 7 } },
      { name: 'onboarding_panel_reached', props: { panel: 3 } },
      { name: 'onboarding_skipped', props: { panel: 5 } },
    ] });
    const rows = await saved();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.props]));
    expect(byName.welcome_card_reached).toEqual({ card: 7 });
    expect(byName.onboarding_panel_reached).toEqual({ panel: 3 });
    expect(byName.onboarding_skipped).toEqual({ panel: 5 });
  });
});

describe('readDeviceEnvelope', () => {
  it('порожній конверт — три null, а не викид', () => {
    expect(readDeviceEnvelope(undefined)).toEqual({ viewport_w: null, device_class: null, ua_family: null });
  });

  it('чужий клас у стовпчик не потрапляє', () => {
    // Стовпчик, за яким рахуватимуть, мусить лишатись закритим списком —
    // так само, як імена подій. Ширина при цьому вціліла: вона тут правда.
    const d = readDeviceEnvelope({ w: 390, class: 'смартфон', ua: 'x' });
    expect(d.device_class).toBeNull();
    expect(d.viewport_w).toBe(390);
  });

  it('несусвітня ширина відкидається, дробова округляється', () => {
    expect(readDeviceEnvelope({ w: -5 }).viewport_w).toBeNull();
    expect(readDeviceEnvelope({ w: 0 }).viewport_w).toBeNull();
    expect(readDeviceEnvelope({ w: '390' }).viewport_w).toBeNull();
    expect(readDeviceEnvelope({ w: 390.6 }).viewport_w).toBe(391);
  });

  it('сирий User-Agent не осідає в базі цілком', () => {
    const raw = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(readDeviceEnvelope({ ua: raw }).ua_family!.length).toBeLessThanOrEqual(40);
  });
});
