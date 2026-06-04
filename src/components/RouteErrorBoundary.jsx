import { Component } from 'react'

// Catches render-time crashes for lazy-loaded routes. The most common one is
// "Importing a module script failed" / "Failed to fetch dynamically imported
// module" — this happens when a new deploy ships fresh hashed chunks but the
// browser is still holding the old index, so the old chunk URL 404s. For that
// case we reload the page once (guarded by sessionStorage to avoid a loop) so
// the browser pulls the current chunk. Any other error shows a clean fallback.
const CHUNK_ERROR_RE = /dynamically imported module|module script failed|Failed to fetch/i
const RELOAD_FLAG = 'route_chunk_reloaded'

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    if (CHUNK_ERROR_RE.test(error?.message || '')) {
      // Reload once to fetch the current chunk after a deploy.
      if (typeof window !== 'undefined' && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
      }
    }
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(RELOAD_FLAG)
      window.location.reload()
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="dashboard-page flex min-h-[50vh] w-full flex-col items-center justify-center gap-4 text-center">
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Couldn’t load this page
          </h2>
          <p className="max-w-sm text-sm text-slate-400">
            Something went wrong while loading this page. This usually fixes
            itself with a refresh.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="dashboard-button dashboard-button-primary px-5"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
