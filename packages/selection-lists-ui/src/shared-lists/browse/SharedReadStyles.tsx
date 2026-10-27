/**
 * The responsive rules of the shared-read flow (frame 11): at <= 40em the
 * Key / Values / Updated / Item-id columns drop, the primary action goes
 * full-width above the notice, and touch targets reach the design system's
 * `--touch-target`. Inline styles cannot carry a media query, so — like the
 * design system's own components — one `<style>` block per page carries them.
 * Tokens and logical properties only.
 */

const CSS = `
  .fz-sl-cta { display: inline-flex; }
  .fz-sl-link { color: var(--accent-2); text-decoration: none; }
  .fz-sl-link:hover { text-decoration: underline; }
  .fz-sl-link:focus-visible,
  .fz-sl-switch:focus-visible,
  .fz-sl-tab:focus-visible {
    outline: var(--border-width-strong) solid var(--accent-color);
    outline-offset: var(--border-width-strong);
    border-radius: var(--radius-sm);
  }
  .fz-sl-scroll { max-inline-size: 100%; overflow-x: auto; }
  @media (max-width: 40em) {
    .fz-sl-hide-sm { display: none !important; }
    .fz-sl-icon-only-sm {
      position: absolute;
      inline-size: var(--border-width);
      block-size: var(--border-width);
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .fz-sl-head { flex-direction: column; align-items: stretch; }
    .fz-sl-cta { display: flex; inline-size: 100%; }
    .fz-sl-cta > * { inline-size: 100%; min-block-size: var(--touch-target); }
    .fz-sl-link, .fz-sl-tab { min-block-size: var(--touch-target); display: inline-flex; align-items: center; }
    .fz-sl-table th, .fz-sl-table td { padding-inline: var(--space-2); }
  }
`

export function SharedReadStyles() {
  return <style>{CSS}</style>
}
