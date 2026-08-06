/**
 * @file cadence.js
 * THE CLOCK AND THE KEYBOARD OF A SCORING HAND — three pure functions the
 * combat cascade reads, kept out of the scene so they can be unit tested and so
 * a retune is a number in one file rather than a magic literal in nine.
 *
 * (PATCH 0803 §3, plus J1 and J2 of docs/RESEARCH_ADDICTIVENESS.txt.)
 *
 * 1. THE PITCH LADDER (pitchAt).  One counter, incremented by EVERY audible
 *    scoring event in the hand and never reset until the next hand begins.
 *    HANDFORGED used to run three separate ramps that each restarted from the
 *    bottom — the cards (0.85 + i×0.11), the relic pulses (1.05 + i×0.08) and a
 *    fixed slam — so a big hand sounded like "rise, restart, rise, thud". One
 *    ladder is most of why a big hand SOUNDS big; it is the single integer
 *    Balatro's evaluate_play carries through cards, retriggers, held-in-hand
 *    effects, jokers and editions alike.
 *
 * 2. THE REPEAT SCHEDULE (repeatSchedule).  A hand that happens 25 times must
 *    not cost 25 full cycles. JC: "the animations should start moving quicker
 *    and faster if it's going overboard... Speed things up exponentially after a
 *    reasonable waiting point." So the first REPEAT_FULL_BEATS activations play
 *    at full readable pace and every one after that is a constant fraction of
 *    the last, down to a floor that still reads as motion.
 *
 * 3. THE ACCELERATOR (scoringTimeScale).  On top of the schedule, the whole
 *    scoring sequence physically speeds up the longer it runs — Balatro's G.ACC,
 *    which nobody notices and which is exactly why a 40-trigger hand there does
 *    not feel like a 40-second hand. Both of these are the SAME mechanism (a
 *    long cascade compressing itself), so they live together and are tuned
 *    together.
 *
 * All three are pure: no Phaser, no scene, no settings. The HAND SPEED setting
 * rides on top of them in the scene (see CombatScene.spd), it does not replace
 * them.
 */

// ---------------------------------------------------------------------------
// 1. THE PITCH LADDER
// ---------------------------------------------------------------------------

/** Where the ladder starts — a shade under the sample's own pitch. */
export const PITCH_BASE = 0.82;
/** How far one scoring event climbs it. */
export const PITCH_STEP = 0.035;
/**
 * ...and where it stops. A hand with five relics and a retrigger can produce a
 * lot of events, and past about 1.6 the tick stops reading as a note and starts
 * reading as a chirp.
 */
export const PITCH_MAX = 1.6;
/**
 * The machine-gun guard. Under acceleration the gaps between events collapse
 * below the length of the sample itself; anything closer together than this is
 * dropped from the MIX while still advancing the ladder, so the climb keeps its
 * shape and the audio does not turn to mud. (Josh Ge's "complete cacophony"
 * warning about speed-linked SFX, quoted in the research doc.)
 */
export const PITCH_MIN_GAP_MS = 45;

/** The playback rate for the `step`-th audible event of a hand (0-based). */
export function pitchAt(step) {
  return Math.min(PITCH_MAX, PITCH_BASE + Math.max(0, step) * PITCH_STEP);
}

/** How many events it takes to reach the ceiling. Useful to tests and tuning. */
export function pitchCeilingStep() {
  return Math.ceil((PITCH_MAX - PITCH_BASE) / PITCH_STEP);
}

// ---------------------------------------------------------------------------
// 2. THE REPEAT SCHEDULE
// ---------------------------------------------------------------------------

/** Activations played at full, readable pace before the ramp starts. */
export const REPEAT_FULL_BEATS = 3;
/** Each beat after that is this fraction of the one before it. */
export const REPEAT_DECAY = 0.55;
/**
 * ...but never shorter than this fraction of a full cycle. Two things set it:
 * a beat has to survive being multiplied by the ACCELERATOR below (0.28 of a
 * 430ms cycle is 120ms, which is still ~40ms of real time at ACCEL_MAX) and
 * below about two frames a beat stops reading as motion and starts reading as
 * a dropped frame.
 */
export const REPEAT_FLOOR = 0.28;

/**
 * The length of each beat, as a fraction of one full cycle. Flat at 1 for the
 * first REPEAT_FULL_BEATS, then geometric, then flat at the floor.
 * @param {number} count how many beats to schedule
 * @returns {number[]} one scale per beat, monotonically non-increasing
 */
export function repeatBeatScales(count) {
  const out = [];
  for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
    out.push(i < REPEAT_FULL_BEATS
      ? 1
      : Math.max(REPEAT_FLOOR, Math.pow(REPEAT_DECAY, i - REPEAT_FULL_BEATS + 1)));
  }
  return out;
}

/**
 * THE HARD CEILING, in full-pace cycles. Past the readable head the curve is a
 * FLAT floor, so its cost is linear in the number of activations — a x25 sits
 * comfortably inside this, but a mirrored Pocketwatch on top of a mirrored
 * Sharpest Dagger is x100 and would run to half a minute. Anything over budget
 * has its TAIL uniformly compressed to fit; the readable head is never touched,
 * because the first few activations are the ones that teach what is happening.
 */
export const REPEAT_TAIL_BUDGET = 9;

/**
 * The same curve as a playable timetable, with the budget applied.
 * @param {number} count   beats to schedule
 * @param {number} cycleMs one full-pace beat, in ms (already HAND-SPEED scaled)
 * @returns {{scales:number[], effScales:number[], starts:number[],
 *            durations:number[], squeeze:number, totalMs:number}}
 *          `scales` is the pure curve, `effScales` the curve after the budget,
 *          and `starts[i]` is when beat i begins, measured from the first.
 */
export function repeatSchedule(count, cycleMs) {
  const scales = repeatBeatScales(count);
  const head = Math.min(REPEAT_FULL_BEATS, scales.length);
  let tail = 0;
  for (let i = head; i < scales.length; i++) tail += scales[i];
  const squeeze = tail > REPEAT_TAIL_BUDGET ? REPEAT_TAIL_BUDGET / tail : 1;
  const effScales = scales.map((s, i) => (i < head ? s : s * squeeze));
  const durations = effScales.map(s => s * cycleMs);
  const starts = [];
  let t = 0;
  for (const d of durations) { starts.push(t); t += d; }
  return { scales, effScales, squeeze, starts, durations, totalMs: t };
}

// ---------------------------------------------------------------------------
// 3. THE ACCELERATOR
// ---------------------------------------------------------------------------

/** A hand shorter than this never speeds up at all. The readable window. */
export const ACCEL_AFTER_MS = 3000;
/** Time scale gained per further second inside the scoring sequence. */
export const ACCEL_RATE_PER_SEC = 0.8;
/**
 * The ceiling. Balatro runs to about 14x, and it can: its per-event costs are
 * FIXED, so the accelerator is the only thing compressing them. HANDFORGED
 * already compresses the repetition exponentially before the accelerator sees
 * it, and stacking 14x on top of that would turn the tail of a x25 hand into
 * one dropped frame per activation. 3x is what is left to win.
 */
export const ACCEL_MAX = 3;

/**
 * How fast the scoring sequence should be running, `elapsedMs` of REAL time
 * after it began. 1 inside the readable window, then a straight climb to
 * ACCEL_MAX. Reset (back to 1) the moment the equation slams shut, so the
 * payoff and the blow that follows it always land at full weight.
 */
export function scoringTimeScale(elapsedMs) {
  if (!(elapsedMs > ACCEL_AFTER_MS)) return 1;
  return Math.min(ACCEL_MAX, 1 + ((elapsedMs - ACCEL_AFTER_MS) / 1000) * ACCEL_RATE_PER_SEC);
}
