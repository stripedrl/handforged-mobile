/**
 * @file infoPanels.js
 * THE ONE-PANEL INVARIANT (JC, 2026-08-11): "tapping something opens the box AND
 * the old tooltip at once. After this, exactly ONE description panel can be
 * visible at a time on touch, ever."
 *
 * ===========================================================================
 * WHY A REGISTRY AND NOT A CONVENTION
 * ===========================================================================
 * This game grew SIX independent description surfaces, each with its own handle
 * on its own scene and its own idea of what "close the other one" means:
 *
 *   ui/choicebox.js    scene._choiceBox    the two-tap box   (window.__hfBox)
 *   ui/inspect.js      scene._inspectPanel the card panel    (window.__hfInspect)
 *   CombatScene        this.intentTip      rule / intent / relic / potion tips
 *   CombatScene        this.pstatTip       the player debuff chips
 *   MapScene           this.mapTip         belt / potion / shop / node tips
 *   ui/oracleChip.js   scene.oracleTip     the oracle + passive chips
 *
 * Every one of them cleared ITS OWN handle before drawing, and none of them
 * knew the other five existed. That is exactly the double-description bug: the
 * choice box cleared choice boxes, the tooltip cleared tooltips, and a single
 * touch that woke both got both.
 *
 * So the invariant is not "remember to close the other one at all 40 call
 * sites". It is: EVERY panel announces itself here, and announcing yourself
 * closes whatever was already up. One line per surface, and a surface added in
 * six months that forgets the line is visible in `window.__hfPanels.list()`
 * — the driver asserts the count after tapping every convertible thing.
 *
 * DESKTOP PAYS NOTHING FOR THIS. The registry is live on both builds (a desktop
 * hover tooltip registers too), but on desktop the mutual close is a no-op in
 * practice: a mouse can only be over one thing at a time, so the second panel
 * was already replacing the first. It is on TOUCH — where a tap is a press, a
 * release, a synthesised hover and a long-press candidate all at once — that
 * two surfaces can be woken by one gesture.
 */

/** token -> { kind, key, close } for every description panel currently drawn. */
const openPanels = new Map();
let seq = 0;

/**
 * Announce a panel. Closes every other registered panel first, so the caller
 * does not have to know what else exists.
 *
 * @param {string} kind  'choice' | 'inspect' | 'tip' — the surface family.
 * @param {string} key   what it describes, for the driver's readout.
 * @param {function} close  tear THIS panel down. Must be idempotent and must
 *                          NOT call back into notePanelOpen.
 * @returns {number} the token to hand notePanelClosed.
 */
export function notePanelOpen(kind, key, close) {
  closeOtherPanels(null);
  const token = ++seq;
  openPanels.set(token, { kind, key: key ?? null, close });
  return token;
}

/** This panel is gone. Safe to call twice, and safe to call for a stale token. */
export function notePanelClosed(token) {
  if (token != null) openPanels.delete(token);
}

/**
 * Close everything except `keep` (a token, or null for everything).
 *
 * The entry is REMOVED BEFORE its close callback runs: every one of those
 * callbacks ends up calling notePanelClosed, and a map being iterated while its
 * own handlers delete out of it is the kind of thing that works until the day
 * two panels are up at once.
 */
export function closeOtherPanels(keep = null) {
  const doomed = [...openPanels.entries()].filter(([t]) => t !== keep);
  for (const [t, p] of doomed) {
    openPanels.delete(t);
    try { p.close?.(); } catch { /* the scene is already gone */ }
  }
}

/** How many description panels are drawn right now. The invariant is 0 or 1. */
export function openPanelCount() { return openPanels.size; }

/** What is up, for the driver and for a failure message worth reading. */
export function openPanelList() {
  return [...openPanels.entries()].map(([token, p]) => ({ token, kind: p.kind, key: p.key }));
}

/**
 * Drop every registration without closing anything. Scene shutdown destroys the
 * display list wholesale, so the panels are already gone; what must not survive
 * is a close callback holding a dead scene.
 */
export function forgetPanels() { openPanels.clear(); }

try {
  window.__hfPanels = {
    count: openPanelCount,
    list: openPanelList,
    closeAll: () => closeOtherPanels(null),
  };
} catch { /* node, no window */ }
