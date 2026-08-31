// Cook Mode — 10 з брифу. Ключове: таймер живе локально (setInterval),
// нічого не звертається до сервера під час готування. Прогрес між кроками
// теж локальний. Якщо колись зʼявиться CookRun у БД — «Готово» пуш-ошне
// подія списання, тут ми зберігаємо тільки локальний стан.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { Button } from '../../components/Button/Button';
import { api, type Recipe } from '../../api';
import { plural } from '../../lib/plural';
import { formatQty } from '../../lib/units';
import { saveCookSession, loadCookSession, clearCookSession } from '../../lib/cook-session';
import { useCookStore } from '../../store/cook';
import { renderStepContent, stepIngredients, resolveIngName, stepLabelsFrom, type BatchLabels } from '../../lib/recipe';
import styles from './Cook.module.css';

function formatMS(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function CookOverlay() {
  const navigate = useNavigate();
  // Пул-3: поп-ап. Стан приходить зі стора, не з навігації.
  const state = useCookStore((s) => s.args) ?? {} as Partial<import('../../store/cook').CookOpenArgs>;
  const closeOverlay = useCookStore((s) => s.close);
  const recipe = state.recipe ?? null;
  const [stepIdx, setStepIdx] = useState(state.startAt ?? 0);
  // DA2-03: подвійний тап мокрим пальцем перескакував крок (1 → 3). 400ms
  // локу після переходу — рівно --dur-slow, тривалість зміни кроку.
  const [stepLocked, setStepLocked] = useState(false);

  // Бриф-3 п.1: повернення на пройдений крок — тап по смузі або ↩.
  // Таймер при поверненні стає на паузу (він не «відмотує час», людина
  // сама вирішить, чи запускати).
  // Пул-3: «✕» — це закрити поп-ап. Людина лишається там, де була;
  // прогрес живе в kos-cook-live, банери повернуть назад.
  function exitToOrigin() {
    closeOverlay();
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
  const sessionSnapRef = useRef({ stepIdx, secondsLeft });
  sessionSnapRef.current = { stepIdx, secondsLeft };
  useEffect(() => {
    if (!recipe || finishedRef.current) return;
    saveCookSession({ recipe, stepIdx, secondsLeft, recipeId: state.recipeId, returnSessionId: state.returnSessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, running]);
  // QA8-06: «Вийти» за 20 секунд до кінця повертало повний таймер — запис
  // ішов тільки на дію. Тепер вихід (unmount) пише точний залишок.
  useEffect(() => {
    if (!recipe) return;
    return () => {
      const snap = sessionSnapRef.current;
      if (!finishedRef.current) saveCookSession({ recipe, stepIdx: snap.stepIdx, secondsLeft: snap.secondsLeft, recipeId: state.recipeId, returnSessionId: state.returnSessionId });
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
  async function finish() {
    if (finishing || finishedRef.current) return;
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
    try {
      await api.cookRuns.save(recipe!, {
        skip_pantry: true,
        recipe_id: state.recipeId,
        session_id: sid ?? undefined,
        ask_writeoff: true,
      });
    } catch {/* offline: запис у журнал не вийшов — не тримаємо людину в пастці */}
    closeOverlay();
    navigate('/app', sid ? { state: { sessionId: sid, at: Date.now() } } : undefined);
  }

  // Кнопки кроку — одні на два лейаути: мобільний футер і десктопна права
  // колонка (Д05: ↩ і «Крок готово ✓» живуть під таймером).
  const stepButtons = (
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
        disabled={stepLocked || finishing}
        onClick={stepIdx === total - 1 ? finish : advanceStep}
      >
        {/* DA2-04: чотири еталони кажуть «Крок готово ✓» — це підтвердження
            дії, а не навігація «Далі →». */}
        {stepIdx === total - 1 ? (finishing ? 'Зберігаю…' : 'Приготували') : 'Крок готово ✓'}
      </button>
      {stepIdx < total - 1 && (
        /* DA2-06: вихід «я закінчив раніше, ніж ваш список кроків». */
        <button
          className={styles.main}
          style={{ background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border-strong)', width: 132 }}
          disabled={stepLocked || finishing}
          onClick={finish}
        >
          {finishing ? 'Зберігаю…' : 'Приготували'}
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.screen}>
      {/* QA9-03 / Д05: шапка одна на обидва лейаути — ✕ Вийти з САМОГО краю
          зліва, мета в центрі, прогрес-смуга справа (220px). На мобільному
          прогрес переносом падає на другий рядок на всю ширину. */}
      {/* Пул-3: прогрес — тонкі сегменти по верхньому краю поп-апа.
          Тап по пройденому сегменту вертає на крок (Бриф-3 п.1). */}
      <div className={styles['progress-top']}>
        {recipe.st.map((_, i) => (
          <button
            key={i}
            type="button"
            className={styles['progress-hit']}
            disabled={i >= stepIdx}
            aria-label={`Повернутись до кроку ${i + 1}`}
            onClick={() => goToStep(i)}
          >
            <div className={i < stepIdx ? styles.done : i === stepIdx ? styles.current : ''} />
          </button>
        ))}
      </div>
      {/* Пул-4 №3: сторіз-навігація на мобілці — тапи по краях екрана.
          Зони вузькі (18%), кнопки таймера в центрі поза ними; лок 400мс
          прощає подвійний тап. На десктопі сховані CSS-ом. */}
      <button
        type="button"
        className={`${styles['tap-zone']} ${styles['tap-left']}`}
        aria-label="Попередній крок"
        disabled={stepIdx === 0}
        onClick={() => goToStep(stepIdx - 1)}
      />
      <button
        type="button"
        className={`${styles['tap-zone']} ${styles['tap-right']}`}
        aria-label="Наступний крок"
        disabled={stepIdx >= total - 1}
        onClick={advanceStep}
      />
      <div className={styles.head}>
        <button className={styles.exit} onClick={exitToOrigin}>✕ Вийти</button>
        <MonoLabel className={styles['head-meta']}>
          {recipe.t.toUpperCase()} · КРОК {stepIdx + 1}/{total}
        </MonoLabel>
      </div>

      <div className={`${styles.body} ${styles['body-steps']}`}>
            {/* QA9-03: обгортки колонок. Мобільний їх не бачить
                (display:contents + order), десктоп кладе крок зліва,
                таймер+кнопки справа за бордюром — Д05. */}
            {/* Моушн-кіт §02: зміна кроку — вертикальний слайд 400ms; key
                перемонтовує колонку, анімація їде від CSS. Інших анімацій у
                Cook Mode свідомо нема (правила кита). */}
            <div key={stepIdx} className={`${styles['col-main']} ${styles['step-slide']}`}>
              <div className={styles['step-title']}>
                {step?.t}. {renderStepContent(step?.c ?? '', recipe.ing, stepLabels)}
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
                        // Моушн-2 №7: дозвіл на нотифікації питаємо в момент
                        // юзер-жесту старту таймера; відмова = просто без них.
                        try {
                          if ('Notification' in window && Notification.permission === 'default') {
                            void Notification.requestPermission();
                          }
                        } catch { /* ок */ }
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
      </div>

      {/* Правка №6: done-екрана немає — футер завжди степовий. */}
      <div className={`${styles.foot} ${styles['foot-steps']}`}>
        <div className={styles['foot-buttons']}>{stepButtons}</div>
        {/* Пул-4 №3: на мобілці кроки ходять тапами по краях — кнопки кроків
            зайві; «Приготували» зʼявляється лише на останньому слайді. */}
        {stepIdx === total - 1 && (
          <button
            className={`${styles.main} ${styles['finish-mobile']}`}
            disabled={finishing}
            onClick={finish}
          >
            {finishing ? 'Зберігаю…' : 'Приготували'}
          </button>
        )}
        <div className={styles.offline}>Тапи по краях гортають кроки · працює без мережі</div>
      </div>
    </div>
  );
}

