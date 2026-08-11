/**
 * @file glossary.js (ui)
 * THE INDEX (JC, 2026-08-10, the COPY CLARITY WAVE).
 *
 * The one screen in the game where a word is DEFINED rather than used. Every
 * other surface says what a relic does; this one says what VALUE, Mult, Brittle,
 * SEALED and a kicker are, so the terse rules text everywhere else has something
 * to be terse against.
 *
 * THREE RULES IT KEEPS:
 *
 *   1. DERIVED, NEVER TYPED. Every number below is a template literal over the
 *      constant the engine actually reads (CLUB_SPLASH, STAMP_MULT,
 *      WRAP_MULT_FACTOR, CHIPS_PER_HAND_LEFT, SELL_FRACTION, HAND_DEFS...). A
 *      glossary that goes stale is worse than no glossary, because a player
 *      trusts it more than a tooltip.
 *   2. NO SPOILERS. The hand ladder is built from HAND_DEFS with `secret`
 *      filtered OUT entirely, not printed as '???'. Nothing here mentions a
 *      hidden trophy, an unlockable hero or an act past the ones on the road.
 *   3. THE HOUSE COPY RULES. Term, then one or two terse true sentences. See
 *      docs/DESIGN.md section COPY RULES.
 *
 * Presentation borrows the trophy shelf's exact machinery on purpose: the same
 * woodPanel frame, the same geometry-masked scroll window, and the same
 * ui/kinetic.js physics, so THE INDEX floats like every other shelf in the game.
 */

import { GAME_W, GAME_H, DEPTH, PARCH, SUIT_GLYPH } from '../config.js';
import { woodPanel } from './panels.js';
import { legible } from './juice.js';
import { sfx } from '../core/sfx.js';
import { kineticScroll } from './kinetic.js';
import { HAND_DEFS, HAND_TYPES } from '../core/poker.js';
import {
  CLUB_SPLASH, SEAL_HEAL, STAMP_MULT, ECHO_TIMES, MOD_CHIPS,
  MOD_MULT_FACTOR, WRAP_MULT_FACTOR, VALUE_BONUS_BY_MOD,
  ETHEREAL_VANISH_CHANCE, FADE_VANISH_CHANCE,
} from '../core/scoring.js';
import { ARTIFACT_RARITY, RARITY_ORDER, BASE_ARTIFACT_SLOTS } from '../core/artifacts.js';
import { MAX_POTIONS, POTION_SELL_FRACTION } from '../core/potions.js';
import { CHIPS_PER_HAND_LEFT, SELL_FRACTION } from '../core/run.js';
import { ROOTED_STRENGTH } from '../core/statuses.js';
import { MAX_HAND_CARDS, BLIND_CHANCE } from '../core/biomes.js';

const GOLD = '#ffd23e';
const GOLD_TINT = 0xffd23e;

/** Whole percent from a fraction: 0.25 -> '25%'. */
const pct = (f) => `${Math.round(f * 100)}%`;

/**
 * THE PRINTED HAND LADDER, secrets removed entirely. `secret: true` is poker.js's
 * only gate on a hidden hand, so a fourth one added tomorrow stays out of the
 * INDEX for free, and nothing here so much as hints that the ladder continues.
 */
function handLadderLines() {
  return HAND_TYPES
    .filter(t => !HAND_DEFS[t].secret)
    .map((t) => {
      const d = HAND_DEFS[t];
      return `${d.name}  ${d.base} x${d.mult}`;
    });
}

/** The six rarity labels, in ladder order, off the one table that owns them. */
function rarityLine() {
  return RARITY_ORDER.map(r => ARTIFACT_RARITY[r].label).join(' · ');
}

/**
 * THE ENTRIES. `{ group, terms: [[term, text], ...] }`, built as a function so
 * every literal above is read at OPEN time rather than at module evaluation.
 */
export function indexGroups() {
  // SUIT_GLYPH is the game's one display-name table (the `gems` / `clovers` ids
  // stay in code forever), so the INDEX names a suit exactly as the cards do.
  const S = SUIT_GLYPH.swords, H = SUIT_GLYPH.hearts;
  const D = SUIT_GLYPH.gems, C = SUIT_GLYPH.clovers;
  return [
    {
      group: 'SCORING',
      terms: [
        ['VALUE', 'What a card is worth on the score side. 2 through 10 score their face value, J, Q and K score 10, an Ace scores 11.'],
        ['MULT', 'The number the score side is multiplied by. Damage is score x mult, and the equation prints both.'],
        ['HAND VALUE', 'Every hand type brings its own base value to the score side before a single card is counted. It feeds damage only, never heal, Shield or chips.'],
        ['HAND LEVEL', 'A level raises that hand type\'s base value AND its mult, permanently for the run. The Smith sells them; the shelf prints the exact before and after.'],
        ['THE HAND LADDER', `Base value x mult at level 1:\n${handLadderLines().join('\n')}`],
        ['THE KICKER RULE', 'Only the cards that FORM the hand score. A card played alongside them contributes nothing, whatever it is worth.'],
        ['RESOLVE ORDER', 'Played cards resolve left to right. Flat mult adds where its card sits; x-mult layers multiply the running total at their own card\'s position, so placement changes the result.'],
        ['RETRIGGER', 'One card fires again inside the same hand. It scores again in full.'],
        ['REPLAY', 'The whole hand happens again. Everything it output happens again with it: damage, heal, Shield, Poison, chips.'],
        ['SPLASH', 'Damage that reaches enemies other than your target.'],
        ['DISCARD', 'Throw cards back and draw replacements without spending a hand. Discards refill every fight.'],
      ],
    },
    {
      group: 'SUITS',
      terms: [
        [S, 'Contribute 2x their value as damage.'],
        [H, 'Contribute their value as damage, and heal you for the same amount.'],
        [D, 'Contribute their value as damage, and grant the same amount as Shield.'],
        [C, `Contribute their value as damage, and splash ${pct(CLUB_SPLASH)} of what they dealt onto every other living enemy.`],
        ['YOUR SUIT', 'Each hero owns one suit. A WILD card scores as that suit.'],
      ],
    },
    {
      group: 'YOUR AILMENTS',
      terms: [
        ['BLEED N', 'Each hand you play costs N HP. Fades by 1 per hand played.'],
        ['POISON N', 'N HP at the end of every round. Fades by 1 per round.'],
        ['BRITTLE', 'You take +50% damage from attacks next turn.'],
        ['FEAR N', `Your next hand may use at most ${MAX_HAND_CARDS} minus N cards.`],
        ['FROZEN', 'Frozen cards cannot be played for a turn. They can still be discarded.'],
        ['ROOTED N', `Your hand is dealt ${ROOTED_STRENGTH} card smaller for N turns.`],
        ['SEALED', 'One suit cannot be PLAYED. You may still discard it.'],
        ['COURT ADJOURNED', 'J, Q and K cannot be PLAYED. You may still discard them.'],
        ['SPIKES N', 'Every hand you play costs HP equal to your Spikes. Spikes never fade on their own.'],
        ['HYPNOTIZED', 'A card is marked and must be played with your next hand. Discarding it only marks another.'],
        ['BLIND', `About ${Math.round(BLIND_CHANCE * 100)}% of the cards you DRAW arrive face down. They are still playable.`],
        ['BURNED', 'A burned card cannot be played again this fight, even after the discard pile reshuffles.'],
        ['CONDEMNED', 'A branded card must be PLAYED before its clock runs out or it leaves your deck for good. Discarding does not save it.'],
      ],
    },
    {
      group: 'ENEMY EFFECTS',
      terms: [
        ['SHIELD', 'An absorption pool that eats damage before HP. Nothing decays it; only damage spends it. Yours works the same way.'],
        ['WARD', 'An enemy grants Shield to itself or to an ally.'],
        ['IMMUNE', 'Nothing reaches it this turn. Damage, status and execution alike.'],
        ['STRENGTHEN', 'Its NEXT attack hits harder. The bonus is spent on that attack.'],
        ['CHARGING', 'It is winding up. A bigger attack lands next turn.'],
        ['INTENT', 'The icon row above an enemy: exactly what it will do on its turn. Hover it for the rule in words.'],
        ['SIGNATURE', 'An elite or boss rule that runs for the whole fight. It is announced at the opening bell and rides a badge under the intent row.'],
      ],
    },
    {
      group: 'CARD LAYERS',
      terms: [
        ['MOD', 'The card\'s identity layer, one per card. It paints the card.'],
        ['SEAL', 'Wax pressed into the lower-left corner, one per card. A seal sits ON TOP of any mod.'],
        ['WRAP', 'Foil laid over the card, one per card, on top of any mod and any seal.'],
        ['ENHANCED', `+${VALUE_BONUS_BY_MOD.enhanced} value.`],
        ['WILD', 'Counts as every suit when the hand is read, and scores as your hero\'s suit.'],
        ['JOKER', `Wild, +${VALUE_BONUS_BY_MOD.joker} value, and x${MOD_MULT_FACTOR.joker} on the hand mult when it scores.`],
        ['GILDED', `Pays ${MOD_CHIPS} chips when it scores.`],
        ['FORGED', `+${VALUE_BONUS_BY_MOD.forged} value, and pays ${MOD_CHIPS} chips when it scores.`],
        ['ETHEREAL', `x${MOD_MULT_FACTOR.ethereal} mult when it scores, and ${pct(ETHEREAL_VANISH_CHANCE)} to leave your deck forever each time it does.`],
        ['SPECTRAL', `x${MOD_MULT_FACTOR.spectral} mult when it scores.`],
        ['ROULETTE', 'Spins on every activation for gold, red, black or green.'],
        ['NUKE', `+${VALUE_BONUS_BY_MOD.nuke} value.`],
        ['BLOOD SEAL', `Heals ${SEAL_HEAL} HP every time the card scores.`],
        ['MULTIPLICATIVE SEAL', `+${STAMP_MULT} mult every time the card scores.`],
        ['ECHO SEAL', `The card scores ${ECHO_TIMES === 2 ? 'twice' : `${ECHO_TIMES} times`}, and its leftover-in-hand effects fire one extra time.`],
        ['SHINY', `x${WRAP_MULT_FACTOR.shiny} mult every time the card scores.`],
        ['FADING', `No bonus of any kind, and ${pct(FADE_VANISH_CHANCE)} to leave your deck forever each time it scores. It lasts the fight.`],
      ],
    },
    {
      group: 'ECONOMY',
      terms: [
        ['CHIPS', 'The run\'s currency. Spent at the merchant, and gone the moment the run ends.'],
        ['THE HANDS PAYOUT', `A won fight pays ${CHIPS_PER_HAND_LEFT} chips for every hand you did not need. Elites and bosses pay on the same clock.`],
        ['SELLING', `A relic sells back for ${pct(SELL_FRACTION)} of its price. A bottle sells for ${pct(POTION_SELL_FRACTION)} of its own, at the merchant only.`],
        ['RESTOCK', 'New stock on the merchant\'s mat. The price climbs with each restock and resets on every shop visit.'],
        ['CARD REMOVAL', 'The merchant will take one card out of your deck per shop VISIT.'],
      ],
    },
    {
      group: 'THE MAP',
      terms: [
        ['FIGHT', 'One encounter of one to three enemies.'],
        ['ELITE', 'A harder encounter carrying a SIGNATURE. It lays out three relics; take one, or none.'],
        ['FORGED', 'An elite standing in fire. Its shelf drops a better tier.'],
        ['EVENT', 'A room that asks a question. Every choice states its terms before you take it.'],
        ['REST SITE', 'Heal 30% of your Max HP, HONE a card +2 rank, or PURGE a card out of your deck.'],
        ['MERCHANT', 'Relics, bottles, boosters and one card removal, for chips.'],
        ['THE CRIMSON FORGE', 'The red node. The only place on the map a MYTHICAL relic is handed out.'],
        ['BOSS', 'The summit of the act. Hover the medallion to read its signature before you walk in.'],
      ],
    },
    {
      group: 'RARITIES',
      terms: [
        ['THE LADDER', rarityLine()],
        ['HERO EXCLUSIVE', 'One relic per hero, rarer than a Legendary. You are never offered another hero\'s.'],
        ['MYTHICAL', 'Never sold on the mat. Elite drops, the Crimson Forge, a Forge pack\'s Mythic Ember, or the bounty wheel.'],
        ['ACT SCALING', 'Very Rare and above are rarer in early acts. Anything that ADVERTISES a floor pays that floor in every act.'],
      ],
    },
    {
      group: 'RELICS AND POTIONS',
      terms: [
        ['ARTIFACT SLOTS', `${BASE_ARTIFACT_SLOTS} to start. Some relics grant more, and a few take one.`],
        ['RELIC ORDER', 'Relics resolve left to right after the cards. Where one stands is a decision.'],
        ['ACTIVE RELIC', 'Carries a USE tag on the combat mat. One press per fight.'],
        ['MIRROR', 'The Forgery copies the relic to its RIGHT; the Phantom Cast copies the one to its LEFT. A relic whose whole effect fired at pickup cannot be copied.'],
        ['CURRENTLY:', 'A relic that banks growth prints its running total under its rules text, live.'],
        ['POTION BELT', `${MAX_POTIONS} slots. A bottle is spent when drunk.`],
      ],
    },
  ];
}

/**
 * THE INDEX overlay. Same frame, mask and kinetic physics as the trophy shelf.
 * Idempotent: a second call while it is open is a no-op.
 */
export function openIndex(scene) {
  if (scene.__indexOpen) return null;
  scene.__indexOpen = true;

  const PANEL_W = 1240, PANEL_H = 820;
  const cx = GAME_W / 2, cy = GAME_H / 2;
  const ov = scene.add.container(0, 0).setDepth(DEPTH.overlay + 34);
  const dim = scene.add.rectangle(cx, cy, GAME_W, GAME_H, 0x14101c, 0.82).setInteractive();
  ov.add(dim);
  const parts = woodPanel(scene, cx, cy, PANEL_W, PANEL_H, { accent: GOLD_TINT });
  ov.add([parts.shadow, parts.panel, parts.line]);

  ov.add(scene.add.text(cx, cy - PANEL_H / 2 + 52, 'INDEX', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '46px', color: PARCH.text,
  }).setOrigin(0.5));
  ov.add(scene.add.text(cx, cy - PANEL_H / 2 + 92, 'every word the game uses, and what it means', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: PARCH.textDim, fontStyle: 'bold',
  }).setOrigin(0.5));

  // --- the scrolling window ------------------------------------------------
  const VIEW_X = cx - 560, VIEW_Y = cy - PANEL_H / 2 + 124;
  const VIEW_W = 1120, VIEW_H = PANEL_H - 232;
  const TERM_W = 268, GAP = 22;
  const DEF_W = VIEW_W - TERM_W - GAP;

  const shelf = scene.add.container(0, 0);
  ov.add(shelf);
  const maskShape = scene.make.graphics({ x: 0, y: 0, add: false });
  maskShape.fillStyle(0xffffff);
  maskShape.fillRect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
  shelf.setMask(maskShape.createGeometryMask());

  const groups = indexGroups();
  const rows = [];          // the verification hook's flat view
  let y = VIEW_Y + 4;

  for (const g of groups) {
    // Section head: gold on parchment needs the outline the rest of the UI wears.
    const head = scene.add.container(VIEW_X, y + 18);
    head.add(scene.add.rectangle(0, 20, VIEW_W, 2, GOLD_TINT, 0.35).setOrigin(0, 0.5));
    head.add(legible(scene.add.text(2, 0, g.group, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: GOLD,
    }), { shadow: false }).setOrigin(0, 0.5));
    shelf.add(head);
    y += 46;

    for (const [term, text] of g.terms) {
      const t = scene.add.text(VIEW_X + 4, y, term, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: PARCH.text,
        wordWrap: { width: TERM_W - 8 },
      }).setOrigin(0, 0);
      const d = scene.add.text(VIEW_X + TERM_W + GAP, y + 2, text, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: PARCH.textDim,
        fontStyle: 'bold', wordWrap: { width: DEF_W },
      }).setOrigin(0, 0);
      shelf.add(t); shelf.add(d);
      rows.push({ group: g.group, term, text, y });
      y += Math.max(t.height, d.height) + 14;
    }
    y += 12;
  }

  const contentH = Math.max(0, y - VIEW_Y);
  const maxScroll = Math.max(0, contentH - VIEW_H);
  const kin = kineticScroll(scene, { max: maxScroll, apply: (v) => { shelf.y = -v; } });

  const onWheel = (_p, _o, _dx, dy) => kin.wheel(dy);
  scene.input.on('wheel', onWheel);
  let dragFrom = null;
  dim.on('pointerdown', (p) => { dragFrom = { y: p.y }; kin.grab(p.y); });
  const onMove = (p) => { if (dragFrom && p.isDown) kin.move(p.y); };
  const onUp = () => kin.release();
  scene.input.on('pointermove', onMove);
  scene.input.on('pointerup', onUp);

  if (maxScroll > 0) {
    ov.add(scene.add.text(cx, VIEW_Y + VIEW_H + 14, 'scroll for more', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0.5));
  }

  const close = () => {
    if (!scene.__indexOpen) return;
    scene.__indexOpen = false;
    scene.input.off('wheel', onWheel);
    scene.input.off('pointermove', onMove);
    scene.input.off('pointerup', onUp);
    kin.destroy();
    maskShape.destroy();
    window.__hfIndex = null;
    ov.destroy(true);
  };
  // Click OUTSIDE the panel closes, but a flick never does.
  dim.on('pointerup', (p) => {
    const moved = dragFrom ? Math.abs(p.y - dragFrom.y) : 0;
    const outside = p.x < cx - PANEL_W / 2 || p.x > cx + PANEL_W / 2
      || p.y < cy - PANEL_H / 2 || p.y > cy + PANEL_H / 2;
    dragFrom = null;
    if (moved < 6 && outside) close();
  });

  const btn = scene.add.image(cx, cy + PANEL_H / 2 - 50, 'btn_yellow')
    .setDisplaySize(220, 60).setInteractive({ useHandCursor: true });
  ov.add(btn);
  ov.add(scene.add.text(cx, cy + PANEL_H / 2 - 54, 'CLOSE', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#5b3a00',
  }).setOrigin(0.5));
  btn.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.7 }); close(); });

  // Verification hook (tools/verify_index.py). Plain data, exactly like the
  // trophy shelf's: the groups, every term, whether it scrolls, and the door out.
  window.__hfIndex = {
    scene: scene.scene.key,
    groups: () => groups.map(g => ({ group: g.group, terms: g.terms.map(t => t[0]) })),
    terms: () => rows.map(r => ({ group: r.group, term: r.term, text: r.text })),
    has: (term) => rows.some(r => r.term.toUpperCase().includes(String(term).toUpperCase())),
    contentH,
    viewH: VIEW_H,
    scrollable: maxScroll > 0,
    maxScroll,
    getScroll: () => kin.get(),
    setScroll: (v) => kin.set(v),
    close,
  };
  return ov;
}
