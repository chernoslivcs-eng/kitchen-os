// @vitest-environment jsdom
//
// Крок А1: клас пристрою.
//
// Ламається тихо в одному місці — якщо межі розійдуться з розкладкою
// продукту. Тоді стовпчик «клас» показуватиме не те, що людина бачила, і
// відповідь на «це зламалось у всіх на телефонах?» стане неправдою, схожою
// на правду. Тому межі тут не просто перевіряються числами, а звіряються з
// tokens.css — файлом, який їх і задає.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deviceClass, uaFamily, readDevice, TABLET_MIN, DESKTOP_MIN } from './device';

const TOKENS = resolve(dirname(fileURLToPath(import.meta.url)), '../styles/tokens.css');

describe('межі — з розкладки продукту, не вигадані', () => {
  it('ті самі числа стоять у tokens.css', () => {
    // Обидві межі — там, де body.with-sidebar міняє поведінку: смужка 64px на
    // планшеті, сайдбар 232px на десктопі. Якщо колись поїде tokens.css, цей
    // тест впаде тут, а не мовчки перекосить статистику через місяць.
    const css = readFileSync(TOKENS, 'utf-8');
    expect(css).toContain(`@media (min-width: ${DESKTOP_MIN}px)`);
    expect(css).toContain(`@media (min-width: ${TABLET_MIN}px) and (max-width: ${DESKTOP_MIN - 1}px)`);
  });
});

describe('deviceClass', () => {
  it('телефон — усе до планшетної межі', () => {
    expect(deviceClass(320)).toBe('mobile');
    expect(deviceClass(390)).toBe('mobile');   // iPhone 14
    expect(deviceClass(767)).toBe('mobile');
  });

  it('планшет — рівно смуга 768–1023', () => {
    expect(deviceClass(768)).toBe('tablet');
    expect(deviceClass(834)).toBe('tablet');   // iPad
    expect(deviceClass(1023)).toBe('tablet');
  });

  it('десктоп — від 1024', () => {
    expect(deviceClass(1024)).toBe('desktop');
    expect(deviceClass(1440)).toBe('desktop');
    expect(deviceClass(3440)).toBe('desktop');
  });

  it('межі належать ВЕРХНЬОМУ класу — 767 ще телефон, 768 уже планшет', () => {
    // Мутація «>=» → «>» на будь-якій із двох межей падає саме тут.
    expect(deviceClass(TABLET_MIN - 1)).toBe('mobile');
    expect(deviceClass(TABLET_MIN)).toBe('tablet');
    expect(deviceClass(DESKTOP_MIN - 1)).toBe('tablet');
    expect(deviceClass(DESKTOP_MIN)).toBe('desktop');
  });
});

describe('uaFamily', () => {
  it('айфон — Safari · iOS, а не «Mozilla»', () => {
    expect(uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari · iOS');
  });

  it('Chrome не читається як Safari, Edge — як Chrome', () => {
    // Порядок перевірок і є вся суть: Chrome каже про себе «Safari», Edge —
    // «Chrome». Переставиш — і весь стовпчик стане «Safari».
    expect(uaFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'))
      .toBe('Chrome · macOS');
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'))
      .toBe('Edge · Windows');
  });

  it('Chrome на айфоні (CriOS) — теж Chrome', () => {
    expect(uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1'))
      .toBe('Chrome · iOS');
  });

  it('андроїд упізнається', () => {
    expect(uaFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'))
      .toBe('Chrome · Android');
  });

  it('невпізнане лишається порожнім, а не словом «Unknown»', () => {
    // «Unknown» у стовпчику читалось би як факт про пристрій, хоча воно факт
    // про нас.
    expect(uaFamily('')).toBeNull();
    expect(uaFamily('якийсь бот')).toBeNull();
  });
});

describe('readDevice', () => {
  it('знімає ширину вікна і рахує з неї клас', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    expect(readDevice()).toEqual({ w: 390, class: 'mobile', ua: 'Safari · iOS' });
  });

  it('клас іде разом із ШИРИНОЮ, а не замість неї', () => {
    // Ширина — головний сигнал: якщо межі колись поїдуть, клас можна буде
    // перерахувати з неї запитом. Клас без ширини такої змоги не лишає.
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    const d = readDevice();
    expect(d!.w).toBe(1440);
    expect(d!.class).toBe('desktop');
  });
});
