import styles from './Icon.module.css';
import { ICONS, type IconName } from './icons';

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
}

/**
 * Єдиний спосіб намалювати знак. Штрих 1.75 і заокруглені кінці стоять тут, а
 * не в кожному місці вжитку: канон обіцяє одну базу, і тримати її має одне
 * місце. Підпис знака бере словник — тобто `aria-label` не можна розійтися зі
 * значенням, за яким знак закріплений (див. icons.test.ts).
 */
export function Icon({ name, size = 20, tap, inherit, ink, decorative, className }: Props) {
  const spec = ICONS[name];
  const Glyph = spec.glyph;
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
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': spec.label })}
    >
      <Glyph size={size} strokeWidth={1.75} absoluteStrokeWidth strokeLinecap="round" strokeLinejoin="round" />
    </span>
  );
}
