import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ContentErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: unknown;
}

interface ContentErrorBoundaryState {
  hasError: boolean;
}

export class ContentErrorBoundary extends Component<
  ContentErrorBoundaryProps,
  ContentErrorBoundaryState
> {
  state: ContentErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ContentErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Failed to render lazy content', error, info);
  }

  componentDidUpdate(previousProps: ContentErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
