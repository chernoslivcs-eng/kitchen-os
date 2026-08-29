// Екран рецепта — 09 з брифу. Отримує рецепт через react-router state
// (з попереднього «Рецепт →» на пропозиції). Якщо стан порожній (F5),
// показуємо повідомлення й пропонуємо повернутись у стрічку.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api, type Recipe } from '../../api';
import styles from './Recipe.module.css';

interface RecipeLocationState {
  recipe?: Recipe;
}

export function RecipePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const recipe = (location.state as RecipeLocationState | null)?.recipe ?? null;
  const [currentStep, setCurrentStep] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [allergies, setAllergies] = useState<string[]>([]);

  useEffect(() => {
    // Підтягнемо алергії з профілю, щоб позначити відповідні інгредієнти.
    // «Позначка, а не заборона» — рецепт лишається доступним, ми тільки попереджаємо.
    api.profile()
      .then(({ profile }) => setAllergies(profile.allergies))
      .catch(() => {/* silent */});
  }, []);

  function flagsFor(ingName: string): string[] {
    const n = ingName.toLowerCase();
    return allergies.filter((a) => a && n.includes(a.toLowerCase()));
  }

  if (!recipe) {
    return (
      <div className={styles.screen}>
        <div className={styles.info}>
          <p>Рецепт не знайдено. Це не сесія — F5 його не збереже.</p>
          <p style={{ marginTop: 12 }}>
            <Button onClick={() => navigate('/app')}>← Назад у стрічку</Button>
          </p>
        </div>
      </div>
    );
  }

  const toggleDone = (idx: number) => {
    const next = new Set(doneSteps);
    if (next.has(idx)) { next.delete(idx); } else { next.add(idx); setCurrentStep(idx + 1); }
    setDoneSteps(next);
  };

  const summary = [
    recipe.tm ? `${recipe.tm}ХВ` : null,
    recipe.sv ? `${recipe.sv} ПОРЦІЇ` : null,
    recipe.nu?.kcal ? `${recipe.nu.kcal}ККАЛ` : null,
    recipe.nu ? `Б${Math.round(recipe.nu.p)} Ж${Math.round(recipe.nu.f)} В${Math.round(recipe.nu.c)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <button className={styles.iconbtn} onClick={() => navigate(-1)} aria-label="Назад">←</button>
        <MonoLabel className={styles['head-meta']}>РЕЦЕПТ · КРОК {Math.min(currentStep + 1, recipe.st.length)}/{recipe.st.length}</MonoLabel>
        <Button
          variant="secondary"
          onClick={() => navigate('/cook', { state: { recipe } })}
        >
          Cook Mode
        </Button>
      </div>

      <div className={styles.body}>
        <h1 className={styles.title}>{recipe.t}</h1>
        {summary && <div className={styles.summary}>{summary}</div>}
        {recipe.d && <div className={styles.desc}>{recipe.d}</div>}
        {recipe.rk && <div className={styles.rk}>{recipe.rk}</div>}

        <div className={styles.section}>
          <MonoLabel>ІНГРЕДІЄНТИ</MonoLabel>
          {recipe.ing.map((ing, i) => {
            const name = ing.n ?? (ing.p ? `[${ing.p}]` : '—');
            const flags = flagsFor(name);
            const hasFlag = flags.length > 0;
            return (
              <div key={i} className={styles.ing}>
                <span className={`${styles['ing-mark']} ${ing.p ? '' : styles.missing}`}>
                  {ing.p ? '●' : '○'}
                </span>
                <span className={`${styles['ing-name']} ${ing.p ? '' : styles.missing}`}>
                  {name}
                  {hasFlag && (
                    <span style={{
                      display: 'inline-block',
                      marginLeft: 8,
                      padding: '2px 8px',
                      background: 'var(--danger-bg)',
                      border: '1px solid var(--danger-border)',
                      color: 'var(--danger)',
                      borderRadius: 'var(--r-pill)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}>
                      ⚠ {flags[0]}
                    </span>
                  )}
                </span>
                {ing.v != null && ing.u && (
                  <span className={styles['ing-qty']}>{ing.v}{ing.u}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.section}>
          <MonoLabel>КРОКИ</MonoLabel>
          <div className={styles.steps}>
            {recipe.st.map((step, i) => {
              const done = doneSteps.has(i);
              const current = i === currentStep && !done;
              return (
                <div key={i} className={styles.step}>
                  <div className={styles['step-rail']}>
                    <button
                      className={`${styles['step-num']} ${done ? styles.done : current ? styles.current : styles.pending}`}
                      onClick={() => toggleDone(i)}
                      aria-label={done ? 'Скасувати виконання' : 'Позначити готовим'}
                    >
                      {done ? '✓' : i + 1}
                    </button>
                    <div className={styles['step-thread']} />
                  </div>
                  <div className={styles['step-body']}>
                    <div className={`${styles['step-title']} ${done ? styles.done : current ? '' : styles.pending}`}>
                      {step.t}. {renderStepContent(step.c, recipe.ing)}
                    </div>
                    {step.s && (
                      <button className={styles['step-timer']} onClick={() => navigate('/cook', { state: { recipe, startAt: i } })}>
                        ▷ {formatSeconds(step.s)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.foot}>
        <Button
          variant="primary"
          size="lg"
          onClick={() => navigate('/cook', { state: { recipe, startAt: currentStep } })}
        >
          Готуємо
        </Button>
      </div>
    </div>
  );
}

// Плейсхолдери {0}, {1} у step.c замінюємо на "value unit" відповідного інгредієнта.
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

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
