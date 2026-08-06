import { GAME_H, VIEW_W } from './config.js';
import { PrebootScene } from './scenes/PrebootScene.js';
import { BootScene } from './scenes/BootScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { CharacterSelectScene } from './scenes/CharacterSelectScene.js';
import { MapScene } from './scenes/MapScene.js';
import { CombatScene } from './scenes/CombatScene.js';
import { bootMark, bootTimings } from './core/boottime.js';

// Lap zero: every other boot mark is measured from here, which is the moment
// the module graph finished evaluating and Phaser is about to be handed the
// scene list. See core/boottime.js.
bootMark('mainStart');
// Type `__bootTimings()` in the console after a boot to get the laps in ms.
window.__bootTimings = bootTimings;

window.__game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // VIEW_W === GAME_W on desktop; the mobile flag widens the canvas to the
  // iPhone's 19.5:9 and the scenes centre the classic layout on it.
  width: VIEW_W,
  height: GAME_H,
  backgroundColor: '#14101c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Preboot FIRST: Phaser auto-starts scene[0], and Preboot exists to fetch the
  // handful of things BootScene's loading screen is drawn with (logo, embers,
  // the webfonts) before that screen has to draw. It hands off to Boot itself.
  scene: [PrebootScene, BootScene, TitleScene, CharacterSelectScene, MapScene, CombatScene],
});
