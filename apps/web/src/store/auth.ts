// Zustand-store для профілю активної сесії.
// «Джерело правди» — /v1/me. Ми його викликаємо на старті застосунку, потім
// після успішного /auth/verify (браузер вже має cookie), і після logout.

import { create } from 'zustand';
import { api, ApiError, type Me } from '../api';
import { setSentryUser, captureClientIncident } from '../lib/sentry';

type Status = 'idle' | 'loading' | 'guest' | 'signed_in' | 'error';

interface AuthState {
  status: Status;
  me: Me | null;
  error: string | null;
  refresh: () => Promise<void>;
  requestMagicLink: (email: string, next?: string | null) => Promise<void>;
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
      // Крок О1б: хто це — щоб падіння в Sentry зводилось зі стрічкою дня на
      // /admin/pulse. Тільки id: пошта й імʼя туди не їдуть.
      setSentryUser(me.user.id);
      set({ status: 'signed_in', me });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSentryUser(null);
        set({ status: 'guest', me: null });
        return;
      }
      // Крок О1б: /v1/me не відповів на старті — застосунок для цієї людини
      // зараз не існує взагалі. Найважливіший клієнтський сигнал, і сервер
      // про нього не дізнається: запит до нього не доїхав.
      captureClientIncident('boot-me-failed', {
        status: err instanceof ApiError ? err.status : null,
      });
      set({ status: 'error', error: (err as Error).message });
    }
  },

  requestMagicLink: async (email, next) => {
    await api.auth.request(email, next);
  },

  logout: async () => {
    try { await api.auth.logout(); } catch {}
    setSentryUser(null);
    set({ status: 'guest', me: null });
  },
}));
