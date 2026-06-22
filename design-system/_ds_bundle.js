var FuzeFrontDesignSystem = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // design-system/index.js
  var index_exports = {};
  __export(index_exports, {
    AppCard: () => AppCard,
    Avatar: () => Avatar,
    Badge: () => Badge,
    BrandMark: () => BrandMark,
    Button: () => Button,
    Card: () => Card,
    HealthDot: () => HealthDot2,
    IconButton: () => IconButton,
    Input: () => Input,
    IntegrationBadge: () => IntegrationBadge2,
    MenuItem: () => MenuItem,
    Modal: () => Modal,
    ProgressMeter: () => ProgressMeter,
    RoleBadge: () => RoleBadge,
    SeamDivider: () => SeamDivider,
    Select: () => Select,
    StatusPill: () => StatusPill,
    ThemeToggle: () => ThemeToggle,
    Toast: () => Toast,
    TopBar: () => TopBar,
    UserMenu: () => UserMenu
  });

  // design-system/components/access/RoleBadge.jsx
  var import_react = __toESM(__require("react"), 1);
  var import_jsx_runtime = __require("react/jsx-runtime");
  var Crown = ({ size = 12 }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z" })
    }
  );
  var Shield = ({ size = 12 }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" })
    }
  );
  var User = ({ size = 12 }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "8", r: "3.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5 20c0-3.5 3-6 7-6s7 2.5 7 6" })
      ]
    }
  );
  var Eye = ({ size = 12 }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "12", cy: "12", r: "2.5" })
      ]
    }
  );
  var ROLES = {
    owner: {
      label: "Owner",
      color: "var(--warning-color)",
      background: "rgba(245, 166, 35, 0.14)",
      border: "rgba(245, 166, 35, 0.32)",
      Icon: Crown
    },
    admin: {
      label: "Admin",
      color: "var(--accent-color)",
      background: "var(--accent-soft)",
      border: "rgba(110, 92, 255, 0.34)",
      Icon: Shield
    },
    member: {
      label: "Member",
      color: "var(--accent-2)",
      background: "rgba(41, 211, 230, 0.12)",
      border: "rgba(41, 211, 230, 0.30)",
      Icon: User
    },
    viewer: {
      label: "Viewer",
      color: "var(--text-tertiary)",
      background: "var(--bg-quaternary)",
      border: "var(--border-color)",
      Icon: Eye
    }
  };
  function RoleBadge({
    role = "member",
    showIcon = true,
    style,
    ...rest
  }) {
    const r = ROLES[role] || ROLES.member;
    const Icon = r.Icon;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "span",
      {
        title: r.label,
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "3px 10px 3px 8px",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          lineHeight: 1,
          whiteSpace: "nowrap",
          color: r.color,
          background: r.background,
          border: `1px solid ${r.border}`,
          borderRadius: "var(--radius-pill)",
          ...style
        },
        ...rest,
        children: [
          showIcon && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { size: 12 }),
          r.label
        ]
      }
    );
  }

  // design-system/components/brand/BrandMark.jsx
  var import_react2 = __toESM(__require("react"), 1);
  var import_jsx_runtime2 = __require("react/jsx-runtime");
  var SIZES = {
    sm: { font: "var(--text-base)", logo: 20, gap: "var(--space-2)" },
    md: { font: "var(--text-lg)", logo: 28, gap: "var(--space-2)" },
    lg: { font: "var(--text-2xl)", logo: 36, gap: "var(--space-3)" }
  };
  function BrandMark({
    size = "md",
    logo,
    alt = "FuzeFront",
    style,
    ...rest
  }) {
    const s = SIZES[size] || SIZES.md;
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: s.gap,
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-bold)",
          fontSize: s.font,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          userSelect: "none",
          ...style
        },
        ...rest,
        children: [
          logo && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "img",
            {
              src: logo,
              alt,
              style: { height: s.logo, width: "auto", display: "block", flex: "none" }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "span",
              {
                style: {
                  background: "var(--seam)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "transparent"
                },
                children: "Fuze"
              }
            ),
            "Front"
          ] })
        ]
      }
    );
  }

  // design-system/components/brand/SeamDivider.jsx
  var import_react3 = __toESM(__require("react"), 1);
  var import_jsx_runtime3 = __require("react/jsx-runtime");
  var ORIENTATIONS = {
    horizontal: {
      width: "100%",
      background: "var(--seam)"
    },
    vertical: {
      height: "100%",
      // re-aim the indigo->cyan seam down the vertical axis
      background: "linear-gradient(180deg, var(--accent-color) 0%, var(--accent-2) 100%)"
    }
  };
  function SeamDivider({
    orientation = "horizontal",
    thickness = 2,
    opacity = 1,
    glow = false,
    style,
    ...rest
  }) {
    const isVertical = orientation === "vertical";
    const o = ORIENTATIONS[orientation] || ORIENTATIONS.horizontal;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "div",
      {
        role: "separator",
        "aria-orientation": orientation,
        style: {
          flex: "none",
          borderRadius: "var(--radius-pill)",
          height: isVertical ? "100%" : `${thickness}px`,
          width: isVertical ? `${thickness}px` : "100%",
          opacity,
          // the soft halo: a diffuse drop-shadow tinted with the fuse hue
          boxShadow: glow ? "0 0 8px var(--accent-color), 0 0 16px var(--accent-soft)" : "none",
          transition: "opacity var(--duration-base) var(--ease-standard)",
          ...o,
          ...style
        },
        ...rest
      }
    );
  }

  // design-system/components/core/Avatar.jsx
  var import_react4 = __toESM(__require("react"), 1);
  var import_jsx_runtime4 = __require("react/jsx-runtime");
  var SIZES2 = {
    sm: { box: 28, font: "var(--text-2xs)" },
    md: { box: 36, font: "var(--text-sm)" },
    lg: { box: 48, font: "var(--text-md)" }
  };
  function deriveInitials(name, email) {
    const n = (name || "").trim();
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return parts[0][0].toUpperCase();
    }
    const e = (email || "").trim();
    if (e) return e[0].toUpperCase();
    return "?";
  }
  function Avatar({
    name,
    email,
    size = "md",
    interactive = false,
    style,
    ...rest
  }) {
    const s = SIZES2[size] || SIZES2.md;
    const initials2 = deriveInitials(name, email);
    const label = name || email || "User";
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "span",
      {
        role: "img",
        "aria-label": label,
        title: label,
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          width: s.box,
          height: s.box,
          borderRadius: "var(--radius-pill)",
          background: "linear-gradient(45deg, var(--accent-color), var(--accent-hover))",
          color: "#fff",
          fontFamily: "var(--font-sans)",
          fontSize: s.font,
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "var(--tracking-wide)",
          lineHeight: 1,
          userSelect: "none",
          cursor: interactive ? "pointer" : "default",
          boxShadow: "var(--shadow-xs)",
          transition: "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
          ...style
        },
        onMouseEnter: interactive ? (e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow = "var(--shadow-accent)";
        } : void 0,
        onMouseLeave: interactive ? (e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "var(--shadow-xs)";
        } : void 0,
        ...rest,
        children: initials2
      }
    );
  }

  // design-system/components/core/Badge.jsx
  var import_react5 = __toESM(__require("react"), 1);
  var import_jsx_runtime5 = __require("react/jsx-runtime");
  var SIZES3 = {
    sm: { padding: "1px 7px", font: "var(--text-2xs)", gap: "4px", icon: 11 },
    md: { padding: "2px 9px", font: "var(--text-xs)", gap: "5px", icon: 13 }
  };
  var TONES = {
    neutral: {
      color: "var(--text-secondary)",
      background: "var(--bg-quaternary)",
      border: "1px solid var(--border-color)"
    },
    accent: {
      color: "var(--accent-color)",
      background: "var(--accent-soft)",
      border: "1px solid transparent"
    },
    success: {
      color: "var(--success-color)",
      background: "color-mix(in srgb, var(--success-color) 14%, transparent)",
      border: "1px solid transparent"
    },
    warning: {
      color: "var(--warning-color)",
      background: "color-mix(in srgb, var(--warning-color) 14%, transparent)",
      border: "1px solid transparent"
    },
    error: {
      color: "var(--error-color)",
      background: "color-mix(in srgb, var(--error-color) 14%, transparent)",
      border: "1px solid transparent"
    }
  };
  var Dot = ({ size = 6 }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 10 10",
      fill: "currentColor",
      style: { flex: "none" },
      "aria-hidden": "true",
      children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("circle", { cx: "5", cy: "5", r: "5" })
    }
  );
  function Badge({
    children,
    tone = "neutral",
    size = "md",
    mono = false,
    dot = false,
    style,
    ...rest
  }) {
    const s = SIZES3[size] || SIZES3.md;
    const t = TONES[tone] || TONES.neutral;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: s.gap,
          padding: s.padding,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: s.font,
          fontWeight: "var(--weight-medium)",
          letterSpacing: mono ? "var(--tracking-normal)" : "var(--tracking-wide)",
          lineHeight: 1.4,
          whiteSpace: "nowrap",
          borderRadius: "var(--radius-pill)",
          textTransform: mono ? "none" : "uppercase",
          ...t,
          ...style
        },
        ...rest,
        children: [
          dot && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Dot, { size: size === "sm" ? 5 : 6 }),
          children
        ]
      }
    );
  }

  // design-system/components/core/Button.jsx
  var import_react6 = __toESM(__require("react"), 1);
  var import_jsx_runtime6 = __require("react/jsx-runtime");
  var ArrowRight = ({ size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M5 12h14M13 6l6 6-6 6" })
    }
  );
  var SIZES4 = {
    sm: { padding: "8px 16px", font: "var(--text-xs)", icon: 14 },
    md: { padding: "12px 24px", font: "var(--text-sm)", icon: 16 },
    lg: { padding: "16px 32px", font: "var(--text-md)", icon: 18 }
  };
  var VARIANTS = {
    primary: {
      background: "var(--accent-color)",
      color: "#fff",
      border: "1px solid transparent",
      boxShadow: "var(--shadow-accent)",
      hover: "var(--accent-hover)"
    },
    secondary: {
      background: "var(--bg-quaternary)",
      color: "var(--text-primary)",
      border: "1px solid var(--border-color)",
      boxShadow: "none",
      hover: "var(--bg-tertiary)"
    },
    ghost: {
      background: "transparent",
      color: "var(--text-secondary)",
      border: "1px solid transparent",
      boxShadow: "none",
      hover: "var(--bg-quaternary)"
    },
    danger: {
      background: "var(--error-color)",
      color: "#fff",
      border: "1px solid transparent",
      boxShadow: "none",
      hover: "var(--error-color)"
    }
  };
  function Button({
    children,
    variant = "primary",
    size = "md",
    withArrow = false,
    leadingIcon = null,
    fullWidth = false,
    disabled = false,
    style,
    ...rest
  }) {
    const s = SIZES4[size] || SIZES4.md;
    const v = VARIANTS[variant] || VARIANTS.primary;
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "button",
      {
        disabled,
        style: {
          display: fullWidth ? "flex" : "inline-flex",
          width: fullWidth ? "100%" : "auto",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: s.padding,
          fontFamily: "var(--font-sans)",
          fontSize: s.font,
          fontWeight: "var(--weight-semibold)",
          lineHeight: 1,
          borderRadius: "var(--radius-md)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          whiteSpace: "nowrap",
          background: v.background,
          color: v.color,
          border: v.border,
          boxShadow: v.boxShadow,
          transition: "background var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
          ...style
        },
        onMouseEnter: (e) => {
          if (!disabled) e.currentTarget.style.background = v.hover;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = v.background;
          e.currentTarget.style.transform = "translateY(0)";
        },
        onMouseDown: (e) => {
          if (!disabled) e.currentTarget.style.transform = "translateY(1px)";
        },
        onMouseUp: (e) => {
          e.currentTarget.style.transform = "translateY(0)";
        },
        ...rest,
        children: [
          leadingIcon,
          children,
          withArrow && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ArrowRight, { size: s.icon })
        ]
      }
    );
  }

  // design-system/components/core/Card.jsx
  var import_react7 = __toESM(__require("react"), 1);
  var import_jsx_runtime7 = __require("react/jsx-runtime");
  function Card({
    children,
    seam = false,
    interactive = false,
    padded = true,
    style,
    ...rest
  }) {
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      "div",
      {
        style: {
          position: "relative",
          overflow: "hidden",
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          padding: padded ? "var(--space-6)" : 0,
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          transition: "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)",
          ...style
        },
        onMouseEnter: (e) => {
          if (!interactive) return;
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.borderColor = "var(--accent-color)";
        },
        onMouseLeave: (e) => {
          if (!interactive) return;
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.borderColor = "var(--border-color)";
        },
        ...rest,
        children: [
          seam && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "span",
            {
              "aria-hidden": "true",
              style: {
                position: "absolute",
                insetBlockStart: 0,
                insetInlineStart: 0,
                inlineSize: "100%",
                blockSize: "3px",
                background: "var(--seam)"
              }
            }
          ),
          children
        ]
      }
    );
  }

  // design-system/components/core/IconButton.jsx
  var import_react8 = __toESM(__require("react"), 1);
  var import_jsx_runtime8 = __require("react/jsx-runtime");
  var SIZES5 = {
    sm: { box: "30px", radius: "var(--radius-sm)", icon: 16 },
    md: { box: "38px", radius: "var(--radius-md)", icon: 18 },
    lg: { box: "44px", radius: "var(--radius-md)", icon: 20 }
  };
  function IconButton({
    children,
    label,
    size = "md",
    active = false,
    disabled = false,
    style,
    ...rest
  }) {
    const s = SIZES5[size] || SIZES5.md;
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "button",
      {
        type: "button",
        title: label,
        "aria-label": label,
        "aria-pressed": active,
        disabled,
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: s.box,
          height: s.box,
          padding: 0,
          flex: "none",
          background: active ? "var(--bg-quaternary)" : "transparent",
          color: active ? "var(--accent-color)" : "var(--text-primary)",
          border: "1px solid transparent",
          borderRadius: s.radius,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          lineHeight: 0,
          transition: "background var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
          ...style
        },
        onMouseEnter: (e) => {
          if (!disabled && !active)
            e.currentTarget.style.background = "var(--bg-quaternary)";
        },
        onMouseLeave: (e) => {
          if (!active) e.currentTarget.style.background = "transparent";
          e.currentTarget.style.transform = "scale(1)";
        },
        onMouseDown: (e) => {
          if (!disabled) e.currentTarget.style.transform = "scale(0.94)";
        },
        onMouseUp: (e) => {
          e.currentTarget.style.transform = "scale(1)";
        },
        ...rest,
        children
      }
    );
  }

  // design-system/components/feedback/Modal.jsx
  var import_react9 = __toESM(__require("react"), 1);
  var import_jsx_runtime9 = __require("react/jsx-runtime");
  function Modal({
    open = true,
    title,
    onClose,
    children,
    footer,
    labelledById = "ff-modal-title",
    style,
    ...rest
  }) {
    if (!open) return null;
    const stop = (e) => e.stopPropagation();
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      "div",
      {
        role: "presentation",
        onClick: onClose,
        onKeyDown: (e) => {
          if (e.key === "Escape") onClose?.();
        },
        style: {
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-4)",
          background: "color-mix(in srgb, var(--graphite-950) 70%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 1e3
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
          "div",
          {
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": title ? labelledById : void 0,
            onClick: stop,
            style: {
              position: "relative",
              inlineSize: "min(480px, 100%)",
              maxBlockSize: "calc(100vh - 2 * var(--space-8))",
              overflow: "auto",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-lg, 0 24px 64px rgba(0,0,0,0.5))",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              ...style
            },
            ...rest,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                "span",
                {
                  "aria-hidden": "true",
                  style: {
                    position: "absolute",
                    insetBlockStart: 0,
                    insetInlineStart: 0,
                    inlineSize: "100%",
                    blockSize: "3px",
                    background: "var(--seam)"
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-4)",
                    padding: "var(--space-6) var(--space-6) var(--space-4)"
                  },
                  children: [
                    title && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                      "h2",
                      {
                        id: labelledById,
                        style: {
                          margin: 0,
                          fontFamily: "var(--font-display)",
                          fontSize: "var(--text-lg)",
                          fontWeight: "var(--weight-semibold)",
                          color: "var(--text-primary)"
                        },
                        children: title
                      }
                    ),
                    onClose && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                      "button",
                      {
                        type: "button",
                        "aria-label": "Close",
                        onClick: onClose,
                        style: {
                          flex: "none",
                          inlineSize: "32px",
                          blockSize: "32px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "transparent",
                          color: "var(--text-secondary)",
                          border: "1px solid transparent",
                          borderRadius: "var(--radius-md)",
                          cursor: "pointer",
                          fontSize: "var(--text-lg)",
                          lineHeight: 1
                        },
                        onFocus: (e) => {
                          e.currentTarget.style.outline = "2px solid var(--accent-color)";
                          e.currentTarget.style.outlineOffset = "2px";
                        },
                        onBlur: (e) => {
                          e.currentTarget.style.outline = "none";
                        },
                        children: "\xD7"
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { padding: "0 var(--space-6) var(--space-6)" }, children }),
              footer && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "var(--space-3)",
                    padding: "var(--space-4) var(--space-6)",
                    borderBlockStart: "1px solid var(--border-color)"
                  },
                  children: footer
                }
              )
            ]
          }
        )
      }
    );
  }

  // design-system/components/feedback/ProgressMeter.jsx
  var import_react10 = __toESM(__require("react"), 1);
  var import_jsx_runtime10 = __require("react/jsx-runtime");
  var TONE_FILL = {
    seam: "var(--seam)",
    warning: "var(--warning-color)",
    danger: "var(--error-color)"
  };
  function ProgressMeter({
    value = 0,
    max = 100,
    label,
    valueLabel,
    tone = "seam",
    style,
    ...rest
  }) {
    const safeMax = max > 0 ? max : 1;
    const pct = Math.max(0, Math.min(100, value / safeMax * 100));
    const fill = TONE_FILL[tone] || TONE_FILL.seam;
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { style: { fontFamily: "var(--font-sans)", ...style }, ...rest, children: [
      (label || valueLabel) && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "var(--space-2)",
            marginBlockEnd: "var(--space-2)"
          },
          children: [
            label && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              "span",
              {
                style: {
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)"
                },
                children: label
              }
            ),
            valueLabel && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
              "span",
              {
                style: {
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)"
                },
                children: valueLabel
              }
            )
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
        "div",
        {
          role: "progressbar",
          "aria-valuenow": Math.round(value),
          "aria-valuemin": 0,
          "aria-valuemax": Math.round(safeMax),
          "aria-label": label || "progress",
          style: {
            position: "relative",
            inlineSize: "100%",
            blockSize: "8px",
            background: "var(--bg-quaternary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-pill)",
            overflow: "hidden"
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "span",
            {
              "aria-hidden": "true",
              style: {
                position: "absolute",
                insetBlockStart: 0,
                insetInlineStart: 0,
                blockSize: "100%",
                inlineSize: `${pct}%`,
                background: fill,
                borderRadius: "var(--radius-pill)",
                transition: "inline-size var(--duration-base) var(--ease-standard)"
              }
            }
          )
        }
      )
    ] });
  }

  // design-system/components/feedback/StatusPill.jsx
  var import_react11 = __toESM(__require("react"), 1);
  var import_jsx_runtime11 = __require("react/jsx-runtime");
  var STATUSES = {
    online: { color: "var(--success-color)", label: "Online" },
    degraded: { color: "var(--warning-color)", label: "Degraded" },
    offline: { color: "var(--error-color)", label: "Offline" }
  };
  function StatusPill({
    status = "online",
    label,
    style,
    ...rest
  }) {
    const s = STATUSES[status] || STATUSES.online;
    const text = label != null ? label : s.label;
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      "span",
      {
        role: "status",
        "aria-label": text,
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-1) var(--space-3)",
          background: "var(--bg-quaternary)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-pill)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--weight-medium)",
          lineHeight: 1,
          whiteSpace: "nowrap",
          ...style
        },
        ...rest,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
            "span",
            {
              "aria-hidden": "true",
              style: {
                flex: "none",
                width: "8px",
                height: "8px",
                borderRadius: "var(--radius-pill)",
                background: s.color,
                boxShadow: `0 0 0 3px color-mix(in srgb, ${s.color} 22%, transparent)`
              }
            }
          ),
          text
        ]
      }
    );
  }

  // design-system/components/feedback/Toast.jsx
  var import_react12 = __toESM(__require("react"), 1);
  var import_jsx_runtime12 = __require("react/jsx-runtime");
  var CloseIcon = ({ size = 14 }) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("path", { d: "M18 6 6 18M6 6l12 12" })
    }
  );
  var LEVELS = {
    success: { bar: "var(--success-color)" },
    warning: { bar: "var(--warning-color)" },
    error: { bar: "var(--error-color)" },
    info: { bar: "var(--accent-2)" }
  };
  function Toast({
    level = "info",
    title,
    message,
    onDismiss,
    style,
    ...rest
  }) {
    const l = LEVELS[level] || LEVELS.info;
    return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
      "div",
      {
        role: "status",
        style: {
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-3)",
          maxWidth: "360px",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-color)",
          borderLeft: `4px solid ${l.bar}`,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-md)",
          fontFamily: "var(--font-sans)",
          ...style
        },
        ...rest,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
            title && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "div",
              {
                style: {
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--text-primary)",
                  marginBottom: "var(--space-1)"
                },
                children: title
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
              "div",
              {
                style: {
                  fontSize: "var(--text-sm)",
                  lineHeight: 1.4,
                  color: "var(--text-secondary)",
                  wordBreak: "break-word"
                },
                children: message
              }
            )
          ] }),
          onDismiss && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
            "button",
            {
              type: "button",
              onClick: onDismiss,
              title: "Dismiss",
              "aria-label": "Dismiss",
              style: {
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                width: "24px",
                height: "24px",
                padding: 0,
                marginTop: "-2px",
                marginRight: "-4px",
                background: "transparent",
                color: "var(--text-tertiary)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                transition: "background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)"
              },
              onMouseEnter: (e) => {
                e.currentTarget.style.background = "var(--bg-quaternary)";
                e.currentTarget.style.color = "var(--text-primary)";
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-tertiary)";
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(CloseIcon, {})
            }
          )
        ]
      }
    );
  }

  // design-system/components/forms/Input.jsx
  var import_react13 = __toESM(__require("react"), 1);
  var import_jsx_runtime13 = __require("react/jsx-runtime");
  var WarningIcon = ({ size = 14 }) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("path", { d: "M12 9v4M12 17h.01" }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" })
      ]
    }
  );
  function Input({
    label,
    error = "",
    id,
    disabled = false,
    style,
    ...rest
  }) {
    const hasError = Boolean(error);
    const baseBorder = hasError ? "var(--error-color)" : "var(--border-color)";
    return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          width: "100%"
        },
        children: [
          label && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
            "label",
            {
              htmlFor: id,
              style: {
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-medium)",
                color: "var(--text-secondary)",
                lineHeight: 1.2
              },
              children: label
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
            "input",
            {
              id,
              disabled,
              "aria-invalid": hasError || void 0,
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: "var(--space-3) var(--space-3)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-regular)",
                lineHeight: 1.4,
                color: "var(--text-primary)",
                background: "var(--bg-secondary)",
                border: `1px solid ${baseBorder}`,
                borderRadius: "var(--radius-md)",
                outline: "none",
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? "not-allowed" : "text",
                transition: "border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard)",
                ...style
              },
              onFocus: (e) => {
                e.currentTarget.style.borderColor = hasError ? "var(--error-color)" : "var(--accent-color)";
                e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
                if (rest.onFocus) rest.onFocus(e);
              },
              onBlur: (e) => {
                e.currentTarget.style.borderColor = baseBorder;
                e.currentTarget.style.boxShadow = "none";
                if (rest.onBlur) rest.onBlur(e);
              },
              ...rest
            }
          ),
          hasError && /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
            "span",
            {
              role: "alert",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-medium)",
                color: "var(--error-color)",
                lineHeight: 1.3
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(WarningIcon, {}),
                error
              ]
            }
          )
        ]
      }
    );
  }

  // design-system/components/forms/Select.jsx
  var import_react14 = __toESM(__require("react"), 1);
  var import_jsx_runtime14 = __require("react/jsx-runtime");
  var ChevronDown = ({ size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("path", { d: "m6 9 6 6 6-6" })
    }
  );
  var WarningIcon2 = ({ size = 14 }) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("path", { d: "M12 9v4M12 17h.01" }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" })
      ]
    }
  );
  function Select({
    label,
    options = [],
    placeholder,
    error = "",
    id,
    disabled = false,
    children,
    style,
    ...rest
  }) {
    const hasError = Boolean(error);
    const baseBorder = hasError ? "var(--error-color)" : "var(--border-color)";
    return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          width: "100%"
        },
        children: [
          label && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
            "label",
            {
              htmlFor: id,
              style: {
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-medium)",
                color: "var(--text-secondary)",
                lineHeight: 1.2
              },
              children: label
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { style: { position: "relative", width: "100%" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
              "select",
              {
                id,
                disabled,
                "aria-invalid": hasError || void 0,
                style: {
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "var(--space-3) calc(var(--space-3) + var(--space-6)) var(--space-3) var(--space-3)",
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-regular)",
                  lineHeight: 1.4,
                  color: "var(--text-primary)",
                  background: "var(--bg-secondary)",
                  border: `1px solid ${baseBorder}`,
                  borderRadius: "var(--radius-md)",
                  outline: "none",
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  transition: "border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard)",
                  ...style
                },
                onFocus: (e) => {
                  e.currentTarget.style.borderColor = hasError ? "var(--error-color)" : "var(--accent-color)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
                  if (rest.onFocus) rest.onFocus(e);
                },
                onBlur: (e) => {
                  e.currentTarget.style.borderColor = baseBorder;
                  e.currentTarget.style.boxShadow = "none";
                  if (rest.onBlur) rest.onBlur(e);
                },
                ...rest,
                children: [
                  placeholder && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "", disabled: true, children: placeholder }),
                  options.map((o) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: o.value, disabled: o.disabled, children: o.label }, o.value)),
                  children
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
              "span",
              {
                "aria-hidden": "true",
                style: {
                  position: "absolute",
                  right: "var(--space-3)",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "inline-flex",
                  alignItems: "center",
                  color: "var(--text-tertiary)",
                  pointerEvents: "none"
                },
                children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ChevronDown, {})
              }
            )
          ] }),
          hasError && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
            "span",
            {
              role: "alert",
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-medium)",
                color: "var(--error-color)",
                lineHeight: 1.3
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(WarningIcon2, {}),
                error
              ]
            }
          )
        ]
      }
    );
  }

  // design-system/components/launcher/AppCard.jsx
  var import_react15 = __toESM(__require("react"), 1);
  var import_jsx_runtime15 = __require("react/jsx-runtime");
  var TYPES = {
    "module-federation": {
      emoji: "\u{1F517}",
      gradient: "linear-gradient(135deg, #15414f, var(--accent-2))"
    },
    iframe: {
      emoji: "\u{1F5BC}\uFE0F",
      gradient: "linear-gradient(135deg, #4a3a12, var(--warning-color))"
    },
    "web-component": {
      emoji: "\u{1F9E9}",
      gradient: "linear-gradient(135deg, #2f1f4f, var(--accent-color))"
    },
    other: {
      emoji: "\u{1F4F1}",
      gradient: "linear-gradient(135deg, #2f1f4f, var(--accent-color))"
    }
  };
  var HealthDot = ({ isHealthy }) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
    "span",
    {
      "aria-hidden": "true",
      style: {
        position: "absolute",
        bottom: "-2px",
        right: "-2px",
        width: "12px",
        height: "12px",
        borderRadius: "var(--radius-pill)",
        background: isHealthy ? "var(--success-color)" : "var(--error-color)",
        border: "2px solid var(--bg-tertiary)"
      }
    }
  );
  var IntegrationBadge = ({ integrationType }) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
    "span",
    {
      style: {
        display: "inline-block",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1,
        padding: "var(--space-1) var(--space-2)",
        borderRadius: "var(--radius-sm)",
        background: "var(--accent-soft)",
        color: "var(--accent-color)",
        textTransform: "lowercase",
        whiteSpace: "nowrap"
      },
      children: integrationType
    }
  );
  function AppCard({
    name,
    description,
    integrationType = "other",
    iconUrl,
    isHealthy = true,
    onClick,
    style,
    ...rest
  }) {
    const type = TYPES[integrationType] || TYPES.other;
    const lift = (e) => {
      if (!isHealthy) return;
      e.currentTarget.style.transform = "translateY(-2px)";
      e.currentTarget.style.boxShadow = "var(--shadow-md)";
      e.currentTarget.style.borderColor = "transparent";
      const seam = e.currentTarget.querySelector("[data-seam]");
      if (seam) seam.style.opacity = "1";
    };
    const settle = (e) => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.boxShadow = "none";
      e.currentTarget.style.borderColor = "var(--border-color)";
      const seam = e.currentTarget.querySelector("[data-seam]");
      if (seam) seam.style.opacity = "0";
    };
    return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
      "div",
      {
        role: "button",
        tabIndex: isHealthy ? 0 : -1,
        "aria-disabled": !isHealthy,
        title: isHealthy ? name : `${name} (offline)`,
        onClick: isHealthy ? onClick : void 0,
        onKeyDown: (e) => {
          if (!isHealthy || !onClick) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick(e);
          }
        },
        onMouseEnter: lift,
        onMouseLeave: settle,
        style: {
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          padding: "var(--space-6)",
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          cursor: isHealthy ? "pointer" : "not-allowed",
          opacity: isHealthy ? 1 : 0.6,
          filter: isHealthy ? "none" : "grayscale(0.5)",
          transition: "transform var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)",
          ...style
        },
        ...rest,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            "span",
            {
              "data-seam": true,
              "aria-hidden": "true",
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "2px",
                background: "var(--seam)",
                opacity: 0,
                transition: "opacity var(--duration-base) var(--ease-standard)"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "var(--space-4)",
                marginBottom: "var(--space-4)"
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: { position: "relative", width: "40px", height: "40px", flex: "none" }, children: [
                  iconUrl ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
                    "img",
                    {
                      src: iconUrl,
                      alt: "",
                      style: {
                        width: "40px",
                        height: "40px",
                        borderRadius: "10px",
                        objectFit: "cover"
                      },
                      onError: (e) => {
                        e.currentTarget.style.display = "none";
                      }
                    }
                  ) : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
                    "div",
                    {
                      "aria-hidden": "true",
                      style: {
                        width: "40px",
                        height: "40px",
                        borderRadius: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "var(--text-2xl)",
                        background: type.gradient
                      },
                      children: type.emoji
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(HealthDot, { isHealthy })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { style: { minWidth: 0 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
                    "h3",
                    {
                      style: {
                        margin: 0,
                        fontFamily: "var(--font-display)",
                        fontSize: "var(--text-lg)",
                        fontWeight: "var(--weight-semibold)",
                        color: isHealthy ? "var(--text-primary)" : "var(--text-tertiary)",
                        lineHeight: 1.2
                      },
                      children: [
                        name,
                        !isHealthy && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
                          "span",
                          {
                            style: {
                              marginLeft: "var(--space-2)",
                              fontSize: "var(--text-sm)",
                              fontWeight: "var(--weight-regular)",
                              color: "var(--error-color)"
                            },
                            children: "(Offline)"
                          }
                        )
                      ]
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { style: { marginTop: "var(--space-1)" }, children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(IntegrationBadge, { integrationType }) })
                ] })
              ]
            }
          ),
          description && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            "p",
            {
              style: {
                margin: 0,
                color: "var(--text-secondary)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.4
              },
              children: description
            }
          )
        ]
      }
    );
  }

  // design-system/components/launcher/HealthDot.jsx
  var import_react16 = __toESM(__require("react"), 1);
  var import_jsx_runtime16 = __require("react/jsx-runtime");
  var SIZES6 = {
    sm: { dot: 8, ring: 1.5 },
    md: { dot: 12, ring: 2 },
    lg: { dot: 16, ring: 2.5 }
  };
  function HealthDot2({
    healthy = true,
    size = "md",
    label,
    overlay = false,
    style,
    ...rest
  }) {
    const s = SIZES6[size] || SIZES6.md;
    const title = label || (healthy ? "Healthy \u2014 remote reachable" : "Offline \u2014 remote unreachable");
    return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
      "span",
      {
        role: "img",
        "aria-label": title,
        title,
        style: {
          display: "inline-block",
          width: s.dot,
          height: s.dot,
          borderRadius: "var(--radius-pill)",
          flex: "none",
          backgroundColor: healthy ? "var(--success-color)" : "var(--error-color)",
          border: `${s.ring}px solid var(--bg-tertiary)`,
          boxShadow: healthy ? "var(--shadow-xs)" : "none",
          ...overlay ? {
            position: "absolute",
            bottom: -2,
            right: -2
          } : {},
          ...style
        },
        ...rest
      }
    );
  }

  // design-system/components/launcher/IntegrationBadge.jsx
  var import_react17 = __toESM(__require("react"), 1);
  var import_jsx_runtime17 = __require("react/jsx-runtime");
  var VARIANTS2 = {
    "module-federation": { background: "var(--accent-soft)", color: "var(--accent-color)" },
    "iframe": { background: "var(--accent-soft)", color: "var(--accent-color)" },
    "web-component": { background: "var(--accent-soft)", color: "var(--accent-color)" }
  };
  function IntegrationBadge2({
    type = "module-federation",
    style,
    ...rest
  }) {
    const v = VARIANTS2[type] || VARIANTS2["module-federation"];
    return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
      "span",
      {
        style: {
          display: "inline-block",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-medium)",
          lineHeight: 1.4,
          letterSpacing: "0.01em",
          padding: "var(--space-1) var(--space-2)",
          borderRadius: "var(--radius-sm)",
          textTransform: "lowercase",
          whiteSpace: "nowrap",
          background: v.background,
          color: v.color,
          ...style
        },
        ...rest,
        children: type
      }
    );
  }

  // design-system/components/shell/MenuItem.jsx
  var import_react18 = __toESM(__require("react"), 1);
  var import_jsx_runtime18 = __require("react/jsx-runtime");
  function MenuItem({
    icon,
    label,
    active = false,
    onClick,
    style,
    ...rest
  }) {
    return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(
      "div",
      {
        role: "button",
        tabIndex: 0,
        "aria-current": active ? "page" : void 0,
        onClick,
        onKeyDown: (e) => {
          if (onClick && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onClick(e);
          }
        },
        style: {
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          margin: "var(--space-1) var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          borderRadius: "var(--radius-md)",
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: active ? "var(--weight-semibold)" : "var(--weight-regular)",
          color: active ? "var(--text-primary)" : "var(--text-secondary)",
          background: active ? "var(--accent-soft)" : "transparent",
          userSelect: "none",
          transition: "background-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)",
          ...style
        },
        onMouseEnter: (e) => {
          if (!active) {
            e.currentTarget.style.background = "var(--bg-quaternary)";
            e.currentTarget.style.color = "var(--text-primary)";
          }
        },
        onMouseLeave: (e) => {
          if (!active) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }
        },
        ...rest,
        children: [
          active && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "span",
            {
              "aria-hidden": "true",
              style: {
                position: "absolute",
                left: 0,
                top: "50%",
                transform: "translateY(-50%)",
                width: "3px",
                height: "1.1rem",
                borderRadius: "3px",
                background: "var(--seam)"
              }
            }
          ),
          icon != null && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
            "span",
            {
              "aria-hidden": "true",
              style: {
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none"
              },
              children: icon
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { style: { whiteSpace: "nowrap" }, children: label })
        ]
      }
    );
  }

  // design-system/components/shell/ThemeToggle.jsx
  var import_react19 = __toESM(__require("react"), 1);
  var import_jsx_runtime19 = __require("react/jsx-runtime");
  var Sun = ({ size = 18 }) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("circle", { cx: "12", cy: "12", r: "4" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" })
      ]
    }
  );
  var Moon = ({ size = 18 }) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("path", { d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" })
    }
  );
  function ThemeToggle({
    theme = "dark",
    onToggle,
    style,
    ...rest
  }) {
    const isDark = theme === "dark";
    const next = isDark ? "light" : "dark";
    const handleClick = (e) => {
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", next);
      }
      if (onToggle) onToggle(next, e);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      "button",
      {
        type: "button",
        onClick: handleClick,
        title: isDark ? "Switch to light theme" : "Switch to dark theme",
        "aria-label": isDark ? "Switch to light theme" : "Switch to dark theme",
        "aria-pressed": isDark,
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          padding: 0,
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: "var(--radius-md)",
          color: "var(--text-secondary)",
          cursor: "pointer",
          transition: "background-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
          ...style
        },
        onMouseEnter: (e) => {
          e.currentTarget.style.background = "var(--bg-quaternary)";
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.borderColor = "var(--border-color)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
          e.currentTarget.style.borderColor = "transparent";
          e.currentTarget.style.transform = "scale(1)";
        },
        onMouseDown: (e) => {
          e.currentTarget.style.transform = "scale(0.92)";
        },
        onMouseUp: (e) => {
          e.currentTarget.style.transform = "scale(1)";
        },
        ...rest,
        children: isDark ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Moon, {}) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Sun, {})
      }
    );
  }

  // design-system/components/shell/TopBar.jsx
  var import_react20 = __toESM(__require("react"), 1);
  var import_jsx_runtime20 = __require("react/jsx-runtime");
  function TopBar({
    brand,
    actions,
    children,
    style,
    ...rest
  }) {
    const right = actions ?? children;
    return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
      "header",
      {
        style: {
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          height: "var(--top-bar-height)",
          flex: "none",
          padding: "0 var(--space-5)",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          transition: "background-color var(--duration-slow) var(--ease-standard), border-color var(--duration-slow) var(--ease-standard)",
          ...style
        },
        ...rest,
        children: [
          brand != null && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
            "div",
            {
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-3)",
                minWidth: 0
              },
              children: brand
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { style: { flex: 1, minWidth: 0 } }),
          right != null && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
            "div",
            {
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)"
              },
              children: right
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
            "span",
            {
              "aria-hidden": "true",
              style: {
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "-1px",
                height: "1px",
                background: "var(--seam)",
                opacity: 0.7,
                pointerEvents: "none"
              }
            }
          )
        ]
      }
    );
  }

  // design-system/components/shell/UserMenu.jsx
  var import_react21 = __toESM(__require("react"), 1);
  var import_jsx_runtime21 = __require("react/jsx-runtime");
  var UserIcon = ({ size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("circle", { cx: "12", cy: "7", r: "4" })
      ]
    }
  );
  var SettingsIcon = ({ size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("circle", { cx: "12", cy: "12", r: "3" }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })
      ]
    }
  );
  var AdminIcon = ({ size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "m9 12 2 2 4-4" })
      ]
    }
  );
  var SignOutIcon = ({ size = 16 }) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { flex: "none" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "m16 17 5-5-5-5" }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("path", { d: "M21 12H9" })
      ]
    }
  );
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
  function MenuRow({ icon, label, tone = "default", onClick }) {
    const isError = tone === "error";
    const restColor = isError ? "var(--error-color)" : "var(--text-secondary)";
    return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
      "button",
      {
        type: "button",
        role: "menuitem",
        onClick,
        style: {
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
          transition: "background-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)"
        },
        onMouseEnter: (e) => {
          e.currentTarget.style.background = isError ? "color-mix(in srgb, var(--error-color) 12%, transparent)" : "var(--bg-quaternary)";
          e.currentTarget.style.color = isError ? "var(--error-color)" : "var(--text-primary)";
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = restColor;
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { "aria-hidden": "true", style: { display: "inline-flex", flex: "none" }, children: icon }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { style: { whiteSpace: "nowrap" }, children: label })
        ]
      }
    );
  }
  function UserMenu({ user, onNavigate, onSignOut, style, ...rest }) {
    const [open, setOpen] = import_react21.default.useState(false);
    if (!user) return null;
    const name = fullName(user);
    const admin = isAdmin(user.roles);
    const go = (path) => {
      setOpen(false);
      if (onNavigate) onNavigate(path);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { style: { position: "relative", ...style }, ...rest, children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
        "button",
        {
          type: "button",
          "aria-haspopup": "menu",
          "aria-expanded": open,
          title: name,
          onClick: () => setOpen((v) => !v),
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            padding: 0,
            border: "none",
            borderRadius: "var(--radius-pill)",
            background: "linear-gradient(45deg, var(--accent-color), var(--accent-hover))",
            color: "#fff",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-semibold)",
            letterSpacing: "var(--tracking-wide)",
            lineHeight: 1,
            cursor: "pointer",
            userSelect: "none",
            boxShadow: "var(--shadow-xs)",
            transition: "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)"
          },
          onMouseEnter: (e) => {
            e.currentTarget.style.transform = "scale(1.05)";
            e.currentTarget.style.boxShadow = "var(--shadow-accent)";
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = "var(--shadow-xs)";
          },
          children: initials(user)
        }
      ),
      open && /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(import_jsx_runtime21.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
          "div",
          {
            "aria-hidden": "true",
            onClick: () => setOpen(false),
            style: {
              position: "fixed",
              inset: 0,
              background: "transparent",
              zIndex: 999
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
          "div",
          {
            role: "menu",
            "aria-label": `Account menu for ${name}`,
            style: {
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
              zIndex: 1e3
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
                "div",
                {
                  style: {
                    padding: "var(--space-3) var(--space-3) var(--space-3)",
                    borderBottom: "1px solid var(--border-color)",
                    marginBottom: "var(--space-2)"
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                      "div",
                      {
                        style: {
                          fontFamily: "var(--font-display)",
                          fontSize: "var(--text-sm)",
                          fontWeight: "var(--weight-semibold)",
                          color: "var(--text-primary)"
                        },
                        children: name
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                      "div",
                      {
                        style: {
                          marginTop: "var(--space-1)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-2xs)",
                          color: "var(--text-tertiary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        },
                        children: user.email
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                      "div",
                      {
                        style: {
                          marginTop: "var(--space-2)",
                          fontFamily: "var(--font-sans)",
                          fontSize: "var(--text-2xs)",
                          fontWeight: "var(--weight-semibold)",
                          letterSpacing: "var(--tracking-wide)",
                          textTransform: "uppercase",
                          color: admin ? "var(--accent-2)" : "var(--text-secondary)"
                        },
                        children: admin ? "Administrator" : "User"
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                MenuRow,
                {
                  icon: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(UserIcon, {}),
                  label: "Profile",
                  onClick: () => go("/profile")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                MenuRow,
                {
                  icon: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(SettingsIcon, {}),
                  label: "Settings",
                  onClick: () => go("/settings")
                }
              ),
              admin && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                MenuRow,
                {
                  icon: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(AdminIcon, {}),
                  label: "Admin",
                  onClick: () => go("/admin")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                "div",
                {
                  style: {
                    marginTop: "var(--space-2)",
                    paddingTop: "var(--space-2)",
                    borderTop: "1px solid var(--border-color)"
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
                    MenuRow,
                    {
                      icon: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(SignOutIcon, {}),
                      label: "Sign out",
                      tone: "error",
                      onClick: () => {
                        setOpen(false);
                        if (onSignOut) onSignOut();
                      }
                    }
                  )
                }
              )
            ]
          }
        )
      ] })
    ] });
  }
  return __toCommonJS(index_exports);
})();
