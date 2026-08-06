/**
 * @file kinetic.js
 * KINETIC SCROLLING (JC, 2026-08-04): "drag and scroll features need a bit of
 * 'float'... go past a little where you scroll, or if you scroll super hard it
 * should accelerate the momentum to the end."
 *
 * He is describing the standard touch-scroll physics (iOS popularised it):
 *   1. MOMENTUM   a released drag keeps its velocity and glides to rest on an
 *                 exponential decay, so a flick travels and a hard flick
 *                 travels to the end.
 *   2. RUBBER-BAND the position may pass the edges a little; while dragged
 *                 past them it moves with heavy resistance, and on release it
 *                 springs back to the boundary.
 *   3. WHEEL GLIDE a wheel notch nudges the position AND feeds the momentum,
 *                 so spinning the wheel hard accelerates instead of stepping.
 *
 * One instance per scrollable surface. The surface keeps owning its input
 * wiring (each shelf's dimmer, guards and drag-vs-click rules are its own) and
 * forwards four events — grab / move / release / wheel — plus an `apply(pos)`
 * that positions its content. Position runs 0..max, and `apply` must tolerate
 * values a little OUTSIDE that range: the overshoot IS the feature.
 *
 * The physics run on the scene's update loop and detach themselves on scene
 * shutdown, so a surface that dies mid-glide cannot leak a ticking listener
 * (every scene here is a restart-heavy singleton — the lesson is paid for).
 */

/** Tuning, shared by every surface so the whole game floats the same way. */
const DECAY = 0.94;        // velocity kept per 60fps frame while gliding
const MIN_VEL = 0.04;      // px/frame below which a glide is at rest
const MAX_VEL = 110;       // px/frame cap: a flick can be fast, not teleporting
const OVERSHOOT = 110;     // how far past an edge the rubber band stretches
const DRAG_RESIST = 0.42;  // how much of a drag survives past an edge
const SPRING = 0.16;       // pull-back strength per frame when out of bounds
const OUT_DECAY = 0.62;    // extra velocity damping while out of bounds
const SAMPLE_MS = 90;      // how much recent drag history feeds the fling
const WHEEL_NUDGE = 0.55;  // immediate px per wheel-dy unit
const WHEEL_VEL = 0.115;   // momentum px/frame per wheel-dy unit

export function kineticScroll(scene, { max, apply, start = 0 } = {}) {
  const maxOf = () => Math.max(0, typeof max === 'function' ? max() : (max ?? 0));
  const state = {
    pos: start, vel: 0, dragging: false, glideTo: null,
    dragBase: 0, dragFrom: 0, samples: [],
  };
  const push = (pos) => { state.pos = pos; apply(pos); };

  const update = (_t, dtRaw) => {
    const dt = Math.min(50, dtRaw ?? 16.7) / 16.7;   // in 60fps frames
    if (state.dragging) return;
    const hi = maxOf();

    // A programmatic glide (chevrons, "scroll to" hooks) eases in, and any
    // real input cancels it (grab/wheel null it out).
    if (state.glideTo != null) {
      const t = Phaser.Math.Clamp(state.glideTo, 0, hi);
      const next = state.pos + (t - state.pos) * Math.min(1, 0.18 * dt);
      if (Math.abs(t - next) < 0.5) { state.glideTo = null; push(t); } else push(next);
      return;
    }

    const below = state.pos < 0, above = state.pos > hi;
    if (below || above) {
      // THE SPRING: ease back to the boundary, bleeding velocity hard.
      const bound = below ? 0 : hi;
      state.vel *= Math.pow(OUT_DECAY, dt);
      let next = state.pos + state.vel * dt + (bound - state.pos) * Math.min(1, SPRING * dt);
      if (Math.abs(bound - next) < 0.6 && Math.abs(state.vel) < 1) { state.vel = 0; next = bound; }
      push(next);
      return;
    }
    if (Math.abs(state.vel) <= MIN_VEL) { state.vel = 0; return; }

    // THE GLIDE: coast and decay; crossing an edge hands over to the spring
    // above with whatever (heavily clipped) velocity is left.
    let next = state.pos + state.vel * dt;
    state.vel *= Math.pow(DECAY, dt);
    if (next < -OVERSHOOT) { next = -OVERSHOOT; state.vel = 0; }
    if (next > hi + OVERSHOOT) { next = hi + OVERSHOOT; state.vel = 0; }
    push(next);
  };
  scene.events.on('update', update);
  const destroy = () => scene.events.off('update', update);
  scene.events.once('shutdown', destroy);

  const k = {
    /** Where the surface is (may be mid-overshoot). */
    get: () => state.pos,
    /** Jump straight there, clamped. The programmatic setter for hooks. */
    set: (v) => { state.vel = 0; state.glideTo = null; push(Phaser.Math.Clamp(v, 0, maxOf())); return state.pos; },
    /** Ease there (chevrons and their kin). */
    glide: (v) => { state.vel = 0; state.glideTo = v; },
    /** Forward a wheel event's dy. */
    wheel: (dy) => {
      state.glideTo = null;
      state.vel = Phaser.Math.Clamp(state.vel + dy * WHEEL_VEL, -MAX_VEL, MAX_VEL);
      const hi = maxOf();
      // The immediate nudge stays inside the band so a single notch at an edge
      // does not read as a bounce.
      push(Phaser.Math.Clamp(state.pos + dy * WHEEL_NUDGE, Math.min(state.pos, 0), Math.max(state.pos, hi)));
    },
    /** Pointer down on the surface: `at` is the pointer's axis coordinate. */
    grab: (at) => {
      state.dragging = true;
      state.vel = 0;
      state.glideTo = null;
      state.dragBase = state.pos;
      state.dragFrom = at;
      state.samples = [{ t: performance.now(), pos: state.pos }];
    },
    /** Pointer moved while held. Sign: dragging content DOWN scrolls UP. */
    move: (at) => {
      if (!state.dragging) return;
      const hi = maxOf();
      let want = state.dragBase - (at - state.dragFrom);
      // Past an edge the hand meets resistance, capped at the band's reach.
      if (want < 0) want = Math.max(-OVERSHOOT, want * DRAG_RESIST);
      else if (want > hi) want = Math.min(hi + OVERSHOOT, hi + (want - hi) * DRAG_RESIST);
      push(want);
      const now = performance.now();
      state.samples.push({ t: now, pos: want });
      while (state.samples.length > 2 && now - state.samples[0].t > SAMPLE_MS) state.samples.shift();
    },
    /** Pointer released: the recent drag history becomes the fling. */
    release: () => {
      if (!state.dragging) return;
      state.dragging = false;
      const s = state.samples, a = s[0], b = s[s.length - 1];
      const ms = b && a ? b.t - a.t : 0;
      if (ms > 15) {
        state.vel = Phaser.Math.Clamp(((b.pos - a.pos) / ms) * 16.7, -MAX_VEL, MAX_VEL);
      }
      state.samples = [];
    },
    isDragging: () => state.dragging,
    destroy,
  };
  return k;
}
