// Repo — вузький порт до сховища. Дві реалізації: InMemoryRepo (для тестів
// і локального дев-режиму) і PostgresRepo (пізніше). Домен не знає про SQL.

import type {
  PantryBatch, PendingCard, AttachmentRecord, EaterRow,
  AuthChallenge, AuthSession, TokenUsageRow, HouseholdInvite, HouseholdRole,
  ShoppingItemRow, RecipeRow, RecipeListItem, CookRunRow, CookRunWithRecipe,
  SessionRow, MessageRow, RetailConnectionRow, HouseholdEventRow, OccasionCatchRow, AdminOccasionRow, Card,
  LastAppliedIntake, AppEventRow,
} from './types.js';
import type { HouseholdProduct, ProductTriple } from './product.js';
import type {
  ProfileText, ProfileFieldKey, ProfileFieldValue, ProfileNote, VetoRow, VetoField,
} from './profile-text.js';
import type { OccasionRow } from './occasion-data.js';
import type { OccasionSubscriptionRow } from './periods.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
  /** Раунд 4, крок 6: тариф. Поки один — 'beta' (міграція 0024). */
  plan: string;
  /** Крок 7 (міграція 0025): бачив Семена; картку «Про тебе» вже видано. */
  welcome_seen_at: string | null;
  profile_onboarding_at: string | null;
}

export type UserStampField = 'welcome_seen_at' | 'profile_onboarding_at';

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

/**
 * Крок А2: рядок списку домів в адмінці.
 *
 * Пілот роздано, і кожна людина за лінком дістає ВЛАСНИЙ дім
 * (`createUserWithHousehold`). Тобто дані пілотних людей пишуться з першої
 * хвилини, а власник досі бачив тільки себе.
 *
 * Ім'я й пошта власника дому — свідомий виняток із «PII в адмінку не носимо».
 * Він цих людей особисто кликав і має розрізняти їх у списку; далі за список
 * ця пара не йде.
 */
export interface AdminHouseholdRow {
  id: string;
  name: string;
  created_at: string;
  /** Скільки людей у домі. */
  people: number;
  /** Останній хід (репліка людини або відповідь) — null, якщо ходів не було. */
  last_turn_at: string | null;
  /** Скільки реплік людей за весь час. Нуль — дім, у якому нічого не сталось. */
  turns: number;
  /**
   * Коли в домі востаннє БУЛИ. Це не те саме, що хід: людина може зайти за
   * лінком і не написати нічого — на пілоті таких буде більшість, і це
   * найцінніший рядок у списку.
   */
  last_seen_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
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

  // Профіль (v1 — до кроку 9 раунду 4 живе поруч із v2)

  // Раунд 4: профіль як сім речень (AUDIT-ROUND-4.md §2). Читається завжди
  // повністю — сім полів, порожні як status:'empty', а не null: серіалізації
  // й онбордингу потрібен стан КОЖНОГО поля, не лише заповнених.
  getProfileText(user_id: string): Promise<ProfileText>;
  // Текст обрізається по ліміту поля тут, на межі сховища — щоб UI, картка
  // і міграція не могли записати довше, ніж дизайн дозволяє прочитати.
  // {status:'none'} — «Нічого такого»; порожній текст — назад у 'empty'.
  patchProfileField(
    user_id: string, key: ProfileFieldKey, patch: { text: string } | { status: 'none' },
  ): Promise<ProfileFieldValue>;

  // Нотатки від асистента (і перенесені висновки людини). Людина видаляє —
  // мʼяко, для «Повернути»; не редагує.
  listProfileNotes(user_id: string, opts?: { limit?: number; include_deleted?: boolean }): Promise<ProfileNote[]>;
  addProfileNote(n: ProfileNote): Promise<void>;
  deleteProfileNote(id: string): Promise<void>;
  restoreProfileNote(id: string): Promise<void>;

  // Похідний вето-індекс. Перебудовується цілком на поле — тому set, а не
  // insert/delete поштучно; порядок рядків зберігається (як у тексті).
  getVetoIndex(user_id: string): Promise<VetoRow[]>;
  setVetoIndex(user_id: string, field: VetoField, rows: VetoRow[]): Promise<void>;

  // Їдці дому — без акаунтів
  insertEater(e: EaterRow): Promise<void>;
  listEaters(household_id: string): Promise<EaterRow[]>;
  findEaterByName(household_id: string, name: string): Promise<EaterRow | null>;
  deleteEater(id: string): Promise<void>;

  // Картки на застосуванні
  savePending(pc: PendingCard): Promise<void>;
  getPending(id: string): Promise<PendingCard | null>;
  updatePending(id: string, patch: Partial<PendingCard>): Promise<void>;
  // Черга Г (№3): панель ОЧІКУЮТЬ дивиться на ВСІ незакриті картки дому.
  // session_id/created_at — з повідомлення-носія (id картки = id повідомлення).
  listOpenPending(household_id: string, limit?: number): Promise<Array<PendingCard & { session_id: string | null; created_at: string | null }>>;
  // Аудит раунд 3, крок 5: [ОСТАННІ ДІЇ] — картки, ЗАКРИТІ (застосовані/
  // скасовані/відхилені) поза поточною розмовою, щоб модель не реконструювала
  // стан дому із власних минулих реплік. exclude_session_id — не показувати
  // те, що модель щойно закрила в ЦІЙ розмові: історія розмови вже це знає.
  // Впорядковано за часом рішення (max із applied_at/undone_at/dismissed_at) спадно.
  listRecentResolved(household_id: string, opts: { since: Date; limit: number; exclude_session_id?: string }): Promise<PendingCard[]>;

  // Крок Ш1: «з останнього чека» для /v1/pantry. Окремий метод, а не опція
  // listRecentResolved: там поведінка вже перевірена чатом, і міняти її заради
  // комори немає підстав.
  //
  // Роут читав із трьохсот закритих карток рівно одне поле — created_batch_ids
  // найсвіжішої застосованої intake-картки з джерелом. Заради нього тягнулись
  // усі їхні `card` і `undo_snapshot`: 1268 kB на 300 карток, і саме ця
  // передача з парсингом коштувала секунду з гаком на кожен відкритий екран
  // комори. Тут із бази виходять три поля одного рядка.
  lastAppliedIntake(household_id: string, since: Date): Promise<LastAppliedIntake | null>;

  // Крок О1а: події поведінки й серверні інциденти.
  // Пишуться пачкою: клієнт шле до 20 за раз, сервер пише інцидент по одному,
  // і обидва шляхи не мають різнитись.
  saveAppEvents(rows: AppEventRow[]): Promise<void>;
  /** Стрічка дня для /admin/pulse: від найсвіжішого, з кепом. */
  listAppEvents(user_id: string, opts: { from: Date; to: Date; limit: number }): Promise<AppEventRow[]>;
  /**
   * Те саме по всьому дому. Окремий метод, а не цикл по учасниках: подій за
   * день десятки, і збирати їх сімома запитами замість одного означало б
   * платити за структуру, якої в даних немає — household_id стоїть у кожному
   * рядку від самого початку.
   */
  listAppEventsForHousehold(household_id: string, opts: { from: Date; to: Date; limit: number }): Promise<AppEventRow[]>;

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
  // Крок 7: разові позначки на користувачі (Семен, картка «Про тебе»).
  touchUser(user_id: string, field: UserStampField, at: string): Promise<void>;
  createUserWithHousehold(email: string, name: string): Promise<{ user_id: string; household_id: string }>;
  createUserOnly(email: string, name: string): Promise<string>;
  firstHouseholdOf(user_id: string): Promise<string | null>;
  getHousehold(id: string): Promise<HouseholdRow | null>;
  listMembersOfHousehold(household_id: string): Promise<HouseholdMemberRow[]>;
  /**
   * Крок А2: усі доми з агрегатами — ОДНИМ запитом.
   *
   * Не циклом по домах із підзапитом на кожен: на вісімдесяти домах це вбило б
   * і сторінку, і базу, якою в ту саму мить користуються живі люди. Агрегати
   * рахує SQL.
   *
   * Доми без жодної активності присутні нарівні з рештою — саме вони тут
   * найцінніші.
   */
  listAdminHouseholds(): Promise<AdminHouseholdRow[]>;
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
  /** Витрати всього дому: пульс рахує гроші по дому, не по одній людині. */
  listTokenUsageForHousehold(household_id: string, limit?: number): Promise<TokenUsageRow[]>;

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
  //
  // Але видимість — не дому, а автора: календар не спільний елемент, і доданий
  // член сімʼї чужих планів не бачить. Тому підпис вимагає обидва ключі, а не
  // приймає user_id як необовʼязковий: забутий необовʼязковий аргумент віддав
  // би весь дім і мовчки, а забутий обовʼязковий не збереться.
  //
  // Назва теж змінилась навмисно. `listHouseholdEvents` після такої зміни
  // читалась би як «події дому» й запрошувала б використати її там, де треба
  // саме дім, — а такого місця немає.
  listOccasionCatalog(): Promise<OccasionRow[]>;
  listOwnEvents(household_id: string, user_id: string): Promise<HouseholdEventRow[]>;
  getHouseholdEvent(id: string): Promise<HouseholdEventRow | null>;
  insertHouseholdEvent(e: HouseholdEventRow): Promise<void>;
  updateHouseholdEvent(
    id: string,
    patch: Partial<Pick<HouseholdEventRow,
      'title' | 'note' | 'rule' | 'buy' | 'servings' | 'supply' | 'expires_at' | 'done_at'
      | 'from' | 'to' | 'rule_text' | 'strict' | 'force' | 'restricts' | 'kind'>>,
  ): Promise<void>;
  deleteHouseholdEvent(id: string): Promise<void>;

  // П1: підписка дому на довідник. Рядок існує лише як відхилення від
  // дефолту (сезон/редакційне — увімкнено, свято традиції — вимкнено):
  // enabled null — прибрати рядок, повернутись до дефолту. Ключ домовий:
  // календар підписок спільний для дому, як комора й список.
  listOccasionSubscriptions(household_id: string): Promise<OccasionSubscriptionRow[]>;
  setOccasionSubscription(household_id: string, occasion_id: string, enabled: boolean | null): Promise<void>;

  // Спіймані вікна. Пишеться мовчки після готування, читається підсумком.
  // Повторне спіймання того самого вікна того самого року — не подія.
  //
  // Єдине з календаря, що лишається домовим, і навмисно: ловіння виводиться з
  // cook_run, а готування спільне. Особистий ключ дав би «хтось інший зварив
  // різото з білими, а мій календар каже, що я проґавив сезон грибів».
  recordOccasionCatch(c: OccasionCatchRow): Promise<void>;
  listOccasionCatches(household_id: string, year?: number): Promise<OccasionCatchRow[]>;

  // Адмінка v0 (фаза 4): пише повний рядок, включно з чернеткою.
  // listOccasionCatalog() (вище) читає лише опубліковане — цей блок бачить усе.
  listAdminOccasions(): Promise<AdminOccasionRow[]>;
  upsertAdminOccasion(row: AdminOccasionRow): Promise<void>;
  setOccasionPublished(id: string, published: boolean): Promise<void>;
  deleteAdminOccasion(id: string): Promise<void>;

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
