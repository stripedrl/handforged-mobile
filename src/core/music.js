/**
 * Music system — Caleb's Epidemic Sound playlists, lazy-loaded and crossfaded.
 * menu: looping vibe · fight: rotates random tracks per song-end · elite: one
 * looping theme for the set-piece · boss: looping menace.
 * Handles the browser autoplay lock via Phaser's 'unlocked' event.
 *
 * NOTHING HERE IS PRELOADED. Every track is fetched the first time its pool is
 * asked for (see playMusic), and BootScene loads no audio at all, so the 430MB
 * of music on disk costs nothing at boot — only at download.
 */

import { settings } from './settings.js';

/**
 * THE THREE ROOM VOLUMES. A fight sits under the table talk, a boss leans in,
 * and an ELITE sits deliberately between them — see ELITE POOLS below.
 */
const V_FIGHT = 0.21, V_ELITE = 0.245, V_BOSS = 0.28;

/** Named pools: { dir, count, volume }. Acts pick their fight/elite/boss pools. */
// Base volumes halved 2026-07-30 (music was reading roughly 2x the sfx level;
// relative proportions between pools are unchanged, only the overall scale).
//
// EXPORTED so the tests can derive their expectations from the table itself
// rather than from a second copy of these numbers that would drift the first
// time anyone added a pool. tests/music.test.js sweeps every entry here.
export const POOLS = {
  menu: { dir: 'menu', count: 6, volume: 0.25 },
  fight_forest: { dir: 'fight', count: 6, volume: V_FIGHT },
  boss_forest: { dir: 'boss', count: 3, volume: V_BOSS },
  fight_frozen: { dir: 'fight_frozen', count: 5, volume: V_FIGHT },
  boss_frozen: { dir: 'boss_frozen', count: 2, volume: V_BOSS },
  fight_abyss: { dir: 'fight_abyss', count: 7, volume: V_FIGHT },
  boss_abyss: { dir: 'boss_abyss', count: 4, volume: V_BOSS },
  // ------------------------------------------------------------------
  // THE ALTERNATE WORLDS (2026-08-03 music drop) — 34 tracks, nine pools
  // ------------------------------------------------------------------
  // Caleb: "cant believe i left out music for new acts, just threw them all in."
  // One set per alternate world, and for the first time in this project a set
  // includes ELITE tracks. The three ORIGINAL acts are deliberately absent from
  // the elite rows below: nothing was supplied for them, and inventing an elite
  // pool for the Verdant Forest by re-pointing it at boss_forest would be a
  // design decision wearing a bugfix's clothes. They keep their fight pool in an
  // elite room, exactly as they always have. See musicFor().
  fight_nocturnal: { dir: 'fight_nocturnal', count: 6, volume: V_FIGHT },
  elite_nocturnal: { dir: 'elite_nocturnal', count: 2, volume: V_ELITE },
  boss_nocturnal: { dir: 'boss_nocturnal', count: 3, volume: V_BOSS },
  fight_ethereal: { dir: 'fight_ethereal', count: 8, volume: V_FIGHT },
  elite_ethereal: { dir: 'elite_ethereal', count: 2, volume: V_ELITE },
  boss_ethereal: { dir: 'boss_ethereal', count: 3, volume: V_BOSS },
  // The Burning Gallows' set is also THE ASHEN CRUCIBLE's, the same way that
  // act already borrows the Gallows' board, backdrop and ambience.
  fight_gallows: { dir: 'fight_gallows', count: 4, volume: V_FIGHT },
  elite_gallows: { dir: 'elite_gallows', count: 3, volume: V_ELITE },
  boss_gallows: { dir: 'boss_gallows', count: 3, volume: V_BOSS },
  shop: { dir: 'shop', count: 1, volume: 0.25 },
  // Game over: explicit files (mixed formats), plays ONCE — per Caleb's README
  // it holds until a new run starts or the song ends.
  gameover: { dir: 'gameover', files: ['gameover_1.mp3', 'gameover_2.mp3', 'gameover_3.mp3'], volume: 0.28, once: true },
  // Run-win anthem: plays on the WIN screen where the player lingers reading
  // the run recap, so it LOOPS (no `once`) rather than cutting out.
  victory: { dir: 'victory', count: 1, volume: 0.3 },
};
const FADE_OUT = 700, FADE_IN = 1000;

function targetVolume(kind) {
  return (POOLS[kind]?.volume ?? 0.5) * settings.master * settings.music;
}

/**
 * WHICH POOL A ROOM PLAYS (2026-08-03, the elite-music drop).
 *
 * Acts used to declare `music: { fight, boss }` and CombatScene asked one
 * question — boss or not — so an ELITE room played ordinary corridor music. The
 * three alternate worlds now ship an elite set each, and this is the one place
 * that decides.
 *
 * IT DEGRADES, IT DOES NOT DEMAND. An act that declares `music.elite` plays it
 * in an elite room; an act that does NOT falls back to its fight pool and is
 * byte-for-byte the act that shipped. That fallback is the whole reason this is
 * a function and not a lookup: the Verdant Forest, the Frozen Wayside, the Abyss
 * and the Crucible supplied no elite music, and the correct amount of elite
 * music to invent for them is none. Silence here is a request for four more
 * tracks, not a gap to paper over with a boss pool they never asked for.
 *
 * @param act the act entry (see acts.js actEntry)
 * @param nodeType the map node's type — 'boss', 'elite' or anything else
 */
export function musicFor(act, nodeType) {
  const m = act?.music ?? {};
  if (nodeType === 'boss') return m.boss;
  if (nodeType === 'elite') return m.elite ?? m.fight;
  return m.fight;
}

/** Fade out and stop whatever is playing (boss-clear beats, run end). */
export function stopMusic(scene, fadeMs = 800) {
  pending = null;              // invalidates any in-flight request (token check)
  const old = current?.sound;
  current = null;
  if (old?.isPlaying) {
    addFade(scene, old, { volume: 0, duration: fadeMs });
  }
  reapExcept(null, fadeMs + 60);
}

/**
 * Volume tween that remembers itself on the sound, so the reaper can kill it
 * before destroying its target — a tween updating a freed Sound throws
 * "Cannot set properties of null (setting 'volume')" on its next tick.
 */
function addFade(scene, snd, props) {
  try {
    const t = scene.tweens.add({ targets: snd, ...props });
    (snd._fades ??= []).push(t);
  } catch { /* scene dying — the reaper still hard-stops the sound */ }
}

/** Jukebox: skip to another random track from the SAME pool. */
export function skipTrack(scene) {
  const kind = current?.kind ?? 'menu';
  stopMusic(scene, 250);
  scene.time.delayedCall(300, () => playMusic(scene, kind));
}

/** Autonomous-playtest introspection: what's committed and what's in flight. */
export function musicDebug() {
  return {
    current: current?.kind ?? null,
    playing: !!current?.sound?.isPlaying,
    pending: pending?.kind ?? null,
    tracked: live.size,
  };
}

/** Re-apply volume to whatever is currently playing (settings menu live-update). */
export function refreshMusicVolume() {
  const snd = current?.sound;
  if (!snd?.isPlaying) return;
  // KILL ANY RUNNING FADE FIRST (2026-08-04, JC: "music bypasses sound
  // settings... maybe at the end of a track / when I enter a new biome").
  // The fade-in used to capture its target volume ONCE and then drive the
  // sound toward it for a full second — so a volume change landing inside
  // that window was silently overwritten on the next tween tick, and the
  // track played out at the OLD volume. Track rotation and biome changes are
  // exactly the moments a fade-in is running, which is why it felt random.
  for (const t of snd._fades ?? []) { try { t.remove(); } catch { /* gone */ } }
  snd._fades = [];
  snd.setVolume(targetVolume(current.kind));
}

let current = null;       // { sound, kind }
let lastScene = null;
// The single in-flight request: { kind, key, scene, token }. `token` comes from
// a monotonic counter, so ANY newer request instantly invalidates it — a late
// load callback belonging to a superseded request can never start its track.
let pending = null;
let reqSeq = 0;
// Every sound this module ever started. Scene restarts KILL fade-out tweens
// (the merchant-overlap bug), so cleanup must never depend on a scene living.
const live = new Set();

/** Hard-stop every tracked sound except `keep` — native timer, scene-proof. */
function reapExcept(keep, graceMs = 750) {
  for (const snd of [...live]) {
    if (snd === keep) continue;
    setTimeout(() => {
      for (const t of snd._fades ?? []) { try { t.remove(); } catch { /* tween/scene gone */ } }
      snd._fades = [];
      try {
        if (snd.isPlaying || snd.isPaused) snd.stop();
        snd.destroy();
      } catch { /* already gone */ }
      live.delete(snd);
    }, graceMs);
  }
}

/**
 * SHUFFLE BAGS (2026-08-03, PATCH 0803-B §4.1).
 *
 * Every pool used to draw with a flat Phaser.Math.Between, which is uniform and
 * memoryless — and memoryless is the problem. With six menu tracks a fresh
 * boot repeats the previous session's opener one time in six, the fight pool
 * hands you the same song twice in a row one rotation in six, boss_frozen has
 * two tracks so it does it every other fight, and the title screen's JUKEBOX
 * button — which stops the track and immediately re-rolls the same pool — has a
 * one-in-six chance of answering a skip with the song you just skipped. That is
 * what "it always opens on the same track" feels like from the outside.
 *
 * So each pool now deals from a shuffled bag: every track plays once before any
 * track plays twice, the bag is reshuffled when it empties, and a reshuffle is
 * never allowed to deal the track that just played. The FIRST draw of a session
 * is the first card of a freshly shuffled bag, so the opener is random by
 * construction rather than by luck.
 *
 * A one-track pool (shop, victory) falls through all of this unchanged.
 */
const bags = new Map();      // kind -> the undealt remainder, dealt from the end
const lastDealt = new Map(); // kind -> what that pool played most recently

function deal(kind, items) {
  if (items.length === 1) return items[0];
  let bag = bags.get(kind);
  if (!bag || bag.length === 0) {
    bag = items.slice();
    for (let i = bag.length - 1; i > 0; i--) {          // Fisher-Yates
      const j = Phaser.Math.Between(0, i);
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    // Never let a fresh bag open with the track the last one closed on.
    const top = bag.length - 1;
    if (bag[top] === lastDealt.get(kind)) { const t = bag[top]; bag[top] = bag[0]; bag[0] = t; }
    bags.set(kind, bag);
  }
  const drawn = bag.pop();
  lastDealt.set(kind, drawn);
  return drawn;
}

/** Tests only: forget every bag, so a run of draws starts from a known state. */
export function resetMusicBags() { bags.clear(); lastDealt.clear(); }

/** Tests only: the draw itself, without a Phaser scene to play it on. */
export function pickTrack(kind) { return pick(kind); }

function pick(kind) {
  const pool = POOLS[kind];
  if (pool.files) {
    const f = deal(kind, pool.files);
    return { key: `mus_${kind}_${f}`, path: `assets/audio/music/${pool.dir}/${f}` };
  }
  const n = deal(kind, Array.from({ length: pool.count }, (_, i) => i + 1));
  const base = pool.dir === 'fight' || pool.dir === 'boss' || pool.dir === 'menu' ? pool.dir : kind;
  return { key: `mus_${kind}_${n}`, path: `assets/audio/music/${pool.dir}/${base}_${n}.mp3` };
}

/**
 * Is the in-flight request DEAD? A scene restart (BACK TO THE TRAIL →
 * refreshMap → scene.restart()) resets that scene's LoaderPlugin, which
 * silently drops both the queued audio file and our `filecomplete` listener —
 * the request can then never finish. Before we honour the in-flight guard we
 * check that the load is genuinely still running (and hasn't quietly landed in
 * the cache with nobody left to hear about it).
 */
function pendingStalled() {
  if (!pending) return true;
  try {
    // Arrived, but our callback was torn down with the old loader.
    if (pending.scene.cache.audio.exists(pending.key)) return true;
    return !pending.scene.load.isLoading();
  } catch {
    return true;   // scene destroyed out from under it
  }
}

/** Switch the soundtrack to a named pool (see POOLS). */
export function playMusic(scene, kind) {
  lastScene = scene;
  // Already playing — or already COMMITTED to playing (beginPlayback sets
  // `current` before the audio-unlock wait) — this kind. `current` is
  // explicitly nulled by stopMusic() and by the fight-pool 'complete' handler
  // right before it re-requests the SAME kind, so this never blocks a
  // legitimate rotation/restart. This is also what keeps the menu race fixed:
  // TitleScene and CharacterSelectScene both call playMusic(scene, 'menu') in
  // create(), and the second call folds into the first instead of spinning up
  // an overlapping track.
  if (current?.kind === kind && current.sound) return;
  // A LIVE request for this same kind is still loading — don't stomp it with a
  // second loader/track pick. A stalled one (dead loader) is re-driven below.
  if (pending?.kind === kind && !pendingStalled()) return;
  // Any earlier request — same kind or not — is superseded from here on.
  const token = ++reqSeq;
  const { key, path } = pick(kind);
  pending = { kind, key, scene, token };
  const begin = () => { if (pending?.token === token) beginPlayback(scene, kind, key, token); };
  if (scene.cache.audio.exists(key)) {
    begin();
  } else {
    scene.load.audio(key, path);
    scene.load.once(`filecomplete-audio-${key}`, begin);
    scene.load.start();
  }
}

function beginPlayback(scene, kind, key, token) {
  const sm = scene.sound;

  if (current?.sound?.isPlaying) {
    // Best-effort crossfade; the reaper below guarantees the stop even if
    // this scene (and its tweens) dies mid-fade.
    addFade(scene, current.sound, { volume: 0, duration: FADE_OUT });
  }

  // ONLY a `fight` pool rotates on song-end (see the 'complete' handler below);
  // everything else loops. That puts ELITE pools on the BOSS's behaviour, which
  // is the right side to land on: an elite room is one set-piece fight, so its
  // track holding for the whole fight reads as a theme, whereas rotating would
  // hand a two-track pool a new song part-way through a two-minute encounter.
  const snd = sm.add(key, { loop: !kind.startsWith('fight') && !POOLS[kind]?.once, volume: 0 });
  live.add(snd);
  snd.once('destroy', () => live.delete(snd));
  current = { sound: snd, kind };
  reapExcept(snd, FADE_OUT + 80);

  const start = () => {
    if (current?.sound !== snd) return; // superseded while waiting for unlock
    // Playback is actually starting now — release the in-flight guard so the
    // fight-pool 'complete' rotation (which re-requests this SAME kind) can
    // pass straight through instead of being blocked by its own prior request.
    if (pending?.token === token) pending = null;
    snd.play();
    // THE FADE-IN READS THE VOLUME LIVE, EVERY TICK (2026-08-04). It used to
    // tween the sound's volume toward a target captured at start time, which
    // meant a full second per track during which the settings did not exist:
    // turn MUSIC to zero while a rotation or a biome switch was fading its
    // track in, and the tween marched the volume right back up and left it
    // there. Tweens a 0->1 progress instead and derives the real volume from
    // the LIVE settings on every update, so a change lands mid-fade, instantly,
    // with no special case.
    const prog = { p: 0 };
    try {
      const sc = lastScene ?? scene;
      const t = sc.tweens.add({
        targets: prog, p: 1, duration: FADE_IN,
        onUpdate: () => { try { snd.setVolume(prog.p * targetVolume(kind)); } catch { /* freed */ } },
      });
      (snd._fades ??= []).push(t);
    } catch {
      // Scene dying mid-start: no fade, but the track must still obey the
      // settings rather than stay muted-or-loud forever.
      try { snd.setVolume(targetVolume(kind)); } catch { /* freed */ }
    }
  };
  if (sm.locked) sm.once('unlocked', start); else start();

  if (kind.startsWith('fight')) {
    snd.once('complete', () => {
      if (current?.sound === snd) {
        current = null;
        if (lastScene?.scene?.isActive()) playMusic(lastScene, kind);
      }
    });
  }
}
