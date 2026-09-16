# MODEL_REASONING — замір 16.09 (локально, не прод)

10 реплік чату з фікстур: 5 звичайних (intent-capture, no-vs-meh-cilantro-meh,
feedback-diagnosis, allergy-stated-no-followup, cook-chronology), 3 з карткою
(generic-label-ask, member-card, missing-ingredient), 2 продуктових питання
(product-calories-where, product-silpo-connect). Два прогони підряд: без
параметра і з `MODEL_REASONING=minimal` (= thinking.budget_tokens 128).
Скрипт: `cd packages/eval && npx tsx scripts/reasoning-bench.ts`.

Висновки: базовий прогін відтворює прод (36–43 с на хід, 91 % виходу —
роздуми). З minimal: медіана 4,5 с (у 8 разів), вихід ×2,5 менше, роздуми
×3 менше; JSON валідний 10/10, тип картки збігається 10/10. Бюджет 128 —
мʼякий: на довгих ходах модель усе одно думає 300–1500 токенів, але без
верхньої межі у 2–2,6k. Перший minimal-хід (35 с) — холодний старт кешу після
зміни параметра, далі 2–8 с.

```
Модель: google/gemini-3.8-flash

=== без параметра ===
  [base] intent-capture                12433ms out=  817 think=  727 json=ok  card=—
  [base] no-vs-meh-cilantro-meh        36536ms out=  852 think=  800 json=ok  card=—
  [base] feedback-diagnosis            37462ms out=  681 think=  514 json=ok  card=—
  [base] allergy-stated-no-followup    37201ms out= 1022 think=  975 json=ok  card=—
  [base] cook-chronology               35984ms out=  272 think=  215 json=ok  card=—
  [base] generic-label-ask             42601ms out= 2723 think= 2598 json=ok  card=intake_diff
  [base] member-card                   42129ms out= 2287 think= 2202 json=ok  card=—
  [base] missing-ingredient            42627ms out= 2294 think= 1956 json=ok  card=proposal
  [base] product-calories-where        42678ms out=  676 think=  609 json=ok  card=—
  [base] product-silpo-connect         41239ms out=  435 think=  344 json=ok  card=—

=== MODEL_REASONING=minimal ===
  [minimal] intent-capture                35546ms out=  370 think=  284 json=ok  card=—
  [minimal] no-vs-meh-cilantro-meh         3066ms out=   54 think=    0 json=ok  card=—
  [minimal] feedback-diagnosis             5719ms out=  694 think=  539 json=ok  card=—
  [minimal] allergy-stated-no-followup     7579ms out=  510 think=  449 json=ok  card=—
  [minimal] cook-chronology                4505ms out=   60 think=    0 json=ok  card=—
  [minimal] generic-label-ask              6902ms out= 1738 think= 1507 json=ok  card=intake_diff
  [minimal] member-card                    1802ms out=   88 think=    0 json=ok  card=—
  [minimal] missing-ingredient             5225ms out= 1186 think=  922 json=ok  card=proposal
  [minimal] product-calories-where         1855ms out=  111 think=    0 json=ok  card=—
  [minimal] product-silpo-connect          3840ms out=   94 think=    0 json=ok  card=—

| прогін | latency, мс | output tokens (з роздумами) | роздуми | JSON ok | картки |
|---|---|---|---|---|---|
| без параметра | медіана 37462 · p90 42627 · макс 42678 | медіана 817 · p90 2294 · макс 2723 (Σ 12059) | Σ 10940 | 10/10 | —, —, —, —, —, intake_diff, —, proposal, —, — |
| minimal | медіана 4505 · p90 7579 · макс 35546 | медіана 111 · p90 1186 · макс 1738 (Σ 4905) | Σ 3701 | 10/10 | —, —, —, —, —, intake_diff, —, proposal, —, — |

Тип картки збігається: intent-capture: ✓; no-vs-meh-cilantro-meh: ✓; feedback-diagnosis: ✓; allergy-stated-no-followup: ✓; cook-chronology: ✓; generic-label-ask: ✓; member-card: ✓; missing-ingredient: ✓; product-calories-where: ✓; product-silpo-connect: ✓

```

## Якість (складні завдання, 16.09, локально)

Ті самі інваріанти, що в `pnpm eval`, на всіх `attachment_parse` (6 текстових:
receipt-abbreviated, receipt-till-silpo — текстова версія живого чека на 52
позиції, receipt-nonfood, receipt-silpo, receipt-open-shelf, recipe-freeform;
фото-фікстури receipt-till-photo і shelf-photo — файли не в репозиторії,
скіп), всіх `recipe_gen` (5) і 4 складних чатах (chat-dictation-dup — інтейк
на 8 позицій диктовкою, tagger-chat-brand — трійки, profile-verbatim і
diet-pescatarian-steak — пропозиції з обмеженнями профілю). Два прогони
підряд; третій (low) не знадобився — minimal ніде не просів.
Скрипт: `cd packages/eval && npx tsx scripts/reasoning-quality.ts`.

| виклик | рівень | зелених фікстур | latency медіана | токени | JSON |
|---|---|---|---|---|---|
| attachment_parse | без параметра | 4/6 | 25,9 с (p90 27,8) | out Σ 17624 · роздуми Σ 11450 | 6/6 |
| attachment_parse | minimal | 4/6 | 3,0 с (p90 5,0) | out Σ 6422 · роздуми Σ 0 | 6/6 |
| recipe_gen | без параметра | 3/5 | 24,2 с (p90 28,6) | out Σ 10182 · роздуми Σ 8159 | 3/5 |
| recipe_gen | minimal | 5/5 | 3,3 с (p90 7,1) | out Σ 2905 · роздуми Σ 462 | 5/5 |
| chat (складний) | без параметра | 3/4 | 37,5 с (p90 43,1) | out Σ 11370 · роздуми Σ 9872 | 4/4 |
| chat (складний) | minimal | 4/4 | 5,7 с (p90 6,3) | out Σ 5224 · роздуми Σ 3542 | 4/4 |

Що видно:
- **Вкладення:** 4/6 в обох; дві червоні — той самий `triple-discipline`
  (label бідніший за трійку) на різних рядках у різних прогонах — це
  нестабільність моделі, не рівня. Покриття рядків, розгортання скорочень,
  нехарчове, теги shelf_open_days (receipt-open-shelf 3/3) — однакові.
  Роздуми на minimal — 0 у всіх шести.
- **Рецепти:** без параметра 3/5 — два провали через РОЗДУМИ: recipe-edit-
  keeps-cast видав 4092 токени (усі 3933 — роздуми) і впав у max_tokens 4096
  без рецепта; recipe-context-carries — порожній вихід. Це той самий механізм,
  що на проді. З minimal — 5/5: інгредієнти з комори, кроки, обмеження
  (diet-vegan-fish-sauce 3/3) на місці.
- **Чат складний:** без параметра profile-verbatim — 4068 токенів, 3865 з них
  роздуми, картки нема; з minimal — proposal 3 страви, усі 4 інваріанти
  (вето кінзи, веганство, нотатка). Інтейк на 8 позицій — ops збігаються
  один в один (ті самі 8 label). Трійки tagger-chat-brand — 4/4 в обох
  («оливкова олія» ↔ «олія оливкова» — порядок слів).

**Рекомендація:** `MODEL_REASONING=minimal` на всі три виклики; окремий
`MODEL_REASONING_ATTACH` не потрібен (не додано). Якщо колись знадобиться
глибше думання на рецептах — `low` (1024) достатньо, бо роздуми там
корисні лише до ~500 токенів (diet-vegan-fish-sauce на minimal думав 462).

Вартість заміру: 30 живих викликів (12 вкладень, 10 рецептів, 8 чатів) ≈
350k in + 54k out ≈ $0.15–0.20 (бюджет $1).

```
Модель: google/gemini-3.8-flash

=== attachment_parse (receipt-abbreviated, receipt-till-silpo, receipt-nonfood, receipt-silpo, receipt-open-shelf, recipe-freeform) ===
--- без параметра ---
  [base] receipt-abbreviated         5/5  22630ms out= 2078 think= 1308 json=ok 
  [base] receipt-till-silpo          5/6  27710ms out= 4282 think= 2771 json=ok  ✗ triple-discipline (label «напій Schweppes Pink Tonic» бідніший за трійку: бракує тонік · )
  [base] receipt-nonfood             3/3  33261ms out=  922 think=  362 json=ok 
  [base] receipt-silpo               5/6  27848ms out= 4835 think= 3338 json=ok  ✗ triple-discipline (бренд у variant при порожньому brand: жовтий Біоранж)
  [base] receipt-open-shelf          3/3  25891ms out= 3951 think= 2513 json=ok 
  [base] recipe-freeform             4/4  21351ms out= 1556 think= 1158 json=ok 
--- minimal ---
  [minimal] receipt-abbreviated         5/5   3035ms out=  763 think=    0 json=ok 
  [minimal] receipt-till-silpo          5/6   4984ms out= 1660 think=    0 json=ok  ✗ triple-discipline (label «шоколад молочний Korona з мигдалем та кокосом 25 г» бідніший за)
  [minimal] receipt-nonfood             3/3   2455ms out=  572 think=    0 json=ok 
  [minimal] receipt-silpo               5/6   5656ms out= 1566 think=    0 json=ok  ✗ triple-discipline (label «стейк портерхаус яловичий сухої витримки 502 г» бідніший за трі)
  [minimal] receipt-open-shelf          3/3   4455ms out= 1460 think=    0 json=ok 
  [minimal] recipe-freeform             4/4   2648ms out=  401 think=    0 json=ok 

=== recipe_gen (recipe-context-carries, recipe-edit-keeps-cast, servings-scale, lesson-into-step, diet-vegan-fish-sauce) ===
--- без параметра ---
  [base] recipe-context-carries      2/3  22940ms out=    0 think=    0 json=BAD ✗ recipe-returned (рецепта немає — модель відповіла прозою: )
  [base] recipe-edit-keeps-cast      0/1  29141ms out= 4092 think= 3933 json=BAD ✗ edit-keeps-cast (рецепта немає — правка не відбулась)
  [base] servings-scale              1/1  18076ms out=  509 think=  325 json=ok 
  [base] lesson-into-step            2/2  24201ms out= 2378 think= 1709 json=ok 
  [base] diet-vegan-fish-sauce       3/3  28581ms out= 3203 think= 2192 json=ok 
--- minimal ---
  [minimal] recipe-context-carries      3/3  18868ms out=  656 think=    0 json=ok 
  [minimal] recipe-edit-keeps-cast      1/1   2478ms out=  311 think=    0 json=ok 
  [minimal] servings-scale              1/1   1911ms out=  162 think=    0 json=ok 
  [minimal] lesson-into-step            2/2   3341ms out=  613 think=    0 json=ok 
  [minimal] diet-vegan-fish-sauce       3/3   7148ms out= 1163 think=  462 json=ok 

=== chat (chat-dictation-dup, tagger-chat-brand, profile-verbatim, diet-pescatarian-steak) ===
--- без параметра ---
  [base] chat-dictation-dup          2/2  43051ms out= 3119 think= 2399 json=ok 
         card: intake_diff ops=8 [банани; багет; вершкове масло Metro Chef; вода; суміш овочів; стейк з лосося; стейк м'ясний; набір м'ясний на гуляш]
  [base] tagger-chat-brand           4/4  37546ms out= 1579 think= 1268 json=ok 
         card: intake_diff ops=2 [пармезан Galbani тертий; оливкова олія]
  [base] profile-verbatim            3/4  49059ms out= 4068 think= 3865 json=ok  ✗ is-proposal (очікували proposal, отримали (null))
         card: —
  [base] diet-pescatarian-steak      4/4  15058ms out= 2604 think= 2340 json=ok 
         card: proposal items=3 [Стейк тунця з лимоном; Печена картопля зі стейком тунця; Теплий салат із картоплі та тунця]
--- minimal ---
  [minimal] chat-dictation-dup          2/2   2614ms out=  553 think=    0 json=ok 
         card: intake_diff ops=8 [банани; багет; вершкове масло Metro Chef; вода; суміш овочів; стейк з лосося; стейк м'ясний; набір м'ясний на гуляш]
  [minimal] tagger-chat-brand           4/4   5692ms out= 1281 think=  977 json=ok 
         card: intake_diff ops=2 [пармезан Galbani тертий; олія оливкова]
  [minimal] profile-verbatim            4/4   8078ms out= 1921 think= 1501 json=ok 
         card: proposal items=3 [Крем-суп із томатів і кокосового молока; Густе нутове карі в томатно-кокосовому соусі; Пряний рис, уварений у томатах і кокосі +1]
  [minimal] diet-pescatarian-steak      4/4   6280ms out= 1469 think= 1064 json=ok 
         card: proposal items=3 [Стейк тунця з відвареною картоплею та лимоном; Теплий картопляний салат із тунцем; Смажена картопля з лисичками +1]

| виклик | рівень | зелених фікстур | latency медіана | токени | JSON |
|---|---|---|---|---|---|
| attachment_parse | без параметра | 4/6 | 25891 мс (p90 27848) | out Σ 17624 · роздуми Σ 11450 | 6/6 |
| attachment_parse | minimal | 4/6 | 3035 мс (p90 4984) | out Σ 6422 · роздуми Σ 0 | 6/6 |
| recipe_gen | без параметра | 3/5 | 24201 мс (p90 28581) | out Σ 10182 · роздуми Σ 8159 | 3/5 |
| recipe_gen | minimal | 5/5 | 3341 мс (p90 7148) | out Σ 2905 · роздуми Σ 462 | 5/5 |
| chat | без параметра | 3/4 | 37546 мс (p90 43051) | out Σ 11370 · роздуми Σ 9872 | 4/4 |
| chat | minimal | 4/4 | 5692 мс (p90 6280) | out Σ 5224 · роздуми Σ 3542 | 4/4 |

Картки чату (base → minimal):
  chat-dictation-dup:
    base:    intake_diff ops=8 [банани; багет; вершкове масло Metro Chef; вода; суміш овочів; стейк з лосося; стейк м'ясний; набір м'ясний на гуляш]
    minimal: intake_diff ops=8 [банани; багет; вершкове масло Metro Chef; вода; суміш овочів; стейк з лосося; стейк м'ясний; набір м'ясний на гуляш]
  tagger-chat-brand:
    base:    intake_diff ops=2 [пармезан Galbani тертий; оливкова олія]
    minimal: intake_diff ops=2 [пармезан Galbani тертий; олія оливкова]
  profile-verbatim:
    base:    —
    minimal: proposal items=3 [Крем-суп із томатів і кокосового молока; Густе нутове карі в томатно-кокосовому соусі; Пряний рис, уварений у томатах і кокосі +1]
  diet-pescatarian-steak:
    base:    proposal items=3 [Стейк тунця з лимоном; Печена картопля зі стейком тунця; Теплий салат із картоплі та тунця]
    minimal: proposal items=3 [Стейк тунця з відвареною картоплею та лимоном; Теплий картопляний салат із тунцем; Смажена картопля з лисичками +1]

```
