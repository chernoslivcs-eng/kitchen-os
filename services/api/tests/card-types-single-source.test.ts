// П4-Т5. Дві копії одного списку типів розійшлись: домен знав `recipe` і
// `cook_photo`, прод — `recipe_edit`. Це був недороблений переїзд, а не
// рішення: `extractJson` уже жив у домені, а перевірку типу лишили на місці.
//
// Джерело тепер одне — CHAT_CARD_TYPES. Два сторожі:
//   1) щоб копія не відросла (хтось знову впише масив рядків поруч);
//   2) щоб склад не розійшовся з ПРОМПТОМ — бо саме промпт вирішує, що
//      модель має право віддати, і список має бути виведений із нього,
//      а не з того, що колись комусь знадобилось.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CHAT_CARD_TYPES } from '@kitchen/domain';
import { loadPrompt } from '@kitchen/prompts';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

describe('список типів картки має одне джерело', () => {
  it('у services/api не лишилось рядкового літерала зі списком типів', () => {
    // Форма, яку шукаємо, — саме та, що тут була: масив рядків, у якому
    // поруч живуть кілька родин карток. Один тип у рядку (card.type ===
    // 'intake_diff') — не список, і його ловити не треба.
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/\[[^[\]]*\]/g)) {
        const quoted = [...m[0].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
        const families = quoted.filter((t) => CHAT_CARD_TYPES.includes(t));
        if (families.length >= 3) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('склад збігається з тим, що промпт дозволяє віддати у виклику chat', () => {
    const prompt = loadPrompt();
    const blocks = prompt.manifest.calls.chat!.compose.map((b) => b.replace(/\?$/, ''));
    const chatText = blocks.map((k) => prompt.blocks[k] ?? '').join('\n');

    const inPrompt = new Set(
      [...chatText.matchAll(/"type"\s*:\s*"([a-z_]+)"/g)].map((m) => m[1]!),
    );

    // Жодного типу зі списку немає поза промптом: приймати те, чого модель
    // не має права віддати, означає тримати відчиненими двері без кімнати.
    for (const t of CHAT_CARD_TYPES) expect([...inPrompt]).toContain(t);

    // І навпаки: усе, що промпт дозволяє, а список не приймає, — це рівно
    // три маркери ходу. Зʼявиться четвертий — цей тест впаде, і це правильно:
    // тип у промпті без гілки застосування нікуди не доходить.
    const notAccepted = [...inPrompt].filter((t) => !CHAT_CARD_TYPES.includes(t)).sort();
    expect(notAccepted).toEqual(['cart_go', 'cook_go', 'retail_search_go']);
  });
});
