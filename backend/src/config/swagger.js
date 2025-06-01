const swaggerJsdoc = require('swagger-jsdoc')
const swaggerUi = require('swagger-ui-express')

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FrontFuse Platform API',
      version: '1.0.0',
      description: `
        FrontFuse is a microfrontend hosting platform that enables dynamic loading and management of federated applications.
        
        ## Features
        - JWT-based authentication
        - Role-based access control (RBAC)
        - Module Federation support
        - Real-time communication via WebSockets
        - Application health monitoring
        - User session management
        
        ## Authentication
        Most endpoints require authentication via JWT token in the Authorization header:
        \`Authorization: Bearer <your-jwt-token>\`
        
        ## Getting Started
        1. Login to obtain a JWT token
        2. Use the token in subsequent API calls
        3. Register your microfrontend applications
        4. Monitor application health and status
      `,
      contact: {
        name: 'FrontFuse Team',
        email: 'support@frontfuse.dev',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url:
          process.env.NODE_ENV === 'production'
            ? 'https://api.frontfuse.dev'
            : 'http://localhost:3001',
        description:
          process.env.NODE_ENV === 'production'
            ? 'Production server'
            : 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique user identifier',
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            firstName: {
              type: 'string',
              description: 'User first name',
            },
            lastName: {
              type: 'string',
              description: 'User last name',
            },
            defaultAppId: {
              type: 'string',
              format: 'uuid',
              description: 'Default application ID for this user',
            },
            roles: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'User roles (e.g., ["user", "admin"])',
            },
          },
          required: ['id', 'email', 'roles'],
        },
        App: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique application identifier',
            },
            name: {
              type: 'string',
              description: 'Application display name',
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Application base URL',
            },
            iconUrl: {
              type: 'string',
              format: 'uri',
              description: 'Application icon URL',
            },
            isActive: {
              type: 'boolean',
              description: 'Whether the application is active',
            },
            isHealthy: {
              type: 'boolean',
              description: 'Current health status of the application',
            },
            integrationType: {
              type: 'string',
              enum: ['module-federation', 'iframe', 'web-component'],
              description: 'How the application integrates with FrontFuse',
            },
            remoteUrl: {
              type: 'string',
              format: 'uri',
              description:
                'URL to the Module Federation remote entry (for module-federation type)',
            },
            scope: {
              type: 'string',
              description:
                'Module Federation scope name (for module-federation type)',
            },
            module: {
              type: 'string',
              description:
                'Module Federation exposed module path (for module-federation type)',
            },
            description: {
              type: 'string',
              description: 'Application description',
            },
          },
          required: ['id', 'name', 'url', 'isActive', 'integrationType'],
        },
        LoginRequest: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            password: {
              type: 'string',
              description: 'User password',
            },
          },
          required: ['email', 'password'],
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'JWT authentication token',
            },
            user: {
              $ref: '#/components/schemas/User',
            },
          },
          required: ['token', 'user'],
        },
        CreateAppRequest: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Application display name',
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Application base URL',
            },
            iconUrl: {
              type: 'string',
              format: 'uri',
              description: 'Application icon URL (optional)',
            },
            integrationType: {
              type: 'string',
              enum: ['module-federation', 'iframe', 'web-component'],
              description: 'How the application integrates with FrontFuse',
              default: 'iframe',
            },
            remoteUrl: {
              type: 'string',
              format: 'uri',
              description:
                'URL to the Module Federation remote entry (required for module-federation)',
            },
            scope: {
              type: 'string',
              description:
                'Module Federation scope name (required for module-federation)',
            },
            module: {
              type: 'string',
              description:
                'Module Federation exposed module path (required for module-federation)',
            },
            description: {
              type: 'string',
              description: 'Application description (optional)',
            },
          },
          required: ['name', 'url'],
        },
        HeartbeatRequest: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['online', 'offline'],
              description: 'Application status',
              default: 'online',
            },
            metadata: {
              type: 'object',
              properties: {
                version: {
                  type: 'string',
                  description: 'Application version',
                },
                port: {
                  type: 'number',
                  description: 'Application port',
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Heartbeat timestamp',
                },
              },
              description: 'Additional metadata about the application',
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'error'],
              description: 'Overall health status',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Health check timestamp',
            },
            uptime: {
              type: 'number',
              description: 'Server uptime in seconds',
            },
            version: {
              type: 'string',
              description: 'API version',
            },
            environment: {
              type: 'string',
              description: 'Current environment (development, production)',
            },
            memory: {
              type: 'object',
              properties: {
                used: {
                  type: 'number',
                  description: 'Used memory in MB',
                },
                total: {
                  type: 'number',
                  description: 'Total allocated memory in MB',
                },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
          },
          required: ['error'],
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/index.ts'], // Path to the API docs
}

const specs = swaggerJsdoc(options)

module.exports = { specs, swaggerUi }
