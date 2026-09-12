// Мобільний аудит 0912 · D (42в): iOS Safari не зменшує layout-viewport під
// клавіатурою — міняється лише visualViewport, і 100dvh лишається повним, а
// композитор (низ .screen) іде під клавіатуру. --kb на <html> — скільки
// екрана забрала клавіатура; .screen чату і сцена інтейку віднімають його від
// 100dvh. Android/десктоп: visualViewport.height == innerHeight → 0, тобто
// нічого не змінюється. Поріг 40 px відсікає адресний рядок і панелі.
export function installKeyboardOffset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const update = () => {
    raf = 0;
    const kb = Math.round(window.innerHeight - vv.height);
    root.style.setProperty('--kb', kb > 40 ? `${kb}px` : '0px');
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(update); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  update();
}
