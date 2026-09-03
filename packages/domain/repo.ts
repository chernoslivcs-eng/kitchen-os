// Repo — вузький порт до сховища. Дві реалізації: InMemoryRepo (для тестів
// і локального дев-режиму) і PostgresRepo (пізніше). Домен не знає про SQL.

import type {
  PantryBatch, PendingCard, Profile, AttachmentRecord, MemoryNote, EaterRow,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
  ShoppingItemRow, RecipeRow, RecipeListItem, CookRunRow, CookRunWithRecipe,
  SessionRow, MessageRow, RetailConnectionRow, HouseholdEventRow, Card,
} from './types.js';
import type { HouseholdProduct, ProductTriple } from './product.js';
import type { OccasionRow } from './occasion-data.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface HouseholdRow {
  id: string;
  name: string;
  created_at: string;
}

export interface HouseholdMemberRow {
  user_id: string;
  name: string;
  email: string;
  role: HouseholdRole;
  joined_at: string;
}

export interface Repo {
  // Комора
  listBatches(household_id: string): Promise<PantryBatch[]>;
  getBatch(id: string): Promise<PantryBatch | null>;
  findBatchByLabel(household_id: string, label: string): Promise<PantryBatch | null>;
  insertBatch(b: PantryBatch): Promise<void>;
  updateBatch(id: string, patch: Partial<PantryBatch>): Promise<void>;
  deleteBatch(id: string): Promise<void>;

  // Продукти дому (черга Д, №2): трійка product·brand·variant + теги.
  // Пошук по трійці — суворий збіг без регістру (tripleKey).
  insertProduct(p: HouseholdProduct): Promise<void>;
  getProduct(id: string): Promise<HouseholdProduct | null>;
  findProductByTriple(household_id: string, t: ProductTriple): Promise<HouseholdProduct | null>;
  listProducts(household_id: string): Promise<HouseholdProduct[]>;
  updateProduct(id: string, patch: Partial<Omit<HouseholdProduct, 'id' | 'household_id' | 'created_at'>>): Promise<void>;

  // Профіль
  getProfile(user_id: string): Promise<Profile | null>;
  upsertProfile(p: Profile): Promise<void>;

  // Їдці дому — без акаунтів
  insertEater(e: EaterRow): Promise<void>;
  listEaters(household_id: string): Promise<EaterRow[]>;
  findEaterByName(household_id: string, name: string): Promise<EaterRow | null>;
  deleteEater(id: string): Promise<void>;

  // Висновки з готування
  insertNote(n: MemoryNote): Promise<void>;
  listNotes(user_id: string, limit?: number): Promise<MemoryNote[]>;
  findNoteByText(user_id: string, text: string): Promise<MemoryNote | null>;
  deleteNote(id: string): Promise<void>;

  // Картки на застосуванні
  savePending(pc: PendingCard): Promise<void>;
  getPending(id: string): Promise<PendingCard | null>;
  updatePending(id: string, patch: Partial<PendingCard>): Promise<void>;
  // Черга Г (№3): панель ОЧІКУЮТЬ дивиться на ВСІ незакриті картки дому.
  // session_id/created_at — з повідомлення-носія (id картки = id повідомлення).
  listOpenPending(household_id: string, limit?: number): Promise<Array<PendingCard & { session_id: string | null; created_at: string | null }>>;

  // Вкладення
  saveAttachment(a: AttachmentRecord): Promise<void>;
  getAttachment(id: string): Promise<AttachmentRecord | null>;
  updateAttachment(id: string, patch: Partial<AttachmentRecord>): Promise<void>;

  // Користувачі.
  // createUserWithHousehold — «оформив підписку»: новий юзер + власний дім, він у ньому власник.
  // createUserOnly — «гість»: тільки user-рядок. Далі його вручну додають у чужий дім
  // через addMember. Своєї комори гість не має за визначенням — це те, за що платить хазяїн.
  findUserByEmail(email: string): Promise<UserRow | null>;
  getUser(id: string): Promise<UserRow | null>;
  createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }>;
  createUserOnly(email: string, name: string): Promise<string>;
  firstHouseholdOf(user_id: string): Promise<string | null>;
  getHousehold(id: string): Promise<HouseholdRow | null>;
  listMembersOfHousehold(household_id: string): Promise<HouseholdMemberRow[]>;
  roleOf(household_id: string, user_id: string): Promise<HouseholdRole | null>;
  removeMember(household_id: string, user_id: string): Promise<void>;
  setMemberRole(household_id: string, user_id: string, role: HouseholdRole): Promise<void>;

  // Автентифікація
  saveChallenge(c: AuthChallenge): Promise<void>;
  getChallengeByHash(token_hash: string): Promise<AuthChallenge | null>;
  consumeChallenge(id: string): Promise<void>;

  saveSession(s: AuthSession): Promise<void>;
  getSessionByCookieHash(cookie_hash: string): Promise<AuthSession | null>;
  touchSession(id: string, now: string, expires_at: string): Promise<void>;
  revokeSession(id: string): Promise<void>;

  // Облік токенів
  logTokenUsage(row: TokenUsageRow): Promise<void>;
  listTokenUsage(user_id: string, limit?: number): Promise<TokenUsageRow[]>;

  // Сесії й повідомлення
  getOrCreateSessionForDay(user_id: string, day: string): Promise<SessionRow>;
  createFreshSession(user_id: string, day: string): Promise<SessionRow>;
  getSession(id: string): Promise<SessionRow | null>;
  listSessionsForUser(user_id: string, limit?: number): Promise<Array<SessionRow & { message_count: number }>>;
  setSessionTitle(id: string, title: string): Promise<void>;
  saveMessage(msg: MessageRow): Promise<void>;
  listMessages(session_id: string): Promise<MessageRow[]>;
  // Правка №6: cards-роут шукає повідомлення застосованої картки, щоб пост-кук
  // списання відповіло в ту саму сесію детермінованим «Як вийшло?».
  getMessage(id: string): Promise<MessageRow | null>;
  // Пул-4 №1: видалення сесії — розмова зникає з повідомленнями і незакритими
  // картками; журнал (cook_run) лишається, session_id відвʼязується.
  deleteSession(id: string): Promise<void>;
  markMessageApplied(id: string, applied: number): Promise<void>;
  // M13: заміна в картці кошика мусить пережити F5 — картка правиться в БД.
  updateMessageCard(id: string, card: Card): Promise<void>;

  // Пул-5 №1: повне видалення акаунта. Зносить юзера і доми, де він був
  // ЄДИНИМ членом (каскади прибирають решту); членства в чужих домах просто
  // зникають. Опитувальник живе окремо від юзера.
  deleteUserAccount(user_id: string): Promise<void>;
  recordExitSurvey(s: { email: string; reason: string; comment?: string | null }): Promise<void>;
  listExitSurveys(): Promise<{ email: string; reason: string; comment: string | null; created_at: string }[]>;

  // Рецепти й приготування
  saveRecipe(recipe: RecipeRow): Promise<void>;
  getRecipe(id: string): Promise<RecipeRow | null>;
  // Бібліотека рецептів (екран 07 із прототипу). Повертає збережені «на потім»
  // і ті, які вже готували — з лічильником готувань.
  listRecipes(user_id: string, limit?: number): Promise<RecipeListItem[]>;
  // Останні рецепти власника ВКЛЮЧНО з чернетками — для dedupe генерації і
  // блоку [ЗГЕНЕРОВАНІ РЕЦЕПТИ] в контексті моделі. listRecipes чернетки
  // свідомо ховає (бібліотека), тому окремий метод.
  listRecentRecipes(user_id: string, limit?: number): Promise<RecipeRow[]>;
  setRecipeSaved(id: string, saved_at: string | null): Promise<void>;
  // QA9-08: сховати з бібліотеки (журнал не чіпається); null — повернути.
  setRecipeHidden(id: string, hidden_at: string | null): Promise<void>;
  // Undo імпорту прибирає рядок цілком: на щойно імпортований рецепт ще ніщо
  // не посилається, і лишати «незбережений» привид у базі нема сенсу.
  deleteRecipe(id: string): Promise<void>;
  saveCookRun(run: CookRunRow): Promise<void>;
  getCookRun(id: string): Promise<CookRunRow | null>;
  updateCookRun(id: string, patch: Partial<Pick<CookRunRow, 'rating' | 'verdict' | 'photo_url'>>): Promise<void>;
  markCookRunUndone(id: string, undone_at: string): Promise<void>;
  listCookRuns(user_id: string, limit?: number): Promise<CookRunWithRecipe[]>;

  // Список покупок
  listShoppingItems(household_id: string): Promise<ShoppingItemRow[]>;
  insertShoppingItem(item: ShoppingItemRow): Promise<void>;
  toggleShoppingItem(id: string, checked: boolean): Promise<void>;
  deleteShoppingItem(id: string): Promise<void>;
  findShoppingItemByLabel(household_id: string, label: string): Promise<ShoppingItemRow | null>;

  // Мережі (M13): підключення до retail-провайдера. Upsert по (user_id, provider).
  upsertRetailConnection(c: RetailConnectionRow): Promise<void>;
  getRetailConnection(user_id: string, provider: string): Promise<RetailConnectionRow | null>;
  deleteRetailConnection(user_id: string, provider: string): Promise<void>;

  // Календар. Довідник глобальний і незмінний зі шпальти застосунку; події —
  // істина дому. Пара повторює catalog_ingredient → household_product.
  listOccasionCatalog(): Promise<OccasionRow[]>;
  listHouseholdEvents(household_id: string): Promise<HouseholdEventRow[]>;
  getHouseholdEvent(id: string): Promise<HouseholdEventRow | null>;
  insertHouseholdEvent(e: HouseholdEventRow): Promise<void>;
  updateHouseholdEvent(
    id: string,
    patch: Partial<Pick<HouseholdEventRow,
      'title' | 'note' | 'rule' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at'>>,
  ): Promise<void>;
  deleteHouseholdEvent(id: string): Promise<void>;

  // «Не показувати такі»: наявність id у списку = подія вимкнена для цього
  // дому. Знімається видаленням — двох способів сказати «показувати» немає.
  listMutedOccasions(household_id: string): Promise<string[]>;
  muteOccasion(household_id: string, occasion_id: string): Promise<void>;
  unmuteOccasion(household_id: string, occasion_id: string): Promise<void>;

  // Дом-membership і запрошення
  isMember(household_id: string, user_id: string): Promise<boolean>;
  addMember(household_id: string, user_id: string, role: HouseholdRole): Promise<void>;
  saveInvite(inv: HouseholdInvite): Promise<void>;
  getInviteByHash(token_hash: string): Promise<HouseholdInvite | null>;
  getInvite(id: string): Promise<HouseholdInvite | null>;
  consumeInvite(id: string, consumed_by: string): Promise<void>;
  revokeInvite(id: string): Promise<void>;
  listInvitesForHousehold(household_id: string): Promise<HouseholdInvite[]>;
}
