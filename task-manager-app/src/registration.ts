import { createHeartbeat } from './lib/sdk'

interface AppRegistrationConfig {
  name: string
  url: string
  iconUrl?: string
  integrationType: 'module-federation' | 'iframe' | 'web-component'
  remoteUrl: string
  scope: string
  module: string
  description?: string
  hubApiUrl?: string
}

/**
 * Register this app with the FuzeFront hub
 */
export async function registerWithHub(
  config: AppRegistrationConfig
): Promise<string | null> {
  const hubApiUrl = config.hubApiUrl || 'http://localhost:3003'

  try {
    console.log('🚀 Registering Task Manager app with FuzeFront hub...')

    const response = await fetch(`${hubApiUrl}/api/apps/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: config.name,
        url: config.url,
        iconUrl: config.iconUrl,
        integrationType: config.integrationType,
        remoteUrl: config.remoteUrl,
        scope: config.scope,
        module: config.module,
        description: config.description,
      }),
    })

    if (response.ok) {
      const app = await response.json()
      console.log('✅ Successfully registered with FuzeFront hub:', app)
      return app.id
    } else {
      const error = await response.json()
      console.error('❌ Failed to register with FuzeFront hub:', error)
    }
  } catch (error) {
    console.error('❌ Error registering with FuzeFront hub:', error)
  }

  return null
}

/**
 * Start heartbeat to keep the app alive in the hub
 */
export function startHeartbeat(
  appId: string,
  hubApiUrl: string = 'http://localhost:3003'
) {
  const heartbeat = createHeartbeat({
    appId,
    backendUrl: hubApiUrl,
    interval: 30000, // 30 seconds
    metadata: {
      version: '1.0.0',
      buildTime: new Date().toISOString(),
      capabilities: ['task-management', 'notifications'],
    },
  })

  heartbeat.start()

  console.log('💓 Started heartbeat for Task Manager app')

  return heartbeat
}

/**
 * Auto-register the task manager app when running standalone
 */
export async function autoRegister() {
  // Only register if running standalone (not loaded as a federated module)
  if (
    window.location.port === '3002' &&
    (!window.parent || window.parent === window)
  ) {
    const appId = await registerWithHub({
      name: 'Task Manager',
      url: 'http://localhost:3002',
      iconUrl: 'http://localhost:3002/task-icon.svg',
      integrationType: 'module-federation',
      remoteUrl: 'http://localhost:3002',
      scope: 'taskManager',
      module: './TaskManagerApp',
      description:
        'A comprehensive task management application for organizing and tracking work items.',
    })

    if (appId) {
      startHeartbeat(appId)
    }
  }
}
