// 01.09 живий репро: «Кроненбург 0.5 давай до замовлення» лягло в список
// покупок як { label: "Пиво Kronenbourg 0.5 л", v: null, u: null } — модель
// не витягла кількість у v/u, впаяла її текстом у саму назву. Наступний
// cart-build шукає в Сільпо буквально рядок «Kronenbourg 0.5 л» — реальна
// назва товару такого підрядка не містить («Kronenbourg Blanc..., 4×0,33л»),
// пошук мережі мовчки не знаходить нічого, хоча товар реально є (живо
// перевірено: чистий запит «Кроненбург» знаходить). Захист на вставці:
// якщо v/u не прийшли з картки, а в кінці label є «ЧИСЛО ОДИНИЦЯ» — витягти
// це в v/u (тим самим normalizeUnit, що вже конвертує л→мл), обрізати з
// label. Не займає label, де v/u вже прийшли окремо.

import { describe, it, expect } from 'vitest';
import { InMemoryRepo, createPending, applyCard } from '@kitchen/domain';
import { randomUUID } from 'node:crypto';

describe('shopping.add: кількість, що впаялась у текст label, витягується в v/u', () => {
  it('«Пиво Kronenbourg 0.5 л» (v/u не прийшли) → label без хвоста, value/unit заповнені', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('me@example.com', 'me');

    const card_id = randomUUID();
    await createPending(repo, {
      message_id: card_id, household_id, user_id,
      card: { type: 'shopping', items: [{ op: 'add', label: 'Пиво Kronenbourg 0.5 л' }] },
    });
    await applyCard(repo, card_id, [], user_id);

    const items = await repo.listShoppingItems(household_id);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('Пиво Kronenbourg');
    expect(items[0]!.value).toBe(500);
    expect(items[0]!.unit).toBe('ml');
  });

  it('v/u вже прийшли окремо — label не чіпаємо, навіть якщо там теж є число-одиниця', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('me@example.com', 'me');

    const card_id = randomUUID();
    await createPending(repo, {
      message_id: card_id, household_id, user_id,
      card: { type: 'shopping', items: [{ op: 'add', label: 'Кока-Кола 0.5 л', v: 2, u: 'l' }] },
    });
    await applyCard(repo, card_id, [], user_id);

    const items = await repo.listShoppingItems(household_id);
    expect(items[0]!.label).toBe('Кока-Кола 0.5 л');
    expect(items[0]!.value).toBe(2);
    expect(items[0]!.unit).toBe('l');
  });

  it('звичайний label без хвоста-кількості — не чіпається', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('me@example.com', 'me');

    const card_id = randomUUID();
    await createPending(repo, {
      message_id: card_id, household_id, user_id,
      card: { type: 'shopping', items: [{ op: 'add', label: 'сіль' }] },
    });
    await applyCard(repo, card_id, [], user_id);

    const items = await repo.listShoppingItems(household_id);
    expect(items[0]!.label).toBe('сіль');
    expect(items[0]!.value).toBeNull();
    expect(items[0]!.unit).toBeNull();
  });
});
