/**
 * @file loadingVeil.js
 * THE ONLY WAIT THE PLAYER IS EVER SHOWN.
 *
 * Deferred loading (core/lazyload.js) puts every fetch behind a transition that
 * was already on screen — the Select→Map fade, the DESCEND ceremony, the 700ms
 * a pack takes to tear open. On a warm cache and a local disk that is the whole
 * story and this file never runs.
 *
 * It exists for the boots where it is not: a cold first run on a slow phone,
 * where Act I's board is 36 MB and the 300ms map fade is not enough. A scene
 * that opened onto a blank parchment and popped its board in a second later
 * would read as broken; a scene that holds the fade one beat longer and says so
 * reads as loading. So: the SAME dark the cameras fade to (0x14101c, the colour
 * every fadeIn/fadeOut in the game uses), and the Boot bar's own idiom shrunk to
 * a third — a recessed track with a gold rim and a molten fill, under one gold
 * line naming what is being waited for ("Act II · Frozen Wayside").
 *
 * NO PERCENTAGE, unlike the Boot bar. That screen is a forty-second wait and a
 * number is company; this one is a second and a half at worst, and a readout
 * ticking from 40% to 100% in a blink reads as a stutter rather than as progress.
 *
 * DELIBERATELY SILENT FOR THE FIRST BEAT. `GRACE_MS` of nothing at all before
 * anything is drawn: a fifth of a second that flashes a progress bar is worse
 * than a fifth of a second, and most of these resolve inside one frame. If the
 * ensure lands during the grace the player sees exactly what they saw before
 * this file existed — a fade.
 *
 * Everything is GENERATED (Graphics, into two reused textures), for the same
 * reason BootScene's loading screen is: a progress bar for a load must never
 * itself be waiting on a load.
 */

import { GAME_W, GAME_H, COLORS, DEPTH } from '../config.js';

/**
 * How long a wait has to run before it is worth admitting to.
 *
 * 220ms, not 100: the veil fades IN over 160ms, so anything much shorter than
 * this shows a bar that is still arriving when it is asked to leave, which
 * reads as a flicker rather than as a load. A pause of a fifth of a second with
 * nothing drawn on it is a pause nobody notices; a bar that blinks is a bug.
 */
const GRACE_MS = 220;
const BAR_W = 360;
const BAR_H = 18;

/** Generated once per texture manager, then reused for every veil in the run. */
function veilTextures(scene) {
  const tm = scene.textures;
  if (!tm.exists('veil_bar_track')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x2a1c14, 1);
    g.fillRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
    g.fillStyle(0x0a0610, 1);
    g.fillRoundedRect(3, 3, BAR_W - 6, BAR_H - 6, (BAR_H - 6) / 2);
    g.lineStyle(2, 0xffc542, 0.55);
    g.strokeRoundedRect(1, 1, BAR_W - 2, BAR_H - 2, (BAR_H - 2) / 2);
    g.generateTexture('veil_bar_track', BAR_W, BAR_H);
    g.clear();
    g.fillStyle(0xffc542, 1);
    g.fillRoundedRect(0, 0, BAR_W - 10, BAR_H - 8, (BAR_H - 8) / 2);
    g.fillStyle(0xffeab0, 0.5);
    g.fillRoundedRect(3, 1, BAR_W - 16, (BAR_H - 8) * 0.36, 2);
    g.generateTexture('veil_bar_fill', BAR_W - 10, BAR_H - 8);
    g.destroy();
  }
}

/**
 * Raise a veil over `scene` until its loads land.
 *
 * @param {Phaser.Scene} scene
 * @param {string} [label] the one line under the bar
 * @returns {{ progress: (t:number)=>void, close: ()=>void }}
 */
export function loadingVeil(scene, label = 'Loading…') {
  let shown = 0;                 // the drawn value; chases `target`
  let target = 0;
  let ui = null;                 // built lazily, after GRACE_MS
  let closed = false;

  const build = () => {
    if (closed || ui) return;
    veilTextures(scene);
    const cx = GAME_W / 2;
    const cy = GAME_H / 2 + 150;
    const d = DEPTH.overlay + 40;   // over every overlay this game has
    const c = scene.add.container(0, 0).setDepth(d).setAlpha(0);
    // The camera fade's own colour, so the veil and the fade are one surface.
    // INTERACTIVE while it is up, so a click aimed at a scene that is still
    // building is swallowed rather than landing on half a display list — and
    // DEAD the instant close() is called, because the fade-out is 200ms of a
    // fully-drawn screen that must accept the pointer. A veil that keeps eating
    // clicks while it disappears is indistinguishable from a frozen game.
    const swallow = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 1)
      .setInteractive();
    c.add(swallow);
    const FILL_W = BAR_W - 10, FILL_H = BAR_H - 8;
    c.add(scene.add.image(cx, cy, 'veil_bar_track'));
    const fill = scene.add.image(cx - FILL_W / 2, cy, 'veil_bar_fill')
      .setOrigin(0, 0.5).setCrop(0, 0, 0, FILL_H);
    c.add(fill);
    const line = scene.add.text(cx, cy - 44, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: COLORS.gold,
    }).setOrigin(0.5);
    c.add(line);
    scene.tweens.add({ targets: c, alpha: 1, duration: 160, ease: 'Sine.easeOut' });
    ui = { c, fill, swallow, FILL_W, FILL_H };
  };

  const graceTimer = scene.time.delayedCall(GRACE_MS, build);

  /**
   * The drawn value CHASES the real one, exactly the way the Boot bar does:
   * bundles land in big uneven steps (one 18 MB backdrop is half an act's
   * bundle) and a bar that teleports reads as a glitch.
   *
   * On PRE_UPDATE, not update(): a scene whose create() has not finished never
   * gets an update(), and that is the entire life of this thing.
   */
  const tick = (time, delta) => {
    if (!ui) return;
    shown += (target - shown) * (1 - Math.exp(-6 * Math.min(delta, 100) / 1000));
    ui.fill.setCrop(0, 0, Math.max(0, Math.min(1, shown)) * ui.FILL_W, ui.FILL_H);
  };
  scene.events.on('preupdate', tick);

  const detach = () => {
    scene.events.off('preupdate', tick);
    scene.events.off('shutdown', onShutdown);
    graceTimer.remove(false);
  };
  /**
   * A SCENE TORN DOWN MID-LOAD TAKES ITS VEIL WITH IT — and this handler is what
   * stops the veil from noticing too late.
   *
   * The display list destroys every object the veil owns on shutdown, and a
   * `close()` arriving after that reaches into a destroyed GameObject: Phaser
   * nulls `gameObject.scene` on destroy, so `disableInteractive()` throws
   * "Cannot read properties of undefined (reading 'sys')" out of a promise
   * nobody is catching. Measured under a four-way parallel battery, where an
   * `ensure` can easily outlive the scene that asked for it.
   *
   * So the veil is declared CLOSED and its handles dropped the moment the scene
   * goes, which makes close() a no-op and tick() a no-op afterwards.
   */
  const onShutdown = () => { detach(); closed = true; ui = null; };
  scene.events.on('shutdown', onShutdown);

  return {
    progress: (t) => { target = Math.max(target, Number(t) || 0); },
    close: () => {
      if (closed) return;
      closed = true;
      detach();
      if (!ui) return;
      const { c, fill, swallow, FILL_W, FILL_H } = ui;
      ui = null;
      // BELT AND BRACES for the shutdown handler above, and it comes FIRST:
      // `gameObject.scene` is nulled on destroy, so this is the cheapest honest
      // test of "is any of this still real". Nothing below may touch a dead
      // object — not the crop, not the tween, not disableInteractive.
      if (!c.scene) return;
      // SNAP, then fade. The same reasoning as BootScene's completion snap: a
      // bar that is never seen full is a bar that lied.
      shown = target = 1;
      fill.setCrop(0, 0, FILL_W, FILL_H);
      // THE POINTER GOES THROUGH FROM HERE. See the essay at `swallow`.
      swallow.disableInteractive();
      scene.tweens.add({
        targets: c, alpha: 0, duration: 200, ease: 'Sine.easeIn',
        onComplete: () => c.destroy(true),
      });
    },
  };
}

/**
 * THE GATE every deferred load point is written on.
 *
 * Runs `build` SYNCHRONOUSLY when nothing is missing — which is the property the
 * whole design rests on. The second visit to a room, every dev-hook scene jump
 * after the first, and every driver in tools/ that calls `__hf.openEvent()` and
 * then reads the display list on the next line all go down that path and behave
 * exactly as they did before this existed.
 *
 * Only a genuine cold miss takes the async branch, and only a miss that outlives
 * GRACE_MS shows anything at all.
 *
 * @param {Phaser.Scene} scene
 * @param {string[]} keys      what `build` is about to draw
 * @param {() => void} build
 * @param {{label?: string, ensure: Function, missingKeys: Function}} io
 *        the two lazyload functions, passed in so this file stays free of the
 *        manifest (and so a test can drive the gate with fakes)
 * @returns {Promise<void>|void}
 */
export function gateOn(scene, keys, build, { label = 'Loading…', ensure, missingKeys }) {
  /**
   * THE GENERATION TOKEN, and why `scene.scene.isActive()` is not enough.
   *
   * Phaser scenes are SINGLETONS. A `scene.restart()` taken while a gate is
   * waiting does not destroy the instance — it runs create() again on the same
   * object, so the stale continuation would find a perfectly ACTIVE scene and
   * build a second display list into the new lifetime. This project has been
   * bitten by exactly that shape before (see the essays on run.map.bossPick and
   * on stages.js's in-flight set). Bumped unconditionally, so the synchronous
   * path invalidates a pending async one too.
   */
  const gen = (scene.__lazyGen = (scene.__lazyGen ?? 0) + 1);
  if (!missingKeys(scene, keys).length) return build();
  const veil = loadingVeil(scene, label);
  return ensure(scene, keys, { onProgress: veil.progress }).then(() => {
    // ...AND THE SECOND HALF OF THE SAME QUESTION. The token catches a RESTART
    // (create() ran again and bumped it); `isActive` catches a plain STOP, which
    // bumps nothing at all — `scene.start('Combat')` taken while a map gate is
    // waiting is exactly that, and building into a stopped scene puts a display
    // list on a surface that will never be shown and never be cleaned up.
    if (scene.__lazyGen !== gen || !scene.sys.isActive()) return;
    veil.close();
    build();
  });
}
