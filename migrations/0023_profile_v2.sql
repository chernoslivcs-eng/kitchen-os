-- Раунд 4 (AUDIT-ROUND-4.md §2): профіль як сім речень.
--
-- Три нові таблиці; стара `profile` НЕ чіпається до кроку 9 — під вимкненим
-- прапором PROFILE_V2 усе працює як раніше. Старі записи переносяться один
-- раз, тут; далі дві моделі живуть паралельно, і правда — та, яку читає прапор.

-- ----- 2.1. profile_text: сім полів на людину ------------------------------

CREATE TABLE profile_text (
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key IN ('name','no','ban','love','meh','kit','when')),
  text        text NOT NULL DEFAULT '',
  -- empty: ще не відповідали · filled · none: «Нічого такого», не перепитувати
  status      text NOT NULL DEFAULT 'empty' CHECK (status IN ('empty','filled','none')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ----- 2.2. profile_note: рядки від асистента --------------------------------
-- (у контракті — «notes»; в схемі однина, як memory_note / pantry_batch)

CREATE TABLE profile_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  subject     text,                       -- раунд 5; поки null
  text        text NOT NULL CHECK (char_length(text) <= 140),
  source      text NOT NULL CHECK (source IN ('assistant','user')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,                -- мʼяке видалення — для «Повернути»
  norm_hash   text NOT NULL               -- md5 нормалізованого тексту, для дедупу
);
CREATE INDEX profile_note_user_idx ON profile_note(user_id, created_at DESC);

-- ----- 2.3. veto_index: похідне з `no` і `ban`, не редагується -------------

CREATE TABLE veto_index (
  id          bigserial PRIMARY KEY,      -- порядок рядків = порядок у тексті
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  field       text NOT NULL CHECK (field IN ('no','ban')),
  kind        text NOT NULL CHECK (kind IN ('category','product','free')),
  ref         text,                       -- категорія або key продукту каталогу; null для free
  label       text NOT NULL,              -- як у тексті людини
  -- усе з ban + рядки з no, де є «алергі». Похідне, але per-row: без нього
  -- вето мусило б наново різати текст поля на рядки.
  allergy     boolean NOT NULL DEFAULT false,
  subject     text                        -- раунд 5; поки null
);
CREATE INDEX veto_index_user_idx ON veto_index(user_id, field);

-- ----- 2.4. Перенесення старих записів -------------------------------------
-- Ліміти полів (30/200/140/200/200/260/250) — з packages/domain/profile-text.ts;
-- left() ріже по символах, як clampProfileText.

-- allergy → ban (через кому)
INSERT INTO profile_text (user_id, key, text, status, updated_at)
SELECT user_id, 'ban', left(array_to_string(allergies, ', '), 140), 'filled', updated_at
FROM profile
WHERE cardinality(allergies) > 0
ON CONFLICT (user_id, key) DO NOTHING;

-- anti → no; wish зі словника пресетів (веган…, пескетаріан…, вегетаріан…,
-- халяль, пісне/пощу/постую/постуємо, «нічого тваринного») → теж no.
-- Стеми — ті самі, що VETO_PRESETS у домені; tests/sql-arity.test.ts стежить.
INSERT INTO profile_text (user_id, key, text, status, updated_at)
SELECT p.user_id, 'no', left(array_to_string(
  p.antipatterns || COALESCE(
    (SELECT array_agg(w ORDER BY ord) FROM unnest(p.wishes) WITH ORDINALITY AS t(w, ord)
      WHERE lower(w) ~ '(веган|нічого тваринного|пескетаріан|вегетаріан|халяль|пісне|пощу|постую|постуємо)'),
    '{}'::text[]),
  '. '), 200), 'filled', p.updated_at
FROM profile p
WHERE cardinality(p.antipatterns) > 0
   OR EXISTS (SELECT 1 FROM unnest(p.wishes) w
              WHERE lower(w) ~ '(веган|нічого тваринного|пескетаріан|вегетаріан|халяль|пісне|пощу|постую|постуємо)')
ON CONFLICT (user_id, key) DO NOTHING;

-- решта wish → love
INSERT INTO profile_text (user_id, key, text, status, updated_at)
SELECT p.user_id, 'love', left(array_to_string(
  (SELECT array_agg(w ORDER BY ord) FROM unnest(p.wishes) WITH ORDINALITY AS t(w, ord)
    WHERE lower(w) !~ '(веган|нічого тваринного|пескетаріан|вегетаріан|халяль|пісне|пощу|постую|постуємо)'),
  '. '), 200), 'filled', p.updated_at
FROM profile p
WHERE EXISTS (SELECT 1 FROM unnest(p.wishes) w
              WHERE lower(w) !~ '(веган|нічого тваринного|пескетаріан|вегетаріан|халяль|пісне|пощу|постую|постуємо)')
ON CONFLICT (user_id, key) DO NOTHING;

-- equip → kit: що є — через кому; чого нема — окремим реченням «Немає: …»
-- (база — плита, духовка, мікрохвильовка, холодильник — є за замовчуванням,
-- тому «немає» важливіше зберегти, ніж «є»).
INSERT INTO profile_text (user_id, key, text, status, updated_at)
SELECT p.user_id, 'kit', left(concat_ws('. ',
  NULLIF((SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_each_text(p.equipment) e(k, v) WHERE v = 'has'), ''),
  NULLIF('Немає: ' || (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_each_text(p.equipment) e(k, v) WHERE v = 'lacks'), 'Немає: ')
), 260), 'filled', p.updated_at
FROM profile p
WHERE EXISTS (SELECT 1 FROM jsonb_each_text(p.equipment) e(k, v) WHERE v IN ('has', 'lacks'))
ON CONFLICT (user_id, key) DO NOTHING;

-- note (lesson) → notes, source: user; intent → «хотів: …».
-- norm_hash — те саме, що noteHash() у домені: lower, без пунктуації, один пробіл.
INSERT INTO profile_note (id, user_id, subject, text, source, created_at, deleted_at, norm_hash)
SELECT n.id, n.user_id, NULL,
       t.text, 'user', n.created_at, NULL,
       md5(btrim(regexp_replace(regexp_replace(lower(t.text), '[^[:alnum:] ]', '', 'g'), '\s+', ' ', 'g')))
FROM memory_note n
CROSS JOIN LATERAL (
  SELECT left(CASE WHEN n.kind = 'intent' THEN 'хотів: ' || n.text ELSE n.text END, 140) AS text
) t
ON CONFLICT (id) DO NOTHING;

-- tradition, member — не переносяться (раунд 5), лишаються в `profile` / `eater`.
