/**
 * DIFFICULTY MODES (JC, 2026-08-02).
 *
 * Six tiers, chosen AFTER the hero and BEFORE the run starts. Each one is a
 * flat table of ABSOLUTE combat allowances (hands / discards / hand size) plus
 * MULTIPLIERS on the two curves that already exist (enemy HP, chips received).
 *
 * Absolute, not deltas, on purpose: BRONZE literally IS today's shipped game,
 * so the numbers below are the only place the baseline is written down and no
 * mode can silently drift when the baseline moves. The BRONZE row is asserted
 * against PLAYER_BASE and CombatScene's HAND_LIMIT in tests/difficulty.test.js
 * — if someone retunes the game and forgets this file, that test fails.
 *
 * NOTHING here imports run.js or progress.js. run.js needs the table, and
 * progress.js needs the count, so this module stays a leaf: pure data + pure
 * functions, safe to import from anywhere including a Node test.
 *
 * A run stores `run.difficulty` as a plain NUMBER (the index). That is
 * deliberate — the save system JSONs the run wholesale, and an index round
 * trips for free where an object reference would not.
 */

/**
 * THE LIVE HAND MATH IS A BRONZE PRIVILEGE — the highest mode index that keeps
 * its numeric preview. See the long note further down for what is and is not
 * taken away; it lives up here because modLines prints it into every mode's
 * modifier list, and a const cannot be read before it is initialised.
 */
export const PREVIEW_MAX_DIFFICULTY = 0;

/** Trim the trailing zeroes off a multiplier: 1 -> "x1", 1.45 -> "x1.45". */
const mult = (n) => `x${String(Number(n.toFixed(2)))}`;

/** "+30% damage" from a 1.3 multiplier. Whole percents only; that is all we use. */
const pct = (n) => `${Math.round((n - 1) * 100)}%`;

/**
 * THE TABLE. Every field is read live by the game:
 *   hands       CombatScene.handLimit          (the per-fight clock)
 *   discards    CombatScene.newFightState      (+ run.discardsPerFightBonus)
 *   handSize    run.newRun -> run.player.handSize (relics add on top)
 *   enemyHp     enemies.makeEnemy              (alongside the act curve + dev slider)
 *   gold        run.gainGold                   (the one funnel every payout takes)
 *   bossDamage  enemies.currentIntent          (so the TELEGRAPH shows the truth)
 *   bossReward  CombatScene victory path       (purse + BOUNTY HUNTER pack)
 */
/**
 * Three colours per mode, because HANDFORGED has two surfaces and they need
 * opposite answers: `color` tints art, `css` is the mode's name on a DARK
 * ground, `ink` is the same name on PARCHMENT (the map capsule, the RECORDS
 * shelf). A pale metal like PLATINUM is invisible in `css` on parchment, which
 * is exactly the bug `ink` exists to prevent.
 */
const TABLE = [
  { id: 'bronze', name: 'BRONZE', color: 0xc9803f, css: '#e0954f', ink: '#8a4a14',
    hands: 10, discards: 4, handSize: 8, enemyHp: 1.00, gold: 1.00, bossDamage: 1.00, bossReward: true },
  { id: 'iron', name: 'IRON', color: 0x9aa3ad, css: '#b6bec8', ink: '#4e5866',
    hands: 8, discards: 3, handSize: 8, enemyHp: 1.20, gold: 1.00, bossDamage: 1.00, bossReward: true },
  { id: 'steel', name: 'STEEL', color: 0x6f97b8, css: '#8fb8d6', ink: '#2f5f80',
    hands: 7, discards: 3, handSize: 8, enemyHp: 1.30, gold: 0.90, bossDamage: 1.00, bossReward: true },
  { id: 'platinum', name: 'PLATINUM', color: 0xd8dde6, css: '#e8edf6', ink: '#5a6270',
    hands: 7, discards: 2, handSize: 8, enemyHp: 1.45, gold: 0.90, bossDamage: 1.30, bossReward: true },
  { id: 'diamond', name: 'DIAMOND', color: 0x3fc9de, css: '#6ee7f5', ink: '#0e6c7c',
    hands: 7, discards: 2, handSize: 8, enemyHp: 1.70, gold: 0.90, bossDamage: 1.30, bossReward: false },
  { id: 'mythril', name: 'MYTHRIL', color: 0x9a4cff, css: '#c08cff', ink: '#5e28a8',
    hands: 7, discards: 2, handSize: 7, enemyHp: 2.00, gold: 0.75, bossDamage: 1.30, bossReward: false },
];

/**
 * The picker's plain-language modifier list, BUILT FROM the numbers above so a
 * retune can never leave the copy lying. No em dashes (house rule).
 */
function modLines(d, index) {
  const out = [
    `${d.hands} hands per fight`,
    `${d.discards} discards per fight`,
    `${d.handSize} cards in hand`,
    `Enemy health ${mult(d.enemyHp)}`,
    `Chips ${mult(d.gold)}`,
  ];
  // THE PREVIEW IS A MODIFIER TOO, and until now it was the only one the game
  // applied without ever telling anybody: from IRON up the live hand math is
  // gone, and that was written down in exactly one code comment. It is the
  // single biggest change between BRONZE and the rest, so it goes FIRST among
  // the extras, above the boss lines. Derived from PREVIEW_MAX_DIFFICULTY so a
  // retune moves the line with the rule.
  if (index > PREVIEW_MAX_DIFFICULTY) out.push('No live hand math: you play blind');
  if (d.bossDamage > 1) out.push(`Bosses hit ${pct(d.bossDamage)} harder`);
  if (!d.bossReward) out.push('Bosses pay no reward');
  return out;
}

export const DIFFICULTIES = TABLE.map((d, index) => ({
  ...d, index, lines: modLines(d, index),
}));

/** BRONZE. The mode a run falls back to whenever anything is missing or junk. */
export const DEFAULT_DIFFICULTY = 0;

/**
 * THE LIVE HAND MATH IS A BRONZE PRIVILEGE (JC, PATCH 0803-B §1.4).
 *
 * From IRON up the numeric preview is gone: no score, no mult, no damage figure,
 * nothing the selection would have paid. You keep the hand's NAME and the
 * scoring rule it implies, so a kicker is still legible and the Smith's levels
 * still read — what you lose is the ability to solve the turn before playing it.
 *
 * The full scoring sequence AFTER you commit is untouched at every tier; this is
 * about what you know while you are still choosing.
 *
 * The highest index that keeps its numbers. A number and not a boolean per mode,
 * because the table above is ordered and the rule is "up to here" — a seventh
 * tier added tomorrow is covered without a seventh edit.
 *
 * IT IS DECLARED ABOVE THE TABLE, not here, because modLines now prints it: a
 * mode that takes the live math away has to SAY so on the card you read while
 * you are choosing, and until 2026-08-04 this rule was written down in exactly
 * one place — this comment.
 */

/** Does this run get to see the live hand math before it commits? */
export function showsHandMath(r) {
  return difficultyIndex(r?.difficulty) <= PREVIEW_MAX_DIFFICULTY;
}
export const MAX_DIFFICULTY = DIFFICULTIES.length - 1;

/** Any index, id string, or garbage -> a real index inside the table. */
export function difficultyIndex(value) {
  if (typeof value === 'string') {
    const byId = DIFFICULTIES.findIndex(d => d.id === value || d.name === value.toUpperCase());
    if (byId >= 0) return byId;
  }
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_DIFFICULTY;
  return Math.min(Math.max(n, 0), MAX_DIFFICULTY);
}

/** The mode def for any index/id/garbage. Never returns undefined. */
export function difficultyAt(value) {
  return DIFFICULTIES[difficultyIndex(value)];
}

/**
 * The mode a RUN is being played on. Takes the run object rather than importing
 * it, which keeps this module a leaf (run.js imports us, not the other way).
 * An old save with no `difficulty` field reads as BRONZE, which is exactly what
 * it was played on.
 */
export function difficultyOf(r) {
  return difficultyAt(r?.difficulty);
}

/** Multipliers, guarded so a caller can pass any run at all. */
export const enemyHpFactor = (r) => difficultyOf(r).enemyHp;
export const goldFactor = (r) => difficultyOf(r).gold;
export const bossDamageFactor = (r) => difficultyOf(r).bossDamage;
export const bossPaysReward = (r) => difficultyOf(r).bossReward;
