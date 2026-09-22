// Шерінг v3 (spec 2026-09-22-share-v3-design.md). Два шерабельні моменти:
// рецепт до готування (без фото → чисте тло) і результат (фото → постер/
// вертикаль). Три рендерери на canvas (render.ts) малюють один і той самий
// набір даних (frame.ts) — прев'ю й експорт PNG це той самий код: що
// бачиш, те й шериш.
//
// Адреса /share/:recipe_id (+?run=<cook_run_id>) під RequireAuth. Дані —
// GET /v1/recipes/:id, GET /v1/cook-runs?recipe_id= і GET /v1/me
// (telegram_linked) — усі три сервером PR 1 «Шерінг v3 — API/бот».
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon/Icon';
import { api, type Recipe, type CookRunWithRecipe } from '../../api';
import { track } from '../../lib/track';
import { captureClientIncident } from '../../lib/sentry';
import { pickCookRun, frameDataOf, clampCrop, resetCrop, applyCropDrag, isCropDefault, type FrameData, type CropState } from './frame';
import { drawPoster, drawVertical, drawLayout, drawClean, FRAME_W, FRAME_H, CLEAN_LIGHT, CLEAN_DARK, type FrameKind } from './render';
import styles from './Share.module.css';

// Баг з проду (iPhone Chrome, PR #181): user activation зʼїдав `await` перед
// navigator.share()/a.click(). PNG (canvasToBlobSync, правка 9) береться
// СИНХРОННО в момент натискання — жодного await до жесту користувача.
function isIOSChrome(): boolean {
  return typeof navigator !== 'undefined' && /CriOS\//.test(navigator.userAgent);
}

const FRAME_LABEL: Record<FrameKind, string> = { poster: 'Постер', vertical: 'Вертикаль', layout: 'Розкладка', clean: 'Чисте тло' };

// Правка 8 (22.09): без фото Постер/Вертикаль/Розкладка — теж у каруселі, із
// заглушкою (render.ts малює її сам за img=null); лише «Чисте тло» не
// залежить від фото взагалі. Порядок той самий, є фото чи нема.
//
// Хотфікс (прод, 22.09): «Вертикаль» БЕЗУМОВНО в ролі — раніше зникала, коли
// назва не влазила в 1 рядок на 96/72px («3 / 3» замість «4 / 4» на довгих
// назвах). Тепер fitVerticalLayout (frame.ts) завжди дає валідний розклад
// (перенос до 2 рядків, менший кегль, у крайньому разі «…»), кадр ніколи не
// «нема» — тому список кадрів більше не залежить від назви, статичний.
const FRAMES: FrameKind[] = ['poster', 'vertical', 'layout', 'clean'];

// Масштаб і зсув зберігаються РАЗОМ (одна пара на run) — правка 22.09 (п.6):
// кроп більше не лише вертикальний зсув, а й пінч-масштаб 1–3×.
function cropStorageKey(runId: string): string { return `share-crop:${runId}`; }
function loadCrop(runId: string | null): CropState {
  if (!runId) return resetCrop();
  try {
    const v = sessionStorage.getItem(cropStorageKey(runId));
    if (!v) return resetCrop();
    const parsed = JSON.parse(v) as Partial<CropState> | null;
    return clampCrop({ scale: parsed?.scale ?? 1, x: parsed?.x ?? 0.5, y: parsed?.y ?? 0.5 });
  } catch { return resetCrop(); }
}
function saveCrop(runId: string | null, crop: CropState): void {
  if (!runId) return;
  try { sessionStorage.setItem(cropStorageKey(runId), JSON.stringify(crop)); } catch { /* приватний режим — тихо */ }
}

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.dataset.theme === 'dark' || (!el.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches)));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function SharePage() {
  const { recipe_id } = useParams<{ recipe_id: string }>();
  const [searchParams] = useSearchParams();
  const runParam = searchParams.get('run');
  const navigate = useNavigate();
  const isDark = useDarkTheme();

  // Правка 22.09 (фікс 4): /share тепер під тим самим Shell, що /pantry —
  // на ≥768 це й треба (сайдбар). На <768 Shell домальовує нижній таббар
  // (TabBar.tsx `.bar`), якого тут раніше не було — «як є, повноекранно»
  // для мобільного не про сайдбар, а саме про це; гасимо тільки .bar,
  // лише на вузькому екрані (TabBar.module.css).
  useEffect(() => {
    document.body.classList.add('share-full-mobile');
    return () => document.body.classList.remove('share-full-mobile');
  }, []);

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [run, setRun] = useState<CookRunWithRecipe | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [telegramLinked, setTelegramLinked] = useState(false);

  useEffect(() => {
    if (!recipe_id) { void navigate('/app', { replace: true }); return; }
    let alive = true;
    setLoadState('loading');
    void (async () => {
      try {
        const [recipeRes, runsRes, me] = await Promise.all([
          api.savedRecipes.get(recipe_id),
          api.cookRuns.list(recipe_id),
          api.me(),
        ]);
        if (!alive) return;
        setRecipe(recipeRes.recipe);
        setRun(pickCookRun(runsRes.runs, recipe_id, runParam));
        setTelegramLinked(me.telegram_linked ?? false);
        setLoadState('ready');
      } catch {
        if (alive) setLoadState('error');
      }
    })();
    return () => { alive = false; };
  }, [recipe_id, runParam, navigate]);

  // Фото: з живого запису журналу (може бути замінене цією сесією).
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  useEffect(() => { setPhotoUrl(run?.photo_url ?? null); }, [run]);
  const photoImgRef = useRef<HTMLImageElement | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  useEffect(() => {
    setPhotoReady(false);
    photoImgRef.current = null;
    if (!photoUrl) return;
    const img = new Image();
    img.onload = () => { photoImgRef.current = img; setPhotoReady(true); };
    img.src = photoUrl;
    return () => { img.onload = null; };
  }, [photoUrl]);

  // Кроп: масштаб 1–3× + зсув по обох осях, sessionStorage на run.
  const runId = run?.id ?? null;
  const [crop, setCrop] = useState<CropState>(() => loadCrop(runId));
  useEffect(() => { setCrop(loadCrop(runId)); }, [runId]);
  const [cropTouched, setCropTouched] = useState(false);
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  const frameData: FrameData | null = useMemo(() => recipe ? frameDataOf(recipe, run?.finished_at) : null, [recipe, run]);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => { setActiveIdx((i) => Math.min(i, FRAMES.length - 1)); }, []);
  const activeKind = FRAMES[activeIdx] ?? 'clean';
  const activeKindRef = useRef(activeKind);
  activeKindRef.current = activeKind;
  // Заглушка: активний кадр photo-based (постер/вертикаль), фото нема —
  // не шериться, тап відкриває вибір файлу замість перетягування кропу.
  const isPlaceholder = !photoUrl && activeKind !== 'clean';

  // Полотна — по одному на доступний рендерер; ті самі елементи служать і
  // карусельним пунктом на 390, і великим прев'ю на 1440 (CSS перемикає
  // розмір/показ), тому малюються один раз незалежно від ширини екрана.
  const canvasRefs = useRef<Partial<Record<FrameKind, HTMLCanvasElement | null>>>({});
  const thumbRefs = useRef<Partial<Record<FrameKind, HTMLCanvasElement | null>>>({});
  const [ready, setReady] = useState(false);

  // Малює ВСІ канвaси (прев'ю й мініатюри) — без PNG-кодування. Правка 9:
  // раніше той самий цикл ще й пакував активний кадр у toBlob() тут-таки —
  // на кожен рух кропу (кожен pointermove) це перекодовувало 1080×1920 і
  // кнопка «Поділитись» блимала «Готуємо кадр…» посеред жесту. Прев'ю й
  // PNG розведено: прев'ю малюється завжди одразу (тут), PNG — синхронно
  // в момент натискання (canvasToBlobSync нижче, у share/download/telegram).
  const redrawAll = useCallback(async (): Promise<void> => {
    if (!frameData) return;
    await document.fonts.ready;
    for (const kind of FRAMES) {
      const canvas = canvasRefs.current[kind];
      if (!canvas) continue;
      canvas.width = FRAME_W; canvas.height = FRAME_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const cleanTheme = isDark ? CLEAN_DARK : CLEAN_LIGHT;
      if (kind === 'clean') {
        drawClean(ctx, frameData, cleanTheme);
      } else if (kind === 'poster') {
        drawPoster(ctx, frameData, photoImgRef.current, crop, cleanTheme);
      } else if (kind === 'vertical') {
        drawVertical(ctx, frameData, photoImgRef.current, crop, cleanTheme);
      } else {
        drawLayout(ctx, frameData, photoImgRef.current, crop, cleanTheme);
      }
      const thumb = thumbRefs.current[kind];
      if (thumb) {
        thumb.width = 220; thumb.height = 392;
        const tctx = thumb.getContext('2d');
        tctx?.drawImage(canvas, 0, 0, 220, 392);
      }
    }
  }, [frameData, isDark, crop]);

  // ── Кроп: перетягування (обидві осі), пінч і колесо (масштаб 1–3×).
  // Кілька активних pointerId одразу (Pointer Events дають кожному пальцю
  // свій id) — 2 пальці = пінч, 1 — перетягування; перехід між ними скасовує
  // drag/pinch-стан.
  //
  // Правка 22.09 (п.14): тап по прев'ю тепер перемикає кадр (замість
  // свайпу каруселі) — подвійний тап/клік більше не може скидати кроп
  // (конфлікт з одинарним тапом), скидання — окрема кнопка «Скинути кадр»
  // нижче. Тап відрізняється від drag зсувом (<8px) і часом (<300мс) від
  // pointerdown до pointerup — рахується НЕЗАЛЕЖНО від того, чи взагалі
  // можливий кроп на цьому кадрі (заглушка/«Чисте тло» теж перемикаються
  // тапом). tapRef обнуляється, щойно зʼявляється другий палець (пінч —
  // не тап, навіть короткий). ──
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragRef = useRef<{ startX: number; startY: number; startCrop: CropState; w: number; h: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  function resetCropNow(): void {
    const next = resetCrop();
    setCropTouched(true);
    setCrop(next);
    saveCrop(runId, next);
  }
  function advanceFrame(): void {
    setActiveIdx((i) => (i + 1) % FRAMES.length);
  }

  function onCropPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    tapRef.current = pointersRef.current.size === 0 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
    if (!photoImgRef.current || activeKind === 'clean') return;
    const el = e.currentTarget;
    (el as HTMLCanvasElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      dragRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { startDist: Math.hypot(a!.x - b!.x, a!.y - b!.y), startScale: cropRef.current.scale };
      return;
    }
    if (pointersRef.current.size > 2) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startCrop: crop, w: el.clientWidth, h: el.clientHeight };
  }
  function onCropPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const ratio = dist / Math.max(1, pinchRef.current.startDist);
      setCropTouched(true);
      setCrop((c) => clampCrop({ ...c, scale: pinchRef.current!.startScale * ratio }));
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    // Пряма маніпуляція (правка 22.09, п.10): фото йде ЗА пальцем/курсором.
    const next = applyCropDrag(d.startCrop, dx, dy, d.w, d.h);
    setCropTouched(true);
    setCrop(next);
  }
  function onCropPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      saveCrop(runId, cropRef.current);
    }
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap) return;
    const dist = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
    const elapsed = Date.now() - tap.t;
    if (dist < 8 && elapsed < 300) advanceFrame();
  }
  // React додає onWheel як passive listener — e.preventDefault() у ньому
  // мовчки нічого не робить (сторінка все одно скролиться під час зуму
  // колесом). Нативний addEventListener(..., {passive:false}) на самому
  // canvas-елементі — єдиний спосіб; прив'язка — через cleanup-функцію
  // ref-колбека (React 19), не ручний remove/add за попереднім значенням
  // рефа: останнє мовчки лишало старий passive-слухач активним при частій
  // переприв'язці рефа (кожен рендер — нова ідентичність інлайн-колбека).
  // Стабільний useCallback з порожніми deps: читає лише з рефів.
  const onCropWheelNative = useCallback((e: WheelEvent) => {
    if (!photoImgRef.current || activeKindRef.current === 'clean') return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setCropTouched(true);
    const next = clampCrop({ ...cropRef.current, scale: cropRef.current.scale + delta });
    setCrop(next);
    saveCrop(runIdRef.current, next);
  }, []);
  // ── Фото: замінити/додати ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  async function onPickPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (/^image\/heic|^image\/heif/.test(file.type) || /\.heic$|\.heif$/i.test(file.name)) {
      setPhotoErr('Цей формат не підтримується — обери JPEG');
      return;
    }
    setPhotoErr(null);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      setPhotoErr('Не вдалось прочитати фото. Спробуй інше.');
      return;
    }
    const off = document.createElement('canvas');
    off.width = bitmap.width; off.height = bitmap.height;
    off.getContext('2d')!.drawImage(bitmap, 0, 0);
    const localUrl = off.toDataURL('image/jpeg', 0.92);
    setPhotoUrl(localUrl);
    setCrop(resetCrop());
    setCropTouched(false);
    if (!run) return; // без запису — фото живе лише в кадрі цієї сесії (spec §2)
    setSavingPhoto(true);
    try {
      const uploaded = await api.attachments.upload(file);
      await api.cookRuns.setPhoto(run.id, uploaded.url);
      track('share', { frame: activeKind, via: 'photo', photo: true, w: window.innerWidth });
    } catch {
      setPhotoErr('Фото не збереглось. Спробуй ще раз або обери інше.');
    } finally {
      setSavingPhoto(false);
    }
  }

  function fileName(): string {
    return `kitchen-os-${(recipe?.t ?? 'recipe').toLowerCase().replace(/\s+/g, '-')}.png`;
  }
  useEffect(() => {
    let cancelled = false;
    // Правка 9: НЕ скидаємо ready на false тут — redrawAll перемальовує
    // прев'ю на кожен рух кропу (crop у його ідентичності), і скидання
    // ready на кожен такий виклик знову блимало б «Готуємо кадр…» на
    // кнопці посеред жесту. ready стає true один раз, після ПЕРШОГО
    // малювання, і лишається true — «зайнято» видно лише на початковому
    // завантаженні.
    void redrawAll().then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [redrawAll, photoReady]);

  // PNG активного кадру — СИНХРОННО, у момент натискання (правка 9), не
  // заздалегідь на кожен рух кропу. canvas.toDataURL сам по собі синхронний;
  // атоб+Uint8Array перетворює base64 у Blob теж без жодного await — увесь
  // ланцюжок клацання лишається синхронним (PR #181: navigator.share/a.click
  // губить активацію жесту на iOS Chrome, якщо перед викликом був await).
  function canvasToBlobSync(canvas: HTMLCanvasElement): Blob {
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }
  function activePngBlob(): Blob | null {
    const canvas = canvasRefs.current[activeKind];
    if (!canvas || !ready) return null;
    return canvasToBlobSync(canvas);
  }

  const [busy, setBusy] = useState<'share' | 'telegram' | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [telegramSent, setTelegramSent] = useState(false);
  const [telegramError, setTelegramError] = useState(false);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);
  const shareUrl = recipe_id ? `${window.location.origin}/r/${recipe_id}` : '';
  const shareUrlDisplay = shareUrl.replace(/^https?:\/\//, '');

  function downloadBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    if (isIOSChrome()) {
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    const a = document.createElement('a');
    a.href = url; a.download = fileName(); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // activePngBlob() синхронний (canvasToBlobSync) — жодного await до жесту (PR #181).
  function share(): void {
    setShareError(false);
    const blob = activePngBlob();
    if (!blob) return;
    const file = new File([blob], fileName(), { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) { downloadBlob(blob); trackShare('save'); return; }
    setBusy('share');
    navigator.share({ files: [file] })
      .then(() => { setBusy(null); trackShare('share'); })
      .catch((err: unknown) => {
        setBusy(null);
        const name = (err as { name?: string } | null)?.name;
        if (name === 'AbortError') return;
        captureClientIncident('share-failed', { name, message: (err as Error | null)?.message });
        setShareError(true);
        downloadBtnRef.current?.focus();
      });
  }
  function download(): void {
    const blob = activePngBlob();
    if (!blob) return;
    downloadBlob(blob);
    trackShare('save');
  }
  function trackShare(via: 'share' | 'save' | 'telegram' | 'copy_link'): void {
    track('share', { frame: activeKind, via, photo: !!photoUrl, w: window.innerWidth });
  }
  // Копіювання рядком execCommand — фолбек, коли navigator.clipboard відмовляє
  // (NotAllowedError: не-https, iframe, стара Safari). Тимчасовий textarea
  // поза екраном, виділити, execCommand('copy') — синхронний старий API,
  // працює там, де Clipboard API нема чи заборонений.
  function legacyCopy(text: string): boolean {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  async function copyLink(): Promise<void> {
    setCopyFailed(false);
    let ok = false;
    try {
      await navigator.clipboard.writeText(shareUrl);
      ok = true;
    } catch {
      ok = legacyCopy(shareUrl);
    }
    if (ok) {
      setCopied(true);
      trackShare('copy_link');
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  }
  async function sendTelegram(): Promise<void> {
    const blob = activePngBlob();
    if (!blob || !recipe_id) return;
    setBusy('telegram');
    setTelegramError(false);
    try {
      // Подію 'share' {via:'telegram'} пише сервер сам (routes/share.ts) — тут не дублюємо.
      await api.share.telegram(blob, recipe_id, activeKind);
      setTelegramSent(true);
    } catch {
      setTelegramError(true);
    } finally {
      setBusy(null);
    }
  }

  if (loadState === 'loading') {
    return <div className={styles.screen} data-share-page><div className={styles.skeleton} aria-hidden /></div>;
  }
  if (loadState === 'error' || !recipe) {
    return (
      <div className={styles.screen} data-share-page>
        <div className={styles.empty}>
          <h3>Не вдалось відкрити</h3>
          <p>Рецепт міг зникнути або більше не твій.</p>
          <button type="button" className={styles.shareBtn} onClick={() => navigate('/app')}>У стрічку</button>
        </div>
      </div>
    );
  }

  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  return (
    <div className={styles.screen} data-share-page data-loaded={ready || undefined}>
      <header className={styles.top}>
        <button type="button" className={styles.back} onClick={() => navigate(-1)} aria-label="Назад" data-share-back>
          <Icon name="sys.back" size={20} inherit decorative />
        </button>
        <span className={styles.title}>Поділитись</span>
        <span className={styles.titleRecipe}>· {recipe.t}</span>
      </header>

      <div className={styles.body}>
        <div className={styles.previewCol}>
          <div className={styles.carousel} data-frame-count={FRAMES.length}>
            {FRAMES.map((kind) => (
              <div key={kind} className={styles.frameSlot} data-frame-slot={kind} data-active={kind === activeKind || undefined}>
                <canvas
                  ref={(el) => {
                    canvasRefs.current[kind] = el;
                    if (!el) return;
                    el.addEventListener('wheel', onCropWheelNative, { passive: false });
                    return () => el.removeEventListener('wheel', onCropWheelNative);
                  }}
                  className={styles.frameCanvas}
                  data-frame={kind}
                  data-selected={kind === activeKind || undefined}
                  data-placeholder={(!photoUrl && kind !== 'clean') || undefined}
                  aria-label={FRAME_LABEL[kind]}
                  onPointerDown={onCropPointerDown}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={onCropPointerUp}
                  onPointerCancel={onCropPointerUp}
                />
              </div>
            ))}
          </div>
          {/* Мобільна підказка — під каруселлю (як була); десктопна версія —
              перший рядок правої колонки, див. .actionsCol нижче (правка 7). */}
          {photoUrl && !cropTouched && activeKind !== 'clean' && (
            <span className={styles.cropHint}>Потягни фото, щоб підібрати кадр</span>
          )}
          <div className={styles.frameRow}>
            <span className={styles.frameLabel}>{FRAME_LABEL[activeKind]}{activeKind === 'poster' && photoUrl ? ' · з фото' : ''}</span>
            {FRAMES.length > 1 && (
              <span className={styles.frameCounter} data-frame-counter>{activeIdx + 1} / {FRAMES.length}</span>
            )}
            <span className={styles.frameRowRight}>
              {!isCropDefault(crop) && (
                <button type="button" className={styles.resetCrop} onClick={resetCropNow} data-reset-crop="mobile">Скинути кадр</button>
              )}
              <button type="button" className={`${styles.replacePhoto} ${!photoUrl ? styles.replacePhotoAdd : ''}`} onClick={() => fileInputRef.current?.click()} disabled={savingPhoto} data-pick-photo>
                <Icon name="sys.photo" size={16} inherit decorative />{photoUrl ? 'Замінити фото' : 'Додати фото'}
              </button>
            </span>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void onPickPhoto(e.target.files)} />
          {photoErr && <div className={styles.photoErr} data-photo-error>{photoErr}</div>}
        </div>

        {/* Права колонка на ≥768 — ОДНА (360), усе стеком: підказка → КАДР
            + мініатюри → «Замінити фото» → дії → рядок лінка (правка 7,
            мокет «/share 1440»). На <768 .thumbCol/.cropHintSide лишаються
            приховані (display:none поза медіа-запитом) — мобільний вигляд
            не змінився. */}
        <div className={styles.actionsCol}>
          {photoUrl && !cropTouched && activeKind !== 'clean' && (
            <span className={styles.cropHintSide}>Потягни фото, щоб підібрати кадр</span>
          )}
          <div className={styles.thumbCol} aria-hidden={FRAMES.length < 2}>
            <span className={styles.thumbLabel}>КАДР</span>
            <div className={styles.thumbs}>
              {FRAMES.map((kind, i) => (
                <button key={kind} type="button" className={styles.thumbBtn} data-thumb={kind} data-selected={i === activeIdx || undefined} data-placeholder={(!photoUrl && kind !== 'clean') || undefined} onClick={() => setActiveIdx(i)}>
                  <canvas ref={(el) => { thumbRefs.current[kind] = el; }} className={styles.thumbCanvas} />
                  <span className={styles.thumbTag}>{FRAME_LABEL[kind]}</span>
                </button>
              ))}
            </div>
            <span className={styles.thumbColActions}>
              {!isCropDefault(crop) && (
                <button type="button" className={styles.resetCropDesktop} onClick={resetCropNow} data-reset-crop="desktop">Скинути кадр</button>
              )}
              <button type="button" className={styles.replacePhotoDesktop} onClick={() => fileInputRef.current?.click()} disabled={savingPhoto}>
                <Icon name="sys.photo" size={16} inherit decorative />{photoUrl ? 'Замінити фото' : 'Додати фото'}
              </button>
            </span>
          </div>

          <div className={styles.mobileActions}>
            {isPlaceholder ? (
              // Заглушка (правка 8): не шериться — головна кнопка сама
              // відкриває вибір файлу, System share/«Завантажити» недоступні.
              <button type="button" className={styles.shareBtn} onClick={() => fileInputRef.current?.click()} disabled={savingPhoto} data-add-photo>
                <Icon name="sys.photo" size={16} inherit decorative />Додати фото
              </button>
            ) : canSystemShare ? (
              <button type="button" className={styles.shareBtn} onClick={share} disabled={busy !== null || !ready} data-share>
                <Icon name="sys.share" size={16} inherit decorative />{!ready || busy === 'share' ? 'Готуємо кадр…' : 'Поділитись'}
              </button>
            ) : (
              // Без navigator.canShare (десктопний Chrome, деякі Android) —
              // єдина кнопка сама зберігає, тож підпис каже саме це, а не
              // «Поділитись»: окремий квадрат «Завантажити» тут не показуємо
              // (нижче), щоб не було двох однакових дій.
              <button type="button" className={styles.shareBtn} onClick={download} disabled={!ready} data-share>
                <Icon name="sys.import" size={16} inherit decorative />{!ready ? 'Готуємо кадр…' : 'Зберегти'}
              </button>
            )}
            {!isPlaceholder && canSystemShare && (
              <button ref={downloadBtnRef} type="button" className={styles.downloadBtn} onClick={download} disabled={!ready} aria-label="Завантажити PNG" title="Завантажити PNG" data-download>
                <Icon name="sys.import" size={16} inherit decorative />
              </button>
            )}
          </div>

          {isPlaceholder ? (
            <div className={styles.desktopActions}>
              <button type="button" className={styles.tgBtn} onClick={() => fileInputRef.current?.click()} disabled={savingPhoto} data-add-photo>
                <Icon name="sys.photo" size={16} inherit decorative />Додати фото
              </button>
            </div>
          ) : telegramLinked ? (
            <div className={styles.desktopActions}>
              <button type="button" className={styles.tgBtn} onClick={() => void sendTelegram()} disabled={busy !== null || !ready} data-send-telegram>
                <Icon name="sys.share" size={16} inherit decorative />{busy === 'telegram' ? 'Надсилаю…' : 'Надіслати в Telegram'}
              </button>
              <button type="button" className={styles.savePngBtn} onClick={download} disabled={!ready} data-save-png>
                <Icon name="sys.import" size={16} inherit decorative />Зберегти PNG
              </button>
              {telegramSent && <span className={styles.sentHint} data-telegram-sent>Надіслано в Telegram — збережи в галерею з телефона.</span>}
              {telegramError && <span className={styles.photoErr} data-telegram-error>Не вдалося надіслати. Спробуй ще раз.</span>}
            </div>
          ) : (
            <div className={styles.desktopActions}>
              <button type="button" className={styles.tgBtn} onClick={download} disabled={!ready} data-save-png>
                <Icon name="sys.import" size={16} inherit decorative />Зберегти PNG
              </button>
              <span className={styles.hintMuted}>Звʼяжи Telegram у профілі — кадр можна буде надіслати собі в чат одним тапом.</span>
            </div>
          )}

          {shareError && <div className={styles.photoErr} data-share-error>Не вдалось відкрити меню — збережи PNG</div>}

          <button type="button" className={styles.linkRow} onClick={() => void copyLink()} data-copy-link>
            <span className={styles.linkText}>{shareUrlDisplay}</span>
            <Icon name={copied ? 'sys.done' : 'sys.copy'} size={16} inherit decorative />
            {copied && <span className={styles.linkCopied}>Скопійовано ✓</span>}
            {copyFailed && <span className={styles.linkFailed} data-copy-failed>Не скопіювалось — виділи й скопіюй</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
