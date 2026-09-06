// @vitest-environment jsdom
//
// Крок Д1 (макет v7): перетягування файлів у чат.
//
// Перевіряється те, що ламається тихо: без preventDefault на dragover drop не
// станеться взагалі (браузер відкриє файл у вкладці — це і є нинішня поведінка
// продукту), без лічильника глибини картка блимає щоразу, коли курсор проходить
// над вкладеним елементом, а рід файла читається з `items`, бо самі файли
// браузер віддає лише на drop.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDropZone, kindOfDrag, type DragState } from './useDropZone';
import { DropCard, copyFor } from './DropCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let files: File[][];
let folders: number;
let seen: DragState | null;

const file = (name = 'chek.jpg', type = 'image/jpeg') => new File([new Uint8Array([1])], name, { type });

/** DataTransfer у jsdom неповний — збираємо рівно те, що читає хук. */
function dt(opts: { types?: string[]; files?: File[]; mimes?: string[]; dirs?: boolean } = {}): DataTransfer {
  const list = opts.files ?? [];
  const mimes = opts.mimes ?? list.map((f) => f.type);
  return {
    types: opts.types ?? ['Files'],
    files: list,
    items: mimes.map((type) => ({
      kind: 'file',
      type,
      webkitGetAsEntry: () => ({ isDirectory: !!opts.dirs }),
    })),
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function fire(type: string, transfer: DataTransfer, xy: { clientX?: number; clientY?: number } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { dataTransfer: transfer, clientX: xy.clientX ?? 100, clientY: xy.clientY ?? 100 });
  act(() => { window.dispatchEvent(e); });
  return e;
}

function Harness({ pendingCount, max }: { pendingCount: number; max: number }) {
  const drag = useDropZone({
    pendingCount,
    max,
    onFiles: (f) => files.push(f),
    onFolder: () => { folders += 1; },
  });
  seen = drag;
  return drag ? <DropCard drag={drag} max={max} /> : null;
}

async function mount(pendingCount = 0, max = 5) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Harness pendingCount={pendingCount} max={max} />); });
}

const card = () => document.querySelector('[data-drop-card]');
const text = (sel: string) => document.querySelector(sel)?.textContent ?? '';

beforeEach(() => { files = []; folders = 0; seen = null; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('рід перетягуваного', () => {
  // Ім'я файла під час перетягування недоступне — тільки MIME. Тому рід
  // читається з нього, і на невідомому форматі картки немає взагалі.
  it('один pdf, одне фото, кілька — три різні роди', () => {
    expect(kindOfDrag(['application/pdf'], 0, 5)).toBe('pdf');
    expect(kindOfDrag(['image/jpeg'], 0, 5)).toBe('image');
    expect(kindOfDrag(['image/png'], 0, 5)).toBe('image');
    expect(kindOfDrag(['image/jpeg', 'application/pdf'], 0, 5)).toBe('many');
  });

  it('невідомий формат картки не викликає', () => {
    expect(kindOfDrag(['text/plain'], 0, 5)).toBeNull();
    expect(kindOfDrag(['application/zip'], 0, 5)).toBeNull();
    expect(kindOfDrag([], 0, 5)).toBeNull();
  });

  it('стеля вкладень перебиває рід: картка каже про межу', () => {
    expect(kindOfDrag(['application/pdf'], 5, 5)).toBe('full');
    expect(kindOfDrag(['text/plain'], 5, 5)).toBe('full');
  });
});

describe('текст картки за родом', () => {
  const st = (kind: DragState['kind'], count = 1): DragState => ({ kind, count, long: false, x: 0, y: 0 });

  it('чек обіцяє позиції, фото — те, що видно', () => {
    expect(copyFor(st('pdf'), 5).effect).toBe('→ у комору · позиції з чека');
    expect(copyFor(st('image'), 5).effect).toBe('→ у комору · що видно на фото');
  });

  it('кілька файлів рахуються, а не називаються «три»', () => {
    expect(copyFor(st('many', 4), 5).slot).toBe('×4');
    expect(copyFor(st('many', 4), 5).kicker).toBe('файли · 4 шт');
  });

  it('на стелі обіцянки дії немає — лише межа', () => {
    const c = copyFor(st('full'), 5);
    expect(c.title).toBe('Більше 5 за раз не візьму');
    expect(c.effect).toBeNull();
  });
});

describe('картка в стрічці', () => {
  it('dragenter із pdf показує картку', async () => {
    await mount();
    expect(card()).toBeNull();
    fire('dragenter', dt({ mimes: ['application/pdf'] }));
    expect(card()).toBeTruthy();
    expect(text('[data-drop-slot]')).toBe('PDF');
    expect(card()!.textContent).toContain('Зараз прийму');
  });

  it('перетягнутий текст картки не показує', async () => {
    await mount();
    fire('dragenter', dt({ types: ['text/plain'] }));
    expect(card()).toBeNull();
  });

  it('невідомий формат: картки немає, але подія наша', async () => {
    await mount();
    const e = fire('dragenter', dt({ mimes: ['application/zip'] }));
    expect(card()).toBeNull();
    // preventDefault усе одно потрібен — інакше браузер відкриє файл.
    expect(e.defaultPrevented).toBe(true);
  });

  it('вкладені dragleave не гасять картку', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    fire('dragleave', dt({ mimes: ['image/jpeg'] }));
    expect(card()).toBeTruthy();
    fire('dragleave', dt({ mimes: ['image/jpeg'] }));
    expect(card()).toBeNull();
  });
});

describe('dragover', () => {
  it('preventDefault викликаний — без нього drop не станеться взагалі', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    const e = fire('dragover', dt({ mimes: ['image/jpeg'] }), { clientX: 220, clientY: 140 });
    expect(e.defaultPrevented).toBe(true);
    expect(seen).toMatchObject({ x: 220, y: 140 });
  });

  it('на чужому типі defaultPrevented не ставиться', async () => {
    await mount();
    const e = fire('dragover', dt({ types: ['text/plain'] }));
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('drop', () => {
  it('файли їдуть у pickFiles, картка гасне', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    const f = [file('chek.jpg'), file('chek2.jpg')];
    const e = fire('drop', dt({ files: f }));
    expect(e.defaultPrevented).toBe(true);
    expect(files).toEqual([f]);
    expect(card()).toBeNull();
  });

  it('тека — не файли: onFolder, і нічого не додається', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    fire('drop', dt({ files: [file('Тека')], dirs: true }));
    expect(folders).toBe(1);
    expect(files).toEqual([]);
  });

  it('порожній files (як віддає частина браузерів на теку) — теж onFolder', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    fire('drop', dt({ files: [] }));
    expect(folders).toBe(1);
    expect(files).toEqual([]);
  });

  it('на стелі drop усе одно віддає файли — межу покаже pickFiles', async () => {
    await mount(5);
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    expect(card()!.textContent).toContain('Більше 5 за раз не візьму');
    fire('drop', dt({ files: [file()] }));
    // Дублювати тост про ліміт тут означало б завести друге джерело правди.
    expect(files).toEqual([[expect.any(File)]]);
  });
});

describe('чотири секунди утримання', () => {
  it('заголовок міняється на «можеш відпустити»', async () => {
    vi.useFakeTimers();
    await mount();
    fire('dragenter', dt({ mimes: ['application/pdf'] }));
    expect(card()!.textContent).toContain('Зараз прийму');

    await act(async () => { vi.advanceTimersByTime(3900); });
    expect(card()!.textContent).toContain('Зараз прийму');

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(card()!.textContent).toContain('Ти можеш відпустити');
    expect(card()!.textContent).not.toContain('Зараз прийму');
  });

  it('новий заход починає з першого заголовка', async () => {
    vi.useFakeTimers();
    await mount();
    fire('dragenter', dt({ mimes: ['application/pdf'] }));
    await act(async () => { vi.advanceTimersByTime(4100); });
    expect(card()!.textContent).toContain('Ти можеш відпустити');

    fire('dragleave', dt({ mimes: ['application/pdf'] }));
    fire('dragenter', dt({ mimes: ['application/pdf'] }));
    expect(card()!.textContent).toContain('Зараз прийму');
  });
});
