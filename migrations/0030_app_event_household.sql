-- Пульс рахує по дому, а не по одній людині: витрати й поведінка запрошених
-- людей не були видні ніде. Стрічка дня тепер читається за household_id — і
-- без цього індексу той самий запит, що на індексі бере дев'ять сторінок,
-- перечитував би таблицю цілком (та сама історія, що з card_pending у 0028).
--
-- Частковий, як token_usage_household_created_idx: household_id у app_event
-- може бути null — інцидент буває без дому (наприклад, лист запрошення, який
-- не пішов, коли дому ще нема).
CREATE INDEX app_event_household_time_idx
  ON app_event (household_id, created_at DESC)
  WHERE household_id IS NOT NULL;
