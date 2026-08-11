/**
 * @file fmt.js
 * HOW A BIG NUMBER IS WRITTEN, IN ONE PLACE, WITH NO RENDERER ATTACHED.
 *
 * ===========================================================================
 * WHY THIS IS ITS OWN FILE (JC, 2026-08-11 — "ZEAL 4200000")
 * ===========================================================================
 * `fmtNum` was born in ui/juice.js because the first things that needed it were
 * floating damage numbers. Then the equation wanted it, then the recap, then
 * the lifetime shelf — and then core/passives.js wanted it, and could not have
 * it. passives.js is PHASER-FREE ON PURPOSE: it is the half of the passive-chip
 * job that is not drawing, and the node suite holds it against real scoring
 * results without booting a renderer. Importing ui/juice.js into it would drag
 * DEPTH, the settings store and the sound bus into every unit test.
 *
 * So the formatter moves DOWN to the layer that has no dependencies, and
 * ui/juice.js re-exports it. Every existing `import { fmtNum } from
 * '../ui/juice.js'` keeps working, unchanged, and nothing had to be hunted
 * down. This is the same move core/settings.js made for settingsPanelHeight,
 * for the same reason.
 *
 * THE BUG THAT PAID FOR IT: Zelus's passive chip printed `ZEAL 4200000 ×1.24`.
 * The chip clamps its label to its own ink lane, so a number that long did not
 * overflow — it SHRANK, to 0.44 scale, which is not a readout, it is a smudge.
 * The lane was doing its job; the number was the wrong shape. Formatting it at
 * the source lands the same chip at ~0.85 and legible.
 */

import { INFINITY_CAP } from './scoring.js';

/** The glyph a number at (or past) the cap is printed as, everywhere. */
export const INFINITY_GLYPH = '∞';

/**
 * Big numbers stay readable: 1234 -> 1.2k, 1,200,000 -> 1.2M, 1.5e9 -> 1.5B,
 * and past a trillion it gives up on suffixes and prints 1.23e14.
 *
 * WHY THE TOP TWO TIERS EXIST (2026-08-05). The ladder used to stop at M, so a
 * compounding build — the one the game actively rewards — printed "1000M" and
 * then "1000000M", which is not a number a human reads, it is a number a human
 * counts the zeroes of. B carries the decade the payoff tiers now top out on
 * (RADIANT is a billion), and scientific notation carries everything above it
 * with three significant figures instead of a wall.
 *
 * The `Number.isFinite` guard is first because a hoard build CAN overflow to
 * Infinity, and `Infinity.toFixed(1)` is the string "Infinity" — a readout that
 * reads as a crash. '∞' is the honest answer and it is also the fun one.
 */
export function fmtNum(n) {
  if (!Number.isFinite(n)) return INFINITY_GLYPH;
  // THE CAP READS AS ∞ (JC, 2026-08-10). scoring.js clamps every number it
  // produces at INFINITY_CAP, so anything arriving here at the ceiling is not
  // "1e30 damage" — it is the top of the game, and e30 and e100 are the same
  // hand by design. One line, so the equation, every float, the recap and the
  // lifetime shelf all say it without any of them knowing why.
  if (n >= INFINITY_CAP) return INFINITY_GLYPH;
  if (n >= 1e12) {
    let exp = Math.floor(Math.log10(n));
    let mant = Number((n / Math.pow(10, exp)).toFixed(2));
    // Rounding can push 9.999e13 up to "10.00" — carry it rather than print a
    // mantissa that is not in [1, 10).
    if (mant >= 10) { mant = Number((mant / 10).toFixed(2)); exp += 1; }
    return `${mant}e${exp}`;
  }
  // B mirrors M exactly: one decimal inside the first decade, none above it.
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return `${n}`;
}
