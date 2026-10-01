// Повідомлення людині в бот — спільний будівник для крону й разових скриптів.
//
// Привід: end-beta.mts його не підключав зовсім. Люди без пошти (а це 7 із 31
// на день переходу) мовчки не отримували нічого, і скрипт друкував
// «повідомлень у бот 0» — так, ніби таких людей просто немає.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRepo } from '@kitchen/domain';
import { makeTelegramNotify } from '../src/telegram-notify.js';

describe('makeTelegramNotify', () => {
  let repo: InMemoryRepo;
  let sent: Array<{ chat_id: number; text: string }>;
  const send = async (chat_id: number, text: string) => { sent.push({ chat_id, text }); };
  beforeEach(() => { repo = new InMemoryRepo(); sent = []; });

  const user = async (telegram_user_id: number, chat_id: number | null) => {
    const made = await repo.createUserFromTelegram({ telegram_user_id, chat_id, name: 'Т' });
    return made.user_id;
  };

  it('без токена — undefined: каналу немає, стани міняються однаково', () => {
    expect(makeTelegramNotify(repo, undefined, send)).toBeUndefined();
    expect(makeTelegramNotify(repo, '', send)).toBeUndefined();
  });

  it('привʼязаний акаунт отримує текст у свій чат', async () => {
    const user_id = await user(5001, 7001);
    await makeTelegramNotify(repo, 'tok', send)!(user_id, 'привіт');
    expect(sent).toEqual([{ chat_id: 7001, text: 'привіт' }]);
  });

  it('після /stop не пишемо: привʼязка відкликана', async () => {
    const user_id = await user(5002, 7002);
    await repo.revokeTelegram(user_id, new Date().toISOString());
    await makeTelegramNotify(repo, 'tok', send)!(user_id, 'привіт');
    expect(sent).toEqual([]);
  });

  it('акаунт із віджета без chat_id — нікуди слати', async () => {
    const user_id = await user(5003, null);
    await makeTelegramNotify(repo, 'tok', send)!(user_id, 'привіт');
    expect(sent).toEqual([]);
  });

  it('людина без привʼязки взагалі — тиша, не помилка', async () => {
    await makeTelegramNotify(repo, 'tok', send)!('кого-нема', 'привіт');
    expect(sent).toEqual([]);
  });
});
