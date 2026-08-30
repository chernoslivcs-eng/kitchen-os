// Cook Mode — 10 з брифу. Ключове: таймер живе локально (setInterval),
// нічого не звертається до сервера під час готування. Прогрес між кроками
// теж локальний. Якщо колись зʼявиться CookRun у БД — «Готово» пуш-ошне
// подія списання, тут ми зберігаємо тільки локальний стан.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { Button } from '../../components/Button/Button';
import { api, type Recipe } from '../../api';
import { plural } from '../../lib/plural';
import { formatQty } from '../../lib/units';
import { saveCookSession, loadCookSession, clearCookSession } from '../../lib/cook-session';
import { renderStepContent, stepIngredients, resolveIngName, type BatchLabels } from '../../lib/recipe';
import styles from './Cook.module.css';

interface CookLocationState {
  recipe?: Recipe;
  startAt?: number;
  // UX9-11: id чернетки зі стрічки — cook-run реюзає її замість другого рядка.
  recipeId?: string;
  // Правка №5: Cook Mode — поп-ап над місцем запуску; вихід веде назад у ту
  // саму сесію, не в дефолтну «сесію дня».
  returnSessionId?: string | null;
}

function formatMS(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function CookPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as CookLocationState | null) ?? {};
  const recipe = state.recipe ?? null;
  const [stepIdx, setStepIdx] = useState(state.startAt ?? 0);
  // DA2-03: подвійний тап мокрим пальцем перескакував крок (1 → 3). 400ms
  // локу після переходу — рівно --dur-slow, тривалість зміни кроку.
  const [stepLocked, setStepLocked] = useState(false);

  // Бриф-3 п.1: повернення на пройдений крок — тап по смузі або ↩.
  // Таймер при поверненні стає на паузу (він не «відмотує час», людина
  // сама вирішить, чи запускати).
  // Правка №5: усі виходи ведуть у точку запуску.
  function exitToOrigin() {
    if (state.returnSessionId) {
      navigate('/app', { state: { sessionId: state.returnSessionId, at: Date.now() } });
    } else {
      navigate('/app');
    }
  }

  function goToStep(n: number) {
    if (n >= stepIdx) return;
    stopAlarm();
    setStepIdx(n);
  }

  function advanceStep() {
    if (stepLocked) return;
    stopAlarm();
    setStepLocked(true);
    setStepIdx((i) => i + 1);
    window.setTimeout(() => setStepLocked(false), 400);
  }
  const [batchLabels, setBatchLabels] = useState<BatchLabels>(new Map());

  useEffect(() => {
    // Мапа id партії → людський label. Модель показує на комору через `ing.p`
    // (uuid), крокі мають плейсхолдери {0} → назва інгредієнта, не uuid.
    api.pantry()
      .then(({ batches }) => setBatchLabels(new Map(batches.map((b) => [b.id, b.label]))))
      .catch(() => {/* silent */});
  }, []);

  // Таймер на активний крок. Якщо в кроку немає step.s — таймер не показуємо.
  const step = recipe?.st[stepIdx];
  const initialTimer = step?.s ?? 0;
  const [secondsLeft, setSecondsLeft] = useState(initialTimer);
  const [running, setRunning] = useState(false);
  const tickRef = useRef<number | null>(null);

  // Скидаємо таймер при зміні кроку
  useEffect(() => {
    setSecondsLeft(step?.s ?? 0);
    setRunning(false);
  }, [stepIdx, step?.s]);

  // QA8-03: таймер рахує від дедлайну, не тіками. Лічильник тіків втрачав
  // час на будь-якому дроселі (виміряно: 2000мс/тік, паста на 8:00 варилась
  // би 16 хвилин), а StrictMode-подвоєння ефекту робило його недетермінованим.
  // З дедлайном хоч десять інтервалів пишуть одне й те саме обчислене число,
  // а заморожена вкладка наздоганяє час першим же тіком. Це ж робить точним
  // відновлення сесії (QA8-06): зберігаємо залишок, порахований з дедлайну.
  const deadlineRef = useRef<number | null>(null);
  useEffect(() => {
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
      setStepIdx(saved.stepIdx);
      setSecondsLeft(saved.secondsLeft);
      setRunning(false);   // таймер на паузі — час не відмотується
    } else if (saved && recipe && saved.recipe.t !== recipe.t) {
      // QA8-07: тут живе ІНШЕ незавершене готування. Мовчки затерти його —
      // втратити чиїсь пів рецепта. Питаємо; відмова повертає до стрічки,
      // де рядок «Готування триває» веде до старої сесії.
      const drop = window.confirm(
        `Триває готування «${saved.recipe.t}» (крок ${saved.stepIdx + 1}/${saved.recipe.st.length}). Кинути його й почати «${recipe.t}»?`,
      );
      if (!drop) {
        navigate(-1);
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

  // DA2-08: таймер, який мовчить, — це таймер, якого немає. Кіт: сигнал
  // повторюється кожні 30с, поки людина не підтвердить (будь-яка дія кроку).
  const alarmRef = useRef<number | null>(null);
  const beep = () => {
    try {
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
  };
  const stopAlarm = () => {
    if (alarmRef.current != null) { window.clearInterval(alarmRef.current); alarmRef.current = null; }
  };
  useEffect(() => {
    if (secondsLeft === 0 && step?.s && !done) {
      beep();
      alarmRef.current = window.setInterval(beep, 30_000);
      return stopAlarm;
    }
    stopAlarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft === 0]);


  // QA8-20: guard стоїть ПІСЛЯ всіх хуків — кількість викликаних хуків
  // не залежить від наявності рецепта (Rules of Hooks).
  if (!recipe) {
    return (
      <div className={styles.screen}>
        <div style={{ padding: 20, color: 'var(--fg-muted)' }}>
          <p>Cook Mode без рецепта не працює. Відкрий рецепт зі стрічки.</p>
          <button className={styles.exit} onClick={() => navigate('/app')} style={{ marginTop: 12 }}>← У стрічку</button>
        </div>
      </div>
    );
  }

  const total = recipe.st.length;
  const nextStep = stepIdx < total - 1 ? recipe.st[stepIdx + 1] : null;
  const done = stepIdx >= total;

  // Актуальний знімок для збереження — оминаємо замикання ефектів.
  const sessionSnapRef = useRef({ stepIdx, secondsLeft, done });
  sessionSnapRef.current = { stepIdx, secondsLeft, done };
  useEffect(() => {
    if (!recipe) return;
    if (done) { clearCookSession(); return; }
    saveCookSession({ recipe, stepIdx, secondsLeft, recipeId: state.recipeId, returnSessionId: state.returnSessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, running, done]);
  // QA8-06: «Вийти» за 20 секунд до кінця повертало повний таймер — запис
  // ішов тільки на дію. Тепер вихід (unmount) пише точний залишок.
  useEffect(() => {
    if (!recipe) return;
    return () => {
      const snap = sessionSnapRef.current;
      if (!snap.done) saveCookSession({ recipe, stepIdx: snap.stepIdx, secondsLeft: snap.secondsLeft, recipeId: state.recipeId, returnSessionId: state.returnSessionId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.t]);

  // При завершенні: зберігаємо cook-run і списуємо використані партії.
  // Кількість повертаємо, щоб «Готово» показало «списано N позицій».
  const [depleted, setDepleted] = useState<number | null>(null);
  const [partial, setPartial] = useState<number>(0);
  const [opened, setOpened] = useState<number>(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [undone, setUndone] = useState<boolean>(false);
  // #7 (план 2026-08-30): списання «на око», але те, що зникне з комори
  // ПОВНІСТЮ, людина підтверджує — кейс «відкрив банку, не тримався рецепта,
  // щось лишив». Прогноз рахує бекенд тим самим кодом, що списує.
  const [vanish, setVanish] = useState<{ id: string; label: string; value: number | null; unit: string | null }[] | null>(null);
  // id → «лишилось ≈» (null = кількість невідома). Бриф-2 п.4.
  const [keepMap, setKeepMap] = useState<Map<string, number | null>>(new Map());
  const [confirmed, setConfirmed] = useState(false);
  // UX9-26: «Нічого не списувати» = НЕ ЧІПАТИ комору взагалі. Раніше воно
  // слало keep-на-всіх — сервер все одно віднімав часткові й відкривав
  // vanish-партії з value:null (вершки втратили «200 мл» назавжди).
  const [skipPantry, setSkipPantry] = useState(false);
  // UX9-24: підсумок називає позиції, не лише лічильники.
  const [changedLabels, setChangedLabels] = useState<{ depleted: string[]; partial: string[]; opened: string[] }>({ depleted: [], partial: [], opened: [] });

  useEffect(() => {
    if (!done) return;
    api.cookRuns.dryRun(recipe)
      .then((r) => {
        if (r.would_deplete.length === 0) setConfirmed(true);   // нема про що питати
        else setVanish(r.would_deplete);
      })
      .catch(() => setConfirmed(true));   // offline: поводимось як раніше
  }, [done, recipe]);

  useEffect(() => {
    if (!done || !confirmed) return;
    api.cookRuns.save(recipe, {
      keep: [...keepMap].map(([id, v]) => (v != null ? { id, v } : id)),
      skip_pantry: skipPantry || undefined,
      recipe_id: state.recipeId,
      session_id: state.returnSessionId ?? undefined,
    })
      .then((r) => {
        setDepleted(r.depleted); setPartial(r.partial); setOpened(r.opened);
        setRunId(r.id); setRecipeId(r.recipe_id);
        setChangedLabels({
          depleted: r.depleted_labels ?? [],
          partial: r.partial_labels ?? [],
          opened: r.opened_labels ?? [],
        });
      })
      .catch(() => {/* offline: наступним разом */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, confirmed]);

  async function undoCook() {
    if (!runId || undone) return;
    try {
      await api.cookRuns.undo(runId);
      setUndone(true);
    } catch {/* тихо: юзер побачить, що кнопка не спрацювала */}
  }

  // Ретро-оцінка: 1-5 зірок + опційно короткий verdict. Пропуск = null, це ок.
  // Модель побачить це в контексті на наступному запиті рецепта.
  const [rating, setRating] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<string>('');
  const [ratingSaved, setRatingSaved] = useState<boolean>(false);
  async function submitRating(newRating: number) {
    if (!runId) return;   /* папіркат UX-9: оцінка стосується готування, не списання */
    setRating(newRating);
    try {
      await api.cookRuns.rate(runId, newRating, verdict.trim() || null);
      setRatingSaved(true);
      // ховаємо «збережено» через 2с, щоб не звисало
      setTimeout(() => setRatingSaved(false), 2000);
    } catch {/* тихо */}
  }
  async function saveVerdict() {
    if (!runId || !rating) return;
    try {
      await api.cookRuns.rate(runId, rating, verdict.trim() || null);
      setRatingSaved(true);
      setTimeout(() => setRatingSaved(false), 2000);
    } catch {/* тихо */}
  }

  // Фото готової страви. Завантажуємо через звичайний /v1/attachments,
  // отриманий URL кладемо в cook_run.photo_url — журнал і Share його підхоплять.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  async function onPickPhoto(files: FileList | null) {
    const f = files?.[0];
    if (!f || !runId) return;
    setUploadingPhoto(true);
    try {
      const up = await api.attachments.upload(f);
      await api.cookRuns.setPhoto(runId, up.url);
      setPhotoUrl(up.url);
    } catch {/* тихо: юзер побачить, що фото не з'явилось */}
    finally { setUploadingPhoto(false); }
  }

  // Кнопки кроку — одні на два лейаути: мобільний футер і десктопна права
  // колонка (Д05: ↩ і «Крок готово ✓» живуть під таймером).
  const stepButtons = !done && (
    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
      {stepIdx > 0 && (
        /* Бриф-3 п.1: ↩ — місклік по «Крок готово» більше не безповоротний. */
        <button
          className={styles.main}
          style={{ width: 64, flex: 'none', background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border-strong)' }}
          aria-label="Крок назад"
          onClick={() => goToStep(stepIdx - 1)}
        >↩</button>
      )}
      <button
        className={styles.main}
        style={{ flex: 1 }}
        disabled={stepLocked}
        onClick={advanceStep}
      >
        {/* DA2-04: чотири еталони кажуть «Крок готово ✓» — це підтвердження
            дії, а не навігація «Далі →». */}
        {stepIdx === total - 1 ? 'Приготували' : 'Крок готово ✓'}
      </button>
      {stepIdx < total - 1 && (
        /* DA2-06: вихід «я закінчив раніше, ніж ваш список кроків». */
        <button
          className={styles.main}
          style={{ background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border-strong)', width: 132 }}
          disabled={stepLocked}
          onClick={() => { stopAlarm(); setStepIdx(total); }}
        >
          Приготували
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.screen}>
      {/* QA9-03 / Д05: шапка одна на обидва лейаути — ✕ Вийти з САМОГО краю
          зліва, мета в центрі, прогрес-смуга справа (220px). На мобільному
          прогрес переносом падає на другий рядок на всю ширину. */}
      <div className={styles.head}>
        <button className={styles.exit} onClick={exitToOrigin}>✕ Вийти</button>
        <MonoLabel className={styles['head-meta']}>
          {recipe.t.toUpperCase()} · {done ? 'ГОТОВО' : `КРОК ${stepIdx + 1}/${total}`}
        </MonoLabel>
        {/* Бриф-3 п.1: тап по сегменту смуги = перейти на пройдений крок.
            Сегмент 4px — не тап-зона, тому кожен обгорнутий кнопкою з
            вертикальним padding ≥44px сумарної висоти. */}
        <div className={styles.progress}>
          {recipe.st.map((_, i) => (
            <button
              key={i}
              type="button"
              className={styles['progress-hit']}
              disabled={i >= stepIdx || done}
              aria-label={`Повернутись до кроку ${i + 1}`}
              onClick={() => goToStep(i)}
            >
              <div className={i < stepIdx ? styles.done : i === stepIdx ? styles.current : ''} />
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.body} ${!done ? styles['body-steps'] : ''}`}>
        {done ? (
          <>
            <div className={styles['step-title']}>Готово. Смачного.</div>

            {/* Бриф-2 п.4 — канон: «Що списуємо повністю?», чекбокси-квадрати,
                знята галочка розкриває опційне поле «лишилось ≈», кнопка
                «Списати N» (данжер) + «Скасувати». Стек модалок — заборонено. */}
            {vanish && !confirmed && (
              <div
                role="dialog"
                aria-modal="true"
                ref={(el) => {
                  // QA8-09: без фокусу всередині діалог не чує клавіатури.
                  if (el && !el.contains(document.activeElement)) {
                    el.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
                  }
                }}
                onKeyDown={(e) => {
                  // DA2-09 + UX9-26: Escape — безпечний вихід, комора не
                  // чіпається взагалі. Tab тримаємо всередині діалогу.
                  if (e.key === 'Escape') {
                    setSkipPantry(true);
                    setConfirmed(true);
                  }
                  if (e.key === 'Tab') {
                    const focusables = (e.currentTarget as HTMLElement)
                      .querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])');
                    if (!focusables.length) return;
                    const first = focusables[0]!;
                    const last = focusables[focusables.length - 1]!;
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                  }
                }}
                aria-label="Що списуємо повністю"
                style={{
                  position: 'fixed', inset: 0, zIndex: 60,
                  background: 'rgba(0,0,0,0.35)',
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                }}
              >
                <div style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
                  borderRadius: 20, padding: 22, margin: 16, maxWidth: 440, width: '100%',
                  boxShadow: 'var(--shadow-panel)', display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 19, fontWeight: 700, letterSpacing: '-0.015em', color: 'var(--fg-strong)' }}>
                      Що списуємо повністю?
                    </div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                      Знята галочка = щось лишилось — партія стане відкритою.
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {vanish.map((v) => {
                      const kept = keepMap.has(v.id);
                      return (
                        <div key={v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <label style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '11px 0', cursor: 'pointer',
                            fontFamily: 'var(--font-body)', fontSize: 16,
                            color: 'var(--fg)',
                          }}>
                            <span
                              role="checkbox"
                              aria-checked={!kept}
                              tabIndex={0}
                              onClick={() => setKeepMap((prev) => {
                                const next = new Map(prev);
                                if (next.has(v.id)) next.delete(v.id); else next.set(v.id, null);
                                return next;
                              })}
                              onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                  e.preventDefault();
                                  setKeepMap((prev) => {
                                    const next = new Map(prev);
                                    if (next.has(v.id)) next.delete(v.id); else next.set(v.id, null);
                                    return next;
                                  });
                                }
                              }}
                              style={{
                                width: 24, height: 24, borderRadius: 8, flex: 'none',
                                display: 'grid', placeItems: 'center',
                                background: kept ? 'transparent' : 'var(--accent)',
                                border: kept ? '1px solid var(--border-strong)' : '1px solid var(--accent)',
                                color: 'var(--accent-fg-on)', fontWeight: 700, fontSize: 13,
                                cursor: 'pointer',
                              }}
                            >{kept ? '' : '✓'}</span>
                            <span style={{ flex: 1 }}>{v.label}</span>
                            {v.value != null && v.unit && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-dim)' }}>
                                {v.value}{v.unit === 'g' ? 'г' : v.unit === 'ml' ? 'мл' : v.unit === 'pcs' ? 'шт' : v.unit === 'pack' ? 'уп' : v.unit}
                              </span>
                            )}
                          </label>
                          {kept && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 12px 36px' }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)' }}>ЛИШИЛОСЬ ≈</span>
                              <input
                                type="number"
                                min={0}
                                placeholder={v.unit === 'g' ? 'г' : v.unit === 'ml' ? 'мл' : v.unit === 'pcs' ? 'шт' : v.unit === 'pack' ? 'уп' : ''}
                                onChange={(e) => {
                                  const n = e.target.value === '' ? null : Number(e.target.value);
                                  setKeepMap((prev) => {
                                    const next = new Map(prev);
                                    next.set(v.id, n != null && !isNaN(n) && n > 0 ? n : null);
                                    return next;
                                  });
                                }}
                                style={{
                                  height: 36, width: 90, borderRadius: 10,
                                  border: '1px solid var(--accent-border)',
                                  boxShadow: '0 0 0 3px var(--focus-ring)',
                                  background: 'var(--bg-surface-2)', color: 'var(--fg)',
                                  padding: '0 12px', fontFamily: 'var(--font-body)', fontSize: 15,
                                }}
                              />
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--fg-dim)' }}>ОПЦІЙНО</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => setConfirmed(true)}
                      style={{
                        flex: 1, height: 50, border: 0, borderRadius: 14,
                        background: 'var(--danger)', color: 'var(--bg-body)',
                        fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Списати {vanish.length - keepMap.size}
                    </button>
                    <button
                      /* UX9-26: чесне «нічого» — комора лишається недоторканою,
                         запис у журналі при цьому створюється. */
                      onClick={() => { setSkipPantry(true); setConfirmed(true); }}
                      style={{
                        height: 50, padding: '0 18px', borderRadius: 14,
                        border: '1px solid var(--border-strong)', background: 'transparent',
                        color: 'var(--fg-muted)', fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Нічого не списувати
                    </button>
                  </div>
                </div>
              </div>
            )}
            {skipPantry && runId && (
              <div className={styles.section}>
                <MonoLabel className={styles['section-label']}>З КОМОРИ</MonoLabel>
                <div className={styles.next}>Комору не чіпав — як і просив.</div>
              </div>
            )}
            {depleted != null && (depleted > 0 || partial > 0 || opened > 0) && (
              <div className={styles.section}>
                <MonoLabel className={styles['section-label']}>З КОМОРИ</MonoLabel>
                <div className={styles.next}>
                  {undone ? (
                    <>Повернуто в комору — вибач за неспокій.</>
                  ) : (
                    /* UX9-24: не «2 позиції», а ЯКІ саме — інакше людина йде в
                       Комору звіряти цифри руками. */
                    <>
                      {depleted > 0 && (
                        <>Списано: {changedLabels.depleted.join(', ') || `${depleted} ${plural(depleted, ['позицію', 'позиції', 'позицій'])}`}</>
                      )}
                      {depleted > 0 && partial > 0 && <> · </>}
                      {partial > 0 && (
                        <>Частково використано: {changedLabels.partial.join(', ') || `${partial} ${plural(partial, ['позицію', 'позиції', 'позицій'])}`}</>
                      )}
                      {/* QA5-10: коли рецепт не дав кількості, ми лишаємо партію
                          в коморі й тільки відкриваємо її. Без цього рядка екран
                          казав «Списано 0 позицій» і людина не розуміла, що сталось. */}
                      {(depleted > 0 || partial > 0) && opened > 0 && <> · </>}
                      {opened > 0 && (
                        <>Без кількості — лише відкрито: {changedLabels.opened.join(', ') || `${opened} ${plural(opened, ['позиція', 'позиції', 'позицій'])}`}</>
                      )}
                    </>
                  )}
                </div>
                {runId && !undone && (
                  <button
                    onClick={undoCook}
                    style={{
                      marginTop: 12,
                      background: 'transparent',
                      color: 'var(--fg-muted)',
                      border: '1px solid var(--border-strong)',
                      padding: '8px 14px',
                      borderRadius: 'var(--r-pill)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    ← Скасувати списання
                  </button>
                )}
              </div>
            )}

            {runId && (
              <div className={styles.section}>
                <MonoLabel className={styles['section-label']}>
                  ЯК ВИЙШЛО {ratingSaved && <span style={{ color: 'var(--accent)' }}>· ЗБЕРЕЖЕНО</span>}
                </MonoLabel>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => submitRating(n)}
                      style={{
                        width: 40, height: 40,
                        border: `1px solid ${rating != null && n <= rating ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: rating != null && n <= rating ? 'var(--accent-bg)' : 'transparent',
                        color: rating != null && n <= rating ? 'var(--accent)' : 'var(--fg-muted)',
                        borderRadius: 'var(--r)',
                        fontSize: 20,
                        cursor: 'pointer',
                        transition: 'background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)',
                      }}
                      aria-label={`${n} із 5`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                {rating != null && (
                  <textarea
                    placeholder="Що б змінити? Одна фраза достатньо."
                    value={verdict}
                    onChange={(e) => setVerdict(e.target.value)}
                    onBlur={saveVerdict}
                    maxLength={200}
                    rows={2}
                    style={{
                      marginTop: 10,
                      width: '100%',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r)',
                      padding: '10px 12px',
                      color: 'var(--fg)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
                      resize: 'none',
                    }}
                  />
                )}
              </div>
            )}

            {runId && (
              <div className={styles.section}>
                <MonoLabel className={styles['section-label']}>ФОТО</MonoLabel>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => onPickPhoto(e.target.files)}
                />
                {photoUrl ? (
                  <div style={{ marginTop: 8, position: 'relative' }}>
                    <img
                      src={photoUrl}
                      alt="Готова страва"
                      style={{
                        width: '100%',
                        maxHeight: 260,
                        objectFit: 'cover',
                        borderRadius: 'var(--r)',
                        display: 'block',
                      }}
                    />
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      style={{
                        position: 'absolute', top: 8, right: 8,
                        background: 'rgba(0,0,0,0.6)', color: '#fff', border: 0,
                        padding: '6px 10px', borderRadius: 'var(--r-pill)',
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      Інше
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    style={{
                      marginTop: 8,
                      width: '100%',
                      padding: '20px',
                      background: 'transparent',
                      border: '1px dashed var(--border-strong)',
                      borderRadius: 'var(--r)',
                      color: 'var(--fg-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
                      cursor: uploadingPhoto ? 'wait' : 'pointer',
                    }}
                  >
                    {uploadingPhoto ? 'Завантажую…' : '📷 Зняти або додати фото'}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* QA9-03: обгортки колонок. Мобільний їх не бачить
                (display:contents + order), десктоп кладе крок зліва,
                таймер+кнопки справа за бордюром — Д05. */}
            <div className={styles['col-main']}>
              <div className={styles['step-title']}>
                {step?.t}. {renderStepContent(step?.c ?? '', recipe.ing, batchLabels)}
              </div>

              {/* DA2-05: «НА ЦЬОМУ КРОЦІ» — прив'язка кроку до партій з комори,
                  «скільки саме з мого». Стоїть у 4 еталонах. */}
              {step && stepIngredients(step.c ?? '', recipe.ing).length > 0 && (
                <div className={styles.section}>
                  <MonoLabel>НА ЦЬОМУ КРОЦІ</MonoLabel>
                  <div className={styles.next}>
                    {stepIngredients(step.c ?? '', recipe.ing).map((ing, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        {resolveIngName(ing, batchLabels)}
                        {ing.v != null && ing.u ? ` — ${formatQty(ing.v, ing.u)}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {nextStep && (
                <div className={styles.section}>
                  <MonoLabel>ДАЛІ</MonoLabel>
                  <div className={styles.next}>
                    {stepIdx + 2} · {nextStep.t}
                  </div>
                </div>
              )}
            </div>

            <div className={styles['col-side']}>
              {!!step?.s && (
                <div className={styles.timer}>
                  <div className={`${styles['timer-value']} ${secondsLeft === 0 ? styles.done : ''}`}>
                    {formatMS(secondsLeft)}
                  </div>
                  <div className={styles['timer-actions']}>
                    <button
                      className={styles.primary}
                      onClick={() => {
                        stopAlarm();
                        if (secondsLeft === 0) { setSecondsLeft(step.s ?? 0); setRunning(true); return; }
                        setRunning((r) => !r);
                      }}
                    >
                      {secondsLeft === 0 ? 'Спочатку' : running ? 'Пауза' : 'Пуск'}
                    </button>
                    <button
                      className={styles.secondary}
                      onClick={() => {
                        if (deadlineRef.current != null) deadlineRef.current += 60_000;
                        setSecondsLeft((s) => s + 60);
                      }}
                    >
                      +1 хв
                    </button>
                  </div>
                </div>
              )}
              <div className={styles['side-actions']}>{stepButtons}</div>
              <div className={styles['side-hint']}>Працює без мережі · смуга вгорі вертає на крок</div>
            </div>
          </>
        )}
      </div>

      {/* На десктопі в step-режимі кнопки живуть у правій колонці (Д05) —
          футер ховається. Done-екран тримає футер на всіх ширинах. */}
      <div className={`${styles.foot} ${!done ? styles['foot-steps'] : ''}`}>
        {done ? (
          /* Папіркат UX-9: головна дія фінішу — повернутись до свого продукту,
             шеринг другорядний. Було навпаки. */
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className={styles.main}
              style={{ flex: 1 }}
              onClick={exitToOrigin}
            >
              У стрічку
            </button>
            <button
              className={styles.main}
              style={{ background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border-strong)', width: 132 }}
              onClick={() => navigate('/share', { state: { recipe, photoUrl, recipeId } })}
            >
              Поділитись
            </button>
          </div>
        ) : stepButtons}
        <div className={styles.offline}>{done ? "Працює без мережі" : "Працює без мережі · смуга вгорі вертає на крок"}</div>
      </div>
    </div>
  );
}

