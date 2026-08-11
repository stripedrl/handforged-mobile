/**
 * @file touch.js
 * THE TOUCH MODEL (JC, 2026-08-04, the mobile quest), REWRITTEN 2026-08-11.
 *
 * Desktop is untouched: every helper here collapses to the classic behaviour
 * when the TOUCH flag is off.
 *
 * ===========================================================================
 * THERE IS NO HOVER ON A FINGER (JC, 2026-08-11 — the double-description bug)
 * ===========================================================================
 * The 08-04 model's first rule was HOLD = HOVER: a long press synthesised a
 * `pointerover` on whatever was under the finger, so the phone could reach the
 * desktop tooltips. The 08-10 wave then gave the consequential surfaces a
 * TWO-TAP BOX (ui/choicebox.js) that prints the same words in a panel that
 * stands BESIDE the thumb instead of under it.
 *
 * Both shipped, and JC played the result: tapping a relic opened the box AND
 * the old tooltip, on top of each other, saying the same thing twice. Two
 * separate mechanisms were racing for one gesture —
 *
 *   · Phaser itself emits `pointerover` on a TOUCH pointerdown (a finger that
 *     lands on a thing is, as far as the engine is concerned, now hovering it),
 *   · and installLongPress emitted a SECOND one 400ms later.
 *
 * JC'S RULING: hover is REMOVED ENTIRELY on touch and replaced by tapping to
 * learn more. So:
 *
 *   1. NO HOVER-DRIVEN INFORMATION. `hoverInfo` is the one binder every
 *      tooltip in this game is wired through, and it binds NOTHING on touch.
 *      Pure VISUAL hover polish — a plate that puffs, a disc that spins — is
 *      left alone: it costs nothing, it is not a second description, and on a
 *      finger it simply reads as press feedback.
 *   2. TAP TO LEARN MORE. Every surface whose information was hover-ONLY now
 *      opens a persistent info panel on tap (`tapInfo`, ui/choicebox.js), and
 *      tapping away dismisses it. Exactly one description panel can be on
 *      screen at a time — enforced by the registry in ui/infoPanels.js, not by
 *      forty call sites remembering to close each other.
 *   3. THE LONG PRESS NO LONGER SYNTHESISES ANYTHING. It survives for exactly
 *      one thing: the CARD INSPECT gesture in ui/inspect.js, which owns its own
 *      hold timer and never went through `pointerover` in the first place.
 *
 * THE RULES THAT SURVIVE:
 *   · TAP = CLICK. `tapBind` binds an action to a clean tap: finger down and
 *     up within the slop radius, released before a drag begins. On desktop the
 *     same call binds plain pointerdown, so call sites stay one-liners.
 *   · TWO STEPS WHERE A MISS COSTS A RUN. Consequential taps go through the
 *     choice box — see ui/choicebox.js.
 */

import { MOBILE, TOUCH } from '../config.js';
import { isRightPointer } from './pointer.js';

/**
 * The gesture constants, exported since 2026-08-10: the CARD INSPECT panel is
 * the same gesture on both builds (hold, still, 400ms) and reading them from
 * here is what stops the desktop hold and the phone hold from drifting apart.
 * SLOP is also Phaser's `dragDistanceThreshold` in CombatScene — a hold that
 * tolerated more drift than a drag needs to start would eat drag-reorder.
 */
export const HOLD_MS = 400;      // finger-still time before a press becomes a hover
export const SLOP = 14;          // px of drift allowed before a tap/hold is a drag

/**
 * BIND A HOVER THAT SHOWS INFORMATION. Desktop only, by construction.
 *
 * ============================================================================
 * THIS FUNCTION'S ENTIRE JOB IS THE `if` ON ITS FIRST LINE
 * ============================================================================
 * Every parchment tooltip in this game — the intent tip, the relic tip, the
 * shield rule, the map's belt and shop tips, rewards' miniTip, the oracle and
 * passive chips, the hero kit panel, the wardrobe blurb — is now bound through
 * here rather than through a raw `.on('pointerover', ...)`. That is what makes
 * "hover is gone on touch" ONE decision instead of forty, and it is what makes
 * the next tooltip somebody adds correct by default: reaching for the binder
 * that every neighbouring line already uses is the path of least resistance.
 *
 * WHY A BINDER AND NOT A GUARD INSIDE EACH `show*Tip`. Two reasons, both paid
 * for: (1) several of those helpers are also called PROGRAMMATICALLY — the
 * `__hfCombat.intentTipText()` verification hook builds the tip, reads it and
 * tears it down; `__hfSkins.hover(id)` drives the wardrobe blurb — and a guard
 * inside the constructor would blind the drivers along with the finger; (2) the
 * gate belongs where the INPUT is decided, not where the paint is.
 *
 * WHAT DOES *NOT* COME THROUGH HERE: pure visual polish. A plate that puffs, a
 * card that lifts, a disc that spins, the cog that tilts. Those stay on plain
 * `.on('pointerover')`. They are not a second description of anything, and on
 * touch they read as press feedback, which is a small free gift.
 *
 * @param {Phaser.GameObjects.GameObject} obj
 * @param {function} onOver  build/show the panel
 * @param {function} [onOut] tear it down (hover-out; touch never needs one)
 */
export function hoverInfo(obj, onOver, onOut) {
  if (TOUCH) return obj;          // there is no hover on a finger. Tap to learn more.
  if (onOver) obj.on('pointerover', onOver);
  if (onOut) obj.on('pointerout', onOut);
  return obj;
}

/**
 * Arm the scene-wide long-press watcher. Call once in create() (safe to call
 * on desktop: it does nothing). It owns one scene field:
 *   _touchHoldFired this gesture became a hold — tapBind suppresses its tap
 *
 * ============================================================================
 * WHAT THIS USED TO DO, AND WHY IT STOPPED (JC, 2026-08-11)
 * ============================================================================
 * It used to hit-test the finger at 400ms, find the topmost object with a
 * `pointerover` listener, and EMIT ONE AT IT — the phone's way of reaching the
 * desktop tooltips. That is half of the double-description bug: the tap had
 * already opened the two-tap box, Phaser had already emitted its own touch
 * `pointerover`, and this fired a third event into the same gesture. After the
 * hover removal there is nothing left for a synthetic hover to wake, so it does
 * not fire one. A long press must never produce a SECOND rendering of anything.
 *
 * WHAT SURVIVES IS THE FLAG, and it is still load-bearing: `_touchHoldFired`
 * is how `tapBind` knows a gesture was a READ (ui/inspect.js's card panel, which
 * runs its own identical hold timer off `gameobjectdown`) rather than a TAP, so
 * holding a card to inspect it never also plays it. Keeping the watcher here —
 * rather than folding it into inspect.js — keeps ONE definition of how long a
 * hold is and how far it may drift, which is the whole reason HOLD_MS and SLOP
 * are exported from this file.
 */
export function installLongPress(scene) {
  if (!MOBILE || !scene?.input) return;
  let timer = null;
  let start = null;

  scene.input.on('pointerdown', (p) => {
    scene._touchHoldFired = false;
    start = { x: p.x, y: p.y };
    if (timer) timer.remove();
    timer = scene.time.delayedCall(HOLD_MS, () => {
      if (!start) return;
      const cur = scene.input.activePointer;
      if (Math.hypot(cur.x - start.x, cur.y - start.y) > SLOP) return;
      // The gesture is a READ, not a tap. Nothing is emitted at anything: the
      // only surface that answers a hold is the card inspect panel, and it
      // arms its own timer on the same constants.
      scene._touchHoldFired = true;
    });
  });
  scene.input.on('pointermove', (p) => {
    if (start && Math.hypot(p.x - start.x, p.y - start.y) > SLOP) {
      if (timer) { timer.remove(); timer = null; }
    }
  });
  scene.input.on('pointerup', () => {
    if (timer) { timer.remove(); timer = null; }
    start = null;
  });
  scene.events.once('shutdown', () => { if (timer) timer.remove(); });
}

/**
 * Bind `fn` as the object's TAP action. Desktop: plain pointerdown, exactly
 * as before. Mobile: fires on pointerup only when the gesture stayed inside
 * the slop radius and never became a hold — so a hold reads, a tap acts, and
 * a drag does neither.
 */
export function tapBind(scene, obj, fn) {
  // The right-button guards below are belt-and-braces: ui/pointer.js already
  // stops a right press ever reaching a handler. They stay because tapBind is
  // the one binder every future call site is meant to reach for, and a binder
  // that says out loud "this never acts on a right-click" is cheaper than
  // trusting that the patch is still installed.
  if (!MOBILE) {
    obj.on('pointerdown', (p, ...rest) => { if (!isRightPointer(p)) fn(p, ...rest); });
    return obj;
  }
  let downAt = null;
  obj.on('pointerdown', (p) => { downAt = isRightPointer(p) ? null : { x: p.x, y: p.y }; });
  obj.on('pointerup', (p, lx, ly, ev) => {
    const was = downAt; downAt = null;
    if (!was || isRightPointer(p)) return;
    if (scene._touchHoldFired) return;                       // it was a read
    if (Math.hypot(p.x - was.x, p.y - was.y) > SLOP) return; // it was a drag
    fn(p, lx, ly, ev);
  });
  return obj;
}
