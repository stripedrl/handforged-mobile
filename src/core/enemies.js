/**
 * Enemy definitions — all three worlds (Caleb art).
 * INTENTS are effect lists: each turn an enemy resolves every effect in its intent.
 *   { label, effects: [{ type, value }] }
 * Effect types:
 *   attack  — damage to the player (value, receives attackBuff)
 *   buff    — future attacks +value
 *   charge  — telegraphs a big turn (no action)
 *   bleed | freeze | brittle | poison | fear | hypnotize | suitban — player debuffs
 *   rooted | courtLock | suitSeal | spikes — the 2026-08-02 debuff wave
 *   shield    — plate itself or an ally for `value`% of the CASTER's max HP
 *   stealDiscard — take `value` discards off the player for the rest of the fight
 *   summon    — raise a minion (Frostbitten Summoner's Frozen Rite)
 *   quake     — scramble the suits of every card in hand (Sabre-Toothed Rabbit)
 *   slice     — destroy `value` cards out of the hand FOR THE FIGHT (Agatha)
 *   ward      — shield BOTH sisters for `value`% of the caster's max HP (Sinastra)
 *   morphBuff — the Depth Knight's compounding void power, +`value`%
 * Design rules (JC): stats match the creature fantasy (mammoth = tanky simple,
 * penguin = weak but squads up); regular enemies stay mechanically light;
 * worlds own their mechanics (I bleed · II freeze/brittle · III poison/fear);
 * bosses get signature uncounterable mechanics.
 *
 * Optional def fields:
 *   scale          — base sprite scale (multiplied by the arena slot's scaleMul)
 *   footFrac       — how far below the ground line the sprite FRAME bottoms out,
 *                    as a fraction of display height. Default 0.06 suits Caleb's
 *                    older frames; the 2026-07-31 boss batch is painted tight to
 *                    the bottom edge, so those override it (else they sink).
 *   spriteVariants — pick one texture at random per spawn (Below-Zero Skeletons)
 *   special        — id of a signature mechanic implemented in CombatScene.
 *                    PHASE 2 SHIPPED THESE: 'rooted' (passive: hand size -2),
 *                    'hopquake' (intent), 'summoner' (opener + summon intent),
 *                    'wintersForce' (passive: five-card hands only), 'slice'
 *                    (intent), 'ward' (intent), 'morph' (turn-cycle form swap).
 *                    THE 2026-08-02 WAVE ADDED THE ELITE TIER: 'shatterguard',
 *                    'feast', 'pack', 'glacialAegis', 'dreadGrip', 'rimeThorns',
 *                    'wakingWrath' — plus the boss's 'talonGrip'. Every one of
 *                    them is described in SIGNATURES below, which is the single
 *                    source the blurb, the badge and the tooltip all read.
 *   openers        — extra defs that join the boss at fight start (the Summoner
 *                    raises two skeletons before the first bell).
 *   slotCount      — force an ENEMY_SLOTS layout bigger than the opening
 *                    line-up, so mid-fight arrivals have a reserved position.
 *   startShield    — opens the fight already plated, `value`% of its own max HP
 *                    (Act II's Ice Elemental). Granted at spawn by CombatScene.
 *   flee           — CUT AND RUN: { turns, chips }. A countdown sits over its
 *                    head from the first bell; survive to the end of `turns` and
 *                    it takes `chips` off the purse and leaves the field. It is
 *                    NOT a kill and it does NOT cost the room (see
 *                    CombatScene.enemyFlees for the ruling).
 */

import {
  BIOME_EFFECT_TYPES, CARD_TAX_PER_CARD, CONDEMN_TURNS, DEMAND_HAND_DAMAGE,
  SHRINK_HAND_STEP, BLIND_CHANCE, MIRROR_HAND_CAP, mirrorHandDamage,
} from './biomes.js';
import { bossDamageFactor, enemyHpFactor } from './difficulty.js';
// The one number the FADE tooltips quote; scoring.js is a leaf, so this edge is free.
import { FADE_VANISH_CHANCE } from './scoring.js';
// The live run, for its DIFFICULTY only. run.js -> acts.js -> enemies.js means
// this closes an import cycle, which ESM is fine with here because `run` is
// never touched at module-evaluation time: both readers below are functions
// that only fire once a fight is being built. Do not move either one to the
// top level.
import { run } from './run.js';
import { devMult } from './settings.js';

const A = (value) => ({ type: 'attack', value });
const FX = (type, value = 1) => ({ type, value });
/**
 * A SWITCH, NOT A QUANTITY. Ten of the sixteen biome effects carry no number at
 * all -- SCAFFOLD raises a wall, THE QUEUE hangs a relic, WEIGHTLESS drops your
 * hand -- and the engine's dispatcher reads `eff.value ?? ITS_OWN_CONSTANT` for
 * the ones that DO. Emitting a switch through FX() would therefore hand the
 * engine a literal 1: the Pale Architect would demand the hand type named `1`.
 * BFX emits the bare effect so the engine's own number wins.
 *
 * The three that ARE quantities pass the ENGINE's constant explicitly rather
 * than relying on that fallback, so the hover sentence, the intent icon and
 * what actually lands are all reading the same number.
 */
const BFX = (type) => ({ type });
/** WARDING: plate `target` for `value`% of the CASTER's max HP (Sinastra's idiom). */
const SHIELD = (value, target = 'self') => ({ type: 'shield', value, target });

// ---------------------------------------------------------------------------
// THE ELITE & BOSS SIGNATURE NUMBERS (2026-08-02 wave, parts 3 and 4)
// ---------------------------------------------------------------------------
// Declared ABOVE the defs so the defs can be written in terms of them and no
// test ever has to hand-type one back. Every number JC named is here once.

/** E2 FEAST: the Bear Mauler heals this MANY TIMES the HP it takes off you. */
export const FEAST_MULT = 10;
/** E3 CALL OF THE PACK: never more than this many pack wolves alive at once. */
export const PACK_CAP = 2;
/** E4 GLACIAL AEGIS: IMMUNE on turn 2, then every 3rd turn (2, 5, 8, 11 ...). */
export const AEGIS_FIRST_TURN = 2;
export const AEGIS_PERIOD = 3;
/**
 * STILLNESS (The Long Sleeper, Ethereal Plains). It borrows the Aegis cadence
 * for its intangible half, and this is the other half: the fraction of its OWN
 * max HP it mends each time it goes under. Deliberately smaller than the damage
 * a good hand lands in the waking window, so resting is a clock the player can
 * beat rather than a wall they cannot.
 */
export const STILLNESS_MEND = 0.08;
/** E5 DREAD GRIP: cards off the deal, for the whole fight. */
export const DREAD_GRIP_POWER = 2;
/** E6 RIME THORNS, elite tier: SPIKES added every single turn. */
export const RIME_THORNS_ELITE = 5;
/** E7 WAKING WRATH: silent turn 1, printed turn 2, then ×1.6 a turn forever. */
export const WRATH_RAMP = 1.6;
/** B1 TALON GRIP: the suit Wolfowl's Bleed locks, and for how long. */
export const TALON_GRIP_SUIT = 'swords';
export const TALON_GRIP_TURNS = 1;
/** B2 HOPQUAKE: one quake every this many turns (was 3). */
export const HOPQUAKE_PERIOD = 2;
/** B3 DETHRONE: how long Sinastra adjourns the court. */
export const DETHRONE_TURNS = 2;

// --- THE THREE ALTERNATE BIOMES (2026-08-03) ------------------------------
/** THE HUNT: Strixursa never has more than this many Nightjars circling. */
export const HUNT_CAP = 2;
/** CUT THEM DOWN: the Gallows Tree never fields more than this many Condemned. */
export const GALLOWS_CAP = 3;

/** RAISE `minion` (Frozen Rite / Call of the Pack). */
const SUMMON = (minion, cap) => ({ type: 'summon', minion, cap });
/** RIME THORNS at elite strength, the effect that rides EVERY intent. */
const THORNS = () => ({ type: 'spikes', value: RIME_THORNS_ELITE });

export const ENEMY_DEFS = {
  // ============ ACT I — VERDANT FOREST (bleed world) ============
  wolfCub: {
    id: 'wolfCub', death: 'beast', name: 'Wolf Cub', sprite: 'enemy_wolf_cub', scale: 0.38,
    maxHp: 105, chips: 25,
    intents: [
      { label: 'Attack', effects: [A(6)] },
      { label: 'Attack', effects: [A(10)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Attack', effects: [A(11), FX('bleed', 1)] },
    ],
  },
  wildBoar: {
    id: 'wildBoar', death: 'beast', name: 'Wild Boar', sprite: 'enemy_wild_boar', scale: 0.40,
    maxHp: 135, chips: 30,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'Attack', effects: [A(10), FX('bleed', 1)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'Wild Charge', effects: [A(18)] },
    ],
  },
  greenSlime: {
    id: 'greenSlime', death: 'creature', name: 'Green Slime', sprite: 'enemy_green_slime', scale: 0.33,
    maxHp: 90, chips: 20,
    intents: [
      { label: 'Attack', effects: [A(6)] },
      { label: 'Attack', effects: [A(7)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Attack', effects: [A(10)] },
    ],
  },
  /**
   * E3 — CALL OF THE PACK. He is on the field with one wolf already beside him
   * and howls up another on every 3rd turn (intents 2 and 5, the Summoner's
   * cadence), never more than PACK_CAP alive at once. `slotCount: 3` reserves
   * the pedestal from the opening bell so an arrival never shuffles the line-up.
   */
  alphaWolf: {
    id: 'alphaWolf', death: 'beast', name: 'Alpha Wolf', sprite: 'enemy_alpha_wolf', scale: 0.48, elite: true,
    maxHp: 190, chips: 50,
    special: 'pack',
    openers: ['packWolf'],
    slotCount: 3,
    intents: [
      { label: 'Attack', effects: [A(11), FX('bleed', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'CALL OF THE PACK', effects: [SUMMON('packWolf', PACK_CAP)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'LUNGING BITE', effects: [A(22), FX('bleed', 2)] },
      { label: 'CALL OF THE PACK', effects: [SUMMON('packWolf', PACK_CAP)] },
    ],
  },
  /**
   * The Alpha's answered howl. Wolf-cub sized on purpose: two of them are a
   * distraction and a bleed clock, not a second elite. It counts as a WOLF for
   * the Wolfsbane Charm (artifacts.WOLF_IDS) and as a 'beast' for the Duck.
   */
  packWolf: {
    id: 'packWolf', death: 'beast', name: 'Pack Wolf', sprite: 'enemy_wolf_cub', scale: 0.34, minion: true,
    maxHp: 60, chips: 15,
    intents: [
      { label: 'Attack', effects: [A(6)] },
      { label: 'Attack', effects: [A(8), FX('bleed', 1)] },
      { label: 'Attack', effects: [A(7)] },
    ],
  },
  alphaBoar: {
    id: 'alphaBoar', death: 'beast', name: 'Alpha Boar', sprite: 'enemy_alpha_boar', scale: 0.48, elite: true,
    maxHp: 220, chips: 55,
    intents: [
      { label: 'Attack', effects: [A(12), FX('bleed', 2)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'RAMPAGE', effects: [A(24)] },
      { label: 'Attack', effects: [A(13)] },
    ],
  },
  treeBlight: {
    id: 'treeBlight', death: 'creature', name: 'Tree Blight', sprite: 'enemy_tree_blight', scale: 0.52, elite: true,
    maxHp: 250, chips: 60,
    intents: [
      { label: 'Attack', effects: [A(11), FX('bleed', 2)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      // BARK SKIN — Act I's face of WARDING. It plates itself, so the cyan ◆
      // chip has to be chewed through before the bar moves again.
      { label: 'BARK SKIN', effects: [SHIELD(12, 'self')] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'VERDANT CRUSH', effects: [A(23)] },
    ],
  },
  woodlingImp: {
    id: 'woodlingImp', death: 'humanoid', name: 'Woodling Imp', sprite: 'enemy_woodling_imp', scale: 0.34,
    maxHp: 85, chips: 22,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'Attack', effects: [A(9), FX('bleed', 1)] },
      // PICKPOCKET. The small fast annoying one takes a DISCARD, not HP.
      { label: 'Pickpocket', effects: [FX('stealDiscard', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  /**
   * CUT AND RUN, Act I. Same body as the Imp, its own name, one mechanic: a
   * three-turn countdown over its head and 150 chips out of the purse if you
   * let it finish. Losing the room to a timer would be a rage-quit mechanic, so
   * it isn't one — see CombatScene.enemyFlees.
   */
  woodlingCutpurse: {
    id: 'woodlingCutpurse', death: 'humanoid', name: 'Woodling Cutpurse', sprite: 'enemy_woodling_imp', scale: 0.34,
    maxHp: 85, chips: 22,
    flee: { turns: 3, chips: 150 },
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'Attack', effects: [A(9), FX('bleed', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  shroomFiend: {
    id: 'shroomFiend', death: 'creature', name: 'Shroom Fiend', sprite: 'enemy_shroom_fiend', scale: 0.36,
    maxHp: 125, chips: 28,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'Spore Cloud', effects: [FX('poison', 2)] },
      { label: 'Attack', effects: [A(11)] },
      // ROOTED, regular tier: one turn, one card off the deal.
      { label: 'ENTANGLE', effects: [FX('rooted', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  knightHawk: {
    id: 'knightHawk', death: 'beast', name: 'Knight Hawk', sprite: 'enemy_knight_hawk', scale: 0.36, flipX: true,
    maxHp: 100, chips: 26,
    intents: [
      { label: 'Attack', effects: [A(9), FX('bleed', 1)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'DIVE BOMB', effects: [A(17)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  /**
   * E2 — FEAST. Every point of HP it takes off you heals it FEAST_MULT times
   * over. Damage your Shield eats feeds it NOTHING, which is the whole
   * counterplay: plate up or burst it down, there is no third answer.
   */
  bearMauler: {
    id: 'bearMauler', death: 'beast', name: 'Bear Mauler', sprite: 'enemy_bear_mauler', scale: 0.5, elite: true,
    maxHp: 240, chips: 60,
    special: 'feast',
    intents: [
      { label: 'Attack', effects: [A(13), FX('bleed', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'MAUL', effects: [A(26), FX('bleed', 2)] },
      { label: 'Attack', effects: [A(14)] },
    ],
  },
  /**
   * B1 — TALON GRIP. Whenever Wolfowl inflicts BLEED it also rakes the SWORDS
   * out of your hand for TALON_GRIP_TURNS: discardable, never playable, exactly
   * the Keeper's treatment. It routes through applySuitSeal, so it is the same
   * denial gate every other lock uses and `deadlockState` sees it for free.
   * (JC said "dagger cards"; in this game that suit is Swords.)
   */
  wolfowl: {
    id: 'wolfowl', death: 'large', name: 'WOLFOWL', sprite: 'boss_wolfowl', scale: 0.68, boss: true,
    maxHp: 500, chips: 150,
    special: 'talonGrip',
    intents: [
      { label: 'Attack', effects: [A(12), FX('bleed', 2)] },
      { label: 'HYPNOTIC GAZE', effects: [FX('hypnotize')] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'SKY DIVE', effects: [A(30)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Attack', effects: [A(11), FX('bleed', 1)] },
    ],
  },

  // --- Act I alternate bosses (Caleb, 2026-07-31). One of the three is rolled
  //     per run at map generation; see acts.js `bosses` + core/run.js bossPick.
  fairyKing: {
    id: 'fairyKing', death: 'large', name: 'THE FAIRY KING', sprite: 'boss_fairy_king',
    scale: 0.64, footFrac: 0.045, boss: true,
    // 0.95x the act-I boss anchor (wolfowl 500).
    maxHp: 475, chips: 150,
    // ROOTED: passive whole-fight aura — your hand is dealt 2 cards smaller
    // (floored at 4 so Fear/potions can never brick the fight). No intent
    // carries it; CombatScene announces it after the entrance beat.
    special: 'rooted',
    intents: [
      { label: 'Bramble Lash', effects: [A(12), FX('bleed', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Attack', effects: [A(13)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'GRASPING ROOTS', effects: [A(28), FX('bleed', 1)] },
      { label: 'Attack', effects: [A(11), FX('bleed', 1)] },
    ],
  },
  sabreRabbit: {
    id: 'sabreRabbit', death: 'beast', name: 'SABRE-TOOTHED RABBIT', sprite: 'boss_sabre_rabbit',
    scale: 0.60, footFrac: 0.045, boss: true,
    // 0.9x the act-I boss anchor — fastest of the three, so it hits oftener.
    maxHp: 450, chips: 150,
    special: 'hopquake',
    /**
     * B2 (2026-08-02) — HOPQUAKE every HOPQUAKE_PERIOD turns, not every 3rd:
     * indices 1, 3 and 5 of the same 6-card deck, so half his rotation is a
     * scramble and there is never more than one clean turn between them.
     *
     * AND IT HITS ON THE QUAKE TURN. The quake intent carries A(18) beside
     * FX('quake') — it always did, and tests/systems.test.js now asserts it
     * rather than trusting the memory. The 'Attack A(13)' filler he used to
     * carry is what made room; his printed damage per rotation is essentially
     * unchanged (73 -> 78), it just arrives on shakier ground.
     */
    intents: [
      { label: 'Attack', effects: [A(12), FX('bleed', 1)] },
      { label: 'HOPQUAKE!', effects: [A(18), FX('quake')] },
      { label: 'FLURRY OF KICKS', effects: [A(10), A(10)] },
      { label: 'HOPQUAKE!', effects: [A(18), FX('quake')] },
      { label: 'SABRE POUNCE', effects: [A(20), FX('bleed', 1)] },
      { label: 'HOPQUAKE!', effects: [A(18), FX('quake')] },
    ],
  },

  // ============ ACT II — THE FROZEN WAYSIDE (freeze/brittle world) ============
  //
  // SCALES REBASED x1.5 ON 2026-08-06. Fourteen creatures across this act and
  // the Abyss shipped on a 1350x1275 canvas — an exact 1.5x of the standard
  // 900x850 enemy frame — with their `scale` dialled DOWN by two thirds to
  // compensate, so the game held 6.57 MB of decoded texture to draw a body it
  // then shrank. tools/normalize_enemy_frames.py put the art on the standard
  // frame and every affected `scale` here was multiplied by 1.5, which makes
  // the drawn size arithmetically identical (1350 x 0.30 == 900 x 0.45 == 405
  // px), not merely close. tools/verify_enemy_frames.py measures the before and
  // after in a live fight and gates at 1%. In this act: northernFighter,
  // iceElemental, yeti, woolyMammoth, alphaMammoth, frostGuardian,
  // winterPhoenix. Do NOT "tidy" these back down without re-cutting the art.
  northernFighter: {
    id: 'northernFighter', death: 'humanoid', name: 'Northern Fighter', sprite: 'en_northern_fighter', scale: 0.36,
    maxHp: 85, chips: 22,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'Attack', effects: [A(9)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  iceElemental: {
    id: 'iceElemental', death: 'creature', name: 'Ice Elemental', sprite: 'en_ice_elemental', scale: 0.39,
    maxHp: 100, chips: 25,
    // Opens the fight already plated (15% of its own health as FROST SHIELD).
    startShield: 15,
    intents: [
      { label: 'Attack', effects: [A(7), FX('freeze', 1)] },
      { label: 'Attack', effects: [A(9)] },
      { label: 'Freeze', effects: [FX('freeze', 2)] },
    ],
  },
  yeti: {
    id: 'yeti', death: 'beast', name: 'Yeti', sprite: 'en_yeti', scale: 0.45,
    maxHp: 175, chips: 40,
    intents: [
      { label: 'Attack', effects: [A(13)] },
      { label: 'Attack', effects: [A(11), FX('brittle', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Attack', effects: [A(17)] },
    ],
  },
  woolyMammoth: {
    id: 'woolyMammoth', death: 'beast', name: 'Wooly Mammoth', sprite: 'en_wooly_mammoth', scale: 0.48,
    maxHp: 260, chips: 45,
    intents: [
      { label: 'Attack', effects: [A(12)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'STAMPEDE', effects: [A(24)] },
    ],
  },
  alphaMammoth: {
    id: 'alphaMammoth', death: 'large', name: 'Alpha Wooly Mammoth', sprite: 'en_alpha_mammoth', scale: 0.57, elite: true,
    maxHp: 380, chips: 70,
    intents: [
      { label: 'Attack', effects: [A(16)] },
      { label: 'Attack', effects: [A(14), FX('brittle', 1)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'CRIMSON STAMPEDE', effects: [A(30)] },
    ],
  },
  /**
   * E4 — GLACIAL AEGIS. IMMUNE to everything on turn AEGIS_FIRST_TURN and every
   * AEGIS_PERIOD turns after it (2, 5, 8, 11 ...) — and it keeps acting while
   * the shell is up, so an immune turn still costs you HP. Reuses the Depth
   * Knight's shell aura and IMMUNE pop wholesale; the only new thing is the
   * cadence, which is derived (aegisImmuneOn) rather than stored.
   */
  frostGuardian: {
    id: 'frostGuardian', death: 'large', name: 'Frost Guardian', sprite: 'en_frost_guardian', scale: 0.54, elite: true,
    maxHp: 300, chips: 70,
    special: 'glacialAegis',
    intents: [
      { label: 'Attack', effects: [A(13), FX('freeze', 1)] },
      { label: 'Attack', effects: [A(16)] },
      { label: 'Freeze', effects: [FX('freeze', 2), FX('brittle', 1)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'AVALANCHE', effects: [A(26)] },
    ],
  },
  iceOwl: {
    id: 'iceOwl', death: 'beast', name: 'Ice Owl', sprite: 'en_ice_owl', scale: 0.42,
    maxHp: 95, chips: 25,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'Freeze', effects: [FX('freeze', 1)] },
      { label: 'Pickpocket', effects: [A(6), FX('stealDiscard', 1)] },
      { label: 'Attack', effects: [A(11)] },
    ],
  },
  /** CUT AND RUN, Act II. */
  iceOwlBandit: {
    id: 'iceOwlBandit', death: 'beast', name: 'Ice Owl Bandit', sprite: 'en_ice_owl', scale: 0.42,
    maxHp: 95, chips: 25,
    flee: { turns: 3, chips: 150 },
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'Freeze', effects: [FX('freeze', 1)] },
      { label: 'Attack', effects: [A(11)] },
    ],
  },
  iceMage: {
    id: 'iceMage', death: 'humanoid', name: 'Ice Mage', sprite: 'en_ice_mage', scale: 0.44,
    maxHp: 115, chips: 30,
    /**
     * The support body of the Wayside: it freezes, and it plates whatever you
     * are hitting.
     *
     * TRIM (JC's ruling, 2026-08-02): it also carried RIME SEAL, a one-turn
     * SEALED SUIT. Freeze + an ally plate + a suit seal is three mechanics on
     * one regular body — the definition of "busy", and it was the only regular
     * in the game carrying two of this wave's mechanics. The seal is gone from
     * here; Act III's Lonely Wraith still owns SEALED SUIT, so the mechanic
     * stays in the game. TO REVERT: put back
     *   { label: 'RIME SEAL', effects: [FX('suitSeal', 1)] },
     * between 'Attack' and 'Charging...' (and re-point the two tests that name
     * the Ice Mage as a suitSeal owner back at it).
     */
    intents: [
      { label: 'Freeze', effects: [FX('freeze', 2)] },
      { label: 'FROST SHIELD', effects: [SHIELD(20, 'ally')] },
      { label: 'Attack', effects: [A(9)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'ICE LANCE', effects: [A(18), FX('freeze', 1)] },
    ],
  },
  resurrectedEskimo: {
    id: 'resurrectedEskimo', death: 'humanoid', name: 'Resurrected Eskimo', sprite: 'en_resurrected_eskimo', scale: 0.46,
    maxHp: 150, chips: 32,
    intents: [
      { label: 'Attack', effects: [A(10)] },
      { label: 'Attack', effects: [A(12), FX('brittle', 1)] },
      { label: 'COURT ADJOURNED', effects: [FX('courtLock', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  subZeroSerpent: {
    id: 'subZeroSerpent', death: 'creature', name: 'Sub-Zero Serpent', sprite: 'en_subzero_serpent', scale: 0.53, flipX: true,
    maxHp: 170, chips: 38,
    intents: [
      { label: 'Attack', effects: [A(11), FX('freeze', 1)] },
      // RIME THORNS at regular strength. Spikes never fade, so this is the
      // "kill it early or turtle" clock — the elite tier of the same idea is
      // this number, larger, every turn.
      { label: 'RIME THORNS', effects: [FX('spikes', 2)] },
      { label: 'Coiling...', effects: [FX('charge')] },
      { label: 'GLACIAL CRUSH', effects: [A(22)] },
      { label: 'Attack', effects: [A(13)] },
    ],
  },
  /**
   * E6 — RIME THORNS, elite tier. The regular Serpent adds 2 SPIKES on ONE turn
   * of its rotation; the Elder adds RIME_THORNS_ELITE on EVERY turn, including
   * the one it spends coiling. Spikes never fade, so its whole fight is a
   * rising toll on the act of playing a hand: kill it early or turtle.
   */
  subZeroElder: {
    id: 'subZeroElder', death: 'creature', name: 'Elder Sub-Zero Serpent',
    sprite: 'en_subzero_serpent', scale: 0.62, flipX: true, elite: true,
    maxHp: 320, chips: 75,
    special: 'rimeThorns',
    intents: [
      { label: 'THORNED STRIKE', effects: [A(12), THORNS()] },
      { label: 'RIME THORNS', effects: [FX('freeze', 2), THORNS()] },
      { label: 'Coiling...', effects: [FX('charge'), THORNS()] },
      { label: 'GLACIAL CRUSH', effects: [A(28), THORNS()] },
      { label: 'THORNED LASH', effects: [A(15), FX('brittle', 1), THORNS()] },
    ],
  },
  /**
   * E1 — SHATTERGUARD. You gain NO Shield for the whole fight: every grant in
   * the game funnels through CombatScene.shieldGain, so this is one clause and
   * every source (a hand, a relic, a potion, an event's blessing) is covered.
   * JC's number, and it is deliberately absolute — see the note on the Bulwark
   * in docs/MECHANICS_WAVE.txt.
   */
  frostTitan: {
    id: 'frostTitan', death: 'large', name: 'Frost Titan', sprite: 'en_frost_titan', scale: 0.69, elite: true,
    maxHp: 340, chips: 75,
    special: 'shatterguard',
    intents: [
      { label: 'Attack', effects: [A(15), FX('brittle', 1)] },
      { label: 'Freeze', effects: [FX('freeze', 2)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'TITAN SLAM', effects: [A(30)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
    ],
  },
  winterPhoenix: {
    id: 'winterPhoenix', death: 'large', name: 'THE WINTER PHOENIX', sprite: 'boss_winter_phoenix', scale: 0.75, boss: true, flipX: true,
    maxHp: 640, chips: 200,
    intents: [
      { label: 'Attack', effects: [A(14)] },
      { label: 'BLIZZARD', effects: [A(8), FX('freeze', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'AVALANCHE DIVE', effects: [A(30)] },
      { label: 'Attack', effects: [A(12), FX('brittle', 1)] },
    ],
  },

  // --- Act II alternate bosses + the Summoner's minion (Caleb, 2026-07-31) ---
  frostSummoner: {
    id: 'frostSummoner', death: 'humanoid', name: 'THE FROSTBITTEN SUMMONER', sprite: 'boss_frost_summoner',
    scale: 0.66, footFrac: 0.035, boss: true,
    // 0.75x the act-II boss anchor (winterPhoenix 640) — his skeletons soak too.
    maxHp: 480, chips: 200,
    special: 'summoner',
    // FROZEN RITE: he opens flanked by two skeletons and raises another on
    // every 3rd turn (indices 2 and 5), capped at three living minions.
    // `slotCount: 4` reserves the empty pedestal from the very first bell so
    // a mid-fight arrival never has to shuffle the line-up.
    openers: ['bzSkeleton', 'bzSkeleton'],
    slotCount: 4,
    intents: [
      { label: 'Attack', effects: [A(12), FX('freeze', 1)] },
      { label: 'Rite of Frost', effects: [FX('freeze', 2), FX('brittle', 1)] },
      { label: 'FROZEN RITE', effects: [FX('summon')] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'GRAVE FROST', effects: [A(26), FX('freeze', 1)] },
      { label: 'FROZEN RITE', effects: [FX('summon')] },
    ],
  },
  polarGuardian: {
    id: 'polarGuardian', death: 'large', name: 'THE POLAR GUARDIAN', sprite: 'boss_polar_guardian',
    scale: 0.73, footFrac: 0.035, boss: true,
    // 1.25x the act-II boss anchor, and the hardest hitter in the Wayside.
    maxHp: 800, chips: 200,
    // WINTER'S FORCE: passive aura — only hands of EXACTLY five cards may be
    // played. His deck therefore must never cast FEAR (it caps your selection
    // below five and would deadlock the fight); freeze is fine, because the
    // hand is eight cards deep and frozen cards thaw when he next acts.
    special: 'wintersForce',
    intents: [
      { label: 'Attack', effects: [A(18)] },
      { label: 'Attack', effects: [A(16), FX('brittle', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 6)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'GLACIER SLAM', effects: [A(38)] },
      { label: 'Attack', effects: [A(15), FX('freeze', 1)] },
    ],
  },
  /**
   * The Summoner's raised dead. `spriteVariants` — CombatScene picks one of the
   * three textures at spawn, so a raised trio never looks copy-pasted.
   * ~11% of the act-II boss anchor each: three of them = a third boss of HP.
   */
  bzSkeleton: {
    id: 'bzSkeleton', death: 'humanoid', name: 'Below-Zero Skeleton', sprite: 'en_bz_skeleton_1',
    spriteVariants: ['en_bz_skeleton_1', 'en_bz_skeleton_2', 'en_bz_skeleton_3'],
    scale: 0.44, minion: true,
    maxHp: 70, chips: 18,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'Attack', effects: [A(9), FX('freeze', 1)] },
      { label: 'Attack', effects: [A(8)] },
    ],
  },

  // ============ ACT III — THE ABYSS (poison/fear world) ============
  // SCALES REBASED x1.5 ON 2026-08-06 — see the note over ACT II. The seven
  // here: lonelyWraith, abyssalWarrior, deepSerpent, undeadGuardian,
  // ancientGuardian, wellOfSouls, theKeeper.
  lonelyWraith: {
    id: 'lonelyWraith', death: 'humanoid', name: 'Lonely Wraith', sprite: 'en_lonely_wraith', scale: 0.39,
    maxHp: 130, chips: 35,
    intents: [
      { label: 'Attack', effects: [A(8), FX('fear', 1)] },
      { label: 'Attack', effects: [A(11)] },
      { label: 'SEAL OF SILENCE', effects: [FX('suitSeal', 1)] },
      { label: 'Fear', effects: [FX('fear', 2)] },
    ],
  },
  abyssalWarrior: {
    id: 'abyssalWarrior', death: 'humanoid', name: 'Abyssal Warrior', sprite: 'en_abyssal_warrior', scale: 0.45,
    maxHp: 180, chips: 40,
    intents: [
      { label: 'Attack', effects: [A(14)] },
      { label: 'Attack', effects: [A(10), FX('poison', 3)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'ABYSSAL CLEAVE', effects: [A(24)] },
    ],
  },
  deepSerpent: {
    id: 'deepSerpent', death: 'creature', name: 'Deep Serpent', sprite: 'en_deep_serpent', scale: 0.45,
    maxHp: 160, chips: 40,
    intents: [
      { label: 'Attack', effects: [A(9), FX('poison', 4)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Attack', effects: [A(13)] },
      { label: 'Poison', effects: [FX('poison', 5)] },
    ],
  },
  undeadGuardian: {
    id: 'undeadGuardian', death: 'humanoid', name: 'Undead Guardian', sprite: 'en_undead_guardian', scale: 0.45,
    maxHp: 280, chips: 45,
    intents: [
      { label: 'Attack', effects: [A(12)] },
      { label: 'GRAVE SHELL', effects: [SHIELD(15, 'ally')] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Attack', effects: [A(18)] },
    ],
  },
  ancientGuardian: {
    id: 'ancientGuardian', death: 'large', name: 'Ancient Guardian', sprite: 'en_ancient_guardian', scale: 0.57, elite: true,
    maxHp: 420, chips: 80,
    intents: [
      { label: 'Attack', effects: [A(17)] },
      { label: 'Attack', effects: [A(15), FX('fear', 1)] },
      { label: 'GRAVE SHELL', effects: [SHIELD(12, 'self')] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'ANCIENT WRATH', effects: [A(32)] },
    ],
  },
  wellOfSouls: {
    id: 'wellOfSouls', death: 'creature', name: 'The Well of Souls', sprite: 'en_well_of_souls', scale: 0.51, elite: true,
    maxHp: 320, chips: 80,
    intents: [
      { label: 'Attack', effects: [A(11), FX('poison', 3)] },
      { label: 'Fear', effects: [FX('fear', 2)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'SOUL ERUPTION', effects: [A(26), FX('poison', 3)] },
    ],
  },
  corruptedCrow: {
    id: 'corruptedCrow', death: 'beast', name: 'Corrupted Crow', sprite: 'en_corrupted_crow', scale: 0.41, flipX: true,
    maxHp: 120, chips: 32,
    intents: [
      { label: 'Attack', effects: [A(9), FX('poison', 2)] },
      { label: 'Fear', effects: [FX('fear', 1)] },
      { label: 'Pickpocket', effects: [A(8), FX('stealDiscard', 1)] },
      { label: 'Attack', effects: [A(12)] },
    ],
  },
  /** CUT AND RUN, Act III. */
  coinsnatchCrow: {
    id: 'coinsnatchCrow', death: 'beast', name: 'Coinsnatch Crow', sprite: 'en_corrupted_crow', scale: 0.41, flipX: true,
    maxHp: 120, chips: 32,
    flee: { turns: 3, chips: 150 },
    intents: [
      { label: 'Attack', effects: [A(9), FX('poison', 2)] },
      { label: 'Fear', effects: [FX('fear', 1)] },
      { label: 'Attack', effects: [A(12)] },
    ],
  },
  ancientSlime: {
    id: 'ancientSlime', death: 'creature', name: 'Ancient Slime', sprite: 'en_ancient_slime', scale: 0.5,
    maxHp: 200, chips: 40,
    intents: [
      { label: 'Attack', effects: [A(10), FX('poison', 3)] },
      { label: 'ENGULF', effects: [FX('rooted', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Acid Spray', effects: [FX('poison', 4)] },
    ],
  },
  ancientNecromancer: {
    id: 'ancientNecromancer', death: 'humanoid', name: 'Ancient Necromancer', sprite: 'en_ancient_necromancer', scale: 0.51,
    maxHp: 170, chips: 45,
    intents: [
      { label: 'Fear', effects: [FX('fear', 2)] },
      { label: 'Attack', effects: [A(12), FX('poison', 2)] },
      { label: 'COURT ADJOURNED', effects: [FX('courtLock', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'SOUL BLAST', effects: [A(24)] },
    ],
  },
  /**
   * E5 — DREAD GRIP. Hand size −DREAD_GRIP_POWER for the WHOLE fight, taken
   * through the ordinary ROOTED door with `Infinity` turns (tickPlayerDebuffs
   * treats Infinity as forever, so there is no second code path). It stacks
   * sanely with the Fairy King's aura and still floors at HAND_SIZE_FLOOR.
   */
  twinsOfDarkness: {
    id: 'twinsOfDarkness', death: 'large', name: 'Twins of Darkness', sprite: 'en_twins_of_darkness', scale: 0.66, elite: true,
    maxHp: 400, chips: 85,
    special: 'dreadGrip',
    intents: [
      { label: 'Attack', effects: [A(14), FX('poison', 3)] },
      { label: 'Fear', effects: [FX('fear', 2)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'TWIN RIP', effects: [A(17), A(17)] },
      { label: 'Attack', effects: [A(16)] },
    ],
  },
  /**
   * E7 — WAKING WRATH. The heaviest elite in the game's deepest act, and it is
   * asleep: turn 1 deals NOTHING, turn 2 deals what is printed, and from turn 3
   * its damage compounds ×WRATH_RAMP every turn, forever. Set it up, then
   * delete it.
   *
   * THE CLIFF IS VISIBLE. The ramp rides `enemy.voidPower`, which currentIntent
   * already folds into the telegraphed number, so the intent icon says 300
   * before you commit the hand that lets turn 5 happen. A surprise cliff is
   * just an unfair death; a signposted one is a race.
   *
   * HP IS UNCHANGED at 460 (still the biggest Act III elite, 15,456 in the
   * fight). The spec asked for a "big HP pool" and it already has one: the
   * act's locked elite:boss ratio band (tests/systems.test.js) leaves room for
   * exactly +4 HP before the invariant breaks, so the pool stays put and the
   * TIMER is the whole mechanic. Flagged for JC.
   */
  acidicMonstrosity: {
    id: 'acidicMonstrosity', death: 'large', name: 'Acidic Monstrosity', sprite: 'en_acidic_monstrosity', scale: 0.72, elite: true,
    maxHp: 460, chips: 90,
    special: 'wakingWrath',
    intents: [
      { label: 'Attack', effects: [A(16), FX('poison', 4)] },
      { label: 'Acid Wave', effects: [FX('poison', 5)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'MELTDOWN', effects: [A(36)] },
    ],
  },
  theKeeper: {
    id: 'theKeeper', death: 'keeper', name: 'THE KEEPER', sprite: 'boss_keeper', scale: 0.72, boss: true,
    maxHp: 800, chips: 250,
    intents: [
      { label: 'Attack', effects: [A(16)] },
      { label: 'ETERNAL KEEP', effects: [FX('suitban')] },
      { label: 'Attack', effects: [A(12), FX('poison', 4)] },
      { label: 'Charging...', effects: [FX('charge')] },
      { label: 'JUDGEMENT', effects: [A(34)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
    ],
  },

  // --- Act III alternate bosses (Caleb, 2026-07-31) ---
  /**
   * THE DAUGHTERS OF DARKNESS — ONE encounter, two bodies. On the map they are
   * named together; in the fight each nameplate is her own (def.name).
   */
  agatha: {
    id: 'agatha', death: 'humanoid', name: 'Agatha', sprite: 'boss_agatha',
    scale: 0.70, footFrac: 0.04, boss: true,
    // 0.625x the act-III boss anchor (theKeeper 800). The sister with the
    // blade. The pair is budgeted to sum to EXACTLY one boss: 0.625 + 0.375,
    // a 62/38 split of the act's 30,000 (Agatha 18,750 · Sinastra 11,250).
    maxHp: 500, chips: 160,
    special: 'slice',
    // SLICE lands every 3rd turn (indices 2 and 5): two cards are cut out of
    // the hand and are GONE for this fight — not discarded, not destroyed
    // permanently. They are runDeck references, so next fight's shuffle
    // restores them with no bookkeeping at all.
    intents: [
      { label: 'Attack', effects: [A(18)] },
      { label: 'CRESCENT CUT', effects: [A(22), FX('fear', 1)] },
      { label: 'SLICE', effects: [FX('slice', 2)] },
      { label: 'Attack', effects: [A(16), FX('poison', 3)] },
      { label: "SISTER'S EDGE", effects: [A(32)] },
      { label: 'SLICE', effects: [FX('slice', 2)] },
    ],
  },
  sinastra: {
    id: 'sinastra', death: 'humanoid', name: 'Sinastra', sprite: 'boss_sinastra',
    scale: 0.67, footFrac: 0.04, boss: true,
    // 0.375x the anchor — the smaller half of the duo's one-boss budget.
    // Weak swings; she is here to make Agatha worse.
    maxHp: 300, chips: 120,
    // SISTERS' WARD: the buff self-empowers her (engine), and the `ward`
    // effect carries the other half — it empowers AND shields BOTH daughters
    // for `value`% of Sinastra's max HP. Kill her and the wards stop coming.
    //
    // B3 DETHRONE (2026-08-02): she also adjourns the court for DETHRONE_TURNS
    // — J, Q and K unplayable — once per rotation, and killing her stops that
    // too. It replaces her old 'Warding Hex' (fear 2) rather than being added
    // on top: her job is to make Agatha worse, not to out-damage her, and the
    // whole point is to sharpen the existing "kill Sinastra first" decision
    // into a real one.
    special: 'ward',
    intents: [
      { label: "SISTERS' WARD", effects: [FX('buff', 4), FX('ward', 9)] },
      { label: 'Attack', effects: [A(9), FX('poison', 3)] },
      { label: 'DETHRONE', effects: [FX('courtLock', DETHRONE_TURNS)] },
      { label: 'Attack', effects: [A(11)] },
      { label: "SISTERS' WARD", effects: [FX('buff', 5), FX('ward', 9)] },
      { label: 'Attack', effects: [A(8), FX('poison', 4)] },
    ],
  },
  depthKnight: {
    id: 'depthKnight', death: 'large', name: 'THE DEPTH KNIGHT', sprite: 'boss_depth_knight_atk',
    scale: 0.70, boss: true,
    /**
     * `spriteAlt` — the SECOND texture this body wears, declared here so the
     * asset loader can see it (core/lazyload.js walks it with `sprite`,
     * `spriteVariants` and `spriteForHero`). CombatScene.groundSprite still
     * names 'boss_depth_knight_def' at the call site, because the swap is
     * choreography and not data; this field exists purely so the shell is
     * already in the cache the turn he raises it, rather than popping in.
     */
    spriteAlt: ['boss_depth_knight_def'],
    /**
     * 0.70x the act-III boss anchor (theKeeper 800) = 21,000 in the fight.
     * He is IMMUNE on every DEF turn, so you only get HALF the damage windows
     * the Keeper gives you: 21k across ~4 open turns is ~5,250 a hand against
     * the Keeper's ~4,286 across 7 — a 1.22x ask, i.e. ~42k of effective
     * pressure. The ratio is SCALE-FREE, which is why it survived the x7.81
     * raise and the 2026-07-31 re-anchor back down untouched. (JC: tune here
     * first.)
     */
    maxHp: 560, chips: 250,
    special: 'morph',
    /**
     * MORPH — sprite 'boss_depth_knight_def' at scale 0.73 for the shell.
     * The deck has an EVEN number of intents and strictly alternates
     * attack / void-shell, so form parity (even index = ATK, odd = DEF) holds
     * forever, however many times the deck loops. His power COMPOUNDS +75%
     * on each shell turn (morphBuff) — UNCHANGED through the synergy-era HP
     * raise, because the ramp only had to stay lethal for two more turns and
     * it already does. Against an 80-max-HP player his open turns read:
     *
     *   t1 10 · t3 21 · t5 43 · t7 113 · t9 94 · t11 197 · t13 402
     *
     * so t7 is still the wall, and even a fight that runs two turns long dies
     * on t9 (94 = 117% of max HP). The t7→t9 dip is the deck looping back to
     * its cheapest strike; +75% covers it before t11. Do not "fix" the dip by
     * raising the printed damage — that would make the OPENING turns harsher,
     * which is the one thing this fight must not be.
     */
    intents: [
      { label: 'Void Strike', effects: [A(6)] },
      { label: 'VOID SHELL', effects: [FX('morphBuff', 75)] },
      { label: 'Void Strike', effects: [A(7)] },
      { label: 'VOID SHELL', effects: [FX('morphBuff', 75)] },
      { label: 'Rending Void', effects: [A(8), FX('fear', 1)] },
      { label: 'VOID SHELL', effects: [FX('morphBuff', 75)] },
      { label: 'VOID DETONATION', effects: [A(12)] },
      { label: 'VOID SHELL', effects: [FX('morphBuff', 75)] },
    ],
  },

  // =========================================================================
  // ACT I ALTERNATE — THE NOCTURNAL FOREST (BLIND world)
  // =========================================================================
  /**
   * The Verdant Forest after dark, and not the same wood. It is an ALTERNATE
   * Act I, not a fourth act: a run rolls one or the other (see acts.ALT_ACTS and
   * run.actPicks), so it inherits Act I's FROZEN tuning byte for byte — the same
   * curve, the same 1.8x boss anchor, no eliteHpMult, and printed HP inside Act
   * I's own bands (regulars 85-135, elites 190-250, bosses 450-500).
   *
   * BLIND is the biome's mechanic and it is the cheapest kind of harm there is:
   * a blinded card turns FACE DOWN in your hand and is still playable. It denies
   * INFORMATION, never the card, which is exactly why it belongs to the
   * tutorial act. It is deliberately NOT in DENIAL_EFFECTS for that reason: a
   * regular may blind and root on the same turn without breaking the per-intent
   * denial cap, because only one of those two takes a card away from you.
   */
  mothling: {
    id: 'mothling', death: 'creature', name: 'Mothling', sprite: 'en_mothling', scale: 0.39,
    maxHp: 90, chips: 20,
    intents: [
      { label: 'Attack', effects: [A(6)] },
      { label: 'Attack', effects: [A(9)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Attack', effects: [A(11)] },
    ],
  },
  lanternToad: {
    id: 'lanternToad', death: 'creature', name: 'Lantern Toad', sprite: 'en_lantern_toad', scale: 0.35,
    maxHp: 130, chips: 28,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      // THE LURE. Act I's face of BLIND: one card, face down, still yours.
      { label: 'THE LURE', effects: [FX('blind', 1)] },
      { label: 'Attack', effects: [A(10)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  nightjar: {
    id: 'nightjar', death: 'beast', name: 'Nightjar', sprite: 'en_nightjar', scale: 0.49,
    maxHp: 80, chips: 24,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'Silent Stoop...', effects: [FX('charge')] },
      { label: 'SILENT STOOP', effects: [A(15)] },
      { label: 'Attack', effects: [A(9)] },
    ],
  },
  brambleStalker: {
    id: 'brambleStalker', death: 'creature', name: 'Bramble Stalker', sprite: 'en_bramble_stalker', scale: 0.29,
    maxHp: 120, chips: 28,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'SNARE', effects: [FX('rooted', 1)] },
      { label: 'Attack', effects: [A(12)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  hollowFawn: {
    id: 'hollowFawn', death: 'beast', name: 'Hollow Fawn', sprite: 'en_hollow_fawn', scale: 0.29,
    maxHp: 105, chips: 26,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'Attack', effects: [A(10)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Lowering antlers...', effects: [FX('charge')] },
      { label: 'SKULL CHARGE', effects: [A(16)] },
    ],
  },
  glowcapShambler: {
    id: 'glowcapShambler', death: 'creature', name: 'Glowcap Shambler', sprite: 'en_glowcap_shambler', scale: 0.31,
    maxHp: 145, chips: 30,
    intents: [
      { label: 'Attack', effects: [A(9)] },
      // The Nocturnal Forest's WARDING body, on the Tree Blight's idiom.
      { label: 'SPORE CRUST', effects: [SHIELD(12, 'self')] },
      { label: 'Attack', effects: [A(12)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  dreamweaverSpider: {
    id: 'dreamweaverSpider', death: 'creature', name: 'Dreamweaver Spider', sprite: 'en_dreamweaver_spider', scale: 0.38,
    maxHp: 115, chips: 30,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'SILVER SILK', effects: [FX('blind', 2)] },
      { label: 'Attack', effects: [A(11)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  /** CUT AND RUN, the Nocturnal Forest. One entry, LATE pool only. */
  pocketMoth: {
    id: 'pocketMoth', death: 'creature', name: 'Pocket Moth', sprite: 'en_pocket_moth', scale: 0.45,
    maxHp: 90, chips: 22,
    flee: { turns: 3, chips: 150 },
    intents: [
      { label: 'Attack', effects: [A(7)] },
      { label: 'Attack', effects: [A(9)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  /**
   * THE HUNT's answered call. Nightjar-sized on purpose: two of them are a
   * distraction, not a second elite, exactly as the Alpha Wolf's pack is.
   */
  huntNightjar: {
    id: 'huntNightjar', death: 'beast', name: 'Circling Nightjar', sprite: 'en_nightjar', scale: 0.38, minion: true,
    maxHp: 55, chips: 14,
    intents: [
      { label: 'Attack', effects: [A(6)] },
      { label: 'Attack', effects: [A(8)] },
      { label: 'Attack', effects: [A(7)] },
    ],
  },
  /**
   * MOONGLARE. Two cards go face down EVERY turn, including the turn it spends
   * winding up, so you never once get to read your whole hand before you commit.
   * BREAKS: reading your hand before you commit.
   */
  sleeplessStag: {
    id: 'sleeplessStag', death: 'beast', name: 'The Sleepless Stag', sprite: 'en_sleepless_stag', scale: 0.47, elite: true,
    maxHp: 200, chips: 50,
    special: 'moonglare',
    intents: [
      { label: 'Attack', effects: [A(11), FX('blind', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 3), FX('blind', 2)] },
      { label: 'Lanterns swinging...', effects: [FX('charge'), FX('blind', 2)] },
      { label: 'MOONGLARE', effects: [A(22), FX('blind', 2)] },
      { label: 'Attack', effects: [A(13), FX('blind', 2)] },
    ],
  },
  /**
   * SILKBOUND. She names a suit and it deals her NOTHING until she names
   * another, so the suit you have built around is the one suit that cannot hurt
   * her. BREAKS: leaning on your best suit.
   */
  widowCanopy: {
    id: 'widowCanopy', death: 'creature', name: 'Widow of the Canopy', sprite: 'en_widow_canopy', scale: 0.47, elite: true,
    maxHp: 215, chips: 55,
    special: 'silkbound',
    intents: [
      { label: 'SILKBOUND', effects: [A(12), BFX('forgetSuit')] },
      { label: 'Attack', effects: [A(15)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Drawing silk...', effects: [FX('charge')] },
      { label: 'BINDING WEAVE', effects: [A(24), BFX('forgetSuit')] },
    ],
  },
  /**
   * THE HUNT. She is on the field with two Nightjars already circling and calls
   * more as they fall, never more than two alive at once. `slotCount: 3` books
   * the pedestals from the opening bell so an arrival never shuffles the
   * line-up. BREAKS: single-target damage builds.
   */
  strixursa: {
    id: 'strixursa', death: 'beast', name: 'Strixursa', sprite: 'en_strixursa', scale: 0.47, elite: true,
    maxHp: 190, chips: 50,
    special: 'hunt',
    openers: ['huntNightjar', 'huntNightjar'],
    slotCount: 3,
    intents: [
      { label: 'Attack', effects: [A(12)] },
      { label: 'THE HUNT', effects: [SUMMON('huntNightjar', HUNT_CAP)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Silent...', effects: [FX('charge')] },
      { label: 'TALON AND JAW', effects: [A(23)] },
      { label: 'THE HUNT', effects: [SUMMON('huntNightjar', HUNT_CAP)] },
    ],
  },
  /**
   * REFLECTION. Every point of HP you heal, it heals too. The mirror image of
   * the Bear Mauler's FEAST: the Mauler punishes taking damage, the Moonwell
   * punishes undoing it. BREAKS: healing sustain, and Zelus specifically.
   */
  moonwellHorror: {
    id: 'moonwellHorror', death: 'creature', name: 'The Moonwell Horror', sprite: 'en_moonwell_horror', scale: 0.54, elite: true,
    maxHp: 230, chips: 55,
    special: 'reflection',
    intents: [
      { label: 'REFLECTION', effects: [A(10), BFX('healMirror')] },
      { label: 'Attack', effects: [A(13)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'The water stills...', effects: [FX('charge')] },
      { label: 'PALE HANDS', effects: [A(24)] },
    ],
  },
  /**
   * B — SCALE DUST. Her wings shed luminous dust over the whole fight and your
   * hand comes to you half unread.
   *
   * SHORTFALL, FLAGGED: the design is "one in every two cards you DRAW comes to
   * hand blind, all fight", which is a draw-time aura. The locked effect
   * vocabulary only offers `blind {value}` (blind N cards NOW), so she casts it
   * every single turn instead. Same felt experience, different plumbing; see
   * docs/PATCH_ORACLE.txt's ADDENDUM if a draw-time hook is ever added.
   */
  nightMother: {
    id: 'nightMother', death: 'large', name: 'THE NIGHT MOTHER', sprite: 'boss_night_mother',
    scale: 0.68, boss: true,
    // 1.0x the act-I boss anchor (wolfowl 500) — the flagship of the wood.
    maxHp: 500, chips: 150,
    special: 'scaleDust',
    intents: [
      { label: 'SCALE DUST', effects: [A(11), FX('blind', 2)] },
      { label: 'Attack', effects: [A(14), FX('blind', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 4), FX('blind', 2)] },
      { label: 'Wings rising...', effects: [FX('charge'), FX('blind', 2)] },
      { label: 'POWDERED WING', effects: [A(29), FX('blind', 2)] },
      { label: 'Attack', effects: [A(12), FX('blind', 2)] },
    ],
  },
  /**
   * B — THE COURT SLEEPS. Face cards cannot be PLAYED while he lives: the lock
   * is cast once, for Infinity turns, exactly the way DREAD GRIP takes its
   * whole-fight hand penalty through the ordinary ROOTED door.
   *
   * SHORTFALL, FLAGGED: the design's second half is "every face card you DISCARD
   * makes him hit harder", and there is no discard-time effect type in the
   * locked vocabulary. He carries heavier Strengthen turns instead, so the
   * pressure still climbs; it just is not YOU feeding it.
   */
  hollowKing: {
    id: 'hollowKing', death: 'large', name: 'THE HOLLOW KING', sprite: 'boss_hollow_king',
    scale: 0.67, boss: true,
    // 0.96x the act-I boss anchor. He locks a third of the deck out, so he
    // sits a touch under the Night Mother rather than over her.
    maxHp: 480, chips: 150,
    special: 'courtSleeps',
    intents: [
      { label: 'THE COURT SLEEPS', effects: [A(10), FX('courtLock', Infinity)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Strengthen', effects: [FX('buff', 5)] },
      { label: 'Lanterns guttering...', effects: [FX('charge')] },
      { label: 'ANTLER CROWN', effects: [A(28)] },
      { label: 'Attack', effects: [A(12)] },
    ],
  },
  /**
   * B — HE SEES IT COMING. Each turn he names one card in your hand; play it and
   * the whole hand deals him nothing. BREAKS: always playing your strongest
   * available card. This is `markCard` from the locked vocabulary, verbatim.
   */
  grimwatch: {
    id: 'grimwatch', death: 'large', name: 'GRIMWATCH, THE THOUSAND-EYED', sprite: 'boss_grimwatch',
    scale: 0.67, boss: true,
    // 0.92x the act-I boss anchor — the fastest read of the three, so he is the
    // smallest pool. (Wolfowl 500 -> 460.)
    maxHp: 460, chips: 150,
    special: 'seesItComing',
    intents: [
      { label: 'HE SEES IT COMING', effects: [A(11), BFX('markCard')] },
      { label: 'Attack', effects: [A(14), BFX('markCard')] },
      { label: 'Strengthen', effects: [FX('buff', 4), BFX('markCard')] },
      { label: 'Every eye opens...', effects: [FX('charge'), BFX('markCard')] },
      { label: 'THOUSAND STARES', effects: [A(30), BFX('markCard')] },
      { label: 'Attack', effects: [A(12), BFX('markCard')] },
    ],
  },

  // =========================================================================
  // ACT II ALTERNATE — THE ETHEREAL PLAINS (FADE world)
  // =========================================================================
  /**
   * Not the Abyss. Bright, weightless, empty. An ALTERNATE Act II, so it
   * inherits the Frozen Wayside's tuning exactly: curve, dmgBase 1.2, fx 1,
   * bossHpMult 5.46875, eliteHpMult 4.5. Printed HP therefore sits inside Act
   * II's own bands (regulars 85-260, elites 300-380, bosses 480-800).
   *
   * FADE is the ethereal downside with the upside stripped out: a faded card
   * becomes ETHEREAL for the fight and gains NO bonus mult for it, so it may
   * simply vanish forever when it scores. Act II costs you cards.
   */
  veilkin: {
    id: 'veilkin', death: 'humanoid', name: 'Veilkin', sprite: 'en_veilkin', scale: 0.35,
    maxHp: 110, chips: 24,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'Attack', effects: [A(11)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
      { label: 'Attack', effects: [A(13)] },
    ],
  },
  moteSwarm: {
    id: 'moteSwarm', death: 'creature', name: 'Mote Swarm', sprite: 'en_mote_swarm', scale: 0.36, flipX: true,
    maxHp: 95, chips: 22,
    intents: [
      { label: 'Attack', effects: [A(7)] },
      // Act II's face of FADE: one card starts fading, and pays nothing for it.
      { label: 'UNRAVEL', effects: [FX('fade', 1)] },
      { label: 'Attack', effects: [A(10)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  echoKnight: {
    id: 'echoKnight', death: 'humanoid', name: 'Echo of a Knight', sprite: 'en_echo_knight', scale: 0.35,
    maxHp: 155, chips: 32,
    intents: [
      { label: 'Attack', effects: [A(10)] },
      { label: 'Winding back...', effects: [FX('charge')] },
      { label: 'THE SAME SWING', effects: [A(19)] },
      { label: 'Attack', effects: [A(12)] },
    ],
  },
  driftbeast: {
    id: 'driftbeast', death: 'beast', name: 'Driftbeast', sprite: 'en_driftbeast', scale: 0.35,
    maxHp: 250, chips: 42,
    intents: [
      { label: 'Attack', effects: [A(12)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Turning slowly...', effects: [FX('charge')] },
      { label: 'SOUNDING DIVE', effects: [A(24)] },
    ],
  },
  glassSylph: {
    id: 'glassSylph', death: 'humanoid', name: 'Glass Sylph', sprite: 'en_glass_sylph', scale: 0.35,
    maxHp: 120, chips: 28,
    intents: [
      { label: 'Attack', effects: [A(9)] },
      { label: 'REFRACTION', effects: [SHIELD(15, 'self')] },
      { label: 'Attack', effects: [A(12)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
    ],
  },
  thoughtlessOne: {
    id: 'thoughtlessOne', death: 'humanoid', name: 'The Thoughtless One', sprite: 'en_thoughtless_one', scale: 0.35,
    maxHp: 140, chips: 30,
    intents: [
      { label: 'Attack', effects: [A(8)] },
      { label: 'FORGETTING', effects: [FX('fade', 1)] },
      { label: 'Attack', effects: [A(12)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  prismStag: {
    id: 'prismStag', death: 'beast', name: 'Prism Stag', sprite: 'en_prism_stag', scale: 0.35, flipX: true,
    maxHp: 170, chips: 34,
    intents: [
      { label: 'Attack', effects: [A(11)] },
      { label: 'SPLIT LIGHT', effects: [A(9), FX('fade', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Lowering facets...', effects: [FX('charge')] },
      { label: 'PRISM GORE', effects: [A(20)] },
    ],
  },
  /** CUT AND RUN, the Ethereal Plains. */
  whisperThief: {
    id: 'whisperThief', death: 'humanoid', name: 'Whisper Thief', sprite: 'en_whisper_thief', scale: 0.38,
    maxHp: 110, chips: 26,
    flee: { turns: 3, chips: 150 },
    intents: [
      { label: 'Attack', effects: [A(9)] },
      { label: 'Attack', effects: [A(12)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  /**
   * AS YOU DID. It plays your last hand back at you, so the enormous nuke turn
   * you were saving arrives at your own face one turn later. BREAKS: the single
   * enormous nuke turn.
   *
   * ONE def, FIVE textures. `spriteForHero` picks the negative of the hero you
   * are actually playing (see CombatScene.spawnEnemy) — the five files are
   * generated from the hero models by tools/install_biome_art.py and are ALREADY
   * mirrored in the file, which is why this def must never set flipX.
   */
  mirrorwalker: {
    id: 'mirrorwalker', death: 'humanoid', name: 'The Mirrorwalker', sprite: 'en_mirrorwalker_highroller',
    scale: 0.50, footFrac: 0, elite: true,
    spriteForHero: {
      highRoller: 'en_mirrorwalker_highroller',
      zealot: 'en_mirrorwalker_zealot',
      bulwark: 'en_mirrorwalker_bulwark',
      venomancer: 'en_mirrorwalker_venomancer',
      hoarder: 'en_mirrorwalker_hoarder',
    },
    maxHp: 300, chips: 70,
    special: 'asYouDid',
    intents: [
      { label: 'AS YOU DID', effects: [BFX('mirrorHand')] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'AS YOU DID', effects: [BFX('mirrorHand')] },
      { label: 'Standing as you stand...', effects: [FX('charge')] },
      { label: 'YOUR OWN EDGE', effects: [A(26)] },
    ],
  },
  /**
   * UNSINGING. Two cards fade every turn, so nothing you are holding is safe to
   * hold. BREAKS: relying on specific cards surviving the fight.
   *
   * ART: PAINTED AND IN, 2026-08-03. It shipped for one build wearing a
   * luminance re-map of the Mote Swarm, because it was the only one of the 45
   * biome creatures with nothing drawn for it. JC delivered a dedicated
   * painting and it replaced that file in place, which is exactly why the
   * interim was baked into the PNG rather than applied as a runtime tint: no
   * scene ever had to learn about it, and no code changed when the real art
   * arrived. Anchored 'hover', not 'ground' — it is a column of lights and has
   * no feet to stand on.
   */
  choirOfMotes: {
    id: 'choirOfMotes', death: 'creature', name: 'Choir of Motes', sprite: 'en_choir_motes', scale: 0.53, elite: true,
    maxHp: 310, chips: 70,
    special: 'unsinging',
    intents: [
      { label: 'UNSINGING', effects: [A(13), FX('fade', 2)] },
      { label: 'Attack', effects: [A(16), FX('fade', 2)] },
      { label: 'Strengthen', effects: [FX('buff', 3), FX('fade', 2)] },
      { label: 'The note holds...', effects: [FX('charge'), FX('fade', 2)] },
      { label: 'FULL CHOIR', effects: [A(26), FX('fade', 2)] },
    ],
  },
  /**
   * STILLNESS.
   *
   * SHORTFALL, FLAGGED, AND THE BIGGEST ONE IN THE PATCH: the design is
   * "intangible every other turn, and heals while it sleeps". Neither half is in
   * the locked sixteen — there is no intangibility effect and no self-heal
   * effect. It therefore ships with its TELEGRAPH only (the signature blurb and
   * badge below) and an ordinary, heavy rotation. It is a fair fight and it is
   * not the designed fight. The behaviour it wants already exists on the Frost
   * Guardian's `glacialAegis`; the reason it does not simply borrow that id is
   * that the on-screen copy would then read GLACIAL AEGIS in a pale grass field.
   */
  longSleeper: {
    id: 'longSleeper', death: 'large', name: 'The Long Sleeper', sprite: 'en_long_sleeper', scale: 0.51, elite: true,
    maxHp: 340, chips: 75,
    special: 'stillness',
    intents: [
      { label: 'Attack', effects: [A(15)] },
      { label: 'Sleeping...', effects: [FX('charge')] },
      { label: 'WAKING WEIGHT', effects: [A(28)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Attack', effects: [A(17)] },
    ],
  },
  /**
   * REWEAVE. Every second turn your HAND SIZE drops by one for the rest of the
   * fight. BREAKS: the long grinding fight. A war of attrition loses.
   */
  weftWarden: {
    id: 'weftWarden', death: 'humanoid', name: 'Weft Warden', sprite: 'en_weft_warden', scale: 0.51, elite: true,
    maxHp: 320, chips: 75,
    special: 'reweave',
    intents: [
      { label: 'Attack', effects: [A(14)] },
      { label: 'REWEAVE', effects: [FX('shrinkHand', SHRINK_HAND_STEP)] },
      { label: 'Attack', effects: [A(17)] },
      { label: 'REWEAVE', effects: [FX('shrinkHand', SHRINK_HAND_STEP)] },
      { label: 'Pulling the thread...', effects: [FX('charge')] },
      { label: 'UNPICKED', effects: [A(27)] },
    ],
  },
  /**
   * B — SCAFFOLD. A wall goes up every turn and it shows you the ONE hand type
   * that brings it down; nothing reaches him until it does. BREAKS: playing
   * whatever you happen to hold. The effect carries no hand type of its own: the
   * engine rolls and announces one per wall, which is the whole puzzle.
   */
  paleArchitect: {
    id: 'paleArchitect', death: 'large', name: 'THE PALE ARCHITECT', sprite: 'boss_pale_architect',
    scale: 0.72, boss: true,
    // 1.0x the act-II boss anchor (winterPhoenix 640).
    maxHp: 640, chips: 200,
    special: 'scaffold',
    intents: [
      { label: 'SCAFFOLD', effects: [A(13), BFX('wall')] },
      { label: 'SCAFFOLD', effects: [A(16), BFX('wall')] },
      { label: 'Strengthen', effects: [FX('buff', 4), BFX('wall')] },
      { label: 'Drawing the arch...', effects: [FX('charge'), BFX('wall')] },
      { label: 'KEYSTONE', effects: [A(30), BFX('wall')] },
      { label: 'SCAFFOLD', effects: [A(14), BFX('wall')] },
    ],
  },
  /**
   * B — NOTHING TWICE. It only takes damage from a hand type you have NOT played
   * yet this fight. BREAKS: the one-hand-type engine, completely.
   */
  seraphStill: {
    id: 'seraphStill', death: 'large', name: 'SERAPH OF THE STILL', sprite: 'boss_seraph_still',
    scale: 0.71, boss: true,
    // 0.94x the act-II boss anchor. It gates your damage rather than out-HPing
    // you, so the pool sits just under the Architect's.
    maxHp: 600, chips: 200,
    special: 'nothingTwice',
    intents: [
      { label: 'NOTHING TWICE', effects: [A(14), BFX('unusedOnly')] },
      { label: 'Attack', effects: [A(17)] },
      { label: 'Strengthen', effects: [FX('buff', 5)] },
      { label: 'Every wing lifts...', effects: [FX('charge')] },
      { label: 'STILL LIGHT', effects: [A(32)] },
      { label: 'Attack', effects: [A(15)] },
    ],
  },
  /**
   * B — WEIGHTLESS. Cards LEFT IN YOUR HAND at end of turn drift away and are
   * gone for the fight. BREAKS: holding cards back, which is the direct answer
   * to the leftover-bench build, and it is why it belongs to Act II: it arrives
   * before a bench engine is fully online.
   */
  theUnmade: {
    id: 'theUnmade', death: 'large', name: 'THE UNMADE', sprite: 'boss_the_unmade',
    scale: 0.71, boss: true, flipX: true,
    // 1.06x the act-II boss anchor — the heaviest of the Plains, because
    // WEIGHTLESS gives you nothing to hoard and every turn is a full commit.
    maxHp: 680, chips: 200,
    special: 'weightless',
    intents: [
      { label: 'WEIGHTLESS', effects: [A(12), BFX('dropHand')] },
      { label: 'Attack', effects: [A(16)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Coming apart...', effects: [FX('charge')] },
      { label: 'REASSEMBLED WRONG', effects: [A(31)] },
      { label: 'Attack', effects: [A(14)] },
    ],
  },

  // =========================================================================
  // ACT III ALTERNATE — THE BURNING GALLOWS (BURNED world)
  // =========================================================================
  /**
   * An execution ground that never stopped working. An ALTERNATE Act III, so it
   * inherits the Abyss's tuning exactly: curve, dmgBase 1.5, fx 1, bossHpMult
   * 45, eliteHpMult 32. Printed HP sits inside Act III's bands (regulars
   * 120-280, elites 320-460, bosses 300-800).
   *
   * BURNED is the deepest kind of harm the game has: once used, gone. The
   * Gallows does not restrict what you may do, it removes what you have already
   * done, permanently, for the rest of the fight. Act III takes your options
   * away. BURNED BEATS RECYCLED, per the ADDENDUM: a burned card is never handed
   * back by the Oracle's Recycler.
   */
  ashCrow: {
    id: 'ashCrow', death: 'beast', name: 'Ash Crow', sprite: 'en_ash_crow', scale: 0.42,
    // The lightest body in the Gallows, on the Corrupted Crow's footing: the
    // act needs an opening room a deck can actually clear on floor one.
    maxHp: 140, chips: 34,
    intents: [
      { label: 'Attack', effects: [A(10)] },
      { label: 'Attack', effects: [A(13)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Attack', effects: [A(16)] },
    ],
  },
  gallowsHound: {
    id: 'gallowsHound', death: 'beast', name: 'Gallows Hound', sprite: 'en_gallows_hound', scale: 0.42,
    maxHp: 190, chips: 38,
    intents: [
      { label: 'Attack', effects: [A(12)] },
      { label: 'Straining the rope...', effects: [FX('charge')] },
      { label: 'SLIP THE NOOSE', effects: [A(22)] },
      { label: 'Attack', effects: [A(14)] },
    ],
  },
  emberWisp: {
    id: 'emberWisp', death: 'creature', name: 'Ember Wisp', sprite: 'en_ember_wisp', scale: 0.46,
    maxHp: 170, chips: 36,
    // Opens the fight already plated, the Ice Elemental's idiom in a hotter act.
    startShield: 15,
    intents: [
      { label: 'Attack', effects: [A(11)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
      { label: 'Attack', effects: [A(17)] },
    ],
  },
  theCondemned: {
    id: 'theCondemned', death: 'humanoid', name: 'The Condemned', sprite: 'en_the_condemned', scale: 0.38,
    maxHp: 175, chips: 36,
    intents: [
      { label: 'Attack', effects: [A(11)] },
      { label: 'SHACKLES', effects: [FX('rooted', 1)] },
      { label: 'Attack', effects: [A(15)] },
      { label: 'Strengthen', effects: [FX('buff', 2)] },
    ],
  },
  pyreZealot: {
    id: 'pyreZealot', death: 'humanoid', name: 'Pyre Zealot', sprite: 'en_pyre_zealot', scale: 0.38, flipX: true,
    maxHp: 160, chips: 34,
    intents: [
      { label: 'Attack', effects: [A(12)] },
      { label: 'TORCHBEARER', effects: [FX('buff', 4)] },
      { label: 'CINDER FALL', effects: [A(10), FX('spikes', 3)] },
      { label: 'Attack', effects: [A(16)] },
    ],
  },
  cinderGolem: {
    id: 'cinderGolem', death: 'creature', name: 'Cinder Golem', sprite: 'en_cinder_golem', scale: 0.38,
    maxHp: 280, chips: 44,
    intents: [
      { label: 'Attack', effects: [A(14)] },
      { label: 'SLAG CRUST', effects: [SHIELD(12, 'self')] },
      { label: 'Seams glowing...', effects: [FX('charge')] },
      { label: 'MAGMA FIST', effects: [A(26)] },
    ],
  },
  smokeWeaver: {
    id: 'smokeWeaver', death: 'humanoid', name: 'Smoke Weaver', sprite: 'en_smoke_weaver', scale: 0.38,
    maxHp: 165, chips: 36,
    intents: [
      { label: 'Attack', effects: [A(10)] },
      { label: 'CHOKING SEAL', effects: [FX('suitSeal', 1)] },
      { label: 'Attack', effects: [A(13)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
    ],
  },
  /**
   * CUT AND RUN, the Burning Gallows. JC replaced the Ash Magpie outright with
   * a flaming archer skull ("rename it"); the thief slot and its clock are
   * unchanged. Name is the art pass's call.
   */
  ashArcher: {
    id: 'ashArcher', death: 'humanoid', name: 'Ash Archer', sprite: 'en_ash_archer', scale: 0.36, flipX: true,
    maxHp: 140, chips: 32,
    flee: { turns: 3, chips: 150 },
    intents: [
      { label: 'Attack', effects: [A(11)] },
      { label: 'Attack', effects: [A(14)] },
      { label: 'Strengthen', effects: [FX('buff', 3)] },
    ],
  },
  /** CUT THEM DOWN's cast-off. Condemned-sized, minion-priced. */
  hangingCondemned: {
    id: 'hangingCondemned', death: 'humanoid', name: 'Cut-Down Condemned', sprite: 'en_the_condemned',
    scale: 0.30, minion: true,
    maxHp: 90, chips: 20,
    intents: [
      { label: 'Attack', effects: [A(9)] },
      { label: 'Attack', effects: [A(12)] },
      { label: 'Attack', effects: [A(10)] },
    ],
  },
  /**
   * CONDEMNED. He brands a card every turn; if you have not PLAYED it within two
   * turns it burns out of your DECK for good. Discarding does not save it.
   * BREAKS: hoarding a perfect card for the perfect turn. (JC: elite, not
   * biome — the Gallows' own mechanic is what happens to cards you HAVE played.)
   */
  hangman: {
    id: 'hangman', death: 'humanoid', name: 'The Hangman', sprite: 'en_hangman', scale: 0.55, elite: true,
    maxHp: 400, chips: 90,
    special: 'condemned',
    intents: [
      { label: 'CONDEMNED', effects: [A(16), FX('condemn', 1)] },
      { label: 'Attack', effects: [A(19), FX('condemn', 1)] },
      { label: 'Strengthen', effects: [FX('buff', 4), FX('condemn', 1)] },
      { label: 'Unhurried...', effects: [FX('charge'), FX('condemn', 1)] },
      { label: 'THE DROP', effects: [A(34), FX('condemn', 1)] },
    ],
  },
  /**
   * PYRE TAX. Every hand you play costs HP equal to the number of cards in it.
   * BREAKS: full five-card hands. Suddenly Dextra is right.
   */
  brazierTitan: {
    id: 'brazierTitan', death: 'large', name: 'Brazier Titan', sprite: 'en_brazier_titan', scale: 0.55, elite: true,
    maxHp: 420, chips: 90,
    special: 'pyreTax',
    intents: [
      { label: 'PYRE TAX', effects: [A(15), FX('cardTax', CARD_TAX_PER_CARD)] },
      { label: 'Attack', effects: [A(18)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Spilling coals...', effects: [FX('charge')] },
      { label: 'SLAG SWEEP', effects: [A(33)] },
    ],
  },
  /**
   * CUT THEM DOWN. It opens with two of its dead already walking and cuts more
   * loose as they fall, up to three on the field at once. `slotCount: 4` books
   * the fourth pedestal from the bell, exactly as the Frostbitten Summoner does.
   * BREAKS: slow single-target plans.
   */
  gallowsTree: {
    id: 'gallowsTree', death: 'creature', name: 'The Gallows Tree', sprite: 'en_gallows_tree', scale: 0.55, elite: true,
    maxHp: 380, chips: 90,
    special: 'cutThemDown',
    openers: ['hangingCondemned', 'hangingCondemned'],
    slotCount: 4,
    intents: [
      { label: 'Attack', effects: [A(16)] },
      { label: 'CUT THEM DOWN', effects: [SUMMON('hangingCondemned', GALLOWS_CAP)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Branches bending...', effects: [FX('charge')] },
      { label: 'THE WHOLE ORCHARD', effects: [A(31)] },
      { label: 'CUT THEM DOWN', effects: [SUMMON('hangingCondemned', GALLOWS_CAP)] },
    ],
  },
  /**
   * NO QUARTER: you gain no Shield for the whole fight. BREAKS: turtling, and
   * the Bull's whole plan.
   *
   * It borrows `shatterguard` rather than declaring an id of its own, because
   * SHATTERGUARD is that rule already, implemented, telegraphed and tested (one
   * clause in CombatScene.shieldGain covers hands, relics, potions and events).
   * The on-screen copy reads "you gain NO Shield this fight", which is exactly
   * what NO QUARTER says. Flagged for JC only as a naming question.
   */
  wardenCoals: {
    id: 'wardenCoals', death: 'humanoid', name: 'Warden of Coals', sprite: 'en_warden_coals', scale: 0.55, elite: true, flipX: true,
    maxHp: 360, chips: 90,
    special: 'shatterguard',
    intents: [
      { label: 'Attack', effects: [A(17)] },
      { label: 'BRANDING IRON', effects: [A(14), FX('spikes', 4)] },
      { label: 'Strengthen', effects: [FX('buff', 4)] },
      { label: 'Plate glowing...', effects: [FX('charge')] },
      { label: 'WHITE HEAT', effects: [A(32)] },
    ],
  },
  /**
   * B — DOUBLE JEOPARDY. Each hand type may be played ONCE for the whole fight:
   * play a Pair and you have played your only Pair. He also passes SENTENCE,
   * naming the hand type you must bring him this turn. BREAKS: everything about
   * repeating a strategy. The hardest puzzle in the game, and it belongs here.
   *
   * WRITTEN AS BRUTALLY AS THE DESIGN SAYS, on the engine's ruling: he CANNOT
   * lock you out. The moment nothing your current hand can form is still legal
   * the docket WIPES and the whole chart reopens (biomes.mistrialDue /
   * declareMistrial). So there is no need to soften the rotation to leave an
   * escape hatch -- the escape hatch is guaranteed, and spending the chart
   * faster simply brings the mistrial forward.
   */
  magistrate: {
    id: 'magistrate', death: 'large', name: 'THE MAGISTRATE', sprite: 'boss_magistrate',
    scale: 0.74, boss: true,
    // 1.0x the act-III boss anchor (theKeeper 800).
    maxHp: 800, chips: 250,
    special: 'doubleJeopardy',
    intents: [
      { label: 'DOUBLE JEOPARDY', effects: [A(15), BFX('handTypeOnce')] },
      { label: 'SENTENCE', effects: [BFX('demandHand')] },
      { label: 'Attack', effects: [A(18)] },
      { label: 'Reading the ledger...', effects: [FX('charge')] },
      { label: 'JUDGEMENT', effects: [A(34)] },
      { label: 'SENTENCE', effects: [BFX('demandHand')] },
    ],
  },
  /**
   * B — STRUCK FROM THE RECORD. Every card you play is BURNED: that exact card
   * cannot be played again this fight, even after the discard pile reshuffles.
   * A long fight eats your deck from the top down. BREAKS: the long grind, and
   * deck-cycling engines.
   */
  pyreheart: {
    id: 'pyreheart', death: 'large', name: 'PYREHEART, THE UNBURNT', sprite: 'boss_pyreheart',
    scale: 0.74, boss: true,
    // 0.95x the act-III boss anchor. His mechanic is a clock on your whole
    // deck, so the pool is a shade under the Magistrate's.
    maxHp: 760, chips: 250,
    special: 'struckFromRecord',
    intents: [
      { label: 'STRUCK FROM THE RECORD', effects: [A(14), BFX('burnPlayed')] },
      { label: 'Attack', effects: [A(18)] },
      { label: 'Strengthen', effects: [FX('buff', 5)] },
      { label: 'Chains at full stretch...', effects: [FX('charge')] },
      { label: 'CAGE BREAK', effects: [A(35)] },
      { label: 'Attack', effects: [A(16)] },
    ],
  },
  /**
   * B — THE QUEUE. Each turn it hangs one of your RELICS, chosen LEFT TO RIGHT,
   * so your chain unravels from the front and does nothing for the rest of the
   * fight. BREAKS: relic-order engines and mirror stacks. The one fight where
   * your build is the thing under attack.
   *
   * A HUNG RELIC KEEPS ITS CELL (the engine's ruling): it is replaced in place
   * by an inert stub, never removed, so the row never shrinks and no mirror
   * silently re-aims. A Forgery pointed at a hung relic copies a dead relic and
   * is dead too, which is precisely "unravels from the front" -- and it is why
   * this is a MIRROR-STACK killer and not just a relic tax.
   *
   * JC replaced the rope-spider outright with a flaming ghoul carrying nooses
   * ("same idea"), so the name is kept.
   */
  ropemaker: {
    id: 'ropemaker', death: 'large', name: 'THE ROPEMAKER', sprite: 'boss_ropemaker',
    scale: 0.74, boss: true,
    // 0.875x the act-III boss anchor — the fastest kill of the three, because
    // every turn you spend is a relic you no longer have.
    maxHp: 700, chips: 250,
    special: 'theQueue',
    intents: [
      { label: 'THE QUEUE', effects: [A(13), BFX('hangRelic')] },
      { label: 'Attack', effects: [A(17), BFX('hangRelic')] },
      { label: 'Strengthen', effects: [FX('buff', 4), BFX('hangRelic')] },
      { label: 'Weaving from nothing...', effects: [FX('charge'), BFX('hangRelic')] },
      { label: 'THE LONG DROP', effects: [A(33), BFX('hangRelic')] },
      { label: 'Attack', effects: [A(15), BFX('hangRelic')] },
    ],
  },
};

// ---------------------------------------------------------------------------
// THE CHIP ECONOMY LIVES SOMEWHERE ELSE NOW (JC, 2026-08-01)
// ---------------------------------------------------------------------------
/**
 * ENEMIES DROP NOTHING. There is no per-fight chip budget, no largest-remainder
 * split across the line-up and no per-enemy `chipShare` — the whole apparatus
 * (FIGHT_CHIP_BANDS / ELITE_CHIP_MULT / BOSS_CHIP_BUDGET /
 * rollFightChipBudget / splitChipBudget) was deleted rather than left dormant.
 *
 * A WON FIGHT pays CHIPS_PER_HAND_LEFT per hand still on the ten-hand clock
 * (see CombatScene.handsPurse + the victory tally), so income is a reward for
 * ENDING fights, not for standing in them. Bosses and elites use the same clock
 * and are paid the same way; the Bounty Board's flat elite bonus is unchanged.
 *
 * `def.chips` is deliberately left in the defs below — it still reads as
 * designer intent about a creature's relative worth — but nothing consumes it.
 */

/** Debuffs that intensify in deeper acts (scaling.fx adds flat stacks). */
const FX_SCALED = new Set(['bleed', 'freeze', 'poison', 'fear']);

/**
 * CARD-DENIAL CAP — the systemic rule for the rank and file (JC, 2026-07-31).
 *
 * FREEZE and FEAR are the two debuffs that take cards out of your hands, and
 * they are the two the act curve was quietly compounding: the Ice Mage's
 * printed 'freeze 2' became 3 in Act II/III and 4 in Act IV, so a trash mob in
 * a corridor fight was locking half a hand. Bleed and poison can keep scaling
 * — they hurt, they don't silence you.
 *
 * A REGULAR enemy (no `elite`, no `boss` flag — minions included) may never
 * freeze or fear more than 2 cards in one cast, AFTER act scaling. Elites and
 * bosses are uncapped: that IS their moment, and it is telegraphed by a health
 * bar you can see coming. The clamp lives here, at spawn, so the intent icon
 * and the hover tooltip advertise exactly what will land.
 */
export const CARD_DENIAL_CAP = 2;
const CARD_DENIAL = new Set(['freeze', 'fear']);

/**
 * THE CAP, EXTENDED (2026-08-02 mechanics wave).
 *
 * CARD_DENIAL_CAP clamps how many cards ONE cast of freeze/fear can take. The
 * wave adds three more ways to take cards out of your hands — ROOTED (fewer
 * dealt), COURT ADJOURNED (face cards unplayable) and SEALED SUIT (one suit
 * unplayable) — which are turn-counted rather than card-counted, so the cap
 * generalises into a PER-INTENT rule instead of a per-value one:
 *
 *   a REGULAR enemy may never resolve TWO denial effects on the same turn.
 *
 * Across a whole deck is fine — the Ice Mage freezes on one turn and seals on
 * another, and that is the puzzle. Both at once is oppression. Elites and
 * bosses are uncapped, exactly as they are for freeze/fear.
 */
export const DENIAL_EFFECTS = new Set(['freeze', 'fear', 'rooted', 'courtLock', 'suitSeal']);

/** How many denial effects one intent resolves at once. */
export function denialsInIntent(intent) {
  return (intent?.effects ?? []).filter(e => DENIAL_EFFECTS.has(e.type)).length;
}

/** The worst single turn this def can have, in denial effects. */
export function maxDenialsPerIntent(def) {
  return (def?.intents ?? []).reduce((m, it) => Math.max(m, denialsInIntent(it)), 0);
}

/** Every denial effect type anywhere in this def's rotation. */
export function denialTypesOf(def) {
  const out = new Set();
  for (const it of def?.intents ?? []) {
    for (const e of it.effects) if (DENIAL_EFFECTS.has(e.type)) out.add(e.type);
  }
  return out;
}

/**
 * THE WARM-UP RULE (JC): "some fights should just be simple like the first one
 * or two in Act I". Everything this wave introduced is listed here, and
 * acts.rollEncounter filters it out of Act I's opening floors — so the tutorial
 * stays the tutorial, without maintaining a second hand-curated pool that would
 * drift the moment anyone edited the first.
 */
export const WAVE_EFFECTS = new Set([
  'shield', 'stealDiscard', 'rooted', 'courtLock', 'suitSeal', 'spikes',
]);

/**
 * THE BIOME VOCABULARY (2026-08-03), LOCKED BY docs/PATCH_ORACLE.txt's ADDENDUM.
 *
 * Sixteen effect types that TWO agents build against without talking: this file
 * writes the enemy defs that USE them, and core/biomes.js + CombatScene's debuff
 * region write the behaviour that RESOLVES them. Neither side may invent a name,
 * so neither side keeps its own copy of the list either — the ENGINE's
 * BIOME_EFFECT_TYPES is the single source, re-exported here as a Set because
 * that is the shape every reader in this file wants. A creature naming an effect
 * the engine does not export is therefore not a failing test, it is an import
 * that does not resolve.
 */
export const BIOME_EFFECTS = new Set(BIOME_EFFECT_TYPES);

/**
 * EVERY effect type any def in the game is allowed to name. The bestiary's own
 * contract: an intent carrying anything not in here is a typo, and
 * tests/biomes.test.js says so. `blind` and `fade` are deliberately absent from
 * DENIAL_EFFECTS — BLIND takes information and FADE takes a bonus, and neither
 * takes the card out of your hands, which is what that cap is about.
 */
export const KNOWN_EFFECTS = new Set([
  'attack', 'buff', 'charge',
  'bleed', 'freeze', 'brittle', 'poison', 'fear', 'hypnotize', 'suitban',
  'rooted', 'courtLock', 'suitSeal', 'spikes',
  'shield', 'stealDiscard', 'summon', 'quake', 'slice', 'ward', 'morphBuff',
  ...BIOME_EFFECTS,
]);

/** Every effect type this def's rotation names, in no particular order. */
export function effectTypesOf(def) {
  const out = new Set();
  for (const it of def?.intents ?? []) for (const e of it.effects ?? []) out.add(e.type);
  return out;
}

/**
 * Does this def carry ANY mechanic beyond plain attacking? Drives THE WARM-UP
 * RULE in acts.rollEncounter, which keeps Act I's opening floors simple. The
 * biome vocabulary joins the 2026-08-02 wave here rather than in WAVE_EFFECTS
 * itself, so the Nocturnal Forest's first two floors are as clean as the
 * Verdant Forest's without either set having to grow.
 */
export function hasWaveMechanic(def) {
  if (!def) return false;
  if (def.flee || (def.startShield ?? 0) > 0) return true;
  return (def.intents ?? []).some(it =>
    it.effects.some(e => WAVE_EFFECTS.has(e.type) || BIOME_EFFECTS.has(e.type)));
}

/**
 * THE ENEMY-DAMAGE LEVER (JC, 2026-08-01, interim).
 *
 * The friend playtest read the game as too punishing while you were still
 * learning what your deck did, so EVERY enemy attack in the game — trash,
 * elites, bosses, summoned minions — is cut 35%. This is the single cleanest
 * place to do it: makeEnemy is the only door an enemy walks through, and it is
 * where the per-act `scaling.dmg` already lands, so the cut rides the act curve
 * instead of fighting it.
 *
 * It applies ONLY to `attack` effects. Damage-over-time debuffs (bleed, poison)
 * and the ward/morph percentages are untouched — those are mechanics, not the
 * damage clock.
 *
 * Ramping bosses scale with it for free: the Depth Knight's void power
 * multiplies whatever this leaves behind, so his curve keeps its exact shape at
 * this height. The DEV ENEMY DAMAGE slider compounds on top of this (x1 = this).
 *
 * 0.65 -> 0.715 (JC, 2026-08-01, off the god-run): a flat +10% on the lever.
 * The 35% cut was a reaction to a friend playtest and it over-corrected once
 * the SCALER relics went in — the player's ceiling moved, so the floor moves
 * with it. Still a 28.5% cut on the printed numbers, which is the point.
 */
export const ENEMY_DAMAGE_SCALE = 0.715;

/** Is this def one of the rank and file the cap applies to? */
export const isRankAndFile = (def) => !def?.elite && !def?.boss;

/**
 * @param scaling per-act difficulty multipliers { hp, hpMinor?, dmg, fx }
 *
 * `hpMinor` (elite rooms in acts II+) is the ordinary row-curve factor for the
 * NON-elite bodies of an elite encounter. The elite itself is a flat per-act
 * mini-boss; its escort of wraiths/slimes stays escort-sized instead of being
 * dragged up to mini-boss HP. Absent → everyone shares `scaling.hp`, which is
 * every other room in the game (and all of Act I).
 */
export function makeEnemy(def, scaling = { hp: 1, dmg: 1, fx: 0 }) {
  const escort = scaling.hpMinor != null && !def.elite && !def.boss;
  // Four factors, one readable line: the printed HP, the act curve, the chosen
  // DIFFICULTY, and the dev slider. They compound on purpose.
  const maxHp = Math.max(1, Math.round(
    def.maxHp * (escort ? scaling.hpMinor : scaling.hp) * enemyHpFactor(run) * devMult('devEnemyHp'),
  ));
  const capped = isRankAndFile(def);
  return {
    def,
    hp: maxHp,
    maxHp,
    intents: def.intents.map(it => ({
      label: it.label,
      effects: it.effects.map(e => {
        if (e.type === 'attack') return { ...e, value: Math.round(e.value * scaling.dmg * ENEMY_DAMAGE_SCALE) };
        if (FX_SCALED.has(e.type)) {
          const scaled = e.value + (scaling.fx ?? 0);
          return { ...e, value: capped && CARD_DENIAL.has(e.type) ? Math.min(CARD_DENIAL_CAP, scaled) : scaled };
        }
        return { ...e };
      }),
    })),
    attackBuff: 0,
    intentIndex: 0,
    statuses: { poison: 0, bleed: 0, brittle: 0 },
    // Enemy SHIELD is a first-class pool absorbed before HP (Sinastra's ward
    // is the only thing that grants it today; the plumbing is general).
    shield: 0,
    // The Depth Knight's compounding void power — a MULTIPLIER on every
    // attack he telegraphs. 1 for everyone else, so the maths is a no-op.
    //
    // THE ACIDIC MONSTROSITY BORROWS IT. WAKING WRATH is the same idea with a
    // schedule instead of a trigger, so it rides the same field and inherits
    // currentIntent's honesty for free: the telegraphed number is already
    // multiplied, which is the entire point of the mechanic. It opens on
    // wrathPowerFor(1) = 0, so its first telegraph honestly reads "0".
    voidPower: def.special === 'wakingWrath' ? wrathPowerFor(1) : 1,
    // CUT AND RUN's clock, ticked at the end of this body's own turn. 0 for
    // everything that has no intention of leaving.
    fleeLeft: def.flee?.turns ?? 0,
    fled: false,
    // Turn-cycle bookkeeping for signature mechanics (morph form, summons).
    turnCount: 0,
    form: def.special === 'morph' ? 'atk' : null,
    immune: false,
    charging: false,
    alive: true,
  };
}

/**
 * The intent the enemy will take next, with attackBuff folded into attacks
 * AND the Depth Knight's void multiplier applied — the number on the intent
 * icon is the number that will actually land.
 */
export function currentIntent(enemy) {
  const intent = enemy.intents[enemy.intentIndex % enemy.intents.length];
  const power = enemy.voidPower ?? 1;
  // The DEV ENEMY DAMAGE slider lands HERE rather than at makeEnemy, so it is
  // live mid-fight AND the telegraphed number never lies: this function feeds
  // both the intent icon and advanceIntent (which is what actually resolves).
  const dev = devMult('devEnemyDmg');
  // PLATINUM and above: bosses hit 30% harder. Same reasoning as the slider —
  // it belongs where the TELEGRAPH is computed, so the player reads the real
  // number on the intent icon instead of being surprised when it lands.
  const bossPunch = enemy.def?.boss ? bossDamageFactor(run) : 1;
  return {
    label: intent.label,
    effects: intent.effects.map(e => (e.type === 'attack'
      ? { ...e, value: Math.max(0, Math.round((e.value + enemy.attackBuff) * power * dev * bossPunch)) }
      : e)),
  };
}

/**
 * Advances the intent pointer; returns the resolved intent (buff/charge applied).
 * Strengthen lasts ONE strike (JC): a buff intent SETS the bonus, and it is
 * spent the next time this enemy actually attacks.
 */
export function advanceIntent(enemy) {
  const intent = currentIntent(enemy);
  enemy.intentIndex++;
  const buffs = intent.effects.some(e => e.type === 'buff');
  const attacks = intent.effects.some(e => e.type === 'attack');
  if (attacks && !buffs) enemy.attackBuff = 0;                       // the wind-up is spent
  for (const e of intent.effects) {
    if (e.type === 'buff') enemy.attackBuff = e.value;               // replaces, never stacks
  }
  enemy.charging = intent.effects.some(e => e.type === 'charge');
  return intent;
}

/** "1 turn" / "2 turns" — the wave's debuffs are all measured in them. */
const turnWord = (n) => `${n} turn${n === 1 ? '' : 's'}`;

/** Human-readable line per intent effect (hover tooltips). */
export function describeEffect(e) {
  switch (e.type) {
    case 'attack': return `Attacks for ${e.value}`;
    case 'buff': return `Powers up: its NEXT attack hits +${e.value} harder`;
    case 'charge': return 'Charging: a bigger attack next turn';
    case 'bleed': return `Bleed ${e.value}: each hand you play costs ${e.value} HP, fading by 1`;
    case 'freeze': return `Freeze ${e.value}: ${e.value} random card${e.value > 1 ? 's' : ''} in your hand frozen for a turn`;
    case 'brittle': return 'Brittle: you take +50% damage from attacks next turn';
    case 'poison': return `Poison ${e.value}: ${e.value} HP at the end of every round, fading by 1`;
    case 'fear': return `Fear ${e.value}: your next hand may use ${Math.max(1, 5 - e.value)} cards at most`;
    case 'hypnotize': return 'Hypnotize: a random card is forced into your next hand';
    case 'suitban': return 'Eternal Keep: the wheel spins and one suit becomes unplayable';
    // --- the 2026-08-02 mechanics wave ---
    case 'rooted': return `Rooted ${e.value}: your hand is dealt 1 card smaller for ${turnWord(e.value)}`;
    case 'courtLock': return `Court Adjourned: J, Q, K cannot be PLAYED for ${turnWord(e.value)}. You may still discard them`;
    case 'suitSeal': return `Sealed Suit: one suit becomes unplayable for ${turnWord(e.value)}. You may still discard it`;
    case 'spikes': return `Spikes +${e.value}: every hand you play costs HP equal to your Spikes. Spikes never fade`;
    case 'shield': return e.target === 'ally'
      ? `Wards an ALLY for ${e.value}% of its own health`
      : `Wards itself for ${e.value}% of its own health`;
    case 'stealDiscard': return `Pickpocket: steals ${e.value} discard for the rest of the fight`;
    // SUMMON names WHO it raises and HOW MANY it may field, read off the effect
    // rather than hard-coded — the Alpha Wolf's pack and the Summoner's dead
    // are the same mechanic with a different corpse.
    case 'summon': {
      const id = e.minion ?? 'bzSkeleton';
      const who = ENEMY_DEFS[id]?.name ?? 'a minion';
      return `Raises a ${who} to fight beside it (never more than ${e.cap ?? MAX_SKELETONS} at once)`;
    }
    case 'quake': return 'Hopquake: every card in your hand is given a RANDOM suit until the end of the round';
    case 'slice': return `Slice: ${e.value} random card${e.value > 1 ? 's are' : ' is'} cut out of your hand, gone for the rest of this fight`;
    case 'ward': return `Sisters' Ward: BOTH daughters are empowered and shielded for ${e.value}% of Sinastra's health`;
    case 'morphBuff': return `Void Shell: he is IMMUNE this turn and his power compounds +${e.value}%`;
    // --- the 2026-08-03 biome vocabulary (see BIOME_EFFECTS) ---
    // Every one of these is a TELEGRAPH: the intent icon shows the glyph, this
    // sentence is what the hover says, and the signature blurb shouts the
    // headline at the opening bell. A mechanic with no telegraph does not ship.
    case 'blind': return `Blind ${e.value}: for ${e.value} turn${e.value > 1 ? 's' : ''}, ${Math.round(BLIND_CHANCE * 100)}% of the cards you DRAW arrive FACE DOWN. Still playable`;
    case 'fade': return `Fade ${e.value}: ${e.value} card${e.value > 1 ? 's start' : ' starts'} FADING for this fight. A fading card scores no bonus and has a ${Math.round(FADE_VANISH_CHANCE * 100)}% chance to leave your deck forever each time it scores`;
    case 'condemn': return `Condemned: ${e.value} card${e.value > 1 ? 's are' : ' is'} branded. PLAY ${e.value > 1 ? 'them' : 'it'} within ${turnWord(CONDEMN_TURNS)} or ${e.value > 1 ? 'they leave' : 'it leaves'} your deck for good. Discarding does not save it`;
    case 'burnPlayed': return 'Struck From The Record: every card you play is BURNED and cannot be played again this fight, even after a reshuffle';
    case 'handTypeOnce': return 'Double Jeopardy: each hand type may be played ONCE for the whole fight';
    case 'demandHand': return `Sentence: it names the hand type you must play this turn. Bring it anything else and it costs you ${DEMAND_HAND_DAMAGE} HP`;
    case 'hangRelic': return 'The Queue: one of your relics is hanged and does nothing for the rest of the fight, chosen LEFT TO RIGHT';
    case 'wall': return 'Scaffold: it raises a wall and shows the ONE hand type that breaks it. Your damage does not reach it until the wall is down';
    case 'unusedOnly': return 'Nothing Twice: she takes damage only from hand types you have NOT played yet this fight';
    case 'forgetSuit': return 'Silkbound: she names a suit and that suit deals her NOTHING, until she names a new one';
    case 'mirrorHand': return 'As You Did: it answers the hand you played. Bigger hands hit back harder'
      + ` (${mirrorHandDamage('pair')} for a Pair, ${mirrorHandDamage('flush')} for a Flush, up to ${MIRROR_HAND_CAP})`;
    case 'shrinkHand': return `Reweave: your HAND SIZE drops by ${SHRINK_HAND_STEP} for the rest of the fight`;
    case 'dropHand': return 'Weightless: cards left in your hand at the end of the turn drift away and are gone for this fight';
    case 'healMirror': return 'Reflection: every point of HP you heal, it heals too';
    case 'cardTax': return `Pyre Tax: every hand you play costs ${CARD_TAX_PER_CARD} HP per card in it`;
    case 'markCard': return 'He Sees It Coming: he marks your highest-VALUE card. Play it and your whole hand deals him nothing';
    default: return e.type;
  }
}

// ---------------------------------------------------------------------------
// SIGNATURE-MECHANIC PRIMITIVES (pure; the scene owns only the theatre)
// ---------------------------------------------------------------------------

/** Frozen Rite's ceiling — the Summoner never fields more than this many. */
export const MAX_SKELETONS = 3;

/** How many of `id` are still standing. */
export function livingMinions(enemies, id = 'bzSkeleton') {
  return enemies.filter(e => e.alive && e.def?.id === id).length;
}

/** Frozen Rite fizzles once the cap is met — the rite raises no fourth corpse. */
export function canRaise(enemies, id = 'bzSkeleton', cap = MAX_SKELETONS) {
  return livingMinions(enemies, id) < cap;
}

/**
 * The first arena pedestal no LIVING enemy is standing on. Dead minions free
 * their slot, so a replacement rises exactly where its predecessor fell.
 * @returns {number} slot index, or -1 when the arena is full
 */
export function freeSlotIndex(enemies, slotCount) {
  const taken = new Set(enemies.filter(e => e.alive).map(e => e.slotIndex));
  for (let i = 0; i < slotCount; i++) if (!taken.has(i)) return i;
  return -1;
}

/**
 * The Depth Knight's state machine, derived (never stored) from where he is in
 * his deck: even intents are the open ATTACK shape, odd ones the DEF shell.
 * Deriving it means the sprite, the immunity and the telegraphed intent can
 * never disagree, no matter how many times the deck loops.
 */
export function morphForm(intentIndex) {
  return intentIndex % 2 === 0 ? 'atk' : 'def';
}

// ---------------------------------------------------------------------------
// SILENCE — The Hushed Bell (mythical, active). The rule, kept out of the scene
// so it is testable: a silenced enemy LOSES its next turn whole. Nothing about
// that turn resolves — and critically, the intent pointer is never advanced,
// because advanceIntent is also what banks a buff, spends a wind-up and sets
// `charging`. The same telegraph therefore comes back the turn after, and a
// derived state machine (the Depth Knight's morphForm) can never desync.
// ---------------------------------------------------------------------------

/** Toll the bell on `enemy`. False = refused (dead, or already silenced). */
export function silenceEnemy(enemy) {
  if (!enemy?.alive || enemy.silenced) return false;
  enemy.silenced = true;
  return true;
}

/** Spend a silence at the top of that enemy's turn. True = the turn is skipped. */
export function consumeSilence(enemy) {
  if (!enemy?.silenced) return false;
  enemy.silenced = false;
  return true;
}

// ---------------------------------------------------------------------------
// THE 2026-08-02 MECHANICS WAVE — pure primitives (the scene owns the theatre)
// ---------------------------------------------------------------------------

/**
 * WARDING's payload: `pct`% of the CASTER's max HP, exactly the unit Sinastra's
 * Sisters' Ward already uses, so a plate is worth the same fraction of a body
 * in every act without a second scaling table.
 */
export function shieldGrantFor(enemy, pct) {
  return Math.max(1, Math.round((enemy?.maxHp ?? 0) * pct / 100));
}

/**
 * Who a `shield` effect lands on.
 *
 * `self` is itself. `ally` PREFERS whoever the player is currently aiming at —
 * that is the whole reason the Wayside's support fights get interesting: the
 * mage plates the body you are trying to kill, so you have to decide whether to
 * change targets or eat the plate. With no preference (or a dead one) it falls
 * back to the least-plated ally, and with no allies at all it wards itself
 * rather than fizzling.
 */
export function wardTarget(enemy, enemies = [], { target = 'self', prefer = null } = {}) {
  if (target !== 'ally') return enemy;
  const allies = enemies.filter(e => e.alive && e !== enemy);
  if (!allies.length) return enemy;
  if (prefer && prefer !== enemy && allies.includes(prefer)) return prefer;
  return allies.reduce((a, b) => ((b.shield ?? 0) < (a.shield ?? 0) ? b : a));
}

/** PICKPOCKET: what `left` discards become after `n` are taken. Floored at 0. */
export function stealDiscards(left, n = 1) {
  return Math.max(0, (left ?? 0) - Math.max(0, Math.round(n)));
}

/** CUT AND RUN: what a purse of `chips` actually loses to a theft of `amount`. */
export function stolenFrom(chips, amount) {
  return Math.max(0, Math.min(Math.max(0, chips ?? 0), Math.max(0, Math.round(amount ?? 0))));
}

/**
 * One turn off a thief's countdown, spent at the END of its own turn. Returns
 * the turns still on the clock; 0 means it goes NOW.
 */
export function tickFleeClock(enemy) {
  if (!enemy?.def?.flee || !enemy.alive) return null;
  enemy.fleeLeft = Math.max(0, (enemy.fleeLeft ?? enemy.def.flee.turns) - 1);
  return enemy.fleeLeft;
}

/**
 * THE RULING, as code (Claude's call, flagged for JC).
 *
 * A thief that runs its clock out takes what it can from the purse and LEAVES
 * THE FIELD. That is all. It is not a kill (nothing counts it, nothing drops),
 * and it does not cost the room: if other bodies remain the fight simply
 * continues without it, and if it was the last one standing the fight ENDS and
 * pays the normal hands-left purse — minus what it took, which the deduction
 * below has already applied. The punishment is the THEFT. Losing a whole room's
 * rewards to a timer would be a rage-quit mechanic rather than a tension one.
 *
 * @returns {{ took: number, chipsLeft: number, fightOver: boolean }}
 */
export function resolveFlee(enemy, enemies = [], chips = 0) {
  const took = stolenFrom(chips, enemy?.def?.flee?.chips ?? 0);
  if (enemy) {
    enemy.alive = false;
    enemy.fled = true;
    enemy.shield = 0;
  }
  return {
    took,
    chipsLeft: Math.max(0, (chips ?? 0) - took),
    fightOver: enemies.every(e => !e.alive),
  };
}

/** One turn of the void shell: power compounds by `pct`%. */
export function rampVoidPower(enemy, pct) {
  enemy.voidPower = Math.round((enemy.voidPower ?? 1) * (1 + pct / 100) * 1000) / 1000;
  return enemy.voidPower;
}

// ---------------------------------------------------------------------------
// PARTS 3 & 4 — ELITE AND BOSS SIGNATURES (2026-08-02)
// ---------------------------------------------------------------------------
/**
 * ONE TABLE. The fight-start blurb, the badge that rides under the intent row,
 * the sentence the intent tooltip prepends and every unit test all read this,
 * so a signature cannot exist in the game without a telegraph — which is the
 * one thing this wave is not allowed to ship.
 *
 *   name  the words on screen        ink   its colour, everywhere
 *   blurb the opening-bell headline  rule  the hover sentence, in full
 */
export const SIGNATURES = {
  // ---- PART 3: the elites -------------------------------------------------
  shatterguard: {
    tier: 'elite', name: 'SHATTERGUARD', ink: '#9adcff', icon: 'icon_shield',
    blurb: 'SHATTERGUARD: you gain NO Shield this fight',
    rule: 'SHATTERGUARD: you gain NO Shield for the whole fight, from any source. Killing it does not lift that.',
  },
  feast: {
    tier: 'elite', name: 'FEAST', ink: '#ff6a76', icon: 'icon_drop',
    blurb: `FEAST: every point of HP it takes heals it ×${FEAST_MULT}`,
    rule: `FEAST: whenever it takes HP off you it heals ${FEAST_MULT}× that amount. Damage your SHIELD absorbs feeds it nothing at all.`,
  },
  pack: {
    tier: 'elite', name: 'CALL OF THE PACK', ink: '#ffb060', icon: 'icon_up',
    blurb: 'CALL OF THE PACK: it never fights alone',
    rule: `CALL OF THE PACK: it opens with a wolf already beside it and howls up another every 3rd turn, never more than ${PACK_CAP} alive at once.`,
  },
  glacialAegis: {
    tier: 'elite', name: 'GLACIAL AEGIS', ink: '#9adcff', icon: 'icon_snow',
    // "every ${AEGIS_PERIOD}rd turn" printed "every 3rd turn" only because the
    // period happens to be 3; retuning it to 2 would have printed "every 2rd".
    blurb: `GLACIAL AEGIS: IMMUNE on turn ${AEGIS_FIRST_TURN}, then every ${turnWord(AEGIS_PERIOD)}`,
    rule: `GLACIAL AEGIS: nothing reaches it on turn ${AEGIS_FIRST_TURN} and every ${AEGIS_PERIOD} turns after. It still attacks while the shell is up.`,
  },
  dreadGrip: {
    tier: 'elite', name: 'DREAD GRIP', ink: '#c9a0ff', icon: 'fx_leaf',
    blurb: `DREAD GRIP: ${DREAD_GRIP_POWER} fewer cards in hand, all fight`,
    rule: `DREAD GRIP: you are dealt ${DREAD_GRIP_POWER} fewer cards for the whole fight.`,
  },
  rimeThorns: {
    tier: 'elite', name: 'RIME THORNS', ink: '#9adcff', icon: 'fx_star',
    blurb: `RIME THORNS: +${RIME_THORNS_ELITE} SPIKES every single turn`,
    rule: `RIME THORNS: +${RIME_THORNS_ELITE} SPIKES every turn, on top of whatever else it does. Spikes never fade, and every hand you play costs HP equal to the stack.`,
  },
  wakingWrath: {
    tier: 'elite', name: 'WAKING WRATH', ink: '#8fe098', icon: 'icon_hourglass',
    blurb: `WAKING WRATH: it wakes slowly, then ×${WRATH_RAMP} a turn`,
    rule: `WAKING WRATH: turn 1 it deals NOTHING, turn 2 it deals what is printed, and from turn 3 its damage multiplies by ${WRATH_RAMP} every turn. The intent always shows the real number.`,
  },
  // ---- PART 4: the bosses -------------------------------------------------
  talonGrip: {
    tier: 'boss', name: 'TALON GRIP', ink: '#ff5060', icon: 'fx_wax_seal',
    blurb: 'TALON GRIP: its Bleed rakes your SWORDS out of play',
    rule: `TALON GRIP: every time it inflicts BLEED it also locks your ${TALON_GRIP_SUIT.toUpperCase()} for ${turnWord(TALON_GRIP_TURNS)}. You may still DISCARD them.`,
  },

  // ---- THE NOCTURNAL FOREST (alternate Act I) ------------------------------
  // Adding a row here is PURE TELEGRAPH: setupBossSpecials walks SIGNATURES and
  // gives every signed body the same opening-bell blurb and badge, and its
  // switch has a `default: break`. So a signature can be announced correctly
  // long before (or without) a bespoke engine branch, which is exactly what the
  // two flagged shortfalls below need.
  moonglare: {
    tier: 'elite', name: 'MOONGLARE', ink: '#bcd0ff', icon: 'icon_help',
    blurb: 'MOONGLARE: two cards go face down EVERY turn',
    rule: 'MOONGLARE: two of your cards go FACE DOWN every turn, wind-up turns included. They are still playable.',
  },
  silkbound: {
    tier: 'elite', name: 'SILKBOUND', ink: '#dfe4f0', icon: 'icon_refresh',
    blurb: 'SILKBOUND: the suit she names deals her NOTHING',
    rule: 'SILKBOUND: she names one suit; that suit deals her NO damage until she names a new one.',
  },
  hunt: {
    tier: 'elite', name: 'THE HUNT', ink: '#ffd870', icon: 'icon_skull',
    blurb: 'THE HUNT: it never hunts alone',
    // NOT "whenever one falls": SUMMON sits on two fixed intents of a six-turn
    // rotation, so a Nightjar killed on turn 3 is not replaced until turn 6.
    rule: `THE HUNT: it opens with the flock already full at ${HUNT_CAP}, and on each HUNT turn it tops the flock back up to ${HUNT_CAP}.`,
  },
  reflection: {
    tier: 'elite', name: 'REFLECTION', ink: '#8fe098', icon: 'icon_heart_small',
    blurb: 'REFLECTION: every point you heal, it heals',
    rule: 'REFLECTION: every point of HP you heal, it heals too. Shield is not healing and does not feed it.',
  },
  scaleDust: {
    tier: 'boss', name: 'SCALE DUST', ink: '#bcd0ff', icon: 'icon_help',
    blurb: 'SCALE DUST: your hand comes to you half unread',
    rule: 'SCALE DUST: two more of your cards turn FACE DOWN every turn. They are still playable.',
  },
  courtSleeps: {
    tier: 'boss', name: 'THE COURT SLEEPS', ink: '#c9a2ff', icon: 'icon_lock',
    blurb: 'THE COURT SLEEPS: no face card may be played while he lives',
    rule: 'THE COURT SLEEPS: J, Q and K cannot be PLAYED for the whole fight. You may still discard them. Kill him and the court wakes.',
  },
  seesItComing: {
    tier: 'boss', name: 'HE SEES IT COMING', ink: '#ffd060', icon: 'icon_magic',
    blurb: 'HE SEES IT COMING: he marks your highest-VALUE card',
    rule: 'HE SEES IT COMING: every turn he marks the highest-VALUE card in your hand. Play the marked card and your whole hand deals him NOTHING.',
  },

  // ---- THE ETHEREAL PLAINS (alternate Act II) ------------------------------
  asYouDid: {
    tier: 'elite', name: 'AS YOU DID', ink: '#bcd0ff', icon: 'icon_sword_small',
    blurb: 'AS YOU DID: it answers your hand. Bigger hands hit back harder',
    // THE REAL RULE, in the terse register, with the real numbers pulled out of
    // the one derivation (biomes.mirrorHandDamage) rather than typed here.
    rule: `AS YOU DID: every hand you hit it with is answered by FLAT damage set by the HAND TYPE: `
      + `${mirrorHandDamage('highCard')} for a High Card, ${mirrorHandDamage('pair')} for a Pair, `
      + `${mirrorHandDamage('flush')} for a Flush, ${mirrorHandDamage('quads')} for Four of a Kind, `
      + `capped at ${MIRROR_HAND_CAP}. It is damage: Shield eats it.`,
  },
  unsinging: {
    tier: 'elite', name: 'UNSINGING', ink: '#ffce7a', icon: 'fx_dust',
    blurb: 'UNSINGING: two cards fade every turn',
    rule: 'UNSINGING: two of your cards start FADING every turn. A fading card may vanish forever the moment it scores.',
  },
  stillness: {
    tier: 'elite', name: 'STILLNESS', ink: '#a8d8c8', icon: 'icon_hourglass',
    blurb: 'STILLNESS: untouchable while it sleeps, and it mends',
    // The designed rule is "intangible every other turn, and heals while it
    // sleeps". The intangible half is EXACTLY the Frost Guardian's cadence, so
    // it borrows that machinery rather than growing a second copy of it; only
    // the words differ, because GLACIAL AEGIS reads wrong in a field of pale
    // grass. The mend is the second half, paid on the turns it is under.
    rule: `STILLNESS: nothing reaches it while it sleeps, and it mends ${Math.round(STILLNESS_MEND * 100)}% of itself each time it goes under. It still attacks on the turns it is awake.`,
  },
  reweave: {
    tier: 'elite', name: 'REWEAVE', ink: '#c9a0ff', icon: 'icon_setting',
    // NOT "every second turn": REWEAVE sits at positions 2 and 4 of a SIX-turn
    // rotation, so the real cadence is twice per six with a four-turn gap.
    blurb: `REWEAVE: hand size -${SHRINK_HAND_STEP}, twice every six turns, permanently`,
    rule: `REWEAVE: it pulls a thread twice in every six turns, and your HAND SIZE drops by ${SHRINK_HAND_STEP} each time for the rest of the fight.`,
  },
  scaffold: {
    tier: 'boss', name: 'SCAFFOLD', ink: '#dfe4f0', icon: 'icon_shield',
    blurb: 'SCAFFOLD: nothing reaches him until the wall comes down',
    rule: 'SCAFFOLD: he raises a wall every turn and shows you the ONE hand type that breaks it. Until you play that hand, your damage does not reach him at all.',
  },
  nothingTwice: {
    tier: 'boss', name: 'NOTHING TWICE', ink: '#fff0c0', icon: 'icon_star',
    blurb: 'NOTHING TWICE: only a hand you have not played yet can hurt her',
    rule: 'NOTHING TWICE: she takes damage ONLY from hand types you have not played yet this fight.',
  },
  weightless: {
    tier: 'boss', name: 'WEIGHTLESS', ink: '#dfe4f0', icon: 'icon_trash',
    blurb: 'WEIGHTLESS: cards left in hand drift away',
    rule: 'WEIGHTLESS: anything still in your hand at the end of the turn drifts away and is gone for this fight.',
  },

  // ---- THE BURNING GALLOWS (alternate Act III) -----------------------------
  condemned: {
    tier: 'elite', name: 'CONDEMNED', ink: '#ffb060', icon: 'fx_wax_seal',
    blurb: `CONDEMNED: a branded card burns in ${CONDEMN_TURNS} turns`,
    rule: `CONDEMNED: he brands a card every turn. PLAY it within ${turnWord(CONDEMN_TURNS)} or it burns out of your DECK for good. Discarding does not save it.`,
  },
  pyreTax: {
    tier: 'elite', name: 'PYRE TAX', ink: '#ff8a40', icon: 'icon_coins',
    blurb: `PYRE TAX: every hand costs ${CARD_TAX_PER_CARD} HP per card`,
    rule: `PYRE TAX: playing a hand costs you ${CARD_TAX_PER_CARD} HP per card in it.`,
  },
  cutThemDown: {
    tier: 'elite', name: 'CUT THEM DOWN', ink: '#ff9a50', icon: 'icon_skull',
    blurb: 'CUT THEM DOWN: it keeps cutting them loose',
    // Same correction as THE HUNT: the cut is on a fixed intent, not on a death.
    rule: `CUT THEM DOWN: it opens with two of its dead already up, and each CUT turn refills the line to ${GALLOWS_CAP}. Nothing is replaced between cuts.`,
  },
  doubleJeopardy: {
    tier: 'boss', name: 'DOUBLE JEOPARDY', ink: '#ffc542', icon: 'icon_lock',
    blurb: 'DOUBLE JEOPARDY: each hand type may be played ONCE',
    rule: 'DOUBLE JEOPARDY: every hand type may be played once for the whole fight. He also passes SENTENCE, naming the hand he expects next.',
  },
  struckFromRecord: {
    tier: 'boss', name: 'STRUCK FROM THE RECORD', ink: '#ff7040', icon: 'icon_fire',
    blurb: 'STRUCK FROM THE RECORD: every card you play is BURNED',
    rule: 'STRUCK FROM THE RECORD: every card you play is burned and cannot be played again this fight, reshuffles included.',
  },
  theQueue: {
    tier: 'boss', name: 'THE QUEUE', ink: '#ff9a50', icon: 'icon_gem',
    blurb: 'THE QUEUE: it hangs one of your RELICS every turn',
    rule: 'THE QUEUE: every turn it hangs one of your relics, LEFT TO RIGHT, and that relic does nothing for the rest of the fight. A mirror aimed at a hanged relic copies a dead one.',
  },
};

/**
 * The three biome effects that carry a COUNT worth printing beside the glyph.
 * The other thirteen are switches, not quantities: a bare "1" next to a padlock
 * reads as "one lock", which is exactly the confusion the 2026-08-02 wave hit.
 * (The GLYPHS themselves live in CombatScene.INTENT_ICONS, with the rest of the
 * intent vocabulary's art.)
 */
export const BIOME_VALUE_EFFECTS = ['blind', 'fade', 'condemn'];

/** The signature this def carries, or null. */
export function signatureOf(def) {
  return SIGNATURES[def?.special] ?? null;
}

/** Every def in the game that carries `id` as its signature. */
export function ownersOfSignature(id) {
  return Object.values(ENEMY_DEFS).filter(d => d.special === id);
}

// --- E1 SHATTERGUARD -------------------------------------------------------
/**
 * The whole rule, as arithmetic: a shattered grant is worth nothing at all.
 * CombatScene.shieldGain is the single funnel every point of player Shield
 * passes through, so wiring this in there covers hands, relics, potions,
 * events and the fight's own opening plate with one clause.
 */
export function shieldAfterShatter(amount, shattered) {
  return shattered ? 0 : Math.max(0, Math.round(amount ?? 0));
}

// --- E2 FEAST --------------------------------------------------------------
/**
 * What a FEAST heals. `hpDamage` is what actually came off HP — NOT what was
 * swung and not what Shield ate, which is exactly why plating is the answer.
 */
export function feastHeal(hpDamage, mult = FEAST_MULT) {
  return Math.max(0, Math.round(Math.max(0, hpDamage ?? 0) * mult));
}

/** Put HP back on a body, capped at its own maximum. Returns what it gained. */
export function healEnemy(enemy, amount) {
  if (!enemy?.alive || !(amount > 0)) return 0;
  const before = enemy.hp;
  enemy.hp = Math.min(enemy.maxHp, before + Math.round(amount));
  return enemy.hp - before;
}

// --- E4 GLACIAL AEGIS ------------------------------------------------------
/**
 * Is the Guardian immune on its `turn`-th turn (1-based)? Turn 2, then every
 * AEGIS_PERIOD turns: 2, 5, 8, 11 ... DERIVED, never stored, exactly like the
 * Depth Knight's morphForm — so the shell, the badge and the damage gate can
 * never disagree however long the fight runs.
 */
export function aegisImmuneOn(turn) {
  const t = Math.round(turn ?? 0);
  return t >= AEGIS_FIRST_TURN && (t - AEGIS_FIRST_TURN) % AEGIS_PERIOD === 0;
}

/** Turns from `turn` until the shell next closes. 0 = it is closed right now. */
export function turnsUntilAegis(turn) {
  const t = Math.max(0, Math.round(turn ?? 0));
  for (let i = 0; i < AEGIS_PERIOD + AEGIS_FIRST_TURN; i++) {
    if (aegisImmuneOn(t + i)) return i;
  }
  return 0;
}

// --- E7 WAKING WRATH -------------------------------------------------------
/**
 * The multiplier on its PRINTED damage for its `turn`-th turn (1-based):
 *
 *   t1 ×0  ·  t2 ×1  ·  t3 ×1.6  ·  t4 ×2.56  ·  t5 ×4.096  ·  t6 ×6.554 ...
 *
 * It is set on `enemy.voidPower` for the turn AHEAD, so currentIntent has
 * already multiplied it into the number on the intent icon before you commit
 * your hand. That is the mechanic: a cliff you can see coming.
 */
export function wrathPowerFor(turn) {
  const t = Math.round(turn ?? 0);
  if (t <= 1) return 0;
  if (t === 2) return 1;
  return Math.round(Math.pow(WRATH_RAMP, t - 2) * 1000) / 1000;
}

/** The whole advertised schedule for one printed number — what the test reads. */
export function wrathSchedule(printed, turns = 8) {
  return Array.from({ length: turns }, (_, i) =>
    Math.max(0, Math.round(printed * wrathPowerFor(i + 1))));
}

/** Arena slot positions per living-enemy count (x offsets from arena center). */
/** slot.y is the GROUND LINE (where feet touch), not the sprite center. */
export const ENEMY_SLOTS = {
  1: [{ dx: 170, y: 712, scaleMul: 1.0 }],
  2: [{ dx: 10, y: 700, scaleMul: 0.9 }, { dx: 340, y: 726, scaleMul: 0.9 }],
  3: [{ dx: -110, y: 688, scaleMul: 0.8 }, { dx: 150, y: 710, scaleMul: 0.8 }, { dx: 390, y: 730, scaleMul: 0.8 }],
  /**
   * FOUR — the Frostbitten Summoner's full court: the boss stands roomy and
   * alone on the left while his three raised dead huddle to the right. Slot 0
   * is always the boss (`def.slotCount` reserves the layout from turn one, so
   * a mid-fight summon just fills the next empty pedestal without moving
   * anyone). The right-hand stack's info column bottoms out around y=436,
   * comfortably clear of the potion mat (which ends at y=186).
   */
  4: [
    { dx: -300, y: 716, scaleMul: 0.80 },
    { dx: 90, y: 680, scaleMul: 0.58 },
    { dx: 295, y: 708, scaleMul: 0.58 },
    { dx: 500, y: 738, scaleMul: 0.58 },
  ],
};
