// Публічний read-only рецепт. Гість переходить із розшареного лінка й бачить те саме,
// що бачив автор — назву, час, порції, інгредієнти, кроки. Без Cook Mode, без комори,
// без «показу пальцем» на партії.
//
// Signed-in юзер бачить кнопку «Готуй у себе» — вона приймає рецепт у власну стрічку
// й може одразу піти в Cook Mode. Не signed-in — «Увійти в Kitchen OS».

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { useAuth } from '../../store/auth';
import type { Recipe } from '../../api';
import { formatQty } from '../../lib/units';
import styles from './SharedRecipe.module.css';

interface SharedRecipeResponse {
  id: string;
  title: string;
  recipe: Recipe;
  created_at: string;
}

export function SharedRecipePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const [data, setData] = useState<SharedRecipeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <div className={styles.screen}><div style={{ padding: 22, color: 'var(--fg-muted)' }}>Завантажую…</div></div>;
  }
  if (error || !data) {
    return (
      <div className={styles.screen}>
        <div className={styles.info}>
          <p>{error ?? 'Рецепт не знайдено.'}</p>
          <p style={{ marginTop: 12 }}>
            <Button onClick={() => navigate('/')}>← На головну</Button>
          </p>
        </div>
      </div>
    );
  }

  const r = data.recipe;
  const summary = [
    r.tm ? `${r.tm}ХВ` : null,
    r.sv ? `${r.sv} ПОРЦІЇ` : null,
    r.nu?.kcal ? `${r.nu.kcal}ККАЛ` : null,
  ].filter(Boolean).join(' · ');

  const takeIntoOwnKitchen = () => {
    // Розшарений рецепт — це чужий payload. У «своїй кухні» він має жити відірвано:
    // спочатку відкриємо його як recipe без збереження, потім при потребі cook run
    // збереже його вже під нашого owner.
    navigate('/recipe', { state: { recipe: r } });
  };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <MonoLabel className={styles['head-meta']}>СПІЛЬНИЙ РЕЦЕПТ · KITCHEN OS</MonoLabel>
      </div>

      <div className={styles.body}>
        <h1 className={styles.title}>{r.t}</h1>
        {summary && <div className={styles.summary}>{summary}</div>}
        {r.d && <div className={styles.desc}>{r.d}</div>}
        {r.rk && <div className={styles.rk}>{r.rk}</div>}

        <div className={styles.section}>
          <MonoLabel>ІНГРЕДІЄНТИ</MonoLabel>
          {r.ing.map((ing, i) => (
            <div key={i} className={styles.ing}>
              <span className={styles['ing-mark']}>•</span>
              <span className={styles['ing-name']}>{ing.n ?? (ing.p ? `[${ing.p}]` : '—')}</span>
              {ing.v != null && ing.u && (
                <span className={styles['ing-qty']}>{formatQty(ing.v, ing.u)}</span>
              )}
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <MonoLabel>КРОКИ</MonoLabel>
          <div className={styles.steps}>
            {r.st.map((step, i) => (
              <div key={i} className={styles.step}>
                <div className={styles['step-rail']}>
                  <div className={`${styles['step-num']} ${styles.pending}`}>{i + 1}</div>
                  <div className={styles['step-thread']} />
                </div>
                <div className={styles['step-body']}>
                  <div className={`${styles['step-title']} ${styles.pending}`}>
                    {step.t}. {step.c}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.foot}>
        {status === 'signed_in' ? (
          <Button variant="primary" size="lg" onClick={takeIntoOwnKitchen}>
            Готуй у себе
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => navigate(`/?next=/r/${id}`)}>
            Увійти в Kitchen OS →
          </Button>
        )}
      </div>
    </div>
  );
}
