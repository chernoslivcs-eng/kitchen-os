// FIXES-V3 №21: класи на <body>, від яких ховається нижній бар (<768) —
// `composer-focused` (клавіатура) і `sheet-open` (шторка). Бар зникав «без
// причини», бо клас ставили й знімали різні власники навмання: шторка
// артефакта (toggle за станом стору) і Sheet (add на монтуванні / remove на
// демонтажі) ділили один клас — закриття однієї знімало клас іншої, а
// композитор, який демонтували у фокусі, blur не отримував і клас лишався.
//
// Правило: хто ставить, той і знімає, а клас стоїть, поки його тримає хоч
// один власник (лічильник). `hold()` повертає `release` — викликати рівно
// раз; повторний виклик нічого не робить.

export type BodyFlag = 'composer-focused' | 'sheet-open';

const counts: Record<BodyFlag, number> = { 'composer-focused': 0, 'sheet-open': 0 };

function sync(flag: BodyFlag): void {
  document.body.classList.toggle(flag, counts[flag] > 0);
}

export function holdBodyFlag(flag: BodyFlag): () => void {
  counts[flag] += 1;
  sync(flag);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts[flag] = Math.max(0, counts[flag] - 1);
    sync(flag);
  };
}

/** Скільки власників тримають клас зараз — для тестів і аудиту. */
export function bodyFlagHolders(flag: BodyFlag): number { return counts[flag]; }
