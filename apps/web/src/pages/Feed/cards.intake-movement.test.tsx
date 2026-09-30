// @vitest-environment jsdom
// Спек 30.09 §2/§3/§6 (docs/superpowers/specs/2026-09-30-pantry-movement-cards-design.md).
// Замінює cards.intake-gone.test.tsx і cards.intake-ops.test.tsx: картка
// більше не переписує ops живою позицією (LivePositions тут узагалі не
// підмішується) — знак і число рядка рахує movement.ts з `before`, що
// принесла сама картка (PR #235). Обидва рендери IntakeCard: без чека
// (.ops/.op) і з чеком (ReceiptGroup/.rrow).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IntakeCard } from './cards';
import type { ChatCard } from '../../api';

let root: Root | undefined; let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

async function mount(card: ChatCard, opts: { applied?: boolean; undone?: boolean } = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter>
      <IntakeCard card={card} cardId="c1" applied={opts.applied ?? true} applying={false} dismissed={false}
        undone={opts.undone ?? false} undoAvailable={false} />
    </MemoryRouter>);
  });
}

// §2 таблиця — усі девʼять випадків одразу, у порядку спека.
const rows = [
  { op: 'add', label: 'Молоко', value: 1, unit: 'l' },
  { op: 'add', label: 'Сіль' },
  { op: 'deplete', label: 'Макарони', before: { value: 500, unit: 'g' } },
  { op: 'deplete', label: 'Олія' },
  { op: 'correct', label: 'Сир твердий', value: 200, unit: 'g', before: { value: 300, unit: 'g' } },
  { op: 'correct', label: 'Сир твердий 2', value: 300, unit: 'g', before: { value: 100, unit: 'g' } },
  { op: 'correct', label: 'Сир твердий 3', value: 300, unit: 'g' },
  { op: 'open', label: 'Сметана' },
  { op: 'rename', label: 'Сир', to: 'Сир твердий Гауда' },
];

describe('IntakeCard · §2 рядки без чека (.ops)', () => {
  it('кожен рядок таблиці §2 — правильний текст і колір', async () => {
    await mount({ type: 'intake_diff', ops: rows } as unknown as ChatCard);
    const qty = [...host!.querySelectorAll<HTMLElement>('[class*="op-qty"]')];
    const text = qty.map((el) => el.textContent);
    expect(text).toEqual(['+1 л', '+', '−500 г', '−', '−100 г', '+200 г', '300 г', 'відкрито']);
    // rename не показує право взагалі (перехід — у назві рядка).
    expect(qty.length).toBe(rows.length - 1);

    expect(qty[0]!.className).toContain('op-move-plus');
    expect(qty[1]!.className).toContain('op-move-plus');
    expect(qty[2]!.className).toContain('op-move-minus');
    expect(qty[3]!.className).toContain('op-move-minus');
    expect(qty[4]!.className).toContain('op-move-minus');
    expect(qty[5]!.className).toContain('op-move-plus');
    expect(qty[6]!.className).not.toMatch(/op-move-(plus|minus)/);
    expect(qty[7]!.className).not.toMatch(/op-move-(plus|minus)/);

    // §7: колонки знаків ліворуч і олівця «рукою» більше нема.
    expect(host!.querySelector('[class*="op-sign"]')).toBeNull();
    expect(host!.querySelector('[data-icon="live.byHand"]')).toBeNull();

    // rename і далі показує перехід у назві рядка.
    const labels = [...host!.querySelectorAll<HTMLElement>('[class*="op-label"]')].map((el) => el.textContent);
    expect(labels[8]).toContain('Сир');
    expect(labels[8]).toContain('Сир твердий Гауда');
  });

  it('§6: скасована картка малює ті самі рядки — before лишається, рух не діє', async () => {
    await mount({ type: 'intake_diff', ops: [rows[2]] } as unknown as ChatCard, { applied: true, undone: true });
    const qty = host!.querySelector<HTMLElement>('[class*="op-qty"]');
    expect(qty?.textContent).toBe('−500 г');
  });
});

describe('IntakeCard · §2а — уточнення 30.09 (коміт 7f142dfe)', () => {
  it('add qty×pack — «+4 × 400 г», одна упаковка — «+400 г»', async () => {
    await mount({
      type: 'intake_diff',
      ops: [
        { op: 'add', label: 'Йогурт баночки', qty: 4, pack: { v: 400, u: 'g' } },
        { op: 'add', label: 'Песто', qty: 1, pack: { v: 190, u: 'g' } },
      ],
    } as unknown as ChatCard);
    const qty = [...host!.querySelectorAll<HTMLElement>('[class*="op-qty"]')].map((el) => el.textContent);
    expect(qty).toEqual(['+4 × 400 г', '+190 г']);
  });

  it('correct без кількості — слово, не число: zone/state/уточнено', async () => {
    await mount({
      type: 'intake_diff',
      ops: [
        { op: 'correct', label: 'Гречка', zone: 'freezer' },
        { op: 'correct', label: 'Сметана', state: 'opened' },
        { op: 'correct', label: 'Камамбер', tags: { lactose_free: true } },
      ],
    } as unknown as ChatCard);
    const qty = [...host!.querySelectorAll<HTMLElement>('[class*="op-qty"]')].map((el) => el.textContent);
    expect(qty).toEqual(['у морозилку', 'відкрито', 'уточнено']);
    // Слово — не рух: жоден рядок не пофарбований як «+»/«−».
    for (const el of host!.querySelectorAll<HTMLElement>('[class*="op-qty"]')) {
      expect(el.className).not.toMatch(/op-move-(plus|minus)/);
    }
  });

  it('готування з пачки: used переважує before, remainder не показаний і не в N', async () => {
    const card = {
      type: 'intake_diff',
      source: { kind: 'cook', at: '2026-09-30T12:00:00Z' },
      ops: [
        { op: 'correct', label: 'Гречка', value: 1, unit: 'pcs', before: { value: 2, unit: 'pcs' }, used: { value: 250, unit: 'g' } },
        { op: 'add', label: 'Гречка', value: 250, unit: 'g', state: 'opened', remainder: true },
      ],
    } as unknown as ChatCard;
    await mount(card);
    const labels = [...host!.querySelectorAll<HTMLElement>('[class*="op-label"]')].map((el) => el.textContent);
    // Один рядок, не два: remainder не рендериться взагалі.
    expect(labels).toEqual(['Гречка']);
    const qty = host!.querySelector<HTMLElement>('[class*="op-qty"]');
    expect(qty?.textContent).toBe('−250 г');
    expect(qty?.className).toContain('op-move-minus');
  });
});

describe('IntakeCard · §2 рядки з чеком (ReceiptGroup/.rrow)', () => {
  it('те саме число і колір, тепер праворуч у рядку чека', async () => {
    const card = {
      type: 'intake_diff',
      ops: [rows[2], rows[4]],
      source: { kind: 'chat_receipt', at: '2026-09-30T09:00:00Z' },
    } as unknown as ChatCard;
    await mount(card);
    const qty = [...host!.querySelectorAll<HTMLElement>('[class*="rrow-qty"]')].map((el) => el.textContent);
    expect(qty).toEqual(['−500 г', '−100 г']);
    expect(host!.querySelector('[class*="rrow-sign"]')).toBeNull();
  });
});

describe('IntakeCard · §3 слід/шапка — три назви за агрегатним знаком', () => {
  it('усе списання — «Списано · N»', async () => {
    const card = {
      type: 'intake_diff',
      ops: [rows[2], rows[3]],
      source: { kind: 'chat_receipt', at: '2026-09-30T09:00:00Z' },
    } as unknown as ChatCard;
    await mount(card);
    const header = host!.querySelector('[class*="rgroup-title"]')?.textContent ?? '';
    expect(header).toContain('Списано');
    expect(header).toContain('2');
  });

  it('усе додавання — «У комору · N»', async () => {
    const card = {
      type: 'intake_diff',
      ops: [rows[0], rows[1]],
      source: { kind: 'chat_receipt', at: '2026-09-30T09:00:00Z' },
    } as unknown as ChatCard;
    await mount(card);
    const header = host!.querySelector('[class*="rgroup-title"]')?.textContent ?? '';
    expect(header).toContain('У комору');
    expect(header).toContain('2');
  });

  it('мішане (add + deplete) — «Комора · N»', async () => {
    const card = {
      type: 'intake_diff',
      ops: [rows[0], rows[2]],
      source: { kind: 'chat_receipt', at: '2026-09-30T09:00:00Z' },
    } as unknown as ChatCard;
    await mount(card);
    const header = host!.querySelector('[class*="rgroup-title"]')?.textContent ?? '';
    expect(header).toContain('Комора');
    expect(header).not.toContain('У комору');
    expect(header).not.toContain('Списано');
  });

});
