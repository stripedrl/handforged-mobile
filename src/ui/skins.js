/**
 * @file skins.js (ui)
 * THE SKINS MENU — fifty models, in sections BY CHARACTER, reachable from the
 * title screen and from character select.
 *
 * Built as an overlay on whatever scene asked for it (the same shape as the
 * trophy shelf next door), so it costs no scene, keeps the tavern behind it and
 * closes with a destroy().
 *
 * THREE THINGS THE PATCH ASKED FOR, AND WHERE THEY ARE
 *   · LOCKED IS SILHOUETTED. The model is drawn tint-filled in the RECORDS
 *     shelf's 0x1c1626 with the padlock on it, and the name is '???'. You can
 *     see the SHAPE of what you have not earned, which is the tease; you cannot
 *     see the paint.
 *   · HOVER SAYS WHY. Every tile — locked or not — writes to the DETAIL BAR at
 *     the foot of the panel: the skin's name, and either its flavour line or
 *     the exact thing you have to go and do. A bar rather than a floating tip
 *     because the requirement lines run long ("Beat THE DAUGHTERS OF DARKNESS
 *     with DEXTRA...") and a tip that size cannot be kept inside the panel at
 *     the edges of the grid. The bar is a fixed box with a word wrap, so no
 *     string in core/skins.js can ever overflow it.
 *   · ORIGINAL IS A TILE. Every hero's row starts with their shipped model, so
 *     taking a skin OFF is the same gesture as putting one on, and there is no
 *     hidden "unequip" anywhere.
 */

import { GAME_W, GAME_H, DEPTH, PARCH, CHARACTERS, SUIT_COLORS } from '../config.js';
import { woodPanel } from './panels.js';
import { legible } from './juice.js';
import { sfx } from '../core/sfx.js';
import { kineticScroll } from './kinetic.js';
import {
  SKINS, skinSections, skinTexture, isSkinUnlocked, skinRequirement, skinEarnedLine,
  skinTally, equippedSkin, equipSkin,
} from '../core/skins.js';
// DEFERRED ART (core/lazyload.js). The wardrobe is the single densest screen in
// the game: fifty 900x850 models, 146 MB decoded, for a shelf you open to look
// at. It is also the ONE screen where a texture landing late costs nothing, so
// this is the one place the design uses POP-IN rather than a gate — see below.
import { ensure, evict, skinShelf, skinBundle } from '../core/lazyload.js';

const GOLD_TINT = 0xffd23e;
const GOLD = '#ffd23e';

/**
 * THE SKINS MENU.
 * @param {Phaser.Scene} scene
 * @param {{ onEquip?: (chrId: string, skinId: ?string) => void }} [opts]
 *        `onEquip` lets the character-select screen repaint the card underneath
 *        the moment a skin is chosen, instead of on the next visit.
 */
export function openSkins(scene, opts = {}) {
  if (scene.__skinsOpen) return null;
  scene.__skinsOpen = true;

  /**
   * THE WARDROBE'S OWN LOAD, AND WHY IT IS A POP-IN.
   *
   * Every other deferred load point in the game waits, because everywhere else a
   * missing texture is a missing FACT — a blank map board, a fight against
   * invisible bodies. Here it is a thumbnail on a shelf you are browsing: the
   * tile draws the hero's shipped model in the meantime (makeTile has fallen
   * back that way since the day a skin PNG could 404), the paint arrives a beat
   * later, and nobody waits for a wardrobe.
   *
   * A GATE WOULD ALSO BE THE WRONG COST. Fifty models is 146 MB and the browser
   * runs six requests at a time, so a gate would hold a black veil over the
   * whole menu for the length of the slowest one. Pop-in fills the grid from the
   * top down, which is the order it is read in.
   *
   * ...AND IT IS GIVEN BACK ON CLOSE. See the `close` path: everything but the
   * five models actually being WORN is evicted when the panel goes away, so the
   * shelf costs its 146 MB for as long as it is on screen and nothing after.
   */
  ensure(scene, skinShelf());

  const PANEL_W = 1300, PANEL_H = 900;
  const cx = GAME_W / 2, cy = GAME_H / 2;
  const ov = scene.add.container(0, 0).setDepth(DEPTH.overlay + 6);
  const dim = scene.add.rectangle(cx, cy, GAME_W, GAME_H, 0x14101c, 0.82).setInteractive();
  ov.add(dim);
  const parts = woodPanel(scene, cx, cy, PANEL_W, PANEL_H, { accent: GOLD_TINT });
  ov.add([parts.shadow, parts.panel, parts.line]);

  const tally = skinTally();
  ov.add(scene.add.text(cx, cy - PANEL_H / 2 + 50, 'SKINS', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '46px', color: PARCH.text,
  }).setOrigin(0.5));
  const tallyText = scene.add.text(cx, cy - PANEL_H / 2 + 90, `${tally.unlocked} of ${tally.total} unlocked`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.accent,
  }).setOrigin(0.5);
  ov.add(tallyText);

  // --- the scrolling window (a geometry mask, as on the trophy shelf) ------
  // VIEW_H stops 196 short of the panel's bottom, not 172: the DETAIL BAR sits
  // in that gap and the "scroll for more" line sits between the two. At 172 the
  // hint printed straight through the bar's top rail.
  const VIEW_X = cx - 600, VIEW_Y = cy - PANEL_H / 2 + 122;
  const VIEW_W = 1200, VIEW_H = PANEL_H - 122 - 196;
  const COLS = 6, TILE_W = 190, TILE_H = 208, GAP_X = 12, GAP_Y = 12;
  const HEAD_H = 44;

  const shelf = scene.add.container(0, 0);
  ov.add(shelf);
  const maskShape = scene.make.graphics({ x: 0, y: 0, add: false });
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
  shelf.setMask(maskShape.createGeometryMask());

  // --- THE DETAIL BAR (the hover answer) ----------------------------------
  // Fixed box, fixed wrap, two lines of room. Nothing about a skin's copy can
  // push it out of the panel, which is the point of it being a bar.
  const BAR_Y = cy + PANEL_H / 2 - 118;
  const bar = woodPanel(scene, cx, BAR_Y, VIEW_W, 92, { shadow: false, accent: 0x8a6a34 });
  ov.add([bar.panel, bar.line]);
  const barName = scene.add.text(cx, BAR_Y - 30, '', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.text,
  }).setOrigin(0.5);
  const barLine = scene.add.text(cx, BAR_Y - 12, '', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: PARCH.textDim,
    fontStyle: 'bold', align: 'center', wordWrap: { width: VIEW_W - 80 },
  }).setOrigin(0.5, 0);
  // THE THIRD LINE (JC, 2026-08-04): what you actually DID to earn this one.
  // Its own object rather than a second sentence on barLine, because it is a
  // different KIND of thing — the flavour is the skin talking, this is the
  // record talking — and the parchment accent is what says so at a glance.
  const barEarned = scene.add.text(cx, BAR_Y + 14, '', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.accent,
    fontStyle: 'bold', align: 'center', wordWrap: { width: VIEW_W - 80 },
  }).setOrigin(0.5, 0);
  ov.add(barName); ov.add(barLine); ov.add(barEarned);

  const REST = 'Hover a skin to read it. Click one to wear it.';
  const showDetail = (name, line, locked, earned = '') => {
    barName.setText(name).setColor(locked ? '#8a78a0' : PARCH.text);
    barLine.setText(line).setColor(locked ? '#a3541c' : PARCH.textDim);
    barEarned.setText(earned);
    // Two lines centre themselves around the bar; one sits where two would
    // start, so a skin with no record line never leaves a hole under its blurb.
    barLine.setY(earned ? BAR_Y - 12 : BAR_Y - 4);
  };
  const clearDetail = () => showDetail('', REST, false);

  // --- the grid -----------------------------------------------------------
  const tiles = [];
  let y = VIEW_Y;

  for (const section of skinSections()) {
    const got = skinTally(section.chrId);
    const head = scene.add.container(VIEW_X, y + HEAD_H / 2);
    head.add(scene.add.rectangle(0, 19, VIEW_W, 2, GOLD_TINT, 0.35).setOrigin(0, 0.5));
    // The section head sits gold-on-cream too. It keeps the colour, because a
    // hero's name heading its own shelf wants to read as a banner, but it takes
    // the full treatment rather than a bare outline: the shadow is what pulls a
    // pale glyph off a pale panel when the stroke alone is not enough.
    head.add(legible(scene.add.text(2, -2, section.chr.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: GOLD,
    })).setOrigin(0, 0.5));
    head.add(scene.add.text(VIEW_W - 2, 0, `${got.unlocked} / ${got.total}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: PARCH.textDim,
    }).setOrigin(1, 0.5));
    shelf.add(head);
    y += HEAD_H + 4;

    // ORIGINAL first, then the ten. 11 tiles = two rows of six with one gap.
    const entries = [null, ...section.skins];
    entries.forEach((skin, i) => {
      const col = i % COLS, row = (i / COLS) | 0;
      const tx = VIEW_X + TILE_W / 2 + col * (TILE_W + GAP_X);
      const ty = y + TILE_H / 2 + row * (TILE_H + GAP_Y);
      tiles.push(makeTile(scene, shelf, tx, ty, TILE_W, TILE_H, section.chrId, skin, {
        showDetail, clearDetail, refresh: () => refresh(), opts,
      }));
    });
    y += Math.ceil(entries.length / COLS) * (TILE_H + GAP_Y) + 10;
  }

  const contentH = Math.max(0, y - VIEW_Y);
  const maxScroll = Math.max(0, contentH - VIEW_H);
  // Kinetic (2026-08-04): flicks glide, edges rubber-band. The helper owns the
  // physics; this shelf just forwards its gestures and positions itself.
  const kin = kineticScroll(scene, { max: maxScroll, apply: (v) => { shelf.y = -v; } });
  const setScroll = (v) => kin.set(v);

  /** Repaint every tile's state after an equip (one wardrobe, many tiles). */
  const refresh = () => {
    for (const t of tiles) t.refresh();
    const now = skinTally();
    tallyText.setText(`${now.unlocked} of ${now.total} unlocked`);
  };
  refresh();
  clearDetail();

  const onWheel = (_p, _o, _dx, dy) => kin.wheel(dy);
  scene.input.on('wheel', onWheel);
  let dragFrom = null;
  dim.on('pointerdown', (p) => { dragFrom = { y: p.y }; kin.grab(p.y); });
  const onMove = (p) => { if (dragFrom && p.isDown) kin.move(p.y); };
  const onUp = () => kin.release();
  scene.input.on('pointermove', onMove);
  scene.input.on('pointerup', onUp);

  if (maxScroll > 0) {
    ov.add(scene.add.text(cx, VIEW_Y + VIEW_H + 14, 'scroll for more', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0.5));
  }

  const close = () => {
    scene.__skinsOpen = false;
    scene.input.off('wheel', onWheel);
    scene.input.off('pointermove', onMove);
    scene.input.off('pointerup', onUp);
    kin.destroy();
    maskShape.destroy();
    window.__hfSkins = null;
    ov.destroy(true);
    /**
     * GIVE THE WARDROBE BACK. The fifty models were fetched to be LOOKED at;
     * the moment the panel is gone the only ones anything will draw are the
     * five being worn (the select card, the arena, the HUD portrait). Keeping
     * the other forty-five would make browsing the shelf a permanent 146 MB
     * tax on the session, which is the exact shape of the bug this whole
     * workstream exists to remove.
     *
     * `evict` refuses anything still in flight, so a close taken mid-fetch
     * leaves those keys alone and the next open finds them already there.
     */
    const worn = new Set(Object.keys(CHARACTERS).flatMap(id => skinBundle(equippedSkin(id))));
    evict(scene, skinShelf().filter(k => !worn.has(k)));
  };
  dim.on('pointerup', (p) => {
    // ONLY a click that STARTED on the dimmer may close it. The overlay is
    // created on the SKINS button's pointerdown, so without this guard that
    // same gesture's pointerup lands on a dimmer that did not exist when the
    // press began, reads as "clicked outside", and shuts the menu the instant
    // you let go. That is the "it disappears unless I keep moving toward it"
    // bug: releasing anywhere but over the panel closed it immediately.
    if (!dragFrom) return;
    const moved = Math.abs(p.y - dragFrom.y);
    const outside = p.x < cx - PANEL_W / 2 || p.x > cx + PANEL_W / 2
      || p.y < cy - PANEL_H / 2 || p.y > cy + PANEL_H / 2;
    dragFrom = null;
    if (moved < 6 && outside) close();
  });

  const btn = scene.add.image(cx, cy + PANEL_H / 2 - 46, 'btn_yellow')
    .setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
  ov.add(btn);
  ov.add(scene.add.text(cx, cy + PANEL_H / 2 - 50, 'CLOSE', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#5b3a00',
  }).setOrigin(0.5));
  btn.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.7 }); close(); });

  // Verification hook for tools/verify_skins.py: the menu as plain data.
  window.__hfSkins = {
    tally: () => skinTally(),
    tiles: () => SKINS.map(s => ({
      id: s.id, chr: s.chr, name: s.name,
      unlocked: isSkinUnlocked(s.id),
      equipped: equippedSkin(s.chr) === s.id,
      requirement: skinRequirement(s.id),
    })),
    sections: () => skinSections().map(s => ({ chrId: s.chrId, ids: s.skins.map(k => k.id) })),
    equipped: () => Object.fromEntries(Object.keys(CHARACTERS).map(id => [id, equippedSkin(id)])),
    at: (id) => {
      const t = tiles.find(k => k.skinId === id);
      return t ? { x: Math.round(t.x), y: Math.round(t.y + shelf.y) } : null;
    },
    hover: (id) => {
      tiles.find(k => k.skinId === id)?.hover();
      return `${barName.text} | ${barLine.text} | ${barEarned.text}`;
    },
    detail: () => ({ name: barName.text, line: barLine.text, earned: barEarned.text }),
    equip: (chrId, skinId) => { const ok = equipSkin(chrId, skinId); refresh(); opts.onEquip?.(chrId, skinId); return ok; },
    scrollable: maxScroll > 0,
    setScroll,
    close,
  };
  return ov;
}

/**
 * ONE TILE. `skin === null` is the hero's shipped model, which is always
 * available and is how a skin comes back off.
 */
function makeTile(scene, shelf, x, y, w, h, chrId, skin, { showDetail, clearDetail, refresh, opts }) {
  const chr = CHARACTERS[chrId];
  const tile = scene.add.container(x, y);
  shelf.add(tile);

  const accent = SUIT_COLORS[chr.suit] ?? GOLD_TINT;
  const parts = woodPanel(scene, 0, 0, w, h, { shadow: false, accent });
  tile.add([parts.panel, parts.line]);

  const texKey = skin ? skinTexture(skin.id) : chr.sprite;
  // A skin whose PNG failed to load must not draw a green box in the middle of
  // the wardrobe: it falls back to the hero's own model, exactly as the arena
  // does (core/skins.js heroTextureFor).
  const drawKey = scene.textures.exists(texKey) ? texKey : chr.sprite;
  const art = scene.add.image(0, -18, drawKey);
  // Fit inside the tile's art well rather than trusting one scale: every source
  // is the same 900x850 canvas, so this is one number for all 51 tiles, but
  // reading it off the texture keeps it honest if a canvas ever changes.
  const fit = () => art.setScale(Math.min(150 / art.width, 132 / art.height));
  fit();
  tile.add(art);

  /**
   * THE POP-IN. The shelf's own ensure() is filling the cache from the top of
   * the grid down (openSkins), and `addtexture-<key>` is the event the texture
   * manager fires when one lands — the same signal CombatScene uses to swap in a
   * boss arena that outran its fight.
   *
   * The listener is armed only for a tile that is CURRENTLY standing in for its
   * skin, is removed the instant it fires, and dies with the tile either way, so
   * a shelf opened and closed fifty times leaves nothing on the manager. `apply`
   * is re-run rather than the tint being poked directly, because a locked tile's
   * paint is a tint-FILL over the same image and would otherwise arrive
   * unsilhouetted — the whole point of a locked tile is that you see the shape
   * and not the paint.
   */
  let onLand = null;
  if (skin && drawKey !== texKey) {
    onLand = () => { art.setTexture(texKey); fit(); tile.__apply?.(); };
    scene.textures.once('addtexture-' + texKey, onLand);
    tile.once('destroy', () => scene.textures.off('addtexture-' + texKey, onLand));
  }

  const lock = scene.add.image(0, 22, 'icon_lock').setScale(0.62).setVisible(false);
  tile.add(lock);

  const nameText = scene.add.text(0, h / 2 - 34, '', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '16px', color: PARCH.text,
    align: 'center', wordWrap: { width: w - 18 }, lineSpacing: -2,
  }).setOrigin(0.5);
  tile.add(nameText);

  // The EQUIPPED flash: a gold ring, not a moving badge, so the grid never
  // reflows when the wardrobe changes.
  const ring = scene.add.nineslice(0, 0, 'panel_line', 0, w + 12, h + 12, 34, 34, 34, 34)
    .setTint(GOLD_TINT).setAlpha(0);
  tile.add(ring);

  const state = () => ({
    open: skin ? isSkinUnlocked(skin.id) : true,
    worn: equippedSkin(chrId) === (skin ? skin.id : null),
  });

  const hover = () => {
    const { open } = state();
    // "LOCKED. <the ask>", with a full stop and not an em dash: this game does
    // not print em dashes anywhere a player can read one (tests/copy.test.js).
    if (skin && !open) showDetail('???', `LOCKED. ${skinRequirement(skin.id)}`, true);
    // UNLOCKED: the name, the flavour, and then the RECORD — what you did to
    // put it in the wardrobe. A skin is the same kind of object as a trophy and
    // it was the one shelf that never said what it was a record of.
    else if (skin) showDetail(skin.name, skin.blurb, false, skinEarnedLine(skin.id));
    else showDetail(`${chr.name}  ·  ORIGINAL`, 'The model this hero was forged in.', false);
  };

  parts.panel.setInteractive({ useHandCursor: true });
  parts.panel.on('pointerover', () => {
    sfx(scene, 'card_hover', { volume: 0.3, jitter: 0.08 });
    hover();
    scene.tweens.add({ targets: tile, scale: 1.05, duration: 120, ease: 'Sine.easeOut' });
  });
  parts.panel.on('pointerout', () => {
    clearDetail();
    scene.tweens.add({ targets: tile, scale: 1, duration: 120 });
  });
  parts.panel.on('pointerdown', () => {
    const { open } = state();
    if (!open) { sfx(scene, 'button', { volume: 0.4, rate: 0.8 }); return; }
    equipSkin(chrId, skin ? skin.id : null);
    sfx(scene, 'menu_select', { volume: 0.6 });
    refresh();
    opts.onEquip?.(chrId, skin ? skin.id : null);
  });

  const apply = () => {
    const { open, worn } = state();
    art.clearTint();
    if (!open) {
      art.setTintFill(0x1c1626).setAlpha(0.9);
      parts.panel.setTint(0x2a2136);
      lock.setVisible(true);
      nameText.setText('???').setColor('#6b5a80');
    } else {
      art.setAlpha(1);
      parts.panel.clearTint();
      lock.setVisible(false);
      // WORN used to print GOLD on the tile's cream panel, which is about 1.3:1
      // and the one genuinely unreadable string in this menu. Gold is the wrong
      // COLOUR here rather than a colour needing a stroke, so it takes the
      // parchment accent instead: still visibly different from an unworn tile,
      // still warm, and legible. The gold RING around the tile is what actually
      // says "you are wearing this", and it says it without any text at all.
      nameText.setText(skin ? skin.name : 'ORIGINAL').setColor(worn ? PARCH.accent : PARCH.text);
    }
    ring.setAlpha(worn ? 1 : 0);
  };
  // The pop-in handler above re-runs the paint through this, so a locked tile
  // that has just received its model gets silhouetted rather than shown.
  tile.__apply = apply;

  return { x, y, skinId: skin ? skin.id : `${chrId}__original`, refresh: apply, hover };
}
