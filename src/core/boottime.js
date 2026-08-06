/**
 * BOOT TIMING — a stopwatch with named laps, for the one part of this game
 * every player sits through and nobody can profile by feel.
 *
 * Cold boot fetches ~590 textures and can run the better part of a minute, so
 * "does it feel slower now?" is a question that can only be answered with
 * numbers. Every phase of the launch stamps a `performance.now()` here and the
 * whole record hangs off `window.__bootTiming`, which is where
 * tools/verify_boot_screen.py reads it from to hold Preboot to a budget.
 *
 * Costs one property write per phase and exists in the shipped build on
 * purpose: a timer you have to add back before you can measure is a timer you
 * do not have when a player says it got slow.
 */
export function bootMark(name, value) {
  if (typeof window === 'undefined') return;
  const t = window.__bootTiming || (window.__bootTiming = { t0: performance.now() });
  t[name] = value === undefined ? performance.now() : value;
}

/** Every lap so far, in ms since the first mark. For drivers and the console. */
export function bootTimings() {
  const t = (typeof window !== 'undefined' && window.__bootTiming) || null;
  if (!t) return null;
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    out[k] = typeof v === 'number' ? Math.round(v - t.t0) : v;
  }
  return out;
}
