import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Сирий SQL у postgres-repo не має ЖОДНОГО покриття, поки немає живої бази:
// контрактні тести скіпаються (чи падають) без PG_TEST_URL і без Docker.
// А найтихіший спосіб зламати INSERT — розʼїхані списки: колонок 8,
// плейсхолдерів 7, значень 9. Типи цього не ловлять, бо всередині рядок.
//
// Перевірка статична: читаємо джерело й рахуємо. Не заміна контрактним
// тестам проти справжнього Postgres — вони й далі потрібні.

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, '..', 'postgres-repo.ts'), 'utf-8');

function insertsIn(source: string) {
  const out: { table: string; cols: number; holes: number }[] = [];
  const re = /INSERT INTO\s+"?(\w+)"?\s*\(([^)]*)\)\s*\n?\s*VALUES\s*\(([^)]*)\)/gi;
  for (const m of source.matchAll(re)) {
    const cols = m[2]!.split(',').map((s) => s.trim()).filter(Boolean).length;
    const holes = new Set(m[3]!.match(/\$\d+/g) ?? []).size;
    out.push({ table: m[1]!, cols, holes });
  }
  return out;
}

describe('сирий SQL: списки не розʼїхались', () => {
  const inserts = insertsIn(src);

  it('INSERT-ів знайдено достатньо, щоб перевірка мала сенс', () => {
    expect(inserts.length).toBeGreaterThan(5);
  });

  it('у кожному INSERT колонок стільки ж, скільки плейсхолдерів', () => {
    const bad = inserts.filter((i) => i.cols !== i.holes);
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });

  // №2 з роль-шару: колонка source. У памʼяті вона проходить сама собою
  // (спред обʼєкта), у Postgres — тільки якщо явно вписана в обидва місця.
  it('message.source присутній і в записі, і в читанні', () => {
    const insert = /INSERT INTO message \(([^)]*)\)/.exec(src);
    expect(insert?.[1]).toContain('source');
    expect(src).toMatch(/source:\s*r\.source|r\.source as/);
  });

  it('міграція 0016 додає саме цю колонку', () => {
    const mig = readFileSync(join(HERE, '..', '..', '..', 'migrations', '0016_message_source.sql'), 'utf-8');
    expect(mig).toMatch(/ALTER TABLE message ADD COLUMN source/i);
  });
});
