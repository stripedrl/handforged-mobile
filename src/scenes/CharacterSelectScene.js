import { GAME_W, GAME_H, DEPTH, CHARACTERS, SUIT_COLORS, SUIT_PIP_KEY, PARCH, applyMobileCamera } from '../config.js';
import { installLongPress } from '../ui/touch.js';
import { woodPanel } from '../ui/panels.js';
import { addTavernBackdrop } from '../ui/tavern.js';
import { playMusic } from '../core/music.js';
import { addSettingsButton } from '../ui/settingsMenu.js';
import { sfx } from '../core/sfx.js';
import { newRun } from '../core/run.js';
import { DIFFICULTIES } from '../core/difficulty.js';
import { highestDifficultyUnlocked, isDifficultyUnlocked, isCharacterUnlocked } from '../core/progress.js';
import { ACHIEVEMENT_BY_ID } from '../core/achievements.js';
import { heroTextureFor } from '../core/skins.js';
import { openSkins } from '../ui/skins.js';
import { kineticScroll } from '../ui/kinetic.js';
import { legible, burst } from '../ui/juice.js';

// =========================================================================
// THE CARD, AND EVERY NUMBER THAT HANGS OFF IT (2026-08-05, workstream E).
//
// The cards grew from 372x560 to 460x690, which is the single change this
// whole file is built around. `K` is the ratio the CARD'S CONTENTS were scaled
// by (690/560), and it is written here once instead of being multiplied into
// forty literals: the hero model, the two name plates, the chains, the lock and
// the PLAY hint all sit exactly where they sat, proportionally, on a card half
// again as big. Anything that is a NEW size (the kit parchment, the hover
// lift) says so at its own definition.
//
// The rail's own numbers move with the card: cardW and the gap are the card
// plus its breathing room. SIDE stays 110 because it is the chevron's margin,
// which has nothing to do with how big a card is.
// =========================================================================
const CW = 460, CH = 690;
const K = CH / 560;
const CARD_W = 495, CARD_GAP = 48, SIDE = 110;
// Recentred for the freed space: the logo used to own y 0-300 and does not any
// more, so the row sits nearer the middle of the screen than the bottom of it.
// Card top = 203, PLAY hint = 949, bottom hint = 1050. Nothing touches.
const ROW_Y = 548;
// The kit parchment. Not K-scaled: it is a floating popover, and a popover that
// grows with the thing it describes eventually stops fitting on the screen.
const INFO_W = 400, INFO_H = 300;

/**
 * Character select, forge-card edition: each hero IS a giant playing card —
 * rank corner = their initial, their suit for pips, card face for the body.
 * Hover: the card lifts off the table and the kit parchment slides out beside it.
 */
export class CharacterSelectScene extends Phaser.Scene {
  constructor() { super('CharacterSelect'); }

  create() {
    applyMobileCamera(this);   // no-op on desktop
    installLongPress(this);    // hold = hover on touch; no-op on desktop
    // Phaser scenes are SINGLETONS: a second visit re-runs create() on the same
    // instance, so every flag the picker sets has to be cleared right here.
    this.picker = null;
    this.pickerHero = null;
    this._infoFollow = null;   // the open kit parchment's walker, if any
    // chrId -> the two images (figure + cast shadow) on that hero's card. The
    // SKINS menu writes straight into this when a skin is equipped, so the card
    // behind the overlay changes under your hand instead of on the next visit.
    this.heroArt = {};
    window.__hfSelect = null;   // the verification hook must never outlive its plates
    window.__hfRow = null;
    playMusic(this, 'menu');
    addTavernBackdrop(this, 0.45);

    const back = this.add.text(48, 40, '◀  BACK', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: '#d8c9a8', stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    back.on('pointerover', () => { sfx(this, 'menu_select', { volume: 0.3, jitter: 0.05 }); back.setColor('#ffd23e'); });
    back.on('pointerout', () => back.setColor('#d8c9a8'));
    back.on('pointerdown', () => { sfx(this, 'button', { volume: 0.7 }); this.scene.start('Title'); });

    // ------------------------------------------------------------------
    // NO LOGO HERE ANY MORE.
    //
    // A second HANDFORGED wordmark, ten seconds after the one on the title
    // screen, told you nothing you did not already know and ate the top 300px
    // of a screen whose whole job is showing you five big cards. What replaces
    // it is one line that says what this screen is FOR, sharing the top strip
    // with BACK on the left and SKINS on the right.
    // ------------------------------------------------------------------
    legible(this.add.text(GAME_W / 2, 46, 'CHOOSE YOUR HERO', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: '#f0d9a0',
    }), { thickness: 6 }).setOrigin(0.5);
    this.add.text(GAME_W / 2, GAME_H - 30, 'hover a card to read the kit. click it to pick your difficulty.', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#d8c9a8', stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5);
    addSettingsButton(this);
    this.addSkinsButton();

    this.buildHeroRow();
  }

  /**
   * SKINS, from character select as well as the title screen (patch §3). It sits
   * left of the gear rather than in the card row: it is a wardrobe, not a hero,
   * and putting it in the row would make it the sixth thing you can "pick".
   */
  addSkinsButton() {
    const x = GAME_W - 200, y = 42;
    const btn = this.add.image(x, y, 'btn_gray').setDisplaySize(180, 54)
      .setDepth(DEPTH.overlay - 1).setInteractive({ useHandCursor: true });
    const txt = this.add.text(x, y - 3, 'SKINS', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#3a3020',
    }).setOrigin(0.5).setDepth(DEPTH.overlay - 1);
    const base = { ix: btn.scaleX, iy: btn.scaleY };
    btn.on('pointerover', () => {
      sfx(this, 'menu_select', { volume: 0.3, jitter: 0.05 });
      this.tweens.add({ targets: btn, scaleX: base.ix * 1.06, scaleY: base.iy * 1.06, duration: 110 });
    });
    btn.on('pointerout', () => this.tweens.add({ targets: btn, scaleX: base.ix, scaleY: base.iy, duration: 110 }));
    btn.on('pointerdown', () => {
      sfx(this, 'button', { volume: 0.8 });
      openSkins(this, { onEquip: (chrId) => this.repaintHero(chrId) });
    });
    return btn;
  }

  /**
   * Swap one card's model for whatever that hero is wearing now. Texture only —
   * position, scale, the idle bob and the locked treatment are all left exactly
   * as they were, because every skin is normalised to the hero's own footprint.
   */
  repaintHero(chrId) {
    const art = this.heroArt?.[chrId];
    if (!art) return;
    const key = heroTextureFor(chrId, k => this.textures.exists(k));
    art.sprite.setTexture(key);
    art.spriteShadow.setTexture(key);
    // A locked hero keeps his silhouette: setTexture drops nothing else, but the
    // tint is re-asserted here so the two can never come apart.
    if (!isCharacterUnlocked(chrId)) {
      art.sprite.setTintFill(0x5f5278).setAlpha(0.95);
      art.spriteShadow.setTint(0x120a06).setAlpha(0.4);
    }
  }

  // =========================================================================
  // THE ROW OF FORGE CARDS — and, from five heroes on, the rail it slides on.
  // -------------------------------------------------------------------------
  // Four cards fitted on a 1920 screen with room to spare. Five do not: the
  // row is 2176 wide and the outer two hang off both edges, half-readable and
  // half-clickable. Every fix that keeps all of them on screen at once shrinks
  // the card, and the giant card IS the screen, so instead the row SCROLLS and
  // the cards stay exactly the size they have always been.
  //
  // The rail is deliberately quiet. Nothing moves until you ask: a wheel, an
  // arrow key, or one of the two chevrons, which dim to a ghost when there is
  // nothing left past that edge. A chevron or an arrow key moves the row by one
  // whole card; the wheel is free-running because a wheel that snapped would
  // fight the hand on it. Both ends clamp, so you can never scroll into empty
  // tavern.
  // =========================================================================
  buildHeroRow() {
    const ids = Object.keys(CHARACTERS);
    // SIDE is 110 and not 20 because the chevrons live in that margin. At 34 the
    // left chevron sat squarely on the first card's CENTRE, which is both the
    // pixel a person aims at and the pixel every verification driver clicks —
    // the arrow ate the click and the run never started. The margin is now wider
    // than the arrow, so no card centre can ever hide under one.
    const cardW = CARD_W, gap = CARD_GAP;
    const step = cardW + gap;
    const totalW = ids.length * cardW + (ids.length - 1) * gap;
    const x0 = (GAME_W - totalW) / 2 + cardW / 2;

    const row = this.add.container(0, 0).setDepth(10);
    this.heroRow = row;
    const cards = ids.map((id, i) => this.makeHeroCard(x0 + i * step, ROW_Y, CHARACTERS[id], i));
    cards.forEach(c => row.add(c));

    // How far the row may travel. Positive shifts right (to reveal the first
    // card), negative shifts left (to reveal the last). A row that fits has both
    // ends at 0 and the whole rail is inert.
    const hi = SIDE + cardW / 2 - x0;
    const lo = GAME_W - SIDE - cardW / 2 - (x0 + (ids.length - 1) * step);
    const scrollable = hi - lo > 40;
    const maxX = scrollable ? hi : 0;
    const minX = scrollable ? lo : 0;
    // The row RESTS at its left end rather than centred. Centred looks tidier in
    // a screenshot and is worse to use: it hangs half of the first card and half
    // of the last one off opposite edges, so the two heroes that most need
    // reading are the two you cannot read. Starting at the beginning also makes
    // the right chevron mean something the moment you arrive.
    this.rowScroll = maxX;
    row.x = maxX;

    const chev = (x, dir) => {
      const t = this.add.text(x, ROW_Y, dir < 0 ? '◀' : '▶', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '64px', color: '#ffd23e',
        stroke: '#241505', strokeThickness: 8,
      }).setOrigin(0.5).setDepth(12).setAlpha(0).setInteractive({ useHandCursor: true });
      t.setShadow(0, 6, '#000000', 10, true, true);
      t.on('pointerover', () => { sfx(this, 'menu_select', { volume: 0.3, jitter: 0.05 }); t.setScale(1.14); });
      t.on('pointerout', () => t.setScale(1));
      t.on('pointerdown', () => { sfx(this, 'button', { volume: 0.6 }); slide(this.rowScroll - dir * step); });
      return t;
    };
    const left = scrollable ? chev(46, -1) : null;
    const right = scrollable ? chev(GAME_W - 46, 1) : null;

    const refreshChevrons = () => {
      // A chevron that cannot move the row is not offered. `left` points at
      // cards to the LEFT, which live at a HIGHER row.x.
      left?.setAlpha(this.rowScroll < maxX - 1 ? 1 : 0.18);
      right?.setAlpha(this.rowScroll > minX + 1 ? 1 : 0.18);
    };
    // Kinetic (2026-08-04): the shared float. The kin's position runs 0 at the
    // rail's REST (row.x = maxX) to maxX-minX at the far end, so a flick glides
    // and the ends rubber-band, exactly like every vertical shelf.
    const kin = kineticScroll(this, {
      max: maxX - minX,
      apply: (v) => {
        row.x = maxX - v;
        this.rowScroll = row.x;
        refreshChevrons();
        // The kit parchment is a SCENE-level object (see makeHeroCard: it has to
        // be, or the taller card's tilt and lift would drag it off screen), so
        // it does not ride the rail on its own. If one is open while the rail
        // glides, it is walked along by hand — otherwise it hangs in the air
        // next to a card that has already left.
        this._infoFollow?.(row.x);
      },
    });
    const slide = (to, instant = false) => {
      const target = maxX - Phaser.Math.Clamp(to, minX, maxX);
      if (instant) kin.set(target);
      else kin.glide(target);
    };
    this.slideHeroRow = slide;
    refreshChevrons();

    if (scrollable) {
      // The wheel scrolls the rail rather than the page, and a trackpad's
      // horizontal axis works too — deltaX on a two-finger swipe, deltaY on a
      // wheel, whichever the hardware sends.
      // BUSY means something is open ON TOP of the rail and owns the input:
      // the difficulty picker, or the SKINS menu. Scrolling the shelf you are
      // reading must not also scroll the row behind it, which reads as the
      // page coming apart under you.
      const busy = () => this.picker || this.__skinsOpen;
      this.input.on('wheel', (p, over, dx, dy) => {
        if (busy()) return;
        const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        kin.wheel(d);
      });
      this.input.keyboard?.on('keydown-LEFT', () => !busy() && slide(this.rowScroll + step));
      this.input.keyboard?.on('keydown-RIGHT', () => !busy() && slide(this.rowScroll - step));

      // CLICK AND DRAG THE RAIL. The wheel and the chevrons both ask you to
      // find a control; dragging is the gesture you already use on the hand and
      // on the artifact row, so the shelf should answer to it too. A drag only
      // begins once the pointer has travelled DRAG_ARM px, so a plain click on
      // a hero card still picks that hero rather than nudging the row.
      const DRAG_ARM = 10;
      let grab = null;
      this.input.on('pointerdown', (p) => {
        if (busy()) return;
        grab = { x: p.x, armed: false };
        kin.grab(p.x);
      });
      this.input.on('pointermove', (p) => {
        if (!grab || !p.isDown || busy()) return;
        const dx = p.x - grab.x;
        if (!grab.armed && Math.abs(dx) < DRAG_ARM) return;
        grab.armed = true;
        this.__rowDragged = true;      // read by the card's own click guard
        kin.move(p.x);
      });
      this.input.on('pointerup', () => {
        grab = null;
        kin.release();                 // ...and the fling carries the rail on
        // Cleared a beat later: the card's pointerup fires in the same tick and
        // has to still see that this gesture was a drag, not a pick.
        this.time.delayedCall(0, () => { this.__rowDragged = false; });
      });
    }

    // ------------------------------------------------------------------
    // THE DEAL. The hand fans onto the table on the way in.
    //
    // ONE sfx for the batch, not one per card: five deals in half a second is a
    // rattle, and the combat table already treats a dealt hand as a single
    // flourish. The whole thing is over in 680ms and it GATES NOTHING — the
    // cards are interactive from frame one, every hit area is the card's own,
    // and the rail's published geometry is arithmetic (x0 + i*step) rather than
    // a read of where the sprite happens to be mid-flight, so a driver that
    // clicks during the deal still clicks the right hero.
    //
    // That last sentence is only TRUE because the tween below moves each
    // card's `deal` child rather than the card. See the block that builds it
    // at the end of makeHeroCard for what happened when it moved the card.
    // ------------------------------------------------------------------
    sfx(this, 'card_deal', { volume: 0.5, jitter: 0.04 });
    cards.forEach((c, i) => {
      const f = c.deal ?? c;
      f.setPosition(620, -150).setAngle(14).setAlpha(0);
      this.tweens.add({
        targets: f, x: 0, y: 0, angle: 0, alpha: 1,
        delay: i * 70, duration: 400, ease: 'Cubic.easeOut',
      });
    });

    // Debug hook for the drivers: the rail's state, as plain scalars.
    // `cardPos` and `cardSize` exist so a driver never has to know that a card
    // is 460 wide or that the row sits at y 548 — both moved once already.
    window.__hfRow = {
      count: ids.length, scrollable, min: minX, max: maxX,
      w: CW, h: CH, y: ROW_Y,
      at: () => this.rowScroll,
      slide: (to) => { slide(to); return this.rowScroll; },
      cardSize: () => ({ w: CW, h: CH }),
      cardPos: (i) => ({ x: Math.round(x0 + i * step + this.rowScroll), y: ROW_Y }),
      cards: () => ids.map((id, i) => ({
        id, unlocked: isCharacterUnlocked(id),
        x: Math.round(x0 + i * step + this.rowScroll), y: ROW_Y,
      })),
    };
  }

  /**
   * ONE CHAIN, drawn as links along a line.
   *
   * The GUI Pro pack — all 4,528 files of it — has eleven padlocks and no chain
   * whatsoever, so the links are Graphics textures generated in BootScene next
   * to the padlock that has always been generated there. There are TWO of them
   * and they alternate: an oval seen face-on, then a short bar seen edge-on.
   * That alternation is the whole trick of drawing a chain in two dimensions
   * (one texture squashed on X gives a sliver, not a bar). The run is built
   * flat and then rotated, so the same function draws both arms of the cross.
   */
  chainRun(parent, len, angle) {
    const c = this.add.container(0, 0).setAngle(angle);
    const step = 16 * K;
    const n = Math.floor(len / step);
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + i * step;
      c.add(this.add.image(t, 0, i % 2 ? 'chain_link_side' : 'chain_link').setScale(0.62 * K));
    }
    parent.add(c);
    return c;
  }

  makeHeroCard(x, y, ch, index) {
    const open = isCharacterUnlocked(ch.id);
    const suitColor = SUIT_COLORS[ch.suit];
    const card = this.add.container(x, y);

    // Table glow under the card (suit-colored, blooms on hover). A locked hero
    // gets no colour off the table either — the whole plate is out of the fire.
    const glow = this.add.image(0, 12, 'fx_glow').setTint(open ? suitColor : 0x3a2f4a)
      .setAlpha(0.16).setDisplaySize(CW * 1.6, CH * 1.25);
    card.add(glow);

    // Caleb's painted hero card IS the panel; the hero plops on top of it.
    const cardShadow = this.add.image(15, 22, 'cardbg_' + ch.id).setDisplaySize(CW, CH).setTint(0x000000).setAlpha(0.4);
    card.add(cardShadow);
    const bg = this.add.image(0, 0, 'cardbg_' + ch.id).setDisplaySize(CW, CH);
    // The RECORDS shelf's and the difficulty picker's locked plate tint, to the
    // number. The figure's own silhouette colour has to differ — see below.
    if (!open) bg.setTint(0x2a2136);
    card.add(bg);

    // The hero, standing big on the card — with a solid cast shadow.
    // heroG carries the hover motion; the idle bob rides the sprite INSIDE it,
    // so the two tweens never fight (the old fight = the teleport jump).
    card.add(this.add.image(0, 168 * K, 'fx_glow').setTint(0x1a1006).setAlpha(0.5).setScale(1.5 * K, 0.42 * K));
    const heroG = this.add.container(0, -26 * K);
    // THE SKIN, not the shipped model, if one is worn. Same 900x850 canvas, and
    // the scale is the shipped 0.385 times K, because tools/normalize_skin_art.py
    // measured every skin to this hero's own figure height and stood it on this
    // hero's ground line — the whole figure grows with the card or none of it does.
    const modelKey = heroTextureFor(ch.id, k => this.textures.exists(k));
    const spriteShadow = this.add.image(9 * K, 12 * K, modelKey).setScale(0.385 * K).setTint(0x120a06).setAlpha(0.4);
    const sprite = this.add.image(0, 0, modelKey).setScale(0.385 * K);
    this.heroArt[ch.id] = { sprite, spriteShadow };
    // The RECORDS shelf silhouettes its heroes in 0x1c1626 because they stand on
    // PARCHMENT. This card is tinted almost to black, so the same value would
    // be a hero-shaped nothing — the silhouette goes LIGHTER than its plate
    // instead, which is the same idea pointed the other way.
    if (!open) sprite.setTintFill(0x5f5278).setAlpha(0.95);
    heroG.add(spriteShadow);
    heroG.add(sprite);
    card.add(heroG);
    // KNOWN TRAP, and it is still here: the idle bob rides the sprite CHILD and
    // the hover rides the heroG PARENT. Point them at the same object and the
    // model teleports the instant the mouse arrives.
    this.tweens.add({
      targets: sprite, y: -9 * K, duration: 1700 + index * 240,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Name straight on the card art — big, shadowed, no plate. A locked hero
    // keeps his silence: ??? and the line that tells you how to earn him.
    const need = ACHIEVEMENT_BY_ID[ch.unlock];
    const nameText = this.add.text(0, 212, open ? ch.name : '???', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '56px',
      color: open ? '#fff6e0' : '#6b5a80', stroke: '#241505', strokeThickness: 10,
    }).setOrigin(0.5);
    nameText.setShadow(0, 8, '#000000', 12, true, true);
    card.add(nameText);
    const titleText = this.add.text(0, 266, open ? ch.title : 'A HERO YET UNFORGED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '28px',
      color: open ? '#f0e2c0' : '#8a78a0', stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5);
    titleText.setShadow(0, 6, '#000000', 10, true, true);
    card.add(titleText);

    // ------- THE CHAINS. Two runs crossing at the padlock. -------
    if (!open) {
      const chains = this.add.container(0, 0);
      // Corner to corner exactly: the two runs terminate ON the card rather
      // than trailing off into the tavern behind it.
      const diag = Math.hypot(CW, CH);
      const a = (Math.atan2(CH, CW) * 180) / Math.PI;
      this.chainRun(chains, diag, a);
      this.chainRun(chains, diag, -a);
      card.add(chains);
      const lockShadow = this.add.image(9, 12, 'icon_lock').setScale(2.5 * K).setTint(0x000000).setAlpha(0.45);
      const lock = this.add.image(0, 0, 'icon_lock').setScale(2.5 * K);
      card.add(lockShadow);
      card.add(lock);
      this.tweens.add({
        targets: [lock, lockShadow], y: '+=9', duration: 1900 + index * 220,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // The call to action lives BELOW the card: huge, gold, unmissable.
    const playHint = this.add.text(0, CH / 2 + 56, open ? '▶  PLAY THIS HAND' : '🔒  LOCKED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '40px',
      color: open ? '#ffd23e' : '#8a78a0', stroke: '#241505', strokeThickness: 9,
    }).setOrigin(0.5).setAlpha(0);
    playHint.setShadow(0, 8, '#000000', 12, true, true);
    card.add(playHint);

    // ------------------------------------------------------------------
    // THE KIT PARCHMENT — beside the card now, not above it.
    //
    // It used to float over the card's top edge, which worked when the card was
    // 560 tall and stopped working the moment it became 690: a 300px panel
    // hanging off a card whose top is already at y 203 (163 while hovered) would
    // have gone off the top of the canvas, and clamping it back down would have
    // parked it squarely on the painted face it is describing. So it SLIDES OUT
    // SIDEWAYS instead — INWARD, toward the middle of the screen, which is where
    // the room is: a card near an edge has empty tavern on one side and four
    // more cards on the other. Clamped anyway, so it can never hang off one.
    //
    // It also lives on the SCENE rather than inside the card. As a child it
    // inherited the hover lift, the 1.045 scale and the ±1.2° tilt, all three of
    // which fight a panel that is trying to hold still at a computed screen
    // position; and a later sibling card would have drawn straight over it.
    // The cost is that it does not ride the rail for free, which is what
    // `_infoFollow` in buildHeroRow pays for.
    // ------------------------------------------------------------------
    const info = this.add.container(0, y).setAlpha(0).setDepth(20).setVisible(false);
    const parts = woodPanel(this, 0, 0, INFO_W, INFO_H, { accent: open ? suitColor : 0x3a2f4a });
    info.add([parts.shadow, parts.panel, parts.line]);
    if (!open) parts.panel.setTint(0x2a2136);
    // A LOCKED CARD SAYS HOW, not what. `ch.unlockHint` overrides the trophy's
    // line for the one hero whose trophy is deliberately a riddle; every other
    // locked hero still reads its achievement hint, which is already a plain
    // instruction. See CHARACTERS.venomancer.
    info.add(this.add.text(0, -INFO_H / 2 + 24, open ? ch.kit : (ch.unlockHint ?? need?.hint ?? 'Not yet forged.'), {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '22px',
      color: open ? PARCH.text : '#8a78a0', fontStyle: 'bold',
      wordWrap: { width: INFO_W - 50 }, align: 'center',
    }).setOrigin(0.5, 0));
    if (open) {
      let rowY = -16;
      for (const note of ch.suitNotes) {
        const rowPip = this.add.image(-INFO_W / 2 + 35, rowY, SUIT_PIP_KEY[note.suit]).setTint(SUIT_COLORS[note.suit]);
        rowPip.setScale(27 / Math.max(rowPip.width, rowPip.height));
        info.add(rowPip);
        info.add(this.add.text(-INFO_W / 2 + 62, rowY, note.text, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: PARCH.text,
        }).setOrigin(0, 0.5));
        rowY += 40;
      }
    } else {
      info.add(this.add.text(0, -8, 'UNLOCK THIS HERO', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '28px', color: '#6b5a80',
      }).setOrigin(0.5));
      info.add(this.add.image(0, 66, 'icon_lock').setScale(1.0));
    }

    // ------- Interaction: the card lifts off the tavern table -------
    // THE HIT AREA IS ITS OWN OBJECT, and it is deliberately NOT the painted
    // card. `bg` rides the `flight` container built at the end of this method,
    // which is what the deal animates; a hit area parented to that would travel
    // with it and be a card-and-a-bit to the right of where the card looks for
    // the first 680ms. This rectangle is parented to `card` itself, which never
    // moves, so the clickable rectangle is where __hfRow says it is from frame
    // one. It is invisible (fillAlpha 0) but its own alpha is 1, which is what
    // Phaser's hit test actually reads.
    const hit = this.add.rectangle(0, 0, CW, CH, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    // The hero is only STEP ONE now: picking a card opens the difficulty page
    // over the top of the tavern. The run itself starts from there.
    const start = () => {
      if (this.picker) return;
      // Locked: the same pitched-down refusal the difficulty ladder uses, and
      // the parchment above the card is already saying why.
      if (!open) { sfx(this, 'button', { volume: 0.4, rate: 0.8 }); return; }
      sfx(this, 'hand_play', { volume: 0.49 });
      // Put the parchment away on the way out. The difficulty page's dimmer
      // goes over the top of it, so the pointer never leaves the card and
      // pointerout never fires: without this it sits there behind the overlay
      // as a ghost for as long as you shop difficulties.
      if (this._infoFollow === placeInfo) this._infoFollow = null;
      this.tweens.add({
        targets: info, alpha: 0, duration: 120,
        onComplete: () => info.setVisible(false),
      });
      this.tweens.add({ targets: card, y: y - 60, scale: 1.06, duration: 220, ease: 'Cubic.easeOut' });
      this.openDifficultyPicker(ch, () => {
        this.tweens.add({ targets: card, y, scale: 1, angle: 0, duration: 200 });
      });
    };
    // ON RELEASE, NOT ON PRESS. The rail is draggable now, so a press that
    // turns into a drag must scroll rather than commit you to a hero. This is
    // the same rule the combat hand already follows: act on the up, and skip it
    // if the gesture turned out to be a drag.
    // ...and skip it after a HOLD too (mobile): holding a card reads the kit,
    // exactly like a mouse hover; only a clean tap commits.
    hit.on('pointerup', () => { if (!this.__rowDragged && !this._touchHoldFired) start(); });

    /**
     * Where the parchment stands, for a given rail offset. Toward the middle of
     * the screen first, then clamped to the canvas — the clamp only ever bites
     * for a card sitting near an edge, and when it does the panel is still
     * clear of the card, because the card is near that edge too.
     */
    const placeInfo = (rowX) => {
      const worldX = x + rowX;
      const half = INFO_W / 2;
      const out = worldX < GAME_W / 2 ? 1 : -1;
      const px = Phaser.Math.Clamp(
        worldX + out * (CW / 2 + 20 + half), half + 14, GAME_W - half - 14);
      info.x = px;
      return px;
    };

    hit.on('pointerover', () => {
      sfx(this, 'card_hover', { volume: 0.42, jitter: 0.08 });
      this.tweens.add({ targets: card, y: y - 40, scale: 1.045, angle: index % 2 === 0 ? -1.2 : 1.2, duration: 170, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: glow, alpha: 0.72, duration: 180 });
      this.tweens.add({ targets: playHint, alpha: 1, duration: 170 });
      this.tweens.add({ targets: heroG, y: 42, scale: 0.82, duration: 200, ease: 'Sine.easeOut' });
      // A puff of the hero's own suit off the table as the card comes up.
      const worldX = x + (this.heroRow?.x ?? 0);
      burst(this, worldX, y + CH * 0.3, open ? suitColor : 0x6b5a80, 9);

      const px = placeInfo(this.heroRow?.x ?? 0);
      this._infoFollow = placeInfo;
      info.setVisible(true);
      // The panel slides the last few pixels outward as it fades up, so it reads
      // as being drawn out of the card rather than switched on next to it.
      info.x = px - (px >= worldX ? 1 : -1) * 26;
      this.tweens.add({ targets: info, alpha: 1, x: px, duration: 180, ease: 'Cubic.easeOut' });
    });
    hit.on('pointerout', () => {
      this.tweens.add({ targets: card, y, scale: 1, angle: 0, duration: 170 });
      this.tweens.add({ targets: glow, alpha: 0.16, duration: 180 });
      this.tweens.add({ targets: playHint, alpha: 0, duration: 150 });
      this.tweens.add({ targets: heroG, y: -26 * K, scale: 1, duration: 200, ease: 'Sine.easeOut' });
      // ...but only if the pointer has not already arrived on the NEXT card:
      // Phaser dispatches this frame's overs before its outs, so a slide from
      // one card to its neighbour would otherwise leave the new panel orphaned
      // from the rail.
      if (this._infoFollow === placeInfo) this._infoFollow = null;
      this.tweens.add({
        targets: info, alpha: 0, duration: 150,
        onComplete: () => { if (info.alpha < 0.02) info.setVisible(false); },
      });
    });

    // ------------------------------------------------------------------
    // THE DEAL FLIES A CHILD, NOT THE CARD.
    //
    // buildHeroRow's deal used to fan the CARD container itself in from
    // (+620, -150). A container's transform carries its children's HIT AREAS
    // with it, so for the 680ms of the deal every card's clickable rectangle
    // was a card-and-a-bit to the right of where it looked — which is to say
    // on top of its neighbour. Clicking a hero during the deal picked the
    // wrong one, or, at the moment the fan was half-eased, landed in the gap
    // between two in-flight cards and picked nobody. Every driver that reads
    // __hfRow and clicks the instant the hook appears hit exactly that.
    //
    // It also fought the hover and press tweens, which animate `card.y` to
    // its REST y — hovering a card mid-deal teleported it home.
    //
    // Everything visual now hangs off `flight`, and `card` never leaves the
    // rest position. That is what makes __hfRow.cardPos() true from frame
    // one, as its own comment always claimed it was.
    // ------------------------------------------------------------------
    const kids = [...card.list];
    const flight = this.add.container(0, 0);
    flight.add(kids);
    card.add(flight);
    // ...and the hit area goes on LAST, as a direct child of the card, so it
    // sits above the artwork and stays behind while the artwork flies in.
    card.add(hit);
    card.deal = flight;
    return card;
  }

  // =========================================================================
  // STEP TWO: THE DIFFICULTY PAGE
  // -------------------------------------------------------------------------
  // Built as an overlay on THIS scene rather than a scene of its own: the hero
  // cards stay exactly where they were, so BACK is a destroy() and not a
  // rebuild, and the tavern never has to be re-created.
  //
  // The ladder is PER HERO (progress.difficultyCleared), so the plates are
  // rebuilt for whichever card was clicked. Locked plates use the RECORDS
  // shelf's treatment: blacked-out silhouette plus the lock icon.
  // =========================================================================

  openDifficultyPicker(ch, onBack) {
    if (this.picker) return;
    this.pickerHero = ch;
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay + 4);
    this.picker = ov;

    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.93)
      .setInteractive();   // swallow every click meant for the hero cards behind
    ov.add(dim);

    ov.add(this.add.text(GAME_W / 2, 96, 'CHOOSE YOUR DIFFICULTY', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '52px', color: '#fff6e0',
      stroke: '#241505', strokeThickness: 8,
    }).setOrigin(0.5));
    ov.add(this.add.text(GAME_W / 2, 150, `${ch.name} is ready. Pick the forge you want to be tested in.`, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: '#d8c9a8', fontStyle: 'bold',
    }).setOrigin(0.5));

    const top = highestDifficultyUnlocked(ch.id);
    this.pickerChoice = top;

    // ------- the detail parchment (built first so the plates can write to it) -------
    const detail = woodPanel(this, GAME_W / 2, 712, 1000, 300, { accent: 0xffc542 });
    ov.add([detail.shadow, detail.panel, detail.line]);
    const detailName = this.add.text(GAME_W / 2, 606, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: PARCH.text,
    }).setOrigin(0.5);
    ov.add(detailName);
    // Five always-present numbers in two columns of three, then the extras
    // (boss punch, boss reward) underneath in the accent ink.
    const detailLines = [];
    for (let i = 0; i < 6; i++) {
      const col = (i / 3) | 0, row = i % 3;
      const t = this.add.text(GAME_W / 2 - 400 + col * 420, 660 + row * 40, '', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '25px', color: PARCH.text, fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      ov.add(t);
      detailLines.push(t);
    }
    // 754, not 764: the extras block can be THREE lines now (no live hand math,
    // bosses hit harder, bosses pay no reward) and three at 34px from 764 ran
    // 4px past the parchment's own bottom edge.
    const detailExtra = this.add.text(GAME_W / 2, 754, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: '#a3541c',
      align: 'center', lineSpacing: 4,
    }).setOrigin(0.5, 0);
    ov.add(detailExtra);

    const showDetail = (index) => {
      const d = DIFFICULTIES[index];
      const open = isDifficultyUnlocked(ch.id, index);
      detailName.setText(d.name);
      detailName.setColor(open ? PARCH.text : PARCH.textDim);
      // The first five lines are the always-present numbers.
      const nums = d.lines.slice(0, 5);
      detailLines.forEach((t, i) => t.setText(nums[i] ?? ''));
      const extra = d.lines.slice(5);
      if (!open) {
        const need = DIFFICULTIES[Math.max(0, index - 1)].name;
        // PARCH.textDim, not a lighter tan: this is the line that tells you WHY
        // the mode is closed, so it is the last thing that should be faint.
        detailExtra.setText(`LOCKED. Clear Act III with ${ch.name} on ${need}.`).setColor(PARCH.textDim);
      } else {
        detailExtra.setText(extra.join('\n')).setColor('#a3541c');
      }
    };

    // ------- the six plates -------
    const PW = 280, PH = 250, GAP = 18;
    const totalW = DIFFICULTIES.length * PW + (DIFFICULTIES.length - 1) * GAP;
    const x0 = (GAME_W - totalW) / 2 + PW / 2;
    const plates = DIFFICULTIES.map((d, i) => this.makeDifficultyPlate(
      ov, ch, d, x0 + i * (PW + GAP), 380, PW, PH, showDetail, () => select(i)));

    const select = (index) => {
      if (!isDifficultyUnlocked(ch.id, index)) {
        sfx(this, 'button', { volume: 0.4, rate: 0.8 });
        return;
      }
      this.pickerChoice = index;
      plates.forEach((p, i) => p.setChosen(i === index));
      showDetail(index);
      sfx(this, 'menu_select', { volume: 0.5 });
    };
    plates.forEach((p, i) => p.setChosen(i === top));
    showDetail(top);

    // ------- BACK and BEGIN -------
    const mkBtn = (x, key, label, color, w, cb) => {
      const b = this.add.image(x, 962, key).setDisplaySize(w, 74).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, 958, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color,
      }).setOrigin(0.5);
      const base = { ix: b.scaleX, iy: b.scaleY };
      b.on('pointerover', () => {
        sfx(this, 'menu_select', { volume: 0.3, jitter: 0.05 });
        this.tweens.add({ targets: b, scaleX: base.ix * 1.05, scaleY: base.iy * 1.05, duration: 110 });
      });
      b.on('pointerout', () => this.tweens.add({ targets: b, scaleX: base.ix, scaleY: base.iy, duration: 110 }));
      b.on('pointerdown', () => { sfx(this, 'button', { volume: 0.8 }); cb(); });
      ov.add(b); ov.add(t);
      return b;
    };

    mkBtn(GAME_W / 2 - 300, 'btn_dark', '◀  BACK', '#cfc8e8', 260, () => this.closeDifficultyPicker(onBack));
    mkBtn(GAME_W / 2 + 220, 'btn_yellow', 'BEGIN THE RUN', '#5b3a00', 400, () => this.beginRun(ch));

    // ------- SEED (optional) -------------------------------------------------
    // A canvas game has no <input>, so the field is drawn: click it, type, and
    // the keyboard goes to the seed until you click away. It lives on the
    // button row, in the empty stretch LEFT of BACK — under the parchment it
    // collided with the panel's bottom rail on one side and BACK on the other.
    this.buildSeedField(ov, 250, 958);

    // Debug hook for tools/verify_difficulty.py: the plates, as plain data.
    window.__hfSelect = {
      scene: this,
      difficulty: () => ({
        hero: ch.id,
        chosen: this.pickerChoice,
        unlocked: DIFFICULTIES.map((d, i) => isDifficultyUnlocked(ch.id, i)),
        names: DIFFICULTIES.map(d => d.name),
      }),
      platePos: (i) => ({ x: x0 + i * (PW + GAP), y: 380 }),
      pick: (i) => { select(i); return this.pickerChoice; },
      begin: () => this.beginRun(ch),
      seed: (v) => (v === undefined ? this._seedField?.get() : this._seedField?.set(v)),
    };

    ov.setAlpha(0);
    this.tweens.add({ targets: ov, alpha: 1, duration: 200, ease: 'Sine.easeOut' });
  }

  /**
   * THE SEED FIELD (JC, 2026-08-04): "an optional fillable text spot".
   *
   * A drawn text box on the difficulty page. Click to focus, type a seed,
   * click anywhere else to blur; ENTER blurs too. Same seed, same worlds, same
   * maps, same bosses — and NO trophies, which the caption owns up to the
   * moment a seed exists rather than after the run is over.
   *
   * The typed value lives on the SCENE (`this.seedText`) so it survives the
   * picker being closed and reopened while you shop heroes; beginRun consumes
   * it, and starting an unseeded run afterwards types nothing.
   */
  buildSeedField(ov, cx, cy) {
    const W = 260, H = 46;
    const label = this.add.text(cx - W / 2, cy - 42, 'SEED  (optional)', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '18px', color: '#d8c9a8',
      stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0, 0.5);
    ov.add(label);
    const box = this.add.rectangle(cx, cy, W, H, 0x241b30, 0.92)
      .setStrokeStyle(3, 0x8a6a34).setInteractive({ useHandCursor: true });
    ov.add(box);
    const text = this.add.text(cx - W / 2 + 14, cy, this.seedText ?? '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: '#ffd23e',
    }).setOrigin(0, 0.5);
    ov.add(text);
    const hint = this.add.text(cx - W / 2, cy + 38, 'Seeded runs earn no trophies.', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '16px', color: '#a3541c', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setAlpha(this.seedText ? 1 : 0);
    ov.add(hint);
    const caret = this.add.rectangle(0, cy, 3, 26, 0xffd23e).setAlpha(0);
    ov.add(caret);
    this.tweens.add({ targets: caret, alpha: { from: 0, to: 1 }, duration: 430, yoyo: true, repeat: -1 });

    const paint = () => {
      text.setText(this.seedText ?? '');
      const empty = !(this.seedText?.length);
      // The placeholder is drawn IN the box rather than as a second object.
      if (empty && !this._seedFocus) text.setText('type a seed...').setColor('#6b5a80');
      else text.setColor('#ffd23e');
      caret.setX(text.x + (empty && !this._seedFocus ? 0 : text.width) + 4);
      caret.setVisible(!!this._seedFocus);
      hint.setAlpha(this.seedText?.length ? 1 : 0);
      box.setStrokeStyle(3, this._seedFocus ? 0xffd23e : 0x8a6a34);
    };

    const blur = () => {
      if (!this._seedFocus) return;
      this._seedFocus = false;
      this.input.keyboard?.off('keydown', onKey);
      if (box.active) paint();
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter' || ev.key === 'Escape') return blur();
      if (ev.key === 'Backspace') this.seedText = (this.seedText ?? '').slice(0, -1);
      else if (/^[a-zA-Z0-9 -]$/.test(ev.key) && (this.seedText ?? '').length < 24) {
        this.seedText = (this.seedText ?? '') + ev.key.toUpperCase();
      } else return;
      ev.stopPropagation?.();
      paint();
    };
    box.on('pointerdown', () => {
      if (this._seedFocus) return;
      this._seedFocus = true;
      sfx(this, 'card_select', { volume: 0.3 });
      this.input.keyboard?.on('keydown', onKey);
      paint();
    });
    // A click anywhere that is not the box lets the keyboard go again. The
    // picker's dimmer, the plates and the buttons all count as "anywhere".
    this.input.on('pointerdown', (p, over) => { if (!over?.includes?.(box)) blur(); });
    // The overlay can be destroyed with the field focused (BACK, BEGIN); the
    // key listener must not outlive it and type into nothing.
    box.once('destroy', blur);

    paint();
    // Driver hook: read/type the seed without faking keyboard events.
    this._seedField = {
      get: () => this.seedText ?? '',
      set: (v) => { this.seedText = String(v ?? '').toUpperCase().slice(0, 24); paint(); return this.seedText; },
    };
  }

  /**
   * One plate. Returns a tiny handle with `setChosen` so the picker can move
   * the highlight without knowing how the plate is built.
   */
  makeDifficultyPlate(ov, ch, d, x, y, w, h, onHover, onPick) {
    const open = isDifficultyUnlocked(ch.id, d.index);
    const g = this.add.container(x, y);
    ov.add(g);

    const parts = woodPanel(this, 0, 0, w, h, { accent: open ? d.color : 0x3a2f4a });
    g.add([parts.shadow, parts.panel, parts.line]);
    if (!open) parts.panel.setTint(0x2a2136);

    // Colored name band. Pale metals (PLATINUM) need dark ink on them, dark
    // ones need pale ink, so the band picks its own contrast rather than
    // trusting one hardcoded colour to work for all six.
    const bright = ((d.color >> 16 & 255) * 0.299 + (d.color >> 8 & 255) * 0.587 + (d.color & 255) * 0.114) / 255;
    const band = this.add.rectangle(0, -h / 2 + 52, w - 46, 50, open ? d.color : 0x1c1626);
    g.add(band);
    g.add(this.add.text(0, -h / 2 + 50, d.name, {
      fontFamily: 'Lilita One', resolution: 2,
      fontSize: d.name.length > 7 ? '26px' : '30px',
      color: open ? (bright > 0.62 ? '#2a2136' : '#fff6e0') : '#6b5a80',
    }).setOrigin(0.5));

    if (open) {
      const rows = [
        `${d.hands} hands`,
        `${d.discards} discards`,
        `${d.handSize} cards in hand`,
        `Enemy HP x${Number(d.enemyHp.toFixed(2))}`,
        `Chips x${Number(d.gold.toFixed(2))}`,
      ];
      rows.forEach((line, i) => g.add(this.add.text(0, -34 + i * 30, line, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.text, fontStyle: 'bold',
      }).setOrigin(0.5)));
    } else {
      // The RECORDS-shelf treatment: a blacked-out silhouette with the lock
      // sitting on it, and ??? where the promise would be.
      const sil = this.add.image(0, 6, `silhouette_${(d.index % 3) + 1}`).setTintFill(0x1c1626).setAlpha(0.85);
      sil.setScale(120 / Math.max(sil.width, sil.height));
      g.add(sil);
      const lock = this.add.image(0, 34, 'icon_lock').setScale(0.9);
      g.add(lock);
      g.add(this.add.text(0, h / 2 - 34, '???', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#6b5a80',
      }).setOrigin(0.5));
      this.tweens.add({ targets: sil, y: 0, duration: 1700 + d.index * 220, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // A ring that only shows on the chosen plate, so the highlight reads at a
    // glance without moving anything (the row must not jump as you scan it).
    const chosenRing = this.add.nineslice(0, 0, 'panel_line', 0, w + 16, h + 16, 34, 34, 34, 34)
      .setTint(0xffd23e).setAlpha(0);
    g.add(chosenRing);

    parts.panel.setInteractive({ useHandCursor: true });
    parts.panel.on('pointerover', () => {
      onHover(d.index);
      this.tweens.add({ targets: g, y: y - 12, duration: 130, ease: 'Sine.easeOut' });
    });
    parts.panel.on('pointerout', () => this.tweens.add({ targets: g, y, duration: 130 }));
    parts.panel.on('pointerdown', onPick);

    return {
      setChosen: (on) => {
        this.tweens.add({ targets: chosenRing, alpha: on ? 1 : 0, duration: 140 });
        band.setAlpha(on || !open ? 1 : 0.9);
      },
    };
  }

  closeDifficultyPicker(onBack) {
    const ov = this.picker;
    this.picker = null;
    this.pickerHero = null;
    window.__hfSelect = null;
    if (ov) {
      this.tweens.add({ targets: ov, alpha: 0, duration: 150, onComplete: () => ov.destroy(true) });
    }
    onBack?.();
  }

  beginRun(ch) {
    if (!this.picker) return;
    const mode = this.pickerChoice ?? 0;
    if (!isDifficultyUnlocked(ch.id, mode)) return;
    this.picker = null;              // one press only, however fast the click
    // The seed is CONSUMED: the next picker opens blank, because "same seed
    // again" should be a decision you retype, not a default you forgot about.
    const seed = this.seedText ?? null;
    this.seedText = '';
    newRun(ch.id, mode, seed);
    sfx(this, 'hand_play', { volume: 0.55 });
    this.cameras.main.fadeOut(260, 20, 16, 28);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Map'));
  }
}
