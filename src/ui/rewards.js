/**
 * Shared reward & picker overlays — used by CombatScene (post-fight rewards,
 * elite drops) and MapScene (events, shops, the Crimson Forge).
 *
 * Everything renders in the parchment/wood cartoon language and sits at
 * DEPTH.overlay+5 so it floats over either scene.
 */

import { GAME_W, GAME_H, DEPTH, PARCH, COLORS, SUIT_COLORS, SUIT_PIP_KEY, SUIT_GLYPH, CARD, TOUCH } from '../config.js';
import { woodPanel } from './panels.js';
// THE TWO-TAP MODEL (ui/choicebox.js, JC 2026-08-10). Every shelf in this file
// whose information is hidden behind an icon or a painted card now opens a
// persistent description box on the FIRST tap and commits only from a labelled
// button inside it. `twoTap` throws on desktop by design, so every call site
// below keeps its own `else obj.on('pointerdown', commit)` branch and the two
// paths run the SAME named closure — they cannot drift.
import { twoTap } from './choicebox.js';
import { sfx, suspense } from '../core/sfx.js';
import { popMessage, rainbowText, legible, glitchText } from './juice.js';
import { CardSprite } from './CardSprite.js';
import { ARTIFACT_RARITY, acquireArtifact, getProp, artifactLiveLine } from '../core/artifacts.js';
import { openPack, PACK_TYPES, rollBountyRewards, bountyRewardsById, optionArtSlug, rollCuratorRelics, CURATOR_RELICS, previewLabel } from '../core/packs.js';
import { rollOracleOffer, ORACLE_OFFER_SIZE } from '../core/oracle.js';
import { FORGED_FLOOR_LABEL } from '../core/elites.js';
import { HAND_DEFS, HAND_TYPES, handStats } from '../core/poker.js';
import { SUITS, sortCards, rankLabel } from '../core/deck.js';
import { isHandDiscovered } from '../core/progress.js';
import { collectMods, chr, effectiveArtifacts, slotsUsed, mirrorBlockedBy, mirrorNote, beltArtifacts, gainGold, run } from '../core/run.js';
// ELITE SPOILS are a MIXED shelf now (PATCH 0803 §2): relics and bottles stand
// on the same pedestals, so the overlay layer speaks both languages.
import { POTION_RARITY, MAX_POTIONS, potionUsableIn } from '../core/potions.js';
import { addPotionIcon } from './potionIcon.js';
// DEFERRED ART (core/lazyload.js): the eight pack wrappers and the seventy-two
// painted option cards. 126 MB between them, of which one shelf is ever on
// screen — see packCovers/packCards for how the two halves are split.
import { ensure, missingKeys, packCovers, packCards } from '../core/lazyload.js';
import { gateOn } from './loadingVeil.js';
// THE ROAD AHEAD, read-only, from any overlay. mapPeek imports config + core
// only, so this edge never closes a cycle back through MapScene.
import { viewMapButton, hasMapToPeek } from './mapPeek.js';

const OV_DEPTH = DEPTH.overlay + 5;

/**
 * THE ONE COPY FORK. A build with no mouse must never be told to hover, and a
 * build with no finger must never be told to tap — but the two strings belong
 * side by side in the source, where a reviewer can see both at once, rather
 * than in two files that drift.
 *
 * The DESKTOP string is always the first argument and is returned unchanged, so
 * `say(...)` can be dropped in front of any existing line without touching it.
 */
const say = (mouse, touch) => (TOUCH ? touch : mouse);

/**
 * THE ANCHOR A CHOICE BOX HANGS OFF: the hit object's OWN world rectangle,
 * measured at open time rather than reconstructed from the layout constants.
 *
 * Every shelf in this file draws its hit rect inside a container that is
 * positioned, scaled and tweened, and three of the pack-option render styles
 * use three different rect sizes at two different offsets. Reading getBounds()
 * means the box sits beside whatever is ACTUALLY on screen — including a cell
 * still holding its 1.08 hover scale — and no call site has to keep a second
 * copy of its own geometry in sync. Returned as a thunk because choicebox
 * evaluates `anchor` at open time, which is the only moment the answer is true.
 */
function hitAnchor(obj) {
  return () => {
    const b = obj.getBounds();
    return { x: b.centerX, y: b.centerY, w: b.width, h: b.height };
  };
}

/**
 * THE SHELF, AS COORDINATES (2026-08-10, for the two-tap verification driver).
 *
 * The mistake-first sections of tools/verify_mobile.py have to tap options the
 * way a thumb does — at a real screen point, through the real hit rect — and
 * then assert that NOTHING happened except a box opening. Reconstructing
 * `xs[i]` in Python would be a second copy of this file's layout arithmetic and
 * would drift the first time a gap changed, so the shelf publishes its own hit
 * rectangles instead. Reading only: there is no `choose` on this hook, because
 * a driver that could commit without touching the screen would prove nothing.
 */
function publishShelf(scene, ov, kind, entries) {
  const hook = {
    kind,
    open: true,
    // A FUNCTION, not a snapshot. Every shelf in this file tweens in from
    // scale 0 with a per-option delay and then holds a 1.08 hover scale, so a
    // rectangle measured at build time is a rectangle that was never on screen.
    options: () => entries.map((e, i) => {
      const b = e.obj.getBounds();
      return {
        i, id: e.id ?? null, label: e.label ?? null,
        x: b.centerX, y: b.centerY, w: b.width, h: b.height,
      };
    }),
  };
  window.__hfShelf = hook;
  ov.once('destroy', () => {
    if (window.__hfShelf === hook) window.__hfShelf = { open: false, kind, options: [] };
  });
  return hook;
}

/**
 * Display size of a painted option card. The whole packcard family was
 * re-normalized (2026-07-31) to a single 520x768 clean-alpha rounded card, so
 * there is nothing left to measure: every option draws at exactly one size and
 * three of them sit on one shelf perfectly matched. 460 tall leaves the title
 * (baked into the art) clear of both the 'Take ONE' line above and the
 * TAKE NOTHING button below.
 */
const CARD_OPTION_H = 460;
const CARD_OPTION_W = Math.round(CARD_OPTION_H * (520 / 768));   // 311

/**
 * A text bubble sized to what it SAYS, not to a magic number. Pass the label
 * (and any hint that has to fit under it); you get the button's display width.
 * Every fixed-width plate in the overlay layer routes through this so a
 * four-letter choice never wears a 620px slab (JC, 2026-07-31).
 */
export function fitWidth(texts, { pad = 60, min = 260, max = 700 } = {}) {
  const list = Array.isArray(texts) ? texts : [texts];
  const widest = Math.max(0, ...list.filter(Boolean).map(t => (typeof t === 'number' ? t : t.width)));
  return Math.round(Phaser.Math.Clamp(widest + pad, min, max));
}

/**
 * "YOUR suit" is never abstract (JC): {SUIT} tokens in any description render
 * as the current hero's actual suit, e.g. "your suit (HEARTS)".
 */
export function personalize(text) {
  return (text ?? '').replace(/\{SUIT\}/g, SUIT_GLYPH[chr().suit]);
}

/**
 * THE BELT CHANGED (JC, 2026-08-01 — the mid-combat bug).
 *
 * Taking a relic off the elite shelf while the CombatScene is still live used
 * to leave the bottom-left artifact mat showing your OLD belt until the next
 * fight: nothing between the ceremony's done-callback and returnToMap ever
 * touched renderArtifactPanel, and its `_artifactSig` guard is only consulted
 * when something calls it. Every path that ACQUIRES, REPLACES or SELLS a relic
 * now says so through here, and each scene answers in its own language —
 * CombatScene re-renders the mat immediately, MapScene re-lays the belt.
 *
 * Deliberately a scene hook rather than an event bus: the two scenes have
 * completely different furniture, and a missing hook must be a no-op, not a
 * crash (overlays are also used by the tutorial and the dev harness).
 */
export function beltChanged(scene) {
  try { scene?.onBeltChanged?.(); } catch (e) { console.error('onBeltChanged', e); }
}

/**
 * THE ONE ARTIFACT TOOLTIP BODY (JC, 2026-08-01). Every surface that describes
 * a relic — the combat mat, the map belt, the glove pouch, the merchant's owned
 * shelf, the replace-a-relic picker, the elite/curator pedestals — prints the
 * same three things in the same order:
 *
 *   1. the rules, personalized ({SUIT} -> your suit)
 *   2. THE RUNNING TOTAL, for anything that banks (def.liveDesc)
 *   3. THE MIRROR VERDICT, naming the neighbour either way:
 *        ✔ Compatible. Copying Echo Bell
 *        ⊘ Incompatible. Cannot copy Star Chart
 *
 * `own` false (a relic on a shelf you do not hold yet) skips the mirror line —
 * it has no neighbours until it is on your belt — but keeps the live total,
 * which for a fresh definition is simply absent.
 */
export function artifactTipBody(art, { own = true, live = true, mirror = true } = {}) {
  let out = personalize(art?.desc ?? '');
  const line = live ? artifactLiveLine(art, run) : null;
  if (line) out += `\n\n${line}`;
  if (mirror && own) {
    const mn = mirrorNote(art);
    if (mn) out += `\n${mn.text}`;
  }
  return out;
}

/**
 * An artifact's icon at a given size — Caleb's painted art when it exists
 * (art_<id>), else the old tinted UI glyph.
 */
export function addArtifactIcon(scene, x, y, art, size) {
  // `artKey` is the TRANSFORMER's override: the Potato keeps its id (ownership,
  // the shop's exclusion list and every old save all name it) but the Golden
  // Spud it becomes wears its own art.
  const key = art.artKey ?? ('art_' + art.id);
  let img;
  if (scene.textures.exists(key)) {
    img = scene.add.image(x, y, key);
  } else {
    img = scene.add.image(x, y, art.icon).setTint(art.tint ?? 0x6b4526);
  }
  img.setScale(size / Math.max(img.width, img.height));
  return img;
}

/**
 * The ⊘ stamp: a mirror relic (The Forgery / The Phantom Cast) sitting next to
 * something it cannot copy. Drawn rather than typed — U+2298 is missing from
 * half the display fonts we ship, and a tofu box is worse than no badge.
 * Returns a container; add it wherever the icon lives.
 */
export function noMirrorBadge(scene, x, y, r = 11) {
  const badge = scene.add.container(x, y);
  const disc = scene.add.circle(0, 0, r + 2, 0x1a0d10, 0.9);
  const ring = scene.add.circle(0, 0, r, 0x000000, 0).setStrokeStyle(3, 0xff5060);
  const bar = scene.add.rectangle(0, 0, r * 2.1, 3, 0xff5060).setAngle(-45);
  badge.add([disc, ring, bar]);
  return badge;
}

function dimmer(scene, alpha = 0.82) {
  const dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, alpha);
  dim.setInteractive();   // swallow clicks under the overlay
  return dim;
}

function bigTitle(scene, y, text, color = COLORS.gold) {
  return scene.add.text(GAME_W / 2, y, text, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '54px', color,
    stroke: '#241505', strokeThickness: 10,
  }).setOrigin(0.5);
}

/**
 * The overlay layer's standard plate. With no explicit `w` it sizes itself to
 * the label (fitWidth, min 240) and re-fits whenever the label changes — the
 * deck picker's CONFIRM / PICK n MORE swap is the reason `fit()` is public.
 */
function button(scene, ov, x, y, label, onClick, { key = 'btn_yellow', color = '#5b3a00', w = null, h = 70, min = 240 } = {}) {
  const img = scene.add.image(x, y, key).setInteractive({ useHandCursor: true });
  const txt = scene.add.text(x, y - 3, label, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color,
  }).setOrigin(0.5);
  img.fit = () => img.setDisplaySize(w ?? fitWidth(txt, { min }), h);
  img.fit();
  ov.add([img, txt]);
  img.label = txt;
  img.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.8 }); onClick(img, txt); });
  return img;
}

// ---------------------------------------------------------------------------
// Shadow idioms — the overlay layer speaks the same two dialects as the map
// ---------------------------------------------------------------------------

/**
 * A darker duplicate of `img`, offset down-right: art that FLOATS (the artifact
 * reveal, an event's sigil, the wheel's hub). Add it to the parent BEFORE the
 * art itself so it sits underneath.
 */
export function dropShadow(scene, img, { dx = 6, dy = 8, alpha = 0.4, tint = 0x120a06 } = {}) {
  return scene.add.image(img.x + dx, img.y + dy, img.texture.key)
    .setTint(tint).setAlpha(alpha).setScale(img.scaleX, img.scaleY);
}

/**
 * ASPECT-SAFE PACK WRAP (JC, 2026-08-01), and THE PADDING CONVENTION it assumes
 * (JC, 2026-08-02: "the curator is kinda small and off in comparison").
 *
 * Scale by the LONGEST side, never `setDisplaySize(box, box)`: that used to
 * stamp every wrap into a square and squashed the portrait Curator by 30%.
 *
 * But fitting by the longest side fits the CANVAS, and a canvas is mostly empty
 * air. That is where the second bug lived. pack_curator shipped as 720x1015 with
 * its painted wrap only 89% of that height (and hard against the top edge),
 * while the six square covers are 720x720 with theirs at 97%, centred. Same
 * rule, same box, and the Curator still came out 8% shorter than its shelf-mates
 * and sat 18px high. It read small because it WAS small.
 *
 * So the convention every cover follows, and any new one must:
 *   canvas 720x720 · painted wrap centred · wrap height ~700 (97% of canvas)
 * The wrap's own width then falls out of its own proportions, which is why the
 * Curator is legitimately the slimmest of the seven and exactly as tall as the
 * rest. fitWrap stays as the guard for art that arrives non-square anyway.
 */
export function fitWrap(img, box) {
  const w = img.width || box;
  const h = img.height || box;
  img.setScale(box / Math.max(w, h));
  return img;
}

/**
 * The parchment mini-panel: a floating tooltip sized to its own text, with its
 * BOTTOM edge at (x, yBottom) and clamped on screen. Same language as the map's
 * showTip(), available to any overlay that needs "what am I looking at?".
 */
export function miniTip(scene, x, yBottom, title, body, accent = 0x8a6a3c, rainbow = false, cards = null) {
  const tip = scene.add.container(0, 0).setDepth(OV_DEPTH + 8);
  const t = scene.add.text(0, 0, title, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.text,
    wordWrap: { width: 400 }, align: 'center',
  }).setOrigin(0.5, 0);
  if (rainbow) rainbowText(scene, t);
  const b = body ? scene.add.text(0, t.height + 8, body, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: PARCH.textDim, fontStyle: 'bold',
    wordWrap: { width: 400 }, align: 'center', lineSpacing: 3,
  }).setOrigin(0.5, 0) : null;

  // THE CARDS THIS THING TOUCHES (JC, 2026-08-02). Only a FIXED preview ever
  // gets here — the cards are already decided, so drawing them is a promise the
  // option can keep. Small on purpose: enough to read the rank and pip, not so
  // big the tip stops being a tip.
  const list = (cards ?? []).filter(Boolean);
  const MINI = 0.3;
  const cw = CARD.w * MINI + 10;
  const stripH = list.length ? CARD.h * MINI + 16 : 0;
  const stripW = list.length * cw;

  const h = t.height + 8 + (b ? b.height : 0) + stripH + 34;
  const w = Math.max(t.width, b ? b.width : 0, stripW) + 52;
  const parts = woodPanel(scene, 0, h / 2 - 17, w, h, { accent, shadow: true });
  tip.add([parts.shadow, parts.panel, parts.line, t]);
  if (b) tip.add(b);
  if (list.length) {
    const stripY = (b ? b.y + b.height : t.height) + 10 + (stripH - 16) / 2;
    list.forEach((card, i) => {
      const cs = new CardSprite(scene, (i - (list.length - 1) / 2) * cw, stripY, card);
      cs.setScale(MINI);
      cs.removeInteractive();
      tip.add(cs);
    });
  }
  tip.tipH = h;   // callers that re-anchor the tip (packOpenOverlay) need the height
  tip.setPosition(
    Phaser.Math.Clamp(x, w / 2 + 10, GAME_W - w / 2 - 10),
    Phaser.Math.Clamp(yBottom - h + 17, 18, GAME_H - h),
  );
  return tip;
}

/**
 * A soft squashed pool of darkness: art that RESTS on a mat (pack options, rest
 * cards, the merchant's goods). Reuses fx_glow — the established contact idiom.
 */
export function contactPool(scene, x, y, w, { tint = 0x2a1808, alpha = 0.34, h = null } = {}) {
  return scene.add.image(x, y, 'fx_glow')
    .setTint(tint).setAlpha(alpha).setDisplaySize(w, h ?? Math.round(w * 0.3));
}

/**
 * THE TYPE RIBBON (JC, 2026-08-10): "at mixed selection shelves players can't
 * tell which is an artifact and which is a potion."
 *
 * Rarity colouring was carrying the whole load and rarity is the one thing the
 * two share — a RARE relic and a RARE bottle are painted the same amber, sit on
 * the same pedestal and are lit by the same spotlight, and the only word that
 * separated them was a "POTION" suffix on the rarity caption below the name,
 * which is a long way from the icon your eye actually lands on.
 *
 * So the type is now a small wooden plaque nailed ABOVE the goods, where the
 * eye arrives first: dark wood, cream letters, and a keyline in the item's own
 * rarity colour so the ribbon carries BOTH facts at once instead of competing
 * with the one already there. Returns a container; the caller places it.
 */
export function typeRibbon(scene, x, y, kind, accent = 0x8a6a3c) {
  const wrap = scene.add.container(x, y);
  const label = kind === 'potion' ? 'POTION' : 'ARTIFACT';
  const txt = scene.add.text(0, -1, label, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '18px', color: '#f6e8c8',
  }).setOrigin(0.5);
  const w = txt.width + 30;
  const plate = scene.add.rectangle(0, 0, w, 30, PARCH.woodDark).setStrokeStyle(3, accent);
  const shadow = scene.add.rectangle(3, 4, w, 30, 0x000000, 0.35);
  wrap.add([shadow, plate, txt]);
  wrap.plateW = w;
  return wrap;
}

/**
 * "VIEW DECK" — the informed-decision escape hatch. Opens deckInfoOverlay ABOVE
 * the overlay it was launched from; closing it leaves the decision untouched.
 *
 * IT PLANTS THE "MAP" PLATE TOO (JC, 2026-08-10: "a MAP button available at all
 * times"). Every overlay in the game that already knew to offer the deck is
 * exactly the set that has to offer the road — so the pair is planted by ONE
 * function rather than by eighteen call sites, none of which had to change and
 * none of which can now forget. The map plate stands itself down when there is
 * no board to look at (the title screen's settings panel, a finished run).
 */
export function viewDeckButton(scene, ov, run, x = 150, y = GAME_H - 62) {
  const img = scene.add.image(x, y, 'btn_dark').setDisplaySize(170, 50).setInteractive({ useHandCursor: true });
  const txt = scene.add.text(x, y - 2, 'VIEW DECK', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: '#cfc8e8',
  }).setOrigin(0.5);
  ov.add([img, txt]);
  img.setData('hfLabel', 'VIEW DECK');
  img.on('pointerover', () => sfx(scene, 'menu_select', { volume: 0.25, jitter: 0.06 }));
  img.on('pointerdown', () => {
    sfx(scene, 'button', { volume: 0.7 });
    deckInfoOverlay(scene, run, { depth: (ov.depth ?? OV_DEPTH) + 6 });
  });
  if (hasMapToPeek()) viewMapButton(scene, ov, x + 182, y);
  return img;
}

// ---------------------------------------------------------------------------
// Deck picker — choose N cards from the run deck
// ---------------------------------------------------------------------------

export function deckPickerOverlay(scene, run, { count = 1, optional = false, title = 'Choose a card', sample = 10, cards = null }, cb) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 2);
  ov.add(dimmer(scene, 0.88));
  ov.add(bigTitle(scene, 96, title.toUpperCase()));
  const sampled = sample > 0 && (cards ?? run.runDeck).length > sample;
  const hint = (optional ? `Pick up to ${count}, or none` : `Pick ${count}`) +
    (sampled ? `  ·  fate offers only ${sample} of your cards` : '');
  ov.add(scene.add.text(GAME_W / 2, 150, hint, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: '#d8c9a8', fontStyle: 'bold',
  }).setOrigin(0.5));

  let pool = [...(cards ?? run.runDeck)];
  if (sampled) {
    pool.sort(() => Math.random() - 0.5);
    pool = pool.slice(0, sample);
  }
  // ONE ORDER, EVERY MENU (deck.compareCards): suit then rank ascending.
  const deck = sortCards(pool);

  /**
   * TWO PICTURES, AND WHICH ONE YOU GET IS DECIDED BY `sample` (JC, 2026-08-10).
   *
   * A picker that DEALS you ten of your cards is a hand — the randomness is the
   * point, and a fanned hand is the honest way to say so. A picker that opens
   * your WHOLE DECK (sample: 0 — CLEAN SWEEP's remove-2, WILD PAPERS, FORGED
   * PAPERS, the Summoner's Ink) is a filing cabinet, and the old continuous
   * 13-wide grid sheared the moment the deck stopped being a virgin 52: your
   * clubs started halfway along a row of diamonds and counting them was the
   * player's job. So the full-deck case is now the same picture the deck
   * VIEWER draws — four suit shelves under a thirteen-slot rank strip, per-suit
   * tallies at each shelf head — and it is drawn by the same helpers, so the
   * two panels cannot drift.
   *
   * Ranks run ASCENDING here, which is deck.compareCards' own order.
   */
  const organized = sample === 0;
  const big = !organized && deck.length <= 10;

  // The fanned-hand geometry (unchanged), and the shelf geometry beside it.
  const cols = big ? deck.length : 13;
  const gridScale = big ? 1.16 : deck.length / 13 <= 4 ? 0.56 : 0.44;
  const cw = big ? Math.min(172, 1560 / Math.max(deck.length, 1)) : CARD.w * gridScale + 12;
  const chh = CARD.h * gridScale + 14;
  const x0 = GAME_W / 2 - ((Math.min(cols, deck.length) - 1) / 2) * cw;
  const y0 = big ? 520 : 268;
  const ROW_Y0 = 330;

  // Where every card is going to sit, and at what size. Computed BEFORE any
  // sprite exists so the shelf heads and the rank strip can be drawn first and
  // sit underneath the cards.
  const slots = new Map();
  if (organized) {
    drawRankStrip(scene, ov, deck, 206, RANKS_ASC);
    const bySuit = Object.fromEntries(SUITS.map(su => [su, []]));
    for (const c of deck) (bySuit[c.suit] ?? bySuit[SUITS[SUITS.length - 1]]).push(c);
    SUITS.forEach((suit, r) => {
      const list = bySuit[suit].slice().sort((a, b) => a.rank - b.rank);
      const y = ROW_Y0 + r * SHELF.ROW_PITCH;
      const { scale, pitch } = shelfRowFan(list.length);
      drawShelfHead(scene, ov, suit, list.length, y);
      const sx0 = SHELF.BX + SHELF.HEAD_W + (CARD.w * scale) / 2;
      list.forEach((card, i) => slots.set(card, { x: sx0 + i * pitch, y, scale }));
    });
  } else {
    deck.forEach((card, i) => {
      const arc = big ? Math.abs(i - (deck.length - 1) / 2) : 0;
      slots.set(card, {
        x: x0 + (i % cols) * cw,
        y: y0 + Math.floor(i / cols) * chh + (big ? arc * arc * 3.4 : 0),
        scale: gridScale,
        angle: big ? (i - (deck.length - 1) / 2) * 2.6 : 0,
      });
    });
  }
  // How far a card rises to say it is hovered, and to say it is picked. A shelf
  // row is 180 apart, so the fan's 46px lift would put a picked club through
  // the diamonds above it.
  const HOVER_LIFT = organized ? 12 : big ? 30 : 10;
  const PICK_LIFT = organized ? 16 : big ? 46 : 0;

  const picked = [];
  const sprites = [];
  deck.forEach((card) => {
    const slot = slots.get(card);
    const cs = new CardSprite(scene, slot.x, slot.y, card);
    cs.setScale(slot.scale);
    if (slot.angle) cs.setAngle(slot.angle);
    cs.setDepth(OV_DEPTH + 3);
    cs.setData('picker', true);
    ov.add(cs);
    sprites.push(cs);
    cs.removeInteractive();
    cs.setInteractive({ useHandCursor: true });
    const baseY = cs.y;
    cs.on('pointerover', () => { if (!picked.includes(card)) { sfx(scene, 'card_hover', { volume: 0.36, jitter: 0.08 }); scene.tweens.add({ targets: cs, y: baseY - HOVER_LIFT, duration: 100 }); } });
    cs.on('pointerout', () => { if (!picked.includes(card)) scene.tweens.add({ targets: cs, y: baseY, duration: 100 }); });
    cs.on('pointerdown', () => {
      const idx = picked.indexOf(card);
      if (idx >= 0) {
        picked.splice(idx, 1);
        cs.glow.setAlpha(0);
        scene.tweens.add({ targets: cs, scale: slot.scale, y: baseY, duration: 110 });
      } else if (picked.length < count) {
        picked.push(card);
        cs.glow.setTint(0xffc542).setAlpha(0.85);
        // On a shelf the picked card also comes to the FRONT of its row: at a
        // 0.42-card pitch a duplicated suit overlaps, and a gold halo behind
        // the neighbour it is tucked under is not a selection state.
        ov.bringToTop(cs);
        scene.tweens.add({ targets: cs, scale: slot.scale * 1.1, y: baseY - PICK_LIFT, duration: 110 });
        sfx(scene, 'card_select', { volume: 0.25 });
      }
      confirmBtn.label.setText(optional || picked.length >= count ? 'CONFIRM' : `PICK ${count - picked.length} MORE`);
      confirmBtn.fit();   // 'CONFIRM' must not wear 'PICK 3 MORE'-sized wood
    });
  });

  const confirmBtn = button(scene, ov, GAME_W / 2, GAME_H - 74, optional ? 'CONFIRM' : `PICK ${count} MORE`, () => {
    if (!optional && picked.length < count) return;
    ov.destroy(true);
    cb(picked);
  });
  // THE DECK AND THE ROAD, on the one overlay that used to refuse them (JC,
  // 2026-08-10: "during ANY card-choosing overlay the DECK button must be
  // present"). The old argument — you are already looking at cards — only ever
  // held for the full-deck case; a picker that deals you TEN of fifty-two is
  // exactly where you need to see the other forty-two before you burn one.
  viewDeckButton(scene, ov, run);

  // The picker publishes what it is showing, so a driver can assert the shape
  // rather than count sprites on a canvas.
  const hook = {
    organized, sampled, count, optional,
    total: deck.length,
    suits: SUITS.map(su => ({ suit: su, count: deck.filter(c => c.suit === su).length })),
    ranksAscending: organized,
    picked: () => picked.length,
    close: () => ov.destroy(true),
  };
  window.__hfDeckPicker = hook;
  ov.once('destroy', () => { if (window.__hfDeckPicker === hook) window.__hfDeckPicker = null; });
  return ov;
}

// ---------------------------------------------------------------------------
// Deck info — Balatro-style breakdown: what's left, what's spent, the whole deck
// ---------------------------------------------------------------------------

/** Ranks, high to low: the order SORT: RANK puts a hand in. */
const RANKS_DESC = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
/** ...and low to high, which is `deck.compareCards`' own order. */
const RANKS_ASC = [...RANKS_DESC].slice().reverse();
/**
 * HOW MANY SLOTS THE RANK STRIP HAS, named once. Both orders are the same
 * thirteen ranks, so a geometry constant that reads one of them by name is a
 * lie waiting to happen the day a panel switches direction (which is exactly
 * what the viewer did on 2026-08-10). The strip's own width still reads the
 * order it was HANDED — that one is genuinely per-call.
 */
const RANK_SLOTS = RANKS_ASC.length;   // 13, whichever way you count them

/**
 * THE SHELF GEOMETRY, hoisted (2026-08-10). The deck VIEWER and the full-deck
 * PICKER are now the same picture — four suit shelves under a thirteen-slot
 * rank strip — and the picker sizing itself from a second copy of these numbers
 * is how the two panels drift apart. One block, both readers.
 *
 * The block is sized so a THIRTEEN-card row exactly fills its band: that is the
 * reference deck, so a normal suit looks natural and only a duplicated one has
 * to tighten. Everything is centred on the frame, so the same numbers hold on
 * the 2340-wide mobile canvas.
 */
const SHELF = {
  SCALE: 0.62,
  HEAD_W: 132,          // pip + tally at the row's head
  ROW_PITCH: 180,
  SLOT: 64,             // rank-strip slot pitch
};
SHELF.CW = CARD.w * SHELF.SCALE;
SHELF.PITCH = SHELF.CW + 13;
SHELF.BAND_W = 13 * SHELF.PITCH;
SHELF.BX = Math.round((GAME_W - (SHELF.HEAD_W + SHELF.BAND_W)) / 2);
SHELF.STRIP_X0 = GAME_W / 2 - ((RANK_SLOTS - 1) / 2) * SHELF.SLOT;

/**
 * One row's card scale and pitch. Under thirteen cards nothing moves; over it
 * the fan tightens, and if the fan would tighten past the rank cluster (the
 * left 42% of a card) the cards shrink so the cluster survives.
 */
function shelfRowFan(n) {
  if (n <= 13) return { scale: SHELF.SCALE, pitch: SHELF.PITCH };
  const visible = 0.42;
  let scale = SHELF.SCALE;
  let pitch = (SHELF.BAND_W - CARD.w * scale) / (n - 1);
  if (pitch < CARD.w * scale * visible) {
    scale = Math.max(0.28, SHELF.BAND_W / (CARD.w * (visible * (n - 1) + 1)));
    pitch = (SHELF.BAND_W - CARD.w * scale) / (n - 1);
  }
  return { scale, pitch };
}

/**
 * The rank strip: thirteen fixed slots so the SHAPE of the strip is the shape
 * of the deck at a glance, and a rank you hold none of is dimmed rather than
 * absent. Returns the slot report both panels publish to their dev hooks.
 */
function drawRankStrip(scene, parent, cards, y, order = RANKS_DESC) {
  const rankCount = {};
  for (const c of cards) rankCount[c.rank] = (rankCount[c.rank] ?? 0) + 1;
  parent.add(scene.add.rectangle(GAME_W / 2, y, order.length * SHELF.SLOT + 20, 84, 0x241d33, 0.55)
    .setStrokeStyle(2, 0x4a4060, 0.9));
  parent.add(scene.add.text(SHELF.STRIP_X0 - SHELF.SLOT / 2 - 28, y, 'RANKS', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: '#8a8078',
  }).setOrigin(1, 0.5));
  const slots = order.map((rank, i) => {
    const n = rankCount[rank] ?? 0;
    const x = SHELF.STRIP_X0 + i * SHELF.SLOT;
    parent.add(scene.add.text(x, y - 17, rankLabel(rank), {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px',
      color: n ? '#d8c9a8' : '#6a6058',
    }).setOrigin(0.5));
    parent.add(scene.add.text(x, y + 15, `${n}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px',
      color: n ? '#f0e6cc' : '#5a5250',
    }).setOrigin(0.5));
    return { rank, label: rankLabel(rank), count: n, dim: n === 0, x };
  });
  parent.add(scene.add.text(SHELF.STRIP_X0 + 12 * SHELF.SLOT + SHELF.SLOT / 2 + 28, y, `${cards.length} cards`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#d8c9a8',
  }).setOrigin(0, 0.5));
  return slots;
}

/** One suit's shelf: the lane, its pip and its tally. The cards are the caller's. */
function drawShelfHead(scene, parent, suit, n, y) {
  parent.add(scene.add.rectangle(SHELF.BX + (SHELF.HEAD_W + SHELF.BAND_W) / 2, y,
    SHELF.HEAD_W + SHELF.BAND_W + 20, 156, 0x241d33, 0.4)
    .setStrokeStyle(2, SUIT_COLORS[suit], n ? 0.42 : 0.16));
  const pip = scene.add.image(SHELF.BX + 40, y, SUIT_PIP_KEY[suit]).setTint(SUIT_COLORS[suit]);
  pip.setScale(42 / Math.max(pip.width, pip.height));
  pip.setAlpha(n ? 1 : 0.38);
  parent.add(pip);
  parent.add(scene.add.text(SHELF.BX + 70, y, `${n}`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '32px',
    color: n ? '#f0e6cc' : '#6a6058',
  }).setOrigin(0, 0.5));
}

/**
 * THE DECK VIEWER, LAID OUT LIKE A DECK (JC, 2026-08-05).
 *
 * FOUR ROWS, ONE PER SUIT. The old grid was one continuous 13-wide flow, and
 * on a virgin 52-card deck that flow happens to fall into four clean suit rows
 * — which is exactly what made it a trap. Remove one card, take THE ANARCHIST
 * or let the Artisan copy a queen, and the columns shear: every row after the
 * gap reads as a different suit than the one above it and the whole panel stops
 * answering the only question anybody opens it to ask.
 *
 * So the rows are DECLARED rather than emergent. Each suit gets its own labelled
 * row with its pip and its tally at the head, holds its own cards rank-
 * ASCENDING (2 ... Q K A), and an empty suit still draws its head with a 0 —
 * "you have no gems" is information, and a missing row is not.
 *
 * THE VIEWER READS ASCENDING (JC, 2026-08-10), and so does its rank strip. It
 * used to read DESCENDING because that is the order the SORT: RANK button puts
 * a HAND in — but a hand and a deck are two different objects looked at for two
 * different reasons, and every OTHER place the game shows you your cards laid
 * out (deck.compareCards, the full-deck picker, the sampled picker, the shelf
 * geometry they all share) counts up. One panel counting down was the odd one
 * out, so browsing your deck and then picking from it meant re-reading the same
 * four rows backwards.
 *
 * SORT: RANK IN COMBAT IS A SEPARATE THING and is deliberately untouched: it
 * sorts the eight cards in your hand highest-first because that is how you read
 * a hand for a play, and nothing about this panel's direction reaches it.
 *
 * A ROW FANS, IT NEVER WRAPS. A suit can hold far more than thirteen (duplicates
 * from the Artisan, from a Dealer's copy, from a dozen other places), so past
 * the natural pitch the row overlaps its cards tighter, exactly as the combat
 * hand does. Cards are laid LEFT TO RIGHT so each one's rank cluster — which
 * lives in its top-LEFT corner — stays on top of its neighbour, and once the
 * overlap would start eating that cluster the whole row's cards shrink instead,
 * so a rank is always readable and the row is always inside the panel.
 */
export function deckInfoOverlay(scene, run, { remaining = null, spent = null, depth = null } = {}) {
  const ov = scene.add.container(0, 0).setDepth(depth ?? OV_DEPTH + 2);
  const dim = dimmer(scene, 0.9);
  ov.add(dim);
  ov.add(bigTitle(scene, 80, 'YOUR DECK'));

  const tabs = [['ALL', [...run.runDeck]]];
  if (remaining) tabs.push(['REMAINING', [...remaining]]);
  if (spent) tabs.push(['PLAYED / DISCARDED', [...spent]]);
  /**
   * WHICH TAB OPENS (JC, 2026-08-06). Everyone who opens this panel MID-FIGHT
   * is asking one question — "what is still in there?" — and the panel opened on
   * ALL, which answers a question nobody asked and takes a click to leave.
   *
   * REMAINING only exists when the caller had a draw pile to hand it (the combat
   * DECK button), so this is also the exact test for "am I in a fight": the map
   * and the pack shelves pass no `remaining` and keep ALL, where the whole deck
   * IS the question.
   */
  const defaultTab = Math.max(0, tabs.findIndex(([label]) => label === 'REMAINING'));

  // --- geometry ------------------------------------------------------------
  // The block is sized so a THIRTEEN-card row exactly fills its band: that is
  // the reference deck, so a normal suit looks natural and only a duplicated
  // one has to tighten. Everything is centred on the frame, so the same numbers
  // hold on the 2340-wide mobile canvas.
  const { HEAD_W, BAND_W, BX, ROW_PITCH } = SHELF;
  const ROW_Y0 = 352;
  const STRIP_Y = 210;   // the rank strip, above the shelves

  const content = scene.add.container(0, 0);
  ov.add(content);
  const tabBtns = [];
  let live = null;              // what the open tab currently shows (dev hook)
  let activeTab = 0;            // ...and WHICH tab that is (index into `tabs`)

  const render = (cards) => {
    content.removeAll(true);

    // THE RANK STRIP (JC, 2026-08-05: "how many of each rank"), drawn by the
    // shared helper the full-deck picker also uses — and now in the SAME
    // direction it uses, ascending. See this function's header.
    const rankSlots = drawRankStrip(scene, content, cards, STRIP_Y, RANKS_ASC);

    // THE FOUR ROWS. A stray suit (nothing in the shipped game makes one) files
    // under the LAST row, which is where deck.compareCards already sorts an
    // unknown suit — one convention, so the tallies can never disagree with the
    // cards actually drawn.
    const bySuit = Object.fromEntries(SUITS.map(s => [s, []]));
    for (const c of cards) (bySuit[c.suit] ?? bySuit[SUITS[SUITS.length - 1]]).push(c);
    const rows = SUITS.map((suit, r) => {
      // ASCENDING, the same direction deck.compareCards and both pickers use.
      const list = bySuit[suit].slice().sort((a, b) => a.rank - b.rank);
      const y = ROW_Y0 + r * ROW_PITCH;
      const n = list.length;
      const { scale, pitch } = shelfRowFan(n);
      const cw = CARD.w * scale;
      // The row's own lane: it makes an empty suit read as an empty SHELF
      // rather than as a rendering failure.
      drawShelfHead(scene, content, suit, n, y);

      const x0 = BX + HEAD_W + cw / 2;
      list.forEach((cardData, i) => {
        const cs = new CardSprite(scene, x0 + i * pitch, y, cardData);
        cs.setScale(scale);
        // Interactive but ACTIONLESS: nothing here is pickable, and the flag is
        // what lets the scene's inspect gesture (ui/inspect.js) answer a hold
        // or a right-click on a card in the viewer. No hand cursor — there is
        // nothing to click.
        cs.removeInteractive();
        cs.setInteractive();
        cs.setData('picker', true);
        content.add(cs);
      });
      const x1 = n ? x0 + (n - 1) * pitch + cw / 2 : x0;
      return {
        suit, count: n, drawn: n, headShown: true,
        x0: Math.round(x0 - cw / 2), x1: Math.round(x1),
        inside: x1 <= BX + HEAD_W + BAND_W + 1,
        ranksAscending: list.every((c, i) => i === 0 || list[i - 1].rank <= c.rank),
        scale: Number(scale.toFixed(3)), pitch: Math.round(pitch),
      };
    });

    // A tab with nothing in it at all (PLAYED / DISCARDED, before a hand has
    // been played) is four empty shelves and thirteen zeroes, which is honest
    // but reads as a panel that failed to load. One line, in the gap between
    // the second and third shelves, says it on purpose.
    if (!cards.length) {
      content.add(scene.add.text(GAME_W / 2, ROW_Y0 + 1.5 * ROW_PITCH, 'nothing here yet', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '28px', color: '#8a8078',
      }).setOrigin(0.5));
    }

    live = { total: cards.length, rows, ranks: rankSlots };
  };

  tabs.forEach(([label, cards], i) => {
    const bx = GAME_W / 2 + (i - (tabs.length - 1) / 2) * 320;
    const btn = scene.add.image(bx, 150, 'btn_dark').setInteractive({ useHandCursor: true });
    const txt = scene.add.text(bx, 147, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: '#cfc8e8',
    }).setOrigin(0.5);
    // A three-letter tab ('ALL') has no business being as wide as
    // 'PLAYED / DISCARDED' — each tab wears its own name.
    btn.setDisplaySize(fitWidth(txt, { pad: 56, min: 150, max: 340 }), 54);
    ov.add(btn); ov.add(txt);
    tabBtns.push({ btn, txt });
    const pick = (quiet = false) => {
      if (!quiet) sfx(scene, 'button', { volume: 0.6 });
      tabBtns.forEach(t => { t.btn.setTexture('btn_dark'); t.txt.setColor('#cfc8e8'); });
      btn.setTexture('btn_yellow'); txt.setColor('#5b3a00');
      activeTab = i;
      render([...cards]);
    };
    tabBtns[i].pick = pick;
    btn.on('pointerdown', () => pick());
  });
  tabBtns[defaultTab].pick(true);

  button(scene, ov, GAME_W / 2, GAME_H - 56, 'CLOSE', () => ov.destroy(true), { w: 240, h: 60 });
  // The viewer has no VIEW DECK plate (it IS the deck) but it still gets the
  // road: this panel opens over shops, shelves and fights, and "what is ahead"
  // is half of every decision taken while it is up.
  if (hasMapToPeek()) viewMapButton(scene, ov, 150, GAME_H - 62, { depth: (ov.depth ?? OV_DEPTH) + 6 });
  dim.on('pointerdown', () => ov.destroy(true));

  // Autonomous-playtest hook: the two sums that make this panel honest (every
  // suit row and every rank slot adding back up to the tab's own total) are
  // arithmetic over the objects actually drawn, so a driver can assert them
  // without reading the canvas. See tools/verify_qol_0805.py.
  const hook = {
    tabs: () => tabs.map(([label]) => label),
    // Which tab is OPEN, and which one the panel chose to open on: REMAINING
    // wherever it exists (a fight), ALL where it does not (the map, a shelf).
    activeTab: () => activeTab,
    activeLabel: () => tabs[activeTab]?.[0] ?? null,
    setTab: (i) => { tabBtns[Phaser.Math.Clamp(i, 0, tabBtns.length - 1)].pick(true); return live; },
    report: () => live,
    close: () => ov.destroy(true),
  };
  window.__hfDeckInfo = hook;
  // viewDeckButton can stack a SECOND browser over a first one, so a closing
  // overlay only takes the hook down if the hook is still its own.
  ov.once('destroy', () => { if (window.__hfDeckInfo === hook) window.__hfDeckInfo = null; });
  return ov;
}

// ---------------------------------------------------------------------------
// Suit picker
// ---------------------------------------------------------------------------

export function suitPickerOverlay(scene, { title = 'Choose a suit', exclude = null }, cb) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 3);
  ov.add(dimmer(scene, 0.85));
  ov.add(bigTitle(scene, 300, title.toUpperCase()));
  const suits = ['swords', 'hearts', 'gems', 'clovers'].filter(s => s !== exclude);
  const xs = suits.map((_, i) => GAME_W / 2 + (i - (suits.length - 1) / 2) * 260);
  suits.forEach((suit, i) => {
    const card = scene.add.container(xs[i], 560);
    const parts = woodPanel(scene, 0, 0, 210, 250, { accent: SUIT_COLORS[suit] });
    card.add([parts.shadow, parts.panel, parts.line]);
    const pip = scene.add.image(0, -28, SUIT_PIP_KEY[suit]).setTint(SUIT_COLORS[suit]);
    pip.setScale(96 / Math.max(pip.width, pip.height));
    card.add(dropShadow(scene, pip, { dx: 5, dy: 7, alpha: 0.26 }));   // pip lifts off the parchment
    card.add(pip);
    card.add(scene.add.text(0, 74, SUIT_GLYPH[suit], {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: PARCH.text,
    }).setOrigin(0.5));
    ov.add(card);
    parts.panel.setInteractive({ useHandCursor: true });
    parts.panel.on('pointerover', () => scene.tweens.add({ targets: card, scale: 1.08, duration: 110 }));
    parts.panel.on('pointerout', () => scene.tweens.add({ targets: card, scale: 1, duration: 110 }));
    const commit = () => {
      sfx(scene, 'take', { volume: 0.8 });
      ov.destroy(true);
      cb(suit);
    };
    // TWO TAPS. A suit plate is the mildest case on the shelf — the glyph and
    // the word are both already printed on it — but naming a suit is what the
    // Prism, the transmuters and half the Witch's pack turn on, and a stray
    // thumb on a four-across row of 210px plates is exactly the accident the
    // model exists to prevent. The box says the suit and what it pays; CHOOSE
    // is the only thing that acts.
    if (TOUCH) {
      twoTap(scene, parts.panel, {
        key: `suit:${suit}`,
        anchor: hitAnchor(parts.panel),
        title: SUIT_GLYPH[suit],
        // The hero's own sheet, which is the only reason a suit is worth more
        // to one player than another (chr().suitNotes — the Bull's Diamonds hit
        // twice, Zelus's Hearts bank as Zeal). Falls back to nothing at all
        // rather than to a guess.
        body: () => chr().suitNotes?.find(n => n.suit === suit)?.text ?? '',
        accent: SUIT_COLORS[suit],
        depth: (ov.depth ?? OV_DEPTH) + 10,
        owner: ov,
        buttons: [{ label: 'CHOOSE', kind: 'take', onClick: commit }],
      });
    } else {
      parts.panel.on('pointerdown', commit);
    }
  });
  // Which suit to name is a question about the deck you are holding, so the
  // deck is one press away (PATCH 0803-B §4.3).
  viewDeckButton(scene, ov, run);
  return ov;
}

// ---------------------------------------------------------------------------
// Hand chart — every hand type's CURRENT mult (base + Smith levels + artifacts)
// ---------------------------------------------------------------------------

/**
 * THE HANDS CHART, REWRITTEN FOR THE HANDS OVERHAUL (JC, 2026-08-06).
 *
 * A hand is TWO numbers now — its own base VALUE on the score side and its
 * MULT — and the chart used to print only the second, which meant the panel
 * whose entire job is "what is this hand worth to me right now" was answering
 * half the question. Every row now carries the whole answer:
 *
 *   FULL HOUSE      ×4 played     Lv.3      60      ×8
 *   ^ name                        ^ Smith   ^ VALUE ^ MULT
 *
 *   VALUE  the hand's base + valueStep per Smith level (handStats).
 *   MULT   the same, plus every artifact's handMult for that type.
 *   played THIS RUN's count off run.stats.handTypeCounts — small and muted,
 *          because it is history rather than arithmetic, and because it is the
 *          number that now decides whether the SMITH will offer a secret.
 *
 * A SECRET hand never discovered (LIFETIME — progress.discoveredHands) is
 * ABSENT from the chart entirely (JC, 2026-08-06 follow-up: the '???' tease
 * read as confusing, not enticing). Seen-ever still means named-forever —
 * the lifetime ledger now decides whether the ROW EXISTS, while the Smith
 * keeps his separate played-THIS-RUN gate. Rows run ASCENDING (High Card
 * first), and every row prints its level — Lv.1 at base, because a blank
 * level column read as "no level" rather than "level nothing yet".
 */
export function handChartOverlay(scene, run) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 2);
  const dim = dimmer(scene, 0.8);
  ov.add(dim);
  const cy = GAME_H / 2;
  const cx = GAME_W / 2;
  // WIDER THAN IT WAS, and it has to be: four columns instead of two, and
  // the row count breathes — undiscovered secrets are not rows at all.
  //
  // THE PANEL IS SIZED BY ITS CONTENT. Every offset below is measured off the
  // panel's own top and bottom edges rather than typed against a remembered
  // height, and the height itself is the row block plus the two fixed bands
  // (title/subtitle/column heads above, the note and CLOSE below). Add a
  // thirteenth hand type and the panel grows by one row; it cannot silently
  // push the bottom row through the CLOSE button, and it cannot leave a band
  // of empty parchment when the ladder is short. Clamped to the canvas so a
  // very long ladder tightens its PITCH instead of overflowing 1080.
  // ASCENDING, High Card first (JC), and only hands the profile has ever seen.
  const rows = HAND_TYPES.filter(t => !HAND_DEFS[t].secret || isHandDiscovered(t));
  const HEAD_BAND = 180;                    // panel top -> the first row
  const FOOT_BAND = 124;                    // the last row -> panel bottom
  const MAX_H = GAME_H - 80;
  const PITCH = Math.min(52, Math.max(34,
    Math.floor((MAX_H - HEAD_BAND - FOOT_BAND) / Math.max(1, rows.length - 1))));
  const PANEL_H = Math.min(MAX_H, HEAD_BAND + (rows.length - 1) * PITCH + FOOT_BAND);
  const top = cy - PANEL_H / 2;
  const bot = cy + PANEL_H / 2;
  const parts = woodPanel(scene, cx, cy, 820, PANEL_H, { accent: 0xd07028 });
  ov.add([parts.shadow, parts.panel, parts.line]);
  ov.add(scene.add.text(cx, top + 58, 'YOUR HANDS', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: PARCH.text,
  }).setOrigin(0.5));
  ov.add(scene.add.text(cx, top + 100, 'VALUE and MULT · base + Smith levels + artifacts', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '20px', color: PARCH.textDim, fontStyle: 'bold',
  }).setOrigin(0.5));

  // --- the columns, declared once ---
  const X_NAME = cx - 380;    // left
  const X_PLAYS = cx - 116;   // right-aligned, small, muted
  const X_LEVEL = cx - 24;    // centred
  const X_VALUE = cx + 176;   // right-aligned
  const X_MULT = cx + 380;    // right-aligned
  const HEAD_Y = top + 144;
  const head = (x, label, origin) => ov.add(scene.add.text(x, HEAD_Y, label, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
  }).setOrigin(origin, 0.5));
  head(X_LEVEL, 'LEVEL', 0.5);
  head(X_VALUE, 'VALUE', 1);
  head(X_MULT, 'MULT', 1);

  const mods = collectMods();
  const counts = run?.stats?.handTypeCounts ?? {};
  const TOP = top + HEAD_BAND;
  rows.forEach((t, i) => {
    const def = HAND_DEFS[t];
    const lvl = run.handLevels[t] ?? 0;
    // The one derivation, shared with the Smith's shelf and with scoring.js.
    const { base, mult } = handStats(t, lvl);
    const bonus = mods.handMult[t] ?? 0;
    const now = mult + bonus;
    const played = Number(counts[def.name]) || 0;
    const y = TOP + i * PITCH;
    const nameText = scene.add.text(X_NAME, y, def.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.text,
    }).setOrigin(0, 0.5);
    ov.add(nameText);
    /**
     * THE GLITCH ROW (JC, 2026-08-10). A discovered SIX OF A KIND does not sit
     * on this chart like the other twelve: it jitters and cycles, in the same
     * visual family as the INFINITY payoff its square exists to produce. One
     * flag on the def (`glitch`) and one shared helper, so the chart never
     * learns which hand it is — the day a second glitchy hand ships it wears
     * the treatment for free.
     *
     * The timer is parented to the TEXT, so closing the overlay kills it.
     * Origin is (0, 0.5) here rather than the payoff's centred glyph, and
     * glitchText jitters around wherever the object already is, so nothing
     * about the column layout has to change.
     */
    if (def.glitch) glitchText(scene, nameText, { step: 90, strength: 1, corrupt: true });
    // HISTORY, NOT ARITHMETIC: quiet, and only when there is any.
    if (played > 0) {
      ov.add(scene.add.text(X_PLAYS, y + 1, `×${played} played`, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '16px',
        color: PARCH.textDim, fontStyle: 'bold',
      }).setOrigin(1, 0.5));
    }
    // Lv.1 at base — the display level is always internal + 1, same as the
    // Smith's shelf, and a filled column reads as "this is a thing you level".
    ov.add(scene.add.text(X_LEVEL, y, `Lv.${lvl + 1}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px',
      color: lvl > 0 ? '#b45c10' : PARCH.textDim,
    }).setOrigin(0.5));
    ov.add(scene.add.text(X_VALUE, y, `${base}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '26px',
      color: base > def.base ? '#1d7a56' : PARCH.textDim,
    }).setOrigin(1, 0.5));
    /**
     * A SQUARING HAND'S MULT COLUMN (2026-08-10). SIX OF A KIND brings mult 1
     * and SQUARES the finished mult instead, so the plain reading printed "×1"
     * under the best hand in the game — arithmetically true before the square,
     * and a lie about what the hand does. `(×N)²` is the whole rule in four
     * glyphs, and it still shows the live N so a relic's bonus is visible
     * exactly as it is on every other row.
     */
    ov.add(scene.add.text(X_MULT, y, def.squaresMult ? `(×${now})²` : `×${now}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '27px',
      color: now > def.mult ? '#1d7a56' : PARCH.textDim,
    }).setOrigin(1, 0.5));
  });

  button(scene, ov, cx, bot - 56, 'CLOSE', () => ov.destroy(true), { w: 240, h: 62 });
  viewDeckButton(scene, ov, run);
  dim.on('pointerdown', () => ov.destroy(true));
  return ov;
}

// ---------------------------------------------------------------------------
// The Wheel — a real spinning wheel for gambles
// ---------------------------------------------------------------------------

/**
 * segments: [{ label, color }] — spins, lands on `landIndex`, then cb().
 * `fontSize`/`labelFrac` let a many-wedge wheel (the Bounty Hunter's 20-segment
 * Forge Wheel) fit its labels; the 8-segment witch wheel keeps the old numbers.
 */
export function wheelSpinOverlay(scene, segments, landIndex, cb, { fontSize = 25, labelFrac = 0.62 } = {}) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 4);
  ov.add(dimmer(scene, 0.8));
  const cx = GAME_W / 2, cy = GAME_H / 2 - 20, R = 240;

  const wheel = scene.add.container(cx, cy);
  const g = scene.add.graphics();
  const n = segments.length;
  const arc = (Math.PI * 2) / n;
  segments.forEach((seg, i) => {
    g.fillStyle(seg.color, 1);
    g.slice(0, 0, R, i * arc - Math.PI / 2 - arc / 2, (i + 1) * arc - Math.PI / 2 - arc / 2, false);
    g.fillPath();
    g.lineStyle(6, 0x38220f, 1);
    g.strokeCircle(0, 0, R);
  });
  wheel.add(g);
  segments.forEach((seg, i) => {
    const a = i * arc - Math.PI / 2;
    wheel.add(scene.add.text(Math.cos(a) * R * labelFrac, Math.sin(a) * R * labelFrac, seg.label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${fontSize}px`, color: '#fff6e0',
      stroke: '#241505', strokeThickness: Math.max(3, Math.round(fontSize / 5)),
    }).setOrigin(0.5).setAngle((a + Math.PI / 2) * 180 / Math.PI));
  });
  const hub = scene.add.image(cx, cy, 'btn_circle_gray').setDisplaySize(84, 84);
  const pointer = scene.add.image(cx, cy - R - 16, 'target_arrow').setScale(1.3);
  // The wheel is a solid object hanging in the dark — a soft disc of shadow
  // behind it, then cast copies for the hub and the pointer that ride on top.
  const wheelShadow = scene.add.image(cx + 10, cy + 20, 'fx_glow_circle')
    .setTint(0x080508).setAlpha(0.45).setDisplaySize(R * 2.5, R * 2.5);
  const hubShadow = dropShadow(scene, hub, { dx: 4, dy: 6, alpha: 0.34 });
  const pointerShadow = dropShadow(scene, pointer, { dx: 4, dy: 7, alpha: 0.34 });
  ov.add([wheelShadow, wheel, hubShadow, hub, pointerShadow, pointer]);

  sfx(scene, 'wheel_spin', { volume: 0.9 });
  // Land so segment `landIndex` sits under the pointer: wheel angle = -index*arcDeg + spins
  const spins = 4 + Math.floor(Math.random() * 2);
  const finalDeg = 360 * spins - landIndex * (360 / n);
  let lastTick = 0;
  scene.tweens.add({
    targets: wheel, angle: finalDeg, duration: 3400, ease: 'Cubic.easeOut',
    onUpdate: (tw) => {
      const seg = Math.floor(tw.getValue() / (360 / n));
      if (seg !== lastTick) { lastTick = seg; sfx(scene, 'score_tick', { volume: 0.3, rate: 1.3 }); }
    },
    onComplete: () => {
      scene.tweens.add({ targets: pointer, y: cy - R - 4, duration: 90, yoyo: true, repeat: 2 });
      scene.tweens.add({ targets: pointerShadow, y: cy - R + 3, duration: 90, yoyo: true, repeat: 2 });
      scene.time.delayedCall(700, () => { ov.destroy(true); cb(); });
    },
  });
  return ov;
}

// ---------------------------------------------------------------------------
// Artifact acquisition ceremony (drops, purchases, summons)
// ---------------------------------------------------------------------------

// Rarity stings (Caleb 2026-07-29 set): commons/rares whisper, the big ones sing.
// Exported because the EGG's hatch ceremony is a drop too and had grown its own
// two-branch guess, which paid a Legendary the same whisper as a common.
export const DROP_SFX = {
  common: 'minor_upgrade', rare: 'minor_upgrade', veryRare: 'drop_hit',
  legendary: 'legendary_appears', heroExclusive: 'mythical_appears',
  mythical: 'mythical_appears',
};

/** Tiers that earn the full darkness-then-reveal riser before the ceremony. */
const RISER_RARITIES = { mythical: 0xe03040, heroExclusive: 0xff5ce1 };

/**
 * Present `def` with full theatre and add it to the run (handles the
 * Suit Prism choice and full-slot replacement).
 *
 * `done(taken)` when resolved, and THE BOOLEAN IS LOAD-BEARING: this ceremony
 * grew a decline door on 2026-08-01 (TAKE IT / LEAVE IT, and NEVER MIND on the
 * belt-full branch) and every caller that PAYS for the relic has to be able to
 * tell "you have it" from "you walked away". The merchant charged on the click
 * that opened this overlay and never refunded, so LEAVE IT cost you the chips
 * and gave you nothing. Callers that do not care may ignore the argument.
 *
 * opts.quiet:   the purchase already made its sound — skip the drop sting.
 * opts.noRiser: the caller already played the darkness-and-pulse riser (the
 *               elite choice shelf / the Curator's case do it ONCE, up front,
 *               for the best rarity on offer) — don't stage a second one.
 */
export function artifactCeremony(scene, run, def, done, opts = {}) {
  const finalize = () => {
    if (def.acquireUI === 'suitPrism') {
      suitPickerOverlay(scene, { title: 'Prism: transmute WHICH suit?' }, (from) => {
        suitPickerOverlay(scene, { title: `All ${SUIT_GLYPH[from]} become...`, exclude: from }, (to) => {
          // Receipt every converted card so selling the Prism can pour the
          // light back out of exactly these cards (copies keep the new suit).
          const ids = [];
          for (const c of run.runDeck) if (c.suit === from) { ids.push(c.id); c.suit = to; }
          const inst = acquireArtifact(run, { ...def, desc: `All ${SUIT_GLYPH[from]} became ${SUIT_GLYPH[to]}.` });
          inst.state.prism = { from, to, ids };
          beltChanged(scene);
          done(true);
        });
      });
      return;
    }
    acquireArtifact(run, def);
    // The mat/belt repaints NOW, not at the next scene change — a relic taken
    // mid-combat has to be visible in the panel it is already affecting.
    beltChanged(scene);
    done(true);
  };

  const show = () => {
    const rar = ARTIFACT_RARITY[def.rarity];
    const rarCss = '#' + rar.color.toString(16).padStart(6, '0');
    const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 1);
    ov.add(dimmer(scene, 0.85));
    // TAKE IT / LEAVE IT is a real decision and half the relics in the game
    // read the deck, so the deck is reachable from here (PATCH 0803-B §4.3).
    // Added before the reveal so it is present down both branches below —
    // the ordinary take/leave and the belt-full replace flow.
    viewDeckButton(scene, ov, run);

    const glow = scene.add.image(GAME_W / 2, GAME_H / 2 - 60, 'fx_glow_circle')
      .setTint(rar.color).setScale(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8);
    ov.add(glow);
    scene.tweens.add({ targets: glow, scale: RISER_RARITIES[def.rarity] ? 2.6 : 1.8, duration: 600, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: glow, alpha: 0.45, duration: 1400, yoyo: true, repeat: -1, delay: 600 });

    const card = scene.add.container(GAME_W / 2, GAME_H / 2 - 40).setScale(0);
    const parts = woodPanel(scene, 0, 0, 420, 470, { accent: rar.color });
    card.add([parts.shadow, parts.panel, parts.line]);
    const rarText = scene.add.text(0, -196, rar.label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: rarCss, stroke: '#38220f', strokeThickness: 4,
    }).setOrigin(0.5);
    // HERO EXCLUSIVE: the banner cycles the full spectrum for as long as the
    // ceremony is open. The timer is parented to the text, so closing the
    // overlay stops it.
    if (rar.rainbow) rainbowText(scene, rarText);
    card.add(rarText);
    // The relic hangs in the air over its plaque — a cast copy behind it gives
    // the reveal weight (JC: "when I receive an artifact it needs a shadow").
    const iconShadow = addArtifactIcon(scene, 7, -95, def, 150).setTint(0x120a06).setAlpha(0.42);
    card.add(iconShadow);
    const icon = addArtifactIcon(scene, 0, -104, def, 150);
    card.add(icon);
    scene.tweens.add({ targets: icon, y: -110, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    card.add(scene.add.text(0, -18, def.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '35px', color: PARCH.text,
      wordWrap: { width: 370 }, align: 'center',
    }).setOrigin(0.5));
    card.add(scene.add.text(0, 92, personalize(def.desc), {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: PARCH.text, fontStyle: 'bold',
      wordWrap: { width: 360 }, align: 'center',
    }).setOrigin(0.5));
    ov.add(card);
    scene.tweens.add({ targets: card, scale: 1, duration: 420, ease: 'Back.easeOut' });
    if (!opts.quiet) sfx(scene, DROP_SFX[def.rarity] ?? 'minor_upgrade', { volume: 0.9 });

    // How many cells this relic needs FREE: one for itself, plus any it is
    // about to eat. The OVERSTUFFED SATCHEL takes a slot and removes one, so a
    // full row has to route through the replace flow below — otherwise the
    // satchel lands, the slot count drops, and a relic is stranded off the belt
    // with nowhere legal to stand.
    const need = 1 + (def.props?.slotDrain ?? 0);
    const full = !def.props?.noSlot && slotsUsed() + need > run.artifactSlots;
    if (!full) {
      // TAKE IT / LEAVE IT. Every decline in the game lives on the FIRST screen
      // of its flow (JC, 2026-08-01) — and this was the one surface in the game
      // with no way out at all: every elite pick, shop purchase, chest, altar,
      // Hunter's Cache and MYTHIC EMBER funnels through here, and until now the
      // only button on it said yes. A relic you do not want is a real answer:
      // GLASS CANNON costs you 30 Max HP the instant it lands.
      // TAKE IT keeps its exact centre (every verification walk clicks it
      // there); LEAVE IT is stacked directly under it, dark, smaller.
      button(scene, ov, GAME_W / 2, GAME_H / 2 + 240, 'TAKE IT', () => {
        sfx(scene, 'take', { volume: 0.9 });
        ov.destroy(true);
        finalize();
      });
      button(scene, ov, GAME_W / 2, GAME_H / 2 + 318, 'LEAVE IT', () => {
        ov.destroy(true);
        done(false);
      }, { key: 'btn_dark', color: '#cfc8e8', w: 240, h: 56 });
    } else {
      // Both of these sit UNDER the reveal card, on nothing but the rarity glow
      // (fx_glow_circle, ADD blend, pulsing to 0.8), so gold and warm grey were
      // landing on their own colour. Stroke them.
      ov.add(legible(scene.add.text(GAME_W / 2, GAME_H / 2 + 205, 'Your artifact slots are FULL. Replace one?', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '23px', color: '#ffd23e', fontStyle: 'bold',
      })).setOrigin(0.5));
      ov.add(legible(scene.add.text(GAME_W / 2, GAME_H / 2 + 236,
        say('hover a relic to read it, click to swap it out',
          'tap a relic to read it, then REPLACE IT'), {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: '#d8c9a8', fontStyle: 'bold',
      })).setOrigin(0.5));
      // Only the ROW can be swapped out: a nook relic (the Sixth Finger's
      // glove) holds no slot, so trading it for the newcomer would free nothing
      // — and would quietly cost you the sixth slot it granted. Sell it on the
      // map if you want it gone.
      const swappable = beltArtifacts(run);
      const xs0 = GAME_W / 2 - ((swappable.length - 1) / 2) * 96;
      let tip = null;
      const killTip = () => { if (tip) { tip.destroy(true); tip = null; } };
      swappable.forEach((owned, i) => {
        const sx = xs0 + i * 96;
        const slot = scene.add.container(sx, GAME_H / 2 + 300);
        const box = scene.add.rectangle(0, 0, 80, 80, 0xdcc492).setStrokeStyle(4, ARTIFACT_RARITY[owned.rarity].color);
        slot.add(box);
        slot.add(addArtifactIcon(scene, 3, 4, owned, 62).setTint(0x120a06).setAlpha(0.28));
        slot.add(addArtifactIcon(scene, 0, 0, owned, 62));
        const blocked = mirrorBlockedBy(owned);
        if (blocked) slot.add(noMirrorBadge(scene, 30, -28, 10));
        ov.add(slot);
        box.setInteractive({ useHandCursor: true });
        box.on('pointerover', () => {
          box.setFillStyle(0xf6e8c8);
          sfx(scene, 'card_hover', { volume: 0.3, jitter: 0.08 });
          // What am I giving up? Name + the FULL rules text, personalized.
          killTip();
          tip = miniTip(scene, sx, GAME_H / 2 + 214, `${owned.name}  ·  ${ARTIFACT_RARITY[owned.rarity].label}`,
            artifactTipBody(owned),
            ARTIFACT_RARITY[owned.rarity].color, !!ARTIFACT_RARITY[owned.rarity].rainbow);
          tip.setDepth((ov.depth ?? OV_DEPTH) + 4);
        });
        box.on('pointerout', () => { box.setFillStyle(0xdcc492); killTip(); });
        const commit = () => {
          // A relic swapped OUT leaves with its grants, exactly as if it had
          // been sold: onSell is what revokes a discard, a slot or a granted
          // card. Without it the Overstuffed Satchel could take a slot away and
          // then be replaced, and the slot would never come back.
          //
          // RESOLVED BY IDENTITY, never by the captured `i`. On desktop the
          // click and the splice are the same instant so the two agree; on
          // touch a description box stands between them, and anything that
          // touches the belt while it is open (a bottle drunk, a scene restart)
          // would make `i` name the wrong relic. indexOf cannot be wrong, and
          // a relic that is already gone is a no-op rather than a mis-splice.
          const at = run.artifacts.indexOf(owned);
          if (at < 0) return;
          owned.onSell?.(run, owned);
          run.artifacts.splice(at, 1);
          sfx(scene, 'take', { volume: 0.9 });
          killTip();
          ov.destroy(true);
          beltChanged(scene);   // the old relic is gone from the mat this instant
          finalize();
        };
        // TWO TAPS, and this is the most destructive one in the file: the
        // press DELETES a relic you already own, with its grants. The box has
        // to say which relic, what it does, and what leaving costs, before
        // REPLACE IT is anywhere near a thumb.
        if (TOUCH) {
          twoTap(scene, box, {
            // A belt can legitimately carry two of the same relic (the forge
            // strikes copies), so the key carries the SLOT as well as the id.
            key: `replaceRelic:${i}:${owned.id}`,
            anchor: hitAnchor(box),
            title: `${owned.name}  ·  ${ARTIFACT_RARITY[owned.rarity].label}`,
            body: () => artifactTipBody(owned),
            note: 'Replacing it takes its gift with it.',
            accent: ARTIFACT_RARITY[owned.rarity].color,
            depth: (ov.depth ?? OV_DEPTH) + 10,
            owner: ov,
            buttons: [{ label: 'REPLACE IT', kind: 'danger', onClick: commit }],
            onOpen: killTip,
          });
        } else {
          box.on('pointerdown', commit);
        }
      });
      // Decline outright: nothing is taken, nothing is lost from the belt.
      button(scene, ov, GAME_W / 2, GAME_H / 2 + 406, 'NEVER MIND', () => { killTip(); ov.destroy(true); done(false); },
        { key: 'btn_dark', color: '#cfc8e8' });
      ov.once('destroy', killTip);
    }
  };

  if (RISER_RARITIES[def.rarity] && !opts.noRiser) {
    rarityRiser(scene, def.rarity, show);
  } else {
    show();
  }
}

/**
 * The darkness-and-pulse riser that fronts a MYTHICAL / HERO EXCLUSIVE reveal.
 * Hoisted out of artifactCeremony so a SHELF of relics can play it once, up
 * front, for the best tier on offer instead of once per relic.
 */
export function rarityRiser(scene, rarity, then) {
  const tint = RISER_RARITIES[rarity];
  if (!tint) return then();
  const pre = scene.add.container(0, 0).setDepth(OV_DEPTH + 1);
  pre.add(dimmer(scene, 0.9));
  const pulse = scene.add.image(GAME_W / 2, GAME_H / 2, 'fx_glow_circle')
    .setTint(tint).setScale(0.4).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD);
  pre.add(pulse);
  suspense(scene, { volume: 0.9 });
  scene.tweens.add({ targets: pulse, scale: 3.2, alpha: 0.9, duration: 1700, ease: 'Sine.easeIn' });
  scene.cameras.main.shake(1700, 0.004);
  scene.time.delayedCall(1750, () => { pre.destroy(true); then(); });
}

// ---------------------------------------------------------------------------
// THE RELIC SHELF — one overlay, two ceremonies
// ---------------------------------------------------------------------------
// Elite kills and the Curator's case both end in the same question: several
// relics are standing in front of you, take ONE. The staging differs (an elite
// drops its spoils on the ground; the Curator opens a display case behind a
// velvet curtain), so the shelf takes a THEATRE description rather than a flag.

const RARITY_RANK = ['common', 'rare', 'veryRare', 'legendary', 'heroExclusive', 'mythical'];

/** juice.burst, but ABOVE the overlay dim — a shelf pick has to be visible. */
function shelfBurst(scene, x, y, tint, count = 16) {
  for (let i = 0; i < count; i++) {
    const p = scene.add.image(x, y, i % 3 === 0 ? 'fx_star' : 'fx_dust')
      .setDepth(OV_DEPTH + 6).setTint(tint).setBlendMode(Phaser.BlendModes.ADD)
      .setScale(Phaser.Math.FloatBetween(0.14, 0.34));
    const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const dist = Phaser.Math.Between(70, 210);
    scene.tweens.add({
      targets: p, x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist,
      alpha: 0, angle: Phaser.Math.Between(-200, 200),
      duration: Phaser.Math.Between(380, 700), ease: 'Cubic.easeOut',
      onComplete: () => p.destroy(),
    });
  }
}

/**
 * The best tier standing on the shelf — what the riser (if any) plays for.
 * Takes either plain defs (the Curator) or `{ kind, def }` entries (the mixed
 * elite shelf); a bottle's rarity counts on the same ladder, because it is the
 * same ladder (potions.js: "RARITY IS ONE SYSTEM").
 */
export function bestRarity(defs) {
  const rarityOf = d => (d && d.def ? d.def : d)?.rarity;
  return defs.reduce((best, d) =>
    (RARITY_RANK.indexOf(rarityOf(d)) > RARITY_RANK.indexOf(best) ? rarityOf(d) : best),
  rarityOf(defs[0]) ?? 'common');
}

/**
 * `defs` on pedestals. On desktop a hover reads them and a click takes ONE; on
 * touch the first tap opens the description box and its TAKE IT is the click.
 * Either way the rest fade. Declining is always allowed (the Bounty Hunter's
 * TAKE NOTHING precedent).
 *
 * theatre: { title, subtitle, accent, skipLabel, pedestal, curtain, openSfx,
 *            settleSfx, stagger }
 */
export function relicChoiceOverlay(scene, run, defs, theatre, done) {
  const {
    title = 'ELITE SPOILS', subtitle = 'Three relics. Take ONE.',
    accent = 0xffc542, skipLabel = 'TAKE NOTHING',
    curtain = false, openSfx = null, settleSfx = null, stagger = 130,
  } = theatre ?? {};

  if (!defs.length) return done();

  // THE SHELF TAKES ENTRIES NOW: `{ kind: 'artifact'|'potion', def }`. Every
  // older caller (the Curator's case, the dev harness) still hands it a plain
  // array of relic defs, so a bare def normalises to an artifact entry and none
  // of them had to learn anything. `defs.length` is unchanged either way, which
  // is why all the geometry below still reads it.
  const items = defs.map(d => (d && d.kind && d.def ? d : { kind: 'artifact', def: d }));

  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 1);
  ov.add(dimmer(scene, curtain ? 0.92 : 0.86));
  const accentCss = '#' + accent.toString(16).padStart(6, '0');

  const shelfY = 520;
  const gap = Math.min(defs.length <= 3 ? 380 : 330, 1680 / defs.length);
  const iconSize = defs.length <= 3 ? 176 : 138;
  const xs = defs.map((_, i) => GAME_W / 2 + (i - (defs.length - 1) / 2) * gap);

  // The pieces the curtain hides until it sweeps.
  const stage = scene.add.container(0, 0).setAlpha(curtain ? 0 : 1);
  ov.add(stage);

  stage.add(bigTitle(scene, 168, title, accentCss));
  stage.add(scene.add.text(GAME_W / 2, 228, subtitle, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '25px', color: '#d8c9a8', fontStyle: 'bold',
  }).setOrigin(0.5));

  // THE CASE: one long dark LEDGE the relics stand on, lit along its front
  // edge (the Curator's glass, the elite's slab of broken ground — same
  // geometry, different colour). A wood panel was tried first and read as a
  // bright parchment slab that swallowed the relics; a ledge lets the
  // spotlights do the work.
  const caseW = Math.min(GAME_W - 120, gap * defs.length + 110);
  const ledgeY = shelfY + iconSize * 0.44;
  stage.add(scene.add.image(GAME_W / 2, ledgeY + 8, 'fx_glow')
    .setTint(accent).setAlpha(0.16).setDisplaySize(caseW * 1.05, 190)
    .setBlendMode(Phaser.BlendModes.ADD));
  stage.add(scene.add.rectangle(GAME_W / 2, ledgeY + 56, caseW, 112, 0x1a1118, 0.94)
    .setStrokeStyle(4, accent));
  stage.add(scene.add.rectangle(GAME_W / 2, ledgeY, caseW, 7, accent).setAlpha(0.9));

  let tip = null;
  const killTip = () => { if (tip) { tip.destroy(true); tip = null; } };
  ov.once('destroy', killTip);

  const cells = [];
  const shelfEntries = [];
  let taken = false;

  items.forEach((item, i) => {
    const def = item.def;
    const isPotion = item.kind === 'potion';
    const rar = (isPotion ? POTION_RARITY : ARTIFACT_RARITY)[def.rarity] ?? ARTIFACT_RARITY.common;
    // A full belt is a TRADE now, not a refusal (JC, 2026-08-04): the tooltip
    // says so, and potionCeremony downstream stages the swap-or-never-mind.
    const beltFull = isPotion && (run.potions?.length ?? 0) >= MAX_POTIONS;
    const cell = scene.add.container(xs[i], shelfY + 70).setAlpha(0);
    // A soft spotlight falling on the pedestal from above.
    const spot = scene.add.image(0, -40, 'fx_glow_circle').setTint(rar.color)
      .setAlpha(0.22).setDisplaySize(iconSize * 1.9, iconSize * 2.6)
      .setBlendMode(Phaser.BlendModes.ADD);
    cell.add(spot);
    scene.tweens.add({ targets: spot, alpha: 0.42, duration: 1500 + i * 130, yoyo: true, repeat: -1 });
    // The pedestal, and the pool of contact shadow the relic casts on it.
    cell.add(scene.add.rectangle(0, iconSize * 0.46, iconSize * 0.86, 22, 0x33231a).setStrokeStyle(3, accent));
    cell.add(contactPool(scene, 0, iconSize * 0.4, iconSize * 0.9, { alpha: 0.5 }));
    // addPotionIcon already carries its own cast shadow (a flask silhouette, or
    // a tint-filled copy of Caleb's art), so a bottle gets ONE body where a
    // relic gets an icon plus a hand-made dark duplicate behind it.
    let icon;
    if (isPotion) {
      icon = addPotionIcon(scene, 0, -42, def, iconSize);
    } else {
      cell.add(addArtifactIcon(scene, 6, -34, def, iconSize).setTint(0x120a06).setAlpha(0.38));
      icon = addArtifactIcon(scene, 0, -42, def, iconSize);
    }
    cell.add(icon);
    scene.tweens.add({ targets: icon, y: -50, duration: 1500 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // WHICH KIND OF THING THIS IS, above the goods. The shelf can hold either.
    // Clear of the icon at the TOP of its float (icon centre -50, half-height
    // iconSize/2), not merely clear of it at rest.
    cell.add(typeRibbon(scene, 0, -(iconSize * 0.5 + 68), item.kind, rar.color));

    const nameText = scene.add.text(0, iconSize * 0.46 + 26, def.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: defs.length <= 3 ? '26px' : '22px',
      color: '#' + rar.color.toString(16).padStart(6, '0'), stroke: '#120a10', strokeThickness: 6,
      wordWrap: { width: gap - 60 }, align: 'center',
    }).setOrigin(0.5, 0);
    if (rar.rainbow) rainbowText(scene, nameText);
    cell.add(nameText);
    // A bottle says so under its name. On a shelf that can hold either, "POTION"
    // is the word that tells you this one is spent the first time you drink it.
    cell.add(scene.add.text(0, iconSize * 0.46 + 26 + (defs.length <= 3 ? 32 : 28),
      isPotion ? `${rar.label} POTION` : rar.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: defs.length <= 3 ? '17px' : '15px',
        color: '#' + rar.color.toString(16).padStart(6, '0'), stroke: '#120a10', strokeThickness: 4,
      }).setOrigin(0.5, 0).setAlpha(0.85));
    const hit = scene.add.rectangle(0, -20, gap - 40, iconSize * 1.7, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true });
    cell.add(hit);
    hit.on('pointerover', () => {
      if (taken) return;
      sfx(scene, 'card_hover', { volume: 0.38, jitter: 0.08 });
      scene.tweens.add({ targets: cell, scale: 1.08, duration: 110 });
      killTip();
      tip = miniTip(scene, xs[i], shelfY + 290, `${def.name}  ·  ${rar.label}`,
        isPotion ? potionTipBody(def, beltFull) : artifactTipBody(def, { own: false }),
        rar.color, !!rar.rainbow);
      tip.setDepth((ov.depth ?? OV_DEPTH) + 8);
      tip.y = shelfY + 290;
    });
    hit.on('pointerout', () => {
      if (taken) return;
      scene.tweens.add({ targets: cell, scale: 1, duration: 110 });
      killTip();
    });
    const commit = () => {
      if (taken) return;
      // A FULL belt no longer refuses the pick here (JC, 2026-08-04): the
      // ceremony downstream stages the trade-a-bottle-or-never-mind flow.
      taken = true;
      killTip();
      sfx(scene, 'take', { volume: 0.9 });
      // The others let go of it: they dim and sink while the pick flares.
      for (const other of cells) if (other !== cell) {
        scene.tweens.add({ targets: other, alpha: 0, y: other.y + 30, scale: 0.9, duration: 260 });
      }
      shelfBurst(scene, xs[i], shelfY - 20, rar.color);
      scene.tweens.add({ targets: cell, scale: 1.18, duration: 220, ease: 'Back.easeOut' });
      scene.time.delayedCall(360, () => {
        ov.destroy(true);
        // The riser already ran for the shelf; the ceremony just presents it.
        if (isPotion) potionCeremony(scene, run, def, done);
        else artifactCeremony(scene, run, def, done, { noRiser: true });
      });
    };
    // TWO TAPS. The pick-1-of-3 shelf is the archetype: three unfamiliar
    // silhouettes on pedestals, every word of what they do behind a hover, and
    // the pick is final. The box carries the same body the tooltip does, and
    // TAKE IT is the only thing on the shelf that commits. TAKE NOTHING /
    // TOUCH NOTHING keep their single tap — they already say what they do.
    if (TOUCH) {
      twoTap(scene, hit, {
        key: `shelf:${i}`,
        anchor: hitAnchor(hit),
        title: `${def.name}  ·  ${rar.label}`,
        body: () => (isPotion ? potionTipBody(def, beltFull) : artifactTipBody(def, { own: false })),
        accent: rar.color,
        depth: (ov.depth ?? OV_DEPTH) + 10,
        owner: ov,
        buttons: [{ label: 'TAKE IT', kind: 'take', onClick: commit }],
        // Once something IS taken the shelf is mid-ceremony: the other two are
        // already fading and there is nothing left to read.
        guard: () => !taken,
        onOpen: killTip,
      });
    } else {
      hit.on('pointerdown', commit);
    }

    stage.add(cell);
    cells.push(cell);
    shelfEntries.push({ obj: hit, id: def.id ?? null, label: def.name ?? null });
    scene.tweens.add({
      targets: cell, alpha: 1, y: shelfY, duration: 380, delay: 240 + i * stagger, ease: 'Back.easeOut',
      onStart: () => sfx(scene, 'card_deal', { volume: 0.5, rate: 1 + i * 0.06 }),
    });
  });
  publishShelf(scene, ov, 'relicShelf', shelfEntries);

  // Declining is a real option (TAKE NOTHING, the Bounty Hunter's precedent).
  button(scene, ov, GAME_W / 2, GAME_H - 62, skipLabel, () => {
    if (taken) return;
    taken = true;
    killTip(); ov.destroy(true); done();
  }, { key: 'btn_dark', color: '#a898c4', w: 280, h: 56 });
  viewDeckButton(scene, ov, run);

  if (curtain) {
    // THE CURATOR'S CASE: two panels of velvet drawn back off the glass, then
    // the pedestals light one at a time.
    const half = GAME_W / 2;
    const drape = (x, dir) => {
      const c = scene.add.container(x, GAME_H / 2);
      c.add(scene.add.rectangle(0, 0, half, GAME_H, 0x2a0e18));
      c.add(scene.add.rectangle(dir * (half / 2 - 5), 0, 10, GAME_H, accent).setAlpha(0.85));
      for (let k = 0; k < 7; k++) {
        c.add(scene.add.rectangle(-half / 2 + 40 + k * (half / 7), 0, 12, GAME_H, 0x140509).setAlpha(0.5));
      }
      return c;
    };
    const left = drape(half / 2, 1);
    const right = drape(half + half / 2, -1);
    ov.add([left, right]);
    if (openSfx) sfx(scene, openSfx, { volume: 0.9 });
    scene.tweens.add({ targets: stage, alpha: 1, duration: 700, delay: 260 });
    scene.tweens.add({ targets: left, x: -half / 2, duration: 900, ease: 'Cubic.easeInOut' });
    scene.tweens.add({
      targets: right, x: GAME_W + half / 2, duration: 900, ease: 'Cubic.easeInOut',
      onComplete: () => { left.destroy(true); right.destroy(true); },
    });
    scene.cameras.main.shake(700, 0.0018);
    if (settleSfx) {
      scene.time.delayedCall(400 + defs.length * stagger, () => sfx(scene, settleSfx, { volume: 0.45 }));
    }
  } else if (openSfx) {
    sfx(scene, openSfx, { volume: 0.8 });
  }
  return ov;
}

/**
 * The bottle's version of artifactTipBody: the rules, when it can be drunk, and
 * the refusal if there is nowhere on the belt to put it.
 */
export function potionTipBody(def, beltFull = false) {
  let out = personalize(def?.desc ?? '');
  out += def?.use === 'passive'
    ? '\n\nWorks from the belt. No drinking required.'
    : potionUsableIn(def, 'map')
      ? '\n\nDrinkable anywhere, including out on the map.'
      : '\n\nDrinkable in a fight.';
  if (beltFull) out += `\nYour belt is FULL (${MAX_POTIONS} max). Taking this trades out a bottle you already carry.`;
  return out;
}

/**
 * A bottle's arrival, staged in the same language artifactCeremony uses for a
 * relic: the rarity glow, a plaque, the name and the rules, TAKE IT / LEAVE IT.
 * Shorter on purpose — a potion is spent the first time it matters, so it never
 * earns the riser. A FULL belt gets the replace-a-relic flow restaged for
 * bottles (JC, 2026-08-04): trade one out, or never mind.
 */
export function potionCeremony(scene, run, def, done) {
  const rar = POTION_RARITY[def.rarity] ?? POTION_RARITY.common;
  const rarCss = '#' + rar.color.toString(16).padStart(6, '0');
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 1);
  ov.add(dimmer(scene, 0.85));

  const glow = scene.add.image(GAME_W / 2, GAME_H / 2 - 60, 'fx_glow_circle')
    .setTint(rar.color).setScale(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8);
  ov.add(glow);
  scene.tweens.add({ targets: glow, scale: 1.8, duration: 600, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: glow, alpha: 0.45, duration: 1400, yoyo: true, repeat: -1, delay: 600 });

  const card = scene.add.container(GAME_W / 2, GAME_H / 2 - 40).setScale(0);
  const parts = woodPanel(scene, 0, 0, 420, 470, { accent: rar.color });
  card.add([parts.shadow, parts.panel, parts.line]);
  card.add(scene.add.text(0, -196, `${rar.label} POTION`, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: rarCss, stroke: '#38220f', strokeThickness: 4,
  }).setOrigin(0.5));
  const icon = addPotionIcon(scene, 0, -104, def, 150);
  card.add(icon);
  scene.tweens.add({ targets: icon, y: -110, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  card.add(scene.add.text(0, -18, def.name, {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '35px', color: PARCH.text,
    wordWrap: { width: 370 }, align: 'center',
  }).setOrigin(0.5));
  card.add(scene.add.text(0, 92, potionTipBody(def), {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '22px', color: PARCH.text, fontStyle: 'bold',
    wordWrap: { width: 360 }, align: 'center',
  }).setOrigin(0.5));
  ov.add(card);
  scene.tweens.add({ targets: card, scale: 1, duration: 420, ease: 'Back.easeOut' });
  sfx(scene, 'take', { volume: 0.85 });

  const full = (run.potions?.length ?? 0) >= MAX_POTIONS;
  if (!full) {
    button(scene, ov, GAME_W / 2, GAME_H / 2 + 240, 'TAKE IT', () => {
      sfx(scene, 'take', { volume: 0.9 });
      // Re-checked here: an overlay that took a detour (a deck view, a scene
      // restart) must never overfill the belt.
      if ((run.potions?.length ?? 0) < MAX_POTIONS) run.potions.push({ ...def });
      ov.destroy(true);
      done();
    });
    button(scene, ov, GAME_W / 2, GAME_H / 2 + 318, 'LEAVE IT', () => {
      ov.destroy(true);
      done();
    }, { key: 'btn_dark', color: '#cfc8e8', w: 240, h: 56 });
  } else {
    // THE BOTTLE TRADE (JC, 2026-08-04: "potions offered after elite rounds
    // should be takeable even if your belt is full and work like taking an
    // artifact where it just lets you choose what to sub out or nevermind").
    // The replace-a-relic flow, restaged for the belt: your bottles in a row,
    // read one (hover on desktop, a first tap on touch), then say which leaves.
    // It is DISCARDED, not drunk — trading a bottle away must never fire its
    // effect.
    ov.add(legible(scene.add.text(GAME_W / 2, GAME_H / 2 + 205, 'Your belt is FULL. Trade a bottle for it?', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '23px', color: '#ffd23e', fontStyle: 'bold',
    })).setOrigin(0.5));
    ov.add(legible(scene.add.text(GAME_W / 2, GAME_H / 2 + 236,
      say('hover a bottle to read it, click to swap it out',
        'tap a bottle to read it, then TRADE IT'), {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: '#d8c9a8', fontStyle: 'bold',
    })).setOrigin(0.5));
    const xs0 = GAME_W / 2 - ((run.potions.length - 1) / 2) * 96;
    let tip = null;
    const killTip = () => { if (tip) { tip.destroy(true); tip = null; } };
    run.potions.forEach((owned, i) => {
      const sx = xs0 + i * 96;
      const oRar = POTION_RARITY[owned.rarity] ?? POTION_RARITY.common;
      const slot = scene.add.container(sx, GAME_H / 2 + 300);
      const box = scene.add.rectangle(0, 0, 80, 80, 0xdcc492).setStrokeStyle(4, oRar.color);
      slot.add(box);
      slot.add(addPotionIcon(scene, 0, 0, owned, 62));
      ov.add(slot);
      box.setInteractive({ useHandCursor: true });
      box.on('pointerover', () => {
        box.setFillStyle(0xf6e8c8);
        sfx(scene, 'card_hover', { volume: 0.3, jitter: 0.08 });
        killTip();
        tip = miniTip(scene, sx, GAME_H / 2 + 214, `${owned.name}  ·  ${oRar.label}`,
          potionTipBody(owned), oRar.color, false);
        tip.setDepth((ov.depth ?? OV_DEPTH) + 4);
      });
      box.on('pointerout', () => { box.setFillStyle(0xdcc492); killTip(); });
      const commit = () => {
        // BY IDENTITY, not by the captured `i` — the same trap the relic
        // replace flow carries, and here it was live even on desktop: a bottle
        // drunk from the belt while this overlay is up (or a two-tap box
        // standing between the read and the trade) reindexes run.potions under
        // a closure that still remembers slot 3. A bottle already gone is a
        // no-op; a bottle still there is spliced out by its own position.
        const at = run.potions.indexOf(owned);
        if (at < 0) return;
        run.potions.splice(at, 1);
        run.potions.push({ ...def });
        sfx(scene, 'take', { volume: 0.9 });
        killTip();
        ov.destroy(true);
        done();
      };
      // TWO TAPS. Trading a bottle DISCARDS it — it is not drunk, its effect
      // never fires — so the box names the bottle, prints its rules, and says
      // out loud that the trade spends it for nothing.
      if (TOUCH) {
        twoTap(scene, box, {
          key: `tradeBottle:${i}:${owned.id}`,
          anchor: hitAnchor(box),
          title: `${owned.name}  ·  ${oRar.label}`,
          body: () => potionTipBody(owned),
          note: 'Trading it pours it out. It is not drunk.',
          accent: oRar.color,
          depth: (ov.depth ?? OV_DEPTH) + 10,
          owner: ov,
          buttons: [{ label: 'TRADE IT', kind: 'danger', onClick: commit }],
          onOpen: killTip,
        });
      } else {
        box.on('pointerdown', commit);
      }
    });
    // Decline outright: nothing taken, nothing lost off the belt.
    button(scene, ov, GAME_W / 2, GAME_H / 2 + 406, 'NEVER MIND', () => { killTip(); ov.destroy(true); done(); },
      { key: 'btn_dark', color: '#cfc8e8' });
    ov.once('destroy', killTip);
  }
  viewDeckButton(scene, ov, run);
  return ov;
}

/**
 * ELITE SPOILS — an elite kill drops THREE things and you take one (or none).
 * Since PATCH 0803 those three come off ONE mixed pool of relics and potions,
 * with at least one artifact guaranteed among them (core/elites.rollEliteSpoils
 * owns that rule; this overlay only has to draw whatever turned up).
 *
 * A FORGED elite is announced as such, in its own red, because what it is paying
 * out is not the ordinary shelf: RARE or better (FORGED_FLOOR), relics only.
 */
export function eliteChoiceOverlay(scene, run, defs, done, { forged = false } = {}) {
  const count = defs.length > 1 ? (defs.length === 3 ? 'Three' : defs.length) : null;
  const floor = FORGED_FLOOR_LABEL.toLowerCase();
  const open = () => relicChoiceOverlay(scene, run, defs, {
    title: forged ? 'FORGED SPOILS' : 'ELITE SPOILS',
    subtitle: forged
      ? (count ? `${count} relics, ${floor} or better. Take ONE.` : `One relic, ${floor} or better.`)
      : (count ? `${count} things off the body. Take ONE.` : 'One thing off the body.'),
    accent: forged ? 0xff5a2a : 0xffc542, skipLabel: 'TAKE NOTHING', stagger: 130,
  }, done);
  rarityRiser(scene, bestRarity(defs), open);
}

/**
 * THE CURATOR'S CASE — three relics under glass, free, take one. Its own
 * ceremony: velvet drawn back (chest_open), pedestals lighting in sequence, and
 * a low legendary_appears as the last one settles. suspense() is deliberately
 * NOT used here: the pack table already fired a sting seconds earlier and the
 * 6s cooldown would eat it at random, which is worse than not having it.
 */
export function curatorOverlay(scene, run, done) {
  const defs = rollCuratorRelics(run, CURATOR_RELICS);
  if (!defs.length) {
    gainGold(200);
    popMessage(scene, GAME_W / 2, GAME_H / 2, 'The case is bare. +200 chips.', { color: '#ffd23e', size: 30, rise: 60 });
    return scene.time.delayedCall(1200, done);
  }
  const open = () => relicChoiceOverlay(scene, run, defs, {
    title: 'THE CURATOR', subtitle: 'Three relics under glass. Take exactly ONE.',
    accent: 0xc9a24a, skipLabel: 'TOUCH NOTHING',
    curtain: true, openSfx: 'chest_open', settleSfx: 'legendary_appears', stagger: 170,
  }, done);
  rarityRiser(scene, bestRarity(defs), open);
}

// ---------------------------------------------------------------------------
// Pack offer → open → pick
// ---------------------------------------------------------------------------

/**
 * Offer 3 packs; the player opens one; done() when everything resolves.
 *
 * THE COVERS ARE GATED, THE CARDS ARE NOT (2026-08-06). This shelf draws three
 * of the eight painted wrappers and nothing else, and all eight together are
 * only 15.8 MB — MapScene prefetches them the moment its board stands, so this
 * gate is satisfied before a fight has even been picked. The OPTION CARDS behind
 * each wrapper are the expensive half (110 MB for all seventy-two) and belong to
 * whichever pack is actually torn open; they are fetched at pointerdown and
 * waited for by packOpenOverlay, behind the ~700ms the tear takes.
 */
export function packOfferOverlay(scene, run, offer, done) {
  return gateOn(scene, packCovers(offer.map(p => p.kind)),
    () => buildPackOffer(scene, run, offer, done),
    { label: 'The pack table', ensure, missingKeys });
}

function buildPackOffer(scene, run, offer, done) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH);
  ov.add(dimmer(scene, 0.82));
  ov.add(bigTitle(scene, 170, 'CHOOSE A PACK'));
  ov.add(scene.add.text(GAME_W / 2, 228, 'One pack. One prize inside.', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '25px', color: '#d8c9a8', fontStyle: 'bold',
  }).setOrigin(0.5));

  const xs = offer.map((_, i) => GAME_W / 2 + (i - (offer.length - 1) / 2) * 400);
  const boxes = [];
  const shelfEntries = [];
  offer.forEach((pack, i) => {
    const box = scene.add.container(xs[i], 540);
    const isForge = pack.kind === 'forge';
    const isRare = isForge || pack.kind === 'curator';
    if (isRare) {
      // The two rare wrappers announce themselves through the paper — the
      // Forge in ember red, the Curator in old museum gold.
      const fg = scene.add.image(0, -40, 'fx_glow').setTint(isForge ? 0xe03040 : 0xc9a24a)
        .setAlpha(0.35).setScale(2.6).setBlendMode(Phaser.BlendModes.ADD);
      box.add(fg);
      scene.tweens.add({ targets: fg, alpha: 0.65, duration: 700, yoyo: true, repeat: -1 });
    }
    // Caleb's pack cover IS the panel now. Sized ASPECT-SAFE (see fitWrap), and
    // every cover ships on the same 720x720 canvas so they all stand the same
    // height on this shelf.
    const shadow = fitWrap(scene.add.image(10, -30, 'pack_' + pack.kind), 330).setTint(0x000000).setAlpha(0.4);
    const cover = fitWrap(scene.add.image(0, -42, 'pack_' + pack.kind), 330);
    box.add(shadow); box.add(cover);
    scene.tweens.add({ targets: cover, y: -50, duration: 1600 + i * 220, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    box.add(scene.add.text(0, 156, pack.label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '33px',
      color: '#' + pack.color.toString(16).padStart(6, '0'), stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5));
    // The blurb wears the same outline its label does. A rare pack lights an
    // additive glow behind this whole column, and cream-on-bloom is unreadable.
    box.add(legible(scene.add.text(0, 212, pack.blurb, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: '#e8dcc0', fontStyle: 'bold',
      wordWrap: { width: 320 }, align: 'center',
    })).setOrigin(0.5));
    ov.add(box);

    cover.setInteractive({ useHandCursor: true });
    cover.on('pointerover', () => {
      sfx(scene, 'menu_select', { volume: 0.3, jitter: 0.06 });
      scene.tweens.add({ targets: box, scale: 1.06, angle: isRare ? 1.5 : 0.8, duration: 120 });
    });
    cover.on('pointerout', () => scene.tweens.add({ targets: box, scale: 1, angle: 0, duration: 120 }));
    const commit = () => {
      cover.disableInteractive();
      // THE OPEN IS THE LOAD WINDOW. From here to packOpenOverlay is 280ms of
      // slide, a burst, and a 420ms hold — comfortably enough for this ONE
      // kind's option cards (nine to eleven paintings), and the only kind that
      // will ever be resident. packOpenOverlay gates on the same keys, so a slow
      // fetch costs a beat rather than a shelf of missing textures.
      ensure(scene, packCards([pack.kind]));
      for (const other of boxes) if (other !== box) {
        scene.tweens.add({ targets: other, alpha: 0, scale: 0.9, duration: 180 });
      }
      // The open: pack slides center, strains, and bursts in its own style.
      scene.tweens.add({
        targets: box, x: GAME_W / 2, y: 520, scale: 1.24, duration: 280, ease: 'Back.easeIn',
        onComplete: () => {
          packOpenFx(scene, pack.kind);
          scene.tweens.add({ targets: box, angle: { from: -3, to: 3 }, duration: 55, yoyo: true, repeat: 3 });
          scene.time.delayedCall(420, () => {
            packOpenBurst(scene, GAME_W / 2, 480, pack.kind);
            ov.destroy(true);
            // THE CURATOR holds no options — he holds a CASE. He skips the
            // pack-contents shelf entirely for his own reveal.
            if (pack.kind === 'curator') return curatorOverlay(scene, run, done);
            const extra = getProp(effectiveArtifacts(), 'packExtra');
            const { pack: p, options } = openPack(pack.kind, run, extra);
            packOpenOverlay(scene, run, p, options, done);
          });
        },
      });
    };
    // TWO TAPS. The label and the blurb are already printed under the wrap, so
    // the box mostly restates them — but it is the CHOOSE button that matters
    // here: this shelf's covers are 330px of painted paper on a three-across
    // row, tearing one open is irreversible, and it is the very first thing a
    // thumb meets after a fight. SKIP PACKS keeps its single tap.
    if (TOUCH) {
      twoTap(scene, cover, {
        key: `pack:${pack.kind}`,
        anchor: hitAnchor(cover),
        title: pack.label,
        body: pack.blurb,
        accent: pack.color,
        depth: (ov.depth ?? OV_DEPTH) + 10,
        owner: ov,
        buttons: [{ label: 'CHOOSE', kind: 'take', onClick: commit }],
      });
    } else {
      cover.on('pointerdown', commit);
    }
    boxes.push(box);
    shelfEntries.push({ obj: cover, id: pack.kind, label: pack.label });
  });
  publishShelf(scene, ov, 'packOffer', shelfEntries);

  // Not feeling any of them? Walk away.
  button(scene, ov, GAME_W / 2, GAME_H - 62, 'SKIP PACKS', () => { ov.destroy(true); done(); },
    { key: 'btn_dark', color: '#a898c4', w: 250, h: 56 });
  // Which pack helps THIS deck? Check before you commit (JC).
  viewDeckButton(scene, ov, run);
  return ov;
}

// ---------------------------------------------------------------------------
// THE BOUNTY HUNTER — the act-boss payoff pack
// ---------------------------------------------------------------------------

/**
 * Awarded, never chosen: the board is already nailed up when you arrive, so it
 * plays the SUSPENSE sting, hangs there long enough to land, then tears open
 * into a normal pack-contents overlay. `subtitle` names the act you just cleared.
 */
export function bountyPackOverlay(scene, run, { subtitle = '' } = {}, done) {
  // HIS ELEVEN REWARDS, FETCHED UNDER HIS OWN REVEAL. The board hangs there for
  // 2.2 seconds of suspense before it tears into a contents shelf, which is the
  // longest load window any pack in the game offers — and unlike the pack table
  // there is no cover to CLICK, so nothing else would start the fetch.
  // packOpenOverlay gates on the same keys, so a slow one costs a beat.
  ensure(scene, packCards(['bounty']));
  // The wrap is the first thing on screen and it is `pack_bounty` — deferred art
  // since 2026-08-06. MapScene prefetches all eight covers on arrival, so this
  // gate is normally already satisfied; it is here for the road that skips the
  // map (a CONTINUE straight into a boss fight, then the act-clear ceremony).
  return gateOn(scene, packCovers(['bounty']),
    () => buildBountyPack(scene, run, { subtitle }, done),
    { label: 'The Bounty Hunter', ensure, missingKeys });
}

function buildBountyPack(scene, run, { subtitle = '' } = {}, done) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 2);
  ov.add(dimmer(scene, 0.88));
  suspense(scene, { volume: 0.85 });

  const cx = GAME_W / 2, cy = GAME_H / 2 + 20;
  const glow = scene.add.image(cx, cy, 'fx_glow_circle')
    .setTint(0x6ad07a).setScale(0.3).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD);
  ov.add(glow);
  scene.tweens.add({ targets: glow, scale: 3.1, alpha: 0.5, duration: 1300, ease: 'Sine.easeOut' });

  ov.add(bigTitle(scene, 178, 'THE BOUNTY HUNTER', '#ffd23e'));
  // Pale green on a green additive bloom. Its sibling line ("COLLECTING...")
  // was already stroked; this one was not.
  ov.add(legible(scene.add.text(cx, 244, subtitle || 'A boss is worth something to somebody.', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '26px', color: '#8fe098', fontStyle: 'bold',
  })).setOrigin(0.5));

  // Caleb's gold wrap, in the same language as the pack table's covers: a
  // black cast copy behind it, a pool of shadow beneath, a slow float.
  const COVER = 500;
  const wrap = scene.add.container(cx, cy).setScale(0);
  wrap.add(contactPool(scene, 4, COVER * 0.5, COVER * 0.82, { alpha: 0.45 }));
  wrap.add(fitWrap(scene.add.image(12, 10, 'pack_bounty'), COVER).setTint(0x000000).setAlpha(0.42));
  const cover = fitWrap(scene.add.image(0, 0, 'pack_bounty'), COVER);
  wrap.add(cover);
  ov.add(wrap);
  scene.tweens.add({
    targets: wrap, scale: 1, duration: 520, ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({ targets: cover, y: -14, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      scene.tweens.add({ targets: wrap, angle: { from: -1.8, to: 1.8 }, duration: 820, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    },
  });
  scene.cameras.main.shake(900, 0.002);

  ov.add(scene.add.text(cx, GAME_H - 96, 'COLLECTING...', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#d8c9a8',
    stroke: '#241505', strokeThickness: 5,
  }).setOrigin(0.5).setAlpha(0.9));

  // The tear: the wrap strains, then bursts (the pack-table open, restaged).
  scene.time.delayedCall(1300, () => {
    scene.tweens.killTweensOf(wrap);
    scene.tweens.add({ targets: wrap, angle: { from: -4, to: 4 }, duration: 55, yoyo: true, repeat: 3 });
    scene.tweens.add({ targets: wrap, scale: 1.16, duration: 340, ease: 'Back.easeIn' });
  });
  scene.time.delayedCall(1650, () => {
    sfx(scene, 'pack_open_dealer', { volume: 0.95 });
    packOpenBurst(scene, cx, cy, 'bounty');
    scene.cameras.main.flash(180, 90, 70, 20);
    ov.destroy(true);
    const extra = getProp(effectiveArtifacts(), 'packExtra');
    // DEV / drivers: `run.debugBounty = ['bounty-merchant']` pins THIS shelf,
    // once, exactly the way run.debugEncounter pins a line-up. Consumed on read
    // so the next act's bounty is a real roll again.
    const forced = run.debugBounty;
    run.debugBounty = null;
    const options = forced?.length
      ? bountyRewardsById(run, forced)
      : rollBountyRewards(run, 3 + extra);
    packOpenOverlay(scene, run, PACK_TYPES.bounty, options, done);
  });
  return ov;
}

// ---------------------------------------------------------------------------
// THE ORACLE — the start-of-run pack
// ---------------------------------------------------------------------------

/** The Oracle's violet, in the three forms the reveal needs it. */
const ORACLE_TINT = 0x9a5cff;
const ORACLE_TINT_PALE = 0xd8b0ff;

/**
 * Opened ONCE, on arrival at the first map. Awarded rather than drafted (like
 * the Bounty Hunter's board), but staged in its own language: no tearing, no
 * coins, no camera kick. The dark goes violet, motes drift UP through it, the
 * wrap turns slowly in the air, and then it simply DISSOLVES into three cards.
 *
 * The shelf underneath is a normal pack-contents overlay with one difference:
 * `mandatory`, so there is no TAKE NOTHING. You must choose a future.
 */
export function oraclePackOverlay(scene, run, done) {
  // ...and hers, for the same reason: 2.2s of reveal in front of a twenty-card
  // shelf. mapPrefetch has been fetching them since the board stood, so this is
  // belt-and-braces for the door that skips the map (`__hf.openOracle`).
  ensure(scene, packCards(['oracle']));
  // Her wrap is `pack_oracle` and it turns in the air for 1.7s before the shelf
  // exists, so the COVER has to be here and the twenty cards behind it do not
  // (packOpenOverlay gates those, and mapPrefetch has been fetching them since
  // the board stood).
  return gateOn(scene, packCovers(['oracle']),
    () => buildOraclePack(scene, run, done),
    { label: 'The Oracle', ensure, missingKeys });
}

function buildOraclePack(scene, run, done) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 2);
  ov.add(dimmer(scene, 0.9));
  suspense(scene, { volume: 0.8 });

  const cx = GAME_W / 2, cy = GAME_H / 2 + 20;
  // Two glows, breathing out of step, so the light behind her never settles.
  const glow = scene.add.image(cx, cy, 'fx_glow_circle')
    .setTint(ORACLE_TINT).setScale(0.3).setAlpha(0.26).setBlendMode(Phaser.BlendModes.ADD);
  const halo = scene.add.image(cx, cy, 'fx_glow_circle')
    .setTint(ORACLE_TINT_PALE).setScale(0.2).setAlpha(0.18).setBlendMode(Phaser.BlendModes.ADD);
  ov.add(glow); ov.add(halo);
  scene.tweens.add({ targets: glow, scale: 3.2, alpha: 0.46, duration: 1500, ease: 'Sine.easeOut' });
  scene.tweens.add({ targets: halo, scale: 2.1, alpha: 0.34, duration: 2100, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

  ov.add(bigTitle(scene, 168, 'THE ORACLE', '#c9a2ff'));
  // Pale violet on a violet bloom: stroked, like every other line that sits on
  // an additive glow in this file.
  ov.add(legible(scene.add.text(cx, 234, 'She saw this run before you walked it.', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '26px', color: '#d8c9f4', fontStyle: 'bold',
  })).setOrigin(0.5));

  // ETHEREAL DRIFT: slow motes rising through the whole frame for as long as the
  // wrap hangs there. Parented to a timer the overlay owns, so it stops dead
  // when the overlay goes.
  const motes = scene.time.addEvent({
    delay: 90, repeat: 18,
    callback: () => {
      const p = scene.add.image(Phaser.Math.Between(cx - 420, cx + 420), GAME_H - 40, 'fx_dust')
        .setDepth(OV_DEPTH + 3).setTint(Phaser.Math.RND.pick([ORACLE_TINT, ORACLE_TINT_PALE]))
        .setAlpha(0).setScale(Phaser.Math.FloatBetween(0.08, 0.2))
        .setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: p, y: p.y - Phaser.Math.Between(560, 900), alpha: { from: 0.7, to: 0 },
        x: p.x + Phaser.Math.Between(-70, 70),
        duration: Phaser.Math.Between(1500, 2600), ease: 'Sine.easeOut',
        onComplete: () => p.destroy(),
      });
    },
  });
  ov.once('destroy', () => motes.remove(false));

  // Caleb's wrap, in the pack-table language: a cast copy behind it, a pool of
  // shadow beneath, and a slow turn rather than the bounty's impatient rock.
  const COVER = 480;
  const wrap = scene.add.container(cx, cy).setScale(0).setAlpha(0);
  wrap.add(contactPool(scene, 4, COVER * 0.5, COVER * 0.8, { alpha: 0.4, tint: 0x1a0e2a }));
  wrap.add(fitWrap(scene.add.image(12, 12, 'pack_oracle'), COVER).setTint(0x000000).setAlpha(0.4));
  const cover = fitWrap(scene.add.image(0, 0, 'pack_oracle'), COVER);
  wrap.add(cover);
  ov.add(wrap);
  scene.tweens.add({
    targets: wrap, scale: 1, alpha: 1, duration: 700, ease: 'Back.easeOut',
    onComplete: () => {
      scene.tweens.add({ targets: cover, y: -16, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      scene.tweens.add({ targets: wrap, angle: { from: -1.4, to: 1.4 }, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    },
  });

  ov.add(scene.add.text(cx, GAME_H - 96, 'READING YOUR RUN...', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#cfc0ea',
    stroke: '#1d0f30', strokeThickness: 5,
  }).setOrigin(0.5).setAlpha(0.9));

  // It does not tear. It brightens until there is nothing left of it.
  scene.time.delayedCall(1700, () => {
    scene.tweens.killTweensOf(wrap);
    scene.tweens.killTweensOf(cover);
    scene.tweens.add({ targets: wrap, scale: 1.3, alpha: 0, angle: 6, duration: 620, ease: 'Sine.easeIn' });
  });
  scene.time.delayedCall(2200, () => {
    sfx(scene, 'pack_open_witch', { volume: 0.9 });
    packOpenBurst(scene, cx, cy, 'oracle');
    scene.cameras.main.flash(300, 90, 50, 150);
    ov.destroy(true);
    const options = rollOracleOffer(run, ORACLE_OFFER_SIZE);
    packOpenOverlay(scene, run, PACK_TYPES.oracle, options, done, {
      mandatory: true,
      subtitle: 'Three futures. You MUST take one.',
    });
  });
  return ov;
}

/**
 * Per-pack opening SOUND — Caleb's full custom set (2026-07-29). The Curator
 * has no wav of his own yet, so his wrap comes off on `chest_open`, which is
 * exactly the noise a display case makes (and the Curator's case reveal picks
 * it up again a beat later).
 */
function packOpenFx(scene, kind) {
  if (kind === 'curator') return sfx(scene, 'chest_open', { volume: 0.85 });
  sfx(scene, 'pack_open_' + (kind in PACK_OPEN_KINDS ? kind : 'artisan'), { volume: 0.9 });
}
const PACK_OPEN_KINDS = { witch: 1, smith: 1, artisan: 1, dealer: 1, forge: 1 };

/** Per-pack opening PARTICLES — each theme tears open its own way. */
function packOpenBurst(scene, x, y, kind) {
  const spawn = (key, tint, count, spread, scaleLo, scaleHi, gravity = 0) => {
    for (let i = 0; i < count; i++) {
      const p = scene.add.image(x, y, key).setDepth(OV_DEPTH + 4)
        .setTint(tint).setBlendMode(key === 'card_face' ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD)
        .setScale(Phaser.Math.FloatBetween(scaleLo, scaleHi));
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.Between(spread * 0.4, spread);
      scene.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist + gravity,
        alpha: 0, angle: Phaser.Math.Between(-240, 240),
        duration: Phaser.Math.Between(420, 780), ease: 'Cubic.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  };
  if (kind === 'witch') {
    // Sorcery: purple star spiral + drifting glyph motes.
    spawn('fx_star', 0xb45cff, 14, 220, 0.15, 0.3);
    spawn('fx_dust', 0x8a5cd0, 10, 160, 0.1, 0.2);
    spawn('icon_magic', 0xd8b0ff, 4, 140, 0.12, 0.18);
  } else if (kind === 'smith') {
    // Anvil ring: hot sparks fly high and fall.
    spawn('fx_star', 0xffb040, 16, 240, 0.1, 0.22, 60);
    spawn('fx_dust', 0xff7028, 8, 140, 0.08, 0.16, 40);
    shakeCam(scene, 0.003, 160);
  } else if (kind === 'artisan') {
    // Craft: little card slips flutter out.
    spawn('card_face', 0xffffff, 8, 200, 0.05, 0.09, 90);
    spawn('fx_star', 0x4aa8ff, 8, 160, 0.1, 0.18);
  } else if (kind === 'dealer') {
    // Payout: coins everywhere.
    spawn('icon_coins', 0xffffff, 10, 230, 0.14, 0.22, 100);
    spawn('fx_star', 0xffd23e, 8, 160, 0.1, 0.18);
  } else if (kind === 'bounty') {
    // Payday: coins rain, gold sparks, a wash of green over the top.
    spawn('icon_coins', 0xffffff, 16, 300, 0.16, 0.26, 140);
    spawn('fx_star', 0xffd23e, 12, 220, 0.12, 0.24);
    spawn('fx_dust', 0x6ad07a, 10, 200, 0.1, 0.2, -30);
    shakeCam(scene, 0.004, 220);
  } else if (kind === 'oracle') {
    // Prophecy: violet motes and pale stars rising, slowly, out of nothing. No
    // shake and no debris — she is not opening a package, she is finishing a
    // sentence. (The flash is the caller's, so the two can be timed together.)
    spawn('fx_dust', ORACLE_TINT, 20, 300, 0.1, 0.24, -110);
    spawn('fx_star', ORACLE_TINT_PALE, 12, 240, 0.12, 0.26, -70);
    scene.time.delayedCall(180, () => spawn('fx_star', 0xffffff, 6, 180, 0.08, 0.16, -50));
  } else if (kind === 'curator') {
    // Old gold under glass: slow motes drift UP out of the case, no violence.
    spawn('fx_dust', 0xe8cf90, 14, 240, 0.1, 0.2, -70);
    spawn('fx_star', 0xc9a24a, 8, 180, 0.1, 0.2, -40);
    scene.cameras.main.flash(240, 60, 50, 24);
  } else if (kind === 'forge') {
    // The old fire: two waves of embers + a flash and a kick.
    spawn('fx_dust', 0xff3020, 18, 260, 0.12, 0.26, -40);
    scene.time.delayedCall(140, () => spawn('fx_star', 0xff8c28, 12, 200, 0.12, 0.24, -60));
    scene.cameras.main.flash(160, 90, 30, 10);
    shakeCam(scene, 0.006, 260);
  }
}

function shakeCam(scene, intensity, dur) {
  scene.cameras.main.shake(dur, intensity);
}

/**
 * RE-FORGE picker: choose one of your relics to duplicate. The copy is struck
 * from the INSTANCE (acquireArtifact clones its state), so grown scalers keep
 * their growth. Mirror chains already follow Balatro rules: resolution walks
 * indices, so a Forgery pointing at another Forgery reads through it to the
 * relic two slots down.
 */
export function artifactPickerOverlay(scene, run, { title = 'RE-FORGE', skipLabel = 'NEVER MIND' } = {}, cb) {
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 3);
  ov.add(dimmer(scene, 0.88));
  ov.add(bigTitle(scene, 200, title, '#e03040'));
  ov.add(scene.add.text(GAME_W / 2, 262, 'Choose a relic. The forge strikes an exact copy.', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '25px', color: '#d8c9a8', fontStyle: 'bold',
  }).setOrigin(0.5));

  const arts = run.artifacts;
  const gap = Math.min(230, 1500 / Math.max(arts.length, 1));
  const xs = arts.map((_, i) => GAME_W / 2 + (i - (arts.length - 1) / 2) * gap);
  const shelfEntries = [];
  arts.forEach((art, i) => {
    const cell = scene.add.container(xs[i], 560).setScale(0);
    const shadow = addArtifactIcon(scene, 5, 8, art, 132).setTint(0x120a06).setAlpha(0.45);
    const icon = addArtifactIcon(scene, 0, 0, art, 132);
    const rar = ARTIFACT_RARITY[art.rarity];
    cell.add([shadow, icon]);
    const nameText = scene.add.text(0, 96, art.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px',
      color: rar ? '#' + rar.color.toString(16).padStart(6, '0') : '#f0e6cc',
      stroke: '#241505', strokeThickness: 4, wordWrap: { width: 190 }, align: 'center',
    }).setOrigin(0.5, 0);
    if (rar?.rainbow) rainbowText(scene, nameText);
    cell.add(nameText);
    const hit = scene.add.rectangle(0, 30, 190, 260, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    cell.add(hit);
    hit.on('pointerover', () => { sfx(scene, 'card_hover', { volume: 0.42 }); scene.tweens.add({ targets: cell, scale: 1.12, duration: 110 }); });
    hit.on('pointerout', () => scene.tweens.add({ targets: cell, scale: 1, duration: 110 }));
    const commit = () => {
      sfx(scene, 'pack_open_forge', { volume: 0.85 });
      ov.destroy(true);
      cb(art);
    };
    // TWO TAPS, and here the box is a STRICT UPGRADE: this picker has never had
    // a tooltip at all. It draws your belt as icons and names, and asks you to
    // pick the one worth duplicating — a question you cannot answer from a name
    // if the relic is a scaler whose whole value is the number it has banked.
    // artifactTipBody carries that running total. NEVER MIND keeps its one tap.
    if (TOUCH) {
      twoTap(scene, hit, {
        key: `reforge:${i}:${art.id}`,
        anchor: hitAnchor(hit),
        title: rar ? `${art.name}  ·  ${rar.label}` : art.name,
        body: () => artifactTipBody(art),
        accent: rar?.color,
        depth: (ov.depth ?? OV_DEPTH) + 10,
        owner: ov,
        buttons: [{ label: 'CHOOSE', kind: 'take', onClick: commit }],
      });
    } else {
      hit.on('pointerdown', commit);
    }
    ov.add(cell);
    shelfEntries.push({ obj: hit, id: art.id, label: art.name });
    scene.tweens.add({ targets: cell, scale: 1, duration: 260, delay: i * 70, ease: 'Back.easeOut' });
  });
  publishShelf(scene, ov, 'reforge', shelfEntries);

  // Declining is allowed here too — cb(null) is the "I picked nothing" answer,
  // and every caller handles it (the Forge option already printed "the forge
  // cools, unchosen" for exactly this case).
  button(scene, ov, GAME_W / 2, GAME_H - 62, skipLabel, () => { ov.destroy(true); cb(null); },
    { key: 'btn_dark', color: '#a898c4', w: 260, h: 56 });
  viewDeckButton(scene, ov, run);
  return ov;
}

/**
 * THE WORN ANVIL's receipt: a little pulsing plaque pinned over the option the
 * relic guaranteed. Without it the promise is invisible — the shelf just looks
 * lucky. Reuses the relic's own icon so the connection needs no explaining.
 */
function anvilBadge(scene, x, y) {
  const badge = scene.add.container(x, y);
  const plate = scene.add.image(0, 0, 'btn_dark').setDisplaySize(196, 46);
  const icon = scene.textures.exists('art_wornAnvil')
    ? scene.add.image(-70, 0, 'art_wornAnvil')
    : scene.add.image(-70, 0, 'icon_anvil').setTint(0xd07028);
  icon.setScale(34 / Math.max(icon.width, icon.height));
  const label = scene.add.text(10, -2, 'WORN ANVIL', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: '#ffb45c',
    stroke: '#241505', strokeThickness: 4,
  }).setOrigin(0.5);
  const glow = scene.add.image(0, 0, 'fx_glow').setTint(0xff8c28)
    .setAlpha(0.28).setDisplaySize(240, 74).setBlendMode(Phaser.BlendModes.ADD);
  badge.add([glow, plate, icon, label]);
  scene.tweens.add({ targets: glow, alpha: 0.6, duration: 720, yoyo: true, repeat: -1 });
  scene.tweens.add({ targets: badge, y: y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  return badge;
}

/** The witch's classic wheel face — the default for any `ui: 'wheel'` option. */
const WITCH_WHEEL_SEGMENTS = [
  { label: 'JACKPOT', color: 0xb8862c }, { label: 'fine', color: 0x4a6a52 },
  { label: 'BUST', color: 0x5a2a34 }, { label: 'fine', color: 0x4a6a52 },
  { label: 'JACKPOT', color: 0xb8862c }, { label: 'BUST', color: 0x5a2a34 },
  { label: 'fine', color: 0x4a6a52 }, { label: 'fine', color: 0x4a6a52 },
];

/**
 * The opened pack: contents fan out; player picks one; option UIs resolve.
 *
 * `opts.mandatory` takes the TAKE NOTHING plate off the shelf entirely — THE
 * ORACLE is the one pack in the game you cannot walk away from, and a decline
 * button you are not allowed to press is worse than no button. `opts.subtitle`
 * is the line under the title, so a mandatory shelf can say so out loud.
 */
export function packOpenOverlay(scene, run, pack, options, done, opts = {}) {
  /**
   * THE ONE CHOKEPOINT FOR OPTION-CARD ART. Every painted shelf in the game
   * arrives here — the pack table's chosen wrapper, THE BOUNTY HUNTER's payoff,
   * THE ORACLE's mandatory three — and `hasArt` below is asked SYNCHRONOUSLY at
   * build time, so the cards have to be resident before this body runs or the
   * whole shelf silently falls back to icon panels. Hence a gate rather than a
   * pop-in: an option card that appears a second late has already been read.
   */
  return gateOn(scene, packCards([pack.kind]),
    () => buildPackOpen(scene, run, pack, options, done, opts),
    { label: pack.label ?? 'Opening…', ensure, missingKeys });
}

function buildPackOpen(scene, run, pack, options, done, opts = {}) {
  const { mandatory = false, subtitle = 'Take ONE' } = opts;
  const ov = scene.add.container(0, 0).setDepth(OV_DEPTH + 1);
  ov.add(dimmer(scene, 0.85));
  ov.add(bigTitle(scene, 150, pack.label, '#' + (pack.titleColor ?? pack.color).toString(16).padStart(6, '0')));
  ov.add(scene.add.text(GAME_W / 2, 208, subtitle, {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '25px', color: '#d8c9a8', fontStyle: 'bold',
  }).setOrigin(0.5));

  const isCards = pack.kind === 'artisan';
  // OPTION CARDS: the Witch / Dealer / Forge / Smith / Bounty Hunter all deal
  // painted cards whose TITLE is
  // baked into the art — so nothing is drawn on the face and the rules text
  // moves to a hover tooltip. Checked PER OPTION, so a half-delivered set mixes
  // painted cards and icon panels without anyone noticing.
  const artKey = (opt) => `packcard_${pack.kind}_${optionArtSlug(opt)}`;
  const hasArt = (opt) => scene.textures.exists(artKey(opt));
  const anyArt = options.some(hasArt);
  // ------------------------------------------------------------------
  // SAY THAT THE RULES ARE UNDER YOUR HAND (first-run audit, 2026-08-04).
  //
  // A painted shelf shows a picture and a NAME and absolutely nothing else:
  // 'Card Laundering', 'Suit Racket', 'Foolish Nature'. Every word of what they
  // actually DO lives in the hover tip. Someone who has played a hundred runs
  // knows that; someone on their first pack does not, and THE ORACLE deals this
  // shelf before the first fight of the first run has even happened — mandatory,
  // three unfamiliar futures, one of them about to be permanent.
  //
  // Every other shelf in the game already says this out loud ('hover a card to
  // read the kit', 'Hover a skin to read it'). This one was the exception.
  // Painted shelves only: an icon-panel option prints its own rules on itself.
  // ------------------------------------------------------------------
  if (anyArt) {
    ov.add(scene.add.text(GAME_W / 2, 246,
      say('hover a card to read what it does', 'tap a card to read what it does'), {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '20px', color: '#a3947a', fontStyle: 'bold',
    }).setOrigin(0.5));
  }
  // Uniform cards, so the shelf is pure arithmetic: the ideal gap, tightened
  // only when a packExtra relic deals a fourth or fifth option onto the row.
  const gap = Math.min(isCards ? 250 : anyArt ? 372 : 330, 1800 / Math.max(options.length, 1));
  const xs = options.map((_, i) => GAME_W / 2 + (i - (options.length - 1) / 2) * gap);

  const finishOption = (opt, outcome) => {
    // Directives from apply(): artifact/mythical ceremonies, nested packs, text toasts.
    const after = () => done();
    if (outcome?.mythical) return artifactCeremony(scene, run, outcome.mythical, after);
    if (outcome?.artifact) return artifactCeremony(scene, run, outcome.artifact, after);
    if (outcome?.reforge) return artifactCeremony(scene, run, outcome.reforge, after);
    // Choose-then-copy: the Bounty wheel's RE-FORGE wedge runs the same
    // picker → ceremony flow the Forge pack and the Crimson Forge use.
    if (outcome?.pickReforge) {
      return artifactPickerOverlay(scene, run, { title: 'RE-FORGE' }, (art) =>
        (art ? artifactCeremony(scene, run, art, after) : after()));
    }
    // A free trip to the merchant — the shop owns the rest of the beat
    // (its BACK TO THE TRAIL restores the fight music and refreshes the map).
    //
    // THERE IS NOT ALWAYS A TENT TO WALK INTO. `runShop` is a real method on
    // MapScene and only a transient closure on CombatScene, booked during the
    // act-clear ceremony and nulled again on the way out. THE ORACLE'S HUNTER
    // is the first thing that ever deals a BOUNTY pack from CombatScene's
    // ordinary post-fight table, where there is no closure — so THE MERCHANT
    // was a pick that silently did nothing at up to 6% of Act IV's tables.
    // `run.pendingShopVisit` is the channel that already exists for exactly
    // this ("no tent to walk into from a combat scene"): the next map opens his
    // tent on arrival, free. See MapScene.checkBounty.
    if (outcome?.shop) {
      if (typeof scene.runShop === 'function') return scene.time.delayedCall(150, () => scene.runShop());
      run.pendingShopVisit = true;
      popMessage(scene, GAME_W / 2, GAME_H / 2 - 40, 'The merchant will be waiting on the trail.',
        { color: '#ffd23e', size: 28, rise: 60 });
      return scene.time.delayedCall(1200, after);
    }
    if (outcome?.text) popMessage(scene, GAME_W / 2, GAME_H / 2 - 40, outcome.text, { color: '#ffd23e', size: 30, rise: 60 });
    scene.time.delayedCall(outcome?.text ? 1200 : 150, after);
  };

  const choose = (opt) => {
    ov.destroy(true);
    sfx(scene, 'take', { volume: 0.9 });
    if (opt.ui === 'pickArtifact') {
      artifactPickerOverlay(scene, run, { title: opt.name }, (artifact) => {
        finishOption(opt, opt.apply(run, { artifact }));
      });
    } else if (opt.ui === 'pickSuit') {
      suitPickerOverlay(scene, { title: opt.name }, (suit) => {
        finishOption(opt, opt.apply(run, { suit }));
      });
    } else if (opt.ui === 'pickCards' || opt.ui === 'pickCardsThenSuit') {
      // Pack magic never offers the whole deck — fate deals you 10 candidates.
      // (Bounty rewards opt out with sample:0, and may pre-filter the pool.)
      deckPickerOverlay(scene, run, {
        count: opt.pick ?? 1, optional: !!opt.optional, title: opt.name,
        sample: opt.sample ?? 10,
        cards: opt.cardFilter ? run.runDeck.filter(opt.cardFilter) : null,
      }, (cards) => {
        if (opt.ui === 'pickCardsThenSuit') {
          if (!cards.length) return finishOption(opt, opt.apply(run, { cards, suit: null }));
          suitPickerOverlay(scene, { title: 'Transmute into...' }, (suit) => {
            finishOption(opt, opt.apply(run, { cards, suit }));
          });
        } else {
          finishOption(opt, opt.apply(run, { cards }));
        }
      });
    } else if (opt.ui === 'wheel') {
      const outcome = opt.apply(run);
      // An option may bring its own face (the Bounty Hunter's 20-wedge Forge
      // Wheel); otherwise it gets the witch's classic 8.
      const segs = opt.segments ?? WITCH_WHEEL_SEGMENTS;
      const pools = opt.landPools ?? { jackpot: [0, 4], mid: [1, 3, 6, 7], bust: [2, 5] };
      const landPool = pools[outcome.wheel] ?? [1];
      const land = landPool[Math.floor(Math.random() * landPool.length)];
      const GOOD = { jackpot: 1, mythic: 1, reforge: 1 }, BAD = { bust: 1, nothing: 1, lose: 1 };
      wheelSpinOverlay(scene, segs, land, () => {
        sfx(scene, GOOD[outcome.wheel] ? 'general_victory' : BAD[outcome.wheel] ? 'poison' : 'chips_stack', { volume: 0.7 });
        finishOption(opt, outcome);
      }, { fontSize: opt.wheelFont ?? 25, labelFrac: opt.wheelFont ? 0.72 : 0.62 });
    } else {
      finishOption(opt, opt.apply(run, {}));
    }
  };

  /**
   * WHAT AN OPTION SAYS ABOUT ITSELF — written ONCE, read by both surfaces.
   *
   * The desktop hover tip and the touch build's description box describe the
   * same painted card, and the moment they build their own version of this
   * string they start disagreeing about whether the Worn Anvil line is there or
   * whether the shelf admits you cannot pay. So the string has one author and
   * the two surfaces are both readers.
   */
  const optionTipBody = (opt) => {
    const affordable = !opt.available || opt.available(run);
    // WHAT WILL THIS TOUCH? A fixed preview draws the actual cards; the other
    // two modes say so in one line and draw nothing (core/packs.previewFor).
    const pv = opt.preview;
    // Don't say it twice: most pickers already read "a chosen card" or "Choose
    // a card" in their own rules line, and only the ones that DON'T (the Bounty
    // Hunter's "Remove 2 cards", "Turn 3 cards WILD") need telling.
    const pvLine = pv?.mode === 'choose' && /choose|chosen/i.test(opt.desc ?? '')
      ? null : previewLabel(pv);
    return personalize(opt.desc)
      + (pvLine ? `\n${pvLine}` : '')
      + (opt.anvil ? '\nWORN ANVIL: your most-played hand is always offered.' : '')
      + (affordable ? '' : "\nYou can't pay for this one.");
  };
  /** ...and the colour it is framed in, on both surfaces, for the same reason. */
  const optionAccent = (opt) => (opt.anvil ? 0xff8c28 : opt.mythic ? 0xe03040 : pack.color);

  // ONE tooltip at a time, owned by the overlay so no hover can outlive it.
  let cardTip = null;
  const killCardTip = () => { if (cardTip) { cardTip.destroy(true); cardTip = null; } };
  const showCardTip = (opt, x, yTop) => {
    killCardTip();
    const pv = opt.preview;
    cardTip = miniTip(scene, x, yTop, opt.name.toUpperCase(),
      optionTipBody(opt), optionAccent(opt), false,
      pv?.mode === 'fixed' ? pv.cards : null);
    cardTip.setDepth((ov.depth ?? OV_DEPTH) + 8);
    // miniTip hangs UP from its anchor, which would land on the pack's title.
    // The cards leave a clear shelf under the row, so the rules live there —
    // same place every time, whichever card is hovered. A tip carrying mini
    // cards is taller, so it is pulled back up if it would run off the bottom.
    cardTip.y = Math.min(yTop, GAME_H - 12 - (cardTip.tipH ?? 0) + 17);
  };
  ov.once('destroy', killCardTip);

  const shelfEntries = [];
  options.forEach((opt, i) => {
    let hit;
    let topY = -190;               // where a badge would hang, per render style
    let tipY = 570 + 210;          // where the hover tip's top edge sits
    const box = scene.add.container(xs[i], 570).setScale(0).setAlpha(0);
    if (hasArt(opt)) {
      // The painted card IS the option — and it is the ONLY thing drawn. No
      // panel, no plate, no mat, no contact pool: just the art and the shadow
      // it casts (JC, 2026-07-31 — the backing rectangle had to go). Every
      // card in the family is 520x768 with true alpha, so there is nothing to
      // measure and no card can end up bigger than its neighbour.
      const key = artKey(opt);
      const CW = CARD_OPTION_W, CH = CARD_OPTION_H;
      topY = -CH / 2;
      const face = scene.add.image(0, 0, key).setDisplaySize(CW, CH);
      box.add(dropShadow(scene, face, { dx: 9, dy: 12, alpha: 0.36 }));
      box.add(face);
      if (opt.mythic) {
        // RE-FORGE / MYTHIC EMBER still announce themselves through the wrap.
        const fg = scene.add.image(0, 0, 'fx_glow_circle').setTint(0xe03040)
          .setAlpha(0.3).setDisplaySize(CW * 1.5, CH * 1.1).setBlendMode(Phaser.BlendModes.ADD);
        box.addAt(fg, 0);
        scene.tweens.add({ targets: fg, alpha: 0.6, duration: 760, yoyo: true, repeat: -1 });
      }
      hit = scene.add.rectangle(0, 0, CW, CH, 0xffffff, 0.001);
      box.add(hit);
      tipY = 570 + CH / 2 + 10;   // the rules shelf under the painted card
      box.once('destroy', killCardTip);
    } else if (isCards && opt.card) {
      const cs = new CardSprite(scene, 0, -40, opt.card);
      cs.setScale(1.15);
      cs.removeInteractive();
      box.add(cs);
      box.add(scene.add.text(0, 108, personalize(opt.desc), {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: '#f0e6cc', fontStyle: 'bold',
        wordWrap: { width: 210 }, align: 'center',
      }).setOrigin(0.5, 0));
      hit = scene.add.rectangle(0, -20, 200, 300, 0xffffff, 0.001);
      box.add(hit);
    } else {
      const parts = woodPanel(scene, 0, 0, 290, 380, { accent: opt.mythic ? 0xe03040 : pack.color });
      box.add([parts.shadow, parts.panel, parts.line]);
      const icon = scene.add.image(0, -108, opt.icon ?? pack.icon).setTint(opt.tint ?? pack.color);
      icon.setScale(76 / Math.max(icon.width, icon.height));
      box.add(contactPool(scene, 2, -70, 92, { alpha: 0.3 }));   // the glyph rests on the parchment
      box.add(icon);
      box.add(scene.add.text(0, -26, opt.name, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '29px', color: opt.mythic ? '#c02030' : PARCH.text,
        wordWrap: { width: 250 }, align: 'center',
      }).setOrigin(0.5));
      box.add(scene.add.text(0, 78, personalize(opt.desc), {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '22px', color: PARCH.text, fontStyle: 'bold',
        wordWrap: { width: 248 }, align: 'center',
      }).setOrigin(0.5));
      hit = parts.panel;
    }
    // THE WORN ANVIL guaranteed this one onto the shelf — say so on the card.
    if (opt.anvil) box.add(anvilBadge(scene, 0, topY - 26));
    ov.add(box);
    const affordable = !opt.available || opt.available(run);
    scene.tweens.add({
      targets: box, scale: 1, alpha: affordable ? 1 : 0.45, duration: 300, delay: 120 + i * 130, ease: 'Back.easeOut',
      onStart: () => sfx(scene, 'card_deal', { volume: 0.56, rate: 1 + i * 0.06 }),
    });
    // THE HOVER READS THE OPTION, always. It used to be wired only on the
    // painted-card branch AND only when you could afford it, so an icon-panel
    // fallback had no tip at all and a deal you couldn't cover couldn't even be
    // read. Both are exactly when you most want to know what it would have done.
    hit.setInteractive({ useHandCursor: affordable });
    hit.on('pointerover', () => {
      // An Artisan card is nameless — it IS its own preview, drawn full size on
      // the shelf, so a tooltip would only repeat it.
      if (opt.name) showCardTip(opt, xs[i], tipY);
      if (affordable) scene.tweens.add({ targets: box, scale: 1.06, duration: 110 });
    });
    hit.on('pointerout', () => {
      killCardTip();
      if (affordable) scene.tweens.add({ targets: box, scale: 1, duration: 110 });
    });
    /**
     * TWO TAPS, AND THIS IS THE FLAGSHIP (JC, 2026-08-10).
     *
     * THE ORACLE routes through here with `mandatory: true`: three unfamiliar
     * futures, dealt before the first fight of the first run, one of them about
     * to be permanent, and no TAKE NOTHING to retreat to. Under the old model
     * the first thing a thumb landed on WAS the answer. Now the first tap opens
     * a box carrying the option's name, the exact string the desktop tooltip
     * prints, and a single CHOOSE — and browsing the other two costs one tap
     * each, because a press that lands on a different card swaps the box.
     *
     * AN UNAFFORDABLE DEAL STILL OPENS ITS BOX, with CHOOSE drawn dead. "This
     * is what you cannot afford" is the information the shelf owes you; the
     * shake and the CAN'T PAY pop are what the dead button plays when pressed
     * (choicebox does that itself), so the desktop refusal is not duplicated.
     *
     * THE ARTISAN'S CARD IS NAMELESS (`name: ''`) and hides nothing — its face
     * and its mod blurb are both drawn full size on the shelf, which is why it
     * has never had a tooltip. It still gets the box, because the rule JC wrote
     * is about the COMMIT and not about the reading: taking it pushes a card
     * into your deck for the rest of the run. It borrows its own face for a
     * title, so the box names the thing it is about.
     */
    if (TOUCH) {
      twoTap(scene, hit, {
        key: `pack:${i}:${opt.id ?? opt.name}`,
        anchor: hitAnchor(hit),
        title: opt.name
          ? opt.name.toUpperCase()
          : (opt.card ? `${rankLabel(opt.card.rank)} OF ${SUIT_GLYPH[opt.card.suit]}` : pack.label),
        body: () => optionTipBody(opt),
        accent: optionAccent(opt),
        depth: (ov.depth ?? OV_DEPTH) + 10,
        owner: ov,
        buttons: () => [{
          label: 'CHOOSE', kind: 'take',
          onClick: () => choose(opt),
          // Re-asked at OPEN time, not at build time: a Dealer deal you could
          // not cover when the shelf dealt may be affordable by the time you
          // read it (a relic paid out, a bottle was drunk).
          enabled: !opt.available || opt.available(run),
        }],
        onOpen: killCardTip,
      });
    } else if (!affordable) {
      // The Dealer greys out deals you can't cover. Desktop only: on touch the
      // box's own dead CHOOSE button is the refusal, and it shakes and sounds
      // exactly the same way (choicebox.js).
      hit.on('pointerdown', () => {
        sfx(scene, 'card_deselect', { volume: 0.42 });
        scene.tweens.add({ targets: box, x: xs[i] + 8, duration: 50, yoyo: true, repeat: 2 });
        popMessage(scene, xs[i], 380, "CAN'T PAY", { color: '#ff6a76', size: 28 });
      });
    } else {
      hit.on('pointerdown', () => choose(opt));
    }
    shelfEntries.push({ obj: hit, id: opt.id ?? null, label: opt.name ?? null });
  });
  publishShelf(scene, ov, `pack:${pack.kind}`, shelfEntries);

  // A polite skip for hoarders who want nothing. THE ORACLE has no such door.
  if (!mandatory) {
    button(scene, ov, GAME_W / 2, GAME_H - 62, 'TAKE NOTHING', () => { ov.destroy(true); done(); },
      { key: 'btn_dark', color: '#a898c4', w: 250, h: 56 });
  }
  // Peek at the deck before taking one — the whole point of the choice (JC).
  viewDeckButton(scene, ov, run);
  return ov;
}
