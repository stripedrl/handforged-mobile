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
 * @property {number[]} [idx] - PRESENT ONLY when the hand formed from fewer
 *   cards than were evaluated (a four-card flush inside a five-card selection).
 *   The positions, in the evaluated array, of the cards that FORMED the hand;
 *   scoringIds reads it and everything else greys out as a kicker.
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
  /**
   * SIX OF A KIND (JC spec, 2026-08-10) — THE TOP OF THE LADDER.
   *
   * LAST IN THIS OBJECT ON PURPOSE. The ladder IS this object's key order
   * (HAND_TYPES) and bestHandOf ranks by it, so the hand that outranks FLUSH
   * FIVE has to sit after it. (The spec says "above flushFive"; above in POWER
   * is after in key order, and the hands chart reads top-down in the same
   * order, so it prints on the last row exactly where Flush Five prints today.)
   *
   * IT BRINGS NO MULT OF ITS OWN. `mult: 1` is the neutral element, not a
   * number: what this hand does instead is SQUARE the finished mult, once, at
   * the very end of the mult computation (scoring.js, step 8b — search
   * squaresMult). A hand that also added mult would be paid twice.
   *
   * NO LEVELS. valueStep/levelStep are 0 and `noSmith` keeps it off every
   * Smith path (offerableHandTypes, the Worn Anvil's forced offer, the
   * Traveling Smith), so nothing can ever temper it. The Forge Eternal can
   * still write a level onto it and it is inert by construction, which is the
   * belt-and-braces version of the same rule.
   *
   * ONLY REACHABLE UNDER mods.ofAKindMinus1 (THE UNDERSTUDY, next wave): five
   * of one rank counts as six. Flush Five routes here too — there is no
   * FLUSH SIX, by design.
   */
  sixOfAKind: {
    name: 'Six of a Kind', base: 100, mult: 1, valueStep: 0, levelStep: 0,
    secret: true, noSmith: true, glitch: true, squaresMult: true,
  },
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
 * MAY THE SMITH TOUCH THIS HAND AT ALL?
 *
 * A separate question from "is it secret". SIX OF A KIND is a hand with no
 * levels — no valueStep, no levelStep, nothing to sell — so it must never
 * appear on the shelf even after the player has made one, and it must never be
 * the Worn Anvil's forced offer or the Traveling Smith's free level. One
 * predicate, read by all three, so a future levelless hand needs nothing but
 * `noSmith: true` in its def.
 */
export function isSmithable(type) {
  return !HAND_DEFS[type]?.noSmith;
}

/**
 * The hand types the SMITH may temper this run: every printed hand, plus any
 * secret this run has actually made, minus anything that has no levels to sell.
 * Ladder order.
 */
export function offerableHandTypes(run) {
  return HAND_TYPES.filter(t => isSmithable(t)
    && (!HAND_DEFS[t].secret || handPlayedThisRun(run, t)));
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
 * True if these ranks form an unbroken run of DISTINCT values. Ace may play
 * high (10-J-Q-K-A) or low (A-2-3-4-5); no wraparound (Q-K-A-2-3 is NOT a
 * straight).
 *
 * LENGTH-AGNOSTIC since 2026-08-10, because THE ROPE LADDER lets a straight
 * form with four cards. For five ranks it answers exactly what the old
 * hand-rolled five-card version answered — same three cases, same order — so
 * every existing suite is the proof that nothing moved:
 *   · duplicates      -> false (uniq.length !== ranks.length)
 *   · span === len-1  -> true  (5 values spanning 4)
 *   · ace low         -> the Ace becomes a 1 and the same span test is retried
 *                        ([2,3,4,5,14] -> [1,2,3,4,5]), which is the aceLow
 *                        literal generalised.
 * @param {number[]} ranks
 * @returns {boolean}
 */
function isRunOfRanks(ranks) {
  const uniq = Array.from(new Set(ranks));
  if (uniq.length !== ranks.length) return false;
  const sorted = uniq.slice().sort((a, b) => a - b);
  const span = (arr) => arr[arr.length - 1] - arr[0] === arr.length - 1;
  if (span(sorted)) return true;
  // ACE LOW: swap the Ace for a 1 and ask the same question again.
  if (sorted[sorted.length - 1] === 14) {
    return span([1, ...sorted.slice(0, -1)]);
  }
  return false;
}

/**
 * THE UNDERSTUDY'S RULE (JC spec, 2026-08-10) — `mods.ofAKindMinus1`.
 *
 * Every RANK GROUP counts as one card larger, so an of-a-kind hand forms with
 * one fewer card than it needs: 1 card = Pair, 2 = Three of a Kind, 3 = Four of
 * a Kind, 4 = Five of a Kind, 5 of a rank = SIX OF A KIND. The card-count gates
 * that guard the five-card-only types relax by the same one (`n + shift >= 5`),
 * which is what lets a FOUR-card hand of one rank be a Five of a Kind at all.
 *
 * It changes CLASSIFICATION, never selection: hands are still played from up to
 * five cards.
 *
 * WITHOUT THE FLAG shift is 0, `n + 0 >= 5` is `n === 5` (five is the maximum),
 * and `maxCount >= 6` is unreachable — so evaluation is byte-identical to what
 * it has always been. The existing suites are the proof.
 */
const shiftOf = (opts) => (opts?.ofAKindMinus1 ? 1 : 0);

/**
 * THE BROKEN COMPASS and THE ROPE LADDER (JC spec, 2026-08-10) —
 * `mods.flushMinus1` and `mods.straightMinus1`.
 *
 * A flush (compass) or a straight (ladder) forms with FOUR cards instead of
 * five. Like THE UNDERSTUDY these change CLASSIFICATION only: hands are still
 * played from up to five cards, wilds still count as every suit, and an Ace
 * still runs high or low.
 *
 * WHAT FALLS OUT OF IT, and none of it needed a line anywhere else:
 *   · THE KICKER RULE, UNBROKEN. A four-card flush scores its four cards. Play
 *     a FIFTH card of another suit alongside it and the hand is still a flush —
 *     the best-forming SUBSET wins (see bestSubsetHand) — and that fifth card
 *     is an ordinary kicker: grey, worth nothing, disposed of for free. One
 *     fewer card needed, and a free slot to thin the deck with, is the reward.
 *   · A FOUR-CARD FLUSH IS A FLUSH. Same HAND_DEF, same base, same mult, same
 *     Smith level, same name. So the METEOR SIGIL's flush-or-better AOE, the
 *     RISING TIDE's isFlushHand count, the PAINTER'S PALETTE's handFactor and
 *     the STRAIGHTEDGE's straight-family handValue all pay on it already.
 *   · BOTH AT ONCE make a four-card STRAIGHT FLUSH legal, which is the honest
 *     product of the two rules and needs no special case.
 *
 * THE FIVE-CARD MINIMUM IS A MINIMUM, not a magic number: `n >= 5 - relax`. A
 * three-card flush is still not a flush under the compass alone, and with the
 * flag off `n >= 5` is exactly the `n === 5` this has always tested.
 */
const flushMin = (opts) => (opts?.flushMinus1 ? 4 : 5);
const straightMin = (opts) => (opts?.straightMinus1 ? 4 : 5);

/**
 * THE THREE CLASSIFICATION FLAGS, DERIVED IN ONE PLACE (2026-08-10, alpha
 * 0.30c). Every caller that has to classify a hand — scoreHand, the combat
 * preview, the DOUBLE JEOPARDY gate, LIQUID ICE, the dev hooks — reads its
 * options bag through THIS function, off the same merged mods bag the belt
 * produces. That is the whole cure for the reported PREVIEW BUG: the preview
 * had hand-rolled its own bag and only ever copied ONE of the three flags
 * across, so a Broken Compass hand was named High Card on screen and scored as
 * a Flush a heartbeat later. A fourth classification relic now needs exactly
 * one line, here, and cannot desynchronise anything.
 * @param {object} [mods] a merged mods bag (run.collectMods) or anything
 *        carrying the same three channels
 * @returns {{ofAKindMinus1: boolean, flushMinus1: boolean, straightMinus1: boolean}}
 */
export function evalOptsFrom(mods = {}) {
  const m = mods ?? {};
  return {
    ofAKindMinus1: !!m.ofAKindMinus1,
    flushMinus1: !!m.flushMinus1,
    straightMinus1: !!m.straightMinus1,
  };
}

/** Does this options bag bend classification at all? */
function bendsClassification(opts) {
  return !!(opts?.ofAKindMinus1 || opts?.flushMinus1 || opts?.straightMinus1);
}

/** hand type -> its rung on the ladder (HAND_TYPES order). */
const LADDER_RANK = new Map(HAND_TYPES.map((t, i) => [t, i]));

/**
 * Every non-empty PROPER subset of `n` slots, as index arrays, BIGGEST FIRST
 * and lexicographic within a size. The order is the tie-break: a tie between
 * two subsets keeps the first one seen, so a bigger hand always wins a draw.
 * n is never more than 5, so this is at most 30 entries; memoised per size
 * because it is a constant.
 */
const PROPER_SUBSETS = [];
function properSubsets(n) {
  if (PROPER_SUBSETS[n]) return PROPER_SUBSETS[n];
  const out = [];
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const idx = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
    out.push(idx);
  }
  // Two-key sort: size DESC, then the index list lexicographically ASC.
  out.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  PROPER_SUBSETS[n] = out;
  return out;
}

/**
 * THE BEST HAND INSIDE THE SELECTION — KICKER SUBSETS (JC spec, 2026-08-10).
 *
 * Four suited cards plus one stranger is still a FLUSH under the Broken
 * Compass; the stranger is an ordinary KICKER — grey, worth nothing, and
 * useful purely as a card you got to throw away. The same sentence for the
 * Rope Ladder's four-card straight and for the Understudy's shifted rank
 * groups. So evaluation stopped asking "what is this pile?" and started asking
 * "what is the best hand ANY part of this pile makes?".
 *
 * THE PREFERENCE ORDER, exactly as specified:
 *   (a) a strictly HIGHER hand type wins, from any subset or from the whole
 *       selection. Four suited cards that happen to run 5-6-7-8 beat the
 *       five-card flush they sit inside, because a straight flush outranks it.
 *   (b) same type, MORE SCORING CARDS wins — five suited cards are a five-card
 *       flush and that is strictly more value than the four-card flush hiding
 *       inside it, so the compass never downgrades a hand you already had.
 *   (c) otherwise the four-card hand, and the leftover is a kicker.
 * A draw keeps the LARGER, EARLIER subset, which is why the whole selection is
 * the incumbent: nothing can displace it without being genuinely better.
 *
 * ONLY RUNS UNDER A FLAG. With none of the three relics in play a proper subset
 * can never win either test — the five-card-only types need all five cards, and
 * dropping a card can only shrink an of-a-kind — so the search is skipped
 * outright and evaluation is byte-identical to what it has always been. The
 * 3,000-hand no-flag sweep in relics0810 is the proof.
 */
function bestSubsetHand(cards, full, opts) {
  const n = cards.length;
  let best = full;
  let bestIdx = null;                       // null = the whole selection formed it
  let bestRank = LADDER_RANK.get(full.type) ?? -1;
  let bestScore = scoringIds(cards, full, opts).size;
  for (const idx of properSubsets(n)) {
    const sub = idx.map(i => cards[i]);
    const hand = classifyExact(sub, opts);
    const rank = LADDER_RANK.get(hand.type) ?? -1;
    if (rank < bestRank) continue;
    const score = scoringIds(sub, hand, opts).size;
    if (rank > bestRank || score > bestScore) {
      best = hand; bestIdx = idx; bestRank = rank; bestScore = score;
    }
  }
  // `idx` NAMES THE FORMING CARDS, by position in the array that was evaluated,
  // and is present ONLY when a proper subset won. scoringIds reads it and greys
  // everything else, which is how the kicker rule survives the change intact.
  return bestIdx ? { ...best, idx: bestIdx } : best;
}

/**
 * Evaluate a played hand of 1-5 cards and return the highest qualifying
 * hand type with its display name and base scoring multiplier.
 *
 * Under any of the three classification relics this returns the best hand over
 * QUALIFYING SUBSETS of the selection (see bestSubsetHand), and the winning
 * result carries `idx` — the positions of the cards that formed it — whenever
 * the hand came from fewer cards than were played.
 * @param {Card[]} cards
 * @param {{ofAKindMinus1?: boolean, flushMinus1?: boolean, straightMinus1?: boolean}} [opts]
 * @returns {HandResult}
 */
export function evaluateHand(cards, opts = {}) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 5) {
    throw new RangeError('evaluateHand: cards must be an array of 1-5 cards');
  }
  const full = classifyExact(cards, opts);
  if (cards.length < 2 || !bendsClassification(opts)) return full;
  return bestSubsetHand(cards, full, opts);
}

/**
 * THE CLASSIFIER PROPER: what this exact pile of cards is, with no subsets
 * considered. Every word of the ladder below is unchanged from the day it
 * shipped — evaluateHand simply asks it more than once now.
 * @param {Card[]} cards
 * @param {{ofAKindMinus1?: boolean, flushMinus1?: boolean, straightMinus1?: boolean}} opts
 * @returns {HandResult}
 */
function classifyExact(cards, opts = {}) {
  const n = cards.length;
  const shift = shiftOf(opts);
  // Every rank group counts as `shift` larger. Sorted BEFORE the shift, which
  // is the same order after it (a constant added to every element).
  const counts = Array.from(rankCounts(cards).values())
    .sort((a, b) => b - a).map(c => c + shift);
  const maxCount = counts[0];
  // "Does this hand have enough cards for a five-card type?" — one card fewer
  // under the flag, so a four-card hand of one rank really is a Five of a Kind.
  const hasFive = n + shift >= 5;

  // Wilds count as any suit: the non-wild cards must agree on one.
  const solid = cards.filter(c => !isWild(c));
  const sameSuit = solid.every(c => SUITS.includes(c.suit) && c.suit === solid[0]?.suit);
  const isFlush = n >= flushMin(opts) && (solid.length === 0 || sameSuit);
  const isStraight = n >= straightMin(opts) && isRunOfRanks(cards.map((c) => c.rank));

  // SECRET HANDS first — five of one rank beats everything printed on the
  // chart, and if those five ALSO agree on a suit it is the top of the ladder.
  // maxCount is a count of REAL ranks, so a wild never donates a fifth King:
  // wilds are suit-wild only, which is what makes FLUSH FIVE the reachable one
  // (four dupes + a wild share a suit, five dupes share a rank).
  //
  // SIX OF A KIND sits above both, and there is NO FLUSH SIX: five of one rank
  // in one suit is a SIX OF A KIND and nothing else (JC, explicit). Asked
  // first, so the flush variant below can never claim it.
  if (maxCount >= 6) return result('sixOfAKind');
  if (hasFive && maxCount === 5) return result(isFlush ? 'flushFive' : 'fiveOfAKind');
  if (isStraight && isFlush) return result('straightFlush');
  // FLUSH HOUSE (2026-08-06): a full house whose five cards also agree on a
  // suit. It has to be asked BEFORE quads and before the plain full house, or
  // the hand would answer with the lesser of the two things it genuinely is —
  // and after flushFive above, because five of one rank in one suit is both a
  // flush five and (vacuously) not a full house at all. maxCount is already
  // known to be < 5 here, so `3 and 2` is an honest trips+pair.
  //
  // `>=` RATHER THAN `===` (alpha 0.30c). Found while proving the invariant
  // "a classification relic may upgrade a hand but must never downgrade one":
  // under THE UNDERSTUDY a suited trips+pair shifts to counts [4,3], which
  // failed the `=== 3 && === 2` test and fell through to FOUR OF A KIND — three
  // rungs BELOW the flush house the player actually held. A relic that makes
  // your best hand worse is a bug however you spell it.
  //
  // IT CHANGES NOTHING WITHOUT THE FLAG. Five cards cannot hold a group of 4
  // and a second group of 2 (that is six cards), so with shift 0 `>=` and `===`
  // select exactly the same hands, and fewer than five cards can never satisfy
  // 3+2 at all. The no-flag identity sweep is the proof.
  if (isFlush && counts[0] >= 3 && counts[1] >= 2) return result('flushHouse');
  if (maxCount >= 4) return result('quads');
  if (hasFive && counts[0] === 3 && counts[1] === 2) return result('fullHouse');
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
 * @param {{ofAKindMinus1?: boolean, flushMinus1?: boolean, straightMinus1?: boolean}} [opts]
 *        passed straight through to evaluateHand
 * @returns {HandResult}
 */
export function bestHandOf(cards, opts = {}) {
  if (!Array.isArray(cards) || cards.length < 1) {
    throw new RangeError('bestHandOf: need at least one card');
  }
  if (cards.length <= 5) return evaluateHand(cards, opts);
  let best = null;
  let bestRank = -1;
  const pick = [];                          // INDICES into `cards`, not cards
  const walk = (start) => {
    if (pick.length === 5) {
      const hand = evaluateHand(pick.map(i => cards[i]), opts);
      const rank = HAND_TYPES.indexOf(hand.type);
      if (rank > bestRank) {
        bestRank = rank;
        // A hand out of eight cards ALWAYS forms from a subset, and evaluateHand
        // may have narrowed it further (a four-card flush inside the five-card
        // pick). Lift whatever it chose back onto the WHOLE pile so `idx` never
        // names positions in an array the caller has never seen.
        const inner = hand.idx ?? [0, 1, 2, 3, 4];
        best = { ...hand, idx: inner.map(j => pick[j]) };
      }
      return;
    }
    for (let i = start; i < cards.length; i++) {
      pick.push(i);
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
 * @param {{ofAKindMinus1?: boolean, flushMinus1?: boolean, straightMinus1?: boolean}} [opts]
 *        the SAME flags evaluateHand was given. The flush/straight relics need
 *        nothing here beyond `hand.idx`: those types score every card that
 *        FORMED them, so a four-card flush scores its four cards and the fifth
 *        card in the selection greys out as an ordinary kicker.
 * @returns {Set<string>}
 */
export function scoringIds(cards, hand, opts = {}) {
  // THE FORMING SUBSET (2026-08-10, alpha 0.30c). When evaluateHand had to drop
  // a card to make the hand — four suited cards inside a five-card selection —
  // `hand.idx` names the cards that formed it, BY POSITION, and everything else
  // is a kicker by definition: grey, worth nothing, thrown away for free.
  //
  // BY POSITION AND NOT BY ID on purpose: five stacked duplicates of one printed
  // card (Mirror Image, the Crown's Aces) can share an id, and a filter on ids
  // would quietly hand back more cards than formed the hand.
  const idx = hand?.idx;
  if (Array.isArray(idx) && idx.length && idx.length !== cards.length) {
    const sub = idx.map(i => cards[i]).filter(Boolean);
    // `idx: null` on the recursive call: the subset IS the whole hand now, so
    // this can never loop.
    return scoringIds(sub, { ...hand, idx: null }, opts);
  }
  const all = () => new Set(cards.map((c) => c.id));
  switch (hand.type) {
    case 'straight':
    case 'flush':
    case 'fullHouse':
    case 'straightFlush':
    case 'fiveOfAKind':
    case 'flushHouse':
    case 'flushFive':
    case 'sixOfAKind':
      return all();
    case 'quads':
    case 'trips':
    case 'pair':
    case 'twoPair': {
      const counts = rankCounts(cards);
      // The SAME shift the classification used, or the hand would be named for
      // one rule and scored by another: under the flag a Pair needs one card
      // of a rank, so every card in the hand forms it.
      const shift = shiftOf(opts);
      const need = (hand.type === 'quads' ? 4 : hand.type === 'trips' ? 3 : 2) - shift;
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
