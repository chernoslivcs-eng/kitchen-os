// Тонка обгортка над fetch — усе, що ходить у /v1/*. credentials:'include'
// щоб cookie 'kos' приходила автоматично; в дев-режимі Vite проксить на fastify.

export class ApiError extends Error {
  constructor(public status: number, public payload: unknown, message: string) {
    super(message);
  }
}

// Content-Type ставимо ТІЛЬКИ коли є тіло. Fastify із app/json parser відкидає
// запит із 'application/json' і порожнім тілом (FST_ERR_CTP_EMPTY_JSON_BODY) —
// на цьому мовчки лягали всі DELETE-запити (batches.remove, shopping.remove,
// households.removeMember). Явні заголовки з call-сайту перекривають дефолт.
export function buildHeaders(init: RequestInit): HeadersInit {
  const hasBody = init.body != null;
  return {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: buildHeaders(init),
  });
  const text = await res.text();
  const payload: unknown = text ? safeParse(text) : null;
  if (!res.ok) {
    const msg = extractError(payload) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, payload, msg);
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function extractError(p: unknown): string | null {
  if (p && typeof p === 'object' && 'error' in p) {
    const e = (p as { error: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return null;
}

// ----- Types (мінімум, під те, що потрібно на MVP) ---------------------

export interface Me {
  user: { id: string; name: string; email: string };
  household: {
    id: string;
    name: string;
    role: 'owner' | 'member';
    members: { user_id: string; name: string; role: 'owner' | 'member'; joined_at: string }[];
  };
  session_id: string;
}

export interface PantryBatch {
  id: string;
  household_id: string;
  catalog_key: string | null;
  label: string;
  zone: 'dry' | 'fridge' | 'freezer' | 'fresh' | 'spices' | 'drinks';
  value: number | null;
  unit: 'g' | 'ml' | 'pcs' | 'pack' | null;
  state: 'sealed' | 'opened' | 'depleted';
  opened_at: string | null;
  expires_at: string | null;
  best_before_opened_days: number | null;
  added_at: string;
  depleted_at: string | null;
  confidence: number;
  provenance: string;
  staple: boolean;
  last_by: string | null;
  last_action: string | null;
}

export interface PantryList {
  household_id: string;
  count: number;
  batches: PantryBatch[];
}

export interface ChatCard {
  type: 'intake_diff' | 'proposal' | 'shopping' | 'profile';
  ops?: unknown[];
  items?: unknown[];
}

export interface ChatResponse {
  reply: string;
  card: ChatCard | null;
  card_id: string | null;
  raw_kind?: string | null;
  usage: { input: number; output: number; cached?: number };
  meta: { promptVersion: string; model: string; mode: 'stub' | 'live' };
}

// ----- Ендпоінти ---------------------------------------------------------

export const api = {
  auth: {
    request: (email: string, next?: string | null) =>
      req<{ ok: true }>('/v1/auth/request', {
        method: 'POST',
        body: JSON.stringify(next ? { email, next } : { email }),
      }),
    logout: () => req<null>('/v1/auth/logout', { method: 'POST', body: '{}' }),
  },

  me: () => req<Me>('/v1/me'),

  pantry: () => req<PantryList>('/v1/pantry'),

  batches: {
    create: (input: { label: string; value?: number | null; unit?: PantryBatch['unit']; zone?: PantryBatch['zone'] }) =>
      req<{ batch: PantryBatch }>('/v1/pantry', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: Partial<Pick<PantryBatch, 'label' | 'value' | 'unit' | 'zone' | 'state'>>) =>
      req<{ updated: boolean; batch: PantryBatch }>(`/v1/pantry/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    remove: (id: string) => req<{ deleted: true }>(`/v1/pantry/${id}`, { method: 'DELETE' }),
  },

  chat: (input: { text?: string; attachments?: { id: string }[]; session_id?: string }) =>
    req<ChatResponse>('/v1/chat', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  cards: {
    apply: (id: string, selected?: number[]) =>
      req<{ applied: number; undo_token: string; already: boolean }>(
        `/v1/cards/${id}/apply`,
        { method: 'POST', body: JSON.stringify({ selected }) },
      ),
    undo: (id: string, undo_token: string) =>
      req<{ undone: boolean; already: boolean }>(
        `/v1/cards/${id}/undo`,
        { method: 'POST', body: JSON.stringify({ undo_token }) },
      ),
  },

  recipes: {
    generate: (title: string, context?: string) =>
      req<{ recipe: Recipe; meta: unknown; usage: unknown }>(
        '/v1/recipes/generate',
        { method: 'POST', body: JSON.stringify({ title, context }) },
      ),
  },

  session: {
    today: () => req<{ session: SessionInfo; messages: MessageInfo[] }>('/v1/session/today'),
    fresh: () => req<{ session: SessionInfo; messages: MessageInfo[] }>('/v1/session', {
      method: 'POST', body: '{}',
    }),
    list: () => req<{ sessions: (SessionInfo & { message_count: number })[] }>('/v1/sessions'),
    get: (id: string) => req<{ session: SessionInfo; messages: MessageInfo[] }>(`/v1/sessions/${id}`),
  },

  cookRuns: {
    list: () => req<{ runs: CookRunWithRecipe[] }>('/v1/cook-runs'),
    save: (recipe: Recipe, servings?: number, rating?: number, verdict?: string) =>
      req<{ id: string; recipe_id: string; depleted: number; partial: number; depleted_batch_ids: string[] }>('/v1/cook-runs', {
        method: 'POST',
        body: JSON.stringify({ recipe, servings, rating, verdict }),
      }),
    undo: (id: string) =>
      req<{ undone: boolean; already: boolean; restored: number }>(`/v1/cook-runs/${id}/undo`, {
        method: 'POST',
        body: '{}',
      }),
    rate: (id: string, rating: number | null, verdict?: string | null) =>
      req<{ updated: boolean; rating: number | null; verdict: string | null; photo_url: string | null }>(`/v1/cook-runs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ rating, verdict }),
      }),
    setPhoto: (id: string, photo_url: string | null) =>
      req<{ updated: boolean; photo_url: string | null }>(`/v1/cook-runs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ photo_url }),
      }),
  },

  attachments: {
    // Не через req() — FormData, свій content-type ставить браузер.
    // На Vercel body-limit 4.5МБ; фото полиці/страви з телефона 3-8МБ,
    // тому вхідне зображення проганяємо через canvas-ресайз до 1600px
    // по довшій стороні, jpeg q=0.82 — для розпізнавання й preview
    // достатньо, а вага ~300-800КБ. Не-зображення — як є.
    async upload(file: File): Promise<AttachmentUploaded> {
      const prepared = file.type.startsWith('image/') && file.size > 900_000
        ? await downscaleImage(file, 1600, 0.82)
        : file;
      const fd = new FormData();
      fd.append('file', prepared, prepared.name);
      const res = await fetch('/v1/attachments', { method: 'POST', body: fd, credentials: 'include' });
      if (res.status === 413) {
        throw new ApiError(413, null, 'Файл завеликий. Стисни фото або спробуй інше.');
      }
      const text = await res.text();
      const payload: unknown = text ? safeParse(text) : null;
      if (!res.ok) throw new ApiError(res.status, payload, extractError(payload) ?? `HTTP ${res.status}`);
      return payload as AttachmentUploaded;
    },
  },

  shopping: {
    list: () => req<ShoppingList>('/v1/shopping'),
    toggle: (id: string, checked: boolean) =>
      req<{ ok: true; checked: boolean }>(`/v1/shopping/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ checked }),
      }),
    remove: (id: string) => req<null>(`/v1/shopping/${id}`, { method: 'DELETE' }),
    unpack: () => req<{ created: number }>('/v1/shopping/unpack', { method: 'POST', body: '{}' }),
  },

  profile: () => req<{ profile: ProfileData }>('/v1/profile'),

  households: {
    listInvites: (household_id: string) =>
      req<{ invites: InviteInfo[] }>(`/v1/households/${household_id}/invites`),
    invite: (household_id: string, email: string) =>
      req<InviteCreated>(`/v1/households/${household_id}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    removeMember: (household_id: string, user_id: string) =>
      req<null>(`/v1/households/${household_id}/members/${user_id}`, { method: 'DELETE' }),
    setRole: (household_id: string, user_id: string, role: 'owner' | 'member') =>
      req<{ updated: boolean; role: 'owner' | 'member' }>(
        `/v1/households/${household_id}/members/${user_id}`,
        { method: 'PATCH', body: JSON.stringify({ role }) },
      ),
  },

  invites: {
    revoke: (id: string) =>
      req<null>(`/v1/invites/${id}/revoke`, { method: 'POST', body: '{}' }),
  },
};

export interface InviteInfo {
  id: string;
  email: string;
  role: 'owner' | 'member';
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

export interface InviteCreated {
  id: string;
  household_id: string;
  email: string;
  role: 'owner' | 'member';
  expires_at: string;
}

export interface ShoppingItem {
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
export interface ShoppingList {
  household_id: string;
  count: number;
  items: ShoppingItem[];
}

export interface AttachmentUploaded {
  id: string;
  url: string;
  kind: 'image' | 'pdf' | 'text';
  bytes: number;
  content_type: string;
}

export interface ProfileData {
  user_id: string;
  allergies: string[];
  wishes: string[];
  antipatterns: string[];
  equipment: Record<string, 'has' | 'lacks'>;
}

// ----- Recipe types -------------------------------------------------------

export interface RecipeIng {
  p?: string;
  n?: string;
  v?: number;
  u?: string;
}
export interface RecipeStep {
  t: string;
  c: string;
  s?: number;                // сек. для таймера, якщо крок часовий
}
export interface SessionInfo {
  id: string;
  user_id: string;
  title: string | null;
  day: string;
  created_at: string;
}

export interface MessageInfo {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  text: string | null;
  card: ChatCard | null;
  applied: number;
  created_at: string;
}

export interface CookRunBatchChange {
  id: string;
  op: 'deplete' | 'subtract';
  amount?: number;
  prev_state?: string;
  prev_value?: number | null;
  prev_opened_at?: string | null;
  prev_depleted_at?: string | null;
}

export interface CookRunWithRecipe {
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
  changes: { batches: CookRunBatchChange[] } | null;
  undone_at: string | null;
  recipe: {
    id: string;
    title: string;
    time_total: number | null;
    payload: Recipe;
    created_at: string;
  };
}

export interface Recipe {
  t: string;                 // title
  sv: number;                // servings
  tm: number;                // total minutes
  ch: string;                // характер
  d: string;                 // description
  rk: string;                // ключова помилка
  nu?: { kcal: number; p: number; f: number; c: number };
  op?: string[];
  ing: RecipeIng[];
  st: RecipeStep[];
}

// ----- Utilities -----------------------------------------------------------

// Ресайз зображення на клієнті: довша сторона до maxSide, JPEG quality.
// Vercel body-limit 4.5МБ, а фото з телефона 3-8МБ; 1600px+q=0.82 дає
// ~300-800КБ і зберігає деталі етикеток і продуктів.
async function downscaleImage(file: File, maxSide: number, quality: number): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1) return file;
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    // createImageBitmap може падати на HEIC на старих браузерах — тоді надсилаємо
    // оригінал і покладаємось на 413-обробку.
    return file;
  }
}
