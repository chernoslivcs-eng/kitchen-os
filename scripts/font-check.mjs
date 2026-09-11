#!/usr/bin/env node
// Хотфікс 11.09: перевірка шрифту на ЖИВОМУ хості — лише читання (жодного
// входу, жодних записів): відкриває лендинг, чекає document.fonts.ready і
// каже, чи Onest завантажився; знімок — у --out.
//
//   node scripts/font-check.mjs --url https://kitchen-os-coral.vercel.app --out out/font-after.png
import { chromium } from '@playwright/test';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('url', 'http://localhost:5173'); const OUT = arg('out', null);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.goto(URL_, { waitUntil: 'networkidle' });
const r = await p.evaluate(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].map((f) => `${f.family.replace(/"/g, '')}:${f.status}`);
  return { ok: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Onest' && f.status === 'loaded'), faces };
});
if (OUT) await p.screenshot({ path: OUT, fullPage: false });
console.log(`${URL_} → Onest ${r.ok ? 'завантажено' : 'НЕ завантажено'} · faces: ${r.faces.join(', ') || 'порожньо'}${OUT ? ` · ${OUT}` : ''}`);
await b.close();
process.exit(r.ok ? 0 : 1);
