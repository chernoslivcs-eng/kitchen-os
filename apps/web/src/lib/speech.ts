// Голосовий ввід — Web Speech API. Прототип зафіксував голос як точку входу,
// але в пісочниці API недоступний; тут він нарешті живий.
//
// Прогресивне покращення: якщо браузер не вміє (Firefox) — кнопки мікрофона
// просто немає. Мова uk-UA; interim-результати показуємо одразу, щоб людина
// бачила, що її чують, а фіналізуємо на onresult(final).

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

/**
 * Один сеанс диктування. onText отримує накопичений текст (interim включно),
 * onDone — фінальний текст, onEnd — кінець сеансу з будь-якої причини.
 */
export function startDictation(handlers: {
  onText: (text: string) => void;
  onDone: (text: string) => void;
  onEnd: () => void;
}): Dictation | null {
  const C = ctor();
  if (!C) return null;
  const rec = new C();
  rec.lang = 'uk-UA';
  rec.interimResults = true;
  // QA9-07: continuous=false обривав сеанс на першій паузі — людина ще
  // говорить, а мікрофон уже здався. Тепер сеанс живе, поки не натиснуто
  // стоп (або браузер сам не закриє по довгій тиші — onend відпрацює).
  rec.continuous = true;

  let finalText = '';
  rec.onresult = (e) => {
    // QA9-07: перебудова З НУЛЯ на кожній події, а не резервуар += з
    // resultIndex. Chrome (особливо Android) переграє фінальні результати —
    // накопичення дублювало слова, а поле «замінювалось останнім словом».
    // e.results завжди тримає ВСІ результати сеансу — читаємо їх усі.
    let final = '';
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) final += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    finalText = final.replace(/\s+/g, ' ').trim();
    handlers.onText((finalText + ' ' + interim).replace(/\s+/g, ' ').trim());
  };
  rec.onend = () => {
    if (finalText.trim()) handlers.onDone(finalText.trim());
    handlers.onEnd();
  };
  rec.onerror = () => { /* onend прийде слідом — там і приберемось */ };

  try { rec.start(); } catch { return null; }
  return { stop: () => { try { rec.stop(); } catch { /* вже зупинено */ } } };
}
