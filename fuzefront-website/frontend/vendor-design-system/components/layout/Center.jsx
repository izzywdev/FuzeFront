import React from "react";

/**
 * Center — horizontally centers block content (a hero heading + paragraph,
 * a stat/perk grid item, a loading/status panel) by applying
 * `text-align: center` to the wrapper. Replaces the ad-hoc
 * `className="text-center"` div duplicated across the host shell and the
 * marketing site's hero sections and stat/perk grids (ds-fp:9f5f7da9ce3f).
 *
 * Polymorphic via `as` so it can stand in for the plain `<div>` these call
 * sites used, or wrap an animation-driving element (e.g. framer-motion's
 * `motion.div`) with no extra nesting level — any additional props (such as
 * `initial`/`animate`/`transition`/`variants`) are forwarded to the
 * rendered element untouched.
 *
 * `text-align: center` has no start/end direction to flip, so it mirrors
 * automatically under RTL — no logical-property variant is needed here.
 */
export function Center({ as: As = "div", children, style, ...rest }) {
  return (
    <As
      style={{
        textAlign: "center",
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
