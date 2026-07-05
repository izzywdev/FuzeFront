A mono accent pill that labels how a remote module fuses into the shell — the technical integration-type tag on launcher cards.

```jsx
<IntegrationBadge type="module-federation" />
<IntegrationBadge type="iframe" />
<IntegrationBadge type="web-component" />
<IntegrationBadge type={app.integrationType} />
```

One prop: `type` (`module-federation | iframe | web-component | …`) — rendered lowercase in `--font-mono` with `--accent-soft` background and `--accent-color` text; unknown strings render with the same accent styling.
