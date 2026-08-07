import { GAME_W, GAME_H, DEPTH, PARCH, BUILD, CHARACTERS, applyMobileCamera } from '../config.js';
import { installLongPress } from '../ui/touch.js';
import { DIFFICULTIES } from '../core/difficulty.js';
import { addTavernBackdrop } from '../ui/tavern.js';
import { gleamSweep } from '../ui/titleFx.js';
import { addSettingsButton, openSettings } from '../ui/settingsMenu.js';
import { openTutorial } from '../ui/tutorial.js';
import { openAchievements } from '../ui/achievements.js';
import { openSkins } from '../ui/skins.js';
import { playMusic, skipTrack } from '../core/music.js';
import { progress, highestDifficultyCleared, isCharacterUnlocked } from '../core/progress.js';
import { ACHIEVEMENT_BY_ID } from '../core/achievements.js';
import { sfx } from '../core/sfx.js';
import { woodPanel } from '../ui/panels.js';
import { legible, fmtNum, burst, shake } from '../ui/juice.js';
// The mode of a tally, shared with the run recap so MOST PLAYED HAND means the
// same thing on the lifetime shelf as it does on the report card.
import { topEntry, run } from '../core/run.js';
import { hasSave, readSave, clearSave, saveSummary, resumeRun } from '../core/save.js';
import { equippedSkin } from '../core/skins.js';
// DEFERRED ART (core/lazyload.js) — a CONTINUE is a cold page load dropping into
// the middle of a run, so it is the one road into the game with nothing cached.
import { ensure, runStartBundle, mapPrefetch } from '../core/lazyload.js';

/**
 * THE SLAM FIRES ONCE PER APP SESSION, and this is where that is remembered.
 *
 * Phaser scenes are singletons but their create() runs again on every visit, so
 * coming BACK from character select would otherwise re-slam the logo, shake the
 * camera and bang the anvil at you for the fifth time in a minute. A title
 * entrance is a greeting; a greeting you get every time you walk through a door
 * is an alarm. Module scope, not the scene, because the scene is the thing being
 * re-entered. A page reload clears it, which is exactly right.
 */
let slammed = false;

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    applyMobileCamera(this);   // no-op on desktop
    installLongPress(this);    // hold = hover on touch; no-op on desktop
    playMusic(this, 'menu');
    addTavernBackdrop(this, 0.4);

    const LOGO_SCALE = 0.52;
    const logo = this.add.image(GAME_W / 2, 300, 'logo').setScale(LOGO_SCALE);
    // Light walks across the wordmark every nine seconds. Slower and statelier
    // than the sword-card's gleam, because this one is never the second thing
    // you notice.
    gleamSweep(this, logo, { period: 9000, delay: slammed ? 2400 : 4200, speed: 1050 });
    const breathe = () => this.tweens.add({
      targets: logo, y: 312, scale: LOGO_SCALE * 1.023, duration: 2600,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    if (slammed) {
      // A return visit gets a plain fade. Nothing here gates input: the buttons
      // below are built and interactive whether or not this has finished.
      logo.setAlpha(0);
      this.tweens.add({ targets: logo, alpha: 1, duration: 220, onComplete: breathe });
    } else {
      slammed = true;
      logo.setScale(LOGO_SCALE * 1.5).setAlpha(0);
      this.tweens.add({ targets: logo, alpha: 1, duration: 130 });
      this.tweens.add({
        targets: logo, scale: LOGO_SCALE, duration: 380, ease: 'Expo.easeIn',
        onComplete: () => {
          // IT LANDS: a ring of light off the anvil, dust off the letters, one
          // hard knock of the camera, and the heaviest hit in the pack under it.
          // The RING is doing most of the work — `burst`'s stars are 0.18-0.4
          // scale and simply disappear against a logo that is already on fire.
          const ring = this.add.image(GAME_W / 2, 330, 'fx_glow')
            .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe9a0)
            .setAlpha(1).setScale(1.1, 0.5).setDepth(DEPTH.fx - 1);
          this.tweens.add({
            targets: ring, scaleX: 6.0, scaleY: 1.9, alpha: 0,
            duration: 520, ease: 'Cubic.easeOut', onComplete: () => ring.destroy(),
          });
          burst(this, GAME_W / 2, 300, 0xffd23e, 18);
          burst(this, GAME_W / 2, 300, 0xfff3c4, 10);
          shake(this, 0.009, 170);
          sfx(this, 'hit_big', { volume: 0.85, rate: 0.82 });
          // A squash-and-settle, THEN the breathing float takes over — so the
          // resting animation never starts mid-slam and fights it.
          this.tweens.add({
            targets: logo, scale: LOGO_SCALE * 1.055, duration: 110,
            yoyo: true, ease: 'Sine.easeOut', onComplete: breathe,
          });
        },
      });
    }

    // NB: these buttons are sized with setDisplaySize, so their "rest" scale is
    // NOT 1 — hover tweens must be relative to the captured base scale.
    // `x` defaults to the centre line, which is where every row but the last one
    // sits. The last row carries TWO buttons (see the stack below), and that is
    // the only reason this parameter exists.
    // The stack deals itself in, one row at a time. `slot` counts the rows that
    // have been asked for so far, so the two buttons that SHARE the last row
    // (SKINS + SETTINGS) arrive together instead of one after the other.
    let slot = 0;
    const makeBtn = (y, key, label, textColor, onClick, w = 380, h = 84, fs = 34, x = GAME_W / 2, row = slot++) => {
      // The hover glow is built BEFORE the button so it sits behind it. Never
      // sized with setDisplaySize on the button itself: that is the historic
      // hover-shrink trap (a display size and a scale tween on one object).
      const glow = this.add.image(x, y, 'fx_glow')
        .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc542).setAlpha(0)
        .setDisplaySize(w * 1.35, h * 2.6);
      const img = this.add.image(x, y, key).setDisplaySize(w, h).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, y - 4, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${fs}px`, color: textColor,
      }).setOrigin(0.5);
      const base = { ix: img.scaleX, iy: img.scaleY };
      img.on('pointerover', () => {
        sfx(this, 'menu_select', { volume: 0.3, jitter: 0.05 });
        this.tweens.add({ targets: img, scaleX: base.ix * 1.06, scaleY: base.iy * 1.06, duration: 120 });
        this.tweens.add({ targets: txt, scale: 1.06, duration: 120 });
        this.tweens.add({ targets: glow, alpha: 0.9, duration: 140 });
      });
      img.on('pointerout', () => {
        this.tweens.add({ targets: img, scaleX: base.ix, scaleY: base.iy, duration: 120 });
        this.tweens.add({ targets: txt, scale: 1, duration: 120 });
        this.tweens.add({ targets: glow, alpha: 0, duration: 180 });
      });
      img.on('pointerdown', () => {
        sfx(this, 'button', { volume: 0.8 });
        this.tweens.add({
          targets: img, scaleX: base.ix * 0.95, scaleY: base.iy * 0.95, duration: 60, yoyo: true,
          onComplete: () => { img.setScale(base.ix, base.iy); onClick(); },
        });
        this.tweens.add({ targets: txt, scale: 0.95, duration: 60, yoyo: true });
      });
      // ------------------------------------------------------------------
      // THE ENTRANCE, and the rule it obeys: IT MOVES NOTHING AND GATES
      // NOTHING. Every row's resting y is the y it always had, the whole
      // stagger is done inside 560ms, and the buttons are interactive from the
      // first frame — an entrance that swallowed a click would be a bug, not a
      // flourish.
      // ------------------------------------------------------------------
      const rise = 26;
      for (const o of [glow, img, txt]) {
        const restY = o.y;
        o.y = restY + rise;
        o.setAlpha(0);
        this.tweens.add({
          targets: o, y: restY, duration: 240, delay: 70 * row, ease: 'Cubic.easeOut',
        });
        if (o !== glow) this.tweens.add({ targets: o, alpha: 1, duration: 200, delay: 70 * row });
      }
      return img;
    };
    /** Same slide-and-fade, for the loose captions that belong to a row. */
    const enter = (obj, row) => {
      const restY = obj.y;
      obj.y = restY + 26;
      obj.setAlpha(0);
      this.tweens.add({ targets: obj, y: restY, duration: 240, delay: 70 * row, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: obj, alpha: 1, duration: 200, delay: 70 * row });
      return obj;
    };

    // ------------------------------------------------------------------
    // THE BUTTON STACK
    //
    // Built top-down off a cursor instead of hard-coded ys, so the next row
    // (ACHIEVEMENTS) is one line rather than a re-typing of every coordinate.
    // With a run parked the ladder starts higher and steps tighter to pay for
    // CONTINUE RUN and the summary line under it; with no save the numbers are
    // byte-for-byte the menu that shipped.
    //
    // A save we cannot READ (older build, mangled blob) is not a save: it is
    // binned here and the menu behaves as if there were none, with one quiet
    // line of explanation so the player is not left wondering where the run went.
    // ------------------------------------------------------------------
    this.__newRunConfirm = false;    // scenes are singletons; re-arm the confirm
    const parked = readSave();
    const stale = !parked && hasSave();
    if (stale) clearSave();
    const summary = parked ? saveSummary() : null;

    let y = summary ? 580 : 618;
    const step = summary ? 78 : 84;

    if (summary) {
      makeBtn(y, 'btn_yellow', 'CONTINUE RUN', '#5b3a00', () => this.continueRun());
      enter(this.add.text(GAME_W / 2, y + 52,
        [summary.chrName, summary.actLabel, summary.floorLabel, summary.difficultyLabel].join('  ·  '), {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '20px', color: '#e8d8b0',
          fontStyle: 'bold', stroke: '#241505', strokeThickness: 4,
        }).setOrigin(0.5), 0);
      y += 112;
      // Red, because it IS the destructive button on this screen now.
      makeBtn(y, 'btn_red', 'NEW RUN', '#4a0a10', () => this.confirmNewRun(), 340, 72, 28);
      y += step;
    } else {
      makeBtn(y, 'btn_yellow', 'PLAY', '#5b3a00', () => this.startNewRun());
      y += 104;
    }
    makeBtn(y, 'btn_blue', 'HOW TO PLAY', '#0a2a4a', () => openTutorial(this), 320, 68, 26);
    y += step;
    makeBtn(y, 'btn_green', 'RECORDS', '#0c3d18', () => this.openRecords(), 320, 68, 26);
    y += step;
    // Gray, not red: with a run parked, RED on this screen means NEW RUN, and
    // nothing else on the menu is allowed to borrow the destructive colour.
    makeBtn(y, 'btn_gray', 'ACHIEVEMENTS', '#3a3020', () => openAchievements(this), 320, 68, 26);
    y += step;
    // ------------------------------------------------------------------
    // THE LAST ROW CARRIES TWO (2026-08-03: SKINS).
    //
    // A sixth full-width row would have put SETTINGS at y=1058 on a 1080 canvas,
    // under the credit line, and pulling the whole stack up to pay for it would
    // have moved PLAY, HOW TO PLAY, RECORDS and ACHIEVEMENTS — four coordinates
    // that a dozen verification drivers click by number. Two 300px buttons on
    // the row SETTINGS already owned costs nothing and moves nothing: every row
    // above this one sits on exactly the y it shipped on.
    // ------------------------------------------------------------------
    const lastRow = slot;
    makeBtn(y, 'btn_gray', 'SKINS', '#3a3020', () => openSkins(this), 300, 68, 26, GAME_W / 2 - 164, lastRow);
    makeBtn(y, 'btn_dark', 'SETTINGS', '#cfc8e8', () => openSettings(this), 300, 68, 26, GAME_W / 2 + 164, lastRow);
    slot = lastRow + 1;
    y += step;

    if (stale) {
      // ABOVE THE STACK, not below it. Drawn off the same cursor as the buttons
      // this line ended up at y=1058 on the no-save ladder — four pixels from
      // the credit line at GAME_H - 26, printing two sentences on top of each
      // other in the one case where the player most needs to read one of them.
      // It belongs where CONTINUE RUN would have been anyway: it is the answer
      // to "where did my run go?", so it stands in the missing button's place.
      legible(enter(this.add.text(GAME_W / 2, 552,
        "That run was saved by an older build and can't be read.", {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: '#c9a2ff',
          fontStyle: 'bold',
        }).setOrigin(0.5), 0));
    }

    // The jukebox — click to make the tavern band try something else.
    const juke = this.add.container(74, GAME_H - 74);
    const jukeDisc = this.add.image(0, 0, 'btn_circle_gray').setDisplaySize(76, 76);
    const jukeIcon = this.add.image(0, 0, 'icon_music_note').setTint(0x6b4526);
    jukeIcon.setScale(40 / Math.max(jukeIcon.width, jukeIcon.height));
    juke.add([jukeDisc, jukeIcon]);
    this.tweens.add({ targets: jukeIcon, angle: { from: -6, to: 6 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    jukeDisc.setInteractive({ useHandCursor: true });
    jukeDisc.on('pointerover', () => { sfx(this, 'menu_select', { volume: 0.3, jitter: 0.05 }); this.tweens.add({ targets: juke, scale: 1.12, duration: 110 }); });
    jukeDisc.on('pointerout', () => this.tweens.add({ targets: juke, scale: 1, duration: 110 }));
    jukeDisc.on('pointerdown', () => {
      sfx(this, 'button', { volume: 0.7 });
      this.tweens.add({ targets: juke, angle: 360, duration: 500, ease: 'Cubic.easeOut', onComplete: () => juke.setAngle(0) });
      skipTrack(this);
      // A few notes float off the box.
      for (let i = 0; i < 3; i++) {
        const n = this.add.image(74 + Phaser.Math.Between(-14, 14), GAME_H - 96, 'icon_music_note')
          .setTint(0xffd23e).setScale(0.14).setAlpha(0.9);
        this.tweens.add({
          targets: n, y: GAME_H - 190 - i * 22, x: n.x + Phaser.Math.Between(-30, 30),
          alpha: 0, angle: Phaser.Math.Between(-40, 40), duration: 1100 + i * 200, onComplete: () => n.destroy(),
        });
      }
    });
    // All three of these sit on the bare tavern painting (its brightest stretch
    // of floorboards, in fact) and the Ken Burns tween slides that ground under
    // them for 22 seconds at a time. Quiet is fine; invisible is not, so they
    // keep their muted colour and take the outline instead.
    legible(this.add.text(74, GAME_H - 26, 'jukebox', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '16px', color: '#9a8a6e',
    })).setOrigin(0.5);

    legible(this.add.text(GAME_W / 2, GAME_H - 26, `a HANDFORGED tale · ${BUILD}`, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: '#9a8a6e',
    })).setOrigin(0.5);

    // Version stamp — bottom-right, quiet. Playtesters quote this in feedback.
    legible(this.add.text(GAME_W - 22, GAME_H - 20, BUILD, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '15px', color: '#9a8a6e',
    })).setOrigin(1, 0.5).setAlpha(0.9);

    // VERIFICATION HOOK. Scalars and plain arrays only — handing a Playwright
    // driver a Phaser object serializes half the scene graph.
    window.__hfRecords = {
      lifetime: () => TitleScene.lifetimeRows(),
      raw: () => JSON.parse(JSON.stringify(progress.records ?? {})),
      open: () => { this.openRecords(); return true; },
    };

    addSettingsButton(this);
  }

  /** Off to the forge: pick a hero, pick a mode, go. */
  /**
   * PLAY. On a profile that has never started a run, this shows HOW TO PLAY
   * once on the way through.
   *
   * HOW TO PLAY is a button a first-time player may simply never press, and it
   * is the only place the game teaches anything at all — so before this, it was
   * entirely possible to meet the Oracle, who is mandatory, permanent and the
   * literal first interaction of a run, having been told nothing. It fires ONCE
   * ever: `progress.runs` became a trustworthy signal when recordRunStart was
   * given a caller (it had none, and every profile read zero forever), and
   * `tutorialSeen` latches so a player who wipes their runs is not taught twice.
   * Closing the last page walks straight on to character select, so it reads as
   * a doorway rather than a detour.
   */
  startNewRun() {
    if (progress.runs === 0 && !progress.tutorialSeen) {
      openTutorial(this, () => this.goToSelect());   // latches tutorialSeen itself
      return;
    }
    this.goToSelect();
  }

  goToSelect() {
    this.cameras.main.fadeOut(200, 20, 16, 28);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('CharacterSelect'));
  }

  /**
   * Wake the parked run and drop straight back into it. `resumeRun` hydrates
   * the live run object in place and answers with where that run was standing:
   * a fight it had already started, or the map.
   *
   * A refusal at THIS point (someone edited localStorage between the menu being
   * drawn and the button being pressed) rebuilds the menu rather than starting
   * a scene on a half-built run. That is the black-screen guard.
   */
  continueRun() {
    const where = resumeRun();
    if (!where) { clearSave(); return this.scene.restart(); }
    /**
     * A RESUME IS A COLD START INTO THE MIDDLE OF A RUN (2026-08-06, deferred
     * loading). The run being woken may be standing in the Burning Gallows on
     * lap two, and this page load has never fetched a single thing that world is
     * made of. `resumeRun` has already hydrated `run`, so its act index and its
     * world roll are both known here — which makes this the earliest possible
     * moment to ask for the art, and the 200ms fade is free cover for it.
     *
     * Both destinations gate on their own bundles anyway (MapScene.create,
     * CombatScene.create); this is what usually makes those gates instant. The
     * hero's painted deck rides along because a resume into a fight draws a hand
     * on the first frame.
     */
    const ready = ensure(this, [
      ...runStartBundle(run, { skinId: equippedSkin(run.chrId) }),
      ...(where.scene === 'Combat' ? mapPrefetch(run.actIndex, run) : []),
    ]);
    this.cameras.main.fadeOut(200, 20, 16, 28);
    this.cameras.main.once('camerafadeoutcomplete', () => ready.then(() => {
      if (where.scene === 'Combat') this.scene.start('Combat', { nodeId: where.nodeId });
      else this.scene.start('Map');
    }));
  }

  /**
   * NEW RUN over a parked one. Same confirm treatment as the in-run settings
   * menu, because it is the same question: the run you have is about to stop
   * existing.
   */
  confirmNewRun() {
    if (this.__newRunConfirm) return;
    this.__newRunConfirm = true;
    const confirm = this.add.container(0, 0).setDepth(DEPTH.overlay + 7);
    confirm.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.6).setInteractive());
    const cp = woodPanel(this, GAME_W / 2, GAME_H / 2, 560, 280, { accent: 0xe0434f });
    confirm.add([cp.shadow, cp.panel, cp.line]);
    confirm.add(this.add.text(GAME_W / 2, GAME_H / 2 - 66, 'Start a new run?', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: PARCH.text,
    }).setOrigin(0.5));
    confirm.add(this.add.text(GAME_W / 2, GAME_H / 2 - 18, 'This ends your current run.', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0.5));
    const done = () => { this.__newRunConfirm = false; confirm.destroy(true); };
    const mk = (bx, key, label, color, cb) => {
      const b = this.add.image(bx, GAME_H / 2 + 66, key).setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
      const t = this.add.text(bx, GAME_H / 2 + 62, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color,
      }).setOrigin(0.5);
      confirm.add(b); confirm.add(t);
      b.on('pointerdown', () => { sfx(this, 'button', { volume: 0.8 }); cb(); });
    };
    mk(GAME_W / 2 - 130, 'btn_red', 'NEW RUN', '#4a0a10', () => {
      clearSave();
      done();
      this.startNewRun();
    });
    mk(GAME_W / 2 + 130, 'btn_dark', 'KEEP IT', '#cfc8e8', done);
  }

  /**
   * The LIFETIME RECORDS column, as printable [label, value] pairs.
   *
   * Pulled out of openRecords so the shelf's CONTENT can be asked for without a
   * scene (verification drivers read it through window.__hfRecords, and it is
   * the one place that knows a record's display spelling). Every row is always
   * present: a shelf is a list of things you could beat, and a row that only
   * exists once you have beaten it teaches nobody what to aim at. The single
   * exception is ENDLESS, which is a whole MODE you may not have unlocked.
   */
  static lifetimeRows(rec = progress.records ?? {}) {
    // 'none yet', not an em dash: the copy suite bans em dashes from anything
    // the scenes render, and this screen already says 'none yet' twice.
    const dash = 'none yet';
    const num = (v) => (v > 0 ? fmtNum(v) : dash);
    const tally = (counts) => {
      const top = topEntry(counts);
      return top ? `${top.key}  ×${top.count}` : dash;
    };
    // "4.2M  ·  VANESSA, Straight Flush", on the house separator. The context is
    // dropped rather than faked when an older profile only kept the number.
    const dmg = rec.maxHandDamage ?? {};
    let dmgValue = num(dmg.value ?? 0);
    if ((dmg.value ?? 0) > 0) {
      const who = CHARACTERS[dmg.hero]?.name ?? '';
      const bits = [who, dmg.hand].filter(Boolean);
      if (bits.length) dmgValue += `  ·  ${bits.join(', ')}`;
    }
    const rows = [
      ['Highest Hand Damage', dmgValue],
      ['Highest Hand Shield', num(rec.maxHandShield ?? 0)],
      ['Highest Poison Stack', (rec.maxPoisonStack ?? 0) > 0 ? `${rec.maxPoisonStack}` : dash],
      ['Most Played Hand', tally(rec.handTypeCounts)],
      ['Most Played Card', tally(rec.cardPlays)],
      ['Hands Played', num(rec.handsPlayed ?? 0)],
      ['Discards Used', num(rec.discardsUsed ?? 0)],
    ];
    // ENDLESS IS A CONTRACT WITH ANOTHER WORKSTREAM: these two fields are
    // created and displayed here and written NOWHERE in this file. Until a run
    // has actually gone deep the row is absent entirely, because unlike the
    // rows above it there is nothing to aim at yet.
    if ((rec.bestEndlessDepth ?? 0) > 0) {
      rows.push(['Deepest Endless', rec.bestEndlessLabel || `Depth ${rec.bestEndlessDepth}`]);
    }
    return rows;
  }

  /** Trophy shelf: run stats + silhouettes of what's still locked away. */
  openRecords() {
    if (this.__recordsOpen) return;
    this.__recordsOpen = true;
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay + 6);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.78).setInteractive();
    ov.add(dim);
    // ------------------------------------------------------------------
    // THE PANEL GREW (2026-08-05) — 960x700 to 1400x980, and the stats
    // reflowed into two columns.
    //
    // LIFETIME RECORDS is eight rows on its own, and the old panel was already
    // running the locked-hero shelf's hint text out past its bottom rail. One
    // taller column would have pushed the silhouettes off a 1080 canvas, so the
    // two stat blocks now sit side by side above everything else: PROFILE on
    // the left (what you have done), RECORDS on the right (the best of it).
    // 980 tall leaves 50px of air top and bottom on the canvas; nothing here
    // scrolls, which is deliberate — a shelf you have to scroll is a table.
    //
    // Everything below is positioned off `cx`/`cy` rather than the old literal
    // GAME_W/2 arithmetic, and this scene is due a restyle in a later pass.
    // ------------------------------------------------------------------
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const parts = woodPanel(this, cx, cy, 1400, 980, { accent: 0x5aa860 });
    ov.add([parts.shadow, parts.panel, parts.line]);
    ov.add(this.add.text(cx, cy - 436, 'RECORDS', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '46px', color: PARCH.text,
    }).setOrigin(0.5));

    // One column printer, used twice. `valueSize` drops for the lifetime column
    // because its values carry context ("4.2M — VANESSA, Straight Flush").
    const ROW0 = cy - 336;
    const STEP = 44;
    const column = (rows, labelX, valueX, headX, head, valueSize) => {
      ov.add(this.add.text(headX, cy - 382, head, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.textDim,
      }).setOrigin(0.5));
      rows.forEach(([k, v], i) => {
        const y = ROW0 + i * STEP;
        ov.add(this.add.text(labelX, y, k, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.text,
        }).setOrigin(0, 0.5));
        ov.add(this.add.text(valueX, y, v, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: `${valueSize}px`, color: PARCH.accent,
        }).setOrigin(1, 0.5));
      });
    };

    column([
      ['Runs attempted', `${progress.runs}`],
      ['Victories', `${progress.wins}`],
      ['Deepest act cleared', progress.bestAct > 0 ? `Act ${['I', 'II', 'III', 'IV'][progress.bestAct - 1]}` : 'None yet'],
      ['The Crucible (Act IV)', progress.act4Unlocked ? 'UNLOCKED ☠' : 'Locked: clear Act III'],
      ['Endless Mode', progress.endlessUnlocked ? 'UNLOCKED' : 'Locked: clear Act IV'],
    ], cx - 660, cx - 60, cx - 360, 'PROFILE', 24);

    column(TitleScene.lifetimeRows(), cx + 40, cx + 660, cx + 350, 'LIFETIME RECORDS', 21);

    // A hairline between the two columns, so they read as two lists rather than
    // one wide table with a gap in it.
    const split = this.add.rectangle(cx - 10, cy - 200, 3, 340, 0x5aa860).setOrigin(0.5).setAlpha(0.35);
    ov.add(split);

    // THE DIFFICULTY LADDER, per hero. One compact strip rather than three more
    // stat rows: it is a reminder of where each champion stands, not a table.
    ov.add(this.add.text(cx, cy + 30, 'HIGHEST DIFFICULTY CLEARED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: PARCH.textDim,
    }).setOrigin(0.5));
    const heroIds = Object.keys(CHARACTERS);
    heroIds.forEach((id, i) => {
      const cleared = highestDifficultyCleared(id);
      const mode = cleared >= 0 ? DIFFICULTIES[cleared] : null;
      const x = cx + (i - (heroIds.length - 1) / 2) * (1280 / heroIds.length);
      ov.add(this.add.text(x, cy + 62, `${CHARACTERS[id].name}  ${mode ? mode.name : 'none yet'}`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
        color: mode ? mode.ink : PARCH.textDim,
      }).setOrigin(0.5));
    });

    // The shelf of not-yets: summonable heroes still in the dark.
    ov.add(this.add.text(cx, cy + 108, 'HEROES YET UNFORGED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.textDim,
    }).setOrigin(0.5));
    // ------------------------------------------------------------------
    // THE SHELF IS REAL NOW (first-run audit, 2026-08-04).
    //
    // It used to be THREE hardcoded silhouettes, each a padlock and a '???',
    // with no data behind them and no way to ever earn them: they did not
    // change when a hero WAS unlocked, there were three of them when the game
    // has two locked heroes, and none of them said what to do. Meanwhile the
    // strip directly above already prints OPHELIA and DRUSKY by name, so the
    // mystery was not even being kept.
    //
    // So the shelf reads the roster: one silhouette per hero still in the dark,
    // and under each one the ASK, taken from the trophy that opens him rather
    // than written twice. Clear them all and the row says so instead of
    // standing there with three locks on an empty promise.
    // ------------------------------------------------------------------
    const shut = Object.values(CHARACTERS).filter(ch => !isCharacterUnlocked(ch.id));
    if (!shut.length) {
      ov.add(this.add.text(GAME_W / 2, GAME_H / 2 + 200, 'Every hero forged.', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: PARCH.accent,
      }).setOrigin(0.5));
    }
    shut.forEach((ch, i) => {
      const x = GAME_W / 2 + (i - (shut.length - 1) / 2) * 300;
      const s = this.add.image(x, GAME_H / 2 + 190, `silhouette_${(i % 3) + 1}`)
        .setTintFill(0x2a2136).setAlpha(0.9);
      s.setScale(120 / Math.max(s.width, s.height));
      const lock = this.add.image(x, GAME_H / 2 + 220, 'icon_lock').setScale(0.8);
      ov.add(s); ov.add(lock);
      this.tweens.add({ targets: s, y: GAME_H / 2 + 192, duration: 1600 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      ov.add(this.add.text(x, GAME_H / 2 + 268, '???', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.textDim,
      }).setOrigin(0.5));
      // THE ASK, in the hero's own words — the same line his card wears on the
      // select screen, so the two can never drift apart.
      ov.add(this.add.text(x, GAME_H / 2 + 298,
        ACHIEVEMENT_BY_ID[ch.unlock]?.hint ?? 'Not yet forged.', {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: PARCH.textDim,
          fontStyle: 'bold', wordWrap: { width: 280 }, align: 'center',
        }).setOrigin(0.5, 0));
    });

    const close = () => { this.__recordsOpen = false; ov.destroy(true); };
    dim.on('pointerdown', close);
    const btn = this.add.image(GAME_W / 2, GAME_H / 2 + 424, 'btn_yellow').setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
    ov.add(btn);
    ov.add(this.add.text(GAME_W / 2, GAME_H / 2 + 420, 'CLOSE', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#5b3a00',
    }).setOrigin(0.5));
    btn.on('pointerdown', () => { sfx(this, 'button', { volume: 0.7 }); close(); });
  }
}
