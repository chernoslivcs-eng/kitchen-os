// 01.09 живий кейс: «а які ще опції в Сільпо є по швепсу?» — це питання про
// наявність, НЕ замовлення (cart_go) і НЕ список покупок (shopping). Модель
// маркує намір карткою retail_search_go (query дослівно), сервер шукає
// живцем і формує репліку з реальних даних текстом — без жодної картки,
// нічого не додається ні в кошик мережі, ні в список покупок.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn, type Signed } from './helpers.js';

function product(id: string, name: string, price: number) {
  return {
    id, name, slug: id, price, oldPrice: null,
    stock: true, available: true, weighted: false, step: 1, companyId: 'c1', branchId: 'b1',
  };
}

describe('чат: retail_search_go → живий пошук наявності текстом, без картки', () => {
  let repo: InMemoryRepo;
  let mailer: ConsoleMailer;
  let app: ReturnType<typeof buildApp>;
  let me: Signed;
  let cartAdds: unknown[];

  beforeEach(async () => {
    repo = new InMemoryRepo();
    mailer = new ConsoleMailer();
    cartAdds = [];
    const found = [
      product('id-1', 'Напій Schweppes Indian Tonic', 33),
      product('id-2', 'Напій Schweppes Pink Tonic', 34),
      product('id-3', 'Вино Шенін Блан', 249), // алкоголь — має відсіятись
    ];
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: found, product: found[0] ?? null })),
            addToCart: async (items: unknown[]) => { cartAdds.push(...items); },
          }),
        },
      },
    });
    await app.ready();
    me = await signIn(app, mailer, 'me@example.com');
  });

  it('мережа НЕ підключена: чесна репліка в Профіль, жодної картки', async () => {
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/Списк|Підключи/i);
  });

  it('підключена: реплікою перелічує реальні варіанти, нічого не додає в кошик', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/Indian Tonic/);
    expect(body.reply).toMatch(/Pink Tonic/);
    // Алкоголь відсіяний тим самим гібридним фільтром, що й альтернативи кошика.
    expect(body.reply).not.toMatch(/Шенін Блан/);
    expect(cartAdds).toHaveLength(0);

    // Нічого не потрапило ні в кошик мережі, ні в список покупок дому.
    expect(await repo.listShoppingItems(me.household_id)).toHaveLength(0);
  });

  // Живий репро 01.09: «який там вибір?» на швепс повертав ВСІ знайдені
  // (аж 15) одним суцільним реченням через кому — нечитабельний дамп.
  // Репліка мусить бути компактним списком (перенос рядка на позицію) і
  // чесно казати «і ще N», рахуючи саме те, що НЕ показала, а не тільки
  // те, що відсіклось на внутрішньому SEARCH_CAP.
  it('багато варіантів — репліка компактна (перенос рядків, обмежена кількість), чесне «і ще N»', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const many = Array.from({ length: 9 }, (_, i) =>
      product(`id-many-${i}`, `Напій Schweppes смак ${i + 1}`, 30 + i));
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: many, product: many[0] ?? null })),
            addToCart: async () => {},
          }),
        },
      },
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    const body = r.json();
    const lines = body.reply.split('\n');
    // Заголовок + не більше 6 позицій + «і ще N» — не всі 9 одним рядком.
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(body.reply).toMatch(/і ще 3/);
    expect(body.reply).not.toMatch(/смак 9/); // за межею капу на показ
  });

  // M13-ROLE-VOICE п.2: цю репліку склав СЕРВЕР, не модель. Наступного ходу
  // вона їде в модель як частина історії — і без підпису читається як власні
  // слова кухаря («у Сільпо є два» → «у тебе є два»). Підпис зберігається
  // окремим полем, а не в тексті: text рендериться людині в чаті.
  it('серверна репліка підписана джерелом, але людина підпису не бачить', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    const body = r.json();

    const sessions = await repo.listSessionsForUser(me.user_id);
    const msgs = await repo.listMessages(sessions[0]!.id);
    const searchTurn = msgs.find((m) => m.role === 'assistant' && m.text?.includes('Pink Tonic'));

    expect(searchTurn).toBeDefined();
    expect(searchTurn!.source).toBe('retail_search');
    // Підпис живе в полі, не в тексті — інакше людина прочитала б його в чаті.
    expect(searchTurn!.text).not.toMatch(/службова відповідь|асортимент мережі/i);
    expect(body.reply).not.toMatch(/службова відповідь|асортимент мережі/i);
  });

  // Живий репро 01.09: «а які ще опції в сільпо є по тоніках?» повернуло
  // ВИКЛЮЧНО косметику — тонік для обличчя Equilibra, Dr.Sante, Hollyskin,
  // засіб Nard від випадіння волосся. Жодного напою.
  //
  // Фільтр був ні при чому: 'нехарчове' давно в EXCLUSIVE_ROOTS. Косметика
  // приходила до нього вже позначеною як НАПІЙ — у каталозі не було тоніка
  // для обличчя, а підстрокове правило робило «Тонік для обличчя» напоєм
  // drink_tonic. Полагоджено записами hh_face_tonic / hh_hair_tonic.
  it('косметичні тоніки відсіюються з видачі про напій, напій лишається', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    const mixed = [
      product('cos-1', 'Тонік для обличчя Equilibra очищуючий з алое', 219),
      product('cos-2', 'Тонік Nard для контролю випадіння волосся', 449),
      product('cos-3', 'Тонік для обличчя Hollyskin з гліколевою кислотою', 219),
      product('drink-1', 'Напій Schweppes Pink Tonic б/алк сил/газ скло', 34),
    ];
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: mixed, product: mixed[0] ?? null })),
            addToCart: async () => {},
          }),
        },
      },
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по тоніках?' },
    });
    const body = r.json();
    expect(body.reply).not.toMatch(/для обличчя/i);
    expect(body.reply).not.toMatch(/випадіння волосся/i);
    expect(body.reply).toMatch(/Schweppes/);
  });

  it('нічого не знайдено — чесно каже, не мовчить і не вигадує', async () => {
    await app.inject({ method: 'GET', url: '/v1/retail/silpo/connect', headers: { cookie: me.cookie } });
    app = buildApp(repo, new InMemoryStore(), mailer, {
      retail: {
        silpo: {
          clientId: 'c', tokenSecret: 's', devAccessToken: 'dev-token',
          makeProvider: () => ({
            receipts: async () => [],
            findBatch: async (queries: string[]) => queries.map((q) => ({ query: q, candidates: [], product: null })),
            addToCart: async () => {},
          }),
        },
      },
    });
    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'а які ще опції в сільпо є по швепсу?' },
    });
    const body = r.json();
    expect(body.card).toBeNull();
    expect(body.reply).toMatch(/не знайшов|нічого/i);
  });
});
