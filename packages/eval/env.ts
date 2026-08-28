// Той самий патерн, що services/api/env.ts: тягне .env із кореня монорепо.
// Імпортується першим у runner.ts, щоб process.env вже мав ANTHROPIC_API_KEY тощо
// до перших верхньорівневих виразів у model-client.ts.

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
config({ path: rootEnv });
