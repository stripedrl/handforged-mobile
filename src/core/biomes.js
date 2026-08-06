/**
 * @file biomes.js
 * THE BIOME ENGINE — the pure rules behind the three alternate acts.
 *
 *   ACT I   NOCTURNAL FOREST   BLIND    hides information
 *   ACT II  ETHEREAL PLAINS    FADE     costs you cards
 *   ACT III BURNING GALLOWS    BURNED   removes options
 *
 * Everything here is a pure function or a plain constant, for the same reason
 * core/statuses.js is: the highest-risk thing in this wave is a DEADLOCK, and a
 * deadlock has to be constructible in a unit test rather than farmed on a live
 * board. CombatScene owns the theatre and the wiring; this file owns the truth.
 *
 * THE CONTRACT (docs/PATCH_ORACLE.txt ADDENDUM) is fixed. Two names live on
 * `pstat` and are cleared by newFightState AND by the Cleansing Tea:
 *
 *   pstat.blind    turns remaining. A blinded card renders FACE DOWN and is
 *                  still playable. It denies INFORMATION, never the card, so it
 *                  deliberately does NOT go through the denial gate — it is a
 *                  render state and nothing else. That is the whole reason it
 *                  is the gentlest mechanic in the game.
 *   pstat.faded    card ids FADING for this fight: no bonus of any kind, and a
 *                  FADE_VANISH_CHANCE roll to fade away each time one scores.
 *                  Its own mechanic since 2026-08-04 — NOT ethereal.
 *
 * ...and four LEDGERS live on the scene and are reset by newFightState only:
 *
 *   burnedCards    card ids that may not be played again this fight. Survives a
 *                  discard-pile reshuffle. BURNED BEATS RECYCLED.
 *   usedHandTypes  hand types already played this fight.
 *   disabledRelics RAW row indices into run.artifacts doing nothing this fight.
 *   demandedHand   the hand type the player MUST play this turn, or null.
 */

import { HAND_TYPES, evaluateHand } from './poker.js';

// ---------------------------------------------------------------------------
// THE NUMBERS. Every tunable the sixteen effects read, declared once, so a test
// never has to hand-type one back and the content agent never has to guess.
// ---------------------------------------------------------------------------

/** BLIND, regular tier: how long the moonlight holds your cards face down. */
export const BLIND_TURNS = 1;
/** CONDEMN: turns a branded card has to be PLAYED before it burns for good. */
export const CONDEMN_TURNS = 2;
/**
 * PYRE TAX: HP per card in the hand you commit.
 *
 * 1 -> 3 (the content pass's tuning call, 2026-08-03). At 1 a full five-card
 * hand cost 5 HP out of PLAYER_BASE.maxHp 100, which is a fifth of ONE of the
 * Brazier Titan's ordinary swings. Nobody changes a habit over that, and the
 * whole design brief for the Titan is "BREAKS: full five-card hands. Suddenly
 * Dextra is right."
 *
 * THE NUMBERS IT WAS SET AGAINST. An elite room at row 8 in Act III scales
 * enemy damage by dmgBase 1.5 x the row ramp 1.4 x ENEMY_DAMAGE_SCALE 0.715 =
 * x1.50, so the Titan's printed 15 / 18 / 33 land as roughly 23 / 27 / 50
 * against a 100 HP player.
 *
 *   at 1   five cards costs  5 HP   = 22% of one ordinary swing   (invisible)
 *   at 2   five cards costs 10 HP   = 43%                          (felt)
 *   at 3   five cards costs 15 HP   = 65%, and 15% of the pool     (decisive)
 *
 * At 3 the DELTA is what does the work: a three-card hand costs 9 instead of
 * 15, so shrinking your hand buys back 6 HP every single time, and six full
 * hands would cost 90 HP against a 14,112 HP elite -- i.e. the room cannot be
 * won on five-card hands alone, which is exactly the sentence the design wrote.
 * At 2 the same delta is only 4 HP, which does not outweigh what a fifth card
 * usually adds to a hand's score.
 *
 * It is the TOP of the engine pass's suggested 2-3 band, on purpose: this is
 * one elite among four in the act, it is telegraphed at the opening bell by its
 * SIGNATURE, and the counterplay (play fewer cards) is available on turn one.
 * Flagged for JC: if a playtest reads the room as unwinnable rather than
 * expensive, 2 is the dial-back and it is this one number.
 */
export const CARD_TAX_PER_CARD = 3;
/** AS YOU DID: the Mirrorwalker throws back this % of your last hand's damage. */
export const MIRROR_HAND_PCT = 100;
/** THE SENTENCE: HP for ignoring a demanded hand type. */
export const DEMAND_HAND_DAMAGE = 12;
/** REWEAVE: cards off the deal per cast, for the rest of the fight. */
export const SHRINK_HAND_STEP = 1;

/**
 * The sixteen new effect types, exactly as the ADDENDUM names them.
 * `blind` and `fade` are absent on purpose: they are PLAYER DEBUFFS and ride
 * the existing applyPlayerDebuff door, not the biome dispatcher.
 */
export const BIOME_EFFECTS = new Set([
  'condemn', 'burnPlayed', 'handTypeOnce', 'demandHand', 'hangRelic',
  'wall', 'unusedOnly', 'forgetSuit', 'mirrorHand', 'shrinkHand', 'dropHand',
  'healMirror', 'cardTax', 'markCard',
]);

/** The two new pstat debuffs, for the HUD row and the tick-down. */
export const BIOME_DEBUFFS = ['blind', 'fade'];

/** All sixteen, for the intent vocabulary and the verification sweep. */
export const BIOME_EFFECT_TYPES = ['blind', 'fade', ...BIOME_EFFECTS];

/** The four suits, for forgetSuit's reroll. */
export const SUITS = ['swords', 'hearts', 'gems', 'clovers'];

// ---------------------------------------------------------------------------
// THE FOUR LEDGERS
// ---------------------------------------------------------------------------

/**
 * A blank set of per-fight ledgers. ONE factory, so newFightState and any test
 * that wants a clean board agree about the shape.
 * @returns {{burnedCards: Set<string>, usedHandTypes: Set<string>,
 *            disabledRelics: Set<number>, demandedHand: string|null}}
 */
export function freshBiomeLedgers() {
  return {
    burnedCards: new Set(),
    usedHandTypes: new Set(),
    disabledRelics: new Set(),
    demandedHand: null,
  };
}

// ---------------------------------------------------------------------------
// BURNED — the Gallows' ledger
// ---------------------------------------------------------------------------

/** Is this card spent for the rest of the fight? */
export function isBurned(burned, card) {
  const id = typeof card === 'string' ? card : card?.id;
  return !!id && !!burned?.has(id);
}

/** Burn a list of cards (ids or card objects). Returns how many were new. */
export function burnCards(burned, cards = []) {
  let added = 0;
  for (const c of cards) {
    const id = typeof c === 'string' ? c : c?.id;
    if (!id || burned.has(id)) continue;
    burned.add(id);
    added += 1;
  }
  return added;
}

/**
 * BURNED SURVIVES THE RESHUFFLE. The draw pile is rebuilt from the discard
 * exactly once per cycle, and this is the sieve it goes through — so a burned
 * card cannot come back around even if something else put it in the discard.
 *
 * It is also the SECOND of the two guarantees behind BURNED BEATS RECYCLED. The
 * first is at the call site (a burned card never reaches stowPlayedCard at all,
 * so the Oracle's Recycler is never asked about it); this one catches anything
 * that got into a pile by another door entirely.
 *
 * @returns {Card[]} a NEW array with every burned card removed
 */
export function purgeBurned(pile = [], burned) {
  if (!burned?.size) return [...pile];
  return pile.filter(c => !burned.has(c?.id));
}

// ---------------------------------------------------------------------------
// USED HAND TYPES — the Magistrate's ledger, and the lockout it can produce
// ---------------------------------------------------------------------------

/** Bank the type a played hand turned out to be. */
export function recordHandType(used, type) {
  if (!type) return false;
  if (used.has(type)) return false;
  used.add(type);
  return true;
}

/** Under DOUBLE JEOPARDY, has this hand type already had its day in court? */
export function handTypeSpent(used, type, once = true) {
  return !!once && !!type && !!used?.has(type);
}

/**
 * The most cards a hand may ever contain. FEAR and WINTER'S FORCE can push the
 * live ceiling below it; nothing can push it above.
 */
export const MAX_HAND_CARDS = 5;

/**
 * EVERY hand type the cards in front of you could actually form, by playing any
 * one to `maxCards` of them. 218 subsets for a full eight-card hand, so it is
 * cheap enough to ask at the top of every turn — and it is only ever asked
 * while DOUBLE JEOPARDY is running.
 *
 * A one-card hand is legal in this game, so 'highCard' is always in here for a
 * non-empty hand. That single fact is what makes the lockout below rare.
 *
 * PASS ONLY CARDS THE PLAYER COULD ACTUALLY COMMIT (2026-08-03). This walk is
 * pure combinatorics over the list it is handed; it has no idea a card is
 * court-locked, suit-sealed or burned. Handing it the raw fan therefore has it
 * report hand types the player is physically unable to play, which is the exact
 * bug THE LAST COURT surfaced — see mistrialDue below.
 *
 * `maxCards` is the same guard one level up: FEAR caps the selection at three,
 * and a four-card Two Pair the player cannot even select must not count as an
 * open case either.
 *
 * @param {Card[]} cards        cards that are legal to PLAY, not merely held
 * @param {number} maxCards     the live selection ceiling (1-5)
 * @returns {Set<string>} hand type keys
 */
export function achievableHandTypes(cards = [], maxCards = MAX_HAND_CARDS) {
  const out = new Set();
  const n = cards.length;
  const cap = Math.max(0, Math.min(MAX_HAND_CARDS, Math.floor(maxCards)));
  if (!n || !cap) return out;
  const pick = [];
  const walk = (start) => {
    if (pick.length) out.add(evaluateHand(pick).type);
    if (pick.length === cap) return;
    for (let i = start; i < n; i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

/**
 * THE MAGISTRATE'S LOCKOUT, and the ruling on it.
 *
 * DOUBLE JEOPARDY says each hand type may be played once for the whole fight.
 * Left alone, that ends a run to a rules technicality: play out the docket (or
 * merely hold a hand that can only form types you have already spent) and there
 * is no legal move left. Discarding is still legal, so it is not always fatal —
 * but with zero discards it is, and "the fight is unwinnable and also unloseable"
 * is worse than either.
 *
 * THE RULING: A MISTRIAL. When nothing the hand can form is still legal, the
 * ledger is WIPED and the whole docket starts again. It is thematic (a judge who
 * has heard every case opens a new session), it is a REWARD for surviving the
 * whole chart rather than a rescue, and — the part that matters — it makes the
 * deadlock impossible BY CONSTRUCTION instead of by potion mercy. The
 * deadlock matrix never has to know DOUBLE JEOPARDY exists.
 *
 * ============================================================================
 * THE REPAIR (2026-08-03), and why THE LAST COURT could not ship without it
 * ============================================================================
 * The construction above was TRUE ONLY WHILE DOUBLE JEOPARDY RAN ALONE. It asks
 * "is every type this hand could form already spent", and it used to ask that
 * of the whole fan — including cards the player is physically forbidden to
 * commit. Stack any CARD denial on top and the two refusals interlock:
 *
 *     THE COURT SLEEPS locks J/Q/K.  Docket: { highCard, pair }.
 *     Hand: J J 5 5, no discards left, no potion.
 *       · Two Pair needs the Jacks       -> refused by cardIsDenied
 *       · Pair (the fives) / High Card   -> refused by handTypeSpent
 *       · achievableHandTypes saw twoPair, which is NOT spent
 *           -> no mistrial, and the docket never clears
 *       · deadlockState sees an unlocked five and answers 'ok'
 *           -> no warning, no defeat
 *     The turn cannot end, so the fight can be neither won nor lost.
 *
 * That is a genuine SOFTLOCK, and it was reachable the moment the Hollow King
 * and the Magistrate stood on the same board. The same interlock exists with
 * Pyreheart's BURNED ledger and with the Keeper's suit seal, so this was a
 * latent hole in the shipped game and not a cost of the new fight.
 *
 * THE FIX IS TO ASK THE RIGHT QUESTION. A case is only open if the player can
 * actually bring it: the caller passes the cards that are legal to PLAY (not
 * merely held) and the live selection ceiling, and everything else follows.
 * In the example above the achievable set collapses to { highCard, pair }, both
 * spent, and the MISTRIAL fires exactly as its own docstring always promised.
 *
 * WHEN EVERY CARD IS DENIED this correctly returns FALSE and hands the problem
 * back where it belongs: that is a pure card-denial deadlock, and `deadlockState`
 * has owned that case (discard, potion, or an honest defeat) since long before
 * the Magistrate existed. A mistrial cannot unlock a King.
 *
 * @param {Card[]} cards      cards legal to PLAY this turn
 * @param {Set<string>} used  the docket
 * @param {boolean} once      is DOUBLE JEOPARDY actually running
 * @param {number} maxCards   the live selection ceiling (FEAR / WINTER'S FORCE)
 * @returns {boolean} whether the docket must clear before the player can act
 */
export function mistrialDue(cards = [], used, once = true, maxCards = MAX_HAND_CARDS) {
  if (!once || !cards.length) return false;
  const can = achievableHandTypes(cards, maxCards);
  if (!can.size) return false;
  for (const t of can) if (!used.has(t)) return false;
  return true;
}

/** Wipe the docket. Returns the types that were struck, for the announcement. */
export function declareMistrial(used) {
  const struck = [...used];
  used.clear();
  return struck;
}

/** Hand types still legal, in chart order — what the Magistrate's badge prints. */
export function remainingHandTypes(used) {
  return HAND_TYPES.filter(t => !used?.has(t));
}

// ---------------------------------------------------------------------------
// DISABLED RELICS — The Ropemaker's queue
// ---------------------------------------------------------------------------

/**
 * Which relic the noose takes next: LEFT TO RIGHT, so your chain unravels from
 * the front. `count` is run.artifacts.length — RAW cells, including mirrors and
 * the glove, because the row the player reads is the raw row.
 * @returns {number|null} the raw index, or null when everything is already hung
 */
export function nextHungRelic(count, disabled) {
  for (let i = 0; i < count; i++) if (!disabled.has(i)) return i;
  return null;
}

/**
 * A HUNG RELIC STILL OCCUPIES ITS SLOT.
 *
 * THE RULING (the question the brief asked): a relic the Ropemaker has hung is
 * replaced by an inert stub in the SAME CELL rather than removed from the row.
 * Mirrors therefore resolve positionally EXACTLY as they did before the noose
 * went on, and a mirror pointed at a hung relic copies a dead relic and is dead
 * too. Two reasons, both load-bearing:
 *
 *  1. If a hung relic vanished from the row, hanging cell 0 would silently
 *     RE-AIM the Phantom Cast in cell 1 at a different source. The Ropemaker
 *     would be handing you a new relic as often as it took one away, and "your
 *     chain unravels from the front" would be a lie.
 *  2. The ordered mult walk (collectModList) is read left to right by slot. A
 *     shifting row would move every relic's cell mid-fight, which changes the
 *     arithmetic of relics the noose never touched.
 *
 * So the CELL is preserved and only the CONTENT is emptied. Four fields are kept
 * because effectiveArtifactSlots' resolution reads them and the row's geometry
 * must not move: `uncopyable`, `props.nook` (the glove is not in the row at all)
 * — and the id is DELIBERATELY mangled, because a hung Forgery that kept its id
 * would still resolve to its neighbour and copy it, which is the one way a hung
 * relic could keep working.
 *
 * @param {object[]} list run.artifacts, raw
 * @param {Set<number>} disabled raw cell indices
 * @returns {object[]} a new array, same length, same cells
 */
export function hangArtifacts(list = [], disabled) {
  if (!disabled?.size) return list;
  return list.map((a, i) => (disabled.has(i) ? hungStub(a) : a));
}

/** One inert relic, keeping only what the row's geometry reads. */
export function hungStub(a) {
  return {
    ...a,
    id: `hung:${a?.id ?? '?'}`,
    hung: true,
    mods: null,
    hooks: null,
    active: null,
    props: a?.props?.nook ? { nook: a.props.nook } : {},
  };
}

// ---------------------------------------------------------------------------
// THE DAMAGE GATES — wall / unusedOnly / markCard / forgetSuit
// ---------------------------------------------------------------------------

/**
 * Does the hand you just played actually REACH this enemy?
 *
 * Four independent refusals, resolved in one place so the strike path asks one
 * question and the tooltip, the badge and the test all read the same answer.
 * `usedHandTypes` is the ledger BEFORE this hand is banked — the hand you are
 * playing right now has not been played yet, which is exactly what makes
 * NOTHING TWICE playable at all.
 *
 * @returns {{through: boolean, reason: string|null, label: string|null}}
 */
export function damageGate({
  handType = null, playedIds = [], usedHandTypes = null,
  wall = null, unusedOnly = false, markedId = null,
} = {}) {
  if (markedId && playedIds.includes(markedId)) {
    return { through: false, reason: 'marked', label: 'HE SEES IT COMING' };
  }
  if (wall && handType !== wall) {
    return { through: false, reason: 'wall', label: 'THE WALL HOLDS' };
  }
  if (unusedOnly && handType && usedHandTypes?.has(handType)) {
    return { through: false, reason: 'unused', label: 'NOTHING TWICE' };
  }
  return { through: true, reason: null, label: null };
}

/**
 * FORGETTING A SUIT, exactly. `damageBySuit` is scoreHand's per-suit RAW damage
 * split (added for this wave), so the strip is the suit's true share of the
 * hand's output rather than a guess based on card counts — every multiplier in
 * the equation is global, so a proportional strip is arithmetically exact.
 *
 * @returns {number} the factor to multiply the hand's damage by, in [0, 1]
 */
export function forgetSuitFactor(damageBySuit = {}, suit = null) {
  if (!suit) return 1;
  let total = 0;
  for (const s of SUITS) total += Math.max(0, damageBySuit[s] ?? 0);
  if (total <= 0) return 1;
  const gone = Math.max(0, damageBySuit[suit] ?? 0);
  return Math.max(0, Math.min(1, (total - gone) / total));
}

/** Which suit it forgets THIS turn. Prefers one the player is actually holding. */
export function pickForgottenSuit(hand = [], rng = Math.random, avoid = null) {
  const held = SUITS.filter(s => hand.some(c => c?.suit === s));
  let pool = held.length ? held : SUITS;
  if (avoid && pool.length > 1) pool = pool.filter(s => s !== avoid);
  return pool[Math.floor(rng() * pool.length)] ?? SUITS[0];
}

// ---------------------------------------------------------------------------
// THE TOLLS — cardTax / demandHand / mirrorHand / healMirror / shrinkHand
// ---------------------------------------------------------------------------

/** PYRE TAX: HP for committing a hand of `n` cards. */
export function cardTaxFor(n = 0, per = CARD_TAX_PER_CARD) {
  return Math.max(0, Math.round(Math.max(0, n) * Math.max(0, per)));
}

/** THE SENTENCE: did you obey, and what does disobeying cost? */
export function demandVerdict(demanded, played, damage = DEMAND_HAND_DAMAGE) {
  if (!demanded) return { obeyed: true, damage: 0 };
  if (demanded === played) return { obeyed: true, damage: 0 };
  return { obeyed: false, damage: Math.max(0, Math.round(damage)) };
}

/** AS YOU DID: your own last hand, thrown back. */
export function mirrorDamage(lastDamage = 0, pct = MIRROR_HAND_PCT) {
  return Math.max(0, Math.round((Math.max(0, lastDamage) * Math.max(0, pct)) / 100));
}

/** REFLECTION: every point you heal, it heals. */
export function healMirrorAmount(healed = 0, pct = 100) {
  return Math.max(0, Math.round((Math.max(0, healed) * Math.max(0, pct)) / 100));
}

/** REWEAVE: cards off the deal, accumulating across casts. */
export function shrinkTotal(current = 0, step = SHRINK_HAND_STEP) {
  return Math.max(0, Math.round(current + Math.max(0, step)));
}

// ---------------------------------------------------------------------------
// CONDEMN — the Hangman's brand
// ---------------------------------------------------------------------------

/**
 * One turn off every brand. A brand that runs out UNPLAYED burns its card out of
 * the deck for good — discarding does not save it, which is the whole point.
 *
 * `brands` is a list of `{ id, turns }`. Mutation is deliberately absent: the
 * caller gets a new list plus the ids to destroy, so a test can step the clock
 * without a scene.
 *
 * @returns {{brands: {id: string, turns: number}[], burn: string[]}}
 */
export function condemnTick(brands = []) {
  const next = [];
  const burn = [];
  for (const b of brands) {
    const turns = (b?.turns ?? 0) - 1;
    if (turns <= 0) burn.push(b.id);
    else next.push({ id: b.id, turns });
  }
  return { brands: next, burn };
}

/** A brand is discharged the moment its card is PLAYED (not discarded). */
export function dischargeBrands(brands = [], playedIds = []) {
  const ids = new Set(playedIds);
  return brands.filter(b => !ids.has(b.id));
}

/** How many turns the brand on this card has left (null when it is not branded). */
export function brandTurns(brands = [], id = null) {
  return brands.find(b => b.id === id)?.turns ?? null;
}

// ---------------------------------------------------------------------------
// BLIND & FADE — the two pstat debuffs
// ---------------------------------------------------------------------------

/**
 * Which cards the moonlight takes. Prefers cards that are NOT already blind and
 * NOT locked out of play — blinding a card you cannot play anyway is not a
 * puzzle, it is noise.
 * @returns {*[]} up to `n` entries from `hand`
 */
export function pickBlindTargets(hand = [], n = 1, { blinded = null, denied = () => false } = {}) {
  const free = hand.filter(c => !denied(c) && !(blinded && blinded.has(idOf(c))));
  const pool = free.length ? free : hand.filter(c => !(blinded && blinded.has(idOf(c))));
  return pool.slice(0, Math.max(0, n));
}

/**
 * Which cards start FADING. Never a card that is already fading, and never a
 * real ETHEREAL — fading a ghost would be taking away a mult the player paid
 * for, which is a different (and nastier) mechanic than the one designed.
 */
export function pickFadeTargets(hand = [], n = 1, faded = []) {
  const already = new Set(faded);
  const pool = hand.filter(c => !already.has(idOf(c)) && c?.mod !== 'ethereal');
  return pool.slice(0, Math.max(0, n));
}

/** Is this card FADING (all of the risk, none of any reward)? */
export function isFaded(faded, card) {
  const id = idOf(card);
  return !!id && (faded ?? []).includes(id);
}

const idOf = (c) => (typeof c === 'string' ? c : c?.id);

/**
 * THE FADED IDS AS A SET, for scoreHand. It reads a Set so a hand of eight is
 * eight lookups rather than eight scans, and it tolerates the ledger being
 * absent entirely (every fight outside Act II).
 */
export function fadedSet(pstat = {}) {
  return new Set(pstat.faded ?? []);
}
