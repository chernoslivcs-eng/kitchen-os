// П5 прибрав картку поля профілю — разом із нею померла перевірка
// `profile-field:X` на п'яти фікстурах. Питання, яке вони ставили, живе:
// чи розрізняє модель «Мені не можна» / «Я не їм» / «Я не дуже люблю».
// Відповідь тепер шукається в РЕПЛІЦІ (kitchen-policy.md, рядок 4 велить
// назвати поле), і цей файл стереже саме розбір репліки — щоб інваріант не
// брехав у той бік, у який брехати найлегше: зеленів на будь-якому тексті.
import { describe, it, expect } from 'vitest';
import { resolve } from '../invariants.js';
import type { Fixture } from '../fixtures/index.js';

const fx = { invariants: [] } as unknown as Fixture;
const run = (name: string, reply: string) =>
  resolve(name)({ raw: '', reply } as never, fx);

describe('reply-names-field', () => {
  it('репліка назвала потрібне поле — зелено', () => {
    expect(run('reply-names-field:meh', 'Це в „Я не дуже люблю" — впиши сама.').pass).toBe(true);
    expect(run('reply-names-field:no', 'Це рядок «Я не їм», впиши сама.').pass).toBe(true);
    expect(run('reply-names-field:ban', 'Це «Мені не можна» — впиши сама.').pass).toBe(true);
  });

  it('назвала ІНШЕ поле — червоно, і в деталі видно яке', () => {
    // Рівно та помилка, заради якої трійка кінзи й існує.
    const v = run('reply-names-field:meh', 'Це в „Я не їм", впиши сама.');
    expect(v.pass).toBe(false);
    expect(v.detail).toContain('no');
  });

  it('поля не названо взагалі — червоно', () => {
    expect(run('reply-names-field:no', 'Добре, врахую.').pass).toBe(false);
  });

  it('«я не дуже люблю» не зараховується за «я люблю»', () => {
    // Одна фраза — підрядок другої, і без цього love зеленів би на meh.
    expect(run('reply-names-field:love', 'Це в „Я не дуже люблю".').pass).toBe(false);
    expect(run('reply-names-field:love', 'Це в „Я люблю".').pass).toBe(true);
  });

  it('репліка, що назвала й друге поле, лишається зеленою — але каже про це', () => {
    const v = run('reply-names-field:ban', 'Це не „Я не їм", а «Мені не можна» — впиши сама.');
    expect(v.pass).toBe(true);
    expect(v.detail).toContain('no');
  });

  it('невідоме поле — червоно, а не мовчазний пропуск', () => {
    expect(run('reply-names-field:вигадане', 'будь-що').pass).toBe(false);
  });
});
