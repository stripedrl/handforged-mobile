/**
 * SWEEP TO SELECT — the pure half of the drag-select gesture (PATCH 0803 §4).
 *
 * The hand already spends drag on REORDERING, so the same press-and-move has to
 * mean two things. Everything here is the geometry of telling them apart and of
 * working out which cards a sweep actually crosses; nothing in this file knows
 * about Phaser, sprites, sound or selection rules. CombatScene owns those and
 * calls in here for the maths, which is what makes the interesting half of the
 * feature testable in node instead of only in a browser.
 *
 * THE RULING (docs/PATCH_0803.txt §4):
 *   a drag that LIFTS A CARD UP out of the fan  -> reorder, exactly as before
 *   a drag that SWEEPS SIDEWAYS along the fan   -> select every card it crosses
 */

// ---------------------------------------------------------------------------
// THE TWO NUMBERS THAT ARE THE WHOLE FEATURE
// ---------------------------------------------------------------------------
// Not an angle test. An angle taken off the 14px Phaser needs to call a drag a
// drag is noise: a mouse that has moved fourteen pixels has barely stated an
// opinion, and judging the gesture there means a reorder that starts with a
// slight sideways bias gets read as a sweep and takes a card the player never
// asked for. So the two gestures RACE instead, each against its own distance,
// and the first one over its own line wins.
//
// LIFT_COMMIT_PX — 20px of UP.  A card lifted out of the fan is the incumbent
//   gesture and it is unambiguous: nothing else in the hand travels upward, so
//   it can afford the cheaper line. 20px is under a third of the 56px a card
//   rises when it is selected, so the reorder starts following the pointer well
//   before the lift would have looked deliberate.
//
// SWEEP_COMMIT_PX — 26px of SIDEWAYS (or of downward, which is not a reorder
//   either).  This is the one that has to clear two hazards at once. Too small
//   and the wobble in a sloppy click starts a sweep; too large and a short
//   stroke between two neighbouring cards does nothing at all. 26px is about a
//   quarter of the 96px between card centres, so the card you pressed lights up
//   while the pointer is still over it and the next one is still 70px of very
//   deliberate travel away.
//
// The ASYMMETRY is the point. 26 > 20 tilts every close call toward REORDER,
// which is the behaviour that existed before this setting and the one the
// player's hands already know. In angle terms the reorder cone comes out at
// ~52 degrees either side of straight up (atan(26/20)), so a diagonal flick up
// and out of the fan is read as a lift, and only a stroke that is genuinely
// more sideways than upward sweeps.
export const LIFT_COMMIT_PX = 20;
export const SWEEP_COMMIT_PX = 26;

/**
 * Which gesture a press-and-move has committed to, from the vector between
 * where the pointer went down and where it is now — or 'pending' if it has not
 * said enough yet to be sure.
 *
 * DOWN counts toward the sweep. Dragging a card downward has never reordered
 * anything (the reorder drag clamps y to fanY+30), so there is no gesture down
 * there to protect, and a straight-down stroke that could commit to neither
 * would hang in 'pending' forever.
 *
 * CALL THIS UNTIL IT ANSWERS, THEN STOP. The verdict is taken once and held for
 * the rest of the gesture: a drag that changed its mind halfway would toggle
 * cards the player had already decided they were only sliding past.
 */
export function gestureKind(dx, dy, { lift = LIFT_COMMIT_PX, sweep = SWEEP_COMMIT_PX } = {}) {
  const up = -dy;
  const side = Math.max(Math.abs(dx), dy);   // sideways, or downward: both sweep
  const upReady = up >= lift;
  const sideReady = side >= sweep;
  if (!upReady && !sideReady) return 'pending';
  if (!sideReady) return 'reorder';
  if (!upReady) return 'sweep';
  // Both lines crossed inside one pointer move (a fast diagonal flick): whoever
  // is proportionally further past their own line takes it, ties to reorder.
  return (up / lift >= side / sweep) ? 'reorder' : 'sweep';
}

/**
 * The fan's geometry, lifted straight out of CombatScene.layoutHand so a test
 * can rebuild the exact hand the player is looking at. Defaults mirror CARD in
 * config.js; layoutHand passes its own so the two can never drift.
 *
 * Returns { startX, spread, slots[] } where a slot is the RESTING place of a
 * card — deliberately not its live position, because a selected card is lifted
 * 56px and a card that has been lifted out of the row is still, to the sweep,
 * sitting in its slot. You sweep the ROW, not the sprites.
 */
export function fanSlots(n, {
  spread = 96, maxWidth = 740, centerX = 1130, fanY = 938, arcK = 2.2, tilt = 2.4,
} = {}) {
  const step = Math.min(spread, maxWidth / Math.max(n - 1, 1));
  const startX = centerX - ((n - 1) / 2) * step;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const arc = Math.abs(i - (n - 1) / 2);
    slots.push({
      x: startX + i * step,
      y: fanY + arc * arc * arcK,
      angle: (i - (n - 1) / 2) * tilt,
    });
  }
  return { startX, spread: step, slots };
}

/**
 * The card under a point, as an index into `boxes`, or -1.
 *
 * `boxes` is in FAN ORDER, left to right — which is also stacking order,
 * because restackHand() puts the rightmost card on top. So the search runs
 * BACKWARDS and the first hit wins, and that reproduces exactly what the player
 * sees: cards are 140 wide on a 96 spread, so all you can see of card i is its
 * left 96px, and that strip is the only place clicking card i works. The sweep
 * agrees with the eye and with Phaser's own topmost-first hit test for free.
 */
export function cardAtPoint(boxes, x, y, { w = 140, h = 210 } = {}) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (Math.abs(x - b.x) <= (b.w ?? w) / 2 && Math.abs(y - b.y) <= (b.h ?? h) / 2) return i;
  }
  return -1;
}

/** How finely a pointer move is walked. Well under a card's 96px visible strip. */
export const SWEEP_SAMPLE_PX = 10;

/**
 * THE SEAM. A dead band this wide sits either side of every join between two
 * cards, and a crossing is only counted once the pointer is properly inside the
 * next card rather than teetering on the line.
 *
 * This is the price of taking the ruling literally. Sweeping over a selected
 * card DESELECTS it, which is what makes a sweep back undo a sweep forward and
 * is genuinely the nicest thing about the gesture — you overshoot by one and
 * pull back without letting go. But it also means a pointer parked on a card
 * boundary and shaking would toggle that card several times a second and land
 * somewhere unpredictable, and a player whose hand is not perfectly steady must
 * not get a different hand than a player whose hand is.
 *
 * (Balatro's Handy mod solves the same problem the other way: it locks the
 * whole stroke to select-only or deselect-only depending on the first card it
 * touches, so a jittery sweep is idempotent by construction. That is a smaller
 * idea and a good one, but it costs the pull-back-to-fix affordance, which this
 * hand wants more. 10px is ~20% of the 96px between cards: far beyond any
 * tremor, far short of anything a deliberate stroke would notice.)
 */
export const SEAM_DEAD_PX = 10;

/** Floor on the gap between two sweep ticks. A fast sweep runs, it never rattles. */
export const SWEEP_TICK_MS = 55;

/**
 * Which cards a sweep path CROSSES, in the order it crosses them.
 *
 * `points` is a polyline in fan space and its FIRST point is where the pointer
 * already was, so it is never itself a hit — `from` and `cameFrom` carry the
 * gesture's state across calls, because one stroke arrives as dozens of
 * separate pointer moves and the run of it has to survive the seams between
 * them. The segments are sampled rather than solved because a pointer
 * travelling fast can jump a whole card between two moves, and a skipped card
 * in the middle of a sweep is the one bug a player would notice immediately.
 *
 * THE TURNAROUND (2026-08-03). A card is crossed when the pointer ENTERS it —
 * and ALSO when the pointer leaves it BACK THE WAY IT CAME. That second clause
 * is the fix for the bug JC reported as "it misses cards when I drag fast":
 *
 *   sweep 0->4 and the stroke enters five cards, so five light up.
 *   sweep 4->0 without letting go and it only ever ENTERS 3,2,1,0 — the pointer
 *   was already sitting inside card 4, so card 4 was never re-counted and it
 *   stayed lit. Exactly one card, always the one you turned around on.
 *
 * You overshoot and pull back far more often when you are moving fast, which is
 * why it read as a speed bug; it reproduces at any speed (tools/probe: a
 * 2-sample flick and a 20-sample crawl both left the far card lit). Counting
 * the turnaround makes "a sweep back undoes a sweep forward" literally true for
 * every card including the last, which is what the gesture always promised.
 *
 * `cameFrom` is the card we entered the current one FROM. Leaving to that same
 * card is the reversal; leaving to any other card is just carrying on.
 */
export function sweepHits(boxes, points, {
  from = -1, cameFrom = -1, step = SWEEP_SAMPLE_PX, w, h, seam = SEAM_DEAD_PX,
} = {}) {
  const hits = [];
  let last = from;
  let prev = cameFrom;
  const dims = { w: w ?? 140, h: h ?? 210 };
  const visit = (x, y) => {
    const i = cardAtPoint(boxes, x, y, dims);
    // Off the fan entirely — the memory clears, so sweeping out and back onto
    // the same card is a deliberate second crossing and counts as one.
    if (i < 0) { last = -1; prev = -1; return; }
    if (i === last) return;
    // On the seam between two cards: neither in nor out. Hold the previous card
    // and wait for the pointer to mean it. Probing `seam` to either side is the
    // whole test — you are inside a card when a step either way is still it.
    if (cardAtPoint(boxes, x - seam, y, dims) !== i
      || cardAtPoint(boxes, x + seam, y, dims) !== i) return;
    // Turning back: the card being left is uncrossed before the next is taken.
    if (i === prev && last >= 0) hits.push(last);
    hits.push(i);
    prev = last;
    last = i;
  };
  for (let p = 1; p < points.length; p++) {
    const a = points[p - 1], b = points[p];
    const dx = b.x - a.x, dy = b.y - a.y;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let s = 1; s <= n; s++) visit(a.x + dx * (s / n), a.y + dy * (s / n));
  }
  return { hits, last, cameFrom: prev };
}
