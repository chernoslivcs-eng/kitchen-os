// Телефон: у hero на 390 (жива сесія, «клік → таймер» усередині) і у фіналі
// 1920 (статичний, з паралаксом і маскою). Той самий екран чату, що в лептопі,
// у мобільній щільності бандла.
import { Icon } from '../../components/Icon/Icon';
import { Cursor, Typing } from './LiveSession';
import { LIVE } from './copy';
import styles from './Landing.module.css';

const ic = (name: Parameters<typeof Icon>[0]['name'], size: 12 | 16 | 18 | 20 | 24 = 12) => <Icon name={name} size={size} inherit decorative />;
const TAB_ICONS = ['sys.chat', 'sys.pantry', 'sys.recipes', 'sys.list', 'sys.calendar'] as const;

export function PhoneMock({ variant }: { variant: 'hero' | 'final' }) {
  const live = variant === 'hero';
  return (
    <div {...(live ? { 'data-live': '' } : {})} className={`${styles.phone} ${live ? styles.phoneHero : styles.phoneFinal}`}>
      <span aria-hidden="true" data-gloss className={`${styles.gloss} ${styles.glossPhone}`} />
      <div className={styles.phScreen}>
        <header className={styles.phHead}>
          <span className={styles.phPill}>{LIVE.session}{ic('sys.open')}</span>
          <span className={styles.grow} />
          <span className={`${styles.phChip} ${styles.chipAmber}`}>{ic('live.burning')}{LIVE.burningShort}</span>
          {live && <span className={`${styles.phChip} ${styles.chipSage} ${styles.kChip}`}>{ic('cook.timer')}{LIVE.cookingShort}<span className={styles.kTick}>{LIVE.tick}</span>{LIVE.secs}</span>}
        </header>
        <div className={styles.phFeedClip}>
          <div {...(live ? { 'data-feed': '' } : {})} className={`${styles.phFeed} ${live ? styles.kFeed : ''}`}>
            <div className={`${styles.phBubble} ${live ? styles.kA : ''}`}>{LIVE.ask}</div>
            <div className={`${styles.phText} ${live ? styles.kB : ''}`}>{LIVE.answerShort}</div>
            <div className={styles.phCard}>
              <div className={styles.phCardRow}>
                <span className={styles.phCircle}>{ic('cook.type', 16)}</span>
                <span className={styles.rBody}>
                  <span className={styles.phTitle}>{LIVE.recipe}</span>
                  <span className={styles.phMeta}>{LIVE.time} · <span className={styles.sage}>{LIVE.haveAll}</span></span>
                </span>
                <span className={styles.pressWrap}>
                  <span className={`${styles.phPress} ${live ? styles.kPress : ''}`}>{ic('cook.go', 12)}</span>
                  {live && <Cursor className={styles.kCursor} small />}
                </span>
              </div>
              <div className={styles.phChips}>
                <span className={`${styles.phMChip} ${styles.mChipAmber}`}>{LIVE.chipSeasonShort}</span>
                <span className={styles.phMChip}>{LIVE.chipA}</span><span className={styles.phMChip}>{LIVE.chipB}</span>
              </div>
            </div>
            {live && (
              <>
                <div data-ph="c" className={`${styles.phBubble} ${styles.kC}`}>{LIVE.pickShort}</div>
                <Typing />
                <div data-ph="d" className={`${styles.phCol} ${styles.kD}`}>
                  <div className={styles.phText}>{LIVE.cartShort}</div>
                  <span className={styles.phCartChip}>{ic('sys.cart', 16)}<span className={styles.cartChipT}>{LIVE.cartChip}</span><span className={styles.cartChipS}>{LIVE.cartSum}</span></span>
                </div>
              </>
            )}
          </div>
        </div>
        <div className={styles.phComposerWrap}>
          <div className={styles.phComposer}>
            <span className={styles.phCBtn}>{ic('sys.add', 16)}</span>
            <span className={styles.phCPh}>{LIVE.composerShort}</span>
            <span className={styles.phCBtn}>{ic('sys.voice', 16)}</span>
          </div>
        </div>
        <nav className={styles.phNav} aria-hidden="true">
          {LIVE.tabs.map((t, i) => (
            <span key={t} className={`${styles.phTab} ${i === 0 ? styles.phTabOn : ''}`}>
              <span className={styles.phTabPill}>{ic(TAB_ICONS[i]!, 16)}</span><span className={styles.phTabLabel}>{t}</span>
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}
