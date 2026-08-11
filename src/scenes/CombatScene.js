/**
 * COMBAT — one encounter, entered from a map node, resolved back to the map.
 * All persistent run state lives in core/run.js; this scene owns only the
 * fight-local state (dealt deck, hand, enemy array, player debuffs).
 *
 * Artifacts plug in three ways:
 *   declarative mods  — merged into scoring via run.collectMods()
 *   props             — flat switches read with prop() at decision points
 *   hooks             — fightStart / afterHand / kill / fightEnd callbacks
 */

import {
  GAME_W, GAME_H, SIDEBAR_W, COLORS, DEPTH, CARD, CHARACTERS, PLAYER_BASE, SUIT_COLORS, SUIT_PIP_KEY, SUIT_GLYPH, PARCH,
  HOARD_LEFTOVER_BONUS, PARTICLE_VARIANTS, applyMobileCamera, MOBILE,
  // THE TOUCH PASS (JC, 2026-08-10). TOUCH is MOBILE under its honest name —
  // every `MOBILE ?` below it is a finger-size bump and stays one; TOUCH is
  // what the two-tap model and the safe frame are asked about. PLAY_W is the
  // arena's own width, which is 1920 on a phone and 1500 on a tablet, so
  // anything sized "a fifth of the arena" says so instead of guessing.
  TOUCH, SAFE, clearsCorners, PLAY_W,
} from '../config.js';
import { woodPanel } from '../ui/panels.js';
import {
  shuffle, cardValue, scrambleSuits, restoreSuits, pickSliceVictims, rankLabel,
} from '../core/deck.js';
import { evaluateHand, bestHandOf, HAND_DEFS } from '../core/poker.js';
import {
  scoreHand, rollRouletteFor, MOD_MULT_FACTOR,
  ZEAL_CAP, ZEAL_DAMAGE_PCT, zealCapFor, SHIELD_MULT_PCT,
  benchTriggers, STAMPS, FADE_VANISH_CHANCE, VALUE_BONUS_BY_MOD,
  ROULETTE_GOLD_CHIPS, ROULETTE_RED_MULT, ROULETTE_GREEN_VALUE,
  INFINITY_CAP, isInfinite,
} from '../core/scoring.js';
import {
  tickStatuses, onEnemyAct, brittleMultiplier, addEnemyShield, absorbWithShield,
  freshPstat, isFaceCard, ROOTED_STRENGTH, REGULAR_DENIAL_TURNS,
  armedSnapshot, tickPlayerDebuffs, spikeBite, absorbSpikes,
  cardIsDenied, denialRunning, deadlockState,
} from '../core/statuses.js';
import {
  ENEMY_DEFS,
  makeEnemy, currentIntent, advanceIntent, describeEffect, ENEMY_SLOTS,
  canRaise, freeSlotIndex, morphForm, rampVoidPower, silenceEnemy, consumeSilence,
  CARD_DENIAL_CAP, isRankAndFile,
  shieldGrantFor, wardTarget, stealDiscards, tickFleeClock, resolveFlee,
  // --- parts 3 & 4 of the 2026-08-02 wave: elite and boss signatures ---
  SIGNATURES, signatureOf, MAX_SKELETONS as MINION_CAP,
  shieldAfterShatter, FEAST_MULT, feastHeal, healEnemy,
  aegisImmuneOn, turnsUntilAegis, STILLNESS_MEND,
  DREAD_GRIP_POWER, PACK_CAP, RIME_THORNS_ELITE, TALON_GRIP_SUIT, TALON_GRIP_TURNS,
  wrathPowerFor, WRATH_RAMP,
  // The three biome effects whose telegraph prints a COUNT (see BIOME_EFFECTS).
  BIOME_VALUE_EFFECTS,
} from '../core/enemies.js';
// THE BIOME ENGINE (2026-08-03) — the pure rules behind BLIND / FADE / BURNED
// and the fourteen effects that ride them. Every one of them is decided in
// core/biomes.js so a unit test can construct the worst case; this file owns
// the theatre and the wiring, exactly as it does for the debuff wave above.
import {
  BIOME_EFFECTS, BIOME_EFFECT_TYPES, BLIND_TURNS, CONDEMN_TURNS,
  CARD_TAX_PER_CARD, MIRROR_HAND_PCT, DEMAND_HAND_DAMAGE, SHRINK_HAND_STEP,
  freshBiomeLedgers, isBurned, burnCards, purgeBurned,
  recordHandType, handTypeSpent, mistrialDue, declareMistrial, remainingHandTypes,
  nextHungRelic, hangArtifacts,
  damageGate, forgetSuitFactor, pickForgottenSuit,
  cardTaxFor, demandVerdict, mirrorDamage, healMirrorAmount,
  condemnTick, dischargeBrands, brandTurns,
  pickBlindTargets, pickFadeTargets, fadedSet,
} from '../core/biomes.js';
import {
  bossEntry, rollEncounter,
  // ENDLESS: the loop hue, the depth arithmetic and the labels every ceremony
  // prints. All pure functions of the act index — see the ENDLESS block in acts.js.
  endlessTint, endlessLabel, endlessLoop, endlessDepth, isEndlessIndex,
} from '../core/acts.js';
import { difficultyOf, showsHandMath } from '../core/difficulty.js';
import { progress, recordActClear, recordWin, discoverHand, notePlayedHand, foldRunIntoRecords } from '../core/progress.js';
import { heroTextureFor, equippedSkin } from '../core/skins.js';
import {
  run, chr, collectMods, collectModList, addHandRepeat, advanceAct, beginEndless, noteEndlessClear,
  effectiveArtifacts, effectiveArtifactSlots,
  slotsUsed, mirrorBlockedBy,
  mirrorNote, cardKey, noteReached, noteKill, beltArtifacts, nookArtifacts, gainGold, chipGainFactor,
  checkpointFight, clearPendingFight, handSizeOf, HAND_SIZE_FLOOR, leftoverHandChips,
  // THE BELL AT THE BOTTOM OF THE CARD-DESTRUCTION FUNNEL. burnCardForever is
  // the one removal path that owns its own splice (it has a draw pile, a
  // discard pile and a live sprite to sweep as well as the run deck), so it
  // rings the bell by hand — see noteCardsDestroyed's own note.
  noteCardsDestroyed,
  // ALTERNATE ACTS: ACTS[i] is only half the answer now. actOf resolves the
  // index through run.actPicks, which was rolled once at run start.
  actOf,
  // THE ORACLE's clock, floored at one hand however much it took away.
  handsPerFight,
  // SELLING MID-FIGHT (JC, 0803): the merchant's own door, opened on the mat.
  sellValue, sellArtifactWithReceipt,
} from '../core/run.js';
// THE ORACLE, in the two places a fight can feel it: where a spent card is filed
// (THE RECYCLER) and what a ghost pays for its x1.5 (SPIRITUAL).
import { stowPlayedCard, etherealVanishChance } from '../core/oracle.js';
import { stageFor, fetchStage } from '../core/stages.js';
// DEFERRED ART (core/lazyload.js): the world's backdrop and this room's bodies
// are fetched for the room, not for the boot.
import {
  ensure, missingKeys, actBundle, encounterBundle, heroCardfaces, skinBundle, packCovers,
} from '../core/lazyload.js';
import { gateOn } from '../ui/loadingVeil.js';
import { uninstallRunRng } from '../core/rng.js';
import { autosave, clearSave } from '../core/save.js';
import { drawRecap, recapRows, unlockRows, recapHeight, RECAP } from '../ui/runRecap.js';
import {
  ARTIFACT_RARITY, ARTIFACT_POOL, acquireArtifact, getProp, WHEEL_OF_DIVINITY_WEDGES,
  artifactLiveLine, chaosMultRoll,
  // THE 2026-08-10 WAVE. Only the two numbers COMET IN A JAR quotes are read
  // here: everything else the wave needs arrives as a `prop` on the instance
  // (props.freezeReduce, props.overhealChipCap, props.thunderEvery,
  // props.deadMansRepeat/Factor, props.potionKeep), which is the same constant
  // one indirection later and keeps mirrored copies reading their OWN number.
  COMET_CHARGES, COMET_FACTOR,
} from '../core/artifacts.js';
// NIGHT 0802: the egg's queued hatch, the potato's secret, the slot machine.
import {
  rollHatchDef, hatchEgg, becomeGoldenSpud, GOLDEN_SPUD_VALUE, SLOT_BUTTON_CHIPS,
  // The Crown's crowned-Ace bonus lives in artifacts.js beside its own copy, so
  // the relic's description and the grant below can never quote different
  // numbers at each other across two files (2026-08-06).
  ACE_CROWN_VALUE,
} from '../core/artifacts.js';
import { rollPackOffer } from '../core/packs.js';
// THE MIXED ELITE SHELF (PATCH 0803 §2) — relics and bottles from one pool.
import { rollEliteSpoils } from '../core/elites.js';
import { artifactCeremony, packOfferOverlay, handChartOverlay, personalize, deckInfoOverlay, deckPickerOverlay, viewDeckButton, addArtifactIcon, dropShadow, bountyPackOverlay, noMirrorBadge, wheelSpinOverlay, eliteChoiceOverlay, DROP_SFX } from '../ui/rewards.js';
import { POTION_RARITY, POTION_BY_ID, potionUsableIn, drinkSfxKey, poisonStacksFor, MAX_POTIONS, applyUniversalEffect, transformPotionAt, actTableRung } from '../core/potions.js';
import { fireAchievements } from '../ui/achievements.js';
import { addPotionIcon, POTION_MAT, potionSpots, MAT_SHADOW } from '../ui/potionIcon.js';
import { CardSprite } from '../ui/CardSprite.js';
import { popNumber, popMessage, shake, burst, hitFlash, actionText, flashVignette, DEBUFF_COLORS, fmtNum, totalPayoffFX, payoffTier, fmtTotal, rainbowText, legible, INK_DARK, embers, INFINITY_GLYPH } from '../ui/juice.js';
import { playMusic, stopMusic, musicFor } from '../core/music.js';
import { sfx, sfxCapped, suspense, registerSfxLoop, refreshSfxVolume, sfxBusVolume } from '../core/sfx.js';
import { settings } from '../core/settings.js';
import { gestureKind, sweepHits, fanSlots, handButtonLanes, SWEEP_TICK_MS } from '../core/dragSelect.js';
// PATCH 0803 §3 — one pitch ladder, one repeat schedule, one accelerator.
import {
  pitchAt, PITCH_MIN_GAP_MS, repeatSchedule, scoringTimeScale, REPEAT_FULL_BEATS,
} from '../core/cadence.js';
import { addSettingsButton } from '../ui/settingsMenu.js';
import { kineticScroll } from '../ui/kinetic.js';
import { installLongPress, tapBind } from '../ui/touch.js';
// THE TWO-TAP DESCRIPTION BOX (JC, 2026-08-10). One idiom for every surface
// whose information hides behind an icon: first tap reads, second tap commits.
// `twoTap` is TOUCH-ONLY BY DESIGN — it throws on desktop — so every call site
// below keeps its own visible `else obj.on('pointerdown', ...)` fork.
import { openChoiceBox, closeChoiceBox, twoTap } from '../ui/choicebox.js';
import { installPointerPolicy } from '../ui/pointer.js';
// THE CARD INSPECT BOX (JC, 2026-08-10): long left press or right-click on a
// hand card prints what it is, what it scores and everything it is wearing.
import { installCardInspect, hideCardInspect } from '../ui/inspect.js';
// THE ROAD AHEAD, read-only, from inside the fight. Never MapScene itself.
import { viewMapButton, hasMapToPeek } from '../ui/mapPeek.js';
// THE ORACLE'S RECEIPT, pinned beside the hero (JC, 2026-08-05).
import { addOracleChip, oracleCardKey } from '../ui/oracleChip.js';
// ...and THE HERO'S PASSIVE stacked above it, which replaced the kit blurb
// (JC, 2026-08-06). core/passives.js owns "did it fire, and by how much".
import { addPassiveChip, pulsePassive, resetPassivePulse } from '../ui/passiveChip.js';
import { passiveAttribution } from '../core/passives.js';

/** How many relics an elite kill puts on the shelf (JC, 2026-07-31). */
const ELITE_DROP_CHOICES = 3;

const ARENA_CX = SIDEBAR_W + (GAME_W - SIDEBAR_W) * 0.50;

/**
 * ONE VERB, TWO INPUTS. There is no cursor on a phone, so a sentence that says
 * "click" is describing a device the player is not holding. Every player-facing
 * string that names the gesture goes through here rather than through a second
 * copy of the sentence, so the two can never drift apart.
 *
 *   say('Click an enemy…', 'Tap an enemy…')
 */
const say = (mouse, touch) => (TOUCH ? touch : mouse);

/**
 * THE STRICTER CORNER TEST, for the audits.
 *
 * config.clearsCorners asks whether the box's NEAREST point to a corner arc is
 * still on the glass — i.e. "is ANY of this visible". A box can pass it with a
 * whole corner hanging out in the bite, which is precisely what a clipped
 * element looks like: the settings cog at its shipped (2296, 42) passed
 * clearsCorners while its outer corner sat 48px beyond the arc, and JC could
 * see that on the phone.
 *
 * This asks whether ALL FOUR corners are inside the arc, which is the question
 * "is any of this CLIPPED" actually is. The driver's contract is still
 * clearsCorners; both verdicts are reported side by side so a human reading
 * chromeAudit can see when the two disagree and why.
 */
function cornersInsideArc(box, r = SAFE.corner) {
  if (!(r > 0)) return true;
  for (const [cx, cy] of [[r, r], [GAME_W - r, r], [r, GAME_H - r], [GAME_W - r, GAME_H - r]]) {
    for (const px of [box.left, box.right]) {
      for (const py of [box.top, box.bottom]) {
        const outX = cx <= r ? px < cx : px > cx;
        const outY = cy <= r ? py < cy : py > cy;
        if (outX && outY && Math.hypot(px - cx, py - cy) > r) return false;
      }
    }
  }
  return true;
}

/**
 * How long an opening-bell SIGNATURE sentence stays on screen, and therefore
 * how far apart two of them have to be staggered.
 *
 * These were staggered by 900ms against a 3000ms hold, so a room with two
 * signed bodies drew the second sentence straight through the first — the exact
 * "one pile" the stagger's own comment says it exists to prevent. It went
 * unnoticed because the only pairs that could produce it were forced ones (see
 * tools/verify_biomes.py, which deliberately avoids building them); THE LAST
 * COURT is a designed pair of signed BOSSES and hits it every single fight.
 * One number, read by both the message and the stagger, so they cannot drift.
 */
const BLURB_HOLD = 3000;
/** bigMessage's own fade-out. A sentence is not gone until this has run. */
const BIG_MSG_FADE = 520;
/** ...so this is one sentence's WHOLE life on screen, plus a beat of silence. */
const BLURB_STAGGER = BLURB_HOLD + BIG_MSG_FADE + 140;

/**
 * THE ARTIFACT MAT'S FOOTPRINT, DERIVED ONCE (2026-08-06).
 *
 * The mat GREW when the kit blurb left the sidebar. That blurb was the only
 * thing standing between the status rows and the leather, and it was a
 * paragraph of prose occupying 80px of a HUD otherwise made of objects — so the
 * passive chip took over its job (ui/passiveChip.js) and the relics took its
 * room: +88px of leather on the 340 sidebar, +68 on the 420 one, and every
 * icon, socket and ordinal a size class up inside it.
 *
 * It is ONE table now because it used to be five. The footprint was written out
 * longhand in the texture generator, again in the image's placement, again in
 * the plaque's y, again in cellOf, and once more in the drag code's rowMidY —
 * with the mobile build re-deriving each by scaling the desktop numbers, which
 * is why the 420 mat was drawn very slightly stretched. Everything below now
 * reads these, and the texture is CUT at the size it will be DRAWN at on this
 * build, so neither canvas scales the leather at all.
 *
 *   pad / lip   canvas edge to the leather's edge; `lip` is the extra room at
 *               the top that the brass plaque straddles.
 *   bottom      where the leather's foot sits. The mat is bottom-anchored, and
 *               it always was: growth happens upward, into the freed band.
 *   cy          the row pair's centre, and the nook pouch's, and the drag
 *               code's row boundary.
 *
 * THE CORNER (2026-08-10). The mat is the one thing in the game pinned to a
 * BOTTOM corner, so it is the one thing the phone's corner bite can reach from
 * below. Measured against SAFE.corner = 150, centre (150, 930):
 *
 *   the leather's body   22..398 x 754..1046 -> clearsCorners TRUE
 *   its bottom-left tip  (22, 1046), 172.7 from the centre — 22.7px INSIDE the
 *                        bite. That tip is painted hide with a rounded corner
 *                        of its own and nothing interactive within 30px of it,
 *                        so it is left where JC's 0806 pass put it.
 *   the bottom-left USE tag, which IS interactive, is the thing that had to be
 *                        watched: see USE_TAG.lip, which grows the tag upward
 *                        so its foot stays exactly where the 26-tall one's was.
 *
 * (clearsCorners tests the box's NEAREST point to the arc centre, so it answers
 * "is any of this still on the glass" rather than "is all of it" — which is why
 * the leather passes it. Both verdicts are reported by chromeAudit.)
 */
const MAT = (() => {
  const pad = MOBILE ? 22 : 11;
  const lip = 22;
  // MOBILE, 2026-08-06 (JC: "artifact pad ... extended downward"). The phone's
  // mat stopped 64px short of the bottom edge for a home-indicator margin that
  // nothing else on the canvas respects — the SORT plate beside it already
  // bottoms out at 1059 — so the leather takes 30 of those pixels back and
  // spends them, plus 24 more of its own, on a taller field: 268 -> 292, foot
  // at 1046. Everything inside is centred on `cy`, so the sockets, ordinals,
  // grooves and USE tags follow without a second edit.
  const bodyH = MOBILE ? 292 : 284;
  const bottom = GAME_H - (MOBILE ? 34 : 20);
  return {
    pad, lip, bodyH, bottom,
    bodyW: SIDEBAR_W - pad * 2,
    canvasW: SIDEBAR_W,
    canvasH: lip + bodyH + lip,
    y: bottom - bodyH - lip,        // canvas top; the canvas is drawn at x 0
    bodyTop: bottom - bodyH,
    cx: SIDEBAR_W / 2,
    cy: bottom - bodyH / 2,
  };
})();

/**
 * THE GLOVE NOOK. The artifact mat's inner field is full wall to wall by its
 * six cells, so the pouch is bumped onto the mat's RIGHT edge and hangs just
 * past the sidebar onto the arena's dark band, level with the mat's own middle.
 * It clears the PLAY HAND button (x from 432) with room to spare.
 */
const NOOK = { x: SIDEBAR_W + 28, y: MAT.cy };

/**
 * The brass label plaque straddling the mat's top edge, in hud_mat texture space
 * (the texture is drawn at x=0, so these are screen x too). Shared between the
 * texture that CUTS the plaque and the label that sits ON it, because the label
 * is a sentence rather than one word and the two must not disagree.
 */
const MAT_PLAQUE = { w: MOBILE ? 256 : 218, x: SIDEBAR_W / 2 - (MOBILE ? 256 : 218) / 2, y: 5, h: 26 };

/**
 * How loud the low-health heartbeat sits on the SFX bus. A named constant
 * because two places need the same answer now: the fade that starts the loop,
 * and applyHeartbeatVolume, which re-seats it live when the slider moves.
 */
const HEARTBEAT_VOLUME = 0.55;

/**
 * THE BUTTON LANES EITHER SIDE OF THE HAND (2026-08-06).
 *
 * Two rows of plates, two lanes: PLAY HAND over HANDS+DECK on the left of the
 * fan, DISCARD over SORT on its right. Desktop's five plates keep the exact
 * coordinates they have always had — `home` IS the desktop layout, written down
 * — and the phone lays them out from core/dragSelect.handButtonLanes instead,
 * because on the phone the sidebar is 420 wide (HANDS used to be drawn ON the
 * artifact mat at x 390) and the fan is allowed to be 1180 wide, which reaches
 * both lanes at a twelve-card hand.
 *
 *   needLeft   HANDS + gap + DECK, the wider of the left lane's two rows.
 *   needRight  DISCARD, which is also SORT.
 *
 * ===========================================================================
 * BIGGER BY DEFAULT, SMALLER ONLY UNDER PRESSURE (JC, 2026-08-10)
 * ===========================================================================
 * "Bigger by default, filling their allotted space, easy to press; shrink/step
 * aside dynamically ONLY when a large hand actually crowds them."
 *
 * core/dragSelect.handButtonLanes answers the SHRINK half and clamps its scale
 * at 1 — it was written to stop plates overrunning a fan and has no opinion
 * about spare room. So the GROW half is computed here instead, off the `avail`
 * the same call already reports, between `minScale` and `maxScale`. One
 * expression, two directions:
 *
 *     scale = clamp(avail / need, minScale, maxScale)
 *
 * At five cards on the phone each lane has 534px of air against a 322px need,
 * so both lanes hit the 1.25 ceiling; at eight the left lane is exactly 337px
 * against 322 and grows 4.8%; at twelve it is 206 against 322 and SHRINKS to
 * 0.64, which is the old behaviour, unchanged, where it was always right.
 *
 *   plateH / fontSize  the plate itself. Desktop's 66/26 are the shipped pair
 *                      and every literal that used to hold a copy of them
 *                      (makeButton, layoutHandButtons.place) now reads these.
 *   gutter             wall to lane. TOUCH takes HALF the safe inset (48): the
 *                      DISCARD and SORT plates were 18px off a curved glass
 *                      edge and read clipped on a real phone.
 */
const BTN_LANE = {
  // TOUCH LIFTS BOTH ROWS 30px (2026-08-10). JC: "the DISCARD and SORT plates
  // are slightly clipped." The horizontal half of that is `gutter` below; this
  // is the other half, and it is the one that was actually doing the damage.
  // The bite is deepest on the DIAGONAL, so what gets clipped is the row-2
  // plate's OUTER BOTTOM CORNER, not its edge:
  //
  //   shipped   SORT right 2322, bottom 1059 -> 184.6 from the arc centre
  //             (2190, 930), i.e. 34.6px outside a 150 radius. Clipped.
  //   gutter    right 2292, bottom 1065 -> 169.2. Still 19px out: the taller
  //     alone   78px plate gave back most of what the gutter won.
  //   +lift     right 2292, bottom 1035 -> 145.0. INSIDE. And row 1 rises with
  //             it, because the two rows have to stay 2px apart or the plates
  //             stack: 916+39 = 955, 996-39 = 957.
  //
  // Desktop keeps its shipped pair to the pixel; its canvas has no bite.
  rowY: TOUCH ? [916, 996] : [944, 1026],
  gap: 18,
  playW: 240, discardW: 240, sortW: 240, handsW: 152, deckW: 152,
  gutter: TOUCH ? SAFE.x / 2 : 12,
  // How much air the outermost card keeps to itself. The card is 180 wide on
  // the phone and its corner filigree is the part a plate must not touch.
  clear: MOBILE ? 26 : 18,
  minScale: 0.62,
  maxScale: TOUCH ? 1.25 : 1,
  plateH: TOUCH ? 78 : 66,
  fontSize: TOUCH ? 30 : 26,
  // Desktop's shipped homes, by name. Never read on mobile.
  home: {
    play: 552, discard: -194, sort: -194, hands: 466, deck: 636,
  },
};
BTN_LANE.needLeft = BTN_LANE.handsW + BTN_LANE.gap + BTN_LANE.deckW;   // 322
BTN_LANE.needRight = BTN_LANE.discardW;                                 // 240

/**
 * THE INFO STACK OVER A CREATURE'S HEAD, AS NUMBERS (JC, 2026-08-06).
 *
 * "Enemy HP bars, names, intent icons and numbers enlarged for phone
 * legibility" — and, on desktop, "intent icons + numbers up a notch" (his test
 * case: the Sabre-Toothed Rabbit fight, where a 41px glyph and a 31px numeral
 * read as decoration rather than as the thing you are about to take).
 *
 * Written as ONE table because the stack is a stack: growing the name without
 * growing `hpRow` puts the letters through the bar, and growing the intent
 * without growing `lift` walks the icons down onto the creature's face. The
 * three rows and the headroom above them move together or not at all.
 *
 *   lift     how far ABOVE the sprite's top edge the stack starts. Bigger rows
 *            need more of it, or the bottom of the intent row lands on a head.
 *   hpRow /  the two rows' offsets from the stack's top.
 *   intentRow
 *
 * The verification driver asserts the SIZES OUT OF THIS TABLE rather than out
 * of a literal it keeps its own copy of, so a future retune cannot pass a test
 * that is measuring last week's layout.
 */
const ENEMY_HUD = {
  nameSize: MOBILE ? 30 : 23,
  bossNameSize: MOBILE ? 44 : 34,
  lift: MOBILE ? 101 : 70,
  hpRow: MOBILE ? 46 : 36,
  intentRow: MOBILE ? 108 : 84,
  barH: MOBILE ? 34 : 24,
  barFillH: MOBILE ? 26 : 18,
  barMin: MOBILE ? 300 : 220,
  barMax: MOBILE ? 400 : 300,
  hpTextSize: MOBILE ? 21 : 15,
  chipIcon: MOBILE ? 30 : 22,
  chipTextSize: MOBILE ? 25 : 19,
  statusIcon: MOBILE ? 32 : 24,
  statusStep: MOBILE ? 84 : 64,
  // Air kept between one body's health bar and the next body's. See fitBarWidth.
  barLaneAir: 24,
  sigSize: MOBILE ? 27 : 21,
  sigRow: MOBILE ? 56 : 44,
};

/** The telegraph itself. Desktop is JC's "up a notch"; the phone is a size class on. */
const INTENT_ART = {
  icon: MOBILE ? 58 : 46,
  numSize: MOBILE ? 44 : 36,
  // Per-effect advance along the row: one with a printed number, one without.
  wValue: MOBILE ? 128 : 104,
  wPlain: MOBILE ? 74 : 60,
  hitW: MOBILE ? 380 : 320,
  hitH: MOBILE ? 88 : 70,
  stampSize: MOBILE ? 34 : 29,
};

/**
 * ===========================================================================
 * THE TOP-RIGHT CORNER, DERIVED (JC, 2026-08-10: "the settings cog is
 * basically clipped")
 * ===========================================================================
 * The cog, the potion mat and the boss marquee are three objects fighting over
 * one corner, and until now each of them held its own literal opinion about
 * where the other two were (BOSS_BAR's comment quoted the mat's left edge;
 * the enemy shield chip quoted `GAME_W - 330`). Move any one of them and the
 * other two silently rotted.
 *
 * So the corner is now a CHAIN, computed once, top to bottom:
 *
 *   COG      pulled inside the safe frame. A phone's glass is not a rectangle
 *            and the diagonal is where the bite is deepest, which is exactly
 *            why the cog — alone in a corner — read as clipped while the mat
 *            9pt from the same edge read fine.
 *   POT_MAT  hangs UNDER the cog: its 'POTIONS' brass label starts below the
 *            cog's foot, and its right edge stops 80px short of the glass.
 *   BOSS_BAR.stripW  as wide as the room LEFT OVER between the arena's centre
 *            and the mat's left edge. That is what the shipped 1120 was hand-
 *            measured to be; it is now arithmetic, and it is finally right on
 *            a tablet, whose 1500-wide arena the hand-measured number
 *            overlapped by 185px.
 */
const COG = TOUCH
  ? { x: GAME_W - SAFE.x - 48, y: SAFE.y + 54, size: 66 }
  // Desktop's shipped corner, to the pixel. `size` mirrors what
  // ui/settingsMenu.addSettingsButton draws (44 desktop / 66 touch) so the
  // arithmetic below and the audit hook can both read it without that file
  // having to grow a parameter.
  : { x: GAME_W - 44, y: 42, size: 44 };

const POT_MAT = (() => {
  if (!TOUCH) return { cx: GAME_W - 169, cy: 136, w: 290 };
  // A fifth of the arena, capped: 0.198 reproduces the shipped 380-ish phone
  // mat on a 1920 arena and hands a 1500-wide tablet arena a 297 one instead
  // of the same 350 it has no room for.
  const w = Math.min(380, Math.round(PLAY_W * 0.198));
  const h = w * POTION_MAT.aspect;
  // 26 for the brass label that straddles the leather's top edge, 16 of air
  // above that, and the cog's foot above THAT.
  return {
    cx: Math.round(GAME_W - 80 - w / 2),
    cy: Math.round(COG.y + COG.size / 2 + 26 + 16 + h / 2),
    w,
  };
})();

/** The boss marquee across the top of the arena. */
const BOSS_BAR = {
  // As wide as the room between the arena's centre and the potion mat's left
  // edge allows, with 20px of air, and never wider than the 1120 the phone
  // shipped. Phone: 2*(1880-20-1380) = 960. Tablet: 2*(1543-20-1170) = 706.
  stripW: TOUCH
    ? Math.min(1120, 2 * Math.floor((POT_MAT.cx - POT_MAT.w / 2) - 20 - ARENA_CX))
    : 900,
  gap: 40,
  nameY: MOBILE ? 52 : 44, nameYDuo: MOBILE ? 44 : 38,
  barY: MOBILE ? 128 : 100, barYDuo: MOBILE ? 116 : 92,
  barH: MOBILE ? 56 : 42, barHDuo: MOBILE ? 46 : 34,
  nameSize: MOBILE ? 52 : 38, nameSizeDuo: MOBILE ? 38 : 28,
  hpTextSize: MOBILE ? 30 : 21, hpTextSizeDuo: MOBILE ? 24 : 17,
  chipDrop: MOBILE ? 26 : 18,
  // The intent row rides over the boss's head, but never above the marquee's
  // own chips — this is the floor it is clamped to.
  intentFloor: MOBILE ? 208 : 150,
};

/**
 * THE USE TAG — the brass tab hanging off an active relic's lower lip.
 *
 * It was 72x26 with a 16px word, standing next to a 108px relic icon on a
 * phone, and it fired `useActiveArtifact` on a RAW pointerdown: a one-per-fight
 * irreversible active committed by a stray thumb on a 26px-tall target. It is
 * a size class up on TOUCH and it OPENS THE RELIC'S BOX instead of firing (see
 * buildActiveTag) — the second tap is the labelled button inside.
 *
 *   lip   the tag's centre, as an offset from the icon's BOTTOM EDGE. Negative
 *         on TOUCH so a 40-tall tag's foot lands where the 26-tall one's did
 *         (icon bottom + 14) rather than 7px further down the leather, which
 *         on the bottom row is 7px further into the phone's corner bite.
 */
const USE_TAG = {
  w: TOUCH ? 104 : 72,
  h: TOUCH ? 40 : 26,
  font: TOUCH ? 21 : 16,
  spentFont: TOUCH ? 19 : 14,
  lip: TOUCH ? -6 : 1,
  nookY: TOUCH ? 53 : 46,
};

/**
 * EVERY OTHER SIZE THE PHONE NEEDED, AS A TABLE (JC: "tables, not one-off
 * numbers"). These were all literals written for a 1920 desktop and left at
 * desktop size on a phone held at arm's length — the potion mat's own
 * 'POTIONS' label was 15px on both builds, which is the clearest example.
 * TOUCH runs 15-25% up; desktop's column is every shipped literal, unchanged.
 */
const CHROME = {
  matPlaque: TOUCH ? 20 : 16,      // 'ARTIFACTS ▸ LEFT TO RIGHT' on the brass
  nookLabel: TOUCH ? 17 : 14,      // 'THE GLOVE'
  potionLabel: TOUCH ? 19 : 15,    // 'POTIONS'
  tipTitle: TOUCH ? 27 : 22,       // the artifact tooltip's four sizes
  tipBody: TOUCH ? 23 : 19,
  tipNote: TOUCH ? 21 : 18,
  tipOrder: TOUCH ? 19 : 16,
  tipWrap: TOUCH ? 360 : 300,      // ...and the width they wrap inside
  preview: TOUCH ? 32 : 27,        // the live hand-math line over the fan
  eqName: TOUCH ? 31 : 27,         // the equation's caption (see EQ_NAME_Y)
  eqNum: TOUCH ? 68 : 58,          // [SCORE] and [MULT]
  eqTimes: TOUCH ? 46 : 40,        // the × between them
  eqAoe: TOUCH ? 29 : 25,          // the splash chip beside the caption
};

// --- Score equation readout (replaces the old tapered hand banner) ---
// The band between the enemy nameplates (which bottom out around y=450) and
// the played row's top edge (y=563) is all the room there is, so the equation
// takes the old banner's line and the hand name captions it from BELOW —
// above it would land straight on an enemy's health bar.
//
// TOUCH TAKES 24 MORE (2026-08-10). The card grew to 180x270 and the played row
// rose with it (playedY 668 -> 630), so the row's CEILING is now
// playedY - CARD.h/2 = 630 - 135 = 495 — 41px higher than desktop's 563. At the
// shipped -176 the caption would have sat at 498, inside the played cards. So:
//
//   EQ_Y      630 - 200 = 430          the [SCORE] × [MULT] row
//   EQ_NAME_Y 430 + 44  = 474          the caption
//   caption's line box  474 ± (31 × 1.28)/2 = 454.2 .. 493.8
//   the played row's ceiling            495                    -> 1.2px clear
//
// which is why CHROME.eqName is 31 and not the 33 the same 15-25% pass gave
// everything else: 33 lands the line box on 495 exactly.
const EQ_Y = CARD.playedY - (TOUCH ? 200 : 176);   // 430 touch / 492 desktop
const EQ_NAME_Y = EQ_Y + 44;       // 474 / 536 — hand name, caption-style beneath
const EQ_GAP = 32;                 // half-gap: numbers grow OUTWARD from the ×

/**
 * Mult reads as a clean integer whenever it is one (×2, not ×2.00).
 *
 * ...and as ∞ at the ceiling. The mult is clamped at INFINITY_CAP by the same
 * clamp the damage is (scoring.capNum), so at the top of the game the two are
 * literally the same number and must read the same way. Without this the mult
 * side printed "1e+30" beside a score side that already said ∞ — and a
 * non-finite mult used to print the raw string "Infinity".
 */
const fmtMult = (m) => {
  if (!Number.isFinite(m) || m >= INFINITY_CAP) return INFINITY_GLYPH;
  return Math.abs(m - Math.round(m)) < 0.005
    ? `${Math.round(m)}` : `${Math.round(m * 100) / 100}`;
};

/**
 * "Flush or better" for Meteor Sigil — the four SECRET hands count too.
 *
 * SIX OF A KIND is on the list (2026-08-10): the relic reads "flush-or-better"
 * and the top of the ladder is unambiguously better than a flush. Leaving the
 * game's biggest hand off the game's widest relic would be the 0731 wave's bug
 * (secrets silently excluded from a hand-kept set) happening a third time.
 */
const FLUSH_PLUS = new Set([
  'flush', 'fullHouse', 'quads', 'straightFlush', 'fiveOfAKind', 'flushHouse', 'flushFive',
  'sixOfAKind',
]);

/**
 * TEN HANDS. Hard cap per fight — the anti-stall rule (JC, 2026-07-31). Grind
 * shields and discards all you like, but the tenth hand had better finish it.
 * Echoes/replays are free: the limit counts hands you PLAY.
 *
 * This is the BRONZE number and the baseline core/difficulty.js is written
 * against; the LIVE cap is `this.handLimit`, which reads the run's mode.
 * tests/difficulty.test.js asserts BRONZE still says 10, and the debug hook
 * reports both so a playtest can see them diverge.
 */
const HAND_LIMIT = 10;
/**
 * THE VICTORY PURSE (JC, 2026-08-01). Enemies drop nothing at all any more.
 * Winning a fight pays this per hand STILL ON THE CLOCK, so the economy rewards
 * finishing rooms rather than loitering in them: a 3-hand clear of a 10-hand
 * fight banks 7 × 10 = 70. The Handy Pouch raises the rate to 20.
 *
 * 15 -> 10 (JC, 2026-08-02 nerf pass): the purse was outrunning the shop even
 * after the +25% price pass.
 *
 * THE NUMBER AND THE ORDER both live in core/run.js since 0803-B (see
 * leftoverHandChips), so the rule the hero's +50% follows can be tested in node
 * without standing a Phaser scene up.
 */
/**
 * OPHELIA'S CONVERSION. Half of every point of damage she deals seeps into the
 * body it landed on as POISON. The Bottomless Vile takes it to all of it, and
 * Cruel Sting adds a quarter — both via props.poisonConvert, which is additive
 * on top of this base.
 */
const POISON_CONVERSION = 0.5;
/**
 * THE CLUB SPLASH READOUT. `✷` is the burst glyph — it joins ♥ heal, ◆ shield,
 * ◉ chips and ⚔ damage as a first-class output symbol, in the clubs' green so
 * the suit and the number are the same colour wherever they appear:
 *   · the LIVE preview line, moving as cards are selected (updatePreview)
 *   · a chip beside the hand name in the equation HUD (this.eqAoe)
 *   · under every club card, in the beneath-the-card idiom (cardOutputs)
 * The percentage itself is CLUB_SPLASH, and it lives in scoring.js so no
 * readout can drift from the number that is actually dealt.
 */
const AOE_GLYPH = '✷';
const AOE_COLOR = '#6fdc7f';
/**
 * FEAR CAP. Stacks keep landing (the number on the debuff icon is honest) but
 * they can never cost you more than this many cards — a room full of screamers
 * used to lock you down to a single card and win by arithmetic.
 */
const FEAR_CAP = 2;
/** Fairy in a Bottle's mercy when she saves you from the clock, not the blade. */
const FAIRY_HANDS_BACK = 3;
/**
 * The clock's own epitaph. It used to say "Ten hands" flat, which was a lie on
 * every mode above BRONZE — IRON deals eight and everything past it deals seven.
 * Spelled out so the sentence still reads like a sentence.
 */
const HAND_WORD = { 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten' };
const outOfHandsLine = (limit) => `${HAND_WORD[limit] ?? limit} hands, and the enemy still stands.`;

// ---------------------------------------------------------------------------
// BOSS SIGNATURE MECHANICS (phase 2, 2026-07-31)
// ---------------------------------------------------------------------------
/** The Fairy King's aura: cards off the deal, and the floor it may never cross. */
const ROOTED_PENALTY = 2;
// The FLOOR moved into core/run.js as HAND_SIZE_FLOOR on 2026-08-02, together
// with the arithmetic (handSizeOf), so a unit test can prove that no
// combination of the roots, a Fear and the Ruthless Editor's −1 can soft-lock a
// hand — without standing up Phaser to ask.
/** Effect types that are signature boss mechanics with their own theatre. */
const BOSS_EFFECTS = new Set(['summon', 'quake', 'slice', 'ward', 'morphBuff']);
/**
 * Effect types the enemy aims at ITSELF or at the field rather than at `pstat`
 * — WARDING and PICKPOCKET. They must not go through applyPlayerDebuff (no
 * vignette, no hero flinch, no charm immunity), so they get their own dispatch.
 */
const SELF_EFFECTS = new Set(['shield', 'stealDiscard']);
/**
 * Debuffs that announce themselves in the middle of the arena. enemyTurn skips
 * its generic "label over the enemy" pop for these, or the name prints twice.
 */
const LOUD_EFFECTS = new Set([
  'rooted', 'courtLock', 'suitSeal', 'spikes',
  // ...and the biome wave's own two: both stage a set-piece over the fan.
  'blind', 'fade',
]);
/**
 * SOVEREIGN'S WRIT (the mythical, 2026-08-10) — WHAT A SIGNATURE IS.
 *
 * THE RULING, in one sentence: A SIGNATURE IS NULLIFIED WHEN IT LANDS ON YOU.
 * Your hero, your hand, your deck, your relics, your Shield, your HP, your
 * right to play a hand at all. A signature that only ever changes the ENEMY —
 * its body, its allies, its armour — is untouched, because a bear healing
 * itself is not something happening to you.
 *
 * These are the EFFECT TYPES, i.e. the names an intent carries. Listed by the
 * dispatch that would otherwise deliver them:
 *
 *   applyPlayerDebuff's signature class
 *     rooted (Fairy King's aura and the DREAD GRIP that borrows it), courtLock
 *     (COURT ADJOURNED), suitSeal (RIME THORNS, TALON GRIP's suit lock),
 *     suitban (ETERNAL KEEP), spikes, blind (MOONGLARE), fade (SCALE DUST),
 *     hypnotize (the HYPNOTIC GAZE).
 *   runBossEffect's player-facing half
 *     quake (HOPQUAKE scrambles YOUR suits), slice (AGATHA cuts YOUR cards).
 *   runBiomeEffect's player-facing half
 *     condemn, burnPlayed, handTypeOnce (DOUBLE JEOPARDY), demandHand (THE
 *     QUEUE), hangRelic (UNSINGING), mirrorHand (REFLECTION's throwback),
 *     shrinkHand (REWEAVE), dropHand (WEIGHTLESS), cardTax (PYRE TAX),
 *     markCard (HE SEES IT COMING).
 *
 * WHAT KEEPS WORKING, deliberately: FEAST, CALL OF THE PACK, GLACIAL AEGIS,
 * WAKING WRATH, SILKBOUND, THE HUNT, STILLNESS, SCAFFOLD, NOTHING TWICE, the
 * FROZEN RITE, the SISTERS' WARD, MORPH and the VOID SHELL. Those are their
 * bodies, their allies and their armour, and none of them is an effect on you.
 *
 * ...and GENERIC VIOLENCE lands as always, bosses included: `attack`, `buff`,
 * `charge`, and the plain debuffs (bleed, poison, brittle, fear, freeze) are
 * NOT on this list. The writ answers SIGNATURES, not violence.
 */
const WRIT_BLOCKED = new Set([
  // applyPlayerDebuff's signature class
  'rooted', 'courtLock', 'suitSeal', 'suitban', 'spikes', 'blind', 'fade', 'hypnotize',
  // runBossEffect's player-facing half
  'quake', 'slice',
  // runBiomeEffect's player-facing half
  'condemn', 'burnPlayed', 'handTypeOnce', 'demandHand', 'hangRelic',
  'mirrorHand', 'shrinkHand', 'dropHand', 'cardTax', 'markCard',
]);
/**
 * ...and the same ruling read off a def's SPECIAL id rather than off an intent's
 * effect type, for the whole-fight passives setupBossSpecials switches on at the
 * opening bell (they never arrive as an effect, so they would otherwise be the
 * one door the writ could not stand in). Each maps to the blocked TYPE it is:
 *
 *   rooted / dreadGrip  -> 'rooted'     cards off your deal
 *   wintersForce        -> 'rooted'     which hands you are allowed to play
 *   shatterguard        -> 'rooted'     every point of Shield you gain
 *
 * All three land on YOU and all three are therefore struck down. Everything
 * else in SIGNATURES is the enemy's own body and is deliberately absent.
 */
const WRIT_BLOCKED_SPECIALS = new Set(['rooted', 'dreadGrip', 'wintersForce', 'shatterguard']);
/** Biome dress for WARDING: Act I BARK SKIN · II FROST SHIELD · III GRAVE SHELL. */
const WARD_LOOK = {
  forest: { name: 'BARK SKIN', tint: 0x8fe098, ink: '#8fe098' },
  snow: { name: 'FROST SHIELD', tint: 0x9adcff, ink: '#9adcff' },
  abyss: { name: 'GRAVE SHELL', tint: 0xa878e0, ink: '#c9a2ff' },
  // ...and the 2026-08-03 alternates, one per world.
  nightwood: { name: 'SPORE CRUST', tint: 0x9ad4ff, ink: '#9ad4ff' },
  motes: { name: 'REFRACTION', tint: 0xdfe4f0, ink: '#dfe4f0' },
  ash: { name: 'SLAG CRUST', tint: 0xff8a40, ink: '#ffb060' },
};

/**
 * HOW MUCH OF THE LOOP HUE the arena backdrop takes in the ENDLESS. Kept LOW on
 * purpose: the map board can be washed outright (it is parchment and frame), but
 * the battle backdrop is a painting and the creatures stand in front of it. This
 * is a change of light, not a colour filter.
 */
const ENDLESS_BG_MIX = 0.3;

/**
 * THE ENDLESS'S OWN DRESS. The offer and every endless ceremony wear it so the
 * continuation never looks like the finite game's gold. `ACCENT` is the panel
 * rail (a dark-ground colour), `INK` is the same idea darkened until it is a
 * word again on parchment, and `BTN_TINT` is what makes the red DESCEND button
 * read violet without a new texture.
 */
const ENDLESS_ACCENT = 0x9a5cff;
const ENDLESS_INK = '#6b2fa8';
const ENDLESS_BTN_TINT = 0xc79cff;

/** Blend two 0xRRGGBB tints, channel by channel. t=0 keeps `a`, t=1 becomes `b`. */
function mixTint(a, b, t) {
  const f = Math.max(0, Math.min(1, t));
  const lerp = (shift) => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * f) & 0xff;
  };
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

export class CombatScene extends Phaser.Scene {
  constructor() { super('Combat'); }

  init(data) {
    this.run = run;
    this.chr = chr();
    // Scenes are SINGLETONS: this instance fought the last room too. Re-arm the
    // one-end-screen-per-run latch (see showEnd) or a resumed profile's second
    // run would end in silence.
    this._endShown = false;
    this.node = run.map.nodes[data.nodeId];
    this.player = run.player;
    const act = actOf(run.actIndex);
    // The act's boss was drawn once at map generation (run.map.bossPick) — the
    // node just cashes it in, so a scene restart can't reroll who you're facing.
    // The act INDEX goes in as well as the act: past the fourth act it is the
    // only thing that knows how deep into the ENDLESS this room stands, and the
    // whole HP wall hangs off it. 0-3 changes nothing.
    this.encounter = rollEncounter(act, this.node, Math.random, run.map?.bossPick, run.actIndex);
    // DEV: __hf.forceEncounter(['bzSkeleton','bzSkeleton']) auditions any line-up
    // in this node's arena (scale/grounding checks, minion work). One-shot.
    if (run.debugEncounter?.length) {
      const defs = run.debugEncounter.map(id => ENEMY_DEFS[id]).filter(Boolean);
      run.debugEncounter = null;
      if (defs.length) this.encounter = { ...this.encounter, defs };
    }
    // AUTOSAVE CHOKEPOINT — THE OPENING BELL. The line-up is settled and not one
    // card has been played, so this is the exact state a resume restores you to.
    // Recording the roll first is what stops a quit-and-reload from rerolling a
    // fight you were losing into a kinder one.
    checkpointFight(this.node, this.encounter.defs, run);
    autosave(run);
    this.handsThisFight = 0;
    this.roundIndex = 0;
    // Player debuffs (world mechanics). Cleared each fight.
    this.pstat = freshPstat();
    this.rootedPower = ROOTED_STRENGTH;
    this.bannedSuit = null;           // The Keeper's Eternal Keep / a SEALED SUIT
    this.hypnoActive = false;         // Wolfowl's Hypnotic Gaze
    this.hypnoCard = null;
  }

  get act() { return actOf(run.actIndex); }

  /**
   * THE ARENA'S BACKDROP TINT.
   *
   * Ordinarily the act's own `bgTint` and nothing else. In the ENDLESS the loop
   * hue is mixed into it at LOW strength — the painted art has to stay readable,
   * so this is a wash, not a filter: the same world, seen by a different light.
   * BOSS STAGE paintings deliberately never reach here (they arrive fully graded
   * and are drawn at 0xffffff), which is the rule that was already in force for
   * the act tint and is the rule for this one.
   */
  combatBgTint() {
    const loop = endlessTint(run.actIndex);
    return loop == null ? this.act.bgTint : mixTint(this.act.bgTint, loop, ENDLESS_BG_MIX);
  }

  /**
   * HAND SPEED: scales every beat of the scoring cadence (ticks, value beats,
   * artifact cascade, impact, the pause before the enemy answers). 2× is the
   * shipped pacing, 1× doubles every gap so the per-card math is readable, 3×
   * runs it at two thirds. Read live, so a mid-fight change lands next hand.
   */
  spd(ms) { return Math.round(ms * 2 / (settings.playSpeed || 2)); }

  // ---------------- The hand's one rising ladder (PATCH 0803 §3) -----------

  /**
   * A NEW HAND STARTS AT THE BOTTOM OF THE KEYBOARD. Called from eqBegin, which
   * is the one place every scoring hand passes through.
   */
  resetHandPitch() {
    this._pitchStep = 0;
    this._pitchAt = 0;
    this._pitchLog = [];   // verification hook: the ladder, as it was played
  }

  /**
   * ONE audible scoring event. The ladder climbs on EVERY call — cards, artifact
   * rewrites, retriggers, the benched hand, every repeat activation, every relic
   * in the cascade — and never resets until the next hand begins, which is the
   * whole point: three ramps that each restarted made a big hand sound like
   * "rise, restart, rise, thud". See core/cadence.js.
   *
   * The step is taken even when the sound is DROPPED for being too close to the
   * last one, so acceleration collapses the gaps without flattening the climb.
   */
  handTick(key = 'score_tick', { volume = 0.8, jitter = 0 } = {}) {
    const rate = pitchAt(this._pitchStep ?? 0);
    this._pitchStep = (this._pitchStep ?? 0) + 1;
    (this._pitchLog ??= []).push(rate);
    const now = performance.now();
    if (now - (this._pitchAt ?? 0) < PITCH_MIN_GAP_MS) return null;
    this._pitchAt = now;
    return sfx(this, key, { volume, rate, jitter });
  }

  // ---------------- The accelerator (PATCH 0803 §3 / research J2) ----------

  /**
   * A LONG CASCADE SPEEDS ITSELF UP. Everything in the scoring sequence is a
   * this.time.delayedCall or a tween, so scaling the scene's two clocks
   * compresses the whole timeline in order rather than skipping any of it — the
   * safe version of a skip button. Nothing happens at all inside the readable
   * window (cadence.ACCEL_AFTER_MS); past it the hand blurs toward ACCEL_MAX.
   */
  startScoringAccel() {
    this._accelFrom = performance.now();
    this._accelOn = true;
  }

  /** Back to full weight. The payoff and the blow after it are never rushed. */
  stopScoringAccel() {
    this._accelOn = false;
    this._accelFrom = 0;
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
  }

  /**
   * Phaser's per-frame hook. Deliberately the ONLY thing in it: the scene has
   * always run on timers and tweens, and it should stay that way.
   */
  update() {
    if (!this._accelOn) return;
    const s = scoringTimeScale(performance.now() - this._accelFrom);
    this.time.timeScale = s;
    this.tweens.timeScale = s;
  }

  // ---------------- Artifact plumbing ----------------

  prop(key) { return getProp(this.liveArtifacts(), key); }

  /** Every EFFECTIVE artifact carrying a prop — mirrors listed once per copy. */
  propHolders(key) { return this.liveArtifacts().filter(a => (a.props?.[key] ?? 0) > 0); }

  hasArtifact(id) { return run.artifacts.some(a => a.id === id); }

  /**
   * SOVEREIGN'S WRIT, the one predicate. Both entry points below funnel through
   * it, so there is exactly ONE place that decides whether the mythical is
   * standing between you and a signature — no per-boss checks scattered through
   * the dispatches, which is the whole reason the relic is auditable at all.
   *
   * `blocked` is the caller's own verdict on its name (an effect TYPE for the
   * intent loop, a def's SPECIAL id for the opening-bell passives).
   */
  writRefuse(enemy, blocked, { delay = 0 } = {}) {
    if (this.prop('sovereignWrit') <= 0) return false;
    // RANK AND FILE ARE NOT SOVEREIGN. A wolf's SEALED SUIT is the same effect
    // type an elite's RIME THORNS is, and the writ's own words are "boss and
    // elite SIGNATURE mechanics" — so the ordinary enemies keep their teeth.
    if (isRankAndFile(enemy?.def)) return false;
    if (!blocked) return false;
    // THE BANK IS PER HOLDER, like every other scaler: a mirrored writ counts
    // its own signatures struck down and its tooltip reads its own number.
    for (const a of this.propHolders('sovereignWrit')) {
      a.state.struck = (a.state.struck ?? 0) + 1;
    }
    // The same beat the immunity charms play, one size up: this is a mythical
    // earning a price, so it gets a word rather than a shrug. `delay` is for
    // the opening-bell passives, whose telegraph has to be READ before it is
    // struck down (see setupBossSpecials).
    const beat = () => {
      sfx(this, 'shield', { volume: 0.8, rate: 1.1 });
      popMessage(this, this.heroHome.x, this.heroHome.y - 60, 'THE WRIT!',
        { color: '#e8c84a', size: 32 });
    };
    if (delay > 0) this.time.delayedCall(delay, beat); else beat();
    return true;
  }

  /** SOVEREIGN'S WRIT: does this signature effect from this body reach you? */
  writBlocks(enemy, type, opts) {
    return this.writRefuse(enemy, WRIT_BLOCKED.has(type), opts);
  }

  /**
   * ...and the same question asked of a whole-fight PASSIVE, which never
   * arrives as an intent effect and so has no type to ask about.
   */
  writBlocksSpecial(enemy, opts) {
    return this.writRefuse(enemy, WRIT_BLOCKED_SPECIALS.has(enemy?.def?.special), opts);
  }

  /**
   * Aegis Core: every point of Shield the player gains is 35% stronger. Every
   * grant in the fight routes through here so nothing can quietly skip it.
   *
   * ...which is exactly why E1 SHATTERGUARD (the Frost Titan) lives here too:
   * ONE clause and every source of plate in the game — a hand's ◆, Aegis Core,
   * Aurum Heart, a potion, an event's blessing, the run's own startShield —
   * comes out at zero. No relic can route around it because there is no other
   * road.
   */
  shieldGain(amount) {
    if (this.shatterguard) return shieldAfterShatter(amount, true);
    return Math.round(amount * (1 + this.prop('shieldFactor')));
  }

  addShield(amount) {
    const gained = this.shieldGain(amount);
    // SHATTERED: it must never be silent. A grant that evaporates without a
    // word reads as a bug, so the plate visibly cracks apart instead.
    if (this.shatterguard && amount > 0) { this.shatterPlate(amount); return 0; }
    this.player.shield += gained;
    return gained;
  }

  // ---------------- Run-recap ledger (run.stats) ----------------

  /**
   * The peaks of the hand that just resolved, for the end-of-run recap.
   *
   * DAMAGE is what was ACTUALLY DEALT — post-Brittle, including Meteor/Cleave/
   * Bonded splash onto every other enemy — i.e. exactly the `dmgDealt` figure
   * resolveHand already hands the `afterHand` artifact hook, not the raw
   * res.damage the equation printed. (Twin Fates' echo and the Perpetual
   * Engine's repeat fire on their own timers and are outside that figure, same
   * as they are outside afterHand's.)
   *
   * SHIELD is what actually landed on the hero: post-Aegis Core, plus Aurum
   * Heart's plating, since both are shield the hand produced.
   */
  noteHandStats(dmgDealt, shieldGained, handName = null) {
    const st = run.stats;
    if (!st) return;
    const dealt = Math.round(dmgDealt || 0);
    // Written as an IF rather than a Math.max so the hand's NAME can ride along
    // with the number that beat the record — the lifetime shelf prints both.
    if (dealt > (st.maxHandDamage ?? 0)) {
      st.maxHandDamage = dealt;
      if (handName) st.maxHandDamageHand = handName;
    }
    st.maxHandShield = Math.max(st.maxHandShield, Math.round(shieldGained || 0));
    this.notePoisonPeak();
  }

  /** The tallest poison stack any single enemy has ever carried this run. */
  notePoisonPeak() {
    const st = run.stats;
    if (!st) return;
    for (const e of this.enemies ?? []) {
      const p = e.statuses?.poison ?? 0;
      if (p > st.maxPoisonStack) st.maxPoisonStack = p;
    }
  }

  artHook(name, ctx) {
    for (const a of this.liveArtifacts()) {
      try { a.hooks?.[name]?.(this, a, ctx); }
      catch (e) { console.error(`artifact hook ${a.id}.${name}`, e); }
    }
  }

  /**
   * THE CHAOS ORB SPINS. One roll per holder (a mirrored orb rolls its own
   * number — that IS the relic), banked as a single-use charge that the very
   * next buildScoreState consumes. The ledger on the instance is what the
   * tooltip reads back as "last roll / N rolls, averaging +X".
   */
  rollChaosOrbs() {
    const holders = this.propHolders('chaosMult');
    if (!holders.length) { this._chaosRolls = null; return null; }
    const rolls = [];
    for (const a of holders) {
      const roll = this._chaosForce ?? chaosMultRoll();
      a.state.last = roll;
      a.state.rolls = (a.state.rolls ?? 0) + 1;
      a.state.total = (a.state.total ?? 0) + roll;
      rolls.push([a, roll]);
    }
    this._chaosRolls = rolls;
    this._lastChaos = rolls.map(([a, r]) => ({ id: a.id, roll: r }));
    return this._lastChaos;
  }

  /**
   * Fold an extra mult contribution onto a relic's OWN CELL in the ordered
   * chain, so the arithmetic happens where the cascade says it happened.
   * Returns false when the relic is not in the row — then the merged bag's
   * residual carries it instead, which is still the right TOTAL (see
   * scoring.js), just resolved after the walk.
   */
  atRelic(list, art, patch) {
    const e = list.find(x => x.art === art);
    if (!e) return false;
    e.mods = { ...e.mods, ...patch(e.mods) };
    return true;
  }

  /** The common case: a scene-computed ×factor belonging to one relic. */
  mulAtRelic(list, art, f) {
    return this.atRelic(list, art, m => ({ globalMultFactor: (m.globalMultFactor ?? 1) * f }));
  }

  /** One place to assemble the scoring state, incl. every artifact mod. */
  /**
   * HOW THIS SCENE EVALUATES A HAND RIGHT NOW.
   *
   * evaluateHand and bestHandOf are pure and know nothing about the belt, so
   * every caller in the scene — the preview, the DOUBLE JEOPARDY gate, the
   * committed play, the dev hook — has to hand them the same options bag or the
   * hand you are shown and the hand you play can be two different hands. One
   * method, read four times.
   */
  handEvalOpts() {
    return {
      ofAKindMinus1: !!(this._forceOfAKindMinus1 || collectMods().ofAKindMinus1),
    };
  }

  buildScoreState(cards = null) {
    // THE ROPEMAKER'S NOOSE is applied HERE, around the two readers that cannot
    // take a list of their own (collectMods and collectModList both read the
    // live `run` by design). The swap is synchronous and restored in a finally,
    // and a hung relic keeps its CELL — see biomes.hangArtifacts for the ruling.
    const { mods, modList } = this.withHungRelics(() => ({
      mods: collectMods(), modList: collectModList(),
    }));
    // THE CHAIN: the same relics, IN ROW ORDER, for the ordered mult walk. The
    // merged bag above still owns every position-free channel; this owns the
    // one side where adds and multiplies interleave. Both are built here, from
    // the same belt, on the same tick — so the PREVIEW and the COMMITTED PLAY
    // can never disagree about the order.
    const n = cards ? cards.length : (this.selected?.length ?? 0);

    // THE CHAOS ORB's banked roll, spent exactly once by the hand that made it.
    // A preview that runs afterwards therefore sees nothing, which is correct:
    // the orb has not decided about a hand you have not played.
    this._chaosJobs = this._chaosRolls ?? [];
    this._chaosRolls = null;
    for (const [a, roll] of this._chaosJobs) {
      mods.flatMult += roll;
      this.atRelic(modList, a, m => ({ flatMult: (m.flatMult ?? 0) + roll }));
    }

    // Adrenal Vial: x1.5 while bloodied (below half HP); mirrors stack the x.
    if (this.player.hp / this.player.maxHp < 0.5) {
      for (const a of this.propHolders('lowHpFactor')) {
        mods.globalMultFactor *= 1.5;
        this.mulAtRelic(modList, a, 1.5);
      }
    }
    // Singularity: 1-card hands ×3. Summed across holders (not compounded), so
    // the whole factor rides the FIRST holder's cell rather than each of them.
    const oneCard = this.prop('oneCardFactor');
    if (oneCard && n === 1) {
      mods.globalMultFactor *= oneCard;
      this.mulAtRelic(modList, this.propHolders('oneCardFactor')[0], oneCard);
    }
    // THE SHARPEST DAGGER: a hand of ONE card gets FOUR MORE PLAYS. ADDITIVE
    // since 0803-B (§1.2), like every other replay: a mirrored Dagger is
    // 1+4+4 = 9 rather than 25, and Dagger + Pocketwatch is 1+4+1 = 6, not 10.
    if (n === 1) {
      for (const a of this.propHolders('oneCardRepeat')) addHandRepeat(mods, a.props.oneCardRepeat);
    }
    // Chronos Coil: every Nth hand ×2 (visible in the preview — plan around it).
    const every = this.prop('nthHandEvery');
    if (every && (this.handsThisFight + 1) % every === 0) {
      const f = this.prop('nthHandFactor') || 2;
      mods.globalMultFactor *= f;
      this.mulAtRelic(modList, this.propHolders('nthHandEvery')[0], f);
    }
    // WHEEL OF DIVINITY's one-shot blessings, spent by the very next hand: the
    // ×2 rides the global mult, the retrigger wedge doubles the whole hand's
    // output exactly like a Repeating Pocketwatch. Both are visible in the
    // preview, because a blessing you cannot plan around is not a decision.
    if (this.wheelNextMult) mods.globalMultFactor *= this.wheelNextMult.factor;
    if (this.wheelNextRepeat) addHandRepeat(mods, this.wheelNextRepeat.factor);
    // Legacy per-fight blessing slot (any relic parking a state.fightFactor).
    for (const a of run.artifacts) {
      if (a.state?.fightFactor && a.state.fightFactor !== 1) {
        mods.globalMultFactor *= a.state.fightFactor;
        this.mulAtRelic(modList, a, a.state.fightFactor);
      }
    }

    // Ambusher's Hourglass: the opener lands hardest. Multiplied per copy so a
    // mirrored Hourglass compounds instead of summing into nonsense.
    if (this.handsThisFight === 0) {
      for (const a of this.propHolders('firstHandFactor')) {
        mods.globalMultFactor *= a.props.firstHandFactor;
        this.mulAtRelic(modList, a, a.props.firstHandFactor);
      }
    }
    // All-In Visor: the whole hand is a bet. ×3 now, a card burns later.
    for (const a of this.propHolders('allIn')) {
      mods.globalMultFactor *= 3;
      this.mulAtRelic(modList, a, 3);
    }
    // THE DEAD MAN'S HAND. The last hand you are ENTITLED to is replayed and
    // strikes at ×N.
    //
    // WHY `handsLeft === 1`. handsLeft is handLimit - handsThisFight, and
    // handsThisFight is incremented AFTER this state is built (at the commit
    // point in playHand). So while THIS hand is being scored the clock is still
    // showing the hand it is about to spend, and `=== 1` really does read as
    // "this is the last hand you are entitled to" rather than "you have one
    // more after this". Read off the CLOCK rather than off the fan, so it is
    // the last hand you were OWED and not merely the last one you played — and
    // so the HOURGLASS, which spends no hand, can never re-arm it.
    //
    // Through addHandRepeat like every other replay in the game, which is what
    // makes it stack ADDITIVELY with the Repeating Pocketwatch (1+1+1 = three
    // plays) instead of compounding into a number nobody chose.
    if (this.prop('deadMansHand') > 0 && this.handsLeft === 1) {
      for (const a of this.propHolders('deadMansHand')) {
        addHandRepeat(mods, a.props.deadMansRepeat);
        mods.globalMultFactor *= a.props.deadMansFactor;
        this.mulAtRelic(modList, a, a.props.deadMansFactor);
      }
    }
    // ================= THE LEFTOVER BENCH (0803-B §1.1/§1.3) =================
    //
    // EVERY effect that reads the cards you did NOT play now rides ONE channel,
    // mods.benchFactor, which scoreHand applies at the very END of the mult —
    // after the ordered walk, after the hero passive, after Zeal and the Ancient
    // Shield, and (on screen) after the hand has finished repeating. They used
    // to ride globalMultFactor at their own cell in the row, which meant every
    // relic that ADDED mult to their right was never multiplied by them: the
    // ×1.25s were multiplying the small mult the hand held halfway through the
    // belt. Now the bench multiplies the finished number, which is the whole
    // reason to hold a card back.
    //
    // Note the deliberate absence of mulAtRelic: putting these on a CELL is
    // exactly what made them resolve early. They are announced instead by
    // leftoverPhase(), after the repeat beat.
    const playedIds = new Set((cards ?? this.selected?.map(c => c.card) ?? []).map(c => c.id));
    const heldBack = (this.handCards ?? []).filter(cs => !playedIds.has(cs.card.id));
    // How many times ONE held-back card's effect fires: mods.benchRepeat (the
    // LATENT REPEATER takes it to 2), +1 more if that card carries the ECHO
    // SEAL. Additive, so the pair is three triggers — the stated ceiling.
    const triggersOf = (cs) => benchTriggers(cs.card, mods);
    // Court in Session: every card held back testifies (+20% each). The count
    // is CAPTURED here because playHand strips the played cards out of
    // this.handCards long before the cascade gets to announce the relic.
    this._leftoverCount = heldBack.length;
    // ...and the same bench measured in TRIGGERS rather than in cards, which is
    // what the relic is actually paid on once echo and the Repeater are in play.
    this._leftoverUnits = heldBack.reduce((s, cs) => s + triggersOf(cs), 0);
    this._leftoverJob = null;
    const leftoverPct = this.prop('leftoverPct');
    if (leftoverPct && this._leftoverUnits > 0) {
      const f = 1 + (leftoverPct / 100) * this._leftoverUnits;
      mods.benchFactor *= f;
      this._leftoverJob = {
        art: this.propHolders('leftoverPct')[0],
        factor: Math.round(f * 100) / 100,
      };
    }
    // THE BENCH BEAT'S CAST (PATCH 0803 §3). The SPRITES, not just the count:
    // the cascade emphasises each benched card in the fan, one at a time, left
    // to right — and ONE ENTRY PER TRIGGER, so an echoed roulette card visibly
    // steps forward twice and pays its ×1.25 twice.
    this._benchBeat = [];
    const benchRelic = (benched, prop, color, tint) => {
      if (!benched.length) return;
      for (const a of this.propHolders(prop)) {
        const per = a.props[prop];
        for (const cs of benched) {
          for (let t = triggersOf(cs); t > 0; t--) {
            mods.benchFactor *= per;
            this._benchBeat.push({ cs, art: a, factor: per, color, tint });
          }
        }
      }
    };
    // RIGGED WHEEL: the same bench mechanic, but it only counts the cards that
    // GAMBLE — every ROULETTE card you held back is ×1.25.
    this._benchedRouletteCards = heldBack.filter(cs => cs.card.mod === 'roulette');
    this._benchedRoulette = this._benchedRouletteCards.length;
    benchRelic(this._benchedRouletteCards, 'riggedWheelFactor', '#2e8b57', 0x2e8b57);
    // THE VOIDCALLER'S SECOND CLAUSE (JC, 0803): the Rigged Wheel's bench, one
    // card type over. Every ETHEREAL card you held back is ×1.25, and it
    // compounds with the ×2 each ethereal you DID play already paid — the ghost
    // deck is meant to be frightening from both ends of the bench.
    this._benchedEtherealCards = heldBack.filter(cs => cs.card.mod === 'ethereal');
    this._benchedEthereal = this._benchedEtherealCards.length;
    benchRelic(this._benchedEtherealCards, 'etherealBenchFactor', '#7fe0d0', 0x7fe0d0);
    // ONE READING ORDER for the whole bench: left to right across the fan, so a
    // hand holding back both a roulette and an ethereal card still emphasises
    // them in the order the player's eye already travels. Stable, so a card's
    // repeated triggers stay shoulder to shoulder.
    this._benchBeat.sort((p, q) => (p.cs.baseX - q.cs.baseX) || (p.cs.x - q.cs.x));

    // --- per-card value grants: relics that talk to ONE card of THIS hand ---
    // They flow through mods.cardValue so scoring.js decomposes them exactly
    // like a suit bonus, and the card's number morphs in the lane on screen.
    // this._valueGrants remembers WHO paid, so the right relic swells with it.
    this._valueGrants = [];
    const grant = (a, card, add) => {
      if (!card || add <= 0) return;
      mods.cardValue[card.id] = (mods.cardValue[card.id] ?? 0) + add;
      this._valueGrants.push({ a, id: card.id, add });
    };
    if (n === 1 && cards?.length === 1) {
      // Blunt Dagger: one card, committed grip.
      for (const a of this.propHolders('oneCardValue')) grant(a, cards[0], a.props.oneCardValue);
      // Crown of the High Roller: the opening lone Ace is crowned.
      if (this.handsThisFight === 0 && cards[0].rank === 14) {
        for (const a of this.propHolders('aceCrown')) grant(a, cards[0], ACE_CROWN_VALUE);
      }
    }

    // LIQUID ICE: +N value on the very next played hand, whatever it turns out
    // to be. handValue is keyed by hand TYPE, so the bonus is stamped onto the
    // type this selection actually makes — which means the PREVIEW and the PLAY
    // read the same number, and the ice rides the mult like any other value.
    // THE UNDERSTUDY'S RULE, forced from a driver. The relic itself ships next
    // wave and will write mods.ofAKindMinus1 through collectMods like any other
    // relic; this is the same channel, set by hand, so the engine path a driver
    // exercises is the exact path the relic will take. __hfCombat.forceSixOfKind()
    if (this._forceOfAKindMinus1) mods.ofAKindMinus1 = (mods.ofAKindMinus1 ?? 0) + 1;

    if (this.potionIceValue > 0 && cards?.length) {
      const iced = bestHandOf(cards, { ofAKindMinus1: !!mods.ofAKindMinus1 }).type;
      mods.handValue[iced] = (mods.handValue[iced] ?? 0) + this.potionIceValue;
    }

    return {
      ...this.player,
      // The Zealot's Smite detonates on a shielded or charging target. Enemy
      // shield used to be a flag nothing could ever set; Sinastra's ward made
      // it real, so this finally reads the live pool instead of `false`.
      enemyShielded: (this.target?.shield ?? 0) > 0,
      enemyCharging: this.target?.charging ?? false,
      // THE HOARD, LIVE (0803-B §1.5). Drusky's chips-to-mult reads the purse at
      // PLAY TIME, so it is read here — the one place the preview and the
      // committed hand both pass through — rather than snapshotted anywhere.
      chips: run.chips ?? 0,
      mods,
      // THE CHAIN. Same list for the preview and for the committed play, so the
      // number you read before you commit is the number that lands.
      modList,
      // GO-GO GOO, and nothing else in the game: the kicker rule is suspended
      // for this one play, so every card in the hand contributes its value.
      // Cleared by playHand the moment the state is built (see the drink).
      allScore: !!this._allScore,
      // THE FADE (Act II). Ids that are FADING for this fight with NO bonus
      // mult: scoreHand joins them to the vanish roll and to nothing else,
      // which is the whole mechanic in one channel.
      fadedIds: fadedSet(this.pstat),
      flatBonus: 0,
    };
  }

  // ---------------- Scene setup ----------------

  /**
   * THE BODIES IN THIS ROOM, BEFORE THE ARENA IS BUILT.
   *
   * The bestiary left the boot set: 78 creature textures at 264 MB, of which a
   * fight puts THREE on the sand. MapScene prefetches the whole act in the
   * background the moment its board stands, so the ordinary road into a fight
   * finds everything already resident and this gate resolves synchronously —
   * but "ordinary" is doing a lot of work in a project with ~78 verification
   * drivers, and the roads that skip the map are precisely the ones that would
   * otherwise draw green rectangles:
   *
   *     scene.start('Combat', { nodeId })     a driver, straight in
   *     __hf.forceEncounter([...])            an audition line-up from any act
   *     a CONTINUE that resumes mid-fight     no map was ever built
   *
   * So the gate is on create(), where every one of them has to come through.
   * `init()` has already rolled the encounter and written the checkpoint, so
   * `this.encounter.defs` is the exact, final list of bodies — including a
   * boss's openers and anything it will raise later, which encounterBundle
   * walks for us.
   *
   * The hero's own art rides along: the painted cardfaces this deck is drawn
   * with and the skin the player is wearing. Both fall back gracefully on
   * their own (CardSprite and heroTextureFor have always guarded), so they are
   * here for the look and not for the crash.
   */
  create() {
    const need = [
      ...actBundle(run.actIndex, run),
      ...encounterBundle(this.encounter?.defs ?? [], run),
      ...heroCardfaces(run.chrId),
      ...skinBundle(equippedSkin(run.chrId)),
      // THE ORACLE'S RECEIPT wears one of her twenty painted cards under the
      // hero's face for the whole run. Nineteen of them were released the moment
      // a future was taken; this is the one that was not, and a CONTINUE that
      // resumes straight into a fight has never fetched it at all.
      oracleCardKey(run.oracle),
    ].filter(Boolean);
    gateOn(this, need, () => this.buildScene(), { label: 'The fight', ensure, missingKeys });
  }

  buildScene() {
    applyMobileCamera(this);   // no-op on desktop
    installLongPress(this);    // hold = hover on touch; no-op on desktop
    installPointerPolicy(this);   // right-click never acts, anywhere
    /**
     * THE INSPECT GESTURE, armed for the fan and for every picker this scene
     * opens over it. `resolve` is the whole policy: a CardSprite is
     * inspectable when it is in the hand (where the fight knows its frost, its
     * seal and its gaze) or when it was drawn by a picker/viewer, which tags
     * itself with `picker`. Anything else — a played card mid-cascade, a
     * decorative card on a pack wrapper — answers null and the hold does
     * nothing at all.
     */
    installCardInspect(this, (obj) => {
      if (!(obj instanceof CardSprite)) return null;
      if (this.handCards?.includes(obj)) {
        return { card: obj.card, sprite: obj, burned: isBurned(this.burnedCards, obj.card) };
      }
      if (obj.getData?.('picker')) return { card: obj.card, sprite: obj, depth: obj.depth + 4 };
      return null;
    });
    window.__hfScene = 'combat';
    /**
     * THE PACK TABLE, FETCHED WHILE THE FIGHT HAPPENS. Every road out of this
     * room ends at a painted wrapper — the reward shelf, the elite's spoils, the
     * act-clear bounty — and eight covers is 15.8 MB. MapScene prefetches them
     * on arrival, so this is the backstop for the road that skipped the map: a
     * CONTINUE that resumed straight into a fight has never fetched one.
     *
     * Fire-and-forget, and it has a whole fight to land in.
     */
    ensure(this, packCovers());
    // Scene is a singleton reused across fights — reset low-HP border state.
    this.lowHpMode = null;
    this.lowHpVignette = null;
    // THE HEARTBEAT RIDES THE LIVE SFX BUS. Registered here (not where the loop
    // starts) so there is exactly one subscription per fight, unregistered on
    // shutdown so a scene that is gone cannot be asked to re-seat a sound.
    this._sfxLoopOff?.();
    this._sfxLoopOff = registerSfxLoop(() => this.applyHeartbeatVolume());
    this.events.once('shutdown', () => { this._sfxLoopOff?.(); this._sfxLoopOff = null; });
    // ...and the two-tap box, for the same reason. choicebox wires its own
    // shutdown teardown the first time one opens; this covers the handle THIS
    // scene keeps, which nothing else knows about.
    this.events.once('shutdown', () => { closeChoiceBox(this); this._potConfirm = null; });
    this._potConfirm = null;
    this.pstatTip = null;      // hover tip from the previous fight died with the display list
    // ...and the Oracle chip and ITS tip, for exactly the same reason: both
    // died with the last fight's display list and a kept handle would let a
    // pointerout from this fight destroy an object that no longer exists.
    this.oracleChip = null;
    this.oracleTip = null;
    // ...and the PASSIVE chip stacked above her, which is the same object with
    // the same lifetime — plus the running total of whatever it floated on the
    // last fight's final hand.
    this.passiveChip = null;
    this.passiveTip = null;
    this._passivePulse = null;
    // ...and the end screen's handles. A SINGLETON scene that kept them would
    // hand a verification run a PLAY AGAIN button from a run that is over.
    this._endUI = null;
    // Autonomous-playtest hook: end the fight instantly to reach the rewards.
    window.__hfCombat = {
      winNow: () => {
        for (const e of this.enemies) if (e.alive) { e.hp = 0; this.killEnemy(e); }
        if (!this.busy) this.fightWon();
      },
      loseNow: () => { this.player.hp = 0; this.refreshAll(); this.defeat(); },
      // The three-tab deck viewer, without hunting for the DECK plate. It is
      // the ONLY surface that shows REMAINING and PLAYED / DISCARDED, so a
      // verification run that wants all three tabs has to start here.
      openDeckInfo: () => deckInfoOverlay(this, run, { remaining: this.deck, spent: this.discardPile }),
      givePotion: (id) => { run.potions.push({ ...POTION_BY_ID[id] }); this.renderPotionBelt(); },
      usePotion: (i) => this.usePotion(i),
      // Jump the ten-hand clock: __hfCombat.setHands(9) => one hand left.
      setHands: (n) => {
        this.handsThisFight = Phaser.Math.Clamp(Math.round(Number(n) || 0), 0, this.handLimit);
        this.refreshAll();
        return { played: this.handsThisFight, left: this.handsLeft, limit: this.handLimit };
      },
      handState: () => ({
        played: this.handsThisFight, left: this.handsLeft, limit: this.handLimit,
        baseline: HAND_LIMIT,
        difficulty: difficultyOf(run).name, discards: this.discardsLeft,
        handSize: this.effectiveHandSize,
      }),
      // HAND-SIZE INVARIANT: however the freeze -> play -> thaw -> refill
      // cycle is driven, the hand must never hold more cards than the
      // effective hand size allows. Frozen cards keep their slot, so a naive
      // refill is exactly where an overflow would show up. Plain scalars, so a
      // playtest can assert between beats without touching the display list.
      handInvariant: () => ({
        hand: this.handCards?.length ?? 0,
        cap: this.effectiveHandSize,
        ok: (this.handCards?.length ?? 0) <= this.effectiveHandSize,
        frozen: this.handCards?.filter(c => c.lockState === 'frozen').length ?? 0,
        selectable: this.maxSelectable,
        fear: this.pstat?.fear ?? 0,
      }),
      // Drive the freeze half of that cycle without waiting for an Ice Mage.
      freezeNow: (n = 2) => { this.freezeCards(n); return window.__hfCombat.handInvariant(); },
      // What an enemy def would ACTUALLY cast in this fight, post-scaling —
      // the cap is only observable if you can read the spawned intent.
      intentFx: (type = 'freeze') => this.enemies.map(e => ({
        id: e.def.id, elite: !!e.def.elite, boss: !!e.def.boss,
        values: e.intents.flatMap(it => it.effects.filter(x => x.type === type).map(x => x.value)),
      })),
      // The run-recap ledger and the rows it will print — plain data, so a
      // verification run can assert the tallies without reading the canvas.
      runStats: () => JSON.parse(JSON.stringify(run.stats ?? null)),
      recapRows: () => recapRows(run),
      // ...and the UNLOCKS half: what this run opened, expanded into the rows
      // the end screen prints. Empty array = the section is not drawn at all.
      unlockRows: () => unlockRows(),
      recapHeight: () => recapHeight(),
      /**
       * THE END SCREEN AS PLAIN DATA. PLAY AGAIN's y MOVES now — the panel
       * grows with the UNLOCKS section and stops growing at the canvas — so a
       * driver that clicks a hard-coded 838 will one day click the air just
       * above it. Ask for the button instead.
       */
      endScreen: () => (this._endUI?.btn ? {
        playAgain: { x: Math.round(this._endUI.btn.x), y: Math.round(this._endUI.btn.y) },
        panelH: Math.round(this._endUI.panelH),
        scrollable: this._endUI.maxScroll > 0,
        maxScroll: Math.round(this._endUI.maxScroll),
        scroll: Math.round(this._endUI.scroll ?? 0),
        cardY: Math.round(this._endUI.card?.y ?? 0),
        unlocks: unlockRows(),
      } : null),
      /** Scroll the report card (a driver's stand-in for the wheel / a drag). */
      scrollEnd: (v) => { this._endUI?.setScroll?.(v); return Math.round(this._endUI?.scroll ?? 0); },
      // --- THE 0803 SELL AUDIT ------------------------------------------
      // WHERE EVERY CARD IS, as plain ids. The whole point of the mid-fight
      // revocation is that a granted card cannot survive in ANY of these four
      // places, and that is only provable if all four can be read back.
      deckState: () => ({
        runDeck: run.runDeck.map(c => c.id),
        draw: (this.deck ?? []).map(c => c.id),
        hand: (this.handCards ?? []).map(cs => cs.card.id),
        discard: (this.discardPile ?? []).map(c => c.id),
        relics: run.artifacts.map(a => a.id),
        chips: run.chips,
        discardsLeft: this.discardsLeft,
        handSize: this.effectiveHandSize,
        startShield: run.startShield,
        slots: run.artifactSlots,
      }),
      // Sell a relic by id, straight through the real path (receipt, purge,
      // poof, re-render). Returns the chips paid, or 0 if it was not held.
      sellRelic: (id) => {
        const art = run.artifacts.find(a => a.id === id);
        return art ? this.sellArtifactInFight(art) : 0;
      },
      // Open the confirm panel the click opens, for a screenshot.
      sellPrompt: (id) => {
        const art = run.artifacts.find(a => a.id === id);
        return art ? this.sellPromptInFight(art) : false;
      },
      // Put a named card straight into the hand (the driver needs THE JOKER's
      // card sitting in the fan at the moment of sale).
      drawCardById: (id) => {
        const i = (this.deck ?? []).findIndex(c => c.id === id);
        const card = i >= 0 ? this.deck.splice(i, 1)[0] : run.runDeck.find(c => c.id === id);
        if (!card) return false;
        this.addCardToHand?.(card);
        this.layoutHand();
        return (this.handCards ?? []).some(cs => cs.card.id === id);
      },
      // THE VICTORY PURSE, as plain scalars: enemies pay nothing, the clock
      // pays everything. `paid` is the last tally's actual credited total.
      chipState: () => ({
        chips: run.chips,
        handsLeft: this.handsLeft,
        perHand: this.chipsPerHandLeft(),
        due: this.handsPurse(),
        gainFactor: chipGainFactor(),
        lastPurse: this._lastPurse ?? null,
        node: this.node.type, act: run.actIndex,
      }),
      /**
       * THE TALLY'S CLOCK. Every beat of payHandsPurse routed through spd() on
       * 2026-08-01; this reports the whole animation's length for a given
       * hands-left count at the CURRENT hand speed, so a verification run can
       * prove speed 1 = 2x speed 2 = 3x speed 3 without watching pixels.
       */
      tallyTiming: (left = this.handsLeft) => {
        const step = this.spd(Math.max(113, Math.min(188, 1250 / Math.max(left, 1))));
        const lead = this.spd(225);
        const settle = this.spd(325);
        const end = lead + left * step + settle;
        return {
          speed: settings.playSpeed ?? 2, left, lead, step, settle,
          endAt: end, totalMs: end + this.spd(325) + this.spd(775) + this.spd(400),
          lastRunMs: this._lastTallyMs ?? null,
        };
      },
      // Audition any payoff tier (color, scale, FX and its sting) without
      // grinding a god-run: __hfCombat.payoffFX(50000).
      payoffFX: (n, opts = {}) => {
        const total = Math.round(Number(n) || 0);
        totalPayoffFX(this, ARENA_CX, EQ_Y, total, { hold: 900, ...opts });
        // Return a PLAIN summary: handing a Phaser object back to Playwright
        // makes it serialize half the scene graph.
        const t = payoffTier(total);
        return { total, tier: t.name, sfx: t.sfx ?? null, size: t.size };
      },
      // --- phase 2: boss signature mechanics ---
      // One plain-object snapshot of every signature mechanic's live state.
      // Deliberately scalar-only: handing Phaser objects back to Playwright
      // serializes half the scene graph.
      bossState: () => ({
        handPenalty: this.bossHandPenalty ?? 0,
        handSize: this.effectiveHandSize,
        handCount: this.handCards?.length ?? 0,
        wintersForce: !!this.wintersForce,
        winterNeed: this.wintersForce ? this.winterNeed : null,
        selected: this.selected?.length ?? 0,
        playEnabled: !!this._playEnabled,
        quaked: this.quakeStore?.length ?? 0,
        quakeAge: this.quakeAge ?? 0,
        sliced: this.slicedCards?.length ?? 0,
        slicedIds: (this.slicedCards ?? []).map(c => c.id),
        handSuits: (this.handCards ?? []).map(c => c.card.suit),
        handIds: (this.handCards ?? []).map(c => c.card.id),
        enemies: (this.enemies ?? []).map(e => ({
          id: e.def.id, alive: e.alive, hp: e.hp, maxHp: e.maxHp,
          shield: e.shield ?? 0, immune: !!e.immune, form: e.form ?? null,
          voidPower: e.voidPower ?? 1, slot: e.slotIndex,
          poison: e.statuses?.poison ?? 0,
          texture: e.sprite.texture.key, intent: currentIntent(e).label,
          turns: e.turnCount ?? 0,
        })),
      }),
      // --- the 2026-08-02 MECHANICS WAVE ---------------------------------
      /**
       * Every new debuff and every new enemy mechanic as PLAIN SCALARS. This is
       * how tools/verify_mechanics.py proves a lock landed, a clock ticked and
       * a thief left without trying to read pixels.
       */
      mechState: () => ({
        pstat: { ...this.pstat },
        rootedPower: this.rootedPower ?? 0,
        rootedPenalty: this.rootedPenalty,
        handSize: this.effectiveHandSize,
        handCount: this.handCards?.length ?? 0,
        baseHandSize: this.player.handSize,
        bannedSuit: this.bannedSuit ?? null,
        denialActive: this.denialActive,
        denialLabel: this.denialLabel,
        sealDoom: !!this._sealDoom, sealWarned: !!this._sealWarned,
        discards: this.discardsLeft, lastSteal: this._lastSteal ?? null,
        chips: run.chips, fleeLog: [...(this._fleeLog ?? [])],
        shield: this.player.shield, hp: this.player.hp,
        vines: !!this.vineLayer?.active, spikeRing: !!this.spikeRing?.active,
        // Per-card: is it locked, and does the ENGINE agree it should be?
        hand: (this.handCards ?? []).map(c => ({
          rank: c.card.rank, suit: c.card.suit,
          lock: c.lockState ?? '', denied: this.cardDenied(c.card),
        })),
        enemies: (this.enemies ?? []).map(e => ({
          id: e.def.id, alive: e.alive, fled: !!e.fled, hp: e.hp,
          shield: e.shield ?? 0, fleeLeft: e.fleeLeft ?? 0,
          intent: e.alive ? currentIntent(e).label : null,
        })),
      }),
      /**
       * PARTS 3 & 4 — every elite/boss signature as PLAIN SCALARS.
       *
       * `Infinity` does not survive the trip to Playwright (JSON turns it into
       * null), so a whole-fight ROOTED reports as the string 'inf' rather than
       * quietly reading as "not running at all".
       */
      eliteState: () => ({
        // E1
        shatterguard: !!this.shatterguard,
        shattered: this._shatteredTotal ?? 0,
        // A live probe of the ONE funnel every point of plate passes through.
        shieldGainProbe: this.shieldGain(100),
        shield: this.player.shield, hp: this.player.hp, maxHp: this.player.maxHp,
        // E2
        feastHealed: this._feastLog ?? 0,
        // The raw attack damage swung this enemy turn — poison and bleed are
        // NOT in it, which is what makes it comparable to a telegraph.
        swung: this._swungThisTurn ?? 0,
        // E5 (and the Fairy King, which shares the arithmetic)
        handSize: this.effectiveHandSize, baseHandSize: this.player.handSize,
        handCount: this.handCards?.length ?? 0,
        rooted: this.pstat.rooted === Infinity ? 'inf' : this.pstat.rooted,
        rootedPower: this.rootedPower ?? 0, rootedPenalty: this.rootedPenalty,
        // E6
        spikes: this.pstat.spikes ?? 0,
        // B1/B3
        bannedSuit: this.bannedSuit ?? null,
        sealTurns: this.pstat.suitSealTurns ?? 0,
        courtLock: this.pstat.courtLock ?? 0,
        discards: this.discardsLeft,
        denialLabel: this.denialLabel, sealDoom: !!this._sealDoom,
        hand: (this.handCards ?? []).map(c => ({
          rank: c.card.rank, suit: c.card.suit,
          lock: c.lockState ?? '', denied: this.cardDenied(c.card),
        })),
        enemies: (this.enemies ?? []).map(e => ({
          id: e.def.id, name: e.def.name, special: e.def.special ?? null,
          elite: !!e.def.elite, boss: !!e.def.boss,
          alive: e.alive, hp: e.hp, maxHp: e.maxHp, immune: !!e.immune,
          turns: e.turnCount ?? 0, power: e.voidPower ?? 1,
          intent: e.alive ? currentIntent(e).label : null,
          // What the TELEGRAPH actually advertises for the coming turn — the
          // only honest way to prove E7's cliff is visible before it lands.
          telegraph: e.alive
            ? currentIntent(e).effects.filter(x => x.type === 'attack').map(x => x.value) : [],
          badge: e.sigText?.active ? e.sigText.text : null,
        })),
      }),
      /** The intent tooltip's full text for enemy `i` — signature line included. */
      intentTipText: (i = 0) => {
        const e = this.enemies?.[i];
        if (!e) return null;
        this.showIntentTip(e);
        const t = this.intentTip;
        const out = t ? t.list.filter(o => o.text).map(o => o.text).join('\n') : null;
        this.hideIntentTip();
        return out;
      },
      /** Apply any wave debuff by hand: mech('rooted', 1) / mech('spikes', 4). */
      mech: (type, value = 1) => {
        this.applyPlayerDebuff(type, value, this.enemies?.[0] ?? null);
        return window.__hfCombat.mechState();
      },
      /** Seal a NAMED suit for N turns — the door the boss agent uses. */
      sealSuit: (suit, turns = 1) => this.applySuitSeal(suit, turns),
      /**
       * THE BIOME WAVE as plain scalars (tools/verify_biome_engine.py). Sets do
       * not survive the trip to Playwright, so every one of them reports as an
       * array; `blind` reports as a NUMBER of turns with Infinity spelled 'inf'
       * for the same reason eliteState does it.
       */
      biomeState: () => ({
        blind: this.pstat.blind === Infinity ? 'inf' : (this.pstat.blind ?? 0),
        faded: [...(this.pstat.faded ?? [])],
        burnedCards: [...(this.burnedCards ?? [])],
        usedHandTypes: [...(this.usedHandTypes ?? [])],
        disabledRelics: [...(this.disabledRelics ?? [])],
        demandedHand: this.demandedHand ?? null,
        handTypeOnce: !!this.handTypeOnce,
        burnPlayed: !!this.burnPlayed,
        dropHandOn: !!this.dropHandOn,
        handShrink: this.handShrink ?? 0,
        cardTaxRate: this.cardTaxRate ?? 0,
        condemnBrands: (this.condemnBrands ?? []).map(b => ({ ...b })),
        markedCardId: this.markedCardId ?? null,
        mistrials: this._mistrials ?? 0,
        burnLog: this._burnLog ?? 0, condemnLog: this._condemnLog ?? 0, dropLog: this._dropLog ?? 0,
        lastHandDamage: this._lastHandDamage ?? 0,
        handSize: this.effectiveHandSize, handCount: this.handCards?.length ?? 0,
        deck: this.deck.length, discard: this.discardPile.length,
        hp: this.player.hp, shield: this.player.shield,
        // Per-card: the two render states, and whether the ENGINE agrees the
        // card is denied. A blinded card MUST report denied:false — that is the
        // whole distinction the Act I mechanic rests on.
        hand: (this.handCards ?? []).map(c => ({
          id: c.card.id, rank: c.card.rank, suit: c.card.suit,
          lock: c.lockState ?? '', denied: this.cardDenied(c.card),
          blinded: !!c.blinded, faded: !!c.faded, burned: !!c.burnedLook,
        })),
        enemies: (this.enemies ?? []).map(e => ({
          id: e.def.id, alive: e.alive, hp: e.hp,
          wall: e.wall ?? null, unusedOnly: !!e.unusedOnly,
          forgetSuit: e.forgetSuit ?? null, healMirror: !!e.healMirror,
        })),
      }),
      /** Fire one biome effect straight at the board, no intent required. */
      biomeEffect: (type, value = 1, extra = {}) => {
        const enemy = this.livingEnemies()[0] ?? null;
        const eff = { type, value, ...extra };
        if (type === 'blind' || type === 'fade') return this.applyPlayerDebuff(type, value, enemy);
        return this.runBiomeEffect(enemy, eff, { label: type });
      },
      /** Burn cards by id — the door the deadlock matrix drives. */
      burnIds: (ids) => this.burnFightCards(
        (this.handCards ?? []).filter(c => ids.includes(c.card.id)).map(c => c.card)),
      /**
       * THE FAN AND THE SELECTION as plain scalars, for tools/verify_dragselect.
       * `x`/`y` are the SLOT centres a sweep is hit-tested against, which is
       * what a driver needs to aim a real mouse at.
       */
      handState2: () => ({
        dragSelect: !!settings.dragSelect,
        sweeping: !!this._sweep,
        cap: this.maxSelectable,
        selected: (this.selected ?? []).map(c => c.card.id),
        cards: (this.handCards ?? []).map(c => ({
          id: c.card.id, suit: c.card.suit, rank: c.card.rank,
          x: Math.round(c.baseX), y: Math.round(c.baseY),
          selected: !!c.selected, lock: c.lockState ?? '',
        })),
      }),
      /** Park a thief's countdown so its escape can be photographed on cue. */
      setFlee: (i, n) => {
        const e = this.enemies?.[i];
        if (!e?.def?.flee) return null;
        e.fleeLeft = n;
        this.refreshAll();
        return e.fleeLeft;
      },
      /** Rewrite the whole hand at once — how the deadlock matrix is staged. */
      setHand: (cards) => {
        cards.forEach((spec, i) => window.__hfCombat.setCard(i, spec));
        this.resyncDenialLocks();
        this.refreshAll();
        return window.__hfCombat.mechState().hand;
      },
      // Park an enemy's intent pointer so the next enemy turn fires exactly
      // the intent a verification run wants to photograph.
      setIntent: (enemyIndex, intentIndex) => {
        const e = this.enemies[enemyIndex];
        if (!e) return null;
        e.intentIndex = intentIndex;
        this.refreshAll();
        return currentIntent(e).label;
      },
      // Hand the turn over without playing a hand (the clock is untouched).
      enemyTurnNow: () => {
        if (this.busy) return false;
        this.busy = true;
        this.enemyTurn();
        return true;
      },
      // Pick the first N selectable cards, mirroring real clicks.
      selectN: (n) => {
        for (const c of [...this.selected]) this.toggleCard(c);
        for (const c of this.handCards) {
          if (this.selected.length >= n) break;
          if (!c.playLocked && !c.selected) this.toggleCard(c);
        }
        return this.selected.length;
      },
      playNow: () => { this.playHand(); return this.handsThisFight; },
      /** Is the scene mid-cadence? A verification run must wait, not guess. */
      busy: () => !!this.busy,
      // --- card-mod wave (roulette / bloodSealed / ethereal / shiny) ---
      // Stamp a mod onto hand card `i` (and its RUN DECK entry, like a potion
      // would), so a verification run can audition any mod without farming one.
      modCard: (i, mod) => {
        const cs = this.handCards[i];
        if (!cs) return null;
        cs.card.mod = mod || undefined;
        const deckCard = run.runDeck.find(c => c.id === cs.card.id);
        if (deckCard) deckCard.mod = mod || undefined;
        this.replaceCardSprite(cs);
        return { id: cs.card.id, mod: cs.card.mod ?? null };
      },
      /**
       * THE THREE LAYERS, set independently. layerCard(0, { mod: 'roulette',
       * stamp: 'mult', wrap: 'shiny' }) builds the triple-stacked card that
       * proves the whole system: it spins, it seals, it shines. Pass null for a
       * layer to strip it; omit a layer to leave it alone.
       */
      layerCard: (i, { mod, stamp, wrap } = {}) => {
        const cs = this.handCards[i];
        if (!cs) return null;
        const set = (k, v) => { if (v !== undefined) cs.card[k] = v || undefined; };
        set('mod', mod); set('stamp', stamp); set('wrap', wrap);
        const deckCard = run.runDeck.find(c => c.id === cs.card.id);
        if (deckCard) Object.assign(deckCard, { mod: cs.card.mod, stamp: cs.card.stamp, wrap: cs.card.wrap });
        const fresh = this.replaceCardSprite(cs);
        return {
          id: cs.card.id, mod: cs.card.mod ?? null, stamp: cs.card.stamp ?? null, wrap: cs.card.wrap ?? null,
          drawn: { stamp: fresh?.stamp ?? null, wrap: fresh?.wrap ?? null, banner: fresh?.banner?.text ?? null },
        };
      },
      /** Legacy shorthand: press a BLOOD seal onto hand card `i`. */
      sealCard: (i, on = true) => window.__hfCombat.layerCard(i, { stamp: on ? 'blood' : null }),
      // Rewrite hand card `i` in place (and its RUN DECK twin), the way a
      // transmute rite or a duplication would. The only way a verification run
      // can stage the SECRET hands — five of one rank needs duplicates the
      // dealer will never hand you inside one fight.
      setCard: (i, { rank = null, suit = null, mod = undefined } = {}) => {
        const cs = this.handCards[i];
        if (!cs) return null;
        if (rank != null) cs.card.rank = rank;
        if (suit != null) cs.card.suit = suit;
        if (mod !== undefined) cs.card.mod = mod || undefined;
        const deckCard = run.runDeck.find(c => c.id === cs.card.id);
        if (deckCard) Object.assign(deckCard, {
          rank: cs.card.rank, suit: cs.card.suit, mod: cs.card.mod,
        });
        this.replaceCardSprite(cs);
        return { id: cs.card.id, rank: cs.card.rank, suit: cs.card.suit, mod: cs.card.mod ?? null };
      },
      /**
       * THE ARTIFACT MAT'S LAYOUT, as numbers (2026-08-06).
       *
       * The mat grew into the band the kit blurb vacated and every icon,
       * socket, ordinal and USE tag grew with it, which is exactly the kind of
       * change that looks right in one screenshot and collides in the next
       * (six relics, the 4-wide re-column, THE GLOVE in its pouch). So the
       * footprint is readable rather than photographable: a driver can assert
       * that no two cells touch, that every cell is on the leather, that
       * nothing has climbed onto the brass, and that the leather itself still
       * clears the status rows above it.
       */
      /**
       * THE FAN AND THE FIVE PLATES AROUND IT, as numbers (2026-08-06).
       *
       * The phone's fan is allowed to be 1180 wide and the plates either side
       * of it move and shrink to stay out of its way, which is exactly the kind
       * of layout that is obviously fine in the screenshot somebody took at
       * eight cards. So a driver can stage 5, 8 and 12 and assert the boxes do
       * not intersect, rather than looking at three pictures.
       */
      /**
       * DEAL EXACTLY N CARDS. The fan/plate collision only shows up at hand
       * sizes the game reaches through relics (the Overstuffed Satchel, the
       * Tailored Sleeve, Bottled Frenzy on top of both) or through a boss
       * shrinking it — and farming those to photograph a layout is not a test.
       * Rides `tempHandSize`, which is the real channel Frenzy uses.
       */
      stageHand: (n) => {
        this.tempHandSize = n - this.player.handSize;
        this.redrawHand();
        return this.handCards.length;
      },
      /**
       * SIX OF A KIND, WITHOUT THE RELIC (2026-08-10).
       *
       * THE UNDERSTUDY ships next wave; the engine ships now, so drivers and
       * every future wave need a way in. This sets the SAME mod channel the
       * relic will set (mods.ofAKindMinus1, through buildScoreState) and stages
       * five of one rank, then selects them — so what a driver exercises is the
       * real classification path and the real scoring path, not a shortcut.
       *
       * Pass `rank`/`suit` to choose the pile; leave `select` false to set the
       * rule up and pick the cards by hand.
       */
      forceSixOfKind: ({ rank = 13, suit = 'swords', select = true } = {}) => {
        this._forceOfAKindMinus1 = true;
        for (const c of [...this.selected]) this.toggleCard(c);
        const staged = [];
        for (let i = 0; i < 5 && i < this.handCards.length; i++) {
          const cs = this.handCards[i];
          cs.card.rank = rank;
          cs.card.suit = suit;
          const deckCard = run.runDeck.find(c => c.id === cs.card.id);
          if (deckCard) Object.assign(deckCard, { rank, suit });
          staged.push(this.replaceCardSprite(cs) ?? cs);
        }
        if (select) {
          for (const cs of this.handCards.slice(0, 5)) {
            if (!cs.selected && !cs.playLocked) this.toggleCard(cs);
          }
        }
        this.updatePreview?.();
        return {
          on: true, staged: staged.length, selected: this.selected.length,
          hand: this.selected.length
            ? bestHandOf(this.selected.map(c => c.card), this.handEvalOpts()).type : null,
        };
      },
      /** Turn THE UNDERSTUDY's rule on or off on its own (no staging). */
      setOfAKindMinus1: (on = true) => {
        this._forceOfAKindMinus1 = !!on;
        this.updatePreview?.();
        return this.handEvalOpts();
      },
      /**
       * REACH THE CEILING FROM A DRIVER. Banks a flat mult big enough that the
       * next hand clamps at INFINITY_CAP, through the ordinary scene channel a
       * potion or a blessing uses (bonusMods.handMult on every hand type), so
       * the whole equation, cascade, payoff and blow are the real ones.
       */
      forceInfinity: (on = true) => {
        // newRun rebuilds bonusMods as `{ suitValue: {} }` and the handMult bag
        // is only created when something first writes to it (packs.js uses the
        // same `??=`), so a hook reaching straight in throws on a virgin run.
        run.bonusMods.handMult ??= {};
        for (const t of Object.keys(HAND_DEFS)) {
          run.bonusMods.handMult[t] = on ? INFINITY_CAP : 0;
        }
        this.updatePreview?.();
        return { on: !!on, cap: INFINITY_CAP };
      },
      /** WHAT THE LAST BLOW ACTUALLY DID TO A BODY (see damageEnemy). */
      lastHit: () => (this._lastHit ? { ...this._lastHit } : null),
      /** The ∞ contract, as plain numbers: what was scored, what was shown. */
      infinityState: () => ({
        cap: INFINITY_CAP,
        damage: this._lastRes?.damage ?? 0,
        effMult: this._lastRes?.effMult ?? 0,
        scoreSide: this._lastRes?.scoreSide ?? 0,
        infinite: !!this._lastRes?.infinite,
        handSquared: !!this._lastRes?.handSquared,
        multBeforeSquare: this._lastRes?.multBeforeSquare ?? 0,
        handType: this._lastRes?.handType ?? null,
        eqScoreText: this.eqScore?.text ?? '',
        eqMultText: this.eqMult?.text ?? '',
        glyph: INFINITY_GLYPH,
        lastHit: this._lastHit ? { ...this._lastHit } : null,
      }),
      handAudit: () => {
        const box = o => (o ? {
          x: o.x, y: o.y, w: o.displayWidth, h: o.displayHeight,
          left: o.x - o.displayWidth / 2, right: o.x + o.displayWidth / 2,
          top: o.y - o.displayHeight / 2, bottom: o.y + o.displayHeight / 2,
          label: o.getData?.('hfLabel') ?? null,
        } : null);
        const cards = (this.handCards ?? []).map(cs => ({
          x: cs.baseX, y: cs.baseY,
          left: cs.baseX - CARD.w / 2, right: cs.baseX + CARD.w / 2,
          top: cs.baseY - CARD.h / 2, bottom: cs.baseY + CARD.h / 2,
        }));
        return {
          card: { w: CARD.w, h: CARD.h, fanY: CARD.fanY, spread: CARD.fanSpread,
            maxWidth: CARD.fanMaxWidth, arcMax: CARD.fanArcMax },
          n: cards.length, layout: this._handLayout ?? null, lanes: this._btnLanes ?? null,
          cards,
          buttons: [this.playBtn, this.handsBtn, this.deckBtn, this.discardBtn, this.sortBtn]
            .map(box).filter(Boolean),
          // THE PLATE TABLE AND THE SCALE IT ACTUALLY APPLIED (2026-08-10).
          // `up` is layoutHandButtons' own answer, not handButtonLanes' — the
          // lane helper clamps at 1 and the grow half is computed in the scene,
          // so a driver asserting "a five-card hand leaves the plates BIG" has
          // to read the number the scene used rather than the one it was
          // handed. `lanes.*.scale` is still reported beside it, unchanged.
          plate: {
            plateH: BTN_LANE.plateH, fontSize: BTN_LANE.fontSize,
            minScale: BTN_LANE.minScale, maxScale: BTN_LANE.maxScale,
            gutter: BTN_LANE.gutter, clear: BTN_LANE.clear,
            needLeft: BTN_LANE.needLeft, needRight: BTN_LANE.needRight,
            rowY: [...BTN_LANE.rowY],
          },
          up: this._btnUp ?? null,
          sidebarW: SIDEBAR_W, gameW: GAME_W, gameH: GAME_H,
        };
      },
      /**
       * WHAT THE ENEMY STACK IS MADE OF. The sizes come from ENEMY_HUD /
       * INTENT_ART / BOSS_BAR rather than from the objects, so a driver
       * asserts the TABLE the layout is built from instead of keeping its own
       * copy of last week's literals.
       */
      hudSizes: () => ({ enemy: { ...ENEMY_HUD }, intent: { ...INTENT_ART }, boss: { ...BOSS_BAR } }),
      /** Live enemy plates, for the "does it clear the head" audit. */
      enemyStacks: () => (this.enemies ?? []).filter(e => e.alive).map(e => ({
        name: e.def?.name, boss: !!e.def?.boss, bossBar: !!e.bossBar,
        nameY: e.uiName?.y, nameSize: e.uiName?.style?.fontSize,
        hpY: e.hpBack?.y, hpH: e.hpBack?.displayHeight, hpW: e.hpBack?.displayWidth,
        hpTextSize: e.hpText?.style?.fontSize,
        intentY: e.intentY,
        intentIcons: (e.intentIcons?.list ?? []).filter(o => o.type === 'Image')
          .map(o => Math.round(o.displayWidth)),
        intentNums: (e.intentIcons?.list ?? []).filter(o => o.text != null)
          .map(o => o.style?.fontSize),
        spriteTop: Math.round((e.groundY ?? 0) - (e.sprite?.displayHeight ?? 0)),
      })),
      /**
       * THE LOW-HEALTH LOOP'S LIVE LEVEL.
       *
       * `volume` is read off the Web Audio gain node, and a gain scheduled with
       * setValueAtTime does not show up there until the next render quantum —
       * so a driver that asks in the same tick it moved the slider reads the
       * PREVIOUS value and concludes, wrongly, that nothing happened. `target`
       * is what it is on its way to; sleep a beat, then assert they agree.
       */
      heartbeat: () => (this.heartbeat
        ? {
          playing: this.heartbeat.isPlaying, volume: this.heartbeat.volume,
          base: HEARTBEAT_VOLUME, target: HEARTBEAT_VOLUME * sfxBusVolume(),
        }
        : null),
      /** Force the loop up without waiting for a fight to go badly. */
      forceHeartbeat: (hpFrac = 0.15) => {
        this.player.hp = Math.max(1, Math.round(this.player.maxHp * hpFrac));
        this.updateHeartbeat();
        this.applyHeartbeatVolume();     // skip the 600ms fade for the audit
        return HEARTBEAT_VOLUME * sfxBusVolume();
      },
      /** Move the SFX slider the way the settings menu does, from a driver. */
      setSfxVolume: (v) => {
        settings.sfx = v;
        refreshSfxVolume();
        return HEARTBEAT_VOLUME * sfxBusVolume();
      },
      matAudit: () => ({
        sidebarW: SIDEBAR_W,
        mat: {
          x: 0, y: MAT.y, w: MAT.canvasW, h: MAT.canvasH,
          bodyX: MAT.pad, bodyY: MAT.bodyTop, bodyW: MAT.bodyW, bodyH: MAT.bodyH,
          bodyBottom: MAT.bottom, cx: MAT.cx, cy: MAT.cy,
        },
        plaque: { x: MAT_PLAQUE.x, y: MAT.y + MAT_PLAQUE.y, w: MAT_PLAQUE.w, h: MAT_PLAQUE.h },
        // The lowest ink ABOVE the mat: the last of the five status rows.
        statusBottom: this.handsText ? this.handsText.y + this.handsText.height / 2 : 0,
        cells: (this.artifactIcons ?? []).map((ic, i) => (ic?.active ? {
          i, x: ic.x, y: ic.y, w: ic.displayWidth, h: ic.displayHeight,
          nook: ic.x > SIDEBAR_W,
        } : null)).filter(Boolean),
        nook: { x: NOOK.x, y: NOOK.y, worn: nookArtifacts().length },
        // THE USE TAGS AS BOXES (2026-08-10). They are the smallest interactive
        // thing on the mat and the one pinned nearest a bottom corner, so the
        // sizing driver asserts BOTH their size class and their clearance.
        // `clears` is clearsCorners' verdict (nearest point still on the glass);
        // `cornerOK` is the stricter one — every one of the box's four corners
        // inside the arc — which is the question a clipped tag actually asks.
        tagTable: { ...USE_TAG },
        tags: (this.activeTags ?? []).filter(t => t.img?.active).map(t => {
          const b = {
            id: t.art.id, spent: !!t.spent, label: t.label.text,
            x: t.img.x, y: t.img.y, w: t.img.displayWidth, h: t.img.displayHeight,
            left: t.img.x - t.img.displayWidth / 2, right: t.img.x + t.img.displayWidth / 2,
            top: t.img.y - t.img.displayHeight / 2, bottom: t.img.y + t.img.displayHeight / 2,
            interactive: !!t.img.input,
          };
          b.clears = clearsCorners(b);
          b.cornerOK = cornersInsideArc(b);
          return b;
        }),
        chips: {
          passive: this.passiveChip ? { x: this.passiveChip.x, y: this.passiveChip.y, size: this.passiveChip.chipSize } : null,
          oracle: this.oracleChip ? { x: this.oracleChip.x, y: this.oracleChip.y, size: this.oracleChip.chipSize } : null,
        },
      }),
      // =====================================================================
      // THE TWO-TAP MODEL, AS PLAIN DATA (2026-08-10)
      // =====================================================================
      /**
       * Whatever description box is open, or `{ open: false }`. ui/choicebox
       * publishes it — title, body, note, its own box, every button's label,
       * enabled state and screen rect, plus `press(label)` and `close()`. A
       * driver asserts NOTHING COMMITTED ON THE FIRST TAP by reading this.
       */
      box: () => window.__hfBox ?? { open: false },
      /**
       * THE FIRST TAP on a belt (or nook) relic, performed programmatically:
       * opens that relic's box and commits nothing at all. Returns the box key,
       * or null on a desktop build, where there is no box to open — the desktop
       * fork is a straight `sellPromptInFight`, and `sellRelic(id)` is the hook
       * that drives that.
       */
      tapRelic: (id) => {
        if (!TOUCH) return null;
        const art = run.artifacts.find(a => a.id === id);
        if (!art) return null;
        const icon = this.artifactIcons?.[run.artifacts.indexOf(art)];
        const anchor = icon?.active
          ? this.relicAnchor(icon)
          : () => ({ x: MAT.cx, y: MAT.cy, w: 0, h: 0 });
        openChoiceBox(this, this.relicBoxSpec(art, anchor));
        return window.__hfBox?.key ?? null;
      },
      /** ...and the same first tap on a potion. Nothing is drunk. */
      tapPotion: (i) => {
        if (!TOUCH) return null;
        this.confirmPotionTap(i);
        return window.__hfBox?.key ?? null;
      },
      /** The safe frame the corner pass is written against. */
      safe: () => ({ ...SAFE, gutter: BTN_LANE.gutter }),
      /**
       * EVERY CORNER-PINNED THING IN THE ARENA, AS A BOX.
       *
       * The sizing driver asserts clearsCorners on all of them; `cornerOK` is
       * the stricter all-four-corners verdict beside it, and `collisions` is
       * the pairwise overlap check the cog and the potion mat exist to fail if
       * either is ever moved back into the other.
       */
      chromeAudit: () => {
        const B = (label, x, y, w, h) => {
          const b = {
            label, x, y, w, h,
            left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2,
          };
          b.clears = clearsCorners(b);
          b.cornerOK = cornersInsideArc(b);
          return b;
        };
        const hit = (a, c) => !!a && !!c
          && a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
        const mz = this.potMatZone();
        // COG.size is the NOMINAL box (the max dimension settingsMenu scales the
        // gear into). `drawn` is what the image actually measures, which is
        // smaller on the short axis and grows again while the hover tween has
        // it rotated — so the audit asserts the nominal square and reports the
        // real one beside it.
        const cog = B('COG', COG.x, COG.y, COG.size, COG.size);
        cog.drawn = this.cogBtn?.active
          ? { w: Math.round(this.cogBtn.displayWidth), h: Math.round(this.cogBtn.displayHeight) }
          : null;
        // The mat's box INCLUDES its brass label band: the label is what the
        // cog would land on first, and a check that only knew about the leather
        // would call a collision a clearance.
        const potMat = B('POTIONS', mz.x, (mz.labelTop + mz.bottom) / 2,
          mz.w, mz.bottom - mz.labelTop);
        const artMat = B('ARTIFACTS', MAT.pad + MAT.bodyW / 2, MAT.bodyTop + MAT.bodyH / 2,
          MAT.bodyW, MAT.bodyH);
        // DECOR, NOT A TARGET — and the distinction is load-bearing (2026-08-10).
        // Both mats are painted leather with interactive things standing ON
        // them; the SOCKETS, the bottles and the USE tags are swept separately
        // and every one of them clears. The artifact mat's own bottom-left
        // corner does NOT, and has not since the 0806 "extend it downward"
        // pass: at 420 wide and 292 tall, bottom-anchored in the corner of a
        // phone, its corner is ~23px outside a 150px arc. Nothing clickable is
        // within 30px of that corner. Moving it is a design call (the two
        // levers are MAT.bottom and MAT.pad, and both undo work JC asked for),
        // so the audit REPORTS it rather than quietly failing the build.
        potMat.decor = true;
        artMat.decor = true;
        const map = this.mapBtn?.active
          ? B('MAP', this.mapBtn.x, this.mapBtn.y, this.mapBtn.displayWidth, this.mapBtn.displayHeight)
          : null;
        const plate = (btn) => (btn?.active
          ? B(btn.getData('hfLabel') ?? '?', btn.x, btn.y, btn.displayWidth, btn.displayHeight)
          : null);
        const rows = BTN_LANE.rowY.map((y, i) => ({
          row: i, y, plateH: BTN_LANE.plateH,
          plates: (i === 0
            ? [this.playBtn, this.discardBtn]
            : [this.handsBtn, this.deckBtn, this.sortBtn]).map(plate).filter(Boolean),
        }));
        const all = [cog, potMat, artMat, map, ...rows.flatMap(r => r.plates)].filter(Boolean);
        // The boss marquee is not corner-pinned, but it is the third party in
        // the top-right argument and the only one whose width is derived from
        // the other two — so it is reported as the span it will occupy.
        const strip = {
          w: BOSS_BAR.stripW,
          left: ARENA_CX - BOSS_BAR.stripW / 2, right: ARENA_CX + BOSS_BAR.stripW / 2,
          arenaCx: ARENA_CX,
        };
        return {
          gameW: GAME_W, gameH: GAME_H, playW: PLAY_W, sidebarW: SIDEBAR_W,
          touch: TOUCH, safe: { ...SAFE, gutter: BTN_LANE.gutter },
          cog, potMat, artMat, map, rows, strip,
          potZone: mz,
          collisions: {
            cogVsMat: hit(cog, potMat),
            mapVsStrip: !!map && map.right > strip.left,
            matVsStrip: potMat.left < strip.right,
            rowsOverlap: rows[0].plates.some(a => rows[1].plates.some(c => hit(a, c))),
          },
          allClear: all.every(b => b.clears),
          allCornerOK: all.every(b => b.cornerOK),
        };
      },
      /** What the CURRENT selection evaluates to, straight from the evaluator. */
      previewHand: () => {
        const cards = this.selected.map(c => c.card);
        return cards.length ? evaluateHand(cards, this.handEvalOpts()) : null;
      },
      // --- ACTIVE-USE relics (the Hushed Bell, the Wheel of Divinity) ---
      /** Everything a verification run needs about the belt's clickable relics. */
      activeState: () => ({
        belt: beltArtifacts().map(a => a.id),
        nook: nookArtifacts().map(a => a.id),
        slotsUsed: slotsUsed(), slots: run.artifactSlots, owned: run.artifacts.length,
        cells: (this.artifactIcons ?? []).filter(Boolean).map(ic => ({ x: ic.x, y: ic.y })),
        tags: (this.activeTags ?? []).map(t => ({
          id: t.art.id, x: t.img.x, y: t.img.y, spent: !!t.spent, label: t.label.text,
        })),
        used: [...(this._activeUsed ?? [])].map(a => a.id),
        lastDivinity: this._lastDivinity ?? null,
        wheelMult: this.wheelNextMult?.factor ?? null,
        wheelRepeat: this.wheelNextRepeat?.factor ?? null,
        handSize: this.effectiveHandSize, handCount: this.handCards?.length ?? 0,
        silenced: (this.enemies ?? []).map(e => !!e.silenced),
        handLevels: { ...run.handLevels },
        // THE FORGE ETERNAL's ledger, not a scene latch: the relic tempers once
        // per COPY per fight now, so what a driver wants to read is how many
        // temperings the instance has banked, not a boolean that no longer exists.
        forgeTempered: (run.artifacts ?? [])
          .filter(a => a.id === 'forgeEternal')
          .reduce((s, a) => s + (a.state?.tempered ?? 0), 0),
      }),
      /** Press an active relic's USE tag by relic id (returns whether it fired). */
      useActive: (id) => {
        const art = run.artifacts.find(a => a.id === id);
        return art ? this.useActiveArtifact(art) : false;
      },
      /** Pin the Wheel of Divinity's wedge (0-4), null to unpin. */
      forceDivinity: (i) => { this._divinityForce = i ?? null; return this._divinityForce; },
      /** Pin the wheel: 'gold' | 'red' | 'black' | 'green', null to unpin. */
      forceRoulette: (r) => { this._rouletteForce = r || null; return this._rouletteForce; },
      /** Pin the ethereal vanish coin: true = always, false = never, null = fair. */
      forceEthereal: (v) => { this._etherealForce = v ?? null; return this._etherealForce; },
      /** ...and the FADE's own coin, which is a separate mechanic since 0804. */
      forceFade: (v) => { this._fadeForce = v ?? null; return this._fadeForce; },
      /**
       * Grant a relic MID-COMBAT, the way the elite shelf's ceremony does —
       * acquire, then tell the scene the belt moved. This is the exact path
       * the 2026-08-01 panel bug lived on, so the verification run drives it.
       */
      giveArtifact: (id) => {
        const def = ARTIFACT_POOL.find(a => a.id === id);
        if (!def) return null;
        acquireArtifact(run, def);
        this.onBeltChanged();
        return beltArtifacts().map(a => a.id);
      },
      /** Pin the CHAOS ORB's roll (0-15), null to let it gamble honestly. */
      forceChaos: (v) => { this._chaosForce = (v == null ? null : Math.max(0, Math.min(15, v | 0))); return this._chaosForce; },
      /** What every Chaos Orb rolled on the last hand played. */
      lastChaos: () => this._lastChaos ?? null,
      /**
       * THE SCALER LEDGER: every owned relic's banked state and the exact line
       * its tooltip prints. This is how a verification run proves a Kingmaker
       * grew across two hands, or that a re-forged copy kept its growth.
       */
      scalerState: () => run.artifacts.map(a => ({
        id: a.id, name: a.name,
        state: JSON.parse(JSON.stringify(a.state ?? {})),
        live: artifactLiveLine(a, run),
        flatMult: (typeof a.mods === 'function' ? a.mods(a, run) : a.mods)?.flatMult ?? 0,
        mirror: mirrorNote(a)?.text ?? null,
      })),
      // --- NIGHT 0802 ------------------------------------------------------
      /** Everything the twenty-one new relics need to be provable from a driver. */
      night0802: () => {
        const m = collectMods();
        return {
          handSize: this.effectiveHandSize, handSizeBonus: this.prop('handSizeBonus'),
          baseHandSize: this.player.handSize,
          slots: run.artifactSlots, slotsUsed: slotsUsed(), chips: run.chips,
          belt: run.artifacts.map(a => ({
            id: a.id, name: a.name, desc: a.desc, icon: a.icon, artKey: a.artKey ?? null,
            state: JSON.parse(JSON.stringify(a.state ?? {})),
            live: artifactLiveLine(a, run),
          })),
          flatValue: m.flatValue, flatShield: m.flatShield, flatMult: m.flatMult,
          lastFlatValue: this._lastRes?.flatValueBonus ?? 0,
          lastFlatShield: this._lastRes?.flatShieldBonus ?? 0,
          lastShield: this._lastRes?.shield ?? 0,
          lastBaseSum: this._lastRes?.baseSum ?? 0,
          pendingHatch: JSON.parse(JSON.stringify(run.pendingHatch ?? [])),
          lastHatch: this._lastHatch ?? null, hatchDone: !!this._hatchDone,
          lastSlot: this._lastSlot ?? null,
          shinyDeck: run.runDeck.filter(c => c.wrap === 'shiny').map(c => c.id),
          animals: run.stats?.killsByKind?.beast ?? 0,
          killsByKind: { ...(run.stats?.killsByKind ?? {}) },
          discards: this.discardsLeft, discardBonus: run.discardsPerFightBonus,
        };
      },
      /** Pin the Slot Button's flip: true = the machine pays, false = it takes. */
      forceSlot: (v) => { this._slotForce = (v == null ? null : !!v); return this._slotForce; },
      /** Pin the Prospector's Pan to a certainty (1) or a never (0). */
      forcePan: (v) => { this._panForce = (v == null ? null : Number(v)); return this._panForce; },
      // --- THE 2026-08-10 WAVE ---------------------------------------------
      /** Every owned relic's banked state and live line, plus the wave's own switches. */
      wave0810: () => ({
        belt: run.artifacts.map(a => ({
          id: a.id, name: a.name, artKey: a.artKey ?? null,
          state: JSON.parse(JSON.stringify(a.state ?? {})),
          live: artifactLiveLine(a, run),
        })),
        writ: this.prop('sovereignWrit'),
        coldSnap: !!this._coldSnap,
        handsLeft: this.handsLeft,
        handsThisFight: this.handsThisFight,
        lastRes: {
          handType: this._lastRes?.handType ?? null,
          handRepeat: this._lastRes?.handRepeat ?? 1,
          effMult: this._lastRes?.effMult ?? 0,
          ruleSuit: this._lastRes?.ruleSuit ?? null,
          shieldValueBonus: this._lastRes?.shieldValueBonus ?? 0,
        },
      }),
      /** Pin the GLASS GAVEL's shatter roll: 1 breaks it now, 0 never. */
      forceGavel: (p) => { this._gavelForce = (p == null ? null : Number(p)); return this._gavelForce; },
      /** Pin the BREWER'S THUMB's keep roll the same way. */
      forceBrewer: (p) => { this._brewerForce = (p == null ? null : Number(p)); return this._brewerForce; },
      /** What SOVEREIGN'S WRIT answers, and how many signatures it has struck down. */
      writState: () => ({
        blocked: [...WRIT_BLOCKED],
        specials: [...WRIT_BLOCKED_SPECIALS],
        struck: this.propHolders('sovereignWrit')
          .reduce((s, a) => s + (a.state.struck ?? 0), 0),
      }),
      /** Age a relic's own fight counter so an egg or a potato comes due now. */
      ageRelic: (id, n) => {
        const a = run.artifacts.find(x => x.id === id);
        if (!a) return null;
        a.state.fights = n;
        return { ...a.state };
      },
      /** Fire the fightEnd hooks without winning a fight (the egg's clock). */
      endFightHooks: () => { this.artHook('fightEnd', this.node); return run.pendingHatch ?? []; },
      /**
       * Pin a QUEUED hatch's table, so a driver can photograph one outcome of
       * The Egg's 75/25 instead of rolling for it. Plain data on the queue entry;
       * the ceremony reads it back through rollHatchDef exactly as it would a
       * real one.
       */
      forceHatchTable: (table) => {
        for (const e of (run.pendingHatch ?? [])) {
          e.table = { ...table };
          e.mythicChance = e.table.mythical ?? 0;
        }
        return JSON.parse(JSON.stringify(run.pendingHatch ?? []));
      },
      /** Run the queued hatches through their real ceremony. Poll `hatchDone`. */
      startHatch: () => {
        this._hatchDone = false;
        this.runPendingHatches(() => { this._hatchDone = true; });
        return (run.pendingHatch ?? []).length;
      },
      /** The merged mult-side mods this hand would score with. */
      modsNow: () => {
        const m = collectMods();
        return { flatMult: m.flatMult, suitValue: m.suitValue, suitMult: m.suitMult, faceMult: m.faceMult };
      },
      /** What the last hand's wheel actually did, plus the mod payouts. */
      modState: () => ({
        rolls: this._lastRoulette ?? null,
        benchedRoulette: this._benchedRoulette ?? 0,
        sealHeal: this._lastRes?.sealHeal ?? 0,
        etherealIds: this._lastRes?.etherealIds ?? [],
        rouletteMultBonus: this._lastRes?.rouletteMultBonus ?? 0,
        deckMods: run.runDeck.filter(c => c.mod).map(c => c.mod),
        deckStamps: run.runDeck.filter(c => c.stamp).map(c => c.stamp),
        deckWraps: run.runDeck.filter(c => c.wrap).map(c => c.wrap),
        deckSize: run.runDeck.length,
        // THE THREE LAYERS, per card in hand — the proof that they stack.
        handLayers: (this.handCards ?? []).map(c => ({
          mod: c.card.mod ?? null, stamp: c.card.stamp ?? null, wrap: c.card.wrap ?? null,
        })),
        handMods: (this.handCards ?? []).map(c => c.card.mod ?? null),
        stampMultBonus: this._lastRes?.stampMultBonus ?? 0,
        handValueBonus: this._lastRes?.handValueBonus ?? 0,
      }),
      eqState: () => ({
        score: this.eqScoreVal, mult: this.eqMultVal, multApplies: this.eqMultApplies,
        scoreIsDamage: this.eqScoreIsDamage, slamAt: this.eqSlamAt ?? 0,
        multAlpha: this.eqMult?.alpha ?? 0,
        // What the equation OPENED on, before a card ticked (2026-08-06).
        open: this._eqOpen ?? null,
      }),
      /**
       * THE PASSIVE CHIP, as plain data (2026-08-06).
       *
       * `mounted`/`chr`/`at` prove the chip exists and where; `fired` is the
       * attribution core/passives.js computed for the LAST hand, and `pulses`
       * is what the cascade actually did about it — the ledger rows that
       * carried a passive. A hand the passive sat out reports fired: null and
       * pulses: [], which is the assertion that matters most: no contribution,
       * no bow.
       */
      passiveState: () => {
        const fired = passiveAttribution(run.chrId, this._lastRes ?? null);
        return {
          mounted: !!this.passiveChip?.active,
          chr: run.chrId,
          at: this.passiveChip ? { x: this.passiveChip.x, y: this.passiveChip.y, size: this.passiveChip.chipSize } : null,
          tipOpen: !!this.passiveTip,
          fired,
          label: this._passivePulse?.labelObj?.text ?? null,
          uses: this._passivePulse?.uses ?? 0,
          pulses: (this._pulseLog ?? []).filter(r => r.passive)
            .map(r => ({ i: r.i, id: r.passive, amount: r.passiveAmount, mult: r.mult, add: r.add })),
        };
      },
      /**
       * PATCH 0803 §3 — the FEEL pass, as plain scalars. `cascadeMs` is the wall
       * clock from the PLAY HAND press to the equation slamming shut, which is
       * the number the repetition budget is actually spending.
       */
      feelState: () => ({
        handStartAt: this._handStartAt ?? 0,
        slamAt: this.eqSlamAt ?? 0,
        cascadeMs: (this.eqSlamAt ?? 0) && (this._handStartAt ?? 0)
          ? Math.round(this.eqSlamAt - this._handStartAt) : 0,
        bench: (this._benchBeat ?? []).map(x => ({ id: x.cs?.card?.id ?? null, art: x.art?.id ?? null, factor: x.factor })),
        benchedRoulette: this._benchedRoulette ?? 0,
        benchedEthereal: this._benchedEthereal ?? 0,
        benchFired: this._benchFired ?? 0,
        repeat: this._lastRes?.handRepeat ?? 1,
        repeatFired: this._repeatFired ?? 0,
        repeatCause: (this._repeatCause ?? []).map(a => a.id),
        // 0803-B §1.1: the leftover bench resolves LAST. benchAt is the first
        // bench beat, repeatAt the last repeat activation, both wall-clock, so
        // the ORDER is a number a driver can assert instead of a screenshot.
        benchAt: Math.round(this._benchAt ?? 0),
        repeatAt: Math.round(this._repeatAt ?? 0),
        benchAfterRepeat: (this._benchAt ?? 0) > 0 && (this._repeatAt ?? 0) > 0
          ? Math.round(this._benchAt - this._repeatAt) : null,
        leftoverCount: this._leftoverCount ?? 0,
        leftoverUnits: this._leftoverUnits ?? 0,      // ...bench measured in TRIGGERS
        leftoverFactor: this._leftoverJob?.factor ?? 1,
        benchFactor: this._lastRes?.benchFactor ?? 1,
        pitchStep: this._pitchStep ?? 0,
        pitchRates: (this._pitchLog ?? []).slice(),
        timeScale: this.time.timeScale,
        accelOn: !!this._accelOn,
        previewText: this.previewText?.text ?? '',
        previewSig: this._previewSig ?? '',
      }),
      // The last hand's MATH as plain scalars — how a verification run proves a
      // retrigger, a value scale or a ×mult rewrite actually landed, without
      // trying to read numbers off the canvas.
      handMath: () => {
        const r = this._lastRes;
        if (!r) return null;
        const suitDamage = (suit) => r.breakdown
          .filter(b => b.scoring && b.suit === suit).reduce((s, b) => s + b.rawDamage, 0);
        return {
          handType: r.handType, damage: r.damage, heal: r.heal, shield: r.shield,
          chipBonus: r.chipBonus,
          // CLUBS: the 25% that reaches every other enemy, whole-hand and
          // per-card, so a verification run can prove the readouts agree.
          aoeSplash: r.aoeSplash ?? 0,
          cardAoe: r.breakdown.filter(b => b.scoring && b.aoe > 0).map(b => b.aoe),
          zealConsumed: r.zealConsumed ?? 0, zealFactor: r.zealFactor ?? 1,
          zealGained: r.zealGained ?? 0, zeal: this.player.zeal,
          // 0803: the uncap, and the Bull's wall-to-mult spend, as plain numbers.
          // 0810: zealCapFor answers INFINITY_CAP now, never a literal Infinity,
          // so the old `-1 means no lid` sentinel had nothing left to encode —
          // the ceiling is a finite number that travels over the wire intact.
          // A driver asks isInfinite() / INFINITY_CAP, not a magic negative.
          zealCap: (r.zealCap ?? ZEAL_CAP),
          shieldMultRead: r.shieldMultRead ?? 0,
          shieldMultFactor: r.shieldMultFactor ?? 1,
          benchedEthereal: this._benchedEthereal ?? 0,
          poisonConversion: this.poisonConversion(),
          effMult: r.effMult, baseMult: r.baseMult, baseSum: r.baseSum, multApplies: r.multApplies,
          // THE HANDS OVERHAUL (2026-08-06): the hand's OWN base value, levels
          // included, and the level it was read at. Together with baseMult they
          // are the opening equation the banner paints — exposed so a driver can
          // assert `base × mult` against HAND_DEFS instead of reading the canvas.
          handBase: r.handBase ?? 0, handLevel: r.handLevel ?? 0,
          outScale: r.outScale, handRepeat: r.handRepeat, valueFactor: r.valueFactor,
          // --- PATCH 0803-B, the five scoring changes, as plain scalars ------
          handRepeatAdd: r.handRepeatAdd ?? 0,   // "+N replays", additive
          benchFactor: r.benchFactor ?? 1,       // the leftovers' × , resolved last
          benchRepeat: r.benchRepeat ?? 1,
          chipsRead: r.chipsRead ?? 0,           // the hoard the mult read
          chipMultAdd: r.chipMultAdd ?? 0,       // ...as flat mult (Drusky)
          // THE HERO PASSIVE'S OWN SHARE (2026-08-06): Dextra's few-card × on
          // the mult side, the Bull's Diamond × on the score side. 1 means the
          // passive did not fire, which is what the chip's silence is proving.
          passiveMultFactor: r.passiveMultFactor ?? 1,
          passiveGemFactor: r.passiveGemFactor ?? 1,
          chipMultFactor: r.chipMultFactor ?? 1, // ...or as a × (the Solid Gold Sack)
          // THE THREE LAYERS per scoring card, so a driver can prove an ECHO
          // card resolved onto the STAMP layer whichever spelling it carried.
          layers: r.breakdown.map(b => ({ id: b.id, mod: b.layerMod, stamp: b.stamp, wrap: b.wrap })),
          // --- THE REPEAT (2026-08-04) --------------------------------------
          // How many times each card actually fired, and what the wheel landed
          // on each of those times. This is the only way a driver can prove
          // that one roulette card really did go black, then red, then gold.
          repeats: r.breakdown.map(b => ({
            id: b.id, times: b.times ?? 1, activations: b.activations ?? 1,
            spins: (b.beats ?? []).map(x => x.roulette),
          })),
          etherealActivations: { ...(r.etherealActivations ?? {}) },
          baseFlat: r.baseFlat ?? 0, scoreSide: r.scoreSide ?? 0, modCount: r.modCount ?? 0,
          healScale: r.healScale, shieldScale: r.shieldScale,
          heartDamage: suitDamage('hearts'), cloverDamage: suitDamage('clovers'),
          // DIAMONDS REWORK (2026-08-01): gems bite now, so their pre-mult
          // contribution is worth reading back like every other suit's.
          gemDamage: suitDamage('gems'), swordDamage: suitDamage('swords'),
          scoreCurrency: r.scoreCurrency,
          strikes: this.handStrikes(),
          playerShield: this.player.shield, playerHp: this.player.hp,
          discardsLeft: this.discardsLeft, maxHp: this.player.maxHp,
          // THE CHAIN, as it actually resolved: one row per relic that moved
          // the mult, left to right, with the running total after each.
          multOrder: r.multOrder ?? [],
          residualAdd: r.residualAdd ?? 0, residualFactor: r.residualFactor ?? 1,
        };
      },
      // --- ARTIFACT ORDER (2026-08-02) -------------------------------------
      /** The row, left to right, plus the chain scoring would walk right now. */
      order: () => ({
        belt: beltArtifacts().map(a => a.id),
        row: run.artifacts.map(a => a.id),
        chain: collectModList().map(e => e.id),
        last: this._lastRes?.multOrder ?? [],
        // ...and the order the CASCADE actually fired them in on screen.
        pulses: this._pulseLog ?? [],
      }),
      /**
       * Move the belt relic at `from` to index `to` — the drag, without a
       * pointer. Writes back through the BELT SLOTS exactly as dragend does, so
       * a nook relic (the glove) keeps its absolute position in run.artifacts.
       */
      moveRelic: (from, to) => {
        const belt = beltArtifacts();
        const art = belt[from];
        if (!art) return null;
        const order = belt.filter(a => a !== art);
        order.splice(Math.max(0, Math.min(belt.length - 1, to)), 0, art);
        let k = 0;
        for (let i = 0; i < run.artifacts.length; i++) {
          if (!run.artifacts[i].props?.nook) run.artifacts[i] = order[k++];
        }
        this.onBeltChanged();
        return beltArtifacts().map(a => a.id);
      },
      scene: this,
    };
    this.cameras.main.fadeIn(250, 20, 16, 28);
    // THE BOSS STAGE (JC, 2026-08-04): a boss fights on its own painting.
    // MapScene prefetched it on arrival at the board; if the player outran the
    // fetch (dev teleports, a slow disk), the act backdrop stands in and the
    // stage swaps itself in the moment it lands. Stage paintings arrive fully
    // graded, so they take NO act tint — the tint was always for re-dressing a
    // borrowed forest, and it would only muddy a purpose-built room.
    this.stage = stageFor(this.act, this.node, run.map?.bossPick);
    const staged = !!(this.stage && this.textures.exists(this.stage.key));
    const bgKey = staged ? this.stage.key : this.act.bgKey;
    const bgY = staged ? this.stage.bgY : 400;
    this.bgImage = this.add.image(GAME_W / 2, bgY, bgKey)
      .setTint(staged ? 0xffffff : this.combatBgTint()).setDepth(DEPTH.bg);
    this.bgImage.setScale(GAME_W / this.bgImage.width);
    if (this.stage && !staged) {
      const stage = this.stage;
      const fight = this.node;
      // fetchStage dedupes against MapScene's prefetch (they used to race and
      // the second landing threw "Texture key already in use"); the swap
      // listens on the TEXTURE MANAGER, so it fires whichever loader wins.
      fetchStage(this, stage);
      this.textures.once(`addtexture-${stage.key}`, () => {
        // Same scene instance, same fight, image still standing — then swap.
        if (this.node !== fight || !this.bgImage?.active) return;
        this.bgImage.setTexture(stage.key).setY(stage.bgY).clearTint();
        this.bgImage.setScale(GAME_W / this.bgImage.width);
      });
    }
    this.add.rectangle(GAME_W / 2, GAME_H - 130, GAME_W, 260, 0x14101c, 0.55).setDepth(DEPTH.bg + 1);
    this.startAmbience();

    this.buildSidebar();
    this.buildHandUI();
    this.buildPotionBelt();
    this.startFight();
    // THE COG COMES IN OFF THE GLASS (JC, 2026-08-10: "the settings cog is
    // basically clipped"). Its shipped home put a 66px icon centred 44px from
    // a corner whose glass is cut by a ~55pt radius — the deepest bite on the
    // whole screen is the one it was sitting in. COG holds both builds' homes;
    // desktop's is passed as literally the same pair the default arguments
    // are, so that build cannot move.
    //
    // ui/settingsMenu.addSettingsButton takes (scene, x, y, depth) and sizes
    // itself 66/44 off MOBILE — there is no size parameter to pass, so the
    // touch cog stays 66px. See the report: growing it needs one line there.
    this.cogBtn = addSettingsButton(this, COG.x, COG.y);
    // THE MAP, FROM INSIDE THE FIGHT (JC, 2026-08-10). Top-left of the arena:
    // clear of the boss marquee (centred on ARENA_CX, 900 desktop / 960 phone /
    // 706 tablet) and clear of the potion mat in the opposite corner, on both
    // builds. On TOUCH it drops inside the safe frame's top edge — at y 40 its
    // ceiling was 15, which is 9px above SAFE.y.
    if (hasMapToPeek()) {
      this.mapHud = this.add.container(0, 0).setDepth(DEPTH.overlay - 1);
      this.mapBtn = viewMapButton(this, this.mapHud, SIDEBAR_W + 88, TOUCH ? SAFE.y + 32 : 40);
    }
    if (settings.dev) {
      const devBtn = this.add.image(SIDEBAR_W + 250, 40, 'btn_green').setDisplaySize(120, 48)
        .setDepth(DEPTH.overlay - 1).setInteractive({ useHandCursor: true });
      this.add.text(SIDEBAR_W + 250, 37, 'WIN ▶', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: '#0c3d18',
      }).setOrigin(0.5).setDepth(DEPTH.overlay - 1);
      devBtn.on('pointerdown', () => {
        for (const e of this.enemies) if (e.alive) { e.hp = 0; this.killEnemy(e); }
        if (!this.busy) this.fightWon();
      });
    }
    // Guard: reward overlays spawn picker CardSprites — only the fan reacts here.
    this.input.on('gameobjectover', (p, obj) => {
      if (obj instanceof CardSprite && this.handCards?.includes(obj)) {
        obj.hover(true); sfx(this, 'card_hover', { volume: 0.42, jitter: 0.09 });
      }
    });
    this.input.on('gameobjectout', (p, obj) => {
      if (obj instanceof CardSprite && this.handCards?.includes(obj)) obj.hover(false);
    });
    // Click selects on pointer-UP so dragging never mis-fires a selection.
    this.input.dragDistanceThreshold = 14;
    // SWEEP STATE. The scene is a SINGLETON, so a sweep abandoned by a scene
    // change (an overlay, a defeat) would otherwise still be running next fight.
    this._sweep = null;
    this._pendingDrag = null;
    this._sweptThisPress = false;
    this._sweepTickAt = 0;
    this._inspectHeld = false;
    this._reorderedThisPress = false;
    this.input.on('pointerdown', () => {
      this._sweptThisPress = false;
      this._inspectHeld = false;
      this._reorderedThisPress = false;
    });
    this.input.on('gameobjectup', (p, obj) => {
      // A sweep ends on top of a card, and Phaser reports that release like any
      // other click. Without this the last card a sweep crossed would be toggled
      // straight back off by its own gesture.
      if (this._sweptThisPress) return;
      // ...and the same is true of a HOLD: the inspect box opens under a finger
      // that is still down, and the release that follows is not a pick.
      if (this._inspectHeld) { this._inspectHeld = false; return; }
      // Belt and braces over ui/pointer.js: a right press can never get this
      // far, and if it ever did it would select a card, which is the exact bug
      // the policy exists to kill.
      if (p.button === 2) return;
      // A press that became a REORDER is not a click, whichever card it happens
      // to be released over. (Per-press, not per-card — see beginReorder.)
      if (this._reorderedThisPress) return;
      if (obj instanceof CardSprite && this.handCards?.includes(obj)) {
        this.toggleCard(obj);
      }
    });
    // Drag a card along the fan to reorder it — the others part and refill.
    this.input.on('dragstart', (p, obj) => {
      if (!(obj instanceof CardSprite) || !this.handCards?.includes(obj)) return;
      // THE FORK (PATCH 0803 §4). Phaser calls this at 14px of travel, which is
      // NOT enough evidence to name the gesture — so with the setting on the
      // card is HELD here, going nowhere, until the pointer has said something
      // worth acting on (core/dragSelect.gestureKind, and see the constants
      // there for why 20 up and 26 sideways). The hold lasts a frame or three
      // and reads as the card resisting slightly before it commits.
      if (settings.dragSelect && !this.busy && !this.potionPicking) {
        this._pendingDrag = obj;
        return;
      }
      this.beginReorder(obj);
    });
    this.input.on('drag', (p, obj, dragX, dragY) => {
      // Held, or already committed to a sweep: the card stays exactly where the
      // fan put it. sweepMove() owns the pointer for the rest of the gesture.
      if (this._sweep || this._pendingDrag) return;
      if (!(obj instanceof CardSprite) || !this.handCards?.includes(obj)) return;
      obj.x = dragX;
      obj.y = Phaser.Math.Clamp(dragY, CARD.fanY - 150, CARD.fanY + 30);
      const L = this._handLayout;
      if (!L) return;
      const from = this.handCards.indexOf(obj);
      const to = Phaser.Math.Clamp(Math.round((dragX - L.startX) / L.spread), 0, this.handCards.length - 1);
      if (to !== from) {
        this.handCards.splice(from, 1);
        this.handCards.splice(to, 0, obj);
        this.layoutHand(false, 0, null, obj);   // everyone else slides; the grabbed card stays in hand
        sfx(this, 'card_hover', { volume: 0.25, jitter: 0.1 });
      }
    });
    this.input.on('dragend', (p, obj) => {
      // Released while still HELD: the gesture never said which it was, so it
      // was a click with a shaky hand. Nothing moved, and gameobjectup selects.
      if (this._pendingDrag) { this._pendingDrag = null; return; }
      if (this._sweep) { this.endSweep(); return; }
      if (!(obj instanceof CardSprite) || !this.handCards?.includes(obj)) return;
      this.tweens.add({ targets: obj, scale: 1, duration: 90 });
      this.layoutHand();
    });
    // Belt and braces: a release outside the canvas (or one Phaser does not
    // route through dragend) must still close the gesture.
    this.input.on('pointerup', () => { this._pendingDrag = null; this.endSweep(); });
    this.input.on('pointerupoutside', () => { this._pendingDrag = null; this.endSweep(); });
    this.input.on('pointermove', p => this.handPointerMove(p));
  }

  // ---------------- Biome ambience ----------------
  /**
   * Living-world particles, themed per WORLD. Six of them now, so the three
   * hand-written if/elses this used to be are one table: `fall` is what drifts
   * down from the top of the arena, `rise` is what floats up off the ground.
   * A world may have either, both or neither.
   *
   *   forest      leaves down, green spores up
   *   snow        snow down, nothing up
   *   abyss       nothing down, souls up
   *   nightwood   MOTH-DUST down, slow FIREFLIES up      (Nocturnal Forest)
   *   motes       drifting MOTES both ways               (Ethereal Plains)
   *   ash         falling ASH down, live embers up       (Burning Gallows)
   */
  startAmbience() {
    const AMBIENCE = {
      forest: {
        shaft: 0xd8f0a0,
        fall: { tex: 'leaf', scale: [0.4, 0.7], alpha: [0.4, 0.8], dur: [6000, 9500], ease: 'Sine.easeIn' },
        rise: { tint: 0xc8f090, scale: [0.06, 0.14], alpha: 0.7, lift: [140, 220] },
      },
      snow: {
        shaft: 0xd8ecff,
        fall: { tex: 'snow', scale: [0.26, 0.5], alpha: [0.4, 0.7], dur: [8000, 13000], ease: 'Linear' },
        rise: null,
      },
      abyss: {
        shaft: 0x50d878,
        fall: null,
        rise: { tint: 0x50e888, scale: [0.08, 0.2], alpha: 0.85, lift: [140, 320] },
      },
      nightwood: {
        // Cold moonlight through the canopy, not sunlight.
        shaft: 0x9ab8e8,
        // JC's painted night leaves. No tint: they arrived the right colour,
        // where the interim was the day forest's leaf dimmed to a powder.
        fall: { tex: 'nightleaf', scale: [0.3, 0.52], alpha: [0.4, 0.7], dur: [9000, 14000], ease: 'Sine.easeIn' },
        // Fireflies: slow, sparse and the sick yellow-green of the whole biome.
        rise: { tint: 0xd8f088, scale: [0.07, 0.16], alpha: 0.8, lift: [180, 300], every: 1500 },
      },
      motes: {
        // A white sky. The shafts nearly vanish, which is the point.
        shaft: 0xeef2ff,
        fall: { tex: 'mote', scale: [0.26, 0.48], alpha: [0.4, 0.7], dur: [14000, 20000], ease: 'Linear' },
        rise: { tint: 0xdfe4f0, scale: [0.06, 0.16], alpha: 0.75, lift: [160, 280] },
      },
      ash: {
        shaft: 0xff9a50,
        fall: { tex: 'gallowsash', scale: [0.3, 0.62], alpha: [0.45, 0.78], dur: [7000, 12000], ease: 'Linear' },
        rise: { tint: 0xff7a30, scale: [0.07, 0.18], alpha: 0.9, lift: [200, 380], every: 900 },
      },
    };
    const look = AMBIENCE[this.act.ambience] ?? AMBIENCE.abyss;

    this.shafts = [];
    for (let i = 0; i < 3; i++) {
      const shaft = this.add.image(1050 + i * 260, 260, 'fx_glow')
        .setDepth(DEPTH.bg + 2).setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.05).setScale(1.2, 7).setAngle(24);
      this.shafts.push(shaft);
      this.tweens.add({
        targets: shaft, alpha: 0.11, duration: 2600 + i * 700,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: i * 900,
      });
    }
    for (const s of this.shafts) s.setTint(look.shaft ?? 0xffffff);

    if (look.fall) {
      const f = look.fall;
      this.time.addEvent({
        delay: f.every ?? 800, loop: true,
        callback: () => {
          if (this.children.list.filter(o => o.getData?.('drift')).length > 12) return;
          const startX = Phaser.Math.Between(SIDEBAR_W + 60, GAME_W - 40);
          const d = this.add.image(startX, -20,
            // Variant count per family, not a hard-coded 3: JC's biome
            // particles arrived in twos and ones.
            `particle_${f.tex}_${Phaser.Math.Between(1, PARTICLE_VARIANTS[f.tex] ?? 3)}`)
            .setDepth(Math.random() < 0.5 ? DEPTH.bg + 3 : DEPTH.arena + 2)
            .setScale(Phaser.Math.FloatBetween(f.scale[0], f.scale[1]))
            .setAlpha(Phaser.Math.FloatBetween(f.alpha[0], f.alpha[1]))
            .setAngle(Phaser.Math.Between(0, 360));
          if (f.tint) d.setTint(f.tint);
          d.setData('drift', true);
          const dur = Phaser.Math.Between(f.dur[0], f.dur[1]);
          this.tweens.add({
            targets: d, y: Phaser.Math.Between(640, 880), angle: d.angle + Phaser.Math.Between(120, 380),
            duration: dur, ease: f.ease,
            onComplete: () => this.tweens.add({ targets: d, alpha: 0, duration: 800, onComplete: () => d.destroy() }),
          });
          this.tweens.add({
            targets: d, x: startX + Phaser.Math.Between(-140, -30),
            duration: dur / 4, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
          });
        },
      });
    }

    if (look.rise) {
      const r = look.rise;
      this.time.addEvent({
        delay: r.every ?? 1100, loop: true,
        callback: () => {
          const mote = this.add.image(
            Phaser.Math.Between(SIDEBAR_W + 80, GAME_W - 80), Phaser.Math.Between(560, 780), 'fx_dust')
            .setDepth(DEPTH.arena + 1).setBlendMode(Phaser.BlendModes.ADD)
            .setTint(r.tint).setAlpha(0)
            .setScale(Phaser.Math.FloatBetween(r.scale[0], r.scale[1]));
          this.tweens.add({
            targets: mote, alpha: { from: r.alpha, to: 0 },
            y: mote.y - Phaser.Math.Between(r.lift[0], r.lift[1]),
            x: mote.x + Phaser.Math.Between(-40, 40),
            duration: Phaser.Math.Between(3200, 5500), ease: 'Sine.easeOut',
            onComplete: () => mote.destroy(),
          });
        },
      });
    }
  }

  // ---------------- Sidebar ----------------

  /**
   * Runtime-generated HUD dressing (no loader assets): a paper-grain tile for
   * the sidebar parchment and the artifact mat. Both are drawn once and reused
   * — the Combat scene is a singleton restarted every fight.
   */
  ensureHudTextures() {
    // --- paper grain: sparse flecks + fibres, tiled over the parchment ---
    if (!this.textures.exists('hud_paper')) {
      const S = 200;
      const p = this.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 0; i < 520; i++) {                 // flecks, two parchment tones
        const light = i % 3 === 0;
        p.fillStyle(light ? 0xf6e8c8 : 0xcbb083, light ? 0.16 : 0.14);
        const w = Math.random() < 0.7 ? 1 : 2;
        p.fillRect(Math.floor(Math.random() * S), Math.floor(Math.random() * S), w, w);
      }
      for (let i = 0; i < 24; i++) {                  // long fibres, kept off the
        const len = 24 + Math.random() * 70;          // tile seams so the repeat hides
        p.fillStyle(i % 2 ? 0xcbb083 : 0xf6e8c8, 0.09);
        p.fillRect(8 + Math.random() * (S - len - 16), Math.floor(Math.random() * S), len, 1);
      }
      for (let c = 0; c < 18; c++) {                  // pulp specks, clustered
        const cx = 8 + Math.random() * (S - 16), cy = 8 + Math.random() * (S - 16);
        p.fillStyle(0xbfa273, 0.13);
        for (let k = 0; k < 5; k++) p.fillRect(cx + (Math.random() - 0.5) * 10, cy + (Math.random() - 0.5) * 10, 1, 1);
      }
      p.generateTexture('hud_paper', S, S);
      p.destroy();
    }

    // --- artifact mat: recessed leather panel, stitched, riveted, with the
    //     ARTIFACTS plaque straddling its top edge. Cut at the exact size this
    //     build will draw it (see MAT), so neither sidebar scales the leather
    //     and the stitching stays square on both. ---
    if (!this.textures.exists('hud_mat')) {
      const m = this.make.graphics({ x: 0, y: 0 }, false);
      const MX = MAT.pad, MY = MAT.lip, MW = MAT.bodyW, MH = MAT.bodyH, R = 16;
      const cx = MX + MW / 2, cy = MY + MH / 2;

      m.fillStyle(0xf6e8c8, 0.45);                    // bounce rim: punched into paper
      m.fillRoundedRect(MX - 1, MY + 1, MW + 3, MH + 3, R + 1);
      m.fillStyle(0x3f2b18, 1);                       // leather edge
      m.fillRoundedRect(MX, MY, MW, MH, R);
      m.fillStyle(0x5a4028, 1);                       // felt face
      m.fillRoundedRect(MX + 2, MY + 2, MW - 4, MH - 4, R - 2);
      for (let k = 10; k >= 1; k--) {                 // soft centre lift, so empty isn't flat
        m.fillStyle(0x6b4a2c, 0.028);
        m.fillEllipse(cx, cy, (MW - 44) * k / 10, (MH - 34) * k / 10);
      }
      for (let k = 0; k < 9; k++) {                   // inner shadow — reads recessed
        m.lineStyle(2, 0x241505, 0.20 - k * 0.021);
        m.strokeRoundedRect(MX + 2 + k, MY + 2 + k, MW - 4 - k * 2, MH - 4 - k * 2, Math.max(2, R - 2 - k));
      }
      for (let k = 0; k < 7; k++) {                   // weight on the top lip, bounce at the base
        m.fillStyle(0x241505, 0.05 - k * 0.006);
        m.fillRect(MX + 12, MY + 3 + k, MW - 24, 1);
        m.fillStyle(0xc8a878, 0.03 - k * 0.004);
        m.fillRect(MX + 12, MY + MH - 4 - k, MW - 24, 1);
      }

      const SI = 11, DASH = 6, STEP = 12;             // stitching, just inside the edge
      const x0 = MX + SI, x1 = MX + MW - SI, y0 = MY + SI, y1 = MY + MH - SI;
      const stitches = (color, alpha, ox, oy) => {
        m.fillStyle(color, alpha);
        for (let x = x0 + 14; x < x1 - 14; x += STEP) {
          const w = Math.min(DASH, x1 - 14 - x);
          m.fillRect(x + ox, y0 + oy, w, 2); m.fillRect(x + ox, y1 + oy, w, 2);
        }
        for (let y = y0 + 14; y < y1 - 14; y += STEP) {
          const h = Math.min(DASH, y1 - 14 - y);
          m.fillRect(x0 + ox, y + oy, 2, h); m.fillRect(x1 + ox, y + oy, 2, h);
        }
      };
      stitches(0x241505, 0.30, 1, 1);
      stitches(0xd8c49a, 0.5, 0, 0);

      for (const [rx, ry] of [[MX + 16, MY + 16], [MX + MW - 16, MY + 16],
        [MX + 16, MY + MH - 16], [MX + MW - 16, MY + MH - 16]]) {
        m.fillStyle(0x241505, 0.35); m.fillCircle(rx + 1, ry + 2, 5);
        m.fillStyle(0x4a3018, 1); m.fillCircle(rx, ry, 5);
        m.lineStyle(2, 0x2a1808, 1); m.strokeCircle(rx, ry, 5);
        m.fillStyle(0x9a7440, 0.7); m.fillCircle(rx - 1.6, ry - 1.6, 1.6);
      }

      // The plaque on the top edge. It was cut for the word ARTIFACTS alone and
      // the label outgrew it the night the row started stating its own rule, so
      // the brass now spans PW and the label is clamped to fit it (below) —
      // whatever the label ends up saying, it sits ON the plaque.
      const PW = MAT_PLAQUE.w, PX = MAT_PLAQUE.x, PY = MAT_PLAQUE.y, PH = MAT_PLAQUE.h;
      m.fillStyle(0x241505, 0.32);
      m.fillRoundedRect(PX - 1, PY + 2, PW + 2, PH + 1, 9);
      m.fillStyle(0x4a3018, 1);
      m.fillRoundedRect(PX, PY, PW, PH, 9);
      m.fillStyle(0x5f4324, 1);
      m.fillRoundedRect(PX + 2, PY + 2, PW - 4, 10, { tl: 7, tr: 7, bl: 0, br: 0 });
      m.lineStyle(1, 0x2a1808, 0.8);
      m.strokeRoundedRect(PX, PY, PW, PH, 9);

      m.generateTexture('hud_mat', MAT.canvasW, MAT.canvasH);
      m.destroy();
    }

    // --- the GLOVE NOOK: a little stitched side-pocket in the mat's own
    //     leather, bumped onto its right edge. Same edge/felt/stitch/rivet
    //     language as the mat, shrunk and given a buckled flap so it reads as a
    //     POUCH rather than a seventh cell. Canvas 120x144; the pouch body is
    //     100x116 at (10, 20). ---
    if (!this.textures.exists('hud_nook')) {
      const p = this.make.graphics({ x: 0, y: 0 }, false);
      const NX = 10, NY = 20, NW = 100, NH = 116, R = 13;
      p.fillStyle(0x241505, 0.34);                    // cast shadow, down-right
      p.fillRoundedRect(NX + 5, NY + 8, NW, NH, R);
      p.fillStyle(0x3f2b18, 1);                       // leather edge
      p.fillRoundedRect(NX, NY, NW, NH, R);
      p.fillStyle(0x5a4028, 1);                       // felt face
      p.fillRoundedRect(NX + 3, NY + 3, NW - 6, NH - 6, R - 2);
      for (let k = 8; k >= 1; k--) {                  // centre lift
        p.fillStyle(0x6b4a2c, 0.03);
        p.fillEllipse(NX + NW / 2, NY + NH / 2 + 8, (NW - 26) * k / 8, (NH - 30) * k / 8);
      }
      for (let k = 0; k < 7; k++) {                   // inner shadow: recessed
        p.lineStyle(2, 0x241505, 0.19 - k * 0.024);
        p.strokeRoundedRect(NX + 3 + k, NY + 3 + k, NW - 6 - k * 2, NH - 6 - k * 2, Math.max(2, R - 2 - k));
      }
      // The FLAP: a tongue of leather folded over the pouch's mouth, with a
      // stud in the middle of it. This is the whole reason it reads as a pocket.
      p.fillStyle(0x241505, 0.3);
      p.fillRoundedRect(NX + 4, NY - 8, NW - 8, 34, { tl: 10, tr: 10, bl: 8, br: 8 });
      p.fillStyle(0x4a3018, 1);
      p.fillRoundedRect(NX + 4, NY - 11, NW - 8, 34, { tl: 10, tr: 10, bl: 8, br: 8 });
      p.fillStyle(0x5f4324, 1);
      p.fillRoundedRect(NX + 6, NY - 9, NW - 12, 13, { tl: 8, tr: 8, bl: 0, br: 0 });
      p.lineStyle(1, 0x2a1808, 0.85);
      p.strokeRoundedRect(NX + 4, NY - 11, NW - 8, 34, { tl: 10, tr: 10, bl: 8, br: 8 });
      const sx = NX + NW / 2, sy = NY + 12;           // the buckle stud
      p.fillStyle(0x241505, 0.4); p.fillCircle(sx + 1, sy + 2, 6);
      p.fillStyle(0x9a7440, 1); p.fillCircle(sx, sy, 5.5);
      p.lineStyle(2, 0x2a1808, 1); p.strokeCircle(sx, sy, 5.5);
      p.fillStyle(0xd8c49a, 0.75); p.fillCircle(sx - 1.7, sy - 1.7, 1.7);

      const SI = 9, DASH = 5, STEP = 11;              // stitching, mat language
      const x0 = NX + SI, x1 = NX + NW - SI, y0 = NY + SI + 18, y1 = NY + NH - SI;
      const stitches = (color, alpha, ox, oy) => {
        p.fillStyle(color, alpha);
        for (let x = x0 + 8; x < x1 - 8; x += STEP) {
          p.fillRect(x + ox, y1 + oy, Math.min(DASH, x1 - 8 - x), 2);
        }
        for (let y = y0; y < y1 - 8; y += STEP) {
          const h = Math.min(DASH, y1 - 8 - y);
          p.fillRect(x0 + ox, y + oy, 2, h); p.fillRect(x1 + ox, y + oy, 2, h);
        }
      };
      stitches(0x241505, 0.3, 1, 1);
      stitches(0xd8c49a, 0.5, 0, 0);
      for (const [rx, ry] of [[NX + 13, NY + NH - 13], [NX + NW - 13, NY + NH - 13]]) {
        p.fillStyle(0x241505, 0.35); p.fillCircle(rx + 1, ry + 2, 4);
        p.fillStyle(0x4a3018, 1); p.fillCircle(rx, ry, 4);
        p.lineStyle(2, 0x2a1808, 1); p.strokeCircle(rx, ry, 4);
      }
      p.generateTexture('hud_nook', 120, 144);
      p.destroy();
    }

    // --- ACTIVE-USE tags: the little tab that hangs off a clickable relic.
    //     Two states, one geometry (76x28): brass while charged, cold iron once
    //     it has been spent this fight. ---
    for (const [key, face, lip, edge] of [
      ['hud_tag_use', 0xd8a020, 0xf0cc60, 0x3d2a08],
      ['hud_tag_spent', 0x4a4038, 0x6a5c50, 0x241d16],
    ]) {
      if (this.textures.exists(key)) continue;
      const t = this.make.graphics({ x: 0, y: 0 }, false);
      t.fillStyle(0x140c06, 0.42); t.fillRoundedRect(3, 5, 70, 22, 9);
      t.fillStyle(edge, 1); t.fillRoundedRect(1, 1, 70, 22, 9);
      t.fillStyle(face, 1); t.fillRoundedRect(3, 3, 66, 18, 7);
      t.fillStyle(lip, 0.85); t.fillRoundedRect(5, 4, 62, 6, { tl: 5, tr: 5, bl: 0, br: 0 });
      t.lineStyle(2, edge, 0.9); t.strokeRoundedRect(3, 3, 66, 18, 7);
      t.generateTexture(key, 76, 28);
      t.destroy();
    }
  }

  buildSidebar() {
    this.ensureHudTextures();
    const g = this.add.container(0, 0).setDepth(DEPTH.panel);
    const { panel } = woodPanel(this, SIDEBAR_W / 2 - 4, GAME_H / 2, SIDEBAR_W + 20, GAME_H + 20, { shadow: false });
    g.add(panel);

    // Aged-scroll dressing: grain, edge darkening and roll shading, all laid in
    // right after the panel so every HUD element below sits on top of it.
    const grain = this.add.tileSprite(5, 10, 322, 1060, 'hud_paper').setOrigin(0, 0);
    grain.tilePositionX = Math.random() * 200;
    grain.tilePositionY = Math.random() * 200;
    g.add(grain);
    // Large-scale mottling, stamped (not tiled) so the 200px repeat never reads.
    for (let i = 0; i < 8; i++) {
      g.add(this.add.image(Phaser.Math.Between(40, SIDEBAR_W - 40), Phaser.Math.Between(40, GAME_H - 40), 'fx_glow')
        .setTint(0xc4a878).setAlpha(Phaser.Math.FloatBetween(0.05, 0.09))
        .setDisplaySize(Phaser.Math.Between(150, 300), Phaser.Math.Between(110, 240)));
    }
    for (const ex of [16, SIDEBAR_W - 20]) {          // long edges age darker
      g.add(this.add.image(ex, GAME_H / 2, 'fx_glow').setTint(0x9a7440)
        .setAlpha(0.16).setDisplaySize(58, GAME_H));
    }
    for (const by of [26, GAME_H - 26]) {             // scroll-roll shading
      g.add(this.add.image(SIDEBAR_W / 2, by, 'fx_glow').setTint(0x9a7440)
        .setAlpha(0.13).setDisplaySize(SIDEBAR_W + 40, 130));
    }

    const suitColor = SUIT_COLORS[this.chr.suit];
    // The hero's own card art frames their portrait in the HUD.
    const heroCardShadow = this.add.image(SIDEBAR_W / 2 + 7, 190, 'cardbg_' + this.chr.id)
      .setDisplaySize(198, 297).setTint(0x120a06).setAlpha(0.45);
    g.add(heroCardShadow);
    const heroCard = this.add.image(SIDEBAR_W / 2, 180, 'cardbg_' + this.chr.id).setDisplaySize(198, 297);
    g.add(heroCard);
    g.add(this.add.image(SIDEBAR_W / 2, 296, 'fx_glow').setTint(0x1a1006).setAlpha(0.45).setScale(1.1, 0.3));
    this.heroFX = this.add.image(SIDEBAR_W / 2, 182, 'fx_glow')
      .setAlpha(0).setScale(1.5).setBlendMode(Phaser.BlendModes.ADD);
    g.add(this.heroFX);
    // THE SKIN, if this hero is wearing one (core/skins.js). It is a texture
    // swap and nothing else: every skin was normalised to this hero's own figure
    // height and ground line, so 0.3 draws it at exactly the size the shipped
    // model draws at and the card behind it does not move.
    const modelKey = heroTextureFor(this.chr.id, k => this.textures.exists(k));
    const heroShadow = this.add.image(SIDEBAR_W / 2 + 6, 190, modelKey).setScale(0.3).setTint(0x120a06).setAlpha(0.4);
    g.add(heroShadow);
    this.heroSprite = this.add.image(SIDEBAR_W / 2, 182, modelKey).setScale(0.3);
    this.heroHome = { x: SIDEBAR_W / 2, y: 182 };
    g.add(this.heroSprite);
    g.add(this.add.text(SIDEBAR_W / 2, 344, this.chr.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: PARCH.text,
    }).setOrigin(0.5));
    g.add(this.add.text(SIDEBAR_W / 2, 382, this.chr.title, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: PARCH.textDim,
    }).setOrigin(0.5));

    // HP bar (wood-framed)
    this.hpBarBack = this.add.rectangle(30, 422, SIDEBAR_W - 60, 32, 0x241505).setOrigin(0, 0.5).setStrokeStyle(3, 0x38220f);
    this.hpBarFill = this.add.rectangle(33, 422, SIDEBAR_W - 66, 24, COLORS.hp).setOrigin(0, 0.5);
    this.hpText = this.add.text(SIDEBAR_W / 2, 422, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: '#ffffff', stroke: '#0a2018', strokeThickness: 4,
    }).setOrigin(0.5);
    g.add(this.hpBarBack); g.add(this.hpBarFill); g.add(this.hpText);

    const shIcon = this.add.image(48, 468, 'icon_shield').setTint(0x1a6a8c);
    shIcon.setScale(34 / Math.max(shIcon.width, shIcon.height));
    this.shieldText = this.add.text(70, 468, '0', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: '#155e7d',
    }).setOrigin(0, 0.5);
    this.resourceText = this.add.text(SIDEBAR_W - 30, 468, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: PARCH.accent,
    }).setOrigin(1, 0.5);
    g.add(shIcon); g.add(this.shieldText); g.add(this.resourceText);
    // WHAT SHIELD ACTUALLY DOES (JC, 2026-08-10). The number on its own never
    // said whether it decays, whether it caps, or what walks straight past it —
    // and two of the three answers are surprising. The hit box covers the glyph
    // AND the number, because the number is the thing a player points at.
    const shHit = this.add.rectangle(38, 468, 110, 44, 0x000000, 0)
      .setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    shHit.on('pointerover', () => this.showRuleTip(SIDEBAR_W - 20, 452, 'SHIELD', this.shieldRuleText()));
    shHit.on('pointerout', () => this.hideIntentTip());
    g.add(shHit);

    this.pstatUI = this.add.container(0, 0).setDepth(DEPTH.panel + 1);
    g.add(this.pstatUI);

    // Five status rows now (the hand clock joined them), so they sit 44 apart
    // instead of 50 — the kit blurb below still clears the artifact mat.
    let y = 528;
    this.hudIcons = {};
    const line = (key, icon, tint) => {
      const i = this.add.image(50, y, icon).setTint(tint);
      i.setScale(34 / Math.max(i.width, i.height));
      const t = this.add.text(80, y, '', { fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.text })
        .setOrigin(0, 0.5);
      g.add(i); g.add(t);
      this.hudIcons[key] = i;
      y += 44;
      return t;
    };
    this.discardText = line('trash', 'icon_trash', 0x9a4030);
    this.deckText = line('deck', 'icon_star', 0x9a7418);
    this.stageText = line('stage', 'icon_sword_small', 0x50617e);
    this.chipsText = line('chips', 'icon_coins', 0xffffff);
    // icon_hourglass is painted full-colour art — it must stay tinted WHITE.
    this.handsText = line('hands', 'icon_hourglass', 0xffffff);
    this.startHudLife(g);

    // ARTIFACTS: a stitched leather mat sunk into the parchment, big
    // free-floating icons in 2 rows of 3 — Balatro-style, they pulse as they
    // act during scoring. The mat art (incl. its plaque) is one generated
    // texture, cut and drawn 1:1 at this build's own footprint (see MAT), which
    // is bottom-anchored and grew upward into the band the kit blurb used to
    // occupy.
    const matImg = this.add.image(0, MAT.y, 'hud_mat').setOrigin(0, 0);
    g.add(matImg);
    // The plaque states THE RULE, because the rule is invisible otherwise:
    // cards score, then the row resolves left to right, and the row is a
    // decision you make by dragging. (Full sentence in every relic's tooltip.)
    // Stroked like its two siblings on the same brass ('THE GLOVE', 'POTIONS'),
    // which already carried it. Pale cream on brass without one is the bug.
    const plaqueY = MAT.y + MAT_PLAQUE.y + MAT_PLAQUE.h / 2;
    const plaqueLabel = legible(this.add.text(SIDEBAR_W / 2, plaqueY, 'ARTIFACTS  ▸  LEFT TO RIGHT', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.matPlaque}px`, color: '#e8d3a4',
    }), { shadow: false }).setOrigin(0.5);
    // Whatever the label says, it stays ON the brass: it used to spill off both
    // ends of a plaque cut for one word and read as a mis-set caption.
    if (plaqueLabel.width > MAT_PLAQUE.w - 18) {
      plaqueLabel.setScale((MAT_PLAQUE.w - 18) / plaqueLabel.width);
    }
    g.add(plaqueLabel);
    this.artifactPanelG = this.add.container(0, 0).setDepth(DEPTH.panel + 2);
    this._artifactSig = null;
    this.renderArtifactPanel();

    // (The kit blurb used to live HERE, between the last status row and the
    // mat's brass — a paragraph of prose that was read once and then spent the
    // rest of the run holding 80px of sidebar hostage while saying nothing
    // about the hand being scored. It is the passive chip's job now, and the
    // room is the mat's.)

    // Live hand math. It used to sit BELOW the fan's ceiling and get buried by
    // the very cards it was describing, so anchor it off the measured ceiling
    // of a lifted card (fan baseline − half a card at select scale − the lift −
    // the halo bleed) with a readable margin above that.
    this.previewCeilY = CARD.fanY - (CARD.h / 2) * 1.06 - CARD.selectLift - 13;
    this.previewText = this.add.text(ARENA_CX, this.previewCeilY - 36, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.preview}px`, color: '#ffd897',
      stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(DEPTH.fx).setAlpha(0);
    this._previewWant = '';
    this._previewSig = '';

    // Weathering: soft age-shadow down the panel edges + corner tacks.
    for (const ex of [8, SIDEBAR_W - 12]) {
      g.add(this.add.image(ex, GAME_H / 2, 'fx_glow').setTint(0x2a1808)
        .setAlpha(0.22).setDisplaySize(28, GAME_H * 1.05));
    }
    // Only the top pair now — the artifact mat's own rivets pin the bottom.
    for (const [tx, ty] of [[26, 26], [SIDEBAR_W - 30, 26]]) {
      g.add(this.add.circle(tx, ty, 5, 0x4a3018).setStrokeStyle(2, 0x2a1808));
    }

    // ------------------------------------------------------------------
    // THE CHIP COLUMN: the passive, then THE ORACLE'S RECEIPT beneath it
    // (JC, 2026-08-05: "put it under us" — and 2026-08-06, the passive above).
    //
    // WHERE, AND WHY IT IS THE ONLY WHERE. Everything below the portrait is
    // content-variable across the FULL width of the panel: the debuff row
    // spreads to fill it (pstatEntries derives its gap from SIDEBAR_W and
    // reaches x SIDEBAR_W-28 at fifteen entries), the five status rows squeeze
    // to fit it (stageText, refreshAll), and the artifact mat is wall to wall.
    // The only gap that survives all of that is 11px (HP bar to shield).
    // Nothing 46px fits in it.
    //
    // So the chips go in the portrait's own lane, off the hero card's right
    // edge. That box is bounded by FIXED geometry only: the card ends at
    // SIDEBAR_W/2 + 99, the hero's name starts at y 324, and the thorn ring
    // (radius 118 about SIDEBAR_W/2, 182) has closed back inside x
    // SIDEBAR_W/2 + 103 by y 240 — so a 46px chip centred on +130 clears the
    // painting at BOTH stops. Hand size, debuff count and relic count cannot
    // reach the lane, and the same expressions clear the same way on both
    // sidebar widths.
    //
    // The passive is the UPPER of the two on purpose: it is the one fact about
    // the run that was true before the run began, and the one that will swell
    // and shout during a cascade — so it sits nearer the hero it belongs to,
    // and its floating label has clear parchment above it to fly into.
    this.passiveChip = addPassiveChip(this, SIDEBAR_W / 2 + 130, 240, run.chrId,
      // Its bow's label is clamped to the parchment, exactly as the mat's own
      // pulse labels are: '1 CARD ×4' centred on a chip 40px from the sidebar's
      // edge would otherwise hang half of itself over the arena.
      { size: 46, depth: DEPTH.panel + 3, labelBounds: [96, SIDEBAR_W - 74] });
    this.oracleChip = addOracleChip(this, SIDEBAR_W / 2 + 130, 296, run.oracle,
      { size: 46, depth: DEPTH.panel + 3 });
  }

  /** Timed micro-animations so the HUD breathes: wiggles, glints, gleams. */
  startHudLife(g) {
    // Constant: the hero breathes.
    this.tweens.add({
      targets: this.heroSprite, scaleY: 0.306, scaleX: 0.297,
      duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    // The HP gleam bar sweeps on demand.
    const gleam = this.add.rectangle(36, 422, 26, 22, 0xffffff, 0.3).setOrigin(0, 0.5).setVisible(false);
    g.add(gleam);
    this.time.addEvent({
      delay: 3400, loop: true,
      callback: () => {
        const roll = Math.floor(Math.random() * 5);
        if (roll === 0 && this.hudIcons.trash) {
          this.tweens.add({ targets: this.hudIcons.trash, angle: { from: -12, to: 12 }, duration: 90, yoyo: true, repeat: 2, onComplete: () => this.hudIcons.trash.setAngle(0) });
        } else if (roll === 1 && this.hudIcons.chips) {
          this.tweens.add({ targets: this.hudIcons.chips, scale: this.hudIcons.chips.scale * 1.25, duration: 140, yoyo: true });
          const s = this.add.image(50, this.hudIcons.chips.y - 8, 'fx_star').setTint(0xffe9a0)
            .setScale(0.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.panel + 2);
          this.tweens.add({ targets: s, alpha: 0, scale: 0.24, angle: 90, duration: 520, onComplete: () => s.destroy() });
        } else if (roll === 2) {
          gleam.setVisible(true).setX(36).setAlpha(0.28);
          this.tweens.add({
            targets: gleam, x: 36 + this.hpBarFill.width, alpha: 0, duration: 620, ease: 'Sine.easeIn',
            onComplete: () => gleam.setVisible(false),
          });
        } else if (roll === 3) {
          // A tiny hop-and-settle from the hero: still alive in there.
          this.tweens.add({ targets: this.heroSprite, y: this.heroHome.y - 8, angle: Phaser.Math.Between(-3, 3), duration: 150, yoyo: true, ease: 'Sine.easeOut', onComplete: () => this.heroSprite.setAngle(0) });
        } else if (this.hudIcons.deck) {
          this.tweens.add({ targets: this.hudIcons.deck, angle: 360, duration: 500, ease: 'Cubic.easeOut', onComplete: () => this.hudIcons.deck.setAngle(0) });
        }
      },
    });
  }

  /**
   * THE BELT MOVED — a relic was taken, swapped out or sold while this scene is
   * still on screen (the elite shelf resolving mid-combat is the one that used
   * to slip through). rewards.beltChanged() calls this from every acquisition
   * path, and the signature guard is CLEARED first so the mat is guaranteed to
   * repaint even if the id list happens to hash the same.
   */
  onBeltChanged() {
    this._artifactSig = null;
    this.renderArtifactPanel();
    this.syncActiveTags();
  }

  /** The 2x3 artifact home: big icons, cast shadows, hover-grow, DRAG to reorder. */
  renderArtifactPanel() {
    const belt = beltArtifacts();
    const nook = nookArtifacts();
    this._artifactDragging = false;   // scenes are singletons: never inherit a drag
    // The hung set joins the signature: THE ROPEMAKER changes what the mat has
    // to show without changing a single relic id, and a memoised panel would
    // never redraw to say so.
    const sig = run.artifacts.map(a => a.id).join('|') + '#' + run.artifactSlots
      + '#' + [...(this.disabledRelics ?? [])].join(',');
    if (sig === this._artifactSig) return;
    this._artifactSig = sig;
    this.resetArtifactPulses(true);
    this.artifactPanelG.removeAll(true);
    this.artifactIcons = [];
    this.activeTags = [];

    // THE ROW GROWS. Six slots is the ceiling for relics that COST a slot, but
    // the weightless ones (The Phantom Cast) ride in the row for free and can
    // push it past six — so the grid re-columns instead of clipping: 3 wide
    // while it fits, 4 wide (and a size down) the moment it doesn't. The mat's
    // inner field is 318px, which is exactly what the 4x78 layout fills.
    const capacity = Math.max(run.artifactSlots, belt.length);
    // MOBILE (v2): same grid, same home in the sidebar — just a size class up,
    // paid for by the sidebar's extra 80px (JC: "the artifact pad a bit
    // larger including the artifacts themselves").
    // 2026-08-06: the mat grew into the kit blurb's band (see MAT) and the
    // relics grew with it — a full size class on the 340 sidebar, a smaller
    // step on the 420 one, which had less to gain because its mat was already
    // the taller of the two. The row pair is centred on the leather's own
    // middle rather than on a constant, so any future change to MAT.bodyH
    // carries the grid, the ordinals, the chain grooves, the USE tags, the
    // empty sockets and the drag code's row boundary with it in one edit.
    const cols = capacity > 6 ? 4 : 3;
    const spread = MOBILE ? (cols === 4 ? 96 : 126) : (cols === 4 ? 78 : 102);
    const iconSize = MOBILE ? (cols === 4 ? 84 : 108) : (cols === 4 ? 72 : 92);
    const socketR = MOBILE ? (cols === 4 ? 28 : 34) : (cols === 4 ? 23 : 28);
    // The phone's leather grew 24px taller (see MAT), and the row pair opens up
    // with it rather than leaving the extra room as a stripe of empty hide.
    const rowGap = MOBILE ? 64 : 62;
    const cellOf = i => ({
      x: MAT.cx + ((i % cols) - (cols - 1) / 2) * spread,
      y: MAT.cy + (i < cols ? -rowGap : rowGap),
    });
    const shown = Math.min(capacity, cols * 2);

    // ------------------------------------------------------------------------
    // THE CHAIN, ENGRAVED (2026-08-02). The row RESOLVES left to right, and a
    // plaque saying so is a rule you were told — a trap for anyone who doesn't
    // read it. So the mat SHOWS the sequence instead: a groove tooled into the
    // leather runs between the sockets with a chevron riding it, and every
    // socket wears its ordinal at ten o'clock. The row stops being a shelf.
    //
    // Deliberate properties:
    //  · it is drawn from the GRID, never from the relics, so it is identical
    //    empty, half-full, at six, at the 4-wide re-column, and mid-drag — the
    //    numbers stay put while the relics slide between them, which is exactly
    //    what a player dragging into "slot 3" needs to see.
    //  · it goes in FIRST, so it lies under the sockets and under the art: the
    //    thread passes behind the relics rather than over them.
    //  · no wrap stroke is drawn from the end of row one to the start of row
    //    two. Prose doesn't draw its carriage return either; the ordinals carry
    //    the wrap, and a return sweep through that band would collide with the
    //    USE tags and read as chrome.
    //  · pure Graphics + Text, zero interactivity, so it cannot steal a hover
    //    or interfere with the drag.
    // ------------------------------------------------------------------------
    let drawOrdinals = null;
    if (shown > 1) {
      const INK = 0x241505, LIT = 0xd8c49a;         // the mat's own stitch palette
      const gr = this.add.graphics();
      const groove = (x0, x1, y) => {               // an incised line: dark cut, lit lip
        gr.lineStyle(2, INK, 0.26); gr.lineBetween(x0, y, x1, y);
        gr.lineStyle(1, LIT, 0.13); gr.lineBetween(x0, y + 2, x1, y + 2);
      };
      const chevron = (cx, cy, s) => {              // a tooled ▸ riding the groove
        const arm = (color, alpha, w, oy) => {
          gr.lineStyle(w, color, alpha);
          gr.beginPath();
          gr.moveTo(cx - s * 0.7, cy - s + oy);
          gr.lineTo(cx + s * 0.7, cy + oy);
          gr.lineTo(cx - s * 0.7, cy + s + oy);
          gr.strokePath();
        };
        arm(INK, 0.34, 2.5, 0);
        arm(LIT, 0.16, 1.5, 2);
      };
      const cSize = cols === 4 ? 4 : 5;
      for (let i = 0; i + 1 < shown; i++) {
        if ((i + 1) % cols === 0) continue;         // row end: the wrap is unmarked
        const a = cellOf(i), b = cellOf(i + 1);
        const x0 = a.x + socketR + 5, x1 = b.x - socketR - 5;
        if (x1 - x0 < 10) continue;
        groove(x0, x1, a.y);
        chevron((x0 + x1) / 2, a.y, cSize);
      }
      this.artifactPanelG.add(gr);

      // The ordinals, deferred to the END of this render (see the call below the
      // relic loop). Ten o'clock, just past the corner of the icon box, which is
      // the least-painted spot a cell has — but "least" is not "never": the
      // first pass drew them UNDER the art and the Forge Hammer swallowed its 3
      // whole while the sword beside it kept its 1, which read as a bug. So they
      // go on top, at an alpha low enough that over leather they are still an
      // engraving and over a relic they are a watermark, never a label.
      drawOrdinals = () => {
        const ordDX = socketR + (cols === 4 ? 8 : 10), ordDY = socketR + (cols === 4 ? 4 : 2);
        const ordSize = cols === 4 ? '11px' : '12px';
        for (let i = 0; i < shown; i++) {
          const { x, y } = cellOf(i);
          const num = String(i + 1);
          const cut = this.add.text(x - ordDX + 1, y - ordDY + 1, num, {
            fontFamily: 'Lilita One', resolution: 2, fontSize: ordSize, color: '#160c03',
          }).setOrigin(0.5).setAlpha(0.42);
          const lip = this.add.text(x - ordDX, y - ordDY, num, {
            fontFamily: 'Lilita One', resolution: 2, fontSize: ordSize, color: '#e2caa0',
          }).setOrigin(0.5).setAlpha(0.44);
          this.artifactPanelG.add(cut); this.artifactPanelG.add(lip);
        }
      };
    }

    for (let i = 0; i < shown; i++) {
      if (!belt[i]) {
        // faint marker: an empty socket punched in the mat, awaiting a relic
        const { x, y } = cellOf(i);
        this.artifactPanelG.add(this.add.circle(x, y + 2, socketR, 0x000000, 0).setStrokeStyle(2, 0xa5824c, 0.20));
        this.artifactPanelG.add(this.add.circle(x, y, socketR, 0x000000, 0).setStrokeStyle(3, 0x33220f, 0.45));
        this.artifactPanelG.add(this.add.circle(x, y, 5, 0xc4ab7e, 0.5));
      }
    }

    // ------------------------------------------------------------------------
    // DRAG TO REORDER (rebuilt 2026-08-02 — JC: "feels unnatural... should slide
    // in between and move over").
    //
    // Relic order is SCORING-RELEVANT now (cards score, then relics resolve LEFT
    // TO RIGHT), so this stopped being cosmetic and has to be precise:
    //
    //  · the dragged relic LIFTS out of the row — bigger, deeper shadow, on the
    //    overlay layer — and follows the pointer. It is being carried, not
    //    shuffled along inside the row.
    //  · the others CLOSE RANKS around the hole it left, so the visible GAP is
    //    literally the slot it will land in.
    //  · neighbours SLIDE: 140ms Quad.easeOut. The old tween was 150ms
    //    Back.easeOut, and that overshoot bounce is most of what read as
    //    unnatural — these are heavy objects sliding on a leather mat, not
    //    springs snapping into holes.
    //  · the insertion index comes from SLOT MIDPOINTS with HYSTERESIS. Nearest-
    //    centre alone made a pointer parked on a boundary flicker between two
    //    orders, which is a lie about a real decision.
    //  · on drop the relic TWEENS into its slot. It used to teleport there,
    //    because dragend rebuilt the whole mat on the spot — the one moment in
    //    the interaction with no animation at all.
    // ------------------------------------------------------------------------
    const SLIDE = 140, SLIDE_EASE = 'Quad.easeOut';
    const REST_SH = { dx: 4, dy: 7, alpha: 0.4 };     // shadow at rest
    const LIFT_SH = { dx: 10, dy: 13, alpha: 0.5 };   // shadow while carried
    // The carried relic rides ABOVE the pointer, so the slot it is aimed at
    // stays visible underneath it. Without this the relic sits exactly in its
    // own gap and the whole point of opening one is lost.
    const LIFT_Y = 26;
    const entries = [];
    const place = (animated = true) => {
      entries.forEach((e, idx) => {
        if (e.dragging) return;
        const { x, y } = cellOf(idx);
        this.tweens.killTweensOf([e.icon, e.shadow]);
        if (animated) {
          this.tweens.add({ targets: e.icon, x, y, duration: SLIDE, ease: SLIDE_EASE });
          this.tweens.add({ targets: e.shadow, x: x + REST_SH.dx, y: y + REST_SH.dy, duration: SLIDE, ease: SLIDE_EASE });
        } else {
          e.icon.setPosition(x, y);
          e.shadow.setPosition(x + REST_SH.dx, y + REST_SH.dy);
        }
      });
    };

    /**
     * Which slot the carried relic wants, from slot MIDPOINTS with hysteresis.
     *
     * The row is a 2-row grid, so the pointer is first turned into a continuous
     * slot coordinate (`t`): whole numbers are slot centres, and t = k + 0.5 is
     * exactly the boundary between slot k and k+1. Committing needs the pointer
     * HYST past that boundary, and the same margin must be re-crossed to come
     * back — so a hand shaking on the line holds its position instead of
     * strobing. ROW_HYST is the identical idea for the top/bottom row split.
     */
    const HYST = 0.18;        // fractions of a slot
    const ROW_HYST = 18;      // px
    const rowMidY = MAT.cy;
    const slotIndexAt = (px, py, cur, n) => {
      let row = cols > 0 ? Math.floor(cur / cols) : 0;
      if (n > cols) {
        if (py > rowMidY + ROW_HYST) row = 1;
        else if (py < rowMidY - ROW_HYST) row = 0;
      } else row = 0;
      const col = Phaser.Math.Clamp((px - SIDEBAR_W / 2) / spread + (cols - 1) / 2, -0.49, cols - 0.51);
      const t = row * cols + col;
      if (t > cur + 0.5 + HYST || t < cur - 0.5 - HYST) {
        return Phaser.Math.Clamp(Math.round(t), 0, n - 1);
      }
      return cur;
    };

    belt.forEach((art, i) => {
      const { x, y } = cellOf(i);
      const shadow = addArtifactIcon(this, x + 4, y + 7, art, iconSize).setTint(0x120a06).setAlpha(0.4);
      const icon = addArtifactIcon(this, x, y, art, iconSize);
      this.artifactPanelG.add(shadow);
      this.artifactPanelG.add(icon);
      this.artifactIcons[i] = icon;
      // A mirror aimed at a relic it cannot copy wears the ⊘ so the player can
      // see the dead slot without hovering it.
      if (mirrorBlockedBy(art)) {
        this.artifactPanelG.add(noMirrorBadge(this, x + 26, y - 24, 11).setDepth(DEPTH.panel + 3));
      }
      // ACTIVE-USE relics hang a tab off their lower lip: brass and breathing
      // while charged, cold iron and ✓ once spent. It is the button. The offset
      // is read off the ICON's own size so the tab keeps hanging off the lip
      // rather than climbing onto the painting as the row's size class changes.
      if (art.active) this.buildActiveTag(art, icon, x, y + iconSize / 2 + USE_TAG.lip);
      const entry = { art, icon, shadow, dragging: false };
      entries.push(entry);

      icon.setInteractive({ useHandCursor: true, draggable: true });
      icon.setData('baseScale', icon.scale);
      icon.on('pointerover', () => {
        // A carried relic sweeps over its neighbours, and every one of them
        // would pop its own tooltip and hover-grow underneath the drag. While
        // something is in the air the row holds still and says nothing.
        if (this._artifactDragging) return;
        this.showArtifactTip(icon.x, Math.min(icon.y, GAME_H - 170), art);
        this.tweens.add({ targets: icon, scale: icon.getData('baseScale') * 1.15, duration: 110 });
      });
      icon.on('pointerout', () => {
        if (this._artifactDragging) return;
        this.hideIntentTip();
        this.tweens.add({ targets: icon, scale: icon.getData('baseScale'), duration: 110 });
      });
      // A CLICK (not a drag) opens the relic's OPTIONS, exactly as the map belt
      // does. getDistance() is the gap between pointer-down and pointer-up, so
      // a reorder that happens to end on its own cell can never be read as a
      // click, and the confirm panel means no misclick costs a Legendary.
      //
      // ...AND ONLY A CLICK THAT STARTED HERE (2026-08-04). The USE tag hangs
      // over this icon's lower lip and fires on pointerDOWN — after which
      // syncActiveTag marks it spent and disables it, so the SAME gesture's
      // pointerup used to fall through to this icon and read as a fresh click:
      // press SPIN on the Slot Button, and the sell panel opened over the spin.
      // The same started-here rule the skins dimmer already follows.
      //
      // TOUCH TAKES THE OTHER FORK (2026-08-10): the first tap opens the
      // relic's box — name, rarity, full rules, chain position, and the USE /
      // SELL buttons — and commits nothing. DRAG-REORDER IS UNAFFECTED:
      // `this.input.dragDistanceThreshold` is 14, which IS `SLOP` in
      // ui/touch.js, and tapBind refuses any gesture that drifted that far, so
      // the two gestures are separated by the same one number.
      if (TOUCH) {
        // `dragged` is the PRESS's latch, not the frame's: a reorder that
        // wandered out past the 14px threshold and came back to within it
        // would otherwise pass tapBind's slop test on the way up and open a
        // box the player never asked for. Same idea as `_reorderedThisPress`
        // in the fan, and for the same reason.
        icon.on('pointerdown', () => { entry.dragged = false; });
        twoTap(this, icon, {
          ...this.relicBoxSpec(art, this.relicAnchor(icon)),
          // Belt and braces on top of the slop test: a relic that is in the
          // air, or whose neighbour is, is being REORDERED, not read.
          guard: () => !entry.dragged && !entry.dragging && !this._artifactDragging,
        });
      } else {
        icon.on('pointerdown', () => { entry.pressed = true; });
        icon.on('pointerup', (pointer) => {
          const started = entry.pressed;
          entry.pressed = false;
          if (!started) return;
          if (entry.dragging || this._artifactDragging) return;
          if (pointer.getDistance?.() > 8) return;
          if (this._touchHoldFired) return;   // a HOLD reads; only a tap opens
          this.sellPromptInFight(art);
        });
      }
      icon.on('dragstart', () => {
        entry.pressed = false;
        entry.dragged = true;
        entry.dragging = true;
        this._artifactDragging = true;
        this.hideIntentTip();
        // Out of the row and into the hand: overlay depth, a size up, and a
        // shadow that falls further back so it reads as lifted off the mat.
        icon.setDepth(DEPTH.overlay);
        shadow.setDepth(DEPTH.overlay - 1);
        this.tweens.killTweensOf([icon, shadow]);
        this.tweens.add({ targets: icon, scale: icon.getData('baseScale') * 1.16, duration: 110, ease: SLIDE_EASE });
        this.tweens.add({ targets: shadow, alpha: LIFT_SH.alpha, duration: 110, ease: SLIDE_EASE });
        sfx(this, 'card_select', { volume: 0.3 });
      });
      icon.on('drag', (pointer, dragX, dragY) => {
        this.hideIntentTip();
        icon.setPosition(dragX, dragY - LIFT_Y);
        // The shadow stays down on the mat: the gap between the two IS the lift.
        shadow.setPosition(dragX + LIFT_SH.dx, dragY + LIFT_SH.dy);
        // The INDEX reads the pointer, not the lifted art — you aim with the
        // cursor, and the relic is just what you happen to be holding.
        const cur = entries.indexOf(entry);
        const to = slotIndexAt(dragX, dragY, cur, entries.length);
        if (to !== cur) {
          entries.splice(cur, 1);
          entries.splice(to, 0, entry);
          place();   // the rest close ranks; the gap left behind IS the target
          sfx(this, 'card_hover', { volume: 0.42, jitter: 0.08 });
        }
      });
      icon.on('dragend', () => {
        entry.dragging = false;
        this._artifactDragging = false;
        icon.setDepth(DEPTH.panel + 2);
        shadow.setDepth(DEPTH.panel + 2);
        const to = entries.indexOf(entry);
        if (entries.some((e, k) => e.art !== belt[k])) {
          // The belt is a VIEW of run.artifacts: nook relics (the glove) are
          // filtered out of it, so the new order is written back THROUGH the
          // belt slots rather than spliced by belt index, which would land on
          // the wrong absolute position the moment a nook relic sat in front.
          const order = entries.map(e => e.art);
          const beforeOrder = [...run.artifacts];
          let k = 0;
          for (let i = 0; i < run.artifacts.length; i++) {
            if (!run.artifacts[i].props?.nook) run.artifacts[i] = order[k++];
          }
          // THE ROPEMAKER's noose follows its relic through the reorder rather
          // than staying on the cell the relic just left.
          this.remapHungRelics(beforeOrder);
          sfx(this, 'card_deal', { volume: 0.56 });
          // FENG SHUI counts rearrangements that actually CHANGED something, so
          // it lives inside this branch. Picking a relic up and putting it back
          // down where it was is not a decision.
          run.counters.reorders = (run.counters.reorders ?? 0) + 1;
          fireAchievements(this, 'state', { run });
        }
        // SETTLE, do not snap. The mat only rebuilds once the relic has slid
        // home, and it rebuilds at exactly the position the tween finished on,
        // so the handover is invisible.
        const home = cellOf(to);
        this.tweens.killTweensOf([icon, shadow]);
        this.tweens.add({
          targets: icon, x: home.x, y: home.y,
          scale: icon.getData('baseScale'), duration: SLIDE, ease: SLIDE_EASE,
        });
        this.tweens.add({
          targets: shadow, x: home.x + REST_SH.dx, y: home.y + REST_SH.dy,
          alpha: REST_SH.alpha, duration: SLIDE, ease: SLIDE_EASE,
          onComplete: () => {
            if (!this.artifactPanelG?.scene) return;   // scene left mid-settle
            this._artifactSig = null;
            this.renderArtifactPanel();
          },
        });
      });
    });

    // The cell ordinals sit above the relic art (see the chain block), so they
    // are the last thing the mat lays down.
    drawOrdinals?.();

    // ---- THE GLOVE NOOK ----------------------------------------------------
    // A stitched side-pocket bumped onto the mat's right edge, hanging just off
    // the sidebar. Only drawn when something lives in it. It is NOT a seventh
    // cell: no empty socket, no drag, no reorder — the glove is worn, not slotted.
    nook.forEach((art, k) => {
      const x = NOOK.x, y = NOOK.y + k * 128;
      this.artifactPanelG.add(this.add.image(x, y, 'hud_nook'));
      this.artifactPanelG.add(this.add.text(x, y - 78, 'THE GLOVE', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.nookLabel}px`, color: '#e8d3a4',
        stroke: '#241505', strokeThickness: 4,
      }).setOrigin(0.5));
      const shadow = addArtifactIcon(this, x + 3, y + 12, art, 62).setTint(0x120a06).setAlpha(0.4);
      const icon = addArtifactIcon(this, x, y + 6, art, 62);
      this.artifactPanelG.add(shadow);
      this.artifactPanelG.add(icon);
      this.artifactIcons[run.artifacts.indexOf(art)] = icon;
      icon.setData('baseScale', icon.scale);
      icon.setInteractive({ useHandCursor: true });
      icon.on('pointerover', () => {
        this.showArtifactTip(x, Math.min(y - 40, GAME_H - 170), art);
        this.tweens.add({ targets: icon, scale: icon.getData('baseScale') * 1.15, duration: 110 });
      });
      icon.on('pointerout', () => {
        this.hideIntentTip();
        this.tweens.add({ targets: icon, scale: icon.getData('baseScale'), duration: 110 });
      });
      // The glove is worn, not slotted, so it never drags — but it sells like
      // anything else, and the same click opens the same confirm. Same
      // started-here guard as the row: a USE tag's gesture must not fall
      // through to this icon when the tag disables itself mid-click.
      //
      // ...AND THE SAME BOX ON TOUCH. This branch also fixes a latent bug the
      // belt did not have: the nook's pointerup was never gated on
      // `_touchHoldFired`, so a long-press that read the glove's tooltip ALSO
      // opened the sell confirm on top of what it had just been asked to show.
      // tapBind refuses a hold outright, so the whole class goes away here.
      if (TOUCH) {
        twoTap(this, icon, this.relicBoxSpec(art, this.relicAnchor(icon)));
      } else {
        let nookPressed = false;
        icon.on('pointerdown', () => { nookPressed = true; });
        icon.on('pointerup', (pointer) => {
          const started = nookPressed;
          nookPressed = false;
          if (!started || pointer.getDistance?.() > 8) return;
          this.sellPromptInFight(art);
        });
      }
      if (art.active) this.buildActiveTag(art, icon, x, y + USE_TAG.nookY);
    });

    // ...and the noose goes back on. The mat was just rebuilt from scratch, so
    // anything the Ropemaker is holding has to be re-dressed here or a sold
    // relic elsewhere in the row would quietly untie it.
    this.syncHungRelics();
  }

  // =========================================================================
  // SELLING A RELIC MID-FIGHT (JC, 0803: "relics can be sold mid-fight...
  // make sure it also resolves whatever bonus or effect it was providing")
  // -------------------------------------------------------------------------
  // Same door as the merchant's (run.sellArtifact, the ONE place a relic leaves
  // through), same 25% basis, same onSell revocation. What is different is
  // WHERE the deck lives: out on the map it is one list, but inside a fight it
  // is FOUR places at once — run.runDeck, this.deck (the draw pile),
  // this.handCards (live sprites the player is looking at) and this.discardPile.
  // An onSell that only splices run.runDeck would leave THE JOKER's card sitting
  // in your hand, playable, after the relic that printed it was sold.
  //
  // So the revoke is done by DIFF rather than by asking each relic to grow a
  // combat-aware handler: snapshot the run deck, let onSell do whatever it does,
  // and purge whatever left from the other three places. That covers every grant
  // relic in the pool at once, including any added later, and it cannot
  // over-revoke — a FORGED copy carries a suffixed id that the receipt never
  // matched, so the dupe-before-you-sell tech keeps working exactly as it did.
  // =========================================================================

  /**
   * The relic OPTIONS panel. Never mid-cascade: a hand in flight owns the
   * screen.
   *
   * For an ACTIVE relic (the Slot Button, the Hushed Bell, the Wheel of
   * Divinity) this is a THREE-WAY: USE · SELL · KEEP — because "what does
   * clicking this relic do?" had two right answers and the panel is where both
   * get said out loud (JC's buddy pressed SPIN and was asked about selling in
   * the same breath; see the started-here guards on the icons for the other
   * half of that fix). A spent active relic says so instead of offering USE.
   */
  sellPromptInFight(art) {
    if (!art || this.busy) return false;
    if (this.sellOv) { this.sellOv.destroy(true); this.sellOv = null; }
    this.hideIntentTip();
    const paid = sellValue(art);
    const canUse = !!art.active && !this.activeSpent(art);
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay + 6);
    this.sellOv = ov;
    const close = () => { if (this.sellOv) { this.sellOv.destroy(true); this.sellOv = null; } };
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.55).setInteractive();
    dim.on('pointerdown', () => close());
    ov.add(dim);

    const cx = GAME_W / 2, cy = GAME_H / 2;
    const w = 620, h = 306;
    const parts = woodPanel(this, cx, cy, w, h, { accent: ARTIFACT_RARITY[art.rarity].color, shadow: true });
    ov.add([parts.shadow, parts.panel, parts.line]);
    ov.add(addArtifactIcon(this, cx - 222, cy - 28, art, 104));
    ov.add(this.add.text(cx + 44, cy - 96, art.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: PARCH.text,
      wordWrap: { width: 330 }, align: 'center',
    }).setOrigin(0.5, 0));
    const rar = ARTIFACT_RARITY[art.rarity];
    if (rar) {
      const rarText = this.add.text(cx + 44, cy - 126, rar.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
        color: '#' + rar.color.toString(16).padStart(6, '0'), stroke: '#241505', strokeThickness: 4,
      }).setOrigin(0.5, 0);
      if (rar.rainbow) rainbowText(this, rarText);
      ov.add(rarText);
    }
    const ask = canUse
      ? `Use it, or sell it for  ◉ ${paid}?`
      : `Sell it for  ◉ ${paid}?`;
    ov.add(legible(this.add.text(cx + 44, cy - 26, ask, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: canUse ? '24px' : '27px', color: '#ffc542',
    }), { shadow: false }).setOrigin(0.5, 0));
    const line = art.active && this.activeSpent(art)
      ? '✓ Already used this fight. Selling takes everything it was giving you.'
      : 'Mid fight. Selling takes everything it was giving you with it.';
    ov.add(this.add.text(cx + 44, cy + 10, line, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: 330 }, align: 'center',
    }).setOrigin(0.5, 0));

    // Two buttons, or three when the relic can still be FIRED: the whole point
    // of the three-way is that USE and SELL are named side by side, so neither
    // can ever be mistaken for the other again.
    const bw = canUse ? 186 : 220;
    const gap = 14;
    const btn = (bx, key, label, color, onClick, fontSize = 24) => {
      const img = this.add.image(bx, cy + 96, key).setDisplaySize(bw, 60).setInteractive({ useHandCursor: true });
      const txt = this.add.text(bx, cy + 93, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${fontSize}px`, color,
      }).setOrigin(0.5);
      ov.add([img, txt]);
      img.on('pointerdown', () => { sfx(this, 'button', { volume: 0.8 }); onClick(); });
      return img;
    };
    const xs = canUse
      ? [cx - bw - gap, cx, cx + bw + gap]
      : [cx - bw / 2 - 18, null, cx + bw / 2 + 18];
    if (canUse) {
      btn(xs[0], 'btn_green', (art.active.label ?? 'USE').toUpperCase(), '#0c3d18', () => {
        close();
        this.useActiveArtifact(art);
      }, 22);
    }
    btn(canUse ? xs[1] : xs[0], 'btn_yellow', `SELL ◉${paid}`, '#5b3a00', () => {
      close();
      const got = this.sellArtifactInFight(art);
      sfx(this, 'chips_stack', { volume: 0.9 });
      popMessage(this, ARENA_CX, 300, `+${got} chips`, { color: '#ffc542', size: 44, rise: 70 });
    }, canUse ? 21 : 24);
    btn(xs[2], 'btn_dark', 'KEEP', '#cfc8e8', close, canUse ? 22 : 24);
    ov.setAlpha(0);
    this.tweens.add({ targets: ov, alpha: 1, duration: 140 });
    return true;
  }

  /**
   * Sell it, and make the fight forget it. Returns the chips paid.
   *
   * ORDER MATTERS ON THE WAY OUT TOO: the relic row re-resolves the instant the
   * belt changes (mirrors re-point at whoever slid into the gap, the ordered
   * mult chain re-walks), which is why the panel is rebuilt from scratch and the
   * preview is re-read rather than patched.
   */
  sellArtifactInFight(art) {
    const discardsBefore = run.discardsPerFightBonus;
    // The belt as it stands BEFORE the splice, so THE ROPEMAKER's noose can be
    // re-derived onto the relics it was actually put on — selling a relic in
    // front of a hung one used to shuffle the rope onto its neighbour, and
    // selling the hung relic itself used to leave the rope hanging on whoever
    // took its cell.
    const beltBefore = [...run.artifacts];
    // THE RECEIPT. run.sellArtifactWithReceipt runs the ordinary sale (onSell,
    // off the belt, chips in the purse) and reports what the RUN DECK lost and
    // what it had rewritten in place, by diff — see the note on it for why the
    // dupe-then-sell tech survives this.
    const { paid, removed, resuited } = sellArtifactWithReceipt(art);
    if (!paid) return 0;
    this.remapHungRelics(beltBefore);

    // 1. CARDS THE RELIC TOOK BACK. Anything no longer in the run deck must not
    //    be in the draw pile, the discard pile or the player's hand either.
    if (removed.length) this.purgeCardsFromFight(removed);

    // 2. CARDS THE RELIC REWROTE. runDeck, draw pile, hand and discard all hold
    //    the SAME card objects, so a suit put back by the Prism is already back
    //    everywhere — but the sprite in the fan is painted from the old suit and
    //    has to be struck again, and the seal locks re-derived from it.
    if (resuited.length) {
      const ids = new Set(resuited);
      for (const cs of [...this.handCards]) if (ids.has(cs.card.id)) this.rebuildHandSprite(cs);
      this.relayoutForSuits();
      this.resyncDenialLocks?.();
    }

    // 3. THE FIGHT-LOCAL ALLOWANCES. onSell already rolled back the RUN's
    //    numbers; these are the copies this fight took at the opening bell.
    //    Discards: the habit leaves with the ring, this fight included.
    const lostDiscards = discardsBefore - run.discardsPerFightBonus;
    if (lostDiscards > 0) this.discardsLeft = Math.max(0, this.discardsLeft - lostDiscards);
    //    Hand size: nothing the player is holding is destroyed. trimHandToSize
    //    hands the surplus BACK to the top of the draw pile, which is the same
    //    thing the Fairy King's roots do, so the card is not lost, just no
    //    longer yours to play this turn.
    this.trimHandToSize();

    // 4. THE ROW RE-RESOLVES. A new signature forces a full rebuild, which is
    //    what re-points the mirrors and re-numbers the chain ordinals.
    this._artifactSig = null;
    this.renderArtifactPanel();
    this.layoutHand();
    this.updatePreview();
    this.refreshAll();
    this.announce(`SOLD: ${art.name}`, '#ffc542');
    return paid;
  }

  /**
   * Take these card ids out of the fight entirely: the draw pile, the discard
   * pile and the player's HAND, sprites and all. run.runDeck is already done by
   * the time this is called (the relic's own onSell did it).
   */
  purgeCardsFromFight(ids) {
    const doomed = new Set(ids);
    if (!doomed.size) return 0;
    this.deck = this.deck.filter(c => !doomed.has(c.id));
    this.discardPile = this.discardPile.filter(c => !doomed.has(c.id));
    // ANYTHING THE PLAYER CAN SEE MUST VISIBLY GO (JC, 0803: "if something is
    // visible and revoked, it should activate a little poof animation and delete
    // it so it's clear to the user they just lost something"). dissolveCard is
    // the ETHEREAL vanish, already tuned and already the game's one visual
    // sentence for "this card has left the run" — so cards leaving the deck
    // forever always look the same way, whatever pulled them. Cards in the draw
    // or discard pile are not on screen and go quietly; there is nothing to show.
    const victims = this.handCards.filter(cs => doomed.has(cs.card.id));
    victims.forEach((cs, i) => {
      // Data first, on this frame, so nothing can play a card that is already
      // revoked while its poof is still in the air.
      this.handCards = this.handCards.filter(c => c !== cs);
      this.selected = this.selected.filter(c => c !== cs);
      this.slicedCards = (this.slicedCards ?? []).filter(c => c.id !== cs.card.id);
      if (this.hypnoCard === cs) this.hypnoCard = null;
      cs.setSelected?.(false);
      cs.disableInteractive?.();
      // Staggered, briefly: a consequence beat, not a celebration.
      if (i === 0) this.dissolveCard(cs);
      else this.time.delayedCall(this.spd(110) * i, () => this.dissolveCard(cs));
    });
    if (victims.length > 0) {
      popMessage(this, ARENA_CX, 340,
        victims.length > 1 ? `${victims.length} CARDS RECLAIMED` : 'CARD RECLAIMED',
        { color: '#b45cff', size: 30 });
      // The fan closes over the gap once the last poof has cleared.
      this.time.delayedCall(this.spd(110) * victims.length + this.spd(360), () => {
        this.layoutHand(); this.updatePreview(); this.refreshAll();
      });
    }
    return victims.length;
  }

  // ---------------- ACTIVE-USE relics ----------------

  /**
   * The USE tab: a brass tag pinned to a clickable relic's lower lip, breathing
   * while it is charged. Clicking it spends the relic's one charge for this
   * fight. Spent, it turns cold and wears a ✓ until the next fight.
   *
   * ON TOUCH IT NO LONGER SPENDS ANYTHING. It is still tappable — it is the
   * shortcut, and the biggest thing on the cell that ISN'T the relic art — but
   * the tap opens the relic's box and the box's own USE button is what fires
   * the charge. A one-per-fight irreversible active had been committing on a
   * raw pointerDOWN, on a 72x26 plate, beside a 108px icon.
   */
  buildActiveTag(art, icon, x, y) {
    const img = this.add.image(x, y, 'hud_tag_use').setDisplaySize(USE_TAG.w, USE_TAG.h);
    const label = this.add.text(x, y - 2, art.active.label ?? 'USE', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${USE_TAG.font}px`, color: '#3d2a08',
    }).setOrigin(0.5);
    this.artifactPanelG.add(img);
    this.artifactPanelG.add(label);
    const tag = { art, icon, img, label, breath: null };
    (this.activeTags ??= []).push(tag);
    img.setInteractive({ useHandCursor: true });
    img.on('pointerover', () => {
      this.showArtifactTip(icon.x, Math.min(icon.y, GAME_H - 170), art);
      if (!this.activeSpent(art)) this.tweens.add({ targets: [img, label], scale: 1.14, duration: 100 });
    });
    img.on('pointerout', () => {
      this.hideIntentTip();
      this.tweens.add({ targets: [img, label], scale: 1, duration: 100 });
    });
    if (TOUCH) twoTap(this, img, this.relicBoxSpec(art, this.relicAnchor(icon)));
    else img.on('pointerdown', () => this.useActiveArtifact(art));
    this.syncActiveTag(tag);
    return tag;
  }

  /**
   * MIDAS GAUNTLET (2026-08-04): a played DIAMOND came up gold. The wrap goes
   * on the CARD DATA — the played copy AND its run-deck twin — so the foil is
   * permanent; the sprite in flight just gets its moment (gold burst + line),
   * because it is about to fly off the screen and the real reveal is the next
   * time the card is drawn wearing its shine.
   */
  midasTouch(art, card) {
    card.wrap = 'shiny';
    const twin = run.runDeck.find(c => c.id === card.id);
    if (twin) twin.wrap = 'shiny';
    // handCommit fires before the played sprites leave the fan, so the card's
    // sprite is still findable there; the fallback is the played row's centre.
    const cs = (this.handCards ?? []).find(c => c?.card?.id === card.id) ?? null;
    const at = cs ?? { x: ARENA_CX, y: CARD.playedY };
    this.time.delayedCall(this.spd(260), () => {
      sfx(this, 'minor_upgrade', { volume: 0.7, rate: 1.2 });
      burst(this, at.x, at.y - 30, 0xffd23e, 16);
      popNumber(this, at.x, at.y - 110, '✨ MIDAS: it comes away SHINY',
        { color: '#ffd23e', size: 30, rise: 46 });
      this.pulseArtifact(art, { text: '✨ SHINY', color: '#ffd23e' });
    });
  }

  /** Has this relic already been fired this fight? */
  activeSpent(art) { return !!this._activeUsed?.has(art); }

  /**
   * Repaint one USE tag from its relic's live charge state. A no-op unless the
   * state actually moved — refreshAll runs on every damage number, and
   * restarting the breath tween each time would stutter it flat.
   */
  syncActiveTag(tag) {
    const spent = this.activeSpent(tag.art);
    if (tag.spent === spent) return;
    tag.spent = spent;
    tag.breath?.remove();
    tag.breath = null;
    if (spent) {
      tag.img.setTexture('hud_tag_spent').setDisplaySize(USE_TAG.w, USE_TAG.h).setAlpha(0.92);
      // Cold, not gone: #b8ada0 on the pale spent brass was unreadable rather
      // than merely dim, and "have I used this?" is a question worth answering.
      tag.label.setText('✓ SPENT').setColor('#6b6055').setFontSize(`${USE_TAG.spentFont}px`);
      tag.icon.setAlpha(0.42);
      // A SPENT TAG STAYS TAPPABLE ON TOUCH. Desktop's tag only ever did one
      // thing, so a dead one is correctly dead; the phone's opens the relic's
      // box, and a spent relic is exactly when you want to read it (and, quite
      // often, sell it). Killing the hit area here would drop the tap through
      // to the icon underneath, which does the same thing anyway — this just
      // stops the biggest target on the cell going quietly numb.
      if (!TOUCH) tag.img.disableInteractive();
    } else {
      tag.img.setTexture('hud_tag_use').setDisplaySize(USE_TAG.w, USE_TAG.h).setAlpha(1);
      tag.label.setText(tag.art.active.label ?? 'USE').setColor('#3d2a08').setFontSize(`${USE_TAG.font}px`);
      tag.icon.setAlpha(1);
      tag.img.setInteractive({ useHandCursor: true });
      tag.breath = this.tweens.add({
        targets: [tag.img, tag.label], scale: 1.07, duration: 760,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
  }

  /** Repaint every USE tag (refreshAll, and after a charge is spent). */
  syncActiveTags() { for (const t of this.activeTags ?? []) if (t.img.active) this.syncActiveTag(t); }

  /**
   * Fire an active relic. One charge per FIGHT, never while the scene is busy
   * resolving something, and never after the relic itself refuses (a bell with
   * no living target keeps its charge).
   */
  useActiveArtifact(art) {
    if (this.busy || !art?.active || this.activeSpent(art)) return false;
    this.hideIntentTip();
    const fired = art.active.use(this, art) !== false;
    if (!fired) return false;
    (this._activeUsed ??= new Set()).add(art);
    this.syncActiveTags();
    return true;
  }

  // ---------------- THE THREE ACTIVES OF THE 2026-08-10 WAVE ----------------
  // All three obey useActiveArtifact's contract above: RETURN FALSE TO REFUSE,
  // and a refusal costs no charge. So each one's first job is to say out loud
  // why there is nothing legal to do, rather than eating the fight's one press.

  /**
   * COMET IN A JAR. One charge a hand, across the whole RUN; RELEASE empties
   * the jar and lights the rest of the fight up. Refuses while it is short,
   * because a comet released at twenty-four charges is a comet wasted.
   */
  useCometInAJar(a) {
    const have = a.state.charges ?? 0;
    if (have < COMET_CHARGES) {
      this.announce(`THE JAR IS NOT FULL: ${have} of ${COMET_CHARGES} charges`, '#8fd8ff');
      return false;
    }
    a.state.charges = have - COMET_CHARGES;
    a.state.lit = true;
    // The ×N rides mods.globalMultFactor off `state.lit`, so the belt has to be
    // re-collected and the PREVIEW re-read the instant it is set: a player
    // planning the next hand against the number the jar had a second ago is a
    // player being lied to by the equation bar.
    this.refreshAll();
    this.updatePreview();
    sfx(this, 'legendary_appears', { volume: 0.95 });
    this.cameras.main.flash(240, 120, 180, 255);
    burst(this, ARENA_CX, 320, 0x8fd8ff, 28);
    this.bigMessage(`THE COMET!\n×${COMET_FACTOR} mult`, '#8fd8ff', 54, 2400);
    this.pulseArtifact(a, { text: `×${COMET_FACTOR}`, color: '#8fd8ff' });
    return true;
  }

  /**
   * COLD SNAP CHARM. Armed, not fired: the NEXT hand you play comes back to
   * your hand instead of going to the discard pile. Refuses while it is already
   * armed, so a stray second press cannot burn the charge on nothing.
   */
  useColdSnapCharm(a) {
    if (this._coldSnap) {
      this.announce('ALREADY ARMED: play a hand', '#bfd8ff');
      return false;
    }
    a.state.armed = true;
    this._coldSnap = a;
    sfx(this, 'frozen_placed', { volume: 0.85 });
    popMessage(this, ARENA_CX, 300, 'ARMED: the next hand comes home',
      { color: '#bfd8ff', size: 34 });
    this.pulseArtifact(a, { text: 'ARMED', color: '#bfd8ff' });
    this.refreshAll();
    return true;
  }

  /**
   * COLD SNAP CHARM lands, at the stow loop. The sprites that SURVIVED the hand
   * go back into the fan instead of into the discard pile.
   *
   * A CARD THAT IS GONE IS STILL GONE: burned and vanished sprites were already
   * skipped by the loop's own guard, so the All-In Visor, ETHEREAL's vanish and
   * the FADE all still win and the charm resurrects nothing.
   *
   * THE HAND SIZE IS STILL THE HAND SIZE. If the fan cannot hold everything
   * that survived, as many as fit come home and the rest are stowed normally —
   * a charm is not a licence to hold nine cards.
   */
  coldSnapReturn(a, coming) {
    this._coldSnap = null;
    a.state.armed = false;
    a.state.saved = (a.state.saved ?? 0) + coming.length;
    if (!coming.length) return;
    // Held to the same beat the discard tweens fly on, so the hand does not
    // snap back into the fan while the cascade is still finishing its sentence.
    this.time.delayedCall(this.spd(575), () => {
      for (const cs of coming) {
        if (!cs.active) continue;
        cs.setSelected(false);
        // A returning card re-derives its lock rather than simply losing it: a
        // sealed suit is still sealed, and a card is not laundered by leaving.
        cs.setLockState(this.cardDenied(cs.card) ? 'banned' : null);
        this.handCards.push(cs);
      }
      this.layoutHand();
      sfx(this, 'frozen_placed', { volume: 0.8, rate: 1.15 });
      popMessage(this, ARENA_CX, 300, 'COLD SNAP', { color: '#bfd8ff', size: 40 });
      this.pulseArtifact(a, { text: `${coming.length} HOME`, color: '#bfd8ff' });
      this.updatePreview();
      this.refreshAll();
    });
  }

  /**
   * HOURGLASS OF THE SECOND SUN. Re-executes the LAST hand you played, through
   * the ordinary scoring path, as a play that does NOT tick the hand clock.
   *
   * IT IS A REPLAY OF THE HAND'S OUTPUT, not a re-draw. Those cards are in the
   * discard pile by now (or burned, or gone); the hourglass never touches the
   * fan and never asks for them back. It re-scores the same five card OBJECTS
   * and re-delivers what they make, which is exactly what the CHRONO ELIXIR's
   * echo does, on a button and with a fresh roll of every gamble in the hand.
   *
   * IT DOES NOT SPEND A HAND: handsThisFight and run.counters.handsPlayed are
   * both deliberately untouched, so the clock, the out-of-hands warning and THE
   * DEAD MAN'S HAND (which reads the clock at BUILD time) are all unmoved by it.
   */
  useSecondSunHourglass(a) {
    const last = this._lastPlay;
    if (!last?.cards?.length) {
      this.announce('NO HAND TO TURN BACK YET', '#ffc542');
      return false;
    }
    const cards = last.cards;
    // The ordinary path, start to finish: the orb gambles again, the belt is
    // re-collected against the board AS IT STANDS NOW, and the wheel spins
    // fresh. A replay that reused the old result would be a screenshot.
    this.rollChaosOrbs();
    const state = this.buildScoreState(cards);
    state.rouletteRolls = rollRouletteFor(cards, Math.random, state.mods);
    if (this._rouletteForce) {
      for (const k of Object.keys(state.rouletteRolls)) {
        state.rouletteRolls[k] = state.rouletteRolls[k].map(() => this._rouletteForce);
      }
    }
    const res = scoreHand({ cards, character: this.chr.id, state });
    this._lastRes = res;
    a.state.turned = (a.state.turned ?? 0) + 1;
    sfx(this, 'legendary_appears', { volume: 0.9 });
    this.cameras.main.flash(220, 255, 210, 120);
    this.bigMessage('THE SECOND SUN', '#ffc542', 54, 2200);
    this.pulseArtifact(a, { text: 'AGAIN', color: '#ffc542' });
    // THE BIOME CONTEXT, built exactly the way resolveHand builds it: a replay
    // is still a HAND, so a WALL, NOTHING TWICE, a marked card and a forgotten
    // suit all still stand in front of it.
    this._handCtx = {
      type: last.ev.type, ids: cards.map(c => c.id),
      used: new Set(this.usedHandTypes),
      damageBySuit: res.damageBySuit ?? {},
    };
    for (const e of this.enemies ?? []) e._gateSaid = false;
    if (res.shield && this.addShield(res.shield) > 0) this.heroShield();
    if (res.heal) this.healPlayer(res.heal, { quiet: true });
    if (res.chipBonus) this.gainChips(res.chipBonus, null, { quiet: true });
    this.retargetIfDead();
    let dealt = 0;
    if (res.damage > 0 && this.target?.alive) {
      sfx(this, res.damage >= 90 ? 'hit_big' : 'hit_small', { volume: 1, jitter: 0.05 });
      dealt = this.deliverStrike(res, { color: '#ffc542' }).dealt;
    }
    this._handCtx = null;
    // NO afterHand HOOK, on purpose and for the echo's own reason: the bank
    // ledger, the gavel's roll and the comet's charge are all paid ONCE per
    // hand COMMITTED, and the hourglass commits nothing.
    this.noteHandStats(dealt, 0, last.ev.name);
    this.refreshAll();
    this.time.delayedCall(700, () => {
      if (!this.livingEnemies().length && !this.busy) this.fightWon();
    });
    return true;
  }

  /**
   * Balatro moment v2: the relic swells AND STAYS swollen until the next hand.
   * Repeat triggers in one hand accumulate — the label grows into a running
   * total (+2 -> +4) while the old number floats off behind it.
   */
  pulseArtifact(art, job) {
    if (typeof job === 'string') job = { text: job };
    // job.slot lets a MIRROR swell its OWN cell rather than the source's: the
    // copy resolved at the mirror's position, so that is the cell that lights.
    const i = job.slot ?? run.artifacts.indexOf(art);
    const icon = this.artifactIcons?.[i];
    if (!icon?.active) return;
    const totals = (this._pulseTotals ??= {});
    const tot = totals[i] ??= { add: 0, mult: 1, uses: 0, labelObj: null };
    tot.uses += 1;

    let label;
    if (job.add != null) {
      tot.add = Math.round((tot.add + job.add) * 10) / 10;
      label = `+${fmtNum(tot.add)}${job.suffix ?? ''}`;
    } else if (job.mult != null) {
      tot.mult = Math.round(tot.mult * job.mult * 100) / 100;
      label = `×${tot.mult}`;
    } else {
      label = job.text;
    }

    // Swell, then settle back home once the pulse lands.
    this.tweens.killTweensOf(icon);
    this.tweens.add({
      targets: icon, scale: icon.getData('baseScale') * 1.45, duration: 130,
      yoyo: true, hold: 160, ease: 'Back.easeOut',
      onComplete: () => { if (icon.active) icon.setScale(icon.getData('baseScale')); },
    });

    // Old total drifts off behind the new, bigger one.
    if (tot.labelObj?.active) {
      const oldLabel = tot.labelObj;
      this.tweens.add({ targets: oldLabel, y: oldLabel.y - 42, alpha: 0, duration: 420, onComplete: () => oldLabel.destroy() });
    }
    const size = Math.min(23 + tot.uses * 3, 36);
    // A wordy label ('THE WHEEL', 'TEMPERED') on the left-hand column used to
    // run off the parchment's edge — nudge it back inside without moving the
    // relic it belongs to. Nook icons live outside the sidebar and are left be.
    const lx = icon.x < SIDEBAR_W ? Phaser.Math.Clamp(icon.x, 84, SIDEBAR_W - 84) : icon.x;
    // ...and it clears the ICON rather than a constant: the row changes size
    // class with the mat, and a fixed -54 that cleared a 78px relic sits on top
    // of a 92px one.
    tot.labelObj = this.add.text(lx, icon.y - icon.displayHeight / 2 - 15, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`,
      color: job.color ?? '#ffd23e', stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(DEPTH.overlay).setScale(0);
    this.tweens.add({ targets: tot.labelObj, scale: 1, duration: 140, ease: 'Back.easeOut' });

    // The final total lingers just long enough to read, then floats away
    // on its own — no more triggers, no more label.
    tot.fadeTimer?.remove();
    tot.fadeTimer = this.time.delayedCall(1500, () => {
      if (tot.labelObj?.active) {
        const o = tot.labelObj;
        this.tweens.add({ targets: o, alpha: 0, y: o.y - 34, duration: 500, onComplete: () => o.destroy() });
      }
    });
  }

  /** New hand incoming: leftover labels wipe, running totals reset. */
  resetArtifactPulses(instant = false) {
    for (const k of Object.keys(this._pulseTotals ?? {})) {
      const tot = this._pulseTotals[k];
      tot.fadeTimer?.remove();
      if (tot.labelObj?.active) {
        const o = tot.labelObj;
        if (instant) o.destroy();
        else this.tweens.add({ targets: o, alpha: 0, y: o.y - 30, duration: 280, onComplete: () => o.destroy() });
      }
    }
    this._pulseTotals = {};
  }

  /**
   * Pulse exactly the artifacts that moved THIS card's value, so the gold "+3"
   * floating off the card and the relic that caused it swell as one event.
   * (The joker cascade no longer announces value adds — it would repeat the
   * same number a beat later.)
   */
  pulseValueArtifacts(b) {
    for (const a of this.liveArtifacts()) {
      const m = typeof a.mods === 'function' ? a.mods(a, run) : a.mods;
      if (!m) continue;
      const add = (b.valueBonusSuit ? (m.suitValue?.[b.suit] ?? 0) : 0)
        + (b.valueBonusFace ? (m.faceValue ?? 0) : 0)
        + (b.valueBonusMod && b.mod ? (m.modValue?.[b.mod] ?? 0) : 0);
      if (add > 0) this.pulseArtifact(a, { add, color: '#e8dcc0' });
    }
    // Per-hand, per-card grants (Blunt Dagger, the Crown's Ace) — the scene
    // handed these out in buildScoreState, so it also owns the credit.
    for (const g of this._valueGrants ?? []) {
      if (g.id === b.id) this.pulseArtifact(g.a, { add: g.add, color: '#e8dcc0' });
    }
  }

  /** Pulse every relic that retriggers a card (the Ouroboros family). */
  pulseRetriggerArtifacts(n) {
    for (const a of this.liveArtifacts()) {
      const m = typeof a.mods === 'function' ? a.mods(a, run) : a.mods;
      if ((m?.retriggerTop ?? 1) > 1) this.pulseArtifact(a, { text: `↻ ×${n}`, color: '#50b888' });
    }
  }

  /** Pulse every effective artifact carrying a given prop. */
  pulseByProp(prop, label, color) {
    for (const a of this.liveArtifacts()) {
      if ((a.props?.[prop] ?? 0) > 0) this.pulseArtifact(a, { text: label, color });
    }
  }

  /**
   * The joker cascade: after the cards tick, each contributing artifact
   * announces itself in order. Returns how many pulses were scheduled.
   *
   * Jobs that move the MULT carry `eqAdd` / `eqMul`, and the equation's mult
   * side punches up in lockstep with the relic swelling — the artifact and the
   * number it changed are one event. (Jobs with neither, e.g. flat damage or
   * status stacks, leave the mult alone.)
   */
  scheduleArtifactPulses(res, cards, startAt) {
    const jobs = [];
    // WHO MADE THE HAND HAPPEN AGAIN. Collected as the row is walked, because
    // the walk already asks every relic that question — and read back by
    // repeatBeat(), which pulses them once per activation so the cause of a ×25
    // is visible twenty five times rather than asserted once.
    this._repeatCause = [];
    const scoringSuits = new Set(res.breakdown.filter(b => b.scoring).map(b => b.suit));
    const n = cards.length;
    // THE CHAOS ORB's roll is banked on the scene, not in a mods bag, so it is
    // paired back to its own relic here — it has to fire at the ORB's cell in
    // the row, because that is where scoring.js actually added it.
    const chaosQueue = [...(this._chaosJobs ?? [])];
    this._chaosJobs = [];
    // THE HERO PASSIVE, if it moved this hand at all (core/passives.js). It is
    // scheduled like any other job — same 195ms tick, same ledger row, same
    // eqAdd/eqMul contract — because to the player it IS a relic that happens
    // to live above the oracle instead of on the mat. What it must NOT do is
    // fire at the wrong moment: `when` names the passive's own position in the
    // walk scoring.js performed, and the two jobs below are inserted at exactly
    // that seam so the running total on screen is one the arithmetic held.
    const passive = passiveAttribution(run.chrId, res);
    const passiveJob = () => [null, {
      passive, text: passive.label, color: passive.color,
      eqAdd: passive.eqAdd || undefined, eqMul: passive.eqMul !== 1 ? passive.eqMul : undefined,
    }];
    // DRUSKY's hoard is flat mult paid at step 3 — BEFORE the relic walk, which
    // is exactly the position the Solid Gold Sack exists to trade away — so his
    // is the first thing that happens in the cascade.
    if (passive?.when === 'open') jobs.push(passiveJob());
    // THE CHAIN, left to right. This is the exact list scoring.js walked, cell
    // by cell (mirrors sitting at the MIRROR's position), so what the player
    // watches climb is the order that produced the number.
    for (const { art: a, slot } of effectiveArtifactSlots()) {
      const mark = jobs.length;   // everything this cell pushes belongs to this cell
      // THE CHAOS ORB shows its work: the rolled number IS the relic's whole
      // personality, so it announces the actual figure it just gambled. It is a
      // single-use charge on the scene rather than a mod, which is why it is
      // matched by hand — but it fires HERE, in the orb's own cell and with the
      // other ADDS, because that is exactly where scoring.js put it.
      const ci = chaosQueue.findIndex(([holder]) => holder === a);
      if (ci >= 0) {
        const roll = chaosQueue.splice(ci, 1)[0][1];
        jobs.push([a, roll > 0
          ? { add: roll, suffix: ' mult', color: '#b45cff', eqAdd: roll }
          : { text: 'CHAOS: nothing', color: '#a898c4' }]);
      }
      const m = typeof a.mods === 'function' ? a.mods(a, run) : a.mods;
      // NB: suitValue / faceValue are deliberately absent here — those fire
      // per-card during the score ticks (pulseValueArtifacts), where the
      // number they changed is actually on screen.
      if (m?.handMult?.[res.handType]) jobs.push([a, { add: m.handMult[res.handType], suffix: ' mult', color: '#ffd23e', eqAdd: m.handMult[res.handType] }]);
      // THE SCALERS. flatMult is the banked total a relic has grown to
      // (Kingmaker's crowns, the Rising Tide, Lucky Deuce, the Ace's Legacy,
      // Wolfsbane's wolves) — it pays on EVERY hand, so it takes a bow on
      // every hand, and the mult side jumps by exactly what it banked.
      if (m?.flatMult > 0) {
        jobs.push([a, { add: m.flatMult, suffix: ' mult', color: '#ffd23e', eqAdd: m.flatMult }]);
      }
      // Kingmaker: +5 mult for every J/Q/K that scored.
      if (m?.faceMult && res.faceCount > 0) {
        const add = m.faceMult * res.faceCount;
        jobs.push([a, { add, suffix: ' mult', color: '#d8b830', eqAdd: add }]);
      }
      // Prayer Beads and friends: flat mult per scoring card of a suit.
      if (m?.suitMult) {
        const add = Object.keys(m.suitMult)
          .reduce((s, k) => s + m.suitMult[k] * (res.suitCounts?.[k] ?? 0), 0);
        if (add > 0) jobs.push([a, { add, suffix: ' mult', color: '#ff9aa4', eqAdd: add }]);
      }
      // THE STRAIGHTEDGE'S BANK: flat pre-mult VALUE for a whole hand type. It
      // moves the SCORE side, so it announces itself there and the equation
      // climbs by exactly what the relic banked.
      if (m?.handValue?.[res.handType] > 0) {
        const v = m.handValue[res.handType];
        jobs.push([a, { add: v, suffix: ' value', color: '#c8c8d8', eqAddScore: v }]);
      }
      // FLAT VALUE ON EVERY HAND (the Golden Spud): same idiom as the
      // Straightedge above. This was the ONE score-side channel with no job —
      // the +50 landed in the math and the equation never showed it (JC,
      // 2026-08-04). The gate mirrors scoring.js exactly: the bonus is only
      // PAID when the hand made a score to add it to.
      if (m?.flatValue > 0 && (res.baseSum ?? 0) + (res.baseFlat ?? 0) > 0) {
        jobs.push([a, { add: m.flatValue, suffix: ' value', color: '#ffd23e', eqAddScore: m.flatValue }]);
      }
      if (m?.handFactor?.[res.handType] && m.handFactor[res.handType] !== 1) jobs.push([a, { mult: m.handFactor[res.handType], color: '#ff8c28', eqMul: m.handFactor[res.handType] }]);
      // Alchemist's Still: one × per modified card that scored, compounding.
      // The label SHOWS THE COUNT (JC, 2026-08-04: a hand of roulette cards
      // left him unsure each one had fired the still) — the maths were always
      // per scored card, but a bare ×1.61 never said "that is five ×1.1s".
      if (m?.modCardFactor && m.modCardFactor !== 1 && res.modCount > 0) {
        const f = Math.round(Math.pow(m.modCardFactor, res.modCount) * 100) / 100;
        jobs.push([a, { text: `${res.modCount} MODDED: ×${f}`, color: '#58c0a8', eqMul: f }]);
      }
      if (m?.globalMultFactor && m.globalMultFactor !== 1) jobs.push([a, { mult: Math.round(m.globalMultFactor * 100) / 100, color: '#ff8c28', eqMul: m.globalMultFactor }]);
      // Ouroboros: the loop already tripled a card on the SCORE side — this is
      // the relic taking a bow for it, no mult moved.
      if (m?.retriggerTop > 1 && res.retriggerId) jobs.push([a, { text: `↻ ×${res.retrigger}`, color: '#50b888' }]);
      // REPEATING POCKETWATCH: the whole hand happens again. It takes its bow
      // here and then CAUSES the repeat beat that follows the cascade, where the
      // hand is actually replayed activation by activation and the score side
      // climbs a step at a time. No eqMulScore: repeatBeat() owns that ×N now,
      // and two owners would double the total.
      if (m?.handRepeat > 1) {
        jobs.push([a, { text: `↻ ×${m.handRepeat}`, color: '#d8c070' }]);
        this._repeatCause.push(a);
      }
      // THE FORGE HAMMER, first swing: every VALUE the hand made, doubled.
      // (Its second swing is the globalMultFactor job above/below — two pulses
      // on one relic, because it genuinely moves both sides.)
      if (m?.valueFactor > 1) jobs.push([a, { text: `×${m.valueFactor} VALUE`, color: '#ff5a3c', eqMulScore: m.valueFactor }]);
      // The hero-exclusive rewrites: the mult is now spent on shield / heal /
      // poison, so the relic announces what it multiplied and by how much.
      if (m?.shieldByMult && res.shield > 0) jobs.push([a, { text: `◆ ×${res.effMult}`, color: '#7fe0f4' }]);
      if (m?.healByMult && res.heal > 0) jobs.push([a, { text: `♥ ×${res.effMult}`, color: '#ff9aa4' }]);
      if (m?.gemDamageFactor && scoringSuits.has('gems') && res.damage > 0) jobs.push([a, { text: 'diamonds bite', color: '#7fe0f4' }]);

      const pr = a.props ?? {};
      if (pr.oneCardFactor && n === 1) jobs.push([a, { mult: pr.oneCardFactor, color: '#ff5060', eqMul: pr.oneCardFactor }]);
      if (pr.lowHpFactor && this.player.hp / this.player.maxHp < 0.5) jobs.push([a, { mult: 1.5, color: '#ff5060', eqMul: 1.5 }]);
      // Ambusher's Hourglass — handsThisFight is already incremented here.
      if (pr.firstHandFactor && this.handsThisFight === 1) jobs.push([a, { mult: pr.firstHandFactor, color: '#d0a040', eqMul: pr.firstHandFactor }]);
      // COURT IN SESSION is deliberately ABSENT here since 0803-B: like the two
      // benches below it now resolves at the very END of the mult, so it takes
      // its bow in leftoverPhase() after the hand has finished repeating. A job
      // here as well would move the mult twice for the same held-back cards.
      if (pr.nthHandEvery && this.handsThisFight % pr.nthHandEvery === 0) jobs.push([a, { mult: pr.nthHandFactor, color: '#60c8d8', eqMul: pr.nthHandFactor }]);
      // THE TWO BENCHES (RIGGED WHEEL · VOIDCALLER) are deliberately ABSENT
      // here. Until 0803 each fired one combined ×1.95 pulse in the cascade and
      // the arithmetic simply appeared. They now get a beat of their own before
      // the cascade — benchBeat() — where each held-back card is emphasised in
      // the fan, one at a time, showing its own ×1.25 while the mult climbs. A
      // job here as well would move the mult twice for the same cards.
      if (pr.allIn) jobs.push([a, { mult: 3, color: '#d04870', eqMul: 3 }]);
      // THE SHARPEST DAGGER: one card, five times. Same deal as the Pocketwatch
      // above — the bow is here, the ×N is repeatBeat()'s.
      if (pr.oneCardRepeat && n === 1) {
        jobs.push([a, { text: `↻ ×${pr.oneCardRepeat}`, color: '#ff5ce1' }]);
        this._repeatCause.push(a);
      }
      // THE DEAD MAN'S HAND takes two bows, because it genuinely moves both
      // sides: the ×N on the mult, and the replay the repeat beat is about to
      // perform. handsThisFight is already incremented here, so the clock reads
      // ZERO for the very hand buildScoreState saw one left on — the same
      // question asked one tick later.
      if (pr.deadMansHand && this.handsLeft === 0) {
        jobs.push([a, { mult: pr.deadMansFactor, color: '#ff8c28', eqMul: pr.deadMansFactor }]);
        jobs.push([a, { text: `↻ ×${pr.deadMansRepeat}`, color: '#ff8c28' }]);
        this._repeatCause.push(a);
      }
      // Stamp the CELL onto every job this iteration produced, so a mirrored
      // relic swells the mirror's own socket instead of doubling up on its
      // source and reading as one ×4 where the row actually did ×2 then ×2.
      for (let k = mark; k < jobs.length; k++) jobs[k][1].slot = slot;
    }
    // An orb that somehow fell out of the row between the roll and the cascade
    // (sold mid-hand, a mirror re-pointed) still gets to show its number.
    for (const [a, roll] of chaosQueue) {
      jobs.push([a, roll > 0
        ? { add: roll, suffix: ' mult', color: '#b45cff', eqAdd: roll }
        : { text: 'CHAOS: nothing', color: '#a898c4' }]);
    }

    // WHEEL OF DIVINITY's spent blessing takes its bow like any other relic —
    // it is not in the mods/props sweep above because it lives on the SCENE
    // (one hand only), so it is appended by hand here.
    const spent = this._wheelSpent;
    if (spent?.mult) jobs.push([spent.mult.a, { mult: spent.mult.factor, color: '#ffd23e', eqMul: spent.mult.factor }]);
    if (spent?.repeat) {
      jobs.push([spent.repeat.a, { text: `↻ ×${spent.repeat.factor}`, color: '#7fa8ff' }]);
      this._repeatCause.push(spent.repeat.a);
    }
    this._wheelSpent = null;

    // DEXTRA's few-card ×N and THE BULL's Diamond ×2 both resolve AFTER the
    // ordered walk (scoring step 5), so they take their bow here rather than at
    // some relic's cell. The Bull's carries no eqMul on purpose: his doubling
    // already ticked onto the SCORE side card by card, and a × on the mult
    // would be the same damage claimed twice.
    if (passive?.when === 'late') jobs.push(passiveJob());

    // THE ANCIENT SHIELD spends the wall on the mult. It resolves AFTER the
    // ordered walk in scoring.js (Zeal's exact position in the pipeline), so it
    // takes its bow here rather than in the loop above — a relic that pulsed at
    // its own cell while multiplying after the walk would show the player a
    // running total the arithmetic never held.
    for (const a of this.liveArtifacts()) {
      const m = typeof a.mods === 'function' ? a.mods(a, run) : a.mods;
      if (!m?.shieldMult || (res.shieldMultFactor ?? 1) <= 1) continue;
      const f = Math.round(res.shieldMultFactor * 100) / 100;
      jobs.push([a, {
        text: `◆ ${res.shieldMultRead}  ×${f}`, color: '#7fe0f4', eqMul: res.shieldMultFactor,
      }]);
      break;   // one wall, one bow: mirrors do not re-read the same shield
    }

    // ZELUS DISCHARGES. The battery is not a relic and has no cell to swell, so
    // it takes its bow LAST with a job of its own (`a` is null) — the sidebar
    // ZEAL readout flares, a golden pulse crosses the hero, and the mult side
    // jumps by exactly the factor scoring.js already applied.
    //
    // His PASSIVE CHIP rides this same job rather than getting one of its own:
    // the discharge IS his passive, and a second beat would move the mult twice
    // for one spend. Hence `when: 'zeal'` in core/passives.js.
    if (res.zealConsumed > 0 && (res.zealFactor ?? 1) > 1) {
      jobs.push([null, {
        zeal: res.zealConsumed,
        passive: passive?.when === 'zeal' ? passive : null,
        text: `ZEAL ${res.zealConsumed}  ×${Math.round(res.zealFactor * 100) / 100}`,
        color: COLORS.zeal, eqMul: res.zealFactor,
      }]);
    }

    // THE CASCADE LEDGER: what fired, in the order it fired, as plain data. The
    // point of the whole feature is that the row the player WATCHES climb is
    // the row that produced the number, and that is only provable if the
    // animation's own order can be read back.
    this._pulseLog = [];
    jobs.forEach(([a, job], i) => {
      this.time.delayedCall(startAt + i * this.spd(195), () => {
        this._pulseLog.push({
          i, id: a?.id ?? null,
          slot: job.slot ?? (a ? run.artifacts.indexOf(a) : -1),
          add: job.eqAdd ?? job.add ?? 0, mult: job.eqMul ?? job.mult ?? 1,
          text: job.text ?? null,
          // THE PASSIVE'S ROW, so a verification run can prove the chip swelled
          // on the beat the mult moved — and, just as importantly, that it did
          // not swell on a hand the passive sat out.
          passive: job.passive?.id ?? null,
          passiveAmount: job.passive?.amount ?? 0,
        });
        // ONE LADDER: the cascade used to restart its own ramp at 1.05 here,
        // which is what made a big hand sound like "rise, restart, rise".
        this.handTick('score_tick', { volume: 0.5 });
        if (job.passive) pulsePassive(this, job.passive.label, { color: job.passive.color });
        if (a) this.pulseArtifact(a, job);
        else if (job.zeal) this.zealPulse(job.zeal, res.zealFactor);
        if (job.eqAdd) this.eqAddMult(job.eqAdd);
        else if (job.eqMul) this.eqMulMult(job.eqMul);
        // Output scalers move the SCORE side instead — same beat, other half.
        if (job.eqMulScore) this.eqMulScore(job.eqMulScore);
        if (job.eqAddScore) this.eqAddScore(job.eqAddScore);
      });
    });
    return jobs.length;
  }

  /**
   * WHAT SHIELD ACTUALLY DOES, for the player's own pool.
   *
   * Every line is read off the code that runs, and two of them exist because
   * the honest answer is not the one a card game trains you to expect:
   *   · it does NOT decay at end of turn (nothing ticks player.shield down;
   *     only damage spends it, and only The Ancient Shield's `shieldMelts`
   *     wipes it — which is why that line is conditional)
   *   · it has NO cap (addShield is a bare +=)
   *   · poison and bleed never see it (damagePlayer is the only path that
   *     absorbs; the DoTs go straight to hp)
   *   · a new fight resets it to the opening plate (startFight zeroes it
   *     unless a relic grants keepShield, then re-plates from run.startShield)
   */
  shieldRuleText() {
    const lines = [
      'Damage hits SHIELD before your HP, point for point, and spends it.',
      'It does not decay between turns and it has no cap.',
      'POISON and BLEED go straight through it.',
    ];
    if (this.prop('shieldMelts') > 0) lines.push('MELTS: your shield is wiped at the end of every enemy turn.');
    if (this.shatterguard) lines.push('SHATTERED: every point of shield you gain this fight is worth 0.');
    if (this.pstat?.brittle > 0) lines.push('BRITTLE: incoming damage is raised BEFORE shield sees it.');
    lines.push('A new fight starts you back on your opening plate.');
    return lines.join('\n');
  }

  /** ...and for a body on the other side of the arena. */
  enemyShieldRuleText() {
    const lines = [
      'Damage hits SHIELD before its HP, point for point, and spends it.',
      'It does not decay. Only damage takes it down.',
    ];
    if (this.chr?.id === 'venomancer') lines.push('Your POISON is read before the plate and seeps through it.');
    return lines.join('\n');
  }

  /** The shield chip over a body: hover either half of it for the rule. */
  bindShieldChipTip(enemy) {
    for (const part of [enemy.shieldIcon, enemy.shieldText]) {
      if (!part || part.input) continue;
      part.setInteractive();
      // The chip is drawn at alpha 0 until the body actually plates itself, so
      // the guard is what stops an invisible glyph answering a hover.
      part.on('pointerover', () => {
        if (!(enemy.shield > 0) || !enemy.alive) return;
        this.showRuleTip(part.x, part.y - 22, `SHIELD  ◆ ${enemy.shield}`, this.enemyShieldRuleText());
      });
      part.on('pointerout', () => this.hideIntentTip());
    }
  }

  /**
   * A plain parchment rule panel — a title and a block of text, bottom edge at
   * (x, y), clamped on screen. Same slot as every other hover in this scene
   * (`this.intentTip`), so one hideIntentTip closes whichever is open.
   */
  showRuleTip(x, y, title, body) {
    this.hideIntentTip();
    const tip = this.add.container(0, 0).setDepth(DEPTH.overlay + 3);
    const t = this.add.text(0, 0, title, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.text,
    }).setOrigin(0.5, 0);
    const b = this.add.text(0, 30, body, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: 330 }, align: 'center', lineSpacing: 3,
    }).setOrigin(0.5, 0);
    const h = 30 + b.height + 26;
    const w = Math.max(t.width, b.width) + 44;
    const parts = woodPanel(this, 0, h / 2 - 6, w, h, { shadow: true });
    tip.add([parts.shadow, parts.panel, t, b]);
    tip.setPosition(
      Phaser.Math.Clamp(x, w / 2 + 8, GAME_W - w / 2 - 8),
      Phaser.Math.Clamp(y - h - 10, 10, GAME_H - h - 10),
    );
    this.intentTip = tip;
    return tip;
  }

  // =========================================================================
  // WHAT A RELIC SAYS, WRITTEN ONCE (2026-08-10)
  // -------------------------------------------------------------------------
  // There are two surfaces that print a relic's rules now — the hover tooltip
  // (showArtifactTip) and the TOUCH build's choice box (relicBoxSpec) — and a
  // player who long-presses a relic and then taps it must not be told two
  // different things about it. So the three paragraphs are built HERE and both
  // surfaces read them. Adding a fourth line is one edit, in one place.
  // =========================================================================

  /** The rules, plus the running total every scaler answers with. */
  artifactBodyText(art) {
    const live = artifactLiveLine(art, run);
    return personalize(art.desc) + (live ? `\n\n${live}` : '');
  }

  /**
   * The one extra line, at most: the mirror's verdict (which names the relic it
   * is pointed at either way) or an active relic's charge state. No relic is
   * both — actives are uncopyable.
   *
   * PARCHMENT INKS, not the dark-UI pastels. This line lives inside a cream
   * panel, where #8fe098 / #ff8590 / #b8ada0 / #ffd23e all sit near 1:1. Same
   * four meanings, said in colours that survive the ground they are on.
   */
  artifactNoteLine(art) {
    const mn = mirrorNote(art);
    if (mn) return { text: mn.text, color: mn.ok ? '#2f7a4a' : '#a8202e' };
    if (!art.active) return null;
    if (this.activeSpent(art)) return { text: '✓ already used this fight', color: '#6b6055' };
    const label = art.active.label ?? 'USE';
    // On TOUCH the tag no longer FIRES — it opens the relic's box, and the box
    // carries the button that does. The sentence has to describe the surface
    // the player is actually holding.
    return {
      text: say(`▶ CLICK THE ${label} TAG. Once per fight.`,
        `▶ TAP IT, then ${label}. Once per fight.`),
      color: '#8a5a00',
    };
  }

  /**
   * THE CHAIN. Where this relic sits in the row is part of what it does, so
   * every relic says so, and says how to change it.
   */
  artifactOrderLine(art) {
    const belt = beltArtifacts();
    const slot = belt.indexOf(art);
    if (slot < 0) return null;
    return `#${slot + 1} of ${belt.length} · relics resolve left to right. `
      + say(`Drag to reorder, click to sell for ◉ ${sellValue(art)}.`,
        `Drag to reorder, tap to read or sell (◉ ${sellValue(art)}).`);
  }

  /**
   * THE RELIC'S CHOICE BOX (TOUCH only) — the ONE surface that replaced three.
   *
   * Before this, a relic on the phone answered a tap in three different places
   * with three different rules: the belt icon opened the sell confirm on
   * pointerUP, the glove nook opened it on pointerUP with no hold guard at all
   * (so a long-press that read the tooltip ALSO opened the sell panel behind
   * it), and the USE tag fired the active outright on pointerDOWN. Now all
   * three open this, and nothing commits until a labelled button is pressed.
   *
   * `anchor` is a function so a relic mid-settle reports where it actually is.
   */
  relicBoxSpec(art, anchor) {
    const rar = ARTIFACT_RARITY[art.rarity] ?? { label: '', color: 0xd8c49a };
    return {
      key: `relic:${art.id}`,
      anchor,
      title: `${art.name}  ·  ${rar.label}`,
      body: () => this.artifactBodyText(art),
      note: () => {
        const n = this.artifactNoteLine(art);
        return [n?.text, this.artifactOrderLine(art)].filter(Boolean).join('\n');
      },
      accent: rar.color,
      depth: DEPTH.overlay + 6,
      buttons: () => [
        art.active && {
          label: (art.active.label ?? 'USE').toUpperCase(),
          kind: 'go',
          onClick: () => this.useActiveArtifact(art),
          // A spent charge still DRAWS its button — "you have already used
          // this" is information, and a missing button is not.
          enabled: !this.activeSpent(art) && !this.busy,
        },
        {
          label: `SELL ◉${sellValue(art)}`,
          kind: 'buy',
          // sellPromptInFight stays the final are-you-sure. It is the existing
          // three-way confirm, it is good, and a Legendary should cost two
          // deliberate taps and a yes.
          onClick: () => this.sellPromptInFight(art),
          enabled: !this.busy,
        },
      ].filter(Boolean),
    };
  }

  /** The live box anchor for a relic icon (or its USE tag, which shares one). */
  relicAnchor(icon) {
    return () => ({ x: icon.x, y: icon.y, w: icon.displayWidth, h: icon.displayHeight });
  }

  showArtifactTip(x, y, art) {
    this.hideIntentTip();
    const tip = this.add.container(0, 0).setDepth(DEPTH.overlay + 3);
    const rar = ARTIFACT_RARITY[art.rarity];
    // The rarity colours are tuned for a DARK ground; this panel is cream, and a
    // COMMON's near-white #dadada on it is a blank line. Outlined the way the
    // map's sell panel already outlines the same colours on the same parchment.
    const title = legible(this.add.text(0, 0, art.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.tipTitle}px`,
      color: '#' + rar.color.toString(16).padStart(6, '0'),
    }), { shadow: false }).setOrigin(0.5, 0);
    // A HERO EXCLUSIVE names itself in cycling rainbow, here as everywhere.
    if (rar.rainbow) rainbowText(this, title);
    // THE RULES, then THE RUNNING TOTAL. Every scaler answers liveDesc(), so a
    // Kingmaker reads "+12 mult (12 Kings crowned)" right under its own rules
    // instead of leaving the player to count kings in their head. Built by
    // artifactBodyText, which is also what the TOUCH box prints.
    const body = this.add.text(0, 28, this.artifactBodyText(art), {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: `${CHROME.tipBody}px`,
      color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: CHROME.tipWrap }, align: 'center', lineSpacing: 3,
    }).setOrigin(0.5, 0);
    const note = this.artifactNoteLine(art);
    const warn = note ? this.add.text(0, 28 + body.height + 8, note.text, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: `${CHROME.tipNote}px`,
      color: note.color, fontStyle: 'bold',
      wordWrap: { width: CHROME.tipWrap }, align: 'center',
    }).setOrigin(0.5, 0) : null;
    const orderLine = this.artifactOrderLine(art);
    const orderY = 28 + body.height + (warn ? warn.height + 8 : 0) + 8;
    const order = orderLine ? this.add.text(0, orderY, orderLine, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: `${CHROME.tipOrder}px`,
      color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: CHROME.tipWrap }, align: 'center',
    }).setOrigin(0.5, 0) : null;
    const h = 28 + body.height + (warn ? warn.height + 8 : 0) + (order ? order.height + 8 : 0) + 26;
    const w = Math.max(title.width, body.width, warn?.width ?? 0, order?.width ?? 0) + 44;
    const parts = woodPanel(this, 0, h / 2 - 6, w, h, { shadow: true });
    tip.add([parts.shadow, parts.panel, title, body]);
    if (warn) tip.add(warn);
    if (order) tip.add(order);
    tip.setPosition(Math.max(w / 2 + 8, x), y - h - 40);
    this.intentTip = tip;
  }

  // ---------------- Hero portrait reactions ----------------
  heroHit() {
    this.heroSprite.setTintFill(0xff5a5a);
    this.time.delayedCall(130, () => this.heroSprite.clearTint());
    this.tweens.add({
      targets: this.heroSprite, x: this.heroHome.x - 16, angle: -5,
      duration: 70, yoyo: true, repeat: 1, ease: 'Sine.easeInOut',
      onComplete: () => this.heroSprite.setPosition(this.heroHome.x, this.heroHome.y).setAngle(0),
    });
    this.heroPulse(0xff4040, 0.5);
  }

  heroShield() {
    this.heroPulse(0x40c8f0, 0.55);
    this.tweens.add({ targets: this.heroSprite, scale: 0.315, duration: 110, yoyo: true, ease: 'Sine.easeOut' });
  }

  heroHeal() {
    this.heroPulse(0x50e090, 0.5);
    const s = this.add.image(this.heroHome.x, this.heroHome.y + 40, 'fx_star')
      .setTint(0x80ffb0).setScale(0.15).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.panel + 2);
    this.tweens.add({ targets: s, y: this.heroHome.y - 90, alpha: 0, scale: 0.3, duration: 800, onComplete: () => s.destroy() });
  }

  heroDebuff(color) {
    this.heroSprite.setTint(color);
    this.time.delayedCall(260, () => this.heroSprite.clearTint());
    this.heroPulse(color, 0.5);
    this.tweens.add({ targets: this.heroSprite, angle: { from: -3, to: 3 }, duration: 70, yoyo: true, repeat: 2, onComplete: () => this.heroSprite.setAngle(0) });
  }

  heroPulse(color, alpha) {
    this.heroFX.setTint(color).setAlpha(alpha);
    this.tweens.add({ targets: this.heroFX, alpha: 0, scale: { from: 1.7, to: 1.4 }, duration: 480 });
  }

  /**
   * THE ZEAL DISCHARGE. Zelus's battery empties into the blow: the sidebar
   * readout flares and snaps back, gold washes over the hero, and the spend is
   * named over the arena so the ×N on the mult side has an author.
   */
  zealPulse(spent, factor) {
    sfx(this, 'heal', { volume: 0.6, rate: 1.35 });
    this.heroPulse(0xffd166, 0.85);
    const pct = Math.round((factor - 1) * 100);
    if (this.resourceText?.active) {
      this.tweens.killTweensOf(this.resourceText);
      // The flare colour is PALE GOLD and the sidebar under it is cream, so the
      // readout used to disappear at the exact moment it is meant to be read.
      // The outline goes on with the colour and comes off with it.
      this.resourceText.setScale(1.55).setColor(COLORS.zeal).setStroke(INK_DARK, 4);
      this.tweens.add({
        targets: this.resourceText, scale: 1, duration: this.spd(360), ease: 'Back.easeOut',
        onComplete: () => this.resourceText?.active
          && this.resourceText.setColor(PARCH.accent).setStroke(INK_DARK, 0),
      });
    }
    popMessage(this, ARENA_CX, 268,
      `ZEAL SPENT: ${spent} × ${Math.round(ZEAL_DAMAGE_PCT * 100)}% = +${pct}% DAMAGE`,
      { color: COLORS.zeal, size: 32 });
    burst(this, SIDEBAR_W / 2, 380, 0xffd166, 14);
  }

  // ---------------- Artifact-facing helpers (hooks call these) ----------------

  /**
   * PILGRIM'S FLASK. Healing you cannot HOLD becomes chips, 1 for 1, capped per
   * FIGHT. `amount` is what was offered and `applied` is what the HP bar
   * actually took, so the waste is simply the difference and the flask never
   * has to know where the heal came from.
   *
   * THE ZEALOT IS OUT, and it is a deliberate ruling (it is the def's own, in
   * artifacts.js): his overheal banks as ZEAL, which is his entire kit. It is
   * not WASTED healing, it is his resource — and since zealCapFor took the
   * ceiling off there is nothing left over for the flask to catch anyway. So
   * the relic is dead weight in his hands rather than a second engine bolted
   * onto the one he already has.
   *
   * @returns {number} chips actually paid.
   */
  catchOverheal(amount, applied) {
    if (this.prop('overhealChips') <= 0) return 0;
    const waste = Math.max(0, Math.round((amount ?? 0) - (applied ?? 0)));
    if (waste <= 0) return 0;
    if (this.chr.id === 'zealot') return 0;
    let paid = 0;
    // PER HOLDER, per fight: a mirrored flask catches its own twenty, banks its
    // own ledger and its tooltip reads its own number, exactly like every other
    // capped scaler in the pool.
    for (const a of this.propHolders('overhealChips')) {
      const room = Math.max(0, (a.props.overhealChipCap ?? 0) - (a.state.fight ?? 0));
      const take = Math.min(room, waste * a.props.overhealChips);
      if (take <= 0) continue;
      a.state.fight = (a.state.fight ?? 0) + take;
      const got = this.gainChips(take, 'FLASK');
      a.state.paid = (a.state.paid ?? 0) + got;
      paid += got;
    }
    return paid;
  }

  healPlayer(amount, { quiet = false } = {}) {
    const missing = this.player.maxHp - this.player.hp;
    const applied = Math.min(amount, missing);
    // THE FLASK'S FIRST DOOR. Asked BEFORE the early return below, because a
    // heal that lands entirely on a full bar is the exact case the relic exists
    // for and `applied <= 0` is what that looks like. (The second door is the
    // hearts hand in resolveHand, which deliberately does not route through
    // healPlayer — see the note there.)
    this.catchOverheal(amount, Math.max(0, applied));
    if (applied <= 0) return;
    this.player.hp += applied;
    if (!quiet) { sfx(this, 'heal', { volume: 0.7 }); this.heroHeal(); }
    popNumber(this, SIDEBAR_W / 2, 300, `+${applied}`, { color: '#37d6a0', size: quiet ? 26 : 32, delay: quiet ? 250 : 0 });
    // REFLECTION (THE MOONWELL HORROR). Every point you heal, it heals — and it
    // is answered HERE, at the one door every point of healing in the game comes
    // through, so a relic's sip, a potion, a Blood Seal and a hearts hand all
    // feed it identically and nothing has to be special-cased.
    this.reflectHeal(applied);
    this.refreshAll();
  }

  /** ...and the mirror itself. Silent when nothing on the field owns one. */
  reflectHeal(applied) {
    const mirrors = this.livingEnemies().filter(e => e.healMirror);
    if (!mirrors.length || applied <= 0) return 0;
    let total = 0;
    for (const e of mirrors) {
      const back = healMirrorAmount(applied);
      if (back <= 0) continue;
      e.hp = Math.min(e.maxHp, e.hp + back);
      total += back;
      popNumber(this, e.homeX, e.homeY - 130, `+${fmtNum(back)}`, { color: '#aebeff', size: 32 });
      this.floatText(e, 'REFLECTION', '#aebeff');
    }
    return total;
  }

  /**
   * Every in-fight chip gain comes through here (score chips, interest, ALL IN,
   * DIVINITY, the elite bounty, the victory purse); gainGold is the one place
   * the DEV GOLD slider and the chip-gain relics land.
   * @returns {number} what was ACTUALLY credited, post-relics, post-slider.
   */
  gainChips(amount, label = null, { quiet = false, silent = false } = {}) {
    const paid = gainGold(amount);
    if (!quiet) sfx(this, 'chips_stack', { volume: 0.7 });
    // `silent` = the caller is drawing its own theatre (the victory tally) and
    // does not want a second number popping out of the sidebar over the top.
    if (!silent) {
      popNumber(this, 110, 528 + 150, `+${paid}${label ? '  ' + label : ''}`,
        { color: '#ffc542', size: quiet ? 22 : 28 });
    }
    this.refreshAll();
    return paid;
  }

  /**
   * The mid-fight informational line: a popMessage pinned to the arena centre.
   * It hangs for MSG_HOLD (double a plain number pop) because these have words
   * in them and the friend playtest kept missing them.
   */
  announce(text, color = '#ffc542') {
    popMessage(this, ARENA_CX, 300, text, { color, size: 38, rise: 60 });
  }

  /**
   * THE BIG MESSAGE — the "hands left" treatment, factored out because JC loves
   * it and wants it on anything the player must not miss: raw text (never a
   * pop), roughly double size, a real drop shadow, and a 3x hang time.
   *
   * @param {string} msg
   * @param {string} color css
   * @param {number} size  font px
   * @param {number} hold  ms at full size before it floats off (3000 = the
   *                       shipped hands-left hold, which IS the 3x)
   * @param {number} y     baseline
   */
  bigMessage(msg, color, size, hold = 3000, y = 292) {
    const t = this.add.text(ARENA_CX, y, msg, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`, color,
      stroke: '#241505', strokeThickness: Math.round(size / 9),
      wordWrap: { width: GAME_W - SIDEBAR_W - 160 }, align: 'center',
    }).setOrigin(0.5).setDepth(DEPTH.fx + 3).setAlpha(0).setScale(0.6);
    t.setShadow(0, 6, '#000000', 14, true, true);
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 240, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: t, alpha: 0, y: y - 40, duration: BIG_MSG_FADE, delay: hold,
      ease: 'Sine.easeIn', onComplete: () => t.destroy(),
    });
    return t;
  }

  /**
   * A boss's SIGNATURE MECHANIC, announced at the opening bell. These used to be
   * ordinary announce() pops that were gone in under a second — the one line in
   * the fight that tells you what the rules are now, and it flashed past. They
   * get the big-message treatment and the full 3x hold.
   */
  bossBlurb(text, color) {
    return this.bigMessage(text, color, 58, BLURB_HOLD, 286);
  }

  /** A worded call-out over an enemy — always a MESSAGE, never a bare number. */
  floatText(enemy, text, color) {
    popMessage(this, enemy.homeX, enemy.homeY - 150, text, { color, size: 28 });
  }

  // =========================================================================
  // OPHELIA'S CONVERSION (JC, 2026-08-01 overhaul)
  // -------------------------------------------------------------------------
  // 'Half the damage she deals seeps in as POISON.' Per DAMAGE EVENT, not per
  // hand: a hand that strikes three times and splashes onto two more bodies
  // poisons all of them, each for half of what THAT blow carried. Damage is
  // read pre-shield (poison ignores plate) and after the immunity gate (the
  // Depth Knight's void shell takes nothing at all, venom included).
  // =========================================================================

  /**
   * Fraction of her damage that ALSO lands as poison. 0 for everyone else.
   *
   * NOTHING IS CONVERTED (JC, 0803): damageEnemy deals the blow in full and
   * seeps this fraction on TOP of it, so at 1.0 (base half + the Bottomless
   * Vile's other half) a club still hits for everything it is worth and puts
   * the same number on the body as venom. The name is historical; the
   * arithmetic has always been additive and the copy now says so.
   */
  poisonConversion() {
    if (this.chr.id !== 'venomancer') return 0;
    // Base half + the Bottomless Vile's other half + Cruel Sting's quarter.
    return POISON_CONVERSION + this.prop('poisonConvert');
  }

  /**
   * Where Zelus's battery stops: NOWHERE, since 2026-08-04. The ceiling came
   * off for everyone (JC: "we change zeal to be uncapped all the time"), so
   * this simply relays scoring's one authority.
   */
  zealCap() { return zealCapFor(); }

  /** Put `stacks` of poison on one body, with its own little float. */
  applyPoison(enemy, stacks, color = AOE_COLOR) {
    if (!enemy?.alive || !(stacks > 0)) return 0;
    enemy.statuses.poison = (enemy.statuses.poison ?? 0) + stacks;
    // Batched: a six-blow hand would otherwise stack six identical floats on
    // one head. Everything that lands inside the same beat is announced once.
    enemy._seepPending = (enemy._seepPending ?? 0) + stacks;
    if (!enemy._seepTimer) {
      enemy._seepTimer = this.time.delayedCall(110, () => {
        const n = enemy._seepPending ?? 0;
        enemy._seepPending = 0;
        enemy._seepTimer = null;
        // Beside the body rather than over its nameplate: the damage number
        // already owns the column above the sprite, and the venom is a second
        // sentence about the same blow, not a competing headline.
        if (n > 0 && enemy.alive) {
          popMessage(this, enemy.homeX + 104, enemy.homeY - 52, `☠ +${fmtNum(n)}`,
            { color, size: 30 });
          // ...and the chip on the health bar swells to say the total moved.
          const chip = enemy.statusUI?.poison;
          if (chip?.icon?.active) {
            chip.text.setText(`${fmtNum(enemy.statuses.poison ?? 0)}`);
            chip.icon.setAlpha(1); chip.text.setAlpha(1);
            this.tweens.add({ targets: [chip.icon, chip.text], scale: '*=1.35', duration: 130, yoyo: true, ease: 'Back.easeOut' });
          }
        }
      });
    }
    this.notePoisonPeak();
    return stacks;
  }

  /** One damage event's worth of seepage. Returns the stacks applied. */
  seepPoison(enemy, amount) {
    const rate = this.poisonConversion();
    if (rate <= 0 || !(amount > 0) || !enemy?.alive) return 0;
    const stacks = Math.round(amount * rate);
    if (stacks <= 0) return 0;
    this.applyPoison(enemy, stacks);
    // OPHELIA'S CHIP TAKES ITS BOW HERE, and only here. Her passive is the one
    // of the five that is not arithmetic in the equation at all — it is an
    // event, fired per damage event, long after eqSlam — so the attribution is
    // measured off the stacks that were ACTUALLY applied rather than predicted
    // from the hand. A blow that seeps nothing (a pure heal, a fully-gated
    // strike) leaves the chip still, which is the whole contract.
    const pa = passiveAttribution(run.chrId, null, { poisonSeep: stacks });
    if (pa) pulsePassive(this, pa.label, { color: pa.color });
    // STORMCALLER'S IDOL (Ophelia only): the storm carries every drop of it to
    // every other body in the room, at full stacks.
    if (this.prop('poisonSpread') > 0) {
      const others = this.livingEnemies().filter(e => e !== enemy);
      if (others.length) {
        this.pulseByProp('poisonSpread', 'THE STORM CARRIES IT', '#5878e8');
        for (const o of others) this.applyPoison(o, stacks, '#9ab4ff');
      }
    }
    return stacks;
  }

  /**
   * CROWN OF THE HIGH ROLLER. The opening lone Ace is crowned: a second copy of
   * it is struck into the RUN DECK with a fresh id, permanently. It also lands
   * in this fight's draw pile, because a crown you cannot spend is a paperweight.
   */
  crownTheAce(cs) {
    const src = cs.card;
    const copy = { ...src, id: `${src.id}#crown${run.runDeck.length}${Date.now() % 9973}` };
    run.runDeck.push(copy);
    this.deck.push(copy);
    sfx(this, 'minor_upgrade', { volume: 0.9 });
    this.announce('THE CROWN DOUBLES IT: that Ace is yours forever', '#ffc542');
    if (cs.active) {
      burst(this, cs.x, cs.y, 0xffc542, 18);
      popMessage(this, cs.x, cs.y - 130, '+1 ACE', { color: '#ffc542', size: 30 });
    }
    this.refreshAll();
  }

  // ---------------- MYTHICALS: the active relics + the eternal forge ----------

  /**
   * THE HUSHED BELL (once per fight). One toll and the target's next action is
   * cancelled OUTRIGHT — attacks, summons, wards, buffs, and the Depth Knight's
   * end-of-turn morph with them. Bosses are not exempt; that is the whole point.
   *
   * Rulings: the turn is LOST, not re-queued — the intent pointer does not
   * advance, so the same telegraph comes back next turn (and the Depth Knight's
   * derived form can never desync from what he is showing you). Poison still
   * ticks on a silenced enemy (that is the round's own upkeep, not their turn);
   * bleed does not, because bleed only opens when they move. No living target,
   * or a target already silenced, REFUSES — and a refusal costs no charge.
   */
  useHushedBell(a) {
    const tgt = this.target;
    if (!tgt?.alive) {
      popMessage(this, ARENA_CX, 300, 'THE BELL FINDS NO ONE', { color: '#9adcff', size: 32 });
      return false;
    }
    if (!silenceEnemy(tgt)) return false;

    // A muffling toll: the deep stop of frozen_placed dropped to a bell's
    // register, and fear_placed's hush layered a beat behind it.
    sfx(this, 'frozen_placed', { volume: 0.95, rate: 0.6 });
    this.time.delayedCall(130, () => sfx(this, 'fear_placed', { volume: 0.45, rate: 0.72 }));
    shake(this, 0.004, 260);
    for (let k = 0; k < 3; k++) {
      const ring = this.add.image(tgt.homeX, tgt.homeY - 20, 'fx_glow_circle')
        .setTint(0x9adcff).setAlpha(0).setScale(0.25)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
      this.tweens.add({
        targets: ring, alpha: { from: 0.7, to: 0 }, scale: 1.5,
        duration: 720, delay: k * 170, ease: 'Sine.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
    tgt.sprite.setTint(0x9adcff);
    this.time.delayedCall(420, () => { if (tgt.alive) tgt.sprite.clearTint(); });
    popMessage(this, tgt.homeX, tgt.homeY - 150, 'SILENCED', { color: '#9adcff', size: 44 });
    // No emoji here on purpose — half the display fonts we ship have no bell
    // glyph, and a tofu box on a mythical is worse than plain lettering.
    this.pulseArtifact(a, { text: 'TOLL', color: '#9adcff' });
    this.refreshAll();
    return true;
  }

  /** A silenced enemy's turn: nothing happens, loudly. */
  silencedTurn(enemy) {
    consumeSilence(enemy);
    sfx(this, 'frozen_placed', { volume: 0.5, rate: 0.85 });
    popMessage(this, enemy.homeX, enemy.homeY - 130, 'SILENCED: no action', { color: '#9adcff', size: 30 });
    this.tweens.add({
      targets: enemy.sprite, angle: { from: -2, to: 2 }, duration: 90,
      yoyo: true, repeat: 2, onComplete: () => enemy.sprite.setAngle(0),
    });
    this.refreshAll();
  }

  /**
   * WHEEL OF DIVINITY (once per fight). Five uniform wedges on the real wheel;
   * four of them are gifts and one of them eats a card out of the run forever.
   */
  useWheelOfDivinity(a) {
    const segs = WHEEL_OF_DIVINITY_WEDGES.map(w => ({ label: w.label, color: w.color }));
    // DEV: __hfCombat.forceDivinity(4) pins the wedge for a verification run.
    const land = this._divinityForce != null
      ? Phaser.Math.Clamp(this._divinityForce, 0, segs.length - 1)
      : Math.floor(Math.random() * segs.length);
    this.busy = true;
    this.setPlayEnabled(false);
    wheelSpinOverlay(this, segs, land, () => {
      this.busy = false;
      this.resolveDivinity(a, WHEEL_OF_DIVINITY_WEDGES[land].id);
      this.refreshAll();
    }, { fontSize: 20, labelFrac: 0.58 });
    return true;
  }

  /** What the wheel left behind. One of five, all of them immediate. */
  resolveDivinity(a, id) {
    this._lastDivinity = id;   // verification hook (__hfCombat.activeState)
    switch (id) {
      case 'chips':
        this.gainChips(50, 'DIVINITY');
        this.announce('DIVINE FORTUNE: +50 chips', '#ffc542');
        break;
      case 'handSize':
        this.tempHandSize = (this.tempHandSize || 0) + 1;
        this.announce('DIVINE REACH: +1 hand size this fight', '#6fdc7f');
        sfx(this, 'card_deal', { volume: 0.7 });
        this.dealToHandSize(() => this.refreshAll());
        break;
      case 'doubleMult':
        this.wheelNextMult = { a, factor: 2 };
        this.announce('DIVINE WRATH: ×2 mult on your next hand', '#ff7a3c');
        break;
      case 'retrigger':
        this.wheelNextRepeat = { a, factor: 2 };
        this.announce('DIVINE ECHO: every card retriggers next hand', '#7fa8ff');
        break;
      case 'destroy': {
        const victim = this.handCards?.length ? Phaser.Utils.Array.GetRandom(this.handCards) : null;
        if (!victim) {
          this.announce('DIVINE HUNGER: your hand is empty', '#ff5060');
          break;
        }
        this.announce('DIVINE HUNGER: the wheel eats a card', '#ff5060');
        // The wheel can eat the very card the gaze was holding — drop the
        // reference before the sprite dies, or releaseHypnoCard talks to a ghost.
        if (victim === this.hypnoCard) this.hypnoCard = null;
        this.slicedCards = (this.slicedCards ?? []).filter(c => c.id !== victim.card.id);
        this.burnCardForever(victim.card);
        this.shatterCard(victim);
        this.time.delayedCall(this.spd(420), () => this.layoutHand());
        break;
      }
    }
    this.pulseArtifact(a, { text: 'THE WHEEL', color: '#ffd23e' });
    this.updatePreview();
  }

  /**
   * THE FORGE ETERNAL. The first hand of every fight is beaten one level deeper
   * on the eternal anvil — a real Smith level in run.handLevels, permanent for
   * the run. It lands AFTER the hand it was earned by is committed, so that hand
   * scores at its old level and every play from here on (this fight included)
   * gets the new one — exactly how a tempering bought at the Smith behaves.
   */
  forgeEternalTemper(a, type) {
    if (!type) return;
    run.handLevels[type] = (run.handLevels[type] ?? 0) + 1;
    const lvl = run.handLevels[type] + 1;   // levels are 0-based; the chart is not
    const name = (HAND_DEFS[type]?.name ?? type).toUpperCase();
    this.time.delayedCall(this.spd(160), () => {
      sfx(this, 'pack_open_smith', { volume: 0.75 });
      this.time.delayedCall(120, () => sfx(this, 'minor_upgrade', { volume: 0.8, rate: 1.05 }));
      this.announce(`THE FORGE ETERNAL: ${name} Lv.${lvl}`, '#ff7028');
      burst(this, ARENA_CX, 300, 0xff7028, 14);
      this.pulseArtifact(a, { text: `Lv.${lvl}`, color: '#ff7028' });
    });
  }

  // =========================================================================
  // NIGHT 0802 RELICS — the four that need the scene to do something.
  // =========================================================================

  /** Bank onto an owned relic's ledger (artifacts.js's bank(), scene-side). */
  bankArt(a, key, n = 1) { if (a?.state) a.state[key] = (a.state[key] ?? 0) + n; }

  /**
   * THE SLOT BUTTON. One pull per fight: a straight coin flip for
   * SLOT_BUTTON_CHIPS. The win routes through gainChips (so the chip-gain
   * relics and the difficulty's gold factor both apply, exactly like every
   * other payout); the loss does NOT route through gainGold — spending never
   * does — and it FLOORS AT ZERO, so the machine can clean you out and never
   * take a chip more than you had.
   *
   * Never refuses: there is always something to gamble, even at 0 chips (the
   * loss is simply worth nothing, which is its own small mercy).
   */
  useSlotButton(a) {
    // DEV: __hfCombat.forceSlot(true|false) pins the flip for a verification run.
    const win = this._slotForce != null ? !!this._slotForce : Math.random() < 0.5;
    sfx(this, 'chips_stack', { volume: 0.5, rate: 1.35 });
    if (win) {
      const paid = this.gainChips(SLOT_BUTTON_CHIPS, 'JACKPOT');
      this.bankArt(a, 'won'); this.bankArt(a, 'net', paid);
      if (a?.state) a.state.streak = 0;   // THE HOUSE ALWAYS WINS: the run breaks
      this.announce(`THE MACHINE PAYS. +${paid} chips`, '#ffd23e');
      burst(this, ARENA_CX, 320, 0xffd23e, 22);
      shake(this, 0.004, 220);
    } else {
      const lost = Math.min(SLOT_BUTTON_CHIPS, run.chips);
      run.chips = Math.max(0, run.chips - SLOT_BUTTON_CHIPS);
      this.bankArt(a, 'lost'); this.bankArt(a, 'net', -lost);
      // THE HOUSE ALWAYS WINS keeps a losing STREAK and its high-water mark:
      // `streak` is the run of losses you are on now, `worstStreak` the worst
      // one this machine ever put you through. Two lines on a once-per-fight
      // button press, which is as far from a hot path as the game gets.
      if (a?.state) {
        a.state.streak = (a.state.streak ?? 0) + 1;
        a.state.worstStreak = Math.max(a.state.worstStreak ?? 0, a.state.streak);
      }
      sfx(this, 'poison', { volume: 0.6, rate: 0.8 });
      this.announce(lost > 0 ? `THE MACHINE TAKES ${lost} chips` : 'THE MACHINE TAKES NOTHING. You had nothing.', '#ff5060');
      burst(this, ARENA_CX, 320, 0x8a1830, 16);
    }
    this._lastSlot = { win, chips: run.chips };
    // PROBLEM GAMBLER / THE HOUSE ALWAYS WINS both read the ledger this pull
    // just wrote, so sweep the state trophies while the button is still warm.
    fireAchievements(this, 'state', { run });
    this.pulseArtifact(a, { text: win ? `+${SLOT_BUTTON_CHIPS}` : `-${SLOT_BUTTON_CHIPS}`, color: win ? '#ffd23e' : '#ff5060' });
    this.refreshAll();
    return true;
  }

  /**
   * PROSPECTOR'S PAN. One card came out of the gravel shining. The wrap is set
   * on the card object itself — the fight's draw pile holds the same references
   * the run deck does — and on the run-deck entry by id as well, because every
   * other permanent card edit in this file does exactly that and a card that
   * only half-persists is a bug waiting for a shuffle.
   *
   * The sprite is deliberately NOT rebuilt here: this fires inside handCommit,
   * with the played sprites still mid-flight to the play row and `played` still
   * holding references to them. The foil shows the next time the card is dealt.
   */
  strikeShiny(card, a) {
    card.wrap = 'shiny';
    const deckCard = run.runDeck.find(c => c.id === card.id);
    if (deckCard) deckCard.wrap = 'shiny';
    this.time.delayedCall(this.spd(420), () => {
      sfx(this, 'minor_upgrade', { volume: 0.9, rate: 1.15 });
      this.announce('THE PAN CATCHES ONE. That card is SHINY, forever.', '#bfd8ff');
      burst(this, ARENA_CX, 320, 0xbfd8ff, 18);
      this.pulseArtifact(a, { text: 'SHINY', color: '#bfd8ff' });
    });
  }

  /**
   * THE LUCKY STAMPER caught one. The Pan's shape exactly, one layer over: the
   * card takes a SEAL instead of a wrapper, on the live card and on the run deck
   * behind it, so it is permanent rather than rented for the hand.
   *
   * The relic chose the seal (it rolls over the STAMPS table, so a seal added
   * later joins the bag for free); the scene only says so.
   */
  strikeStamp(card, a, stampId) {
    const def = STAMPS[stampId];
    if (!def) return;
    card.stamp = stampId;
    const deckCard = run.runDeck.find(c => c.id === card.id);
    if (deckCard) deckCard.stamp = stampId;
    this.time.delayedCall(this.spd(420), () => {
      sfx(this, 'minor_upgrade', { volume: 0.9, rate: 1.05 });
      this.announce(`THE STAMPER LANDS. That card carries a ${def.label}, forever.`, def.color);
      burst(this, ARENA_CX, 320, def.tint, 18);
      this.pulseArtifact(a, { text: 'SEALED', color: def.color });
    });
  }

  /**
   * THE POTATO'S SECRET pays off. Everything about the relic changes in place
   * (name, description, icon, tint, art key and mods), the belt repaints, and
   * the player finds out the only way the secret allows: by having held it.
   */
  turnPotatoGolden(a) {
    becomeGoldenSpud(a);
    this.onBeltChanged?.();
    this.time.delayedCall(this.spd(300), () => {
      sfx(this, 'legendary_appears', { volume: 0.9 });
      this.cameras.main.flash(240, 140, 110, 30);
      burst(this, ARENA_CX, 320, 0xffd23e, 28);
      this.bigMessage(`THE GOLDEN SPUD\n+${GOLDEN_SPUD_VALUE} value`, '#ffd23e', 54, 2600);
      this.pulseArtifact(a, { text: `+${GOLDEN_SPUD_VALUE}`, color: '#ffd23e' });
    });
  }

  /**
   * A RELIC BECOMES SOMETHING ELSE, IN PLACE. THE SEEDLING blooms; SHIP IN A
   * BOTTLE raises a mast and eventually makes full sail. Both rewrite their own
   * instance (the artKey above all) and then need the mat to actually paint the
   * new picture — turnPotatoGolden's beat one size down, because the potato's
   * secret is a whole ceremony and a mast is a moment.
   */
  relicTransformed(a, message) {
    // THE MEMO SIGNATURE IS ID-ONLY and none of these transformations changes
    // an id, so without this null the mat would sit there painting the seed
    // while the relic underneath it was already in bloom.
    this._artifactSig = null;
    this.onBeltChanged?.();
    this.time.delayedCall(this.spd(300), () => {
      sfx(this, 'minor_upgrade', { volume: 0.85 });
      const icon = this.artifactIcons?.[run.artifacts.indexOf(a)];
      if (icon?.active) burst(this, icon.x, icon.y, 0xffd23e, 14);
      this.pulseArtifact(a, { text: message, color: '#ffd23e' });
    });
  }

  /**
   * THE GLASS GAVEL SHATTERS. A relic leaves the belt with NO PAYOUT, which is
   * exactly why this is not sellArtifactInFight: there is no sale here, no
   * chips, no receipt and no re-suiting to undo.
   *
   * onSell IS STILL CALLED. It is the one hook a relic uses to REVOKE what it
   * granted at pickup (a Discard, a hand slot, the Cracked Crown's chips), and
   * a gavel that shattered while its grant stayed behind would be a permanent
   * freebie you could buy on purpose. What the relic gave, it gives back — the
   * gavel takes the RELIC, not the honesty.
   *
   * @returns {boolean} true when a relic was actually taken off the belt.
   */
  shatterRelic(art) {
    const i = run.artifacts.indexOf(art);
    if (i < 0) return false;
    // The icon is about to be destroyed by the repaint below, so the ceremony
    // is played by a stand-in at the same spot: a tinted copy that cracks
    // outward while the real mat is already re-laying itself out underneath.
    const icon = this.artifactIcons?.[i];
    const at = icon?.active ? { x: icon.x, y: icon.y } : { x: SIDEBAR_W / 2, y: 380 };
    if (icon?.active) {
      const ghost = this.add.image(at.x, at.y, icon.texture.key)
        .setDisplaySize(icon.displayWidth, icon.displayHeight)
        .setTint(0xbfd8ff).setDepth(DEPTH.overlay);
      this.tweens.add({
        targets: ghost, scale: ghost.scale * 1.4, alpha: 0, angle: 14,
        duration: 320, ease: 'Cubic.easeIn', onComplete: () => ghost.destroy(),
      });
    }
    run.artifacts.splice(i, 1);
    try { art.onSell?.(run, art); }
    catch (e) { console.error(`gavel onSell ${art.id}`, e); }
    sfx(this, 'frozen_placed', { volume: 0.9, rate: 1.4 });
    sfx(this, 'card_deselect', { volume: 0.8, rate: 0.7 });
    burst(this, at.x, at.y, 0xbfd8ff, 18);
    popMessage(this, at.x, at.y - 40, 'THE GAVEL SHATTERS', { color: '#bfd8ff', size: 30 });
    // The memo signature is ID-ONLY. The splice does change the id list, but
    // nulling it first is what guarantees the repaint even when a second gavel
    // (or a mirror of one) leaves the list hashing the same as before.
    this._artifactSig = null;
    this.onBeltChanged();
    return true;
  }

  /**
   * THE HATCH. Queued by the egg's fightEnd hook (never performed there — see
   * queueHatch), presented here as its own beat before the rewards open, and
   * resolved IN THE SAME ROW POSITION: relics resolve left to right, so where
   * the egg stood is part of the build, not decoration.
   *
   * Walks the queue one egg at a time and calls `done` when the last shell is
   * off the mat. An empty queue is a straight passthrough.
   */
  runPendingHatches(done) {
    const queue = run.pendingHatch ?? [];
    if (!queue.length) return done();
    const entry = queue.shift();
    // `table` is the shipped shape; `mythicChance` is what saves written before
    // the egg ladder carry, and rollHatchDef reads either one.
    const def = rollHatchDef(run, entry.table ?? entry.mythicChance ?? 0);
    // The egg is still on the belt while the shell shakes — the SWAP happens on
    // the crack, inside the ceremony, so the row and the reveal move together.
    if (!def || !run.artifacts.some(a => a.id === entry.id)) return this.runPendingHatches(done);
    this.hatchCeremony(entry, def, () => this.runPendingHatches(done));
  }

  /** The shell cracks. One panel, one relic, one button. */
  hatchCeremony(entry, def, done) {
    const rar = ARTIFACT_RARITY[def.rarity] ?? ARTIFACT_RARITY.legendary;
    const rarCss = '#' + rar.color.toString(16).padStart(6, '0');
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay + 6);
    ov.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0c0810, 0.86).setInteractive());
    // 700 tall: a Legendary's rules text runs to three lines, and the button has
    // to clear it. Anything shorter and the description slides under the plate.
    const parts = woodPanel(this, GAME_W / 2, GAME_H / 2, 760, 700, { accent: rar.color });
    ov.add([parts.shadow, parts.panel, parts.line]);
    ov.add(this.add.text(GAME_W / 2, GAME_H / 2 - 276, 'IT HATCHED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '54px', color: PARCH.text,
    }).setOrigin(0.5));

    // The shell first: the egg the player has been carrying, shaking itself
    // apart. Then the thing that was inside it.
    const shell = addArtifactIcon(this, GAME_W / 2, GAME_H / 2 - 90, { id: entry.id, icon: 'icon_gem', tint: 0xf0e0c0 }, 200);
    ov.add(shell);
    sfx(this, 'card_hover', { volume: 0.5, rate: 0.7 });
    this.tweens.add({ targets: shell, angle: { from: -6, to: 6 }, duration: 90, yoyo: true, repeat: 7 });

    this.time.delayedCall(this.spd(900), () => {
      shell.destroy();
      // THE SWAP, on the beat. In place: the newborn takes the egg's index.
      const inst = hatchEgg(run, entry, def) ?? def;
      this._lastHatch = { from: entry.id, to: inst.id, rarity: inst.rarity, index: run.artifacts.indexOf(inst) };
      this.onBeltChanged?.();
      // The sting is the drop table's, not a guess: The Egg can now land a VERY
      // RARE as well as a Legendary, and each tier already has its own sound.
      sfx(this, DROP_SFX[inst.rarity] ?? 'minor_upgrade', { volume: 0.95 });
      burst(this, GAME_W / 2, GAME_H / 2 - 90, rar.color, 30);
      this.cameras.main.flash(200, 90, 70, 40);
      const icon = addArtifactIcon(this, GAME_W / 2, GAME_H / 2 - 90, inst, 200).setScale(0.2);
      ov.add(icon);
      this.tweens.add({ targets: icon, scale: icon.scale * 5, duration: 380, ease: 'Back.easeOut' });
      // VERY RARE joined this panel when The Egg's table changed, and the rarity
      // colours are dark-ground colours sitting on a cream one. Outlined, the way
      // the reward shelf outlines the same word on the same parchment.
      const rarText = legible(this.add.text(GAME_W / 2, GAME_H / 2 + 32, rar.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: rarCss,
      }), { shadow: false }).setOrigin(0.5);
      if (rar.rainbow) rainbowText(this, rarText);
      ov.add(rarText);
      ov.add(this.add.text(GAME_W / 2, GAME_H / 2 + 74, inst.name, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '38px', color: PARCH.text,
        wordWrap: { width: 640 }, align: 'center',
      }).setOrigin(0.5));
      ov.add(this.add.text(GAME_W / 2, GAME_H / 2 + 112, personalize(inst.desc ?? ''), {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim,
        fontStyle: 'bold', wordWrap: { width: 620 }, align: 'center',
      }).setOrigin(0.5, 0));
      const btn = this.add.image(GAME_W / 2, GAME_H / 2 + 288, 'btn_yellow')
        .setDisplaySize(320, 72).setInteractive({ useHandCursor: true });
      const bt = this.add.text(GAME_W / 2, GAME_H / 2 + 284, 'IT IS YOURS', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '28px', color: '#5b3a00',
      }).setOrigin(0.5);
      ov.add([btn, bt]);
      btn.on('pointerdown', () => {
        sfx(this, 'button', { volume: 0.8 });
        ov.destroy(true);
        done();
      });
    });
  }

  /**
   * ALL-IN VISOR's price: a card leaves the run entirely. Purged from the run
   * deck AND from this fight's draw/discard piles so no shuffle can resurrect
   * it — unlike Agatha's slice, which only borrows.
   */
  burnCardForever(card) {
    const i = run.runDeck.findIndex(c => c.id === card.id);
    if (i >= 0) {
      run.runDeck.splice(i, 1);
      // THE BELL AT THE BOTTOM OF THE FUNNEL. Rung ONLY when the splice really
      // happened, so a card already gone from the run deck (a double-burn, a
      // sprite struck twice) can never pay THE GRAVE ROBBER'S SPADE twice.
      // This one line is what pays the spade for the All-In Visor, the Wheel's
      // DESTROY wedge, CONDEMNED, the ETHEREAL vanish, the FADE's vanish and
      // the Potion of Poof, all at once — every path in the game that takes a
      // card away forever comes through either here or run.destroyRunCard.
      noteCardsDestroyed(1, run);
    }
    this.deck = this.deck.filter(c => c.id !== card.id);
    this.discardPile = this.discardPile.filter(c => c.id !== card.id);
  }

  /**
   * ETHEREAL's exit. Deliberately NOT the claw: nothing cut this card and
   * nothing broke it — it simply stopped being here. The card lifts, goes
   * translucent, and comes apart into blue-green wisps that drift up and out.
   */
  dissolveCard(cs) {
    if (!cs?.active) return;
    this.handCards = this.handCards.filter(c => c !== cs);
    this.selected = this.selected.filter(c => c !== cs);
    sfx(this, 'poison', { volume: 0.5, rate: 1.5, jitter: 0.06 });
    popMessage(this, cs.x, cs.y - 40, 'VANISHED', { color: '#7fe0d0', size: 30 });

    const glow = this.add.image(cs.x, cs.y, 'fx_glow_circle')
      .setTint(0x7fe0d0).setAlpha(0.45).setScale(0.5)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx);
    this.tweens.add({
      targets: glow, alpha: 0, scale: 1.2, duration: 760, ease: 'Sine.easeOut',
      onComplete: () => glow.destroy(),
    });
    // Wisps: soft motes peeling off the card and climbing away.
    for (let i = 0; i < 14; i++) {
      const p = this.add.image(
        cs.x + Phaser.Math.Between(-52, 52), cs.y + Phaser.Math.Between(-80, 80),
        i % 4 === 0 ? 'fx_star' : 'fx_dust')
        .setTint(Phaser.Math.RND.pick([0x7fe0d0, 0xaef0e4, 0x58c0a8]))
        .setScale(Phaser.Math.FloatBetween(0.08, 0.24)).setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx);
      this.tweens.add({
        targets: p, alpha: { from: 0.85, to: 0 },
        y: p.y - Phaser.Math.Between(70, 190), x: p.x + Phaser.Math.Between(-40, 40),
        scale: 0.03, angle: Phaser.Math.Between(-120, 120),
        duration: Phaser.Math.Between(620, 1150), delay: i * 26, ease: 'Sine.easeOut',
        onComplete: () => p.destroy(),
      });
    }
    this.tweens.add({
      targets: cs, alpha: 0, y: cs.y - 46, scale: 1.06, duration: 620, ease: 'Sine.easeIn',
      onComplete: () => cs.destroy(),
    });
    this.refreshAll();
  }

  /**
   * ...and the theatre for it: the Daughters' claw language, re-tuned crimson
   * and closed with a shatter, so "gone forever" reads differently from "cut".
   */
  shatterCard(cs) {
    if (!cs?.active) return;
    this.handCards = this.handCards.filter(c => c !== cs);
    this.selected = this.selected.filter(c => c !== cs);
    sfx(this, 'hit_stab', { volume: 1, rate: 0.82, jitter: 0.05 });
    shake(this, 0.006, 220);
    // Sits ON the doomed card, not above it: any higher and it lands straight
    // on the equation's total, which is still blooming at this beat.
    popMessage(this, cs.x, cs.y - 30, 'DESTROYED', { color: '#ff5060', size: 32 });

    // Two crossed claw streaks — a wide red bleed under a hot white core.
    for (let k = 0; k < 2; k++) {
      const ang = k ? -38 : 26;
      for (const p of [
        this.add.image(cs.x, cs.y, 'fx_glow').setTint(0xff1828).setDisplaySize(380, 46),
        this.add.image(cs.x, cs.y, 'fx_glow').setTint(0xffd8d0).setDisplaySize(380, 12),
      ]) {
        p.setAngle(ang).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
        const full = p.scaleX;
        p.scaleX = full * 0.15;
        this.tweens.add({ targets: p, scaleX: full, duration: 110, delay: k * 90, ease: 'Cubic.easeOut' });
        this.tweens.add({
          targets: p, alpha: { from: 1, to: 0 }, duration: 300, delay: k * 90 + 60,
          ease: 'Cubic.easeIn', onComplete: () => p.destroy(),
        });
      }
    }
    this.time.delayedCall(150, () => {
      if (!cs.active) return;
      for (let i = 0; i < 16; i++) {
        const p = this.add.image(cs.x, cs.y, i % 3 ? 'fx_dust' : 'fx_star')
          .setTint(Phaser.Math.RND.pick([0xff3040, 0xd04870, 0xffd0c0]))
          .setScale(Phaser.Math.FloatBetween(0.12, 0.36)).setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.fx + 1);
        this.tweens.add({
          targets: p, x: cs.x + Phaser.Math.Between(-170, 170), y: cs.y + Phaser.Math.Between(-110, 150),
          alpha: 0, scale: 0.04, angle: Phaser.Math.Between(-260, 260),
          duration: Phaser.Math.Between(400, 760), ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
        });
      }
      this.tweens.add({
        targets: cs, scaleX: 0.04, scaleY: 1.15, angle: cs.angle + 18, alpha: 0,
        duration: 260, ease: 'Cubic.easeIn', onComplete: () => cs.destroy(),
      });
    });
    this.refreshAll();
  }

  /** Apply a world-mechanic debuff to the player, with all the theatre. */
  applyPlayerDebuff(type, value, source = null) {
    // Counter-artifacts: the charms stop regular enemies. (The Hushed Bell no
    // longer lives here at all — since the 2026-07-31 rework it is an ACTIVE
    // that cancels a whole enemy turn instead of a passive boss ward.)
    const isBoss = !!source?.def?.boss;
    const immunity = {
      bleed: 'immuneBleed', freeze: 'immuneFreeze',
      fear: 'immuneFear', hypnotize: 'immuneHypno',
    }[type];
    // Ember Heart burns through rank: its Freeze immunity ignores the usual
    // "regular enemies only" clause and holds against bosses too.
    const emberProof = type === 'freeze' && this.prop('immuneFreezeAll') > 0;
    const charmed = immunity && this.prop(immunity) > 0 && (!isBoss || emberProof);
    if (charmed) {
      sfx(this, 'shield', { volume: 0.7, rate: 1.2 });
      popMessage(this, this.heroHome.x, this.heroHome.y - 60, 'IMMUNE!', { color: '#9adcff', size: 30 });
      return;
    }

    // CARD-DENIAL CAP, enforced a second time at the point of impact. The
    // intent was already clamped at spawn (enemies.js makeEnemy), so this only
    // catches values that never went through it — a relic, a potion or some
    // future re-scaler handing us a raw number. Rank and file only: an elite
    // or a boss is allowed its moment.
    if (source && CARD_DENIAL_CAP > 0 && (type === 'freeze' || type === 'fear') && isRankAndFile(source.def)) {
      value = Math.min(CARD_DENIAL_CAP, value);
    }

    // WOOLEN MITTENS. FREEZE reaches fewer of your cards, from ANY source, and
    // it STACKS WITH THE CAP rather than replacing it: the cap trims the
    // rank-and-file's number first, the mittens then take one off whatever is
    // left. On a capped 2 that is a 1; on a boss's uncapped 3 it is a 2. Taken
    // all the way to nothing it is an immunity for that one gust, and it says
    // so with the charms' own beat rather than freezing zero cards in silence.
    const mitts = type === 'freeze' ? this.prop('freezeReduce') : 0;
    if (mitts > 0) {
      value = Math.max(0, value - mitts);
      if (value <= 0) {
        sfx(this, 'shield', { volume: 0.7, rate: 1.2 });
        popMessage(this, this.heroHome.x, this.heroHome.y - 60, 'IMMUNE!', { color: '#9adcff', size: 30 });
        return;
      }
    }

    const color = DEBUFF_COLORS[type] ?? 0xffffff;
    flashVignette(this, color, 0.45);
    this.heroDebuff(color);
    const debuffSfx = {
      fear: 'fear_placed', hypnotize: 'fear_placed', freeze: 'frozen_placed',
      rooted: 'fear_placed', courtLock: 'fear_placed', suitSeal: 'fear_placed',
      spikes: 'frozen_placed',
      blind: 'card_deal', fade: 'poison',
    };
    sfx(this, debuffSfx[type] ?? 'poison', { volume: 0.75, jitter: 0.05 });
    switch (type) {
      // B1 TALON GRIP: Wolfowl's bleed comes with the talons. It is applied
      // through applySuitSeal — the SAME door a regular's SEALED SUIT uses —
      // so the card locks, `cardDenied`, `deadlockState`, the HUD wax pip and
      // the potion-mercy warning all follow it without a single special case.
      case 'bleed':
        this.pstat.bleed += value;
        if (source?.def?.special === 'talonGrip') this.talonGrip(source);
        break;
      case 'poison': this.pstat.poison += value; break;
      case 'brittle': this._brittleApplied += 1; break;
      case 'fear': this._fearApplied += value; break;
      case 'freeze': this.freezeCards(value); break;
      case 'hypnotize': this.hypnoActive = true; this.markHypnoCard(); break;
      case 'suitban': this.spinEternalKeep(); break;
      // --- the 2026-08-02 wave. Each owns its own theatre, so they return
      //     before the generic label pops below.
      case 'rooted': this.applyRooted(value); break;
      case 'courtLock': this.applyCourtLock(value); break;
      case 'suitSeal': this.applySuitSeal(null, value); break;
      case 'spikes': this.addSpikes(value); break;
      // --- the 2026-08-03 biome wave. Both are RENDER states, not denials:
      //     a blinded card and a faded card are both entirely playable, which
      //     is why neither one goes anywhere near `cardDenied`.
      //     ELITE/BOSS DOOR: `blindDraws(Infinity)` is a whole-fight
      //     moonglare with no second code path, exactly as ROOTED's is.
      case 'blind': this.blindDraws(value); break;
      case 'fade': this.fadeCards(value); break;
    }
    const labels = {
      bleed: `Bleed +${value}`, poison: `Poison +${value}`, brittle: 'Brittle!',
      fear: `Fear +${value}`, freeze: `Frozen ×${value}`, hypnotize: 'Hypnotized!', suitban: '',
      rooted: '', courtLock: '', suitSeal: '', spikes: '', blind: '', fade: '',
    };
    if (labels[type]) {
      popMessage(this, this.heroHome.x, this.heroHome.y - 60, labels[type],
        { color: '#' + color.toString(16).padStart(6, '0'), size: 30 });
    }
    this.refreshAll();
  }

  freezeCards(n) {
    const candidates = this.handCards.filter(c => !c.playLocked && c !== this.hypnoCard);
    Phaser.Utils.Array.Shuffle(candidates);
    candidates.slice(0, n).forEach(c => {
      if (c.selected) { this.selected = this.selected.filter(x => x !== c); c.setSelected(false); }
      c.setLockState('frozen');
    });
    this.updatePreview();
  }

  /**
   * Wolfowl's gaze forces exactly ONE card — and it is called TWICE per gaze:
   * once the instant the debuff lands mid enemy-turn, once again after the
   * redraw that ends the enemy turn. The second call used to push a SECOND
   * card into this.selected while only the newest one was `this.hypnoCard`,
   * so the older one was still click-off-able: two cards selected, one
   * actually forced (JC's bug). It now RELEASES the old mark first, so the
   * gaze can only ever hold one card at a time.
   */
  markHypnoCard() {
    if (!this.hypnoActive) return;
    this.releaseHypnoCard();
    const candidates = this.handCards.filter(c => !c.playLocked);
    if (!candidates.length) return;
    this.hypnoCard = Phaser.Utils.Array.GetRandom(candidates);
    this.hypnoCard.setLockState('hypno');
    if (!this.hypnoCard.selected) {
      // Fear can pull the cap below what is already picked — the gaze wins,
      // and the most recent free pick gives up its slot.
      while (this.selected.length >= this.maxSelectable) {
        const drop = [...this.selected].reverse().find(c => c !== this.hypnoCard);
        if (!drop) break;
        this.selected = this.selected.filter(c => c !== drop);
        drop.setSelected(false);
      }
      this.selected.push(this.hypnoCard);
      this.hypnoCard.setSelected(true);
    }
    this.updatePreview();
  }

  /** Let go of whatever card the gaze was holding: lock off, selection off. */
  releaseHypnoCard() {
    const c = this.hypnoCard;
    this.hypnoCard = null;
    if (!c?.active) return;
    if (c.lockState === 'hypno') c.setLockState(null);
    if (c.selected) {
      this.selected = this.selected.filter(x => x !== c);
      c.setSelected(false);
    }
  }

  /** The Keeper spins the wheel — one suit becomes unplayable until the next spin. */
  spinEternalKeep() {
    const suits = ['swords', 'hearts', 'gems', 'clovers'];
    const chosen = Phaser.Utils.Array.GetRandom(suits);
    sfx(this, 'wheel_spin', { volume: 0.9 });
    const ov = this.add.container(ARENA_CX, 330).setDepth(DEPTH.overlay + 1).setScale(0.6).setAlpha(0);
    // The Keeper's altar: a wood-framed void plate breathing purple.
    const aura = this.add.image(0, 0, 'fx_glow').setTint(0x8050c0).setAlpha(0.5)
      .setDisplaySize(560, 220).setBlendMode(Phaser.BlendModes.ADD);
    ov.add(aura);
    this.tweens.add({ targets: aura, alpha: 0.8, duration: 500, yoyo: true, repeat: -1 });
    const parts = woodPanel(this, 0, 0, 460, 128, { accent: 0x8050c0 });
    ov.add([parts.shadow, parts.panel, parts.line]);
    const velvet = this.add.rectangle(0, 0, 424, 92, 0x241040, 0.95);
    ov.add(velvet);
    const ring = this.add.image(0, 0, 'fx_glow_circle').setTint(0xb080ff).setScale(0.34).setBlendMode(Phaser.BlendModes.ADD);
    ov.add(ring);
    const pips = suits.map((s, i) => {
      const p = this.add.image(-135 + i * 90, 0, SUIT_PIP_KEY[s]).setTint(SUIT_COLORS[s]);
      p.setScale(52 / Math.max(p.width, p.height));
      ov.add(p);
      return p;
    });
    this.tweens.add({ targets: ov, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    const finalIdx = suits.indexOf(chosen);
    const hops = 8 + finalIdx;
    for (let i = 0; i <= hops; i++) {
      this.time.delayedCall(300 + 90 * i + i * i * 6, () => {
        ring.setX(pips[i % 4].x);
        this.tweens.add({ targets: pips[i % 4], scale: pips[i % 4].scale * 1.2, duration: 80, yoyo: true });
        sfx(this, 'score_tick', { volume: 0.25, rate: 1.25 });
        if (i === hops) {
          sfx(this, 'fear_placed', { volume: 0.85, rate: 0.9 });   // interim seal sound (custom one requested)
          flashVignette(this, DEBUFF_COLORS.suitban, 0.5);
          burst(this, ARENA_CX + pips[i % 4].x, 330, 0x8050c0, 14);
          shake(this, 0.004, 220);
          // The ETERNAL Keep has no clock — that is what makes it eternal. A
          // regular's SEALED SUIT sets pstat.suitSealTurns instead; zeroing it
          // here means a respin can never inherit somebody else's timer.
          this.pstat.suitSealTurns = 0;
          this.applySuitBan(chosen);
          popNumber(this, ARENA_CX, 240, `${SUIT_GLYPH[chosen]} SEALED!`, { color: '#b080ff', size: 40 });
          this.tweens.add({ targets: ov, alpha: 0, scale: 0.8, duration: 500, delay: 900, onComplete: () => ov.destroy(true) });
        }
      });
    }
  }

  applySuitBan(suit) {
    this.bannedSuit = suit;
    // ONE re-derivation for every denial the game has. It clears the locks the
    // old seal owned, applies the new one, AND respects COURT ADJOURNED at the
    // same time — which the hand-rolled two-pass version could not.
    this.resyncDenialLocks();
    this.updatePreview();
    this.refreshAll();
  }

  // =========================================================================
  // THE MECHANICS WAVE (2026-08-02) — four player debuffs, one denial gate
  // -------------------------------------------------------------------------
  // JC beat the game with only minor challenge and asked for PUZZLES, not
  // numbers. These four are the puzzle pieces the regular tier deals out one at
  // a time (elites and bosses stack them — that IS the tier difference):
  //
  //   ROOTED           hand size −1 while it runs
  //   COURT ADJOURNED  J/Q/K unplayable (discardable) while it runs
  //   SEALED SUIT      one suit unplayable (discardable) while it runs
  //   SPIKES           every hand you play costs HP equal to your stacks
  //
  // The pure rules live in core/statuses.js (freshPstat / tickPlayerDebuffs /
  // spikeBite / absorbSpikes / isFaceCard) so they are unit-testable; this
  // file owns the theatre and the wiring.
  //
  // THE ONE RULE THAT MATTERS: every way of making a card unplayable goes
  // through `cardDenied`, `resyncDenialLocks` re-derives the whole hand from
  // it, and `checkSealDeadlock` reads the result. Adding a fifth denial (an
  // elite's, a boss's) is ONE clause in cardDenied and nothing else.
  // =========================================================================

  /**
   * Is this card denied for PLAY right now? Discarding is ALWAYS allowed — that
   * is the escape hatch the whole deadlock design rests on.
   *
   * `ignoreSuitSeal` asks the counterfactual "would this card be playable if
   * the suit seal weren't there", which is how pickSealSuit avoids sealing the
   * player into a corner it could have avoided.
   */
  cardDenied(card, opts = {}) { return cardIsDenied(card, this.denial, opts); }

  /** The live denial state, in the shape core/statuses.js reasons about. */
  get denial() {
    return {
      bannedSuit: this.bannedSuit ?? null,
      sealTurns: this.pstat?.suitSealTurns ?? 0,
      courtLock: this.pstat?.courtLock ?? 0,
      // BURNED joins the SAME shape every other denial answers in, which is
      // what makes Act III's mechanic one clause in cardIsDenied and nothing
      // else. (BLIND is deliberately not here: it denies information, not the
      // card, and must never reach this object.)
      burned: this.burnedCards ?? null,
    };
  }

  /**
   * How many turns to actually bank for a debuff applied RIGHT NOW.
   *
   * Every one of these lands mid enemy-turn, and the tick at the end of that
   * same turn must not eat it — brittle and fear solve that by deferring the
   * application, but these three have to lock cards on screen the instant they
   * land, so they are applied immediately and given the extra turn instead.
   * `_armed` (captured at the top of the enemy turn) is what tells the two
   * cases apart: a debuff that was ALREADY running will be ticked by this turn,
   * so a refresh has to out-run the tick; a fresh one will not.
   *
   * Infinity + 1 is Infinity, so a whole-fight elite version needs no special
   * case here either.
   */
  denialTurns(key, turns) {
    return turns + (this._armed?.[key] ? 1 : 0);
  }

  /** Is ANY play-denial running? (The deadlock check's cheap early out.) */
  get denialActive() { return denialRunning(this.denial); }

  /** What the denial is called, for the messages that have to name it. */
  get denialLabel() {
    const bits = [];
    if (this.bannedSuit) bits.push(`${this.bannedSuit.toUpperCase()} SEALED`);
    if ((this.pstat?.courtLock ?? 0) > 0) bits.push('COURT ADJOURNED');
    if (this.burnedCards?.size) bits.push(`${this.burnedCards.size} BURNED`);
    return bits.join(' + ');
  }

  /**
   * Re-derive every card's lock from `cardDenied`, in both directions. Cheap,
   * idempotent, and the only thing standing between a new denial (or a
   * Hopquake, or a transmuted card) and an unplayable-but-unmarked hand.
   * @returns {boolean} whether anything actually moved
   */
  resyncDenialLocks() {
    let changed = false;
    for (const cs of this.handCards ?? []) {
      const denied = this.cardDenied(cs.card);
      if (denied && cs.lockState !== 'banned') {
        if (cs.selected) { this.selected = this.selected.filter(c => c !== cs); cs.setSelected(false); }
        if (cs === this.hypnoCard) this.hypnoCard = null;
        cs.setLockState('banned');
        changed = true;
      } else if (!denied && cs.lockState === 'banned') {
        cs.setLockState(null);
        changed = true;
      }
    }
    // A denial can eat the very card the gaze was holding — re-home it, or the
    // gaze silently stops forcing anything until the next deal.
    if (this.hypnoActive && !this.hypnoCard) this.markHypnoCard();
    return changed;
  }

  // ---------------- 1. ROOTED ----------------

  /**
   * Hand size −`power` for `turns` turns. The Fairy King's permanent −2 keeps
   * its own path (`bossHandPenalty`) and the two STACK through handSizeOf,
   * which floors the result at HAND_SIZE_FLOOR — so no pile of roots can ever
   * deal a hand too small to play out of.
   *
   * ELITE/BOSS DOOR: `applyRooted(Infinity, { power: 2 })` is a whole-fight
   * −2 with no second code path (tickPlayerDebuffs treats Infinity as forever).
   */
  applyRooted(turns = REGULAR_DENIAL_TURNS, { power = ROOTED_STRENGTH, tint = null } = {}) {
    this.rootedPower = Math.max(this.rootedPower ?? ROOTED_STRENGTH, power);
    this.pstat.rooted = Math.max(this.pstat.rooted, this.denialTurns('rooted', turns));
    // E5 DREAD GRIP passes the Abyss's violet, so the elite's whole-fight grip
    // never reads as the Forest's one-turn tangle.
    this.growVines(tint);
    sfx(this, 'fear_placed', { volume: 0.7, rate: 0.85 });
    const forever = this.pstat.rooted === Infinity;
    popMessage(this, ARENA_CX, 620,
      `${forever ? 'DREAD GRIP' : 'ROOTED'}  −${this.rootedPower} CARD${this.rootedPower > 1 ? 'S' : ''}`,
      { color: tint ? '#c9a2ff' : '#8fe098', size: 38, rise: 46 });
    // The fan itself lurches: the hand is about to get smaller and you should
    // feel it before you count it.
    if (this.handGroup) {
      this.tweens.add({
        targets: this.handGroup, y: { from: 0, to: 14 }, duration: 70,
        yoyo: true, repeat: 2, onComplete: () => this.handGroup?.setY(0),
      });
    }
    this.refreshAll();
  }

  /**
   * The temporary vines. Deliberately its OWN layer (`vineLayer`), not the
   * Fairy King's `rootLayer`: a rooted regular in a Fairy King fight must not
   * tear down the boss's whole-fight undergrowth on the way out.
   */
  growVines(tint = null) {
    if (this.vineLayer?.active) return;
    // Three tones per vine: outline, body, lit edge. The default is the
    // Forest's green; DREAD GRIP passes the Abyss's violet and the whole
    // undergrowth changes species without a second copy of this function.
    const dark = tint ? 0x180a28 : 0x10240c;
    const body = tint ?? 0x47962f;
    const lit = tint ? 0xd8b0ff : 0xb6f07e;
    const layer = this.add.container(0, 0).setDepth(DEPTH.cards - 1);
    this.vineLayer = layer;
    const haze = this.add.image(GAME_W / 2, GAME_H + 10, 'fx_glow')
      .setTint(body).setAlpha(0).setDisplaySize(GAME_W * 1.1, 250)
      .setBlendMode(Phaser.BlendModes.ADD);
    layer.add(haze);
    this.tweens.add({ targets: haze, alpha: 0.22, duration: 420 });
    const N = 15;
    for (let i = 0; i < N; i++) {
      const bx = SIDEBAR_W + 40 + (GAME_W - SIDEBAR_W - 80) * (i / (N - 1)) + Phaser.Math.Between(-16, 16);
      // THE FAN IS 250px TALL and these sit behind it, so the first pass at
      // 70-150 was almost entirely hidden by the cards it was supposed to be
      // choking. The ones OFF the fan (left and right of it) climb highest.
      const offFan = bx < CARD.fanCenterX - 420 || bx > CARD.fanCenterX + 420;
      const h = offFan ? Phaser.Math.Between(230, 330) : Phaser.Math.Between(150, 250);
      const curl = Phaser.Math.Between(-44, 44);
      const g = this.add.graphics();
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push(new Phaser.Math.Vector2(Math.sin(t * Math.PI * 1.35) * curl * t, -h * t));
      }
      const w = Phaser.Math.Between(7, 11);
      g.lineStyle(w + 4, dark, 0.85); g.strokePoints(pts, false, false);
      g.lineStyle(w, body, 1); g.strokePoints(pts, false, false);
      g.lineStyle(3, lit, 0.8); g.strokePoints(pts, false, false);
      // They CREEP UP: the whole layer grows out of the bottom edge rather than
      // popping into existence already grown.
      g.setPosition(bx, GAME_H + 12 + h).setAngle(-2).setScale(1, 0.05);
      layer.add(g);
      this.tweens.add({
        targets: g, y: GAME_H + 12, scaleY: 1, duration: 420, delay: i * 22, ease: 'Back.easeOut',
        onComplete: () => this.tweens.add({
          targets: g, angle: { from: -2.4, to: 2.4 },
          duration: 2200 + i * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        }),
      });
      if (i % 3 === 0) {
        const tip = pts[Phaser.Math.Between(8, 11)];
        const leaf = this.add.image(bx + tip.x, GAME_H + 12 + tip.y, 'fx_leaf')
          .setScale(Phaser.Math.FloatBetween(1.5, 2.4)).setAngle(Phaser.Math.Between(-50, 50)).setAlpha(0.95);
        if (tint) leaf.setTint(lit);
        layer.add(leaf);
      }
    }
    flashVignette(this, tint ?? DEBUFF_COLORS.rooted, 0.42);
  }

  /** The roots let go: the vines wither back into the floor. */
  clearVines() {
    const layer = this.vineLayer;
    if (!layer?.active) { this.vineLayer = null; return; }
    this.vineLayer = null;
    this.tweens.add({
      targets: layer, y: 120, alpha: 0, duration: 460, ease: 'Cubic.easeIn',
      onComplete: () => layer.destroy(true),
    });
    popMessage(this, ARENA_CX, 620, 'the roots let go', { color: '#8fe098', size: 26 });
  }

  // ---------------- 2. COURT ADJOURNED ----------------

  /**
   * Every FACE card (J, Q, K) becomes unplayable for `turns` turns. They can
   * still be DISCARDED — exactly the Keeper's treatment, and exactly why this
   * is survivable. Feeds `cardDenied`, so the locks, the deadlock check and the
   * HUD all follow for free.
   *
   * ELITE/BOSS DOOR: Sinastra calls `applyCourtLock(2)` from her rotation; a
   * whole-fight version is `applyCourtLock(Infinity)`.
   */
  applyCourtLock(turns = REGULAR_DENIAL_TURNS) {
    this.pstat.courtLock = Math.max(this.pstat.courtLock, this.denialTurns('courtLock', turns));
    this.resyncDenialLocks();
    this.crownSigil();
    flashVignette(this, DEBUFF_COLORS.courtLock, 0.5);
    sfx(this, 'fear_placed', { volume: 0.85, rate: 0.75 });
    this.updatePreview();
    this.refreshAll();
  }

  /** A cracked crown sweeps the fan and every face card greys behind it. */
  crownSigil() {
    const y = CARD.fanY - 40;
    const sigil = this.add.image(SIDEBAR_W - 40, y, 'icon_lock').setTint(0xd8b0ff)
      .setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 2);
    sigil.setScale(150 / Math.max(sigil.width, sigil.height));
    const wave = this.add.image(SIDEBAR_W - 40, y, 'fx_glow').setTint(0x8a4cd8)
      .setAlpha(0).setDisplaySize(260, 420).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
    this.tweens.add({ targets: [sigil, wave], alpha: { from: 0, to: 0.95 }, duration: 140 });
    this.tweens.add({
      targets: [sigil, wave], x: GAME_W + 60, duration: 620, ease: 'Cubic.easeIn',
      onComplete: () => { sigil.destroy(); wave.destroy(); },
    });
    this.tweens.add({ targets: sigil, angle: 24, duration: 620 });
    // ...and each locked card takes a violet snap as the wave passes it.
    for (const cs of this.handCards ?? []) {
      if (!isFaceCard(cs.card)) continue;
      const t = Phaser.Math.Clamp((cs.x - SIDEBAR_W) / (GAME_W - SIDEBAR_W), 0, 1);
      this.time.delayedCall(120 + t * 520, () => {
        if (!cs.active) return;
        burst(this, cs.x, cs.y - 18, 0x8a4cd8, 8);
        this.tweens.add({ targets: cs, angle: cs.baseAngle + 7, duration: 80, yoyo: true });
      });
    }
    // Below the nameplate band (names ~255, bars ~291, intent icons ~337): the
    // first pass printed the headline straight through an enemy's health bar.
    popMessage(this, ARENA_CX, 396, 'COURT ADJOURNED', { color: '#c9a2ff', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452, 'J · Q · K cannot be played. You may still discard them',
      { color: '#d8c4f4', size: 24, rise: 34, delay: 260 });
  }

  // ---------------- 3. SEALED SUIT ----------------

  /**
   * The Keeper's Eternal Keep with a clock on it. Regulars seal ONE suit for
   * ONE turn; the Keeper's own spin sets no clock at all and is unchanged.
   *
   * ELITE/BOSS DOOR: `applySuitSeal('swords', 1)` is Wolfowl's TALON GRIP —
   * a named suit, a named duration, everything else identical.
   */
  applySuitSeal(suit = null, turns = REGULAR_DENIAL_TURNS, { quiet = false } = {}) {
    const chosen = suit ?? this.pickSealSuit();
    this.pstat.suitSealTurns = Math.max(
      this.pstat.suitSealTurns, this.denialTurns('suitSealTurns', turns));
    this.applySuitBan(chosen);
    // `quiet` keeps the wax but drops its two headlines — TALON GRIP prints its
    // own in the same band and two sets would land on top of each other.
    this.waxStamp(chosen, { quiet, turns });
    return chosen;
  }

  /**
   * Which suit to seal. It prefers a suit that is actually IN your hand (a seal
   * on a suit you are not holding is not a puzzle), and among those it prefers
   * one that leaves at least one card still playable — every other denial
   * included. Only a genuinely monochrome hand can get past that, and
   * checkSealDeadlock owns what happens then.
   */
  pickSealSuit() {
    const suits = ['swords', 'hearts', 'gems', 'clovers'];
    const inHand = suits.filter(s => (this.handCards ?? []).some(c => c.card.suit === s));
    const pool = inHand.length ? inHand : suits;
    const kind = pool.filter(s => (this.handCards ?? []).some(
      c => c.card.suit !== s && !this.cardDenied(c.card, { ignoreSuitSeal: true })));
    return Phaser.Utils.Array.GetRandom(kind.length ? kind : pool);
  }

  /** A blob of wax thumps down over the suit, and the pip goes cold. */
  waxStamp(suit, { quiet = false, turns = REGULAR_DENIAL_TURNS } = {}) {
    sfx(this, 'fear_placed', { volume: 0.9, rate: 0.95 });
    shake(this, 0.004, 200);
    flashVignette(this, DEBUFF_COLORS.suitSeal, 0.45);
    // The stamp lands ON the fight and its words sit BELOW it, in the same band
    // COURT ADJOURNED uses — 396/452, clear of the nameplate/health/intent stack.
    const x = ARENA_CX, y = 296;
    const wax = this.add.image(x, y, this.textures.exists('fx_wax_seal') ? 'fx_wax_seal' : 'fx_glow_circle')
      .setTint(0x8050c0).setDepth(DEPTH.fx + 2).setAlpha(0).setScale(1.9);
    const pip = this.add.image(x, y, SUIT_PIP_KEY[suit]).setTint(0xf0e0ff)
      .setDepth(DEPTH.fx + 3).setAlpha(0).setScale(1.9);
    const pipRest = 62 / Math.max(pip.width, pip.height);
    const waxRest = 122 / Math.max(wax.width, wax.height);
    this.tweens.add({ targets: wax, alpha: 1, scale: waxRest, duration: 170, ease: 'Back.easeIn' });
    this.tweens.add({
      targets: pip, alpha: 1, scale: pipRest, duration: 170, ease: 'Back.easeIn',
      onComplete: () => {
        burst(this, x, y, 0xb080ff, 14);
        shake(this, 0.005, 160);
        this.tweens.add({
          targets: [wax, pip], alpha: 0, y: y - 30, duration: 420, delay: 620,
          onComplete: () => { wax.destroy(); pip.destroy(); },
        });
      },
    });
    // Same band as COURT ADJOURNED's: below the nameplate/health/intent stack.
    if (quiet) return;
    popMessage(this, ARENA_CX, 396,
      `${SUIT_GLYPH[suit] ?? ''} SEALED · ${turns} TURN${turns > 1 ? 'S' : ''}`,
      { color: '#c9a2ff', size: 40, rise: 50 });
    popMessage(this, ARENA_CX, 452, 'that suit cannot be played. You may still discard it',
      { color: '#d8c4f4', size: 24, rise: 34, delay: 300 });
  }

  /**
   * B1 · TALON GRIP (Wolfowl). Its Bleed rakes the SWORDS out of play for
   * TALON_GRIP_TURNS. Nothing new mechanically: it is applySuitSeal with the
   * suit named, which means it is the game's THIRD denial and it stacks with
   * COURT ADJOURNED and the Keeper's seal through one gate — see
   * tests/mechanics.test.js's Talon Grip deadlock matrix.
   */
  talonGrip(enemy) {
    // SOVEREIGN'S WRIT. TALON GRIP is the one signature that rides IN on a
    // plain debuff: the bleed is generic violence and lands as always, the SUIT
    // LOCK it comes wrapped in is the signature and is struck down. Asked as
    // 'suitSeal' because that is literally the effect the seal is.
    if (this.writBlocks(enemy, 'suitSeal')) return null;
    this.applySuitSeal(TALON_GRIP_SUIT, TALON_GRIP_TURNS, { quiet: true });
    sfx(this, 'hit_stab', { volume: 0.9, rate: 0.8, jitter: 0.05 });
    shake(this, 0.006, 240);
    // Three red talon rakes across the fan, then the sword cards grey out.
    for (let k = 0; k < 3; k++) {
      const y = CARD.fanY - 40 + (k - 1) * 46;
      const rake = [
        this.add.image(CARD.fanCenterX, y, 'fx_glow').setTint(0xd82838).setDisplaySize(980, 30),
        this.add.image(CARD.fanCenterX, y, 'fx_glow').setTint(0xffd0c8).setDisplaySize(980, 9),
      ];
      for (const p of rake) {
        p.setAngle(-9 + k * 4).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 2);
        const full = p.scaleX;
        p.scaleX = full * 0.1;
        this.tweens.add({ targets: p, scaleX: full, duration: 130, delay: k * 70, ease: 'Cubic.easeOut' });
        this.tweens.add({
          targets: p, alpha: { from: 1, to: 0 }, duration: 320, delay: k * 70 + 80,
          onComplete: () => p.destroy(),
        });
      }
    }
    for (const cs of this.handCards ?? []) {
      if (cs.card.suit !== TALON_GRIP_SUIT) continue;
      burst(this, cs.x, cs.y - 20, 0xd82838, 9);
      this.tweens.add({ targets: cs, angle: cs.baseAngle - 9, duration: 80, yoyo: true });
    }
    // SUIT_GLYPH is the display NAME ('SWORDS'), not a pip — so it is the whole
    // noun here rather than a decoration in front of one.
    popMessage(this, ARENA_CX, 396, 'TALON GRIP', { color: '#ff8a70', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `${SUIT_GLYPH[TALON_GRIP_SUIT] ?? 'SWORDS'} raked out of play. You may still discard them`,
      { color: '#ffc0b0', size: 24, rise: 34, delay: 260 });
    return TALON_GRIP_SUIT;
  }

  /** The wax cracks off the HUD pip when the clock runs out. */
  crackWax(atX = 46) {
    sfx(this, 'card_deselect', { volume: 0.6, rate: 1.25 });
    burst(this, atX, 500, 0xb080ff, 12);
    popNumber(this, atX + 40, 470, 'SEAL BROKEN', { color: '#c9a2ff', size: 26 });
  }

  // ---------------- 4. SPIKES ----------------

  /**
   * Stacks. Every hand you play costs HP equal to the total, Shield absorbs it
   * like any damage, and NOTHING makes them decay — the enemy just keeps adding.
   * That is the "kill it early or turtle" clock.
   *
   * ELITE/BOSS DOOR: the Sub-Zero Serpent's elite tier is this same call with a
   * bigger number on every intent.
   */
  addSpikes(n = 1) {
    this.pstat.spikes = Math.max(0, this.pstat.spikes + Math.round(n));
    this.drawSpikeRing(true);
    flashVignette(this, DEBUFF_COLORS.spikes, 0.4);
    sfx(this, 'frozen_placed', { volume: 0.85, rate: 1.1 });
    popNumber(this, SIDEBAR_W / 2, 300, `SPIKES +${n}`, { color: '#9adcff', size: 34 });
    this.refreshAll();
  }

  /**
   * The thorn ring around the hero portrait: one spine per stack (to a visual
   * ceiling), thickening as the count climbs, with the number riding it. Redrawn
   * only when the count actually changes — refreshAll runs on every damage tick.
   */
  drawSpikeRing(punch = false) {
    const n = this.pstat?.spikes ?? 0;
    if (n <= 0) {
      if (this.spikeRing) { this.spikeRing.destroy(true); this.spikeRing = null; }
      this._spikeDrawn = 0;
      return;
    }
    if (n === this._spikeDrawn && this.spikeRing?.active) {
      if (punch) this.tweens.add({ targets: this.spikeRing, scale: 1.14, duration: 110, yoyo: true });
      return;
    }
    this._spikeDrawn = n;
    if (this.spikeRing) this.spikeRing.destroy(true);
    const ring = this.add.container(this.heroHome?.x ?? SIDEBAR_W / 2, this.heroHome?.y ?? 182)
      .setDepth(DEPTH.panel + 3);
    this.spikeRing = ring;
    const spines = Math.min(24, 6 + n * 2);
    const len = Math.min(34, 14 + n * 2);
    const g = this.add.graphics();
    for (let i = 0; i < spines; i++) {
      const a = (i / spines) * Math.PI * 2;
      const r0 = 84, r1 = r0 + len;
      const w = Math.min(9, 2 + n * 0.5);
      const nx = Math.cos(a + 0.14) * r0, ny = Math.sin(a + 0.14) * r0;
      g.fillStyle(0x0d2b3d, 0.85);
      g.fillTriangle(Math.cos(a) * r0, Math.sin(a) * r0, nx, ny, Math.cos(a + 0.07) * r1, Math.sin(a + 0.07) * r1);
      g.fillStyle(0x5cc8ff, 0.92);
      g.fillTriangle(
        Math.cos(a) * (r0 + 1), Math.sin(a) * (r0 + 1),
        Math.cos(a + 0.11) * (r0 + 1), Math.sin(a + 0.11) * (r0 + 1),
        Math.cos(a + 0.055) * (r1 - w * 0.3), Math.sin(a + 0.055) * (r1 - w * 0.3));
    }
    g.lineStyle(3, 0x9adcff, 0.55);
    g.strokeCircle(0, 0, 84);
    ring.add(g);
    const count = this.add.text(0, 96, `${n}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: '#d8f2ff',
      stroke: '#0a2b3a', strokeThickness: 7,
    }).setOrigin(0.5);
    count.setShadow(2, 4, '#000000', 6);
    ring.add(count);
    // The THORNS turn; the NUMBER does not. Spinning the whole container sent
    // the count orbiting the portrait, which read as decoration rather than a
    // readout — so the graphics carry the rotation on their own.
    this.tweens.add({ targets: g, angle: 360, duration: 26000, repeat: -1 });
    if (punch) {
      ring.setScale(1.3);
      this.tweens.add({ targets: ring, scale: 1, duration: 260, ease: 'Back.easeOut' });
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = this.add.image(ring.x + Math.cos(a) * 84, ring.y + Math.sin(a) * 84, 'fx_star')
          .setTint(0x9adcff).setScale(0.12).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.panel + 4);
        this.tweens.add({
          targets: s, x: s.x + Math.cos(a) * 60, y: s.y + Math.sin(a) * 60,
          alpha: 0, scale: 0.02, duration: 460, onComplete: () => s.destroy(),
        });
      }
    }
  }

  // ---------------- Denial expiry ----------------

  /**
   * Something ran out of turns. Lift what it was holding and SHOW it letting
   * go — the whole point of a one-turn lock is that you can see the turn it
   * comes off. `keys` is tickPlayerDebuffs' return value.
   */
  expireDenials(keys = []) {
    if (!keys.length) return;
    if (keys.includes('rooted')) this.clearVines();
    if (keys.includes('suitSealTurns')) {
      const at = this.pstatEntries().find(e => e.title?.startsWith('SEALED'))?.x ?? 46;
      this.bannedSuit = null;
      this.crackWax(at);
    }
    if (keys.includes('courtLock')) {
      sfx(this, 'card_deselect', { volume: 0.6, rate: 1.2 });
      popMessage(this, ARENA_CX, 620, 'COURT IS BACK IN SESSION', { color: '#c9a2ff', size: 28 });
    }
    // BLIND letting go is the turn the whole mechanic is about: the cards flip
    // back over in front of you and you find out what you were holding.
    if (keys.includes('blind')) this.unblindAll();
    // Whatever came off, the hand is re-derived from scratch: that is what
    // actually unlocks the cards.
    this.resyncDenialLocks();
    this.updatePreview();
  }

  // =========================================================================
  // THE BIOME WAVE (2026-08-03) — BLIND · FADE · BURNED, and fourteen more
  // -------------------------------------------------------------------------
  // Act I hides information, Act II costs cards, Act III removes options. The
  // pure rules live in core/biomes.js; this block is the theatre and the
  // wiring, and it obeys the same one rule the 2026-08-02 wave does:
  //
  //   EVERY way of making a card unplayable goes through `cardDenied`.
  //
  // BURNED is one clause in that gate and nothing else. BLIND is deliberately
  // NOT in it — a blinded card is entirely playable, which is precisely why it
  // is the gentlest mechanic in the game — and FADE is not in it either.
  // =========================================================================

  // ---------------- BLIND (Act I · Nocturnal Forest) ----------------

  /**
   * REWORKED 2026-08-04 (JC): "blind needs to affect cards being DRAWN, not
   * ones already in your hand. That kinda defeats the purpose."
   *
   * He is right, and the old version was information theatre: you had already
   * READ the cards it flipped, so it hid nothing. The moonlight now falls on
   * the DECK — for `turns` turns, every card you DRAW arrives face down and
   * stays down until it is played or the light lets go. What you were holding
   * when the glare landed, you keep knowing.
   *
   * The intent's value is the DURATION now (Blind 2 = two turns of blind
   * draws), which is also what the biome fx-scaling extends. dressNewCard is
   * the one funnel every freshly dealt sprite passes through, so a draw
   * mid-fight and a deal at the bell go dark by the same clause.
   */
  blindDraws(turns = BLIND_TURNS) {
    this.pstat.blind = Math.max(this.pstat.blind ?? 0, this.denialTurns('blind', turns));
    sfx(this, 'card_deal', { volume: 0.8, rate: 0.7, jitter: 0.05 });
    this.moonGlare(this.pstat.blind);
    this.refreshAll();
    return this.pstat.blind;
  }

  /** Cold light sweeps the fan: the DECK goes dark for `turns` turns. */
  moonGlare(turns) {
    const moon = this.add.image(ARENA_CX, CARD.fanY - 210, 'fx_glow_circle')
      .setTint(0xaebeff).setAlpha(0).setScale(0.7)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
    this.tweens.add({
      targets: moon, alpha: { from: 0, to: 0.75 }, scale: 1.5, duration: 260,
      yoyo: true, hold: 240, ease: 'Sine.easeOut', onComplete: () => moon.destroy(),
    });
    flashVignette(this, DEBUFF_COLORS.blind, 0.42);
    // Same band COURT ADJOURNED and the wax stamp use: clear of the nameplate,
    // health-bar and intent stack.
    popMessage(this, ARENA_CX, 396, 'BLINDED', { color: '#aebeff', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      turns === Infinity
        ? 'every card you draw arrives FACE DOWN, all fight'
        : `cards you draw arrive FACE DOWN for ${turns} turn${turns === 1 ? '' : 's'}. Playable, unread`,
      { color: '#d0d8ff', size: 24, rise: 34, delay: 260 });
  }

  /** The moonlight lets go: every held card turns back over. */
  unblindAll() {
    let n = 0;
    for (const cs of this.handCards ?? []) {
      if (!cs.blinded) continue;
      cs.setBlinded(false);
      n += 1;
    }
    this._blindIds.clear();
    if (!n) return 0;
    sfx(this, 'card_deselect', { volume: 0.6, rate: 1.15 });
    popMessage(this, ARENA_CX, 620, 'the moonlight lets go', { color: '#aebeff', size: 26 });
    this.updatePreview();
    return n;
  }

  /** Re-apply the face-down look to a freshly built sprite (redraws, Hopquake). */
  resyncBlind(cs) {
    if (!cs) return;
    const want = (this.pstat?.blind ?? 0) > 0 && this._blindIds?.has(cs.card.id);
    if (want !== !!cs.blinded) cs.setBlinded(want);
  }

  // ---------------- FADE (Act II · Ethereal Plains) ----------------

  /**
   * `n` cards become ETHEREAL for this fight and gain NO bonus mult for it.
   * The ethereal downside with the upside stripped out: each one that SCORES
   * rolls the same 25% to leave the run forever, and pays nothing for the risk.
   *
   * The ids go on `pstat.faded`, which scoreHand reads as `state.fadedIds` —
   * one clause beside the real ETHEREAL's, so the vanish roll, the VOIDCALLER's
   * save and THE ORACLE's SPIRITUAL all apply to a faded card for free.
   */
  fadeCards(n = 1) {
    const picks = pickFadeTargets(
      Phaser.Utils.Array.Shuffle([...(this.handCards ?? [])]).map(cs => cs.card),
      n, this.pstat.faded);
    for (const card of picks) {
      this.pstat.faded.push(card.id);
      const cs = (this.handCards ?? []).find(c => c.card.id === card.id);
      cs?.setFaded();
    }
    if (!picks.length) return 0;
    sfx(this, 'poison', { volume: 0.5, rate: 1.35, jitter: 0.05 });
    flashVignette(this, DEBUFF_COLORS.fade, 0.4);
    popMessage(this, ARENA_CX, 396, 'FADED', { color: '#e8eefc', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `${picks.length} card${picks.length === 1 ? ' is' : 's are'} FADING: ${Math.round(FADE_VANISH_CHANCE * 100)}% to fade away forever, every time ${picks.length === 1 ? 'it scores' : 'they score'}`,
      { color: '#cfd8ee', size: 24, rise: 34, delay: 260 });
    this.refreshAll();
    return picks.length;
  }

  /** Re-dress a rebuilt sprite whose card is already riding the fade. */
  resyncFade(cs) {
    if (cs && (this.pstat?.faded ?? []).includes(cs.card.id)) cs.setFaded();
  }

  // ---------------- BURNED (Act III · Burning Gallows) ----------------

  /**
   * These cards are spent for the rest of the fight. The ids go in the ledger,
   * which `cardDenied` reads — so the lock, the deadlock verdict and the HUD
   * all follow with no second code path.
   *
   * BURNED BEATS RECYCLED is guaranteed twice over: the play sweep skips a
   * burned sprite before it ever asks stowPlayedCard where the card should be
   * filed (so THE ORACLE'S RECYCLER is never consulted), and every reshuffle
   * runs through purgeBurned besides.
   */
  burnFightCards(cards = [], { quiet = false } = {}) {
    const added = burnCards(this.burnedCards, cards);
    if (!added) return 0;
    this._burnLog += added;
    // Anything of theirs still sitting in a pile leaves now; anything still in
    // hand takes the lock and the char.
    this.deck = purgeBurned(this.deck, this.burnedCards);
    this.discardPile = purgeBurned(this.discardPile, this.burnedCards);
    this.resyncDenialLocks();
    this.syncBurnedLook();
    if (!quiet) {
      sfx(this, 'hit_stab', { volume: 0.8, rate: 0.7, jitter: 0.05 });
      flashVignette(this, DEBUFF_COLORS.burned, 0.45);
      popMessage(this, ARENA_CX, 396, 'STRUCK FROM THE RECORD', { color: '#ff9a50', size: 42, rise: 54 });
      popMessage(this, ARENA_CX, 452,
        `${added} card${added === 1 ? '' : 's'} burned. ${added === 1 ? 'It' : 'They'} cannot be played again this fight, reshuffle or not`,
        { color: '#ffc9a0', size: 24, rise: 34, delay: 260 });
    }
    this.refreshAll();
    return added;
  }

  /** Char every burned card that is still on screen. */
  syncBurnedLook() {
    for (const cs of this.handCards ?? []) {
      if (isBurned(this.burnedCards, cs.card)) cs.setBurnedLook();
    }
  }

  // ---------------- THE MAGISTRATE'S DOCKET ----------------

  /**
   * Bank the type a hand turned out to be. Called at the ONE place a hand is
   * committed, AFTER the strike has been gated — the hand you are playing right
   * now has not been played yet, which is exactly what makes SERAPH OF THE
   * STILL's NOTHING TWICE playable at all.
   */
  noteHandType(type) {
    if (recordHandType(this.usedHandTypes, type)) this.refreshAll();
  }

  /**
   * THE MISTRIAL. Checked at the top of every player turn while DOUBLE JEOPARDY
   * is running, and again after every DISCARD: if nothing the hand in front of
   * you could actually PLAY is still legal, the docket is WIPED and the whole
   * chart is back in play.
   *
   * That is the ruling on the lockout risk, and it is deliberately a
   * CONSTRUCTION rather than a rescue: because the docket can always clear,
   * DOUBLE JEOPARDY can never contribute to a deadlock at all, and the deadlock
   * matrix never has to learn that it exists.
   *
   * IT ASKS ABOUT PLAYABLE CARDS, NOT HELD ONES (2026-08-03). A card the Hollow
   * King has locked, the Keeper has sealed or Pyreheart has burned cannot be
   * committed, so a hand type that needs one is not an open case — counting it
   * as one is exactly how DOUBLE JEOPARDY and THE COURT SLEEPS used to interlock
   * into a fight that could be neither won nor lost. `maxSelectable` goes with
   * it for the same reason: under FEAR a four-card Two Pair cannot be selected
   * either. See biomes.mistrialDue for the worked counterexample.
   *
   * If EVERY card is denied there is no mistrial to declare and this correctly
   * stands aside: that is a card deadlock, and checkSealDeadlock owns it.
   */
  checkMistrial() {
    if (!this.handTypeOnce) return false;
    const hand = (this.handCards ?? [])
      .filter(cs => !this.cardDenied(cs.card)).map(c => c.card);
    if (!mistrialDue(hand, this.usedHandTypes, true, this.maxSelectable)) return false;
    const struck = declareMistrial(this.usedHandTypes);
    this._mistrials += 1;
    sfx(this, 'wheel_spin', { volume: 0.8, rate: 1.2 });
    flashVignette(this, DEBUFF_COLORS.courtLock, 0.5);
    popMessage(this, ARENA_CX, 396, 'MISTRIAL', { color: '#ffd23e', size: 52, rise: 56 });
    popMessage(this, ARENA_CX, 452,
      `${struck.length} hand types struck from the ledger. The docket is clear and every hand is legal again`,
      { color: '#ffe9a8', size: 24, rise: 34, delay: 260 });
    this.refreshAll();
    return true;
  }

  /** PLAY refused because this hand type has already had its day in court. */
  denyUsedHandType(type) {
    sfx(this, 'card_deselect', { volume: 0.7, rate: 0.8 });
    for (const c of this.selected) {
      this.tweens.add({ targets: c, x: c.x + 7, duration: 45, yoyo: true, repeat: 2 });
    }
    const left = remainingHandTypes(this.usedHandTypes).map(t => HAND_DEFS[t].name);
    popMessage(this, ARENA_CX, 620,
      `DOUBLE JEOPARDY: ${HAND_DEFS[type]?.name ?? 'that hand'} has already been played`,
      { color: '#ffb060', size: 30 });
    if (left.length) {
      popMessage(this, ARENA_CX, 668, `still open: ${left.slice(0, 4).join(' · ')}`,
        { color: '#ffd9a8', size: 22, delay: 220 });
    }
  }

  // ---------------- THE ROPEMAKER'S QUEUE ----------------

  /**
   * One relic hangs, LEFT TO RIGHT, so your chain unravels from the front.
   *
   * THE SLOT RULING: the hung relic KEEPS ITS CELL. It is replaced by an inert
   * stub in place (core/biomes.hangArtifacts), never removed, so mirrors resolve
   * positionally exactly as they did before the noose went on and a mirror
   * pointed at a hung relic copies a dead relic and is dead too. Removing it
   * would silently RE-AIM every mirror to its right — the Ropemaker would be
   * handing you relics as often as taking them.
   */
  hangRelic() {
    const i = nextHungRelic(run.artifacts.length, this.disabledRelics);
    if (i == null) {
      popMessage(this, SIDEBAR_W / 2, GAME_H - 210, 'nothing left to hang', { color: '#c08050', size: 24 });
      return null;
    }
    const art = run.artifacts[i];
    this.disabledRelics.add(i);
    sfx(this, 'hit_stab', { volume: 0.85, rate: 0.7 });
    shake(this, 0.005, 220);
    flashVignette(this, DEBUFF_COLORS.burned, 0.4);
    this._artifactSig = null;          // the mat has to redraw wearing the noose
    this.renderArtifactPanel();
    this.syncHungRelics();
    popMessage(this, ARENA_CX, 396, 'THE QUEUE', { color: '#ff9a50', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `${art?.name ?? 'A relic'} is hanged. It does nothing for the rest of this fight`,
      { color: '#ffc9a0', size: 24, rise: 34, delay: 260 });
    this.refreshAll();
    return i;
  }

  /**
   * KEEP THE NOOSE ON THE RELIC, NOT ON THE CELL.
   *
   * `disabledRelics` is a set of INDICES into run.artifacts, and that is
   * deliberate — a hung relic keeps its cell so the mirrors and the ordered
   * mult walk resolve exactly as they did before the rope went on (see
   * biomes.hangArtifacts). What the index model never accounted for is that the
   * combat relic mat is DRAGGABLE and its relics are SELLABLE mid-fight: both
   * rewrite run.artifacts underneath the set, so dragging your first relic to
   * the back of the row moved THE QUEUE's noose onto whatever slid into cell 0,
   * and selling a relic in front of a hung one moved it too.
   *
   * So the index is re-derived from the relic OBJECTS after any belt mutation.
   * Identity, not id: a mirrored relic can share an id with its source, and the
   * row holds the same object references either side of a reorder.
   *
   * @param {object[]} before  run.artifacts as it was before the mutation.
   */
  remapHungRelics(before) {
    if (!this.disabledRelics?.size) return this.disabledRelics;
    const hung = new Set([...this.disabledRelics].map(i => before?.[i]).filter(Boolean));
    this.disabledRelics.clear();
    run.artifacts.forEach((a, i) => { if (hung.has(a)) this.disabledRelics.add(i); });
    return this.disabledRelics;
  }

  /** The noose on the mat: the hung relic greys out and wears a rope. */
  syncHungRelics() {
    if (!this.disabledRelics?.size) return;
    for (const i of this.disabledRelics) {
      const icon = this.artifactIcons?.[i];
      if (!icon?.active) continue;
      icon.setTint(0x4a3a34).setAlpha(0.55);
      const rope = this.add.image(icon.x, icon.y, 'chain_link_side')
        .setTint(0x8a6a4a).setAlpha(0.9).setAngle(12).setDepth(icon.depth + 1);
      rope.setScale((icon.displayHeight * 0.9) / Math.max(rope.width, rope.height));
      this.artifactPanelG.add(rope);
    }
  }

  /**
   * THE BELT AS THE FIGHT SEES IT. Everything that reads a relic in combat goes
   * through here (prop, propHolders, the hooks, the pulses), so a hung relic is
   * inert everywhere at once instead of at twenty call sites.
   */
  liveArtifacts() {
    if (!this.disabledRelics?.size) return effectiveArtifacts();
    return effectiveArtifacts({ ...run, artifacts: hangArtifacts(run.artifacts, this.disabledRelics) });
  }

  /**
   * ...and the same for the two readers that cannot take a list: collectMods()
   * and collectModList() read the live `run` by design. The swap is SYNCHRONOUS
   * and restored in a finally, so nothing — not a save, not a tween, not
   * another scene — can ever observe the neutered row.
   */
  withHungRelics(fn) {
    if (!this.disabledRelics?.size) return fn();
    const real = run.artifacts;
    run.artifacts = hangArtifacts(real, this.disabledRelics);
    try { return fn(); } finally { run.artifacts = real; }
  }

  // ---------------- THE DAMAGE GATES ----------------

  /**
   * Does a hand of `type` reach `enemy`? One question, three refusals — THE
   * PALE ARCHITECT's wall, SERAPH OF THE STILL's nothing-twice and GRIMWATCH's
   * named card — resolved by core/biomes.damageGate so the strike path, the
   * tooltip and the test all read the same verdict.
   */
  biomeGate(enemy, type, playedIds = [], used = null) {
    return damageGate({
      handType: type, playedIds,
      usedHandTypes: used ?? this.usedHandTypes,
      wall: enemy?.wall ?? null,
      unusedOnly: !!enemy?.unusedOnly,
      markedId: this.markedCardId,
    });
  }

  /** Say WHY nothing landed, over the body that refused it. */
  gateRefusal(enemy, gate) {
    const why = {
      marked: 'the marked card nullified the hand',
      wall: `the wall only breaks to ${HAND_DEFS[enemy?.wall]?.name ?? 'one hand'}`,
      unused: 'it only takes damage from a hand you have not played yet',
    }[gate.reason] ?? '';
    this.floatText(enemy, gate.label ?? 'NO EFFECT', '#c9a2ff');
    popMessage(this, ARENA_CX, 452, why, { color: '#d8c4f4', size: 24, rise: 34, delay: 160 });
    sfx(this, 'shield', { volume: 0.7, rate: 0.75 });
  }

  // ---------------- THE HANGMAN'S BRAND ----------------

  /** Brand `n` cards. Unplayed within CONDEMN_TURNS they burn out of the deck. */
  condemnCards(n = 1) {
    const branded = new Set(this.condemnBrands.map(b => b.id));
    const pool = Phaser.Utils.Array.Shuffle([...(this.handCards ?? [])])
      .filter(cs => !branded.has(cs.card.id));
    const picks = pool.slice(0, Math.max(0, n));
    for (const cs of picks) {
      this.condemnBrands.push({ id: cs.card.id, turns: CONDEMN_TURNS });
      burst(this, cs.x, cs.y - 20, 0xff6a20, 10);
      this.tweens.add({ targets: cs, angle: cs.baseAngle + 8, duration: 90, yoyo: true });
    }
    if (!picks.length) return 0;
    sfx(this, 'fear_placed', { volume: 0.85, rate: 0.7 });
    flashVignette(this, DEBUFF_COLORS.burned, 0.42);
    popMessage(this, ARENA_CX, 396, 'CONDEMNED', { color: '#ff9a50', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `PLAY ${picks.length === 1 ? 'it' : 'them'} within ${CONDEMN_TURNS} turns or ${picks.length === 1 ? 'it burns' : 'they burn'} out of your deck for good. Discarding does not save ${picks.length === 1 ? 'it' : 'them'}`,
      { color: '#ffc9a0', size: 23, rise: 34, delay: 260 });
    this.refreshAll();
    return picks.length;
  }

  /** One turn off every brand; whatever runs out leaves the RUN, not the fight. */
  tickCondemned() {
    if (!this.condemnBrands.length) return 0;
    const { brands, burn } = condemnTick(this.condemnBrands);
    this.condemnBrands = brands;
    if (!burn.length) return 0;
    this._condemnLog += burn.length;
    for (const id of burn) {
      const cs = (this.handCards ?? []).find(c => c.card.id === id);
      const card = cs?.card ?? run.runDeck.find(c => c.id === id);
      if (card) this.burnCardForever(card);
      if (cs) this.shatterCard(cs);
    }
    // Out of the RUN and out of this fight both: the ledger stops it coming
    // back through any door at all.
    burnCards(this.burnedCards, burn);
    sfx(this, 'hit_stab', { volume: 0.95, rate: 0.65 });
    popMessage(this, ARENA_CX, 620,
      `${burn.length} condemned card${burn.length === 1 ? '' : 's'} burned out of your deck`,
      { color: '#ff9a50', size: 28 });
    this.refreshAll();
    return burn.length;
  }

  // ---------------- THE REST OF THE SIXTEEN ----------------

  /**
   * GRIMWATCH: mark the HIGHEST-VALUE card in the hand. Playing it nullifies
   * the whole hand. Highest-value since 2026-08-04 (JC's spec, and what the
   * signature copy already claimed): the eye watches your best card, and the
   * counter-play is yours to find. Ties break to the first in the fan.
   */
  markOneCard() {
    const pool = (this.handCards ?? []).filter(cs => !cs.playLocked);
    let cs = null;
    for (const c of pool) {
      const v = cardValue(c.card.rank) + (VALUE_BONUS_BY_MOD[c.card.mod] ?? 0);
      if (!cs || v > cs.v) cs = { c, v };
    }
    cs = cs?.c ?? null;
    this.markedCardId = cs?.card.id ?? null;
    if (!cs) return null;
    burst(this, cs.x, cs.y - 20, 0xffd23e, 12);
    sfx(this, 'fear_placed', { volume: 0.8, rate: 1.1 });
    popMessage(this, ARENA_CX, 396, 'HE SEES IT COMING', { color: '#ffd23e', size: 42, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      'your highest-VALUE card is marked. Play it and the whole hand deals nothing',
      { color: '#ffe9a8', size: 24, rise: 34, delay: 260 });
    this.syncGazeMark();
    return this.markedCardId;
  }

  /**
   * The gaze rides ON the card (JC, 2026-08-04): CardSprite.setMarked stamps
   * the eye onto the sprite itself, so the mark survives every re-fan, sort
   * and rebuild — the old free-floating halo did not move with the hand.
   * One writer for the eye: whatever markedCardId says, the sprites wear.
   */
  syncGazeMark() {
    for (const cs of this.handCards ?? []) {
      const want = !!this.markedCardId && cs.card.id === this.markedCardId;
      if (!!cs.marked !== want) cs.setMarked(want);
    }
  }

  /** THE UNMADE: everything still in hand at end of turn drifts away. */
  dropRemainingHand() {
    const left = [...(this.handCards ?? [])];
    if (!left.length) return 0;
    this._dropLog += left.length;
    for (const cs of left) {
      // GONE FOR THE FIGHT, not destroyed: the card stays in run.runDeck and the
      // next fight's shuffle brings it back, exactly like Agatha's slice. The
      // id is REMEMBERED as a drift, so the sidebar badge wears the Unmade's
      // face and says VANISHED rather than crediting Agatha (JC, 2026-08-04).
      this.slicedCards.push(cs.card);
      this._driftedIds.add(cs.card.id);
      this.deck = this.deck.filter(c => c.id !== cs.card.id);
      this.discardPile = this.discardPile.filter(c => c.id !== cs.card.id);
      this.dissolveCard(cs);
    }
    this.handCards = [];
    this.selected = [];
    sfx(this, 'poison', { volume: 0.5, rate: 1.5 });
    popMessage(this, ARENA_CX, 620,
      `WEIGHTLESS: ${left.length} card${left.length === 1 ? '' : 's'} drifted away`,
      { color: '#cfd8ee', size: 28 });
    return left.length;
  }

  /** THE SENTENCE: name a hand type the player must produce this turn. */
  demandOneHand() {
    const pool = remainingHandTypes(this.handTypeOnce ? this.usedHandTypes : new Set())
      .filter(t => !HAND_DEFS[t].secret);
    // NO LEGAL SENTENCE IS NO SENTENCE. The fallback used to name 'highCard',
    // and it fired at exactly the moment DOUBLE JEOPARDY had spent the whole
    // docket — which is precisely when highCard is spent too. So the one state
    // where the fallback ran was the one state where obeying it was impossible
    // by construction, and the order was a guaranteed unavoidable 12 HP.
    if (!pool.length) { this.demandedHand = null; this.syncDemandHint(); return null; }
    this.demandedHand = Phaser.Utils.Array.GetRandom(pool);
    sfx(this, 'fear_placed', { volume: 0.85, rate: 0.8 });
    flashVignette(this, DEBUFF_COLORS.courtLock, 0.45);
    popMessage(this, ARENA_CX, 396, 'THE SENTENCE', { color: '#ffb060', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `play a ${HAND_DEFS[this.demandedHand].name.toUpperCase()} this turn, or take ${DEMAND_HAND_DAMAGE} damage`,
      { color: '#ffd9a8', size: 24, rise: 34, delay: 260 });
    this.syncDemandHint();
    this.refreshAll();
    return this.demandedHand;
  }

  /**
   * THE SENTENCE, PINNED (JC, 2026-08-04: "the text naming the type of hand
   * required needs to stay around until after you play your hand"). The pop
   * above is a moment; the order is a STANDING order, so it hangs over the
   * hand in the winterHint's own spot-family until the verdict is read in
   * settleDemand. One writer: whatever demandedHand says, this shows.
   */
  syncDemandHint() {
    if (!this.demandHint) {
      this.demandHint = this.add.text(ARENA_CX, this.previewCeilY - 34, '', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '23px', color: '#ffd9a8',
        stroke: '#3d240f', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(DEPTH.fx).setAlpha(0);
      this.demandHint.setShadow(2, 4, '#000000aa', 7, true, true);
    }
    const t = this.demandedHand;
    if (t) {
      this.demandHint.setText(`THE SENTENCE: play a ${HAND_DEFS[t].name.toUpperCase()}`);
      this.demandHint.setAlpha(1);
    } else {
      this.demandHint.setAlpha(0);
    }
  }

  /** ...and the verdict, read at the moment a hand is committed. */
  settleDemand(playedType) {
    const demanded = this.demandedHand;
    if (!demanded) return 0;
    this.demandedHand = null;
    this.syncDemandHint();
    const { obeyed, damage } = demandVerdict(demanded, playedType);
    if (obeyed) {
      popMessage(this, ARENA_CX, 620, 'SENTENCE SERVED', { color: '#8fe098', size: 30 });
      return 0;
    }
    popMessage(this, ARENA_CX, 620,
      `CONTEMPT: you were told to play a ${HAND_DEFS[demanded].name}`, { color: '#ff8a70', size: 28 });
    this.damagePlayer(damage);
    return damage;
  }

  /** REWEAVE: one card off the deal, for the rest of the fight. */
  shrinkHandSize(step = SHRINK_HAND_STEP) {
    this.handShrink = Math.max(0, (this.handShrink ?? 0) + step);
    this.trimHandToSize();
    sfx(this, 'fear_placed', { volume: 0.8, rate: 0.9 });
    flashVignette(this, DEBUFF_COLORS.fade, 0.4);
    popMessage(this, ARENA_CX, 396, 'REWEAVE', { color: '#e8eefc', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `your hand is dealt ${this.handShrink} card${this.handShrink === 1 ? '' : 's'} smaller for the rest of the fight`,
      { color: '#cfd8ee', size: 24, rise: 34, delay: 260 });
    this.refreshAll();
    return this.handShrink;
  }

  /** AS YOU DID: the Mirrorwalker plays your last hand back at you. */
  mirrorLastHand(enemy, pct = MIRROR_HAND_PCT) {
    const dmg = mirrorDamage(this._lastHandDamage ?? 0, pct);
    popMessage(this, ARENA_CX, 396, 'AS YOU DID', { color: '#e8eefc', size: 46, rise: 54 });
    if (dmg <= 0) {
      popMessage(this, ARENA_CX, 452, 'it has nothing of yours to copy. Not yet',
        { color: '#cfd8ee', size: 24, rise: 34, delay: 240 });
      return 0;
    }
    popMessage(this, ARENA_CX, 452, `your own hand, thrown back: ${fmtNum(dmg)}`,
      { color: '#cfd8ee', size: 24, rise: 34, delay: 240 });
    this.damagePlayer(dmg, enemy);
    return dmg;
  }

  /** FORGET SUIT: one suit means nothing to it, rerolled and announced each turn. */
  rerollForgottenSuit(enemy) {
    const hand = (this.handCards ?? []).map(c => c.card);
    const suit = pickForgottenSuit(hand, Math.random, enemy.forgetSuit ?? null);
    enemy.forgetSuit = suit;
    sfx(this, 'card_deselect', { volume: 0.6, rate: 0.9 });
    this.floatText(enemy, `FORGETS ${SUIT_GLYPH[suit] ?? suit.toUpperCase()}`, '#cfd8ee');
    popMessage(this, ARENA_CX, 452,
      `${SUIT_GLYPH[suit] ?? suit.toUpperCase()} deal it no damage this turn`,
      { color: '#cfd8ee', size: 24, rise: 34, delay: 160 });
    return suit;
  }

  /** Dispatch one BIOME_EFFECT (called from enemyTurn's effect loop). */
  runBiomeEffect(enemy, eff, intent) {
    switch (eff.type) {
      case 'condemn': return this.condemnCards(eff.value ?? 1);
      case 'burnPlayed': return this.armBurnPlayed(enemy);
      case 'handTypeOnce': return this.armDoubleJeopardy(enemy);
      case 'demandHand': return this.demandOneHand();
      case 'hangRelic': return this.hangRelic();
      case 'wall': return this.raiseWall(enemy, eff.handType ?? eff.value ?? null);
      case 'unusedOnly': return this.armUnusedOnly(enemy);
      case 'forgetSuit': return this.rerollForgottenSuit(enemy);
      case 'mirrorHand': return this.mirrorLastHand(enemy, eff.value ?? MIRROR_HAND_PCT);
      case 'shrinkHand': return this.shrinkHandSize(eff.value ?? SHRINK_HAND_STEP);
      case 'dropHand': return this.armDropHand(enemy);
      case 'healMirror': return this.armHealMirror(enemy);
      case 'cardTax': return this.armCardTax(eff.value ?? CARD_TAX_PER_CARD);
      case 'markCard': return this.markOneCard();
      default: return undefined;
    }
  }

  /** PYREHEART: from now on, every card you play is burned. */
  armBurnPlayed(enemy) {
    if (this.burnPlayed) return false;
    this.burnPlayed = true;
    this.floatText(enemy, 'STRUCK FROM THE RECORD', '#ff9a50');
    popMessage(this, ARENA_CX, 396, 'STRUCK FROM THE RECORD', { color: '#ff9a50', size: 42, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      'every card you play from now on is BURNED. It cannot be played again this fight, reshuffle or not',
      { color: '#ffc9a0', size: 23, rise: 34, delay: 260 });
    this.refreshAll();
    return true;
  }

  /** THE MAGISTRATE: each hand type may be played once for the whole fight. */
  armDoubleJeopardy(enemy) {
    if (this.handTypeOnce) return false;
    this.handTypeOnce = true;
    this.floatText(enemy, 'DOUBLE JEOPARDY', '#ffb060');
    popMessage(this, ARENA_CX, 396, 'DOUBLE JEOPARDY', { color: '#ffb060', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      'each hand type may be played ONCE for the whole fight. Play a Pair and you have played your only Pair',
      { color: '#ffd9a8', size: 23, rise: 34, delay: 260 });
    this.refreshAll();
    return true;
  }

  /** THE UNMADE: from now on, whatever you hold back at end of turn is gone. */
  armDropHand(enemy) {
    if (this.dropHandOn) return false;
    this.dropHandOn = true;
    this.floatText(enemy, 'WEIGHTLESS', '#cfd8ee');
    popMessage(this, ARENA_CX, 396, 'WEIGHTLESS', { color: '#e8eefc', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      'cards left in your hand at the end of a turn drift away and are gone for this fight',
      { color: '#cfd8ee', size: 24, rise: 34, delay: 260 });
    this.refreshAll();
    return true;
  }

  /** THE MOONWELL HORROR: every point of HP you heal, it heals too. */
  armHealMirror(enemy) {
    if (enemy.healMirror) return false;
    enemy.healMirror = true;
    this.floatText(enemy, 'REFLECTION', '#aebeff');
    popMessage(this, ARENA_CX, 452, 'every point of HP you heal, it heals too',
      { color: '#d0d8ff', size: 24, rise: 34, delay: 160 });
    this.refreshAll();
    return true;
  }

  /** BRAZIER TITAN: every hand costs HP equal to the cards in it. */
  armCardTax(rate = CARD_TAX_PER_CARD) {
    this.cardTaxRate = Math.max(this.cardTaxRate ?? 0, rate);
    flashVignette(this, DEBUFF_COLORS.burned, 0.4);
    popMessage(this, ARENA_CX, 396, 'PYRE TAX', { color: '#ff9a50', size: 46, rise: 54 });
    popMessage(this, ARENA_CX, 452,
      `every hand you play now costs ${this.cardTaxRate} HP per card in it`,
      { color: '#ffc9a0', size: 24, rise: 34, delay: 260 });
    this.refreshAll();
    return this.cardTaxRate;
  }

  /** THE PALE ARCHITECT: a wall, and the ONE hand type that breaks it. */
  raiseWall(enemy, type = null) {
    const pool = Object.keys(HAND_DEFS).filter(t => !HAND_DEFS[t].secret);
    enemy.wall = (type && HAND_DEFS[type]) ? type : Phaser.Utils.Array.GetRandom(pool);
    sfx(this, 'shield', { volume: 0.8, rate: 0.85 });
    this.floatText(enemy, `WALL: ${HAND_DEFS[enemy.wall].name.toUpperCase()}`, '#e8eefc');
    popMessage(this, ARENA_CX, 452,
      `damage does not reach it until you play a ${HAND_DEFS[enemy.wall].name.toUpperCase()}`,
      { color: '#cfd8ee', size: 24, rise: 34, delay: 160 });
    this.refreshAll();
    return enemy.wall;
  }

  /** SERAPH OF THE STILL: it only takes damage from a hand you have not played. */
  armUnusedOnly(enemy) {
    if (enemy.unusedOnly) return false;
    enemy.unusedOnly = true;
    this.floatText(enemy, 'NOTHING TWICE', '#e8eefc');
    popMessage(this, ARENA_CX, 452,
      'it only takes damage from a hand type you have NOT played yet this fight',
      { color: '#cfd8ee', size: 24, rise: 34, delay: 160 });
    this.refreshAll();
    return true;
  }

  /** The PYRE TAX bite, paid at the moment a hand is committed. Shield eats it. */
  cardTaxToll(n) {
    const bite = cardTaxFor(n, this.cardTaxRate ?? 0);
    if (bite <= 0) return 0;
    const { absorbed, through } = absorbSpikes(this.player.shield, bite);
    this.player.shield -= absorbed;
    this.player.hp = Math.max(0, this.player.hp - through);
    sfx(this, 'hit_stab', { volume: 0.8, rate: 0.85 });
    flashVignette(this, DEBUFF_COLORS.burned, 0.4);
    this.heroDebuff(DEBUFF_COLORS.burned);
    popNumber(this, SIDEBAR_W / 2, 422, `-${bite} pyre tax`, { color: '#ff9a50', size: 34 });
    return bite;
  }

  // ---------------- WARDING & PICKPOCKET (enemy-side effects) ----------------

  /** Dispatch one SELF_EFFECT (called from enemyTurn's effect loop). */
  runEnemyEffect(enemy, eff, intent) {
    switch (eff.type) {
      case 'shield': return this.enemyWard(enemy, eff, intent);
      case 'stealDiscard': return this.pickpocket(enemy, eff.value ?? 1);
      default: return undefined;
    }
  }

  /**
   * WARDING. A hex plate flashes over the target in the biome's tint and the
   * cyan ◆ chip appears on its health bar, to be chewed through before the bar
   * moves again. `target:'ally'` prefers whoever you are currently aiming at,
   * which is exactly what makes the Wayside's support fights a decision.
   */
  enemyWard(enemy, eff, intent) {
    const who = wardTarget(enemy, this.enemies ?? [], {
      target: eff.target ?? 'self', prefer: this.target,
    });
    const amount = shieldGrantFor(enemy, eff.value ?? 10);
    addEnemyShield(who, amount);
    // The plate is dressed by the NAME it is announcing, falling back to the
    // room's biome. Act IV remixes creatures across worlds, so an Ice Mage
    // casting FROST SHIELD in the Abyss should still flash blue rather than
    // taking the room's violet and disagreeing with its own label.
    const byName = Object.values(WARD_LOOK).find(l => l.name === intent?.label);
    const look = byName ?? WARD_LOOK[this.act.ambience] ?? WARD_LOOK.forest;
    const name = intent?.label && intent.label !== 'Attack' ? intent.label : look.name;
    sfx(this, 'shield', { volume: 0.85, rate: 0.98 });
    popMessage(this, enemy.homeX, enemy.homeY - 150, name, { color: look.ink, size: 32 });

    // The hex plate: a slab of the biome's colour snapping shut over the body.
    const plate = this.add.image(who.homeX, who.homeY - 20,
      this.textures.exists('fx_hex') ? 'fx_hex' : 'fx_glow_circle')
      .setTint(look.tint).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
    const rest = Math.max(160, (who.sprite?.displayWidth ?? 160) * 1.15);
    plate.setDisplaySize(rest * 1.5, rest * 1.5);
    this.tweens.add({
      targets: plate, alpha: 0.95, displayWidth: rest, displayHeight: rest,
      duration: 220, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: plate, alpha: 0, duration: 420, delay: 220, onComplete: () => plate.destroy(),
      }),
    });
    // ...and, when it plates somebody else, a visible line of custody.
    if (who !== enemy) {
      const beam = this.add.image((enemy.homeX + who.homeX) / 2, (enemy.homeY + who.homeY) / 2 - 30, 'fx_glow')
        .setTint(look.tint).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 3);
      const dx = who.homeX - enemy.homeX, dy = who.homeY - enemy.homeY;
      beam.setDisplaySize(Math.hypot(dx, dy), 30).setRotation(Math.atan2(dy, dx));
      this.tweens.add({
        targets: beam, alpha: 0.9, duration: 150, yoyo: true, hold: 160,
        onComplete: () => beam.destroy(),
      });
    }
    burst(this, who.homeX, who.homeY - 30, look.tint, 12);
    popNumber(this, who.homeX, who.homeY - 100, `◆+${fmtNum(amount)}`, { color: '#9aeaff', size: 32 });
    this.refreshAll();
    return amount;
  }

  /**
   * PICKPOCKET. One discard off the fight, floored at 0. With nothing left to
   * take it still TELEGRAPHS and still resolves — it just fizzles with a
   * "nothing to take" beat, because an intent that silently does nothing reads
   * as a bug.
   */
  pickpocket(enemy, n = 1) {
    const before = this.discardsLeft;
    if (before <= 0 || this.prop('freeDiscards') > 0) {
      this._lastSteal = { took: 0, left: before };
      sfx(this, 'card_deselect', { volume: 0.55, rate: 0.9 });
      popMessage(this, enemy.homeX, enemy.homeY - 120, 'nothing to take', { color: '#c8bcae', size: 26 });
      this.tweens.add({
        targets: enemy.sprite, angle: { from: -5, to: 5 }, duration: 70,
        yoyo: true, repeat: 1, onComplete: () => enemy.sprite.setAngle(0),
      });
      return 0;
    }
    this.discardsLeft = stealDiscards(before, n);
    const took = before - this.discardsLeft;
    this._lastSteal = { took, left: this.discardsLeft };
    sfx(this, 'chips_stack', { volume: 0.7, rate: 1.3 });
    // The pip flies off the HUD and into its hands.
    const pip = this.add.image(50, this.hudIcons?.trash?.y ?? 528, 'icon_trash')
      .setTint(0xff8a70).setDepth(DEPTH.fx + 2);
    pip.setScale(34 / Math.max(pip.width, pip.height));
    this.tweens.add({
      targets: pip, x: enemy.homeX, y: enemy.homeY - 40, scale: pip.scale * 0.4,
      angle: 420, alpha: 0, duration: 520, ease: 'Cubic.easeIn',
      onComplete: () => { pip.destroy(); burst(this, enemy.homeX, enemy.homeY - 40, 0xff8a70, 10); },
    });
    // ...and the DISCARD button flashes red, because that is the button that
    // just got worse.
    if (this.discardBtn) {
      this.discardBtn.setTint(0xff5060);
      this.tweens.add({
        targets: [this.discardBtn, this.discardBtn.label], scale: 1.1, duration: 110,
        yoyo: true, repeat: 1, onComplete: () => this.discardBtn.clearTint(),
      });
    }
    flashVignette(this, 0xd82838, 0.3);
    popMessage(this, enemy.homeX, enemy.homeY - 120, `STOLEN: −${took} DISCARD`, { color: '#ff8a70', size: 30 });
    popNumber(this, 150, this.hudIcons?.trash?.y ?? 528, `−${took}`, { color: '#ff5060', size: 30 });
    this.refreshAll();
    return took;
  }

  // ---------------- CUT AND RUN ----------------

  /**
   * One turn off a thief's clock. At zero it takes its purse and goes.
   *
   * THE RULING (Claude's, flagged for JC): the thief leaving does NOT cost you
   * the fight or the rewards. If other bodies remain the fight simply continues
   * without it; if it was the last one standing the fight ENDS and pays the
   * normal hands-left purse, minus what it took. The punishment is the THEFT.
   * Losing a whole room's rewards to a timer would be a rage-quit mechanic
   * rather than a tension mechanic.
   */
  spendFleeTurn(enemy) {
    if (!enemy?.alive || !enemy.def?.flee) return null;
    const left = tickFleeClock(enemy);
    if (left > 0) {
      sfx(this, 'score_tick', { volume: 0.5, rate: 1.4 - left * 0.1 });
      this.refreshAll();
      if (enemy.fleeText?.active) {
        this.tweens.add({
          targets: [enemy.fleeText, enemy.fleeIcon], scale: { from: 1.6, to: 1 },
          duration: 260, ease: 'Back.easeOut',
        });
      }
      return left;
    }
    this.enemyFlees(enemy);
    return 0;
  }

  /** It bolts, in a dust puff, trailing coins. */
  enemyFlees(enemy) {
    // The RULE (steal, leave, is-the-fight-over) is pure and lives in
    // core/enemies.resolveFlee; this owns only the theatre. The fight's own
    // end-of-round check reads livingEnemies(), so a last-body escape falls
    // straight into the normal fightWon path and pays the normal purse.
    const { took, chipsLeft } = resolveFlee(enemy, this.enemies ?? [], run.chips);
    run.chips = chipsLeft;
    (this._fleeLog ??= []).push({ id: enemy.def.id, took });
    sfx(this, 'chips_stack', { volume: 0.9, rate: 0.85 });
    sfxCapped(this, 'card_deal', { volume: 0.8, rate: 0.7 }, 200);
    shake(this, 0.006, 320);
    // The body bolts off the near edge...
    enemy.sprite.disableInteractive();
    enemy.bobTween?.remove();
    this.tweens.add({
      targets: enemy.sprite, x: GAME_W + 260, y: enemy.homeY - 30, angle: 26,
      duration: 620, ease: 'Cubic.easeIn',
    });
    // ...leaving a dust puff and a trail of coins behind it.
    for (let i = 0; i < 14; i++) {
      const d = this.add.image(enemy.homeX + Phaser.Math.Between(-40, 40), enemy.groundY ?? enemy.homeY,
        i % 3 ? 'fx_dust' : 'icon_coins')
        .setTint(i % 3 ? 0xd8c8a0 : 0xffffff).setDepth(DEPTH.arena + 3)
        .setScale(i % 3 ? Phaser.Math.FloatBetween(0.2, 0.5) : 0.16).setAlpha(0.95);
      this.tweens.add({
        targets: d, x: d.x + Phaser.Math.Between(120, 420), y: d.y - Phaser.Math.Between(20, 150),
        alpha: 0, angle: Phaser.Math.Between(-260, 260),
        duration: Phaser.Math.Between(480, 900), delay: i * 24,
        ease: 'Cubic.easeOut', onComplete: () => d.destroy(),
      });
    }
    enemy.flePulse?.remove(); enemy.flePulse = null;
    this.tweens.add({
      targets: [enemy.uiName, enemy.hpBack, enemy.hpFill, enemy.hpText, enemy.intentHit,
        enemy.shieldIcon, enemy.shieldText, enemy.fleeText, enemy.fleeIcon, enemy.fleeRing,
        enemy.targetRing, ...(enemy.deathParts ?? []),
        ...Object.values(enemy.statusUI ?? {}).flatMap(s => [s.icon, s.text])].filter(Boolean),
      alpha: 0, duration: 420,
    });
    enemy.intentIcons?.removeAll(true);
    enemy._intentSig = null;
    this.bigMessage(`GONE. And ◉${took} with it.`, '#ffd23e', 62, 1100, 300);
    this.retargetIfDead();
    this.refreshAll();
    return took;
  }

  /** The countdown over a thief's head, rebuilt only when the number moves. */
  syncFleeUI(enemy) {
    if (!enemy.def?.flee) return;
    const n = enemy.fleeLeft ?? 0;
    const show = enemy.alive && n > 0;
    for (const o of [enemy.fleeText, enemy.fleeIcon, enemy.fleeRing]) o?.setVisible(show);
    if (!show) return;
    if (enemy.fleeText.text !== `${n}`) {
      enemy.fleeText.setText(`${n}`);
      // Each turn it pulses harder: the last one is a genuine alarm.
      enemy.flePulse?.remove();
      enemy.flePulse = this.tweens.add({
        targets: [enemy.fleeText, enemy.fleeIcon], scale: 1 + (4 - n) * 0.07,
        duration: Math.max(240, 620 - (3 - n) * 150),
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      enemy.fleeText.setColor(n <= 1 ? '#ff5060' : n === 2 ? '#ffb347' : '#ffd23e');
    }
  }

  /** The spike bite, paid at the moment a hand is committed. */
  spikeToll() {
    const jab = spikeBite(this.pstat);
    if (jab <= 0) return 0;
    const { absorbed, through } = absorbSpikes(this.player.shield, jab);
    this.player.shield -= absorbed;
    this.player.hp = Math.max(0, this.player.hp - through);
    sfx(this, 'hit_stab', { volume: 0.8, rate: 1.15, jitter: 0.05 });
    flashVignette(this, DEBUFF_COLORS.spikes, 0.4);
    shake(this, 0.005, 200);
    // Shards fly off the ring: the thorns bit, and you can see which pool paid.
    if (this.spikeRing?.active) {
      this.tweens.add({ targets: this.spikeRing, scale: 0.86, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = this.add.image(this.heroHome.x + Math.cos(a) * 84, this.heroHome.y + Math.sin(a) * 84,
        i % 2 ? 'fx_star' : 'fx_dust').setTint(0x9adcff).setScale(0.16)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.panel + 4);
      this.tweens.add({
        targets: p, x: p.x + Math.cos(a) * 110, y: p.y + Math.sin(a) * 110,
        alpha: 0, scale: 0.02, angle: Phaser.Math.Between(-200, 200),
        duration: Phaser.Math.Between(320, 600), ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
      });
    }
    if (absorbed > 0) { this.heroShield(); popNumber(this, 160, 468, `◆-${absorbed}`, { color: '#7fe0f4', size: 30 }); }
    if (through > 0) {
      this.heroDebuff(DEBUFF_COLORS.spikes);
      popNumber(this, SIDEBAR_W / 2, 422, `-${through} spikes`, { color: '#9adcff', size: 34 });
    }
    return jab;
  }

  // =========================================================================
  // PARTS 3 & 4 — ELITE AND BOSS SIGNATURES (2026-08-02)
  // -------------------------------------------------------------------------
  // Seven elites, one signature each, plus Wolfowl's TALON GRIP. Every rule
  // that can be arithmetic IS arithmetic and lives in core/enemies.js
  // (shieldAfterShatter · feastHeal · aegisImmuneOn · wrathPowerFor); this file
  // owns the theatre and the wiring, exactly like parts 1 and 2.
  //
  // NOTHING HERE IS A NEW DENIAL. TALON GRIP is applySuitSeal with a named
  // suit and DREAD GRIP is applyRooted with Infinity turns, so both go through
  // `cardDenied` and land in `deadlockState` with no special case at all.
  // =========================================================================

  /** The signature this body carries, or null. One table, in core/enemies.js. */
  signature(enemy) { return signatureOf(enemy?.def); }

  /**
   * The LIVE line on the signature badge. It is not decoration: the Aegis
   * counts the turns down to its next shell, the Wrath prints the multiplier it
   * is about to swing at, the pack prints how many wolves it may still call.
   * A passive the player can only infer is just unexplained damage.
   */
  signatureLine(enemy) {
    const sig = signatureOf(enemy?.def);
    if (!sig) return '';
    switch (enemy.def.special) {
      case 'shatterguard': return 'SHATTERGUARD · you gain ◆0';
      case 'feast': return `FEAST · heals ×${FEAST_MULT} of your HP`;
      case 'pack': {
        const out = this.enemies?.filter(e => e.alive && e.def?.id === 'packWolf').length ?? 0;
        return `CALL OF THE PACK · ${out}/${PACK_CAP} at his heel`;
      }
      case 'stillness': {
        const nap = turnsUntilAegis((enemy.turnCount ?? 0) + 1);
        return enemy.immune ? 'STILLNESS · ASLEEP, UNTOUCHABLE'
          : `STILLNESS · sleeps in ${nap} turn${nap === 1 ? '' : 's'}`;
      }
      case 'glacialAegis': {
        const next = turnsUntilAegis((enemy.turnCount ?? 0) + 1);
        return enemy.immune ? 'GLACIAL AEGIS · IMMUNE NOW'
          : `GLACIAL AEGIS · shell in ${next} turn${next === 1 ? '' : 's'}`;
      }
      case 'dreadGrip': return `DREAD GRIP · −${DREAD_GRIP_POWER} cards, all fight`;
      case 'rimeThorns': return `RIME THORNS · +${RIME_THORNS_ELITE} SPIKES a turn`;
      case 'wakingWrath': {
        const p = enemy.voidPower ?? 1;
        if (p <= 0) return 'WAKING WRATH · still asleep';
        return `WAKING WRATH · ×${p.toFixed(2)}, then ×${(p * WRATH_RAMP).toFixed(2)}`;
      }
      case 'talonGrip': return `TALON GRIP · its Bleed locks ${TALON_GRIP_SUIT.toUpperCase()}`;
      default: return sig.name;
    }
  }

  /** Keep the badge saying the truth. Called for every living body, every refresh. */
  syncSignatureBadge(enemy) {
    const t = enemy?.sigText;
    if (!t?.active) return;
    if (!enemy.alive) { t.setVisible(false); return; }
    const line = this.signatureLine(enemy);
    if (t.text !== line) {
      t.setText(line);
      this.tweens.add({ targets: t, scale: 1.16, duration: 130, yoyo: true, ease: 'Back.easeOut' });
    }
  }

  // ---------------- E1 · SHATTERGUARD (Frost Titan) ----------------

  /**
   * The aura goes up at the opening bell and the plate you walked in with goes
   * with it — otherwise a Bulwark could stroll in already armoured and the
   * "you gain NO Shield" sentence would be a half-truth on turn one.
   */
  raiseShatterguard(enemy) {
    this.shatterguard = true;
    const had = this.player.shield;
    this.player.shield = 0;
    sfx(this, 'frozen_placed', { volume: 0.95, rate: 0.7 });
    shake(this, 0.008, 380);
    flashVignette(this, DEBUFF_COLORS.freeze, 0.55);
    // A cracked shield sigil hangs over the Titan for the whole fight.
    if (enemy?.alive) {
      const sigil = this.add.image(enemy.homeX, enemy.homeY - 30, 'icon_shield')
        .setTint(0x9adcff).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
      sigil.setScale(190 / Math.max(sigil.width, sigil.height));
      this.tweens.add({ targets: sigil, alpha: 0.9, scale: sigil.scale * 0.62, duration: 380, ease: 'Back.easeOut' });
      // ...and it visibly BREAKS: two halves shear apart and drift.
      this.time.delayedCall(620, () => {
        if (!sigil.active) return;
        burst(this, enemy.homeX, enemy.homeY - 30, 0x9adcff, 18);
        this.tweens.add({
          targets: sigil, alpha: 0, scaleX: sigil.scaleX * 1.5, duration: 420,
          onComplete: () => sigil.destroy(),
        });
      });
      this.shatterAura = this.add.image(enemy.homeX, enemy.homeY - 20, 'fx_glow_circle')
        .setTint(0x5fb8ff).setAlpha(0.18).setScale(0.9)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 1);
      this.tweens.add({
        targets: this.shatterAura, alpha: 0.42, scale: 1.05,
        duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
    // The HUD's own shield readout is struck through for the rest of the fight.
    this.syncShatterMark();
    // x=185, not the ◆ readout's own x=70: these two are SENTENCES, and a
    // sentence centred on 70 hangs half of itself off the left edge of the
    // screen (the shield pops that live there are three characters long).
    if (had > 0) popNumber(this, 185, 452, `◆-${had} SHATTERED`, { color: '#9adcff', size: 32 });
    this.refreshAll();
  }

  /** The red line through the sidebar's ◆ readout while SHATTERGUARD holds. */
  syncShatterMark() {
    const on = !!this.shatterguard;
    if (!on) {
      if (this.shatterMark) { this.shatterMark.destroy(true); this.shatterMark = null; }
      return;
    }
    if (this.shatterMark?.active) return;
    // A STRIKE-THROUGH, not a blindfold: it has to cross the ◆ readout while
    // leaving the number underneath legible, so the bar is thin and its dark
    // backing thinner still.
    const t = this.shieldText;
    const mark = this.add.container(0, 0).setDepth(DEPTH.panel + 4);
    const x = t?.x ?? 70, y = (t?.y ?? 468) + 1;
    const edge = this.add.rectangle(x, y, 82, 7, 0x2a0810, 0.38).setAngle(-9);
    const bar = this.add.rectangle(x, y, 78, 4, 0xd82838, 1).setAngle(-9);
    mark.add([edge, bar]);
    this.shatterMark = mark;
    this.tweens.add({ targets: bar, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** One shattered grant: it must never be silent. */
  shatterPlate(amount) {
    sfxCapped(this, 'card_deselect', { volume: 0.75, rate: 0.62 }, 220);
    popNumber(this, 185, 452, '◆0 SHATTERED', { color: '#9adcff', size: 30 });
    if (this.shatterMark?.active) {
      this.tweens.add({ targets: this.shatterMark, scale: 1.35, duration: 110, yoyo: true, ease: 'Back.easeOut' });
    }
    // Shards of the plate that never was, flying off the readout.
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = this.add.image(70, 468, i % 2 ? 'fx_star' : 'fx_dust').setTint(0x9adcff)
        .setScale(0.13).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 2);
      this.tweens.add({
        targets: s, x: 70 + Math.cos(a) * 90, y: 468 + Math.sin(a) * 60,
        alpha: 0, scale: 0.02, angle: Phaser.Math.Between(-200, 200),
        duration: Phaser.Math.Between(300, 560), ease: 'Cubic.easeOut', onComplete: () => s.destroy(),
      });
    }
    this._shatteredTotal = (this._shatteredTotal ?? 0) + Math.round(amount);
    return 0;
  }

  // ---------------- E2 · FEAST (Bear Mauler) ----------------

  /**
   * It heals FEAST_MULT times whatever it actually took OFF YOUR HP. Damage
   * your Shield ate is worth nothing to it, which is the entire counterplay:
   * plate it or burst it, there is no third answer.
   */
  feast(enemy, hpDamage) {
    const want = feastHeal(hpDamage);
    if (want <= 0 || !enemy?.alive) {
      if (enemy?.alive && hpDamage <= 0) {
        // Say it OUT LOUD when the plate starved it — that is the lesson.
        popMessage(this, enemy.homeX, enemy.homeY - 150, 'FEAST DENIED', { color: '#7fe0f4', size: 30 });
      }
      return 0;
    }
    const healed = healEnemy(enemy, want);
    sfx(this, 'heal', { volume: 0.7, rate: 0.8 });
    // Red tendrils reeling from the hero to the beast.
    for (let i = 0; i < 5; i++) {
      const y0 = this.heroHome.y + Phaser.Math.Between(-40, 40);
      const t = this.add.image(this.heroHome.x, y0, 'fx_glow').setTint(0xd82838)
        .setAlpha(0).setDisplaySize(220, 12 + i * 3).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.fx + 1);
      const dx = enemy.homeX - this.heroHome.x, dy = (enemy.homeY - 40) - y0;
      t.setRotation(Math.atan2(dy, dx));
      this.tweens.add({
        targets: t, alpha: { from: 0.9, to: 0 },
        x: this.heroHome.x + dx * 0.5, y: y0 + dy * 0.5,
        displayWidth: Math.hypot(dx, dy), duration: 420, delay: i * 60,
        ease: 'Cubic.easeIn', onComplete: () => t.destroy(),
      });
    }
    // ...and the bar surges green under a FEAST float.
    this.time.delayedCall(300, () => {
      if (!enemy.alive) return;
      burst(this, enemy.homeX, enemy.homeY - 30, 0x6fdc7f, 16);
      const glow = this.add.image(enemy.homeX, enemy.homeY - 20, 'fx_glow_circle').setTint(0x6fdc7f)
        .setAlpha(0.85).setScale(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 3);
      this.tweens.add({
        targets: glow, alpha: 0, scale: 1.05, duration: 520, ease: 'Cubic.easeOut',
        onComplete: () => glow.destroy(),
      });
      this.tweens.add({ targets: enemy.sprite, scale: enemy.sprite.scale * 1.06, duration: 150, yoyo: true });
      popMessage(this, enemy.homeX, enemy.homeY - 150,
        `FEAST  +${fmtNum(healed)}`, { color: '#6fdc7f', size: 36 });
      this.refreshAll();
    });
    this._feastLog = (this._feastLog ?? 0) + healed;
    return healed;
  }

  // ---------------- E4 · GLACIAL AEGIS (Frost Guardian) ----------------

  /**
   * Close or open the shell for the turn that is ABOUT to be played, exactly
   * the way the Depth Knight morphs at the END of his turn: the form you see on
   * your turn is the form you have to beat. `turn` is the guardian's NEXT turn
   * number, and aegisImmuneOn is the only thing that decides.
   */
  /**
   * One beat for both bodies that use the Aegis cadence. The Frost Guardian
   * only shells; THE LONG SLEEPER also MENDS as it goes under, which is the
   * half of its designed rule the effect vocabulary had no word for. Heal on
   * the TRANSITION into sleep, never every frame it is asleep, or a long
   * fight would out-heal any deck.
   */
  stillOrShell(enemy) {
    const was = !!enemy.immune;
    const now = this.syncAegis(enemy, (enemy.turnCount ?? 0) + 1);
    if (enemy.def.special !== 'stillness' || !now || was) return now;
    const mended = healEnemy(enemy, enemy.maxHp * STILLNESS_MEND);
    if (mended > 0) {
      popNumber(this, enemy.sprite.x, enemy.sprite.y - 120, `+${fmtNum(mended)}`,
        { color: '#7ef0a0', size: 34 });
      sfx(this, 'heal', { volume: 0.5, rate: 0.8 });
    }
    this.refreshAll();
    return now;
  }

  syncAegis(enemy, turn) {
    const want = aegisImmuneOn(turn);
    if (!enemy.alive || !!enemy.immune === want) { this.refreshAll(); return want; }
    enemy.immune = want;
    if (want) {
      sfx(this, 'frozen_placed', { volume: 0.95, rate: 0.75 });
      shake(this, 0.006, 300);
      // Rime closes over it — the Depth Knight's shell in the Wayside's blue.
      this.startMorphAura(enemy, 0x8ad4ff);
      const ring = this.add.image(enemy.homeX, enemy.homeY - 20, 'fx_glow_circle').setTint(0xbfe4ff)
        .setAlpha(0.95).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
      this.tweens.add({
        targets: ring, alpha: 0, scale: 1.4, duration: 520, ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
      for (let i = 0; i < 14; i++) {
        const c = this.add.image(enemy.homeX + Phaser.Math.Between(-90, 90),
          enemy.homeY + Phaser.Math.Between(-90, 90), 'icon_snow')
          .setTint(0xdff2ff).setAlpha(0).setScale(0.34)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
        this.tweens.add({
          targets: c, alpha: { from: 0.95, to: 0 }, x: enemy.homeX, y: enemy.homeY - 20,
          angle: 180, duration: Phaser.Math.Between(320, 560), onComplete: () => c.destroy(),
        });
      }
      enemy.sprite.setTint(0xa8d8ff);
      this.time.delayedCall(260, () => enemy.alive && enemy.sprite.clearTint());
      popMessage(this, enemy.homeX, enemy.homeY - 190, 'GLACIAL AEGIS: IMMUNE',
        { color: '#bfe4ff', size: 34 });
    } else {
      this.stopMorphAura(enemy);
      sfx(this, 'hit_big', { volume: 0.75, rate: 1.1 });
      burst(this, enemy.homeX, enemy.homeY - 20, 0xbfe4ff, 18);
      popMessage(this, enemy.homeX, enemy.homeY - 190, 'THE ICE BREAKS. HIT IT',
        { color: '#ffd23e', size: 32 });
    }
    this.refreshAll();
    return want;
  }

  // ---------------- E7 · WAKING WRATH (Acidic Monstrosity) ----------------

  /**
   * Advance the ramp to the turn AHEAD and shout the new number, so the cliff
   * is on the intent icon before the player commits anything. currentIntent
   * already folds `voidPower` into what it prints, so setting it here is the
   * whole of "the telegraph tells the truth".
   */
  wrathBeat(enemy) {
    if (!enemy.alive) return null;
    const next = wrathPowerFor((enemy.turnCount ?? 0) + 1);
    const was = enemy.voidPower ?? 1;
    enemy.voidPower = next;
    this.refreshAll();
    if (next <= 0) return next;      // it has not woken yet; nothing to shout
    if (was <= 0) {
      popMessage(this, enemy.homeX, enemy.homeY - 190, 'IT WAKES', { color: '#8fe098', size: 40 });
    } else if (next > was) {
      popMessage(this, enemy.homeX, enemy.homeY - 190, `WAKING WRATH  ×${next.toFixed(2)}`,
        { color: '#8fe098', size: 36 });
    }
    // The body swells and burns brighter every turn it is awake.
    // Capped at 1.24: any bigger and the swollen head climbs over its own
    // nameplate and the intent row, which is the one thing that must stay
    // readable in this fight.
    const grow = Math.min(1.24, 1 + Math.log(1 + next) * 0.09);
    const base = enemy._wrathBaseScale ?? (enemy._wrathBaseScale = enemy.sprite.scale);
    this.tweens.add({
      targets: enemy.sprite, scale: base * grow, duration: 420, ease: 'Back.easeOut',
    });
    this.stopMorphAura(enemy);
    if (next > 1) {
      this.startMorphAura(enemy, 0x8fe098, Math.min(0.55, 0.16 + next * 0.05));
      shake(this, Math.min(0.010, 0.003 + next * 0.0008), 260);
      sfxCapped(this, 'hit_big', { volume: 0.55, rate: 0.7 }, 300);
    }
    return next;
  }

  // ---------------- Fight start / enemies ----------------
  startFight() {
    if (this.enemyLayer) this.enemyLayer.destroy(true);
    this.enemyLayer = this.add.container(0, 0).setDepth(DEPTH.arena);

    // A boss may bring company to the opening bell (def.openers) and may
    // reserve a bigger arena layout than its opening line-up needs
    // (def.slotCount) so mid-fight arrivals have a pedestal waiting.
    const lead = this.encounter.defs[0];
    const defs = [
      ...this.encounter.defs,
      ...(lead?.openers ?? []).map(id => ENEMY_DEFS[id]).filter(Boolean),
    ];
    // Boss / ELITE / ordinary, resolved in one place. An act with no elite pool
    // falls back to its fight pool, so the original four acts are unchanged.
    playMusic(this, musicFor(this.act, this.node.type));
    const wanted = Math.max(defs.length, lead?.slotCount ?? 0);
    this.enemySlots = ENEMY_SLOTS[wanted] ?? ENEMY_SLOTS[Math.min(defs.length, 3)];
    const slots = this.enemySlots;
    this.enemies = defs.map((def, i) => this.spawnEnemy(def, slots[i], i));
    // Bosses trade the little over-the-head plate for the top-of-arena marquee
    // (JC, 2026-08-04). After the map, so a duo can split the strip.
    this.layoutBossBars();
    this.targetIndex = 0;

    // (No chip budget any more: enemies drop nothing and the ten-hand clock
    // pays the whole purse at victory — see fightWon / handsPurse.)

    // (Ophelia's poison used to be BANKED off the corpses of one fight and
    // seeded into the next. Retired 2026-08-02: a fight that opened with a
    // stack of free venom on the front body was doing the first hand's work
    // for her. Her 50% damage-to-poison conversion is untouched.)

    // Queued one-shots from events / the High Priestess.
    if (run.pending.shield > 0) {
      const blessed = this.addShield(run.pending.shield);
      popNumber(this, SIDEBAR_W / 2, 468, `+${blessed} blessed shield`, { color: '#7fe0f4', size: 28 });
      run.pending.shield = 0;
    }
    if (run.pending.enemyPoison > 0) {
      for (const e of this.enemies) e.statuses.poison = (e.statuses.poison ?? 0) + run.pending.enemyPoison;
      run.pending.enemyPoison = 0;
    }

    if (this.node.type === 'boss') {
      // The whole fight breathes red — subtle, under the low-HP vignette.
      this.makeEdgeVignette(0x8a0a18, 0.04, 0.11, 2800, DEPTH.fx);
      suspense(this, { volume: 0.8 });
      actionText(this, ARENA_CX + 120, 400, 'txt_warning', 1.15, 3600);
      // fillAlpha must be 1 — a rect built with fillAlpha 0 renders nothing no
      // matter what .alpha tweens to (same trap the payoff blackout fixed).
      const vignette = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xaa0010, 1)
        .setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
      this.tweens.add({
        targets: vignette, alpha: 0.18, duration: 340, yoyo: true, repeat: 2, ease: 'Sine.easeInOut',
        onComplete: () => vignette.destroy(),
      });
      // The border pulse is the star: ~3 clear crimson flares along the screen edge.
      this.makeEdgeVignette(0xff2030, 0, 0.55, 400, DEPTH.fx + 2, 2);
      shake(this, 0.007, 700);
    } else if (this.node.type === 'elite') {
      suspense(this, { volume: 0.4, rate: 1.1 });
      // The map already promised this; the arena confirms it, so nobody arrives
      // wondering why the health bar is half again as long as it should be.
      popMessage(this, ARENA_CX + 120, 380,
        this.node.forged ? 'FORGED ELITE: harder, and worth it' : 'ELITE: an artifact awaits',
        { color: this.node.forged ? '#ff7a3c' : '#ff8c9a', size: 34, rise: 50 });
    }

    if (this.targetArrow) this.targetArrow.destroy();
    this.targetArrow = this.add.image(0, 86, 'target_arrow').setDepth(DEPTH.arena + 1);
    this.tweens.add({ targets: this.targetArrow, scale: { from: 0.92, to: 1.12 }, duration: 460, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    if (defs.length > 1) {
      popMessage(this, ARENA_CX + 160, 330, say('Click an enemy to target it', 'Tap an enemy to target it'), { color: '#ffc542', size: 30, rise: 40, delay: 600 });
    }

    this.newFightState();
    // Passive boss auras have to be live BEFORE the opening deal (ROOTED
    // changes how many cards that deal is) — newFightState wipes them, so
    // this always follows it.
    this.setupBossSpecials();

    // Poisoned by an event? It catches up with you here.
    if (run.pending.poisonSelf > 0) {
      this.pstat.poison += run.pending.poisonSelf;
      popMessage(this, SIDEBAR_W / 2, 422, `POISONED  +${run.pending.poisonSelf}`, { color: '#6fdc7f', size: 30 });
      run.pending.poisonSelf = 0;
    }

    this.artHook('fightStart');
    if (this.prop('firstHandFactor') > 0) {
      // The live product, not a typed 1.5: a mirrored Hourglass really is x2.25,
      // and buildScoreState multiplies per holder exactly like this.
      const ambush = this.propHolders('firstHandFactor')
        .reduce((m, a) => m * a.props.firstHandFactor, 1);
      this.time.delayedCall(600, () => this.announce(
        `AMBUSH: your first hand strikes at ×${Math.round(ambush * 100) / 100}`, '#ffd23e'));
    }

    this.dealToHandSize(() => this.refreshAll());
  }

  /**
   * Build one enemy into the arena at `slot`, wired for targeting, intents,
   * statuses and death. `rise` is the MID-FIGHT entry (Frozen Rite): the
   * whole info stack fades up while the creature climbs out of the ground,
   * so a summon shares every piece of plumbing an opener has.
   */
  /**
   * FIT A BOSS NAMEPLATE INTO ITS LANE (2026-08-03).
   *
   * Enemy slots are fixed x offsets (enemies.ENEMY_SLOTS) and nothing in the
   * layout has ever read a label's width. That was fine while a two-body board
   * meant THE WINTER PHOENIX beside THE KEEPER, whose plates clear each other
   * by 26px — and it stopped being fine the moment THE LAST COURT put THE
   * HOLLOW KING beside THE MAGISTRATE, which is 332px + 315px of 34px Lilita
   * One in a 330px lane. Six pixels of air, and any name one word longer runs
   * straight through its neighbour's.
   *
   * So a boss name SHRINKS TO ITS LANE rather than colliding, which is the
   * treatment the map medallion already gives THE DAUGHTERS OF DARKNESS. Two
   * constraints, both measured and not guessed:
   *
   *   NEIGHBOURS  the nearest other slot, less 30px of air.
   *   THE MAT     the potion belt (x >= GAME_W-330, y <= 210), which a
   *               right-hand boss's high stack tucks under — the same corner
   *               and the same numbers the shield chip already dodges.
   *
   * It is a no-op for every name that already fits, which is all of them in a
   * one-body fight, so nothing that reads right today changes.
   */
  /**
   * THE HEALTH BAR FITS ITS LANE TOO (2026-08-06).
   *
   * The phone's bar is a size class wider (ENEMY_HUD.barMin 220 -> 300, barMax
   * 300 -> 400) because a 24px-tall bar with a 15px numeral in it is not
   * legible at arm's length — and ENEMY_SLOTS is the SAME table on both builds,
   * so a three-body line-up whose neighbours are 240px apart got three 300px
   * bars drawn through each other. The lane is what it always was; the plate
   * in it now respects it, exactly the way fitBossName already made the
   * nameplate respect it.
   *
   * `neighbourGap` is the same measurement both use, so a bar and a name can
   * never disagree about how much room this body has.
   */
  fitBarWidth(enemy, dispW) {
    let w = Math.min(ENEMY_HUD.barMax, Math.max(ENEMY_HUD.barMin, dispW * 0.9));
    const gap = this.neighbourGap(enemy);
    if (Number.isFinite(gap)) w = Math.min(w, Math.max(140, gap - ENEMY_HUD.barLaneAir));
    return w;
  }

  /** Distance to the nearest OTHER enemy slot, or Infinity in a one-body fight. */
  neighbourGap(enemy) {
    const slots = this.enemySlots ?? [];
    if (slots.length < 2) return Infinity;
    const me = slots[enemy.slotIndex]?.dx;
    if (!Number.isFinite(me)) return Infinity;
    const gaps = slots
      .filter((s, k) => k !== enemy.slotIndex && Number.isFinite(s?.dx))
      .map(s => Math.abs(s.dx - me));
    return gaps.length ? Math.min(...gaps) : Infinity;
  }

  fitBossName(enemy, ex, nameY) {
    const label = enemy.uiName;
    if (!label?.width) return;
    const slots = this.enemySlots ?? [];
    let half = 620;
    if (slots.length > 1) {
      const me = slots[enemy.slotIndex]?.dx;
      if (Number.isFinite(me)) {
        const gap = Math.min(...slots
          .filter((s, k) => k !== enemy.slotIndex && Number.isFinite(s?.dx))
          .map(s => Math.abs(s.dx - me)));
        if (Number.isFinite(gap)) half = Math.min(half, (gap - 30) / 2);
      }
    }
    if (nameY < 210) half = Math.min(half, (GAME_W - 330) - ex);
    half = Math.min(half, ex - (SIDEBAR_W + 20), GAME_W - 20 - ex);
    const want = Math.max(120, half) * 2;
    if (label.width > want) label.setScale(want / label.width);
  }

  /**
   * THE BOSS GETS A MARQUEE (JC, 2026-08-04: "big and wide healthbars that
   * take a substantial portion of the top of the screen... boss name somewhere
   * that matches that more epic vibe... a lot of HUDs are blocking the boss's
   * face"). A boss's health leaves the little plate that was sitting ON its
   * face and becomes a wide bar across the top of the arena — two side by
   * side when two bosses share the stage — with the name staged over it. The
   * intent row stays with the BODY, moved clear above the head into the space
   * the plate vacated. Minions keep their ordinary plates. The 900px strip
   * (680..1580) clears both the sidebar (x<340) and the potion mat (x>=1606
   * while y<=210) by construction.
   *
   * Wiring trick: the marquee reuses the SAME enemy fields the little plate
   * used (uiName/hpBack/hpFill/hpText/shieldIcon/shieldText/statusUI), so
   * refreshAll, the immune dim, and the death teardown drive it unchanged.
   */
  layoutBossBars() {
    const bosses = (this.enemies ?? []).filter(e => e.alive && e.def?.boss);
    if (!bosses.length) return;
    bosses.sort((a, b) => (a.homeX ?? 0) - (b.homeX ?? 0));
    // The strip is a size class wider on the phone (BOSS_BAR.stripW), which the
    // 2340 canvas has room for: 1320 centred on ARENA_CX still clears the 420
    // sidebar and the potion mat at the other end.
    const STRIP_W = BOSS_BAR.stripW, gap = BOSS_BAR.gap;
    const w = bosses.length > 1
      ? (STRIP_W - gap * (bosses.length - 1)) / bosses.length : STRIP_W;
    bosses.forEach((enemy, i) => {
      const cx = ARENA_CX - STRIP_W / 2 + w / 2 + i * (w + gap);
      this.buildBossBar(enemy, cx, w, bosses.length > 1);
    });
  }

  buildBossBar(enemy, cx, w, duo) {
    const ui = enemy.uiGroup, def = enemy.def;
    // The little plate comes down off the face.
    for (const el of [enemy.uiName, enemy.hpBack, enemy.hpFill, enemy.hpText,
      enemy.shieldIcon, enemy.shieldText]) el?.destroy();
    for (const s of Object.values(enemy.statusUI ?? {})) { s.icon?.destroy(); s.text?.destroy(); }
    enemy.bossBar = true;

    const nameY = duo ? BOSS_BAR.nameYDuo : BOSS_BAR.nameY;
    const barY = duo ? BOSS_BAR.barYDuo : BOSS_BAR.barY;
    const barH = duo ? BOSS_BAR.barHDuo : BOSS_BAR.barH;
    enemy.uiName = this.add.text(cx, nameY, `☠  ${def.name}  ☠`, {
      fontFamily: 'Lilita One', resolution: 2,
      fontSize: `${duo ? BOSS_BAR.nameSizeDuo : BOSS_BAR.nameSize}px`,
      color: '#ff5a5a', stroke: '#241505', strokeThickness: duo ? 6 : 8,
    }).setOrigin(0.5);
    enemy.uiName.setShadow(0, 5, '#000000', 10, true, true);
    if (enemy.uiName.width > w - 16) enemy.uiName.setScale((w - 16) / enemy.uiName.width);

    const barShadow = this.add.rectangle(cx + 4, barY + 5, w, barH, 0x120a06, 0.55);
    enemy.hpBack = this.add.rectangle(cx, barY, w, barH, 0x2a1520).setStrokeStyle(4, 0x38220f);
    enemy.hpFill = this.add.rectangle(cx - w / 2 + 3, barY, w - 6, barH - 12, COLORS.enemyHp).setOrigin(0, 0.5);
    enemy.hpBarW = w - 6;
    const accent = this.add.rectangle(cx, barY - barH / 2 - 4, w, 4, 0xff5a5a).setAlpha(0.85);
    enemy.hpText = this.add.text(cx, barY, '', {
      fontFamily: 'Lilita One', resolution: 2,
      fontSize: `${duo ? BOSS_BAR.hpTextSizeDuo : BOSS_BAR.hpTextSize}px`, color: '#fff',
      stroke: '#40101c', strokeThickness: 4,
    }).setOrigin(0.5);

    // The chips tuck UNDER the bar rather than off its ends — the single bar's
    // right end (1580) sits close enough to the potion mat that an outboard
    // chip would slide beneath it. Shield under the right end, statuses
    // marching right from under the left end; a duo bar's chips stay inside
    // its own span by construction.
    const chipY = barY + barH / 2 + BOSS_BAR.chipDrop;
    const shX = cx + w / 2 - 6;
    enemy.shieldText = this.add.text(shX, chipY, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${ENEMY_HUD.chipTextSize}px`, color: '#9aeaff',
      stroke: '#0a2b3a', strokeThickness: 4,
    }).setOrigin(1, 0.5).setAlpha(0);
    enemy.shieldIcon = this.add.image(shX - enemy.shieldText.width - 18, chipY, 'icon_shield')
      .setTint(0x7fe0f4).setAlpha(0);
    enemy.shieldIcon.setScale(ENEMY_HUD.statusIcon / Math.max(enemy.shieldIcon.width, enemy.shieldIcon.height));
    this.bindShieldChipTip(enemy);

    enemy.statusUI = {};
    const sdefs = [['poison', 'icon_skull', 0x63d84a, '#8fe098', '#123a0c'],
      ['bleed', 'icon_sword_small', 0xff5a5a, '#ff9aa4', '#3a0c12'],
      ['brittle', 'icon_shield', 0xe0b050, '#ffd98f', '#3a2a0c']];
    const chipParts = [];
    sdefs.forEach(([key, icon, tint, color, strokeCol], idx) => {
      const sx = cx - w / 2 + 14 + idx * (ENEMY_HUD.statusStep + 12);
      const i = this.add.image(sx, chipY, icon).setTint(tint).setAlpha(0);
      i.setScale(ENEMY_HUD.statusIcon / Math.max(i.width, i.height));
      const t = this.add.text(sx + 15, chipY, '', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${ENEMY_HUD.chipTextSize}px`, color,
        stroke: strokeCol, strokeThickness: 4,
      }).setOrigin(0, 0.5).setAlpha(0);
      chipParts.push(i, t);
      enemy.statusUI[key] = { icon: i, text: t };
    });

    ui.add([barShadow, enemy.hpBack, enemy.hpFill, accent, enemy.uiName, enemy.hpText,
      enemy.shieldIcon, enemy.shieldText, ...chipParts]);
    // The frame pieces are not enemy fields, so the death teardown needs them
    // on the parts list to take the whole marquee down with the body.
    (enemy.deathParts ??= []).push(barShadow, accent);

    // THE FACE, CLEARED: the intent row rises above the head into the space
    // the plate vacated (it used to sit ~82px below the sprite's top, which on
    // a tall boss is squarely on the face — the Magistrate's whole head).
    // ANCHORED A TOUCH INSIDE THE FRAME TOP (JC, 2026-08-04: "some seem to
    // hover pretty far above the heads"): most of Caleb's boss frames carry
    // transparent headroom, so 30px ABOVE the frame floated the row in empty
    // air. +14 into the frame kisses the art's actual crown; the 150 floor
    // still keeps it out of the marquee's chips.
    const headY = Math.max((enemy.groundY ?? 700) - (enemy.sprite?.displayHeight ?? 400) + 14,
      BOSS_BAR.intentFloor);
    enemy.intentY = headY;
    enemy.intentIcons?.setPosition(enemy.homeX, headY);
    enemy.intentHit?.setPosition(enemy.homeX, headY);
    enemy.sigText?.setPosition(enemy.homeX, headY + ENEMY_HUD.sigRow);
  }

  spawnEnemy(def, slot, index, { rise = false, slotIndex = index } = {}) {
    const enemy = makeEnemy(def, this.encounter.scaling);
    enemy.slotIndex = slotIndex;
    const ex = ARENA_CX + slot.dx;
    // ON A STAGE (2026-08-04) the boss stands bigger and a shade deeper into
    // its own clearing. BOSS bodies only — a summoner's raised dead and any
    // openers stay stock so the escort lanes never crowd — and the ground
    // override applies only to a boss standing ALONE, because the multi-slot
    // layouts were hand-placed against their info columns.
    const staged = this.stage && def.boss;
    let groundY = (staged && (this.enemySlots?.length ?? 1) === 1)
      ? this.stage.ground : slot.y;
    // ELITE PRESENCE (JC, 2026-08-04: "don't be afraid to make them look
    // ELITE"). Every elite stands a shade bigger than its stock self; the two
    // he called out get real stature. Regulars sharing the fight stay stock,
    // which is the contrast that says who the elite is.
    const ELITE_PRESENCE = { widowCanopy: 1.3, hangman: 1.28 };
    const presence = (def.elite && !def.boss) ? (ELITE_PRESENCE[def.id] ?? 1.12) : 1;
    const s = def.scale * slot.scaleMul * (staged ? this.stage.scale : 1) * presence;
    // Published on the body so tools/verify_biomes.py can divide it back out.
    // That driver asserts the ARTWORK is sized to its shipped ink band; elite
    // presence is a combat-scene emphasis stacked on top of that, and folding
    // the two together called The Hangman 5px oversized for the crime of being
    // the elite JC asked to make biggest.
    enemy.presence = presence;
    // Some defs ship 3 textures for one creature (Below-Zero Skeletons) — a
    // raised trio should never look copy-pasted.
    // THE MIRRORWALKER is ONE def with five textures: it wears the negative of
    // the hero you are actually playing. `spriteForHero` is checked first
    // because it is a deterministic choice, unlike spriteVariants' random one.
    const texKey = def.spriteForHero?.[run.chrId]
      ?? (def.spriteVariants?.length
        ? def.spriteVariants[Math.floor(Math.random() * def.spriteVariants.length)]
        : def.sprite);
    enemy.sprite = this.add.image(0, 0, texKey).setScale(s);
    let dispW = enemy.sprite.displayWidth, dispH = enemy.sprite.displayHeight;
    const footFrac = def.footFrac ?? 0.06;
    // THE SCREEN RULES (JC, 2026-08-04: "the boss designs in this game are
    // some of the best and just can't be cut off"). A boss's face must clear
    // the marquee, its chips and the intent row (visual top at or below
    // BOSS_TOP), and its feet may come DOWN as far as the hand band's top edge
    // (y=820) but never into it. First choice is standing deeper — Pyreheart,
    // the Unmade and the Magistrate all had headroom below — and only a body
    // too tall for the whole window shrinks, by exactly enough. Duo bosses and
    // escorts pass through the same clamp; a body that already fits is
    // untouched, which is what keeps the Daughters exactly as they are.
    if (def.boss) {
      const BOSS_TOP = 212, BOSS_FLOOR = 824;
      const roomH = (BOSS_FLOOR - BOSS_TOP) / (1 - footFrac);
      if (dispH > roomH) {
        enemy.sprite.setScale(s * (roomH / dispH));
        dispW = enemy.sprite.displayWidth; dispH = enemy.sprite.displayHeight;
      }
      groundY = Phaser.Math.Clamp(groundY, BOSS_TOP + dispH * (1 - footFrac), BOSS_FLOOR);
    }
    // How far the sprite FRAME hangs below the ground line — 0.06 matches the
    // transparent skirt on Caleb's older art; tightly-cropped frames override
    // it via def.footFrac so their feet land ON the pedestal, not through it.
    const ey = groundY - dispH / 2 + dispH * footFrac;
    enemy.sprite.setPosition(ex, ey);
    const ui = this.add.container(0, 0);
    this.enemyLayer.add(ui);

    enemy.targetRing = this.add.image(ex, groundY + 6, 'fx_glow_circle')
      .setTint(0xffc542).setAlpha(0).setScale(dispW / 380, dispW / 950).setBlendMode(Phaser.BlendModes.ADD);
    ui.add(enemy.targetRing);

    const shadow = this.add.image(ex, groundY + 2, 'fx_glow')
      .setTint(0x0a1408).setAlpha(this.stage ? 0.62 : 0.55)
      .setDisplaySize(dispW * 1.3, dispW * 0.34);
    ui.add(shadow);

    // The pedestal was always the interim fix for feet on a painted gradient.
    // A STAGE has real ground, so every body in a staged fight loses the stone
    // and keeps its (slightly deepened) contact shadow instead.
    let pedestal = null;
    if (!this.stage) {
      pedestal = this.add.image(ex, groundY + 4, 'char_platform').setAlpha(0.95);
      pedestal.setDisplaySize(dispW * 1.12, dispW * 1.12 * (pedestal.height / pedestal.width));
      ui.add(pedestal);
    }

    ui.add(enemy.sprite);
    enemy.sprite.setFlipX(!!def.flipX);
    enemy.sprite.setInteractive({ useHandCursor: true });
    tapBind(this, enemy.sprite, () => this.setTarget(index));
    enemy.sprite.on('pointerover', () => {
      if (enemy.alive && index !== this.targetIndex) enemy.sprite.setTint(0xffe2a8);
      if (enemy.alive) this.showIntentTip(enemy);
      // The target indicators GHOST until a body is hovered, then bolden
      // (JC, 2026-08-04): full ink while you are deciding, out of the way
      // the rest of the time.
      this._hoverEnemy = enemy;
      this.syncTargetIndicators();
    });
    enemy.sprite.on('pointerout', () => {
      if (enemy.alive) enemy.sprite.clearTint();
      this.hideIntentTip();
      if (this._hoverEnemy === enemy) this._hoverEnemy = null;
      this.syncTargetIndicators();
    });

    // Info stack rides high above the creature so nothing covers the art.
    // Every offset and every size comes out of ENEMY_HUD; the phone's rows are
    // a size class up and the headroom (`lift`) grew with them, so the bottom
    // of the intent row lands exactly where it always did relative to the head.
    const uiTop = Math.max(groundY - dispH - ENEMY_HUD.lift, 40);
    const nameY = uiTop, hpY = uiTop + ENEMY_HUD.hpRow, intentY = uiTop + ENEMY_HUD.intentRow;
    const barW = this.fitBarWidth(enemy, dispW);
    enemy.uiName = this.add.text(ex, nameY, def.name + (def.boss ? '  ☠' : ''), {
      fontFamily: 'Lilita One', resolution: 2,
      fontSize: `${def.boss ? ENEMY_HUD.bossNameSize : ENEMY_HUD.nameSize}px`,
      color: def.boss ? '#ff5a5a' : '#fff6e0', stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5);
    enemy.hpBack = this.add.rectangle(ex, hpY, barW, ENEMY_HUD.barH, 0x2a1520).setStrokeStyle(3, 0x38220f);
    enemy.hpFill = this.add.rectangle(ex - barW / 2 + 2, hpY, barW - 4, ENEMY_HUD.barFillH, COLORS.enemyHp).setOrigin(0, 0.5);
    enemy.hpBarW = barW - 4;
    enemy.hpText = this.add.text(ex, hpY, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${ENEMY_HUD.hpTextSize}px`,
      color: '#fff', stroke: '#40101c', strokeThickness: 3,
    }).setOrigin(0.5);
    // SHIELD chip, hung off the health bar: the icon_shield glyph + ◆N in
    // cyan, hidden entirely until something grants a pool. It normally sits to
    // the RIGHT of the bar — but a right-hand enemy whose stack rides high
    // would tuck it clean under the potion mat, so in that corner it mirrors to
    // the left of the bar instead.
    //
    // DERIVED FROM THE MAT THAT IS ACTUALLY ON SCREEN (2026-08-10). This was
    // `(GAME_W - 330)` and `hpY < 210` — two numbers hand-measured against a
    // mat that has since moved twice, and which would have gone on quietly
    // agreeing with a mat that was no longer there. potMatZone reproduces the
    // desktop pair to the pixel, so nothing on that build changes hands.
    const mz = this.potMatZone();
    const matBlocked = (ex + barW / 2 + 60) > mz.blockLeft && hpY < mz.blockBottom;
    const chipX = matBlocked ? ex - barW / 2 - 16 : ex + barW / 2 + 16;
    // ...and the NAMEPLATE gets the same treatment, for the same reason and off
    // the same geometry. See fitBossName: a 34px boss name is the one label in
    // the arena long enough to reach its neighbour's.
    // EVERY nameplate now, not only a boss's: the phone prints ordinary names
    // at 30px instead of 23, which is enough for BELOW-ZERO SKELETON to reach
    // its neighbour in a three-body line-up. It is still a no-op for every
    // label that already fits, which is most of them on both builds.
    this.fitBossName(enemy, ex, nameY);
    enemy.shieldIcon = this.add.image(chipX, hpY, 'icon_shield').setTint(0x7fe0f4).setAlpha(0);
    enemy.shieldIcon.setScale(ENEMY_HUD.chipIcon / Math.max(enemy.shieldIcon.width, enemy.shieldIcon.height));
    enemy.shieldText = this.add.text(chipX + (matBlocked ? -14 : 14), hpY, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${ENEMY_HUD.chipTextSize}px`, color: '#9aeaff',
      stroke: '#0a2b3a', strokeThickness: 4,
    }).setOrigin(matBlocked ? 1 : 0, 0.5).setAlpha(0);
    this.bindShieldChipTip(enemy);
    // Free-floating intent icons (no plate) with an invisible hover zone.
    enemy.intentIcons = this.add.container(ex, intentY);
    enemy.intentHit = this.add.rectangle(ex, intentY, INTENT_ART.hitW, INTENT_ART.hitH, 0xffffff, 0.001);
    enemy.intentY = intentY;
    ui.add([enemy.uiName, enemy.hpBack, enemy.hpFill, enemy.hpText,
      enemy.shieldIcon, enemy.shieldText, enemy.intentHit, enemy.intentIcons]);
    // THE SIGNATURE BADGE (2026-08-02). An elite's signature is a passive — it
    // casts nothing, so it has no intent icon and would otherwise be invisible
    // between its opening blurb and the moment it kills you. It rides just under
    // the intent row in the signature's own ink, it is LIVE (the Aegis counts
    // down, the Wrath prints its multiplier), and the intent tooltip repeats the
    // whole rule on hover. refreshAll keeps it honest — see syncSignatureBadge.
    const sig = signatureOf(def);
    if (sig) {
      enemy.sigText = this.add.text(ex, intentY + ENEMY_HUD.sigRow, '', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${ENEMY_HUD.sigSize}px`, color: sig.ink,
        stroke: '#180c04', strokeThickness: 6, align: 'center',
      }).setOrigin(0.5);
      enemy.sigText.setShadow(0, 4, '#000000', 8, true, true);
      ui.add(enemy.sigText);
      this.tweens.add({
        targets: enemy.sigText, alpha: { from: 1, to: 0.62 },
        duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
    // CUT AND RUN's clock, over its head from the very first bell: a coin purse
    // and a big numeral that pulses harder every turn. It is the whole
    // telegraph — you are meant to see the 3 and decide to spend a hand on it.
    if (def.flee) {
      // OFFSET LEFT, not centred: the target arrow lives at (ex, nameY − 34)
      // and the first pass put the numeral straight behind it.
      const fy = nameY - 50, fx = ex - 92;
      enemy.fleeRing = this.add.image(fx + 22, fy, 'fx_glow_circle').setTint(0xffd23e)
        .setAlpha(0.32).setScale(0.34).setBlendMode(Phaser.BlendModes.ADD);
      enemy.fleeIcon = this.add.image(fx, fy, 'icon_coins');
      enemy.fleeIcon.setScale(38 / Math.max(enemy.fleeIcon.width, enemy.fleeIcon.height));
      enemy.fleeText = this.add.text(fx + 46, fy, `${def.flee.turns}`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '46px', color: '#ffd23e',
        stroke: '#3a2405', strokeThickness: 8,
      }).setOrigin(0.5);
      enemy.fleeText.setShadow(0, 5, '#000000', 10, true, true);
      ui.add([enemy.fleeRing, enemy.fleeIcon, enemy.fleeText]);
      this.tweens.add({
        targets: enemy.fleeRing, alpha: 0.6, scale: 0.44,
        duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this.time.delayedCall(700, () => {
        if (!enemy.alive) return;
        popMessage(this, ex, Math.max(40, fy - 46), `THIEF: ◉${def.flee.chips} in ${def.flee.turns} turns`,
          { color: '#ffd23e', size: 26, rise: 34 });
      });
    }
    // OPENING PLATE (def.startShield): some bodies arrive already armoured.
    if (def.startShield > 0) {
      addEnemyShield(enemy, shieldGrantFor(enemy, def.startShield));
    }
    enemy.intentHit.setInteractive({ useHandCursor: true });
    enemy.intentHit.on('pointerover', () => this.showIntentTip(enemy));
    enemy.intentHit.on('pointerout', () => this.hideIntentTip());

    // STATUS CHIPS ON THE HEALTH BAR (JC, 2026-08-04: "poison needs a visual
    // indicator on the enemies... near their health pool"). These used to sit
    // at the creature's FEET at 20px with 0.15-alpha ghosts for zero — which in
    // an arena full of pedestals and shadows read as nothing at all. They now
    // hang off the END of the HP bar exactly like the shield chip does (same
    // size, same idiom), on the side the shield chip is NOT using, stacked
    // outward, and a status at zero is simply not there.
    enemy.statusUI = {};
    const sdefs = [['poison', 'icon_skull', 0x63d84a, '#8fe098', '#123a0c'],
      ['bleed', 'icon_sword_small', 0xff5a5a, '#ff9aa4', '#3a0c12'],
      ['brittle', 'icon_shield', 0xe0b050, '#ffd98f', '#3a2a0c']];
    // The shield chip took chipX; the statuses take the other end of the bar.
    const statusLeft = !matBlocked ? true : false;   // shield right → statuses left
    const sBase = statusLeft ? ex - barW / 2 - 18 : ex + barW / 2 + 18;
    const sStep = (statusLeft ? -1 : 1) * ENEMY_HUD.statusStep;
    sdefs.forEach(([key, icon, tint, color, strokeCol], idx) => {
      const cx = sBase + idx * sStep;
      const i = this.add.image(cx, hpY, icon).setTint(tint).setAlpha(0);
      i.setScale(ENEMY_HUD.statusIcon / Math.max(i.width, i.height));
      const t = this.add.text(cx + (statusLeft ? -15 : 15), hpY, '', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${ENEMY_HUD.chipTextSize}px`, color,
        stroke: strokeCol, strokeThickness: 4,
      }).setOrigin(statusLeft ? 1 : 0, 0.5).setAlpha(0);
      ui.add([i, t]);
      enemy.statusUI[key] = { icon: i, text: t };
    });

    enemy.homeX = ex; enemy.homeY = ey;
    enemy.groundY = groundY;
    enemy.slot = slot;
    enemy.deathParts = [shadow, pedestal].filter(Boolean);
    enemy.uiGroup = ui;
    const bob = () => {
      enemy.bobTween = this.tweens.add({
        targets: enemy.sprite, y: ey - 8, duration: 1300 + index * 180,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    };
    if (rise) {
      // Climbing out of the ice: the stack fades in above while the creature
      // hauls itself up from below the pedestal.
      ui.setAlpha(0);
      enemy.sprite.setY(ey + dispH * 0.9);
      this.tweens.add({ targets: ui, alpha: 1, duration: 420 });
      this.tweens.add({
        targets: enemy.sprite, y: ey, duration: 620, ease: 'Back.easeOut', onComplete: bob,
      });
    } else {
      bob();
    }
    return enemy;
  }

  setTarget(index) {
    if (!this.enemies[index]?.alive) return;
    this.targetIndex = index;
    const enemy = this.enemies[index];
    enemy.sprite.clearTint();
    this.tweens.add({ targets: enemy.targetRing, alpha: { from: 1, to: 0.65 }, duration: 260 });
    if (this.targetArrow) {
      this.targetArrow.x = enemy.homeX;
      this.tweens.add({ targets: this.targetArrow, scale: { from: 1.35, to: 1 }, duration: 180, ease: 'Back.easeOut' });
    }
    this.refreshAll();
    this.updatePreview();
  }

  get target() { return this.enemies[this.targetIndex]; }

  livingEnemies() { return this.enemies.filter(e => e.alive); }

  retargetIfDead() {
    if (!this.target?.alive) {
      const next = this.enemies.findIndex(e => e.alive);
      if (next >= 0) this.targetIndex = next;
    }
  }

  // =========================================================================
  // BOSS SIGNATURE MECHANICS (phase 2, 2026-07-31)
  // -------------------------------------------------------------------------
  // Two shapes. PASSIVE auras (ROOTED, WINTER'S FORCE) are switched on once at
  // the opening bell and read every turn thereafter; INTENT mechanics
  // (HOPQUAKE, FROZEN RITE, SLICE, SISTERS' WARD, VOID SHELL) arrive as effect
  // types on an enemy's turn and are dispatched by runBossEffect. Everything
  // pure lives in core/ (deck.js scrambleSuits/restoreSuits/pickSliceVictims,
  // enemies.js canRaise/freeSlotIndex/morphForm/rampVoidPower) so the rules
  // are unit-testable and this file owns only the theatre.
  // =========================================================================

  /** Switch on the passive auras of whoever showed up, and announce them. */
  setupBossSpecials() {
    const specials = new Set(this.enemies.filter(e => e.def.special).map(e => e.def.special));
    const beat = 1500;   // after the boss entrance flare has finished shouting
    /**
     * SOVEREIGN'S WRIT at the opening bell. The whole-fight passives never
     * arrive as an intent effect, so the writ has to stand here too — once,
     * through the same predicate the intent loop uses.
     *
     * THE BLURB STILL PRINTS. The telegraph is the game telling you what it
     * WOULD do to you, and watching it get struck down IS the mythical's
     * payoff: the sentence lands, then 'THE WRIT!' lands on top of it. A
     * silently-missing set-piece would read as a bug, not as a relic.
     */
    const writ = (special) => this.writBlocksSpecial(
      (this.enemies ?? []).find(e => e.def?.special === special), { delay: beat + 420 });

    if (specials.has('rooted')) {
      // Struck down AFTER the blurb's own beat, so the roots are announced and
      // then refused rather than never mentioned. Nothing is switched on.
      const rooted = writ('rooted');
      if (!rooted) { this.bossHandPenalty = ROOTED_PENALTY; this.growRoots(); }
      this.time.delayedCall(beat, () => {
        this.bossBlurb(`ROOTED: ${ROOTED_PENALTY} fewer cards in hand`, '#8fe098');
        sfx(this, 'fear_placed', { volume: 0.7, rate: 0.8 });
      });
    }
    if (specials.has('wintersForce')) {
      // WINTER'S FORCE dictates which hands you are ALLOWED to play, which is a
      // signature landing squarely on you. The aura never goes up.
      if (!writ('wintersForce')) { this.wintersForce = true; this.winterAura(); }
      this.time.delayedCall(beat, () => {
        this.bossBlurb(`WINTER'S FORCE: play EXACTLY ${this.winterNeed} cards`, '#9adcff');
        sfx(this, 'frozen_placed', { volume: 0.8 });
      });
    }
    if (specials.has('summoner')) {
      this.time.delayedCall(beat, () => this.bossBlurb('FROZEN RITE: he raises the dead', '#9adcff'));
    }
    if (specials.has('hopquake')) {
      this.time.delayedCall(beat, () => this.bossBlurb('HOPQUAKE: he scrambles your suits', '#ffb347'));
    }
    if (specials.has('slice')) {
      this.time.delayedCall(beat, () => this.bossBlurb('THE SISTERS: Agatha cuts, Sinastra wards', '#ff8c9a'));
    }
    if (specials.has('morph')) {
      this.time.delayedCall(beat, () => this.bossBlurb('MORPH: strike only when the shell is open', '#c9a0ff'));
    }

    // --- PARTS 3 & 4 (2026-08-02): the elite tier, and Wolfowl's talons ------
    // Everything below is table-driven off enemies.SIGNATURES, so an eighth
    // signature is a row in that table plus (at most) one switch-on here. They
    // get the SAME opening-bell blurb the bosses get, staggered so a room with
    // two of them reads as two sentences rather than one pile — and staggered by
    // the sentence's OWN lifetime, because 900ms against a 3000ms hold is not a
    // stagger, it is an overlap. See BLURB_HOLD.
    const signed = (this.enemies ?? []).filter(e => SIGNATURES[e.def.special]);
    signed.forEach((enemy, i) => {
      const sig = SIGNATURES[enemy.def.special];
      this.time.delayedCall(beat + i * BLURB_STAGGER, () => {
        if (!enemy.alive) return;
        this.bossBlurb(sig.blurb, sig.ink);
        sfx(this, 'fear_placed', { volume: 0.7, rate: 0.8 });
      });
      // SOVEREIGN'S WRIT, again through the ONE predicate: the blurb above has
      // already been queued (the telegraph always prints), and the switch below
      // is what actually happens to you. Struck down, nothing is switched on.
      // Every signature NOT in WRIT_BLOCKED_SPECIALS — the Aegis, Stillness,
      // the Hunt, the Pack — falls straight through and keeps working.
      if (this.writBlocksSpecial(enemy, { delay: beat + i * BLURB_STAGGER + 420 })) return;
      switch (enemy.def.special) {
        // E1: the aura is live from the bell, and it eats the plate you walked
        // in with — see raiseShatterguard.
        case 'shatterguard': this.time.delayedCall(beat, () => this.raiseShatterguard(enemy)); break;
        // E5: the whole-fight −2, through the ordinary ROOTED door. Applied
        // IMMEDIATELY (not on the blurb's beat) because setupBossSpecials runs
        // BEFORE the opening deal — same reason the Fairy King's aura does —
        // so the very first hand is already two cards light.
        case 'dreadGrip':
          this.applyRooted(Infinity, { power: DREAD_GRIP_POWER, tint: 0x6a3aa8 });
          this.trimHandToSize();   // belt and braces if a deal ever beats us here
          break;
        // E4: the shell state for turn 1 (open, by definition — the cadence
        // starts on turn AEGIS_FIRST_TURN), derived rather than assumed.
        case 'glacialAegis':
        // STILLNESS borrows the Aegis cadence wholesale; only the words differ.
        case 'stillness': this.syncAegis(enemy, 1); break;
        default: break;
      }
    });
    this.refreshAll();
  }

  /**
   * Give back cards the hand is no longer entitled to. Only DREAD GRIP needs
   * it: every other hand-size change happens between deals, but an aura that
   * switches on after the opening deal would otherwise be invisible for a whole
   * hand. Cards go back to the top of the deck, never to the discard pile —
   * they were never played.
   */
  trimHandToSize() {
    let over = this.handCards.length - this.effectiveHandSize;
    if (over <= 0) return 0;
    let taken = 0;
    while (over-- > 0 && this.handCards.length) {
      const cs = this.handCards[this.handCards.length - 1];
      this.handCards = this.handCards.filter(c => c !== cs);
      this.selected = this.selected.filter(c => c !== cs);
      if (this.hypnoCard === cs) this.hypnoCard = null;
      this.deck.push(cs.card);
      taken++;
      this.tweens.add({
        targets: cs, y: cs.y + 180, alpha: 0, angle: cs.angle + 20, scaleX: 0.2,
        duration: 320, ease: 'Cubic.easeIn', onComplete: () => cs.destroy(),
      });
    }
    this.time.delayedCall(340, () => { this.layoutHand(); this.updatePreview(); this.refreshAll(); });
    return taken;
  }

  /** Dispatch one signature effect (called from enemyTurn's effect loop). */
  runBossEffect(enemy, eff, intent) {
    switch (eff.type) {
      case 'quake': return this.applyHopquake(enemy);
      case 'summon': return this.frozenRite(enemy, eff, intent);
      case 'slice': return this.agathaSlice(enemy, eff.value ?? 2);
      case 'ward': return this.sistersWard(enemy, eff.value ?? 9);
      case 'morphBuff': return this.voidShell(enemy, eff.value ?? 75);
      default: return undefined;
    }
  }

  // ---------------- 1. ROOTED (The Fairy King) ----------------

  /**
   * Living green border: root tendrils crawl up out of the bottom screen edge
   * under the fan and sway there all fight. Each tendril is its own Graphics
   * object drawn upward from its own base point, so a tiny angle tween on the
   * object is a believable sway from the root rather than a sliding image.
   */
  growRoots() {
    const layer = this.add.container(0, 0).setDepth(DEPTH.cards - 1);
    this.rootLayer = layer;

    // Undergrowth haze along the whole bottom lip.
    const haze = this.add.image(GAME_W / 2, GAME_H + 10, 'fx_glow')
      .setTint(0x4f9a34).setAlpha(0.18).setDisplaySize(GAME_W * 1.2, 320)
      .setBlendMode(Phaser.BlendModes.ADD);
    layer.add(haze);
    this.tweens.add({ targets: haze, alpha: 0.30, duration: 3200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const N = 22;
    for (let i = 0; i < N; i++) {
      const bx = SIDEBAR_W + 30 + (GAME_W - SIDEBAR_W - 60) * (i / (N - 1)) + Phaser.Math.Between(-18, 18);
      const h = Phaser.Math.Between(80, 195);
      const curl = Phaser.Math.Between(-52, 52);
      const g = this.add.graphics();
      const pts = [];
      for (let k = 0; k <= 14; k++) {
        const t = k / 14;
        pts.push(new Phaser.Math.Vector2(Math.sin(t * Math.PI * 1.35) * curl * t, -h * t));
      }
      // Three passes: a near-black outline for contrast against the dark
      // bottom band, the vine itself, then a lit edge down one side. Without
      // the outline the whole thing dissolves into the arena floor.
      const w = Phaser.Math.Between(9, 14);
      g.lineStyle(w + 5, 0x10240c, 0.85); g.strokePoints(pts, false, false);
      g.lineStyle(w, 0x47962f, 1); g.strokePoints(pts, false, false);
      g.lineStyle(3, 0xb6f07e, 0.8); g.strokePoints(pts, false, false);
      g.setPosition(bx, GAME_H + 12).setAngle(-2);
      layer.add(g);
      this.tweens.add({
        targets: g, angle: { from: -2.4, to: 2.4 },
        duration: 2400 + i * 90, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut', delay: i * 60,
      });
      // A leaf or two clinging near the tip.
      if (i % 2 === 0) {
        const tip = pts[Phaser.Math.Between(9, 13)];
        const leaf = this.add.image(bx + tip.x, GAME_H + 12 + tip.y, 'fx_leaf')
          .setScale(Phaser.Math.FloatBetween(1.8, 3.0)).setAngle(Phaser.Math.Between(-50, 50)).setAlpha(0.95);
        layer.add(leaf);
        this.tweens.add({
          targets: leaf, angle: leaf.angle + Phaser.Math.Between(-16, 16),
          duration: 2200 + i * 70, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }
    }
    // The odd spore drifting up out of the undergrowth.
    this.rootMotes = this.time.addEvent({
      delay: 900, loop: true,
      callback: () => {
        if (!this.rootLayer?.active) { this.rootMotes?.remove(); return; }
        const m = this.add.image(Phaser.Math.Between(SIDEBAR_W + 40, GAME_W - 40), GAME_H - 20, 'fx_dust')
          .setTint(0x9ee06a).setAlpha(0).setScale(Phaser.Math.FloatBetween(0.06, 0.16))
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.cards - 1);
        this.tweens.add({
          targets: m, alpha: { from: 0.7, to: 0 }, y: m.y - Phaser.Math.Between(120, 260),
          x: m.x + Phaser.Math.Between(-40, 40), duration: Phaser.Math.Between(2400, 4200),
          ease: 'Sine.easeOut', onComplete: () => m.destroy(),
        });
      },
    });
  }

  // ---------------- 2. HOPQUAKE (Sabre-Toothed Rabbit) ----------------

  /**
   * Every card in hand gets a RANDOM suit until the end of the round. The hand
   * holds references straight into run.runDeck, so the mutation is receipted
   * (this.quakeStore) and cashed in on the next player turn — see enemyTurn's
   * age counter, plus the belt-and-braces restores in newFightState/fightWon.
   * Scoring and poker read card.suit, so the scramble is genuinely mechanical:
   * your flush is not a flush any more.
   */
  applyHopquake(enemy) {
    this.restoreQuakedSuits(true);   // never nest two quakes
    sfx(this, 'drop_hit', { volume: 0.9, rate: 0.85 });
    shake(this, 0.011, 460);
    popMessage(this, ARENA_CX, 300, 'HOPQUAKE!', { color: '#ffb347', size: 52, rise: 60 });
    this.tweens.add({
      targets: enemy.sprite, y: enemy.homeY - 70, duration: 190,
      yoyo: true, repeat: 1, ease: 'Quad.easeOut',
      onComplete: () => enemy.sprite.setY(enemy.homeY),
    });

    const cards = [...this.handCards];
    if (!cards.length) return;
    // Receipt FIRST (synchronously, off the real pre-quake suits), theatre after.
    this.quakeStore = scrambleSuits(cards.map(cs => cs.card));
    this.quakeAge = 0;

    cards.forEach((cs, i) => {
      this.time.delayedCall(i * 70, () => {
        if (!cs.active || this.handCards.indexOf(cs) < 0) return;
        const nc = this.rebuildHandSprite(cs) ?? cs;
        const restAngle = nc.baseAngle ?? 0;
        this.tweens.add({
          targets: nc, y: nc.y - 58, angle: restAngle + Phaser.Math.Between(-15, 15),
          duration: 165, yoyo: true, ease: 'Quad.easeOut',
          onComplete: () => { if (nc.active) nc.setAngle(restAngle); },
        });
        burst(this, nc.x, nc.y - 24, SUIT_COLORS[nc.card.suit] ?? 0xffc542, 7);
        sfx(this, 'card_deal', { volume: 0.32, rate: 1.3, jitter: 0.14 });
        if (i === cards.length - 1) {
          this.relayoutForSuits();
          this.resyncSuitLocks();
          this.updatePreview();
          this.refreshAll();
        }
      });
    });
  }

  /**
   * Put every scrambled suit back. `rebuild` redraws the sprites of cards that
   * are still in hand; pass false when the hand is about to be thrown away
   * anyway (end of fight, new fight) — the CARDS are what must be healed, and
   * they are healed either way.
   */
  /**
   * HOPQUAKE holds the WHOLE round (JC): any card that enters the hand while
   * the quake is live gets scrambled too, receipted into the same store so
   * the one restore heals everything.
   */
  quakeTouch(card) {
    if (!this.quakeStore || !card) return card;
    this.quakeStore.push(...scrambleSuits([card]));
    return card;
  }

  restoreQuakedSuits(rebuild = true) {
    const store = this.quakeStore;
    this.quakeStore = null;
    this.quakeAge = 0;
    if (!store?.length) return 0;
    const n = restoreSuits(store);
    if (rebuild && this.handCards?.length) {
      const touched = new Set(store.map(s => s.card));
      for (const cs of [...this.handCards]) if (touched.has(cs.card)) this.rebuildHandSprite(cs);
      this.relayoutForSuits();
      this.resyncSuitLocks();
      this.updatePreview();
      popMessage(this, ARENA_CX, 330, 'the suits settle', { color: '#8fe098', size: 26 });
    }
    return n;
  }

  /**
   * Swap a hand sprite for one redrawn from its (mutated) card, carrying every
   * bit of fan state across: fan slot, lock state, selection, the gaze's mark.
   * Returns the new sprite. (replaceCardSprite is the potion-flavoured version
   * — it deliberately DROPS selection and plays its own burst.)
   */
  rebuildHandSprite(cs) {
    const idx = this.handCards.indexOf(cs);
    if (idx < 0) return null;
    const nc = new CardSprite(this, cs.x, cs.y, cs.card);
    nc.baseX = cs.baseX; nc.baseY = cs.baseY; nc.baseAngle = cs.baseAngle;
    nc.setAngle(cs.angle);
    this.input.setDraggable(nc);
    this.handGroup.add(nc);
    this.handCards[idx] = nc;
    if (this.hypnoCard === cs) this.hypnoCard = nc;
    if (cs.lockState) nc.setLockState(cs.lockState);
    // The biome states ride across too, or a Hopquake would hand back a card
    // the moonlight was holding, face up.
    if (isBurned(this.burnedCards, nc.card)) nc.setBurnedLook();
    this.resyncFade(nc);
    this.resyncBlind(nc);
    // ...and the gaze's eye, which lives ON the sprite now.
    if (this.markedCardId && nc.card.id === this.markedCardId) nc.setMarked(true);
    const sel = this.selected.indexOf(cs);
    if (sel >= 0) { this.selected[sel] = nc; nc.setSelected(true); }
    cs.destroy();
    return nc;
  }

  /**
   * Re-lay the fan after suits changed underneath it. On SORT: SUIT the fan's
   * whole ORDER is a function of the suits, so a scramble has to re-sort or
   * the player is left staring at a "sorted" hand that plainly isn't.
   */
  relayoutForSuits() {
    if (this.sortMode === 'suit') this.sortHand();
    else this.layoutHand();
  }

  /**
   * A card whose SUIT changed may have walked into (or out of) the Keeper's
   * seal, so the banned locks are re-derived from scratch. Cheap, and the only
   * thing standing between a scramble and an unplayable-but-unmarked card.
   * Since the 2026-08-02 wave this is just resyncDenialLocks under its old
   * name — a suit ban is one of several denials now, and they share one gate.
   */
  resyncSuitLocks() { return this.resyncDenialLocks(); }

  // ---------------- 3. FROZEN RITE (The Frostbitten Summoner) ----------------

  /**
   * Raise one minion onto the first free pedestal.
   *
   * GENERALISED (2026-08-02) for E3 CALL OF THE PACK: the effect names WHO is
   * raised and HOW MANY may stand, so the Summoner's Below-Zero Skeletons and
   * the Alpha Wolf's pack are one mechanic with two corpses. Defaults are the
   * Summoner's, so his call site is byte-for-byte what it was.
   */
  frozenRite(boss, eff = {}, intent = null) {
    const minion = eff.minion ?? 'bzSkeleton';
    const cap = eff.cap ?? MINION_CAP;
    const pack = minion !== 'bzSkeleton';
    const ink = pack ? '#ffb060' : '#9adcff';
    const tint = pack ? 0xffb060 : 0x9adcff;
    popMessage(this, boss.homeX, boss.homeY - 150, intent?.label ?? 'FROZEN RITE',
      { color: ink, size: 36 });
    if (!canRaise(this.enemies, minion, cap)) {
      popMessage(this, boss.homeX, boss.homeY - 110,
        pack ? 'the pack is already at his heel' : 'the dead already stand',
        { color: '#8fb8cc', size: 24 });
      return null;
    }
    const slots = this.enemySlots ?? ENEMY_SLOTS[4];
    const si = freeSlotIndex(this.enemies, slots.length);
    if (si < 0) return null;
    const slot = slots[si];
    const gx = ARENA_CX + slot.dx, gy = slot.y;

    // The ground remembers: a circle blooms, shards spit up out of it.
    sfx(this, pack ? 'die_beast_1' : 'frozen_placed', { volume: pack ? 0.7 : 0.95, rate: pack ? 0.75 : 1 });
    const circle = this.add.image(gx, gy + 6, 'fx_glow_circle').setTint(tint).setAlpha(0)
      .setScale(0.45, 0.15).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena - 1);
    this.tweens.add({
      targets: circle, alpha: 0.95, scaleX: 1.0, scaleY: 0.34,
      duration: 380, yoyo: true, hold: 620, onComplete: () => circle.destroy(),
    });
    for (let i = 0; i < 14; i++) {
      const s = this.add.image(gx + Phaser.Math.Between(-90, 90), gy, i % 3 ? 'fx_dust' : 'fx_star')
        .setTint(pack ? Phaser.Math.RND.pick([0xffd8a0, 0xffb060, 0xffffff])
          : Phaser.Math.RND.pick([0xd8f0ff, 0x7fd0ff, 0xffffff]))
        .setScale(Phaser.Math.FloatBetween(0.10, 0.30)).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.arena + 3);
      this.tweens.add({
        targets: s, y: gy - Phaser.Math.Between(90, 240), alpha: 0, angle: Phaser.Math.Between(-180, 180),
        duration: Phaser.Math.Between(480, 900), ease: 'Cubic.easeOut', onComplete: () => s.destroy(),
      });
    }

    // ...and something answers a beat later.
    this.time.delayedCall(380, () => {
      const def = ENEMY_DEFS[minion] ?? ENEMY_DEFS.bzSkeleton;
      const e = this.spawnEnemy(def, slot, this.enemies.length, { rise: true, slotIndex: si });
      this.enemies.push(e);
      sfx(this, pack ? 'die_beast_2' : 'die_humanoid', { volume: 0.35, rate: pack ? 1.25 : 0.75 });
      this.refreshAll();
    });
    return true;
  }

  // ---------------- 4. WINTER'S FORCE (The Polar Guardian) ----------------

  /**
   * How many cards the Guardian demands. Normally five — but if something else
   * has already capped your selection below five (Crown of the High Roller,
   * FEAR), the demand drops with it. Without this the Crown would be a hard
   * softlock rather than a hard fight.
   */
  get winterNeed() { return Math.min(5, this.maxSelectable); }

  /** Pale-blue breath around the edges + frost creeping in on the fan. */
  winterAura() {
    this.winterBars = this.makeEdgeVignette(0x8ad4ff, 0.03, 0.11, 3000, DEPTH.fx);
    const frost = this.add.container(0, 0).setDepth(DEPTH.cards - 1);
    this.rootLayer = frost;   // same slot in newFightState's teardown
    for (const [fx, fy, sx, sy] of [
      [SIDEBAR_W + 140, GAME_H - 60, 700, 380],
      [GAME_W - 140, GAME_H - 60, 700, 380],
      [ARENA_CX, GAME_H + 30, 1200, 260],
    ]) {
      const g = this.add.image(fx, fy, 'fx_glow').setTint(0xbfe4ff).setAlpha(0.16)
        .setDisplaySize(sx, sy).setBlendMode(Phaser.BlendModes.ADD);
      frost.add(g);
      this.tweens.add({
        targets: g, alpha: 0.30, duration: Phaser.Math.Between(2600, 3600),
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
    // Crystals creep in from the CORNERS of the fan band — the middle of that
    // band is card, so anything drawn there is simply never seen.
    for (let i = 0; i < 14; i++) {
      const left = i % 2 === 0;
      const c = this.add.image(
        left ? Phaser.Math.Between(SIDEBAR_W + 20, SIDEBAR_W + 330)
          : Phaser.Math.Between(GAME_W - 350, GAME_W - 20),
        Phaser.Math.Between(GAME_H - 220, GAME_H - 6), 'icon_snow')
        .setTint(0xdff2ff).setAlpha(Phaser.Math.FloatBetween(0.16, 0.40))
        .setScale(Phaser.Math.FloatBetween(0.3, 0.9)).setAngle(Phaser.Math.Between(0, 90));
      frost.add(c);
      this.tweens.add({
        targets: c, angle: c.angle + 90, alpha: c.alpha * 0.4,
        duration: Phaser.Math.Between(4000, 7000), yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }
  }

  /**
   * The gate itself: PLAY HAND only lives while exactly `winterNeed` cards are
   * picked, with a persistent hint under the preview line explaining why.
   * Called from both updatePreview (every click) and refreshAll (every state
   * change) so the button can never be left enabled by a path that forgot.
   */
  updateWinterGate() {
    if (!this.wintersForce) return;
    const n = this.selected?.length ?? 0;
    const need = this.winterNeed;
    const wasOff = this._playEnabled === false;
    this.setPlayEnabled(n === need && this.handsLeft > 0);
    if (n === need && wasOff) this.iceCrack();

    if (!this.winterHint) {
      this.winterHint = this.add.text(ARENA_CX, this.previewCeilY - 2, '', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '23px', color: '#9adcff',
        stroke: '#0f2a3d', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(DEPTH.fx).setAlpha(0);
      this.winterHint.setShadow(2, 4, '#000000aa', 7, true, true);
    }
    const show = n > 0 && n !== need;
    this.winterHint.setText(`WINTER DEMANDS ${need === 5 ? 'FIVE' : need}  ·  ${n}/${need}`);
    this.winterHint.setAlpha(show ? 1 : 0);
  }

  /** The button unlocking at exactly five: a quick ice-crack flash across it. */
  iceCrack() {
    if (!this.playBtn) return;
    sfx(this, 'frozen_placed', { volume: 0.45, rate: 1.35 });
    const flash = this.add.image(this.playBtn.x, this.playBtn.y, 'fx_glow')
      .setTint(0xbfe4ff).setAlpha(0.9).setDisplaySize(300, 110)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
    this.tweens.add({
      targets: flash, alpha: 0, scaleX: flash.scaleX * 1.3, duration: 320,
      onComplete: () => flash.destroy(),
    });
    for (let i = 0; i < 8; i++) {
      const sh = this.add.image(this.playBtn.x, this.playBtn.y, 'fx_star').setTint(0xdff2ff)
        .setScale(0.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
      this.tweens.add({
        targets: sh, x: sh.x + Phaser.Math.Between(-130, 130), y: sh.y + Phaser.Math.Between(-40, 40),
        alpha: 0, scale: 0.24, duration: 380, ease: 'Cubic.easeOut', onComplete: () => sh.destroy(),
      });
    }
    this.tweens.add({ targets: [this.playBtn, this.playBtn.label], scale: 1.06, duration: 110, yoyo: true });
  }

  /** A hand of the wrong size was pushed at the Guardian. */
  denyWinter() {
    this.updateWinterGate();
    sfx(this, 'frozen_placed', { volume: 0.6, rate: 0.8 });
    shake(this, 0.005, 200);
    if (this.winterHint) {
      this.winterHint.setAlpha(1);
      this.tweens.add({
        targets: this.winterHint, scale: 1.35, duration: 130, yoyo: true, ease: 'Back.easeOut',
      });
      this.tweens.add({
        targets: this.winterHint, x: { from: ARENA_CX - 12, to: ARENA_CX + 12 },
        duration: 60, yoyo: true, repeat: 2,
        onComplete: () => this.winterHint?.setX(ARENA_CX),
      });
    }
  }

  // ---------------- 5. SLICE (Agatha) ----------------

  /**
   * Two random cards are cut out of the hand and DO NOT EXIST for the rest of
   * this fight: not discarded (so no reshuffle brings them back), not removed
   * from run.runDeck (so the next fight deals them again). They were already
   * off `this.deck` the moment they were dealt, so "forget the sprite" is the
   * whole implementation.
   */
  agathaSlice(enemy, count = 2) {
    popMessage(this, enemy.homeX, enemy.homeY - 150, 'SLICE!', { color: '#ff5060', size: 44 });
    // A pending potion pick cannot survive its targets being cut away.
    if (this.potionPicking) {
      this.potionPicking = null;
      this.renderPotionBelt();
      this.announce('the blade cuts your choice short', '#cfc8e8');
    }
    const victims = pickSliceVictims(this.handCards, count);
    if (!victims.length) {
      popMessage(this, enemy.homeX, enemy.homeY - 110, 'nothing left to cut', { color: '#ff9aa4', size: 24 });
      return 0;
    }
    flashVignette(this, 0xd82838, 0.42);
    shake(this, 0.008, 320);
    victims.forEach((cs, i) => this.time.delayedCall(i * 220, () => this.sliceCard(cs)));
    return victims.length;
  }

  /** One card: two claw streaks, a tear, red embers, gone. */
  sliceCard(cs) {
    if (!cs?.active) return;
    this.handCards = this.handCards.filter(c => c !== cs);
    this.selected = this.selected.filter(c => c !== cs);
    if (this.hypnoCard === cs) this.hypnoCard = null;
    this.slicedCards.push(cs.card);
    sfx(this, 'hit_stab', { volume: 0.95, jitter: 0.06 });

    // Two fast claw slashes. Each is a wide red bleed with a hot white core
    // laid over it, sweeping open from a sliver — a thin single line at ADD
    // blend just vanishes into a lit card.
    for (let k = 0; k < 2; k++) {
      const ang = k ? -38 : 26;
      const parts = [
        this.add.image(cs.x, cs.y, 'fx_glow').setTint(0xff1828).setDisplaySize(380, 46),
        this.add.image(cs.x, cs.y, 'fx_glow').setTint(0xffd8d0).setDisplaySize(380, 12),
      ];
      for (const p of parts) {
        p.setAngle(ang).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 1);
        const full = p.scaleX;
        p.scaleX = full * 0.15;
        this.tweens.add({
          targets: p, scaleX: full, duration: 110, delay: k * 90, ease: 'Cubic.easeOut',
        });
        this.tweens.add({
          targets: p, alpha: { from: 1, to: 0 }, duration: 300, delay: k * 90 + 60,
          ease: 'Cubic.easeIn', onComplete: () => p.destroy(),
        });
      }
    }
    this.time.delayedCall(150, () => {
      if (!cs.active) return;
      for (let i = 0; i < 12; i++) {
        const p = this.add.image(cs.x, cs.y, i % 3 ? 'fx_dust' : 'fx_star')
          .setTint(Phaser.Math.RND.pick([0xff3040, 0xff8060, 0xffd0c0]))
          .setScale(Phaser.Math.FloatBetween(0.12, 0.34)).setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.fx + 1);
        this.tweens.add({
          targets: p, x: cs.x + Phaser.Math.Between(-150, 150), y: cs.y + Phaser.Math.Between(-90, 130),
          alpha: 0, scale: 0.04, angle: Phaser.Math.Between(-200, 200),
          duration: Phaser.Math.Between(380, 700), ease: 'Cubic.easeOut', onComplete: () => p.destroy(),
        });
      }
      this.tweens.add({
        targets: cs, scaleX: 0.04, angle: cs.angle + 14, alpha: 0.15,
        duration: 240, ease: 'Cubic.easeIn', onComplete: () => cs.destroy(),
      });
      this.time.delayedCall(200, () => {
        this.layoutHand();
        this.updatePreview();
        this.refreshAll();
      });
    });
  }

  // ---------------- 6. SISTERS' WARD (Sinastra) ----------------

  /**
   * Empower AND shield BOTH daughters. The shield is a flat pool absorbed
   * before HP by damageEnemy; the empower mirrors Sinastra's own attackBuff
   * onto Agatha, which is the half the intent engine can't express alone.
   * Kill Sinastra and the wards simply stop — she is the one who casts them.
   */
  sistersWard(enemy, pct = 9) {
    const amount = Math.max(1, Math.round(enemy.maxHp * pct / 100));
    const sisters = this.livingEnemies().filter(e => e.def.boss);
    const other = sisters.find(e => e !== enemy);
    popMessage(this, enemy.homeX, enemy.homeY - 150, "SISTERS' WARD", { color: '#ff8cf0', size: 34 });
    sfx(this, 'shield', { volume: 0.85, rate: 0.92 });

    if (other) {
      // The link: a violet-pink arc between them, with a glow pulse at each end.
      const beam = this.add.graphics().setDepth(DEPTH.arena + 4).setBlendMode(Phaser.BlendModes.ADD);
      const x1 = enemy.homeX, y1 = enemy.homeY - 40, x2 = other.homeX, y2 = other.homeY - 40;
      const arc = -Math.max(90, Math.abs(x2 - x1) * 0.35);
      const draw = (a) => {
        beam.clear();
        const pts = [];
        for (let k = 0; k <= 24; k++) {
          const t = k / 24;
          pts.push(new Phaser.Math.Vector2(
            x1 + (x2 - x1) * t,
            y1 + (y2 - y1) * t + arc * Math.sin(Math.PI * t) + Math.sin(t * 22 + a * 9) * 6));
        }
        beam.lineStyle(11, 0xff5cc8, 0.24 * a); beam.strokePoints(pts, false, false);
        beam.lineStyle(5, 0xd07cff, 0.72 * a); beam.strokePoints(pts, false, false);
        beam.lineStyle(2, 0xffe0ff, 0.95 * a); beam.strokePoints(pts, false, false);
      };
      const life = { a: 0 };
      this.tweens.add({
        targets: life, a: 1, duration: 180, yoyo: true, hold: 340,
        onUpdate: () => draw(life.a), onComplete: () => beam.destroy(),
      });
      for (const [bx, by] of [[x1, y1], [x2, y2]]) {
        const node = this.add.image(bx, by, 'fx_glow_circle').setTint(0xff8cf0).setAlpha(0)
          .setScale(0.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
        this.tweens.add({
          targets: node, alpha: 0.9, scale: 0.62, duration: 240,
          yoyo: true, repeat: 1, onComplete: () => node.destroy(),
        });
      }
    }

    for (const s of sisters) {
      addEnemyShield(s, amount);
      if (s !== enemy) s.attackBuff = Math.max(s.attackBuff, enemy.attackBuff);
      this.time.delayedCall(s === enemy ? 340 : 520, () => {
        if (!s.alive) return;
        const ring = this.add.image(s.homeX, s.homeY - 20, 'fx_glow_circle').setTint(0x7fe0f4)
          .setAlpha(0.85).setScale(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 3);
        this.tweens.add({
          targets: ring, alpha: 0, scale: 0.95, duration: 520, ease: 'Cubic.easeOut',
          onComplete: () => ring.destroy(),
        });
        burst(this, s.homeX, s.homeY - 30, 0x7fe0f4, 10);
        popNumber(this, s.homeX, s.homeY - 100, `◆+${fmtNum(amount)}`, { color: '#9aeaff', size: 32 });
        this.refreshAll();
      });
    }
    this.refreshAll();
    return amount;
  }

  // ---------------- 7. MORPH (The Depth Knight) ----------------

  /** His shell turn: nothing reaches him, and his power compounds. */
  voidShell(enemy, pct = 75) {
    const power = rampVoidPower(enemy, pct);
    popMessage(this, enemy.homeX, enemy.homeY - 150, `VOID SHELL  ×${power.toFixed(2)}`,
      { color: '#c9a0ff', size: 34 });
    burst(this, enemy.homeX, enemy.homeY - 30, 0x8a2be2, 14);
    this.refreshAll();
    return power;
  }

  /** Re-ground a sprite after a texture/scale swap so its feet stay planted. */
  groundSprite(enemy, texKey, scale) {
    const s = scale * (enemy.slot?.scaleMul ?? 1);
    enemy.sprite.setTexture(texKey).setScale(s);
    const dispH = enemy.sprite.displayHeight;
    const ey = (enemy.groundY ?? enemy.homeY) - dispH / 2 + dispH * (enemy.def.footFrac ?? 0.06);
    enemy.homeY = ey;
    enemy.bobTween?.remove();
    enemy.sprite.setPosition(enemy.homeX, ey);
    enemy.bobTween = this.tweens.add({
      targets: enemy.sprite, y: ey - 8, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  /**
   * THE TRANSITION. ATK -> DEF is a void implosion (tendrils drag inward, a
   * white crack, the shell), DEF -> ATK is the shell shattering outward. Form
   * is derived from intent parity by the caller (morphForm), so this only ever
   * plays the theatre and flips `immune`.
   */
  morphTo(enemy, form) {
    if (!enemy.alive || enemy.form === form) return;
    enemy.form = form;
    const cx = enemy.homeX, cy = enemy.homeY;

    if (form === 'def') {
      enemy.immune = true;
      sfx(this, 'fear_placed', { volume: 1, rate: 0.6 });
      shake(this, 0.007, 340);
      // Dark tendrils drag inward from every side.
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + Math.random();
        const d = 300;
        const t = this.add.image(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 'fx_glow')
          .setTint(0x3a0a5a).setAlpha(0.9).setDisplaySize(260, 26)
          .setAngle(Phaser.Math.RadToDeg(ang)).setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.arena + 4);
        this.tweens.add({
          targets: t, x: cx, y: cy, alpha: 0, scaleX: t.scaleX * 0.3,
          duration: 320, ease: 'Cubic.easeIn', onComplete: () => t.destroy(),
        });
      }
      // Violet-black tint pulses on the way in.
      enemy.sprite.setTint(0x6a2ab0);
      this.time.delayedCall(150, () => enemy.alive && enemy.sprite.setTint(0x2a0a40));
      this.time.delayedCall(330, () => {
        if (!enemy.alive) return;
        // The crack: everything whites out for a frame, then the shell is there.
        enemy.sprite.setTintFill(0xffffff);
        this.groundSprite(enemy, 'boss_depth_knight_def', 0.73);
        this.time.delayedCall(90, () => enemy.alive && enemy.sprite.clearTint());
        const ring = this.add.image(cx, enemy.homeY, 'fx_glow_circle').setTint(0xb45cff)
          .setAlpha(0.95).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
        this.tweens.add({
          targets: ring, alpha: 0, scale: 1.5, duration: 520, ease: 'Cubic.easeOut',
          onComplete: () => ring.destroy(),
        });
        for (let i = 0; i < 16; i++) {
          const m = this.add.image(cx, enemy.homeY, i % 4 ? 'fx_dust' : 'fx_star')
            .setTint(Phaser.Math.RND.pick([0x2a0a40, 0x6a2ab0, 0xb45cff]))
            .setScale(Phaser.Math.FloatBetween(0.10, 0.32)).setBlendMode(Phaser.BlendModes.ADD)
            .setDepth(DEPTH.arena + 3);
          this.tweens.add({
            targets: m, x: cx + Phaser.Math.Between(-180, 180), y: enemy.homeY + Phaser.Math.Between(-160, 60),
            alpha: 0, duration: Phaser.Math.Between(500, 950), ease: 'Sine.easeOut',
            onComplete: () => m.destroy(),
          });
        }
        popMessage(this, cx, enemy.homeY - 190, 'VOID FORM: IMMUNE', { color: '#c9a0ff', size: 34 });
        this.startMorphAura(enemy);
        this.refreshAll();
      });
    } else {
      enemy.immune = false;
      this.stopMorphAura(enemy);
      sfx(this, 'hit_big', { volume: 0.9, rate: 0.85 });
      shake(this, 0.008, 300);
      this.groundSprite(enemy, 'boss_depth_knight_atk', 0.70);
      enemy.sprite.setTint(0xff8060);
      this.time.delayedCall(180, () => enemy.alive && enemy.sprite.clearTint());
      // The shell blows apart outward.
      for (let i = 0; i < 22; i++) {
        const f = this.add.image(cx, enemy.homeY, i % 3 ? 'fx_star' : 'fx_dust')
          .setTint(Phaser.Math.RND.pick([0xffd0a0, 0xff6a30, 0xb45cff]))
          .setScale(Phaser.Math.FloatBetween(0.12, 0.4)).setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(DEPTH.arena + 4);
        const a = Math.random() * Math.PI * 2, d = Phaser.Math.Between(120, 320);
        this.tweens.add({
          targets: f, x: cx + Math.cos(a) * d, y: enemy.homeY + Math.sin(a) * d * 0.7,
          alpha: 0, scale: 0.03, angle: Phaser.Math.Between(-220, 220),
          duration: Phaser.Math.Between(420, 780), ease: 'Cubic.easeOut', onComplete: () => f.destroy(),
        });
      }
      const surge = this.add.image(cx, enemy.homeY, 'fx_glow').setTint(0xff4020).setAlpha(0.85)
        .setDisplaySize(360, 360).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 2);
      this.tweens.add({
        targets: surge, alpha: 0, scale: surge.scale * 1.4, duration: 480, onComplete: () => surge.destroy(),
      });
      const p = enemy.voidPower ?? 1;
      popMessage(this, cx, enemy.homeY - 190, `+STRENGTH  ×${p.toFixed(2)}`, { color: '#ff8c28', size: 38 });
      this.refreshAll();
    }
  }

  /**
   * While the shell holds: a faint shimmer breathing on the sprite. Violet for
   * the Depth Knight, and the SAME machine tinted blue for the Frost Guardian's
   * GLACIAL AEGIS and green for the Acidic Monstrosity's swelling WAKING WRATH
   * — one aura, three dresses, rather than three near-identical effects.
   */
  startMorphAura(enemy, tint = 0xb45cff, peak = 0.42) {
    this.stopMorphAura(enemy);
    const aura = this.add.image(enemy.homeX, enemy.homeY, 'fx_glow').setTint(tint)
      .setAlpha(peak * 0.38).setDisplaySize(enemy.sprite.displayWidth * 1.25, enemy.sprite.displayHeight * 1.1)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 2);
    enemy.morphAura = aura;
    enemy.uiGroup?.add(aura);
    this.tweens.add({
      targets: aura, alpha: peak, scale: aura.scale * 1.06,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  stopMorphAura(enemy) {
    if (!enemy.morphAura) return;
    const a = enemy.morphAura;
    enemy.morphAura = null;
    this.tweens.killTweensOf(a);
    this.tweens.add({ targets: a, alpha: 0, duration: 200, onComplete: () => a.destroy() });
  }

  /** Damage bounced off the shell — the Knight's void, or the Guardian's rime. */
  immunePop(enemy) {
    const aegis = enemy.def?.special === 'glacialAegis';
    const tint = aegis ? 0xbfe4ff : 0xb45cff;
    sfxCapped(this, 'shield', { volume: 0.6, rate: aegis ? 1.05 : 0.7 }, 400);
    popMessage(this, enemy.homeX, enemy.homeY - 130, 'IMMUNE',
      { color: aegis ? '#bfe4ff' : '#c9a0ff', size: 40 });
    this.tweens.add({
      targets: enemy.sprite, scale: enemy.sprite.scale * 1.03, duration: 90, yoyo: true,
    });
    const ring = this.add.image(enemy.homeX, enemy.homeY - 20, 'fx_glow_circle').setTint(tint)
      .setAlpha(0.8).setScale(0.4).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 4);
    this.tweens.add({
      targets: ring, alpha: 0, scale: 0.75, duration: 300, onComplete: () => ring.destroy(),
    });
  }

  // ---------------- The ten-hand clock ----------------

  /**
   * The clock this run plays on: 10 hands on BRONZE, 8 on IRON, 7 from STEEL
   * up, plus whatever THE ORACLE did to it (Handy's +2, Sacrificial's -1) and
   * never below one hand. Read live rather than cached so a scene that outlives
   * a run can never field a stale number.
   */
  get handLimit() { return handsPerFight(run); }

  get handsLeft() { return Math.max(0, this.handLimit - this.handsThisFight); }

  /** Greys PLAY HAND out and takes its hit area away — belt AND braces. */
  setPlayEnabled(on) {
    if (!this.playBtn) return;
    if (this._playEnabled === on) return;
    this._playEnabled = on;
    this.playBtn.setAlpha(on ? 1 : 0.4);
    this.playBtn.label.setAlpha(on ? 1 : 0.4);
    if (on) this.playBtn.setInteractive({ useHandCursor: true });
    else this.playBtn.disableInteractive();
  }

  /**
   * Fired once a hand has fully resolved. The last three hands get louder and
   * redder, so nobody walks into the wall without hearing it coming.
   */
  warnHandsLeft() {
    const left = this.handsLeft;
    // JC: warnings must be REAL obvious — 2x the old text size, 3x the hang
    // time. That recipe lives in bigMessage() now and is shared with the boss
    // mechanic blurbs and the seal deadlock; this is the original caller.
    if (left === 3) {
      this.bigMessage('3 HANDS LEFT!', '#ffb347', 76);
      this.makeEdgeVignette(0xffa030, 0, 0.30, 520, DEPTH.fx + 2, 0);
      sfx(this, 'warning', { volume: 0.4, rate: 1.1 });
    } else if (left === 2) {
      this.bigMessage('2 HANDS LEFT!', '#ff8a2a', 80);
      this.makeEdgeVignette(0xff7418, 0, 0.40, 500, DEPTH.fx + 2, 0);
      sfx(this, 'warning', { volume: 0.55, rate: 1.02 });
    } else if (left === 1) {
      // The big one: three crimson border flares, a shove, and the warning
      // horn. (suspense() is reserved for boss/mythic reveals and its 6s guard
      // would eat this half the time — the plain sting lands harder.)
      const t = this.bigMessage('FINAL HAND!', '#ff2f3a', 124);
      this.tweens.add({ targets: t, scale: 1.06, duration: 300, yoyo: true, repeat: 4, ease: 'Sine.easeInOut' });
      this.makeEdgeVignette(0xff2030, 0, 0.62, 420, DEPTH.fx + 2, 2);
      shake(this, 0.009, 560);
      sfx(this, 'warning', { volume: 0.85, rate: 0.94 });
    }
  }

  // ---------------- The victory purse ----------------

  /**
   * What one unspent hand is worth. CHIPS_PER_HAND_LEFT normally; the HANDY
   * POUCH raises the rate itself (10 -> 20), and two of them (a mirrored pouch)
   * really do stack to 30 — it is a rate, not a cap.
   *
   * DRUSKY (0803-B §1.5) takes +50% on top, and the ORDER is the whole point:
   * his bonus is applied at the END of the payout, AFTER every relic has
   * finished raising the rate. So a Handy Pouch that took 10 to 20 becomes 30
   * for him, not 25 — the hoarder multiplies the finished number, which is the
   * same shape his chips-to-mult passive has on the other side of the equation.
   *
   * A hero's share is read off `chr.leftoverChipPct` when the def carries one,
   * so a future hero needs no edit here; Drusky falls back to the number his own
   * kit text is generated from (config.HOARD_LEFTOVER_BONUS) so the two can
   * never print different promises.
   */
  chipsPerHandLeft() {
    return leftoverHandChips(this.prop('handsChipBonus'), this.leftoverChipPct);
  }

  /** The hero's cut of the leftover-hand purse. 0 for everyone but the Hoarder. */
  get leftoverChipPct() {
    return this.chr?.leftoverChipPct
      ?? (this.chr?.id === 'hoarder' ? HOARD_LEFTOVER_BONUS : 0);
  }

  /** The whole purse this fight would pay if it were won right now, pre-relics. */
  handsPurse() {
    return this.handsLeft * this.chipsPerHandLeft();
  }

  /**
   * THE TALLY. The arena is empty, the packs have not opened yet, and the clock
   * cashes out: one hourglass per hand you never had to play flips into a gold
   * chip, left to right, each with a rising tick and its own +N, and the run of
   * them lands on a single total. ~1.2-1.8s depending on how many hands are
   * left, then `done` fires.
   *
   * PACING (JC, 2026-08-01). Every beat below is a BASE duration run through
   * spd(), exactly like the scoring cadence — the tally used to be the one
   * animation in the game that ignored the hand-speed setting entirely. The
   * base numbers were also slowed ~25% first, so:
   *   speed 1  — half pace, one hourglass at a time, readable
   *   speed 2  — a shade slower than it used to be (the shipped feel)
   *   speed 3  — 1.5x today's pace
   * ...which is exactly what spd()'s 2/playSpeed mapping delivers off a base
   * that is 1.25x the old one.
   *
   * The chips are credited ONCE, through gainChips (so the DEV GOLD slider and
   * the Sticky Gloves / Chip Purse multiplier both apply); the per-icon numbers
   * show the RATE, and the total shows what actually reached the purse — which
   * is how a +25% relic gets to visibly beat the arithmetic on screen.
   */
  payHandsPurse(done) {
    const left = this.handsLeft;
    const per = this.chipsPerHandLeft();
    const raw = left * per;
    if (raw <= 0) {
      this._lastPurse = { left, per, raw: 0, paid: 0 };
      popMessage(this, ARENA_CX, 300, 'NO HANDS TO SPARE', { color: '#a898c4', size: 30 });
      return this.time.delayedCall(this.spd(650), done);
    }
    const paid = this.gainChips(raw, null, { quiet: true, silent: true });
    this._lastPurse = { left, per, raw, paid };

    const y = 300;
    const gap = Math.min(96, 660 / Math.max(left, 1));
    const x0 = ARENA_CX - ((left - 1) / 2) * gap;
    // Base beats, all +25% on the old numbers and all spd()-scaled below.
    const step = this.spd(Math.max(113, Math.min(188, 1250 / left)));  // 9 hands ~139ms each
    const lead = this.spd(225);       // the beat before the first hourglass
    const flip = this.spd(138);       // hourglass tips over
    const settle = this.spd(325);     // last chip lands -> the sweep begins
    const titleIn = this.spd(275);

    const title = this.add.text(ARENA_CX, y - 92, `${left} HAND${left > 1 ? 'S' : ''} TO SPARE`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: '#ffe6a8',
      stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(DEPTH.fx + 3).setAlpha(0).setScale(0.7);
    title.setShadow(0, 5, '#000000', 12, true, true);
    this.tweens.add({ targets: title, alpha: 1, scale: 1, duration: titleIn, ease: 'Back.easeOut' });

    const litter = [title];
    for (let i = 0; i < left; i++) {
      const x = x0 + i * gap;
      const glass = this.add.image(x, y, 'icon_hourglass').setTint(0xd8c8a0)
        .setDepth(DEPTH.fx + 3).setAlpha(0);
      glass.setScale(46 / Math.max(glass.width, glass.height));
      const coin = this.add.image(x, y, 'icon_coins').setDepth(DEPTH.fx + 3).setAlpha(0);
      coin.setScale(52 / Math.max(coin.width, coin.height));
      litter.push(glass, coin);
      const at = lead + i * step;
      // The hourglass arrives...
      this.time.delayedCall(at, () => {
        glass.setAlpha(1);
        this.tweens.add({ targets: glass, scaleX: 0, duration: flip, ease: 'Sine.easeIn' });
      });
      // ...turns over, and is a chip on the other side.
      this.time.delayedCall(at + flip, () => {
        glass.setAlpha(0);
        coin.setAlpha(1).setScale(coin.scaleX * 0.1, coin.scaleY);
        this.tweens.add({
          targets: coin, scaleX: coin.scaleY, duration: this.spd(188), ease: 'Back.easeOut',
        });
        sfx(this, 'score_tick', { volume: 0.62, rate: 0.95 + i * 0.075 });
        burst(this, x, y, 0xffc542, 6);
        popNumber(this, x, y + 44, `+${per}`, { color: '#ffc542', size: 28, rise: 26 });
      });
    }

    const endAt = lead + left * step + settle;
    this.time.delayedCall(endAt, () => {
      sfx(this, 'chips_stack', { volume: 0.95 });
      for (const c of litter) {
        if (c === title) continue;
        this.tweens.add({
          targets: c, x: ARENA_CX, y, alpha: 0, scale: 0.2,
          duration: this.spd(275), ease: 'Cubic.easeIn',
        });
      }
      this.tweens.add({ targets: title, alpha: 0, duration: this.spd(250) });
      burst(this, ARENA_CX, y, 0xffc542, 26);
      const bonus = paid - raw;
      const total = this.add.text(ARENA_CX, y, `+${fmtNum(paid)} CHIPS`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '86px', color: '#ffd23e',
        stroke: '#3a2405', strokeThickness: 10,
      }).setOrigin(0.5).setDepth(DEPTH.fx + 4).setAlpha(0).setScale(0.5);
      total.setShadow(0, 8, '#000000', 16, true, true);
      litter.push(total);
      this.tweens.add({ targets: total, alpha: 1, scale: 1, duration: this.spd(325), ease: 'Back.easeOut' });
      if (bonus > 0) {
        popNumber(this, ARENA_CX, y + 76, `+${fmtNum(bonus)} STICKY`, { color: '#8fe098', size: 32, delay: this.spd(225) });
      }
      this.tweens.add({
        targets: total, alpha: 0, y: y - 40, duration: this.spd(400), delay: this.spd(775),
        onComplete: () => { for (const c of litter) c.destroy(); done(); },
      });
    });
    // What the tally cost in wall time, for the verification runs.
    this._lastTallyMs = endAt + this.spd(325) + this.spd(775) + this.spd(400);
    return this._lastTallyMs;
  }

  /** The clock ran out with something still breathing. */
  outOfHands() {
    this.busy = true;
    this.setPlayEnabled(false);
    this.refreshAll();
    this.defeat(outOfHandsLine(this.handLimit), true);
  }

  newFightState() {
    // A DESCRIPTION BOX IS ABOUT THIS FIGHT. The scene is a SINGLETON, so a box
    // left standing by the last one — a relic's USE/SELL, a potion's confirm —
    // would open the next fight offering to spend a charge that has already
    // recharged, on a display list that no longer holds the icon it points at.
    // `_potConfirm` in particular was never cleared anywhere: it is the handle
    // tools/verify_mobile.py reads, and it survived fights, defeats and
    // scene changes as a pointer to a destroyed container.
    closeChoiceBox(this);
    this._potConfirm = null;
    this.deck = shuffle([...run.runDeck]);
    this.discardPile = [];
    this.handCards = [];
    this.selected = [];
    // Discards are the MODE's allowance (4 on BRONZE, down to 2 from PLATINUM),
    // plus whatever relics have granted. PLAYER_BASE.discardsPerFight is the
    // BRONZE baseline the difficulty table is written against.
    // FLOORED AT ZERO: the bonus can now go several under (the Ruthless Editor's
    // -1 under THE ORACLE'S COMPENSATOR's -2 on a two-discard mode), and a
    // NEGATIVE allowance would read as "-1 discards" on the HUD and let a refund
    // hand one back out of nowhere. No discards is a real state; owing one is not.
    this.discardsLeft = Math.max(0, difficultyOf(run).discards + run.discardsPerFightBonus);
    this.handsThisFight = 0;       // the hand clock resets with the fight
    this._playEnabled = undefined; // force setPlayEnabled to re-apply next refresh
    this.busy = false;
    // E1 SHATTERGUARD is cleared FIRST, ahead of the startShield grant below:
    // the scene is a singleton, and a stale `true` from the last fight would
    // silently eat the plate a Bulwark is supposed to walk in wearing.
    this.shatterguard = false;
    // (2026-08-01) The Bull's shield used to persist between fights. That half
    // of his old kit is gone with the 25%-shield-as-damage half — the prop
    // check stays as the general lever for any future relic that revives it.
    if (this.prop('keepShield') === 0) this.player.shield = 0;
    this.player.shield = Math.max(this.player.shield, this.shieldGain(run.startShield));
    this._crownDone = false;       // Crown of the High Roller: one Ace per fight
    this._leftoverCount = 0;
    this._leftoverUnits = 0;
    this._leftoverJob = null;
    // The scene is a SINGLETON: a hand abandoned mid-cascade (a defeat, a scene
    // change) would otherwise leave the clocks running at 6× into the next fight
    // and the pitch ladder parked at its ceiling.
    this.stopScoringAccel();
    this.resetHandPitch();
    this._benchBeat = [];
    this._repeatCause = [];
    this._eqTag = null;
    // ACTIVE-USE relics recharge with the fight — one press each, and every
    // one-shot blessing they handed out dies here with the last fight.
    this._activeUsed = new Set();
    this.wheelNextMult = null;     // Wheel of Divinity: ×2 on the NEXT hand
    this.wheelNextRepeat = null;   // ...or every card retriggering on it
    // --- THE 2026-08-10 WAVE, all fight-local. The scene is a SINGLETON, so a
    //     charm armed in the last fight, the last hand it played, and a flask
    //     that already caught its twenty must all die here or they arrive in
    //     the next room still holding last room's answer.
    this._coldSnap = null;         // COLD SNAP CHARM: the armed instance
    // ...and the charm's own latch, which lives on the INSTANCE and therefore
    // outlives the scene field: a fight that ended while it was armed would
    // leave the tooltip promising a hand that is never coming home.
    for (const a of run.artifacts) if (a.state?.armed) a.state.armed = false;
    this._lastPlay = null;         // HOURGLASS OF THE SECOND SUN: what it turns
    // PILGRIM'S FLASK's cap is PER FIGHT and banks on the instance. The def is
    // all props and carries no fightStart hook of its own, so the wipe is
    // walked from here — the same door every other fight-local reset uses.
    for (const a of this.propHolders('overhealChips')) if (a.state) a.state.fight = 0;
    this.syncActiveTags();
    this.pstat = freshPstat();
    this._brittleApplied = 0; this._fearApplied = 0;
    // --- 2026-08-02 mechanics wave (all fight-local) ---
    // `_armed` is the turn-counted debuffs that were ALREADY running when the
    // current enemy turn began; it is what stops that turn's own tick from
    // eating a debuff the same turn just applied. Null outside an enemy turn.
    this._armed = null;
    this.rootedPower = ROOTED_STRENGTH;
    if (this.vineLayer) { this.vineLayer.destroy(true); this.vineLayer = null; }
    this.vineMotes?.remove(); this.vineMotes = null;
    if (this.spikeRing) { this.spikeRing.destroy(true); this.spikeRing = null; }
    this._spikeDrawn = -1;
    this._lastSteal = null;
    this._fleeLog = [];
    // --- 2026-08-03 BIOME WAVE: the four per-fight ledgers (the ADDENDUM's
    //     locked names) plus the fight-local flags the sixteen effects set.
    //     Every one of them dies HERE and nowhere else — the scene is a
    //     SINGLETON, so a Pyreheart's burn ledger surviving into the next room
    //     would eat a deck that was never on trial.
    Object.assign(this, freshBiomeLedgers());
    this.handTypeOnce = false;    // The Magistrate — DOUBLE JEOPARDY
    this.burnPlayed = false;      // Pyreheart — STRUCK FROM THE RECORD
    this.dropHandOn = false;      // The Unmade — WEIGHTLESS
    this.handShrink = 0;          // Weft Warden — REWEAVE (cards off the deal)
    this.cardTaxRate = 0;         // Brazier Titan — PYRE TAX (HP per card)
    this.condemnBrands = [];      // The Hangman — [{ id, turns }]
    this.markedCardId = null;     // Grimwatch — HE SEES IT COMING (eye on the card)
    this._blindIds = new Set();   // which cards the moonlight is holding
    this._handCtx = null;         // the biome gates only apply inside a hand
    this._mistrials = 0;          // how many times the docket has been wiped
    this._lastHandDamage = 0;     // what the Mirrorwalker has to throw back
    this._burnLog = 0; this._condemnLog = 0; this._dropLog = 0;
    this.bannedSuit = null;
    this.hypnoActive = false;
    this.hypnoCard = null;
    // --- Boss signature mechanics (all fight-local) ---
    // Belt AND braces: a fight that ended mid-Hopquake (a kill during the
    // scramble, a dev winNow) must never leave scrambled suits on the RUN
    // DECK, so the restore runs here too, before the new state is built.
    this.restoreQuakedSuits(false);
    this.bossHandPenalty = 0;    // Fairy King — ROOTED
    this.wintersForce = false;   // Polar Guardian — only 5-card hands
    // --- parts 3 & 4: elite/boss signatures (all fight-local) ---
    // The scene is a SINGLETON, so every one of these has to be cleared here or
    // a Frost Titan in Act II would still be shattering your plate in Act III.
    // (`shatterguard` itself is cleared at the top, before the startShield.)
    this._shatteredTotal = 0;
    this._feastLog = 0;          // Bear Mauler — E2, for the verification hook
    if (this.shatterMark) { this.shatterMark.destroy(true); this.shatterMark = null; }
    if (this.shatterAura) { this.tweens.killTweensOf(this.shatterAura); this.shatterAura.destroy(); this.shatterAura = null; }
    this.quakeStore = null;      // Sabre Rabbit — [{ card, origSuit }]
    this.quakeAge = 0;
    this.slicedCards = [];       // Agatha — cards gone for THIS fight
    this._driftedIds = new Set(); // ...which of those the UNMADE floated away
    this._sealDoom = false; this._sealWarned = false;   // Keeper dead-end latch
    if (this.rootLayer) { this.rootLayer.destroy(true); this.rootLayer = null; }
    if (this.winterBars) { for (const b of this.winterBars) { this.tweens.killTweensOf(b); b.destroy(); } this.winterBars = null; }
    if (this.winterHint) { this.winterHint.destroy(); this.winterHint = null; }
    // Potion fight-state (all fight-local; nothing leaks into run.player).
    this.tempHandSize = 0;         // Bottled Frenzy
    this.potionNextFactor = null;  // Giant's Brew
    this.potionIceValue = 0;       // Liquid Ice: +value on the NEXT played hand
    this._allScore = false;        // Go-Go Goo: the kicker rule is off for ONE play
    this.potionEcho = false;       // Chrono Elixir
    this.potionPicking = null;     // Mirror Tonic / Alchemist's Seal / the mod bottles
    // UNTOUCHED: the HP this fight opened on, and the lowest it ever fell to.
    // Read at victory (see fightWon) rather than hooked into every damage path,
    // so a point of HP lost to bleed, poison or an attack all count the same.
    this._hpAtFightStart = this.player?.hp ?? 0;
    this._minHpThisFight = this._hpAtFightStart;
    // CLEAN SHEET / BREWMASTER / NOT TODAY: three per-fight tallies the trophy
    // shelf reads at victory. Scene fields, not run state, because the question
    // each one asks is only ever about THIS fight.
    this._discardsThisFight = 0;
    this._drinksThisFight = 0;
    this._revivedThisFight = false;
    this._rouletteForce = null;    // DEV pins (see __hfCombat.forceRoulette)
    this._etherealForce = null;
    // A card's inspect box describes a card in THIS fight. The scene is a
    // singleton, so a panel left open by the last one is a panel about a hand
    // that no longer exists.
    this._inspectHeld = false;
    hideCardInspect(this);
    if (this.handGroup) { this.handGroup.destroy(true); }
    this.handGroup = this.add.container(0, 0).setDepth(DEPTH.cards);
  }

  // ---------------- Hand UI ----------------
  buildHandUI() {
    const H = BTN_LANE.home, [R1, R2] = BTN_LANE.rowY;
    this.playBtn = this.makeButton(H.play, R1, 'btn_yellow', 'PLAY HAND', '#5b3a00',
      () => this.playHand(), BTN_LANE.playW);
    this.discardBtn = this.makeButton(GAME_W + H.discard, R1, 'btn_red', 'DISCARD', '#4a0a10',
      () => this.discardSelected(), BTN_LANE.discardW);
    this.sortBtn = this.makeButton(GAME_W + H.sort, R2, 'btn_dark', 'SORT: RANK', '#cfc8e8', (btn) => {
      this.sortMode = this.sortMode === 'rank' ? 'suit' : 'rank';
      btn.label.setText(this.sortMode === 'rank' ? 'SORT: RANK' : 'SORT: SUIT');
      this.sortHand();
    }, BTN_LANE.sortW);
    this.sortMode = 'rank';
    this.handsBtn = this.makeButton(H.hands, R2, 'btn_dark', 'HANDS', '#cfc8e8',
      () => handChartOverlay(this, run), BTN_LANE.handsW);
    this.deckBtn = this.makeButton(H.deck, R2, 'btn_dark', 'DECK', '#cfc8e8', () =>
      deckInfoOverlay(this, run, { remaining: this.deck, spent: this.discardPile }), BTN_LANE.deckW);
    // The plates NAME THEMSELVES so a driver asks for the one it wants rather
    // than remembering where it used to be — the same contract the map's left
    // column adopted when the capsule grew (see __hf.buttons()).
    for (const [btn, label] of [[this.playBtn, 'PLAY HAND'], [this.discardBtn, 'DISCARD'],
      [this.sortBtn, 'SORT'], [this.handsBtn, 'HANDS'], [this.deckBtn, 'DECK']]) {
      btn.setData('hfLabel', label);
    }
    this.layoutHandButtons();

    this.buildEquationHUD();
  }

  /**
   * PUT THE FIVE PLATES WHERE THE FAN IS NOT (mobile only).
   *
   * Called from layoutHand, so it re-runs on every deal, discard, sort, drag
   * and Frenzy — every event that can change how wide the hand is. Desktop is
   * a deliberate no-op: its fan is capped at 740 in a 1920 canvas and the
   * shipped coordinates already clear it at every hand size the game can deal.
   *
   * `_handLayout` is written by layoutHand immediately before this call; the
   * fallback covers the one frame where buildHandUI runs before any deal.
   */
  layoutHandButtons() {
    if (!MOBILE || !this.playBtn) return;
    const n = this.handCards?.length ?? 0;
    const { startX = CARD.fanCenterX, spread = CARD.fanSpread } = this._handLayout ?? {};
    const fanLeft = startX - CARD.w / 2;
    const fanRight = startX + Math.max(n - 1, 0) * spread + CARD.w / 2;
    const lanes = handButtonLanes(fanLeft, fanRight, {
      leftWall: SIDEBAR_W, rightWall: GAME_W,
      needLeft: BTN_LANE.needLeft, needRight: BTN_LANE.needRight,
      gutter: BTN_LANE.gutter, clear: BTN_LANE.clear, minScale: BTN_LANE.minScale,
    });
    const [R1, R2] = BTN_LANE.rowY;
    /**
     * THE UP-SCALE, COMPUTED HERE (2026-08-10).
     *
     * handButtonLanes answers "how much must these shrink to fit", and its
     * `fit()` clamps at 1 by design — it has no opinion about spare room. JC
     * wants the other half: plates that FILL their allotted space and only
     * step aside when a large hand actually crowds them. Both halves are the
     * same expression, so the lane's `avail` (which it already returns) is run
     * through it again with the ceiling raised:
     *
     *     scale = clamp(avail / need, minScale, maxScale)
     *
     * `need` is per-lane and NOT interchangeable — the left lane must fit
     * HANDS+gap+DECK (322) and the right only DISCARD (240) — so a single
     * scale for both would size the right lane off the left lane's crowding.
     *
     * Phone, arithmetic in full (gutter 48, clear 26, sidebar 420, W 2340):
     *    5 cards  fan 1028..1732  avail L 534 R 534  ->  1.25 / 1.25 (ceiling)
     *    8 cards  fan  831..1929  avail L 337 R 337  ->  1.048 / 1.25
     *   12 cards  fan  700..2060  avail L 206 R 206  ->  0.640 / 0.858
     * so nothing shrinks until twelve, and twelve shrinks exactly as it did.
     */
    const up = (avail, need) => (need > 0
      ? Math.max(BTN_LANE.minScale, Math.min(BTN_LANE.maxScale, avail / need))
      : BTN_LANE.maxScale);
    const sL = up(lanes.left.avail, BTN_LANE.needLeft);
    const sR = up(lanes.right.avail, BTN_LANE.needRight);
    // The plate's HEIGHT does not ride the scale: a 78px row that shrank to 50
    // at twelve cards would be a thumb target that punishes a big hand. Only
    // the width gives. Row 2 bottoms out at 1026 + 78/2 = 1065 (< 1080) and its
    // top at 987 clears row 1's foot at 983.
    const place = (btn, x, y, w) => {
      if (!btn) return;
      btn.setDisplaySize(w, BTN_LANE.plateH);
      btn.setPosition(x, y);
      btn.label.setPosition(x, y - 4);
      // The plate shrank; the word on it has to fit inside what is left.
      btn.label.setScale(1);
      if (btn.label.width > w - 24) btn.label.setScale((w - 24) / btn.label.width);
    };
    const lx = lanes.left.x, rx = lanes.right.x;
    const playW = BTN_LANE.playW * sL;
    place(this.playBtn, lx + playW / 2, R1, playW);
    const handsW = BTN_LANE.handsW * sL, deckW = BTN_LANE.deckW * sL, gap = BTN_LANE.gap * sL;
    place(this.handsBtn, lx + handsW / 2, R2, handsW);
    place(this.deckBtn, lx + handsW + gap + deckW / 2, R2, deckW);
    const discardW = BTN_LANE.discardW * sR, sortW = BTN_LANE.sortW * sR;
    place(this.discardBtn, rx - discardW / 2, R1, discardW);
    place(this.sortBtn, rx - sortW / 2, R2, sortW);
    this._btnLanes = lanes;
    this._btnUp = { left: sL, right: sR };
  }

  // ---------------- The score equation ----------------

  /**
   * [SCORE] × [MULT] with the hand's name above it. Plate-free: JC binned the
   * tapered parchment label ("the white diamond background") in favour of
   * bigger text with a stroke and a real drop shadow, the same treatment the
   * merchant price tags use.
   *
   * The two numbers are anchored to a fixed centre gap and grow OUTWARD
   * (score right-aligned, mult left-aligned), so neither one jitters as digits
   * pile onto it. Colors are Balatro's chips/mult language warmed for
   * parchment: score cool blue-white, mult red-orange.
   */
  buildEquationHUD() {
    const drop = (t) => { t.setShadow(3, 5, '#000000cc', 9, true, true); return t; };
    this.eqName = drop(this.add.text(ARENA_CX, EQ_NAME_Y, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.eqName}px`, color: '#f0dcac',
      stroke: '#2a1808', strokeThickness: 6,
    })).setOrigin(0.5).setDepth(DEPTH.fx + 1).setAlpha(0);
    this.eqScore = drop(this.add.text(ARENA_CX - EQ_GAP, EQ_Y, '0', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.eqNum}px`, color: '#c8e2ff',
      stroke: '#16293f', strokeThickness: 8,
    })).setOrigin(1, 0.5).setDepth(DEPTH.fx + 1).setAlpha(0);
    this.eqTimes = drop(this.add.text(ARENA_CX, EQ_Y + 2, '×', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.eqTimes}px`, color: '#e8dcc0',
      stroke: '#2a1808', strokeThickness: 6,
    })).setOrigin(0.5).setDepth(DEPTH.fx + 1).setAlpha(0);
    this.eqMult = drop(this.add.text(ARENA_CX + EQ_GAP, EQ_Y, '1', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.eqNum}px`, color: '#ff7a3c',
      stroke: '#3d1002', strokeThickness: 8,
    })).setOrigin(0, 0.5).setDepth(DEPTH.fx + 1).setAlpha(0);
    /**
     * THE SPLASH CHIP. Rides beside the hand name, in the club's green and
     * wearing the ✷ burst: how much of this hand reaches every OTHER enemy.
     * It only exists while a club is in the hand, so a swords player never sees
     * an empty readout — and it is placed off eqName's live width, so it never
     * collides with the caption however long the hand's name is.
     */
    this.eqAoe = drop(this.add.text(0, EQ_NAME_Y, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.eqAoe}px`, color: AOE_COLOR,
      stroke: '#12300f', strokeThickness: 6,
    })).setOrigin(0, 0.5).setDepth(DEPTH.fx + 1).setAlpha(0);
    this.eqParts = [this.eqName, this.eqScore, this.eqTimes, this.eqMult, this.eqAoe];
    this.eqScoreVal = 0;
    this.eqMultVal = 1;
    this.eqMultApplies = true;
  }

  /**
   * One-shot scale punch that never fights the alpha tweens. `ms` is the
   * SETTLE — the mult side asks for a longer one, because ×N is the payoff and
   * JC could not read it before it snapped back.
   */
  eqPunch(obj, to = 1.22, ms = 195) {
    obj._punch?.remove();
    obj.setScale(to);
    obj._punch = this.tweens.add({ targets: obj, scale: 1, duration: this.spd(ms), ease: 'Back.easeOut' });
  }

  /**
   * A new hand: name it, and set BOTH SIDES to where the hand itself starts.
   *
   * THE OPENING BEAT (JC, 2026-08-06 — THE HANDS OVERHAUL). The score side used
   * to open on 0 and the mult on the hand's printed mult, which said that a
   * Full House and a High Card begin the same conversation. Every hand now
   * carries its OWN BASE VALUE as well as its mult (poker.js HAND_DEFS), both
   * rising with the Smith's levels — so the equation opens on `base × mult`,
   * the starting equation the player is working from, and the card ticks build
   * on top of it instead of out of nothing.
   *
   * res.handBase is the number scoring.js actually put on baseSum, levels
   * included, so the opening frame is not a second copy of the arithmetic.
   *
   * Hands that deal no damage at all get a dimmed mult side, because that
   * output genuinely does not multiply. Since the base value rides EVERY hand
   * that path is effectively unreachable now (a gem hand deals base × mult and
   * still plates you); it is kept lit for the currency rewrites and costs
   * nothing while nothing takes it.
   */
  eqBegin(res, ev) {
    // THE HAND'S ONE RISING LADDER starts here and does not reset again until
    // the next hand, and the accelerator starts counting from the same instant.
    this.resetHandPitch();
    this.startScoringAccel();
    // Normally the mult owns the total because the hand deals damage. The
    // Ancient Shield / Infinite Heart hand the mult to a pure shield or pure
    // heal hand instead — so the mult side stays LIT and the score side is
    // fed the shield/heal units (eqScoreIsDamage says which currency it holds).
    this.eqMultApplies = res.multApplies ?? (res.baseSum > 0);
    this.eqCurrency = res.scoreCurrency ?? 'damage';
    this.eqScoreIsDamage = this.eqCurrency === 'damage';
    // THE HAND'S OWN BASE VALUE opens the score side — but only in the currency
    // it is denominated in. A hand whose equation is counting shield or heal
    // (the currency rewrites) opens on 0 exactly as it always did: the base is
    // damage-side, and putting it on a ♥ readout would be a lie.
    this.eqScoreVal = this.eqScoreIsDamage ? Math.round(res.handBase ?? 0) : 0;
    this.eqMultVal = res.baseMult;
    // VERIFICATION HOOK (__hfCombat.eqState().open). The opening beat is one
    // frame long before the card ticks start adding to it, so a driver that
    // polls for it races the cascade and reads whatever the ticks got to first.
    // Recording it here is the only way to assert `base × mult` was what the
    // player was actually shown at the top of the hand.
    this._eqOpen = { score: this.eqScoreVal, mult: this.eqMultVal, type: res.handType };
    this._eqScoreTween = null;
    this._eqMultTween = null;
    this.eqName.setText(`${ev.name}${res.handLevel ? `  Lv.${res.handLevel + 1}` : ''}`);
    this.eqScore.setText(fmtTotal(this.eqScoreVal));
    this.eqMult.setText(fmtMult(res.baseMult));
    for (const p of this.eqParts) {
      p._punch?.remove(); p._punch = null;
      this.tweens.killTweensOf(p);
      p.setAlpha(0).setScale(1);
    }
    this.eqScore.setPosition(ARENA_CX - EQ_GAP, EQ_Y);
    this.eqMult.setPosition(ARENA_CX + EQ_GAP, EQ_Y);
    // The splash chip: only when clubs are actually in the hand, parked off the
    // caption's real width so it can never sit on top of it.
    this.eqSplashVal = Math.round(res.aoeSplash ?? 0);
    if (this.eqSplashVal > 0) {
      this.eqAoe.setText(`${AOE_GLYPH} ${fmtNum(this.eqSplashVal)}`);
      this.eqAoe.setPosition(ARENA_CX + this.eqName.width / 2 + 16, EQ_NAME_Y);
    } else {
      this.eqAoe.setText('');
    }
    const delay = this.spd(345);
    const soft = this.eqMultApplies ? 1 : 0.42;
    this.tweens.add({ targets: [this.eqName, this.eqScore], alpha: 1, duration: 180, delay });
    this.tweens.add({ targets: [this.eqTimes, this.eqMult], alpha: soft, duration: 180, delay });
    // THE HAND LANDS AS A BLOW, not as a label: base × mult arrives together,
    // punched, so the player reads "Full House: 30 × 4" as the thing they are
    // building on before the first card lifts.
    if (this.eqScoreVal > 0) {
      this.time.delayedCall(delay + 20, () => {
        if (!this.eqScore?.active) return;
        this.eqPunch(this.eqScore, 1.24);
        this.eqPunch(this.eqMult, 1.24);
      });
    }
    if (this.eqSplashVal > 0) {
      this.tweens.add({ targets: this.eqAoe, alpha: 1, duration: 180, delay: delay + 60 });
    }
  }

  /** A card's contribution flies onto the SCORE side. */
  eqAddScore(add) {
    if (!add || !this.eqScore?.active) return;
    const from = this.eqScoreVal;
    this.eqScoreVal = from + add;
    const to = this.eqScoreVal;
    const proxy = { v: from };
    // ONE count-up at a time. The repeat beat can fire these 120ms apart at the
    // fast end of its ramp, and two live tweens both writing the same label make
    // the number stutter backwards.
    this._eqScoreTween?.remove();
    this._eqScoreTween = this.tweens.add({
      targets: proxy, v: to, duration: this.spd(175), ease: 'Cubic.easeOut',
      onUpdate: () => this.eqScore.setText(fmtTotal(Math.round(proxy.v))),
      onComplete: () => this.eqScore.setText(fmtTotal(to)),
    });
    this.eqPunch(this.eqScore, 1.2);
  }

  /** Move the MULT side to an absolute value, with a punch. */
  eqSetMult(v, punch = true, ms = 230) {
    v = Math.round(v * 100) / 100;
    if (!this.eqMult?.active || v === this.eqMultVal) return;
    const from = this.eqMultVal;
    this.eqMultVal = v;
    const proxy = { v: from };
    this._eqMultTween?.remove();
    this._eqMultTween = this.tweens.add({
      targets: proxy, v, duration: this.spd(ms), ease: 'Cubic.easeOut',
      onUpdate: () => this.eqMult.setText(fmtMult(proxy.v)),
      onComplete: () => this.eqMult.setText(fmtMult(v)),
    });
    // The mult is the payoff: it counts up slower and settles slower than the
    // score, so every ×N in the cascade actually registers.
    if (punch) this.eqPunch(this.eqMult, 1.34, 300);
  }

  eqAddMult(n) { this.eqSetMult(this.eqMultVal + n); }
  eqMulMult(f) { if (f && f !== 1) this.eqSetMult(this.eqMultVal * f); }

  /**
   * The SCORE side takes a ×. The only things allowed through here are hand-wide
   * OUTPUT scalers — the Repeating Pocketwatch's retrigger and the Forge
   * Hammer's value doubling — which is exactly why they get a beat of their own
   * rather than quietly inflating every card's tick. Keeps eqSlam's
   * score × mult = res.damage identity exact.
   */
  eqMulScore(f) {
    if (!f || f === 1 || !this.eqScore?.active) return;
    const from = this.eqScoreVal;
    this.eqScoreVal = from * f;
    const to = this.eqScoreVal;
    const proxy = { v: from };
    this._eqScoreTween?.remove();
    this._eqScoreTween = this.tweens.add({
      targets: proxy, v: to, duration: this.spd(230), ease: 'Cubic.easeOut',
      onUpdate: () => this.eqScore.setText(fmtTotal(Math.round(proxy.v))),
      onComplete: () => this.eqScore.setText(fmtTotal(Math.round(to))),
    });
    this.eqPunch(this.eqScore, 1.34, 300);
  }

  /**
   * IMPACT. The two halves lunge at each other, the mult reconciles to the true
   * effMult (character passives, Zeal and potions all land in that last jump),
   * and the TOTAL blooms in their place wearing its payoff tier's whole show.
   * Display only — resolveHand still deals exactly what scoring.js computed.
   */
  eqSlam(res) {
    this.eqSlamAt = performance.now();   // verification hook (__hfCombat.eqState)
    this.clearEqTag();
    // SIX OF A KIND SQUARES THE MULT, and the square is the whole hand: it has
    // to be a BEAT and not a silent jump in the reconciliation below, or the
    // biggest number the game can make arrives unexplained.
    if (res.handSquared) {
      sfx(this, 'score_tick', { volume: 0.85, rate: 1.5 });
      popMessage(this, ARENA_CX, EQ_Y - 96, 'MULT SQUARED', { color: '#7cf9ff', size: 36 });
    }
    // THE BLUR ENDS AT THE IMPACT. Everything from here — the payoff bloom, the
    // strike, the enemy's answer — plays at full weight however long the
    // cascade that fed it had to compress itself to get here.
    this.stopScoringAccel();
    // Snappier reconciliation than the cascade's, so the TRUE ×MULT is sitting
    // still (not still counting) for most of the dwell below.
    this.eqSetMult(res.effMult, true, 190);
    // ...AND THE SCORE SIDE RECONCILES TOO (JC, 2026-08-04: "the equation once
    // finished should equal the amount we damage the enemy right after"). The
    // mult always snapped to the engine's truth here; the score side kept
    // whatever the ticks had managed, so any channel with a missing or late
    // job left the equation short while the blow landed full. Now both halves
    // snap, and score x mult IS the hit. (Per STRIKE: the Chip of Tripling
    // Down deals this total once per swing, and brittle grows it on the body.)
    if (this.eqCurrency === 'damage' && Number.isFinite(res.scoreSide) && this.eqMultApplies) {
      this.eqScoreVal = res.scoreSide;
      if (this.eqScore?.active) this.eqScore.setText(fmtTotal(Math.round(res.scoreSide)));
    }
    // THE TOTAL IS THE BLOW (2026-08-10). It used to be recomputed here as
    // eqScoreVal × effMult, which is the same number the engine computed —
    // right up until it was not: the flat-damage bonus and the Giant's Brew
    // both land ON res.damage after the identity, and an overflow in either
    // half made the recompute disagree with the hit outright. res.damage is
    // what resolveHand is about to deal, so a DAMAGE hand quotes exactly it and
    // displayed == applied is true by construction rather than by arithmetic.
    // (The two currency rewrites keep the recompute: nothing else knows their
    // total, and their pools are clamped by the same cap.)
    const total = this.eqCurrency === 'damage' && this.eqMultApplies && Number.isFinite(res.damage)
      ? Math.round(res.damage)
      : (this.eqMultApplies
        ? Math.round(this.eqScoreVal * res.effMult)
        : Math.round(this.eqScoreVal));
    this.tweens.add({ targets: this.eqScore, x: ARENA_CX - 8, duration: this.spd(185), ease: 'Back.easeIn' });
    this.tweens.add({ targets: this.eqMult, x: ARENA_CX + 8, duration: this.spd(185), ease: 'Back.easeIn' });
    this.eqPunch(this.eqScore, 1.3);
    this.eqPunch(this.eqMult, 1.36, 300);
    sfx(this, 'score_tick', { volume: 0.7, rate: 0.7 });
    // The two halves DWELL before they dissolve into the total: the reconciled
    // ×MULT is the payoff and it used to be gone (170ms, most of it still
    // counting) before JC could read it. Now it settles by ~190ms and then
    // holds a further ~260 on top.
    this.time.delayedCall(this.spd(450), () => {
      this.tweens.add({ targets: [this.eqScore, this.eqTimes, this.eqMult], alpha: 0, duration: this.spd(125) });
      burst(this, ARENA_CX, EQ_Y, 0xffd23e, 10);
      totalPayoffFX(this, ARENA_CX, EQ_Y, total, {
        prefix: { shield: '◆', heal: '♥' }[this.eqCurrency] ?? '',
        hold: this.spd(840),
      });
    });
    return total;
  }

  makeButton(x, y, key, label, textColor, onClick, w = 240) {
    const img = this.add.image(x, y, key).setDisplaySize(w, BTN_LANE.plateH).setDepth(DEPTH.fx).setInteractive({ useHandCursor: true });
    const txt = this.add.text(x, y - 4, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${BTN_LANE.fontSize}px`, color: textColor,
    }).setOrigin(0.5).setDepth(DEPTH.fx);
    img.label = txt;
    // COMMIT ON RELEASE, ON TOUCH ONLY. tapBind collapses to exactly the
    // pointerdown this line used to be on desktop, so that build is unchanged
    // to the character — and the phone stops handing the back half of its own
    // gesture to whatever the plate was covering, which is the press/release
    // pass-through class ui/pointer.js exists to document. PLAY HAND deals a
    // new fan under the finger that pressed it; that is the whole risk.
    tapBind(this, img, () => {
      if (this.busy) return;
      sfx(this, 'button', { volume: 0.8 });
      this.tweens.add({ targets: [img, txt], scale: 0.94, duration: 60, yoyo: true });
      onClick(img);
    });
    return img;
  }

  /**
   * How many cards a full hand is right now: the hero's base, plus Bottled
   * Frenzy's temporary bump, plus every relic's handSizeBonus (the Tailored
   * Sleeve's +1, the Overstuffed Satchel's +2, the Ruthless Editor's −1),
   * MINUS the Fairy King's ROOTED aura — floored at HAND_SIZE_FLOOR so no
   * combination of relics and debuffs can deal a hand too small to play out of.
   * (Frenzy visibly beats the roots: 8 − 2 + 2 = 8 again.)
   */
  get effectiveHandSize() {
    return handSizeOf({
      base: this.player.handSize,
      temp: this.tempHandSize || 0,
      bonus: this.prop('handSizeBonus'),
      // The Fairy King's permanent aura and a temporary ROOTED stack ADD, and
      // handSizeOf floors the sum at HAND_SIZE_FLOOR — so no pile of roots can
      // ever deal a hand too small to play out of.
      // ...and the WEFT WARDEN's REWEAVE, which is permanent for the fight and
      // stacks with both. handSizeOf still floors the sum at HAND_SIZE_FLOOR,
      // so no amount of reweaving can deal a hand too small to play out of.
      penalty: (this.bossHandPenalty || 0) + this.rootedPenalty + (this.handShrink || 0),
    });
  }

  /** Cards off the deal from the temporary ROOTED debuff (0 when it is not up). */
  get rootedPenalty() {
    return (this.pstat?.rooted ?? 0) > 0 ? (this.rootedPower ?? ROOTED_STRENGTH) : 0;
  }

  dealToHandSize(onDone) {
    const need = this.effectiveHandSize - this.handCards.length;
    let dealt = 0;
    for (let i = 0; i < need; i++) {
      if (this.deck.length === 0) this.reshuffleDiscard();
      const card = this.deck.pop();
      if (!card) break;
      this.quakeTouch(card);
      const cs = new CardSprite(this, SIDEBAR_W - 80, GAME_H + 140, card);
      this.dressNewCard(cs);
      this.input.setDraggable(cs);
      this.handGroup.add(cs);
      this.handCards.push(cs);
      dealt++;
    }
    if (dealt > 0) sfx(this, 'card_deal', { volume: 0.77 });
    this.sortHand(true, dealt, onDone);
  }

  /**
   * THE ONE RESHUFFLE. Every draw path funnels through here so BURNED SURVIVES
   * A DISCARD-PILE RESHUFFLE has exactly one place to be true — a burned card
   * cannot come back around even if some other system put it in the discard.
   */
  reshuffleDiscard() {
    this.deck = shuffle(purgeBurned(this.discardPile, this.burnedCards));
    this.discardPile = [];
    return this.deck.length;
  }

  /**
   * HOW MANY CARDS COULD STILL REACH THE HAND: the draw pile, plus everything a
   * reshuffle would rescue from the discard. Computed exactly the way
   * reshuffleDiscard computes it, so the deadlock verdict and the next draw can
   * never disagree about whether there is anything left to deal.
   */
  get drawableCards() {
    return (this.deck?.length ?? 0)
      + purgeBurned(this.discardPile ?? [], this.burnedCards).length;
  }

  /**
   * Everything a freshly built card sprite has to wear before it lands: the
   * denial lock, the moonlight, the fade, the char. One place, so a card drawn
   * mid-fight can never disagree with one that was dealt at the bell.
   */
  dressNewCard(cs) {
    if (this.cardDenied(cs.card)) cs.setLockState('banned');
    if (isBurned(this.burnedCards, cs.card)) cs.setBurnedLook();
    this.resyncFade(cs);
    // THE MOONLIGHT FALLS ON THE DECK (JC, 2026-08-04): while the blind clock
    // holds, every card DRAWN joins the darkness — the hand you had already
    // read stays face up. This is the one funnel every fresh sprite passes
    // through, so the bell deal and a mid-fight draw go dark by one clause.
    if ((this.pstat?.blind ?? 0) > 0) this._blindIds.add(cs.card.id);
    this.resyncBlind(cs);
    return cs;
  }

  /** Sort the hand by the current mode, then lay it out. */
  sortHand(dealing = false, dealtCount = 0, onDone) {
    this.handCards.sort((a, b) => {
      if (this.sortMode === 'suit') {
        const c = a.card.suit.localeCompare(b.card.suit);
        if (c !== 0) return c;
      }
      return b.card.rank - a.card.rank;
    });
    this.layoutHand(dealing, dealtCount, onDone);
  }

  /**
   * Lays the hand out in this.handCards ORDER (manual drags persist; SORT
   * snaps back). `skip` is a card being dragged — its slot opens up but the
   * card itself stays under the pointer.
   */
  layoutHand(dealing = false, dealtCount = 0, onDone, skip = null) {
    const order = this.handCards;
    const n = order.length;
    // The arithmetic itself lives in core/dragSelect.fanSlots so the sweep's
    // hit-testing can be unit-tested against the REAL fan rather than a copy of
    // it that quietly drifts the next time the spread is retuned.
    const { startX, spread, slots } = fanSlots(n, {
      spread: CARD.fanSpread, centerX: CARD.fanCenterX, fanY: CARD.fanY,
      maxWidth: CARD.fanMaxWidth, arcMax: CARD.fanArcMax,
    });
    this._handLayout = { startX, spread };
    // The fan just changed width; the plates either side of it have to give way.
    this.layoutHandButtons();
    order.forEach((cs, i) => {
      const { x: tx, y: ty, angle: ang } = slots[i];
      cs.baseX = tx; cs.baseY = ty; cs.baseAngle = ang;
      if (cs === skip) return;
      this.tweens.add({
        targets: cs, x: tx, y: cs.selected ? ty - CARD.selectLift : ty, angle: ang,
        duration: dealing ? 300 : 160,
        delay: dealing ? i * 45 : 0,
        ease: 'Back.easeOut',
        onComplete: i === n - 1 ? onDone : undefined,
      });
    });
    this.restackHand(skip);
    if (n === 0 && onDone) onDone();
  }

  /**
   * Pure fan order: left to right, the right card always on top — selected or
   * not. Selection LIFTS a card, it must not restack it (JC: recency stacking
   * made a half-picked hand impossible to read). `skip` is the card currently
   * under the pointer, which stays on top for as long as the drag lasts.
   */
  restackHand(skip = null) {
    for (const cs of this.handCards) if (cs !== skip) this.handGroup.bringToTop(cs);
    if (skip) this.handGroup.bringToTop(skip);
  }

  /**
   * FEAR is capped at FEAR_CAP however many throats scream it. Three fear-happy
   * enemies used to stack you down to a one-card hand and end the fight on the
   * spot; two is a real squeeze that you can still play out of.
   */
  get fearBite() { return Math.min(FEAR_CAP, this.pstat.fear); }

  get maxSelectable() {
    const cap = this.prop('maxHandCards');   // reserved: hand-size limiting relics
    return Math.max(1, Math.min(5 - this.fearBite, cap > 0 ? cap : 5));
  }

  /** Any selected card under the Keeper's seal? (They discard; they never play.) */
  sealedSelected() { return (this.selected ?? []).some(c => c.lockState === 'banned'); }

  denySealed() {
    for (const c of this.selected) {
      if (c.lockState === 'banned') this.tweens.add({ targets: c, x: c.x + 7, duration: 45, yoyo: true, repeat: 2 });
    }
    // Name the reason. Since the wave there are two ways to be locked and
    // "SEALED" alone left a player staring at a perfectly ordinary King.
    const locked = this.selected.filter(c => c.lockState === 'banned');
    // BURNED is checked FIRST because it is the only one of the three that is
    // permanent: telling a player their spent card is "SEALED" invites them to
    // wait for a clock that is never going to run out.
    const burnedOnly = locked.length && locked.every(c => isBurned(this.burnedCards, c.card));
    const faceOnly = (this.pstat.courtLock ?? 0) > 0
      && this.selected.every(c => c.lockState !== 'banned' || isFaceCard(c.card));
    popMessage(this, ARENA_CX, 640,
      burnedOnly ? 'BURNED: that card is spent for the rest of the fight'
        : faceOnly ? 'COURT ADJOURNED: discard the face cards, not play them'
          : 'SEALED: discard them, not play them',
      { color: burnedOnly ? '#ff9a50' : '#c9a2ff', size: 30 });
  }

  /**
   * THE TRUE DEAD END. Every card in hand denied + no discards left.
   *
   * THE HIGHEST-RISK THING IN THE 2026-08-02 WAVE. There used to be exactly one
   * way to make a card unplayable (the Keeper's seal) and this guard was
   * written against that field directly. There are three now — a suit seal, a
   * timed suit seal and COURT ADJOURNED — and they COMBINE: face-locked plus
   * suit-sealed plus zero discards is a genuine no-playable-hand state that
   * neither denial produces on its own.
   *
   * So it no longer asks WHY a card is locked, only THAT every card is: the
   * condition is derived from the locks `resyncDenialLocks` laid down, which
   * are themselves derived from `cardDenied`. Any denial anyone adds later is
   * caught by this for free, including in the potion-mercy branch.
   *
   * If a potion could still change the hand, warn; otherwise NO PLAYABLE HANDS
   * and the run ends. (Free discards are also an out — infinite discards mean
   * there is always another hand.)
   */
  checkSealDeadlock() {
    if (this._sealDoom || this.busy) return;
    // The whole verdict is one pure call (core/statuses.deadlockState), so the
    // worst combination can be constructed in a unit test rather than farmed.
    const verdict = deadlockState({
      hand: (this.handCards ?? []).map(c => c.card),
      denial: this.denial,
      discards: this.discardsLeft,
      freeDiscards: this.prop('freeDiscards') > 0,
      potions: run.potions.filter(p => p.use === 'combat').map(p => p.effect?.type),
      enemiesAlive: this.livingEnemies().length,
      // WHAT COULD STILL REACH THE HAND: the draw pile, plus whatever a
      // reshuffle would rescue from the discard — which is the discard MINUS
      // the burned, exactly as reshuffleDiscard computes it. An empty hand with
      // this at zero is unrecoverable, and deadlockState now says so instead of
      // waving it through. (No potion is an out either: SUMMONER'S INK reads
      // the same empty draw pile and refuses.)
      drawable: this.drawableCards,
    });
    if (verdict === 'ok') return;
    if (verdict === 'warn') {
      if (!this._sealWarned) {
        this._sealWarned = true;
        this.announce('NO PLAYABLE HANDS. Only a potion can save you.', '#c9a2ff');
      }
      return;
    }
    this._sealDoom = true;
    // AN EMPTY HAND WITH NOTHING TO DRAW is the same defeat wearing a different
    // reason: you are not locked out of your deck, there is no deck left.
    const empty = !(this.handCards ?? []).length;
    // The last raw copy of the big-message recipe; bigMessage owns the text and
    // its own exit tween now, so this only has to schedule the defeat.
    this.bigMessage(empty ? 'NO CARDS LEFT' : 'NO PLAYABLE HANDS', '#c9a2ff', 84, 1400, 320);
    this.makeEdgeVignette(0x8050c0, 0, 0.5, 520, DEPTH.fx + 2, 1);
    sfx(this, 'fear_placed', { volume: 0.9 });
    const why = this.denialLabel || 'Every card sealed';
    this.time.delayedCall(2200, () => this.defeat(empty
      ? 'Your hand is empty and there is nothing left to draw.'
      : `${why}, every out spent. Locked out of your own deck.`));
  }

  // =========================================================================
  // SWEEP TO SELECT (settings.dragSelect — PATCH 0803 §4)
  // -------------------------------------------------------------------------
  // Press a card and drag SIDEWAYS: every card the pointer crosses toggles, so
  // one stroke picks a hand and the same stroke run backwards puts it back. An
  // UPWARD drag is untouched and still reorders the fan. The split is decided
  // once, at dragstart, by core/dragSelect.gestureKind.
  //
  // A sweep is a BULK gesture, so every refusal is silent. Clicking a sealed
  // card still selects it (they are legal to discard, and that has always been
  // deliberate) and clicking past the cap still says FEAR! — but a sweep that
  // stopped to argue about each card it could not take would be miserable to
  // use, and the whole point is that you keep moving.
  // =========================================================================

  /**
   * The fan as boxes, in left-to-right order — which is also stacking order, so
   * dragSelect's backwards search lands on the same card Phaser's own topmost
   * hit test would.
   *
   * baseX/baseY, NOT x/y: you sweep the ROW, not the sprites. A selected card is
   * lifted 56px and a hovered one 34, and if the boxes moved with them a sweep
   * would start missing exactly the cards it had just picked up.
   */
  sweepBoxes() {
    return (this.handCards ?? []).map(cs => ({ x: cs.baseX, y: cs.baseY, w: CARD.w, h: CARD.h }));
  }

  /** The reorder drag, exactly as it has always been. Deferred when held. */
  beginReorder(obj) {
    // THE VERDICT IS THE GESTURE'S, NOT THE CARD'S (bug found 2026-08-10 while
    // driving the pass-through wave).
    //
    // This used to write `obj._justDragged = true`, to be cleared by the same
    // gesture's `gameobjectup` so that a reorder never also selected the card
    // it moved. But `gameobjectup` only fires when the card is still the
    // topmost thing under the pointer AT RELEASE, and after a reorder it very
    // often is not: the fan re-lays out under the finger, the pointer lands in
    // the gap between two slots, or on a neighbour. When that happened the flag
    // was never consumed and it SILENTLY ATE THE NEXT CLICK ON THAT CARD —
    // measured at 4 clicks in 5 on a reordered hand, and it predates this wave.
    //
    // So the flag is now the PRESS's, exactly like `_sweptThisPress` beside it,
    // and the scene's own pointerdown clears it. A gesture cannot leak a verdict
    // into the next gesture if the verdict dies with the press that made it.
    this._reorderedThisPress = true;
    this.handGroup.bringToTop(obj);
    this.tweens.add({ targets: obj, scale: 1.08, duration: 90 });
  }

  /** Begin a sweep on the card the press landed on. That card counts as crossed. */
  startSweep(origin, p) {
    this._sweptThisPress = true;
    this._sweepTickAt = 0;
    // The sweep starts from the PRESS, not from where the gesture committed, so
    // the 26px of travel that made the decision is not a blind spot: a stroke
    // that begins on card 3 and commits halfway to card 4 still counts card 3.
    this._sweep = {
      x: p.downX, y: p.downY, last: this.handCards.indexOf(origin), cameFrom: -1,
    };
    this.sweepCard(origin);
    this.sweepMove(p);
  }

  /**
   * THE POINTER'S REAL PATH SINCE THE LAST MOVE, not the straight line to it.
   *
   * Chrome does not deliver a pointermove per hardware sample; it merges every
   * sample that arrived since the last frame into ONE event and hands the rest
   * over only if you ask, via getCoalescedEvents(). Under load — and a sweep
   * that toggles five cards in one frame IS load — the gap between two events
   * Phaser sees can be most of the fan, and everything between them was a
   * straight line as far as the walk knew. On a row of cards a chord and the
   * true path usually cross the same cards, but a stroke that dips below the
   * fan and comes back is a different set of crossings depending on which of
   * the two you walk, and the player only ever performed one of them.
   *
   * So the walk is given every sample the browser actually took. Where the API
   * is missing (older mouse events) this degrades to exactly the old behaviour.
   */
  sweepPoints(p) {
    const pts = [];
    try {
      const raw = p.event?.getCoalescedEvents?.();
      if (raw && raw.length > 1) {
        for (const e of raw) {
          pts.push({ x: this.scale.transformX(e.pageX), y: this.scale.transformY(e.pageY) });
        }
      }
    } catch { pts.length = 0; }   // a synthetic or recycled event: fall back

    // Always finish exactly where Phaser believes the pointer is, so the state
    // carried to the next call and the state the rest of the scene sees agree.
    pts.push({ x: p.x, y: p.y });
    return pts;
  }

  /**
   * THE RACE, run once per pointer move while a drag is HELD, then never again
   * for that gesture. Whichever of the two gestures crosses its own commit
   * distance first takes the whole stroke.
   */
  handPointerMove(p) {
    const held = this._pendingDrag;
    if (held) {
      // The hand can be rebuilt under a held card (a potion, a boss). Let go.
      if (!this.handCards?.includes(held) || this.busy || this.potionPicking) {
        this._pendingDrag = null;
        return;
      }
      const kind = gestureKind(p.x - p.downX, p.y - p.downY);
      if (kind === 'pending') return;
      this._pendingDrag = null;
      if (kind === 'reorder') { this.beginReorder(held); return; }
      this.startSweep(held, p);
      return;
    }
    this.sweepMove(p);
  }

  /** Walk the pointer's travel since the last move and toggle everything crossed. */
  sweepMove(p) {
    const s = this._sweep;
    if (!s) return;
    const { hits, last, cameFrom } = sweepHits(this.sweepBoxes(),
      [{ x: s.x, y: s.y }, ...this.sweepPoints(p)],
      { from: s.last, cameFrom: s.cameFrom, w: CARD.w, h: CARD.h });
    s.x = p.x; s.y = p.y; s.last = last; s.cameFrom = cameFrom;
    for (const i of hits) {
      const cs = this.handCards[i];
      if (cs) this.sweepCard(cs);
    }
  }

  endSweep() {
    if (!this._sweep) return;
    this._sweep = null;
    // The fan never moved during a sweep, but a selection changed under it, so
    // heal the z-order the way the click path does when it finishes.
    this.layoutHand();
  }

  /**
   * One card, crossed. Selected cards come off, unselected legal ones go on,
   * and anything the rules forbid is passed over without a word:
   *   frozen / denied  — cannot be played, so a sweep will not take them
   *   hypnotised       — the gaze holds it selected; it is not yours to drop
   *   over the cap     — FEAR or a relic already said so; do not say it 5 times
   */
  sweepCard(cs) {
    if (this.busy || this.potionPicking) return;
    if (cs.selected) {
      if (cs === this.hypnoCard) return;
      this.selected = this.selected.filter(c => c !== cs);
      cs.setSelected(false);
      this.sweepTick('card_deselect');
    } else {
      if (cs.playLocked || this.cardDenied(cs.card)) return;
      if (this.selected.length >= this.maxSelectable) return;
      this.selected.push(cs);
      cs.setSelected(true);
      this.sweepTick('card_select');
    }
    this.restackHand();   // lift only — the fan's left-to-right order holds
    this.updatePreview();
  }

  /**
   * The sweep's voice: the SAME click tick, at the same rising pitch, so a
   * stroke across five cards runs up the keyboard and a stroke back runs down
   * it. Rate-capped at SWEEP_TICK_MS, because a fast flick across eight cards
   * fires eight toggles inside two frames and that is a machine gun, not a run.
   * The toggle itself is never dropped — only its tick.
   */
  sweepTick(key) {
    const now = this.time.now;
    if (now - this._sweepTickAt < SWEEP_TICK_MS) return;
    this._sweepTickAt = now;
    sfx(this, key, {
      volume: key === 'card_select' ? 0.16 : 0.24,
      rate: 0.98 + this.selected.length * 0.03,
    });
  }

  toggleCard(cs) {
    if (this.busy) return;
    if (this.potionPicking) return this.applyCardPick(cs);
    if (cs.lockState === 'frozen') {
      this.tweens.add({ targets: cs, x: cs.x + 6, duration: 45, yoyo: true, repeat: 1 });
      return;
    }
    // SEALED cards may be selected — to be DISCARDED. Playing them is gated
    // in playHand/updatePreview (JC: the Keeper could soft-lock an all-sealed
    // hand with no discards; see checkSealDeadlock for the true dead end).
    if (cs.selected) {
      if (cs === this.hypnoCard) {
        this.tweens.add({ targets: cs, angle: cs.baseAngle + 6, duration: 60, yoyo: true, repeat: 1 });
        return;
      }
      this.selected = this.selected.filter(c => c !== cs);
      cs.setSelected(false);
      this.layoutHand();   // restack so the fan's z-order heals
      sfx(this, 'card_deselect', { volume: 0.24, jitter: 0.05 });
    } else {
      if (this.selected.length >= this.maxSelectable) {
        if (this.fearBite > 0) popMessage(this, cs.x, cs.y - 120, 'FEAR!', { color: '#a060e0', size: 30 });
        else if (this.prop('maxHandCards') > 0) popMessage(this, cs.x, cs.y - 120, 'YOUR RELIC FORBIDS IT', { color: '#ffc542', size: 26 });
        return;
      }
      this.selected.push(cs);
      cs.setSelected(true);
      this.restackHand();   // lift only — the fan's left-to-right order holds
      sfx(this, 'card_select', { volume: 0.14, rate: 0.98 + this.selected.length * 0.03 });
    }
    this.updatePreview();
  }

  updatePreview() {
    this.updateWinterGate();
    // THE SEALED-SELECTION SOFT LOCK (friend's playtest, Act IV finale, 2026-08-02).
    //
    // This used to DISABLE the button when a denied card was selected and then
    // never re-enable it, because the only other writer is refreshAll() and that
    // does not run on a card click. So: click a sealed card once, deselect it,
    // pick a perfectly legal hand, and PLAY HAND stayed grey until the enemy's
    // turn came round. With no discards left that reads as an unwinnable run,
    // which is exactly what was reported at the Keeper.
    //
    // The button now has ONE predicate here and it is evaluated on every path.
    // WINTER'S FORCE still owns the button outright when it is running (two
    // writers make it flicker every refresh), so only touch it when it is not.
    if (this.sealedSelected()) {
      if (!this.wintersForce) this.setPlayEnabled(false);
      this.setPreviewText('SEALED cards can be DISCARDED, not played');
      return;
    }
    if (!this.wintersForce) this.setPlayEnabled(this.handsLeft > 0);
    if (this.selected.length === 0 || !this.target) {
      this._previewSig = '';
      this.setPreviewText('');
      return;
    }
    // BLIND, and the hole it would otherwise leave (2026-08-03). The preview
    // solves the hand for you — so a preview that reads a FACE-DOWN card would
    // hand back the exact information the moonlight just took, one card at a
    // time. A selection with a blinded card in it is therefore unreadable, and
    // says so. PLAY HAND stays lit: the card is still entirely playable, and
    // committing it blind is the whole decision Act I is asking you to make.
    if (this.selected.some(c => c.blinded)) {
      this._previewSig = 'blind';
      this.setPreviewText('? ? ?   one of these is face down. Play it and find out');
      return;
    }
    const cards = this.selected.map(c => c.card);
    // bestHandOf IS evaluateHand for 1-5 cards; it only differs when GO-GO GOO
    // has lit a whole eight-card hand, which is the one time a selection can be
    // bigger than the evaluator's five.
    const ev = bestHandOf(cards, this.handEvalOpts());
    const res = scoreHand({ cards, character: this.chr.id, state: this.buildScoreState(cards) });
    // NO NUMBERS FROM IRON UP (0803-B §1.4). The hand is still SCORED here — the
    // bench cast, the value grants and the verification hooks all hang off this
    // call — but from IRON the readout is the hand's NAME and nothing else. You
    // keep the rule (which cards score, what the Smith levelled) and lose the
    // solved answer. BRONZE is unchanged.
    const showMath = showsHandMath(run);
    const level = res.handLevel ? `  (Lv.${res.handLevel + 1})` : '';
    const bits = [showMath ? `${ev.name} ×${res.effMult}${level}` : `${ev.name}${level}`];
    const dmg = res.damage ? Math.round(res.damage * brittleMultiplier(this.target)) : 0;
    if (!showMath) {
      this.setPreviewText(bits[0]);
      const quiet = this.selected.map(c => c.card.id).join('|');
      if (quiet !== this._previewSig) { this._previewSig = quiet; this.previewPunch(); }
      return;
    }
    // THE LIVE MATH IS PRINTED AT FULL RESOLUTION (PATCH 0803 §3, the "equation
    // does not update when the hand TYPE is unchanged" bug).
    //
    // The math was ALWAYS re-read — updatePreview runs on every single toggle.
    // What froze was the READOUT: fmtNum compresses to two significant figures,
    // so at 20,000 damage it prints '20k' and quantises every swap smaller than
    // a thousand points into the same six characters. setPreviewText then
    // compares strings, finds them identical and returns without touching the
    // label. The only part of the line that reliably moved was the hand's NAME,
    // which is exactly the symptom that was reported. fmtTotal keeps the
    // thousands separators and only compresses past a million, so a one-card
    // swap always moves a digit.
    if (res.damage) bits.push(`⚔ ${fmtTotal(dmg)}`);
    // THE CLUB SPLASH, live: 25% of what the clubs in this selection deal,
    // onto every other foe. It moves as you add and remove cards, which is the
    // whole point — the splash is a reason to hold a club, so it has to be
    // visible BEFORE you commit the hand.
    if (res.aoeSplash) bits.push(`${AOE_GLYPH} ${fmtTotal(res.aoeSplash)}`);
    if (res.heal) bits.push(`♥ +${res.heal}`);
    // SHATTERGUARD says so in the PREVIEW, before the hand is committed — the
    // whole point of a preview is that it never lies about what you will get.
    if (res.shield) bits.push(this.shatterguard ? '◆0 SHATTERED' : `◆ +${this.shieldGain(res.shield)}`);
    // OPHELIA: the poison this hand's damage will leave behind (target share).
    const seep = this.poisonConversion();
    if (seep > 0 && dmg > 0) bits.push(`☠ +${fmtTotal(Math.round(dmg * seep))}`);
    if (res.chipBonus) bits.push(`◉ +${res.chipBonus}`);
    this.setPreviewText(bits.join('   '));
    // ...and it VISIBLY re-reads. A swap that happens to score identically (a 5
    // for another 5) legitimately prints the same line, so the confirmation is
    // keyed on the SELECTION rather than on the string: change what is picked,
    // and the readout punches whether or not its digits moved.
    const sig = this.selected.map(c => c.card.id).join('|');
    if (sig !== this._previewSig) {
      this._previewSig = sig;
      this.previewPunch();
    }
  }

  /** The live-math line acknowledging a click: one quick swell, never a fade. */
  previewPunch() {
    const pt = this.previewText;
    if (!pt?.active || !pt.text) return;
    const fit = this._previewFit ?? 1;
    pt._punch?.remove();
    pt.setScale(fit * 1.09);
    pt._punch = this.tweens.add({ targets: pt, scale: fit, duration: 150, ease: 'Back.easeOut' });
  }

  /**
   * Show/hide the hand math with a fade instead of a blink. Appearing and
   * disappearing cross 140ms; a string CHANGE while it is already up swaps
   * instantly, because updatePreview fires on every single click and re-fading
   * per card would strobe.
   */
  setPreviewText(str) {
    const pt = this.previewText;
    if (str === this._previewWant) return;
    this._previewWant = str;
    this.tweens.killTweensOf(pt);
    if (!str) {
      if (pt.alpha === 0) { pt.setText(''); return; }
      this.tweens.add({ targets: pt, alpha: 0, duration: 140, onComplete: () => pt.setText('') });
      return;
    }
    const settled = pt.text !== '' && pt.alpha === 1;
    pt.setText(str);
    // FULL-RESOLUTION NUMBERS COST WIDTH. '20,008' is twice '20k', and a late-run
    // line carrying damage, splash, heal, shield, poison and chips at once could
    // now run off the arena. So the line SHRINKS to fit rather than being
    // truncated or re-compressed: the whole point of the change is that every
    // digit is readable, and a slightly smaller line is still readable.
    const maxW = GAME_W - SIDEBAR_W - 64;
    this._previewFit = pt.width > maxW ? maxW / pt.width : 1;
    pt.setScale(this._previewFit);
    if (!settled) this.tweens.add({ targets: pt, alpha: 1, duration: 140 });
  }

  // ---------------- Actions ----------------
  discardSelected() {
    if (this.busy || this.selected.length === 0) return;
    const free = this.prop('freeDiscards') > 0;
    if (!free && this.discardsLeft <= 0) return;
    if (!free) {
      this.discardsLeft--;
      // The discard-refund lever. Nothing grants it since the Sticky Gloves
      // became a chip multiplier (2026-08-01) — kept as the general switch.
      if (this.prop('discardRefundChance') > 0 && Math.random() < this.prop('discardRefundChance')) {
        this.discardsLeft++;
        popMessage(this, GAME_W - 194, 880, 'REFUNDED!', { color: '#8fe098', size: 26 });
      }
    }
    // RECAP: the ACTION is the discard, so a Sticky Gloves refund (or a relic
    // that makes them free) still counts one — the player spent the beat.
    if (run.stats) run.stats.discardsUsed += 1;
    this._discardsThisFight = (this._discardsThisFight ?? 0) + 1;   // CLEAN SHEET
    if (this.hypnoCard && !this.selected.includes(this.hypnoCard)) this.selected.push(this.hypnoCard);
    if (this.hypnoCard) { this.hypnoCard.setLockState(null); this.hypnoCard = null; }
    const going = [...this.selected];
    // RAGPICKER'S HOOK. Fired on EVERY discard the player actually takes —
    // refunded ones and free ones included — which is the same reading the
    // recap tally three lines up already uses: the ACTION is the discard, and
    // a beat you spent is spent. The alternative (only when discardsLeft
    // really came down) would quietly turn a refund relic into a nerf on the
    // hook, and would pay a free-discard build nothing at all.
    this.artHook('discard', { cards: going.map(cs => cs.card) });
    this.selected = [];
    this.busy = true;
    going.forEach((cs, i) => {
      this.discardPile.push(cs.card);
      this.handCards = this.handCards.filter(c => c !== cs);
      this.tweens.add({
        targets: cs, x: GAME_W + 120, angle: 40, alpha: 0.6,
        duration: 220, delay: i * 50, ease: 'Cubic.easeIn',
        onComplete: () => cs.destroy(),
      });
    });
    this.time.delayedCall(going.length * 50 + 240, () => {
      this.busy = false;
      this.dealToHandSize(() => {
        this.markHypnoCard();
        // THE MISTRIAL, AGAIN (2026-08-03). The turn-top check was the only one,
        // and a discard is the one thing that can replace a playable hand with an
        // unplayable one WITHOUT ending the turn: spend the last discard into a
        // fan that can only form spent types and the turn-top check is never
        // reached again. Checked here it costs one call per discard and closes
        // the last door out of the docket.
        this.checkMistrial();
        this.refreshAll();
      });
      this.setPreviewText('');
    });
    this.refreshAll();
  }

  // ---------------- Per-card score presentation ----------------

  /**
   * The number that lives ABOVE a scoring card: that card's VALUE, with every
   * PRINTED mod already baked in — a NUKE shows its 100 in ONE animation, not
   * a base beat plus a correction. It persists (unlike popNumber) because an
   * artifact may still rewrite it in place a beat later.
   */
  valuePop(x, y, text, color, size = 40) {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${size}px`, color,
      stroke: '#241505', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(DEPTH.fx).setAlpha(0).setScale(0.6);
    t.setShadow(3, 5, '#000000aa', 8, true, true);
    this.tweens.add({
      targets: t, alpha: 1, scale: 1.12, y: y - 8,
      duration: this.spd(150), ease: 'Back.easeOut',
    });
    return t;
  }

  /**
   * 7 -> 10, in the SAME slot: no lane, no "+3 =" string under the card. The
   * relic that did it swells alongside (pulseValueArtifacts) and the number
   * turns gold, so the rewrite is unmistakably artifact-flavoured.
   */
  valueMorph(t, text, color = '#ffd23e') {
    if (!t?.active) return;
    this.tweens.killTweensOf(t);
    t.setText(text).setColor(color).setAlpha(1).setScale(1.62);
    this.tweens.add({ targets: t, scale: 1.12, duration: this.spd(230), ease: 'Back.easeOut' });
  }

  /** ...and away it flies, onto the SCORE side of the equation. */
  valueRelease(t, delay = 0) {
    if (!t?.active) return;
    this.time.delayedCall(delay, () => {
      if (!t.active) return;
      this.tweens.killTweensOf(t);
      this.tweens.add({
        targets: t, x: ARENA_CX - EQ_GAP - 26, y: EQ_Y + 10,
        alpha: 0, scale: 0.62, duration: this.spd(380), ease: 'Cubic.easeIn',
        onComplete: () => t.destroy(),
      });
    });
  }

  /**
   * A card's NON-damage outputs, kept strictly BENEATH it. The damage stream
   * (value -> score -> total) owns everything above the played row; heal,
   * shield, chips and status stacks live below it and never touch the score.
   */
  /**
   * A card's non-damage outputs, popped beneath it. `b` carries ONE activation
   * of the card, so the hand-wide scales the relics bought (the Pocketwatch's
   * retrigger, the Hammer's ×2, the Ancient Shield / Infinite Heart's ×mult)
   * are re-applied here — otherwise the ♥ under the card would print half of
   * what the hero actually receives.
   */
  cardOutputs(cs, b, scale = null) {
    const healX = scale?.heal ?? 1, shieldX = scale?.shield ?? 1, chipX = scale?.chips ?? 1;
    const bits = [];
    const heal = Math.round(b.heal * healX), shield = Math.round(b.shield * shieldX);
    const chips = Math.round(b.chips * chipX);
    // BLOOD SEALED pays in HP, on the card's own line and in the seal's crimson
    // — it is the CARD healing you, not the hand's Hearts.
    const seal = Math.round((b.sealHeal ?? 0) * chipX);
    if (seal) bits.push([`♥+${seal}`, '#ff5a70']);
    // The MULTIPLICATIVE SEAL, on the same beneath-the-card line as its twin.
    if (b.stampMult) bits.push([`+${b.stampMult} MULT`, '#c890ff']);
    if (heal) bits.push([`♥${fmtNum(heal)}`, '#ff9aa4']);
    if (shield) bits.push([`◆${fmtNum(shield)}`, '#7fe0f4']);
    if (chips) bits.push([`◉${chips}`, '#ffc542']);
    // THE CLUB SPLASH, per card, in the same beneath-the-card idiom as ♥ and ◆:
    // this card's own contribution to what every other enemy is about to take.
    // b.aoe is already fully scaled (outScale × effMult), like b.damage.
    if (b.aoe > 0) bits.push([`${AOE_GLYPH} +${fmtNum(b.aoe)}`, AOE_COLOR]);
    bits.forEach(([txt, color], k) => {
      popNumber(this, cs.x, cs.y + 122 + k * 32, txt,
        { color, size: 26, rise: 30, delay: k * this.spd(80) });
    });
  }

  /**
   * THE WHEEL STOPS. The card takes its result's colour for the rest of the
   * beat and says what it paid — gold ◉+15, red +2 MULT, green +10, or BLACK,
   * which is the whole point of the gamble: nothing.
   */
  /**
   * THE WHEEL STOPS. `result` is ONE spin, not the card: since 2026-08-04 a
   * roulette card turns the wheel again on every activation, so the same sprite
   * can go black, then red, then gold inside one hand, and each of those is its
   * own reveal.
   */
  revealRoulette(cs, result) {
    if (!cs?.active) return;
    const LOOK = {
      gold: { text: `◉ +${ROULETTE_GOLD_CHIPS}`, color: '#ffd23e', tint: 0xffd23e, sfx: ['chips_stack', 0.7, 1] },
      red: { text: `+${ROULETTE_RED_MULT} MULT`, color: '#ff7a3c', tint: 0xe0434f, sfx: ['score_tick', 0.8, 1.5] },
      black: { text: 'BLACK: nothing', color: '#b0a8c0', tint: 0x2a2030, sfx: ['card_deselect', 0.6, 0.8] },
      green: { text: `+${ROULETTE_GREEN_VALUE}`, color: '#6fdc7f', tint: 0x3fa64b, sfx: ['minor_upgrade', 0.6, 1.1] },
    }[result];
    if (!LOOK) return;
    cs.setRouletteResult(result);
    const [key, vol, rate] = LOOK.sfx;
    sfx(this, key, { volume: vol, rate });
    this.tweens.add({ targets: cs, angle: { from: -4, to: 4 }, duration: 60, yoyo: true, repeat: 1, onComplete: () => cs.setAngle(0) });
    burst(this, cs.x, cs.y - 20, LOOK.tint, result === 'black' ? 4 : 9);
    popNumber(this, cs.x, cs.y - 108, LOOK.text, { color: LOOK.color, size: result === 'black' ? 26 : 32 });
  }

  /**
   * THE CARD FIRES AGAIN (JC, 2026-08-04: "repeat seals should make the card
   * show the activation again just like repeat artifacts and add to the repeat
   * tally").
   *
   * An ECHO SEAL and the Ouroboros both make ONE CARD happen more than once
   * inside a single play of the hand, and until now that was completely
   * invisible: the seal quietly doubled a number and the card sat still. Every
   * activation past the first now gets its own beat — the wheel re-spins if the
   * card carries one, the value pops again, the mult side takes its ×, and the
   * score climbs by exactly what that activation was worth.
   *
   * @param {object} cs   the played card sprite
   * @param {object} b    its breakdown row
   * @param {number} k    which activation (1-based index into b.beats)
   * @param {number} of   how many card-level activations there are in total
   */
  cardActivationBeat(cs, b, k, of) {
    if (!cs?.active) return;
    const list = b.beats ?? [];
    const beat = list.length ? list[k % list.length] : null;
    if (!beat) return;
    this.handTick('score_tick', { volume: 0.8 });
    // The tally, in the equation's own caption, in EXACTLY the form a repeating
    // HAND reads ("just like repeat artifacts" - JC). It deliberately does not
    // spell out ECHO: the tag is anchored off the hand name's live width with
    // one gap, and the longer label ran its last glyph into the caption. The
    // blue seal is already on the card, and the card is punching as it says it.
    this.eqTag(`↻ ${k + 1} / ${of}`, { big: k < 2 });
    this.tweens.add({ targets: cs, scale: 1.18, duration: 110, yoyo: true, ease: 'Back.easeOut' });
    // A wheel card spins afresh: this activation is a different card.
    if (beat.roulette) this.revealRoulette(cs, beat.roulette);
    if (beat.dead) {
      // BLACK on the repeat. Nothing rises, nothing reaches the score, and the
      // reveal above has already said why.
      return;
    }
    const col = { swords: '#aec4f4', hearts: '#ff9aa4', gems: '#7fe0f4', clovers: '#8fe098' }[b.suit] ?? '#ffd166';
    burst(this, cs.x, cs.y - 40, SUIT_COLORS[cs.card.suit] ?? 0xffc542, 6);
    popNumber(this, cs.x, cs.y - 76, `${beat.value}`, { color: col, size: 32, rise: 44, hold: 70 });
    const unit = this.eqCurrency === 'damage' ? beat.rawDamage
      : (beat.shield || beat.heal || beat.rawDamage || 0);
    this.eqAddScore(unit);
    // The ×mult layers sign again too (scoring.js counts them per activation
    // and puts the product ON the beat, wrap included), and the beat's flat
    // mult — a RED spin, a MULTIPLICATIVE SEAL — adds on the same side. Live,
    // per activation (JC, 2026-08-04: "the mult should also be live tracked").
    const f = beat.multFactor ?? MOD_MULT_FACTOR[b.mod];
    if (f) this.eqMulMult(f);
    if (beat.mult) this.eqAddMult(beat.mult);
  }

  // ---------------- THE BENCH BEAT (PATCH 0803 §3) ----------------

  /**
   * THE CARDS YOU DID NOT PLAY GET THEIR OWN BEAT.
   *
   * Two relics read the cards LEFT IN YOUR HAND — the RIGGED WHEEL counts the
   * benched ROULETTE cards, the VOIDCALLER the benched ETHEREAL ones — and both
   * pay BENCH_FACTOR per card. Until 0803 that arrived as one combined ×1.95
   * somewhere in the relic cascade and the arithmetic simply APPEARED: the
   * player could not tell which cards had earned it, or that holding a card back
   * was a decision at all.
   *
   * So each benched card now steps forward on its own, LEFT TO RIGHT, wearing
   * its own ×1.25 above it, while the mult side climbs in real time. The relic
   * that is reading them swells on every card, so the cause is on screen as
   * often as the effect.
   *
   * The schedule is the SAME exponential ramp the repeat beat uses — a bench of
   * seven would otherwise outlast the hand that earned it.
   *
   * @returns {number} how long the whole beat takes, in ms.
   */
  /**
   * THE LEFTOVER PHASE (PATCH 0803-B §1.1) — everything that reads the cards you
   * did NOT play, resolving after the hand has finished repeating.
   *
   * Two beats, in reading order:
   *   1  COURT IN SESSION, which is paid on the whole bench at once (+20% a
   *      trigger), so it takes a single bow. It used to fire in the middle of
   *      the relic cascade; a relic whose arithmetic lands last has to TAKE ITS
   *      BOW last, or the running mult on screen is a number the hand never held.
   *   2  the per-card bench beat below (the Rigged Wheel, the Voidcaller).
   *
   * @returns {number} how long the whole phase takes, in ms.
   */
  leftoverPhase(startAt) {
    let ms = 0;
    const job = this._leftoverJob;
    if (job?.art && job.factor > 1) {
      this.time.delayedCall(startAt, () => {
        this.handTick('score_tick', { volume: 0.75 });
        this.eqTag(`HELD BACK ×${this._leftoverCount ?? 0}`, {
          color: '#e8dcc0', hold: this.spd(1100),
        });
        this.eqMulMult(job.factor);
        this.pulseArtifact(job.art, { mult: job.factor, color: '#ff8c28' });
      });
      ms += this.spd(340);
    }
    if ((this._benchBeat ?? []).length) ms += this.benchBeat(startAt + ms) + this.spd(120);
    return ms;
  }

  benchBeat(startAt) {
    const cast = this._benchBeat ?? [];
    if (!cast.length) return 0;
    const cycle = this.spd(300);
    const { starts, effScales, totalMs } = repeatSchedule(cast.length, cycle);

    this.time.delayedCall(startAt, () => {
      this.eqTag(`HELD BACK ×${cast.length}`, {
        color: '#e8dcc0', hold: totalMs + this.spd(500),
      });
    });

    cast.forEach(({ cs, art, factor, color, tint }, i) => {
      this.time.delayedCall(startAt + starts[i], () => {
        if (!cs?.active) return;
        this._benchFired = (this._benchFired ?? 0) + 1;
        // ORDERING PROOF (0803-B §1.1): the wall clock of the FIRST bench beat,
        // which must land after the LAST repeat activation. Read back by
        // feelState so a verification run can assert the order rather than
        // eyeball a screenshot of it.
        if (!this._benchAt) this._benchAt = performance.now();
        this.handTick('score_tick', { volume: 0.7 });
        // The card LIFTS out of the fan, holds, and drops back: a benched card
        // is still yours, so it is emphasised rather than consumed.
        this.tweens.add({
          targets: cs, y: cs.baseY - 74, scale: 1.14,
          duration: Math.max(70, Math.round(effScales[i] * cycle * 0.35)),
          yoyo: true, ease: 'Back.easeOut',
          onComplete: () => { if (cs.active) { cs.setY(cs.baseY); cs.setScale(1); } },
        });
        if (cs.glow?.active) {
          this.tweens.killTweensOf(cs.glow);
          this.tweens.add({
            targets: cs.glow, alpha: 0.7, duration: 110, yoyo: true, hold: 120,
            onComplete: () => { if (cs.glow.active && !cs.selected) cs.glow.setAlpha(0); },
          });
        }
        burst(this, cs.x, cs.y - 30, tint, 7);
        // Benched cards sit shoulder to shoulder in the fan, so three labels on
        // one line would overlap. They alternate height and leave quickly: this
        // beat is a SEQUENCE, and a label still hanging around from two cards
        // ago makes it read as a pile.
        popNumber(this, cs.x, cs.y - 132 - (i % 2) * 38, `×${factor}`,
          { color, size: 34, rise: 52, hold: 40 });
        // ...and the mult climbs by exactly this one card's worth, now.
        this.eqMulMult(factor);
        this.pulseArtifact(art, { mult: factor, color });
      });
    });
    return totalMs;
  }

  // ---------------- THE REPEAT BEAT (PATCH 0803 §3) ----------------

  /**
   * A HAND THAT HAPPENS FIVE TIMES IS SHOWN HAPPENING FIVE TIMES.
   *
   * The Repeating Pocketwatch, the Sharpest Dagger and the Wheel's retrigger
   * wedge do not multiply a number: they make the hand HAPPEN again. That
   * distinction was invisible — one ×5 slid past on the score side — and it
   * matters far more since the afterHand audit, because every scaling relic in
   * the game now banks once per ACTIVATION. If the player cannot see five
   * activations, they cannot see five banks either, which is exactly the bug JC
   * could feel and not name.
   *
   * So activations 2..N are replayed: the cards punch again in fan order, the
   * responsible relic pulses again, a ↻ k/N counter rides the equation, and the
   * score side climbs one activation at a time (k/(k-1) per beat, so it lands on
   * exactly the ×N the cascade used to apply in one silent jump).
   *
   * THE BUDGET (JC): "nobody wants to sit there for an eternity. Speed things up
   * exponentially after a reasonable waiting point." The first REPEAT_FULL_BEATS
   * activations play at full readable pace; every one after is a fixed fraction
   * of the last, down to a floor that still reads as motion. A mirrored Sharpest
   * Dagger is ×25 and costs about seven cycles, not twenty five. The ramp rides
   * ON TOP of the HAND SPEED setting (cycle is spd()-scaled) rather than
   * replacing it, and the accelerator compresses whatever is left.
   *
   * @returns {number} how long the whole beat takes, in ms.
   */
  repeatBeat(res, played, startAt) {
    const times = Math.max(1, Math.round(res.handRepeat ?? 1));
    if (times <= 1) return 0;
    const scoring = played.filter(cs => {
      const b = res.breakdown.find(x => x.id === cs.card.id);
      return b?.scoring && !b.dead;
    });
    const cycle = this.spd(430);
    const { starts, effScales, totalMs } = repeatSchedule(times - 1, cycle);
    const cause = [...new Set(this._repeatCause ?? [])];

    for (let k = 0; k < times - 1; k++) {
      const at = startAt + starts[k];
      const activation = k + 2;            // activation 1 was the hand you watched
      const scale = effScales[k];
      const readable = k < REPEAT_FULL_BEATS;
      this.time.delayedCall(at, () => {
        this._repeatFired = (this._repeatFired ?? 0) + 1;
        this._repeatAt = performance.now();   // ...the LAST one; see _benchAt
        this.handTick('score_tick', { volume: 0.8 });
        // ONE counter that COUNTS, rather than a fresh label per activation.
        // Twenty four of those pile up on each other at the compressed end of
        // the ramp and turn the readout into a smear; a single object that
        // re-reads and punches is both louder and quieter. It rides beside the
        // hand name, mirroring the club-splash chip on the other side, so it can
        // never land on an enemy's nameplate.
        this.eqTag(`↻ ${activation} / ${times}`, { big: readable });
        // The relic that made it happen swells EVERY time it happens.
        for (const a of cause) this.pulseArtifact(a, { text: `↻ ${activation}/${times}`, color: '#d8c070' });
        // ...and the score side takes one more activation's worth. k/(k-1)
        // rather than a running sum, so N beats land on exactly ×N.
        this.eqMulScore(activation / (activation - 1));
      });

      // The cards fire again, in fan order, inside this activation's own window.
      const cardGap = scoring.length ? (scale * cycle * 0.55) / scoring.length : 0;
      scoring.forEach((cs, i) => {
        this.time.delayedCall(at + i * cardGap, () => {
          if (!cs?.active) return;
          const b = res.breakdown.find(x => x.id === cs.card.id);
          // THE WHEEL TURNS AGAIN (JC, 2026-08-04). Every activation of a
          // roulette card is its own spin, so the hand happening a second time
          // is a second spin: scoring.js already resolved them all, and beat
          // (h × times) is the one this activation landed on.
          const L = b?.beats?.length ?? 0;
          const bTimes = b?.times ?? 1;
          const wheel = L > bTimes;   // its beats span every window
          const slice = L ? (wheel
            ? Array.from({ length: bTimes }, (_, j) => b.beats[((k + 1) * bTimes + j) % L])
            : b.beats) : [];
          if (wheel && slice[0]?.roulette) this.revealRoulette(cs, slice[0].roulette);
          // THE WALK, LIVE (JC, 2026-08-04): the replay window pays its card's
          // whole mult story again — the seal's +3s add, the ghost's ×2 signs —
          // so the mult on screen climbs window by window exactly as the
          // engine's ordered walk banked it. eqSlam still reconciles to the
          // true total at the impact.
          if (b?.scoring) {
            const flat = slice.reduce((s, x) => s + (x?.dead ? 0 : (x?.mult ?? 0)), 0);
            const factor = slice.reduce((p, x) => p * (x?.dead ? 1 : (x?.multFactor ?? 1)), 1);
            if (flat) this.eqAddMult(flat);
            if (factor !== 1) this.eqMulMult(factor);
          }
          this.tweens.add({ targets: cs, scale: 1.16, duration: Math.max(50, Math.round(scale * 110)), yoyo: true });
          burst(this, cs.x, cs.y - 40, SUIT_COLORS[cs.card.suit] ?? 0xffc542, readable ? 5 : 2);
          // Only the readable activations spell the number out; past the ramp
          // the punch IS the message and a hundred floating digits are noise.
          // EXCEPT a wheel card (JC, 2026-08-04): its value genuinely changes
          // per window — a BLACK opener that lands RED on the replay has to
          // SHOW the new number, every window, or the zero looks stuck. A
          // black window pops nothing (the reveal already said BLACK).
          const shown = slice[0]?.value ?? b?.value ?? 0;
          if ((readable && !wheel) || (wheel && shown > 0)) {
            const col = { swords: '#aec4f4', hearts: '#ff9aa4', gems: '#7fe0f4', clovers: '#8fe098' }[b?.suit] ?? '#ffd166';
            popNumber(this, cs.x, cs.y - 76, `${shown}`, { color: col, size: 32, rise: 40, hold: 60 });
          }
        });
      });
    }
    return totalMs;
  }

  /**
   * THE CASCADE'S SIDE TAG. One long-lived label parked to the LEFT of the hand
   * name, mirroring the club-splash chip on its right — the two beats that need
   * a running caption (the bench, the repeat counter) share it rather than each
   * inventing a home.
   *
   * It has to be ONE object that re-reads. A fresh label per activation piles
   * twenty four of them on top of each other at the compressed end of a x25 ramp
   * and turns the readout into a smear. And it has to sit HERE: everything above
   * the equation is enemy nameplates and everything below it is the played row,
   * so a caption anywhere else lands on something the player is reading.
   */
  eqTag(text, { color = '#d8c070', big = true, hold = 0 } = {}) {
    if (!this._eqTag?.active) {
      this._eqTag = this.add.text(ARENA_CX, EQ_NAME_Y, text, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '30px',
        color, stroke: '#241505', strokeThickness: 6,
      }).setOrigin(1, 0.5).setDepth(DEPTH.fx + 1);
      this._eqTag.setShadow(3, 5, '#000000aa', 8, true, true);
    }
    const t = this._eqTag;
    this.tweens.killTweensOf(t);
    t.setText(text).setColor(color).setAlpha(1).setY(EQ_NAME_Y);
    // Anchored off the caption's LIVE width, so it never collides with it.
    // 16 -> 26 (2026-08-04): at 16 the two strokes touched on a short hand name
    // and read as one run-on word, which is how "2 / 2" and "Pair" turned into
    // "2 / 2th Pair" in a screenshot.
    t.setX(ARENA_CX - this.eqName.width / 2 - 26);
    t._punch?.remove();
    t.setScale(big ? 1.35 : 1.14);
    t._punch = this.tweens.add({ targets: t, scale: 1, duration: 130, ease: 'Back.easeOut' });
    this._eqTagFade?.remove();
    if (hold > 0) this._eqTagFade = this.time.delayedCall(hold, () => this.clearEqTag());
  }

  /** ...and it leaves with the equation it was captioning. */
  clearEqTag() {
    const t = this._eqTag;
    this._eqTag = null;
    this._eqTagFade?.remove();
    this._eqTagFade = null;
    if (!t?.active) return;
    t._punch?.remove();
    this.tweens.add({
      targets: t, alpha: 0, y: t.y - 20, duration: this.spd(260),
      onComplete: () => t.destroy(),
    });
  }

  /**
   * THE BANK LEDGER (PATCH 0803 §3). What every SCALING relic just banked off
   * this hand, as a number on the relic itself.
   *
   * `afterHand` fires once and each hook multiplies its own bank by
   * handActivations(ctx) — which is correct, and was completely invisible. So
   * the numeric fields of every relic's state are snapshotted either side of the
   * hook and whatever GREW takes a bow. It is derived from the real state rather
   * than from a list of relic ids, so a relic added tomorrow is covered by it.
   */
  relicPower(a) {
    const m = typeof a.mods === 'function' ? a.mods(a, run) : a.mods;
    if (!m) return 0;
    const sum = o => (o ? Object.keys(o).reduce((t, k) => t + (o[k] || 0), 0) : 0);
    // Every channel a SCALER grows along. Read off the relic's own mods rather
    // than off its raw state on purpose: state holds bookkeeping too (the Chaos
    // Orb counts its rolls), and a ledger that announced a die roll as a bank
    // would be worse than no ledger.
    return (m.flatMult ?? 0) + (m.faceMult ?? 0) + (m.flatValue ?? 0) + (m.faceValue ?? 0)
      + sum(m.handValue) + sum(m.suitValue) + sum(m.modValue)
      + sum(m.handMult) + sum(m.suitMult);
  }

  snapshotBanks() {
    const snap = new Map();
    for (const a of run.artifacts) snap.set(a, this.relicPower(a));
    return snap;
  }

  /** Diff the snapshot and pulse everything that grew. `times` writes the ×N. */
  showBanked(before, times = 1) {
    if (!before) return 0;
    let shown = 0;
    for (const a of run.artifacts) {
      const was = before.get(a);
      if (was == null) continue;
      const grew = Math.round((this.relicPower(a) - was) * 10) / 10;
      if (grew <= 0) continue;
      shown += 1;
      const per = Math.round((grew / Math.max(1, times)) * 10) / 10;
      this.time.delayedCall(this.spd(120) * shown, () => {
        this.pulseArtifact(a, {
          // A repeated hand spells the arithmetic out: this is the half JC could
          // not see, so the ledger says PER-ACTIVATION × ACTIVATIONS rather than
          // just handing over the sum.
          text: times > 1 ? `↑ +${fmtNum(per)} ×${times}` : `↑ +${fmtNum(grew)}`,
          color: '#9ae04a',
        });
      });
    }
    return shown;
  }

  playHand() {
    if (this.busy || this.selected.length === 0) return;
    if (this.handsThisFight >= this.handLimit) return;   // the clock is out; no extra hand
    // WINTER'S FORCE: five cards, no more, no less.
    if (this.wintersForce && this.selected.length !== this.winterNeed) return this.denyWinter();
    if (this.sealedSelected()) return this.denySealed();
    // DOUBLE JEOPARDY, refused at the same gate WINTER'S FORCE uses: it is a
    // refusal of the HAND, not of any card, so it deliberately does not touch
    // `cardDenied` — and it can never deadlock, because checkMistrial wipes the
    // docket the moment nothing your hand can form is still legal.
    if (this.handTypeOnce) {
      const t = bestHandOf(this.selected.map(c => c.card), this.handEvalOpts()).type;
      if (handTypeSpent(this.usedHandTypes, t, true)) return this.denyUsedHandType(t);
    }
    this.busy = true;
    // The wall clock the repetition budget is measured against: press to slam.
    this._handStartAt = performance.now();
    this.eqSlamAt = 0;
    this._benchFired = 0;
    this._repeatFired = 0;
    this._benchAt = 0;
    this._repeatAt = 0;
    this.setPreviewText('');
    this.retargetIfDead();

    // Bleed: playing a hand opens the wound.
    if (this.pstat.bleed > 0) {
      const cut = this.pstat.bleed;
      this.player.hp = Math.max(0, this.player.hp - cut);
      this.pstat.bleed -= 1;
      flashVignette(this, DEBUFF_COLORS.bleed, 0.4);
      this.heroDebuff(DEBUFF_COLORS.bleed);
      popNumber(this, SIDEBAR_W / 2, 422, `-${cut} bleed`, { color: '#ff5060', size: 34 });
      if (this.player.hp <= 0) { this.refreshAll(); return this.defeat(); }
    }
    // SPIKES: the thorns bite on every hand you commit. Shield eats them like
    // any damage, and the stacks do NOT fade — only ending the fight does.
    if (this.pstat.spikes > 0) {
      this.spikeToll();
      this.refreshAll();
      if (this.player.hp <= 0) return this.defeat();
    }
    // PYRE TAX: the Gallows charges by the card. Deliberately AFTER spikes and
    // on the same "Shield eats it like any damage" terms, so a full five-card
    // hand is a decision rather than a habit.
    if ((this.cardTaxRate ?? 0) > 0) {
      this.cardTaxToll(this.selected.length);
      this.refreshAll();
      if (this.player.hp <= 0) return this.defeat();
    }
    this.hypnoActive = false;
    if (this.hypnoCard) { this.hypnoCard.setLockState(null); this.hypnoCard = null; }

    this.resetArtifactPulses();
    // ...and the passive chip's own running total, which is the mat's rule
    // applied to the one socket that is not on the mat.
    resetPassivePulse(this);

    // Cards LAND left to right. this.selected is CLICK order, so a full house
    // picked K,7,K,7,K used to deal its row — and tick, and morph, and feed the
    // score — in that scrambled order. The fan is the only order the player
    // ever reads, so sort by it here; every downstream loop (row slots, ticks,
    // value morphs, score adds, discard sweep) inherits it for free.
    const fanIndex = new Map(this.handCards.map((c, i) => [c, i]));
    const played = [...this.selected].sort((a, b) =>
      (a.baseX - b.baseX) || ((fanIndex.get(a) ?? 0) - (fanIndex.get(b) ?? 0)));
    this.selected = [];
    const cards = played.map(c => c.card);
    // BLIND ENDS THE MOMENT THE CARD LANDS. "You cannot see what it is until it
    // lands" is the whole promise, so a played card turns face up here, before
    // it takes its slot in the row.
    for (const cs of played) {
      if (!cs.blinded) continue;
      this._blindIds.delete(cs.card.id);
      cs.setBlinded(false);
    }
    // Same rule as the preview: identical to evaluateHand for any ordinary
    // hand, and the best five present when GO-GO GOO played all eight.
    const ev = bestHandOf(cards, this.handEvalOpts());

    // THE CHAOS ORB decides, once, before the hand is scored. It has to happen
    // HERE — ahead of buildScoreState — so the roll is inside the very mult the
    // equation is about to print, and it deliberately does NOT happen during
    // the preview: a gamble you can read off the preview is not a gamble.
    this.rollChaosOrbs();
    const state = this.buildScoreState(cards);
    // GO-GO GOO and LIQUID ICE are both ONE-PLAY flags, and this is the moment
    // the play they were bought for actually happens: the state has read them,
    // so they are spent here and can never bleed into the next hand.
    const gooed = !!this._allScore;
    this._allScore = false;
    const iced = this.potionIceValue > 0 ? this.potionIceValue : 0;
    this.potionIceValue = 0;
    // THE WHEEL SPINS. One independent roll per ROULETTE card PER ACTIVATION — and
    // it happens HERE, not inside scoreHand, so the score stays deterministic
    // and the preview (which re-scores on every click) can never flicker a
    // result it has no right to know.
    // ONE SPIN PER ACTIVATION (JC, 2026-08-04): the wheel is turned again every
    // time the card fires, so an echoed roulette card under a Pocketwatch really
    // can go black, red, green, gold. state.mods is what tells rollRouletteFor
    // how many spins the hand could possibly need.
    state.rouletteRolls = rollRouletteFor(cards, Math.random, state.mods);
    // DEV: __hfCombat.forceRoulette('black') auditions one face of the wheel —
    // every activation of every card, so a pinned wheel stays pinned.
    if (this._rouletteForce) {
      for (const k of Object.keys(state.rouletteRolls)) {
        state.rouletteRolls[k] = state.rouletteRolls[k].map(() => this._rouletteForce);
      }
    }
    this._lastRoulette = { ...state.rouletteRolls };
    if (this.prop('allIn') > 0) {
      this.time.delayedCall(this.spd(380), () => {
        sfx(this, 'chips_stack', { volume: 0.6 });
        this.announce('ALL IN: ×3, and the house takes a card', '#d04870');
      });
    }
    // The Wheel's one-shots are SPENT by this hand — captured first so the
    // joker cascade can still give the relic its bow for them.
    this._wheelSpent = { mult: this.wheelNextMult, repeat: this.wheelNextRepeat };
    this.wheelNextMult = null;
    this.wheelNextRepeat = null;
    const res = scoreHand({ cards, character: this.chr.id, state });
    this._lastRes = res;   // verification hook (__hfCombat.handMath)
    // THE POCKETWATCH / THE SHARPEST DAGGER: the hand is about to happen more
    // than once, and every card's number is going to arrive already multiplied.
    // Say so BEFORE the first tick, the way ALL IN announces its bet.
    if ((res.handRepeat ?? 1) > 1) {
      this.time.delayedCall(this.spd(300), () => {
        sfx(this, 'score_tick', { volume: 0.7, rate: 1.4 });
        this.announce(`↻ THE HAND REPEATS  ×${res.handRepeat}`, '#d8c070');
      });
    }
    // GO-GO GOO: say it BEFORE the first card ticks, because the whole hand is
    // about to score and the player has to know that is deliberate.
    if (gooed) {
      this.time.delayedCall(this.spd(300), () => {
        sfx(this, 'potion_drink_big', { volume: 0.6, rate: 1.1 });
        this.announce(`GO-GO GOO: every card counts (${ev.name})`, '#9ae04a');
      });
    }
    // Giant's Brew: the next hand hits harder, once.
    if (this.potionNextFactor) {
      const f = this.potionNextFactor;
      this.potionNextFactor = null;
      res.damage = Math.round(res.damage * f);
      res.shield = Math.round(res.shield * f);
      res.heal = Math.round(res.heal * f);
      this.time.delayedCall(this.spd(320), () => this.announce(`GIANT'S BREW ×${f}`, '#d08040'));
    }
    this.handsThisFight += 1;
    run.counters.handsPlayed += 1;
    // RECAP: tallied HERE, at the one place a hand is committed, so the hand-
    // type counts always sum to counters.handsPlayed. Cards are keyed by their
    // suit AS PLAYED (a Hopquake'd 7 really was a 7 of that suit this hand).
    if (run.stats) {
      run.stats.handTypeCounts[ev.name] = (run.stats.handTypeCounts[ev.name] ?? 0) + 1;
      for (const c of cards) run.stats.cardPlays[cardKey(c)] = (run.stats.cardPlays[cardKey(c)] ?? 0) + 1;
    }
    // THE COMMIT POINT. The hand is counted and its type is known — the one
    // beat a relic can claim "the first hand of this fight" from (The Forge
    // Eternal's tempering) and be right about it.
    this.artHook('handCommit', { ev, cards, played });
    // ...and the same commit point is what the HOURGLASS OF THE SECOND SUN
    // turns back to. The CARD objects are what matter: the sprites in `played`
    // are destroyed on their way to the discard pile long before the glass is
    // ever turned, which is why the hourglass replays the hand's OUTPUT rather
    // than dealing the hand again.
    this._lastPlay = { played, cards, ev };
    // SECRET HANDS: the same commit point uncovers one, forever, across runs.
    // From here on the Smith will offer it and the hands chart will name it.
    // FULL REPERTOIRE reads the same commit point: every hand type the game ever
    // resolves is banked, secrets included, and that record is what opens the
    // Perpetual Engine. Separate list from discoverHand's, which is secrets-only
    // by design and would un-hide them if it were widened.
    notePlayedHand(ev.type);
    const found = discoverHand(ev.type);
    if (found) {
      this.time.delayedCall(this.spd(520), () => {
        sfx(this, 'legendary_appears', { volume: 0.95 });
        this.cameras.main.flash(220, 120, 80, 20);
        this.announce(`SECRET HAND DISCOVERED: ${found.toUpperCase()}`, '#ffd23e');
      });
    }

    const n = played.length;
    const startX = ARENA_CX - ((n - 1) / 2) * (CARD.w + 18);
    played.forEach((cs, i) => {
      this.handCards = this.handCards.filter(c => c !== cs);
      this.handGroup.bringToTop(cs);
      this.tweens.add({
        targets: cs, x: startX + i * (CARD.w + 18), y: CARD.playedY, angle: 0, scale: 1,
        duration: 300, delay: i * 60, ease: 'Cubic.easeOut',
      });
    });
    this.layoutHand();

    sfx(this, 'hand_play', { volume: 0.53 });
    this.eqBegin(res, ev);

    // ---- SCORING CADENCE v2 -------------------------------------------
    // Every card resolves left to right, in its own little act:
    //   A  POP    the card's VALUE rises above it. Printed mods are already
    //             baked into baseValue, so a NUKE shows its 100 in ONE
    //             animation — never a base beat plus a correction.
    //   B  MORPH  only when an ARTIFACT rewrote that value: the relic swells
    //             and floats its "+3", the card re-punches, and the number
    //             above morphs in place, 7 -> 10. No lane, no equation string.
    //   C  FEED   the final number flies onto the SCORE side; the card's
    //             non-damage outputs (♥ heal, ◆ shield, ◉ chips, status) pop
    //             BENEATH the card, out of the damage stream entirely.
    // `cursor` tracks the SCORE ADD, not the pop, so a slow morph can never let
    // a later card's number land on the score first. Base numbers are ~15%
    // above the shipped ones (JC: "slow everything down a hint even at 1x");
    // spd() still scales them, so the 1x/2x/3x ratios are untouched.
    const tickDelay = this.spd(480);
    const step = this.spd(220);      // gap between one card's feed and the next card's pop
    const morphGap = this.spd(240);  // pop -> artifact morph
    const morphRead = this.spd(150); // morph -> feed (time to read the new number)
    // What the hand-wide relics multiply each card's own outputs by.
    const outScale = { heal: res.healScale ?? 1, shield: res.shieldScale ?? 1, chips: res.outScale ?? 1 };

    const spinGap = this.spd(320);   // the wheel stopping -> what it left behind
    // ...and the gap between one card's activations. An ECHO SEAL beside the
    // Ouroboros is six of them, so it decays: readable at first, brisk after.
    const againGap = this.spd(260);
    let cursor = tickDelay;
    const beats = played.map((cs) => {
      const b = res.breakdown.find(x => x.id === cs.card.id);
      const spins = !!(b.scoring && b.roulette);
      // A BLACK card has nothing to morph — its reveal IS its whole beat.
      const morphs = !!(b.scoring && !b.dead && b.valueBonus);
      // HOW MANY TIMES THIS CARD FIRES inside one play of the hand: an ECHO
      // SEAL, the Ouroboros, or both. Every activation past the first gets its
      // own beat below, so it has to be reserved in the cursor here.
      const again = b.scoring ? Math.max(0, (b.times ?? 1) - 1) : 0;
      const at = cursor;
      const popAt = spins ? at + spinGap : at;
      const feedAt = morphs ? popAt + morphGap + morphRead : popAt;
      const againAt = feedAt + this.spd(180);
      cursor = feedAt + (again ? this.spd(180) + again * againGap : 0) + step;
      return { cs, b, at, popAt, spins, morphs, feedAt, again, againAt };
    });

    beats.forEach(({ cs, b, at, popAt, spins, morphs, feedAt, again, againAt }, i) => {
      // --- A0: the wheel stops. The card takes its result's colour and says
      // what it paid, BEFORE the value it is (or is not) about to hand over. ---
      if (spins) this.time.delayedCall(at, () => this.revealRoulette(cs, b.roulette));
      // --- D: ...AND AGAIN. One beat per card-level activation past the first.
      for (let k = 1; k <= again; k++) {
        this.time.delayedCall(againAt + (k - 1) * againGap, () =>
          this.cardActivationBeat(cs, b, k, b.times));
      }

      this.time.delayedCall(popAt, () => {
        if (!b.scoring) {
          this.tweens.add({ targets: cs, alpha: 0.35, scale: 0.92, duration: 160 });
          cs.each?.(child => child.setTint?.(0x999999));
          return;
        }
        // BLACK: it formed the hand and paid nothing. No number rises, nothing
        // reaches the score — the reveal already told the whole truth.
        if (b.dead) {
          // ...on THIS activation. A card that fires again (echo, Ouroboros, a
          // repeating hand re-spinning the wheel) is not dead, it is unlucky:
          // it dips for the beat and comes back up to keep trying (JC,
          // 2026-08-04: "go black but not transparent, just keep trying").
          // Only a card whose one spin WAS its whole hand stays grey.
          const firesAgain = (b.beats?.length ?? 1) > 1;
          this.tweens.add({
            targets: cs, alpha: 0.62, scale: 0.95, duration: 200,
            yoyo: firesAgain, hold: firesAgain ? this.spd(120) : 0,
          });
          return;
        }
        const col = { swords: '#aec4f4', hearts: '#ff9aa4', gems: '#7fe0f4', clovers: '#8fe098' }[b.suit] ?? '#ffd166';
        // --- A: the card's value, one animation ---
        this.handTick('score_tick', { volume: 0.85 });
        this.tweens.add({ targets: cs, scale: 1.14, duration: 90, yoyo: true });
        burst(this, cs.x, cs.y - 40, SUIT_COLORS[cs.card.suit] ?? 0xffc542, 5);
        // Sits ON the card's top lip, not floating above it: any higher and
        // the CENTRE card's number lands straight on the hand-name caption.
        const num = this.valuePop(cs.x, cs.y - 76, `${b.baseValue}`, col);

        // --- B: the artifact rewrite, in the same slot ---
        if (morphs) {
          this.time.delayedCall(morphGap, () => {
            this.handTick('score_tick', { volume: 0.55 });
            this.pulseValueArtifacts(b);
            this.tweens.add({ targets: cs, scale: 1.2, duration: 110, yoyo: true, ease: 'Back.easeOut' });
            burst(this, cs.x, cs.y - 40, 0xffd23e, 7);
            this.valueMorph(num, `${b.value}`);
          });
        }

        // --- B2: the Ouroboros bites its tail — this card scores N times, so
        // the ×N lands ON the card, right before its (already tripled) number
        // flies onto the SCORE side. ---
        if (b.retriggered && res.retrigger > 1) {
          this.time.delayedCall(morphs ? morphGap + this.spd(60) : this.spd(120), () => {
            this.handTick('score_tick', { volume: 0.75 });
            this.pulseRetriggerArtifacts(res.retrigger);
            this.tweens.add({ targets: cs, scale: 1.24, duration: 120, yoyo: true, repeat: 1, ease: 'Back.easeOut' });
            burst(this, cs.x, cs.y - 40, 0x50b888, 10);
            popNumber(this, cs.x, cs.y - 140, `↻ ×${res.retrigger}`, { color: '#50b888', size: 34 });
          });
        }

        // --- C: the final number leaves for the score; outputs go below ---
        this.time.delayedCall(feedAt - popAt, () => {
          this.valueRelease(num, morphs ? 0 : this.spd(230));
          this.cardOutputs(cs, b, outScale);
        });
      });

      // Scheduled off the HAND's clock so the score only ever climbs in fan
      // order, however long any one card's morph takes.
      if (b.scoring && !b.dead) {
        this.time.delayedCall(feedAt, () => {
          // ONE ACTIVATION'S WORTH (2026-08-04). This used to send the card's
          // whole contribution at once, which was the same number while a card
          // could only fire once per hand. The repeats now have their own beats
          // (D above), so this beat owes the score exactly the FIRST of them and
          // the rest arrive as they happen. b.beats[0] is that first activation,
          // and for a card that fires once it is the whole card, unchanged.
          const first = b.beats?.[0] ?? b;
          // Whatever currency the equation is counting in this hand, that's the
          // number this card sends over — damage normally, its own shield/heal
          // pool for a wall or a mult-heal, its stack share for a poison hand.
          const unit = this.eqCurrency === 'damage' ? first.rawDamage
            : (first.shield || first.heal || first.rawDamage || 0);
          this.eqAddScore(unit);
          // Cards that MULTIPLY the hand mult (joker/spectral/ETHEREAL ×2,
          // SHINY ×1.5 — the beat carries the mod AND wrap product) punch the
          // mult side the instant they score.
          const f = first.multFactor ?? MOD_MULT_FACTOR[b.mod];
          if (f) this.eqMulMult(f);
          // ...and the beat's FLAT mult — a RED spin's +2, a MULTIPLICATIVE
          // SEAL's +3 — climbs on the same side, live.
          if (first.mult ?? b.rouletteMult) this.eqAddMult(first.mult ?? b.rouletteMult);
        });
      }
    });

    // LIQUID ICE, on the SCORE side and in its own beat. The +value is already
    // inside baseSum, so the equation has to climb by it visibly or the sum on
    // screen stops closing — the same idiom the Straightedge's bank uses.
    if (iced > 0 && res.handValueBonus > 0) {
      const at = cursor;
      this.time.delayedCall(at, () => {
        sfx(this, 'minor_upgrade', { volume: 0.6, rate: 1.25 });
        this.eqAddScore(iced);
        popNumber(this, ARENA_CX, 316, `LIQUID ICE  +${iced} VALUE`, { color: '#9fe8ff', size: 30 });
      });
      cursor += this.spd(220);
    }

    // The joker cascade: artifacts announce themselves before the impact.
    const cascadeAt = cursor + this.spd(160);
    const pulses = this.scheduleArtifactPulses(res, cards, cascadeAt);
    // ...and THEN the hand happens again, as many times as it really happens.
    // After the cascade on purpose: the score side has finished collecting every
    // add by this point, so N activations land on exactly the ×N that scoring.js
    // computed, and the replay reads as "all of that, again" rather than as a
    // number appearing in the middle of the relic row.
    const repeatAt = cascadeAt + pulses * this.spd(195) + this.spd(260);
    const repeatMs = this.repeatBeat(res, played, repeatAt);
    // THE LEFTOVER BENCH, LAST OF ALL (0803-B §1.1). It used to land BEFORE the
    // cascade and before the repeat, which is exactly what made its ×1.25s
    // multiply the small mult. Now the cards you held back have the last word:
    // whatever the played hand built, however many times it happened, the bench
    // multiplies THAT.
    const leftAt = repeatAt + repeatMs + this.spd(220);
    const leftMs = this.leftoverPhase(leftAt);
    // Impact = the equation slamming shut. The suit outputs follow it, so the
    // TOTAL is always on screen before the enemy's damage number appears —
    // at every hand speed, because every leg is spd()-scaled.
    const impactAt = leftAt + leftMs + this.spd(300);
    this.time.delayedCall(impactAt, () => this.eqSlam(res));
    this.time.delayedCall(impactAt + this.spd(700), () => this.resolveHand(played, res, ev));
  }

  resolveHand(played, res, ev, isEcho = false) {
    // --- THE BIOME CONTEXT (2026-08-03) -------------------------------------
    // Set for the LENGTH of this hand's resolution and read by damageEnemy, so
    // every gate (the wall, nothing-twice, the marked card, the forgotten suit)
    // applies to the strike AND to its echoes, splashes and overkill spill from
    // one decision. `used` is SNAPSHOTTED here rather than read live: the hand
    // being played has not been played yet, which is the only reason SERAPH OF
    // THE STILL is beatable at all — and a delayed second strike must see the
    // same board its first strike did.
    const playedIds = played.map(cs => cs.card.id);
    this._handCtx = {
      type: ev.type, ids: playedIds,
      used: new Set(this.usedHandTypes),
      damageBySuit: res.damageBySuit ?? {},
    };
    for (const e of this.enemies ?? []) e._gateSaid = false;
    // A CONDEMNED card that is PLAYED is saved. Discarding never was.
    this.condemnBrands = dischargeBrands(this.condemnBrands, playedIds);
    // ...and what the Mirrorwalker gets to throw back at you next turn.
    this._lastHandDamage = Math.max(this._lastHandDamage ?? 0, res.damage ?? 0);
    let shieldThisHand = 0;   // RECAP: every point of shield this one hand made
    if (res.shield) {
      // SHATTERGUARD: addShield returns 0 and plays its own shatter beat, so the
      // ordinary plating beat has to stand down or the hand would chime, flash
      // the hero blue and print "+0" over the top of it.
      const gained = this.addShield(res.shield);
      shieldThisHand += gained;
      if (gained > 0) {
        sfx(this, 'shield', { volume: 0.8 });
        this.heroShield();
        popNumber(this, 70, 468, `+${gained}`, { color: '#7fe0f4', size: 34 });
        if (gained > res.shield) this.pulseByProp('shieldFactor', `+${gained - res.shield} ◆`, '#7fe0f4');
      }
    }
    // Aurum Heart: everything is armor.
    const aurum = this.prop('aurum');
    if (aurum > 0) {
      // ONCE PER ACTIVATION (2026-08-04), like every other per-card effect: a
      // card that fires twice plates twice, and a BLACK spin plates nothing at
      // all because it scored nothing at all.
      const plate = Math.round(aurum * res.breakdown.filter(b => b.scoring && !b.dead)
        .reduce((s, b) => s + cardValue(b.rank) * Math.max(1, b.activations ?? 1), 0));
      if (plate > 0) {
        const plated = this.addShield(plate);
        shieldThisHand += plated;
        if (plated > 0) popNumber(this, 70, 500, `◆+${plated}`, { color: '#ffd23e', size: 26, delay: 200 });
      }
    }
    if (res.heal) { sfx(this, 'heal', { volume: 0.75 }); this.heroHeal(); }
    if (res.heal) {
      const missing = this.player.maxHp - this.player.hp;
      const applied = Math.min(res.heal, missing);
      this.player.hp += applied;
      // PILGRIM'S FLASK'S SECOND DOOR. There are exactly two, because the
      // hand's own healing has never routed through healPlayer (it is folded
      // into the cascade's beat instead), and a flask that could not see the
      // one heal that matters most would be a flask that does nothing.
      this.catchOverheal(res.heal, Math.max(0, applied));
      // The hand's own healing does not route through healPlayer, so REFLECTION
      // is answered here as well — or the one heal that matters most (a hearts
      // hand) would be the one the Moonwell could not see.
      this.reflectHeal(applied);
    }
    // ZEAL: the battery discharges first (scoring already spent it on the mult),
    // then this hand's overheal charges it back up.
    if (res.zealConsumed) this.player.zeal = 0;
    // THE INFINITE HEART removes the ceiling entirely (zealCapFor answers
    // Infinity), so the bank-up here has to ask the same question scoring asked
    // rather than clamping to the baseline 40 behind its back.
    if (res.zealGained) {
      this.player.zeal = Math.min(res.zealCap ?? ZEAL_CAP, this.player.zeal + res.zealGained);
    }
    if (res.chipBonus) this.gainChips(res.chipBonus, null, { quiet: true });

    const tgt = this.target;
    let dmgDealt = 0;
    // The blow the OTHER relics (Bonded Stone, Twin Fates) key off: the target's
    // share of this hand, brittle folded in. deliverStrike computed the same
    // number to swing with; this is it read back for the followers.
    let dmg = 0;
    // How long the LAST blow of this hand needs before the turn may end. Set
    // only where the extra strikes are actually queued, so it can never claim
    // a delay for swings that were never scheduled.
    let strikeTail = 0;
    if (res.damage > 0 && tgt?.alive) {
      const first = this.deliverStrike(res);
      dmg = first.primary;
      dmgDealt += first.dealt;
      shake(this, Math.min(0.002 + dmg / 8000, 0.012), 160);
      if (res.effMult >= 8) actionText(this, tgt.homeX, tgt.homeY - 220, 'txt_combo', 0.7);

      // DUEL-WIELD CANES / CHIP OF TRIPLING DOWN: the hand STRIKES again.
      //
      // A strike is a SEPARATE, SEQUENTIAL HIT — not a bigger number (JC,
      // explicit). Strike 1 lands and fully resolves: its own damage number,
      // its own hit sound, its own kill. THEN strike 2 goes out, at whoever is
      // standing in front of you AT THAT MOMENT. A big enough hand really can
      // delete the wolf on the first swing and open the boss on the second.
      // Everything a strike carries with it (the Tether, the Boulder, the Chalice)
      // therefore fires PER STRIKE — that is exactly the mythical's power.
      const strikes = this.handStrikes();
      if (strikes > 1 && !isEcho) {
        // A FLOOR under the gap (JC, 2026-08-04: "the strikes should just
        // happen slightly slower"): at 3x speed spd(400) is ~130ms and three
        // blows smear into one. Each swing keeps at least ~440ms of air.
        const strikeGap = Math.max(440, this.spd(650));
        strikeTail = strikeGap * (strikes - 1) + this.spd(300);
        this.pulseByProp('handStrikes', `⚔ ×${strikes}`, '#ffe08a');
        for (let s = 1; s < strikes; s++) {
          this.time.delayedCall(strikeGap * s, () => {
            // Whoever you were aiming at may be dead by now — that is the point.
            this.retargetIfDead();
            const victim = this.target;
            const again = this.deliverStrike(res, { color: '#ffe08a', size: 62 });
            if (again.dealt <= 0) return;      // arena empty: the swing fizzles
            popMessage(this, ARENA_CX, 244, `STRIKE ×${s + 1}`,
              { color: '#ffe08a', size: 34 });
            if (victim && victim !== tgt) {
              popMessage(this, victim.homeX, victim.homeY - 232, 'CARRIES ON',
                { color: '#ffe08a', size: 24 });
            }
            shake(this, Math.min(0.002 + again.primary / 8000, 0.012), 140);
            this.noteHandStats(again.dealt, 0, ev.name);
            this.refreshAll();
          });
        }
      }
      // Bonded Stone: the blow rings on through ONE other foe.
      const resonance = this.prop('resonance');
      if (resonance > 0) {
        const others = this.livingEnemies().filter(e => e !== tgt);
        const bonded = Math.round(dmg * resonance);
        if (others.length && bonded > 0) {
          this.pulseByProp('resonance', 'BONDED', '#6fdc9f');
          const other = Phaser.Utils.Array.GetRandom(others);
          const hit = Math.round(bonded * brittleMultiplier(other));
          this.time.delayedCall(this.spd(220), () => {
            if (!other.alive) return;
            sfx(this, 'hit_small', { volume: 0.7, rate: 1.15, jitter: 0.05 });
            this.damageEnemy(other, hit, '#6fdc9f', 44);
            popMessage(this, other.homeX, other.homeY - 200, 'BONDED', { color: '#6fdc9f', size: 26 });
          });
          dmgDealt += hit;
        }
      }
      // Twin Fates: the hand echoes.
      const echoF = this.prop('handEcho');
      if (echoF > 0 && !isEcho) {
        this.pulseByProp('handEcho', 'ECHO', '#b45cff');
        const echo = Math.round(dmg * echoF);
        if (echo > 0) {
          this.time.delayedCall(this.spd(380), () => {
            const t2 = this.target;
            if (t2?.alive) {
              this.damageEnemy(t2, Math.round(echo * brittleMultiplier(t2)), '#e8d8ff', 50);
              popMessage(this, t2.homeX, t2.homeY - 200, 'ECHO', { color: '#b45cff', size: 28 });
            }
          });
        }
      }
      // Perpetual Engine: the opener fires twice.
      if (this.prop('firstHandRepeat') > 0 && this.handsThisFight === 1 && !isEcho) {
        this.time.delayedCall(this.spd(600), () => {
          const t2 = this.target;
          if (t2?.alive) {
            sfx(this, 'hit_big', { volume: 0.9 });
            this.damageEnemy(t2, Math.round(res.damage * brittleMultiplier(t2)), '#88b0c8', 60);
            popMessage(this, ARENA_CX, 300, 'THE ENGINE TURNS', { color: '#88b0c8', size: 34 });
          }
        });
      }
    }

    // NO STATUS APPLICATION HERE ANY MORE (2026-08-01). Clubs stopped applying
    // the hero's keyed status; Ophelia's poison is a fraction of every damage
    // EVENT and lands inside damageEnemy (see seepPoison), so by the time we
    // reach this line it has already been dealt, spread and floated.
    if (this.chr.id === 'venomancer' && dmgDealt > 0) {
      sfx(this, 'poison', { volume: 0.55, jitter: 0.06 });
    }

    // RECAP: the hand is fully resolved — damage dealt, shield plated, statuses
    // landed — so this is the moment its peaks are honest.
    this.noteHandStats(dmgDealt, shieldThisHand, ev.name);
    // ...and the same moment is the honest one for the hand achievements: the
    // type is settled and the damage is what was actually delivered.
    //
    // `mult` is the hand's FINAL multiplier, the same number the equation bar
    // just showed, and `cards` is how many cards were actually played (ONE INCH
    // PUNCH asks for exactly one). Both are read off the resolved result rather
    // than recomputed, so the trophy can never disagree with the screen.
    fireAchievements(this, 'hand', {
      handType: ev.type, damage: dmgDealt,
      // WHAT THE HAND SCORED, beside what it managed to land. A hand can reach
      // the ceiling and still deliver nothing to a body (an immune phase, a
      // biome wall), and INFINITY is a trophy for the SCORE — you built the
      // number, whether or not there was anything left standing to spend it on.
      scored: res.damage ?? 0,
      mult: res.effMult ?? 0, cards: played.length,
    });

    // ALL-IN VISOR: the house always takes something. One card of the hand,
    // picked at random, is burned out of the RUN DECK — not the discard, not
    // for this fight: gone. That is the price of the ×3 already banked.
    const burned = new Set();
    const visors = this.propHolders('allIn');
    if (visors.length && played.length) {
      const pool = [...played];
      for (const a of visors) {
        if (!pool.length) break;
        const victim = Phaser.Utils.Array.RemoveRandomElement(pool);
        burned.add(victim);
        this.burnCardForever(victim.card);
        this.pulseArtifact(a, { text: 'ALL IN', color: '#d04870' });
        this.time.delayedCall(this.spd(420), () => this.shatterCard(victim));
        this.gainChips(30, 'ALL IN', { quiet: true });
      }
    }

    // BLOOD SEALED: every sealed card that scored pays its HP here, in one
    // quiet sip — each already popped its own ♥+2 beneath itself.
    if (res.sealHeal > 0) this.healPlayer(res.sealHeal, { quiet: true });

    // ETHEREAL: the rent on that ×2. Each ghost rolls to leave the run for good
    // ONCE PER ACTIVATION (JC, 2026-08-04) — an echoed ghost under a Pocketwatch
    // pays the wheel four times, not once. The rent came down to 10% in the same
    // breath so that repeating a ghost is a real risk rather than a death
    // sentence. VOIDCALLER answers every one of those rolls for you: the card
    // stays, and the relic takes the ⊘ bow for it.
    const vanished = new Set();
    if (res.etherealIds?.length) {
      const voidcallers = this.propHolders('voidcaller');
      let saved = 0;
      for (const id of res.etherealIds) {
        const cs = played.find(c => c.card.id === id);
        if (!cs || burned.has(cs)) continue;
        const rolls = Math.max(1, Math.round(res.etherealActivations?.[id] ?? 1));
        let doomed = false;
        for (let k = 0; k < rolls && !doomed; k++) {
          // DEV: __hfCombat.forceEthereal(true/false) pins the coin.
          const roll = this._etherealForce == null ? Math.random() : (this._etherealForce ? 0 : 1);
          // SPIRITUAL takes the rent to zero, and no roll in [0,1) is below
          // zero, so the card simply never comes up. It outranks the dev pin on
          // purpose: an Oracle that promised a ghost would stay has to be
          // telling the truth.
          if (roll < etherealVanishChance(run)) doomed = true;
        }
        if (!doomed) continue;
        if (voidcallers.length) {
          saved += 1;
          for (const a of voidcallers) this.pulseArtifact(a, { text: '⊘ VOID', color: '#7fe0d0' });
          continue;
        }
        vanished.add(cs);
        this.burnCardForever(cs.card);
        // GHOSTED: a permanent receipt on the run, because the card itself is
        // about to stop existing and there is nothing left to read afterwards.
        if (run.stats) run.stats.ghosted = true;
        this.time.delayedCall(this.spd(480), () => this.dissolveCard(cs));
      }
      if (saved > 0) {
        this.time.delayedCall(this.spd(300), () =>
          this.announce(saved > 1 ? `⊘ THE VOID GIVES ${saved} BACK` : '⊘ THE VOID GIVES IT BACK', '#7fe0d0'));
      }
    }

    // FADING (the Plains' bite) rolls its OWN coin — 25% per activation, and
    // deliberately unanswered in-game: no Voidcaller, no SPIRITUAL. Their
    // rules say ETHEREAL, and since 2026-08-04 a fading card is not one.
    if (res.fadedIds?.length) {
      for (const id of res.fadedIds) {
        const cs = played.find(c => c.card.id === id);
        if (!cs || burned.has(cs) || vanished.has(cs)) continue;
        const rolls = Math.max(1, Math.round(res.fadedActivations?.[id] ?? 1));
        let doomed = false;
        for (let k = 0; k < rolls && !doomed; k++) {
          // DEV: __hfCombat.forceFade(true/false) pins the coin (harness only).
          const roll = this._fadeForce == null ? Math.random() : (this._fadeForce ? 0 : 1);
          if (roll < FADE_VANISH_CHANCE) doomed = true;
        }
        if (!doomed) continue;
        vanished.add(cs);
        this.burnCardForever(cs.card);
        this.time.delayedCall(this.spd(480), () => this.dissolveCard(cs));
        this.time.delayedCall(this.spd(520), () =>
          this.announce('FADED AWAY: the card is gone forever', '#cfd8ee'));
      }
    }

    // =======================================================================
    // THE BIOME LEDGERS CLOSE (2026-08-03). Everything below reads the hand
    // that just resolved, and it happens HERE — after every gate has been
    // asked and before the played cards are filed — because that is the one
    // ordering in which "the hand you are playing has not been played yet"
    // and "it has now" are both true exactly once.
    // =======================================================================
    if (!isEcho) {
      // THE DOCKET. Banked after the strike, so a hand can always beat the
      // Seraph on the turn it is first played.
      this.noteHandType(ev.type);
      // THE PALE ARCHITECT'S WALL comes down to the hand that was named for it.
      for (const e of this.livingEnemies()) {
        if (!e.wall || e.wall !== ev.type) continue;
        e.wall = null;
        this.floatText(e, 'THE WALL FALLS', '#e8eefc');
      }
      // THE SENTENCE is settled by whatever you actually played.
      this.settleDemand(ev.type);
      // GRIMWATCH names a fresh card every turn; this one is spent.
      this.markedCardId = null;
      this.syncGazeMark();
      // PYREHEART: every card this hand played is BURNED. Adding the sprites to
      // the SAME skip set the All-In Visor and the ETHEREAL vanish use is what
      // makes BURNED BEAT RECYCLED — a burned card never reaches stowPlayedCard,
      // so THE ORACLE'S RECYCLER is never even consulted about it.
      if (this.burnPlayed) {
        const spent = played.filter(cs => !burned.has(cs) && !vanished.has(cs));
        if (spent.length) {
          this.burnFightCards(spent.map(cs => cs.card), { quiet: true });
          // THE FIRE TAKES THEM THE MOMENT THE HAND HAS SCORED (JC,
          // 2026-08-04: "more fiery on the card and blacken it right after
          // the hand scores"). Each card gets its own ignition: a hot flash,
          // a flame bloom licking up the face, an ember column, and the char
          // going on UNDER it — then the ruin hangs there long enough to
          // read before it crumbles away.
          spent.forEach((cs, bi) => {
            burned.add(cs);
            cs.setBurnedLook();
            const flash = this.add.image(cs.x, cs.y, 'fx_glow').setTint(0xffc040)
              .setAlpha(0.95).setDisplaySize(CARD.w * 1.5, CARD.h * 1.2)
              .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 2);
            this.tweens.add({ targets: flash, alpha: 0, scaleY: flash.scaleY * 1.8, duration: 380, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
            const flame = this.add.image(cs.x, cs.y + CARD.h * 0.22, 'fx_glow').setTint(0xff5410)
              .setAlpha(0.85).setDisplaySize(CARD.w * 0.9, CARD.h * 0.9)
              .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.fx + 2);
            this.tweens.add({
              targets: flame, y: cs.y - CARD.h * 0.3, alpha: 0, scaleX: flame.scaleX * 0.5,
              duration: 640, delay: 120, ease: 'Sine.easeOut', onComplete: () => flame.destroy(),
            });
            burst(this, cs.x, cs.y - 20, 0xff6a20, 10);
            embers(this, cs.x, cs.y - 10, DEPTH.fx + 2, 10, Math.round(CARD.w * 0.4));
            sfxCapped(this, 'hit_big', { volume: 0.4, rate: 1.5 }, 400);
            this.tweens.add({
              targets: cs, alpha: 0, y: cs.y + 30, angle: cs.angle + 12,
              duration: 420, delay: this.spd(760) + bi * this.spd(60), ease: 'Cubic.easeIn',
              onComplete: () => cs.destroy(),
            });
          });
          this.time.delayedCall(this.spd(300), () => this.announce(
            `BURNED: ${spent.length} card${spent.length === 1 ? '' : 's'} struck from the record`, '#ff9a50'));
        }
      }
    }

    // COLD SNAP CHARM. Decided ONCE, ahead of the loop, because the fan's room
    // is a budget shared by the whole hand: what can come home is what the hand
    // size can still hold after the hand's own destruction has taken its share.
    const snap = isEcho ? null : this._coldSnap;
    const snapRoom = snap ? Math.max(0, this.effectiveHandSize - this.handCards.length) : 0;
    const coming = [];
    played.forEach((cs, i) => {
      if (burned.has(cs) || vanished.has(cs)) return;   // that sprite has its own exit
      // ...and if the charm is armed and the fan still has a slot, this card
      // never goes anywhere: no stow, no discard pile, no exit tween.
      if (snap && coming.length < snapRoom) { coming.push(cs); return; }
      // WHERE A SPENT CARD IS FILED — the discard, or back into the draw pile if
      // THE ORACLE'S RECYCLER was taken. The guard directly above is what makes
      // BURNED BEAT RECYCLED: a card destroyed as it played never reaches this
      // line at all, so anything new that destroys one only has to add its
      // sprite to a skip set, exactly as the All-In Visor and ETHEREAL do.
      stowPlayedCard(cs.card, this, run);
      this.tweens.add({
        targets: cs, x: GAME_W + 140, angle: 30, alpha: 0.5,
        duration: 260, delay: this.spd(575) + i * this.spd(46), ease: 'Cubic.easeIn',
        onComplete: () => cs.destroy(),
      });
    });
    if (snap) this.coldSnapReturn(snap, coming);
    // 1.5x the old dwell: the equation (and the total that replaced it) is the
    // payoff, and it was clearing the screen before JC could read the mult.
    this.tweens.add({ targets: this.eqParts, alpha: 0, duration: 300, delay: this.spd(1050) });

    // Chrono Elixir: the whole hand strikes a second time.
    if (this.potionEcho && !isEcho) {
      this.potionEcho = false;
      this.time.delayedCall(this.spd(700), () => {
        this.announce('CHRONO ECHO: the hand plays again', '#50e0d0');
        sfx(this, 'hand_play', { volume: 0.53, rate: 1.08 });
        if (res.shield && this.addShield(res.shield) > 0) this.heroShield();
        if (res.heal) this.healPlayer(res.heal, { quiet: true });
        const t2 = this.target;
        if (res.damage > 0 && t2?.alive) {
          sfx(this, res.damage >= 90 ? 'hit_big' : 'hit_small', { volume: 1, jitter: 0.05 });
          this.damageEnemy(t2, Math.round(res.damage * brittleMultiplier(t2)), '#50e0d0', 60);
        }
        this.refreshAll();
      });
    }

    // THE BANK LEDGER (PATCH 0803 §3). Every scaling relic banks once per
    // ACTIVATION inside this one hook, and until now that happened in total
    // silence — the exact half JC could not tell was working. Snapshot either
    // side of it and let whatever GREW take a bow, with the ×N spelled out when
    // the hand repeated, so the replay the player just watched and the numbers
    // it fed are one story.
    const banksBefore = this.snapshotBanks();
    this.artHook('afterHand', { res, played, ev, dmgDealt, target: tgt });
    this.showBanked(banksBefore, Math.max(1, Math.round(res.handRepeat ?? 1)));

    this.refreshAll();
    // The ENEMY's turn cannot start while blows are still in the air: a hand
    // that strikes three (or six) times staggers them past the normal 1035ms
    // beat, and handing the turn over mid-sequence would resolve their attacks
    // over the top of your own. strikeTail is 0 whenever there is only one blow.
    // A WON fight is not made to wait, though — if the arena is already empty
    // at the normal beat, the remaining swings have nothing to hit anyway.
    const endBeat = () => {
      if (!this.livingEnemies().length) return this.fightWon();
      // WEIGHTLESS (THE UNMADE). "Cards left in your hand at end of turn drift
      // away" — and END OF TURN is exactly here, the last instant before the
      // enemies act. It is the deliberate answer to the leftover-in-hand build,
      // so it fires AFTER the bench has already paid out for this hand: you get
      // the mult you held back for, and then you lose the cards.
      if (this.dropHandOn && !isEcho) this.dropRemainingHand();
      this.enemyTurn();
    };
    this.time.delayedCall(this.spd(1035), () => {
      const wait = strikeTail - this.spd(1035);
      if (wait > 0 && this.livingEnemies().length) this.time.delayedCall(wait, endBeat);
      else endBeat();
    });
  }

  // =========================================================================
  // THE STRIKE LAYER (JC, 2026-08-01 wave)
  // -------------------------------------------------------------------------
  // A "STRIKE" is one delivery of a played hand's DAMAGE, with every targeting
  // relic applied. It is deliberately NOT a retrigger:
  //
  //   REPEATING POCKETWATCH (mods.handRepeat)  — the whole HAND happens again:
  //       damage, club splash, shield, heal, chips, everything. Scoring owns it.
  //   DUEL-WIELD CANES / CHIP OF TRIPLING DOWN (props.handStrikes) — only the BLOW
  //       happens again, as a SEPARATE SEQUENTIAL HIT with its own kill check
  //       and its own retarget. No extra shield, heal or chips — but the club
  //       splash DOES ride along, because the splash is part of the blow.
  //
  // That distinction is the whole design of the two relics; do not "unify" them.
  // =========================================================================

  /**
   * How many times a played hand's damage lands. 1 normally. Multiple strike
   * relics COMPOUND (the Canes + the Chip = six blows), the same rule
   * run.collectMods uses for stacked Pocketwatches and Ouroboroses.
   */
  handStrikes() {
    // propHolders already filters to props[key] > 0, so an empty belt leaves 1.
    let n = 1;
    for (const a of this.propHolders('handStrikes')) n *= a.props.handStrikes;
    return n;
  }

  /** Damage in `amount` that would be wasted on `enemy` — the overkill. */
  excessAfter(enemy, amount) {
    if (!enemy?.alive || enemy.immune) return 0;
    return Math.max(0, amount - (enemy.shield ?? 0) - enemy.hp);
  }

  /**
   * THE OVERFLOWING CHALICE. Overkill is not thrown away — it rolls into the next living
   * enemy, and keeps rolling until it is spent or the arena is empty. (JC's
   * call: cascade, not a single chain. It is the fun version.)
   * `depth` is a paranoia rail, not a rule — the arena tops out at 4 bodies.
   */
  spillOverkill(from, leftover, depth = 0) {
    if (leftover <= 0 || depth > 6) return 0;
    const next = this.livingEnemies().find(e => e !== from);
    if (!next) return 0;
    const hit = Math.round(leftover * brittleMultiplier(next));
    const excess = this.excessAfter(next, hit);
    this.damageEnemy(next, hit, '#ff9a3c', 46);
    popMessage(this, next.homeX, next.homeY - 196, 'SPILL', { color: '#ff9a3c', size: 26 });
    // Only what this body ABSORBED counts toward the hand's tally — the rest is
    // about to be counted again by the next link. Without this the recap would
    // brag about the same points once per corpse.
    return (hit - excess) + this.spillOverkill(next, excess, depth + 1);
  }

  /**
   * ONE STRIKE. The target takes the hand's damage; the targeting relics decide
   * who else does; the Overflowing Chalice rolls the overkill on.
   *
   * SPREAD MATRIX (JC, 2026-08-01 — the club splash joined the party):
   *
   *   CLUB SPLASH (res.aoeSplash) is not a relic. It is the SUIT RULE: 25% of
   *   what the club cards themselves dealt, onto every OTHER living enemy. It
   *   is free, it needs no belt slot, and it is the baseline everything else
   *   is measured against.
   *
   *   Exactly ONE relic spread source fires per strike, so no enemy is ever hit
   *   twice by the same relic:
   *     1. METEOR SIGIL   (flush+ only)  full damage to EVERYONE
   *     2. HALLOWED BOULDER              60% to EVERYONE, target included
   *     3. SPECTRAL TETHER               40% to every enemy except the target
   *     4. WARHORN                       30% to every enemy except the target,
   *                                      sword hands only
   *
   *   How the two compose:
   *     · METEOR / BOULDER are FULL-SPREAD MODES — the hand stops picking a
   *       target and everyone eats the same (bigger) number. They ABSORB the
   *       club splash: those bodies were already hit by this blow, and adding a
   *       quarter on top would be hitting them twice for one swing.
   *     · TETHER / WARHORN reach the enemies the blow MISSED, which is exactly
   *       who the club splash reaches, so they ADD: one is suit identity, the
   *       other is a relic you paid for, and a club hand under a Tether should
   *       visibly hit harder than a club hand without one.
   *     · With no relic at all, the club splash lands on its own.
   *
   * Everything here fires PER STRIKE — a strike is a whole new damage event,
   * which is exactly why the Chip of Tripling Down is a mythical.
   *
   * @returns {{ dealt: number, primary: number }} total damage, and the
   *          target's own share (what Bonded Stone / Twin Fates key off).
   */
  deliverStrike(res, { color = '#ffd166', size = 74 } = {}) {
    const tgt = this.target;
    if (!(res.damage > 0) || !tgt?.alive) return { dealt: 0, primary: 0 };
    let dealt = 0;

    // HALLOWED BOULDER: the hand stops picking. Everyone takes 60% — including
    // whoever you were aiming at, which is the price of going wide. With one
    // enemy left there is nothing to spread to, so nothing is traded and the
    // blow lands whole.
    const sun = this.prop('aoeAll');
    const spreading = sun > 0 && this.livingEnemies().length > 1;
    const base = spreading ? Math.round(res.damage * sun) : res.damage;

    const primary = Math.round(base * brittleMultiplier(tgt));
    sfx(this, primary >= 90 ? 'hit_big' : 'hit_small', { volume: 1, jitter: 0.05 });
    const excess = this.excessAfter(tgt, primary);
    this.damageEnemy(tgt, primary, color, size);
    dealt += primary;

    const tether = this.prop('tether');
    const others = this.livingEnemies().filter(e => e !== tgt);
    const splash = (amount, hue, popSize) => {
      for (const other of others) {
        if (!other.alive) continue;
        const hit = Math.round(amount * brittleMultiplier(other));
        if (hit <= 0) continue;
        this.damageEnemy(other, hit, hue, popSize);
        dealt += hit;
      }
    };

    // The suit's own reach: 25% of what the CLUB cards dealt, to everyone else.
    // (scoring.js already took CLUB_SPLASH out of the club cards' own damage;
    //  this is that figure, summed, so the arena and the readouts agree.)
    const clubSplash = Math.max(0, Math.round(res.aoeSplash ?? 0));

    // THUNDERHEAD BANNER: every Nth hand of a fight strikes the WHOLE ROOM at
    // FULL damage. It sits FIRST in the same if/else chain the Meteor and the
    // Boulder share, and therefore ABSORBS them for that hand — exactly as the
    // Meteor already absorbs the club splash. A hand goes wide ONCE. The storm
    // is the strongest of the three (everybody, full damage, nothing traded),
    // so when it is due it is what happens and the other two stand down rather
    // than stacking a second wave on top of it.
    //
    // PER STRIKE, not per hand, which is the Meteor's own rule: DUEL-WIELD
    // CANES swing again and the storm rides along with the blow, because the
    // splash is part of the blow.
    const thunderEvery = this.prop('thunderEvery');
    const storming = thunderEvery > 0 && this.handsThisFight > 0
      && this.handsThisFight % thunderEvery === 0 && others.length > 0;
    if (storming) {
      for (const a of this.propHolders('thunderEvery')) a.state.struck = (a.state.struck ?? 0) + 1;
      this.pulseByProp('thunderEvery', 'THUNDERHEAD', '#5878e8');
      splash(res.damage, '#8fa8ff', 52);
      popMessage(this, ARENA_CX, 260, 'THUNDERHEAD!', { color: '#5878e8', size: 44 });
    } else if (this.prop('aoeFlush') > 0 && FLUSH_PLUS.has(res.handType)) {
      // Meteor Sigil: flush-or-better goes wide at FULL damage. Absorbs the
      // club splash — everyone already took the whole blow.
      this.pulseByProp('aoeFlush', 'METEOR', '#ff7028');
      splash(res.damage, '#ff9a60', 52);
      popMessage(this, ARENA_CX, 260, 'METEOR!', { color: '#ff7028', size: 44 });
    } else if (spreading) {
      // Hallowed Boulder: the hand stops aiming. Also absorbs the club splash.
      this.pulseByProp('aoeAll', `HALLOWED ${Math.round(sun * 100)}%`, '#ffb347');
      splash(base, '#ffb347', 52);
      popMessage(this, ARENA_CX, 260, 'SHOCKWAVE', { color: '#ffb347', size: 40 });
    } else if (others.length) {
      // The others-only lane. At most one RELIC contributes, and whatever it
      // gives is ADDED to the club splash rather than replacing it.
      let relic = 0;
      let hue = AOE_COLOR;
      let label = null;
      let popSize = 38;
      if (tether > 0) {
        relic = Math.round(primary * tether);
        hue = '#8fd8ff'; label = 'TETHERED'; popSize = 40;
        this.pulseByProp('tether', 'TETHERED', '#8fd8ff');
      } else if (this.prop('swordCleave') > 0 && res.breakdown.some(b => b.scoring && b.suit === 'swords')) {
        relic = Math.round(primary * this.prop('swordCleave'));
        hue = '#c9b0ff'; label = 'CLEAVE';
        if (relic > 0) this.pulseByProp('swordCleave', 'CLEAVE', '#c9b0ff');
      }
      const per = relic + clubSplash;
      if (per > 0) {
        splash(per, hue, popSize);
        if (label) {
          popMessage(this, ARENA_CX, 262, label, { color: hue, size: 30 });
        } else {
          // Pure suit splash: the ✷ says which rule just reached them.
          popMessage(this, ARENA_CX, 262, `${AOE_GLYPH} SPLASH  ${fmtNum(clubSplash)}`,
            { color: AOE_COLOR, size: 30 });
        }
      }
    }

    // THE OVERFLOWING CHALICE, last: whatever the target could not absorb rolls on. The
    // target's own overkill comes back OFF the tally first, so the chain counts
    // every point exactly once (see spillOverkill).
    if (this.prop('overkillSpill') > 0 && excess > 0) {
      this.pulseByProp('overkillSpill', 'SPILLS OVER', '#ff9a3c');
      dealt += this.spillOverkill(tgt, excess) - excess;
    }

    return { dealt, primary };
  }

  /**
   * Apply damage to one enemy with feedback; handles death.
   * EVERY damage source in the game routes through here (hands, echoes,
   * cleave/meteor splash, the Engine's repeat, potions), which is exactly why
   * the Depth Knight's void-shell IMMUNITY and Sinastra's enemy SHIELD both
   * live at this one gate rather than at each call site.
   */
  damageEnemy(enemy, amount, color = '#ffd166', size = 46) {
    // RECAP: every damage event in the game passes through here, which makes it
    // the cheapest net wide enough to catch poison stacks applied OUTSIDE a
    // hand (a thrown potion, a relic) before the enemy turn ticks them down.
    this.notePoisonPeak();
    if (enemy.immune) {
      // The refusal is recorded too, so a driver can prove that an ∞ blow was
      // REFUSED by immunity rather than never swung (__hfCombat.lastHit).
      this._lastHit = {
        id: enemy.def?.id ?? null, amount, hpBefore: enemy.hp, hpAfter: enemy.hp,
        infinite: isInfinite(amount), immune: true, at: performance.now(),
      };
      return this.immunePop(enemy);
    }
    // THE BIOME GATES, at the one funnel every point of damage in the game
    // passes through. `_handCtx` is set for the length of a hand's resolution
    // and nothing else — so a WALL, a NOTHING TWICE and a marked card all stop
    // the hand (its strike, its echo, its splash, its overkill spill) while
    // poison and bleed, which are not hands, keep biting.
    if (this._handCtx) {
      const gate = this.biomeGate(enemy, this._handCtx.type, this._handCtx.ids, this._handCtx.used);
      if (!gate.through) {
        if (!enemy._gateSaid) { enemy._gateSaid = true; this.gateRefusal(enemy, gate); }
        return;
      }
      // ...and FORGET SUIT, which is not a refusal but a subtraction: exactly
      // the forgotten suit's share of this hand's raw damage never lands.
      if (enemy.forgetSuit) {
        amount = Math.round(amount * forgetSuitFactor(this._handCtx.damageBySuit, enemy.forgetSuit));
        if (amount <= 0) {
          this.floatText(enemy, `${SUIT_GLYPH[enemy.forgetSuit] ?? 'THAT SUIT'}: NOTHING`, '#cfd8ee');
          return;
        }
      }
    }
    // OPHELIA. Half of every point of damage she deals seeps into the body it
    // landed on. It is read off the blow BEFORE any enemy shield eats it —
    // venom does not care about plate — and it lives HERE rather than in
    // resolveHand because EVERY damage event is hers: the strike, the club
    // splash, the Tether, the Chalice's spill, a thrown potion, all of it.
    this.seepPoison(enemy, amount);
    if (enemy.shield > 0 && amount > 0) {
      const { absorbed, through } = absorbWithShield(enemy, amount);
      if (absorbed > 0) {
        sfx(this, 'shield', { volume: 0.65, rate: 1.22, jitter: 0.05 });
        popNumber(this, enemy.homeX + 96, enemy.homeY - 96, `◆-${fmtNum(absorbed)}`,
          { color: '#9aeaff', size: 30 });
        burst(this, enemy.homeX, enemy.homeY - 30, 0x7fe0f4, 8);
        const ring = this.add.image(enemy.homeX, enemy.homeY - 20, 'fx_glow_circle')
          .setTint(0x7fe0f4).setAlpha(0.7).setScale(0.5)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.arena + 3);
        this.tweens.add({
          targets: ring, alpha: 0, scale: 0.9, duration: 340, onComplete: () => ring.destroy(),
        });
      }
      this.refreshAll();
      amount = through;
      if (amount <= 0) return;
    }
    // ABSOLUTE OVERKILL (achievement) reads the body BEFORE the blow lands, so
    // it can ask how much of this hit the enemy actually had any use for.
    const hpBefore = enemy.hp;
    /**
     * THE INFINITY BLOW (JC, 2026-08-10). A single hit at the ceiling kills
     * whatever it lands on, full stop.
     *
     * IT SITS HERE AND NOWHERE EARLIER, on purpose: every IMMUNITY gate is
     * upstream of this line and is therefore respected without this rule having
     * to know any of their names.
     *   · enemy.immune  — the Depth Knight's DEF/void-shell form, GLACIAL AEGIS's
     *                     immune turns, STILLNESS — returns at immunePop above.
     *   · biomeGate     — the WALL, NOTHING TWICE, the marked card — returns above.
     *   · forgetSuit    — subtracts the forgotten suit's share above, and a hand
     *                     reduced to nothing never reaches here.
     * SHIELDS AND WARDS are not immunity and are not spared: they absorb what
     * they can and 1e30 goes straight through them, which is correct.
     *
     * Written as an explicit zero rather than left to the subtraction (which
     * already reaches zero at this magnitude) so the rule is a rule, provable
     * from a driver, and cannot be undone by a future "cannot be reduced below
     * 1 HP" effect that has not been written yet.
     */
    const infiniteBlow = isInfinite(amount);
    enemy.hp = infiniteBlow ? 0 : Math.max(0, enemy.hp - amount);
    // VERIFICATION HOOK (__hfCombat.lastHit): what was actually APPLIED to a
    // body, beside what the equation said. The friend's "e12 displayed, 0 dealt"
    // report had no way to be asserted before this existed.
    this._lastHit = {
      id: enemy.def?.id ?? null, amount, hpBefore, hpAfter: enemy.hp,
      infinite: infiniteBlow, at: performance.now(),
    };
    hitFlash(this, enemy.sprite);
    // THE RECOIL (JC, 2026-08-04): every hit is a body blow — the sprite jolts
    // and rights itself, so a Chip of Tripling Down's three strikes read as
    // three separate impacts instead of one flash wearing three numbers.
    // onComplete re-homes it, so overlapping jolts can never walk the body.
    const spr = enemy.sprite;
    if (spr?.active) {
      this.tweens.add({
        targets: spr, x: enemy.homeX + 16, angle: 3, duration: 70, yoyo: true, ease: 'Sine.easeOut',
        onComplete: () => { if (spr.active) { spr.setX(enemy.homeX); spr.setAngle(0); } },
      });
    }
    burst(this, enemy.homeX, enemy.homeY, 0xffc542, 10);
    popNumber(this, enemy.homeX, enemy.homeY - 130, fmtNum(amount), { color, size, rise: 90 });
    // Executioner's Seal: finish off low enemies.
    if (this.prop('execute') > 0 && enemy.alive && enemy.hp > 0) {
      const threshold = enemy.def.boss ? 0.15 : 0.30;
      if (enemy.hp <= enemy.maxHp * threshold) {
        enemy.hp = 0;
        popMessage(this, enemy.homeX, enemy.homeY - 180, 'EXECUTED!', { color: '#ff5a5a', size: 40 });
      }
    }
    if (enemy.hp <= 0 && enemy.alive) {
      this.killEnemy(enemy);
      fireAchievements(this, 'kill', { hpBefore, damage: amount });
    }
  }

  killEnemy(enemy) {
    enemy.alive = false;
    // A morphing boss dies out of whatever shape it was wearing: drop the
    // immunity and its idle aura so nothing keeps pulsing over the corpse.
    enemy.immune = false;
    if (enemy.morphAura) { this.tweens.killTweensOf(enemy.morphAura); enemy.morphAura.destroy(); enemy.morphAura = null; }
    enemy.shield = 0;
    // THE KILL LEDGER, by enemy def id AND by creature kind ('beast' = an
    // animal, which is what the Duck of Doom counts). It has been running since
    // fight one, so any relic that counts corpses (the Wolfsbane Charm's
    // wolves, the Duck's animals) pays for the ones you killed BEFORE you owned
    // it — retroactivity for free.
    noteKill(enemy.def?.id, run, enemy.def?.death ?? null);
    this.artHook('kill', enemy);
    // A KILL PAYS NOTHING (JC, 2026-08-01). The purse is settled once, at
    // victory, against the hands you had left — see fightWon's tally. Nothing
    // here counts chips, sounds like chips, or pops a gold number any more.
    // Death cries per creature type (Caleb's 2026-07-29 set).
    const cat = enemy.def.id === 'theKeeper' ? 'keeper'
      : (enemy.def.boss || enemy.def.elite) ? 'large'
        : (enemy.def.death ?? 'creature');
    const deathKey = {
      keeper: 'die_keeper', large: 'die_large', humanoid: 'die_humanoid',
      beast: Math.random() < 0.5 ? 'die_beast_1' : 'die_beast_2',
      creature: Math.random() < 0.5 ? 'die_creature_1' : 'die_creature_2',
    }[cat];
    sfx(this, deathKey, { volume: enemy.def.boss ? 1 : 0.85, jitter: 0.04 });
    enemy.sprite.disableInteractive();
    enemy.flePulse?.remove(); enemy.flePulse = null;
    // The signature badge breathes on a forever-yoyo; kill it before the fade
    // below tries to tween the same alpha in the other direction.
    if (enemy.sigText) this.tweens.killTweensOf(enemy.sigText);
    this.tweens.add({ targets: enemy.sprite, alpha: 0, y: enemy.homeY + 40, duration: 450 });
    enemy.intentIcons.removeAll(true);
    enemy._intentSig = null;   // the telegraph is gone; don't let the guard lie
    this.tweens.add({
      targets: [enemy.uiName, enemy.hpBack, enemy.hpFill, enemy.hpText, enemy.intentHit,
        enemy.shieldIcon, enemy.shieldText,
        // A thief killed on the clock must take its countdown with it, and a
        // dead elite must take its signature badge.
        enemy.fleeText, enemy.fleeIcon, enemy.fleeRing, enemy.sigText,
        enemy.targetRing, ...(enemy.deathParts ?? []), ...Object.values(enemy.statusUI).flatMap(s => [s.icon, s.text])].filter(Boolean),
      alpha: 0, duration: 350,
    });
    burst(this, enemy.homeX, enemy.homeY, 0xffc542, 20);
    this.retargetIfDead();
    this.wakeTheCourt(enemy);
  }

  /**
   * "KILL HIM AND THE COURT WAKES." — SIGNATURES.courtSleeps, and until now the
   * only line in that table the engine did not actually keep.
   *
   * The Hollow King's lock is FX('courtLock', Infinity): it never ticks down, so
   * before this it outlived him. That was invisible while he fought alone (the
   * fight ends with him), and it became a lie the moment THE LAST COURT put him
   * on a board beside the Magistrate — his blurb, his medallion tip and his
   * signature card all promise "while he lives", and the player would have
   * killed him and watched every face card stay dead.
   *
   * SCOPED TO HIS OWN DEATH, deliberately. `courtLock` is also cast, for a
   * handful of turns, by the Ancient Necromancer and the Resurrected Eskimo —
   * this must never touch those, so it only runs when a body carrying the
   * courtSleeps SIGNATURE falls, and only once no other living body carries it.
   * In any fight without him, this function is a single property read.
   */
  wakeTheCourt(dead) {
    if (dead?.def?.special !== 'courtSleeps') return false;
    if ((this.enemies ?? []).some(e => e.alive && e.def?.special === 'courtSleeps')) return false;
    if (!(this.pstat?.courtLock > 0)) return false;
    this.pstat.courtLock = 0;
    this.resyncDenialLocks();
    popMessage(this, ARENA_CX, 500, 'THE COURT WAKES',
      { color: '#ffd23e', size: 40, rise: 46, delay: 320 });
    popMessage(this, ARENA_CX, 552, 'face cards are playable again',
      { color: '#ffe9a8', size: 24, rise: 30, delay: 520 });
    this.refreshAll();
    return true;
  }

  /**
   * Deal attack damage to the player (shield first, brittle amplifies).
   *
   * `source` is who swung, and it exists for exactly one reason: E2 FEAST needs
   * to know how much of the blow reached HP rather than plate. Nothing else
   * reads it, and it is optional, so every other caller is unchanged.
   */
  damagePlayer(amount, source = null) {
    // VERIFICATION RECEIPT: the raw ATTACK damage swung at the hero this enemy
    // turn, before plate and before the round's poison/bleed ticks. It exists so
    // a driver can prove E7 WAKING WRATH's telegraph told the truth — HP alone
    // cannot, because a lingering poison lands in the same round and would read
    // as the intent having lied.
    this._swungThisTurn = (this._swungThisTurn ?? 0) + amount;
    let incoming = amount + this.prop('incomingBonus');   // Crown of Greed's tax
    if (this.pstat.brittle > 0) incoming = Math.round(incoming * 1.5);
    const absorbed = Math.min(this.player.shield, incoming);
    this.player.shield -= absorbed;
    incoming -= absorbed;
    this.player.hp = Math.max(0, this.player.hp - incoming);
    // Second Wind: refuse to die, once per act.
    if (this.player.hp <= 0 && this.prop('secondWind') > 0) {
      const art = run.artifacts.find(a => a.id === 'secondWind');
      if (art && art.state.usedAct !== run.actIndex) {
        art.state.usedAct = run.actIndex;
        this.player.hp = Math.max(1, Math.round(this.player.maxHp * 0.25));
        sfx(this, 'heal', { volume: 1 });
        flashVignette(this, 0xf0f0f0, 0.7);
        popNumber(this, SIDEBAR_W / 2, 380, `SECOND WIND!  +${this.player.hp} HP`, { color: '#ffffff', size: 44 });
      }
    }
    shake(this, 0.006, 180);
    if (absorbed > 0) { sfx(this, 'shield', { volume: 0.6, rate: 0.9 }); this.heroShield(); popNumber(this, 160, 468, `◆-${absorbed}`, { color: '#7fe0f4', size: 32 }); }
    if (incoming > 0) {
      sfx(this, 'hit_taken', { volume: 0.85, jitter: 0.06 });
      this.heroHit();
      popNumber(this, SIDEBAR_W / 2, 422, `-${incoming}${this.pstat.brittle > 0 ? ' (brittle!)' : ''}`, { color: '#ff6a76', size: 46 });
    }
    // E2 FEAST, read off the ONE number that matters: what got through to HP.
    // `incoming` is post-shield and post-brittle, so a fully-plated blow feeds
    // it exactly nothing and a naked one feeds it everything, ×FEAST_MULT.
    if (source?.def?.special === 'feast' && amount > 0) this.feast(source, incoming);
    this.refreshAll();
  }

  enemyTurn() {
    // The hand is over: its biome gates stop applying, so poison, bleed and the
    // enemy's own ticks are never refused by a wall the hand had to break.
    this._handCtx = null;
    for (const c of this.handCards) if (c.lockState === 'frozen') c.setLockState(null);
    const brittleWasArmed = this.pstat.brittle > 0;
    const fearWasArmed = this.pstat.fear > 0;
    // The 2026-08-02 wave's turn-counted debuffs. Unlike brittle and fear they
    // are applied IMMEDIATELY (they lock cards on screen), so this snapshot is
    // what stops this very turn's tick from eating one of them — see
    // denialTurns / tickPlayerDebuffs.
    this._armed = armedSnapshot(this.pstat);
    this._swungThisTurn = 0;   // verification receipt (see damagePlayer)

    this.roundIndex += 1;

    const actors = this.livingEnemies();
    let delay = 0;
    let roundExtra = 450;
    for (const enemy of actors) {
      const telegraph = currentIntent(enemy).effects;
      if (telegraph.some(e => e.type === 'suitban')) roundExtra += 1700;
      // The wave's own set-pieces need a beat to be read, but nothing like the
      // Keeper's whole wheel.
      if (telegraph.some(e => e.type === 'suitSeal' || e.type === 'courtLock')) roundExtra += 800;
      if (enemy.def.flee) roundExtra += 260;
      this.time.delayedCall(delay, () => {
        if (!enemy.alive) return;
        // THE HUSHED BELL: the whole turn is cancelled. The intent pointer is
        // NOT advanced (advanceIntent is what banks a buff, spends a wind-up
        // and sets `charging` — none of that may happen), so the telegraph
        // simply comes back next turn. No attack, no summon, no ward, and the
        // morph below never runs either.
        if (enemy.silenced) return this.silencedTurn(enemy);
        const intent = advanceIntent(enemy);
        enemy.turnCount = (enemy.turnCount ?? 0) + 1;

        // The void does not bleed: while the Depth Knight wears his shell,
        // nothing at all reaches him — damage, statuses, ticks. (Locked design.)
        const bleedDmg = enemy.immune ? 0 : onEnemyAct(enemy);
        if (bleedDmg > 0) {
          sfx(this, 'hit_stab', { volume: 0.6, jitter: 0.06 });
          this.damageEnemy(enemy, bleedDmg, '#ff7a86', 34);
          if (!enemy.alive) return;
        }

        const attacks = intent.effects.filter(e => e.type === 'attack');
        const others = intent.effects.filter(e => e.type !== 'attack');

        if (attacks.length) {
          this.tweens.add({
            targets: enemy.sprite, x: enemy.homeX - 80, duration: 150, yoyo: true, ease: 'Cubic.easeIn',
            onYoyo: () => {
              // `enemy` rides along so E2 FEAST can read how much of its own
              // blow reached HP rather than plate.
              for (const a of attacks) this.damagePlayer(a.value, enemy);
            },
            onComplete: () => enemy.sprite.setX(enemy.homeX),
          });
        }
        let fxDelay = attacks.length ? 260 : 0;
        for (const e of others) {
          const eff = e;
          this.time.delayedCall(fxDelay, () => {
            // SOVEREIGN'S WRIT stands HERE, at the one fork every non-attack
            // effect passes through, rather than inside each of the four
            // dispatches under it. A struck-down signature never reaches its
            // theatre at all — no vignette, no set-piece, no state change.
            // `attack` was filtered out above this loop, so violence is
            // untouched by construction and never had to be excepted.
            if (this.writBlocks(enemy, eff.type)) return;
            if (eff.type === 'buff') {
              popNumber(this, enemy.homeX, enemy.homeY - 120, `${intent.label}  ATK+${eff.value}`, { color: '#ffb060', size: 30 });
            } else if (eff.type === 'charge') {
              popNumber(this, enemy.homeX, enemy.homeY - 120, intent.label, { color: '#ff9a60', size: 30 });
              this.tweens.add({ targets: enemy.sprite, scale: enemy.sprite.scale * 1.06, duration: 300, yoyo: true });
            } else if (BOSS_EFFECTS.has(eff.type)) {
              // Signature boss mechanics own their own theatre entirely.
              this.runBossEffect(enemy, eff, intent);
            } else if (BIOME_EFFECTS.has(eff.type)) {
              // The 2026-08-03 biome wave. Fourteen of the sixteen are states on
              // the ENEMY or on the fight rather than on `pstat` (BLIND and FADE
              // are the two that are not, and they ride applyPlayerDebuff), so
              // they get their own dispatch for the same reason WARDING does.
              this.runBiomeEffect(enemy, eff, intent);
            } else if (SELF_EFFECTS.has(eff.type)) {
              // Things the enemy does to ITSELF or to the field, not to pstat.
              this.runEnemyEffect(enemy, eff, intent);
            } else {
              // The wave's debuffs shout their own name in the middle of the
              // arena, so the generic label pop over the enemy would print it
              // twice, one on top of the other.
              if (!LOUD_EFFECTS.has(eff.type)) {
                popNumber(this, enemy.homeX, enemy.homeY - 120, intent.label, { color: '#c090ff', size: 30 });
              }
              this.applyPlayerDebuff(eff.type, eff.value ?? 1, enemy);
            }
          });
          fxDelay += 220;
        }
        // CUT AND RUN: the countdown spends a turn at the END of this body's
        // own turn, so "survive three turns" means three turns it actually got
        // to take. A silenced thief loses that turn and the clock with it.
        if (enemy.def.flee) {
          this.time.delayedCall(fxDelay + 140, () => this.spendFleeTurn(enemy));
        }
        // MORPH: the Depth Knight changes shape at the END of his turn, so
        // the form you see on your turn is the form you have to beat. Form is
        // derived from intent parity (his deck strictly alternates), which
        // means it can never drift out of sync with what he is telegraphing.
        if (enemy.def.special === 'morph') {
          this.time.delayedCall(fxDelay + 180, () => this.morphTo(enemy, morphForm(enemy.intentIndex)));
        }
        // E4 GLACIAL AEGIS and E7 WAKING WRATH resolve at the END of the turn
        // for the SAME reason morph does: the state you see on YOUR turn has to
        // be the state you are actually playing against. Both are derived from
        // the turn number rather than stored, so neither can drift.
        if (enemy.def.special === 'glacialAegis' || enemy.def.special === 'stillness') {
          this.time.delayedCall(fxDelay + 180, () => this.stillOrShell(enemy));
        }
        if (enemy.def.special === 'wakingWrath') {
          this.time.delayedCall(fxDelay + 180, () => this.wrathBeat(enemy));
        }
      });
      delay += 680;
      if (enemy.def.special === 'morph') delay += 620;   // room for the transition
      if (enemy.def.special === 'glacialAegis') delay += 420;
      if (enemy.def.special === 'wakingWrath') delay += 360;
    }

    this.time.delayedCall(delay + roundExtra, () => {
      // GRIMOIRE OF ROT (Ophelia only): the venom bites twice a round and
      // fades no faster for it. One relic = 2 ticks; a mirrored pair = 3.
      const poisonTicks = 1 + this.prop('poisonDoubleTick');
      if (poisonTicks > 1 && this.livingEnemies().some(e => (e.statuses.poison ?? 0) > 0)) {
        this.pulseByProp('poisonDoubleTick', `☠ ×${poisonTicks}`, '#7a58c8');
      }
      for (const enemy of this.livingEnemies()) {
        if (enemy.immune) continue;   // the void doesn't rot (see morphTo)
        const { damage } = tickStatuses(enemy, { poisonTicks });
        if (damage > 0) {
          popNumber(this, enemy.homeX, enemy.homeY - 110, fmtNum(damage), { color: '#8fe098', size: 38 });
          hitFlash(this, enemy.sprite);
          burst(this, enemy.homeX, enemy.homeY, 0x3fa64b, 8);
        }
        if (enemy.hp <= 0 && enemy.alive) this.killEnemy(enemy);
      }
      if (this.pstat.poison > 0) {
        const dot = this.pstat.poison;
        this.player.hp = Math.max(0, this.player.hp - dot);
        this.pstat.poison -= 1;
        sfx(this, 'poison_hit', { volume: 0.8 });
        flashVignette(this, DEBUFF_COLORS.poison, 0.35);
        this.heroDebuff(DEBUFF_COLORS.poison);
        popNumber(this, SIDEBAR_W / 2, 422, `-${dot} poison`, { color: '#6fdc7f', size: 36 });
      }
      // THE ANCIENT SHIELD: the wall is a WAVE. Every point of shield standing
      // at the end of the round melts — including the Bulwark's supposedly
      // permanent plate and anything a potion or relic added. That is the whole
      // trade: the shield is enormous for exactly one turn, and his +25%-of-
      // shield passive reads it at its peak.
      if (this.prop('shieldMelts') > 0 && this.player.shield > 0) {
        const lost = this.player.shield;
        this.player.shield = 0;
        this.pulseByProp('shieldMelts', 'MELTS', '#ff5ce1');
        sfx(this, 'shield', { volume: 0.5, rate: 0.7 });
        popNumber(this, 70, 468, `◆ −${fmtNum(lost)}`, { color: '#ff5ce1', size: 32 });
      }
      if (brittleWasArmed) this.pstat.brittle = Math.max(0, this.pstat.brittle - 1);
      if (fearWasArmed) this.pstat.fear = 0;
      this.pstat.brittle += this._brittleApplied; this._brittleApplied = 0;
      this.pstat.fear += this._fearApplied; this._fearApplied = 0;
      // ...and one round off ROOTED / COURT ADJOURNED / SEALED SUIT, guarded by
      // the same "was it already running?" snapshot. Whatever expires here has
      // to visibly LET GO — a lock that quietly stops mattering is a mechanic
      // the player never learns.
      this.expireDenials(tickPlayerDebuffs(this.pstat, this._armed));
      this._armed = null;
      // THE HANGMAN'S BRAND runs on the same clock and for the same reason: a
      // brand that quietly stopped mattering is a mechanic nobody learns.
      this.tickCondemned();

      this.refreshAll();
      if (this.livingEnemies().length === 0) return this.fightWon();
      if (this.player.hp <= 0) return this.defeat();
      // The ten-hand clock: the hand has fully resolved, so either it was the
      // last one (and the enemy is still up) or we shout about what's left.
      if (this.handsThisFight >= this.handLimit) return this.outOfHands();
      this.warnHandsLeft();
      this.busy = false;
      // A new player turn starts from a clean slate. Anything the enemy turn
      // left picked (the gaze marks a card the moment it lands, then the
      // redraw re-marks it) is dropped here, so markHypnoCard below is the one
      // and only thing that can arrive pre-selected.
      for (const c of this.selected) if (c.active && c.selected) c.setSelected(false);
      this.selected = [];
      this.releaseHypnoCard();
      // HOPQUAKE lasts exactly one of YOUR turns: it lands during an enemy
      // turn, you play the scrambled hand, and the suits come home at the
      // top of the turn after that (age 0 -> armed, age 1 -> restore).
      if (this.quakeStore) {
        if (this.quakeAge > 0) this.restoreQuakedSuits(true);
        else this.quakeAge += 1;
      }
      this.dealToHandSize(() => {
        this.markHypnoCard();
        // THE MISTRIAL, checked at the top of the player's turn and nowhere
        // else: it is the one thing standing between DOUBLE JEOPARDY and a
        // fight that can be neither won nor lost. See checkMistrial.
        this.checkMistrial();
        this.refreshAll();
      });
    });
  }

  // ---------------- Victory & rewards ----------------

  fightWon() {
    this.busy = true;
    // The Rabbit can die mid-quake — the run deck must leave with its own
    // suits, so the restore runs before any reward overlay can read the deck.
    this.restoreQuakedSuits(false);
    // The checkpoint has done its job: this fight can never need re-fielding.
    // (The map's own autosave, on the way back, is what banks the win.)
    clearPendingFight(run);
    run.counters.fights += 1;
    if (this.node.type === 'elite') run.counters.elites += 1;
    // Victory stings: quick and peppy for fights, weightier for elites.
    if (this.node.type === 'elite') sfx(this, 'elite_victory', { volume: 0.6 });
    else if (this.node.type !== 'boss') sfxCapped(this, 'general_victory', { volume: 0.5, rate: 1.12 }, 1600);
    this.artHook('fightEnd', this.node);
    this.refreshAll();
    // The victory sweep. UNTOUCHED asks whether a single point of HP was ever
    // lost, whatever took it; everything else on the shelf that reads plain run
    // state (a full belt, a full row, a hatched egg) rides along with it.
    const untouched = (this._minHpThisFight ?? this.player.hp) >= (this._hpAtFightStart ?? this.player.hp);
    // IMMACULATE reads the same answer, one act at a time: one scuffed fight
    // scuffs the act, and only advanceAct() wipes it clean again. Banked before
    // the sweep so an act whose LAST fight was the boss still answers correctly.
    if (run.stats && !untouched) run.stats.actScuffed = true;
    fireAchievements(this, 'fightWon', {
      flawless: untouched,
      discards: this._discardsThisFight ?? 0,
      revived: this._revivedThisFight === true,
    });

    // DIAMOND and MYTHRIL: a boss pays NOTHING. No purse, no bounty pack. The
    // act still clears with its heal and its DESCEND, because that is
    // progression, not loot. Every other room pays exactly as normal.
    if (this.node.type === 'boss' && !difficultyOf(run).bossReward) {
      this._lastPurse = { left: this.handsLeft, per: 0, raw: 0, paid: 0 };
      this.time.delayedCall(500, () => {
        popMessage(this, ARENA_CX, 300, 'THE BOSS LEAVES NOTHING BEHIND', { color: '#a898c4', size: 30 });
        this.time.delayedCall(this.spd(900), () => this.afterPurse());
      });
      return;
    }

    // THE PURSE, before anything else opens: the hand clock cashes out.
    // Bosses and elites run the same clock, so they get the same tally — it
    // just lands before the act ceremony / the relic shelf instead of the packs.
    this.time.delayedCall(500, () => this.payHandsPurse(() => this.afterPurse()));
  }

  /**
   * Rewards, once the victory tally has finished counting.
   *
   * ANY EGG THAT CAME DUE HATCHES FIRST. The fightEnd hook only booked it (the
   * row must not be rewritten mid-victory), so this is where the shell actually
   * cracks — its own beat, ahead of the elite shelf and the pack table, exactly
   * the way the deferred merchant visit waits for the next map.
   */
  afterPurse() {
    this.time.delayedCall(240, () => this.runPendingHatches(() => this.afterHatches()));
  }

  /** The reward flow proper, once every egg on the belt has finished hatching. */
  afterHatches() {
    if (this.node.type === 'boss') return this.bossDefeated();
    {
      const packTable = () => {
        const offer = rollPackOffer(run.actIndex);
        packOfferOverlay(this, run, offer, () => this.returnToMap());
      };
      if (this.node.type === 'elite') {
        // ELITE SPOILS (JC, 2026-07-31; mixed pool PATCH 0803 §2): an elite used
        // to hand you one relic, take it or leave it. It drops THREE and you
        // choose, and since 0803 those three come off ONE weighted pool of
        // relics AND potions — with at least one artifact always among them.
        // The Bounty Board promotes ONE offering a tier (2026-08-06), ordinary
        // and Forged shelves alike — see elites.promoteOneOffering.
        //
        // A FORGED elite (IRON and up, 1 in 4, flagged on the node when the map
        // was generated) pays a different table entirely: RARE or better,
        // relics only, no bottles at all. The map said so before you walked in.
        const bonus = this.prop('eliteChips');
        if (bonus > 0) this.gainChips(bonus, 'Bounty!');
        const forged = !!this.node.forged;
        const spoils = rollEliteSpoils({
          ownedIds: run.artifacts.map(a => a.id),
          count: ELITE_DROP_CHOICES,
          forged,
          rarityBoost: this.prop('eliteRarityBoost'),
          rng: Math.random,
          heroId: run.chrId,
          actIndex: run.actIndex,
        });
        if (spoils.length) eliteChoiceOverlay(this, run, spoils, packTable, { forged });
        else packTable();
        return;
      }
      // Regular fight: straight to the packs (the old upgrade draft is retired).
      packTable();
    }
  }

  returnToMap() {
    this.cameras.main.fadeOut(300, 20, 16, 28);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Map'));
  }

  bossDefeated() {
    // ------------------------------------------------------------------
    // AN ENDLESS ACT CLEAR BANKS NOTHING (2026-08-05).
    //
    // The trophies, the difficulty ladder, `bestAct` and the WIN itself were
    // all banked the moment this run beat Act IV — an endless act is progress
    // past the end of the game, and its record is its own (`endlessDepth`,
    // folded onto the lifetime shelf at the end screen). recordActClear and
    // recordWin are therefore deliberately NOT called here: firing them would
    // add a win to the profile for every lap and re-toast unlocks that are
    // already open. The ceremony below is otherwise the ordinary one, heal,
    // bounty gating and DESCEND included.
    // ------------------------------------------------------------------
    if (run.endless) {
      noteEndlessClear(run.actIndex, run);
      return this.actClearCeremony(null);
    }
    // THE OFFER IS DECIDED BEFORE THE CLEAR IS BANKED. recordActClear is the
    // call that SETS progress.endlessUnlocked on a first Act IV clear, so
    // asking afterwards would offer the endless on the very run that opened it.
    // The unlock is NEWS on the run that earns it, and a door on every run
    // after — so the run that earns it takes its victory, exactly as today.
    const hadEndless = progress.endlessUnlocked === true;
    // The hero and the mode go with the act number: clearing ACT III on mode N
    // is what opens N+1 for THIS hero, and the ladder lives in progress.js.
    // A SEEDED run passes NO hero (2026-08-04): the ladder is a record of what
    // you climbed, and a seed can be replayed until it obliges — the twin of
    // the trophy gate in achievements.noteEvent. Act IV / endless / bestAct
    // still bank: those are content, not records.
    const toast = recordActClear(this.act.num, run.seed ? null : run.chrId, run.difficulty);
    // AFTER recordActClear, never before: IRON FORGED and MYTHRIL FORGED read
    // progress.difficultyCleared, and the ladder is only banked by that call.
    fireAchievements(this, 'actClear', { act: this.act.num });
    if (run.actIndex >= run.totalActs - 1) {
      // THE WIN BANKS EITHER WAY. Whatever the player chooses next, they beat
      // the game on this kill and the profile says so before they are asked.
      recordWin();
      return hadEndless ? this.endlessOffer(toast) : this.victory(toast);
    }
    return this.actClearCeremony(toast);
  }

  /**
   * THE OFFER (2026-08-05). Act IV is down and this profile has stood here
   * before, so the run does not have to end.
   *
   * Two doors, no timer: the player has just won and is allowed to read. CLAIM
   * VICTORY is byte-for-byte today's ending. DESCEND hands the same run to the
   * endless, where the worlds come round again and the boss of each act is ten
   * times the last one.
   */
  endlessOffer(toast) {
    stopMusic(this, 600);
    sfx(this, 'general_victory', { volume: 0.95 });
    const cx = GAME_W / 2, cy = GAME_H / 2;
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay);
    ov.add(this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x14101c, 0.84).setInteractive());
    const parts = woodPanel(this, cx, cy, 880, 540, { accent: ENDLESS_ACCENT });
    ov.add([parts.shadow, parts.panel, parts.line].filter(Boolean));
    ov.add(this.add.text(cx, cy - 198, 'THE RUN IS WON', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '58px', color: PARCH.text,
    }).setOrigin(0.5));
    ov.add(this.add.text(cx, cy - 140, `${this.chr.name} conquered all ${run.totalActs} acts.`, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0.5));
    // The flavour line is the whole invitation, so it gets its own beat and the
    // endless accent rather than the parchment's dim body ink. The three-line
    // body below is centred on its own middle, so these two ys are set far
    // enough apart for the body's TOP line to clear this one's descenders.
    ov.add(this.add.text(cx, cy - 92, 'The forge burns deeper still.', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '32px', color: ENDLESS_INK,
    }).setOrigin(0.5));
    ov.add(this.add.text(cx, cy + 2,
      'Take the victory and the run ends here, banked and counted.\n'
      + 'Or descend: the four worlds come round again, and every boss below is ten times the last.\n'
      + 'There is no way back out of the endless. It ends when you do.', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim,
        fontStyle: 'bold', align: 'center', lineSpacing: 6, wordWrap: { width: 760 },
      }).setOrigin(0.5));
    if (toast) {
      ov.add(this.add.text(cx, cy + 84, toast, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: ENDLESS_INK, align: 'center',
      }).setOrigin(0.5));
    }

    const mk = (bx, key, label, color, tint, cb) => {
      const b = this.add.image(bx, cy + 174, key).setDisplaySize(390, 82)
        .setInteractive({ useHandCursor: true });
      if (tint != null) b.setTint(tint);
      const t = this.add.text(bx, cy + 170, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color,
      }).setOrigin(0.5);
      ov.add([b, t]);
      // One way out, whichever button got there first: both paths build another
      // full-screen ceremony on top and neither may leave this one standing.
      let taken = false;
      b.on('pointerdown', () => {
        if (taken) return;
        taken = true;
        ov.destroy(true);
        cb();
      });
      return b;
    };
    mk(cx - 214, 'btn_yellow', 'CLAIM VICTORY', '#5b3a00', null, () => {
      sfx(this, 'button', { volume: 0.8 });
      this.victory(toast);
    });
    // The DARK plate, not the red one: a red texture multiplied by a violet
    // tint is still red (its blue channel is already near zero), and the offer
    // reads as "the other red button" rather than as the ominous half of a
    // choice. The dark plate takes the violet and keeps it.
    mk(cx + 214, 'btn_dark', 'DESCEND INTO THE ENDLESS', '#f2e4ff', ENDLESS_BTN_TINT, () => {
      // The sting, not the button click: this is the ominous half of the offer.
      suspense(this, { volume: 0.85, rate: 0.92 });
      beginEndless(run);
      this.actClearCeremony(null);
    });
    // The deck you would be taking down with you, on the screen where it is
    // actually a decision — every other ceremony offers the same look.
    viewDeckButton(this, ov, run);
    return ov;
  }

  /**
   * THE BETWEEN-ACTS CEREMONY: heal, bounty, DESCEND. Extracted from
   * bossDefeated when the ENDLESS arrived, because it is now reached from three
   * places (an ordinary act clear, an endless act clear, and taking the offer)
   * and all three want exactly the same beats.
   */
  actClearCeremony(toast) {
    // Between-acts ceremony: boss music dies with the boss, a triumphant sting crowns you.
    stopMusic(this, 600);
    sfx(this, 'general_victory', { volume: 0.9 });
    const clearedAct = this.act;
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay);
    ov.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.75).setInteractive());
    // ENDLESS re-dresses the frame in the loop's own colour, so an endless act
    // clear never looks like the finite game's.
    const endlessNow = run.endless === true;
    const nextIdx = run.actIndex + 1;
    const parts = woodPanel(this, GAME_W / 2, GAME_H / 2, 760, 460,
      { accent: endlessNow ? (endlessTint(run.actIndex) ?? ENDLESS_ACCENT) : 0xffc542 });
    ov.add([parts.shadow, parts.panel, parts.line]);
    if (endlessNow && isEndlessIndex(run.actIndex)) {
      // The lap sits above the act, not inside its headline: "ACT III CLEARED"
      // is the sentence, and which time around is the context for it.
      ov.add(this.add.text(GAME_W / 2, GAME_H / 2 - 190,
        `THE ENDLESS  ·  LOOP ${endlessLoop(run.actIndex)}`, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: ENDLESS_INK,
        }).setOrigin(0.5));
    }
    ov.add(this.add.text(GAME_W / 2, GAME_H / 2 - 140, `ACT ${clearedAct.numeral} CLEARED`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '58px', color: PARCH.text,
    }).setOrigin(0.5));
    const heal = Math.round(this.player.maxHp * 0.3);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    // SHIP IN A BOTTLE makes port. `actCleared` is a NEW hook name and this is
    // the one beat all three roads to a cleared act pass through (an ordinary
    // clear, an endless clear, and taking the offer), so it is the only place
    // it needs firing.
    //
    // THE PAYOUT IS READ OFF THE PURSE, not off the hook's return: snapshot
    // run.chips either side and the ledger line below is honest about a
    // mirrored ship, a hung one, or anything else that ever hangs off this
    // hook, without this line having to know who any of them are.
    const chipsBefore = run.chips ?? 0;
    this.artHook('actCleared', { actIndex: run.actIndex });
    const actPaid = Math.max(0, (run.chips ?? 0) - chipsBefore);
    const next = actOf(nextIdx);
    /**
     * THE DESCENT'S OWN PREFETCH. This panel names the world below out loud and
     * then makes the player read it, wait out a 1250ms beat, watch a payday and
     * open a bounty wrap before DESCEND is even armed — which is several seconds
     * of ceremony in front of a 36 MB bundle. Kicking it here means the map's
     * gate on the other side has nothing left to wait for.
     *
     * ENDLESS INCLUDED: `actBundle` resolves through actSlotFor, so index 8 asks
     * for Act I's world again — the one MapScene evicted four descents ago, and
     * the reason the endless stays flat instead of climbing.
     */
    ensure(this, actBundle(nextIdx, run));
    // The ledger sentence. A payout the panel does not name is a payout the
    // player never sees happen, so it rides beside the heal rather than only in
    // the sidebar's own pop.
    ov.add(this.add.text(GAME_W / 2, GAME_H / 2 - 62,
      `${clearedAct.name} falls silent.  You rest and recover ${heal} HP.`
      + (actPaid ? `  Your relics pay out ${actPaid} chips.` : ''), {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: PARCH.textDim, fontStyle: 'bold',
      }).setOrigin(0.5));
    const nextLine = endlessNow
      ? `Next: ENDLESS  ·  LOOP ${endlessLoop(nextIdx)}  ·  ACT ${next.numeral}  ·  ${next.name}`
      : `Next: ACT ${next.numeral}  ·  ${next.name}${next.secret ? '  ☠' : ''}`;
    const nextText = this.add.text(GAME_W / 2, GAME_H / 2 - 8, nextLine, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px',
      color: endlessNow ? ENDLESS_INK : PARCH.accent,
    }).setOrigin(0.5);
    // The endless line carries two extra words; squeeze rather than overrun the
    // 760px panel (the same rule the combat sidebar's stage line lives by).
    if (nextText.width > 680) nextText.setScale(680 / nextText.width);
    ov.add(nextText);
    if (toast) {
      // The bright violet is a dark-ground colour; this line is on the act-clear
      // panel's cream. Same violet, darkened until it is a word again.
      ov.add(this.add.text(GAME_W / 2, GAME_H / 2 + 44, toast, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#6b2fa8',
      }).setOrigin(0.5));
    }
    const btn = this.add.image(GAME_W / 2, GAME_H / 2 + 136, 'btn_yellow')
      .setDisplaySize(320, 76);
    const bt = this.add.text(GAME_W / 2, GAME_H / 2 + 132, 'DESCEND', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: '#5b3a00',
    }).setOrigin(0.5);
    ov.add([btn, bt]);
    // The last look at the deck you are taking down with you. DESCEND is
    // deliberately alpha-0 until armDescend(), so this hangs off `ov` and not
    // off the button (PATCH 0803-B §4.3).
    viewDeckButton(this, ov, run);
    btn.on('pointerdown', () => {
      sfx(this, 'button', { volume: 0.8 });
      advanceAct();
      this.returnToMap();
    });
    const armDescend = () => {
      btn.setInteractive({ useHandCursor: true });
      this.tweens.add({ targets: [btn, bt], alpha: 1, duration: 280, ease: 'Sine.easeOut' });
    };

    // THE BOUNTY HUNTER is collected HERE, before you may leave (JC) — the old
    // map-arrival trigger is now only a fallback. Already-claimed acts (a dev
    // re-kill, a save caught mid-flight) skip straight to DESCEND.
    run.bountiesClaimed ??= [];
    if (run.bountiesClaimed.includes(run.actIndex)) return armDescend();
    // DIAMOND and up: no BOUNTY HUNTER pack. The act is marked claimed anyway,
    // so MapScene's arrival fallback does not hand it over on the next screen.
    if (!difficultyOf(run).bossReward) {
      run.bountiesClaimed.push(run.actIndex);
      return armDescend();
    }
    btn.setAlpha(0);
    bt.setAlpha(0);
    // Long enough to actually READ the panel before the chips start falling
    // over it — ACT CLEARED and the payday are two beats, not one.
    this.time.delayedCall(1250, () => this.actClearBounty(clearedAct, armDescend));
  }

  /**
   * The act-clear payday, staged between the ceremony and the DESCEND button:
   * the screen breathes gold, CLAIM YOUR REWARD lands plate-free beneath the
   * panel, Caleb's chips rain the full width — then the bounty wrap tears open.
   *
   * The ledger entry is written the instant the wrap appears, so a mid-pack
   * scene churn (deck picker, artifact ceremony) can never award twice, and
   * MapScene's arrival check sees the act as settled when you finally descend.
   */
  actClearBounty(clearedAct, done) {
    const payoff = this.add.container(0, 0).setDepth(DEPTH.overlay + 2);

    // 1. THE GLOW — a slow bloom through the middle plus four breathing edges.
    const bloom = this.add.image(GAME_W / 2, GAME_H / 2, 'fx_glow_circle')
      .setDisplaySize(2600, 1900).setTint(0xffd23e).setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    const bars = [
      this.add.image(GAME_W / 2, -30, 'fx_glow').setDisplaySize(GAME_W * 1.4, 300),
      this.add.image(GAME_W / 2, GAME_H + 30, 'fx_glow').setDisplaySize(GAME_W * 1.4, 300),
      this.add.image(-30, GAME_H / 2, 'fx_glow').setDisplaySize(320, GAME_H * 1.4),
      this.add.image(GAME_W + 30, GAME_H / 2, 'fx_glow').setDisplaySize(320, GAME_H * 1.4),
    ];
    for (const b of bars) b.setTint(0xffd23e).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    payoff.add(bloom);
    payoff.add(bars);
    const breathe = (targets, peak, low) => this.tweens.add({
      targets, alpha: peak, duration: 520, ease: 'Sine.easeOut',
      onComplete: () => this.tweens.add({
        targets, alpha: low, duration: 1150, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      }),
    });
    // Gentle on the bloom: enough to gild the whole frame, not enough to undo
    // the ceremony's dimmer (the panel has to stay the brightest thing here).
    breathe(bloom, 0.2, 0.1);
    breathe(bars, 0.6, 0.28);

    // 2. THE CALL — no plate, just gold letters with the chiselled stroke.
    const claim = this.add.text(GAME_W / 2, GAME_H / 2 + 272, 'CLAIM YOUR REWARD', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '62px', color: '#ffd23e',
      stroke: '#241505', strokeThickness: 11,
    }).setOrigin(0.5).setScale(0.6).setAlpha(0);
    claim.setShadow(0, 8, '#0c0804', 14, true, true);
    payoff.add(claim);
    this.tweens.add({
      targets: claim, alpha: 1, scale: 1, duration: 340, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: claim, scale: 1.05, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      }),
    });

    // 3. THE RAIN — tilted chips tumble in from the top edge for ~2.5s.
    sfx(this, 'chips_stack', { volume: 0.9 });
    const rain = this.add.container(0, 0);
    payoff.add(rain);
    const dropChip = () => {
      const x = Phaser.Math.Between(40, GAME_W - 40);
      const chip = this.add.image(x, Phaser.Math.Between(-190, -110),
        Math.random() < 0.5 ? 'chip_tilt_1' : 'chip_tilt_2')
        .setScale(Phaser.Math.FloatBetween(0.17, 0.34))
        .setAngle(Phaser.Math.Between(0, 360));
      rain.add(chip);
      this.tweens.add({
        targets: chip, y: GAME_H + 160, x: x + Phaser.Math.Between(-70, 70),
        angle: `+=${Phaser.Math.Between(-420, 420)}`,
        duration: Phaser.Math.Between(1500, 2500), ease: 'Sine.easeIn',
        onComplete: () => chip.destroy(),
      });
    };
    const rainTimer = this.time.addEvent({
      delay: 95, repeat: 25,
      callback: () => { dropChip(); if (Math.random() < 0.5) dropChip(); },
    });

    // 4. The wrap opens; when its rewards resolve, the gold recedes and DESCEND
    //    lights up — the old flow, picked up exactly where it left off.
    let settled = false;
    const finish = () => {
      if (settled) return;          // one way out, however the rewards resolved
      settled = true;
      this.runShop = null;
      rainTimer.remove();
      this.tweens.killTweensOf([bloom, ...bars, claim]);
      this.tweens.add({
        targets: [bloom, ...bars, claim], alpha: 0, duration: 420, ease: 'Sine.easeIn',
        onComplete: () => payoff.destroy(true),
      });
      this.refreshAll?.();          // HOT MEAL / relics bought with the bounty
      done();
    };
    this.time.delayedCall(2150, () => {
      run.bountiesClaimed.push(run.actIndex);
      const killed = bossEntry(clearedAct, run.bossPicks?.[run.actIndex])?.name;
      const subtitle = killed
        ? `ACT ${clearedAct.numeral} CLEARED. ${killed} had a price on its head.`
        : 'A boss is worth something to somebody.';
      // THE MERCHANT reward wants his table RIGHT NOW, but the next act's map
      // (and its tent) doesn't exist yet. rewards.js hands that beat to
      // scene.runShop() — so from here that hook books him for the road ahead,
      // and MapScene honours the promise the moment you arrive.
      this.runShop = () => {
        run.pendingShopVisit = true;
        this.actClearToast('The merchant will meet you on the road ahead.');
        this.time.delayedCall(1400, finish);
      };
      bountyPackOverlay(this, run, { subtitle }, finish);
    });
  }

  /** A one-line gold notice that sits above every act-clear overlay. */
  actClearToast(msg) {
    // Sits in the panel's empty lower half — clear of the heal line above and
    // of the DESCEND button that has not arrived yet.
    const t = this.add.text(GAME_W / 2, GAME_H / 2 + 96, msg, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: '#ffd23e',
      stroke: '#241505', strokeThickness: 7, align: 'center', wordWrap: { width: 1100 },
    }).setOrigin(0.5).setDepth(DEPTH.overlay + 9).setAlpha(0).setScale(0.7);
    t.setShadow(0, 6, '#0c0804', 12, true, true);
    this.tweens.add({
      targets: t, alpha: 1, scale: 1, duration: 220, ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: t, alpha: 0, y: '-=50', duration: 520, delay: 720,
        onComplete: () => t.destroy(),
      }),
    });
    return t;
  }

  victory(toast) {
    // The run-win anthem: swap straight to the victory pool (playMusic crossfades
    // out whatever's still ringing from the boss kill) and layer a quick sting
    // under its intro so the kill still lands with impact.
    playMusic(this, 'victory');
    sfx(this, 'general_victory', { volume: 1 });
    const sub = toast
      ? `${this.chr.name} conquered all ${run.totalActs} acts!  ${toast}`
      : `${this.chr.name} conquered all ${run.totalActs} acts!`;
    this.showEnd('VICTORY!', sub, 0xffc542, true);
  }

  /**
   * The death: silence, the hero falls, the world dims — then the game-over song.
   * @param {?string} reason  epitaph under DEFEATED (default: the act claims you)
   * @param {boolean} outOfHands  true when the ten-hand clock, not HP, killed you
   */
  defeat(reason = null, outOfHands = false) {
    // Fairy in a Bottle: she has other plans. Consumed on use.
    const fairyIdx = run.potions.findIndex(p => p.effect?.type === 'revive');
    if (fairyIdx >= 0) {
      const fairy = run.potions.splice(fairyIdx, 1)[0];
      this.player.hp = Math.max(1, Math.round(this.player.maxHp * fairy.effect.frac));
      // NOT TODAY pays out only if you go on to WIN this fight, so the flag is
      // fight-local and the trophy fires from the victory sweep, not from here.
      this._revivedThisFight = true;
      sfx(this, 'potion_drink_big', { volume: 0.95 });
      sfx(this, 'heal', { volume: 0.9 });
      flashVignette(this, 0xffd0f0, 0.7);
      burst(this, SIDEBAR_W / 2, 380, 0xffd0f0, 24);
      popNumber(this, SIDEBAR_W / 2, 360, 'THE FAIRY INTERVENES!', { color: '#ffd0f0', size: 40 });
      // Reviving into an empty clock would just re-defeat on the spot, so when
      // she saves you from the ten-hand rule she winds it back three hands.
      if (outOfHands) {
        this.handsThisFight = Math.max(0, this.handLimit - FAIRY_HANDS_BACK);
        this.time.delayedCall(520, () =>
          popNumber(this, ARENA_CX, 300, `+${FAIRY_HANDS_BACK} HANDS!`, { color: '#ffd0f0', size: 46, rise: 64 }));
      }
      this.renderPotionBelt();
      this.refreshAll();
      // Resume the fight no matter which death path brought us here: unlock
      // input and top the hand back up (no-op if the hand is already full).
      this.busy = false;
      this.time.delayedCall(450, () => this.dealToHandSize(() => this.refreshAll()));
      return;
    }
    this.busy = true;
    stopMusic(this, 350);
    if (this.heartbeat) { this.heartbeat.stop(); this.heartbeat.destroy(); this.heartbeat = null; }
    sfx(this, 'game_over', { volume: 0.95 });

    // The world closes in.
    const shroud = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0508, 0)
      .setDepth(DEPTH.overlay - 1).setInteractive();
    this.tweens.add({ targets: shroud, fillAlpha: 0.72, duration: 1500, ease: 'Sine.easeIn' });
    flashVignette(this, 0x8a0a18, 0.8);
    shake(this, 0.008, 500);
    // The hero keels over and fades.
    this.tweens.add({
      targets: this.heroSprite, angle: 84, y: this.heroHome.y + 46, alpha: 0.25,
      duration: 1100, ease: 'Cubic.easeIn',
    });
    this.heroFX.setTint(0xd82838).setAlpha(0.6);
    this.tweens.add({ targets: this.heroFX, alpha: 0, duration: 1600 });

    // Then the dirge (plays once, holds until a new run — per Caleb's README).
    this.time.delayedCall(1500, () => {
      playMusic(this, 'gameover');
      // AN ENDLESS DEATH IS NOT A DEFEAT (2026-08-05). This run already beat the
      // game and the profile already counted the win; what ended here is how far
      // past the end it got. So the verdict names the depth instead of the loss,
      // wears the endless violet instead of the death red, and goes in with
      // `won` TRUE so run.stats.cleared stays honest and the lifetime fold keeps
      // counting this as a cleared run.
      if (run.endless) {
        this.showEnd('FELLED IN THE ENDLESS', this.endlessDepthLine(),
          endlessTint(run.actIndex) ?? ENDLESS_ACCENT, true);
        return;
      }
      this.showEnd('DEFEATED', reason ?? `${this.act.name} claims another hand...`, 0xe0434f);
    });
  }

  /** "Loop 2 · Act III · Floor 7" — where in the endless this run stopped. */
  endlessDepthLine() {
    const floor = Math.min((this.node?.row ?? 0) + 1, 99);
    const where = this.node?.type === 'boss' ? 'THE BOSS' : `Floor ${floor}`;
    return `${endlessLabel(run.actIndex)} · ${where}`;
  }

  /**
   * THE END OF THE RUN. Same shape whichever way it ended: the verdict lands
   * first and loudest, then the RUN RECAP report card, then PLAY AGAIN. EVERY
   * ending routes through here — HP death, the ten-hand clock (outOfHands), a
   * seal deadlock, and the final boss's victory — so the recap is unconditional.
   * The panel grows with the number of rows the run actually earned — and when
   * it cannot grow any further (the UNLOCKS section on a run that opened half a
   * dozen things would run off a 1080 canvas) the report card SCROLLS instead,
   * by wheel or by dragging it, with the verdict pinned above and PLAY AGAIN
   * pinned below so neither can ever be scrolled out of reach.
   */
  showEnd(title, sub, color, won = false) {
    // ------------------------------------------------------------------
    // ONE END SCREEN PER RUN (2026-08-05).
    //
    // `defeat()` has no re-entry guard and several paths can reach it on the
    // same beat (the hp check after a hand, the enemy turn already in flight,
    // the dev hook), so this funnel was being entered TWICE and building the
    // whole overlay twice, one exactly on top of the other: two veils, two
    // PLAY AGAIN buttons, two of every count-up tween, and `this._endUI`
    // clobbered by the second. It was invisible for as long as the two copies
    // were pixel-identical -- the NEW BEST tag is what finally showed it,
    // because the second pass folds no records and so drew a card that
    // disagreed with the one under it.
    //
    // Guarded here rather than in defeat() because THIS is the single door
    // every ending comes through, win or lose.
    // ------------------------------------------------------------------
    if (this._endShown) return;
    this._endShown = true;
    if (this.heartbeat) { this.heartbeat.stop(); this.heartbeat.destroy(); this.heartbeat = null; }
    run.active = false;
    // THE RUN IS OVER, whichever way it ended — HP death, the clock, a seal
    // deadlock, or the final boss falling. Every ending routes through here, so
    // this one line is the whole "death or victory clears the save" rule, and it
    // sits AHEAD of the theatre below so nothing decorative can skip it.
    clearPendingFight(run);
    clearSave();
    // Close the ledger. The room you are standing in IS how far you got, and a
    // win is a win — noteReached keeps the high-water mark honest either way.
    if (run.stats) {
      run.stats.cleared = won;
      noteReached(run.actIndex, (this.node?.row ?? 0) + 1, this.node?.type === 'boss', run);
      this.notePoisonPeak();
      // THE LIFETIME SHELF, folded exactly once (2026-08-05). It has to happen
      // BEFORE recapRows/recapHeight are asked anything, because the rows the
      // run just beat wear a NEW BEST tag and the panel is sized off them.
      // foldRunIntoRecords latches on run.stats itself, so this line is safe to
      // reach twice — showEnd re-renders — and a SEEDED run banks nothing.
      //
      // ASKED ONCE, ANSWERED ONCE. foldRunIntoRecords latches itself, so a
      // re-render is harmless to the SHELF — but its answer on the second call
      // is correctly an empty list, and writing that over the first answer took
      // every NEW BEST tag straight back off the report card. The verification
      // driver caught exactly that: two tags drawn, zero records claimed.
      if (!Array.isArray(run.stats.recordsBeaten)) {
        run.stats.recordsBeaten = foldRunIntoRecords(run);
      }
    }

    const nRows = recapRows(run).length + unlockRows().length;
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const panelW = 900;
    const subStyle = {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '23px', color: PARCH.textDim,
      align: 'center', wordWrap: { width: panelW - 140 },
    };
    // A two-line epitaph (the victory line names the act AND the unlock) would
    // otherwise sit on the RUN RECAP rule, so measure it and grow the panel.
    const probe = this.add.text(0, -9999, sub, subStyle);
    const subOverflow = Math.max(0, probe.height - 32);
    probe.destroy();
    // THE REPORT CARD'S OWN HEIGHT, asked of the thing that draws it rather than
    // reconstructed from a row count here — the UNLOCKS section has its own rule,
    // its own gap and its own row step, and this used to be the one place that
    // knew the arithmetic twice.
    const HEAD = 210;      // panel top -> the recap header's centre
    const FOOT = 153;      // ...and below the last row: PLAY AGAIN, plus air
    const contentH = recapHeight();
    const wantH = HEAD + subOverflow + contentH + FOOT;
    // 1080 is the whole canvas. Past this the panel stops growing and the report
    // card starts scrolling inside it.
    const panelH = Math.min(wantH, GAME_H - 44);
    const top = cy - panelH / 2;
    const hex = '#' + color.toString(16).padStart(6, '0');

    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay);
    const veil = this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x14101c, 0).setInteractive();
    ov.add(veil);
    this.tweens.add({ targets: veil, fillAlpha: 0.8, duration: 280 });

    // --- beat one: the panel arrives ---
    const parts = woodPanel(this, cx, cy, panelW, panelH, { accent: color });
    const frame = [parts.shadow, parts.panel, parts.line].filter(Boolean);
    for (const p of frame) p.setAlpha(0).setScale(0.93);
    ov.add(frame);
    this.tweens.add({ targets: frame, alpha: 1, scale: 1, duration: 320, ease: 'Back.easeOut' });

    // --- beat two: the verdict ---
    const tt = this.add.text(cx, top + 66, title, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '72px', color: hex,
      stroke: '#38220f', strokeThickness: 10,
    }).setOrigin(0.5).setAlpha(0);
    // THE VERDICT FITS THE PANEL. 'DEFEATED' and 'VICTORY!' never came close,
    // but the ENDLESS endings are whole sentences ('THE ENDLESS RELEASES YOU')
    // and a 72px Lilita line of that length reaches the wooden rails. The fit
    // is the tween's TARGET, not something applied after it, or the arrival
    // would spring straight back out to the overflowing size.
    const titleFit = Math.min(1, (panelW - 96) / Math.max(1, tt.width));
    tt.setScale(0.62 * titleFit);
    this.tweens.add({
      targets: tt, alpha: 1, scale: titleFit, duration: 400, delay: 200, ease: 'Back.easeOut',
    });
    const stx = this.add.text(cx, top + 120 + subOverflow / 2, sub, subStyle)
      .setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: stx, alpha: 1, duration: 300, delay: 440 });
    ov.add([tt, stx]);

    // --- beat three: the report card, cascading in ---
    //
    // IT LIVES IN ITS OWN CONTAINER, BEHIND A MASK. On an ordinary run the
    // window is taller than the card and none of this is visible; on a run that
    // opened five things the card is taller than the canvas, and then the mask
    // is the difference between a scrollable report and rows drawn through the
    // panel's bottom rail and off the screen.
    const topY = top + HEAD + subOverflow;
    const viewTop = topY - 62;                    // just above the RUN RECAP rule
    const viewBottom = top + panelH - 128;        // ...and just above PLAY AGAIN
    const viewH = Math.max(120, viewBottom - viewTop);
    const card = this.add.container(0, 0);
    ov.add(card);
    const lastY = drawRecap(this, card, cx, topY, { delay: 640, accent: color });
    const fullH = (lastY + 22) - viewTop;
    const maxScroll = Math.max(0, fullH - viewH);
    // The verification hook's home. Filled in below with the scroller, if there
    // is one; the button is attached after it is built.
    this._endUI = { panelH, maxScroll, scroll: 0, card, setScroll: null, btn: null };
    if (maxScroll > 0) {
      const maskShape = this.make.graphics({ x: 0, y: 0, add: false });
      maskShape.fillStyle(0xffffff);
      maskShape.fillRect(cx - panelW / 2 + 12, viewTop, panelW - 24, viewH);
      card.setMask(maskShape.createGeometryMask());
      // Kinetic (2026-08-04): the shared float — flicks glide, edges rubber-band.
      const kin = kineticScroll(this, {
        max: maxScroll,
        apply: (v) => { card.y = -v; this._endUI.scroll = v; },
      });
      const setScroll = (v) => kin.set(v);
      this._endUI.setScroll = setScroll;
      const onWheel = (_p, _o, _dx, dy) => kin.wheel(dy);
      this.input.on('wheel', onWheel);
      // ...and DRAG, the same gesture the skins shelf and the trophy case use.
      let dragFrom = null;
      veil.on('pointerdown', (p) => { dragFrom = true; kin.grab(p.y); });
      const onMove = (p) => { if (dragFrom && p.isDown) kin.move(p.y); };
      this.input.on('pointermove', onMove);
      const onUp = () => { dragFrom = null; kin.release(); };
      this.input.on('pointerup', onUp);
      // The hint sits INSIDE the window's bottom edge, over the rows it is
      // telling you about, so it cannot be the thing that overflows the panel.
      const hint = this.add.text(cx, viewTop + viewH - 4, 'scroll for more', {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px',
        color: PARCH.textDim, fontStyle: 'bold',
      }).setOrigin(0.5, 1).setAlpha(0);
      ov.add(hint);
      this.tweens.add({ targets: hint, alpha: 1, duration: 300, delay: 900 });
      // Scene teardown must take the listeners with it: this scene is a
      // SINGLETON and a stale wheel handler would scroll a card that is gone.
      this.events.once('shutdown', () => {
        this.input.off('wheel', onWheel);
        this.input.off('pointermove', onMove);
        this.input.off('pointerup', onUp);
        kin.destroy();
        maskShape.destroy();
      });
    }

    // --- beat four: go again. PINNED to the panel, never to the card: it must
    // stay reachable however far the report has been scrolled. ---
    const btnY = Math.min(lastY + 88, top + panelH - 62);
    const btn = this.add.image(cx, btnY, 'btn_yellow').setDisplaySize(300, 76)
      .setAlpha(0).setInteractive({ useHandCursor: true });
    const bt = this.add.text(cx, btnY - 4, 'PLAY AGAIN', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: '#5b3a00',
    }).setOrigin(0.5).setAlpha(0);
    ov.add([btn, bt]);
    const btnAt = 820 + nRows * RECAP.stagger;
    this.tweens.add({ targets: [btn, bt], alpha: 1, duration: 280, delay: btnAt });
    this.tweens.add({
      targets: [btn, bt], y: '-=7', duration: 950, delay: btnAt,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this._endUI.btn = btn;
    // ON RELEASE, NOT ON PRESS (JC bug, 2026-08-06): starting the select scene
    // on pointerDOWN let the same gesture's pointerUP land on whatever hero
    // card had just been dealt under the cursor — which opened that hero's
    // difficulty picker, reading as "the game chose Zelus for me".
    btn.on('pointerup', () => this.scene.start('CharacterSelect'));
    // The recap says what the run DID; the deck says what it BECAME, and that
    // is the half a player wants to screenshot. The run is over and the save is
    // cleared by now, but run.runDeck is still standing in memory — guarded
    // anyway, because an end screen must never be the thing that throws.
    if (run.runDeck?.length) viewDeckButton(this, ov, run);
  }

  // ---------------- Potions (the mat, top-right under the gear) ----------------

  /**
   * Caleb's painted potion mat, laid HORIZONTAL under the settings gear.
   * 290px wide keeps its left edge (x=1606) clear of the widest enemy info
   * stack in a 3-enemy fight, and its 101px height tucks it above the arena.
   * The old 'POTIONS' label is gone — the mat is self-describing.
   */
  buildPotionBelt() {
    // WHERE IT SITS is POT_MAT's business now, not this method's — the cog
    // above it, the boss marquee beside it and the enemy shield chips below it
    // all derive from the same table, so the mat cannot be nudged without the
    // other three following it. (2026-08-10; it used to be two literals here
    // and three hand-measured copies of them elsewhere.)
    this.potMat = { ...POT_MAT };
    const m = this.potMat;
    const mat = this.add.image(m.cx, m.cy, 'potion_mat').setDepth(DEPTH.panel + 1);
    mat.setDisplaySize(m.w, m.w * POTION_MAT.aspect);
    dropShadow(this, mat, MAT_SHADOW).setDepth(DEPTH.panel);
    // Labelled like the ARTIFACTS mat (JC) — obvious at a glance. It was 15px
    // on BOTH builds, which made it the smallest type on a phone HUD whose
    // every sibling label had already been sized up.
    this.add.text(m.cx, m.cy - (m.w * POTION_MAT.aspect) / 2 - 11, 'POTIONS', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${CHROME.potionLabel}px`, color: '#e8d3a4',
      stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(DEPTH.panel + 2);
    this.potionBeltG = this.add.container(0, 0).setDepth(DEPTH.panel + 2);
    this.potTip = null;
    this.renderPotionBelt();
  }

  renderPotionBelt() {
    if (!this.potionBeltG) return;
    this.potionBeltG.removeAll(true);
    this.hidePotionTip();
    const m = this.potMat;
    const spots = potionSpots(m.cx, m.cy, m.w);
    // The bottle is a fraction of the mat it stands on rather than a constant:
    // 0.183 reproduces the shipped 64 on the phone's old 350 mat, gives 70 on
    // its new 380 one, and stops a tablet's narrower mat from being overrun by
    // bottles cut for a wider one.
    const iconSize = MOBILE ? Math.round(m.w * 0.183) : 52;
    // MAT CLEANUP (JC, 2026-08-01): the mat's OWN painted worn circles are the
    // only slot indicators. No empty-slot circle, no rarity ring, no rarity glow
    // disc — a potion just sits on its painted spot, drop-shadowed, and an empty
    // spot is simply an empty painted spot.
    run.potions.slice(0, MAX_POTIONS).forEach((pot, i) => {
      const { x, y, r } = spots[i];
      const aiming = this.potionPicking?.pot === pot;
      const icon = addPotionIcon(this, x, y, pot, iconSize);
      this.potionBeltG.add(icon);
      if (pot.use === 'passive') icon.setAlpha(0.75);
      // The ONE survivor: while a potion is AIMING (pick a card, pick an enemy)
      // it needs to say which bottle is waiting on you, so it keeps a pulsing
      // gold glow behind the glass. That is a transient STATE, not decoration.
      if (aiming) {
        const glow = this.add.image(x, y, 'fx_glow_circle').setTint(0xf0e060)
          .setAlpha(0.7).setDisplaySize(r * 2.1, r * 2.1)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.potionBeltG.addAt(glow, this.potionBeltG.length - 1);
        this.tweens.add({ targets: glow, alpha: 0.25, duration: 300, yoyo: true, repeat: -1 });
      }
      const hit = this.add.circle(x, y, r, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      this.potionBeltG.add(hit);
      hit.on('pointerover', () => { sfx(this, 'menu_select', { volume: 0.2, jitter: 0.06 }); this.showPotionTip(x, y, pot); });
      hit.on('pointerout', () => this.hidePotionTip());
      // TWO STEPS ON TOUCH (JC, 2026-08-04: "if I want to learn about my
      // potion but I accidentally tap too short, boom its gone into the
      // void"). Mobile: the first tap opens the description with a USE plate;
      // tapping anywhere else cancels. Desktop keeps the one-click drink.
      if (MOBILE) tapBind(this, hit, () => this.confirmPotionTap(i, x, y));
      else hit.on('pointerdown', () => this.usePotion(i));
    });
  }

  showPotionTip(x, y, pot) {
    this.hidePotionTip();
    const w = 330, h = 150;
    // The mat hugs the top-right corner, so the tip hangs BELOW it (a tip to
    // the left would land on the rightmost enemy's nameplate in a 3-up fight).
    // On the mobile RAIL the tip steps in off the rail instead, beside its
    // bottle, clamped to the canvas.
    const tx = Phaser.Math.Clamp(x, w / 2 + 10, GAME_W - w / 2 - 10);
    const ty = y + this.potMat.w * POTION_MAT.aspect / 2 + h / 2 + 16;
    const tip = this.add.container(0, 0).setDepth(DEPTH.overlay + 2);
    const parts = woodPanel(this, tx, ty, w, h, { shadow: false, accent: POTION_RARITY[pot.rarity].color });
    tip.add([parts.panel, parts.line]);
    tip.add(this.add.text(tx, ty - h / 2 + 26, pot.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.text,
    }).setOrigin(0.5));
    tip.add(this.add.text(tx, ty - h / 2 + 46, pot.desc, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: w - 40 }, align: 'center',
    }).setOrigin(0.5, 0));
    this.potTip = tip;
  }

  hidePotionTip() { if (this.potTip) { this.potTip.destroy(true); this.potTip = null; } }

  /**
   * THE POTION MAT'S FOOTPRINT AS THE REST OF THE ARENA SEES IT.
   *
   * Read by the enemy shield chip (which mirrors to the other side of a health
   * bar rather than tuck itself under the leather) and by chromeAudit. It used
   * to be two literals inline — `GAME_W - 330` and `hpY < 210` — hand-measured
   * against a mat that has now moved twice, which is exactly the kind of thing
   * that rots in silence.
   *
   *   blockLeft / blockBottom  the leather plus the air a chip needs beside it.
   *     The -16 / +24 are not decoration: on the DESKTOP mat (cx 1751, w 290,
   *     cy 136) they reproduce the shipped pair EXACTLY — 1606-16 = 1590 and
   *     186+24 = 210 — so this rewrite cannot move a single desktop chip.
   *   labelTop  the brass 'POTIONS' band above the leather, which is part of
   *     the mat as far as anything trying to clear it is concerned.
   */
  potMatZone() {
    const m = this.potMat ?? POT_MAT;
    const h = m.w * POTION_MAT.aspect;
    const left = Math.round(m.cx - m.w / 2), right = Math.round(m.cx + m.w / 2);
    const top = Math.round(m.cy - h / 2), bottom = Math.round(m.cy + h / 2);
    return {
      x: m.cx, y: m.cy, w: m.w, h: Math.round(h),
      left, right, top, bottom,
      labelTop: top - 24,
      blockLeft: left - 16, blockBottom: bottom + 24,
    };
  }

  /**
   * THE TWO-STEP TAP (JC, 2026-08-04, mobile): tapping a bottle opens its
   * description with a USE plate; tapping anywhere else lets go. No potion is
   * ever spent by a stray finger.
   *
   * RESTYLED ONTO THE SHARED BOX (2026-08-10). The behaviour is the one that
   * shipped; what changed is that it is no longer its own hand-rolled panel
   * with its own full-screen catcher. It is ui/choicebox, like the relics, the
   * shelves and the Oracle — one idiom, so a player who has learned "tap to
   * read, tap the named button to commit" anywhere has learned it everywhere.
   * The catcher went with it: see choicebox's own note on why a catcher makes
   * browsing cost two taps per option instead of one.
   *
   * `_potConfirm` STAYS, pointing at the open box: tools/verify_mobile.py
   * reads it, and the CANCEL / USE plates are still text objects reading
   * exactly that.
   */
  confirmPotionTap(i, x = null, y = null) {
    const pot = run.potions[i];
    if (!pot) return null;
    this.hidePotionTip();
    const m = this.potMat ?? POT_MAT;
    const spot = potionSpots(m.cx, m.cy, m.w)[i] ?? { x: m.cx, y: m.cy, r: m.w * POTION_MAT.spotRF };
    const ax = x ?? spot.x, ay = y ?? spot.y;
    const usable = pot.use !== 'passive' && potionUsableIn(pot, 'combat');
    // A refusal still has to SAY SO. It used to be written on the dead button
    // itself; it is the box's note now, and the button beside it draws dead.
    const note = pot.use === 'passive'
      ? 'WORKS FROM THE BELT · there is nothing to drink.'
      : usable ? '' : 'NOT IN A FIGHT · this one waits for the road.';
    const box = openChoiceBox(this, {
      key: `potion:${i}:${pot.id}`,
      anchor: { x: ax, y: ay, w: spot.r * 2, h: spot.r * 2 },
      title: pot.name,
      body: personalize(pot.desc),
      note,
      accent: POTION_RARITY[pot.rarity].color,
      depth: DEPTH.overlay + 4,
      buttons: [
        { label: 'USE', kind: 'go', onClick: () => this.usePotion(i), enabled: usable },
        // ...and a spelled-out way back (JC, 2026-08-05): tapping anywhere else
        // still cancels, but a button says so for anyone who wants one.
        { label: 'CANCEL', kind: 'off', onClick: () => {} },
      ],
      // Null it however the box goes away — the button, the tap-away, a new box
      // opening over it, or the scene shutting down. openChoiceBox closes the
      // previous box BEFORE it builds the new one, so this can never null a
      // handle that was just written.
      onClose: () => { this._potConfirm = null; },
    });
    this._potConfirm = box;
    return box;
  }

  /**
   * A BOTTLE IS DRUNK. This is the ONE door every potion in the game goes
   * through — the belt, the confirm box, the merchant's drink and POTION WITHIN
   * A POTION's refill all arrive here — which is why the two 2026-08-10 potion
   * relics both live at this line and nowhere else.
   *
   * THE FAIRY IS OUT, and that is the shipped ruling: defeat()'s revive splices
   * the bottle out directly and deliberately never comes through here, so the
   * BREWER'S THUMB can never save a Fairy in a Bottle. A one-in-four chance to
   * keep the bottle that just un-killed you is a second life on a coin flip,
   * and it is not what a rare is allowed to buy.
   */
  consumePotion(pot) {
    // BREWER'S THUMB, rolled BEFORE the splice. On a keep the bottle simply
    // never leaves the belt — the DRINK has already happened above us either
    // way, so what survives the roll is the glass and never the effect.
    const keep = this.prop('potionKeep');
    const kept = keep > 0 && Math.random() < (this._brewerForce ?? keep);
    const idx = run.potions.indexOf(pot);
    if (kept) {
      for (const a of this.propHolders('potionKeep')) a.state.kept = (a.state.kept ?? 0) + 1;
      popMessage(this, SIDEBAR_W / 2, 560, 'KEPT!', { color: '#d8c8b0', size: 32 });
    } else if (idx >= 0) {
      run.potions.splice(idx, 1);
    }
    sfx(this, drinkSfxKey(pot), { volume: 0.85 });
    this.hidePotionTip();
    this.renderPotionBelt();
    this.refreshAll();
    // BREWMASTER's tally. Counted here, not at usePotion, because this is the
    // line every drink actually goes through, refusals and all having already
    // been turned away above it.
    this._drinksThisFight = (this._drinksThisFight ?? 0) + 1;
    // CORK COLLECTOR strings the cork. Fired on the same line the tally is
    // counted on, for the same reason: this is where a drink is a drink.
    this.artHook('potion', { pot });
    // Every drink is an event, and every event also sweeps the state trophies.
    // THE POTION OF NOTHING is the one exception: it fires its own, late, so
    // the fanfare lands after the joke instead of stepping on it.
    if (pot.effect?.type !== 'nothing') {
      fireAchievements(this, 'drink', { potionId: pot.id, fightDrinks: this._drinksThisFight });
    }
  }

  usePotion(i) {
    const pot = run.potions[i];
    if (!pot || this.busy) return;
    if (this.potionPicking) {
      const wasThis = this.potionPicking.pot === pot;
      this.potionPicking = null;
      this.renderPotionBelt();
      if (wasThis) return;    // clicking the aiming potion again = cancel
    }
    if (!potionUsableIn(pot, 'combat')) {
      this.announce(pot.effect?.type === 'revive' ? 'She waits for the worst...' : 'Not usable here.', '#cfc8e8');
      return;
    }
    const e = pot.effect;
    switch (e.type) {
      case 'shield': {
        const poured = this.addShield(e.value);
        if (poured > 0) {
          sfx(this, 'shield', { volume: 0.8 });
          this.heroShield();
          popNumber(this, 70, 468, `+${poured}`, { color: '#7fe0f4', size: 34 });
        }
        // SHATTERGUARD ate it — addShield already said so, loudly. The potion is
        // still SPENT, which is brutal and is exactly the point of the mechanic.
        this.consumePotion(pot);
        break;
      }
      case 'heal': {
        this.healPlayer(e.value);
        this.consumePotion(pot);
        break;
      }
      case 'discard': {
        this.discardsLeft += e.value;
        popNumber(this, SIDEBAR_W / 2, 520, `+${e.value} DISCARD`, { color: '#a8e8b0', size: 32 });
        this.consumePotion(pot);
        break;
      }
      case 'draw': {
        this.consumePotion(pot);
        this.drawCards(e.value);
        break;
      }
      case 'redraw': {
        this.consumePotion(pot);
        this.redrawHand();
        break;
      }
      case 'cleanse': {
        // THE TEA TAKES THE WHOLE LEDGER. That now includes the 2026-08-02
        // wave — and a TIMED suit seal with it, because it is a debuff on a
        // clock. The Keeper's untimed Eternal Keep is NOT a debuff on a clock
        // and survives the tea, exactly as it always has.
        const timedSeal = (this.pstat.suitSealTurns ?? 0) > 0;
        this.pstat = freshPstat();
        this.rootedPower = ROOTED_STRENGTH;
        if (timedSeal) this.bannedSuit = null;
        for (const c of this.handCards) if (c.lockState === 'frozen') c.setLockState(null);
        this.clearVines();
        this.drawSpikeRing();
        this.resyncDenialLocks();
        this.hypnoActive = false;
        if (this.hypnoCard) { this.hypnoCard.setLockState(null); this.hypnoCard = null; }
        flashVignette(this, 0x88d8a0, 0.4);
        this.heroHeal();
        this.announce('CLEANSED', '#88d8a0');
        this.consumePotion(pot);
        // The roots are gone, so the hand it choked comes back immediately —
        // otherwise the tea's biggest effect would not be visible until the
        // next deal.
        this.dealToHandSize(() => this.refreshAll());
        break;
      }
      case 'handSize': {
        this.tempHandSize += e.value;
        this.announce(`+${e.value} HAND SIZE this fight`, '#e84860');
        this.consumePotion(pot);
        this.dealToHandSize(() => this.refreshAll());
        break;
      }
      case 'nextHandFactor': {
        this.potionNextFactor = e.value;
        this.announce(`Your next hand hits ×${e.value}`, '#d08040');
        this.consumePotion(pot);
        break;
      }
      case 'echoHand': {
        this.potionEcho = true;
        this.announce('Your next hand plays TWICE', '#50e0d0');
        this.consumePotion(pot);
        break;
      }
      case 'damage': {
        this.retargetIfDead();
        const t = this.target;
        if (!t?.alive) return;
        // CLAMPED AT THE LAST RUNG (ENDLESS, 2026-08-05): the damage table is a
        // scalar ladder, and an act index past its end used to fall back to ×1
        // — a Crucible-grade bottle would have gone BACKWARDS in the endless.
        const amount = Math.round(e.value * actTableRung(e.actTable, run.actIndex) * brittleMultiplier(t));
        this.consumePotion(pot);
        sfx(this, 'hit_big', { volume: 0.9 });
        burst(this, t.homeX, t.homeY - 60, 0xff6028, 16);
        this.damageEnemy(t, amount, '#ff8040', 60);
        this.refreshAll();
        this.time.delayedCall(700, () => {
          if (this.livingEnemies().length === 0 && !this.busy) this.fightWon();
        });
        break;
      }
      case 'poison': {
        this.retargetIfDead();
        const t = this.target;
        if (!t?.alive) return;
        const stacks = poisonStacksFor(t.maxHp, e.hpFrac);
        this.consumePotion(pot);
        sfx(this, 'poison', { volume: 0.8 });
        t.statuses.poison = (t.statuses.poison ?? 0) + stacks;
        this.floatText(t, `POISON +${stacks}`, '#60d040');
        this.refreshAll();
        break;
      }
      case 'summonDraw': {
        if (!this.deck.length) { this.announce('Your draw pile is empty.', '#cfc8e8'); return; }
        deckPickerOverlay(this, run, {
          count: 1, optional: true, title: "Summoner's Ink: call a card", sample: 0, cards: this.deck,
        }, (cards) => {
          if (!cards[0]) return;
          this.deck.splice(this.deck.indexOf(cards[0]), 1);
          this.consumePotion(pot);
          this.addCardToHand(cards[0]);
        });
        break;
      }
      case 'dupeHand':
      case 'makeWild': {
        if (!this.handCards.length) { this.announce('No cards in hand.', '#cfc8e8'); return; }
        if (this.usePotionOnSelection(pot, 1)) break;
        this.potionPicking = { pot };
        this.announce(e.type === 'makeWild' ? 'Choose a card to make WILD' : 'Choose a card to duplicate', '#f0e060');
        this.renderPotionBelt();
        break;
      }
      // The mod bottles (Feelin' Lucky Brew / Blood Wax / Phantom Phial): pick
      // TWO cards, one click at a time. `left` rides on the aiming state.
      case 'modCards': {
        if (!this.handCards.length) { this.announce('No cards in hand.', '#cfc8e8'); return; }
        const want = Math.min(e.count ?? 1, this.handCards.length);
        if (this.usePotionOnSelection(pot, want)) break;
        this.potionPicking = { pot, left: want, done: 0 };
        this.announce(`${pot.name}: choose ${want > 1 ? `${want} cards` : 'a card'}`, '#f0e060');
        this.renderPotionBelt();
        break;
      }
      // POTION OF POOF: the card you pick leaves the RUN DECK, not just this
      // fight. Same picking idiom as the other card bottles, including the
      // "it should just work on the card you already lit" shortcut.
      case 'destroyCard': {
        if (!this.handCards.length) { this.announce('No cards in hand.', '#cfc8e8'); return; }
        if (this.usePotionOnSelection(pot, 1)) break;
        this.potionPicking = { pot };
        this.announce('Choose a card to destroy FOREVER', '#c0b8d8');
        this.renderPotionBelt();
        break;
      }
      // LIQUID ICE: a fight-local flag, spent by the very next played hand.
      // Two bottles stack, because nothing about "+10 value" says otherwise.
      case 'handValue': {
        this.potionIceValue = (this.potionIceValue ?? 0) + e.value;
        this.announce(`Your next hand is worth +${this.potionIceValue} value`, '#9fe8ff');
        this.consumePotion(pot);
        this.updatePreview();
        break;
      }
      /**
       * GO-GO GOO. Lights every playable card and then walks the ORDINARY play
       * path: one hand off the clock, one equation, one cascade, one recap
       * entry. The only difference is `_allScore`, which buildScoreState hands
       * to scoreHand and playHand spends immediately.
       *
       * FROZEN and SEALED cards still cannot be played (the goo is a potion,
       * not a dispel), and the Polar Guardian's "exactly five" outranks it —
       * denying is honest, and the bottle is not spent.
       */
      case 'playAll': {
        if (!this.handCards.length) { this.announce('No cards in hand.', '#cfc8e8'); return; }
        if (this.handsLeft <= 0) { this.announce('No hands left on the clock.', '#cfc8e8'); return; }
        const playable = this.handCards.filter(cs => !cs.playLocked);
        if (!playable.length) { this.announce('Nothing in this hand can be played.', '#cfc8e8'); return; }
        if (this.wintersForce && playable.length !== this.winterNeed) return this.denyWinter();
        this.consumePotion(pot);
        for (const cs of this.selected) cs.setSelected(false);
        this.selected = [];
        for (const cs of playable) { cs.setSelected(true); this.selected.push(cs); }
        this.restackHand();
        this._allScore = true;
        this.playHand();
        break;
      }
      // POTION-FLAVORED POTION: the bottle becomes a different one, in its OWN
      // slot, and is NOT drunk. consumePotion is deliberately not called — the
      // belt entry is replaced in place so nothing on the mat shuffles.
      case 'transform': {
        const fresh = transformPotionAt(i, run);
        if (!fresh) { this.announce('Nothing to become.', '#cfc8e8'); return; }
        sfx(this, drinkSfxKey(pot), { volume: 0.7, rate: 1.15 });
        sfx(this, 'minor_upgrade', { volume: 0.7, rate: 1.1 });
        this.hidePotionTip();
        this.renderPotionBelt();
        const spot = potionSpots(this.potMat.cx, this.potMat.cy, this.potMat.w)[i];
        if (spot) burst(this, spot.x, spot.y, POTION_RARITY[fresh.rarity].color, 14);
        this.announce(`IT BECOMES ${fresh.name.toUpperCase()}`, '#d070e8');
        this.refreshAll();
        break;
      }
      /**
       * POTION OF NOTHING. The joke only lands if the game plays it completely
       * straight: the gulp, then silence long enough to be uncomfortable, then
       * one deadpan line and no number anywhere. The fanfare that follows is
       * the ACHIEVEMENT toast, which is the actual payout for buying nothing.
       */
      case 'nothing': {
        this.consumePotion(pot);
        // The silence has a FLOOR. Every other delay in combat is spd()-scaled
        // because it is part of a cadence you want to skip; this one is the
        // joke's timing, and at hand speed 3 an unscaled beat is 370ms, which
        // is not a pause, it is a stutter.
        this.time.delayedCall(Math.max(900, this.spd(1100)), () => {
          this.announce('Nothing happens.', '#b8b0c0');
          this.time.delayedCall(Math.max(450, this.spd(500)), () =>
            fireAchievements(this, 'drink', {
              potionId: pot.id, fightDrinks: this._drinksThisFight ?? 1,
            }));
        });
        break;
      }
      // POTION WITHIN A POTION / PAYDAY BRINE / BANK ERROR STEW — pure run
      // state, so the shared applier in core/potions.js owns them and combat,
      // the map and the merchant's mat all behave identically. The potion is
      // consumed FIRST so its own slot is free for the refill to fill.
      case 'refillBelt':
      case 'chips':
      case 'doubleChips': {
        this.consumePotion(pot);
        const line = applyUniversalEffect(e, run);
        this.announce(`${pot.name.toUpperCase()}: ${line ?? 'nothing happens'}`, '#ffd23e');
        this.renderPotionBelt();
        this.refreshAll();
        break;
      }
    }
  }

  /**
   * IT SHOULD JUST WORK ON THEM (JC, 2026-08-02: "rather than having to
   * reselect them").
   *
   * A card potion that wants N cards, drunk while EXACTLY N are already lit in
   * your hand, spends itself on those N immediately. No picking step, no second
   * round of clicks, no chance to lose the selection you had already made.
   * Anything else (0 lit, too few, too many) is ambiguous, so it falls through
   * to picking mode with what you had still highlighted — which is also why
   * this returns a boolean instead of doing the falling through itself.
   *
   * The pick-2 mod bottles route through the SAME applyCardPick path a manual
   * pick uses, so the "drunk on the FIRST pick" rule is inherited rather than
   * re-implemented: there is exactly one place that spends the bottle.
   *
   * @returns {boolean} true if the potion was applied and the caller is done
   */
  usePotionOnSelection(pot, want) {
    if (want < 1 || this.selected.length !== want) return false;
    // The sprites are captured up front: applying to one of them can rebuild it
    // (makeWild / the mod bottles swap the sprite) and that edits this.selected
    // underneath us. Only the card being applied to is ever replaced, so the
    // later entries in this snapshot stay live.
    const targets = [...this.selected];
    this.potionPicking = want > 1 ? { pot, left: want, done: 0 } : { pot };
    for (const cs of targets) {
      if (!this.potionPicking) break;   // the bottle ran out early
      this.applyCardPick(cs);
    }
    this.potionPicking = null;
    this.renderPotionBelt();
    return true;
  }

  /** A pending potion consumes the next hand-card click (see toggleCard). */
  applyCardPick(cs) {
    const pick = this.potionPicking;
    const { pot } = pick;
    this.potionPicking = null;
    const e = pot.effect;
    if (e.type === 'modCards') return this.applyModCardPick(cs, pick);
    // POTION OF POOF: gone from the hand, gone from the piles, gone from the
    // run deck. Same burn the All-In Visor pays with, same shatter.
    if (e.type === 'destroyCard') {
      if (cs === this.hypnoCard) this.hypnoCard = null;
      this.slicedCards = (this.slicedCards ?? []).filter(c => c.id !== cs.card.id);
      this.burnCardForever(cs.card);
      this.consumePotion(pot);
      this.announce('POOF. Gone from your deck.', '#c0b8d8');
      this.shatterCard(cs);
      this.time.delayedCall(this.spd(420), () => { this.layoutHand(); this.updatePreview(); });
      return;
    }
    if (e.type === 'makeWild') {
      cs.card.mod = 'wild';
      const deckCard = run.runDeck.find(c => c.id === cs.card.id);
      if (deckCard) deckCard.mod = 'wild';
      this.replaceCardSprite(cs);
      this.announce('WILD. Forever.', '#f0e060');
    } else {
      const copy = { ...cs.card, id: `${cs.card.id}#pot${run.counters.handsPlayed}_${this.handCards.length}` };
      if (e.permanent) run.runDeck.push({ ...copy });
      this.addCardToHand(copy, this.handCards.indexOf(cs) + 1, cs);
      this.announce(e.permanent ? 'Duplicated, PERMANENTLY.' : 'Duplicated for this fight.', '#b0c8e0');
    }
    this.consumePotion(pot);
  }

  /**
   * One card of a pick-N mod bottle. The mod lands on the hand card AND on the
   * run deck entry (permanent, exactly like makeWild), and the potion is DRUNK
   * on the first pick — so cancelling half way costs you the rest of the bottle
   * and refunds nothing. If the hand runs out of cards first, that's the bottle.
   */
  applyModCardPick(cs, pick) {
    const { pot } = pick;
    // THE THREE LAYERS. A bottle names the LAYER it pours onto — `mod` rewrites
    // what the card is, `stamp` presses a seal into it, `wrap` lays foil over
    // it — and only ever touches that one, so nothing already on the card is
    // erased. BLOOD WAX is a stamp; the mod bottles are mods.
    const e = pot.effect;
    const layer = e.stamp ? 'stamp' : e.wrap ? 'wrap' : 'mod';
    const value = e.stamp ?? e.wrap ?? e.mod;
    const LABEL = {
      roulette: 'ROULETTE', ethereal: 'ETHEREAL', shiny: 'SHINY',
      blood: 'BLOOD SEALED', mult: 'MULTIPLICATIVE SEAL',
    };
    const TINT = {
      roulette: 0x2e8b57, ethereal: 0x7fe0d0, shiny: 0xbfd8ff,
      blood: 0x8a1830, mult: 0x7a3ab8,
    };
    const label = LABEL[value] ?? String(value).toUpperCase();
    const tint = TINT[value] ?? 0xf0e060;
    cs.card[layer] = value;
    const deckCard = run.runDeck.find(c => c.id === cs.card.id);
    if (deckCard) deckCard[layer] = value;
    const fresh = this.replaceCardSprite(cs);
    if (fresh) burst(this, fresh.x, fresh.y, tint, 14);
    // The bottle is spent the moment it touches the first card.
    if (pick.done === 0) this.consumePotion(pot);
    const done = pick.done + 1;
    const left = pick.left - 1;
    const more = left > 0 && this.handCards.length > 0;
    if (more) {
      this.potionPicking = { pot, left, done };
      this.announce(`${label}: ${left} more card${left > 1 ? 's' : ''}`, '#f0e060');
    } else {
      this.announce(`${label}. Forever.`, '#f0e060');
    }
    this.renderPotionBelt();
  }

  /** Swap a hand sprite for a rebuilt one (after mutating its card, e.g. WILD). */
  replaceCardSprite(cs) {
    const idx = this.handCards.indexOf(cs);
    const nc = new CardSprite(this, cs.x, cs.y, cs.card);
    this.dressNewCard(nc);
    this.input.setDraggable(nc);
    this.handGroup.add(nc);
    this.handCards[idx] = nc;
    this.selected = this.selected.filter(c => c !== cs);
    cs.destroy();
    burst(this, nc.x, nc.y, 0xf0e060, 14);
    this.layoutHand();
    this.updatePreview();
    return nc;
  }

  addCardToHand(card, index = null, near = null) {
    this.quakeTouch(card);
    const cs = new CardSprite(this, near ? near.x : SIDEBAR_W - 80, near ? near.y - 30 : GAME_H + 140, card);
    this.dressNewCard(cs);
    this.input.setDraggable(cs);
    this.handGroup.add(cs);
    if (index === null || index < 0) this.handCards.push(cs);
    else this.handCards.splice(index, 0, cs);
    sfx(this, 'card_deal', { volume: 0.5 });
    this.layoutHand();
    this.refreshAll();
    return cs;
  }

  /** Draw N extra cards beyond hand size (Draught of Focus). */
  drawCards(n) {
    let dealt = 0;
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) this.reshuffleDiscard();
      const card = this.deck.pop();
      if (!card) break;
      this.quakeTouch(card);
      const cs = new CardSprite(this, SIDEBAR_W - 80, GAME_H + 140, card);
      this.dressNewCard(cs);
      this.input.setDraggable(cs);
      this.handGroup.add(cs);
      this.handCards.push(cs);
      dealt++;
    }
    if (dealt > 0) sfx(this, 'card_deal', { volume: 0.77 });
    this.layoutHand(true, dealt);
    this.refreshAll();
  }

  /** Toss the whole hand, deal fresh — no discard spent (Tonic of Clarity). */
  redrawHand() {
    this.hypnoActive = false;
    this.hypnoCard = null;
    for (const cs of [...this.handCards]) { this.discardPile.push(cs.card); cs.destroy(); }
    this.handCards = [];
    this.selected = [];
    this.updatePreview();
    this.dealToHandSize(() => this.refreshAll());
  }

  // ---------------- Intent icons & tooltip ----------------
  static INTENT_ICONS = {
    attack: { key: 'icon_sword_small', tint: 0xffffff },
    buff: { key: 'icon_up', tint: 0xffffff },
    charge: { key: 'icon_hourglass', tint: 0xffffff },
    bleed: { key: 'icon_drop', tint: 0xffffff },
    freeze: { key: 'icon_snow', tint: 0x9adcff },
    brittle: { key: 'icon_shield', tint: 0xd0a040 },
    poison: { key: 'icon_skull', tint: 0x40c050 },
    fear: { key: 'icon_magic', tint: 0xa060e0 },
    hypnotize: { key: 'icon_magic', tint: 0xff70c0 },
    suitban: { key: 'icon_refresh', tint: 0xb080ff },
    // --- the 2026-08-02 mechanics wave ---
    // Every one of these has to read at a glance from across the arena, so they
    // borrow the same glyph their DEBUFF wears in the HUD row.
    rooted: { key: 'fx_leaf', tint: 0x8fe098 },
    courtLock: { key: 'icon_lock', tint: 0xc9a2ff },
    suitSeal: { key: 'fx_wax_seal', tint: 0xb080ff },
    spikes: { key: 'fx_star', tint: 0x8ad4ff },
    shield: { key: 'icon_shield', tint: 0x7fe0f4 },
    stealDiscard: { key: 'icon_trash', tint: 0xff8a70 },
    // --- phase 2 boss signatures ---
    summon: { key: 'icon_skull', tint: 0x9adcff },
    // The dice, not the refresh arrow: the quake is a RANDOMIZER, and the
    // arrow glyph reads a size smaller than every other intent icon.
    quake: { key: 'icon_dice', tint: 0xffb347 },
    slice: { key: 'icon_sword_small', tint: 0xff5060 },
    ward: { key: 'icon_shield', tint: 0x7fe0f4 },
    morphBuff: { key: 'icon_up', tint: 0xb45cff },
    // --- the 2026-08-03 biome wave. Each borrows the glyph its own HUD row
    //     wears, so a telegraph and a debuff never have to be matched up by
    //     colour alone — and every one of the sixteen has an icon, or the
    //     telegraph would silently print nothing at all.
    blind: { key: 'icon_magic', tint: 0x8fa0e8 },
    fade: { key: 'fx_dust', tint: 0xcfd8ee },
    condemn: { key: 'icon_skull', tint: 0xff6a20 },
    burnPlayed: { key: 'icon_fire', tint: 0xff6a20 },
    handTypeOnce: { key: 'icon_lock', tint: 0xffb060 },
    demandHand: { key: 'icon_hourglass', tint: 0xffb060 },
    hangRelic: { key: 'chain_link', tint: 0x8a6a4a },
    wall: { key: 'icon_shield', tint: 0xe8eefc },
    unusedOnly: { key: 'icon_lock', tint: 0xe8eefc },
    forgetSuit: { key: 'icon_refresh', tint: 0xcfd8ee },
    mirrorHand: { key: 'icon_magic', tint: 0xe8eefc },
    shrinkHand: { key: 'fx_dust', tint: 0xcfd8ee },
    dropHand: { key: 'icon_trash', tint: 0xcfd8ee },
    healMirror: { key: 'icon_heart_small', tint: 0xaebeff },
    cardTax: { key: 'icon_fire', tint: 0xff9a50 },
    markCard: { key: 'icon_star', tint: 0xffd23e },
  };

  /**
   * The enemy's telegraph. refreshAll() calls this for every living enemy and
   * runs dozens of times a turn — and a multi-strike hand now runs it up to six
   * times on one hand alone. Rebuilding destroys and re-creates Phaser Text,
   * which measures a font, so it is guarded by a signature exactly like
   * renderArtifactPanel's: the telegraph only actually changes on advanceIntent,
   * a buff, a void ramp, the Bell's silence, or the DEV damage slider — and
   * currentIntent's output captures all five.
   */
  rebuildIntentIcons(enemy) {
    const intent = currentIntent(enemy);
    const sig = `${intent.label}|${intent.effects.map(e => `${e.type}:${e.value}`).join(',')}|${enemy.silenced ? 'S' : ''}`;
    if (sig === enemy._intentSig) return;
    enemy._intentSig = sig;
    enemy.intentIcons.removeAll(true);
    const showsValue = new Set([
      'attack', 'buff', 'bleed', 'freeze', 'poison', 'fear', 'slice',
      // WARDING prints the plate it will lay and SPIKES prints the stacks it
      // will add; the turn-counted denials are always 1 at regular tier and a
      // bare "1" beside a padlock reads as a quantity of locks, not a clock.
      'spikes',
      // BLIND, FADE and CONDEMN count CARDS, so they print the count. The other
      // thirteen biome effects are switches, not quantities.
      ...BIOME_VALUE_EFFECTS,
    ]);
    // SIZE COMES OUT OF INTENT_ART, not out of a literal: the glyph, the
    // numeral and the per-effect advance have to grow together or a two-effect
    // telegraph prints its second icon through its first one's number.
    const R = INTENT_ART.icon / 2;
    const parts = intent.effects.map(e => ({ e, w: showsValue.has(e.type) ? INTENT_ART.wValue : INTENT_ART.wPlain }));
    const totalW = parts.reduce((s, p) => s + p.w, 0);
    let x = -totalW / 2;
    for (const { e, w } of parts) {
      const def = CombatScene.INTENT_ICONS[e.type] ?? CombatScene.INTENT_ICONS.attack;
      // Plate-free icons: a soft cast shadow keeps them readable on any backdrop.
      const shadow = this.add.image(x + R + 3, 4, def.key).setTint(0x140c08).setAlpha(0.55);
      shadow.setScale(INTENT_ART.icon / Math.max(shadow.width, shadow.height));
      const icon = this.add.image(x + R, 0, def.key).setTint(def.tint);
      icon.setScale(INTENT_ART.icon / Math.max(icon.width, icon.height));
      enemy.intentIcons.add(shadow);
      enemy.intentIcons.add(icon);
      if (showsValue.has(e.type)) {
        const t = this.add.text(x + INTENT_ART.icon + 4, 0, `${e.value}`, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: `${INTENT_ART.numSize}px`,
          color: '#fff6e0', stroke: '#241505', strokeThickness: 7,
        }).setOrigin(0, 0.5);
        t.setShadow(2, 4, '#000000', 6);
        enemy.intentIcons.add(t);
      }
      x += w;
    }
    // THE HUSHED BELL's mark: the telegraph goes ghostly and takes a stamp
    // across it, so a silenced turn is legible from across the arena.
    if (enemy.silenced) {
      for (const o of enemy.intentIcons.list) o.setAlpha?.(0.22);
      const bar = this.add.rectangle(0, 0, Math.max(150, totalW + 26), 5, 0x9adcff, 0.9).setAngle(-7);
      const stamp = this.add.text(0, 0, 'SILENCED', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${INTENT_ART.stampSize}px`, color: '#d8f2ff',
        stroke: '#0d2c3d', strokeThickness: 7,
      }).setOrigin(0.5).setAngle(-7);
      stamp.setShadow(2, 4, '#000000', 6);
      enemy.intentIcons.add(bar);
      enemy.intentIcons.add(stamp);
    }
  }

  showIntentTip(enemy) {
    this.hideIntentTip();
    const intent = currentIntent(enemy);
    const sig = this.signature(enemy);
    // THE SIGNATURE COMES FIRST. It is a passive — it never appears in the
    // effect list — so without this line the one rule that shapes the whole
    // fight would be the only thing the intent hover did not explain.
    const lines = [
      ...(sig ? [`◆  ${sig.rule}`, ''] : []),
      ...intent.effects.map(e => '•  ' + describeEffect(e)),
    ].join('\n');
    const tip = this.add.container(0, 0).setDepth(DEPTH.overlay + 3);
    const title = this.add.text(0, 0, sig ? `${intent.label}   (${sig.name})` : intent.label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.text,
    }).setOrigin(0.5, 0);
    const body = this.add.text(0, 30, lines, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: 360 }, lineSpacing: 4,
    }).setOrigin(0.5, 0);
    const h = 30 + body.height + 28;
    const w = Math.max(title.width, body.width) + 48;
    const parts = woodPanel(this, 0, h / 2 - 6, w, h, { shadow: true });
    tip.add([parts.shadow, parts.panel, title, body]);
    const tx = Phaser.Math.Clamp(enemy.homeX, SIDEBAR_W + w / 2 + 10, GAME_W - w / 2 - 10);
    // A marquee boss's name lives at the top of the screen — anchoring above
    // it would push the tip off the canvas, so it hangs under the intent row
    // (over the art, but it is a hover and the art is what you are reading it
    // about). Everyone else keeps the above-the-name placement.
    const ty = enemy.bossBar
      ? (enemy.intentY ?? 160) + 42
      : Math.max(14, (enemy.uiName?.y ?? 120) - h - 46);
    tip.setPosition(tx, ty);
    this.intentTip = tip;
  }

  hideIntentTip() {
    if (this.intentTip) { this.intentTip.destroy(true); this.intentTip = null; }
  }

  /**
   * Breathing edge-vignette (screen border glow). Returns the bars.
   * `repeat` = -1 loops forever (caller owns teardown, e.g. lowHpVignette);
   * a finite repeat count self-destroys the bars once the pulses finish —
   * used for one-shot entrance flashes.
   */
  makeEdgeVignette(color, aFrom, aTo, duration, depth = DEPTH.fx + 1, repeat = -1) {
    // fx_glow is a small radial-fade texture (bright core only in its middle
    // band); anchoring bars ON the viewport edge (rather than just past it)
    // keeps that bright core on-screen instead of bleeding it out entirely.
    const bars = [
      this.add.image(GAME_W / 2, 0, 'fx_glow').setDisplaySize(GAME_W * 1.4, 240),
      this.add.image(GAME_W / 2, GAME_H, 'fx_glow').setDisplaySize(GAME_W * 1.4, 240),
      this.add.image(0, GAME_H / 2, 'fx_glow').setDisplaySize(260, GAME_H * 1.4),
      this.add.image(GAME_W, GAME_H / 2, 'fx_glow').setDisplaySize(260, GAME_H * 1.4),
    ];
    for (const b of bars) {
      b.setTint(color).setAlpha(aFrom).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);
      this.tweens.add({
        targets: b, alpha: aTo, duration, yoyo: true, repeat, ease: 'Sine.easeInOut',
        onComplete: repeat >= 0 ? () => b.destroy() : undefined,
      });
    }
    return bars;
  }

  /**
   * Re-seat the heartbeat loop on the CURRENT sfx bus level. Called by
   * core/sfx.refreshSfxVolume the moment a volume row moves, and once more from
   * updateHeartbeat so a fade that is still in flight cannot land on the old
   * number after the slider has already moved past it.
   */
  applyHeartbeatVolume() {
    if (!this.heartbeat) return;
    this.tweens.killTweensOf(this.heartbeat);
    this.heartbeat.setVolume(HEARTBEAT_VOLUME * sfxBusVolume());
  }

  /** Low-health heartbeat loop — pulses under everything while you're in danger. */
  updateHeartbeat() {
    const frac = this.player.hp / this.player.maxHp;
    const low = this.player.hp > 0 && frac < 0.3;
    // Two-stage red border: a punchy pulse under 30% HP; a faint slow breath
    // that lingers from 30% all the way up to full HP as a reminder you're hurt.
    const mode = low ? 'strong' : (this.player.hp > 0 && frac < 1 ? 'faint' : null);
    if (mode !== this.lowHpMode) {
      if (this.lowHpVignette) {
        const bars = this.lowHpVignette;
        this.lowHpVignette = null;
        for (const b of bars) {
          this.tweens.killTweensOf(b);
          this.tweens.add({ targets: b, alpha: 0, duration: 500, onComplete: () => b.destroy() });
        }
      }
      if (mode === 'strong') this.lowHpVignette = this.makeEdgeVignette(0xd82838, 0.10, 0.45, 620);
      else if (mode === 'faint') this.lowHpVignette = this.makeEdgeVignette(0xd82838, 0.03, 0.09, 2400);
      this.lowHpMode = mode;
    }
    // Heartbeat sfx stays gated strictly to the <30% "strong" tier.
    if (low && !this.heartbeat) {
      if (!this.cache.audio.exists('sfx_heartbeat')) return;
      this.heartbeat = this.sound.add('sfx_heartbeat', { loop: true, volume: 0 });
      this.heartbeat.play();
      this.tweens.add({ targets: this.heartbeat, volume: HEARTBEAT_VOLUME * sfxBusVolume(), duration: 600 });
      // THE SLIDER IS LIVE (2026-08-06). This loop can run for a whole fight,
      // so it re-reads the SFX bus whenever a volume row moves rather than
      // keeping the level it happened to start at. Registered once per scene
      // (see buildScene) — this is the callback it fires.
      this.events.once('shutdown', () => { this.heartbeat?.stop(); this.heartbeat?.destroy(); this.heartbeat = null; });
    } else if (!low && this.heartbeat) {
      const hb = this.heartbeat;
      this.heartbeat = null;
      this.tweens.add({ targets: hb, volume: 0, duration: 500, onComplete: () => { hb.stop(); hb.destroy(); } });
    }
  }

  // ---------------- Refresh ----------------
  // ---------------- Player debuff readout ----------------

  /**
   * Every debuff currently riding the player, in row order, each carrying the
   * exact sentence its tooltip shows. The numbers are read LIVE off pstat /
   * the hand, so "BLEED 3" always says it costs 3 — never a stale rule.
   */
  pstatEntries() {
    const frozen = this.handCards?.filter(c => c.lockState === 'frozen').length ?? 0;
    const banned = this.bannedSuit ? this.bannedSuit.toUpperCase() : '';
    const out = [];
    if (this.pstat.bleed > 0) {
      out.push({
        key: 'icon_drop', tint: 0xffffff, n: this.pstat.bleed, accent: DEBUFF_COLORS.bleed,
        title: `BLEED ${this.pstat.bleed}`,
        desc: `Playing a hand costs you ${this.pstat.bleed} HP. Fades by 1 each hand you play.`,
      });
    }
    if (this.pstat.poison > 0) {
      out.push({
        key: 'icon_skull', tint: 0x40c050, n: this.pstat.poison, accent: DEBUFF_COLORS.poison,
        title: `POISON ${this.pstat.poison}`,
        desc: `You lose ${this.pstat.poison} HP at the end of every round. Fades by 1 each round.`,
      });
    }
    if (this.pstat.brittle > 0) {
      out.push({
        key: 'icon_shield', tint: 0xd0a040, n: '', accent: DEBUFF_COLORS.brittle,
        title: 'BRITTLE', desc: 'You take +50% damage from every attack this turn.',
      });
    }
    if (this.pstat.fear > 0) {
      out.push({
        key: 'icon_magic', tint: 0xa060e0, n: this.pstat.fear, accent: DEBUFF_COLORS.fear,
        title: `FEAR ${this.pstat.fear}`,
        desc: `You may select ${this.fearBite} fewer card${this.fearBite > 1 ? 's' : ''}: ${this.maxSelectable} max this turn`
          + `${this.pstat.fear > FEAR_CAP ? ` (Fear never costs more than ${FEAR_CAP} cards, however many stacks land)` : ''}.`
          + ' Clears when the round ends.',
      });
    }
    if (frozen > 0) {
      out.push({
        key: 'icon_snow', tint: 0x8ad4ff, n: frozen, accent: DEBUFF_COLORS.freeze,
        title: `FROZEN ${frozen}`,
        desc: `${frozen} card${frozen > 1 ? 's' : ''} in your hand cannot be selected or played. They thaw when the enemies next act.`,
      });
    }
    if (this.hypnoActive) {
      out.push({
        key: 'boss_icon_wolfowl', tint: 0xffffff, n: '', accent: DEBUFF_COLORS.hypnotize,
        title: 'HYPNOTIZED',
        desc: 'The gaze forces one card of your hand into play. It cannot be deselected until you play or discard.',
      });
    }
    if (this.bannedSuit) {
      // The SAME row entry for the Keeper's forever-seal and a regular's
      // one-turn one; the clock (and the wax blob that cracks off when it runs
      // out) is the only difference the player has to read.
      const turns = this.pstat.suitSealTurns ?? 0;
      out.push({
        key: SUIT_PIP_KEY[this.bannedSuit], tint: 0x8050c0, n: turns > 0 ? `${turns}` : '✕',
        accent: turns > 0 ? DEBUFF_COLORS.suitSeal : DEBUFF_COLORS.suitban,
        wax: turns > 0,
        title: `SEALED: ${banned}`,
        desc: turns > 0
          ? `${banned} cards cannot be selected or played for ${turns} more turn${turns > 1 ? 's' : ''}. You may still DISCARD them.`
          : `${banned} cards cannot be selected or scored until The Keeper respins the wheel. You may still DISCARD them.`,
      });
    }
    // --- the 2026-08-02 mechanics wave ---
    if (this.pstat.rooted > 0) {
      const n = this.rootedPenalty;
      out.push({
        key: 'fx_leaf', tint: 0x8fe098, n: `-${n}`, accent: DEBUFF_COLORS.rooted,
        title: `ROOTED ${this.pstat.rooted === Infinity ? '' : this.pstat.rooted}`.trim(),
        desc: `Vines choke your draw: your hand is dealt ${n} card${n > 1 ? 's' : ''} smaller `
          + `(${this.effectiveHandSize} instead of ${this.player.handSize})`
          + `${this.pstat.rooted === Infinity ? ' for the whole fight' : ` for ${this.pstat.rooted} more turn${this.pstat.rooted > 1 ? 's' : ''}`}.`,
      });
    }
    if (this.pstat.courtLock > 0) {
      const held = this.handCards?.filter(c => isFaceCard(c.card)).length ?? 0;
      out.push({
        key: 'icon_lock', tint: 0xc9a2ff, n: this.pstat.courtLock === Infinity ? '✕' : `${this.pstat.courtLock}`,
        accent: DEBUFF_COLORS.courtLock,
        title: 'COURT ADJOURNED',
        desc: 'Every FACE card (J, Q and K) cannot be selected or played'
          + `${this.pstat.courtLock === Infinity ? '' : ` for ${this.pstat.courtLock} more turn${this.pstat.courtLock > 1 ? 's' : ''}`}. `
          + `You may still DISCARD them. ${held} in your hand right now.`,
      });
    }
    if (this.pstat.spikes > 0) {
      out.push({
        key: 'fx_star', tint: 0x8ad4ff, n: this.pstat.spikes, accent: DEBUFF_COLORS.spikes,
        title: `SPIKES ${this.pstat.spikes}`,
        desc: `Every hand you play drives the thorns in for ${this.pstat.spikes} damage. `
          + 'Shield absorbs it. They never fade on their own, so end the fight or drink.',
      });
    }
    // --- the 2026-08-03 biome wave ---
    // BLIND (draw-time since 0804): the clock is the story; the count of dark
    // cards currently held rides the badge as its number.
    if ((this.pstat.blind ?? 0) > 0) {
      const held = this.handCards?.filter(c => c.blinded).length ?? 0;
      const turns = this.pstat.blind;
      out.push({
        key: 'icon_magic', tint: 0x4c5aa8, n: `${held}`, accent: DEBUFF_COLORS.blind,
        title: `BLINDED ${held}`,
        desc: 'Cards you DRAW arrive face down. They are STILL PLAYABLE: you simply cannot read them until they land. '
          + `${held} in your hand right now. `
          + `${turns === Infinity ? 'For the whole fight.' : `The moonlight lets go in ${turns} turn${turns > 1 ? 's' : ''}.`}`,
      });
    }
    // FADE: the ethereal risk with the ethereal reward taken away.
    if ((this.pstat.faded ?? []).length) {
      const n = this.pstat.faded.length;
      const inHand = this.handCards?.filter(c => c.faded).length ?? 0;
      out.push({
        key: 'icon_star', tint: 0x6a7a9c, n: `${n}`, accent: DEBUFF_COLORS.fade,
        title: `FADED ${n}`,
        desc: `${n} card${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} ETHEREAL for this fight and ${n === 1 ? 'pays' : 'pay'} NO bonus mult for it. `
          + `Every time one SCORES it rolls a ${Math.round(etherealVanishChance(run) * 100)}% chance to vanish from your deck forever. `
          + `${inHand} in your hand right now.`,
      });
    }
    // BURNED: the ledger, and what it has already eaten.
    if (this.burnedCards?.size) {
      const held = this.handCards?.filter(c => isBurned(this.burnedCards, c.card)).length ?? 0;
      out.push({
        key: 'icon_fire', tint: 0xc83c08, n: `${this.burnedCards.size}`, accent: DEBUFF_COLORS.burned,
        title: `BURNED ${this.burnedCards.size}`,
        desc: `${this.burnedCards.size} card${this.burnedCards.size === 1 ? '' : 's'} cannot be played again this fight: `
          + 'not after a discard, and not after the discard pile reshuffles. '
          + `${held} of them ${held === 1 ? 'is' : 'are'} in your hand right now. You may still discard them.`,
      });
    }
    // DOUBLE JEOPARDY: the docket, and what is left on it.
    if (this.handTypeOnce) {
      const left = remainingHandTypes(this.usedHandTypes);
      // THE DOCKET NAMES FIVE AND SAYS SO. It used to print five and stop, so a
      // tooltip reading "11 still open: High Card · Pair · Two Pair · Three of a
      // Kind · Straight." looked like a complete list of eleven things.
      const named = left.slice(0, 5).map(t => HAND_DEFS[t].name).join(' · ');
      const rest = left.length > 5 ? `, and ${left.length - 5} more` : '';
      out.push({
        key: 'icon_lock', tint: 0xa85c10, n: `${left.length}`, accent: DEBUFF_COLORS.courtLock,
        title: 'DOUBLE JEOPARDY',
        desc: `Each hand type may be played ONCE this fight. ${this.usedHandTypes.size} spent, ${left.length} still open`
          + `${left.length ? `: ${named}${rest}` : ''}. `
          + 'If nothing your hand can form is still legal, a MISTRIAL clears the whole ledger.'
          + (this._mistrials ? ` (${this._mistrials} so far.)` : ''),
      });
    }
    // THE SENTENCE: what you have been ordered to play, this turn.
    if (this.demandedHand) {
      out.push({
        key: 'icon_hourglass', tint: 0xa85c10, n: '!', accent: DEBUFF_COLORS.courtLock,
        title: 'THE SENTENCE',
        desc: `You must play a ${HAND_DEFS[this.demandedHand]?.name ?? 'named hand'} this turn. `
          + `Play anything else and it costs you ${DEMAND_HAND_DAMAGE} HP.`,
      });
    }
    // THE QUEUE: relics doing nothing, and which ones.
    if (this.disabledRelics?.size) {
      const names = [...this.disabledRelics].map(i => run.artifacts[i]?.name).filter(Boolean);
      out.push({
        key: 'chain_link', tint: 0x5c4028, n: `${this.disabledRelics.size}`, accent: DEBUFF_COLORS.burned,
        title: 'HANGED',
        desc: `${names.join(', ') || 'A relic'} ${names.length === 1 ? 'does' : 'do'} nothing for the rest of this fight. `
          + 'They keep their place in the row, so the order of everything else is unchanged, and so is every mirror pointed at them.',
      });
    }
    // PYRE TAX: the toll, live.
    if ((this.cardTaxRate ?? 0) > 0) {
      out.push({
        key: 'icon_fire', tint: 0xc86a10, n: `${this.cardTaxRate}`, accent: DEBUFF_COLORS.burned,
        title: 'PYRE TAX',
        desc: `Every hand you play costs ${this.cardTaxRate} HP per card in it, so a full five-card hand costs `
          + `${cardTaxFor(5, this.cardTaxRate)}. Shield absorbs it like any damage.`,
      });
    }
    // WEIGHTLESS: the reason to empty your hand.
    if (this.dropHandOn) {
      out.push({
        key: 'icon_up', tint: 0x6a7a9c, n: '', accent: DEBUFF_COLORS.fade,
        title: 'WEIGHTLESS',
        desc: 'Every card left in your hand at the end of a turn drifts away and is gone for this fight.',
      });
    }
    // THE HANGMAN'S BRAND: which cards, and how long they have.
    if (this.condemnBrands?.length) {
      const soonest = Math.min(...this.condemnBrands.map(b => b.turns));
      out.push({
        key: 'icon_skull', tint: 0xc83c08, n: `${this.condemnBrands.length}`, accent: DEBUFF_COLORS.burned,
        title: `CONDEMNED ${this.condemnBrands.length}`,
        desc: `${this.condemnBrands.length} card${this.condemnBrands.length === 1 ? '' : 's'} branded. `
          + `PLAY ${this.condemnBrands.length === 1 ? 'it' : 'them'} within ${soonest} turn${soonest === 1 ? '' : 's'} `
          + 'or they burn out of your DECK for good. Discarding does not save them.',
      });
    }
    // HE SEES IT COMING: which card is the trap, and what springing it costs.
    if (this.markedCardId) {
      const marked = this.handCards?.find(c => c.card.id === this.markedCardId);
      const what = marked
        ? `${rankLabel(marked.card.rank)} of ${SUIT_GLYPH[marked.card.suit] ?? marked.card.suit}`
        : 'A card';
      out.push({
        key: 'icon_star', tint: 0xc09010, n: '!', accent: 0xffd23e,
        title: 'MARKED',
        desc: `${what} is marked: his eye finds the highest-VALUE card in your hand. `
          + 'Play it and your whole hand deals NOTHING. A fresh card is marked every turn.',
      });
    }
    // REWEAVE: the hand that keeps getting smaller.
    if ((this.handShrink ?? 0) > 0) {
      out.push({
        key: 'icon_refresh', tint: 0x6a7a9c, n: `-${this.handShrink}`, accent: DEBUFF_COLORS.fade,
        title: 'REWEAVE',
        desc: `Your hand is dealt ${this.handShrink} card${this.handShrink === 1 ? '' : 's'} smaller `
          + `(${this.effectiveHandSize} instead of ${this.player.handSize}) for the rest of this fight.`,
      });
    }
    // PASSIVE BOSS AURAS. They carry no intent icon (nothing "casts" them), so
    // the debuff row is where they get their hover sentence.
    //
    // E1 SHATTERGUARD joins them: it is a thing done TO the player for the whole
    // fight, so it belongs in the player's own ledger and not only on the
    // Titan's badge. (DREAD GRIP does not need a row of its own — it IS the
    // ROOTED row above, at Infinity turns and power 2, which is the entire
    // reason it was built on that door.)
    if (this.shatterguard) {
      const lost = this._shatteredTotal ?? 0;
      out.push({
        key: 'icon_shield', tint: 0x9adcff, n: '0', accent: DEBUFF_COLORS.freeze,
        title: 'SHATTERGUARD',
        desc: 'You gain NO Shield at all for the whole fight. The Frost Titan broke the idea of plate, and killing it does not put it back. Every hand, relic and potion that would armour you is shattered to ◆0.'
          + (lost > 0 ? ` ${fmtNum(lost)} points of Shield shattered so far.` : ''),
      });
    }
    if (this.bossHandPenalty > 0) {
      out.push({
        key: 'boss_icon_fairy_king', tint: 0xffffff, n: `-${this.bossHandPenalty}`, accent: 0x6fdc7f,
        title: 'ROOTED',
        desc: `The Fairy King's roots choke your draw: your hand is dealt ${this.bossHandPenalty} cards smaller (${this.effectiveHandSize} instead of ${this.player.handSize}) for the whole fight.`,
      });
    }
    if (this.wintersForce) {
      out.push({
        key: 'boss_icon_polar_guardian', tint: 0xffffff, n: `${this.winterNeed}`, accent: DEBUFF_COLORS.freeze,
        title: "WINTER'S FORCE",
        desc: `The Guardian accepts nothing but a full hand: you may only play hands of EXACTLY ${this.winterNeed} cards. Discarding is unaffected.`,
      });
    }
    // ONE LEDGER, TWO STORIES (JC, 2026-08-04): Agatha's slice and the
    // Unmade's drift share slicedCards (same rules: gone this fight, back next
    // shuffle), but the badge has to name the boss that actually did it.
    if (this.slicedCards?.length) {
      const drifted = this.slicedCards.filter(c => this._driftedIds?.has(c.id)).length;
      const cut = this.slicedCards.length - drifted;
      if (cut > 0) {
        out.push({
          key: 'boss_icon_daughters', tint: 0xffffff, n: cut, accent: 0xff5060,
          title: 'CUT AWAY',
          desc: `Agatha has cut ${cut} card${cut > 1 ? 's' : ''} out of this fight. They are not destroyed. The next fight's shuffle brings them back.`,
        });
      }
      if (drifted > 0) {
        out.push({
          key: 'boss_icon_the_unmade', tint: 0xffffff, n: drifted, accent: DEBUFF_COLORS.fade,
          title: 'VANISHED',
          desc: `${drifted} card${drifted > 1 ? 's' : ''} drifted away, gone for this fight. `
            + 'They are not destroyed. The next fight\'s shuffle brings them back.',
        });
      }
    }
    // The row has to fit inside a 340px sidebar, and the 2026-08-02 wave took
    // the worst case from seven to eleven — so the spacing is DERIVED from the
    // count against the panel's real width rather than stepped by hand. The
    // three original tiers are preserved exactly at 4, 5 and 6+ so nothing that
    // already read well moved.
    //
    // ...AND THE FLOOR HAD TO GO (2026-08-04 copy pass). The `Math.max(28, ...)`
    // above overrode the derived spacing the moment the derived spacing dropped
    // below 28, which is exactly the case it existed to handle: from TWELVE
    // entries up, the last badges walked off the parchment and onto the battle
    // art. The biome wave took the worst case from eleven to fifteen (BLINDED,
    // FADED, BURNED, DOUBLE JEOPARDY, THE SENTENCE, HANGED, PYRE TAX,
    // WEIGHTLESS, CONDEMNED, MARKED and REWEAVE all stack), so it is reachable.
    // The gap is now the room that actually exists and the icon shrinks WITH it
    // rather than through it. Counts 4 to 10 land on exactly the pixels they
    // did; 11 tightens by 2px a step; 12 and up finally fit at all.
    const n = out.length;
    const x0 = n >= 6 ? 38 : 46;
    const gap = n >= 7 ? Math.floor((SIDEBAR_W - x0 - 16) / n)
      : n >= 6 ? 46 : n === 5 ? 56 : 62;
    const size = Math.min(gap - 2,
      n >= 8 ? 18 : n >= 7 ? 20 : n >= 6 ? 22 : n === 5 ? 26 : 28);
    out.forEach((en, i) => { en.x = x0 + i * gap; en.size = size; en.gap = gap; });
    return out;
  }

  /** Parchment mini-panel on hover — same idiom as the potion belt tips. */
  showPstatTip(en) {
    this.hidePstatTip();
    const w = 336;
    const tip = this.add.container(0, 0).setDepth(DEPTH.overlay + 2);
    const title = this.add.text(0, 0, en.title, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.text,
    }).setOrigin(0.5, 0);
    const body = this.add.text(0, 28, en.desc, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '17px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: w - 44 }, align: 'center', lineSpacing: 2,
    }).setOrigin(0.5, 0);
    const h = 28 + body.height + 30;
    const parts = woodPanel(this, 0, h / 2 - 8, w, h, { shadow: true, accent: en.accent });
    tip.add([parts.shadow, parts.panel, parts.line, title, body]);
    tip.setPosition(Math.max(w / 2 + 10, en.x), 500 - h - 34);
    this.pstatTip = tip;
  }

  hidePstatTip() { if (this.pstatTip) { this.pstatTip.destroy(true); this.pstatTip = null; } }

  refreshAll() {
    const p = this.player;
    // UNTOUCHED (achievement): the lowest HP this fight ever saw. Tracked here
    // rather than in damagePlayer because bleed, poison and an attack all cost
    // HP through different doors, and every one of them refreshes afterwards.
    this._minHpThisFight = Math.min(this._minHpThisFight ?? p.hp, p.hp);
    this.updateHeartbeat();
    const hpFrac = Phaser.Math.Clamp(p.hp / p.maxHp, 0, 1);
    this.hpBarFill.width = (SIDEBAR_W - 64) * hpFrac;
    this.hpBarFill.setFillStyle(hpFrac < 0.3 ? 0xd82838 : hpFrac < 0.5 ? 0xe8a03c : COLORS.hp);
    this.hpText.setText(`${p.hp} / ${p.maxHp}`);
    this.shieldText.setText(`${p.shield}`);
    // THE INFINITE HEART's uncap is the whole reason to want the relic, so the
    // readout says so: 'ZEAL 84 / ∞' instead of a number nobody can size.
    // ...and the test is isInfinite(), not `=== Infinity`: zealCapFor answers
    // INFINITY_CAP (1e30) since 0810, so an identity check against Infinity is
    // never true and the sidebar printed the literal 'ZEAL 84 / 1e+30'.
    const zCap = this.chr.id === 'zealot' ? this.zealCap() : ZEAL_CAP;
    this.resourceText.setText(this.chr.id === 'zealot'
      ? `ZEAL ${p.zeal} / ${isInfinite(zCap) ? '∞' : zCap}` : '');
    const free = this.prop('freeDiscards') > 0;
    this.discardText.setText(free ? 'Discards: ∞' : `Discards: ${this.discardsLeft}`);
    this.deckText.setText(`Deck: ${this.deck.length}`);
    const roomLabel = this.node.type === 'elite' && this.node.forged ? 'FORGED ELITE'
      : ({ fight: 'Fight', elite: 'ELITE', boss: 'BOSS' }[this.node.type] ?? 'Fight');
    // ENDLESS: "Act I" on a run four acts past the finale is a lie the sidebar
    // is not allowed to tell, so the lap goes in front of it. The line already
    // squeezes to fit (below), which is what pays for the extra word.
    const actLabel = isEndlessIndex(run.actIndex)
      ? `L${endlessLoop(run.actIndex)} · Act ${this.act.numeral}`
      : `Act ${this.act.numeral}`;
    this.stageText.setText(`${actLabel} · ${roomLabel} · Floor ${Math.min(this.node.row + 1, 99)}`);
    // "Act II · FORGED ELITE · Floor 4" runs off the 340px sidebar — the line
    // squeezes to fit rather than clipping (JC, 2026-08-04).
    this.stageText.setScale(1);
    const stageRoom = SIDEBAR_W - (this.stageText.x + 26);
    if (this.stageText.width > stageRoom) this.stageText.setScale(stageRoom / this.stageText.width);
    this.chipsText.setText(`Chips: ${run.chips}`);
    const left = this.handsLeft;
    this.handsText.setText(`Hands left: ${left}`);
    this.handsText.setColor(left <= 1 ? '#a8121e' : left <= 3 ? '#a35c0c' : PARCH.text);
    // No eleventh hand through any path — the button dies with the clock.
    // Under WINTER'S FORCE the gate owns the button outright (one writer, or
    // the two of them fight and the button flickers every refresh).
    if (this.wintersForce) this.updateWinterGate();
    else this.setPlayEnabled(left > 0 && !this.sealedSelected());
    this.checkSealDeadlock();
    this.renderArtifactPanel();
    this.syncActiveTags();

    this.enemies?.forEach((enemy, i) => {
      if (!enemy.alive) { enemy.targetRing.setAlpha(0); return; }
      const frac = Phaser.Math.Clamp(enemy.hp / enemy.maxHp, 0, 1);
      enemy.hpFill.width = enemy.hpBarW * frac;
      enemy.hpText.setText(`${fmtNum(enemy.hp)} / ${fmtNum(enemy.maxHp)}`);
      this.rebuildIntentIcons(enemy);
      for (const key of ['poison', 'bleed', 'brittle']) {
        const s = enemy.statuses[key] ?? 0;
        // Present only while it is real — a zero-stack ghost is arena clutter.
        enemy.statusUI[key].icon.setAlpha(s > 0 ? 1 : 0);
        enemy.statusUI[key].text.setAlpha(s > 0 ? 1 : 0).setText(s > 0 ? `${fmtNum(s)}` : '');
      }
      // ◆N shield chip: present only while there is a pool to spend.
      const sh = enemy.shield ?? 0;
      enemy.shieldIcon?.setAlpha(sh > 0 ? 1 : 0);
      enemy.shieldText?.setAlpha(sh > 0 ? 1 : 0).setText(sh > 0 ? `${fmtNum(sh)}` : '');
      // An IMMUNE boss reads as unreachable: the nameplate goes dim. (The
      // target ring is owned by syncTargetIndicators now — one writer.)
      const immune = !!enemy.immune;
      enemy.uiName.setAlpha(immune ? 0.45 : 1);
      // CUT AND RUN's numeral over its head.
      this.syncFleeUI(enemy);
      // ...and the ELITE/BOSS signature badge under its intent row.
      this.syncSignatureBadge(enemy);
    });
    // ...and the thorn ring around the hero portrait (a no-op when the count
    // has not moved — refreshAll runs on every damage number).
    this.drawSpikeRing();

    if (this.pstatUI) {
      this.pstatUI.removeAll(true);
      this.hidePstatTip();
      for (const en of this.pstatEntries()) {
        // A TIMED suit seal wears a blob of wax behind its pip — the same
        // language the BLOOD SEAL uses on a card, so "sealed" looks like
        // "sealed" wherever it appears.
        const waxed = en.wax && this.textures.exists('fx_wax_seal');
        if (waxed) {
          const wax = this.add.image(en.x, 500, 'fx_wax_seal').setTint(0x6a3aa8).setAlpha(0.95);
          wax.setScale((en.size * 1.7) / Math.max(wax.width, wax.height));
          this.pstatUI.add(wax);
        }
        // A violet pip on a violet blob is invisible; struck wax reads PALE.
        const icon = this.add.image(en.x, 500, en.key).setTint(waxed ? 0xf4ecff : en.tint);
        icon.setScale(en.size / Math.max(icon.width, icon.height));
        this.pstatUI.add(icon);
        if (en.n !== '') {
          this.pstatUI.add(this.add.text(en.x + en.size * 0.6, 500, `${en.n}`, {
            fontFamily: 'Lilita One', resolution: 2,
            fontSize: `${Math.round(en.size * 0.72)}px`, color: PARCH.text,
          }).setOrigin(0, 0.5));
        }
        // Sub-30px icons are far too small to aim at, so every debuff carries a
        // generous invisible hit box that owns the icon AND its counter.
        const hit = this.add.rectangle(en.x + en.gap / 2 - 12, 500, en.gap, 52, 0x000000, 0)
          .setInteractive({ useHandCursor: true });
        hit.on('pointerover', () => this.showPstatTip(en));
        hit.on('pointerout', () => this.hidePstatTip());
        this.pstatUI.add(hit);
      }
    }
    this.syncTargetIndicators();
  }

  /**
   * THE TARGET INDICATORS, ONE WRITER (JC, 2026-08-04: "we don't need
   * indicator icons on single-target encounters... and if the indicator is
   * needed, make it a bit see-through until you hover over an enemy").
   * Single living enemy: no arrow, no ring — there is nothing to choose.
   * Multiple: both GHOST at low alpha and bolden while any body is hovered,
   * so the choice reads clearly exactly when you are making it.
   */
  syncTargetIndicators() {
    const multi = this.livingEnemies().length > 1;
    const hot = !!this._hoverEnemy?.alive;
    if (this.targetArrow) {
      if (multi && this.target?.alive) {
        this.targetArrow.setVisible(true).setAlpha(hot ? 1 : 0.45);
        this.targetArrow.x = this.target.homeX;
        // A marquee boss's name is at the top of the SCREEN — the arrow keeps
        // pointing at the BODY, above the intent row over its head.
        this.targetArrow.y = this.target.bossBar
          ? (this.target.intentY ?? 160) - 14   // the slot between marquee and intent row
          : (this.target.uiName?.y ?? 120) - 34;
      } else {
        this.targetArrow.setVisible(false);
      }
    }
    this.enemies?.forEach((enemy, i) => {
      if (!enemy.targetRing?.active) return;
      if (!enemy.alive || !multi || i !== this.targetIndex) { enemy.targetRing.setAlpha(0); return; }
      enemy.targetRing.setAlpha(enemy.immune ? 0.14 : (hot ? 0.9 : 0.4));
    });
  }
}
