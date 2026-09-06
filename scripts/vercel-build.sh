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
# Фронт вивантажує свої сорсмепи сам — плагіном усередині vite (vite.config.ts),
# бо тільки збирач знає, які чанки він щойно зробив.
pnpm --filter @kitchen/web build

# --- Крок О1б: сорсмепи лямбди в Sentry ------------------------------------
#
# Бандл лямбди — один десятимегабайтний рядок від esbuild. Без сорсмепів кожен
# стек у Sentry виглядає як `server.mjs:1:2841097`, тобто не виглядає ніяк.
#
# `sourcemaps inject` вшиває у бандл і в мапу спільний debug id — саме за ним
# SDK і Sentry знаходять одне одного. Без inject завантажена мапа не
# приклеїлась би до події.
#
# Умова — токен: його дає лише Vercel (SENTRY_AUTH_TOKEN у змінних проєкту).
# Локальна збірка й preview проходять цей блок повз, і це навмисно.
if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
  export SENTRY_URL="${SENTRY_URL:-https://de.sentry.io}"   # організація в EU
  export SENTRY_ORG="${SENTRY_ORG:-kitchen-os-le}"
  # Помилка вивантаження не має валити деплой: продукт від цього працює так
  # само, просто стеки будуть неточні. Тому весь блок під `|| true`.
  (
    set +e
    pnpm exec sentry-cli sourcemaps inject api-dist
    pnpm exec sentry-cli sourcemaps upload \
      --project "${SENTRY_PROJECT_API:-kitchen-api}" \
      --release "$VERCEL_GIT_COMMIT_SHA" \
      api-dist
  ) || echo "vercel-build: сорсмепи лямбди не вивантажились — деплой продовжуємо"
  # Мапа в лямбді більше не потрібна: debug id уже в бандлі, а зайві 15 МБ у
  # функції — це зайвий cold start.
  rm -f api-dist/*.map
else
  echo "vercel-build: SENTRY_AUTH_TOKEN не задано → сорсмепи не вивантажуємо"
  rm -f api-dist/*.map
fi
