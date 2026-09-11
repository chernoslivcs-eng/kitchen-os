// Одна шапка на всі екрани застосунку.
//
// До неї шапки не існувало: кожен екран малював свою `.head` заново, і в
// чотирьох із них лежала копія `Avatar` — у двох ще й з однаковим інлайновим
// обʼєктом стилю. Означали вони різне: у Комори й Списку був заголовок, у
// Стрічці в шапці стояв **тільки аватар**, без назви.
//
// Геометрія з макета (блок А1): «☰» 36px · заголовок Onest 20 · дія 36px
// праворуч. Правий слот тримає ширину навіть порожнім — інакше заголовок
// стрибає між екранами з дією і без.
//
// Аватар звідси пішов назовсім: профіль живе внизу шухляди, як на десктопі.

import type { ReactNode } from 'react';
import styles from './AppHeader.module.css';
import { Icon } from '../Icon/Icon';

interface Props {
  /** Якір «де я»: після вибору цілі шухляда закривається, лишається заголовок. */
  title: string;
  /** Рівно одна дія екрана. Іконка або моно-caps, ніколи обидва. */
  action?: ReactNode;
  /** Відкрити шухляду. На ≥1024 кнопка схована — там сайдбар стоїть постійно. */
  onMenu?: () => void;
  /** Дії займають решту шапки від заголовка (кадр «Рецепти · 1440»: сегмент
      біля назви, пошук і «Записати свій» — праворуч через розпірку). */
  fill?: boolean;
}

export function AppHeader({ title, action, onMenu, fill }: Props) {
  return (
    <header className={styles.head}>
      <button
        type="button"
        className={styles.burger}
        aria-label="Розгорнути панель"
        onClick={onMenu}
      ><Icon name="sys.expand" size={18} inherit /></button>
      {/* Етап 6a: заголовок екрана — роль h1 (28, на 390 — 26; рішення 11.09). */}
      <h1 className={`${styles.title} ${fill ? styles['title-fit'] : ''} t-h1`}>{title}</h1>
      <div className={`${styles.action} ${fill ? styles['action-fill'] : ''}`}>{action}</div>
    </header>
  );
}
