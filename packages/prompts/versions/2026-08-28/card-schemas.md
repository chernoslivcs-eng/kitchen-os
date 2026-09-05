CARD варіанти:
{"type":"intake_diff","ops":[{"op":"add|deplete|open|rename|correct","label":"назва","to":"нова назва для rename","value":число,"unit":"g|ml|pcs|pack","zone":"fridge|freezer|dry|fresh|spices","confidence":0..1,"evidence":"user_statement|inference","state":"opened — якщо кажуть, що вже відкрито/початке","product":"пармезан","brand":"Galbani","variant":"тертий","tags":{"allergens":["молоко"],"fasting":true,"alcohol":false,"lactose":"yes|low|none","processing":"raw|cooked|ready","shelf_open_days":14}}]}
{"type":"proposal","items":[{"title":"назва страви","desc":"САМА СТРАВА: 1-2 речення про смак, текстуру, відчуття","why":"коротка причина, чому пропонуєш саме зараз — тільки якщо неочевидна","character":"скільки часу і скільки зусиль","rescues":["що з комори рятує"],"needs":["чого бракує — точна назва продукту"]}]}
{"type":"shopping","items":[{"op":"add|remove","label":"назва позиції","note":"коротка причина","v":500,"u":"g"}]}
{"type":"profile","field":"name|no|ban|love|meh|kit|when","mode":"append|replace","text":"продовження речення поля словами людини, узгоджене з початком речення: після «Я люблю» — знахідний («гостре», «рибу»), після «Я не їм» / «Мені не можна» — родовий («кінзи», «мʼяса», «арахісу»)"}
{"type":"profile","ops":[{"op":"add|remove","kind":"tradition|member","label":"значення","diet":"веганство","wishes":["веганство"],"antipatterns":["не їм мʼяса"],"allergies":[]}]}
{"type":"recipe","recipe":{"t":"назва","sv":2,"tm":30,"ch":"час і зусилля","d":"смак і текстура","rk":"ключова помилка","ing":[{"n":"назва","v":400,"u":"g"}],"st":[{"t":"крок","c":"дія з {0}","s":240}]}}
{"type":"recipe_edit","title":"назва рецепта зі стрічки","instruction":"що змінити, словами людини"}
{"type":"event","ops":[{"op":"add|edit|done|remove","id":"[8 символів із [ТВОЇ ПЛАНИ] — для edit/done/remove]","title":"назва події","kind":"meal|supply|constraint|custom","when":{"date":"2026-09-12"} | {"rel":"+7d"} | {"weekly":2},"days":7,"note":"уточнення словами людини","servings":6}]}
{"type":"cook_go","title":"назва обраної страви — дослівно з пропозиції"}
{"type":"cart_go","items":["позиція, якщо людина назвала конкретні — опційно"]}
{"type":"retail_search_go","query":"товар чи категорія, яку шукати в мережі"}
