/**
 * @file pulseChannels.js
 * THE REGISTER OF EVERY CHANNEL A RELIC CAN CONTRIBUTE THROUGH, and whether
 * that channel has a BEAT on screen.
 *
 * WHY THIS FILE EXISTS (JC, 2026-08-11). He played Drusky, his hero exclusive
 * multiplied the finished mult "at the end without any obvious trigger", and a
 * mythical mirror copying it was just as silent. The effect WORKED. Nothing
 * swelled. The rule the whole Balatro cascade was built on — EVERY ARTIFACT
 * THAT CHANGES THE NUMBER VISIBLY ACTIVATES — had been quietly broken by the
 * SOLID GOLD SACK, and by eleven other channels beside it, for one boring
 * reason: adding a relic means writing a new key into a mods/props bag, and
 * nothing anywhere ever asked whether the cascade knew that key's name.
 *
 * So the knowledge stops living in one 14,000-line scene file's head. Every
 * channel is written down HERE, exactly once, in one of two lists:
 *
 *   PULSED_CHANNELS      — it moves a number the player is watching, and some
 *                          beat in CombatScene swells the relic that did it.
 *   NON_SCORING_CHANNELS — it never enters the combat equation at all (a shop
 *                          discount, a hand-size bonus, an immunity). Each one
 *                          carries its own justification, because "this one is
 *                          fine" is the sentence that cost us the Sack.
 *
 * tests/pulses0811.test.js walks every artifact definition in the game,
 * collects the keys they actually write, and asserts that set is a SUBSET of
 * the union of these two lists. A relic invented on a brand-new channel FAILS
 * THE TEST until somebody has looked at it and decided which list it belongs
 * in — which is the only version of this rule that survives contact with the
 * next fifty relics.
 *
 * PHASER-FREE ON PURPOSE. CombatScene imports it (so the scene and the test can
 * never hold different opinions) and a node:test file imports it (so the check
 * costs nothing and runs on every commit).
 *
 * DELIBERATELY ABSENT NAMES ARE THE POINT. `shieldMult`, `zealUncap`,
 * `heartDamageOff` and `cloverDamageOff` are live levers in scoring.js that NO
 * relic writes today. They are in neither list, so the first relic to pick one
 * up trips the test and gets a beat designed for it — rather than shipping
 * silent the way the Sack did.
 */

/**
 * CHANNELS THAT MOVE THE NUMBER, AND HAVE A BEAT.
 *
 * The comment on each entry names WHERE the swell happens, so the next person
 * to touch the cascade can find the job rather than guess at it.
 */
export const PULSED_CHANNELS = new Set([
  // --- mods: the SCORE side ------------------------------------------------
  'suitValue',        // per-card, at the card's own tick (pulseValueArtifacts)
  'faceValue',        // ...same beat
  'modValue',         // ...same beat
  'cardValue',        // ...same beat (THE CAMPSTOOL; see pulseValueArtifacts)
  'handValue',        // cascade job, eqAddScore (THE STRAIGHTEDGE's bank)
  'flatValue',        // cascade job, eqAddScore (Pocket Anvil, the Golden Spud)
  'shieldValue',      // cascade job, eqAddScore (THE TORTOISE STANDARD)
  'flatShield',       // cascade job, ◆ text (THE TUNGSTEN CUBE)
  'valueFactor',      // cascade job, eqMulScore (THE FORGE HAMMER)
  'handRepeat',       // cascade bow + repeatBeat's per-activation replay
  'handRepeatAdd',    // ...the additive channel that builds the total
  // --- mods: the MULT side -------------------------------------------------
  'flatMult',         // cascade job, eqAdd (every scaler in the game)
  'handMult',         // cascade job, eqAdd
  'suitMult',         // cascade job, eqAdd (Prayer Beads and friends)
  'faceMult',         // cascade job, eqAdd (× res.faceCount)
  'handFactor',       // cascade job, eqMul
  'globalMultFactor', // cascade job, eqMul
  'modCardFactor',    // cascade job, eqMul (the Alchemist's Still)
  'chipMultAdd',      // cascade job at the OPEN (Drusky's passive, step 3)
  'chipMultFactor',   // cascade job AFTER the walk (THE SOLID GOLD SACK, step 8)
  'benchFactor',      // leftoverPhase() / benchBeat(), after the repeat
  'benchRepeat',      // ...and the Latent Repeater's bow inside that beat
  'retriggerTop',     // per-card ↻ at the retrigger beat + a cascade bow
  // --- mods: the OUTPUT rewrites ------------------------------------------
  'shieldByMult',     // cascade job, "◆ ×effMult"
  'healByMult',       // cascade job, "♥ ×effMult"
  'gemDamageFactor',  // cascade job, "diamonds bite"
  // --- mods: THE HAND ITSELF ----------------------------------------------
  // These do not add a number, they change WHICH HAND YOU PLAYED — a bigger
  // base AND a bigger mult, from one relic, before the equation opens. They
  // take a TEXT bow naming the hand they made, at the head of the cascade.
  'ofAKindMinus1',    // THE UNDERSTUDY
  'flushMinus1',      // THE BROKEN COMPASS
  'straightMinus1',   // THE ROPE LADDER
  'trueColors',       // TRUE COLORS — rewrites every scoring card's RULE suit
  'handLevels',       // the Smith's levels, printed in the equation's caption

  // --- props: the cascade's own jobs --------------------------------------
  'oneCardFactor',    // cascade job, eqMul (SINGULARITY)
  'lowHpFactor',      // cascade job, eqMul (the Adrenal Vial)
  'firstHandFactor',  // cascade job, eqMul (Ambusher's Hourglass)
  'nthHandEvery',     // cascade job, eqMul (the Chronos Coil)
  'nthHandFactor',    // ...its partner
  'allIn',            // cascade job, eqMul ×3 + the ALL IN burn pulse
  'oneCardRepeat',    // cascade bow + repeatBeat (THE SHARPEST DAGGER)
  'deadMansHand',     // cascade job, eqMul + a ↻ bow
  'deadMansFactor',   // ...its factor
  'deadMansRepeat',   // ...its replay
  'chaosMult',        // the ORB's rolled number, at the orb's own cell
  'leftoverPct',      // leftoverPhase() (COURT IN SESSION)
  'riggedWheelFactor',// benchBeat(), one beat per held-back roulette card
  'etherealBenchFactor', // benchBeat(), one beat per held-back ghost
  'voidcaller',       // the ⊘ VOID pulse when it answers a vanish roll
  'oneCardValue',     // per-card value grant (Blunt Dagger) via _valueGrants
  'aceCrown',         // ...the Crown's opening Ace, same path
  // --- props: the post-equation beats (each has a pulseByProp) -------------
  'shieldFactor',     // AEGIS CORE, at the plate
  'handStrikes',      // ⚔ ×N
  'handEcho',         // ECHO
  'resonance',        // BONDED
  'tether',           // TETHERED
  'swordCleave',      // CLEAVE
  'aoeAll',           // HALLOWED
  'aoeFlush',         // METEOR
  'overkillSpill',    // SPILLS OVER
  'poisonSpread',     // THE STORM CARRIES IT
  'poisonDoubleTick', // ☠ ×N
  'shieldMelts',      // MELTS
  'thunderEvery',     // THUNDERHEAD
  'aurum',            // ◆ ARMOR — the Aurum Heart plating off card value
  'firstHandRepeat',  // THE ENGINE TURNS — the opener's second swing
  'execute',          // EXECUTED — the Seal finishing a low enemy
  'secondWind',       // SECOND WIND — the refusal to die
]);

/**
 * CHANNELS THAT LEGITIMATELY NEVER TOUCH THE COMBAT EQUATION.
 *
 * The bar for this list is narrow and literal: the channel changes no number on
 * the score side, no number on the mult side, and no number the hand outputs.
 * Money, doors, inventory, immunities and BANKING RATES live here. Anything
 * that pays out later pays out THROUGH a pulsed channel, and it is that
 * channel's beat that shows the player the money — which is why the rate itself
 * needs no bow of its own.
 */
export const NON_SCORING_CHANNELS = new Set([
  // --- the purse ----------------------------------------------------------
  'chipGain',            // a % on chips gained; the chip number pops on its own
  'handsChipBonus',      // chips per unspent hand, paid at fight end
  'skipChips',           // chips for skipping a reward, paid in the reward UI
  'eliteChips',          // chips for an elite kill, paid at the drop
  'nodeChips',           // chips per map node arrival, paid on the map
  'overhealChips',       // overheal -> chips, paid with its own ♥->¢ pop
  'overhealChipCap',     // ...its ceiling
  'encounterInterest',   // interest on the purse per encounter, paid on the map
  'encounterInterestCap',// ...its ceiling
  'shopEntryStep',       // chips per shop visit (the Rainy Day Jar)
  'shopEntryCap',        // ...its ceiling
  // --- the merchant -------------------------------------------------------
  'shopDiscount',        // price only; the equation never sees a price
  'freeRestock', 'restockHalf', 'freeFirstRestock',
  'extraStock',          // one more item on the shelf
  'merchantScale',       // sell/buy ratio
  'fullSellValue',       // sell price only
  'packExtra',           // one more option in a booster pack
  'eventChoices',        // one more option at an event
  // --- the belt and the hand ----------------------------------------------
  'handSizeBonus',       // how many cards you hold; changes choice, not maths
  'noSlot', 'nook',      // where a relic RENDERS. Pure layout.
  'slotDrain',           // the Satchel's price: a belt cell, not a number
  'sovereignWrit',       // refuses enemy SIGNATURES; nothing is added by it
  // --- immunities: they REFUSE a status, they never scale one --------------
  'immuneBleed', 'immuneFreeze', 'immuneFreezeAll', 'immuneFear', 'immuneHypno',
  'freezeReduce',        // fewer frozen cards; the frost pops its own count
  'potionKeep',          // a chance to keep a potion, announced by the potion
  // --- BANKING RATES: the payout rides a pulsed channel --------------------
  // Each of these decides how fast a relic GROWS. Nothing they do reaches the
  // equation directly: the growth lands on mods.flatMult / mods.flatValue /
  // mods.cardValue / run.handLevels, and it is THAT channel's cascade job (plus
  // showBanked's "↑ +N" receipt at the end of the hand) that shows the player
  // the number moving. A bow here as well would credit one gain twice.
  'destroyMult',         // Grave Robber's Spade: banks flatMult per card killed
  'honeValue',           // THE CAMPSTOOL: banks cardValue at the rest site
  'anvilMemory',         // the Worn Anvil: banks a Smith level (handLevels)
  'kittenFeed',          // the Stray Kitten: meals until it becomes the Black Cat
  'restFed',             // the Sourdough Starter: banks flatValue at a rest
  'eliteRarityBoost',    // a better DROP, not a better hand
  // --- rates that resolve outside the equation ----------------------------
  // POISON CONVERSION is a delivery rule, not a contribution: it decides what
  // share of a blow the equation ALREADY produced arrives as poison instead of
  // as damage. The ☠+N stack pops on the enemy where the conversion happens.
  'poisonConvert',
]);

/**
 * Every channel name this file has an opinion about. The test's whitelist.
 * @type {Set<string>}
 */
export const KNOWN_CHANNELS = new Set([...PULSED_CHANNELS, ...NON_SCORING_CHANNELS]);

/**
 * The channels in `keys` that nobody has ruled on yet — the exact list a new
 * relic has to answer for. Used by the test, and by the scene's dev-time
 * ledger check, so both ask the question the same way.
 * @param {Iterable<string>} keys
 * @returns {string[]}
 */
export function unknownChannels(keys) {
  return [...new Set(keys)].filter(k => !KNOWN_CHANNELS.has(k)).sort();
}
