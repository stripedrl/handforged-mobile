/**
 * @file oracleChip.js
 * THE ORACLE'S RECEIPT, WHERE YOU CAN READ IT (JC, 2026-08-05).
 *
 * She deals ONCE, before the run has really begun, and you MUST take one of
 * three. Seven of the twenty are PERMANENT RUN MODIFIERS (core/oracle.js) —
 * they quietly change what the shop charges, what the relic table rolls, where
 * a played card goes — and until now there was no surface anywhere that would
 * tell you, an hour later, which future you had bought. `run.oracle` was a
 * receipt nobody printed.
 *
 * So it wears a STATUS CHIP, in both scenes that own a hero: the combat sidebar
 * and the map HUD. Small, framed like the debuff pips it sits near, painted
 * with the option's OWN pack-card face, and it says what it does on HOVER on
 * desktop or on a TAP on touch.
 *
 * (It used to say "or on a hold, via installLongPress, which synthesises the
 * pointerover this file listens for". That synthesis was removed on 2026-08-11
 * — it was half of the double-description bug, where one touch woke both the
 * two-tap box and the old tooltip on top of each other — so the touch path is
 * now an explicit `tapInfo` fork at the binding below rather than a hover this
 * file is tricked into receiving.)
 *
 * TWO RULES THIS FILE KEEPS:
 *
 *   1. THE COPY IS NEVER RE-TYPED. The tooltip prints `ORACLE_BY_ID[id].desc`
 *      through personalize(), which is the same string, from the same table,
 *      that her pack shelf printed when the choice was made. Every number in it
 *      is a template literal over the constants apply() actually pays, so a
 *      retune moves the chip's tooltip with it and this file never learns.
 *   2. THE CHIP IS AN OBJECT, NOT A STICKER. Contact shadow, sunken socket,
 *      violet frame — the same three layers a potion on the belt and a relic on
 *      the mat wear, because a HUD full of flat decals reads as a mock-up.
 *
 * Both scenes are restart-heavy singletons, so the two handles this file writes
 * (`scene.oracleChip`, `scene.oracleTip`) must be nulled in their create().
 */

import { GAME_W, GAME_H, DEPTH, PARCH, TOUCH } from '../config.js';
import { woodPanel } from './panels.js';
import { ORACLE_BY_ID } from '../core/oracle.js';
import { optionArtSlug } from '../core/packs.js';
import { personalize } from './rewards.js';
// THE HOVER REMOVAL (JC, 2026-08-11). `hoverInfo` binds nothing on a finger;
// `tapInfo` is the finger's replacement — tap to open a persistent panel, tap
// again or tap away to put it back. The fork stays VISIBLE at the call site.
import { hoverInfo } from './touch.js';
import { tapInfo } from './choicebox.js';

/** The Oracle pack's own violet — the wrapper, the shelf and now the chip. */
export const ORACLE_ACCENT = 0x9a5cff;

/**
 * THE SQUARE OF ART A CHIP WEARS.
 *
 * The packcard family is one normalized 520x768 canvas (see rewards.js), laid
 * out identically for all twenty: gold filigree frame, a painted scene inside
 * it, and the option's NAME struck across a banner at the bottom. A 46px chip
 * showing the whole card would be 31px wide and would spend a third of itself
 * on a name too small to read, so the chip crops the ART WINDOW instead — the
 * square inside the frame, above the banner — and lets the tooltip carry the
 * name.
 */
const FACE_W = 520, FACE_H = 768;
const CROP = { x: 90, y: 130, w: 340, h: 340 };

/** The option that was taken, or null on a run that has not met her yet. */
export function oracleDef(id) {
  return (id && ORACLE_BY_ID[id]) || null;
}

/** Its painted face, if the texture is really in the cache. */
export function oracleFaceKey(scene, def) {
  if (!def) return null;
  const key = `packcard_oracle_${optionArtSlug(def)}`;
  return scene.textures.exists(key) ? key : null;
}

/**
 * THE SAME KEY, ASKED BY ID AND WITHOUT A SCENE — what the LOADER needs.
 *
 * The chip wears one of THE ORACLE's twenty painted cards for the whole run, and
 * those twenty are deferred art (core/lazyload.js): the shelf is fetched on
 * arrival at the first map and released the moment a future is taken. Exactly
 * one of them has to survive that release and be re-fetched by any scene entered
 * cold, and this is how MapScene and CombatScene name it.
 *
 * @param {?string} oracleId run.oracle
 * @returns {?string} the texture key, whether or not it is loaded
 */
export function oracleCardKey(oracleId) {
  const def = oracleId ? ORACLE_BY_ID[oracleId] : null;
  return def ? `packcard_oracle_${optionArtSlug(def)}` : null;
}

/** Whatever tip is open, gone. Safe on a scene that never opened one. */
export function hideOracleTip(scene) {
  if (scene?.oracleTip) {
    scene.oracleTip.destroy(true);
    scene.oracleTip = null;
  }
}

/**
 * The parchment panel the chip opens: her name, then the option's own rules.
 * Same idiom as CombatScene.showPstatTip and MapScene.showTip, and it hangs
 * BELOW the chip by default because both chips live in the top half of their
 * panel, where a tip that hung up would leave the frame.
 */
export function oracleTip(scene, def, x, y, { below = true, gap = 40, w = 384, depth = null } = {}) {
  const tip = scene.add.container(0, 0).setDepth(depth ?? DEPTH.overlay + 2);
  const title = scene.add.text(0, 0, `THE ORACLE · ${def.name.toUpperCase()}`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: PARCH.text,
    wordWrap: { width: w - 44 }, align: 'center',
  }).setOrigin(0.5, 0);
  const body = scene.add.text(0, title.height + 8, personalize(def.desc), {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
    wordWrap: { width: w - 44 }, align: 'center', lineSpacing: 2,
  }).setOrigin(0.5, 0);
  const h = title.height + 8 + body.height + 30;
  const parts = woodPanel(scene, 0, h / 2 - 8, w, h, { shadow: true, accent: ORACLE_ACCENT });
  tip.add([parts.shadow, parts.panel, parts.line, title, body]);
  tip.setPosition(
    Phaser.Math.Clamp(x, w / 2 + 10, GAME_W - w / 2 - 10),
    Phaser.Math.Clamp(below ? y + gap : y - gap - h, 12, GAME_H - h - 12),
  );
  return tip;
}

/**
 * The chip itself, centred on (x, y). Returns the CONTAINER (so setAlpha,
 * tweens and a parent container all behave) or NULL when the run has no Oracle
 * receipt — which is the whole render guard: every caller can say
 * `this.oracleChip = addOracleChip(...)` unconditionally.
 *
 * @param {Phaser.Scene} scene
 * @param {number} x  chip centre
 * @param {number} y  chip centre
 * @param {string|null} id  run.oracle
 */
export function addOracleChip(scene, x, y, id, { size = 46, depth = null, below = true } = {}) {
  const def = oracleDef(id);
  if (!def) return null;

  const chip = scene.add.container(x, y);
  if (depth != null) chip.setDepth(depth);
  const half = size / 2;
  const R = 7;

  // 1. THE CONTACT POOL. Without it the chip is printed on the parchment.
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x120a06, 0.42);
  shadow.fillRoundedRect(-half + 4, -half + 6, size, size, R);
  chip.add(shadow);

  // 2. THE SOCKET, so a dark painting still reads as a chip and not a hole.
  const back = scene.add.graphics();
  back.fillStyle(0x241505, 1);
  back.fillRoundedRect(-half, -half, size, size, R);
  chip.add(back);

  // 3. HER FACE. setCrop draws the visible slice where it falls inside the
  // FULL frame, so the image is re-centred on the crop's own middle rather
  // than on the card's.
  const key = oracleFaceKey(scene, def);
  if (key) {
    const s = size / CROP.w;
    const face = scene.add.image(0, 0, key).setScale(s);
    face.setCrop(CROP.x, CROP.y, CROP.w, CROP.h);
    face.x = -((CROP.x + CROP.w / 2) - FACE_W / 2) * s;
    face.y = -((CROP.y + CROP.h / 2) - FACE_H / 2) * s;
    chip.add(face);
  } else {
    // The wrapper, then the plainest glyph in the atlas. A chip that renders
    // nothing at all would read as a bug rather than as a blessing.
    const fbKey = scene.textures.exists('pack_oracle') ? 'pack_oracle' : 'icon_star';
    const fb = scene.add.image(0, 0, fbKey);
    fb.setScale((size - 8) / Math.max(fb.width, fb.height));
    chip.add(fb);
  }

  // 4. THE FRAME, in her own violet, over a thin dark keyline.
  const frame = scene.add.graphics();
  frame.lineStyle(4, ORACLE_ACCENT, 0.95);
  frame.strokeRoundedRect(-half + 1, -half + 1, size - 2, size - 2, R);
  frame.lineStyle(2, 0x2a1808, 0.85);
  frame.strokeRoundedRect(-half - 1, -half - 1, size + 2, size + 2, R + 1);
  chip.add(frame);

  // A 46px target is small to aim at with a finger, so the chip carries a
  // generous invisible hit box — the same courtesy the debuff pips get.
  const hitW = size + 16;
  const hit = scene.add.rectangle(0, 0, hitW, hitW, 0x000000, 0)
    .setInteractive({ useHandCursor: true });
  chip.add(hit);
  chip.hitRect = { w: hitW, h: hitW };
  chip.chipSize = size;            // the INKED footprint, for layout audits
  chip.oracleId = def.id;

  // ------------------------------------------------------------------
  // WHAT FUTURE DID I BUY? — and, since 2026-08-11, how a finger asks.
  //
  // This chip is the ONLY surface in the game that will tell you which of the
  // Oracle's twenty permanent modifiers is riding your run, and until now it
  // told you on HOVER and on nothing else. The 08-04 model reached that hover
  // by synthesising a `pointerover` under a long press; that synthesis is gone
  // (it was half of the double-description bug), so without a replacement the
  // receipt would simply be unreadable on a phone — which is the one build the
  // chip was drawn for in the first place.
  //
  // The two paths print the SAME two strings from the same table: the option's
  // name and `ORACLE_BY_ID[id].desc` through personalize(), which is the string
  // her pack shelf printed when the choice was made. A retune moves both.
  //
  // MOUNTED TWICE, and this binding is why that costs nothing: the combat
  // sidebar and the map HUD both call addOracleChip, so both get the fork.
  // ------------------------------------------------------------------
  if (TOUCH) {
    tapInfo(scene, hit, {
      key: `oracle:${def.id}`,
      // A FUNCTION, and it reads the WORLD matrix: the chip is a child of a
      // sidebar container in one scene and of the HUD in the other, so its
      // (x, y) arguments are local coordinates that mean two different things.
      anchor: () => {
        const m = hit.getWorldTransformMatrix();
        return { x: m.tx, y: m.ty, w: hitW, h: hitW };
      },
      title: `THE ORACLE  ·  ${def.name.toUpperCase()}`,
      body: () => personalize(def.desc),
      accent: ORACLE_ACCENT,
    });
  } else {
    hoverInfo(hit, () => {
      hideOracleTip(scene);
      scene.oracleTip = oracleTip(scene, def, x, y, { below, gap: half + 18 });
    }, () => hideOracleTip(scene));
  }
  chip.once('destroy', () => hideOracleTip(scene));
  return chip;
}
