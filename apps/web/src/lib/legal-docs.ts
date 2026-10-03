// Юридичні документи (legal/*.md, корінь репозиторію) — текст живе там,
// одним файлом на документ, і саме тому імпортується як є (?raw), а не
// копіюється в код рукою: редакція документа міняється, застосунок бачить
// зміну без окремого коміту в apps/web. Vite читає файл із диска напряму
// (і в dev через fs.allow, який за замовчуванням піднімається до кореня
// репозиторію — тут є pnpm-workspace.yaml, — і в build через Rollup), тож
// шлях за межі apps/web нормальний, не хак.
import offerMd from '../../../../legal/OFFER.md?raw';
import privacyMd from '../../../../legal/PRIVACY.md?raw';
import refundMd from '../../../../legal/REFUND.md?raw';
import contactsMd from '../../../../legal/CONTACTS.md?raw';

export type LegalDocKey = 'terms' | 'privacy' | 'refund' | 'contacts';

export const LEGAL_ROUTES: Record<LegalDocKey, string> = {
  terms: '/terms',
  privacy: '/privacy',
  refund: '/refund',
  contacts: '/contacts',
};

// description — для usePageMeta (пошукова база, крок 1, 03.10): короткий,
// точний переказ документа, без обіцянок, яких у ньому нема.
export const LEGAL_DOCS: Record<LegalDocKey, { title: string; description: string; md: string }> = {
  terms: { title: 'Оферта', description: 'Умови використання Kitchen OS — договір приєднання для реєстрації, демо-версії та підписки.', md: offerMd },
  privacy: { title: 'Політика конфіденційності', description: 'Політика конфіденційності Kitchen OS — які дані ми збираємо, навіщо і як довго зберігаємо.', md: privacyMd },
  refund: { title: 'Повернення і скасування', description: 'Умови скасування підписки Kitchen OS: скасувати можна будь-коли, повернення за оплачений період не передбачено.', md: refundMd },
  contacts: { title: 'Реквізити й контакти', description: 'Реквізити ФОП і контакти Kitchen OS.', md: contactsMd },
};

// Внутрішні посилання між документами в самому markdown ведуть одне на
// одного за файлом (`[Політику конфіденційності](PRIVACY.md)`) — переводимо
// в маршрут застосунку, щоб клік відкривав попап, а не 404.
const ROUTE_BY_FILE: Record<string, LegalDocKey> = {
  'OFFER.md': 'terms',
  'PRIVACY.md': 'privacy',
  'REFUND.md': 'refund',
  'CONTACTS.md': 'contacts',
};

export function resolveLegalHref(href: string): string | null {
  const key = ROUTE_BY_FILE[href];
  return key ? LEGAL_ROUTES[key] : null;
}
