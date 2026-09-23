import React from "react";

// Chevron glyph marking a link that opens a submenu; rotates open.
const ChevronIcon = ({ open }) => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{
      flex: "none",
      transform: open ? "rotate(180deg)" : "rotate(0deg)",
      transition: "transform var(--duration-fast) var(--ease-standard)",
    }}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

// A single row inside the submenu panel: label + optional description.
// `label`/`description`/`key` are this component's own concerns; every other
// field on `item` (href, or `to` for a router Link passed via `as`) is
// forwarded straight to the rendered element, so the row works the same way
// NavLink's own trigger does with a plain anchor or a polymorphic `as`.
function SubmenuLink({ as: Component = "a", item }) {
  const { label, description, key: _key, ...linkProps } = item;
  return (
    <Component
      {...linkProps}
      style={{
        display: "block",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-md)",
        color: "var(--text-primary)",
        textDecoration: "none",
        transition: "background-color var(--duration-fast) var(--ease-standard)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-quaternary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
        }}
      >
        {label}
      </div>
      {description != null && (
        <div
          style={{
            marginTop: "var(--space-1)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          {description}
        </div>
      )}
    </Component>
  );
}

let uid = 0;
function useStableId(explicit) {
  const ref = React.useRef(explicit || null);
  if (!ref.current) ref.current = `navlink-${(uid += 1)}`;
  return explicit || ref.current;
}

/**
 * A single horizontal top-nav entry — the `MenuItem` sidebar row's
 * counterpart for a horizontal bar (marketing header, tabbed top nav). Renders
 * a real anchor (or a router `Link` via `as`) sized to sit inline in a flex
 * row, marks the current page with `active` (seam-accent underline, never
 * color alone), and — with `submenu` — discloses a hover/focus flyout panel
 * of related links, per the WAI-ARIA "disclosure navigation" pattern
 * (`aria-haspopup` + `aria-expanded` + `aria-controls` on the trigger; the
 * panel is plain content, not `role="menu"`, since these are navigation
 * links, not actions). `submenuAs` polymorphs the submenu rows the same way
 * `as` polymorphs the trigger (e.g. a router `Link`, so a submenu item's
 * `to` field — not just `href` — takes over navigation).
 *
 * Multiple `NavLink`s compose into a row by placing them in a flex container
 * with `gap: var(--space-*)` — unlike `MenuItem`, `NavLink` carries no
 * vertical stacking margin of its own.
 */
export function NavLink({
  as: Component = "a",
  label,
  active = false,
  submenu,
  submenuAs,
  open,
  defaultOpen = false,
  onOpenChange,
  id,
  style,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...rest
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolledOpen;
  const hasSubmenu = Array.isArray(submenu) && submenu.length > 0;
  const rootRef = React.useRef(null);
  const closeTimer = React.useRef(null);
  // Escape closes the panel and returns focus to the trigger; that programmatic
  // focus() otherwise fires the trigger's own onFocus and reopens the panel it
  // just closed. Suppress exactly that one reopen.
  const suppressReopenOnFocus = React.useRef(false);
  const panelId = useStableId(id ? `${id}-panel` : undefined);

  const setOpen = React.useCallback(
    (next) => {
      if (!isControlled) setUncontrolledOpen(next);
      if (onOpenChange) onOpenChange(next);
    },
    [isControlled, onOpenChange],
  );

  const openNow = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (hasSubmenu) setOpen(true);
  }, [hasSubmenu, setOpen]);

  const closeSoon = React.useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, [setOpen]);

  React.useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        suppressReopenOnFocus.current = true;
        rootRef.current?.querySelector("a,button")?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, setOpen]);

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={(e) => {
        openNow();
        if (onMouseEnter) onMouseEnter(e);
      }}
      onMouseLeave={(e) => {
        closeSoon();
        if (onMouseLeave) onMouseLeave(e);
      }}
    >
      <Component
        id={id}
        aria-current={active ? "page" : undefined}
        aria-haspopup={hasSubmenu ? "true" : undefined}
        aria-expanded={hasSubmenu ? isOpen : undefined}
        aria-controls={hasSubmenu ? panelId : undefined}
        onFocus={(e) => {
          if (suppressReopenOnFocus.current) {
            suppressReopenOnFocus.current = false;
          } else {
            openNow();
          }
          if (onFocus) onFocus(e);
        }}
        onBlur={(e) => {
          if (!rootRef.current?.contains(e.relatedTarget)) closeSoon();
          if (onBlur) onBlur(e);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-md)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: active ? "var(--weight-semibold)" : "var(--weight-medium)",
          color: active ? "var(--text-primary)" : "var(--text-secondary)",
          textDecoration: active ? "underline" : "none",
          textDecorationColor: "var(--accent-color)",
          textDecorationThickness: "2px",
          textUnderlineOffset: "var(--space-2)",
          whiteSpace: "nowrap",
          cursor: "pointer",
          userSelect: "none",
          transition:
            "color var(--duration-base) var(--ease-standard), background-color var(--duration-base) var(--ease-standard)",
        }}
        onMouseOver={(e) => {
          if (!active) e.currentTarget.style.color = "var(--text-primary)";
        }}
        onMouseOut={(e) => {
          if (!active) e.currentTarget.style.color = "var(--text-secondary)";
        }}
        {...rest}
      >
        <span>{label}</span>
        {hasSubmenu && <ChevronIcon open={isOpen} />}
      </Component>

      {hasSubmenu && isOpen && (
        <div
          id={panelId}
          aria-label={typeof label === "string" ? `${label} submenu` : undefined}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "var(--space-2)",
            minWidth: 220,
            padding: "var(--space-2)",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-pop)",
            zIndex: "var(--z-dropdown)",
          }}
        >
          {submenu.map((item, i) => (
            <SubmenuLink key={item.key ?? item.href ?? item.to ?? i} as={submenuAs} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
