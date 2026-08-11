/**
 * @file mapPeek.js
 * THE MAP, READ-ONLY, FROM ANYWHERE (JC, 2026-08-10): "a MAP button available
 * at all times that opens a read-only view of the current act's map — the
 * board, node icons, trails, your position, the boss medallion — so players can
 * see what's ahead and plan. No travel from this view."
 *
 * WHY THIS IS NOT MapScene. Phaser scenes here are singletons with
 * restart-heavy lifecycles: MapScene.create() gates on a 30MB deferred art
 * bundle, rebuilds `run.map`-derived layout, re-arms kinetic scrolling and
 * re-publishes `window.__hf`. Launching it over a live fight would hand the
 * fight's input to a second scene and hand the map's dev hooks to a board
 * nobody is standing on. So this draws the board itself, out of `run.map`,
 * with the same textures — and the node icons are BOOT art (see
 * core/lazyload.js), so they are resident in every room in the game.
 *
 * IT FITS ON ONE SCREEN, which the real board does not: MapScene's chart is
 * 2100px tall and scrolls, this one is scaled to the viewport in one piece.
 * That is the whole point of a planning view — you are here to see the shape of
 * the act, not to walk it.
 *
 * NOTHING HERE IS CLICKABLE except CLOSE. There is no `tryEnter` in this file
 * and there must never be one.
 *
 * NODE_STYLE and FORGED_STYLE live here rather than in MapScene because both
 * boards read them and the alternative is a ui -> scene import (MapScene
 * already imports ui/rewards.js, which wants the MAP button, so that edge would
 * close a cycle). MapScene imports them back out of here.
 */

import { GAME_W, GAME_H, DEPTH, COLORS, MOBILE, SAFE } from '../config.js';
import { woodPanel } from './panels.js';
import { run, actOf } from '../core/run.js';
import { bossEntry } from '../core/acts.js';
// The layout and the leap arcs are the GENERATOR'S (see core/map.js): this file
// used to hold its own copy of both, which is two places for a leap to be drawn
// through a room it does not connect to. It now reads the same vetted answers
// the real board does, so the planning view and the board it plans agree.
import { reachable, mapLayout, leapBulge, edgeAt, edgePoints, edgeLength } from '../core/map.js';
import { sfx } from '../core/sfx.js';
import { tapBind } from './touch.js';

// Node icons are Caleb's painted set — big, disc-free, with cast shadows.
export const NODE_STYLE = {
  fight: { icon: 'map_battle', ring: 0xffd23e, label: 'Fight', r: 40 },
  elite: { icon: 'map_elite', ring: 0xff6a76, label: 'ELITE: the spoils always hold a relic', r: 50 },
  event: { icon: 'map_event', ring: 0xc9a2ff, label: 'Unknown...', r: 40 },
  rest: { icon: 'map_campfire', ring: 0xffb050, label: 'Rest Site', r: 42 },
  shop: { icon: 'map_merchant', ring: 0xffd23e, label: 'Merchant', r: 42 },
};

/**
 * THE FORGED ELITE (JC, PATCH 0803 §2), dressed in the Crimson Forge's language.
 *
 * The brief was blunt: "the map must make it obvious BEFORE the player commits",
 * and routing toward or around one has to be a real decision made off the board
 * alone. So a Forged node gets FOUR separate tells, on the theory that a player
 * who misses one will not miss all four:
 *
 *   1. it is BIGGER than the elite beside it (FORGED_R against elite's 50)
 *   2. it burns — an ember aura pulsing at nearly twice the speed of the
 *      ordinary elite's dull menace, in the mythic's red rather than its maroon
 *   3. it wears an ANVIL sigil pinned to its shoulder, which no other node has
 *   4. it is LABELLED. The word FORGED is printed under it, permanently, in
 *      ember on cream. Nothing else on the board carries a caption.
 */
export const FORGED_STYLE = {
  icon: 'map_elite', ring: 0xff8a2a, r: 68,
  label: 'FORGED ELITE',
  tint: 0xffb070,
  aura: 0xff3a10,
  caption: '#ffb04a',
};

/** The peek's own frame: the box the whole act is scaled down into. */
const VIEW = { top: 186, bottom: GAME_H - 118 };

/**
 * The act's chart in ONE screen: node positions in board space, plus the scale
 * that fits them into VIEW. Pure arithmetic over `map`, so a test can assert
 * the shape without a canvas.
 *
 * The positions themselves are `mapLayout`'s — the generator's own — and the
 * only thing left here is the fitting.
 */
export function peekLayout(map) {
  const { pos, contentH } = mapLayout(map);

  const ys = Object.values(pos).map(p => p.y);
  const xs = Object.values(pos).map(p => p.x);
  // Padding is measured in board units so the biggest icons (a FORGED elite's
  // 68px radius, the boss plate's caption) never clip at the frame's edge.
  const PAD_TOP = 150, PAD_BOTTOM = 90, PAD_X = 90;
  const top = Math.min(...ys) - PAD_TOP;
  const bottom = Math.max(...ys) + PAD_BOTTOM;
  const halfW = Math.max(...xs.map(Math.abs)) + PAD_X;
  const scale = Math.min((VIEW.bottom - VIEW.top) / (bottom - top), (GAME_W - 120) / (halfW * 2));
  return { pos, scale, top, bottom, halfW, contentH };
}

/**
 * The read-only board. Returns the overlay container.
 * `depth` follows the launching overlay, exactly like viewDeckButton's viewer.
 */
export function mapPeekOverlay(scene, { depth = null } = {}) {
  const map = run.map;
  const ov = scene.add.container(0, 0).setDepth(depth ?? DEPTH.overlay + 6);
  const dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.9).setInteractive();
  ov.add(dim);

  const act = actOf(run.actIndex);
  ov.add(scene.add.text(GAME_W / 2, 74, `ACT ${act?.numeral ?? ''}  ·  ${(act?.name ?? 'THE ROAD').toUpperCase()}`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '50px', color: COLORS.gold,
    stroke: '#241505', strokeThickness: 10,
  }).setOrigin(0.5));
  ov.add(scene.add.text(GAME_W / 2, 126, 'THE ROAD AHEAD  ·  you cannot travel from here', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '22px', color: '#d8c9a8', fontStyle: 'bold',
  }).setOrigin(0.5));

  if (!map?.nodes) {
    ov.add(scene.add.text(GAME_W / 2, GAME_H / 2, 'no act board yet', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: '#8a8078',
    }).setOrigin(0.5));
    closeChrome(scene, ov, dim);
    return ov;
  }

  const { pos, scale, top, bottom, halfW } = peekLayout(map);
  // The frame the chart is drawn inside: parchment, so the ink reads the same
  // way it does on a painted board without needing the board's 15MB texture
  // (which is deferred art and is NOT resident during a fight).
  const frameH = (bottom - top) * scale + 24;
  const frameW = halfW * 2 * scale + 24;
  const cy = (VIEW.top + VIEW.bottom) / 2;
  const parts = woodPanel(scene, GAME_W / 2, cy, Math.min(frameW, GAME_W - 60), frameH, { accent: 0x8a6a3c });
  ov.add([parts.shadow, parts.panel, parts.line]);

  const board = scene.add.container(GAME_W / 2, cy - ((top + bottom) / 2) * scale);
  board.setScale(scale);
  ov.add(board);
  /**
   * THE WORDS DO NOT SHRINK WITH THE CHART. The board is drawn at ~0.42 and
   * every icon on it is meant to come down with it — but a 28px caption at 0.42
   * is 12px on screen, which is where "YOU ARE HERE" turned into a smudge over
   * the hero's own head. The three labels printed INSIDE the board are sized in
   * board units so that they land at a fixed SCREEN size instead.
   */
  const sz = (px) => `${Math.round(px / scale)}px`;

  const open = reachable(map);
  const takenEdges = new Set();
  for (let i = 0; i < map.taken.length - 1; i++) takenEdges.add(`${map.taken[i]}>${map.taken[i + 1]}`);

  // --- the trails, in the same dotted ink the board draws ---------------
  for (const node of Object.values(map.nodes)) {
    const a = pos[node.id];
    for (const nextId of node.next) {
      const b = pos[nextId];
      if (!a || !b) continue;
      const taken = takenEdges.has(`${node.id}>${nextId}`);
      const live = map.currentId === node.id;
      const isLeap = node.leaps?.includes(nextId);
      // The generator's vetted arc, not a side picked off which half of the
      // board the trail starts in — see core/map.js leapBulge, and MapScene's
      // drawPaths for why the old ±74 drew a leap through the floor it skips.
      const bulge = isLeap ? (leapBulge(pos, node.id, nextId)?.bulge ?? 0) : 0;
      const arcLen = edgeLength(edgePoints(a, b, bulge, 24));
      const steps = Math.max(3, Math.round(arcLen / (isLeap ? 30 : 26)));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (isLeap && Math.abs(t - 0.5) * arcLen < 30) continue;   // gap for the chevron
        const q = edgeAt(a, b, bulge, t);
        board.add(scene.add.image(q.x, q.y, 'map_dot')
          .setTint(isLeap ? 0xffc94a : taken ? 0xb8862c : live ? 0x8a6a3c : 0x9a835e)
          .setAlpha(isLeap ? 0.92 : taken ? 0.95 : live ? 0.9 : 0.55)
          .setScale((isLeap ? 1.15 : taken || live ? 1.1 : 0.85) * 1.6));   // 1.6: the chart is shrunk, the ink is not
      }
      // ...and the chevron the real board pins to a leap's apex, so the planning
      // view answers "that one skips a floor" with the same mark.
      if (isLeap) {
        const apex = edgeAt(a, b, bulge, 0.5);
        board.add(scene.add.image(apex.x, apex.y, 'map_leap')
          .setRotation(Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2)
          .setAlpha(0.95).setScale(1.6));
      }
    }
  }

  // --- the nodes --------------------------------------------------------
  for (const node of Object.values(map.nodes)) {
    if (node.id === map.bossId) continue;
    const forged = node.type === 'elite' && !!node.forged;
    const style = forged ? FORGED_STYLE : (NODE_STYLE[node.type] ?? NODE_STYLE.fight);
    const p = pos[node.id];
    const g = scene.add.container(p.x, p.y);
    board.add(g);
    const r = style.r * (node.mythic ? 1.25 : 1);

    if (node.mythic || node.type === 'elite') {
      g.add(scene.add.image(0, 0, 'fx_glow_circle')
        .setTint(forged ? FORGED_STYLE.aura : node.mythic ? 0xe03040 : 0xa03040)
        .setScale(forged ? 1.75 : node.mythic ? 1.0 : 0.62)
        .setAlpha(node.visited ? 0.1 : forged ? 0.55 : 0.28)
        .setBlendMode(Phaser.BlendModes.ADD));
    }
    const icon = scene.add.image(0, 0, style.icon);
    if (node.mythic) icon.setTint(0xff5050);
    else if (forged) icon.setTint(FORGED_STYLE.tint);
    icon.setScale((r * 2.2) / Math.max(icon.width, icon.height));
    g.add(icon);

    const isCurrent = map.currentId === node.id;
    if (node.visited && !isCurrent) {
      g.setAlpha(0.32);
      icon.setTint(0x7a746c);
    } else if (open.includes(node.id)) {
      // The rooms you could walk into next keep their gold ring, so the peek
      // answers "where can I go from here" as well as "what is up there".
      const ring = scene.add.image(0, 0, 'node_ring').setTint(style.ring)
        .setDisplaySize(r * 2.5, r * 2.5);
      g.addAt(ring, 0);
      scene.tweens.add({
        targets: ring, displayWidth: r * 2.85, displayHeight: r * 2.85, alpha: 0.5,
        duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    } else if (!node.visited) {
      g.setAlpha(0.85);
    }
    if (forged) {
      g.add(scene.add.text(0, r + 30, 'FORGED', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: sz(19),
        color: FORGED_STYLE.caption, stroke: '#2a1206', strokeThickness: 7,
      }).setOrigin(0.5));
    }
    if (isCurrent) {
      const key = 'hero_icon_' + run.chrId;
      if (scene.textures.exists(key)) {
        const hero = scene.add.image(0, -r - 46, key);
        hero.setScale(96 / Math.max(hero.width, hero.height));
        g.add(hero);
      }
      // Clear of the hero token above the node (centred at -(r+46), 96 board
      // units tall), not merely clear of the node itself.
      g.add(scene.add.text(0, -r - 172, 'YOU ARE HERE', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: sz(21),
        color: '#ffd23e', stroke: '#241505', strokeThickness: 7,
      }).setOrigin(0.5));
    }
  }

  // --- the boss at the summit ------------------------------------------
  const bp = pos[map.bossId];
  const boss = bossEntry(act, map.bossPick);
  const bg = scene.add.container(bp.x, bp.y);
  board.add(bg);
  bg.add(scene.add.image(0, 10, 'fx_glow_circle').setTint(0xc03040)
    .setScale(1.4).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD));
  // The boss medallion is DEFERRED art (core/lazyload.js fetches it with the
  // act bundle), so a fight three rooms deep may not be holding it. The elite
  // skull, reddened, stands in — the NAME under it is the part that plans a run.
  const bossKey = boss?.icon && scene.textures.exists(boss.icon) ? boss.icon : NODE_STYLE.elite.icon;
  const bimg = scene.add.image(0, 0, bossKey);
  if (bossKey !== boss?.icon) bimg.setTint(0xd03040);
  bimg.setScale(190 / Math.max(bimg.width, bimg.height));
  bg.add(bimg);
  bg.add(scene.add.text(0, 128, `☠  ${boss?.name ?? 'THE BOSS'}  ☠`, {
    fontFamily: 'Lilita One', resolution: 2,
    fontSize: sz((boss?.name?.length ?? 0) > 20 ? 22 : 28), color: '#ff6a76',
    stroke: '#241505', strokeThickness: 7,
  }).setOrigin(0.5));

  // --- the legend -------------------------------------------------------
  // Five rooms, named. A planning view that shows five painted icons and never
  // says which is the merchant is a picture, not a plan.
  const kinds = ['fight', 'elite', 'event', 'rest', 'shop'];
  const LEG_Y = GAME_H - 74;
  const step = 250;
  kinds.forEach((k, i) => {
    const x = GAME_W / 2 + (i - (kinds.length - 1) / 2) * step;
    const icon = scene.add.image(x - 54, LEG_Y, NODE_STYLE[k].icon);
    icon.setScale(40 / Math.max(icon.width, icon.height));
    ov.add(icon);
    ov.add(scene.add.text(x - 28, LEG_Y, LEGEND[k], {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: '#d8c9a8',
    }).setOrigin(0, 0.5));
  });

  closeChrome(scene, ov, dim);

  const hook = {
    open: true,
    act: run.actIndex,
    nodes: Object.values(map.nodes).map(n => ({
      id: n.id, type: n.type, row: n.row, visited: !!n.visited,
      forged: !!n.forged, mythic: !!n.mythic,
    })),
    currentId: map.currentId ?? null,
    reachable: [...open],
    boss: boss?.name ?? null,
    scale,
    close: () => ov.destroy(true),
  };
  window.__hfMapPeek = hook;
  ov.once('destroy', () => { if (window.__hfMapPeek === hook) window.__hfMapPeek = { open: false }; });
  return ov;
}

/** The five room names the legend prints. */
const LEGEND = {
  fight: 'FIGHT', elite: 'ELITE', event: 'UNKNOWN', rest: 'REST', shop: 'MERCHANT',
};

function closeChrome(scene, ov, dim) {
  // Off the bottom glass on touch, and a size class up with it: this plate used
  // to bottom out at GAME_H-2, which on a phone is under the home indicator.
  const cy = GAME_H - (MOBILE ? 46 + SAFE.y : 30);
  const w = MOBILE ? 300 : 240, h = MOBILE ? 68 : 56;
  const img = scene.add.image(GAME_W / 2, cy, 'btn_yellow')
    .setDisplaySize(w, h).setInteractive({ useHandCursor: true });
  const txt = scene.add.text(GAME_W / 2, cy - 3, 'CLOSE', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: MOBILE ? '30px' : '25px', color: '#5b3a00',
  }).setOrigin(0.5);
  ov.add([img, txt]);
  img.setData('hfLabel', 'CLOSE');
  const close = () => { sfx(scene, 'button', { volume: 0.7 }); ov.destroy(true); };
  tapBind(scene, img, close);
  dim.on('pointerdown', () => ov.destroy(true));
}

/**
 * "MAP" — the planning plate. Same idiom and same relative-depth trick as
 * viewDeckButton: it opens ABOVE whatever overlay launched it, and closing it
 * leaves that overlay's decision untouched.
 */
/**
 * MAP_PLATE — the plate's own size table. It was a pair of magic numbers shared
 * by both builds, which meant a 19px label on a 50px plate was the phone's
 * smallest labelled button (JC's 2026-08-10 readability pass). Touch gets a
 * thumb-sized one; desktop's numbers are the ones it has always had.
 *
 * EXPORTED (2026-08-11) because ui/rewards.js was carrying a hand-copied `mapW`
 * beside its own INFO_PLATE sizes, with a comment promising to keep the two in
 * step. A mirror that has to be remembered is a mirror that goes stale; the row
 * that plants this plate now reads the plate's own width.
 */
export const MAP_PLATE = {
  w: MOBILE ? 172 : 140,
  h: MOBILE ? 62 : 50,
  font: MOBILE ? 24 : 19,
};

export function viewMapButton(scene, ov, x = 332, y = GAME_H - 62, { depth = null } = {}) {
  const img = scene.add.image(x, y, 'btn_dark')
    .setDisplaySize(MAP_PLATE.w, MAP_PLATE.h).setInteractive({ useHandCursor: true });
  const txt = scene.add.text(x, y - 2, 'MAP', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_PLATE.font}px`, color: '#cfc8e8',
  }).setOrigin(0.5);
  ov.add([img, txt]);
  img.setData('hfLabel', 'MAP');
  img.on('pointerover', () => sfx(scene, 'menu_select', { volume: 0.25, jitter: 0.06 }));
  // ON RELEASE on touch (see ui/pointer.js): this plate opens a full-screen
  // overlay, and an overlay that opens on the PRESS hands the release to
  // whatever it just covered.
  tapBind(scene, img, () => {
    sfx(scene, 'button', { volume: 0.7 });
    mapPeekOverlay(scene, { depth: (ov.depth ?? DEPTH.overlay) + 6 });
  });
  return img;
}

/** Is there an act board worth peeking at right now? */
export function hasMapToPeek() {
  return !!run?.map?.nodes && !!Object.keys(run.map.nodes).length;
}
