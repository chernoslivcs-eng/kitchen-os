// Одна форма написання одиниць — українська. У Пантрі, картках чату,
// журналі й Cook Mode мали три різні варіанти (`250G`, `250g`, `250 г`).
// Правильний уже був у селекті шита партії — виносимо в спільний хелпер.

const UNIT_UK: Record<string, string> = {
  g: 'г',
  kg: 'кг',
  ml: 'мл',
  l: 'л',
  pcs: 'шт',
  pack: 'пач',
};

export function formatUnit(u?: string | null): string {
  if (!u) return '';
  return UNIT_UK[u.toLowerCase()] ?? u;
}

// «250 г», «100 мл», «1 шт». Порожньо коли value відсутнє.
// Пробіл між числом і одиницею — типографічна норма УА.
export function formatQty(value?: number | null, unit?: string | null): string {
  if (value == null) return '';
  const u = formatUnit(unit);
  return u ? `${value} ${u}` : String(value);
}
