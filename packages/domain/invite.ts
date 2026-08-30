// Запрошення в дім посиланням. Той самий каркас, що magic-link:
//   - сирий токен існує лише в листі
//   - у БД лежить SHA-256(hex)
//   - одноразовий, revocable, TTL 72 години (хендоф Д06)
// Різниця з magic-link — прив'язка до household_id і опційна роль. Клік лінка
// приймачем не тільки логінить, а й додає у household_member.

import { randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import type { HouseholdInvite, HouseholdRole, AuthSession } from './types.js';
import { randomToken, hashToken, openSession } from './auth.js';

// QA8-18: макет обіцяє «ПОСИЛАННЯ ДІЄ 72 ГОД», код давав тиждень.
const INVITE_TTL_HOURS = 72;
export const INVITE_TTL_MS = INVITE_TTL_HOURS * 3_600_000;

export interface CreateInviteInput {
  household_id: string;
  invited_by: string;
  email: string;
  role?: HouseholdRole;
}

export interface CreateInviteResult {
  invite: HouseholdInvite;
  raw_token: string;
}

export async function createInvite(repo: Repo, input: CreateInviteInput): Promise<CreateInviteResult> {
  const raw = randomToken();
  const now = new Date();
  const invite: HouseholdInvite = {
    id: randomUUID(),
    household_id: input.household_id,
    invited_by: input.invited_by,
    email: input.email.toLowerCase(),
    role: input.role ?? 'member',
    token_hash: hashToken(raw),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    consumed_at: null,
    consumed_by: null,
    revoked_at: null,
  };
  await repo.saveInvite(invite);
  return { invite, raw_token: raw };
}

export interface AcceptInviteResult {
  session: AuthSession;
  raw_cookie: string;
  user_id: string;
  household_id: string;
  role: HouseholdRole;
  already_member: boolean;
}

export type AcceptOutcome =
  | { ok: true; result: AcceptInviteResult }
  | { ok: false; reason: 'not_found' | 'expired' | 'consumed' | 'revoked' };

export async function acceptInvite(
  repo: Repo,
  raw_token: string,
  ip?: string | null,
  user_agent?: string | null,
): Promise<AcceptOutcome> {
  const inv = await repo.getInviteByHash(hashToken(raw_token));
  if (!inv) return { ok: false, reason: 'not_found' };
  if (inv.revoked_at) return { ok: false, reason: 'revoked' };
  if (inv.consumed_at) return { ok: false, reason: 'consumed' };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  // Гість не отримує свого дому. Це продуктове рішення, не технічне: підписку
  // платить хазяїн, у цю підписку входять гостьові ключі, а не окремі кухні
  // для запрошених. Аналогія — сімейний Netflix: один акаунт, кілька профілів,
  // ніхто з профілів не має «своєї бібліотеки».
  //
  // Наслідок для коду: новий юзер, який прийшов через invite, створюється БЕЗ
  // домогосподарства. Його firstHouseholdOf одразу поверне дім запрошувача,
  // бо це буде його ЄДИНИЙ household_member-запис. Ніякої «стрічки на ключі»
  // не треба — ключ і так один.
  //
  // Для юзера, який уже мав свій дім (сам купував підписку) і тепер приймає
  // запрошення в чужий, лишається запитання «в який зайти за замовчуванням»:
  // firstHouseholdOf дасть той, до якого він приєднався раніше. Це edge case,
  // закриється явним перемикачем дому в UI, коли з'явиться другий сценарій.
  let user_id: string;
  let already_member = false;
  const existing = await repo.findUserByEmail(inv.email);
  if (existing) {
    user_id = existing.id;
    already_member = await repo.isMember(inv.household_id, user_id);
  } else {
    user_id = await repo.createUserOnly(inv.email, inv.email.split('@')[0] ?? 'Anon');
  }
  await repo.addMember(inv.household_id, user_id, inv.role);
  await repo.consumeInvite(inv.id, user_id);

  const { session, raw_cookie } = await openSession(repo, user_id, ip, user_agent);
  return {
    ok: true,
    result: { session, raw_cookie, user_id, household_id: inv.household_id, role: inv.role, already_member },
  };
}
