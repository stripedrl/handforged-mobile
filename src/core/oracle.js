/**
 * THE ORACLE — the pack you open once, before the run has really begun.
 *
 * She is dealt ONCE, on arrival at the first map (one beat after the difficulty
 * pick), she offers THREE of TWENTY, and you MUST take one. There is no
 * TAKE NOTHING on her shelf. Every option gives something and takes something,
 * except the one that does neither, and that one is the joke.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER PACK
 *
 * Thirteen of the twenty are ordinary one-shot grants: chips, cards, a relic, a
 * deck rewrite. They spend themselves inside apply() and are never heard from
 * again, exactly like a Witch rite.
 *
 * SEVEN ARE PERMANENT RUN MODIFIERS — Hunter, Cultured, Negotiator, Collector,
 * Recycler, Blacksmith and Spiritual — and those are the whole engineering
 * problem. They do not act; they change the answer a system gives to a question
 * it was already asking. So none of them is special-cased anywhere. Each writes
 * ONE NAMED CHANNEL on run.oracleMods (declared in core/run.js, beside the run
 * state it belongs to), and each channel is read at exactly ONE site: the site
 * that already owned the question.
 *
 *   Hunter       run.oracleMods.hunterPacks          -> packs.rollPackOffer
 *                ...the pack table already rolls its own rare wrappers.
 *   Cultured     run.oracleMods.culturedRelics       -> artifacts.eligibleFor
 *                ...the single gate all eight relic roll paths funnel through.
 *   Negotiator   run.oracleMods.shopPriceFactor      -> run.shopPrice
 *   Collector    run.oracleMods.shopPriceFactor      -> run.shopPrice
 *                run.oracleMods.shopExtraStock       -> MapScene.renderStock,
 *                ...beside the Collector's Kerchief's `extraStock`, which is the
 *                same question asked by a relic instead of by the Oracle.
 *   Recycler     run.oracleMods.recyclePlayed        -> stowPlayedCard, below
 *                ...the one line in CombatScene that files a spent card.
 *   Blacksmith   run.oracleMods.forgeOwed            -> run.newActMap
 *                ...the one line in the game that builds a board.
 *   Spiritual    run.oracleMods.etherealNeverVanishes-> etherealVanishChance
 *                ...the one roll that takes a ghost away from you.
 *
 * Nothing in the codebase asks `run.oracle === 'negotiator'`. `run.oracle` is a
 * RECEIPT: it exists so a save can say which card was taken and so a future
 * screen can print it. It is never a branch.
 *
 * THE MODULE GRAPH IS ONE-WAY. This file may import run/artifacts/potions/
 * deck/map/scoring; none of them may import it back. That is why the channel
 * bag itself (freshOracleMods) lives in run.js: run.js builds it at module-eval
 * time, and a cycle there would hand back a half-built module.
 */

import { SUITS, cardList } from './deck.js';
import { rollEliteDrop, rollOfRarity } from './artifacts.js';
import { MAX_POTIONS, rollDistinctPotions } from './potions.js';
import { forceMythicNode } from './map.js';
import { ETHEREAL_VANISH_CHANCE, MOD_MULT_FACTOR, VALUE_BONUS_BY_MOD } from './scoring.js';
import { run, gainGold } from './run.js';

// ---------------------------------------------------------------------------
// THE NUMBERS. Every one of them is quoted by the copy below through a template
// literal, so a retune moves the rules text with it and the tooltip can never
// promise a figure the apply() does not pay.
// ---------------------------------------------------------------------------

/** How many of the twenty are dealt. Three, and never the same one twice. */
export const ORACLE_OFFER_SIZE = 3;

export const GREEDY_CHIPS = 250;
export const GREEDY_MAX_HP = 25;
export const MODEST_CHIPS = 50;
export const FOOLISH_JOKERS = 3;
export const FOOLISH_HAND_SIZE = 1;
export const ROULETTE_CARDS = 5;
export const COLORFUL_WILDS = 3;
export const ALCHEMIST_POTIONS = 2;
export const HANDY_HANDS = 2;
export const SACRIFICIAL_HANDS = 1;
export const COMPENSATOR_HAND_SIZE = 2;
export const COMPENSATOR_DISCARDS = 2;
export const HUNTER_SLOTS = 1;
/** The merchant's till, as a multiplier. Both write run.oracleMods.shopPriceFactor. */
export const NEGOTIATOR_FACTOR = 0.9;
export const COLLECTOR_FACTOR = 1.25;
export const COLLECTOR_STOCK = 1;

/** THE JOKER's card, as THE JOKER relic prints it. One definition, two owners. */
export const JOKER_RANK = 14;
export const JOKER_SUIT = 'clovers';

const pct = (f) => `${Math.round(Math.abs(1 - f) * 100)}%`;

// ---------------------------------------------------------------------------
// Small shared surgery. Every one of these is READ-ONLY on the caller's array
// except where it says otherwise, and every one takes its own rng so a test can
// pin a roll without stubbing Math.random globally (that breaks Phaser's
// canvas-texture UUIDs, and the dev harness runs in the same process).
// ---------------------------------------------------------------------------

/** `n` distinct random cards off the deck, preferring ones with no mod yet. */
function freshCards(deck, n, rng) {
  const pool = deck.filter(c => !c.mod);
  const from = pool.length >= n ? pool : [...deck];
  const left = [...from];
  const out = [];
  for (let i = 0; i < n && left.length; i++) {
    out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  }
  return out;
}

/** Every card of these ranks, gone from the run deck. Returns how many left. */
function stripRanks(r, ranks) {
  const before = r.runDeck.length;
  r.runDeck = r.runDeck.filter(c => !ranks.includes(c.rank));
  return before - r.runDeck.length;
}

// ---------------------------------------------------------------------------
// THE READERS — the three channels whose question is asked somewhere that
// cannot conveniently read a raw field. Exported so a node test can prove the
// system changed without standing up Phaser.
// ---------------------------------------------------------------------------

/**
 * WHERE A PLAYED CARD GOES. The single destination decision for a card that has
 * finished scoring: the discard pile, or shuffled back into the draw pile if
 * THE RECYCLER was taken.
 *
 * BURNED BEATS RECYCLED, and the seam that guarantees it is at the CALL SITE,
 * not in here: CombatScene's played-card sweep already skips any sprite that
 * has its own exit (`burned`, `vanished`) BEFORE it asks this function
 * anything. A card destroyed as it plays therefore never reaches the
 * destination choice at all, so nothing here has to know that destruction
 * exists. Anything new that destroys a played card keeps that rule for free by
 * doing what the All-In Visor and the ETHEREAL vanish already do: add the
 * sprite to the skip set before the sweep runs.
 *
 * `fight` is anything holding `deck` and `discardPile` (the live CombatScene,
 * or a two-array stub in a test). Returns which pile took it.
 */
export function stowPlayedCard(card, fight, r = run, rng = Math.random) {
  if (r?.oracleMods?.recyclePlayed) {
    // SHUFFLED IN, not stacked on top: the draw pile is popped from the END, so
    // an index of `deck.length` IS the top and hands the card straight back on
    // the next draw. The range is therefore [0, length), never [0, length] —
    // the inclusive version defeated the very thing this line exists to avoid
    // about one draw in eleven. An empty pile splices at 0 and is the one case
    // where the card genuinely is the next draw, because there is nothing else.
    fight.deck.splice(Math.floor(rng() * Math.max(1, fight.deck.length)), 0, card);
    return 'deck';
  }
  fight.discardPile.push(card);
  return 'discard';
}

/**
 * The rent an ETHEREAL card pays for its bonus mult, ONCE PER ACTIVATION since
 * 2026-08-04 (which is why the rate came down to 10). SPIRITUAL takes it to
 * zero, and a chance of zero is not "usually safe" but never: the roll in
 * CombatScene is `roll >= chance -> the card stays`, and no roll in [0,1) is
 * ever below 0.
 */
export function etherealVanishChance(r = run) {
  return r?.oracleMods?.etherealNeverVanishes ? 0 : ETHEREAL_VANISH_CHANCE;
}

// ---------------------------------------------------------------------------
// THE TWENTY
//
// ONE JOKE IN FOUR, AND THE REST ARE A LEDGER (2026-08-04 copy pass). Every card
// opens on GAIN:/PRICE: or on a plain rule sentence, and the closing flavour
// line is a PRIVILEGE, not a slot to fill. Five were cut here because they only
// said the rule again in prettier words ("The fool draws fewer and swings
// harder", "You carry less so you can chase more", "Hold more. Throw away
// nothing", "Nothing is spent. Everything comes round again.") or reached for
// mystique instead of information ("She shuffles fate itself and does not look
// at what fell out"). The Oracle keeps more voice than any other table in the
// game because she is a fortune teller and the cards are her futures, but a
// third line now has to earn its place against a player reading three of these
// with the run not yet started.
//
// Option contract is the pack's: { id, name, desc, apply(run, choice, rng) },
// and apply may return a directive the overlay finishes ({ artifact } opens the
// relic ceremony, { text } floats a line). The NAME IS BAKED INTO THE PAINTED
// CARD, exactly like the Witch's and the Dealer's, so nothing is drawn on the
// face and every word below lives in the hover tooltip.
// ---------------------------------------------------------------------------

export const ORACLE_OPTIONS = [
  {
    id: 'greedy', name: 'Greedy',
    desc: `GAIN: ${GREEDY_CHIPS} chips, before the first fight.\n`
      + `PRICE: ${GREEDY_MAX_HP} Max HP, forever.`,
    apply(r) {
      const paid = gainGold(GREEDY_CHIPS, r);
      r.player.maxHp = Math.max(1, r.player.maxHp - GREEDY_MAX_HP);
      r.player.hp = Math.min(r.player.hp, r.player.maxHp);
      return { text: `+${paid} chips. ${GREEDY_MAX_HP} Max HP gone.` };
    },
  },
  {
    id: 'sacrificial', name: 'Sacrificial',
    desc: 'GAIN: a random relic, free.\n'
      + `PRICE: ${SACRIFICIAL_HANDS} hand fewer in every fight, for the rest of the run.`,
    apply(r, _, rng = Math.random) {
      r.oracleMods.handsPerFight -= SACRIFICIAL_HANDS;
      const def = rollEliteDrop(r.artifacts.map(a => a.id), 0, rng, r.chrId, r.actIndex);
      return def ? { artifact: def }
        : { text: 'The altar is bare. The clock still runs short.' };
    },
  },
  {
    id: 'foolishNature', name: 'Foolish Nature',
    // A JOKER counts as EVERY suit when the hand is read and scores as YOUR
    // suit (poker.WILD_MODS, scoring.effectiveSuit). "Scores as any suit" said
    // neither of those things. Both numbers now come off the engine's tables.
    desc: `GAIN: ${FOOLISH_JOKERS} JOKERS in your deck. Each counts as every suit, scores as yours ({SUIT}), adds ${VALUE_BONUS_BY_MOD.joker} value and multiplies the hand mult by ${MOD_MULT_FACTOR.joker}.\n`
      + `PRICE: ${FOOLISH_HAND_SIZE} less card in hand.`,
    apply(r) {
      for (let i = 0; i < FOOLISH_JOKERS; i++) {
        r.runDeck.push({ id: `oracle-joker-${i}-${r.runDeck.length}`, suit: JOKER_SUIT, rank: JOKER_RANK, mod: 'joker' });
      }
      r.player.handSize -= FOOLISH_HAND_SIZE;
      return { text: `${FOOLISH_JOKERS} JOKERS join the deck.` };
    },
  },
  {
    id: 'gamblingAddict', name: 'Gambling Addict',
    desc: `GAIN: ${ROULETTE_CARDS} random cards become ROULETTE, spinning again every activation for chips, mult, value or nothing.\n`
      + 'PRICE: 1 less discard every fight.',
    apply(r, _, rng = Math.random) {
      const picks = freshCards(r.runDeck, ROULETTE_CARDS, rng);
      for (const c of picks) c.mod = 'roulette';
      r.discardsPerFightBonus -= 1;
      return { text: `${picks.length} cards are on the wheel now.` };
    },
  },
  {
    id: 'spiritual', name: 'Spiritual',
    desc: `GAIN: ETHEREAL cards never vanish. Their x${MOD_MULT_FACTOR.ethereal} mult costs nothing.\n`
      + 'PRICE: every Ace leaves your deck.',
    apply(r) {
      r.oracleMods.etherealNeverVanishes = 1;
      const gone = stripRanks(r, [14]);
      return { text: `${gone} Aces walk. No ghost ever will.` };
    },
  },
  {
    id: 'anarchist', name: 'Anarchist',
    desc: 'Every JACK, QUEEN and KING leaves your deck. Nothing replaces them.',
    apply(r) {
      const gone = stripRanks(r, [11, 12, 13]);
      return { text: `${gone} face cards deposed. ${r.runDeck.length} cards left.` };
    },
  },
  {
    id: 'chaotic', name: 'Chaotic',
    desc: 'Every card in your deck is re-rolled right now: new rank, new suit. Mods, seals and foil are untouched.',
    apply(r, _, rng = Math.random) {
      // ONCE, at pick time, on the run deck (per spec). Only rank and suit are
      // touched: a card's mod, stamp and wrap are what the card IS, and the
      // Oracle rewrites what it says, not what it is.
      for (const c of r.runDeck) {
        c.rank = 2 + Math.floor(rng() * 13);
        c.suit = SUITS[Math.floor(rng() * SUITS.length)];
      }
      return { text: `${r.runDeck.length} cards re-rolled. Good luck.` };
    },
  },
  {
    id: 'hunter', name: 'Hunter',
    desc: "GAIN: THE BOUNTY HUNTER joins the pack table for the rest of the run, at the Forge pack's own rate.\n"
      + `PRICE: ${HUNTER_SLOTS} relic slot.`,
    apply(r) {
      r.oracleMods.hunterPacks = 1;
      r.artifactSlots = Math.max(1, r.artifactSlots - HUNTER_SLOTS);
      return { text: 'The hunter starts walking your road.' };
    },
  },
  {
    id: 'handy', name: 'Handy',
    desc: `GAIN: ${HANDY_HANDS} more hands in every fight.\n`
      + 'PRICE: 1 less discard every fight.',
    apply(r) {
      r.oracleMods.handsPerFight += HANDY_HANDS;
      r.discardsPerFightBonus -= 1;
      return { text: `+${HANDY_HANDS} hands, 1 discard fewer.` };
    },
  },
  {
    id: 'alchemist', name: 'Alchemist',
    desc: `GAIN: ${ALCHEMIST_POTIONS} random potions, straight onto your belt.`,
    apply(r, _, rng = Math.random) {
      const room = Math.max(0, MAX_POTIONS - (r.potions?.length ?? 0));
      const bottles = rollDistinctPotions(Math.min(ALCHEMIST_POTIONS, room), rng);
      for (const def of bottles) r.potions.push({ ...def });
      return { text: bottles.length ? bottles.map(b => b.name).join(' and ') : 'Your belt is already full.' };
    },
  },
  {
    id: 'simple', name: 'Simple',
    desc: 'GAIN: a COMMON relic, free.',
    apply(r, _, rng = Math.random) {
      const def = rollOfRarity('common', r.artifacts.map(a => a.id), rng, r.chrId);
      return def ? { artifact: def } : { text: 'Every simple thing is already yours.' };
    },
  },
  {
    id: 'cultured', name: 'Cultured',
    desc: "Other heroes' EXCLUSIVE relics can roll for you everywhere a relic is rolled: the shop, an elite, the Curator's case, the fire.",
    apply(r) {
      r.oracleMods.culturedRelics = 1;
      return { text: 'Other people\'s heirlooms are on the table.' };
    },
  },
  {
    id: 'negotiator', name: 'Negotiator',
    desc: `Everything on the merchant's table costs ${pct(NEGOTIATOR_FACTOR)} less: relics, bottles, removals, boosters, restocks.`,
    apply(r) {
      r.oracleMods.shopPriceFactor *= NEGOTIATOR_FACTOR;
      return { text: `Every price on his mat, ${pct(NEGOTIATOR_FACTOR)} lighter.` };
    },
  },
  {
    id: 'collector', name: 'Collector',
    desc: `GAIN: ${COLLECTOR_STOCK} more relic on the merchant's mat, every visit.\n`
      + `PRICE: everything he sells costs ${pct(COLLECTOR_FACTOR)} more.`,
    apply(r) {
      r.oracleMods.shopExtraStock += COLLECTOR_STOCK;
      r.oracleMods.shopPriceFactor *= COLLECTOR_FACTOR;
      return { text: 'One more relic on the mat, and a dearer mat.' };
    },
  },
  {
    id: 'compensator', name: 'Compensator',
    desc: `GAIN: ${COMPENSATOR_HAND_SIZE} more cards in hand.\n`
      + `PRICE: ${COMPENSATOR_DISCARDS} fewer discards every fight.`,
    apply(r) {
      r.player.handSize += COMPENSATOR_HAND_SIZE;
      r.discardsPerFightBonus -= COMPENSATOR_DISCARDS;
      return { text: `+${COMPENSATOR_HAND_SIZE} hand size, ${COMPENSATOR_DISCARDS} discards fewer.` };
    },
  },
  {
    id: 'recycler', name: 'Recycler',
    desc: 'Cards you PLAY shuffle back into your draw pile instead of the discard. A card destroyed as it plays is still gone.',
    apply(r) {
      r.oracleMods.recyclePlayed = 1;
      return { text: 'Nothing you play is ever really spent.' };
    },
  },
  {
    id: 'modest', name: 'Modest',
    desc: `GAIN: ${MODEST_CHIPS} chips, before the first fight.`,
    apply(r) {
      return { text: `+${gainGold(MODEST_CHIPS, r)} chips.` };
    },
  },
  {
    id: 'blacksmith', name: 'Blacksmith',
    desc: "THE CRIMSON FORGE is guaranteed to stand on your map, in some act, before this run is out. It is the map's only source of MYTHICAL relics.",
    apply(r) {
      r.oracleMods.forgeOwed = 1;
      // Pay it against the board that is ALREADY standing if that board can host
      // one, so the red node is on the very map you are about to look at. If it
      // cannot, the debt rides and newActMap settles it in a later act.
      if (r.map && forceMythicNode(r.map)) r.oracleMods.forgeOwed = 0;
      return { text: 'A red node burns somewhere on the road.' };
    },
  },
  {
    id: 'colorful', name: 'Colorful',
    desc: `${COLORFUL_WILDS} cards in your deck turn WILD: every suit at once, scoring as your suit ({SUIT}).`,
    apply(r, _, rng = Math.random) {
      const picks = freshCards(r.runDeck, COLORFUL_WILDS, rng);
      for (const c of picks) c.mod = 'wild';
      return { text: picks.length ? `Your ${cardList(picks)} turn WILD.` : 'Nothing left to paint.' };
    },
  },
  {
    id: 'basic', name: 'Basic',
    // THE ONLY NO-OP IN THE PACK, and therefore the one that has to earn its
    // seat on writing alone. It must read as a decision the Oracle MADE, not as
    // a card whose effect failed to load.
    desc: 'Nothing at all. No gift, no price, no catch.',
    apply() {
      return { text: 'She says nothing. The road is exactly as long as it was.' };
    },
  },
];

/** id -> option, for the save receipt and the dev harness. */
export const ORACLE_BY_ID = Object.fromEntries(ORACLE_OPTIONS.map(o => [o.id, o]));

/**
 * TAKE ONE. Stamps the receipt, settles the debt, and runs the option.
 *
 * The receipt is written BEFORE apply() so a directive that opens a second
 * overlay (Sacrificial's and Simple's relic ceremonies) cannot leave the run
 * remembering nothing if the player quits inside it: whatever the Oracle
 * changed is already changed, and the run already knows whose fault it is.
 */
export function takeOracle(r, opt, rng = Math.random) {
  r.oracle = opt.id;
  r.pendingOracle = false;
  return opt.apply(r, {}, rng);
}

/**
 * THE SHELF: `count` DISTINCT options of the twenty, in a random order, each a
 * CLONE whose apply() goes through takeOracle so the receipt is written no
 * matter which surface calls it. The base definitions stay pristine between
 * opens, exactly as resolveOptions does for every other pack.
 */
export function rollOracleOffer(r = run, count = ORACLE_OFFER_SIZE, rng = Math.random) {
  const left = [...ORACLE_OPTIONS];
  const out = [];
  while (out.length < count && left.length) {
    const opt = left.splice(Math.floor(rng() * left.length), 1)[0];
    out.push({
      ...opt,
      apply: (rr = r, choice = null, rng2 = Math.random) => takeOracle(rr, opt, rng2),
    });
  }
  return out;
}
