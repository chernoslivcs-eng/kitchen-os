// Мінімальний рендер markdown без зовнішньої бібліотеки — для юридичних
// документів (legal/*.md): h1/h2, абзац, **жирне**, *курсив*, [текст](url),
// список `- `, таблиця `| … |`, риска `---`. Саме ці конструкції й тільки
// вони зустрічаються в OFFER/PRIVACY/REFUND/CONTACTS — розширювати про запас
// не треба.
//
// *курсив* у цих файлах іноді огортає весь абзац разом із посиланнями
// всередині (закриваючий рядок кожного документа) — тому інлайн-парсер
// рекурсивний: вміст **/​* парситься вкладено, а не як текст, що містить
// невідкриті `[text](url)`.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './Markdown.module.css';

type Block =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'hr' }
  | { type: 'table'; header: string[]; rows: string[][] };

function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.includes('-') && /^[|:\-\s]+$/.test(t);
}

function splitTableRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((cell) => cell.trim());
}

function isBlockStart(line: string, next: string | undefined): boolean {
  if (line.trim() === '' || line.trim() === '---') return true;
  if (line.startsWith('# ') || line.startsWith('## ')) return true;
  if (line.startsWith('- ')) return true;
  if (line.trim().startsWith('|') && next !== undefined && isSeparatorRow(next)) return true;
  return false;
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; continue; }
    if (line.trim() === '---') { blocks.push({ type: 'hr' }); i++; continue; }
    if (line.startsWith('# ')) { blocks.push({ type: 'h1', text: line.slice(2).trim() }); i++; continue; }
    if (line.startsWith('## ')) { blocks.push({ type: 'h2', text: line.slice(3).trim() }); i++; continue; }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) { items.push(lines[i]!.slice(2).trim()); i++; }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (line.trim().startsWith('|') && isSeparatorRow(lines[i + 1] ?? '')) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) { rows.push(splitTableRow(lines[i]!)); i++; }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const paraLines: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i]!, lines[i + 1])) { paraLines.push(lines[i]!); i++; }
    blocks.push({ type: 'p', text: paraLines.join(' ') });
  }
  return blocks;
}

export interface MarkdownProps {
  text: string;
  /** Файл-посилання (`OFFER.md`) → внутрішній маршрут (`/terms`); null — зовнішнє. */
  resolveHref?: (href: string) => string | null;
  /** `state`, з яким летить кожен внутрішній `<Link>` — щоб закриття попапу знало, куди повертатись. */
  linkState?: unknown;
}

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\)/g;

// matchAll (не exec+lastIndex): renderInline рекурсивний — курсив, що огортає
// посилання, парситься вкладеним викликом на тому самому модульному INLINE.
// Спільний lastIndex на двох активних проходах одного regex псує позицію
// зовнішнього циклу (регекс з невдалим exec сам скидає lastIndex на 0 —
// зовнішній цикл після цього застрягає на тому самому збігу нескінченно).
// matchAll клонує regex на кожен виклик (спека), тому вкладені виклики не
// заважають один одному.
function renderInline(text: string, resolveHref: ((href: string) => string | null) | undefined, linkState: unknown, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(m[1], resolveHref, linkState, key)}</strong>);
    } else if (m[2] !== undefined) {
      nodes.push(<em key={key}>{renderInline(m[2], resolveHref, linkState, key)}</em>);
    } else {
      const linkText = m[3]!;
      const href = m[4]!;
      const to = resolveHref?.(href) ?? null;
      if (to) {
        nodes.push(<Link key={key} to={to} state={linkState} className={styles.link}>{linkText}</Link>);
      } else {
        nodes.push(<a key={key} href={href} target="_blank" rel="noreferrer" className={styles.link}>{linkText}</a>);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlock(block: Block, i: number, resolveHref: ((href: string) => string | null) | undefined, linkState: unknown): ReactNode {
  const key = `b${i}`;
  switch (block.type) {
    case 'h1':
      return <h1 key={key} className={styles.h1}>{renderInline(block.text, resolveHref, linkState, key)}</h1>;
    case 'h2':
      return <h2 key={key} className={styles.h2}>{renderInline(block.text, resolveHref, linkState, key)}</h2>;
    case 'hr':
      return <hr key={key} className={styles.hr} />;
    case 'ul':
      return (
        <ul key={key} className={styles.ul}>
          {block.items.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, resolveHref, linkState, `${key}-${j}`)}</li>)}
        </ul>
      );
    case 'table':
      return (
        <div key={key} className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>{block.header.map((cell, j) => <th key={j}>{renderInline(cell, resolveHref, linkState, `${key}-h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, j) => (
                <tr key={j}>{row.map((cell, k) => <td key={k}>{renderInline(cell, resolveHref, linkState, `${key}-${j}-${k}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'p':
      return <p key={key} className={styles.p}>{renderInline(block.text, resolveHref, linkState, key)}</p>;
  }
}

export function Markdown({ text, resolveHref, linkState }: MarkdownProps) {
  const blocks = parseBlocks(text);
  return <div className={styles.doc}>{blocks.map((b, i) => renderBlock(b, i, resolveHref, linkState))}</div>;
}
