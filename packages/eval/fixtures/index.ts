import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export type FixtureKind = 'attachment_parse' | 'chat' | 'recipe_gen';

export interface Fixture {
  id: string;
  description: string;
  call: FixtureKind;
  invariants: string[];
  attachment?: { kind: 'text' | 'image'; path: string; content?: string };
  pantry?: unknown[];
  profile?: unknown;
  audience?: unknown;
  conversation?: { role: 'user' | 'assistant'; content: string }[];
  stage?: 1 | 2;
  shopping?: unknown[];
  notes?: unknown[];
  eaters?: unknown[];
  recentRecipes?: unknown[];
  // №4: що відкрито зараз — кошик, свіжий рецепт, неоцінене готування.
  modes?: unknown[];
  // Плани дому в [ТВОЇ ПЛАНИ] — щоб фікстура могла перевірити правку по id.
  events?: unknown[];
  recentCookRuns?: unknown[];
  now?: string;               // фіксована дата — інакше календарні фікстури живуть один день
  // recipe_gen: user-хід генерації — назва страви (+ опційний edit-контекст),
  // одним рядком, як у проді callRecipe (title\n\ncontext).
  request?: string;
  /** Еталонні продукти, які розбір мусить упізнати. Джерело — не здогад:
   *  пари А↔Б із packages/catalog/tests/fixtures/receipt-corpus.json,
   *  зіставлені за ЦІНОЮ рядка (той самий чек на касі й у застосунку). */
  expect_products?: string[];
  /** Скільки товарних позицій у чеку. Потрібне фото-фікстурам: тексту, з
   *  якого можна порахувати, там немає. */
  expect_lines?: number;
  skip?: string;
}

function readText(name: string): string {
  return readFileSync(join(HERE, name), 'utf-8');
}

function readJson(name: string): Fixture {
  return JSON.parse(readText(name));
}

export function loadFixtures(): Fixture[] {
  const list: Fixture[] = [
    {
      id: 'receipt-abbreviated',
      description: 'Чек СІЛЬПО зі скороченнями («СИР КАМБОЦ.70% 193Г»)',
      call: 'attachment_parse',
      invariants: [
        'receipt-coverage-80',
        'expanded-abbreviations',
        'no-prices',
        'plastic-bag-included',
        'tagger-triples',
      ],
      attachment: { kind: 'text', path: 'receipt-abbreviated.txt', content: readText('receipt-abbreviated.txt') },
    },
    (() => {
      // Фотошлях розбору. Живий провал 02.09: ТОЙ САМИЙ чек текстом
      // розібрався добре (21/21 з product, 14 брендів), а фотографією дав
      // «хусь» замість хустинок, «батер» замість багета, «папір» замість
      // туалетного паперу Zewa — і два різні шоколади злились в один.
      //
      // Жодна фікстура цього не ловила, бо eval узагалі не вмів слати
      // зображення (у model-client.ts стояв TODO). Тепер уміє.
      //
      // Файл до репозиторію не кладемо — це фото чека з приватними даними.
      // Поклади знімок у packages/eval/fixtures/receipt-till-photo.png, і
      // фікстура ввімкнеться сама; без нього вона чесно скіпається, як
      // shelf-photo.
      const img = join(HERE, 'receipt-till-photo.png');
      const expect_lines = 21;
      const expect_products = ["хустинки", "багет", "туалетн", "шоколад", "брускетта", "чипси", "ковбаса", "томат"];
      if (!existsSync(img)) {
        return {
          id: 'receipt-till-photo',
          description: 'Паперовий чек Сільпо ФОТОГРАФІЄЮ (плейсхолдер — поклади receipt-till-photo.png)',
          call: 'attachment_parse' as const,
          invariants: ['receipt-coverage-80', 'expected-expansions', 'triple-discipline'],
          expect_products,
          expect_lines,
          skip: 'no image (receipt-till-photo.png not present)',
        };
      }
      return {
        id: 'receipt-till-photo',
        description: 'Паперовий чек Сільпо фотографією — той самий, що receipt-till-silpo текстом',
        call: 'attachment_parse' as const,
        invariants: ['receipt-coverage-80', 'expected-expansions', 'triple-discipline'],
        expect_products,
        expect_lines,
        attachment: { kind: 'image' as const, path: 'receipt-till-photo.png' },
      };
    })(),
    {
      // 02.09. Наявна фікстура receipt-abbreviated легша за реальність: там
      // слова розділені пробілами («СИР КАМБОЦ.70% 193Г»), а на касовому
      // друку пробілів немає взагалі («Шок25МолЛТKorМигдКок»). Ця — важча.
      //
      // Перший прогін показав НЕ те, чого я чекав, і це варте запису.
      // Я вважав, що розбір ламає профіль `fast`, бо в браузері той самий
      // чек дав у комору «хусь», «батер», «папір». На ТЕКСТІ той самий haiku
      // впорався: 21/21 з product, 14 брендів, «Хуст150HocRutMiniTis» →
      // «хустинки Hoc Rut Mini Tissue 150 шт». Різниця не в моделі, а у
      // ВХОДІ: у браузері було ФОТО, тут текст. Отже ця фікстура стереже
      // розгортання скорочень, а провал фотошляху нею НЕ відтворюється —
      // для нього потрібна image-фікстура, якої в нас немає.
      id: 'receipt-till-silpo',
      description: 'Паперовий чек Сільпо: CamelCase без пробілів, латиниця впереміш («Кр135БрусPontЧорОлив»). Найважчий із трьох реальних форматів.',
      call: 'attachment_parse',
      invariants: [
        'receipt-coverage-80',
        'expanded-abbreviations',
        'no-prices',
        'tagger-triples',
        'triple-discipline',
        'expected-expansions',
      ],
      // Ті самі еталони, що у фотоверсії. Пара фікстур на ОДИН чек — текстом
      // і знімком — і різниця між ними ізолює саме зоровий шлях.
      expect_products: ['хустинки', 'багет', 'туалетн', 'шоколад', 'брускетта', 'чипси', 'ковбаса', 'томат'],
      attachment: { kind: 'text', path: 'receipt-till-silpo.txt', content: readText('receipt-till-silpo.txt') },
    },
    {
      id: 'receipt-nonfood',
      description: 'Чек АТБ із побутовим і напоями — нехарчові теж додати, ціни ігнорувати',
      call: 'attachment_parse',
      invariants: [
        'receipt-coverage-80',
        'no-prices',
        'includes-nonfood',
      ],
      attachment: { kind: 'text', path: 'receipt-nonfood.txt', content: readText('receipt-nonfood.txt') },
    },
    {
      ...readJson('receipt-silpo.json'),
      attachment: { kind: 'text' as const, path: 'receipt-silpo.txt', content: readText('receipt-silpo.txt') },
    },
    (() => {
      const imgPath = join(HERE, 'shelf-photo.jpg');
      if (!existsSync(imgPath)) {
        return {
          id: 'shelf-photo',
          description: 'Фото полиці з неоднозначними продуктами (плейсхолдер — див. shelf-photo.md)',
          call: 'attachment_parse' as const,
          invariants: ['visual-guess-on-all', 'low-confidence-on-uncertain', 'no-fantasy-sorts'],
          skip: 'no image (shelf-photo.jpg not present)',
        };
      }
      return {
        id: 'shelf-photo',
        description: 'Фото полиці з неоднозначними продуктами',
        call: 'attachment_parse' as const,
        invariants: ['visual-guess-on-all', 'low-confidence-on-uncertain', 'no-fantasy-sorts'],
        attachment: { kind: 'image', path: 'shelf-photo.jpg' },
      };
    })(),
    {
      id: 'recipe-freeform',
      // Був call:'recipe_import', якого ніколи не існувало — ні маршруту, ні
      // репозиторію. Розбір вставленого тексту робить той самий attachment_parse.
      description: 'Вставлений рецепт без кількостей — картка з наповненими {N} у кроках',
      call: 'attachment_parse',
      invariants: [
        'all-placeholders-substituted',
        'no-pantry-ids-in-user-text',
        'ing-uses-p-or-n-never-both',
        'max-9-ings-6-steps',
      ],
      attachment: { kind: 'text', path: 'recipe-freeform.txt', content: readText('recipe-freeform.txt') },
    },
    readJson('topic-continuity.json'),
    readJson('missing-ingredient.json'),
    readJson('allergen-conflict.json'),

    // Регресії з ручних QA-прогонів. Кожна — баг, який знайшла людина за
    // дві години; тут він перевіряється за секунди. Додавати сюди кожну
    // нову знахідку, замість того щоб ловити її наступним прогоном.
    readJson('qa5-allergen-proactive.json'),
    readJson('qa5-allergen-on-request.json'),
    readJson('qa5-unapplied-card-truth.json'),
    readJson('qa6-nonfood-purchase.json'),
    readJson('tagger-chat-brand.json'),
    readJson('intent-capture.json'),
    readJson('exotic-ingredient-request.json'),
    readJson('shopping-open-question.json'),
    readJson('recipe-context-carries.json'),
    // Пул-5: №6 «давай» після пропозиції → cook_go; №4 замусорена диктовка.
    readJson('chat-cook-go.json'),
    readJson('chat-dictation-dup.json'),
    readJson('qa6-onboarding-asks.json'),
    readJson('calendar-lent.json'),
    readJson('calendar-no-tradition.json'),
    readJson('calendar-season.json'),
    readJson('notes-remembered.json'),
    readJson('notes-no-duplicate.json'),
    readJson('member-card.json'),
    readJson('calendar-easter-date.json'),
    // Фаза 3: модель пише події. Головне не формат, а те, що дати вона не рахує.
    readJson('event-relative.json'),
    readJson('event-no-time.json'),
    readJson('event-edit.json'),
    readJson('own-recipe-text.json'),
    readJson('generated-recipe-memory.json'),
    readJson('recipe-edit-move.json'),
    readJson('recipe-edit-keeps-cast.json'),
    readJson('servings-scale.json'),
    readJson('pantry-truth.json'),
    readJson('shopping-truth.json'),
    readJson('cart-extend-mode.json'),
    readJson('cook-chronology.json'),
    readJson('excluded-then-offered.json'),
    readJson('rescues-fit.json'),
    readJson('lesson-into-step.json'),
    readJson('feedback-diagnosis.json'),
    readJson('shared-meal-allergen.json'),
    readJson('generic-label-ask.json'),
    // Аудит 04.09, раунд 2: перші фікстури з ПРОДУ, не з QA — s41, s45
    // (audit-materials/sessions). Плюс носій «не застосовано» після того, як
    // intake_diff став auto: картка на підтвердженні.
    readJson('receipt-resend-no-reintake.json'),
    readJson('save-generated-recipe.json'),
    readJson('fish-week-is-event.json'),
    readJson('unapplied-profile-truth.json'),
  ];
  return list;
}
