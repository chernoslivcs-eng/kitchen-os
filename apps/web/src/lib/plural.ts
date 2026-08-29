// Українська множина: три форми (one/few/many).
//   one — 1, 21, 31, 41…  «1 позиція»
//   few — 2-4, 22-24, 32-34…  «2 позиції»
//   many — 0, 5-20, 25-30… «5 позицій»
// Дужка 11-14 — виняток: там завжди many.
export function plural(n: number, forms: [one: string, few: string, many: string]): string {
  const a = Math.abs(Math.trunc(n));
  const mod10 = a % 10;
  const mod100 = a % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
