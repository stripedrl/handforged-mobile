/**
 * @file deck.js
 * Pure-logic card/deck primitives for HANDFORGED. No DOM, no Phaser, no RNG
 * beyond an injectable `rng` function (defaults to Math.random). Runs
 * identically in Node and the browser.
 */

/**
 * @typedef {'swords'|'hearts'|'gems'|'clovers'} Suit
 * suit meaning: swords = spades (physical), hearts = hearts (healing),
 * gems = diamonds (shield), clovers = clubs (status/poison-ish damage).
 */

/**
 * @typedef {Object} Card
 * @property {string} id - stable id, e.g. "swords-14"
 * @property {Suit} suit
 * @property {number} rank - integer 2-14 (11=J, 12=Q, 13=K, 14=A)
 */

/** @type {Suit[]} */
export const SUITS = ['swords', 'hearts', 'gems', 'clovers'];

/** Ranks used by the deck: 2..10, J(11), Q(12), K(13), A(14). */
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * Face value of a rank for scoring purposes.
 * 2-10 => itself, J/Q/K => 10, Ace => 11.
 * @param {number} rank
 * @returns {number}
 */
export function cardValue(rank) {
  if (rank >= 2 && rank <= 10) return rank;
  if (rank === 11 || rank === 12 || rank === 13) return 10;
  if (rank === 14) return 11;
  throw new RangeError(`cardValue: invalid rank ${rank}`);
}

/**
 * Human-readable label for a rank: '2'..'10', 'J', 'Q', 'K', 'A'.
 * @param {number} rank
 * @returns {string}
 */
export function rankLabel(rank) {
  switch (rank) {
    case 11: return 'J';
    case 12: return 'Q';
    case 13: return 'K';
    case 14: return 'A';
    default:
      if (rank >= 2 && rank <= 10) return String(rank);
      throw new RangeError(`rankLabel: invalid rank ${rank}`);
  }
}

/**
 * SHORT CARD NAMES (JC, 2026-08-01 — the transformation-transparency pass).
 * 'K SWORDS', '4 DIAMONDS'. Every option or event that used to say "your
 * highest card" now says WHICH card, resolved off the live deck at offer time,
 * so the price of a deal is a thing you can read before you pay it.
 *
 * Suit display names are read out of the SUIT_GLYPH table at call time rather
 * than baked in, exactly like run.cardKey — rename a suit and this renames too.
 * Deliberately built with a local table instead of importing config.js: deck.js
 * is the bottom of the dependency stack and stays that way.
 * @param {Card} card
 */
const SUIT_SHORT = { swords: 'SWORDS', hearts: 'HEARTS', gems: 'DIAMONDS', clovers: 'CLUBS' };
export function cardLabel(card) {
  if (!card) return 'no card';
  const suit = SUIT_SHORT[card.suit] ?? String(card.suit ?? '?').toUpperCase();
  return `${rankLabel(card.rank)} ${suit}`;
}

/** 'K SWORDS and 4 CLUBS' · 'K SWORDS, 4 CLUBS and 2 HEARTS' · 'no cards' when empty. */
export function cardList(cards) {
  const names = (cards ?? []).filter(Boolean).map(cardLabel);
  if (!names.length) return 'no cards';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// THE ONE CARD ORDER (JC, 2026-08-02 — "some menus are not [sorted]")
// ---------------------------------------------------------------------------
// Every menu that shows a SET of cards reads them in the same order: suit in
// SUITS order (which is SUIT_GLYPH order: spades, hearts, diamonds, clubs),
// then rank ASCENDING, 2 first and Ace last. It used to be per-call-site
// `localeCompare` — which sorts clovers/gems/hearts/swords, i.e. the reverse of
// what the glyph table shows — and the deck browser sorted rank DESCENDING while
// the pickers sorted ascending, so the same 52 cards read differently depending
// on which door you came through.
//
// The ID TIE-BREAK is not decoration: a run deck holds MODDED DUPLICATES (two
// K SWORDS, one of them ETHEREAL) and without it their relative order would
// depend on the input array, so two openings of the same menu could disagree.
//
// The in-combat HAND is deliberately NOT a customer of this: its order is the
// player's, set by dragging, and only the SORT button may touch it.
// ---------------------------------------------------------------------------

/** suit id -> its index in SUITS. Anything unknown sorts to the back. */
const SUIT_RANK = SUITS.reduce((m, s, i) => { m[s] = i; return m; }, {});

/**
 * The canonical card comparator: suit (SUITS order), then rank ascending, then
 * id. Pure and total — safe as a bare `Array.prototype.sort` argument.
 * @param {Card} a
 * @param {Card} b
 * @returns {number}
 */
export function compareCards(a, b) {
  const sa = SUIT_RANK[a?.suit] ?? SUITS.length;
  const sb = SUIT_RANK[b?.suit] ?? SUITS.length;
  if (sa !== sb) return sa - sb;
  if (a?.rank !== b?.rank) return (a?.rank ?? 0) - (b?.rank ?? 0);
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

/** compareCards as a COPY: never reorders the caller's array (or run.runDeck). */
export function sortCards(cards) {
  return [...(cards ?? [])].sort(compareCards);
}

/**
 * Build a fresh, ordered 52-card deck.
 * @returns {Card[]}
 */
export function makeDeck() {
  /** @type {Card[]} */
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle. Returns a new array; does not mutate the input.
 * @param {Card[]} cards
 * @param {() => number} [rng] - injectable RNG in [0,1); defaults to Math.random
 * @returns {Card[]}
 */
export function shuffle(cards, rng = Math.random) {
  const result = cards.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

// ---------------------------------------------------------------------------
// HOPQUAKE / SLICE primitives (boss mechanics that rewrite the hand)
// ---------------------------------------------------------------------------

/**
 * The Sabre-Toothed Rabbit's quake: give every card a DIFFERENT random suit,
 * in place. The cards in a hand are references INTO run.runDeck, so this is a
 * temporary vandalism of the run's own deck — hence the receipt it returns,
 * which is the only way the suits ever find their way home.
 *
 * @param {Card[]} cards      mutated in place
 * @param {() => number} rng
 * @returns {{card: Card, origSuit: Suit}[]} the restore receipt
 */
export function scrambleSuits(cards, rng = Math.random) {
  const store = [];
  for (const card of cards) {
    store.push({ card, origSuit: card.suit });
    const pool = SUITS.filter(s => s !== card.suit);
    card.suit = pool[Math.floor(rng() * pool.length)] ?? card.suit;
  }
  return store;
}

/**
 * Cash in a scrambleSuits receipt. Safe to call twice (the second call is a
 * no-op on already-restored cards) and safe on cards that have since left the
 * hand — they are the same objects wherever they went.
 * @param {{card: Card, origSuit: Suit}[]} store
 * @returns {number} how many cards were put right
 */
export function restoreSuits(store) {
  if (!store) return 0;
  for (const { card, origSuit } of store) card.suit = origSuit;
  return store.length;
}

/**
 * Agatha's slice: choose up to `n` distinct victims from `cards`. Slicing a
 * hand with fewer than n cards simply cuts what is there.
 * @returns {Card[]|any[]} the chosen entries (same objects as the input)
 */
export function pickSliceVictims(cards, n, rng = Math.random) {
  const pool = cards.slice();
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}
