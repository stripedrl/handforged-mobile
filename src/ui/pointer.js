/**
 * @file pointer.js
 * THE RIGHT-CLICK POLICY (JC, 2026-08-10): "right-click must NEVER perform an
 * action anywhere in the game."
 *
 * Players were right-clicking things the way you right-click things in every
 * other game — expecting to be told what it is — and buying relics, drinking
 * potions, selecting cards and travelling to map nodes by accident. Phaser's
 * default is to route a right press through the ordinary pointer pipeline, so
 * all 200-odd `.on('pointerdown')` handlers in this codebase fired on it.
 *
 * WHY THIS IS ONE PATCH AND NOT 200 GUARDS. There is no shared button factory
 * here: six local ones and ~170 raw `.on('pointerdown')` call sites. A guard
 * per call site is a guard the next call site forgets. So the block lives at
 * the ONE seam every one of them passes through — Phaser's InputPlugin, whose
 * `processDownEvents` / `processUpEvents` are what emit
 *
 *   · the object's own `pointerdown` / `pointerup`
 *   · the plugin's `gameobjectdown` / `gameobjectup`   (card selection lives here)
 *   · the scene's `pointerdown` / `pointerup`
 *
 * Both are short-circuited for the right button and nothing downstream can
 * opt back in. DRAGGING needed no work: Phaser gates its whole drag machine on
 * `pointer.primaryDown`, which is the LEFT button by definition.
 *
 * THE PRESS AND THE RELEASE ARE BOTH BLOCKED, deliberately. This project's
 * standing trap is that `pointerup` fires on whatever happens to be under the
 * pointer at release, so blocking only the press would leave a right-click
 * falling through to a selection on the way back up.
 *
 * INFORMATION STILL GETS THROUGH. A blocked right press is re-emitted on the
 * scene's input plugin as `hfright` with the hit-test list Phaser had already
 * built for it, so `ui/inspect.js` and the other read-only surfaces can answer
 * a right-click without any of them being able to act on one.
 */

/**
 * ============================================================================
 * THE SECOND HALF: A GESTURE THAT TOUCHED UI NEVER REACHES THE WORLD BENEATH IT
 * ============================================================================
 * (JC, 2026-08-10: open the HANDS chart over the fan, click its CLOSE — and the
 * same click also selects the card that was under the button. "Should not be
 * the case ever.")
 *
 * THIS IS THE PROJECT'S OLDEST RECURRING TRAP, and it has now been fixed four
 * separate times at four separate call sites:
 *   · the end screen's PLAY AGAIN started CharacterSelect on pointerDOWN, and
 *     the same gesture's UP landed on a freshly dealt hero card
 *   · the skins shelf closed on the release of its own opening click
 *   · the Slot Button's USE tag disabled itself mid-gesture, so the release
 *     went to the relic icon underneath
 *   · and now the HANDS chart's CLOSE, over the fan
 *
 * All four are ONE bug. Phaser delivers `pointerup` to whatever happens to be
 * under the pointer AT RELEASE, with no memory of where the press began — so
 * any button that acts on pointerdown and then vanishes hands the rest of its
 * own gesture to whatever it was covering.
 *
 * THE FIX IS THE MISSING HALF OF "CLICK", and it is applied once, here: a
 * release is only delivered to objects that the PRESS was delivered to. That is
 * what a click has always meant everywhere else, it needs no cooperation from
 * any of the ~200 call sites, and it cannot be forgotten by the next overlay.
 * `input.topOnly` is Phaser's default (nothing in this codebase turns it off),
 * so the press set is at most one object: the thing the player actually aimed
 * at. Anything that was underneath it is, correctly, not part of this gesture.
 *
 * SCENE-LEVEL `pointerup` IS UNTOUCHED — the kinetic scrollers on the map, the
 * trophy shelf, the skins shelf and the run recap all close their drags on it,
 * and none of them is the bug. Only the per-OBJECT delivery is filtered, by
 * swapping the plugin's own hit list for the duration of the call.
 */

/** The scene-input event a suppressed right-press is re-emitted as. */
export const RIGHT_CLICK_EVENT = 'hfright';

/**
 * Was THIS pointer event caused by the right mouse button?
 *
 * `pointer.button` is written by Phaser out of the native event on both down
 * and up, and it is 0 for every touch, so one test covers the press, the
 * release and the finger. `buttons` is not usable here: it reads 0 on a
 * release, which would make every left-button release look like a right one.
 */
export function isRightPointer(p) {
  return !!p && p.button === 2;
}

let patched = false;

/**
 * Install the policy. Idempotent, and safe to call from every scene's create()
 * — the prototype patch happens once, the per-scene context-menu suppression
 * happens every time because scenes here are singletons that restart.
 */
export function installPointerPolicy(scene) {
  // The browser's own menu, gone: it steals the release Phaser needs to close
  // the gesture and it is not what the player was asking for anyway.
  scene?.input?.mouse?.disableContextMenu?.();

  if (patched) return;
  const P = globalThis.Phaser?.Input?.InputPlugin?.prototype;
  if (!P) return;
  patched = true;

  const origDown = P.processDownEvents;
  const origUp = P.processUpEvents;

  /**
   * The objects this pointer's PRESS was delivered to, per scene, per pointer.
   * `_temp` is the plugin's own hit-tested, depth-sorted, topOnly-truncated
   * list — the exact set Phaser is about to hand the press to — so recording it
   * needs no second hit test and cannot disagree with what actually happened.
   */
  const pressSets = (plugin) => (plugin._hfPressSets ??= new Map());

  if (typeof origDown === 'function') {
    P.processDownEvents = function (pointer) {
      pressSets(this).set(pointer.id,
        new Set(Array.isArray(this._temp) ? this._temp : []));
      if (isRightPointer(pointer)) {
        // `_temp` is the list Phaser has already hit-tested, camera-culled and
        // depth-sorted for this pointer this frame — the same list the press
        // would have been delivered to. hitTestPointer is the fallback for a
        // Phaser build that does not keep one.
        let hits = this._temp;
        if (!Array.isArray(hits)) {
          try { hits = this.hitTestPointer(pointer); } catch { hits = []; }
        }
        this.emit(RIGHT_CLICK_EVENT, pointer, hits ?? []);
        return 0;
      }
      return origDown.call(this, pointer);
    };
  }

  if (typeof origUp === 'function') {
    P.processUpEvents = function (pointer) {
      // The set is consumed either way: a release with no press behind it (the
      // gesture began outside the canvas) must stay permissive rather than
      // being filtered against some previous gesture's memory.
      const sets = pressSets(this);
      const pressed = sets.get(pointer.id);
      sets.delete(pointer.id);
      if (isRightPointer(pointer)) return 0;

      const temp = this._temp;
      if (!pressed || !Array.isArray(temp) || temp.length === 0) {
        return origUp.call(this, pointer);
      }
      const kept = temp.filter(o => pressed.has(o));
      if (kept.length === temp.length) return origUp.call(this, pointer);
      // Swap the hit list for the call and put it back afterwards:
      // processOverOutEvents runs off the SAME array later in this update, so
      // the plugin must be handed its own list back intact.
      this._temp = kept;
      try {
        return origUp.call(this, pointer);
      } finally {
        this._temp = temp;
      }
    };
  }
}

/**
 * Make `obj` eat a whole gesture: it becomes the topmost thing under the
 * pointer, so the press lands on IT and (by the rule above) the release cannot
 * reach whatever it is covering. For panels that are drawn over live content
 * but have nothing to click — the card inspect box, a read-only chart.
 */
export function swallowGestures(scene, container, x, y, w, h) {
  const eater = scene.add.rectangle(x, y, w, h, 0x000000, 0).setInteractive();
  container.add(eater);
  return eater;
}

/**
 * Bind `fn(pointer, hits)` to this scene's suppressed right-presses, and take
 * the binding down with the scene. `hits` is topmost-first.
 */
export function onRightClick(scene, fn) {
  const handler = (pointer, hits) => fn(pointer, hits ?? []);
  scene.input.on(RIGHT_CLICK_EVENT, handler);
  scene.events.once('shutdown', () => scene.input.off(RIGHT_CLICK_EVENT, handler));
  return handler;
}
