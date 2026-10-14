# FuzeFront Fuse Seam

The brand and UI design system for **FuzeFront** — a Module-Federation *host shell*: a dark-default dashboard that discovers, mounts and fuses remote micro-frontends ("apps") into one runtime experience. This system is the single source of truth for the colors, type, tokens and primitives used to build on-brand interfaces for that shell. It is generated from the `design-system/` package in `izzywdev/FuzeFront` by `design-system/producer/build-artifact.mjs` — do not hand-edit the generated mirror; change the source and re-run the producer.

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

## Components

67 primitives across 13 groups, each styled entirely with tokens — no raw hex, px or font outside the token set. Guideline docs are generated from each component's source `.prompt.md` / `.d.ts`; a curated set carries a rich visual preview (the rest show a usage specimen). The authoritative implementations ship as the private npm package `@fuzefront/design-system`.

| Group | Primitives |
|---|---|
| Access | `RoleBadge` |
| Billing | `PricingCard` |
| Brand | `BrandMark`, `BrandTokenScope`, `Logo`, `SeamDivider` |
| Core | `Avatar`, `Badge`, `Button`, `Caption`, `ExternalLink`, `IconButton`, `IconTile`, `Text` |
| Data | `DataTable`, `SortableList`, `StatCard`, `StatGroup` |
| Feedback | `Alert`, `EmptyState`, `ProgressMeter`, `Rating`, `Skeleton`, `Spinner`, `StatusCallout`, `StatusPill`, `Stepper`, `Toast` |
| Forms | `CodeField`, `FieldLabel`, `FieldStatus`, `FileDropZone`, `Input`, `PasswordChecklist`, `SearchField`, `Select`, `Textarea`, `Toggle` |
| Launcher | `AppCard`, `AppTile`, `HealthDot`, `IntegrationBadge` |
| Layout | `AuthCard`, `Center`, `CenteredCard`, `Container`, `Eyebrow`, `InfoRow`, `ListStack`, `Panel`, `ResponsiveGrid`, `SectionHead`, `Stack`, `Wrap` |
| Mobile | `BottomNav`, `BottomSheet`, `Drawer` |
| Navigation | `Breadcrumb`, `Pagination` |
| Overlay | `Modal` |
| Shell | `AnnouncementBar`, `MenuItem`, `NavLink`, `Tabs`, `ThemeToggle`, `TopBar`, `UserMenu` |

When a consumer needs a primitive that does not exist, it is added to this base system — never one-off styled in feature code (see `CLAUDE.md` → "Design system — FuzeFront IS the base").
