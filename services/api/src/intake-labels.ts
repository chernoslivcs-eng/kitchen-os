import type { Card, IntakeOp } from '@kitchen/domain';
import { normalizeTriple, displayName } from '@kitchen/domain';

// Одна назва на одну річ.
//
// Живий провал 02.09: людина завантажила чек, у картці стояло «пап 80 туан
// зев пур мойст», натиснула застосувати — і в коморі опинився «папір».
// Різні рядки, і другий вона побачила вже постфактум.
//
// Причина не в помилці, а в тому, що назв було ДВІ. Картка малювала
// `op.label` від моделі, а `apply.ts` складав назву партії з ТРІЙКИ
// (displayName), бо «видима назва формується, не зберігається» — рішення
// власника, записане в product.ts. Обидві поведінки правильні поодинці й
// суперечать одна одній разом.
//
// Рішення власника 02.09: єдина назва — з трійки. Тому складаємо її ТУТ,
// до збереження картки: людина читає рівно те, що ляже в комору. Раніше
// вона читала одне, отримувала інше й дізнавалась про це, коли вже
// застосувала.
//
// Чому на сервері, а не в рендері картки: рядок має бути один у ДАНИХ, а не
// однаково намальований у двох місцях. Інакше наступний споживач картки
// (правка рядка, пошук у мережі, експорт) знову побачить старий label.
//
// Межа: тільки `add` і тільки за наявності product. Немає трійки — лишаємо
// label як є, це чесний фолбек. Кількість не чіпаємо: вона живе у v/u і
// малюється окремо, тож у назві їй місця немає.
export function composeIntakeLabels(card: Card | null | undefined): number {
  if (card?.type !== 'intake_diff' || !Array.isArray(card.ops)) return 0;
  let changed = 0;
  for (const op of card.ops as IntakeOp[]) {
    if (op.op !== 'add') continue;
    const raw = op as IntakeOp & { product?: string; brand?: string | null; variant?: string | null };
    if (!raw.product) continue;
    const triple = normalizeTriple({ product: raw.product, brand: raw.brand, variant: raw.variant });
    if (!triple.product) continue;
    const composed = displayName(triple);
    if (composed && composed !== op.label) {
      op.label = composed;
      changed++;
    }
  }
  return changed;
}
