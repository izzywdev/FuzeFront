import React, { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  appName?: string
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class FederatedAppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Federated app error:', error, errorInfo)
    // You could send this to an error reporting service
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onRetry) {
      this.props.onRetry()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '2rem',
            border: '1px solid #ff6b6b',
            borderRadius: '8px',
            backgroundColor: '#2a1f1f',
            textAlign: 'center',
            color: '#ff6b6b',
          }}
        >
          <h3>⚠️ App Loading Error</h3>
          <p>
            Failed to load{' '}
            {this.props.appName ? `"${this.props.appName}"` : 'the application'}
            .
          </p>
          {this.state.error && (
            <details style={{ marginTop: '1rem', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
                Error Details
              </summary>
              <pre
                style={{
                  backgroundColor: '#1a1a1a',
                  padding: '1rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  overflow: 'auto',
                }}
              >
                {this.state.error.message}
              </pre>
            </details>
          )}
          <div style={{ marginTop: '1.5rem' }}>
            <button
              className="btn btn-primary"
              onClick={this.handleRetry}
              style={{ marginRight: '1rem' }}
            >
              🔄 Retry
            </button>
            <button
              className="btn"
              onClick={() => (window.location.href = '/dashboard')}
              style={{
                backgroundColor: '#666',
                border: 'none',
                color: 'white',
              }}
            >
              🏠 Go to Dashboard
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
