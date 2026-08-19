### Module Federation for Dynamic Module Loading (Runtime Enabled)

The platform’s primary integration mechanism for microfrontends is **Webpack 5 Module Federation**, and we are adopting a **runtime-based approach** to dynamically load modules based on data stored in a backend registry.

#### Why Runtime Module Federation?

By default, Webpack's Module Federation requires all remotes to be statically defined at build time. This does not work for our use case, where the list of available microfrontends is stored in a database and can be modified dynamically (added, removed, or updated via REST API). To solve this, we implement **dynamic remote loading at runtime**, allowing new microfrontends to be added without rebuilding the container app.

#### Dynamic Loading Mechanism

At runtime, the container:

1. Fetches the list of registered microfrontends from the App Registry via a REST API (e.g., `GET /api/apps`).
2. Extracts the relevant metadata for each app (e.g., app name, remoteEntry.js URL, exposed module name).
3. Dynamically loads the `remoteEntry.js` file using a helper function.
4. Initializes the shared scope and retrieves the exposed module.

Example implementation:

```js
async function loadRemoteModule(remoteUrl, scope, module) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${remoteUrl}/remoteEntry.js`
    script.type = 'text/javascript'
    script.async = true
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })

  await __webpack_init_sharing__('default')
  const container = window[scope]
  await container.init(__webpack_share_scopes__.default)

  const factory = await container.get(module)
  return factory()
}
```

Usage:

```js
const RemoteApp = await loadRemoteModule(
  'https://app1.example.com', // remote URL
  'app1', // scope
  './MainApp' // exposed module
)
```

This method allows us to:

- Dynamically load and render microfrontends at runtime.
- Share dependencies like React across host and remote.
- Avoid rebuilds of the container when new apps are added.

#### SDK Adjustments for Runtime MF

The SDK will:

- Automatically detect and load remote modules using the above helper internally.
- Provide APIs like `loadApp(appId)` that abstract the dynamic federation process.
- Expose error boundaries and fallbacks in case the app fails to load.
- Inject contextual data (user, tenant, permissions) once the app is mounted.

#### App Registry Integration

App metadata stored in the registry must include:

- `remoteUrl`: full URL to the host of the microfrontend.
- `scope`: name under which the remote container exposes itself.
- `module`: the module exposed (e.g., './MainApp').
- `integrationType`: set to `module-federation` for these apps.

This ensures the container has all data it needs to dynamically load the app.

#### Error Handling and Retry Strategy

- The SDK and loader utility will provide fallback UIs for load failure (e.g., network issue or bad remoteEntry).
- Retry logic (e.g., exponential backoff) can be used for transient failures.
- The platform can automatically mark unhealthy apps in the registry to prevent repeated failed attempts.

#### Hybrid Support with Iframes and Web Components

The container will support `integrationType` values:

- `module-federation` (uses dynamic loader as above)
- `iframe` (container injects iframe pointing to app URL)
- `web-component` (container loads and mounts a registered custom element)

This ensures compatibility with various frontend technologies while maintaining a consistent loading and communication contract.

### Final Note

Runtime Module Federation is now the core approach for dynamically integrating microfrontends into the host shell. It enables flexible, on-demand composition of frontend functionality without sacrificing dependency sharing or performance, while iframe and web component support ensures broader compatibility and fallback resilience.
