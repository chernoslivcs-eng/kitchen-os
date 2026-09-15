// @vitest-environment jsdom
// Власник 15.09 (BETA-PLAN-0915): таблиця «Бета» — рядок на людину, сім справ.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { BetaPage } from './Beta';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { user_id: 'u1', name: 'Олена', email: null, household_id: 'h1', household_name: 'Дім Олена', started_at: '2026-09-15T08:00:00Z', source: 'telegram', telegram_user_id: 900,
    pantry: 11, pantry_ok: true, profile_filled: 2, profile_ok: true, dinner_asks: 3, cooks: 1, feedback: 1, periods: 1, invites: 1, silpo: true, last_seen_at: '2026-09-15T20:00:00Z', last_channel: 'telegram', active_days_7: 2 },
  { user_id: 'u2', name: 'newbie', email: 'n@x.local', household_id: 'h2', household_name: 'Дім newbie', started_at: '2026-09-14T08:00:00Z', source: 'email', telegram_user_id: null,
    pantry: 0, pantry_ok: false, profile_filled: 0, profile_ok: false, dinner_asks: 0, cooks: 0, feedback: 0, periods: 0, invites: 0, silpo: false, last_seen_at: '2026-09-14T09:00:00Z', last_channel: null, active_days_7: 1 },
];

let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); vi.unstubAllGlobals(); });

describe('/admin/beta', () => {
  it('рядок на людину, джерело, ✓/— по справах, канал останнього візиту', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: ROWS, thresholds: { pantry: 10, profile: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root!.render(<MemoryRouter><BetaPage /></MemoryRouter>); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const rows = host!.querySelectorAll('[data-beta-row]');
    expect(rows.length).toBe(2);
    const r1 = rows[0]!.textContent ?? '';
    expect(r1).toContain('Олена');
    expect(r1).toContain('Telegram');
    expect(r1).toContain('11');
    expect(rows[0]!.querySelector('[data-col="pantry"]')!.getAttribute('data-ok')).toBe('true');
    expect(rows[1]!.querySelector('[data-col="pantry"]')!.getAttribute('data-ok')).toBe('false');
    expect(rows[0]!.querySelector('[data-col="last"]')!.textContent).toContain('Telegram');
    expect(rows[1]!.textContent).toContain('пошта');
  });
});
