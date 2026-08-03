"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Generic render-error boundary. React only supports this via a class
 * component — there is no hook equivalent for `getDerivedStateFromError`. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            role="alert"
            style={{
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0a0a0b",
              color: "#a1a1aa",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              padding: "2rem",
              textAlign: "center",
            }}
          >
            <p>Something went wrong loading this page. Please refresh.</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
