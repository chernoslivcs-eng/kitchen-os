// Мобільний аудит 0912 · B (№17): поле у шторці або картці позиції після появи
// клавіатури може опинитись під згорткою — контейнер fixed і скролиться
// всередині, а браузер сам підскролює лише документ. Через 350 мс після фокуса
// (клавіатура вже піднялась) підтягуємо поле в межі контейнера. Ставиться
// onFocusCapture на контейнер — одне місце на всі поля всередині.
import type { FocusEvent } from 'react';

export function keepFieldInView(e: FocusEvent<HTMLElement>) {
  const el = e.target as HTMLElement | null;
  if (!el?.matches?.('input, textarea, select, [contenteditable]')) return;
  window.setTimeout(() => el.scrollIntoView?.({ block: 'nearest' }), 350);
}
