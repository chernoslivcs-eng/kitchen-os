// Екран рецепта — 09 з брифу. Отримує рецепт через react-router state
// (з попереднього «Рецепт →» на пропозиції). Якщо стан порожній (F5),
// показуємо повідомлення й пропонуємо повернутись у стрічку.

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api, type Recipe } from '../../api';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';
import { resolveIngName, renderStepContent, type BatchLabels } from '../../lib/recipe';
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
  const [allergies, setAllergies] = useState<{ label: string; who: string | null }[]>([]);
  const [antis, setAntis] = useState<string[]>([]);
  const [openedIds, setOpenedIds] = useState<Set<string>>(new Set());
  const [batchLabels, setBatchLabels] = useState<BatchLabels>(new Map());

  useEffect(() => {
    // Підтягнемо алергії з профілю, щоб позначити відповідні інгредієнти.
    // «Позначка, а не заборона» — рецепт лишається доступним, ми тільки попереджаємо.
    api.profile()
      .then(({ profile, eaters }) => {
        // DA-06: алергія їдця — теж мітка на інгредієнті («⚠ АЛЕРГІЯ ОКСАНИ»
        // в хендофі). Другий рубіж поверх промахів моделі — QA7-06 показав,
        // що перший (промпт) інколи мовчить.
        setAllergies([
          ...profile.allergies.map((a) => ({ label: a, who: null as string | null })),
          ...(eaters ?? []).flatMap((e) => e.allergies.map((a) => ({ label: a, who: e.name }))),
        ]);
        setAntis(profile.antipatterns);
      })
      .catch(() => {/* silent */});
    // Мапа id партії → людський label: модель показує на комору через `ing.p`,
    // а рендер має показати назву, не uuid. Без цього алергічна мітка теж
    // мертва: flagsFor читає рядок «[uuid…]» і нічому не збігається.
    api.pantry()
      .then(({ batches }) => {
        setBatchLabels(new Map(batches.map((b) => [b.id, b.label])));
        // ◔ відкрито — чип із кіта: видно, що інгредієнт уже почато.
        setOpenedIds(new Set(batches.filter((b) => b.state === 'opened').map((b) => b.id)));
      })
      .catch(() => {/* silent */});
  }, []);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function saveForLater() {
    if (!recipe || savedId || saving) return;
    setSaving(true);
    try {
      const { id } = await api.savedRecipes.save(recipe);
      setSavedId(id);
    } catch (err) {
      alert(`Не вдалося зберегти: ${(err as Error).message}`);
    } finally { setSaving(false); }
  }

  function flagsFor(ingName: string): { allergy: { label: string; who: string | null } | null; anti: string | null } {
    const n = ingName.toLowerCase();
    const allergy = allergies.find((a) => a.label && n.includes(a.label.toLowerCase())) ?? null;
    // АНТИ — грубий збіг по слову: «не люблю кінзу» помітить «кінза» через корінь «кінз».
    const anti = antis.find((a) => {
      const words = a.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
      return words.some((w) => n.includes(w.slice(0, Math.max(4, w.length - 2))));
    }) ?? null;
    return { allergy, anti };
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
    recipe.sv ? `${recipe.sv} ${plural(recipe.sv, ['ПОРЦІЯ', 'ПОРЦІЇ', 'ПОРЦІЙ'])}` : null,
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
            const name = resolveIngName(ing, batchLabels);
            const { allergy, anti } = flagsFor(name);
            const opened = !!ing.p && openedIds.has(ing.p);
            return (
              <div key={i} className={styles.ing}>
                <span className={`${styles['ing-mark']} ${ing.p ? '' : styles.missing}`}>
                  {ing.p ? '●' : '○'}
                </span>
                <span className={`${styles['ing-name']} ${ing.p ? '' : styles.missing}`}>
                  {name}
                  {allergy && (
                    <span className={styles['ing-chip']} style={{
                      background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger)',
                    }}>
                      ⚠ {allergy.who ? `АЛЕРГІЯ ${allergy.who}` : allergy.label}
                    </span>
                  )}
                  {!allergy && anti && (
                    <span className={styles['ing-chip']} style={{
                      background: 'var(--plum-bg)', border: '1px solid var(--plum-border)', color: 'var(--plum)',
                    }}>
                      АНТИ
                    </span>
                  )}
                  {opened && (
                    <span className={styles['ing-chip']} style={{
                      background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: 'var(--amber)',
                    }}>
                      ◔ відкрито
                    </span>
                  )}
                </span>
                {ing.v != null && ing.u && (
                  <span className={styles['ing-qty']}>{formatQty(ing.v, ing.u)}</span>
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
                      {step.t}. {renderStepContent(step.c, recipe.ing, batchLabels)}
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

      <div className={styles.foot} style={{ display: 'flex', gap: 10 }}>
        {/* QA-6: рецепт існував тільки як побічний ефект cook-run — не приготував,
            зник назавжди. Тепер його можна лишити в бібліотеці, і він сам
            підсвітиться, коли в коморі зʼявиться все потрібне. */}
        <Button
          variant="secondary"
          size="lg"
          onClick={saveForLater}
          disabled={savedId !== null || saving}
        >
          {savedId ? '✓ Збережено' : saving ? '…' : '☆ На потім'}
        </Button>
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

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
