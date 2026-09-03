// Права панель артефактів — у каркасі, один раз (крок 3, 03.09).
//
// Розмітка перенесена з Feed.tsx як була: три зони (шапка з вкладками — не
// скролиться; тіло — єдина зона скролу; низ — дії, куди картка порталить
// свій підвал), ручка ширини з дабл-кліком до 320, згорнута смуга 52px із
// «правилом двох кнопок», шторка зі скрімом на <1200. Що малювати всередині —
// вирішує сторінка через store (render(key)); панель не знає ні про картки,
// ні про рецепти, ні про події.
//
// Резерв місця під панель: класи на <body> (with-panel / panel-hidden) і
// змінна --rail-w — тим самим прийомом, що сайдбар резервує собі
// padding-left через body.with-sidebar.

import { useEffect, useRef, useState } from 'react';
import { ARTIFACT_GLYPH } from '../../pages/Feed/artifacts';
import { PanelFootSlot, PanelHeadSlot } from '../../pages/Feed/panel-slots';
import { usePanelStore, RAIL_IN_FLOW, RAIL_MIN, RAIL_MAX, RAIL_DEFAULT } from '../../store/panel';
import styles from './ArtifactPanel.module.css';

const RAIL_OVERHEAD = 916;  // 276 накладних + 640 мінімум журналу

/* Одна іконка на обидві кнопки — «згорнути» в шапці й «розгорнути» в
   міні-смузі: рамка з поділом праворуч від центру, тобто та колонка, якої
   стосується натискання. */
export function PanelIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.9 2V14" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function ArtifactPanel() {
  const s = usePanelStore();
  const { artifacts, render, extra, pendingDot, ghostTab, open, hidden, width, dragging, fresh } = s;
  const shown = artifacts.find((a) => a.key === s.active) ?? artifacts[0];
  const hasPanel = artifacts.length > 0 || !!extra;

  const [footSlot, setFootSlot] = useState<HTMLElement | null>(null);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [bodyContentEl, setBodyContentEl] = useState<HTMLDivElement | null>(null);
  const [bodyScrolled, setBodyScrolled] = useState(false);
  const [miniListOpen, setMiniListOpen] = useState(false);

  // Тінь над низом — лише коли тіло справді не влазить.
  useEffect(() => {
    if (!bodyEl) return;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBodyScrolled(bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 1));
    };
    check();
    const settle = window.setTimeout(check, 250);
    bodyEl.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(bodyEl);
    if (bodyContentEl) ro.observe(bodyContentEl);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); bodyEl.removeEventListener('scroll', check); ro.disconnect(); };
  }, [bodyEl, bodyContentEl, open, shown?.key]);

  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const railCeiling = Math.max(RAIL_MIN, Math.min(RAIL_MAX, vw - RAIL_OVERHEAD));
  const railEffective = Math.min(width, railCeiling);

  // Резерв ширини для контенту сторінки — класами на body, як у сайдбара.
  useEffect(() => {
    const b = document.body;
    b.classList.toggle('with-panel', hasPanel && !hidden);
    b.classList.toggle('panel-hidden', hasPanel && hidden);
    b.classList.toggle(styles['rail-dragging']!, dragging);
    b.style.setProperty('--rail-w', `${railEffective}px`);
    return () => { b.classList.remove('with-panel', 'panel-hidden', styles['rail-dragging']!); b.style.removeProperty('--rail-w'); };
  }, [hasPanel, hidden, dragging, railEffective]);

  // «Нове зʼявилось, поки панель згорнута» — крапка на смузі.
  const seen = useRef<Set<string> | null>(null);
  const keys = artifacts.map((a) => a.key).join(',');
  useEffect(() => {
    const now = new Set(artifacts.map((a) => a.key));
    const first = seen.current === null;
    const added = first ? [] : [...now].filter((k) => !seen.current!.has(k));
    seen.current = now;
    if (added.length && hidden) s.setFresh(true);
    if (!hidden) s.setFresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, hidden]);

  const lastDown = useRef(0);
  function onHandleDown(e: React.PointerEvent<HTMLDivElement>) {
    const now = Date.now();
    const isDouble = now - lastDown.current < 400;
    lastDown.current = now;
    if (isDouble) { s.setWidth(RAIL_DEFAULT); return; }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX; const startW = railEffective;
    s.setDragging(true);
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.max(RAIL_MIN, Math.min(railCeiling, startW - (ev.clientX - startX))));
      s.setWidth(last, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      s.setDragging(false); s.setWidth(last);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function miniClick() { if (window.matchMedia(RAIL_IN_FLOW).matches) s.expand(); else s.setOpen(true); }

  if (!hasPanel) return null;
  const miniOthers = artifacts.filter((a) => a.key !== shown?.key);

  return (
    <>
      <aside className={`${styles.rail} ${open ? styles['rail-open'] : ''} ${hidden ? styles['rail-hidden'] : ''}`}>
        <div className={styles['rail-handle']} onPointerDown={onHandleDown} role="separator" aria-orientation="vertical" aria-label="Ширина панелі">
          <span className={styles['rail-handle-bar']} />
          {dragging && <span className={styles['rail-handle-tip']}>{railEffective} PX</span>}
        </div>
        {shown && (
          <div id={`rail-${shown.key}`} className={styles['rail-artifact']}>
            <div className={styles['rail-tabs']}>
              <button type="button" className={styles['rail-collapse']} onClick={s.collapse} title="Згорнути панель" aria-label="Згорнути панель">
                <PanelIcon />
              </button>
              <div className={styles['rail-head-actions']} ref={setHeadSlot} />
              <div className={styles['rail-tabs-scroll']}>
                {artifacts.map((a) => (
                  <button key={a.key} type="button"
                    className={`${styles['rail-tab']} ${a.key === shown.key ? styles['rail-tab-on'] : ''}`}
                    onClick={() => s.setActive(a.key)} title={a.label} aria-label={a.label} aria-current={a.key === shown.key}>
                    <span className={styles['rail-tab-glyph']}>{ARTIFACT_GLYPH[a.kind]}</span>
                    {a.meta && <span className={styles['rail-tab-badge']}>{a.meta}</span>}
                  </button>
                ))}
                {ghostTab && (
                  <button type="button" className={`${styles['rail-tab']} ${styles['rail-tab-ghost']}`} onClick={ghostTab.onClick}
                    title="Відкрити список покупок" aria-label="Відкрити список покупок">
                    <span className={styles['rail-tab-glyph']}>{ARTIFACT_GLYPH[ghostTab.glyphKind]}</span>
                    <span className={styles['rail-tab-badge']}>{ghostTab.count}</span>
                  </button>
                )}
              </div>
            </div>
            <div className={styles['rail-body']} ref={setBodyEl}>
              <div key={shown.key} className={styles['rail-swap']} ref={setBodyContentEl}>
                {/* Слот мусить існувати до першого рендера картки — інакше її
                    підвал на перший кадр лягає в тіло й тінь ловить не те. */}
                {footSlot && (
                  <PanelHeadSlot.Provider value={headSlot}>
                    <PanelFootSlot.Provider value={footSlot}>
                      {render(shown.key)}
                    </PanelFootSlot.Provider>
                  </PanelHeadSlot.Provider>
                )}
              </div>
            </div>
            <div className={`${styles['rail-foot']} ${bodyScrolled ? styles['rail-foot-shadow'] : ''}`} ref={setFootSlot} />
          </div>
        )}
        {extra}
      </aside>
      {open && <div className={styles['rail-scrim']} onClick={() => s.setOpen(false)} />}
      <div className={`${styles['rail-mini']} ${hidden ? styles['rail-mini-show'] : ''}`}>
        <button type="button" className={styles['rail-mini-expand']} onClick={miniClick} aria-label="Розгорнути панель">
          <PanelIcon />
          {pendingDot && <span className={styles['rail-mini-dot']} />}
        </button>
        {shown && (
          <button type="button" className={`${styles['mini-marker']} ${styles['mini-marker-on']} ${fresh ? styles['mini-fresh'] : ''}`}
            onClick={miniClick} aria-label={`Відкрити: ${shown.label}${fresh ? ' (нове)' : ''}`}>
            <span className={styles['mini-glyph']}>{ARTIFACT_GLYPH[shown.kind]}</span>
            {shown.meta && <span className={styles['mini-badge']}>{shown.meta}</span>}
            <span className={styles['mini-hint']}>{shown.label}</span>
          </button>
        )}
        {miniOthers.length > 0 && (
          <button type="button" className={styles['mini-marker']} onClick={() => setMiniListOpen((v) => !v)} aria-expanded={miniListOpen} aria-label="Інші артефакти">
            <span className={styles['mini-plus']}>+{miniOthers.length}</span>
          </button>
        )}
        {miniListOpen && miniOthers.length > 0 && (
          <div className={styles['mini-list']}>
            {miniOthers.map((a) => (
              <button key={a.key} type="button" className={styles['mini-list-row']}
                onClick={() => { setMiniListOpen(false); s.openArtifact(a.key); }}>
                <span className={styles['mini-list-name']}>{ARTIFACT_GLYPH[a.kind]} {a.label}</span>
                {a.meta && <span className={styles['mini-list-meta']}>{a.meta}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
