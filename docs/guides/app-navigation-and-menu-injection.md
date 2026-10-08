# App Navigation, Runtime Menu Injection & Org-Context Gating Guide

## Overview

FuzeFront hosts a federated fleet of microfrontends (FuzeExecutive, FuzeBI, FuzeFinance, etc.) using Webpack / Vite Module Federation. To maintain strict platform decoupling, **FuzeFront does not hardcode application routes, submenus, or internal structures**.

Instead, apps dynamically publish their navigation hierarchies into the host portal runtime via the `window.__FUZEFRONT__` bridge contract, while FuzeFront's shell (`SidePanel`, `TopBar`, and `TenantSelector`) provides standardized layout rendering, org-context gating, and tenant synchronization.

---

## 1. Supported Navigation Patterns

FuzeFront supports three distinct navigation patterns to accommodate different application complexity:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Pattern A: Atlassian / Sentry Style (Nested Submenu in Portal Sidebar) │
│                                                                        │
│   FuzeFront Sidebar                                                   │
│   ├── 🏠 Portal Home                                                  │
│   ├── 📦 Applications                                                 │
│   └── 📈 Executive Studio (Active App)                                │
│       ├── 📊 Overview                                                 │
│       ├── 🗺️ Strategic Decisions                                      │
│       ├── 📄 Business Plan                                            │
│       └── 👥 Investor CRM                                             │
│   ├── 💳 Billing                                                      │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Pattern B: Full Menu Substitution (App Takes Over Entire Sidebar)      │
│                                                                        │
│   Dedicated App Sidebar (with portal back-nav button at top)          │
│   ├── ⬅ Back to Portal                                                │
│   ├── [App Logo & Name]                                               │
│   ├── Section 1                                                       │
│   └── Section 2                                                       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Pattern C: Contextual In-App Navigation (App Manages Internal Layout)  │
│                                                                        │
│   Portal Sidebar remains static; App renders internal tabs / headers: │
│   ├── [Tab 1: Summary]  [Tab 2: Details]  [Tab 3: Settings]           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Pattern A: Atlassian / Sentry Style Runtime Menu Injection

This is the recommended convention for apps with 3–8 primary views (such as FuzeExecutive).

### Registration via `window.__FUZEFRONT__.menu`

When your federated app mounts, inject your sub-navigation items using the runtime bridge:

```typescript
import { useEffect } from 'react';

const EXECUTIVE_MENU_ITEMS = [
  { id: 'overview', label: 'Overview', icon: '📈', route: '/overview', order: 1 },
  { id: 'decisions', label: 'Strategic Decisions', icon: '🗺️', route: '/decisions', order: 2 },
  { id: 'business-plan', label: 'Business Plan', icon: '📄', route: '/business-plan', order: 3 },
  { id: 'investor-crm', label: 'Investor CRM', icon: '👥', route: '/investor-crm', order: 4 },
  { id: 'defender', label: 'AI Defender', icon: '🤖', route: '/defender', order: 5 },
  { id: 'governance', label: 'Governance', icon: '🛡️', route: '/governance', order: 6 },
];

export function useAppMenuInjection(appId: string) {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__FUZEFRONT__?.menu) {
      const bridge = (window as any).__FUZEFRONT__;
      // Inject items under the active app in FuzeFront's sidebar
      bridge.menu.add(appId, EXECUTIVE_MENU_ITEMS);

      // Clean up when the app unmounts
      return () => {
        bridge.menu.remove(appId);
      };
    }
  }, [appId]);
}
```

### Handling Navigation

When a user clicks an injected submenu item in FuzeFront's left sidebar:
1. If the item provides a `route`, FuzeFront updates the browser URL to `/app/{appSlug}/{route}`.
2. FuzeFront dispatches a `fuzefront:navigate` CustomEvent with `{ id, section }`.
3. If the item defines an `action` callback, it is executed.

Your app can listen for navigation events or subscribe to router changes:

```typescript
useEffect(() => {
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<{ id: string; section: string }>;
    if (customEvent.detail?.section) {
      setActiveSection(customEvent.detail.section);
    }
  };
  window.addEventListener('fuzefront:navigate', handler);
  return () => window.removeEventListener('fuzefront:navigate', handler);
}, []);
```

---

## 3. Pattern B: Full Menu Substitution

For complex enterprise tools that require their own distinct, full-height navigation hierarchy:

1. In your app registration manifest (`manifest.json` / registry), set:
   ```json
   {
     "chrome": {
       "mode": "substituted",
       "items": [
         { "id": "dash", "label": "Dashboard", "route": "/dashboard", "order": 1 },
         { "id": "reports", "label": "Reports", "route": "/reports", "order": 2 }
       ]
     }
   }
   ```
2. When the user navigates into your app, FuzeFront transitions the sidebar into a dedicated app view with a seam line and a back button returning to the portal.

---

## 4. Organizational Context Gating

Certain enterprise apps require an active organization context and must not be accessed from a Personal account context.

### Declaring Org-Only Requirement

In your app registration manifest or `@izzywdev/fuzefront-sdk-react` App configuration:

```json
{
  "slug": "executive",
  "name": "FuzeExecutive",
  "requiresOrgContext": true,
  "visibility": "organization"
}
```

### Feature Flag Enforcement

FuzeFront evaluates two Unleash feature flags when the user is in personal context (`activeOrganizationId === null`):

1. **`fuzefront.apps.org-context-disabled` (Default: ON in Production)**:
   - Displays the app in the sidebar and launcher with semi-opacity, an `Org only` badge, and a tooltip (`"Requires active organization context"`).
   - Navigation clicks are disabled.
2. **`fuzefront.apps.org-context-hidden` (Default: OFF in Production)**:
   - Completely removes the app from navigation and launchers when in personal account context.

---

## 5. Subscribing to Organization & Tenant Changes

Hosted MFEs must not duplicate tenant selection dropdowns inside their view. The global tenant selector lives in FuzeFront's TopBar.

Apps subscribe to active tenant changes via `window.__FUZEFRONT__.subscribe`:

```typescript
import { useState, useEffect } from 'react';

export function useHostOrganization() {
  const [activeOrg, setActiveOrg] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__FUZEFRONT__?.subscribe) {
      return;
    }
    const bridge = (window as any).__FUZEFRONT__;

    // Read initial snapshot
    const initial = bridge.getContext?.();
    if (initial?.activeOrganization) {
      setActiveOrg(initial.activeOrganization);
    }

    // Subscribe to live context switches from TopBar TenantSelector
    const unsubscribe = bridge.subscribe((ctx: any) => {
      if (ctx?.activeOrganization) {
        setActiveOrg(ctx.activeOrganization);
      }
    });

    return unsubscribe;
  }, []);

  return activeOrg;
}
```

---

## 6. Summary Checklist for Microfrontend Teams

- [ ] Declare `requiresOrgContext: true` in your manifest if your app is tenant-only.
- [ ] Inject dynamic menu items on mount via `window.__FUZEFRONT__.menu.add(appId, items)`.
- [ ] Remove duplicate tenant switchers from internal views — rely on `TopBar.TenantSelector`.
- [ ] Subscribe to `window.__FUZEFRONT__.subscribe` to reactively re-query or filter data when the organization changes.
- [ ] Clean up on unmount using `window.__FUZEFRONT__.menu.remove(appId)`.
