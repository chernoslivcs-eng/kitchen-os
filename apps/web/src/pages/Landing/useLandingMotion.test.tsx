// @vitest-environment jsdom
//
// Хотфікс (лендинг, режим «Реєстрація»): hero — min-height замість height,
// росте під довший блок входу (тариф + спосіб + пошта). useHeroOverflow
// рахує --hero-extra — на скільки hero перевищив vh−headerH (+32px запасу),
// щоб .laptopWrap (Landing.module.css, margin-top: -0.18vh + var(--hero-extra))
// не наповз на форму. useScrollScene — гасіння hero чекає, поки scrollY не
// перевищить той самий overflow, інакше форма гасне, поки її ще заповнюють.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef } from 'react';
import { useHeroOverflow, useScrollScene } from './useLandingMotion';

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

describe('useHeroOverflow · --hero-extra', () => {
  function Host() {
    const rootRef = useRef<HTMLDivElement>(null);
    const heroRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    useHeroOverflow(rootRef, heroRef, headerRef, true);
    return (
      <div ref={rootRef} data-root>
        <header ref={headerRef} data-testid="header" />
        <div ref={heroRef} data-testid="hero" />
      </div>
    );
  }

  async function mount(heroH: number, headerH: number, innerH: number, innerW: number) {
    vi.stubGlobal('innerHeight', innerH);
    vi.stubGlobal('innerWidth', innerW);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Host />); });
    mockRect(host.querySelector<HTMLElement>('[data-testid=hero]')!, heroH);
    mockRect(host.querySelector<HTMLElement>('[data-testid=header]')!, headerH);
    await act(async () => { window.dispatchEvent(new Event('resize')); });
  }

  it('hero не перевищує vh−headerH — --hero-extra 0px (режим «Вхід», як і завжди)', async () => {
    await mount(700, 80, 1080, 1920); // 700 < 1080-80=1000
    expect(host!.querySelector('[data-root]')!.getAttribute('style')).toContain('--hero-extra: 0px');
  });

  it('hero виріс за vh−headerH (тариф-картки «Реєстрація») — --hero-extra = приріст + 32px запасу, z=1 на 1920', async () => {
    await mount(1062.5, 80, 1080, 1920); // 1062.5 - (1080-80) = 62.5; z=1 → +32 = 94.5 → 95
    expect(host!.querySelector('[data-root]')!.getAttribute('style')).toContain('--hero-extra: 95px');
  });

  it('на вужчому 1280 (zoom < 1) компенсація ділиться на z — не дублює zoom', async () => {
    // 1280/1920 = .667; headerH виміряний як реальний px (уже враховує zoom)
    await mount(713.7, 53.33, 720, 1280); // extraReal = 713.7-(720-53.33)=47.03; z=.667
    const style = host!.querySelector('[data-root]')!.getAttribute('style')!;
    const m = style.match(/--hero-extra:\s*(\d+)px/);
    expect(m).toBeTruthy();
    const val = Number(m![1]);
    // (47.03+32)/.667 ≈ 118.5 — допускаємо заокруглення в межах ±2px.
    expect(val).toBeGreaterThan(115);
    expect(val).toBeLessThan(122);
  });
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
