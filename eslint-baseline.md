# eslint-baseline — старі порушення, які не виправляються тривіально

Знято 13.09.2026 на main a1571c1 (аудит 0913, Етап 2). Правило: у коді стоїть
`// eslint-disable-next-line <rule> -- baseline #N`; рядок з таблиці знімається разом
із коментарем, коли порушення виправлено. Нові порушення в baseline не додаються —
CI червоний.

| # | Правило | file:line | Власник (blame) | До коли | Що треба |
|---|---|---|---|---|---|
| 1 | `@typescript-eslint/no-explicit-any` | `apps/web/src/lib/lazyPage.tsx:71` | Пилип, 2026-09-13 | — | `ComponentType<any>` — сигнатура React.lazy; звузити не можна без втрати типів пропсів сторінок |
| 2 | `@typescript-eslint/no-explicit-any` | `services/api/src/routes/attachments.ts:30` | Пилип, 2026-08-28 | — | `(req as any).file` — типи @fastify/multipart; замінити на `req.file()` з типізованим `MultipartFile` |
| 3 | `@typescript-eslint/no-explicit-any` | `services/api/src/routes/attachments.ts:34` | Пилип, 2026-08-28 | — | те саме |
| 4 | `@typescript-eslint/no-explicit-any` | `services/api/src/routes/attachments.ts:97` | Пилип, 2026-08-28 | — | `req.body ?? ({} as any)` — задати тип Body у generic маршруту |
| 5 | `@typescript-eslint/no-explicit-any` | `services/api/src/routes/cards.ts:131` | Пилип, 2026-08-28 | — | те саме, що #4 |
| 6 | `@typescript-eslint/no-explicit-any` | `packages/eval/invariants.ts` (39), `packages/eval/runner.ts:139` | Пилип, 2026-08-28 | — | **override у eslint.config.mjs** (`packages/eval/**` → off), не 40 коментарів; знімається разом із типізацією відповідей моделі в інваріантах |

## Що було виправлено тривіально (не в baseline)

- `no-floating-promises` 25 → 0: 21× `void navigate(...)` (react-router 7 повертає `void | Promise<void>`), 3× `void (async () => {…})()` з власним try/catch усередині, 1× `void initSentry(undefined)` у тесті.
- `prefer-const` 4 → 0 (`packages/eval/model-client.ts`).
- `no-unused-expressions` 1 → 0 (`theme.ts` — тернар як оператор → if/else).
- `no-unused-vars` 1 → 0 (`admin-occasions.test.ts` — `source: _source`).
- `rules-of-hooks` 0 (після #89).
- `exhaustive-deps`: error усюди, крім `pages/Feed/Feed.tsx` (file-override, 13.09 — розбір Feed окремим етапом); 9 старих `eslint-disable` у Feed прибрано як зайві під override, 2 зайві поза Feed (Cook.tsx, Pantry.tsx) прибрано; 20 потрібних поза Feed лишено — кожен із поясненням у тому самому рядку (`-- причина`).
