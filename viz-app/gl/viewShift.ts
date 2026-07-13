// Overlay-panel geometry shared by the GL stage and the DOM chrome. Both
// side panels overlay the full-bleed canvas rather than sharing layout space
// with it, so the scene always spans the whole viewport — only the projection
// center shifts, by half the imbalance between the two insets, to keep
// content centered in the strip that's actually clear of both panels.

/** Sidebar.svelte's #side is an absolute overlay of this width — CSS and JS
 *  can't share a literal, so every JS consumer imports this one. */
export const SIDEBAR_W = 260;

/** Projection-center x offset in px (the setViewOffset x argument). */
export const viewOffsetX = (leftInset: number, rightInset: number): number => (rightInset - leftInset) / 2;
