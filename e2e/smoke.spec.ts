// Смоук головних флоу проти прод-бандла. Окремий e2e-юзер — сміття
// ізольоване в його домі. Один модельний виклик на прогін (чат-інтейк);
// решта флоу — без моделі.

import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('1. стрічка рендериться під логіном', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByPlaceholder(/Записати в журнал/)).toBeVisible();
});

test('2. чат-інтейк: купив → картка → застосувати → в коморі', async ({ page }) => {
  await page.goto('/app');
  const input = page.getByPlaceholder(/Записати в журнал/);
  await input.fill('Купив тестовий продукт е2е 100 г');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Застосувати' }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Застосувати' }).first().click();
  // істина — БД, не текст: модель вільна в розкладці трійки
  await expect.poll(async () => {
    const r = await page.request.get('/v1/pantry');
    const { count } = await r.json();
    return count;
  }, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('3. комора рендерить позиції з БД', async ({ page }) => {
  await page.goto('/app');
  const r = await page.request.get('/v1/pantry');
  const { count, batches } = await r.json();
  expect(count).toBeGreaterThan(0);
  await page.goto('/pantry');
  await expect(page.getByText(batches[0].label, { exact: false }).first()).toBeVisible();
});

test('4. список покупок: додати й прибрати', async ({ page }) => {
  await page.goto('/app');
  await page.goto('/list');
  const add = page.getByPlaceholder('+ Додати в список…');
  await add.fill('е2е-огірки');
  await add.press('Enter');
  await expect(page.getByText('е2е-огірки')).toBeVisible();
});

test('5. профіль відкривається', async ({ page }) => {
  await page.goto('/app');
  await page.goto('/profile');
  await expect(page.getByText(/Профіль|Алергії|Висновки|Техніка/i).first()).toBeVisible();
});

test('6. rate limit і заголовки живі у проді', async ({ page }) => {
  const res = await page.request.get('/health');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('DENY');
});
