// Злиття акаунтів (власник 15.09). Кейс Яни: Google-акаунт на сайті +
// Telegram-акаунт-дубль, який народився від /start у боті. «Підключити
// Telegram» у профілі або «Додати пошту» впирається в чужий акаунт — і замість
// мовчазної перепривʼязки людина бачить, що там є, і сама вирішує обʼєднати.
//
// Дві половини:
//   1. ДОВЕДЕННЯ: бот (/start <token з профілю>) або лист (&attach=1) довели,
//      що людина володіє ключем, який належить іншому акаунту. Це записується
//      на токен/challenge як conflict_user_id — і живе 15 хв.
//   2. ЗЛИТТЯ: POST /v1/account/merge — дозволено лише за свіжим доведенням і
//      лише коли той акаунт один у своєму домі (інакше «спершу вийди з дому»).
//      Усе переїжджає в дім поточного, той акаунт видаляється. Не скасувати.
import type { Repo } from './repo.js';
import type { AccountConflict, MergeStats } from './types.js';

/** Скільки живе доведення — як магік-лінк і link-token. */
export const CONFLICT_PROOF_TTL_MS = 15 * 60_000;

/** Що людина побачить у профілі: назва дому, комора, рецепти, чи вона там одна. */
export async function describeConflict(repo: Repo, from_user_id: string, kind: AccountConflict['kind'], proven_at: string): Promise<AccountConflict | null> {
  const household_id = await repo.firstHouseholdOf(from_user_id);
  if (!household_id) return null;
  const [household, batches, recipes, members] = await Promise.all([
    repo.getHousehold(household_id),
    repo.listBatches(household_id),
    repo.listRecipes(from_user_id, 1000),
    repo.listMembersOfHousehold(household_id),
  ]);
  return {
    kind,
    from_user_id,
    household_name: household?.name ?? 'Дім',
    pantry_count: batches.filter((b) => !b.depleted_at).length,
    recipe_count: recipes.length,
    sole_member: members.length <= 1,
    proven_at,
  };
}

/** Актуальна підстава для злиття у цього user (≤ 15 хв), або null. */
export async function pendingConflict(repo: Repo, user_id: string, now = new Date()): Promise<AccountConflict | null> {
  const since = new Date(now.getTime() - CONFLICT_PROOF_TTL_MS).toISOString();
  const proof = await repo.findConflictProof(user_id, since);
  if (!proof) return null;
  if (proof.from_user_id === user_id) return null;
  return describeConflict(repo, proof.from_user_id, proof.kind, proof.proven_at);
}

export type MergeOutcome =
  | { ok: true; stats: MergeStats; kind: AccountConflict['kind'] }
  | { ok: false; reason: 'no_proof' | 'not_sole_member' | 'self'; household_name?: string };

/**
 * Обʼєднати from_user у акаунт actor. Право — лише свіже доведення (proof) саме
 * на цього from_user; заборона — якщо у домі from_user є ще хтось.
 */
export async function mergeAccount(repo: Repo, actor_user_id: string, from_user_id: string, now = new Date()): Promise<MergeOutcome> {
  if (actor_user_id === from_user_id) return { ok: false, reason: 'self' };
  const since = new Date(now.getTime() - CONFLICT_PROOF_TTL_MS).toISOString();
  const proof = await repo.findConflictProof(actor_user_id, since);
  if (!proof || proof.from_user_id !== from_user_id) return { ok: false, reason: 'no_proof' };
  const from_household = await repo.firstHouseholdOf(from_user_id);
  if (!from_household) return { ok: false, reason: 'no_proof' };
  const members = await repo.listMembersOfHousehold(from_household);
  if (members.length > 1) {
    const h = await repo.getHousehold(from_household);
    return { ok: false, reason: 'not_sole_member', household_name: h?.name ?? 'Дім' };
  }
  const into_household = await repo.firstHouseholdOf(actor_user_id);
  if (!into_household) return { ok: false, reason: 'no_proof' };
  await repo.revokeAllSessionsOfUser(from_user_id, now.toISOString());
  const stats = await repo.mergeAccounts(from_user_id, actor_user_id, into_household, now.toISOString());
  await repo.clearConflictProof(actor_user_id);
  return { ok: true, stats, kind: proof.kind };
}
