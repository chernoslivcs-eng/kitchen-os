// HTML-лист «темна кухня» (макет EMAIL-DESIGN-1003.html, шаблон `.em.c`).
//
// Правила верстки тут — не смак, а обмеження поштових клієнтів:
//   — таблиці, а не flex/grid: Outlook рендерить Word-движком;
//   — усі стилі інлайн: Gmail вирізає <style> у частині клієнтів;
//   — жодного зовнішнього ресурсу, крім двох PNG із нашого домену; SVG у Gmail
//     не показується, вебшрифти — теж не всюди;
//   — кнопка — таблиця з кольоровою клітинкою, а не <button> і не <div>;
//   — колір картки — атрибутом bgcolor І стилем: Outlook ігнорує один із них.
//
// Лист мусить читатись із вимкненими картинками: кільце декоративне (alt
// порожній), знак має alt, а тло — колір, не картинка.
import type { Letter, LetterAccent } from '@kitchen/domain/letter';
import { MAIL_SIGNATURE, letterText } from '@kitchen/domain/letter';

/**
 * Кольори з макета EMAIL-DESIGN-1003: `.em.c` — темна кухня, `.em.b` —
 * шавлієва заливка. Міняти — лише разом із макетом.
 */
const ACCENT: Record<LetterAccent, { fill: string; on: string }> = {
  sage: { fill: '#93b48b', on: '#141a12' },
  amber: { fill: '#d2ad6b', on: '#141a12' },
  plum: { fill: '#c99ab4', on: '#141a12' },
};

interface Palette {
  bg: string; card: string; border: string | null;
  text: string; head: string; foot: string; brand: string;
  button: { fill: string; on: string };
  /** Яке кільце брати: у заливці воно світле, у темному — за акцентом. */
  ring: string;
}

const DARK = (accent: LetterAccent): Palette => ({
  bg: '#0c0d0f', card: '#1f2226', border: '#33383e',
  text: '#d9d8d3', head: '#ffffff', foot: '#a3a7ac', brand: '#ecebe7',
  button: ACCENT[accent], ring: accent,
});

// Заливка: тло сторінки світле, картка — шавлієва, і на ній усе навпаки —
// світлий текст, світла кнопка з темним написом. Підпис під карткою стоїть на
// світлому тлі, тому він темний, а не сірий.
const FILLED: Palette = {
  bg: '#e8efe3', card: '#55724a', border: null,
  text: '#f4f3ef', head: '#ffffff', foot: '#2f4428', brand: '#f4f3ef',
  button: { fill: '#f4f3ef', on: '#2f4428' }, ring: 'light',
};
/**
 * Лапки в стеку шрифтів — ОДИНАРНІ навмисно. Стилі в листі інлайнові, тобто
 * живуть усередині атрибута `style="…"`; подвійна лапка в «Segoe UI» закривала
 * б атрибут посеред значення, і далі ламалось усе — колір, вирівнювання,
 * підкреслення на кнопці. У рендері це видно одразу: лист малюється серифом.
 */
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface RenderOpts {
  /** Звідки брати PNG — повний origin, бо в пошті відносних шляхів не буває. */
  assetsBase: string;
}

/**
 * HTML і text/plain того самого листа. Обидві частини обовʼязкові (спек
 * §Вимоги): клієнт, який не вміє HTML, і фільтри, які не люблять листів без
 * текстової частини, мусять бачити те саме.
 */
export function renderLetter(letter: Letter, opts: RenderOpts): { html: string; text: string } {
  const pal = letter.look === 'filled' ? FILLED : DARK(letter.accent);
  const a = pal.button;
  const base = opts.assetsBase.replace(/\/$/, '');
  const esc = escapeHtml;

  const paragraphs = letter.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${pal.text};">${esc(p)}</p>`)
    .join('');

  // Куленепробивна кнопка: таблиця з однією клітинкою. padding — на клітинці,
  // не на посиланні: Outlook не малює padding у <a>.
  const button = letter.button ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
            <tr>
              <td bgcolor="${a.fill}" style="border-radius:999px;background:${a.fill};">
                <a href="${esc(letter.button.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1;color:${a.on};text-decoration:none;border-radius:999px;">${esc(letter.button.label)}</a>
              </td>
            </tr>
          </table>` : '';

  // Запасний рядок — лише там, де кнопка і є вся дія.
  const fallback = letter.button && letter.fallbackLink ? `
          <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${pal.foot === '#2f4428' ? pal.text : pal.foot};">Якщо кнопка не працює, відкрий посилання:<br><a href="${esc(letter.button.url)}" style="color:${a.fill};">${esc(letter.button.url)}</a></p>` : '';

  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(letter.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${pal.bg};">
<!-- Прихований рядок прев'ю: інакше клієнт підтягує в список перший видимий текст. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(letter.paragraphs[0] ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${pal.bg}" style="background:${pal.bg};">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" bgcolor="${pal.card}" style="width:100%;max-width:440px;background:${pal.card};${pal.border ? `border:1px solid ${pal.border};` : ''}border-radius:20px;">
        <tr>
          <td style="padding:26px;font-family:${FONT};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left" valign="top" style="font-family:${FONT};font-size:15px;font-weight:600;color:${pal.brand};">
                  <!-- alt порожній навмисно: назва стоїть текстом поруч, і з
                       вимкненими картинками «Kitchen OS» читалося б двічі. -->
                  <img src="${base}/email/logo.png" width="26" height="26" alt="" style="vertical-align:middle;border:0;border-radius:7px;">
                  <span style="vertical-align:middle;padding-left:9px;">Kitchen OS</span>
                </td>
                <td align="right" valign="top" width="80">
                  <img src="${base}/email/ring-${pal.ring}.png" width="80" height="80" alt="" style="display:block;border:0;">
                </td>
              </tr>
            </table>
            <h1 style="margin:10px 0 14px;font-size:24px;line-height:1.2;font-weight:700;color:${pal.head};">${esc(letter.subject)}</h1>
            ${paragraphs}${button}${fallback}
          </td>
        </tr>
      </table>
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:440px;">
        <tr>
          <td style="padding:16px 6px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${pal.foot};">
            ${esc(MAIL_SIGNATURE)}<br>${esc(letter.reason)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { html, text: letterText(letter) };
}
