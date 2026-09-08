// @vitest-environment jsdom
//
// Крок А4: блок грошей.
//
// Тут ламається тихо те, що робить число ЧЕСНИМ, а не просто правильним:
//
//   — прогноз виглядає як факт. Оцінка без «≈» читається як виміряне, і на ній
//     ухвалюють рішення про ціну підписки;
//   — на шести подіях показано «83%». Відсоток створює враження точності,
//     якої за ним немає, і на пілоті це найчастіша брехня;
//   — порожній період показує «$0.00». Нуль читається як «нічого не
//     витратили», а правда — «стільки ще не збирали»;
//   — «ціни не знаємо» перетворюється на нуль десь дорогою.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MoneyBlock, shareWord } from './Money';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let calls: string[];

const slice = (over: Partial<{ key: string; label: string; calls: number; usd: number; usd_per_call: number | null; unpriced_calls: number }> = {}) => ({
  key: 'chat', label: 'розмова', calls: 10, usd: 0.5, usd_per_call: 0.05,
  input_tokens: 1000, output_tokens: 100, cached_tokens: 0, unpriced_calls: 0, ...over,
});

const MONEY = {
  period: 'day' as const,
  day: '2026-09-08',
  from: '2026-09-08T00:00:00.000Z',
  to: '2026-09-09T00:00:00.000Z',
  prev_from: '2026-09-07T00:00:00.000Z',
  prev_to: '2026-09-08T00:00:00.000Z',
  // Крок А4б: вхід — три доданки, і 1 570 000 = 900 000 + 450 000 + 220 000.
  // Частка кешу рахується від УСЬОГО входу: 450 000 / 1 570 000 = 28,7%.
  totals: { calls: 40, usd: 4.2, input_tokens: 900_000, output_tokens: 40_000, cached_tokens: 450_000, input_all_tokens: 1_570_000, cached_share: 450_000 / 1_570_000, stub_calls: 7, unpriced_calls: 3, cache_write_tokens: 220_000, cache_write_usd: 0.825, calls_without_write: 0 },
  previous: { calls: 30, usd: 2.9, input_tokens: 600_000, output_tokens: 30_000, cached_tokens: 200_000, input_all_tokens: 800_000, cached_share: 0.25, stub_calls: 0, unpriced_calls: 0, cache_write_tokens: 0, cache_write_usd: 0, calls_without_write: 0 },
  reconcile: { calls: 40, input_tokens: 1_570_000, output_tokens: 40_000, cached_share: 450_000 / 1_570_000, usd: 4.2 },
  byCall: [slice({ key: 'attachment_parse', label: 'розбір вкладення', calls: 4, usd: 3.0, usd_per_call: 0.75 }), slice()],
  byModel: [slice({ key: 'claude-haiku-4-5', label: 'claude-haiku-4-5' }), slice({ key: 'llama-3', label: 'llama-3', calls: 3, usd: 0, usd_per_call: null, unpriced_calls: 3 })],
  byHousehold: [slice({ key: 'h-1', label: 'h-1' })],
  byPerson: [slice({ key: 'u-1', label: 'u-1' })],
  avg: {
    usd_per_turn: 0.021, turns: 44, latency_avg_ms: 3400, latency_p95_ms: 9800,
    latency_n: 44, turns_per_person_day: 4.4, person_days: 10, human_wait_ms: null,
  },
  forecast: {
    month_usd: 126.5, month_elapsed: 0.26, per_household_usd: 42.1, per_person_usd: 25.3,
    households: 3, people: 5,
    sensitive_to: { cached_share: 0.5, parse_share: 0.1, long_tail_ms: 9800 },
    price_usd: null,
  },
  collected_since: '2026-08-29T19:52:00.000Z',
  cache_write_since: '2026-09-08T00:00:00.000Z',
  calls_split_since: '2026-09-09T00:00:00+03:00',
  percent_floor: 20,
  technical_included: false,
};

function install(body: unknown = MONEY) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

async function mount(technical = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MoneyBlock technical={technical} />); });
}

beforeEach(() => install());
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove(); root = undefined; host = undefined;
  vi.unstubAllGlobals();
});

describe('частка словом', () => {
  it('нижче стелі — «5 з 6», а не «83%»', () => {
    // На малих числах відсоток бреше: за «83%» не видно, що подій було шість.
    expect(shareWord(5, 6, 20)).toBe('5 з 6');
    expect(shareWord(1, 3, 20)).toBe('1 з 3');
  });

  it('від стелі — відсоток, бо він уже щось означає', () => {
    expect(shareWord(50, 100, 20)).toBe('50%');
    expect(shareWord(5, 20, 20)).toBe('25%');
  });

  it('нуль подій — риска, не «0%»', () => {
    expect(shareWord(0, 0, 20)).toBe('—');
  });
});

describe('блок грошей', () => {
  it('головний розріз каже, скільки коштує ОДИН виклик', async () => {
    await mount();
    const parse = host!.querySelector('[data-key="attachment_parse"]')!;
    // Один розбір чека коштує як п'ятнадцять питань про олію — саме це число
    // й робить блок корисним, а не спільна сума.
    expect(parse.querySelector('[data-per-call]')!.textContent).toBe('$0.7500');
  });

  it('порівняння з попереднім періодом видно поруч із сумою', async () => {
    await mount();
    // «$4.20» ні про що не каже. «$4.20, було $2.90» каже все.
    expect(host!.textContent).toContain('було $2.90');
    expect(host!.textContent).toContain('+45%');
  });

  it('стабові виклики названо окремо — вони не зникли, вони поза грішми', async () => {
    await mount();
    expect(host!.textContent).toContain('з них стабових 7');
    expect(host!.textContent).toContain('поза грішми');
  });

  it('«ціни не знаємо» лишається словами, а не стає нулем', async () => {
    await mount();
    const unknown = host!.querySelector('[data-key="llama-3"]')!;
    expect(unknown.querySelector('[data-per-call]')!.textContent).toBe('ціни не знаємо');
    expect(host!.querySelector('[data-unpriced]')!.textContent).toContain('3 викликів');
    expect(host!.querySelector('[data-unpriced]')!.textContent).toContain('не нуль');
  });

  it('прогноз має вигляд ОЦІНКИ — зі знаком «≈», як ціна хода в пульсі', async () => {
    await mount();
    const forecast = host!.querySelector('[data-forecast]')!.textContent!;
    expect(forecast).toContain('≈ $126.50');
    expect(forecast).toContain('≈ $42.10');
    expect(forecast).toContain('≈ $25.30');
  });

  it('прогноз каже, на що він чутливий — інакше виглядав би точнішим, ніж є', async () => {
    await mount();
    const forecast = host!.querySelector('[data-forecast]')!.textContent!;
    expect(forecast).toContain('кеш 50%');
    expect(forecast).toContain('розбори чеків 10%');
    expect(forecast).toContain('довгі ходи 9.8 с');
  });

  it('«скільки чекала людина» сказано прямо: не міряємо', async () => {
    await mount();
    // Без цього рядка латентність моделі читалася б як час очікування людини,
    // а це інше число, і воно більше.
    const row = host!.querySelector('[data-row="Людина чекала"]')!;
    expect(row.textContent).toContain('не міряємо');
    expect(row.textContent).toContain('поза виміром');
  });

  it('частка кешу на екрані ніколи не більша за 100%', async () => {
    // Це впіймано НЕ тестом, а очима на проді: сервер уже рахував правильно, а
    // клієнт перераховував частку сам зі старим знаменником — і показував
    // «256%». Число, якого не може існувати, простояло на екрані цілий деплой.
    // Крок А4б: знаменник — увесь вхід, разом із записаними в кеш.
    // 1 327 752 / (518 329 + 1 327 752 + 220 000) = 64%.
    install({
      ...MONEY,
      totals: {
        ...MONEY.totals, input_tokens: 518_329, cached_tokens: 1_327_752,
        input_all_tokens: 2_066_081, cached_share: 1_327_752 / 2_066_081,
      },
    });
    await mount();
    const text = host!.textContent!;
    expect(text).toContain('з кешу 64%');
    expect(text).not.toContain('256%');
    // Частка — саме частка: понад сто відсотків вона бути не може. (Зростання
    // витрат поруч цілком може бути +410% — це інша величина, і її не чіпаємо.)
    const share = /з кешу (\d+)%/.exec(text);
    expect(share).toBeTruthy();
    expect(Number(share![1])).toBeLessThanOrEqual(100);
  });

  // Крок А4б: числа мають сходитись із рахунком, і це має бути видно оком.
  it('головне число токенів — увесь вхід, а не самі свіжі', async () => {
    // Показували 35 742 там, де рахунок каже 227 744 (8 вересня): у верхню
    // цифру не входили ні прочитані з кешу, ні записані в нього. Гроші від
    // цього не страждали — страждав читач, який бачить її як підсумок.
    await mount();
    const card = [...host!.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Токени'))!;
    // toLocaleString('uk-UA') розділяє тисячі нерозривним пробілом — звідси regexp.
    expect(card.textContent).toMatch(/1\s570\s000/);
    expect(card.textContent).not.toMatch(/900\s000/);
  });

  it('рядок звірки дає ті самі п\'ять величин, що й підсумок блоку', async () => {
    // Заради цього рядка крок і зроблено: власник відкриває OpenRouter Activity
    // поруч і бачить, сходиться чи ні, — без арифметики в стовпчик.
    await mount();
    const row = host!.querySelector('[data-reconcile]')!;
    const text = row.textContent!;
    expect(text).toMatch(/40 викликів/);
    expect(text).toMatch(/1\s570\s000\s+вхідних/);
    expect(text).toMatch(/40\s000\s+вихідних/);
    expect(text).toContain('з кешу 29%');
    expect(text).toContain('$4.2000');
    // Розкладка входу поруч: три доданки, три різні ставки.
    expect(text).toMatch(/свіжих 900\s000/);
    expect(text).toMatch(/з кешу 450\s000/);
    expect(text).toMatch(/записано 220\s000/);
  });

  it('період до розсування записів названо застереженням, а не змовчано', async () => {
    // Ціна одного виклику за такі дні завищена рівно у стільки разів, скільки
    // викликів злилось в один рядок. Перерахувати заднім числом нема з чого —
    // лишається сказати.
    await mount();
    expect(host!.querySelector('[data-calls-merged]')).toBeTruthy();
    expect(host!.querySelector('[data-calls-merged]')!.textContent).toContain('ціна одного виклику завищена');
  });

  it('період після розсування застереження не носить — там воно було б брехнею', async () => {
    install({ ...MONEY, from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' });
    await mount();
    expect(host!.querySelector('[data-calls-merged]')).toBeNull();
  });

  it('запис у кеш показаний окремим рядком — це найбільший важіль', async () => {
    await mount();
    const row = host!.querySelector('[data-cache-write]')!;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('$0.8250');
    // toLocaleString('uk-UA') розділяє розряди НЕРОЗРИВНИМ пробілом — звичайний
    // тут не збігся б, і тест падав би на правильній розмітці.
    expect(row.textContent).toMatch(/220\s000\s*ток\./);
    // І поруч сказано, ЧОМУ це важливо, а не просто число.
    expect(row.textContent).toContain('холодної сесії');
  });

  it('неповний період названо неповним — інакше занижене число виглядає як повне', async () => {
    install({
      ...MONEY,
      totals: { ...MONEY.totals, calls_without_write: 26 },
    });
    await mount();
    const row = host!.querySelector('[data-cache-write]')!.textContent!;
    expect(row).toMatch(/26\s*з\s*40/);
    expect(row).toContain('не враховано');
  });

  it('порожній період каже «не збирали», а не «$0.00»', async () => {
    install({
      ...MONEY,
      totals: { calls: 0, usd: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, cached_share: null, stub_calls: 0, unpriced_calls: 0, cache_write_tokens: 0, cache_write_usd: 0, calls_without_write: 0 },
      collected_since: '2026-12-01T00:00:00.000Z',
    });
    await mount();
    expect(host!.querySelector('[data-not-collected]')).toBeTruthy();
    expect(host!.textContent).toContain('Стільки ще не збирали');
    // Нуль читається як «нічого не витратили» — а це інша новина.
    expect(host!.textContent).not.toContain('$0.00');
  });

  it('перемикання періоду перепитує сервер саме тим періодом', async () => {
    await mount();
    await act(async () => { (host!.querySelector('[data-period="week"]') as HTMLButtonElement).click(); });
    expect(calls.at(-1)).toContain('period=week');
  });

  it('уперед з поточного періоду не пускає — майбутнього ще не було', async () => {
    await mount();
    expect((host!.querySelector('[data-next]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('крок назад перепитує інший день — і відкриває дорогу вперед', async () => {
    await mount();
    const before = calls.length;
    await act(async () => { (host!.querySelector('[data-prev]') as HTMLButtonElement).click(); });
    expect(calls.length).toBeGreaterThan(before);
    expect(calls.at(-1)).toContain('day=');
    // Ми більше не в поточному періоді, тож повернутись уперед тепер можна.
    expect((host!.querySelector('[data-next]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('перемикач технічних домів доїжджає до запиту грошей', async () => {
    // Інакше витрати QA-прогонів осіли б у собівартості продукту.
    await mount(true);
    expect(calls[0]).toContain('technical=1');
  });
});
