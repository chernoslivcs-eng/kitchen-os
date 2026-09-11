import styles from './Icon.module.css';
import { ICONS, type IconName } from './icons';
import { MOTION, CUSTOM_PATHS, type LiveKey } from './motion';

/** Розміри з канону, і тільки вони: 12 — слот походження в рядку · 16 — у
 *  тексті · 18 — рейка (кнопки 38, іконки 18) · 20 — інтерфейс · 24 — Cook
 *  Mode. Союз навмисно закритий: він і є та перевірка, що не дасть завести
 *  свій кегль знака в обхід канону. */
export type IconSize = 12 | 16 | 18 | 20 | 24;

interface Props {
  name: IconName;
  size?: IconSize;
  /** Жива зона 44 × 44 — для самостійних мішеней, не для знака в тексті. */
  tap?: boolean;
  /** Успадкувати колір батька: так знак бере рід (шавлія / бурштин / слива). */
  inherit?: boolean;
  /** Чорнило замість muted — активна ціль. */
  ink?: boolean;
  /** Знак поруч із власним підписом нічого не додає читачеві екрана. */
  decorative?: boolean;
  className?: string;
  /** Живий стан (1.5b): рух іде, поки триває процес, без наведення —
   *  flame 1.6 с · timer 1.2 с · mic 1.2 с · think 1.4 с. */
  live?: LiveKey;
}

/**
 * Єдиний спосіб намалювати знак. Штрих 1.75 і заокруглені кінці стоять тут, а
 * не в кожному місці вжитку: канон обіцяє одну базу, і тримати її має одне
 * місце. Підпис знака бере словник — тобто `aria-label` не можна розійтися зі
 * значенням, за яким знак закріплений (див. icons.test.ts).
 */
export function Icon({ name, size = 20, tap, inherit, ink, decorative, className, live }: Props) {
  const spec = ICONS[name];
  const Glyph = spec.glyph;
  // 1.5b: ключ руху з motion.ts — лише для системної сімʼї; решта статична.
  const motion = name.startsWith('sys.') ? MOTION[name as keyof typeof MOTION] : null;
  const custom = CUSTOM_PATHS[name];
  const cls = [
    styles.icon,
    tap ? styles.tap : '',
    inherit ? styles.inherit : '',
    ink ? styles.ink : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      data-icon={name}
      {...(motion ? { 'data-motion': motion } : {})}
      {...(live ? { 'data-live': live } : {})}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': spec.label })}
    >
      {custom ? (
        /* Власні шляхи (Icons.dc.html:218-229): частини знака розділені під
           рух; штрих і кінці — ті самі, що дає lucide-react. */
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={1.75 * (24 / size)} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {custom.map((d, i) => <path key={i} d={d} />)}
        </svg>
      ) : (
        <Glyph size={size} strokeWidth={1.75} absoluteStrokeWidth strokeLinecap="round" strokeLinejoin="round" />
      )}
    </span>
  );
}
