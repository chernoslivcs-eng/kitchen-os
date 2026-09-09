// Е2-Т3, ВОРОТА. Чи продовжує читання ГОДИННИЙ TTL кешу.
//
// Що вже доведено (Е1): годинний TTL через OpenRouter → Bedrock приймається
// без бета-хедера; ставки — запис 5 хв 1,25× входу, запис 1 год 2,00×,
// читання обох 0,1×. І окремо: попадання ПРОДОВЖУЄ TTL — але доведено це
// тільки для ПʼЯТИХВИЛИННОГО (запис t+2 с, попадання на t+244, t+486 і
// t+728 с; запис із пʼятихвилинним TTL прожив дванадцять хвилин).
//
// Для годинного той самий механізм ніхто не міряв. Уся економіка Т3 (−53% на
// середньому домі) стоїть на цьому припущенні, і воно перевіряється за
// пʼятнадцять центів.
//
// ТЕСТ: запис із ttl:'1h', далі три читання з кроком 50 хвилин.
//   t+50   — попадання буде і без продовження (50 < 60).
//   t+100  — ВИРІШАЛЬНЕ: без продовження запис уже мертвий (100 > 60).
//   t+150  — підтверджує, що це не одноразовий збіг.
// Третє попадання = TTL продовжується = Т3 можна впроваджувати.
// Промах на t+100 = Т3 НЕ робиться взагалі (а не «робиться обережно»).
//
// ДВІ РЕЧІ, БЕЗ ЯКИХ РЕЗУЛЬТАТ НЕ ЧИТАЄТЬСЯ:
//
// 1. ВЛАСНИЙ запис у кеші. Скрипт бере справжній чатовий префікс
//    (`compose('chat', loadPrompt())` — той самий розмір, ті самі правила),
//    але додає унікальний маркер прогону. Інакше попадання могло б прийти
//    від живого трафіку, який гріє той самий префікс, і «так, продовжується»
//    означало б лише «хтось писав у чат». Розмір при цьому реальний, тож
//    ціна прогону теж реальна.
// 2. ЗАКРІПЛЕНИЙ провайдер. OpenRouter тримає для sonnet 4.5 сім ендпоінтів
//    у пʼяти провайдерів, і кеш у КОЖНОГО свій. Читання, що потрапило на
//    іншого провайдера, промахнеться з причини, яка до TTL не має стосунку —
//    і саме так в Е1 лишилась без пояснення аномалія на 71-й секунді.
//    Тому провайдер прибитий і провайдер кожної відповіді друкується.
//
// ЗАПУСК (тільки власником — виклики платні):
//   pnpm --filter @kitchen/eval exec tsx scripts/cache-ttl-1h-gate.ts
// Ціна: один запис 2,00× + три читання 0,1× ≈ $0,15. Час: 2,5 години.

import '../env.js';
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, compose, hashPromptText } from '@kitchen/prompts';

const INTERVAL_MIN = Number(process.env.GATE_INTERVAL_MIN ?? 50);
const READS = 3;
const MODEL = process.env.MODEL_SMART ?? 'anthropic/claude-sonnet-4.5';
const PROVIDER = process.env.GATE_PROVIDER ?? 'amazon-bedrock';

const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('немає OPENROUTER_API_KEY / ANTHROPIC_API_KEY');
const client = new Anthropic({
  apiKey,
  baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api' : undefined,
});

const prompt = loadPrompt();
// Стадії немає: це найпоширеніший із трьох чатових префіксів (з
// onboarding-stage1/stage2 їх три, і в Т3 гріти доведеться всі живі).
const real = compose('chat', prompt);
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const block = `${real}\n\n---\n\n[ВИМІР TTL, не правило: ${RUN}]`;

interface Shot { at: string; minute: number; write1h: number; read: number; fresh: number; provider: string }

function usageOf(resp: unknown): Shot {
  const r = resp as {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
    };
    provider?: string;
  };
  const u = r.usage ?? {};
  return {
    at: new Date().toISOString(),
    minute: 0,
    write1h: u.cache_creation?.ephemeral_1h_input_tokens ?? u.cache_creation_input_tokens ?? 0,
    read: u.cache_read_input_tokens ?? 0,
    fresh: u.input_tokens ?? 0,
    provider: r.provider ?? 'не назвався',
  };
}

async function shoot(): Promise<Shot> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1,
    temperature: 0,
    system: [{ type: 'text', text: block, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: '.' }],
    // Поле OpenRouter, якого немає в типах Anthropic SDK: прибиває провайдера,
    // щоб промах не можна було сплутати з перемиканням ендпоінта.
    provider: { order: [PROVIDER], allow_fallbacks: false },
  } as unknown as Anthropic.MessageCreateParamsNonStreaming);
  return usageOf(resp);
}

const sleep = (min: number) => new Promise((r) => setTimeout(r, min * 60_000));

async function main(): Promise<void> {
  console.log('# Е2-Т3 ворота: чи продовжує читання годинний TTL\n');
  console.log(`модель            ${MODEL}`);
  console.log(`провайдер         ${PROVIDER} (прибитий, без фолбеків)`);
  console.log(`крок              ${INTERVAL_MIN} хв × ${READS} читання`);
  console.log(`prompt_hash real  ${hashPromptText(real)}  (${real.length} символів)`);
  console.log(`prompt_hash тесту ${hashPromptText(block)}  (${block.length} символів, маркер ${RUN})`);
  if (INTERVAL_MIN <= 60 - 1 && INTERVAL_MIN * 2 <= 60) {
    console.warn(`\n! крок ${INTERVAL_MIN} хв нічого не доводить: два читання вкладаються в годину `
      + 'навіть без продовження. Вимір має сенс від 31 хв.\n');
  }

  const shots: Shot[] = [];
  const t0 = Date.now();

  const w = await shoot();
  w.minute = 0;
  shots.push(w);
  console.log(`\nt+0     ЗАПИС    1h=${w.write1h}  read=${w.read}  fresh=${w.fresh}  provider=${w.provider}`);
  if (!w.write1h) {
    console.error('! запис у годинний кеш не відбувся — далі міряти нічого. Перевір ttl і розмір блока.');
    process.exitCode = 1;
    return;
  }

  for (let i = 1; i <= READS; i++) {
    await sleep(INTERVAL_MIN);
    const s = await shoot();
    s.minute = Math.round((Date.now() - t0) / 60_000);
    shots.push(s);
    const hit = s.read > 0;
    console.log(`t+${String(s.minute).padStart(3)}   ${hit ? 'ПОПАДАННЯ' : 'ПРОМАХ   '} `
      + `read=${s.read}  1h=${s.write1h}  fresh=${s.fresh}  provider=${s.provider}`);
  }

  const reads = shots.slice(1);
  const decisive = reads[1]; // t+100: без продовження запис уже мертвий
  const last = reads[reads.length - 1];
  const providers = new Set(shots.map((s) => s.provider));

  console.log('\n---\n');
  if (providers.size > 1) {
    console.log(`ПРОВАЙДЕР ЗМІНИВСЯ (${[...providers].join(', ')}) — результат не читається.`);
    console.log('Кеш у кожного провайдера свій. Повторити з прибитим провайдером.');
    process.exitCode = 1;
    return;
  }
  if (decisive?.read && last?.read) {
    console.log('ВЕРДИКТ: годинний TTL ПРОДОВЖУЄТЬСЯ читанням.');
    console.log(`Попадання на t+${decisive.minute} і t+${last.minute} — обидва за межею години від запису.`);
    console.log('Т3 (годинний TTL + пульс) можна впроваджувати.');
  } else {
    console.log('ВЕРДИКТ: продовження НЕ підтверджене.');
    console.log(`Вирішальне читання t+${decisive?.minute ?? '?'}: read=${decisive?.read ?? 0}.`);
    console.log('Т3 не робиться — річна економія стояла саме на цьому припущенні.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
