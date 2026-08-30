import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export type FixtureKind = 'attachment_parse' | 'chat';

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
    readJson('qa6-onboarding-asks.json'),
  ];
  return list;
}
