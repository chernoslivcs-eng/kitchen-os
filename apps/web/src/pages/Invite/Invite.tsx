// Пул-5 №2: сторінка запрошення. Раніше лінк з листа бив у API і показував
// сирий JSON, а сесія мовчки перемикалась. Тепер людина бачить, КУДИ її
// запрошують і ЯКИМ акаунтом зайде, і приймає явним кліком.
//
// Важлива семантика: прийняти інвайт == увійти юзером мейла, на який він
// висланий (find-or-create в домені). Якщо в браузері зараз інша сесія —
// чесно попереджаємо, що вона зміниться.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Logo } from '../../components/Logo/Logo';
import { MonoLabel } from '../../components/MonoLabel/MonoLabel';
import { api } from '../../api';
import { useAuth } from '../../store/auth';
import styles from '../SignIn/SignIn.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'dead' }
  | { kind: 'ready'; household: string; email: string }
  | { kind: 'accepting'; household: string; email: string };

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

  const currentEmail = me?.user?.email ?? null;

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <Logo size={40} />
          <MonoLabel className={styles.mono}>Kitchen OS · запрошення</MonoLabel>
        </div>
        <div className={styles.hero}>
          {state.kind === 'loading' && <p className={styles.sub}>Перевіряю запрошення…</p>}
          {state.kind === 'dead' && (
            <>
              <h1 className={styles.title}>Запрошення недійсне</h1>
              <p className={styles.sub}>Лінк протух, уже використаний або відкликаний. Попроси надіслати новий.</p>
              <Button size="lg" block onClick={() => navigate('/')}>На головну</Button>
            </>
          )}
          {(state.kind === 'ready' || state.kind === 'accepting') && (
            <>
              <h1 className={styles.title}>Тебе запрошують у «{state.household}»</h1>
              <p className={styles.sub}>
                Запрошення для <strong>{state.email}</strong> — після прийняття ти працюватимеш
                у спільній коморі цього дому саме цим акаунтом.
                {currentEmail && currentEmail !== state.email && (
                  <> Зараз ти в сесії <strong>{currentEmail}</strong> — вона зміниться.</>
                )}
              </p>
              <div className={styles.form}>
                <Button size="lg" block loading={state.kind === 'accepting'} onClick={accept}>
                  Прийняти запрошення
                </Button>
                {error && <p className={styles.sub} style={{ color: 'var(--danger, #b3453a)' }}>{error}</p>}
              </div>
            </>
          )}
        </div>
        <p className={styles.foot}>Не просив запрошення — просто закрий сторінку, нічого не станеться.</p>
      </div>
    </div>
  );
}
