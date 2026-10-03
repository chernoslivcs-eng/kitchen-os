#!/usr/bin/env bash
# Збірка на Vercel. Міграції й сіди — ТІЛЬКИ для production-деплою:
# PG_URL у проєкті один (прод-база), і preview-деплой чи майбутня git-інтеграція
# інакше поженуть migrate на прод із гілки, яка на прод ще не йде
# (AUDIT-ROUND-4.md, крок 4 (b)). Локально VERCEL_ENV не задано → тільки збірка.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "vercel-build: production → migrate + seeds"
  pnpm --filter @kitchen/db migrate
  pnpm --filter @kitchen/db exec tsx scripts/seed-catalog.ts
  pnpm --filter @kitchen/db exec tsx scripts/seed-occasions.ts
else
  echo "vercel-build: VERCEL_ENV=${VERCEL_ENV:-<unset>} → без migrate і сідів"
fi

pnpm run build:vercel-fn

# --- Крок О1б: сорсмепи лямбди в Sentry ------------------------------------
#
# Бандл лямбди — один десятимегабайтний рядок від esbuild. Без сорсмепів кожен
# стек у Sentry виглядає як `server.mjs:1:2841097`, тобто не виглядає ніяк.
#
# `sourcemaps inject` вшиває у бандл і в мапу спільний debug id — саме за ним
# SDK і Sentry знаходять одне одного. Реліз тут ні до чого: він потрібен лише
# для групування, а склеювання стека з мапою тримається на debug id. Тому
# умова — ТІЛЬКИ токен.
#
# Перший захід на це виглядав так: `[ -n "$SENTRY_AUTH_TOKEN" ] && [ -n
# "$VERCEL_GIT_COMMIT_SHA" ]`. Деплой ідемо з CLI, з відокремленого worktree —
# git-метаданих Vercel там не має звідки взяти, і весь блок мовчки пройшов
# повз при цілком наявному токені. Звідси ж і правило нижче: кожна гілка
# каже, ЩО саме її обрало.
RELEASE="${VERCEL_GIT_COMMIT_SHA:-${VERCEL_DEPLOYMENT_ID:-}}"

if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  export SENTRY_URL="${SENTRY_URL:-https://de.sentry.io}"   # організація в EU
  export SENTRY_ORG="${SENTRY_ORG:-kitchen-os-le}"
  echo "vercel-build: сорсмепи лямбди → Sentry (реліз ${RELEASE:-<без релізу>})"
  # Помилка вивантаження не має валити деплой: продукт від цього працює так
  # само, просто стеки будуть неточні.
  (
    set +e
    pnpm exec sentry-cli sourcemaps inject api-dist
    if [ -n "$RELEASE" ]; then
      pnpm exec sentry-cli sourcemaps upload \
        --project "${SENTRY_PROJECT_API:-kitchen-api}" --release "$RELEASE" api-dist
    else
      pnpm exec sentry-cli sourcemaps upload \
        --project "${SENTRY_PROJECT_API:-kitchen-api}" api-dist
    fi
  ) || echo "vercel-build: сорсмепи лямбди не вивантажились — деплой продовжуємо"
else
  echo "vercel-build: SENTRY_AUTH_TOKEN не задано → сорсмепи лямбди не вивантажуємо"
fi
# Мапа в лямбді більше не потрібна: debug id уже в бандлі, а зайві мегабайти у
# функції — це зайвий cold start.
rm -f api-dist/*.map

# Фронт вивантажує свої сорсмепи сам — плагіном усередині vite (vite.config.ts),
# бо тільки збирач знає, які чанки він щойно зробив. Іде останнім, бо йому
# потрібен той самий RELEASE, що й лямбді.
export SENTRY_RELEASE="$RELEASE"
pnpm --filter @kitchen/web build

# Пояс і шлейки: сорсмепи фронта видаляє сам плагін (filesToDeleteAfterUpload),
# але якщо він упаде до цього кроку, мапи лишаться в dist і поїдуть у світ —
# а вони і є вихідний код. Тому ще раз, руками.
find apps/web/dist -name '*.map' -delete 2>/dev/null || true

# --- Пошукова база, крок 3 (знайдено живцем на проді після кроку 2): Vercel
# віддає статичний файл, що збігається зі шляхом запиту, ДО того, як дивиться
# в rewrites. На «/» у корені dist лежав index.html — Vercel віддавав його
# напряму, і правило bot-UA (нижче, веде на /prerendered/index.html) не
# встигало спрацювати: curl -A Googlebot на / отримував SPA-shell, хоча на
# /terms (там index.html нема — файл лежав лише в корені) той самий бот-UA
# rewrite працював. Файла з назвою index.html у dist більше нема: людям і
# catch-all rewrite (vercel.json, нижче) веде на spa.html.
mv apps/web/dist/index.html apps/web/dist/spa.html

# --- Пошукова база, крок 2: статичний HTML пʼяти публічних адрес для ботів
# прев'ю (Googlebot і решта — vercel.json rewrite за User-Agent) -----------
#
# Крок 1 (Playwright + prod-serve.ts) на Vercel падав: build-образ не має
# libnspr4.so для headless-chromium (vercel inspect --logs, 03.10). Крок 2 —
# без браузера взагалі: react-dom/server.renderToStaticMarkup тієї ж верстки
# Landing/LegalDocPage (scripts/prerender-bot-pages.tsx). Як і сорсмепи
# вище: помилка тут не має валити весь деплой — продукт від цього й так
# працює, просто боти бачитимуть SPA-shell, як і зараз (запобіжник нижче).
echo "vercel-build: пошукова база — пререндер пʼяти публічних адрес для ботів"
pnpm exec tsx scripts/prerender-bot-pages.tsx || echo "vercel-build: пререндер для ботів не вдався — деплой продовжуємо, боти бачать SPA-shell"

# Дірка в запобіжнику вище (знайдено код-рев'ю 03.10): коментар обіцяє
# «боти бачать SPA-shell», але vercel.json веде bot-UA на /prerendered/*.html
# БЕЗУМОВНО — немає там файла, Googlebot отримає 404, не SPA-shell. Та сама
# діра і при частковому падінні: скрипт пише пʼять файлів по черзі (for у
# prerender-bot-pages.tsx), і впасти може рівно на одній адресі, лишивши
# решту готовими. Перевіряємо кожен файл окремо; відсутній чи порожній —
# підставляємо spa.html (саме той SPA-shell, що й обіцяно).
mkdir -p apps/web/dist/prerendered
for route in index terms privacy refund contacts; do
  target="apps/web/dist/prerendered/$route.html"
  if [ ! -s "$target" ]; then
    cp apps/web/dist/spa.html "$target"
    echo "vercel-build: dist/prerendered/$route.html відсутній — підставлено SPA-shell (spa.html)"
  fi
done
