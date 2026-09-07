// Крок А2: ціна хода — точна там, де є указівник, і оцінка там, де його нема.
//
// До А1 у token_usage не було нічого, що зв'язувало виклик моделі з ходом, і
// пульс зшивав їх ЗДОГАДКОЮ: найближчий виклик тієї самої людини в межах
// хвилини. Уся юніт-економіка стояла на цій здогадці.
//
// Дві речі ламаються тут тихо і дорого:
//   — узяти НАЙБЛИЖЧИЙ рядок замість СУМИ. Одне звернення до /v1/chat дає
//     кілька викликів під тим самим message_id (сам чат, генерація рецепта
//     всередині нього, повтор після вето) — і «найближчий» показав би третину
//     ціни як цілу;
//   — мовчки видати оцінку за точну ціну. Тоді власник побудує економіку на
//     здогадці й не дізнається про це ніколи.
//
// Тому предмет тесту — і число, і СПОСІБ, яким воно порахувалось.

import { describe, it, expect } from 'vitest';
import { attachPrice, type PulseTurn } from '../src/routes/pulse.js';
import type { TokenUsageRow } from '@kitchen/domain';

const T0 = new Date('2026-09-07T12:00:00.000Z');
const iso = (offsetSec: number) => new Date(T0.getTime() + offsetSec * 1000).toISOString();

function turn(over: Partial<PulseTurn> & { at: string; role: 'user' | 'assistant' }): PulseTurn {
  return {
    message_id: over.message_id ?? `m-${over.at}`,
    user_id: 'u-1', who: 'Пилип', text: null,
    card_type: null, card_state: null,
    latency_ms: null, usd: null, price_from: null,
    ...over,
  };
}

function usage(over: Partial<TokenUsageRow> & { created_at: string }): TokenUsageRow {
  return {
    id: `t-${Math.random()}`, user_id: 'u-1', household_id: 'h-1',
    call: 'chat', profile: 'stub', model: 'claude-haiku-4-5',
    prompt_version: 'test', mode: 'live',
    input_tokens: 0, output_tokens: 0, cached_tokens: 0,
    latency_ms: 1000, prompt_hash: null, prompt_chars: null,
    message_id: null, session_id: null,
    ...over,
  };
}

describe('ціна хода', () => {
  it('з указівником — СУМА рядків цього ходу, а не найближчий із них', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
    ];
    // Одне звернення до /v1/chat: сам чат + генерація рецепта всередині нього.
    // 1 млн вхідних haiku = $1.00; отже два рядки по 500k дають рівно $1.00.
    attachPrice(turns, [
      usage({ created_at: iso(1), message_id: 'msg-1', input_tokens: 500_000, latency_ms: 1200 }),
      usage({ created_at: iso(2), message_id: 'msg-1', input_tokens: 500_000, latency_ms: 800 }),
    ]);
    const a = turns[1]!;
    expect(a.price_from).toBe('message');
    expect(a.usd).toBeCloseTo(1.0, 6);
    // Латентність теж сумою: людина чекала обидва виклики, а не довший із них.
    expect(a.latency_ms).toBe(2000);
  });

  it('сума не подвоюється, коли за один хід асистент сказав кілька реплік', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
      turn({ at: iso(3), role: 'assistant' }),   // followup того самого ходу
    ];
    attachPrice(turns, [usage({ created_at: iso(1), message_id: 'msg-1', input_tokens: 1_000_000 })]);
    expect(turns[1]!.usd).toBeCloseTo(1.0, 6);
    // Друга репліка того самого ходу лишається порожня — інакше та сама сума
    // порахувалась би двічі, і день у грошах виглядав би вдвічі дорожчим.
    expect(turns[2]!.usd).toBeNull();
    expect(turns[2]!.price_from).toBeNull();
  });

  it('два різні ходи — дві різні суми, а не одна на обидва', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(1), role: 'assistant' }),
      turn({ at: iso(10), role: 'user', message_id: 'msg-2' }),
      turn({ at: iso(11), role: 'assistant' }),
    ];
    attachPrice(turns, [
      usage({ created_at: iso(1), message_id: 'msg-1', input_tokens: 1_000_000 }),
      usage({ created_at: iso(11), message_id: 'msg-2', input_tokens: 2_000_000 }),
    ]);
    expect(turns[1]!.usd).toBeCloseTo(1.0, 6);
    expect(turns[3]!.usd).toBeCloseTo(2.0, 6);
  });

  it('без указівника — падає на зшивання за часом і чесно каже про це', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
    ];
    // Старий рядок: message_id немає й уже не буде — заднім числом не відновити.
    attachPrice(turns, [usage({ created_at: iso(3), input_tokens: 1_000_000, latency_ms: 4200 })]);
    const a = turns[1]!;
    expect(a.price_from).toBe('time');
    expect(a.usd).toBeCloseTo(1.0, 6);
    expect(a.latency_ms).toBe(4200);
  });

  it('зшивання за часом не бере чужий виклик — у домі з двох це найлегша помилка', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
    ];
    attachPrice(turns, [usage({ created_at: iso(2), user_id: 'u-2', input_tokens: 1_000_000 })]);
    expect(turns[1]!.usd).toBeNull();
    expect(turns[1]!.price_from).toBeNull();
  });

  it('зшивання за часом не тягнеться далі хвилини', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
    ];
    attachPrice(turns, [usage({ created_at: iso(200), input_tokens: 1_000_000 })]);
    expect(turns[1]!.usd).toBeNull();
  });

  it('точний рядок не перебивається сусіднім старим', async () => {
    // Поруч у часі лежить старий виклик без указівника. Він не має права
    // підмінити точну суму — інакше нові дані нічого не змінили б.
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
    ];
    attachPrice(turns, [
      usage({ created_at: iso(2), input_tokens: 5_000_000 }),                        // старий, поруч
      usage({ created_at: iso(1), message_id: 'msg-1', input_tokens: 1_000_000 }),   // точний
    ]);
    expect(turns[1]!.price_from).toBe('message');
    expect(turns[1]!.usd).toBeCloseTo(1.0, 6);
  });

  it('репліка людини ціни не носить — вона нічого не викликала', async () => {
    const turns = [
      turn({ at: iso(0), role: 'user', message_id: 'msg-1' }),
      turn({ at: iso(2), role: 'assistant' }),
    ];
    attachPrice(turns, [usage({ created_at: iso(1), message_id: 'msg-1', input_tokens: 1_000_000 })]);
    expect(turns[0]!.usd).toBeNull();
    expect(turns[0]!.price_from).toBeNull();
  });
});
