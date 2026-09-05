// Стрічка — робочий цикл продукту з тризмісткою карток: intake_diff, proposal,
// shopping, profile. Дизайн ближче до брифу 04 Стрічка: заголовок «Кухня»,
// мета-рядок про стан комори/списку, mono-мітки перед секціями, спокійні
// переходи між станами картки (◌ ОЧІКУЄ → ✓ ЗАСТОСОВАНО → ↩ СКАСОВАНО).

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { plural } from '../../lib/plural';
import { api, type ProfileFieldV2, type AttachmentUploaded, type ChatCard, type ChatResponse, type MessageInfo, type ShoppingItem } from '../../api';
import { Card, ShoppingListCard, labelFor, appliedToast, LivePositions, type LivePosition} from './cards';
import { isIntakeArtifact, isReceiptSourced, pickArtifacts, receiptLines, isWriteOff} from './artifacts';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { usePantryStore } from '../../store/pantry';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import { RollingNumber } from '../../components/RollingNumber/RollingNumber';
import { VoiceWave } from '../../components/VoiceWave/VoiceWave';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { speechSupported, startDictation, type Dictation } from '../../lib/speech';
import { loadCookSession, type CookSession } from '../../lib/cook-session';
import { CookCountdown } from '../../lib/cook-watch';
import { stepLabelsFrom } from '../../lib/recipe';
import styles from './Feed.module.css';

const TRADITION_UA: Record<string, string> = { orthodox: 'православні', catholic: 'католицькі', islamic: 'ісламські', jewish: 'юдейські' };
import panelStyles from '../../components/ArtifactPanel/ArtifactPanel.module.css';
import { usePanelStore } from '../../store/panel';
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
    // Аудит раунд 3, крок 1: undone_at/dismissed_at тепер їдуть з історії
    // (card_pending, приєднано на сервері) — досі скасовані/відхилені
    // auto-картки після F5 показувались як «◌ ОЧІКУЄ», бо цих полів
    // просто не було в MessageInfo.
    undone: !!m.undone_at,
    dismissed: !!m.dismissed_at,
    // undoToken на клієнті не відновлюємо — apply вже пройшов, повторний
    // apply/undo вимагатимуть нового токена. Кнопки undo після F5 нема.
  };
}

let nextId = 1;
const newId = () => `t${nextId++}`;


export function Feed() {
  const openNav = useNavStore((st) => st.setOpen);
  const navigate = useNavigate();
  // Картка профілю, у якій самі традиції: сервер застосовує її сам
  // (applyModeFor), а стрічка показує слід замість картки з кнопками.
  const isTraditionTurn = (t: { card?: { type: string; ops?: unknown[] } | null }) =>
    !!t.card && t.card.type === 'profile' && !!t.card.ops?.length
    && (t.card.ops as { kind?: string }[]).every((o) => o.kind === 'tradition');

  const [turns, setTurns] = useState<Turn[]>([]);
  // Крок 7: стан панелей картки «Про тебе» — з profile_text; перечитується
  // після кожного запису (з картки, зі сторінки, з фрази в чаті).
  const [profileFields, setProfileFields] = useState<Record<string, ProfileFieldV2> | null>(null);
  const loadProfileFields = useCallback(async () => {
    try {
      const r = await api.profileV2.get();
      setProfileFields(r.fields);
    } catch { /* офлайн — картки й так нема */ }
  }, []);
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

  // Крок 7: «Показати, що вийшло» — серверний хід без репліки людини; модель
  // переказує «Про тебе» у голосі й пропонує почати з комори.
  const [summaryBusy, setSummaryBusy] = useState(false);
  async function requestSummary() {
    if (summaryBusy) return;
    setSummaryBusy(true);
    try {
      const r = await api.chat({ session_id: sessionId ?? undefined, action: 'profile_summary' });
      setTurns((prev) => [...prev, {
        id: newId(), role: 'assistant',
        time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
        text: r.reply, card: null, fresh: true,
      }]);
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally { setSummaryBusy(false); }
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
      setToast({ id: Date.now(), kind: 'ok', text: 'Збережу в рецептах. Коли все потрібне буде вдома — нагадаю.' });
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
  // Живі позиції для карток: id → те, що зараз у коморі.
  //
  // «Немає ні чека, ні комори — є позиції; комора і чек це просто місця їх
  // відображення» (власник, 02.09). Картка чека тому не малює збережений
  // знімок ops, а дивиться сюди: приготував — і в чеку кількість інша, без
  // жодної синхронізації двох копій.
  //
  // Перечитуємо на bump комори — той самий сигнал, яким користується TabBar
  // після apply/undo й після готування.
  const pantryVersion = usePantryStore((st) => st.version);
  const [livePositions, setLivePositions] = useState<Map<string, LivePosition>>(new Map());
  useEffect(() => {
    let alive = true;
    api.pantry()
      .then((p) => {
        if (!alive) return;
        const m = new Map<string, LivePosition>();
        for (const b of p.batches ?? []) {
          if (b.state === 'depleted') continue;
          m.set(b.id, { label: b.label, value: b.value ?? null, unit: b.unit ?? null });
        }
        setLivePositions(m);
      })
      .catch(() => { /* комора недоступна — картки просто малюють знімок */ });
    return () => { alive = false; };
  }, [pantryVersion]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  // Список «сам не з'являється й сам не тримається» (V4): вкладка виникає
  // лише коли її відкрили — слідом дельти або з порожньої панелі.
  const [listOpen, setListOpen] = useState(false);
  const artifacts = pickArtifacts(turns, listOpen ? shoppingItems.length : null);
  const artifactKeyOf = (t: Turn) => artifacts.find((a) => a.turn?.id === t.id)?.key;
  // Панель живе в каркасі (Shell → ArtifactPanel); Стрічка лише публікує в
  // неї свої артефакти. Активна вкладка, ширина, згорнутість — у сторі.
  const panel = usePanelStore();
  const openArtifacts = artifacts;
  const shownArtifact = openArtifacts.find((a) => a.key === panel.active) ?? openArtifacts[0];
  function openArtifact(key: string) {
    if (key === 'list') setListOpen(true);
    panel.openArtifact(key);
  }
  const [shoppingLabels, setShoppingLabels] = useState<Set<string>>(new Set());

  // Крок 4.3: нехарчове з чека їде у список покупок. Окремого «списку
  // побуту» не заводимо: нехарчовість виводиться з каталогу (категорія
  // «нехарчове»), тим самим шляхом, яким її вже визначає розбір чека, —
  // отже нової колонки в даних не треба.
  const [buildingCart, setBuildingCart] = useState(false);
  // Той самий шлях, що й у нуджа «зібрати кошик»: кошик збирається зі
  // списку на сервері, а в стрічці зʼявляється картка-кошик. Дублювати
  // логіку не стали — різниця лише в тому, звідки натиснули.
  async function buildCartFromList() {
    setBuildingCart(true);
    try {
      const r = await api.retail.buildCart();
      setTurns((prev) => [...prev, {
        id: newId(), role: 'assistant',
        time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
        text: `Кошик у Сільпо: знайшов ${r.card.found} з ${r.card.of}`,
        card: r.card, cardId: r.card_id, fresh: true,
      }]);
      panel.setActive('cart');
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally { setBuildingCart(false); }
  }

  async function toggleListItem(id: string, checked: boolean) {
    // Оптимістично: галочка «куплено» має відповідати одразу, інакше тап
    // по рядку в довгому списку читається як «не спрацювало».
    setShoppingItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked } : i)));
    try {
      await api.shopping.toggle(id, checked);
      await refreshCounts();
    } catch (err) {
      setShoppingItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked: !checked } : i)));
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  async function removeBought(ids: string[]) {
    try {
      for (const id of ids) await api.shopping.remove(id);
      await refreshCounts();
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  async function addListItem(label: string) {
    try {
      await api.shopping.add(label);
      await refreshCounts();
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  async function addNonfoodToList(names: string[]) {
    try {
      for (const name of names) await api.shopping.add(name, undefined, undefined, 'з чека · не додаємо додому');
      await refreshCounts();
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
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
      // Крок 4.2: тримаємо не тільки лічильник, а й назви незакреслених
      // позицій — чек має сказати, скільки з нього закриє список, ДО
      // застосування, а не після.
      const listItems = (s as { items?: ShoppingItem[] }).items ?? [];
      setShoppingItems(listItems);
      setShoppingLabels(new Set(
        ((s as { items?: { label: string; checked: boolean }[] }).items ?? [])
          .filter((i) => !i.checked)
          .map((i) => i.label.trim().toLowerCase()),
      ));
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
  // Межа групи «щойно додано» в списку — початок сесії, а не «останні N
  // хвилин»: дельта має сенс саме в межах розмови, у якій її додали.
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  // Правка №1: сайдбар знає активну сесію і перечитує список, коли тут
  // щось міняється.
  const sessionStore = useSessionStore();
  const cookOpen = useCookStore((s) => s.open);
  function activate(id: string | null, startedAt?: string) {
    setSessionId(id);
    setSessionStartedAt(startedAt ?? null);
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
        activate(session.id, session.created_at);
        setTurns(messages.map((m) => messageToTurn(m)));
        if (messages.some((m) => m.card?.type === 'onboarding')) void loadProfileFields();
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
      activate(session.id, session.created_at);
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
      activate(session.id, session.created_at);
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
      setToast({ id: Date.now(), kind: 'ok', text: 'Список великий, тому прикріплю його окремо. Так нічого не загубиться.' });
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
        ? 'Не вдалося відповісти. Спробуй ще раз за хвилину.'
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
      // Крок 7: фраза в чаті заповнила поле — панель картки «Про тебе» стає «записано».
      if (turn.card?.type === 'profile') void loadProfileFields();
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

  // Раунд 4 §4: «Нічого такого» на картці поля ban — застосування зі status
  // none; картка вважається застосованою, undo є.
  async function applyNone(turnId: string) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId || turn.applying) return;
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: true } : t));
    try {
      const r = await api.cards.apply(turn.cardId, undefined, { none: true });
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? { ...t, applied: true, applying: false, undoToken: r.undo_token, justApplied: true }
        : t,
      ));
      setToast({ id: Date.now(), kind: 'ok', text: 'Записав: нічого такого', onUndo: () => undo(turnId, r.undo_token) });
    } catch (err) {
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: false } : t));
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
  }

  async function dismissCard(turnId: string) {
    // Оптимістично: кнопка реагує одразу, а не після round-trip.
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, dismissed: true } : t));
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId) return;
    try {
      await api.cards.dismiss(turn.cardId);
    } catch (err) {
      // Відкат оптимізму: сервер не прийняв (уже застосована іншим шляхом,
      // чужа картка тощо) — «Ні» не мало сенсу, повертаємо як було.
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, dismissed: false } : t));
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
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
    setToast({ id: Date.now(), kind: 'ok', text: 'Складаю рецепт…', persist: true });
    try {
      const { id, recipe, reply } = await api.recipes.generate(pick.title, pick.desc, sessionId ?? undefined);
      setToast(null);
      if (!recipe) {
        // Модель відповіла прозою замість рецепта — зазвичай бо запит
        // неоднозначний («меню на 6 осіб»). Показуємо як репліку кухаря
        // у стрічці, щоб людина могла уточнити.
        setTurns((prev) => [...prev, {
          id: newId(), role: 'assistant', time: hhmm(), fresh: true,
          text: reply || 'Рецепт не склався. Уточни, що хочеш приготувати або з яких продуктів.',
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

  // Публікація в панель каркаса. render(key) — тіло артефакта з усіма
  // замиканнями Стрічки (apply/undo, cookOpen, navigate…), extra — блок
  // «очікують рішення». Панель сама не знає ні про картки, ні про сесію.
  const artifactKeys = artifacts.map((a) => a.key).join(',');
  useEffect(() => {
    panel.publish({
      artifacts: artifacts.map(({ key, kind, label, meta }) => ({ key, kind, label, meta })),
      pendingDot: housePending.length > 0,
      ghostTab: !listOpen && shoppingItems.length > 0
        ? { glyphKind: 'list', count: shoppingItems.length, onClick: () => openArtifact('list') }
        : null,
      render: (key) => {
        const a = artifacts.find((x) => x.key === key);
        if (!a) return null;
        return (
          <LivePositions.Provider value={livePositions}>
            {a.kind === 'list' ? (
              <ShoppingListCard
                items={shoppingItems}
                sessionStartedAt={sessionStartedAt}
                onToggle={toggleListItem}
                onRemoveBought={removeBought}
                onAdd={addListItem}
                onBuildCart={() => void buildCartFromList()}
                buildingCart={buildingCart}
              />
            ) : a.turn && (
              <Card
                card={a.turn.card!}
                cardId={a.turn.cardId ?? undefined}
                applied={a.turn.applied}
                applying={a.turn.applying}
                dismissed={a.turn.dismissed}
                undone={a.turn.undone}
                undoAvailable={!!a.turn.undoToken}
                onApply={(selected) => apply(a.turn!.id, selected)}
                onDismiss={() => dismissCard(a.turn!.id)}
                onNone={() => applyNone(a.turn!.id)}
                onUndo={a.turn.undoToken ? () => undo(a.turn!.id, a.turn!.undoToken!) : undefined}
                shoppingLabels={shoppingLabels}
                onNonfoodToList={addNonfoodToList}
                onCook={(r, rid) => cookOpen({ recipe: r, recipeId: rid, returnSessionId: sessionId })}
                onShare={(r, rid) => navigate('/share', { state: { recipe: r, recipeId: rid } })}
                onSaveRecipe={saveRecipeForLater}
                savedRecipeIds={savedRecipeIds}
                onNeedToList={addNeedToList}
                batchLabels={batchLabels}
                stepLabels={stepLabels}
              />
            )}
          </LivePositions.Provider>
        );
      },
      extra: housePending.length > 0 ? (
        <div className={panelStyles['rail-block']}>
          <div className={panelStyles['rail-title']}>ЧЕКАЮТЬ НА ТЕБЕ · {housePending.length}</div>
          {housePending.slice(0, 4).map((pc) => (
            <button key={pc.id} className={panelStyles['rail-row']}
              onClick={() => {
                const turn = turns.find((t) => t.cardId === pc.id);
                if (turn) document.getElementById(`turn-${turn.id}`)?.scrollIntoView({ block: 'center' });
                else if (pc.session_id) void loadHistorySession(pc.session_id);
              }}>
              <span className={panelStyles['rail-label']}>{labelFor(pc.type as never).text.replace(' · ◌ ОЧІКУЄ', '')}</span>
              <span className={panelStyles['rail-meta']} style={{ color: 'var(--amber)' }}>◌</span>
            </button>
          ))}
        </div>
      ) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactKeys, turns, shoppingItems, listOpen, housePending, shoppingLabels, savedRecipeIds, batchLabels, stepLabels, livePositions, buildingCart, sessionStartedAt, sessionId]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className={styles.screen}
    >
      {/* Шапка лишилась тільки заради аватара на мобайлі. Заголовок «Кухня»
          і лічильники «КОМОРА N · СПИСОК N» прибрані: обидва числа стоять у
          бічному меню (на мобайлі — в нижній смузі), а назва екрана й так
          відома тому, хто на ньому. На десктопі шапки немає взагалі — там
          аватар живе внизу меню, і смуга лишалась би порожньою на 67px.
          Ручний вхід у список переїхав у шапку панелі іконкою. */}
      {/* Шапка одна на всі екрани (блок А1). У Стрічці заголовок — «Кухня»,
          а не аватар: без нижнього бара він єдиний індикатор того, де ти.
          Сегменти «Сьогодні / Історія» зняті — їхню роботу робить блок сесій
          у шухляді, а існували вони лише тому, що сесії жили в десктопному
          сайдбарі й мобайлу не лишалось нічого. Повернення з історії — тап по
          сесії або «＋ нова сесія» тут-таки. */}
      <AppHeader
        title={historyOpen ? 'Історія' : 'Кухня'}
        onMenu={() => openNav(true)}
        action={
          <button onClick={startFreshSession} className={styles['head-new']}>＋ Нова розмова</button>
        }
      />


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
              Готуємо · {cookLive.recipe.t} · крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)}/{cookLive.recipe.st.length}
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
            >+ Нова розмова</button>
            {historyLoading && <SkeletonRows rows={4} />}
            {!historyLoading && historySessions.length === 0 && (
              <div style={{ color: 'var(--fg-muted)', padding: '20px 0', fontSize: 14 }}>
                Тут поки немає минулих розмов. Сьогоднішня зʼявиться тут завтра.
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
                    aria-label={`Видалити розмову «${s.title ?? dayLabel}»`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm(`Видалити розмову «${s.title ?? dayLabel}»? Сам чат зникне, але приготовані страви лишаться в журналі.`)) return;
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
            <h3>Що зʼявилось удома або що готуємо?</h3>
            <p>
              Напиши як звичайно: «купив моцарелу» або «що зробити з вершками?».
              Перед змінами все покажемо.
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
            {/* Аудит раунд 3, крок 3: персони немає — підпису «КУХНЯ» на
                репліках без картки (репіт-гард, інші детерміновані, звичайний
                текст моделі) теж немає, лише час. Картка є — тип картки й
                статус лишаються (labelFor нижче). */}
            <MonoLabel tone="muted">
              {t.time}
              {t.role === 'user' && ' ТИ'}
              {t.role === 'assistant' && t.card && (
                <>
                  {' '}
                  {(() => {
                    const l = labelFor(t.card.type, t.applied, t.undone, t.dismissed);
                    // Моушн-кіт: pending-пульс — лише поки картка чекає рішення.
                    return l.tone === 'pending'
                      ? <span className={styles['pending-pulse']}>{l.text}</span>
                      : l.text;
                  })()}
                </>
              )}
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
                className={`${styles.trace} ${shownArtifact?.turn?.id === t.id ? styles['trace-on'] : ''}`}
                onClick={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
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
                className={`${styles.trace} ${shownArtifact?.turn?.id === t.id ? styles['trace-on'] : ''}`}
                onClick={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
              >
                <span className={styles['trace-dot']}>●</span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>РЕЦЕПТ</span>
                  <span className={styles['trace-value']}>{t.card.title ?? 'Рецепт'}</span>
                </span>
                <span className={styles['trace-go']}>→</span>
              </button>
            )}
            {t.card?.type === 'event' && t.applied && (
              /* Слід події — як у списку: дельта в сліді, стан у панелі.
                 Канвас: «Кухня повертає слід ＋ ПОДІЯ · ГОСТІ В СБ · СКАСУВАТИ,
                 як із будь-яким артефактом. Форма — для тих, хто хоче натиснути». */
              <div className={styles['trace-wrap']}>
                <button
                  type="button"
                  className={`${styles.trace} ${t.undone ? styles['trace-undone'] : ''} ${shownArtifact?.turn?.id === t.id ? styles['trace-on'] : ''}`}
                  onClick={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
                  disabled={t.undone}
                >
                  <span className={styles['trace-dot']}>{t.undone ? '○' : '●'}</span>
                  <span className={styles['trace-body']}>
                    <span className={styles['trace-kind']}>
                      {(() => {
                        // Слід каже, ЩО зробили: додали, змінили, закрили чи прибрали.
                        const ops = (t.card.ops as { op?: string }[] | undefined) ?? [];
                        const kinds = new Set(ops.map((o) => o.op ?? 'add'));
                        const word = kinds.size === 1
                          ? ({ add: '＋ ПОДІЯ', edit: 'ПОДІЮ ОНОВЛЕНО', done: 'ПОДІЯ ЗАВЕРШИЛАСЬ', remove: 'ПОДІЮ ПРИБРАНО' } as Record<string, string>)[[...kinds][0]!] ?? 'ПОДІЯ'
                          : `ПОДІЯ · ${ops.length} ЗМІНИ`;
                        return word;
                      })()}{t.undone ? ' · СКАСОВАНО' : ''}
                    </span>
                    <span className={styles['trace-value']}>
                      {((t.card.ops as { title?: string }[] | undefined) ?? []).map((o) => o.title).filter(Boolean).join(', ') || 'подія'}
                    </span>
                  </span>
                  {!t.undone && <span className={styles['trace-go']}>→</span>}
                </button>
                {!t.undone && t.undoToken && (
                  <button type="button" className={styles['trace-undo']} onClick={() => undo(t.id, t.undoToken!)}>СКАСУВАТИ</button>
                )}
              </div>
            )}
            {isTraditionTurn(t) && t.applied && (
              /* Традиція — перемикач профілю, застосований сервером сам, як
                 подія. У стрічці — слід, не картка з «Запамʼятати»: стан живе
                 в профілі, слід каже дельту і веде туди. */
              <div className={styles['trace-wrap']}>
                <button
                  type="button"
                  className={`${styles.trace} ${t.undone ? styles['trace-undone'] : ''}`}
                  onClick={() => navigate('/profile')}
                  disabled={t.undone}
                >
                  <span className={styles['trace-dot']}>{t.undone ? '○' : '●'}</span>
                  <span className={styles['trace-body']}>
                    <span className={styles['trace-kind']}>
                      {(t.card!.ops as { op?: string }[]).every((o) => o.op === 'remove') ? 'ІЗ ПРОФІЛЮ ПРИБРАНО' : '＋ ДОДАТИ ДО ТРАДИЦІЙ'}{t.undone ? ' · СКАСОВАНО' : ''}
                    </span>
                    <span className={styles['trace-value']}>
                      {(t.card!.ops as { label?: string }[]).map((o) => TRADITION_UA[o.label ?? ''] ?? o.label).filter(Boolean).join(', ')}
                    </span>
                  </span>
                  {!t.undone && <span className={styles['trace-go']}>→</span>}
                </button>
                {!t.undone && t.undoToken && (
                  <button type="button" className={styles['trace-undo']} onClick={() => undo(t.id, t.undoToken!)}>СКАСУВАТИ</button>
                )}
              </div>
            )}
            {t.card?.type === 'shopping' && t.applied && (
              /* Крок 4.5 + відкладений 3.2. Слід каже ДЕЛЬТУ, панель — стан:
                 «+5 · разом 9» відповідає на «що модель узяла в роботу» без
                 переліку, сам перелік — один тап праворуч.
                 «Скасувати» — окреме моно-посилання в рядку ПІД слідом, а не
                 друга дія всередині: у блока одна ціль натискання. І воно
                 діє на цю дельту, а не на весь список. */
              <div className={styles['trace-wrap']}>
                <button
                  type="button"
                  className={`${styles.trace} ${t.undone ? styles['trace-undone'] : ''} ${shownArtifact?.kind === 'list' ? styles['trace-on'] : ''}`}
                  onClick={() => openArtifact('list')}
                  disabled={t.undone}
                >
                  <span className={styles['trace-dot']}>{t.undone ? '○' : '●'}</span>
                  <span className={styles['trace-body']}>
                    <span className={styles['trace-kind']}>
                      СПИСОК{t.undone ? ' · СКАСОВАНО' : ` · +${(t.card.items as unknown[] | undefined)?.length ?? 0}`}
                    </span>
                    <span className={styles['trace-value']}>разом {shoppingItems.length}</span>
                  </span>
                  {!t.undone && <span className={styles['trace-go']}>→</span>}
                </button>
                {!t.undone && t.undoToken && (
                  <button
                    type="button"
                    className={styles['trace-undo']}
                    onClick={() => undo(t.id, t.undoToken!)}
                  >СКАСУВАТИ</button>
                )}
              </div>
            )}
            {isWriteOff(t) && t.applied && !t.undone && (
              /* Списання — подія, не річ. Артефакта в нього немає (нічого не
                 додалось), тож пігулка зі стрілкою вела в порожнечу. Замість
                 мертвої кнопки — рядок тексту: що саме пішло з комори.
                 Дельту не пишемо: у картці лежить нове значення, а старого
                 вона не несе, і вигадувати «−200 г» ми не будемо. */
              <div className={styles['writeoff-line']}>
                Використали: {((t.card?.ops ?? []) as { label?: string }[])
                  .map((o) => o.label).filter(Boolean).join(', ')}
              </div>
            )}
            {isIntakeArtifact(t) && !isWriteOff(t) && (
              /* Слід чека. Єдиний слід, що буває БУРШТИНОВИМ: поки чек не
                 застосовано, він не стан, а рішення, якого чекають. Після
                 «Застосувати» стає звичайним шавлієвим — стан як у всіх. */
              <button
                type="button"
                className={`${styles.trace} ${!t.applied && !t.undone ? styles['trace-pending'] : ''} ${shownArtifact?.turn?.id === t.id ? styles['trace-on'] : ''}`}
                onClick={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
              >
                <span className={styles['trace-dot']}>{!t.applied && !t.undone ? '◌' : '●'}</span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>
                    {/* Чек називається чеком, решта — тим, чим є: «це додав
                        в комору» не чек, і вигадувати за людину, що вона
                        робила, ми не будемо. */}
                    {isReceiptSourced(t) ? 'ЧЕК' : 'У КОМОРУ'} · {receiptLines(t)}{' '}
                    {plural(receiptLines(t), ['ПОЗИЦІЯ', 'ПОЗИЦІЇ', 'ПОЗИЦІЙ'])}
                  </span>
                  <span className={styles['trace-value']}>
                    {t.undone ? 'Скасовано'
                      : t.applied ? `${t.card?.ops?.length ?? 0} у комору`
                      : 'Потрібне твоє підтвердження'}
                  </span>
                </span>
                {!t.undone && <span className={styles['trace-go']}>→</span>}
              </button>
            )}
            {/* Подія в стрічці — це слід (нижче), не картка: інакше під слідом стояла б порожня рамка (EventCard поза панеллю рендерить null). */}
            {t.card && t.card.type !== 'event' && !(isTraditionTurn(t) && t.applied) && (
              /* Пул-6 №6, канон B: структуровані повідомлення системи — на
                 світлій «документ»-картці; службове (час/статус) лишається НАД. */
              <div className={`${styles.doccard} ${t.justApplied ? styles['doccard-flash'] : ''} ${t.dismissed ? styles['doccard-off'] : ''} ${t.card.type === 'cart' || t.card.type === 'recipe_link' || isIntakeArtifact(t) || (t.card.type === 'shopping' && t.applied) ? styles['artifact-in-feed'] : ''}`}>
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
                onNone={() => applyNone(t.id)}
                profileFields={profileFields}
                onProfilePatched={() => void loadProfileFields()}
                onSummary={() => void requestSummary()}
                onUndo={t.undoToken ? () => undo(t.id, t.undoToken!) : undefined}
                shoppingLabels={shoppingLabels}
                onNonfoodToList={addNonfoodToList}
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
                  Дивлюся, що тут…
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
        {openArtifacts.length > 0 && !panel.open && shownArtifact && (
          <button
            type="button"
            className={panelStyles['rail-pill']}
            onClick={() => openArtifact(shownArtifact.key)}
          >
            <span className={panelStyles['rail-pill-dot']}>●</span>
            <span className={panelStyles['rail-pill-label']}>{shownArtifact.label}</span>
            {shownArtifact.meta && <span className={panelStyles['rail-pill-meta']}>{shownArtifact.meta}</span>}
            {openArtifacts.length > 1 && (
              <span className={panelStyles['rail-pill-more']}>+{openArtifacts.length - 1}</span>
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
              setInput(`Що зробити з ${labels}? Їх краще використати першими.`);
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
            aria-label="Запитати, що з цього приготувати"
          >
            <span>◔</span>
            <span style={{ flex: 1 }}>
              КРАЩЕ НЕ ВІДКЛАДАТИ · {staleBatches.map((b) => (
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
      {/* Крок 1.4: смуга 52px. Раніше вона показувала лічильники зрізу —
          горить · очікують · оцінити, — але зрізу більше немає (крок 4
          «Панелі A»), і лічильники дублювали бічне меню. Тепер вона про
          артефакти: що відкриється зараз і що ще є в сесії.
          Ніколи більше двох кнопок — інакше стовпчик плиток читається як
          друга навігація поруч із лівою й змагається з нею за увагу. */}


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
