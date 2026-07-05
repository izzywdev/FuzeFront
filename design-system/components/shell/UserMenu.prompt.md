The host shell's top-bar account control — an Avatar button (initials on the "fuse" gradient) that opens a dropdown with the user's name/email/role and the account actions: Profile, Settings, an admin-gated Admin row, and a coral-toned Sign out.

```jsx
<UserMenu
  user={{ firstName: "Iris", lastName: "Vale", email: "iris@fuze.dev", roles: ["admin"] }}
  onNavigate={(path) => router.push(path)}
  onSignOut={() => auth.signOut()}
/>

// Non-admin: the Admin row is hidden, role tag reads "User".
<UserMenu
  user={{ firstName: "Sam", email: "sam@fuze.dev", roles: ["user"] }}
  onNavigate={go}
  onSignOut={signOut}
/>

// Email-only user: initials + display name fall back to the email.
<UserMenu user={{ email: "ops@fuze.dev" }} onNavigate={go} onSignOut={signOut} />
```

Props: `user` ({ firstName, lastName, email, roles }; renders nothing when null), `onNavigate(path)` for Profile `/profile`, Settings `/settings`, Admin `/admin`, and `onSignOut()`. The Admin row and "Administrator" role tag appear only when `roles` includes `"admin"`.
