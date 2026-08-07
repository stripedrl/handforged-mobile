/**
 * Music system — Caleb's Epidemic Sound playlists, lazy-loaded and crossfaded.
 * menu: looping vibe · fight: rotates random tracks per song-end · elite: one
 * looping theme for the set-piece · boss: looping menace.
 * Handles the browser autoplay lock via Phaser's 'unlocked' event.
 *
 * NOTHING HERE IS PRELOADED. Every track is fetched the first time its pool is
 * asked for (see playMusic), and BootScene loads no audio at all, so the 430MB
 * of music on disk costs nothing at boot — only at download.
 *
 * ...AND NOTHING HERE IS KEPT. See THE BUFFER SWEEP, below.
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
    key: current?.key ?? null,
    playing: !!current?.sound?.isPlaying,
    pending: pending?.kind ?? null,
    tracked: live.size,
    // How many decoded music buffers the sweep has left resident. One, once
    // playback settles; two only for the length of a crossfade.
    resident: audioMem().music.count,
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
  // The buffers the reaped sounds were playing FROM outlive the sounds. Sweep
  // them a beat after the reap lands, on the same native clock and for the same
  // reason: a scene restart must not be able to cancel a cleanup.
  setTimeout(evictMusicCache, graceMs + 40);
}

// ---------------------------------------------------------------------------
// THE BUFFER SWEEP (2026-08-06) — the fix for iOS Safari's 1.25GB wall
// ---------------------------------------------------------------------------
// `snd.destroy()` frees a Sound OBJECT. It does not free the AudioBuffer the
// sound was reading, because that buffer belongs to `cache.audio`, and Phaser's
// caches are forever by design — a loaded key stays loaded until the game dies.
//
// For textures that is the right call. For music it is fatal arithmetic: decoded
// PCM is sampleRate x channels x seconds x 4 bytes, so ONE 16.6MB mp3 (48kHz
// stereo, 8m53s) is 195MB resident, and a fight pool ROTATES on song end. A
// normal act therefore used to accumulate +300-590MB of decoded audio that
// nothing would ever play again and nothing would ever release, on top of a
// budget a phone measures in hundreds of megabytes total.
//
// So: AT MOST ONE MUSIC TRACK IS RESIDENT once playback settles. Two exist
// transiently — for the length of a crossfade — and the outgoing one is dropped
// when its fade lands.
//
// The sweep is a SWEEP and not a ledger on purpose. Every path that retires a
// track (crossfade in beginPlayback, the hard stop in stopMusic, a skip, a
// rotation, a scene restart that killed the tweens mid-fade) already funnels
// through reapExcept, and each one asks the same question a different way. A
// bookkeeping entry per path is a bookkeeping entry per path to forget. Instead
// this walks the cache and keeps exactly three things:
//
//   1. the committed track (`current`), playing or waiting on the audio unlock,
//   2. the in-flight request (`pending`), which is mid-load or about to start —
//      evicting it would strand playMusic's already-taken `exists()` decision,
//   3. anything still audible, whatever the bookkeeping believes. The reaper's
//      timers and this sweep are independent clocks; a fade that has not landed
//      yet keeps its buffer for one more pass.
//
// Everything else goes. Re-requesting an evicted track is not a special case:
// playMusic asks `cache.audio.exists(key)`, gets false, and takes the ordinary
// lazy-load path it takes for a track that was never loaded at all.

const MUSIC_KEY = /^mus_/;

/** The global cache/sound manager, via any scene we have ever been handed. */
function audioCache() {
  try {
    return lastScene?.cache?.audio
      ?? (typeof window !== 'undefined' ? window.__game?.cache?.audio : null)
      ?? null;
  } catch { return null; }
}
function soundManager() {
  try {
    return lastScene?.sound
      ?? (typeof window !== 'undefined' ? window.__game?.sound : null)
      ?? null;
  } catch { return null; }
}

/**
 * Decoded size of one cache entry, in bytes.
 *
 * Web Audio hands us an AudioBuffer: `length` frames x channels x 4 (Float32).
 * NOTE this is the DECODED rate, not the file's — decodeAudioData resamples
 * everything to the AudioContext's sample rate, which is why re-encoding a file
 * to 22kHz shrinks the download but not the residency unless the context rate
 * moves with it (see tools/build_mobile.py). The HTML5-Audio fallback caches an
 * <audio> element instead, which streams and costs nothing measurable here.
 */
function bufferBytes(buf) {
  return (buf && typeof buf.length === 'number' && buf.numberOfChannels)
    ? buf.length * buf.numberOfChannels * 4
    : 0;
}

/** Drop every decoded music buffer that is not current, pending or audible. */
function evictMusicCache() {
  const cache = audioCache();
  if (!cache) return 0;
  const sm = soundManager();

  const keep = new Set();
  if (current?.key) keep.add(current.key);
  if (pending?.key) keep.add(pending.key);
  for (const snd of live) {
    try { if (snd.isPlaying || snd.isPaused) keep.add(snd.key); } catch { /* freed */ }
  }

  let freed = 0;
  // Snapshot: getKeys() reads the live cache map, which the loop then mutates.
  for (const key of Array.from(cache.getKeys())) {
    if (!MUSIC_KEY.test(key) || keep.has(key)) continue;
    freed += bufferBytes(cache.get(key));
    // ORDER MATTERS. Every Sound built from this key holds its OWN reference to
    // the AudioBuffer, so the cache entry is only the LAST reference once the
    // sounds are gone. Drop the sounds, then the entry.
    try { sm?.removeByKey(key); } catch { /* no manager yet */ }
    try { cache.remove(key); } catch { /* raced with a scene teardown */ }
  }
  return freed;
}

/**
 * `__hfAudioMem()` — what is actually decoded and resident, right now.
 *
 * The number this whole exercise is about, readable from the console and from a
 * driver (tools/verify_audio_mem.py). Pass `true` for the full per-key list;
 * the default keeps the console dump to the ten biggest.
 */
export function audioMem(all = false) {
  const cache = audioCache();
  const sm = soundManager();
  const out = {
    bytes: 0, count: 0,
    music: { count: 0, bytes: 0, keys: [] },
    sfx: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
    current: current?.key ?? null,
    pending: pending?.key ?? null,
    contextRate: null,
    top: [],
  };
  try { out.contextRate = sm?.context?.sampleRate ?? null; } catch { /* html5 audio */ }
  if (!cache) return out;

  const rows = [];
  for (const key of Array.from(cache.getKeys())) {
    const buf = cache.get(key);
    const bytes = bufferBytes(buf);
    const row = {
      key, bytes,
      seconds: buf?.duration ? +buf.duration.toFixed(2) : 0,
      rate: buf?.sampleRate ?? 0,
      channels: buf?.numberOfChannels ?? 0,
    };
    rows.push(row);
    const g = MUSIC_KEY.test(key) ? out.music : key.startsWith('sfx_') ? out.sfx : out.other;
    g.count++; g.bytes += bytes;
    if (g === out.music) out.music.keys.push(row);
    out.count++; out.bytes += bytes;
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  out.top = all ? rows : rows.slice(0, 10);
  out.mb = +(out.bytes / 1048576).toFixed(1);
  out.musicMB = +(out.music.bytes / 1048576).toFixed(1);
  out.sfxMB = +(out.sfx.bytes / 1048576).toFixed(1);
  return out;
}

// Autonomous-playtest hook. Registered at module scope rather than from a scene
// because the question "what is resident?" outlives every individual scene, and
// because the answer must be available on the title screen, before any scene
// that owns a __hf* hook has run. (Same guarded idiom as core/settings.js — the
// unit tests import this module under node, where there is no window.)
try { window.__hfAudioMem = audioMem; } catch { /* node */ }

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

  // Sweep BEFORE adding a third sound, not only on the timer behind the reap.
  // Toggling in and out of the merchant faster than the 780ms reap could leave
  // a straggler resident behind the outgoing track and the incoming one — three
  // buffers where the cap is two. Nothing audible and nothing pending is ever
  // dropped here (the outgoing track is still playing, `key` is still `pending`),
  // so this only ever collects what the last transition already finished with.
  evictMusicCache();

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
  // `key` rides along so the buffer sweep can tell the ONE track it must not
  // evict from the pile it must. See evictMusicCache().
  current = { sound: snd, kind, key };
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
