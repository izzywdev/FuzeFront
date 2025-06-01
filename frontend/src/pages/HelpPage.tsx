import React, { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrentUser } from '@frontfuse/shared'

interface TabProps {
  id: string
  label: string
  icon: string
}

function HelpPage() {
  const { t } = useLanguage()
  const { user } = useCurrentUser()
  const [activeTab, setActiveTab] = useState('getting-started')

  const tabs: TabProps[] = [
    { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
    { id: 'api-docs', label: 'API Documentation', icon: '📚' },
    { id: 'developer-guide', label: 'Developer Guide', icon: '👨‍💻' },
    { id: 'deployment', label: 'Deployment Guide', icon: '🚀' },
    { id: 'support', label: 'Support', icon: '🆘' },
  ]

  const renderTabContent = () => {
    switch (activeTab) {
      case 'getting-started':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>🎯 Welcome to FrontFuse</h3>
              <p>
                FrontFuse is a powerful microfrontend hosting platform that
                enables you to build, deploy, and manage federated applications
                seamlessly.
              </p>

              <h4>Quick Start</h4>
              <ol>
                <li>
                  <strong>Login</strong>: Use your credentials to access the
                  platform
                </li>
                <li>
                  <strong>Explore Apps</strong>: Browse available applications
                  in the dashboard
                </li>
                <li>
                  <strong>Navigate</strong>: Use the left sidebar to access
                  different features
                </li>
                <li>
                  <strong>Develop</strong>: Create your own pluggable
                  applications
                </li>
              </ol>

              <h4>Key Features</h4>
              <ul>
                <li>
                  🔐 <strong>Secure Authentication</strong>: JWT-based user
                  sessions
                </li>
                <li>
                  🧩 <strong>Module Federation</strong>: Dynamic loading of
                  React applications
                </li>
                <li>
                  📱 <strong>Responsive Design</strong>: Works on desktop and
                  mobile
                </li>
                <li>
                  🌐 <strong>Multi-language Support</strong>: English and Hebrew
                </li>
                <li>
                  ⚡ <strong>Real-time Updates</strong>: WebSocket communication
                </li>
                <li>
                  🎨 <strong>Customizable Menus</strong>: Apps can register
                  their own menu items
                </li>
              </ul>

              <h4>User Roles</h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                  gap: '1rem',
                  marginTop: '1rem',
                }}
              >
                <div
                  style={{
                    padding: '1rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                  }}
                >
                  <h5>👤 User</h5>
                  <p>Access registered applications and personal data</p>
                </div>
                <div
                  style={{
                    padding: '1rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                  }}
                >
                  <h5>👑 Admin</h5>
                  <p>Manage applications, users, and platform settings</p>
                </div>
              </div>
            </div>
          </div>
        )

      case 'api-docs':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>📚 API Documentation</h3>
              <p>
                FrontFuse provides a comprehensive REST API for managing
                applications, authentication, and platform features.
              </p>

              <div className="api-section">
                <h4>🔗 Interactive API Documentation</h4>
                <p>
                  Access the full Swagger documentation with interactive
                  examples:
                </p>
                <div className="api-link-container">
                  <a
                    href="http://localhost:3001/api-docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="api-link"
                  >
                    🌐 Open API Documentation
                  </a>
                </div>
                <p>
                  <small>
                    Note: The API documentation opens in a new tab and requires
                    the backend server to be running.
                  </small>
                </p>
              </div>

              <h4>🔑 Authentication</h4>
              <p>Most API endpoints require authentication via JWT token:</p>
              <div className="code-block">
                <pre>{`Authorization: Bearer <your-jwt-token>`}</pre>
              </div>

              <h4>📋 Main Endpoints</h4>
              <div className="endpoint-grid">
                <div className="endpoint-card">
                  <h5>🔐 Authentication</h5>
                  <ul>
                    <li>
                      <code>POST /api/auth/login</code> - User login
                    </li>
                    <li>
                      <code>GET /api/auth/user</code> - Get current user
                    </li>
                    <li>
                      <code>POST /api/auth/logout</code> - User logout
                    </li>
                  </ul>
                </div>

                <div className="endpoint-card">
                  <h5>📱 Applications</h5>
                  <ul>
                    <li>
                      <code>GET /api/apps</code> - List all apps
                    </li>
                    <li>
                      <code>POST /api/apps</code> - Register new app
                    </li>
                    <li>
                      <code>PUT /api/apps/:id/activate</code> - Toggle app
                      status
                    </li>
                    <li>
                      <code>DELETE /api/apps/:id</code> - Remove app
                    </li>
                  </ul>
                </div>

                <div className="endpoint-card">
                  <h5>💓 Health & Monitoring</h5>
                  <ul>
                    <li>
                      <code>GET /health</code> - Platform health check
                    </li>
                    <li>
                      <code>POST /api/apps/:id/heartbeat</code> - App heartbeat
                    </li>
                  </ul>
                </div>
              </div>

              <h4>🧪 Example Usage</h4>
              <div className="code-block">
                <pre>{`// Login to get JWT token
curl -X POST http://localhost:3001/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "admin@frontfuse.dev", "password": "admin123"}'

// Register a new application
curl -X POST http://localhost:3001/api/apps \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -d '{
    "name": "My App",
    "url": "https://my-app.netlify.app",
    "integrationType": "module-federation",
    "remoteUrl": "https://my-app.netlify.app/assets/remoteEntry.js",
    "scope": "myApp",
    "module": "./App"
  }'`}</pre>
              </div>
            </div>
          </div>
        )

      case 'developer-guide':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>👨‍💻 Developer Guide</h3>
              <p>
                Learn how to create and deploy your own pluggable applications
                for the FrontFuse platform.
              </p>

              <h4>🏗️ Architecture Overview</h4>
              <p>
                FrontFuse uses a hub-and-spoke architecture with these key
                components:
              </p>
              <ul>
                <li>
                  <strong>Platform Core</strong>: Main portal hosting and
                  managing applications
                </li>
                <li>
                  <strong>Federated Apps</strong>: Independent applications that
                  integrate seamlessly
                </li>
                <li>
                  <strong>SDK</strong>: Shared utilities and context for
                  integration
                </li>
                <li>
                  <strong>API</strong>: Backend services for authentication and
                  management
                </li>
              </ul>

              <h4>🚀 Quick Start</h4>
              <div className="step-by-step">
                <div className="step">
                  <h5>1. Create React App</h5>
                  <div className="code-block">
                    <pre>{`npm create vite@latest my-frontfuse-app -- --template react-ts
cd my-frontfuse-app
npm install`}</pre>
                  </div>
                </div>

                <div className="step">
                  <h5>2. Install FrontFuse SDK</h5>
                  <div className="code-block">
                    <pre>{`npm install @frontfuse/sdk`}</pre>
                  </div>
                </div>

                <div className="step">
                  <h5>3. Configure Module Federation</h5>
                  <div className="code-block">
                    <pre>{`npm install @originjs/vite-plugin-federation --save-dev`}</pre>
                  </div>
                </div>

                <div className="step">
                  <h5>4. Update vite.config.ts</h5>
                  <div className="code-block">
                    <pre>{`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'myApp',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.tsx',
      },
      shared: ['react', 'react-dom']
    })
  ],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: false,
    cssCodeSplit: false
  }
})`}</pre>
                  </div>
                </div>
              </div>

              <h4>🔧 Integration Types</h4>
              <div className="integration-types">
                <div className="integration-card">
                  <h5>🧩 Module Federation (Recommended)</h5>
                  <p>
                    <strong>Best for:</strong> React applications
                  </p>
                  <p>
                    <strong>Pros:</strong> Shared dependencies, seamless
                    integration, optimal performance
                  </p>
                </div>

                <div className="integration-card">
                  <h5>🖼️ Iframe</h5>
                  <p>
                    <strong>Best for:</strong> Legacy applications, non-React
                    apps
                  </p>
                  <p>
                    <strong>Pros:</strong> Technology agnostic, easy integration
                  </p>
                </div>

                <div className="integration-card">
                  <h5>🧱 Web Components</h5>
                  <p>
                    <strong>Best for:</strong> Framework-agnostic components
                  </p>
                  <p>
                    <strong>Pros:</strong> Standard-based, reusable
                  </p>
                </div>
              </div>

              <h4>📖 Complete Guide</h4>
              <p>
                For a comprehensive developer guide with detailed examples, code
                samples, and best practices:
              </p>
              <div className="guide-link-container">
                <a
                  href="/docs/developer-guide.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="guide-link"
                >
                  📚 View Complete Developer Guide
                </a>
              </div>
            </div>
          </div>
        )

      case 'deployment':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>🚀 Deployment Guide</h3>
              <p>
                Deploy your FrontFuse applications to production with these
                step-by-step instructions.
              </p>

              <h4>📦 Build Your Application</h4>
              <div className="code-block">
                <pre>{`npm run build`}</pre>
              </div>

              <h4>☁️ Deployment Options</h4>

              <div className="deployment-options">
                <div className="deployment-card">
                  <h5>🌐 Netlify</h5>
                  <div className="code-block">
                    <pre>{`# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist`}</pre>
                  </div>
                </div>

                <div className="deployment-card">
                  <h5>▲ Vercel</h5>
                  <div className="code-block">
                    <pre>{`# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod`}</pre>
                  </div>
                </div>

                <div className="deployment-card">
                  <h5>☁️ AWS S3 + CloudFront</h5>
                  <div className="code-block">
                    <pre>{`# Build and sync to S3
npm run build
aws s3 sync dist/ s3://your-bucket-name --delete
aws cloudfront create-invalidation \\
  --distribution-id YOUR_DISTRIBUTION_ID \\
  --paths "/*"`}</pre>
                  </div>
                </div>
              </div>

              <h4>📝 Register Your App</h4>
              <p>Once deployed, register your application with FrontFuse:</p>
              <div className="code-block">
                <pre>{`curl -X POST http://localhost:3001/api/apps \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -d '{
    "name": "My App",
    "url": "https://my-app.netlify.app",
    "iconUrl": "https://my-app.netlify.app/icon.svg",
    "integrationType": "module-federation",
    "remoteUrl": "https://my-app.netlify.app/assets/remoteEntry.js",
    "scope": "myApp",
    "module": "./App",
    "description": "My awesome microfrontend application"
  }'`}</pre>
              </div>

              <h4>⚙️ Environment Configuration</h4>
              <p>Configure your application for different environments:</p>
              <div className="code-block">
                <pre>{`// src/config/index.ts
const config = {
  development: {
    apiUrl: 'http://localhost:3001',
    appUrl: 'http://localhost:3003'
  },
  production: {
    apiUrl: 'https://api.frontfuse.dev',
    appUrl: 'https://my-app.netlify.app'
  }
}

export default config[process.env.NODE_ENV || 'development']`}</pre>
              </div>

              <h4>✅ Best Practices</h4>
              <ul>
                <li>🔒 Use HTTPS in production</li>
                <li>🗜️ Enable gzip compression</li>
                <li>📱 Test on multiple devices</li>
                <li>🔍 Monitor application health</li>
                <li>📊 Set up error tracking</li>
                <li>🚀 Implement CI/CD pipelines</li>
              </ul>
            </div>
          </div>
        )

      case 'support':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>🆘 Support & Resources</h3>
              <p>
                Get help, report issues, and connect with the FrontFuse
                community.
              </p>

              <h4>📞 Contact Information</h4>
              <div className="contact-grid">
                <div className="contact-card">
                  <h5>📧 Email Support</h5>
                  <p>support@frontfuse.dev</p>
                  <p>
                    <small>Response time: 24-48 hours</small>
                  </p>
                </div>

                <div className="contact-card">
                  <h5>💬 Discord Community</h5>
                  <p>Join our Discord server for real-time help</p>
                  <a
                    href="https://discord.gg/frontfuse"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Join Discord
                  </a>
                </div>

                <div className="contact-card">
                  <h5>🐛 GitHub Issues</h5>
                  <p>Report bugs and request features</p>
                  <a
                    href="https://github.com/your-org/frontfuse/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Issue
                  </a>
                </div>
              </div>

              <h4>📚 Documentation</h4>
              <ul>
                <li>
                  <a
                    href="https://docs.frontfuse.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Official Documentation
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.frontfuse.dev/api"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    API Reference
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.frontfuse.dev/examples"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Code Examples
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.frontfuse.dev/tutorials"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Video Tutorials
                  </a>
                </li>
              </ul>

              <h4>🔧 Troubleshooting</h4>
              <div className="troubleshooting-section">
                <details>
                  <summary>Module Federation Loading Errors</summary>
                  <p>
                    <strong>Error:</strong> "Loading chunk failed"
                  </p>
                  <p>
                    <strong>Solution:</strong> Check that your remoteUrl is
                    correct and accessible.
                  </p>
                </details>

                <details>
                  <summary>Authentication Issues</summary>
                  <p>
                    <strong>Error:</strong> "User is undefined"
                  </p>
                  <p>
                    <strong>Solution:</strong> Ensure your app is wrapped in
                    PlatformProvider and the user is logged in.
                  </p>
                </details>

                <details>
                  <summary>Menu Items Not Appearing</summary>
                  <p>
                    <strong>Solution:</strong> Check that you're calling
                    addAppMenuItems after authentication with the correct
                    format.
                  </p>
                </details>
              </div>

              <h4>🤝 Contributing</h4>
              <p>We welcome contributions! Here's how you can help:</p>
              <ul>
                <li>🐛 Report bugs and issues</li>
                <li>💡 Suggest new features</li>
                <li>📝 Improve documentation</li>
                <li>🔧 Submit pull requests</li>
                <li>🌟 Star the repository</li>
              </ul>

              <h4>📄 License</h4>
              <p>
                FrontFuse is licensed under the MIT License. See the LICENSE
                file for details.
              </p>

              <h4>ℹ️ System Information</h4>
              {user && (
                <div className="system-info">
                  <p>
                    <strong>User:</strong> {user.firstName} {user.lastName} (
                    {user.email})
                  </p>
                  <p>
                    <strong>Roles:</strong> {user.roles?.join(', ')}
                  </p>
                  <p>
                    <strong>Platform Version:</strong> 1.0.0
                  </p>
                  <p>
                    <strong>Environment:</strong>{' '}
                    {process.env.NODE_ENV || 'development'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )

      default:
        return <div>Content not found</div>
    }
  }

  return (
    <div className="help-page">
      <div className="help-header">
        <h1>🆘 Help & Documentation</h1>
        <p>
          Everything you need to know about using and developing with FrontFuse
        </p>
      </div>

      <div className="help-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`help-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="help-content-container">{renderTabContent()}</div>
    </div>
  )
}

export default HelpPage
