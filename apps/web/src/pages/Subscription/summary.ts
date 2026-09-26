// Постановка 2026-09-25 (режим без підписки), Task 12: спільне між рядком у
// профілі (один рядок) і екраном «Підписка» (детальний верхній рядок,
// спек §4 дослівно) — лише формат дати (DD.MM, з бандла Kitchen OS -
// Subscription.dc.html, не «12 вересня», як у paywall.ts bannerFor).
import type { Me } from '../../api';
import { PLAN_NAME } from '@kitchen/domain/plans';

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Пункт «Підписка» в профілі — стан одним коротким рядком. */
export function subscriptionRowSummary(sub: Me['subscription']): string {
  if (!sub) return '';
  switch (sub.state) {
    case 'beta': return 'Бета-тест';
    case 'trial': return sub.trial_ends_at ? `Пробний до ${fmtDate(sub.trial_ends_at)}` : 'Пробний';
    case 'active': return sub.plan ? PLAN_NAME[sub.plan] : 'Активна';
    case 'cancelled': return sub.access_until ? `Скасовано · до ${fmtDate(sub.access_until)}` : 'Скасовано';
    case 'past_due': return 'Оплата не пройшла';
    case 'lapsed': return 'Не оформлено';
    default: return '';
  }
}
