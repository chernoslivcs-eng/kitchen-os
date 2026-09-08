// Крок А4: гроші розрізами й прогноз.
//
// Що тут ламається тихо і дорого — усе три речі про ДОВІРУ до числа:
//
//   — стаб потрапляє в гроші. Стабові виклики це тести: нуль токенів, нуль
//     доларів. У середніх вони розмивають картину так, що «хід коштує $0.002»
//     означає лише «половина ходів була підробкою»;
//   — невідома модель рахується нулем. «Нуль доларів» читається як
//     «безкоштовно», а це інша новина, ніж «я не знаю ціни»;
//   — межі періоду беруться в UTC. Тоді вночі власник бачить порожній місяць і
//     вирішує, що продуктом не користуються.
//
// І одна про ціну самої сторінки: агрегати мусить рахувати SQL. Цикл по домах
// на вісімдесяти домах уб'є і сторінку, і базу, з якої в ту саму мить хтось
// вантажить свою комору.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { InMemoryRepo, type TokenUsageRow } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

const HAIKU = 'claude-haiku-4-5';

describe('GET /v1/admin/money', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let owner: Signed;

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    process.env.ADMIN_EMAILS = 'owner@kitchen.local';
    owner = await signIn(app, mailer, 'owner@kitchen.local');
  });

  /** Рядок обліку. За замовчуванням — живий haiku на мільйон вхідних = $1.00. */
  const usage = (over: Partial<TokenUsageRow> = {}): TokenUsageRow => ({
    id: randomUUID(),
    user_id: owner.user_id,
    household_id: owner.household_id,
    call: 'chat',
    profile: 'fast',
    model: HAIKU,
    prompt_version: 'test',
    mode: 'live',
    input_tokens: 1_000_000,
    output_tokens: 0,
    cached_tokens: 0,
    latency_ms: 1000,
    prompt_hash: null,
    prompt_chars: null,
    message_id: null,
    session_id: null,
    cache_write_tokens: null,
    created_at: new Date().toISOString(),
    ...over,
  });

  const money = (qs = '') => app.inject({
    method: 'GET', url: `/v1/admin/money${qs}`, headers: { cookie: owner.cookie },
  });

  it('стороннього не пускає — 404, а не 403', async () => {
    const stranger = await signIn(app, mailer, 'stranger@kitchen.local');
    const r = await app.inject({ method: 'GET', url: '/v1/admin/money', headers: { cookie: stranger.cookie } });
    expect(r.statusCode).toBe(404);
  });

  it('розріз за типом виклику дає ТІ САМІ суми, що загальний підсумок', async () => {
    await repo.logTokenUsage(usage({ call: 'chat' }));
    await repo.logTokenUsage(usage({ call: 'attachment_parse', input_tokens: 3_000_000 }));
    await repo.logTokenUsage(usage({ call: 'recipe_gen', input_tokens: 500_000 }));

    const b = (await money()).json();
    const sliceSum = b.byCall.reduce((n: number, s: { usd: number }) => n + s.usd, 0);
    const sliceCalls = b.byCall.reduce((n: number, s: { calls: number }) => n + s.calls, 0);
    // Розріз, який не сходиться з підсумком, гірший за відсутність розрізу:
    // він виглядає як факт.
    expect(sliceSum).toBeCloseTo(b.totals.usd, 6);
    expect(sliceCalls).toBe(b.totals.calls);
    expect(b.totals.usd).toBeCloseTo(4.5, 6);
  });

  it('ціна ОДНОГО виклику — те число, заради якого блок існує', async () => {
    // Один розбір чека коштує як десять питань про олію — саме це має бути
    // видно, а не спільна сума.
    await repo.logTokenUsage(usage({ call: 'chat', input_tokens: 100_000 }));
    await repo.logTokenUsage(usage({ call: 'chat', input_tokens: 100_000 }));
    await repo.logTokenUsage(usage({ call: 'attachment_parse', input_tokens: 2_000_000 }));

    const b = (await money()).json();
    const chat = b.byCall.find((s: { key: string }) => s.key === 'chat');
    const parse = b.byCall.find((s: { key: string }) => s.key === 'attachment_parse');
    expect(chat.usd_per_call).toBeCloseTo(0.1, 6);
    expect(parse.usd_per_call).toBeCloseTo(2.0, 6);
  });

  it('стаб у гроші не входить — але видно, що виклики були', async () => {
    await repo.logTokenUsage(usage());
    await repo.logTokenUsage(usage({ mode: 'stub', profile: 'stub', model: 'stub', input_tokens: 0 }));
    await repo.logTokenUsage(usage({ mode: 'stub', profile: 'stub', model: 'stub', input_tokens: 0 }));

    const b = (await money()).json();
    expect(b.totals.usd).toBeCloseTo(1.0, 6);
    expect(b.totals.calls).toBe(1);
    // Не «зникли»: інакше здавалось би, що викликів було менше, ніж було.
    expect(b.totals.stub_calls).toBe(2);
    expect(b.byCall.reduce((n: number, s: { calls: number }) => n + s.calls, 0)).toBe(1);
  });

  it('невідома модель — «не знаємо», а НЕ нуль', async () => {
    await repo.logTokenUsage(usage());
    await repo.logTokenUsage(usage({ model: 'llama-3-70b', input_tokens: 9_000_000 }));

    const b = (await money()).json();
    // Дев'ять мільйонів токенів невідомої моделі не мають додати нуль доларів
    // до суми: «нуль» читається як «безкоштовно».
    expect(b.totals.usd).toBeCloseTo(1.0, 6);
    expect(b.totals.unpriced_calls).toBe(1);
    const unknown = b.byModel.find((s: { key: string }) => s.key === 'llama-3-70b');
    expect(unknown.unpriced_calls).toBe(1);
    // І ціна одного виклику для неї — саме null, а не нуль.
    expect(unknown.usd_per_call).toBeNull();
  });

  it('технічні доми виключені з собівартості — і повертаються перемикачем', async () => {
    const qa = await signIn(app, mailer, 'qa7-a@example.com');
    await repo.logTokenUsage(usage());
    await repo.logTokenUsage(usage({ user_id: qa.user_id, household_id: qa.household_id, input_tokens: 5_000_000 }));

    const without = (await money()).json();
    expect(without.totals.usd).toBeCloseTo(1.0, 6);
    expect(without.byHousehold).toHaveLength(1);

    const with_ = (await money('?technical=1')).json();
    expect(with_.totals.usd).toBeCloseTo(6.0, 6);
    expect(with_.byHousehold).toHaveLength(2);
    expect(with_.technical_included).toBe(true);
  });

  it('порівняння з попереднім періодом — воно каже більше за саме число', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await repo.logTokenUsage(usage());
    await repo.logTokenUsage(usage({ input_tokens: 2_000_000, created_at: yesterday.toISOString() }));

    const b = (await money('?period=day')).json();
    expect(b.totals.usd).toBeCloseTo(1.0, 6);
    expect(b.previous.usd).toBeCloseTo(2.0, 6);
  });

  it('ціна ХОДА — сума рядків одного message_id, не найбільший із них', async () => {
    // Одне звернення до /v1/chat дає кілька викликів під тим самим id: сам
    // чат, генерація рецепта всередині нього, повтор після вето. Типи виклику
    // РІЗНІ — і саме тому вони лягають у різні групи, а не складаються в SQL.
    const mid = randomUUID();
    await repo.logTokenUsage(usage({ message_id: mid, call: 'chat', input_tokens: 600_000 }));
    await repo.logTokenUsage(usage({ message_id: mid, call: 'recipe_gen', input_tokens: 400_000 }));

    const b = (await money()).json();
    expect(b.avg.turns).toBe(1);
    // Сума — $1.00. Найбільший із рядків дав би $0.60, і хід виглядав би
    // дешевшим, ніж він є.
    expect(b.avg.usd_per_turn).toBeCloseTo(1.0, 6);
  });

  it('скільки чекала людина — не міряємо, і сторінка каже це прямо', async () => {
    await repo.logTokenUsage(usage());
    const b = (await money()).json();
    // Заливка фото, розбір і малювання картки поза виміром. Показати тут
    // латентність моделі як «людина чекала» було б неправдою.
    expect(b.avg.human_wait_ms).toBeNull();
    expect(b.avg.latency_avg_ms).toBe(1000);
  });

  it('ходи діляться на дні, КОЛИ ПИСАЛИ, а не на всі дні періоду', async () => {
    // Інакше на пілоті це ділення на тишу: місяць має тридцять днів, а людина
    // писала два, і середнє впало б у нуль не через продукт.
    await repo.logTokenUsage(usage({ message_id: randomUUID() }));
    await repo.logTokenUsage(usage({ message_id: randomUUID() }));
    const b = (await money('?period=month')).json();
    expect(b.avg.person_days).toBe(1);
    expect(b.avg.turns_per_person_day).toBeCloseTo(2, 2);
  });

  it('межі періоду МІСЦЕВІ, не UTC — інакше вночі власник бачить порожньо', async () => {
    // Різниця видно лише в години, коли місцева дата вже нова, а UTC ще ні —
    // тобто рівно тоді, коли цю сторінку й відкривають. Щоб тест ловив це
    // завжди, а не залежав від поясу машини, пояс і час задаємо самі:
    // 2026-09-07 22:00 UTC — це вже 8 вересня в Токіо.
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T22:00:00Z'));
    try {
      // Виклик «щойно»: 8 вересня за Токіо, 7-ме за UTC.
      await repo.logTokenUsage(usage({ created_at: new Date('2026-09-07T22:30:00Z').toISOString() }));
      const b = (await money('?period=day')).json();
      // День без параметра — місцевий, тобто 8-ме. Рядок мусить бути в ньому.
      expect(b.day).toBe('2026-09-08');
      expect(b.totals.calls).toBe(1);
      // І межі періоду теж місцеві: доба починається о 00:00 в Токіо.
      expect(new Date(b.from).toISOString()).toBe('2026-09-07T15:00:00.000Z');
    } finally {
      vi.useRealTimers();
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it('сторінка робить РІВНО два звертання по гроші — агрегати, не цикл', async () => {
    // Головна технічна вимога кроку. Поруч, у pulse.ts, лежить приклад того,
    // як не треба: цикл по учасниках із запитом на кожне повідомлення. Якщо
    // хтось повернеться до циклу, зростуть саме ці лічильники.
    const qa = await signIn(app, mailer, 'other@kitchen.local');
    await repo.logTokenUsage(usage());
    await repo.logTokenUsage(usage({ user_id: qa.user_id, household_id: qa.household_id }));

    const groups = vi.spyOn(repo, 'adminMoneyGroups');
    const averages = vi.spyOn(repo, 'adminMoneyAverages');
    // Методи, якими цикл робився б, якби хтось його написав.
    const perHousehold = vi.spyOn(repo, 'listTokenUsageForHousehold');
    const perUser = vi.spyOn(repo, 'listTokenUsage');
    const members = vi.spyOn(repo, 'listMembersOfHousehold');

    await money('?period=month');

    expect(groups).toHaveBeenCalledTimes(1);
    expect(averages).toHaveBeenCalledTimes(1);
    // Два доми в даних — і жодного звертання «на дім» чи «на людину».
    expect(perHousehold).not.toHaveBeenCalled();
    expect(perUser).not.toHaveBeenCalled();
    expect(members).not.toHaveBeenCalled();
  });

  it('частка кешу рахується від ВХІД + КЕШ — «256%» бути не може', async () => {
    // Кеш і вхід — два окремі лічильники. Зі старим знаменником (самим лише
    // входом) частка виходила більшою за сто відсотків, і це показувало не
    // економію, а плутанину.
    await repo.logTokenUsage(usage({ input_tokens: 2_000, cached_tokens: 22_000 }));
    const b = (await money()).json();
    expect(b.totals.cached_share).toBeGreaterThan(0);
    expect(b.totals.cached_share).toBeLessThanOrEqual(1);
    expect(b.totals.cached_share).toBeCloseTo(22_000 / 24_000, 6);
  });

  it('сума по РОЗРІЗАХ дорівнює сумі по РЯДКАХ — на цьому сходяться екрани', async () => {
    // Зведення ставить ціну на згорнутих групах, Пульс — на рядках. Поки
    // формула була нелінійною, вони розходились на 25% за той самий день.
    // Суміш навмисна: рядки, де кеш більший за вхід, І рядок без кешу зовсім.
    // Саме на такій суміші нелінійна формула й розходиться — якщо всі рядки
    // затискаються однаково, група випадково збігається з сумою, і тест
    // мовчить про поламане.
    const rows = [
      { input_tokens: 1_991, cached_tokens: 22_710, output_tokens: 326 },
      { input_tokens: 1_761, cached_tokens: 22_710, output_tokens: 218 },
      { input_tokens: 6_942, cached_tokens: 22_372, output_tokens: 356 },
      { input_tokens: 500_000, cached_tokens: 0, output_tokens: 1_000 },
    ];
    for (const r of rows) await repo.logTokenUsage(usage(r));

    const { priceOf } = await import('../src/pricing.js');
    const perRow = rows.reduce((n, r) => n + (priceOf({ model: HAIKU, ...r }) ?? 0), 0);

    const b = (await money()).json();
    expect(b.totals.usd).toBeCloseTo(perRow, 6);
    const sliceSum = b.byCall.reduce((n: number, s: { usd: number }) => n + s.usd, 0);
    expect(sliceSum).toBeCloseTo(perRow, 6);
  });

  it('розрізи за домом і людиною названі імʼям, а не uuid', async () => {
    // Розріз без імен технічно правильний і непридатний для читання: власник
    // не впізнає в ньому нікого.
    await repo.logTokenUsage(usage());
    const b = (await money()).json();
    expect(b.byHousehold[0].label).not.toMatch(/^[0-9a-f]{8}-/);
    expect(b.byHousehold[0].label).toContain('Дім');
    expect(b.byPerson[0].label).not.toMatch(/^[0-9a-f]{8}-/);
  });

  it('запис у кеш видно окремо — це найдорожчий рід вхідних', async () => {
    await repo.logTokenUsage(usage({ input_tokens: 1_420, cached_tokens: 0, cache_write_tokens: 22_700, output_tokens: 220 }));
    const b = (await money()).json();
    expect(b.totals.cache_write_tokens).toBe(22_700);
    expect(b.totals.cache_write_usd).toBeGreaterThan(0);
    // Це частина загальної суми, а не додаток до неї.
    expect(b.totals.cache_write_usd).toBeLessThanOrEqual(b.totals.usd);
  });

  it('рядок без запису (null) рахується як нуль записаних і не валить сторінку', async () => {
    // Усе, що записано до міграції 0032. Порахувати їх уже нема з чого.
    await repo.logTokenUsage(usage({ cache_write_tokens: null }));
    const r = await money();
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.totals.cache_write_tokens).toBe(0);
    expect(b.totals.calls_without_write).toBe(1);
  });

  it('період із старими рядками помічений як НЕПОВНИЙ, а не показаний як повний', async () => {
    // Мовчати тут не можна: занижене число виглядає точно так само, як повне.
    await repo.logTokenUsage(usage({ cache_write_tokens: null }));
    await repo.logTokenUsage(usage({ cache_write_tokens: 5_000 }));
    const b = (await money()).json();
    expect(b.totals.calls).toBe(2);
    expect(b.totals.calls_without_write).toBe(1);
    expect(b.cache_write_since).toBeTruthy();
  });

  // Крок А4б: числа мають сходитись із рахунком, і це має бути видно оком.
  //
  // Звірка Зведення за 8 вересня з рядками OpenRouter: гроші зійшлись
  // ($0,5866 проти $0,5874 — уся різниця в округленні самих рядків рахунку),
  // а головне число токенів було занижене в 6,4 раза: 35 742 проти 227 744.
  // У нього не входили ні прочитані з кешу, ні записані в нього.
  it('головне число входу = свіжі + прочитані + записані', async () => {
    await repo.logTokenUsage(usage({
      input_tokens: 12_841, cached_tokens: 22_372, cache_write_tokens: 22_372, output_tokens: 1_323,
    }));
    const b = (await money()).json();
    expect(b.totals.input_tokens).toBe(12_841);          // самі свіжі, як було
    expect(b.totals.input_all_tokens).toBe(57_585);      // те, що показує рахунок
    expect(b.totals.input_all_tokens).toBe(
      b.totals.input_tokens + b.totals.cached_tokens + b.totals.cache_write_tokens,
    );
  });

  it('частка кешу рахується від УСЬОГО входу — того самого, що в рахунку', async () => {
    // День 8 вересня: 112 198 прочитаних із 227 744 вхідних. OpenRouter каже
    // 49,3%; наш старий знаменник (без записаних) давав 76%. Обидва числа
    // арифметично чесні — але звірятись ми маємо з рахунком.
    await repo.logTokenUsage(usage({
      input_tokens: 35_742, cached_tokens: 112_198, cache_write_tokens: 79_804, output_tokens: 9_819,
    }));
    const b = (await money()).json();
    expect(b.totals.input_all_tokens).toBe(227_744);
    expect(b.totals.cached_share).toBeCloseTo(112_198 / 227_744, 6);
    expect(Math.round(b.totals.cached_share * 100)).toBe(49);
  });

  it('рядок звірки дає ТІ САМІ п\'ять величин, що й підсумок блоку', async () => {
    // Це не другий підсумок, а вигляд наявного. Розійдуться — і звірка з
    // рахунком почне доводити не те, що показано на екрані.
    await repo.logTokenUsage(usage({
      input_tokens: 1_000, cached_tokens: 2_000, cache_write_tokens: 3_000, output_tokens: 400,
    }));
    const b = (await money()).json();
    expect(b.reconcile).toEqual({
      calls: b.totals.calls,
      input_tokens: b.totals.input_all_tokens,
      output_tokens: b.totals.output_tokens,
      cached_share: b.totals.cached_share,
      usd: b.totals.usd,
    });
  });

  it('старий рядок, у якому кілька викликів злиті в один, не валить сторінку', async () => {
    // Такий рядок нічим не відрізняється від чесного — саме тому перерахувати
    // його заднім числом і неможливо. Сторінка мусить його показати, а
    // застереження про період приїжджає окремо, датою.
    await repo.logTokenUsage(usage({
      created_at: '2026-09-01T10:00:00.000Z',
      input_tokens: 14_293, cached_tokens: 22_372, cache_write_tokens: 22_372, output_tokens: 1_323,
    }));
    const b = (await money('?period=month&day=2026-09-01')).json();
    expect(b.totals.calls).toBe(1);
    expect(b.calls_split_since).toBe('2026-09-09T00:00:00+03:00');
    // Період почався раніше за розсування — екран має чим сказати це.
    expect(new Date(b.from).getTime()).toBeLessThan(new Date(b.calls_split_since).getTime());
  });

  it('порожній період каже «стільки ще не збирали», а не «нуль»', async () => {
    // Нуль читається як «нічого не витратили». Тому сторінка віддає дату
    // першого обліченого виклику — і клієнт має чим відрізнити одне від іншого.
    const b = (await money('?period=month&day=2020-01-15')).json();
    expect(b.totals.usd).toBe(0);
    expect(b.totals.calls).toBe(0);
    expect(b.collected_since).toBeNull();

    await repo.logTokenUsage(usage());
    const b2 = (await money('?period=month&day=2020-01-15')).json();
    expect(b2.totals.calls).toBe(0);
    // Тепер відомо, що збір почався пізніше за цей місяць.
    expect(b2.collected_since).toBeTruthy();
    expect(new Date(b2.collected_since).getTime()).toBeGreaterThan(new Date(b2.to).getTime());
  });
});
