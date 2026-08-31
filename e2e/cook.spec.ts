// П.5 pre-deploy: Cook Mode у прод-бандлі — deadline-таймер, крок
// назад/вперед, resume після «✕». Свідоме відхилення від «компонентних
// тестів з fake timers»: e2e проти прод-збірки ловить той самий клас
// (QA8-03 подвоєння тіку жило в різниці dev/prod), але міряє СПРАВЖНІЙ
// час у справжньому браузері. 0 модельних викликів: рецепт створюється
// через API.

import { test, expect } from '@playwright/test';

const RECIPE = {
  t: 'Е2Е таймер-страва', sv: 1, tm: 5, ch: 'швидко', d: 'перевірка', rk: '',
  ing: [{ n: 'вода', v: 100, u: 'ml' }],
  st: [
    { t: 'Кипʼятити', c: 'Кипʼятити {0}', s: 120 },
    { t: 'Остудити', c: 'Остудити {0}' },
  ],
};

test.use({ storageState: 'e2e/.auth/state.json' });

test('таймер точний, кроки ходять, resume після виходу', async ({ page }) => {
  const created = await page.request.post('/v1/recipes', { data: { recipe: RECIPE } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();

  await page.goto(`/recipe/${id}`);
  await page.getByRole('button', { name: 'Cook Mode' }).click();

  // поп-ап: прогрес зверху, URL не змінився
  await expect(page).toHaveURL(new RegExp(`/recipe/${id}`));
  await expect(page.getByText('Е2Е ТАЙМЕР-СТРАВА · КРОК 1/2')).toBeVisible();

  // deadline-таймер: Пуск → ~3с → 2:00 стало 1:57±1 (не 1:54 — тік не подвоєний)
  await expect(page.getByText('2:00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Пуск' }).click();
  await page.waitForTimeout(3100);
  const val = await page.locator('div', { hasText: /^1:5\d$/ }).last().textContent();
  const secs = Number(val!.split(':')[1]);
  expect(secs).toBeGreaterThanOrEqual(56);
  expect(secs).toBeLessThanOrEqual(58);

  // крок готово → 2/2; назад → 1/2
  await page.getByRole('button', { name: /Крок готово/ }).click();
  await expect(page.getByText('Е2Е ТАЙМЕР-СТРАВА · КРОК 2/2')).toBeVisible();
  await page.getByRole('button', { name: 'Крок назад' }).click();
  // ✕ — поп-ап закрився, сторінка та сама, resume-стан живий
  await page.getByRole('button', { name: /Вийти/ }).click();
  await expect(page.getByText('Е2Е ТАЙМЕР-СТРАВА · КРОК 1/2')).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/recipe/${id}`));
  const saved = await page.evaluate(() => localStorage.getItem('kos-cook-live'));
  expect(saved).toContain('Е2Е таймер-страва');

  // прибираємо за собою
  await page.evaluate(() => localStorage.removeItem('kos-cook-live'));
  await page.request.delete(`/v1/recipes/${id}`);
});
