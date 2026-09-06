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
