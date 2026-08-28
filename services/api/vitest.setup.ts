// Vitest setup: тести — герметичні від живого API. Якщо .env випадково потрапить
// у процес (через env.ts, який імпортується з server.ts), ці змінні прибираються тут,
// і callChat/callAttachmentParse йдуть у stub-гілку.

delete process.env.OPENROUTER_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MODEL_FAST;
delete process.env.MODEL_SMART;
