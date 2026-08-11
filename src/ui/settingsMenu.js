import { GAME_W, GAME_H, DEPTH, PARCH, MOBILE, SAFE, clearsCorners } from '../config.js';
import { tapBind } from './touch.js';
import { settings, saveSettings, DEV_SLIDER_STEPS, settingsPanelHeight } from '../core/settings.js';
import { refreshMusicVolume } from '../core/music.js';
import { sfx, refreshSfxVolume } from '../core/sfx.js';
import { woodPanel } from './panels.js';
import { run } from '../core/run.js';
import { writeSave, clearSave } from '../core/save.js';
import { popMessage } from './juice.js';
import { viewDeckButton } from './rewards.js';
import { openAchievements } from './achievements.js';
import { openIndex } from './glossary.js';
// ENDLESS (2026-08-05): FORFEIT is the only way out of an endless run, so it is
// an ENDING and has to bank the depth. See the forfeit handler below.
import { foldRunIntoRecords } from '../core/progress.js';
import { endlessLabel } from '../core/acts.js';

/** Where the ladder sits at x1 — the rung a mangled save falls back to. */
const DEFAULT_STEP = DEV_SLIDER_STEPS.indexOf(1);

/** The endless's own accent, matched to CombatScene's ceremonies. */
const ENDLESS_ACCENT = 0x9a5cff;

/** "Loop 2 · Act III · Floor 7" for the forfeit verdict's sub-line. */
function endlessForfeitLine(r = run) {
  const node = r?.map?.nodes?.[r?.map?.currentId];
  const floor = node ? Math.min(node.row + 1, 99) : Math.max(1, r?.stats?.reachedFloor ?? 1);
  return `${endlessLabel(r?.actIndex ?? 0)} · Floor ${floor}`;
}

// THE HEIGHT BUDGET lives in core/settings.js, which is Phaser-free, so a node
// test can hold it against the canvas without booting a renderer. Re-exported
// here because this file is where a person goes looking for it.
export { settingsPanelHeight };

/**
 * The little round -/+ tap button used by every stepper row (volumes, and the
 * dev balance sliders). One factory so the two never drift apart.
 */
function stepperBtn(scene, ov, bx, cy, glyph, onTap, { d = 44, fs = 28 } = {}) {
  const b = scene.add.image(bx, cy, 'btn_circle_gray')
    .setDisplaySize(d, d).setInteractive({ useHandCursor: true });
  const t = scene.add.text(bx, cy - 2, glyph, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${fs}px`, color: '#3a3a44',
  }).setOrigin(0.5);
  b.on('pointerdown', () => {
    onTap();
    scene.tweens.add({ targets: [b, t], scale: 0.9, duration: 60, yoyo: true });
  });
  ov.add(b); ov.add(t);
  return b;
}

/**
 * ===========================================================================
 * THE GEAR HAS ONE HOME AND ONE SIZE (JC, 2026-08-11: "the settings cog
 * sometimes overlaps with main menu elements")
 * ===========================================================================
 * FOUR scenes hang a gear, and until this wave they hung it in four different
 * places: `GAME_W - 140` from this file's own defaults, `GAME_W - 144` from
 * CombatScene, `GAME_W - 148` from MapScene, at y 66 or y 78 depending on who
 * you asked. Three of those were somebody hand-nudging ONE control against ONE
 * neighbour and the fourth was the default nobody went back to update — so
 * "move the gear" was a four-file edit and "is anything standing on the gear"
 * had four different answers, which is precisely how CharacterSelect ended up
 * printing SKINS across the top 55% of its face on every touch build.
 *
 * WORSE, THE SIZE WAS A LIE THAT THREE COMMENTS REPEATED. CombatScene declared
 * `COG.size = 66`, derived the potion mat's ceiling from it, and stated in
 * prose that "there is no size parameter to pass" — while `addSettingsButton`
 * below has drawn `MOBILE ? 76 : 44` since the day the phone build landed AND
 * has taken a `size` option the whole time. Every clearance computed off 66 was
 * 10px optimistic against a gear that was really 76.
 *
 * So both numbers live HERE and are exported. A scene that wants the gear
 * somewhere else DERIVES from this pair rather than retyping it, and the corner
 * audit, the mat that hangs under it and the driver hooks all read the same
 * two numbers as the thing that actually draws.
 *
 * WHERE IT LANDS ON TOUCH, measured rather than eyeballed: 48px in from the
 * safe frame's right edge and 54px down from its top puts a 76px square at
 * [GAME_W-182 .. GAME_W-106] x [40 .. 116] — identical on the 2340 phone and
 * the 1920 tablet, because both terms are GAME_W-relative. The test that
 * matters is the CORNER ARC (r=150, centred GAME_W-150,150), because a
 * corner-pinned icon lives on the diagonal where the glass bite is deepest:
 * the box's worst corner is (GAME_W-106, 40), 118px from that centre against a
 * 150px radius. 32px of margin — it was 0.7px while the hover tween had the
 * gear rotated 30 degrees, which is why that tween is now desktop-only.
 */
export const COG_SIZE = MOBILE ? 76 : 44;

/**
 * The gear's canonical centre and nominal square. Desktop's pair is
 * byte-for-byte the corner every desktop build has drawn (SAFE is {0,0} there),
 * so flipping every call site onto this constant cannot move that build.
 */
export const COG_HOME = MOBILE
  ? { x: GAME_W - SAFE.x - 48, y: SAFE.y + 54, size: COG_SIZE }
  : { x: GAME_W - 44, y: 42, size: COG_SIZE };

/**
 * Small gear button for any scene's corner.
 *
 * `depth` matters more than it looks (JC, 2026-08-04: "settings are not
 * accessible during events... needs to be usable at the map"): the map's
 * events, shops and rests all open full-screen overlays at DEPTH.overlay with
 * click-swallowing dimmers, and a gear at overlay-1 sat UNDER every one of
 * them — present, visible-ish, and unclickable. MapScene passes a depth above
 * its whole overlay stack so the gear stays live in every room.
 *
 * `size` has always been a parameter and is still one, because the scenes that
 * hang a gear have different neighbours: combat's shares the top-right strip
 * with the potion mat, the map's has the whole corner to itself. It simply
 * defaults to the exported truth now instead of to a private ternary.
 */
export function addSettingsButton(scene, x = COG_HOME.x, y = COG_HOME.y,
  depth = DEPTH.overlay - 1, { size = COG_HOME.size } = {}) {
  const btn = scene.add.image(x, y, 'icon_setting')
    .setDepth(depth).setInteractive({ useHandCursor: true }).setAlpha(0.85);
  btn.setScale(size / Math.max(btn.width, btn.height));
  btn.setData('hfLabel', 'SETTINGS');
  // ------------------------------------------------------------------
  // IDENTITY, NOT A LABEL (2026-08-11, found red by the verification driver).
  //
  // `hfLabel` names what a control SAYS, and two different controls are allowed
  // to say the same word. On the title screen exactly that happens: this gear
  // and the ladder's own 300x68 SETTINGS plate both answer to 'SETTINGS', and
  // the ladder plate is EARLIER on the display list — so a chrome audit doing
  // `plates.find(p => p.label === 'SETTINGS')` measured the wrong object, and a
  // `filter(p => p.label !== 'SETTINGS')` dropped BOTH, which took the ladder's
  // real, live, clickable plate out of the collision sweep entirely. The audit
  // built to answer "does the cog overlap a main-menu element" had a blind spot
  // on the one main-menu element named after it.
  //
  // So the gear carries a ROLE as well as a label. A role is about what a thing
  // IS; there is exactly one cog per scene and no plate can ever accidentally
  // claim to be it. Every audit resolves the gear through this, never through
  // its caption. (MapScene and CombatScene keep their own copies of the walk —
  // another workstream's files this week — and should adopt `hfRole` for the
  // same reason; their NAMED table has the identical weakness the day anything
  // else on those screens is labelled SETTINGS.)
  // ------------------------------------------------------------------
  btn.setData('hfRole', 'cog');
  // ------------------------------------------------------------------
  // THE TILT IS DESKTOP-ONLY, AND THE REASON IS GEOMETRY, NOT THE HOVER RULE.
  //
  // A 30-degree rotation inflates a square's axis-aligned bounding box by
  // cos30+sin30 = 1.366, which turns the touch gear's honest 76px box into a
  // 103.8px one WHILE THE MOUSE IS ON IT. Every clearance in this corner —
  // the arc test above, the gap SKINS keeps on character select, the potion
  // mat's ceiling in combat — would have to be computed against the inflated
  // box or be wrong exactly when somebody is pointing at the thing. On the arc
  // it was the difference between 32px of margin and 0.7px.
  //
  // On a finger the tween buys nothing anyway: it is a hover flourish on a
  // build with no hover, and the only thing it would ever do is spin under a
  // thumb on the way into the panel. So the touch build's gear is a 76px
  // square that stays a 76px square, and every number written about it is true
  // at every instant. (This is NOT the hover-INFORMATION removal of ui/touch.js
  // hoverInfo — the tilt describes nothing and would have been allowed to stay.)
  // ------------------------------------------------------------------
  if (!MOBILE) {
    btn.on('pointerover', () => scene.tweens.add({ targets: btn, angle: 30, alpha: 1, duration: 150 }));
    btn.on('pointerout', () => scene.tweens.add({ targets: btn, angle: 0, alpha: 0.85, duration: 150 }));
  }
  // ON RELEASE on touch (see ui/pointer.js): a panel that opens on the PRESS
  // hands the rest of its own gesture to whatever it lands on top of.
  tapBind(scene, btn, () => openSettings(scene));
  return btn;
}

// ===========================================================================
// THE CHROME AUDIT, AS THREE SHARED FUNCTIONS
// ---------------------------------------------------------------------------
// JC's report was "the settings cog sometimes overlaps with main menu
// elements", and the only honest answer to a SOMETIMES is a driver that
// MEASURES every screen at both touch widths rather than a person squinting at
// one. MapScene.__hf.buttons() and CombatScene.__hf.chromeAudit() already do
// exactly that for the two in-run scenes; TitleScene and CharacterSelectScene
// had no geometry hook at all, which is why nobody noticed SKINS sitting on the
// gear on every touch build since the day SKINS was added to that screen.
//
// The walker and the box arithmetic live HERE — beside the control they exist
// to protect — rather than being typed out a third and fourth time. The two
// in-run scenes keep their own copies for now (another workstream owns those
// files); the shapes are deliberately identical so they can be merged later
// without a driver noticing.
// ===========================================================================

/**
 * EVERY NAMED PLATE ON A SCENE, IN WORLD SPACE.
 *
 * The canonical walk, matched to MapScene.__hf.buttons(): a recursive descent
 * of the display list picking up anything wearing a `btn_` texture (which is
 * every wooden plate in the game, including the ones ui/choicebox.js draws)
 * plus the gear, which is not a plate but IS the one control a corner-clearance
 * driver has to be able to find by name.
 *
 * `input?.enabled` is the filter that matters: a plate inside a torn-down
 * overlay is still on the list for a frame, and a driver asserting "nothing
 * overlaps the gear" must not be handed a ghost.
 *
 * EVERY PLATE CARRIES A `role` AS WELL AS A `label`, and callers that mean a
 * SPECIFIC control must resolve it by role. See addSettingsButton for the bug
 * that paid for the distinction: labels are captions, and two controls may
 * legitimately share one.
 */
export function chromeButtons(scene) {
  const NAMED = { icon_setting: 'SETTINGS' };
  const out = [];
  const walk = (o) => {
    if (!o) return;
    const key = o.texture?.key ?? '';
    if (o.texture && (/^btn_/.test(key) || key in NAMED) && o.input?.enabled) {
      const m = o.getWorldTransformMatrix();
      out.push({
        key, label: o.getData?.('hfLabel') ?? NAMED[key] ?? null,
        role: o.getData?.('hfRole') ?? null,
        x: Math.round(m.tx), y: Math.round(m.ty),
        w: Math.round(o.displayWidth), h: Math.round(o.displayHeight),
      });
    }
    (o.list ?? []).forEach(walk);
  };
  scene.children.list.forEach(walk);
  return out;
}

/**
 * One labelled rectangle, with the corner verdict already taken.
 *
 * `decor` marks a box that is DRAWN but not AIMED AT — a version stamp, a
 * caption, a painted mat. It still reports `clears` (JC reads the build number
 * off the version stamp, so a stamp inside the corner bite is a real defect)
 * but it is excluded from the collision pass, because two pieces of text
 * sharing a strip is a layout, not a bug.
 */
export function chromeBox(label, x, y, w, h, { decor = false } = {}) {
  const b = {
    label,
    x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
    left: Math.round(x - w / 2), right: Math.round(x + w / 2),
    top: Math.round(y - h / 2), bottom: Math.round(y + h / 2),
    decor,
  };
  b.clears = clearsCorners(b);
  return b;
}

/** The same box, measured off a live object (text included, origins honoured). */
export function chromeObjBox(label, obj, opts = {}) {
  if (!obj?.active) return null;
  const b = obj.getBounds();
  return chromeBox(label, b.centerX, b.centerY, b.width, b.height, opts);
}

/**
 * EVERY INTERSECTING PAIR OF TARGETS, label against label.
 *
 * Pairwise and not cog-against-the-world on purpose: the cog is what JC
 * reported, but the defect class is "two things were placed by two people who
 * never measured each other", and the next instance of it will not involve the
 * gear. A driver asserts this list is EMPTY.
 */
export function chromeCollisions(boxes) {
  const live = boxes.filter(b => b && !b.decor);
  const out = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], c = live[j];
      if (!(a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top)) continue;
      out.push({
        a: a.label, b: c.label,
        w: Math.min(a.right, c.right) - Math.max(a.left, c.left),
        h: Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top),
      });
    }
  }
  return out;
}

/**
 * EVERY CAPTION THIS SCREEN PRINTS ON MORE THAN ONE BOX.
 *
 * THE BUG IT EXISTS FOR (2026-08-11): the Title has two objects that say
 * 'SETTINGS' — the corner gear and the ladder's own menu plate — and
 * `TitleScene.chrome()` resolved the cog by that caption. It picked the wrong
 * one, and the `filter` beside it then dropped BOTH from the collision sweep,
 * so the audit written for "the settings cog overlaps a main-menu element" was
 * structurally blind to the one element named after the cog.
 *
 * The fix was to resolve by `hfRole`. THIS is the tripwire that stops the next
 * one: any driver reaching for `boxes.find(b => b.label === 'X')` can first ask
 * whether X identifies anything at all.
 *
 * IT IS A REPORT, NOT AN ASSERTION, and deliberately so. A scene legitimately
 * prints one caption on several boxes (a row of identical sockets; a plate's
 * text child carrying its parent's label), so a strict `dupLabels === []` would
 * be red for reasons that are not bugs. The contract the drivers assert is the
 * narrower, true one: no repeated name INSIDE the chrome contract, and no
 * ambiguity in the labels a driver actually resolves by. Tightening this to a
 * hard assertion needs the walk to count only hfLabel-carrying interactive
 * targets minus plate text children — a follow-up, not this wave.
 */
export function chromeDupLabels(boxes) {
  const seen = new Map();
  for (const b of boxes) if (b) seen.set(b.label, (seen.get(b.label) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([label, n]) => ({ label, n }));
}

/** Modal settings overlay: master/music/sfx volumes, screen shake, fullscreen. */
export function openSettings(scene) {
  if (scene.__settingsOpen) return;
  scene.__settingsOpen = true;

  // DEV BALANCE SECTION (2026-08-01). Three live tuning sliders only exist when
  // DEV MODE is on, so the panel GROWS DOWNWARD to make room for them. Rows are
  // laid out from OY (the panel's top block) and the closing buttons from BOT
  // (the panel's bottom edge), so the section slots in between without either
  // end having to know how tall it is.
  // +82 for the UNLOCK ALL row, which is always present (testers need it
  // without DEV MODE, which is the whole point of it being its own button).
  //
  // TRAP PAID FOR (2026-08-02): the dev panel used to be 1148 tall on a 1080
  // canvas, so it ran off the top AND bottom and the RESUME button was under the
  // bezel. The ROWS tighten rather than the type shrinking: every row keeps its
  // shipped font size, the vertical rhythm just closes up. Hence one layout
  // table per mode instead of literals inline. Never let PANEL_H exceed GAME_H.
  //
  // 2026-08-03: DRAG TO SELECT joined the list. Both rhythms closed up again to
  // pay for it — the non-dev panel had 110px between the title and the first
  // volume row and 72px between volumes, which was more air than the rows need —
  // so the dev panel came out SHORTER than before (1028 vs 1040) even carrying
  // an extra row.
  const PANEL_H = settingsPanelHeight(settings.dev);
  const OY = GAME_H / 2 - (PANEL_H - 850) / 2;   // top block anchor
  const BOT = GAME_H / 2 + PANEL_H / 2;          // panel bottom edge

  // Row anchors, as offsets from OY. Dev mode runs a tighter rhythm so the three
  // balance sliders fit above the UNLOCK ALL / SAVE & QUIT / RESUME stack, which
  // is anchored to BOT. Ordering here is the on-screen ordering, top to bottom.
  //
  // 2026-08-03, SECOND PASS. The dev block was 26px too high: OY moves with
  // PANEL_H but the panel's TOP EDGE moves faster, so at 1028 tall the SETTINGS
  // heading's own top edge landed at y=24 against a frame that starts at y=26 —
  // the word was sitting IN the bevel. Every dev offset below is the old table
  // plus 26, which puts the heading's headroom at 28px (the non-dev panel's is
  // 36) and costs nothing: the last balance slider ends at OY+336 and the
  // UNLOCK ALL row it has to clear is anchored a further 100px below that.
  const LY = settings.dev
    ? { title: -374, vol: [-312, -258, -204], shake: -148, colors: -90, drag: -32,
        speed: 26, full: 84, devMode: 142, devHdr: 200, devRow0: 240, devPitch: 48 }
    : { title: -366, vol: [-282, -218, -154], shake: -92, colors: -36, drag: 32,
        speed: 100, full: 170, devMode: 234, devHdr: 288, devRow0: 328, devPitch: 52 };

  // +30, not +5: the panel is MODAL, and it can now be opened from inside an
  // event, a shop, the Oracle or the casino (the map gear floats above them
  // all) — so it has to render above whatever it was opened over, or SETTINGS
  // would appear underneath the very overlay the player opened it from.
  const ov = scene.add.container(0, 0).setDepth(DEPTH.overlay + 30);
  const dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.72)
    .setInteractive(); // swallow clicks behind the panel
  ov.add(dim);
  const parts = woodPanel(scene, GAME_W / 2, GAME_H / 2, 680, PANEL_H, { accent: 0xffc542 });
  ov.add([parts.shadow, parts.panel, parts.line]);

  const titleText = scene.add.text(GAME_W / 2, OY + LY.title, 'SETTINGS', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '46px', color: PARCH.text,
  }).setOrigin(0.5);
  ov.add(titleText);

  const SEGS = 10;
  const makeVolumeRow = (yOff, icon, label, field) => {
    const cy = OY + yOff;
    const ic = scene.add.image(GAME_W / 2 - 268, cy, icon).setTint(0x6b4526);
    ic.setScale(38 / Math.max(ic.width, ic.height));
    ov.add(ic);
    ov.add(scene.add.text(GAME_W / 2 - 232, cy, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.text,
    }).setOrigin(0, 0.5));

    const segs = [];
    const segX0 = GAME_W / 2 - 40, segW = 22, segGap = 26;
    for (let i = 0; i < SEGS; i++) {
      const s = scene.add.rectangle(segX0 + i * segGap, cy, segW, 26, 0xa3541c)
        .setStrokeStyle(2, 0x6b4526);
      segs.push(s);
      ov.add(s);
    }
    const redraw = () => {
      const lit = Math.round(settings[field] * SEGS);
      segs.forEach((s, i) => s.setFillStyle(i < lit ? 0xa3541c : 0xdcc492));
    };
    const bump = (d) => {
      settings[field] = Phaser.Math.Clamp(Math.round((settings[field] + d) * 10) / 10, 0, 1);
      // MUSIC re-reads its own gain; so, now, does every LOOPING sfx — the
      // low-health heartbeat used to keep playing at the level it started at
      // while the slider that was supposed to be quieting it went to zero.
      saveSettings(); redraw(); refreshMusicVolume(); refreshSfxVolume();
      sfx(scene, 'button', { volume: 0.8 });
    };
    stepperBtn(scene, ov, segX0 - 52, cy, '-', () => bump(-0.1));
    stepperBtn(scene, ov, segX0 + SEGS * segGap + 26, cy, '+', () => bump(+0.1));
    redraw();
  };

  makeVolumeRow(LY.vol[0], 'icon_volume', 'MASTER', 'master');
  makeVolumeRow(LY.vol[1], 'icon_music_note', 'MUSIC', 'music');
  makeVolumeRow(LY.vol[2], 'icon_sound', 'SFX', 'sfx');

  /** ON/OFF row bound to a boolean setting field, with an optional sublabel. */
  const makeToggleRow = (yOff, label, field, { sub = null, after = null } = {}) => {
    const cy = OY + yOff;
    ov.add(scene.add.text(GAME_W / 2 - 268, cy, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.text,
    }).setOrigin(0, 0.5));
    if (sub) {
      ov.add(scene.add.text(GAME_W / 2 - 268, cy + 26, sub, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '15px', color: PARCH.textDim, fontStyle: 'bold',
      }).setOrigin(0, 0.5));
    }
    const btn = scene.add.image(GAME_W / 2 + 160, cy, settings[field] ? 'btn_green' : 'btn_gray')
      .setDisplaySize(150, 54).setInteractive({ useHandCursor: true });
    const txt = scene.add.text(GAME_W / 2 + 160, cy - 3, settings[field] ? 'ON' : 'OFF', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: settings[field] ? '#0c3d18' : '#3a3a44',
    }).setOrigin(0.5);
    btn.on('pointerdown', () => {
      settings[field] = !settings[field]; saveSettings();
      btn.setTexture(settings[field] ? 'btn_green' : 'btn_gray');
      txt.setText(settings[field] ? 'ON' : 'OFF').setColor(settings[field] ? '#0c3d18' : '#3a3a44');
      sfx(scene, 'button', { volume: 0.8 });
      after?.();
    });
    ov.add(btn); ov.add(txt);
    return { btn, txt };
  };

  makeToggleRow(LY.shake, 'SCREEN SHAKE', 'shake');

  // Per-suit painted card faces. A live fight rebuilds its hand on the spot,
  // so the toggle answers immediately instead of waiting for the next draw.
  makeToggleRow(LY.colors, 'CARD COLORS', 'cardColors', {
    sub: 'each suit gets its own painted face',
    after: () => {
      const combat = window.__hfCombat?.scene;
      if (!combat || !combat.scene?.isActive() || !Array.isArray(combat.handCards)) return;
      for (let i = 0; i < combat.handCards.length; i++) {
        const lock = combat.handCards[i].lockState;
        combat.replaceCardSprite(combat.handCards[i]);
        if (lock) combat.handCards[i].setLockState(lock);
      }
    },
  });

  // SWEEP TO SELECT. The sublabel has to name BOTH halves of the gesture,
  // because turning this on is the one setting that changes what a drag the
  // player already makes every fight will do.
  makeToggleRow(LY.drag, 'DRAG TO SELECT', 'dragSelect', {
    sub: 'sweep the fan to pick several, drag up to reorder',
  });

  // HAND SPEED — 1x / 2x / 3x cycle. 2x is the shipped scoring cadence; 1x
  // halves it so the per-card math is legible, 3x is the "just resolve it" pace.
  const spdY = OY + LY.speed;
  ov.add(scene.add.text(GAME_W / 2 - 268, spdY, 'HAND SPEED', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.text,
  }).setOrigin(0, 0.5));
  ov.add(scene.add.text(GAME_W / 2 - 268, spdY + 26, 'how fast a played hand scores', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '15px', color: PARCH.textDim, fontStyle: 'bold',
  }).setOrigin(0, 0.5));
  const spdBtn = scene.add.image(GAME_W / 2 + 160, spdY, 'btn_blue')
    .setDisplaySize(150, 54).setInteractive({ useHandCursor: true });
  const spdTxt = scene.add.text(GAME_W / 2 + 160, spdY - 3, `${settings.playSpeed}x`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#0a2a4a',
  }).setOrigin(0.5);
  spdBtn.on('pointerdown', () => {
    settings.playSpeed = (settings.playSpeed % 3) + 1;
    saveSettings();
    spdTxt.setText(`${settings.playSpeed}x`);
    sfx(scene, 'button', { volume: 0.8 });
    scene.tweens.add({ targets: spdTxt, scale: 0.9, duration: 60, yoyo: true });
  });
  ov.add(spdBtn); ov.add(spdTxt);

  // Fullscreen
  const fsY = OY + LY.full;
  ov.add(scene.add.text(GAME_W / 2 - 268, fsY, 'FULLSCREEN', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.text,
  }).setOrigin(0, 0.5));
  const fsBtn = scene.add.image(GAME_W / 2 + 160, fsY, 'btn_blue').setDisplaySize(150, 54).setInteractive({ useHandCursor: true });
  const fsTxt = scene.add.text(GAME_W / 2 + 160, fsY - 3, 'TOGGLE', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: '#0a2a4a',
  }).setOrigin(0.5);
  fsBtn.on('pointerdown', () => {
    if (scene.scale.isFullscreen) scene.scale.stopFullscreen(); else scene.scale.startFullscreen();
  });
  ov.add(fsBtn); ov.add(fsTxt);

  // Developer mode — unlocks everything + adds skip tools in-run.
  // Toggling it REOPENS the panel, because the DEV BALANCE section below only
  // exists while it is on and the whole layout resizes around it.
  makeToggleRow(LY.devMode, 'DEV MODE', 'dev', {
    sub: 'WIN button in fights · +chips on map · all acts · balance sliders',
    after: () => {
      const reopen = () => { close(); openSettings(scene); };
      if (!settings.dev) return reopen();
      import('../core/progress.js').then(({ progress, saveProgress }) => {
        progress.act4Unlocked = true; progress.endlessUnlocked = true; saveProgress();
        reopen();
      });
    },
  });

  // =========================================================================
  // DEV BALANCE SLIDERS (dev mode only)
  // -------------------------------------------------------------------------
  // Three live multipliers on the DEV_SLIDER_STEPS ladder
  // (0.25 · 0.5 · 0.75 · 1 · 1.5 · 2 · 3 · 5 · 10). They COMPOUND with the
  // shipped baseline, so x1 IS the shipped game — the enemy-damage baseline
  // already carries its own -35% and the slider rides on top of that.
  //
  // Where each one lands:
  //   ENEMY HP     core/enemies.js makeEnemy()      — at spawn
  //   ENEMY DAMAGE core/enemies.js currentIntent()  — LIVE, and the telegraphed
  //                                                   number moves with it
  //   GOLD         core/run.js gainGold()           — the one funnel every
  //                                                   payout goes through:
  //                                                   kills, hand chips, packs,
  //                                                   events, relics, potions
  // =========================================================================
  if (settings.dev) {
    const stepRow = (yOff, label, field, sub) => {
      const cy = OY + yOff;
      ov.add(scene.add.text(GAME_W / 2 - 268, cy, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '23px', color: PARCH.text,
      }).setOrigin(0, 0.5));
      ov.add(scene.add.text(GAME_W / 2 - 268, cy + 22, sub, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '14px', color: PARCH.textDim, fontStyle: 'bold',
      }).setOrigin(0, 0.5));

      const val = scene.add.text(GAME_W / 2 + 150, cy, '', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: PARCH.accent,
      }).setOrigin(0.5);
      ov.add(val);
      // The VALUE is whatever is saved; the index only exists to step from.
      const idx = () => {
        const i = DEV_SLIDER_STEPS.indexOf(settings[field]);
        return i >= 0 ? i : DEFAULT_STEP;
      };
      const redraw = () => {
        const v = settings[field];
        val.setText(`×${v}`);
        val.setColor(v === 1 ? PARCH.textDim : (v > 1 ? '#a3541c' : '#3f6b8a'));
      };
      const step = (d) => {
        const i = Phaser.Math.Clamp(idx() + d, 0, DEV_SLIDER_STEPS.length - 1);
        settings[field] = DEV_SLIDER_STEPS[i];
        saveSettings(); redraw();
        sfx(scene, 'button', { volume: 0.7 });
      };
      stepperBtn(scene, ov, GAME_W / 2 + 68, cy, '-', () => step(-1), { d: 42, fs: 26 });
      stepperBtn(scene, ov, GAME_W / 2 + 232, cy, '+', () => step(+1), { d: 42, fs: 26 });
      redraw();
    };

    // PARCH.text, not accent: the accent orange is a 4:1 on parchment, which is
    // fine for a 30px number and thin for a 21px heading.
    ov.add(scene.add.text(GAME_W / 2 - 268, OY + LY.devHdr, 'DEV · BALANCE', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: PARCH.text,
    }).setOrigin(0, 0.5));
    ov.add(scene.add.text(GAME_W / 2 + 40, OY + LY.devHdr, '×1 = the shipped game', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '14px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0, 0.5));

    stepRow(LY.devRow0, 'ENEMY HP', 'devEnemyHp', 'applied when an enemy spawns');
    stepRow(LY.devRow0 + LY.devPitch, 'ENEMY DAMAGE', 'devEnemyDmg', 'live, the intent number moves too');
    stepRow(LY.devRow0 + LY.devPitch * 2, 'GOLD RECEIVED', 'devGold', 'every chip the run pays you, not refunds');
  }

  // =========================================================================
  // UNLOCK ALL (TESTERS)
  // -------------------------------------------------------------------------
  // Deliberately NOT part of DEV MODE. A tester needs the content opened up
  // (the Crucible, Endless, every difficulty on every hero, every secret hand)
  // so they can go straight at whatever they were asked to break. They must not
  // get the WIN button, the map chip printer or the balance sliders, because a
  // report from a run that used those is worth nothing.
  // Behind a confirm: it spends unlocks that are meant to be earned.
  // =========================================================================
  const inRun = scene.scene.key === 'Map' || scene.scene.key === 'Combat';
  const unlockY = BOT - (inRun ? 225 : 143);

  // =========================================================================
  // ACHIEVEMENTS · INDEX · UNLOCK ALL, from the pause menu (patch §6)
  // -------------------------------------------------------------------------
  // The trophy shelf used to live on the title screen only, which meant the one
  // place you actually WANT it — three fights into a run, wondering what the
  // hint on a locked tile was — was the one place you could not reach it. The
  // pause menu is reachable from every scene in the game, so it is the right
  // door, and putting it here costs the panel no height (see
  // settingsPanelHeight). Same shelf, same overlay: it opens ON TOP of the
  // settings panel and closing it puts you back here, run untouched.
  //
  // THE INDEX joined the row on 2026-08-10 (the COPY CLARITY WAVE) on exactly
  // that arithmetic. The panel is a 680px frame on a canvas that has already had
  // the RESUME button under the bezel once, so a THIRD full-width row was never
  // an option: the row splits into three 206px buttons instead and
  // settingsPanelHeight does not move by a pixel. Keep it that way.
  // =========================================================================
  const ROW_W = 206, ROW_DX = 213;
  const achBtn = scene.add.image(GAME_W / 2 - ROW_DX, unlockY, 'btn_blue')
    .setDisplaySize(ROW_W, 60).setInteractive({ useHandCursor: true });
  const achTxt = scene.add.text(GAME_W / 2 - ROW_DX, unlockY - 3, 'ACHIEVEMENTS', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: '#0a2a4a',
  }).setOrigin(0.5);
  ov.add(achBtn); ov.add(achTxt);
  achBtn.on('pointerdown', () => {
    sfx(scene, 'button', { volume: 0.8 });
    openAchievements(scene);
  });

  // THE INDEX: the glossary. Same door rules as the shelf beside it, and it
  // renders above this panel (DEPTH.overlay + 34 against our + 30).
  const idxBtn = scene.add.image(GAME_W / 2, unlockY, 'btn_blue')
    .setDisplaySize(ROW_W, 60).setInteractive({ useHandCursor: true });
  const idxTxt = scene.add.text(GAME_W / 2, unlockY - 3, 'INDEX', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '23px', color: '#0a2a4a',
  }).setOrigin(0.5);
  ov.add(idxBtn); ov.add(idxTxt);
  idxBtn.on('pointerdown', () => {
    sfx(scene, 'button', { volume: 0.8 });
    openIndex(scene);
  });

  const unlockBtn = scene.add.image(GAME_W / 2 + ROW_DX, unlockY, 'btn_gray')
    .setDisplaySize(ROW_W, 60).setInteractive({ useHandCursor: true });
  const unlockTxt = scene.add.text(GAME_W / 2 + ROW_DX, unlockY - 3, 'UNLOCK ALL', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: '#3a3a44',
  }).setOrigin(0.5);
  ov.add(unlockBtn); ov.add(unlockTxt);
  unlockBtn.on('pointerdown', () => {
    sfx(scene, 'button', { volume: 0.8 });
    const confirm = scene.add.container(0, 0).setDepth(DEPTH.overlay + 37);
    confirm.add(scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.6).setInteractive());
    const cp = woodPanel(scene, GAME_W / 2, GAME_H / 2, 600, 300, { accent: 0x5aa860 });
    confirm.add([cp.shadow, cp.panel, cp.line]);
    confirm.add(scene.add.text(GAME_W / 2, GAME_H / 2 - 80, 'Unlock everything?', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: PARCH.text,
    }).setOrigin(0.5));
    confirm.add(scene.add.text(GAME_W / 2, GAME_H / 2 - 16,
      'Opens the Crucible, Endless, every difficulty on every hero and every secret hand. '
      + 'There is no undo, and nothing left to find.', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '20px', color: PARCH.textDim,
        fontStyle: 'bold', align: 'center', wordWrap: { width: 520 },
      }).setOrigin(0.5));
    const mk = (bx, key, label, color, cb) => {
      const b = scene.add.image(bx, GAME_H / 2 + 82, key).setDisplaySize(240, 60).setInteractive({ useHandCursor: true });
      const t = scene.add.text(bx, GAME_H / 2 + 78, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '23px', color,
      }).setOrigin(0.5);
      confirm.add(b); confirm.add(t);
      b.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.8 }); cb(); });
    };
    mk(GAME_W / 2 - 140, 'btn_green', 'UNLOCK ALL', '#0c3d18', () => {
      confirm.destroy(true);
      import('../core/progress.js').then(({ unlockEverything }) => {
        const line = unlockEverything();
        close();
        popMessage(scene, GAME_W / 2, GAME_H / 2, line, { color: '#7ee08a', size: 34 })
          .setDepth(DEPTH.overlay + 42);
        // A live CharacterSelect is showing plates that just changed. Rebuild it
        // so the ladder opens in front of the tester instead of on next visit.
        // After the toast has had its moment: a restart kills the toast too.
        if (scene.scene.key === 'CharacterSelect') scene.time.delayedCall(1100, () => scene.scene.restart());
      });
    });
    mk(GAME_W / 2 + 140, 'btn_dark', 'NEVER MIND', '#cfc8e8', () => confirm.destroy(true));
  });

  // SAVE & QUIT — only shown mid-run (Map or Combat), still behind a confirm.
  // The old destructive "abandon this run" is gone: leaving now parks the run
  // and the Title picks it back up. Mid-fight, the save was taken at the
  // opening bell, so the confirm says so rather than letting you discover it.
  if (scene.scene.key === 'Map' || scene.scene.key === 'Combat') {
    const inFight = scene.scene.key === 'Combat';
    const quitY = BOT - 143;
    // SAVE & QUIT and FORFEIT RUN share the row (JC, 2026-08-04: "an
    // additional Forfeit Run button if you'd rather not save the fight and
    // just restart back at the main menu").
    const quitBtn = scene.add.image(GAME_W / 2 - 160, quitY, 'btn_blue').setDisplaySize(300, 60).setInteractive({ useHandCursor: true });
    const quitTxt = scene.add.text(GAME_W / 2 - 160, quitY - 3, 'SAVE & QUIT', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#0a2a4a',
    }).setOrigin(0.5);
    ov.add(quitBtn); ov.add(quitTxt);

    const ffBtn = scene.add.image(GAME_W / 2 + 160, quitY, 'btn_red').setDisplaySize(300, 60).setInteractive({ useHandCursor: true });
    const ffTxt = scene.add.text(GAME_W / 2 + 160, quitY - 3, 'FORFEIT RUN', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#4a0a10',
    }).setOrigin(0.5);
    ov.add(ffBtn); ov.add(ffTxt);
    ffBtn.on('pointerdown', () => {
      sfx(scene, 'button', { volume: 0.8 });
      const confirm = scene.add.container(0, 0).setDepth(DEPTH.overlay + 37);
      confirm.add(scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.6).setInteractive());
      const cp = woodPanel(scene, GAME_W / 2, GAME_H / 2, 560, 280, { accent: 0xa8121e });
      confirm.add([cp.shadow, cp.panel, cp.line]);
      confirm.add(scene.add.text(GAME_W / 2, GAME_H / 2 - 66, 'Forfeit the run?', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: PARCH.text,
      }).setOrigin(0.5));
      confirm.add(scene.add.text(GAME_W / 2, GAME_H / 2 - 18, run.endless
        ? 'The endless ends here. Your depth is banked to the RECORDS shelf '
          + 'and the run report follows.'
        : 'The run ends here: nothing is saved and there is no CONTINUE. '
        + 'Straight back to the main menu.', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim,
        fontStyle: 'bold', align: 'center', wordWrap: { width: 480 },
      }).setOrigin(0.5));
      const mkf = (bx, key, label, color, cb) => {
        const b = scene.add.image(bx, GAME_H / 2 + 66, key).setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
        const t = scene.add.text(bx, GAME_H / 2 + 62, label, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color,
        }).setOrigin(0.5);
        confirm.add(b); confirm.add(t);
        b.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.8 }); cb(); });
      };
      mkf(GAME_W / 2 - 130, 'btn_red', 'FORFEIT', '#4a0a10', () => {
        clearSave();          // no parked run left behind to CONTINUE into
        confirm.destroy(true);
        close();
        // ------------------------------------------------------------------
        // WALKING OUT OF THE ENDLESS IS AN ENDING, NOT AN ABANDONMENT
        // (2026-08-05). An endless run has already beaten the game; FORFEIT is
        // the only door out of it, so it owes the player the same report card a
        // death gives them — and it owes the lifetime shelf the depth. Routed
        // through CombatScene.showEnd where there is one (it folds the records,
        // clears the save and draws the recap); from the MAP there is no end
        // screen to draw, so the depth is banked directly and the run bows out
        // to the Title exactly as a finite forfeit does.
        // ------------------------------------------------------------------
        if (run.endless && typeof scene.showEnd === 'function') {
          scene.showEnd('THE ENDLESS RELEASES YOU', endlessForfeitLine(), ENDLESS_ACCENT, true);
          return;
        }
        if (run.endless && run.stats) {
          run.stats.cleared = true;
          if (!Array.isArray(run.stats.recordsBeaten)) {
            run.stats.recordsBeaten = foldRunIntoRecords(run);
          }
        }
        run.active = false;
        scene.scene.start('Title');
      });
      mkf(GAME_W / 2 + 130, 'btn_dark', 'KEEP PLAYING', '#cfc8e8', () => confirm.destroy(true));
    });
    quitBtn.on('pointerdown', () => {
      sfx(scene, 'button', { volume: 0.8 });
      const confirm = scene.add.container(0, 0).setDepth(DEPTH.overlay + 37);
      confirm.add(scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.6).setInteractive());
      const cp = woodPanel(scene, GAME_W / 2, GAME_H / 2, 560, 280, { accent: 0xffc542 });
      confirm.add([cp.shadow, cp.panel, cp.line]);
      confirm.add(scene.add.text(GAME_W / 2, GAME_H / 2 - 66, 'Save and quit?', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: PARCH.text,
      }).setOrigin(0.5));
      confirm.add(scene.add.text(GAME_W / 2, GAME_H / 2 - 18, inFight
        ? 'CONTINUE RUN puts you back at the start of this fight.'
        : 'CONTINUE RUN picks this up right where you are standing.', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim,
        fontStyle: 'bold', align: 'center', wordWrap: { width: 480 },
      }).setOrigin(0.5));
      const mk = (bx, key, label, color, cb) => {
        const b = scene.add.image(bx, GAME_H / 2 + 66, key).setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
        const t = scene.add.text(bx, GAME_H / 2 + 62, label, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color,
        }).setOrigin(0.5);
        confirm.add(b); confirm.add(t);
        b.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.8 }); cb(); });
      };
      mk(GAME_W / 2 - 130, 'btn_yellow', 'SAVE & QUIT', '#5b3a00', () => {
        // Mid-fight the checkpoint blob is already the right one, so we only
        // rewrite it from the map (where the live run IS the truth). In combat
        // the run object has moved on since the opening bell, and writing it now
        // would bank a half-played fight we cannot restore.
        if (!inFight) writeSave(run);
        confirm.destroy(true);
        close();
        run.active = false;
        popMessage(scene, GAME_W / 2, GAME_H / 2, 'Run saved', { color: '#ffd23e', size: 44 })
          .setDepth(DEPTH.overlay + 42);
        scene.time.delayedCall(760, () => scene.scene.start('Title'));
      });
      mk(GAME_W / 2 + 130, 'btn_dark', 'KEEP PLAYING', '#cfc8e8', () => confirm.destroy(true));
    });
  }

  // Resume
  const resume = scene.add.image(GAME_W / 2, BOT - 57, 'btn_yellow')
    .setDisplaySize(260, 68).setInteractive({ useHandCursor: true });
  const resumeTxt = scene.add.text(GAME_W / 2, BOT - 61, 'RESUME', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '28px', color: '#5b3a00',
  }).setOrigin(0.5);
  const close = () => { scene.__settingsOpen = false; window.__hfSettingsPanel = null; ov.destroy(true); };
  resume.on('pointerdown', close);
  dim.on('pointerdown', close);
  ov.add(resume); ov.add(resumeTxt);

  // Verification hook (tools/verify_skins.py): the panel's fit and its rows, as
  // plain numbers. The HEIGHT is in here on purpose: the one thing about this
  // overlay that has ever actually broken is how tall it is.
  //
  // __hfSettingsPANEL, not __hfSettings: core/settings.js already publishes the
  // live settings object under that name and the existing drivers flip
  // `playSpeed` through it, so this must not sit on top of it.
  window.__hfSettingsPanel = {
    scene: scene.scene.key,
    dev: !!settings.dev,
    panelH: PANEL_H,
    canvasH: GAME_H,
    fits: PANEL_H <= GAME_H,
    top: Math.round(GAME_H / 2 - PANEL_H / 2),
    // HEADROOM: how far the SETTINGS heading sits below the panel's own top
    // edge. It went NEGATIVE in dev mode once (the word rendered in the bevel)
    // while every other number here still said the panel was fine, so it is
    // published as its own scalar rather than inferred.
    headroom: Math.round(titleText.getTopLeft().y - (GAME_H / 2 - PANEL_H / 2)),
    bottom: Math.round(BOT),
    achievements: { x: Math.round(GAME_W / 2 - ROW_DX), y: Math.round(unlockY) },
    index: { x: Math.round(GAME_W / 2), y: Math.round(unlockY) },
    unlockAll: { x: Math.round(GAME_W / 2 + ROW_DX), y: Math.round(unlockY) },
    resume: { x: Math.round(GAME_W / 2), y: Math.round(BOT - 57) },
    close,
  };

  // VIEW DECK, but only mid-run (PATCH 0803-B §4.3). The pause menu is the one
  // overlay reachable from literally anywhere, so it is the last place that
  // should make you back out to read your own deck. On the title screen there
  // is no run to read — `run.runDeck` is a stale blob until resumeRun() —
  // so the button simply is not offered there.
  // VIEW DECK · HANDS · MAP, at the row's own default home. The explicit
  // (150, GAME_H-62) it used to pass WAS the shipped default, so dropping it
  // changes nothing on desktop and lets the touch build inherit the safe-frame
  // start the three-plate cluster now derives (see INFO_PLATE in ui/rewards.js:
  // a 200px plate centred on 150 hangs its left edge inside SAFE.x).
  if (inRun && run?.active) viewDeckButton(scene, ov, run);
}
