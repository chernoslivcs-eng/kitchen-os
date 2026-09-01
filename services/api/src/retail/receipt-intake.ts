// Рядки чека мережі → операції комори. Три кошики (дизайн-канон M13):
// ops — їжа зі збігом; nonfood — каталог знає, що це не їжа («не для комори»);
// unmatched — каталог не впізнав, людина вирішує сама («додати руками»).
// Тут навмисно немає евристик поверх каталогу: що не впізнали — показуємо, не вгадуємо.
import type { IntakeOp, Unit } from '@kitchen/domain';
import { resolveLabelToKey, resolveLabelToZone } from '@kitchen/catalog';
import { BY_KEY } from '@kitchen/catalog/seed';

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

export function receiptLinesToIntake(lines: ReceiptLine[]): ReceiptIntake {
  const out: ReceiptIntake = { ops: [], nonfood: [], unmatched: [] };
  for (const l of lines) {
    const key = resolveLabelToKey(l.name);
    if (!key) { out.unmatched.push(l); continue; }
    if (BY_KEY.get(key)?.categories?.includes('нехарчове')) { out.nonfood.push(l); continue; }
    const { value, unit } = toPantryUnits(l.quantity, l.unit);
    out.ops.push({
      op: 'add',
      label: l.name,
      value,
      unit,
      zone: resolveLabelToZone(l.name) ?? undefined,
      confidence: 1,
      evidence: 'receipt_line',
      catalog_key: key,
    });
  }
  return out;
}
