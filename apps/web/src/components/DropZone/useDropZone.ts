// Перетягування файлів у чат — за Prototype v3.1 (FIXES-V3-2 №24a).
//
// Обробники висять на window — кинути можна будь-де в стрічці. Хук лише каже,
// що зараз тягнуть; малює це один оверлей (DropOverlay) поверх стрічки.
// Роду файла хук не читає: Prototype показує той самий оверлей на будь-який
// файл («чек, фото полиці або текст»), а що з ним робити — вирішує сервер
// уже після drop.

import { useEffect, useRef, useState } from 'react';

interface Options {
  onFiles: (files: File[]) => void;
  onFolder: () => void;
}

/** Тека, а не файл: у Chrome вона приходить у items як directory entry. */
function hasDirectory(dt: DataTransfer): boolean {
  return Array.from(dt.items ?? []).some((it) => {
    const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null })
      .webkitGetAsEntry?.();
    return !!entry?.isDirectory;
  });
}

export function useDropZone({ onFiles, onFolder }: Options): boolean {
  const [dragging, setDragging] = useState(false);
  // Лічильник, а не булеве: dragenter/dragleave сиплються від КОЖНОГО
  // вкладеного елемента, і на булевому оверлей блимав би щоразу, коли курсор
  // проходить над дитиною.
  const depth = useRef(0);

  // Колбеки — у рефі, слухачі ставляться РАЗ.
  const opts = useRef<Options>({ onFiles, onFolder });
  opts.current = { onFiles, onFolder };

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

    const close = () => {
      depth.current = 0;
      setDragging(false);
    };

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      if (depth.current > 1) return;
      setDragging(true);
    };

    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Без preventDefault на dragover drop не станеться взагалі, а браузер
      // відкриє файл у вкладці.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
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
    };
  }, []);

  return dragging;
}
