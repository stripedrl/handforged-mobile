/**
 * @file skins.js
 * SKINS — fifty unlockable models, ten per hero, that replace the character
 * model IN FIGHTS and ON THE CHARACTER-SELECT CARD. The map icon deliberately
 * does not change: the token on the board is how you find yourself at a glance,
 * and a player who has just equipped something is the last person who should
 * have to re-learn it.
 *
 * Pure data + predicates, no Phaser, so tests can read the whole system.
 *
 * ------------------------------------------------------------------------
 * HOW A SKIN IS EARNED — two kinds, and only two
 * ------------------------------------------------------------------------
 * SIX of every hero's ten come off THE DIFFICULTY LADDER, one per rung
 * (BRONZE · IRON · STEEL · PLATINUM · DIAMOND · MYTHRIL). The ladder is already
 * per hero — progress.difficultyCleared maps chrId -> the highest mode that hero
 * has cleared Act III on — so these need no new bookkeeping and no new trophy:
 * the requirement IS the rung, and clearing Act III with THE BULL on STEEL
 * dresses THE BULL and nobody else. That also gives the patch its difficulty
 * curve for free: the mundane skins sit at the bottom of the ladder and the two
 * showpieces are DIAMOND and MYTHRIL, which is JC's "the epic ones are meant for
 * Diamond clears", to the letter.
 *
 * The other FOUR are TARGETED: an achievement id, and the trophy says what to do.
 * Nine of them are "beat <this act's boss> with <this hero>", which you can
 * simply walk away from and try again, exactly the "targeted approach and
 * perhaps some RNG along the way" JC asked for and never a god run. CORRECTED
 * 2026-08-04: this block used to call that a 1-in-3 roll. It was, until
 * alternate worlds shipped. All nine name a PRIMARY act's boss, and an act now
 * rolls its world first (rollActVariant) and only then one of that world's
 * three, so once an act's alternate is unlocked the roll is 1-in-6 and the
 * alternate's bosses cannot satisfy these trophies at all. Flagged for JC: if
 * that reads as too thin, the fix is nine more entries, not a code change here.
 * Five are "clear Act IV with <hero>". Six are the hero's own kit turned up: the
 * Bull taking 200 shield off one hand, Zelus filling his ZEAL battery, Ophelia
 * stacking poison, Dextra landing a one-card hand, Drusky's chips and his mult.
 *
 * NOTHING here is bought, dropped or rolled. A skin is a record of something you
 * did, same as the trophy shelf. NB (2026-08-04): unlockEverything() opens the
 * thirty LADDER skins anyway, because it writes progress.difficultyCleared to
 * MAX for every hero and isSkinUnlocked reads that ladder directly. It grants no
 * achievements, so the twenty TARGETED ones stay shut. The old comment here
 * claimed it could not open any, which was never true.
 *
 * ------------------------------------------------------------------------
 * ADDING ONE IS ONE OBJECT
 * ------------------------------------------------------------------------
 *   id     stable forever — this is what a save writes
 *   chr    the hero it dresses (a CHARACTERS key)
 *   name   "<Theme> <Hero>", JC's example being "Forest Knight Bull"
 *   blurb  one line of flavour, shown on the tile
 *   rung   DIFFICULTIES index, for a ladder skin        (exactly one of these)
 *   unlock an achievement id, for a targeted skin       (two)
 * The texture key is derived (`skin_<id>`), the art lives at
 * assets/chars/skins/skin_<id>.png, and BootScene walks this list to load it.
 */

import { CHARACTERS } from '../config.js';
import { DIFFICULTIES } from './difficulty.js';
import {
  progress, saveProgress, isAchievementUnlocked, highestDifficultyCleared,
} from './progress.js';
// One-directional on purpose: skins read the trophy shelf, the trophy shelf has
// never heard of skins. Nothing in core/achievements.js may import this file.
import { ACHIEVEMENT_BY_ID } from './achievements.js';

/** `skin_<id>` — the Phaser texture key. Derived, never typed twice. */
export const skinTexture = (id) => `skin_${id}`;

export const SKINS = [
  // ======================= THE BULL (bulwark, Diamonds) =====================
  // The knight is armour first, so his ten are ten suits of it.
  { id: 'bulwark_forest', chr: 'bulwark', name: 'Forest Knight Bull',
    blurb: 'Green plate, grown rather than beaten.', unlock: 'bullFairyKing' },
  { id: 'bulwark_depth', chr: 'bulwark', name: 'Depth Knight Bull',
    blurb: 'Taken off the thing at the bottom, and worn.', unlock: 'bullDepthKnight' },
  { id: 'bulwark_storm', chr: 'bulwark', name: 'Storm Knight Bull',
    blurb: 'Earthed straight through the boots.', unlock: 'bullImmovable' },
  { id: 'bulwark_starlit', chr: 'bulwark', name: 'Starlit Knight Bull',
    blurb: 'A night sky, forged to fit.', unlock: 'bullCrucible' },
  { id: 'bulwark_tomb', chr: 'bulwark', name: 'Tomb Knight Bull',
    blurb: 'Gold leaf and grave linen.', rung: 0 },
  { id: 'bulwark_crimson', chr: 'bulwark', name: 'Crimson Knight Bull',
    blurb: 'The colour hides the work.', rung: 1 },
  { id: 'bulwark_emerald', chr: 'bulwark', name: 'Emerald Knight Bull',
    blurb: 'Every plate set with a stone he refuses to sell.', rung: 2 },
  { id: 'bulwark_glacier', chr: 'bulwark', name: 'Glacier Knight Bull',
    blurb: 'It never thawed. He never asked it to.', rung: 3 },
  { id: 'bulwark_adamant', chr: 'bulwark', name: 'Adamant Knight Bull',
    blurb: 'Cut, not cast. Nothing marks it.', rung: 4 },
  { id: 'bulwark_ember', chr: 'bulwark', name: 'Ember Knight Bull',
    blurb: 'Still cooling. It has been cooling for years.', rung: 5 },

  // ======================= OPHELIA (venomancer, Clovers) ====================
  { id: 'venomancer_grove', chr: 'venomancer', name: 'Grovekeeper Ophelia',
    blurb: 'Half her cabinet grows within arm’s reach.', unlock: 'ophWolfowl' },
  { id: 'venomancer_abyssal', chr: 'venomancer', name: 'Abyssal Ophelia',
    blurb: 'Everything in the bottles glows now.', unlock: 'ophKeeper' },
  { id: 'venomancer_blight', chr: 'venomancer', name: 'Blightbloom Ophelia',
    blurb: 'She stopped diluting.', unlock: 'ophVenom' },
  { id: 'venomancer_astral', chr: 'venomancer', name: 'Astral Ophelia',
    blurb: 'A doctor who takes appointments from the sky.', unlock: 'ophCrucible' },
  { id: 'venomancer_alchemist', chr: 'venomancer', name: 'Alchemist Ophelia',
    blurb: 'Brass, leather, and forty labelled pockets.', rung: 0 },
  { id: 'venomancer_sandwrap', chr: 'venomancer', name: 'Sandwrap Ophelia',
    blurb: 'Linen against the heat and the flies.', rung: 1 },
  { id: 'venomancer_corsair', chr: 'venomancer', name: 'Corsair Ophelia',
    blurb: 'Ship’s surgeon. The ship is not coming back.', rung: 2 },
  { id: 'venomancer_bloodroot', chr: 'venomancer', name: 'Bloodroot Ophelia',
    blurb: 'The red ones are not for drinking.', rung: 3 },
  { id: 'venomancer_ember', chr: 'venomancer', name: 'Emberflask Ophelia',
    blurb: 'Cauterise first, apologise later.', rung: 4 },
  { id: 'venomancer_starweave', chr: 'venomancer', name: 'Starweave Ophelia',
    blurb: 'The hat was a gift. She does not say who from.', rung: 5 },

  // ======================== DEXTRA (highRoller, Swords) =====================
  { id: 'highRoller_owlcloak', chr: 'highRoller', name: 'Owlcloak Dextra',
    blurb: 'Silent on the approach, by design.', unlock: 'dexSabreRabbit' },
  { id: 'highRoller_wraithsilk', chr: 'highRoller', name: 'Wraithsilk Dextra',
    blurb: 'You are not sure she was standing there.', unlock: 'dexDaughters' },
  { id: 'highRoller_nightshade', chr: 'highRoller', name: 'Nightshade Dextra',
    blurb: 'One edge, and something on it.', unlock: 'dexOneCard' },
  { id: 'highRoller_cardsharp', chr: 'highRoller', name: 'Cardsharp Dextra',
    blurb: 'The deal was always going to end this way.', unlock: 'dexCrucible' },
  { id: 'highRoller_oasis', chr: 'highRoller', name: 'Oasis Dextra',
    blurb: 'Cool cloth, hot country.', rung: 0 },
  { id: 'highRoller_frostveil', chr: 'highRoller', name: 'Frostveil Dextra',
    blurb: 'Her breath does not show.', rung: 1 },
  { id: 'highRoller_twilight', chr: 'highRoller', name: 'Twilight Dextra',
    blurb: 'She works the hour nobody watches.', rung: 2 },
  { id: 'highRoller_sandgold', chr: 'highRoller', name: 'Sandgold Dextra',
    blurb: 'Robbed a tomb. Kept the outfit.', rung: 3 },
  { id: 'highRoller_radiant', chr: 'highRoller', name: 'Radiant Dextra',
    blurb: 'Someone has decided she is holy.', rung: 4 },
  { id: 'highRoller_ember', chr: 'highRoller', name: 'Emberdance Dextra',
    blurb: 'Two blades, both lit.', rung: 5 },

  // ========================== ZELUS (zealot, Hearts) ========================
  { id: 'zealot_glacier', chr: 'zealot', name: 'Glacier Zelus',
    blurb: 'Mercy, at a temperature.', unlock: 'zelPhoenix' },
  { id: 'zealot_wraith', chr: 'zealot', name: 'Wraithlight Zelus',
    blurb: 'He went and fetched them back himself.', unlock: 'zelSummoner' },
  { id: 'zealot_infernal', chr: 'zealot', name: 'Infernal Zelus',
    blurb: 'The sermon got away from him.', unlock: 'zelZeal' },
  { id: 'zealot_seraph', chr: 'zealot', name: 'Seraph Zelus',
    blurb: 'Wings, and the paperwork to go with them.', unlock: 'zelCrucible' },
  { id: 'zealot_crimson', chr: 'zealot', name: 'Crimson Zelus',
    blurb: 'A field chaplain’s reds.', rung: 0 },
  { id: 'zealot_amethyst', chr: 'zealot', name: 'Amethyst Zelus',
    blurb: 'Vespers colours, kept for best.', rung: 1 },
  { id: 'zealot_blight', chr: 'zealot', name: 'Blightheart Zelus',
    blurb: 'He healed something he should not have.', rung: 2 },
  { id: 'zealot_starlit', chr: 'zealot', name: 'Starlit Zelus',
    blurb: 'Vestments cut from the small hours.', rung: 3 },
  { id: 'zealot_rosegold', chr: 'zealot', name: 'Rosegold Zelus',
    blurb: 'Blessed, gilded, and quietly pleased about it.', rung: 4 },
  { id: 'zealot_monarch', chr: 'zealot', name: 'Monarch Zelus',
    blurb: 'The cleric who was offered a crown.', rung: 5 },

  // ========================== DRUSKY (hoarder, Diamonds) ====================
  { id: 'hoarder_frostbound', chr: 'hoarder', name: 'Frostbound Drusky',
    blurb: 'Every sack frozen shut. He knows what is in them.', unlock: 'hoardPolarGuardian' },
  { id: 'hoarder_tycoon', chr: 'hoarder', name: 'Tycoon Drusky',
    blurb: 'New money, worn like old money.', unlock: 'hoardTycoon' },
  { id: 'hoarder_molten', chr: 'hoarder', name: 'Molten Drusky',
    blurb: 'The coins have started to run together.', unlock: 'hoardBigSwing' },
  { id: 'hoarder_seraph', chr: 'hoarder', name: 'Gilded Seraph Drusky',
    blurb: 'You cannot take it with you. He is testing that.', unlock: 'hoardCrucible' },
  { id: 'hoarder_fungal', chr: 'hoarder', name: 'Fungal Drusky',
    blurb: 'Something is growing in the third bag.', rung: 0 },
  { id: 'hoarder_verdant', chr: 'hoarder', name: 'Verdant Drusky',
    blurb: 'He has been out here a while.', rung: 1 },
  { id: 'hoarder_plaguebag', chr: 'hoarder', name: 'Plaguebag Drusky',
    blurb: 'Nobody wants to search him now.', rung: 2 },
  { id: 'hoarder_tyrant', chr: 'hoarder', name: 'Tyrant Drusky',
    blurb: 'The bags have skulls on them. Yours.', rung: 3 },
  { id: 'hoarder_wraithgold', chr: 'hoarder', name: 'Wraithgold Drusky',
    blurb: 'Died. Kept collecting.', rung: 4 },
  { id: 'hoarder_starlit', chr: 'hoarder', name: 'Starlit Drusky',
    blurb: 'A hoard that will outlast the sky it is cut from.', rung: 5 },
];

export const SKIN_BY_ID = Object.fromEntries(SKINS.map(s => [s.id, s]));
export const SKIN_IDS = SKINS.map(s => s.id);

/** Every skin for one hero, in this file's order (targeted first, then ladder). */
export function skinsForCharacter(chrId) {
  return SKINS.filter(s => s.chr === chrId);
}

/** The menu's sections: one per hero, in CHARACTERS order. */
export function skinSections() {
  return Object.keys(CHARACTERS).map(chrId => ({
    chrId, chr: CHARACTERS[chrId], skins: skinsForCharacter(chrId),
  }));
}

/**
 * IS IT EARNED? A ladder skin asks the per-hero ladder; a targeted one asks the
 * trophy case. A malformed entry (neither field) is treated as LOCKED FOREVER
 * rather than as free, because the failure mode of the other choice is handing
 * out a reward nobody worked for.
 */
export function isSkinUnlocked(id) {
  const s = SKIN_BY_ID[id];
  if (!s) return false;
  if (typeof s.rung === 'number') return highestDifficultyCleared(s.chr) >= s.rung;
  if (s.unlock) return isAchievementUnlocked(s.unlock);
  return false;
}

/** The one line a locked tile shows on hover. Never '???' — it is the ask. */
export function skinRequirement(id) {
  const s = SKIN_BY_ID[id];
  if (!s) return '';
  if (typeof s.rung === 'number') {
    const mode = DIFFICULTIES[s.rung]?.name ?? '?';
    return `Clear Act III with ${CHARACTERS[s.chr]?.name ?? '?'} on ${mode}.`;
  }
  // A targeted skin says the TROPHY'S OWN HINT, not '???'. The hint is the ask,
  // and a locked tile that will not say what it wants is a wall, not a goal.
  return ACHIEVEMENT_BY_ID[s.unlock]?.hint ?? '';
}

/**
 * WHAT YOU DID TO GET IT (JC, 2026-08-04: "after unlocking a skin, when
 * hovering over it, the title of the skin should still appear but underneath
 * that it should tell you what you did to acquire it").
 *
 * The same fact as skinRequirement, in the past tense — a locked tile is being
 * given a goal, an unlocked one is being reminded of a deed. A targeted skin
 * NAMES ITS TROPHY as well, because that is the row on the achievements shelf
 * this tile came from and the player has no other way to make the connection.
 */
export function skinEarnedLine(id) {
  const s = SKIN_BY_ID[id];
  if (!s) return '';
  if (typeof s.rung === 'number') {
    const mode = DIFFICULTIES[s.rung]?.name ?? '?';
    return `Cleared Act III with ${CHARACTERS[s.chr]?.name ?? '?'} on ${mode}.`;
  }
  const a = ACHIEVEMENT_BY_ID[s.unlock];
  if (!a) return '';
  return `${a.name.toUpperCase()}: ${a.hint}`;
}

/** The trophy a targeted skin waits on, or null for a ladder skin. */
export function skinAchievement(id) {
  const s = SKIN_BY_ID[id];
  return s?.unlock ? (ACHIEVEMENT_BY_ID[s.unlock] ?? null) : null;
}

/** How many of a hero's skins are open: { unlocked, total }. */
export function skinTally(chrId = null) {
  const list = chrId ? skinsForCharacter(chrId) : SKINS;
  return { unlocked: list.filter(s => isSkinUnlocked(s.id)).length, total: list.length };
}

// ---------------------------------------------------------------------------
// THE WARDROBE (persistent — progress.equippedSkins)
// ---------------------------------------------------------------------------

/**
 * The skin this hero wears, or null for the shipped model. Re-checked on every
 * read rather than trusted from disk: a save that banked a skin, and a profile
 * that was then reset, must not keep wearing it.
 */
export function equippedSkin(chrId) {
  const id = progress.equippedSkins?.[chrId];
  if (!id) return null;
  const s = SKIN_BY_ID[id];
  if (!s || s.chr !== chrId || !isSkinUnlocked(id)) return null;
  return id;
}

/**
 * Wear one, or pass null to go back to the shipped model. Returns TRUE when the
 * wardrobe actually changed. Refuses anything locked, anything belonging to
 * another hero, and anything that is not a skin — the menu already hides those,
 * but the save is a text file and this is the door it comes through.
 */
export function equipSkin(chrId, skinId) {
  if (!CHARACTERS[chrId]) return false;
  progress.equippedSkins ??= {};
  if (skinId == null) {
    if (progress.equippedSkins[chrId] == null) return false;
    delete progress.equippedSkins[chrId];
    saveProgress();
    return true;
  }
  const s = SKIN_BY_ID[skinId];
  if (!s || s.chr !== chrId || !isSkinUnlocked(skinId)) return false;
  if (progress.equippedSkins[chrId] === skinId) return false;
  progress.equippedSkins[chrId] = skinId;
  saveProgress();
  return true;
}

/**
 * THE ONE FUNCTION THE SCENES CALL. The texture key to draw for this hero right
 * now: the equipped skin if there is one and its art actually loaded, else the
 * shipped model. `hasTexture` is the scene's own textures.exists, passed in so
 * this module stays free of Phaser — a missing PNG then degrades to the base
 * hero instead of a green box.
 */
export function heroTextureFor(chrId, hasTexture = null) {
  const base = CHARACTERS[chrId]?.sprite ?? null;
  const id = equippedSkin(chrId);
  if (!id) return base;
  const key = skinTexture(id);
  if (hasTexture && !hasTexture(key)) return base;
  return key;
}

/** DEV / tests: strip the wardrobe back to the shipped models. */
export function resetSkins() {
  progress.equippedSkins = {};
  saveProgress();
}
