// Доменні типи. Свідомо на TypeScript, а не на Zod: schema-валідація — окремий шар
// на межі HTTP (services/api). Тут — чиста форма.

export type Zone = 'dry' | 'fridge' | 'freezer' | 'fresh' | 'spices' | 'drinks';
export type Unit = 'g' | 'ml' | 'pcs' | 'pack';
export type BatchState = 'sealed' | 'opened' | 'depleted';
export type Provenance = 'receipt_line' | 'package_label' | 'user_statement' | 'visual_guess' | 'inference';

export interface PantryBatch {
  id: string;
  household_id: string;
  catalog_key: string | null;
  label: string;
  zone: Zone;
  value: number | null;
  unit: Unit | null;
  state: BatchState;
  opened_at: string | null;
  expires_at: string | null;
  best_before_opened_days: number | null;
  added_at: string;
  depleted_at: string | null;
  confidence: number;
  provenance: Provenance;
  staple: boolean;
  last_by: string | null;
  last_action: string | null;
}

// ----- Картки з 03-prompts.md -----

export type IntakeOp =
  | { op: 'add'; label: string; value?: number; unit?: Unit; zone?: Zone; confidence?: number; evidence?: string; catalog_key?: string }
  | { op: 'deplete'; label: string }
  | { op: 'open'; label: string }
  | { op: 'rename'; label: string; to: string }
  | { op: 'correct'; label: string; value?: number; unit?: Unit; zone?: Zone };

export interface IntakeCard {
  type: 'intake_diff';
  ops: IntakeOp[];
}

export interface ProposalCard {
  type: 'proposal';
  items: {
    title: string;
    desc: string;
    why?: string;
    character?: string;
    rescues?: string[];
    needs?: string[];
  }[];
}

export interface ShoppingCard {
  type: 'shopping';
  items: {
    op: 'add' | 'remove';
    label: string;
    note?: string;
    v?: number;
    u?: string;
  }[];
}

export type ProfileKind = 'allergy' | 'wish' | 'anti' | 'equip' | 'note' | 'member';

export interface ProfileCard {
  type: 'profile';
  ops: {
    op: 'add' | 'remove';
    kind: ProfileKind;
    label: string;
    pin?: boolean;
    // додаткові поля з 03-prompts.md залишаємо через індекс
    [k: string]: unknown;
  }[];
}

export interface RecipeIng {
  p?: string;   // id партії з комори — модель показує пальцем
  n?: string;   // назва, коли продукту нема в коморі
  v?: number;
  u?: string;
}

export interface RecipeStep {
  t: string;    // короткий тайтл кроку
  c: string;    // дія з плейсхолдерами {0}, {1} за індексом інгредієнта
  s?: number;   // секунди таймера, якщо крок часовий
}

export interface Recipe {
  t: string;                                      // title
  sv: number;                                     // servings
  tm: number;                                     // total minutes
  ch: string;                                     // характер (час і зусилля)
  d: string;                                      // description
  rk: string;                                     // ключова помилка (не застереження)
  nu?: { kcal: number; p: number; f: number; c: number };
  op?: string[];                                  // варіанти замін
  ing: RecipeIng[];
  st: RecipeStep[];
}

// Картка рецепта з вкладення: людина показала сторінку книжки чи скрін —
// ми показуємо розібраний рецепт і питаємо, чи класти в бібліотеку.
export interface RecipeCard {
  type: 'recipe';
  recipe: Recipe;
}

// Фото готової страви з чату → в журнал, до конкретного готування. Картка,
// а не тихий запис: фото могло бути не тієї страви.
export interface CookPhotoCard {
  type: 'cook_photo';
  run_id: string;
  recipe_title: string;
  attachment_id: string;
}

// Слід рецепта в розмові: «◇ Борщ · Рецепт →». Не дія — застосовувати нічого,
// тому в apply гілки немає і модель цей тип не породжує (немає в CARD_TYPES
// парсера). Компроміс Р-3 з design-audit-2: рецепт живе окремим екраном, але
// більше не зникає з розмови.
// Рішення Пилипа (31.08): рецепт — це хід розмови, а не екран. Повідомлення
// несе ПОВНИЙ рецепт: стрічка рендерить його цілком, F5 тримає, історія
// розмови містить страву, а не посилання на неї.
export interface RecipeLinkCard {
  type: 'recipe_link';
  recipe_id: string;
  title: string;
  recipe?: Recipe;
}

// QA9-02: «поміняй в рецепті багет на батон». Модель НЕ переписує рецепт сама —
// показує пальцем (назва) і передає інструкцію; сервер регенерує рецепт із
// базовим payload і кидає НОВИЙ recipe_link-хід у стрічку. Старе повідомлення
// не редагується — правка це відповідь, а не втручання в минуле (канон Бриф-3:
// «наступна репліка може змінити рецепт»). Ця картка ніколи не доходить до
// клієнта і не має apply-гілки: chat-роут перехоплює її синхронно.
export interface RecipeEditCard {
  type: 'recipe_edit';
  title: string;         // назва рецепта з розмови — по ній шукаємо базовий
  instruction: string;   // що змінити, словами людини
}

export type Card = IntakeCard | ProposalCard | ShoppingCard | ProfileCard | RecipeCard | CookPhotoCard | RecipeLinkCard | RecipeEditCard;

// ----- Стан «на застосуванні» ------

export interface PendingCard {
  id: string;               // = message_id
  message_id: string;
  household_id: string;
  user_id: string;
  card: Card;
  applied_at: string | null;
  applied_ops: number[] | null;  // індекси застосованих ops у card.ops (для intake_diff/profile)
  undo_token: string | null;
  undo_snapshot: UndoSnapshot | null;
  undone_at: string | null;
}

// Знімок ДО застосування: чого досить, щоб відкотити.
// Для intake — попередні партії (при correct/rename/open/deplete) + список створених id (add).
export interface UndoSnapshot {
  kind: 'intake_diff' | 'shopping' | 'profile' | 'recipe' | 'cook_photo';
  before: {
    created_batch_ids?: string[];       // add: створені партії — видалити при undo
    modified_batches?: PantryBatch[];   // rename/correct/open/deplete: повернути в цей стан
    removed_shopping_ids?: string[];    // shopping remove: повернути назад (потрібне окреме сховище — пізніше)
    added_shopping_ids?: string[];      // shopping add: видалити при undo
    profile_before?: Profile;           // profile: повернути весь блок
    added_note_ids?: string[];          // note: висновки лише додаються, тож undo — це видалення
    added_recipe_ids?: string[];        // recipe: імпортований рецепт при undo видаляється
    added_eater_ids?: string[];         // member add: undo видаляє
    photo_before?: { run_id: string; photo_url: string | null };  // cook_photo: повернути як було
    removed_eaters?: EaterRow[];        // member remove: undo повертає повний рядок
  };
}

// Висновок із готування: «фует знімати, щойно краї хрусткі». Живе окремо від
// Profile, а не масивом у ньому, з двох причин. По-перше, у висновка є власні
// поля — до якої страви, з якою оцінкою. По-друге, undo профілю замінює весь
// документ (QA5), і висновок, що приїхав пізніше, зникав би разом із ним.
// Висновки лише додаються й видаляються поштучно, тому їх undo точний.
export interface MemoryNote {
  id: string;
  user_id: string;
  text: string;
  recipe_title: string | null;
  rating: number | null;
  pinned: boolean;
  created_at: string;
}

// Їдець без акаунта: «зі мною живе Оксана, вона веганка». Не user і не
// household_member — Оксана не логіниться й не пише в комору, вона просто
// їсть те, що тут готують. Обмеження лежать у її записі, а не розмазуються
// по анти-полю власника рядком «на двох: …», як радив промпт шість прогонів.
export interface EaterRow {
  id: string;
  household_id: string;
  name: string;
  allergies: string[];
  wishes: string[];
  antipatterns: string[];
  created_at: string;
}

export interface Profile {
  user_id: string;
  allergies: string[];
  wishes: string[];
  antipatterns: string[];
  equipment: Record<string, 'has' | 'lacks'>;
}

export interface SessionRow {
  id: string;
  user_id: string;
  title: string | null;
  day: string;                          // YYYY-MM-DD
  created_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  text: string | null;
  card: Card | null;                     // те, що асистент повернув
  applied: number;                       // скільки ops вже застосовано (0 або applied_ops.length)
  created_at: string;
}

export interface RecipeRow {
  id: string;
  owner_id: string;
  origin: 'generated' | 'imported' | 'catalog';
  title: string;
  // QA8-01: людина просила «Паста карбонара з фуетом», модель назвала
  // «Карбонара з фуетом» — dedupe генерації шукає за ОБОМА назвами.
  requested_title?: string | null;
  descr: string | null;
  character: string | null;
  risk: string | null;
  base_servings: number;
  time_total: number | null;
  nutrition: unknown;
  payload: unknown;                                    // повний рецепт як JSON (ing, st)
  created_at: string;
  saved_at: string | null;                             // «лишити на потім» — QA-6
}

// Рецепт у списку: сам рядок + скільки разів готували. Стан ready/near/far
// рахується проти комори через matchRecipe().
export interface RecipeListItem extends RecipeRow {
  cooked_count: number;
  last_cooked_at: string | null;
}

export type CookRunBatchChange =
  | { id: string; op: 'deplete'; prev_state: BatchState; prev_depleted_at: string | null }
  | { id: string; op: 'subtract'; amount: number; prev_state: BatchState; prev_value: number | null; prev_opened_at: string | null };

export interface CookRunChanges {
  batches: CookRunBatchChange[];
}

export interface CookRunRow {
  id: string;
  household_id: string;
  user_id: string;
  recipe_id: string;
  servings: number;
  started_at: string;
  finished_at: string | null;
  rating: number | null;
  verdict: string | null;
  photo_url: string | null;
  changes: CookRunChanges | null;
  undone_at: string | null;
}

export interface CookRunWithRecipe extends CookRunRow {
  recipe: RecipeRow;
}

export interface ShoppingItemRow {
  id: string;
  household_id: string;
  label: string;
  reason: string | null;
  value: number | null;
  unit: string | null;
  zone: string | null;
  checked: boolean;
  added_by: string | null;
  source: 'user' | 'recipe' | 'model' | 'retail';
  created_at: string;
}

// ----- Облік токенів ----------------------------------------------------

export type CallName = 'chat' | 'attachment_parse' | 'recipe_gen';
export type ModelProfile = 'fast' | 'smart' | 'stub';
export type CallMode = 'live' | 'stub';

export interface TokenUsageRow {
  id: string;
  user_id: string;
  household_id: string | null;
  call: CallName;
  profile: ModelProfile;
  model: string;
  prompt_version: string;
  mode: CallMode;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  latency_ms: number | null;
  created_at: string;
}

// ----- Автентифікація ---------------------------------------------------

export interface AuthChallenge {
  id: string;
  email: string;
  token_hash: string;                // SHA-256(hex) від сирого токена, який їде в листі
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface AuthSession {
  id: string;
  user_id: string;
  cookie_hash: string;               // SHA-256(hex) від сирого cookie-значення
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

// Активний користувач у контексті запиту — виводиться з cookie в middleware.
export interface UserContext {
  user_id: string;
  household_id: string;              // «активний дім»: перший, до якого приєднаний користувач
  session_id: string;
}

// ----- Запрошення в дім -------------------------------------------------

export type HouseholdRole = 'owner' | 'member';

export interface HouseholdInvite {
  id: string;
  household_id: string;
  invited_by: string;
  email: string;                     // нижній регістр
  role: HouseholdRole;
  token_hash: string;                // SHA-256(hex) від сирого токена
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by: string | null;
  revoked_at: string | null;
}

// ----- Вкладення --------------------------------------------------------

export type AttachmentKind = 'image' | 'pdf' | 'text';

export interface AttachmentRecord {
  id: string;
  message_id: string | null;
  household_id: string;
  user_id: string;
  kind: AttachmentKind;
  url: string;                    // fs://... або s3://... — не HTTP
  content_type: string | null;
  bytes: number | null;
  hint: string | null;
  created_at: string;
}
