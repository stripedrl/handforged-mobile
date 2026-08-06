/**
 * @file statuses.js
 * Enemy status-effect ticking for HANDFORGED (poison, bleed, brittle).
 * Pure functions that mutate the passed-in `enemy` object in place (the
 * combat layer owns the enemy object's lifecycle) and return a small
 * result describing what happened, for logging/animation.
 */

/**
 * @typedef {Object} EnemyStatuses
 * @property {number} [poison]
 * @property {number} [bleed]
 * @property {number} [brittle]
 */

/**
 * @typedef {Object} Enemy
 * @property {number} hp
 * @property {EnemyStatuses} statuses
 */

/**
 * Called at the end of the enemy's turn. Poison deals damage equal to its
 * stack count then decrements by 1. Brittle is passive (its effect is read
 * via brittleMultiplier) and simply decrements by 1 here, representing its
 * duration ticking down.
 *
 * `poisonTicks` is the GRIMOIRE OF ROT's lever (Ophelia-only): the venom bites
 * that many times in one round. It multiplies the DAMAGE and deliberately not
 * the decay — "ticks twice" must not also mean "fades twice", or the relic
 * would hand back with one paw what it gave with the other.
 *
 * @param {Enemy} enemy - mutated in place (hp and statuses)
 * @param {{ poisonTicks?: number }} [opts]
 * @returns {{ damage: number, log: string[] }}
 */
export function tickStatuses(enemy, { poisonTicks = 1 } = {}) {
  const log = [];
  let damage = 0;
  const statuses = enemy.statuses || (enemy.statuses = {});

  const poison = statuses.poison || 0;
  if (poison > 0) {
    const bite = poison * Math.max(1, poisonTicks);
    damage += bite;
    enemy.hp -= bite;
    log.push(`Poison deals ${bite} damage.`);
    statuses.poison = poison - 1;
  }

  const brittle = statuses.brittle || 0;
  if (brittle > 0) {
    statuses.brittle = brittle - 1;
    log.push(`Brittle fades to ${statuses.brittle} stacks.`);
  }

  return { damage, log };
}

/**
 * Called when the enemy acts (e.g. attacks). Bleed deals damage equal to
 * its stack count at that moment, then decrements by 1.
 * @param {Enemy} enemy - mutated in place (hp and statuses)
 * @returns {number} damage dealt by bleed (0 if no bleed stacks)
 */
export function onEnemyAct(enemy) {
  const statuses = enemy.statuses || (enemy.statuses = {});
  const bleed = statuses.bleed || 0;
  let damage = 0;
  if (bleed > 0) {
    damage = bleed;
    enemy.hp -= bleed;
    statuses.bleed = bleed - 1;
  }
  return damage;
}

/**
 * Brittle's passive effect: a multiplier the combat layer applies to
 * incoming hand damage against this enemy. Each stack adds 4%, capped at
 * 10 stacks (i.e. max x1.4).
 * @param {Enemy} enemy
 * @returns {number}
 */
export function brittleMultiplier(enemy) {
  const stacks = (enemy.statuses && enemy.statuses.brittle) || 0;
  return 1 + 0.04 * Math.min(stacks, 10);
}

// ---------------------------------------------------------------------------
// ENEMY SHIELD (phase 2, 2026-07-31)
// ---------------------------------------------------------------------------
/**
 * A flat absorption pool that eats damage BEFORE HP — the mirror of the
 * player's own shield, and the payload of Sinastra's Sisters' Ward. It lives
 * on the enemy root (`enemy.shield`), not in `statuses`, because it is a
 * resource rather than a ticking effect: nothing decays it, only damage.
 *
 * @param {Enemy} enemy
 * @param {number} amount
 * @returns {number} the shield pool after the grant
 */
export function addEnemyShield(enemy, amount) {
  enemy.shield = Math.max(0, (enemy.shield || 0) + Math.round(amount));
  return enemy.shield;
}

/**
 * Spend the shield pool against `amount` of incoming damage. Mutates
 * `enemy.shield`; the caller applies whatever gets `through` to HP, so every
 * damage source in the game funnels through one place (CombatScene.damageEnemy).
 * @returns {{ absorbed: number, through: number }}
 */
export function absorbWithShield(enemy, amount) {
  const pool = enemy.shield || 0;
  if (pool <= 0 || amount <= 0) return { absorbed: 0, through: Math.max(0, amount) };
  const absorbed = Math.min(pool, amount);
  enemy.shield = pool - absorbed;
  return { absorbed, through: amount - absorbed };
}

// ---------------------------------------------------------------------------
// PLAYER DEBUFFS — the pure rules (2026-08-02 mechanics wave)
// ---------------------------------------------------------------------------
/**
 * `pstat` is the player's whole debuff ledger and it lives on CombatScene, but
 * its SHAPE and its decay live here, because three separate paths reset it
 * (init, newFightState, the Cleansing Tea) and they used to each hand-type
 * their own object literal. One factory, one tick, no drift.
 */

/** J · Q · K. The ranks COURT ADJOURNED takes out of play. */
export const FACE_RANKS = new Set([11, 12, 13]);
export const isFaceCard = (card) => FACE_RANKS.has(card?.rank);

/** ROOTED's regular-tier strength: one card off the deal, per active stack. */
export const ROOTED_STRENGTH = 1;

/**
 * How long a REGULAR enemy's denial lasts. One turn is the whole design: it is
 * a puzzle for the hand in front of you, never a fight-long condition. Elites
 * and bosses pass their own numbers (an elite ROOTED runs the whole fight by
 * asking for Infinity).
 */
export const REGULAR_DENIAL_TURNS = 1;

/** A blank player-debuff ledger. */
export function freshPstat() {
  return {
    bleed: 0, poison: 0, brittle: 0, fear: 0,
    // --- 2026-08-02 wave ---
    rooted: 0,          // turns · hand size −ROOTED_STRENGTH while > 0
    courtLock: 0,       // turns · J/Q/K unplayable while > 0
    suitSealTurns: 0,   // turns on CombatScene.bannedSuit (0 = the Keeper's forever)
    spikes: 0,          // STACKS · HP per hand played. Never decays on its own.
    // --- 2026-08-03 biome wave (docs/PATCH_ORACLE.txt ADDENDUM) ---
    blind: 0,           // turns · marked cards render FACE DOWN. ACT I.
    faded: [],          // card ids ETHEREAL for this fight with NO mult. ACT II.
  };
}

/**
 * The debuffs that count down once per round. `spikes` is deliberately absent:
 * stacks are a clock the ENEMY winds, and the only way off them is to end the
 * fight (or drink).
 *
 * `faded` is deliberately absent too, and for the opposite reason: a faded card
 * is ethereal FOR THE FIGHT, so there is no clock to run down.
 *
 * `blind` IS here: the moonlight lets go, and the turn it lets go on is the
 * whole point of the mechanic.
 */
export const TIMED_DEBUFFS = ['rooted', 'courtLock', 'suitSealTurns', 'blind'];

/**
 * What was already running at the TOP of an enemy turn. A debuff applied DURING
 * the turn that just resolved must not be ticked by it — the same rule brittle
 * and fear have always used, hoisted so every new debuff inherits it.
 */
export function armedSnapshot(pstat = {}) {
  const out = {};
  for (const key of TIMED_DEBUFFS) out[key] = (pstat[key] ?? 0) > 0;
  return out;
}

/**
 * One round of decay. Mutates `pstat`; returns the keys that hit 0 this round,
 * which is what the scene needs in order to lift the card locks and crack the
 * wax off the HUD.
 *
 * Infinity is a legal duration and never expires — that is how an elite asks
 * for a whole-fight ROOTED without a second code path.
 */
export function tickPlayerDebuffs(pstat, armed = {}) {
  const expired = [];
  for (const key of TIMED_DEBUFFS) {
    if (!armed[key]) continue;
    const n = pstat[key] ?? 0;
    if (n <= 0) continue;
    pstat[key] = Math.max(0, n - 1);
    if (pstat[key] === 0) expired.push(key);
  }
  return expired;
}

// ---------------------------------------------------------------------------
// DENIAL — the one gate, and the deadlock it can produce
// ---------------------------------------------------------------------------
/**
 * @typedef {Object} Denial
 * @property {string|null} [bannedSuit] the sealed suit (Keeper's or a timed one)
 * @property {number} [sealTurns] the clock on it; 0 = the Keeper's forever-seal
 * @property {number} [courtLock] turns of COURT ADJOURNED
 * @property {Set<string>} [burned] card ids spent for the rest of the fight
 */

/**
 * Is this card denied for PLAY? Discarding is ALWAYS allowed — that is the
 * escape hatch the whole deadlock design rests on.
 *
 * ONE PLACE. Every denial in the game answers here, so a new one (an elite's
 * whole-fight seal, Wolfowl's TALON GRIP) is a single clause and the card
 * locks, the deadlock check, the post-Hopquake re-derivation and the HUD all
 * follow it for free.
 */
export function cardIsDenied(card, denial = {}, { ignoreSuitSeal = false } = {}) {
  if (!card) return false;
  if (!ignoreSuitSeal && denial.bannedSuit && card.suit === denial.bannedSuit) return true;
  if ((denial.courtLock ?? 0) > 0 && isFaceCard(card)) return true;
  // BURNED (2026-08-03, the Burning Gallows). The whole of Act III's mechanic,
  // in the gate every other lock already answers at — so the card lock, the
  // deadlock verdict, the post-Hopquake re-derivation and the HUD follow it for
  // free. It is deliberately NOT where BLIND lives: blind denies INFORMATION,
  // never the card, so it is a render state and never touches this function.
  if (denial.burned?.has(card.id)) return true;
  return false;
}

/** Is any play-denial running at all? */
export function denialRunning(denial = {}) {
  return !!denial.bannedSuit || (denial.courtLock ?? 0) > 0
    || (denial.burned?.size ?? 0) > 0;
}

/** Combat potions that can change a locked hand into a playable one. */
export const DEADLOCK_POTIONS = ['draw', 'redraw', 'summonDraw', 'handSize'];

/**
 * THE DEADLOCK MATRIX, as a pure function — the single highest-risk thing in
 * the 2026-08-02 wave, so it is decided here where a test can construct the
 * worst combination (face-locked AND suit-sealed AND zero discards AND a hand
 * of nothing else) rather than on a live board.
 *
 *   'ok'   — something is still playable, or there is another way out
 *   'warn' — nothing playable, but a potion could still change the hand
 *   'doom' — nothing playable and no out at all: the run ends
 *
 * `potions` is a list of combat potion EFFECT TYPES. The Cleansing Tea counts
 * only when it would actually free something: it lifts COURT ADJOURNED and a
 * TIMED suit seal, but the Keeper's untimed Eternal Keep survives it.
 */
export function deadlockState({
  hand = [], denial = {}, discards = 0, freeDiscards = false,
  potions = [], enemiesAlive = 1, drawable = Infinity,
} = {}) {
  if (!enemiesAlive) return 'ok';
  // AN EMPTY HAND IS ONLY SAFE WHILE THE DECK CAN STILL REFILL IT.
  //
  // This clause used to be a bare `!hand.length -> ok`, written when the only
  // way to hold no cards was the half-frame between a hand resolving and the
  // next deal. THE BURNING GALLOWS made it a lie: `burnPlayed` (Pyreheart)
  // takes every played card OUT of circulation — burned cards skip the discard
  // pile entirely and are purged from it on every reshuffle — so hand, draw
  // pile and discard pile can all reach zero with the fight still running.
  //
  // With no cards there is nothing to select, and both `playHand` and
  // `discardSelected` refuse an empty selection. `playHand` is the ONLY
  // player-reachable caller of `enemyTurn`, so the turn can never end, the hand
  // clock never reaches `outOfHands`, and the fight can be neither won nor
  // lost. It is exactly the same failure as a fully sealed hand, so it takes
  // exactly the same exit.
  //
  // `drawable` is how many cards could still reach the hand — the draw pile
  // plus whatever a reshuffle would rescue from the discard. It defaults to
  // Infinity so a caller that cannot answer the question keeps the old,
  // permissive behaviour. It is checked BEFORE `denialRunning` because a run
  // deck that CONDEMN burned down to nothing deals an empty hand into a fight
  // with no denial running at all.
  if (!hand.length) return drawable > 0 ? 'ok' : 'doom';
  if (!denialRunning(denial)) return 'ok';
  if (hand.some(c => !cardIsDenied(c, denial))) return 'ok';
  if (discards > 0 || freeDiscards) return 'ok';
  const keeperSeal = denial.bannedSuit && (denial.sealTurns ?? 0) <= 0 ? denial.bannedSuit : null;
  // BURNED IS NOT A DEBUFF ON A CLOCK, so the tea does not lift it: the ledger
  // lives on the SCENE, not on pstat, and the ADDENDUM only promises the tea
  // the pstat pair. A hand of nothing but burned cards is therefore doom even
  // with a Cleansing Tea in the belt, which is exactly Act III's promise.
  const teaFrees = hand.some(c => c.suit !== keeperSeal && !denial.burned?.has(c.id));
  const savior = potions.some(p => DEADLOCK_POTIONS.includes(p) || (teaFrees && p === 'cleanse'));
  return savior ? 'warn' : 'doom';
}

/** What playing a hand costs right now in SPIKE damage (pre-shield). */
export function spikeBite(pstat = {}) {
  return Math.max(0, Math.round(pstat.spikes ?? 0));
}

/**
 * SPIKES against the hero's plating. Shield eats it exactly like any other
 * damage, which is the whole "kill it early or turtle" decision.
 * @returns {{ absorbed: number, through: number }}
 */
export function absorbSpikes(shield, amount) {
  const absorbed = Math.max(0, Math.min(Math.max(0, shield ?? 0), Math.max(0, amount ?? 0)));
  return { absorbed, through: Math.max(0, (amount ?? 0) - absorbed) };
}
