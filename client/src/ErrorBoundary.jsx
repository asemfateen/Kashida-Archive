import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-surface dark:bg-dark-surface text-on-surface dark:text-dark-on-surface p-8">
          <div className="max-w-md text-center">
            <span className="material-symbols-outlined text-6xl text-on-surface-variant dark:text-dark-on-surface-variant mb-4">
              error
            </span>
            <h1 className="font-display-lg text-display-lg text-primary dark:text-dark-primary mb-2">
              Something went wrong
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant dark:text-dark-on-surface-variant mb-6">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = "/";
              }}
              className="bg-primary dark:bg-dark-primary text-on-primary dark:text-dark-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-full hover:opacity-90 active:scale-95 transition-all duration-200"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
