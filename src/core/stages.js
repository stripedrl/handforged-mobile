/**
 * @file stages.js
 * BOSS STAGES (JC, 2026-08-04): every boss fights on its OWN painted arena.
 *
 * "I added new boss backgrounds for every boss... thought it needed more
 * diversity and hypes up each boss fight. I generally left clearing in the
 * middle of the background for the bosses to land."
 *
 * One entry per boss ROSTER id (acts.js `bosses[].id`), each an 18-file set at
 * assets/bg/boss/<id>.png (1920x1437, pre-scaled to the canvas so no runtime
 * resample). The two Act IV finales have no roster id of their own (`'default'`),
 * so they get named aliases here that POINT AT another boss's painting — the
 * Twin Calamity is fought at the Keeper's clock tower, THE LAST COURT in the
 * Magistrate's burning courtroom, because a court is where a court sits.
 *
 * WHAT A STAGE CHANGES, beyond the painting:
 *   - the boss stands BIGGER (`scale`, default ×1.18) and a shade LOWER
 *     (`ground`, default 726 vs the stock 712), so it reads as standing IN the
 *     clearing rather than floating over a backdrop;
 *   - the stone pedestals are DROPPED. They were always the interim fix for
 *     "feet on a painted gradient"; a stage has real ground, so the creature
 *     keeps only its soft contact shadow.
 *
 * LOADING: none of these are in the Boot preload — boot time is already the
 * shipping risk, and a run only ever meets ONE boss per act. MapScene prefetches
 * the current act's stage the moment the board is generated (the boss was rolled
 * at map generation, so it is known minutes before it is needed), and
 * CombatScene falls back to the act backdrop if the fetch has not landed —
 * then swaps in the stage when it does.
 *
 * Pure data + resolvers, no Phaser.
 */

import { IMG_EXT } from '../config.js';

/** The texture key a stage file loads under. Derived, never typed twice. */
export const stageTexture = (file) => `bg_boss_${file}`;
/**
 * ...and the path MapScene/CombatScene fetch it from. IMG_EXT, not '.png':
 * the shipped build transcodes every image to webp and flips that constant,
 * and BootScene's loader-wrapper only covers BOOT's own loads — a runtime
 * fetch that hardcoded .png 404'd in the dist (caught by smoke_dist).
 */
export const stagePath = (file) => `assets/bg/boss/${file}${IMG_EXT}`;

/**
 * Per-stage layout. Every field optional:
 *   file    the PNG basename when it is not the stage's own id (the finales)
 *   bgY     the painting's centre y on the 1080 canvas   (default 400)
 *   ground  the SOLO boss ground line                    (default 726)
 *   scale   the boss sprite's extra size multiplier      (default 1.18)
 *           Applied to `def.boss` bodies only — a summoner's raised dead and
 *           a boss's openers stay stock, so escorts never crowd the lanes.
 */
export const BOSS_STAGES = {
  // --- Verdant Forest -------------------------------------------------------
  wolfowl: {},            // its den, embers glowing in the dark of the cave
  fairyKing: {},          // the sun-shafted grove
  sabreRabbit: {},        // a burrow ringed with the bones of the overconfident
  // --- Frozen Wayside -------------------------------------------------------
  winterPhoenix: {},      // the crash crater, walled with frozen dead
  frostSummoner: {},      // his camp: totem rings and half-buried skulls
  polarGuardian: {},      // the ice cave it has always guarded
  // --- Abyss ----------------------------------------------------------------
  theKeeper: {},          // the Eternal Keep, clock burning green
  daughters: { scale: 1.08 },   // their candlelit sanctum (two bodies: stay lean)
  depthKnight: {},        // a drowned courtyard, poison pooling over the stones
  // --- Nocturnal Forest -----------------------------------------------------
  nightMother: {},        // the spore glade
  hollowKing: {},         // his moonlit court of lanterns
  grimwatch: {},          // the wood that watches back
  // --- Ethereal Plains ------------------------------------------------------
  paleArchitect: {},      // the unfinished blueprint of a world
  seraphStill: {},        // the still pool beneath the monolith
  theUnmade: {},          // ground cracking away into the sky it fell from
  // --- Burning Gallows ------------------------------------------------------
  magistrate: {},         // the courtroom, verdicts burning mid-air
  pyreheart: {},          // the pyre pit, chains that did not hold
  ropemaker: {},          // the hanging tree
  // --- The finales (bossPick 'default'; keyed via FINALE_STAGES below) ------
  // TWIN CALAMITY (Phoenix + Keeper): the Keeper's tower — the last act ends
  // at the Eternal Keep, with the two of them flanking its gate.
  crucibleFinale: { file: 'theKeeper', scale: 1.06 },
  // THE LAST COURT (Hollow King + Magistrate): the Magistrate's burning court.
  // The Ashen Crucible runs cold and grey all act; the finale is where it
  // finally catches fire.
  lastCourtFinale: { file: 'magistrate', scale: 1.06 },
};

/** Which finale alias each Act IV world's 'default' boss pick resolves to. */
const FINALE_BY_ACT = { crucible: 'crucibleFinale', ashen: 'lastCourtFinale' };

/**
 * The stage for this fight, or null (every non-boss room, and any boss whose
 * painting has not been made yet — the table IS the feature flag).
 * @param {object} act        the resolved act (needs .id)
 * @param {object} node       the map node (needs .type)
 * @param {?string} bossPickId run.map.bossPick
 * @returns {?{id:string, key:string, path:string, bgY:number, ground:number, scale:number}}
 */
export function stageFor(act, node, bossPickId) {
  if (node?.type !== 'boss') return null;
  const id = bossPickId === 'default'
    ? FINALE_BY_ACT[act?.id]
    : bossPickId;
  const st = BOSS_STAGES[id];
  if (!st) return null;
  const file = st.file ?? id;
  return {
    id,
    key: stageTexture(file),
    path: stagePath(file),
    bgY: st.bgY ?? 400,
    ground: st.ground ?? 726,
    scale: st.scale ?? 1.18,
  };
}

/**
 * The stage THIS MAP's boss will use — what MapScene prefetches on arrival.
 * Same resolver, fed the one fact the map already owns.
 */
export function stageForMap(act, bossPickId) {
  return stageFor(act, { type: 'boss' }, bossPickId);
}

/**
 * ONE FETCH PER PAINTING, however many scenes ask. MapScene prefetches on
 * arrival and CombatScene fetches as a fallback; when the fight starts while
 * the prefetch is still in the air, both used to queue the same key and the
 * second landing threw "Texture key already in use". The in-flight set is
 * MODULE state because the two loaders belong to different scenes and this is
 * the only place they can see each other.
 * @returns {boolean} whether a load was actually started
 */
const inFlight = new Set();
export function fetchStage(scene, stage) {
  if (!stage) return false;
  const tm = scene.textures;   // the GAME's texture manager — global, immortal
  if (tm.exists(stage.key) || inFlight.has(stage.key)) return false;
  inFlight.add(stage.key);
  // A RAW Image, not the scene's LoaderPlugin — third attempt, and the one
  // that closes the class. The loader belongs to a SCENE, and both scenes that
  // fetch stages restart constantly (the map on every room, combat on every
  // fight); a load in the air when its scene dies re-processed on the next
  // lifecycle and collided with the copy the other scene had landed
  // ("Texture key already in use", six ways in one audition). A plain Image
  // has no lifecycle to be killed by, and the exists() re-check AT ADD TIME
  // makes a double-add impossible rather than merely guarded against.
  // addImage still fires `addtexture-<key>`, so CombatScene's hot-swap
  // listener works unchanged.
  const img = new Image();
  img.onload = () => {
    inFlight.delete(stage.key);
    // try/catch rather than a liveness probe: if the game was torn down while
    // the image flew, adding is a no-op we swallow, not a crash we risk.
    try { if (!tm.exists(stage.key)) tm.addImage(stage.key, img); } catch { /* gone */ }
  };
  img.onerror = () => inFlight.delete(stage.key);
  img.src = stage.path;
  return true;
}
