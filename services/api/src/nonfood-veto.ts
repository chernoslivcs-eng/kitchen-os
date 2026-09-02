import type { Card, IntakeOp, NonfoodOp } from '@kitchen/domain';
import { BY_KEY } from '@kitchen/catalog/seed';
import { resolveReceiptKey } from './retail/receipt-intake.js';

// Вето каталогу: нехарчове не потрапляє в комору.
//
// Звідки взялось. Чек, розібраний моделлю, клав у комору дрова, розпал,
// гриль і туалетний папір. Провина не моделі: у схемі intake_diff є тільки
// `add` і п'ять ХАРЧОВИХ зон (fridge|freezer|dry|fresh|spices) — сказати
// «це не для комори» їй просто нічим. Розкладка каталогу на три кошики
// доти працювала лише для чека з мережі; тут вона стає спільною.
//
// Вето, а не фільтр. Каталог має право лише ЗАБОРОНИТИ те, що він упізнав
// як «нехарчове». Усе, чого він не знає, лишається як є — модель у цьому
// компетентніша за наш словник. Зворотне правило («пускати тільки те, що
// каталог упізнав їжею») зламало б звичайний intake: строгий матчер не
// знає й половини нормальної їжі, на кшталт «Крем-брускетта Ponti».
// Тому дрова, яких у каталозі немає, поки що пройдуть — і це свідома
// ціна за те, щоб не викидати справжні продукти.
//
// Матчер той самий строгий, що розкладає чек мережі: кожне слово аліаса
// має стояти цілим словом у назві. М'якший матчить підрядком і на шумних
// назвах бреше («Портерхаус» → пиво портер).
//
// Мовчки не викидаємо: відсічене лягає в card.nonfood, і картка показує
// його окремою групою. Людина має бачити, чого продукт не взяв.
export function vetoNonfood(card: Card | null | undefined): number {
  if (card?.type !== 'intake_diff' || !Array.isArray(card.ops)) return 0;

  const keep: IntakeOp[] = [];
  const cut: NonfoodOp[] = [];
  for (const op of card.ops) {
    if (op.op !== 'add' || !op.label) { keep.push(op); continue; }
    const key = resolveReceiptKey(op.label);
    const nonfood = key ? BY_KEY.get(key)?.categories?.includes('нехарчове') : false;
    if (nonfood) cut.push({ label: op.label, value: op.value ?? null, unit: op.unit ?? null });
    else keep.push(op);
  }

  if (!cut.length) return 0;
  card.ops = keep;
  card.nonfood = [...(card.nonfood ?? []), ...cut];
  return cut.length;
}
