import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';
import { InMemoryRepo } from '@kitchen/domain';
import { InMemoryStore } from '../src/attachment-store.js';
import { ConsoleMailer } from '../src/mailer.js';
import { signIn } from './helpers.js';

// Знахідка A аудиту, кінець ланцюга: сам хід у чаті. Комора міняється ТИМ
// САМИМ ходом (auto_applied), тому «Записав» у репліці — доконаний факт, а не
// порушення. Досі пост-процесор переписував його на «Запишу», і людина читала
// майбутній час про хліб, який уже лежав у неї в коморі, під кнопкою
// «Скасувати».

describe('чат: репліка не переписується в майбутній час над застосованою карткою', () => {
  it('«купив X» — комора змінилась, і репліка лишається в минулому часі', async () => {
    const repo = new InMemoryRepo();
    const mailer = new ConsoleMailer();
    const app = buildApp(repo, new InMemoryStore(), mailer);
    await app.ready();
    const me = await signIn(app, mailer, 'me@example.com');

    const r = await app.inject({
      method: 'POST', url: '/v1/chat', headers: { cookie: me.cookie },
      payload: { text: 'купив хліб' },
    });
    const body = r.json();

    expect(body.card?.type).toBe('intake_diff');
    expect(body.auto_applied).toBe(true);
    expect(body.reply).toContain('Записав');
    expect(body.reply).not.toContain('Запишу');
  });
});
