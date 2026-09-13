// @vitest-environment jsdom
// Аудит 0913 C.3. Відмова import() чанка: офлайн → без reload, помилка з
// міткою; онлайн → один reload на 60 с (мітка в sessionStorage) і один за
// життя модуля без storage; далі — кидаємо в ErrorBoundary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadWithRecovery, __resetLazyPage } from './lazyPage';

const mod = { default: () => null };
const fail = () => vi.fn().mockRejectedValue(new TypeError('Importing a module script failed'));
function deps(over: Partial<Parameters<typeof loadWithRecovery>[1]> = {}) {
  return { reload: vi.fn(), now: () => 1_000_000, online: () => true, ...over };
}
const pending = async (p: Promise<unknown>) =>
  Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))]);

describe('lazyPage · відновлення чанка', () => {
  beforeEach(() => { __resetLazyPage(); sessionStorage.clear(); });

  it('успішний import — без побічних дій', async () => {
    const d = deps();
    await expect(loadWithRecovery(vi.fn().mockResolvedValue(mod), d)).resolves.toBe(mod);
    expect(d.reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kos-chunk-reload')).toBeNull();
  });

  it('офлайн → без reload, помилка з міткою ChunkOfflineError', async () => {
    const d = deps({ online: () => false });
    await expect(loadWithRecovery(fail(), d)).rejects.toMatchObject({ name: 'ChunkOfflineError' });
    expect(d.reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('kos-chunk-reload')).toBeNull();
  });

  it('онлайн, перша відмова → один reload і мітка; проміс висить', async () => {
    const d = deps();
    const p = loadWithRecovery(fail(), d);
    await vi.waitFor(() => expect(d.reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('kos-chunk-reload')).toBe('1000000');
    expect(await pending(p)).toBe('pending');
  });

  it('онлайн, відмова протягом 60 с після reload → кидає початкову помилку, reload не повторюється', async () => {
    sessionStorage.setItem('kos-chunk-reload', String(1_000_000 - 30_000));
    const d = deps();
    await expect(loadWithRecovery(fail(), d)).rejects.toThrow('Importing a module script failed');
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('онлайн, відмова через понад 60 с після попереднього reload → reload знову', async () => {
    sessionStorage.setItem('kos-chunk-reload', String(1_000_000 - 61_000));
    const d = deps();
    void loadWithRecovery(fail(), d);
    await vi.waitFor(() => expect(d.reload).toHaveBeenCalledTimes(1));
  });

  it('sessionStorage недоступний → рівно один reload за життя модуля', async () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    try {
      const d = deps();
      void loadWithRecovery(fail(), d);
      await vi.waitFor(() => expect(d.reload).toHaveBeenCalledTimes(1));
      await expect(loadWithRecovery(fail(), d)).rejects.toThrow('Importing a module script failed');
      expect(d.reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'sessionStorage', orig);
    }
  });
});
