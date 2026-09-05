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
  '- УКРАЇНСЬКА:',                          // tone-language
  'CARD варіанти:',                         // card-schemas
  'Правила:',                               // card-routing
  '- НОТАТКА — поле `note`',                // kitchen-policy (крок 8)
  'МАТРИЦЯ ПРОПОЗИЦІЙ',                     // proposal-flow
  'Ти — продукт із людським голосом',       // voice, крок 6д (735a572): додано останнім у chat.compose
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
    for (const marker of ['УКРАЇНСЬКА', 'ЗВЕРТАННЯ — ЗАВЖДИ НА «ТИ»']) {
      expect(tone, `«${marker}» має жити у tone-language`).toContain(marker);
    }
    for (const other of ['card-routing', 'kitchen-policy', 'card-contract']) {
      expect(blocks[other], `«ЗВЕРТАННЯ» протекло в ${other}`).not.toContain('ЗВЕРТАННЯ — ЗАВЖДИ');
    }
  });

  // Крок 6д (735a572): ВІДМОВА ПОЗА ТЕМОЮ переїхала з tone-language у
  // voice.md (ПОЗА ТЕМОЮ) — не дублікат, а зміна власника правила. Якщо вона
  // колись повернеться в tone-language одночасно з voice.md — це і є той
  // самий розповзений дублікат, від якого рятував перенос.
  it('ВІДМОВА ПОЗА ТЕМОЮ — тепер власність voice.md, не tone-language', () => {
    const { blocks } = loadPrompt();
    expect(blocks['tone-language'], 'ВІДМОВА не мала повернутись у tone-language').not.toContain('ВІДМОВА ПОЗА ТЕМОЮ');
    expect(blocks['voice'], 'voice.md має нести правило про розмову поза темою').toContain('ПОЗА ТЕМОЮ');
  });
});
