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

export type Card = IntakeCard | ProposalCard | ShoppingCard | ProfileCard;

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
  kind: 'intake_diff' | 'shopping' | 'profile';
  before: {
    created_batch_ids?: string[];       // add: створені партії — видалити при undo
    modified_batches?: PantryBatch[];   // rename/correct/open/deplete: повернути в цей стан
    removed_shopping_ids?: string[];    // shopping remove: повернути назад (потрібне окреме сховище — пізніше)
    added_shopping_ids?: string[];      // shopping add: видалити при undo
    profile_before?: Profile;           // profile: повернути весь блок
  };
}

export interface Profile {
  user_id: string;
  allergies: string[];
  wishes: string[];
  antipatterns: string[];
  equipment: Record<string, 'has' | 'lacks'>;
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
