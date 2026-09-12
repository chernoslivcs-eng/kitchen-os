// @vitest-environment jsdom
//
// Перетягування файлів у чат — за Prototype v3.1 (FIXES-V3-2 №24a).
//
// Перевіряється те, що ламається тихо: без preventDefault на dragover drop не
// станеться взагалі (браузер відкриє файл у вкладці), без лічильника глибини
// оверлей блимає щоразу, коли курсор проходить над вкладеним елементом, а
// тека приходить як directory entry, а не як файл.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDropZone } from './useDropZone';
import { DropOverlay } from './DropOverlay';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let files: File[][];
let folders: number;

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

function fire(type: string, transfer: DataTransfer) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { dataTransfer: transfer, clientX: 100, clientY: 100 });
  act(() => { window.dispatchEvent(e); });
  return e;
}

function Harness() {
  const dragging = useDropZone({
    onFiles: (f) => files.push(f),
    onFolder: () => { folders += 1; },
  });
  return dragging ? <DropOverlay /> : null;
}

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Harness />); });
}

const overlay = () => document.querySelector('[data-drop-overlay]');

beforeEach(() => { files = []; folders = 0; });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.unstubAllGlobals();
});

describe('оверлей над стрічкою', () => {
  it('dragenter із файлом показує оверлей з «Кидай — розберу»', async () => {
    await mount();
    expect(overlay()).toBeNull();
    fire('dragenter', dt({ mimes: ['application/pdf'] }));
    expect(overlay()).toBeTruthy();
    expect(overlay()!.textContent).toContain('Кидай — розберу');
    expect(overlay()!.textContent).toContain('чек, фото полиці або текст');
  });

  it('один оверлей на будь-який рід файла — zip теж (що робити, вирішить сервер)', async () => {
    await mount();
    const e = fire('dragenter', dt({ mimes: ['application/zip'] }));
    expect(overlay()).toBeTruthy();
    expect(e.defaultPrevented).toBe(true);
  });

  it('перетягнутий текст оверлею не показує', async () => {
    await mount();
    fire('dragenter', dt({ types: ['text/plain'] }));
    expect(overlay()).toBeNull();
  });

  it('вкладені dragleave не гасять оверлей', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    fire('dragleave', dt({ mimes: ['image/jpeg'] }));
    expect(overlay()).toBeTruthy();
    fire('dragleave', dt({ mimes: ['image/jpeg'] }));
    expect(overlay()).toBeNull();
  });
});

describe('dragover', () => {
  it('preventDefault викликаний — без нього drop не станеться взагалі', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    const e = fire('dragover', dt({ mimes: ['image/jpeg'] }));
    expect(e.defaultPrevented).toBe(true);
  });

  it('на чужому типі defaultPrevented не ставиться', async () => {
    await mount();
    const e = fire('dragover', dt({ types: ['text/plain'] }));
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('drop', () => {
  it('файли їдуть в onFiles, оверлей гасне', async () => {
    await mount();
    fire('dragenter', dt({ mimes: ['image/jpeg'] }));
    const f = [file('chek.jpg'), file('chek2.jpg')];
    const e = fire('drop', dt({ files: f }));
    expect(e.defaultPrevented).toBe(true);
    expect(files).toEqual([f]);
    expect(overlay()).toBeNull();
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
});
