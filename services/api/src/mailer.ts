// Один канал доставки — інтерфейс. Три реалізації в проді:
//   ConsoleMailer — пише в stdout + тримає останнє в памʼяті (дев, тести)
//   SmtpMailer    — через nodemailer, працює з Resend SMTP / SES SMTP / будь-яким SMTP-хостом
//                   (обираємо SMTP, а не HTTP-специфічний Resend SDK, щоб не привʼязуватись
//                   до одного провайдера — той самий код працює на будь-якому)
//
// Продукт-провайдер (Resend, Postmark, SES, Mailgun) обирається людиною в UI Neon-подібним чином:
// створити акаунт, взяти SMTP-креденшли, покласти в env — код не змінюється.

import { createTransport, type Transporter } from 'nodemailer';
import { MAIL } from '@kitchen/domain/paywall';
import { renderLetter } from './mail-template.js';
import { fileURLToPath } from 'node:url';

export interface MagicLinkMail {
  to: string;
  link: string;
  expires_in_min: number;
}

/**
 * Лист від продукту: крон біллінгу, завершення бети, попередження про
 * видалення. `html` — зібраний шаблон (mail-template.ts); без нього лист
 * піде самим текстом, як і раніше.
 *
 * Текстова частина обовʼязкова завжди, навіть коли є html: клієнт без
 * розмітки й спам-фільтри мусять бачити те саме (спек EMAIL-SPEC-1003).
 */
export interface PlainMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  sendMagicLink(mail: MagicLinkMail): Promise<void>;
  sendPlain(mail: PlainMail): Promise<void>;
  /**
   * Чи йдуть листи назовні насправді. Від цього залежить, чи відсікати
   * «вигадані» домени (.test, .invalid, example.com): їхня єдина шкода —
   * спалена квота справжнього відправника. На стенді й у тестах шкоди немає,
   * а наші ж тести й стенд живуть саме на таких адресах (@example.com — 451
   * згадка, стенд — dev@local.test).
   */
  readonly delivers: boolean;
}

export class ConsoleMailer implements Mailer {
  readonly delivers = false;
  public sent: MagicLinkMail[] = [];
  public plain: PlainMail[] = [];

  async sendPlain(mail: PlainMail): Promise<void> {
    this.plain.push(mail);
    console.log(`[mail] ${mail.subject} → ${mail.to}\n  ${mail.text}`);
  }

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    this.sent.push(mail);
    console.log(
      `[mail] magic link → ${mail.to} (діє ${mail.expires_in_min} хв):\n  ${mail.link}`,
    );
    // Дублюємо у файл — stdout процесу недосяжний для QA-сесій у пісочниці, і
    // через це онбординг stage=1 лишався неперевіреним п'ять прогонів поспіль.
    // Тільки поза продом: у проді працює SmtpMailer, сюди ми не потрапляємо.
    // Файл лягає в /tmp — не в репо, не в бекапи, живе до перезавантаження.
    if (process.env.NODE_ENV !== 'production' && !process.env.VITEST) {
      try {
        const { appendFile } = await import('node:fs/promises');
        await appendFile(
          MAGIC_LINK_LOG,
          `${new Date().toISOString()}\t${mail.to}\t${mail.link}\n`,
        );
      } catch { /* лог — зручність, не контракт; падіння тут не має ламати вхід */ }
    }
  }

  last(): MagicLinkMail | null {
    return this.sent[this.sent.length - 1] ?? null;
  }
}

// Файл лежить у корені репо, а не в /tmp: QA-сесії живуть в окремих VM зі своїм
// /tmp, і QA-6 довелось діставати лог через симлінк у public/. У .gitignore.
export const MAGIC_LINK_LOG = process.env.MAGIC_LINK_LOG
  ?? fileURLToPath(new URL('../../../.qa-magic-links.log', import.meta.url));

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;                    // «Кухня <no-reply@kos.app>»
  secure?: boolean;                // TLS: true на 465, false на 587 (STARTTLS вмикається сам)
  /** Звідки лист бере PNG знака й кільця. У пошті відносних шляхів не буває. */
  appUrl: string;
}

export class SmtpMailer implements Mailer {
  readonly delivers = true;
  private transporter: Transporter;
  private from: string;
  private appUrl: string;

  constructor(cfg: SmtpConfig) {
    this.transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure ?? cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    this.from = cfg.from;
    this.appUrl = cfg.appUrl;
  }

  async sendPlain(mail: PlainMail): Promise<void> {
    // Той самий `from`, що в магік-лінку: інакше листи від продукту приходять
    // з двох різних адрес і половина осідає в спамі.
    await this.transporter.sendMail({
      from: this.from, to: mail.to, subject: mail.subject, text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    });
  }

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    // Лист 1 зі спека EMAIL-SPEC-1003 — той самий шаблон, що в решти листів.
    // Доти тут був свій тонкий html із голим посиланням: він пережив рік і
    // чотири редакції текстів, бо жив окремо від усього іншого.
    const letter = MAIL.login(mail.expires_in_min, mail.link);
    const { html, text } = renderLetter(letter, { assetsBase: this.appUrl });
    await this.transporter.sendMail({ from: this.from, to: mail.to, subject: letter.subject, text, html });
  }
}


// Вибір мейлера за env — одне місце, куди дивиться server.ts.
export function pickMailer(): Mailer {
  const host = process.env.SMTP_HOST;
  if (!host) return new ConsoleMailer();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASS ?? '';
  const from = process.env.MAIL_FROM ?? `no-reply@${host}`;
  return new SmtpMailer({ host, port, user, pass, from, appUrl: process.env.APP_URL ?? 'https://kitchen-os.app' });
}
