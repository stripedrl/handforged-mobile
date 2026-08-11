/**
 * @file inspect.js
 * THE CARD INSPECT BOX (JC, 2026-08-10): "a small description panel near the
 * card. Standard format every card follows identically so cards are easy to
 * compare."
 *
 * A card in this game is up to four things at once — a rank and a suit, a MOD
 * that repaints it, a STAMP pressed on top and a WRAP laid over both — and on
 * top of that it can be frozen, sealed, burned, marked, face down or fading.
 * The fan shows all of that in paint, which is right for reading a hand at a
 * glance and useless for the question "is this King actually better than that
 * one". So: one panel, always the same five slots, in the same order.
 *
 *   1  K of SWORDS                    rank and suit, in the game's own words
 *   2  VALUE 10                       what it base-scores (and what a mod did to that)
 *   3  SWORDS — 2× damage             what the suit does FOR THIS HERO
 *   4  LAYERS                         every mod / stamp / wrap present, with numbers
 *   5  (state)                        FROZEN / SEALED / MARKED / ... when it applies
 *
 * EVERY NUMBER IS IMPORTED, NEVER TYPED. The value bonuses, the mult factors,
 * the seal's heal, the wrapper's ×1.5, the wheel's odds and the ghost's rent
 * all come out of core/scoring.js, and the suit line comes out of the hero's
 * own `suitNotes` in config.js — which is the table the character sheet
 * already prints, so the panel and the sheet cannot disagree.
 *
 * HOW IT OPENS. Long LEFT press (400ms, still — the same HOLD_MS/SLOP gesture
 * ui/touch.js gives the phone, so mobile gets this for free) or RIGHT-CLICK,
 * which under the ui/pointer.js policy can never do anything else. It closes
 * on the next press anywhere.
 */

import { CARD, PARCH, SUIT_GLYPH, SUIT_COLORS, CHARACTERS, GAME_W, GAME_H, DEPTH } from '../config.js';
import { rankLabel, cardValue } from '../core/deck.js';
import {
  cardMod, cardStamp, cardWrap, effectiveSuit,
  VALUE_BONUS_BY_MOD, MOD_MULT_FACTOR, MOD_CHIPS,
  STAMPS, WRAPS, SEAL_HEAL, STAMP_MULT, ECHO_TIMES,
  ROULETTE_ODDS, ROULETTE_GOLD_CHIPS, ROULETTE_RED_MULT, ROULETTE_GREEN_VALUE,
  ETHEREAL_VANISH_CHANCE, FADE_VANISH_CHANCE,
} from '../core/scoring.js';
import { run } from '../core/run.js';
import { woodPanel } from './panels.js';
import { HOLD_MS, SLOP } from './touch.js';
import { isRightPointer, onRightClick, swallowGestures } from './pointer.js';
import { notePanelOpen, notePanelClosed } from './infoPanels.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const odds = (result) => pct(ROULETTE_ODDS.find(o => o.result === result)?.p ?? 0);

/** The wheel, spelled out in one line so a ROULETTE card is readable at all. */
const ROULETTE_LINE =
  `spins once every time it scores: ${odds('gold')} +${ROULETTE_GOLD_CHIPS} chips, `
  + `${odds('red')} +${ROULETTE_RED_MULT} Mult, ${odds('black')} scores nothing, `
  + `${odds('green')} +${ROULETTE_GREEN_VALUE} VALUE`;

/**
 * WHAT EACH MOD DOES, in one line, with its own numbers.
 *
 * `wild` and `star` are the same card mechanically (only the paint differs), so
 * they say the same thing. `forged` and `spectral` have no minting path in the
 * shipped game — they are here because scoring still honours them and the dev
 * tools can make one, and a panel that went blank on a card the game can hold
 * is worse than a line nobody reads.
 */
const MOD_LINES = {
  enhanced: `+${VALUE_BONUS_BY_MOD.enhanced} VALUE`,
  forged: `+${VALUE_BONUS_BY_MOD.forged} VALUE, and +${MOD_CHIPS} chips every time it scores`,
  gilded: `+${MOD_CHIPS} chips every time it scores`,
  wild: 'counts as EVERY suit for the hand',
  star: 'counts as EVERY suit for the hand',
  joker: `counts as EVERY suit, +${VALUE_BONUS_BY_MOD.joker} VALUE, and ×${MOD_MULT_FACTOR.joker} Mult every time it scores`,
  spectral: `×${MOD_MULT_FACTOR.spectral} Mult every time it scores`,
  nuke: `+${VALUE_BONUS_BY_MOD.nuke} VALUE`,
  roulette: ROULETTE_LINE,
  ethereal: `×${MOD_MULT_FACTOR.ethereal} Mult every time it scores, and ${pct(ETHEREAL_VANISH_CHANCE)} to vanish from the deck for good each time`,
};

const MOD_LABELS = {
  enhanced: 'ENHANCED', forged: 'FORGED', gilded: 'GILDED', wild: 'WILD', star: 'STAR',
  joker: 'JOKER', spectral: 'SPECTRAL', nuke: 'THE NUKE', roulette: 'ROULETTE', ethereal: 'ETHEREAL',
};

const STAMP_LINES = {
  blood: `+${SEAL_HEAL} HP every time it scores`,
  mult: `+${STAMP_MULT} Mult every time it scores`,
  echo: `everything this card does counts ${ECHO_TIMES}×`,
};

const WRAP_LINES = {
  shiny: `×${WRAPS.shiny.factor} Mult every time it scores`,
};

/**
 * THE FIVE STATES A CARD CAN BE IN, and what each one actually costs.
 *
 * Read off the CardSprite rather than the card object: none of these live on
 * the card (see core/deck.js — a card is `{id, suit, rank, mod?, stamp?,
 * wrap?}` and nothing else). The sprite is where the fight writes them.
 */
function cardStates(sprite, { burned = false } = {}) {
  const out = [];
  if (!sprite) return out;
  if (sprite.lockState === 'frozen') {
    out.push({ key: 'FROZEN', text: 'cannot be played. It thaws when the enemy turn begins.' });
  }
  if (sprite.lockState === 'banned') {
    out.push(burned || sprite.burnedLook
      ? { key: 'BURNED', text: 'spent for the rest of the fight. It can be discarded, not played.' }
      : { key: 'SEALED', text: 'it can be discarded, not played.' });
  }
  if (sprite.hypno) out.push({ key: 'HYPNOTIZED', text: 'held in your selection until the gaze lets go.' });
  if (sprite.marked) {
    out.push({ key: 'MARKED', text: 'Grimwatch named it. Play it and your whole hand deals NOTHING.' });
  }
  if (sprite.blinded) out.push({ key: 'FACE DOWN', text: 'you cannot read it. It still plays normally.' });
  if (sprite.faded) {
    out.push({ key: 'FADING', text: `no bonus of any kind, and ${pct(FADE_VANISH_CHANCE)} to vanish for good every time it scores.` });
  }
  return out;
}

/**
 * The whole panel as DATA — title, the five slots, no Phaser. Every driver and
 * every unit test reads this rather than scraping text objects off the canvas,
 * and the renderer below is the only thing that turns it into paint.
 *
 * @param {{suit:string, rank:number, mod?:string, stamp?:string, wrap?:string}} card
 * @param {{heroId?:string, sprite?:object, burned?:boolean}} opts
 */
export function cardInspectReport(card, { heroId = null, sprite = null, burned = false } = {}) {
  const hero = CHARACTERS[heroId ?? run.chrId] ?? null;
  const mod = cardMod(card);
  const stamp = cardStamp(card);
  const wrap = cardWrap(card);

  const base = cardValue(card.rank);
  const bonus = VALUE_BONUS_BY_MOD[card.mod] ?? 0;
  const value = base + bonus;

  // WHICH SUIT THE CARD ACTUALLY SCORES AS. A wild/star/joker counts as every
  // suit for the HAND but pays out on the hero's own suit, so the line names
  // both rather than pretending the printed pip is the whole story.
  const scoringSuit = hero ? effectiveSuit(card, hero.id) : card.suit;
  const note = hero?.suitNotes?.find(n => n.suit === scoringSuit)?.text ?? null;
  const suitName = SUIT_GLYPH[scoringSuit] ?? scoringSuit;

  const layers = [];
  if (mod) layers.push({ layer: 'MOD', name: MOD_LABELS[mod] ?? mod.toUpperCase(), text: MOD_LINES[mod] ?? '' });
  if (stamp) layers.push({ layer: 'STAMP', name: STAMPS[stamp]?.label ?? stamp.toUpperCase(), text: STAMP_LINES[stamp] ?? '' });
  if (wrap) layers.push({ layer: 'WRAP', name: WRAPS[wrap]?.label ?? wrap.toUpperCase(), text: WRAP_LINES[wrap] ?? '' });

  return {
    title: `${rankLabel(card.rank)} of ${SUIT_GLYPH[card.suit] ?? card.suit}`,
    valueLine: bonus
      ? `VALUE ${value}   (${base} base +${bonus} ${MOD_LABELS[card.mod] ?? card.mod})`
      : `VALUE ${value}`,
    suitLine: note
      ? (scoringSuit === card.suit ? `${suitName}  ·  ${note}` : `scores as ${suitName}  ·  ${note}`)
      : `${suitName}`,
    layers,
    states: cardStates(sprite, { burned }),
    // Raw fields, for the tests and the drivers.
    value, base, bonus, mod, stamp, wrap, scoringSuit,
  };
}

/** The report's body, as the lines the panel prints, in order. */
export function cardInspectLines(card, opts) {
  const r = cardInspectReport(card, opts);
  const lines = [r.valueLine, r.suitLine];
  lines.push(r.layers.length
    ? r.layers.map(l => `${l.layer} ${l.name}  ·  ${l.text}`).join('\n')
    : 'no mod, no stamp, no wrap');
  for (const s of r.states) lines.push(`${s.key}  ·  ${s.text}`);
  return { title: r.title, lines, report: r };
}

/** Tear down whatever inspect panel is open on this scene. */
export function hideCardInspect(scene) {
  if (scene._inspectPanel) {
    notePanelClosed(scene._inspectPanel.panelToken);
    scene._inspectPanel.destroy(true);
    scene._inspectPanel = null;
  }
}

/**
 * Draw the panel, anchored above `anchor` ({x, y, h}) and clamped on screen.
 * Replaces any panel already open. `depth` lets a picker put it over its own
 * cards; the fan's default sits just above the overlay floor.
 */
export function showCardInspect(scene, card, anchor, { depth = null, heroId = null, sprite = null, burned = false } = {}) {
  hideCardInspect(scene);
  const { title, lines, report } = cardInspectLines(card, { heroId, sprite, burned });

  const ov = scene.add.container(0, 0).setDepth(depth ?? DEPTH.overlay + 4);
  const WRAP_W = 340;
  const t = scene.add.text(0, 0, title, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.text,
    wordWrap: { width: WRAP_W }, align: 'center',
  }).setOrigin(0.5, 0);

  const texts = [t];
  let y = t.height + 10;
  lines.forEach((line, i) => {
    // The first two lines are the card's own arithmetic and read as headline
    // ink; everything under them is a rule, in the dimmer body colour.
    const b = scene.add.text(0, y, line, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: i < 2 ? '20px' : '18px',
      color: i < 2 ? PARCH.text : PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: WRAP_W }, align: 'center', lineSpacing: 3,
    }).setOrigin(0.5, 0);
    texts.push(b);
    y += b.height + (i === 1 ? 12 : 7);
  });

  const h = y + 26;
  const w = Math.max(...texts.map(o => o.width)) + 52;
  const parts = woodPanel(scene, 0, h / 2 - 17, w, h, { accent: SUIT_COLORS[card.suit], shadow: true });
  ov.add([parts.shadow, parts.panel, parts.line, ...texts]);
  // The panel is drawn OVER the fan, so it has to eat the gestures it covers:
  // a press on the box must dismiss the box and nothing else. Without this the
  // click that closes it also picks the card underneath, which is the exact
  // pass-through ui/pointer.js exists to end.
  swallowGestures(scene, ov, 0, h / 2 - 17, w, h);

  // Above the card by preference; under it when the card is high on the screen.
  const ah = anchor.h ?? CARD.h;
  const above = anchor.y - ah / 2 - 14 - h;
  const yTop = above > 12 ? above : Math.min(anchor.y + ah / 2 + 14, GAME_H - h - 12);
  ov.setPosition(
    Phaser.Math.Clamp(anchor.x, w / 2 + 10, GAME_W - w / 2 - 10),
    Phaser.Math.Clamp(yTop, 12, GAME_H - h - 12),
  );

  ov.armedAt = scene.time.now;
  ov.report = report;
  scene._inspectPanel = ov;
  // ONE DESCRIPTION PANEL AT A TIME (ui/infoPanels.js). Holding a card while a
  // relic's choice box is open used to leave both up, one over the other.
  ov.panelToken = notePanelOpen('inspect', report.title, () => hideCardInspect(scene));
  // The verification driver reads THIS rather than the canvas.
  window.__hfInspect = { open: true, title, lines, report };
  ov.once('destroy', () => {
    if (window.__hfInspect?.report === report) window.__hfInspect = { open: false };
  });
  return ov;
}

/**
 * Wire a scene up for card inspection.
 *
 * `resolve(gameObject)` answers "is this thing an inspectable card, and with
 * what context?" — return `{ card, sprite, burned, depth }` or null. One hook
 * serves the combat fan, the deck picker and the deck viewer, which is why the
 * gesture is identical in all three.
 *
 * Owns three scene-level bindings and takes all of them down on shutdown:
 *   · a hold timer armed on gameobjectdown  (long LEFT press)
 *   · the suppressed right-press from ui/pointer.js
 *   · a dismiss on the next ordinary press
 *
 * `scene._inspectHeld` is raised when a hold actually fires. The fan's
 * `gameobjectup` selection handler reads it and stands down, so holding a card
 * to read it never also picks it.
 */
export function installCardInspect(scene, resolve) {
  let timer = null;
  let start = null;

  const cancel = () => { if (timer) { timer.remove(); timer = null; } start = null; };

  const open = (hit, pointer) => {
    const ctx = resolve(hit);
    if (!ctx?.card) return false;
    const src = ctx.sprite ?? hit;
    const m = src.getWorldTransformMatrix?.();
    showCardInspect(scene, ctx.card, {
      x: m ? m.tx : (src.x ?? pointer.x),
      y: m ? m.ty : (src.y ?? pointer.y),
      h: src.displayHeight || CARD.h,
    }, { depth: ctx.depth ?? null, sprite: ctx.sprite ?? null, burned: !!ctx.burned });
    return true;
  };

  const onDown = (pointer, obj) => {
    if (isRightPointer(pointer)) return;          // the patch blocks it anyway
    if (!resolve(obj)) return;
    cancel();
    start = { x: pointer.x, y: pointer.y };
    timer = scene.time.delayedCall(HOLD_MS, () => {
      timer = null;
      const cur = scene.input.activePointer;
      if (!start || Math.hypot(cur.x - start.x, cur.y - start.y) > SLOP) return;
      if (open(obj, cur)) scene._inspectHeld = true;
    });
  };
  const onMove = (p) => { if (start && Math.hypot(p.x - start.x, p.y - start.y) > SLOP) cancel(); };
  const onUp = () => cancel();
  // The next ORDINARY press closes it. A right press cannot get here (it is
  // suppressed), which is what lets right-clicking straight from one card to
  // the next swap the panel instead of closing it.
  const onDismiss = () => {
    const p = scene._inspectPanel;
    if (p && scene.time.now - p.armedAt > 30) hideCardInspect(scene);
  };

  scene.input.on('gameobjectdown', onDown);
  scene.input.on('pointermove', onMove);
  scene.input.on('pointerup', onUp);
  scene.input.on('pointerupoutside', onUp);
  scene.input.on('pointerdown', onDismiss);
  onRightClick(scene, (pointer, hits) => {
    for (const hit of hits) if (open(hit, pointer)) return;
    hideCardInspect(scene);
  });
  scene.events.once('shutdown', () => {
    cancel();
    scene.input.off('gameobjectdown', onDown);
    scene.input.off('pointermove', onMove);
    scene.input.off('pointerup', onUp);
    scene.input.off('pointerupoutside', onUp);
    scene.input.off('pointerdown', onDismiss);
    hideCardInspect(scene);
  });
}
