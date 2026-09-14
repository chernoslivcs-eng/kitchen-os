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
  let wasOpen = false;
  const update = () => {
    raf = 0;
    const kb = Math.round(window.innerHeight - vv.height);
    const open = kb > 40;
    root.style.setProperty('--kb', open ? `${kb}px` : '0px');
    // 14.09: кнопка «сховати клавіатуру» в iOS не знімає фокус із поля — клас
    // body.composer-focused лишався, і нижній бар не повертався, доки людина
    // не відправить або не тапне поза полем. Клавіатура зникла, поле у фокусі —
    // знімаємо фокус самі; набраний текст лишається. Android/десктоп сюди не
    // потрапляють (kb там завжди 0, переходу «відкрито → закрито» нема).
    if (wasOpen && !open) {
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) el.blur();
    }
    wasOpen = open;
  };
  const schedule = () => { if (!raf) raf = window.requestAnimationFrame(update); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  update();
}
