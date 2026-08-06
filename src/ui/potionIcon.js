/**
 * @file potionIcon.js
 * Potion icon helper — uses Caleb's art (`pot_<id>` texture, loaded from
 * assets/icons/potions/<id>.png when it lands) and falls back to a drawn
 * chibi bottle tinted with the potion's liquid color until then. Same
 * philosophy as addArtifactIcon's fallback glyphs.
 */

/**
 * THE POTION MAT (Caleb, 2026-07-30) — a stitched-parchment strip with gold
 * corner caps and three worn circular spots, one per belt slot. It replaces
 * the old slot-box column in BOTH scenes.
 *
 * Geometry measured off the source art programmatically (the worn circles read
 * ~4 luminance under a 60px blur of the parchment; run-detection over that
 * high-pass gave spot centres 257 / 630 / 1003 px and a row centre of 222 px
 * inside the 1282x446 alpha crop). Everything below is expressed as a fraction
 * of the mat's DISPLAY width so a scene only has to pick `w`.
 */
export const POTION_MAT = {
  aspect: 267 / 768,                    // shipped texture is 768x267
  spotFX: [0.2005, 0.4914, 0.7824],     // spot centres, fraction of mat width
  spotFY: 0.4978,                       // spot row centre, fraction of mat height
  spotRF: 0.1057,                       // spot radius, fraction of mat width
};

/**
 * Screen positions of the three worn spots for a mat centred at (cx, cy).
 * The art has exactly MAX_POTIONS (3) spots — the mat IS the belt, so the two
 * move together if the belt ever grows.
 */
export function potionSpots(cx, cy, w) {
  const h = w * POTION_MAT.aspect;
  const y = cy + (POTION_MAT.spotFY - 0.5) * h;
  return POTION_MAT.spotFX.map(fx => ({ x: cx + (fx - 0.5) * w, y, r: w * POTION_MAT.spotRF }));
}

/** The one true drop-shadow offset/opacity for a potion sitting on the mat. */
export const POTION_SHADOW = { dx: 5, dy: 7, alpha: 0.5, tint: 0x120a06 };
/** ...and for the MAT itself, wherever a scene hangs one (combat, map, shop). */
export const MAT_SHADOW = { dx: 6, dy: 8, alpha: 0.42 };

/** The drawn-flask fallback, for when Caleb's `pot_<id>` has not landed. */
function drawnFlask(scene, ox, oy, def, size) {
  const c = scene.add.container(ox, oy);
  const g = scene.add.graphics();
  g.fillStyle(0x8a5a30, 1);                       // cork
  g.fillRoundedRect(-9, -46, 18, 13, 3);
  g.lineStyle(3, 0x241505, 1);
  g.strokeRoundedRect(-9, -46, 18, 13, 3);
  g.fillStyle(0xbfd8e0, 0.45);                    // neck
  g.fillRect(-8, -34, 16, 12);
  g.fillStyle(0xbfd8e0, 0.30);                    // glass body
  g.fillCircle(0, 0, 28);
  g.fillStyle(def.tint ?? 0x60d040, 0.95);        // the potion's identity colour
  g.fillCircle(0, 5, 22);
  g.fillStyle(0xffffff, 0.5);                     // shine
  g.fillCircle(-9, -9, 5);
  g.lineStyle(4, 0x241505, 1);                    // outline
  g.strokeCircle(0, 0, 28);
  g.strokeRect(-8, -34, 16, 12);
  c.add(g);
  c.setScale(size / 96);
  c.setSize(64, 96);                              // image-ish bounds for callers
  return c;
}

/** The same silhouette, in one flat colour — this is the drop shadow's body. */
function flaskSilhouette(scene, ox, oy, size) {
  const c = scene.add.container(ox, oy);
  const g = scene.add.graphics();
  g.fillStyle(POTION_SHADOW.tint, 1);
  g.fillRoundedRect(-11, -48, 22, 17, 3);         // cork
  g.fillRect(-10, -36, 20, 16);                   // neck
  g.fillCircle(0, 0, 30);                         // body
  c.add(g);
  c.setScale(size / 96);
  return c;
}

/** The icon's own body at a local offset: Caleb's art if it exists, else drawn. */
function potionBody(scene, ox, oy, def, size) {
  const key = 'pot_' + def.id;
  if (!scene.textures.exists(key)) return drawnFlask(scene, ox, oy, def, size);
  const img = scene.add.image(ox, oy, key);
  img.setScale(size / Math.max(img.width, img.height));
  return img;
}

/** ...and its shadow: setTintFill flattens a texture to one colour outright. */
function potionShadowBody(scene, ox, oy, def, size) {
  const key = 'pot_' + def.id;
  if (!scene.textures.exists(key)) return flaskSilhouette(scene, ox, oy, size);
  const img = scene.add.image(ox, oy, key);
  img.setScale(size / Math.max(img.width, img.height));
  img.setTintFill(POTION_SHADOW.tint);
  return img;
}

/**
 * A potion icon on the mat: Caleb's art (`pot_<id>`) if it has landed, the drawn
 * flask if it has not, and always a drop shadow beneath it (2026-08-01) so a
 * potion reads as an OBJECT SITTING ON the mat rather than a sticker printed on
 * it. You get back the CONTAINER holding both — setAlpha, setScale and tweens
 * all behave, and the shadow travels with it.
 *
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {{id:string, tint:number}} def - potion def (core/potions.js)
 * @param {number} size - target max dimension in px
 * @returns {Phaser.GameObjects.Container}
 */
export function addPotionIcon(scene, x, y, def, size = 96) {
  const wrap = scene.add.container(x, y);
  const sh = potionShadowBody(scene, POTION_SHADOW.dx, POTION_SHADOW.dy, def, size);
  sh.setAlpha(POTION_SHADOW.alpha);
  wrap.add(sh);
  wrap.add(potionBody(scene, 0, 0, def, size));
  wrap.setSize(size, size);
  return wrap;
}

/**
 * setInteractive for a SHOP SPOT icon — a relic Image from addArtifactIcon, or
 * a potion CONTAINER from addPotionIcon. A container has no texture for Phaser
 * to derive a hit area from, so it needs an explicit rectangle.
 *
 * That rectangle is `(0, 0, size, size)` and NOT centred on the origin, which
 * looks wrong and is not: Phaser's pointWithinHitArea adds the object's
 * displayOrigin to the local point before testing, and a Container reports a
 * displayOrigin of half its size. A "centred" (-size/2 …) rect therefore puts
 * the icon's own centre on the rect's far CORNER, and everything but a
 * pixel-perfect bullseye misses. Ask how this was found.
 */
export function makePotionIconInteractive(icon, size) {
  if (icon.texture) {
    icon.setInteractive({ useHandCursor: true });
  } else {
    icon.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, size, size),
      Phaser.Geom.Rectangle.Contains,
    );
    if (icon.input) icon.input.cursor = 'pointer';
  }
  return icon;
}
