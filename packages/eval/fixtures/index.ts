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
  recentCookRuns?: unknown[];
  now?: string;               // фіксована дата — інакше календарні фікстури живуть один день
  // recipe_gen: user-хід генерації — назва страви (+ опційний edit-контекст),
  // одним рядком, як у проді callRecipe (title\n\ncontext).
  request?: string;
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
  ];
  return list;
}
