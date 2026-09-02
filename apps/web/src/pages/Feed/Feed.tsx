// Стрічка — робочий цикл продукту з тризмісткою карток: intake_diff, proposal,
// shopping, profile. Дизайн ближче до брифу 04 Стрічка: заголовок «Кухня»,
// мета-рядок про стан комори/списку, mono-мітки перед секціями, спокійні
// переходи між станами картки (◌ ОЧІКУЄ → ✓ ЗАСТОСОВАНО → ↩ СКАСОВАНО).

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { plural } from '../../lib/plural';
import { api, type AttachmentUploaded, type ChatCard, type ChatResponse, type MessageInfo } from '../../api';
import { Card, PanelFootSlot, PanelHeadSlot, labelFor, appliedToast } from './cards';
import { isReceipt, pickArtifacts, receiptLines } from './artifacts';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { usePantryStore } from '../../store/pantry';
import { Avatar } from '../../components/Avatar/Avatar';
import { RollingNumber } from '../../components/RollingNumber/RollingNumber';
import { VoiceWave } from '../../components/VoiceWave/VoiceWave';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { speechSupported, startDictation, type Dictation } from '../../lib/speech';
import { loadCookSession, type CookSession } from '../../lib/cook-session';
import { CookCountdown } from '../../lib/cook-watch';
import { stepLabelsFrom } from '../../lib/recipe';
import styles from './Feed.module.css';
import { useCookStore } from '../../store/cook';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  time: string;
  text?: string;
  card?: ChatCard | null;
  cardId?: string | null;
  applied?: boolean;
  applying?: boolean;
  dismissed?: boolean;
  undoToken?: string;
  undone?: boolean;
  // UX9-02: відповідь не прийшла — хід позначений, під ним «↻ Повторити».
  failed?: boolean;
  // Моушн-кіт §02: щойно отримана відповідь з'являється «чанками по фразі».
  // Історичні ходи (F5, зміна сесії) — без цього, інакше стрічка мерехтить.
  fresh?: boolean;
  // Пул-7 №4: щойно застосована — картка спалахує шавлією 700ms.
  justApplied?: boolean;
  // M13 (канвас М6): «список щойно поповнився рецептом» — Кухня пропонує
  // зібрати кошик реплікою. Ephemeral: не персиститься на сервер, живе
  // тільки в цій сесії стрічки (як toast) — старий хід при F5 не воскресає.
  cartNudge?: boolean;
  cartNudgeBusy?: boolean;
}

// Фрази для стрімінг-подачі: розріз по кінцях речень, коротке лишається цілим.
function splitPhrases(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return parts.length ? parts : [text];
}

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
  onUndo?: () => void;
  // Тост живе до setToast(null). Undo timeout — 18с (людина може відволіктись
  // на екран; 6с — не встигає). «Готую рецепт…» — persist:true, поки
  // openingRecipe не спаде до false.
  persist?: boolean;
}

function hhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function messageToTurn(m: MessageInfo): Turn {
  const d = new Date(m.created_at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const applied = m.applied > 0;
  return {
    id: newId(),
    role: m.role,
    time,
    text: m.text ?? undefined,
    card: m.card,
    cardId: m.card ? m.id : null,     // message.id === card_id за нашою інваріантою
    applied,
    // undoToken на клієнті не відновлюємо — apply вже пройшов, повторний
    // apply/undo вимагатимуть нового токена. Кнопки undo після F5 нема.
  };
}

let nextId = 1;
const newId = () => `t${nextId++}`;

export function Feed() {
  const meName = useAuth((st) => st.me?.user?.name ?? null);
  const navigate = useNavigate();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [shoppingCount, setShoppingCount] = useState<number>(0);
  // M13 (канвас М6): чи можна пропонувати «зібрати кошик» — мережа активна.
  // cartNudgeShown — раз за сесію стрічки, не на кожен доданий інгредієнт.
  const [retailActive, setRetailActive] = useState(false);
  const cartNudgeShown = useRef(false);
  // shoppingCount у стейті застарілий одразу після await refreshCounts()
  // (React ще не перерендерив) — ref синхронізується в тому ж місці.
  const shoppingCountRef = useRef(0);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // DA-02: дев'ять секунд тиші на кожну відповідь моделі. Кіт: три крапки зі
  // stagger 150ms, мітка «КУХНЯ · <дієслово>» — завжди з дієсловом.
  const [thinkingVerb, setThinkingVerb] = useState('ДУМАЮ');
  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [staleBatches, setStaleBatches] = useState<{ id: string; label: string; days: number }[]>([]);
  // Моушн-2 №4: рядок rail, що змінився після apply/готування — флеш шавлією.
  const [railFlash, setRailFlash] = useState<Set<string>>(new Set());
  const prevStale = useRef<Map<string, number>>(new Map());
  const [batchLabels, setBatchLabels] = useState<Map<string, string>>(new Map());
  // №4а: кроки рецептів у стрічці — тільки product.
  const [stepLabels, setStepLabels] = useState<Map<string, string>>(new Map());
  const [toast, setToast] = useState<Toast | null>(null);
  const [openingRecipe, setOpeningRecipe] = useState(false);
  const [pending, setPending] = useState<AttachmentUploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  // Правка №8: авторіст textarea від вмісту (і від диктовки, яка пише в
  // input повз onChange) — 1→8 рядків, далі внутрішній скрол.
  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 8 * 22 + 16)}px`;
  }, [input]);

  // #9: голосовий ввід. Кнопка є лише там, де браузер уміє SpeechRecognition;
  // interim-текст летить прямо в поле, щоб людина бачила, що її чують.
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);
  function toggleVoice() {
    if (listening) {
      dictationRef.current?.stop();
      return;
    }
    // QA9-07: диктовка ДОПИСУЄ до вже набраного, а не затирає його.
    const base = input.trim();
    const join = (t: string) => (base ? `${base} ${t}` : t);
    const d = startDictation({
      onText: (t) => setInput(join(t)),
      onDone: (t) => setInput(join(t)),
      onEnd: () => { setListening(false); dictationRef.current = null; composerInputRef.current?.focus(); },
      // UX9-08: заборонений мікрофон / мережа — раніше кнопка тихо гасла.
      onError: (msg) => setToast({ id: Date.now(), kind: 'err', text: msg }),
    });
    if (d) { dictationRef.current = d; setListening(true); }
  }

    // «Уточнити» на пропозиції: префілимо композитор назвою страви з тире —
  // відповідь механічно привʼязана до неї. Прототипний startRefine.
  // Бриф-3 п.2: перерване готування живе — рядок над таймлайном веде назад
  // на той самий крок. Перечитуємо при поверненні фокуса (могло завершитись
  // в іншій вкладці).
  const cookArgs = useCookStore((s) => s.args);
  const [cookLive, setCookLive] = useState<CookSession | null>(() => loadCookSession());
  useEffect(() => {
    setCookLive(loadCookSession());
    const onVis = () => setCookLive(loadCookSession());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
    // Поп-ап закрився без навігації — банер оживає одразу.
  }, [cookArgs]);

    // «+ Імпорт» з екрана Рецептів приходить сюди з префіксом — той самий
  // механізм, що startRefine: композитор веде, канал вводу один.
  const location = useLocation();
  useEffect(() => {
    const prefix = (location.state as { composePrefix?: string } | null)?.composePrefix;
    if (prefix) {
      setInput(prefix);
      composerInputRef.current?.focus();
      // Чистимо state, щоб F5 не префіксив удруге.
      window.history.replaceState({}, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    // «☆ На потім» просто зі стрічки: чернетка вже має адресу — це PATCH-позначка.
  const [savedRecipeIds, setSavedRecipeIds] = useState<Set<string>>(new Set());
  // «+ у список» з рецепта-повідомлення: пише напряму (людина, не модель).
  async function addNeedToList(label: string, v: number | undefined, u: string | undefined, forDish: string) {
    try {
      await api.shopping.add(label, v, u, `для: ${forDish}`);
      await refreshCounts();
      maybeNudgeCart();
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  // M13 (канвас М6): «список щойно поповнився рецептом» — Кухня пропонує
  // зібрати кошик реплікою, а не постійним блоком («інформація — репліка»).
  // Раз за сесію стрічки (ref, не sessionStorage — навмисно: новий візит у
  // стрічку може знову мати сенс нагадати, на відміну від синку чеків).
  function maybeNudgeCart() {
    const count = shoppingCountRef.current;
    if (cartNudgeShown.current || !retailActive || count <= 0) return;
    cartNudgeShown.current = true;
    setTurns((prev) => [...prev, {
      id: newId(), role: 'assistant',
      time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
      text: `У списку ${count} ${plural(count, ['позиція', 'позиції', 'позицій'])}, Сільпо підключено. Зібрати кошик — гляну ціни й наявність?`,
      cartNudge: true, fresh: true,
    }]);
  }

  async function acceptCartNudge(turnId: string) {
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, cartNudgeBusy: true } : t));
    try {
      const r = await api.retail.buildCart();
      setTurns((prev) => [
        ...prev.map((t) => t.id === turnId ? { ...t, cartNudge: false, cartNudgeBusy: false } : t),
        {
          id: newId(), role: 'assistant',
          time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
          text: `Кошик у Сільпо: знайшов ${r.card.found} з ${r.card.of}`,
          card: r.card, cardId: r.card_id, fresh: true,
        },
      ]);
    } catch (err) {
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, cartNudgeBusy: false } : t));
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  function dismissCartNudge(turnId: string) {
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, cartNudge: false } : t));
  }

    async function saveRecipeForLater(recipe_id: string) {
    try {
      await api.savedRecipes.setSaved(recipe_id, true);
      setSavedRecipeIds((prev) => new Set(prev).add(recipe_id));
      setToast({ id: Date.now(), kind: 'ok', text: 'У рецептах — підсвітиться, коли все буде в коморі' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

    function startRefine(title: string) {
    setInput(`${title} — `);
    composerInputRef.current?.focus();
  }

  // Черга Г (№3): дані правої панелі — незакриті картки дому і неоцінене
  // недавнє готування. Живуть поруч із лічильниками й оновлюються разом.
  const [housePending, setHousePending] = useState<{ id: string; type: string; session_id: string | null }[]>([]);
  // Пул-6 №2: rail згортається. Нижче 1200 панелі немає — там шторка,
  // яку відкриває пігулка; ≥1200 панель у потоці, і ‹ її ховає в смужку
  // 56px (стан памʼятається).
  const [railOpen, setRailOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(() => {
    try { return localStorage.getItem('kos-rail-hidden') === '1'; } catch { return false; }
  });
  function setRailHiddenPersist(v: boolean) {
    setRailHidden(v);
    try { localStorage.setItem('kos-rail-hidden', v ? '1' : '0'); } catch { /* ок */ }
  }

  // ── Крок 1.3: ручка ресайзу (V1 + V9) ────────────────────────────────
  // Межі з брифу: 280 (нижче ламається рядок кошика) … 560 (вище журнал
  // стає вужчим за 640). Стеля залежить від вікна: накладні в нас 276,
  // мінімум журналу 640, отже панель не може бути ширшою за vw − 916.
  const RAIL_MIN = 280;
  const RAIL_MAX = 560;
  const RAIL_DEFAULT = 320;
  const RAIL_OVERHEAD = 916;  // 276 накладних + 640 мінімум журналу
  const [railWidth, setRailWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem('kos-rail-width'));
      return Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX ? v : RAIL_DEFAULT;
    } catch { return RAIL_DEFAULT; }
  });
  const [dragging, setDragging] = useState(false);
  // Крок 1.2: три зони панелі. Низ картки їде в цей вузол через портал —
  // сама картка лишається цілим компонентом зі своїм станом.
  const [footSlot, setFootSlot] = useState<HTMLElement | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  // V9: тінь над закріпленим низом — не декор. Вона з'являється, лише коли
  // під згином є ще вміст, і зникає на верхівках — так смуга сама каже,
  // чи дочитано до кінця.
  const [bodyScrolled, setBodyScrolled] = useState(false);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [bodyContentEl, setBodyContentEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bodyEl) return;
    // Заміряємо НА НАСТУПНОМУ КАДРІ, а не в момент події. ResizeObserver
    // будить нас посеред перерозкладки: коли відкривається шторка, він
    // спрацьовує на проміжному розмірі й більше не повторюється — тінь
    // застрягала увімкненою на вмісті, який насправді влазить цілком
    // (заміряно: предикат false, а тінь горить). rAF відкладає замір до
    // моменту, коли розкладка вже сіла.
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBodyScrolled(
        bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 1,
      ));
    };
    check();
    // Ще один замір після осідання. ResizeObserver звітує РОЗМІР, який
    // бачив у тій самій розкладці; дрібне осідання після неї (шрифти,
    // останні 4px висоти) він уже не помічає, і тінь лишається від
    // проміжного кадру. Заміряно: вміст 523 → 519, предикат перевернувся,
    // тінь не змінилась.
    const settle = window.setTimeout(check, 250);
    bodyEl.addEventListener('scroll', check, { passive: true });
    // Самого onScroll мало: вміст росте мовчки. Розкрив альтернативи —
    // висота стрибнула, події скролу не було, і тінь брехала б, що читати
    // більше нема чого. Тому ще й ResizeObserver на самому вмісті.
    const ro = new ResizeObserver(check);
    ro.observe(bodyEl);
    if (bodyContentEl) ro.observe(bodyContentEl);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      bodyEl.removeEventListener('scroll', check);
      ro.disconnect();
    };
    // railOpen і ключ артефакта — теж залежності: коли відкривається шторка
    // або перемикається вкладка, розкладка змінюється цілком, а самі вузли
    // лишаються ті самі. Без них ефект не перезапускався, і тінь на секунду
    // застрягала від попередньої розкладки (заміряно на шторці: предикат
    // false, тінь горить).
  }, [bodyEl, bodyContentEl, railOpen]);
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // V9 «затиск — не запис»: коли вікно завузьке, панель стискається, але
  // збережене число НЕ перезаписується — інакше одне випадкове звуження
  // вікна назавжди відбирало б у людини її ширину. Перезаписує лише драг.
  const railCeiling = Math.max(RAIL_MIN, Math.min(RAIL_MAX, vw - RAIL_OVERHEAD));
  const railEffective = Math.min(railWidth, railCeiling);

  function persistRailWidth(px: number) {
    setRailWidth(px);
    try { localStorage.setItem('kos-rail-width', String(px)); } catch { /* ок */ }
  }
  // Подвійне натискання рахуємо САМІ, а не через onDoubleClick. Браузер
  // його не дає: setPointerCapture перехоплює вказівник, і сумісний click
  // не синтезується — а без click немає й dblclick. Заміряно на видимій
  // вкладці: дабл-клік по ручці не робив нічого.
  const lastDown = useRef(0);
  function onHandleDown(e: React.PointerEvent<HTMLDivElement>) {
    const now = Date.now();
    const isDouble = now - lastDown.current < 400;
    lastDown.current = now;
    if (isDouble) {
      persistRailWidth(RAIL_DEFAULT);
      return;   // друге натискання не починає драг
    }
    // БЕЗ preventDefault: він глушить сумісні мишачі події. Виділення тексту
    // під час драгу знімає user-select: none на .rail-dragging — перевірено
    // справжнім драгом, виділяється нуль символів.
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = railEffective;
    setDragging(true);
    let last = startW;
    const move = (ev: PointerEvent) => {
      // Панель праворуч: тягнемо ВЛІВО — ширшає.
      last = Math.round(Math.max(RAIL_MIN, Math.min(railCeiling, startW - (ev.clientX - startX))));
      setRailWidth(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      persistRailWidth(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  // Крок 1.1 (02.09): поріг 1200, синхронно з CSS. Число заміряне, не взяте
  // з брифу: накладні в нас 276 (меню 232 + падінги журналу 22+22), а не 232,
  // тож 276 + 640 + 280 = 1196. Мусить збігатися з медіазапитами у
  // Feed.module.css — інакше повторюється помилка, коли JS звіряв 1280,
  // а CSS уже 1440, і «›» знімала railHidden з панелі, якої там не існувало.
  function miniRailClick() {
    if (window.matchMedia(RAIL_IN_FLOW).matches) setRailHiddenPersist(false);
    else setRailOpen(true);
  }
  function railCollapse() {
    if (window.matchMedia(RAIL_IN_FLOW).matches) setRailHiddenPersist(true);
    else setRailOpen(false);
  }
  // Крок 2: кошик — ОДНЕ повідомлення, два подання. У стрічці воно
  // згортається в моно-слід, у панелі рендериться повністю. Актуальний —
  // ОСТАННІЙ: кошик у Сільпо один, і попередні картки вже не про нього.
  // Крок 3б: вкладки. Зʼявляються ЛИШЕ з другим артефактом — при одному
  // шапка просто називає його. Заміщення, не накопичення: кошик у Сільпо
  // один, рецепт завжди останній, тож більше двох тут не буває.
  const [closedArtifacts, setClosedArtifacts] = useState<Set<string>>(new Set());
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null);
  // Крок 1.4: у згорнутій смузі — активний маркер і «інші» списком по тапу.
  const [miniListOpen, setMiniListOpen] = useState(false);
  // Вибір артефактів живе в ./artifacts і покритий тестом: перевірити його
  // на екрані можна лише тоді, коли в сесії випадково є потрібна картка,
  // а чек мережі трапляється раз на похід у магазин.
  const artifacts = pickArtifacts(turns);
  const latestCart = artifacts.find((a) => a.key === 'cart')?.turn;
  const latestRecipe = artifacts.find((a) => a.key === 'recipe')?.turn;
  const latestReceipt = artifacts.find((a) => a.key === 'receipt')?.turn;
  const openArtifacts = artifacts.filter((a) => !closedArtifacts.has(a.key));
  const shownArtifact = openArtifacts.find((a) => a.key === activeArtifact) ?? openArtifacts[0];
  const RAIL_IN_FLOW = '(min-width: 1200px)';
  // Слід у стрічці — це не якір, а відкриття. Після ✕ артефакт зникає з
  // панелі, і скрол по id вів би в порожнечу: кнопка виглядала б робочою,
  // а не робила б нічого. Тому спершу повертаємо його в панель, і лише
  // потім скролимо — вже до того, що напевно існує.
  function openArtifact(key: string) {
    setClosedArtifacts((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setActiveArtifact(key);
    // Нижче 1200 панелі в потоці немає — там артефакт живе у шторці
    // знизу. Один і той самий слід мусить відкривати те, що на цій
    // ширині справді існує.
    if (window.matchMedia(RAIL_IN_FLOW).matches) {
      // Панель згорнута в смугу — розгортаємо. Тап по сліду це явне
      // прохання побачити артефакт; лишати панель згорнутою означало б,
      // що слід підсвітився «відкрито», а не відкрилось нічого.
      // Правилу V8 «панель ніколи не згортається сама» це не суперечить:
      // воно про НОВИЙ артефакт, який не має розгортати панель поверх
      // читання, а не про явний тап людини.
      setRailHiddenPersist(false);
    } else {
      setRailOpen(true);
    }
    requestAnimationFrame(() => {
      document.getElementById(`rail-${key}`)?.scrollIntoView({ block: 'nearest' });
    });
  }
  // Перемикання вкладки міняє вміст тіла повністю. Вузли ті самі, тож ані
  // ResizeObserver, ані ефект вище про це не дізнаються — штовхаємо перевірку
  // тіні вручну. Оголошено тут, а не в тому ефекті: shownArtifact існує
  // нижче за нього.
  useEffect(() => {
    if (!bodyEl) return;
    const id = requestAnimationFrame(() => setBodyScrolled(
      bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 1,
    ));
    return () => cancelAnimationFrame(id);
  }, [bodyEl, shownArtifact?.key]);
  // «Інші» — усе, крім того, що відкриється від «›». Закритий артефакт
  // зі списку зникає; лишився один — кнопка «інші» зникає; не лишилось
  // жодного — зникає вся смуга (нижче, через hasPanel).
  const miniOthers = openArtifacts.filter((a) => a.key !== shownArtifact?.key);
  // V8·A: порожня сесія — панелі НЕМА ВЗАГАЛІ. Ані колонки, ані згорнутої
  // смуги, ані ручки: порожня панель читається як «тут щось зламалось»
  // або як дашборд, від якого ми відмовились. Pending поки теж тримає
  // панель — він єдиний блок зрізу, що лишився.
  const hasPanel = openArtifacts.length > 0 || housePending.length > 0;
  function closeArtifact(key: string) {
    // Артефакт не вмирає — він і далі повідомлення у стрічці, і слід повертає
    // його тапом. Тому ✕ не потребує підтвердження.
    setClosedArtifacts((prev) => new Set(prev).add(key));
    setActiveArtifact(null);
  }

  async function refreshCounts() {
    try {
      // Крок 1.4: cookRuns звідси прибрано разом із маркером «★ оцінити»
      // у смузі. Він лишався write-only станом — читати його вже нікому:
      // «оціни вчорашнє» стало реплікою Кухні на початку сесії (modes.ts),
      // а не блоком у панелі. Разом із ним пішов і зайвий запит на кожен
      // refreshCounts.
      const [p, s, pend] = await Promise.all([
        api.pantry(),
        api.shopping.list().catch(() => ({ count: 0 })),
        api.cards.pending().catch(() => ({ cards: [] as { id: string; type: string; session_id: string | null; created_at: string | null }[] })),
      ]);
      setHousePending(pend.cards);
      setPantryCount(p.count);
      // Пул-5 №5: сайдбар теж дізнається про свіжий лічильник — bump скидає
      // його кеш і TabBar перечитує (патерн useSessionStore).
      usePantryStore.getState().bump();
      // Мапа id→label: рецепт-повідомлення показує «Вершки 33%», а не «з комори».
      setBatchLabels(new Map(p.batches.map((b) => [b.id, b.label])));
      setStepLabels(stepLabelsFrom(p.batches, p.products));
      setShoppingCount(s.count);
      shoppingCountRef.current = s.count;
      // Догоряння: беремо активні партії з expires_at ≤ 3 днів. Показуємо 3 перших.
      // Це «підказка одним рядком», не панель — юзер може її ігнорувати або тапнути,
      // щоб модель сама запропонувала, що з ними зробити.
      const now = Date.now();
      const stale = p.batches
        .filter((b) => b.state !== 'depleted' && b.expires_at)
        .map((b) => ({
          id: b.id,
          label: b.label,
          days: Math.round((new Date(b.expires_at!).getTime() - now) / 86_400_000),
        }))
        .filter((b) => b.days <= 3)
        .sort((a, b) => a.days - b.days)
        .slice(0, 3);
      {
        // Флеш рядків rail, чиї дні змінились (готування/списання зачепило партію).
        const prev = prevStale.current;
        if (prev.size) {
          const changed = new Set(stale.filter((b) => prev.has(b.id) && prev.get(b.id) !== b.days).map((b) => b.id));
          if (changed.size) {
            setRailFlash(changed);
            window.setTimeout(() => setRailFlash(new Set()), 800);
          }
        }
        prevStale.current = new Map(stale.map((b) => [b.id, b.days]));
      }
      setStaleBatches(stale);
    } catch { /* offline: лишаємо старе значення */ }
  }

  useEffect(() => { void refreshCounts(); }, []);
  // M13: чи підключена мережа — гейтить репліку «зібрати кошик?» нижче.
  useEffect(() => {
    void api.retail.status().then((r) => setRetailActive(r.silpo.status === 'active')).catch(() => {});
  }, []);

  // UX9-15: застарілі лічильники другого вікна — перечитуємо на фокусі.
  useEffect(() => {
    const refetch = () => { void refreshCounts(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      window.removeEventListener('focus', refetch);
      document.removeEventListener('visibilitychange', refetch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sessionId, setSessionId] = useState<string | null>(null);
  // Правка №1: сайдбар знає активну сесію і перечитує список, коли тут
  // щось міняється.
  const sessionStore = useSessionStore();
  const cookOpen = useCookStore((s) => s.open);
  function activate(id: string | null) {
    setSessionId(id);
    sessionStore.setActive(id);
  }

  useEffect(() => {
    // Гідратуємо стрічку з сесії дня. Показуємо кожне message як окремий turn.
    // Cards із applied>0 показуються в стані «застосовано» (без Apply-кнопки).
    // Правка №1: якщо прийшли з сайдбара/бібліотеки з конкретною сесією —
    // location-ефект нижче переграє це завантаження.
    (async () => {
      try {
        const { session, messages } = await api.session.today();
        activate(session.id);
        setTurns(messages.map((m) => messageToTurn(m)));
      } catch {/* offline: залишаємо порожню стрічку */}
      // M13: тихий синк чеків при відкритті стрічки. Не частіше ніж раз на
      // 10 хв (sessionStorage), 409 «не підключено» — мовчазний no-op:
      // «інформація — репліка», порожній синк не породжує жодного UI.
      try {
        const last = Number(sessionStorage.getItem('kos_retail_sync_at') ?? 0);
        if (Date.now() - last < 10 * 60_000) return;
        sessionStorage.setItem('kos_retail_sync_at', String(Date.now()));
        const sync = await api.retail.syncReceipts();
        if (!sync.cards.length) return;
        // Нові картки — свіжими ходами в кінець стрічки, з живим undo.
        setTurns((prev) => [
          ...prev,
          ...sync.cards.map((c): Turn => ({
            id: newId(), role: 'assistant',
            time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
            text: c.text,
            card: c.card, cardId: c.card_id,
            applied: c.auto_applied, undoToken: c.undo_token,
            fresh: true, justApplied: c.auto_applied,
          })),
        ]);
      } catch {/* не підключено / мережа — стрічка живе як жила */}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startFreshSession() {
    try {
      const { session } = await api.session.fresh();
      activate(session.id);
      setTurns([]);
      setHistoryOpen(false);
      sessionStore.bump();
    } catch {/* тихо: наступним разом */}
  }

  const [historyOpen, setHistoryOpen] = useState(false);
  // Моушн-2 №6: скрол кожної вкладки живе окремо і відновлюється при поверненні.
  const segScroll = useRef<{ t: number; h: number }>({ t: 0, h: 0 });
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollTop = segScroll.current[historyOpen ? 'h' : 't'];
  }, [historyOpen]);
  const [historySessions, setHistorySessions] = useState<{ id: string; title: string | null; day: string; created_at: string; message_count: number }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const { sessions } = await api.session.list();
      // Не показуємо порожні сесії — свіжі, куди юзер не встиг нічого написати.
      setHistorySessions(sessions.filter((s) => s.message_count > 0));
    } catch {/* тихо */}
    finally { setHistoryLoading(false); }
  }
  async function loadHistorySession(id: string) {
    try {
      const { session, messages } = await api.session.get(id);
      activate(session.id);
      setTurns(messages.map((m) => messageToTurn(m)));
      setHistoryOpen(false);
    } catch {/* тихо */}
  }

  // Правка №1: команди з сайдбара (і №10/11 — з бібліотеки/журналу) приходять
  // через location.state. `at` — щоб повторний клік по тому ж пункту
  // спрацьовував знову.
  useEffect(() => {
    const st = location.state as { sessionId?: string; freshSession?: boolean; openHistory?: boolean; at?: number } | null;
    if (!st) return;
    if (st.sessionId) void loadHistorySession(st.sessionId);
    else if (st.freshSession) void startFreshSession();
    else if (st.openHistory) void openHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // QA8-04: smooth-скрол у цьому контейнері мовчки не працював (виміряно:
  // scrollTop лишався 0), і вимір scrollHeight ішов до розкладки високого
  // блока рецепта. useLayoutEffect + rAF міряють ПІСЛЯ розкладки, скрол
  // миттєвий — людина бачить нову відповідь, а не порожнечу за кадром.
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [turns]);

  // Keyboard shortcuts на десктопі:
  //   Ctrl+K / Cmd+K — фокус у композитор (як у Slack/Linear/Notion — універсальний
  //     жест для «швидко почати вводити»)
  //   Ctrl+Enter / Cmd+Enter в композиторі — Apply на найновішу unapplied+undone
  //     картку (щоб не тягнути мишу до карток після кожного «купив X»)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        composerInputRef.current?.focus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const target = [...turns].reverse().find((t) => t.card && !t.applied && !t.undone && t.cardId);
        if (target) {
          e.preventDefault();
          void apply(target.id);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast || toast.persist) return;
    // Undo toast — довше вікно (людина може прочитати й натиснути).
    // Успіх без undo — 5с, помилка — 8с. «Готую рецепт…» — persist до кінця.
    // Моушн-кіт: тост auto 4с, з undo — 8с. 18с висіло як бажання «дати
    // більше часу», але дизайн свідомо тримає ритм — undo є і в журналі.
    const ttl = toast.onUndo ? 8_000 : (toast.kind === 'err' ? 8_000 : 4_000);
    const t = setTimeout(() => setToast(null), ttl);
    return () => clearTimeout(t);
  }, [toast]);

  // Пул-2 №4: простиня з буфера (інвентар, довгий список) не мусить іти
  // чат-конвеєром — він обрізається стелею відповіді. Вставка >1500 символів
  // з переносами сама стає TXT-вкладенням і їде парс-конвеєром (haiku, t=0).
  async function pasteAsAttachment(text: string) {
    setUploading(true);
    try {
      const file = new File([text], 'вставка.txt', { type: 'text/plain' });
      const rec = await api.attachments.upload(file);
      setPending((p) => [...p, rec]);
      setToast({ id: Date.now(), kind: 'ok', text: 'Великий список поїде вкладенням — так він не загубиться' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function pickFiles(list: FileList | File[] | null) {
    if (!list || !('length' in list) || !list.length) return;
    if (pending.length + list.length > 5) {
      setToast({ id: Date.now(), kind: 'err', text: 'Максимум 5 вкладень за раз' });
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const rec = await api.attachments.upload(file);
        setPending((p) => [...p, rec]);
      }
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Моушн-2 №2: видалення чіпа — колапс 250ms exit, потім геть з DOM.
  const [leavingAtt, setLeavingAtt] = useState<Set<string>>(new Set());
  function removePending(id: string) {
    setLeavingAtt((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setPending((p) => p.filter((x) => x.id !== id));
      setLeavingAtt((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, 250);
  }

  // UX9-02: серцевина відправки — спільна для першої спроби і «↻ Повторити».
  // Помилка більше не ковтається: хід позначається failed, під ним кнопка
  // повтору, тост пояснює людською мовою.
  async function dispatchChat(text: string, attachments: { id: string }[], retryTurnId?: string) {
    setSending(true);
    setThinkingVerb(attachments.length ? 'РОЗБИРАЮ' : 'ДУМАЮ');

    let turnId = retryTurnId;
    if (!turnId) {
      const userTurnText = text || (attachments.length === 1 ? '[вкладення]' : `[${attachments.length} вкладення]`);
      const userTurn: Turn = { id: newId(), role: 'user', time: hhmm(), text: userTurnText };
      turnId = userTurn.id;
      setTurns((prev) => [...prev, userTurn]);
    } else {
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, failed: false } : t)));
    }

    try {
      const res: ChatResponse = await api.chat({ text, attachments: attachments.length ? attachments : undefined, session_id: sessionId ?? undefined });
      const turn: Turn = {
        id: newId(),
        role: 'assistant',
        fresh: true,
        time: hhmm(),
        text: res.reply || undefined,
        card: res.card,
        cardId: res.card_id,
        // Пул-8 №2: intake-картка приходить уже застосованою — показуємо як
        // звіт зі «Скасувати», без «Застосувати/Ні».
        ...(res.auto_applied ? { applied: true, justApplied: true, undoToken: res.undo_token } : {}),
      };
      setTurns((prev) => [...prev, turn]);
      if (res.followup) {
        setTurns((prev) => [...prev, { id: newId(), role: 'assistant', time: hhmm(), fresh: true, text: res.followup! }]);
      }
      if (res.auto_applied) {
        await refreshCounts();
        setToast({
          id: Date.now(),
          kind: 'ok',
          text: res.card ? appliedToast(res.card) : 'Готово',
          onUndo: res.undo_token && res.card_id
            ? () => undo(turn.id, res.undo_token!)
            : undefined,
        });
      }
      // Правка №1: перша репліка дала сесії назву — сайдбар перечитає список.
      sessionStore.bump();
    } catch (err) {
      const raw = (err as Error).message;
      const human = raw === 'model_unavailable'
        ? 'Кухня зараз не відповідає — спробуй ще раз за хвилину.'
        : raw;
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, failed: true } : t)));
      setToast({ id: Date.now(), kind: 'err', text: human });
    } finally {
      setSending(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text && pending.length === 0) return;
    setInput('');
    const attachments = pending.map((p) => ({ id: p.id }));
    setPending([]);
    // Пул-7 №2: фокус лишається в полі — наступне повідомлення без кліку.
    composerInputRef.current?.focus();
    await dispatchChat(text, attachments);
  }

  async function apply(turnId: string, selected?: number[]) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId || turn.applying) return;
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: true } : t));
    try {
      const r = await api.cards.apply(turn.cardId, selected);
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? { ...t, applied: true, applying: false, undoToken: r.undo_token, justApplied: true }
        : t,
      ));
      // Правка №6: застосована пост-кук картка списання продовжує розмову
      // детермінованим «Як вийшло?» — сервер уже записав його в сесію,
      // нам лишається показати хід без перезавантаження історії.
      if (r.followup) {
        setTurns((prev) => [...prev, { id: newId(), role: 'assistant', time: hhmm(), fresh: true, text: r.followup! }]);
      }
      // Оновлюємо лічильники для комори/списку — profile тепер теж може змінити те, що показуємо
      await refreshCounts();
      setToast({
        id: Date.now(),
        kind: 'ok',
        text: turn.card ? appliedToast(turn.card, r.applied) : 'Готово',
        onUndo: () => undo(turnId, r.undo_token),
      });
    } catch (err) {
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: false } : t));
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  function dismissCard(turnId: string) {
    // «Ні» на пропозиції — локальне відхилення в межах вкладки. Не переживає
    // F5 (для цього треба POST /v1/cards/:id/dismiss + поле в БД, окрема
    // задача). Мінімум — кнопка мусить хоч би реагувати.
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, dismissed: true } : t));
  }

  async function openRecipe(turn: Turn, index = 0) {
    // Клік «Рецепт →» на пропозиції: беремо title обраної страви як seed
    // для генератора. Раніше UI показував кнопку лише на першій, а Feed
    // жорстко брав items[0] — 2/3 пропозицій були недосяжні.
    if (turn.card?.type !== 'proposal') return;
    const items = (turn.card.items as { title?: string; desc?: string }[] | undefined) ?? [];
    const pick = items[index];
    if (!pick?.title) return;
    setOpeningRecipe(true);
    setToast({ id: Date.now(), kind: 'ok', text: 'Готую рецепт…', persist: true });
    try {
      const { id, recipe, reply } = await api.recipes.generate(pick.title, pick.desc, sessionId ?? undefined);
      setToast(null);
      if (!recipe) {
        // Модель відповіла прозою замість рецепта — зазвичай бо запит
        // неоднозначний («меню на 6 осіб»). Показуємо як репліку кухаря
        // у стрічці, щоб людина могла уточнити.
        setTurns((prev) => [...prev, {
          id: newId(), role: 'assistant', time: hhmm(), fresh: true,
          text: reply || 'Не вийшло скласти рецепт. Спробуй сформулювати конкретніше.',
        }]);
        return;
      }
      // Рішення Пилипа: рецепт — хід розмови, а не екран. Він з'являється
      // в стрічці цілком (сервер уже записав повідомлення — F5 тримає);
      // повторний тап по тій самій назві поверне ТОЙ САМИЙ рецепт (dedupe).
      if (id) {
        // QA8-01: сервер тепер ідемпотентний за запитаною назвою — повторний
        // тап повертає той самий id. Якщо рецепт уже в стрічці, не дублюємо
        // хід, а скролимо до нього: людина бачить, куди дивитись.
        const existing = turns.find((t) => t.card?.type === 'recipe_link' && t.card.recipe_id === id);
        if (existing) {
          document.getElementById(`turn-${existing.id}`)?.scrollIntoView({ block: 'center' });
          return;
        }
        setTurns((prev) => [...prev, {
          id: newId(), role: 'assistant', time: hhmm(), fresh: true,
          card: { type: 'recipe_link', recipe_id: id, title: recipe.t, recipe },
        }]);
      } else {
        // Аварійний шлях без id (не мало б статись) — старий екран.
        navigate('/recipe', { state: { recipe } });
      }
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setOpeningRecipe(false);
    }
  }

  async function undo(turnId: string, undoToken: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId) return;
    try {
      await api.cards.undo(turn.cardId, undoToken);
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, undone: true } : t));
      await refreshCounts();
      setToast({ id: Date.now(), kind: 'ok', text: 'Скасовано' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  return (
    <div
      className={`${styles.screen} ${railHidden ? styles['rail-off'] : ''} ${!hasPanel ? styles['rail-none'] : ''} ${dragging ? styles['rail-dragging'] : ''}`}
      style={{ ['--rail-w' as string]: `${railEffective}px` }}
    >
      <div className={styles.head}>
        <div className={styles['head-left']}>
          {/* DA-29: хендоф дає шапці заголовок «Кухня», не вордмарк — бренд
              живе на вході й іконці. DA-05: обидва лічильники поруч. */}
          <div style={{ fontFamily: 'var(--font-display, var(--font-body))', fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--fg-strong)' }}>
            Кухня
          </div>
        </div>
        <div className={styles['head-actions']}>
          {pantryCount !== null && (
            <MonoLabel className={styles['head-meta']}>
              {/* Моушн-кіт §03: цифра прокручується вертикально при зміні. */}
              КОМОРА <RollingNumber value={pantryCount} />
              {shoppingCount > 0 && <> · СПИСОК <RollingNumber value={shoppingCount} /></>}
            </MonoLabel>
          )}
          <Avatar name={meName} />
        </div>
      </div>

      {/* Бриф-2 п.2: журнал сесій — сегментом «Історія» (мобайл; на десктопі
          сесії в сайдбарі, сегменти сховані CSS-ом). */}
      <div className={styles.segments}>
        <button
          onClick={() => setHistoryOpen(false)}
          className={!historyOpen ? styles['seg-active'] : styles.seg}
        >Сьогодні</button>
        <button
          onClick={openHistory}
          className={historyOpen ? styles['seg-active'] : styles.seg}
        >Історія</button>
        {/* Пул-4 №5: «+ Нова» — дія того ж рангу, що сегменти сесій; аватар
            лишається сам у куті (плутанина «профіль поруч із +» знята). */}
        <button
          onClick={startFreshSession}
          className={`${styles.seg} ${styles['seg-new']}`}
        >+ Нова</button>
      </div>


      {/* Моушн-2 №6: перемикання Сьогодні⇄Історія — crossfade + X±10 (key
          перемонтовує контейнер), скрол-позиція кожної вкладки пам'ятається. */}
      <div
        key={historyOpen ? 'history' : `today:${sessionId ?? ''}`}
        className={`${styles.timeline} ${historyOpen ? styles['seg-view-hist'] : styles['seg-view-today']}`}
        ref={timelineRef}
        onScroll={(e) => { segScroll.current[historyOpen ? 'h' : 't'] = e.currentTarget.scrollTop; }}
      >
        {/* Пул-2 №2: на десктопі фрейм живе в сайдбарі (TabBar) — цей банер
            лишається тільки для мобільної верстки (клас ховає його ≥1024). */}
        {cookLive && !historyOpen && (
          <button
            className={`${styles['cook-banner-mobile']} ${styles['banner-in']}`}
            onClick={() => cookOpen({ recipe: cookLive.recipe, recipeId: cookLive.recipeId, returnSessionId: cookLive.returnSessionId ?? sessionId })}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              border: '1px solid var(--accent-border)', borderRadius: 14,
              padding: '13px 16px', margin: '0 0 8px', background: 'var(--bg-surface)',
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}
          >
            <span className={styles['banner-dot']} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }} />
            <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>
              Готування триває · {cookLive.recipe.t} · крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)}/{cookLive.recipe.st.length}
              <CookCountdown deadline={cookLive.deadline} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--accent)', textTransform: 'uppercase' }}>
              Продовжити ›
            </span>
          </button>
        )}

        {/* DA2-37: сегмент «Історія» показує сесії ПРЯМО ТУТ — контент під
            шапкою, як у макеті 1б, а не bottom sheet поверх стрічки. */}
        {historyOpen && (
          <div>
            {/* Правка №1: контекстний вхід у нову сесію — там, де список сесій. */}
            <button
              onClick={startFreshSession}
              style={{
                display: 'flex', width: '100%', padding: '13px 16px', marginBottom: 8,
                border: '1px dashed var(--border-strong)', borderRadius: 14,
                background: 'transparent', color: 'var(--accent)',
                fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >+ Нова сесія</button>
            {historyLoading && <SkeletonRows rows={4} />}
            {!historyLoading && historySessions.length === 0 && (
              <div style={{ color: 'var(--fg-muted)', padding: '20px 0', fontSize: 14 }}>
                Тут порожньо. Кожна сесія зберігається — вона зʼявиться тут завтра.
              </div>
            )}
            {historySessions.map((s) => {
              const d = new Date(s.created_at);
              const dayLabel = formatDayLabel(d);
              return (
                <button
                  key={s.id}
                  onClick={() => loadHistorySession(s.id)}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 12, width: '100%',
                    padding: '12px 0',
                    border: 0, borderBottom: '1px solid var(--border)',
                    background: 'transparent', color: 'inherit',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--fg)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {s.title ?? dayLabel}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)', textTransform: 'uppercase', marginTop: 3 }}>
                      {s.title ? `${dayLabel} · ` : ''}{d.getHours().toString().padStart(2, '0')}:{d.getMinutes().toString().padStart(2, '0')} · {s.message_count} {plural(s.message_count, ['ПОВІДОМЛЕННЯ', 'ПОВІДОМЛЕННЯ', 'ПОВІДОМЛЕНЬ'])}
                    </div>
                  </div>
                  {/* Пул-4 №1: видалення сесії просто з Історії. */}
                  <span
                    role="button"
                    aria-label={`Видалити сесію «${s.title ?? dayLabel}»`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm(`Видалити сесію «${s.title ?? dayLabel}»? Розмова зникне; журнал готувань лишиться.`)) return;
                      void api.session.remove(s.id).then(() => {
                        setHistorySessions((prev) => prev.filter((x) => x.id !== s.id));
                        sessionStore.bump();
                        if (s.id === sessionId) void startFreshSession();
                      }).catch(() => {/* тихо */});
                    }}
                    style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '6px 8px', cursor: 'pointer' }}
                  >✕</span>
                  <span style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>→</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Папіркат UX-9: онбординговий заголовок показувався на КОЖНОМУ
            порожньому чаті — «онбординг без онбордингу». Тепер тільки поки
            комора порожня; новий чат бувалого акаунта — просто чиста стрічка. */}
        {!historyOpen && turns.length === 0 && pantryCount === 0 && (
          <div className={styles.empty}>
            <h3>Скажи, що купив або що хочеш приготувати</h3>
            <p>
              «купив моцарелу 250 г» або «дай рецепт з вершків і фуета» — одне поле,
              усе через підтвердження.
            </p>
            {pantryCount === 0 && (
              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                {/* QA8-14 / хендоф №03: три входи, не один. Людина з відкритим
                    холодильником і без чека теж має куди тапнути.
                    UX9-25: голос — четвертий вхід, бо телефон на кухні. */}
                {[
                  { label: '📷 Сфотографувати полицю', action: () => fileInputRef.current?.click() },
                  { label: '🧾 Кинути чек', action: () => fileInputRef.current?.click() },
                  ...(speechSupported() ? [{ label: '🎙 Продиктувати', action: () => toggleVoice() }] : []),
                  { label: 'Перелічити текстом', action: () => composerInputRef.current?.focus() },
                ].map((cta, i) => (
                  <button
                    key={cta.label}
                    type="button"
                    onClick={cta.action}
                    style={{
                      padding: '12px 20px',
                      minWidth: 260,
                      background: i === 0 ? 'var(--accent-bg)' : 'transparent',
                      border: i === 0 ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
                      borderRadius: 'var(--r)',
                      color: i === 0 ? 'var(--accent)' : 'var(--fg-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {cta.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!historyOpen && turns.map((t) => (
          <div key={t.id} id={`turn-${t.id}`} className={`${styles.turn} ${t.role === 'user' ? styles['turn-user'] : ''}`}>
            <MonoLabel tone="muted">
              {t.time} {t.role === 'user' ? 'ТИ' : t.card ? (
                (() => {
                  const l = labelFor(t.card.type, t.applied, t.undone, t.dismissed);
                  // Моушн-кіт: pending-пульс — лише поки картка чекає рішення.
                  return l.tone === 'pending'
                    ? <span className={styles['pending-pulse']}>{l.text}</span>
                    : l.text;
                })()
              ) : 'КУХНЯ'}
            </MonoLabel>
            {t.text && (
              t.role === 'assistant' && t.fresh ? (
                <div className={`${styles['turn-text']} ${styles['reply-phrases']}`}>
                  {splitPhrases(t.text).map((ph, i) => (
                    <span key={i} style={{ animationDelay: `${i * 150}ms` }}>{ph}{' '}</span>
                  ))}
                  {/* Пул-7 №4: каретка блимає, ПОКИ фрази стрімляться, і гасне. */}
                  <span
                    className={styles['stream-caret']}
                    style={{ animationDelay: `0ms, ${splitPhrases(t.text).length * 150 + 1200}ms` }}
                  />
                </div>
              ) : (
                <div className={styles['turn-text']}>{t.text}</div>
              )
            )}
            {t.failed && (
              /* UX9-02: людина писала в мертвий продукт і не знала. Тепер хід
                 без відповіді позначений, повтор — одним тапом. */
              <button
                type="button"
                onClick={() => void dispatchChat(t.text ?? '', [], t.id)}
                disabled={sending}
                style={{
                  border: 0, background: 'none', padding: 0,
                  color: 'var(--danger)', fontFamily: 'var(--font-mono)',
                  fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer',
                  textAlign: 'inherit',
                }}
              >
                НЕ НАДІСЛАЛОСЬ · ↻ ПОВТОРИТИ
              </button>
            )}
            {t.cartNudge && (
              <div style={{ display: 'flex', gap: 10, paddingTop: 2 }}>
                <Button variant="primary" onClick={() => void acceptCartNudge(t.id)} loading={t.cartNudgeBusy}>
                  Зібрати
                </Button>
                <Button variant="secondary" onClick={() => dismissCartNudge(t.id)} disabled={t.cartNudgeBusy}>
                  Не зараз
                </Button>
              </div>
            )}
            {t.card?.type === 'cart' && (
              /* Крок 2: слід кошика у стрічці. Повне подання — завжди в
                 панелі або шторці, на будь-якій ширині. Обидва подання
                 в DOM, вибирає CSS.
                 Крок 3.1: два рівні. Тип і кількість — моно 10 мутед
                 (метадані), суть — Golos 15 medium ink (те, по що клікають).
                 Раніше все було однаковим моно-кеглем, і оку не було за що
                 зачепитись. */
              <button
                type="button"
                className={`${styles.trace} ${latestCart?.id === t.id && shownArtifact?.key === 'cart' ? styles['trace-on'] : ''}`}
                onClick={() => openArtifact('cart')}
              >
                <span className={styles['trace-dot']}>●</span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>
                    КОШИК · {t.card.rows?.length ?? 0} {plural(t.card.rows?.length ?? 0, ['ПОЗИЦІЯ', 'ПОЗИЦІЇ', 'ПОЗИЦІЙ'])}
                  </span>
                  <span className={styles['trace-value']}>{Math.round(t.card.total ?? 0)} ₴</span>
                </span>
                <span className={styles['trace-go']}>→</span>
              </button>
            )}
            {t.card?.type === 'recipe_link' && (
              /* Слід рецепта — той самий принцип, що кошик. Різниця в тому,
                 що рецептів МОЖЕ бути багато й вони не суперечать один
                 одному — тому слід лишається назавжди, а в панелі живе
                 тільки останній. */
              <button
                type="button"
                className={`${styles.trace} ${latestRecipe?.id === t.id && shownArtifact?.key === 'recipe' ? styles['trace-on'] : ''}`}
                onClick={() => openArtifact('recipe')}
              >
                <span className={styles['trace-dot']}>●</span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>РЕЦЕПТ</span>
                  <span className={styles['trace-value']}>{t.card.title ?? 'Рецепт'}</span>
                </span>
                <span className={styles['trace-go']}>→</span>
              </button>
            )}
            {isReceipt(t) && (
              /* Слід чека. Єдиний слід, що буває БУРШТИНОВИМ: поки чек не
                 застосовано, він не стан, а рішення, якого чекають. Після
                 «Застосувати» стає звичайним шавлієвим — стан як у всіх. */
              <button
                type="button"
                className={`${styles.trace} ${!t.applied && !t.undone ? styles['trace-pending'] : ''} ${latestReceipt?.id === t.id && shownArtifact?.key === 'receipt' ? styles['trace-on'] : ''}`}
                onClick={() => openArtifact('receipt')}
              >
                <span className={styles['trace-dot']}>{!t.applied && !t.undone ? '◌' : '●'}</span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>
                    ЧЕК · {receiptLines(t)} {plural(receiptLines(t), ['ПОЗИЦІЯ', 'ПОЗИЦІЇ', 'ПОЗИЦІЙ'])}
                  </span>
                  <span className={styles['trace-value']}>
                    {t.undone ? 'Скасовано'
                      : t.applied ? `${t.card?.ops?.length ?? 0} у комору`
                      : 'Чекає рішення'}
                  </span>
                </span>
                {!t.undone && <span className={styles['trace-go']}>→</span>}
              </button>
            )}
            {t.card && (
              /* Пул-6 №6, канон B: структуровані повідомлення системи — на
                 світлій «документ»-картці; службове (час/статус) лишається НАД. */
              <div className={`${styles.doccard} ${t.justApplied ? styles['doccard-flash'] : ''} ${t.card.type === 'cart' || t.card.type === 'recipe_link' || isReceipt(t) ? styles['artifact-in-feed'] : ''}`}>
              <Card
                card={t.card}
                cardId={t.cardId ?? undefined}
                applied={t.applied}
                applying={t.applying}
                dismissed={t.dismissed}
                undone={t.undone}
                undoAvailable={!!t.undoToken}
                onApply={(selected) => apply(t.id, selected)}
                onDismiss={() => dismissCard(t.id)}
                onUndo={t.undoToken ? () => undo(t.id, t.undoToken!) : undefined}
                onOpen={t.card.type === 'proposal' ? (i) => openRecipe(t, i) : undefined}
                onRefine={t.card.type === 'proposal' ? startRefine : undefined}
                onCook={(r, rid) => cookOpen({ recipe: r, recipeId: rid, returnSessionId: sessionId })}
                onShare={(r, rid) => navigate('/share', { state: { recipe: r, recipeId: rid } })}
                onSaveRecipe={saveRecipeForLater}
                savedRecipeIds={savedRecipeIds}
                onNeedToList={addNeedToList}
                batchLabels={batchLabels}
                stepLabels={stepLabels}
              />
              </div>
            )}
          </div>
        ))}

        {!historyOpen && sending && (
          <div className={styles.turn} aria-live="polite">
            <MonoLabel tone="muted">КУХНЯ · {thinkingVerb}</MonoLabel>
            {thinkingVerb === 'РОЗБИРАЮ' ? (
              /* Пул-7 №4, кіт: розбір — спінер з текстом дії, не «думаю»-крапки. */
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <span className={styles['parse-spinner']} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--fg-muted)' }}>
                  Розбираю вкладення…
                </span>
              </div>
            ) : (
              <div className={styles.thinking}>
                <span /><span /><span />
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles['composer-wrap']}>
        {/* Крок 5б: мобільна пігулка. На вузькому екрані панелі немає взагалі,
            і кошик — єдина річ, що живе довше за одну прокрутку, — зникав
            угору стрічки без дороги назад. Пігулка і є та дорога: вона
            відкриває ту саму шторку з тими самими вкладками. */}
        {openArtifacts.length > 0 && !railOpen && shownArtifact && (
          <button
            type="button"
            className={styles['rail-pill']}
            onClick={() => openArtifact(shownArtifact.key)}
          >
            <span className={styles['rail-pill-dot']}>●</span>
            <span className={styles['rail-pill-label']}>{shownArtifact.label}</span>
            {shownArtifact.meta && <span className={styles['rail-pill-meta']}>{shownArtifact.meta}</span>}
            {openArtifacts.length > 1 && (
              <span className={styles['rail-pill-more']}>+{openArtifacts.length - 1}</span>
            )}
          </button>
        )}
        {/* UX9-09: «Готування триває» жило В САМОМУ ВЕРХУ стрічки — на момент
            виходу з Cook Mode воно було на 2000+ px вище вʼюпорта. Тепер над
            композитором: видиме завжди, доки готування живе. */}

        {staleBatches.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Тап по підказці — питання моделі, не відкриття панелі. Модель бачить
              // ті ж партії в контексті (з !Nдн-маркерами), відповість по-своєму.
              const labels = staleBatches.map((b) => b.label).join(', ');
              setInput(`Що зробити з ${labels}? Скоро згорять.`);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 14px',
              margin: '0 0 8px',
              background: 'var(--amber-bg)',
              border: '1px solid var(--amber-border)',
              borderRadius: 'var(--r)',
              color: 'var(--amber)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            aria-label="Спитати модель, що зробити з тим, що згоряє"
          >
            <span>◔</span>
            <span style={{ flex: 1 }}>
              СКОРО ЗГОРИТЬ · {staleBatches.map((b) => (
                b.days <= 0 ? `${b.label.toUpperCase()} (сьогодні)`
                : b.days === 1 ? `${b.label.toUpperCase()} (завтра)`
                : `${b.label.toUpperCase()} (${b.days}дн)`
              )).join(' · ')}
            </span>
            <span>→</span>
          </button>
        )}
        {pending.length > 0 && (
          <div className={styles['pending-attachments']}>
            {/* Правка №9: квадратик-прев'ю замість назви й ваги. Зображення —
                мініатюра, решта — розширення. */}
            {pending.map((a) => (
              <span
                key={a.id}
                className={`${styles['att-chip']} ${leavingAtt.has(a.id) ? styles['att-leave'] : ''}`}
                title={a.content_type}
              >
                {a.kind === 'image' ? (
                  <img src={`/v1/attachments/${a.id}/bytes`} alt="" className={styles['att-thumb']} />
                ) : (
                  <span className={styles['att-ext']}>{a.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
                )}
                {/* Пул-6 №4: назва файла, ellipsis — «чек-сільпо.jpg». */}
                {a.name && <span className={styles['att-name']}>{a.name}</span>}
                <button
                  type="button"
                  className={styles['att-remove']}
                  onClick={() => removePending(a.id)}
                  aria-label="Прибрати"
                >×</button>
              </span>
            ))}
            {uploading && (
              <span className={`${styles['att-chip']} ${styles['att-uploading']}`}>
                <span className={styles['att-ext']}>…</span>
              </span>
            )}
          </div>
        )}
        {/* Бриф-3 п.6 — канон композитора: одна пілюля, 📎 (ghost) і 🎙
            всередині фрейму справа; при наборі 🎙 морфить у ↑, 📎 лишається.
            «Обери інструмент» стало «запиши» — ввід виглядає як рядок журналу. */}
        <form className={`${styles.composer} ${listening ? styles['composer-recording'] : ''}`} onSubmit={send}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,text/plain"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => pickFiles(e.target.files)}
          />
          {/* Пул-7 №3: під час запису — таймер + жива хвиля на ЛІВОМУ краю
              (канон моушн-кіта §04-2), стоп ■ лишається справа. */}
          {listening && <VoiceWave />}
          {/* Правка №8: textarea з авторостом угору, 1→8 рядків, далі скрол.
              Enter = надіслати, Shift+Enter = новий рядок. */}
          <textarea
            ref={composerInputRef}
            rows={1}
            className={styles['composer-input']}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={(e) => {
              // Пул-3: Cmd/Ctrl+V зображенням (скрін чека, фото полиці) —
              // одразу стає вкладенням, тим самим шляхом, що скріпка.
              const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
              if (images.length) {
                e.preventDefault();
                void pickFiles(images);
                return;
              }
              const text = e.clipboardData.getData('text/plain');
              if (text.length > 1500 && text.includes('\n') && pending.length < 5) {
                e.preventDefault();
                void pasteAsAttachment(text);
              }
            }}
            placeholder={listening ? 'Слухаю…' : pending.length > 0 ? 'Що з цим?' : 'Записати в журнал…'}
            disabled={sending}
            autoFocus
          />
          <button
            type="button"
            className={styles['frame-btn-ghost']}
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploading}
            aria-label="Додати вкладення"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          {listening ? (
            <>
              <button
                type="button"
                className={styles['mic-live']}
                onClick={toggleVoice}
                aria-label="Зупинити диктування"
                aria-pressed="true"
              >
                <span className={styles['mic-stop']} />
              </button>
            </>
          ) : (input.trim() || pending.length > 0) ? (
            <>
              {/* UX9-05: мікрофон НЕ зникає при тексті — інакше додиктувати
                  неможливо в принципі (єдиний шлях був — стерти поле).
                  Свідоме відхилення від «🎙 морфить у ↑»: тепер поруч. */}
              {speechSupported() && (
                <button
                  type="button"
                  className={styles['frame-btn-ghost']}
                  onClick={toggleVoice}
                  disabled={sending}
                  aria-label="Додиктувати"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                  </svg>
                </button>
              )}
              <button
                type="submit"
                className={styles['frame-btn-solid']}
                disabled={sending}
                aria-label="Надіслати"
              >↑</button>
            </>
          ) : speechSupported() ? (
            <button
              type="button"
              className={styles['frame-btn']}
              onClick={toggleVoice}
              disabled={sending}
              aria-label="Продиктувати"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                <line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            </button>
          ) : (
            <button type="submit" className={styles['frame-btn-solid']} disabled aria-label="Надіслати">↑</button>
          )}
        </form>
      </div>

      {/* Черга Г (№3): права панель — навігатор стану на десктопі (≥1280).
          Порожні секції не рендеряться. Кожен рядок — місток: продовжити
          готування, префіл композитора, скрол до картки, перехід у сесію. */}
      {hasPanel && (
      <aside className={`${styles.rail} ${railOpen ? styles['rail-open'] : ''} ${railHidden ? styles['rail-hidden'] : ''}`}>
        {/* Ручка. Дабл-клік — єдине повернення до 320 (V9). Ширину під час
            драгу не зберігаємо: пише лише відпускання, тож перерваний драг
            не лишає по собі випадкового числа. */}
        <div
          className={styles['rail-handle']}
          onPointerDown={onHandleDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Ширина панелі"
        >
          <span className={styles['rail-handle-bar']} />
          {dragging && <span className={styles['rail-handle-tip']}>{railEffective} PX</span>}
        </div>
        <button type="button" className={styles['rail-collapse']} onClick={railCollapse} aria-label="Згорнути панель">‹</button>
        {shownArtifact && (
          <div id={`rail-${shownArtifact.key}`} className={styles['rail-artifact']}>
            {/* Зона 1 — шапка. Не скролиться: вкладки мусять лишатись на
                місці, інакше на довгому кошику зникає спосіб перемкнутись. */}
            <div className={styles['rail-tabs']}>
              {openArtifacts.length > 1
                ? openArtifacts.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className={`${styles['rail-tab']} ${a.key === shownArtifact.key ? styles['rail-tab-on'] : ''}`}
                      onClick={() => setActiveArtifact(a.key)}
                    >
                      {a.label}{a.meta ? ` ${a.meta}` : ''}
                    </button>
                  ))
                : <span className={styles['rail-tab-solo']}>{shownArtifact.label}</span>}
              {/* Навігаційні дії артефакта — сюди (V7). */}
              <div className={styles['rail-head-actions']} ref={setHeadSlot} />
              <button
                type="button"
                className={styles['rail-tab-close']}
                onClick={() => closeArtifact(shownArtifact.key)}
                aria-label="Закрити"
              >✕</button>
            </div>
            {/* Зона 2 — тіло. ЄДИНА зона скролу в панелі. */}
            <div className={styles['rail-body']} ref={setBodyEl}>
              <div ref={setBodyContentEl}>
              {/* Чекаємо на слот, перш ніж малювати картку. Без цього перший
                  кадр рендерить її низ УСЕРЕДИНІ тіла (слота ще немає), тіло
                  на цей кадр вище — і тінь ловить саме його, а тоді лишається
                  ввімкненою на вмісті, який насправді влазить. Заміряно на
                  кошику: 302/302, предикат false, тінь горить. */}
              {footSlot && (
              <PanelHeadSlot.Provider value={headSlot}>
              <PanelFootSlot.Provider value={footSlot}>
                {/* Крок 4.1: одна гілка на всі артефакти замість трьох.
                    Чек потребує onApply/onUndo, яких у кошика й рецепта
                    немає, — тримати для кожного свій набір пропсів означало
                    б додавати гілку на кожен новий артефакт. */}
                <Card
                  card={shownArtifact.turn.card!}
                  cardId={shownArtifact.turn.cardId ?? undefined}
                  applied={shownArtifact.turn.applied}
                  applying={shownArtifact.turn.applying}
                  dismissed={shownArtifact.turn.dismissed}
                  undone={shownArtifact.turn.undone}
                  undoAvailable={!!shownArtifact.turn.undoToken}
                  onApply={(selected) => apply(shownArtifact.turn.id, selected)}
                  onDismiss={() => dismissCard(shownArtifact.turn.id)}
                  onUndo={shownArtifact.turn.undoToken
                    ? () => undo(shownArtifact.turn.id, shownArtifact.turn.undoToken!)
                    : undefined}
                  onCook={(r, rid) => cookOpen({ recipe: r, recipeId: rid, returnSessionId: sessionId })}
                  onShare={(r, rid) => navigate('/share', { state: { recipe: r, recipeId: rid } })}
                  onSaveRecipe={saveRecipeForLater}
                  savedRecipeIds={savedRecipeIds}
                  onNeedToList={addNeedToList}
                  batchLabels={batchLabels}
                  stepLabels={stepLabels}
                />
              </PanelFootSlot.Provider>
              </PanelHeadSlot.Provider>
              )}
              </div>
            </div>
            {/* Зона 3 — низ. Не скролиться; сюди картка порталить свої дії. */}
            <div
              className={`${styles['rail-foot']} ${bodyScrolled ? styles['rail-foot-shadow'] : ''}`}
              ref={setFootSlot}
            />
          </div>
        )}
        {housePending.length > 0 && (
          <div className={styles['rail-block']}>
            <div className={styles['rail-title']}>
              ОЧІКУЮТЬ РІШЕННЯ · {housePending.length}
            </div>
            {housePending.slice(0, 4).map((pc) => (
              <button
                key={pc.id}
                className={styles['rail-row']}
                onClick={() => {
                  // Картка з поточної розмови — скрол; з іншої — перехід у ту сесію.
                  const turn = turns.find((t) => t.cardId === pc.id);
                  if (turn) {
                    document.getElementById(`turn-${turn.id}`)?.scrollIntoView({ block: 'center' });
                  } else if (pc.session_id) {
                    void loadHistorySession(pc.session_id);
                  }
                }}
              >
                <span className={styles['rail-label']}>{labelFor(pc.type as never).text.replace(' · ◌ ОЧІКУЄ', '')}</span>
                <span className={styles['rail-meta']} style={{ color: 'var(--amber)' }}>◌</span>
              </button>
            ))}
          </div>
        )}
      </aside>
      )}
      {railOpen && <div className={styles['rail-scrim']} onClick={() => setRailOpen(false)} />}
      {/* Крок 1.4: смуга 52px. Раніше вона показувала лічильники зрізу —
          горить · очікують · оцінити, — але зрізу більше немає (крок 4
          «Панелі A»), і лічильники дублювали бічне меню. Тепер вона про
          артефакти: що відкриється зараз і що ще є в сесії.
          Ніколи більше двох кнопок — інакше стовпчик плиток читається як
          друга навігація поруч із лівою й змагається з нею за увагу. */}
      {hasPanel && (
      <div className={`${styles['rail-mini']} ${railHidden ? styles['rail-mini-show'] : ''}`}>
        <button
          type="button"
          className={styles['rail-mini-expand']}
          onClick={miniRailClick}
          aria-label="Розгорнути панель"
        >
          ›
          {/* Бурштинова крапка, а не третя кнопка: «очікують рішення» — не
              артефакт, і давати йому власний маркер означало б зламати
              правило двох. Крапка зникне разом зі стрічкою pending. */}
          {housePending.length > 0 && <span className={styles['rail-mini-dot']} />}
        </button>
        {shownArtifact && (
          <button
            type="button"
            className={`${styles['mini-marker']} ${styles['mini-marker-on']}`}
            onClick={miniRailClick}
            aria-label={`Відкрити: ${shownArtifact.label}`}
          >
            <span className={styles['mini-glyph']}>◈</span>
            {shownArtifact.meta && <span className={styles['mini-badge']}>{shownArtifact.meta}</span>}
            <span className={styles['mini-hint']}>{shownArtifact.label}</span>
          </button>
        )}
        {miniOthers.length > 0 && (
          <button
            type="button"
            className={styles['mini-marker']}
            onClick={() => setMiniListOpen((v) => !v)}
            aria-expanded={miniListOpen}
            aria-label="Інші артефакти"
          >
            <span className={styles['mini-plus']}>+{miniOthers.length}</span>
          </button>
        )}
        {miniListOpen && miniOthers.length > 0 && (
          <div className={styles['mini-list']}>
            {miniOthers.map((a) => (
              <button
                key={a.key}
                type="button"
                className={styles['mini-list-row']}
                onClick={() => { setActiveArtifact(a.key); setMiniListOpen(false); setRailHiddenPersist(false); }}
              >
                <span className={styles['mini-list-name']}>{a.label}</span>
                {a.meta && <span className={styles['mini-list-meta']}>{a.meta}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      )}


      {toast && (
        <div className={styles.toast}>
          <span className={toast.kind === 'ok' ? styles.ok : styles.err}>
            {toast.kind === 'ok' ? '✓' : '✕'}
          </span>
          <span className={styles['toast-text']}>{toast.text}</span>
          {toast.onUndo && (
            <button
              className={styles.undo}
              onClick={() => { toast.onUndo?.(); setToast(null); }}
            >
              ↩ Скасувати
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ['НД', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTHS = ['СІЧ', 'ЛЮТ', 'БЕР', 'КВІ', 'ТРА', 'ЧЕР', 'ЛИП', 'СЕР', 'ВЕР', 'ЖОВ', 'ЛИС', 'ГРУ'];
function formatDayLabel(d: Date): string {
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(d, today)) return 'Сьогодні';
  if (same(d, yesterday)) return 'Вчора';
  return `${WEEKDAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
