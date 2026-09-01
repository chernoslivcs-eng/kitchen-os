import { describe, it, expect } from 'vitest';
import { loadPrompt, compose } from '@kitchen/prompts';

// №5: card-rules.md розкладено на жанри (contract / state / tone / schemas /
// routing / policy). Розщеплення дало жанрам окремих власників — але й новий
// ризик: тепер порядок блоків живе в manifest.json і його можна переставити
// одним рядком, нічого не помітивши.
//
// Порядок тут не косметика. Він несе два задокументовані інваріанти:
//   · контракт відповіді мусить стояти ДО схем і правил — інакше модель читає
//     «поверни картку X» раніше, ніж дізнається, що відповідь узагалі JSON;
//   · proposal-flow йде ОСТАННІМ: це надбудова над правилами карток, а не
//     заміна їм.
//
// Байт-у-байт промпт НЕ фіксуємо навмисно: він мусить розвиватись. Фіксуємо
// саме те, що ламається тихо й дорого.

const ORDER = [
  'Ти кухар, який стоїть поруч',            // role
  'КОНТРАКТ ВІДПОВІДІ',                     // card-contract
  '- ФАКТИ ПРО КОМОРУ',                     // state-facts
  '- ВІДМОВА ПОЗА ТЕМОЮ КУХНІ',             // tone-language
  'CARD варіанти:',                         // card-schemas
  'Правила:',                               // card-routing
  '- `kind:"intent"`',                      // kitchen-policy
  'МАТРИЦЯ ПРОПОЗИЦІЙ',                     // proposal-flow
];

describe('порядок блоків у складеному промпті', () => {
  it('усі блоки присутні й у заданому порядку', () => {
    const s = compose('chat', loadPrompt(), {});
    let prev = -1;
    for (const marker of ORDER) {
      const at = s.indexOf(marker);
      expect(at, `блок «${marker}» відсутній у промпті`).toBeGreaterThan(-1);
      expect(at, `блок «${marker}» стоїть раніше за попередній`).toBeGreaterThan(prev);
      prev = at;
    }
  });

  // Онбординг вклинюється МІЖ роллю й контрактом — саме там, де він і має
  // бути: людина вже знає, хто перед нею, але ще не дійшла до механіки.
  it('онбординг стоїть після ролі й до контракту', () => {
    const s = compose('chat', loadPrompt(), { stage: 1 });
    const role = s.indexOf('Ти кухар, який стоїть поруч');
    const onboarding = s.indexOf('ЗНАЙОМСТВО, ЕТАП 1');
    const contract = s.indexOf('КОНТРАКТ ВІДПОВІДІ');
    expect(onboarding).toBeGreaterThan(role);
    expect(contract).toBeGreaterThan(onboarding);
  });

  it('без stage онбординг не потрапляє в промпт', () => {
    const s = compose('chat', loadPrompt(), {});
    expect(s).not.toContain('ЗНАЙОМСТВО, ЕТАП');
  });

  // Голос зібраний в одному місці — заради цього переносили «ВІДМОВУ».
  // Якщо мовні правила знову розповзуться по маршрутизації, конфлікт між
  // жанрами знову стане невидимим (так стався M13 п.1).
  it('мовні правила тримаються купи, не розсипані по маршрутизації', () => {
    const { blocks } = loadPrompt();
    const tone = blocks['tone-language']!;
    for (const marker of ['ВІДМОВА ПОЗА ТЕМОЮ КУХНІ', 'УКРАЇНСЬКА', 'ЗВЕРТАННЯ — ЗАВЖДИ НА «ТИ»']) {
      expect(tone, `«${marker}» має жити у tone-language`).toContain(marker);
    }
    for (const other of ['card-routing', 'kitchen-policy', 'card-contract']) {
      expect(blocks[other], `«ЗВЕРТАННЯ» протекло в ${other}`).not.toContain('ЗВЕРТАННЯ — ЗАВЖДИ');
    }
  });
});
