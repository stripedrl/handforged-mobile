/**
 * @file passiveChip.js
 * THE HERO'S PASSIVE, WEARING A FACE (JC, 2026-08-06).
 *
 * The kit blurb is gone from the combat sidebar. It was a paragraph of prose in
 * a HUD made of objects — you read it on your first fight and then it was
 * furniture, and worse, it was SILENT: Dextra's ×4 could be the largest single
 * multiplier in a hand and the only thing on screen that knew was the final
 * number. Meanwhile the sentence was eating the band above the artifact mat.
 *
 * In its place: a chip, in both scenes that own a hero, stacked directly above
 * THE ORACLE's receipt because they are the same kind of thing — a permanent
 * fact about this run that says what it does on hover and otherwise keeps
 * quiet. Same three layers as every other socketed object in this game (contact
 * pool, sunken socket, frame), so it reads as a thing on the parchment rather
 * than a decal printed onto it.
 *
 * WHAT IS DIFFERENT FROM THE ORACLE CHIP, and why:
 *
 *   · IT IS PALE. Her chip is a dark painting in a violet frame; this one is
 *     parchment, because it holds a HEAD — the same hero icon the map capsule
 *     and the run recap use — and a face on a dark ground at 36px is a smudge.
 *   · ITS FRAME IS THE HERO'S SUIT (config.SUIT_COLORS, via core/passives).
 *     Four heroes, four borders, no second palette invented here.
 *   · IT MOVES. The oracle's future is fixed the moment it is taken; a passive
 *     FIRES, hand by hand, and when it does the chip swells and floats what it
 *     just contributed exactly like a relic on the mat does — same swell, same
 *     drifting running total, same 1500ms hold. That is the whole reason it is
 *     an object: it can take a bow.
 *
 * Both scenes are restart-heavy singletons, so the handles this file writes
 * (`scene.passiveChip`, `scene.passiveTip`, `scene._passivePulse`) must be
 * nulled in their create().
 */

import { GAME_W, GAME_H, DEPTH, PARCH } from '../config.js';
import { woodPanel } from './panels.js';
import { passiveDef, passiveAccent, passiveText } from '../core/passives.js';
import { personalize } from './rewards.js';

/** Whatever tip is open, gone. Safe on a scene that never opened one. */
export function hidePassiveTip(scene) {
  if (scene?.passiveTip) {
    scene.passiveTip.destroy(true);
    scene.passiveTip = null;
  }
}

/**
 * The parchment panel the chip opens: the hero, then their kit — VERBATIM from
 * the character def, which is the string the sidebar used to print full-time.
 * Same idiom and same defaults as ui/oracleChip.oracleTip; it hangs BELOW by
 * default because both chips live in the top half of their panel.
 */
export function passiveTip(scene, def, x, y, { below = true, gap = 40, w = 384, depth = null } = {}) {
  const tip = scene.add.container(0, 0).setDepth(depth ?? DEPTH.overlay + 2);
  const title = scene.add.text(0, 0, `${def.name.toUpperCase()} · ${def.title.toUpperCase()}`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: PARCH.text,
    wordWrap: { width: w - 44 }, align: 'center',
  }).setOrigin(0.5, 0);
  const body = scene.add.text(0, title.height + 8, personalize(passiveText(def.id)), {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
    wordWrap: { width: w - 44 }, align: 'center', lineSpacing: 2,
  }).setOrigin(0.5, 0);
  const h = title.height + 8 + body.height + 30;
  const parts = woodPanel(scene, 0, h / 2 - 8, w, h, { shadow: true, accent: passiveAccent(def.id) });
  tip.add([parts.shadow, parts.panel, parts.line, title, body]);
  tip.setPosition(
    Phaser.Math.Clamp(x, w / 2 + 10, GAME_W - w / 2 - 10),
    Phaser.Math.Clamp(below ? y + gap : y - gap - h, 12, GAME_H - h - 12),
  );
  return tip;
}

/**
 * The chip itself, centred on (x, y). Returns the CONTAINER, or NULL for a
 * scene with no hero — so every caller can say
 * `this.passiveChip = addPassiveChip(...)` unconditionally.
 *
 * @param {Phaser.Scene} scene
 * @param {number} x  chip centre
 * @param {number} y  chip centre
 * @param {string|null} chrId  run.chrId
 */
export function addPassiveChip(scene, x, y, chrId, {
  size = 46, depth = null, below = true, labelBounds = null,
} = {}) {
  const def = passiveDef(chrId);
  if (!def) return null;

  const chip = scene.add.container(x, y);
  if (depth != null) chip.setDepth(depth);
  const half = size / 2;
  const R = 7;
  const accent = passiveAccent(def.id);

  // 1. THE CONTACT POOL. Without it the chip is printed on the parchment.
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x120a06, 0.42);
  shadow.fillRoundedRect(-half + 4, -half + 6, size, size, R);
  chip.add(shadow);

  // 2. THE PALE FIELD the head is struck on, with the suit's own colour washed
  //    faintly through its lower half so the chip belongs to its frame rather
  //    than merely being ringed by it.
  const back = scene.add.graphics();
  back.fillStyle(PARCH.fillLight, 1);
  back.fillRoundedRect(-half, -half, size, size, R);
  back.fillStyle(accent, 0.16);
  back.fillRoundedRect(-half, 0, size, half, { tl: 0, tr: 0, bl: R, br: R });
  chip.add(back);

  // 3. THE HEAD. `hero_icon_<chrId>` is boot art (core/lazyload.js) and is the
  //    same portrait the map capsule and the run recap use, so a player never
  //    has to learn a second visual name for their hero. Drawn to the chip's
  //    inner square: well under the 128px cap tools/build_dist.py holds these
  //    icons to.
  const key = 'hero_icon_' + def.id;
  if (scene.textures.exists(key)) {
    const face = scene.add.image(0, 0, key);
    face.setScale((size - 10) / Math.max(face.width, face.height));
    chip.add(face);
  } else {
    // A chip that renders nothing at all would read as a bug rather than as a
    // hero, so the plainest glyph in the atlas stands in.
    const fb = scene.add.image(0, 0, 'icon_star').setTint(accent);
    fb.setScale((size - 16) / Math.max(fb.width, fb.height));
    chip.add(fb);
  }

  // 4. THE FRAME, in the hero's suit, over a thin dark keyline.
  const frame = scene.add.graphics();
  frame.lineStyle(4, accent, 0.95);
  frame.strokeRoundedRect(-half + 1, -half + 1, size - 2, size - 2, R);
  frame.lineStyle(2, 0x2a1808, 0.85);
  frame.strokeRoundedRect(-half - 1, -half - 1, size + 2, size + 2, R + 1);
  chip.add(frame);

  // A 46px target is small to aim at with a finger, so the chip carries a
  // generous invisible hit box — the same courtesy the oracle chip gets.
  const hitW = size + 16;
  const hit = scene.add.rectangle(0, 0, hitW, hitW, 0x000000, 0)
    .setInteractive({ useHandCursor: true });
  chip.add(hit);
  chip.hitRect = { w: hitW, h: hitW };
  chip.chipSize = size;            // the INKED footprint, for layout audits
  chip.chrId = def.id;
  chip.accent = accent;
  // WHERE ITS FLOATING LABEL MAY SIT. The chip lives in a narrow panel on both
  // surfaces and a wide label ('1 CARD ×4', 'ZEAL 12 ×1.24') centred on a chip
  // near that panel's edge runs off it — the same problem, and the same fix,
  // that the artifact mat's own pulse labels have. The panel's width is the
  // caller's business, not this file's.
  chip.labelBounds = labelBounds;

  hit.on('pointerover', () => {
    hidePassiveTip(scene);
    scene.passiveTip = passiveTip(scene, def, x, y, { below, gap: half + 18 });
  });
  hit.on('pointerout', () => hidePassiveTip(scene));
  chip.once('destroy', () => hidePassiveTip(scene));
  return chip;
}

/**
 * THE BOW. The passive fired, so the chip swells and floats what it just
 * contributed — deliberately the same shape as CombatScene.pulseArtifact,
 * because to the player this IS a relic that happens to live above the oracle
 * instead of on the mat: repeat triggers in one hand accumulate into a running
 * total while the old number drifts off behind the new one.
 *
 * A no-op on a scene with no chip, which is every scene except the two that
 * mount one.
 *
 * @param {Phaser.Scene} scene
 * @param {string} label  what the passive contributed, already formatted
 * @param {{color?: string}} opts
 */
export function pulsePassive(scene, label, { color = '#ffd23e' } = {}) {
  const chip = scene?.passiveChip;
  if (!chip?.active) return;
  const tot = (scene._passivePulse ??= { uses: 0, labelObj: null, fadeTimer: null });
  tot.uses += 1;

  scene.tweens.killTweensOf(chip);
  scene.tweens.add({
    targets: chip, scale: 1.45, duration: 130,
    yoyo: true, hold: 160, ease: 'Back.easeOut',
    onComplete: () => { if (chip.active) chip.setScale(1); },
  });

  if (tot.labelObj?.active) {
    const old = tot.labelObj;
    scene.tweens.add({ targets: old, y: old.y - 42, alpha: 0, duration: 420, onComplete: () => old.destroy() });
  }
  const size = Math.min(23 + tot.uses * 3, 36);
  const b = chip.labelBounds ?? [96, GAME_W - 96];
  const lx = Phaser.Math.Clamp(chip.x, b[0], b[1]);
  tot.labelObj = scene.add.text(lx, chip.y - chip.chipSize / 2 - 26, label, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`,
    color, stroke: '#241505', strokeThickness: 6,
  }).setOrigin(0.5).setDepth(DEPTH.overlay).setScale(0);
  scene.tweens.add({ targets: tot.labelObj, scale: 1, duration: 140, ease: 'Back.easeOut' });

  tot.fadeTimer?.remove();
  tot.fadeTimer = scene.time.delayedCall(1500, () => {
    if (tot.labelObj?.active) {
      const o = tot.labelObj;
      scene.tweens.add({ targets: o, alpha: 0, y: o.y - 34, duration: 500, onComplete: () => o.destroy() });
    }
  });
}

/** New hand incoming: any leftover label wipes and the running total resets. */
export function resetPassivePulse(scene, instant = false) {
  const tot = scene?._passivePulse;
  if (!tot) return;
  tot.fadeTimer?.remove();
  if (tot.labelObj?.active) {
    const o = tot.labelObj;
    if (instant) o.destroy();
    else scene.tweens.add({ targets: o, alpha: 0, y: o.y - 30, duration: 280, onComplete: () => o.destroy() });
  }
  scene._passivePulse = null;
}
