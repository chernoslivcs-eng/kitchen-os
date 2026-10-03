// Онбординг, етап 2: порожній профіль більше не блокує страву (рішення
// власника 03.10).
//
// Жива розмова, через яку це переробляли: людина пише «додав рис і собу до
// уваги», а чат відповідає «Скажи тільки одне, перш ніж почнемо: є щось, чого
// тобі взагалі не можна…» — тобто ставить умову перед тим, за чим прийшли.
//
// Тепер відповідь іде як є, а про порожній профіль каже одна приписка в кінці
// — і РІВНО ОДИН РАЗ на людину. Слід у `profile_onboarding_at`, а не в історії
// останніх 20 повідомлень: розмова довша за вікно, і приписка верталась би.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => log } as never;
const host = { log, telemetry: [] } as never;

const callChat = vi.fn();
vi.mock('../src/model.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), callChat }));

const { InMemoryRepo } = await import('@kitchen/domain');
const { InMemoryStore } = await import('../src/attachment-store.js');
const { runChatTurn, PROFILE_NUDGE } = await import('../src/chat-turn.js');

const REPLY = 'Є філе індички та кріп — зробімо індичку з кропом.';

const reply = () => ({
  reply: REPLY, card: null, calls: [], meta: { promptVersion: 'test' },
});

/** Дім із трьома активними партіями — умова етапу 2. */
async function houseWithPantry() {
  const repo = new InMemoryRepo();
  const { user_id, household_id } = await repo.createUserWithHousehold(`${Math.random()}@x.test`, 'П');
  for (const label of ['філе індички', 'кріп', 'рис']) {
    await repo.insertBatch({
      id: `${label}-${Math.random()}`, household_id, label, catalog_key: null, zone: 'fridge',
      value: 1, unit: 'pcs', state: 'sealed', opened_at: null, expires_at: null,
      added_at: new Date().toISOString(),
    } as never);
  }
  return { repo, user_id, household_id };
}

const turn = (repo: unknown, user_id: string, household_id: string, text: string) =>
  runChatTurn(repo as never, new InMemoryStore(), {}, { user: { user_id, household_id }, text, channel: 'web', host, log });

describe('приписка про порожній профіль', () => {
  beforeEach(() => { callChat.mockReset(); callChat.mockResolvedValue(reply()); });

  it('перший хід: відповідь як є, приписка окремим абзацом у кінці', async () => {
    const { repo, user_id, household_id } = await houseWithPantry();
    const out = await turn(repo, user_id, household_id, 'додав рис і собу до уваги');
    expect(out.reply).toBe(`${REPLY}\n\n${PROFILE_NUDGE}`);
    // Не першим реченням і не питанням — саме через це крок і переробляли.
    expect(out.reply!.startsWith(REPLY)).toBe(true);
    expect(PROFILE_NUDGE).not.toContain('?');
  });

  it('другий хід із тим самим порожнім профілем приписки вже не має', async () => {
    const { repo, user_id, household_id } = await houseWithPantry();
    await turn(repo, user_id, household_id, 'перший');
    const second = await turn(repo, user_id, household_id, 'другий');
    expect(second.reply).toBe(REPLY);
    expect(second.reply).not.toContain('додай це в свій профіль');
  });

  it('слід лишається в даних, а не в історії розмови', async () => {
    const { repo, user_id, household_id } = await houseWithPantry();
    expect((await repo.getUser(user_id))?.profile_onboarding_at).toBeNull();
    await turn(repo, user_id, household_id, 'перший');
    expect((await repo.getUser(user_id))?.profile_onboarding_at).toBeTruthy();
  });

  it('заповнений профіль приписки не отримує зовсім', async () => {
    const { repo, user_id, household_id } = await houseWithPantry();
    await repo.patchProfileField(user_id, 'no', { text: 'свинини' });
    await repo.patchProfileField(user_id, 'ban', { text: 'горіхів' });
    await repo.patchProfileField(user_id, 'love', { text: 'гостре' });
    const out = await turn(repo, user_id, household_id, 'що на вечерю?');
    expect(out.reply).toBe(REPLY);
  });

  it('порожня комора (етап 1) приписки не отримує — там своя розмова', async () => {
    const repo = new InMemoryRepo();
    const { user_id, household_id } = await repo.createUserWithHousehold('e@x.test', 'Е');
    const out = await turn(repo, user_id, household_id, 'привіт');
    expect(out.reply).toBe(REPLY);
    expect((await repo.getUser(user_id))?.profile_onboarding_at).toBeNull();
  });

  // Текст дослівний від власника (03.10). Тест тримає сам рядок: його не
  // можна «покращити» мимохідь — ні додати «просто», ні вставити «алергія».
  it('текст приписки — дослівно той, що дав власник', () => {
    expect(PROFILE_NUDGE).toBe('Якщо в тебе є особливі вподобання, обмеження, а може якась техніка на кухні, додай це в свій профіль, я врахую це в майбутньому.');
  });

  // Рамка 23.09 і вимога задачі: не питання, без «алергія», без обіцянок безпеки.
  it('не питання, без «алергія» й без обіцянок безпеки', () => {
    expect(PROFILE_NUDGE).not.toMatch(/алерг|безпечн|гарантую|придатн|не містить/i);
    expect(PROFILE_NUDGE).not.toMatch(/[?]/);
  });
});
