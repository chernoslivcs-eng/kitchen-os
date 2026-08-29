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
  const [runId, setRunId] = useState<string | null>(null);
  const [undone, setUndone] = useState<boolean>(false);
  useEffect(() => {
    if (done) {
      api.cookRuns.save(recipe)
        .then((r) => { setDepleted(r.depleted); setPartial(r.partial); setRunId(r.id); })
        .catch(() => {/* offline: наступним разом */});
    }
  }, [done, recipe]);

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
    if (!runId || undone) return;
    setRating(newRating);
    try {
      await api.cookRuns.rate(runId, newRating, verdict.trim() || null);
      setRatingSaved(true);
      // ховаємо «збережено» через 2с, щоб не звисало
      setTimeout(() => setRatingSaved(false), 2000);
    } catch {/* тихо */}
  }
  async function saveVerdict() {
    if (!runId || undone || !rating) return;
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
    if (!f || !runId || undone) return;
    setUploadingPhoto(true);
    try {
      const up = await api.attachments.upload(f);
      await api.cookRuns.setPhoto(runId, up.url);
      setPhotoUrl(up.url);
    } catch {/* тихо: юзер побачить, що фото не з'явилось */}
    finally { setUploadingPhoto(false); }
  }

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
                  {undone ? (
                    <>Повернуто в комору — вибач за неспокій.</>
                  ) : (
                    <>
                      {depleted > 0 && (
                        <>Списано {depleted} {depleted === 1 ? 'позицію' : 'позицій'}</>
                      )}
                      {depleted > 0 && partial > 0 && <> · </>}
                      {partial > 0 && (
                        <>Частково використано {partial} {partial === 1 ? 'позицію' : 'позицій'}</>
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

            {runId && !undone && (
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

            {runId && !undone && (
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
              onClick={() => navigate('/share', { state: { recipe, photoUrl } })}
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
