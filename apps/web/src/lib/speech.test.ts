// Пул-5 №4: живий баг — надиктований текст множився («В мене є багет» ×6).
// Два джерела: (а) iOS Safari видає той самий фінальний результат повторно
// (нові індекси, ідентичний текст); (б) після авто-рестарту сеансу браузер
// віддає ПОВНИЙ транскрипт знову — старий хвіст дублювався в accumulated.
// Тести ганяють startDictation на фейковому SpeechRecognition.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startDictation } from './speech.js';

type Handler = ((e: unknown) => void) | null;

class FakeRec {
  static instances: FakeRec[] = [];
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: Handler = null;
  onend: (() => void) | null = null;
  onerror: Handler = null;
  started = false;
  constructor() { FakeRec.instances.push(this); }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { /* noop */ }

  emit(resultIndex: number, items: Array<{ text: string; final: boolean }>) {
    this.onresult?.({
      resultIndex,
      results: items.map((i) => ({ isFinal: i.final, 0: { transcript: i.text } })),
    });
  }
  end() { this.onend?.(); }
}

let texts: string[];
let done: string[];

function begin() {
  texts = [];
  done = [];
  return startDictation({
    onText: (t) => texts.push(t),
    onDone: (t) => done.push(t),
    onEnd: () => {},
  })!;
}

beforeEach(() => {
  FakeRec.instances = [];
  (globalThis as Record<string, unknown>).window = { SpeechRecognition: FakeRec };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('диктовка не дублює текст', () => {
  it('звичайні сегменти складаються послідовно', () => {
    const d = begin();
    const r = FakeRec.instances[0]!;
    r.emit(0, [{ text: 'в мене є багет', final: true }]);
    r.emit(1, [{ text: 'і вершки', final: true }]);
    d.stop();
    expect(done[0]).toBe('в мене є багет і вершки');
  });

  it('iOS: той самий фінал приходить повторно під новими індексами — один раз у тексті', () => {
    const d = begin();
    const r = FakeRec.instances[0]!;
    r.emit(0, [{ text: 'в мене є багет', final: true }]);
    // повторна доставка того ж фіналу як «нового» результату
    r.emit(0, [
      { text: 'в мене є багет', final: true },
      { text: 'в мене є багет', final: true },
    ]);
    r.emit(2, [{ text: 'в мене є багет', final: true }]);
    d.stop();
    expect(done[0]).toBe('в мене є багет');
  });

  it('рестарт сеансу: браузер віддає повний транскрипт знову — без подвоєння хвоста', () => {
    const d = begin();
    const r1 = FakeRec.instances[0]!;
    r1.emit(0, [{ text: 'в мене є багет', final: true }]);
    r1.end(); // тиша → авто-рестарт
    const r2 = FakeRec.instances[1]!;
    expect(r2).toBeTruthy();
    // кумулятивна семантика: новий сеанс повторює все спочатку + продовження
    r2.emit(0, [{ text: 'в мене є багет вершки тридцять три', final: true }]);
    d.stop();
    expect(done[0]).toBe('в мене є багет вершки тридцять три');
  });

  it('рестарт з нормальною семантикою (тільки нове) — сегменти зшиваються', () => {
    const d = begin();
    const r1 = FakeRec.instances[0]!;
    r1.emit(0, [{ text: 'три банани', final: true }]);
    r1.end();
    const r2 = FakeRec.instances[1]!;
    r2.emit(0, [{ text: 'і масло', final: true }]);
    d.stop();
    expect(done[0]).toBe('три банани і масло');
  });

  it('interim показується, але не осідає у фінал', () => {
    const d = begin();
    const r = FakeRec.instances[0]!;
    r.emit(0, [{ text: 'в мене', final: false }]);
    r.emit(0, [{ text: 'в мене є багет', final: true }]);
    expect(texts.at(-1)).toBe('в мене є багет');
    d.stop();
    expect(done[0]).toBe('в мене є багет');
  });
});
