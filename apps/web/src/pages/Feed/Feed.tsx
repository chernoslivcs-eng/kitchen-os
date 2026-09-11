// Стрічка — робочий цикл продукту з тризмісткою карток: intake_diff, proposal,
// shopping, profile. Дизайн ближче до брифу 04 Стрічка: заголовок «Кухня»,
// мета-рядок про стан комори/списку, mono-мітки перед секціями, спокійні
// переходи між станами картки (ОЧІКУЄ → ЗАСТОСОВАНО → СКАСОВАНО).

import { Toast } from '../../components/ErrorState/Toast';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import { ActionState } from '../../components/ActionState/ActionState';
import { useIncidentStore } from '../../store/incident';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, useCallback } from 'react';
import { track } from '../../lib/track';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { plural } from '../../lib/plural';
import { applyMode } from '@kitchen/domain/card-modes';
import { api, ApiError, type ProfileFieldV2, type AttachmentUploaded, type ChatCard, type ChatResponse, type HouseholdProduct, type MessageInfo, type PantryBatch, type ShoppingItem } from '../../api';
import { Card, ShoppingListCard, RecipeStreamCard, traceState, labelFor, appliedToast, LivePositions, type LivePosition} from './cards';
import { isIntakeArtifact, isReceiptSourced, pickArtifacts, receiptLines, isWriteOff, survivingBatches, goneLabels } from './artifacts';
import { BatchCard } from '../Pantry/BatchCard';
import { formatQty } from '../../lib/units';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { usePantryStore } from '../../store/pantry';
import { useDropZone } from '../../components/DropZone/useDropZone';
import { DropCard } from '../../components/DropZone/DropCard';
import { useNavStore } from '../../store/nav';
import { RollingNumber } from '../../components/RollingNumber/RollingNumber';
import { VoiceWave } from '../../components/VoiceWave/VoiceWave';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { speechSupported, startDictation, type Dictation } from '../../lib/speech';
import { loadCookSession, type CookSession } from '../../lib/cook-session';
import { CookCountdown } from '../../lib/cook-watch';
import { useHomeNow } from '../../store/homeNow';
import { ChatHead } from '../../components/ChatHead/ChatHead';
import type { SessionRow } from '../../components/ChatHead/SessionsMenu';
import { HomeNowPanel } from '../../components/HomeNow/HomeNow';
import { toneOfNow } from '../../lib/period';
import { stepLabelsFrom } from '../../lib/recipe';
import { type Turn, type TurnAttachment, attachmentKind, hhmm, newId, messageToTurn } from './turns';
import { REPLY_FAILED, PANTRY_FAILED } from '../../components/ErrorState/copy';
import styles from './Feed.module.css';

import panelStyles from '../../components/ArtifactPanel/ArtifactPanel.module.css';
import { usePanelStore } from '../../store/panel';
import { useCookStore } from '../../store/cook';

// Фрази для стрімінг-подачі: розріз по кінцях речень, коротке лишається цілим.
/**
 * Крок О2 (1.1): «документ»-підложка під структурованим повідомленням — не для
 * всіх карток. Онбординг малює власну панель (тло, рамка, радіус 18), і
 * підложка під нею читалась як рамка в рамці. Окремий компонент, а не тернар у
 * розмітці: інакше `<Card>` довелося б дублювати двадцятьма пропами двічі.
 */
function CardShell({ plain, className, children }: { plain: boolean; className: string; children: ReactNode }) {
  return plain ? <>{children}</> : <div className={className}>{children}</div>;
}

function splitPhrases(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return parts.length ? parts : [text];
}

// Стеля вкладень за раз. Була числом усередині pickFiles; крок Д1 додав другого
// читача (зона перетягування каже про стелю ДО того, як людина відпустила), і
// два «5» в різних місцях розійшлись би за перший же перегляд.
const MAX_ATTACHMENTS = 5;

// Пул-9 №5: скільки реплік можна поставити в чергу, поки модель відповідає.
// Три — стеля, за якою розмова перестає бути розмовою: далі кнопка відправки
// гасне з підказкою «дай відповісти».
const QUEUE_MAX = 3;

// Пул-9 №5: репліка, що вже стоїть у стрічці, але чекає свого виклику.
interface QueuedTurn {
  turnId: string;
  text: string;
  attachments: TurnAttachment[];
}

interface ToastState {
  id: number;
  /** Рід крапки (E3): ok → шавлія, warn → бурштин («Тека не піде», «Максимум N»), err → danger. */
  kind: 'ok' | 'err' | 'warn';
  text: string;
  /**
   * Крок Е1: дія словом праворуч. Раніше тут був тільки onUndo («↩ Скасувати»),
   * і «Повторити» чи «Спробувати ще раз» не було куди покласти.
   */
  action?: { label: string; run: () => void };
  // Тост живе до setToast(null). Undo timeout — 18с (людина може відволіктись
  // на екран; 6с — не встигає). «Готую рецепт…» — persist:true, поки
  // openingRecipe не спаде до false.
  persist?: boolean;
}

// Пул-9 №3: секунди очікування як 0:07 / 1:23. Час — єдина справжня річ, яку
// клієнт знає про хід виклику, тому він і показується.
const LONG_WAIT_S = 45;
function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}



// №12: картки, що чекають рішення, — словами й знаком того, куди вони пишуть.
const PENDING_KIND: Record<string, { icon: IconName; label: string }> = {
  intake_diff: { icon: 'sys.pantry', label: 'Комора' },
  shopping: { icon: 'sys.list', label: 'Список' },
  recipe: { icon: 'sys.recipes', label: 'Рецепт' },
  cook_photo: { icon: 'cook.done', label: 'Журнал' },
  period: { icon: 'sys.calendar', label: 'Календар' },
};

export function Feed() {
  const openNav = useNavStore((st) => st.setOpen);
  const setNavExpanded = useNavStore((st) => st.setExpanded);
  const navigate = useNavigate();
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
  // Крок О1а: найцінніша подія набору. Людина почала писати (≥10 знаків) і
  // стерла, не надіславши — це і є місце, де вона не знайшла слів. Ловимо
  // тільки перехід «було багато → стало порожньо», і тільки коли хід НЕ пішов:
  // після відправки поле теж порожніє, але це протилежна новина.
  const typedPeak = useRef(0);
  const sentRef = useRef(false);
  useEffect(() => {
    if (input.length > typedPeak.current) typedPeak.current = input.length;
    if (input.length === 0 && typedPeak.current >= 10) {
      if (!sentRef.current) track('chat_input_abandoned', { chars: typedPeak.current });
      typedPeak.current = 0;
      sentRef.current = false;
    }
  }, [input]);
  const [sending, setSending] = useState(false);
  // DA-02: дев'ять секунд тиші на кожну відповідь моделі. Кіт: три крапки зі
  // stagger 150ms, мітка «КУХНЯ · <дієслово>» — завжди з дієсловом.
  const [thinkingVerb, setThinkingVerb] = useState('ДУМАЮ');
  // Пул-9 №3: розбір чека триває 40–90 с, і один нерухомий рядок читався як
  // зависання. Фейкових стадій не робимо (на другому чеку напис доїхав би до
  // останньої і замер — гірше за чесний рядок): показуємо ОДНУ фразу, яку
  // справді знаємо, і час, який теж справжній.
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [waited, setWaited] = useState(0);
  // Етап 3: два стани рядка над композитором. «Нічого не змінилось» — після
  // застосування з нулем; конфлікт — 409 на картці (лише для карток, DEBT §34).
  // Обидва гаснуть на наступній дії людини.
  const [nothingChanged, setNothingChanged] = useState(false);
  const [cardConflict, setCardConflict] = useState(false);
  useEffect(() => {
    if (waitStartedAt === null) { setWaited(0); return; }
    setWaited(0);
    const id = window.setInterval(() => setWaited(Math.floor((Date.now() - waitStartedAt) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [waitStartedAt]);

  // Пул-9 №5: черга реплік. Послідовна за визначенням — паралельні виклики
  // дали б моделі застарілий стан комори й карток. Глибина 3: далі кнопка
  // відправки блокується.
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const queueRef = useRef<QueuedTurn[]>([]);
  queueRef.current = queue;
  // Хід, який ЗАРАЗ у моделі — щоб «Стоп» позначив саме його.
  const currentTurnId = useRef<string | null>(null);
  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [batchLabels, setBatchLabels] = useState<Map<string, string>>(new Map());
  // №4а: кроки рецептів у стрічці — тільки product.
  const [stepLabels, setStepLabels] = useState<Map<string, string>>(new Map());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [openingRecipe, setOpeningRecipe] = useState(false);
  const [pending, setPending] = useState<AttachmentUploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  // Крок Д1: перетягування. Кинути можна будь-де в стрічці — хук слухає window;
  // малюють це два місця: картка в кінці стрічки і сам композитор.
  const drag = useDropZone({
    pendingCount: pending.length,
    max: MAX_ATTACHMENTS,
    onFiles: useCallback((files: File[]) => { void pickFiles(files, 'drop'); }, []),  // eslint-disable-line react-hooks/exhaustive-deps
    onFolder: useCallback(() => setToast({ id: Date.now(), kind: 'warn', text: 'Тека не піде — перетягни файли' }), []),
  });
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 6b-5: «+» у композиторі — меню вкладень (Prototype): чек · фото полиці ·
  // список текстом. Скріпку замінює; ті самі pickFiles за ним.
  const [attachOpen, setAttachOpen] = useState(false);
  const [fileAccept, setFileAccept] = useState('image/*,application/pdf,text/plain');
  function pickVia(accept: string) {
    setAttachOpen(false);
    setFileAccept(accept);
    // accept має оновитись у DOM до кліку.
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }
  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  // Правка №8: авторіст textarea від вмісту (і від диктовки, яка пише в
  // input повз onChange) — 1→8 рядків, далі внутрішній скрол.
  // Порожнє поле — рівно один рядок (42): scrollHeight плейсхолдера, що
  // переноситься на вузькому, не має ростити композитор.
  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = input ? `${Math.min(el.scrollHeight, 8 * 22 + 16)}px` : '42px';
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
  // П6-Т3: тримаємо саму партію цілком, а не три її поля. Слід часткового
  // списання відкриває картку позиції (`batch`) прямо тут, у панелі, — а їй
  // потрібен весь рядок комори: зона, терміни, БЖВ, походження. Другого
  // запиту для цього не робимо: /v1/pantry віддає це тим самим викликом.
  const [liveBatches, setLiveBatches] = useState<Map<string, PantryBatch>>(new Map());
  const [liveProducts, setLiveProducts] = useState<HouseholdProduct[]>([]);
  useEffect(() => {
    let alive = true;
    api.pantry()
      .then((p) => {
        if (!alive) return;
        const m = new Map<string, PantryBatch>();
        for (const b of p.batches ?? []) {
          if (b.state === 'depleted') continue;
          m.set(b.id, b);
        }
        setLiveBatches(m);
        setLiveProducts(p.products ?? []);
      })
      .catch(() => { /* комора недоступна — картки просто малюють знімок */ });
    return () => { alive = false; };
  }, [pantryVersion]);
  const livePositions = useMemo<Map<string, LivePosition>>(() => {
    const m = new Map<string, LivePosition>();
    for (const [id, b] of liveBatches) m.set(id, { label: b.label, value: b.value ?? null, unit: b.unit ?? null });
    return m;
  }, [liveBatches]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  // Список «сам не з'являється й сам не тримається» (V4): вкладка виникає
  // лише коли її відкрили — слідом дельти або з порожньої панелі.
  const [listOpen, setListOpen] = useState(false);
  const artifacts = pickArtifacts(turns, listOpen ? shoppingItems.length : null, livePositions);
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
      // Пул-9 №6: раніше тут стояло `panel.setActive('cart')` — ключ, якого в
      // списку вкладок не буває (артефакт кошика адресується card_id), тож
      // рядок нічого не робив. Тепер кошик виводить наперед саме правило
      // «новий артефакт із ходу», спільне для всіх типів.
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
      // 6b-6: капс-рядок «КРАЩЕ НЕ ВІДКЛАДАТИ · …» над композитором знято —
      // у бандлі його нема; ті самі партії (isSoon) живуть у «Дім зараз»
      // (store/homeNow.ts · HomeNow «Горить · N» → «Готуємо»).
    } catch {
      // Крок Е1: раніше тут була тиша, і екран показував старі (або порожні)
      // числа як правду. Порожньо ≠ не вдалось показати — і в коморі це
      // різниця між «ти все зʼїв» і «я не бачу твоїх продуктів».
      setToast({
        id: Date.now(),
        kind: 'err',
        text: PANTRY_FAILED.text,
        action: { label: PANTRY_FAILED.cta, run: () => void refreshCounts() },
      });
    }
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
  // 6b-5: пілюля сесії в шапці (Prototype) — назва розмови й «· сьогодні».
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  function activate(id: string | null, startedAt?: string, title?: string | null) {
    setSessionId(id);
    setSessionStartedAt(startedAt ?? null);
    setSessionTitle(title ?? null);
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
        activate(session.id, session.created_at, session.title);
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
      activate(session.id, session.created_at, session.title);
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
      activate(session.id, session.created_at, session.title);
      setTurns(messages.map((m) => messageToTurn(m)));
      setHistoryOpen(false);
    } catch {/* тихо */}
  }

  // Правка №1: команди з сайдбара (і №10/11 — з бібліотеки/журналу) приходять
  // через location.state. `at` — щоб повторний клік по тому ж пункту
  // спрацьовував знову.
  useEffect(() => {
    const st = location.state as { sessionId?: string; freshSession?: boolean; openHistory?: boolean; focusComposer?: boolean; at?: number } | null;
    if (!st) return;
    if (st.sessionId) void loadHistorySession(st.sessionId);
    else if (st.freshSession) void startFreshSession();
    else if (st.openHistory) void openHistory();
    // ⌘K з іншого екрана: оболонка привела сюди — фокус у композитор.
    if (st.focusComposer) window.setTimeout(() => composerInputRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // ⌘K / Ctrl+K на стрічці — фокус у композитор (Components: «Композитор (⌘K з будь-де)»).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault(); composerInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        // П5-В6а: ціль — тільки картка, яку СПРАВДІ можна застосувати. Досі
        // пошук дивився на «є cardId і ще не застосована» і влучав у
        // пропозицію, у якої кнопок застосування немає взагалі: до П4-Т6 це
        // давало тост «apply not implemented for card type: proposal», після —
        // «card not found». В обох випадках людина читала рядок розробника
        // замість репліки продукту. Режим береться з card-modes — того самого
        // джерела, що вирішує, чи малювати кнопку.
        const target = [...turns].reverse().find((t) => t.card && !t.applied && !t.undone && t.cardId
          && applyMode(t.card.type) !== 'none');
        if (target) {
          e.preventDefault();
          void apply(target.id);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // №11: час тоста тримає сам компонент (4 с / 8 с з дією) — тут лише
  // «persist» для «Готую рецепт…» (без onDismiss тост стоїть до кінця).

  // Пул-2 №4: простиня з буфера (інвентар, довгий список) не мусить іти
  // чат-конвеєром — він обрізається стелею відповіді. Вставка >1500 символів
  // з переносами сама стає TXT-вкладенням і їде парс-конвеєром (haiku, t=0).
  async function pasteAsAttachment(text: string) {
    setUploading(true);
    try {
      const file = new File([text], 'вставка.txt', { type: 'text/plain' });
      const rec = await api.attachments.upload(file);
      setPending((p) => [...p, rec]);
      track('attachment_added', { kind: rec.kind, how: 'paste' });
      setToast({ id: Date.now(), kind: 'ok', text: 'Список великий, тому прикріплю його окремо. Так нічого не загубиться.' });
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function pickFiles(list: FileList | File[] | null, how: 'clip' | 'paste' | 'drop' = 'clip') {
    if (!list || !('length' in list) || !list.length) return;
    if (pending.length + list.length > MAX_ATTACHMENTS) {
      setToast({ id: Date.now(), kind: 'warn', text: `Максимум ${MAX_ATTACHMENTS} вкладень за раз` });
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const rec = await api.attachments.upload(file);
        setPending((p) => [...p, rec]);
        // Крок О1а: рід і спосіб — без назви файла.
        track('attachment_added', { kind: rec.kind, how });
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
  // Пул-9 №4: контролер поточного виклику. «Стоп» рве саме його; серверний
  // виклик при цьому може добігти — це нормально, ми просто не приймаємо
  // відповідь (див. коментар у stopSending).
  const abortRef = useRef<AbortController | null>(null);

  async function dispatchChat(text: string, attachments: TurnAttachment[], existingTurnId?: string) {
    setSending(true);
    setThinkingVerb(attachments.length ? 'РОЗБИРАЮ' : 'ДУМАЮ');
    setWaitStartedAt(Date.now());

    let turnId = existingTurnId;
    if (!turnId) {
      // Пул-9 №2: «[вкладення]» більше не підміняє репліку. Є текст —
      // показуємо текст; нема — самі мініатюри.
      const userTurn: Turn = {
        id: newId(), role: 'user', time: hhmm(),
        ...(text ? { text } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
      turnId = userTurn.id;
      setTurns((prev) => [...prev, userTurn]);
    } else {
      // Повтор після помилки або старт із черги — знімаємо обидві помітки.
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, failed: false, queued: false, aborted: false } : t)));
    }
    currentTurnId.current = turnId;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setNothingChanged(false);
    setCardConflict(false);
    try {
      const res: ChatResponse = await api.chat(
        {
          text,
          attachments: attachments.length ? attachments.map((a) => ({ id: a.id })) : undefined,
          session_id: sessionId ?? undefined,
        },
        ctrl.signal,
      );
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
          action: res.undo_token && res.card_id
            ? { label: 'Скасувати', run: () => undo(turn.id, res.undo_token!) }
            : undefined,
        });
      }
      // Правка №1: перша репліка дала сесії назву — сайдбар перечитає список.
      sessionStore.bump();
    } catch (err) {
      // Пул-9 №4: обрив — не помилка. Хід уже позначений «зупинив» у
      // stopSending, картку не додаємо, тост не показуємо.
      if ((err as Error).name === 'AbortError') return;
      setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, failed: true } : t)));
      // Крок Е1: «відповідь не прийшла» говорить голосом продукту, а не кодом
      // помилки. Повтор — дією в тому самому тості, а не тільки кнопкою під
      // ходом. Технічні причини (model_unavailable і решта) людині не потрібні:
      // дія від них не змінюється.
      const failedId = turnId!;
      const failedText = text;
      const failedAtt = attachments;
      setToast({
        id: Date.now(),
        kind: 'err',
        text: REPLY_FAILED.text,
        action: { label: REPLY_FAILED.cta, run: () => void dispatchChat(failedText, failedAtt, failedId) },
      });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      if (currentTurnId.current === turnId) currentTurnId.current = null;
      setSending(false);
      setWaitStartedAt(null);
    }
  }

  // Пул-9 №4: «Стоп». Рве поточний виклик і чистить чергу — те, що чекало,
  // теж більше не поїде (людина зупинила розмову, а не один хід).
  // Серверний виклик поточного ходу може добігти: якщо він устиг створити
  // pending-картку, вона лишиться в /v1/cards/pending і прийде в панель
  // «чекають на тебе». У стрічку її не додаємо — там стоїть «зупинив».
  function stopSending() {
    const stopped = new Set<string>(queueRef.current.map((q) => q.turnId));
    if (currentTurnId.current) stopped.add(currentTurnId.current);
    queueRef.current = [];
    setQueue([]);
    abortRef.current?.abort();
    setTurns((prev) => prev.map((t) => (stopped.has(t.id) ? { ...t, queued: false, aborted: true } : t)));
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text && pending.length === 0) return;
    if (sending && queue.length >= QUEUE_MAX) return;
    sentRef.current = true;
    setInput('');
    const attachments: TurnAttachment[] = pending.map((p) => ({ id: p.id, kind: p.kind, name: p.name }));
    setPending([]);
    // Пул-7 №2: фокус лишається в полі — наступне повідомлення без кліку.
    composerInputRef.current?.focus();

    // Пул-9 №5: поки модель відповідає, поле не гасне — наступна думка лягає
    // в стрічку одразу і стає в чергу. Черга СУВОРО послідовна: другий хід
    // мусить бачити комору й картки, які створив перший.
    if (sending) {
      const turn: Turn = {
        id: newId(), role: 'user', time: hhmm(), queued: true,
        ...(text ? { text } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
      setTurns((prev) => [...prev, turn]);
      setQueue((prev) => [...prev, { turnId: turn.id, text, attachments }]);
      return;
    }
    await dispatchChat(text, attachments);
  }

  // Пул-9 №5: черга рухається САМА, коли попередній виклик завершився (або
  // його скасували). Ефект, а не рекурсія у finally: так наступний хід стартує
  // вже з оновленого стану, а не з замикання, знятого до відповіді.
  useEffect(() => {
    if (sending || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void dispatchChat(next!.text, next!.attachments, next!.turnId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, queue]);

  async function apply(turnId: string, selected?: number[]) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId || turn.applying) return;
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: true } : t));
    try {
      const r = await api.cards.apply(turn.cardId, selected);
      // П4-Т2: закриває картку ФАКТ, а не сам виклик. Раніше тут стояло
      // applied: true безумовно — сервер міг сказати «не застосовано, токена
      // немає», а картка все одно закривалась і пропонувала скасувати ніщо.
      // Нуль лишає картку відкритою: тапнути ще раз можна, «Ні» працює.
      const landed = r.applied > 0;
      setNothingChanged(!landed);
      setCardConflict(false);
      // Етап 3 (PLAN §4): результат лишається на ході, а не лише в тості.
      // Скільки послали — стільки й «із»: людина могла зняти частину галочок.
      const total = selected?.length ?? (turn.card && 'ops' in turn.card ? (turn.card as { ops: unknown[] }).ops.length : r.applied);
      const outcome = { applied: r.applied, total, missed: r.missed, alreadyThere: r.already_there, truncated: r.truncated };
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? landed
          ? { ...t, applied: true, applying: false, undoToken: r.undo_token ?? undefined, justApplied: true, outcome }
          : { ...t, applying: false }
        : t,
      ));
      // П2: картка period повертає id створеного запису — артефакт дописує правки людини.
      // Правка №6: застосована пост-кук картка списання продовжує розмову
      // детермінованим «Як вийшло?» — сервер уже записав його в сесію,
      // нам лишається показати хід без перезавантаження історії.
      if (r.followup) {
        setTurns((prev) => [...prev, { id: newId(), role: 'assistant', time: hhmm(), fresh: true, text: r.followup! }]);
      }
      // Оновлюємо лічильники для комори/списку
      await refreshCounts();
      // Крок 7: фраза в чаті заповнила поле — панель картки «Про тебе» стає «записано».
      setToast({
        id: Date.now(),
        kind: 'ok',
        text: turn.card ? appliedToast(turn.card, r.applied) : 'Готово',
        // Скасовувати нічого — не пропонувати. Кнопка без роботи гірша за
        // її відсутність: вона стверджує, що робота була.
        ...(landed && r.undo_token
          ? { action: { label: 'Скасувати', run: () => undo(turnId, r.undo_token!) } }
          : {}),
      });
      return r;
    } catch (err) {
      setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: false } : t));
      // Етап 3: 409 на картці — «хтось у домі вже закрив». Єдине місце, де
      // конфлікт має контракт (DEBT §34); решта помилок — тостом, як і було.
      if (err instanceof ApiError && err.status === 409) setCardConflict(true);
      else setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
      throw err;
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
        ? { ...t, applied: true, applying: false, undoToken: r.undo_token ?? undefined, justApplied: true }
        : t,
      ));
      setToast({ id: Date.now(), kind: 'ok', text: 'Записав: нічого такого', ...(r.undo_token ? { action: { label: 'Скасувати', run: () => undo(turnId, r.undo_token!) } } : {}) });
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
      // Пул-9 №6: «новий» для панелі — той, чий хід прийшов у цій сесії
      // вкладки. `fresh` ставиться лише на ходи, які прилетіли відповіддю
      // (messageToTurn історію ним не позначає), тому F5 сюди нічого не дає.
      // П6-Т3: партія сюди НЕ йде. «Новий артефакт» відкриває панель сам, і
      // для чека чи рецепта це правильно — його принесли показати. Партію
      // ніхто не приносив: списання після готування чіпає по пʼять позицій, і
      // панель відчинялась би сама після кожної вечері. Слід зі стрілкою в
      // стрічці стоїть — відкриває його тап, як і сказано в брифі.
      freshKeys: artifacts.filter((a) => a.turn?.fresh && a.kind !== 'batch').map((a) => a.key),
      ghostTab: !listOpen && shoppingItems.length > 0
        ? { glyphKind: 'list', count: shoppingItems.length, onClick: () => openArtifact('list') }
        : null,
      render: (key) => {
        const a = artifacts.find((x) => x.key === key);
        if (!a) return null;
        return (
          <LivePositions.Provider value={livePositions}>
            {a.kind === 'batch' ? (
              /* П6-Т3: часткове списання показує саму ПОЗИЦІЮ — ту саму
                 картку партії, що відкриває Комора. Дані беремо з живої
                 комори, а не зі знімка ходу: людина відкриває слід рівно
                 щоб побачити, скільки лишилось ЗАРАЗ. */
              (() => {
                const b = liveBatches.get(a.key.slice('batch:'.length));
                if (!b) return null;
                return (
                  <BatchCard
                    batch={b}
                    product={liveProducts.find((pr) => pr.id === (b.product_id ?? '')) ?? null}
                    onChanged={async () => { usePantryStore.getState().bump(); }}
                    onRemove={async (reason) => { await api.batches.remove(b.id, reason); usePantryStore.getState().bump(); }}
                  />
                );
              })()
            ) : a.kind === 'list' ? (
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
                onOpenArtifact={() => openArtifact(a.key)}
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
      // №12: блок «Чекають на тебе · N» під підвалом панелі — у токенах: кікер
      // 12/500 muted без капсу, рядок 14/500, знак 16 зі словника (куди пише
      // картка), бурштин — «чекає». Де йому жити остаточно — QUESTIONS §12.
      extra: housePending.length > 0 ? (
        <div className={panelStyles['rail-block']} data-pending-block>
          <div className={panelStyles['rail-title']}>Чекають на тебе · {housePending.length}</div>
          {housePending.slice(0, 4).map((pc) => {
            const kind = PENDING_KIND[pc.type] ?? { icon: 'sys.chat' as const, label: 'Картка' };
            return (
              <button key={pc.id} className={panelStyles['rail-row']}
                onClick={() => {
                  const turn = turns.find((t) => t.cardId === pc.id);
                  if (turn) document.getElementById(`turn-${turn.id}`)?.scrollIntoView({ block: 'center' });
                  else if (pc.session_id) void loadHistorySession(pc.session_id);
                }}>
                <span className={panelStyles['rail-meta']}><Icon name={kind.icon} size={16} inherit decorative /></span>
                <span className={panelStyles['rail-label']}>{kind.label}</span>
              </button>
            );
          })}
        </div>
      ) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactKeys, turns, shoppingItems, listOpen, housePending, shoppingLabels, savedRecipeIds, batchLabels, stepLabels, livePositions, liveBatches, liveProducts, buildingCart, sessionStartedAt, sessionId]);
  useEffect(() => () => panel.clear(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 6b-5: стан дому для шапки й панелі «Дім зараз» (Screens «Чат · збірка»,
  // Responsive G1/G3, Components «home now»).
  const home = useHomeNow(sessionId);
  const [homeOpen, setHomeOpen] = useState(false);
  const sessionWhen = (() => {
    if (!sessionStartedAt) return 'сьогодні';
    const d = new Date(sessionStartedAt); const now = new Date();
    const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return same ? 'сьогодні' : d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }).replace('.', '');
  })();
  const homeDate = new Date().toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  // «Усі розмови» / panel-left-open — розмови живуть у сайдбарі (≥1024) або шухляді.
  function openAllSessions() { if (window.innerWidth >= 1024) setNavExpanded(true); else openNav(true); }
  // Меню пілюлі: 5 останніх розмов по днях зі станом другим рядком — «чекає
  // рішення» (картки дому, що чекають, з session_id) або час dim.
  const [sessionRows, setSessionRows] = useState<SessionRow[]>([]);
  useEffect(() => {
    let alive = true;
    api.session.list().then(({ sessions }) => {
      if (!alive) return;
      const pendingIn = new Set(housePending.map((pc) => pc.session_id).filter(Boolean));
      setSessionRows(sessions.slice(0, 5).map((sn) => {
        const d = new Date(sn.created_at);
        return {
          id: sn.id, title: sn.title ?? 'без назви', day: sn.day, created_at: sn.created_at,
          state: pendingIn.has(sn.id)
            ? { text: 'чекає рішення', tone: 'amber' as const }
            : { text: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, tone: 'dim' as const },
        };
      }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId, housePending]);
  // Ширина КОНТЕЙНЕРА стрічки (Р38): нижче 768 «Дім зараз» — шторка, не накладка.
  // Форма шапки за шириною контейнера (Р38): ≥964 wide · 704–963 mid (R2) · <704 narrow (G3).
  const screenRef = useRef<HTMLDivElement>(null);
  const [headForm, setHeadForm] = useState<'wide' | 'mid' | 'narrow'>('wide');
  useEffect(() => {
    const el = screenRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([en]) => {
      const w = en?.contentRect.width ?? 1440;
      setHeadForm(w >= 964 ? 'wide' : w >= 704 ? 'mid' : 'narrow');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = headForm === 'narrow';
  // Вказівник: ≥1024 або (hover: hover). На дотику фокус — тільки від людини.
  const pointerDevice = typeof window !== 'undefined' && (window.innerWidth >= 1024 || (window.matchMedia?.('(hover: hover)')?.matches ?? false));
  // «· ще N» — рядки панелі без свого чіпа (тимчасово, до QUESTIONS §14):
  // «горить», але не прострочено, і рядки «Зараз», що не суворі.
  const quietCount = home.burning.filter((b) => b.days >= 0).length + home.now.slice(0, 3).filter((e) => toneOfNow(e) !== 'restrict').length;
  function askInComposer(text: string) {
    setHomeOpen(false);
    setInput(text);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  return (
    <div
      className={styles.screen}
      ref={screenRef}
    >
      <ChatHead
        title={historyOpen ? 'Історія' : sessionTitle}
        when={sessionWhen}
        home={home}
        cookLive={cookLive}
        sessions={sessionRows}
        activeSessionId={sessionId}
        onPickSession={(id) => void loadHistorySession(id)}
        onNewSession={() => void startFreshSession()}
        onAllSessions={openAllSessions}
        onCook={() => cookLive && cookOpen({ recipe: cookLive.recipe, recipeId: cookLive.recipeId, returnSessionId: cookLive.returnSessionId ?? sessionId })}
        onOverdue={() => navigate('/pantry', { state: { sort: 'fresh' } })}
        onHome={() => setHomeOpen((v) => !v)}
        homeOpen={homeOpen}
        quietCount={quietCount}
        form={headForm}
      />
      {homeOpen && (
        <HomeNowPanel
          home={home} cookLive={cookLive} sheet={narrow} dateLabel={homeDate}
          onClose={() => setHomeOpen(false)}
          onCook={() => { setHomeOpen(false); if (cookLive) cookOpen({ recipe: cookLive.recipe, recipeId: cookLive.recipeId, returnSessionId: cookLive.returnSessionId ?? sessionId }); }}
          onOverdue={() => navigate('/pantry', { state: { sort: 'fresh' } })}
          onCalendar={() => navigate('/calendar')}
          onList={() => navigate('/list')}
          onAsk={askInComposer}
        />
      )}

      {/* Моушн-2 №6: перемикання Сьогодні⇄Історія — crossfade + X±10 (key
          перемонтовує контейнер), скрол-позиція кожної вкладки пам'ятається. */}
      <div
        key={historyOpen ? 'history' : `today:${sessionId ?? ''}`}
        className={`${styles.timeline} ${historyOpen ? styles['seg-view-hist'] : styles['seg-view-today']}`}
        ref={timelineRef}
        onScroll={(e) => { segScroll.current[historyOpen ? 'h' : 't'] = e.currentTarget.scrollTop; }}
      >
        {/* 6b-5: банера «Готуємо · крок» у стрічці більше нема — той самий факт
            несе чіп у шапці («Готуємо · таймер») і «Дім ●●● N» на 390. */}

        {/* DA2-37: сегмент «Історія» показує сесії ПРЯМО ТУТ — контент під
            шапкою, як у макеті 1б, а не bottom sheet поверх стрічки. */}
        {historyOpen && (
          <div>
            {/* Правка №1: контекстний вхід у нову сесію — там, де список сесій. */}
            <button
              onClick={startFreshSession}
              style={{
                display: 'flex', width: '100%', padding: '13px 16px', marginBottom: 8,
                border: '1px dashed var(--line2)', borderRadius: 14,
                background: 'transparent', color: 'var(--sage)',
                fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >+ Нова розмова</button>
            {historyLoading && <SkeletonRows rows={4} />}
            {!historyLoading && historySessions.length === 0 && (
              <div style={{ color: 'var(--muted)', padding: '20px 0', fontSize: 14 }}>
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
                    border: 0, borderBottom: '1px solid var(--line)',
                    background: 'transparent', color: 'inherit',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {s.title ?? dayLabel}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 3 }}>
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
                    style={{ color: 'var(--dim)', fontSize: 13, padding: '6px 8px', cursor: 'pointer' }}
                  ><Icon name="sys.close" size={12} inherit /></span>
                  <span style={{ color: 'var(--dim)' }}><Icon name="sys.next" size={12} inherit decorative /></span>
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
                      background: i === 0 ? 'var(--sage-bg)' : 'transparent',
                      border: i === 0 ? '1px solid var(--sage)' : '1px solid var(--line2)',
                      borderRadius: 'var(--r)',
                      color: i === 0 ? 'var(--sage)' : 'var(--muted)',
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
            {/* 6b-5, Prototype: над репліками службового рядка немає — ані часу,
                ані «КУХНЯ · ОЧІКУЄ». Стан картки каже слід (чіп) під нею:
                «чекає рішення · 14» → «9 із 14 · 5 пропущено». */}
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
            {t.attachments && t.attachments.length > 0 && (
              /* Пул-9 №2: те, що людина закинула, лишається видимим у стрічці —
                 ті самі квадратики, що в композиторі. Клік відкриває повний
                 файл новою вкладкою (той самий /bytes, що й прев'ю). */
              <div className={styles['pending-attachments']} data-turn-attachments>
                {t.attachments.map((a) => (
                  <a
                    key={a.id}
                    className={styles['att-chip']}
                    href={`/v1/attachments/${a.id}/bytes`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={a.name ? `Відкрити ${a.name}` : 'Відкрити вкладення'}
                  >
                    {a.kind === 'image' ? (
                      <img src={`/v1/attachments/${a.id}/bytes`} alt="" className={styles['att-thumb']} />
                    ) : (
                      <span className={styles['att-ext']}>{a.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
                    )}
                    {a.name && <span className={styles['att-name']}>{a.name}</span>}
                  </a>
                ))}
              </div>
            )}
            {t.queued && (
              /* Пул-9 №5: репліка вже у стрічці, але виклик ще не стартував. */
              <div className={styles['turn-note']} data-queued>чекає</div>
            )}
            {t.aborted && (
              /* Пул-9 №4: «Стоп». Хід лишається — це те, що людина сказала;
                 зникає тільки відповідь, якої вона більше не чекає. */
              <div className={styles['turn-note']} data-aborted>зупинив</div>
            )}
            {t.failed && (
              /* UX9-02: людина писала в мертвий продукт і не знала. Тепер хід
                 без відповіді позначений, повтор — одним тапом. */
              <button
                type="button"
                onClick={() => void dispatchChat(t.text ?? '', t.attachments ?? [], t.id)}
                disabled={sending}
                style={{
                  border: 0, background: 'none', padding: 0,
                  color: 'var(--danger)',
                  fontSize: 12, cursor: 'pointer',
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
                <span className={styles['trace-icon']}><Icon name="sys.cart" size={18} inherit decorative /></span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>
                    Кошик · {t.card.rows?.length ?? 0} {plural(t.card.rows?.length ?? 0, ['позиція', 'позиції', 'позицій'])}
                  </span>
                  <span className={styles['trace-value']}>{Math.round(t.card.total ?? 0)} ₴</span>
                </span>
                <span className={styles['trace-go']}><Icon name="sys.next" size={16} inherit decorative /></span>
              </button>
            )}
            {t.card?.type === 'recipe_link' && (
              /* Етап 6b (4a): рецепт у стрічці — картка, не слід-пігулка.
                 Рецептів може бути багато й вони не суперечать один одному —
                 картка лишається назавжди, а в панелі живе відкритий. */
              <RecipeStreamCard card={t.card} active={shownArtifact?.turn?.id === t.id}
                onOpen={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
                onAsk={(title) => { setInput(`Уточни рецепт «${title}»: `); composerInputRef.current?.focus(); }} />
            )}
            {t.card?.type === 'event' && t.applied && (
              /* Слід події — як у списку: дельта в сліді, стан у панелі.
                 Канвас: «Кухня повертає слід ПОДІЯ · ГОСТІ В СБ · СКАСУВАТИ,
                 як із будь-яким артефактом. Форма — для тих, хто хоче натиснути». */
              <div className={styles['trace-wrap']}>
                <button
                  type="button"
                  className={`${styles.trace} ${t.undone ? styles['trace-undone'] : ''} ${shownArtifact?.turn?.id === t.id ? styles['trace-on'] : ''}`}
                  onClick={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
                  disabled={t.undone}
                >
                  <span className={styles['trace-icon']}><Icon name="sys.calendar" size={18} inherit decorative /></span>
                  <span className={styles['trace-body']}>
                    <span className={styles['trace-kind']}>
                      {(() => {
                        // Слід каже, ЩО зробили: додали, змінили, закрили чи прибрали.
                        const ops = (t.card.ops as { op?: string }[] | undefined) ?? [];
                        const kinds = new Set(ops.map((o) => o.op ?? 'add'));
                        const word = kinds.size === 1
                          ? ({ add: 'Подія', edit: 'Подію оновлено', done: 'Подія завершилась', remove: 'Подію прибрано' } as Record<string, string>)[[...kinds][0]!] ?? 'Подія'
                          : `Подія · ${ops.length} зміни`;
                        return word;
                      })()}{t.undone ? ' · СКАСОВАНО' : ''}
                    </span>
                    <span className={styles['trace-value']}>
                      {((t.card.ops as { title?: string }[] | undefined) ?? []).map((o) => o.title).filter(Boolean).join(', ') || 'подія'}
                    </span>
                  </span>
                  {!t.undone && <span className={styles['trace-go']}><Icon name="sys.next" size={16} inherit decorative /></span>}
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
                  className={`${styles.trace} ${styles['trace-soft']} ${t.undone ? styles['trace-undone'] : ''}`}
                  onClick={() => openArtifact('list')}
                  disabled={t.undone}
                >
                  <span className={styles['trace-icon']}><Icon name="sys.list" size={18} inherit decorative /></span>
                  <span className={styles['trace-body']}>
                    <span className={styles['trace-kind']}>
                      Список{t.undone ? ' · скасовано' : ` · +${(t.card.items as unknown[] | undefined)?.length ?? 0}`}
                    </span>
                    <span className={styles['trace-value']}>разом {shoppingItems.length}</span>
                  </span>
                  {!t.undone && <span className={styles['trace-go']}><Icon name="sys.next" size={16} inherit decorative /></span>}
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
            {isWriteOff(t) && t.applied && !t.undone && (() => {
              /* П6-Т3. Списання буває двох родів, і слід у них різний.
                 «Зʼїли все» лишається рядком тексту без стрілки: партії
                 більше немає, артефакта в неї теж — пігулка вела б у
                 порожнечу (живий репро 02.09, після карбонари).
                 «Зʼїли половину» — інша річ: партія жива, з новим числом, і
                 саме її людина йде перевіряти. Їй — звичайна пігулка зі
                 стрілкою в картку позиції.
                 Дельту не пишемо в жодному з них: у картці лежить нове
                 значення, старого вона не несе, вигадувати «−200 г» не
                 будемо. */
              const alive = survivingBatches(t, livePositions);
              const gone = goneLabels(t, livePositions);
              return (
                <>
                  {alive.length > 0 && (
                    <div className={styles['trace-wrap']}>
                      <button
                        type="button"
                        className={`${styles.trace} ${shownArtifact?.key === `batch:${alive[0]!.id}` ? styles['trace-on'] : ''}`}
                        onClick={() => openArtifact(`batch:${alive[0]!.id}`)}
                      >
                        <span className={styles['trace-icon']}><Icon name="sys.pantry" size={18} inherit decorative /></span>
                        <span className={styles['trace-body']}>
                          <span className={styles['trace-kind']}>
                            Списано{alive.length > 1 ? ` · ${alive.length} ${plural(alive.length, ['позиція', 'позиції', 'позицій'])}` : ''}
                          </span>
                          <span className={styles['trace-value']}>
                            {alive.map((b) => [b.label, formatQty(b.value, b.unit)].filter(Boolean).join(' ')).join(', ')}
                          </span>
                        </span>
                        <span className={styles['trace-go']}><Icon name="sys.next" size={16} inherit decorative /></span>
                      </button>
                    </div>
                  )}
                  {gone.length > 0 && (
                    <div className={styles['writeoff-line']}>Використали: {gone.join(', ')}</div>
                  )}
                </>
              );
            })()}
            {isIntakeArtifact(t) && !isWriteOff(t) && (
              /* Слід чека. Єдиний слід, що буває БУРШТИНОВИМ: поки чек не
                 застосовано, він не стан, а рішення, якого чекають. Після
                 «Застосувати» стає звичайним шавлієвим — стан як у всіх. */
              <button
                type="button"
                className={`${styles.trace} ${!t.applied && !t.undone ? styles['trace-pending'] : ''} ${shownArtifact?.turn?.id === t.id ? styles['trace-on'] : ''}`}
                onClick={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
                data-trace="intake"
              >
                <span className={styles['trace-icon']}><Icon name={isReceiptSourced(t) ? 'sys.receipt' : 'sys.pantry'} size={18} inherit decorative /></span>
                <span className={styles['trace-body']}>
                  <span className={styles['trace-kind']}>
                    {/* Чек називається чеком, решта — тим, чим є: «це додав
                        в комору» не чек, і вигадувати за людину, що вона
                        робила, ми не будемо. Етап 6b: слова етапу 3, форма —
                        пігулка бандла (знак · назва · підрядок · шеврон). */}
                    {isReceiptSourced(t) ? 'Чек' : 'У комору'} · {receiptLines(t)}{' '}
                    {plural(receiptLines(t), ['позиція', 'позиції', 'позицій'])}
                  </span>
                  {(() => {
                    const st = traceState(t.applied, t.undone, t.outcome, t.card?.ops?.length);
                    return (
                      <span className={`${styles['trace-value']} ${st.tone === 'pending' ? styles['pending-pulse'] : ''}`} data-trace-tone={st.tone}>{st.text}</span>
                    );
                  })()}
                </span>
                {!t.undone && <span className={styles['trace-go']}><Icon name="sys.next" size={16} inherit decorative /></span>}
              </button>
            )}
            {/* Подія в стрічці — це слід (нижче), не картка: інакше під слідом стояла б порожня рамка (EventCard поза панеллю рендерить null). */}
            {t.card && t.card.type !== 'event' && (
              /* Пул-6 №6, канон B: структуровані повідомлення системи — на
                 світлій «документ»-картці; службове (час/статус) лишається НАД. */
              /* О2 (1.1): онбординг має власну панель із тлом, рамкою і
                 радіусом — велика підложка під нею була б рамкою в рамці.
                 Той самий виняток, що вже зроблено для `event`, тільки
                 подія не малює нічого, а ця картка малює себе сама. */
              <CardShell
                plain={t.card.type === 'onboarding'}
                className={`${styles.doccard} ${t.justApplied ? styles['doccard-flash'] : ''} ${t.dismissed ? styles['doccard-off'] : ''} ${t.card.type === 'cart' || t.card.type === 'recipe_link' || isIntakeArtifact(t) || (t.card.type === 'shopping' && t.applied) ? styles['artifact-in-feed'] : ''}`}
              >
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
                onOpenArtifact={() => { const k = artifactKeyOf(t); if (k) openArtifact(k); }}
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
              </CardShell>
            )}
          </div>
        ))}

        {!historyOpen && drag && (
          /* Кухня відповідає ходом, як на будь-що інше: картка стоїть у кінці
             стрічки, над композитором, і зникає, щойно файл відпустили. */
          <DropCard drag={drag} max={MAX_ATTACHMENTS} />
        )}

      </div>

      <div className={styles['composer-wrap']}>
        {/* Етап 3 (Components · «Стани дії»): рядок стану НАД композитором —
            тут, а не в кінці стрічки, бо стрічка прокручується, а стан дії
            має бути видний рівно тоді, коли він є.
            Замість ходу «КУХНЯ · ДУМАЮ» з крапками — той самий годинник
            (Пул-9 №3), той самий «Стоп» (Пул-9 №4) і та сама остання фраза за
            довгого очікування, але одним рядком, у якому живуть і ліміт, і
            мережа, і «нічого не змінилось». Ліміт ≠ мережа ≠ нічого: три
            знаки, три слова, три різні дії від людини. */}
        {!historyOpen && (
          <ActionState
            sending={sending}
            waited={waited}
            parsing={thinkingVerb === 'РОЗБИРАЮ'}
            nothingChanged={nothingChanged}
            cardConflict={cardConflict}
            onStop={stopSending}
            onRetry={() => { useIncidentStore.getState().setOffline(false); void refreshCounts(); }}
            onRefresh={() => { setCardConflict(false); void refreshCounts(); }}
            longWaitNote={waited >= LONG_WAIT_S ? (thinkingVerb === 'РОЗБИРАЮ' ? 'Довгий чек, ще тримаю' : 'Ще тримаю') : null}
          />
        )}
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
            <span className={panelStyles['rail-pill-dot']} aria-hidden />
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
        <form
          className={`${styles.composer} ${listening ? styles['composer-recording'] : ''} ${drag ? styles['composer-armed'] : ''}`}
          onSubmit={send}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={fileAccept}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => pickFiles(e.target.files)}
          />
          <span className={styles['attach-wrap']}>
            <button type="button" className={`${styles['attach-plus']} ${attachOpen ? styles['attach-plus-on'] : ''}`}
              onClick={() => setAttachOpen((v) => !v)} disabled={uploading} aria-label="Додати вкладення" aria-expanded={attachOpen} data-attach-plus>
              <Icon name="sys.add" size={20} inherit decorative />
            </button>
            {attachOpen && (
              <div className={styles['attach-menu']} role="menu" data-attach-menu>
                <button type="button" role="menuitem" className={styles['attach-item']} onClick={() => pickVia('application/pdf,image/*')}>
                  <Icon name="sys.receipt" size={16} inherit decorative /><span>Чек · PDF або фото</span>
                </button>
                <button type="button" role="menuitem" className={styles['attach-item']} onClick={() => pickVia('image/*')}>
                  <Icon name="sys.photo" size={16} inherit decorative /><span>Фото полиці</span>
                </button>
                <button type="button" role="menuitem" className={styles['attach-item']} onClick={() => pickVia('text/plain')}>
                  <Icon name="sys.text" size={16} inherit decorative /><span>Список текстом</span>
                </button>
                <span className={styles['attach-hint']}>Або просто перетягни файл у розмову</span>
              </div>
            )}
          </span>
          {/* Пул-7 №3: під час запису — таймер + жива хвиля на ЛІВОМУ краю
              (канон моушн-кіта §04-2), стоп ■ лишається справа. */}
          {listening && <VoiceWave />}
          {/* Правка №8: textarea з авторостом угору, 1→8 рядків, далі скрол.
              Enter = надіслати, Shift+Enter = новий рядок. */}
          <textarea
            ref={composerInputRef}
            rows={1}
            className={styles['composer-input']}
            /* Етап 6a: поки поле у фокусі, нижній бар (<768) ховається (HANDOFF, ⚠6). */
            onFocus={() => document.body.classList.add('composer-focused')}
            onBlur={() => document.body.classList.remove('composer-focused')}
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
                void pickFiles(images, 'paste');
                return;
              }
              const text = e.clipboardData.getData('text/plain');
              if (text.length > 1500 && text.includes('\n') && pending.length < MAX_ATTACHMENTS) {
                e.preventDefault();
                void pasteAsAttachment(text);
              }
            }}
            placeholder={
              drag ? 'Відпусти — файл піде в розмову'
                : listening ? 'Слухаю…'
                : pending.length > 0 ? 'Що з цим?'
                : headForm === 'narrow' ? 'Що зʼявилось удома?'
                : 'Що зʼявилось удома або що готуємо?'
            }
            /* 6b-5c: автофокус — лише для вказівника; на дотиках клавіатура
               вискакувала сама, ховала бар і половину стрічки. */
            autoFocus={pointerDevice}
          />
          {/* Screens «Чат · збірка»: підказка «⌘K» dim перед мікрофоном — композитор
              ловить ⌘K з будь-де (Components «Композитор (⌘K з будь-де)»). */}
          <span className={styles['composer-kbd']} aria-hidden>⌘K</span>
          {/* 6b-5c, Screens/Prototype: мікрофон 42 простий muted — завжди на
              місці, кольори стану лише поки слухає; «надіслати» 42 чорнилом
              arrow-up — завжди, з порожнім драфтом світле коло й muted стрілка.
              Пул-9 №4: поки модель думає, місце мікрофона займає «Стоп». */}
          {sending && !listening ? (
            <button type="button" className={styles['frame-btn']} onClick={stopSending} aria-label="Зупинити" data-stop>
              <span className={styles['mic-stop']} />
            </button>
          ) : listening ? (
            /* 1.5b: рух — на знаку (mic пульсує 1.2 с), не на контейнері:
               кільце micpulse знято. Кольори стану — лише поки слухає. */
            <button type="button" className={styles['mic-live']} onClick={toggleVoice} aria-label="Зупинити диктування" aria-pressed="true">
              <Icon name="sys.voice" size={18} inherit decorative live="mic" />
            </button>
          ) : speechSupported() ? (
            <button type="button" className={styles['frame-btn-ghost']} onClick={toggleVoice} aria-label="Продиктувати" data-mic>
              <Icon name="sys.voice" size={18} inherit decorative />
            </button>
          ) : null}
          {/* Пул-9 №5: під час sending кнопка НЕ блокована — репліка лягає
              в стрічку і стає в чергу. Гасне лише коли черга повна. */}
          <button
            type="submit"
            className={`${styles['frame-btn-solid']} ${!(input.trim() || pending.length > 0) ? styles['frame-btn-idle'] : ''}`}
            disabled={(sending && queue.length >= QUEUE_MAX) || !(input.trim() || pending.length > 0)}
            title={sending && queue.length >= QUEUE_MAX ? 'дай відповісти' : undefined}
            aria-label="Надіслати"
            data-send
          ><Icon name="sys.send" size={18} inherit decorative /></button>
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
        /* Етап 10 (Errors E3): той самий Toast, що в Коморі й Списку — крапка
           роду (ok → sage, err → danger), речення, дія словом («Скасувати»,
           «Повторити»). Дія закриває тост сама. */
        <Toast
          tone={toast.kind === 'ok' ? 'sage' : toast.kind === 'warn' ? 'amber' : 'danger'}
          text={toast.text}
          action={toast.action ? { label: toast.action.label, run: () => { toast.action!.run(); setToast(null); } } : undefined}
          onDismiss={toast.persist ? undefined : () => setToast(null)}
        />
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
