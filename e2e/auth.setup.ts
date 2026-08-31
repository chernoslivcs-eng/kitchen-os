// Один логін на весь прогін + кеш стану МІЖ прогонами: auth-ліміт суворий
// (5 запитів/15 хв на email), тому жива кука реюзається, а запит磁
// магік-лінка йде лише коли стан протух.
import { test as setup, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const EMAIL = 'e2e-smoke@example.com';
const STATE = 'e2e/.auth/state.json';

setup('логін магік-лінком (з кешем стану)', async ({ browser }) => {
  if (existsSync(STATE)) {
    const ctx = await browser.newContext({ storageState: STATE });
    const me = await ctx.request.get('http://localhost:4173/v1/me');
    await ctx.close();
    if (me.ok()) return;   // кука жива — логін не потрібен
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const req = await page.request.post('/v1/auth/request', { data: { email: EMAIL } });
  expect(req.ok()).toBeTruthy();
  const log = readFileSync('.qa-magic-links.log', 'utf-8');
  const link = [...log.trim().split('\n')].reverse().find((l) => l.includes('token='))!;
  const token = /token=([^\s&]+)/.exec(link)![1];
  const verify = await page.request.get(`/v1/auth/verify?token=${token}`);
  expect(verify.ok()).toBeTruthy();
  await page.goto('/app');
  await expect(page.getByPlaceholder(/Записати в журнал/)).toBeVisible();
  await ctx.storageState({ path: STATE });
  await ctx.close();
});
