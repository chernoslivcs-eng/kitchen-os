// Пул-5 №2: сторінка запрошення. Раніше лінк з листа бив у API і показував
// сирий JSON, а сесія мовчки перемикалась. Тепер людина бачить, КУДИ її
// запрошують і ЯКИМ акаунтом зайде, і приймає явним кліком.
//
// Пул-8: верстка — той самий канон, що вхід «кільце замикається» (пул-6 №8):
// зліва шавлієве поле з кільцями, справа панель дії. Після редизайну входу
// ця сторінка лишалась на старих класах і розсипалась.
//
// Важлива семантика: прийняти інвайт == увійти юзером мейла, на який він
// висланий (find-or-create в домені). Якщо в браузері зараз інша сесія —
// чесно попереджаємо, що вона зміниться.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { api } from '../../api';
import { useAuth } from '../../store/auth';
import { RingField } from '../SignIn/RingField';
import { Mark } from '../SignIn/SignIn';
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

  const [animateField] = useState(() =>
    typeof window !== 'undefined'
    && window.matchMedia('(min-width: 1024px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
      <div className={styles['field-panel']}>
        <RingField animate={animateField} />
        <div className={styles['field-shade']} />
        <div className={styles['field-content']}>
          <div className={styles['field-logo']}>
            <Mark />
            <span>Kitchen OS</span>
          </div>
          <div className={styles['field-hero']}>
            <h1 className={styles['field-title']}>Одна комора<br />на весь дім.</h1>
            <p className={styles['field-sub']}>
              Що є вдома — бачать усі. А коли готуємо, враховуємо кожного за столом.
            </p>
          </div>
          <div className={styles['field-foot']}>◌ ОЧІКУЄ · КУРСОР З'ЄДНУЄ ТРИ — КІЛЬЦЯ ЗАМИКАЮТЬСЯ В СТРАВУ</div>
        </div>
      </div>

      <div className={styles['form-panel']}>
        {state.kind === 'loading' && (
          <div className={styles['form-head']}>
            <span className={styles.mono}>ЗАПРОШЕННЯ В ДІМ</span>
            <p className={styles['form-sub']}>Перевіряю запрошення…</p>
          </div>
        )}

        {state.kind === 'dead' && (
          <>
            <div className={styles['form-head']}>
              <span className={styles.mono}>ЗАПРОШЕННЯ В ДІМ</span>
              <h2 className={styles['form-title']}>Запрошення недійсне</h2>
              <p className={styles['form-sub']}>
                Цей лінк уже не працює. Попроси надіслати новий.
              </p>
            </div>
            <div className={styles.form}>
              <Button size="lg" block onClick={() => navigate('/')}>На головну</Button>
            </div>
          </>
        )}

        {(state.kind === 'ready' || state.kind === 'accepting') && (
          <>
            <div className={styles['form-head']}>
              <span className={styles.mono}>ЗАПРОШЕННЯ В ДІМ · БЕЗ ПАРОЛЯ</span>
              <h2 className={styles['form-title']}>Тебе запрошують у «{state.household}»</h2>
              <p className={styles['form-sub']}>
                Запрошення для <strong>{state.email}</strong> — після прийняття ти працюватимеш
                у спільній коморі цього дому саме цим акаунтом.
                {currentEmail && currentEmail !== state.email && (
                  <> Ти вже увійшов як <strong>{currentEmail}</strong>. Після прийняття запрошення акаунт зміниться.</>
                )}
              </p>
            </div>
            <div className={styles.form}>
              <Button size="lg" block loading={state.kind === 'accepting'} onClick={accept}>
                Прийняти запрошення
              </Button>
              {error && <p className={styles['form-sub']} style={{ color: 'var(--danger, #b3453a)' }}>{error}</p>}
            </div>
          </>
        )}

        <div className={styles['form-foot']}>
          <span>Не просив запрошення — просто закрий сторінку, нічого не станеться.</span>
          <span className={styles['foot-mono']}>ЛІНК ОДНОРАЗОВИЙ · ДІЄ 72 ГОД</span>
        </div>
      </div>
    </div>
  );
}
