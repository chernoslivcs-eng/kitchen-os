// Картка рецепта v2 (spec 2026-09-18, «Рішення після макета»): пʼять власних
// SVG-гліфів страв з макета (Kitchen OS - Recipe Card v2.dc.html,
// renderVals().icons) — path-и перенесені дослівно. `createLucideIcon` дає
// той самий контур/пропси (size · strokeWidth · strokeLinecap · strokeLinejoin),
// що й Icon.tsx очікує від `LucideIcon`.
//
// Відхилення від макета (моє рішення, executor design authority):
// · «Морепродукти» — НЕ власний малюнок макета (креветка), а наявний `Shell`
//   (той самий гліф, що prod.seafood «Морепродукти») — одна мова з рядком
//   комори замість другого, іншого на вигляд знака того самого змісту.
// · dish.stew (рагу) — окремий малюнок, не з макета: макет узяв lucide
//   `cooking-pot`, але цей гліф у словнику RESERVED за «Готуємо» (icons.ts) і
//   не може нести друге значення. Неглибока пательня з вушками й парою —
//   відрізняється силуетом від «Готуємо»-каструлі.
import { createLucideIcon } from 'lucide-react';

export const DishPasta = createLucideIcon('DishPasta', [
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'M6 12a6 6 0 0 0 12 0' }],
  ['path', { d: 'M9 4c-1.5 1.5 1.5 3 0 4.5' }],
  ['path', { d: 'M12 4c-1.5 1.5 1.5 3 0 4.5' }],
  ['path', { d: 'M15 4c-1.5 1.5 1.5 3 0 4.5' }],
  ['path', { d: 'M9 20.5h6' }],
]);

export const DishGrill = createLucideIcon('DishGrill', [
  ['path', { d: 'M3 9h18' }],
  ['path', { d: 'M3 13h18' }],
  ['path', { d: 'M6 9v4' }],
  ['path', { d: 'M10 9v4' }],
  ['path', { d: 'M14 9v4' }],
  ['path', { d: 'M18 9v4' }],
  ['path', { d: 'M7 17l1-4' }],
  ['path', { d: 'M17 17l-1-4' }],
]);

export const DishPancake = createLucideIcon('DishPancake', [
  ['path', { d: 'M4 17c0 1.1 3.6 2 8 2s8-.9 8-2-3.6-2-8-2-8 .9-8 2Z' }],
  ['path', { d: 'M6 13c0 .9 2.7 1.5 6 1.5s6-.6 6-1.5-2.7-1.5-6-1.5-6 .6-6 1.5Z' }],
  ['path', { d: 'M8 9.5c0 .7 1.8 1.2 4 1.2s4-.5 4-1.2-1.8-1.2-4-1.2-4 .5-4 1.2Z' }],
  ['circle', { cx: '12', cy: '7', r: '1.1', fill: 'currentColor', stroke: 'none' }],
]);

export const DishSushi = createLucideIcon('DishSushi', [
  ['circle', { cx: '12', cy: '12', r: '7', fill: 'none', stroke: 'currentColor' }],
  ['circle', { cx: '12', cy: '12', r: '2.3', fill: 'currentColor', stroke: 'none' }],
]);

export const DishBurger = createLucideIcon('DishBurger', [
  ['path', { d: 'M4 11a8 5 0 0 1 16 0Z' }],
  ['path', { d: 'M3 11h18' }],
  ['path', { d: 'M3.5 14.5h17' }],
  ['path', { d: 'M4 17.5h16a1 1 0 0 1-1 2H5a1 1 0 0 1-1-2Z' }],
  ['circle', { cx: '9', cy: '7', r: '.5', fill: 'currentColor', stroke: 'none' }],
  ['circle', { cx: '13', cy: '6', r: '.5', fill: 'currentColor', stroke: 'none' }],
  ['circle', { cx: '15', cy: '8', r: '.5', fill: 'currentColor', stroke: 'none' }],
]);

export const DishStew = createLucideIcon('DishStew', [
  ['path', { d: 'M3 11a9 5 0 0 0 18 0' }],
  ['path', { d: 'M2.5 11h19' }],
  ['path', { d: 'M6 11V9a1 1 0 0 1 1-1h1' }],
  ['path', { d: 'M18 11V9a1 1 0 0 1-1-1h-1' }],
  ['path', { d: 'M10.5 3c-1 1 1 2 0 3' }],
  ['path', { d: 'M13.5 3c-1 1 1 2 0 3' }],
]);
