// Знак і декоративне кільце для листів → PNG (SVG у Gmail не працює).
// Малюємо в headless-браузері й знімаємо з прозорим тлом.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// 1. Знак: той самий, що в макеті листів (rect + дуга + крапка). 52 px = 2× від 26.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="128" fill="#181c21"/>
  <g transform="translate(96 96) scale(6.6667)">
    <circle cx="24" cy="24" r="19" fill="none" stroke="#eef0f1" stroke-width="3" stroke-linecap="round" stroke-dasharray="104 15" transform="rotate(-58 24 24)"/>
    <circle cx="24" cy="24" r="6" fill="#93b48b"/>
  </g>
</svg>`;

// 2. Кільце з крапкою — кутовий мотив. Центр кільця винесений за межі
// картинки вгору-праворуч, як у макеті, де кільце виходить за край картки.
const ring = (accent) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 160 160">
  <circle cx="134" cy="26" r="66" fill="none" stroke="${accent}" stroke-width="16" opacity="0.18"/>
  <circle cx="118" cy="42" r="13" fill="${accent}"/>
</svg>`;

const shots = [
  ['logo.png', logo, 104],
  ['ring-sage.png', ring('#93b48b'), 320],
  ['ring-amber.png', ring('#d2ad6b'), 320],
  ['ring-plum.png', ring('#c99ab4'), 320],
  // Заливка: кільце на шавлієвій картці — світле, як у макеті (.em.b).
  ['ring-light.png', ring('#f4f3ef'), 320],
];

for (const [name, svg, size] of shots) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: `${OUT}/${name}`, omitBackground: true });
  await page.close();
  console.log(name);
}
await browser.close();
