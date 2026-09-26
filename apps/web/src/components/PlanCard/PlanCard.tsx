// Постановка 2026-09-25 (екран «Підписка», Task 12): картка тарифу — та сама
// розмітка, що в секції «Ціна» лендінга, винесена сюди, щоб /profile/subscription
// не тримав другу копію (лендінг сам перейшов на цей компонент, PlanCard.module.css
// містить усі стилі й брейкпоінти, які раніше жили в Landing.module.css).
//
// bp — той самий Bp з lib/useBreakpoint.ts, але тут не читається напряму з
// matchMedia (щоб компонент не тягнув свій власний слухач): передається
// пропом, бо клас .tab/.mob CSS-модулів по файлах не збігається (кожен
// .module.css хешує імена окремо) — data-bp замість імені класу.
import type { ReactNode } from 'react';
import type { IconName } from '../Icon/icons';
import { Icon } from '../Icon/Icon';
import type { Bp } from '../../lib/useBreakpoint';
import styles from './PlanCard.module.css';

export interface PlanLine { text: string; icon: IconName; soon?: boolean }
export interface PlanCardData {
  /** paper — нейтральна панель (період, не тариф): без бурштину/шавлії. */
  tint: 'paper' | 'amber' | 'sage';
  headIcon: IconName;
  label: string;
  price: string;
  per: string;
  /** Орієнтир у доларах поруч із ціною. */
  approx?: string;
  blurb: string;
  lines: PlanLine[];
}

interface Props {
  data: PlanCardData;
  bp: Bp;
  /** Текст бейджа «скоро» на рядках із soon:true. */
  soonLabel: string;
  /** IntersectionObserver-реєстрація лендінга (useReveal) — Підписка її не викликає. */
  reveal?: string;
  /** Кнопка/пігулка — кожна сторінка сама вирішує, куди вона веде. */
  children: ReactNode;
}

// planBtn/planBtnAfter — свідомо не імпортувати «styles» ЗВІДСИ в Landing.tsx/
// Subscription.tsx: css-orphans.mjs рахує клас живим лише тоді, коли файл, що
// ІМПОРТУЄ САМЕ .module.css, містить його літерал — реекспорт через JS цей
// граф не бачить. Кнопку/пігулку кожна сторінка малює своя (children), тому
// власний import styles from './PlanCard.module.css' у ній самій — не зайвий
// шар, а те, що робить клас доведеним.
export function PlanCard({ data, bp, soonLabel, reveal, children }: Props) {
  return (
    <div data-reveal={reveal} data-bp={bp} className={styles.plan}>
      <div className={`${styles.planPanel} ${data.tint === 'amber' ? styles.tintAmber : data.tint === 'sage' ? styles.tintSage : styles.tintPaper}`}>
        <span className={styles.planHead}>
          <span className={styles.planLabel}>{data.label}</span>
          <span className={styles.planHeadIcon}><Icon name={data.headIcon} size={20} inherit decorative /></span>
        </span>
        <span className={styles.planPrice}>
          <span className={styles.planSum}>{data.price}</span>
          <span className={styles.planPer}>{data.per}</span>
          {data.approx && <span className={styles.planApprox}>{data.approx}</span>}
        </span>
        <p className={styles.planBlurb}>{data.blurb}</p>
      </div>
      <ul className={styles.planList}>
        {data.lines.map((l) => (
          <li key={l.text} className={l.soon ? styles.planLineSoon : styles.planLine}>
            <Icon name={l.icon} size={18} inherit={!l.soon} decorative />
            <span>{l.text}</span>
            {l.soon && <span className={styles.planSoonBadge}>{soonLabel}</span>}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
