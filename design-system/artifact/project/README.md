# FuzeFront Fuse Seam

The brand and UI design system for **FuzeFront** — a Module-Federation *host shell*: a dark-default dashboard that discovers, mounts and fuses remote micro-frontends ("apps") into one runtime experience. This system is the single source of truth for the colors, type, tokens and primitives used to build on-brand interfaces for that shell. It is generated from the `design-system/` package in `izzywdev/FuzeFront` by `scripts/ds-artifact/build-artifact.mjs` — do not hand-edit the generated mirror; change the source and re-run the producer.

## Brand concept — "runtime fabric / the fuse seam"

The product's defining act is *fusing remote modules into the shell at runtime*. Every design decision serves that idea:

- **The seam.** A glowing indigo→cyan gradient marks every place the host shell joins the content it hosts — the underline beneath the top bar, the left edge of the active nav item, the top of an app card on hover, the auth-card cap, and the "Fuze" half of the wordmark. It is the signature motif: use it where the fabric *joins*, never as decoration.
- **The fuse.** Electric indigo `#6e5cff` paired with a cyan signal `#29d3e6` — brand + signal, the two ends of the seam.
- **The shell.** A deep blue-graphite surface set, layered from the deepest shell (`bg-secondary`) up through canvas (`bg-primary`), panels (`bg-tertiary`) and raised surfaces (`bg-quaternary`). **Dark is the default**; light is a cool, instrument-grade override.
- **The machine's voice.** Technical data that defines this product — app IDs, scopes, `remoteEntry` URLs — is always set in **JetBrains Mono**. It signals "this is real, addressable infrastructure."

## Color

The palette is a deep blue-graphite shell, the electric indigo + cyan fuse seam, and a cool status set with one warm amber spark (55 color tokens across the `dark` default and `light` themes).

- **Brand primitives** (`indigo-*`, `cyan-*`, `graphite-*`, `paper-*`, `ink-*`, `mint-*`, `amber-*`, `coral-*`) are the raw ramps. Do not reach for a primitive in feature code.
- **Semantic tokens** are what components consume: surfaces (`bg-secondary` → `bg-quaternary`), `border-color` / `border-strong`, text (`text-primary` / `text-secondary` / `text-tertiary`), the fuse (`accent-color`, `accent-hover`, `accent-2`, `accent-soft`), and status (`success-color`, `warning-color`, `error-color`, each with a `*-soft` tint). Theme is switched on the document root with `data-theme="dark"` (default) or `data-theme="light"`.

Rules:
- Every surface comes from a `bg-*` token; every line from `border-color` / `border-strong`. No raw hex in feature code.
- `accent-color` is load-bearing — primary CTAs, active nav, focus rings, links. `accent-2` (cyan) is for a secondary classification that reads *related-but-different*.
- Status color is never the only signal: pair it with a dot, icon or label. `text-tertiary` is for non-essential metadata only — it does not meet body-text contrast.

## Type

Three families, each with a job: **Space Grotesk** (`display`) carries the personality — headings, hero, the wordmark, with tight `-0.02em` tracking; **Inter** (`sans`) does the reading; **JetBrains Mono** (`mono`) speaks for the machine — IDs, scopes, `remoteEntry` URLs, code. All three are free Google Fonts.

## Spacing, radius & elevation

- **Spacing** is a 4px base scale (`space-1` = 4px … `space-16` = 64px). Cards pad to `space-6`; inputs to `space-3`.
- **Radius** runs `radius-sm` (6px) → `radius-md` (8px, inputs/buttons/chips) → `radius-lg` (10px, cards) → `radius-xl` (16px, modals) → `radius-pill`.
- **Shadows** are deep and soft, tuned for the dark shell; `shadow-accent` is the indigo glow reserved for a primary button.
- **Z-index** is one ladder (`z-base` → `z-tooltip`) so overlays never collide.

## Mobile & responsiveness

FuzeFront is one shell rendered from phone to wide desktop; it is **mobile-first**. Build the
narrow (`xs`) layout from the base tokens, then layer wider layouts with `min-width` media
queries at the breakpoints below. The breakpoints are not tokens — they are the reference
scale for hand-written `@media` queries (and are mirrored in the shell's layout logic).

| Breakpoint | Min width | Device | Shell change |
|---|---|---|---|
| `xs` | < 480px | phone portrait | BottomNav + Drawer |
| `sm` | 480px | phone landscape | — |
| `md` | 768px | tablet | SidePanel returns |
| `lg` | 1024px | desktop | — |
| `xl` | 1280px | wide desktop | — |

### Navigation adapts at `md`
Below `md` (tablet) the persistent left `side-panel` is replaced by a **bottom nav**
(`BottomNav`, height `bottom-nav-height`) plus a slide-in **drawer** (`Drawer`, width
`drawer-width`), and the top bar collapses to `top-bar-height-mobile`. At `md` and up the
side panel returns and the bottom nav is hidden. Secondary actions that are a popover/menu on
desktop become a **bottom sheet** (`BottomSheet`, max height `sheet-max-h`) on touch.

### Touch & reach
- **Tap targets are ≥ `touch-target` (44px, WCAG 2.5.5)** on every interactive element on
  touch viewports — buttons, nav items, list rows, icon-only controls. Spacing between adjacent
  targets comes from the `space-*` scale, never a hand-tuned px gap.
- Put primary actions within thumb reach (bottom of the viewport) on phones — this is what the
  bottom nav and bottom sheet are for; a top-right action bar is desktop-only.

### Safe areas & viewport
- Honour device insets with the `safe-area-*` tokens (`safe-area-top`/`-bottom`/`-left`/`-right`,
  backed by `env(safe-area-inset-*)`) on any element that reaches a screen edge — the top bar,
  the bottom nav, and a full-height drawer or sheet — so content clears the notch and home
  indicator. These resolve to `0` on non-notched devices, so they are always safe to apply.
- Use dynamic-viewport units (the bottom sheet caps at `sheet-max-h` = `80dvh`) rather than
  `vh`, so mobile browser chrome collapsing does not clip the UI.
- Respect `prefers-reduced-motion`: drawer/sheet transitions use the token motion scale and
  collapse to an instant change when the user has asked for reduced motion.

### Fluid layout, not fixed
Compose pages from `Container` (content max-widths `container-2xl`…`container-7xl`),
`ResponsiveGrid`, `Stack` and `Wrap` so a layout reflows by itself instead of switching on a
pixel width. Reach for a breakpoint only for a genuine structural change (nav, multi-column →
single column), not for sizing a single element.

Mobile primitives: `BottomNav`, `BottomSheet`, `Drawer`. They encode these rules — prefer them over re-implementing a
drawer, bottom nav or sheet in feature code.

## Components

93 primitives across 13 groups, each styled entirely with tokens — no raw hex, px or font outside the token set. Guideline docs are generated from each component's source `.prompt.md` / `.d.ts`; a curated set carries a rich visual preview (the rest show a usage specimen). The authoritative implementations ship as the private npm package `@fuzefront/design-system`.

| Group | Primitives |
|---|---|
| Access | `RoleBadge` |
| Billing | `PricingCard` |
| Brand | `BrandMark`, `BrandTokenScope`, `Logo`, `SeamDivider` |
| Core | `Avatar`, `Badge`, `BlockHeading`, `Button`, `Caption`, `CardTitle`, `ExternalLink`, `IconButton`, `IconTile`, `Subheading`, `SubsectionHeading`, `Text`, `TextLink` |
| Data | `DataTable`, `SortableList`, `StatCard`, `StatGroup` |
| Feedback | `Alert`, `EmptyState`, `ProgressMeter`, `Rating`, `Skeleton`, `Spinner`, `StatusCallout`, `StatusPill`, `Stepper`, `StrengthMeter`, `Toast` |
| Forms | `CodeField`, `FieldLabel`, `FieldStatus`, `FileDropZone`, `InlineValidatedInput`, `Input`, `PasswordChecklist`, `RadioCardGroup`, `SearchField`, `SegmentedControl`, `Select`, `Textarea`, `Toggle`, `TurnstileContainer` |
| Launcher | `AppCard`, `AppTile`, `HealthDot`, `IntegrationBadge` |
| Layout | `AuthCard`, `Center`, `CenteredCard`, `Container`, `CtaBand`, `CtaHeading`, `Eyebrow`, `HeroBand`, `HeroContent`, `HeroHeading`, `HeroLead`, `HeroPatternOverlay`, `HeroSection`, `InfoRow`, `InverseHeading`, `Lead`, `ListStack`, `PageHeroBand`, `PageHeroTitle`, `Panel`, `ResponsiveGrid`, `Section`, `SectionHead`, `SectionIntro`, `SectionLede`, `SectionTitle`, `Stack`, `Wrap` |
| Mobile | `BottomNav`, `BottomSheet`, `Drawer` |
| Navigation | `Breadcrumb`, `Pagination` |
| Overlay | `Modal` |
| Shell | `AnnouncementBar`, `MenuItem`, `NavLink`, `Tabs`, `ThemeToggle`, `TopBar`, `UserMenu` |

When a consumer needs a primitive that does not exist, it is added to this base system — never one-off styled in feature code (see `CLAUDE.md` → "Design system — FuzeFront IS the base").
