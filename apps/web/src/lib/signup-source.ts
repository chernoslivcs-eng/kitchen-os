// Джерело реєстрації: мітки посилання (utm_source, utm_medium, utm_campaign,
// utm_content, ref), з якими людина ВПЕРШЕ прийшла на сайт. Той самий зразок,
// що намір оплати (lib/billing-intent.ts): кладемо в localStorage на вході, бо
// до реєстрації ще кілька сторінок і, можливо, кілька днів.
//
// «Перший дотик виграє»: якщо мітки вже лежать, новий захід з іншими їх не
// перезаписує — людину привів той канал, з якого вона прийшла вперше. Захід
// без міток нічого не кладе й нічого не займає.
//
// На сервер мітки їдуть разом із кожним способом входу (api.ts: auth.request,
// auth.googleUrl, auth.telegramBegin, invites.accept) і записуються лише коли
// вхід СТВОРЮЄ акаунт. Після входу прибираємо (store/auth.ts) — свою роботу
// вони зробили.
//
// Сторонніх скриптів тут немає й не треба: мітки читаємо з власної адреси.
import { cleanSignupMarks, signupMarksFromSearch, type SignupMarks } from '@kitchen/domain/signup-source';

const KEY = 'kos_src';

// Приватний режим: localStorage кидає на запис. Тримаємо мітки хоча б до кінця
// цієї вкладки — вхід поштою чи Telegram сторінку не покидає.
let memory: SignupMarks | null = null;

export function getSignupSource(): SignupMarks | null {
  try {
    const raw = localStorage.getItem(KEY);
    // Чистимо й на читанні: у сховище людина може вписати що завгодно.
    if (raw) return cleanSignupMarks(JSON.parse(raw));
  } catch { /* приватний режим або зіпсований запис */ }
  return memory;
}

/** Забрати мітки з адреси й запамʼятати, якщо це перший мічений захід. Повертає те, що лежить після виклику. */
export function captureSignupSource(search: string): SignupMarks | null {
  const first = getSignupSource();
  if (first) return first;
  const marks = signupMarksFromSearch(search);
  if (!marks) return null;
  memory = marks;
  try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch { /* приватний режим */ }
  return marks;
}

export function clearSignupSource(): void {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* приватний режим */ }
}
