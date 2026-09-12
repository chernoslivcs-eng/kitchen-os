// Шапка Рецептів — одна на обидві вкладки (FIXES-V3-2 №43): сегмент
// «Збережені · N / Журнал», пошук, «Записати свій». Раніше Журнал мав свою
// копію без «Записати свій» і з пошуком лише від 8 записів — на порожньому
// екрані шапка «худнула». Тепер вкладка міняє лише те, що в сегменті активне,
// і плейсхолдер пошуку.
//
// На 390 сегмент ховається, в шапці лише круглі знаки 40 (кадр «Рецепти ·
// 390»): пошук · сусідня вкладка · «записати свій».

import { Icon } from '../../components/Icon/Icon';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../../components/AppHeader/AppHeader';
import { useNavStore } from '../../store/nav';
import styles from './Recipes.module.css';

interface Props {
  tab: 'saved' | 'log';
  savedCount: number;
  query: string;
  onQuery: (q: string) => void;
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
}

export function RecipesHead({ tab, savedCount, query, onQuery, searchOpen, onSearchOpen }: Props) {
  const openNav = useNavStore((st) => st.setOpen);
  const navigate = useNavigate();
  const placeholder = tab === 'saved' ? 'Знайти рецепт' : 'Знайти в журналі';
  const other = tab === 'saved'
    ? { label: 'Журнал', to: '/cooklog', icon: 'cook.done' as const }
    : { label: 'Збережені', to: '/recipes', icon: 'sys.recipes' as const };

  return (
    <AppHeader title="Рецепти" onMenu={() => openNav(true)} fill action={<>
      {/* Сегмент, не кнопка (кадр «Рецепти · 1440»): «Збережені · N» — це
          весь список; «Журнал» — окремий екран готувань. */}
      <div className={styles.segment} role="tablist">
        {tab === 'saved' ? (
          <span role="tab" aria-selected="true" className={`${styles.seg} ${styles['seg-on']}`}>
            Збережені{savedCount > 0 && <span className={styles['seg-n']}>· {savedCount}</span>}
          </span>
        ) : (
          <button type="button" role="tab" aria-selected="false" className={styles.seg} onClick={() => navigate('/recipes')}>
            Збережені{savedCount > 0 && <span className={styles['seg-n']}>· {savedCount}</span>}
          </button>
        )}
        {tab === 'log' ? (
          <span role="tab" aria-selected="true" className={`${styles.seg} ${styles['seg-on']}`}>Журнал</span>
        ) : (
          <button type="button" role="tab" aria-selected="false" className={styles.seg} onClick={() => navigate('/cooklog')}>Журнал</button>
        )}
      </div>
      <span className={styles['head-gap']} />
      <label className={styles.search} data-search>
        <Icon name="sys.search" size={16} inherit decorative />
        <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </label>
      <button type="button" className={`${styles['head-icon']} ${styles['head-search']}`} aria-label={placeholder} aria-pressed={searchOpen}
        onClick={() => onSearchOpen(!searchOpen)}>
        <Icon name="sys.search" size={16} inherit decorative />
      </button>
      <button type="button" className={styles['head-icon']} aria-label={other.label} title={other.label} onClick={() => navigate(other.to)}>
        <Icon name={other.icon} size={16} inherit decorative />
      </button>
      {/* DA2-22, Р-2 варіант 2: точка входу там, де її шукають, а канал
          лишається один — чат. Префікс «Запиши мій рецепт:» заодно дає
          моделі явний сигнал на recipe-картку (DA2-23). */}
      <button type="button" className={styles.write} aria-label="Записати свій"
        onClick={() => navigate('/app', { state: { composePrefix: 'Запиши мій рецепт: ' } })}>
        <Icon name="sys.import" size={16} inherit decorative /><span className={styles['write-text']}>Записати свій</span>
      </button>
    </>} />
  );
}

/** Рядок пошуку під шапкою на 390 — той самий на обох вкладках. */
export function SearchRow({ tab, query, onQuery }: Pick<Props, 'tab' | 'query' | 'onQuery'>) {
  const placeholder = tab === 'saved' ? 'Знайти рецепт' : 'Знайти в журналі';
  return (
    <label className={`${styles.search} ${styles['search-row']}`} data-search-row>
      <Icon name="sys.search" size={16} inherit decorative />
      <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus />
    </label>
  );
}
