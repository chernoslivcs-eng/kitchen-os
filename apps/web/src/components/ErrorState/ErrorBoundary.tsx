// Крок Е1: замість білого екрана — екран, який говорить.
//
// Межа НЕ ковтає помилку: вона завжди віддає її назовні через onError і лише
// потім малює екран. Зараз назовні стоїть console.error; крок О1 підставить
// туди відправку в Sentry і поверне сюди код інциденту — місце під нього вже
// є (`incidentCode`), і чип зʼявиться сам, щойно код почне приходити.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './ErrorScreen';
import { CRASH } from './copy';

interface Props {
  children: ReactNode;
  /**
   * Куди повідомити про падіння. Обовʼязково викликається ДО рендера екрана —
   * інакше межа ловить помилку й ховає її від усіх, включно з нами.
   */
  onError?: (error: Error, info: ErrorInfo) => string | null | void;
  /** Перезавантаження — окремим пропом, щоб тест не смикав справжнє вікно. */
  onReload?: () => void;
}

interface State {
  error: Error | null;
  /** Короткий код події з onError. Немає — чипа не буде взагалі. */
  incidentCode: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, incidentCode: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Дефолт — консоль: без О1 подія нікуди не летить, але й не зникає.
    const report = this.props.onError ?? ((e: Error) => { console.error(e); });
    let code: string | null = null;
    try {
      const out = report(error, info);
      code = typeof out === 'string' && out ? out : null;
    } catch {
      // Впав сам звіт — це не привід не показати людині екран.
    }
    if (code) this.setState({ incidentCode: code });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorScreen
        kicker={CRASH.kicker}
        tone="danger"
        code={this.state.incidentCode}
        h1a={CRASH.h1a}
        h1b={CRASH.h1b}
        body={CRASH.body}
        cta={CRASH.cta}
        onCta={() => (this.props.onReload ?? (() => window.location.reload()))()}
      />
    );
  }
}
