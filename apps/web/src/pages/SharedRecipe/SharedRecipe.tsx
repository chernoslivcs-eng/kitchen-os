// Публічний read-only рецепт /r/:id. Гість переходить із розшареного лінка й
// бачить те саме, що бачив автор — назву, час, порції, склад, кроки. Без
// Cook Mode, без комори, без «показу пальцем» на партії.
//
// Крок 4 things-v3 — форма за Screens «Публічний рецепт · 1440» (B2): шапка
// без рейки (логотип · «спільний рецепт» · «Увійти»), сітка minmax(0,1fr)
// 340 до 1040 по центру, h1 display, рядок «час · порції · ≈ ккал», кроки
// номерами чорнилом без таймерів, «Склад · N» праворуч, шавлієва картка з
// єдиною дією: гостю — «Увійти в Кухню» (з поверненням сюди), своєму —
// «Готуй у себе» (підтверджене відхилення, HANDOFF). На 390 склад згортається
// над кроками, картка стає липкою знизу.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Logo } from '../../components/Logo/Logo';
import { Icon } from '../../components/Icon/Icon';
import { useAuth } from '../../store/auth';
import type { Recipe, RecipeNutritionInfo } from '../../api';
import { formatQty } from '../../lib/units';
import { plural } from '../../lib/plural';
import { formatDuration } from '@kitchen/domain/duration';
import { renderStepContent } from '../../lib/recipe';
import { kcalLine } from '../Recipe/Recipe';
import styles from './SharedRecipe.module.css';

interface SharedRecipeResponse {
  id: string;
  title: string;
  recipe: Recipe;
  created_at: string;
  nutrition_calc?: RecipeNutritionInfo | null;
}

export function SharedRecipePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const [data, setData] = useState<SharedRecipeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 390: склад — акордеон над кроками (підпис кадра B2).
  const [ingOpen, setIngOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/v1/r/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Рецепт не знайдено. Можливо, лінк застарів.' : 'Не вдалось завантажити рецепт.');
        return res.json();
      })
      .then((body: SharedRecipeResponse) => setData(body))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const signedIn = status === 'signed_in';
  const head = (
    <header className={styles.top}>
      <Logo size={30} />
      <span className={styles['top-name']}>Кухня</span>
      <span className={styles['top-kicker']}>спільний рецепт</span>
      <span className={styles['top-gap']} />
      {!signedIn && <button type="button" className={styles['top-login']} onClick={() => navigate(`/?next=/r/${id}`)}>Увійти</button>}
    </header>
  );

  if (loading) {
    return <div className={styles.screen}>{head}<div className={styles.info}>Завантажую…</div></div>;
  }
  if (error || !data) {
    return (
      <div className={styles.screen}>
        {head}
        <div className={styles.info}>
          <p>{error ?? 'Рецепт не знайдено.'}</p>
          <p style={{ marginTop: 12 }}>
            <Button onClick={() => navigate('/')}>На головну</Button>
          </p>
        </div>
      </div>
    );
  }

  const r = data.recipe;
  const kcal = kcalLine(data.nutrition_calc ?? null, r.nu);
  const takeIntoOwnKitchen = () => {
    // Розшарений рецепт — чужий payload. У «своїй кухні» він живе відірвано:
    // відкриваємо як recipe без збереження; cook run збереже під нашого owner.
    navigate('/recipe', { state: { recipe: r } });
  };

  const action = (
    <div className={styles.cta} data-testid="cta">
      <span className={styles['cta-text']}>
        <b>Готуй у себе.</b> Кухня звірить склад із твоєю коморою й поведе по кроках із таймерами.
      </span>
      {signedIn ? (
        <button type="button" className={styles['cta-btn']} onClick={takeIntoOwnKitchen} data-cook-mine>Готуй у себе</button>
      ) : (
        <button type="button" className={styles['cta-btn']} onClick={() => navigate(`/?next=/r/${id}`)} data-login>
          Увійти в Кухню<Icon name="sys.next" size={16} inherit decorative />
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.screen}>
      {head}
      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.lead}>
            <h1 className={`${styles.title} t-display`}>{r.t}</h1>
            <div className={styles.meta}>
              {r.tm ? <span className={styles['meta-item']}><Icon name="cook.time" size={12} inherit decorative />{formatDuration(r.tm)}</span> : null}
              {r.sv ? <span className={styles['meta-item']}><Icon name="cook.portions" size={12} inherit decorative />{r.sv} {plural(r.sv, ['порція', 'порції', 'порцій'])}</span> : null}
              {kcal && <span>{kcal.replace(' · на порцію', '')}</span>}
            </div>
            {r.d && <p className={styles.desc}>{r.d}</p>}
          </div>
          {/* 390: акордеон складу над кроками. */}
          <button type="button" className={styles['ing-toggle']} onClick={() => setIngOpen((v) => !v)} aria-expanded={ingOpen}>
            <Icon name="cook.missing" size={16} inherit decorative />Склад · {r.ing.length}
            <span className={styles['top-gap']} />
            <Icon name={ingOpen ? 'sys.opened' : 'sys.open'} size={16} inherit decorative />
          </button>
          <div className={`${styles.card} ${styles['card-steps']}`} data-testid="steps">
            {r.st.map((step, i) => (
              <div key={i} className={styles.step}>
                <span className={styles['step-num']}>{i + 1}</span>
                <span className={styles['step-text']}><b>{step.t}.</b> {renderStepContent(step.c, r.ing)}</span>
              </div>
            ))}
          </div>
        </div>
        <aside className={`${styles.aside} ${ingOpen ? styles['aside-open'] : ''}`}>
          <div className={`${styles.card} ${styles['card-ing']}`} data-testid="ingredients">
            <div className={styles['card-head']}><Icon name="cook.missing" size={16} inherit decorative />Склад · {r.ing.length}</div>
            {r.ing.map((ing, i) => (
              <div key={i} className={styles.ing}>
                <span className={styles['ing-name']}>{ing.n ?? 'інгредієнт'}</span>
                <span className={styles['ing-qty']}>{ing.v != null && ing.u ? formatQty(ing.v, ing.u) : '—'}</span>
              </div>
            ))}
          </div>
          {action}
        </aside>
      </div>
    </div>
  );
}
