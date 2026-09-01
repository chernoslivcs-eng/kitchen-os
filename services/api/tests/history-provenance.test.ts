import { describe, it, expect } from 'vitest';
import { buildChatHistory } from '../src/chat-history.js';
import type { MessageRow } from '@kitchen/domain';

// Живий репро 01.09 (M13-ROLE-VOICE-TASK п.2): на «що таке швепс?» модель
// відповіла «У тебе зараз два: Pink Tonic і Bitter Lemon», хоча в списку
// покупок не було жодного тоніка.
//
// Корінь — НЕ памʼять розмови, а відсутність атрибуції. Результат
// retail_search_go пише СЕРВЕР, а зберігається він як звичайна репліка
// асистента (card: null). Наступного ходу модель читає власну ж непідписану
// нотатку «У Сільпо є: — Швепс Pink Tonic» і робить підміну прийменника:
// «у СІЛЬПО є» → «у ТЕБЕ є».
//
// Механізм підпису в історії вже існує і працює — картки несуть
// [ЗАСТОСОВАНО]/[НЕ ЗАСТОСОВАНО]. Проза його просто не мала.
//
// Тести на МЕЖУ, а не на функцію: перевіряється рівно те, що потрапляє
// в history і їде в модель.

function msg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    session_id: 's1',
    role: 'assistant',
    text: null,
    card: null,
    applied: 0,
    created_at: '2026-09-01T14:30:00.000Z',
    ...over,
  };
}

const SEARCH_REPLY = 'У Сільпо є:\n— Напій Schweppes Pink Tonic · 34₴\n— Напій Schweppes Indian Tonic · 33₴';

describe('атрибуція серверної прози в історії розмови', () => {
  it('результат пошуку в мережі підписаний як асортимент магазину, а не стан кухні', () => {
    const history = buildChatHistory([
      msg({ role: 'user', text: 'а які ще опції в сільпо є по швепсу?' }),
      msg({ id: 'm2', text: SEARCH_REPLY, source: 'retail_search' }),
    ]);

    const searchTurn = history[1]!.content;
    // Модель мусить бачити, звідки цей текст: це полиця магазину.
    expect(searchTurn).toMatch(/асортимент мережі/i);
    // І прямо — що це НЕ стан кухні, бо саме тут відбувалась підміна.
    expect(searchTurn).toMatch(/не комора і не список покупок/i);
    // Самі дані нікуди не діваються — модель має мати про що говорити.
    expect(searchTurn).toContain('Pink Tonic');
  });

  it('звичайна репліка кухаря НЕ отримує підпису — підпис має значення лише як виняток', () => {
    const history = buildChatHistory([
      msg({ text: 'Зробимо пасту — пелаті вже відкриті.' }),
    ]);

    expect(history[0]!.content).not.toMatch(/асортимент мережі/i);
    expect(history[0]!.content).toContain('Зробимо пасту');
  });

  it('підпис не чіпає наявну атрибуцію карток', () => {
    const history = buildChatHistory([
      msg({
        text: 'Запишу молоко.',
        card: { type: 'intake_diff', ops: [{ op: 'add', label: 'молоко' }] },
        applied: 1,
      }),
    ]);

    expect(history[0]!.content).toContain('[ЗАСТОСОВАНО');
    expect(history[0]!.content).toContain('[картка: комора]');
  });
});
