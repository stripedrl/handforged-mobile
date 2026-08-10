/**
 * @file achievements.js
 * ACHIEVEMENTS — the one shelf in HANDFORGED that is a record of what you did
 * rather than a list of what you own. Pure data + a fire path, no Phaser: the
 * scenes call noteEvent() and the overlay (ui/achievements.js) draws whatever
 * this file says.
 *
 * ADDING ONE IS ONE OBJECT. Append it to ACHIEVEMENTS with:
 *   id    — stable forever; this is what is written to the save
 *   name  — the trophy's name
 *   desc  — what you did, shown once it is UNLOCKED
 *   hint  — what a locked '???' tile shows instead. Say enough to chase.
 *   on    — the event that can fire it (see EVENTS below), or 'state'
 *   test  — (ctx) => boolean. Pure. Never mutates anything.
 *   group — the shelf's section heading. Ordering is by this file's order.
 *   tier  — OPTIONAL. A LADDER's group key ('damage', 'mult', 'difficulty').
 *           Consecutive entries sharing one draws as a single progression row
 *           instead of four unrelated tiles. See ACHIEVEMENT_SECTIONS.
 *   secret— OPTIONAL. HIDDEN UNTIL EARNED (2026-08-10). Not a '???' tile — the
 *           shelf has no row for it at all, its section's `got / total` does
 *           not count it, and neither does the case's own tally. The moment it
 *           fires, the tile appears fully written and the totals move with it.
 *           The name, desc and hint are still required (the tile has to be
 *           complete the instant it exists), they are simply never shown to
 *           anybody who has not done the thing. This is the achievement half of
 *           the SECRET HAND pattern — see poker.HAND_DEFS `secret` and
 *           rewards.handChartOverlay, which hides an undiscovered hand's row
 *           entirely for exactly the same reason (JC, 2026-08-06: a '???' tease
 *           reads as confusing rather than enticing).
 * Nothing else in the game needs touching.
 *
 * THE EVENTS (all fired by the scenes, ctx always carries `run`):
 *   'fightWon'  { flawless, discards, revived } a fight ended in your favour
 *   'actClear'  { act }                    an act's boss went down (act is 1-4)
 *   'hand'      { handType, damage, mult, cards }  a hand fully resolved
 *   'kill'      { hpBefore, damage }       one blow put an enemy down
 *   'drink'     { potionId, fightDrinks }  a potion was drunk
 *   'shop'      { }                        the merchant's table opened
 *   'buy'       { }                        something was bought at that table
 *   'sell'      { boughtThisVisit }        a relic was sold back
 *   'visit'     { eventId, mythical }      an EVENT room was entered (and, for
 *                                          the Crimson Forge, what it gave up)
 *   'state'     { }                        a plain sweep of run + progress
 *
 * EVERY event also evaluates the 'state' achievements, because those predicates
 * are pure reads of run/progress and cost nothing. That is what lets "hold three
 * potions" fire from a shop visit, a fight start or a hand, without every one of
 * those call sites having to know the achievement exists.
 *
 * FIVE OF THEM PAY A RELIC. The gate itself lives in artifacts.js eligibleFor()
 * and nowhere else; RELIC_GATE_BY_ACHIEVEMENT is only read here so the shelf can
 * SAY SO. An unlocked tile names the relic it opened; a locked one teases it.
 */

import { progress, isAchievementUnlocked, unlockAchievement } from './progress.js';
import { MAX_POTIONS } from './potions.js';
import { DIFFICULTIES, MAX_DIFFICULTY } from './difficulty.js';
import { run as liveRun, killsOfKind, effectiveArtifactSlots } from './run.js';
import { HAND_DEFS, HAND_TYPES } from './poker.js';
import { ANIMAL_KIND, RELIC_GATE_BY_ACHIEVEMENT, artifactById } from './artifacts.js';
// BATTERY FULL asks for the ceiling itself, so it reads the ceiling rather than
// a copy of it. artifacts.js already imports this module, so the edge is free.
import { ZEAL_CAP, INFINITY_CAP } from './scoring.js';
// config.js is the bottom of the graph (it imports nothing), so this edge is
// free. HOARD_UNLOCK_CHIPS is Drusky's gate, and CHARACTERS is how a trophy
// finds out it opens a hero.
import { CHARACTERS, HOARD_UNLOCK_CHIPS } from '../config.js';
// THE BIOME GATES (2026-08-03). The four act-clear trophies now name the world
// they open, and they read that name off the world itself — see actClearTrophy.
// run.js already pulls acts.js in above, so this edge costs nothing.
import { ACTS, ALT_ACTS } from './acts.js';

/**
 * THE ANVIL: one hand's damage, four rungs. Written once, read by the copy, the
 * predicates and the tests, so a retune can never leave a description lying.
 */
export const HAND_DAMAGE_TIERS = [1000, 10000, 100000, 1000000];
/** Kept by name because The Forge Hammer's gate is the second rung. */
export const BIG_HAND_DAMAGE = HAND_DAMAGE_TIERS[1];
export const HUGE_HAND_DAMAGE = HAND_DAMAGE_TIERS[2];
/** THE MULTIPLIER: highest mult reached in one hand, three rungs. */
export const MULT_TIERS = [25, 100, 500];
/** OVERKILL: the blow has to be this many times what the body had left. */
export const OVERKILL_FACTOR = 10;
/** THE LEDGER. */
export const LIQUID_CHIPS = 1000;
export const OBSCENE_CHIPS = 5000;
export const SPREE_BUYS = 5;
export const PAWNBROKER_SELLS = 10;
/** THE DECK. */
export const ONE_INCH_DAMAGE = 5000;
export const THIN_DECK = 20;
export const FAT_DECK = 60;
/**
 * PAPER THIN was written as EXACTLY 1 HP, which is a knife edge the game hardly
 * ever lands on: enemy damage is discrete and shields absorb in whole chunks, so
 * the HP you finish a fight on is a more or less arbitrary integer. (The one
 * reliable source of exactly 1 is the events' Math.max(1, hp - X) clamp.) Three
 * or fewer is the same trophy, three times as likely, and still reads as
 * "you had nothing left".
 */
export const PAPER_THIN_HP = 3;
/** THE COLLECTION. */
export const MUSEUM_MYTHICALS = 2;
export const FENG_SHUI_REORDERS = 20;
/** THE ODDITIES. */
export const GAMBLER_PULLS = 10;
export const HOUSE_LOSS_STREAK = 5;
export const BREWMASTER_DRINKS = 3;
/**
 * TAXIDERMY was written at 100 and 100 is not reachable. Counted off the actual
 * encounter pools (acts.js) against the actual route length (map.js: one walk,
 * ~8 combat rooms per act), a 3-act run puts down about 15 beast-category
 * bodies, a beast-heavy good run about 22, and a 4-act run about 20. The board
 * maximum is 59, and it needs every roll to come up wolves. 20 is a real ask on
 * a normal run and comfortably inside a beast-heavy one.
 */
export const TAXIDERMY_KILLS = 20;
/**
 * THE CHAMPIONS — the twenty trophies the SKINS patch added (core/skins.js).
 * Every one names a HERO, because that is the point: they dress that hero and
 * nobody else. Thresholds live here with the rest so a retune moves the copy too.
 *
 * All twenty were sized against JC's one constraint — "nothing impossible or
 * needing a total god run, more a targeted approach and perhaps some RNG":
 *   · the nine BOSS trophies are a 1-in-3 roll you can walk away from and redraw
 *     next run, on BRONZE if you like;
 *   · the five CRUCIBLE trophies are Act IV, which the game already opens the
 *     moment you clear Act III once;
 *   · the six KIT trophies are each hero's own signature turned up one notch
 *     from a number the shelf already asks of everybody.
 */
export const BULL_SHIELD = 200;        // vs. nothing else on the shelf; his Diamonds pay it
export const OPHELIA_POISON = 2500;    // = one ~5,000 hand, her conversion being half
export const DEXTRA_ONE_CARD = 25000;  // 5x ONE INCH PUNCH, on the hero built for it
export const DRUSKY_CHIPS = 7500;      // one rung above OBSCENE, for the man who hoards
export const DRUSKY_SWING = 100000;    // FORGE BREAKER's number, on chips-into-mult

/** 1000 -> "1,000". Every threshold in the copy goes through here. */
const n = (v) => v.toLocaleString('en-US');

/** The nine hands on the printed chart. The two secrets have their own trophies. */
export const BASE_HAND_TYPES = HAND_TYPES.filter(t => !HAND_DEFS[t].secret);

/** The mode index of a named rung, by id — never a hardcoded number. */
function modeIndex(id) {
  const i = DIFFICULTIES.findIndex(d => d.id === id);
  return i < 0 ? MAX_DIFFICULTY : i;
}
/** One rung of THE LADDER: same shape five times, so no copy can drift. */
function difficultyRung(id, achId) {
  const mode = DIFFICULTIES[modeIndex(id)];
  return {
    id: achId, name: `${mode.name.charAt(0)}${mode.name.slice(1).toLowerCase()} Forged`,
    desc: `Clear Act III on ${mode.name}.`,
    hint: `Clear Act III on ${mode.name}.`,
    group: 'THE LADDER', tier: 'difficulty',
    on: 'state', test: () => bestDifficultyCleared() >= modeIndex(id),
  };
}

/**
 * The highest mode ANY hero has cleared Act III on. Reads the ladder the
 * difficulty system already banks (progress.difficultyCleared) rather than
 * re-deriving one: clearing on IRON with anybody is IRON FORGED.
 */
function bestDifficultyCleared() {
  const map = progress.difficultyCleared ?? {};
  let best = -1;
  for (const v of Object.values(map)) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > best) best = Math.min(n, MAX_DIFFICULTY);
  }
  return best;
}

/** Relics in the row, ignoring the weightless ones (mirrors, the glove nook). */
function slotsFilled(r) {
  return (r?.artifacts ?? []).filter(a => !a?.props?.noSlot).length;
}

/**
 * THE POTATO'S SECRET. The relic that hatches out of it is not written yet
 * (artifacts.js, same night), so this reads every shape it could plausibly
 * take rather than betting on one: a new id, a flag on its state, or simply
 * the new name. Deliberately generous — a missed trophy is worse than an early one.
 */
function foundTheSpud(r) {
  return (r?.artifacts ?? []).some(a =>
    a?.id === 'goldenSpud' || a?.state?.golden === true || /golden spud/i.test(a?.name ?? ''));
}

/** ...and the same for an EGG that has hatched, wherever the ceremony parks it. */
function somethingHatched(r, ctx) {
  if (ctx?.hatched) return true;
  // run.pendingHatch is a QUEUE in the shipped shape (an empty array means
  // nothing is waiting), but a single object would read as pending too. Both
  // shapes answer correctly here, and neither empty one counts.
  const queued = r?.pendingHatch;
  if (Array.isArray(queued) ? queued.length > 0 : !!queued) return true;
  if (r?.stats?.hatched) return true;
  return (r?.artifacts ?? []).some(a => a?.state?.hatched === true);
}

/** DISTINCT Mythicals on the belt. A mirror aimed at one is not a second one. */
function mythicalsOwned(r) {
  return new Set((r?.artifacts ?? [])
    .filter(a => a?.rarity === 'mythical').map(a => a.id)).size;
}

/**
 * THE MULT CHANNELS. ALL GAS, NO BRAKES asks whether every relic in the row is
 * a MULTIPLIER, and the honest answer is "does its mods bag declare any of the
 * mult channels" — presence, not current value, because a scaler sitting at
 * zero (a Wolfsbane before the first wolf) is still a multiplier.
 */
const MULT_CHANNELS = [
  'flatMult', 'handMult', 'suitMult', 'faceMult', 'globalMultFactor', 'handFactor',
];

function isMultiplier(a, r) {
  let m = null;
  try { m = typeof a?.mods === 'function' ? a.mods(a, r) : a?.mods; } catch { return false; }
  if (!m) return false;
  return MULT_CHANNELS.some(k => m[k] !== undefined && m[k] !== null);
}

/** The Slot Button's own ledger, wherever it sits in the row. */
function slotLedger(r) {
  return (r?.artifacts ?? []).find(a => a?.id === 'slotButton')?.state ?? null;
}

/** Has every hand on the printed chart been played, ever? (progress, not run) */
function playedEveryHand() {
  const seen = progress.playedHands ?? [];
  return BASE_HAND_TYPES.every(t => seen.includes(t));
}

/**
 * "THAT boss, with THAT hero." Nine of the skin trophies are this shape.
 *
 * The act number is the reliable key, not run.actIndex: 'actClear' fires from
 * bossDefeated() before the between-acts ceremony moves the run on, but keying
 * off `c.act - 1` means the predicate stays correct even if that ordering ever
 * changes. `run.bossPicks` is written when the act's map is generated and kept
 * for the whole run, so it still names the body that just fell.
 */
function beatBossWith(c, act, bossId, chrId) {
  return c.act === act
    && c.run?.chrId === chrId
    && c.run?.bossPicks?.[act - 1] === bossId;
}

/**
 * THE FOUR ACT-CLEAR TROPHIES, which are also THE FOUR BIOME GATES.
 *
 * Each one already fired on exactly this event long before alternate worlds
 * existed, so the unlocks patch gave them the second job rather than minting
 * four more achievements that would toast off the same kill (PATCH UNLOCKS §1;
 * acts.ALT_UNLOCK is the table that reads them). What changed is the LINE: the
 * toast now names the biome it just opened, because a reward nobody is told
 * about is not a reward.
 *
 * The biome's NAME is read out of ALT_ACTS rather than typed here, so renaming
 * a world renames it in the toast too and this copy cannot go stale. `verb`
 * exists only because the Ethereal Plains are plural and "the Plains now has a
 * chance to appear" is not a sentence.
 *
 * THE HINT IS NOT REWRITTEN. A locked tile teases and never names its prize —
 * the same rule the five relic-gated trophies and the twenty CHAMPIONS follow.
 * Finding out that beating an act opens a new world is the surprise.
 */
function actClearTrophy(num, id, name, hint, verb = 'has') {
  const biome = ALT_ACTS[num - 1]?.name ?? 'a new world';
  const numeral = ACTS[num - 1]?.numeral ?? num;
  return {
    id, name, hint, group: 'THE GAUNTLET',
    desc: `You beat Act ${numeral}. The ${biome} now ${verb} a chance to appear.`,
    on: 'actClear', test: (c) => c.act === num,
  };
}

/** One CHAMPION trophy: same shape twenty times, so no copy can drift. */
function champion(id, name, desc, hint, test, on = 'state') {
  return { id, name, desc, hint, group: 'THE CHAMPIONS', on, test };
}

/**
 * The nine "beat THAT boss with THAT hero" trophies, written once.
 *
 * THE HINT SAYS "ONE OF THREE", NOT "HE IS ONE OF THREE" (2026-08-04). The old
 * line gendered every target, which is wrong for THE DAUGHTERS OF DARKNESS (two
 * bodies) and for THE NIGHT MOTHER's half of the roster. It also no longer says
 * which act, because the act's numeral is already in front of it.
 */
function bossTrophy(id, name, chrId, act, bossId, bossName, skinName) {
  const hero = CHARACTERS[chrId]?.name ?? '?';
  return champion(
    id, name,
    `Beat ${bossName} with ${hero}. ${skinName} is yours.`,
    `Beat ${bossName} with ${hero}. One of the three bosses Act ${'I'.repeat(act)} can roll.`,
    (c) => beatBossWith(c, act, bossId, chrId),
    'actClear',
  );
}

/** ...and the five "clear the secret act with X" ones, which are one line each. */
function crucibleRun(id, chrId, name, skinName) {
  const hero = CHARACTERS[chrId]?.name ?? '?';
  return champion(
    id, name,
    `Clear Act IV with ${hero}. ${skinName} is yours.`,
    `Clear the act that is not on the map, with ${hero}.`,
    (c) => c.act === 4 && c.run?.chrId === chrId,
    'actClear',
  );
}

export const ACHIEVEMENTS = [
  // ======================= THE ANVIL (one hand's damage) ====================
  {
    id: 'warmSteel', name: 'Warm Steel',
    desc: `Deal ${n(HAND_DAMAGE_TIERS[0])} damage in one hand.`,
    hint: 'Deal four figures with a single hand.',
    group: 'THE ANVIL', tier: 'damage',
    on: 'hand', test: (c) => (c.damage ?? 0) >= HAND_DAMAGE_TIERS[0],
  },
  {
    id: 'bigHand', name: 'Heavy Swing',
    desc: `Deal ${n(HAND_DAMAGE_TIERS[1])} damage in one hand.`,
    hint: 'Deal five figures with a single hand.',
    group: 'THE ANVIL', tier: 'damage',
    on: 'hand', test: (c) => (c.damage ?? 0) >= HAND_DAMAGE_TIERS[1],
  },
  {
    id: 'hugeHand', name: 'Forge Breaker',
    desc: `Deal ${n(HAND_DAMAGE_TIERS[2])} damage in one hand.`,
    hint: 'Deal six figures with a single hand.',
    group: 'THE ANVIL', tier: 'damage',
    on: 'hand', test: (c) => (c.damage ?? 0) >= HAND_DAMAGE_TIERS[2],
  },
  {
    id: 'anvilCracks', name: 'The Anvil Cracks',
    desc: `Deal ${n(HAND_DAMAGE_TIERS[3])} damage in one hand.`,
    hint: 'Deal seven figures with a single hand.',
    group: 'THE ANVIL', tier: 'damage',
    on: 'hand', test: (c) => (c.damage ?? 0) >= HAND_DAMAGE_TIERS[3],
  },

  // ======================== THE MULTIPLIER (one hand) =======================
  {
    id: 'compoundInterest', name: 'Compound Interest',
    desc: `Reach x${MULT_TIERS[0]} mult on a single hand.`,
    hint: `Reach x${MULT_TIERS[0]} mult on one hand.`,
    group: 'THE MULTIPLIER', tier: 'mult',
    on: 'hand', test: (c) => (c.mult ?? 0) >= MULT_TIERS[0],
  },
  {
    id: 'runawayMath', name: 'Runaway Math',
    desc: `Reach x${MULT_TIERS[1]} mult on a single hand.`,
    hint: 'Reach three figures of mult on one hand.',
    group: 'THE MULTIPLIER', tier: 'mult',
    on: 'hand', test: (c) => (c.mult ?? 0) >= MULT_TIERS[1],
  },
  {
    id: 'justSuggestions', name: 'Numbers Are Just Suggestions',
    desc: `Reach x${MULT_TIERS[2]} mult on a single hand.`,
    hint: `Reach x${MULT_TIERS[2]} mult on one hand.`,
    group: 'THE MULTIPLIER', tier: 'mult',
    on: 'hand', test: (c) => (c.mult ?? 0) >= MULT_TIERS[2],
  },

  // ============================== THE LEDGER ===============================
  {
    id: 'liquid', name: 'Liquid',
    desc: `Hold ${n(LIQUID_CHIPS)} chips at once.`,
    hint: `Hold ${n(LIQUID_CHIPS)} chips at once.`,
    group: 'THE LEDGER',
    on: 'state', test: (c) => (c.run?.chips ?? 0) >= LIQUID_CHIPS,
  },
  {
    /**
     * THE ONE TROPHY THAT PAYS A HERO. Earning it opens DRUSKY, THE HOARDER
     * (config.CHARACTERS.hoarder.unlock names this id, and nothing else does).
     *
     * It reads run.chips, the LIVE pile, and it reads it through the 'state'
     * sweep that every event triggers — so it fires the moment you are actually
     * holding the money and never from a lifetime tally. That is the whole
     * point: a running total of everything you ever earned would be handed out
     * for free by a long run, whereas HOLDING this much at once means you chose
     * not to spend it, which is the exact behaviour Drusky's kit rewards. Spend
     * back down before an event happens to sweep and you have simply not done
     * it yet.
     */
    id: 'theHoard', name: 'The Hoard',
    desc: `Hold ${n(HOARD_UNLOCK_CHIPS)} chips at once. Somebody has been saving.`,
    hint: `Hold ${n(HOARD_UNLOCK_CHIPS)} chips at once, in one run.`,
    group: 'THE LEDGER',
    on: 'state', test: (c) => (c.run?.chips ?? 0) >= HOARD_UNLOCK_CHIPS,
  },
  {
    id: 'obscene', name: 'Obscene',
    desc: `Hold ${n(OBSCENE_CHIPS)} chips at once. The merchant does not stock that much.`,
    hint: 'Hold more chips than the merchant has stock.',
    group: 'THE LEDGER',
    on: 'state', test: (c) => (c.run?.chips ?? 0) >= OBSCENE_CHIPS,
  },
  {
    id: 'stoneBroke', name: 'Window Shopping',
    desc: 'Reach a merchant with zero chips. Browsing is free.',
    hint: 'Visit the merchant with nothing to spend.',
    group: 'THE LEDGER',
    on: 'shop', test: (c) => (c.run?.chips ?? 0) <= 0,
  },
  {
    id: 'spree', name: 'Spree',
    desc: `Buy ${SPREE_BUYS} things in one visit to the merchant.`,
    hint: "Clear most of the merchant's table in a single visit.",
    group: 'THE LEDGER',
    on: 'buy', test: (c) => (c.run?.counters?.shopBuys ?? 0) >= SPREE_BUYS,
  },
  {
    id: 'pawnbroker', name: 'Pawnbroker',
    desc: `Sell ${PAWNBROKER_SELLS} relics in a single run.`,
    hint: `Sell ${PAWNBROKER_SELLS} relics in one run.`,
    group: 'THE LEDGER',
    on: 'sell', test: (c) => (c.run?.counters?.relicsSold ?? 0) >= PAWNBROKER_SELLS,
  },
  {
    id: 'buyersRemorse', name: "Buyer's Remorse",
    desc: 'Sell a relic at the same visit you bought it. The merchant says nothing.',
    hint: 'Change your mind about a relic before you leave the tent.',
    group: 'THE LEDGER',
    on: 'sell', test: (c) => c.boughtThisVisit === true,
  },

  // =============================== THE DECK ================================
  {
    id: 'fullRepertoire', name: 'Full Repertoire',
    desc: `Play all ${BASE_HAND_TYPES.length} hands on the chart. Not in one run, just eventually.`,
    hint: 'Play every hand on the chart at least once.',
    group: 'THE DECK',
    on: 'hand', test: () => playedEveryHand(),
  },
  {
    id: 'fiveOfAKind', name: 'Impossible Deck',
    desc: 'Play Five of a Kind.',
    hint: 'Play a hand a normal deck cannot make.',
    group: 'THE DECK',
    on: 'hand', test: (c) => c.handType === 'fiveOfAKind',
  },
  {
    // FLUSH HOUSE (2026-08-06) is the reachable secret: one WILD card makes a
    // full house a flush, so this is the trophy a player can stumble into
    // rather than build a whole deck toward. Same shape as its two neighbours.
    id: 'flushHouse', name: 'Flush House',
    desc: 'Play Flush House.',
    hint: 'Play a full house that is also a flush.',
    group: 'THE DECK',
    on: 'hand', test: (c) => c.handType === 'flushHouse',
  },
  {
    id: 'flushFive', name: 'Flush Five',
    desc: 'Play Flush Five.',
    hint: 'Play the best hand there is.',
    group: 'THE DECK',
    on: 'hand', test: (c) => c.handType === 'flushFive',
  },
  {
    /**
     * SECRET. Absent from the shelf entirely until it is earned — see
     * `secret` above ACHIEVEMENTS and visibleAchievements() below. The hands
     * chart hides SIX OF A KIND the same way, and for the same reason: the
     * patch notes only ever say "added new secret achievement".
     */
    id: 'sixOfAKind', name: 'Understudy No More',
    desc: 'Play Six of a Kind. There are only four suits and thirteen ranks, and you found a sixth anyway.',
    hint: 'A hand that does not exist.',
    group: 'THE DECK', secret: true,
    on: 'hand', test: (c) => c.handType === 'sixOfAKind',
  },
  {
    /**
     * SECRET, and the top of the game: a single hand at INFINITY_CAP. It reads
     * `scored` rather than `damage` because a hand can reach the ceiling and
     * still land nothing (an immune phase, a biome wall) — the trophy is for
     * building the number, not for finding a body to spend it on.
     */
    id: 'infinity', name: 'Divide By Zero',
    desc: 'Score infinite damage in one hand. The number ran out before you did.',
    hint: 'Score a number the game cannot print.',
    group: 'THE DECK', secret: true,
    on: 'hand', test: (c) => Math.max(c.scored ?? 0, c.damage ?? 0) >= INFINITY_CAP,
  },
  {
    id: 'textbook', name: 'Textbook',
    desc: 'Play a Straight Flush.',
    hint: 'Play a hand that is a run and a suit at the same time.',
    group: 'THE DECK',
    on: 'hand', test: (c) => c.handType === 'straightFlush',
  },
  {
    id: 'oneInchPunch', name: 'One Inch Punch',
    desc: `Deal ${n(ONE_INCH_DAMAGE)} damage with a hand of exactly one card.`,
    hint: `Deal ${n(ONE_INCH_DAMAGE)} damage with a single card. One card.`,
    group: 'THE DECK',
    on: 'hand',
    test: (c) => c.cards === 1 && (c.damage ?? 0) >= ONE_INCH_DAMAGE,
  },
  {
    id: 'nothingButEdge', name: 'Nothing But Edge',
    desc: `Cut the run deck down to ${THIN_DECK} cards.`,
    hint: `Grind the deck down to ${THIN_DECK} cards.`,
    group: 'THE DECK',
    on: 'state',
    test: (c) => {
      const d = c.run?.runDeck?.length ?? 0;
      return d > 0 && d <= THIN_DECK;
    },
  },
  {
    id: 'overstuffed', name: 'Overstuffed',
    desc: `Grow the run deck to ${FAT_DECK} cards. Shuffling is your problem now.`,
    hint: `Grow the deck to ${FAT_DECK} cards.`,
    group: 'THE DECK',
    on: 'state', test: (c) => (c.run?.runDeck?.length ?? 0) >= FAT_DECK,
  },

  // ============================ THE COLLECTION =============================
  {
    id: 'fullSlots', name: 'Pack Rat',
    desc: 'Fill every relic slot.',
    hint: 'Leave no relic slot empty.',
    group: 'THE COLLECTION',
    on: 'state',
    test: (c) => (c.run?.artifactSlots ?? 0) > 0 && slotsFilled(c.run) >= c.run.artifactSlots,
  },
  {
    id: 'museumPiece', name: 'Museum Piece',
    desc: `Own ${MUSEUM_MYTHICALS} Mythical relics at the same time.`,
    hint: `Own ${MUSEUM_MYTHICALS} Mythical relics at once.`,
    group: 'THE COLLECTION',
    on: 'state', test: (c) => mythicalsOwned(c.run) >= MUSEUM_MYTHICALS,
  },
  {
    id: 'mirrorMirror', name: 'Mirror, Mirror',
    desc: 'Own The Forgery and The Phantom Cast at once.',
    hint: 'Own both mirrors at the same time.',
    group: 'THE COLLECTION',
    on: 'state',
    test: (c) => {
      const ids = new Set((c.run?.artifacts ?? []).map(a => a?.id));
      return ids.has('counterfeit') && ids.has('phantomCast');
    },
  },
  {
    id: 'fullBelt', name: 'Well Stocked',
    desc: `Hold ${MAX_POTIONS} potions at once.`,
    hint: 'Fill the potion belt.',
    group: 'THE COLLECTION',
    on: 'state', test: (c) => (c.run?.potions?.length ?? 0) >= MAX_POTIONS,
  },
  {
    id: 'allGas', name: 'All Gas, No Brakes',
    desc: 'Fill every relic slot, and let every relic in the row be a multiplier.',
    hint: 'Fill the relic row with multipliers and nothing else.',
    group: 'THE COLLECTION',
    on: 'state',
    test: (c) => {
      const r = c.run;
      if (!(r?.artifactSlots > 0) || slotsFilled(r) < r.artifactSlots) return false;
      const raw = r.artifacts ?? [];
      const rowLen = raw.filter(a => !a?.props?.nook).length;
      if (rowLen === 0) return false;
      // MIRRORS RESOLVE, because the scoring engine resolves them: a Forgery
      // standing beside a Kingmaker really is a multiplier when the hand lands,
      // and a trophy that disagreed with the equation would just look broken.
      // A mirror pointed at nothing (or at something uncopyable) falls out of
      // this walk entirely, which is exactly the dead cell the trophy is asking
      // you not to have.
      let entries;
      try {
        entries = effectiveArtifactSlots(r).filter(e => !raw[e.slot]?.props?.nook);
      } catch { return false; }
      if (entries.length !== rowLen) return false;
      return entries.every(e => isMultiplier(e.art, r));
    },
  },
  {
    id: 'fengShui', name: 'Feng Shui',
    desc: `Reorder the relic row ${FENG_SHUI_REORDERS} times in one run. It was fine the first time.`,
    hint: `Rearrange the relic row ${FENG_SHUI_REORDERS} times in a single run.`,
    group: 'THE COLLECTION',
    on: 'state', test: (c) => (c.run?.counters?.reorders ?? 0) >= FENG_SHUI_REORDERS,
  },

  // ============================= THE GAUNTLET ==============================
  {
    id: 'firstBlood', name: 'First Forging',
    desc: 'Win a fight.',
    hint: 'Win a fight.',
    group: 'THE GAUNTLET',
    on: 'fightWon', test: () => true,
  },
  actClearTrophy(1, 'actOne', 'Into the Woods', 'Clear Act I.'),
  actClearTrophy(2, 'actTwo', 'Colder Still', 'Clear Act II.', 'have'),
  actClearTrophy(3, 'actThree', 'The Long Walk', 'Clear Act III.'),
  actClearTrophy(4, 'actFour', 'The Crucible', 'Clear the act that is not on the map.'),
  {
    id: 'flawless', name: 'Untouched',
    desc: 'Win a fight without losing a single point of HP.',
    hint: 'Win a fight without losing any HP.',
    group: 'THE GAUNTLET',
    on: 'fightWon', test: (c) => c.flawless === true,
  },
  {
    id: 'paperThin', name: 'Paper Thin',
    desc: `Win a fight with ${PAPER_THIN_HP} HP or less left.`,
    hint: `Win a fight with ${PAPER_THIN_HP} HP or less left.`,
    group: 'THE GAUNTLET',
    on: 'fightWon',
    test: (c) => {
      const hp = c.run?.player?.hp;
      return Number.isFinite(hp) && hp > 0 && hp <= PAPER_THIN_HP;
    },
  },
  {
    id: 'immaculate', name: 'Immaculate',
    desc: 'Clear a whole act without an enemy taking a single point of HP off you.',
    hint: 'Clear an entire act without an enemy landing a hit.',
    group: 'THE GAUNTLET',
    on: 'actClear', test: (c) => c.run?.stats?.actScuffed === false,
  },
  {
    id: 'notToday', name: 'Not Today',
    desc: 'Win a fight the Fairy in a Bottle had to bring you back for.',
    hint: 'Come back from a death, then win the fight anyway.',
    group: 'THE GAUNTLET',
    on: 'fightWon', test: (c) => c.revived === true,
  },
  {
    id: 'cleanSheet', name: 'Clean Sheet',
    desc: 'Win a fight without discarding once.',
    hint: 'Win a fight without spending a discard.',
    group: 'THE GAUNTLET',
    on: 'fightWon', test: (c) => c.discards === 0,
  },

  // ============================== THE LADDER ===============================
  difficultyRung('iron', 'ironCleared'),
  difficultyRung('steel', 'steelCleared'),
  difficultyRung('platinum', 'platinumCleared'),
  difficultyRung('diamond', 'diamondCleared'),
  difficultyRung('mythril', 'mythrilCleared'),

  // ============================= THE ODDITIES ==============================
  {
    id: 'spendingHabit', name: 'Spending Habit',
    desc: 'Drink the Potion of Nothing. Nothing happened, as advertised.',
    hint: 'Drink a potion that does nothing.',
    group: 'THE ODDITIES',
    on: 'drink', test: (c) => c.potionId === 'potionOfNothing',
  },
  {
    id: 'goldenSpud', name: 'Root Vegetable',
    desc: 'Turn a Potato into the Golden Spud.',
    hint: 'Keep a potato. Just keep it.',
    group: 'THE ODDITIES',
    on: 'state', test: (c) => foundTheSpud(c.run),
  },
  {
    id: 'hatched', name: 'Something Hatched',
    desc: 'Hatch an Egg.',
    hint: 'Carry an egg long enough.',
    group: 'THE ODDITIES',
    on: 'state', test: (c) => somethingHatched(c.run, c),
  },
  {
    id: 'overkill', name: 'Absolute Overkill',
    desc: `Kill an enemy with a blow worth ${OVERKILL_FACTOR} times its remaining HP.`,
    hint: 'Hit something far, far harder than you needed to.',
    group: 'THE ODDITIES',
    on: 'kill',
    test: (c) => (c.hpBefore ?? 0) > 0 && (c.damage ?? 0) >= (c.hpBefore ?? 0) * OVERKILL_FACTOR,
  },
  {
    id: 'problemGambler', name: 'Problem Gambler',
    desc: `Pull the Slot Button ${GAMBLER_PULLS} times in one run.`,
    hint: `Pull the Slot Button ${GAMBLER_PULLS} times in a single run.`,
    group: 'THE ODDITIES',
    on: 'state',
    test: (c) => {
      const s = slotLedger(c.run);
      return !!s && (s.won ?? 0) + (s.lost ?? 0) >= GAMBLER_PULLS;
    },
  },
  {
    id: 'houseAlwaysWins', name: 'The House Always Wins',
    desc: `Lose the Slot Button flip ${HOUSE_LOSS_STREAK} times in a row.`,
    hint: `Lose the same coin flip ${HOUSE_LOSS_STREAK} times running.`,
    group: 'THE ODDITIES',
    on: 'state',
    test: (c) => (slotLedger(c.run)?.worstStreak ?? 0) >= HOUSE_LOSS_STREAK,
  },
  {
    id: 'ghosted', name: 'Ghosted',
    desc: 'Watch an Ethereal card keep its promise and vanish.',
    hint: 'Lose a card to its own Ethereal habit.',
    group: 'THE ODDITIES',
    on: 'state', test: (c) => c.run?.stats?.ghosted === true,
  },
  {
    id: 'brewmaster', name: 'Brewmaster',
    desc: `Drink ${BREWMASTER_DRINKS} potions in a single fight.`,
    hint: `Drink ${BREWMASTER_DRINKS} potions inside one fight.`,
    group: 'THE ODDITIES',
    on: 'drink', test: (c) => (c.fightDrinks ?? 0) >= BREWMASTER_DRINKS,
  },
  {
    id: 'taxidermy', name: 'Taxidermy',
    desc: `Kill ${TAXIDERMY_KILLS} animals in one run. The Duck was counting.`,
    hint: `Put down ${TAXIDERMY_KILLS} animals in a single run.`,
    group: 'THE ODDITIES',
    on: 'state', test: (c) => killsOfKind(ANIMAL_KIND, c.run) >= TAXIDERMY_KILLS,
  },

  // ============================= THE DOORS =================================
  // Two trophies that open a PACK (JC, 2026-08-04: "I like the idea of more
  // things being unlockable to encourage replayability, especially after the
  // first few rounds, to get you hooked").
  //
  // Both are gates, not grinds: you meet the room, you do the obvious thing in
  // it, and a whole booster joins the table for every run you ever play after.
  // The gate itself lives in core/packs.js (PACK_GATES) and nowhere else — this
  // file only declares the trophies and what they say. A test walks both tables
  // and refuses to let them disagree.
  {
    id: 'forgeSummoner', name: 'Struck From Myth',
    desc: 'Reach into THE CRIMSON FORGE and pull a MYTHICAL relic out of it. The FORGE PACK now appears at the pack table.',
    hint: 'Find the red mark on the map, and take what the fire offers.',
    group: 'THE DOORS',
    on: 'visit',
    test: (c) => c.eventId === 'crimsonForge' && !!c.mythical,
  },
  {
    id: 'casinoPatron', name: 'House Rules',
    desc: 'Find THE TRAVELING CASINO. THE DEALER now appears at the pack table.',
    hint: 'A painted wagon folds open somewhere out there. Go and find it.',
    group: 'THE DOORS',
    on: 'visit',
    test: (c) => c.eventId === 'travelingCasino',
  },

  // ============================ THE CHAMPIONS ==============================
  // Twenty trophies, four per hero, and every one of them dresses that hero
  // (core/skins.js). The other thirty skins come off the difficulty ladder,
  // which is already per hero and needed no trophy of its own.
  bossTrophy('bullFairyKing', 'Knight of the Grove', 'bulwark', 1,
    'fairyKing', 'THE FAIRY KING', 'Forest Knight Bull'),
  bossTrophy('bullDepthKnight', 'Wall of the Deep', 'bulwark', 3,
    'depthKnight', 'THE DEPTH KNIGHT', 'Depth Knight Bull'),
  champion('bullImmovable', 'Immovable Object',
    `Gain ${n(BULL_SHIELD)} shield from a single hand as The Bull. Storm Knight Bull is yours.`,
    `Take ${n(BULL_SHIELD)} shield off one hand, as The Bull.`,
    (c) => c.run?.chrId === 'bulwark' && (c.run?.stats?.maxHandShield ?? 0) >= BULL_SHIELD),
  crucibleRun('bullCrucible', 'bulwark', 'The Wall Holds', 'Starlit Knight Bull'),

  bossTrophy('ophWolfowl', 'House Call in the Woods', 'venomancer', 1,
    'wolfowl', 'WOLFOWL', 'Grovekeeper Ophelia'),
  bossTrophy('ophKeeper', 'Second Opinion', 'venomancer', 3,
    'theKeeper', 'THE KEEPER', 'Abyssal Ophelia'),
  champion('ophVenom', 'Doctor of Poison',
    `Stack ${n(OPHELIA_POISON)} POISON on one body as Ophelia. Blightbloom Ophelia is yours.`,
    `Get ${n(OPHELIA_POISON)} poison onto a single enemy, as Ophelia.`,
    (c) => c.run?.chrId === 'venomancer' && (c.run?.stats?.maxPoisonStack ?? 0) >= OPHELIA_POISON),
  crucibleRun('ophCrucible', 'venomancer', 'Terminal Diagnosis', 'Astral Ophelia'),

  bossTrophy('dexSabreRabbit', 'Rabbit Season', 'highRoller', 1,
    // The roster prints no article (acts.js, enemies.js). Neither does this.
    'sabreRabbit', 'SABRE-TOOTHED RABBIT', 'Owlcloak Dextra'),
  bossTrophy('dexDaughters', 'Sisters Undone', 'highRoller', 3,
    'daughters', 'THE DAUGHTERS OF DARKNESS', 'Wraithsilk Dextra'),
  champion('dexOneCard', "The Shortblade's Point",
    `Deal ${n(DEXTRA_ONE_CARD)} damage with a one-card hand as Dextra. Nightshade Dextra is yours.`,
    `Deal ${n(DEXTRA_ONE_CARD)} with a single card, as Dextra.`,
    (c) => c.run?.chrId === 'highRoller' && c.cards === 1 && (c.damage ?? 0) >= DEXTRA_ONE_CARD,
    'hand'),
  crucibleRun('dexCrucible', 'highRoller', 'The Last Deal', 'Cardsharp Dextra'),

  bossTrophy('zelPhoenix', 'Cold Comfort', 'zealot', 2,
    'winterPhoenix', 'THE WINTER PHOENIX', 'Glacier Zelus'),
  bossTrophy('zelSummoner', 'Unsummoned', 'zealot', 2,
    'frostSummoner', 'THE FROSTBITTEN SUMMONER', 'Wraithlight Zelus'),
  champion('zelZeal', 'Battery Full',
    // ZEAL_CAP stopped being a cap on 2026-08-04 (the battery banks forever,
    // for everyone), so the trophy's 40 is a THRESHOLD now and the copy says
    // "bank", never "fill": there is no full any more.
    `Bank ${ZEAL_CAP} ZEAL at once as Zelus. Infernal Zelus is yours.`,
    `Overheal as Zelus until the ZEAL battery reads ${ZEAL_CAP}.`,
    (c) => c.run?.chrId === 'zealot' && (c.run?.player?.zeal ?? 0) >= ZEAL_CAP),
  crucibleRun('zelCrucible', 'zealot', 'Judgement', 'Seraph Zelus'),

  bossTrophy('hoardPolarGuardian', 'Taxed the Guardian', 'hoarder', 2,
    'polarGuardian', 'THE POLAR GUARDIAN', 'Frostbound Drusky'),
  champion('hoardTycoon', 'Old Money',
    `Hold ${n(DRUSKY_CHIPS)} chips at once as Drusky. Tycoon Drusky is yours.`,
    `Hold ${n(DRUSKY_CHIPS)} chips at once, as Drusky.`,
    (c) => c.run?.chrId === 'hoarder' && (c.run?.chips ?? 0) >= DRUSKY_CHIPS),
  champion('hoardBigSwing', 'Paid In Full',
    `Deal ${n(DRUSKY_SWING)} damage in one hand as Drusky. Molten Drusky is yours.`,
    `Turn the pile into ${n(DRUSKY_SWING)} damage on one hand, as Drusky.`,
    (c) => c.run?.chrId === 'hoarder' && (c.damage ?? 0) >= DRUSKY_SWING,
    'hand'),
  crucibleRun('hoardCrucible', 'hoarder', 'Rich Beyond Death', 'Gilded Seraph Drusky'),
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

/** Every id in shelf order — the overlay walks this, locked tiles included. */
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map(a => a.id);

/**
 * THE SHELF, PRE-CHEWED. One entry per section heading, in file order, and
 * inside it the RUNS: a run is either a single achievement or a whole tiered
 * ladder (consecutive entries sharing a `tier`). The overlay draws a run of
 * length 1 as a normal tile and a longer one as a progression row, so growing a
 * ladder by a rung needs no UI change at all.
 * @returns {{name: string, runs: {tier: ?string, defs: object[]}[]}[]}
 */
export function achievementSections() {
  const out = [];
  // THE VISIBLE list, not the whole one: a secret trophy has no row until it is
  // earned. Filtering HERE rather than in the overlay means the section heads,
  // the per-section counts, the ladder runs and the grid reflow all follow from
  // one decision — the same shape rewards.handChartOverlay uses to make an
  // undiscovered secret HAND leave no gap behind it.
  for (const def of visibleAchievements()) {
    const name = def.group ?? 'ACHIEVEMENTS';
    let section = out[out.length - 1];
    if (!section || section.name !== name) { section = { name, runs: [] }; out.push(section); }
    const last = section.runs[section.runs.length - 1];
    if (def.tier && last?.tier === def.tier) last.defs.push(def);
    else section.runs.push({ tier: def.tier ?? null, defs: [def] });
  }
  return out;
}

/**
 * The RELIC this trophy pays out, or null. Locked tiles must NOT name it (that
 * is the tease); unlocked ones must, because a reward nobody can see is not a
 * reward. See ACHIEVEMENT_WAVE §3 and eligibleFor() in artifacts.js.
 */
export function achievementReward(id) {
  const relicId = RELIC_GATE_BY_ACHIEVEMENT[id];
  return relicId ? (artifactById(relicId) ?? null) : null;
}

/** Does this trophy gate a relic at all? Cheap enough for a render loop. */
export function gatesARelic(id) {
  return !!RELIC_GATE_BY_ACHIEVEMENT[id];
}

/**
 * The HERO this trophy opens, or null. Same contract as achievementReward: a
 * locked tile teases, an unlocked one names what it bought. Derived from the
 * character table's `unlock` field so the two can never disagree.
 */
export function achievementHero(id) {
  return Object.values(CHARACTERS).find(c => c.unlock === id) ?? null;
}

export { isAchievementUnlocked };

/**
 * THE SHELF'S OWN LIST — every trophy a player is allowed to know exists.
 *
 * A `secret` one is absent until it is earned, at which point it is an ordinary
 * tile forever. Everything that DISPLAYS achievements reads this; everything
 * that FIRES them (noteEvent) reads ACHIEVEMENTS, because a hidden trophy still
 * has to be winnable. That split is the whole mechanism.
 */
export function visibleAchievements() {
  return ACHIEVEMENTS.filter(a => !a.secret || isAchievementUnlocked(a.id));
}

/** Is this trophy hidden from the shelf right now? */
export function isAchievementHidden(id) {
  const a = ACHIEVEMENTS.find(x => x.id === id);
  return !!a?.secret && !isAchievementUnlocked(a.id);
}

/**
 * How full the case is: { unlocked, total }.
 *
 * `total` counts the VISIBLE shelf, so an unearned secret does not sit in the
 * denominator advertising itself as a gap — "48 of 62" with two tiles nobody
 * can find is the tease the hidden treatment exists to avoid. Earning one moves
 * both numbers at once, which reads as the case growing rather than as a hole
 * being filled.
 */
export function achievementTally() {
  const visible = visibleAchievements();
  return {
    unlocked: visible.filter(a => isAchievementUnlocked(a.id)).length,
    total: visible.length,
  };
}

/**
 * THE FIRE PATH. Hand it an event and its context; it answers with the DEFS
 * that were just earned (empty array almost every time), which is exactly what
 * the toast needs. Never throws: a predicate that trips over a half-built run
 * simply does not fire, because an achievement is never worth a black screen.
 *
 * @param {string} event
 * @param {object} ctx  `run` defaults to the live run
 * @returns {object[]} newly unlocked achievement defs, in shelf order
 */
export function noteEvent(event, ctx = {}) {
  const c = { ...ctx, run: ctx.run ?? liveRun };
  // SEEDED RUNS EARN NO TROPHIES (JC, 2026-08-04). A seed can be replayed
  // until the dice oblige, and a record of what you DID cannot be a record of
  // what you rerolled. One gate, here, covers every trophy path in the game —
  // and through the trophies, everything they open (skins, relics, packs,
  // worlds, heroes). The difficulty ladder has its own twin gate at the
  // recordActClear call.
  if (c.run?.seed) return [];
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (a.on !== event && a.on !== 'state') continue;
    if (isAchievementUnlocked(a.id)) continue;
    let hit = false;
    try { hit = !!a.test(c); } catch { hit = false; }
    if (hit && unlockAchievement(a.id)) earned.push(a);
  }
  return earned;
}
