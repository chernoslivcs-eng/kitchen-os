// AUTH-BRIEF-0915: дефолт режиму на лендингу — «Почати» для нових людей,
// «Увійти» для тих, хто вже мав тут сесію на цьому браузері. Ставимо ознаку
// при УСПІШНОМУ вході (store/auth.ts refresh() → status signed_in), тому
// перший вхід і досі бачить «Почати» — саме туди він і мав потрапити.
const KEY = 'kos-had-session';

export function markHadSession(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* приватний режим */ }
}

export function hadSession(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
