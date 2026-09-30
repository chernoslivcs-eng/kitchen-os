// @vitest-environment jsdom
// LANDING-VIDEO-BRIEF-0930: перемикач бульбашка/блок за шириною (поріг 1024,
// окремий від bp лендінгу), відкриття/закриття плеєра (тап, Esc, бекдроп,
// хрестик), запамʼятовування «сховати» бульбашку в sessionStorage.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createRef } from 'react';
import { useLandingVideo, VideoBubble, VideoBlock, VideoPlayerOverlay } from './LandingVideo';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockMatchMedia(desktop: boolean, reduced = false) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('1024') ? desktop : q.includes('reduce') ? reduced : false,
    media: q,
    addEventListener() {}, removeEventListener() {},
  }));
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function Harness() {
  const video = useLandingVideo();
  const footerRef = createRef<HTMLElement>();
  return (
    <div>
      <footer ref={footerRef as never} />
      {video.isDesktop && !video.bubbleDismissed && (
        <VideoBubble onOpen={video.openPlayer} onDismiss={video.dismissBubble} footerRef={footerRef} />
      )}
      {!video.isDesktop && <VideoBlock onOpen={video.openPlayer} />}
      {video.playerOpen && <VideoPlayerOverlay onClose={video.closePlayer} />}
    </div>
  );
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Harness />); });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('бульбашка/блок — перемикач за шириною 1024 (не bp лендінгу)', () => {
  it('≥1024 — бульбашка, без блоку', async () => {
    mockMatchMedia(true);
    await mount();
    expect(document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]')).toBeTruthy();
    expect(document.body.textContent).toContain('1:19');
  });

  it('<1024 — блок у потоці, без бульбашки-картки з підписом', async () => {
    mockMatchMedia(false);
    await mount();
    expect(document.body.textContent).not.toContain('Як це працює ·');
  });
});

describe('плеєр — відкриття й закриття', () => {
  it('тап по бульбашці відкриває плеєр з відео', async () => {
    mockMatchMedia(true);
    await mount();
    const bubble = document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]') as HTMLElement;
    await act(async () => { bubble.click(); });
    expect(document.querySelector('video[src="/video/showreel-full.mp4"]')).toBeTruthy();
  });

  it('Esc закриває плеєр', async () => {
    mockMatchMedia(true);
    await mount();
    const bubble = document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]') as HTMLElement;
    await act(async () => { bubble.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('клік по хрестику закриває плеєр', async () => {
    mockMatchMedia(true);
    await mount();
    const bubble = document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]') as HTMLElement;
    await act(async () => { bubble.click(); });
    const close = document.querySelector('[aria-label="Закрити відео"]') as HTMLElement;
    await act(async () => { close.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('клік по бекдропу (не по панелі) закриває плеєр', async () => {
    mockMatchMedia(true);
    await mount();
    const bubble = document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]') as HTMLElement;
    await act(async () => { bubble.click(); });
    const backdrop = document.querySelector('[role="presentation"]') as HTMLElement;
    await act(async () => { backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('тап по блоку (<1024) теж відкриває той самий плеєр', async () => {
    mockMatchMedia(false);
    await mount();
    const block = document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]') as HTMLElement;
    await act(async () => { block.click(); });
    expect(document.querySelector('video[src="/video/showreel-full.mp4"]')).toBeTruthy();
  });
});

describe('«сховати» бульбашку — до кінця сесії', () => {
  it('хрестик бульбашки ховає її й пише в sessionStorage; після перемонтування лишається схованою', async () => {
    mockMatchMedia(true);
    await mount();
    const dismiss = document.querySelector('[aria-label="Сховати відео"]') as HTMLElement;
    await act(async () => { dismiss.click(); });
    expect(sessionStorage.getItem('kos-video-bubble-dismissed')).toBe('1');
    expect(document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]')).toBeFalsy();

    await act(async () => { root?.unmount(); });
    host!.remove();
    await mount();
    expect(document.querySelector('[aria-label="Відкрити відео про Kitchen OS"]')).toBeFalsy();
  });
});
