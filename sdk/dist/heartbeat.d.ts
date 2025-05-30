/**
 * AppHub Heartbeat SDK
 * Allows microfrontends to report their status to the AppHub platform
 */
interface HeartbeatConfig {
  appId: string
  backendUrl?: string
  interval?: number
  metadata?: Record<string, any>
}
interface HeartbeatResponse {
  success: boolean
  message: string
  timestamp: string
}
declare class AppHeartbeat {
  private config
  private intervalId
  private isActive
  constructor(config: HeartbeatConfig)
  /**
   * Send a single heartbeat to the backend
   */
  sendHeartbeat(
    status?: 'online' | 'offline',
    metadata?: Record<string, any>
  ): Promise<HeartbeatResponse>
  /**
   * Start sending periodic heartbeats
   */
  start(): void
  /**
   * Stop sending heartbeats
   */
  stop(): void
  /**
   * Check if heartbeat is currently active
   */
  isRunning(): boolean
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<HeartbeatConfig>): void
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
export declare function createHeartbeat(config: HeartbeatConfig): AppHeartbeat
export { AppHeartbeat }
export type { HeartbeatConfig, HeartbeatResponse }
//# sourceMappingURL=heartbeat.d.ts.map
