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
import { keepFieldInView } from '../../lib/keepFieldInView';
import { ARTIFACT_ICON } from '../../pages/Feed/artifacts';
import { Icon } from '../Icon/Icon';
import { PanelFootSlot, PanelHeadSlot } from '../../pages/Feed/panel-slots';
import { usePanelStore, RAIL_IN_FLOW, RAIL_MIN, RAIL_MAX, RAIL_DEFAULT, ARTIFACT_SHEET } from '../../store/panel';
import { useSheetDrag } from '../../lib/useSheetDrag';
import styles from './ArtifactPanel.module.css';
import { holdBodyFlag } from '../../lib/body-flags';

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
  // Етап 6a: шторка артефакта (<1200) теж ховає нижній бар. №21: тримає
  // клас лише поки відкрита, через лічильник (Sheet поруч його не зніме).
  useEffect(() => { if (s.open) return holdBodyFlag('sheet-open'); }, [s.open]);
  // 12.09 (§11): блок «Чекають на тебе · N» під панеллю знято — він чіпом у шапці чату.
  const { artifacts, render, pendingDot, open, hidden, width, dragging, fresh, freshKeys } = s;
  // №35: у режимі шторки (< 600) змах униз по граберу/шапці закриває — той
  // самий механізм, що в Sheet (lib/useSheetDrag).
  const [sheetMode, setSheetMode] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(ARTIFACT_SHEET).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(ARTIFACT_SHEET);
    const on = () => setSheetMode(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const sheetDrag = useSheetDrag(() => s.setOpen(false), sheetMode && open);
  const shown = artifacts.find((a) => a.key === s.active) ?? artifacts[0];
  const hasPanel = artifacts.length > 0;

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
  // Етап 6b: ширина — за шириною екрана, не ручкою: 340 на 1440 → 420 на
  // 1920 (Responsive R0), між ними лінійно; менше 1440 — 340, стеля 420.
  // Ширина картки: типова — 400 на 1440 (Prototype asideW) → 420 на 1920
  // (Responsive R0), між ними лінійно; потягнута рукою (HANDOFF: кромка
  // 300–720) — має перевагу, поки людина її не скинула дабл-кліком.
  const railCeiling = Math.max(RAIL_MIN, Math.min(RAIL_MAX, vw - RAIL_OVERHEAD));
  const byViewport = Math.round(Math.max(400, Math.min(420, 400 + ((vw - 1440) * 20) / 480)));
  const railEffective = Math.min(width ?? byViewport, railCeiling);
  // Полотно панелі = картка + 12 з кожного боку (Prototype: margin 12 12 12 0):
  // тінь --sh2 має куди лягти.
  const RAIL_GUTTER = 12;

  // Резерв ширини для контенту сторінки — класами на body, як у сайдбара.
  useEffect(() => {
    const b = document.body;
    b.classList.toggle('with-panel', hasPanel && !hidden);
    b.classList.toggle('panel-hidden', hasPanel && hidden);
    b.classList.toggle(styles['rail-dragging']!, dragging);
    b.style.setProperty('--rail-w', `${railEffective + RAIL_GUTTER * 2}px`);
    return () => { b.classList.remove('with-panel', 'panel-hidden', styles['rail-dragging']!); b.style.removeProperty('--rail-w'); };
  }, [hasPanel, hidden, dragging, railEffective]);

  // Пул-9 №6: новий артефакт виходить наперед. Раніше `added` рахувався, але
  // тільки ставив крапку на згорнутій смузі, а `shown` лишався першим у списку —
  // рецепт чи кошик із чату доводилось відкривати руками.
  //
  // «Новий» — це артефакт із ходу ЦІЄЇ сесії вкладки (freshKeys від сторінки),
  // а не будь-який новий ключ: історія при завантаженні теж приходить одним
  // стрибком порожньо → повно, і панель відкривалась би на кожен F5.
  const seen = useRef<Set<string> | null>(null);
  const keys = artifacts.map((a) => a.key).join(',');
  useEffect(() => {
    const now = new Set(artifacts.map((a) => a.key));
    const first = seen.current === null;
    const added = first ? [] : [...now].filter((k) => !seen.current!.has(k));
    seen.current = now;
    const fromTurn = added.filter((k) => freshKeys?.includes(k));
    if (fromTurn.length) s.surfaceArtifact(fromTurn[fromTurn.length - 1]!);
    else if (added.length && hidden) s.setFresh(true);
    if (!hidden) s.setFresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, hidden]);

  const lastDown = useRef(0);
  function onHandleDown(e: React.PointerEvent<HTMLDivElement>) {
    const now = Date.now();
    const isDouble = now - lastDown.current < 400;
    lastDown.current = now;
    if (isDouble) { s.setWidth(byViewport); try { localStorage.removeItem('kos-rail-width'); } catch { /* ок */ } return; }
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
      <aside className={`${styles.rail} ${open ? styles['rail-open'] : ''} ${hidden ? styles['rail-hidden'] : ''}`}
        style={sheetMode && open ? sheetDrag.panelStyle : undefined} onFocusCapture={keepFieldInView} data-artifact-sheet={sheetMode && open ? true : undefined}>
        {sheetMode && open && <div className={styles['rail-grab']} {...sheetDrag.handleProps} data-sheet-grab><span className={styles['rail-grab-bar']} /></div>}
        {/* HANDOFF «Артефакти»: ліва кромка тягнеться 300–720. Дабл-клік —
            назад до типової за екраном. */}
        <div className={styles['rail-handle']} onPointerDown={onHandleDown} role="separator" aria-orientation="vertical" aria-label="Ширина панелі">
          <span className={styles['rail-handle-bar']} />
          {dragging && <span className={styles['rail-handle-tip']}>{railEffective} px</span>}
        </div>
        {shown && (
          <div id={`rail-${shown.key}`} className={styles['rail-artifact']}>
            <div className={styles['rail-tabs']} {...(sheetMode && open ? sheetDrag.handleProps : {})} data-sheet-head={sheetMode && open ? true : undefined}>
              {/* 6b-3 — кікер за Prototype: знак типу + назва типу + закриття
                  30 r8 (panel-right-close). Вкладок немає: у панелі живе один
                  артефакт — відкритий; інші — з карток і слідів у стрічці та
                  зі згорнутої смуги. */}
              <div className={styles['rail-kicker']}>
                <span className={styles['rail-kicker-icon']}><Icon name={ARTIFACT_ICON[shown.kind]} size={16} inherit decorative /></span>
                {/* Назва ТИПУ, не назва страви: «Рецепт», «Чек», «Кошик»; страва — у вмісті h2. */}
                <span className={styles['rail-kicker-title']}>{shown.kind === 'recipe' ? 'Рецепт' : shown.label}</span>
              </div>
              <div className={styles['rail-head-actions']} ref={setHeadSlot} hidden />
              <button type="button" className={styles['rail-collapse']} data-tap onClick={s.collapse} title="Згорнути панель" aria-label="Згорнути панель">
                <Icon name="sys.panelClose" size={16} inherit decorative />
              </button>
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
            <div className={`${styles['rail-foot']} ${bodyScrolled ? styles['rail-foot-shadow'] : ''}`} ref={setFootSlot} data-panel-foot />
          </div>
        )}
      </aside>
      {open && <div className={styles['rail-scrim']} onClick={() => s.setOpen(false)} />}
      <div className={`${styles['rail-mini']} ${hidden ? styles['rail-mini-show'] : ''}`}>
        <button type="button" className={styles['rail-mini-expand']} data-tap onClick={miniClick} aria-label="Розгорнути панель">
          <PanelIcon />
          {pendingDot && <span className={styles['rail-mini-dot']} />}
        </button>
        {shown && (
          <button type="button" className={`${styles['mini-marker']} ${styles['mini-marker-on']} ${fresh ? styles['mini-fresh'] : ''}`} data-tap
            onClick={miniClick} aria-label={`Відкрити: ${shown.label}${fresh ? ' (нове)' : ''}`}>
            <span className={styles['mini-glyph']}><Icon name={ARTIFACT_ICON[shown.kind]} size={16} inherit decorative /></span>
            {shown.meta && <span className={styles['mini-badge']}>{shown.meta}</span>}
            <span className={styles['mini-hint']}>{shown.label}</span>
          </button>
        )}
        {miniOthers.length > 0 && (
          <button type="button" className={styles['mini-marker']} data-tap onClick={() => setMiniListOpen((v) => !v)} aria-expanded={miniListOpen} aria-label="Інші артефакти">
            <span className={styles['mini-plus']}>+{miniOthers.length}</span>
          </button>
        )}
        {miniListOpen && miniOthers.length > 0 && (
          <div className={styles['mini-list']}>
            {miniOthers.map((a) => (
              <button key={a.key} type="button" className={styles['mini-list-row']}
                onClick={() => { setMiniListOpen(false); s.openArtifact(a.key); }}>
                <span className={styles['mini-list-name']}><Icon name={ARTIFACT_ICON[a.kind]} size={16} inherit decorative /> {a.label}</span>
                {a.meta && <span className={styles['mini-list-meta']}>{a.meta}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
