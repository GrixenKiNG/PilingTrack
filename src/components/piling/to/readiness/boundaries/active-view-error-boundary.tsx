'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ActiveViewErrorBoundaryProps {
  children: ReactNode;
  activeView: string;
  onRetry?: () => void;
}

interface ActiveViewErrorBoundaryState {
  error: Error | null;
}

export class ActiveViewErrorBoundary extends Component<
  ActiveViewErrorBoundaryProps,
  ActiveViewErrorBoundaryState
> {
  state: ActiveViewErrorBoundaryState = { error: null };
  private heading: HTMLHeadingElement | null = null;

  static getDerivedStateFromError(error: Error): ActiveViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tech readiness active view failed', error, info.componentStack);
  }

  componentDidUpdate(previousProps: ActiveViewErrorBoundaryProps) {
    if (previousProps.activeView !== this.props.activeView && this.state.error) {
      this.setState({ error: null });
      return;
    }
    if (this.state.error) this.heading?.focus();
  }

  private retry = () => {
    this.setState({ error: null }, () => this.props.onRetry?.());
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section
        role="alert"
        className="m-3 min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-6"
      >
        <h2
          ref={(node) => {
            this.heading = node;
          }}
          tabIndex={-1}
          className="text-lg font-semibold outline-none"
        >
          Раздел временно недоступен
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Обновите данные раздела. Остальные вкладки продолжают работать.
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={this.retry}>
          Повторить
        </Button>
      </section>
    );
  }
}
