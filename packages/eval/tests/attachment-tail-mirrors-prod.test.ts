import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Хвостова фраза розбору вкладення живе у ДВОХ місцях дослівно: у проді
// (`callAttachmentParse`) і тут, в евалі, який будує повідомлення сам —
// бо eval не імпортує api. Дубль свідомий, і саме тому він небезпечний:
// поправивши один бік, другий забути легко, а падіння буде тихим — еваль
// просто почне міряти поведінку, якої в проді вже немає, на семи фікстурах
// `attachment_parse`. Помітили б це не як «розбір зіпсувався», а через
// тиждень і не там.
//
// Тест порівнює рядки, а не «схожість». Розійшлись — червоний одразу.

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = resolve(HERE, '../../../services/api/src/model.ts');
const EVAL = resolve(HERE, '../model-client.ts');

/** Фраза як строковий літерал: від «Розбери за схемою» до закривної лапки. */
function tailPhrase(file: string): string {
  const src = readFileSync(file, 'utf-8');
  const m = /'(Розбери за схемою[^']*)'/.exec(src);
  if (!m) throw new Error(`хвостової фрази немає у ${file}`);
  return m[1]!;
}

describe('хвостова фраза розбору вкладення', () => {
  it('еваль дзеркалить прод дослівно', () => {
    expect(tailPhrase(EVAL)).toBe(tailPhrase(PROD));
  });

  it('вимога компактності на місці — заради неї Е2-Т1 і робився', () => {
    expect(tailPhrase(PROD)).toContain('компактний');
  });
});
