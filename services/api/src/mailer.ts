// Один канал доставки — інтерфейс. Прод-мейлер (Resend/Postmark/SES/SMTP) —
// окрема реалізація того самого інтерфейсу. Зараз тільки консольна: пишемо в stdout
// і тримаємо останній лист у памʼяті, щоб тести могли витягти лінк.

export interface MagicLinkMail {
  to: string;
  link: string;
  expires_in_min: number;
}

export interface Mailer {
  sendMagicLink(mail: MagicLinkMail): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  // Останні листи, щоб інтеграційні тести могли їх дістати без монструозних моків.
  public sent: MagicLinkMail[] = [];

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    this.sent.push(mail);
    // На проді буде «підпис у sync-логах», зараз — читабельно в консолі.
    console.log(
      `[mail] magic link → ${mail.to} (діє ${mail.expires_in_min} хв):\n  ${mail.link}`,
    );
  }

  last(): MagicLinkMail | null {
    return this.sent[this.sent.length - 1] ?? null;
  }
}
