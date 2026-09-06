// Крок Д1: перетягування файлів у чат.
//
// Зона прийому — усе вікно, а не прямокутник композитора: людина тягне «у
// Кухню», і змушувати її цілитись у смугу вводу означало б вигадати межу, якої
// в її голові немає. Тому обробники висять на window, а не на елементі, і
// живуть рівно стільки, скільки змонтована Стрічка.
//
// Числа руху — з макета design/DROPZONE-v5.dc.html, не з опису задачі:
// пружина 0.11/0.8, знак веде на ±18/±13, вузол дихає з частотою, що росте з
// часом утримання, рамка — так само, тло accent 9% з розмиттям 3px.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Logo } from '../Logo/Logo';
import styles from './DropZone.module.css';

// Дві репліки з макета. Друга — саме про тривожність людини, яка тримає файл і
// не наважується відпустити, а не інструкція «відпустіть файл тут».
const LINES: { at: number; text: string }[] = [
  { at: 0, text: 'Так, сюди.' },
  { at: 4000, text: 'Ти можеш відпустити. Він не втече.' },
];

interface Props {
  /** Скільки вкладень уже стоїть — щоб сказати про стелю ДО того, як відпустили. */
  pendingCount: number;
  max: number;
  /** Файли їдуть у наявний pickFiles: ліміт і помилки там уже є, дублювати нічого. */
  onFiles: (files: File[]) => void;
  /** Тека замість файла — Feed скаже це тостом своїм механізмом. */
  onFolder: () => void;
}

/** Тека, а не файл: у Chrome вона приходить у items як directory entry. */
function hasDirectory(dt: DataTransfer): boolean {
  const items = Array.from(dt.items ?? []);
  return items.some((it) => {
    const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null })
      .webkitGetAsEntry?.();
    return !!entry?.isDirectory;
  });
}

export function DropZone({ pendingCount, max, onFiles, onFolder }: Props) {
  const [active, setActive] = useState(false);
  const [lineIdx, setLineIdx] = useState(0);
  const [swallow, setSwallow] = useState<{ dx: number; dy: number; label: string } | null>(null);

  // Лічильник, а не булеве: dragenter/dragleave сиплються від КОЖНОГО
  // вкладеного елемента, і на булевому накладка блимає щоразу, коли курсор
  // проходить над дитиною. Глибина росте на enter, спадає на leave, і зона
  // гасне лише на нулі.
  const depth = useRef(0);
  const cursor = useRef({ x: 0, y: 0 });
  const spring = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const startedAt = useRef(0);
  const raf = useRef(0);
  const markRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<SVGCircleElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLDivElement>(null);
  const lineTimer = useRef(0);

  const full = pendingCount >= max;

  useEffect(() => {
    // Мишею нічого не «тягнеться»: реагуємо лише коли в буфері справді файли.
    // Перетягнутий текст, посилання чи виділення зону не будять узагалі.
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

    const open = () => {
      startedAt.current = performance.now();
      spring.current = { x: window.innerWidth / 2, y: window.innerHeight * 0.44, vx: 0, vy: 0 };
      setLineIdx(0);
      setActive(true);
      window.clearTimeout(lineTimer.current);
      // Друга репліка — таймером, а не опитуванням у кадрі: подія одна, і так
      // її видно в тесті з підміненим годинником.
      lineTimer.current = window.setTimeout(() => setLineIdx(1), LINES[1]!.at);
    };
    const close = () => {
      depth.current = 0;
      window.clearTimeout(lineTimer.current);
      setActive(false);
    };

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      if (depth.current === 1) open();
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Без preventDefault на dragover drop не станеться взагалі, а браузер
      // відкриє файл у вкладці — це і є нинішня поведінка продукту.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      cursor.current = { x: e.clientX, y: e.clientY };
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
      if (hasDirectory(dt) || !files.length) { onFolder(); return; }
      if (pendingCount + files.length > max) { onFiles(files); return; }  // ліміт скаже pickFiles
      // Вузол втягує файл: рахуємо зсув від центру знака до курсора, далі це
      // робить css-анімація fileIn.
      setSwallow({
        dx: e.clientX - window.innerWidth / 2,
        dy: e.clientY - window.innerHeight * 0.44,
        label: files.length === 1 ? files[0]!.name : `${files.length} файли`,
      });
      // Інлайновий transform лишився з останнього кадру пружини й перебив би
      // анімацію ковтка — знімаємо його разом зі стартом.
      if (coreRef.current) coreRef.current.style.transform = '';
      window.setTimeout(() => setSwallow(null), 700);
      onFiles(files);
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
      window.clearTimeout(lineTimer.current);
    };
  }, [pendingCount, max, onFiles, onFolder]);

  // Рух — transform у rAF, не left/top: інакше кожен кадр перетягування
  // перераховував би розкладку сторінки під накладкою.
  useEffect(() => {
    if (!active) { cancelAnimationFrame(raf.current); return; }
    const step = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const cx = w / 2, cy = h * 0.44;
      const s = spring.current;
      // Пружина з макета: не позиція за курсором, а затухаючий інтеграл
      // швидкості — знак доганяє, а не приклеєний.
      s.vx = (s.vx + (cursor.current.x - s.x) * 0.11) * 0.8;
      s.vy = (s.vy + (cursor.current.y - s.y) * 0.11) * 0.8;
      s.x += s.vx; s.y += s.vy;
      const nx = Math.max(-1, Math.min(1, (s.x - cx) / (w * 0.42)));
      const ny = Math.max(-1, Math.min(1, (s.y - cy) / (h * 0.42)));
      const speed = Math.hypot(s.vx, s.vy);
      const held = (performance.now() - startedAt.current) / 1000;
      if (markRef.current) {
        markRef.current.style.transform =
          `translate(${nx * 18}px, ${ny * 13}px) scale(${1 + Math.min(0.06, speed / 130)})`;
      }
      if (coreRef.current) {
        coreRef.current.style.transform =
          `translate(${nx * 3}px, ${ny * 2.5}px) scale(${1 + 0.12 * Math.sin(held * (2.2 + held * 0.35))})`;
      }
      if (lineRef.current) {
        lineRef.current.style.transform = `translateX(-50%) translate(${nx * 12}px, ${ny * 8}px)`;
      }
      if (edgeRef.current) {
        // Рамка дихає ШВИДШЕ з часом утримання — частота росте від held.
        edgeRef.current.style.opacity = String(0.45 + 0.5 * Math.abs(Math.sin(held * (1.5 + held * 0.22))));
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [active]);

  // Сторінка під накладкою трохи відступає — і повертається при виході.
  // Клас глобальний і лягає на body, а правило масштабує #root: сама накладка
  // порталиться на body ПОЗА #root, інакше transform зробив би його
  // контейнером для position:fixed і накладка масштабувалась би разом зі
  // сторінкою, замість того щоб стояти над нею.
  useEffect(() => {
    document.body.classList.toggle('dz-drag', active);
    return () => document.body.classList.remove('dz-drag');
  }, [active]);

  if (!active && !swallow) return null;

  const words = LINES[lineIdx]!.text.split(' ');
  return createPortal(
    <div className={styles.overlay} data-dropzone aria-hidden="true">
      <div ref={edgeRef} className={styles.edge} />
      {/* data-gulp вмикає анімацію ковтка на вузлі — селектором у модулі,
          щоб не тягнути ще один проп крізь Logo. */}
      <div ref={markRef} className={styles.mark} data-gulp={swallow ? '' : undefined}>
        <Logo size={54} coreRef={coreRef} />
      </div>
      {swallow ? (
        <div
          className={styles.file}
          style={{ '--dx': `${swallow.dx}px`, '--dy': `${swallow.dy}px` } as React.CSSProperties}
        >{swallow.label}</div>
      ) : (
        <div ref={lineRef} className={styles.line} data-dropzone-line>
          {/* По словах, як у макеті: затримка 38 мс на слово. */}
          {full
            ? <span style={{ animationDelay: '0ms' }}>Більше пʼяти за раз не візьму</span>
            : words.map((w, i) => (
              <span key={`${lineIdx}-${i}`} style={{ animationDelay: `${i * 38}ms` }}>{w}</span>
            ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
