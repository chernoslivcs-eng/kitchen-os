// Лендінг v3 = вхід («Вхід = лендінг, окремого /signin нема» — HANDOFF §7a).
// Джерело — «ai/project/Kitchen OS - Landing Live.dc.html», три кадри:
//   · «Лендінг · live»  ≥1280 — кадр 1920, fluid через zoom (useFrameZoom);
//     sticky-hero, лептоп із живою сесією, «Що вміє» sticky-сценою зі скло-
//     фрагментами й нахилом за курсором, телефон у фіналі;
//   · «Лендінг · 1024» 768–1279 — без sticky-сцен, «Що вміє» рядками
//     текст / фрагмент із чергуванням боків, без нахилу й скла;
//   · «Лендінг · 390»  <768 — стрічки зі снапом для болів і тарифів,
//     телефон у hero з тим самим циклом «клік → таймер».
// Копі — copy.ts (дослівно з бандла). Токени — tokens.css, тому темна тема
// приходить сама; те, де бандл про темну мовчить, — Landing.module.css
// (блок «темна») і QUESTIONS §16.
import { useRef, useState, type MouseEvent } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { SignInForm } from './SignInForm';
import { LiveSession } from './LiveSession';
import { PhoneMock } from './PhoneMock';
import { FRAGS, FRAGS_M } from './Fragments';
import {
  NAV, HERO, SIGNIN, PAINS, PAINS_H2, HOME_IMG, ROWS, TURN, KNOWS_HEAD, KNOWS, LEDGER_HEAD, LEDGER, GUESS_CHIP,
  HOME, RULES_H2, RULES, RULE_2, RULE_3_CHIP, PRICE, PLANS, FINAL, FOOTER,
} from './copy';
import { useBreakpoint, useFrameZoom, useReveal, useGloss, useLiveStart, useScrollScene, reducedMotion } from './useLandingMotion';
import styles from './Landing.module.css';

const s = styles;

function Mark({ className }: { className?: string }) {
  return <span className={`${s.mark} ${className ?? ''}`} aria-hidden="true"><span /></span>;
}

function GuessChip({ className }: { className?: string }) {
  return <span className={`${s.chipGuess} ${className ?? ''}`}>{GUESS_CHIP.a}<span className={s.chipGuessB}>{GUESS_CHIP.b}</span></span>;
}

export function Landing() {
  const bp = useBreakpoint();
  const desk = bp === 'desk', tab = bp === 'tab', mob = bp === 'mob';
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  useFrameZoom(root, desk);
  useReveal(root, bp);
  useGloss(root, bp);
  useLiveStart(root, bp);
  const { active, heroRef, headerRef, illRef } = useScrollScene(root, desk);

  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute('href');
    if (!href?.startsWith('#')) return;
    const t = document.getElementById(href.slice(1));
    if (!t) return;
    e.preventDefault();
    setMenu(false);
    t.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  const img = (name: string, w: number, h: number, cls?: string) => (
    <img className={`${s.ill} ${cls}`} src={`/landing/${name}.webp`} width={w} height={h} alt="" loading="lazy" decoding="async" />
  );

  return (
    <div ref={root} id="top" className={`${s.page} ${s[bp]}`}>
      <div className={s.top}>
        <header ref={headerRef} className={s.header}>
          <a href="#top" className={s.logo} onClick={go}><Mark /><span className={s.logoText}>{FOOTER.brand}</span></a>
          <nav className={s.nav}>{NAV.map(([h, t]) => <a key={h} href={h} onClick={go}>{t}</a>)}</nav>
          <div className={s.headerRight}>
            <a href="#l3-signin" className={s.enter} onClick={go}>{SIGNIN.enter}</a>
            {mob && (
              <button type="button" className={s.menuBtn} aria-label="Меню" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
                <Icon name="sys.menu" size={18} inherit decorative />
              </button>
            )}
          </div>
          {mob && menu && <nav className={s.menu}>{NAV.map(([h, t]) => <a key={h} href={h} onClick={go}>{t}</a>)}</nav>}
        </header>

        <div ref={heroRef} className={s.hero}>
          <h1 data-reveal="0" className={s.h1}><span className={s.h1a}>{HERO.a}</span><span>{HERO.b}</span></h1>
          <p data-reveal="120" className={s.lead}>{HERO.lead}</p>
          <div data-reveal="240" className={s.signinWrap}><SignInForm id="l3-signin" /></div>
        </div>

        {mob
          ? <div className={s.phoneWrap}><PhoneMock variant="hero" /></div>
          : <div className={s.laptopWrap}><LiveSession tab={tab} /></div>}
      </div>

      <section id="l3-how" data-reveal="0" className={s.pains}>
        <h2 className={s.h2}>{PAINS_H2}</h2>
        <div className={s.painGrid}>
          {PAINS.map((p) => (
            <div key={p.img} className={s.pain}>
              <div className={s.painImg}>{img(p.img, p.w, p.h, s.painIll)}</div>
              <p className={s.painText}><b>{p.b}</b> {p.t}</p>
            </div>
          ))}
        </div>
      </section>

      {desk ? (
        <section className={s.feats}>
          <div className={s.featText}>
            {ROWS.map((r, i) => (
              <div key={r.kick} data-feat={i} className={`${s.featRow} ${i === active ? s.featOn : ''}`}>
                <span className={s.kick}><Icon name={r.icon} size={16} inherit decorative />{r.kick}</span>
                <h3 className={s.h3}>{r.h}</h3>
                <p className={s.featP}>{r.p}</p>
              </div>
            ))}
          </div>
          <div className={s.featStick}>
            <div data-stage data-live className={s.stage}>
              <span aria-hidden="true" className={s.blobA} /><span aria-hidden="true" className={s.blobB} />
              {FRAGS.map((F, i) => (
                <div key={i} className={`${s.fragSlot} ${i === active ? s.fragOn : i < active ? s.fragBefore : s.fragAfter}`}>
                  <div className={s.fragTilt}><F /></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className={s.featsM}>
          {ROWS.map((r, i) => {
            const M = FRAGS_M[i]!;
            return (
              <div key={r.kick} className={`${s.featRowM} ${tab && i % 2 ? s.featRtl : ''}`}>
                <div className={s.featTextM}>
                  <span className={s.kick}><Icon name={r.icon} size={16} inherit decorative />{r.kick}</span>
                  <h3 className={s.h3}>{r.h}</h3>
                  <p className={s.featP}>{r.p}</p>
                </div>
                <div className={s.fragMWrap}><div className={s.fragM}><M /></div></div>
              </div>
            );
          })}
        </section>
      )}

      <div data-reveal="0" className={s.turn}><span className={s.turnA}>{TURN.a}</span><span className={s.turnB}>{TURN.b}</span></div>

      <section data-reveal="0" className={s.split}>
        <div className={s.splitHead}><span className={s.kick}>{KNOWS_HEAD.kick}</span><h2 className={s.h2b}>{KNOWS_HEAD.h2}</h2><p className={s.p17}>{KNOWS_HEAD.p}</p></div>
        <div className={s.knows}>
          {KNOWS.map((k) => <div key={k.t} className={s.know}><span className={s.sage}><Icon name={k.icon} size={20} inherit decorative /></span>{k.t}</div>)}
        </div>
      </section>

      <section data-reveal="0" className={`${s.split} ${s.ledgerSec}`}>
        <div className={s.splitHead}><span className={s.kick}>{LEDGER_HEAD.kick}</span><h2 className={s.h2b}>{LEDGER_HEAD.h2}</h2><p className={s.p17}>{LEDGER_HEAD.p}</p></div>
        <div className={s.ledger}>
          {LEDGER.map((l) => (
            <div key={l.a} className={s.ledgerRow}>
              <span className={s.ledgerA}>{l.a}</span>
              <span className={s.ledgerB}><span>{l.b}</span>{l.chip && <GuessChip className={s.chipGuessSm} />}</span>
            </div>
          ))}
        </div>
      </section>

      <section data-reveal="0" className={s.home}>
        <div className={s.homeImg}>{img(HOME_IMG.img, HOME_IMG.w, HOME_IMG.h, s.homeIll)}</div>
        <div className={s.homeText}>
          <span className={s.kick}>{HOME.kick}</span><h2 className={s.h2b}>{HOME.h2}</h2><p className={s.p17}>{HOME.p}</p>
          <div className={s.homeGrid}>
            <div className={s.homeCard}><span className={`${s.label} ${s.sage}`}>{HOME.shared.label}</span><span className={s.homeCardT}>{HOME.shared.t}</span><span className={s.homeCardS}>{HOME.shared.s}</span></div>
            <div className={s.homeCard}><span className={`${s.label} ${s.amber}`}>{HOME.personal.label}</span><span className={s.homeCardT}>{HOME.personal.t}</span><span className={s.homeCardS}>{HOME.personal.s}</span></div>
          </div>
        </div>
      </section>

      <section id="l3-rules" data-reveal="0" className={s.rules}>
        <h2 className={s.h2}>{RULES_H2}</h2>
        <div className={s.ruleGrid}>
          {RULES.map((r, i) => (
            <div key={r.n} data-reveal={String(i * 120)} className={s.rule}>
              <span className={s.ruleN}>{r.n}</span><span className={s.ruleT}>{r.t}</span><p className={s.ruleP}>{r.p}</p>
              <span className={s.ruleFoot}>
                {i === 0 && <GuessChip />}
                {i === 1 && <span className={s.ruleBtns}><span className={s.btnInkSm}>{RULE_2.yes}</span><span className={s.btnLineSm2}>{RULE_2.no}</span></span>}
                {/* Бандл: alert-triangle. У словнику він — «Прострочено»; алерген = «не можна» → cook.ban (tokens-v3: «не можна» — plum + ban; Р41). */}
                {i === 2 && <span className={`${s.chipGuess} ${s.chipPlum}`}><Icon name="cook.ban" size={12} inherit decorative />{RULE_3_CHIP}</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="l3-price" data-reveal="0" className={s.price}>
        <h2 className={`${s.h2} ${s.priceH2}`}>{PRICE.h2}</h2>
        <p className={s.priceP}>{PRICE.p}</p>
        <div className={s.planGrid}>
          {PLANS.map((p, i) => (
            <div key={p.key} data-reveal={i === 0 ? '0' : '120'} className={`${s.plan} ${p.key === 'home' ? s.planHome : ''}`}>
              <span className={s.planLabel}>
                {p.label}
                {p.key === 'home' && desk && (
                  <span className={s.avatars}>
                    <span className={`${s.avatar} ${s.avatarPlum}`}>О</span><span className={`${s.avatar} ${s.avatarAmber}`}>Т</span>
                    <span className={`${s.avatar} ${s.avatarAdd}`}><Icon name="sys.add" size={12} inherit decorative /></span>
                  </span>
                )}
                {'gift' in p && <span className={s.gift}>{p.gift}</span>}
              </span>
              <span className={s.planPrice}><span className={s.planSum}>{p.price}</span><span className={s.planPer}>{'was' in p ? <><s>{p.was}</s> {p.per}</> : p.per}</span></span>
              <span className={s.planList}>{p.lines.map((l) => <span key={l}>{l}</span>)}</span>
              <a href="#l3-signin" className={`${s.planBtn} ${p.key === 'home' ? s.planBtnHome : ''}`} onClick={go}>{PRICE.cta}</a>
            </div>
          ))}
        </div>
      </section>

      <section data-reveal="0" className={s.final}>
        {desk && <div ref={illRef} className={s.illPhone}><PhoneMock variant="final" /></div>}
        <h2 className={s.finalH2}>{FINAL.h2}</h2>
        <p className={s.finalP}>{FINAL.p}</p>
        <SignInForm or={desk} className={s.signinFinal} />
        <footer className={s.footer}>
          <span className={s.footerBrand}>
            <Mark className={s.markSm} /><span className={s.footerName}>{FOOTER.brand}</span>
            <span className={s.footerTag}>{mob ? FOOTER.taglineLong : `· ${tab ? FOOTER.tagline : FOOTER.taglineLong}`}</span>
          </span>
          <span className={s.footerLinks}>{FOOTER.links.map((l) => <span key={l}>{l}</span>)}</span>
        </footer>
      </section>
    </div>
  );
}
