# OpenRouter: маршрут провайдера, таймаути — замір 16.09 (локально)

Прод: MODEL_REASONING=minimal з 08:29, але 45 435 мс при 122 вихідних токенах,
34 441 при 100, attachment 31 219 при 26 — поруч ті самі виклики за 3–5 с.
OpenRouter endpoints для google/gemini-3.8-flash: «Google» (Vertex) uptime
29,6 % за 30 хв, «Google AI Studio» 99,9 %.

## Чи приймає /v1/messages `provider`

Живий виклик (Anthropic SDK, baseURL openrouter.ai/api):

| параметр | результат |
|---|---|
| нічого | 5,3 с, у тілі відповіді `provider: "Google"` |
| `provider: { order: ['Google AI Studio'], allow_fallbacks: true }` | 1,7 с, `provider: "Google AI Studio"` |
| `provider: { ignore: ['Google'] }` | 1,4 с, `provider: "Google AI Studio"` |
| `order: ['Nope'], allow_fallbacks: false` | 404 «No endpoints found» — тобто параметр читається |

У відповіді: поле `provider` у тілі, `id` = `x-generation-id` у заголовку
(той самий id, що в /api/v1/generation?id=). Обидва йдуть у meta і
token_usage (міграція 0039).

## 10 реплік чату через прод-`callChat` (MODEL_REASONING=minimal)

Прогін 1 (10:0x, поки Vertex деградований; SDK-таймаут 25 с, ретраї ще не
працювали — див. нижче):

| прогін | latency | провайдери |
|---|---|---|
| без OPENROUTER_PROVIDER_ORDER | медіана 13,6 с · p90 25,0 · макс 25,0 | Google ×5 (5,4–13,6 с), **5 таймаутів по 25 с** на Google |
| `Google AI Studio` | медіана 4,1 с · p90 7,1 · макс 8,6 | Google AI Studio ×10 |

Прогін 2 (через ~10 хв; OpenRouter сам уже перекинув 9/10 на AI Studio):

| прогін | latency | провайдери |
|---|---|---|
| без | медіана 5,2 с · p90 8,1 · макс 8,2 | Google AI Studio ×9, Google ×1 |
| `Google AI Studio` | медіана 3,8 с · p90 7,1 · макс 7,9 | Google AI Studio ×10 |

Висновок: гіпотеза підтверджена — повільні виклики йдуть на «Google»
(Vertex); з `order: ['Google AI Studio']` усі 10/10 — 2–9 с. «Новий запит
швидше, ніж чекати повільний»: у прогоні 1 виклик на Google не завершився за
25 с узагалі, а свіжий запит на AI Studio — 4 с медіана; тобто таймаут 25 с +
ретрай дає відповідь на ~30 с там, де без таймауту чекали б 45 с+ (як на
проді). Дешевше — не потрапляти туди взагалі: env `OPENROUTER_PROVIDER_ORDER=Google AI Studio`.

## Знахідка: ретраї не працювали

Старий `isRetryable` перевіряв `err.name === 'APIConnectionError'`, а SDK
не ставить `name` — тож таймаути й мережеві помилки НІКОЛИ не ретраїлись
нашим withRetry (прогін 1: «Request timed out» рівно через 25 с, без другої
спроби). Виправлено перевіркою за класом (`instanceof
Anthropic.APIConnectionError`, покриває і APIConnectionTimeoutError); тест
на справжньому класі SDK. SDK-ретраї вимкнено (`maxRetries: 0`) — рівно 3
спроби, усі наші, замість 6 з беkoff до 8 с.

Таймаути (`CALL_TIMEOUT_MS`): chat 25 с, recipe_gen 25 с, attachment_parse
60 с, alt_filter 25 с.

Вартість: 40 викликів чату + 4 проби ≈ $0.10–0.12 (бюджет $0.2).
