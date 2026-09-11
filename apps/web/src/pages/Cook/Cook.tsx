// Cook Mode — 10 з брифу. Ключове: таймер живе локально (setInterval),
// нічого не звертається до сервера під час готування. Прогрес між кроками
// теж локальний. Якщо колись зʼявиться CookRun у БД — «Готово» пуш-ошне
// подія списання, тут ми зберігаємо тільки локальний стан.

import { Icon } from '../../components/Icon/Icon';
import { useEffect, useRef, useState } from 'react';
import { track } from '../../lib/track';
import { useNavigate } from 'react-router-dom';
import { currentTheme, setThemeOverride, type ThemeChoice } from '../../theme';
import { api, type Recipe } from '../../api';
import { plural } from '../../lib/plural';
import { formatQty } from '../../lib/units';
import { useIncidentStore } from '../../store/incident';
import { saveCookSession, loadCookSession, clearCookSession, stashUnsavedRun } from '../../lib/cook-session';
import { useCookStore } from '../../store/cook';
import { renderStepContent, stepIngredients, resolveIngName, stepLabelsFrom, type BatchLabels } from '../../lib/recipe';
import styles from './Cook.module.css';

// Крок Т1: довгий крок (ферментація, тісто на ніч) відлічувався як «150:00» —
// хвилини понад дві години перестають читатись.
//
// Формат вибирає ДОВЖИНА КРОКУ, а не залишок. Інакше відлік на 150 хв
// перестрибував би з «2:00:01» на «119:59» посеред роботи — а таймер, що на
// очах міняє одиниці, читається як зламаний. Крок довший за дві години живе в
// год:хв:сек від першої секунди до нуля.
export function formatMS(secondsLeft: number, stepSeconds = secondsLeft): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const sec = s % 60;
  const totalM = Math.floor(s / 60);
  if (stepSeconds <= 120 * 60) return `${totalM}:${String(sec).padStart(2, '0')}`;
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function CookOverlay() {
  const navigate = useNavigate();
  // Пул-3: поп-ап. Стан приходить зі стора, не з навігації.
  const state = useCookStore((s) => s.args) ?? {} as Partial<import('../../store/cook').CookOpenArgs>;
  const closeOverlay = useCookStore((s) => s.close);
  const recipe = state.recipe ?? null;
  const [stepIdx, setStepIdx] = useState(state.startAt ?? 0);
  // №10 (рішення власника): зроблені кроки — явна множина, а не «усе до
  // поточного»: маршрут відкритий на будь-який крок, і «Крок готово»
  // відмічає той, на якому стоїш.
  const [done, setDone] = useState<Set<number>>(() => new Set());
  // DA2-03: подвійний тап мокрим пальцем перескакував крок (1 → 3). 400ms
  // локу — рівно --dur-slow, тривалість зміни кроку. №10: лок стоїть лише на
  // «Крок готово» (там подвійний тап відмітив би ще й наступний); навігація
  // маршрутом, сегментами й «Назад» — без лока.
  const [stepLocked, setStepLocked] = useState(false);
  // №10: таймери кроків, з яких пішли. Таймер, що біг, несе дедлайн і йде
  // далі; на паузі — залишок. Поточний крок живе в secondsLeft/running.
  type StepTimer = { deadline: number | null; left: number };
  const timersRef = useRef<Record<number, StepTimer>>({});
  const [, setTick] = useState(0);
  // Вигляд (cook-share-v3): тема застосунку (sun/moon), звук beep, шторка кроків на 390.
  const [theme, setThemeState] = useState<ThemeChoice>(() => currentTheme());
  const setTheme = (t: ThemeChoice) => { setThemeOverride(t); setThemeState(t); };
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false); mutedRef.current = muted;
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => { setSheetOpen(false); }, [stepIdx]);

  // Крок О1а: почали готувати. Кроки й фініш нижче — разом вони дають
  // єдину криву, де видно, на чому люди зупиняються.
  useEffect(() => { if (recipe) track('cook_started', { steps: recipe.st.length }); }, [recipe?.t]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (recipe) track('cook_step_reached', { step: stepIdx + 1, of: recipe.st.length }); }, [stepIdx]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Бриф-3 п.1: повернення на пройдений крок — тап по смузі або ↩.
  // Таймер при поверненні стає на паузу (він не «відмотує час», людина
  // сама вирішить, чи запускати).
  // Пул-3: «✕» — це закрити поп-ап. Людина лишається там, де була;
  // прогрес живе в kos-cook-live, банери повернуть назад.
  function exitToOrigin() {
    // Крок О1а: кинуте готування — і на якому саме кроці. Це та подія, що
    // каже, де рецепт перестає бути здійсненним.
    if (!finishedRef.current) track('cook_abandoned', { step: stepIdx + 1, of: recipe?.st.length ?? 0 });
    closeOverlay();
  }

  // №10: перехід на будь-який крок — зроблений, наступний, будь-який. Таймер
  // кроку, з якого йдемо, лишається в timersRef: біг — іде далі за дедлайном.
  function goToStep(n: number) {
    if (n === stepIdx || n < 0 || n >= (recipe?.st.length ?? 0)) return;
    stopAlarm();
    if (step?.s) timersRef.current[stepIdx] = { deadline: running ? deadlineRef.current : null, left: secondsLeft };
    setStepIdx(n);
  }

  // «Крок готово»: відмічає поточний крок і веде на перший невідмічений після
  // нього (або перший невідмічений узагалі; усі відмічені — на останній, де
  // стоїть «Приготував»).
  function markDone() {
    if (stepLocked) return;
    setStepLocked(true);
    window.setTimeout(() => setStepLocked(false), 400);
    const total = recipe?.st.length ?? 0;
    const next = new Set(done); next.add(stepIdx); setDone(next);
    let target = -1;
    for (let i = stepIdx + 1; i < total; i++) if (!next.has(i)) { target = i; break; }
    if (target < 0) for (let i = 0; i < total; i++) if (!next.has(i)) { target = i; break; }
    if (target < 0) target = total - 1;
    goToStep(target);
  }
  const [batchLabels, setBatchLabels] = useState<BatchLabels>(new Map());
  // №4а: кроки показують тільки product — без бренду й варіанта.
  const [stepLabels, setStepLabels] = useState<BatchLabels>(new Map());

  useEffect(() => {
    // Мапа id партії → людський label. Модель показує на комору через `ing.p`
    // (uuid), крокі мають плейсхолдери {0} → назва інгредієнта, не uuid.
    api.pantry()
      .then(({ batches, products }) => {
        setBatchLabels(new Map(batches.map((b) => [b.id, b.label])));
        setStepLabels(stepLabelsFrom(batches, products));
      })
      .catch(() => {/* silent */});
  }, []);

  // Таймер на активний крок. Якщо в кроку немає step.s — таймер не показуємо.
  const step = recipe?.st[stepIdx];
  const initialTimer = step?.s ?? 0;
  const [secondsLeft, setSecondsLeft] = useState(initialTimer);
  const [running, setRunning] = useState(false);
  const tickRef = useRef<number | null>(null);

  // Зміна кроку: таймер кроку, на який прийшли, — з timersRef (біг → залишок
  // від дедлайну і біжить далі; пауза → збережений залишок), інакше повний.
  useEffect(() => {
    const saved = timersRef.current[stepIdx];
    if (saved) {
      delete timersRef.current[stepIdx];
      if (saved.deadline) {
        const left = Math.max(0, Math.ceil((saved.deadline - Date.now()) / 1000));
        setSecondsLeft(left);
        setRunning(left > 0);
      } else {
        setSecondsLeft(saved.left);
        setRunning(false);
      }
      return;
    }
    setSecondsLeft(step?.s ?? 0);
    setRunning(false);
  }, [stepIdx, step?.s]);

  // №10: таймери кроків, з яких пішли, тікають у маршруті раз на секунду; нуль
  // — один сигнал (повторний вартовий — лише в поточного кроку).
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      let any = false;
      for (const [k, t] of Object.entries(timersRef.current)) {
        if (t.deadline == null) continue;
        any = true;
        if (t.deadline <= now) { timersRef.current[Number(k)] = { deadline: null, left: 0 }; beep(); }
      }
      if (any) setTick((v) => v + 1);
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QA8-03: таймер рахує від дедлайну, не тіками. Лічильник тіків втрачав
  // час на будь-якому дроселі (виміряно: 2000мс/тік, паста на 8:00 варилась
  // би 16 хвилин), а StrictMode-подвоєння ефекту робило його недетермінованим.
  // З дедлайном хоч десять інтервалів пишуть одне й те саме обчислене число,
  // а заморожена вкладка наздоганяє час першим же тіком. Це ж робить точним
  // відновлення сесії (QA8-06): зберігаємо залишок, порахований з дедлайну.
  const deadlineRef = useRef<number | null>(null);
  // Пул-7 №1: дзеркало running для unmount-запису — стан у cleanup замкнутий,
  // а знімок рендера дедлайну ще не бачить (ефект ставить його ПІСЛЯ рендера).
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = running;
    if (!running) {
      if (tickRef.current != null) window.clearInterval(tickRef.current);
      tickRef.current = null;
      deadlineRef.current = null;
      return;
    }
    deadlineRef.current = Date.now() + secondsLeft * 1000;
    tickRef.current = window.setInterval(() => {
      const d = deadlineRef.current;
      if (d == null) return;
      setSecondsLeft(Math.max(0, Math.ceil((d - Date.now()) / 1000)));
    }, 250);
    return () => {
      if (tickRef.current != null) window.clearInterval(tickRef.current);
    };
    // secondsLeft свідомо не в залежностях: дедлайн фіксується на старті,
    // а «+1 хв» коригує його напряму.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (secondsLeft === 0 && running) setRunning(false);
  }, [secondsLeft, running]);

  // Бриф-3 п.2: відновлення перерваного готування того самого рецепта.
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    resumeRef.current = true;
    const saved = loadCookSession();
    if (saved && recipe && saved.recipe.t === recipe.t && saved.stepIdx < recipe.st.length) {
      // №10: зроблені кроки — зі збереженої множини; стара сесія без неї —
      // «усе до поточного», як було. Таймери інших кроків — теж.
      setDone(new Set(saved.done ?? Array.from({ length: saved.stepIdx }, (_, i) => i)));
      if (saved.timers) timersRef.current = { ...saved.timers };
      setStepIdx(saved.stepIdx);
      // Пул-7 №1: дедлайн живий → рахунок ішов увесь цей час і продовжує йти;
      // дедлайн минув → 0:00, алярм наздожене ефектом нуля. Пауза (без
      // дедлайна) — як і раніше, з збереженим залишком.
      if (saved.deadline) {
        const left = Math.max(0, Math.ceil((saved.deadline - Date.now()) / 1000));
        setSecondsLeft(left);
        setRunning(left > 0);
      } else {
        setSecondsLeft(saved.secondsLeft);
        setRunning(false);
      }
    } else if (saved && recipe && saved.recipe.t !== recipe.t) {
      // QA8-07: тут живе ІНШЕ незавершене готування. Мовчки затерти його —
      // втратити чиїсь пів рецепта. Питаємо; відмова повертає до стрічки,
      // де рядок «Готування триває» веде до старої сесії.
      const drop = window.confirm(
        `Ти вже готуєш «${saved.recipe.t}». Зупинити й почати «${recipe.t}»?`,
      );
      if (!drop) {
        closeOverlay();   // поп-ап: відмова = просто закрити, людина де була
        return;
      }
      clearCookSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // DA2-07: планшет біля плити не має гаснути на другій хвилині тушкування.
  // Wake Lock знімається системою при згортанні — перезапитуємо на поверненні.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    let alive = true;
    async function acquire() {
      try {
        const wl = (navigator as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
        if (wl && alive) lock = await wl.request('screen');
      } catch { /* заборонено політикою або низький заряд — тихо */ }
    }
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Пул-7 №1: звуковий супровід відліку — ДУЖЕ легкий (юзер: «дуууже
  // легкі»): тік щосекунди ледь чутний, 5-кратні трохи помітніші, межа
  // хвилини — м'який подвійний. Тільки поки таймер біжить і попап відкритий.
  const softTick = (kind: 'sec' | 'five' | 'minute') => {
    if (mutedRef.current) return;
    try {
      type AC = typeof AudioContext;
      const Ctx: AC | undefined = window.AudioContext
        ?? (window as { webkitAudioContext?: AC }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const blip = (at: number, freq: number, gain: number, dur: number) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
        osc.connect(g).connect(ctx.destination);
        osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + dur + 0.02);
      };
      if (kind === 'sec') blip(0, 2100, 0.012, 0.03);
      else if (kind === 'five') blip(0, 1400, 0.025, 0.05);
      else { blip(0, 1000, 0.04, 0.06); blip(0.09, 1400, 0.04, 0.06); }
      window.setTimeout(() => void ctx.close(), 400);
    } catch { /* без звуку */ }
  };
  const prevSecRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running || secondsLeft <= 0) { prevSecRef.current = secondsLeft; return; }
    if (prevSecRef.current !== null && secondsLeft !== prevSecRef.current) {
      if (secondsLeft % 60 === 0) softTick('minute');
      else if (secondsLeft % 5 === 0) softTick('five');
      else softTick('sec');
    }
    prevSecRef.current = secondsLeft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, running]);

  // DA2-08: таймер, який мовчить, — це таймер, якого немає. Кіт: сигнал
  // повторюється кожні 30с, поки людина не підтвердить (будь-яка дія кроку).
  const alarmRef = useRef<number | null>(null);
  const beep = () => {
    // volume-2 у шапці: вимкнено — без звуку, вібро й нотифікація лишаються.
    if (!mutedRef.current) try {
      type AC = typeof AudioContext;
      const Ctx: AC | undefined = window.AudioContext
        ?? (window as { webkitAudioContext?: AC }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.65);
      osc.onended = () => void ctx.close();
    } catch { /* без звуку — лишається вібро */ }
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* desktop */ }
    // Моушн-2 №7: вкладка згорнута — системна нотифікація, звук сам не доб'ється.
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Kitchen OS · таймер', {
          body: `${step?.t ?? 'Крок'} — час вийшов`,
          tag: 'kitchen-os-timer',
        });
      }
    } catch { /* нотифікації не критичні */ }
  };
  const stopAlarm = () => {
    if (alarmRef.current != null) { window.clearInterval(alarmRef.current); alarmRef.current = null; }
  };
  useEffect(() => {
    if (secondsLeft === 0 && step?.s && !finishedRef.current) {
      beep();
      alarmRef.current = window.setInterval(beep, 30_000);
      return stopAlarm;
    }
    stopAlarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft === 0]);


  // QA8-20: guard стоїть ПІСЛЯ всіх хуків — кількість викликаних хуків
  // не залежить від наявності рецепта (Rules of Hooks).
  if (!recipe) return null;

  const total = recipe.st.length;
  const nextStep = stepIdx < total - 1 ? recipe.st[stepIdx + 1] : null;

  // Актуальний знімок для збереження — оминаємо замикання ефектів.
  const sessionSnapRef = useRef({ stepIdx, secondsLeft, done });
  sessionSnapRef.current = { stepIdx, secondsLeft, done };
  useEffect(() => {
    if (!recipe || finishedRef.current) return;
    // Пул-7 №1: running → пишемо дедлайн, рахунок живе поза попапом.
    saveCookSession({ recipe, stepIdx, secondsLeft, deadline: running ? deadlineRef.current : null, recipeId: state.recipeId, returnSessionId: state.returnSessionId, done: [...done], timers: timersRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, running, done]);
  // QA8-06: «Вийти» за 20 секунд до кінця повертало повний таймер — запис
  // ішов тільки на дію. Тепер вихід (unmount) пише точний залишок.
  useEffect(() => {
    if (!recipe) return;
    return () => {
      const snap = sessionSnapRef.current;
      // Пул-7 №1: дедлайн беремо з рефів у момент виходу (знімок рендера
      // відстає на один ефект — вихід одразу після «Пуск» губив би рахунок).
      const dl = runningRef.current ? deadlineRef.current : null;
      const left = dl != null ? Math.max(0, Math.ceil((dl - Date.now()) / 1000)) : snap.secondsLeft;
      if (!finishedRef.current) saveCookSession({ recipe, stepIdx: snap.stepIdx, secondsLeft: left, deadline: dl, recipeId: state.recipeId, returnSessionId: state.returnSessionId, done: [...snap.done], timers: timersRef.current });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.t]);

  // Правка №6: фінішного екрана більше немає — «Приготували» закриває Cook
  // Mode як поп-ап і повертає в сесію запуску, де сервер уже поклав
  // детерміноване «Списати продукти?». Списання їде звичайною intake_diff-
  // карткою після «так», оцінка — реплікою на «Як вийшло?». Канони Бриф-2
  // п.4 (модалка «Що списуємо повністю?») і п.7 (ретро-оцінка на фініші)
  // скасовано свідомо (рішення Пилипа, 2026-08-30).
  const [finishing, setFinishing] = useState(false);
  const finishedRef = useRef(false);
  /**
   * Крок О2 (3): `after` каже, куди йти після запису. «Поділитись
   * результатом» — не обхідний шлях повз журнал: воно робить рівно ту саму
   * роботу, що «Приготували», і лише потім веде на /share.
   *
   * Якщо запис у журнал не вдався — на /share НЕ йдемо. Ділитись нема чим:
   * готування не записалось і продукти не спишуться. Поводимось так само, як
   * на звичайному провалі «Приготували» — ведемо в стрічку, людину в пастці не
   * тримаємо.
   */
  async function finish(after: 'feed' | 'share' = 'feed') {
    if (finishing || finishedRef.current) return;
    track('cook_finished', { steps: recipe?.st.length ?? 0 });
    stopAlarm();
    setFinishing(true);
    finishedRef.current = true;
    clearCookSession();
    // Сесія для пост-кук діалогу: точка запуску, або сесія дня (входи без
    // returnSessionId — «Знову» з журналу, адресна сторінка рецепта).
    let sid = state.returnSessionId ?? null;
    if (!sid) {
      try { sid = (await api.session.today()).session.id; } catch {/* offline */}
    }
    let saved = true;
    const opts = {
      skip_pantry: true,
      recipe_id: state.recipeId,
      session_id: sid ?? undefined,
      ask_writeoff: true,
    };
    try {
      await api.cookRuns.save(recipe!, opts);
    } catch {
      // Офлайн, 5xx — людину в пастці не тримаємо, але й не мовчимо (етап 5,
      // п.6): те саме тіло запиту лягає у сховок, смуга над колонкою каже
      // «не записалось», «Повторити» шле його ще раз. Без цього готування
      // — єдиний автоматичний писач знаменника метрики — губилось би тихо.
      saved = false;
      const run = { recipe: recipe!, opts, at: Date.now() };
      stashUnsavedRun(run);
      useIncidentStore.getState().setUnsavedCook(run);
    }
    closeOverlay();
    if (after === 'share' && saved && recipe) {
      // Той самий стан, що й точки входу зі стрічки.
      navigate('/share', { state: { recipe, recipeId: state.recipeId } });
      return;
    }
    navigate('/app', sid ? { state: { sessionId: sid, at: Date.now() } } : undefined);
  }

  // ── Вигляд (feat/cook-share-v3) — за Prototype «COOK MODE» (1440) і Cook and
  // Share «Cook · 768» / «Cook · 390». Логіка вище не мінялась: кроки, таймер,
  // дедлайн, beep, wake lock, finish() — як були. Три розкладки за вʼюпортом
  // (Cook — повноекранний попап, контейнер = вʼюпорт): ≥1024 маршрут колонкою
  // зліва; 768–1023 маршрут чіпами над фокусом; <768 фокус на весь екран,
  // сегменти вгорі, пілюля «N з M · крок» → шторка кроків. Тема — наявна тема
  // застосунку (sun/moon); «Cook Mode памʼятає свою тему окремо» — Р72.
  // Звук — volume-2 вмикає/вимикає наявний beep (нових звуків нема).
  const shortOf = (st: { t: string }) => st.t.replace(/\.$/, '');
  const stepText = renderStepContent(step?.c ?? '', recipe.ing, stepLabels);
  const stepIngs = step ? stepIngredients(step.c ?? '', recipe.ing) : [];
  const stepMeta = (st: { s?: number }) => (st.s ? `${Math.max(1, Math.round(st.s / 60))} хв` : '');
  const timerTone = running && secondsLeft > 0 && secondsLeft <= 60 ? 'amber' : 'ink';
  const timerBase = step?.s ? formatMS(step.s, step.s) : '';
  const timerPct = step?.s ? Math.round(100 - (secondsLeft / step.s) * 100) : 0;
  const nextLabel = nextStep ? `Далі: ${shortOf(nextStep).toLocaleLowerCase('uk')}` : 'Це останній крок';
  const isLast = stepIdx === total - 1;

  const timerToggle = () => {
    stopAlarm();
    // Моушн-2 №7: дозвіл на нотифікації питаємо в момент юзер-жесту старту
    // таймера; відмова = просто без них.
    try {
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    } catch { /* ок */ }
    if (secondsLeft === 0) { setSecondsLeft(step?.s ?? 0); setRunning(true); return; }
    setRunning((r) => !r);
  };
  const plusMinute = () => {
    if (deadlineRef.current != null) {
      deadlineRef.current += 60_000;
      // Пул-7 №1: сесія несе дедлайн — банери/вартовий мусять побачити +хвилину одразу.
      saveCookSession({ recipe, stepIdx, secondsLeft: secondsLeft + 60, deadline: deadlineRef.current, recipeId: state.recipeId, returnSessionId: state.returnSessionId, done: [...done], timers: timersRef.current });
    }
    setSecondsLeft((v) => v + 60);
  };
  const timerLabel = secondsLeft === 0 ? 'Спочатку' : running ? 'Пауза' : secondsLeft === (step?.s ?? 0) ? 'Старт' : 'Далі';

  // Маршрут (список кроків) — один на колонку 1440, чіпи 768 і шторку 390.
  const routeRow = (i: number, mode: 'list' | 'chips') => {
    const st = recipe.st[i]!;
    const isDone = done.has(i), cur = i === stepIdx;
    const tone = isDone ? 'done' : cur ? 'cur' : 'next';
    // №10: таймер кроку, з якого пішли, видно в маршруті, поки він біжить.
    const bg = !cur && st.s ? timersRef.current[i] : undefined;
    const bgLeft = bg?.deadline ? Math.max(0, Math.ceil((bg.deadline - Date.now()) / 1000)) : null;
    return (
      <button key={i} type="button"
        className={`${styles['route-row']} ${styles[`row-${mode}`]} ${styles[`route-${tone}`]}`}
        onClick={() => goToStep(i)}
        aria-current={cur ? 'step' : undefined}
        aria-pressed={isDone || undefined}
        data-route-step={i + 1}
        data-route-done={isDone || undefined}>
        <span className={styles['route-n']}>{isDone ? <Icon name="sys.done" size={16} inherit decorative /> : i + 1}</span>
        <span className={styles['route-t']}>{shortOf(st)}</span>
        <span className={styles['route-r']}>
          {cur && st.s ? <><Icon name="cook.timer" size={12} inherit decorative />{formatMS(secondsLeft, st.s)}</>
            : bgLeft != null ? <><Icon name="cook.timer" size={12} inherit decorative live="timer" />{formatMS(bgLeft, st.s!)}</>
            : stepMeta(st)}
        </span>
      </button>
    );
  };

  const themeToggle = (
    <span className={styles.theme} role="group" aria-label="Тема">
      <button type="button" className={`${styles['theme-btn']} ${theme === 'light' ? styles['theme-on'] : ''}`} onClick={() => setTheme('light')} aria-pressed={theme === 'light'} aria-label="Світла тема">
        <Icon name="cook.themeLight" size={16} inherit decorative />
      </button>
      <button type="button" className={`${styles['theme-btn']} ${theme === 'dark' ? styles['theme-on'] : ''}`} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'} aria-label="Темна тема">
        <Icon name="cook.themeDark" size={16} inherit decorative />
      </button>
    </span>
  );
  const soundBtn = (
    <button type="button" className={`${styles.round} ${muted ? styles['round-off'] : ''}`} onClick={() => setMuted((m) => !m)} aria-pressed={!muted} aria-label={muted ? 'Увімкнути звук' : 'Вимкнути звук'} title={muted ? 'Звук вимкнено' : 'Звук'}>
      <Icon name="sys.sound" size={16} inherit decorative />
    </button>
  );

  const timerBox = !!step?.s && (
    <div className={`${styles.timer} ${styles[`timer-${timerTone}`]} ${secondsLeft === 0 ? styles['timer-zero'] : ''}`} data-timer>
      <span className={styles['timer-icon']}><Icon name="cook.timer" size={20} inherit decorative live={running && secondsLeft > 0 ? 'timer' : undefined} /></span>
      <span className={`${styles['timer-value']} t-timer`} data-timer-value>{formatMS(secondsLeft, step.s)}</span>
      <span className={styles['timer-base']}>
        <span>з {timerBase}</span>
        <span className={styles.bar}><span className={styles['bar-fill']} style={{ width: `${Math.max(0, Math.min(100, timerPct))}%` }} /></span>
      </span>
      <span className={styles['timer-gap']} />
      <button type="button" className={styles['timer-main']} onClick={timerToggle} data-timer-toggle>
        <Icon name={running ? 'cook.pause' : 'cook.play'} size={16} inherit decorative />{timerLabel}
      </button>
      <button type="button" className={styles['timer-plus']} onClick={plusMinute} data-timer-plus>+1 хв</button>
    </div>
  );

  // Низ: «← Назад» · «N · Далі: …» · «✓ Крок готово» / «✓ Приготував».
  // Дія: markDone() (№10 — відмічає крок, на якому стоїш) / finish().
  const bottomRow = (
    <div className={styles.bottom}>
      <button type="button" className={styles.back} onClick={() => goToStep(stepIdx - 1)} disabled={stepIdx === 0} aria-label="Назад" data-step-back>
        <Icon name="sys.back" size={18} inherit decorative /><span className={styles['back-text']}>Назад</span>
      </button>
      <div className={styles['next-hint']} data-next-hint>
        <span className={styles['next-n']}>{Math.min(total, stepIdx + 2)}</span>
        <span className={styles['next-t']}>{nextLabel}</span>
      </div>
      <button type="button" className={styles.go} disabled={stepLocked || finishing}
        onClick={isLast ? () => void finish() : markDone} data-step-done={isLast ? undefined : true} data-finish={isLast ? true : undefined}>
        <Icon name="sys.done" size={20} inherit decorative />{isLast ? (finishing ? 'Зберігаю…' : 'Приготував') : 'Крок готово'}
      </button>
    </div>
  );
  // Крок О2 (3): другий вихід «Поділитись результатом» — та сама робота, що
  // «Приготував», і лише потім /share. Лише на останньому кроці, текстом.
  const shareRow = isLast && (
    <button type="button" className={styles['share-result']} disabled={finishing} onClick={() => void finish('share')} data-share-result>
      Поділитись результатом
    </button>
  );

  return (
    <div className={styles.shell} data-cook-mode>
    <div className={styles.screen}>
      {/* 390: сегменти прогресу вгорі; тап по будь-якому сегменту — перехід (№10). */}
      <div className={styles.segments} aria-hidden>
        {recipe.st.map((_, i) => (
          <button key={i} type="button" className={`${styles.seg} ${done.has(i) ? styles['seg-done'] : i === stepIdx ? styles['seg-cur'] : ''}`}
            tabIndex={-1} onClick={() => goToStep(i)} />
        ))}
      </div>

      <header className={styles.head}>
        <button type="button" className={styles.exit} onClick={exitToOrigin} data-exit>
          <Icon name="sys.close" size={16} inherit decorative /><span className={styles['exit-text']}>Вийти</span>
        </button>
        {/* 390: пілюля «N з M · крок» зі знаком списку → шторка кроків. */}
        <button type="button" className={styles['step-pill']} onClick={() => setSheetOpen(true)} aria-haspopup="dialog" data-step-pill>
          <span className={styles['step-pill-n']}>{stepIdx + 1} з {total}</span>
          <span className={styles['step-pill-t']}>· {step ? shortOf(step) : ''}</span>
          <span className={styles['step-pill-gap']} />
          <Icon name="cook.steps" size={16} inherit decorative />
        </button>
        <span className={styles['head-title']}><Icon name="cook.type" size={16} inherit decorative />{recipe.t}</span>
        <span className={styles['head-theme']}>{themeToggle}</span>
        {soundBtn}
      </header>

      <div className={styles.body}>
        {/* 1440: маршрут колонкою; 768: чіпами; 390: у шторці. */}
        <aside className={styles.route} data-route>
          <div className={styles['route-meta']}>
            {recipe.tm ? <span><Icon name="cook.time" size={12} inherit decorative />{recipe.tm} хв</span> : null}
            {recipe.sv ? <span><Icon name="cook.portions" size={12} inherit decorative />{recipe.sv} {plural(recipe.sv, ['порція', 'порції', 'порцій'])}</span> : null}
            <span className={styles['route-meta-gap']} />
            <span className={styles['route-step']}>крок {stepIdx + 1} з {total}</span>
          </div>
          <span className={`${styles.bar} ${styles['route-bar']}`}><span className={styles['bar-fill']} style={{ width: `${Math.round((done.size / total) * 100)}%` }} /></span>
          <div className={styles['route-list']}>{recipe.st.map((_, i) => routeRow(i, 'list'))}</div>
          <div className={styles['route-chips']} data-route-chips>{recipe.st.map((_, i) => routeRow(i, 'chips'))}</div>
          <div className={styles['route-foot']}>
            <span className={styles['route-label']}>Усе для страви</span>
            <div className={styles['route-ings']}>
              {recipe.ing.map((ing, i) => (
                <span key={i} className={styles['ing-chip']}>{resolveIngName(ing, batchLabels)}{ing.v != null && ing.u ? ` ${formatQty(ing.v, ing.u)}` : ''}</span>
              ))}
            </div>
            <span className={styles['route-offline']}><Icon name="live.offline" size={12} inherit decorative />Працює без інтернету · екран не гасне</span>
          </div>
        </aside>

        <section className={styles.focus}>
          {/* Моушн-кіт §02: зміна кроку — вертикальний слайд --dur-slow; key перемонтовує. */}
          <div key={stepIdx} className={`${styles['focus-card']} ${styles['step-slide']}`}>
            <div className={styles['focus-head']}>
              <span className={styles['step-chip']}>Крок {stepIdx + 1}<span className={styles['step-chip-t']}>· {step ? shortOf(step) : ''}</span></span>
              <span className={styles['focus-gap']} />
              <span className={styles.dots} aria-hidden>
                {recipe.st.map((_, i) => <span key={i} className={`${styles.dot} ${done.has(i) ? styles['dot-done'] : i === stepIdx ? styles['dot-cur'] : ''}`} />)}
              </span>
            </div>
            <div className={styles['step-text']} data-step-text>{stepText}</div>
            {stepIngs.length > 0 && (
              <div className={styles['step-chips']}>
                {stepIngs.map((ing, i) => (
                  <span key={i} className={styles['step-ing']}>{resolveIngName(ing, batchLabels)}{ing.v != null && ing.u ? ` · ${formatQty(ing.v, ing.u)}` : ''}</span>
                ))}
              </div>
            )}
            {/* Порада (lightbulb) — лише коли в даних рецепта є що показати;
                RecipeStep несе t · c · s, поради нема → не малюємо (Р73). */}
            <span className={styles['focus-spacer']} />
            {timerBox}
          </div>
          <div className={styles['next-line']} data-next-line>
            <span className={styles['next-n']}>{Math.min(total, stepIdx + 2)}</span>
            <span className={styles['next-t']}>{nextLabel}</span>
          </div>
          {bottomRow}
          {shareRow}
        </section>
      </div>

      {/* 390: шторка кроків — маршрут, «Усе для страви», sun/moon. */}
      {sheetOpen && (
        <>
          <div className={styles.scrim} onClick={() => setSheetOpen(false)} />
          <div className={styles.sheet} role="dialog" aria-label="Кроки" data-steps-sheet>
            <span className={styles.handle} aria-hidden />
            <div className={styles['sheet-head']}>
              <span className={styles['sheet-title']}>Кроки · {total}</span>
              <span className={styles['focus-gap']} />
              {themeToggle}
              <button type="button" className={styles.round} onClick={() => setSheetOpen(false)} aria-label="Закрити"><Icon name="sys.close" size={16} inherit decorative /></button>
            </div>
            <div className={styles['route-list']}>{recipe.st.map((_, i) => routeRow(i, 'list'))}</div>
            <span className={styles['route-label']}>Усе для страви</span>
            <div className={styles['route-ings']}>
              {recipe.ing.map((ing, i) => (
                <span key={i} className={styles['ing-chip']}>{resolveIngName(ing, batchLabels)}{ing.v != null && ing.u ? ` ${formatQty(ing.v, ing.u)}` : ''}</span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}
