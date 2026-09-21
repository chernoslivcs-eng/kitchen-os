// PR 4: рядок картки інтейку у вебі — «4 шт · 400 г» (вага одиниці після «·»).
import { describe, it, expect } from 'vitest';
import { opQty } from './cards';

describe('opQty', () => {
  it('упаковане — штуки й вага одиниці; вагове — value/unit; без нічого — порожньо', () => {
    expect(opQty({ op: 'add', label: 'томати пелаті', qty: 4, pack: { v: 400, u: 'g' } })).toBe('4 шт · 400 г');
    expect(opQty({ op: 'add', label: 'песто', qty: 1, pack: { v: 190, u: 'g' } })).toBe('1 шт · 190 г');
    expect(opQty({ op: 'add', label: 'квасоля', qty: 2 })).toBe('2 шт');
    expect(opQty({ op: 'add', label: 'сало', value: 500, unit: 'g' })).toBe('500 г');
    expect(opQty({ op: 'deplete', label: 'сало' })).toBe('');
  });
});
