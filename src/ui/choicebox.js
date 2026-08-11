/**
 * @file choicebox.js
 * THE TWO-TAP MODEL (JC, 2026-08-10). ONE box, ONE idiom, every surface.
 *
 * ===========================================================================
 * WHY HOLD-TO-HOVER HAD TO GO
 * ===========================================================================
 * The 08-04 touch model was "tap acts, hold reveals". JC played it on a real
 * phone and both halves failed for the same reason: A FINGER IS OPAQUE AND A
 * TAP IS FINAL.
 *
 *   · HOLD REVEALS put the tooltip under the very digit that summoned it. You
 *     press the relic to find out what it is and your thumb is now standing on
 *     the answer.
 *   · TAP ACTS meant every option on every shelf was one stray touch from being
 *     taken. The Oracle's three futures — a MANDATORY, run-shaping, one-of-three
 *     pick — committed on first contact, before the player had read a word.
 *
 * ===========================================================================
 * THE RULE THAT REPLACES IT
 * ===========================================================================
 * ANYTHING WHOSE INFORMATION IS HIDDEN BEHIND AN ICON OR A CARD GETS TWO TAPS.
 *
 *   1. The FIRST tap opens THIS box: the thing's name, its full rules text, and
 *      its commit button(s). It is persistent — it survives the finger lifting,
 *      it sits BESIDE the thing rather than under the thumb, and it commits
 *      nothing.
 *   2. The SECOND tap is on a labelled button inside the box, and that is the
 *      only thing in the whole model that acts.
 *   3. Tapping anywhere else dismisses. Tapping a DIFFERENT option dismisses
 *      this box and opens THAT one's, so a player browses tap-read-tap-read and
 *      only then commits. (Mechanically: the press closes the open box because
 *      it did not land on it, and the release opens the new one, because
 *      `tapBind` fires on release. One gesture, one swap.)
 *
 * NOTHING COMMITS ON FIRST TOUCH. That sentence is the whole feature.
 *
 * WHAT STAYS ONE TAP, and why: hand-card select/deselect (instantly reversible
 * and pace-critical), event choice plates (the full text is already on screen),
 * and every big labelled button — PLAY HAND, DISCARD, SORT, SKIP PACKS, LEAVE
 * IT. A button that already says what it does in words is the second tap; it
 * does not need a third.
 *
 * LONG-PRESS STILL WORKS EVERYWHERE, as a shortcut to the classic tooltip (see
 * ui/touch.js installLongPress and ui/inspect.js). Nothing REQUIRES it anymore.
 *
 * ===========================================================================
 * HOW THE DISMISS IS SAFE
 * ===========================================================================
 * The obvious implementation — a full-screen invisible catcher that closes on
 * any press, which is what the old two-step potion confirm used — cannot do
 * rule 3: the catcher eats the tap aimed at the next option, so browsing costs
 * two taps per option instead of one. So there is NO catcher. Instead:
 *
 *   · the box's own parts SWALLOW their gestures (ui/pointer.js swallowGestures
 *     plus the press-set release filter), so a press on the box can never reach
 *     the live content underneath it — the pass-through bug that patch exists
 *     to end;
 *   · and a scene-level `pointerdown` listener closes the box whenever the press
 *     did NOT land on one of those parts. Phaser hands that listener the same
 *     depth-sorted, topOnly-truncated hit list it just delivered the press to,
 *     so this needs no second hit test and cannot disagree with what happened.
 *
 * ===========================================================================
 * DESKTOP IS UNTOUCHED
 * ===========================================================================
 * `twoTap` throws on a non-touch build rather than silently doing something
 * else: every call site keeps its own `if (TOUCH) twoTap(...) else
 * obj.on('pointerdown', ...)` fork, which is the idiom the potion confirm
 * already used, and which makes the desktop path visible at the call site
 * instead of hidden in here.
 */

import { GAME_W, GAME_H, DEPTH, PARCH, TOUCH } from '../config.js';
import { woodPanel } from './panels.js';
import { sfx } from '../core/sfx.js';
import { tapBind } from './touch.js';
import { isRightPointer, swallowGestures } from './pointer.js';
import { notePanelOpen, notePanelClosed } from './infoPanels.js';

/**
 * THE BOX'S OWN MEASUREMENTS. One table, so "make it bigger" is one edit and
 * every surface in the game moves together.
 */
export const BOX = {
  wrap: TOUCH ? 460 : 420,      // text wrap width
  minW: TOUCH ? 380 : 340,
  // A FRACTION OF THE CANVAS, not a constant. 700px is 30% of the phone's 2340
  // and 36% of the tablet's 1920, and that difference is enough to push the box
  // onto a neighbouring option on the narrower board — where the three-across
  // shelf keeps its 372px pitch but has 420 fewer pixels to spread over.
  maxW: TOUCH ? Math.round(GAME_W * 0.34) : 640,
  padX: TOUCH ? 32 : 28,
  padTop: TOUCH ? 22 : 24,
  padBottom: TOUCH ? 16 : 22,
  titleSize: TOUCH ? 32 : 28,
  bodySize: TOUCH ? 24 : 21,
  noteSize: TOUCH ? 21 : 18,
  titleGap: 12,
  bodyGap: 18,
  /**
   * THE COMMIT BUTTON IS THE BIGGEST TARGET IN THE GAME, and it should be: it
   * is now the ONLY thing on a shelf that acts, and it is the last thing
   * between a player and a decision they cannot take back.
   *
   * 88x230 is 33 x 86 pt on the phone (2.69 game px to the point at 2340 over
   * 874). That is still under Apple's 44pt guidance — every plate in this game
   * is, because a 1080-tall world on a 402pt screen cannot afford 118px of
   * button — but it is half again the 66px the old confirms used and it is
   * comfortably the largest thing a thumb is asked to find.
   *
   * The padding above and the clearances below were shaved to pay for it, so
   * the box still fits UNDER a full-height option card (250px of room beneath
   * the pack shelf) rather than being pushed over the shelf's own title.
   */
  btnH: TOUCH ? 88 : 66,
  btnGap: 16,
  btnMinW: TOUCH ? 230 : 168,
  btnFont: TOUCH ? 32 : 26,
  gap: TOUCH ? 12 : 16,   // clearance between the box and the thing it describes
  edge: TOUCH ? 10 : 14,  // clearance between the box and the canvas edge
};

/** Button flavours -> the wood they are cut from. */
const BTN_ART = {
  go: { key: 'btn_green', color: '#0c3d18' },
  buy: { key: 'btn_yellow', color: '#5b3a00' },
  take: { key: 'btn_yellow', color: '#5b3a00' },
  danger: { key: 'btn_red', color: '#4a0a10' },
  off: { key: 'btn_dark', color: '#cfc8e8' },
  dead: { key: 'btn_gray', color: '#3a3a44' },
};

/** A spec field may be a value or a function of no arguments. */
const val = (v) => (typeof v === 'function' ? v() : v);

/** Is a choice box open on this scene (optionally: THIS one)? */
export function isChoiceBoxOpen(scene, key = null) {
  const box = scene?._choiceBox;
  if (!box || !box.active) return false;
  return key == null ? true : box.boxKey === key;
}

/** The key of whatever box is open, or null. */
export function openChoiceKey(scene) {
  return scene?._choiceBox?.active ? scene._choiceBox.boxKey : null;
}

/** Tear down whatever box is open on this scene. */
export function closeChoiceBox(scene, { silent = true } = {}) {
  const box = scene?._choiceBox;
  if (!box) return false;
  scene._choiceBox = null;
  notePanelClosed(box.panelToken);
  // WHAT JUST CLOSED, AND WHEN. `tapInfo` reads this to tell the second tap of
  // a toggle apart from a fresh one: pressing an info chip that is already
  // describing itself lands OFF the box, so wireDismiss closes it on the press
  // and tapBind would re-open it on the release. Without this crumb, a surface
  // you tapped twice would still be talking. See tapInfo.
  if (scene) scene._choiceClosed = { key: box.boxKey, at: scene.time?.now ?? 0 };
  if (!silent) sfx(scene, 'card_deselect', { volume: 0.42 });
  try { box.onClose?.(); } catch { /* the surface is already gone */ }
  if (box.active) box.destroy(true);
  if (window.__hfBox?.token === box.token) window.__hfBox = { open: false };
  return true;
}

/**
 * The scene-level dismiss. Installed once per scene, taken down with it.
 *
 * `hits` is Phaser's own `currentlyOver` for this press — depth-sorted and (by
 * the engine's default `topOnly`) at most one object long: the thing the player
 * actually aimed at.
 */
function wireDismiss(scene) {
  if (scene._choiceWired) return;
  scene._choiceWired = true;
  const onDown = (p, hits) => {
    const box = scene._choiceBox;
    if (!box || !box.active || isRightPointer(p)) return;
    // A box opens on the RELEASE of the gesture that asked for it, so the next
    // press is always a genuinely new one. The guard is belt and braces for any
    // future call site that opens on a press.
    if (scene.time.now - box.armedAt < 60) return;
    if (hits && hits.some(o => box.parts.has(o))) return;
    closeChoiceBox(scene);
  };
  scene.input.on('pointerdown', onDown);
  scene.events.once('shutdown', () => {
    scene.input.off('pointerdown', onDown);
    scene._choiceWired = false;
    closeChoiceBox(scene);
  });
}

/**
 * THE OTHER TWO-TAP TRIGGERS ON SCREEN, as rectangles.
 *
 * Needed because of rule 3, and it is the rule that makes the model worth
 * having: tapping a different option must swap the box in ONE tap. If the open
 * box is standing on top of the option you are reaching for, that press lands
 * on the box instead, nothing swaps, and browsing silently costs two taps per
 * option. (Found by the verification driver on the Smith's three-across shelf,
 * where the box was tall enough to be pushed off to the side and landed square
 * on the middle card.)
 *
 * `twoTap` tags every trigger with `hfTwoTap`, so the box can find its own
 * siblings without a single call site having to describe its shelf.
 */
function siblingRects(scene, selfKey, source) {
  // ONLY THE TRIGGER'S OWN LAYER. Walking the whole scene finds triggers on the
  // board BEHIND a full-screen overlay — the map's node icons are still live
  // objects under the Oracle's dimmer — and the placer then contorts itself to
  // miss a node the player cannot even see. The trigger's top-level ancestor is
  // the right boundary in every case that exists: an overlay's options share
  // its container, the map's nodes share the map layer, and the artifact belt
  // shares its panel.
  const top = new Set(scene.children.list);
  let root = source ?? null;
  while (root && !top.has(root)) root = root.parentContainer;

  const out = [];
  const walk = (o) => {
    if (!o) return;
    const tag = o.getData?.('hfTwoTap');
    if (tag && tag !== selfKey && o.visible !== false && o.input?.enabled) {
      const b = o.getBounds();
      if (b.width > 0 && b.height > 0) {
        out.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom });
      }
    }
    (o.list ?? []).forEach(walk);
  };
  if (root) walk(root); else scene.children.list.forEach(walk);
  return out;
}

/** How much of `a` and `b` overlap, in px². 0 when they are disjoint. */
function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the box goes. BESIDE the thing it describes, never under the finger,
 * and — since 2026-08-10 — never on top of a sibling option.
 *
 * Six candidate homes are generated in preference order (below the thing, above
 * it, either side of it, then the top and bottom of the canvas as a tray) and
 * scored by how much sibling they would cover. The first with a clean score
 * wins; if every home covers something, the least-bad one does, which is the
 * honest answer on a screen with no room left.
 */
function place(scene, anchor, w, h, selfKey, source) {
  const E = BOX.edge;
  const ax = anchor.x, ay = anchor.y;
  const aw = anchor.w ?? 0, ah = anchor.h ?? 0;
  const clampX = (x) => Math.max(w / 2 + E, Math.min(x, GAME_W - w / 2 - E));
  const clampY = (y) => Math.max(h / 2 + E, Math.min(y, GAME_H - h / 2 - E));
  const fitsY = (cy) => cy - h / 2 >= E && cy + h / 2 <= GAME_H - E;

  // FOUR HEIGHTS x THREE COLUMNS, in preference order. The columns matter as
  // much as the heights on a crowded screen: the merchant's mat has a relic row
  // over a bottle row, and a box hung straight under a relic lands on a bottle
  // no matter how short it is — but the same box slid to the wall clears both.
  const cands = [];
  const push = (x, y, strict = true) => {
    if (strict && !fitsY(y)) return;
    cands.push({ x: clampX(x), y: clampY(y) });
  };
  const cols = [ax, w / 2 + E, GAME_W - w / 2 - E];   // under it, hard left, hard right
  const rows = [
    ay + ah / 2 + BOX.gap + h / 2,                    // below it
    ay - ah / 2 - BOX.gap - h / 2,                    // above it
    GAME_H - E - h / 2,                               // a tray at the foot
    E + h / 2,                                        // ...or at the head
  ];
  for (const y of rows) for (const x of cols) push(x, y);
  push(ax + aw / 2 + BOX.gap + w / 2, ay);            // to its right
  push(ax - aw / 2 - BOX.gap - w / 2, ay);            // to its left
  push(ax, ay, false);                                // last resort: on it

  // Siblings are INFLATED by the same gap the box keeps from its own anchor, so
  // a home that merely kisses the next option is not counted as clean. A tap
  // aimed at a card's edge has to land on the card, not on the box's shadow.
  const sibs = siblingRects(scene, selfKey, source).map(s => ({
    left: s.left - BOX.gap, right: s.right + BOX.gap,
    top: s.top - BOX.gap, bottom: s.bottom + BOX.gap,
  }));
  let best = cands[0], bestScore = Infinity;
  for (const c of cands) {
    const box = { left: c.x - w / 2, right: c.x + w / 2, top: c.y - h / 2, bottom: c.y + h / 2 };
    const score = sibs.reduce((a, s) => a + overlapArea(box, s), 0);
    if (score < bestScore) { bestScore = score; best = c; }
    if (score === 0) break;                            // preference order wins ties
  }
  best.covered = bestScore;
  return best;
}

/**
 * Open the description box.
 *
 * @param {Phaser.Scene} scene
 * @param {object} spec
 *   key      identity. Reopening the same key rebuilds it (a price changed, a
 *            belt filled); a different key replaces it. Used by the driver.
 *   anchor   {x, y, w, h} of the thing being described (or a function of one).
 *   title    the thing's name.
 *   body     its rules text. Newlines are honoured.
 *   note     a dimmer line under the body — a price, a warning, a slot count.
 *   accent   the panel's edge colour (a rarity colour, usually).
 *   depth    draw depth. Defaults just above the overlay floor; a picker that
 *            lives at OV_DEPTH must pass its own + a few.
 *   buttons  [{ label, kind, onClick, enabled, hint }]. `kind` indexes BTN_ART.
 *            A disabled button still DRAWS — "you can't pay for this" is
 *            information, and a missing button is not.
 *   owner    a container whose destruction takes the box with it (the overlay
 *            the option lives on). Optional but strongly advised.
 *   onClose  called when the box goes away, however it goes away.
 */
export function openChoiceBox(scene, spec) {
  closeChoiceBox(scene);
  wireDismiss(scene);

  const anchor = val(spec.anchor) ?? { x: GAME_W / 2, y: GAME_H / 2, w: 0, h: 0 };
  const buttons = (val(spec.buttons) ?? []).filter(Boolean);
  const accent = val(spec.accent);
  const depth = spec.depth ?? DEPTH.overlay + 8;

  const ov = scene.add.container(0, 0).setDepth(depth);
  ov.boxKey = spec.key ?? null;
  ov.token = `${spec.key ?? 'box'}#${Math.random().toString(36).slice(2, 8)}`;
  ov.parts = new Set();
  ov.onClose = spec.onClose ?? null;

  // ---- the ink, measured before anything is placed -------------------------
  const titleText = String(val(spec.title) ?? '');

  /**
   * THE BODY, RE-WRAPPED UNTIL IT FITS THE ROOM IT HAS.
   *
   * A tall box is a box with nowhere to stand: on the pack shelf there are 296
   * free pixels above the option cards and 236 below them, and a four-line rule
   * at a 460px wrap overruns both — so the placer was pushed to the sides and
   * landed square on the neighbouring card, which is the one thing rule 3 will
   * not tolerate. Widening the wrap trades height for width, and width is the
   * axis this canvas has to spare. Height is bought first and the box only gets
   * wide when the text actually needs it.
   */
  const bodyStr = String(val(spec.body) ?? '').trim();
  const roomAbove = (anchor.y - (anchor.h ?? 0) / 2) - BOX.gap - BOX.edge * 2;
  const roomBelow = GAME_H - (anchor.y + (anchor.h ?? 0) / 2) - BOX.gap - BOX.edge * 2;
  const heightBudget = Math.max(roomAbove, roomBelow, 280);
  const wrapMax = BOX.maxW - BOX.padX * 2;
  // ~the fixed furniture around the body: title, note, buttons, padding.
  const overhead = BOX.padTop + BOX.padBottom + 90 + BOX.titleGap + BOX.bodyGap + BOX.btnH;
  let wrap = BOX.wrap;
  let bodySize = BOX.bodySize;
  let body = null;
  if (bodyStr) {
    // Width first, then — for the handful of rules long enough to overrun even
    // the widest box (FOOLISH NATURE runs to four lines) — two steps of type
    // size. In that order because a wider measure costs nothing and a smaller
    // one costs legibility, and because the alternative is a box shoved onto
    // the option beside it, which costs the whole browse interaction.
    const sizes = TOUCH ? [BOX.bodySize, BOX.bodySize - 2, BOX.bodySize - 4] : [BOX.bodySize];
    let done = false;
    for (const size of sizes) {
      wrap = BOX.wrap;
      bodySize = size;
      for (;;) {
        body?.destroy();
        body = scene.add.text(0, 0, bodyStr, {
          fontFamily: '"Baloo 2"', resolution: 2, fontSize: `${size}px`,
          color: PARCH.textDim, fontStyle: 'bold',
          wordWrap: { width: wrap }, align: 'center', lineSpacing: 3,
        }).setOrigin(0.5, 0);
        if (body.height + overhead <= heightBudget) { done = true; break; }
        if (wrap >= wrapMax) break;
        wrap = Math.min(wrapMax, wrap + 120);
      }
      if (done) break;
    }
  }

  // Title and note follow whatever wrap the body settled on, so the three
  // blocks share one measure and the box reads as one column of type.
  const title = scene.add.text(0, 0, titleText, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${BOX.titleSize}px`,
    color: PARCH.text, wordWrap: { width: wrap }, align: 'center',
  }).setOrigin(0.5, 0);

  const noteStr = String(val(spec.note) ?? '').trim();
  const note = noteStr ? scene.add.text(0, 0, noteStr, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: `${BOX.noteSize}px`,
    color: '#8a5a00', wordWrap: { width: wrap }, align: 'center',
  }).setOrigin(0.5, 0) : null;

  // ---- the buttons, measured the same way ---------------------------------
  const plates = buttons.map((b) => {
    const art = BTN_ART[b.enabled === false ? 'dead' : (b.kind ?? 'go')] ?? BTN_ART.go;
    const txt = scene.add.text(0, 0, String(b.label ?? '').toUpperCase(), {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${BOX.btnFont}px`,
      color: art.color,
    }).setOrigin(0.5);
    return { spec: b, art, txt, w: Math.max(BOX.btnMinW, Math.round(txt.width) + 46) };
  });

  // One row if it fits inside the widest box we allow; otherwise a stack.
  const rowW = plates.reduce((a, p) => a + p.w, 0) + BOX.btnGap * Math.max(plates.length - 1, 0);
  const stacked = plates.length > 1 && rowW + BOX.padX * 2 > BOX.maxW;
  const btnBlockW = stacked ? Math.max(...plates.map(p => p.w)) : rowW;
  const btnBlockH = plates.length
    ? (stacked ? plates.length * BOX.btnH + (plates.length - 1) * 10 : BOX.btnH)
    : 0;

  const inkW = Math.max(title.width, body?.width ?? 0, note?.width ?? 0, btnBlockW);
  const w = Math.round(Math.max(BOX.minW, Math.min(BOX.maxW, inkW + BOX.padX * 2)));
  const h = Math.round(
    BOX.padTop + title.height
    + (body ? BOX.titleGap + body.height : 0)
    + (note ? 10 + note.height : 0)
    + (btnBlockH ? BOX.bodyGap + btnBlockH : 0)
    + BOX.padBottom,
  );

  const pos = place(scene, anchor, w, h, spec.key ?? null, spec.source ?? null);
  ov.setPosition(pos.x, pos.y);

  const parts = woodPanel(scene, 0, 0, w, h, { accent, shadow: true });
  ov.add([parts.shadow, parts.panel, parts.line].filter(Boolean));
  // THE EATER GOES IN FIRST, so every button added after it sits on top of it
  // in the container's own hit-test order. It is what makes a press on the
  // parchment dismiss the box and nothing else.
  const eater = swallowGestures(scene, ov, 0, 0, w, h);
  ov.parts.add(eater);
  ov.parts.add(parts.panel);

  let y = -h / 2 + BOX.padTop;
  title.setPosition(0, y); y += title.height;
  if (body) { y += BOX.titleGap; body.setPosition(0, y); y += body.height; }
  if (note) { y += 10; note.setPosition(0, y); y += note.height; }
  ov.add([title, ...(body ? [body] : []), ...(note ? [note] : [])]);

  const btnTop = h / 2 - BOX.padBottom - btnBlockH;
  let bx = -btnBlockW / 2;
  plates.forEach((p, i) => {
    const enabled = p.spec.enabled !== false;
    const cx = stacked ? 0 : bx + p.w / 2;
    const cy = stacked
      ? btnTop + BOX.btnH / 2 + i * (BOX.btnH + 10)
      : btnTop + BOX.btnH / 2;
    const img = scene.add.image(cx, cy, p.art.key)
      .setDisplaySize(stacked ? btnBlockW : p.w, BOX.btnH)
      .setInteractive({ useHandCursor: enabled });
    p.txt.setPosition(cx, cy - 3);
    ov.add([img, p.txt]);
    ov.parts.add(img);
    p.img = img;
    p.enabled = enabled;
    if (enabled) {
      // COMMIT ON RELEASE, not on press. This is the same lesson four separate
      // call sites in this codebase have already paid for (see ui/pointer.js):
      // a button that acts on pointerdown and then destroys itself hands the
      // rest of its own gesture to whatever it was covering.
      tapBind(scene, img, () => {
        if (scene._choiceBox !== ov) return;      // already gone
        sfx(scene, 'button', { volume: 0.8 });
        closeChoiceBox(scene);
        p.spec.onClick?.();
      });
    } else {
      img.setAlpha(0.75);
      tapBind(scene, img, () => {
        sfx(scene, 'card_deselect', { volume: 0.42 });
        scene.tweens.add({ targets: [img, p.txt], x: `+=8`, duration: 50, yoyo: true, repeat: 2 });
      });
    }
    bx += p.w + BOX.btnGap;
  });

  ov.armedAt = scene.time.now;
  ov.setAlpha(0);
  scene.tweens.add({ targets: ov, alpha: 1, duration: 110 });
  scene._choiceBox = ov;
  // ONE DESCRIPTION PANEL AT A TIME, EVER (see ui/infoPanels.js). Announcing
  // this box closes the card inspect panel and any surviving desktop tooltip,
  // so the surfaces that grew independent handles over six months can no
  // longer be woken two at a time by one gesture.
  ov.panelToken = notePanelOpen('choice', ov.boxKey, () => closeChoiceBox(scene));

  if (spec.owner?.once) spec.owner.once('destroy', () => closeChoiceBox(scene));
  ov.once('destroy', () => { if (scene._choiceBox === ov) scene._choiceBox = null; });

  // ---- the driver reads THIS, not the canvas ------------------------------
  const boxOf = () => ({
    left: pos.x - w / 2, right: pos.x + w / 2, top: pos.y - h / 2, bottom: pos.y + h / 2,
    x: pos.x, y: pos.y, w, h,
    // px² of sibling option this home covers. Zero on every shelf in the game;
    // the driver asserts it, because a box that covers the option you are
    // reaching for silently turns browsing back into two taps per card.
    covered: pos.covered ?? 0,
  });
  window.__hfBox = {
    open: true,
    token: ov.token,
    key: ov.boxKey,
    title: title.text,
    body: body?.text ?? '',
    note: note?.text ?? '',
    box: boxOf(),
    buttons: plates.map(p => ({
      label: p.txt.text,
      enabled: p.enabled,
      x: pos.x + p.img.x, y: pos.y + p.img.y,
      w: p.img.displayWidth, h: p.img.displayHeight,
    })),
    /** Press a button by label, through the SAME path a finger takes. */
    press(label) {
      const p = plates.find(q => q.txt.text === String(label).toUpperCase());
      if (!p || !p.enabled || scene._choiceBox !== ov) return false;
      closeChoiceBox(scene);
      p.spec.onClick?.();
      return true;
    },
    close: () => closeChoiceBox(scene),
  };
  return ov;
}

/**
 * Bind `obj` as a two-tap trigger. TOUCH BUILDS ONLY — a desktop call site
 * keeps its own `else obj.on('pointerdown', ...)` branch, deliberately, so the
 * one-click path stays visible where it is read.
 *
 * The spec is openChoiceBox's, plus:
 *   guard()   return false to refuse to open at all (a sold-out spot, a dead
 *             node). The refusal is the call site's to draw.
 *   onOpen()  fired after the box opens — a scale tween on the option, a sfx.
 */
export function twoTap(scene, obj, spec) {
  if (!TOUCH) throw new Error('twoTap is the touch build only: keep the desktop fork at the call site');
  obj.setData('hfTwoTap', spec.key ?? true);
  tapBind(scene, obj, () => {
    if (spec.guard && spec.guard() === false) return;
    sfx(scene, 'menu_select', { volume: 0.3, jitter: 0.06 });
    // `source` is what tells the placer which LAYER this shelf lives on, so it
    // avoids the options beside this one and ignores whatever is behind them.
    openChoiceBox(scene, { ...spec, source: obj });
    spec.onOpen?.();
  });
  return obj;
}

/**
 * ===========================================================================
 * TAP TO LEARN MORE (JC, 2026-08-11) — the replacement for hover
 * ===========================================================================
 * `twoTap` is for a surface with a DECISION behind it: read, then press the
 * labelled plate. `tapInfo` is for a surface with nothing behind it but the
 * answer — an enemy's intent, a debuff chip on your own row, the SHIELD rule,
 * a boss medallion's blurb, the oracle's promise. On desktop those were hover
 * tooltips and hover tooltips only; on touch they had NO path at all once the
 * hold-to-hover synthesis was removed, and "the player cannot find out what is
 * about to hit them" is not a mobile port.
 *
 * It is the same box, the same placer and the same dismiss as `twoTap`, minus
 * the commit plates — information asks for no confirmation. What it adds is
 * TOGGLE: tapping the thing that is already describing itself puts the panel
 * away, which is what a finger expects and what a mouse got for free by
 * leaving. That needs the `_choiceClosed` crumb because of the gesture's own
 * shape: the press lands off the box (the chip is not one of the box's parts),
 * so wireDismiss closes it on the way down and `tapBind` fires on the way UP —
 * which would re-open the very panel the tap was asking to put away.
 *
 * TOUCH BUILDS ONLY, like `twoTap` and for the same reason: the desktop fork is
 * `hoverInfo(obj, show, hide)` and it stays visible at the call site.
 */
export function tapInfo(scene, obj, spec) {
  if (!TOUCH) throw new Error('tapInfo is the touch build only: keep the hoverInfo fork at the call site');
  const key = spec.key ?? true;
  obj.setData('hfTwoTap', key);
  tapBind(scene, obj, () => {
    if (spec.guard && spec.guard() === false) return;
    // The press already closed this very panel: that gesture was the toggle's
    // OFF half and the release must not undo it. 400ms is generous — a tap is
    // ~80ms — and it is keyed, so tapping straight from one chip to the next
    // still swaps in one gesture.
    const just = scene._choiceClosed;
    if (just && just.key === key && (scene.time?.now ?? 0) - just.at < 400) return;
    sfx(scene, 'menu_select', { volume: 0.28, jitter: 0.06 });
    openChoiceBox(scene, { ...spec, buttons: [], source: obj });
    spec.onOpen?.();
  });
  return obj;
}

/**
 * The info box without a trigger — for a surface whose tap is already spoken
 * for (an enemy body that retargets, a hero plate that selects) and which
 * therefore hangs its description off a neighbour, and for the driver hooks
 * that open a panel by name. Buttons are dropped, deliberately: if a caller
 * wants a commit plate it wants `openChoiceBox`, and the difference between
 * the two is the whole point of the model.
 */
export function openInfoBox(scene, spec) {
  return openChoiceBox(scene, { ...spec, buttons: [] });
}
