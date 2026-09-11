// Жива сесія в лептопі — самодостатній мок (Landing Live, кадри 1920 і 1024):
// на тих самих токенах і Icon, без сторів і API застосунку. Сценарій і
// кейфрейми — з бандла (kos-msg a–d · typing · chip · feed · cursor · press ·
// flash), запускаються за IntersectionObserver ([data-live] → data-play).
// prefers-reduced-motion — статичний кінцевий стан (блок reduce у CSS).
import { Icon } from '../../components/Icon/Icon';
import { CART, LIVE } from './copy';
import styles from './Landing.module.css';

/** Курсор із бандла — намальований вказівник, не знак словника. */
export function Cursor({ className, small }: { className?: string; small?: boolean }) {
  return (
    <span className={`${styles.cursor} ${className}`} aria-hidden="true">
      <svg width={small ? 16 : 18} height={small ? 18 : 20} viewBox="0 0 18 20" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M2 1.5 L15.5 9.5 L9.5 10.8 L13 17.5 L10.5 18.7 L7 12 L2.5 16.5 Z" />
      </svg>
    </span>
  );
}

export function Typing() {
  return (
    <span data-ph="t" className={`${styles.typing} ${styles.kTyping}`}>
      <span className={styles.kDot} /><span className={`${styles.kDot} ${styles.kDot2}`} /><span className={`${styles.kDot} ${styles.kDot3}`} />
    </span>
  );
}

const ic = (name: Parameters<typeof Icon>[0]['name'], size: 12 | 16 | 18 | 20 | 24 = 16) => <Icon name={name} size={size} inherit decorative />;

export function LiveSession({ tab }: { tab: boolean }) {
  return (
    <div data-reveal="360" data-live className={styles.laptop}>
      <span aria-hidden="true" data-gloss className={styles.gloss} />
      <div className={styles.screen}>
        <nav className={styles.rail} aria-hidden="true">
          <span className={styles.railMark}><span /></span>
          <span className={`${styles.railBtn} ${styles.railOn}`}>{ic('sys.chat', 18)}</span>
          <span className={styles.railBtn}>{ic('sys.pantry', 18)}{!tab && <span className={styles.railDot} />}</span>
          <span className={styles.railBtn}>{ic('sys.recipes', 18)}</span>
          <span className={styles.railBtn}>{ic('sys.list', 18)}{!tab && <span className={styles.railBadge}>4</span>}</span>
          <span className={styles.railBtn}>{ic('sys.calendar', 18)}</span>
          {!tab && <><span className={styles.grow} /><span className={styles.railAvatar}>П</span></>}
        </nav>
        <main className={styles.lsMain}>
          <header className={styles.lsHead}>
            <span className={styles.sessionPill}>{ic('sys.open')}{LIVE.session}<span className={styles.sessionWhen}>{LIVE.when}</span></span>
            <span className={styles.grow} />
            <span className={`${styles.chip} ${styles.chipAmber}`}>{ic('live.burning')}{LIVE.burning}</span>
            <span className={`${styles.chip} ${styles.chipSage} ${styles.kChip}`}>{ic('cook.timer')}{LIVE.cooking}<span className={styles.kTick}>{LIVE.tick}</span>{LIVE.secs}</span>
            {!tab && <span className={`${styles.chip} ${styles.chipCard}`}>{ic('sys.home')}{LIVE.home}</span>}
          </header>
          <div className={styles.feedClip}>
            <div data-feed className={`${styles.feed} ${styles.kFeed}`}>
              <div className={`${styles.msgRow} ${styles.msgEnd} ${styles.kA}`}><div className={styles.bubble}>{LIVE.ask}</div></div>
              <div className={`${styles.msgCol} ${styles.kB}`}>
                <div className={styles.answer}>{LIVE.answer}</div>
                <div className={styles.recipeCard}>
                  <div className={styles.rRow1}>
                    <span className={styles.rCircle}>{ic('cook.type', 20)}</span>
                    <span className={styles.rBody}>
                      <span className={styles.rTitle}>{LIVE.recipe}</span>
                      <span className={styles.rMeta}><span>{LIVE.time}</span><span className={styles.sage}>{tab ? LIVE.haveShort : LIVE.have}</span><span>{LIVE.kcal}</span></span>
                      {!tab && (
                        <span className={styles.rChips}>
                          <span className={`${styles.mChip} ${styles.mChipAmber}`}>{ic('live.season', 12)}{LIVE.chipSeason}</span>
                          <span className={styles.mChip}>{LIVE.chipA}</span><span className={styles.mChip}>{LIVE.chipB}</span>
                        </span>
                      )}
                    </span>
                    <span className={styles.rActions}>
                      <span className={styles.pressWrap}>
                        <span className={`${styles.pressBtn} ${styles.kPress}`}>{ic('cook.go')}</span>
                        <Cursor className={styles.kCursor} />
                      </span>
                      {!tab && <span className={styles.rOutline}>{ic('sys.reply')}</span>}
                    </span>
                  </div>
                  <div className={styles.rRow2}>
                    {/* Бандл: flame. flame — тільки «Горить» (HANDOFF, RESERVED); тип рецепта — chef-hat (Р41). */}
                    <span className={`${styles.rCircle} ${styles.rCircleMuted}`}>{ic('cook.type', 18)}</span>
                    <span className={styles.rBody}><span className={styles.rTitle2}>{LIVE.recipe2}</span><span className={styles.rMissing}>{LIVE.missing}</span></span>
                    {!tab && <span className={styles.rOutline}>{ic('sys.add')}</span>}
                  </div>
                </div>
              </div>
              <div data-ph="c" className={`${styles.msgRow} ${styles.msgEnd} ${styles.kC}`}><div className={styles.bubble}>{LIVE.pick}</div></div>
              <div className={styles.msgRow}><Typing /></div>
              <div data-ph="d" className={`${styles.msgCol} ${styles.msgColD} ${styles.kD}`}>
                <div className={styles.answer}>{LIVE.cart}</div>
                <span className={styles.cartChip}>{ic('sys.cart', 18)}<span className={styles.cartChipT}>{LIVE.cartChip}</span><span className={styles.cartChipS}>{LIVE.cartSum}</span>{!tab && <span className={styles.dimIcon}>{ic('landing.toPanel')}</span>}</span>
              </div>
            </div>
          </div>
          <div className={styles.composerWrap}>
            <div className={styles.composer}>
              <span className={styles.cBtn}>{ic('sys.add', 18)}</span>
              <span className={styles.cPh}>{LIVE.composer}</span>
              <span className={styles.cBtn}>{ic('sys.voice', 18)}</span>
              <span className={`${styles.cBtn} ${styles.cSend}`}>{ic('sys.send', 18)}</span>
            </div>
          </div>
        </main>
        <aside {...(tab ? {} : { 'data-reveal': '4400', 'data-reveal-x': '' })} className={styles.aside}>
          <div className={styles.asideHead}>
            {ic('sys.cart')}<span className={styles.asideTitle}>{LIVE.asideTitle}</span><span className={styles.asideN}>{LIVE.asideN}</span><span className={styles.grow} />
            {!tab && <span className={styles.mutedIcon}>{ic('sys.panelClose')}</span>}
          </div>
          <div className={styles.asideList}>
            {CART.map((c) => (
              <div key={c.n} className={`${styles.cartRow} ${c.flash ? styles.kFlash : ''}`}>
                <span className={styles.cartName}><span>{c.n}</span><span className={styles.cartSub}>{c.s}</span></span>
                {/* Кількість числом, як на кадрі 1024: степер бандла тримається на minus, а minus у словнику — «Нічого не змінилось» (QUESTIONS §16). */}
                <span className={styles.qty}>{c.q}</span>
                <span className={styles.cartPrice}>{c.p}</span>
              </div>
            ))}
          </div>
          <div className={styles.asideFoot}>
            <span className={styles.total}><span className={styles.totalL}>{LIVE.total}</span><span className={styles.totalV}>{LIVE.cartSum}</span></span>
            <span className={styles.checkout}>{tab ? LIVE.checkoutShort : <>{LIVE.checkout}{ic('sys.out')}</>}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
