// Скло v3.1, продуктивність: ідл-трейс Chromium (devtools.timeline) — скільки
// Paint / Layout / UpdateLayerTree подій за 3 с спокою на екрані зі скляними
// поверхнями. Очікування: нуль — live-знаки рухаються на композиторі, скло з
// contain: paint не перемальовується без причини.
//
//   node scripts/glass-paint-trace.mjs URL STATE_JSON [CLICK_SEL] [STUB_JSON] [WIDTH]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const [url, statePath, click, stub, width] = process.argv.slice(2);
const W = Number(width || 1440);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: W <= 480 ? 844 : 900 }, storageState: statePath, ...(W < 768 ? { isMobile: true, hasTouch: true } : {}) });
const page = await ctx.newPage();
if (stub) {
  const extra = JSON.parse(readFileSync(stub, 'utf8'));
  await page.route(/\/v1\/(session\/today|sessions\/[^/?]+)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch(); const body = await res.json();
    const base = Date.now();
    body.messages = [...(body.messages ?? []), ...extra.map((m, i) => ({ id: `stub-${i}`, session_id: body.session?.id ?? '', role: 'assistant', text: null, card: null, applied: 0, created_at: new Date(base + 60_000 * (i + 1)).toISOString(), ...m }))];
    await route.fulfill({ response: res, json: body });
  });
}
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
if (click) { await page.click(click); await page.waitForTimeout(800); }
const cdp = await ctx.newCDPSession(page);
await cdp.send('Tracing.start', { categories: 'disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
const events = [];
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
await page.waitForTimeout(3000);
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.end'); await done;
const count = (n) => events.filter((e) => e.name === n).length;
const paints = events.filter((e) => e.name === 'Paint');
const area = paints.reduce((a, e) => a + ((e.args?.data?.clip) ? 1 : 0), 0);
const names = {}; for (const e of events) names[e.name] = (names[e.name] ?? 0) + 1;
console.log(JSON.stringify({ url, events: events.length, top: Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 8), frames: count('DrawFrame') + count('BeginFrame'), Paint: count('Paint'), Layout: count('Layout'), UpdateLayerTree: count('UpdateLayerTree'), Composite: count('CompositeLayers'), clips: area }));
await browser.close();
