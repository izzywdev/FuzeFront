import { useState, type ReactNode } from 'react'
import { useCurrentUser } from '../lib/shared'

// Canonical, version-controlled help content lives in docs/help/** (source of record,
// governed by gate-help-conformance). Until the in-app content-driven renderer ships
// (tracked follow-up: it needs product-designer frames + ui-runtime-validation), the Help
// Center renders accurate overviews here and links to the full guides and the Developer
// Portal. No fact is hard-coded here that is not verified against the current platform.
const DOCS = 'https://github.com/izzywdev/FuzeFront/tree/master/docs/help'
const USER_GUIDE = `${DOCS}/user-guide`
const DEV_GUIDE = `${DOCS}/developer-guide`
const DEV_PORTAL = 'https://developers.fuzefront.com'
const ISSUES = 'https://github.com/izzywdev/FuzeFront/issues'

interface TabProps {
  id: string
  label: string
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

function HelpPage() {
  const { user } = useCurrentUser()
  const [activeTab, setActiveTab] = useState('getting-started')

  const tabs: TabProps[] = [
    { id: 'getting-started', label: 'Getting Started' },
    { id: 'user-guide', label: 'User Guide' },
    { id: 'developer-guide', label: 'Developer Guide' },
    { id: 'developer-portal', label: 'Developer Portal' },
    { id: 'support', label: 'Support' },
  ]

  const renderTabContent = () => {
    switch (activeTab) {
      case 'getting-started':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>Welcome to FuzeFront</h3>
              <p>
                FuzeFront is a micro-frontend hosting platform. The portal is the host shell:
                independent applications ("remotes") are mounted into it and run side by side under a
                single sign-in, a shared design system, and one navigation.
              </p>

              <h4>Quick start</h4>
              <ol>
                <li>
                  <strong>Sign in</strong>: create an account or sign in with your email and
                  password, or with Google. Authentication is handled by Authentik, and one session
                  carries across every app in the portal.
                </li>
                <li>
                  <strong>Find your apps</strong>: the left sidebar lists the applications available
                  to you. Select one to launch it inside the portal.
                </li>
                <li>
                  <strong>Set your context</strong>: switch organization, language, and theme from
                  the top bar.
                </li>
                <li>
                  <strong>Build</strong>: developers can add their own apps — see the{' '}
                  <ExternalLink href={DEV_GUIDE}>Developer Guide</ExternalLink>.
                </li>
              </ol>

              <h4>Key capabilities</h4>
              <ul>
                <li>
                  <strong>Single sign-on</strong>: one authenticated session spans every app
                  mounted in the portal (identity via Authentik/OIDC).
                </li>
                <li>
                  <strong>Module Federation</strong> for dynamically loading React applications into
                  the shell.
                </li>
                <li>
                  <strong>Fine-grained authorization</strong> enforced by Permit, scoped to your
                  organization and role.
                </li>
                <li>
                  <strong>Responsive and installable</strong> on desktop, as a PWA, and as a signed
                  Android app.
                </li>
                <li>
                  <strong>Multi-language</strong>, including right-to-left (English and Hebrew).
                </li>
              </ul>

              <h4>Where to go next</h4>
              <div className="endpoint-grid">
                <div className="endpoint-card">
                  <h5>New to the portal</h5>
                  <p>
                    Start with the{' '}
                    <ExternalLink href={`${USER_GUIDE}/getting-started.md`}>
                      User Guide
                    </ExternalLink>
                    .
                  </p>
                </div>
                <div className="endpoint-card">
                  <h5>Building an app</h5>
                  <p>
                    Start with the{' '}
                    <ExternalLink href={`${DEV_GUIDE}/overview.md`}>Developer Guide</ExternalLink>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )

      case 'user-guide':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>User Guide</h3>
              <p>
                Everything you need to use the FuzeFront portal day to day. Full articles are in the{' '}
                <ExternalLink href={USER_GUIDE}>user guide</ExternalLink>.
              </p>
              <div className="endpoint-grid">
                <div className="endpoint-card">
                  <h5>Navigating the portal</h5>
                  <p>The sidebar, app launcher, top bar, language and theme.</p>
                  <ExternalLink href={`${USER_GUIDE}/navigating-the-portal.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Organizations &amp; teams</h5>
                  <p>Organizations, membership roles, and switching between them.</p>
                  <ExternalLink href={`${USER_GUIDE}/organizations-and-teams.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Installing &amp; using apps</h5>
                  <p>Finding, launching, and managing the applications available to you.</p>
                  <ExternalLink href={`${USER_GUIDE}/installing-and-using-apps.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Account &amp; security</h5>
                  <p>Your profile, sign-in security, two-factor, and active sessions.</p>
                  <ExternalLink href={`${USER_GUIDE}/account-and-security.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Billing &amp; plans</h5>
                  <p>Subscription plans and what each includes.</p>
                  <ExternalLink href={`${USER_GUIDE}/billing-and-plans.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Mobile app</h5>
                  <p>Installing FuzeFront as a PWA or the signed Android app.</p>
                  <ExternalLink href={`${USER_GUIDE}/mobile-app.md`}>Read</ExternalLink>
                </div>
              </div>
            </div>
          </div>
        )

      case 'developer-guide':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>Developer Guide</h3>
              <p>
                Build, register, and deploy your own micro-frontend or service on FuzeFront. Full
                articles are in the{' '}
                <ExternalLink href={DEV_GUIDE}>developer guide</ExternalLink>; the live API catalog
                and sandbox are in the{' '}
                <ExternalLink href={DEV_PORTAL}>Developer Portal</ExternalLink>.
              </p>

              <h4>Architecture</h4>
              <p>
                FuzeFront is a Module-Federation <strong>host shell</strong>. Your application is a{' '}
                <strong>remote</strong> that the shell loads at runtime. The shell owns the shared
                dependency contract (React and the design system); remotes consume it. The backend
                (Express/Postgres) is reached through a <strong>same-origin API base</strong>, so the
                same code works under local TLS and production ingress.
              </p>

              <h4>Start here</h4>
              <div className="endpoint-grid">
                <div className="endpoint-card">
                  <h5>Overview</h5>
                  <p>The platform, the packages, and where to begin.</p>
                  <ExternalLink href={`${DEV_GUIDE}/overview.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Quickstart</h5>
                  <p>Build a micro-frontend with Vite and Module Federation.</p>
                  <ExternalLink href={`${DEV_GUIDE}/quickstart-build-a-microfrontend.md`}>
                    Read
                  </ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Module Federation contract</h5>
                  <p>
                    The shared-singleton rule: the remote&apos;s React{' '}
                    <code>requiredVersion</code> must match the host, or the app fails at runtime.
                  </p>
                  <ExternalLink href={`${DEV_GUIDE}/module-federation-contract.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Design system</h5>
                  <p>Extend the shared design system; use tokens, never one-off styles.</p>
                  <ExternalLink href={`${DEV_GUIDE}/design-system.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Auth &amp; authorization</h5>
                  <p>Sign in with the shared Authentik identity; authorize with Permit.</p>
                  <ExternalLink href={`${DEV_GUIDE}/authentication-and-authorization.md`}>
                    Read
                  </ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Registering your app</h5>
                  <p>The app registry, and how slug, menu label, and serve path relate.</p>
                  <ExternalLink href={`${DEV_GUIDE}/registering-your-app.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Deployment</h5>
                  <p>GitOps via Helm and Argo — merging to the main branch is the deploy.</p>
                  <ExternalLink href={`${DEV_GUIDE}/deployment.md`}>Read</ExternalLink>
                </div>
                <div className="endpoint-card">
                  <h5>Troubleshooting</h5>
                  <p>Invalid hook calls, blank panels, mixed-content, and failed remote loads.</p>
                  <ExternalLink href={`${DEV_GUIDE}/troubleshooting.md`}>Read</ExternalLink>
                </div>
              </div>
            </div>
          </div>
        )

      case 'developer-portal':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>Developer Portal</h3>
              <p>
                The Developer Portal at{' '}
                <ExternalLink href={DEV_PORTAL}>developers.fuzefront.com</ExternalLink> is the live
                companion to this guide. It signs in with the same FuzeFront identity and gives
                developers an aggregated, navigable catalog of the platform&apos;s APIs plus a safe
                sandbox to try them.
              </p>
              <h4>What it offers</h4>
              <ul>
                <li>
                  <strong>API catalog</strong>: the OpenAPI documentation for every service, in one
                  place.
                </li>
                <li>
                  <strong>Spec viewer</strong>: read each contract with request and response
                  schemas.
                </li>
                <li>
                  <strong>Try it</strong>: exercise an endpoint in a sandbox that never touches a
                  production system.
                </li>
                <li>
                  <strong>My access</strong>: see your developer membership and sandbox activity.
                </li>
              </ul>
              <p>
                <ExternalLink href={DEV_PORTAL}>Open the Developer Portal</ExternalLink>
              </p>
            </div>
          </div>
        )

      case 'support':
        return (
          <div className="help-content">
            <div className="help-card">
              <h3>Support &amp; resources</h3>
              <p>Get help, report a problem, and check platform status.</p>

              <h4>Get help</h4>
              <div className="contact-grid">
                <div className="contact-card">
                  <h5>Report an issue</h5>
                  <p>Report bugs and request features on GitHub.</p>
                  <ExternalLink href={ISSUES}>Open an issue</ExternalLink>
                </div>
                <div className="contact-card">
                  <h5>Platform status</h5>
                  <p>Check the health of the platform and its services.</p>
                  <a href="/status">View status</a>
                </div>
                <div className="contact-card">
                  <h5>Developer Portal</h5>
                  <p>Live API catalog and sandbox for developers.</p>
                  <ExternalLink href={DEV_PORTAL}>Open the portal</ExternalLink>
                </div>
              </div>

              <h4>Documentation</h4>
              <ul>
                <li>
                  <ExternalLink href={USER_GUIDE}>User Guide</ExternalLink>
                </li>
                <li>
                  <ExternalLink href={DEV_GUIDE}>Developer Guide</ExternalLink>
                </li>
                <li>
                  <ExternalLink href={DEV_PORTAL}>Developer Portal (API reference)</ExternalLink>
                </li>
              </ul>

              {user && (
                <div className="system-info">
                  <h4>Your account</h4>
                  <p>
                    <strong>Signed in as:</strong> {user.firstName} {user.lastName} ({user.email})
                  </p>
                  <p>
                    <strong>Roles:</strong> {user.roles?.join(', ') || 'member'}
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
        <h1>Help &amp; Documentation</h1>
        <p>Everything you need to use and build on FuzeFront.</p>
      </div>

      <div className="help-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`help-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="help-content-container">{renderTabContent()}</div>
    </div>
  )
}

export default HelpPage
