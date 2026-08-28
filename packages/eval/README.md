# @kitchen/eval

Фікстури + інваріанти + прогінник із дифом до попереднього. Головне: **інваріанти, а не точний текст**. Модель має право формулювати як хоче — але не має права порушувати правило.

## Запуск

```bash
pnpm eval                    # прогнати всі фікстури, показати діф до baseline
pnpm eval -- --baseline      # промоутнути поточний прогін у baseline
pnpm eval -- --diff-only     # ніколи не завершуватись з exit 1 (для CI дифа)
PROMPT_VERSION=2026-08-28 pnpm eval
```

Без `ANTHROPIC_API_KEY` кожна фікстура — `SKIPPED`. Прогін усе одно перевіряє, що `@kitchen/prompts` завантажується, `manifest.json` погоджений з файлами і TypeScript компілюється. Це навмисне: на CI без ключа ми хочемо ловити регресії скелета.

## Що вимірюється

Файл `invariants.ts` тримає весь реєстр. Іменування — `kebab-case`, параметричні через двокрапку: `topic-holds:плескавиц`, `mentions-allergen-out-loud:мідії`.

| Фікстура | Інваріанти |
|---|---|
| `receipt-abbreviated` | `receipt-coverage-80`, `expanded-abbreviations`, `no-prices`, `plastic-bag-included` |
| `receipt-nonfood` | `receipt-coverage-80`, `no-prices`, `includes-nonfood` |
| `shelf-photo` | `visual-guess-on-all`, `low-confidence-on-uncertain`, `no-fantasy-sorts` |
| `recipe-freeform` | `all-placeholders-substituted`, `no-pantry-ids-in-user-text`, `ing-uses-p-or-n-never-both`, `max-9-ings-6-steps` |
| `topic-continuity` | `topic-holds:плескавиц`, `no-shopping-on-give-recipe`, `proposal-single-item-when-topic-set` |
| `missing-ingredient` | `is-proposal`, `not-a-refusal`, `needs-mentions-креветк`, `at-least-2-items` |
| `allergen-conflict` | `not-a-refusal`, `mentions-allergen-out-loud:мідії`, `does-not-hide-ingredient`, `does-not-list-mussels-as-normal` |

## Снапшоти

- `snapshots/latest.json` — останній прогін
- `snapshots/baseline.json` — базова лінія, з якою діфимось

Діф іде в консоль:

```
=== ДІФ до baseline ===
  topic-continuity · no-shopping-on-give-recipe: ✓ → ✗
```

Це те, що йде в commit message разом зі зміною промпту. Без цього неможливо міняти промпти.

## Додати фікстуру

1. Файл у `fixtures/` (`.json` для чат-кейсів, `.txt` для вкладень)
2. Ряд у `fixtures/index.ts`
3. Інваріант — у `invariants.ts` в `registry`, або через параметричну назву в `resolve()`
