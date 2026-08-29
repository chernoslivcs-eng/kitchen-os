// Тонка обгортка над fetch — усе, що ходить у /v1/*. credentials:'include'
// щоб cookie 'kos' приходила автоматично; в дев-режимі Vite проксить на fastify.

export class ApiError extends Error {
  constructor(public status: number, public payload: unknown, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
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
    request: (email: string) =>
      req<{ ok: true }>('/v1/auth/request', { method: 'POST', body: JSON.stringify({ email }) }),
    logout: () => req<null>('/v1/auth/logout', { method: 'POST', body: '{}' }),
  },

  me: () => req<Me>('/v1/me'),

  pantry: () => req<PantryList>('/v1/pantry'),

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
  },

  cookRuns: {
    list: () => req<{ runs: CookRunWithRecipe[] }>('/v1/cook-runs'),
    save: (recipe: Recipe, servings?: number, rating?: number, verdict?: string) =>
      req<{ id: string; recipe_id: string; depleted: number; depleted_batch_ids: string[] }>('/v1/cook-runs', {
        method: 'POST',
        body: JSON.stringify({ recipe, servings, rating, verdict }),
      }),
  },

  attachments: {
    // Не через req() — FormData, свій content-type ставить браузер.
    async upload(file: File): Promise<AttachmentUploaded> {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await fetch('/v1/attachments', { method: 'POST', body: fd, credentials: 'include' });
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
