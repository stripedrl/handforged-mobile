import { wrapImageLoader } from '../core/imgload.js';
import { bootMark } from '../core/boottime.js';

/**
 * THE WEB FONTS, listed once.
 *
 * Canvas usage alone does NOT make a browser fetch a webfont — Phaser draws
 * text into a canvas and the browser happily paints it in fallback serif — so
 * every font the game types in has to be asked for by hand. Preboot does the
 * asking (see below) and BootScene awaits the same list again at the end of its
 * create(), which is instant once these have landed.
 *
 * Weights matter: 'Baloo 2' is loaded at three of them and `document.fonts.load`
 * resolves per-descriptor, so asking for one weight would leave the other two
 * un-fetched. The size in each string is irrelevant to what gets downloaded; it
 * just has to parse as a CSS font shorthand.
 */
export const WEB_FONTS = [
  "48px 'Lilita One'",
  "400 48px 'Baloo 2'", "600 48px 'Baloo 2'", "700 48px 'Baloo 2'",
  '48px Alata',
];

/**
 * How long boot will wait on the font server before drawing anyway.
 *
 * MEASURED, 2026-08-05, cold with the browser cache disabled: the fonts land
 * 165-240ms in and this scene's own four images land 450-520ms in, so the font
 * promise resolves a quarter-second before the loader does and this timeout has
 * never once been the thing that ended the wait. It exists for the boot where
 * Google's font CSS hangs, and 4s was a budget nobody had priced: on a boot
 * whose measured Preboot phase is ~340ms, a stall could quietly cost twelve
 * times the whole phase. 1.5s still clears the worst font landing ever observed
 * (309ms) by nearly 5x, and caps the damage at something a player would call a
 * pause rather than a hang.
 *
 * Handing off on IMAGES alone and letting the fonts land behind the curtain was
 * the other candidate — it would make this number unreachable — and the numbers
 * argued against it: the fonts already win the race by ~270ms every time, so it
 * would buy 0ms in exchange for a loading screen that can be typed in fallback
 * serif, which is the exact fault this scene was written to fix.
 */
const FONT_TIMEOUT_MS = 1500;

/**
 * PREBOOT — the third of a second before the loading screen can exist.
 *
 * MEASURED, 2026-08-05: 331-375ms, cold and warm alike, of which the 1.09MB
 * logo is nearly all. Every one of those milliseconds is dead time on every
 * boot there will ever be, because BootScene cannot ask for its first byte
 * until this scene hands off — so tools/verify_boot_screen.py holds it to a
 * budget. Priced against the whole rebuild, the Preboot scene costs +113ms of
 * a ~37.5s cold boot and the loading screen it exists to serve costs ~390ms
 * more; both together are 1.3% of the wait.
 *
 * BootScene loads 590+ textures and a cold boot can run 40 seconds, so the
 * loading screen it draws is the longest look the player gets at this game
 * before they get the game. That screen wants the logo, some embers and the
 * real fonts — all three of which used to be unavailable at exactly the moment
 * they were needed, because they were part of the very load being waited on.
 * (The old screen was a gold sliver and a line of fallback serif for that
 * reason.)
 *
 * So this scene runs FIRST and loads only what the loading screen itself is
 * made of: the logo and the three ember particles, ~1.1MB all told, plus the
 * fonts kicked off in init() so the network fetch overlaps the image fetch
 * instead of following it. It draws nothing — on any real machine it is gone
 * inside a second, and a flash of layout would be worse than the dark.
 *
 * Nothing here may ever be load-bearing for the GAME: a font server that is
 * down, or an image that 404s, must cost the player a prettier loading screen
 * and nothing else. Hence the `.catch(() => {})`, the timeout race, and
 * BootScene's `textures.exists()` guards around everything this scene provides.
 */
export class PrebootScene extends Phaser.Scene {
  constructor() { super('Preboot'); }

  init() {
    bootMark('prebootInit');
    // Started HERE, not in create(), so the fonts are in flight while the
    // loader works. Never rejects and never hangs: a slow font server delays
    // boot by FONT_TIMEOUT_MS at the very most.
    const fonts = (typeof document !== 'undefined' && document.fonts)
      ? Promise.all(WEB_FONTS.map(f => document.fonts.load(f))).catch(() => {})
      : Promise.resolve();
    fonts.then(() => bootMark('fontsLanded'));
    this.fontsReady = Promise.race([
      fonts,
      new Promise(res => setTimeout(res, FONT_TIMEOUT_MS)),
    ]);
  }

  preload() {
    bootMark('prebootPreload');
    // Same rewrite BootScene uses — see core/imgload.js. Without it these two
    // loads are the only .png requests in a build where every image is .webp,
    // which is a 404 that only the shipped tree can show you.
    wrapImageLoader(this);

    const A = 'assets';
    this.load.image('logo', `${A}/ui/logo.png`);
    this.load.image('particle_ember_1', `${A}/fx/particle_ember_1.png`);
    this.load.image('particle_ember_2', `${A}/fx/particle_ember_2.png`);
    this.load.image('particle_ember_3', `${A}/fx/particle_ember_3.png`);
  }

  create() {
    bootMark('prebootCreate');
    this.fontsReady.then(() => {
      bootMark('prebootHandoff');
      this.scene.start('Boot');
    });
  }
}
