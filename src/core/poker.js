/**
 * @file poker.js
 * Pure poker-hand evaluation for HANDFORGED. Hands are 1-5 cards (fewer than
 * 5 is legal since HANDFORGED lets the player commit partial hands); the
 * five-card-only hand types (straight/flush/full house/straight flush)
 * simply cannot qualify unless exactly 5 cards are played.
 *
 * CARD MODS (Artisan/Witch/Forge packs) touch evaluation in one place:
 * 'wild', 'star' and 'joker' cards count as EVERY suit for flush purposes.
 * Ranks are always real — wilds don't fill straights, and a wild sitting
 * beside four Kings is NOT a fifth King (see FIVE OF A KIND below).
 *
 * SECRET HANDS (2026-07-31): FIVE OF A KIND and FLUSH FIVE sit above the
 * straight flush. Neither is reachable from a legal 52-card deck — you need
 * DUPLICATES (Mirror Image, Triplicate, Marked Cards, Loaded Deal, the Crown's
 * crowned Aces) to stack five of one rank, and WILD suits (or five duplicates
 * of one printed card) to make that stack a flush too. They are hidden from
 * the Smith's offer pool and the hands chart until the player plays one; see
 * progress.js discoveredHands.
 */

import { SUITS } from './deck.js';

/**
 * @typedef {import('./deck.js').Card} Card
 */

/**
 * @typedef {Object} HandResult
 * @property {string} type - machine key, e.g. 'twoPair'
 * @property {string} name - display name, e.g. 'Two Pair'
 * @property {number} mult - the base scoring multiplier for this hand type (level 0)
 */

/**
 * Base mults match Balatro's starting hand mults (JC, 2026-07-29) — power now
 * comes from Smith levels and artifacts, not the base chart.
 * levelStep = extra mult granted per Smith (hand-upgrade) level.
 */
export const HAND_DEFS = {
  highCard: { name: 'High Card', mult: 1, levelStep: 1 },
  pair: { name: 'Pair', mult: 2, levelStep: 1 },
  twoPair: { name: 'Two Pair', mult: 2, levelStep: 1 },
  trips: { name: 'Three of a Kind', mult: 3, levelStep: 1 },
  straight: { name: 'Straight', mult: 4, levelStep: 2 },
  flush: { name: 'Flush', mult: 4, levelStep: 2 },
  fullHouse: { name: 'Full House', mult: 4, levelStep: 2 },
  quads: { name: 'Four of a Kind', mult: 7, levelStep: 3 },
  straightFlush: { name: 'Straight Flush', mult: 8, levelStep: 3 },
  // --- SECRET, above the printed chart. `secret: true` is the ONLY gate: the
  // Smith's pool, the hands chart and the discovery ledger all read this flag,
  // so a future secret hand needs nothing but an entry here.
  fiveOfAKind: { name: 'Five of a Kind', mult: 10, levelStep: 4, secret: true },
  flushFive: { name: 'Flush Five', mult: 15, levelStep: 4, secret: true },
};

export const HAND_TYPES = Object.keys(HAND_DEFS);

/** The hidden-until-played hand types, in ladder order. */
export const SECRET_HAND_TYPES = HAND_TYPES.filter(t => HAND_DEFS[t].secret);

/** Display name -> machine key. run.stats.handTypeCounts is keyed by NAME. */
export const HAND_TYPE_BY_NAME = Object.fromEntries(
  HAND_TYPES.map(t => [HAND_DEFS[t].name, t]),
);

/** Card mods whose suit is "all of them" for hand evaluation. */
export const WILD_MODS = new Set(['wild', 'star', 'joker']);

export function isWild(card) {
  return WILD_MODS.has(card.mod);
}

/**
 * @param {string} type
 * @returns {HandResult}
 */
function result(type) {
  const def = HAND_DEFS[type];
  return { type, name: def.name, mult: def.mult };
}

/**
 * Map of rank -> count of that rank among the played cards.
 * @param {Card[]} cards
 * @returns {Map<number, number>}
 */
function rankCounts(cards) {
  const map = new Map();
  for (const c of cards) {
    map.set(c.rank, (map.get(c.rank) || 0) + 1);
  }
  return map;
}

/**
 * True if all cards share the same rank ordering that forms a 5-card
 * straight. Ace may play high (10-J-Q-K-A) or low (A-2-3-4-5); no
 * wraparound (e.g. Q-K-A-2-3 is NOT a straight).
 * @param {number[]} ranks - exactly 5 ranks
 * @returns {boolean}
 */
function isStraightRanks(ranks) {
  const uniq = Array.from(new Set(ranks));
  if (uniq.length !== 5) return false;
  const sorted = uniq.slice().sort((a, b) => a - b);
  const aceLow = [2, 3, 4, 5, 14];
  if (sorted.every((v, i) => v === aceLow[i])) return true;
  return sorted[4] - sorted[0] === 4; // 5 unique values spanning exactly 4 => consecutive
}

/**
 * Evaluate a played hand of 1-5 cards and return the highest qualifying
 * hand type with its display name and base scoring multiplier.
 * @param {Card[]} cards
 * @returns {HandResult}
 */
export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 5) {
    throw new RangeError('evaluateHand: cards must be an array of 1-5 cards');
  }

  const n = cards.length;
  const counts = Array.from(rankCounts(cards).values()).sort((a, b) => b - a);
  const maxCount = counts[0];

  // Wilds count as any suit: the non-wild cards must agree on one.
  const solid = cards.filter(c => !isWild(c));
  const sameSuit = solid.every(c => SUITS.includes(c.suit) && c.suit === solid[0]?.suit);
  const isFlush = n === 5 && (solid.length === 0 || sameSuit);
  const isStraight = n === 5 && isStraightRanks(cards.map((c) => c.rank));

  // SECRET HANDS first — five of one rank beats everything printed on the
  // chart, and if those five ALSO agree on a suit it is the top of the ladder.
  // maxCount is a count of REAL ranks, so a wild never donates a fifth King:
  // wilds are suit-wild only, which is what makes FLUSH FIVE the reachable one
  // (four dupes + a wild share a suit, five dupes share a rank).
  if (n === 5 && maxCount === 5) return result(isFlush ? 'flushFive' : 'fiveOfAKind');
  if (isStraight && isFlush) return result('straightFlush');
  if (maxCount >= 4) return result('quads');
  if (n === 5 && counts[0] === 3 && counts[1] === 2) return result('fullHouse');
  if (isFlush) return result('flush');
  if (isStraight) return result('straight');
  if (maxCount === 3) return result('trips');
  if (counts[0] === 2 && counts[1] === 2) return result('twoPair');
  if (maxCount === 2) return result('pair');
  return result('highCard');
}

/**
 * THE BEST HAND INSIDE A PILE OF ANY SIZE.
 *
 * evaluateHand is deliberately 1-5 cards: that is the rule of the game and it
 * stays exactly as it is. GO-GO GOO (potions.js, 2026-08-02) is the one thing
 * that ever hands the scorer more than five cards at once, and it still has to
 * answer the question "what hand IS this?" — so it asks this instead: the best
 * five-card hand present sets the type and the mult, and the goo's own rule
 * (every card contributes its value) is applied on top by scoreHand.
 *
 * 1-5 cards fall straight through to evaluateHand, so nothing else in the game
 * changes behaviour by a single point. Above that it walks every five-card
 * combination, which is 56 of them for a full eight-card hand.
 *
 * @param {Card[]} cards
 * @returns {HandResult}
 */
export function bestHandOf(cards) {
  if (!Array.isArray(cards) || cards.length < 1) {
    throw new RangeError('bestHandOf: need at least one card');
  }
  if (cards.length <= 5) return evaluateHand(cards);
  let best = null;
  let bestRank = -1;
  const pick = [];
  const walk = (start) => {
    if (pick.length === 5) {
      const hand = evaluateHand(pick);
      const rank = HAND_TYPES.indexOf(hand.type);
      if (rank > bestRank) { bestRank = rank; best = hand; }
      return;
    }
    for (let i = start; i < cards.length; i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}

/**
 * THE MODE of a run's played hands — the hand type played most often so far.
 * Reads run.stats.handTypeCounts, which is keyed by DISPLAY NAME (the recap
 * prints it), so it translates back through HAND_TYPE_BY_NAME.
 * Ties break toward the HIGHER-mult hand (base mult, then ladder position), so
 * the Worn Anvil's promise is never the weaker of two equally-loved hands.
 * @param {{stats?: {handTypeCounts?: Object}}} run
 * @returns {string|null} hand type key, or null if nothing has been played
 */
export function mostPlayedHandType(run) {
  const counts = run?.stats?.handTypeCounts ?? {};
  let best = null;
  let bestCount = 0;
  for (const [name, rawCount] of Object.entries(counts)) {
    const type = HAND_TYPE_BY_NAME[name];
    const count = Number(rawCount) || 0;
    if (!type || count <= 0) continue;
    if (count > bestCount) { best = type; bestCount = count; continue; }
    if (count === bestCount && best) {
      const better = HAND_DEFS[type].mult - HAND_DEFS[best].mult
        || HAND_TYPES.indexOf(type) - HAND_TYPES.indexOf(best);
      if (better > 0) best = type;
    }
  }
  return best;
}

/**
 * Balatro rule: only the cards that FORM the hand score — kickers do nothing.
 * Returns the Set of card ids that participate in the given hand type.
 * straight/flush/fullHouse/straightFlush use all five; of-a-kinds use only the
 * matched ranks; high card uses only the single highest-ranked card.
 * @param {Card[]} cards
 * @param {HandResult} hand - result of evaluateHand(cards)
 * @returns {Set<string>}
 */
export function scoringIds(cards, hand) {
  const all = () => new Set(cards.map((c) => c.id));
  switch (hand.type) {
    case 'straight':
    case 'flush':
    case 'fullHouse':
    case 'straightFlush':
    case 'fiveOfAKind':
    case 'flushFive':
      return all();
    case 'quads':
    case 'trips':
    case 'pair':
    case 'twoPair': {
      const counts = rankCounts(cards);
      const need = hand.type === 'quads' ? 4 : hand.type === 'trips' ? 3 : 2;
      const ids = new Set();
      for (const c of cards) {
        if ((counts.get(c.rank) ?? 0) >= need) ids.add(c.id);
      }
      return ids;
    }
    case 'highCard':
    default: {
      let best = cards[0];
      for (const c of cards) if (c.rank > best.rank) best = c;
      return new Set([best.id]);
    }
  }
}
