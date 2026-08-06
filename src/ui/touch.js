/**
 * @file touch.js
 * THE TOUCH MODEL (JC, 2026-08-04, the mobile quest): "tap acts, hold reveals,
 * and the taps that matter get a second step."
 *
 * Desktop is untouched: every helper here collapses to the classic behaviour
 * when the MOBILE flag is off.
 *
 * THE THREE RULES:
 *   1. HOLD = HOVER. Press and hold (~400ms, finger still) on anything that
 *      answers a mouse hover — artifacts, potions, map nodes, shop items,
 *      enemies — and its tooltip appears, exactly as if a cursor were resting
 *      on it. Release KEEPS the tooltip; the next tap anywhere dismisses it.
 *      A hold never triggers the object's tap action.
 *   2. TAP = CLICK. `tapBind` binds an action to a clean tap: finger down and
 *      up within the slop radius, released before the hold fires. On desktop
 *      the same call binds plain pointerdown, so call sites stay one-liners.
 *   3. TWO STEPS WHERE A MISS COSTS A RUN. Consequential taps (drinking a
 *      potion) go through a confirm panel — see the call sites.
 */

import { MOBILE } from '../config.js';

const HOLD_MS = 400;      // finger-still time before a press becomes a hover
const SLOP = 14;          // px of drift allowed before a tap/hold is a drag

/**
 * Arm the scene-wide long-press watcher. Call once in create() (safe to call
 * on desktop: it does nothing). It owns three scene fields:
 *   _touchHoldObj   the object currently "hovered" by a hold (or null)
 *   _touchHoldFired this gesture became a hold — tapBind suppresses its tap
 */
export function installLongPress(scene) {
  if (!MOBILE || !scene?.input) return;
  let timer = null;
  let start = null;

  const clearHover = () => {
    const held = scene._touchHoldObj;
    scene._touchHoldObj = null;
    if (held?.active && held.emit) {
      try { held.emit('pointerout', scene.input.activePointer); } catch { /* gone */ }
    }
  };

  scene.input.on('pointerdown', (p) => {
    // A new touch dismisses whatever the last hold was reading.
    clearHover();
    scene._touchHoldFired = false;
    start = { x: p.x, y: p.y };
    if (timer) timer.remove();
    timer = scene.time.delayedCall(HOLD_MS, () => {
      if (!start) return;
      const cur = scene.input.activePointer;
      if (Math.hypot(cur.x - start.x, cur.y - start.y) > SLOP) return;
      // The topmost interactive object under the finger that knows how to be
      // hovered gets a synthetic hover. hitTestPointer respects depth order.
      const hits = scene.input.hitTestPointer(cur) ?? [];
      const target = hits.find(o => o.listenerCount?.('pointerover') > 0);
      if (!target) return;
      scene._touchHoldFired = true;
      scene._touchHoldObj = target;
      try { target.emit('pointerover', cur, target.input?.localX, target.input?.localY); } catch { /* gone */ }
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
    // The tooltip SURVIVES the release — reading should not require a held
    // finger over the very thing being read. The next pointerdown clears it.
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
  if (!MOBILE) { obj.on('pointerdown', fn); return obj; }
  let downAt = null;
  obj.on('pointerdown', (p) => { downAt = { x: p.x, y: p.y }; });
  obj.on('pointerup', (p, lx, ly, ev) => {
    const was = downAt; downAt = null;
    if (!was) return;
    if (scene._touchHoldFired) return;                       // it was a read
    if (Math.hypot(p.x - was.x, p.y - was.y) > SLOP) return; // it was a drag
    fn(p, lx, ly, ev);
  });
  return obj;
}
