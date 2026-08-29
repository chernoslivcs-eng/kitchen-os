// Cook Mode — 10 з брифу. Ключове: таймер живе локально (setInterval),
// нічого не звертається до сервера під час готування. Прогрес між кроками
// теж локальний. Якщо колись зʼявиться CookRun у БД — «Готово» пуш-ошне
// подія списання, тут ми зберігаємо тільки локальний стан.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api, type Recipe } from '../../api';
import styles from './Cook.module.css';

interface CookLocationState {
  recipe?: Recipe;
  startAt?: number;
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

  useEffect(() => {
    if (!running) {
      if (tickRef.current != null) window.clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (tickRef.current != null) window.clearInterval(tickRef.current);
    };
  }, [running]);

  useEffect(() => {
    if (secondsLeft === 0 && running) setRunning(false);
  }, [secondsLeft, running]);

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

  // При завершенні: зберігаємо cook-run і списуємо використані партії.
  // Кількість повертаємо, щоб «Готово» показало «списано N позицій».
  const [depleted, setDepleted] = useState<number | null>(null);
  const [partial, setPartial] = useState<number>(0);
  useEffect(() => {
    if (done) {
      api.cookRuns.save(recipe)
        .then((r) => { setDepleted(r.depleted); setPartial(r.partial); })
        .catch(() => {/* offline: наступним разом */});
    }
  }, [done, recipe]);

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <button className={styles.exit} onClick={() => navigate(-1)}>✕ Вийти</button>
        <MonoLabel className={styles['head-meta']}>
          {recipe.t.toUpperCase()} · {done ? 'ГОТОВО' : `КРОК ${stepIdx + 1}/${total}`}
        </MonoLabel>
      </div>

      <div className={styles.progress}>
        {recipe.st.map((_, i) => (
          <div key={i} className={i < stepIdx ? styles.done : i === stepIdx ? styles.current : ''} />
        ))}
      </div>

      <div className={styles.body}>
        {done ? (
          <>
            <div className={styles['step-title']}>Готово. Смачного.</div>
            {depleted != null && (depleted > 0 || partial > 0) && (
              <div className={styles.section}>
                <MonoLabel className={styles['section-label']}>З КОМОРИ</MonoLabel>
                <div className={styles.next}>
                  {depleted > 0 && (
                    <>Списано {depleted} {depleted === 1 ? 'позицію' : 'позицій'}</>
                  )}
                  {depleted > 0 && partial > 0 && <> · </>}
                  {partial > 0 && (
                    <>Частково використано {partial} {partial === 1 ? 'позицію' : 'позицій'}</>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className={styles['step-title']}>
              {step?.t}. {renderStepContent(step?.c ?? '', recipe.ing)}
            </div>

            {step?.s && (
              <div className={styles.timer}>
                <div className={`${styles['timer-value']} ${secondsLeft === 0 ? styles.done : ''}`}>
                  {formatMS(secondsLeft)}
                </div>
                <div className={styles['timer-actions']}>
                  <button
                    className={styles.primary}
                    onClick={() => {
                      if (secondsLeft === 0) { setSecondsLeft(step.s ?? 0); setRunning(true); return; }
                      setRunning((r) => !r);
                    }}
                  >
                    {secondsLeft === 0 ? 'Спочатку' : running ? 'Пауза' : 'Пуск'}
                  </button>
                  <button className={styles.secondary} onClick={() => setSecondsLeft((s) => s + 60)}>
                    +1 хв
                  </button>
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
          </>
        )}
      </div>

      <div className={styles.foot}>
        {done ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className={styles.main}
              style={{ flex: 1 }}
              onClick={() => navigate('/share', { state: { recipe } })}
            >
              Поділитись
            </button>
            <button
              className={styles.main}
              style={{ background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border-strong)', width: 120 }}
              onClick={() => navigate('/app')}
            >
              У стрічку
            </button>
          </div>
        ) : (
          <button
            className={styles.main}
            onClick={() => setStepIdx((i) => i + 1)}
          >
            {stepIdx === total - 1 ? 'Готово ✓' : 'Крок готово ✓'}
          </button>
        )}
        <div className={styles.offline}>Працює без мережі · таймер живе локально</div>
      </div>
    </div>
  );
}

function renderStepContent(c: string, ing: { v?: number; u?: string; n?: string }[]): string {
  return c.replace(/\{(\d+)\}/g, (_, idx) => {
    const i = Number(idx);
    const it = ing[i];
    if (!it) return `{${idx}}`;
    if (it.v != null && it.u) return `${it.v}${it.u}`;
    if (it.n) return it.n;
    return `{${idx}}`;
  });
}
