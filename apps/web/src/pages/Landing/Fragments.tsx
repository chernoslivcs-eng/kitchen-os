// Скло-фрагменти «Що вміє» — з renderVals() бандла: fragPantry · fragReceipt ·
// fragCook · fragList · fragJournal · fragCal (1920, GLASS, з kos-анімаціями) і
// їхні мобільні пари mPantry … mCal (1024/390, картки без скла й руху).
// Порядок масивів = порядок ROWS у copy.ts.
import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { Cursor } from './LiveSession';
import styles from './Landing.module.css';

type Name = Parameters<typeof Icon>[0]['name'];
const ic = (name: Name, size: 12 | 16 | 18 | 20 | 24 = 16) => <Icon name={name} size={size} inherit decorative />;

/** Оцінка зірками — знак cook.rating, а не гліф «★» (канон: текстових гліфів 0; Р41). */
function Stars({ n, live }: { n: number; live?: boolean }) {
  return (
    <span className={styles.stars}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`${styles.star} ${i < n ? styles.starOn : ''} ${live && i === 4 ? `${styles.starOn} ${styles.kStar}` : ''}`}>{ic('cook.rating', 12)}</span>
      ))}
    </span>
  );
}

// ---------- 1920: скло ----------
const Card = ({ children }: { children: ReactNode }) => <div className={`${styles.glass} ${styles.gCard}`}>{children}</div>;
const ZoneHead = ({ icon, name, n }: { icon: Name; name: string; n: string }) => (
  <div className={styles.zoneHead}>{ic(icon)}{name}<span className={styles.zoneN}>{n}</span></div>
);
const Row = ({ name, sub, pct, tone, days, qty }: { name: string; sub?: string; pct: number | null; tone: 'sage' | 'amber'; days: string; qty: string }) => (
  <div className={styles.fRow}>
    <span className={styles.fName}><span>{name}</span>{sub && <span className={styles.fSub}>{sub}</span>}</span>
    {pct != null ? <span className={styles.bar}><span className={tone === 'sage' ? styles.barSage : styles.barAmber} style={{ width: `${pct}%` }} /></span> : <span className={styles.barSpace} />}
    <span className={`${styles.fDays} ${tone === 'amber' ? styles.amber : ''}`}>{days}</span>
    <span className={styles.fQty}>{qty}</span>
  </div>
);

const FragPantry = () => (
  <Card>
    <ZoneHead icon="sys.pantry" name="Холодильник" n="31" />
    <div className={styles.fBody}>
      <div className={styles.fRow}>
        <span className={styles.fName}><span>Фует</span><span className={styles.fSub}>Ковбаса · с/в</span></span>
        <span className={styles.bar}><span className={`${styles.barAmber} ${styles.kBar}`} /></span>
        <span className={`${styles.fDays} ${styles.kTone}`}><span className={`${styles.inline} ${styles.kStep}`}>2 дн</span></span>
        <span className={styles.fQty}>160 г</span>
      </div>
      <Row name="Моцарела" pct={40} tone="amber" days="≈ 3 дн" qty="125 г" />
      <Row name="Яйця" sub="С1" pct={85} tone="sage" days="≈ 12 дн" qty="6 шт" />
      <Row name="Пармезан" sub="Grana Padano" pct={70} tone="sage" days="≈ 21 дн" qty="90 г" />
      <div className={styles.fMore}>Ще 27{ic('sys.open')}</div>
    </div>
  </Card>
);

const Chip = ({ icon, t, s, tone }: { icon: Name; t: string; s: string; tone?: 'amber' }) => (
  <span className={`${styles.glass} ${styles.gChip} ${tone ? styles.gChipAmber : ''}`}>
    <span className={tone ? styles.amber : styles.mutedIcon}>{ic(icon, 18)}</span>
    <span className={styles.gChipText}><span className={styles.gChipT}>{t}</span><span className={`${styles.gChipS} ${tone ? styles.amber : ''}`}>{s}</span></span>
    <span className={styles.dimIcon}>{ic('sys.next')}</span>
  </span>
);
const FragReceipt = () => (
  <div className={styles.fReceipt}>
    <span className={`${styles.glass} ${styles.gFile}`}><span className={styles.pdf}>PDF</span>silpo_07-09.pdf</span>
    <div className={`${styles.fReceiptText} ${styles.kRowIn}`}>Розібрав 19 рядків: 15 у комору — з них три стояли в Списку, закрию їх; 2 не для комори, щодо двох не впевнений.</div>
    <div className={`${styles.fReceiptChips} ${styles.kRowIn2}`}>
      <Chip icon="sys.receipt" t="Чек Сільпо · 19" s="чекає рішення · 2" tone="amber" />
      <Chip icon="sys.list" t="Список · −3" s="скасувати · 0:05" />
    </div>
  </div>
);

const FragCook = () => (
  <Card>
    <div className={styles.fCook}>
      <div className={styles.fCookHead}>
        <span className={styles.fCookStep}>Крок 3 з 5</span>
        <span className={styles.progress}><span className={`${styles.barSage} ${styles.kProgress}`} /></span>
        <span className={`${styles.chipSm} ${styles.chipSage}`}>{ic('cook.timer', 12)}6<span className={styles.kTick}>:</span>42</span>
      </div>
      <div className={`${styles.fCookText} ${styles.kStep}`}>Паста. <span className={styles.fCookBody}>Спагеті в киплячу солону воду на 9 хвилин. Пів склянки води лишити.</span></div>
      <div className={styles.fCookBtns}>
        <span className={styles.pressWrap}>
          {/* «Далі» — sys.next (chevron-right), як у словнику; бандл малює arrow-right (Р41). */}
          <span className={`${styles.btnInk} ${styles.kPress}`}>Далі{ic('sys.next')}</span>
          <Cursor className={`${styles.kCursor} ${styles.cursorBtn}`} />
        </span>
        <span className={styles.btnLine}>{ic('sys.voice')}Скажи «далі»</span>
      </div>
    </div>
  </Card>
);

const LRow = ({ n, s, done, price }: { n: string; s: string; done?: boolean; price: string }) => (
  <div className={`${styles.lRow} ${done ? styles.lRowDone : ''}`}>
    <span className={`${styles.check} ${done ? styles.checkOn : ''}`}>{done && ic('sys.done', 12)}</span>
    <span className={styles.fName}><span className={done ? styles.strike : ''}>{n}</span><span className={styles.fSub}>{s}</span></span>
    <span className={styles.lPrice}>{price}</span>
  </div>
);
const FragList = () => (
  <Card>
    <div className={styles.listHead}>{ic('sys.list')}Список<span className={styles.listN}>6</span><span className={styles.grow} /><span className={styles.listNote}>2 вже є вдома — прибрав</span></div>
    <div className={styles.listBody}>
      <LRow n="Фета" s="200 г · для шакшуки" price="89 ₴" />
      <LRow n="Яйця" s="10 шт" price="79 ₴" />
      <div className={`${styles.lRow} ${styles.kStrikeRow}`}>
        <span className={`${styles.check} ${styles.kCheck}`}><span className={styles.kCheckmark}>{ic('sys.done', 12)}</span></span>
        <span className={styles.fName}><span className={`${styles.strikeAnim} ${styles.kStrike}`}>Оливкова олія</span><span className={styles.fSub}>вже є вдома · 400 мл</span></span>
        <span className={styles.lPrice} />
      </div>
      <LRow n="Кінза" s="пучок" price="—" />
      <LRow n="Пармезан" s="вже є вдома · 90 г" done price="" />
    </div>
  </Card>
);

const FragJournal = () => (
  <Card>
    <div className={styles.jBody}>
      <div className={styles.jRow}>
        <span className={`${styles.jCircle} ${styles.jCircleSage}`}>{ic('sys.done', 16)}</span>
        <span className={styles.jText}>
          <span className={styles.jTitle}>Паста з печеними помідорами</span>
          <span className={styles.jMeta}>вчора · 27 хв · <Stars n={4} live /> · 3 з того, що було вдома</span>
          <span className={styles.jQuote}>«Фует не пересушувати»</span>
        </span>
        <span className={styles.jAgain}>{ic('cook.done', 12)}Знову</span>
      </div>
      <div className={`${styles.jRow} ${styles.jRowDim}`}>
        <span className={styles.jCircle}>{ic('landing.variety')}</span>
        <span className={styles.jText}><span className={`${styles.jTitle} ${styles.strike}`}>Паста з помідорами</span><span className={styles.jMeta}>готував у вт — сьогодні не пропоную</span></span>
      </div>
    </div>
  </Card>
);

const FragCal = () => (
  <Card>
    <div className={styles.cal}>
      <span className={styles.calKick}>{ic('live.tradition', 12)}свято · з традиції</span>
      <div className={styles.calTitle}>Великий піст</div>
      <div className={styles.calDates}><span className={styles.muted}>з</span><b>18 лют</b><span className={styles.muted}>до</span><b>4 квіт</b><span className={styles.calDay}>день <span className={`${styles.inline} ${styles.kStep}`}>12</span> з 46</span></div>
      <div className={styles.calStrict}><span className={styles.strictPill}>суворо</span><span className={styles.calNote}>не пропоную сам; попросиш прямо — попереджу і зроблю</span></div>
    </div>
  </Card>
);

export const FRAGS = [FragPantry, FragReceipt, FragCook, FragList, FragJournal, FragCal];

// ---------- 1024 / 390: мобільна щільність ----------
const MCard = ({ children }: { children: ReactNode }) => <div className={styles.mCard}>{children}</div>;
const MRow = ({ name, sub, pct, tone, days, qty }: { name: string; sub?: string; pct: number; tone: 'sage' | 'amber'; days: string; qty: string }) => (
  <div className={styles.mRow}>
    <span className={styles.fName}><span>{name}</span>{sub && <span className={styles.fSub}>{sub}</span>}</span>
    <span className={`${styles.bar} ${styles.barM}`}><span className={tone === 'sage' ? styles.barSage : styles.barAmber} style={{ width: `${pct}%` }} /></span>
    <span className={`${styles.mDays} ${tone === 'amber' ? styles.amber : ''}`}>{days}</span>
    <span className={styles.mQty}>{qty}</span>
  </div>
);
const MPantry = () => (
  <MCard>
    <div className={styles.mZoneHead}>{ic('sys.pantry', 16)}Холодильник<span className={styles.zoneN}>31</span></div>
    <div className={styles.mBody}>
      <MRow name="Фует" sub="Ковбаса · с/в" pct={30} tone="amber" days="2 дн" qty="160 г" />
      <MRow name="Моцарела" pct={40} tone="amber" days="≈ 3 дн" qty="125 г" />
      <MRow name="Яйця" sub="С1" pct={85} tone="sage" days="≈ 12 дн" qty="6 шт" />
      <div className={styles.fMore}>Ще 28{ic('sys.open')}</div>
    </div>
  </MCard>
);
const MChip = ({ icon, t, s, tone }: { icon: Name; t: string; s: string; tone?: 'amber' }) => (
  <span className={`${styles.mChipRow} ${tone ? styles.mChipRowAmber : ''}`}>
    <span className={tone ? styles.amber : styles.mutedIcon}>{ic(icon)}</span>
    <span className={styles.gChipText}><span className={styles.gChipT}>{t}</span><span className={`${styles.gChipS} ${tone ? styles.amber : ''}`}>{s}</span></span>
    <span className={styles.dimIcon}>{ic('sys.next')}</span>
  </span>
);
const MReceipt = () => (
  <div className={styles.mReceipt}>
    <span className={styles.mFile}><span className={`${styles.pdf} ${styles.pdfSm}`}>PDF</span>silpo_07-09.pdf</span>
    <div className={styles.mReceiptText}>Розібрав 19 рядків: 15 у комору — з них три стояли в Списку, закрию їх; 2 не для комори, щодо двох не впевнений.</div>
    <div className={styles.mReceiptChips}>
      <MChip icon="sys.receipt" t="Чек Сільпо · 19" s="чекає рішення · 2" tone="amber" />
      <MChip icon="sys.list" t="Список · −3" s="скасувати · 0:05" />
    </div>
  </div>
);
const MCook = () => (
  <MCard>
    <div className={styles.mCook}>
      <div className={styles.mCookHead}>
        <span className={styles.fCookStep}>Крок 3 з 5</span>
        <span className={styles.progress}><span className={styles.barSage} style={{ width: '55%' }} /></span>
        <span className={`${styles.chipSm} ${styles.chipSage} ${styles.chipXs}`}>{ic('cook.timer', 12)}6:42</span>
      </div>
      <div className={styles.mCookText}>Паста. <span className={styles.fCookBody}>Спагеті в киплячу солону воду на 9 хвилин. Пів склянки води лишити.</span></div>
      <div className={styles.fCookBtns}>
        <span className={styles.btnInk}>Далі{ic('sys.next')}</span>
        <span className={`${styles.btnLine} ${styles.btnLineSm}`}>{ic('sys.voice')}Скажи «далі»</span>
      </div>
    </div>
  </MCard>
);
const MLRow = ({ n, s, done, price }: { n: string; s: string; done?: boolean; price: string }) => (
  <div className={`${styles.mlRow} ${done ? styles.lRowDone : ''}`}>
    <span className={`${styles.check} ${done ? styles.checkOn : ''}`}>{done && ic('sys.done', 12)}</span>
    <span className={styles.fName}><span className={done ? styles.strike : ''}>{n}</span><span className={styles.fSub}>{s}</span></span>
    <span className={styles.mlPrice}>{price}</span>
  </div>
);
const MList = () => (
  <MCard>
    <div className={`${styles.listHead} ${styles.mListHead}`}>{ic('sys.list')}Список<span className={styles.listN}>6</span><span className={styles.grow} /><span className={styles.listNote}>2 вже є — прибрав</span></div>
    <div className={styles.mListBody}>
      <MLRow n="Фета" s="200 г · для шакшуки" price="89 ₴" />
      <MLRow n="Яйця" s="10 шт" price="79 ₴" />
      <MLRow n="Оливкова олія" s="вже є вдома · 400 мл" done price="" />
      <MLRow n="Кінза" s="пучок" price="—" />
    </div>
  </MCard>
);
const MJournal = () => (
  <MCard>
    <div className={styles.mjBody}>
      <div className={styles.mjRow}>
        <span className={`${styles.mjCircle} ${styles.jCircleSage}`}>{ic('sys.done', 16)}</span>
        <span className={styles.jText}>
          <span className={styles.mjTitle}>Паста з печеними помідорами</span>
          <span className={styles.mjMeta}>вчора · 27 хв · <Stars n={4} /></span>
          <span className={styles.mjQuote}>«Фует не пересушувати»</span>
        </span>
        <span className={`${styles.jAgain} ${styles.mjAgain}`}>{ic('cook.done', 12)}Знову</span>
      </div>
      <div className={`${styles.mjRow} ${styles.jRowDim}`}>
        <span className={styles.mjCircle}>{ic('landing.variety')}</span>
        <span className={styles.jText}><span className={`${styles.mjTitle} ${styles.strike}`}>Паста з помідорами</span><span className={styles.mjMeta}>готував у вт — сьогодні не пропоную</span></span>
      </div>
    </div>
  </MCard>
);
const MCal = () => (
  <MCard>
    <div className={styles.mCal}>
      <span className={styles.calKick}>{ic('live.tradition', 12)}свято · з традиції</span>
      <div className={styles.mCalTitle}>Великий піст</div>
      <div className={styles.mCalDates}><span className={styles.muted}>з</span><b>18 лют</b><span className={styles.muted}>до</span><b>4 квіт</b><span className={styles.mCalDay}>· день 12 з 46</span></div>
      <div className={styles.calStrict}><span className={styles.strictPill}>суворо</span><span className={styles.calNote}>не пропоную сам; попросиш прямо — попереджу і зроблю</span></div>
    </div>
  </MCard>
);

export const FRAGS_M = [MPantry, MReceipt, MCook, MList, MJournal, MCal];
