# Розвідка живого MCP «Сільпо» — 2026-09-01

Нульовий крок Етапу 4 (роадмап): перевірити живу форму даних до написання інтеграції.
Сервер: `silpo-mcp-service v1.109.2`, `https://mcp.silpo.ua/mcp`, Streamable HTTP.
Все нижче знято з реальних викликів під акаунтом Пилипа (read-only tools, у кошик нічого не писалось).

## Авторизація — працює end-to-end

- Discovery за стандартом: `/.well-known/oauth-protected-resource/mcp` → authorization server `https://mcp.silpo.ua`.
- **Динамічна реєстрація клієнта** (RFC 7591): `POST /register` без жодних ключів наперед → `client_id`. Публічний клієнт (`token_endpoint_auth_method: none`).
- PKCE S256, `authorization_code` + `refresh_token`. Loopback-редирект (`http://localhost:…/callback`) приймається.
- Токен: bearer, **30 днів** (`expires_in: 2592000`) + refresh-токен. Scope порожній — гранулярності немає, токен дає все.
- Без токена — чистий 401 навіть на `initialize`.

Для продакшну: реєстрація клієнта — раз на застосунок (зберегти `client_id`); на юзера — тільки authorize-редирект. Токени в БД (шифровані), refresh-логіка обовʼязкова.

## 39 tools: що є понад спеку

Чотири сценарії спеки покриті. Понад те: купони, лояльність (бонуси), персональні промо, сертифікати, обрані товари, підписка «Плюхс», категорії/промо-каталог, доставка Новою Поштою, адреси, профіль. Повні схеми — знято `tools/list`, за потреби перезняти (розділ «Як відтворити»).

## Розбіжності з моками і спекою (головна цінність розвідки)

1. **Імена з префіксом `silpo_`** — спека і мок писали `find_products_batch`, реально `silpo_find_products_batch`.

2. **Чеки вимагають контексту кошика.** `silpo_get_my_offline_orders` має обовʼязкові `branchId`, `deliveryType`, `timeslotStart`, `timeslotEnd`. Мок вважав чеки самодостатніми. Реальний ланцюжок «чеки → комора»:
   `get_my_shopping_cart` → `get_shopping_cart_by_id` → (branchId зі `cart.shipments[0].branchId`, deliveryType, `cart.timeslot.{start,end}`) → `get_my_offline_orders`.

3. **Протухлий таймслот → мовчазні нулі.** З минулим слотом `find_products_batch` віддає `success: true, totalFound: 0` по всіх запитах — без помилки. Зі свіжим слотом (`silpo_get_time_slots`) той самий запит знаходить 58 позицій «молока». **Інтеграція мусить завжди брати свіжий слот перед пошуком** і трактувати тотальні нулі як підозру на протухлий контекст, а не як «немає товару».

4. **Форма відповіді**: кожен tool віддає `structuredContent` (`{success, summary, ...}`) поруч із текстовим дублем — парсити текст не треба.

5. **Ліміт чеків**: `limit` max 10, пагінація `offset`, період `dateStart/dateEnd` (ISO).

## Жива форма даних

**Чек** (`orders[]`): `filId` (числовий!), `filialName`, `cityName`, `createdAt`, `sumReg`, `sumDiscount`, `accruedBalaBonusesSum`, `receiptUrl`, `chequeMagicName`/`chequePrediction` (маркетингові рядки), `rewards`, `products[]`.

**Рядок чека**: `lagerId` (числовий id товару), `name`, `unit` («шт», «кг»…), `quantity`, `price`, `image`, `catalogProduct` (буває `null` — мапінг на їхній e-commerce каталог не гарантований).

Висновки для «чеки → комора»:
- `confidence: 1, evidence: receipt_line` підтверджується — назви структуровані, з картинками.
- **У чеках є нехарчове** (дрова, папір) — потрібен фільтр через наш каталог; що не змапилось і не схоже на їжу — пропускати або питати.
- Ваги/обсягу в грамах немає: `unit` + `quantity` (для вагових — кг). Розгортання «квт 0,632» не потрібне, але конверсія unit→наші одиниці потрібна.
- `lagerId` ≠ id з e-commerce пошуку (`id`/`externalProductId`) — два простори ідентифікаторів.

**Товар із пошуку** (`find_products_batch`, до 30 запитів масивом `products[]`): `id`, `name`, `slug`, `price`, `oldPrice`, `stock`, `available`, `weighted`, `step`, `displayRatio`, `specialPrices`, `companyId`, `branchId`, `externalProductId`. Трійка `productId+companyId+branchId` — рівно те, що вимагає `add_or_update_cart_products`.

Якість пошуку: повнотекстовий і буквальний. «фарш яловичий» → 1 результат і то шинка; «рис арборіо» → 0 (у філії може просто не бути). Наш резолвер поверх їхнього пошуку лишається потрібним: формувати запити простішими іменами і скорити результати в себе.

**Кошик** (`get_shopping_cart_by_id`): `{success, cart, loyalty}`; `cart.{id, deliveryType, timeslot, address, shipments[{companyId, branchId, products}], calculation{...}, paymentType, packageType}`; `loyalty.{bonusAvailable, bonusTotal}`.

**Профіль**: `get_my_food_restrictions` → `{restrictions: []}` (у Пилипа порожньо — сценарій «обмеження → профіль» тестувати після заповнення в застосунку Сільпо); `get_my_family` → members/children/pets (заповнено тільки себе).

## Наслідки для дизайну RetailProvider

- Інтерфейс лишається чотириметодним (`findBatch`, `addToCart`, `receipts`, `restrictions`), але під капотом Сільпо-реалізації живе **контекст філії** (branchId+deliveryType+свіжий слот): отримувати ліниво, кешувати коротко, оновлювати при нулях.
- Помилки tools приходять як `isError: true` з текстом zod-валідації — мапити на наші коди, не показувати юзеру сирими.
- Rate limits із боку Сільпо не документовані — закладати власний бекоф.

## Як відтворити

Скрипти розвідки — у scratchpad сесії (`silpo-oauth.mjs`, `silpo-recon*.mjs`): OAuth-флоу з локальним callback (логіниться людина), потім read-only виклики. Токен лежить тільки локально, в репо його немає.
