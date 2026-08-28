// Запрошення в дім посиланням. Той самий каркас, що magic-link:
//   - сирий токен існує лише в листі
//   - у БД лежить SHA-256(hex)
//   - одноразовий, revocable, TTL 7 днів
// Різниця з magic-link — прив'язка до household_id і опційна роль. Клік лінка
// приймачем не тільки логінить, а й додає у household_member.

import { randomUUID } from 'node:crypto';
import type { Repo } from './repo.js';
import type { HouseholdInvite, HouseholdRole, AuthSession } from './types.js';
import { randomToken, hashToken, openSession } from './auth.js';

const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 86_400_000;

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

  // Знайти або створити юзера з email запрошення. Якщо запрошений вже юзер —
  // просто додаємо в дім. Новий — створюємо, але БЕЗ окремого домохазяйства
  // (createUserWithHousehold дає ще один дім, чого нам тут не треба).
  // Замість цього створюємо голого юзера й одразу додаємо в цільовий дім.
  let user_id: string;
  let already_member = false;
  const existing = await repo.findUserByEmail(inv.email);
  if (existing) {
    user_id = existing.id;
    already_member = await repo.isMember(inv.household_id, user_id);
  } else {
    // Для новоствореного юзера все одно потрібен «його» дім за замовчуванням —
    // інакше firstHouseholdOf може повернути дім-запрошення, а він не «його».
    // Йдемо простим шляхом: створюємо юзера з власним домом, потім додаємо в цільовий.
    const created = await repo.createUserWithHousehold(inv.email, inv.email.split('@')[0] ?? 'Anon');
    user_id = created.user_id;
  }
  await repo.addMember(inv.household_id, user_id, inv.role);
  await repo.consumeInvite(inv.id, user_id);

  const { session, raw_cookie } = await openSession(repo, user_id, ip, user_agent);
  return {
    ok: true,
    result: { session, raw_cookie, user_id, household_id: inv.household_id, role: inv.role, already_member },
  };
}
