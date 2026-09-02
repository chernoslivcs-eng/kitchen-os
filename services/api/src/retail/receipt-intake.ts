// Рядки чека мережі → операції комори. Три кошики (дизайн-канон M13):
// ops — їжа зі збігом; nonfood — каталог знає, що це не їжа («не для комори»);
// unmatched — каталог не впізнав, людина вирішує сама («додати руками»).
// Тут навмисно немає евристик поверх каталогу: що не впізнали — показуємо, не вгадуємо.
import type { IntakeOp, Unit } from '@kitchen/domain';
import { normalize } from '@kitchen/catalog';
import { CATALOG, BY_KEY } from '@kitchen/catalog/seed';

export interface ReceiptLine {
  name: string;
  quantity: number;
  unit: string;      // як у чека: «шт», «кг», «г», «л», «мл»
  price: number;
  image: string | null;
}

export interface ReceiptIntake {
  ops: IntakeOp[];
  nonfood: ReceiptLine[];
  unmatched: ReceiptLine[];
}

// Чекові одиниці → канонічні одиниці комори.
function toPantryUnits(quantity: number, unit: string): { value: number; unit: Unit } {
  const u = unit.trim().toLowerCase();
  if (u === 'кг') return { value: Math.round(quantity * 1000), unit: 'g' };
  if (u === 'г') return { value: Math.round(quantity), unit: 'g' };
  if (u === 'л') return { value: Math.round(quantity * 1000), unit: 'ml' };
  if (u === 'мл') return { value: Math.round(quantity), unit: 'ml' };
  return { value: quantity, unit: 'pcs' };
}

// Суворіший за resolveLabelToKey: той матчить ПІДРЯДКОМ і на шумних назвах
// мережі впевнено бреше («Портерхаус» → пиво портер, «Сільпо» → сіль —
// живий чек 23.08). Тут аліас збігається, лише якщо КОЖНЕ його слово стоїть
// цілим словом у назві з чека. Морфологію навмисно не прощаємо: «з корицею»
// не означає «кориця». Що не пройшло — чесний unmatched, не вигадка.
export function resolveReceiptKey(name: string): string | null {
  const nameWords = normalize(name).split(/\s+/).filter(Boolean);
  const words = new Set(nameWords);
  // Головне слово: у назвах мережі продукт стоїть першим («Булочка з корицею»
  // — булочка, не кориця). Аліас без голови приймаємо лише за латинський
  // бренд («Schweppes», «Lay's») — бренд ідентифікує продукт із будь-якої позиції.
  const head = nameWords[0];
  let best: { key: string; score: number; priority: number } | null = null;
  for (const item of CATALOG) {
    for (const cand of [item.name, ...item.aliases]) {
      const cw = normalize(cand).split(/\s+/).filter(Boolean);
      if (!cw.length || !cw.every((w) => words.has(w))) continue;
      if (!(head && cw.includes(head)) && !cw.some((w) => /^[a-z0-9'’-]{4,}$/.test(w))) continue;
      const score = cw.reduce((s, w) => s + w.length, 0);
      const priority = item.priority ?? 0;
      if (!best || score > best.score || (score === best.score && priority > best.priority)) {
        best = { key: item.key, score, priority };
      }
    }
  }
  return best?.key ?? null;
}

export function receiptLinesToIntake(lines: ReceiptLine[]): ReceiptIntake {
  const out: ReceiptIntake = { ops: [], nonfood: [], unmatched: [] };
  for (const l of lines) {
    const key = resolveReceiptKey(l.name);
    if (!key) { out.unmatched.push(l); continue; }
    if (BY_KEY.get(key)?.categories?.includes('нехарчове')) { out.nonfood.push(l); continue; }
    const { value, unit } = toPantryUnits(l.quantity, l.unit);
    out.ops.push({
      op: 'add',
      label: l.name,
      value,
      unit,
      zone: BY_KEY.get(key)?.zone_default ?? undefined,
      confidence: 1,
      evidence: 'receipt_line',
      catalog_key: key,
    });
  }
  return out;
}
