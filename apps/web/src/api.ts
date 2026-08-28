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
    logout: () => req<null>('/v1/auth/logout', { method: 'POST' }),
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
};
