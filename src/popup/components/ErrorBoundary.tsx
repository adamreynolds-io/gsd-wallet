import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[GSD] Uncaught error:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <p className="text-white font-medium mb-2">Something went wrong</p>
          <p className="text-sm text-gray-400 mb-4 break-all">
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          <button
            className="btn-primary px-4 py-2 text-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
