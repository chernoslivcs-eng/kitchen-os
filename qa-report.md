# Kitchen OS — QA-звіт як план правок

**Прогін:** 2026-08-29, вручну через Chrome, локальний dev (`:5173` + `:3000`, backend postgres).
**Спостереження зроблені на** `1f42c09`/`564ce65`. **Усі рядки нижче переперевірені на** `d54e445` —
жодна з проблем не зникла, змістились тільки номери рядків у `Feed.tsx`.

**11 знахідок: 3 blocker, 5 major, 3 minor + 4 polish.**
Області 5-8 (рецепт, Cook Mode, ретро, Share, Журнал з даними) не перевірені: їх блокує FIX-01.

Формат: кожна правка — файл, точний патч, команда перевірки і критерій «пройшло».
Патчі писались проти `d54e445`; якщо гілка вже поїхала — звіряти по контексту, не по номеру рядка.

---

## Порядок

```
FIX-01  .env + model.ts        blocker   розблоковує 4 області матриці
FIX-02  api.ts req()           blocker   3 зламані кнопки видалення
FIX-03  cards.tsx «Ні»         blocker   3 мертві кнопки
FIX-11  Pantry.tsx catch       major     без нього FIX-02 не видно, якщо повториться
FIX-04  Pantry.tsx toggle      major     тиха втрата даних
FIX-06  cards.tsx «Рецепт →»   major     2/3 пропозицій недосяжні
FIX-05  model.ts extractJson   major     сирий JSON у чат
FIX-07  plural()               major     мова продукту
FIX-08  TabBar sticky          major     навігація на довгих екранах
FIX-09  placeholder            minor
FIX-10  одиниці                minor
```

Після FIX-01 обов'язково повторити області 5-8 — вони не перевірені жодного разу.

---

## FIX-01 · blocker · Генерація рецепта: модель знята з OpenRouter

**Симптом.** Тап «Рецепт →» не робить нічого. Тост із помилкою гасне за 6 с, юзер лишається в стрічці.

**Доказ.**
```
POST /v1/recipes/generate {"title":"Паста карбонара"}
→ 404 {"message":"404 {\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",
   \"message\":\"No endpoints found for anthropic/claude-3.5-sonnet.\"}}"}
```
`GET https://openrouter.ai/api/v1/models` → 28 моделей `anthropic/*`, `claude-3.5-sonnet` серед них немає.
`claude-3-haiku` ще є — тому чат живий, а рецепт ні.

**Патч 1 — `.env` (і ті самі два рядки у Vercel Env):**
```
MODEL_FAST=anthropic/claude-haiku-4.5
MODEL_SMART=anthropic/claude-sonnet-4.5
```

**Патч 2 — `services/api/src/model.ts:28-37`:**
```diff
 function fastModel(): string {
   if (process.env.MODEL_FAST) return process.env.MODEL_FAST;
-  // OpenRouter точно має claude-3-haiku і claude-3.5-sonnet. Юзер може перевизначити
-  // MODEL_FAST у .env, якщо хоче іншу модель — імена звіряти на openrouter.ai/models.
-  return isOpenRouter() ? 'anthropic/claude-3-haiku' : 'claude-haiku-4-5-20251001';
+  // Слаги OpenRouter застарівають без попередження — актуальні звіряти на
+  // GET openrouter.ai/api/v1/models. Перекривається MODEL_FAST у .env / Vercel Env.
+  return isOpenRouter() ? 'anthropic/claude-haiku-4.5' : 'claude-haiku-4-5-20251001';
 }
 function smartModel(): string {
   if (process.env.MODEL_SMART) return process.env.MODEL_SMART;
-  return isOpenRouter() ? 'anthropic/claude-3.5-sonnet' : 'claude-sonnet-5';
+  return isOpenRouter() ? 'anthropic/claude-sonnet-4.5' : 'claude-sonnet-5';
 }
```

**Перевірка** (перезапустити API, бо `.env` читається на старті):
```bash
curl -s -X POST localhost:3000/v1/recipes/generate \
  -H 'Content-Type: application/json' -b /tmp/kos-cookies.txt \
  -d '{"title":"Паста карбонара"}' | head -c 200
```
**Пройшло:** статус 200, у тілі `{"recipe":{"t":"…","ing":[…],"st":[…]}}`.
**Не пройшло:** будь-який `not_found_error` — слаг знову поїхав, брати новий зі списку моделей.

**Окремо, щоб це не повторилось мовчки.** Усі 63 тести були зелені при мертвому рецепті: вони
перевіряють логіку, а не доступність зовнішнього API. Мінімальний страж — крок у CI:
```yaml
- name: OpenRouter model slugs alive
  run: |
    ids=$(curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id')
    for m in "$MODEL_FAST" "$MODEL_SMART"; do
      echo "$ids" | grep -qx "$m" || { echo "slug $m не існує на OpenRouter"; exit 1; }
    done
  env:
    MODEL_FAST: anthropic/claude-haiku-4.5
    MODEL_SMART: anthropic/claude-sonnet-4.5
```

---

## FIX-02 · blocker · Жоден DELETE із клієнта не доходить

**Симптом.** «Прибрати з комори» → шит лишається відкритим, партія на місці, лічильник не змінився,
жодного повідомлення. Те саме зламано в «×» списку покупок і «× ВИКЛЮЧИТИ» з дому.

**Доказ.**
```
DELETE /v1/pantry/<id>  + Content-Type: application/json, без тіла
→ 400 {"code":"FST_ERR_CTP_EMPTY_JSON_BODY",
       "message":"Body cannot be empty when content-type is set to 'application/json'"}
DELETE /v1/pantry/<id>  без Content-Type
→ 200 {"deleted":true}
```

**Причина.** `apps/web/src/api.ts:10-18` — `req()` підставляє `Content-Type` завжди, тіла в DELETE немає.
Зачіпає `api.ts:122` `batches.remove`, `api.ts:215` `shopping.remove`, `api.ts:230` `households.removeMember`.

**Патч — `apps/web/src/api.ts`:**
```diff
+// Content-Type ставимо ТІЛЬКИ коли є тіло. Fastify відкидає запит із
+// 'application/json' і порожнім тілом (FST_ERR_CTP_EMPTY_JSON_BODY) —
+// на цьому мовчки лягали всі три DELETE-и клієнта.
+export function buildHeaders(init: RequestInit): HeadersInit {
+  const hasBody = init.body != null;
+  return {
+    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
+    ...(init.headers ?? {}),
+  };
+}
+
 async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
   const res = await fetch(path, {
     ...init,
     credentials: 'include',
-    headers: {
-      'Content-Type': 'application/json',
-      ...(init.headers ?? {}),
-    },
+    headers: buildHeaders(init),
   });
```

**Регресійний тест — новий файл `apps/web/src/api.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { buildHeaders } from './api.js';

describe('buildHeaders', () => {
  it('без тіла не ставить Content-Type — інакше Fastify валить DELETE', () => {
    expect(buildHeaders({ method: 'DELETE' })).toEqual({});
  });
  it('з тілом ставить application/json', () => {
    expect(buildHeaders({ method: 'POST', body: '{}' })).toEqual({ 'Content-Type': 'application/json' });
  });
  it('явні заголовки перекривають дефолт', () => {
    expect(buildHeaders({ method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } }))
      .toEqual({ 'Content-Type': 'text/plain' });
  });
});
```
У `apps/web/package.json` додати `"test": "vitest run"` — зараз скрипта немає, і `pnpm -r test` цей пакет пропускає.

**Перевірка:** `pnpm --filter @kitchen/web test` → 3 passed. Далі руками: Комора → партія →
«Прибрати з комори» → підтвердити → позиція зникла, лічильник у шапці зменшився на 1.

---

## FIX-03 · blocker · Кнопка «Ні» — заглушка в трьох типах карток

**Доказ.** `apps/web/src/pages/Feed/cards.tsx`, рядки **91, 173, 205** — усі три однакові:
```tsx
<Button variant="secondary" onClick={() => {}}>Ні</Button>
```
Обробника відхилення в `Feed.tsx` немає взагалі (`grep -n "onDismiss" Feed.tsx` — порожньо).

**Патч — `cards.tsx`.** У `CardProps` додати поле:
```diff
   onApply?: () => void;
+  onDismiss?: () => void;
   onUndo?: () => void;
```
і в усіх трьох місцях (91, 173, 205):
```diff
-          <Button variant="secondary" onClick={() => {}}>Ні</Button>
+          <Button variant="secondary" onClick={onDismiss}>Ні</Button>
```
Не забути додати `onDismiss` у деструктуризацію пропсів кожного з трьох компонентів
(`IntakeCard`, `ShoppingCard`, `ProfileCard`) і прокинути його у `Card`-диспетчері (рядок ~214).

**Патч — `Feed.tsx`.** Поряд із `applyCard` додати:
```ts
function dismissCard(turnId: string) {
  setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, dismissed: true } : t)));
}
```
у тип `Turn` додати `dismissed?: boolean`, у місці рендера картки передати
`onDismiss={() => dismissCard(turn.id)}` і не показувати блок дій, коли `turn.dismissed`.

**Свідоме обмеження:** відхилення живе в пам'яті вкладки й не переживе F5 — та сама природа, що BUG-13
нижче. Для повного рішення потрібен `POST /v1/cards/:id/dismiss` і поле в БД; це окрема задача,
але **кнопка мусить хоча б реагувати** — зараз вона не робить нічого взагалі.

**Перевірка:** Стрічка → «купив кефір 1 л» → «Ні» → блок кнопок зник, картка позначена як відхилена,
у коморі нічого не додалось (`curl localhost:3000/v1/pantry | jq .count` — без змін).

---

## FIX-11 · major · `remove()` ковтає помилку

`apps/web/src/pages/Pantry/Pantry.tsx:217-224` — `try/finally` без `catch`. Саме тому FIX-02
не показував жодного сліду: помилка йшла в unhandled rejection.

```diff
   async function remove() {
     if (!confirm('Прибрати з комори? Це те саме, що «зʼїли» — до історії лишиться.')) return;
     setSaving(true);
     try {
       await api.batches.remove(batch.id);
       await onChanged();
-    } finally { setSaving(false); }
+    } catch (err) {
+      alert(`Не вдалося прибрати: ${(err as Error).message}`);
+    } finally { setSaving(false); }
   }
```
Те саме для `save()` (195) і `toggleOpened()` (209) — обидва без `catch`.
Якщо в проєкті вже є тост-механіка поза Feed — краще нею, `alert` тут як мінімум-мінімум.

---

## FIX-04 · major · Перемикач «Відкрито» мовчки з'їдає правки

**Кроки:** Комора → партія → змінити КІЛЬКІСТЬ на 999 → **не** тиснучи «Зберегти», тапнути «◔ Відкрито».
**Отримав:** стан перемкнувся, шит закрився, 999 зникло. Відтворено двічі.

**Причина.** `Pantry.tsx:209-215` шле в PATCH тільки `{state}`, локальні `label/value/unit/zone` губляться,
а `onChanged()` закриває шит.

```diff
   async function toggleOpened() {
     setSaving(true);
     try {
-      await api.batches.update(batch.id, { state: batch.state === 'sealed' ? 'opened' : 'sealed' });
+      // Шлемо ще й поточні поля форми: інакше тап по перемикачу тихо викидає
+      // усе, що юзер щойно наредагував, і закриває шит.
+      const v = value.trim() === '' ? null : Number(value.trim());
+      await api.batches.update(batch.id, {
+        label: label.trim(),
+        value: v,
+        unit,
+        zone,
+        state: batch.state === 'sealed' ? 'opened' : 'sealed',
+      });
       await onChanged();
     } finally { setSaving(false); }
   }
```

**Перевірка:** повторити кроки вище → у списку `999 г` і крапка стану змінилась.

---

## FIX-06 · major · «Рецепт →» тільки на першій пропозиції з трьох

**Доказ.** `cards.tsx:142` — `{i === 0 && onOpen && (…)}`. Плюс `Feed.tsx:281` `openRecipe()` бере
`items[0]` жорстко, тож навіть із кнопкою на кожній картці всі три вели б в одну страву.
«Ростбіф» і «Грибний крем-суп» у моєму прогоні були просто текстом.

**Патч — `cards.tsx`:** тип `onOpen?: (index: number) => void`, і
```diff
-          {i === 0 && onOpen && (
+          {onOpen && (
             <div className={styles['card-actions']}>
-              <Button variant="positive" onClick={onOpen}>Рецепт →</Button>
+              <Button variant="positive" onClick={() => onOpen(i)}>Рецепт →</Button>
             </div>
           )}
```

**Патч — `Feed.tsx`:**
```diff
-  async function openRecipe(turn: Turn) {
+  async function openRecipe(turn: Turn, index = 0) {
     if (turn.card?.type !== 'proposal') return;
     const items = (turn.card.items as { title?: string; desc?: string }[] | undefined) ?? [];
-    const first = items[0];
-    if (!first?.title) return;
+    const pick = items[index];
+    if (!pick?.title) return;
```
далі в тілі замінити `first.title` / `first.desc` на `pick.title` / `pick.desc`,
а в місці рендера — `onOpen={(i) => openRecipe(turn, i)}`.

**Перевірка:** пропозиція з трьома стравами → кнопка на кожній → тап на третю відкриває саме третю.

---

## FIX-05 · major · Два JSON-об'єкти в відповіді → сирий JSON у чат і не та картка

**Симптом (відтворилось 1 раз із 2, «дай рецепт із шоколаду»):** у стрічку вилився сирий
`{"type":"proposal","items":[…]}` на пів екрана, а карткою став **`intake_diff`**, який пропонував
додати в комору два шоколади, що вже там лежали.

**Збережене повідомлення:**
```
cardType: "intake_diff"
ops: [{label:"Шоколад 25 Мол ЛТ Kor Мигдал Кок", value:59.99, unit:"pcs", zone:"dry"}, {…Пол Чіа…}]
text: "Окей, давайте подивимось… {\"type\":\"proposal\",…"
```

**Причина.** `model.ts:414` `extractJson()` бере **перший** верхньорівневий `{…}` як картку, а весь
інший текст — включно з другим JSON — віддає юзеру як `reply`.

**Патч — `model.ts`:** вирізати з тексту **всі** верхньорівневі об'єкти, а карткою брати перший,
що має валідний `type`:
```ts
function extractJson(text: string): { parsed: unknown; residualText: string } {
  const trimmed = text.trim();
  try { return { parsed: JSON.parse(trimmed), residualText: '' }; } catch {}

  const CARD_TYPES = ['intake_diff', 'proposal', 'shopping', 'profile'];
  const found: unknown[] = [];
  let residual = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { residual += text[i++]; continue; }
    const end = matchBrace(text, i);          // -1 якщо пари немає
    if (end === -1) { residual += text[i++]; continue; }
    const slice = text.slice(i, end + 1);
    try { found.push(JSON.parse(slice)); }     // валідний JSON — прибираємо з тексту
    catch { residual += slice; }               // не JSON — лишаємо як текст
    i = end + 1;
  }
  const card = found.find((o) => {
    const t = (o as Record<string, unknown>)?.type;
    return typeof t === 'string' && CARD_TYPES.includes(t);
  });
  const wrapper = found.find((o) => o && typeof o === 'object' && 'reply' in (o as object) && 'card' in (o as object));
  return { parsed: wrapper ?? card ?? found[0] ?? null, residualText: residual.trim() };
}

// Індекс парної '}' для '{' на позиції start; -1 якщо не знайдено.
function matchBrace(text: string, start: number): number {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
```

**Тест — `services/api/tests/extract-json.test.ts`** (експортувати `extractJson` із `model.ts`):
```ts
it('два JSON у відповіді: картка з валідним type, сирого JSON у reply не лишається', () => {
  const raw = 'Ось що є: {"type":"intake_diff","ops":[]} і ще {"type":"proposal","items":[{"title":"X"}]} Обирай.';
  const { parsed, residualText } = extractJson(raw);
  expect((parsed as any).type).toBe('intake_diff');
  expect(residualText).not.toContain('{');
  expect(residualText).toContain('Обирай');
});
```

**Друга половина проблеми — не код, а промпт.** На запит «дай рецепт» модель віддала `intake_diff`,
який дублює вміст комори. Варто додати серверну валідацію наміру: якщо в тексті юзера є маркер
рецепта, а картка прийшла `intake_diff` з `ops`, чиї `label` збігаються з наявними партіями —
не показувати картку. Інакше тап «Застосувати» дублює комору.

**Пов'язане спостереження.** У поточній коморі десять пар-близнюків (Багет, Булочки, Дрова, Розпал,
Гриль, Пакет, Хустинки, два Шоколади, Папір) з `added_at` `03:02:07` і `03:02:16`. Механізм збігається,
але я цього **не відтворював** і не стверджую, що причина та сама.

---

## FIX-07 · major · Українські множини рахуються бінарно

В українській три форми, у коді скрізь дві.

| Файл:рядок (`d54e445`) | Видно | Має бути |
|---|---|---|
| `Feed.tsx:402` | `4 ПОВІДОМЛЕНЬ` | `4 ПОВІДОМЛЕННЯ` |
| `Feed.tsx:267-268` | `2 позицій у коморі` | `2 позиції у коморі` |
| `Pantry.tsx:81` | `21 ПОЗИЦІЙ` | `21 ПОЗИЦІЯ` |
| `Cook.tsx:169,173` | `Списано 2 позицій` | `Списано 2 позиції` |
| `Shopping.tsx:42` | `Перекласти 2 позицій` | `Перекласти 2 позиції` |
| `CookLog.tsx:86,135` | `2 ГОТУВАНЬ` | `2 ГОТУВАННЯ` |

**Новий файл `apps/web/src/lib/plural.ts`:**
```ts
// Українська множина: три форми. one — 1, 21, 31…; few — 2-4, 22-24…; many — решта.
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const a = Math.abs(Math.trunc(n));
  const mod10 = a % 10;
  const mod100 = a % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
```

**Тест `apps/web/src/lib/plural.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { plural } from './plural.js';
const P: [string, string, string] = ['позиція', 'позиції', 'позицій'];
describe('plural · uk', () => {
  it.each([
    [0, 'позицій'], [1, 'позиція'], [2, 'позиції'], [4, 'позиції'], [5, 'позицій'],
    [11, 'позицій'], [12, 'позицій'], [14, 'позицій'], [21, 'позиція'], [22, 'позиції'],
    [25, 'позицій'], [101, 'позиція'], [111, 'позицій'],
  ])('%i → %s', (n, want) => expect(plural(n, P)).toBe(want));
});
```

Далі замінити всі шість місць, напр. `Pantry.tsx:81`:
```diff
-<div className={styles.meta}>{batches.length} ПОЗИЦІЙ</div>
+<div className={styles.meta}>{batches.length} {plural(batches.length, ['ПОЗИЦІЯ','ПОЗИЦІЇ','ПОЗИЦІЙ'])}</div>
```

**Перевірка:** `pnpm --filter @kitchen/web test` → 13 кейсів зелені; у коморі з 21 позицією
в шапці «21 ПОЗИЦІЯ».

---

## FIX-08 · major · На Коморі таб-бар іде під фолд

**Доказ** (заміряно в консолі на `/pantry`, 20 позицій, вікно 769 px):
```js
position: "static", rectTop: 1286, rectBottom: 1361, viewportH: 769, docH: 1361
```
На `/app` того немає: `docH === viewportH`, таб-бар видно завжди. Причина — `Pantry.module.css:1`
`.screen { min-height: 100dvh; display:flex; flex-direction:column }`: список росте, колонка росте
разом із ним, `TabBar.module.css .wrap` не має `position`.

**Патч — `apps/web/src/components/TabBar/TabBar.module.css`:**
```diff
 .wrap {
+  position: sticky;
+  bottom: 0;
+  z-index: 20;
   border-top: 1px solid var(--border);
   background: var(--bg-surface);
```

**Увага:** коміт `d54e445` («Desktop-адаптація: sidebar, wide-mode grids») міг змінити розкладку —
перевірити, що `sticky` не б'ється з сайдбаром у wide-режимі. Якщо б'ється — краще зробити скрол
усередині списку: `.screen { height: 100dvh }` + `.list { flex: 1; overflow-y: auto }`.

**Перевірка:** `/pantry` з 20+ позиціями, не скролячи вниз — таб-бар видно; те саме на `/cooklog`.

---

## FIX-09 · minor · Плейсхолдер зі сторонньої вкладки

`Feed.tsx:550` — на Стрічці поле підписане «Записати в журнал…», за 40 px під карткою
«Скажи, що купив або що хочеш приготувати». Перше, що читає новий юзер у головному полі,
суперечить підказці над ним.

```diff
-            placeholder={pending.length > 0 ? 'Що з цим?' : 'Записати в журнал…'}
+            placeholder={pending.length > 0 ? 'Що з цим?' : 'Що купив або що готуємо?'}
```

---

## FIX-10 · minor · Три написання одиниць на трьох екранах

| Екран | Видно |
|---|---|
| Стрічка (картка) | `250G`, `59.99PCS` |
| Комора (список) | `250g`, `32.99pcs` |
| Шит партії (селект) | `г`, `шт` |

Правильний варіант уже є в селекті шита. Винести його в `apps/web/src/lib/units.ts`:
```ts
const UNIT_UK: Record<string, string> = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
export const formatUnit = (u?: string | null): string => (u ? UNIT_UK[u.toLowerCase()] ?? u : '');
export const formatQty = (v?: number | null, u?: string | null): string =>
  v == null ? '' : `${v} ${formatUnit(u)}`.trim();
```
і використати в `cards.tsx` (де зараз `toUpperCase()`), у `Pantry.tsx` (список) і в `Cook.tsx`.

---

## POLISH — без патчів, на рішення

- **Вікно undo — 6 секунд** (`Feed.tsx:193`). Я двічі не встиг і спершу вирішив, що undo зламаний.
  Для «поклав не те» на телефоні мало. 15-20 с або тост, що не гасне сам.
- **Undo не переживає F5.** Застосував → перезавантажив → кнопка «↩ Скасувати» зникла з картки.
  `undo_token` живе в пам'яті вкладки. Той самий клас, що FIX-03.
- **Ціни з чека лежать як кількість:** `Пакет 18 Сільпо — 9.99pcs`, `Хустинки — 36.49pcs`,
  `Дрова — 259pcs`. Це гривні. Дані від 03:02, імпорт не відтворював — фіксую як спостереження.
- **Manifest тільки з SVG-іконкою** (`sizes:"any"`), PNG 192/512 немає. Валідність не ламає,
  але «Install» пропонують не всі платформи.
- **Пропозиції не тримаються комори.** На комору з дров, паперових рушників і двох шоколадок
  модель запропонувала пасту карбонара, ростбіф і грибний крем-суп. Поле `needs` у картці є,
  в UI його не видно. Після FIX-01 (сильніша модель) перевірити ще раз — можливо, зникне саме.

---

## Критерій готовності

```bash
pnpm -r test          # + нові: api.test.ts (3), plural.test.ts (13), extract-json.test.ts (1)
pnpm -r typecheck
pnpm --filter @kitchen/web build
```
Далі руками, після перезапуску API:

| # | Дія | Пройшло |
|---|---|---|
| 1 | `curl POST /v1/recipes/generate -d '{"title":"Борщ"}'` | 200 + `recipe.st` непорожній |
| 2 | Комора → партія → «Прибрати з комори» → підтвердити | зникла, лічильник −1 |
| 3 | Стрічка → intake-картка → «Ні» | кнопки зникли, комора без змін |
| 4 | Партія → змінити кількість → «◔ Відкрито» | збереглись і кількість, і стан |
| 5 | Пропозиція з 3 страв → тап на третю | відкрилась третя |
| 6 | Комора з 21 позицією | у шапці «21 ПОЗИЦІЯ» |
| 7 | `/pantry` без скролу | таб-бар видно |
| 8 | «дай рецепт із шоколаду» ×3 | жодного разу сирого JSON у стрічці |

Після цього — **повний прогін областей 5-8**, які цього разу не перевірялись жодного разу.

---

## Умови прогону — щоб правильно читати покриття

- **Тестові акаунти `qa-*@example.com` створити не вдалося.** Magic-link іде тільки в stdout
  API-процесу; сесія, з якої я працював, бачить лише папку `KITCHEN_OS` — ні процесів Mac,
  ні їхнього stdout, ні `/tmp`. У БД токен лежить SHA-256 хешем.
- **Тому все клацалось під живим `chernosliv.cs@gmail.com` проти prod-Neon**, з явного дозволу власника.
- **Область 9 (дім, ролі, інвайти) пропущена повністю** — передача ролі owner на єдиному живому
  акаунті без людини за столом того не варта.
- **«Вийти» не тестувалось** — сесію не було б чим відновити.
- Нативні `confirm()` перехоплені заглушкою (інакше вішають автоматизацію); самі діалоги
  спрацьовують, текст правильний.
- Мій тестовий батч «Моцарела» додано і прибрано, комора повернулась до 20 позицій. Лишились
  два повідомлення в чаті за 29.08 і одна скасована картка з кефіром.

## Що пройшло

Auth (F5 тримає сесію), 404-екран, Стрічка (порожній стан, відправка, intake-картка, apply,
лічильник комори, toast із робочим undo, «+ Новий», «⌚ Історія» + Escape), Комора (групування
по зонах у правильному порядку, пошук при ≥8, шит партії, Escape без збереження, зміна кількості +
«Зберегти», перемикач стану з правильною крапкою, «+ Додати»), Список (порожній стан),
Журнал (порожній стан), manifest валідний, `/health` зелений.

## Не перевірено і чому

| Область | Причина |
|---|---|
| 5 Cook Mode, таймер, списання | FIX-01 — немає як згенерувати рецепт |
| 6 Ретро-оцінка, фото | потребує завершеного cook-run |
| 7 Share, PNG, deep-link, OG | потребує рецепта |
| 8 Журнал із даними | потребує cook-run; зараз 0 готувань |
| 9 Дім, ролі, інвайти | свідомо пропущено |
| 1 «Вийти» | сесію не було б чим відновити |
| 4 Чекбокс, ×, «В КОМОРУ» | список порожній; × усе одно впаде на FIX-02 |
| 10 Service worker | у dev не реєструється (`getRegistrations()` → 0), потрібен прод-білд |
| 10 Тема dark/light | не можу перемкнути тему macOS із цієї сесії |
| 10 Tab-trap у модалках | перевірено лише Escape і клік по backdrop |
