import { GAME_W, CHARACTERS } from '../config.js';
import { isCharacterUnlocked } from '../core/progress.js';
import { heroTextureFor } from '../core/skins.js';

// The painted hero models all share one canvas (900x850, feet on y~800, figure
// centred on x~452 — see tools/normalize_hero_art.py, which enforces it). Every
// number below is derived from that rather than eyeballed per hero, so a hero
// delivered tomorrow stands on the same floor as the three shipped ones.
const MODEL_H = 850;
const MODEL_FEET = 800;
/** How far below a model's CENTRE its feet are, at scale 1. */
const FEET_DROP = MODEL_FEET - MODEL_H / 2;   // 375

/**
 * THE GLEAM. A gold shine bar walks across a target every `period` ms, masked
 * to the target's own painted pixels so it reads as light moving over metal
 * rather than a rectangle sliding past.
 *
 * The mask is built ONCE and reused: a bitmap mask allocates a render texture,
 * and one per sweep every nine seconds is a slow leak on a screen people leave
 * open. Everything is torn down with the scene.
 */
export function gleamSweep(scene, target, { period = 9000, delay = 2400, tint = 0xfff3c4, speed = 900 } = {}) {
  const w = target.displayWidth;
  const h = target.displayHeight;
  const bar = scene.add.image(target.x, target.y, 'fx_glow')
    .setBlendMode(Phaser.BlendModes.ADD)
    .setTint(tint)
    .setDisplaySize(w * 0.20, h * 2.6)
    .setAngle(-20)
    .setAlpha(0);
  const mask = target.createBitmapMask();
  bar.setMask(mask);

  const sweep = () => {
    if (!bar.active) return;
    bar.setPosition(target.x - w * 0.72, target.y);
    bar.setAlpha(0);
    scene.tweens.add({ targets: bar, alpha: 0.68, duration: speed * 0.28, ease: 'Sine.easeOut' });
    scene.tweens.add({
      targets: bar, x: target.x + w * 0.72, duration: speed, ease: 'Sine.easeInOut',
      onComplete: () => scene.tweens.add({ targets: bar, alpha: 0, duration: 200 }),
    });
  };
  const timer = scene.time.addEvent({ delay: period, startAt: Math.max(0, period - delay), loop: true, callback: sweep });
  scene.events.once('shutdown', () => { timer.remove(); mask.destroy(); });
  return { bar, sweep, timer };
}

/**
 * AMBIENT CARDS. Six oversized painted faces tumbling in the deep background,
 * added through addTavernBackdrop's `beforeDim` seam so the dim rectangle lies
 * over the top of them: they are meant to read as something half-dreamed in the
 * tavern's smoke, not as art placed on the screen.
 *
 * Every period is a different prime-ish number so the group never falls into
 * step, which is the thing that would give them away as a loop.
 */
export function driftingCards(scene) {
  const keys = Object.keys(CHARACTERS)
    .map(id => 'cardface_' + id)
    .filter(k => scene.textures.exists(k));
  if (scene.textures.exists('card_face')) keys.push('card_face');
  if (!keys.length) return [];

  // Fractions of the canvas, so the 2340-wide mobile build spreads them rather
  // than stacking them all on the left.
  // The alphas were tuned against the painting, not chosen in the abstract: the
  // tavern art is busy and already dimmed, and anything under about 0.12 simply
  // is not there. 0.17 is the ceiling at which one stops reading as smoke and
  // starts reading as a card someone left on the screen.
  const spots = [
    { fx: 0.09, y: 250, h: 700, a: 0.17 },
    { fx: 0.27, y: 760, h: 560, a: 0.13 },
    { fx: 0.46, y: 190, h: 620, a: 0.14 },
    { fx: 0.63, y: 830, h: 720, a: 0.15 },
    { fx: 0.80, y: 330, h: 660, a: 0.17 },
    { fx: 0.94, y: 760, h: 540, a: 0.13 },
  ];
  return spots.map((s, i) => {
    const img = scene.add.image(GAME_W * s.fx, s.y, keys[i % keys.length]);
    img.setScale(s.h / img.height).setAlpha(s.a).setAngle(i % 2 ? -14 : 11);
    scene.tweens.add({
      targets: img, angle: i % 2 ? 16 : -18,
      duration: 17000 + i * 2300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: img, y: s.y + (i % 2 ? -26 : 22), x: img.x + (i % 3 === 0 ? 18 : -14),
      duration: 12500 + i * 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    return img;
  });
}

/**
 * THE LINEUP. Your unlocked champions loitering by the hearth, small, on the
 * tavern's own floor line.
 *
 * Grounded means grounded: the models are placed by their FEET (see FEET_DROP)
 * rather than by their centres, so heroes at different depth scales stand on
 * one line instead of hovering at different heights. Each one gets a contact
 * shadow pooled at that line and its own bob period.
 *
 * A locked hero is simply not here — the roster is the reward, and a row of
 * silhouettes on the title screen would spoil both of them.
 */
export function heroLineup(scene, anchor, { avoidX = null } = {}) {
  const ids = Object.keys(CHARACTERS).filter(id => isCharacterUnlocked(id));
  if (!ids.length) return [];

  const n = ids.length;
  const spacing = n <= 3 ? 126 : 106;
  // Just right of the hearth: the fire is the reason they are standing here.
  const centreX = anchor.fireX + 46;
  const floor = anchor.floorY;

  const out = [];
  // Back to front, so the smaller (further) models are overlapped by the nearer
  // ones rather than the other way round.
  const order = ids.map((id, i) => ({ id, i, depth: (i % 2 ? 0 : 1) })).sort((a, b) => a.depth - b.depth);
  for (const { id, i, depth } of order) {
    const s = depth ? 0.184 : 0.157;                  // near / far
    const x = centreX + (i - (n - 1) / 2) * spacing;
    if (avoidX && Math.abs(x - avoidX.x) < avoidX.pad) continue;
    const footY = floor - (depth ? 0 : 11);
    const y = footY - FEET_DROP * s;

    // TWO pools, not one. A single soft fx_glow washed out completely against
    // the tavern's dark wood, and a hero with no contact shadow is a hero
    // hovering an inch off the floor — which is exactly how the first pass read.
    const shadow = scene.add.image(x + 3, footY - 4, 'fx_glow')
      .setTint(0x000000).setAlpha(0.62).setDisplaySize(196 * s / 0.184, 52 * s / 0.184);
    const contact = scene.add.image(x + 2, footY - 3, 'fx_glow')
      .setTint(0x000000).setAlpha(0.85).setDisplaySize(104 * s / 0.184, 26 * s / 0.184);
    const key = heroTextureFor(id, k => scene.textures.exists(k));
    const sprite = scene.add.image(x, y, key).setScale(s).setAlpha(depth ? 0.96 : 0.76);
    // Far models sit deeper in the tavern's gloom, which is what sells the row
    // as a crowd rather than a sprite sheet.
    if (!depth) sprite.setTint(0x8f7a63);
    scene.tweens.add({
      targets: sprite, y: y - 5, duration: 1900 + i * 310,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      // '*=' rather than a number: the two pools are different widths, and one
      // literal would snap the tight one out to the soft one's size.
      targets: [shadow, contact], scaleX: '*=0.94', duration: 1900 + i * 310,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    out.push({ id, sprite, shadow, contact, x, floor: footY });
  }
  return out;
}
