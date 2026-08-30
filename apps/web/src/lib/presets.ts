// Пресети з прототипу: пікер техніки (EQUIP_EXTRA) і швидкі дієти
// (DIET_PRESETS). Обидва — не нові поля профілю, а зручний ввід у наявні:
// техніка йде в equipment через той самий PATCH, дієта — звичайний wish.
//
// DIET_PRESETS у прототипі так і лишились заготовкою: визначені, ніде не
// використані. Тут вони нарешті працюють.

export const EQUIP_EXTRA = [
  'блендер', 'занурювальний блендер', 'міксер', 'кухонний комбайн', 'кухонні ваги', 'термометр',
  'чавунна пательня', 'вок', 'казан', 'гриль', 'мангал', 'аерогриль', 'фритюрниця', 'мультиварка',
  'пароварка', 'су-від', 'фондюшниця', 'мʼясорубка', 'мандоліна', 'хлібопічка', 'мікрохвильовка',
] as const;

export const DIET_PRESETS = [
  'вегетаріанство',
  'веганство',
  'халяль',
  'кошер',
  'без глютену',
  'без лактози',
  'пескетаріанство',
  'без червоного мʼяса',
  'кето',
  'низький FODMAP',
] as const;

export type EquipState = 'has' | 'lacks' | undefined;

// Тап по чипу техніки крутить цикл прототипу: невідомо → є → немає → невідомо.
// «Невідомо» — це відсутність запису, тому третій крок — remove, а не стан.
export function cycleEquip(cur: EquipState): { op: 'add'; has: boolean } | { op: 'remove' } {
  if (cur === undefined) return { op: 'add', has: true };
  if (cur === 'has') return { op: 'add', has: false };
  return { op: 'remove' };
}

export function equipGlyph(cur: EquipState): string {
  if (cur === 'has') return '●';
  if (cur === 'lacks') return '✕';
  return '○';
}
