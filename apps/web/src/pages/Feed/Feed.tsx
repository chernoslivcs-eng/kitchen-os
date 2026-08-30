// Стрічка — робочий цикл продукту з тризмісткою карток: intake_diff, proposal,
// shopping, profile. Дизайн ближче до брифу 04 Стрічка: заголовок «Кухня»,
// мета-рядок про стан комори/списку, mono-мітки перед секціями, спокійні
// переходи між станами картки (◌ ОЧІКУЄ → ✓ ЗАСТОСОВАНО → ↩ СКАСОВАНО).

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo/Logo';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { TabBar } from '../../components/TabBar/TabBar';
import { plural } from '../../lib/plural';
import { api, type AttachmentUploaded, type ChatCard, type ChatResponse, type MessageInfo } from '../../api';
import { Card, labelFor, appliedToast } from './cards';
import { useAuth } from '../../store/auth';
import { useSessionStore } from '../../store/session';
import { Avatar } from '../../components/Avatar/Avatar';
import { SkeletonRows } from '../../components/Skeleton/Skeleton';
import { speechSupported, startDictation, type Dictation } from '../../lib/speech';
import { loadCookSession, type CookSession } from '../../lib/cook-session';
import { stepLabelsFrom } from '../../lib/recipe';
import styles from './Feed.module.css';

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
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // DA-02: дев'ять секунд тиші на кожну відповідь моделі. Кіт: три крапки зі
  // stagger 150ms, мітка «КУХНЯ · <дієслово>» — завжди з дієсловом.
  const [thinkingVerb, setThinkingVerb] = useState('ДУМАЮ');
  const [pantryCount, setPantryCount] = useState<number | null>(null);
  const [staleBatches, setStaleBatches] = useState<{ id: string; label: string; days: number }[]>([]);
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
  const [cookLive, setCookLive] = useState<CookSession | null>(() => loadCookSession());
  useEffect(() => {
    const onVis = () => setCookLive(loadCookSession());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, []);

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
    } catch (err) {
      setToast({ id: Date.now(), kind: 'err', text: (err as Error).message });
    }
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
  const [unratedRun, setUnratedRun] = useState<{ id: string; title: string; session_id: string | null } | null>(null);

  async function refreshCounts() {
    try {
      const [p, s, pend, runs] = await Promise.all([
        api.pantry(),
        api.shopping.list().catch(() => ({ count: 0 })),
        api.cards.pending().catch(() => ({ cards: [] as { id: string; type: string; session_id: string | null; created_at: string | null }[] })),
        api.cookRuns.list().catch(() => ({ runs: [] })),
      ]);
      setHousePending(pend.cards);
      const fresh = runs.runs.find((r) =>
        !r.undone_at && r.rating == null
        && Date.now() - new Date(r.finished_at ?? r.started_at).getTime() < 48 * 3600_000);
      setUnratedRun(fresh ? { id: fresh.id, title: fresh.recipe.title, session_id: fresh.session_id ?? null } : null);
      setPantryCount(p.count);
      // Мапа id→label: рецепт-повідомлення показує «Вершки 33%», а не «з комори».
      setBatchLabels(new Map(p.batches.map((b) => [b.id, b.label])));
      setStepLabels(stepLabelsFrom(p.batches, p.products));
      setShoppingCount(s.count);
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
      setStaleBatches(stale);
    } catch { /* offline: лишаємо старе значення */ }
  }

  useEffect(() => { void refreshCounts(); }, []);

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

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
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

  function removePending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
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
        time: hhmm(),
        text: res.reply || undefined,
        card: res.card,
        cardId: res.card_id,
      };
      setTurns((prev) => [...prev, turn]);
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
    await dispatchChat(text, attachments);
  }

  async function apply(turnId: string, selected?: number[]) {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn?.cardId || turn.applying) return;
    setTurns((prev) => prev.map((t) => t.id === turnId ? { ...t, applying: true } : t));
    try {
      const r = await api.cards.apply(turn.cardId, selected);
      setTurns((prev) => prev.map((t) => t.id === turnId
        ? { ...t, applied: true, applying: false, undoToken: r.undo_token }
        : t,
      ));
      // Правка №6: застосована пост-кук картка списання продовжує розмову
      // детермінованим «Як вийшло?» — сервер уже записав його в сесію,
      // нам лишається показати хід без перезавантаження історії.
      if (r.followup) {
        setTurns((prev) => [...prev, { id: newId(), role: 'assistant', time: hhmm(), text: r.followup! }]);
      }
      // Оновлюємо лічильники для комори/списку — profile тепер теж може змінити те, що показуємо
      await refreshCounts();
      setToast({
        id: Date.now(),
        kind: 'ok',
        text: turn.card ? appliedToast(turn.card) : 'Готово',
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
          id: newId(), role: 'assistant', time: hhmm(),
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
          id: newId(), role: 'assistant', time: hhmm(),
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
    <div className={styles.screen}>
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
              КОМОРА {pantryCount}{shoppingCount > 0 ? ` · СПИСОК ${shoppingCount}` : ''}
            </MonoLabel>
          )}
          <Avatar name={meName} />
          {/* Правка №1: «+» — іконкою в самому правому куті шапки (мобайл;
              на десктопі новий чат живе в сайдбарі). */}
          <button
            onClick={startFreshSession}
            title="Нова сесія"
            aria-label="Нова сесія"
            className={styles['new-session-btn']}
          >+</button>
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
      </div>


      <div className={styles.timeline} ref={timelineRef}>
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
            {t.text && <div className={styles['turn-text']}>{t.text}</div>}
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
            {t.card && (
              <Card
                card={t.card}
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
                onCook={(r, rid) => navigate('/cook', { state: { recipe: r, recipeId: rid, returnSessionId: sessionId } })}
                onShare={(r, rid) => navigate('/share', { state: { recipe: r, recipeId: rid } })}
                onSaveRecipe={saveRecipeForLater}
                savedRecipeIds={savedRecipeIds}
                onNeedToList={addNeedToList}
                batchLabels={batchLabels}
                stepLabels={stepLabels}
              />
            )}
          </div>
        ))}

        {!historyOpen && sending && (
          <div className={styles.turn} aria-live="polite">
            <MonoLabel tone="muted">КУХНЯ · {thinkingVerb}</MonoLabel>
            <div className={styles.thinking}>
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <div className={styles['composer-wrap']}>
        {/* UX9-09: «Готування триває» жило В САМОМУ ВЕРХУ стрічки — на момент
            виходу з Cook Mode воно було на 2000+ px вище вʼюпорта. Тепер над
            композитором: видиме завжди, доки готування живе. */}
        {/* Пул-2 №2: на десктопі фрейм живе в сайдбарі (TabBar) — цей банер
            лишається тільки для мобільної верстки (клас ховає його ≥1024). */}
        {cookLive && !historyOpen && (
          <button
            className={styles['cook-banner-mobile']}
            onClick={() => navigate('/cook', { state: { recipe: cookLive.recipe, recipeId: cookLive.recipeId, returnSessionId: cookLive.returnSessionId ?? sessionId } })}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              border: '1px solid var(--accent-border)', borderRadius: 14,
              padding: '13px 16px', margin: '0 0 8px', background: 'var(--bg-surface)',
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }} />
            <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>
              Готування триває · {cookLive.recipe.t} · крок {Math.min(cookLive.stepIdx + 1, cookLive.recipe.st.length)}/{cookLive.recipe.st.length}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--accent)', textTransform: 'uppercase' }}>
              Продовжити ›
            </span>
          </button>
        )}
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
              <span key={a.id} className={styles['att-chip']} title={a.content_type}>
                {a.kind === 'image' ? (
                  <img src={`/v1/attachments/${a.id}/bytes`} alt="" className={styles['att-thumb']} />
                ) : (
                  <span className={styles['att-ext']}>{a.kind === 'pdf' ? 'PDF' : 'TXT'}</span>
                )}
                <button
                  type="button"
                  className={styles['att-remove']}
                  onClick={() => removePending(a.id)}
                  aria-label="Прибрати"
                >×</button>
              </span>
            ))}
            {uploading && <span className={styles['att-chip']}><span className={styles['att-ext']}>…</span></span>}
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
            <button
              type="button"
              className={styles['mic-live']}
              onClick={toggleVoice}
              aria-label="Зупинити диктування"
              aria-pressed="true"
            >
              <span className={styles['mic-stop']} />
            </button>
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
      <aside className={styles.rail}>
        {pantryCount !== null && pantryCount > 0 && (
          <div className={styles['rail-block']}>
            <div className={styles['rail-title']}>СТАТУС КОМОРИ</div>
            <button className={styles['rail-row']} onClick={() => navigate('/pantry')}>
              <span className={styles['rail-label']}>Позицій у домі</span>
              <span className={styles['rail-meta']}>{pantryCount}</span>
            </button>
            {staleBatches.slice(0, 4).map((b) => (
              <button
                key={b.id}
                className={styles['rail-row']}
                onClick={() => { setInput(`Що зробити з ${b.label}?`); composerInputRef.current?.focus(); }}
              >
                <span className={styles['rail-label']}>{b.label}</span>
                <span className={styles['rail-meta']} style={{ color: 'var(--amber)' }}>
                  {b.days <= 0 ? 'СЬОГОДНІ' : `≈${b.days} ДН`}
                </span>
              </button>
            ))}
          </div>
        )}
        {(() => {
          // Пропозиції цієї сесії — назвами страв, не «ПРОПОЗИЦІЯ, ПРОПОЗИЦІЯ».
          const dishes = turns.flatMap((t) => {
            if (t.card?.type === 'proposal') {
              return ((t.card.items as { title?: string }[] | undefined) ?? [])
                .map((it) => ({ turnId: t.id, title: it.title ?? '' }));
            }
            if (t.card?.type === 'recipe_link') {
              return [{ turnId: t.id, title: (t.card.title as string | undefined) ?? '' }];
            }
            return [];
          }).filter((d) => d.title);
          if (!dishes.length) return null;
          return (
            <div className={styles['rail-block']}>
              <div className={styles['rail-title']}>ПРОПОЗИЦІЇ ЦІЄЇ СЕСІЇ</div>
              {dishes.slice(-5).map((d, i) => (
                <button
                  key={`${d.turnId}-${i}`}
                  className={styles['rail-row']}
                  onClick={() => document.getElementById(`turn-${d.turnId}`)?.scrollIntoView({ block: 'center' })}
                >
                  <span className={styles['rail-label']}>{d.title}</span>
                  <span className={styles['rail-meta']}>↧</span>
                </button>
              ))}
            </div>
          );
        })()}
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
        {shoppingCount > 0 && (
          <div className={styles['rail-block']}>
            <div className={styles['rail-title']}>ДО МАГАЗИНУ</div>
            <button className={styles['rail-row']} onClick={() => navigate('/list')}>
              <span className={styles['rail-label']}>У списку</span>
              <span className={styles['rail-meta']}>{shoppingCount}</span>
            </button>
          </div>
        )}
        {unratedRun && !cookLive && (
          <div className={styles['rail-block']}>
            <div className={styles['rail-title']}>ОЦІНИ ВЧОРАШНЄ</div>
            <button
              className={styles['rail-row']}
              onClick={() => {
                // Ведемо в сесію готування (там найчастіше висить «Як вийшло?» —
                // відповідь ляже у verdict) і префілимо композитор назвою.
                if (unratedRun.session_id && unratedRun.session_id !== sessionId) {
                  void loadHistorySession(unratedRun.session_id);
                }
                setInput(`«${unratedRun.title}» — `);
                composerInputRef.current?.focus();
              }}
            >
              <span className={styles['rail-label']}>{unratedRun.title}</span>
              <span className={styles['rail-meta']}>★</span>
            </button>
          </div>
        )}
      </aside>

      <TabBar shoppingCount={shoppingCount} />

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
