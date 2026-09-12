// Мобільний аудит 0912 · D (№42): поки відкрита fixed-шторка, документ під нею
// не має «гумитись» і прокручуватись (iOS тягне body за пальцем крізь скрім).
// Повертає знімач; Sheet робить те саме власноруч.
export function lockBodyScroll() {
  const prev = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => { document.body.style.overflow = prev; };
}
