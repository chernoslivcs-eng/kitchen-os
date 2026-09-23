// Юридичний документ — попап на наявній Sheet (та сама, що в календарі),
// поверх сторінки, з якої відкрили. /terms /privacy /refund /contacts:
// власник 23.09 — простий попап у наявному дизайні, без окремих сторінок.
//
// Закриття: якщо попап відкрили лінком зсередини застосунку (Link передав
// `state.background`) — крок назад в історії повертає точно туди; якщо
// зайшли прямим переходом на адресу (лінк платіжного провайдера, оновлення
// сторінки) — background нема, і закриття веде на `/`.
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { Sheet } from '../../components/Sheet/Sheet';
import { Markdown } from '../../components/Markdown/Markdown';
import { LEGAL_DOCS, resolveLegalHref, type LegalDocKey } from '../../lib/legal-docs';

interface Props {
  doc: LegalDocKey;
}

export function LegalDocPage({ doc }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const background = (location.state as { background?: Location } | null)?.background;

  function onClose() {
    if (background) void navigate(-1);
    else void navigate('/', { replace: true });
  }

  const { title, md } = LEGAL_DOCS[doc];
  return (
    <Sheet onClose={onClose} ariaLabel={title} title={title}>
      <Markdown text={md} resolveHref={resolveLegalHref} linkState={{ background: location }} />
    </Sheet>
  );
}
