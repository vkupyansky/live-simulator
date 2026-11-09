import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/shared/lib/logger';

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  componentDidCatch(_error: Error, info: ErrorInfo): void {
    logger.error('react_boundary', info.componentStack ? 'component_stack' : 'unknown');
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal">
          <div className="brand-mark" />
          <h1>Что-то пошло не так</h1>
          <p>Локальные данные не отправлялись. Закройте и снова откройте приложение.</p>
          <button className="primary" onClick={() => location.reload()}>
            Перезапустить
          </button>
        </main>
      );
    return this.props.children;
  }
}
