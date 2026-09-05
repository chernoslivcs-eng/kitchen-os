import { describe, it, expect } from 'vitest';
import { extractJson, parseModelResponse, parseAttachmentResponse } from './model-response.js';

// FIX-05: модель іноді видає ДВА верхньорівневі JSON-обʼєкти в одній відповіді.
// Раніше брали перший — другий тікав у reply сирим {…}. Тепер вибираємо той,
// що має валідний type; сирого JSON у residualText не лишається.

describe('extractJson', () => {
  it('чистий JSON', () => {
    const r = extractJson('{"type":"proposal","items":[]}');
    expect((r.parsed as { type: string }).type).toBe('proposal');
    expect(r.residualText).toBe('');
  });

  it('JSON + короткий коментар після', () => {
    const r = extractJson('{"type":"intake_diff","ops":[]} — розкласти?');
    expect((r.parsed as { type: string }).type).toBe('intake_diff');
    expect(r.residualText).toContain('розкласти');
    expect(r.residualText).not.toContain('{');
  });

  it('два JSON: обираємо той із валідним type, сирий не лишається', () => {
    const raw = 'Ось: {"type":"intake_diff","ops":[]} і ще {"type":"proposal","items":[{"title":"X"}]} Обирай.';
    const r = extractJson(raw);
    expect((r.parsed as { type: string }).type).toBe('intake_diff');
    expect(r.residualText).not.toContain('{');
    expect(r.residualText).toContain('Обирай');
  });

  it('обгортка {reply, card} має пріоритет над голими', () => {
    const raw = '{"reply":"Записав","card":{"type":"intake_diff","ops":[]}} {"type":"proposal","items":[]}';
    const r = extractJson(raw);
    const p = r.parsed as { reply?: string; card?: { type: string } };
    expect(p.reply).toBe('Записав');
    expect(p.card?.type).toBe('intake_diff');
  });

  it('JSON зі вкладеною фігурною дужкою + escaped quotes', () => {
    const raw = 'Тест: {"type":"intake_diff","ops":[{"label":"дужка }","evidence":"user_statement"}]}';
    const r = extractJson(raw);
    expect((r.parsed as { type: string }).type).toBe('intake_diff');
  });

  it('без JSON — parsed=null, весь текст у residualText', () => {
    const r = extractJson('привіт, як справи?');
    expect(r.parsed).toBeNull();
    expect(r.residualText).toBe('привіт, як справи?');
  });
});

describe('parseModelResponse', () => {
  // Знайдено першим реальним прогоном eval: sonnet обгортає JSON у ```json
  // навіть коли просять чистий. Беклапки доходили до людини як текст.
  it('знімає ```json-огорожу', () => {
    const raw = '```json\n{"reply":"Запишу","card":{"type":"intake_diff","ops":[]}}\n```';
    const { reply, card } = parseModelResponse(raw);
    expect(reply).toBe('Запишу');
    expect(card?.type).toBe('intake_diff');
    expect(reply).not.toContain('`');
  });

  it('знімає огорожу без мовної мітки', () => {
    const { card } = parseModelResponse('```\n{"type":"proposal","items":[]}\n```');
    expect(card?.type).toBe('proposal');
  });

  it('гола картка без обгортки', () => {
    const { card, reply } = parseModelResponse('Ось варіанти: {"type":"proposal","items":[{"title":"X"}]}');
    expect(card?.type).toBe('proposal');
    expect(reply).toContain('Ось варіанти');
  });

  it('без JSON — усе в reply, картки немає', () => {
    const { card, reply } = parseModelResponse('Не бачу так далеко.');
    expect(card).toBeNull();
    expect(reply).toBe('Не бачу так далеко.');
  });

  // Крок 9 (повний прогін, feedback-diagnosis): модель віддала {reply, note}
  // без ключа card — обгортка не впізналась, і людині пішла порожня репліка.
  // Обгортка — будь-який обʼєкт із reply; card і note необовʼязкові.
  it('{reply, note} без card — обгортка: reply і note доходять, card null', () => {
    const raw = '```json\n{"reply":"Анчоуси й каперси — обидва солоні.","note":"Путанеска — воду не солити"}\n```';
    const { reply, card, note } = parseModelResponse(raw);
    expect(reply).toBe('Анчоуси й каперси — обидва солоні.');
    expect(card).toBeNull();
    expect(note).toBe('Путанеска — воду не солити');
  });

  it('{reply} сам — обгортка: reply доходить, card і note null', () => {
    const { reply, card, note } = parseModelResponse('{"reply":"Сто грамів."}');
    expect(reply).toBe('Сто грамів.');
    expect(card).toBeNull();
    expect(note).toBeNull();
  });
});

// ImportSheet із прототипу: людина показує рецепт із книжки чи скрін із
// телеграму, і він має лягти в бібліотеку. Парсер вкладень розпізнавав
// kind:"recipe" від першого дня — і прод свідомо не будував із нього картку
// («recipe-картка буде на наступному кроці»). Наступний крок не наставав шість
// QA-прогонів, а eval-фікстура recipe-freeform перевіряла саме це й не могла
// позеленіти в принципі.
describe('вкладення з рецептом', () => {
  const RECIPE_JSON = JSON.stringify({
    kind: 'recipe',
    note: 'плескавиця з камбоцолою — сербська котлета з сиром усередині',
    recipe: {
      t: 'Плескавиця з камбоцолою',
      sv: 2, tm: 40, ch: '40 хвилин, з них 15 активно',
      d: 'Соковита, сир тече', rk: 'Не притискати лопаткою',
      ing: [{ n: 'фарш', v: 500, u: 'g' }, { n: 'камбоцола', v: 80, u: 'g' }],
      st: [{ t: 'Змішати', c: 'Фарш із сіллю' }, { t: 'Смажити', c: 'По 4 хв з боку', s: 240 }],
    },
  });

  it('дає картку рецепта, а не порожнечу', () => {
    const { card, raw_kind } = parseAttachmentResponse(RECIPE_JSON);
    expect(raw_kind).toBe('recipe');
    expect(card).not.toBeNull();
    expect(card!.type).toBe('recipe');
  });

  it('рецепт усередині картки цілий', () => {
    const { card } = parseAttachmentResponse(RECIPE_JSON);
    const r = (card as { recipe: { t: string; ing: unknown[]; st: unknown[] } }).recipe;
    expect(r.t).toBe('Плескавиця з камбоцолою');
    expect(r.ing).toHaveLength(2);
    expect(r.st).toHaveLength(2);
  });

  it('note стає реплікою — людина читає речення, не JSON', () => {
    const { reply } = parseAttachmentResponse(RECIPE_JSON);
    expect(reply).toContain('плескавиця');
    expect(reply).not.toContain('{');
  });

  it('рецепт без назви картки не дає — нема чого зберігати', () => {
    const { card, raw_kind } = parseAttachmentResponse(
      JSON.stringify({ kind: 'recipe', note: 'не розібрав', recipe: { ing: [], st: [] } }),
    );
    expect(raw_kind).toBe('recipe');
    expect(card).toBeNull();
  });

  it('kind:recipe без recipe взагалі — теж без картки', () => {
    const { card } = parseAttachmentResponse(JSON.stringify({ kind: 'recipe', note: 'щось' }));
    expect(card).toBeNull();
  });
});

// Черга Д (№2): чекові ops приходять у компактній схемі (v/u/conf/ev) —
// парсер приводить їх до словника apply (value/unit/confidence/evidence),
// інакше кількість з чека мовчки губилась. Трійка+теги проходять наскрізь.
describe('parseAttachmentResponse: нормалізація ops', () => {
  it('v/u/conf/ev → value/unit/confidence/evidence; трійка й теги проходять', () => {
    const raw = JSON.stringify({
      kind: 'receipt', note: 'Чек із АТБ',
      ops: [{
        op: 'add', label: 'Пармезан Galbani', v: 200, u: 'g', zone: 'fridge', conf: 0.9, ev: 'receipt_line',
        product: 'пармезан', brand: 'Galbani', variant: 'тертий',
        tags: { allergens: ['молоко'], lactose: 'low', shelf_open_days: 14 },
      }],
    });
    const { card } = parseAttachmentResponse(raw);
    expect(card?.type).toBe('intake_diff');
    const op = (card as { ops: Record<string, unknown>[] }).ops[0]!;
    expect(op).toMatchObject({
      op: 'add', label: 'Пармезан Galbani', value: 200, unit: 'g',
      confidence: 0.9, evidence: 'receipt_line',
      product: 'пармезан', brand: 'Galbani', variant: 'тертий',
    });
    expect((op.tags as { allergens: string[] }).allergens).toEqual(['молоко']);
    expect(op.v).toBeUndefined();
  });
});

// Живий прогін 2026-08-31: модель віддала [{...}] — обʼєкт в масиві-обгортці.
// Парсер розгортає одноелементний масив; плейсхолдери бренду («не видно»)
// вичищає normalizeTriple.
describe('parseAttachmentResponse: обгортки і плейсхолдери', () => {
  it('одноелементний масив розгортається', () => {
    const raw = JSON.stringify([{ kind: 'receipt', note: 'н', ops: [{ op: 'add', label: 'сіль', v: 500, u: 'g' }] }]);
    const { card, raw_kind } = parseAttachmentResponse(raw);
    expect(raw_kind).toBe('receipt');
    expect((card as { ops: unknown[] }).ops).toHaveLength(1);
  });
});
