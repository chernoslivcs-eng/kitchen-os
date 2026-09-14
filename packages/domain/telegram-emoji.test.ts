import { describe, it, expect } from 'vitest';
import { TG_EMOJI, tgHeading } from './telegram-emoji.js';
import { HELP_TOPICS_TG } from './help-topics.js';

// Власник 15.09: емодзі в боті — лише маркери розділів, не в реченнях і не у відповідях моделі.
describe('telegram-emoji', () => {
  it('набір: зони, команди, секції календаря, довідки', () => {
    expect(TG_EMOJI.zone).toEqual({ fresh: '🥬', fridge: '🧊', freezer: '❄️', dry: '🥫', spices: '🧂', drinks: '🧃' });
    expect(TG_EMOJI.burning).toBe('🔥');
    expect(TG_EMOJI.cmd).toEqual({ list: '🛒', recipes: '📖', home: '🏠', calendar: '📅' });
    expect(TG_EMOJI.calendar).toEqual({ now: '🔴', seasons: '🌿', upcoming: '📌' });
    expect(TG_EMOJI.help).toEqual({ start: '🍽', telegram: '💻', app: '🧭', list: '🛒', pantry: '🥬', calendar: '📅' });
  });
  it('tgHeading: «🥬 Свіже · 3»', () => {
    expect(tgHeading('🥬', 'Свіже', 3)).toBe('🥬 Свіже · 3');
    expect(tgHeading('🏠', 'Дім зараз')).toBe('🏠 Дім зараз');
  });
  it('довідки TG: підпис із знаком; усередині — маркери лише на початку абзацу-кроку', () => {
    const start = HELP_TOPICS_TG.find((t) => t.id === 'start')!;
    expect(start.chip).toBe('🍽 З чого почати?');
    const paras = start.text.split('\n\n');
    expect(paras[0]!.startsWith('🧾 ')).toBe(true);
    expect(paras[1]!.startsWith('👤 ')).toBe(true);
    expect(paras[3]!.startsWith('🍽 ')).toBe(true);
    const app = HELP_TOPICS_TG.find((t) => t.id === 'app')!;
    expect(app.text).toContain('💬 **Чат**');
    expect(app.text).toContain('🥬 **Комора**');
    expect(app.text).toContain('📖 **Рецепти**');
    expect(app.text).toContain('🛒 **Список**');
    expect(app.text).toContain('📅 **Календар**');
    // Маркери — лише на початку абзацу або перед жирною назвою розділу (абзац
    // «пʼять розділів» у «Як працює додаток»); усередині речень — ні.
    for (const t of HELP_TOPICS_TG) for (const p of t.text.split('\n\n')) {
      for (const m of p.matchAll(/\p{Extended_Pictographic}/gu)) {
        const i = m.index!;
        const atStart = i === 0;
        const beforeSection = p.slice(i).match(/^\p{Extended_Pictographic}\uFE0F? \*\*/u) && (i === 0 || p[i - 1] === ' ' || p[i - 1] === '.');
        expect(atStart || !!beforeSection, `${t.id}: «${p.slice(Math.max(0, i - 10), i + 12)}»`).toBe(true);
      }
    }
  });
});
