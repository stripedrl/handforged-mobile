/**
 * @file ui/casino.js
 * THE TRAVELING CASINO's three tables, as overlays over the event painting.
 *
 * THIS FILE ANIMATES. IT DOES NOT DECIDE. Every rule, every roll and every chip
 * comes out of core/casino.js: the shoe is shuffled there, the wheel is spun
 * there, the race is drawn there, and the purse is moved by placeWager /
 * payWager and by nothing else in here. If a number appears on this screen it
 * was handed over by the model, so the animation can never disagree with the
 * money. That separation is the entire point of the workstream.
 *
 * THE SHAPE OF A VISIT
 *   1. THE BETTING SLIP   pick a stake, pick your bet, commit. This is the only
 *      screen where chips can still be taken back, and the only place they
 *      leave the purse (on the commit button, once).
 *   2. THE TABLE          blackjack / the wheel / the race.
 *   3. THE RECEIPT        the exact wager, the exact return and the exact net,
 *      printed, so the player can audit the table himself. A win gets the
 *      Bounty Hunter's payday first (see goldRain below).
 */

import { GAME_W, GAME_H, DEPTH, PARCH, CARD } from '../config.js';
import { ensure, CASINO_BG } from '../core/lazyload.js';
import { woodPanel } from './panels.js';
import { sfx } from '../core/sfx.js';
import { legible, popMessage } from './juice.js';
import { CardSprite } from './CardSprite.js';
import { fitWidth, dropShadow, contactPool } from './rewards.js';
import {
  WAGERS, MIN_WAGER, CASINO_GAME_BY_ID,
  affordableWagers, placeWager, payWager, markCasinoPlayed,
  newBlackjack, bjHit, bjStand, bjSurrender, bjMultiplier, handTotal, isSoft,
  BJ_TARGET, BJ_DEALER_STANDS, BJ_WIN_PAYOUT, BJ_SURRENDER_PAYOUT, BJ_RESULT_TEXT,
  WHEEL, WHEEL_POCKETS, ROULETTE_BETS, ROULETTE_PAYOUTS, spinRoulette, rouletteMultiplier,
  DUCKS, DUCK_PAYOUT, raceDucks, duckMultiplier,
} from '../core/casino.js';

/**
 * ABOVE EVERYTHING, deliberately. Unlike an event (whose painting sits UNDER
 * the map's fixed HUD so the act banner and hero capsule stay legible over it),
 * a casino table is a ROOM: it owns the screen. Leaving the HUD on top put the
 * act banner through the wagon's name and, worse, showed the map's stale chip
 * count next to the table's live one, which is exactly the sort of thing a
 * player is right to distrust in a gambling game. The highest depth anything
 * else in the game claims is overlay+12, so this clears the lot.
 */
const OV_DEPTH = DEPTH.overlay + 40;
const GOLD = '#ffd23e';
const CREAM = '#f0e2c0';

// ---------------------------------------------------------------------------
// Small shared furniture
// ---------------------------------------------------------------------------

/**
 * Nearly opaque, and that is the point. At 0.9 the map's act banner still read
 * through the wagon's name, and the hero capsule still showed a chip count that
 * had stopped being true the moment a wager went down. A casino must not have a
 * second, stale number on the screen.
 */
function dimmer(scene, alpha = 0.96) {
  return scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0810, alpha).setInteractive();
}

/**
 * A parchment plate. MapScene owns the grained version (canvasPanel) and the
 * casino always opens from the map, so we borrow it when it is there and fall
 * back to the plain wood panel when it is not (the dev harness opens these
 * overlays straight from a bare scene).
 */
function panelParts(scene, x, y, w, h, accent) {
  if (typeof scene.canvasPanel === 'function') return scene.canvasPanel(x, y, w, h, accent);
  const p = woodPanel(scene, x, y, w, h, { accent, shadow: true });
  return [p.shadow, p.panel, p.line].filter(Boolean);
}

function title(scene, y, text, color = GOLD, size = 58) {
  return scene.add.text(GAME_W / 2, y, text, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`, color,
    stroke: '#241505', strokeThickness: Math.max(6, Math.round(size / 5.5)),
  }).setOrigin(0.5);
}

/**
 * THE CASINO'S BUTTON. Sized to its own label (fitWidth), never to a magic
 * number, and it can be DISABLED: a stake you cannot cover goes grey, stops
 * taking the pointer and says so on hover.
 *
 * The hover puff tweens displayWidth/displayHeight rather than scale, because
 * every plate here is sized with setDisplaySize and its rest scale is therefore
 * not 1 (tweening scale would snap it to full texture size first).
 */
function plate(scene, parent, x, y, label, onClick, {
  key = 'btn_yellow', color = '#5b3a00', h = 72, w = null, min = 170, size = 26, enabled = true,
} = {}) {
  const txt = scene.add.text(x, y - 3, label, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`, color,
  }).setOrigin(0.5);
  const img = scene.add.image(x, y, key);
  const bw = w ?? fitWidth(txt, { min, pad: 46 });
  img.setDisplaySize(bw, h);
  parent.add([img, txt]);
  parent.bringToTop(txt);
  img.label = txt;
  img.baseW = bw;
  img.baseH = h;

  img.setEnabled = (on) => {
    img.enabled = on;
    // A disabled plate is DIM, not blank. At 0.34/0.42 the commit button read
    // as an empty green slab with no word on it, which is the wrong signal for
    // the one thing on the screen the player is being asked to aim at.
    img.setAlpha(on ? 1 : 0.5);
    txt.setAlpha(on ? 1 : 0.72);
    if (on) img.setInteractive({ useHandCursor: true }); else img.disableInteractive();
    return img;
  };
  img.on('pointerover', () => {
    if (!img.enabled) return;
    scene.tweens.add({ targets: img, displayWidth: bw * 1.04, displayHeight: h * 1.07, duration: 100 });
  });
  img.on('pointerout', () => {
    scene.tweens.add({ targets: img, displayWidth: bw, displayHeight: h, duration: 100 });
  });
  img.on('pointerdown', () => {
    if (!img.enabled) return;
    sfx(scene, 'button', { volume: 0.8 });
    onClick(img);
  });
  img.setEnabled(enabled);
  return img;
}

/** The purse, top right, in the game's own coin. Call refresh() after a payout. */
function purseTag(scene, parent, run) {
  const coin = scene.add.image(GAME_W - 232, 64, 'icon_coins');
  coin.setScale(44 / Math.max(coin.width, coin.height));
  const txt = scene.add.text(GAME_W - 202, 64, String(run.chips), {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '38px', color: GOLD,
    stroke: '#241505', strokeThickness: 7,
  }).setOrigin(0, 0.5);
  parent.add([coin, txt]);
  return { refresh: () => txt.setText(String(run.chips)) };
}

/**
 * THE PAYDAY, borrowed wholesale from the Bounty Hunter's act-clear celebration
 * (CombatScene.actClearBounty): a gold bloom through the middle, four breathing
 * edge bars, and Caleb's tilted chips tumbling the full width of the screen for
 * about two and a half seconds. Same textures, same timings, same sting, so a
 * BIG WIN at the casino feels like the same kind of event as clearing an act.
 *
 * Reproduced here rather than imported because the original lives inside a
 * 9,800-line CombatScene method that also books a bounty and arms a DESCEND
 * button; lifting it out is a refactor for another patch, not a gambling one.
 *
 * @returns a stop() that fades the gold out and kills every tween it started.
 */
export function goldRain(scene, parent, { duration = 2600 } = {}) {
  const layer = scene.add.container(0, 0);
  parent.add(layer);

  const bloom = scene.add.image(GAME_W / 2, GAME_H / 2, 'fx_glow_circle')
    .setDisplaySize(2600, 1900).setTint(0xffd23e).setAlpha(0)
    .setBlendMode(Phaser.BlendModes.ADD);
  const bars = [
    scene.add.image(GAME_W / 2, -30, 'fx_glow').setDisplaySize(GAME_W * 1.4, 300),
    scene.add.image(GAME_W / 2, GAME_H + 30, 'fx_glow').setDisplaySize(GAME_W * 1.4, 300),
    scene.add.image(-30, GAME_H / 2, 'fx_glow').setDisplaySize(320, GAME_H * 1.4),
    scene.add.image(GAME_W + 30, GAME_H / 2, 'fx_glow').setDisplaySize(320, GAME_H * 1.4),
  ];
  for (const b of bars) b.setTint(0xffd23e).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
  layer.add(bloom);
  layer.add(bars);
  const breathe = (targets, peak, low) => scene.tweens.add({
    targets, alpha: peak, duration: 520, ease: 'Sine.easeOut',
    onComplete: () => scene.tweens.add({
      targets, alpha: low, duration: 1150, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    }),
  });
  breathe(bloom, 0.22, 0.11);
  breathe(bars, 0.6, 0.28);

  sfx(scene, 'chips_stack', { volume: 0.9 });
  const dropChip = () => {
    if (!layer.active) return;
    const x = Phaser.Math.Between(40, GAME_W - 40);
    const chip = scene.add.image(x, Phaser.Math.Between(-190, -110),
      Math.random() < 0.5 ? 'chip_tilt_1' : 'chip_tilt_2')
      .setScale(Phaser.Math.FloatBetween(0.17, 0.34))
      .setAngle(Phaser.Math.Between(0, 360));
    layer.add(chip);
    scene.tweens.add({
      targets: chip, y: GAME_H + 160, x: x + Phaser.Math.Between(-70, 70),
      angle: `+=${Phaser.Math.Between(-420, 420)}`,
      duration: Phaser.Math.Between(1500, 2500), ease: 'Sine.easeIn',
      onComplete: () => chip.destroy(),
    });
  };
  const timer = scene.time.addEvent({
    delay: 95, repeat: Math.round(duration / 95),
    callback: () => { dropChip(); if (Math.random() < 0.5) dropChip(); },
  });

  layer.once('destroy', () => { timer.remove(); scene.tweens.killTweensOf([bloom, ...bars]); });
  return {
    layer,
    stop() {
      timer.remove();
      scene.tweens.killTweensOf([bloom, ...bars]);
      scene.tweens.add({
        targets: [bloom, ...bars], alpha: 0, duration: 420, ease: 'Sine.easeIn',
      });
    },
  };
}

/** BIG WIN, over the table, on top of the rain. */
function bigWinBanner(scene, parent, amount) {
  const t = title(scene, GAME_H / 2 - 40, 'BIG WIN', GOLD, 132).setScale(0.4).setAlpha(0);
  t.setShadow(0, 10, '#0c0804', 18, true, true);
  const sub = scene.add.text(GAME_W / 2, GAME_H / 2 + 66, `+${amount} CHIPS`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '58px', color: '#fff3c4',
    stroke: '#241505', strokeThickness: 9,
  }).setOrigin(0.5).setAlpha(0);
  parent.add([t, sub]);
  scene.tweens.add({
    targets: t, alpha: 1, scale: 1, duration: 420, ease: 'Back.easeOut',
    onComplete: () => scene.tweens.add({
      targets: t, scale: 1.05, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    }),
  });
  scene.tweens.add({ targets: sub, alpha: 1, y: GAME_H / 2 + 88, duration: 380, delay: 220, ease: 'Cubic.easeOut' });
  scene.cameras.main.flash(260, 120, 96, 30);
  return [t, sub];
}

// ---------------------------------------------------------------------------
// THE VISIT
// ---------------------------------------------------------------------------

/**
 * Open a table. `gameId` is one of CASINO_GAMES; `done()` is called exactly
 * once, when the player leaves, whatever happened in between.
 *
 * The `run` is only ever touched through core/casino.js.
 */
/**
 * `force` PINS THE ROLL AND NOTHING ELSE (the dev/verification door, modelled
 * on __hf.bountyPack's wheelRoll). It may say which pocket the ball fell into
 * or which duck won, so a verification run can photograph a BIG WIN and a loss
 * without farming spins. It may NOT touch a payout: the multiplier is still
 * computed by rouletteMultiplier / duckMultiplier and the chips still move
 * through payWager, so the money path under a forced roll is the real one.
 */
export function casinoOverlay(scene, run, gameId, done, { force = null } = {}) {
  const game = CASINO_GAME_BY_ID[gameId] ?? CASINO_GAME_BY_ID.blackjack;

  /**
   * THE VERIFICATION WINDOW (tools/verify_casino.py). It REPORTS; it never
   * decides. Everything on it is written after the fact by the code that
   * already did the thing, so a driver can audit the purse against the payout
   * table without the audit being able to change either.
   */
  const dbg = (typeof window === 'undefined') ? {} : (window.__hfCasino = {
    game: game.id, screen: 'slip', wager: 0, pick: null,
    chipsBefore: run.chips, chipsAfterStake: null,
    affordable: affordableWagers(run.chips),
    result: null, receipt: null, closed: false,
  });

  const root = scene.add.container(0, 0).setDepth(OV_DEPTH);
  // INSIDE THE WAGON. JC painted an interior specifically "for games when one is
  // selected", so the table is not a panel floating on a dimmed map: it is a
  // room. Cover-fit so the 16:9 painting fills a 16:9 canvas with no letterbox,
  // then a dark veil over it so the felt, the cards and the numbers still read.
  // Falls back to the flat dimmer if the painting is missing, which is why the
  // veil is a separate object rather than baked into the image.
  //
  // IT POPS IN RATHER THAN BEING WAITED FOR (2026-08-06, deferred loading). The
  // painting left the boot set with every other room backdrop, and this overlay
  // is the ONE place a gate would cost something real: `window.__hfCasino` is
  // written synchronously two lines up and tools/verify_casino.py reads it the
  // moment the overlay is asked for. So the wagon opens on the dimmer it always
  // fell back to, the fetch runs behind it, and the room fades in underneath the
  // veil when it lands — which is exactly the fallback path that already
  // existed, plus an ending.
  const veil = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0810, 0.55).setInteractive();
  const dim = dimmer(scene, 0.9);
  root.add(dim);
  root.add(veil);
  const dressWagon = (fade) => {
    if (!scene.textures.exists(CASINO_BG) || !root.active) return;
    const bg = scene.add.image(GAME_W / 2, GAME_H / 2, CASINO_BG).setAlpha(fade ? 0 : 1);
    bg.setScale(Math.max(GAME_W / bg.width, GAME_H / bg.height));
    root.addAt(bg, 0);
    if (!fade) return dim.setFillStyle(0x0a0810, 0);
    scene.tweens.add({ targets: bg, alpha: 1, duration: 220 });
    scene.tweens.add({ targets: dim, fillAlpha: 0, duration: 220 });
  };
  if (scene.textures.exists(CASINO_BG)) dressWagon(false);
  else ensure(scene, [CASINO_BG]).then(() => dressWagon(true));
  const purse = purseTag(scene, root, run);

  // The chrome that outlives every screen: the wagon's name and the game's.
  root.add(scene.add.text(GAME_W / 2, 60, 'THE TRAVELING CASINO', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: '#c9a24a',
    stroke: '#241505', strokeThickness: 5,
  }).setOrigin(0.5));
  root.add(title(scene, 122, game.name, GOLD, 56));
  root.add(legible(scene.add.text(GAME_W / 2, 172, game.rules, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '23px', color: CREAM,
    fontStyle: 'bold', align: 'center', wordWrap: { width: 1100 },
  })).setOrigin(0.5, 0));
  // The dealer's line: the same string the event outcome carries, so the copy
  // lives in exactly one place (CASINO_GAMES.greeting) and is never dead.
  root.add(legible(scene.add.text(GAME_W / 2, 210, game.greeting, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: '#a8967a',
    fontStyle: 'italic bold', align: 'center', wordWrap: { width: 1100 },
  })).setOrigin(0.5, 0));

  /** The live screen under the chrome. Swapped, never stacked. */
  let screen = null;
  const setScreen = (build) => {
    screen?.destroy(true);
    screen = scene.add.container(0, 0);
    root.add(screen);
    build(screen);
  };

  let closed = false;
  const leave = () => {
    if (closed) return;
    closed = true;
    dbg.closed = true;
    root.destroy(true);
    done?.();
  };

  // -------------------------------------------------------------------------
  // 1. THE BETTING SLIP
  // -------------------------------------------------------------------------
  const bettingSlip = () => setScreen((s) => {
    const state = { wager: 0, pick: null };
    const can = affordableWagers(run.chips);

    // --- the stake row -----------------------------------------------------
    s.add(scene.add.text(GAME_W / 2, 268, 'YOUR WAGER', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: CREAM,
      stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5));

    const STAKE_W = 176, STAKE_GAP = 22;
    const rowW = WAGERS.length * STAKE_W + (WAGERS.length - 1) * STAKE_GAP;
    const stakes = WAGERS.map((w, i) => {
      const x = GAME_W / 2 - rowW / 2 + STAKE_W / 2 + i * (STAKE_W + STAKE_GAP);
      const affordable = can.includes(w);
      const p = plate(scene, s, x, 344, String(w), () => {
        state.wager = w;
        stakes.forEach(o => o.setPicked(o.wager === w));
        refreshCommit();
      }, { key: affordable ? 'btn_dark' : 'btn_gray', color: affordable ? GOLD : '#6a6070', w: STAKE_W, h: 78, size: 34, enabled: affordable });
      p.wager = w;
      p.setPicked = (on) => {
        p.setTexture(on ? 'btn_yellow' : (affordable ? 'btn_dark' : 'btn_gray'));
        p.setDisplaySize(p.baseW, p.baseH);
        p.label.setColor(on ? '#5b3a00' : (affordable ? GOLD : '#6a6070'));
      };
      return p;
    });

    // The honest line under the stakes: what you hold, and what that lets you
    // sit down with. A purse that cannot cover the minimum is told so plainly.
    const short = !can.length;
    s.add(legible(scene.add.text(GAME_W / 2, 412, short
      ? `The minimum at this table is ${MIN_WAGER} chips. You are holding ${run.chips}.`
      : `You are holding ${run.chips} chips. Losing takes the whole wager.`, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '22px',
      color: short ? '#ff9aa2' : '#c8b894', fontStyle: 'bold',
    })).setOrigin(0.5));

    // --- the bet row (roulette / ducks) ------------------------------------
    let picks = [];
    if (gameId === 'roulette') {
      s.add(scene.add.text(GAME_W / 2, 500, 'WHERE DOES IT LAND?', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: CREAM,
        stroke: '#241505', strokeThickness: 6,
      }).setOrigin(0.5));
      const BW = 300, BG = 40;
      const bw = ROULETTE_BETS.length * BW + (ROULETTE_BETS.length - 1) * BG;
      picks = ROULETTE_BETS.map((bet, i) => {
        const x = GAME_W / 2 - bw / 2 + BW / 2 + i * (BW + BG);
        const c = scene.add.container(x, 620);
        const box = scene.add.rectangle(0, 0, BW, 150, bet.color, 1)
          .setStrokeStyle(6, 0x38220f).setInteractive({ useHandCursor: true });
        const ring = scene.add.rectangle(0, 0, BW + 14, 164, 0x000000, 0).setStrokeStyle(7, 0xffd23e).setVisible(false);
        const name = scene.add.text(0, -26, bet.label, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '44px', color: '#fff6e0',
          stroke: '#1a1018', strokeThickness: 7,
        }).setOrigin(0.5);
        const pay = scene.add.text(0, 30, `PAYS ${ROULETTE_PAYOUTS[bet.id]}x`, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: '#ffe9a8',
          stroke: '#1a1018', strokeThickness: 5,
        }).setOrigin(0.5);
        // The odds line is the only text on these plates with no outline of its
        // own, and GREEN's plate (0x2c7a44) put it at about 3.6:1. Stroked like
        // its two neighbours, it reads on all three colours.
        const odds = legible(scene.add.text(0, 62, `${WHEEL.filter(p => p.color === bet.id).length} of ${WHEEL_POCKETS} pockets`, {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: '#f4ecd8', fontStyle: 'bold',
        }), { stroke: '#1a1018', thickness: 4, shadow: false }).setOrigin(0.5);
        c.add([ring, box, name, pay, odds]);
        s.add(c);
        box.on('pointerdown', () => {
          sfx(scene, 'button', { volume: 0.8 });
          state.pick = bet.id;
          picks.forEach(p => p.setPicked(p.betId === bet.id));
          refreshCommit();
        });
        c.betId = bet.id;
        c.setPicked = (on) => { ring.setVisible(on); c.setScale(on ? 1.05 : 1); };
        return c;
      });
    } else if (gameId === 'duckrace') {
      s.add(scene.add.text(GAME_W / 2, 452, 'BACK A DUCK', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: CREAM,
        stroke: '#241505', strokeThickness: 6,
      }).setOrigin(0.5));
      const DW = 336, DH = 344, DG = 26;
      const dw = DUCKS.length * DW + (DUCKS.length - 1) * DG;
      picks = DUCKS.map((duck, i) => {
        const x = GAME_W / 2 - dw / 2 + DW / 2 + i * (DW + DG);
        const c = scene.add.container(x, 656);
        const box = scene.add.rectangle(0, 0, DW, DH, 0x24303c, 0.94)
          .setStrokeStyle(5, 0x6b4526).setInteractive({ useHandCursor: true });
        const ring = scene.add.rectangle(0, 0, DW + 12, DH + 12, 0x000000, 0).setStrokeStyle(7, 0xffd23e).setVisible(false);
        c.add([ring, box]);
        c.add(duckImage(scene, 0, -84, duck, 130));
        // Names wrap to two lines when they have to (Lord Percival is a
        // mouthful on purpose) but the BLURB sits at a fixed height on every
        // card, so a row of four reads as a row and not as a staircase.
        c.add(scene.add.text(0, 12, duck.name, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: GOLD,
          align: 'center', wordWrap: { width: DW - 34 }, lineSpacing: -2,
        }).setOrigin(0.5, 0));
        c.add(scene.add.text(0, 98, duck.blurb, {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: '#c8b894',
          fontStyle: 'bold', align: 'center', wordWrap: { width: DW - 40 }, lineSpacing: 1,
        }).setOrigin(0.5, 0));
        s.add(c);
        box.on('pointerdown', () => {
          sfx(scene, 'button', { volume: 0.8 });
          state.pick = i;
          picks.forEach(p => p.setPicked(p.duckIdx === i));
          refreshCommit();
        });
        c.duckIdx = i;
        c.setPicked = (on) => { ring.setVisible(on); box.setFillStyle(on ? 0x3a4a2c : 0x24303c, 0.94); };
        return c;
      });
      s.add(legible(scene.add.text(GAME_W / 2, 854, `Every duck wins one race in ${DUCKS.length}. Yours pays ${DUCK_PAYOUT}x.`, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: '#c8b894', fontStyle: 'bold',
      })).setOrigin(0.5));
    } else {
      // BLACKJACK has nothing to pick: the deal IS the bet. So instead of a
      // choice row it gets the table itself, waiting, with the shoe cut and two
      // cards face down. Without it the slip was a stake row floating over four
      // hundred pixels of nothing.
      s.add(legible(scene.add.text(GAME_W / 2, 500, 'The dealer shows one card. You may take as many as you dare.', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: '#c8b894', fontStyle: 'bold',
      })).setOrigin(0.5));
      s.add(scene.add.rectangle(GAME_W / 2, 706, 1120, 300, 0x1c4030, 0.92).setStrokeStyle(8, 0x6b4526));
      s.add(faceDownCard(scene, GAME_W / 2 - 82, 706, 0.86));
      s.add(faceDownCard(scene, GAME_W / 2 + 82, 706, 0.86));
      s.add(scene.add.text(GAME_W / 2, 826, `BLACKJACK PAYS ${BJ_WIN_PAYOUT}x  ·  THE DEALER STANDS ON ${BJ_DEALER_STANDS}`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '23px', color: '#8fd8a8',
        stroke: '#0c2418', strokeThickness: 5,
      }).setOrigin(0.5));
    }

    // --- commit ------------------------------------------------------------
    const COMMIT_LABEL = { blackjack: 'DEAL', roulette: 'SPIN THE WHEEL', duckrace: 'START THE RACE' }[gameId];
    const commit = plate(scene, s, GAME_W / 2, 916, COMMIT_LABEL, () => {
      const staked = placeWager(run, state.wager);
      if (!staked) return;                 // belt and braces: never deal on credit
      markCasinoPlayed(run);               // the act's one game is spent HERE
      purse.refresh();
      dbg.wager = staked;
      dbg.pick = state.pick;
      dbg.chipsAfterStake = run.chips;
      dbg.screen = 'table';
      sfx(scene, 'chips', { volume: 0.9 });
      popMessage(scene, GAME_W / 2, 830, `-${staked} CHIPS`, { color: '#ffb45a', size: 40 });
      if (gameId === 'blackjack') return blackjackTable(staked);
      if (gameId === 'roulette') return rouletteTable(staked, state.pick);
      return duckTable(staked, state.pick);
    }, { key: 'btn_green', color: '#123a12', h: 88, size: 36, min: 380, enabled: false });

    const needPick = gameId !== 'blackjack';
    // The line telling you what the screen still wants sits on the wagon's
    // painting, not on a plate. At '#9a8a70' with no outline it was the dimmest
    // string in the casino and the one a stuck player most needs.
    const hint = legible(scene.add.text(GAME_W / 2, 982, '', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '20px', color: '#c8b894', fontStyle: 'bold',
    })).setOrigin(0.5);
    s.add(hint);

    function refreshCommit() {
      const ready = state.wager > 0 && (!needPick || state.pick !== null && state.pick !== undefined);
      commit.setEnabled(ready);
      hint.setText(ready
        ? `${state.wager} chips on the table. There is no taking it back.`
        : (!can.length ? 'Come back when you can afford to lose.'
          : state.wager ? 'Now choose where the money goes.' : 'Choose a wager.'));
    }
    refreshCommit();

    plate(scene, s, GAME_W / 2, 1036, 'LEAVE THE TABLE', () => leave(),
      { key: 'btn_gray', color: '#2a2030', h: 58, size: 23, min: 300 });
  });

  // -------------------------------------------------------------------------
  // 2a. BLACKJACK
  // -------------------------------------------------------------------------
  function blackjackTable(wager) {
    setScreen((s) => {
      const st = newBlackjack();
      const felt = scene.add.rectangle(GAME_W / 2, 640, 1320, 700, 0x1c4030, 0.9)
        .setStrokeStyle(8, 0x6b4526);
      s.add(felt);
      // THE PRINTED FELT. A real table has its rules painted between the two
      // hands, and drawing them there does two jobs at once: the house rule is
      // impossible to miss while you are deciding, and the dead band between the
      // dealer's row and yours stops being dead.
      const rule = scene.add.graphics();
      rule.lineStyle(3, 0xe8c86a, 0.34);
      rule.lineBetween(GAME_W / 2 - 470, 588, GAME_W / 2 + 470, 588);
      rule.lineBetween(GAME_W / 2 - 430, 596, GAME_W / 2 + 430, 596);
      rule.lineBetween(GAME_W / 2 - 430, 660, GAME_W / 2 + 430, 660);
      rule.lineBetween(GAME_W / 2 - 470, 668, GAME_W / 2 + 470, 668);
      s.add(rule);
      // THE HOUSE RULE HAS TO BE READABLE. At alpha 0.55 with no outline this
      // sat at roughly 3:1 against its own felt, which is not good enough for
      // the one line the player checks before betting. It keeps its painted-on
      // look through the thin rules above and below it, not through being faint.
      s.add(legible(scene.add.text(GAME_W / 2, 626, `BLACKJACK PAYS ${BJ_WIN_PAYOUT}x   ·   THE DEALER STANDS ON ${BJ_DEALER_STANDS}   ·   A TIE IS A PUSH`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: '#f2dc9e',
      }), { stroke: '#0c2418', shadow: false }).setOrigin(0.5).setAlpha(0.9));
      s.add(scene.add.text(GAME_W / 2, 962, `ON THE TABLE: ${wager} CHIPS`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: '#8fd8a8',
        stroke: '#0c2418', strokeThickness: 5,
      }).setOrigin(0.5));

      const dealerRow = scene.add.container(0, 0);
      const playerRow = scene.add.container(0, 0);
      s.add([dealerRow, playerRow]);

      const rowLabel = (y, text) => {
        const t = scene.add.text(400, y, text, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: CREAM,
          stroke: '#241505', strokeThickness: 6,
        }).setOrigin(0.5);
        s.add(t);
        return t;
      };
      rowLabel(400, 'DEALER');
      rowLabel(790, 'YOU');
      const dealerTotal = totalBadge(scene, s, 1520, 400);
      const playerTotal = totalBadge(scene, s, 1520, 790);

      // Cards are dealt at CARD scale 0.9 so six of them still fit the felt
      // (6 * 140 * 0.9 + gaps = 850, inside the 1320 table).
      const SCALE = 0.9, STEP = CARD.w * SCALE + 14;
      const paint = (row, cards, y, hideSecond) => {
        row.removeAll(true);
        cards.forEach((card, i) => {
          const x = GAME_W / 2 - ((cards.length - 1) / 2) * STEP + i * STEP;
          if (hideSecond && i === 1) { row.add(faceDownCard(scene, x, y, SCALE)); return; }
          const cs = new CardSprite(scene, x, y, card);
          cs.removeInteractive();
          cs.setScale(SCALE);
          row.add(cs);
        });
      };

      const redraw = () => {
        paint(dealerRow, st.dealer, 400, st.hole);
        paint(playerRow, st.player, 790, false);
        // With the hole card down the dealer's number is the ONE card he is
        // showing, not a total the player is not allowed to know.
        dealerTotal.set(st.hole ? handTotal(st.dealer.slice(0, 1)) : handTotal(st.dealer),
          st.hole, st.hole ? false : isSoft(st.dealer));
        playerTotal.set(handTotal(st.player), false, isSoft(st.player));
        dbg.hand = {
          player: handTotal(st.player), dealer: handTotal(st.dealer),
          cards: st.player.length, phase: st.phase, result: st.result, hole: st.hole,
        };
      };
      redraw();
      sfx(scene, 'card_deal', { volume: 0.85 });

      const buttons = [];
      const finish = () => {
        buttons.forEach(b => b.setEnabled(false));
        redraw();
        const line = BJ_RESULT_TEXT[st.result] ?? '';
        scene.time.delayedCall(560, () => receipt(wager, bjMultiplier(st.result), line));
      };

      const act = (fn) => {
        fn(st);
        sfx(scene, 'card_deal', { volume: 0.85 });
        redraw();
        if (st.phase === 'done') finish();
      };

      buttons.push(plate(scene, s, GAME_W / 2 - 250, 1030, 'HIT', () => act(bjHit),
        { key: 'btn_green', color: '#123a12', h: 74, size: 30, min: 220 }));
      buttons.push(plate(scene, s, GAME_W / 2, 1030, 'STAND', () => act(bjStand),
        { key: 'btn_yellow', color: '#5b3a00', h: 74, size: 30, min: 220 }));
      // WALKING OUT IS A PRICED OPTION, not a closed window. Half back, and the
      // button says so before it is pressed.
      // What FOLD pays comes off the payout table, not off a hardcoded halving:
      // retune BJ_SURRENDER_PAYOUT and the button stops lying by itself.
      buttons.push(plate(scene, s, GAME_W / 2 + 250, 1030, `FOLD (+${Math.round(wager * BJ_SURRENDER_PAYOUT)})`, () => act(bjSurrender),
        { key: 'btn_gray', color: '#2a2030', h: 74, size: 26, min: 220 }));

      // A hand that resolved on the deal (a natural, either way) never gets a
      // turn: show it, then pay it.
      if (st.phase === 'done') finish();
    });
  }

  /** The little slate that carries a hand's total. */
  function totalBadge(scene_, parent, x, y) {
    const box = scene_.add.rectangle(x, y, 132, 92, 0x120d1c, 0.92).setStrokeStyle(5, 0xc9a24a);
    const num = scene_.add.text(x, y - 4, '0', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '48px', color: GOLD,
    }).setOrigin(0.5);
    const note = scene_.add.text(x, y + 32, '', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '16px', color: '#c8b894', fontStyle: 'bold',
    }).setOrigin(0.5);
    parent.add([box, num, note]);
    return {
      set(total, showing, soft) {
        num.setText(total > BJ_TARGET ? 'BUST' : String(total));
        num.setFontSize(total > BJ_TARGET ? 34 : 48);
        num.setColor(total > BJ_TARGET ? '#ff6a76' : (total === BJ_TARGET ? '#7ef0a0' : GOLD));
        note.setText(showing ? 'showing' : (soft ? 'soft' : ''));
      },
    };
  }

  /** The hole card: Caleb's frame, face down, in the wagon's own wood. */
  function faceDownCard(scene_, x, y, scale) {
    const c = scene_.add.container(x, y).setScale(scale);
    c.add(scene_.add.image(6, 8, 'card_face').setDisplaySize(CARD.w - 6, CARD.h - 6)
      .setTint(0x000000).setAlpha(0.4));
    c.add(scene_.add.image(0, 0, 'card_face').setDisplaySize(CARD.w - 6, CARD.h - 6).setTint(0x5a3a86));
    c.add(scene_.add.image(0, 0, 'card_border').setDisplaySize(CARD.w, CARD.h).setTint(0xc9a24a));
    const mark = scene_.add.image(0, 0, 'icon_dice').setTint(0xe8d8a8).setAlpha(0.85);
    mark.setScale(64 / Math.max(mark.width, mark.height));
    c.add(mark);
    return c;
  }

  // -------------------------------------------------------------------------
  // 2b. ROULETTE — a real wheel with a real ball on the rim
  // -------------------------------------------------------------------------
  function rouletteTable(wager, bet) {
    setScreen((s) => {
      const landed = Number.isInteger(force?.pocket)
        ? ((force.pocket % WHEEL_POCKETS) + WHEEL_POCKETS) % WHEEL_POCKETS
        : spinRoulette();
      const pocket = WHEEL[landed];
      dbg.landed = landed;
      dbg.pocket = { n: pocket.n, color: pocket.color };
      const cx = GAME_W / 2, cy = 610, R = 268;
      const ARC = 360 / WHEEL_POCKETS;

      s.add(scene.add.image(cx + 10, cy + 22, 'fx_glow_circle')
        .setTint(0x080508).setAlpha(0.5).setDisplaySize(R * 2.7, R * 2.7));

      // --- the wheel ---------------------------------------------------------
      const wheel = scene.add.container(cx, cy);
      const g = scene.add.graphics();
      const arcRad = (Math.PI * 2) / WHEEL_POCKETS;
      WHEEL.forEach((p, i) => {
        g.fillStyle(p.color === 'red' ? 0xb02a34 : p.color === 'black' ? 0x1e1626 : 0x2c7a44, 1);
        // Pocket i is CENTRED on i*ARC clockwise from the top, so its wedge runs
        // half an arc either side of that. -90deg puts 0 at twelve o'clock.
        g.slice(0, 0, R, i * arcRad - Math.PI / 2 - arcRad / 2, i * arcRad - Math.PI / 2 + arcRad / 2, false);
        g.fillPath();
      });
      g.lineStyle(5, 0x38220f, 0.85);
      WHEEL.forEach((p, i) => {
        const a = i * arcRad - Math.PI / 2 - arcRad / 2;
        g.lineBetween(0, 0, Math.cos(a) * R, Math.sin(a) * R);
      });
      g.lineStyle(11, 0x6b4526, 1); g.strokeCircle(0, 0, R);
      g.lineStyle(5, 0xc9a24a, 1); g.strokeCircle(0, 0, R - 7);
      g.lineStyle(4, 0x8a6a3c, 1); g.strokeCircle(0, 0, R * 0.48);
      wheel.add(g);
      WHEEL.forEach((p, i) => {
        const a = i * arcRad - Math.PI / 2;
        wheel.add(scene.add.text(Math.cos(a) * R * 0.76, Math.sin(a) * R * 0.76, String(p.n), {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: '#fff6e0',
          stroke: '#1a1018', strokeThickness: 6,
        }).setOrigin(0.5).setAngle((a + Math.PI / 2) * 180 / Math.PI));
      });
      const hub = scene.add.image(cx, cy, 'btn_circle_gray').setDisplaySize(120, 120);
      s.add([wheel, dropShadow(scene, hub, { dx: 4, dy: 6, alpha: 0.34 }), hub]);
      const hubMark = scene.add.image(cx, cy, 'icon_coins').setTint(0xffd23e);
      hubMark.setScale(58 / Math.max(hubMark.width, hubMark.height));
      s.add(hubMark);

      // --- the ball ----------------------------------------------------------
      // It rides the RIM against the wheel's spin, then drops inward into the
      // pocket and finishes locked to the wheel, which is what a real ball does.
      const RIM_R = R + 26, POCKET_R = R * 0.6;
      s.add(scene.add.circle(cx, cy, RIM_R + 15, 0x000000, 0).setStrokeStyle(20, 0x4a3218));
      s.add(scene.add.circle(cx, cy, RIM_R + 15, 0x000000, 0).setStrokeStyle(4, 0x8a6a3c));
      const ballShadow = scene.add.circle(cx, cy - RIM_R + 4, 15, 0x000000, 0.4);
      const ball = scene.add.circle(cx, cy - RIM_R, 14, 0xfff4dc).setStrokeStyle(3, 0x8a6a3c);
      const shine = scene.add.circle(cx, cy - RIM_R, 5, 0xffffff, 0.9);
      s.add([ballShadow, ball, shine]);

      const SPIN_MS = 5200;
      const WHEEL_SPINS = 5, BALL_LAPS = 9;
      const wheelFinal = 360 * WHEEL_SPINS;
      // Land the ball exactly over pocket `landed` once the wheel has stopped.
      const ballFinal = wheelFinal + landed * ARC - 360 * BALL_LAPS;
      const drive = { a: 0, r: RIM_R };

      const place = () => {
        const rad = Phaser.Math.DegToRad(drive.a);
        const x = cx + Math.sin(rad) * drive.r;
        const y = cy - Math.cos(rad) * drive.r;
        ball.setPosition(x, y);
        shine.setPosition(x - 4, y - 4);
        ballShadow.setPosition(x + 3, y + 5);
      };

      let lastTick = 0;
      sfx(scene, 'wheel_spin', { volume: 0.9 });
      scene.tweens.add({ targets: wheel, angle: wheelFinal, duration: SPIN_MS, ease: 'Cubic.easeOut' });
      scene.tweens.add({
        targets: drive, a: ballFinal, duration: SPIN_MS, ease: 'Cubic.easeOut',
        onUpdate: () => {
          place();
          const tick = Math.floor(drive.a / ARC);
          if (tick !== lastTick) { lastTick = tick; sfx(scene, 'score_tick', { volume: 0.16, rate: 1.5 }); }
        },
      });
      // The drop: the ball leaves the rim three quarters of the way through and
      // rattles into the pocket, which is the moment the spin becomes a result.
      scene.tweens.add({
        targets: drive, r: POCKET_R, duration: SPIN_MS * 0.3, delay: SPIN_MS * 0.66,
        ease: 'Bounce.easeOut', onUpdate: place,
      });

      const callout = scene.add.text(GAME_W / 2, 966, `YOUR BET: ${bet.toUpperCase()}   ·   ${wager} ON THE TABLE   ·   PAYS ${ROULETTE_PAYOUTS[bet]}x`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '28px', color: CREAM,
        stroke: '#241505', strokeThickness: 6,
      }).setOrigin(0.5);
      s.add(callout);

      scene.time.delayedCall(SPIN_MS + 260, () => {
        const hit = pocket.color === bet;
        callout.setText(`${pocket.n} ${pocket.color.toUpperCase()}`);
        callout.setColor(hit ? '#7ef0a0' : '#ff9aa2');
        callout.setFontSize(46);
        scene.tweens.add({ targets: [ball, shine], scale: 1.5, duration: 180, yoyo: true, repeat: 1 });
        scene.time.delayedCall(820, () => receipt(wager, rouletteMultiplier(bet, landed),
          hit ? `The ball settles on ${pocket.n}. ${pocket.color.toUpperCase()}, and yours.`
            : `The ball settles on ${pocket.n}. ${pocket.color.toUpperCase()}, and not yours.`));
      });
    });
  }

  // -------------------------------------------------------------------------
  // 2c. THE DUCK RACE
  // -------------------------------------------------------------------------
  function duckTable(wager, pick) {
    setScreen((s) => {
      const winner = Number.isInteger(force?.winner)
        ? ((force.winner % DUCKS.length) + DUCKS.length) % DUCKS.length
        : raceDucks();
      dbg.winner = winner;
      // The pond and everything in it are measured off ONE box, so the lane
      // water, the name plates, the start line and the finish post cannot drift
      // apart (they used to: the water was inset 100px from the pond's own
      // right edge and the plates hung off its left one).
      const POND = { x: 960, y: 600, w: 1560, h: 566 };
      const PL = POND.x - POND.w / 2, PR = POND.x + POND.w / 2;
      const NAME_W = 320, NAME_X = PL + 22 + NAME_W / 2;
      const X0 = NAME_X + NAME_W / 2 + 80, X1 = PR - 130;
      const LANE_Y = [434, 554, 674, 794];

      s.add(scene.add.rectangle(POND.x, POND.y, POND.w, POND.h, 0x1d3f52, 0.94).setStrokeStyle(8, 0x6b4526));
      LANE_Y.forEach((y, i) => {
        s.add(scene.add.rectangle(POND.x, y, POND.w - 40, 110, i % 2 ? 0x24506a : 0x1f4760, 0.9));
      });
      // The finish post: a checkered column tall enough to cross every lane.
      const CHK_TOP = LANE_Y[0] - 76, CHK_BOT = LANE_Y[3] + 76;
      for (let y = CHK_TOP, i = 0; y < CHK_BOT; y += 32, i++) {
        s.add(scene.add.rectangle(X1 + 34, y + 16, 42, 32, i % 2 ? 0xf4ecd8 : 0x241505));
      }
      s.add(scene.add.text(X1 + 34, CHK_TOP - 24, 'FINISH', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: CREAM,
        stroke: '#241505', strokeThickness: 6,
      }).setOrigin(0.5));

      const runners = DUCKS.map((duck, i) => {
        const y = LANE_Y[i];
        const mine = i === pick;
        s.add(scene.add.rectangle(NAME_X, y, NAME_W, 96, mine ? 0x3a4a2c : 0x162030, 0.96)
          .setStrokeStyle(mine ? 6 : 3, mine ? 0xffd23e : 0x6b4526));
        s.add(scene.add.text(NAME_X, y - 14, duck.short, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: mine ? GOLD : CREAM,
          align: 'center', wordWrap: { width: NAME_W - 24 },
        }).setOrigin(0.5));
        s.add(scene.add.text(NAME_X, y + 24, mine ? 'YOUR DUCK' : `LANE ${i + 1}`, {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px',
          color: mine ? '#ffe9a8' : '#8fa4b8', fontStyle: 'bold',
        }).setOrigin(0.5));

        const sprite = duckImage(scene, X0, y, duck, 108);
        sprite.setScale(-Math.abs(sprite.scaleX), sprite.scaleY);   // face the finish
        s.add(sprite);
        scene.tweens.add({
          targets: sprite, y: y - 9, duration: 260 + i * 23, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        return { duck, sprite, y };
      });

      // THE RACE IS ALREADY DECIDED (raceDucks, above); what is generated here
      // is only the DRAMA. Each duck gets six legs of random pace, and the legs
      // are then scaled so the winner arrives at exactly 1.0 and everybody else
      // finishes short of the post. No leg can decide anything.
      const LEGS = 6, LEG_MS = 620;
      const plans = runners.map((_, i) => {
        const legs = Array.from({ length: LEGS }, () => 0.4 + Math.random());
        const sum = legs.reduce((a, b) => a + b, 0);
        const end = i === winner ? 1 : 0.72 + Math.random() * 0.2;
        let acc = 0;
        return legs.map((l) => { acc += l; return (acc / sum) * end; });
      });

      const pos = runners.map(() => ({ p: 0 }));
      const move = () => runners.forEach((r, i) => { r.sprite.x = X0 + (X1 - X0) * pos[i].p; });
      let leg = 0;
      const runLeg = () => {
        if (!s.active) return;
        if (leg >= LEGS) return void scene.time.delayedCall(700, () => {
          const line = winner === pick
            ? `${DUCKS[winner].name} takes it. Your duck, by a beak.`
            : `${DUCKS[winner].name} takes it. Your duck is still swimming.`;
          receipt(wager, duckMultiplier(pick, winner), line);
        });
        const isLast = leg === LEGS - 1;
        runners.forEach((r, i) => {
          scene.tweens.add({
            targets: pos[i], p: plans[i][leg], duration: LEG_MS,
            ease: isLast ? 'Sine.easeOut' : 'Sine.easeInOut', onUpdate: move,
          });
        });
        sfx(scene, 'score_tick', { volume: 0.3, rate: 1 + leg * 0.08 });
        leg++;
        scene.time.delayedCall(LEG_MS, runLeg);
      };
      scene.time.delayedCall(420, runLeg);

      s.add(scene.add.text(GAME_W / 2, 962, `YOUR DUCK: ${DUCKS[pick].name}   ·   ${wager} ON THE TABLE   ·   PAYS ${DUCK_PAYOUT}x`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: CREAM,
        stroke: '#241505', strokeThickness: 6,
      }).setOrigin(0.5));
    });
  }

  // -------------------------------------------------------------------------
  // 3. THE RECEIPT
  // -------------------------------------------------------------------------
  /**
   * The ONE door every game leaves by, and the only place chips come back.
   * `multiplier` is the total return multiple the model decided; everything the
   * player is shown is read back off the receipt payWager returns, so the
   * printed net is the ACTUAL change in the purse, relics and difficulty
   * included, and not a repeat of the payout table.
   */
  function receipt(wager, multiplier, line) {
    const r = payWager(run, wager, multiplier);
    purse.refresh();
    const net = r.delta - wager;
    const won = net > 0;
    dbg.screen = won ? 'celebration' : 'receipt';
    dbg.multiplier = multiplier;
    dbg.receipt = { ...r, net, chipsNow: run.chips };

    if (won) {
      const rain = goldRain(scene, root);
      const banner = bigWinBanner(scene, root, net);
      sfx(scene, 'general_victory', { volume: 0.85 });
      // Long enough to actually LAND: the chips have to fall past the screen at
      // least once before the receipt takes the moment away.
      scene.time.delayedCall(3200, () => {
        rain.stop();
        scene.tweens.add({
          targets: banner, alpha: 0, duration: 360,
          onComplete: () => { banner.forEach(b => b.destroy()); rain.layer.destroy(true); showReceipt(); },
        });
      });
    } else {
      sfx(scene, 'warning', { volume: 0.45 });
      scene.cameras.main.shake(220, 0.004);
      scene.time.delayedCall(340, showReceipt);
    }

    function showReceipt() {
      dbg.screen = 'receipt';
      // THE TABLE STAYS UP. The receipt is laid OVER the game that produced it,
      // behind a light veil, so you read the verdict with the hand, the wheel
      // or the finish line still in front of you. Swapping the screen out left
      // the panel floating on an empty dimmed map, which read as a different
      // room answering for a bet you made somewhere else.
      const s = scene.add.container(0, 0);
      root.add(s);
      s.add(scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0810, 0.45).setInteractive());
      {
        const heading = won ? 'YOU WIN' : (net === 0 ? 'A PUSH' : 'THE HOUSE WINS');
        // DARK INK ON THE PARCHMENT, not pale ink with an outline around it.
        // The receipt's headline sits ON the panel, and the panel is cream
        // (PARCH.fill 0xecd9b0): '#7ef0a0' on that is about 1.7:1 and CREAM on
        // it is about 1.2:1, which is the same gold-on-cream failure the
        // wardrobe hit. These are the ledger line's own three colours one row
        // down, so the panel now reads as one object instead of two.
        const colour = won ? '#1d7a36' : (net === 0 ? '#6b4a26' : '#a3241c');
        const body = scene.add.text(0, 0, line, {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '28px', color: PARCH.text,
          fontStyle: 'bold', align: 'center', wordWrap: { width: 820 }, lineSpacing: 3,
        }).setOrigin(0.5, 0);
        // THE AUDIT LINE. Wager, return and net, in chips, every time. A player
        // must be able to check the table's arithmetic without leaving it.
        const ledger = scene.add.text(0, 0,
          `WAGER ${r.wager}      RETURNED ${r.delta}      NET ${net >= 0 ? '+' : ''}${net}`, {
            fontFamily: 'Lilita One', resolution: 2, fontSize: '32px',
            color: won ? '#1d7a36' : (net === 0 ? '#6b4a26' : '#a3241c'),
          }).setOrigin(0.5, 0);

        const w = Phaser.Math.Clamp(Math.max(body.width, ledger.width, 460) + 130, 700, 1120);
        const h = 40 + 62 + 22 + body.height + 26 + ledger.height + 34 + 76 + 34;
        const cy = GAME_H - 40 - h / 2, top = cy - h / 2;
        const p = scene.add.container(GAME_W / 2, 0);
        p.add(panelParts(scene, 0, cy, w, h, won ? 0x5aa860 : 0x8a6a3c));
        // No stroke: dark ink on light parchment is already the high-contrast
        // pair, and an outline there only smears the letterforms (ui/juice.js).
        const head = scene.add.text(0, top + 34, heading, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '52px', color: colour,
        }).setOrigin(0.5, 0);
        body.setPosition(0, top + 34 + 62 + 22);
        ledger.setPosition(0, body.y + body.height + 26);
        p.add([head, body, ledger]);
        s.add(p);
        plate(scene, s, GAME_W / 2, ledger.y + ledger.height + 34 + 38, 'ONWARD', () => leave(),
          { key: 'btn_yellow', color: '#5b3a00', h: 76, size: 30, min: 260 });
        p.setAlpha(0).setY(28);
        scene.tweens.add({ targets: p, alpha: 1, y: 0, duration: 260, ease: 'Cubic.easeOut' });
        sfx(scene, won ? 'take' : 'button', { volume: 0.8 });
      }
    }
  }

  bettingSlip();
  return root;
}

/**
 * A duck at a given height. Caleb's four PNGs are alpha-keyed into
 * assets/casino; if one has not landed the lane still races, wearing a tinted
 * glyph instead, exactly the way a missing relic icon falls back.
 */
function duckImage(scene, x, y, duck, height) {
  if (scene.textures.exists(duck.key)) {
    const img = scene.add.image(x, y, duck.key);
    img.setScale(height / img.height);
    return img;
  }
  const c = scene.add.container(x, y);
  c.add(contactPool(scene, 0, height * 0.42, height * 0.9, { alpha: 0.3 }));
  const body = scene.add.ellipse(0, 0, height * 0.95, height * 0.8, duck.tint).setStrokeStyle(5, 0x241505);
  const glyph = scene.add.image(0, 0, 'icon_lucky').setTint(0x241505);
  glyph.setScale(height * 0.42 / Math.max(glyph.width, glyph.height));
  c.add([body, glyph]);
  return c;
}
