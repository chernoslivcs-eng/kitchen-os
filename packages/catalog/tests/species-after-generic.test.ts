import { describe, it, expect } from 'vitest';
import { resolveLabelToKey } from '../logic.js';

// Власник 15.09, серія «строки в коморі» PR 1 (закриває Р161): вид після
// родової голови перемагає загальний запис; зона — контекст (у spices не
// брати овочі/зелень, для трав — сушений варіант). Назви — з прод-комори
// власника, як фікстури; контрольні 15 — не мають змінитись.

const CASES: [string, string | null, string?][] = [
  // ---- 19 з комори власника
  ['Сир Моцарела', 'mozzarella_pizza'],
  ['Сир Гауда 45%', 'gouda_cheese'],
  ['камбоцола Kaserei 70% брусок', 'cambozola_cheese'],
  ['перець Еко золотий серпанок з лимоном', 'lemon_pepper', 'spices'],
  ['орегано Fine Life', 'oregano_dried', 'spices'],
  ['паприка солодка Metro Chef', 'paprika_sweet', 'spices'],
  ['Хліб Салтівський', 'gen_bread'],
  ['Масло Ферма', 'gen_butter'],
  // «Олейна» — бренд соняшникової: вид за словом поза родовим («олія»), не gen_oil.
  ['Олія Олейна', 'sunflower_oil'],
  ['булочка з корицею', 'r2bk_bun_cinnamon'],
  ["чипси Lay's з сиром", 'chips_cheese'],
  ["Чипси Lay's картопляні зі смаком сиру", 'chips_cheese'],
  ['томат жовтий', 'tomato_yellow'],
  ['Томат Біоранж жовтий', 'tomato_yellow'],
  ['томати Біоранж жовті', 'tomato_yellow'],
  ['вершки Галичина 33%', 'cream_33'],
  ['Вершки Галичина 33% т/п', 'cream_33'],
  ['квас Тарас білий', 'kvass'],
  ['Квас Квас Тарас Хлібний з/б', 'kvass'],
  // ---- 15 контрольних
  ['молоко', 'milk_cow_25'],
  ['яйця', 'eggs_chicken'],
  ['курка ціла', 'chicken_whole'],
  ['кефір 1%', 'dairy_kefir_1'],
  ['гречка ядриця', 'grain_buckwheat_kernel'],
  ['ковбаса лікарська', 'saus_boiled_likarska'],
  ['помідори черрі', 'veg_tomato_cherry'],
  ['лосось філе', 'fish_salmon_fillet'],
  ['огірки', 'veg_cucumber_short'],
  ['цибуля ріпчаста', 'onion_yellow'],
  ['яблука', 'fruit_apple_red'],
  ['сметана 20%', 'dairy_sour_cream_20'],
  ['рис', 'gen_rice'],
  ['масло вершкове 82.5%', 'butter_82'],
  ['розмарин', 'herb_rosemary_fresh'],
];

describe('вид після родової голови · зона як контекст', () => {
  for (const [label, key, zone] of CASES) {
    it(`${zone ? `[${zone}] ` : ''}${label} → ${key}`, () => {
      expect(resolveLabelToKey(label, undefined, zone ? { zone: zone as 'spices' } : undefined)).toBe(key);
    });
  }
  it('без зони свіжі трави лишаються свіжими; у spices — сушені лише коли є', () => {
    expect(resolveLabelToKey('орегано')).toBe('herb_oregano_fresh');
    expect(resolveLabelToKey('розмарин', undefined, { zone: 'spices' })).toMatch(/rosemary/);
  });
  it('родове слово саме по собі — загальний запис, як і було', () => {
    expect(resolveLabelToKey('сир')).toBe('gen_cheese');
    expect(resolveLabelToKey('хліб')).toBe('gen_bread');
  });
});
