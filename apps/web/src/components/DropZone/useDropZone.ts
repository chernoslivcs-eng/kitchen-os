// Крок Д1 (макет v7): перетягування файлів у чат.
//
// Обробники висять на window — кинути можна будь-де в стрічці, як вимагає бриф.
// Але НАМАЛЬОВАНОГО нічого тут немає: за макетом v7 накладки, тонування й
// повноекранної рамки не існує. Замість них — картка від Кухні в стрічці
// (DropCard) і композитор, що «озброюється». Тому це хук, а не компонент:
// він лише каже, що зараз тягнуть, а малюють це два різні місця.

import { useEffect, useRef, useState } from 'react';

/** Що саме тягнуть — від цього залежить увесь текст картки. */
export type DragKind =
  | 'pdf'      // один PDF: чек
  | 'image'    // одне фото: полиця, сторінка книжки
  | 'many'     // кілька файлів за раз
  | 'full';    // вкладень уже стеля — картка каже про це, а не про вміст

export interface DragState {
  kind: DragKind;
  count: number;
  /** Утримують довше за чотири секунди — заголовок картки міняється. */
  long: boolean;
  /** Курсор у координатах вікна: слот у картці тягнеться до нього. */
  x: number;
  y: number;
}

interface Options {
  pendingCount: number;
  max: number;
  onFiles: (files: File[]) => void;
  onFolder: () => void;
}

const LONG_HOLD_MS = 4000;

/** Тека, а не файл: у Chrome вона приходить у items як directory entry. */
function hasDirectory(dt: DataTransfer): boolean {
  return Array.from(dt.items ?? []).some((it) => {
    const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null })
      .webkitGetAsEntry?.();
    return !!entry?.isDirectory;
  });
}

/**
 * Рід перетягуваного — з `items`, бо самі файли браузер віддає лише на drop.
 * MIME там є, імені немає (і це не обійти) — тому картка говорить про рід
 * файла, а не називає його.
 *
 * Формат, якого не знаємо, картки не викликає: файл просто чіпляється
 * вкладенням, як зі скріпки.
 */
export function kindOfDrag(types: string[], pendingCount: number, max: number): DragKind | null {
  if (pendingCount >= max) return 'full';
  if (!types.length) return null;
  if (types.length > 1) return 'many';
  const t = types[0]!;
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('image/')) return 'image';
  return null;
}

export function useDropZone({ pendingCount, max, onFiles, onFolder }: Options): DragState | null {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Лічильник, а не булеве: dragenter/dragleave сиплються від КОЖНОГО
  // вкладеного елемента, і на булевому картка блимала б щоразу, коли курсор
  // проходить над дитиною.
  const depth = useRef(0);
  const longTimer = useRef(0);
  // Останній відомий рід: dragleave/drop приходять уже без корисних items.
  const kind = useRef<DragKind | null>(null);

  // Межі й колбеки — у рефі, а слухачі ставляться РАЗ. Інакше ефект
  // перереєстровувався б на кожну зміну pendingCount чи на новий колбек, а його
  // прибирання глушило б чотирисекундний таймер — і друга фраза не приходила б
  // ніколи. Спіймано тестом, не міркуванням.
  const opts = useRef<Options>({ pendingCount, max, onFiles, onFolder });
  opts.current = { pendingCount, max, onFiles, onFolder };

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const fileTypes = (dt: DataTransfer) =>
      Array.from(dt.items ?? []).filter((i) => i.kind === 'file').map((i) => i.type);

    const close = () => {
      depth.current = 0;
      kind.current = null;
      window.clearTimeout(longTimer.current);
      setDrag(null);
    };

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      if (depth.current > 1) return;
      const k = kindOfDrag(fileTypes(e.dataTransfer!), opts.current.pendingCount, opts.current.max);
      kind.current = k;
      // Невідомий формат — картки немає, але подія все одно наша: без
      // preventDefault нижче браузер відкриє файл у вкладці.
      if (!k) return;
      const count = fileTypes(e.dataTransfer!).length;
      setDrag({ kind: k, count, long: false, x: e.clientX, y: e.clientY });
      window.clearTimeout(longTimer.current);
      longTimer.current = window.setTimeout(
        () => setDrag((d) => (d ? { ...d, long: true } : d)),
        LONG_HOLD_MS,
      );
    };

    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Без preventDefault на dragover drop не станеться взагалі, а браузер
      // відкриє файл у вкладці — це і є нинішня поведінка продукту.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      // Координати — щоб слот у картці тягнувся за курсором. Ставимо через
      // setDrag, бо саме вони й малюються.
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    };

    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current -= 1;
      if (depth.current <= 0) close();
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const dt = e.dataTransfer!;
      const files = Array.from(dt.files ?? []);
      close();
      if (hasDirectory(dt) || !files.length) { opts.current.onFolder(); return; }
      opts.current.onFiles(files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.clearTimeout(longTimer.current);
    };
    // Порожні залежності навмисно: усе змінне читається з opts.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return drag;
}
