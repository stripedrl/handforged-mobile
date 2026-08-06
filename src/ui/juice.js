import { DEPTH } from '../config.js';
import { settings } from '../core/settings.js';
import { sfx } from '../core/sfx.js';

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
  if (!Number.isFinite(n)) return '∞';
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

/**
 * How long a plain floating NUMBER sits at full size before it leaves. Damage
 * numbers, heal ticks, chip drops — the fast lane.
 */
export const POP_HOLD = 260;
/**
 * How long an informational MESSAGE sits — anything with words in it. Exactly
 * double POP_HOLD after the 2026-08-01 legibility pass (JC: "that treatment to
 * those kinds of messages is key"). Pass it as `hold` at the call site; the
 * default stays short so a hit number never lingers over the board.
 */
export const MSG_HOLD = POP_HOLD * 2;

// ---------------------------------------------------------------------------
// LEGIBILITY — one treatment, one call site
//
// JC, 2026-08-02: "some yellow text like the achievement notification one lacks
// a black border around it making it hard to read... make sure it's all readable
// for sure."
//
// The game already knew the answer and said it in thirty places: a warm-dark
// outline plus a soft drop shadow, which is what lets `#ffd23e` sit on sunlit
// forest, on an additive glow, and on cream parchment all at once. What it did
// NOT have was one place to say it, so every new label was a fresh coin flip.
// `legible()` is that place. Wrap any LIGHT-inked text in it:
//
//     legible(scene.add.text(x, y, 'CLAIM', { ...style, color: GOLD }));
//
// Dark ink on a light parchment panel (PARCH.text / PARCH.textDim) is already
// the high-contrast pair and must NOT be wrapped: an outline there only smears
// the letterforms.
// ---------------------------------------------------------------------------

/** The house outline: the warm near-black 38 of the 71 existing strokes use. */
export const INK_DARK = '#241505';

/**
 * Perceived brightness of a '#rrggbb' (or 0xrrggbb) colour, 0..1. The one number
 * that lets a call site ask "is this ink pale?" instead of guessing, and the same
 * question the difficulty plates already answer to pick their own ink.
 */
export function brightness(color) {
  const n = typeof color === 'number' ? color : parseInt(String(color).replace('#', ''), 16);
  if (!Number.isFinite(n)) return 1;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/**
 * Stroke and shadow SIZED OFF THE FONT, so a 17px shelf label and an 86px purse
 * total each get the weight the hand-tuned call sites already chose (4px under
 * ~22px, 6px in the 20s and 30s, capped at 10 so headlines stay letters rather
 * than blobs).
 *
 * `stroke` takes a cool dark where the text is cool (the existing `#16293f` /
 * `#0f2a3d` variants), and `shadow:false` drops the shadow for text that sits on
 * a flat plate and only needs the outline.
 */
export function legible(t, { stroke = INK_DARK, thickness = null, shadow = true } = {}) {
  const size = parseInt(t.style?.fontSize, 10) || 24;
  t.setStroke(stroke, thickness ?? Math.max(4, Math.min(10, Math.round(size / 5))));
  if (shadow) {
    t.setShadow(0, Math.max(3, Math.round(size / 7)), '#000000',
      Math.max(6, Math.round(size / 4.6)), true, true);
  }
  return t;
}

/** Floating combat/score number. */
export function popNumber(scene, x, y, text, { color = '#ffffff', size = 44, rise = 70, delay = 0, hold = POP_HOLD } = {}) {
  // Every float in the game comes through here, and every one of them lands on
  // raw, full-brightness biome art or on the cream sidebar. The flat 6px stroke
  // this used to carry was right at 30px and far too thin at 74; `legible` sizes
  // it and adds the shadow, which is what separates a pale pop from a pale
  // background when the outline alone is not enough.
  const t = legible(scene.add.text(x, y, text, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`, color,
  })).setOrigin(0.5).setDepth(DEPTH.fx).setAlpha(0).setScale(0.6);
  scene.tweens.add({
    targets: t, alpha: 1, scale: 1.15, y: y - rise * 0.4,
    duration: 130, delay, ease: 'Back.easeOut',
    onComplete: () => scene.tweens.add({
      targets: t, alpha: 0, y: y - rise, scale: 0.95,
      duration: 480, delay: hold, ease: 'Sine.easeIn',
      onComplete: () => t.destroy(),
    }),
  });
  return t;
}

/**
 * A floating MESSAGE — anything with words in it. Identical to popNumber except
 * that it hangs for MSG_HOLD instead of POP_HOLD.
 *
 * Two helpers rather than one sniffing the text on purpose: "+25 HP", "+200
 * chips" and "⚔ ×3" all contain letters and are all NUMBERS that must stay in
 * the fast lane. The call site knows which it means; the text does not.
 */
export function popMessage(scene, x, y, text, opts = {}) {
  return popNumber(scene, x, y, text, { hold: MSG_HOLD, ...opts });
}

/** Quick camera shake scaled to damage. */
export function shake(scene, intensity = 0.004, duration = 120) {
  if (!settings.shake) return;
  scene.cameras.main.shake(duration, intensity);
}

/** Radial star/dust burst at a point, tinted. */
export function burst(scene, x, y, tint = 0xffc542, count = 10) {
  for (let i = 0; i < count; i++) {
    const key = i % 3 === 0 ? 'fx_star' : 'fx_dust';
    const p = scene.add.image(x, y, key).setTint(tint).setDepth(DEPTH.fx)
      .setScale(Phaser.Math.FloatBetween(0.18, 0.4)).setBlendMode(Phaser.BlendModes.ADD);
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Phaser.Math.Between(50, 150);
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist,
      alpha: 0, scale: 0.05, angle: Phaser.Math.Between(-180, 180),
      duration: Phaser.Math.Between(320, 620), ease: 'Cubic.easeOut',
      onComplete: () => p.destroy(),
    });
  }
}

/**
 * Immersive debuff feedback: the screen edges flush with the debuff's color,
 * then fade. Subtle by design — border-only, never blocks reading the board.
 */
export function flashVignette(scene, color, strength = 0.5) {
  const { width: W, height: H } = scene.scale.gameSize;
  const bars = [
    scene.add.image(W / 2, -40, 'fx_glow').setDisplaySize(W * 1.4, 260),
    scene.add.image(W / 2, H + 40, 'fx_glow').setDisplaySize(W * 1.4, 260),
    scene.add.image(-40, H / 2, 'fx_glow').setDisplaySize(280, H * 1.4),
    scene.add.image(W + 40, H / 2, 'fx_glow').setDisplaySize(280, H * 1.4),
  ];
  for (const b of bars) {
    b.setTint(color).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.overlay + 2).setScrollFactor(0);
    scene.tweens.add({
      targets: b, alpha: strength, duration: 180, yoyo: true, hold: 260,
      ease: 'Sine.easeOut', onComplete: () => b.destroy(),
    });
  }
}

export const DEBUFF_COLORS = {
  bleed: 0xd82838,
  freeze: 0x8ad4ff,
  brittle: 0xd0a040,
  poison: 0x40c050,
  fear: 0x8040c0,
  hypnotize: 0xff70c0,
  suitban: 0x9060ff,
  // --- the 2026-08-02 mechanics wave ---
  rooted: 0x4f9a34,     // vines
  courtLock: 0x8a4cd8,  // a cracked crown
  suitSeal: 0xb080ff,   // the Keeper's wax, on a clock
  spikes: 0x5cc8ff,     // ice thorns
  // --- the 2026-08-03 biome wave. One colour per act, and they are the acts'
  //     own palettes: moonlight, pale nothing, and coals.
  blind: 0x8fa0e8,      // Nocturnal Forest — cold moonlight
  fade: 0xcfd8ee,       // Ethereal Plains — pale, weightless, almost white
  burned: 0xff6a20,     // Burning Gallows — live coal
};

/** Flash a sprite white briefly (hit feedback). */
export function hitFlash(scene, target) {
  target.setTintFill(0xffffff);
  scene.time.delayedCall(90, () => target.clearTint());
}

/**
 * Pop the big pack action-text art (COMBO!/CRITICAL!) at a point.
 * Default hold DOUBLED 520 -> 1040 in the 2026-08-01 legibility pass.
 */
export function actionText(scene, x, y, key, scale = 0.7, hold = 1040) {
  const img = scene.add.image(x, y, key).setDepth(DEPTH.fx).setScale(0.2).setAlpha(0);
  scene.tweens.add({
    targets: img, alpha: 1, scale, duration: 160, ease: 'Back.easeOut',
    onComplete: () => scene.tweens.add({
      targets: img, alpha: 0, y: y - 40, duration: 420, delay: hold,
      onComplete: () => img.destroy(),
    }),
  });
}

/** Animated counter text: ticks value from -> to with punch. */
export function tickCounter(scene, textObj, from, to, duration = 420, prefix = '') {
  const proxy = { v: from };
  scene.tweens.add({
    targets: proxy, v: to, duration, ease: 'Cubic.easeOut',
    onUpdate: () => textObj.setText(prefix + Math.round(proxy.v)),
  });
  scene.tweens.add({ targets: textObj, scale: 1.25, duration: 90, yoyo: true });
}

// ---------------------------------------------------------------------------
// PAYOFF TIERS — the TOTAL at the end of the score equation escalates in color,
// size and spectacle with its own magnitude. Thresholds are JC's spec; each
// tier owns one sfx key (`payoff_<threshold>`), which stays a silent no-op
// until the artist's file lands in assets/audio/sfx.
// ---------------------------------------------------------------------------

/**
 * Ordered low -> high. `size` is the total's font size at that tier — it steps
 * up with magnitude but tops out at 112px, which keeps even a six-digit total
 * inside the band between the enemy nameplates and the played row. (RADIANT is
 * the one tier above 106, and by then fmtNum has compressed the total to four
 * or five glyphs — "1.4B" — so the wider face still fits the same band.)
 */
export const PAYOFF_TIERS = [
  { min: 0,      name: 'cream',    color: '#f6e8c8', tint: 0xf6e8c8, size: 56,  stroke: '#2a1808' },
  { min: 300,    name: 'green',    color: '#4fd45e', tint: 0x4fd45e, size: 62,  stroke: '#0d2a12', sfx: 'payoff_300' },
  { min: 500,    name: 'lime',     color: '#b8e33c', tint: 0xb8e33c, size: 68,  stroke: '#22300a', sfx: 'payoff_500' },
  { min: 750,    name: 'yellow',   color: '#ffd23e', tint: 0xffd23e, size: 74,  stroke: '#3a2604', sfx: 'payoff_750' },
  { min: 1000,   name: 'orange',   color: '#ff8c28', tint: 0xff8c28, size: 80,  stroke: '#3a1a02', sfx: 'payoff_1000' },
  { min: 1500,   name: 'red',      color: '#ff3b30', tint: 0xff3b30, size: 86,  stroke: '#3a0605', sfx: 'payoff_1500' },
  { min: 2500,   name: 'darkred',  color: '#b3121f', tint: 0xb3121f, size: 90,  stroke: '#f0b0a0', sfx: 'payoff_2500' },
  { min: 5000,   name: 'purple',   color: '#8a24c0', tint: 0x9a3ce0, size: 94,  stroke: '#e6c8ff', sfx: 'payoff_5000' },
  { min: 12500,  name: 'rainbow',  color: '#ff4d4d', tint: 0xffffff, size: 98,  stroke: '#1a0d04', sfx: 'payoff_12500', rainbow: true },
  { min: 50000,  name: 'fire',     color: '#ffcf4a', tint: 0xff7a18, size: 102, stroke: '#3a1000', sfx: 'payoff_50000', fire: true, flicker: ['#ffd66a', '#ff8a1e'] },
  { min: 100000, name: 'blackout', color: '#f0d8ff', tint: 0xb45cff, size: 106, stroke: '#2a0640', sfx: 'payoff_100000', fire: true, blackout: true, flicker: ['#ffffff', '#dda0ff'] },
  // ONE BILLION — RADIANT (2026-08-05). The deliberate opposite of BLACKOUT:
  // where 100k snuffs the world out so the number is the only lit thing left,
  // a billion sets the whole screen on fire with light. Same trick, inverted,
  // which is what keeps the two readable as two different events rather than
  // "the big one, again but more".
  { min: 1e9, name: 'radiant', color: '#fff6c8', tint: 0xffd23e, size: 112, stroke: '#4a3202', sfx: 'payoff_1000000000', fire: true, radiant: true, flicker: ['#ffffff', '#ffe08a'] },
];

/** The single highest tier a total has reached. */
export function payoffTier(total) {
  let hit = PAYOFF_TIERS[0];
  for (const t of PAYOFF_TIERS) if (total >= t.min) hit = t;
  return hit;
}

/** Big numbers with thousands separators; only the absurd ones compress. */
export function fmtTotal(n) {
  return n >= 1e6 ? fmtNum(n) : Math.round(n).toLocaleString('en-US');
}

/** HSV -> '#rrggbb' (rainbow tier cycles hue on this). */
function hueHex(h) {
  const c = Phaser.Display.Color.HSVToRGB(h % 1, 0.85, 1);
  return '#' + ((c.r << 16) | (c.g << 8) | c.b).toString(16).padStart(6, '0');
}

/**
 * Paint a text object in a never-repeating rainbow — the HERO EXCLUSIVE tier's
 * signature, and the same hue-cycling technique the 12,500 payoff tier uses.
 *
 * The timer is parented to the TEXT: it dies with the object, so a shop that
 * restocks, a ceremony that closes or a scene that shuts down never leaks one.
 * Anywhere animation is impossible (a one-shot popNumber) the caller should use
 * the tier's static `color` (0xff5ce1) instead.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Text} textObj
 * @param {{ step?: number, speed?: number, stroke?: boolean }} opts
 *        step  — ms per hue step (45-60 reads as a smooth cycle)
 *        speed — hue advanced per step (0.045 ≈ a full cycle every second)
 * @returns {Phaser.Time.TimerEvent} the cycling timer (already running)
 */
export function rainbowText(scene, textObj, opts = {}) {
  const { step = 50, speed = 0.045 } = opts;
  let h = Math.random();          // each label starts its own place in the wheel
  textObj.setColor(hueHex(h));
  const ev = scene.time.addEvent({
    delay: step,
    loop: true,
    callback: () => {
      if (!textObj.active) { ev.remove(); return; }
      h += speed;
      textObj.setColor(hueHex(h));
    },
  });
  textObj.once('destroy', () => ev.remove());
  return ev;
}

/** Rising ember flecks behind a hot number. */
export function embers(scene, x, y, depth, count, spread) {
  for (let i = 0; i < count; i++) {
    const p = scene.add.image(x + Phaser.Math.Between(-spread, spread), y + Phaser.Math.Between(10, 46),
      i % 4 === 0 ? 'fx_star' : 'fx_dust')
      .setTint(Phaser.Math.RND.pick([0xffe07a, 0xffa028, 0xff5410]))
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth)
      .setScale(Phaser.Math.FloatBetween(0.10, 0.30));
    scene.tweens.add({
      targets: p, y: p.y - Phaser.Math.Between(110, 260), x: p.x + Phaser.Math.Between(-46, 46),
      alpha: 0, scale: 0.02, duration: Phaser.Math.Between(520, 1020), ease: 'Sine.easeOut',
      onComplete: () => p.destroy(),
    });
  }
}

// ---------------------------------------------------------------------------
// RADIANT (1e9) — the anti-blackout.
//
// juice.js is scene-agnostic on purpose: it may not reach into BootScene's
// atlas for anything that is not already universal ('fx_glow', 'fx_star',
// 'fx_dust'). So the two shapes this tier needs that nothing else in the game
// has — a one-sided edge gradient and a sunburst wheel — are GENERATED here,
// once per texture manager, and cached under their key forever after.
// ---------------------------------------------------------------------------

/** Key of a 1-px-wide white gradient, opaque at the top, gone at the bottom. */
const EDGE_KEY = 'fx_edge_gradient';
/** Key of a white sunburst wheel with a soft radial falloff. */
const RAYS_KEY = 'fx_sunburst_rays';

function edgeTexture(scene) {
  if (scene.textures.exists(EDGE_KEY)) return EDGE_KEY;
  const W = 8, H = 160;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  for (let i = 0; i < H; i++) {
    // 1.5 rather than a square: at 2.1 the light had let go of the rail inside
    // 60px and, ADD-blended over a sunlit forest, simply did not read.
    const t = i / (H - 1);
    g.fillStyle(0xffffff, Math.pow(1 - t, 1.5));
    g.fillRect(0, i, W, 1);
  }
  g.generateTexture(EDGE_KEY, W, H);
  g.destroy();
  return EDGE_KEY;
}

function raysTexture(scene) {
  if (scene.textures.exists(RAYS_KEY)) return RAYS_KEY;
  const R = 320;             // texture is 2R square; the scene scales it up
  const SPOKES = 22;
  const STEPS = 16;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  // Painted OUTSIDE-IN at a low per-pass alpha: source-over accumulates
  // (a + a'(1-a)), so each shorter pass brightens what is left of the ray and
  // the wheel arrives with a smooth hot core instead of 22 hard triangles.
  for (let s = STEPS; s >= 1; s--) {
    const r = R * (0.16 + 0.84 * (s / STEPS));
    g.fillStyle(0xffffff, 0.085);
    for (let i = 0; i < SPOKES; i++) {
      const a0 = (i / SPOKES) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2 / SPOKES) * 0.40;
      g.beginPath();
      g.moveTo(R, R);
      g.arc(R, R, r, a0, a1);
      g.closePath();
      g.fillPath();
    }
  }
  g.generateTexture(RAYS_KEY, R * 2, R * 2);
  g.destroy();
  return RAYS_KEY;
}

/**
 * THE BILLION. Gold edge vignette breathing twice, a pale warm flash and the
 * wash it leaves behind, a rotating sunburst behind the digits, and the fire
 * tier's embers turned gold and thickened. Every object here owns its own
 * teardown, so the caller has nothing to clean up and nothing to hold.
 */
function radiantFX(scene, x, y, D, hold, size) {
  const { width: W, height: H } = scene.scale.gameSize;
  const GOLD = 0xffd23e;
  const PALE = 0xfff2c4;

  // --- 1. the edge vignette: four gradient rails, breathing twice ----------
  // Each bar is drawn from its rail INWARD (origin at the strip's opaque end),
  // so no matter the screen size the bright line is exactly on the edge.
  const key = edgeTexture(scene);
  const DEEP = Math.round(Math.min(W, H) * 0.36);
  const rails = [
    scene.add.image(W / 2, 0, key).setOrigin(0.5, 0).setAngle(0).setDisplaySize(W, DEEP),
    scene.add.image(W / 2, H, key).setOrigin(0.5, 0).setAngle(180).setDisplaySize(W, DEEP),
    scene.add.image(0, H / 2, key).setOrigin(0.5, 0).setAngle(-90).setDisplaySize(H, DEEP),
    scene.add.image(W, H / 2, key).setOrigin(0.5, 0).setAngle(90).setDisplaySize(H, DEEP),
  ];
  for (const b of rails) {
    b.setTint(GOLD).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(D - 4).setScrollFactor(0);
    // NB: this is the object's own alpha, never a fill alpha — see the note on
    // the blackout branch. Two breaths across the hold, then gone.
    scene.tweens.add({
      targets: b, alpha: 0.9, duration: Math.round((hold + 420) / 4),
      yoyo: true, repeat: 1, ease: 'Sine.easeInOut',
      onComplete: () => b.destroy(),
    });
  }

  // --- 2. the flash: one pale wash over everything, in and straight out ----
  const flash = scene.add.rectangle(W / 2, H / 2, W, H, PALE, 1)
    .setBlendMode(Phaser.BlendModes.ADD).setDepth(D - 3).setScrollFactor(0).setAlpha(0);
  scene.tweens.add({
    targets: flash, alpha: 0.35, duration: 90, yoyo: true, hold: 60,
    ease: 'Sine.easeOut', onComplete: () => flash.destroy(),
  });

  // --- 2b. ...and the wash the flash leaves behind ------------------------
  // The brief is "the screen goes GOLD", not "the screen blinks once", and a
  // 240ms flash over a sunlit green forest is gone before the eye has found
  // the number. This is the quiet half: a thin warm layer that breathes with
  // the rails for the whole hold, so the frame stays gold underneath the
  // sunburst instead of snapping back to green behind it.
  // Depth order for the whole tier, bottom up: wash, rays, rails, flash, aura,
  // embers, and the number itself on top of all of it.
  const wash = scene.add.rectangle(W / 2, H / 2, W, H, GOLD, 1)
    .setBlendMode(Phaser.BlendModes.ADD).setDepth(D - 6).setScrollFactor(0).setAlpha(0);
  scene.tweens.add({
    targets: wash, alpha: 0.16, duration: Math.round((hold + 420) / 4),
    yoyo: true, repeat: 1, ease: 'Sine.easeInOut',
    onComplete: () => wash.destroy(),
  });

  // --- 3. the sunburst, turning slowly behind the digits -------------------
  const rays = scene.add.image(x, y, raysTexture(scene))
    .setTint(GOLD).setBlendMode(Phaser.BlendModes.ADD).setDepth(D - 5)
    .setScrollFactor(0).setAlpha(0).setDisplaySize(size * 9, size * 9);
  scene.tweens.add({
    targets: rays, alpha: 0.42, duration: 240, ease: 'Cubic.easeOut',
    onComplete: () => scene.tweens.add({
      targets: rays, alpha: 0, duration: 520, delay: hold, onComplete: () => rays.destroy(),
    }),
  });
  scene.tweens.add({
    targets: rays, angle: 26, duration: hold + 900, ease: 'Sine.easeInOut',
  });
  scene.tweens.add({
    targets: rays, scaleX: rays.scaleX * 1.18, scaleY: rays.scaleY * 1.18,
    duration: hold + 900, ease: 'Sine.easeOut',
  });

  // --- 4. the storm: the fire tier's embers, gold and twice as thick -------
  goldEmbers(scene, x, y, D - 1, 34, Math.round(size * 3.0));
}

/** The fire tier's embers, retuned gold — RADIANT's ash is precious metal. */
export function goldEmbers(scene, x, y, depth, count, spread) {
  for (let i = 0; i < count; i++) {
    const p = scene.add.image(x + Phaser.Math.Between(-spread, spread), y + Phaser.Math.Between(0, 60),
      i % 3 === 0 ? 'fx_star' : 'fx_dust')
      .setTint(Phaser.Math.RND.pick([0xfff6c8, 0xffd23e, 0xffb020]))
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(depth)
      .setScale(Phaser.Math.FloatBetween(0.12, 0.40));
    scene.tweens.add({
      targets: p, y: p.y - Phaser.Math.Between(160, 380), x: p.x + Phaser.Math.Between(-70, 70),
      alpha: 0, scale: 0.02, angle: Phaser.Math.Between(-200, 200),
      duration: Phaser.Math.Between(620, 1260), ease: 'Sine.easeOut',
      onComplete: () => p.destroy(),
    });
  }
}

/**
 * THE PAYOFF. Blooms `total` at (x, y) with everything its tier has earned:
 * color, size, aura, burst, shake, rainbow cycling, flame + embers, and at the
 * very top a screen blackout with a purple bloom. Self-cleaning.
 *
 * @param {Phaser.Scene} scene
 * @param {number} total  the number to celebrate (drives every tier decision)
 * @param {{hold?:number, prefix?:string, sound?:boolean, scale?:number}} opts
 *        hold  — ms the number sits at full size before it floats away
 *        scale — extra multiplier on the tier size (hand-speed / layout tuning)
 * @returns {Phaser.GameObjects.Text} the total text (already animating)
 */
export function totalPayoffFX(scene, x, y, total, opts = {}) {
  const { hold = 620, prefix = '', sound = true, scale = 1 } = opts;
  const tier = payoffTier(total);
  const lvl = PAYOFF_TIERS.indexOf(tier);
  const D = DEPTH.overlay;
  const size = Math.round(tier.size * scale);

  if (sound && tier.sfx) sfx(scene, tier.sfx, { volume: 0.8 });

  // --- 100k: the world goes dark so the number is the only thing left ---
  if (tier.blackout) {
    const { width: W, height: H } = scene.scale.gameSize;
    // NB: the rectangle's 6th arg is FILL alpha — pass 1 and fade the object's
    // own alpha, or the tween moves a number nothing is looking at.
    const dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x04010a, 1)
      .setDepth(D - 3).setScrollFactor(0).setAlpha(0);
    scene.tweens.add({
      targets: dim, alpha: 0.74, duration: 140, hold: hold + 260, yoyo: true,
      ease: 'Sine.easeOut', onComplete: () => dim.destroy(),
    });
  }

  // --- 1e9: ...and the world goes GOLD, which is the opposite move ---
  if (tier.radiant) radiantFX(scene, x, y, D, hold, size);

  // --- aura bloom behind the digits (skipped on the plain cream tier) ---
  let aura = null;
  if (lvl > 0) {
    aura = scene.add.image(x, y, 'fx_glow')
      .setTint(tier.blackout ? 0xb45cff : tier.tint)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(D - 2).setAlpha(0)
      .setDisplaySize(size * 7, size * 3.6);
    scene.tweens.add({
      targets: aura, alpha: tier.blackout ? 0.95 : Math.min(0.28 + lvl * 0.07, 0.8),
      scaleX: aura.scaleX * 1.25, scaleY: aura.scaleY * 1.25,
      duration: 200, ease: 'Cubic.easeOut',
      onComplete: () => scene.tweens.add({
        targets: aura, alpha: 0, duration: 420, delay: hold, onComplete: () => aura.destroy(),
      }),
    });
  }

  // --- the number itself: plate-free, stroked, drop-shadowed ---
  const t = scene.add.text(x, y, prefix + fmtTotal(total), {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`,
    color: tier.color, stroke: tier.stroke, strokeThickness: Math.round(8 + lvl * 0.7),
  }).setOrigin(0.5).setDepth(D).setAlpha(0).setScale(0.35);
  t.setShadow(4, 7, '#000000bb', 12, true, true);

  scene.tweens.add({
    targets: t, alpha: 1, scale: 1, duration: 190, ease: 'Back.easeOut',
    onComplete: () => {
      // A payoff GROWS as it settles — the little swell JC asked for.
      scene.tweens.add({ targets: t, scale: 1.09, duration: 260, yoyo: true, ease: 'Sine.easeInOut' });
    },
  });

  if (lvl > 0) {
    burst(scene, x, y, tier.tint, 6 + lvl * 3);
    // RADIANT is off the top of the ramp on purpose: it is the hardest hit the
    // camera ever takes, and the tiers below it are capped at 0.014 so there is
    // somewhere left to go.
    if (tier.radiant) shake(scene, 0.024, 560);
    else shake(scene, Math.min(0.002 + lvl * 0.0012, 0.014), 130 + lvl * 12);
  }

  // --- 12.5k: hue cycling ---
  const timers = [];
  if (tier.rainbow) {
    let h = 0;
    timers.push(scene.time.addEvent({
      delay: 45, loop: true,
      callback: () => { h += 0.045; if (t.active) t.setColor(hueHex(h)); if (aura?.active) aura.setTint(Phaser.Display.Color.HSVToRGB(h % 1, 0.8, 1).color); },
    }));
  }

  // --- 50k+: flame flicker + rising embers ---
  if (tier.fire) {
    let f = 0;
    timers.push(scene.time.addEvent({
      delay: 70, loop: true,
      callback: () => {
        f++;
        if (t.active && !tier.rainbow) t.setColor(tier.flicker[f % 2]);
        if (tier.radiant) goldEmbers(scene, x, y, D - 1, 7, Math.round(t.width / 1.4));
        else embers(scene, x, y, D - 1, 3, Math.round(t.width / 2));
      },
    }));
    if (!tier.radiant) embers(scene, x, y, D - 1, 16, Math.round(size * 2.2));
  }

  const stop = () => { for (const e of timers) e.remove(); };
  scene.time.delayedCall(hold + 420, () => {
    stop();
    if (!t.active) return;
    scene.tweens.add({
      targets: t, alpha: 0, y: y - 54, scale: 0.9, duration: 340,
      ease: 'Sine.easeIn', onComplete: () => t.destroy(),
    });
  });
  return t;
}
