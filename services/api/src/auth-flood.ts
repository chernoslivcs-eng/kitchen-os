// Захист від заливання запитами магічного лінка (інцидент 30.09).
//
// Бот `python-requests` за 48 годин зробив 3 374 запити на 3 376 вигаданих
// адрес, Resend відправив ~200 листів і закрив денну квоту — вхід поштою на
// проді перестав працювати для всіх.
//
// Два висновки, які визначили форму цього модуля:
//
// 1. Лічильник у памʼяті процесу НЕ рахує. На Vercel кожен холодний старт —
//    новий інстанс зі своїм нулем, і саме тому наявний `makeRateLimiter`
//    бота не спинив. Рахуємо по таблиці `auth_challenge`: вона вже пише
//    created_at, ip і email, рядки не прибираються.
//
// 2. Відмова мусить бути НЕВІДРІЗНЯЛЬНОЮ від успіху. Інакше скрипт просто
//    вчиться обходити: бачить 429 — міняє IP, бачить іншу відповідь на
//    «погану» адресу — перебирає домени. Тому всюди та сама 202, а різниця
//    лишається тільки в логах.
import type { Repo } from '@kitchen/domain';

/** Межі. Вікна різні навмисно: сплеск з одного IP коротший, ніж з однієї адреси. */
export const FLOOD_LIMITS = {
  ip: { max: 5, windowMs: 15 * 60_000 },
  email: { max: 3, windowMs: 60 * 60_000 },
  /**
   * Глобальні межі — остання лінія, коли бот міняє і IP, і адреси. Їх дві,
   * бо справжня стеля не наша, а Resend: безплатний тариф — 100 листів на
   * добу, і коли вони вичерпані, відмовляє вже він, справжнім людям.
   *
   * Одна годинна межа цього не стримує: 30/год — це 720 за добу, тобто квота
   * згоряє до сьомої години. Тому годинна тримає сплеск, а добова — бюджет.
   *
   * 80 за добу, а не 100: лишаємо 20 на запрошення в дім і листи біллінгу —
   * вони летять через того самого Resend і в тій самій квоті.
   */
  global: { max: 30, windowMs: 60 * 60_000 },
  globalDay: { max: 80, windowMs: 24 * 60 * 60_000 },
} as const;

/**
 * Рахуємо лише магік-лінки. 'telegram' і 'tg_login' живуть у тій самій
 * таблиці, але листів не шлють і квоти не палять — якби вони рахувались,
 * хвиля входів через бота мовчки замикала б пошту справжнім людям.
 * Фільтр стоїть на ВСІХ лічильниках, не лише на глобальних: вхід ботом не
 * мусить з'їдати нічию межу, зокрема й свого IP.
 */
const MAIL_KIND = 'email' as const;

/**
 * Домени, куди лист не дійде за означенням (RFC 2606 і те, чим користувався
 * бот). Відсікаємо ДО лічильників: такі запити не мусять навіть витрачати
 * квоту лімітів, інакше бот одними вигаданими адресами замикає справжніх людей.
 */
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost']);
const RESERVED_SLD = /^example\d*\./i;

export function isUndeliverable(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return true;
  const domain = email.slice(at + 1).toLowerCase();
  // Домен без крапки — не домен: ні MX, ні доставки.
  if (!domain.includes('.')) return true;
  if (RESERVED_TLDS.has(domain.split('.').pop() ?? '')) return true;
  // example.com / example2.test2 — зарезервовані й недоставні.
  return RESERVED_SLD.test(domain);
}

export type FloodVerdict =
  | { ok: true }
  | { ok: false; reason: 'undeliverable' | 'ip' | 'email' | 'global' | 'global_day' };

export interface FloodCheckInput {
  repo: Repo;
  email: string;
  ip: string | null;
  /** Чи шле мейлер назовні: вигадані домени ріжемо лише тоді, коли горить квота. */
  delivers: boolean;
  now?: Date;
}

export async function checkAuthFlood(i: FloodCheckInput): Promise<FloodVerdict> {
  const now = i.now ?? new Date();
  const since = (ms: number) => new Date(now.getTime() - ms);

  if (i.delivers && isUndeliverable(i.email)) return { ok: false, reason: 'undeliverable' };

  if (i.ip) {
    const n = await i.repo.countChallengesSince(since(FLOOD_LIMITS.ip.windowMs), { ip: i.ip, kind: MAIL_KIND });
    if (n >= FLOOD_LIMITS.ip.max) return { ok: false, reason: 'ip' };
  }
  const byEmail = await i.repo.countChallengesSince(since(FLOOD_LIMITS.email.windowMs), { email: i.email, kind: MAIL_KIND });
  if (byEmail >= FLOOD_LIMITS.email.max) return { ok: false, reason: 'email' };

  const hour = await i.repo.countChallengesSince(since(FLOOD_LIMITS.global.windowMs), { kind: MAIL_KIND });
  if (hour >= FLOOD_LIMITS.global.max) return { ok: false, reason: 'global' };

  const day = await i.repo.countChallengesSince(since(FLOOD_LIMITS.globalDay.windowMs), { kind: MAIL_KIND });
  if (day >= FLOOD_LIMITS.globalDay.max) return { ok: false, reason: 'global_day' };

  return { ok: true };
}
