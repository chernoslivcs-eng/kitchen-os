// Поки відкрита fixed-шторка, документ під нею не має «гумитись» і
// прокручуватись (iOS тягне body за пальцем крізь скрім). Один лічильник на
// всіх (Sheet, шторка артефакта, «Дім зараз»): перший лок запамʼятовує, що
// було, останній знімач повертає. Без лічильника два накладені локи, зняті
// не в тому порядку, лишали body з overflow: hidden назавжди — і на iOS це
// саме «список не догортується» (fix/ios-list-scroll, 13.09).
let locks = 0;
let prev = '';

export function lockBodyScroll() {
  if (locks++ === 0) {
    prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--locks === 0) document.body.style.overflow = prev;
  };
}

/** Тільки для тестів. */
export function __resetBodyLock() { locks = 0; prev = ''; document.body.style.overflow = ''; }
