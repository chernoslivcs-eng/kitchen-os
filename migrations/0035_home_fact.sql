-- Р146 (рішення власника 13.09): «факт дому» під чіпами порожньої розмови
-- генерує модель. Один рядок на дім і день: перший запит дня кладе шаблон і
-- позначає, що модель у дорозі (llm_state = pending); модель дописує текст
-- (source = llm, done) або здається (failed) — і тоді на цей день лишається
-- шаблон, без повторних викликів. Наступного дня рядок новий.
--
-- date — ЛОКАЛЬНИЙ день дому (local-day.ts), не UTC: «сьогодні» для людини.
-- text NULL — фактів для шаблону немає, але модель ще може щось сказати.
CREATE TABLE home_fact (
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  date         date NOT NULL,
  text         text,
  source       text,
  llm_state    text NOT NULL DEFAULT 'none',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, date)
);
