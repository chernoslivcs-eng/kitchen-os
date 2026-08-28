// Один канал доставки — інтерфейс. Три реалізації в проді:
//   ConsoleMailer — пише в stdout + тримає останнє в памʼяті (дев, тести)
//   SmtpMailer    — через nodemailer, працює з Resend SMTP / SES SMTP / будь-яким SMTP-хостом
//                   (обираємо SMTP, а не HTTP-специфічний Resend SDK, щоб не привʼязуватись
//                   до одного провайдера — той самий код працює на будь-якому)
//
// Продукт-провайдер (Resend, Postmark, SES, Mailgun) обирається людиною в UI Neon-подібним чином:
// створити акаунт, взяти SMTP-креденшли, покласти в env — код не змінюється.

import { createTransport, type Transporter } from 'nodemailer';

export interface MagicLinkMail {
  to: string;
  link: string;
  expires_in_min: number;
}

export interface Mailer {
  sendMagicLink(mail: MagicLinkMail): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  public sent: MagicLinkMail[] = [];

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    this.sent.push(mail);
    console.log(
      `[mail] magic link → ${mail.to} (діє ${mail.expires_in_min} хв):\n  ${mail.link}`,
    );
  }

  last(): MagicLinkMail | null {
    return this.sent[this.sent.length - 1] ?? null;
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;                    // «Кухня <no-reply@kos.app>»
  secure?: boolean;                // TLS: true на 465, false на 587 (STARTTLS вмикається сам)
}

export class SmtpMailer implements Mailer {
  private transporter: Transporter;
  private from: string;

  constructor(private cfg: SmtpConfig) {
    this.transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure ?? cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    this.from = cfg.from;
  }

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    const subject = 'Твій вхід у Кухню';
    // Свідомо тонкий текст: одне речення, лінк, ще одне речення. Не HTML-простирадло.
    // Причина — mail-клієнти по-різному ламають форматування, і чим менше форматування,
    // тим менше шансів, що лінк спрацює як «просто текст» без клікабельності.
    const text = [
      'Клікни, щоб зайти в Кухню:',
      '',
      mail.link,
      '',
      `Лінк діє ${mail.expires_in_min} хв. Якщо ти не запитував — просто ігноруй.`,
    ].join('\n');
    const html = [
      '<p>Клікни, щоб зайти в Кухню:</p>',
      `<p><a href="${escapeHtml(mail.link)}">${escapeHtml(mail.link)}</a></p>`,
      `<p style="color:#666">Лінк діє ${mail.expires_in_min} хв. Якщо ти не запитував — просто ігноруй.</p>`,
    ].join('');
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject,
      text,
      html,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Вибір мейлера за env — одне місце, куди дивиться server.ts.
export function pickMailer(): Mailer {
  const host = process.env.SMTP_HOST;
  if (!host) return new ConsoleMailer();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASS ?? '';
  const from = process.env.MAIL_FROM ?? `no-reply@${host}`;
  return new SmtpMailer({ host, port, user, pass, from });
}
