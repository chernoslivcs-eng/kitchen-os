// Розсилка одного тексту всім членам дому: пошта, бот або нічого.
//
// Правило каналів — зі спеків (2026-09-25 §7, 2026-10-01 §5): хто з поштою —
// лист, хто з Telegram — у бот, у кого немає ні того, ні того — нічого, а
// стан міняється однаково.
//
// Чому окремий модуль і чому він НІКОЛИ не кидає: інцидент 01.10. Власник
// запустив end-beta на проді, на першому ж старому QA-акаунті з @example.com
// nodemailer кинув «550 Invalid `to` field», виняток вилетів необробленим —
// скрипт зупинився посередині. 21 дім перейшов у demo, 9 лишились у бета-стані,
// і щоденний крон упав би на тому самому домі, не дійшовши до решти.
//
// Звідси два правила: одна адреса не вирішує долю інших, і вигадані домени
// навіть не пробуємо — вони не «не вдались», вони пропущені.
import type { Repo } from '@kitchen/domain';
import type { Mailer } from './mailer.js';
import { isUndeliverable } from './auth-flood.js';
import type { TelegramNotify } from './telegram-notify.js';

export interface NotifyTally {
  /** Скільком людям лист пішов насправді. */
  mails: number;
  /** Скільком пішло в бот. */
  notes: number;
  /** Вигадані адреси, яких не пробували. */
  skipped: number;
  /** Спроби, які кинули. */
  failed: number;
  /** household_id, де хоч одна спроба впала — для підсумку скрипта. */
  failures: string[];
}

/**
 * Що саме шлемо. `html` іде лише поштою, `button` — лише в бот (у листі
 * кнопка вже всередині html).
 */
export interface Outgoing {
  subject: string;
  text: string;
  html?: string;
  button?: { label: string; url: string };
}

export interface NotifyDeps {
  repo: Repo;
  mailer: Mailer;
  telegramNotify?: TelegramNotify;
  /** Куда писати про невдачу. Дефолт — console.error. */
  log?: (o: Record<string, unknown>, msg: string) => void;
}

const empty = (): NotifyTally => ({ mails: 0, notes: 0, skipped: 0, failed: 0, failures: [] });

export function mergeTally(a: NotifyTally, b: NotifyTally): NotifyTally {
  return {
    mails: a.mails + b.mails, notes: a.notes + b.notes,
    skipped: a.skipped + b.skipped, failed: a.failed + b.failed,
    failures: [...a.failures, ...b.failures],
  };
}

export async function notifyHousehold(deps: NotifyDeps, household_id: string, msg: Outgoing): Promise<NotifyTally> {
  const out = empty();
  const log = deps.log ?? ((o, msg) => console.error(msg, o));
  for (const m of await deps.repo.listMembersOfHousehold(household_id)) {
    const u = await deps.repo.getUser(m.user_id);
    // Адреси в логи не кладемо: у разовій дії по сотнях домів це був би дамп
    // чужих пошт у термінал і в історію оболонки. household_id досить, щоб
    // знайти рядок у базі.
    const channel = u?.email ? 'mail' : deps.telegramNotify ? 'bot' : 'none';
    try {
      if (u?.email) {
        // Фільтр тільки коли мейлер справді шле назовні: наші ж тести й стенд
        // живуть на @example.com і .test, і там шкоди від них немає.
        if (deps.mailer.delivers && isUndeliverable(u.email)) { out.skipped++; continue; }
        await deps.mailer.sendPlain({ to: u.email, subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}) });
        out.mails++;
      } else if (deps.telegramNotify) {
        await deps.telegramNotify(m.user_id, msg.text, msg.button);
        out.notes++;
      }
    } catch (err) {
      out.failed++;
      if (!out.failures.includes(household_id)) out.failures.push(household_id);
      log({ household_id, channel, err: String(err) }, 'notify-failed');
    }
  }
  return out;
}

export { empty as emptyTally };
