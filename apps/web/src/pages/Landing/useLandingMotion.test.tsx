// @vitest-environment jsdom
//
// useScrollScene — гасіння hero на скрол чекає, поки scrollY не перевищить
// те, наскільки hero виступає за vh−headerH, інакше форма гасне, поки її ще
// заповнюють. (useHeroOverflow/--hero-extra — прибрано постановкою 25.09:
// існували лише для компенсації старої проценто-vh моделі .laptopWrap,
// яку замінено фіксованим відступом; див. Landing.module.css.)
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef } from 'react';
import { useScrollScene } from './useLandingMotion';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function mockRect(el: HTMLElement, height: number, top = 0) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    height, top, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() { return this; },
  } as DOMRect);
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useScrollScene · гасіння hero чекає overflow вищого hero', () => {
  function Host() {
    const rootRef = useRef<HTMLDivElement>(null);
    const { heroRef, headerRef } = useScrollScene(rootRef, true);
    return (
      <div ref={rootRef} data-root>
        <header ref={headerRef} data-testid="header" />
        <div ref={heroRef} data-testid="hero" />
      </div>
    );
  }

  async function mount() {
    // run() у useScrollScene планується через requestAnimationFrame — у
    // тестах виконуємо колбек синхронно, щоб не ганяти реальний rAF-тік.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Host />); });
  }

  it('hero вищий за vh−headerH: доки scrollY < overflow, opacity лишається 1 (форма не гасне, поки її заповнюють)', async () => {
    vi.stubGlobal('innerHeight', 900);
    await mount();
    const hero = host!.querySelector<HTMLElement>('[data-testid=hero]')!;
    const header = host!.querySelector<HTMLElement>('[data-testid=header]')!;
    mockRect(hero, 1000); // 1000 - (900-80=820) = 180 overflow
    mockRect(header, 80);
    vi.stubGlobal('scrollY', 100); // < overflow (180)
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    expect(hero.style.opacity).toBe('1');
  });

  it('щойно scrollY перевищив overflow — гасіння продовжується за тією самою формулою (scrollY-overflow)/(innerHeight*.6)', async () => {
    vi.stubGlobal('innerHeight', 900);
    await mount();
    const hero = host!.querySelector<HTMLElement>('[data-testid=hero]')!;
    const header = host!.querySelector<HTMLElement>('[data-testid=header]')!;
    mockRect(hero, 1000);
    mockRect(header, 80);
    const overflow = 180; // 1000 - 820
    vi.stubGlobal('scrollY', overflow + 270); // p = 270/(900*.6) = .5
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    expect(Number(hero.style.opacity)).toBeCloseTo(0.5, 1);
  });

  it('короткий hero (як «Вхід» завжди) — overflow 0, гасіння з самого початку скролу, як і було', async () => {
    vi.stubGlobal('innerHeight', 900);
    await mount();
    const hero = host!.querySelector<HTMLElement>('[data-testid=hero]')!;
    const header = host!.querySelector<HTMLElement>('[data-testid=header]')!;
    mockRect(hero, 700); // 700 < 820 → overflow 0
    mockRect(header, 80);
    vi.stubGlobal('scrollY', 270); // p = 270/540 = .5
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    expect(Number(hero.style.opacity)).toBeCloseTo(0.5, 1);
  });
});
