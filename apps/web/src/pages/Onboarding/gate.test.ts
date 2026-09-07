// @vitest-environment jsdom
//
// Крок О2 (2.2): кого пускати на знайомство з Семеном.
//
// Ламалось це тихо і на проді: новий акаунт у браузері, де онбординг бачив
// хтось інший, Семена не отримував узагалі — безіменна одиниця в localStorage
// перебивала сервер. Тому предмет тесту — саме конфлікт «сервер каже одне,
// кеш інше».

import { describe, it, expect, beforeEach } from 'vitest';
import { shouldShowOnboarding, markSeenLocally, ONBOARDING_SEEN_KEY } from './Onboarding';

const me = (id: string, seen: string | null = null) => ({ user: { id, welcome_seen_at: seen } });

beforeEach(() => { localStorage.clear(); });

describe('чи показувати знайомство', () => {
  it('сервер каже «не бачив», кеша немає — показуємо', () => {
    expect(shouldShowOnboarding(me('u1'))).toBe(true);
  });

  it('сервер каже «бачив» — не показуємо, хай кеш мовчить', () => {
    expect(shouldShowOnboarding(me('u1', '2026-09-01T10:00:00Z'))).toBe(false);
  });

  it('сервер каже «не бачив», а кеш каже «бачив» ЗА ІНШУ людину — показуємо', () => {
    // Той самий браузер, інший акаунт. Саме цей випадок і був зламаний.
    markSeenLocally('хтось-інший');
    expect(shouldShowOnboarding(me('u1'))).toBe(true);
  });

  it('стара безіменна одиниця з попередніх версій нікого не блокує', () => {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    expect(shouldShowOnboarding(me('u1'))).toBe(true);
  });

  it('кеш ТІЄЇ САМОЇ людини притримує: вона щойно дійшла до кінця, сервер ще не знає', () => {
    // Єдина робота, яка в кеша лишилась: щілина між кінцем онбордингу і
    // перечитаним /v1/me. Без неї стрічка відкинула б людину назад.
    markSeenLocally('u1');
    expect(shouldShowOnboarding(me('u1'))).toBe(false);
  });

  it('порожній id нічого не підтверджує', () => {
    markSeenLocally('');
    expect(shouldShowOnboarding(me(''))).toBe(true);
  });
});
