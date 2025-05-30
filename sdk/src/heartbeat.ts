/**
 * AppHub Heartbeat SDK
 * Allows microfrontends to report their status to the AppHub platform
 */

interface HeartbeatConfig {
  appId: string
  backendUrl?: string
  interval?: number // in milliseconds
  metadata?: Record<string, any>
}

interface HeartbeatResponse {
  success: boolean
  message: string
  timestamp: string
}

class AppHeartbeat {
  private config: HeartbeatConfig
  private intervalId: NodeJS.Timeout | null = null
  private isActive = false

  constructor(config: HeartbeatConfig) {
    this.config = {
      backendUrl: 'http://localhost:3001',
      interval: 30000, // 30 seconds default
      ...config,
    }
  }

  /**
   * Send a single heartbeat to the backend
   */
  async sendHeartbeat(
    status: 'online' | 'offline' = 'online',
    metadata?: Record<string, any>
  ): Promise<HeartbeatResponse> {
    try {
      const response = await fetch(
        `${this.config.backendUrl}/api/apps/${this.config.appId}/heartbeat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status,
            metadata: { ...this.config.metadata, ...metadata },
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      console.log(`💓 Heartbeat sent successfully for app ${this.config.appId}`)
      return result
    } catch (error) {
      console.error(
        `❌ Failed to send heartbeat for app ${this.config.appId}:`,
        error
      )
      throw error
    }
  }

  /**
   * Start sending periodic heartbeats
   */
  start(): void {
    if (this.isActive) {
      console.warn('Heartbeat is already active')
      return
    }

    this.isActive = true

    // Send initial heartbeat
    this.sendHeartbeat('online').catch(console.error)

    // Set up periodic heartbeats
    this.intervalId = setInterval(() => {
      this.sendHeartbeat('online').catch(console.error)
    }, this.config.interval)

    console.log(
      `🚀 Started heartbeat for app ${this.config.appId} (interval: ${this.config.interval}ms)`
    )
  }

  /**
   * Stop sending heartbeats
   */
  stop(): void {
    if (!this.isActive) {
      return
    }

    this.isActive = false

    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    // Send offline status
    this.sendHeartbeat('offline').catch(console.error)

    console.log(`🛑 Stopped heartbeat for app ${this.config.appId}`)
  }

  /**
   * Check if heartbeat is currently active
   */
  isRunning(): boolean {
    return this.isActive
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }
}

/**
 * Create and configure a heartbeat instance for your app
 *
 * @example
 * ```typescript
 * import { createHeartbeat } from '@apphub/sdk';
 *
 * const heartbeat = createHeartbeat({
 *   appId: 'my-app-uuid',
 *   backendUrl: 'https://apphub.example.com',
 *   interval: 60000, // 1 minute
 *   metadata: { version: '1.0.0' }
 * });
 *
 * // Start sending heartbeats
 * heartbeat.start();
 *
 * // Stop when app is unloading
 * window.addEventListener('beforeunload', () => {
 *   heartbeat.stop();
 * });
 * ```
 */
export function createHeartbeat(config: HeartbeatConfig): AppHeartbeat {
  return new AppHeartbeat(config)
}

export { AppHeartbeat }
export type { HeartbeatConfig, HeartbeatResponse }
