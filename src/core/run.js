/**
 * The RUN — all state that survives between scenes (Map ↔ Combat ↔ overlays).
 * One live run at a time; newRun() resets it. Pure data + tiny helpers, no Phaser.
 *
 * Map owns WHERE you are; Combat owns one encounter and writes results back here.
 */

import { CHARACTERS, HOARD_MULT_PER_STEP, PLAYER_BASE, SUIT_GLYPH } from '../config.js';
import {
  ACTS, actEntry, actVariants, rollActVariant, rollBoss,
  ENDLESS_START_INDEX, endlessLabel, endlessLoop, isEndlessIndex,
} from './acts.js';
import { makeDeck, rankLabel } from './deck.js';
import { generateMap, assignEliteEncounters, enterNode, forceMythicNode } from './map.js';
import { HAND_TYPES } from './poker.js';
import { DEFAULT_DIFFICULTY, difficultyAt, difficultyIndex, goldFactor } from './difficulty.js';
import { progress, recordRunStart } from './progress.js';
import { resetRunUnlocks } from './unlocks.js';
import { installRunRng, normalizeSeed, streamFor, uninstallRunRng } from './rng.js';
import { devMult } from './settings.js';

export const run = {
  active: false,
  chrId: null,
  difficulty: DEFAULT_DIFFICULTY,   // index into DIFFICULTIES; plain number, saves for free
  actIndex: 0,
  totalActs: 3,
  // ENDLESS (2026-08-05). Set TRUE only by taking the DESCEND INTO THE ENDLESS
  // offer on an Act IV clear, and never at run start — the endless is a
  // continuation of a won run, not a mode you pick. Once it is on, `actIndex`
  // keeps counting past `totalActs - 1` forever and core/acts.js cycles the
  // worlds under it. Plain boolean, so the save carries it the moment it joins
  // save.PLAIN_FIELDS (it has).
  endless: false,
  player: null,          // { hp, maxHp, shield, zeal, handSize }
  runDeck: [],           // the persistent deck — packs/upgrades/events mutate THIS
  chips: 0,
  artifacts: [],         // owned artifact objects (each gets its own state:{})
  artifactSlots: 5,      // mythical relics can raise this
  potions: [],           // belt of held potion instances (max MAX_POTIONS)
  handLevels: {},        // handType -> level (Smith packs); +levelStep mult per level
  discardsPerFightBonus: 0,
  startShield: 0,
  map: null,             // { nodes, currentId, bossPick, ... } from newActMap()
  bossPicks: {},         // actIndex -> boss entry id (kept after the act ends)
  // ALTERNATE ACTS (2026-08-03): actIndex -> which WORLD this run drew for that
  // act ('verdant' or 'nocturnal', 'frozen' or 'ethereal', 'abyss' or
  // 'gallows'). Rolled ONCE, in newRun, for the whole run — see rollActPicks.
  actPicks: {},
  // SEEDED RUNS (2026-08-04): the seed the player typed, or null. When set, the
  // run's STRUCTURE (world rolls, maps, bosses, elites) comes off per-context
  // streams and Math.random itself is swapped for the run — and NO trophies or
  // difficulty-ladder clears are recorded (see achievements.noteEvent).
  seed: null,
  debugEncounter: null,  // DEV one-shot: enemy-def ids to field in the next fight
  counters: {
    shopRemovals: 0,     // card-removal service price ramps (REMOVAL_PRICES)
    packsBought: 0,      // merchant booster-pack price ramps (BOOSTER_PRICES)
    fights: 0,
    elites: 0,
    handsPlayed: 0,
    // THE TROPHY COUNTERS (2026-08-02). Three tallies nothing else needed, each
    // banked at the ONE site that already knows the thing happened, so no hot
    // path grew a line for a trophy's sake.
    shopBuys: 0,       // purchases at THIS merchant visit; reset when his tent opens
    relicsSold: 0,     // relics sold back this run (sellArtifact, the only door)
    reorders: 0,       // times the relic row was actually rearranged this run
  },
  stats: null,           // the run-recap ledger — see freshStats()
  bountiesClaimed: [],   // act indices whose BOUNTY HUNTER pack has been opened
  pendingShopVisit: false, // THE MERCHANT bounty, booked mid-ceremony: the next
                           // map opens his tent once on arrival, free.
  pendingHatch: [],      // THE EGG(S) that came due this fight — see queueHatch()
  pending: {             // one-shot effects queued for the NEXT fight (events/witch)
    poisonSelf: 0,
    shield: 0,
    enemyPoison: 0,
  },
  bonusMods: {           // run-level scoring mods from non-artifact sources (The Dealer)
    suitValue: {},
  },
  // THE ORACLE (2026-08-03) — see core/oracle.js. Three fields, all plain data:
  //   pendingOracle  the run still OWES its start-of-run choice (survives a save)
  //   oracle         the option id that was taken, once one has been
  //   oracleMods     the CHANNELS the seven permanent modifiers write (below)
  pendingOracle: false,
  oracle: null,
  oracleMods: freshOracleMods(),
};

/**
 * THE ORACLE'S CHANNELS.
 *
 * Seven of the twenty Oracle options are permanent RUN MODIFIERS rather than
 * one-shot grants, and the whole point of this bag is that NOTHING anywhere in
 * the game asks which option was taken. The Oracle writes a NAMED CHANNEL here
 * once, at pick time, and each channel is then read at exactly ONE place: the
 * place the relevant system was already asking its own question.
 *
 *   handsPerFight          CombatScene.handLimit          (Sacrificial, Handy)
 *   shopPriceFactor        run.shopPrice                  (Negotiator, Collector)
 *   shopExtraStock         MapScene.renderStock           (Collector)
 *   recyclePlayed          oracle.stowPlayedCard          (Recycler)
 *   etherealNeverVanishes  oracle.etherealVanishChance    (Spiritual)
 *   culturedRelics         artifacts.eligibleFor          (Cultured)
 *   hunterPacks            packs.rollPackOffer            (Hunter)
 *   forgeOwed              run.newActMap / oracle.pay...  (Blacksmith)
 *
 * It lives HERE rather than in oracle.js so the module graph stays one-way:
 * oracle.js imports run.js, artifacts.js and potions.js, and none of them may
 * import oracle.js back. Plain numbers throughout, so the save carries it for
 * free the moment `oracleMods` joins PLAIN_FIELDS.
 */
export function freshOracleMods() {
  return {
    handsPerFight: 0,
    shopPriceFactor: 1,
    shopExtraStock: 0,
    recyclePlayed: 0,
    etherealNeverVanishes: 0,
    culturedRelics: 0,
    hunterPacks: 0,
    forgeOwed: 0,
  };
}

/**
 * THE HAND-COUNT FLOOR, the clock's twin of HAND_SIZE_FLOOR. However many hands
 * the mode allows and however many the Oracle takes away, a fight always gives
 * you at least one swing. MYTHRIL's 7 minus Sacrificial's 1 is 6, so this is a
 * guard rather than a live constraint today; it exists so it cannot become one.
 */
export const HAND_COUNT_FLOOR = 1;

/**
 * The per-fight hand clock: the MODE's allowance plus the Oracle's channel,
 * floored. The single source CombatScene.handLimit reads.
 */
export function handsPerFight(r = run) {
  return Math.max(HAND_COUNT_FLOOR, difficultyAt(r?.difficulty).hands + (r?.oracleMods?.handsPerFight ?? 0));
}

/**
 * THE MERCHANT'S TILL. Every price on his table goes through here, which is
 * what makes THE NEGOTIATOR (x0.9) and THE COLLECTOR (x1.25) two numbers rather
 * than two dozen edits: the relics on the mat, the bottles beside them, the
 * removal ladder, the booster ladder and the restock dig all quote it.
 *
 * Deliberately not the sell-back price (sellValue has its own fraction) and
 * deliberately not anything you EARN — gainGold is the other funnel and the two
 * never meet. Floored at 1: a discount must never make a thing free.
 */
export function shopPrice(base, r = run) {
  const factor = r?.oracleMods?.shopPriceFactor ?? 1;
  if (factor === 1) return base;
  return Math.max(1, Math.round(base * factor));
}

/**
 * A fresh act map WITH its boss already drawn. The pick lives on the map
 * (`map.bossPick`) so it survives every Map↔Combat scene restart, and is
 * mirrored into `run.bossPicks` so a later act can still name the boss it
 * killed (the bounty header does exactly that).
 *
 * THE ELITES ARE DRAWN HERE TOO, and for the same reason: which group stands in
 * each elite room (without replacement, no repeats within an act) and which of
 * them are FORGED are both decided once, now, and written onto the nodes. The
 * map is a PLAIN_FIELD in the save, so a scene restart and a quit-and-resume
 * both hand back the exact board that was painted.
 */
/**
 * WHICH WORLD THIS RUN DREW, rolled ONCE for every act at the moment the run
 * begins, and stored on the run.
 *
 * IT MUST BE DECIDED ONCE, AND IT MUST LIVE HERE. Phaser scenes are singletons
 * and MapScene restarts constantly (every fight, every overlay, every BACK TO
 * THE TRAIL), so anything rolled inside a scene is re-rolled on every restart —
 * that trap has bitten this project repeatedly and it is exactly why
 * `map.bossPick` lives on the map instead of in MapScene. `actPicks` is one step
 * further out because a WORLD outlives its board: Act III's world has to be
 * settled while you are still standing in Act I, or advanceAct would silently
 * re-roll it. It is plain data, so the save carries it for free the moment
 * `actPicks` joins save.PLAIN_FIELDS (it has).
 */
export function rollActPicks(rng = Math.random, r = run) {
  r.actPicks = {};
  for (let i = 0; i < ACTS.length; i++) r.actPicks[i] = rollActVariant(i, rng);
  return r.actPicks;
}

/**
 * THE ENDLESS CANNOT PRE-ROLL ITS WORLDS — there is no end to pre-roll to. So
 * every act index past the fourth draws its world the first time a board is
 * built for it, through the SAME gate a run-start roll goes through
 * (rollActVariant -> rollableVariants), which is what keeps the Nocturnal
 * Forest on its normal 50/50 every lap instead of pinning the primary forever.
 *
 * Idempotent by construction: once an index has a pick it keeps it, so a scene
 * restart, a dev re-board and a save/resume all resolve the same world.
 */
export function ensureActPick(actIndex, rng = Math.random, r = run) {
  r.actPicks ??= {};
  if (r.actPicks[actIndex] === undefined) r.actPicks[actIndex] = rollActVariant(actIndex, rng);
  return r.actPicks[actIndex];
}

/**
 * The act OBJECT for an index, resolved through this run's world roll. This is
 * the function every scene, every save and every encounter roll asks — nothing
 * outside acts.js should index ACTS directly any more, because ACTS[i] is now
 * only HALF the answer.
 */
export function actOf(actIndex = run.actIndex, r = run) {
  return actEntry(actIndex, r?.actPicks?.[actIndex]);
}

/** The world the run is standing in right now. */
export function currentAct(r = run) {
  return actOf(r?.actIndex ?? 0, r);
}

/** Pin one act's world (dev/verification hook). Returns the resolved act. */
export function setActPick(actIndex, id, r = run) {
  r.actPicks ??= {};
  if (actVariants(actIndex).some(a => a.id === id)) r.actPicks[actIndex] = id;
  return actOf(actIndex, r);
}

export function newActMap(actIndex, rng = null) {
  // Seeded: each act's board is a pure function of (seed, actIndex) — a
  // save/reload, an ambience particle, nothing can move it. An explicit rng
  // (tests, dev hooks) still wins.
  rng ??= run.seed ? streamFor(run.seed, 'map', actIndex) : Math.random;
  // ENDLESS: the world for this index may never have been rolled (rollActPicks
  // only ever covers the four ordinary acts). Drawn off its own stream so a
  // seeded endless run is still a pure function of (seed, actIndex).
  if (isEndlessIndex(actIndex)) {
    ensureActPick(actIndex, run.seed ? streamFor(run.seed, 'acts', actIndex) : Math.random);
  }
  const act = actOf(actIndex);
  const map = generateMap(actIndex, rng);
  // THE BLACKSMITH'S PROMISE. The Oracle can owe a run one CRIMSON FORGE, and
  // this is the one line in the game that builds a board — so the debt is paid
  // by the first board that can host the red node, in whatever act that turns
  // out to be ("any act", per the spec). forceMythicNode is a no-op on a board
  // that rolled one anyway, so the promise is kept without ever paying twice.
  if (run.oracleMods?.forgeOwed && forceMythicNode(map, rng)) run.oracleMods.forgeOwed = 0;
  map.bossPick = rollBoss(act, rng).id;
  assignEliteEncounters(map, act?.pools?.elite?.length ?? 0, { rng, difficulty: run.difficulty });
  run.bossPicks ??= {};
  run.bossPicks[actIndex] = map.bossPick;
  return map;
}

// ---------------------------------------------------------------------------
// THE RUN RECAP LEDGER
// Every field below is written by CombatScene as the run happens and read
// exactly once, on the end screen. It lives on the RUN (not the scene) so the
// Map ↔ Combat scene churn can never lose it, and newRun() rebuilds it from
// scratch so a second run never inherits the first one's boasts.
// ---------------------------------------------------------------------------

export function freshStats(now = Date.now()) {
  return {
    startedAt: now,
    handTypeCounts: {},   // 'Two Pair' -> times played
    cardPlays: {},        // 'K of Diamonds' -> times played
    // THE KILL LEDGER (2026-08-01): enemy DEF ID -> how many of them this run
    // has put down. Written by CombatScene.killEnemy from fight one, which is
    // what makes the Wolfsbane Charm retroactive for free — the counter was
    // already running long before you picked the charm up.
    kills: {},
    // THE SAME LEDGER, BY CREATURE KIND (2026-08-02): enemy def `death` category
    // -> corpses. 'beast' is the game's word for an ANIMAL (wolves, boars,
    // hawks, yetis, mammoths, crows), beside 'humanoid', 'creature', 'large' and
    // 'keeper'. It is written at the same site as `kills`, so the Duck of Doom
    // counts animals killed long before you found it — the Wolfsbane Charm's
    // retroactivity, without artifacts.js having to import the bestiary (that
    // edge would close an import cycle through acts.js at module-eval time).
    killsByKind: {},
    maxHandDamage: 0,     // best single hand, as ACTUALLY DEALT (see noteHandStats)
    // ...and WHICH HAND did it: the display name ('Four of a Kind'), written by
    // the same line that raises maxHandDamage so the two can never drift. The
    // LIFETIME record keeps this beside the number, because "4.2M" on its own
    // is a number and "4.2M — VANESSA, Straight Flush" is a story.
    maxHandDamageHand: '',
    maxHandShield: 0,     // best single hand's shield gain, post-Aegis
    maxPoisonStack: 0,    // tallest stack any one enemy ever carried
    discardsUsed: 0,
    reachedAct: 0,        // furthest act index the run entered a room in
    reachedFloor: 0,      // furthest floor (1-based) within reachedAct
    reachedBoss: false,   // ...and that furthest room was the act's boss
    cleared: false,       // the run was WON
    // THE ENDLESS LEDGER (2026-08-05). `endlessDepth` counts endless acts
    // actually CLEARED (0 on every run that never took the offer), and is what
    // the lifetime shelf folds as a maximum.
    //
    // TWO LABELS, BECAUSE THERE ARE TWO PLACES. `endlessLabel` names the
    // deepest act REACHED ("Loop 2 · Act III") and is what the end screen and
    // the recap's Reached row print — where you were standing when it ended.
    // `endlessDepthLabel` names the deepest act CLEARED, and is the one that
    // travels onto the lifetime shelf beside `endlessDepth`. They differ by
    // one act on every run that dies past its last clear, which is most of
    // them, and folding the wrong one printed the act you died in underneath a
    // record that counts the acts you finished.
    endlessDepth: 0,
    endlessLabel: '',
    endlessDepthLabel: '',
    // THE TROPHY RECEIPTS (2026-08-02). Each is written once, at the moment the
    // thing happens, and read by a 'state' predicate later. Declared here rather
    // than sprung onto stats from a scene so a save round trips them.
    hatched: false,       // an egg cracked (artifacts.hatchEgg)
    ghosted: false,       // an Ethereal card vanished on you
    // IMMACULATE: has anything scuffed the current act? Set true the moment a
    // fight ends having cost a single point of HP; cleared when an act begins.
    // Starts FALSE, which is the honest answer for an act you have not fought.
    actScuffed: false,
  };
}

/**
 * "K of Diamonds". The suit's display name is read out of config AT CALL TIME,
 * so renaming a suit renames it in the recap too — nothing here hardcodes it.
 */
export function cardKey(card) {
  const glyph = SUIT_GLYPH[card?.suit] ?? String(card?.suit ?? '?').toUpperCase();
  const pretty = glyph.charAt(0) + glyph.slice(1).toLowerCase();
  return `${rankLabel(card.rank)} of ${pretty}`;
}

/**
 * The mode of a tally: { key, count }, or null when nothing was ever counted.
 * Ties break on insertion order — whoever got there first keeps the crown.
 */
export function topEntry(counts) {
  let best = null;
  for (const [key, count] of Object.entries(counts ?? {})) {
    if (!best || count > best.count) best = { key, count };
  }
  return best;
}

/** "12m 34s". Sub-minute runs drop to plain seconds; long ones grow an hours leg. */
export function fmtDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * One more body on the ledger. Safe on a run whose stats were never built.
 * @param {string} defId  the enemy DEF id (wolfCub, iceMage...)
 * @param {?string} kind  the def's `death` category ('beast' = an animal). Old
 *                        saves have no killsByKind at all, hence the ??=.
 */
export function noteKill(defId, r = run, kind = null) {
  const st = r.stats;
  if (!st || !defId) return null;
  st.kills ??= {};
  st.kills[defId] = (st.kills[defId] ?? 0) + 1;
  if (kind) {
    st.killsByKind ??= {};
    st.killsByKind[kind] = (st.killsByKind[kind] ?? 0) + 1;
  }
  return st.kills[defId];
}

/** How many of one creature KIND this run has put down (the Duck of Doom). */
export function killsOfKind(kind, r = run) {
  return r?.stats?.killsByKind?.[kind] ?? 0;
}

/**
 * High-water mark of how far the run got. Monotonic on purpose: dying two
 * floors back from your deepest push must not shrink the number you reached.
 */
export function noteReached(actIndex, floor, isBoss = false, r = run) {
  const st = r.stats;
  if (!st) return null;
  if (actIndex > st.reachedAct || (actIndex === st.reachedAct && floor > st.reachedFloor)) {
    st.reachedAct = actIndex;
    st.reachedFloor = floor;
    st.reachedBoss = !!isBoss;
  } else if (actIndex === st.reachedAct && floor === st.reachedFloor && isBoss) {
    st.reachedBoss = true;
  }
  // THE ENDLESS DEPTH LABEL rides the high-water mark rather than being written
  // at every ceremony, so it can only ever name the deepest act reached.
  if (isEndlessIndex(st.reachedAct)) st.endlessLabel = endlessLabel(st.reachedAct);
  return st;
}

/**
 * How many endless acts this run has CLEARED. The ceremony banks it, so it is
 * one behind the index you are standing in: clearing the boss at index 4 (the
 * first endless act) makes this 1.
 */
export function noteEndlessClear(actIndex, r = run) {
  const st = r.stats;
  if (!st || !isEndlessIndex(actIndex)) return 0;
  const cleared = actIndex - ENDLESS_START_INDEX + 1;
  if (cleared > (st.endlessDepth ?? 0)) {
    st.endlessDepth = cleared;
    // The label for the act that was just BEATEN, stamped at the moment it is
    // beaten. See freshStats: this is the one the lifetime shelf folds.
    st.endlessDepthLabel = endlessLabel(actIndex);
  }
  return st.endlessDepth;
}

/** "Act II · Floor 7" / "Act III · THE BOSS" / "CRUCIBLE · CLEARED". */
export function reachedLabel(r = run) {
  const st = r.stats;
  if (!st) return 'THE RUN';
  const act = actOf(st.reachedAct, r);
  // THE ENDLESS ANSWERS FIRST, and it answers even on a run whose `cleared`
  // flag is true — an endless run has ALREADY beaten the game, so "CRUCIBLE ·
  // CLEARED" would be the least interesting true thing we could print.
  if (isEndlessIndex(st.reachedAct)) {
    return `ENDLESS · Loop ${endlessLoop(st.reachedAct)} · Act ${act?.numeral ?? '?'}`
      + ` · Floor ${st.reachedFloor}`;
  }
  if (st.cleared) return `${(act?.name ?? 'THE RUN').toUpperCase()} · CLEARED`;
  if (!act) return `Floor ${st.reachedFloor}`;
  return st.reachedBoss
    ? `Act ${act.numeral} · THE BOSS`
    : `Act ${act.numeral} · Floor ${st.reachedFloor}`;
}

/**
 * @param {string} characterId
 * @param {number} difficultyIndex  index into DIFFICULTIES (0 = BRONZE)
 *
 * The mode is stored as a PLAIN NUMBER on the run, never a def reference: the
 * save system JSONs the run wholesale and an index round trips for free.
 * Everything that needs the actual modifiers looks it up through difficultyOf().
 */
export function newRun(characterId, difficultyIndex_ = DEFAULT_DIFFICULTY, seed = null) {
  // THE TALLY. `recordRunStart` has existed since the first RECORDS shelf and
  // had NO caller: "Runs attempted" read 0 forever, on every profile, however
  // much of the game you had played. This is the one place a run comes into
  // existence, so it is the one place the counter can honestly tick.
  recordRunStart();
  // THE SEED, first: everything rolled below has to see it. A run started
  // WITHOUT one also has to put the house dice back, or a seeded run's swap
  // would leak into the next.
  run.seed = normalizeSeed(seed);
  if (run.seed) installRunRng(run.seed, 'start');
  else uninstallRunRng();
  run.active = true;
  run.chrId = characterId;
  run.difficulty = difficultyIndex(difficultyIndex_);
  const mode = difficultyAt(run.difficulty);
  // THE UNLOCK LEDGER, WIPED. The end screen lists what THIS run opened, so a
  // second run must not inherit the first one's news (see core/unlocks.js).
  resetRunUnlocks();
  run.actIndex = 0;
  run.totalActs = progress.act4Unlocked ? 4 : 3;
  // NEVER INHERITED. `run` is a module singleton and the endless is a state a
  // previous run entered, not a setting — a new run always starts finite.
  run.endless = false;
  run.player = {
    hp: PLAYER_BASE.maxHp, maxHp: PLAYER_BASE.maxHp,
    shield: 0, zeal: 0,
    // Hand size is the mode's ABSOLUTE number (8 everywhere but MYTHRIL's 7).
    // Relics that grant +1 hand size add on top of it, exactly as they always did.
    handSize: mode.handSize,
  };
  run.runDeck = makeDeck();
  run.chips = 0;
  run.artifacts = [];
  run.artifactSlots = 5;
  run.potions = [];
  run.handLevels = Object.fromEntries(HAND_TYPES.map(t => [t, 0]));
  run.discardsPerFightBonus = 0;
  run.startShield = 0;
  run.counters = {
    shopRemovals: 0, packsBought: 0, fights: 0, elites: 0, handsPlayed: 0,
    shopBuys: 0, relicsSold: 0, reorders: 0,
  };
  run.stats = freshStats();
  run.pending = { poisonSelf: 0, shield: 0, enemyPoison: 0 };
  run.bonusMods = { suitValue: {} };
  run.bountiesClaimed = [];
  run.pendingShopVisit = false;
  run.pendingHatch = [];
  run.seenEvents = [];
  run.bossPicks = {};
  // THE WORLDS THIS RUN WILL WALK, all of them, decided now and never again.
  // It has to happen BEFORE the first board is built, because newActMap reads
  // the resolved act for its boss roll and its elite bag.
  // Seeded: the WORLD rolls come off their own stream, immune to whatever else
  // has drawn from Math.random by now.
  rollActPicks(run.seed ? streamFor(run.seed, 'acts') : Math.random);
  run.debugEncounter = null;
  // THE FIGHT CHECKPOINT, WIPED. `run` is a module singleton and SAVE & QUIT
  // taken mid-fight deliberately does NOT rewrite the save (settingsMenu), so
  // the checkpoint from the abandoned fight is still standing in memory when
  // the Title starts a brand new run. Node ids are act-independent ('4-2',
  // 'boss'), so it always matches a node on the new board — and the new run's
  // very first autosave would write it to disk, sending a later CONTINUE
  // straight into Act III's boss line-up on Act I's opening floor. Every other
  // PLAIN_FIELD is rebuilt above; this one was the only one that was not.
  run.pendingFight = null;
  // THE ORACLE is OWED from the moment the run exists. It is paid on arrival at
  // the first map (MapScene.checkOracle), which is one beat after the difficulty
  // pick — and because it is run state, a quit taken before the choice comes
  // back still owing it.
  run.pendingOracle = true;
  run.oracle = null;
  run.oracleMods = freshOracleMods();
  run.map = newActMap(run.actIndex);
  return run;
}

// ---------------------------------------------------------------------------
// Merchant price ladders — both climb PER RUN (not per shop visit), so the
// merchant's services stay a real decision instead of an infinite chip sink.
// Indexed by the matching run.counters value, clamped at the last rung.
// ---------------------------------------------------------------------------

// Both ladders took the 2026-08-02 +25% price pass, rounded to numbers the
// merchant would say out loud. The SHAPE of each climb is unchanged.
/** Card removal: brutal after the first handful — thinning is the strongest buy. */
export const REMOVAL_PRICES = [95, 125, 160, 225, 290, 375, 500, 625, 1250, 2500, 6250];
/** Booster packs: a gentler climb; they're a repeatable but softening reward. */
export const BOOSTER_PRICES = [110, 140, 170, 205, 250, 300, 355, 420, 500, 590];

const rung = (ladder, n) => ladder[Math.min(Math.max(n | 0, 0), ladder.length - 1)];

export function removalPrice(r = run) { return shopPrice(rung(REMOVAL_PRICES, r.counters?.shopRemovals ?? 0), r); }
export function boosterPrice(r = run) { return shopPrice(rung(BOOSTER_PRICES, r.counters?.packsBought ?? 0), r); }

/**
 * THE GOLD FUNNEL (JC, 2026-08-01).
 *
 * Every chip the player RECEIVES goes through here: kill drops, a hand's own
 * chips, relic interest, pack payouts, event purses, the merchant's refunds.
 * SPENDING deliberately does not — a cost is a cost, and the dev slider must
 * never quietly make the shop cheaper.
 *
 * It exists so the DEV GOLD slider has one place to land instead of thirty, and
 * so the economy relics ("+X% chips from everything") have somewhere to go.
 * Returns the amount actually credited, which is what the callers that read
 * back their own payout expect.
 */
export function gainGold(amount, r = run) {
  // The DIFFICULTY gold factor lands here and nowhere else, beside the relic
  // multiplier and the dev slider — which is the whole reason this funnel
  // exists. STEEL and up pay less for everything you EARN; nothing you BUY
  // gets cheaper, because spending deliberately never routes through here.
  const paid = Math.round(amount * goldFactor(r) * chipGainFactor(r) * devMult('devGold'));
  r.chips += paid;
  return paid;
}

/**
 * THE CHIP MULTIPLIER: Sticky Gloves (+25%) and the Chip Purse (+15%), summed
 * across every effective relic so mirrors count twice. It rides gainGold rather
 * than any one payout, which is the whole point — the victory purse, a hand's
 * own chips, interest, packs, events and the wheel all pay more, and a cost
 * never gets cheaper (spending deliberately does not route through here).
 *
 * Deliberately does NOT import getProp from artifacts.js: artifacts.js already
 * imports gainGold from this file, and one direction of that cycle is enough.
 */
export function chipGainFactor(r = run) {
  return 1 + effectiveArtifacts(r).reduce((s, a) => s + (a.props?.chipGain ?? 0), 0);
}

/**
 * THE VICTORY PURSE'S RATE — what ONE hand you never had to play is worth.
 *
 * A won fight pays this per hand still on the clock, so the purse rewards
 * finishing rooms rather than loitering in them. 15 -> 10 (JC, 2026-08-02 nerf
 * pass): it was outrunning the shop even after the +25% price pass.
 *
 * Lives HERE rather than in CombatScene so the ORDER below is testable in node.
 */
export const CHIPS_PER_HAND_LEFT = 10;

/**
 * ...and the order the two bonuses land in (0803-B §1.5).
 *
 * RELICS RAISE THE RATE; THE HERO MULTIPLIES WHAT THEY LEFT. The Handy Pouch's
 * +10 takes 10 to 20, and Drusky's +50% is applied to THAT, at the very end of
 * the payout, so he sees 30 — not 25, which is what he would see if his share
 * were computed off the base and added alongside the relic's.
 *
 * @param {number} relicBonus  props.handsChipBonus, summed across the belt
 * @param {number} heroPct     the hero's share, as a fraction (Drusky: 0.5)
 */
export function leftoverHandChips(relicBonus = 0, heroPct = 0) {
  return Math.round((CHIPS_PER_HAND_LEFT + relicBonus) * (1 + heroPct));
}

/**
 * THE PER-ENCOUNTER DIVIDEND (the Banker's Vault since the 0805 swap; it was the
 * Stock Market's from 0803-B until then).
 *
 * An encounter is defined as the thing the map already models: a node you commit
 * to. Fights, elites, bosses, events, rests and the merchant are all nodes, so
 * all six pay, and nothing new has to remember to call anything.
 *
 * PAID PER RELIC, NOT OFF A SUMMED RATE, because the CEILING is per relic:
 * `props.encounterInterestCap` caps what ONE holder can pay out in one tick, so
 * two interest relics with different ceilings each earn their own and neither
 * one's cap swallows the other's. A Forgery aimed at the Vault is a second
 * instance and therefore genuinely a second dividend, cap and all. A relic with
 * no cap prop is uncapped, which is what makes this safe to add to.
 *
 * It pays through gainGold, so the difficulty's gold factor and the chip-gain
 * relics apply exactly as they did at the shop door, and the base is read
 * BEFORE the payout lands, so interest never earns interest inside one tick.
 * Returns what was credited, which is what the map needs in order to say so.
 */
export function payEncounterInterest(r = run) {
  const base = r.chips;
  const holders = effectiveArtifacts(r).filter(a => (a.props?.encounterInterest ?? 0) > 0);
  if (!holders.length) return 0;
  const owed = holders.map(a => {
    const raw = Math.floor(base * a.props.encounterInterest);
    const cap = a.props.encounterInterestCap ?? 0;
    return cap > 0 ? Math.min(cap, raw) : raw;
  });
  const total = owed.reduce((s, n) => s + n, 0);
  if (total <= 0) return 0;
  const paid = gainGold(total, r);
  // The ledger each relic's liveDesc reads back. gainGold may have fattened the
  // total (Sticky Gloves) or the difficulty may have shaved it, so what actually
  // landed is split by each holder's share of what was owed.
  if (paid > 0) {
    holders.forEach((a, i) => {
      if (a.state) a.state.paid = (a.state.paid ?? 0) + Math.round(paid * (owed[i] / total));
    });
  }
  return paid;
}

/**
 * THE ONE DOOR ONTO A NODE. map.enterNode is the chokepoint every advance goes
 * through — MapScene.tryEnter is its only production caller, and fights, events,
 * rests and the merchant all branch AFTER it — so this wraps it once and hangs
 * the per-encounter economy off it. Anything that must happen "because you moved
 * on the map" belongs here and nowhere else.
 *
 * Returns { node, interest } rather than writing to the run, so nothing new
 * rides the save file.
 */
export function enterMapNode(nodeId, r = run, force = false) {
  const node = enterNode(r.map, nodeId, force);
  return { node, interest: payEncounterInterest(r) };
}

/**
 * THE HAND-SIZE FLOOR. However many cards the Fairy King's roots take, however
 * negative a relic's handSizeBonus is (the Ruthless Editor's −1), and however
 * they combine, a deal is never smaller than this. Four is the smallest hand
 * that can still form every hand family the game asks you for.
 *
 * The arithmetic lives here rather than in CombatScene so a unit test can prove
 * the floor without standing up Phaser. See CombatScene.effectiveHandSize.
 */
export const HAND_SIZE_FLOOR = 4;

/** base + a fight-local bump + every relic's bonus − a boss aura, floored. */
export function handSizeOf({ base = 0, temp = 0, bonus = 0, penalty = 0 } = {}) {
  return Math.max(HAND_SIZE_FLOOR, base + temp + bonus - penalty);
}

export function chr() { return CHARACTERS[run.chrId]; }

export function hasArtifact(id) { return run.artifacts.some(a => a.id === id); }

/**
 * The mirror relics: The Forgery (id 'counterfeit') copies the artifact to its RIGHT,
 * The Phantom Cast copies the one to its LEFT. Resolution returns the actual
 * SOURCE INSTANCES (so a copied scaler shares its growth), possibly duplicated
 * — which is exactly the point. Order matters; mirrors of mirrors chain.
 *
 * A mirror can only re-read what the engine re-reads every hand: mods, props
 * and hooks. Relics that spent their whole effect at pickup (`uncopyable`) have
 * nothing to mirror, so the mirror simply contributes NOTHING rather than
 * pretending — `guard > 0` is exactly "we got here through a mirror".
 */
export function effectiveArtifacts(r = run) {
  return effectiveArtifactSlots(r).map(e => e.art);
}

/**
 * The same walk, but each entry remembers WHICH CELL it came from — the raw
 * index into r.artifacts. A mirror's copy therefore reports the MIRROR's cell,
 * not the source's, which is what lets the cascade swell the cell that actually
 * resolved and what makes the ordered chain readable.
 * @returns {{art: object, slot: number}[]}
 */
export function effectiveArtifactSlots(r = run) {
  const raw = r.artifacts ?? [];
  // `dir` remembers which way a mirror was looking, so a NOOK relic (the Sixth
  // Finger, which sits in its own pouch and not in the row at all) can be
  // stepped straight over: a Forgery beside the glove copies whatever is on the
  // glove's far side, exactly as if the glove were never in the array.
  const resolve = (idx, guard = 0, dir = 0) => {
    const a = raw[idx];
    if (!a || guard > 4) return null;
    if (guard > 0 && a.props?.nook) return resolve(idx + dir, guard, dir);
    if (a.id === 'counterfeit') return resolve(idx + 1, guard + 1, 1);
    if (a.id === 'phantomCast') return resolve(idx - 1, guard + 1, -1);
    if (guard > 0 && a.uncopyable) return null;
    return a;
  };
  const out = [];
  raw.forEach((a, i) => {
    const r = resolve(i);
    if (r) out.push({ art: r, slot: i });
  });
  return out;
}

/**
 * The relic a mirror is actually POINTED AT, copyable or not — the first thing
 * its walk lands on after stepping past other mirrors and the glove nook.
 * null when `art` is not a mirror, or when it is staring at empty air.
 */
export function mirrorNeighbour(art, list = run.artifacts) {
  const step = art?.id === 'counterfeit' ? 1 : art?.id === 'phantomCast' ? -1 : 0;
  if (!step) return null;
  let j = list.indexOf(art);
  if (j < 0) return null;
  for (let guard = 0; guard < 5; guard++) {
    j += (list[j]?.id === 'phantomCast') ? -1 : (list[j]?.id === 'counterfeit') ? 1 : step;
    const t = list[j];
    if (!t) return null;
    if (t.id === 'counterfeit' || t.id === 'phantomCast') continue;
    if (t.props?.nook) continue;   // the glove is not in the row; look past it
    return t;
  }
  return null;
}

/**
 * If `art` is a mirror aimed at something it cannot copy, hand back the relic
 * it is uselessly pointed at (else null). Drives the ⊘ badge in the combat
 * panel, the map belt and the ceremony.
 */
export function mirrorBlockedBy(art, list = run.artifacts) {
  const t = mirrorNeighbour(art, list);
  return t?.uncopyable ? t : null;
}

/**
 * MIRROR CLARITY (JC, 2026-08-01). One sentence every tooltip surface prints
 * under a Forgery / Phantom Cast, so "is this thing doing anything?" is never a
 * question you have to answer by reading the rules of the relic next door:
 *
 *   ✔ Compatible. Copying Echo Bell
 *   ⊘ Incompatible. Cannot copy Star Chart
 *   ⊘ Nothing to copy. No relic on that side
 *
 * Returns null for anything that is not a mirror. `ok` drives the colour.
 */
export function mirrorNote(art, list = run.artifacts) {
  if (art?.id !== 'counterfeit' && art?.id !== 'phantomCast') return null;
  const t = mirrorNeighbour(art, list);
  if (!t) return { ok: false, target: null, text: '⊘ Nothing to copy. No relic on that side' };
  return t.uncopyable
    ? { ok: false, target: t, text: `⊘ Incompatible. Cannot copy ${t.name}` }
    : { ok: true, target: t, text: `✔ Compatible. Copying ${t.name}` };
}

/**
 * Sell-back value of a relic: a quarter of what it would cost on the mat.
 * Mythicals price at 0 in the pool (they are never merchandise), so they fall
 * back to the shop's mythical basis; anything else priceless sells for 25.
 */
export const SELL_FRACTION = 0.25;
// Rode the 2026-08-02 +25% price pass with everything else (650 -> 810). It sits
// in this file rather than the price tables, so the sweep walked straight past
// it and briefly left a Mythical selling for less than a Legendary.
export const MYTHIC_SELL_BASIS = 810;

/**
 * THE NEGOTIATOR'S CERTIFICATION (2026-08-03): relics sell for ALL of what they
 * would cost, not a quarter. `props.fullSellValue` is the switch, and this is
 * the only place in the game that reads it.
 */
export const NEGOTIATED_SELL_FRACTION = 1;

/**
 * What fraction of a relic's price the fence pays right now. Reads the LIVE
 * belt, which is what makes every surface in the game agree for free: the map
 * belt tip, the glove pouch tip, the merchant's shelf, the two confirm dialogs
 * and the combat mat all print sellValue(art) and sellArtifact() recomputes it
 * from the same function a moment later. There is no second copy of the number
 * to keep in step and no price is ever carried from a tooltip to a payout.
 *
 * `some` and not a sum: 100% is 100%. Two certificates do not pay 200%.
 */
export function sellFraction(r = run) {
  return effectiveArtifacts(r).some(a => a.props?.fullSellValue)
    ? NEGOTIATED_SELL_FRACTION : SELL_FRACTION;
}

export function sellValue(art, r = run) {
  const basis = art?.shopPrice ?? art?.price ?? 0;
  const real = basis > 0 ? basis : (art?.rarity === 'mythical' ? MYTHIC_SELL_BASIS : 100);
  return Math.max(1, Math.round(real * sellFraction(r)));
}

/** Sell an owned relic: off the belt, chips in the purse. Returns the payout. */
export function sellArtifact(art, r = run) {
  const i = r.artifacts.indexOf(art);
  if (i < 0) return 0;
  // PRICED WHILE IT IS STILL ON THE BELT, and before onSell touches anything.
  // That is what makes the NEGOTIATOR'S CERTIFICATION pay for itself: selling
  // the certificate reads a belt that still holds the certificate.
  const paid = sellValue(art, r);
  art.onSell?.(r, art);      // grants leave with the relic (JC: everything sellable, everything revoked)
  r.artifacts.splice(i, 1);
  // PAWNBROKER's ledger. This is the only door a relic leaves through, which is
  // why the counter lives here and not at any of the surfaces that offer it.
  r.counters ??= {};
  r.counters.relicsSold = (r.counters.relicsSold ?? 0) + 1;
  // Deliberately NOT gainGold: a sell-back is a refund of something you paid
  // for, not income, so the DEV GOLD slider leaves it alone.
  r.chips += paid;
  return paid;
}

/**
 * SELL, AND SAY WHAT THE DECK LOST (JC, 0803: "if a relic is sold mid-fight it
 * also resolves whatever bonus or effect it was providing... if it brought in a
 * joker card, that needs to be immediately removed from your deck or even hand").
 *
 * Out on the map the deck is ONE list and an onSell that splices run.runDeck is
 * the whole job. Inside a fight the same cards are ALSO in the draw pile, the
 * discard pile and the player's hand as live sprites — so the scene needs to
 * know exactly what left, and exactly what was rewritten in place.
 *
 * This does it by DIFF rather than by asking each relic to grow a combat-aware
 * handler: snapshot the deck, let onSell do whatever it does, and report.
 * Every grant relic in the pool is covered at once, including any added later.
 *
 * It CANNOT over-revoke, which is the point that keeps the dupe-then-sell tech
 * alive: a duplicated card carries a suffixed id that no receipt ever matched,
 * so it is simply still in the deck afterwards and never shows up in `removed`.
 *
 * @returns {{paid:number, removed:string[], resuited:string[]}}
 */
export function sellArtifactWithReceipt(art, r = run) {
  const before = new Map((r.runDeck ?? []).map(c => [c.id, c.suit]));
  const paid = sellArtifact(art, r);
  if (!paid) return { paid: 0, removed: [], resuited: [] };
  const after = new Map((r.runDeck ?? []).map(c => [c.id, c.suit]));
  const removed = [];
  const resuited = [];
  for (const [id, suit] of before) {
    if (!after.has(id)) removed.push(id);
    else if (after.get(id) !== suit) resuited.push(id);   // the SUIT PRISM, poured back out
  }
  return { paid, removed, resuited };
}

/** Slots consumed (The Phantom Cast and the glove are weightless). */
export function slotsUsed() {
  return run.artifacts.filter(a => !a.props?.noSlot).length;
}

/**
 * THE ROW: every relic that lives in the six artifact cells. Nook relics (the
 * Sixth Finger's glove) are stripped out — they render in their own pouch.
 * acquireArtifact keeps the nook relics parked at the END of run.artifacts, so
 * belt index === run.artifacts index for everything in here.
 */
export function beltArtifacts(r = run) { return r.artifacts.filter(a => !a.props?.nook); }

/** THE NOOK: relics that live in the glove pouch instead of the row. */
export function nookArtifacts(r = run) { return r.artifacts.filter(a => a.props?.nook); }

/**
 * TAKE THE OFFER. Flips the run into the endless; the caller then descends
 * exactly as it would between any two acts. Idempotent.
 */
export function beginEndless(r = run) {
  r.endless = true;
  return r;
}

export function advanceAct() {
  run.actIndex += 1;
  // A fresh act starts unscuffed. IMMACULATE asks about ONE act, so the slate
  // has to be wiped somewhere, and this is the only line that starts an act.
  if (run.stats) run.stats.actScuffed = false;
  // THE DEPTH LABEL is stamped on ARRIVAL, not at the end screen: this is the
  // one line that starts an act, so it is the only place that cannot miss one.
  // noteReached keeps it in step afterwards; between them, every way a run can
  // end (death, forfeit from the map, forfeit from a fight) knows where it was.
  if (run.stats && isEndlessIndex(run.actIndex)) {
    run.stats.endlessLabel = endlessLabel(run.actIndex);
  }
  run.map = newActMap(run.actIndex);
}

/**
 * Merged declarative scoring mods from every effective artifact (mirrors count
 * their source twice). An artifact's `mods` may be a FUNCTION (a, run) — that's
 * how scalers like Echo Bell and Crown of Greed stay live.
 */
export function collectMods() {
  const mods = {
    suitValue: { swords: 0, hearts: 0, gems: 0, clovers: 0 },
    suitMult: { swords: 0, hearts: 0, gems: 0, clovers: 0 },  // flat mult per scoring card of a suit
    modValue: {},          // card mod -> value bonus (Star Chart's STARs)
    cardValue: {},         // card id -> value bonus (per-hand scene grants)
    handMult: {},          // handType -> flat mult bonus
    handValue: {},         // handType -> flat PRE-MULT value (the Straightedge's bank)
    // FLAT MULT ON EVERY HAND (2026-08-01). handMult is keyed by hand type,
    // which cannot express "this relic is worth +12 mult, whatever you play".
    // Every SCALER lands here: Kingmaker's crowns, the Rising Tide, Lucky
    // Deuce, the Ace's Legacy, Wolfsbane's carcasses, the Chaos Orb's roll.
    flatMult: 0,
    // FLAT VALUE / FLAT SHIELD (2026-08-02). flatValue is flatMult's twin on the
    // SCORE side: a number added to every hand before the mult touches it
    // (Pocket Anvil, the Matchmaker's bank, the Golden Spud). flatShield is
    // added to any hand that already grants Shield, upstream of Aegis Core.
    flatValue: 0,
    flatShield: 0,
    handFactor: {},        // handType -> multiplicative factor (×1.5 straights...)
    globalMultFactor: 1,   // multiplies effMult
    modCardFactor: 1,      // × per scoring MODDED card, compounding (the Still)
    retriggerTop: 1,       // the top scoring card counts N times (Ouroboros)
    // THE REPEAT, ADDITIVE (0803-B §1.2). handRepeatAdd is what relics WRITE:
    // a relic worth ×N contributes N-1 extra activations and the extras SUM.
    // handRepeat is the RESOLVED TOTAL, kept in step at the bottom of this
    // function, because it is the name every existing reader already knows.
    handRepeatAdd: 0,
    handRepeat: 1,         // = 1 + handRepeatAdd (derived; never multiplied)
    // THE LEFTOVER BENCH (0803-B §1.1/§1.3). benchRepeat is how many times a
    // held-back card's effect fires; benchFactor is the finished product of
    // every leftover effect, which scoreHand applies at the very END of the
    // mult. Only the SCENE can fill benchFactor in — it is the only thing that
    // knows which cards are still in your hand.
    benchRepeat: 1,
    benchFactor: 1,
    // THE HOARD (0803-B §1.5 / §3). chipMultAdd is +mult per HOARD_CHIP_STEP
    // chips held and is ADDITIVE (Drusky is worth 1). chipMultFactor > 0 turns
    // that same live reading into a × on the FINISHED mult instead (the Solid
    // Gold Sack); it is additive too, so a mirror is countable rather than a
    // boolean that silently swallows the second copy.
    chipMultAdd: 0,
    chipMultFactor: 0,
    valueFactor: 1,        // × on everything the hand outputs (the Forge Hammer)
    shieldByMult: 0,       // general lever: hand Shield is multiplied by the mult
    shieldMult: 0,         // Ancient Shield: every point of Shield is +1% mult
    healByMult: 0,         // Infinite Heart: hand Healing is multiplied by the mult
    zealUncap: 0,          // Infinite Heart: the ZEAL_CAP comes off entirely
    heartDamageOff: 0,     // Infinite Heart: Hearts stop dealing damage
    cloverDamageOff: 0,    // general lever: Clubs stop dealing damage (unused today)
    gemDamageFactor: 0,    // gems ALSO deal value*factor damage
    faceValue: 0,          // J/Q/K value bonus (generic; no relic uses it today)
    faceMult: 0,           // flat mult per scoring J/Q/K (Kingmaker)
    handLevels: run.handLevels,
  };
  for (const s of Object.keys(run.bonusMods?.suitValue ?? {})) {
    mods.suitValue[s] += run.bonusMods.suitValue[s];
  }
  for (const t of Object.keys(run.bonusMods?.handMult ?? {})) {
    mods.handMult[t] = (mods.handMult[t] ?? 0) + run.bonusMods.handMult[t];
  }
  for (const a of effectiveArtifacts()) {
    const m = typeof a.mods === 'function' ? a.mods(a, run) : a.mods;
    if (!m) continue;
    if (m.suitValue) for (const s of Object.keys(m.suitValue)) mods.suitValue[s] += m.suitValue[s];
    if (m.suitMult) for (const s of Object.keys(m.suitMult)) mods.suitMult[s] += m.suitMult[s];
    if (m.modValue) for (const k of Object.keys(m.modValue)) mods.modValue[k] = (mods.modValue[k] ?? 0) + m.modValue[k];
    if (m.handMult) for (const h of Object.keys(m.handMult)) mods.handMult[h] = (mods.handMult[h] ?? 0) + m.handMult[h];
    if (m.flatMult) mods.flatMult += m.flatMult;
    if (m.flatValue) mods.flatValue += m.flatValue;
    if (m.flatShield) mods.flatShield += m.flatShield;
    if (m.handValue) for (const h of Object.keys(m.handValue)) mods.handValue[h] = (mods.handValue[h] ?? 0) + m.handValue[h];
    if (m.handFactor) for (const h of Object.keys(m.handFactor)) mods.handFactor[h] = (mods.handFactor[h] ?? 1) * m.handFactor[h];
    if (m.globalMultFactor) mods.globalMultFactor *= m.globalMultFactor;
    if (m.modCardFactor) mods.modCardFactor *= m.modCardFactor;
    // Two Ouroboros (a mirrored one) compound: 3 x 3 = the card counts 9 times.
    if (m.retriggerTop) mods.retriggerTop *= m.retriggerTop;
    // THE REPEAT IS ADDITIVE NOW (0803-B §1.2). A relic printed as "×N" is
    // worth N-1 EXTRA activations and the extras SUM, so a Pocketwatch (×2)
    // beside the Sharpest Dagger (×5) is 1+1+4 = 6 plays and not 10, and a
    // mirrored Pocketwatch is 3 and not 4. handRepeatAdd is the channel; the
    // total is derived from it below, once, so the two can never disagree.
    if (m.handRepeat > 1) mods.handRepeatAdd += m.handRepeat - 1;
    if (m.handRepeatAdd > 0) mods.handRepeatAdd += m.handRepeatAdd;
    if (m.benchRepeat) mods.benchRepeat *= m.benchRepeat;
    // The leftover bench's own × can be declared by a relic too, though today
    // every one of them is scene-computed (only the scene sees your hand).
    if (m.benchFactor) mods.benchFactor *= m.benchFactor;
    if (m.chipMultAdd) mods.chipMultAdd += m.chipMultAdd;
    if (m.chipMultFactor) mods.chipMultFactor += m.chipMultFactor;
    if (m.valueFactor) mods.valueFactor *= m.valueFactor;
    if (m.shieldByMult) mods.shieldByMult += m.shieldByMult;
    if (m.shieldMult) mods.shieldMult += m.shieldMult;
    if (m.healByMult) mods.healByMult += m.healByMult;
    if (m.zealUncap) mods.zealUncap += m.zealUncap;
    if (m.heartDamageOff) mods.heartDamageOff += m.heartDamageOff;
    if (m.cloverDamageOff) mods.cloverDamageOff += m.cloverDamageOff;
    if (m.gemDamageFactor) mods.gemDamageFactor += m.gemDamageFactor;
    if (m.faceValue) mods.faceValue += m.faceValue;
    if (m.faceMult) mods.faceMult += m.faceMult;
  }
  /**
   * DRUSKY'S POCKETS. His chips-to-mult passive is not special-cased anywhere in
   * scoring: he simply arrives already holding the shared channel, which is what
   * lets the SOLID GOLD SACK rewrite the same idea from additive to
   * multiplicative without either side knowing about the other.
   *
   * It lands AFTER the relic walk so a relic can never accidentally zero it, and
   * it carries no chip figure of its own: what scoring does with the rate is
   * read the pile LIVE at play time.
   */
  if (run.chrId === 'hoarder') mods.chipMultAdd += HOARD_MULT_PER_STEP;
  // THE RESOLVED TOTAL, derived once and never multiplied (0803-B §1.2). Every
  // existing reader — scoreHand, artifacts.handActivations, the cascade's ↻ —
  // asks for handRepeat, so it keeps answering; handRepeatAdd is what anything
  // ADDING a replay writes to. addHandRepeat() below keeps them in step for the
  // scene's own per-hand grants (the Sharpest Dagger, the Wheel's wedge).
  mods.handRepeat = 1 + Math.max(0, Math.round(mods.handRepeatAdd));
  return mods;
}

/**
 * ONE MORE REPLAY, from the scene rather than from the belt.
 *
 * A relic printed as "×N" grants N-1 extra activations; this is that, for the
 * per-hand grants the merged bag cannot see (the Sharpest Dagger only fires on a
 * one-card hand, the Wheel of Divinity's wedge only on the hand it blessed).
 * Writes BOTH fields so the additive channel and the resolved total can never
 * drift apart, which is the one way this could silently double-count.
 */
export function addHandRepeat(mods, times) {
  const extra = Math.max(0, Math.round((times ?? 1) - 1));
  if (!extra) return mods;
  mods.handRepeatAdd = (mods.handRepeatAdd ?? 0) + extra;
  mods.handRepeat = 1 + mods.handRepeatAdd;
  return mods;
}

/**
 * THE ORDERED CHAIN (JC, 2026-08-02: "Artifact order should matter for how
 * effects occur. Made to occur in order of the chain. Left to right.").
 *
 * collectMods() above merges everything into one position-free bag, which is
 * still exactly right for every channel where order cannot change an answer
 * (all the VALUE adds, the retrigger counts, the output scales). This is its
 * ordered twin: one entry per effective artifact, IN ROW ORDER, so scoreHand
 * can walk the belt left to right and let a relic's adds land before the next
 * relic's multiplies.
 *
 * MIRRORS resolve to their SOURCE INSTANCE at the MIRROR's position, which
 * falls straight out of effectiveArtifacts(): a Forgery in slot 1 copying a ×2
 * in slot 2 means the ×2 happens at slot 1 AND again at slot 2.
 *
 * The leading entry (art: null) is the run-level, non-relic bonus — The
 * Dealer's banked hand mult. It sits BEFORE the relic walk so the relics
 * multiply it, exactly as the merged bag always did.
 */
export function collectModList(r = run) {
  const out = [];
  const bonusHandMult = r.bonusMods?.handMult;
  if (bonusHandMult && Object.keys(bonusHandMult).length) {
    out.push({ art: null, id: 'run', name: 'RUN BONUS', mods: { handMult: { ...bonusHandMult } } });
  }
  for (const { art: a, slot } of effectiveArtifactSlots(r)) {
    out.push({
      art: a,
      slot,
      id: a.id,
      name: a.name,
      mods: (typeof a.mods === 'function' ? a.mods(a, r) : a.mods) ?? {},
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE FIGHT CHECKPOINT (save/resume, 2026-08-02)
//
// The save system checkpoints at a fight's OPENING BELL, not mid-combat. For
// that to mean anything, the resumed fight has to field the same line-up you
// walked in on — otherwise quitting a fight you are losing would reroll it into
// an easier one, which is the whole exploit this exists to close.
//
// So the moment CombatScene settles who you are facing, it records the roll
// here; the save writes it, and a resume feeds the ids straight back through
// the same "field these exact defs" path the dev encounter override uses.
// Cleared on victory and on the run ending. NOT cleared by a Fairy revive: that
// fight is still in progress and still owns its checkpoint.
// ---------------------------------------------------------------------------

/**
 * Remember the line-up this node just rolled.
 * @param {object} node  the map node being fought (id + type)
 * @param {object[]} defs  the enemy DEFS the encounter settled on
 */
export function checkpointFight(node, defs, r = run) {
  r.pendingFight = {
    nodeId: node?.id ?? null,
    defIds: (defs ?? []).map(d => d?.id).filter(Boolean),
    elite: node?.type === 'elite',
    boss: node?.type === 'boss',
  };
  return r.pendingFight;
}

/** The fight is over (won, fled, or the run itself ended). */
export function clearPendingFight(r = run) {
  r.pendingFight = null;
}
