/** Player settings — persisted to localStorage, consumed by music.js / sfx.js / juice.js. */

const KEY = 'handforged_settings_v1';

export const settings = {
  master: 0.8,
  music: 0.8,
  sfx: 0.9,
  shake: true,
  cardColors: false,  // per-suit painted card faces (off = one neutral face per hero)
  playSpeed: 2,       // 1 | 2 | 3 — how fast a played hand scores (2 = shipped pacing)
  // Sweep sideways across the fan to select several cards at once. OFF by
  // default on purpose: the hand has always spent drag on REORDERING, and
  // nobody's muscle memory should change without being asked. With it on, an
  // UPWARD drag still reorders — see core/dragSelect.js for the split.
  dragSelect: false,
  dev: false,   // developer mode: WIN button in combat, +chips on map, all acts unlocked
  // ---- DEV BALANCE SLIDERS (settings menu, DEV section, dev mode only) ------
  // Live multipliers for on-the-fly tuning. They COMPOUND with the shipped
  // baseline: x1 IS the shipped game (enemy damage already carries its own
  // -35% pass). Steps are the DEV_SLIDER_STEPS ladder below.
  devEnemyHp: 1,    // makeEnemy: every enemy's max HP
  devEnemyDmg: 1,   // currentIntent: every enemy ATTACK value (telegraph included)
  devGold: 1,       // run.gainGold — every chip the player RECEIVES, anywhere
};

/**
 * The rungs the three dev sliders step through. Log-ish so a single tap can
 * make a real statement: quarter power up to ten times power.
 */
export const DEV_SLIDER_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10];

/**
 * The multiplier for a dev slider field. Always 1 outside dev mode, so a value
 * left on a slider months ago can never touch a normal run. `> 0` also catches
 * undefined/null/NaN out of a mangled save, which is the only way a non-step
 * value could get in here.
 */
export function devMult(field) {
  if (!settings.dev) return 1;
  const v = settings[field];
  return v > 0 ? v : 1;
}

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  Object.assign(settings, saved);
} catch { /* fresh defaults */ }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

/**
 * THE SETTINGS PANEL'S HEIGHT BUDGET, in pixels, by mode.
 *
 * It lives in here rather than beside the layout in ui/settingsMenu.js for one
 * reason: this module is Phaser-free, so a node test can hold the number against
 * the canvas without booting a renderer. The panel has run off the screen once
 * already (2026-08-02: 1148 tall on a 1080 canvas, with RESUME under the bezel),
 * and "the tests pass" was not evidence then either.
 *
 * The +82 is the UNLOCK ALL row, which is always present. ACHIEVEMENTS joined
 * that row on 2026-08-03 rather than taking a row of its own, and the reason is
 * arithmetic: a seventh full-width row costs another 82, which would put the dev
 * panel at 1110 — thirty pixels off the bottom of a 1080 screen. Two 300px
 * buttons side by side inside a 680px panel cost nothing at all.
 *
 * IT MUST NEVER EXCEED GAME_H. See tests/skins.test.js.
 */
export function settingsPanelHeight(dev = false) {
  return (dev ? 946 : 876) + 82;
}

// The LIVE settings object, exposed for the verification runs. spd() reads
// `playSpeed` fresh on every call, so a Playwright script can flip the hand
// speed between measurements without restarting the scene.
try { window.__hfSettings = settings; } catch { /* node, no window */ }
