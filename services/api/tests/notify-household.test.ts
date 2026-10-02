// Розсилка по дому НЕ валить цикл (інцидент 01.10 на проді).
//
// Власник запустив end-beta: на першому ж старому QA-акаунті з @example.com
// nodemailer кинув «550 Invalid `to` field», виняток вилетів необробленим і
// скрипт зупинився посередині. 21 дім перейшов, 9 лишились у бета-стані, а
// щоденний крон 07.10 упав би там само й на тому самому домі.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain';
import { ConsoleMailer, type Mailer } from '../src/mailer.js';
import { notifyHousehold } from '../src/notify-household.js';

/** Мейлер, який шле назовні (delivers: true) і падає на заданих адресах. */
class PickyMailer implements Mailer {
  readonly delivers = true;
  readonly out: string[] = [];
  constructor(private readonly breaksOn: RegExp) {}
  async sendPlain(m: { to: string; subject: string; text: string }): Promise<void> {
    if (this.breaksOn.test(m.to)) throw new Error('550 Invalid `to` field');
    this.out.push(m.to);
  }
  async sendMagicLink(): Promise<void> { throw new Error('не для цього тесту'); }
}

describe('notifyHousehold', () => {
  let repo: InMemoryRepo;
  beforeEach(() => { repo = new InMemoryRepo(); });

  const house = async (emails: Array<string | null>) => {
    let household_id = '';
    for (const [i, email] of emails.entries()) {
      if (email) {
        const made = await repo.createUserWithHousehold(email, `U${i}`);
        if (!household_id) household_id = made.household_id;
        else await repo.addMember(household_id, made.user_id, 'member');
      } else {
        const made = await repo.createUserFromTelegram({ telegram_user_id: 8000 + i, chat_id: 9000 + i, name: `T${i}` });
        if (!household_id) household_id = (await repo.firstHouseholdOf(made.user_id))!;
        else await repo.addMember(household_id, made.user_id, 'member');
      }
    }
    return household_id;
  };

  it('лист одному впав — решта дому все одно отримує; невдача в лічильнику', async () => {
    const mailer = new PickyMailer(/@example\.com$/);
    const household_id = await house(['real@gmail.com', 'qa@example.com', 'second@gmail.com']);
    // Адресу зі списку «вигаданих» відсікаємо ДО відправки, тому падати нічому;
    // щоб довести саме стійкість, ламаємо на справжньому домені.
    const t = await notifyHousehold({ repo, mailer: new PickyMailer(/^second@/) }, household_id, 'с', 'т');
    expect(t).toMatchObject({ mails: 1, failed: 1, skipped: 1, notes: 0 });
    expect(t.failures).toHaveLength(1);
    expect(mailer.out).toEqual([]);     // цей екземпляр не чіпали
  });

  it('вигадана адреса пропускається без спроби: лічильник «пропущено», не «не вдалось»', async () => {
    const mailer = new PickyMailer(/нічого/);
    const household_id = await house(['qa@example.com']);
    const t = await notifyHousehold({ repo, mailer }, household_id, 'с', 'т');
    expect(t).toMatchObject({ mails: 0, skipped: 1, failed: 0 });
    expect(mailer.out).toEqual([]);
  });

  it('мейлер, який нікуди не шле (стенд, тести), адрес не фільтрує', async () => {
    const mailer = new ConsoleMailer();
    const household_id = await house(['qa@example.com']);
    const t = await notifyHousehold({ repo, mailer }, household_id, 'с', 'т');
    expect(t).toMatchObject({ mails: 1, skipped: 0, failed: 0 });
  });

  it('падіння бота теж не валить цикл', async () => {
    const household_id = await house([null, 'real@gmail.com']);
    const t = await notifyHousehold({
      repo, mailer: new PickyMailer(/нічого/),
      telegramNotify: async () => { throw new Error('403 bot was blocked by the user'); },
    }, household_id, 'с', 'т');
    expect(t).toMatchObject({ mails: 1, notes: 0, failed: 1 });
  });

  it('ні пошти, ні бота — тиша без лічильників', async () => {
    const household_id = await house([null]);
    const t = await notifyHousehold({ repo, mailer: new PickyMailer(/нічого/) }, household_id, 'с', 'т');
    expect(t).toMatchObject({ mails: 0, notes: 0, skipped: 0, failed: 0 });
  });

  it('у лог і в failures їде household_id і канал, але НЕ адреса', async () => {
    const household_id = await house(['real@gmail.com']);
    const logged: unknown[] = [];
    const t = await notifyHousehold(
      { repo, mailer: new PickyMailer(/@gmail\.com$/), log: (o) => logged.push(o) },
      household_id, 'с', 'т',
    );
    expect(t.failures).toEqual([household_id]);
    const line = JSON.stringify(logged);
    expect(line).toContain(household_id);
    expect(line).toContain('mail');
    expect(line).toContain('550');
    expect(line).not.toContain('real@gmail.com');
  });
});
