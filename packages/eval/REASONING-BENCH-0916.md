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
