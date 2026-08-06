/**
 * ARTIFACTS v2 — the joker layer. Six rarity tiers, ~105 relics, 5 slots
 * (Mythicals can raise it). Sources: shops (no Mythicals), elite kills
 * (Mythicals almost never), Forge packs and the red map event (Mythical home).
 *
 * Each artifact may carry:
 *   mods    — declarative scoring mods, merged by run.collectMods()
 *             { suitValue, suitMult, modValue, handMult, handFactor, globalMultFactor,
 *               gemDamageFactor, faceValue, faceMult, modCardFactor,
 *               retriggerTop, handRepeat, valueFactor, shieldByMult, healByMult,
 *               heartDamageOff, cloverDamageOff }
 *   hero    — the relic's OWNER (charId). Every roll path filters on it; see
 *             eligibleFor(). Used by the four HERO EXCLUSIVES and, since the
 *             2026-08-01 triage, by the three Ophelia-only poison relics — a
 *             hero-gated relic need not be of the heroExclusive RARITY.
 *   props   — flat scene-read properties, summed via getProp()
 *             Two of them are STRUCTURAL rather than scored:
 *               noSlot — the relic costs no artifact slot (see run.slotsUsed)
 *               nook   — the relic is not part of the six-cell ROW at all: it
 *                        lives in its own GLOVE NOOK (the pouch stitched to the
 *                        side of the combat mat / hung under the map belt), and
 *                        mirrors step straight past it as if it weren't there.
 *   hooks   — coded effects: fightStart(scene,a) · handCommit(scene,a,ctx) ·
 *             afterHand(scene,a,ctx) · kill(scene,a,enemy) · fightEnd(scene,a)
 *             — scene = CombatScene. handCommit fires the instant a hand is
 *             committed (hand counted, type known, before the score cadence).
 *   liveDesc(a, run) — THE RUNNING TOTAL (JC, 2026-08-01). Any relic that BANKS
 *             something (a scaler's mult, a suit's growing value, a counter it
 *             reads) returns one short line here — "Currently: +12 mult (12
 *             Kings)" — and every tooltip surface in the game appends it under
 *             the rules text: the combat panel, the map belt, the merchant's
 *             owned-relic shelf, the replace-a-relic picker. Returning null (or
 *             not defining it) prints nothing. See artifactLiveLine().
 *   active  — AN ACTIVE-USE RELIC: { label, hint, use(scene, a) }. The combat
 *             artifact panel hangs a USE tag under it; one press per FIGHT
 *             (CombatScene.activeUsed, cleared in newFightState), blocked while
 *             the scene is busy, and spent relics dim behind a ✓. `use` returns
 *             false to REFUSE (nothing legal to do) — a refusal costs no charge.
 *             Actives are uncopyable by definition: a mirror has no button.
 *   onAcquire(run) — immediate effect on pickup (deck edits, stat grants)
 *   acquireUI — 'suitPrism' etc: the acquiring scene runs a picker first
 *   uncopyable — the mirror relics (The Forgery / The Phantom Cast) resolve
 *             THROUGH their neighbour and re-read its mods/props/hooks. A relic
 *             whose whole effect fired once at pickup (onAcquire deck edits,
 *             stat grants, the Prism's picker) has nothing left to re-read, so
 *             a mirror pointed at it would silently do nothing. Flagging it
 *             makes that honest: effectiveArtifacts drops the copy and the UI
 *             stamps a ⊘ on the mirror. See the audit in run.js.
 *
 * Owned instances are CLONES with their own `state` bag (per-run counters).
 */

import { gainGold, killsOfKind, run, SELL_FRACTION, NEGOTIATED_SELL_FRACTION } from './run.js';
// Leaf modules with no imports of their own (config.js and deck.js both sit at
// the bottom of the graph), so neither of these edges can close a cycle.
import { HOARD_CHIP_STEP, SUIT_GLYPH } from '../config.js';
import { SUITS, rankLabel } from './deck.js';
// scoring.js is a leaf too (deck.js + poker.js and nothing else), so quoting its
// constants here cannot close a cycle — and it means the two hero exclusives'
// rules text is generated from the arithmetic that actually runs.
import { STAMPS, WRAP_MULT_FACTOR, cardStamp, cardWrap } from './scoring.js';
// The ACHIEVEMENT GATE reads the trophy case and nothing else. progress.js is a
// leaf as far as this file is concerned (it imports poker, config and difficulty
// only), so this edge cannot close a cycle back through artifacts.
import { isAchievementUnlocked } from './progress.js';

export const ARTIFACT_RARITY = {
  common:    { label: 'COMMON',    color: 0xdadada, shopWeight: 40, eliteWeight: 44 },
  rare:      { label: 'RARE',      color: 0x4aa8ff, shopWeight: 34, eliteWeight: 34 },
  veryRare:  { label: 'VERY RARE', color: 0xa855f7, shopWeight: 18, eliteWeight: 16 },
  legendary: { label: 'LEGENDARY', color: 0xff8c28, shopWeight: 8,  eliteWeight: 5.4 },
  // HERO EXCLUSIVE sits BETWEEN legendary and mythical: rarer than a Legendary,
  // commoner than a myth, and only ever offered to the one hero it belongs to.
  // Its label renders as a CYCLING RAINBOW wherever text can animate (see
  // rainbowText in ui/juice.js); `color` is the static magenta-violet fallback
  // that tints rings, frames and one-shot pops.
  heroExclusive: {
    label: 'HERO EXCLUSIVE', color: 0xff5ce1, rainbow: true, shopWeight: 4, eliteWeight: 2,
  },
  mythical:  { label: 'MYTHICAL',  color: 0xe03040, shopWeight: 0,  eliteWeight: 0.6 },
};

const RARITY_ORDER = ['common', 'rare', 'veryRare', 'legendary', 'heroExclusive', 'mythical'];

/**
 * ACT-SCALED RARITY (JC, 2026-08-02: "Act 1 has 60% less chance across the
 * board for very rare and above").
 *
 * Every WEIGHTED rarity roll multiplies the weight of the four top tiers by the
 * act's factor. Common and Rare weights are untouched, so their share of the
 * roll rises on its own — the curve tilts, nothing is banned, and a lucky Act I
 * Legendary is still a story you can tell.
 *
 * NOT scaled, because they ADVERTISE a floor and a promise is a promise:
 * rollLegendaryPlus (the Hunter's Cache), rollMythical (the Crimson Forge, the
 * Mythic Ember, the bounty wheel) and the elite drop's rarityBoost, which is
 * applied AFTER the roll. Potion rarity is deliberately left alone.
 */
export const ACT_RARITY_FACTOR = [0.40, 0.60, 0.75, 1.00];
const ACT_SCALED_TIERS = new Set(['veryRare', 'legendary', 'heroExclusive', 'mythical']);

/**
 * The factor for an act index. `null`/undefined reads the LIVE run, which is
 * what every in-game call path wants; pass one explicitly to test a curve or to
 * roll for an act you are not standing in.
 */
export function actRarityFactor(actIndex = null) {
  const i = actIndex ?? run.actIndex ?? 0;
  const clamped = Math.max(0, Math.min(ACT_RARITY_FACTOR.length - 1, Math.floor(i)));
  return ACT_RARITY_FACTOR[clamped];
}

/** A tier's roll weight for a given act. `key` is 'shopWeight' or 'eliteWeight'. */
export function rarityWeight(rarity, key, actIndex = null) {
  const w = ARTIFACT_RARITY[rarity]?.[key] ?? 0;
  return ACT_SCALED_TIERS.has(rarity) ? w * actRarityFactor(actIndex) : w;
}

/**
 * Share of every MYTHIC roll (Forge Ember, the Crimson Forge, the bounty
 * wheel's MYTHIC wedge, the shop's 1/100 sneak) that instead hands over the
 * current hero's exclusive. Only paid out when the hero HAS an unowned one.
 */
export const HERO_FORGE_SHARE = 0.25;

/**
 * MIDAS GAUNTLET (JC, 2026-08-04): the odds a played DIAMOND turns SHINY.
 * One number, read by the desc, the hook and the tests alike.
 */
export const MIDAS_SHINY_CHANCE = 1 / 20;

/**
 * THE ACHIEVEMENT GATE (JC, 2026-08-02). Five top-tier relics are no longer
 * base stock: they are the REWARD for a named trophy, relic id -> achievement
 * id. Twenty-six of the other top-tier relics are untouched, so the ceiling of
 * a first run is exactly what it always was; these five are what a shelf full
 * of trophies buys you.
 *
 * OWNING one is never gated, only being OFFERED one. The gate lives in
 * eligibleFor and nowhere else, which is the whole design: it is consulted by
 * every roll path, so nothing that hands out a relic can forget it, and nothing
 * that reads run.artifacts is affected. A save written before this existed
 * keeps its Forge Hammer, and an in-flight run never has a relic taken away.
 */
export const GATED_RELICS = {
  forgeHammer: 'bigHand',           // Heavy Swing (10,000 in one hand)
  singularity: 'runawayMath',       // Runaway Math (x100 mult)
  perpetualEngine: 'fullRepertoire',// Full Repertoire (all 9 base hands)
  sixthFinger: 'museumPiece',       // Museum Piece (2 mythicals at once)
  wheelDivinity: 'ironCleared',     // Iron Forged (Act III on IRON)
};

/** The same table read the other way: achievement id -> the relic it opens. */
export const RELIC_GATE_BY_ACHIEVEMENT = Object.fromEntries(
  Object.entries(GATED_RELICS).map(([relicId, achId]) => [achId, relicId]));

/**
 * Can `heroId` be offered this relic? Two gates, and every roll path funnels
 * through here so neither can be forgotten:
 *
 *   HERO      hero-exclusive defs carry `hero`, so a Zealot is never shown
 *             Dextra's dagger. A null heroId (a pure unit test, a UI listing)
 *             sees no exclusives at all, the safe direction to fail in.
 *   TROPHY    the five GATED_RELICS above stay out of every pool until their
 *             achievement is earned. Reads progress, which is exactly why
 *             UNLOCK ALL cannot hand them over: it grants no achievements.
 *
 * THE ORACLE'S CULTURED opens the FIRST gate and only the first: another hero's
 * exclusive becomes rollable everywhere at once — the shop, the elite shelf, the
 * Curator's case, the Hunter's cache, an egg, the Crimson Forge — because all
 * eight roll paths already funnel through this one function. The trophy gate is
 * untouched: an achievement you have not earned is not a matter of taste.
 * `r` defaults to the live run, so every existing two-argument call site is
 * unchanged and a hand-built test run is read straight.
 */
export function eligibleFor(def, heroId, r = run) {
  if (!def) return false;
  // `heroBound` OUTRANKS CULTURED. Most hero-exclusives are exclusive by
  // FLAVOUR — their maths is hero-agnostic and works perfectly in anyone's
  // hands, which is exactly what THE ORACLE'S CULTURED is for. A few are
  // exclusive by MACHINERY: their whole effect is read inside a code path
  // gated on their owner's id, so for anybody else they are a no-op you paid
  // 260 chips for, or (the Infinite Heart) a price with no gift attached.
  // Those carry `heroBound` and stay behind the wall whatever the Oracle says.
  if (def.hero && def.hero !== heroId && (def.heroBound || !(r?.oracleMods?.culturedRelics))) return false;
  const trophy = GATED_RELICS[def.id];
  if (trophy && !isAchievementUnlocked(trophy)) return false;
  return true;
}

export const BASE_ARTIFACT_SLOTS = 5;

/**
 * One unowned, eligible relic of exactly `rarity`, or null when that tier is
 * dry. The primitive rollHatchTier has always had inline and the Bounty Hunter's
 * common-relic roller has had a private copy of; the ORACLE'S SIMPLE wants the
 * same thing again, so it is a function now instead of a third copy.
 */
export function rollOfRarity(rarity, ownedIds = [], rng = Math.random, heroId = null) {
  const pool = ARTIFACT_POOL.filter(a =>
    a.rarity === rarity && !ownedIds.includes(a.id) && eligibleFor(a, heroId));
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}

/**
 * THE POISON BENCH (JC, 2026-08-01 triage).
 *
 * Before the overhaul, three relics existed to make the hero's KEYED STATUS
 * bigger: Cruel Sting (+1 stack), the Grimoire of Suits (own-suit cards apply a
 * stack each) and the Stormcaller's Idol (statuses splash at 50%). Clubs no
 * longer apply a status to anyone, and the only status a hand still produces is
 * Ophelia's poison — which is a fraction of DAMAGE DEALT and therefore already
 * scales with the whole mult curve. A flat "+1 stack" next to that is noise.
 *
 * All three were kept (same ids, same art) and rewritten as OPHELIA-ONLY
 * relics that SCALE with her conversion instead of adding to it:
 *   cruelSting  common -> RARE   +25% conversion       (props.poisonConvert)
 *   grimoire    veryRare         poison ticks twice    (props.poisonDoubleTick)
 *   stormIdol   veryRare         poison spreads whole  (props.poisonSpread)
 * They are gated by `hero: 'venomancer'`, so every roll path (shop, elite,
 * cache, forge) filters them out for the other three heroes — the same
 * eligibleFor() gate the Hero Exclusives use.
 *
 * NOT gated, deliberately: the Plague Banner and the Plaguebearer's Urn move
 * poison that is ALREADY on a body, and any hero can put it there with a Venom
 * Flask or an event, so they stay in the global pool for everyone.
 *
 * Retired mods/props, which must never come back: `statusBonus`,
 * `ownSuitStatus`, `statusSplash`, `statusByMult`, `chipFactor`.
 */

/** The matched-rank family, secrets included (see scoring.js OF_A_KIND_TYPES). */
const OF_A_KIND_HANDS = ['pair', 'twoPair', 'trips', 'fullHouse', 'quads', 'fiveOfAKind', 'flushFive'];

/**
 * THE FLUSH FAMILY — any hand whose TYPE NAME contains "flush", case-folded:
 * flush · straightFlush · flushFive. Derived rather than listed so a future
 * secret flush hand joins The Rising Tide's count the day it is added.
 */
export const isFlushHand = (type) => String(type ?? '').toLowerCase().includes('flush');

/**
 * THE WOLF SET (Wolfsbane Charm). Enemy def ids the charm counts as wolves.
 * Today the bestiary holds three — wolfCub, alphaWolf and the act-I boss
 * WOLFOWL; `elderWolfowl` is listed against the day a bigger one is drawn, and
 * costs nothing until then. The Knight Hawk is a BIRD and is deliberately out.
 */
export const WOLF_IDS = ['wolfCub', 'alphaWolf', 'wolfowl', 'elderWolfowl', 'packWolf'];

/** How many wolves this run has put down (run.stats.kills, by enemy def id). */
export function wolvesSlain(run) {
  const kills = run?.stats?.kills ?? {};
  return WOLF_IDS.reduce((s, id) => s + (kills[id] ?? 0), 0);
}

/**
 * Mult the Wolfsbane Charm pays per wolf carcass. 5 -> 1 (JC, 0803): a rare
 * that paid +5 a body was out-scaling the Kingmaker, a Legendary, by fight four.
 */
export const WOLFSBANE_MULT_PER_WOLF = 1;

/**
 * THE ACE'S LEGACY, per HAND ACTIVATION. Not per Ace: one hand with four Aces
 * in it pays this once, and a REPEAT of that hand pays it again.
 */
export const ACES_LEGACY_MULT = 3;

/**
 * THE CHAOS ORB's curve. floor(16 · r^1.6), capped at 15, so the roll lives in
 * 0-15 inclusive and leans LOW: the exponent bends the uniform roll down, which
 * makes ~40% of spins land at 0-3 and only ~6% at 13-15. Mean ≈ 5.6.
 * Exported so the tests can prove the bounds without owning the constant.
 */
export const CHAOS_ORB_MAX = 15;
export function chaosMultRoll(rng = Math.random) {
  return Math.min(CHAOS_ORB_MAX, Math.floor((CHAOS_ORB_MAX + 1) * Math.pow(rng(), 1.6)));
}

/** One tidy number for a tooltip: 3 -> '3', 3.4 -> '3.4', 3.00 -> '3'. */
const num = n => (Math.round(n * 100) / 100).toString();

/**
 * Bank `n` onto an owned instance's counter. A no-op when there is no instance
 * (a unit test poking a raw definition's hook, the art listing walking the
 * pool) — a relic's LEDGER is a property of the copy you own, never of the
 * definition, so a def with no `state` simply has nothing to count.
 */
const bank = (a, key, n = 1) => { if (a?.state) a.state[key] = (a.state[key] ?? 0) + n; };

/**
 * HOW MANY TIMES THE HAND HAPPENED (JC, 0803: "can't tell that it's working
 * properly when hands repeat, which is a big deal").
 *
 * `afterHand` fires exactly ONCE per played hand, whatever the hand did — that
 * is a property of resolveHand and it is the right shape, because a hook that
 * fired N times would also spend N charges and burn N cards. But a hand under a
 * Repeating Pocketwatch (or the Sharpest Dagger, or the Wheel's retrigger
 * wedge) genuinely HAPPENED more than once, and every relic that BANKS off the
 * hand's contents owes you that many banks. Before this existed they all banked
 * once, silently, which is exactly the bug JC could feel and not name.
 *
 * `res.handRepeat` is the authority (scoring.js resolves it from the ADDITIVE
 * mods.handRepeatAdd channel — 0803-B §1.2 — so a mirrored Pocketwatch is three
 * plays and a Pocketwatch beside the Dagger is six). The scene may also pass
 * ctx.activations explicitly; it wins when present.
 *
 * NOT included, deliberately: the Forge Hammer's valueFactor (it makes the hand
 * WORTH more, it does not make it HAPPEN again), the strike relics, Twin Fates'
 * echo and the Perpetual Engine — all four re-deliver DAMAGE only.
 */
export function handActivations(ctx) {
  const n = ctx?.activations ?? ctx?.res?.handRepeat ?? 1;
  return Math.max(1, Math.round(Number(n) || 1));
}

/**
 * HOW MANY TIMES ONE CARD SCORED (2026-08-04). An ECHO SEAL or an Ouroboros
 * retrigger makes the card happen again, and JC's ruling is that the second
 * happening is a real one: "Alchemist's Still and similar artifacts should
 * activate when a card is repeated too."
 *
 * `liveTimes` is what scoring.js counted — activations that actually PAID, so a
 * BLACK spin on activation two is not a second King. Older results (a save, a
 * hand-built test) carry neither field and answer 1, which is what they meant.
 *
 * The HAND's own repeats are NOT in here: every caller multiplies by
 * handActivations(ctx) separately, and doing it in both places would square it.
 */
export function cardScoreTimes(b) {
  const n = b?.liveTimes ?? b?.times ?? 1;
  return Math.max(1, Math.round(Number(n) || 1));
}

/**
 * How many times a card of the given rank actually scored in `res`. A BLACK
 * roulette card scored nothing at all, so it crowns nothing either.
 */
export function countScoringRank(res, rank) {
  return (res?.breakdown ?? [])
    .filter(b => b.scoring && !b.dead && b.rank === rank)
    .reduce((s, b) => s + cardScoreTimes(b), 0);
}

/** Same rule, by EFFECTIVE suit (a wild scores as the hero's suit and counts as it). */
export function countScoringSuit(res, suit) {
  return (res?.breakdown ?? [])
    .filter(b => b.scoring && !b.dead && b.suit === suit)
    .reduce((s, b) => s + cardScoreTimes(b), 0);
}

/**
 * THE SUIT-GRINDER FAMILY (Grindstone · Beating Heart · Uncut Diamond · Wild
 * Growth). One shape, four suits: every scoring card of the suit permanently
 * adds +1 to what THAT SUIT is worth, banked on the instance so a re-forged
 * copy keeps the growth it was struck from.
 */
function suitGrinder({ id, name, suit, icon, tint, glyph, price = 125, rarity = 'rare' }) {
  return {
    id, name, rarity, price, icon, tint,
    desc: `Every ${glyph} card that scores grinds the edge sharper: ${glyph} cards gain +1 value, permanently.`,
    mods(a) { return { suitValue: { [suit]: a.state.ground ?? 0 } }; },
    hooks: {
      afterHand(scene, a, ctx) {
        const n = countScoringSuit(ctx.res, suit);
        if (n > 0) bank(a, 'ground', n * handActivations(ctx));
      },
    },
    liveDesc(a) {
      const g = a.state.ground ?? 0;
      return `Currently: +${g} ${glyph} value  (${g} ${glyph} scored)`;
    },
  };
}

// ===========================================================================
// NIGHT 0802 — the shared machinery behind the twenty-one new relics.
// Every number the new relics quote lives here so a tooltip, a test and the
// verification run all read the SAME constant. Nothing below is hand-typed
// twice.
// ===========================================================================

/**
 * THE DUCK OF DOOM counts ANIMALS. 'beast' is the bestiary's own word for one
 * (enemies.js `death`: wolves, boars, hawks, yetis, mammoths, crows, the
 * Sabre-Toothed Rabbit), sitting beside 'humanoid', 'creature', 'large' and
 * 'keeper'. The count is read off run.stats.killsByKind rather than off a
 * hand-written id list for two reasons: a new boar joins the tally the day it
 * is drawn, and artifacts.js never has to import the bestiary — that edge would
 * close a cycle through acts.js at module-evaluation time and take ACTS with it.
 *
 * THE CURRENCY IS VALUE, NOT MULT (JC, 2026-08-02). It shipped as +1 mult per
 * animal and that was the wrong side of the equation: a 25-animal duck WAS the
 * mult curve rather than something riding it, which is legendary work on a Rare
 * price tag. As flat VALUE it lands before the mult, so the same 25 carcasses
 * are worth whatever your build multiplies them by. Solid rare, not a scaler.
 */
export const ANIMAL_KIND = 'beast';
export const DUCK_VALUE_PER_ANIMAL = 1;
export function animalsSlain(r) { return killsOfKind(ANIMAL_KIND, r ?? run); }

/**
 * HOW MANY PAIRS A HAND CONTAINED — scoring ranks that turned up two or more
 * times. Two Pair is 2, a full house is 2, trips and quads are 1 each. Same
 * rules as countScoringRank: kickers formed nothing and a BLACK roulette card
 * scored nothing, so neither counts.
 */
export function countScoringPairs(res) {
  const counts = {};
  for (const b of res?.breakdown ?? []) {
    if (b.scoring && !b.dead) counts[b.rank] = (counts[b.rank] ?? 0) + 1;
  }
  return Object.values(counts).filter(n => n >= 2).length;
}

/**
 * THE EGGS. Both hatch on the same clock. They are a LADDER now (JC, 2026-08-02):
 * each egg's table is "the tier you paid for, three times in four, and the tier
 * above it the other time", one rung apart.
 *
 * A hatch table is `{ rarity: share }` and its shares must sum to 1. The tables
 * are the single source of truth: the relic descriptions, the shop copy and the
 * distribution test all read these numbers rather than restating them.
 */
export const EGG_HATCH_FIGHTS = 5;
/** The Egg (COMMON): three quarters Very Rare, one quarter Legendary. */
export const EGG_HATCH_TABLE = { veryRare: 0.75, legendary: 0.25 };
/** The Rare Egg (RARE): three quarters Legendary, one quarter Mythical. */
export const RARE_EGG_HATCH_TABLE = { legendary: 0.75, mythical: 0.25 };
/** Legacy alias — the Rare Egg's myth share, still the number the copy quotes. */
export const RARE_EGG_MYTHIC_CHANCE = RARE_EGG_HATCH_TABLE.mythical;

/**
 * "One in four" spelled from the share itself, so neither egg's description can
 * drift away from the table it is describing.
 */
const ONE_IN_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export function oneIn(share) {
  const n = Math.round(1 / share);
  return `One in ${ONE_IN_WORDS[n] ?? n}`;
}

/**
 * An egg came due. It is NOT allowed to mutate the row here: `fightEnd` fires
 * in the middle of the victory beat, and swapping a relic out from under the
 * artifact panel mid-cascade is how you get a ceremony pointed at a dead
 * sprite. So it QUEUES, exactly the way the MERCHANT bounty books a shop visit
 * for the next map, and the post-fight reward flow presents the hatch properly.
 * Plain data only — this rides the save file.
 */
export function queueHatch(r, a, table = EGG_HATCH_TABLE) {
  if (!r) return null;
  r.pendingHatch ??= [];
  const entry = { id: a.id, index: r.artifacts.indexOf(a), table: { ...normalizeHatchTable(table) } };
  // Saves written before the ladder carried a bare `mythicChance` number. Keep
  // writing it so a NEWER save can still be read by an older build, and so the
  // field keeps meaning exactly what it always meant.
  entry.mythicChance = entry.table.mythical ?? 0;
  r.pendingHatch.push(entry);
  return entry;
}

/**
 * Accepts either a hatch TABLE or the legacy bare `mythicChance` number (which
 * meant "mythical this often, otherwise legendary"), and always returns a table.
 * Old queued entries ride the save file, so this is the compatibility seam.
 */
function normalizeHatchTable(table) {
  if (typeof table === 'number') {
    return table > 0 ? { mythical: table, legendary: 1 - table } : { legendary: 1 };
  }
  return (table && Object.keys(table).length) ? table : EGG_HATCH_TABLE;
}

/** One tier's worth of unowned, eligible relics. Null when the tier is dry. */
function rollHatchTier(r, tier, owned, rng) {
  if (tier === 'mythical') return rollMythical(owned, rng, r.chrId);
  // ...through eligibleFor like every other roll (2026-08-02): the Perpetual
  // Engine is a LEGENDARY behind an achievement, and this branch used to have no
  // gate of any kind, so an egg was the one thing that could hatch it early.
  return rollOfRarity(tier, owned, rng, r.chrId);
}

/**
 * What an egg becomes: one roll on its hatch table, then an unowned, eligible
 * relic of the tier that came up. If that tier is exhausted it walks the rest of
 * the table and finally falls through to the cache roller, because an egg that
 * hatches nothing is not a joke, it is a bug.
 */
export function rollHatchDef(r, table = EGG_HATCH_TABLE, rng = Math.random) {
  const owned = (r.artifacts ?? []).map(x => x.id);
  const t = normalizeHatchTable(table);
  // Rarest first, so the roll reads the same way the tooltip does.
  const tiers = Object.keys(t).sort((a, b) => RARITY_ORDER.indexOf(b) - RARITY_ORDER.indexOf(a));
  const roll = rng();
  let acc = 0;
  let picked = tiers[tiers.length - 1];
  for (const tier of tiers) {
    acc += t[tier] ?? 0;
    if (roll < acc) { picked = tier; break; }
  }
  // The chosen tier first, then every other tier on the table as a backstop.
  for (const tier of [picked, ...tiers.filter(x => x !== picked)]) {
    const def = rollHatchTier(r, tier, owned, rng);
    if (def) return def;
  }
  return rollLegendaryPlus(owned, rng, r.chrId);
}

/**
 * Hatch IN PLACE. Relic order decides the mult chain (cards score first, then
 * relics resolve LEFT TO RIGHT), so where the egg stood is not decoration: the
 * newborn takes the same index, and a run built around a relic sitting third
 * from the left survives its own egg hatching.
 *
 * Returns null when the egg is no longer on the belt — sold between the last
 * blow and the ceremony, and nothing is owed.
 */
export function hatchEgg(r, entry, def) {
  const i = r.artifacts.findIndex(a => a.id === entry.id);
  if (i < 0 || !def) return null;
  const inst = { ...def, state: JSON.parse(JSON.stringify(def.state ?? {})) };
  r.artifacts.splice(i, 1, inst);
  sinkNookArtifacts(r);
  def.onAcquire?.(r, inst);
  // A permanent receipt on the run ledger: the queue empties the instant the
  // shell cracks, so achievements.js needs something that outlives it.
  if (r.stats) r.stats.hatched = true;
  return inst;
}

/**
 * THE POTATO'S SECRET. Three fights in, it stops being a potato. The rules text
 * never hints at it and liveDesc never counts down — a countdown IS a hint —
 * so the only way to find out is to hold a potato and keep fighting.
 *
 * Everything the relic wears changes on the instance: name, description, icon,
 * tint, art key and mods. The id stays `potato` so ownership, the shop's
 * exclusion list and any save that already names it all keep working; the art
 * key is overridden separately (see artifactArtKey).
 */
export const POTATO_FIGHTS = 3;
export const GOLDEN_SPUD_VALUE = 50;
export const GOLDEN_SPUD = {
  name: 'The Golden Spud',
  desc: `+${GOLDEN_SPUD_VALUE} value. Turns out it was worth keeping.`,
  icon: 'icon_coins', tint: 0xffd23e, artKey: 'art_goldenSpud',
};
export function becomeGoldenSpud(a) {
  if (!a || a.state?.golden) return a;
  Object.assign(a, {
    name: GOLDEN_SPUD.name, desc: GOLDEN_SPUD.desc,
    icon: GOLDEN_SPUD.icon, tint: GOLDEN_SPUD.tint, artKey: GOLDEN_SPUD.artKey,
    mods: { flatValue: GOLDEN_SPUD_VALUE },
  });
  if (a.state) a.state.golden = true;
  return a;
}

/** The texture a relic paints with. `artKey` is the transformer's override. */
export function artifactArtKey(art) { return art?.artKey ?? ('art_' + art?.id); }

/** PROSPECTOR'S PAN: chance one played card comes up SHINY, per card, per play. */
export const SHINY_CHANCE = 0.01;
/** SLOT BUTTON: what changes hands, either way. Never below zero chips. */
export const SLOT_BUTTON_CHIPS = 75;
/** DOUBLES VOUCHER: chips per Two Pair played. */
export const DOUBLES_VOUCHER_CHIPS = 15;
/**
 * THE TWO INTEREST RELICS (0805 swap). They used to be the other way round: the
 * RARE Stock Market held the uncapped every-encounter engine and the LEGENDARY
 * Banker's Vault held the small after-a-fight trickle, which read backwards on
 * the shelf and made the rare the strongest economy relic in the game.
 *
 * They have traded effects. The rare is now the modest one and the legendary is
 * the engine — and the engine is CAPPED, which is the nerf that comes with the
 * promotion: a tenth of your purse, on every encounter, but never more than
 * VAULT_INTEREST_CAP out of any one of them.
 *
 * Ids, names, icons, tints and prices did NOT move (the icon art is keyed by id).
 */
/** STOCK MARKET (rare): interest after a won FIGHT, and the ceiling on one payout. */
export const STOCK_MARKET_RATE = 0.12;
export const STOCK_MARKET_CAP = 40;
/**
 * BANKER'S VAULT (legendary): what your chips earn after EVERY ENCOUNTER — an
 * encounter being whatever the map already calls one, because the payout hangs
 * off run.enterMapNode, the single door every advance goes through. It compounds,
 * and the cap is per payout rather than per run, so it never stops paying: it
 * just stops doubling once your purse is past VAULT_INTEREST_CAP / VAULT_RATE.
 */
export const VAULT_INTEREST_RATE = 0.10;
export const VAULT_INTEREST_CAP = 500;
/**
 * LUCKY STAMPER: the chance one played card comes back SEALED. Per card, per
 * play, and only ever rolled at COMMIT (see the relic's handCommit hook).
 */
export const STAMPER_CHANCE = 0.05;
/** LATENT REPEATER: how many times LEFTOVER-in-hand effects fire. */
export const LATENT_BENCH_REPEAT = 2;
/** TUNGSTEN CUBE: flat Shield on any hand that shields, before Aegis Core. */
export const TUNGSTEN_SHIELD = 3;
/** THE RUTHLESS EDITOR: discards gained, and the card it takes off the deal. */
export const EDITOR_DISCARDS = 2;
/** THE OVERSTUFFED SATCHEL: hand size gained, and the relic slot it eats. */
export const SATCHEL_HAND_SIZE = 2;
/**
 * THE TWO BENCHES. Both leftover relics pay the same rate per card held back,
 * multiplicatively: the RIGGED WHEEL counts benched ROULETTE cards, the
 * VOIDCALLER counts benched ETHEREAL ones. One number, so the pair reads as a
 * pair and the copy can never drift from the arithmetic.
 */
export const BENCH_FACTOR = 1.25;
/** THE CRACKED CROWN's payout, revoked on sale so it cannot be looped. */
export const CRACKED_CROWN_CHIPS = 500;
export const RIGGED_WHEEL_FACTOR = BENCH_FACTOR;
export const ETHEREAL_BENCH_FACTOR = BENCH_FACTOR;

/** "Currently: ..." — the live line a tooltip appends. null when there is none. */
export function artifactLiveLine(art, run) {
  try { return art?.liveDesc?.(art, run) ?? null; }
  catch { return null; }
}

export const ARTIFACT_POOL = [
  // ============================ COMMON ============================
  {
    id: 'whetstone', name: 'Whetstone Charm', rarity: 'common', price: 55,
    icon: 'icon_sword_small', tint: 0x8898b8,
    desc: 'Sword cards are worth +7 value.',
    mods: { suitValue: { swords: 7 } },
  },
  {
    id: 'prayerBeads', name: 'Prayer Beads', rarity: 'common', price: 55,
    icon: 'icon_heart_small', tint: 0xe0434f,
    desc: 'Heart cards add +1 mult each when scored.',
    mods: { suitMult: { hearts: 1 } },
  },
  {
    id: 'cutGem', name: 'Cut Gemstone', rarity: 'common', price: 55,
    icon: 'icon_gem', tint: 0x2bb3d6,
    // FLIPPED to the mult side (JC, 2026-08-01): the gem twin of Prayer Beads.
    // Diamonds already carry their own value into BOTH damage and shield, so a
    // fifth +1-value common said nothing; a flat mult per diamond does.
    desc: 'Diamond cards add +1 mult each when scored.',
    mods: { suitMult: { gems: 1 } },
  },
  {
    id: 'rabbitsFoot', name: "Rabbit's Foot", rarity: 'common', price: 55,
    icon: 'icon_lucky', tint: 0x3fa64b,
    desc: 'Club cards are worth +7 value.',
    mods: { suitValue: { clovers: 7 } },
  },
  {
    id: 'chalice', name: 'Vampiric Chalice', rarity: 'common', price: 60,
    icon: 'icon_heart_small', tint: 0x8a1830,
    desc: 'Heal 1 HP for every card you play. Kickers drink too.',
    hooks: {
      afterHand(scene, a, ctx) {
        // A repeated hand really did play those cards again, so the chalice
        // pours again — the same rule scoring.js already applies to card chips.
        const sips = (ctx.played?.length ?? 0) * handActivations(ctx);
        if (sips > 0) scene.healPlayer(sips, { quiet: true });
      },
    },
  },
  {
    id: 'aegis', name: 'Aegis Core', rarity: 'common', price: 60,
    icon: 'icon_shield', tint: 0x2bb3d6,
    desc: 'All Shield you gain is 35% stronger.',
    props: { shieldFactor: 0.35 },
  },
  {
    id: 'ironRation', name: 'Iron Ration', rarity: 'common', price: 60,
    icon: 'icon_heart_small', tint: 0xb87838,
    desc: '+2 Max HP after every fight.',
    hooks: {
      fightEnd(scene, a) {
        scene.run.player.maxHp += 2; scene.run.player.hp += 2;
        bank(a, 'given', 2);
      },
    },
    liveDesc(a) { return `Currently: +${a.state.given ?? 0} Max HP fed to you so far`; },
  },
  {
    // Kills stopped paying on 2026-08-01 (the fight budget is gone; a won fight
    // pays for the hands you did NOT need). The purse used to read '+25% chips
    // from enemy kills', which would now be a relic that does nothing at all —
    // so it became the small, common sibling of the Sticky Gloves: a flat
    // percentage on EVERY chip you receive, wherever it came from.
    id: 'chipPurse', name: 'Chip Purse', rarity: 'common', price: 50,
    icon: 'icon_coins', tint: 0xffffff,
    desc: '+15% chips from every gain.',
    props: { chipGain: 0.15 },
  },
  {
    // THE HANDY POUCH (2026-08-01). The victory purse pays CHIPS_PER_HAND_LEFT
    // per hand still on the clock; the pouch fattens the rate itself, so it is
    // worth exactly as much as you are good at ending fights early.
    id: 'handyPouch', name: 'Handy Pouch', rarity: 'common', price: 55,
    icon: 'icon_coins', tint: 0xffc542,
    desc: 'Every hand you did not need pays double: 10 → 20 chips.',
    props: { handsChipBonus: 10 },
  },
  {
    id: 'cardsharp', name: "Cardsharp's Ring", rarity: 'common', price: 60,
    icon: 'icon_trash', tint: 0x9a4030,
    desc: '+1 Discard in every fight.',
    // Sold? The habit leaves with the ring. EXACT INVERSE OF onAcquire, with
    // no floor of its own: THE ORACLE (Handy, Compensator, Gambling Addict)
    // can put this channel BELOW zero, and a sell that clamped at 0 was
    // laundering the Oracle's price away permanently — one buy-and-sell of a
    // 60-chip common turned HANDY's +2 hands into pure upside. The floor that
    // matters lives at the READ site (CombatScene.newFightState clamps
    // discardsLeft at 0), which is where it belongs.
    onSell(run) { run.discardsPerFightBonus -= 1; },
    uncopyable: true,
    onAcquire(run) { run.discardsPerFightBonus += 1; },
  },
  {
    id: 'towerWax', name: 'Tower Shield Wax', rarity: 'common', price: 55,
    icon: 'icon_shield', tint: 0xc0a040,
    desc: 'Start fights with +8 Shield; every fight won waxes on +1 more.',
    onAcquire(run) { run.startShield += 8; },
    // THE WAX COMES OFF WITH IT (0803 revocation audit). It used to grant the
    // +8 at pickup and never take it back, so a sold tin left its shield on the
    // run forever. The base coat AND every coat it waxed on leave together;
    // plate already standing in the fight you are in is not clawed back, because
    // it may have eaten a blow already and un-eating it is not a thing.
    onSell(run, inst) {
      run.startShield = Math.max(0, run.startShield - (8 + (inst?.state?.waxed ?? 0)));
    },
    hooks: {
      fightEnd(scene, a) {
        scene.run.startShield += 1;
        bank(a, 'waxed');   // the tooltip's running total
      },
    },
    liveDesc(a) {
      const waxed = a.state.waxed ?? 0;
      return `Currently: +${8 + waxed} Shield  (${waxed} coat${waxed === 1 ? '' : 's'} of wax)`;
    },
  },
  {
    id: 'snackSatchel', name: 'Snack Satchel', rarity: 'common', price: 50,
    icon: 'icon_heart_small', tint: 0x3fa64b,
    desc: 'Heal 5 HP and gain +1 Max HP after every fight. There is always something left in it.',
    hooks: {
      // Max HP first, so the 5 has the extra point of room to fill.
      fightEnd(scene, a) {
        scene.run.player.maxHp += 1;
        scene.healPlayer(5, { quiet: true });
        bank(a, 'given');
      },
    },
    liveDesc(a) { return `Currently: +${a.state.given ?? 0} Max HP from the satchel`; },
  },
  {
    id: 'bluntDagger', name: 'Blunt Dagger', rarity: 'common', price: 50,
    icon: 'icon_sword_small', tint: 0x706860,
    desc: 'Play a single card and it is worth +15 value. Small knife, committed grip.',
    props: { oneCardValue: 15 },
  },
  {
    id: 'luckyPenny', name: 'Lucky Penny', rarity: 'common', price: 50,
    icon: 'icon_coins', tint: 0xb87333,
    desc: 'Merchant RESTOCKS cost half. Fortune favors the browser.',
    props: { restockHalf: 1 },
  },
  {
    // Keeps the lodestone id (and Caleb's art) — the stone was always about
    // attraction; now it drags a second enemy into every blow.
    id: 'lodestone', name: 'Bonded Stone', rarity: 'common', price: 60,
    icon: 'icon_dice', tint: 0x2e8b57,
    desc: '30% of your damage echoes into a second enemy.',
    props: { resonance: 0.3 },
  },

  // --- NIGHT 0802, common tier -------------------------------------------
  // Twelve relics for the shallow end of the pool: three of them are flat
  // numbers on the two new shared channels (flatValue / handSizeBonus), two
  // are scalers that bank forever, and the rest talk to systems outside the
  // fight — the merchant's mat, his restock ladder, the reward flow.
  {
    id: 'collectorsKerchief', name: "Collector's Kerchief", rarity: 'common', price: 55,
    icon: 'icon_help', tint: 0xc8a860,
    desc: 'Vendors and the Curator show one more artifact.',
    props: { extraStock: 1 },
  },
  {
    id: 'freeCoupon', name: 'Free Coupon', rarity: 'common', price: 50,
    icon: 'icon_coins', tint: 0x8fd8ff,
    desc: 'The first RESTOCK at each merchant is free. Somebody already clipped it out for you.',
    props: { freeFirstRestock: 1 },
  },
  {
    // A SCALER on the value side. Pairs are the cheapest thing in poker, which
    // is the point: it banks on hands you were going to play anyway.
    id: 'matchmaker', name: 'Matchmaker', rarity: 'common', price: 60,
    icon: 'icon_heart_small', tint: 0xe07aa0,
    desc: 'Every pair in a hand you play adds +1 VALUE to this artifact, forever. Two Pair counts twice.',
    mods(a) { return { flatValue: a.state.value ?? 0 }; },
    hooks: {
      afterHand(scene, a, ctx) {
        const pairs = countScoringPairs(ctx.res) * handActivations(ctx);
        if (pairs > 0) bank(a, 'value', pairs);
      },
    },
    liveDesc(a) {
      const v = a.state.value ?? 0;
      return `Currently: +${v} value  (${v} pair${v === 1 ? '' : 's'} matched)`;
    },
  },
  {
    id: 'brassKnuckles', name: 'Brass Knuckles', rarity: 'common', price: 55,
    icon: 'icon_sword_small', tint: 0xb87838,
    desc: '+3 mult.',
    mods: { flatMult: 3 },
  },
  {
    id: 'pocketAnvil', name: 'Pocket Anvil', rarity: 'common', price: 55,
    icon: 'icon_anvil', tint: 0x8898b8,
    desc: '+7 value. It fits in a pocket. It should not.',
    mods: { flatValue: 7 },
  },
  {
    id: 'scrappersLicense', name: "Scrapper's License", rarity: 'common', price: 60,
    icon: 'icon_trash', tint: 0x60a848,
    desc: '+1 Discard in every fight. Licensed, apparently.',
    // Cardsharp's Ring's pattern exactly: granted at pickup, revoked on sale,
    // and uncopyable because a mirror has nothing left to re-read.
    uncopyable: true,
    onAcquire(run) { run.discardsPerFightBonus += 1; },
    onSell(run) { run.discardsPerFightBonus -= 1; },
  },
  {
    id: 'tailoredSleeve', name: 'Tailored Sleeve', rarity: 'common', price: 60,
    icon: 'icon_refresh', tint: 0xd8c8b0,
    desc: '+1 hand size. Tailored generously.',
    props: { handSizeBonus: 1 },
  },
  {
    id: 'doublesVoucher', name: 'Doubles Voucher', rarity: 'common', price: 50,
    icon: 'icon_coins', tint: 0x4aa8ff,
    desc: `+${DOUBLES_VOUCHER_CHIPS} chips every time you play Two Pair.`,
    hooks: {
      afterHand(scene, a, ctx) {
        if (ctx.res.handType !== 'twoPair') return;
        // gainChips answers with what was ACTUALLY credited (the Sticky Gloves
        // and the difficulty's gold factor both live inside it), so the ledger
        // records the real payout rather than the sticker price.
        const times = handActivations(ctx);
        const paid = scene.gainChips(DOUBLES_VOUCHER_CHIPS * times, 'DOUBLES', { quiet: true });
        bank(a, 'redeemed', times);
        bank(a, 'paid', paid);
      },
    },
    liveDesc(a) {
      const n = a.state.redeemed ?? 0;
      return `Currently: ${a.state.paid ?? 0} chips paid out  (${n} Two Pair)`;
    },
  },
  {
    // Rolls a suit at the OPENING BELL and forgets it at the closing one. It
    // banks nothing on purpose: it is the one relic whose value is different
    // every fight, and planning around a suit you did not choose is the game.
    id: 'turncoatBanner', name: 'Turncoat Banner', rarity: 'common', price: 55,
    icon: 'icon_volume', tint: 0x9a4030,
    desc: 'Every fight it flies one random suit: +1 mult for each card of that suit you score. It picks a different one tomorrow.',
    mods(a) {
      const s = a.state.suit;
      return s ? { suitMult: { [s]: 1 } } : {};
    },
    hooks: {
      fightStart(scene, a) {
        if (a?.state) a.state.suit = SUITS[Math.floor(Math.random() * SUITS.length)];
      },
    },
    liveDesc(a) {
      const s = a.state.suit;
      return s
        ? `Currently: +1 mult per ${SUIT_GLYPH[s]} card  (this fight only)`
        : 'Currently: no colours flown. It picks a suit at the next opening bell.';
    },
  },
  {
    // The Banner's twin, on the other side of the trade: the suit is forgotten
    // at the bell, the RANK's winnings are kept forever.
    id: 'wantedPoster', name: 'Wanted Poster', rarity: 'common', price: 60,
    icon: 'icon_skull', tint: 0xc8a860,
    desc: 'At the start of every fight a rank is WANTED. Score one and this artifact gains +1 MULT, forever.',
    mods(a) { return { flatMult: a.state.mult ?? 0 }; },
    hooks: {
      fightStart(scene, a) {
        // 2 through ACE, the whole ladder — the poster is allowed to want an Ace.
        if (a?.state) a.state.rank = 2 + Math.floor(Math.random() * 13);
      },
      afterHand(scene, a, ctx) {
        const wanted = a?.state?.rank;
        if (!wanted) return;
        const n = countScoringRank(ctx.res, wanted) * handActivations(ctx);
        if (n > 0) bank(a, 'mult', n);
      },
    },
    liveDesc(a) {
      const m = a.state.mult ?? 0;
      const r = a.state.rank;
      return r
        ? `Currently: +${m} mult  ·  WANTED: ${rankLabel(r)}`
        : `Currently: +${m} mult  (a new face goes up at the next opening bell)`;
    },
  },
  {
    // THE EGG. See queueHatch: fightEnd fires mid-victory, so it books the
    // hatch and the reward flow performs it — in the SAME row position, because
    // relics resolve left to right and where a relic stands is a decision.
    id: 'theEgg', name: 'The Egg', rarity: 'common', price: 60,
    icon: 'icon_gem', tint: 0xf0e0c0,
    desc: `Becomes a VERY RARE artifact after ${EGG_HATCH_FIGHTS} fights. ${oneIn(EGG_HATCH_TABLE.legendary)} hatches LEGENDARY instead. Warm to the touch.`,
    hooks: {
      fightEnd(scene, a) {
        bank(a, 'fights');
        if (a?.state?.queued || (a?.state?.fights ?? 0) < EGG_HATCH_FIGHTS) return;
        a.state.queued = true;
        queueHatch(scene.run ?? run, a, EGG_HATCH_TABLE);
      },
    },
    liveDesc(a) {
      const left = Math.max(0, EGG_HATCH_FIGHTS - (a.state.fights ?? 0));
      if (a.state.queued || left === 0) return 'Currently: HATCHING. Something is coming out.';
      return `Currently: ${left} fight${left === 1 ? '' : 's'} until it hatches`;
    },
  },
  {
    // ACTIVE, in the Hushed Bell's shape. Uncopyable by definition — a mirror
    // has no button — and the loss floors at zero, so the machine can take
    // everything you have and never a chip more.
    id: 'slotButton', name: 'Slot Button', rarity: 'common', price: 50,
    icon: 'icon_dice', tint: 0xd8b830,
    desc: `Once a fight: ${SLOT_BUTTON_CHIPS} chips change hands. The house does not specify which way. It never takes you below zero.`,
    uncopyable: true,
    active: {
      label: 'PULL', hint: `${SLOT_BUTTON_CHIPS} chips, one way or the other`,
      use(scene, a) { return scene.useSlotButton(a); },
    },
    liveDesc(a) {
      const w = a.state.won ?? 0, l = a.state.lost ?? 0;
      if (!w && !l) return 'Currently: never pulled. The machine is patient.';
      return `Currently: ${w} win${w === 1 ? '' : 's'}, ${l} loss${l === 1 ? '' : 'es'}  (${(a.state.net ?? 0) >= 0 ? '+' : ''}${a.state.net ?? 0} chips)`;
    },
  },

  // ============================ RARE ============================
  {
    id: 'echoBell', name: 'Echo Bell', rarity: 'rare', price: 125,
    icon: 'icon_music_note', tint: 0xd8b830,
    desc: 'Of-a-kind hands gain +2 mult. Every one you play rings the bell louder: +0.2 more, forever.',
    // "Of a kind" includes the two SECRET hands — five matched ranks is the
    // loudest of-a-kind there is.
    mods(a) {
      const b = 2 + (a.state.rung ?? 0);
      return {
        handMult: {
          pair: b, twoPair: b, trips: b, fullHouse: b, quads: b,
          fiveOfAKind: b, flushFive: b,
        },
      };
    },
    hooks: {
      afterHand(scene, a, ctx) {
        if (OF_A_KIND_HANDS.includes(ctx.res.handType)) {
          const ring = 0.2 * handActivations(ctx);
          if (a?.state) a.state.rung = Math.round(((a.state.rung ?? 0) + ring) * 10) / 10;
        }
      },
    },
    liveDesc(a) {
      const rung = a.state.rung ?? 0;
      return `Currently: +${num(2 + rung)} mult  (${Math.round(rung / 0.2)} rung)`;
    },
  },
  {
    // THE TETHER — a line strung between everything in the room. Unlike the
    // Warhorn it asks nothing of your suits; it just always reaches.
    // 25% -> 40% (JC, 2026-08-01): clubs now splash 25% for free, so the relic
    // had to out-reach the suit rule it sits next to. It ADDS to the club
    // splash rather than replacing it — see CombatScene.deliverStrike.
    id: 'tether', name: 'Spectral Tether', rarity: 'rare', price: 130,
    icon: 'icon_refresh', tint: 0x8fd8ff,
    desc: 'Your damage also strikes every OTHER enemy for 40%. Every strike, every time.',
    props: { tether: 0.40 },
  },
  {
    id: 'warhorn', name: 'Warhorn of the Legion', rarity: 'rare', price: 125,
    icon: 'icon_volume', tint: 0xb85838,
    desc: 'Hands with Swords cleave every other enemy for 30% damage.',
    props: { swordCleave: 0.3 },
  },
  {
    id: 'seal', name: "Executioner's Seal", rarity: 'rare', price: 125,
    icon: 'icon_skull', tint: 0xc03040,
    desc: 'Enemies below 30% HP die instantly (bosses: 15%).',
    props: { execute: 1 },
  },
  {
    id: 'gildedContract', name: 'Gilded Contract', rarity: 'rare', price: 105,
    icon: 'icon_coins', tint: 0xffd23e,
    desc: 'Every scoring card pays 2 chips when played.',
    hooks: {
      afterHand(scene, a, ctx) {
        const n = ctx.res.breakdown.filter(b => b.scoring).length * handActivations(ctx);
        if (n > 0) scene.gainChips(n * 2, null, { quiet: true });
      },
    },
  },
  {
    // REWORKED 2026-08-01: the gloves used to refund discards, which was a coin
    // flip you could not feel. They now do the thing their name has always
    // promised — chips STICK to them. A flat multiplier on run.gainGold, so it
    // catches every source in the game at once: the victory purse, hand chips,
    // pack payouts, event purses, interest, the wheel.
    id: 'stickyGloves', name: 'Sticky Gloves', rarity: 'rare', price: 100,
    icon: 'icon_refresh', tint: 0x3fa64b,
    desc: '+25% chips from ALL gains. Coins stick to these fingers.',
    props: { chipGain: 0.25 },
  },
  {
    // --- POISON RELIC, OPHELIA ONLY (see THE POISON BENCH note below) --------
    // Was: 'Your status applications gain +1 stack' (a flat +1 next to a mult
    // curve in the thousands, and dead for three of the four heroes). It is now
    // a slice of her CONVERSION, which scales with every point of damage she
    // will ever deal. Same id, same skull art, same green.
    // heroBound: `poisonConvert` is read ONLY inside poisonConversion(), which
    // returns 0 for anyone but Ophelia. Dead in any other hand, Cultured or not.
    id: 'cruelSting', name: 'Cruel Sting', rarity: 'rare', hero: 'venomancer', heroBound: 1, price: 125,
    icon: 'icon_skull', tint: 0x3fa64b,
    desc: '+25% of your damage seeps in as poison, on top of the half that already does.',
    props: { poisonConvert: 0.25 },
  },
  {
    id: 'ambushGlass', name: "Ambusher's Hourglass", rarity: 'rare', price: 130,
    icon: 'icon_hourglass', tint: 0xd0a040,
    desc: 'Your FIRST hand each fight strikes at ×1.5 mult.',
    props: { firstHandFactor: 1.5 },
  },
  {
    id: 'plagueBanner', name: 'Plague Banner', rarity: 'rare', price: 125,
    icon: 'icon_skull', tint: 0x60a848,
    desc: 'When an enemy dies, its statuses spread to a random living enemy.',
    hooks: {
      kill(scene, a, enemy) {
        const living = scene.livingEnemies();
        if (!living.length) return;
        const heir = living[Math.floor(Math.random() * living.length)];
        let moved = false;
        for (const k of Object.keys(enemy.statuses)) {
          if (enemy.statuses[k] > 0) { heir.statuses[k] = (heir.statuses[k] ?? 0) + enemy.statuses[k]; moved = true; }
        }
        if (moved) scene.floatText(heir, 'INHERITED!', '#60a848');
      },
    },
  },
  {
    id: 'collectorsLedger', name: "Collector's Ledger", rarity: 'rare', price: 110,
    icon: 'icon_help', tint: 0xc8a860,
    desc: 'Booster packs contain one extra choice.',
    props: { packExtra: 1 },
  },
  {
    id: 'secondWind', name: 'Second Wind', rarity: 'rare', price: 130,
    icon: 'icon_heart_small', tint: 0xf0f0f0,
    desc: 'Once per act: the first time you would die, survive at 25% of your Max HP.',
    props: { secondWind: 1 },
    liveDesc(a, run) {
      return a.state.usedAct === run.actIndex
        ? 'Currently: SPENT. It breathes again next act.'
        : 'Currently: CHARGED. One death refused this act.';
    },
  },
  {
    id: 'adrenalVial', name: 'Adrenal Vial', rarity: 'rare', price: 120,
    icon: 'icon_fire', tint: 0xd04828,
    desc: 'Below half HP, your hands strike at ×1.5 mult.',
    props: { lowHpFactor: 1.5 },
  },
  {
    /**
     * REWORKED into a SCALER (JC, 2026-08-01). The flat ×1.5 was a fine
     * turn-one number that never grew. The edge now FILES ITSELF SHARPER:
     * every straight you play banks +10, and the bank is added to the hand as
     * flat PRE-MULT VALUE (mods.handValue) — so it rides the score side and
     * every ×mult you own multiplies it, exactly like a card's value would.
     * Straight-family only: straight and straight flush.
     */
    id: 'straightedge', name: 'Straightedge', rarity: 'rare', price: 125,
    icon: 'icon_sword_small', tint: 0xc8c8d8,
    desc: 'Every straight you play banks +10 VALUE onto this artifact, forever. Straights are worth all of it.',
    mods(a) {
      const v = a.state.filed ?? 0;
      return { handValue: { straight: v, straightFlush: v } };
    },
    hooks: {
      afterHand(scene, a, ctx) {
        if (ctx.res.handType === 'straight' || ctx.res.handType === 'straightFlush') {
          bank(a, 'filed', 10 * handActivations(ctx));
        }
      },
    },
    liveDesc(a) {
      const v = a.state.filed ?? 0;
      return `Currently: +${v} value on straights  (${v / 10} straight${v === 10 ? '' : 's'} played)`;
    },
  },
  {
    id: 'paintersPalette', name: "Painter's Palette", rarity: 'rare', price: 125,
    icon: 'icon_star', tint: 0xc060c0,
    desc: 'Flushes strike at ×2 mult.',
    mods: { handFactor: { flush: 2, straightFlush: 2 } },
  },
  {
    id: 'bountyBoard', name: 'Bounty Board', rarity: 'rare', price: 120,
    icon: 'icon_sword_small', tint: 0xb8862c,
    desc: 'Elites drop +60 chips and their artifact is one rarity higher.',
    props: { eliteChips: 60, eliteRarityBoost: 1 },
  },
  {
    /**
     * REWORKED 2026-08-01 (JC). The charm used to be a pure Bleed ward, which
     * did nothing at all in the two acts that never bleed you. It now COUNTS:
     * every wolf this run has put down is WOLFSBANE_MULT_PER_WOLF mult (5 -> 1
     * on 0803, see the constant), forever, and because the
     * kill ledger (run.stats.kills) has been running since fight one, the
     * charm pays RETROACTIVELY for every wolf you killed before you found it.
     * The ward stays as a second clause — it is wolfsbane, and dropping it
     * would leave Bleed with no answer anywhere in the pool.
     */
    id: 'wolfsbane', name: 'Wolfsbane Charm', rarity: 'rare', price: 95,
    icon: 'icon_drop', tint: 0xffffff,
    desc: `+${WOLFSBANE_MULT_PER_WOLF} mult for every WOLF killed this run, the ones before you found it included. Regular enemies cannot Bleed you.`,
    props: { immuneBleed: 1 },
    mods(a, run) {
      return { flatMult: wolvesSlain(run) * WOLFSBANE_MULT_PER_WOLF };
    },
    liveDesc(a, run) {
      const n = wolvesSlain(run);
      return `Currently: +${n * WOLFSBANE_MULT_PER_WOLF} mult  (${n} ${n === 1 ? 'wolf' : 'wolves'} slain)`;
    },
  },
  {
    id: 'emberheart', name: 'Ember Heart', rarity: 'rare', price: 95,
    icon: 'icon_fire', tint: 0xe06828,
    desc: 'Nothing freezes an ember: immune to Freeze from EVERY source, bosses included. Heart cards are also worth +5 value.',
    props: { immuneFreeze: 1, immuneFreezeAll: 1 },
    mods: { suitValue: { hearts: 5 } },
  },
  {
    id: 'clarityBell', name: 'Bell of Clarity', rarity: 'rare', price: 95,
    icon: 'icon_magic', tint: 0x9adcff,
    desc: 'Regular enemies cannot Fear or Hypnotize you. Bosses still can.',
    props: { immuneFear: 1, immuneHypno: 1 },
  },

  // --- THE SCALERS, rare tier (JC, 2026-08-01) -----------------------------
  // Every one of them BANKS on its own instance (a.state), exactly like the
  // Echo Bell — which means a RE-FORGED copy is struck carrying the growth it
  // was copied from, and a mirror pointed at one reads the same live number.
  {
    id: 'luckyDeuce', name: 'Lucky Deuce', rarity: 'rare', price: 125,
    icon: 'icon_dice', tint: 0x4aa8ff,
    desc: 'Every 2 you score adds +1 MULT to this artifact, forever. Nobody else wanted them.',
    mods(a) { return { flatMult: a.state.deuces ?? 0 }; },
    hooks: {
      afterHand(scene, a, ctx) {
        const n = countScoringRank(ctx.res, 2) * handActivations(ctx);
        if (n > 0) bank(a, 'deuces', n);
      },
    },
    liveDesc(a) {
      const d = a.state.deuces ?? 0;
      return `Currently: +${d} mult  (${d} deuce${d === 1 ? '' : 's'} played)`;
    },
  },
  suitGrinder({
    id: 'grindstone', name: 'Grindstone', suit: 'swords', glyph: 'SWORDS',
    icon: 'icon_sword_small', tint: 0xa8b0c0,
  }),
  suitGrinder({
    id: 'beatingHeart', name: 'Beating Heart', suit: 'hearts', glyph: 'HEARTS',
    icon: 'icon_heart_small', tint: 0xe0434f,
  }),
  suitGrinder({
    id: 'uncutDiamond', name: 'Uncut Diamond', suit: 'gems', glyph: 'DIAMONDS',
    icon: 'icon_gem', tint: 0x2bb3d6,
  }),
  suitGrinder({
    id: 'wildGrowth', name: 'Wild Growth', suit: 'clovers', glyph: 'CLUBS',
    icon: 'icon_lucky', tint: 0x3fa64b,
  }),

  // --- NIGHT 0802, rare tier ----------------------------------------------
  {
    // Rolls in handCommit and NEVER in the preview — the same rule the Chaos
    // Orb and the roulette wheel already follow, for the same reason: a preview
    // that rolls leaks the outcome and then desyncs from the play that follows.
    id: 'prospectorsPan', name: "Prospector's Pan", rarity: 'rare', price: 110,
    icon: 'icon_drop', tint: 0xc8a860,
    desc: 'Every card you play has a 1 in 100 chance of coming up SHINY, permanently. Shiny cards score at ×1.25 mult.',
    hooks: {
      handCommit(scene, a, ctx) {
        const chance = scene?._panForce ?? SHINY_CHANCE;
        for (const card of ctx.cards ?? []) {
          if (card.wrap === 'shiny' || card.mod === 'shiny') continue;
          if (Math.random() >= chance) continue;
          bank(a, 'struck');
          scene.strikeShiny?.(card, a);
        }
      },
    },
    liveDesc(a) {
      const n = a.state.struck ?? 0;
      return `Currently: ${n} card${n === 1 ? '' : 's'} panned out shiny`;
    },
  },
  {
    // The Egg's machinery, one rung up the ladder: where The Egg's quarter buys
    // a Legendary, this one's buys a MYTHICAL. Same queue, same in-place hatch,
    // same ceremony, same sentence shape so the two read as a pair on the shelf.
    id: 'theRareEgg', name: 'The Rare Egg', rarity: 'rare', price: 130,
    icon: 'icon_gem', tint: 0xb45cff,
    desc: `Becomes a LEGENDARY artifact after ${EGG_HATCH_FIGHTS} fights. ${oneIn(RARE_EGG_HATCH_TABLE.mythical)} hatches MYTHICAL instead.`,
    hooks: {
      fightEnd(scene, a) {
        bank(a, 'fights');
        if (a?.state?.queued || (a?.state?.fights ?? 0) < EGG_HATCH_FIGHTS) return;
        a.state.queued = true;
        queueHatch(scene.run ?? run, a, RARE_EGG_HATCH_TABLE);
      },
    },
    liveDesc(a) {
      const left = Math.max(0, EGG_HATCH_FIGHTS - (a.state.fights ?? 0));
      if (a.state.queued || left === 0) return 'Currently: HATCHING. Something is coming out.';
      return `Currently: ${left} fight${left === 1 ? '' : 's'} until it hatches`;
    },
  },
  {
    // Lands inside scoreHand, which puts it UPSTREAM of Aegis Core: the Core
    // multiplies whatever the hand hands it, so holding both is worth more than
    // either number reads on its own.
    id: 'tungstenCube', name: 'Tungsten Cube', rarity: 'rare', price: 105,
    icon: 'icon_shield', tint: 0x9aa0a8,
    desc: `Any Shield a hand grants you is worth +${TUNGSTEN_SHIELD} more.`,
    mods: { flatShield: TUNGSTEN_SHIELD },
  },
  {
    id: 'impressiveTitle', name: 'Impressive Title', rarity: 'rare', price: 115,
    icon: 'icon_star', tint: 0xd8b830,
    desc: '+4 mult. Nobody has checked whether it was ever awarded.',
    mods: { flatMult: 4 },
  },
  {
    // TAKES A SLOT AND REMOVES ONE, so acquiring it needs TWO cells free. The
    // ceremony reads `slotDrain` when it decides whether the belt is full, which
    // is what routes a full row into the ordinary replace flow instead of
    // stranding a relic off the belt (see rewards.artifactCeremony).
    id: 'overstuffedSatchel', name: 'Overstuffed Satchel', rarity: 'rare', price: 110,
    icon: 'icon_lucky', tint: 0x8a6a3c,
    desc: `+${SATCHEL_HAND_SIZE} hand size, and one fewer artifact slot. Something had to come out to make room.`,
    props: { handSizeBonus: SATCHEL_HAND_SIZE, slotDrain: 1 },
    uncopyable: true,
    // Never below one slot: a belt with no cells at all is not a drawback, it
    // is a run that cannot be played.
    onAcquire(run) { run.artifactSlots = Math.max(1, run.artifactSlots - 1); },
    onSell(run) { run.artifactSlots += 1; },
  },
  {
    /**
     * SWAPPED WITH THE BANKER'S VAULT (0805). It held the every-encounter engine
     * for two patches, uncapped and compounding, on a RARE at 130 chips — which
     * made the strongest economy relic in the game the one you were most likely
     * to be offered. The engine has gone up to the legendary where it belongs
     * (and picked up a ceiling on the way); the market keeps the vault's old
     * effect, verbatim: a small, capped payout after a won fight.
     *
     * It stays at the top of the rare band. A trickle you can count on for a
     * whole act is still worth a rare's price.
     */
    id: 'stockMarket', name: 'Stock Market', rarity: 'rare', price: 130,
    icon: 'icon_coins', tint: 0x50b888,
    desc: `After every fight, earn ${Math.round(STOCK_MARKET_RATE * 100)}% interest on your chips (max +${STOCK_MARKET_CAP}).`,
    hooks: {
      fightEnd(scene, a) {
        const interest = Math.min(STOCK_MARKET_CAP, Math.round((scene.run ?? run).chips * STOCK_MARKET_RATE));
        if (interest <= 0) return;
        scene.gainChips(interest, 'Interest!');
        bank(a, 'paid', interest);
      },
    },
    liveDesc(a) {
      const paid = a.state.paid ?? 0;
      return paid ? `Currently: ${paid} chips paid out in interest` : 'Currently: no interest yet';
    },
  },
  {
    /**
     * THE LUCKY STAMPER. Rolls in handCommit and NEVER in the preview — the
     * same rule the Prospector's Pan and the Chaos Orb already follow, for the
     * same reason: a preview that rolls leaks the outcome and then desyncs from
     * the play that follows.
     *
     * It reads the STAMPS table rather than naming the seals, so the day a new
     * seal is pressed it is in the bag with the rest and this relic needs no
     * edit. A card that already carries one is skipped: a stamp never overwrites
     * a stamp, and one card is only ever worth one seal.
     */
    id: 'luckyStamper', name: 'Lucky Stamper', rarity: 'rare', price: 115,
    icon: 'icon_anvil', tint: 0xd8b830,
    desc: `${oneIn(STAMPER_CHANCE)} chance that a card you play without a seal comes back SEALED, at random, permanently.`,
    hooks: {
      handCommit(scene, a, ctx) {
        const chance = scene?._stamperForce ?? STAMPER_CHANCE;
        const kinds = Object.keys(STAMPS);
        if (!kinds.length) return;
        for (const card of ctx.cards ?? []) {
          if (cardStamp(card)) continue;          // one patch of wax per card
          if (Math.random() >= chance) continue;
          bank(a, 'stamped');
          scene.strikeStamp?.(card, a, kinds[Math.floor(Math.random() * kinds.length)]);
        }
      },
    },
    liveDesc(a) {
      const n = a.state.stamped ?? 0;
      return `Currently: ${n} card${n === 1 ? '' : 's'} stamped`;
    },
  },
  {
    /**
     * THE NEGOTIATOR'S CERTIFICATION. `props.fullSellValue` is read in exactly
     * one place, run.sellFraction, which run.sellValue goes through — and every
     * surface that PRINTS a price and every path that PAYS one both call
     * sellValue against the live belt. So the map belt tip, the glove pouch, the
     * merchant's shelf, both confirm dialogs and the mid-fight sale all quote
     * the same number, and none of them needed a line changed.
     *
     * It pays for itself the day you sell it, because sellArtifact prices the
     * relic while it is still standing on the belt.
     */
    id: 'negotiatorsCert', name: "Negotiator's Certification", rarity: 'rare', price: 120,
    icon: 'icon_coins', tint: 0xc8a860,
    desc: `Relics sell for ${Math.round(NEGOTIATED_SELL_FRACTION * 100)}% of their price instead of ${Math.round(SELL_FRACTION * 100)}%. Everything you sell while you hold it is profit, and so is this.`,
    props: { fullSellValue: 1 },
  },
  {
    // A SECRET (JC). The description must never hint at what it becomes and
    // liveDesc must never count down, because a countdown IS the hint. See
    // becomeGoldenSpud: three fights in, everything about it changes in place.
    id: 'potato', name: 'Potato', rarity: 'rare', price: 95,
    icon: 'icon_lucky', tint: 0xb08040,
    desc: '+1 value. It is a potato.',
    mods: { flatValue: 1 },
    hooks: {
      fightEnd(scene, a) {
        bank(a, 'fights');
        if (a?.state?.golden || (a?.state?.fights ?? 0) < POTATO_FIGHTS) return;
        scene.turnPotatoGolden?.(a);
      },
    },
    // Silent until the secret is out — anything printed here before then is a
    // countdown wearing a different hat.
    liveDesc(a) {
      return a.state.golden ? `Currently: +${GOLDEN_SPUD_VALUE} value` : null;
    },
  },
  {
    // Retroactive by construction, exactly like the Wolfsbane Charm: the kill
    // ledger has been counting animals since fight one, so the duck arrives
    // already knowing what you did in Act I.
    id: 'duckOfDoom', name: 'Duck of Doom', rarity: 'rare', price: 125,
    icon: 'icon_drop', tint: 0xffd23e,
    desc: '+1 value for every ANIMAL you have killed this run. It was already counting before you found it.',
    mods(a, run) { return { flatValue: animalsSlain(run) * DUCK_VALUE_PER_ANIMAL }; },
    liveDesc(a, run) {
      const n = animalsSlain(run);
      return `Currently: +${n * DUCK_VALUE_PER_ANIMAL} value  (${n} animal${n === 1 ? '' : 's'} killed)`;
    },
  },
  {
    id: 'ruthlessEditor', name: 'The Ruthless Editor', rarity: 'rare', price: 110,
    icon: 'icon_trash', tint: 0xc03040,
    desc: `+${EDITOR_DISCARDS} Discards in every fight, and one card fewer in hand. Cut it down.`,
    props: { handSizeBonus: -1 },
    uncopyable: true,
    onAcquire(run) { run.discardsPerFightBonus += EDITOR_DISCARDS; },
    onSell(run) { run.discardsPerFightBonus -= EDITOR_DISCARDS; },
  },

  // ============================ VERY RARE ============================
  {
    id: 'risingTide', name: 'The Rising Tide', rarity: 'veryRare', price: 195,
    icon: 'icon_drop', tint: 0x3f8fd0,
    // "Flush family" is anything whose hand type contains FLUSH: a flush, a
    // straight flush, and the secret FLUSH FIVE. See isFlushHand.
    desc: 'Every FLUSH you play raises this artifact +1 MULT, forever. Straight flushes count.',
    mods(a) { return { flatMult: a.state.tide ?? 0 }; },
    hooks: {
      afterHand(scene, a, ctx) {
        if (isFlushHand(ctx.res.handType)) bank(a, 'tide', handActivations(ctx));
      },
    },
    liveDesc(a) {
      const t = a.state.tide ?? 0;
      return `Currently: +${t} mult  (${t} flush${t === 1 ? '' : 'es'} played)`;
    },
  },
  {
    /**
     * THE CHAOS ORB — the one relic that is a gamble every single hand. It
     * banks NOTHING: each hand it rolls chaosMultRoll() (0-15, weighted low,
     * see the curve above) and that is the mult it hands you. The roll is made
     * by the scene the instant the hand is committed and is announced in the
     * cascade with the number on it, because the number IS the fun.
     * `state` keeps a ledger (rolls / total / last) purely for the tooltip.
     */
    id: 'chaosOrb', name: 'Chaos Orb', rarity: 'veryRare', price: 190,
    icon: 'icon_magic', tint: 0xb45cff,
    desc: 'Every hand, the orb decides: it adds between 0 and 15 MULT. It usually decides small.',
    props: { chaosMult: 1 },
    liveDesc(a) {
      const rolls = a.state.rolls ?? 0;
      if (!rolls) return 'Currently: unrolled. The orb is still deciding.';
      const avg = Math.round(((a.state.total ?? 0) / rolls) * 10) / 10;
      return `Last roll: +${a.state.last ?? 0} mult  ·  ${rolls} roll${rolls === 1 ? '' : 's'}, averaging +${avg}`;
    },
  },
  {
    id: 'starChart', name: 'Star Chart', rarity: 'veryRare', price: 195,
    icon: 'icon_star', tint: 0xffd23e,
    desc: 'Adds four STAR cards to your deck: wild suit, scoring as YOUR suit ({SUIT}), and worth +10 value each.',
    uncopyable: true,
    mods: { modValue: { star: 10 } },
    onAcquire(run, inst) {
      const ids = [];
      for (const rank of [7, 9, 11, 13]) {
        const id = `star-${rank}-${run.runDeck.length}`;
        run.runDeck.push({ id, suit: 'clovers', rank, mod: 'star' });
        ids.push(id);
      }
      if (inst) inst.state.granted = ids;
    },
    // Sold? The ORIGINAL stars leave with it — copies you forged keep shining
    // (copies carry suffixed ids, so the receipt never matches them). JC: 'too
    // bad' if you upgraded the originals; duplicating first is the tech.
    onSell(run, inst) {
      const ids = new Set(inst?.state?.granted ?? []);
      for (let i = run.runDeck.length - 1; i >= 0; i--) {
        if (ids.has(run.runDeck[i].id)) run.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'twinfates', name: 'Twin Fates', rarity: 'veryRare', price: 210,
    icon: 'icon_refresh', tint: 0xb45cff,
    desc: 'Your hand echoes: strikes again at 50% damage.',
    props: { handEcho: 0.5 },
  },
  {
    /**
     * REDESIGNED (JC, 2026-08-04): "diamonds have a 1/20 chance to become
     * shiny when played." The placeholder ('+2 gem value') is gone.
     *
     * The touch of gold: every DIAMOND in a played hand rolls MIDAS_SHINY_CHANCE
     * to come away wearing the SHINY wrap — permanently, on the run deck card
     * itself, so the foil survives shuffles, fights and acts. Scoring or kicker
     * makes no difference: PLAYED is the trigger, which is the fairy-tale rule
     * (Midas touches it, it turns). A card already wrapped cannot double-gild.
     *
     * Printed suit, not effective: a wild played AS Diamonds is not a Diamond,
     * it is a wild doing an impression. The hook fires once per COPY on the
     * belt (artHook walks the effective row), so a Forgery aimed at this really
     * is a second gauntlet — the Forge Eternal precedent.
     */
    id: 'midas', name: 'Midas Gauntlet', rarity: 'veryRare', price: 205,
    icon: 'icon_gem', tint: 0xffc542,
    desc: `Every DIAMOND you play has a 1 in ${Math.round(1 / MIDAS_SHINY_CHANCE)} chance to come away SHINY, permanently: ×${WRAP_MULT_FACTOR.shiny} mult whenever it scores.`,
    hooks: {
      handCommit(scene, a, ctx) {
        for (const card of ctx.cards ?? []) {
          if (card.suit !== 'gems' || cardWrap(card)) continue;
          if (Math.random() >= MIDAS_SHINY_CHANCE) continue;
          scene.midasTouch?.(a, card);
          bank(a, 'gilded');
        }
      },
    },
    liveDesc(a) {
      const n = a.state.gilded ?? 0;
      return `Currently: ${n} card${n === 1 ? '' : 's'} turned SHINY by the gauntlet`;
    },
  },
  {
    // --- POISON RELIC, OPHELIA ONLY -----------------------------------------
    // Was 'Grimoire of Suits' (own-suit cards apply 1 status stack each) — flat,
    // and pointing at a rule that no longer exists now that clubs apply nothing.
    // Same id, same violet grimoire art, new page: the venom bites TWICE a round
    // and does not fade any faster for it, so it scales with every stack she
    // ever puts on a body.
    id: 'grimoire', name: 'Grimoire of Rot', rarity: 'veryRare', hero: 'venomancer', price: 195,
    icon: 'icon_magic', tint: 0x7a58c8,
    desc: 'Your Poison ticks TWICE every round, and fades no faster for it.',
    props: { poisonDoubleTick: 1 },
  },
  {
    id: 'crownGreed', name: 'Crown of Greed', rarity: 'veryRare', price: 200,
    icon: 'icon_coins', tint: 0xd8b020,
    desc: '+1% damage for every 20 chips in your purse. Wealth is a weapon.',
    mods(a, run) {
      return { globalMultFactor: 1 + Math.floor(run.chips / 20) * 0.01 };
    },
    liveDesc(a, run) {
      return `Currently: ×${num(1 + Math.floor(run.chips / 20) * 0.01)} damage  (${run.chips} chips)`;
    },
  },
  {
    id: 'worldRoot', name: 'World Tree Root', rarity: 'veryRare', price: 210,
    icon: 'icon_lucky', tint: 0x3fa64b,
    desc: '+1 Hand size and +1 Discard per fight.',
    uncopyable: true,
    onAcquire(run) { run.player.handSize += 1; run.discardsPerFightBonus += 1; },
    // Both exact inverses of onAcquire. The old floors (hand size 5, discards
    // 0) assumed the base could never be lower than the grant, which THE
    // ORACLE's Foolish Nature and Compensator both broke; HAND_SIZE_FLOOR and
    // the discard clamp at the read sites are the real guards.
    onSell(run) {
      run.player.handSize -= 1;
      run.discardsPerFightBonus -= 1;
    },
  },
  {
    id: 'courtSession', name: 'Court in Session', rarity: 'veryRare', price: 200,
    icon: 'icon_star', tint: 0xe8d8a0,
    desc: '+20% mult per card left in your hand. The court rewards what you hold back.',
    props: { leftoverPct: 20 },
  },
  {
    id: 'ouroboros', name: 'Ouroboros Loop', rarity: 'veryRare', price: 205,
    icon: 'icon_refresh', tint: 0x50b888,
    desc: 'The highest-value scoring card of every hand RETRIGGERS: it counts three times.',
    mods: { retriggerTop: 3 },
  },
  {
    id: 'alchemistStill', name: "Alchemist's Still", rarity: 'veryRare', price: 195,
    icon: 'icon_drop', tint: 0x58c0a8,
    desc: 'Every MODIFIED card that scores fires the still: ×1.1 mult each, compounding.',
    mods: { modCardFactor: 1.1 },
  },
  {
    // HALLOWED BOULDER — the hand stops choosing. Everyone takes 60%, the
    // target included: that IS the trade. With one enemy left there is nothing
    // to spread to, so it lands whole (see CombatScene.deliverStrike).
    id: 'shockwaveCore', name: 'Hallowed Boulder', rarity: 'veryRare', price: 220,
    icon: 'icon_fire', tint: 0xffb347,
    desc: 'Your damage stops picking a target: EVERY enemy takes 60% of it. Against one foe it lands whole. The boulder does not aim.',
    props: { aoeAll: 0.6 },
  },
  {
    // --- POISON RELIC, OPHELIA ONLY -----------------------------------------
    // Was 'Statuses you apply also strike all other enemies at 50% stacks'.
    // Same idol, same id, same storm-blue: it now spreads her poison WHOLE, and
    // because the stacks it copies are a fraction of her damage, it scales the
    // instant her damage does. In a three-body room it triples her venom.
    // heroBound: `poisonSpread` is only ever read from inside seepPoison, which
    // is only ever reached through Ophelia's conversion. Dead in any other hand.
    id: 'stormIdol', name: "Stormcaller's Idol", rarity: 'veryRare', hero: 'venomancer', heroBound: 1, price: 210,
    icon: 'icon_magic', tint: 0x5878e8,
    desc: 'Every point of Poison you apply lands on EVERY other enemy too, at full stacks.',
    props: { poisonSpread: 1 },
  },
  {
    id: 'wornAnvil', name: 'Worn Anvil', rarity: 'veryRare', price: 195,
    icon: 'icon_anvil', tint: 0xd07028,
    desc: "The anvil remembers. Your most-played hand is always among the Smith's offerings.",
    // Read at pack-open time by packs.js anvilForcedType(); the offered option
    // wears a WORN ANVIL badge so the guarantee is visible, not just felt.
    props: { anvilMemory: 1 },
  },
  {
    id: 'glassCannon', name: 'Glass Cannon', rarity: 'veryRare', price: 175,
    icon: 'icon_gem', tint: 0xff6a76,
    desc: 'All damage ×2. You lose 30 Max HP, immediately.',
    mods: { globalMultFactor: 2 },
    onAcquire(run) {
      run.player.maxHp = Math.max(10, run.player.maxHp - 30);
      run.player.hp = Math.min(run.player.hp, run.player.maxHp);
    },
  },

  // ============================ LEGENDARY ============================
  {
    id: 'suitPrism', name: 'Suit Prism', rarity: 'legendary', price: 330,
    icon: 'icon_gem', tint: 0xc080ff,
    desc: 'On pickup: choose two suits. Every card of the first becomes the second, for the whole run.',
    uncopyable: true,
    acquireUI: 'suitPrism',
    // The ceremony receipts every converted card id in state.prism; selling
    // pours the light back OUT of exactly those cards. Copies keep the new suit.
    onSell(run, inst) {
      const p = inst?.state?.prism;
      if (!p) return;
      const ids = new Set(p.ids);
      for (const c of run.runDeck) {
        if (ids.has(c.id) && c.suit === p.to) c.suit = p.from;
      }
    },
  },
  {
    id: 'theJoker', name: 'THE JOKER', rarity: 'legendary', price: 330,
    icon: 'icon_magic', tint: 0xd02868,
    desc: 'Adds the JOKER to your deck: wild suit, +20 value, and DOUBLES the hand mult when it scores.',
    uncopyable: true,
    onAcquire(run, inst) {
      const id = `joker-${run.runDeck.length}`;
      run.runDeck.push({ id, suit: 'clovers', rank: 14, mod: 'joker' });
      if (inst) inst.state.granted = [id];
    },
    onSell(run, inst) {
      const ids = new Set(inst?.state?.granted ?? []);
      for (let i = run.runDeck.length - 1; i >= 0; i--) {
        if (ids.has(run.runDeck[i].id)) run.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'crownHighRoller', name: 'Crown of the High Roller', rarity: 'legendary', price: 310,
    icon: 'icon_star', tint: 0xffc542,
    desc: 'If the FIRST hand of a fight is a lone ACE, that Ace is worth +10 value and a copy of it is crowned into your deck, forever.',
    props: { aceCrown: 1 },
    hooks: {
      // The scene owns the once-per-fight latch (_crownDone) so a mirrored
      // Crown still only ever forges ONE copy of the Ace.
      afterHand(scene, a, ctx) {
        if (scene._crownDone || scene.handsThisFight !== 1) return;
        const card = ctx.played?.[0]?.card;
        // AN ACE, NOT MERELY A RANK-14 CARD. A JOKER is rank 14 too (THE JOKER
        // relic and THE ORACLE'S FOOLISH NATURE both print one), and the crown
        // copies the played card WHOLESALE — so a lone JOKER used to mint
        // another JOKER, once per fight, for the rest of the run. Jokers
        // multiply the hand mult per scoring card, so three became five became
        // eight and the run stopped being a game. The crown forges Aces.
        if (ctx.played?.length !== 1 || card?.rank !== 14 || card?.mod === 'joker') return;
        scene._crownDone = true;
        scene.crownTheAce(ctx.played[0]);
      },
    },
  },
  {
    id: 'meteorSigil', name: 'Meteor Sigil', rarity: 'legendary', price: 350,
    icon: 'icon_fire', tint: 0xff7028,
    desc: 'Flush-or-better hands strike ALL enemies at full damage.',
    props: { aoeFlush: 1 },
  },
  {
    /**
     * SWAPPED WITH THE STOCK MARKET (0805), and NERFED on the way in. It used to
     * pay a small capped dividend after a fight, which is not what a 300-chip
     * legendary is for. It now holds the every-encounter engine: a tenth of your
     * purse every time you commit to a node, through run.enterMapNode, so fights,
     * elites, bosses, events, rests and the merchant all pay and no future room
     * type can forget to.
     *
     * THE CEILING IS THE PRICE OF THE PROMOTION. Uncapped, this compounded into
     * the only economy that mattered by the back half of Act II. Capped at
     * VAULT_INTEREST_CAP per payout it still pays forever, and still compounds,
     * but the doubling stops once your purse passes the cap's break-even.
     */
    id: 'bankersVault', name: "Banker's Vault", rarity: 'legendary', price: 300,
    icon: 'icon_coins', tint: 0xe8e8f0,
    desc: `Your chips earn ${Math.round(VAULT_INTEREST_RATE * 100)}% interest after every encounter, up to ${VAULT_INTEREST_CAP} chips per encounter. It compounds.`,
    props: { encounterInterest: VAULT_INTEREST_RATE, encounterInterestCap: VAULT_INTEREST_CAP },
    liveDesc(a) {
      const paid = a.state.paid ?? 0;
      return paid ? `Currently: ${paid} chips paid out in dividends` : 'Currently: no dividends yet';
    },
  },
  {
    /**
     * REWORKED 2026-08-01 into a SCALER (Echo Bell's pattern). The flat
     * '+5 mult per face card' was a fine turn-one number that never grew; the
     * crown now KEEPS what it crowns. Kings only — the J and the Q are not
     * kings, and the relic is called Kingmaker.
     *
     * SCORING kings, not merely played ones: a King that sat in the hand as a
     * kicker formed nothing and crowns nothing (the same rule Balatro uses and
     * the same rule scoring.js already applies to every other per-card relic).
     */
    id: 'kingmaker', name: 'Kingmaker', rarity: 'legendary', price: 330,
    icon: 'icon_star', tint: 0xd8b830,
    desc: 'Every King you play crowns it: this artifact gains +1 MULT, forever.',
    mods(a) { return { flatMult: a.state.crowns ?? 0 }; },
    hooks: {
      afterHand(scene, a, ctx) {
        const kings = countScoringRank(ctx.res, 13) * handActivations(ctx);
        if (kings > 0) bank(a, 'crowns', kings);
      },
    },
    liveDesc(a) {
      const c = a.state.crowns ?? 0;
      return `Currently: +${c} mult  (${c} King${c === 1 ? '' : 's'} crowned)`;
    },
  },
  {
    id: 'perpetualEngine', name: 'Perpetual Engine', rarity: 'legendary', price: 350,
    icon: 'icon_setting', tint: 0x88b0c8,
    desc: 'Your FIRST hand each fight resolves twice at full power.',
    props: { firstHandRepeat: 1 },
  },
  {
    id: 'plagueUrn', name: "Plaguebearer's Urn", rarity: 'legendary', price: 310,
    icon: 'icon_skull', tint: 0x48a038,
    desc: 'When a poisoned enemy dies, its poison leaps to ALL living enemies at full stacks.',
    hooks: {
      kill(scene, a, enemy) {
        const p = enemy.statuses.poison ?? 0;
        if (p <= 0) return;
        for (const other of scene.livingEnemies()) {
          other.statuses.poison = (other.statuses.poison ?? 0) + p;
          scene.floatText(other, `+${p} POISON`, '#6fdc7f');
        }
      },
    },
  },
  {
    id: 'chronosCoil', name: 'Chronos Coil', rarity: 'legendary', price: 330,
    icon: 'icon_hourglass', tint: 0x60c8d8,
    desc: 'Every 3rd hand you play each fight lands with ×3 mult.',
    props: { nthHandEvery: 3, nthHandFactor: 3 },
  },
  {
    id: 'allInVisor', name: 'All-In Visor', rarity: 'legendary', price: 310,
    icon: 'icon_dice', tint: 0xd04870,
    desc: 'Every hand: one card you played is DESTROYED forever. That hand strikes at ×3 mult and pays 30 chips.',
    props: { allIn: 1 },
  },

  {
    // The bench pays. Every ROULETTE card you DIDN'T play sits in the wheel's
    // pocket and pays ×1.25 — a leftover-bench engine like Court in Session,
    // but it only counts the cards that gamble. Multiplicative per card.
    id: 'riggedWheel', name: 'Rigged Wheel', rarity: 'legendary', price: 310,
    icon: 'icon_dice', tint: 0x2e8b57,
    desc: `×${RIGGED_WHEEL_FACTOR} mult for every ROULETTE card left in your hand when a hand scores. The wheel pays the ones who sit out.`,
    props: { riggedWheelFactor: RIGGED_WHEEL_FACTOR },
  },
  {
    // The vanish roll that eats an ethereal card simply never fires, however
    // many activations owe one. The relic keeps
    // the ghost in the deck, so the ×2 becomes permanent instead of rented.
    // SECOND CLAUSE (JC, 0803): the ghosts you did NOT play pay too, on the
    // Rigged Wheel's bench pattern and at the same rate. Held back, they haunt.
    id: 'voidcaller', name: 'Voidcaller', rarity: 'legendary', price: 300,
    icon: 'icon_magic', tint: 0x7fe0d0,
    desc: `ETHEREAL cards never vanish, and every ETHEREAL card left in your hand pays ×${ETHEREAL_BENCH_FACTOR} mult. The ones you keep back haunt for you.`,
    props: { voidcaller: 1, etherealBenchFactor: ETHEREAL_BENCH_FACTOR },
  },
  {
    /**
     * THE LATENT REPEATER — the third leg of the bench. Where the Rigged Wheel
     * and the Voidcaller decide WHICH held-back cards pay, this one decides HOW
     * OFTEN: every leftover effect fires twice instead of once.
     *
     * It writes mods.benchRepeat, the shared channel, so it never has to know
     * which bench relic it is doubling — it doubles all of them, including any
     * added later, and an ECHO seal on the held card stacks on top of it for the
     * stated ceiling of three triggers.
     */
    id: 'latentRepeater', name: 'Latent Repeater', rarity: 'legendary', price: 340,
    icon: 'icon_hourglass', tint: 0x7fe0d0,
    desc: `Every LEFTOVER effect in your hand triggers ${LATENT_BENCH_REPEAT === 2 ? 'TWICE' : `${LATENT_BENCH_REPEAT} TIMES`}. The cards you hold back work a second shift.`,
    mods: { benchRepeat: LATENT_BENCH_REPEAT },
  },

  {
    id: 'counterfeit', name: 'The Forgery', rarity: 'legendary', price: 350,
    icon: 'icon_refresh', tint: 0xff8c28,
    desc: 'A perfect forgery: copies the ability of the artifact to its RIGHT.',
  },
  {
    // ONE MORE PLAY. Not the mult — the OUTPUT: every point of damage, heal,
    // shield, status and chips the hand made, made again. run.collectMods reads
    // the printed ×2 as "+1 replay" onto mods.handRepeatAdd (0803-B §1.2:
    // replays are ADDITIVE now, so this beside the Sharpest Dagger is six plays
    // and not ten), and the equation's SCORE side climbs one activation at a
    // time in the repeat beat, so the total never lies.
    id: 'repeatingPocketwatch', name: 'Repeating Pocketwatch', rarity: 'legendary', price: 330,
    icon: 'icon_hourglass', tint: 0xd8c070,
    desc: '+1 REPLAY: your played hand happens one more time, and everything in it happens with it.',
    mods: { handRepeat: 2 },
  },

  // --- THE STRIKE RELICS ---------------------------------------------------
  // READ THIS BEFORE TOUCHING EITHER OF THEM (JC, 2026-08-01):
  // A STRIKE is the hand's DAMAGE landing again as a SEPARATE SEQUENTIAL HIT —
  // and nothing else. No second helping of shield, heal, status or chips.
  // Strike 1 resolves completely (damage number, kill, retarget) before strike
  // 2 goes out, so a big enough hand can delete one enemy and open the next.
  // The Repeating Pocketwatch above is the relic that repeats the WHOLE hand;
  // these two are pure violence, which is why they coexist with it (and
  // compound: hold both and the blow lands six times).
  {
    id: 'twinstrike', name: 'Duel-Wield Canes', rarity: 'legendary', price: 340,
    icon: 'icon_sword_small', tint: 0xffe08a,
    desc: 'Your hand STRIKES TWICE. The second blow is its own hit: if the first one kills, the second finds the next enemy.',
    props: { handStrikes: 2 },
  },
  {
    // THE OVERFLOWING CHALICE — overkill is not waste, it is momentum. It cascades: the
    // spill can kill the next body and roll straight on into the one after.
    id: 'overflowEdge', name: 'Overflowing Chalice', rarity: 'legendary', price: 340,
    icon: 'icon_sword_small', tint: 0xff9a3c,
    desc: 'It never stops pouring: damage that overkills SPILLS into the next living enemy, and keeps spilling until it is spent.',
    props: { overkillSpill: 1 },
  },

  // ========================= HERO EXCLUSIVE =========================
  // One per hero, each a run-defining rewrite of that hero's own rules. They
  // only ever appear for their owner (see eligibleFor / the roll paths below).
  {
    id: 'sharpestDagger', name: 'The Sharpest Dagger', rarity: 'heroExclusive',
    hero: 'highRoller', price: 260,
    icon: 'icon_sword_small', tint: 0xff5ce1,
    desc: 'A hand of ONE card gets +4 REPLAYS: it happens five times in all. Dextra only needs the one.',
    // Conditional on hand SIZE, so the scene applies it in buildScoreState. The
    // printed 5 is read as "+4 replays" and the extras SUM (0803-B §1.2), so a
    // mirrored Dagger is nine plays rather than twenty five.
    props: { oneCardRepeat: 5 },
  },
  {
    // REWRITTEN AGAIN 2026-08-04 (JC), into the Infinite Heart's exact shape.
    // 0803's +1% mult per Shield point turned the wall into a weapon and left
    // the Bull with no wall; the two exclusives are now DELIBERATE TWINS:
    //   Zelus — the mult multiplies his HEALING (which overflows into Zeal and
    //           comes back later as one enormous blow: sustain, then burst);
    //   Bull  — the mult multiplies his SHIELD (which MELTS at end of turn:
    //           one impenetrable turn, spent the moment it is over).
    // Same engine, opposite clocks. The melt is the price that keeps a
    // multiplied wall from simply banking to infinity, and it is the half JC
    // asked to keep by name.
    id: 'ancientShield', name: 'The Ancient Shield', rarity: 'heroExclusive',
    hero: 'bulwark', heroBound: 1, price: 260,
    icon: 'icon_shield', tint: 0xff5ce1,
    desc: 'The Shield your hands grant is multiplied by your MULT. All Shield melts at the end of every turn: the wall is a tide, not a bank.',
    mods: { shieldByMult: 1 },
    props: { shieldMelts: 1 },
  },
  {
    // REWRITTEN 2026-08-04 (JC): "healing can now be affected by mult", full
    // stop. The old trade — Zeal uncapped, Hearts dealing no damage — died
    // twice over: the uncap became everyone's baseline (see zealCapFor), and
    // the damage-off price meant the huge-Zeal turn it set up had no good hand
    // to land on, which for a hero who mostly plays Hearts was the whole relic
    // fighting itself. Now it is a pure engine: giant heals, overflow banks as
    // uncapped Zeal, and the next sword hand spends the lot.
    id: 'infiniteHeart', name: 'The Infinite Heart', rarity: 'heroExclusive',
    hero: 'zealot', heroBound: 1, price: 260,
    icon: 'icon_heart_small', tint: 0xff5ce1,
    desc: 'The Healing your hands grant is multiplied by your MULT. Overheal still banks as ZEAL, and ZEAL has no ceiling.',
    mods: { healByMult: 1 },
  },
  {
    // NOTHING IS CONVERTED (JC, 0803). The poison is ADDED ON TOP: the blow
    // lands in full, and the same number seeps into the body as venom. Her base
    // passive already works this way in the scene (damageEnemy deals `amount`
    // AND calls seepPoison with it); the copy used to imply a trade that was
    // never happening. props.poisonConvert is ADDITIVE on top of her base 0.5.
    // heroBound: pure `poisonConvert`, and poisonConversion() answers 0 for
    // anyone but Ophelia. A 260-chip relic that does nothing is not a taste.
    id: 'bottomlessVile', name: 'The Bottomless Vile', rarity: 'heroExclusive',
    hero: 'venomancer', heroBound: 1, price: 260,
    icon: 'icon_drop', tint: 0xff5ce1,
    desc: 'Every point of damage you deal ALSO seeps in as poison. Your Clubs still hit for everything they are worth, venom included.',
    props: { poisonConvert: 0.5 },
  },
  {
    /**
     * THE SOLID GOLD SACK — Drusky's, and the same idea as his passive read from
     * the other side of the equation. His pockets ADD (mods.chipMultAdd: +1 mult
     * per 100 chips); the sack MULTIPLIES (mods.chipMultFactor), so the pile
     * scales the FINISHED number instead of the starting one. At 1,000 chips
     * that is x10 on everything rather than +10 before everything.
     *
     * It writes a channel and nothing else, which is the point: neither the
     * hero nor the relic knows the other exists, and swapping which one is
     * additive is a one-line decision in scoring.js rather than a rewrite here.
     */
    id: 'solidGoldSack', name: 'Solid Gold Sack', rarity: 'heroExclusive',
    hero: 'hoarder', price: 260,
    icon: 'icon_coins', tint: 0xff5ce1,
    desc: `Your chips MULTIPLY the finished mult, ${HOARD_CHIP_STEP} to the x1. He was never saving for anything.`,
    mods: { chipMultFactor: 1 },
    liveDesc(a, run) {
      const chips = run?.chips ?? 0;
      // The engine floors this at x1 so a thin purse is neutral rather than a
      // penalty. Floor the tooltip the same way: it used to print the unfloored
      // number, so under 100 chips it promised x0.5 while the hand got x1.
      const f = Math.max(1, Math.round((chips / HOARD_CHIP_STEP) * 100) / 100);
      return `Currently: x${num(f)}  (${chips} chips)`;
    },
  },

  // ============================ MYTHICAL ============================
  {
    // THE GLOVE. It grants the sixth slot and — the whole point of the 2026-07-31
    // rework — takes NONE of them itself: `noSlot` keeps it out of slotsUsed and
    // `nook` keeps it out of the six-cell row entirely, so it renders in its own
    // stitched glove nook beside the mat. Six REAL relics, plus the glove.
    id: 'sixthFinger', name: 'The Sixth Finger', rarity: 'mythical', price: 0,
    icon: 'icon_magic', tint: 0xe03040,
    desc: 'You may hold a SIXTH artifact, and the glove wears no slot of its own. It always felt like something was missing.',
    uncopyable: true,
    props: { noSlot: 1, nook: 1 },
    onAcquire(run) { run.artifactSlots += 1; },
    // Exact inverse. The old Math.max(5, ...) encoded "slots never go below the
    // base 5" — an invariant THE ORACLE'S HUNTER broke the day it shipped
    // (it takes a slot), so buying the glove and selling it back refunded
    // Hunter's whole price and paid 203 chips for the privilege.
    onSell(run) { run.artifactSlots -= 1; },
  },
  {
    // ACTIVE. The bell does not ward — it STOPS. One toll cancels the target's
    // next action outright: attack, summon, buff, ward, morph, all of it. Bosses
    // included; that is the entire point of a mythical that only fires once.
    id: 'hushedBell', name: 'The Hushed Bell', rarity: 'mythical', price: 0,
    icon: 'icon_music_note', tint: 0xe03040,
    desc: 'ONCE PER FIGHT: toll the bell and your target is SILENCED, its next action cancelled entirely. Bosses are not exempt.',
    uncopyable: true,
    active: {
      label: 'TOLL', hint: 'Silence your current target',
      use(scene, a) { return scene.useHushedBell(a); },
    },
  },
  {
    // The Canes' big brother. Compounds with it: hold both and the blow
    // lands SIX times (2 × 3), the same way two Pocketwatches compound.
    id: 'threefoldFang', name: 'Chip of Tripling Down', rarity: 'mythical', price: 0,
    icon: 'icon_anvil', tint: 0xe03040,
    desc: 'Your hand STRIKES THREE TIMES. Three separate blows, each finding whoever is still standing. Damage only: the hand itself happens once.',
    props: { handStrikes: 3 },
  },
  {
    id: 'aurumHeart', name: 'Aurum Heart', rarity: 'mythical', price: 0,
    icon: 'icon_gem', tint: 0xe03040,
    desc: 'Every scoring card ALSO grants shield equal to half its value. Everything is armor.',
    props: { aurum: 0.5 },
  },
  {
    id: 'crackedCrown', name: 'The Cracked Crown', rarity: 'mythical', price: 0,
    icon: 'icon_coins', tint: 0xe03040,
    desc: `Gain ${CRACKED_CROWN_CHIPS} chips. That is all it does. It is VERY shiny.`,
    uncopyable: true,
    // IT REVOKES WHAT IT ACTUALLY PAID (0803-B). A relic whose whole effect is a
    // payout at pickup is a profit loop the moment it can also be sold, so the
    // grant is revoked like any other. It used to hand back the flat 500 while
    // gainGold had credited something else entirely — Sticky Gloves made the
    // crown pay 625 and give back 500, and MYTHRIL made it pay 375 and give back
    // 500. The NEGOTIATOR'S CERTIFICATION widens both mouths of that gap, so the
    // receipt is now exact: bank what was credited, revoke that.
    onAcquire(run, inst) {
      const paid = gainGold(CRACKED_CROWN_CHIPS, run);
      if (inst?.state) inst.state.paid = paid;
    },
    onSell(run, inst) {
      const owed = inst?.state?.paid ?? CRACKED_CROWN_CHIPS;
      run.chips = Math.max(0, run.chips - owed);
    },
  },
  {
    // The forge never cools: the FIRST hand of every fight is beaten one level
    // deeper, permanently, exactly as a Smith tempering would (run.handLevels).
    //
    // ONE TEMPERING PER HAND PLAYED, AND NEVER PER ACTIVATION (JC, 2026-08-04:
    // "it only applies to a full hand being played so activates once unless
    // copied by another artifact like the forgery"). handCommit is the right
    // hook for exactly that reason — it fires once when the hand is committed,
    // whatever the cards inside it do and however many times they repeat.
    //
    // A MIRROR DOES DOUBLE IT, which is the other half of JC's sentence. artHook
    // walks the EFFECTIVE row, one entry per copy, so a Forgery aimed at this
    // relic simply arrives here a second time. The old scene-wide latch
    // (_forgeEternalDone) collapsed those two visits into one; the guard is now
    // the hand count alone, so each copy tempers once.
    id: 'forgeEternal', name: 'The Forge Eternal', rarity: 'mythical', price: 0,
    icon: 'icon_fire', tint: 0xe03040,
    desc: 'The FIRST hand you play each fight is tempered on the eternal anvil: that hand type gains +1 LEVEL, permanently. Copy this relic and it strikes twice.',
    hooks: {
      handCommit(scene, a, ctx) {
        if (scene.handsThisFight !== 1) return;
        bank(a, 'tempered');
        scene.forgeEternalTemper(a, ctx.ev.type);
      },
    },
    liveDesc(a) {
      const t = a.state.tempered ?? 0;
      return `Currently: ${t} hand${t === 1 ? '' : 's'} tempered on the eternal anvil`;
    },
  },
  {
    // ONCE PER HAND MAXIMUM (JC, 0803). It used to pay +3 for every Ace on the
    // table, which made a pocket-Aces build print mult four at a time. It now
    // pays +3 for the HAND, however many Aces were in it. A hand that HAPPENS
    // again (the Pocketwatch, the Sharpest Dagger, the Wheel's retrigger wedge)
    // is another hand and fires it again: that is handActivations, and it is the
    // whole reason this relic is the named example in the 0803 audit.
    id: 'acesLegacy', name: "The Ace's Legacy", rarity: 'mythical', price: 0,
    icon: 'icon_star', tint: 0xe03040,
    desc: `Score an Ace and something is left behind: this artifact gains +${ACES_LEGACY_MULT} MULT, forever. Once per hand, however many Aces turned up. A hand that repeats counts again.`,
    mods(a) { return { flatMult: (a.state.aces ?? 0) * ACES_LEGACY_MULT }; },
    hooks: {
      afterHand(scene, a, ctx) {
        if (countScoringRank(ctx.res, 14) > 0) bank(a, 'aces', handActivations(ctx));
      },
    },
    liveDesc(a) {
      const n = a.state.aces ?? 0;
      return `Currently: +${n * ACES_LEGACY_MULT} mult  (${n} hand${n === 1 ? '' : 's'} with an Ace)`;
    },
  },
  {
    id: 'singularity', name: 'Singularity', rarity: 'mythical', price: 0,
    icon: 'icon_star', tint: 0xe03040,
    desc: 'Single-card hands strike with ×5 additional mult. One card. One point of impact.',
    props: { oneCardFactor: 5 },
  },
  {
    id: 'phantomCast', name: 'The Phantom Cast', rarity: 'mythical', price: 0,
    icon: 'icon_magic', tint: 0xe03040,
    desc: 'Copies the artifact to its LEFT, and occupies NO slot.',
    props: { noSlot: 1 },
  },
  {
    // Both sides of the equation, doubled. valueFactor scales everything the
    // hand OUTPUTS (the score side, shield, heal, poison, chips) and the ×2
    // globalMultFactor doubles the MULT on top — so damage lands at ×4. It is
    // a mythical; broken is the brief.
    id: 'forgeHammer', name: 'The Forge Hammer', rarity: 'mythical', price: 0,
    icon: 'icon_fire', tint: 0xe03040,
    desc: 'ALL scoring values ×2: value, mult, shield, healing, poison, everything the hand does.',
    mods: { valueFactor: 2, globalMultFactor: 2 },
  },
  {
    // ACTIVE. Five wedges, one spin, once per fight — and one of the five is a
    // card off your run deck FOREVER. You choose when to gamble; the wheel
    // chooses what it costs. Wedge order is the wheel's order (see WHEEL_OF_
    // DIVINITY_WEDGES) so the overlay and the outcome can never drift apart.
    id: 'wheelDivinity', name: 'Wheel of Divinity', rarity: 'mythical', price: 0,
    icon: 'icon_dice', tint: 0xe03040,
    desc: 'ONCE PER FIGHT, spin the wheel: +50 chips · +1 hand size this fight · ×2 mult next hand · every card retriggers next hand · or ONE random card in your hand is DESTROYED forever.',
    uncopyable: true,
    active: {
      label: 'SPIN', hint: 'Five wedges. One of them bites.',
      use(scene, a) { return scene.useWheelOfDivinity(a); },
    },
  },
];

/**
 * The Wheel of Divinity's face, in wheel order. Uniform odds (the spin picks an
 * index at random); `id` is what CombatScene.resolveDivinity switches on, and
 * `label`/`color` are what the wheelSpinOverlay paints.
 */
export const WHEEL_OF_DIVINITY_WEDGES = [
  { id: 'chips', label: '+50\nCHIPS', color: 0xd8a020 },
  { id: 'handSize', label: '+1 HAND\nSIZE', color: 0x3fa64b },
  { id: 'doubleMult', label: '×2 MULT\nNEXT HAND', color: 0xd04870 },
  { id: 'retrigger', label: 'ALL CARDS\nRETRIGGER', color: 0x4a7fd0 },
  { id: 'destroy', label: 'DESTROY\nA CARD', color: 0x8a1830 },
];

const BY_ID = Object.fromEntries(ARTIFACT_POOL.map(a => [a.id, a]));
export function artifactById(id) { return BY_ID[id]; }

/** Sum a numeric prop across owned artifact instances. */
export function getProp(artifacts, key) {
  let total = 0;
  for (const a of artifacts) total += a.props?.[key] ?? 0;
  return total;
}

function weightedPick(pool, weightOf, rng) {
  const total = pool.reduce((s, a) => s + weightOf(a), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const a of pool) { r -= weightOf(a); if (r <= 0) return a; }
  return pool[pool.length - 1];
}

/** Chance a shop stock roll smuggles in a Mythical (JC: ~1/100). */
const SHOP_MYTHIC_CHANCE = 0.01;
const SHOP_MYTHIC_PRICE = 560;

/**
 * Shop stock: `count` distinct rarity-weighted artifacts. Once in a hundred
 * restocks, a MYTHICAL appears on the mat (priced like a myth should be) —
 * Mythical defs have price 0, so shops read `shopPrice ?? price`.
 * `heroId` gates the HERO EXCLUSIVE tier; omit it and no exclusive can appear.
 * `actIndex` tilts the top four tiers (see actRarityFactor) and takes the
 * mythic sneak with it: 0.4% in Act I, the full 1% in Act IV.
 */
export function rollShopStock(ownedIds, count = 5, rng = Math.random, heroId = null, actIndex = null) {
  const picks = [];
  let pool = ARTIFACT_POOL.filter(a =>
    a.rarity !== 'mythical' && !ownedIds.includes(a.id) && eligibleFor(a, heroId));
  while (picks.length < count && pool.length) {
    const p = weightedPick(pool, a => rarityWeight(a.rarity, 'shopWeight', actIndex), rng);
    if (!p) break;
    picks.push(p);
    pool = pool.filter(a => a !== p);
  }
  if (picks.length && rng() < SHOP_MYTHIC_CHANCE * actRarityFactor(actIndex)) {
    const myth = rollMythical(ownedIds, rng, heroId);
    // A HERO EXCLUSIVE can ride in through the myth slot — it carries a real
    // price of its own, so it is sold (and sells back) at that, not at the
    // mythical basis Mythicals need because their defs price at 0.
    if (myth) {
      picks[Math.floor(rng() * picks.length)] =
        { ...myth, shopPrice: myth.price > 0 ? myth.price : SHOP_MYTHIC_PRICE };
    }
  }
  return picks;
}

/**
 * Elite drop: rarity roll (Hero Exclusive ~2%, Mythical ~0.6%), optionally
 * shifted up `rarityBoost` steps (Bounty Board — the boost still stops at
 * Legendary, so it can never manufacture an exclusive or a myth).
 *
 * The roll is act-scaled (see actRarityFactor); the BOOST is not, because it is
 * a promise the Bounty Board makes out loud.
 */
export function rollEliteDrop(ownedIds, rarityBoost = 0, rng = Math.random, heroId = null, actIndex = null) {
  const ok = a => !ownedIds.includes(a.id) && eligibleFor(a, heroId);
  const entries = RARITY_ORDER.map(r => ({ r, w: rarityWeight(r, 'eliteWeight', actIndex) }));
  let rarity = weightedPick(entries, e => e.w, rng).r;
  for (let i = 0; i < rarityBoost; i++) {
    const idx = RARITY_ORDER.indexOf(rarity);
    if (idx < RARITY_ORDER.indexOf('legendary')) rarity = RARITY_ORDER[idx + 1];
  }
  let pool = ARTIFACT_POOL.filter(a => a.rarity === rarity && ok(a));
  // Everything of that tier owned (or the tier belongs to another hero)?
  // cascade out to anything non-mythical this hero may hold.
  if (!pool.length) pool = ARTIFACT_POOL.filter(a => a.rarity !== 'mythical' && ok(a));
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * THE HUNTER'S CACHE tier table (JC, 2026-07-31): the act-boss bounty stopped
 * paying out "a random relic" and now pays a VERY RARE OR BETTER one. Weights
 * are on the TIER, not the shop/elite curve — a boss is a boss.
 *
 * NERFED to a very-rare floor (JC, 2026-08-02): the cache was handing out a
 * Legendary-or-better for every dead act boss, three times a run, which is most
 * of a build before Act III. It is NOT act-scaled: an advertised floor is a
 * promise, and this one is now a tier lower.
 */
export const CACHE_TIER_WEIGHTS = { veryRare: 50, legendary: 30, heroExclusive: 13, mythical: 7 };

/**
 * Roll one unowned relic from VERY RARE / LEGENDARY / HERO EXCLUSIVE / MYTHICAL
 * on the weights above, hero gating intact. If the whole top of the pool is
 * already yours it steps DOWN a tier at a time rather than fizzling — the
 * bounty always pays something.
 */
// Name kept (it is imported in four places) even though the floor moved down a
// tier on 2026-08-02: CACHE_TIER_WEIGHTS is the one source of truth for it.
export function rollLegendaryPlus(ownedIds, rng = Math.random, heroId = null) {
  const ok = a => !ownedIds.includes(a.id) && eligibleFor(a, heroId);
  const tiers = Object.entries(CACHE_TIER_WEIGHTS)
    .map(([r, w]) => ({ r, w, pool: ARTIFACT_POOL.filter(a => a.rarity === r && ok(a)) }))
    .filter(t => t.pool.length);
  if (tiers.length) {
    const pick = weightedPick(tiers, t => t.w, rng);
    return pick.pool[Math.floor(rng() * pick.pool.length)];
  }
  for (const r of ['rare', 'common']) {
    const pool = ARTIFACT_POOL.filter(a => a.rarity === r && ok(a));
    if (pool.length) return pool[Math.floor(rng() * pool.length)];
  }
  return null;
}

/**
 * A random unowned MYTHIC-tier reward (Forge pack Ember, the Crimson Forge,
 * the bounty wheel, the shop's 1/100 sneak). The hero's own EXCLUSIVE rides in
 * the same pool at HERO_FORGE_SHARE of the roll — the forge is the one place
 * an exclusive is likely rather than lucky. Falls through in both directions
 * when one side is exhausted.
 */
export function rollMythical(ownedIds, rng = Math.random, heroId = null) {
  // BOTH branches go through eligibleFor (2026-08-02). The mythical branch used
  // to have no gate at all and the exclusive branch open-coded the hero check,
  // which meant four of the five ACHIEVEMENT-GATED relics (all Mythicals) would
  // have leaked straight out of the Forge, the wheel and the shop's sneak. One
  // gate, consulted everywhere, is the whole point of having one.
  const ok = a => !ownedIds.includes(a.id) && eligibleFor(a, heroId);
  const myths = ARTIFACT_POOL.filter(a => a.rarity === 'mythical' && ok(a));
  const mine = ARTIFACT_POOL.filter(a =>
    a.rarity === 'heroExclusive' && !!heroId && ok(a));
  const takeExclusive = mine.length && (!myths.length || rng() < HERO_FORGE_SHARE);
  const pool = takeExclusive ? mine : myths;
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Clone a definition into an owned instance and apply immediate effects.
 * (acquireUI choices are handled by the acquiring scene BEFORE calling this.)
 */
export function acquireArtifact(run, def) {
  // Re-forged copies arrive carrying their source's grown state (Echo Bell
  // keeps its rung count); fresh defs have no state and start clean.
  const inst = { ...def, state: JSON.parse(JSON.stringify(def.state ?? {})) };
  run.artifacts.push(inst);
  // NOOK relics (The Sixth Finger) live off the row, so they are parked at the
  // END of the belt array and never inside it. That keeps beltArtifacts()'s
  // index == run.artifacts index for everything the six cells actually draw,
  // which is what the drag-reorder and the pulse cascade both look up by.
  sinkNookArtifacts(run);
  def.onAcquire?.(run, inst);
  return inst;
}

/** Move every nook relic to the end of the belt array, order otherwise kept. */
export function sinkNookArtifacts(run) {
  const row = run.artifacts.filter(a => !a.props?.nook);
  if (row.length === run.artifacts.length) return run.artifacts;
  run.artifacts = [...row, ...run.artifacts.filter(a => a.props?.nook)];
  return run.artifacts;
}
