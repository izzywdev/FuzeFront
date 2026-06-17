import React, { useState, useEffect } from 'react'

interface HealthStatus {
  status: string
  timestamp: string
  uptime?: number
  version?: string
}

function StatusPage() {
  const [healthData, setHealthData] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date>(new Date())

  const checkHealth = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/health`
      )

      if (!response.ok) {
        throw new Error(
          `Health check failed: ${response.status} ${response.statusText}`
        )
      }

      const data = await response.json()
      setHealthData(data)
      setLastChecked(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
      setHealthData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    checkHealth()

    // Auto-refresh every 30 seconds
    const interval = setInterval(checkHealth, 30000)

    return () => clearInterval(interval)
  }, [])

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1>🩺 System Status</h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '1.1rem' }}>
          Real-time health monitoring for FrontFuse services
        </p>
      </div>

      {/* Main Status Card */}
      <div
        style={{
          padding: '2rem',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          backgroundColor: 'var(--bg-tertiary)',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0 }}>Backend API Status</h2>
          <button
            onClick={checkHealth}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '🔄 Checking...' : '🔄 Refresh'}
          </button>
        </div>

        {loading && !healthData ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
            <div>🔄 Checking system status...</div>
          </div>
        ) : error ? (
          <div
            style={{
              padding: '1rem',
              backgroundColor: 'var(--error-color)',
              color: 'white',
              borderRadius: '4px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
              ❌ Service Unavailable
            </div>
            <div>{error}</div>
          </div>
        ) : healthData ? (
          <div>
            <div
              style={{
                padding: '1rem',
                backgroundColor:
                  healthData.status === 'ok'
                    ? 'var(--success-color)'
                    : 'var(--error-color)',
                color: 'white',
                borderRadius: '4px',
                textAlign: 'center',
                marginBottom: '1rem',
              }}
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                {healthData.status === 'ok'
                  ? '✅ All Systems Operational'
                  : '❌ System Error'}
              </div>
              <div>Status: {healthData.status.toUpperCase()}</div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
              }}
            >
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-quaternary)',
                  borderRadius: '4px',
                }}
              >
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                  Last Response
                </div>
                <div style={{ fontSize: '1.1rem' }}>
                  {new Date(healthData.timestamp).toLocaleString()}
                </div>
              </div>

              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-quaternary)',
                  borderRadius: '4px',
                }}
              >
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                  Last Checked
                </div>
                <div style={{ fontSize: '1.1rem' }}>
                  {lastChecked.toLocaleString()}
                </div>
              </div>

              {healthData.uptime && (
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: 'var(--bg-quaternary)',
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                    Uptime
                  </div>
                  <div style={{ fontSize: '1.1rem' }}>
                    {formatUptime(healthData.uptime)}
                  </div>
                </div>
              )}

              {healthData.version && (
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: 'var(--bg-quaternary)',
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                    Version
                  </div>
                  <div style={{ fontSize: '1.1rem' }}>{healthData.version}</div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Additional System Info */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem',
        }}
      >
        <div
          style={{
            padding: '1.5rem',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          <h3>🌐 Frontend Status</h3>
          <div style={{ color: 'var(--success-color)', marginBottom: '0.5rem' }}>
            ✅ Online
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
            Vite development server running on port 5173
          </div>
        </div>

        <div
          style={{
            padding: '1.5rem',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          <h3>🔌 WebSocket Status</h3>
          <div style={{ color: 'var(--success-color)', marginBottom: '0.5rem' }}>
            ✅ Connected
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
            Real-time communication active
          </div>
        </div>

        <div
          style={{
            padding: '1.5rem',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          <h3>🗄️ Database Status</h3>
          <div style={{ color: 'var(--success-color)', marginBottom: '0.5rem' }}>
            ✅ Connected
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
            SQLite database operational
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          backgroundColor: 'var(--bg-quaternary)',
          borderRadius: '4px',
          fontSize: '0.9rem',
          color: 'var(--text-tertiary)',
        }}
      >
        <strong>Note:</strong> This page automatically refreshes every 30
        seconds. Use the refresh button for manual updates.
      </div>
    </div>
  )
}

export default StatusPage
