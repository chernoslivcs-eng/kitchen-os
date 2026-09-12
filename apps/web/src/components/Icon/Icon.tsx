import { useEffect, useRef, type ReactNode } from 'react';
import styles from './Icon.module.css';
import { ICONS, type IconName } from './icons';
import { MOTION, CUSTOM_PATHS, V2_DURATION, isV2, type LiveKey, type IconPart } from './motion';

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

const CARRIER = 'button, a, [role="button"]';

/**
 * Icon Motion v2 (Р117): рух запускається на pointerenter і на click носія
 * (кнопка/посилання зі знаком; без носія — сам знак), дограється до кінця
 * і не обривається на mouseleave: носій тримає `data-play`, CSS грає частини
 * знака; повтор — лише після завершення (data-play знімається за
 * тривалість + 80 мс, як у файлі). Без залежностей: два слухачі й таймер.
 */
function usePlayOnCarrier(ref: React.RefObject<HTMLSpanElement | null>, motion: string | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !isV2(motion as never)) return;
    const dur = V2_DURATION[motion as keyof typeof V2_DURATION]!;
    const carrier = (el.closest(CARRIER) as HTMLElement | null) ?? el;
    let timer = 0;
    const play = () => {
      if (carrier.dataset.play) return;
      carrier.dataset.play = motion!;
      timer = window.setTimeout(() => { delete carrier.dataset.play; }, dur + 80);
    };
    carrier.addEventListener('pointerenter', play);
    carrier.addEventListener('click', play);
    return () => {
      carrier.removeEventListener('pointerenter', play);
      carrier.removeEventListener('click', play);
      window.clearTimeout(timer);
      delete carrier.dataset.play;
    };
  }, [ref, motion]);
}

function renderPart(part: IconPart, i: number): ReactNode {
  const tag = part.tag ?? 'path';
  const attrs: Record<string, unknown> = { ...(part.attrs ?? {}) };
  if (part.d) attrs.d = part.d;
  if (part.p) attrs['data-p'] = part.p;
  if (part.draw) { attrs['data-draw'] = ''; attrs.pathLength = 1; }
  if (part.ve) attrs.vectorEffect = 'non-scaling-stroke';
  const children = part.children?.map(renderPart);
  if (tag === 'g') return <g key={i} {...attrs}>{children}</g>;
  if (tag === 'circle') return <circle key={i} {...attrs} />;
  if (tag === 'rect') return <rect key={i} {...attrs} />;
  return <path key={i} {...attrs} />;
}

/**
 * Єдиний спосіб намалювати знак. Штрих 1.75 і заокруглені кінці стоять тут, а
 * не в кожному місці вжитку: канон обіцяє одну базу, і тримати її має одне
 * місце. Штрих — у координатах viewBox, як у бандлі (`createIcons({ attrs:
 * { 'stroke-width': 1.75 } })`, Icons.dc.html:217): контур масштабується з
 * розміром (16 px → 1.17 px, 12 px → 0.9 px). `absoluteStrokeWidth` давав
 * 1.75 px на екрані при будь-якому кеглі — у 12 px це stroke-width 3.5, і
 * знаки виглядали «як брудні плями» (FIXES-V3 №6). Підпис знака бере словник — тобто `aria-label` не можна розійтися зі
 * значенням, за яким знак закріплений (див. icons.test.ts).
 */
export function Icon({ name, size = 20, tap, inherit, ink, decorative, className, live }: Props) {
  const spec = ICONS[name];
  const Glyph = spec.glyph;
  // Ключ руху з motion.ts — лише для системної сімʼї; решта статична.
  const motion = name.startsWith('sys.') ? MOTION[name as keyof typeof MOTION] : null;
  const custom = CUSTOM_PATHS[name];
  const ref = useRef<HTMLSpanElement>(null);
  usePlayOnCarrier(ref, motion);
  const cls = [
    styles.icon,
    tap ? styles.tap : '',
    inherit ? styles.inherit : '',
    ink ? styles.ink : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <span
      ref={ref}
      className={cls}
      data-icon={name}
      {...(motion ? { 'data-motion': motion } : {})}
      {...(live ? { 'data-live': live } : {})}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': spec.label })}
    >
      {custom ? (
        /* Частини знака з Icon Motion v2 (motion.ts CUSTOM_PATHS): data-p —
           те, що рухає CSS; штрих і кінці — ті самі, що дає lucide-react. */
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {custom.map(renderPart)}
        </svg>
      ) : (
        <Glyph size={size} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </span>
  );
}
