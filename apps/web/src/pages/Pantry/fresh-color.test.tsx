// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Ф2а: колір іконки свіжості — з обчисленого стилю, не з класу. Раніше
// `.row .mark { color }` (специфічність 0,2,0) перебивав `.fresh-soon`
// (0,1,0), і всі іконки були кольору accent. Стилі беремо з живого
// Pantry.module.css: якщо базове правило знову отримає color — тест упаде.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'Pantry.module.css'), 'utf-8');
const TOKENS = ':root { --accent: rgb(88, 117, 78); --amber: rgb(150, 113, 44); --danger: rgb(168, 72, 61); }';

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

function mount(fresh: string) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.body.innerHTML = `<div class="row"><button class="row-main"><span class="mark fresh-${fresh}" data-fresh="${fresh}"></span></button></div>`;
  return document.body.querySelector<HTMLElement>('.mark')!;
}

describe('колір іконки свіжості (обчислений)', () => {
  it('стан перебиває базове правило .row .mark', () => {
    // Етап 2a: клас `fresh-fresh` став `fresh-good` (Р22 — «свіже» це зона).
    expect(getComputedStyle(mount('good')).color).toBe('var(--sage)');
    expect(getComputedStyle(mount('soon')).color).toBe('var(--amber)');
    expect(getComputedStyle(mount('check')).color).toBe('var(--danger)');
  });
});
