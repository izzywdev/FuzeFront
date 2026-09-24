# Cross-Product Microfrontend Adoption Prompt: Menu Injection & Tenant Synchronization

This prompt can be copied and provided directly to development agents or engineering teams working on any Fuze family microfrontend (e.g., FuzeBI, FuzeFinance, FuzeCRM, FuzeService):

---

```markdown
### TASK: Adopt FuzeFront Standard for Runtime Menu Injection & Centralized Tenant Synchronization

Please update this microfrontend repository to conform to the FuzeFront portal federation standard for left-side navigation injection and centralized tenant context:

1. **Adopt Atlassian / Sentry Style Left-Menu Injection**:
   - Do NOT render a duplicate top navigation bar or full custom sidebar for primary app views.
   - When the application mounts inside FuzeFront (`window.__FUZEFRONT__`), dynamically register your sub-navigation items using:
     ```typescript
     window.__FUZEFRONT__.menu.add(APP_ID, [
       { id: 'view-1', label: 'Dashboard', icon: '📊', route: '/dashboard', order: 1 },
       { id: 'view-2', label: 'Analytics', icon: '📈', route: '/analytics', order: 2 },
       { id: 'view-3', label: 'Settings', icon: '⚙️', route: '/settings', order: 3 },
     ]);
     ```
   - Unregister on unmount with `window.__FUZEFRONT__.menu.remove(APP_ID)`.
   - Listen for navigation events via `window.addEventListener('fuzefront:navigate', (e) => ...)` and route changes to switch active views seamlessly.

2. **Deduplicate Tenant & Organization Switching**:
   - Remove any local tenant / organization selector dropdowns from the application's internal views or sidebars. The tenant selector is now globally centralized in FuzeFront's portal TopBar.
   - Subscribe to the host portal bridge context to receive live active organization updates:
     ```typescript
     const bridge = window.__FUZEFRONT__;
     const initialCtx = bridge.getContext?.();
     if (initialCtx?.activeOrganization) {
       setActiveOrg(initialCtx.activeOrganization);
     }
     const unsubscribe = bridge.subscribe((ctx) => {
       if (ctx?.activeOrganization) {
         setActiveOrg(ctx.activeOrganization);
       }
     });
     ```
   - When `activeOrganization` changes, automatically re-query or filter application state to the selected organization.

3. **Declare Organization-Context Requirements**:
   - If this application requires an organization to operate (i.e. is not intended for personal account context), ensure your app registration manifest sets:
     ```json
     {
       "requiresOrgContext": true,
       "visibility": "organization"
     }
     ```
   - FuzeFront's shell will automatically gate access and render an "Org only" disabled badge when users are in personal context under the `fuzefront.apps.org-context-disabled` feature flag.

4. **Preserve Standalone Development Fallback**:
   - If `window.__FUZEFRONT__` is not present (e.g. running locally via standalone dev server), render a lightweight mock shell or fallback navigation so local unit and component testing continue to work out of the box.

Reference Architecture & Details:
- Documentation: `https://github.com/izzywdev/FuzeFront/blob/master/docs/guides/app-navigation-and-menu-injection.md`
- Reference Implementation: `FuzeExecutive` (`frontend-mfe/src/App.tsx` and `frontend-mfe/src/services/fuzefront.ts`)
```
