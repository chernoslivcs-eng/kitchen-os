// Екран рецепта — адресна сторінка (F5, закладки). Робота з рецептом живе в
// розмові (правка №10), тут — «Обговорити в чаті», «Поділитись», закладка,
// звірка складу з коморою і «Готуємо».
//
// Крок 4 things-v3 — форма за Screens «Рецепт · 1440» / «Рецепт · 390»:
// шапка пігулками (← Рецепти · Збережено/Колись · Поділитись · Обговорити в
// чаті), чіп стану в роді + h1 display + рядок «час · ≈ ккал · пісне ·
// готував N», картка «Кроки · N» (галочка шавлією зробленому, активний —
// підкладка bg з таймером), праворуч «Склад · N» із порційником і крапками
// роду (є / відкрите / бракує) та «Готуємо» 52 чорнилом. На 390 — те саме
// однією колонкою, «Готуємо» липка знизу.

import { useEffect, useState } from 'react';
import { track } from '../../lib/track';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { api, type Recipe, type RecipeNutritionInfo, type SavedRecipe } from '../../api';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';
import { formatDuration } from '@kitchen/domain/duration';
import { resolveIngName, renderStepContent, stepLabelsFrom, scaleRecipe, type BatchLabels } from '../../lib/recipe';
import styles from './Recipe.module.css';
import { Icon } from '../../components/Icon/Icon';
import { useCookStore } from '../../store/cook';
import { statusWord } from '../Recipes/library';

interface RecipeLocationState {
  recipe?: Recipe;
}

/** «≈ 540 ккал · Б 22 · Ж 18 · В 68 · на порцію» — з каталогу, коли є; інакше оцінка моделі. */
export function kcalLine(calc: RecipeNutritionInfo | null, nu: Recipe['nu'] | undefined): string | null {
  if (calc) {
    const n = calc.per_serving;
    return `${calc.approx ? '≈ ' : ''}${n.kcal} ккал · Б ${Math.round(n.protein)} · Ж ${Math.round(n.fat)} · В ${Math.round(n.carbs)} · на порцію`;
  }
  if (nu?.kcal) return `≈ ${nu.kcal} ккал · Б ${Math.round(nu.p)} · Ж ${Math.round(nu.f)} · В ${Math.round(nu.c)} · на порцію`;
  return null;
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function RecipePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  // Крок О1а: рецепт відкрили. Назви страви не шлемо — лише факт і чи має адресу.
  useEffect(() => { track('recipe_opened', { saved: !!id }); }, [id]);
  // Р-3: рецепт живе за адресою. State — лише миттєвий кеш для першого рендера;
  // джерело істини — GET /v1/recipes/:id, тому F5 більше нічого не губить.
  const [fetched, setFetched] = useState<Recipe | null>(null);
  const [fetchedSaved, setFetchedSaved] = useState<string | null>(null);
  // Раунд 5, крок Н1: БЖВ з каталогу — лише для збереженого рецепта (є адреса).
  const [calc, setCalc] = useState<RecipeNutritionInfo | null>(null);
  // Стан проти комори, «готував N», «використає» — рахує сервер для списку
  // бібліотеки; беремо той самий рядок, щоб чіп на сторінці не розходився з
  // карткою в бібліотеці.
  const [lib, setLib] = useState<SavedRecipe | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    if (!id) return;
    api.savedRecipes.get(id)
      .then((r) => { setFetched(r.recipe); setFetchedSaved(r.saved_at); setCalc(r.nutrition_calc ?? null); })
      .catch(() => setNotFound(true));
    api.savedRecipes.list()
      .then((r) => setLib(r.recipes.find((x) => x.id === id) ?? null))
      .catch(() => {/* тихо: без рядка бібліотеки чіп рахується зі складу */});
  }, [id]);
  const baseRecipe = (location.state as RecipeLocationState | null)?.recipe ?? fetched ?? null;
  // Порційник: детерміноване множення кількостей (0 токенів); складне — чатом.
  const [servings, setServings] = useState<number | null>(null);
  const cookOpen = useCookStore((s) => s.open);
  const recipe = baseRecipe ? scaleRecipe(baseRecipe, servings ?? baseRecipe.sv ?? 1) : null;
  const [currentStep, setCurrentStep] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [allergies, setAllergies] = useState<{ label: string; who: string | null }[]>([]);
  const [antis, setAntis] = useState<string[]>([]);
  const [openedIds, setOpenedIds] = useState<Set<string>>(new Set());
  const [batchLabels, setBatchLabels] = useState<BatchLabels>(new Map());
  const [stepLabels, setStepLabels] = useState<BatchLabels>(new Map());

  useEffect(() => {
    // Підтягнемо алергії з профілю, щоб позначити відповідні інгредієнти.
    // «Позначка, а не заборона» — рецепт лишається доступним, ми тільки попереджаємо.
    api.profileV2.get()
      .then(({ veto }) => {
        const rows = veto ?? [];
        setAllergies(rows.filter((r) => r.allergy).map((r) => ({ label: r.label, who: null as string | null })));
        setAntis(rows.filter((r) => !r.allergy).map((r) => r.label));
      })
      .catch(() => {/* silent */});
    // Мапа id партії → людський label: модель показує на комору через `ing.p`,
    // а рендер має показати назву, не uuid.
    api.pantry()
      .then(({ batches, products }) => {
        setBatchLabels(new Map(batches.map((b) => [b.id, b.label])));
        setStepLabels(stepLabelsFrom(batches, products));
        setOpenedIds(new Set(batches.filter((b) => b.state === 'opened').map((b) => b.id)));
      })
      .catch(() => {/* silent */});
  }, []);

  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => { if (fetchedSaved) setSavedId(id ?? 'saved'); }, [fetchedSaved, id]);
  const [saving, setSaving] = useState(false);
  async function saveForLater() {
    if (!recipe || savedId || saving) return;
    setSaving(true);
    try {
      if (id) {
        await api.savedRecipes.setSaved(id, true);
        setSavedId(id);
      } else {
        const r = await api.savedRecipes.save(recipe);
        setSavedId(r.id);
      }
    } catch {
      alert('Не вдалося зберегти рецепт. Спробуй ще раз.');
    } finally { setSaving(false); }
  }

  function flagsFor(ingName: string): { allergy: { label: string; who: string | null } | null; anti: string | null } {
    const n = ingName.toLowerCase();
    const allergy = allergies.find((a) => a.label && n.includes(a.label.toLowerCase())) ?? null;
    const anti = antis.find((a) => {
      const words = a.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3);
      return words.some((w) => n.includes(w.slice(0, Math.max(4, w.length - 2))));
    }) ?? null;
    return { allergy, anti };
  }

  if (!recipe) {
    if (id && !notFound) return <div className={styles.screen} />;
    return (
      <div className={styles.screen}>
        <div className={styles.info}>
          <p>Рецепт не знайдено.</p>
          <p style={{ marginTop: 12 }}>
            <Button onClick={() => navigate('/app')}>Назад у стрічку</Button>
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

  const sv = recipe.sv ?? 1;
  const total = recipe.ing.length;
  const have = recipe.ing.filter((ing) => !!ing.p).length;
  // Чіп стану в роді: слово з бібліотеки (сервер), «N з M» — зі складу.
  const status = lib ? statusWord(lib) : statusWord({ status: have === total ? 'ready' : total - have <= 2 ? 'near' : 'far' });
  const kcal = kcalLine(calc, recipe.nu);
  const cooked = lib?.cooked_count ?? 0;
  const discuss = async () => {
    if (!id) return;
    try {
      const { session } = await api.session.fresh(id);
      navigate('/app', { state: { sessionId: session.id, at: Date.now() } });
    } catch {/* тихо */}
  };
  const share = () => navigate('/share', { state: { recipe, recipeId: id ?? savedId } });

  const stepsCard = (
    <div className={`${styles.card} ${styles['card-steps']}`} data-testid="steps">
      <div className={styles['card-head']}><Icon name="cook.steps" size={16} inherit decorative />Кроки · {recipe.st.length}</div>
      {recipe.st.map((step, i) => {
        const done = doneSteps.has(i);
        const current = i === currentStep && !done;
        return (
          <div key={i} className={`${styles.step} ${current ? styles['step-current'] : ''}`} data-step-state={done ? 'done' : current ? 'current' : 'pending'}>
            <button
              type="button"
              className={`${styles['step-num']} ${done ? styles['step-done'] : current ? styles['step-now'] : ''}`}
              onClick={() => toggleDone(i)}
              aria-label={done ? 'Скасувати виконання' : 'Позначити готовим'}
            >
              {done ? <Icon name="sys.done" size={16} inherit decorative /> : i + 1}
            </button>
            <span className={`${styles['step-text']} ${done ? styles['step-text-done'] : ''}`}>
              <b>{step.t}.</b> {renderStepContent(step.c, recipe.ing, stepLabels)}
            </span>
            {!!step.s && (
              <button type="button" className={styles['step-timer']} onClick={() => cookOpen({ recipe: recipe!, startAt: i, recipeId: id })}>
                <Icon name="cook.timer" size={12} inherit decorative />{formatSeconds(step.s)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  const ingCard = (
    <div className={`${styles.card} ${styles['card-ing']}`} data-testid="ingredients">
      <div className={styles['card-head']}>
        <Icon name="cook.missing" size={16} inherit decorative />Склад · {total}
        <span className={styles['head-gap']} />
        {/* Порційник (Screens): пілюля на bg «− 2 порції +». */}
        <span className={styles.portions} role="group" aria-label="Порції">
          <button type="button" aria-label="Менше порцій" disabled={sv <= 1} onClick={() => setServings(Math.max(1, sv - 1))}><Icon name="live.nothing" size={12} inherit decorative /></button>
          <span className={styles['portions-n']}>{sv} {plural(sv, ['порція', 'порції', 'порцій'])}</span>
          <button type="button" aria-label="Більше порцій" disabled={sv >= 12} onClick={() => setServings(Math.min(12, sv + 1))}><Icon name="sys.add" size={12} inherit decorative /></button>
        </span>
      </div>
      {recipe.ing.map((ing, i) => {
        const name = resolveIngName(ing, batchLabels);
        const { allergy, anti } = flagsFor(name);
        const opened = !!ing.p && openedIds.has(ing.p);
        const dot = !ing.p ? 'missing' : opened ? 'opened' : 'have';
        return (
          <div key={i} className={styles.ing} data-ing-state={dot}>
            <span className={`${styles.dot} ${styles[`dot-${dot}`]}`} aria-hidden />
            <span className={styles['ing-name']}>
              <span className={styles['ing-text']}>{name}</span>
              {allergy && <span className={`${styles.tag} ${styles['tag-danger']}`}>алергія{allergy.who ? ` · ${allergy.who}` : ''}</span>}
              {!allergy && anti && <span className={`${styles.tag} ${styles['tag-plum']}`}>не люблю</span>}
              {opened && <span className={`${styles.tag} ${styles['tag-amber']}`}>відкрито</span>}
            </span>
            {ing.v != null && ing.u && <span className={styles['ing-qty']}>{formatQty(ing.v, ing.u)}</span>}
          </div>
        );
      })}
      <div className={styles.legend}>
        <span className={`${styles.dot} ${styles['dot-have']}`} aria-hidden />є вдома
        <span className={`${styles.dot} ${styles['dot-opened']}`} aria-hidden />відкрите
        <span className={`${styles.dot} ${styles['dot-missing']}`} aria-hidden />бракує
      </div>
    </div>
  );

  const cookBtn = (
    <button type="button" className={styles.cook} onClick={() => cookOpen({ recipe: recipe!, startAt: currentStep, recipeId: id })} data-cook>
      <Icon name="cook.go" size={18} inherit decorative />Готуємо
    </button>
  );

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <button type="button" className={`${styles.pill} ${styles['pill-back']}`} onClick={() => navigate(-1)} aria-label="Назад до рецептів">
          <Icon name="sys.back" size={16} inherit decorative /><span className={styles['pill-text']}>Рецепти</span>
        </button>
        <span className={styles['head-gap']} />
        {/* «Збережено» шавлією (bookmark-check) або «Колись» (підтверджене
            відхилення: закладка на потім). */}
        <button type="button" className={`${styles.pill} ${savedId ? styles['pill-saved'] : ''}`} onClick={saveForLater} disabled={savedId !== null || saving} aria-label={savedId ? 'Збережено' : 'Колись'} data-save>
          <Icon name={savedId ? 'sys.saved' : 'sys.later'} size={16} inherit decorative /><span className={styles['pill-text']}>{savedId ? 'Збережено' : saving ? '…' : 'Колись'}</span>
        </button>
        <button type="button" className={styles.pill} onClick={share} aria-label="Поділитись" data-share>
          <Icon name="sys.share" size={16} inherit decorative /><span className={styles['pill-text']}>Поділитись</span>
        </button>
        {id && (
          <button type="button" className={styles.pill} onClick={() => void discuss()} aria-label="Обговорити в чаті" data-discuss>
            <Icon name="sys.reply" size={16} inherit decorative /><span className={styles['pill-text']}>Обговорити в чаті</span>
          </button>
        )}
      </header>

      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.lead}>
            <div className={styles.chips}>
              <span className={`${styles.chip} ${styles[`chip-${status.tone}`]}`} data-status={status.tone}>
                <span className={styles['chip-dot']} aria-hidden />{status.text} · {have} з {total}
              </span>
              {lib?.rescues?.length ? (
                <span className={`${styles.chip} ${styles['chip-amber']}`}><Icon name="live.burning" size={12} inherit decorative />{lib.rescues.join(' · ')}</span>
              ) : null}
            </div>
            <h1 className={`${styles.title} t-display`}>{recipe.t}</h1>
            <div className={styles.meta}>
              {recipe.tm ? <span className={styles['meta-item']}><Icon name="cook.time" size={16} inherit decorative />{formatDuration(recipe.tm)}</span> : null}
              {kcal && <span data-testid="nutrition-calc">{kcal}</span>}
              {cooked > 0 && <span className={styles['meta-item']}><Icon name="cook.done" size={12} inherit decorative />готував {cooked} {plural(cooked, ['раз', 'рази', 'разів'])}</span>}
            </div>
            {recipe.d && <p className={styles.desc}>{recipe.d}</p>}
            {recipe.rk && <p className={styles.rk}>{recipe.rk}</p>}
          </div>
          {stepsCard}
        </div>
        {/* На 390 колонки розпадаються (display: contents), порядок — лід ·
            склад · кроки · «Готуємо» липка знизу (кадр «Рецепт · 390»). */}
        <aside className={styles.aside}>
          {ingCard}
          <div className={styles['cook-wrap']}>
            {cookBtn}
            <span className={styles['cook-hint']}>Cook Mode веде по кроках з таймерами; після — списує з комори те, що пішло в страву.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
