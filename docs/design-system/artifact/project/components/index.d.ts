/* AUTO-GENERATED reference aggregate of each component .d.ts — NOT the package export map, and not type-checked. */
/* The authoritative public surface is @fuzefront/design-system's own index.d.ts (components only, via `export type *`). */
/* Some component files here also declare internal helpers (e.g. passwordMeetsPolicy); those are NOT exported from the package. */
import * as React from "react";
import { CSSProperties, ChangeEventHandler, ElementType, HTMLAttributes, JSX, MouseEventHandler, ReactNode, Ref } from "react";

// ----- RoleBadge (access) -----
/**
 * Role pill for org membership — its tone encodes authority:
 * owner=amber, admin=indigo (the fuse), member=cyan, viewer=neutral.
 */
export interface RoleBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The member's role within the organization. Drives color, label, and icon. */
  role?: "owner" | "admin" | "member" | "viewer";
  /** Render the leading role icon (crown / shield / user / eye). Defaults to true. */
  showIcon?: boolean;
}

export function RoleBadge(props: RoleBadgeProps): React.JSX.Element;

// ----- PricingCard (billing) -----
/**
 * Industry-standard pricing/plan card. The `recommended` tier is highlighted
 * (accent border + glow) AND labelled; the `current` state is conveyed
 * textually and disables the CTA so the signal is not color-only (a11y).
 */
export interface PricingCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Tier/plan display name, e.g. "Pro". */
  tierName: string;
  /** Pre-formatted price string, e.g. "$9" or "Free". */
  price: string;
  /** Billing interval rendered as "/{interval}", e.g. "month". */
  interval?: string;
  /** Optional one-line tier description. */
  description?: string;
  /** Feature bullets, each shown with a check. */
  features?: string[];
  /** Highlight + "Recommended" badge + accent CTA. */
  recommended?: boolean;
  /** Mark as the caller's current plan: badge + disabled "Current plan" CTA. */
  current?: boolean;
  /** CTA label override. Defaults to "Choose plan" / "Current plan". */
  ctaLabel?: string;
  /** Invoked when the CTA is pressed (ignored while disabled/busy/current). */
  onSelect?: () => void;
  /** Show a working/in-flight CTA and disable it. */
  busy?: boolean;
  /** Disable the CTA. */
  disabled?: boolean;
}

export function PricingCard(props: PricingCardProps): React.JSX.Element;

// ----- BrandMark (brand) -----
/**
 * The FuzeFront wordmark — "Fuze" in the --seam gradient + "Front" in solid text,
 * the signature "runtime fuse seam" lockup used in the host shell's top bar.
 */
export interface BrandMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Wordmark scale; also drives the optional logo height. */
  size?: "sm" | "md" | "lg";
  /** Optional logo image src, rendered to the left of the wordmark. */
  logo?: string;
  /** Alt text for the logo image (also the accessible product name). */
  alt?: string;
}

export function BrandMark(props: BrandMarkProps): React.JSX.Element;

// ----- BrandTokenScope (brand) -----
/** Verdict of validating a candidate portal accent color. */
export interface BrandAccentResolution {
  /** True when `accent` was valid and passed the WCAG AA contrast gate. */
  applied: boolean;
  /** Why the accent was rejected: `"none"` (not provided), `"invalid"`
   * (unparsable), `"contrast"` (parses but fails AA), or `null` when applied. */
  reason: "none" | "invalid" | "contrast" | null;
  /** Computed contrast ratio against the on-accent text color, when known. */
  ratio?: number;
  /** The accepted accent color (echoes the input), when applied. */
  accentColor?: string;
  /** Derived hover shade, when applied. */
  accentHover?: string;
  /** Derived 14%-alpha soft tint, when applied. */
  accentSoft?: string;
}

/**
 * Validate a candidate portal accent color and compute the scoped
 * `--accent-*` override BrandTokenScope would apply, without mounting React.
 */
export function resolveBrandAccent(accent: string | null | undefined): BrandAccentResolution;

export interface BrandTokenScopeProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onAccentRejected"> {
  /** Candidate portal accent (`branding.accent`) — hex / rgb(a) / hsl(a). A
   * malformed or WCAG-AA-failing value is rejected; the scope then renders
   * with no override so children inherit the base/ancestor accent. */
  accent?: string | null;
  /** Optional secondary accent (`--accent-2`); validated for CSS-color
   * syntax only (no contrast gate — it is never used as a text color). */
  accent2?: string | null;
  /** Element/component to render as. @default "div" */
  as?: React.ElementType;
  /** Called when `accent` is rejected, with the reason and computed ratio
   * (when known) — e.g. to log a telemetry event or surface an admin warning. */
  onAccentRejected?: (info: { accent: string; reason: "invalid" | "contrast"; ratio?: number }) => void;
}

/**
 * Applies a validated portal brand accent as a scoped CSS-var override layered
 * over the base `@fuzefront/design-system` tokens, with WCAG 2.1 AA contrast
 * fallback and malformed-color rejection (FF-EPIC-13 S3 AC3/AC4).
 */
export function BrandTokenScope(props: BrandTokenScopeProps): React.JSX.Element;

// ----- Logo (brand) -----
export interface LogoProps extends Omit<React.HTMLAttributes<HTMLElement>, "style"> {
  /** Logo image URL (`branding.logo`), or `null`/omitted for no image. */
  src?: string | null;
  /** Portal/tenant display name — source of the initials fallback and the
   * default accessible name. */
  name?: string | null;
  /** Explicit accessible name / alt text override. */
  alt?: string;
  size?: "sm" | "md" | "lg";
  /** Tile (rounded square, default) or circle. */
  shape?: "tile" | "circle";
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Image slot with an initials/default fallback — never renders a broken-image
 * icon. Falls back automatically on a failed image load (`onError`).
 */
export function Logo(props: LogoProps): React.JSX.Element;

// ----- SeamDivider (brand) -----
/**
 * The signature glowing "fuse seam" — a thin gradient bar (indigo -> cyan)
 * that marks where remote modules fuse into the shell at runtime.
 */
export interface SeamDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Axis the seam runs along. `horizontal` spans full width; `vertical` spans full height. */
  orientation?: "horizontal" | "vertical";
  /** Bar thickness in px (the cross-axis dimension). */
  thickness?: number;
  /** Overall opacity, 0–1 — dial the seam down to a quiet hairline. */
  opacity?: number;
  /** Add a soft tinted halo so the seam reads as a glowing light source. */
  glow?: boolean;
}

export function SeamDivider(props: SeamDividerProps): React.JSX.Element;

// ----- Avatar (core) -----
/**
 * Circular user avatar showing derived initials on the indigo "fuse" gradient.
 */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Display name; the first letters of its first two words become the initials. */
  name?: string;
  /** Fallback identity — its first character is used when `name` is absent. */
  email?: string;
  /** Diameter preset. */
  size?: "sm" | "md" | "lg";
  /** Add the top-bar hover lift + accent glow (use when the avatar is a button trigger). */
  interactive?: boolean;
}

export function Avatar(props: AvatarProps): React.JSX.Element;

// ----- Badge (core) -----
/**
 * Small pill label — the accent "fuse" tone or the cool status set, set as
 * a colored label on a faint wash of the same hue. Use `mono` for technical
 * values (app types, scopes, role keys).
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * Color intent. `accent` is the fuse indigo; `info` is the fuse cyan
   * (the seam's other half — mirrors Alert's `info` tone); status tones
   * use their color on a faint surface.
   */
  tone?: "neutral" | "accent" | "info" | "success" | "warning" | "error";
  size?: "sm" | "md";
  /** Switch to JetBrains Mono (and drop uppercasing) for technical values like `react`, `read:apps`. */
  mono?: boolean;
  /** Prepend a small status dot in the tone color. */
  dot?: boolean;
}

export function Badge(props: BadgeProps): React.JSX.Element;

// ----- BlockHeading (core) -----
/**
 * A bold sub-heading that introduces a block of content — a placeholder
 * section's title or a grid-card's title. Composes `Text` and adds the DS
 * `--text-2xl` size, `--weight-bold` weight, and a `space` prop for the
 * bottom-margin gap.
 */
export interface BlockHeadingProps
  extends Omit<TextProps, "as" | "tone" | "size" | "spacing"> {
  /**
   * Heading element to render. @default "h2"
   */
  as?: "h1" | "h2" | "h3" | "h4";
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Bottom-margin step, from the DS spacing scale (`margin-block-end`).
   * `md` (default) is `--space-4`, matching the extracted `mb-4`; `sm` is
   * `--space-2`.
   * @default "md"
   */
  space?: "none" | "sm" | "md";
  children?: React.ReactNode;
}

export function BlockHeading(props: BlockHeadingProps): React.JSX.Element;

// ----- Button (core) -----
/**
 * Pill-ish action button — `primary` is the host shell's accent-glow CTA.
 *
 * Polymorphic: passing `href` (or an explicit `as`) renders a real `<a>`
 * with proper anchor semantics (href/target/rel, middle-click/ctrl-click
 * open-in-new-tab, keyboard link semantics) instead of a `<button>`.
 */
type ButtonSharedProps = {
  /**
   * Visual style. `primary` = accent fill; `secondary` = neutral raised +
   * border; `outline` = accent border/text on a light surface; `ghost` =
   * text-only; `ghost-inverse` = ghost for a dark/brand surface not driven
   * by `data-theme` (white outline/text, filled-white on hover, legible in
   * any theme); `danger` = error fill.
   */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "ghost-inverse" | "danger";
  size?: "sm" | "md" | "lg";
  /** Append a trailing arrow glyph (used on "Launch app", "Continue"). */
  withArrow?: boolean;
  /** A small inline icon node rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Stretch to the full width of the container. */
  fullWidth?: boolean;
  disabled?: boolean;
  /**
   * Render tag/component override. Defaults to `"a"` when `href` is set,
   * `"button"` otherwise. Pass a component (e.g. react-router-dom's `Link`)
   * for in-app routing with the same visual treatment.
   */
  as?: React.ElementType;
};

/** Rendered as `<button>` — no `href`, no `as` override. */
export type ButtonAsButtonProps = ButtonSharedProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonSharedProps> & {
    href?: undefined;
  };

/** Rendered as a real `<a>` (or the component passed via `as`). */
export type ButtonAsAnchorProps = ButtonSharedProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonSharedProps> & {
    href: string;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps;

export function Button(props: ButtonProps): React.JSX.Element;

// ----- Caption (core) -----
/**
 * A small supporting text line below other content (status line, notification
 * message, CTA footnote). Composes `Text` and adds the DS `--text-sm` size
 * plus a `space` prop for the top-margin gap.
 */
export interface CaptionProps extends Omit<TextProps, "tone"> {
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "secondary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Top-margin gap, from the DS spacing scale.
   * @default "sm"
   */
  space?: "none" | "xs" | "sm" | "md" | "lg";
  children?: React.ReactNode;
}

export function Caption(props: CaptionProps): React.JSX.Element;

// ----- CardTitle (core) -----
/**
 * The small semibold heading atop a content card — a feature card's title, a
 * value-prop card's heading, a press-release card's headline. Composes `Text`
 * (`size="lg"`, `tone="primary"`, `spacing="sm"`) and adds the DS
 * `--weight-semibold` weight.
 */
export interface CardTitleProps
  extends Omit<TextProps, "as" | "size" | "weight"> {
  /**
   * Heading element to render. @default "h3"
   */
  as?: "h1" | "h2" | "h3" | "h4";
  children?: React.ReactNode;
}

export function CardTitle(props: CardTitleProps): React.JSX.Element;

// ----- ExternalLink (core) -----
/**
 * A link to a resource on ANOTHER host, always opened in a new tab. Renders
 * a real `<a target="_blank" rel="noopener noreferrer">` — `target`/`rel`
 * cannot be overridden by props.
 */
export interface ExternalLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The external URL. Server-authoritative — never composed client-side. */
  href: string;
  /** `button` = filled accent CTA (a primary launch action); `link` = quiet inline text link. */
  variant?: "link" | "button";
}

export function ExternalLink(props: ExternalLinkProps): React.JSX.Element;

// ----- IconButton (core) -----
/**
 * Icon-only ghost button — the host shell's quiet square control
 * (notification bell, theme toggle). Transparent until hovered.
 */
export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** The icon glyph to render (typically a small inline SVG). */
  children?: React.ReactNode;
  /** Required. Used as both the `title` tooltip and the accessible name. */
  label: string;
  size?: "sm" | "md" | "lg";
  /** Toggled/selected state — holds the quaternary fill and accent color. */
  active?: boolean;
  disabled?: boolean;
  /** Native button ref, used by dialogs and drawers to restore focus. */
  ref?: React.Ref<HTMLButtonElement>;
}

export function IconButton(props: IconButtonProps): React.JSX.Element;

// ----- IconTile (core) -----
/**
 * A tone-colored icon, optionally on a rounded chip. `children` is the icon
 * element itself (e.g. `<Mail size={24} />`) — IconTile only styles the
 * surrounding box/color, never the icon glyph.
 */
export interface IconTileProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  tone?: "accent" | "info" | "success" | "warning" | "error" | "neutral";
  size?: "sm" | "md" | "lg";
  /**
   * `soft` (default): fixed box, tone-tinted background, solid-tone icon.
   * `surface`: fixed box, neutral card-surface background, solid-tone icon —
   * for a tile that sits on an already-colored/dark section.
   * `plain`: no box — just tints the icon in the solid tone color, inline.
   */
  variant?: "soft" | "surface" | "plain";
  /** Accessible name, if the icon is not purely decorative (default: `aria-hidden`). */
  label?: string;
}

export function IconTile(props: IconTileProps): React.JSX.Element;

// ----- Subheading (core) -----
/**
 * A bold `--text-xl` heading that titles a card or opens a numbered
 * legal-document section. Composes `Text` and adds the DS `--text-xl` size,
 * `--weight-bold` weight, and a `space` prop for the bottom-margin gap.
 */
export interface SubheadingProps extends Omit<TextProps, "tone" | "size"> {
  /** Rendered element. @default "h2" */
  as?: "h2" | "h3" | "h4";
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Bottom-margin gap, from the DS spacing scale.
   * @default "md"
   */
  space?: "xs" | "sm" | "md";
  children?: React.ReactNode;
}

export function Subheading(props: SubheadingProps): React.JSX.Element;

// ----- SubsectionHeading (core) -----
/**
 * A small bold subsection heading inside a block of body copy (e.g. a
 * numbered legal-document subsection). Composes `Text` and adds the DS
 * `--weight-semibold` font weight plus a `space` prop for the top-margin
 * gap before a subheading that follows a preceding paragraph.
 */
export interface SubsectionHeadingProps extends Omit<TextProps, "size"> {
  /** Rendered element. @default "h3" */
  as?: "h3" | "h4" | "p" | "div";
  /**
   * Semantic tone, delegated to `Text`'s tone scale.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Top-margin gap before the subheading, from the DS spacing scale — used
   * when it follows a preceding paragraph within the same section.
   * @default "none"
   */
  space?: "none" | "md" | "lg";
  /**
   * Bottom-margin gap before the subheading's own body copy, from the DS
   * spacing scale.
   * @default "sm"
   */
  spacing?: "none" | "sm";
  children?: React.ReactNode;
}

export function SubsectionHeading(props: SubsectionHeadingProps): React.JSX.Element;

// ----- Text (core) -----
/**
 * Plain text with a semantic color tone from the DS text-color scale.
 */
export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "p" */
  as?: "p" | "span" | "div" | "label" | "h1" | "h2" | "h3" | "h4";
  /**
   * Semantic tone: `primary` = default reading text, `secondary` =
   * de-emphasized supporting copy, `muted` = lowest-emphasis placeholder /
   * empty-state copy, `danger` = inline error copy.
   * @default "primary"
   */
  tone?: "primary" | "secondary" | "muted" | "danger";
  /**
   * Step of the DS type scale. `inherit` (default) reads the surrounding
   * layout's font size, unchanged from before `size` existed. `lg` is the
   * step `CardTitle` builds on; `2xl` the step `BlockHeading` builds on.
   * @default "inherit"
   */
  size?: "inherit" | "xs" | "sm" | "base" | "md" | "lg" | "2xl";
  /**
   * Step of the DS spacing scale applied as `margin-block-end` (a logical
   * property, so it mirrors under RTL). `none` (default) keeps the original
   * zero-margin behavior. `lg`/`xl` cover the wider `mb-6`/`mb-8` gap used
   * under a centered CTA/section heading.
   * @default "none"
   */
  spacing?: "none" | "sm" | "md" | "lg" | "xl";
  /**
   * Step of the DS line-height scale. `inherit` (default) reads the
   * surrounding layout's line-height, unchanged from before `leading`
   * existed. `relaxed` covers the recurring card/feature-description
   * paragraph pattern (pairs with `tone="secondary"` `size="sm"`).
   * @default "inherit"
   */
  leading?: "inherit" | "tight" | "snug" | "normal" | "relaxed";
  /**
   * Step of the DS font-weight scale. `inherit` (default) applies no inline
   * override, unchanged from before `weight` existed (the surrounding
   * stylesheet's weight, e.g. Tailwind preflight's heading reset, applies).
   * @default "inherit"
   */
  weight?: "inherit" | "regular" | "medium" | "semibold" | "bold";
  /**
   * Step of the DS spacing scale (same scale as `spacing`) applied as
   * `margin-block-start` — the logical-property counterpart to `spacing`, so
   * it also mirrors under RTL. `none` (default) applies no top margin.
   * @default "none"
   */
  spacingTop?: "none" | "sm" | "md" | "lg" | "xl";
  children?: React.ReactNode;
}

export function Text(props: TextProps): React.JSX.Element;

// ----- TextLink (core) -----
/**
 * An inline accent-colored link/action — the recurring
 * `text-{shade}-600 hover:text-{shade}-700` pattern as a DS primitive.
 * Color (default / hover / focus) is the only concern this component owns;
 * `as` picks the rendered element (`"a"` default, a router `Link`, or
 * `"button"`) and every other prop is forwarded unchanged.
 */
export interface TextLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The element (or component) to render. Defaults to a plain `<a>`. */
  as?: React.ElementType;
}

export function TextLink(props: TextLinkProps): React.JSX.Element;

// ----- DataTable (data) -----
/** Column descriptor passed to DataTable. */
export interface DataTableColumn {
  /** Unique key — passed to `onSort` when this header is clicked. */
  key: string;
  /** Header cell content. */
  header: React.ReactNode;
  /** Show a sort caret and call `onSort(key)` when clicked. */
  sortable?: boolean;
  /** Cell alignment — applied to the `<th>`. Default `'left'`. */
  align?: "left" | "center" | "right";
}

/**
 * Semantic table shell — `<thead>` built from `columns`; consumer renders
 * `<tbody>` as `children`. Sort affordance and aria-sort are handled here;
 * actual sort logic lives in the consumer (e.g. TanStack Table).
 */
export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column definitions that build the `<thead>`. */
  columns: DataTableColumn[];
  /**
   * The `<tbody>` element (or elements) rendered by the consumer.
   * When absent and `loading` is false, `emptyState` is shown.
   */
  children?: React.ReactNode;
  /** When true, renders 5 skeleton rows instead of `children`. */
  loading?: boolean;
  /** Content shown when `children` is empty and `loading` is false. */
  emptyState?: React.ReactNode;
  /** Called with the column key when a sortable header is clicked. */
  onSort?: (key: string) => void;
  /** Key of the currently sorted column. */
  sortBy?: string;
  /** Current sort direction. Default `'asc'`. */
  sortDir?: "asc" | "desc";
}

export function DataTable(props: DataTableProps): React.JSX.Element;

// ----- SortableList (data) -----
export interface SortableListProps<T = unknown>
  extends Omit<React.HTMLAttributes<HTMLUListElement>, "children"> {
  items: T[];
  /** Stable key extractor. @default (item) => item.id */
  getKey?: (item: T) => string | number;
  /** Renders an item's main content (icon/name/description). */
  renderItem?: (item: T, index: number) => React.ReactNode;
  /** Optional slot rendered before the reorder buttons (e.g. an enable toggle). */
  renderActions?: (item: T, index: number) => React.ReactNode;
  /** Called with the full reordered array after a drag-drop or button move. */
  onReorder?: (nextItems: T[]) => void;
  ariaLabel?: string;
}

/**
 * A reorderable list — drag is the primary interaction; the ▲▼ button pair
 * (`data-action="move-up" | "move-down"`) is the keyboard-accessible
 * equivalent, disabled at the list boundary.
 */
export function SortableList<T = unknown>(props: SortableListProps<T>): React.JSX.Element;

// ----- StatCard (data) -----
export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "style"> {
  /** Mono uppercase key label (e.g. "Users"). */
  label: React.ReactNode;
  /** The headline metric value. */
  value: React.ReactNode;
  /** Optional unit/suffix rendered smaller after `value` (e.g. "GB"). */
  unit?: React.ReactNode;
  /** Optional caption below the value (e.g. "3 admins, 2 invites pending"). */
  meta?: React.ReactNode;
  /** Renders as an `<a href>` navigating to the metric's detail view. */
  href?: string;
  onClick?: React.MouseEventHandler;
  style?: React.CSSProperties;
}

/**
 * A single summary-metric tile — seam top accent, mono key label, display-font
 * value, optional meta caption. The standalone/grid companion to `StatGroup`.
 */
export function StatCard(props: StatCardProps): React.JSX.Element;

// ----- StatGroup (data) -----
export interface StatItem {
  /** Primary metric value (number or formatted string). */
  value: string | number;
  /** Optional unit label appended after the value (e.g. "ms", "%", "k"). */
  unit?: string;
  /** Short uppercase descriptor beneath the value. */
  label: string;
  /** Change string shown below the label (e.g. "12 today", "0.3%"). */
  delta?: string;
  /** Direction of the delta indicator. Defaults to "up". */
  deltaDir?: "up" | "down";
}

export interface StatGroupProps extends HTMLAttributes<HTMLDivElement> {
  items: StatItem[];
  style?: CSSProperties;
}

export declare function StatGroup(props: StatGroupProps): JSX.Element;

// ----- Alert (feedback) -----
export interface AlertProps {
  tone?: "error" | "warning" | "success" | "info";
  title?: string;
  /** Decorative glyph on the logical start edge; inherits the tone colour. */
  icon?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  role?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Alert(props: AlertProps): JSX.Element;

// ----- EmptyState (feedback) -----
export interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function EmptyState(props: EmptyStateProps): JSX.Element;

// ----- ProgressMeter (feedback) -----
export type ProgressMeterTone = "seam" | "warning" | "danger";

/**
 * Horizontal progress / usage meter — labelled track + fill keyed to a
 * fraction of a limit. Used for usage-based billing (seats, metered units)
 * and quota displays.
 */
export interface ProgressMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  tone?: ProgressMeterTone;
  /**
   * ARIA role of the track. `progressbar` (default) for task progress; `meter`
   * for a scalar gauge within a known range (quota used / limit).
   */
  role?: "progressbar" | "meter";
}

export function ProgressMeter(props: ProgressMeterProps): React.JSX.Element;

// ----- Rating (feedback) -----
export interface RatingProps extends HTMLAttributes<HTMLDivElement> {
  /** Numeric score, e.g. 4.5. Used to fill stars proportionally. */
  value?: number;
  /** Review count label (e.g. 128). Omit to suppress the count. */
  count?: number;
  /** "row" = inline stars + score; "pill" = compact rounded badge. */
  variant?: "row" | "pill";
  /** Number of stars to render. Defaults to 5. */
  starCount?: number;
  style?: CSSProperties;
}

export declare function Rating(props: RatingProps): JSX.Element;

// ----- Skeleton (feedback) -----
/**
 * Loading-placeholder block with the shared skeleton shimmer. Decorative
 * (`aria-hidden`); label the surrounding region as busy/loading instead.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** CSS width. Default `"100%"`. */
  width?: string | number;
  /** CSS height. Default a token (`var(--space-4)`). */
  height?: string | number;
  /** Border radius. Default `var(--radius-sm)`. */
  radius?: string | number;
}

export function Skeleton(props: SkeletonProps): React.JSX.Element;

// ----- Spinner (feedback) -----
export interface SpinnerProps {
  size?: number;
  color?: string;
  label?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Spinner(props: SpinnerProps): JSX.Element;

// ----- StatusCallout (feedback) -----
export type StatusCalloutTone = "error" | "warning" | "success" | "info";

export interface StatusCalloutProps {
  /** Severity tone. Drives the tint, border, icon color, and default a11y role. */
  tone?: StatusCalloutTone;
  /** Decorative leading glyph/icon rendered in a soft chip (aria-hidden). */
  icon?: ReactNode;
  /** Emphasized title line. */
  title?: ReactNode;
  /** Body copy. */
  children?: ReactNode;
  /** Action row (buttons/links) rendered under the body. */
  actions?: ReactNode;
  /** Override the ARIA role (defaults: `alert` for error, `status` otherwise). */
  role?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function StatusCallout(props: StatusCalloutProps): JSX.Element;

// ----- StatusPill (feedback) -----
/** Status keys grouped by semantic tone:
 * success: online | active | verified | enabled
 * warning: degraded | pending | in-progress | invited
 * error:   offline | suspended | restricted | expired
 * neutral: disabled | not-started */
export type StatusPillStatus =
  | "online" | "active" | "verified" | "enabled"
  | "degraded" | "pending" | "in-progress" | "invited"
  | "offline" | "suspended" | "restricted" | "expired"
  | "disabled" | "not-started";

/**
 * Semantic lifecycle status pill — a colored dot + label on a soft tint of
 * the status color. Covers service health (online/degraded/offline), portal
 * lifecycle (active/suspended), domain verification (verified/pending),
 * catalog enablement (enabled/disabled), and Connect onboarding
 * (not-started/in-progress/restricted) / invite state (invited/expired).
 */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusPillStatus;
  /** Override the default label text; falls back to a capitalized status name. */
  label?: React.ReactNode;
}

export function StatusPill(props: StatusPillProps): React.JSX.Element;

// ----- Stepper (feedback) -----
export interface StepperStep {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** @default "pending" */
  status?: "done" | "current" | "pending";
}

export interface StepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: StepperStep[];
}

/**
 * A vertical, ordered progress list (onboarding / setup checklist) — numbered
 * steps with `done` / `current` / `pending` state. The current step carries
 * `aria-current="step"`.
 */
export function Stepper(props: StepperProps): React.JSX.Element;

// ----- StrengthMeter (feedback) -----
export type StrengthLevel = "empty" | "weak" | "fair" | "good" | "strong";

/**
 * Segmented strength meter — bars lit to a level, tone-tinted, with a caption
 * row and an optional child slot (a requirements checklist).
 */
export interface StrengthMeterProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Level to render; `empty` lights no bars. Default `empty`. */
  strength?: StrengthLevel;
  /** Caption on the logical start of the caption row (e.g. "Password strength"). */
  label?: React.ReactNode;
  /** The level word on the logical end, tinted with the tone (e.g. "Strong"). */
  valueLabel?: React.ReactNode;
  /** Number of bars (default 4). */
  bars?: number;
  /** Rendered below the bars + caption (e.g. a `PasswordChecklist`). */
  children?: React.ReactNode;
}

export function StrengthMeter(props: StrengthMeterProps): React.JSX.Element;

// ----- Toast (feedback) -----
/**
 * A single toast notification — bg-tertiary card with a level-colored left bar.
 * `info` uses the cyan accent (--accent-2); other levels use their status color.
 */
export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Severity, drives the colored left bar. `info` = cyan accent. */
  level?: "success" | "warning" | "error" | "info";
  /** Optional bold heading rendered in the display font. */
  title?: React.ReactNode;
  /** The toast body copy. */
  message?: React.ReactNode;
  /** Show a dismiss (x) IconButton and handle the click. Omit to hide it. */
  onDismiss?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function Toast(props: ToastProps): React.JSX.Element;

// ----- CodeField (forms) -----
/**
 * Monospace code/technical-value field — mirrors Textarea's label/error/focus
 * contract, rendered in `--font-mono`. Single-line (`<input>`) by default;
 * `multiline` renders a `<textarea>` for JSON/code blocks.
 */
export interface CodeFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement> &
      React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "rows"
  > {
  /** Field label rendered above the control (wired via `id`/`htmlFor`). */
  label?: string;
  /** Validation message; when present, borders red and renders below. */
  error?: string;
  /** Render a `<textarea>` (JSON/code block) instead of a single-line `<input>`. */
  multiline?: boolean;
  /** Visible rows when `multiline`. Default 6. */
  rows?: number;
}

export function CodeField(props: CodeFieldProps): React.JSX.Element;

// ----- FieldLabel (forms) -----
/**
 * Standalone form-field label — the label treatment `Input`/`Select` render
 * internally, for fields that don't go through those primitives directly.
 * Wire it to its control via `htmlFor`/`id`, like a native `<label>`.
 */
export interface FieldLabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Id of the control this label describes. */
  htmlFor?: string;
  /**
   * Appends a tokenized asterisk plus a visually-hidden " (required)" so
   * the requirement reaches screen readers too. Defaults to `false`.
   */
  required?: boolean;
}

export function FieldLabel(props: FieldLabelProps): React.JSX.Element;

// ----- FieldStatus (forms) -----
/** Async/validation state for an inline field-status line. */
export type FieldStatusState = "idle" | "checking" | "success" | "error";

export interface FieldStatusProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Which state to render. `idle` shows nothing (but reserves height). */
  state?: FieldStatusState;
  /** Message shown next to the state icon/spinner. */
  message?: string;
  /** Optional trailing node (e.g. a "sign in instead" link). */
  action?: React.ReactNode;
}

export function FieldStatus(props: FieldStatusProps): React.JSX.Element;

// ----- FileDropZone (forms) -----
/**
 * Drag-and-drop file target — dashed-border drop area, keyboard-activatable
 * (Enter / Space opens the picker), calls `onFiles` with the selected or
 * dropped files.
 */
export interface FileDropZoneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Called with the selected or dropped `FileList` (or `File[]`). */
  onFiles?: (files: FileList | File[]) => void;
  /** Native `accept` attribute forwarded to the hidden `<input type="file">` (e.g. `'.csv,.json'`). */
  accept?: string;
  /** Hint text rendered inside the zone. Defaults to a generic "drop or click" message. */
  label?: React.ReactNode;
  /** Disables interaction and dims the zone. */
  disabled?: boolean;
  /** Allow picking/dropping multiple files. Default false. */
  multiple?: boolean;
}

export function FileDropZone(props: FileDropZoneProps): React.JSX.Element;

// ----- InlineValidatedInput (forms) -----
export type InlineValidatedInputState = "idle" | "checking" | "valid" | "invalid";

/**
 * Text field with a live validation state — END-edge check adornment, success /
 * error ring, a label row that carries an inline status `accessory`, and
 * optional help / error lines. Composes `Input` + `FieldLabel`.
 */
export interface InlineValidatedInputProps
  extends Omit<InputProps, "label" | "valid" | "invalid" | "adornment"> {
  label?: React.ReactNode;
  /** Inline status shown on the logical end of the label row (announced politely). */
  accessory?: React.ReactNode;
  /** Validation state; drives the ring, the adornment and `aria-busy`. Default `idle`. */
  state?: InlineValidatedInputState;
  /** Help line below the field; wired to the input via `aria-describedby`. */
  help?: React.ReactNode;
  /** Appends a required marker to the label. */
  required?: boolean;
}

export function InlineValidatedInput(props: InlineValidatedInputProps): React.JSX.Element;

// ----- Input (forms) -----
/**
 * Labeled text field — accepts all native input attributes. Focus lights the
 * accent "fuse seam" ring; an `error` borders red and shows the message.
 */
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Field label rendered above the input (wired to it via `id`/`htmlFor`). A
   * plain string in the common case; accepts any node so a label can carry
   * inline annotations (e.g. an "(auto-derived)" hint span).
   */
  label?: React.ReactNode;
  /** Validation message; when present, borders the input red and renders below it. */
  error?: string;
  /**
   * For `type="password"` fields, render an in-field show/hide (eye) toggle.
   * Defaults to `true`; set `false` to opt out. No effect on non-password inputs.
   */
  revealToggle?: boolean;
  /** Accessible name of the reveal toggle while the value is hidden (localizable). Default "Show password". */
  showPasswordLabel?: string;
  /** Accessible name of the reveal toggle while the value is shown (localizable). Default "Hide password". */
  hidePasswordLabel?: string;
  /**
   * Decorative node pinned to the logical END edge of the field (mirrors under
   * RTL). Ignored on a revealable password field, which owns that slot.
   */
  adornment?: React.ReactNode;
  /** Success ring (e.g. an availability check passed). */
  valid?: boolean;
  /** Error ring + `aria-invalid` without a message — the explanation is rendered elsewhere. */
  invalid?: boolean;
}

export function Input(props: InputProps): React.JSX.Element;

// ----- PasswordChecklist (forms) -----
/** A single password-policy requirement. */
export interface PasswordRule {
  /** Stable key. */
  id: string;
  /** Human-readable requirement text. */
  label: string;
  /** Returns true when the given password satisfies this rule. */
  test: (value: string) => boolean;
}

/**
 * Default policy — mirrors the rules the Security API (Authentik) enforces
 * server-side: 12+ chars, upper, lower, digit, symbol.
 */
export declare const DEFAULT_PASSWORD_RULES: PasswordRule[];

/** True when `value` satisfies every rule — the client-side submit gate. */
export declare function passwordMeetsPolicy(
  value: string,
  rules?: PasswordRule[]
): boolean;

export interface PasswordChecklistProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  /** Current password value being validated. */
  value?: string;
  /** Policy rules to display; defaults to {@link DEFAULT_PASSWORD_RULES}. */
  rules?: PasswordRule[];
  /** Heading shown above the list; pass "" to hide. */
  title?: string;
  /** Lay the rules out in this many grid columns (default 1). */
  columns?: number;
  /** Tint still-unmet rules with the error colour (e.g. after a rejected submit). Default false. */
  highlightUnmet?: boolean;
  /** Visually-hidden suffix announced for a met rule (default " — met"). Localize it. */
  metLabel?: string;
  /** Visually-hidden suffix announced for an unmet rule (default " — not met"). Localize it. */
  unmetLabel?: string;
}

export function PasswordChecklist(props: PasswordChecklistProps): React.JSX.Element;

// Pure helpers surfaced as statics so feature code reaches them through the
// package barrel (which only re-exports the component itself).
export namespace PasswordChecklist {
  /** True when `value` satisfies every rule — the client-side submit gate. */
  function meetsPolicy(value: string, rules?: PasswordRule[]): boolean;
  /** The default policy rules ({@link DEFAULT_PASSWORD_RULES}). */
  const rules: PasswordRule[];
}

// ----- RadioCardGroup (forms) -----
export type RadioCardValue = string | number;

export interface RadioCardOption extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  /** Unique, stable value of the option. */
  value: RadioCardValue;
  /** Card title — the option's accessible name. May contain inline badges/pills. */
  label: React.ReactNode;
  /** Supporting sentence shown under the title; exposed as the accessible description. */
  description?: React.ReactNode;
  /** Not selectable, skipped by arrow-key navigation, dimmed. */
  disabled?: boolean;
  /**
   * The option has been chosen but not yet applied (e.g. awaiting a confirm
   * step). Rendered with a dashed accent border; it is NOT `aria-checked`.
   */
  pending?: boolean;
  /** Extra attributes (data-*, aria-describedby…) are forwarded to the card element. */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export interface RadioCardGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "children"> {
  options: RadioCardOption[];
  /** Controlled selected value. */
  value?: RadioCardValue;
  /** Initial value when uncontrolled. */
  defaultValue?: RadioCardValue;
  /** Called with the new value on click, Space, or arrow-key navigation. Not called when re-selecting the current value. */
  onChange?: (value: RadioCardValue) => void;
  /** Disables every card (e.g. while a mutation is in flight). */
  disabled?: boolean;
  /** When set, a hidden input carries the selected value for native form posts. */
  name?: string;
  /** Accessible name for the group — provide this or `ariaLabelledBy`. */
  ariaLabel?: string;
  /** Id of the element that labels the group. */
  ariaLabelledBy?: string;
  /** Native ref to the `role="radiogroup"` element. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A radio group rendered as selectable cards with a title and a per-card
 * description. WAI-ARIA radiogroup semantics, roving focus, arrow keys that
 * skip disabled cards and flip under `dir="rtl"`, 44px touch targets.
 */
export function RadioCardGroup(props: RadioCardGroupProps): React.JSX.Element;

// ----- SearchField (forms) -----
/**
 * Filter/search input for scannable lists — a leading search glyph inside a
 * bordered field, matching Input's surface/focus treatment.
 */
export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Accessible label. Visually hidden by default — see `hideLabel`. */
  label?: string;
  /** Hide the label visually (still in the accessibility tree). Default `true`. */
  hideLabel?: boolean;
  /** Extra style applied to the outer wrapper. */
  style?: React.CSSProperties;
  /** Extra style applied to the native `<input>`. */
  inputStyle?: React.CSSProperties;
}

export function SearchField(props: SearchFieldProps): React.JSX.Element;

// ----- SegmentedControl (forms) -----
export type SegmentValue = string | number;

export interface SegmentedControlOption
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "children" | "type"> {
  /** Unique, stable value of the segment. */
  value: SegmentValue;
  /** Segment content (usually a short text label). */
  label: React.ReactNode;
  /** Not selectable; rendered as a disabled native button. */
  disabled?: boolean;
  /** Extra attributes (data-*, aria-*…) are forwarded to the segment's button. */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export interface SegmentedControlProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "children"> {
  options: SegmentedControlOption[];
  /** Controlled pressed value. */
  value?: SegmentValue;
  /** Initial value when uncontrolled. */
  defaultValue?: SegmentValue;
  /** Called with the new value. Not called when the pressed segment is pressed again. */
  onChange?: (value: SegmentValue) => void;
  /** Disables every segment. */
  disabled?: boolean;
  /** Accessible name for the group — provide this or `ariaLabelledBy`. */
  ariaLabel?: string;
  /** Id of the element that labels the group. */
  ariaLabelledBy?: string;
  /** Native ref to the `role="group"` element. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A compact single-select button group (`aria-pressed` buttons in a
 * `role="group"`). Keyboard accessible, RTL-safe, 44px tap targets on touch
 * devices and below the xs breakpoint.
 */
export function SegmentedControl(props: SegmentedControlProps): React.JSX.Element;

// ----- Select (forms) -----
/** A single choice in a {@link SelectProps.options} list. */
export interface SelectOption {
  /** Value submitted / bound to the control. */
  value: string;
  /** Human-readable text shown in the dropdown. */
  label: string;
  /** Disable just this option. */
  disabled?: boolean;
}

/**
 * Labeled dropdown — surface, border, radius and focus mirror Input. Focus
 * lights the accent "fuse seam" ring; an `error` borders red and shows the
 * message. Accepts all native `<select>` attributes.
 */
export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * Field label rendered above the control (wired to it via `id`/`htmlFor`).
   * Accepts any node (see {@link InputProps.label}).
   */
  label?: React.ReactNode;
  /** Options to render; alternatively pass `<option>` children directly. */
  options?: SelectOption[];
  /** `<option>` elements, rendered after `options`/`placeholder`. */
  children?: React.ReactNode;
  /** Disabled leading option shown when nothing is selected (e.g. "Choose a role"). */
  placeholder?: string;
  /** Validation message; when present, borders the control red and renders below it. */
  error?: string;
}

export function Select(props: SelectProps): React.JSX.Element;

// ----- Textarea (forms) -----
/**
 * Multi-line text field — mirrors Input exactly (label, error, focus seam,
 * disabled) but renders a `<textarea>` with vertical resize.
 */
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Field label rendered above the textarea (wired via `id`/`htmlFor`).
   * Accepts any node (see {@link InputProps.label}).
   */
  label?: React.ReactNode;
  /** Validation message; when present, borders red and renders below. */
  error?: string;
  /** Number of visible text rows. Default 4. */
  rows?: number;
}

export function Textarea(props: TextareaProps): React.JSX.Element;

// ----- Toggle (forms) -----
export interface ToggleProps {
  checked?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  label?: string;
  id?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Toggle(props: ToggleProps): JSX.Element;

// ----- TurnstileContainer (forms) -----
export type TurnstileContainerState = "loading" | "ready" | "verified" | "failed";

export interface TurnstileContainerLabels {
  loading: string;
  ready: string;
  verified: string;
  failed: string;
  /** Shown as an alert in the `failed` state. */
  error: string;
  /** The challenge vendor's name (approved exception to the vendor-name rule). */
  brand: string;
}

/**
 * Shell for a managed anti-abuse challenge widget: the chrome + the
 * loading / ready / verified / failed states. The widget itself is `children`
 * and stays mounted in every state.
 */
export interface TurnstileContainerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Default `loading`. Exposed as `data-state`. */
  state?: TurnstileContainerState;
  /** Localizable copy; any omitted key falls back to the English default. */
  labels?: Partial<TurnstileContainerLabels>;
  /** The vendor widget (mounted in a slot that persists across states). */
  children?: React.ReactNode;
}

export function TurnstileContainer(props: TurnstileContainerProps): React.JSX.Element;

// ----- AppCard (launcher) -----
/**
 * The dashboard launcher card — the primary surface of the runtime fabric.
 * Lifts and reveals the `--seam` top edge on hover; offline apps render
 * grayscaled, dimmed and non-interactive.
 */
export interface AppCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** The app's display name (rendered as the card heading). */
  name: string;
  /** Short blurb shown beneath the heading; omitted if absent. */
  description?: string;
  /** Runtime integration strategy — drives the icon fallback hue and the mono badge. */
  integrationType?: "module-federation" | "iframe" | "web-component" | string;
  /** App icon image URL; falls back to a per-type emoji glyph on error or when absent. */
  iconUrl?: string;
  /** Emoji glyph (e.g. from a manifest `Icon.kind = "emoji"`); overrides the per-type fallback emoji when no `iconUrl`. */
  iconGlyph?: string;
  /** When false, the card is grayscaled, dimmed, inert and tagged "(Offline)". */
  isHealthy?: boolean;
  /** Fired on click / Enter / Space — only when the app is healthy. */
  onClick?: (event: React.SyntheticEvent) => void;
}

export function AppCard(props: AppCardProps): React.JSX.Element;

// ----- AppTile (launcher) -----
/**
 * The launcher app tile — a compact icon + name cell for the 9-dots app grid,
 * modeled on the Google app launcher. No description, no integration badge;
 * offline apps render grayscaled, dimmed and non-interactive. Use `AppCard`
 * for the full-detail dashboard / management surfaces.
 */
export interface AppTileProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** The app's display name (menu label), rendered beneath the icon. */
  name: string;
  /** Runtime integration strategy — drives the icon fallback hue/emoji. */
  integrationType?: "module-federation" | "iframe" | "web-component" | string;
  /** App icon image URL; falls back to a per-type emoji glyph on error or when absent. */
  iconUrl?: string;
  /** Emoji glyph (e.g. from a manifest `Icon.kind = "emoji"`); overrides the per-type fallback emoji when no `iconUrl`. */
  iconGlyph?: string;
  /** When false, the tile is grayscaled, dimmed and inert. */
  isHealthy?: boolean;
  /** Fired on click / Enter / Space — only when the app is healthy. */
  onClick?: (event: React.SyntheticEvent) => void;
}

export function AppTile(props: AppTileProps): React.JSX.Element;

// ----- HealthDot (launcher) -----
/**
 * Small round runtime-health indicator for launcher app icons —
 * green when the remote is reachable, coral when it's offline.
 */
export interface HealthDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `true` = green/healthy, `false` = coral/offline. Defaults to `true`. */
  healthy?: boolean;
  /** Dot diameter preset. */
  size?: "sm" | "md" | "lg";
  /** Accessible label / tooltip; sensible health-aware default is supplied. */
  label?: string;
  /** Absolutely position the dot at the bottom-right corner of a relative parent (e.g. overlapping an app icon). */
  overlay?: boolean;
}

export function HealthDot(props: HealthDotProps): React.JSX.Element;

// ----- IntegrationBadge (launcher) -----
/**
 * Mono pill labeling a module's integration type — the technical "how it fuses"
 * tag shown on launcher cards.
 */
export interface IntegrationBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * The integration mechanism this module loads through. Rendered verbatim
   * (lowercased) in --font-mono. Known values get the accent treatment; any
   * other string is accepted and styled the same way.
   */
  type?: "module-federation" | "iframe" | "web-component" | (string & {});
}

export function IntegrationBadge(props: IntegrationBadgeProps): React.JSX.Element;

// ----- AuthCard (layout) -----
/**
 * The elevated, seam-topped card chrome shared by standalone auth-style
 * forms (sign in / sign up, create-organization, provisioning). Sits
 * inside a page's own content area — see `CenteredCard` for a full-viewport
 * centering wrapper instead.
 */
export interface AuthCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Text alignment inside the card. Use `center` for a confirmation/success state. */
  align?: "left" | "center";
  /** Card max-width (CSS length). Defaults to the auth-form width. */
  maxWidth?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export declare function AuthCard(props: AuthCardProps): JSX.Element;

// ----- Center (layout) -----
export type CenterProps<E extends React.ElementType = "div"> = {
  /** Element/component to render as (e.g. `"div"`, `"section"`, or an
   * animation wrapper like framer-motion's `motion.div`). @default "div" */
  as?: E;
  children?: React.ReactNode;
  style?: React.CSSProperties;
} & Omit<React.ComponentPropsWithoutRef<E>, "as" | "children" | "style">;

/**
 * Horizontally centers block content — replaces the ad-hoc
 * `className="text-center"` div duplicated across feature code.
 */
export function Center<E extends React.ElementType = "div">(
  props: CenterProps<E>
): React.JSX.Element;

// ----- CenteredCard (layout) -----
export interface CenteredCardProps {
  maxWidth?: string;
  align?: "center" | "left";
  children?: ReactNode;
  style?: CSSProperties;
  containerStyle?: CSSProperties;
  [key: string]: unknown;
}

export declare function CenteredCard(props: CenteredCardProps): JSX.Element;

// ----- Container (layout) -----
export type ContainerSize = "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";

export interface ContainerProps {
  /** Element/component to render as. Default "div". */
  as?: ElementType;
  /** Max-width, from the DS --container-* scale. Default "7xl". */
  size?: ContainerSize;
  /** Apply the responsive horizontal gutter (px-4/6/8 equivalent). Default true. */
  gutter?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Container(props: ContainerProps): JSX.Element;

// ----- CtaBand (layout) -----
export type CtaBandMaxWidth = "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";

export interface CtaBandProps extends HTMLAttributes<HTMLElement> {
  /** Content column max-width, from Container's `--container-*` scale. Default "3xl". */
  maxWidth?: CtaBandMaxWidth;
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The closing CTA band that caps a marketing page — top-bordered surface,
 * vertical padding, centered width-capped content.
 */
export declare function CtaBand(props: CtaBandProps): JSX.Element;

// ----- CtaHeading (layout) -----
export interface CtaHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Heading element to render. Defaults to `h2`. */
  as?: ElementType;
  /** Text alignment. Defaults to `center` — every known call site renders centered. */
  align?: "left" | "center";
  /** Bottom-margin step: `none`, `sm` (`--space-2`), or `md` (default, `mb-4`). */
  space?: "none" | "sm" | "md";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export declare function CtaHeading(props: CtaHeadingProps): JSX.Element;

// ----- Eyebrow (layout) -----
export interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** Show the accent pulse dot on the left. Defaults to true. */
  pulse?: boolean;
  style?: CSSProperties;
}

export declare function Eyebrow(props: EyebrowProps): JSX.Element;

// ----- HeroBand (layout) -----
export type HeroBandPadding = "sm" | "md" | "lg";

export interface HeroBandProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Vertical padding, from the DS --space-* scale. Default "lg" (--space-24). */
  padding?: HeroBandPadding;
  /** Gradient start color (CSS color value). Overrides --hero-band-from. */
  from?: string;
  /** Gradient end color (CSS color value). Overrides --hero-band-to. */
  to?: string;
  /** Gradient direction (CSS `linear-gradient` direction/angle). Overrides --hero-band-angle. */
  angle?: string;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function HeroBand(props: HeroBandProps): JSX.Element;

// ----- HeroContent (layout) -----
export interface HeroContentProps {
  /** Element/component to render as. Passed straight through to Container. Default "div". */
  as?: ElementType;
  /** Max-width, from the DS --container-* scale. Passed straight through to Container. Default "7xl". */
  size?: ContainerSize;
  /** Apply the responsive horizontal gutter. Passed straight through to Container. Default true. */
  gutter?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

/**
 * Hero content wrapper — Container + `position: relative` (to stack above
 * absolutely-positioned hero decoration) + `text-align: center`.
 */
export declare function HeroContent(props: HeroContentProps): JSX.Element;

// ----- HeroHeading (layout) -----
/**
 * The big, bold <h1> page title in a marketing-site hero section (dark
 * gradient background). Tokens-only: responsive size, extrabold weight, and
 * the DS's fixed on-dark white text color.
 */
export interface HeroHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Rendered element. @default "h1" */
  as?: "h1" | "h2";
  /**
   * Step of the DS spacing scale applied as `margin-block-end` (a logical
   * property, so it mirrors under RTL). `lg` = 24px (`--space-6`), `md` =
   * 16px (`--space-4`), `none` = 0.
   * @default "lg"
   */
  spacing?: "none" | "md" | "lg";
  children?: React.ReactNode;
}

export function HeroHeading(props: HeroHeadingProps): React.JSX.Element;

// ----- HeroLead (layout) -----
export interface HeroLeadProps {
  /** Element/component to render as. Default "p". */
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

/**
 * Centered, responsive-size lead paragraph for a page hero on a dark
 * gradient surface — pins `data-theme="dark"` so its color token resolves
 * correctly independent of the ambient page theme. See HeroLead.jsx for the
 * full rationale (ds-fp:d4affa5c8b4a).
 */
export declare function HeroLead(props: HeroLeadProps): JSX.Element;

// ----- HeroPatternOverlay (layout) -----
/**
 * Absolutely-positioned dot-grid texture overlay for hero/band sections.
 * Decorative only — renders `aria-hidden` and `pointer-events: none`.
 * Place it as the first child of a `position: relative` section.
 */
export interface HeroPatternOverlayProps extends HTMLAttributes<HTMLDivElement> {
  /** Overall opacity, 0–1 — dial the texture up/down per section. Defaults to 0.1. */
  opacity?: number;
  style?: CSSProperties;
}

export declare function HeroPatternOverlay(props: HeroPatternOverlayProps): JSX.Element;

// ----- HeroSection (layout) -----
export type HeroBlobCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type HeroBlobTone = "primary" | "accent";
export type HeroBlobSize = "md" | "lg";

export interface HeroBlobSpec {
  /** Which corner the blurred blob is pinned to. Default "top-left". */
  corner?: HeroBlobCorner;
  /** Tint. Default "primary". */
  tone?: HeroBlobTone;
  /** Diameter. Default "lg" (320px); "md" is 288px. */
  size?: HeroBlobSize;
}

export interface HeroGradientStops {
  from: string;
  via: string;
  to: string;
}

export interface HeroSectionProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  children?: ReactNode;
  /** `Container` width for the hero content. Default "4xl". */
  containerSize?: ContainerSize;
  /** Text alignment of the inner Container. Default "center". */
  align?: CSSProperties["textAlign"];
  /** 0–2 blurred decorative blobs, pinned to a corner. Default none. */
  decor?: HeroBlobSpec[];
  /** Render the dot-grid overlay. Default true. */
  pattern?: boolean;
  /** Override the three diagonal gradient stops. Defaults to the brand slate→indigo hero gradient. */
  gradient?: HeroGradientStops;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function HeroSection(props: HeroSectionProps): JSX.Element;

// ----- InfoRow (layout) -----
export interface InfoRowProps {
  label?: string;
  description?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function InfoRow(props: InfoRowProps): JSX.Element;

// ----- InverseHeading (layout) -----
export type InverseHeadingSize = "md" | "lg";
export type InverseHeadingSpacing = "none" | "sm" | "md";

export interface InverseHeadingProps {
  /** Element to render as (h1/h2/h3 — pick the right heading level). Default "h2". */
  as?: ElementType;
  /** Step of the DS type scale for the mobile -> sm(640px) responsive jump. Default "lg". */
  size?: InverseHeadingSize;
  /** Bottom margin, from the DS spacing scale (mb-4 equivalent). Default "md". */
  spacing?: InverseHeadingSpacing;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function InverseHeading(props: InverseHeadingProps): JSX.Element;

// ----- Lead (layout) -----
export type LeadMaxWidth = "2xl" | "3xl" | "4xl" | "none";

export interface LeadProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "p" */
  as?: React.ElementType;
  /**
   * Step of the DS --container-* content-width scale. `"none"` removes the
   * cap.
   * @default "2xl"
   */
  maxWidth?: LeadMaxWidth;
  /** Apply `margin-inline: auto` (logical, RTL-safe) to center the block. @default true */
  centered?: boolean;
  children?: React.ReactNode;
}

/**
 * Hero/section lead paragraph — replaces the recurring ad-hoc
 * `className="text-xl text-gray-600 max-w-{2xl,3xl} mx-auto"` pattern.
 */
export function Lead(props: LeadProps): React.JSX.Element;

// ----- ListStack (layout) -----
export interface ListStackProps extends HTMLAttributes<HTMLElement> {
  /** Element to render as. Defaults to `ul`. */
  as?: "ul" | "ol";
  /** Gap between items, mapped to the DS spacing scale. Defaults to `sm`. */
  gap?: "xs" | "sm" | "md" | "lg";
  children?: ReactNode;
  style?: CSSProperties;
}

export declare function ListStack(props: ListStackProps): JSX.Element;

// ----- PageHeroBand (layout) -----
export type PageHeroBandSpacing = "default" | "compact";

export interface PageHeroBandGradient {
  from: string;
  to: string;
}

export interface PageHeroBandProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Bottom padding: "default" (--space-20, 80px) or "compact" (--space-16, 64px). Top padding is always --space-28 (112px). */
  spacing?: PageHeroBandSpacing;
  /** Override the two diagonal gradient stops. Defaults to the secondary-900 -> secondary-800 brand tone. */
  gradient?: PageHeroBandGradient;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function PageHeroBand(props: PageHeroBandProps): JSX.Element;

// ----- PageHeroTitle (layout) -----
/**
 * The big, bold <h1> page title in a marketing-site hero section that sits
 * on a light gradient background. Tokens-only: responsive size, bold
 * weight, and the DS's standard on-light primary text color.
 */
export interface PageHeroTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Rendered element. @default "h1" */
  as?: "h1" | "h2";
  children?: React.ReactNode;
}

export function PageHeroTitle(props: PageHeroTitleProps): React.JSX.Element;

// ----- Panel (layout) -----
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Panel heading text, rendered in the header. */
  title: ReactNode;
  /**
   * Id applied to the heading and referenced by the section's
   * `aria-labelledby`. Auto-generated via `useId()` when omitted — pass one
   * explicitly only if another element also needs to reference it.
   */
  titleId?: string;
  /** Optional content beside the title (e.g. a status pill). */
  trailing?: ReactNode;
  /**
   * When provided, renders a muted empty-state paragraph in place of
   * `children`. Omit to render `children`.
   */
  empty?: ReactNode;
  /** Optional action row rendered below the body (e.g. buttons). */
  actions?: ReactNode;
  style?: CSSProperties;
}

export declare function Panel(props: PanelProps): JSX.Element;

// ----- ResponsiveGrid (layout) -----
export interface ResponsiveGridProps {
  /** Maximum number of columns once the container is wide enough. Default `2`. */
  columns?: number;
  /** Minimum width a column may shrink to before the grid drops a column. Default `"240px"`. */
  minColumnWidth?: string;
  /** Row/column gap, from the DS spacing scale. Default `"lg"` (`var(--space-6)`). */
  gap?: "sm" | "md" | "lg" | "xl";
  /** CSS `align-items` for the grid's rows (e.g. `"start"` when rows have uneven height). */
  align?: CSSProperties["alignItems"];
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function ResponsiveGrid(props: ResponsiveGridProps): JSX.Element;

// ----- Section (layout) -----
export type SectionTone = "surface" | "muted" | "transparent";
export type SectionPadding = "sm" | "md" | "lg";

export interface SectionProps {
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  /** Background tone, from the DS surface tokens. Default "surface" (white in light theme). */
  tone?: SectionTone;
  /** Vertical rhythm, mapped to the spacing scale: sm=--space-16 (64px), md=--space-20 (80px), lg=--space-24 (96px). Default "lg". */
  padding?: SectionPadding;
  /** Adds a top divider (border-block-start) in --border-color. Default false. */
  divider?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export declare function Section(props: SectionProps): JSX.Element;

// ----- SectionHead (layout) -----
export interface SectionHeadProps extends HTMLAttributes<HTMLDivElement> {
  /** Eyebrow pill label above the heading. */
  kicker?: string;
  /** Section heading text. */
  title: string;
  /** Optional descriptive paragraph below the heading. */
  description?: string;
  /** Label for the "view all" link. If omitted, no link is rendered. */
  viewAllLabel?: string;
  /** URL for the "view all" link. Defaults to "#". */
  viewAllHref?: string;
  onViewAll?: MouseEventHandler<HTMLAnchorElement>;
  style?: CSSProperties;
}

export declare function SectionHead(props: SectionHeadProps): JSX.Element;

// ----- SectionIntro (layout) -----
export type SectionIntroHeadingTag = "h1" | "h2";
export type SectionIntroSpacing = 12 | 14 | 16;
export type SectionIntroTitleGap = 0 | 3 | 4;
export type SectionIntroDescriptionMaxWidth = "xl" | "2xl";

export interface SectionIntroProps {
  /** Element/component to render as. Default "div" — pass `motion.div` to animate it. */
  as?: ElementType;
  /** Heading tag for `title`. Default "h2"; use "h1" for a page's own header. */
  heading?: SectionIntroHeadingTag;
  /** Optional node rendered above the heading (e.g. an `IconTile`). */
  icon?: ReactNode;
  /** Heading content. */
  title: ReactNode;
  /** Bottom margin under the heading, on the DS spacing scale. Default 4. */
  titleGap?: SectionIntroTitleGap;
  /** Optional lead paragraph rendered below the heading. */
  description?: ReactNode;
  /** Max prose width of `description`. Default "2xl" (42rem). */
  descriptionMaxWidth?: SectionIntroDescriptionMaxWidth;
  /** Bottom margin of the whole block, on the DS spacing scale. Default 12. */
  spacing?: SectionIntroSpacing;
  /** Extra content rendered after `description` (e.g. meta lines). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  [key: string]: unknown;
}

export declare function SectionIntro(props: SectionIntroProps): JSX.Element;

// ----- SectionLede (layout) -----
/**
 * The centered intro paragraph directly under a section heading on a
 * marketing page. Tokens only: `--text-lg` size, `--text-secondary` tone,
 * `--container-2xl` (672px, matches `max-w-2xl`) width cap, centered via
 * `margin-inline: auto`.
 */
export interface SectionLedeProps
  extends React.HTMLAttributes<HTMLElement> {
  /**
   * The element to render as.
   * @default "p"
   */
  as?: React.ElementType;
  children?: React.ReactNode;
}

export function SectionLede(props: SectionLedeProps): React.JSX.Element;

// ----- SectionTitle (layout) -----
export interface SectionTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Heading element to render. Defaults to `h2` (an in-page section); use `h1` for a page's own title. */
  as?: ElementType;
  /** Text alignment. Defaults to `center` — every known call site renders centered. */
  align?: "left" | "center";
  /** Bottom-margin step: `md` (default, `mb-4`) or `sm` (`mb-3`, the legal-page variant). */
  space?: "sm" | "md";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export declare function SectionTitle(props: SectionTitleProps): JSX.Element;

// ----- Stack (layout) -----
export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Main axis. `row` (default) lays items out horizontally; `column` stacks them. */
  direction?: "row" | "column";
  /** Cross-axis alignment. Defaults to `center` — the `items-center` half of the pattern. */
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  /** Main-axis alignment. Defaults to `start`. */
  justify?: "start" | "center" | "end" | "between" | "around";
  /** Gap between children, mapped to the spacing scale. Defaults to `sm` (--space-2, 8px). */
  gap?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Allow children to wrap onto multiple lines. */
  wrap?: boolean;
  style?: CSSProperties;
}

export declare function Stack(props: StackProps): JSX.Element;

// ----- Wrap (layout) -----
export type WrapGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16;

/**
 * Wrap — a flex row that wraps onto multiple lines, spaced by a
 * `--space-*` token. Use for badge/tag groups and button rows that should
 * reflow on narrow viewports rather than overflow.
 */
export interface WrapProps extends React.HTMLAttributes<HTMLElement> {
  /** Spacing-scale step, mapped to `var(--space-<gap>)`. Defaults to `2`. */
  gap?: WrapGap;
  align?: "flex-start" | "center" | "flex-end" | "baseline" | "stretch";
  justify?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly";
  /** Element/component to render as. Defaults to `"div"`. */
  as?: React.ElementType;
}

export function Wrap(props: WrapProps): React.JSX.Element;

// ----- BottomNav (mobile) -----
/** A single tab in the BottomNav bar. */
export interface BottomNavItem {
  /** Unique identifier matched against `activeId`. */
  id: string;
  /** Short label rendered below the icon (≤10 chars recommended). */
  label: string;
  /** Icon element — use a 24px SVG or an icon component. */
  icon: React.ReactNode;
}

/**
 * Bottom navigation bar — mobile equivalent of SidePanel, rendered at the
 * bottom of the viewport. Max 4 items; active tab shows the fuse-seam pill
 * indicator and accent-color label + icon.
 */
export interface BottomNavProps {
  /** Navigation items (max 4 rendered; extras ignored). */
  items: BottomNavItem[];
  /** `id` of the currently active tab. */
  activeId?: string;
  /** Called with the `id` of the tapped tab. */
  onSelect?: (id: string) => void;
  /** Extra styles applied to the `<nav>` element. */
  style?: React.CSSProperties;
}

export function BottomNav(props: BottomNavProps): React.JSX.Element;

// ----- BottomSheet (mobile) -----
/**
 * Bottom sheet — mobile equivalent of Modal. Slides up from the bottom of the
 * screen, capped at `--sheet-max-h` (80dvh). The fuse-seam gradient appears
 * below the drag handle. Focus is trapped; Escape and backdrop tap call `onClose`.
 *
 * Use on xs/sm screens (<768px). Prefer Modal on md+.
 */
export interface BottomSheetProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children" | "style" | "role"> {
  /** When false the sheet is unmounted entirely. */
  open: boolean;
  /** Called when user taps the backdrop or presses Escape. */
  onClose?: () => void;
  /** Sheet heading — wired to `aria-labelledby`. */
  title?: React.ReactNode;
  /** Sheet body content. */
  children?: React.ReactNode;
  /** Extra inline styles applied to the sheet panel. */
  style?: React.CSSProperties;
  /**
   * Any other attribute (`data-*`, `aria-describedby`, `aria-busy`, `aria-label`,
   * `id`…) is forwarded to the `role="dialog"` element.
   */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export function BottomSheet(props: BottomSheetProps): React.JSX.Element | null;

// ----- Drawer (mobile) -----
/**
 * Slide-in navigation drawer for mobile (<768px). Opens from the left at
 * `--drawer-width` (280px). The header slot carries the fuse-seam bottom
 * border matching the desktop SidePanel identity. Focus is trapped inside;
 * Escape and backdrop tap call `onClose`.
 */
export interface DrawerProps {
  /** When false the drawer is unmounted entirely. */
  open: boolean;
  /** Called when user taps the backdrop or presses Escape. */
  onClose?: () => void;
  /**
   * Content rendered in the drawer header (e.g. BrandMark + org name).
   * The fuse-seam gradient replaces the header's bottom border.
   */
  header?: React.ReactNode;
  /** Navigation items — typically a list of MenuItem components. */
  children?: React.ReactNode;
  /**
   * Content pinned to the bottom of the drawer (e.g. user avatar + email).
   * Receives `padding-bottom: env(safe-area-inset-bottom)` automatically.
   */
  footer?: React.ReactNode;
  /** Extra inline styles applied to the drawer panel. */
  style?: React.CSSProperties;
}

export function Drawer(props: DrawerProps): React.JSX.Element | null;

// ----- Breadcrumb (navigation) -----
export interface BreadcrumbItem {
  /** Stable key for the step; also set as `data-breadcrumb-step`. Falls back to index. */
  key?: string;
  /** The step's visible label. */
  label: React.ReactNode;
  /** Optional tier/kind label rendered before `label` in mono caps (e.g. "org"). */
  kind?: string;
  /** Marks this step as the active one — accent treatment + `aria-current="true"`. */
  current?: boolean;
  /** Renders the step as an `<a href>`. */
  href?: string;
  /** Renders the step as a `<button>`. Ignored if `href` is set. */
  onClick?: () => void;
}

/**
 * A trail of steps in a hierarchy — a breadcrumb, or (with `kind` set per
 * item) a labeled resolution/scope chain. The active step carries
 * `aria-current="true"`.
 */
export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items?: BreadcrumbItem[];
}

export function Breadcrumb(props: BreadcrumbProps): React.JSX.Element;

// ----- Pagination (navigation) -----
export interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Current active page (1-indexed). */
  page?: number;
  /** Total number of pages. */
  total?: number;
  /** Called with the new page number when a page button is clicked. */
  onChange?: (page: number) => void;
  style?: CSSProperties;
}

export declare function Pagination(props: PaginationProps): JSX.Element;

// ----- Modal (overlay) -----
/**
 * Generic accessible modal shell — backdrop, centered dialog card with the
 * fuse-seam top bar, focus trap, Escape close, and backdrop close.
 */
export interface ModalProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children" | "style" | "role"> {
  /** When false the modal is unmounted entirely (render null). */
  open: boolean;
  /** Called when the user presses Escape or clicks the backdrop. */
  onClose?: () => void;
  /** Dialog heading — wired to `aria-labelledby`. */
  title?: React.ReactNode;
  /** Dialog body content. */
  children?: React.ReactNode;
  /**
   * Controls `max-width`: `'md'` → `--modal-max-w` (560px),
   * `'lg'` → `--modal-max-w-lg` (720px). Default `'md'`.
   */
  size?: "md" | "lg";
  /** Extra inline styles applied to the dialog card. */
  style?: React.CSSProperties;
  /**
   * Any other attribute (`data-*`, `aria-describedby`, `aria-busy`, `aria-label`,
   * `id`…) is forwarded to the `role="dialog"` element.
   */
  [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
}

export function Modal(props: ModalProps): React.JSX.Element | null;

// ----- AnnouncementBar (shell) -----
export interface AnnouncementBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Short uppercase badge label rendered before the message (e.g. "New", "Beta"). */
  badge?: string;
  /** Text content of the announcement. Ignored when `children` are provided. */
  message?: string;
  /** Label for the optional inline CTA link. Requires `href`. */
  linkLabel?: string;
  /** URL the CTA link navigates to. */
  href?: string;
  children?: ReactNode;
  /** Called when the user dismisses the bar. */
  onClose?: () => void;
  style?: CSSProperties;
}

export declare function AnnouncementBar(props: AnnouncementBarProps): JSX.Element | null;

// ----- MenuItem (shell) -----
/**
 * Sidebar navigation row for the host shell — the active row carries the
 * "fuse seam" as a 3px rounded bar on its left edge.
 */
export interface MenuItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Leading glyph (an emoji or a small inline SVG with stroke="currentColor"). */
  icon?: React.ReactNode;
  /** The row's visible text. */
  label: React.ReactNode;
  /** When true: --accent-soft fill, primary text, semibold, and the seam bar. */
  active?: boolean;
  /** Fired on click and on Enter/Space when focused. */
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

export function MenuItem(props: MenuItemProps): React.JSX.Element;

// ----- NavLink (shell) -----
/** A single row in a `NavLink`'s submenu flyout. */
export interface NavLinkSubmenuItem {
  /** Stable key for the row. Falls back to `href`, then `to`, then index. */
  key?: string;
  /** The row's visible label. */
  label: React.ReactNode;
  /** Optional secondary line under the label. */
  description?: React.ReactNode;
  /** Destination when the row renders as a plain anchor. */
  href?: string;
  /** Fired on click (in addition to the row element's default navigation). */
  onClick?: (e: React.MouseEvent) => void;
  /** Any other prop (e.g. `to` for a router `Link` passed via `submenuAs`) is
   * forwarded verbatim to the row's rendered element. */
  [prop: string]: unknown;
}

/**
 * A single horizontal top-nav entry — `MenuItem`'s counterpart for a
 * horizontal bar. Renders a real anchor (or a router `Link` via `as`), marks
 * the current page with `active`, and — with `submenu` — discloses a
 * hover/focus flyout panel per the WAI-ARIA disclosure-navigation pattern.
 */
export interface NavLinkProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onFocus" | "onBlur" | "onMouseEnter" | "onMouseLeave"> {
  /** The element/component to render the trigger as. Defaults to `"a"`; pass a
   * router `Link` component to get `to`-based navigation (still accepts `href`
   * via passthrough props for a plain anchor). */
  as?: React.ElementType;
  /** The link's visible text. */
  label: React.ReactNode;
  /** When true: seam-accent underline, primary text, semibold, `aria-current="page"`. */
  active?: boolean;
  /** Rows shown in the hover/focus flyout panel. Omit/empty for a plain link. */
  submenu?: NavLinkSubmenuItem[];
  /** The element/component to render each submenu row as. Defaults to `"a"`;
   * pass a router `Link` component to make a row's `to` field navigate. */
  submenuAs?: React.ElementType;
  /** Controlled open state for the submenu panel. */
  open?: boolean;
  /** Initial open state when uncontrolled. Defaults to `false`. */
  defaultOpen?: boolean;
  /** Fired whenever the submenu's open state changes (hover, focus, Escape). */
  onOpenChange?: (open: boolean) => void;
  /** Destination when `as` is left as the default anchor. */
  href?: string;
  /** Fired on click. */
  onClick?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
}

export function NavLink(props: NavLinkProps): React.JSX.Element;

// ----- Tabs (shell) -----
/** A single tab in the strip. */
export interface TabItem {
  /** Unique value — passed to `onChange` and compared with `value`. */
  value: string;
  /** Visible label. */
  label: React.ReactNode;
  /** Optional id for the tab button (for `aria-labelledby` on the panel). */
  id?: string;
  /** id of the `role="tabpanel"` this tab controls (`aria-controls`). */
  controls?: string;
  /** When set, the tab renders as an `<a href={href}>` instead of a
   * `<button>` — for a tabbed console shell where each tab is its own route
   * (e.g. Portal Admin → Overview / Users / App catalog / Billing). */
  href?: string;
}

/**
 * Accessible, controlled tab strip (WAI-ARIA tabs pattern, automatic
 * activation). The active tab is highlighted with a seam-accent underline and
 * `aria-selected`.
 */
export interface TabsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  tabs: TabItem[];
  /** Value of the currently active tab. */
  value: string;
  /** Called with the new tab value on click or arrow-key navigation. */
  onChange?: (value: string) => void;
  /** Accessible label for the tablist. */
  ariaLabel?: string;
}

export function Tabs(props: TabsProps): React.JSX.Element;

// ----- ThemeToggle (shell) -----
/**
 * Icon button that toggles the host shell between dark and light themes,
 * flipping document data-theme. Shows a moon in dark mode, a sun in light.
 */
export interface ThemeToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onToggle"> {
  /** Current theme; selects the icon (moon in dark, sun in light). */
  theme?: "dark" | "light";
  /**
   * Called after data-theme is set, with the newly applied theme value.
   * Use it to sync app state / persist the choice.
   */
  onToggle?: (next: "dark" | "light", event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ThemeToggle(props: ThemeToggleProps): React.JSX.Element;

// ----- TopBar (shell) -----
/**
 * The host shell header — fixed-height bar on the deepest surface, carrying the
 * signature "fuse seam" gradient underline.
 */
export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  /** Left slot — typically the Logo / brand mark and shell title. */
  brand?: React.ReactNode;
  /** Right slot — header controls (ThemeToggle, user menu, etc.). Aliased by `children`. */
  actions?: React.ReactNode;
  /** Right slot fallback when `actions` is not provided. */
  children?: React.ReactNode;
}

export function TopBar(props: TopBarProps): React.JSX.Element;

// ----- UserMenu (shell) -----
/** The signed-in user the menu renders. */
export interface UserMenuUser {
  /** Given name; combined with `lastName` for the display name and initials. */
  firstName?: string;
  /** Family name; combined with `firstName` for the display name and initials. */
  lastName?: string;
  /** Always shown in the header (mono); the fallback display name + initial. */
  email: string;
  /** Role scopes. Containing `"admin"` reveals the Admin row + role tag. */
  roles?: string[];
}

/**
 * Top-bar account control for the host shell — an Avatar button that
 * opens a dropdown with a user header and account actions.
 */
export interface UserMenuProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** The signed-in user; the menu renders nothing when this is null. */
  user: UserMenuUser | null;
  /** Called with the target route when Profile / Settings / Admin is chosen. */
  onNavigate?: (path: string) => void;
  /** Called when the (coral-toned) Sign out row is chosen. */
  onSignOut?: () => void;
}

export function UserMenu(props: UserMenuProps): React.JSX.Element | null;
