# Реєстр відхилень — потік «шерінг v3» (API/бот)

Спец: `docs/superpowers/specs/2026-09-22-share-v3-design.md`. Веб-частина — в
іншому потоці (ЛЕНДІНГ); тут — лише API й бот. Спільний `DEVIATIONS-V3.md` не чіпаємо.

### Р201 · Шерінг v3, PR 1 — API/бот: фільтр журналу, telegram_linked, /v1/share/telegram, кнопки бота — правка окремої гілки від origin/main (6ba1074), 22.09

Постановка: ГОЛОВНИЙ ЧАТ, обсяг 1–5 з повідомлення 22.09. Зроблено 1:1. Що
вирішив сам:
- `GET /v1/cook-runs?recipe_id=` — фільтр у памʼяті над тими самими 30
  записами (`listCookRuns(user_id, 30)`): /share бере останній з фото, 30
  вистачає; окремого запиту в репо не додавав.
- `GET /v1/me.telegram_linked` — `getTelegramByUser` для всіх і `!revoked_at`
  (після /stop — false).
- `POST /v1/share/telegram` — окремий `routes/share.ts`; доставка — шов
  `opts.share.sendPhoto` (у проді `makeSendPhoto(TELEGRAM_BOT_TOKEN)` у
  `telegram-bot.ts`: лінивий grammY `Bot` без polling, `bot.api.sendPhoto(chat_id,
  new InputFile(png, 'kitchen-os.png'), { caption: <назва> })`, той самий
  `telegramFetch`). Без токена — 503 `telegram_not_configured` (веб покаже
  «Зв'яжи Telegram…»); без живої привʼязки чи chat_id — 409
  `telegram_not_linked`; не PNG — 415; > 10 МБ — 413; чужий рецепт — 404;
  збій Telegram — 502 `telegram_send_failed`. Подія `share {frame, via:
  'telegram', photo: true, recipe_id}` — пише сервер напряму (як digest), і
  `share` додано в `KNOWN_EVENTS` (31), бо веб слатиме ту саму подію через
  /v1/events (spec §3) — інакше трек відбив би її як невідому.
- Бот: у Telegram картка `cook_photo` досі НЕ мала кнопок (фото страви →
  лише репліка), тож «Зафіксував у журналі» не було звідки взятись — додано
  кнопки «Прикріпити до журналу / Не треба» під фото страви (той самий
  `apply:<card_id>` / `dismiss:`), а після «Прикріпити» — статус «Зафіксував у
  журналі» + url-кнопка «Поділитись у сторіз» → `webLink('/share/<recipe>?
  run=<run>')` (recipe_id — з `getCookRun(run_id)`). `handleTelegramCallback`
  тепер може повертати `keyboard`; `telegram-bot.ts` ставить її в
  `editMessageText`. Під `recipe_link` у розмові і під повним рецептом із
  /recipes — «Поділитись у сторіз» (url `/share/<id>`) і «Лінк на рецепт»
  (callback `share-link:<id>` → текст `${appUrl}/r/<id>`, подія `share {via:
  'copy_link'}`). Стиль — ті самі `QuickKeyboardBtn` з telegram-nomodel.ts.

Тести `share-v3-api.test.ts`: фільтр; telegram_linked false/true (з поштою);
409 → привʼязка → 200 і `sendPhoto(chat_id, png, «Різото з білими»)` + подія;
415/404/503; бот — кнопки під фото страви, «Прикріпити» → «Зафіксував у
журналі» + url на `/share/<recipe>?run=<run>` через 24-годинний токен;
під рецептом — дві кнопки, `share-link` → `host/r/<id>`, /recipes → ті самі.
