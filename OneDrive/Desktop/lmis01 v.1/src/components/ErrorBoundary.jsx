import { Component } from "react";

// Catches any rendering error and shows a friendly fallback
// instead of a white screen.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("LSMIS ErrorBoundary:", error, info);
  }

  handleReload = () => {
    window.location.href = window.location.pathname;
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="error-screen">
        <div className="error-card">
          <div className="error-icon">!</div>
          <h1>Something went wrong</h1>
          <p>The page failed to load. The error has been logged to the console.</p>
          <pre className="error-detail">{String(this.state.error?.message || this.state.error)}</pre>
          <button className="btn btn-primary" onClick={this.handleReload}>Reload Page</button>
        </div>
      </div>
    );
  }
}
