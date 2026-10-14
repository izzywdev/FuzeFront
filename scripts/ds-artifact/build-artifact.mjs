#!/usr/bin/env node
/* ============================================================
   FuzeFront Design System — Artifact producer
   ------------------------------------------------------------
   Regenerates the "FuzeFront Fuse Seam" Design System artifact
   from the design-system/ source of truth, into a committed
   docs mirror (default: docs/design-system/artifact/project).

   What it generates, deterministically, with NO runtime deps:
     - tokens.json                    (parsed live from tokens/*.css)
     - README.md                      (brand book; inventory injected)
     - design-system.json             (artifact index; volatile fields preserved)
     - components/<Comp>/README.md     (from <Comp>.prompt.md, else the .d.ts JSDoc)
     - components/<Comp>/preview.html  (authored override in producer/previews/,
                                         else a static usage specimen)
     - components/index.d.ts           (concatenated public type surface)
     - components/Cover/preview.html   (authored cover)

   Usage:
     node scripts/ds-artifact/build-artifact.mjs            # write
     node scripts/ds-artifact/build-artifact.mjs --check    # CI drift gate (exit 1 on drift)
     node scripts/ds-artifact/build-artifact.mjs --out <dir>

   The committed mirror is the reviewable, diffable source the
   gate-ds-artifact workflow enforces on every PR that touches the
   design system. Values track the CSS; prose/ordering/usage notes
   are curated here (the one place they live). See producer/README.md.
   ============================================================ */
import {
  readFileSync, writeFileSync, readdirSync, existsSync, statSync,
  mkdirSync, rmSync, cpSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, relative, resolve } from 'node:path'

const PRODUCER_DIR = dirname(fileURLToPath(import.meta.url))  // scripts/ds-artifact/
const REPO_ROOT = dirname(dirname(PRODUCER_DIR))      // repo root
const DS_ROOT = join(REPO_ROOT, 'design-system')      // the design-system package (read-only input)

const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const outIdx = args.indexOf('--out')
const OUT_DIR = outIdx !== -1
  ? resolve(process.cwd(), args[outIdx + 1])
  : join(REPO_ROOT, 'docs/design-system/artifact/project')

const TITLE = 'FuzeFront Fuse Seam'
const NAMESPACE = 'FuzeFront'
const CREATED_AT = '2026-10-13T12:00:00Z'  // fixed; preserved across regenerations

/* ---- small fs helpers ---------------------------------------------------- */
const read = (p) => readFileSync(p, 'utf8')
const files = {}                 // path-under-project -> text content
const emit = (rel, text) => { files[rel] = text.endsWith('\n') ? text : text + '\n' }

function walkJsx(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkJsx(full, out)
    else if (name.endsWith('.jsx') && !/\.(test|spec|stories)\.jsx$/.test(name)) out.push(full)
  }
  return out
}

/* ---- CSS custom-property parser ------------------------------------------ */
// Returns { base: Map, light: Map } — `base` holds :root + [data-theme=dark]
// (primitives + dark semantics), `light` holds [data-theme=light] overrides.
function parseThemedCss(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const base = new Map()
  const light = new Map()
  const blockRe = /([^{}]+)\{([^{}]*)\}/g
  let b
  while ((b = blockRe.exec(css))) {
    const selector = b[1]
    const body = b[2]
    const target = /\[data-theme=['"]?light['"]?\]/.test(selector) ? light : base
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g
    let d
    while ((d = declRe.exec(body))) target.set(d[1].trim(), d[2].trim())
  }
  return { base, light }
}

// A flat :root-only parser (typography, spacing) -> Map(name -> value).
function parseFlatCss(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const map = new Map()
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(css))) map.set(m[1].trim(), m[2].trim())
  return map
}

// var(--x) -> {x} alias (artifact color grammar); otherwise the literal.
const toColorValue = (v) => {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v.trim())
  return m ? `{${m[1].slice(2)}}` : v.trim()
}

/* ============================================================
   tokens.json  — values parsed from CSS, prose curated here
   ============================================================ */
function buildTokens() {
  const colors = parseThemedCss(read(join(DS_ROOT, 'tokens/colors.css')))
  const typo = parseFlatCss(read(join(DS_ROOT, 'tokens/typography.css')))
  const spacing = parseFlatCss(read(join(DS_ROOT, 'tokens/spacing.css')))

  // ----- colors: primitives (plain) then semantic surface (per theme) -----
  // Curated ORDER + usage; values come live from the CSS map.
  const PRIMITIVES = [
    ['indigo-50', 'Lightest indigo wash — tints on light surfaces.'],
    ['indigo-100', 'Indigo tint — soft accent fills.'],
    ['indigo-300', 'Indigo mid-light — accent text on dark.'],
    ['indigo-400', 'Indigo bright — hover/active highlight.'],
    ['indigo-500', 'The fuse — brand accent on the dark theme.'],
    ['indigo-600', 'The fuse — brand accent on the light theme.'],
    ['indigo-700', 'Accent hover (dark).'],
    ['indigo-800', 'Accent hover (light).'],
    ['cyan-400', 'The signal — cyan end of the seam (dark).'],
    ['cyan-500', 'The signal — cyan end of the seam (light).'],
    ['mint-500', 'Success (dark).'],
    ['mint-600', 'Success (light).'],
    ['amber-500', 'Warning — the one warm spark (dark).'],
    ['amber-600', 'Warning (light).'],
    ['coral-500', 'Error (dark).'],
    ['coral-600', 'Error (light).'],
    ['graphite-950', 'Deepest shell — top bar / app chrome.'],
    ['graphite-900', 'Content canvas.'],
    ['graphite-850', 'Panels & cards.'],
    ['graphite-800', 'Raised / hover / chips.'],
    ['graphite-700', 'Borders.'],
    ['graphite-600', 'Strong dividers.'],
    ['graphite-400', 'Muted text (dark).'],
    ['graphite-300', 'Secondary text (dark).'],
    ['graphite-100', 'Primary text (dark).'],
    ['paper', 'Light shell surface.'],
    ['paper-tint', 'Light content canvas.'],
    ['paper-muted', 'Light raised / hover.'],
    ['line-light', 'Light-theme border.'],
    ['line-strong-light', 'Light-theme strong divider.'],
    ['ink-900', 'Primary text (light).'],
    ['ink-600', 'Secondary text (light).'],
    ['ink-400', 'Muted text (light).'],
  ]
  const SEMANTIC = [
    ['bg-secondary', 'App shell / top bar — the deepest surface.'],
    ['bg-primary', 'Page background / content canvas.'],
    ['bg-tertiary', 'Panels & cards.'],
    ['bg-quaternary', 'Raised surfaces — hover, chips, secondary buttons.'],
    ['border-color', 'Default 1px borders and dividers.'],
    ['border-strong', 'Emphasised dividers and 2px focus rules.'],
    ['text-primary', 'Primary body & heading text. 4.5:1+ on bg-primary/bg-tertiary.'],
    ['text-secondary', 'Secondary text, labels, descriptions.'],
    ['text-tertiary', 'Muted / de-emphasised text; non-essential metadata only.'],
    ['accent-color', 'The fuse — primary CTAs, active nav, focus ring, links.'],
    ['accent-hover', 'Hover/pressed state of accent surfaces.'],
    ['accent-2', 'The signal — cyan half of the seam; secondary classification.'],
    ['accent-soft', 'Faint accent wash — accent badge fills, focus glow.'],
    ['drop-active', 'Drop-zone active fill on drag-over.'],
    ['success-color', 'Success status — healthy, active, verified.'],
    ['warning-color', 'Warning status — degraded, pending, in-progress.'],
    ['error-color', 'Error status — offline, suspended, destructive.'],
    ['success-soft', 'Soft success tint — callout / pill fill.'],
    ['warning-soft', 'Soft warning tint — callout / pill fill.'],
    ['error-soft', 'Soft error tint — callout / pill fill.'],
    ['scrim', 'Modal / dialog scrim dimming the shell behind overlays.'],
  ]

  const colorTokens = []
  for (const [name, usage] of PRIMITIVES) {
    const v = colors.base.get(`--${name}`)
    if (v == null) throw new Error(`tokens: primitive --${name} missing from colors.css`)
    colorTokens.push({ name, value: toColorValue(v), usage })
  }
  for (const [name, usage] of SEMANTIC) {
    const dv = colors.base.get(`--${name}`)
    const lv = colors.light.get(`--${name}`)
    if (dv == null) throw new Error(`tokens: semantic --${name} missing from colors.css (dark)`)
    const dark = toColorValue(dv)
    const light = lv != null ? toColorValue(lv) : dark
    colorTokens.push({ name, value: dark === light ? dark : { dark, light }, usage })
  }
  // on-accent ink is a product constant, not a CSS var — carried explicitly.
  colorTokens.splice(
    colorTokens.findIndex((t) => t.name === 'error-soft') + 1,
    0,
    { name: 'primary-foreground', value: '#ffffff', usage: 'Text/icon on accent and status fills.' },
  )

  // ----- type: families parsed from CSS; groups are an editorial mapping ----
  const fam = (k) => {
    const v = typo.get(`--font-${k}`)
    if (v == null) throw new Error(`tokens: --font-${k} missing from typography.css`)
    return v
  }
  const type = {
    fonts: [],
    families: { sans: fam('sans'), display: fam('display'), mono: fam('mono') },
    groups: [
      {
        name: 'Display', family: 'display',
        styles: [
          { name: 'hero', fontSize: '2.25rem', lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em', usage: 'Page hero — the largest display size.' },
          { name: 'h1', fontSize: '1.75rem', lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.02em', usage: 'Top-level heading.' },
          { name: 'h2', fontSize: '1.35rem', lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.02em', usage: 'Section heading.' },
          { name: 'h3', fontSize: '1.1rem', lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.02em', usage: 'Sub-section / card title.' },
        ],
      },
      {
        name: 'Text', family: 'sans',
        styles: [
          { name: 'body', fontSize: '1rem', lineHeight: 1.5, fontWeight: 400, usage: 'Default reading body.' },
          { name: 'ui', fontSize: '0.9375rem', lineHeight: 1.5, fontWeight: 400, usage: 'UI default — controls, menus.' },
          { name: 'label', fontSize: '0.9375rem', lineHeight: 1.2, fontWeight: 500, usage: 'Form & control labels.' },
          { name: 'small', fontSize: '0.8125rem', lineHeight: 1.4, fontWeight: 400, usage: 'Secondary / descriptive text.' },
          { name: 'caption', fontSize: '0.75rem', lineHeight: 1.4, fontWeight: 400, usage: 'Captions, helper text.' },
        ],
      },
      {
        name: 'Mono', family: 'mono',
        styles: [
          { name: 'code', fontSize: '0.8125rem', lineHeight: 1.5, fontWeight: 400, usage: 'Inline / block code.' },
          { name: 'data', fontSize: '0.7rem', lineHeight: 1.4, fontWeight: 500, letterSpacing: '0', usage: "The machine's voice — app IDs, scopes, remoteEntry URLs." },
        ],
      },
    ],
  }

  // ----- spacing / radius: parsed live from spacing.css -----
  const lenToken = (name, usage) => {
    const v = spacing.get(`--${name}`)
    if (v == null) throw new Error(`tokens: --${name} missing from spacing.css`)
    return { name, value: v, usage }
  }
  const spacingTokens = [
    ['space-0', 'Zero — reset.'], ['space-1', '4px — tightest gap, icon padding.'],
    ['space-2', '8px — inline gaps, chip padding.'], ['space-3', '12px — input padding, small gaps.'],
    ['space-4', '16px — default element gap.'], ['space-5', '20px.'],
    ['space-6', '24px — card padding, section gap.'], ['space-7', '28px.'],
    ['space-8', '32px — block separation.'], ['space-10', '40px.'],
    ['space-12', '48px — major section spacing.'], ['space-16', '64px — page-level rhythm.'],
    ['space-20', "80px — Section's \"md\" vertical rhythm."], ['space-24', "96px — Section's \"lg\" vertical rhythm."],
  ].map(([n, u]) => lenToken(n, u))
  const radiusTokens = [
    ['radius-sm', '6px — small controls, integration badges.'],
    ['radius-md', '8px — inputs, buttons, chips.'],
    ['radius-lg', '10px — cards (base radius).'],
    ['radius-xl', '16px — modals, auth card.'],
    ['radius-pill', 'Fully rounded — pills, dots, toggles.'],
  ].map(([n, u]) => lenToken(n, u))

  // ----- shadow: geometry from CSS, ink inlined PER THEME (grammar bans var()) ----
  // colors.css overrides --shadow (and the accent) per theme, so emit {dark,light}
  // so the light theme's lighter ink propagates instead of being frozen to dark.
  const resolveColor = (map, varName) => {
    const v = map.get(varName)
    if (v == null) return null
    const a = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v.trim())
    return a ? (map.get(a[1]) ?? colors.base.get(a[1])) : v.trim()
  }
  const pick = (varName) => ({
    dark: resolveColor(colors.base, varName),
    light: resolveColor(colors.light, varName) ?? resolveColor(colors.base, varName),
  })
  const shadowInk = pick('--shadow')
  const shadowAccent = pick('--accent-color')
  // Fail loud rather than letting String.replace coerce an unresolved color to
  // the literal "null"/"undefined" and emit invalid CSS (e.g. `0 1px 2px null`).
  for (const [label, pair] of [['--shadow', shadowInk], ['--accent-color', shadowAccent]]) {
    for (const theme of ['dark', 'light']) {
      if (typeof pair[theme] !== 'string') {
        throw new Error(`tokens: could not resolve ${label} (${theme}) for shadow inlining`)
      }
    }
  }
  const inlineShadow = (name, theme) => {
    const v = spacing.get(`--${name}`)
    if (v == null) throw new Error(`tokens: --${name} missing from spacing.css`)
    return v
      .replace(/var\(--shadow\)/g, shadowInk[theme])
      .replace(/var\(--accent-color\)/g, shadowAccent[theme])
  }
  const shadowTokens = [
    ['shadow-xs', 'Hairline lift — dots, inline chips.'],
    ['shadow-sm', 'Resting card elevation.'],
    ['shadow-md', 'Raised / hovered card.'],
    ['shadow-lg', 'Modals, popovers.'],
    ['shadow-pop', 'Dropdowns, popovers, tooltips.'],
    ['shadow-accent', 'The fuse glow under a primary button.'],
  ].map(([n, u]) => {
    const dark = inlineShadow(n, 'dark')
    const light = inlineShadow(n, 'light')
    return { name: n, value: dark === light ? dark : { dark, light }, usage: u }
  })

  // ----- layout: component-facing sizes referenced by Container/Drawer/BottomSheet ---
  // (env()-based safe-area insets and the motion scale are intentionally omitted —
  // the artifact token grammar cannot represent functions or a motion family.)
  const layoutTokens = [
    ['container-2xl', 'Container max-width — 42rem.'], ['container-3xl', 'Container max-width — 48rem.'],
    ['container-4xl', 'Container max-width — 56rem.'], ['container-5xl', 'Container max-width — 64rem.'],
    ['container-6xl', 'Container max-width — 72rem.'], ['container-7xl', 'Container max-width — 80rem (default).'],
    ['container-max', 'Shell content max-width.'], ['top-bar-height', 'Top bar height (desktop).'],
    ['top-bar-height-mobile', 'Top bar height (mobile).'], ['side-panel-width', 'Left nav / side panel width.'],
    ['modal-max-w', 'Modal max-width.'], ['modal-max-w-lg', 'Large modal max-width.'],
    ['bottom-nav-height', 'Mobile bottom-nav height.'], ['drawer-width', 'Mobile slide-in drawer width.'],
    ['sheet-max-h', 'Bottom-sheet max height.'], ['touch-target', 'Minimum tap target (WCAG 2.5.5).'],
  ].map(([n, u]) => lenToken(n, u))

  // ----- z-index: parsed live -----
  const zTokens = [
    ['z-base', 'Default flow.'], ['z-raised', 'Lifted cards, sticky table headers.'],
    ['z-sticky', 'Top bar, side panel.'], ['z-dropdown', 'Menus, selects, popovers.'],
    ['z-overlay', 'Scrim behind modals.'], ['z-modal', 'Dialogs, command palette.'],
    ['z-toast', 'Transient notifications.'], ['z-tooltip', 'Always on top.'],
  ].map(([n, u]) => {
    const v = spacing.get(`--${n}`)
    if (v == null) throw new Error(`tokens: --${n} missing from spacing.css`)
    return { name: n, value: v, usage: u }
  })

  return {
    name: TITLE,
    version: 1,
    meta: {
      source: 'github',
      repo: 'izzywdev/FuzeFront',
      package: 'design-system',
      generatedBy: 'scripts/ds-artifact/build-artifact.mjs',
      paths: {
        tokens: ['design-system/tokens/colors.css', 'design-system/tokens/typography.css', 'design-system/tokens/spacing.css', 'design-system/tokens/fonts.css', 'design-system/tokens/base.css'],
        components: 'design-system/components',
      },
    },
    color: { themes: [{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }], tokens: colorTokens },
    type,
    spacing: { tokens: spacingTokens },
    radius: { tokens: radiusTokens },
    shadow: { note: 'Deep and soft, tuned for the dark shell. Light theme uses the same geometry with a lighter ink.', tokens: shadowTokens },
    layout: { note: 'Component-facing sizes (shell chrome, containers, mobile). Safe-area insets and the motion scale are omitted — the token grammar cannot represent env()/functions or a motion family.', tokens: layoutTokens },
    zIndex: { note: 'One elevation ladder so layered surfaces never collide.', tokens: zTokens },
  }
}

/* ============================================================
   components — README from prompt.md|.d.ts; preview from override|specimen
   ============================================================ */
const GROUP_LABEL = {
  brand: 'Brand', core: 'Core', shell: 'Shell', launcher: 'Launcher',
  feedback: 'Feedback', forms: 'Forms', access: 'Access', data: 'Data',
  layout: 'Layout', mobile: 'Mobile', navigation: 'Navigation', overlay: 'Overlay',
  billing: 'Billing',
}

const cleanJsdoc = (raw) => raw
  .split('\n')
  .map((l) => l.replace(/^\s*\*?\s?/, '').trimEnd())
  .join('\n')
  .trim()

// These scanners use STATIC regexes that capture the declared name, then
// compare it to `name` in JS — never `new RegExp(<name>)` — so a component
// name is never spliced into a pattern (keeps the scan literal/ReDoS-free).

// A component-level JSDoc is one that immediately precedes the component's
// function/interface declaration — including `export interface <Name>Props`,
// where many components put their summary — not a stray per-prop comment.
const DECL_RE = /\/\*\*([\s\S]*?)\*\/\s*export (?:declare function|function|interface) ([A-Za-z_$][\w$]*)/g
function componentJsdoc(name, dtsText) {
  DECL_RE.lastIndex = 0
  let m
  while ((m = DECL_RE.exec(dtsText))) {
    if (m[2] === name || m[2] === `${name}Props`) return cleanJsdoc(m[1])
  }
  return ''
}

// `[^{}]*` tolerates an `extends React.HTMLAttributes<…>` clause before the body.
const PROPS_IFACE_RE = /export interface ([A-Za-z_$][\w$]*)Props[^{}]*\{([\s\S]*?)\n\}/g
// Fallback doc for components with no .prompt.md: the component-level JSDoc (if
// any) plus a Props list parsed from `export interface <Comp>Props { … }`,
// carrying each prop's own inline `/** … */` note.
function fallbackFromDts(name, group, dtsText) {
  const lead = componentJsdoc(name, dtsText)
  PROPS_IFACE_RE.lastIndex = 0
  let iface, body = null
  while ((iface = PROPS_IFACE_RE.exec(dtsText))) {
    if (iface[1] === name) { body = iface[2]; break }
  }
  const props = []
  if (body) {
    // Drop the `[key: string]: unknown` index signature before parsing props.
    const interfaceBody = body.replace(/\[[^\]]+\]\s*:\s*[^;]+;/g, '')
    // Match only members at the top level of the interface body (line-anchored),
    // each optionally preceded by its own JSDoc. The line anchor keeps a callback
    // parameter (e.g. the `page` in `onChange?: (page: number) => void`, which is
    // mid-line) from being mistaken for a prop.
    const propRe = /(?:\/\*\*([\s\S]*?)\*\/\s*)?^[ \t]*([A-Za-z_$][\w$]*)(\??)\s*:/gm
    let p
    while ((p = propRe.exec(interfaceBody))) {
      const [, doc, pname, opt] = p
      if (pname === 'style' || pname === 'className' || pname === 'children') continue
      const note = doc ? ` — ${cleanJsdoc(doc).replace(/\n+/g, ' ')}` : ''
      props.push(`- \`${pname}${opt}\`${note}`)
    }
  }
  const summary = lead || `\`${name}\` — a FuzeFront design-system \`${group}\` primitive, styled entirely with tokens.`
  const propsBlock = props.length ? `\n\n**Props**\n\n${props.join('\n')}` : ''
  return `${summary}${propsBlock}\n\nSee \`components/index.d.ts\` for the full prop contract.`
}

function firstJsxBlock(mdText) {
  const m = /```jsx\n([\s\S]*?)```/.exec(mdText)
  return m ? m[1].trimEnd() : ''
}

function componentReadme(name, group, dir) {
  const base = join(dir, name)
  if (existsSync(`${base}.prompt.md`)) {
    // prompt.md leads with the summary sentence; a leading "# Name" is dropped.
    return read(`${base}.prompt.md`).replace(/^#\s+.*\n+/, '').trim()
  }
  return fallbackFromDts(name, group, existsSync(`${base}.d.ts`) ? read(`${base}.d.ts`) : '')
}

function specimenPreview(name, group, dir) {
  const label = GROUP_LABEL[group] || group
  const promptPath = join(dir, `${name}.prompt.md`)
  const jsx = existsSync(promptPath) ? firstJsxBlock(read(promptPath)) : ''
  const code = jsx || `import { ${name} } from '@fuzefront/design-system'\n\n<${name} />`
  const lines = code.split('\n').length
  const height = Math.min(640, Math.max(140, 72 + lines * 20))
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!-- @dsCard group="${label}" height=${height} static -->
<style>
  body { margin: 0; padding: var(--space-6); background: var(--bg-primary); font-family: var(--font-sans); }
  .tag { display: inline-block; margin-bottom: var(--space-3); font-family: var(--font-mono); font-size: 0.7rem; font-weight: 500; letter-spacing: 0; color: var(--accent-color); background: var(--accent-soft); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); }
  pre { margin: 0; padding: var(--space-4); background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); overflow: auto; }
  code { font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.5; color: var(--text-secondary); white-space: pre; }
  .n { color: var(--text-primary); }
</style>
<span class="tag">${name} · usage</span>
<pre><code>${escaped}</code></pre>`
}

/* ============================================================
   assemble
   ============================================================ */
function buildReadme(componentsByGroup, tokenCount) {
  const rows = Object.entries(componentsByGroup)
    .map(([g, names]) => `| ${GROUP_LABEL[g] || g} | ${names.map((n) => `\`${n}\``).join(', ')} |`)
    .join('\n')
  const total = Object.values(componentsByGroup).reduce((a, n) => a + n.length, 0)
  return `# ${TITLE}

The brand and UI design system for **FuzeFront** — a Module-Federation *host shell*: a dark-default dashboard that discovers, mounts and fuses remote micro-frontends ("apps") into one runtime experience. This system is the single source of truth for the colors, type, tokens and primitives used to build on-brand interfaces for that shell. It is generated from the \`design-system/\` package in \`izzywdev/FuzeFront\` by \`scripts/ds-artifact/build-artifact.mjs\` — do not hand-edit the generated mirror; change the source and re-run the producer.

## Brand concept — "runtime fabric / the fuse seam"

The product's defining act is *fusing remote modules into the shell at runtime*. Every design decision serves that idea:

- **The seam.** A glowing indigo→cyan gradient marks every place the host shell joins the content it hosts — the underline beneath the top bar, the left edge of the active nav item, the top of an app card on hover, the auth-card cap, and the "Fuze" half of the wordmark. It is the signature motif: use it where the fabric *joins*, never as decoration.
- **The fuse.** Electric indigo \`#6e5cff\` paired with a cyan signal \`#29d3e6\` — brand + signal, the two ends of the seam.
- **The shell.** A deep blue-graphite surface set, layered from the deepest shell (\`bg-secondary\`) up through canvas (\`bg-primary\`), panels (\`bg-tertiary\`) and raised surfaces (\`bg-quaternary\`). **Dark is the default**; light is a cool, instrument-grade override.
- **The machine's voice.** Technical data that defines this product — app IDs, scopes, \`remoteEntry\` URLs — is always set in **JetBrains Mono**. It signals "this is real, addressable infrastructure."

## Color

The palette is a deep blue-graphite shell, the electric indigo + cyan fuse seam, and a cool status set with one warm amber spark (${tokenCount} color tokens across the \`dark\` default and \`light\` themes).

- **Brand primitives** (\`indigo-*\`, \`cyan-*\`, \`graphite-*\`, \`paper-*\`, \`ink-*\`, \`mint-*\`, \`amber-*\`, \`coral-*\`) are the raw ramps. Do not reach for a primitive in feature code.
- **Semantic tokens** are what components consume: surfaces (\`bg-secondary\` → \`bg-quaternary\`), \`border-color\` / \`border-strong\`, text (\`text-primary\` / \`text-secondary\` / \`text-tertiary\`), the fuse (\`accent-color\`, \`accent-hover\`, \`accent-2\`, \`accent-soft\`), and status (\`success-color\`, \`warning-color\`, \`error-color\`, each with a \`*-soft\` tint). Theme is switched on the document root with \`data-theme="dark"\` (default) or \`data-theme="light"\`.

Rules:
- Every surface comes from a \`bg-*\` token; every line from \`border-color\` / \`border-strong\`. No raw hex in feature code.
- \`accent-color\` is load-bearing — primary CTAs, active nav, focus rings, links. \`accent-2\` (cyan) is for a secondary classification that reads *related-but-different*.
- Status color is never the only signal: pair it with a dot, icon or label. \`text-tertiary\` is for non-essential metadata only — it does not meet body-text contrast.

## Type

Three families, each with a job: **Space Grotesk** (\`display\`) carries the personality — headings, hero, the wordmark, with tight \`-0.02em\` tracking; **Inter** (\`sans\`) does the reading; **JetBrains Mono** (\`mono\`) speaks for the machine — IDs, scopes, \`remoteEntry\` URLs, code. All three are free Google Fonts.

## Spacing, radius & elevation

- **Spacing** is a 4px base scale (\`space-1\` = 4px … \`space-16\` = 64px). Cards pad to \`space-6\`; inputs to \`space-3\`.
- **Radius** runs \`radius-sm\` (6px) → \`radius-md\` (8px, inputs/buttons/chips) → \`radius-lg\` (10px, cards) → \`radius-xl\` (16px, modals) → \`radius-pill\`.
- **Shadows** are deep and soft, tuned for the dark shell; \`shadow-accent\` is the indigo glow reserved for a primary button.
- **Z-index** is one ladder (\`z-base\` → \`z-tooltip\`) so overlays never collide.

## Components

${total} primitives across ${Object.keys(componentsByGroup).length} groups, each styled entirely with tokens — no raw hex, px or font outside the token set. Guideline docs are generated from each component's source \`.prompt.md\` / \`.d.ts\`; a curated set carries a rich visual preview (the rest show a usage specimen). The authoritative implementations ship as the private npm package \`@fuzefront/design-system\`.

| Group | Primitives |
|---|---|
${rows}

When a consumer needs a primitive that does not exist, it is added to this base system — never one-off styled in feature code (see \`CLAUDE.md\` → "Design system — FuzeFront IS the base").
`
}

function buildIndex() {
  // Preserve volatile fields from an existing committed index so the drift
  // gate stays stable across commits; otherwise seed them once.
  let createdOnFiles = { v: 1, at: CREATED_AT }
  const existingPath = join(OUT_DIR, 'design-system.json')
  if (existsSync(existingPath)) {
    try {
      const prev = JSON.parse(read(existingPath))
      // Preserve only a schema-valid stamp; otherwise reseed the canonical one,
      // so a corrupted/hand-edited index.json cannot pass --check by self-comparison.
      const c = prev.createdOnFiles
      if (c && Number.isInteger(c.v) && typeof c.at === 'string' && !Number.isNaN(Date.parse(c.at))) {
        createdOnFiles = c
      }
    } catch { /* regenerate from scratch */ }
  }
  return {
    v: 3,
    layout: 'files',
    createdOnFiles,
    title: TITLE,
    namespace: NAMESPACE,
    libraries: [],
    sections: {},
    groups: [],
    assetGroups: {},
    blobs: {},
    docs: { readme: 'project/README.md', sections: [] },
    lastChange: {
      by: 'scripts/ds-artifact',
      via: 'GitHub · izzywdev/FuzeFront',
      note: 'Generated from the design-system/ package by build-artifact.mjs.',
    },
  }
}

function generate() {
  // tokens
  const tokens = buildTokens()
  emit('tokens.json', JSON.stringify(tokens, null, 2))

  // The design system's webfonts are hosted (Google Fonts); the artifact's
  // generated tokens.css emits no @font-face for a file-less font, so inject the
  // same @import the source fonts.css uses into every preview — otherwise every
  // preview falls back to system faces.
  const fontsImport = (/@import\s+url\(([^)]+)\);/.exec(read(join(DS_ROOT, 'tokens/fonts.css'))) || [])[1]
  const fontsUrl = fontsImport ? fontsImport.replace(/^['"]|['"]$/g, '') : ''
  const withFonts = (html) => {
    if (!fontsUrl) return html
    const nl = html.indexOf('\n')
    const head = html.slice(0, nl + 1)   // keep the `<!-- @dsCard … -->` marker on line 1
    return `${head}<style>@import url("${fontsUrl}");</style>\n${html.slice(nl + 1)}`
  }

  // components
  const compFiles = walkJsx(join(DS_ROOT, 'components'))
  const byGroup = {}
  const dtsBodies = []
  const reactNamed = new Set()   // union of named React imports, deduped
  for (const f of compFiles) {
    const name = basename(f, '.jsx')
    const dir = dirname(f)
    const group = basename(dir)
      ; (byGroup[group] ||= []).push(name)

    emit(`components/${name}/README.md`, componentReadme(name, group, dir))

    const override = join(PRODUCER_DIR, 'previews', `${name}.html`)
    emit(`components/${name}/preview.html`,
      withFonts(existsSync(override) ? read(override) : specimenPreview(name, group, dir)))

    const dts = join(dir, `${name}.d.ts`)
    if (existsSync(dts)) {
      const src = read(dts)
      // Collect named React imports so the merged module declares each once;
      // `import * as React` and local sibling imports (e.g. ./Text) are dropped.
      for (const im of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']react["'];?/g)) {
        for (const spec of im[1].split(',')) { const s = spec.trim(); if (s) reactNamed.add(s) }
      }
      const stripped = src.replace(/^\s*import\s[\s\S]*?;\s*$/gm, '').trim()
      dtsBodies.push(`// ----- ${name} (${group}) -----`, stripped, '')
    }
  }
  const dtsHeader = [
    '/* AUTO-GENERATED by producer — the public type surface (documentation, not type-checked). */',
    'import * as React from "react";',
    reactNamed.size ? `import { ${[...reactNamed].sort().join(', ')} } from "react";` : '',
    '',
  ]
  emit('components/index.d.ts', [...dtsHeader, ...dtsBodies].join('\n'))

  // cover (authored)
  const coverSrc = join(PRODUCER_DIR, 'templates', 'cover.html')
  if (existsSync(coverSrc)) emit('components/Cover/preview.html', withFonts(read(coverSrc)))

  // README (brand book) + index — after components so counts are known
  emit('README.md', buildReadme(byGroup, tokens.color.tokens.length))
  emit('design-system.json', JSON.stringify(buildIndex(), null, 2))

  return { componentCount: compFiles.length, groupCount: Object.keys(byGroup).length }
}

/* ---- write or check ------------------------------------------------------ */
function writeAll() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  for (const [rel, text] of Object.entries(files)) {
    const dest = join(OUT_DIR, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, text)
  }
}

function checkDrift() {
  const drifted = []
  const seen = new Set()
  for (const [rel, text] of Object.entries(files)) {
    seen.add(rel)
    const dest = join(OUT_DIR, rel)
    if (!existsSync(dest)) { drifted.push(`${rel} (missing)`); continue }
    if (read(dest) !== text) drifted.push(`${rel} (differs)`)
  }
  // extra committed files no longer produced
  const walkOut = (dir, out = []) => {
    if (!existsSync(dir)) return out
    for (const n of readdirSync(dir)) {
      const full = join(dir, n)
      if (statSync(full).isDirectory()) walkOut(full, out)
      else out.push(relative(OUT_DIR, full).split('\\').join('/'))
    }
    return out
  }
  for (const rel of walkOut(OUT_DIR)) if (!seen.has(rel)) drifted.push(`${rel} (stale — no longer produced)`)
  return drifted
}

const stats = generate()

if (CHECK) {
  const drifted = checkDrift()
  if (drifted.length) {
    console.error('✗ Design-system artifact mirror is out of date:\n')
    for (const d of drifted) console.error(`    ${d}`)
    console.error(`\nRegenerate it and commit:\n    npm run ds:artifact\n`)
    process.exit(1)
  }
  console.log(`✓ Design-system artifact mirror is in sync (${stats.componentCount} components, ${stats.groupCount} groups).`)
} else {
  writeAll()
  console.log(`DS artifact: wrote ${Object.keys(files).length} files for ${stats.componentCount} components (${stats.groupCount} groups) → ${relative(REPO_ROOT, OUT_DIR)}`)
}
