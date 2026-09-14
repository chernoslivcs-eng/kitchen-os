import { describe, it, expect } from 'vitest';
import { HELP_TOPICS, HELP_TOPICS_TG, helpTopicById, helpTopicByText } from './help-topics.js';

// HELP-CHIPS-TG-0915: другий набір тих самих шести довідок для бота.
describe('HELP_TOPICS_TG', () => {
  it('ті самі id, підпис 2 — «Kitchen OS у вебі», без ⟨⟩, з абзацами і жирним', () => {
    expect(HELP_TOPICS_TG.map((t) => t.id)).toEqual(HELP_TOPICS.map((t) => t.id));
    expect(HELP_TOPICS_TG[1]!.chip).toBe('💻 Kitchen OS у вебі');
    for (const t of HELP_TOPICS_TG) {
      expect(t.text).not.toMatch(/[⟨⟩]/);
      expect(t.text).toContain('\n\n');
      expect(t.text.trim().endsWith('?')).toBe(true);
    }
    expect(HELP_TOPICS_TG[0]!.text).toContain('**Профіль**');
    expect(HELP_TOPICS_TG[1]!.text).toContain('**/pantry**');
    expect(HELP_TOPICS_TG[1]!.text).toContain('натисни /web');
  });
  it('helpTopicById(id, "telegram") → TG-варіант; за замовчуванням — веб', () => {
    expect(helpTopicById('list', 'telegram')?.text).toContain('додай у список вершки');
    expect(helpTopicById('list')?.text).not.toContain('додай у список вершки');
    expect(helpTopicById('nope', 'telegram')).toBeNull();
  });
  it('helpTopicByText упізнає і TG-текст (після F5 у вебі довідка з бота — теж довідка)', () => {
    expect(helpTopicByText(HELP_TOPICS_TG[4]!.text)?.id).toBe('pantry');
  });
});
