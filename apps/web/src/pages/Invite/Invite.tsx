// Пул-5 №2: сторінка запрошення — людина бачить, КУДИ її запрошують і ЯКИМ
// акаунтом зайде, і приймає явним кліком. Прийняти інвайт == увійти юзером
// мейла, на який він висланий (find-or-create в домені); інша сесія в браузері
// зміниться — про це бурштинова смуга під кнопкою.
//
// Етап 9а (Auth.dc.html, пакет C4): сторінка лендінгу — AuthShell, дім карткою,
// кнопка — той самий чорний піл, що «Продовжити з Google». Аватарів і
// «3 людини · 61 позиція» з кадру немає: /v1/invites/info віддає лише пошту,
// назву дому й роль (DEVIATIONS-V3-landing Р49). Недійсне запрошення — AuthShell з кікером danger (етап 10).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../store/auth';
import { Icon } from '../../components/Icon/Icon';
import { AuthShell } from '../Auth/AuthShell';
import styles from '../Auth/Auth.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'dead' }
  | { kind: 'ready'; household: string; email: string }
  | { kind: 'accepting'; household: string; email: string };

const KICK = { tone: 'plum' as const, kickIcon: 'auth.household' as const, kick: 'Запрошення в дім · без пароля', h1a: 'Одна комора на весь дім.' };
const FOOT = 'Не просив запрошення — просто закрий сторінку, нічого не станеться. Лінк одноразовий · діє 72 год.';

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const me = useAuth((s) => s.me);
  const refreshMe = useAuth((s) => s.refresh);

  useEffect(() => {
    if (!token) { setState({ kind: 'dead' }); return; }
    api.invites.info(token)
      .then((i) => setState({ kind: 'ready', household: i.household_name, email: i.email }))
      .catch(() => setState({ kind: 'dead' }));
  }, [token]);

  async function accept() {
    if (state.kind !== 'ready') return;
    setState({ ...state, kind: 'accepting' });
    setError(null);
    try {
      await api.invites.accept(token);
      await refreshMe();
      navigate('/app', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setState({ ...state, kind: 'ready' });
    }
  }

  if (state.kind === 'dead') {
    // Етап 10: недійсне запрошення — на AuthShell з кікером danger (Auth.dc.html:
    // «Errors E1 із кікером danger і „На головну“»). Копі — з Invite до етапу 9а.
    return (
      <AuthShell tone="danger" kickIcon="auth.household" kick="запрошення · недійсне" h1a="Запрошення недійсне." h1b="Цей лінк уже не працює."
        sub="Попроси надіслати новий." foot={FOOT}>
        <button type="button" className={styles.accept} onClick={() => navigate('/')}>На головну</button>
      </AuthShell>
    );
  }

  if (state.kind === 'loading') {
    return <AuthShell {...KICK} h1b="Перевіряю запрошення…" sub="" foot={FOOT} />;
  }

  const currentEmail = me?.user?.email ?? null;
  return (
    <AuthShell {...KICK} h1b={`Тебе запрошують у «${state.household}».`}
      sub="Після прийняття все, що є вдома, стане спільним, і саме цей акаунт буде твоїм тут." foot={FOOT}>
      <div className={styles.house}>
        <span className={styles.houseText}>
          <span className={styles.houseName}>Дім «{state.household}»</span>
          <span className={styles.houseMeta}>для {state.email}</span>
        </span>
      </div>
      <button type="button" className={styles.accept} disabled={state.kind === 'accepting'} onClick={accept}>
        {state.kind === 'accepting' ? 'Приймаю…' : 'Прийняти запрошення'}
      </button>
      {currentEmail && currentEmail !== state.email && (
        <div className={styles.strip}>
          <Icon name="auth.otherUser" size={16} inherit decorative />
          <span>Ти вже увійшов як <b>{currentEmail}</b> — після прийняття акаунт зміниться<span className={styles.deskOnly}> на <b>{state.email}</b></span>.</span>
        </div>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </AuthShell>
  );
}
