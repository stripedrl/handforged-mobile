/**
 * @file lazyload.js
 * THE ASSET LEDGER — what boot loads, what waits, and how the waiting is done.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * BootScene used to queue every image the game owns: 598 textures, 1,086 MB of
 * decoded RGBA, 37.5 seconds of cold boot. iOS gives a tab roughly 1-1.4 GB
 * before it kills it, so the game was dying on the loading screen of the device
 * it most needs to run on — and paying for the privilege with the longest wait
 * in the product.
 *
 * The measurement that decided the shape (2026-08-06 audit):
 *
 *     enemy sprites   264 MB   78 keys, ~12 of them wanted at a time
 *     backgrounds     162 MB   11 keys, ONE world is walked at a time
 *     skins           146 MB   50 keys, you wear one
 *     pack cards      110 MB   72 keys, one PACK is opened at a time
 *     map boards       92 MB    6 keys, one per act
 *     event backdrops  77 MB   15 keys, one room at a time
 *     boss sprites     66 MB   20 keys, one boss per act
 *     cardfaces        37 MB   25 keys, one hero per run
 *
 * JC's call, and the whole design in one sentence: "things only load as needed;
 * if a user doesn't run into one of the 6 acts they never load that material."
 *
 * ===========================================================================
 * THE TWO TABLES
 * ===========================================================================
 * BOOT_IMAGES   key -> path, everything BootScene still queues eagerly. The UI
 *               chrome, the card frames and pips, every hero model, the relic
 *               and potion icons, the fx and particles, the logo and the tavern.
 *               ~100 MB, and it is what the Title screen is made of.
 * MANIFEST      key -> { path, category }, everything else. Nothing in here is
 *               ever fetched by the loading screen; it arrives through ensure()
 *               behind a transition that was already on screen.
 *
 * THE TWO ARE DERIVED, NEVER TYPED TWICE. Every deferred key comes out of the
 * same table BootScene used to walk — ACTS/ALT_ACTS pools for the bestiary,
 * bossRoster for the medallions, SKINS for the wardrobe, packCardArtList for the
 * option cards, EVENTS for the backdrops. A creature added to a pool joins the
 * manifest by existing; a world added to ALT_ACTS brings its board and its
 * banner with it. tests/lazyload.test.js re-derives BOTH sides independently and
 * fails if a key falls between them.
 *
 * ===========================================================================
 * WHY A RAW `new Image()` AND NOT A SCENE LOADER
 * ===========================================================================
 * Settled already, in core/stages.js, after three attempts:
 *
 *   "The loader belongs to a SCENE, and both scenes that fetch stages restart
 *    constantly (the map on every room, combat on every fight); a load in the
 *    air when its scene dies re-processed on the next lifecycle and collided
 *    with the copy the other scene had landed ('Texture key already in use',
 *    six ways in one audition)."
 *
 * So: a plain Image, which has no lifecycle to be killed by; a module-level
 * in-flight map, because the scenes that ask cannot see each other; and an
 * exists() RE-CHECK AT ADD TIME, which makes a double-add impossible rather
 * than merely guarded against. `addImage` still fires `addtexture-<key>`, so a
 * pop-in listener works exactly as it does for a boss stage.
 *
 * A 404 RESOLVES, IT DOES NOT REJECT. Half the art in this game is optional —
 * potion bottles, achievement tiles, per-suit cardfaces, the Choir's painting —
 * and every consumer already guards with `textures.exists`. A missing file has
 * always meant "draw the fallback", and it still does.
 *
 * ===========================================================================
 * NO PHASER IN HERE
 * ===========================================================================
 * Same rule core/stages.js keeps: pure data plus resolvers, and the only engine
 * surface touched is `scene.textures`, which is the GAME's texture manager and
 * outlives every scene. That is what lets tests/lazyload.test.js and
 * tools/build_dist.py both import this module under plain node and prove every
 * path in it resolves in the shipped tree.
 */

import { IMG_EXT, CHARACTERS, PARTICLE_VARIANTS, WIDE } from '../config.js';
import { allActs, actEntry, bossRoster } from './acts.js';
import { ENEMY_DEFS } from './enemies.js';
import { SKINS, skinTexture } from './skins.js';
import { packCardArtList, PACK_TYPES } from './packs.js';
import { EVENTS, CRIMSON_FORGE } from './events.js';
import { ARTIFACT_POOL } from './artifacts.js';
import { POTION_POOL } from './potions.js';
import { ACHIEVEMENTS } from './achievements.js';
import { DUCKS } from './casino.js';
import { BOSS_STAGES, stageTexture, stagePath, stageForMap } from './stages.js';

const A = 'assets';

/**
 * IMG_EXT applied ONCE, here. Every path below is written as `.png` exactly the
 * way BootScene's call sites are, and this is the runtime twin of the loader
 * wrapper in core/imgload.js — a deferred fetch that hardcoded .png 404s in the
 * dist, which is a bug only the shipped build can show you (see stages.js).
 */
const px = (p) => p.replace(/\.png$/i, IMG_EXT);

// ---------------------------------------------------------------------------
// THE TABLES
// ---------------------------------------------------------------------------

/** @type {[string, string][]} key -> path. Everything BootScene still queues. */
export const BOOT_IMAGES = [];
/** @type {Map<string, {path: string, category: string}>} everything that waits. */
export const MANIFEST = new Map();

const seenKey = new Set();
function boot(key, path) {
  if (seenKey.has(key)) return;
  seenKey.add(key);
  BOOT_IMAGES.push([key, px(path)]);
}
function defer(category, key, path) {
  if (seenKey.has(key)) return;
  seenKey.add(key);
  MANIFEST.set(key, { path: px(path), category });
}

/** Is this key one of the eagerly-loaded ones (and so never evictable)? */
export function isBootCritical(key) {
  return !MANIFEST.has(key) && seenKey.has(key);
}

// ===========================================================================
// BOOT-CRITICAL — what the Title screen and the first click are made of
// ===========================================================================

// --- Card frames + pips (the club pip is generated in BootScene.create) -----
boot('card_border', `${A}/cards/CardFrame_01_BorderGray.png`);
boot('card_border_purple', `${A}/cards/CardFrame_01_BorderPurple.png`);
boot('card_deco_l', `${A}/cards/CardFrame_01_BorderGray_DecoLeft.png`);
boot('card_deco_r', `${A}/cards/CardFrame_01_BorderGray_DecoRight.png`);
boot('card_inner_top', `${A}/cards/CardFrame_01_InnerDecoTop.png`);
boot('card_bg', `${A}/cards/CardFrame_01_Bg.png`);
boot('pip_sword', `${A}/pips/function_icon_sword_1.png`);
boot('pip_heart', `${A}/pips/function_icon_heart.png`);
boot('pip_gem', `${A}/pips/function_icon_diamond.png`);

// --- The two backgrounds that are not a WORLD ------------------------------
// The tavern is the menu, the select screen and the skins shelf; the gradient
// strip is the panel wash. `bg_forest` (the 1920x1080 original, superseded by
// bg_forest_verdant on 2026-07-29) is deliberately absent — it is referenced by
// nothing outside the load that fetched it, and it cost 7.9 MB to prove it.
boot('bg_menu_tavern', `${A}/bg/menu_tavern.png`);
boot('bg_panel_grad', `${A}/bg/panel_gradient.png`);

// --- Heroes and the locked-hero silhouettes --------------------------------
boot('hero_duelist', `${A}/chars/hero_duelist.png`);
boot('hero_cleric', `${A}/chars/hero_cleric.png`);
boot('hero_diamond_knight', `${A}/chars/hero_diamond_knight.png`);
boot('hero_trickster', `${A}/chars/hero_trickster.png`);
boot('hero_ophelia', `${A}/chars/hero_ophelia.png`);
boot('hero_drusky', `${A}/chars/hero_drusky.png`);
boot('char_platform', `${A}/chars/Character_Platform.png`);
// Locked-hero silhouettes for the RECORDS shelf (tinted to black in-scene).
boot('silhouette_1', `${A}/chars/Character_Sample_04.png`);
boot('silhouette_2', `${A}/chars/Character_Sample_05.png`);
boot('silhouette_3', `${A}/chars/Character_Sample_06.png`);
// char_archer, char_backglow, enemy_wolf, enemy_twohead and enemy_dragon were
// removed from the boot set on 2026-08-06: five sample bodies nothing drew,
// ~4.5 MB decoded. The files stay on disk and in the dist; only the eager
// LOADING is gone.

// --- UI plates, buttons, sliders, seals, chips -----------------------------
boot('btn_yellow', `${A}/ui/Button_Rectangle_01_Convex_Yellow.png`);
boot('btn_red', `${A}/ui/Button_Rectangle_01_Convex_Red.png`);
boot('btn_blue', `${A}/ui/Button_Rectangle_01_Convex_Blue.png`);
boot('btn_dark', `${A}/ui/Button_Rectangle_01_Convex_Dark.png`);
boot('btn_gray', `${A}/ui/Button_Rectangle_01_Convex_Gray.png`);
boot('btn_green', `${A}/ui/Button_Rectangle_01_Convex_Green.png`);
boot('btn_circle_gray', `${A}/ui/Button_Circle_01_Gray.png`);
boot('label_tapered', `${A}/ui/Label_Tapered_Basic_35.png`);
boot('logo', `${A}/ui/logo.png`);
boot('potion_mat', `${A}/ui/potion_mat.png`);
boot('chip_flat', `${A}/ui/chip_flat.png`);
boot('chip_tilt_1', `${A}/ui/chip_tilt_1.png`);
boot('chip_tilt_2', `${A}/ui/chip_tilt_2.png`);
boot('seal_blood', `${A}/ui/seal_blood.png`);
boot('seal_mult', `${A}/ui/seal_mult.png`);
boot('seal_echo', `${A}/ui/seal_echo.png`);
boot('slider_bg', `${A}/ui/Slider_Border_Tapered_01_Bg.png`);
boot('slider_border', `${A}/ui/Slider_Border_Tapered_01_Border.png`);
boot('slider_fill_area', `${A}/ui/Slider_Border_Tapered_01_FillArea.png`);

// --- Icons -----------------------------------------------------------------
boot('icon_shield', `${A}/icons/function_icon_shield.png`);
boot('icon_coins', `${A}/icons/Resource_Icon_Coins.png`);
boot('icon_setting', `${A}/icons/function_icon_setting_1.png`);
boot('icon_music_note', `${A}/icons/function_icon_music.png`);
boot('icon_sound', `${A}/icons/function_icon_sound.png`);
boot('icon_volume', `${A}/icons/function_icon_volume.png`);
boot('icon_fire', `${A}/icons/function_icon_fire.png`);
boot('icon_skull', `${A}/icons/function_icon_skull.png`);
boot('icon_magic', `${A}/icons/function_icon_magic.png`);
boot('icon_trash', `${A}/icons/function_icon_trash.png`);
boot('icon_refresh', `${A}/icons/function_icon_refresh.png`);
boot('icon_sword_small', `${A}/icons/function_icon_sword_1.png`);
boot('icon_star', `${A}/icons/function_icon_star.png`);
boot('icon_heart_small', `${A}/icons/function_icon_heart.png`);
boot('icon_help', `${A}/icons/function_icon_help.png`);
boot('icon_dice', `${A}/icons/function_icon_dice.png`);
boot('icon_lucky', `${A}/icons/function_icon_lucky.png`);
boot('icon_gem', `${A}/icons/Resource_Icon_Gem.png`);
boot('icon_key', `${A}/icons/Resource_Icon_Key.png`);
boot('icon_hourglass', `${A}/icons/icon_hourglass.png`);
boot('icon_campfire', `${A}/icons/icon_campfire.png`);
// Map node icons — the board is drawn out of these on every act.
boot('map_battle', `${A}/icons/map_battle.png`);
boot('map_campfire', `${A}/icons/map_campfire.png`);
boot('map_elite', `${A}/icons/map_elite.png`);
boot('map_merchant', `${A}/icons/map_merchant.png`);
boot('map_event', `${A}/icons/map_event.png`);

// --- Action text + fx ------------------------------------------------------
boot('txt_combo', `${A}/text/AactionText_Combo.png`);
boot('txt_critical', `${A}/text/AactionText_Critical.png`);
boot('txt_warning', `${A}/text/AactionText_Warning.png`);
boot('fx_glow', `${A}/fx/fx_glow1.png`);
boot('fx_star', `${A}/fx/fx_star1.png`);
boot('fx_dust', `${A}/fx/fx_dust1.png`);
boot('fx_glow_circle', `${A}/fx/glow_circle.png`);
// Caleb's particle variants, driven off PARTICLE_VARIANTS rather than a
// hard-coded 1..3: the biome families that arrived on 2026-08-03 are not all
// threes (the Gallows shipped one ash and two embers). Preboot already fetched
// particle_ember_1..3 for the loading screen; `boot()` de-dupes by key and the
// loader skips a texture that already exists, exactly as it always has.
for (const [kind, count] of Object.entries(PARTICLE_VARIANTS)) {
  for (let n = 1; n <= count; n++) boot(`particle_${kind}_${n}`, `${A}/fx/particle_${kind}_${n}.png`);
}

/**
 * RELIC ICONS — one per pool entry, 0.25 MB each. They stay eager because the
 * belt is on screen in every room of every act and a relic can arrive from an
 * event, a shop, a pack, a hatch or a bounty; there is no one transition to hide
 * a fetch behind, and 26 MB buys the whole 110.
 *
 * TRANSFORMED relics wear an art key that belongs to no pool entry: the Potato
 * keeps id 'potato' when it becomes the Golden Spud (becomeGoldenSpud) and sets
 * `artKey` instead, so its texture has to be asked for by name.
 */
export const TRANSFORM_ART = ['goldenSpud'];
for (const art of ARTIFACT_POOL) boot('art_' + art.id, `${A}/icons/artifacts/${art.id}.png`);
for (const key of TRANSFORM_ART) boot('art_' + key, `${A}/icons/artifacts/${key}.png`);

/**
 * POTION BOTTLES stay eager: the belt is on screen in every room, a bottle can
 * arrive from any of six doors, and the whole set is 6 MB.
 */
for (const p of POTION_POOL) boot('pot_' + p.id, `${A}/icons/potions/${p.id}.png`);

/**
 * ACHIEVEMENT TILES are DEFERRED, and this one is about REQUESTS rather than
 * bytes. Not one of the seventy-three has been painted yet (see
 * docs/REQUESTS_ACHIEVEMENT_ART.txt) — the shelf draws a gold medal placeholder
 * and always has — so they contribute exactly 0 MB and seventy-three 404s to
 * every boot. Measured on the dev tree, where the assets live on a mounted
 * network drive, a request costs ~65ms whether it finds a file or not, so those
 * 404s were about a fifth of the entire remaining boot.
 *
 * They load when the trophy shelf is opened, which is the only surface that has
 * ever drawn one. Nothing changes today; the day the art lands, it lands there.
 */
for (const a of ACHIEVEMENTS) defer('achievement tile', 'ach_' + a.id, `${A}/icons/achievements/${a.id}.png`);

/** Every trophy tile — what the shelf asks for when it opens. */
export function achievementTiles() {
  return ACHIEVEMENTS.map(a => 'ach_' + a.id).filter(k => MANIFEST.has(k));
}

/** THE TRAVELING CASINO's racing ducks — 0.8 MB for the lot. */
for (const d of DUCKS) boot(d.key, `${A}/casino/${d.key}.png`);

/**
 * The per-hero furniture that the SELECT screen, the map token and the HUD all
 * draw before a run exists: the card background and the head icon. Both are
 * small (1.5 MB and 0.3 MB), both are needed for all five heroes at once on the
 * select rail, so both stay eager. The PER-SUIT card faces are the expensive
 * half (6 MB per hero, only drawn with CARD COLORS on) and belong to the hero
 * you actually picked — those are deferred, see heroCardfaces().
 */
export const HERO_IDS = Object.keys(CHARACTERS);
for (const cid of HERO_IDS) boot('cardbg_' + cid, `${A}/ui/cardbg_${cid}.png`);
for (const cid of HERO_IDS) boot('hero_icon_' + cid, `${A}/icons/hero_icon_${cid}.png`);
/**
 * THE NEUTRAL CARDFACE, one per hero, is eager. The twenty PER-SUIT ones are not.
 *
 * Five faces is 7.5 MB and the twenty behind them are 30, and the split is not
 * about the arithmetic: the neutral face is CardSprite's universal fallback (see
 * ui/CardSprite.js), the texture it reaches for whenever CARD COLORS is off or a
 * hero's suit art has not landed. That makes it the one cardface family any
 * scene can ask for at any moment, with no bundle in front of it to gate on —
 * deferring it would not fail loudly, it would quietly draw blank cream
 * rectangles wherever the fallback was taken.
 */
for (const cid of HERO_IDS) boot('cardface_' + cid, `${A}/ui/cardface_${cid}.png`);

// ===========================================================================
// DEFERRED — the manifest
// ===========================================================================

/**
 * THE SIX WORLDS' FURNITURE.
 *
 * `bgKey` is declared on the act; the FILE it comes from is not, so this is the
 * one hand-written mapping in the file — and tests/lazyload.test.js asserts that
 * every act in allActs() has an entry here, so a seventh world cannot ship
 * without one. The Crucible and the Ashen Crucible declare a borrowed bgKey
 * (`bg_abyss` / `bg_gallows`), which is why this is keyed by KEY and not by act.
 */
export const WORLD_BG_FILE = {
  bg_forest_verdant: 'forest_verdant',
  bg_frozen: 'frozen_wayside',
  bg_abyss: 'abyss',
  bg_nocturnal: 'nocturnal_forest',
  bg_ethereal: 'ethereal_plains',
  bg_gallows: 'burning_gallows',
};

/**
 * ONE BOARD AND ONE BANNER PER WORLD, keyed off `ambience` (which is 1:1 with a
 * world, and which the two borrowing Act IVs share with the world they borrow).
 *
 * These two tables were duplicated inline in MapScene; they live here now
 * because the loader has to know exactly what the map is about to draw, and two
 * copies of a lookup is how a seventh world ships with a blank board.
 */
export const BOARD_BY_AMBIENCE = {
  forest: 'map_board_forest', snow: 'map_board_frozen', abyss: 'map_board_abyss',
  nightwood: 'map_board_nocturnal', motes: 'map_board_ethereal', ash: 'map_board_gallows',
};
export const BANNER_BY_AMBIENCE = {
  forest: 'banner_forest', snow: 'banner_frozen', abyss: 'banner_abyss',
  nightwood: 'banner_nocturnal', motes: 'banner_ethereal', ash: 'banner_gallows',
};

for (const [key, file] of Object.entries(WORLD_BG_FILE)) {
  defer('world bg', key, `${A}/bg/${file}.png`);
}
/**
 * THE SIX WIDE BOARDS (Caleb, 2026-08-06) — THE 2340 CANVAS ONLY.
 *
 * The phone's canvas is 2340 and the painted boards are 1920, so the map has
 * been drawing a 1920 board centred in a 2340 window with 210px of empty dark
 * either side of it. Caleb repainted all six at 2340x2100: the open ground the
 * nodes stand on is where it always was, and the extra width went to
 * decorative wings — cliffs, roots, scaffolding — that darken toward the edge.
 *
 * That is the property the whole thing rests on, and tools/verify_boards_mobile
 * asserts it rather than trusting it: the node layout math (GAME_W/2 ± W_USE)
 * is not touched at all, and every world's node band is measured to still fall
 * inside the middle 1920. The wings are also exactly where the pinched-in map
 * HUD now sits, which is why the phone's capsule and belt stopped covering
 * board the player needs to read.
 *
 * DERIVED, NOT TYPED. `<board>_wide` off the narrow table, so a seventh world
 * gets both boards from the one line it already had to add.
 *
 * REGISTERED ONLY ON THE WIDE CANVAS, deliberately. These are the six biggest
 * single files in the game (7.7-10.7 MB apiece, 56 MB of the tree) and a build
 * that cannot draw one must never fetch one — a manifest entry it cannot reach
 * is a manifest entry it cannot accidentally load. It also keeps the node sweep
 * honest: WIDE is false under node, so tests/lazyload.test.js walks exactly the
 * ledger it has always walked.
 *
 * WIDE, NOT TOUCH (2026-08-10, the tablet wave). This is the one question in
 * the game that is genuinely about the CANVAS and not about the finger: an iPad
 * runs the full touch model on the 1920 canvas, and a 2340-wide board on it
 * would be the 210px of empty dark this art exists to delete, mirrored.
 */
export const BOARD_WIDE_BY_AMBIENCE = Object.fromEntries(
  Object.entries(BOARD_BY_AMBIENCE).map(([amb, key]) => [amb, `${key}_wide`]));

/**
 * THE BOARD THIS BUILD DRAWS for a world's ambience. One answer for the loader
 * and for MapScene, because a bundle that fetches the narrow board while the
 * scene paints the wide one is a loading veil that lifts on a blank map.
 */
export function boardKeyFor(ambience) {
  return (WIDE ? BOARD_WIDE_BY_AMBIENCE[ambience] : null) ?? BOARD_BY_AMBIENCE[ambience];
}

for (const key of Object.values(BOARD_BY_AMBIENCE)) defer('map board', key, `${A}/bg/${key}.png`);
if (WIDE) {
  for (const key of Object.values(BOARD_WIDE_BY_AMBIENCE)) defer('map board', key, `${A}/bg/${key}.png`);
}
for (const key of Object.values(BANNER_BY_AMBIENCE)) defer('banner', key, `${A}/ui/${key}.png`);

/**
 * THE BESTIARY, walked off the pools rather than listed.
 *
 * Every creature texture in the game is `assets/chars/<key>.png` — Caleb's whole
 * roster was normalised onto shared canvases by tools/install_biome_art.py, so
 * there is no per-file special case to know about. What IS worth knowing is that
 * a def can own more than one texture and can DRAG IN other defs:
 *
 *   sprite          the ordinary one
 *   spriteVariants  pick-one-per-spawn (the Below-Zero Skeletons)
 *   spriteForHero   the Mirrorwalker's five negatives, one per hero
 *   spriteAlt       a mid-fight swap the def does not otherwise name (the Depth
 *                   Knight's shell — CombatScene.groundSprite hardcodes the key,
 *                   and this is how the loader learns about it)
 *   openers         bodies that stand up WITH it (the Alpha Wolf's pack)
 *   intents[].effects[{type:'summon', minion}]   bodies it raises mid-fight
 *
 * Missing any of those is a blank rectangle in a boss fight, so the walk is
 * recursive and every act bundle is computed through it.
 */
function collectDefTextures(def, out, seen) {
  if (!def || seen.has(def)) return;
  seen.add(def);
  if (def.sprite) out.add(def.sprite);
  for (const k of def.spriteVariants ?? []) out.add(k);
  for (const k of Object.values(def.spriteForHero ?? {})) out.add(k);
  for (const k of def.spriteAlt ?? []) out.add(k);
  for (const id of def.openers ?? []) collectDefTextures(ENEMY_DEFS[id], out, seen);
  for (const it of def.intents ?? []) {
    for (const e of it.effects ?? []) {
      if (e?.type === 'summon' && e.minion) collectDefTextures(ENEMY_DEFS[e.minion], out, seen);
    }
  }
}

/** Every texture any body in this world can wear. */
export function actSprites(act) {
  const out = new Set();
  const seen = new Set();
  for (const pool of Object.values(act?.pools ?? {})) {
    for (const group of pool) {
      for (const def of (Array.isArray(group) ? group : [group])) collectDefTextures(def, out, seen);
    }
  }
  for (const entry of bossRoster(act)) {
    for (const def of entry.defs ?? []) collectDefTextures(def, out, seen);
  }
  return out;
}

for (const act of allActs()) {
  for (const key of actSprites(act)) defer('creature', key, `${A}/chars/${key}.png`);
  for (const entry of bossRoster(act)) {
    if (entry.icon) defer('boss medallion', entry.icon, `${A}/icons/${entry.icon}.png`);
  }
  if (act.bossIcon) defer('boss medallion', act.bossIcon, `${A}/icons/${act.bossIcon}.png`);
}

/**
 * BOSS ARENAS. core/stages.js owns the table and its own fetch (MapScene
 * prefetches, CombatScene hot-swaps); they are listed here for ONE reason —
 * evict() only ever touches keys it can see, and an 11 MB painting per act would
 * otherwise accumulate forever in the endless, which is exactly the number this
 * whole workstream exists to hold flat.
 */
for (const [id, st] of Object.entries(BOSS_STAGES)) {
  const file = st.file ?? id;
  defer('boss stage', stageTexture(file), stagePath(file));
}

/** THE FIFTY SKINS. You wear one; the shelf shows the ten that belong to a hero. */
for (const s of SKINS) defer('skin', skinTexture(s.id), `${A}/chars/skins/skin_${s.id}.png`);

/**
 * PER-SUIT CARD FACES — four a hero, twenty in all, 30 MB. Only drawn when the
 * CARD COLORS setting is on, and only ever for the hero being played; the
 * neutral face (eager, above) is what stands in for any of them.
 */
export const CARD_SUITS = ['swords', 'hearts', 'gems', 'clovers'];
for (const cid of HERO_IDS) {
  for (const suit of CARD_SUITS) {
    defer('cardface', `cardface_${cid}_${suit}`, `${A}/ui/cardface_${cid}_${suit}.png`);
  }
}

/** PACK COVERS and the painted OPTION CARDS the shelves deal. */
for (const kind of Object.keys(PACK_TYPES)) {
  defer('pack cover', 'pack_' + kind, `${A}/ui/pack_${kind}.png`);
}
for (const [kind, slug] of packCardArtList()) {
  defer('pack card', `packcard_${kind}_${slug}`, `${A}/ui/packcards/${kind}_${slug}.png`);
}

/** MYSTERY-EVENT BACKDROPS — one room at a time, 5 MB each. */
for (const ev of [...EVENTS, CRIMSON_FORGE]) {
  defer('event bg', 'evbg_' + ev.id, `${A}/bg/events/${ev.id}.png`);
}

/** The merchant's table and the inside of the casino wagon. */
defer('room bg', 'bg_merchant', `${A}/bg/merchant.png`);
defer('room bg', 'casino_interior', `${A}/bg/casino_interior.png`);

// ---------------------------------------------------------------------------
// THE LOADER
// ---------------------------------------------------------------------------

/**
 * ONE FETCH PER KEY, however many scenes ask.
 *
 * MODULE state, exactly like stages.js's inFlight Set and for the same reason:
 * MapScene prefetches a bundle, CombatScene awaits part of it, the skins shelf
 * asks for a thumbnail — those are three different scenes and this map is the
 * only place they can see each other. It holds the PROMISE and not merely the
 * key, so the second caller waits on the first caller's image instead of
 * starting a second request for the same bytes.
 */
const inFlight = new Map();

/** The texture manager, from a scene or from itself. Global, and immortal. */
const tmOf = (scene) => (scene?.textures ?? scene);

function fetchKey(tm, key) {
  try { if (tm.exists(key)) return Promise.resolve(); } catch { return Promise.resolve(); }
  const live = inFlight.get(key);
  if (live) return live;
  const entry = MANIFEST.get(key);
  // NOT OURS. A boot-critical key, a generated texture, a typo: all three mean
  // "there is nothing to fetch", and none of them is worth throwing over.
  if (!entry) return Promise.resolve();
  // NO BROWSER. This module is imported under plain node by tests/lazyload.test.js
  // and by tools/build_dist.py's verify(), which read the TABLES; asking either
  // of them to fetch is a no-op rather than a ReferenceError.
  if (typeof Image === 'undefined') return Promise.resolve();
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      inFlight.delete(key);
      // try/catch rather than a liveness probe: if the game was torn down while
      // the image flew, adding is a no-op we swallow, not a crash we risk.
      try { if (!tm.exists(key)) tm.addImage(key, img); } catch { /* gone */ }
      resolve();
    };
    // A 404 IS A FALLBACK, NOT A FAILURE. See the header.
    img.onerror = () => { inFlight.delete(key); resolve(); };
    img.src = entry.path;
  });
  inFlight.set(key, p);
  return p;
}

/**
 * Make sure every key in `keys` is in the texture cache, then resolve.
 *
 * Resolves IMMEDIATELY (a settled promise) when nothing is missing, which is the
 * property every call site is built on: the second visit to a room, and every
 * dev-hook scene jump after the first, costs nothing and shows no interstitial.
 *
 * @param {Phaser.Scene|Phaser.Textures.TextureManager} scene
 * @param {string[]} keys
 * @param {{onProgress?: (t: number) => void}} [opts] 0..1, called per landing
 * @returns {Promise<void>}
 */
export function ensure(scene, keys, { onProgress = null } = {}) {
  const tm = tmOf(scene);
  const want = [...new Set(keys ?? [])].filter(Boolean);
  if (!want.length) { onProgress?.(1); return Promise.resolve(); }
  let done = 0;
  const total = want.length;
  const tick = () => { done += 1; onProgress?.(done / total); };
  return Promise.all(want.map(k => fetchKey(tm, k).then(tick))).then(() => {});
}

/** Which of these are not in the cache yet. The gate every scene opens with. */
export function missingKeys(scene, keys) {
  const tm = tmOf(scene);
  try { return [...new Set(keys ?? [])].filter(k => k && !tm.exists(k)); } catch { return []; }
}

/**
 * Give the memory back.
 *
 * THREE REFUSALS, all of them load-bearing:
 *   · not in MANIFEST — boot-critical art and every generated texture live
 *     outside it, so they can never be evicted by a typo in a bundle list;
 *   · in flight — removing a key whose image is still in the air would let the
 *     landing re-add it a frame later, and the caller would have paid for the
 *     fetch twice;
 *   · not present — Phaser throws nothing, but counting a removal that did not
 *     happen would make the eviction proof in verify_deferred.py a lie.
 *
 * @returns {number} how many textures were actually released
 */
export function evict(scene, keys) {
  const tm = tmOf(scene);
  let n = 0;
  for (const key of new Set(keys ?? [])) {
    if (!MANIFEST.has(key) || inFlight.has(key)) continue;
    try {
      if (!tm.exists(key)) continue;
      tm.remove(key);
      n += 1;
    } catch { /* the manager is gone; nothing to give back */ }
  }
  return n;
}

/** DEV / tests: is anything still in the air? */
export function inFlightCount() { return inFlight.size; }

// ---------------------------------------------------------------------------
// THE BUNDLES — what a moment in the game actually needs
// ---------------------------------------------------------------------------

const inManifest = (keys) => [...new Set(keys)].filter(k => k && MANIFEST.has(k));

/**
 * WHAT THE MAP DRAWS. The world's backdrop, its board, its banner, and every
 * medallion its boss roster could wear. ~36 MB, and it is the ONE bundle in the
 * game that is genuinely awaited: MapScene cannot paint a board it does not have.
 *
 * ENDLESS COMES FREE. `actEntry` resolves through actSlotFor, so act index 7 is
 * Act IV's world and index 8 is Act I's again — the bundle for a lap-two forest
 * is the same bundle as the lap-one forest, and having been evicted it simply
 * loads again. That is what keeps the endless FLAT instead of monotonic.
 *
 * @param {number} actIndex
 * @param {{actPicks?: object}} [r] the run (only `actPicks` is read)
 */
export function actBundle(actIndex, r = {}) {
  const act = actEntry(actIndex, r?.actPicks?.[actIndex]);
  if (!act) return [];
  const out = [act.bgKey, boardKeyFor(act.ambience), BANNER_BY_AMBIENCE[act.ambience]];
  // EVERY medallion in the roster, not merely the rolled one: three discs are
  // 1.5 MB between them, and __hf.setBoss() re-rolls the pick under a scene
  // restart that would otherwise draw a missing texture.
  for (const entry of bossRoster(act)) if (entry.icon) out.push(entry.icon);
  if (act.bossIcon) out.push(act.bossIcon);
  return inManifest(out);
}

/**
 * WHAT THE ACT WILL WANT, fetched in the background the moment the board stands
 * and never waited on: the whole bestiary of the world you are standing in, so
 * that walking into a room is instant even though the room's own ensure() is
 * what actually guarantees it.
 *
 * The Mirrorwalker's five hero-negatives are trimmed to the ONE this run needs
 * when `chrId` is known — 11.7 MB of mirrors nobody will meet.
 */
export function actPrefetch(actIndex, r = {}) {
  const act = actEntry(actIndex, r?.actPicks?.[actIndex]);
  if (!act) return [];
  return inManifest(trimHeroVariants([...actSprites(act)], r?.chrId));
}

/**
 * Drop the hero-negative textures belonging to heroes this run is not playing.
 * The Mirrorwalker is the only def that works this way today; it costs 11.7 MB
 * of mirrors nobody will ever meet, in the ONE act that fields it twice.
 */
function trimHeroVariants(keys, chrId) {
  if (!chrId) return keys;
  const foreign = new Set();
  const mine = new Set();
  for (const def of Object.values(ENEMY_DEFS)) {
    const byHero = def?.spriteForHero;
    // NO NEGATIVE FOR THIS HERO, NO TRIM. CombatScene.spawnEnemy reads
    // `def.spriteForHero?.[run.chrId] ?? def.sprite`, so a sixth hero shipped
    // before its mirror is painted falls back to the def's own texture — and
    // trimming on a lookup that missed would delete exactly that texture.
    if (!byHero || !byHero[chrId]) continue;
    mine.add(byHero[chrId]);
    for (const [hero, key] of Object.entries(byHero)) if (hero !== chrId) foreign.add(key);
  }
  // `mine` wins over `foreign`: two defs could name the same negative, one of
  // them as its plain `sprite`, and a texture this run WILL draw is never cut.
  return keys.filter(k => mine.has(k) || !foreign.has(k));
}

/**
 * THE CATEGORIES A WORLD OWNS. Everything keyed by which act you are standing
 * in, and therefore everything that has to be given back when you leave it.
 */
const WORLD_CATEGORIES = new Set([
  'world bg', 'map board', 'banner', 'creature', 'boss medallion', 'boss stage',
]);

/**
 * EVERY WORLD-OWNED TEXTURE THAT IS NOT PART OF `keep`.
 *
 * Deliberately a SUBTRACTION over the whole manifest rather than a union of the
 * act footprints the run happens to have rolled, because those two are not the
 * same set and the difference is a leak:
 *
 *   · in the ENDLESS a world is rolled inside newActMap, so the act-clear
 *     ceremony's prefetch is made against the PRIMARY (nothing else is known
 *     yet) and the alternate may be what actually gets built. A per-index walk
 *     asks `actPicks` what index 8 turned out to be and never sees the primary
 *     it also paid for;
 *   · `__hf.setBiome()` re-pins a world under a live run, and the world it
 *     replaced is likewise invisible to a walk over the new picks.
 *
 * Subtracting from the manifest cannot miss either, and it cannot over-reach:
 * `keep` is the current act's whole footprint and evict() refuses anything in
 * flight, so the only textures that go are ones nothing on screen is drawing.
 */
export function worldKeysExcept(keep) {
  const kept = new Set(keep ?? []);
  const out = [];
  for (const [key, v] of MANIFEST) {
    if (WORLD_CATEGORIES.has(v.category) && !kept.has(key)) out.push(key);
  }
  return out;
}

/** Everything an act index owns, for eviction. Bundle + bestiary + its arenas. */
export function actFootprint(actIndex, r = {}) {
  const act = actEntry(actIndex, r?.actPicks?.[actIndex]);
  const stages = [];
  // Every arena this world's roster could have rolled — including the two Act IV
  // finales, whose 'default' pick resolves through stages.js's own alias table.
  for (const entry of bossRoster(act)) {
    const st = stageForMap(act, entry.id);
    if (st) stages.push(st.key);
  }
  return inManifest([...actBundle(actIndex, r), ...actPrefetch(actIndex, r), ...stages]);
}

/**
 * THE ROOM YOU ARE ACTUALLY IN. Every texture the bodies on this board can wear,
 * plus the hero's own model and cards — this is what CombatScene awaits, and it
 * is what keeps a dev-hook jump straight into 'Combat' from drawing rectangles.
 */
export function encounterBundle(defs = [], r = {}) {
  const out = new Set();
  const seen = new Set();
  for (const def of defs) collectDefTextures(def, out, seen);
  // A def that wears one texture PER HERO only ever needs this run's.
  const chrId = r?.chrId;
  for (const def of defs) {
    const byHero = def?.spriteForHero;
    if (!byHero || !chrId || !byHero[chrId]) continue;
    for (const [hero, key] of Object.entries(byHero)) if (hero !== chrId) out.delete(key);
    out.add(byHero[chrId]);
  }
  return inManifest([...out]);
}

/**
 * The painted faces this hero's deck is drawn with, minus the neutral one (which
 * is eager — see the essay at its declaration). Four keys, 6 MB, and `inManifest`
 * is what drops the neutral face rather than a second list saying so.
 */
export function heroCardfaces(chrId) {
  if (!chrId) return [];
  return inManifest(['cardface_' + chrId, ...CARD_SUITS.map(s => `cardface_${chrId}_${s}`)]);
}

/** One skin's model. `skinTexture` is re-exported so no call site types the key. */
export function skinBundle(skinId) {
  return skinId ? inManifest([skinTexture(skinId)]) : [];
}
export { skinTexture };

/** Every skin belonging to a hero — the shelf's ten thumbnails. */
export function skinShelf(chrId) {
  return inManifest(SKINS.filter(s => !chrId || s.chr === chrId).map(s => skinTexture(s.id)));
}

/**
 * A pack table: the covers you choose between, and — separately — the option
 * cards ONE pack deals. They are two calls on purpose. The eight covers are
 * 15.8 MB and are prefetched at map arrival so the offer screen is instant; the
 * cards are up to 11 paintings for the kind you actually tore open, fetched
 * behind the 700ms of pack-opening animation, and no other kind is ever resident.
 */
export function packCovers(kinds = null) {
  const list = kinds ?? Object.keys(PACK_TYPES);
  return inManifest(list.map(k => 'pack_' + k));
}
export function packCards(kinds = null) {
  const want = kinds ? new Set([].concat(kinds)) : null;
  return inManifest(packCardArtList()
    .filter(([kind]) => !want || want.has(kind))
    .map(([kind, slug]) => `packcard_${kind}_${slug}`));
}

/** One mystery room's painting. */
export function eventBg(id) { return id ? inManifest(['evbg_' + id]) : []; }

/** The merchant's tent and the casino's interior — one key each. */
export const MERCHANT_BG = 'bg_merchant';
export const CASINO_BG = 'casino_interior';

/**
 * EVERYTHING A RUN NEEDS BEFORE ITS FIRST MAP DRAWS: Act I's world, the hero's
 * painted deck, and the skin they are wearing. ~47 MB, awaited under the
 * difficulty screen's own 260ms fade-out — and by then the cardfaces and the
 * skin have usually already landed, because opening the difficulty page kicked
 * them off (CharacterSelectScene.openDifficultyPicker).
 *
 * THE ORACLE is deliberately NOT in here. She deals 420ms after the map stands,
 * and her twenty cards (30 MB) are prefetched on arrival with everything else
 * the map wants in the background; her overlay's own gate is the backstop.
 */
export function runStartBundle(r = {}, { skinId = null } = {}) {
  return inManifest([
    ...actBundle(r?.actIndex ?? 0, r),
    ...heroCardfaces(r?.chrId),
    ...skinBundle(skinId),
  ]);
}

/**
 * WHAT THE MAP FETCHES IN THE BACKGROUND once its board is standing and nothing
 * is waiting on it: the Oracle's shelf when she is still owed, the eight pack
 * covers (so the reward table is instant), the merchant's tent, and the act's
 * whole bestiary.
 */
export function mapPrefetch(actIndex, r = {}) {
  /**
   * ORDER MATTERS HERE, and it is the one place in this file where it does.
   *
   * `ensure` starts every fetch at once and the browser runs six at a time, so
   * the ORDER of this list is the order things actually land. Sorted by HOW
   * SOON each could be wanted, shortest fuse first:
   *
   *   THE ORACLE   420ms. She is dealt on arrival and there is nothing in front
   *                of her. Behind the bestiary she arrived seconds late, which
   *                left her MANDATORY shelf standing over whatever the player
   *                had gone and opened in the meantime (caught by
   *                tools/verify_bughunt.py, which found a merchant mat under a
   *                pack shelf and reported a missing LEAVE IT button).
   *   PACK COVERS  one fight away.
   *   THE TENT     one room away, and it has the coin wipe's 480ms besides.
   *   THE BESTIARY one room away too, but CombatScene GATES on it — so it is
   *                the only entry here that is allowed to be late, because a
   *                late one costs a beat rather than a wrong screen.
   */
  return inManifest([
    ...(r?.pendingOracle ? [...packCovers(['oracle']), ...packCards(['oracle'])] : []),
    ...packCovers(),
    // THE MERCHANT'S TABLE. Unconditional, and it is the one place this file
    // spends memory to buy a beat back: his tent is a single 18.5 MB painting,
    // it is NOT world-owned (so it is fetched once a session and never evicted),
    // and every road to it is short — the coin wipe gives it 480ms, but the four
    // drivers that call `__hf.openShop()` and the bounty's BOOKED MERCHANT give
    // it nothing at all. A conditional on "does this board have a shop node"
    // would be more faithful to the rule and would leave exactly those roads
    // racing, which is how tools/verify_copy.py first caught this.
    MERCHANT_BG,
    ...actPrefetch(actIndex, r),
  ]);
}

/** Every path in the manifest, for tools/build_dist.py's shipped-webp proof. */
export function allManifestPaths() {
  return [...MANIFEST.values()].map(v => v.path);
}
/** ...and boot's, for the same proof. */
export function allBootPaths() {
  return BOOT_IMAGES.map(([, p]) => p);
}
