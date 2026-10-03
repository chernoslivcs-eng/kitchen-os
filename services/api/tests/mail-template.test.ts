// Шаблон «темна кухня» і лист 4 (спек EMAIL-SPEC-1003, макет EMAIL-DESIGN-1003).
//
// Перевіряємо те, що ламається тихо й помітне лише в чужій поштовій скриньці:
// суму в листі, де її не має бути; адресу кнопки; відсутню текстову частину;
// неекрановану змінну; зовнішній ресурс, який у Gmail не завантажиться.
import { describe, it, expect } from 'vitest';
import { MAIL, SUBSCRIPTION_PATH } from '@kitchen/domain/paywall';
import { letterText } from '@kitchen/domain/letter';
import { renderLetter } from '../src/mail-template.js';

const APP = 'https://kitchen-os.app';
const letter = MAIL.demoEnding('9 жовтня', `${APP}${SUBSCRIPTION_PATH}`);
const { html, text } = renderLetter(letter, { assetsBase: APP });

describe('лист 4 · демо закінчується', () => {
  it('тема й заголовок у тілі — той самий рядок', () => {
    expect(letter.subject).toBe('Хороші речі можна не закінчувати');
    expect(html).toContain('>Хороші речі можна не закінчувати</h1>');
    expect(html).toContain('<title>Хороші речі можна не закінчувати</title>');
  });

  it('тіло — дослівно зі спека, з датою на місці', () => {
    expect(letter.paragraphs[0]).toBe(
      'Сім днів — достатньо, щоб трохи придивитись одне до одного. 9 жовтня демо завершується, і дім переходить у режим перегляду. Усе зібране лишається твоїм і видимим.',
    );
    expect(letter.paragraphs[1]).toBe(
      'Підписка — це спосіб лишити Kitchen OS у цій щоденній рутині; деталі зібрав на одній сторінці.',
    );
  });

  // Принцип 1 зі спека: ціни живуть на сторінці підписки, не в листі. Привід —
  // відгук тестувальниці: «тільки зрозуміла, що ви грошей хочете».
  it('жодної суми — ні в html, ні в тексті', () => {
    for (const s of [html, text]) {
      expect(s).not.toMatch(/\d+\s*₴/);
      expect(s).not.toContain('210');
      expect(s).not.toContain('290');
    }
  });

  it('кнопка «Про підписку» веде на сторінку підписки', () => {
    expect(letter.button).toEqual({ label: 'Про підписку', url: `${APP}/profile/subscription` });
    expect(html).toContain(`href="${APP}/profile/subscription"`);
    expect(html).toContain('>Про підписку</a>');
    expect(text).toContain(`${APP}/profile/subscription`);
  });

  it('текстова частина несе ті самі абзаци — клієнт без розмітки не лишається ні з чим', () => {
    for (const p of letter.paragraphs) expect(text).toContain(p);
    expect(text).toContain('Kitchen OS · hello@kitchen-os.app');
    expect(text).toContain('Ти отримуєш цей лист, бо маєш дім у Kitchen OS.');
  });

  it('запасного рядка «якщо кнопка не працює» тут немає — він лише для входу й запрошення', () => {
    expect(html).not.toContain('Якщо кнопка не працює');
  });
});

describe('шаблон «темна кухня»', () => {
  it('бурштиновий акцент для листа 4: кнопка й кільце того самого кольору', () => {
    expect(letter.accent).toBe('amber');
    expect(html).toContain('#d2ad6b');
    expect(html).toContain('/email/ring-amber.png');
    expect(html).not.toContain('ring-sage.png');
  });

  it('жодного зовнішнього ресурсу, крім двох PNG із нашого домену', () => {
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    for (const u of urls) {
      expect(u.startsWith(APP), u).toBe(true);
    }
    // Вебшрифтів і <style> немає зовсім: Gmail вирізає перше й ріже друге.
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('.svg');
  });

  it('таблична верстка з кольором і атрибутом, і колірна схема оголошена', () => {
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('bgcolor="#1f2226"');     // Outlook ігнорує style
    expect(html).toContain('background:#1f2226');     // решта ігнорує bgcolor
    expect(html).toContain('name="color-scheme" content="light dark"');
  });

  // Обидві картинки декоративні: назва бренду стоїть поруч ТЕКСТОМ, тож із
  // вимкненими картинками лист читається без втрат і без повторів.
  it('обидві картинки з порожнім alt, а назва — текстом', () => {
    expect(html).toMatch(/logo\.png[^>]*alt=""/);
    expect(html).toMatch(/ring-amber\.png[^>]*alt=""/);
    expect(html).toContain('>Kitchen OS</span>');
    expect(html).not.toContain('alt="Kitchen OS"');
  });

  it('змінні екрануються — чужі лапки й кутові дужки не ламають розмітки', () => {
    const evil = renderLetter(
      { subject: 'a<b>&"', paragraphs: ['<script>alert(1)</script>'], reason: 'r', accent: 'plum', button: { label: '"x"', url: 'https://x.test/?a=1&b=2' } },
      { assetsBase: APP },
    ).html;
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('https://x.test/?a=1&amp;b=2');
  });

  it('запасний рядок зʼявляється, коли лист того просить', () => {
    const l = { subject: 's', paragraphs: ['p'], reason: 'r', accent: 'sage' as const, button: { label: 'Зайти', url: 'https://x.test/go' }, fallbackLink: true };
    const r = renderLetter(l, { assetsBase: APP });
    expect(r.html).toContain('Якщо кнопка не працює');
    expect(letterText(l)).toContain('Зайти: https://x.test/go');
  });
});
