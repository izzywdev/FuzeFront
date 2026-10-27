/**
 * Replit integration capability contract.
 *
 * Replit publishes a remote MCP server, not a documented static OAuth client
 * and REST API compatible with ConnectorDefinition. Keep this out of the OAuth
 * connector registry until the platform supports protected-resource discovery,
 * dynamic OAuth registration, and Streamable HTTP MCP transport.
 *
 * https://docs.replit.com/platforms/mcp-server
 */
export const replitMcp = {
  id: 'replit',
  name: 'Replit',
  serverUrl: 'https://mcp.replit.com/server/mcp',
  transport: 'streamable-http',
  authentication: 'oauth-protected-resource-discovery',
  readTools: {
    listApps: { name: 'list_apps', maxLimit: 50 },
    searchApps: { name: 'search_apps', maxLimit: 50 },
    resolveAppByName: { name: 'resolve_app_by_name' },
    getPublishStatus: { name: 'get_publish_status' },
  },
} as const
