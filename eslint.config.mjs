// Лінт як гейт (аудит 0913, Етап 2). Правила — або error, або off: без warn,
// без --max-warnings, без disable-коментарів «про запас». Старі порушення,
// які не виправляються тривіально, — в eslint-baseline.md з номером; у коді
// стоїть `// eslint-disable-next-line <rule> -- baseline #N`.
//
// Type-aware правил немає, окрім no-floating-promises для apps/web і
// services/api (потрібен project → час прогону дивись у PR #91).
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const TS = ['apps/web/src/**/*.{ts,tsx}', 'services/api/src/**/*.ts', 'services/api/tests/**/*.ts', 'packages/*/**/*.ts'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/node_modules/**', 'out/**', '.worktrees/**', 'api-dist/**',
      'docs/**', 'ai/**', 'ai 2/**', 'design/**', 'scripts/**', 'e2e/**', 'api/**',
      'packages/catalog/seed.ts',      // 45 841 рядок даних — ×3 до часу прогону
      'packages/prompts/**',            // не чіпаємо (рішення власника)
      'kitchen-prototype.jsx', '**/*.dc.html',
    ],
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: TS })),
  {
    files: TS,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // 13.09.2026: Feed() — одна функція на ~2 000 рядків із 24 ефектами й
    // 32 старими disable-коментарями; залежності ефектів там правляться
    // лише разом із розбором Feed на відповідальності (DEBUG-AUDIT-0913 §B.1,
    // план 2026-09-13-audit-fixes.md) — окремий етап, не лінт.
    files: ['apps/web/src/pages/Feed/Feed.tsx'],
    rules: { 'react-hooks/exhaustive-deps': 'off' },
  },
  {
    // baseline #6 (13.09.2026): packages/eval — 40 `any` в invariants.ts/runner.ts
    // (розбір відповідей моделі без типів). Один override замість сорока
    // коментарів; знімається разом із типізацією інваріантів.
    files: ['packages/eval/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { project: ['./apps/web/tsconfig.json'], tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    files: ['services/api/src/**/*.ts', 'services/api/tests/**/*.ts'],
    languageOptions: { parserOptions: { project: ['./services/api/tsconfig.json'], tsconfigRootDir: import.meta.dirname } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
);
