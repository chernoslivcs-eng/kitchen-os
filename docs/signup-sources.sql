-- Джерела реєстрації: який канал приводить людей і скільки приведених домів ожило.
--
-- Дані — таблиця signup_source (міграція 0052): один рядок на кожен акаунт,
-- створений після її появи. Старших акаунтів тут немає зовсім — їхнього джерела
-- ніхто не записував, і вгадувати його заднім числом нема з чого.
--
-- Як мітити посилання (мітка — латиницею, без пробілів; до 64 символів):
--   https://kitchen-os.app/?utm_source=instagram&utm_medium=bio&utm_campaign=launch
--   https://kitchen-os.app/?utm_source=linkedin&utm_medium=post&utm_content=demo-video
--   https://kitchen-os.app/?ref=olena            — коротка мітка для експерта чи партнера
-- Рахується ПЕРШЕ мічене посилання, з якого людина прийшла в цьому браузері:
-- пізніші заходи з іншими мітками його не переписують.
--
-- Як запустити:
--   · скриптом з головної теки (читає PG_URL з .env, лише читання):
--       npx tsx scripts/signup-sources.mts
--   · або вставити цей файл цілком у SQL Editor консолі Neon — три запити,
--     три таблиці.
--
-- Як читати:
--   source       — utm_source; якщо його немає, але є ref — «ref:<значення>»;
--                  «(без мітки)» — людина прийшла не з міченого посилання.
--   signups      — нові доми (реєстрації). Запрошені в чужий дім сюди не входять.
--   with_pantry  — з них доми, де є хоча б одна партія в коморі (зокрема вже списана).
--   with_cook    — доми, де хоч раз готували (є cook_run; скасовані «я не готував» не рахуються).
--   active_subs  — доми з підпискою у стані active (платять зараз). Демо,
--                  скасовані й прострочені сюди не входять.
--
-- Обмежити періодом — додати в WHERE, наприклад: AND s.created_at >= '2026-10-15'.

-- 1. По джерелах.
SELECT
  coalesce(s.utm_source, 'ref:' || s.ref, '(без мітки)') AS source,
  count(*) AS signups,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pantry_batch b WHERE b.household_id = s.household_id)) AS with_pantry,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM cook_run c WHERE c.household_id = s.household_id AND c.undone_at IS NULL)) AS with_cook,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM household_subscription hs WHERE hs.household_id = s.household_id AND hs.state = 'active')) AS active_subs
FROM signup_source s
WHERE s.household_id IS NOT NULL
GROUP BY 1
ORDER BY signups DESC, source;

-- 2. Те саме в розрізі кампаній і способу входу (via: email, google, telegram).
SELECT
  coalesce(s.utm_source, 'ref:' || s.ref, '(без мітки)') AS source,
  s.utm_medium,
  s.utm_campaign,
  s.utm_content,
  s.ref,
  s.via,
  count(*) AS signups,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pantry_batch b WHERE b.household_id = s.household_id)) AS with_pantry,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM cook_run c WHERE c.household_id = s.household_id AND c.undone_at IS NULL)) AS with_cook,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM household_subscription hs WHERE hs.household_id = s.household_id AND hs.state = 'active')) AS active_subs
FROM signup_source s
WHERE s.household_id IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY signups DESC, source, s.utm_campaign NULLS LAST, s.via;

-- 3. Запрошені в чужий дім — окремо: свого дому вони не створюють, тож у
--    реєстрації вище не входять. Мітки тут — з яким посиланням запрошений
--    колись сам приходив на сайт (найчастіше порожньо: він прийшов із листа).
SELECT
  coalesce(s.utm_source, 'ref:' || s.ref, '(без мітки)') AS source,
  count(*) AS invited
FROM signup_source s
WHERE s.household_id IS NULL
GROUP BY 1
ORDER BY invited DESC, source;
