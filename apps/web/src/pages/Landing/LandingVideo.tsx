// Ролик на лендінгу (LANDING-VIDEO-BRIEF-0930, рішення власника 30.09): три
// елементи, один стан. Бульбашка (≥1024) і блок у «Як це працює» (<1024) —
// поріг матчмедіа, ОКРЕМИЙ від bp лендінгу (desk/tab/mob, useBreakpoint), бо
// бриф ділить рівно на 1024, а не на 768/1280. Плеєр — один на обидві ширини.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { lockBodyScroll } from '../../lib/lockBodyScroll';
import { useBackdropClose } from '../../lib/backdrop-close';
import { reducedMotion } from './useLandingMotion';
import { VIDEO } from './copy';
import { VIDEO_FULL, VIDEO_BUBBLE, VIDEO_POSTER } from './video-assets';
import styles from './LandingVideo.module.css';

const DISMISS_KEY = 'kos-video-bubble-dismissed';
const MIN_1024 = '(min-width: 1024px)';

function useMinWidth1024(): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(MIN_1024).matches);
  useEffect(() => {
    const mq = window.matchMedia(MIN_1024);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

export function useLandingVideo() {
  const isDesktop = useMinWidth1024();
  const [playerOpen, setPlayerOpen] = useState(false);
  const [bubbleDismissed, setBubbleDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const openPlayer = useCallback(() => setPlayerOpen(true), []);
  const closePlayer = useCallback(() => setPlayerOpen(false), []);
  const dismissBubble = useCallback(() => {
    setBubbleDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* приватний режим — тихо */ }
  }, []);
  return { isDesktop, playerOpen, openPlayer, closePlayer, bubbleDismissed, dismissBubble };
}

function onTapKey(fn: () => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fn();
  };
}

interface BubbleProps { onOpen: () => void; onDismiss: () => void; footerRef: RefObject<HTMLElement | null> }

export function VideoBubble({ onOpen, onDismiss, footerRef }: BubbleProps) {
  const [videoOk, setVideoOk] = useState(true);
  const [nearFooter, setNearFooter] = useState(false);
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setNearFooter(!!e?.isIntersecting), { rootMargin: '0px 0px -10% 0px' });
    io.observe(footer);
    return () => io.disconnect();
  }, [footerRef]);

  return (
    <div className={styles.bubbleWrap} data-hide={nearFooter || undefined}>
      <span className={styles.bubbleCaption}>{VIDEO.caption} · {VIDEO.duration}</span>
      <div
        className={styles.bubble} data-tap role="button" tabIndex={0}
        aria-label={VIDEO.openAria} onClick={onOpen} onKeyDown={onTapKey(onOpen)}
      >
        {!reducedMotion() && videoOk ? (
          <video
            className={styles.bubbleMedia} src={VIDEO_BUBBLE} poster={VIDEO_POSTER}
            muted loop playsInline autoPlay preload="metadata" onError={() => setVideoOk(false)}
          />
        ) : (
          <img className={styles.bubbleMedia} src={VIDEO_POSTER} alt="" />
        )}
        <span className={styles.bubbleWatch}><Icon name="cook.play" size={12} inherit decorative />{VIDEO.watch}</span>
        <button
          type="button" className={styles.bubbleClose} data-tap
          aria-label="Сховати відео" onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        >
          <Icon name="sys.close" size={12} inherit decorative />
        </button>
      </div>
    </div>
  );
}

export function VideoBlock({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      className={styles.block} data-tap role="button" tabIndex={0}
      aria-label={VIDEO.openAria} onClick={onOpen} onKeyDown={onTapKey(onOpen)}
    >
      <img className={styles.blockCover} src={VIDEO_POSTER} alt="" width={1280} height={720} loading="lazy" />
      <span className={styles.blockDuration}>{VIDEO.duration}</span>
      <span className={styles.blockWatch}><Icon name="cook.play" size={18} inherit decorative />{VIDEO.watch}</span>
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, select, textarea, video, [tabindex]:not([tabindex="-1"])';

export function VideoPlayerOverlay({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const close = useCallback(() => {
    videoRef.current?.pause();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const unlock = lockBodyScroll();
    return () => { document.removeEventListener('keydown', onKey); unlock(); };
  }, [close]);

  const backdrop = useBackdropClose(close);
  return (
    <div {...backdrop} role="presentation" className={styles.playerBackdrop}>
      <div
        ref={panelRef} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={VIDEO.openAria}
        className={styles.playerPanel}
      >
        <button type="button" className={styles.playerClose} data-tap onClick={close} aria-label={VIDEO.closeAria}>
          <Icon name="sys.close" size={20} inherit decorative />
        </button>
        <video ref={videoRef} className={styles.playerVideo} src={VIDEO_FULL} poster={VIDEO_POSTER} controls autoPlay playsInline />
      </div>
    </div>
  );
}
