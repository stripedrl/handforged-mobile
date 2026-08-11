import {
  GAME_W, GAME_H, DEPTH, CHARACTERS, SUIT_COLORS, SUIT_PIP_KEY, SUIT_GLYPH, PARCH, SAFE, TOUCH,
  applyMobileCamera,
} from '../config.js';
import { installPointerPolicy } from '../ui/pointer.js';
// `hoverInfo` is THE binder for every hover that shows INFORMATION, and it
// binds nothing on a finger (ui/touch.js). `tapInfo` is its touch counterpart:
// tap to open a persistent panel, tap again or tap away to dismiss.
import { installLongPress, hoverInfo } from '../ui/touch.js';
import { tapInfo } from '../ui/choicebox.js';
import { woodPanel } from '../ui/panels.js';
import { addTavernBackdrop } from '../ui/tavern.js';
import { playMusic } from '../core/music.js';
import {
  addSettingsButton, COG_HOME,
  chromeButtons, chromeBox, chromeObjBox, chromeCollisions, chromeDupLabels,
} from '../ui/settingsMenu.js';
import { sfx } from '../core/sfx.js';
import { newRun, run } from '../core/run.js';
import { DIFFICULTIES } from '../core/difficulty.js';
import { highestDifficultyUnlocked, isDifficultyUnlocked, isCharacterUnlocked } from '../core/progress.js';
import { ACHIEVEMENT_BY_ID } from '../core/achievements.js';
import { heroTextureFor, equippedSkin } from '../core/skins.js';
// DEFERRED ART (core/lazyload.js). Picking a hero is the first moment the game
// knows WHICH hero's painted deck and WHICH skin it will need, and the
// difficulty page is a screen of pure dead time to fetch them in.
import { ensure, heroCardfaces, skinBundle, runStartBundle } from '../core/lazyload.js';
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
const CARD_W = 495, CARD_GAP = 48;
/**
 * THE RAIL'S SIDE MARGIN — the strip the chevrons live in, and therefore the
 * strip the outermost card is NOT allowed to rest in.
 *
 * 110 on desktop, unchanged since the day the arrows were moved out of the
 * first card's centre. On TOUCH it has to be bigger, and the reason is the safe
 * frame rather than the arrows: config.SAFE.x pulls anything interactive 96px
 * in from the glass, so a chevron at x=46 (which is where they shipped) is
 * standing 50px inside a margin the phone will not let it have. Move the
 * chevron in without moving the margin and it lands ON the first card's left
 * edge instead — the exact failure the 110 was introduced to fix, one arrow
 * further along. So the margin moves with it: 170 puts the chevron's box at
 * 100..164 and the resting card's left edge at 187, which is daylight on both
 * canvases (2340 and 1920 alike, because every term here is GAME_W-relative).
 */
const SIDE = TOUCH ? 170 : 110;
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
    installPointerPolicy(this);   // right-click never acts, anywhere
    // Phaser scenes are SINGLETONS: a second visit re-runs create() on the same
    // instance, so every flag the picker sets has to be cleared right here.
    this.picker = null;
    this.pickerHero = null;
    this._infoFollow = null;   // the open kit parchment's walker, if any
    this._downOnHero = null;   // which card the live gesture PRESSED, if any
    // chrId -> the two images (figure + cast shadow) on that hero's card. The
    // SKINS menu writes straight into this when a skin is equipped, so the card
    // behind the overlay changes under your hand instead of on the next visit.
    this.heroArt = {};
    window.__hfSelect = null;   // the verification hook must never outlive its plates
    window.__hfRow = null;
    window.__hfSelectChrome = null;   // ...and neither must the chrome audit's
    this.chevrons = null;
    this._heroCardBoxes = null;
    playMusic(this, 'menu');
    addTavernBackdrop(this, 0.45);
    /**
     * THE MODELS THE PROFILE IS ACTUALLY WEARING (2026-08-06, deferred loading).
     *
     * The fifty skins left the boot set, and this rail is the one screen that
     * draws several of them at once — one per hero, whichever each is wearing.
     * The card falls back to the shipped model on its own (heroTextureFor takes
     * `textures.exists` precisely so a missing PNG degrades instead of drawing a
     * green box), so this is POP-IN and not a gate: the rail deals immediately
     * and each card repaints the moment its skin lands.
     *
     * `repaintHero` is the same one-line swap the SKINS menu already calls when
     * you equip something, which is why this costs no new machinery at all. A
     * fresh profile wears nothing and this whole block is a no-op.
     */
    const wearing = Object.keys(CHARACTERS)
      .map(id => [id, equippedSkin(id)]).filter(([, s]) => s);
    for (const [id, skinId] of wearing) {
      ensure(this, skinBundle(skinId)).then(() => {
        if (this.scene.isActive() && this.heroArt?.[id]) this.repaintHero(id);
      });
    }

    // ------------------------------------------------------------------
    // BACK, OFF THE CUT CORNER (2026-08-11, the chrome sweep).
    //
    // It shipped at (48, 40) with origin (0, 0.5), which is a box of roughly
    // 48..160 x 22..58. Its top-left corner is 164px from the top-left arc
    // centre (150, 150) against a 150px radius: 14px outside the glass, on the
    // one control that gets a player OFF this screen. Pulled inside the SAFE
    // frame on both axes it reads 144..282 x 42..86 and its worst corner is
    // 108px in — and it takes a bigger face on touch while it is being moved,
    // because 26px of text is a thin thing to ask a thumb to find and this is
    // the only exit in the room.
    // ------------------------------------------------------------------
    const back = this.add.text(TOUCH ? 48 + SAFE.x : 48, TOUCH ? 40 + SAFE.y : 40, '◀  BACK', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: TOUCH ? '32px' : '26px',
      color: '#d8c9a8', stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    this.backBtn = back;
    // Pure visual polish (a link that warms up), so it stays on the raw binding:
    // on a finger it reads as press feedback and it describes nothing.
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
    // THE ONE COPY FORK on this screen. A build with no mouse must never be
    // told to hover: after the hover removal (JC, 2026-08-11) there is no such
    // gesture here at all, and the kit now lives behind the little ⓘ tab on
    // each card's shoulder. Both strings sit side by side in the source, where
    // a reviewer sees both at once, rather than in two files that drift.
    this.add.text(GAME_W / 2, GAME_H - 30, TOUCH
      ? 'tap ⓘ on a card to read the kit. tap the card to pick your difficulty.'
      : 'hover a card to read the kit. click it to pick your difficulty.', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#d8c9a8', stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5);
    this.cogBtn = addSettingsButton(this);
    this.skinsBtn = this.addSkinsButton();

    this.buildHeroRow();

    // ==================================================================
    // THE CHROME AUDIT (JC, 2026-08-11: "the settings cog sometimes overlaps
    // with main menu elements"). THIS screen is the sometimes — see
    // addSkinsButton for the 72x29 intersection that shipped on every touch
    // build — and it had no geometry hook of any kind, which is exactly why
    // nobody caught it.
    //
    // Everything in the top strip, both chevrons and all five hero cards come
    // back as world-space boxes carrying their own corner-arc verdict, plus
    // `collisions`: every intersecting pair of TARGETS, named. A driver asserts
    // that list is empty at both touch widths and does not have to know that
    // SKINS is 220 wide or that the gear lives at GAME_W-144.
    //
    // Separate from `window.__hfSelect`, which is the DIFFICULTY PICKER's hook
    // and only exists while that overlay is up, and from `window.__hfRow`,
    // which is the rail's scroll state. This one is the furniture.
    // ==================================================================
    window.__hfSelectChrome = {
      buttons: () => chromeButtons(this),
      chrome: () => {
        const plates = chromeButtons(this);
        // BY ROLE, NEVER BY LABEL. This screen happens to carry only ONE object
        // saying 'SETTINGS' today, so caption matching answered correctly here
        // — which is exactly why it is worth changing: the Title screen proved
        // that a second SETTINGS plate can arrive without anybody noticing that
        // an audit somewhere else silently started measuring it (see the same
        // block in TitleScene.chrome for the bug this cost). `hfRole` is set by
        // addSettingsButton, there is one per scene, and no caption can claim
        // it. Box labelled 'COG' to match CombatScene.chromeAudit.
        const cog = chromeBox('COG', COG_HOME.x, COG_HOME.y, COG_HOME.size, COG_HOME.size);
        const drawn = plates.find(p => p.role === 'cog');
        cog.drawn = drawn ? { w: drawn.w, h: drawn.h } : null;
        const boxes = [
          cog,
          ...plates.filter(p => p.role !== 'cog')
            .map(p => chromeBox(p.label ?? p.key, p.x, p.y, p.w, p.h)),
          chromeObjBox('BACK', this.backBtn),
          ...(this.chevrons ?? []).map((t, i) => chromeObjBox(i === 0 ? 'CHEVRON LEFT' : 'CHEVRON RIGHT', t)),
          // The cards are the BOARD, not the chrome: two of them are always
          // half off the rail's ends by design, and the chevrons deliberately
          // stand in the margin beside them. They are reported so a driver can
          // assert the cog and SKINS are nowhere near the row, and marked
          // `decor` so the rail's own geometry is not read as a defect.
          ...(this._heroCardBoxes?.() ?? []).map(b => ({ ...b, decor: true })),
        ].filter(Boolean);
        return {
          gameW: GAME_W, gameH: GAME_H, touch: TOUCH, safe: { ...SAFE },
          side: SIDE, rowScroll: Math.round(this.rowScroll ?? 0),
          cog,
          skins: boxes.find(b => b.label === 'SKINS') ?? null,
          boxes,
          collisions: chromeCollisions(boxes),
          // `skins` above is resolved BY LABEL, which is exactly the shape of
          // the bug that blinded TitleScene's audit — so the screen publishes
          // whether any caption is ambiguous rather than leaving a driver to
          // assume. See ui/settingsMenu.chromeDupLabels.
          dupLabels: chromeDupLabels(boxes),
          allClear: boxes.every(b => b.clears),
        };
      },
    };
  }

  /**
   * SKINS, from character select as well as the title screen (patch §3). It sits
   * left of the gear rather than in the card row: it is a wardrobe, not a hero,
   * and putting it in the row would make it the sixth thing you can "pick".
   *
   * ======================================================================
   * IT WAS SITTING ON THE GEAR (JC, 2026-08-11: "the settings cog sometimes
   * overlaps with main menu elements"). THIS is the sometimes.
   * ======================================================================
   * SKINS shipped at (GAME_W-200, 42) as a 180x54 desktop plate and never
   * learned that a touch build exists. On a phone the cog is a 76px square
   * pulled inside the safe frame, so the two boxes read
   *
   *     COG    GAME_W-182 .. GAME_W-106  x  40 .. 116
   *     SKINS  GAME_W-290 .. GAME_W-110  x  15 .. 69
   *
   * — a 72x29 intersection, IDENTICAL on the 2340 phone and the 1920 tablet
   * because both are GAME_W-relative, so no amount of testing on one device
   * would have caught it on the other. And they were BOTH at depth
   * `DEPTH.overlay - 1` with SKINS added second, which at equal depth wins the
   * hit test: the covered strip of the gear was not merely ugly, it was
   * unclickable, on every touch build, on the one screen where a player who
   * wants to turn the music down is most likely to be.
   *
   * The fix is measured, not nudged. On touch the plate becomes a finger-sized
   * 220x76 and takes the gear's own centre line (y 78) so the top strip reads
   * as one row, and its right edge is parked 24px clear of the gear's left:
   *
   *     COG    GAME_W-182 .. GAME_W-106  x  40 .. 116
   *     SKINS  GAME_W-426 .. GAME_W-206  x  40 .. 116     gap 24px, zero overlap
   *
   * Its top edge (40) now clears SAFE.y (24) instead of sitting 9px above it,
   * and neither of its right-hand corners is inside the corner arc (the nearer
   * one is 56px shy of the quadrant the bite even applies to). Desktop keeps
   * the exact plate it shipped with — SAFE is {0,0} there, the cog is a 44px
   * square at GAME_W-44, and the two have always had 44px between them.
   *
   * The depth tie is broken too, permanently: SKINS drops one layer so that if
   * anything ever drifts back into the gear again it drifts UNDER it, and the
   * control JC actually reported stays pressable while somebody fixes the
   * layout.
   */
  addSkinsButton() {
    const x = TOUCH ? COG_HOME.x - COG_HOME.size / 2 - 24 - 110 : GAME_W - 200;
    const y = TOUCH ? COG_HOME.y : 42;
    const w = TOUCH ? 220 : 180, h = TOUCH ? 76 : 54;
    const btn = this.add.image(x, y, 'btn_gray').setDisplaySize(w, h)
      .setDepth(DEPTH.overlay - 2).setInteractive({ useHandCursor: true });
    btn.setData('hfLabel', 'SKINS');
    const txt = this.add.text(x, y - 3, 'SKINS', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: TOUCH ? '28px' : '24px', color: '#3a3020',
    }).setOrigin(0.5).setDepth(DEPTH.overlay - 2);
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
    // ...and they sit inside the safe frame on touch. 46 was a desktop number
    // on a canvas with no glass to lose: a 64px glyph centred there spans
    // 14..78, which is 82px inside SAFE.x. See the SIDE constant at the head of
    // this file for why the rail's margin had to widen to pay for the move.
    const CHEV_X = TOUCH ? SAFE.x + 36 : 46;
    const left = scrollable ? chev(CHEV_X, -1) : null;
    const right = scrollable ? chev(GAME_W - CHEV_X, 1) : null;
    this.chevrons = [left, right].filter(Boolean);

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

    // The same five cards as AUDIT BOXES, for __hfSelectChrome. Arithmetic and
    // not a getBounds() read for the reason the deal block above spells out:
    // every card carries a table glow 1.6x its own width, so a bounds read
    // would report five overlapping rectangles and call a layout a collision.
    this._heroCardBoxes = () => ids.map((id, i) => chromeBox(
      `HERO ${id.toUpperCase()}`, x0 + i * step + this.rowScroll, ROW_Y, CW, CH));
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
    // ...and ONLY a release whose press started on THIS card (the skins-dimmer
    // idiom). Phaser fires pointerup on whatever sits under the pointer at
    // release, so PLAY AGAIN's gesture used to spill its UP into this fresh
    // scene and open the picker for whichever card the button overlapped.
    hit.on('pointerdown', () => { this._downOnHero = ch.id; });
    hit.on('pointerup', () => {
      const armed = this._downOnHero === ch.id;
      this._downOnHero = null;
      if (armed && !this.__rowDragged && !this._touchHoldFired) start();
    });

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

    // ------------------------------------------------------------------
    // THE CARD COMING UP OFF THE TABLE IS POLISH, so it stays on the raw
    // pointer binding: it describes nothing, it costs nothing, and on a finger
    // Phaser fires `pointerover` on the press anyway, where a card that lifts
    // under your thumb reads as exactly the press feedback a tap wants.
    // ------------------------------------------------------------------
    hit.on('pointerover', () => {
      sfx(this, 'card_hover', { volume: 0.42, jitter: 0.08 });
      this.tweens.add({ targets: card, y: y - 40, scale: 1.045, angle: index % 2 === 0 ? -1.2 : 1.2, duration: 170, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: glow, alpha: 0.72, duration: 180 });
      this.tweens.add({ targets: playHint, alpha: 1, duration: 170 });
      this.tweens.add({ targets: heroG, y: 42, scale: 0.82, duration: 200, ease: 'Sine.easeOut' });
      // A puff of the hero's own suit off the table as the card comes up.
      burst(this, x + (this.heroRow?.x ?? 0), y + CH * 0.3, open ? suitColor : 0x6b5a80, 9);
    });
    hit.on('pointerout', () => {
      this.tweens.add({ targets: card, y, scale: 1, angle: 0, duration: 170 });
      this.tweens.add({ targets: glow, alpha: 0.16, duration: 180 });
      this.tweens.add({ targets: playHint, alpha: 0, duration: 150 });
      this.tweens.add({ targets: heroG, y: -26 * K, scale: 1, duration: 200, ease: 'Sine.easeOut' });
    });

    // ------------------------------------------------------------------
    // THE KIT PARCHMENT IS INFORMATION, and information does not live on a
    // hover any more (JC, 2026-08-11).
    //
    // On DESKTOP this is byte-for-byte the panel that shipped: the same slide,
    // the same rail-follower, the same orphan guard — it is bound through
    // ui/touch.hoverInfo rather than a raw `.on('pointerover')` so that the ONE
    // decision "there is no hover on a finger" is made in one place instead of
    // at forty call sites.
    //
    // On TOUCH the parchment is never shown at all, and the ⓘ tab below is the
    // path to the same words. WHY NOT the shape that was sketched first — show
    // the parchment automatically for whichever hero is centred on the rail? It
    // was measured and it does not survive the measuring. The panel is 400px
    // wide and is placed BESIDE its card (placeInfo, inward toward the middle
    // of the screen) because there is nowhere else for it to go: the card's top
    // is at 203 and its PLAY hint bottoms out at 949 on a 1080 canvas, so there
    // is no room above or below. Beside the CENTRED card means squarely on top
    // of the card next to it — a permanent 400x300 panel standing on a hero you
    // are about to swipe to, painted over the very thing the rail exists to let
    // you browse. A tab you press is smaller, is opt-in, and puts its answer
    // through ui/choicebox.js, which means it obeys the one-panel registry and
    // gets dismissed by tapping away like every other description in the game.
    // ------------------------------------------------------------------
    const showKit = () => {
      const worldX = x + (this.heroRow?.x ?? 0);
      const px = placeInfo(this.heroRow?.x ?? 0);
      this._infoFollow = placeInfo;
      info.setVisible(true);
      // The panel slides the last few pixels outward as it fades up, so it reads
      // as being drawn out of the card rather than switched on next to it.
      info.x = px - (px >= worldX ? 1 : -1) * 26;
      this.tweens.add({ targets: info, alpha: 1, x: px, duration: 180, ease: 'Cubic.easeOut' });
    };
    const hideKit = () => {
      // ...but only if the pointer has not already arrived on the NEXT card:
      // Phaser dispatches this frame's overs before its outs, so a slide from
      // one card to its neighbour would otherwise leave the new panel orphaned
      // from the rail.
      if (this._infoFollow === placeInfo) this._infoFollow = null;
      this.tweens.add({
        targets: info, alpha: 0, duration: 150,
        onComplete: () => { if (info.alpha < 0.02) info.setVisible(false); },
      });
    };
    hoverInfo(hit, showKit, hideKit);

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

    // ------------------------------------------------------------------
    // THE ⓘ TAB — the touch build's road to the kit.
    //
    // The card's own tap was already spoken for (it picks the hero and opens
    // the difficulty page) and hijacking it would have cost a first-timer the
    // one gesture on this screen that is obvious. So the kit gets a target of
    // its own, on the card's shoulder, where it overlaps nothing: the name
    // plate is at +212, the model's head tops out around -160, and the corner
    // filigree of Caleb's card art is the emptiest 68px on the whole face.
    //
    // IT IS A DIRECT CHILD OF `card`, deliberately, for the same reason the hit
    // rectangle is: `flight` is what the deal animates, and anything parented
    // to it is a card-and-a-bit to the right of where it looks for the first
    // 680ms. It fades in on the deal's own clock so it does not arrive before
    // the card it belongs to, but its target is live and stationary from frame
    // one, which is what a driver clicking the moment __hfRow appears needs.
    //
    // The box's WORDS come from the same two fields the parchment prints
    // (ch.kit / ch.suitNotes, or the unlock hint for a locked hero), so the
    // desktop panel and the touch panel cannot drift apart.
    // ------------------------------------------------------------------
    if (TOUCH) {
      const tab = this.add.container(CW / 2 - 46, -CH / 2 + 46).setAlpha(0);
      const tabDisc = this.add.image(0, 0, 'btn_circle_gray').setDisplaySize(68, 68)
        .setInteractive({ useHandCursor: true });
      // `btn_circle_gray` matches the `btn_` walk in chromeButtons, so the tab
      // is already in the audit as a plate — it just needs a name that says
      // WHICH hero's kit it opens, or the driver gets five identical discs.
      tabDisc.setData('hfLabel', `KIT ${ch.id.toUpperCase()}`);
      tab.add([tabDisc, this.add.text(0, -3, 'i', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: '#3a3020',
      }).setOrigin(0.5)]);
      card.add(tab);
      this.tweens.add({ targets: tab, alpha: 1, duration: 220, delay: 240 + index * 70 });
      tapInfo(this, tabDisc, {
        key: `hero:${ch.id}`,
        // A FUNCTION, because the rail moves under it: the box is placed
        // against wherever the tab is standing at the instant it is tapped.
        anchor: () => {
          const m = tabDisc.getWorldTransformMatrix();
          return { x: m.tx, y: m.ty, w: 68, h: 68 };
        },
        title: open ? `${ch.name}  ·  ${ch.title}` : '???  ·  A HERO YET UNFORGED',
        body: () => (open
          ? [ch.kit, '', ...ch.suitNotes.map(n => `${SUIT_GLYPH[n.suit]}  ${n.text}`)].join('\n')
          : (ch.unlockHint ?? need?.hint ?? 'Not yet forged.')),
        note: open ? null : 'This hero is still chained.',
        accent: open ? suitColor : 0x3a2f4a,
        owner: card,
      });
    }

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
    /**
     * THE HERO IS DECIDED; THE RUN IS NOT. Everything between here and BEGIN is
     * dead time — reading six difficulty plates, maybe typing a seed — and it is
     * the only window in the game where the game knows which hero's art it needs
     * and is not yet drawing any of it.
     *
     * Five painted cardfaces (7.5 MB) and one skin (2.9 MB). Fire-and-forget:
     * beginRun awaits the same keys under its own fade, and CombatScene's gate
     * is the backstop under that, so nothing here is load-bearing. Backing out
     * to the rail and picking someone else simply fetches a second hero — which
     * is why this is not in create(): five heroes at once is the shape that was
     * just deleted from the boot set.
     */
    ensure(this, [...heroCardfaces(ch.id), ...skinBundle(equippedSkin(ch.id))]);
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
        // A REFUSAL THAT SAYS WHY (touch only, 2026-08-11). On desktop the
        // hover has already printed "LOCKED. Clear Act III with DEXTRA on
        // GOLD." into the parchment below by the time you press, so the
        // pitched-down thud is the second half of an answer you have read. A
        // finger has no hover: without this, tapping a locked plate produced a
        // noise and nothing else, and the ONLY surface in the game that says
        // what opens a difficulty would have been unreachable on the phone.
        // It still does not SELECT — the ring and pickerChoice do not move.
        if (TOUCH) showDetail(index);
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
    // THE 12px LIFT IS POLISH and stays on the raw binding — on a finger it is
    // the plate acknowledging the press, which this screen otherwise has no way
    // of doing.
    parts.panel.on('pointerover', () => this.tweens.add({ targets: g, y: y - 12, duration: 130, ease: 'Sine.easeOut' }));
    parts.panel.on('pointerout', () => this.tweens.add({ targets: g, y, duration: 130 }));
    // THE BLURB IS INFORMATION. `onHover` writes the six numbers and the
    // LOCKED line into the picker's shared detail parchment, which is a fixed
    // region of this page rather than a floating panel — so on touch it does
    // not need a box of its own, it needs a different DRIVER: the plate you
    // TAPPED, which is already the plate you picked (see `select` in
    // openDifficultyPicker, where the same showDetail call sits).
    hoverInfo(parts.panel, () => onHover(d.index));
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
    /**
     * THE RUN'S FIRST WORLD, FETCHED UNDER THE FADE.
     *
     * `newRun` has just rolled which world every act turned out to be, so this
     * is the first instant the game can know that Act I is the Verdant Forest
     * and not the Nocturnal one. Act I's backdrop, board, banner and medallions
     * are ~36 MB and the map cannot be painted without them.
     *
     * The transition waits on BOTH the camera and the fetch, not on whichever
     * is slower to be written down: on a warm cache the fade is the long pole
     * and this is invisible, and on a cold one the player sits on the black
     * they were already sitting on instead of watching a progress bar. `ensure`
     * never rejects (a 404 resolves — half this game's art is optional), so
     * this cannot strand the screen.
     */
    const ready = ensure(this, runStartBundle(run, { skinId: equippedSkin(ch.id) }));
    this.cameras.main.fadeOut(260, 20, 16, 28);
    this.cameras.main.once('camerafadeoutcomplete',
      () => ready.then(() => this.scene.start('Map')));
  }
}
