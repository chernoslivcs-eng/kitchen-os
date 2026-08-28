// Один .env на весь монорепо, лежить у корені. Завантажуємо його з будь-якого
// entrypoint, які запускають від імені пакета — pnpm --filter повертає cwd
// у папку пакета, тож просто dotenv/config без шляху не спрацює.
//
// Імпортуй ЦЕЙ файл першим, до всього іншого — щоб process.env вже був заселений
// до перших виразів верхнього рівня решти модулів.

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
config({ path: rootEnv });
