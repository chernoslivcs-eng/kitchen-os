// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Markdown } from './Markdown';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(text: string, resolveHref?: (href: string) => string | null) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><Markdown text={text} resolveHref={resolveHref} linkState={{ background: 'x' }} /></MemoryRouter>);
  });
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('Markdown — мінімальний рендер юридичних документів', () => {
  it('h1, h2, абзац', async () => {
    await mount('# Заголовок\n\nАбзац тексту.\n\n## Розділ\n\nЩе абзац.');
    expect(host.querySelector('h1')!.textContent).toBe('Заголовок');
    expect(host.querySelector('h2')!.textContent).toBe('Розділ');
    expect(host.querySelectorAll('p').length).toBe(2);
    expect(host.querySelectorAll('p')[0]!.textContent).toBe('Абзац тексту.');
  });

  it('**жирне** і *курсив*', async () => {
    await mount('Це **важливо** і це *теж*.');
    expect(host.querySelector('strong')!.textContent).toBe('важливо');
    expect(host.querySelector('em')!.textContent).toBe('теж');
  });

  it('список `- `', async () => {
    await mount('- перший\n- другий\n- третій');
    const items = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['перший', 'другий', 'третій']);
  });

  it('риска ---', async () => {
    await mount('Перед.\n\n---\n\nПісля.');
    expect(host.querySelector('hr')).not.toBeNull();
  });

  it('таблиця з шапкою', async () => {
    await mount('| Поле | Значення |\n|---|---|\n| A | 1 |\n| B | 2 |');
    expect([...host.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Поле', 'Значення']);
    const rows = [...host.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([['A', '1'], ['B', '2']]);
  });

  it('[текст](FILE.md) резолвиться у внутрішній маршрут через <Link>, інакше — звичайний <a>', async () => {
    await mount('Читай [Політику](PRIVACY.md) і [зовнішнє](https://example.com).', (href) => (href === 'PRIVACY.md' ? '/privacy' : null));
    const internal = host.querySelector('a[href="/privacy"]');
    expect(internal, 'внутрішнє посилання веде на /privacy').not.toBeNull();
    expect(internal!.textContent).toBe('Політику');
    const external = host.querySelector('a[href="https://example.com"]');
    expect(external!.getAttribute('target')).toBe('_blank');
  });

  it('без (url) квадратні дужки — не посилання, а плейсхолдер-текст', async () => {
    await mount('Ціна на сторінці тарифів [посилання на сторінку тарифів].');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('[посилання на сторінку тарифів]');
  });

  it('*курсив, що огортає весь абзац із посиланням усередині* — посилання лишається клікабельним', async () => {
    await mount('*Частина [Оферти](OFFER.md), дочитай її.*', (href) => (href === 'OFFER.md' ? '/terms' : null));
    const em = host.querySelector('em')!;
    const link = em.querySelector('a[href="/terms"]');
    expect(link, 'посилання всередині курсиву не загубилось').not.toBeNull();
    expect(link!.textContent).toBe('Оферти');
  });
});
