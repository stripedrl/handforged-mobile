/**
 * @file achievements.js (ui)
 * THE TROPHY SHELF and the unlock toast.
 *
 * Two jobs, both scene-agnostic so the Title screen, the map and combat all get
 * the same treatment:
 *   fireAchievements(scene, event, ctx) — notes the event and toasts whatever
 *       it just earned. This is the ONLY thing a scene needs to call.
 *   openAchievements(scene)            — the scrollable shelf.
 *
 * ART: `ach_<id>` textures do not exist yet (see docs/REQUESTS_ACHIEVEMENT_ART.txt).
 * Until they land, an unlocked tile draws a gold medal with the trophy's initial
 * and a locked one gets the RECORDS-shelf treatment: a blacked-out silhouette
 * with the lock on it, '???' where the name goes, and the HINT instead of the
 * description.
 */

import { GAME_W, GAME_H, DEPTH, PARCH } from '../config.js';
import { woodPanel } from './panels.js';
import { legible, popMessage } from './juice.js';
import { sfx, sfxCapped } from '../core/sfx.js';
import {
  ACHIEVEMENTS, achievementTally, isAchievementUnlocked, noteEvent,
  achievementSections, achievementReward, gatesARelic,
  visibleAchievements, isAchievementHidden,
} from '../core/achievements.js';
// The two trophies that open a BOOSTER PACK. The gate itself lives in packs.js
// (PACK_GATES) and this is a UI module, so reading it here closes no cycle and
// keeps the mapping in exactly one place.
import { PACK_GATES, PACK_TYPES } from '../core/packs.js';
import { kineticScroll } from './kinetic.js';
import { exportProfile, importProfile } from '../core/progress.js';
import { ensure, achievementTiles } from '../core/lazyload.js';

const GOLD = '#ffd23e';
const GOLD_TINT = 0xffd23e;

/** The medal placeholder: Caleb's `ach_<id>` if it has landed, else a drawn disc. */
function achievementBadge(scene, x, y, def, size = 58) {
  const key = `ach_${def.id}`;
  if (scene.textures.exists(key)) {
    const img = scene.add.image(x, y, key);
    img.setScale(size / Math.max(img.width, img.height));
    return img;
  }
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  g.fillStyle(0xffd23e, 1);
  g.fillCircle(0, 0, 28);
  g.fillStyle(0xf0a020, 1);
  g.fillCircle(0, 4, 22);
  g.lineStyle(4, 0x241505, 1);
  g.strokeCircle(0, 0, 28);
  c.add(g);
  c.add(scene.add.text(0, 2, def.name.charAt(0).toUpperCase(), {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: '#5b3a00',
  }).setOrigin(0.5));
  c.setScale(size / 64);
  return c;
}

/**
 * THE TOAST'S GEOMETRY. One lane, high on the screen and BELOW the act banner,
 * clear of the arena (enemies sit from y~260 down) and clear of the cascade,
 * whose numbers rise around y 300-560. Every toast lands in the same place,
 * because that is what a queue means.
 */
const TOAST_Y = 150;
// 132 tall, not 104: a two-line description used to run straight off the bottom
// edge of the panel, and the line that says what you DID is the point. The five
// trophies that also unlock a RELIC carry a fourth line, so they get a taller
// panel rather than a fourth line hanging over the frame.
const TOAST_W = 660, TOAST_H = 132, TOAST_H_PRIZE = 164;
const TOAST_IN = 260, TOAST_HOLD = 2300, TOAST_OUT = 400;

/**
 * THE UNLOCK TOAST. The SECRET HAND discovery treatment (gold banner, warm
 * camera flash) because it is the same moment: the game telling you that
 * something you just did is remembered forever. The SOUND is its own, though,
 * and deliberately so, see the sfxCapped call below.
 *
 * IT IS A QUEUE, NOT A STACK (JC, 2026-08-02). A single hand can cross two
 * damage rungs and a mult rung at once, and three banners sliding down the
 * screen on top of each other over a live scoring cascade is noise, not a
 * reward. They line up in one lane and take their turn, ~3s each.
 *
 * It never touches input (nothing in the container is interactive) and never
 * blocks: the cascade, the payoff FX and the boss telegraph all run underneath
 * it while it sits there, because the queue is driven by tweens and timers and
 * nothing in the fight ever waits on it.
 */
export function achievementToast(scene, def) {
  if (!def || !scene?.add) return null;
  scene.__achToastQueue ??= [];
  scene.__achToastQueue.push(def);
  pumpToasts(scene);
  return scene.__achToastQueue.length;
}

/**
 * The lane is two plain scene fields on purpose: `__achToastQueue` (waiting) and
 * `__achToastBusy` (one is on screen). A verification run reads both straight
 * off the scene, which is how tools/verify_achievements_wave.py proves they
 * queue instead of stacking.
 */
function pumpToasts(scene) {
  if (scene.__achToastBusy) return;
  const def = scene.__achToastQueue?.shift();
  if (!def) return;
  scene.__achToastBusy = true;

  const done = () => {
    scene.__achToastBusy = false;
    // A scene that shut down mid-queue takes the queue with it: the next scene
    // is a different screen and owes the player nothing it did not earn there.
    if (scene.scene?.isActive?.() === false) { scene.__achToastQueue = []; return; }
    pumpToasts(scene);
  };

  // THE REWARD, said out loud. A gate nobody sees is not a gate, it is a bug
  // report waiting to happen.
  const prize = achievementReward(def.id);
  const h = prize ? TOAST_H_PRIZE : TOAST_H;
  // The panel grows DOWNWARD only: woodPanel centres on 0, so everything above
  // the extra line is lifted by half the growth and the lane's top edge, the
  // one thing the placement was chosen for, does not move.
  const dy = (TOAST_H - h) / 2;

  const box = scene.add.container(GAME_W / 2, TOAST_Y)
    .setDepth(DEPTH.overlay + 9).setAlpha(0);
  const parts = woodPanel(scene, 0, -dy, TOAST_W, h, { accent: GOLD_TINT });
  box.add([parts.shadow, parts.panel, parts.line]);
  box.add(achievementBadge(scene, -270, -dy, def, 62));
  // GOLD ON PARCHMENT (JC, 2026-08-02: "the achievement notification one lacks a
  // black border around it"). This line lands on the woodPanel's near-white top
  // bevel, where #ffd23e is about 1.2:1 and effectively invisible. The gold is
  // the right colour, it matches the toast's own accent ring, so it keeps the
  // gold and takes the outline the rest of the UI already wears.
  box.add(legible(scene.add.text(-218, -40, 'ACHIEVEMENT UNLOCKED', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: GOLD,
  }), { shadow: false }).setOrigin(0, 0.5));
  box.add(scene.add.text(-218, -10, def.name, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: PARCH.text,
  }).setOrigin(0, 0.5));
  box.add(scene.add.text(-218, 12, def.desc, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim,
    fontStyle: 'bold', wordWrap: { width: 460 },
  }).setOrigin(0, 0));
  if (prize) {
    box.add(legible(scene.add.text(-218, 42, `RELIC UNLOCKED: ${prize.name}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '18px', color: GOLD,
    }), { shadow: false }).setOrigin(0, 0));
  }

  // ITS OWN CHIME (JC, 2026-08-02), not the borrowed secret-hand sting. That
  // swap is the whole point of the mid-fight case: a trophy landing on top of a
  // scoring cascade must not sound like something the HAND just did, or the
  // player reads it as a scoring event and goes looking for a number.
  //
  // 0.75 against the mix: a notch under the 0.9-0.95 the LEGENDARY and MYTHICAL
  // reveals sit at (a relic appearing is still the bigger moment) and clearly
  // over the 0.5-0.6 band the per-card cascade ticks live in, so it reads as its
  // own event rather than part of the run of numbers underneath it.
  //
  // CAPPED: three trophies off one hand are one moment, not three. The queue's
  // own spacing means the cap only ever bites on a genuine pile-up.
  sfxCapped(scene, 'achievement', { volume: 0.75 }, 1200);
  // OPTIONAL CHAINING, because the flash is the least important thing here.
  // `cameras.main` is gone on a scene that has shut down but whose factory is
  // still answering, and this line threw straight through fireAchievements and
  // out of its CALLER: a trophy earned on the way into the merchant took
  // MapScene.runShop down with it and the player got no shop at all. A missing
  // camera costs a screen flash; it must never cost the screen.
  scene.cameras?.main?.flash(200, 110, 74, 18);
  box.setScale(0.86);
  scene.tweens.add({ targets: box, alpha: 1, scale: 1, duration: TOAST_IN, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: box, alpha: 0, y: TOAST_Y - 40, duration: TOAST_OUT, delay: TOAST_HOLD,
    onComplete: () => { box.destroy(true); done(); },
  });
}

/**
 * Note an event and celebrate anything it earned. Safe to call from any scene,
 * as often as you like: unlocking is idempotent, so only the FIRST time ever
 * produces a toast.
 * @returns {object[]} the achievement defs that were just earned
 */
export function fireAchievements(scene, event, ctx = {}) {
  const earned = noteEvent(event, ctx);
  for (const def of earned) achievementToast(scene, def);
  return earned;
}

/**
 * THE SHELF. Every achievement in the game, in order, locked ones included —
 * a locked tile is a silhouette showing '???' and its hint, an unlocked one
 * shows its name and what you did. Scrolls with the wheel or by dragging.
 */
export function openAchievements(scene) {
  if (scene.__achievementsOpen) return;
  scene.__achievementsOpen = true;
  /**
   * THE TILES, FETCHED HERE (2026-08-06, deferred loading). Not one of the
   * seventy-three has been painted yet, so this is seventy-three 404s that used
   * to happen on every BOOT and now happen once, on the one screen that draws
   * them — see the essay in core/lazyload.js.
   *
   * Fire-and-forget, because `achievementBadge` has fallen back to a drawn medal
   * since the shelf existed and a tile arriving a beat late is a tile fading in.
   * The day the art lands this becomes a pop-in worth having; today it is a
   * fifth of the boot, deleted.
   */
  ensure(scene, achievementTiles());

  const PANEL_W = 1240, PANEL_H = 800;
  const cx = GAME_W / 2, cy = GAME_H / 2;
  const ov = scene.add.container(0, 0).setDepth(DEPTH.overlay + 6);
  const dim = scene.add.rectangle(cx, cy, GAME_W, GAME_H, 0x14101c, 0.8).setInteractive();
  ov.add(dim);
  const parts = woodPanel(scene, cx, cy, PANEL_W, PANEL_H, { accent: GOLD_TINT });
  ov.add([parts.shadow, parts.panel, parts.line]);

  const tally = achievementTally();
  ov.add(scene.add.text(cx, cy - PANEL_H / 2 + 54, 'ACHIEVEMENTS', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '46px', color: PARCH.text,
  }).setOrigin(0.5));
  ov.add(scene.add.text(cx, cy - PANEL_H / 2 + 96, `${tally.unlocked} of ${tally.total} earned`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.accent,
  }).setOrigin(0.5));

  // --- the scrolling window --------------------------------------------
  // A geometry mask, not a crop: the tiles are containers of text and graphics
  // and only a mask hides them cleanly at the window's edge.
  const VIEW_X = cx - 560, VIEW_Y = cy - PANEL_H / 2 + 130;
  const VIEW_W = 1120, VIEW_H = PANEL_H - 240;
  const COLS = 3, TILE_W = 360, TILE_H = 168, GAP_X = 20, GAP_Y = 16;

  const shelf = scene.add.container(0, 0);
  ov.add(shelf);
  const maskShape = scene.make.graphics({ x: 0, y: 0, add: false });
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
  shelf.setMask(maskShape.createGeometryMask());

  // --- the layout ------------------------------------------------------
  // Fifty tiles in one undifferentiated grid is a list, not a shelf. The
  // sections come out of the data (achievementSections), and inside one, a
  // LADDER draws as a single full-width progression row rather than four
  // unrelated tiles: the rungs sit shoulder to shoulder, left to right, so it
  // reads as one thing you are partway up.
  // 168, not 132: a ladder rung stacks five lines (its number, its badge, its
  // name, its threshold and, on one rung of every ladder, the relic it opens).
  const HEAD_H = 46, SECTION_GAP = 10, LADDER_H = 176;
  let y = VIEW_Y;

  const sectionHead = (name, defs) => {
    const got = defs.filter(d => isAchievementUnlocked(d.id)).length;
    const row = scene.add.container(VIEW_X, y + HEAD_H / 2);
    const line = scene.add.rectangle(0, 20, VIEW_W, 2, GOLD_TINT, 0.35).setOrigin(0, 0.5);
    row.add(line);
    // Gold section head on cream parchment, with a gold rule under it: the same
    // 1:1 contrast as the toast, and the same fix.
    row.add(legible(scene.add.text(2, 0, name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: GOLD,
    }), { shadow: false }).setOrigin(0, 0.5));
    row.add(scene.add.text(VIEW_W - 2, 2, `${got} / ${defs.length}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: PARCH.textDim,
    }).setOrigin(1, 0.5));
    shelf.add(row);
    y += HEAD_H + 6;
  };

  for (const section of achievementSections()) {
    sectionHead(section.name, section.runs.flatMap(r => r.defs));
    let col = 0;
    const newRow = () => { if (col > 0) { y += TILE_H + GAP_Y; col = 0; } };
    for (const runOfDefs of section.runs) {
      if (runOfDefs.defs.length > 1) {
        newRow();
        shelf.add(ladderRow(scene, VIEW_X, y, VIEW_W, LADDER_H, runOfDefs.defs));
        y += LADDER_H + GAP_Y;
        continue;
      }
      const x = VIEW_X + TILE_W / 2 + col * (TILE_W + GAP_X);
      shelf.add(achievementTile(scene, x, y + TILE_H / 2, runOfDefs.defs[0], TILE_W, TILE_H));
      col += 1;
      if (col >= COLS) { y += TILE_H + GAP_Y; col = 0; }
    }
    newRow();
    y += SECTION_GAP;
  }

  const contentH = Math.max(0, y - VIEW_Y);
  const maxScroll = Math.max(0, contentH - VIEW_H);
  // Kinetic (2026-08-04): the shared float — flicks glide, edges rubber-band.
  const kin = kineticScroll(scene, { max: maxScroll, apply: (v) => { shelf.y = -v; } });
  const setScroll = (v) => kin.set(v);

  const onWheel = (_p, _o, _dx, dy) => kin.wheel(dy);
  scene.input.on('wheel', onWheel);
  // Drag anywhere over the shelf. `dim` covers the whole screen and is already
  // interactive, so it is the one surface guaranteed to be under the pointer.
  let dragFrom = null;
  dim.on('pointerdown', (p) => { dragFrom = { y: p.y }; kin.grab(p.y); });
  const onMove = (p) => { if (dragFrom && p.isDown) kin.move(p.y); };
  const onUp = () => kin.release();
  scene.input.on('pointermove', onMove);
  scene.input.on('pointerup', onUp);

  if (maxScroll > 0) {
    ov.add(scene.add.text(cx, VIEW_Y + VIEW_H + 16, 'scroll for more', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0.5));
  }

  const close = () => {
    scene.__achievementsOpen = false;
    scene.input.off('wheel', onWheel);
    scene.input.off('pointermove', onMove);
    scene.input.off('pointerup', onUp);
    kin.destroy();
    maskShape.destroy();
    ov.destroy(true);
  };
  // The dim closes the overlay, but only on a click OUTSIDE the panel that was
  // not a drag — otherwise flicking the shelf would shut it every time.
  dim.on('pointerup', (p) => {
    const moved = dragFrom ? Math.abs(p.y - dragFrom.y) : 0;
    const outside = p.x < cx - PANEL_W / 2 || p.x > cx + PANEL_W / 2
      || p.y < cy - PANEL_H / 2 || p.y > cy + PANEL_H / 2;
    dragFrom = null;
    if (moved < 6 && outside) close();
  });

  const btn = scene.add.image(cx, cy + PANEL_H / 2 - 52, 'btn_yellow')
    .setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
  ov.add(btn);
  ov.add(scene.add.text(cx, cy + PANEL_H / 2 - 56, 'CLOSE', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#5b3a00',
  }).setOrigin(0.5));
  btn.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.7 }); close(); });

  // ---- PROFILE CARRY (2026-08-04) -----------------------------------------
  // JC: "I don't want to go unlock everything every time." The thief is the
  // BROWSER ORIGIN: the dev server, the built preview and itch are three
  // separate localStorages, so a profile earned on one looks wiped on the
  // next. COPY turns this profile into a one-line code; PASTE merges a code
  // in (unions and maxima only, so nothing can ever be downgraded). They live
  // on the trophy shelf because the trophy shelf IS the profile.
  const carryBtn = (bx, label, cb) => {
    const b = scene.add.image(bx, cy + PANEL_H / 2 - 52, 'btn_dark')
      .setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
    const t = scene.add.text(bx, cy + PANEL_H / 2 - 56, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: '#cfc8e8',
    }).setOrigin(0.5);
    ov.add(b); ov.add(t);
    b.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.7 }); cb(); });
    return b;
  };
  const say = (msg, color = '#ffd23e') =>
    popMessage(scene, cx, cy + PANEL_H / 2 - 110, msg, { color, size: 24, rise: 40 });
  carryBtn(cx - 300, 'COPY PROFILE', () => {
    const code = exportProfile();
    const fallback = () => window.prompt?.('Copy this profile code:', code);
    try {
      navigator.clipboard?.writeText(code)
        .then(() => say('Profile code copied. Paste it on your other device.'))
        .catch(fallback);
      if (!navigator.clipboard) fallback();
    } catch { fallback(); }
  });
  carryBtn(cx + 300, 'PASTE PROFILE', () => {
    const code = window.prompt?.('Paste a profile code:');
    if (code == null || code === '') return;
    const receipt = importProfile(code);
    if (receipt) {
      say(receipt);
      // The shelf under this button may have just gained trophies.
      close();
      openAchievements(scene);
    } else {
      say('That is not a profile code.', '#ff8c9a');
    }
  });

  // Verification hook: the shelf as plain data (tools/verify_potions_0802.py).
  window.__hfAchievements = {
    // THE SHELF as the player sees it: a secret trophy is simply not on it
    // until it is earned. `all` is the whole table beside it, so a driver can
    // assert BOTH halves of the hidden treatment (it exists, and it is absent).
    tiles: () => visibleAchievements().map(d => ({
      id: d.id, unlocked: isAchievementUnlocked(d.id),
      group: d.group ?? null, tier: d.tier ?? null,
      reward: achievementReward(d.id)?.id ?? null,
    })),
    all: () => ACHIEVEMENTS.map(d => ({
      id: d.id, unlocked: isAchievementUnlocked(d.id),
      secret: !!d.secret, hidden: isAchievementHidden(d.id),
    })),
    // The shelf's SHAPE, so a driver can prove the ladders really did collapse
    // into progression rows instead of loose tiles.
    sections: () => achievementSections().map(s => ({
      name: s.name,
      runs: s.runs.map(r => ({ tier: r.tier, ids: r.defs.map(d => d.id) })),
    })),
    tally: () => achievementTally(),
    scrollable: maxScroll > 0,
    setScroll,
    close,
  };
  return ov;
}

/** One tile. Unlocked: medal, name, what you did. Locked: silhouette, ???, hint. */
function achievementTile(scene, x, y, def, w, h) {
  const got = isAchievementUnlocked(def.id);
  const tile = scene.add.container(x, y);
  const parts = woodPanel(scene, 0, 0, w, h, { shadow: false, accent: got ? GOLD_TINT : 0x3a2f4a });
  if (!got) parts.panel.setTint(0x2a2136);
  tile.add([parts.panel, parts.line]);

  if (got) {
    tile.add(achievementBadge(scene, -w / 2 + 60, 0, def, 64));
  } else {
    const sil = scene.add.image(-w / 2 + 60, -6, `silhouette_${(hashId(def.id) % 3) + 1}`)
      .setTintFill(0x1c1626).setAlpha(0.85);
    sil.setScale(70 / Math.max(sil.width, sil.height));
    tile.add(sil);
    const lock = scene.add.image(-w / 2 + 60, 34, 'icon_lock').setScale(0.6);
    tile.add(lock);
  }

  tile.add(scene.add.text(-w / 2 + 108, -h / 2 + 34, got ? def.name : '???', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '24px',
    color: got ? PARCH.text : '#6b5a80',
  }).setOrigin(0, 0.5));
  tile.add(scene.add.text(-w / 2 + 108, -h / 2 + 62, got ? def.desc : def.hint, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px',
    color: got ? PARCH.textDim : '#8a78a0', fontStyle: 'bold',
    wordWrap: { width: w - 130 },
  }).setOrigin(0, 0));
  tile.add(rewardLine(scene, -w / 2 + 108, h / 2 - 24, def, got));
  return tile;
}

/**
 * THE REWARD LINE. Five trophies open a relic (see GATED_RELICS in
 * artifacts.js), and the whole point of gating is that the player can SEE what
 * is on the other side. Unlocked NAMES the relic; locked only admits there is
 * one, because the tease is the tease. Everything else gets an empty text so
 * the caller never has to branch.
 */
function rewardLine(scene, x, y, def, got) {
  // TWO TROPHIES OPEN A BOOSTER PACK (JC, 2026-08-04), on exactly the relic
  // rule: an earned tile NAMES what it opened, a locked one only admits there
  // is something there. PACK_GATES is read backwards rather than restated, so
  // gating a third pack needs no line in this file.
  const packKind = Object.keys(PACK_GATES).find(k => PACK_GATES[k] === def.id);
  let text = '';
  if (packKind) {
    text = got ? `PACK: ${PACK_TYPES[packKind]?.label ?? packKind.toUpperCase()}` : 'UNLOCKS A PACK';
  } else if (gatesARelic(def.id)) {
    text = got ? `RELIC: ${achievementReward(def.id)?.name ?? '???'}` : 'UNLOCKS A RELIC';
  } else {
    return scene.add.text(x, y, '', { fontSize: '1px' });
  }
  // PARCH.accent, not the toast's GOLD: on a shelf tile the gold sits directly
  // on the tile's own gold frame and the line goes to mush. The rust-orange is
  // the same one the tally header uses and it reads at a glance on parchment.
  return scene.add.text(x, y, text, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '16px',
    color: got ? PARCH.accent : '#7a6890',
  }).setOrigin(0, 0.5);
}

/**
 * A LADDER, drawn as one progression instead of N tiles: the rungs sit shoulder
 * to shoulder in row order, each one a compact plate with its own name and line,
 * and an earned rung wears the gold. Reads at a glance as "I am two of four up
 * this thing", which four separate tiles never did.
 */
function ladderRow(scene, x, y, w, h, defs) {
  const row = scene.add.container(x, y);
  const gap = 12;
  const cw = (w - gap * (defs.length - 1)) / defs.length;
  defs.forEach((def, i) => {
    const got = isAchievementUnlocked(def.id);
    const cx = i * (cw + gap) + cw / 2;
    const rung = scene.add.container(cx, h / 2);
    const parts = woodPanel(scene, 0, 0, cw, h, { shadow: false, accent: got ? GOLD_TINT : 0x3a2f4a });
    if (!got) parts.panel.setTint(0x2a2136);
    rung.add([parts.panel, parts.line]);
    // The rung's NUMBER is always visible, locked or not: a ladder whose next
    // step is '???' is not a ladder, it is a wall. Same reason the THRESHOLD is
    // printed on a locked rung where a normal locked tile would hide behind its
    // hint: on a ladder, the number you are climbing towards IS the hint.
    rung.add(scene.add.text(0, -h / 2 + 20, `${i + 1} of ${defs.length}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '15px',
      color: got ? PARCH.accent : '#6b5a80',
    }).setOrigin(0.5));
    if (got) rung.add(achievementBadge(scene, 0, -h / 2 + 58, def, 42));
    else rung.add(scene.add.image(0, -h / 2 + 58, 'icon_lock').setScale(0.5).setAlpha(0.8));
    rung.add(scene.add.text(0, -h / 2 + 96, got ? def.name : '???', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '18px',
      color: got ? PARCH.text : '#6b5a80', wordWrap: { width: cw - 16 }, align: 'center',
    }).setOrigin(0.5));
    rung.add(scene.add.text(0, -h / 2 + 118, def.desc, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '14px',
      color: got ? PARCH.textDim : '#8a78a0', fontStyle: 'bold',
      wordWrap: { width: cw - 16 }, align: 'center',
    }).setOrigin(0.5, 0));
    if (gatesARelic(def.id)) {
      const line = rewardLine(scene, 0, h / 2 - 24, def, got);
      line.setOrigin(0.5).setFontSize(15).setWordWrapWidth(cw - 16).setAlign('center');
      rung.add(line);
    }
    row.add(rung);
  });
  return row;
}

/** Stable per-id silhouette pick, so a locked tile never changes shape on you. */
function hashId(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(n);
}
