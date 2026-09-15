// Чиста логіка автентифікації: генерація токенів, гешування, час життя.
// Не знає про HTTP, cookie або пошту — це шар над Repo.

import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { Repo, UserRow } from './repo.js';
import type { AuthChallenge, AuthSession, UserContext } from './types.js';

const CHALLENGE_TTL_MIN = 15;
const SESSION_TTL_DAYS = 30;

export const CHALLENGE_TTL_MS = CHALLENGE_TTL_MIN * 60_000;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 86_400_000;

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

// Одноразовий токен для листа. base64url без паддингу, 32 байти ентропії — достатньо
// проти брутфорсу за 15 хв TTL, коротший за URL-безпечний JWT.
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return sha256(raw);
}

// Створити нову сесію для user_id. Виносимо із verifyChallenge, щоб той самий
// код використовувався для magic-link і для invite accept — інакше два потоки
// поволі розійдуться в деталях (TTL, поля, атрибути).
export async function openSession(
  repo: Repo,
  user_id: string,
  ip?: string | null,
  user_agent?: string | null,
): Promise<{ session: AuthSession; raw_cookie: string }> {
  const raw_cookie = randomToken();
  const now = new Date();
  const session: AuthSession = {
    id: randomUUID(),
    user_id,
    cookie_hash: sha256(raw_cookie),
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    revoked_at: null,
    ip: ip ?? null,
    user_agent: user_agent ?? null,
  };
  await repo.saveSession(session);
  return { session, raw_cookie };
}

export interface RequestChallengeInput {
  email: string;
  ip?: string | null;
  user_agent?: string | null;
}

export interface RequestChallengeResult {
  challenge: AuthChallenge;
  raw_token: string;                 // єдиний момент, коли ми його бачимо — далі летить у лист
}

export async function requestChallenge(repo: Repo, input: RequestChallengeInput): Promise<RequestChallengeResult> {
  const raw = randomToken();
  const now = new Date();
  const challenge: AuthChallenge = {
    id: randomUUID(),
    email: input.email.toLowerCase(),
    token_hash: sha256(raw),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    consumed_at: null,
    ip: input.ip ?? null,
    user_agent: input.user_agent ?? null,
  };
  await repo.saveChallenge(challenge);
  return { challenge, raw_token: raw };
}

export interface VerifyChallengeResult {
  session: AuthSession;
  raw_cookie: string;                // єдиний момент, коли ми його бачимо — далі летить у Set-Cookie
  user_id: string;
  household_id: string;
}

export type VerifyOutcome =
  | { ok: true; result: VerifyChallengeResult }
  | { ok: false; reason: 'not_found' | 'expired' | 'consumed' };

export async function verifyChallenge(repo: Repo, raw_token: string, ip?: string | null, user_agent?: string | null): Promise<VerifyOutcome> {
  const token_hash = sha256(raw_token);
  const challenge = await repo.getChallengeByHash(token_hash);
  if (!challenge) return { ok: false, reason: 'not_found' };
  if (challenge.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(challenge.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  await repo.consumeChallenge(challenge.id);

  // PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): разовий лінк у веб із бота — сесія
  // вже відомого user, без пошти.
  if (challenge.kind === 'telegram' && challenge.user_id) {
    const household_id = await repo.firstHouseholdOf(challenge.user_id);
    if (!household_id) return { ok: false, reason: 'not_found' };
    const { session, raw_cookie } = await openSession(repo, challenge.user_id, ip, user_agent);
    return { ok: true, result: { session, raw_cookie, user_id: challenge.user_id, household_id } };
  }
  if (!challenge.email) return { ok: false, reason: 'not_found' };
  const result = await signInWithVerifiedEmail(repo, challenge.email, challenge.email.split('@')[0] ?? 'Anon', ip, user_agent);
  return { ok: true, result };
}

/** PR 2: одноразовий лінк входу у веб із бота — той самий auth_challenge (kind 'telegram', TTL 15 хв). */
export async function createWebLoginChallenge(repo: Repo, user_id: string, ip?: string | null, user_agent?: string | null): Promise<{ challenge: AuthChallenge; raw_token: string }> {
  const raw = randomToken();
  const now = new Date();
  const challenge: AuthChallenge = {
    id: randomUUID(),
    email: null,
    kind: 'telegram',
    user_id,
    token_hash: sha256(raw),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    consumed_at: null,
    ip: ip ?? null,
    user_agent: user_agent ?? null,
  };
  await repo.saveChallenge(challenge);
  return { challenge, raw_token: raw };
}

export interface TelegramSignIn {
  telegram_user_id: number;
  chat_id?: number | null;
  first_name: string;
  username?: string | null;
}

// PR 1 (TELEGRAM-AUTH-PAY-PLAN-0915): вхід за Telegram-id — дзеркало
// signInWithVerifiedEmail. Знайти за telegram_account (без revoked) → інакше
// створити user без пошти + дім + привʼязку. Привʼязка з профілю до акаунта з
// поштою не змінюється: такий user знайдеться тут же за telegram_user_id.
export async function signInWithTelegram(
  repo: Repo,
  tg: TelegramSignIn,
  ip?: string | null,
  user_agent?: string | null,
): Promise<VerifyChallengeResult & { user: UserRow; created: boolean }> {
  const chat_id = tg.chat_id ?? null;
  let user = await repo.getUserByTelegramId(tg.telegram_user_id);
  let created = false;
  if (!user) {
    // /stop лишає рядок із revoked_at — новий /start оживляє його, а не плодить акаунт.
    const revoked = await repo.getTelegramByTelegramUser(tg.telegram_user_id);
    if (revoked) {
      await repo.linkTelegram({ ...revoked, chat_id: chat_id ?? revoked.chat_id, linked_at: new Date().toISOString(), revoked_at: null });
      user = await repo.getUser(revoked.user_id);
    }
  }
  if (!user) {
    const made = await repo.createUserFromTelegram({ telegram_user_id: tg.telegram_user_id, chat_id, name: tg.first_name });
    user = await repo.getUser(made.user_id);
    created = true;
  } else if (chat_id != null) {
    // Вхід із віджета не знав chat_id — перший /start доповнює рядок.
    const acc = await repo.getTelegramByTelegramUser(tg.telegram_user_id);
    if (acc && acc.chat_id !== chat_id) await repo.linkTelegram({ ...acc, chat_id });
  }
  if (!user) throw new Error(`telegram user ${tg.telegram_user_id}: account not created`);
  const household_id = await repo.firstHouseholdOf(user.id);
  if (!household_id) throw new Error(`user ${user.id} has no household — data invariant broken`);
  const { session, raw_cookie } = await openSession(repo, user.id, ip, user_agent);
  return { session, raw_cookie, user_id: user.id, household_id, user, created };
}

// ── Хотфікс 15.09: вхід через бота з лендингу (заміна Login Widget — на
// десктопі «Запит на вхід» від Telegram не приходить, на мобайлі власний
// popup). Три кроки, той самий auth_challenge, новий kind 'tg_login':
//   1. beginTelegramLogin (веб, клік «Продовжити з Telegram») — challenge
//      без user_id, повертає токен для /start login_<token>.
//   2. attachTelegramLoginUser (бот, /start login_<token>) — знаходить чи
//      створює акаунт (chat_id уже відомий — сам факт /start це UPDATE
//      бота), дописує user_id у challenge. Сесію тут НЕ відкриває.
//   3. pollTelegramLogin (веб, раз на 2 с) — поки user_id порожній: pending;
//      щойно з'явився: consume + відкрити сесію (той самий кінцевий крок,
//      що verifyChallenge для kind 'telegram').

/**
 * Крок 1: лендинг створює challenge ДО того, як особу знають. TTL — 15 хв,
 * як у магік-лінка. `mode` (AUTH-BRIEF-0915) — «Почати» завжди створює
 * акаунт для невідомого telegram_user_id (як і було); «Увійти» — ніколи
 * (attachTelegramLoginUser зупиниться раніше, ніж покличе signInWithTelegram).
 */
export async function beginTelegramLogin(repo: Repo, ip?: string | null, user_agent?: string | null, mode: 'start' | 'login' = 'start'): Promise<{ challenge: AuthChallenge; raw_token: string }> {
  const raw = randomToken();
  const now = new Date();
  const challenge: AuthChallenge = {
    id: randomUUID(),
    email: null,
    kind: 'tg_login',
    mode,
    user_id: null,
    token_hash: sha256(raw),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    consumed_at: null,
    ip: ip ?? null,
    user_agent: user_agent ?? null,
  };
  await repo.saveChallenge(challenge);
  return { challenge, raw_token: raw };
}

export type AttachTelegramLoginOutcome =
  | { ok: true; user: UserRow; created: boolean }
  | { ok: false; reason: 'not_found' | 'expired' | 'consumed' | 'no_account' };

/**
 * Крок 2: бот отримав /start login_<login_token>. mode 'start' — знайти чи
 * створити акаунт, як і було. mode 'login' — лише знайти: жоден telegram_id,
 * навіть щойно побачений ботом, не створює акаунт у цьому режимі. «Знайти»
 * тут включає й revoked-звʼязку (/stop): вона все одно веде на ІСНУЮЧИЙ
 * акаунт, вхід її оживляє, це не «новий акаунт». Не відкриває сесію (це
 * робить лише pollTelegramLogin, коли веб питає) — інакше довелося б плодити
 * зайву cookie-сесію, якою ніхто не скористається.
 */
export async function attachTelegramLoginUser(repo: Repo, login_token: string, tg: TelegramSignIn): Promise<AttachTelegramLoginOutcome> {
  const token_hash = sha256(login_token);
  const challenge = await repo.getChallengeByHash(token_hash);
  if (!challenge || challenge.kind !== 'tg_login') return { ok: false, reason: 'not_found' };
  if (challenge.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(challenge.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  // Злиття (15.09): кнопка «Увійти» (mode 'login') акаунт НЕ створює — лише
  // знаходить. Без акаунта веб побачить status 'no_account' і скаже «Почати».
  if (challenge.mode === 'login') {
    const known = await repo.getUserByTelegramId(tg.telegram_user_id) ?? await repo.getTelegramByTelegramUser(tg.telegram_user_id);
    if (!known) { await repo.setChallengeStatus(challenge.id, 'no_account'); return { ok: false, reason: 'no_account' }; }
  }
  const { user, created } = await signInWithTelegram(repo, tg, null, null);
  await repo.attachChallengeUser(challenge.id, user.id);
  return { ok: true, user, created };
}

export type PollTelegramLoginOutcome =
  | { status: 'pending' }
  | { status: 'expired' }
  /** Злиття (15.09): mode 'login', а акаунта з цим Telegram нема — веб веде на «Почати». */
  | { status: 'no_account' }
  | { status: 'ok'; result: VerifyChallengeResult };

/** Крок 3: лендинг питає раз на 2 с. 'expired' — і для протухлого, і для вже спожитого (повторний poll після 'ok') — контракт навмисно двозначний: людині однаково, який саме, кнопка на сайті та сама «Продовжити з Telegram» ще раз. 'no_account' — бот бачив Start (mode 'login'), але такого акаунта нема; challenge лишається неспожитою (status не consumed_at), тож повторний poll знову отримає 'no_account' — той самий стан, аж поки не спливе TTL. */
export async function pollTelegramLogin(repo: Repo, raw_token: string, ip?: string | null, user_agent?: string | null): Promise<PollTelegramLoginOutcome> {
  const token_hash = sha256(raw_token);
  const challenge = await repo.getChallengeByHash(token_hash);
  if (!challenge || challenge.kind !== 'tg_login' || challenge.consumed_at) return { status: 'expired' };
  if (new Date(challenge.expires_at).getTime() < Date.now()) return { status: 'expired' };
  if (challenge.status === 'no_account') return { status: 'no_account' };
  if (!challenge.user_id) return { status: 'pending' };
  const household_id = await repo.firstHouseholdOf(challenge.user_id);
  if (!household_id) return { status: 'expired' };
  await repo.consumeChallenge(challenge.id);
  const { session, raw_cookie } = await openSession(repo, challenge.user_id, ip, user_agent);
  return { status: 'ok', result: { session, raw_cookie, user_id: challenge.user_id, household_id } };
}

// Спільне ядро входу для будь-якого способу, що ДОВІВ володіння мейлом
// (magic-link, Google OAuth). Знайти юзера або створити з власним домом,
// відкрити сесію.
export async function signInWithVerifiedEmail(
  repo: Repo,
  email: string,
  displayName: string,
  ip?: string | null,
  user_agent?: string | null,
): Promise<VerifyChallengeResult> {
  const existing = await repo.findUserByEmail(email);
  let user_id: string;
  let household_id: string;
  if (existing) {
    user_id = existing.id;
    const hh = await repo.firstHouseholdOf(user_id);
    // У гостя, якого запрошували, є хоча б один household_member (той, куди його
    // запросили). Тому null тут — справжня аномалія, а не «гість без дому».
    if (!hh) throw new Error(`user ${user_id} has no household — data invariant broken`);
    household_id = hh;
  } else {
    // Перший вхід за власним email == оформлення підписки: створюємо власний дім,
    // юзер там owner. У майбутньому ця гілка привʼяжеться до оплати; зараз безкоштовно.
    const created = await repo.createUserWithHousehold(email, displayName);
    user_id = created.user_id;
    household_id = created.household_id;
  }

  const { session, raw_cookie } = await openSession(repo, user_id, ip, user_agent);
  return { session, raw_cookie, user_id, household_id };
}

// Читає cookie, повертає активний контекст. Прокручує expires_at, коли сесія жива —
// це «rolling window»: якщо людина заходить кожен тиждень, TTL не догорає.
// Ефект — сесія догорає лише після справжньої мовчанки на SESSION_TTL_DAYS.
export async function resolveSession(repo: Repo, raw_cookie: string | null): Promise<UserContext | null> {
  if (!raw_cookie) return null;
  const session = await repo.getSessionByCookieHash(sha256(raw_cookie));
  if (!session) return null;
  if (session.revoked_at) return null;
  const now = Date.now();
  if (new Date(session.expires_at).getTime() < now) return null;

  const household_id = await repo.firstHouseholdOf(session.user_id);
  if (!household_id) return null;

  const nowIso = new Date(now).toISOString();
  const newExpires = new Date(now + SESSION_TTL_MS).toISOString();
  await repo.touchSession(session.id, nowIso, newExpires);

  return { user_id: session.user_id, household_id, session_id: session.id };
}

export async function logoutSession(repo: Repo, raw_cookie: string): Promise<void> {
  const session = await repo.getSessionByCookieHash(sha256(raw_cookie));
  if (session) await repo.revokeSession(session.id);
}

// ── PR 2 (TELEGRAM-AUTH-PAY-PLAN-0915): «Додати пошту» до акаунта без неї ──
// Пошта підтверджується тим самим magic-link конвеєром (requestChallenge/
// getChallengeByHash/consumeChallenge) — маршрут лише додає `&attach=1` до
// лінка з листа; жодних нових таблиць. Довіра прив'язана до email самого
// листа + активної сесії того, хто відкрив лінк (незалежно від пристрою —
// сесія читається в момент verify, не в момент request).
export type AttachEmailOutcome =
  | { ok: true }
  /** Злиття (15.09): пошта вже має акаунт — володіння доведено листом, чужий акаунт записано на challenge як підстава для merge. */
  | { ok: false; reason: 'email_taken'; conflict_user_id: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'consumed' | 'no_session' };

export async function verifyEmailAttach(repo: Repo, raw_token: string, current_user_id: string | null): Promise<AttachEmailOutcome> {
  const token_hash = sha256(raw_token);
  const challenge = await repo.getChallengeByHash(token_hash);
  if (!challenge) return { ok: false, reason: 'not_found' };
  if (challenge.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(challenge.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (!current_user_id) return { ok: false, reason: 'no_session' };

  await repo.consumeChallenge(challenge.id);

  // Атач завжди йде через requestChallenge зі справжньою поштою — email тут
  // null лише для challenge.kind === 'telegram' (лінк входу з бота), який
  // сюди ніколи не потрапляє (він не проходить через verifyEmailAttach).
  if (!challenge.email) return { ok: false, reason: 'not_found' };
  const existing = await repo.findUserByEmail(challenge.email);
  if (existing && existing.id !== current_user_id) {
    await repo.attachChallengeUser(challenge.id, current_user_id);
    await repo.setChallengeConflict(challenge.id, existing.id);
    return { ok: false, reason: 'email_taken', conflict_user_id: existing.id };
  }
  if (!existing) await repo.updateUserEmail(current_user_id, challenge.email);
  return { ok: true };
}

