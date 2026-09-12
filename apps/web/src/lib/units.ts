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
// Пакет 4, №7 (кадри Screens «Комора»): від 1000 г — кілограми, від 1000 мл —
// літри: «1,2 кг», «3 кг», «1,5 л» — кома, один десятковий, без хвостового
// нуля. Усюди, де формат уживається (рядок, картка, слід), одне правило.
export function formatQty(value?: number | null, unit?: string | null): string {
  if (value == null) return '';
  const key = unit?.toLowerCase();
  if ((key === 'g' || key === 'ml') && value >= 1000) {
    const big = Math.round(value / 100) / 10;              // один десятковий
    const num = Number.isInteger(big) ? String(big) : big.toFixed(1).replace('.', ',');
    return `${num} ${key === 'g' ? 'кг' : 'л'}`;
  }
  const u = formatUnit(unit);
  return u ? `${value} ${u}` : String(value);
}
