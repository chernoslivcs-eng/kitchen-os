import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Хотфікс 11.09 (шрифт на проді): CSP у vercel.json (style-src 'self'
// 'unsafe-inline'; font-src 'self') мовчки блокував css2 із
// fonts.googleapis.com, підключений в index.html, — на проді document.fonts
// був порожній, усе йшло в system-ui. Локально не видно: заголовки
// vercel.json діють лише на Vercel; 200-ки й греп бандла шрифт не бачать.
// Гейт, а не пильність: кожен зовнішній <link rel=stylesheet> / preload
// шрифту / <script src> в index.html і кожен url(https://…) у @font-face чи
// @import у CSS мусить бути дозволений відповідною директивою CSP.

const WEB = fileURLToPath(new URL('../..', import.meta.url));
const ROOT = join(WEB, '..', '..');

function csp(): Record<string, string[]> {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
  const h = cfg.headers.flatMap((x) => x.headers).find((x) => x.key === 'Content-Security-Policy');
  if (!h) throw new Error('vercel.json: Content-Security-Policy не знайдено');
  const out: Record<string, string[]> = {};
  for (const part of h.value.split(';')) {
    const [name, ...src] = part.trim().split(/\s+/);
    if (name) out[name] = src;
  }
  return out;
}

/** Чи дозволяє директива цей origin. 'self' — лише свій домен; https: — усі. */
function allows(sources: string[] | undefined, fallback: string[] | undefined, url: string): boolean {
  const list = sources ?? fallback ?? [];
  const origin = new URL(url).origin;
  return list.some((s) => {
    const v = s.replace(/^'|'$/g, '');
    if (v === 'https:' || v === '*') return true;
    if (v.startsWith('https://') || v.startsWith('http://')) {
      if (v.includes('*')) return new RegExp('^' + v.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+') + '$').test(origin);
      return v.replace(/\/$/, '') === origin;
    }
    return false;
  });
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : cssFiles(p);
    return name.endsWith('.css') ? [p] : [];
  });
}

describe('CSP проду дозволяє все, що підключає index.html і CSS', () => {
  const policy = csp();
  const dflt = policy['default-src'];

  it('index.html: зовнішні стилі, шрифти, скрипти — лише дозволені CSP', () => {
    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    const offenders: string[] = [];
    for (const m of html.matchAll(/<(link|script)\b([^>]*)>/g)) {
      const attrs = m[2]!;
      const href = attrs.match(/(?:href|src)="(https?:\/\/[^"]+)"/)?.[1];
      if (!href) continue;
      const rel = attrs.match(/rel="([^"]+)"/)?.[1] ?? '';
      const as = attrs.match(/\bas="([^"]+)"/)?.[1] ?? '';
      let dir: string | null = null;
      if (m[1] === 'script') dir = 'script-src';
      else if (rel.includes('stylesheet') || as === 'style') dir = 'style-src';
      else if (as === 'font') dir = 'font-src';
      else if (as === 'script') dir = 'script-src';
      else if (rel.includes('preconnect') || rel.includes('dns-prefetch')) dir = null; // саме по собі нічого не вантажить
      if (dir && !allows(policy[dir], dflt, href)) offenders.push(`${dir} ← ${href}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('CSS: url(https://…) у @font-face і @import — лише дозволені font-src / style-src', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(join(WEB, 'src'))) {
      const css = readFileSync(file, 'utf8');
      for (const m of css.matchAll(/@import\s+(?:url\()?['"]?(https?:\/\/[^'")\s;]+)/g)) {
        if (!allows(policy['style-src'], dflt, m[1]!)) offenders.push(`${relative(WEB, file)}: style-src ← ${m[1]}`);
      }
      for (const face of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        for (const u of face[1]!.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+)/g)) {
          if (!allows(policy['font-src'], dflt, u[1]!)) offenders.push(`${relative(WEB, file)}: font-src ← ${u[1]}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('Onest підключено своїм доменом: @font-face у tokens.css і файли в public/fonts', () => {
    const css = readFileSync(join(WEB, 'src/styles/tokens.css'), 'utf8');
    const urls = [...css.matchAll(/@font-face\s*\{[^}]*url\('(\/fonts\/[^']+)'\)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const u of urls) expect(() => statSync(join(WEB, 'public', u)), u).not.toThrow();
    expect(statSync(join(WEB, 'public/fonts/OFL.txt')).size).toBeGreaterThan(0);
  });
});
