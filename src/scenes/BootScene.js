import { GAME_W, GAME_H, COLORS, CARD, CHARACTERS, PARTICLE_VARIANTS, applyMobileCamera } from '../config.js';
import { wrapImageLoader } from '../core/imgload.js';
import { WEB_FONTS } from './PrebootScene.js';
import { bootMark } from '../core/boottime.js';
import { queueSfx } from '../core/sfx.js';
import { ARTIFACT_POOL } from '../core/artifacts.js';

/** Art keys owned by a TRANSFORMED relic rather than by a pool entry. */
const TRANSFORM_ART = ['goldenSpud'];
import { packCardArtList } from '../core/packs.js';
import { POTION_POOL } from '../core/potions.js';
import { ACHIEVEMENTS } from '../core/achievements.js';
import { SKINS, skinTexture } from '../core/skins.js';
import { EVENTS, CRIMSON_FORGE } from '../core/events.js';
import { DUCKS } from '../core/casino.js';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    bootMark('bootPreload');
    // THE IMG_EXT OVERRIDE — the whole of the dist's image-format story, and
    // the one thing every `${A}/....png` below depends on. It moved to
    // core/imgload.js when PrebootScene became a second scene that loads files;
    // the essay explaining it lives there.
    wrapImageLoader(this);

    // The loading screen is built BEFORE the 590 loads are queued, so its own
    // 'progress' listener is attached before the first byte lands.
    this.buildLoadingScreen();

    const A = 'assets';
    // Cards
    this.load.image('card_border', `${A}/cards/CardFrame_01_BorderGray.png`);
    this.load.image('card_border_purple', `${A}/cards/CardFrame_01_BorderPurple.png`);
    this.load.image('card_deco_l', `${A}/cards/CardFrame_01_BorderGray_DecoLeft.png`);
    this.load.image('card_deco_r', `${A}/cards/CardFrame_01_BorderGray_DecoRight.png`);
    this.load.image('card_inner_top', `${A}/cards/CardFrame_01_InnerDecoTop.png`);
    this.load.image('card_bg', `${A}/cards/CardFrame_01_Bg.png`);
    // Pips (white silhouettes -> tinted per suit)
    this.load.image('pip_sword', `${A}/pips/function_icon_sword_1.png`);
    this.load.image('pip_heart', `${A}/pips/function_icon_heart.png`);
    this.load.image('pip_gem', `${A}/pips/function_icon_diamond.png`);
    // (the club pip is a generated silhouette — see 'pip_club' in create())
    // Backgrounds
    this.load.image('bg_forest', `${A}/bg/forest.png`);
    this.load.image('bg_panel_grad', `${A}/bg/panel_gradient.png`);
    // Characters & enemies
    this.load.image('char_archer', `${A}/chars/Character_Sample_02.png`);
    this.load.image('hero_duelist', `${A}/chars/hero_duelist.png`);
    this.load.image('hero_cleric', `${A}/chars/hero_cleric.png`);
    this.load.image('hero_diamond_knight', `${A}/chars/hero_diamond_knight.png`);
    this.load.image('hero_trickster', `${A}/chars/hero_trickster.png`);
    this.load.image('char_platform', `${A}/chars/Character_Platform.png`);
    this.load.image('char_backglow', `${A}/chars/Character_BackGlow.png`);
    // Locked-hero silhouettes for the RECORDS shelf (tinted to black in-scene).
    this.load.image('silhouette_1', `${A}/chars/Character_Sample_04.png`);
    this.load.image('silhouette_2', `${A}/chars/Character_Sample_05.png`);
    this.load.image('silhouette_3', `${A}/chars/Character_Sample_06.png`);
    this.load.image('enemy_wolf', `${A}/chars/Character_Sample_09.png`);
    this.load.image('enemy_twohead', `${A}/chars/Character_Sample_10.png`);
    this.load.image('enemy_dragon', `${A}/chars/Character_Sample_08.png`);
    // Chapter 1 roster (Caleb art)
    this.load.image('enemy_wolf_cub', `${A}/chars/enemy_wolf_cub.png`);
    this.load.image('enemy_wild_boar', `${A}/chars/enemy_wild_boar.png`);
    this.load.image('enemy_green_slime', `${A}/chars/enemy_green_slime.png`);
    this.load.image('enemy_alpha_wolf', `${A}/chars/enemy_alpha_wolf.png`);
    this.load.image('enemy_alpha_boar', `${A}/chars/enemy_alpha_boar.png`);
    this.load.image('enemy_tree_blight', `${A}/chars/enemy_tree_blight.png`);
    this.load.image('boss_wolfowl', `${A}/chars/boss_wolfowl.png`);
    // Forest reinforcements (Caleb, 2026-07-29 late)
    this.load.image('enemy_woodling_imp', `${A}/chars/enemy_woodling_imp.png`);
    this.load.image('enemy_shroom_fiend', `${A}/chars/enemy_shroom_fiend.png`);
    this.load.image('enemy_knight_hawk', `${A}/chars/enemy_knight_hawk.png`);
    this.load.image('enemy_bear_mauler', `${A}/chars/enemy_bear_mauler.png`);
    this.load.image('bg_forest_verdant', `${A}/bg/forest_verdant.png`);
    this.load.image('bg_menu_tavern', `${A}/bg/menu_tavern.png`);
    // Act II — The Frozen Wayside (Caleb)
    this.load.image('bg_frozen', `${A}/bg/frozen_wayside.png`);
    this.load.image('en_northern_fighter', `${A}/chars/en_northern_fighter.png`);
    this.load.image('en_ice_elemental', `${A}/chars/en_ice_elemental.png`);
    this.load.image('en_yeti', `${A}/chars/en_yeti.png`);
    this.load.image('en_wooly_mammoth', `${A}/chars/en_wooly_mammoth.png`);
    this.load.image('en_alpha_mammoth', `${A}/chars/en_alpha_mammoth.png`);
    this.load.image('en_frost_guardian', `${A}/chars/en_frost_guardian.png`);
    this.load.image('boss_winter_phoenix', `${A}/chars/boss_winter_phoenix.png`);
    // Frozen Wayside reinforcements (Caleb, 2026-07-29 v.late)
    this.load.image('en_ice_owl', `${A}/chars/en_ice_owl.png`);
    this.load.image('en_ice_mage', `${A}/chars/en_ice_mage.png`);
    this.load.image('en_resurrected_eskimo', `${A}/chars/en_resurrected_eskimo.png`);
    this.load.image('en_subzero_serpent', `${A}/chars/en_subzero_serpent.png`);
    this.load.image('en_frost_titan', `${A}/chars/en_frost_titan.png`);
    // Act III — The Abyss (Caleb)
    this.load.image('bg_abyss', `${A}/bg/abyss.png`);
    this.load.image('en_abyssal_warrior', `${A}/chars/en_abyssal_warrior.png`);
    this.load.image('en_deep_serpent', `${A}/chars/en_deep_serpent.png`);
    this.load.image('en_lonely_wraith', `${A}/chars/en_lonely_wraith.png`);
    this.load.image('en_undead_guardian', `${A}/chars/en_undead_guardian.png`);
    this.load.image('en_ancient_guardian', `${A}/chars/en_ancient_guardian.png`);
    this.load.image('en_well_of_souls', `${A}/chars/en_well_of_souls.png`);
    this.load.image('boss_keeper', `${A}/chars/boss_keeper.png`);
    // Abyss reinforcements (Caleb, 2026-07-29 v.late)
    this.load.image('en_corrupted_crow', `${A}/chars/en_corrupted_crow.png`);
    this.load.image('en_ancient_slime', `${A}/chars/en_ancient_slime.png`);
    this.load.image('en_ancient_necromancer', `${A}/chars/en_ancient_necromancer.png`);
    this.load.image('en_twins_of_darkness', `${A}/chars/en_twins_of_darkness.png`);
    this.load.image('en_acidic_monstrosity', `${A}/chars/en_acidic_monstrosity.png`);
    // ALTERNATE ACT BOSSES (Caleb, 2026-07-31) — one of each act's three is
    // rolled per run; all are preloaded because the roll happens after Boot.
    this.load.image('boss_fairy_king', `${A}/chars/boss_fairy_king.png`);
    this.load.image('boss_sabre_rabbit', `${A}/chars/boss_sabre_rabbit.png`);
    this.load.image('boss_frost_summoner', `${A}/chars/boss_frost_summoner.png`);
    this.load.image('boss_polar_guardian', `${A}/chars/boss_polar_guardian.png`);
    this.load.image('boss_agatha', `${A}/chars/boss_agatha.png`);
    this.load.image('boss_sinastra', `${A}/chars/boss_sinastra.png`);
    this.load.image('boss_depth_knight_atk', `${A}/chars/boss_depth_knight_atk.png`);
    this.load.image('boss_depth_knight_def', `${A}/chars/boss_depth_knight_def.png`);
    // The Frostbitten Summoner's raised dead — three textures, one def.
    for (const n of [1, 2, 3]) {
      this.load.image(`en_bz_skeleton_${n}`, `${A}/chars/en_bz_skeleton_${n}.png`);
    }
    // UI
    this.load.image('btn_yellow', `${A}/ui/Button_Rectangle_01_Convex_Yellow.png`);
    this.load.image('btn_red', `${A}/ui/Button_Rectangle_01_Convex_Red.png`);
    this.load.image('btn_blue', `${A}/ui/Button_Rectangle_01_Convex_Blue.png`);
    this.load.image('btn_dark', `${A}/ui/Button_Rectangle_01_Convex_Dark.png`);
    this.load.image('btn_gray', `${A}/ui/Button_Rectangle_01_Convex_Gray.png`);
    this.load.image('btn_green', `${A}/ui/Button_Rectangle_01_Convex_Green.png`);
    this.load.image('label_tapered', `${A}/ui/Label_Tapered_Basic_35.png`);
    this.load.image('logo', `${A}/ui/logo.png`);
    // The potion mat (Caleb): stitched parchment with three worn spots — the
    // belt UI in both Combat and Map. Geometry lives in ui/potionIcon.js.
    this.load.image('potion_mat', `${A}/ui/potion_mat.png`);
    // Caleb's gold chips (2026-07-31): the flat face is the merchant's spinning
    // coin, the two tilted variants are the act-clear payday rain. Alpha-cropped
    // from 1024 masters down to 256 — they never draw larger than ~270px.
    this.load.image('chip_flat', `${A}/ui/chip_flat.png`);
    this.load.image('chip_tilt_1', `${A}/ui/chip_tilt_1.png`);
    this.load.image('chip_tilt_2', `${A}/ui/chip_tilt_2.png`);
    // Caleb's painted wax seals (2026-08-01): the crimson blob is struck "+2♥"
    // (SEAL_HEAL), the violet one "+3" (STAMP_MULT) — the art states the payout,
    // so CardSprite draws them untinted and with no legend on top. Alpha-cropped
    // from 1024 masters to 128; they never draw larger than ~52px on a card.
    this.load.image('seal_blood', `${A}/ui/seal_blood.png`);
    this.load.image('seal_mult', `${A}/ui/seal_mult.png`);
    // ...and the blue one is the ECHO SEAL (0803-B), cropped and scaled to match.
    this.load.image('seal_echo', `${A}/ui/seal_echo.png`);
    this.load.image('slider_bg', `${A}/ui/Slider_Border_Tapered_01_Bg.png`);
    this.load.image('slider_border', `${A}/ui/Slider_Border_Tapered_01_Border.png`);
    this.load.image('slider_fill_area', `${A}/ui/Slider_Border_Tapered_01_FillArea.png`);
    // Icons
    this.load.image('icon_shield', `${A}/icons/function_icon_shield.png`);
    this.load.image('icon_coins', `${A}/icons/Resource_Icon_Coins.png`);
    this.load.image('icon_setting', `${A}/icons/function_icon_setting_1.png`);
    this.load.image('icon_music_note', `${A}/icons/function_icon_music.png`);
    this.load.image('icon_sound', `${A}/icons/function_icon_sound.png`);
    this.load.image('icon_volume', `${A}/icons/function_icon_volume.png`);
    this.load.image('btn_circle_gray', `${A}/ui/Button_Circle_01_Gray.png`);
    this.load.image('icon_fire', `${A}/icons/function_icon_fire.png`);
    this.load.image('icon_skull', `${A}/icons/function_icon_skull.png`);
    this.load.image('icon_magic', `${A}/icons/function_icon_magic.png`);
    this.load.image('icon_trash', `${A}/icons/function_icon_trash.png`);
    this.load.image('icon_refresh', `${A}/icons/function_icon_refresh.png`);
    this.load.image('icon_sword_small', `${A}/icons/function_icon_sword_1.png`);
    this.load.image('icon_star', `${A}/icons/function_icon_star.png`);
    this.load.image('icon_heart_small', `${A}/icons/function_icon_heart.png`);
    this.load.image('icon_help', `${A}/icons/function_icon_help.png`);
    this.load.image('icon_dice', `${A}/icons/function_icon_dice.png`);
    this.load.image('icon_lucky', `${A}/icons/function_icon_lucky.png`);
    this.load.image('icon_gem', `${A}/icons/Resource_Icon_Gem.png`);
    this.load.image('icon_key', `${A}/icons/Resource_Icon_Key.png`);
    // Painted replacements for two former graphics-generated glyphs (2026-07-30):
    // the CHARGE intent hourglass (GUI Pro FantasyRPG item icon, 256->128) and
    // the rest-site campfire (Caleb's 1024 master, ->512). Both are full-colour,
    // so every consumer must keep tinting them WHITE (INTENT_ICONS already does).
    this.load.image('icon_hourglass', `${A}/icons/icon_hourglass.png`);
    this.load.image('icon_campfire', `${A}/icons/icon_campfire.png`);
    // Artifact art (Caleb, 2026-07-29): one icon per relic, keyed art_<id>.
    for (const art of ARTIFACT_POOL) {
      this.load.image('art_' + art.id, `${A}/icons/artifacts/${art.id}.png`);
    }
    // TRANSFORMED relics wear an art key that belongs to no pool entry: the
    // Potato keeps id 'potato' when it becomes the Golden Spud (see
    // becomeGoldenSpud) and sets `artKey` instead, so its texture has to be
    // asked for by name. A missing file 404s and falls back, same as any relic.
    for (const key of TRANSFORM_ART) {
      this.load.image('art_' + key, `${A}/icons/artifacts/${key}.png`);
    }
    // Map node icons (Caleb).
    this.load.image('map_battle', `${A}/icons/map_battle.png`);
    this.load.image('map_campfire', `${A}/icons/map_campfire.png`);
    this.load.image('map_elite', `${A}/icons/map_elite.png`);
    this.load.image('map_merchant', `${A}/icons/map_merchant.png`);
    this.load.image('map_event', `${A}/icons/map_event.png`);
    // Booster pack covers (Caleb).
    // ('bounty' is the act-boss payoff wrap, and 'oracle' the start-of-run one:
    // both are awarded rather than drafted, though THE ORACLE'S HUNTER can seat
    // the bounty wrap at the ordinary table for a run.)
    for (const k of ['witch', 'smith', 'artisan', 'dealer', 'forge', 'bounty', 'curator', 'oracle']) {
      this.load.image('pack_' + k, `${A}/ui/pack_${k}.png`);
    }
    // OPTION CARDS (JC, 2026-07-31): the Witch, the Dealer, the Forge, the
    // Smith and the Bounty Hunter deal their options as painted cards, keyed
    // packcard_<kind>_<name-slug>. The
    // TITLE is baked into the art, so the renderer draws no text on the face and
    // hangs the rules on a hover tooltip instead. A missing file 404s and that
    // ONE option falls back to the old icon panel (per-option, in rewards.js).
    for (const [kind, slug] of packCardArtList()) {
      this.load.image(`packcard_${kind}_${slug}`, `${A}/ui/packcards/${kind}_${slug}.png`);
    }
    // Potion icons (Caleb, REQUESTS_POTION_ART) — drawn-bottle fallback until
    // each lands, so 404s here are expected and harmless (same as counterfeit).
    for (const p of POTION_POOL) {
      this.load.image('pot_' + p.id, `${A}/icons/potions/${p.id}.png`);
    }
    // Achievement tiles (Caleb, REQUESTS_ACHIEVEMENT_ART) — the shelf draws a
    // gold medal placeholder until each lands, so these 404s are expected and
    // harmless, exactly like the potion icons above.
    for (const a of ACHIEVEMENTS) {
      this.load.image('ach_' + a.id, `${A}/icons/achievements/${a.id}.png`);
    }
    // Themed mystery-event backdrops (Caleb, REQUESTS_EVENT_BACKGROUNDS) —
    // wood panel fallback until each lands; 404s expected and harmless.
    for (const ev of [...EVENTS, CRIMSON_FORGE]) {
      this.load.image('evbg_' + ev.id, `${A}/bg/events/${ev.id}.png`);
    }
    // THE TRAVELING CASINO's four racing ducks (Caleb's variants, keyed off
    // their grey backgrounds and normalised to 256px). Keyed by the DUCKS table
    // so a fifth duck needs no edit here; a missing file 404s and the lane
    // races a tinted glyph instead, exactly like a missing relic icon.
    for (const d of DUCKS) this.load.image(d.key, `${A}/casino/${d.key}.png`);
    // Inside the wagon, painted, for when a game is actually on the table. The
    // event's own exterior painting is loaded with the other evbg_* art.
    this.load.image('casino_interior', `${A}/bg/casino_interior.png`);
    // The merchant's table.
    this.load.image('bg_merchant', `${A}/bg/merchant.png`);
    // Custom map boards per biome (Caleb, 2026-07-29).
    this.load.image('map_board_forest', `${A}/bg/map_board_forest.png`);
    this.load.image('map_board_frozen', `${A}/bg/map_board_frozen.png`);
    this.load.image('map_board_abyss', `${A}/bg/map_board_abyss.png`);
    // Hero card backgrounds (Caleb, 2026-07-29 night) — keyed by character id.
    // Driven off CHARACTERS rather than a hand-kept list (2026-08-03, Drusky):
    // a new hero whose files are named to the convention now wires itself, and
    // one whose files have not landed yet 404s harmlessly like the potions do.
    const HERO_IDS = Object.keys(CHARACTERS);
    for (const cid of HERO_IDS) {
      this.load.image('cardbg_' + cid, `${A}/ui/cardbg_${cid}.png`);
    }
    // Painted playing-card FACES per hero (Caleb, 2026-07-30) — replaces the
    // generated cream face + pack border for any hero that has art. Heroes
    // without a file just 404 and fall back (the tools/*.py drivers filter it).
    for (const cid of HERO_IDS) {
      this.load.image('cardface_' + cid, `${A}/ui/cardface_${cid}.png`);
    }
    // Per-SUIT painted faces (Caleb, 2026-07-30) — used when the CARD COLORS
    // setting is on, so each suit reads by colour at a glance. Same fallback
    // story as above: a missing file 404s and the neutral face stands in.
    for (const cid of HERO_IDS) {
      for (const suit of ['swords', 'hearts', 'gems', 'clovers']) {
        this.load.image(`cardface_${cid}_${suit}`, `${A}/ui/cardface_${cid}_${suit}.png`);
      }
    }
    // Hero head icons (Caleb) — map token, HUD portraits.
    for (const cid of HERO_IDS) {
      this.load.image('hero_icon_' + cid, `${A}/icons/hero_icon_${cid}.png`);
    }
    // Boss map icons (Caleb, 2026-07-29 night).
    this.load.image('boss_icon_wolfowl', `${A}/icons/boss_icon_wolfowl.png`);
    this.load.image('boss_icon_phoenix', `${A}/icons/boss_icon_phoenix.png`);
    this.load.image('boss_icon_keeper', `${A}/icons/boss_icon_keeper.png`);
    // ...and the 2026-07-31 alternates (medallion art per rolled boss).
    this.load.image('boss_icon_fairy_king', `${A}/icons/boss_icon_fairy_king.png`);
    this.load.image('boss_icon_sabre_rabbit', `${A}/icons/boss_icon_sabre_rabbit.png`);
    this.load.image('boss_icon_frost_summoner', `${A}/icons/boss_icon_frost_summoner.png`);
    this.load.image('boss_icon_polar_guardian', `${A}/icons/boss_icon_polar_guardian.png`);
    this.load.image('boss_icon_daughters', `${A}/icons/boss_icon_daughters.png`);
    this.load.image('boss_icon_depth_knight', `${A}/icons/boss_icon_depth_knight.png`);
    // World title banners (Caleb) for the map header.
    this.load.image('banner_forest', `${A}/ui/banner_forest.png`);
    this.load.image('banner_frozen', `${A}/ui/banner_frozen.png`);
    this.load.image('banner_abyss', `${A}/ui/banner_abyss.png`);

    // =====================================================================
    // THE THREE ALTERNATE WORLDS (2026-08-03)
    // =====================================================================
    // A run rolls its worlds at run START, which is long after Boot has
    // finished, so BOTH halves of every act are preloaded. That is 48 more
    // textures and it is the only honest option: a lazy load would mean the
    // first fight of an alternate act draws blank rectangles.
    //
    // Furniture first: battle backdrop, map board and title banner per world,
    // installed by tools/install_biome_worlds.py from the staged drop.
    this.load.image('bg_nocturnal', `${A}/bg/nocturnal_forest.png`);
    this.load.image('bg_ethereal', `${A}/bg/ethereal_plains.png`);
    this.load.image('bg_gallows', `${A}/bg/burning_gallows.png`);
    this.load.image('map_board_nocturnal', `${A}/bg/map_board_nocturnal.png`);
    this.load.image('map_board_ethereal', `${A}/bg/map_board_ethereal.png`);
    this.load.image('map_board_gallows', `${A}/bg/map_board_gallows.png`);
    this.load.image('banner_nocturnal', `${A}/ui/banner_nocturnal.png`);
    this.load.image('banner_ethereal', `${A}/ui/banner_ethereal.png`);
    this.load.image('banner_gallows', `${A}/ui/banner_gallows.png`);
    // The bestiary. Every key here is the `sprite` (or `spriteForHero` entry) of
    // a def in core/enemies.js and every file was installed by
    // tools/install_biome_art.py onto the shared 900x850 canvas, so they need no
    // special handling at all -- see docs/BIOME_ASSET_MAP.txt.
    for (const key of [
      // -- Act I alternate: THE NOCTURNAL FOREST
      'en_mothling', 'en_lantern_toad', 'en_nightjar', 'en_bramble_stalker',
      'en_hollow_fawn', 'en_glowcap_shambler', 'en_dreamweaver_spider', 'en_pocket_moth',
      'en_sleepless_stag', 'en_widow_canopy', 'en_strixursa', 'en_moonwell_horror',
      'boss_night_mother', 'boss_hollow_king', 'boss_grimwatch',
      // -- Act II alternate: THE ETHEREAL PLAINS
      'en_veilkin', 'en_mote_swarm', 'en_echo_knight', 'en_driftbeast',
      'en_glass_sylph', 'en_thoughtless_one', 'en_prism_stag', 'en_whisper_thief',
      // en_choir_motes is en_mote_swarm recoloured and one size up -- the Choir
      // has no painted art yet (flagged for JC). See install_biome_worlds.py.
      'en_choir_motes', 'en_long_sleeper', 'en_weft_warden',
      // THE MIRRORWALKER is one def with five textures, picked by hero at spawn.
      'en_mirrorwalker_highroller', 'en_mirrorwalker_zealot', 'en_mirrorwalker_bulwark',
      'en_mirrorwalker_venomancer', 'en_mirrorwalker_hoarder',
      'boss_pale_architect', 'boss_seraph_still', 'boss_the_unmade',
      // -- Act III alternate: THE BURNING GALLOWS
      'en_ash_crow', 'en_gallows_hound', 'en_ember_wisp', 'en_the_condemned',
      'en_pyre_zealot', 'en_cinder_golem', 'en_smoke_weaver', 'en_ash_archer',
      'en_hangman', 'en_brazier_titan', 'en_gallows_tree', 'en_warden_coals',
      'boss_magistrate', 'boss_pyreheart', 'boss_ropemaker',
    ]) {
      this.load.image(key, `${A}/chars/${key}.png`);
    }
    // ...and the nine new medallions, one per alternate boss.
    for (const key of [
      'boss_icon_night_mother', 'boss_icon_hollow_king', 'boss_icon_grimwatch',
      'boss_icon_pale_architect', 'boss_icon_seraph_still', 'boss_icon_the_unmade',
      'boss_icon_magistrate', 'boss_icon_pyreheart', 'boss_icon_ropemaker',
    ]) {
      this.load.image(key, `${A}/icons/${key}.png`);
    }
    // Ophelia, Doctor of Poison (replaces Moxie's model).
    this.load.image('hero_ophelia', `${A}/chars/hero_ophelia.png`);
    // Drusky, The Hoarder (2026-08-03). Delivered at Ophelia's 1912x1806 and
    // normalised to the shared 900x850 canvas with a 766px figure on the same
    // footline as the other four — see the measurements in the patch report.
    this.load.image('hero_drusky', `${A}/chars/hero_drusky.png`);
    // THE FIFTY SKINS (2026-08-03). Walked off the data so adding one is one
    // object in core/skins.js and nothing here. Every file was normalised by
    // tools/normalize_skin_art.py to the SAME 900x850 canvas as the shipped
    // heroes, with its figure measured to its own hero's height and stood on
    // that hero's ground line — so `setScale(0.3)` in the arena and
    // `setScale(0.385)` on the select card draw a skin and its hero identically,
    // and no call site needs to know which one it is holding.
    for (const s of SKINS) this.load.image(skinTexture(s.id), `${A}/chars/skins/skin_${s.id}.png`);
    // Action text art + FX
    this.load.image('txt_combo', `${A}/text/AactionText_Combo.png`);
    this.load.image('txt_critical', `${A}/text/AactionText_Critical.png`);
    this.load.image('txt_warning', `${A}/text/AactionText_Warning.png`);
    // Caleb's particle variants. Driven off PARTICLE_VARIANTS rather than a
    // hard-coded 1..3, because the biome families that arrived on 2026-08-03
    // are not all threes: the Gallows shipped one ash and two embers.
    for (const [kind, count] of Object.entries(PARTICLE_VARIANTS)) {
      for (let n = 1; n <= count; n++) {
        this.load.image(`particle_${kind}_${n}`, `${A}/fx/particle_${kind}_${n}.png`);
      }
    }
    this.load.image('fx_glow', `${A}/fx/fx_glow1.png`);
    this.load.image('fx_star', `${A}/fx/fx_star1.png`);
    this.load.image('fx_dust', `${A}/fx/fx_dust1.png`);
    this.load.image('fx_glow_circle', `${A}/fx/glow_circle.png`);
    // SFX load with the main batch — guaranteed present before any scene runs.
    queueSfx(this);

    // The lap that answers "how much of a boot is the download?" — everything
    // after this mark is texture generation and the font backstop.
    this.load.once('complete', () => bootMark('loadComplete'));
  }

  // =======================================================================
  // THE LOADING SCREEN
  // =======================================================================
  // A cold boot loads 590+ textures and can run the better part of a minute,
  // which makes this the longest uninterrupted look most players get at the
  // game before they get the game. It used to be a 4px gold sliver parked at
  // the dead centre of a black canvas, and it read as BROKEN rather than as
  // busy — with nothing around it, a bar with no track has no anchor to be
  // centred against, so it looked off-centre no matter how exactly it was
  // placed. Hence: a track, and a screen around it.
  //
  // Everything here is either GENERATED (the gradient, the glow, the bar
  // parts) or comes from PrebootScene, which loaded the logo, the embers and
  // the webfonts before this scene was ever started. Nothing on this screen
  // may come from the load it is a progress bar FOR — that circularity is
  // what made the old one ugly. Every borrowed asset is still guarded by
  // `textures.exists`, because a prettier loading screen is never worth a
  // boot that dies before it starts.
  //
  // Geometry derives from GAME_W/GAME_H so the mobile canvas (2340 wide)
  // centres the same way the desktop one does.
  buildLoadingScreen() {
    const cx = GAME_W / 2;
    const BAR_W = 640, BAR_H = 36, BAR_Y = 820;
    const ADD = Phaser.BlendModes.ADD;

    /** Rounded-rect path, by hand: ctx.roundRect is too new to rely on. */
    const rr = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    /** Draw once into a canvas-backed texture. Phaser's Graphics has no
     *  gradient fill that survives generateTexture, and this screen is mostly
     *  gradients, so the 2D context does the work directly. */
    const canvasTex = (key, w, h, draw) => {
      if (!this.textures.exists(key)) {
        const tex = this.textures.createCanvas(key, w, h);
        if (!tex) return key;
        draw(tex.context, w, h);
        tex.refresh();
      }
      return key;
    };

    // --- Backdrop: the page's own #14101c at the top, sinking into the glow
    // of a forge that is somewhere below the bottom edge, plus a vignette so
    // the corners fall away and the middle of the screen is where you look.
    const BACKDROP = canvasTex('boot_backdrop', GAME_W, GAME_H, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#14101c');
      grad.addColorStop(0.45, '#16101e');
      grad.addColorStop(0.78, '#1e1210');
      grad.addColorStop(1, '#2a1408');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // The heat HUGS the bottom edge. An earlier, broader version of this
      // flooded the lower two thirds with flat amber, which swallowed the
      // embers and the gold of the bar — the screen has to stay dark for the
      // fire to read as fire.
      const forge = ctx.createRadialGradient(w / 2, h + 10, 20, w / 2, h + 10, h * 0.62);
      forge.addColorStop(0, 'rgba(255,138,44,0.30)');
      forge.addColorStop(0.40, 'rgba(255,108,26,0.10)');
      forge.addColorStop(1, 'rgba(255,96,20,0)');
      ctx.fillStyle = forge;
      ctx.fillRect(0, 0, w, h);

      const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, w * 0.62);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(3,2,6,0.80)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    });
    this.add.image(cx, GAME_H / 2, BACKDROP).setDepth(0);

    // --- Soft white radial, tinted at each use: the bar's bed and its tip.
    const GLOW = canvasTex('boot_glow', 128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.62)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });

    // --- The logo, breathing. Same float the title screen uses (y +12,
    // scale +0.012, 2.6s) so the two screens feel like one motion.
    if (this.textures.exists('logo')) {
      const logo = this.add.image(cx, 360, 'logo').setScale(0.5).setDepth(2);
      this.tweens.add({
        targets: logo, y: 372, scale: 0.512, duration: 2600,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    } else {
      // Preboot's logo never arrived. Say the name anyway.
      this.add.text(cx, 360, 'HANDFORGED', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '96px', color: COLORS.gold,
      }).setOrigin(0.5).setDepth(2);
    }

    // --- Rising embers, the tavern's idiom (ui/tavern.js) spread across the
    // whole bottom edge: the forge under the floor, throwing sparks.
    if (this.textures.exists('particle_ember_1')) {
      this.time.addEvent({
        delay: 300, loop: true,
        callback: () => {
          for (let i = Phaser.Math.Between(1, 2); i > 0; i--) {
            const e = this.add.image(
              Phaser.Math.Between(30, GAME_W - 30), GAME_H + 24,
              `particle_ember_${Phaser.Math.Between(1, 3)}`)
              .setBlendMode(ADD).setDepth(1)
              .setScale(Phaser.Math.FloatBetween(0.10, 0.30))
              .setAngle(Phaser.Math.Between(-30, 30));
            this.tweens.add({
              targets: e, alpha: { from: Phaser.Math.FloatBetween(0.5, 0.95), to: 0 },
              y: e.y - Phaser.Math.Between(200, 400),
              x: e.x + Phaser.Math.Between(-60, 60),
              duration: Phaser.Math.Between(2200, 4200), ease: 'Sine.easeOut',
              onComplete: () => e.destroy(),
            });
          }
        },
      });
    }

    // --- The bar. A recessed track with a thin gold rim, so the fill has
    // something to be centred INSIDE — the whole reason the old one read
    // crooked. Track and fill are generated: no art dependency at all.
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x2a1c14, 1);                                  // rim bed
    g.fillRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
    g.fillStyle(0x0a0610, 1);                                  // the recess
    g.fillRoundedRect(4, 4, BAR_W - 8, BAR_H - 8, (BAR_H - 8) / 2);
    g.fillStyle(0x000000, 0.5);                                // inner top shadow
    g.fillRoundedRect(6, 5, BAR_W - 12, 9, 4);
    g.lineStyle(2, 0xffc542, 0.62);                            // the gold rim
    g.strokeRoundedRect(1, 1, BAR_W - 2, BAR_H - 2, (BAR_H - 2) / 2);
    g.generateTexture('boot_bar_track', BAR_W, BAR_H);
    g.destroy();

    const FILL_W = BAR_W - 12, FILL_H = BAR_H - 12;
    const FILL = canvasTex('boot_bar_fill', FILL_W, FILL_H, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#ffeab0');
      grad.addColorStop(0.30, '#ffc542');
      grad.addColorStop(0.72, '#f2992c');
      grad.addColorStop(1, '#c96f18');
      rr(ctx, 0, 0, w, h, h / 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.globalAlpha = 0.45;                                   // struck-metal sheen
      ctx.fillStyle = '#fff8e2';
      rr(ctx, 5, 2, w - 10, h * 0.32, h * 0.16);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    this.add.image(cx, BAR_Y, GLOW)
      .setBlendMode(ADD).setTint(0xff8a2a).setAlpha(0.13)
      .setDisplaySize(BAR_W + 340, 150).setDepth(4);
    this.add.image(cx, BAR_Y, 'boot_bar_track').setDepth(5);
    const fill = this.add.image(cx - FILL_W / 2, BAR_Y, FILL)
      .setOrigin(0, 0.5).setDepth(6).setCrop(0, 0, 0, FILL_H);

    // The molten tip: what is being poured into the track, riding the leading
    // edge. Two additive discs — a wide halo and a white-hot core.
    const tipHalo = this.add.image(0, BAR_Y, GLOW)
      .setBlendMode(ADD).setTint(0xffb347).setDisplaySize(132, 132).setDepth(7);
    const tipCore = this.add.image(0, BAR_Y, GLOW)
      .setBlendMode(ADD).setTint(0xfff3d2).setDisplaySize(52, 52).setDepth(8);
    for (const [t, s] of [[tipHalo, tipHalo.scaleX], [tipCore, tipCore.scaleX]]) {
      this.tweens.add({
        targets: t, scaleX: s * 1.22, scaleY: t.scaleY * 1.22,
        duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // --- Readouts. Both fonts are real by now (Preboot fetched them), which
    // is the other half of why this screen no longer looks like a placeholder.
    const pct = this.add.text(cx, BAR_Y + 48, '0%', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '36px', color: COLORS.gold,
    }).setOrigin(0.5).setDepth(6);
    const flavor = this.add.text(cx, BAR_Y + 100, '', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '30px', color: '#e8d5ac',
    }).setOrigin(0.5).setDepth(6);

    // HOW LONG A LINE HOLDS. Four times its first value (1.4s), and the change
    // is about how long the wait FEELS rather than how long it is.
    //
    // A line that swaps every 1.4s turns a 38-second boot into twenty-seven
    // visible changes, and a thing that ticks twenty-seven times is a metronome
    // counting the wait out loud. At 5.6s the same boot gets about seven, which
    // reads as a screen that occasionally has something else to say. On a warm
    // or fast boot the screen may not outlive the first line at all, and that
    // is the intended shape: one line, held, then the game.
    const FLAVOR_HOLD_MS = 5600;

    // Shuffled rather than cycled in order, and reshuffled with a guard against
    // the seam repeating a line back-to-back.
    const LINES = [
      'Stoking the forge…', 'Shuffling the deck…', 'Polishing relics…',
      'Counting chips…', 'Bribing the dealer…', 'Waking the Oracle…',
      'Sharpening swords…', 'Uncorking potions…',
    ];
    const bag = Phaser.Utils.Array.Shuffle(LINES.slice());
    let li = 0;
    flavor.setText(bag[0]);
    this.time.addEvent({
      delay: FLAVOR_HOLD_MS, loop: true,
      callback: () => {
        if (++li >= bag.length) {
          const last = bag[bag.length - 1];
          Phaser.Utils.Array.Shuffle(bag);
          if (bag[0] === last) bag.push(bag.shift());
          li = 0;
        }
        this.tweens.add({
          targets: flavor, alpha: 0, duration: 200, ease: 'Sine.easeIn',
          onComplete: () => {
            flavor.setText(bag[li]);
            this.tweens.add({ targets: flavor, alpha: 1, duration: 260, ease: 'Sine.easeOut' });
          },
        });
      },
    });

    // --- The pour. The loader's progress jumps in big uneven steps (one
    // 5MB background lands and the bar leaps 4%), so the drawn value CHASES
    // the real one exponentially instead of snapping to it.
    //
    // This runs on the scene's PRE_UPDATE rather than in update(): a scene
    // that is still in preload() never has its update() called, and preload is
    // the entire life of this screen. The listener is dropped on shutdown, and
    // the whole display list goes with the scene when Title starts.
    let shown = 0, target = 0;
    this.load.on('progress', v => { target = v; });
    const tick = (time, delta) => {
      shown += (target - shown) * (1 - Math.exp(-5 * Math.min(delta, 100) / 1000));
      const w = Math.max(0, Math.min(1, shown)) * FILL_W;
      fill.setCrop(0, 0, w, FILL_H);
      const tipX = cx - FILL_W / 2 + w;
      tipHalo.x = tipCore.x = tipX;
      const lit = shown > 0.004;
      tipHalo.setVisible(lit);
      tipCore.setVisible(lit);
      pct.setText(`${Math.round(Math.min(1, shown) * 100)}%`);
    };
    this.events.on('preupdate', tick);
    this.events.once('shutdown', () => this.events.off('preupdate', tick));

    // ...and the ONE place the chase is wrong to obey: the end.
    //
    // The chase has a ~200ms time constant, which over a 38-second pour costs
    // it about half a percent of lag and is exactly the softness it is there
    // for. But the loader's last file lands and `create()` starts on the SAME
    // millisecond, with Title a handful after — measured at 0-5ms — so the
    // eased walk from the last reported value up to 1.0 never gets its 200ms.
    // Measured against a build without the snap: the track left the screen
    // 99.63% gold, two pixels short, under a readout that rounded that up to a
    // confident "100%" and so hid it for as long as it existed. A progress bar
    // that is never seen full is a progress bar that lied. So completion
    // SNAPS, and the drawn state is repainted immediately rather than waiting
    // for a preupdate that may not come.
    this.load.once('complete', () => { shown = target = 1; tick(0, 0); });
  }

  create() {
    bootMark('bootCreate');
    applyMobileCamera(this);   // no-op on desktop
    // Generated opaque card face (the pack frame's center is transparent).
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xf8f4ec, 1);
    g.fillRoundedRect(0, 0, CARD.w, CARD.h, 16);
    g.generateTexture('card_face', CARD.w, CARD.h);
    g.clear();

    // Hexagon outline for the gem-card shield sheen.
    g.lineStyle(4, 0xe8c860, 1);
    const hexR = 44, cx = 50, cy = 50;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = cx + hexR * Math.cos(a), py = cy + hexR * Math.sin(a);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokePath();
    g.generateTexture('fx_hex', 100, 100);
    g.clear();

    // Poison droplet for club cards.
    g.fillStyle(0x3fa64b, 1);
    g.fillEllipse(6, 9, 9, 14);
    g.fillTriangle(6, 0, 2, 8, 10, 8);
    g.generateTexture('fx_drip', 12, 18);
    g.clear();

    // Club pip (♣) — a chunky toony white silhouette, tinted per surface like
    // the other pips. Three overlapping lobes + a flared stem, symmetric about
    // x = 48 so the corner clusters can centre on it exactly.
    // The silhouette deliberately fills only ~62% of its canvas, matching the
    // padding Caleb's sword/heart/diamond pips carry — otherwise the club
    // reads a size bigger than every other suit at the same display box.
    g.fillStyle(0xffffff, 1);
    g.fillCircle(48, 32, 15);                 // top lobe
    g.fillCircle(33, 52, 15);                 // lower-left lobe
    g.fillCircle(63, 52, 15);                 // lower-right lobe
    g.fillTriangle(43, 52, 53, 52, 61, 78);   // stem, flaring down-right
    g.fillTriangle(43, 52, 61, 78, 35, 78);   // stem, flaring down-left
    g.fillRoundedRect(35, 71, 26, 7, 3);      // flat chunky base
    g.generateTexture('pip_club', 96, 96);
    g.clear();

    // Feathered rounded-rect blob: `margin` 1px rings whose CUMULATIVE alpha
    // follows peak*t^curve from the outer edge inward, so the silhouette fades
    // to literally zero instead of stopping on a visible band. Each ring's own
    // alpha is solved from the composite it has to land on — a flat per-ring
    // alpha (the old recipe) ramps linearly and shows its outermost step.
    const feather = (w, h, margin, peak, curve, r0, color) => {
      let prev = 0;
      for (let i = 0; i < margin; i++) {
        const c = peak * Math.pow((i + 1) / margin, curve);
        g.fillStyle(color, 1 - (1 - c) / (1 - prev));
        prev = c;
        g.fillRoundedRect(i, i, w - i * 2, h - i * 2, Math.max(3, r0 - i));
      }
    };

    // Soft drop shadow for cards — 9px of feathered spread (was a 12px stack
    // with a hard outer step); the card sits 5/8px up-left of its centre.
    const shW = CARD.w + 18, shH = CARD.h + 18;
    feather(shW, shH, 9, 0.42, 2.0, 22, 0x120a06);
    g.generateTexture('card_shadow', shW, shH);
    g.clear();

    // Selection halo — 13px of feathered white so the gold reads as light
    // bleeding off the card's rounded edge rather than a slab glowing behind
    // it. Thinner and softer than the old 20px flat-alpha stack.
    const haW = CARD.w + 26, haH = CARD.h + 26;
    feather(haW, haH, 13, 0.72, 2.0, 26, 0xffffff);
    g.generateTexture('card_halo', haW, haH);
    g.clear();

    // Parchment/wood cartoon panel (nine-slice, corners 34).
    g.fillStyle(0x38220f, 1);                       // outer dark line
    g.fillRoundedRect(0, 0, 140, 140, 30);
    g.fillStyle(0x6b4526, 1);                       // wood frame
    g.fillRoundedRect(5, 5, 130, 130, 26);
    g.fillStyle(0xecd9b0, 1);                       // parchment
    g.fillRoundedRect(14, 14, 112, 112, 18);
    g.fillStyle(0xf6e8c8, 0.9);                     // top light bevel
    g.fillRoundedRect(14, 14, 112, 22, { tl: 18, tr: 18, bl: 0, br: 0 });
    g.generateTexture('panel_wood', 140, 140);
    g.clear();

    // Tintable outline ring matching the panel geometry (rarity accents).
    g.lineStyle(7, 0xffffff, 1);
    g.strokeRoundedRect(4, 4, 132, 132, 27);
    g.generateTexture('panel_line', 140, 140);
    g.clear();

    // Leaf for forest ambience.
    g.fillStyle(0x5fae4a, 1);
    g.fillEllipse(11, 7, 18, 9);
    g.fillStyle(0x8fd070, 1);
    g.fillEllipse(8, 6, 8, 4);
    g.lineStyle(1, 0x3c7a30, 1);
    g.lineBetween(3, 7, 19, 7);
    g.generateTexture('fx_leaf', 22, 14);
    g.clear();

    // Snowflake (freeze intent + frozen-card overlay).
    g.lineStyle(5, 0xffffff, 1);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      g.lineBetween(30 + Math.cos(a) * 26, 30 + Math.sin(a) * 26, 30 - Math.cos(a) * 26, 30 - Math.sin(a) * 26);
    }
    g.fillStyle(0xffffff, 1);
    g.fillCircle(30, 30, 5);
    g.generateTexture('icon_snow', 60, 60);
    g.clear();

    // Blood drop (bleed intent).
    g.fillStyle(0xd82838, 1);
    g.fillEllipse(20, 27, 26, 24);
    g.fillTriangle(20, 2, 8, 22, 32, 22);
    g.fillStyle(0xff8090, 0.9);
    g.fillEllipse(14, 24, 7, 9);
    g.generateTexture('icon_drop', 40, 44);
    g.clear();

    // Buff up-arrow.
    g.fillStyle(0x1a1424, 1);
    g.fillTriangle(22, 0, 0, 30, 44, 30);
    g.fillRect(13, 28, 18, 14);
    g.fillStyle(0xffc542, 1);
    g.fillTriangle(22, 5, 5, 27, 39, 27);
    g.fillRect(15, 26, 14, 13);
    g.generateTexture('icon_up', 44, 44);
    g.clear();

    // (the charge hourglass is painted art now — see preload's icon_hourglass)

    // Card overlays: frost sheet + abyssal veil (banned suit).
    g.fillStyle(0xbfe4ff, 0.55);
    g.fillRoundedRect(0, 0, CARD.w, CARD.h, 16);
    g.lineStyle(6, 0xe8f6ff, 0.9);
    g.strokeRoundedRect(3, 3, CARD.w - 6, CARD.h - 6, 14);
    g.generateTexture('fx_frost_card', CARD.w, CARD.h);
    g.clear();

    g.fillStyle(0x241040, 0.62);
    g.fillRoundedRect(0, 0, CARD.w, CARD.h, 16);
    g.lineStyle(6, 0x8050c0, 0.9);
    g.strokeRoundedRect(3, 3, CARD.w - 6, CARD.h - 6, 14);
    g.generateTexture('fx_veil_card', CARD.w, CARD.h);
    g.clear();

    // THE CARD BACK (2026-08-03, the Nocturnal Forest's BLIND). Fully OPAQUE,
    // unlike the two sheets above: a blinded card is not a card with something
    // over it, it is a card turned over, and any transparency at all would read
    // as "frosted 7 of hearts" rather than "you cannot see this". Blue-black
    // field, a silver double rule and a woven moonlight lattice.
    g.fillStyle(0x141026, 1);
    g.fillRoundedRect(0, 0, CARD.w, CARD.h, 16);
    g.fillStyle(0x1e1a3c, 1);
    g.fillRoundedRect(9, 9, CARD.w - 18, CARD.h - 18, 12);
    g.lineStyle(3, 0x7f8fd8, 0.75);
    for (let d = -CARD.h; d < CARD.w + CARD.h; d += 26) {
      g.lineBetween(Math.max(14, d), Math.max(14, 14 + (14 - d)),
        Math.min(CARD.w - 14, d + CARD.h - 28), Math.min(CARD.h - 14, CARD.h - 14));
    }
    g.fillStyle(0x1e1a3c, 0.55);
    g.fillRoundedRect(9, 9, CARD.w - 18, CARD.h - 18, 12);
    g.lineStyle(5, 0x9aa8e8, 0.95);
    g.strokeRoundedRect(4, 4, CARD.w - 8, CARD.h - 8, 14);
    g.lineStyle(2, 0x6a78c0, 0.9);
    g.strokeRoundedRect(13, 13, CARD.w - 26, CARD.h - 26, 10);
    g.generateTexture('fx_back_card', CARD.w, CARD.h);
    g.clear();

    // Target arrow (points down at the targeted enemy).
    g.fillStyle(0x1a1424, 1);
    g.fillTriangle(0, 0, 52, 0, 26, 34);
    g.fillStyle(0xffc542, 1);
    g.fillTriangle(5, 4, 47, 4, 26, 28);
    g.generateTexture('target_arrow', 52, 34);
    g.clear();

    // Crisp ring for reachable map nodes (tinted gold at runtime).
    g.lineStyle(9, 0xffffff, 1);
    g.strokeCircle(60, 60, 52);
    g.generateTexture('node_ring', 120, 120);
    g.clear();

    // Map path dot — a soft ink blot for the dotted trails.
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(6, 7, 5);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 5);
    g.generateTexture('map_dot', 12, 14);
    g.clear();

    // (the rest-site campfire is painted art now — see preload's icon_campfire)

    // Padlock for locked content.
    g.fillStyle(0x241505, 1);
    g.fillRoundedRect(8, 26, 40, 32, 7);            // body
    g.lineStyle(8, 0x241505, 1);
    g.beginPath();
    g.arc(28, 26, 14, Math.PI, 0, false);           // shackle
    g.strokePath();
    g.fillStyle(0xffd23e, 1);
    g.fillRoundedRect(12, 30, 32, 24, 5);           // face
    g.fillStyle(0x241505, 1);
    g.fillCircle(28, 40, 4.5);
    g.fillRect(26, 41, 4, 8);                       // keyhole
    g.generateTexture('icon_lock', 56, 62);
    g.clear();

    // TWO LINKS OF CHAIN, for wrapping a locked hero's card (2026-08-03).
    //
    // The GUI Pro pack has eleven padlocks and no chain at all — every filename
    // in its 4,528 was checked, plus the rest of the drive — so this is drawn
    // here for the same reason the padlock above is: Graphics costs nothing and
    // tiles into a chain of any length.
    //
    // A chain reads as a chain because its links ALTERNATE: one face-on (an
    // oval), the next edge-on (a short bar). One texture squashed on X gives a
    // sliver, not a bar, so there are two. Both are heavy steel over a black
    // outline, because a locked hero's card is tinted almost to black and a
    // thin dark ring on it is invisible — the chain has to be the lightest
    // thing on the plate after the padlock.
    g.lineStyle(16, 0x120d1c, 1);
    g.strokeEllipse(30, 21, 46, 30);                // outline
    g.lineStyle(10, 0x8f86a0, 1);
    g.strokeEllipse(30, 21, 46, 30);                // steel body
    g.lineStyle(3, 0xd6cfe4, 1);
    g.strokeEllipse(30, 19, 44, 28);                // lit top edge
    g.generateTexture('chain_link', 60, 42);
    g.clear();

    g.fillStyle(0x120d1c, 1);
    g.fillRoundedRect(1, 2, 24, 42, 12);            // outline
    g.fillStyle(0x8f86a0, 1);
    g.fillRoundedRect(4, 5, 18, 36, 9);             // steel body
    g.fillStyle(0x120d1c, 1);
    g.fillRoundedRect(9, 13, 8, 20, 4);             // the hole through it
    g.fillStyle(0xd6cfe4, 1);
    g.fillRoundedRect(5, 6, 5, 34, 2);              // lit left edge
    g.generateTexture('chain_link_side', 26, 46);
    g.clear();

    // Anvil (Smith packs): classic silhouette — beam + horn, waist, flared base.
    g.fillStyle(0x2a2430, 1);
    g.fillRoundedRect(2, 6, 46, 15, 4);             // top beam
    g.fillTriangle(46, 6, 66, 13, 46, 21);          // horn
    g.fillRect(19, 20, 18, 10);                     // waist
    g.fillTriangle(19, 30, 37, 30, 44, 40);         // base flare right
    g.fillTriangle(19, 30, 37, 30, 12, 40);         // base flare left
    g.fillRect(12, 38, 32, 5);                      // base slab
    g.fillStyle(0x584e66, 1);
    g.fillRoundedRect(2, 6, 46, 5, { tl: 4, tr: 4, bl: 0, br: 0 });  // lit top edge
    g.generateTexture('icon_anvil', 68, 44);
    g.clear();

    // THE WAX SEAL (2026-08-01). The BLOOD SEAL stopped being a card MOD and
    // became a stackable OVERLAY, so it needed a mark that reads over any face,
    // any mod wash, any suit colour: a blob of crimson wax pressed with a ring.
    // Deliberately irregular — three off-centre lobes over the disc give it the
    // squeezed-out edge real wax has, and the light rim + dark underside emboss
    // it so it sits ON the card instead of being printed into it.
    // Drawn in NEUTRAL GREYS on purpose: the stamp layer has two colours today
    // (crimson Blood Seal, violet Multiplicative Seal) and will have more, and a
    // grey blob multiplied by a tint keeps every step of the emboss — a
    // pre-coloured one would go muddy the moment it was tinted anything else.
    const SEAL_S = 64, sx = SEAL_S / 2, sy = SEAL_S / 2 + 1;
    g.fillStyle(0x282828, 0.5);
    g.fillCircle(sx + 2, sy + 3, 25);                        // the wax's own shadow
    g.fillStyle(0xc8c8c8, 1);
    g.fillCircle(sx, sy, 24);                                // the pour
    for (const [ox, oy, r] of [[-16, -9, 12], [15, -12, 10], [11, 15, 12], [-13, 14, 10]]) {
      g.fillCircle(sx + ox, sy + oy, r);                     // squeezed-out lobes
    }
    g.fillStyle(0xf2f2f2, 1);
    g.fillCircle(sx - 3, sy - 4, 19);                        // lit crown of the blob
    g.fillStyle(0x9a9a9a, 1);
    g.fillCircle(sx, sy + 1, 13);                            // the ring's impression
    g.fillStyle(0xd8d8d8, 1);
    g.fillCircle(sx, sy, 11);
    // The signet: a struck cross-bar, the plainest mark a ring could leave.
    g.fillStyle(0x6a6a6a, 1);
    g.fillRect(sx - 8, sy - 2, 16, 4);
    g.fillRect(sx - 2, sy - 8, 4, 16);
    g.lineStyle(2, 0xffffff, 0.8);
    g.strokeCircle(sx - 2, sy - 3, 22);                      // highlight rim, top-left
    g.generateTexture('fx_wax_seal', SEAL_S, SEAL_S);
    g.destroy();

    // The webfont await, kept as a BACKSTOP. PrebootScene now asks for the same
    // list (WEB_FONTS) before this scene ever starts, precisely so the loading
    // screen above could be typed in the game's own fonts rather than fallback
    // serif — so by here these are already resolved and this is instant. It
    // stays because it costs nothing and because it is the last gate before
    // the first REAL screen draws: if Preboot ever gives up on a slow font
    // server (it times out at 4s), this catches the fonts landing late.
    bootMark('bootCreateEnd');
    Promise.all(WEB_FONTS.map(f => document.fonts.load(f)))
      .catch(() => {})
      .then(() => {
        bootMark('titleStart');
        this.scene.start('Title');
      });
  }
}
