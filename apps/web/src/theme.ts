// Auto-theme за prefers-color-scheme: OS каже — ми слухаємо.
// data-theme на <html> тим самим лишається керованим (можна потім додати
// перемикач у профілі, який перевизначає OS).

const media = () => window.matchMedia('(prefers-color-scheme: light)');

function apply(light: boolean) {
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
}

export function initTheme(): void {
  const m = media();
  apply(m.matches);
  // Змін ОС слухаємо в реальному часі — macOS перемикання «день/ніч»
  // без перезавантаження вкладки.
  m.addEventListener('change', (e) => apply(e.matches));
}
