The elevated, seam-topped card chrome for standalone auth-style forms — sign in / sign up, create-organization, provisioning. Renders the "fuse seam" gradient accent along its top edge and sits inside a page's own content area (it centers itself horizontally, it does not own full-viewport centering — use `CenteredCard` for that).

```jsx
<AuthCard>
  <h2>Sign in</h2>
  <form>…</form>
</AuthCard>

<AuthCard align="center">
  <p>✓</p>
  <h3>Success</h3>
</AuthCard>

<AuthCard maxWidth="480px">
  <h2>Create organization</h2>
</AuthCard>
```

`align`: `left | center` (default `left`) — use `center` for a confirmation/success state. `maxWidth`: any CSS length, defaults to `400px`. Replaces the hand-rolled `className="auth-form"` (`frontend/src/index.css`) previously duplicated in `LoginPage` and `CreateOrganizationPage`.
