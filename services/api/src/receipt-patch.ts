import type { Card, IntakeOp, Repo } from '@kitchen/domain';

// Правка одного рядка чека після застосування.
//
// Задача, з якої це виросло: чек може прийти з помилкою або бути неправильно
// зрозумілим, і людина уточнює це в чаті — «то не хліб салтівський, то
// батон». Стан комори при цьому править звичайна intake-операція
// (rename/correct), яка вже давно існує. Але сам чек після цього показував
// би стару назву, і артефакт брехав би про те, як він зрозумілий.
//
// Тому тут — і ТІЛЬКИ тут — рядок чека приводиться у відповідність. Не
// перезбираємо картку і не звертаємось по неї до моделі: правиться одне
// поле в одному рядку. Саме заради цього чек і має стабільний card_id.
//
// Чому промпт не змінюється взагалі. Модель уже вміє rename і correct, а
// позиції чека після застосування лежать у коморі звичайними партіями й
// видно їх у блоці [КОМОРА]. Отже «то не X, то Y» — це той самий хід, який
// вона робила завжди; новим є лише наслідок на боці сервера.
//
// Межа: правляться рядки, ЗАСТОСОВАНІ в комору (ops). Невпізнані рядки
// правляться окремим шляхом («уточнити» → clarify-line), а нехарчові в
// комору не потрапляють, тож партії, яку можна перейменувати, не мають.
const key = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();

function isReceiptCard(card: Card | null): boolean {
  return card?.type === 'intake_diff'
    && (card.source?.kind === 'retail_receipt' || card.source?.kind === 'chat_receipt');
}

export async function patchReceiptRows(
  repo: Repo,
  session_id: string,
  ops: IntakeOp[] | undefined,
): Promise<number> {
  const edits = (ops ?? []).filter((o) => o.op === 'rename' || o.op === 'correct');
  if (!edits.length) return 0;

  // Тільки поточна сесія: артефакт панелі й так живе в її ходах, тож чек,
  // який людина зараз бачить і править, лежить саме тут. Це заразом і
  // межа впливу — правка не дотягнеться до чека з іншого дня.
  const messages = await repo.listMessages(session_id);
  let patched = 0;

  for (const m of messages) {
    if (!isReceiptCard(m.card)) continue;
    const card = m.card as Card & { ops?: IntakeOp[] };
    const rows = card.ops ?? [];
    let touched = false;

    for (const edit of edits) {
      const i = rows.findIndex((r) => r.op === 'add' && key(r.label) === key(edit.label));
      if (i < 0) continue;
      const row = rows[i]!;
      if (edit.op === 'rename' && edit.to) {
        rows[i] = { ...row, label: edit.to };
        touched = true;
      } else if (edit.op === 'correct') {
        rows[i] = {
          ...row,
          ...(edit.value !== undefined ? { value: edit.value } : {}),
          ...(edit.unit !== undefined ? { unit: edit.unit } : {}),
        };
        touched = true;
      }
    }

    if (touched) {
      card.ops = rows;
      // Пишемо і в message (те, що рендериться після F5), і в pending (те,
      // що читає applyCard) — та сама пара сховищ, що тримають cart-swap
      // і clarify-line.
      await repo.updateMessageCard(m.id, card);
      const pc = await repo.getPending(m.id);
      if (pc) await repo.updatePending(m.id, { card });
      patched += 1;
    }
  }
  return patched;
}
