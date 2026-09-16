-- 16.09: рівень міркування (env MODEL_REASONING: minimal|low|medium|high),
-- що поїхав у виклик smart-моделі через OpenRouter. NULL — не слали (Claude
-- зі своєю механікою або env порожній). Щоб у admin/money було видно, з яким
-- рівнем зроблено виклик, коли порівнюємо латентність і вихідні токени.
ALTER TABLE token_usage ADD COLUMN reasoning text;
