// Zustand-store для профілю активної сесії.
// «Джерело правди» — /v1/me. Ми його викликаємо на старті застосунку, потім
// після успішного /auth/verify (браузер вже має cookie), і після logout.

import { create } from 'zustand';
import { api, ApiError, type Me } from '../api';

type Status = 'idle' | 'loading' | 'guest' | 'signed_in' | 'error';

interface AuthState {
  status: Status;
  me: Me | null;
  error: string | null;
  refresh: () => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'idle',
  me: null,
  error: null,

  refresh: async () => {
    set({ status: 'loading', error: null });
    try {
      const me = await api.me();
      set({ status: 'signed_in', me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ status: 'guest', me: null });
        return;
      }
      set({ status: 'error', error: (err as Error).message });
    }
  },

  requestMagicLink: async (email) => {
    await api.auth.request(email);
  },

  logout: async () => {
    try { await api.auth.logout(); } catch {}
    set({ status: 'guest', me: null });
  },
}));
