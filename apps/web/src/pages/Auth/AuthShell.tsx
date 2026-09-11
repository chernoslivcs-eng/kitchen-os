// Каркас сторінок між листом і продуктом («Kitchen OS - Auth.dc.html», пакет
// C3–C4): та ж шапка, що на лендінгу, hero-градієнт, центрована колонка,
// кікер-піл у роді, заголовок у два тони, підзаголовок, слот картки, підпис.
// Бандл малює 1024 і 390; ≥768 — кадр 1024 fluid, <768 — кадр 390 (DEVIATIONS-V3-landing Р49).
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import styles from './Auth.module.css';

interface Props {
  tone: 'sage' | 'plum' | 'danger';
  kickIcon: IconName;
  kick: string;
  h1a: string;
  h1b: string;
  sub: string;
  foot?: ReactNode;
  children?: ReactNode;
}

export function AuthShell({ tone, kickIcon, kick, h1a, h1b, sub, foot, children }: Props) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}><span className={styles.mark} aria-hidden="true"><span /></span><span className={styles.logoText}>Kitchen OS</span></Link>
        <Link to="/" className={styles.back}><Icon name="sys.back" size={16} inherit decorative />На головну</Link>
      </header>
      <main className={styles.main}>
        <span className={`${styles.kick} ${styles[`kick-${tone}`]}`}><Icon name={kickIcon} size={16} inherit decorative />{kick}</span>
        <h1 className={styles.h1}><span className={styles.h1a}>{h1a}</span><span>{h1b}</span></h1>
        <p className={styles.sub}>{sub}</p>
        <div className={styles.card}>
          {children}
          {foot && <span className={styles.foot}>{foot}</span>}
        </div>
      </main>
    </div>
  );
}
