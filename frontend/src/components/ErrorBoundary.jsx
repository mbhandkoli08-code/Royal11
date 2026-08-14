import { Component } from "react";

// App-wide safety net: React unmounts the whole tree on an uncaught render
// error, which shows a blank white screen. This boundary catches it and shows a
// graceful recover screen instead, so a single failing component can never take
// down the entire app.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || String(error) };
  }

  componentDidCatch(error, info) {
    // Surface to the console for diagnostics (and any future logging service).
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        data-testid="app-error-boundary"
        className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center"
      >
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-royal-light text-royal">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-slate-900">
          Something went wrong
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          The app hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          data-testid="error-reload-btn"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-2xl bg-royal px-6 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
        >
          Reload app
        </button>
        {this.state.message && (
          <p className="mt-4 max-w-md break-words font-mono text-[11px] text-slate-300">{this.state.message}</p>
        )}
      </div>
    );
  }
}
