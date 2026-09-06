// @vitest-environment jsdom
//
// Крок Д1: перетягування файлів у чат.
//
// Перевіряється те, що ламається тихо: без preventDefault на dragover drop не
// станеться взагалі (браузер відкриє файл у вкладці — це і є нинішня поведінка
// продукту), а без лічильника глибини накладка блимає щоразу, коли курсор
// проходить над вкладеним елементом.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DropZone } from './DropZone';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let files: File[][];
let folders: number;

const file = (name = 'chek.jpg', type = 'image/jpeg') => new File([new Uint8Array([1])], name, { type });

/** DataTransfer у jsdom неповний — збираємо рівно те, що читає компонент. */
function dt(opts: { types?: string[]; files?: File[]; dirs?: boolean } = {}): DataTransfer {
  const list = opts.files ?? [];
  return {
    types: opts.types ?? ['Files'],
    files: list,
    items: list.map(() => ({ webkitGetAsEntry: () => ({ isDirectory: !!opts.dirs }) })),
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function fire(type: string, transfer: DataTransfer, xy: { clientX?: number; clientY?: number } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { dataTransfer: transfer, clientX: xy.clientX ?? 100, clientY: xy.clientY ?? 100 });
  act(() => { window.dispatchEvent(e); });
  return e;
}

async function mount(pendingCount = 0) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <DropZone
        pendingCount={pendingCount}
        max={5}
        onFiles={(f) => files.push(f)}
        onFolder={() => { folders += 1; }}
      />,
    );
  });
}

const overlay = () => document.querySelector('[data-dropzone]');
// Слова — окремі спани (кожне вʼїжджає зі своєю затримкою), пробіл між ними
// малює flex-gap. Тому textContent їх злипає, і для порівняння їх треба
// зібрати назад так, як їх читає око.
const lineText = () => [...document.querySelectorAll('[data-dropzone-line] span')]
  .map((el) => el.textContent).join(' ');

beforeEach(() => {
  files = []; folders = 0;
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  document.body.classList.remove('dz-drag');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('накладка зʼявляється лише на файли', () => {
  it('dragenter з файлами показує накладку', async () => {
    await mount();
    expect(overlay()).toBeNull();
    fire('dragenter', dt());
    expect(overlay()).toBeTruthy();
    expect(lineText()).toContain('Так, сюди.');
  });

  it('перетягнутий текст зону не будить', async () => {
    await mount();
    fire('dragenter', dt({ types: ['text/plain'] }));
    expect(overlay()).toBeNull();
  });

  it('поки накладка є, сторінка відступає', async () => {
    await mount();
    fire('dragenter', dt());
    expect(document.body.classList.contains('dz-drag')).toBe(true);
    fire('dragleave', dt());
    expect(document.body.classList.contains('dz-drag')).toBe(false);
  });
});

describe('лічильник глибини', () => {
  it('вкладені dragleave не гасять накладку', async () => {
    await mount();
    // Курсор зайшов у вікно, потім у дитину, потім вийшов із дитини —
    // на булевому прапорці накладка тут би блимнула.
    fire('dragenter', dt());
    fire('dragenter', dt());
    fire('dragleave', dt());
    expect(overlay()).toBeTruthy();
    fire('dragleave', dt());
    expect(overlay()).toBeNull();
  });
});

describe('dragover', () => {
  it('preventDefault викликаний — без нього drop не станеться взагалі', async () => {
    await mount();
    fire('dragenter', dt());
    const e = fire('dragover', dt(), { clientX: 220, clientY: 140 });
    expect(e.defaultPrevented).toBe(true);
  });

  it('на чужому типі defaultPrevented не ставиться', async () => {
    await mount();
    const e = fire('dragover', dt({ types: ['text/plain'] }));
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('drop', () => {
  it('файли їдуть у pickFiles, накладка гасне', async () => {
    await mount();
    fire('dragenter', dt());
    const f = [file('chek.jpg'), file('chek2.jpg')];
    const e = fire('drop', dt({ files: f }));
    expect(e.defaultPrevented).toBe(true);
    expect(files).toEqual([f]);
    expect(document.body.classList.contains('dz-drag')).toBe(false);
  });

  it('тека — не файли: onFolder, і нічого не додається', async () => {
    await mount();
    fire('dragenter', dt());
    fire('drop', dt({ files: [file('Тека')], dirs: true }));
    expect(folders).toBe(1);
    expect(files).toEqual([]);
  });

  it('порожній files (як віддає частина браузерів на теку) — теж onFolder', async () => {
    await mount();
    fire('dragenter', dt());
    fire('drop', dt({ files: [] }));
    expect(folders).toBe(1);
    expect(files).toEqual([]);
  });

  it('уже пʼять вкладень: накладка каже про стелю, drop нічого не додає', async () => {
    await mount(5);
    fire('dragenter', dt());
    expect(lineText()).toContain('Більше пʼяти за раз не візьму');
    fire('drop', dt({ files: [file()] }));
    // Файли все одно віддаються pickFiles — саме він показує тост про ліміт,
    // і дублювати цю перевірку тут означало б завести друге джерело правди.
    expect(files).toEqual([[expect.any(File)]]);
  });
});

describe('друга репліка', () => {
  it('зʼявляється після чотирьох секунд утримання', async () => {
    vi.useFakeTimers();
    await mount();
    fire('dragenter', dt());
    expect(lineText()).toContain('Так, сюди.');

    await act(async () => { vi.advanceTimersByTime(3900); });
    expect(lineText()).toContain('Так, сюди.');

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(lineText()).toContain('Ти можеш відпустити');
    expect(lineText()).not.toContain('Так, сюди.');
  });

  it('новий заход починає з першої репліки', async () => {
    vi.useFakeTimers();
    await mount();
    fire('dragenter', dt());
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(lineText()).toContain('Ти можеш відпустити');

    fire('dragleave', dt());
    fire('dragenter', dt());
    expect(lineText()).toContain('Так, сюди.');
  });
});
