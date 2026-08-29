#!/usr/bin/env bash
# Smoke-test повного контуру: старт API з InMemoryRepo → magic-link →
# signin → chat («купив моцарелу») → apply → перевірка комори → logout.
# Не використовує Postgres, не потребує моделі (StubMailer).
#
# Використання:
#   pnpm smoke                  # запустити (вбʼє існуючий API на 3000)
#
# Виходить exit 0 при успіху, 1 при першому провалі — годиться для CI
# або перед `vercel deploy` як швидка перевірка «нічого не зламано».

set -euo pipefail

BASE="${SMOKE_BASE:-http://localhost:3000}"
STARTED_API=0

cleanup() {
  if [[ "$STARTED_API" == "1" ]]; then
    lsof -ti :3000 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
  fi
  rm -f /tmp/kos-smoke-cookies.txt /tmp/kos-smoke-api.log
}
trap cleanup EXIT

step() { printf "\033[36m→\033[0m %s\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✕\033[0m %s\n" "$1"; exit 1; }

# 1. Запустити API без PG_URL (InMemoryRepo). Не чіпаємо існуючий.
if ! curl -sf -o /dev/null "$BASE/health"; then
  step "Starting API on :3000 (InMemory backend, stub model)"
  # Все важливе гасимо: PG_URL, SMTP_HOST, обидва model keys. Хочемо репродукований
  # cheap smoke, а не мовчазний сплеск токенів.
  (cd services/api && PG_URL="" SMTP_HOST="" ANTHROPIC_API_KEY="" OPENROUTER_API_KEY="" \
    pnpm start > /tmp/kos-smoke-api.log 2>&1) &
  STARTED_API=1
  for _ in $(seq 1 20); do
    if curl -sf -o /dev/null "$BASE/health"; then break; fi
    sleep 0.5
  done
  curl -sf -o /dev/null "$BASE/health" || { cat /tmp/kos-smoke-api.log; fail "API did not come up"; }
fi

# 2. Health check із розширеною формою
step "GET /health"
health=$(curl -sf "$BASE/health")
echo "$health" | grep -q '"ok":true' || fail "health not ok: $health"
echo "$health" | grep -q '"db":"ok"' || fail "db not ok: $health"
ok "$health"

# 3. Magic-link request
step "POST /v1/auth/request { email }"
email="smoke-$(date +%s)@example.com"
req=$(curl -sf -X POST "$BASE/v1/auth/request" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$email\"}")
echo "$req" | grep -q '"ok":true' || fail "auth/request failed: $req"
ok "202 accepted"

# 4. Дістати magic-link з логу API
step "Extract magic-link from API log"
sleep 0.3  # даємо ConsoleMailer записати
link=$(grep -oE "http://[^ ]+/v1/auth/verify\?token=[A-Za-z0-9_-]+" /tmp/kos-smoke-api.log | tail -1 || true)
[[ -n "$link" ]] || fail "no magic-link in API log (must be ConsoleMailer)"
ok "$link"

# 5. Клік по лінку — отримати cookie
step "GET verify → cookie 'kos'"
verify=$(curl -sf -D /tmp/kos-smoke-cookies.txt -H "Accept: application/json" "$link")
echo "$verify" | grep -q '"user_id"' || fail "verify body missing user_id: $verify"
cookie=$(grep -i "^set-cookie: kos=" /tmp/kos-smoke-cookies.txt | head -1 | sed 's/^Set-Cookie: //I' | cut -d';' -f1)
[[ -n "$cookie" ]] || fail "no cookie 'kos' in response"
ok "cookie set"

# 6. /v1/me
step "GET /v1/me (authenticated)"
me=$(curl -sf "$BASE/v1/me" -H "Cookie: $cookie")
echo "$me" | grep -q "\"email\":\"$email\"" || fail "/me email mismatch: $me"
ok "user $email is signed in"

# 7. Chat: купив моцарелу
step "POST /v1/chat text='купив моцарелу'"
chat=$(curl -sf -X POST "$BASE/v1/chat" \
  -H "Content-Type: application/json" \
  -H "Cookie: $cookie" \
  -d '{"text":"купив моцарелу"}')
card_id=$(echo "$chat" | grep -oE '"card_id":"[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
[[ -n "$card_id" ]] || fail "no card_id in chat response: $chat"
ok "stub returned intake_diff card ($card_id)"

# 8. Apply
step "POST /v1/cards/:id/apply"
applied=$(curl -sf -X POST "$BASE/v1/cards/$card_id/apply" \
  -H "Content-Type: application/json" \
  -H "Cookie: $cookie" \
  -d '{}')
echo "$applied" | grep -q '"applied":1' || fail "apply did not apply 1 op: $applied"
undo=$(echo "$applied" | grep -oE '"undo_token":"[A-Za-z0-9_-]+"' | cut -d'"' -f4)
[[ -n "$undo" ]] || fail "no undo_token in apply response"
ok "1 op applied, undo_token got"

# 9. Pantry має 1 партію
step "GET /v1/pantry"
pantry=$(curl -sf "$BASE/v1/pantry" -H "Cookie: $cookie")
echo "$pantry" | grep -q '"count":1' || fail "pantry not 1: $pantry"
echo "$pantry" | grep -q "моцарел" || fail "pantry missing моцарел: $pantry"
ok "моцарела is in pantry"

# 10. Undo
step "POST /v1/cards/:id/undo"
undone=$(curl -sf -X POST "$BASE/v1/cards/$card_id/undo" \
  -H "Content-Type: application/json" \
  -H "Cookie: $cookie" \
  -d "{\"undo_token\":\"$undo\"}")
echo "$undone" | grep -q '"undone":true' || fail "undo did not undo: $undone"
ok "apply undone"

# 11. Pantry знову 0
step "GET /v1/pantry після undo"
pantry2=$(curl -sf "$BASE/v1/pantry" -H "Cookie: $cookie")
echo "$pantry2" | grep -q '"count":0' || fail "pantry not 0 after undo: $pantry2"
ok "pantry empty again"

# 12. Logout
step "POST /v1/auth/logout"
curl -sf -X POST "$BASE/v1/auth/logout" -H "Content-Type: application/json" -H "Cookie: $cookie" -d '{}' > /dev/null
me_after=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/me" -H "Cookie: $cookie")
[[ "$me_after" == "401" ]] || fail "/me should be 401 after logout, got $me_after"
ok "session invalidated"

printf "\n\033[32m✓ smoke passed\033[0m — auth + chat + apply + pantry + undo + logout\n"
