// @vitest-environment node
// Тест справжнього apps/web/public/sw.js — файл не імпортується застосунком,
// тож виконуємо його у пісочниці з підставними self/caches.
//
// Перевіряємо те, заради чого його правили 29.09: activate більше не зносить
// кеш, на який спираються ВЖЕ ВІДКРИТІ вкладки (skipWaiting + clients.claim
// перехоплюють їх миттєво), інакше стара вкладка йде по свої чанки в мережу й
// ловить 404 — той самий vite:preloadError.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

function loadSw(version: string, existing: string[]) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const deleted: string[] = [];
  const self = {
    location: { href: `https://kitchen-os.app/sw.js?v=${version}` },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const caches = {
    keys: async () => existing.slice(),
    delete: async (k: string) => { deleted.push(k); return true; },
    open: async () => ({ addAll: async () => undefined, put: async () => undefined }),
    match: async () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('self', 'caches', SRC)(self, caches);
  return { listeners, deleted };
}

async function runActivate(version: string, existing: string[]) {
  const { listeners, deleted } = loadSw(version, existing);
  let waited: Promise<unknown> = Promise.resolve();
  listeners.activate?.({ waitUntil: (p: Promise<unknown>) => { waited = p; } } as unknown);
  await waited;
  return { deleted, kept: existing.filter((k) => !deleted.includes(k)) };
}

describe('sw.js · activate', () => {
  it('три старі кеші й новий → лишаються новий і найсвіжіший зі старих', async () => {
    // Версії — Date.now().toString(36); тут вони йдуть за зростанням.
    const { kept, deleted } = await runActivate('mumz601p', [
      'kitchen-os-mg5fg2pp', // рік тому
      'kitchen-os-mtg3yg1p', // місяць тому
      'kitchen-os-muljq5dp', // вчора — найсвіжіша попередня
      'kitchen-os-mumz601p', // поточна
    ]);
    expect(kept.sort()).toEqual(['kitchen-os-muljq5dp', 'kitchen-os-mumz601p']);
    expect(deleted.sort()).toEqual(['kitchen-os-mg5fg2pp', 'kitchen-os-mtg3yg1p']);
  });

  it('перший деплой (старих кешів немає) — нічого не видаляємо', async () => {
    const { kept, deleted } = await runActivate('mumz601p', ['kitchen-os-mumz601p']);
    expect(kept).toEqual(['kitchen-os-mumz601p']);
    expect(deleted).toEqual([]);
  });

  it('чужі кеші на тому ж домені не чіпаємо', async () => {
    const { kept } = await runActivate('mumz601p', [
      'kitchen-os-mumz601p', 'kitchen-os-muljq5dp', 'workbox-precache-v2',
    ]);
    expect(kept).toContain('workbox-precache-v2');
  });

  it('поточна версія лишається завжди, навіть якщо кеш під неї ще не створено', async () => {
    const { kept } = await runActivate('mumz601p', ['kitchen-os-muljq5dp']);
    expect(kept).toEqual(['kitchen-os-muljq5dp']);
  });
});
