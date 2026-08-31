// П.4 pre-deploy: e2e-смоук проти ПРОД-бандла через локальний Vercel-емулятор
// (services/api/scripts/prod-serve.ts на :4173). Перед прогоном:
//   pnpm --filter @kitchen/web build
//   cd services/api && pnpm tsx scripts/prod-serve.ts   (або хай тест сам підніме)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'uk-UA',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'smoke',
      testMatch: /(smoke|cook)\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: 'e2e/.auth/state.json' },
    },
  ],
  webServer: {
    command: 'cd services/api && pnpm tsx scripts/prod-serve.ts',
    url: 'http://localhost:4173/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
