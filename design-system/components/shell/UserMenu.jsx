import React from "react";

// --- icons (inline, currentColor) --------------------------------
const UserIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SettingsIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const AdminIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const SignOutIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

// --- helpers ------------------------------------------------------
function fullName(user) {
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  if (user.firstName) return user.firstName;
  return user.email;
}

function initials(user) {
  if (user.firstName && user.lastName) {
    return (user.firstName[0] + user.lastName[0]).toUpperCase();
  }
  if (user.firstName) return user.firstName[0].toUpperCase();
  return (user.email || "?")[0].toUpperCase();
}

function isAdmin(roles) {
  return Array.isArray(roles) && roles.includes("admin");
}

// A single row in the dropdown. `tone` swaps the resting color and the
// hover wash (error rows wash coral, the rest wash --bg-quaternary).
function MenuRow({ icon, label, tone = "default", onClick }) {
  const isError = tone === "error";
  const restColor = isError ? "var(--error-color)" : "var(--text-secondary)";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        width: "100%",
        padding: "var(--space-2) var(--space-3)",
        border: "none",
        borderRadius: "var(--radius-md)",
        background: "transparent",
        color: restColor,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-regular)",
        textAlign: "left",
        cursor: "pointer",
        transition:
          "background-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isError
          ? "color-mix(in srgb, var(--error-color) 12%, transparent)"
          : "var(--bg-quaternary)";
        e.currentTarget.style.color = isError
          ? "var(--error-color)"
          : "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = restColor;
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", flex: "none" }}>
        {icon}
      </span>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

/**
 * Top-bar account control for the host shell: an avatar button that
 * opens a dropdown panel. The panel carries a user header (name / email /
 * role) and the account actions — Profile, Settings, an Admin row gated
 * on the `admin` role, and a coral-toned Sign out. Reuses the Avatar
 * "fuse" gradient visual; navigation is delegated via `onNavigate`.
 */
export function UserMenu({ user, onNavigate, onSignOut, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  if (!user) return null;

  const name = fullName(user);
  const admin = isAdmin(user.roles);

  const go = (path) => {
    setOpen(false);
    if (onNavigate) onNavigate(path);
  };

  return (
    <div style={{ position: "relative", ...style }} {...rest}>
      {/* Avatar trigger — initials on the indigo "fuse" gradient. */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-pill)",
          background:
            "linear-gradient(45deg, var(--accent-color), var(--accent-hover))",
          color: "#fff",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "var(--tracking-wide)",
          lineHeight: 1,
          cursor: "pointer",
          userSelect: "none",
          boxShadow: "var(--shadow-xs)",
          transition:
            "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow = "var(--shadow-accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "var(--shadow-xs)";
        }}
      >
        {initials(user)}
      </button>

      {open && (
        <>
          {/* Click-away scrim. */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "transparent",
              zIndex: 999,
            }}
          />
          <div
            role="menu"
            aria-label={`Account menu for ${name}`}
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: "var(--space-2)",
              minWidth: 240,
              padding: "var(--space-2)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 1000,
            }}
          >
            {/* User header. */}
            <div
              style={{
                padding: "var(--space-3) var(--space-3) var(--space-3)",
                borderBottom: "1px solid var(--border-color)",
                marginBottom: "var(--space-2)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--text-primary)",
                }}
              >
                {name}
              </div>
              <div
                style={{
                  marginTop: "var(--space-1)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-2xs)",
                  color: "var(--text-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.email}
              </div>
              <div
                style={{
                  marginTop: "var(--space-2)",
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--weight-semibold)",
                  letterSpacing: "var(--tracking-wide)",
                  textTransform: "uppercase",
                  color: admin ? "var(--accent-2)" : "var(--text-secondary)",
                }}
              >
                {admin ? "Administrator" : "User"}
              </div>
            </div>

            {/* Items. */}
            <MenuRow
              icon={<UserIcon />}
              label="Profile"
              onClick={() => go("/profile")}
            />
            <MenuRow
              icon={<SettingsIcon />}
              label="Settings"
              onClick={() => go("/settings")}
            />
            {admin && (
              <MenuRow
                icon={<AdminIcon />}
                label="Admin"
                onClick={() => go("/admin")}
              />
            )}

            {/* Sign out — error tone, separated by a divider. */}
            <div
              style={{
                marginTop: "var(--space-2)",
                paddingTop: "var(--space-2)",
                borderTop: "1px solid var(--border-color)",
              }}
            >
              <MenuRow
                icon={<SignOutIcon />}
                label="Sign out"
                tone="error"
                onClick={() => {
                  setOpen(false);
                  if (onSignOut) onSignOut();
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
