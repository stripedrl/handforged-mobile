/**
 * @file scoring.js
 * Turns an evaluated poker hand into combat numbers: damage, club splash, heal,
 * shield and chips — modified by the character passive, Smith hand levels,
 * artifact mods, and card mods. Fully deterministic (no RNG) so it can be unit
 * tested bit-for-bit.
 *
 * NO STATUS LIVES HERE ANY MORE (2026-08-01 overhaul). Clubs stopped applying
 * the hero's keyed status; the one status a hand still produces is OPHELIA's
 * poison, and that is a fraction of DAMAGE DEALT, which only the scene knows
 * (splash, strikes, spill and overkill all land after this file is done).
 * See CombatScene.seepPoison.
 *
 * ============================ THE THREE LAYERS ============================
 * (JC, 2026-08-01: "This is how Balatro works.")
 *
 * A card is not one thing wearing one label. It has THREE INDEPENDENT LAYERS,
 * and any combination of them is legal:
 *
 *   card.mod    — WHAT THE CARD IS.  enhanced · wild · star · joker · gilded ·
 *                 forged · spectral · nuke · roulette · ethereal
 *                 One per card. This is the layer that rewrites the card's
 *                 identity (its suit, its value, whether it scores at all).
 *
 *   card.stamp  — WHAT WAS PRESSED INTO IT.  'blood' (+2 HP when it scores),
 *                 'mult' (+3 mult when it scores) or 'echo' (it counts twice).
 *                 One per card — the seals compete for the same patch of wax —
 *                 but a stamp NEVER competes with a mod. A sealed ROULETTE card
 *                 spins AND pays.
 *
 *   card.wrap   — WHAT IT IS WRAPPED IN.  'shiny' (×1.5 mult when it scores).
 *                 SHINY used to be a mod, which meant foiling a card erased
 *                 whatever it already was; it is now a wrapper, so a shiny
 *                 stamped roulette card is a perfectly ordinary thing to own.
 *
 * Legacy shapes still read correctly (cardStamp/cardWrap below): the old
 * `mod: 'bloodSealed'`, the interim `seal: true`, the old `mod: 'shiny'` and
 * (since 0803-B) the old `mod: 'echo'` all resolve onto the right layer, so
 * nothing in an old save or an old test silently stops working.
 *
 * CARD MODS:
 *   enhanced — +10 value (purple border)
 *   wild / star — counts as every suit for flushes; SCORES as your character's suit
 *   joker — wild, +20 value, and doubles the hand mult when it scores
 *   gilded — pays 4 chips when it scores
 *   forged — enhanced + gilded in one card
 *   roulette — spins EVERY ACTIVATION (2026-08-04, was every play): 10% gold
 *              (+15 chips) / 30% red (+2 mult) / 30% black (scores NOTHING) /
 *              30% green (+10 value). One card can therefore go black, then red,
 *              then gold inside a single hand. The spin is RNG, so it happens
 *              OUTSIDE this file: the scene rolls an ARRAY per card (see
 *              rollRouletteFor) and hands them in as state.rouletteRolls, which
 *              keeps scoreHand bit-for-bit deterministic.
 *   ethereal — ×2 mult when it scores (0803: was ×1.5). The vanish roll is a
 *              post-hand event the scene owns; scoring reports which ethereals
 *              scored AND how many times (res.etherealActivations), because
 *              since 2026-08-04 the rent is paid per activation. The VOIDCALLER
 *              answers those rolls AND pays ×1.25 for every ethereal still
 *              sitting in your hand, so a ghost deck compounds on both sides of
 *              the bench.
 *
 * STAMPS (card.stamp):
 *   blood — BLOOD SEAL, heals SEAL_HEAL (2) HP every time the card scores.
 *           Paid through res.sealHeal, never the heal pool: it is the CARD
 *           paying you, not the hand's Hearts, so no Zeal overflow and no
 *           ×mult rewrite from the Infinite Heart.
 *   mult  — MULTIPLICATIVE SEAL, +STAMP_MULT (3) FLAT mult when the card
 *           scores. Lands on the mult side beside a RED roulette spin.
 *   echo  — ECHO SEAL (0803-B, was a MOD). The card's whole contribution counts
 *           ECHO_TIMES (2). It also fires its LEFTOVER-in-hand effects one extra
 *           time (see benchTriggers), so an echoed roulette card held back under
 *           the Rigged Wheel pays its ×1.25 twice. Because it is a STAMP it now
 *           competes with blood and mult for the one patch of wax, and it no
 *           longer competes with the card's MOD — an echoed roulette card is an
 *           ordinary thing to own.
 *
 * WRAPS (card.wrap):
 *   shiny — foil. ×1.5 mult when the card scores (0803: was ×1.25), one factor
 *           per card, exactly as it behaved when it was a mod.
 */

import { HOARD_CHIP_STEP, CHARACTERS } from '../config.js';
import { cardValue } from './deck.js';
import { evaluateHand, bestHandOf, scoringIds, handStats, WILD_MODS, HAND_DEFS } from './poker.js';

/**
 * ============================== THE INFINITY CAP ==========================
 * (JC, 2026-08-10, locked. THE BUG IT RETIRES is written up below it.)
 *
 * NOTHING IN THIS FILE MAY EVER BE LARGER THAN 1e30. Not the running mult, not
 * the score side, not one card's share, not an output pool. A hand that reaches
 * the ceiling IS the ceiling, and e30 and e100 are the same hand by design:
 * the number stops being a number and becomes ∞ (see ui/juice.fmtNum), the
 * payoff plays its top tier, and the blow is lethal to anything that is not
 * immune (see CombatScene.damageEnemy).
 *
 * WHY A CAP AND NOT A BIGGER TYPE. IEEE doubles stop at ~1.8e308, and the
 * ordered mult walk compounds ×2 layers per activation per window — five
 * ethereal cards under an echo seal, an Ouroboros and a repeating hand is
 * thousands of doublings, so 2^1024 = Infinity is a REACHABLE build, not a
 * theoretical one. And Infinity is not a big number, it is a POISON:
 *
 *   Infinity × 0        = NaN   (a non-scoring card's share, an empty pool)
 *   Infinity - Infinity = NaN   (scoring's own residual: addOf(mods) - listAdd)
 *   Infinity ÷ Infinity = NaN   (residualFactor)
 *   NaN > 0             = false — and THAT is the shipped bug: resolveHand
 *                         gates the strike on `res.damage > 0`, so a hand whose
 *                         equation had just counted past a trillion on screen
 *                         dealt EXACTLY NOTHING. "I scored e12+ and it applied
 *                         0" is this line.
 *   Math.round(x*100)/100 overflows at 1.8e306, so the 2dp rounding at the
 *                         bottom of the mult turned finite mults into Infinity
 *                         two decades early, all on its own.
 *
 * Clamping INSIDE the walk means no intermediate is ever big enough for any of
 * those to happen. capNum() is the one gate; every accumulator goes through it.
 */
export const INFINITY_CAP = 1e30;

/**
 * The clamp. Finite in, finite out, always.
 *
 * NaN answers 0 rather than propagating: a NaN that reaches the scene is a hand
 * that silently deals nothing (see above), and zero is the only value that is
 * honest about itself on screen. Negatives are clamped symmetrically so a
 * future "the hand costs you" lever cannot underflow the other way.
 */
export function capNum(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n >= INFINITY_CAP) return INFINITY_CAP;
  if (n <= -INFINITY_CAP) return -INFINITY_CAP;
  return n;
}

/** Has this number hit the ceiling? The one question ∞ display and lethality ask. */
export function isInfinite(n) {
  return typeof n === 'number' && (Number.isNaN(n) ? false : n >= INFINITY_CAP);
}

/**
 * @typedef {import('./deck.js').Card} Card
 * @typedef {'highRoller'|'zealot'|'bulwark'|'venomancer'} Character
 */

// Exported since 2026-08-06 so the passive chip's tests can DERIVE the ×N they
// assert instead of keeping a second copy of the table (core/passives.js reads
// the factor off the scoring result rather than off this, on purpose).
export const HIGH_ROLLER_CARD_MULT = { 1: 4, 2: 3, 3: 2 }; // 4-5 cards => x1 (default)

/**
 * ZEAL — THE DAMAGE BATTERY (JC, 2026-08-01 overhaul).
 *
 * Overhealing still fills the battery (up to ZEAL_CAP). It used to buy a
 * `1 + zeal/20` mult capped at ×3, which was a second mult curve nobody could
 * read. It is now one honest sentence: EVERY POINT OF ZEAL IS +2% DAMAGE ON
 * YOUR NEXT DAMAGING HAND, and the whole battery is spent when it fires.
 * A full 40 Zeal is therefore exactly +80% (×1.8).
 *
 * It lands on effMult rather than on the damage total, so the equation's
 * score × mult = delivered identity holds and the spend is VISIBLE on the mult
 * side of the cascade instead of being a silent correction at impact.
 */
export const ZEAL_CAP = 40;
export const ZEAL_DAMAGE_PCT = 0.02;

/**
 * THE UNCAP IS THE BASELINE NOW (JC, 2026-08-04). Zeal banks forever, for every
 * Zelus, relic or no relic: "we change zeal to be uncapped all the time. I
 * think that makes more sense." The Infinite Heart used to sell the uncap (at
 * the price of Hearts dealing no damage — the lame half); it now sells
 * healing-times-mult instead, and the battery's ceiling is simply gone.
 *
 * ZEAL_CAP survives as a NUMBER, not a ceiling: it is BATTERY FULL's threshold
 * on the trophy shelf, and the yardstick a couple of strings still quote. The
 * function stays because scoring and the scene's bank-up both ask it, and one
 * answer in one place is what keeps them agreeing.
 *
 * IT ANSWERS INFINITY_CAP, NOT Infinity (2026-08-10). The meaning is unchanged
 * — nothing in the game banks 1e30 Zeal — but the number now travels out on
 * res.zealCap, into `Math.min(res.zealCap, ...)` in the scene, and a literal
 * Infinity on a result field is exactly the poison the cap exists to keep out.
 */
export function zealCapFor(_mods) {
  return INFINITY_CAP;
}

/**
 * THE BULL's BATTERY (JC, 0803) — The Ancient Shield, rewritten in Zeal's shape.
 *
 * The relic used to multiply the hand's SHIELD by the hand's mult, which piled
 * plate onto a hero who already had more plate than anything could chew through
 * and left his damage flat. It now runs the trade the other way: every point of
 * Shield is +1% MULT, uncapped, and all Shield melts at the end of every turn
 * (props.shieldMelts, owned by the scene).
 *
 * It lands on effMult for exactly Zeal's reason: the equation's
 * score × mult = delivered identity has to hold, and the spend has to be VISIBLE
 * on the mult side rather than being a silent correction at impact.
 *
 * WHAT IT READS, and why. Under the melt, the Shield STANDING at the start of a
 * player turn is always zero (the wall came down during the enemy's turn), so a
 * relic that only read `state.shield` would do nothing at all from hand two
 * onward. It therefore reads the shield you are standing behind PLUS the raw
 * Shield this hand is about to plate on, which is the number the player is
 * actually looking at when they choose the hand. Raw pool only: the scene's
 * Aegis Core factor and the hand-wide outScale stay out of it, so the mult can
 * never feed itself.
 */
export const SHIELD_MULT_PCT = 0.01;

/**
 * THE TORTOISE STANDARD's yardstick: how many points of Shield buy one helping
 * of `mods.shieldValue`. One number, read by the arithmetic and by the relic's
 * own printed rules line, so the two can never quote different tortoises.
 */
export const SHIELD_VALUE_STEP = 10;

/**
 * CLUBS — THE SPREAD SUIT (JC, 2026-08-01 overhaul).
 *
 * Clubs used to deal damage AND apply the hero's keyed status (bleed / smite /
 * brittle / poison). That made one suit mean four different things depending on
 * who was holding it, and three of those four things were flat, unscaling
 * numbers next to a mult curve that ran to the thousands.
 *
 * Clubs now mean ONE thing for everyone: they hit the target like any other
 * suit, and 25% of what THEY contributed splashes onto every OTHER living
 * enemy. Suit identity, no hero conditionals, and it scales with the whole
 * equation because it is a fraction of the damage the clubs actually dealt.
 *
 * Per-card: `breakdown[i].aoe`. Whole hand: `res.aoeSplash` (their sum, so the
 * card bottoms and the preview readout can never disagree).
 */
export const CLUB_SPLASH = 0.25;

const SUIT_SET = new Set(['swords', 'hearts', 'gems', 'clovers']);

/**
 * DIAMONDS REWORK (JC, 2026-08-01). Gems used to be PURE shield — a diamond
 * hand dealt literally zero damage, which is the single biggest reason the
 * friend playtest read as "the game pulls you in a lot of directions": one of
 * your four suits was a dead turn on the damage clock.
 *
 * Diamonds now behave like any other suit AND still plate you: full value ×
 * mult on the DAMAGE side, full value on the SHIELD side. Same rate as Hearts
 * and Clubs (1×); Swords keep their 2× as the pure-offence suit.
 *
 * `mods.gemDamageFactor` survives as an ADDITIVE bonus on top of this base, so
 * any future relic can still say "and your Diamonds hit harder".
 */
export const GEM_DAMAGE_BASE = 1;

/**
 * THE BULL's new passive: 'Diamonds strike twice as hard.' A flat ×2 on the
 * gem suit's damage factor — his old shield-persist + 25%-shield-as-damage kit
 * is gone (see config.js CHARACTERS.bulwark). Shield still stacks up on him,
 * it just no longer converts; the DIAMOND CARDS are the weapon now.
 */
export const BULWARK_GEM_DAMAGE_MULT = 2;

/**
 * What suit a WILD card (wild / star / joker) counts as, per hero.
 *
 * DERIVED FROM CHARACTERS, not typed out. This was a hand-kept copy of the same
 * four rows, and the day a FIFTH hero shipped nobody thought to come here:
 * DRUSKY was missing, so effectiveSuit returned undefined for him and scoreHand
 * threw `unknown suit undefined` on any wild card he played. That is not an edge
 * case for a hoarder either — it took out the Oracle's Colorful and Foolish
 * Nature, THE JOKER, the Star Chart and all three WILD pack options. Reading the
 * roster means a sixth hero cannot reintroduce it.
 */
const SUIT_BY_CHARACTER = Object.fromEntries(
  Object.values(CHARACTERS).map(c => [c.id, c.suit]));

export const VALUE_BONUS_BY_MOD = { enhanced: 10, forged: 10, joker: 20, nuke: 90 };
export const CHIP_MODS = new Set(['gilded', 'forged']);
/**
 * What a chip mod pays, every activation it scores. Was a literal `4` inside
 * the card walk until the CARD INSPECT panel (2026-08-10) needed to print it:
 * a panel that quotes a number the arithmetic does not read is a panel that
 * goes stale silently.
 */
export const MOD_CHIPS = 4;
/**
 * Mods that MULTIPLY the hand mult when the card scores. They stack
 * multiplicatively with each other AND WITH THEMSELVES, once per ACTIVATION.
 *
 * (JC, 2026-08-04: "we need to make sure repetition plays nicely with other
 * cards like that.") This used to fire once per CARD however many times the card
 * actually scored, which made the ECHO SEAL and the Ouroboros silently worthless
 * on the three mods that matter most — the seal doubled a joker's VALUE and left
 * its ×2 alone. Every other per-card channel in this file already weighted itself
 * by `times`; these two were the outliers, and they are not any more.
 */
export const MOD_MULT_FACTOR = { joker: 2, spectral: 2, ethereal: 2 };

// --- THE STAMP LAYER (card.stamp) ------------------------------------------
/** BLOOD SEAL: HP the card pays you every time it scores. */
export const SEAL_HEAL = 2;
/** MULTIPLICATIVE SEAL: flat mult the card adds every time it scores. */
export const STAMP_MULT = 3;
/** ECHO SEAL: how many times the card's whole contribution counts. */
export const ECHO_TIMES = 2;
export const STAMPS = {
  blood: { id: 'blood', label: 'BLOOD SEAL', heal: SEAL_HEAL, tint: 0x8a1830, color: '#8a1830' },
  mult: { id: 'mult', label: 'MULTIPLICATIVE SEAL', mult: STAMP_MULT, tint: 0x7a3ab8, color: '#7a3ab8' },
  echo: { id: 'echo', label: 'ECHO SEAL', times: ECHO_TIMES, tint: 0x2878c0, color: '#2878c0' },
};

// --- THE WRAP LAYER (card.wrap) --------------------------------------------
/** Wrappers multiply the hand mult once per scoring card, like a mod factor. */
export const WRAP_MULT_FACTOR = { shiny: 1.5 };
export const WRAPS = {
  // `factor` is READ OFF the table above rather than restated, so the wrapper's
  // label, the tooltip and the arithmetic can never quote different numbers.
  shiny: { id: 'shiny', label: 'SHINY', factor: WRAP_MULT_FACTOR.shiny, tint: 0xbfd8ff, color: '#7a5cd0' },
};

/**
 * Which stamp is on this card, reading the legacy shapes too: the original
 * `mod: 'bloodSealed'` and the interim `seal: true` both mean a BLOOD stamp,
 * and the pre-0803-B `mod: 'echo'` means an ECHO stamp.
 *
 * THE ECHO MIGRATION (0803-B §1.3). Echo used to live on the MOD layer, so every
 * save, every run deck, every artisan card and every forged card written before
 * this patch carries `mod: 'echo'`. There is no rewrite pass and no save
 * version bump: the legacy shape is READ here, exactly the way bloodSealed and
 * shiny are, which means an old card echoes on the stamp layer the first time it
 * is scored and keeps echoing forever without anything having been migrated.
 * cardMod() answers null for it in the same breath, so it can never be counted
 * on both layers at once.
 * @returns {'blood'|'mult'|'echo'|null}
 */
export function cardStamp(card) {
  if (card?.stamp && STAMPS[card.stamp]) return card.stamp;
  if (card?.mod === 'echo') return 'echo';
  if (card?.seal === true || card?.mod === 'bloodSealed') return 'blood';
  return null;
}

/** Which wrapper is on this card — `mod: 'shiny'` is the legacy spelling. */
export function cardWrap(card) {
  if (card?.wrap && WRAPS[card.wrap]) return card.wrap;
  if (card?.mod === 'shiny') return 'shiny';
  return null;
}

/** The card's MOD layer alone — legacy layer values resolve to no mod at all. */
export function cardMod(card) {
  const m = card?.mod;
  if (!m || m === 'bloodSealed' || m === 'shiny' || m === 'echo') return null;
  return m;
}

/** Convenience for the UI and the older call sites. */
export function isSealed(card) { return cardStamp(card) === 'blood'; }

// --- THE SHARED SCORING CHANNELS (PATCH 0803-B) ----------------------------
// Locked names, written down once here so the engine and the relics that feed
// it can never drift apart:
//   mods.handRepeatAdd   extra hand activations, ADDITIVE (see handRepeatOf)
//   mods.benchRepeat     how many times LEFTOVER-in-hand effects fire (base 1)
//   mods.benchFactor     the finished product of every leftover effect, applied
//                        at the very END of the mult (see §1.1 below)
//   mods.chipMultAdd     flat mult per CHIP_MULT_STEP chips held (Drusky)
//   mods.chipMultFactor  ...the same reading, MULTIPLIED in at the very end
//                        instead (the Solid Gold Sack)

/** Leftover-in-hand effects fire this many times before any relic adds to it. */
export const BENCH_REPEAT_BASE = 1;

/**
 * How many times ONE held-back card's leftover effect fires.
 *
 * ADDITIVE, and deliberately: the LATENT REPEATER takes every leftover effect to
 * twice, the ECHO SEAL on the card takes that card's to one more again, and the
 * two together are THREE — the stated ceiling. Multiplying them would make it
 * four and there would be no ceiling to state.
 */
export function benchTriggers(card, mods) {
  const base = Math.max(1, Math.round(mods?.benchRepeat ?? BENCH_REPEAT_BASE));
  return base + (cardStamp(card) === 'echo' ? 1 : 0);
}

/**
 * HOW MANY TIMES THE WHOLE HAND HAPPENS — ADDITIVE since 0803-B (§1.2).
 *
 * A relic "worth ×N" contributes N-1 EXTRA activations and the extras SUM, so a
 * Repeating Pocketwatch (×2) beside the Sharpest Dagger (×5) is 1+1+4 = 6 plays
 * rather than the 10 the old product gave. Two Pocketwatches are 3, not 4.
 *
 * `mods.handRepeatAdd` is the channel every new relic writes to. `mods.handRepeat`
 * survives as the RESOLVED TOTAL (collectMods keeps the two in step), which is
 * what every existing caller — the unit tests, artifacts.handActivations, the
 * cascade — has always read, so nothing downstream had to learn a new name.
 * A bag carrying only one of the two still answers correctly, and a bag carrying
 * both prefers the total so the extras can never be counted twice.
 */
export function handRepeatOf(mods) {
  // The TOTAL wins whenever it is present, which is what stops the extras being
  // counted on both channels at once — and lets any caller switch the repeat off
  // outright with `{ ...mods, handRepeat: 1 }`, which is how every baseline in
  // the tests is built. handRepeatAdd only answers for a bag that never went
  // through collectMods (a relic's own mods, a hand-written state).
  const raw = (mods && 'handRepeat' in mods)
    ? Math.max(1, Math.round(mods.handRepeat ?? 1))
    : Math.max(1, 1 + Math.max(0, Math.round(mods?.handRepeatAdd ?? 0)));
  // THE HARD CEILING. The mult walk below is `for (h = 0; h < handRepeat; h++)`,
  // so a bag carrying Infinity here (a hand-edited save, a relic bug, NaN
  // rounding to Infinity) is not a big number — it is a hung tab. Nothing in the
  // game reaches double digits of hand repeats, let alone 512, so the clamp is
  // invisible to play and total against the hang.
  return Number.isFinite(raw) ? Math.min(MAX_HAND_REPEAT, raw) : MAX_HAND_REPEAT;
}

/** @see handRepeatOf — the anti-hang ceiling on whole-hand activations. */
export const MAX_HAND_REPEAT = 512;

/**
 * DRUSKY: one step of hoard buys one unit of mult.
 *
 * READ OFF config.HOARD_CHIP_STEP rather than restated, so the hero's kit text,
 * the Solid Gold Sack's tooltip and this arithmetic quote the same number by
 * construction. Re-exported under the engine's own name because the ENGINE does
 * not care whose hoard it is — any relic can write mods.chipMultAdd.
 */
export const CHIP_MULT_STEP = HOARD_CHIP_STEP;

/**
 * THE HOARD, ADDED (Drusky's passive): +mods.chipMultAdd mult per whole
 * CHIP_MULT_STEP chips held, read LIVE at play time. 1,000 chips = +10 mult.
 * Silent while the SOLID GOLD SACK is on the belt — that relic does not stack
 * with the passive, it REPLACES it (see chipMultFactorOf).
 */
export function chipMultAddOf(mods, chips) {
  if ((mods?.chipMultFactor ?? 0) > 0) return 0;
  const rate = mods?.chipMultAdd ?? 0;
  if (rate <= 0) return 0;
  return capNum(rate * Math.floor(Math.max(0, chips) / CHIP_MULT_STEP));
}

/**
 * THE HOARD, MULTIPLIED (the SOLID GOLD SACK): the same reading applied to the
 * FINISHED mult instead of to the mult it started with. At 1,000 chips that is
 * ×10 on everything the hand built rather than +10 at the front of the equation.
 * Floored at ×1 so a thin purse can never make a hand worse than not owning it.
 */
export function chipMultFactorOf(mods, chips) {
  const rate = mods?.chipMultFactor ?? 0;
  if (rate <= 0) return 1;
  // Capped here rather than only where it is applied, because this number is
  // also REPORTED (res.chipMultFactor) and the cascade prints it.
  return capNum(Math.max(1, (rate * Math.max(0, chips)) / CHIP_MULT_STEP));
}
/**
 * ETHEREAL: the price of the ×2 — rolled once per ACTIVATION, after the hand.
 *
 * 0.25 -> 0.10 (JC, 2026-08-04). The roll used to happen once per hand however
 * many times the card actually fired; it now fires with the card, so an echoed
 * ghost under a Pocketwatch rolls four times instead of one. A rent of 25% a
 * throw would make repeating a ghost suicide rather than a decision, so the rent
 * came down with it: four rolls at 10% is a 34% loss, against the old 25% for a
 * single activation. Repeating a ghost is now dearer than not, and survivable.
 */
export const ETHEREAL_VANISH_CHANCE = 0.10;

/**
 * THE FADE'S OWN COIN (JC, 2026-08-04: "his mechanic should be fading cards
 * but let's not call them ethereal since it's different. I also want the
 * percent that the card fades away to be 25% still.")
 *
 * FADE (the Ethereal Plains' bite) kept the old harsher rate when ethereal
 * dropped to 10: a FADING card pays nothing for its risk, and the biome is
 * supposed to cost you cards. Rolled per activation like everything else, and
 * answered by NOTHING — the Voidcaller and the Oracle's SPIRITUAL both say
 * ETHEREAL and mean exactly that.
 */
export const FADE_VANISH_CHANCE = 0.25;

/** ROULETTE payouts, one independent spin per card PER ACTIVATION. */
export const ROULETTE_GOLD_CHIPS = 15;
export const ROULETTE_RED_MULT = 2;
export const ROULETTE_GREEN_VALUE = 10;
/** The wheel, in reading order. Probabilities must sum to 1. */
export const ROULETTE_ODDS = [
  { result: 'gold', p: 0.10 },
  { result: 'red', p: 0.30 },
  { result: 'black', p: 0.30 },
  { result: 'green', p: 0.30 },
];

/** One spin. */
export function rollRouletteResult(rng = Math.random) {
  let r = rng();
  for (const o of ROULETTE_ODDS) { r -= o.p; if (r < 0) return o.result; }
  return ROULETTE_ODDS[ROULETTE_ODDS.length - 1].result;
}

/**
 * THE ACTIVATION CEILING (JC, 2026-08-04: "a roulette card could go from black,
 * to red, to green to gold all within different activations").
 *
 * The wheel is spun BY THE SCENE, before scoreHand runs, so scoring stays
 * bit-for-bit deterministic — which means the scene has to know how many spins
 * to roll before anybody knows which card the Ouroboros will bite. This is the
 * upper bound: an ECHO seal, the retrigger, and the whole hand happening again.
 * Rolling a few spare spins costs nothing; running out mid-hand would silently
 * repeat a result, so the bound is deliberately generous and capped only so a
 * mirrored Pocketwatch beside a mirrored Dagger cannot ask for an array of
 * thousands.
 */
export const MAX_SPINS_PER_CARD = 512;
export function maxActivations(mods) {
  const retrigger = Math.max(1, Math.round(mods?.retriggerTop ?? 1));
  const n = ECHO_TIMES * retrigger * handRepeatOf(mods);
  return Math.max(1, Math.min(MAX_SPINS_PER_CARD, n));
}

/**
 * Spin for every ROULETTE card in `cards` — independently, EVERY ACTIVATION.
 * Returns { cardId: result[] }, which is exactly what state.rouletteRolls wants.
 *
 * A bare string is still read correctly downstream (rouletteSpinsFor), so an old
 * save, an old test and the dev pin all keep working: one result simply means
 * every activation landed on the same pocket.
 */
export function rollRouletteFor(cards, rng = Math.random, mods = null) {
  const spins = maxActivations(mods);
  const out = {};
  for (const c of cards) {
    if (c.mod !== 'roulette') continue;
    out[c.id] = Array.from({ length: spins }, () => rollRouletteResult(rng));
  }
  return out;
}

/**
 * The spins for one card, as an array, whatever shape the caller handed in.
 * No entry at all = a wheel nobody asked to spin (the deck picker, the hand
 * preview), and the card scores as a plain one there.
 */
export function rouletteSpinsFor(card, rolls) {
  if (!card || card.mod !== 'roulette') return null;
  const v = rolls?.[card.id];
  if (v == null) return null;
  return Array.isArray(v) ? (v.length ? v : null) : [v];
}

/** The suit a card BEHAVES as when scoring (wilds resolve to your suit). */
export function effectiveSuit(card, character) {
  return WILD_MODS.has(card.mod) ? SUIT_BY_CHARACTER[character] : card.suit;
}

/** The hero's own suit. Derived from CHARACTERS, never typed out twice. */
export function heroSuit(character) { return SUIT_BY_CHARACTER[character] ?? null; }

/**
 * TRUE COLORS (`mods.trueColors`) — THE RULE SUIT, and ONLY the rule suit.
 *
 * A card has two suit questions asked of it and they had always shared one
 * answer:
 *
 *   WHAT IS IT?      effectiveSuit. What the RELICS read (suitValue, suitMult,
 *                    the four grinders), what suitCounts counts, what
 *                    damageBySuit is keyed by, what the card bottom prints, and
 *                    what a Keeper's seal bans. UNTOUCHED by this relic, on
 *                    purpose: a Whetstone Charm that suddenly paid on every card
 *                    in the hand would be four relics rewritten by one.
 *   HOW DOES IT HIT? this. The SUIT RULE the card's contribution follows —
 *                    swords 2x damage, hearts damage+heal, diamonds
 *                    damage+shield, clubs damage+splash. That is the half each
 *                    hero's kit is built on, and it is the half TRUE COLORS
 *                    rewrites: every scoring card hits the way YOUR suit hits.
 *
 * Read at exactly two places (the contributeOne switch and the club splash),
 * which is every place the SUIT RULES are consulted and no place else.
 */
export function ruleSuitOf(card, character, mods = null) {
  const eff = effectiveSuit(card, character);
  return mods?.trueColors ? (SUIT_BY_CHARACTER[character] ?? eff) : eff;
}

/**
 * Score a played hand for a given character/state.
 * state.mods (all optional):
 *   suitValue{suit:+n}     — value added to every scoring card of a suit
 *   modValue{mod:+n}       — value added to every scoring card carrying a mod
 *   cardValue{id:+n}       — value added to ONE named card (per-hand scene grants)
 *   faceValue              — value added to scoring J/Q/K
 *   suitMult{suit:+n}      — FLAT mult per scoring card of a suit (Prayer Beads)
 *   faceMult               — FLAT mult per scoring J/Q/K (Kingmaker)
 *   handValue{type:+n}     — FLAT, PRE-MULT value added to a whole hand type
 *                            (the Straightedge's banked edge). Rides the score
 *                            side, so the mult multiplies it like any card.
 *   flatValue              — FLAT, PRE-MULT value added to EVERY hand, whatever
 *                            its type (Pocket Anvil, the Matchmaker's bank, the
 *                            Golden Spud). The value-side twin of flatMult.
 *   flatShield             — FLAT Shield added to any hand that already grants
 *                            Shield (Tungsten Cube). Lands before Aegis Core,
 *                            which lives in the scene, so the Core amplifies it.
 *   flatMult               — FLAT mult on EVERY hand, whatever its type. Where
 *                            every SCALER lands (Kingmaker's crowns, the
 *                            Rising Tide, Lucky Deuce, the Ace's Legacy,
 *                            Wolfsbane's wolves, the Chaos Orb's roll).
 *   handMult{type:+n} · handFactor{type:×n} · globalMultFactor
 *   modCardFactor          — ×n per scoring card that carries a mod, compounding
 *   retriggerTop           — the highest-VALUE scoring card counts n times
 *   handRepeat             — the WHOLE hand's output counts n times (Pocketwatch,
 *                            the Sharpest Dagger). ↻ language, score side. The
 *                            RESOLVED TOTAL; handRepeatAdd is the additive
 *                            channel that builds it (see handRepeatOf).
 *   handRepeatAdd          — EXTRA hand activations, ADDITIVE across relics
 *   benchRepeat            — how many times LEFTOVER-in-hand effects fire (1)
 *   benchFactor            — the leftover bench's finished ×, applied at the
 *                            very END of the mult (see §1.1 at the bottom)
 *   chipMultAdd            — flat mult per CHIP_MULT_STEP chips held (Drusky)
 *   chipMultFactor         — ...the same hoard MULTIPLIED in at the very end
 *                            instead (the Solid Gold Sack)
 *   valueFactor            — ×n on everything the hand outputs (the Forge Hammer)
 *   shieldByMult / healByMult — that output is multiplied by the hand's final
 *                            effMult (the Infinite Heart's rewrite; shieldByMult
 *                            is the same lever kept live for a future relic, no
 *                            longer used by The Ancient Shield)
 *   shieldMult             — THE ANCIENT SHIELD: +SHIELD_MULT_PCT mult per point
 *                            of Shield, uncapped. Zeal's shape, on the Bull.
 *   zealUncap              — RETIRED 2026-08-04 (Zeal is uncapped for everyone
 *                            now — see zealCapFor). Read by nothing; old saves
 *                            may still carry it and it does no harm.
 *   ofAKindMinus1          — THE UNDERSTUDY: every rank group counts one larger
 *   flushMinus1            — THE BROKEN COMPASS: a flush forms with four cards
 *   straightMinus1         — THE ROPE LADDER: a straight forms with four cards
 *   trueColors             — TRUE COLORS: every scoring card follows YOUR suit's
 *                            RULE (see ruleSuitOf). What the card IS, and every
 *                            suit-keyed relic that reads it, is untouched.
 *   heartDamageOff / cloverDamageOff — that suit stops dealing damage entirely
 *                            (heartDamageOff was the Infinite Heart's price
 *                            until 2026-08-04, now a general lever again; the
 *                            clover lever is kept as the general switch)
 *   gemDamageFactor        — EXTRA gem damage on top of GEM_DAMAGE_BASE (1).
 *                            Diamonds always deal damage now; this is the
 *                            "and they hit harder" knob, currently unused.
 *   handLevels{type:lvl}
 * state.modList: THE CHAIN (2026-08-02). The same relics as state.mods, but as
 *   an ORDERED list — one entry per belt cell, left to right, mirrors resolved
 *   to their source at the MIRROR's cell (run.collectModList). The MULT side is
 *   walked through it, so one relic's adds land before the next relic's
 *   multiplies and the row becomes a decision. OPTIONAL: with no list, a single
 *   merged element is synthesised from state.mods and the arithmetic is exactly
 *   what it always was. state.mods stays the authority on the TOTAL — see the
 *   residual at the walk.
 * state.flatBonus: flat damage added by per-hand scene effects — applied only
 * if the hand deals damage.
 * state.chips: the purse, LIVE, as it stands the instant the hand is played.
 * Only the hoard channels read it; 0 (the default) makes them all silent.
 * @param {{ cards: Card[], character: Character, state: object }} args
 * @returns {object} ScoreResult
 */
export function scoreHand({ cards, character, state }) {
  const n = cards.length;
  // THE UNDERSTUDY'S RULE, read once and handed to BOTH halves of evaluation —
  // the classification and the kicker rule have to agree about how many cards
  // an of-a-kind takes, or the hand is named for one rule and scored by the
  // other. (mods is read below; this is the one thing needed above it.)
  // THE THREE CLASSIFICATION RELICS, read once and handed to BOTH halves of
  // evaluation (THE UNDERSTUDY's of-a-kind shift, THE BROKEN COMPASS's four-card
  // flush, THE ROPE LADDER's four-card straight). All three are OFF by default,
  // and with all three off poker.js is byte-identical to what it always was.
  const evalOpts = {
    ofAKindMinus1: !!(state.mods ?? {}).ofAKindMinus1,
    flushMinus1: !!(state.mods ?? {}).flushMinus1,
    straightMinus1: !!(state.mods ?? {}).straightMinus1,
  };
  // GO-GO GOO can hand this more than five cards, and the best five-card hand
  // in the pile is what sets the type and the mult. Everything else in the game
  // plays 1-5 and goes through the ordinary evaluator, unchanged.
  const hand = state.allScore ? bestHandOf(cards, evalOpts) : evaluateHand(cards, evalOpts);
  // Balatro rule: only cards that FORM the hand score. Kickers contribute nothing.
  //
  // ...unless state.allScore is set, which is GO-GO GOO and nothing else (JC's
  // explicit call, 2026-08-02): for that one play every card contributes its
  // value, while the hand TYPE and its mult are still read off the best hand
  // present. Gated this narrowly on purpose — the kicker rule is the spine of
  // the whole scoring system and exactly one bottle in the game bends it.
  const scoring = state.allScore
    ? new Set(cards.map(c => c.id))
    : scoringIds(cards, hand, evalOpts);

  const mods = state.mods ?? {};
  const suitValue = mods.suitValue ?? {};
  const modValue = mods.modValue ?? {};
  const cardValueGrants = mods.cardValue ?? {};
  // The wheel already spun (the scene owns the RNG). No entry = a roulette card
  // whose spin nobody asked for — the deck picker, the hand preview — and it
  // simply scores as a plain card there.
  const rouletteRolls = state.rouletteRolls ?? {};
  // HOISTED (2026-08-04). The hand's repeat count used to be read at the very
  // bottom, beside outScale. Per-activation spins need it up here: how many
  // times a ROULETTE card turns the wheel is how many times the whole hand
  // happens, times its own card-level repeats.
  const handRepeat = handRepeatOf(mods);

  // THE HOARD (0803-B §1.5). Read LIVE at play time, off the state the scene
  // hands in — the number on the purse when you press PLAY is the number that
  // scores. Drusky's passive adds with it; the Solid Gold Sack multiplies by it.
  const chips = Math.max(0, state.chips ?? 0);
  const chipMultAdd = chipMultAddOf(mods, chips);
  const chipMultFactor = chipMultFactorOf(mods, chips);

  // How hard one point of Diamond value hits. Base 1 for everyone, ×2 for the
  // Bull's passive, + any relic that adds gemDamageFactor on top.
  //
  // The Bull's half is SPLIT OUT (2026-08-06) rather than folded straight into
  // the product, because the passive chip in the HUD may only take a bow when
  // the passive really moved the hand — and "how much of this Diamond damage was
  // HIS" is a question only this line can answer honestly. Reported below as
  // passiveGemFactor; core/passives.js turns it into a share of damageBySuit.
  const passiveGemFactor = character === 'bulwark' ? BULWARK_GEM_DAMAGE_MULT : 1;
  const gemFactor = (GEM_DAMAGE_BASE + (mods.gemDamageFactor ?? 0)) * passiveGemFactor;

  // --- Pass 0: every card's VALUE, before anything is multiplied by it. The
  // Ouroboros needs to know which card ended up biggest, and it can only know
  // that once every artifact has finished talking to every card. ---
  const priced = cards.map((card) => {
    const isScoring = scoring.has(card.id);
    const suit = effectiveSuit(card, character);
    // TRUE COLORS: WHAT IT IS stays `suit`; HOW IT HITS becomes yours. See
    // ruleSuitOf — the relic rewrites the suit RULE and nothing else.
    const ruleSuit = ruleSuitOf(card, character, mods);
    if (!SUIT_SET.has(suit)) throw new RangeError(`scoreHand: unknown suit ${suit}`);
    // The card's OWN value (rank + its printed mod) versus the value the
    // ARTIFACTS talk it into. Splitting them here is what lets combat replay
    // "7 -> +3 -> 10" instead of silently popping the baked-in 10.
    const ownValue = cardValue(card.rank) + (VALUE_BONUS_BY_MOD[card.mod] ?? 0);
    const faceBonus = (mods.faceValue && card.rank >= 11 && card.rank <= 13) ? mods.faceValue : 0;
    const suitBonus = suitValue[suit] ?? 0;
    const modBonus = (card.mod ? modValue[card.mod] ?? 0 : 0) + (cardValueGrants[card.id] ?? 0);
    // THE WHEEL. Black is the only result that changes what the card IS worth to
    // zero; green rides in as a value bonus so it morphs on screen like any
    // other rewrite, and gold/red are paid out in pass 1.
    //
    // The card now carries a spin PER ACTIVATION. `roulette` below is the
    // HEADLINE — spin one, the one the reveal beat shows and the one this pass
    // prices the card at. Everything a later activation lands on is resolved in
    // pass 1, where the activations actually exist; the Ouroboros has to pick its
    // victim off ONE number, and the number the player watched is the honest one.
    const spins = rouletteSpinsFor(card, rouletteRolls);
    const roulette = spins ? spins[0] : null;
    const dead = roulette === 'black';
    const rouletteBonus = roulette === 'green' ? ROULETTE_GREEN_VALUE : 0;
    return {
      card, isScoring, suit, ruleSuit, ownValue, faceBonus, suitBonus, modBonus, rouletteBonus,
      roulette, spins, dead,
      value: ownValue + faceBonus + suitBonus + modBonus + rouletteBonus,
    };
  });

  // OUROBOROS: the single biggest scoring card retriggers. Ties break to the
  // leftmost card, which is the one the player reads as "the big one".
  const retrigger = Math.max(1, mods.retriggerTop ?? 1);
  let topIdx = -1;
  if (retrigger > 1) {
    priced.forEach((p, i) => {
      // A black roulette card is worth nothing this play, so the loop refuses to
      // bite it — retriggering zero three times is a beat that says nothing.
      if (p.isScoring && !p.dead && (topIdx < 0 || p.value > priced[topIdx].value)) topIdx = i;
    });
  }
  const retriggerId = topIdx >= 0 ? priced[topIdx].card.id : null;

  // --- Pass 1: per-card raw contributions (suit rules, scoring cards only) ---
  //
  // TWO OUTPUT POOLS SINCE 2026-08-04, and only one of them is new.
  //
  //   baseSum / healPool / shieldPool / chipBonus   ONE hand-activation's worth.
  //     The hand-wide outScale (handRepeat × valueFactor) multiplies these at the
  //     bottom, exactly as it always has. Every card in the game lands here.
  //
  //   baseFlat / healFlat / shieldFlat / chipFlat   ALREADY every activation.
  //     A ROULETTE card spins a fresh result for every single activation, so its
  //     output is not the same number repeated and outScale cannot produce it by
  //     multiplication. Its whole contribution is resolved here, across every
  //     activation the hand will have, and it takes valueFactor alone.
  //
  // When the hand happens ONCE (which is almost always) the two pools scale
  // identically and are merged before anything downstream sees them, so the
  // arithmetic — and every identity the tests assert on it — is untouched.
  let baseSum = 0;
  let healPool = 0;
  let shieldPool = 0;
  let chipBonus = 0;
  let baseFlat = 0;
  let healFlat = 0;
  let shieldFlat = 0;
  let chipFlat = 0;
  let sealHealFlat = 0;
  // (modMultFactor is computed by the CARD WALK below — the ×mult layers pay
  // per activation, at their card's position, inside the walk.)
  let faceCount = 0;      // scoring J/Q/K — Kingmaker's mult
  let modCount = 0;       // scoring cards carrying a mod — the Still's ×
  let rouletteMultBonus = 0;  // flat mult from RED spins
  let stampMultBonus = 0;     // flat mult from MULTIPLICATIVE SEALS
  let sealHeal = 0;       // HP the BLOOD SEALED cards paid, one activation each
  const etherealIds = [];  // ethereal cards that actually scored (the vanish roll)
  // ...and HOW MANY TIMES each of them scored. The vanish is rolled per
  // ACTIVATION now (JC, 2026-08-04), and only this file knows what an activation
  // is: a card-level repeat, times the hand's own repeats.
  const etherealActivations = {};
  // THE FADE'S OWN LEDGER (JC, 2026-08-04: "let's not call them ethereal since
  // it's different"). Same shape, separate list: a FADING card rolls its own
  // FADE_VANISH_CHANCE and is answered by nothing that answers for ghosts.
  const fadedOut = [];
  const fadedActivations = {};
  const suitCounts = { swords: 0, hearts: 0, gems: 0, clovers: 0 };
  // RAW DAMAGE PER SUIT (2026-08-03). Every multiplier downstream of here is
  // GLOBAL, so this split is what makes the Plains' FORGET SUIT arithmetically
  // exact instead of a guess based on card counts: strip a suit's share of the
  // raw and you have stripped exactly its share of the finished number.
  const damageBySuit = { swords: 0, hearts: 0, gems: 0, clovers: 0 };
  // THE FADE (Act II). Ids marked FADING for this fight: no bonus of any kind,
  // and a chance to fade away forever each time they score. Since 2026-08-04
  // this is its OWN mechanic rather than "ethereal with the upside stripped" —
  // its own name, its own 25% (FADE_VANISH_CHANCE, vs ethereal's 10%), and
  // neither the VOIDCALLER nor the Oracle's SPIRITUAL answers for it, because
  // both of their rules say ETHEREAL and mean it.
  const fadedIds = state.fadedIds instanceof Set
    ? state.fadedIds : new Set(state.fadedIds ?? []);
  const raw = [];

  priced.forEach((p, idx) => {
    const { card, isScoring, suit, ruleSuit, ownValue, faceBonus, suitBonus, modBonus, rouletteBonus, roulette, spins, dead, value: v } = p;
    const retriggered = idx === topIdx;
    // THE ECHO SEAL (0803-B): read off the STAMP layer, which also answers for
    // every legacy `mod: 'echo'` card in an old save (see cardStamp).
    const stamp = cardStamp(card);
    const times = (stamp === 'echo' ? ECHO_TIMES : 1) * (retriggered ? retrigger : 1);
    // Contribution of ONE ACTIVATION at one value, under this suit's rules — run
    // per activation (own vs final value) so the delta is exact rather than
    // reconstructed. It used to fold `times` in and multiply; summing the same
    // integer `times` times is identical arithmetic, and it is what lets a card
    // whose value CHANGES between activations (the wheel) be resolved at all.
    // The Infinite Heart and the Bottomless Vile buy their multiplied output by
    // switching their suit's damage off at the source — nothing downstream has
    // to remember the trade.
    const heartsBite = !mods.heartDamageOff;
    const cloversBite = !mods.cloverDamageOff;
    // SWITCHED ON `ruleSuit`, NOT `suit` (2026-08-10). Identical to `suit` for
    // every hand in the game; TRUE COLORS is the one relic that separates them,
    // and this switch is the entire surface it touches on the card side.
    const contributeOne = (val) => {
      switch (ruleSuit) {
        case 'swords': return { rawDamage: val * 2, heal: 0, shield: 0 };
        case 'hearts': return { rawDamage: heartsBite ? val : 0, heal: val, shield: 0 };
        // DIAMONDS: damage AND shield, both at full value. gemFactor is 1 by
        // default, ×2 for the Bull, plus whatever relics have added on top.
        case 'gems': return { rawDamage: Math.round(val * gemFactor), heal: 0, shield: val };
        default: return { rawDamage: cloversBite ? val : 0, heal: 0, shield: 0 };
      }
    };

    // HOW MANY ACTIVATIONS THIS LOOP RESOLVES. One hand's worth for an ordinary
    // card (the hand-wide outScale supplies the rest by multiplication) — but
    // EVERY activation of the whole hand for a card whose wheel spins afresh
    // each time, because those cannot be produced by multiplying anything.
    const windows = spins ? handRepeat : 1;
    const resolved = times * windows;
    // ...and how many activations this loop is standing in for. 1 when it
    // resolved them all; the hand's repeat count when outScale still has to.
    const outside = handRepeat / windows;

    let rawDamage = 0, heal = 0, shield = 0;      // the FIRST hand-activation
    let allDamage = 0, allHeal = 0, allShield = 0; // ...and every activation
    const own = { rawDamage: 0, heal: 0, shield: 0 };
    let cardChips = 0;      // first hand-activation (the breakdown's own number)
    let allChips = 0;
    let cardMult = 0;
    let cardSeal = 0;
    let allSeal = 0;
    let cardStampMult = 0;
    let liveTimes = 0;      // activations that actually paid, first window only
    let etherealHits = 0;   // ...and across every activation, for the vanish
    let fadedHits = 0;      // the FADE's twin ledger (its own odds, its own name)
    const beats = [];

    for (let k = 0; k < resolved; k++) {
      // THE WHEEL, ONE ACTIVATION AT A TIME. A card with no wheel keeps the
      // headline result forever (it is null), and a legacy single-result roll
      // reads as "every activation landed on the same pocket".
      const spin = spins ? spins[k % spins.length] : roulette;
      const spinDead = spins ? spin === 'black' : dead;
      const spinBonus = spins ? (spin === 'green' ? ROULETTE_GREEN_VALUE : 0) : rouletteBonus;
      const kValue = ownValue + faceBonus + suitBonus + modBonus + spinBonus;
      // BLACK: the card formed the hand (evaluation already happened and
      // stands), and then contributes exactly nothing — no value, no chips, no
      // suit count, no status. A scoring card worth zero, and the equation says
      // so. On THIS activation only: the next spin is a different card.
      const alive = isScoring && !spinDead;
      const cur = alive ? contributeOne(kValue) : { rawDamage: 0, heal: 0, shield: 0 };
      const first = k < times;   // inside the first hand-activation's window
      let beatChips = 0;
      let beatSeal = 0;
      let beatFactor = 1;        // the ×mult this activation signed, for the beat

      if (alive) {
        if (CHIP_MODS.has(card.mod)) beatChips += MOD_CHIPS;
        if (spin === 'gold') beatChips += ROULETTE_GOLD_CHIPS;
        // THE STAMP LAYER, pressed ON TOP of whatever mod the card carries: a
        // sealed ROULETTE card spins AND pays, a stamped ETHEREAL card ghosts
        // AND pays. One stamp per card: blood (HP), mult (flat mult) or echo
        // (which already paid, up in `times`).
        if (stamp === 'blood') beatSeal += SEAL_HEAL;
        // A real ETHEREAL card rolls the ghost's vanish; a FADING card rolls
        // ITS OWN, once per activation that actually scored. Separate ledgers
        // since 2026-08-04: different odds, different name, different answers.
        // (pickFadeTargets never fades a real ghost, so a card is only ever on
        // one of these two lists; mod-wins is the tiebreak if a save disagrees.)
        if (card.mod === 'ethereal') etherealHits += 1;
        else if (fadedIds.has(card.id)) fadedHits += 1;
        // EVERY MULT CHANNEL PAYS EVERY ACTIVATION IT IS ALIVE FOR (JC,
        // 2026-08-04, the ordered-walk ruling): a RED spin adds when it lands,
        // the MULTIPLICATIVE SEAL adds every time its card fires — in every
        // hand-window — and the ×mult layers multiply at their card's own
        // position. The beat records exactly what THIS activation signed; the
        // CARD WALK below (and the cascade on screen) replay the beats in
        // played order, window by window, so where a card sits in the hand
        // genuinely changes what the mult ends at.
        if (spin === 'red') cardMult += ROULETTE_RED_MULT;
        if (stamp === 'mult') cardStampMult += STAMP_MULT;
        beatFactor = (MOD_MULT_FACTOR[card.mod] ?? 1) * (WRAP_MULT_FACTOR[cardWrap(card)] ?? 1);
        if (first) {
          liveTimes += 1;
          if (card.rank >= 11 && card.rank <= 13) faceCount += 1;
          // THE MOD LAYER ONLY. cardMod() rather than card.mod so a card whose
          // only "mod" is a legacy layer value (bloodSealed, shiny, echo) is not
          // counted as modified by the Alchemist's Still — a SEAL is not a mod,
          // and it must not matter which spelling the save happens to carry.
          if (cardMod(card)) modCount += 1;
          suitCounts[suit] += 1;
        }
        const ownCur = contributeOne(ownValue);
        if (first) {
          own.rawDamage += ownCur.rawDamage;
          own.heal += ownCur.heal;
          own.shield += ownCur.shield;
        }
      }

      allDamage += cur.rawDamage; allHeal += cur.heal; allShield += cur.shield;
      allChips += beatChips; allSeal += beatSeal;
      if (first) {
        rawDamage += cur.rawDamage; heal += cur.heal; shield += cur.shield;
        cardChips += beatChips; cardSeal += beatSeal;
      }
      // ONE ACTIVATION, AS THE SCENE HAS TO REPLAY IT. The cascade reads this to
      // punch the card once per activation and to reveal what the wheel did each
      // time; `beats[i % beats.length]` is the contract, so an ordinary card's
      // single identical beat answers for all of them.
      beats.push({
        roulette: spin, dead: isScoring && spinDead, value: alive ? kValue : 0,
        rawDamage: cur.rawDamage, heal: cur.heal, shield: cur.shield,
        chips: beatChips,
        // FLAT mult this activation put on the board: a RED spin when it
        // lands, the MULTIPLICATIVE SEAL every time its card fires. The card
        // walk resolves the beats and the cascade ticks them live — one
        // contract, read twice.
        mult: ((alive && spin === 'red') ? ROULETTE_RED_MULT : 0)
          + ((alive && stamp === 'mult') ? STAMP_MULT : 0),
        // ...and the ×mult it signed (joker/spectral/ethereal × shiny), 1 when
        // this activation signed nothing.
        multFactor: beatFactor,
      });
    }

    if (etherealHits > 0) {
      etherealIds.push(card.id);
      etherealActivations[card.id] = (etherealActivations[card.id] ?? 0) + etherealHits * outside;
    }
    if (fadedHits > 0) {
      fadedOut.push(card.id);
      fadedActivations[card.id] = (fadedActivations[card.id] ?? 0) + fadedHits * outside;
    }
    rouletteMultBonus += cardMult;
    // The loop resolved one window for an ordinary card (outside = handRepeat)
    // and every window for a wheel card (outside = 1); the BANK reports the
    // whole hand either way, matching what the card walk pays out.
    stampMultBonus += cardStampMult * outside;

    // WHICH POOL. A wheel card has already counted every repeat; everything else
    // is one hand's worth and outScale finishes the job.
    if (outside === 1 && handRepeat > 1) {
      baseFlat += allDamage;
      healFlat += allHeal;
      shieldFlat += allShield;
      chipFlat += allChips;
      sealHealFlat += allSeal;
    } else {
      baseSum += rawDamage;
      healPool += heal;
      shieldPool += shield;
      chipBonus += cardChips;
      sealHeal += cardSeal;
    }
    // THE PER-SUIT RAW, in one consistent unit so FORGET SUIT's ratio stays
    // exact: what this card will actually have contributed by the end.
    damageBySuit[suit] = (damageBySuit[suit] ?? 0) + allDamage * outside;
    raw.push({
      card, rawDamage, heal, shield, scoring: isScoring, ruleSuit,
      ownValue, faceBonus, suitBonus, modBonus, rouletteBonus, roulette, dead,
      cardChips, cardMult, cardSeal, cardStampMult,
      value: v, own, retriggered,
      times, liveTimes, activations: times * handRepeat, beats,
      allDamage: allDamage * outside,
    });
  });

  // --- THE HAND'S OWN BASE VALUE (JC, 2026-08-06 — THE HANDS OVERHAUL) -----
  //
  // WHAT THE HAND IS WORTH BEFORE A CARD HAS TICKED. Every hand type now brings
  // a base value as well as a mult (poker.js HAND_DEFS), rising with the Smith's
  // levels at its own valueStep, and it lands HERE: on the score side, once per
  // hand activation, before the mult walk and before anything multiplies.
  //
  // WHICH POOL, and why it matters. baseSum is the pool the hand-wide outScale
  // multiplies, so a hand that HAPPENS TWICE brings its base value twice —
  // which is the only reading of "the hand happens again" that is not a lie.
  // (baseFlat is the wheel's pool: it has already counted its own repeats and
  // is nothing to do with the hand's identity.)
  //
  // DAMAGE SIDE ONLY. The base joins the score side and multiplies out into the
  // blow. It is not a card and it has no suit, so it contributes nothing to the
  // heal pool (Hearts), the shield pool (Diamonds), the club splash's per-card
  // share or the chip bonus — every one of those stays a pure card-value
  // channel, exactly as it was.
  //
  // UNCONDITIONAL, ON EVERY HAND (JC's explicit call). A gem flush now deals
  // base × mult damage AND still plates you; a hand that somehow makes no card
  // damage at all still swings for what the hand itself is worth. Which is why
  // it is added ABOVE the two flat-value relics below rather than beneath them:
  // there is always a score side for them to ride now, and their old "did the
  // cards make anything?" gate has nothing left to refuse.
  const level = (mods.handLevels ?? {})[hand.type] ?? 0;
  const stats = handStats(hand.type, level);
  const handBase = stats.base;
  baseSum += handBase;

  // THE STRAIGHTEDGE'S BANK — flat, PRE-MULT VALUE granted to a whole hand
  // TYPE rather than to any one card. It lands on baseSum (the score side)
  // before the mult touches it, so a levelled straight really does carry it
  // through the whole equation.
  const handValueBonus = ((mods.handValue ?? {})[hand.type] ?? 0);
  if (handValueBonus > 0) baseSum += handValueBonus;

  // FLAT VALUE (2026-08-02) — the value-side twin of flatMult. Whatever you
  // played, these relics add their number to the SCORE side before the mult
  // touches it (the Pocket Anvil's +15, the Golden Spud's +100).
  const flatValueBonus = mods.flatValue ?? 0;
  if (flatValueBonus > 0) baseSum += flatValueBonus;

  // THE TORTOISE STANDARD (2026-08-10) — flat PRE-MULT value bought with the
  // wall you are already standing behind. It reads state.shield ONLY: the plate
  // this hand is about to lay is not something you were standing behind when
  // you chose the hand, and counting it would also let a Diamond hand pay for
  // its own bonus. Lands on baseSum with the other flat value channels, so the
  // whole mult curve multiplies it.
  const shieldStanding = Math.max(0, Math.round(state.shield ?? 0));
  const shieldValueBonus = (mods.shieldValue ?? 0) > 0
    ? Math.floor(shieldStanding / SHIELD_VALUE_STEP) * mods.shieldValue : 0;
  if (shieldValueBonus > 0) baseSum += shieldValueBonus;

  // FLAT SHIELD (2026-08-02) — the Tungsten Cube. Added to any hand that
  // already grants Shield, and added HERE, inside scoreHand, which is what puts
  // it upstream of Aegis Core: the scene's shieldGain() multiplies whatever
  // this file hands it, so the Cube's +3 is amplified by the Core like every
  // other point of plate. A hand that shields nothing gets nothing extra.
  const flatShieldBonus = mods.flatShield ?? 0;
  if (flatShieldBonus > 0 && shieldPool + shieldFlat > 0) shieldPool += flatShieldBonus;

  // --- effMult: base mult + Smith levels + artifact hand bonuses + passives ---
  // Where the MULT side of the combat equation starts counting: the printed
  // hand mult plus whatever the Smith has leveled it to. Everything after this
  // (artifacts, passives, jokers) arrives as a visible pulse. Display only.
  // (`level` and `stats` were resolved above, where the base VALUE landed —
  // one read of handStats answers for both halves of the opening equation.)
  const baseMult = stats.mult;

  /**
   * THE ORDERED RELIC WALK (JC, 2026-08-02: "Artifact order should matter...
   * left to right"). One relic's ADDS land before the next relic's MULTIPLIES,
   * so a +12 to the LEFT of a ×2 is worth twice a +12 to its RIGHT.
   *
   * `addOf()` and `factorOf()` are what ONE entry contributes. Note that the
   * old per-card `suitMultBonus` loop is exactly `Σ suitMult[s] × suitCounts[s]`
   * — both already carry the per-card `times` weighting — and that every factor
   * here commutes. That is the property which makes a modList holding a SINGLE
   * MERGED ELEMENT reproduce the old arithmetic bit for bit, and it is why
   * every legacy caller (unit tests, the deck picker, anything that only knows
   * about state.mods) keeps its exact numbers through the fallback below.
   */
  const suitMultOf = (sm) => {
    if (!sm) return 0;
    let s = 0;
    for (const k of Object.keys(sm)) s += sm[k] * (suitCounts[k] ?? 0);
    return s;
  };
  const addOf = (m) => ((m.handMult ?? {})[hand.type] ?? 0)
    + (m.flatMult ?? 0)
    + (m.faceMult ?? 0) * faceCount
    + suitMultOf(m.suitMult);
  const factorOf = (m) => ((m.handFactor ?? {})[hand.type] ?? 1)
    // Alchemist's Still: one × per modified card that scored, compounding.
    * ((m.modCardFactor && m.modCardFactor !== 1 && modCount > 0)
      ? Math.pow(m.modCardFactor, modCount) : 1)
    * (m.globalMultFactor ?? 1);

  // No ordered list? Synthesise one merged element. Identical arithmetic, and
  // every caller that predates the chain keeps working untouched.
  const modList = (Array.isArray(state.modList) && state.modList.length)
    ? state.modList : [{ art: null, id: 'merged', name: 'ALL MODS', mods }];

  // THE RESIDUAL. The merged bag is still the authority on the TOTAL: anything
  // in it that the ordered list does not account for (a one-hand blessing, a
  // potion, a scene-level factor with no cell on the belt) is carried here.
  // Residual ADDS land BEFORE the walk, residual MULTIPLIES land AFTER it,
  // which is precisely where the old un-ordered pipeline put them — so an
  // unaccounted contribution can never change a number, only its position.
  //
  // BOTH RESIDUALS ARE DIFFERENCES OF TWO LARGE NUMBERS, which is exactly the
  // shape that answers NaN when the two are Infinity (Infinity - Infinity,
  // Infinity / Infinity). capNum keeps each side finite so the subtraction and
  // the division are always ordinary arithmetic; the guards then refuse
  // anything that still is not a usable number, because a residual is a
  // CORRECTION and a broken correction must be no correction, never a zero.
  let listAdd = 0;
  let listFactor = 1;
  for (const e of modList) {
    listAdd = capNum(listAdd + addOf(e?.mods ?? {}));
    listFactor = capNum(listFactor * factorOf(e?.mods ?? {}));
  }
  const residualAdd = capNum(capNum(addOf(mods)) - listAdd);
  const rawResidualFactor = listFactor ? capNum(factorOf(mods)) / listFactor : 1;
  const residualFactor = Number.isFinite(rawResidualFactor) && rawResidualFactor > 0
    ? rawResidualFactor : 1;

  // 1-2: THE CARD WALK (JC, 2026-08-04: "the hand takes the 4 seals' +12 and
  // THEN the ethereal doubles it... and a retrigger adds another +12 to 36 and
  // doubles again to 72"). Starting from the printed hand mult + Smith levels,
  // the played cards resolve LEFT TO RIGHT, activation by activation, window
  // by window: flat channels (MULTIPLICATIVE SEALS, RED spins) ADD to the
  // running mult, the ×mult layers (joker/spectral/ethereal, shiny) MULTIPLY
  // it at their card's own position — so a seal BEFORE the ghost is worth
  // double what it is behind it, and a repeating hand replays the whole
  // sequence onto the running total. The walk reads the same beats[] the
  // cascade replays on screen: one contract, read twice.
  //
  // THE CAP LIVES INSIDE THE WALK (2026-08-10). Every step of the running mult
  // goes through capNum, so the walk can compound as many ×2 layers as a build
  // can buy and the number simply arrives at 1e30 and stays there. Nothing
  // downstream ever sees an intermediate large enough to overflow — which is
  // the whole overflow class retired at its source rather than patched at its
  // symptoms. See INFINITY_CAP at the top of this file.
  let effMult = capNum(baseMult);
  let modMultFactor = 1;   // reporting: the product of every ×mult signed
  for (let h = 0; h < handRepeat; h++) {
    for (const r of raw) {
      if (!r.scoring) continue;
      const L = r.beats?.length ?? 0;
      if (!L) continue;
      const wheel = L > r.times;   // a wheel card's beats span every window
      for (let k = 0; k < r.times; k++) {
        const beat = r.beats[wheel ? (h * r.times + k) % L : k % L];
        if (!beat || beat.dead) continue;
        effMult = capNum(effMult + (beat.mult ?? 0));
        const f = beat.multFactor ?? 1;
        effMult = capNum(effMult * f);
        modMultFactor = capNum(modMultFactor * f);
      }
    }
  }
  // 3: the HOARD's flat mult, then anything not on the belt. The hoard lands
  // HERE, after the cards and at the front of the relics, which is exactly
  // the position the Solid Gold Sack exists to trade away.
  effMult = capNum(effMult + chipMultAdd + residualAdd);
  // 4: THE WALK. Left to right, each relic's adds then its own multiplies.
  const multOrder = [];
  for (const e of modList) {
    const m = e?.mods ?? {};
    const add = addOf(m);
    const factor = factorOf(m);
    effMult = capNum(effMult + add);
    effMult = capNum(effMult * factor);
    if (add !== 0 || factor !== 1) {
      // The ledger the cascade animates and a driver reads back. Clamped like
      // everything else: these are DISPLAYED, and a row printing 1e307 beside a
      // running total that says ∞ is the two halves of the screen disagreeing.
      multOrder.push({
        id: e?.id ?? null, name: e?.name ?? null,
        add: capNum(add), factor: capNum(factor), mult: effMult,
      });
    }
  }
  effMult = capNum(effMult * residualFactor);

  // 5: the hero passive, then (below) the Zealot's Zeal discharge.
  //
  // BANKED, NOT MERELY APPLIED (2026-08-06). The HUD's passive chip swells in
  // the cascade exactly like a relic does, and it may only swell on a hand the
  // passive ACTUALLY moved — a five-card Dextra hand must show nothing. So the
  // factor is reported instead of being re-derived downstream off the card
  // count, which would mean a second copy of HIGH_ROLLER_CARD_MULT living in
  // the UI and drifting the first time this table is retuned.
  let passiveMultFactor = 1;
  if (character === 'highRoller') {
    passiveMultFactor = HIGH_ROLLER_CARD_MULT[n] ?? 1;
    effMult = capNum(effMult * passiveMultFactor);
  }

  // --- the hand-wide output scale ---------------------------------------
  // handRepeat  — the hand HAPPENS again (Repeating Pocketwatch, the Sharpest
  //               Dagger). ↻ language; total activations, not mult.
  // valueFactor — everything the hand outputs is worth more (the Forge Hammer,
  //               which ALSO doubles the mult through globalMultFactor).
  // Both land on the OUTPUT (score side, club splash, shield, heal, chips) and
  // never on the mult, so the equation can announce each on the right side.
  // ADDITIVE since 0803-B — see handRepeatOf for why 1+1+4 and not 2×5.
  // (handRepeat itself is resolved at the top of the function now: the wheel has
  // to know how many activations it is spinning for before pass 1 runs.)
  const valueFactor = capNum(Math.max(1, mods.valueFactor ?? 1));
  const outScale = capNum(handRepeat * valueFactor);
  // THE SCORE SIDE, WHOLE. baseSum is one hand-activation and takes outScale;
  // baseFlat has already counted every activation and takes valueFactor alone.
  // With no repeat in play baseFlat is 0 and this is exactly baseSum * outScale.
  const scoreSide = capNum(capNum(baseSum * outScale) + capNum(baseFlat * valueFactor));
  const shieldByMult = !!mods.shieldByMult;
  const healByMult = !!mods.healByMult;

  // ZEAL: the battery discharges into the blow. Only a hand that actually DEALS
  // DAMAGE can spend it (that is the whole sentence on Zelus's card), so a pure
  // heal hand banks Zeal rather than wasting it — including under the Infinite
  // Heart, where Hearts deal nothing and the battery simply waits for a sword.
  let zealConsumed = 0;
  let zealFactor = 1;
  if (character === 'zealot') {
    const zeal = state.zeal ?? 0;
    if (zeal > 0 && baseSum + baseFlat > 0) {
      zealFactor = capNum(1 + zeal * ZEAL_DAMAGE_PCT);
      effMult = capNum(effMult * zealFactor);
      zealConsumed = capNum(zeal);
    }
  }

  // THE ANCIENT SHIELD: the wall becomes the swing. Same shape as Zeal above,
  // same place in the pipeline, so the mult side shows the spend and the
  // equation's identity closes. See SHIELD_MULT_PCT for what it reads and why.
  let shieldMultRead = 0;
  let shieldMultFactor = 1;
  if (mods.shieldMult) {
    shieldMultRead = capNum(Math.max(0, Math.round((state.shield ?? 0) + shieldPool + shieldFlat)));
    if (shieldMultRead > 0) {
      shieldMultFactor = capNum(1 + shieldMultRead * SHIELD_MULT_PCT);
      effMult = capNum(effMult * shieldMultFactor);
    }
  }

  // 6: (retired 2026-08-04) the ×mult layers used to land here as one lump —
  // they now pay inside the CARD WALK above, per activation and per window, at
  // their card's own position. modMultFactor survives purely as reporting.

  /**
   * 7: THE LEFTOVER BENCH RESOLVES LAST (JC, 0803-B §1.1).
   *
   * Every effect that reads the cards you did NOT play — Court in Session's
   * +20% a card, the RIGGED WHEEL's ×1.25 a benched roulette, the VOIDCALLER's
   * ×1.25 a benched ghost — used to ride globalMultFactor, which means it landed
   * at its own relic's CELL in the ordered walk. Anything that ADDED mult to the
   * right of that cell was therefore never multiplied by it: the ×1.25s were
   * multiplying the small mult the hand had halfway through the row, and the
   * bench beat landed on screen before the hand had even finished repeating.
   *
   * They now arrive HERE, as one finished product on mods.benchFactor, after the
   * walk, after the residual, after the hero passive, after Zeal and the Ancient
   * Shield and every card's own ×. Whatever the hand built, the bench multiplies
   * it. That is the whole reason to hold a card back.
   *
   * (mods.benchFactor is the SCENE's channel — it is the only place that can see
   * which cards are still in your hand — so it is deliberately absent from
   * factorOf() above and can never leak into the walk or the residual.)
   */
  const benchFactor = capNum(Math.max(0, mods.benchFactor ?? 1)) || 1;
  if (benchFactor !== 1) effMult = capNum(effMult * benchFactor);
  // 8: THE SOLID GOLD SACK, dead last: the whole hoard multiplied into the
  // finished number (see chipMultFactorOf).
  if (chipMultFactor !== 1) effMult = capNum(effMult * chipMultFactor);

  /**
   * 8b: SIX OF A KIND SQUARES THE FINISHED MULT — THE LAST LINE OF THE MULT.
   *
   * THIS IS THE LINE (JC spec, 2026-08-10: "document the exact line in a
   * comment"). It sits after the card walk, after the ordered relic chain,
   * after the suit mults and the face mults that ride addOf, after the hero
   * passive, after Zeal, after the Ancient Shield, after the leftover bench and
   * after the Solid Gold Sack — and immediately before the 2dp rounding and the
   * damage identity below. Everything the hand built is inside the square.
   *
   * ONCE PER SCORING, never per retrigger window. The card walk above has
   * already replayed every window onto the running total by the time control
   * reaches here, so a repeating SIX OF A KIND compounds first and squares once.
   *
   * THE CAP APPLIES AFTER THE SQUARE. A squared mult is exactly how a player
   * reaches ∞ — 1e15 squared IS the ceiling — so this is the smooth path to the
   * top tier rather than a special case bolted beside it.
   */
  const multBeforeSquare = effMult;
  const handSquared = !!HAND_DEFS[hand.type]?.squaresMult;
  if (handSquared) effMult = capNum(effMult * effMult);

  effMult = capNum(Math.round(effMult * 100) / 100);   // 9: round to 2dp, as always

  // THE DAMAGE IDENTITY, capped: damage = round(scoreSide × effMult). The
  // equation on screen reconciles to exactly these two numbers at the slam
  // (CombatScene.eqSlam), so what is displayed is what is dealt.
  let damage = capNum(Math.round(capNum(scoreSide * effMult)));

  // (2026-08-01) The Bull's old '+25% of current Shield as bonus damage' used
  // to be added here. It is GONE — his damage now comes from the Diamonds
  // themselves (gemFactor above), which is a decision you make with your hand
  // rather than a number that accrues while you do something else.
  if (damage > 0 && state.flatBonus) {
    damage = capNum(damage + state.flatBonus);
  }

  // --- breakdown: per-card damage scaled to match the final effMult ---
  // `base` is the same card with every ARTIFACT value-mod switched off, so the
  // UI can pop base -> +delta -> final and have the arithmetic actually close.
  // rawDamage / heal / shield here are ONE activation of the card: the hand-wide
  // scales (outScale, shieldScale, healScale) are deliberately NOT baked in, so
  // the equation can feed a card's single contribution onto the score side and
  // then announce the Pocketwatch's ×2 as its own visible beat.
  const breakdown = raw.map(({ card, rawDamage, heal, shield, scoring: isScoring, ruleSuit, ownValue, faceBonus, suitBonus, modBonus, rouletteBonus, roulette, dead, cardChips, cardMult, cardSeal, cardStampMult, value, own, retriggered, times, liveTimes, activations, beats, allDamage }) => ({
    id: card.id,
    // WHAT IT IS. The card bottom, the aura, every suit-keyed relic. TRUE
    // COLORS never touches this; only `ruleSuit` below moves.
    suit: effectiveSuit(card, character),
    // HOW IT HITS. Equal to `suit` for every hand in the game except under
    // TRUE COLORS, and reported so the UI and a driver can tell them apart.
    ruleSuit,
    rank: card.rank,
    mod: card.mod ?? null,
    // THE THREE LAYERS, decomposed for the UI: what it IS, what was pressed
    // into it, what it is wrapped in. All three can be non-null at once.
    layerMod: cardMod(card),
    stamp: cardStamp(card),
    wrap: cardWrap(card),
    // WHAT THIS CARD ACTUALLY DEALT, over every activation it will ever have.
    // `allDamage` already counts the repeats a wheel card resolved for itself,
    // so it takes valueFactor alone; everything else is one hand's worth and
    // takes the full outScale. The two are the same number when nothing repeats.
    // capNum on the way out: a card that scored NOTHING is `0 × effMult`, which
    // is NaN the instant effMult is not finite — and a NaN here reached the club
    // splash's sum, the card bottoms and the recap.
    damage: capNum(Math.round(capNum(allDamage * valueFactor * effMult))),
    // CLUBS: a quarter of what THIS card dealt reaches every other enemy. Zero
    // for every other suit, so the card bottoms only print it where it is real.
    // Reads the RULE suit, because the splash IS the club suit's rule: under
    // TRUE COLORS an Ophelia hand splashes whatever it is made of.
    aoe: ruleSuit === 'clovers'
      ? capNum(Math.round(capNum(allDamage * valueFactor * effMult) * CLUB_SPLASH)) : 0,
    // --- the repeat (2026-08-04) ---
    times,          // CARD-level activations: an ECHO SEAL, the Ouroboros
    liveTimes,      // ...of which this many actually paid (a BLACK spin did not)
    activations,    // times × handRepeat: every time this card really happens
    beats,          // one entry per activation the scene must replay, in order
    rawDamage,                                // pre-mult damage: the SCORE side's per-card add
    heal,
    shield,
    chips: cardChips,                         // gilded/forged 4 · a GOLD spin 15
    scoring: isScoring,
    // --- the wheel (display + the scene's reveal beat) ---
    roulette,                                 // null | 'gold' | 'red' | 'black' | 'green'
    dead,                                     // BLACK: it formed the hand and paid nothing
    rouletteMult: cardMult,                   // the flat mult a RED spin put on the mult side
    sealHeal: cardSeal,                       // BLOOD SEAL: HP this card paid, pre-outScale
    stampMult: cardStampMult,                 // MULTIPLICATIVE SEAL: flat mult this card added
    retriggered: isScoring && retriggered,    // Ouroboros: this one counted N times
    // --- artifact value-mod decomposition (display only) ---
    value,                                    // value that actually scored (7 + 3 = 10)
    baseValue: ownValue,                      // rank + printed card mod, no artifacts (7)
    valueBonus: faceBonus + suitBonus + modBonus + rouletteBonus,  // what was added (+3)
    valueBonusSuit: suitBonus,
    valueBonusFace: faceBonus,
    valueBonusMod: modBonus,
    valueBonusRoulette: rouletteBonus,        // a GREEN spin's +10 — morphs like the rest
    base: {                                   // contribution with valueBonus removed
      damage: capNum(Math.round(capNum(own.rawDamage * outScale * effMult))),
      heal: own.heal,
      shield: own.shield,
    },
  }));

  // --- the club splash ---------------------------------------------------
  // Summed from the cards rather than recomputed from the total, so the number
  // under a club card and the number in the preview readout are the same
  // arithmetic and can never drift by a rounding step.
  const aoeSplash = capNum(breakdown.reduce((s, b) => capNum(s + (b.aoe ?? 0)), 0));

  // --- heal / shield / zeal gain ---
  // The hand-wide scale lands here, plus (for the two hero exclusives) the
  // hand's own mult. Shield still routes through the scene's Aegis factor.
  const healScale = capNum(outScale * (healByMult ? effMult : 1));
  const shieldScale = capNum(outScale * (shieldByMult ? effMult : 1));
  // The FLAT pool's twin of each scale: valueFactor where the repeating pool
  // takes outScale, because a wheel card has already counted its own repeats.
  const healScaleFlat = capNum(valueFactor * (healByMult ? effMult : 1));
  const shieldScaleFlat = capNum(valueFactor * (shieldByMult ? effMult : 1));
  healPool = capNum(capNum(healPool * healScale) + capNum(healFlat * healScaleFlat));
  shieldPool = capNum(capNum(shieldPool * shieldScale) + capNum(shieldFlat * shieldScaleFlat));
  chipBonus = capNum(Math.round(capNum(chipBonus * outScale) + capNum(chipFlat * valueFactor)));
  // BLOOD SEALED pays per activation, so the hand-wide scale lands on it too —
  // exactly like the chips. It never touches healPool: this is the CARD healing
  // you, not the hand's Hearts, so no Zeal overflow and no ×mult rewrite.
  sealHeal = capNum(Math.round(capNum(sealHeal * outScale) + capNum(sealHealFlat * valueFactor)));

  // Which currency does the equation's SCORE side count in this hand? Damage,
  // normally — since the 2026-08-01 reworks a DIAMONDS hand and a CLUBS hand
  // both deal damage like any other, so they fall through here honestly. The
  // fallbacks are still live for the hero-exclusive rewrites: the Infinite
  // Heart's mult-heal reads HEAL, and a hand that somehow makes only shield
  // reads SHIELD.
  //
  // (2026-08-06: the HAND'S OWN BASE VALUE is on baseSum unconditionally now,
  // so in practice every hand answers 'damage' and the mult side is always lit.
  // The two fallbacks are kept rather than deleted because they are the shape a
  // future "this suit stops dealing damage" relic needs to exist in, and they
  // cost one comparison to keep honest.)
  const scoreCurrency = baseSum + baseFlat > 0 ? 'damage'
    : shieldPool > 0 ? 'shield'
      : healPool > 0 ? 'heal' : 'damage';

  // Does the MULT side own this hand's total? Normally that means "the hand
  // deals damage" — but each hero-exclusive rewrite hands the mult to a
  // different currency, and the equation has to stay lit for it.
  const multApplies = baseSum + baseFlat > 0
    || (shieldByMult && shieldPool > 0)
    || (healByMult && healPool > 0);

  const maxHp = state.maxHp ?? 0;
  const hp = state.hp ?? 0;
  const missing = Math.max(0, maxHp - hp);
  const healApplied = Math.min(healPool, missing);
  const overheal = Math.max(0, healPool - missing);

  let zealGained = 0;
  if (character === 'zealot') {
    const zeal = state.zeal ?? 0;
    // No ceiling (2026-08-04): every point of overheal banks, always. The
    // clamp shape survives because zealCapFor is still the one authority.
    zealGained = Math.min(overheal, Math.max(0, zealCapFor(mods) - zeal));
  }

  return {
    damage: capNum(Math.round(damage)),
    heal: capNum(Math.round(healApplied)),
    // What the hand PRODUCED, before the missing-HP cap ate the rest. The
    // equation totals this (a Zealot's overflow becomes Zeal, so none of it is
    // a lie); `heal` above is what actually reached the hero.
    healRaw: capNum(Math.round(healPool)),
    shield: capNum(Math.round(shieldPool)),
    chipBonus,
    sealHeal,          // BLOOD SEALED cards' HP, hand-scale applied
    etherealIds,       // ethereal cards that SCORED — the scene rolls their vanish
    // ...and HOW MANY ROLLS each one owes: one per activation that paid out.
    etherealActivations,
    // THE FADE's twin pair: FADING cards that scored, and the rolls they owe
    // at FADE_VANISH_CHANCE. Separate from the ghosts on purpose (2026-08-04).
    fadedIds: fadedOut,
    fadedActivations,
    rouletteMultBonus, // flat mult the RED spins added (display/verification)
    stampMultBonus,    // flat mult the MULTIPLICATIVE SEALS added
    handValueBonus,    // flat pre-mult VALUE a hand-type relic added (Straightedge)
    flatValueBonus,    // flat pre-mult VALUE added to EVERY hand (Pocket Anvil)
    shieldValueBonus,  // ...and the value the standing wall bought (Tortoise Standard)
    shieldStanding,    // the Shield it read
    flatShieldBonus,   // flat Shield added to any hand that shields (Tungsten Cube)
    // CLUBS: total damage this hand splashes onto every OTHER living enemy.
    // 0 for a hand with no clubs in it — the readout stays off when it is off.
    aoeSplash,
    // --- THE HERO PASSIVE'S OWN SHARE (2026-08-06) -----------------------
    // Two scalars, one per hero whose passive is arithmetic rather than an
    // event: Dextra's few-card ×N on the MULT side, the Bull's Diamond ×2 on
    // the SCORE side. 1 means "this hand's hero has no such passive, or it did
    // not fire" — which is the whole gate the HUD chip reads (core/passives.js).
    // Zelus's discharge is already reported as zealConsumed/zealFactor and
    // Drusky's as chipMultAdd; Ophelia's is not arithmetic at all (her seepage
    // happens per damage event, in the scene) and so has no field here.
    passiveMultFactor,
    passiveGemFactor,
    zealConsumed,      // Zeal spent by this hand (the battery discharged)
    zealFactor,        // ...and what it multiplied the mult by (1 = it did not fire)
    zealGained: capNum(Math.round(zealGained)),
    zealCap: zealCapFor(mods),   // THE CAP, which is "no cap" (see zealCapFor)
    shieldMultRead,    // THE ANCIENT SHIELD: points of Shield the mult read
    shieldMultFactor,  // ...and the factor they bought (1 = the relic is not on)
    breakdown,
    faceCount,        // scoring J/Q/K — Kingmaker's cascade pulse reads this
    modCount,         // scoring modded cards — the Still's cascade pulse
    suitCounts,       // scoring cards per effective suit — Prayer Beads' pulse
    // RAW damage per effective suit, pre-mult. The Plains' FORGET SUIT reads
    // this to strip exactly one suit's share of the finished damage.
    damageBySuit: Object.fromEntries(
      Object.entries(damageBySuit).map(([s, v]) => [s, capNum(v)])),
    retrigger,        // how many times the top card counted (1 = no Ouroboros)
    retriggerId,      // which card that was
    handRepeat,       // whole-hand activations, ADDITIVE (Pocketwatch + Dagger)
    handRepeatAdd: handRepeat - 1,   // ...and the EXTRA plays alone: "+N replays"
    valueFactor,      // whole-hand value scale (the Forge Hammer)
    benchRepeat: Math.max(1, Math.round(mods.benchRepeat ?? BENCH_REPEAT_BASE)),
    benchFactor,      // THE BENCH, resolved last: what the leftovers multiplied by
    chipsRead: chips, // the hoard the mult read (0 for everyone but Drusky)
    chipMultAdd,      // ...the flat mult it bought (his passive)
    chipMultFactor,   // ...or the factor it bought instead (the Solid Gold Sack)
    outScale,         // handRepeat * valueFactor — what the score side must ×
    healScale,        // outScale, plus effMult when the Infinite Heart is on
    shieldScale,      // outScale, plus effMult when the Ancient Shield is on
    multApplies,      // does the MULT side own this hand's total?
    scoreCurrency,    // 'damage' | 'shield' | 'heal' — what the score side counts
    handType: hand.type,
    handName: hand.name,
    handLevel: level,
    mult: hand.mult,
    baseMult,      // display: mult before artifacts/passives (hand mult + levels)
    // THE HAND'S OWN BASE VALUE (2026-08-06), levels included: the number the
    // equation OPENS on, before the first card ticks onto the score side. Sits
    // inside baseSum, so it takes outScale with everything else.
    handBase,
    // THE CHAIN, in the order it actually resolved: one row per relic that
    // moved the mult, left to right, with the running total after each. This is
    // what the cascade animates and what a verification run reads back.
    multOrder,
    residualAdd,      // mult adds not on the belt (a potion, a one-hand blessing)
    residualFactor,   // ...and the factors, applied after the walk
    effMult,
    // SIX OF A KIND's square, reported so the cascade can give it its own beat
    // and a verification run can assert the ORDER (see step 8b above).
    // TRUE COLORS: the suit every scoring card FOUGHT as, or null when the
    // relic is not on the belt. Reported so the cascade, the preview and a
    // driver can all say so without re-deriving it from the hero.
    ruleSuit: mods.trueColors ? (heroSuit(character) ?? null) : null,
    handSquared,       // did this hand square the mult? (SIX OF A KIND only)
    multBeforeSquare: capNum(multBeforeSquare),   // ...and what it squared
    // Did this hand hit the ceiling? The one flag the ∞ readout, the top payoff
    // tier, the lethality rule and the hidden trophy all read.
    infinite: isInfinite(capNum(Math.round(damage))),
    infinityCap: INFINITY_CAP,
    baseSum: capNum(baseSum),
    // The wheel's own pool: score already counted across every activation, so
    // it takes valueFactor and never outScale. 0 unless a ROULETTE card met a
    // repeating hand, which is the only case the two pools differ at all.
    baseFlat: capNum(baseFlat),
    scoreSide,        // baseSum × outScale + baseFlat × valueFactor
  };
}
