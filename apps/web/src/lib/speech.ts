// Голосовий ввід — Web Speech API. Прототип зафіксував голос як точку входу,
// але в пісочниці API недоступний; тут він нарешті живий.
//
// Прогресивне покращення: якщо браузер не вміє (Firefox) — кнопки мікрофона
// просто немає. Мова uk-UA; interim-результати показуємо одразу, щоб людина
// бачила, що її чують.
//
// UX9-05..08 (звіт частина 1): попередня версія (а) вмирала на першій паузі —
// браузер закриває сеанс подією end, рестарту не було; (б) була вразлива до
// «results містить лише новий результат» (Android Chrome) — поле затиралось
// останнім словом; (в) мовчала на not-allowed/no-speech/network. Тепер:
// накопичення через сеанси + авто-рестарт до явного стопу + onError.

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

export interface Dictation {
  stop(): void;
}

// Людські пояснення фатальних відмов. Все інше (no-speech, aborted) — робочі
// моменти: сеанс перезапуститься через onend.
const FATAL_ERRORS: Record<string, string> = {
  'not-allowed': 'Мікрофон заборонений — дозволь доступ у налаштуваннях браузера.',
  'service-not-allowed': 'Розпізнавання мови вимкнене в цьому браузері.',
  'audio-capture': 'Мікрофон не знайдено.',
  'network': 'Розпізнавання зараз недоступне — перевір мережу.',
};

/**
 * Один сеанс диктування (з погляду людини). Під капотом браузер може закривати
 * розпізнавання на паузах — ми перезапускаємо його, доки не натиснуто стоп.
 * onText отримує накопичений текст (interim включно), onDone — фінальний,
 * onEnd — кінець сеансу з будь-якої причини, onError — людське пояснення
 * фатальної відмови (після нього прийде і onEnd).
 */
export function startDictation(handlers: {
  onText: (text: string) => void;
  onDone: (text: string) => void;
  onEnd: () => void;
  onError?: (message: string) => void;
}): Dictation | null {
  const C = ctor();
  if (!C) return null;

  let stopped = false;          // людина натиснула стоп або фатальна помилка
  let accumulated = '';         // фінали ПОПЕРЕДНІХ сеансів розпізнавання
  let sessionFinal = '';        // фінали поточного сеансу
  let rec: SpeechRecognitionLike | null = null;

  // Пул-5 №4: захист від дублювання. (а) Після авто-рестарту деякі браузери
  // (iOS Safari) віддають ПОВНИЙ транскрипт знову — якщо новий сеанс уже
  // містить накопичене як префікс, він ЗАМІНЮЄ накопичене, а не додається.
  const compose = (interim = '') => {
    const a = accumulated.trim();
    const s = sessionFinal.trim();
    let base: string;
    if (!a) base = s;
    else if (!s) base = a;
    else if (s === a || s.startsWith(`${a} `)) base = s;   // кумулятивний повтор
    else base = `${a} ${s}`;
    return `${base} ${interim}`.replace(/\s+/g, ' ').trim();
  };

  function spawn(): boolean {
    const r = new C!();
    r.lang = 'uk-UA';
    r.interimResults = true;
    r.continuous = true;
    sessionFinal = '';

    // Фінали — у Map за індексом результату: стійко до ОБОХ семантик
    // results (повний список і «тільки нове» з resultIndex-зсувом).
    const finals = new Map<number, string>();
    r.onresult = (e) => {
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finals.set(e.resultIndex + i, res[0].transcript);
        else interim += res[0].transcript;
      }
      // (б) iOS повторює той самий фінал під новими індексами — сусідні
      // ідентичні сегменти схлопуємо: людина, що двічі каже одне й те саме
      // РЕЧЕННЯ поспіль без паузи, у диктовці покупок не трапляється, а
      // браузерний дубль — постійно.
      const ordered = [...finals.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.trim()).filter(Boolean);
      const deduped: string[] = [];
      for (const seg of ordered) {
        if (deduped.length && deduped[deduped.length - 1] === seg) continue;
        deduped.push(seg);
      }
      sessionFinal = deduped.join(' ');
      handlers.onText(compose(interim));
    };

    r.onerror = (e) => {
      const fatal = e.error && FATAL_ERRORS[e.error];
      if (fatal) {
        stopped = true;
        handlers.onError?.(fatal);
      }
      // Нефатальне (no-speech, aborted) — нічого: onend перезапустить.
    };

    r.onend = () => {
      accumulated = compose();
      sessionFinal = '';
      if (stopped) {
        if (accumulated) handlers.onDone(accumulated);
        handlers.onEnd();
        return;
      }
      // UX9-07: браузер закрив сеанс на тиші — людина ще не закінчила.
      // Мовчки піднімаємо новий; кнопка лишається в стані «слухаю».
      if (!spawn()) {
        if (accumulated) handlers.onDone(accumulated);
        handlers.onEnd();
      }
    };

    try { r.start(); } catch { return false; }
    rec = r;
    return true;
  }

  if (!spawn()) return null;
  return {
    stop: () => {
      stopped = true;
      try { rec?.stop(); } catch { /* вже зупинено */ }
    },
  };
}
