// Мобільний аудит 0912 · A (№50): @sentry/react — найбільша стороння залежність
// у стартовому чанку, а потрібна лише щоб відправити падіння. Фасад лишає
// той самий API (main, App, store/auth, Boom), а реалізацію (sentry-impl.ts з
// самим SDK) тягне динамічним import після першого рендера. Що сталось до
// завантаження — стає в чергу і летить, щойно SDK готовий; без DSN черга
// не збирається взагалі.
import { SMOKE_TEST_MARK } from './sentry-mark';
export { SMOKE_TEST_MARK };

type Impl = typeof import('./sentry-impl');

let impl: Impl | null = null;
let pending: Promise<Impl> | null = null;
const queue: Array<(m: Impl) => void> = [];

function later(run: (m: Impl) => void) {
  if (impl) run(impl);
  else if (pending) queue.push(run);
}

export function sentryOn(): boolean {
  return impl?.sentryOn() ?? false;
}

/** Тільки для тестів: забути стан між прогонами. */
export async function __resetSentry(): Promise<void> {
  if (impl) await impl.__resetSentry();
  impl = null; pending = null; queue.length = 0;
}

export function initSentry(dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined): Promise<void> {
  if (!dsn || pending) return pending ? pending.then(() => undefined) : Promise.resolve();
  pending = import('./sentry-impl').then((m) => {
    m.initSentry(dsn);
    impl = m;
    for (const run of queue.splice(0)) run(m);
    return m;
  });
  return pending.then(() => undefined);
}

export function setSentryUser(user_id: string | null): void {
  later((m) => m.setSentryUser(user_id));
}

/** Падіння з ErrorBoundary: код події, якщо SDK уже тут; інакше — у чергу, а людині — без чипа. */
export function captureCrash(error: Error, componentStack?: string | null): string | null {
  if (impl) return impl.captureCrash(error, componentStack);
  console.error(error);
  later((m) => m.captureCrash(error, componentStack));
  return null;
}

export function captureClientIncident(name: string, ctx: Record<string, unknown> = {}): void {
  later((m) => m.captureClientIncident(name, ctx));
}
