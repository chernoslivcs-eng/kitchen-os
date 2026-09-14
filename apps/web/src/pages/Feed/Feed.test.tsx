// @vitest-environment jsdom
//
// Пул-9: композитор і стрічка під час думання.
//   №1 (смуга «Краще не відкладати») знято в 6b-6 — рядка над композитором
//       більше нема, факт живе в «Дім зараз»;
//   №2 вкладення видно в надісланій репліці;
//   №3 очікування має час, а після 45 с — другий рядок;
//   №4 «Стоп» рве виклик і не додає картку;
//   №5 поле не гасне, репліки стають у чергу — послідовно, глибина 3;
//   №6 артефакт із ходу виходить у панель — включно з карткою серії (period),
//       яка приїхала з періодом і в правилі №6 нічим не особлива.
//
// CSS-модулі у vitest резолвляться в порожній обʼєкт, тому перевіряються не
// імена класів (їх у DOM просто не буде), а те, що ЛАМАЛОСЬ: інлайн-стилі,
// структура, порядок викликів.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Feed } from './Feed';
import { usePanelStore } from '../../store/panel';
import { ArtifactPanel } from '../../components/ArtifactPanel/ArtifactPanel';
import { useAuth } from '../../store/auth';
import { greeting } from '../../lib/greeting';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ChatCall { body: { text?: string; attachments?: { id: string }[]; session_id?: string } }
let chatCalls: ChatCall[];
let scriptedCalls: { body: { topic?: string } | null }[];
let waiting: { resolve: (body: unknown) => void; reject: (e: Error) => void }[];
let batches: { id: string; label: string; state: string; expires_at: string | null; days: number | null }[];
let library: { recipes: unknown[]; runs: unknown[] };
// Р148: історія сьогоднішньої сесії — щоб перевірити мітку каналу на ході.
let todayMessages: unknown[];

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

function installFetch() {
  chatCalls = [];
  scriptedCalls = [];
  waiting = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url === '/v1/chat/scripted') { scriptedCalls.push({ body }); return json({ reply: 'ДОВІДКА', card: null, card_id: null, usage: { input: 0, output: 0 }, meta: { promptVersion: 'help-topic', model: 'deterministic', mode: 'stub', scripted: body?.topic } }); }
    if (url === '/v1/chat') {
      chatCalls.push({ body });
      // Виклик зависає, поки тест його сам не відпустить — так видно і
      // послідовність черги, і те, що робить «Стоп» посеред думання.
      return new Promise((resolve, reject) => {
        waiting.push({ resolve: (b) => resolve(json(b)), reject });
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    }
    if (url === '/v1/pantry') return json({ count: batches.length, batches, products: [] });
    if (url === '/v1/shopping') return json({ count: 0, items: [] });
    if (url === '/v1/cards/pending') return json({ cards: [] });
    if (url === '/v1/recipes') return json({ recipes: library.recipes });
    if (url === '/v1/cook-runs') return json({ runs: library.runs });
    if (url === '/v1/retail') return json({ silpo: { status: 'none' } });
    if (url === '/v1/session/today') return json({ session: { id: 's1', created_at: '2026-09-06T06:00:00Z' }, messages: todayMessages });
    if (url === '/v1/attachments') return json({ id: 'att-new', url: '/v1/attachments/att-new/bytes', kind: 'image', bytes: 10, content_type: 'image/jpeg' });
    return json({});
  }));
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    // Панель у продукті живе в каркасі поруч зі Стрічкою; правило «новий
    // артефакт наперед» — стик між ними, тому монтуються обидві.
    root!.render(<MemoryRouter><Feed /><ArtifactPanel /></MemoryRouter>);
  });
}

const q = <T extends Element>(sel: string) => host!.querySelector<T>(sel);
const qa = (sel: string) => [...host!.querySelectorAll(sel)];
const textarea = () => q<HTMLTextAreaElement>('textarea')!;
const sendBtn = () => q<HTMLButtonElement>('button[type="submit"]')!;
const stopBtn = () => q<HTMLButtonElement>('button[data-stop]');

async function type(text: string) {
  const el = textarea();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => { sendBtn().click(); });
}

beforeEach(() => {
  batches = [];
  library = { recipes: [], runs: [] };
  todayMessages = [];
  useAuth.setState({ me: null });
  installFetch();
  vi.useRealTimers();
  // Панель живе в каркасі й переживає монтування Стрічки — між тестами
  // її стан треба обнуляти самим.
  usePanelStore.setState({ artifacts: [], freshKeys: [], active: null, lastManualPick: 0, hidden: false, fresh: false });
  // jsdom не має ні matchMedia, ні ResizeObserver; rAF панелі рахує тінь над
  // низом і до цих тестів стосунку не має.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('№2 вкладення в надісланій репліці', () => {
  it('файли лишаються видимими у ході, кожен — посилання на /bytes', async () => {
    await mount();
    const input = q<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'chek.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await submit();

    const links = qa('[data-turn-attachments] a') as HTMLAnchorElement[];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/v1/attachments/att-new/bytes');
    // Підпису «[вкладення]» за людину більше немає.
    expect(host!.textContent).not.toContain('[вкладення]');
  });
});

describe('№3 очікування', () => {
  it('рядок несе час, а після 45 с — другий рядок', async () => {
    await mount();
    await type('що приготувати');
    await submit();

    expect(q('[data-wait]')?.textContent).toContain('0:00');
    expect(q('[data-wait-long]')).toBeNull();

    // Таймер справжній — підміняємо годинник, а не сам напис.
    const t0 = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 47_000);
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(q('[data-wait]')?.textContent).toContain('0:47');
    expect(q('[data-wait-long]')?.textContent).toBe('Ще тримаю');
  });
});

describe('№4 «Стоп»', () => {
  it('обриває хід: картки не зʼявляється, хід позначений «зупинив»', async () => {
    await mount();
    await type('порахуй калорії');
    await submit();
    expect(stopBtn()).toBeTruthy();

    await act(async () => { stopBtn()!.click(); });
    // Сервер може добігти й відповісти — відповідь уже не приймається.
    await act(async () => {
      waiting[0]!.resolve({ reply: 'ось відповідь', card: { type: 'proposal', items: [] }, card_id: 'c1' });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(q('[data-aborted]')?.textContent).toBe('зупинив');
    expect(host!.textContent).not.toContain('ось відповідь');
    expect(stopBtn()).toBeNull();
  });
});

describe('№5 черга', () => {
  it('три репліки поспіль — три виклики послідовно, порядок збережений', async () => {
    await mount();
    await type('перша'); await submit();
    await type('друга'); await submit();
    await type('третя'); await submit();

    // Паралельних викликів немає: другий стартує лише коли перший завершився.
    expect(chatCalls).toHaveLength(1);
    expect(qa('[data-queued]')).toHaveLength(2);

    await act(async () => {
      waiting[0]!.resolve({ reply: 'р1', card: null, card_id: null });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(chatCalls).toHaveLength(2);
    await act(async () => {
      waiting[1]!.resolve({ reply: 'р2', card: null, card_id: null });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls.map((c) => c.body.text)).toEqual(['перша', 'друга', 'третя']);
  });

  it('поле й скріпка не гаснуть під час думання', async () => {
    await mount();
    await type('перша'); await submit();
    expect(textarea().disabled).toBe(false);
    expect(q<HTMLButtonElement>('button[aria-label="Додати вкладення"]')!.disabled).toBe(false);
  });

  it('глибина черги 3: наступна репліка блокована — «дай відповісти»', async () => {
    await mount();
    // Перша поїхала в модель, три стали в чергу — стеля.
    for (const t of ['перша', 'друга', 'третя', 'четверта']) { await type(t); await submit(); }
    expect(qa('[data-queued]')).toHaveLength(3);

    await type('пʼята');
    expect(sendBtn().disabled).toBe(true);
    expect(sendBtn().title).toBe('дай відповісти');
    await submit();
    expect(qa('[data-queued]')).toHaveLength(3);
    expect(chatCalls).toHaveLength(1);
  });

  it('«Стоп» знімає і поточний хід, і те, що чекає', async () => {
    await mount();
    await type('перша'); await submit();
    await type('друга'); await submit();

    await act(async () => { stopBtn()!.click(); });
    expect(qa('[data-aborted]')).toHaveLength(2);
    expect(qa('[data-queued]')).toHaveLength(0);
    // Черга не поїхала далі: другий виклик так і не стартував.
    expect(chatCalls).toHaveLength(1);
  });
});

describe('№6 новий артефакт із ходу виходить у панель', () => {
  // Правило одне на всі роди артефактів: ключ, що прийшов ходом цієї сесії
  // вкладки, стає активним. Картка серії (period) не виняток — вона
  // потрапляє в `pickArtifacts` так само, як кошик чи рецепт.
  const seriesCard = {
    type: 'period',
    kind: 'tradition',
    tradition: 'orthodox',
    items: [
      { occasion_id: 'o1', title: 'Великдень', from: '2026-04-12', to: '2026-04-12', enabled: true },
      { occasion_id: 'o2', title: 'Різдво', from: '2026-01-07', to: '2026-01-07', enabled: true },
    ],
  };

  it('картка серії з чату стає активною вкладкою', async () => {
    await mount();
    await type('додай православні свята');
    await submit();
    await act(async () => {
      waiting[0]!.resolve({ reply: 'Додав', card: seriesCard, card_id: 'period-1' });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(usePanelStore.getState().active).toBe('period-1');
    expect(usePanelStore.getState().freshKeys).toContain('period-1');
  });

  it('серія не перебиває того, що людина відкрила руками секунду тому', async () => {
    await mount();
    // Спершу приїхав рецепт і став активним; людина лишила його відкритим.
    await type('рецепт'); await submit();
    await act(async () => {
      waiting[0]!.resolve({ reply: 'ось', card: { type: 'recipe_link', recipe_id: 'r1', title: 'Борщ' }, card_id: 'rec-1' });
      await new Promise((r) => setTimeout(r, 0));
    });
    // Рука: перемкнула на нього ж свідомо, просто зараз.
    await act(async () => { usePanelStore.getState().setActive('rec-1'); });

    await type('додай православні свята'); await submit();
    await act(async () => {
      waiting[1]!.resolve({ reply: 'Додав', card: seriesCard, card_id: 'period-1' });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(usePanelStore.getState().active).toBe('rec-1');
  });
});

// FIXES-V3-2 №29–№30: одне головне гніздо праворуч — порожнє поле → мікрофон
// (або «надіслати» в спокої, де диктовки нема), є текст → «надіслати» на тому
// ж місці; підпису «⌘K» у полі нема, клавіша працює.
describe('№29 · одне гніздо', () => {
  it('у гнізді завжди одна кнопка; з текстом — «надіслати»; ⌘K фокусує композитор без підпису в полі', async () => {
    await mount();
    expect(qa('[data-slot]')).toHaveLength(1);
    expect(host!.textContent).not.toContain('⌘K');
    await type('привіт');
    expect(qa('[data-slot]')).toHaveLength(1);
    expect(q('[data-slot]')!.getAttribute('data-slot')).toBe('send');
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(q('textarea'));
  });
});

// FIXES-V3-2 №24a (Prototype v3.1): кинутий у стрічку файл іде в розмову
// одразу — вивантаження і хід без тексту, без чіпа над композитором; поки
// файл над вікном — один оверлей «Кидай — розберу».
describe('№24a · drop у стрічку', () => {
  const dt = (files: File[]) => ({
    types: ['Files'], files,
    items: files.map((f) => ({ kind: 'file', type: f.type, webkitGetAsEntry: () => ({ isDirectory: false }) })),
    dropEffect: 'none',
  });
  const fire = (type: string, transfer: unknown) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer: transfer, clientX: 100, clientY: 100 });
    act(() => { window.dispatchEvent(e); });
  };

  it('над вікном — оверлей; drop → хід із вкладенням без тексту, чіпа нема', async () => {
    await mount();
    const f = new File([new Uint8Array([1])], 'chek.jpg', { type: 'image/jpeg' });
    fire('dragenter', dt([f]));
    expect(q('[data-drop-overlay]')!.textContent).toContain('Кидай — розберу');
    fire('drop', dt([f]));
    // Оверлей гасне одразу, хід іде після вивантаження.
    expect(q('[data-drop-overlay]')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0]!.body.text).toBe('');
    expect(chatCalls[0]!.body.attachments).toEqual([{ id: 'att-new' }]);
    expect(q('[data-att-chip]')).toBeNull();
    expect(q('[data-wait-turn]')).toBeTruthy();
  });

  // Аудит 0913 C.5: onFiles через useCallback(…, []) тримав перший dropFiles —
  // хід ішов із sessionId=null (сервер клав у сесію дня) і повз чергу.
  it('drop після відкриття сесії йде з її session_id, а не з «сесією дня»', async () => {
    await mount();
    const f = new File([new Uint8Array([1])], 'chek.jpg', { type: 'image/jpeg' });
    fire('drop', dt([f]));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0]!.body.session_id).toBe('s1');
  });

  it('drop під час відповіді стає в чергу, а не йде паралельно', async () => {
    await mount();
    await type('привіт'); await submit();
    expect(chatCalls).toHaveLength(1);
    const f = new File([new Uint8Array([1])], 'chek.jpg', { type: 'image/jpeg' });
    fire('drop', dt([f]));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // Поки перша відповідь не прийшла — другого виклику /v1/chat нема.
    expect(chatCalls).toHaveLength(1);
    expect(qa('[data-queued]')).toHaveLength(1);
    await act(async () => {
      waiting[0]!.resolve({ reply: 'ок', card: null, card_id: null });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(chatCalls).toHaveLength(2);
    expect(chatCalls[1]!.body.attachments).toEqual([{ id: 'att-new' }]);
  });
});

// Порожня розмова: <768 — Screens «Чат · порожня розмова · 390» (Пакет 4 №1, Р123):
// заголовок, пʼять чіпів, підказка; чіп кладе текст у композитор і НЕ надсилає.
// ≥768 — Prototype (Р140): вітання в кличному за часом доби, чотири чіпи → чернетка,
// рядок «факт дому», плейсхолдер «друкується». Поріг — matchMedia (max-width: 767px);
// типовий стаб тестів дає matches: true для всього — це мобільна гілка з reduce.
const desktopMedia = (reduce: boolean) => vi.stubGlobal('matchMedia', (mq: string) => ({
  matches: mq.includes('767') ? false : mq.includes('reduced-motion') ? reduce : true,
  media: mq, addEventListener() {}, removeEventListener() {},
}));

describe('Р123 · порожня розмова <768 (Screens 390)', () => {
  it('порожньо: блок є, шість чіпів-довідок; тап → довідка без моделі; блоку Prototype нема', async () => {
    await mount();
    expect(q('[data-empty-hero][data-empty-mobile]')).toBeTruthy();
    expect(q('[data-empty-hero] h2')!.textContent).toBe('Що готуємо — з того, що вже є?');
    // UI-NOTES-0914 п. 6: шість чіпів-довідок замість чотирьох/пʼяти старих.
    expect([...host!.querySelectorAll('[data-empty-chip]')].map((c) => c.getAttribute('data-empty-chip'))).toEqual(['start', 'telegram', 'app', 'list', 'pantry', 'calendar']);
    expect(q('[data-empty-below]')).toBeNull();
    expect(q('[data-empty-hero] h1')).toBeNull();
    expect(q('[data-chat-empty-mobile]'), 'екран у мобільному стані порожньої розмови').toBeTruthy();
    // Тап → дві репліки одразу (підпис чіпа за людину, канон за Кухню), POST /v1/chat/scripted, моделі — нуль.
    await act(async () => { q<HTMLButtonElement>('[data-empty-chip="pantry"]')!.click(); });
    expect(textarea().value).toBe('');
    expect(chatCalls).toHaveLength(0);
    expect(scriptedCalls.map((c) => c.body?.topic)).toEqual(['pantry']);
    const texts = [...host!.querySelectorAll('[id^="turn-"]')].map((t) => t.textContent ?? '');
    expect(texts[0]).toContain('Як працює комора');
    expect(texts[1]).toContain('Комора показує все, що є вдома, по місцях');
  });
  it('плейсхолдер не друкується, лише один hero у DOM', async () => {
    vi.stubGlobal('matchMedia', (mq: string) => ({ matches: !mq.includes('reduced-motion'), media: mq, addEventListener() {}, removeEventListener() {} }));
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(textarea().placeholder.startsWith('Кинь')).toBe(false);
    expect(host!.querySelectorAll('[data-empty-hero]').length).toBe(1);
  });
  it('після першого ходу блок зникає', async () => {
    await mount();
    await type('що на вечерю'); await submit();
    await act(async () => { waiting[0]!.resolve({ reply: 'ось' }); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
    expect(q('[data-empty-hero]')).toBeNull();
    expect(q('[data-chat-empty]')).toBeNull();
  });
});

describe('Р140 · порожня розмова ≥768 за Prototype', () => {
  it('вітання на імʼя в кличному; шість чіпів-довідок; тап → довідка без моделі', async () => {
    desktopMedia(true);
    useAuth.setState({ me: { user: { id: 'u1', name: 'Пилип', email: 'p@x' }, household: { id: 'h1', name: 'Дім', role: 'owner', members: [] }, session_id: 's1' } as never });
    await mount();
    expect(q('[data-empty-mobile]')).toBeNull();
    expect(host!.querySelectorAll('[data-empty-hero]').length).toBe(1);
    expect(q('[data-empty-hero] h1')!.textContent).toBe(greeting('Пилип'));
    expect(q('[data-empty-hero] h1')!.textContent!.startsWith('Пилипе, ')).toBe(true);
    expect(host!.querySelectorAll('[data-empty-chip]').length).toBe(6);
    expect(q('[data-chat-empty]'), 'екран у стані порожньої розмови').toBeTruthy();
    expect(q('[data-chat-empty-mobile]')).toBeNull();
    await act(async () => { q<HTMLButtonElement>('[data-empty-chip="telegram"]')!.click(); });
    expect(textarea().value).toBe('');
    expect(chatCalls).toHaveLength(0);
    expect(scriptedCalls.map((c) => c.body?.topic)).toEqual(['telegram']);
    expect(host!.textContent).toContain('Так, зі мною можна говорити і в Telegram.');
    // Розмова вже не порожня — стан порожнього чату знято.
    expect(q('[data-chat-empty]')).toBeNull();
  });
  it('без імені — без звертання', async () => {
    desktopMedia(true);
    useAuth.setState({ me: null });
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const h1 = q('[data-empty-hero] h1')!.textContent!;
    expect(['Що на вечерю?', 'Що готуємо?']).toContain(h1);
  });
  it('reduced motion — плейсхолдер статичний', async () => {
    desktopMedia(true);
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(textarea().placeholder).toBe('Що зʼявилось удома або що готуємо?');
  });
  it('14.09 (власник): рядок «факт дому» під чіпами порожнього чату знятий повністю', async () => {
    desktopMedia(true);
    library = { recipes: [{}, {}], runs: [{}, {}, {}] };
    batches = [{ id: 'b1', label: 'молоко', state: 'depleted', expires_at: null, days: null }];
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q('[data-empty-fact]')).toBeNull();
    expect(host!.textContent).not.toContain('Решта живе життям');
    // Чіпи-підказки лишаються — прибрано лише рядок факту під ними.
    expect(host!.querySelectorAll('[data-empty-chip]').length).toBeGreaterThan(0);
  });
  it('плейсхолдер друкується з HINTS і зупиняється, щойно є чернетка', async () => {
    desktopMedia(false);
    await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    const ph = textarea().placeholder;
    expect(ph.length).toBeGreaterThanOrEqual(3);
    expect('Кинь чек — розберу'.startsWith(ph)).toBe(true);
    expect(textarea().getAttribute('aria-placeholder')).toBe('Що зʼявилось удома або що готуємо?');
    await type('к');
    const stopped = textarea().placeholder;
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(textarea().placeholder).toBe(stopped);
    expect(stopped.startsWith('Кинь')).toBe(false);
  });
  it('після першого ходу hero і чіпи зникають', async () => {
    desktopMedia(true);
    await mount();
    await type('що на вечерю'); await submit();
    await act(async () => { waiting[0]!.resolve({ reply: 'ось' }); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
    expect(q('[data-empty-hero]')).toBeNull();
    expect(q('[data-empty-below]')).toBeNull();
    expect(q('[data-chat-empty]')).toBeNull();
  });
});

describe('Р148 · мітка каналу', () => {
  it('хід людини з Telegram підписаний «з Telegram», веб-хід — ні', async () => {
    todayMessages = [
      { id: 'm1', session_id: 's1', role: 'user', text: 'Купив молоко', card: null, applied: 0, created_at: '2026-09-06T09:07:00Z', channel: 'telegram' },
      { id: 'm2', session_id: 's1', role: 'user', text: 'І хліб', card: null, applied: 0, created_at: '2026-09-06T09:08:00Z' },
    ];
    await mount();
    const marks = qa('[data-channel="telegram"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('з Telegram');
    expect(marks[0]!.closest('[id^="turn-"]')!.textContent).toContain('Купив молоко');
  });
});

describe('14.09 · шапка чату розчищена (відгук тестувальниці)', () => {
  it('пілюлі сесії (назва розмови), «+ Нова» й чіпа «Чекають на тебе» нема в шапці чату', async () => {
    await mount();
    expect(q('[data-session-pill]')).toBeNull();
    expect(q('[data-new-session]')).toBeNull();
    expect(q('[data-chip-pending]')).toBeNull();
    // Решта шапки лишається: чіп «Дім зараз».
    expect(q('[data-chip-home]')).not.toBeNull();
  });

  it('rail-pill (пігулка артефакта над композитором) не рендериться, коли артефакт відкрито картою, а шторка закрита', async () => {
    // <1200: не «в потоці» — саме той режим, у якому раніше зʼявлялась rail-pill.
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    await mount();
    await type('рецепт'); await submit();
    await act(async () => {
      waiting[0]!.resolve({ reply: 'ось', card: { type: 'recipe_link', recipe_id: 'r1', title: 'Борщ' }, card_id: 'rec-1' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(usePanelStore.getState().active).toBe('rec-1');
    expect(usePanelStore.getState().open).toBe(false); // сервер лише позначив активним, не відкрив шторку сам
    expect(qa('.rail-pill')).toHaveLength(0);
  });

  it('шторка артефакта на мобайлі відкривається тапом по самій картці рецепта («Готуємо»), як і раніше', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    await mount();
    await type('рецепт'); await submit();
    await act(async () => {
      waiting[0]!.resolve({ reply: 'ось', card: { type: 'recipe_link', recipe_id: 'r1', title: 'Борщ' }, card_id: 'rec-1' });
      await new Promise((r) => setTimeout(r, 0));
    });
    const cookBtn = host!.querySelector<HTMLButtonElement>('[data-recipe-stream] button[aria-label="Готуємо"]')!;
    expect(cookBtn).not.toBeNull();
    await act(async () => { cookBtn.click(); });
    expect(usePanelStore.getState().active).toBe('rec-1');
    expect(usePanelStore.getState().open).toBe(true);
  });
});
