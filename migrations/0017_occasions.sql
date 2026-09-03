-- Календар подій, фаза 1 «вісь часу».
--
-- Комора відповідає на «що в мене є», календар — на «що в мене буде». Це друга
-- вісь того самого інвентаря, а не окремий модуль: партія з терміном — подія,
-- спрямована назад («вмирає в пʼятницю»), подія календаря — вперед
-- («прийде в пʼятницю»).
--
-- Пара таблиць повторює ту, що вже працює для продуктів (0012):
--   catalog_ingredient → household_product     глобальний довідник → істина дому
--   occasion_catalog   → household_event       те саме для подій
-- Каталог редагує розробник (згодом адмінка), дім — людина й модель.
--
-- Третьої таблиці (household_occasion_state: muted, caught_at) тут свідомо
-- немає. Вона потрібна фазам 4 і 6 — вимкненню редакційних подій і підсумку
-- «рік на кухні». Порожня таблиця, якої ніхто не читає, — це обіцянка, якої
-- код не тримає; додамо міграцією тоді, коли зʼявиться той, хто в неї пише.

-- ── Глобальний довідник ─────────────────────────────────────────────────────
CREATE TABLE occasion_catalog (
  id             text PRIMARY KEY,      -- 'veg-peak', 'lent', 'tomato-day-2026'
  kind           text NOT NULL CHECK (kind IN ('season', 'tradition', 'editorial')),
  title          text NOT NULL,

  -- Причина щось приготувати саме зараз, а не довідка: модель цитує майже
  -- дослівно. Порожнє в якорів (Рамадан, Песах) — вони точки, а не сезони,
  -- і в блок «ЗАРАЗ» не потрапляють ніколи.
  meaning        text,

  -- Пʼять форм однієї дати, тип Rule з packages/domain/occasion-rules.ts:
  --   {"t":"window","from":"07-15","to":"09-20"}   фіксоване вікно, щороку
  --   {"t":"easter","from":-48,"to":-1}            зсув у днях від Великодня
  --   {"t":"lunar","base":1771372800000}           якір + дрейф 354.367 доби
  --   {"t":"solar","base":1775088000000}           якір + дрейф 365.25
  rule           jsonb NOT NULL,

  -- Сезон грибів нічого не забороняє; піст, поки триває, — обмеження тієї ж
  -- сили, що «не їм свинину». Спільне формулювання «привід, а не обовʼязок»
  -- знецінювало піст: модель у Великий піст пропонувала вершковий суп-пюре,
  -- маючи блок посту перед очима.
  force          text NOT NULL DEFAULT 'hint' CHECK (force IN ('hint', 'restrict')),
  restricts      text,

  -- Показувати лише дому з цією традицією. NULL — усім (сезони).
  tradition      text CHECK (tradition IN ('orthodox', 'catholic', 'islamic', 'jewish')),

  buy            text[] NOT NULL DEFAULT '{}',
  seeds          text[] NOT NULL DEFAULT '{}',

  -- Фактичний початок місячного свята залежить від спостереження молодика.
  -- Сказати «сьогодні почалось» на день раніше, ніж у людини, гірше, ніж не
  -- сказати нічого — тому позначку орієнтовності губити не можна.
  approx         boolean NOT NULL DEFAULT false,

  -- Як подія називається у стрічці «Попереду». Задане — у стрічку йде тільки
  -- початок під цією назвою («починається Великий піст»). Порожнє — обидва
  -- кінці вікна: «— починається» і «— останні дні». Сезон, що закінчується,
  -- сильніший привід за сезон, що триває; «Великдень — останні дні» не
  -- означає нічого.
  upcoming_title text,

  -- Модуль приводів структурно не відрізняється від рекламного каналу:
  -- подія → пропозиція докупити, різниця лише в тому, хто платить за подію.
  -- Тому редакційна подія від першого дня видимо підписана джерелом. NULL —
  -- система. Перевірку «editorial ніколи не restrict» тримає CHECK нижче.
  source         text,
  audience       jsonb,                 -- кому показувати; NULL — усім
  published_at   timestamptz,           -- NULL — чернетка, назовні не йде
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT occasion_restrict_has_text
    CHECK (force = 'hint' OR restricts IS NOT NULL),
  CONSTRAINT occasion_editorial_never_restricts
    CHECK (kind <> 'editorial' OR force = 'hint')
);

-- Читання завжди йде вікном дат по опублікованих.
CREATE INDEX occasion_catalog_published_idx
  ON occasion_catalog (published_at) WHERE published_at IS NOT NULL;

-- ── Істина дому ─────────────────────────────────────────────────────────────
CREATE TABLE household_event (
  id           uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES household(id) ON DELETE CASCADE,

  --   meal       слот сітки: страва на дату
  --   supply     очікуване надходження: «мама привезе цибулю 10-го».
  --              Це майбутня партія комори, а не побажання — тому окремий рід.
  --   constraint «у вівторок мало часу»: сила hint, впливає на пропозиції
  --   custom     привід дому: день народження, гості
  kind         text NOT NULL CHECK (kind IN ('meal', 'supply', 'constraint', 'custom')),
  title        text NOT NULL,
  note         text,

  -- Той самий Rule, що в каталозі, плюс дві форми, які має тільки дім:
  --   {"t":"once","at":"2026-09-10","days":1}   разова подія
  --   {"t":"weekly","dow":5}                    «щопʼятниці риба»
  rule         jsonb NOT NULL,

  force        text NOT NULL DEFAULT 'hint' CHECK (force IN ('hint', 'restrict')),
  restricts    text,
  buy          text[] NOT NULL DEFAULT '{}',

  recipe_id    uuid REFERENCES recipe(id) ON DELETE SET NULL,  -- kind='meal'
  servings     int,          -- kind='meal': на скількох, якщо не base_servings
  supply       jsonb,        -- kind='supply': [{label,v,u}] — що саме прийде

  created_by   uuid REFERENCES "user"(id) ON DELETE SET NULL,
  source       text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'model')),

  -- Відповідь на ризик із 05-risks: «мама привезе цибулю — тиждень готуємо з
  -- нею» через місяць стає шумом, і без згасання блок побажань перетворюється
  -- на смітник за півроку. Подія має право померти сама: після expires_at вона
  -- не йде в контекст, але рядок лишається — видалення знищило б історію.
  expires_at   timestamptz,
  done_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT household_event_restrict_has_text
    CHECK (force = 'hint' OR restricts IS NOT NULL)
);

-- Читання завжди по дому й вікну дат.
CREATE INDEX household_event_household_idx ON household_event (household_id);
CREATE INDEX household_event_live_idx
  ON household_event (household_id, expires_at) WHERE done_at IS NULL;
