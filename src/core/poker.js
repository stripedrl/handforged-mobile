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
 *
 * FLUSH HOUSE (2026-08-06) joins them as the third secret: a full house whose
 * five cards ALSO agree on a suit. Unlike the other two it IS reachable from a
 * legal deck the moment a single WILD is in play (a wild counts as every suit,
 * so trips + pair + one wild suit is a flush), which makes it the secret a
 * player can stumble into rather than build a whole deck toward.
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
 * @property {number} base - the hand's own BASE VALUE at level 0 (score side)
 */

/**
 * THE HANDS OVERHAUL (JC, 2026-08-06). Every hand now brings TWO numbers to the
 * table instead of one:
 *
 *   base       the hand's own VALUE, landing on the SCORE side of the equation
 *              before a single card has ticked. This is the "starting equation
 *              to work from" — a Full House is 30 × 4 before you have added one
 *              point of card value to it.
 *   mult       unchanged in meaning: the multiplier the score side is taken
 *              against.
 *   valueStep  extra BASE VALUE per Smith (hand-upgrade) level.
 *   levelStep  extra MULT per Smith level.
 *
 * So a temper is worth strictly more than it used to be, in both currencies,
 * and the ladder finally reads as a ladder: High Card 5×1 = 5 against a Flush
 * Five's 100×16 = 1,600 before either of them has looked at a card.
 *
 * THE BASE IS DAMAGE-SIDE ONLY. It joins the score side and multiplies out into
 * damage; it contributes NOTHING to heal (Hearts), shield (Diamonds), the club
 * splash's per-card share or chips — those stay pure card-value channels. See
 * scoring.js (handBase) for the one place it is added.
 */
export const HAND_DEFS = {
  highCard: { name: 'High Card', base: 5, mult: 1, valueStep: 5, levelStep: 1 },
  pair: { name: 'Pair', base: 10, mult: 2, valueStep: 5, levelStep: 1 },
  twoPair: { name: 'Two Pair', base: 15, mult: 2, valueStep: 10, levelStep: 1 },
  trips: { name: 'Three of a Kind', base: 20, mult: 3, valueStep: 10, levelStep: 2 },
  straight: { name: 'Straight', base: 25, mult: 4, valueStep: 10, levelStep: 2 },
  flush: { name: 'Flush', base: 25, mult: 4, valueStep: 10, levelStep: 2 },
  fullHouse: { name: 'Full House', base: 30, mult: 4, valueStep: 15, levelStep: 2 },
  quads: { name: 'Four of a Kind', base: 40, mult: 7, valueStep: 20, levelStep: 3 },
  straightFlush: { name: 'Straight Flush', base: 60, mult: 8, valueStep: 25, levelStep: 4 },
  // --- SECRET, above the printed chart. `secret: true` is the ONLY gate: the
  // Smith's pool, the hands chart and the discovery ledger all read this flag,
  // so a future secret hand needs nothing but an entry here.
  //
  // LADDER ORDER IS THIS OBJECT'S KEY ORDER (HAND_TYPES), and bestHandOf ranks
  // by it — so FLUSH HOUSE sits between FIVE OF A KIND and FLUSH FIVE exactly
  // where its mult puts it (12 · 14 · 16).
  fiveOfAKind: { name: 'Five of a Kind', base: 75, mult: 12, valueStep: 25, levelStep: 4, secret: true },
  flushHouse: { name: 'Flush House', base: 100, mult: 14, valueStep: 25, levelStep: 4, secret: true },
  flushFive: { name: 'Flush Five', base: 100, mult: 16, valueStep: 30, levelStep: 5, secret: true },
};

/**
 * The hand's numbers AT A GIVEN SMITH LEVEL — the one place value and mult are
 * derived, so the Smith's tooltip, the hands chart, the combat equation and the
 * engine can never quote different arithmetic. `level` is 0-based (0 = "Lv.1").
 * @param {string} type
 * @param {number} level
 * @returns {{ base: number, mult: number, def: object }}
 */
export function handStats(type, level = 0) {
  const def = HAND_DEFS[type];
  if (!def) return { base: 0, mult: 0, def: null };
  const l = Math.max(0, Math.round(Number(level) || 0));
  return { base: def.base + l * def.valueStep, mult: def.mult + l * def.levelStep, def };
}

export const HAND_TYPES = Object.keys(HAND_DEFS);

/** The hidden-until-played hand types, in ladder order. */
export const SECRET_HAND_TYPES = HAND_TYPES.filter(t => HAND_DEFS[t].secret);

/** Display name -> machine key. run.stats.handTypeCounts is keyed by NAME. */
export const HAND_TYPE_BY_NAME = Object.fromEntries(
  HAND_TYPES.map(t => [HAND_DEFS[t].name, t]),
);

/**
 * HAS THIS RUN PLAYED THIS HAND? (JC, 2026-08-06 — the Smith's gating fix.)
 *
 * There are two different questions about a secret hand and they had been
 * answered by one ledger:
 *
 *   "have I ever SEEN it?"   progress.discoveredHands, LIFETIME. Still what
 *                            decides whether the hands chart prints a name or
 *                            a '???' row — seen-ever means named-forever.
 *   "have I made it HERE?"   run.stats.handTypeCounts, THIS RUN. What decides
 *                            whether the Smith will temper it, whether the Worn
 *                            Anvil may force it, and whether the Traveling
 *                            Smith's free level can land on it.
 *
 * Tempering FLUSH FIVE on a deck that cannot make one is a dead pick, and a
 * lifetime ledger handed the player exactly that on every run after the first.
 *
 * handTypeCounts is keyed by DISPLAY NAME (the recap prints it), so this reads
 * through the def rather than the machine key.
 */
export function handPlayedThisRun(run, type) {
  const def = HAND_DEFS[type];
  if (!def) return false;
  const counts = run?.stats?.handTypeCounts ?? {};
  return (Number(counts[def.name]) || 0) > 0;
}

/**
 * The hand types the SMITH may temper this run: every printed hand, plus any
 * secret this run has actually made. Ladder order.
 */
export function offerableHandTypes(run) {
  return HAND_TYPES.filter(t => !HAND_DEFS[t].secret || handPlayedThisRun(run, t));
}

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
  return { type, name: def.name, mult: def.mult, base: def.base };
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
  // FLUSH HOUSE (2026-08-06): a full house whose five cards also agree on a
  // suit. It has to be asked BEFORE quads and before the plain full house, or
  // the hand would answer with the lesser of the two things it genuinely is —
  // and after flushFive above, because five of one rank in one suit is both a
  // flush five and (vacuously) not a full house at all. maxCount is already
  // known to be < 5 here, so `3 and 2` is an honest trips+pair.
  if (isFlush && counts[0] === 3 && counts[1] === 2) return result('flushHouse');
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
    case 'flushHouse':
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
