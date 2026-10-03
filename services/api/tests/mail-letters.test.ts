// Усі листи продукту (спек EMAIL-SPEC-1003, макет EMAIL-DESIGN-1003).
//
// На кожен лист перевіряємо те, що видно людині й ламається тихо: тему, тіло
// дослівно, адресу кнопки, відсутність суми та наявність текстової частини.
// Лист 6 — єдиний із сумою, і це вимога оферти §4, а не недогляд.
import { describe, it, expect } from 'vitest';
import { MAIL, SUBSCRIPTION_PATH } from '@kitchen/domain/paywall';
import type { Letter } from '@kitchen/domain/letter';
import { PLAN_PRICE_UAH } from '@kitchen/domain/plans';
import { renderLetter } from '../src/mail-template.js';

const APP = 'https://kitchen-os.app';
const SUB = `${APP}${SUBSCRIPTION_PATH}`;

/** Видимий текст листа: без тегів, стилів і прихованого рядка прев'ю. */
function visible(h: string): string {
  return h.replace(/<div style="display:none[\s\S]*?<\/div>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const render = (l: Letter) => {
  const r = renderLetter(l, { assetsBase: APP });
  return { ...r, seen: visible(r.html) };
};

const noMoney = (l: Letter) => {
  const { seen, text } = render(l);
  for (const where of [seen, text]) {
    expect(where).not.toMatch(/₴|грн|гривен/i);
    for (const price of Object.values(PLAN_PRICE_UAH)) {
      expect(where, `сума ${price}`).not.toMatch(new RegExp(`(^|\\D)${price}(\\D|$)`));
    }
  }
};

describe('лист 1 · вхід', () => {
  const l = MAIL.login(15, 'https://kitchen-os.app/v1/auth/verify?token=abc');
  it('тема, тіло, кнопка «Зайти» на сам лінк', () => {
    expect(l.subject).toBe('Заходь у Kitchen OS');
    expect(l.paragraphs).toEqual(['Ось двері. Лінк для входу працює 15 хвилин. Якщо це був не ти — нічого робити не треба.']);
    expect(l.button).toEqual({ label: 'Зайти', url: 'https://kitchen-os.app/v1/auth/verify?token=abc' });
  });
  it('запасний рядок із лінком — тут кнопка і є вся дія', () => {
    const { seen, text } = render(l);
    expect(seen).toContain('Якщо кнопка не працює');
    expect(text).toContain('Зайти: https://kitchen-os.app/v1/auth/verify?token=abc');
  });
  it('причина — про введену адресу, не про дім', () => {
    expect(l.reason).toBe('Цей лист прийшов, бо хтось увів твою адресу на kitchen-os.app.');
  });
  it('без суми', () => noMoney(l));
});

describe('лист 3 · демо почалось', () => {
  const l = MAIL.demoStarted('10 жовтня', `${APP}/app`);
  it('шавлієва заливка, кнопка «Почати» у застосунок', () => {
    expect(l.subject).toBe('Можна починати з кухні');
    expect(l.look).toBe('filled');
    expect(l.button).toEqual({ label: 'Почати', url: `${APP}/app` });
  });
  it('тіло дослівно, з датою', () => {
    expect(l.paragraphs[0]).toBe('Радий, що ти тут. До 10 жовтня можна спокійно користуватись усім Kitchen OS без картки: показувати продукти, питати, що приготувати, вести комору й готувати по кроках.');
    expect(l.paragraphs[1]).toBe('За ці сім днів якраз стане зрозуміло, чи воно тобі взагалі треба.');
  });
  it('заливка малюється своїми кольорами, не темними', () => {
    const { html } = render(l);
    expect(html).toContain('#e8efe3');      // тло листа
    expect(html).toContain('#55724a');      // картка
    expect(html).toContain('ring-light.png');
    expect(html).not.toContain('#0c0d0f');
  });
  it('без суми', () => noMoney(l));
});

describe('лист 5 · режим перегляду', () => {
  it('5а після демо: «Я все лишив як було», кнопка «Про підписку»', () => {
    const l = MAIL.lapsed('demo', SUB);
    expect(l.subject).toBe('Я все лишив як було');
    expect(l.paragraphs[0]).toContain('Усе, що ми тут назбирали, лишилось на місці');
    expect(l.button).toEqual({ label: 'Про підписку', url: SUB });
    expect(l.accent).toBe('plum');
    noMoney(l);
  });

  // Спек §Уточнення: 5б — після cancelled / past_due / trial. Для людини це
  // інша подія: підписка справді завершилась, а не скінчилось безкоштовне.
  it.each(['cancelled', 'past_due', 'trial', null] as const)('5б після %s: «Нехай поки все побуде тут»', (from) => {
    const l = MAIL.lapsed(from, SUB);
    expect(l.subject).toBe('Нехай поки все побуде тут');
    expect(l.paragraphs[0]).toContain('Підписка завершилась, а кухня лишилась як була');
    expect(l.button).toEqual({ label: 'Продовжити', url: SUB });
    noMoney(l);
  });
});

describe('лист 6 · перший місяць', () => {
  const l = MAIL.trialEnds('12 жовтня', '12', 290, SUB);
  it('ЄДИНИЙ лист із сумою — вимога оферти §4: дата й сума наперед', () => {
    expect(l.subject).toBe('Перший місяць почнеться 12 жовтня');
    expect(l.paragraphs[0]).toBe('Ми вже трохи пожили на одній кухні. 12 жовтня починається перший місяць підписки Kitchen OS. Вартість — 290 ₴, оплата з картки •••• 12.');
    expect(l.paragraphs[1]).toBe('Якщо поки не хочеться продовжувати, підписку можна скасувати до 12 жовтня.');
    expect(render(l).text).toContain('290 ₴');
  });
  // Маски немає — речення обривається на сумі. «•••• ····» ми не малюємо:
  // це була б вигадка про чужий номер.
  it('без маски картки — без хвоста про картку', () => {
    const bare = MAIL.trialEnds('12 жовтня', null, 210, SUB);
    expect(bare.paragraphs[0]).toContain('Вартість — 210 ₴.');
    expect(bare.paragraphs[0]).not.toContain('картки');
    expect(bare.paragraphs[0]).not.toContain('••••');
  });
});

describe('лист 7 · тихий дім', () => {
  const l = MAIL.deletionWarning(`${APP}/app`);
  it('тема, тіло, кнопка «Зайти»', () => {
    expect(l.subject).toBe('Тут давно ніхто не готував');
    expect(l.paragraphs[0]).toBe('Цей дім уже пів року стоїть тихенько. Через 30 днів я видалю його дані: комору, список, рецепти й журнал.');
    expect(l.paragraphs[1]).toBe('Якщо вони ще потрібні, достатньо зайти — навіть нічого готувати не доведеться.');
    expect(l.button).toEqual({ label: 'Зайти', url: `${APP}/app` });
  });
  it('без суми', () => noMoney(l));
});

describe('спільне для всіх листів', () => {
  const all: Array<[string, Letter]> = [
    ['1 вхід', MAIL.login(15, `${APP}/v`)],
    ['3 демо почалось', MAIL.demoStarted('10 жовтня', `${APP}/app`)],
    ['4 демо закінчується', MAIL.demoEnding('9 жовтня', SUB)],
    ['5а', MAIL.lapsed('demo', SUB)],
    ['5б', MAIL.lapsed('cancelled', SUB)],
    ['6', MAIL.trialEnds('12 жовтня', '12', 290, SUB)],
    ['7', MAIL.deletionWarning(`${APP}/app`)],
  ];

  it.each(all)('%s: тема в заголовку, текстова частина з тими самими абзацами', (_n, l) => {
    const { html, text, seen } = render(l);
    expect(html).toContain(`<title>`);
    expect(seen).toContain(l.subject);
    for (const p of l.paragraphs) expect(text).toContain(p);
    expect(text).toContain('Kitchen OS · hello@kitchen-os.app');
    expect(text).toContain(l.reason);
  });

  it.each(all)('%s: кнопка веде туди, куди сказано, і тільки на наш домен', (_n, l) => {
    const { html } = render(l);
    expect(l.button).toBeTruthy();
    expect(html).toContain(`href="${l.button!.url}"`);
    for (const u of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!)) {
      expect(u.startsWith(APP), u).toBe(true);
    }
  });

  // Спек §Принципи 3: без «Привіт», без підпису-прощання, без роду адресата.
  it.each(all)('%s: без вітання, без прощання, без роду', (_n, l) => {
    const body = l.paragraphs.join(' ');
    expect(body).not.toMatch(/^Привіт|Вітаю|З повагою|Гарного дня/i);
    expect(body).not.toMatch(/\b(рада|радий був|дорога|шановна|шановний)\b/i);
  });
});
