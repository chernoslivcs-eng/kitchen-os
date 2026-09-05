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
pnpm --filter @kitchen/web build
