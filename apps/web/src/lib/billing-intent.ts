// Постановка 2026-09-25 (біллінг LiqPay) §2, §5: order_id наміру, поки людина
// без сесії — «Оформити» на картці тарифу кладе його сюди ДО редиректу на
// LiqPay (хто закрив вкладку замість повернення по result_url, інакше
// лишається без способу привʼязати сплачене), SignInForm.tsx читає й показує
// рядок «Підписка оформлена», Shell.tsx після входу привʼязує й прибирає.
const KEY = 'kos_intent';

export function setIntent(order_id: string): void {
  try { localStorage.setItem(KEY, order_id); } catch { /* приватний режим */ }
}

export function getIntent(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function clearIntent(): void {
  try { localStorage.removeItem(KEY); } catch { /* приватний режим */ }
}
