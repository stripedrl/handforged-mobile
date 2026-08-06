/**
 * @file casino.js
 * THE TRAVELING CASINO (PATCH ORACLE, workstream 2) — three minigames at a
 * mystery node, or walk away.
 *
 * THIS FILE IS THE MONEY. Every chip the casino moves is decided here, in pure
 * functions with an injectable rng, and the overlay in ui/casino.js is only ever
 * allowed to ANIMATE what these return. A gambling minigame that miscounts is
 * worse than no minigame, so nothing about a payout is computed in a scene.
 *
 * ---------------------------------------------------------------------------
 * THE LEDGER RULE (and why it is not just "gainGold the winnings")
 * ---------------------------------------------------------------------------
 * A wager leaves your purse at FACE VALUE: `run.chips -= wager`, never through
 * gainGold. Spending is a cost, and run.js is explicit that a cost must never
 * route through the earn funnel.
 *
 * A payout is then split in two, which is the whole trick:
 *
 *   STAKE BACK  the part of the return that is your own wager coming home. Paid
 *               at FACE VALUE, exactly like the Wandering Tinker's refund: "a
 *               refund of money you already had" must not be multiplied by the
 *               difficulty gold factor or by a chip relic, or a 2x win on
 *               MYTHRIL (gold x0.75) would hand back 75 chips on a 50 wager and
 *               call it a win.
 *   PROFIT      everything above the stake. This is EARNED, so it goes through
 *               gainGold and picks up the difficulty gold factor, the dev slider
 *               and every chipGain relic (Sticky Gloves +25%, Chip Purse +15%).
 *
 * The two together mean a 2x blackjack win is worth exactly +wager before
 * relics, and more than that with them, on every difficulty. Lose and you are
 * out exactly the wager, never a chip more.
 *
 * The Banker's Vault is deliberately NOT special-cased: it pays interest on the
 * PILE at every encounter (run.payEncounterInterest), so casino winnings start
 * earning at the next room like any other chips, which is the correct answer and
 * needs no code here.
 *
 * ---------------------------------------------------------------------------
 * THE THREE GAMES, AND WHAT THE HOUSE TAKES
 * ---------------------------------------------------------------------------
 *   BLACKJACK   flat 2x on a win, wager back on a push, half back if you walk
 *               out mid hand. Dealer stands on all 17s.
 *   ROULETTE    a THIRTEEN POCKET traveling wheel: one green 0 and the numbers
 *               1 to 12, odds red and evens black, exactly as a real low wheel
 *               colours them. Red/black are even money (2x) at 6/13, so the
 *               house keeps 1/13 of every even-money bet. GREEN_PAYOUT is then
 *               DERIVED from that same cut rather than picked: see below.
 *   DUCK RACE   four ducks, one winner, 4x. Genuinely uniform, which makes it
 *               the only bet on the floor with no house edge at all. That is
 *               deliberate and it is the joke: the sucker's game is the one with
 *               the funny names, and it happens to be the fair one.
 */

import { SUITS, cardValue } from './deck.js';
import { gainGold } from './run.js';

// ---------------------------------------------------------------------------
// THE STAKES
// ---------------------------------------------------------------------------

export const MIN_WAGER = 50;
export const MAX_WAGER = 250;
export const WAGER_STEP = 50;

/** [50, 100, 150, 200, 250]. Built from the three constants, never typed out. */
export const WAGERS = (() => {
  const out = [];
  for (let w = MIN_WAGER; w <= MAX_WAGER; w += WAGER_STEP) out.push(w);
  return out;
})();

/** The steps this purse can actually cover. Empty when you cannot sit down. */
export function affordableWagers(chips) {
  return WAGERS.filter(w => w <= (chips ?? 0));
}

/** Can you cover the table minimum at all? */
export function canAffordTable(chips) {
  return (chips ?? 0) >= MIN_WAGER;
}

/**
 * The biggest step at or below `wanted` that this purse can cover, or 0 when it
 * cannot cover the minimum. The wager screen dims what you cannot afford, and
 * this is the belt-and-braces behind that: no path anywhere in the casino may
 * put more chips on the table than the player is holding.
 */
export function clampWager(wanted, chips) {
  const can = affordableWagers(chips);
  if (!can.length) return 0;
  const ok = can.filter(w => w <= (wanted ?? 0));
  return ok.length ? ok[ok.length - 1] : can[0];
}

// ---------------------------------------------------------------------------
// THE LEDGER
// ---------------------------------------------------------------------------

/**
 * What a wager and a total-return multiplier come to, before any earn
 * multiplier touches it. Pure arithmetic, no run, no rng, no chips move.
 *
 * `multiplier` is the TOTAL return as a multiple of the wager, the way a payout
 * table is written on a felt: 2 means "your 50 comes back as 100", 0 means the
 * house keeps it, 1 is a push, 0.5 is a surrender.
 *
 * @returns {{wager:number, multiplier:number, returned:number,
 *            stakeBack:number, profit:number, net:number}}
 */
export function settle(wager, multiplier) {
  const w = Math.max(0, Math.round(wager ?? 0));
  const returned = Math.round(w * (multiplier ?? 0));
  const stakeBack = Math.min(returned, w);
  return {
    wager: w,
    multiplier: multiplier ?? 0,
    returned,
    stakeBack,                       // face value: your own money coming home
    profit: returned - stakeBack,    // earned: goes through gainGold
    net: returned - w,               // what the hand was worth, pre-multipliers
  };
}

/**
 * PUT THE CHIPS ON THE TABLE. Deducts at face value and returns the amount
 * actually staked (0 if the purse could not cover it, in which case nothing
 * moved and the caller must not deal).
 */
export function placeWager(r, wager) {
  const w = Math.round(wager ?? 0);
  if (!(w > 0) || (r?.chips ?? 0) < w) return 0;
  r.chips -= w;
  return w;
}

/**
 * PAY THE HAND OUT. The stake comes back at face value, the profit is earned.
 * `gain` is injectable purely so a test can watch what was sent through the
 * funnel; the game always uses run.gainGold.
 *
 * @returns the settle() receipt plus `credited` (what gainGold actually paid,
 *          after difficulty/relics/dev slider) and `delta` (chips added here).
 */
export function payWager(r, wager, multiplier, gain = gainGold) {
  const s = settle(wager, multiplier);
  if (s.stakeBack) r.chips += s.stakeBack;
  const credited = s.profit ? gain(s.profit, r) : 0;
  return { ...s, credited, delta: s.stakeBack + credited };
}

// ---------------------------------------------------------------------------
// ONCE PER ACT
// ---------------------------------------------------------------------------
/**
 * Mystery nodes recur several times an act, so an uncapped casino is a chip
 * farm that undoes the economy pass. The cap is per ACT and it is spent by
 * PLAYING, not by looking: walking away from the table leaves the act's game
 * unspent, which is the fair reading of "at most once per act".
 *
 * It lives on `run.counters` rather than a new top-level field for one very
 * practical reason: `counters` is already in save.js's PLAIN_FIELDS, so this
 * round trips a quit-and-resume for free, and newRun() builds a fresh counters
 * object so a second run can never inherit the first one's spent acts.
 */
export function casinoPlayedActs(r) {
  const c = (r.counters ??= {});
  return (c.casinoActs ??= []);
}

/** Has this act's table already been played? */
export function casinoPlayed(r) {
  return casinoPlayedActs(r).includes(r?.actIndex ?? 0);
}

/**
 * May the Traveling Casino be rolled onto a mystery node right now? Two gates:
 * the once-per-act cap, and a purse that can cover the table minimum. A player
 * holding 30 chips is not shown a table he cannot sit at.
 */
export function casinoAvailable(r) {
  return !casinoPlayed(r) && canAffordTable(r?.chips);
}

/** Spend this act's game. Idempotent. */
export function markCasinoPlayed(r) {
  const acts = casinoPlayedActs(r);
  const i = r?.actIndex ?? 0;
  if (!acts.includes(i)) acts.push(i);
  return acts;
}

// ---------------------------------------------------------------------------
// BLACKJACK
// ---------------------------------------------------------------------------

export const BJ_TARGET = 21;
/** The dealer draws below this and stands on everything at or above it. */
export const BJ_DEALER_STANDS = 17;
/** Total return on a win / a push / walking out mid hand. */
export const BJ_WIN_PAYOUT = 2;
export const BJ_PUSH_PAYOUT = 1;
export const BJ_SURRENDER_PAYOUT = 0.5;

/** result -> the TOTAL return multiple. Every blackjack payout is in here. */
export const BJ_PAYOUTS = {
  win: BJ_WIN_PAYOUT,
  blackjack: BJ_WIN_PAYOUT,   // a natural is a win; deliberately not 3:2 (JC: 2x)
  push: BJ_PUSH_PAYOUT,
  surrender: BJ_SURRENDER_PAYOUT,
  bust: 0,
  lose: 0,
};

export function bjMultiplier(result) {
  return BJ_PAYOUTS[result] ?? 0;
}

/**
 * A fresh 52. Ranks 2..14 in all four suits, which is the game's own deck
 * shape, so every card the table deals renders through CardSprite in the
 * PLAYER'S OWN painted hero faces (paintedFace reads run.chrId).
 *
 * Deliberately NOT the run deck: a deck with three Jokers and a missing Ace is
 * not a blackjack shoe, and the odds of the game must not depend on what a pack
 * did to your cards two acts ago.
 */
export function blackjackShoe(rng = Math.random) {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) cards.push({ id: `bj-${suit}-${rank}`, suit, rank });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * The best legal total for a hand: aces are 11 until that busts, then 1.
 * cardValue() already answers 11 for an Ace and 10 for J/Q/K, which IS the
 * blackjack table, so the only work here is demoting aces.
 */
export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards ?? []) {
    total += cardValue(c.rank);
    if (c.rank === 14) aces++;
  }
  while (total > BJ_TARGET && aces > 0) { total -= 10; aces--; }
  return total;
}

/** Is the total being carried by an ace still counted as 11? ("soft 17") */
export function isSoft(cards) {
  let total = 0, aces = 0;
  for (const c of cards ?? []) {
    total += cardValue(c.rank);
    if (c.rank === 14) aces++;
  }
  while (total > BJ_TARGET && aces > 0) { total -= 10; aces--; }
  return aces > 0 && total <= BJ_TARGET;
}

export function isBust(cards) { return handTotal(cards) > BJ_TARGET; }
/** 21 on the first two cards. */
export function isNatural(cards) { return (cards?.length === 2) && handTotal(cards) === BJ_TARGET; }

/**
 * Deal a hand. The state object is the whole game: the overlay reads it, the
 * tests read it, and nothing else knows the rules.
 *
 * `phase` is one of 'player' (you may hit / stand / walk), 'dealer' (drawing)
 * and 'done'. `result` is a key of BJ_PAYOUTS once phase is 'done'.
 * `hole` is true while the dealer's second card is still face down.
 */
export function newBlackjack(rng = Math.random) {
  const state = {
    shoe: blackjackShoe(rng), player: [], dealer: [],
    phase: 'player', result: null, hole: true,
  };
  state.player.push(state.shoe.pop());
  state.dealer.push(state.shoe.pop());
  state.player.push(state.shoe.pop());
  state.dealer.push(state.shoe.pop());
  // NATURALS RESOLVE IMMEDIATELY, the way they do at a real table: nobody gets
  // to hit a two-card 21, and two naturals is a push.
  const pn = isNatural(state.player), dn = isNatural(state.dealer);
  if (pn || dn) {
    state.hole = false;
    state.phase = 'done';
    state.result = pn && dn ? 'push' : (pn ? 'blackjack' : 'lose');
  }
  return state;
}

/** Take a card. Busting ends the hand on the spot. */
export function bjHit(state) {
  if (state.phase !== 'player') return state;
  state.player.push(state.shoe.pop());
  if (isBust(state.player)) {
    state.hole = false;
    state.phase = 'done';
    state.result = 'bust';
  }
  return state;
}

/**
 * Stand: the hole card turns over and the dealer draws to BJ_DEALER_STANDS,
 * standing on soft 17 as well as hard (S17, the friendlier house rule, and the
 * one printed on the table so the player can read it before betting).
 */
export function bjStand(state) {
  if (state.phase !== 'player') return state;
  state.hole = false;
  state.phase = 'dealer';
  while (handTotal(state.dealer) < BJ_DEALER_STANDS) state.dealer.push(state.shoe.pop());
  const you = handTotal(state.player), them = handTotal(state.dealer);
  state.phase = 'done';
  if (them > BJ_TARGET || you > them) state.result = 'win';
  else if (you < them) state.result = 'lose';
  else state.result = 'push';
  return state;
}

/**
 * WALKING OUT MID HAND. Late surrender: half the wager comes back, the hand is
 * dead. This exists because "I want to stop" has to be a DEFINED money path and
 * not an accident of closing an overlay: the stake is already off the purse the
 * moment the cards come out, so without this the only honest answer to a quit
 * would be forfeiting the lot.
 */
export function bjSurrender(state) {
  if (state.phase !== 'player') return state;
  state.hole = false;
  state.phase = 'done';
  state.result = 'surrender';
  return state;
}

/** The one-line verdict the result panel prints. */
export const BJ_RESULT_TEXT = {
  blackjack: 'BLACKJACK. Twenty one off the deal.',
  win: 'You beat the dealer.',
  push: 'A push. Your chips come back untouched.',
  bust: 'Bust. The dealer barely looks up.',
  lose: 'The dealer takes it.',
  surrender: 'You fold and take half the wager back.',
};

// ---------------------------------------------------------------------------
// ROULETTE
// ---------------------------------------------------------------------------

/**
 * THE WHEEL WE ACTUALLY DREW: thirteen pockets. One green 0 and the numbers 1
 * to 12, coloured the way a real wheel colours its low numbers (odds red, evens
 * black). A wagon that packs up every night does not carry thirty seven
 * pockets, and thirteen is small enough that a spinning wheel on a 1920 screen
 * can print every number legibly.
 *
 * The ORDER below is the physical ring, scattered like a real wheel rather than
 * counted 0..12 round the rim: it alternates red and black the whole way and
 * puts 0 between 12 and 7. Nothing in the maths depends on the order (the
 * pockets are uniform); it is there so the wheel looks made rather than
 * generated.
 */
export const WHEEL_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 12];
export const GREEN_NUMBER = 0;

export function pocketColor(n) {
  if (n === GREEN_NUMBER) return 'green';
  return n % 2 === 1 ? 'red' : 'black';
}

/** [{ n, color }] in physical wheel order, clockwise from the top. */
export const WHEEL = WHEEL_ORDER.map(n => ({ n, color: pocketColor(n) }));

export const WHEEL_POCKETS = WHEEL.length;                                   // 13
export const RED_POCKETS = WHEEL.filter(p => p.color === 'red').length;      // 6
export const BLACK_POCKETS = WHEEL.filter(p => p.color === 'black').length;  // 6
export const GREEN_POCKETS = WHEEL.filter(p => p.color === 'green').length;  // 1

/** Even money, the way every roulette table in the world prices red and black. */
export const ROULETTE_EVEN_PAYOUT = 2;

/**
 * ...AND THE GREEN PAYOUT IS DERIVED, NOT PICKED.
 *
 * Red pays 2x at 6/13, so the house keeps 1 - (6/13 x 2) = 1/13 of an
 * even-money bet. Green must be priced so the house keeps EXACTLY THE SAME cut:
 *
 *     (GREEN_POCKETS / 13) * X  =  (RED_POCKETS / 13) * 2
 *     X = RED_POCKETS * 2 / GREEN_POCKETS = 12
 *
 * So green returns 12x, which on this wheel is 11 to 1. It is six times the
 * even-money bet and pays 3000 chips at the table maximum, and it is not a trap:
 * every bet on the felt gives the house the same 7.7%, so betting green is a
 * choice about variance and nothing else.
 */
export const ROULETTE_GREEN_PAYOUT = (RED_POCKETS * ROULETTE_EVEN_PAYOUT) / GREEN_POCKETS;

/** bet key -> total return multiple. The whole roulette payout table. */
export const ROULETTE_PAYOUTS = {
  red: ROULETTE_EVEN_PAYOUT,
  black: ROULETTE_EVEN_PAYOUT,
  green: ROULETTE_GREEN_PAYOUT,
};

/** What fraction of every wagered chip the house keeps, per bet. All equal. */
export function houseEdge(bet) {
  const pockets = { red: RED_POCKETS, black: BLACK_POCKETS, green: GREEN_POCKETS }[bet] ?? 0;
  return 1 - (pockets / WHEEL_POCKETS) * (ROULETTE_PAYOUTS[bet] ?? 0);
}

/** Drop the ball. Returns the pocket index into WHEEL. */
export function spinRoulette(rng = Math.random) {
  return Math.floor(rng() * WHEEL_POCKETS) % WHEEL_POCKETS;
}

export function rouletteMultiplier(bet, pocketIndex) {
  const pocket = WHEEL[pocketIndex];
  if (!pocket || pocket.color !== bet) return 0;
  return ROULETTE_PAYOUTS[bet] ?? 0;
}

export const ROULETTE_BETS = [
  { id: 'red', label: 'RED', color: 0xc0303c, css: '#e0434f' },
  { id: 'black', label: 'BLACK', color: 0x231a2e, css: '#cfc4dd' },
  { id: 'green', label: 'GREEN', color: 0x2c7a44, css: '#5fd07a' },
];

// ---------------------------------------------------------------------------
// THE DUCK RACE
// ---------------------------------------------------------------------------

/**
 * Four ducks, one line, 4x. The odds are FLAT: every duck wins one race in
 * four, no favourites, no form, no rigging. The lead changes on the way down
 * the pond because a race with no lead changes is not worth watching, but the
 * winner is drawn once, up front, and the animation is told what to do.
 *
 * Exactly one duck is absurdly sophisticated. He is not faster.
 */
export const DUCK_PAYOUT = 4;

export const DUCKS = [
  {
    id: 'tophat', key: 'duck_tophat', tint: 0xf0d878,
    name: 'LORD PERCIVAL QUACKINGHAM III',
    short: 'LORD PERCIVAL',
    blurb: 'Sole heir to the pond. Races purely for the sport of it.',
  },
  {
    id: 'aviator', key: 'duck_aviator', tint: 0xff7a5a,
    name: 'TURBO',
    short: 'TURBO',
    blurb: 'Wears goggles. Has never explained why.',
  },
  {
    id: 'wizard', key: 'duck_wizard', tint: 0xb45cff,
    name: 'BEAKTHAZAR THE DAMP',
    short: 'BEAKTHAZAR',
    blurb: 'Insists the result is already foretold. It is not.',
  },
  {
    id: 'pirate', key: 'duck_pirate', tint: 0xffc542,
    name: 'CAPTAIN CHOMPS',
    short: 'CAPT. CHOMPS',
    blurb: 'One eye, no scruples, and a documented biting habit.',
  },
];

/** Which duck touches the line first. Uniform across all four. */
export function raceDucks(rng = Math.random) {
  return Math.floor(rng() * DUCKS.length) % DUCKS.length;
}

export function duckMultiplier(pickIndex, winnerIndex) {
  return pickIndex === winnerIndex ? DUCK_PAYOUT : 0;
}

// ---------------------------------------------------------------------------
// THE FLOOR
// ---------------------------------------------------------------------------

/**
 * The three tables, in the order the casino offers them. `payoff` is the line
 * printed under the game's name on the event panel, built from the payout
 * constants above so a retune cannot leave the copy lying.
 */
export const CASINO_GAMES = [
  {
    id: 'blackjack', name: 'BLACKJACK', icon: 'icon_star', tint: 0xe8dcc0,
    payoff: `Hit or stand against the house. A win pays ${BJ_WIN_PAYOUT}x.`,
    rules: `Closest to ${BJ_TARGET} without going over. The dealer stands on ${BJ_DEALER_STANDS}. A tie is a push.`,
    greeting: 'She shuffles without looking at the cards, or at you. "Name your money."',
  },
  {
    id: 'roulette', name: 'ROULETTE', icon: 'icon_dice', tint: 0xe0434f,
    payoff: `Red or black pays ${ROULETTE_EVEN_PAYOUT}x. Green pays ${ROULETTE_GREEN_PAYOUT}x.`,
    rules: `Thirteen pockets: a green ${GREEN_NUMBER}, six red, six black. The ball decides.`,
    greeting: 'The wheel has not stopped turning since you arrived. She palms the ball. "Colour and coin."',
  },
  {
    id: 'duckrace', name: 'THE DUCK RACE', icon: 'icon_lucky', tint: 0xffc542,
    payoff: `Back one of four ducks. Your duck pays ${DUCK_PAYOUT}x.`,
    rules: 'Four ducks, one line, no favourites. Somebody has to win.',
    greeting: 'The crate goes down at the waterline and four opinions climb out of it.',
  },
];

export const CASINO_GAME_BY_ID = Object.fromEntries(CASINO_GAMES.map(g => [g.id, g]));
