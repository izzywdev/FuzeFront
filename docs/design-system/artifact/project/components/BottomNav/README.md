A single tab in the BottomNav bar. */
export interface BottomNavItem {
/** Unique identifier matched against `activeId`. */
id: string;
/** Short label rendered below the icon (≤10 chars recommended). */
label: string;
/** Icon element — use a 24px SVG or an icon component. */
icon: React.ReactNode;
}

/**
Bottom navigation bar — mobile equivalent of SidePanel, rendered at the
bottom of the viewport. Max 4 items; active tab shows the fuse-seam pill
indicator and accent-color label + icon.

**Props**

- `items` — Navigation items (max 4 rendered; extras ignored).
- `activeId?` — `id` of the currently active tab.
- `onSelect?` — Called with the `id` of the tapped tab.

See `components/index.d.ts` for the full prop contract.
