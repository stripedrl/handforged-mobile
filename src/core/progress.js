/** Persistent player progress — unlocks and stats (localStorage). */

import { HAND_DEFS, HAND_TYPES } from './poker.js';
import { CHARACTERS } from '../config.js';
import { DIFFICULTIES, MAX_DIFFICULTY } from './difficulty.js';
// THE RUN'S UNLOCK LEDGER (2026-08-04). Every unlock in the game is written by
// one of the four functions below, so the ledger hangs off them and cannot miss
// one. unlocks.js imports nothing at all, which is what keeps this edge free.
import { noteUnlock } from './unlocks.js';

const KEY = 'handforged_progress_v1';

export const progress = {
  runs: 0,
  wins: 0,
  bestAct: 0,          // highest act ever cleared (1-4)
  act4Unlocked: false,
  endlessUnlocked: false,
  // SECRET HANDS: a hand type marked `secret` in HAND_DEFS stays hidden — off
  // the Smith's shelf, a '???' row on the hands chart — until the player
  // actually plays it once. That moment is remembered FOREVER, across runs,
  // which is the whole reward: you found it, it's yours from now on.
  discoveredHands: [],
  // Shown HOW TO PLAY once, automatically, on the first ever PLAY. Latched
  // separately from `runs` so wiping runs cannot re-teach a veteran.
  tutorialSeen: false,
  // EVERY HAND TYPE EVER PLAYED, secrets included. discoveredHands deliberately
  // only ever records the SECRET hands (that is its whole job, and widening it
  // would un-hide them), so FULL REPERTOIRE needs its own list. Ids only, no
  // counts: "have you ever" is the only question anything asks of it.
  playedHands: [],
  // ACHIEVEMENTS: the ids the player has actually earned, forever. A RECORD OF
  // WHAT YOU DID, which is why UNLOCK ALL (testers) deliberately does not touch
  // it — see unlockEverything. Ids only; the names, lines and hints live in
  // core/achievements.js so a save never carries stale copy.
  achievements: [],
  // DIFFICULTY LADDER, PER HERO: chrId -> the highest mode INDEX that hero has
  // cleared Act III on. Clearing on N unlocks N+1 for that hero only, so every
  // champion earns their own way up. Absent hero = has never cleared = BRONZE
  // only, which is what an empty object already says.
  difficultyCleared: {},
  // UNLOCK ALL's difficulty grant, kept SEPARATE from the record above.
  //
  // `difficultyCleared` was doing two jobs: it says which modes you may PICK
  // (content) and it is the RECORD of which rungs you actually beat (history).
  // UNLOCK ALL needs the first and must never fabricate the second, because
  // `isSkinUnlocked` and the five LADDER trophies both read the record — so
  // writing MAX_DIFFICULTY for every hero handed a tester 30 of the 50 skins,
  // five achievements and, through them, a trophy-gated relic, breaking the
  // "UNLOCK ALL grants no achievements" rule from the other end.
  allDifficulties: false,
  // THE WARDROBE (2026-08-03): chrId -> the skin id that hero is wearing. Absent
  // hero = the shipped model, which is what an empty object already says. Only
  // the CHOICE lives here; whether a skin is EARNED is derived every time it is
  // read (core/skins.js isSkinUnlocked), so a reset profile cannot keep wearing
  // something it no longer owns and a hand-edited save cannot grant one.
  equippedSkins: {},
  // LIFETIME RECORDS (2026-08-05). run.stats is the ledger of ONE run and dies
  // with it; this is the shelf that ONE run can only ever add to. Maxima take
  // the max, tallies take the sum, and a SEEDED run contributes nothing at all
  // — the same rule the difficulty ladder already lives by, for the same
  // reason: a seed is replayable, so a record set on one is a record you can
  // farm. Shape is fixed by freshRecords() below; see foldRunIntoRecords.
  records: {},
};

try {
  Object.assign(progress, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
} catch { /* fresh */ }
// An old save (or a hand-edited one) has no list, or junk where the list goes.
if (!Array.isArray(progress.discoveredHands)) progress.discoveredHands = [];
// Same guard, same reason: a save written before FULL REPERTOIRE existed has no
// list at all, and a hand-edited one can have anything. Junk is dropped —
// but UNKNOWN STRINGS ARE KEPT (2026-08-04, JC: "make sure progress saves even
// despite achievement changes and new-unlocks type events"). This used to
// filter against HAND_DEFS, which meant renaming a hand type in a patch would
// silently erase the record of ever having played it, and with it FULL
// REPERTOIRE's progress. An id nobody recognises is inert, not junk.
if (!Array.isArray(progress.playedHands)) progress.playedHands = [];
progress.playedHands = progress.playedHands.filter(t => typeof t === 'string' && t);
// Same guard for the trophy list: an old save has no array, a hand-edited one
// can have anything. Junk entries are dropped rather than crashing the shelf.
if (!Array.isArray(progress.achievements)) progress.achievements = [];
progress.achievements = progress.achievements.filter(id => typeof id === 'string' && id);
sanitizeRecords();
sanitizeDifficultyCleared();
// A hand-edited save can put anything here; only a real boolean grants the ladder.
progress.allDifficulties = progress.allDifficulties === true;
backfillActTrophies();
// The wardrobe is a plain string map. An old save has none; a hand-edited one
// can have an array, a number, or nested junk. Anything that is not
// hero -> string is dropped, and the ENTITLEMENT is never read from here at all.
if (!progress.equippedSkins || typeof progress.equippedSkins !== 'object'
    || Array.isArray(progress.equippedSkins)) {
  progress.equippedSkins = {};
} else {
  for (const [chrId, v] of Object.entries(progress.equippedSkins)) {
    if (!chrId || typeof v !== 'string' || !v) delete progress.equippedSkins[chrId];
  }
}

/**
 * A save written before difficulty existed has no map at all; a hand-edited one
 * can have anything ("mythril", -3, an array, null). Everything that is not a
 * usable hero->index pair is dropped, and every index is clamped into the real
 * table, so no junk on disk can ever unlock a mode that does not exist or crash
 * the picker.
 */
/**
 * MIGRATION: back-fill the four ACT-CLEAR trophies from `bestAct`.
 *
 * `bestAct` has recorded the deepest act ever cleared since long before the
 * achievements wave existed, and three separate systems have since been hung
 * off the trophies that fire on the SAME event: OPHELIA (unlock: 'actFour'),
 * the four biome unlocks, and the Crucible's own gate. A profile written
 * before the trophies existed therefore says "I cleared Act IV" and "I own no
 * trophies" at the same time — and the result is a veteran booting this build
 * to find a hero they used to play is now locked behind something they have
 * already done, with all four alternate worlds locked with her.
 *
 * This is NOT the same thing as UNLOCK ALL granting trophies. Nothing is
 * invented here: `bestAct` IS the record, and the trophy is only the newer
 * spelling of it. Anything the old profile cannot prove stays unearned.
 */
function backfillActTrophies() {
  const ids = ['actOne', 'actTwo', 'actThree', 'actFour'];
  const best = Math.floor(Number(progress.bestAct));
  if (!Number.isFinite(best) || best < 1) return 0;
  let added = 0;
  for (const id of ids.slice(0, Math.min(best, ids.length))) {
    if (!progress.achievements.includes(id)) { progress.achievements.push(id); added += 1; }
  }
  if (added) saveProgress();
  return added;
}

function sanitizeDifficultyCleared() {
  const raw = progress.difficultyCleared;
  const clean = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [chrId, value] of Object.entries(raw)) {
      const n = Math.floor(Number(value));
      if (!chrId || !Number.isFinite(n) || n < 0) continue;
      clean[chrId] = Math.min(n, MAX_DIFFICULTY);
    }
  }
  progress.difficultyCleared = clean;
}

export function saveProgress() {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private mode */ }
}

export function recordRunStart() {
  progress.runs += 1;
  saveProgress();
}

/**
 * Called when an act's boss dies. Returns any unlock message to toast.
 *
 * `chrId` / `difficulty` are optional so every older caller still works, but
 * passing them is what walks the per-hero difficulty ladder: ACT III is the
 * gate, and clearing it on mode N opens N+1 for THAT hero. Two unlocks can land
 * on the same kill (the first ever Act III clear opens the Crucible AND IRON),
 * so the toasts stack onto one string rather than one shouting over the other.
 */
export function recordActClear(actNumber, chrId = null, difficulty = 0) {
  const lines = [];
  if (actNumber > progress.bestAct) progress.bestAct = actNumber;
  if (actNumber === 3 && !progress.act4Unlocked) {
    progress.act4Unlocked = true;
    noteUnlock({ kind: 'mode', id: 'act4' });
    lines.push('SECRET ACT UNLOCKED. Your next run goes deeper.');
  }
  if (actNumber === 4 && !progress.endlessUnlocked) {
    progress.endlessUnlocked = true;
    noteUnlock({ kind: 'mode', id: 'endless' });
    lines.push('ENDLESS MODE UNLOCKED!');
  }
  if (actNumber === 3 && chrId) {
    const opened = recordDifficultyClear(chrId, difficulty);
    if (opened) lines.push(`${opened.toUpperCase()} DIFFICULTY UNLOCKED for this hero`);
  }
  saveProgress();
  return lines.length ? lines.join('\n') : null;
}

// ---------------------------------------------------------------------------
// THE DIFFICULTY LADDER (per hero)
// ---------------------------------------------------------------------------

/**
 * The highest mode index this hero has CLEARED Act III on. -1 = never.
 *
 * Re-validated on every read, not just at load: the sanitiser can only clean
 * what was on disk at startup, and this is the one door the picker asks
 * through. Anything that is not a real rung reads as "never cleared".
 */
export function highestDifficultyCleared(chrId) {
  const n = Math.floor(Number(progress.difficultyCleared?.[chrId]));
  if (!Number.isFinite(n) || n < 0) return -1;
  return Math.min(n, MAX_DIFFICULTY);
}

/**
 * The highest mode index this hero may PLAY. BRONZE (0) is always available, so
 * a hero who has cleared nothing still gets one mode, and clearing on N opens
 * exactly one more rung.
 */
export function highestDifficultyUnlocked(chrId) {
  // The tester grant is entitlement only; it never pretends a rung was cleared.
  if (progress.allDifficulties === true) return MAX_DIFFICULTY;
  return Math.min(Math.max(highestDifficultyCleared(chrId) + 1, 0), MAX_DIFFICULTY);
}

/** May this hero pick this mode? */
export function isDifficultyUnlocked(chrId, index) {
  return index <= highestDifficultyUnlocked(chrId);
}

/**
 * Bank an Act III clear. Returns the NAME of the mode this just opened, or null
 * when it opened nothing (a repeat clear, or the top of the ladder). Only ever
 * raises the record: clearing Bronze after Diamond takes nothing away.
 */
export function recordDifficultyClear(chrId, index) {
  if (!chrId) return null;
  const cleared = Math.min(Math.max(Math.floor(Number(index)) || 0, 0), MAX_DIFFICULTY);
  progress.difficultyCleared ??= {};
  const before = highestDifficultyCleared(chrId);
  if (cleared <= before) { saveProgress(); return null; }
  progress.difficultyCleared[chrId] = cleared;
  saveProgress();
  // THE LADDER MOVED, and it opens two things at once: the rung above (content)
  // and every LADDER SKIN at or below the rung just cleared (a record). The
  // recap needs both ends of that range to name what is new, so it banks both.
  noteUnlock({ kind: 'difficulty', chrId, from: before, to: cleared });
  if (cleared >= MAX_DIFFICULTY) return null;   // nothing above the top rung
  return DIFFICULTIES[cleared + 1].name;
}

// ---------------------------------------------------------------------------
// LIFETIME RECORDS (2026-08-05)
//
// The one shelf in the game that answers "what is the best I have EVER done",
// as opposed to the trophy case ("what have I done at all") and the run recap
// ("what did I just do"). It is folded EXACTLY ONCE per run, at the end screen,
// out of the same run.stats the recap prints — so the numbers on the shelf and
// the numbers on the report card can never disagree.
//
// SEEDED RUNS ARE EXCLUDED ENTIRELY. Same rule, same reason as the difficulty
// ladder: a seed is a world you can replay until it pays, so a record set on
// one is a record you farmed rather than found. Content still unlocks on a
// seeded run; history does not bank.
// ---------------------------------------------------------------------------

/** The maxima: a run can only ever BEAT one of these, never add to it. */
export const RECORD_MAXIMA = ['maxHandDamage', 'maxHandShield', 'maxPoisonStack'];
/** The counters: every run adds its own to the pile. */
export const RECORD_COUNTERS = ['handsPlayed', 'discardsUsed'];
/** The tally maps: key -> count, summed across every run. */
export const RECORD_TALLIES = ['handTypeCounts', 'cardPlays'];

/** An empty shelf, in the exact shape everything downstream expects. */
export function freshRecords() {
  return {
    // The headline record carries its CONTEXT, because "4.2M" without "with
    // whom, off what hand" is a number and not a story. The other two maxima
    // are plain: nobody asks which hand plated the shield.
    maxHandDamage: { value: 0, hero: '', hand: '' },
    maxHandShield: 0,
    maxPoisonStack: 0,
    handsPlayed: 0,
    discardsUsed: 0,
    handTypeCounts: {},
    cardPlays: {},
    // ------------------------------------------------------------------
    // ENDLESS — A CONTRACT, NOT A FEATURE OF THIS FILE (2026-08-05).
    //
    // These two fields are created here and DISPLAYED by the RECORDS overlay.
    // They were declared one workstream ahead of the code that fills them; the
    // ENDLESS workstream landed the write, and it landed it inside
    // foldRunIntoRecords below rather than in a ceremony, so the seeded-run
    // exclusion and the fold-once latch cover it exactly as they cover every
    // other record. One records object, one sanitiser, one import merge.
    // ------------------------------------------------------------------
    bestEndlessDepth: 0,
    bestEndlessLabel: '',
  };
}

/** A non-negative integer, or 0 — the only thing a record number may be. */
function recNum(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** key -> positive integer, junk dropped. Unknown KEYS are kept (see below). */
function recTally(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [k, v] of Object.entries(raw)) {
    // Unknown hand/card names are kept on purpose, exactly as playedHands keeps
    // unknown ids: renaming a hand type in a patch must not erase the record of
    // having played it a thousand times. An id nobody recognises is inert.
    const n = recNum(v);
    if (k && n > 0) clean[k] = n;
  }
  return clean;
}

/**
 * A save written before records existed has none; a hand-edited one can have an
 * array, a string, negative numbers or nested junk. Everything that is not the
 * shape above is replaced by the empty version of itself, so no save on disk
 * can crash the overlay or fabricate a record.
 */
function sanitizeRecords() {
  const raw = progress.records;
  const clean = freshRecords();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const dmg = raw.maxHandDamage;
    if (dmg && typeof dmg === 'object' && !Array.isArray(dmg)) {
      clean.maxHandDamage = {
        value: recNum(dmg.value),
        hero: typeof dmg.hero === 'string' ? dmg.hero : '',
        hand: typeof dmg.hand === 'string' ? dmg.hand : '',
      };
    } else {
      // A pre-context save (or a hand-edited one) may store a bare number.
      clean.maxHandDamage = { value: recNum(dmg), hero: '', hand: '' };
    }
    clean.maxHandShield = recNum(raw.maxHandShield);
    clean.maxPoisonStack = recNum(raw.maxPoisonStack);
    clean.handsPlayed = recNum(raw.handsPlayed);
    clean.discardsUsed = recNum(raw.discardsUsed);
    clean.handTypeCounts = recTally(raw.handTypeCounts);
    clean.cardPlays = recTally(raw.cardPlays);
    clean.bestEndlessDepth = recNum(raw.bestEndlessDepth);
    clean.bestEndlessLabel = typeof raw.bestEndlessLabel === 'string' ? raw.bestEndlessLabel : '';
  }
  progress.records = clean;
  return clean;
}

/** The number half of a record, whichever shape it wears. */
export function recordValue(key) {
  const rec = progress.records ?? {};
  return key === 'maxHandDamage' ? (rec.maxHandDamage?.value ?? 0) : (rec[key] ?? 0);
}

/**
 * Fold a finished run into the lifetime shelf. Called EXACTLY ONCE per run,
 * from CombatScene.showEnd — which can re-render (the panel rebuilds on a
 * resize, and the scroller redraws), hence the latch on the run's own stats:
 * the guard travels with the run, so nothing outside this module has to
 * remember whether it already called.
 *
 * @param {{seed?:string, chrId?:string, counters?:Object, stats?:Object}} r the run
 * @returns {string[]} the MAXIMA this run just beat ('maxHandDamage', ...), in
 *          table order. Empty on a seeded run, a second call, or a quiet run.
 */
export function foldRunIntoRecords(r) {
  const st = r?.stats;
  if (!st) return [];
  // Seeds are replayable; records are not farmable. Deliberately BEFORE the
  // latch, so nothing about a seeded run is written anywhere.
  if (r.seed) return [];
  if (st.recordsFolded) return [];
  st.recordsFolded = true;

  const rec = progress.records ?? sanitizeRecords();
  const beaten = [];

  const dmg = recNum(st.maxHandDamage);
  if (dmg > (rec.maxHandDamage?.value ?? 0)) {
    rec.maxHandDamage = {
      value: dmg,
      hero: typeof r.chrId === 'string' ? r.chrId : '',
      // Written at the same moment the run's own max was set — see
      // CombatScene.noteHandStats. An old save has none, which prints as
      // a bare number rather than a lie.
      hand: typeof st.maxHandDamageHand === 'string' ? st.maxHandDamageHand : '',
    };
    beaten.push('maxHandDamage');
  }
  const shield = recNum(st.maxHandShield);
  if (shield > rec.maxHandShield) { rec.maxHandShield = shield; beaten.push('maxHandShield'); }
  const poison = recNum(st.maxPoisonStack);
  if (poison > rec.maxPoisonStack) { rec.maxPoisonStack = poison; beaten.push('maxPoisonStack'); }

  // THE ENDLESS DEPTH, folded as a MAXIMUM with its label in tow (2026-08-05).
  // It inherits the seeded-run exclusion and the fold-once latch above for
  // free, which is the whole reason the write lives in here rather than in the
  // endless ceremony. The LABEL is only ever replaced when the DEPTH moves, or
  // the shelf would print one run's number under another run's world.
  //
  // `endlessDepthLabel`, NOT `endlessLabel`. The latter names the deepest act
  // REACHED and is one act ahead of the depth on every run that dies past its
  // last clear — clear endless I-III, die in IV, and the shelf read "3" under
  // "Loop 1 · Act IV". run.noteEndlessClear stamps the CLEARED act's label at
  // the moment it is cleared, so the two can no longer drift.
  const depth = recNum(st.endlessDepth);
  if (depth > (rec.bestEndlessDepth ?? 0)) {
    rec.bestEndlessDepth = depth;
    rec.bestEndlessLabel = typeof st.endlessDepthLabel === 'string' ? st.endlessDepthLabel : '';
  }

  // handsPlayed lives on the run's COUNTERS, not its stats — the recap reads it
  // from there too, and there is only meant to be one of them.
  rec.handsPlayed += recNum(r.counters?.handsPlayed);
  rec.discardsUsed += recNum(st.discardsUsed);
  for (const map of RECORD_TALLIES) {
    for (const [k, v] of Object.entries(st[map] ?? {})) {
      const n = recNum(v);
      if (!k || !n) continue;
      rec[map][k] = (rec[map][k] ?? 0) + n;
    }
  }

  saveProgress();
  return beaten;
}

/** DEV / tests: empty the lifetime shelf. */
export function resetRecords() {
  progress.records = freshRecords();
  saveProgress();
}

// ---------------------------------------------------------------------------
// ACHIEVEMENTS (the ids only — the data lives in core/achievements.js)
// ---------------------------------------------------------------------------

/** Has this trophy been earned? */
export function isAchievementUnlocked(id) {
  return progress.achievements.includes(id);
}

/**
 * Earn one. Returns TRUE only the first time, which is what the toast keys off:
 * every fire path can call this as often as it likes and the player is
 * congratulated exactly once, ever.
 */
export function unlockAchievement(id) {
  if (!id || progress.achievements.includes(id)) return false;
  progress.achievements.push(id);
  saveProgress();
  noteUnlock({ kind: 'achievement', id });
  return true;
}

/**
 * IS THIS HERO OPEN? (2026-08-03, Drusky.)
 *
 * A hero is playable unless their CHARACTERS entry names an achievement in
 * `unlock`, in which case the trophy has to be on the shelf. Reading the gate
 * off the character table rather than off a list in here means adding a locked
 * hero is one field, and means the character select screen never has to know
 * which hero is gated by what.
 *
 * It goes through isAchievementUnlocked, which is exactly why UNLOCK ALL cannot
 * open Drusky: that function deliberately grants no achievements (see the note
 * above it). A locked hero is a record of something you did, not content.
 */
export function isCharacterUnlocked(chrId) {
  const need = CHARACTERS[chrId]?.unlock;
  return !need || isAchievementUnlocked(need);
}

/** Every hero id that is open right now, in table order. */
export function unlockedCharacterIds() {
  return Object.keys(CHARACTERS).filter(isCharacterUnlocked);
}

/** DEV / tests: empty the trophy case again. */
export function resetAchievements() {
  progress.achievements = [];
  saveProgress();
}

/**
 * UNLOCK ALL (testers). Opens the Crucible, Endless, every secret hand and the
 * whole difficulty ladder for every hero, WITHOUT turning on DEV MODE: a tester
 * needs the content, not the WIN button. Returns a short summary line.
 *
 * ACHIEVEMENTS ARE DELIBERATELY NOT INCLUDED (2026-08-02). Every other unlock
 * here is CONTENT — an act, a mode, a hand the shop may now offer — and a
 * tester needs all of it to test. An achievement is not content: it is a record
 * of something you actually did, and handing a tester a full trophy case both
 * lies about their history and destroys the only shelf in the game that cannot
 * be re-earned. Say the word and it flips, but it should not.
 *
 * `playedHands` is out for the same reason and one more (2026-08-02): it is the
 * record FULL REPERTOIRE reads, and that trophy is what unlocks the Perpetual
 * Engine. Filling it here would hand a tester a gated relic through the back
 * door. discoveredHands stays in, because a secret hand being on the Smith's
 * shelf is content; having PLAYED it is history.
 */
export function unlockEverything() {
  progress.act4Unlocked = true;
  progress.endlessUnlocked = true;
  progress.discoveredHands = [...HAND_TYPES];
  // THE WHOLE LADDER, WITHOUT CLAIMING TO HAVE CLIMBED IT. This used to write
  // `difficultyCleared[chrId] = MAX_DIFFICULTY` for every hero, which opened
  // the picker (the intent) and ALSO handed over the thirty ladder skins and
  // the five LADDER trophies, both of which read that same map as history —
  // and one of those trophies gates a relic. `allDifficulties` is the
  // entitlement half on its own, so the record stays true.
  progress.allDifficulties = true;
  saveProgress();
  return 'Everything unlocked. Acts, difficulties and secret hands.';
}

export function recordWin() {
  progress.wins += 1;
  saveProgress();
}

// ---------------------------------------------------------------------------
// SECRET HAND DISCOVERY
// ---------------------------------------------------------------------------

/**
 * Is this hand type visible to the player? Every normal hand always is; a
 * secret one only after it has been played at least once, ever.
 * @param {string} type
 */
export function isHandDiscovered(type) {
  const def = HAND_DEFS[type];
  if (!def) return false;
  if (!def.secret) return true;
  return progress.discoveredHands.includes(type);
}

/** The hand types the Smith may offer / the chart may price, in ladder order. */
export function discoveredHandTypes() {
  return HAND_TYPES.filter(isHandDiscovered);
}

/**
 * Called the moment a hand is committed. Returns the display NAME when this
 * play just uncovered a secret (so the scene can announce it), else null.
 * @param {string} type
 * @returns {string|null}
 */
export function discoverHand(type) {
  const def = HAND_DEFS[type];
  if (!def?.secret || progress.discoveredHands.includes(type)) return null;
  progress.discoveredHands.push(type);
  saveProgress();
  noteUnlock({ kind: 'hand', id: type });
  return def.name;
}

/**
 * Bank a hand type as PLAYED, forever. Called from the same line that discovers
 * a secret, so every hand the game resolves lands here exactly once. Returns
 * TRUE the first time a type is seen, which is all FULL REPERTOIRE needs.
 */
export function notePlayedHand(type) {
  if (!HAND_DEFS[type] || progress.playedHands.includes(type)) return false;
  progress.playedHands.push(type);
  saveProgress();
  return true;
}

// ---------------------------------------------------------------------------
// PROFILE EXPORT / IMPORT (2026-08-04)
// ---------------------------------------------------------------------------
// JC: "I don't want to go unlock everything every time and I also don't want
// to press the unlock all button necessarily." The silent thief here is the
// BROWSER ORIGIN: the dev server, the built preview and itch.io are three
// different origins, and localStorage does not cross them — so a profile
// earned on one looks wiped on the next. These two functions turn a profile
// into a code you can carry across (settings menu: COPY / PASTE PROFILE).
//
// IMPORT MERGES, NEVER OVERWRITES: unions and maxima only, so pasting an OLD
// code can never downgrade what this browser has since earned — and pasting
// twice is a no-op. Junk codes are refused with null, never a throw.
// ---------------------------------------------------------------------------

const PROFILE_TAG = 'HF1.';

/** The whole profile as a shareable one-line code. */
export function exportProfile() {
  return PROFILE_TAG + btoa(unescape(encodeURIComponent(JSON.stringify(progress))));
}

/**
 * Merge a code into this browser's profile. Returns a short receipt string,
 * or null when the code is not one of ours.
 */
export function importProfile(code) {
  let data;
  try {
    const raw = String(code ?? '').trim();
    if (!raw.startsWith(PROFILE_TAG)) return null;
    data = JSON.parse(decodeURIComponent(escape(atob(raw.slice(PROFILE_TAG.length)))));
  } catch { return null; }
  if (!data || typeof data !== 'object') return null;

  const before = JSON.stringify(progress);
  const strings = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s) : []);
  const union = (mine, theirs) => [...new Set([...mine, ...strings(theirs)])];

  progress.runs = Math.max(progress.runs ?? 0, Number(data.runs) || 0);
  progress.wins = Math.max(progress.wins ?? 0, Number(data.wins) || 0);
  progress.bestAct = Math.max(progress.bestAct ?? 0, Number(data.bestAct) || 0);
  progress.act4Unlocked = progress.act4Unlocked || data.act4Unlocked === true;
  progress.endlessUnlocked = progress.endlessUnlocked || data.endlessUnlocked === true;
  progress.tutorialSeen = progress.tutorialSeen || data.tutorialSeen === true;
  progress.allDifficulties = progress.allDifficulties || data.allDifficulties === true;
  progress.achievements = union(progress.achievements, data.achievements);
  progress.discoveredHands = union(progress.discoveredHands, data.discoveredHands);
  progress.playedHands = union(progress.playedHands, data.playedHands);
  if (data.difficultyCleared && typeof data.difficultyCleared === 'object') {
    for (const [chr, v] of Object.entries(data.difficultyCleared)) {
      const n = Math.floor(Number(v));
      if (!chr || !Number.isFinite(n) || n < 0) continue;
      const mine = Math.floor(Number(progress.difficultyCleared?.[chr]));
      progress.difficultyCleared[chr] = Math.min(MAX_DIFFICULTY,
        Math.max(Number.isFinite(mine) ? mine : -1, n));
    }
  }
  if (data.equippedSkins && typeof data.equippedSkins === 'object' && !Array.isArray(data.equippedSkins)) {
    for (const [chr, id] of Object.entries(data.equippedSkins)) {
      if (chr && typeof id === 'string' && id && !progress.equippedSkins[chr]) {
        progress.equippedSkins[chr] = id;
      }
    }
  }
  // --- LIFETIME RECORDS: per-key MAX, everywhere, including the tallies ----
  //
  // The maxima are obvious. The TALLIES are the subtle one: they accumulate by
  // SUM when a run folds, but they must merge by MAX, because import is not a
  // run — pasting the same code twice would otherwise double every count, and
  // pasting your own code back after a session would inflate it forever. MAX is
  // idempotent, which is the property the whole "import merges, never
  // overwrites, and twice is a no-op" contract is built on.
  if (data.records && typeof data.records === 'object' && !Array.isArray(data.records)) {
    const theirs = data.records;
    const rec = progress.records;
    const theirDmg = theirs.maxHandDamage;
    const theirDmgVal = recNum(theirDmg && typeof theirDmg === 'object' ? theirDmg.value : theirDmg);
    if (theirDmgVal > (rec.maxHandDamage?.value ?? 0)) {
      rec.maxHandDamage = {
        value: theirDmgVal,
        hero: typeof theirDmg?.hero === 'string' ? theirDmg.hero : '',
        hand: typeof theirDmg?.hand === 'string' ? theirDmg.hand : '',
      };
    }
    // The label travels with the depth it names, or the shelf prints one
    // browser's number under the other browser's world. Read BEFORE the max
    // below moves the goalposts.
    // A blank label is the honest answer when THEIR depth wins but their label
    // is junk: keeping MINE would print my world under their number, which is
    // the exact drift this block exists to prevent.
    if (recNum(theirs.bestEndlessDepth) > (rec.bestEndlessDepth ?? 0)) {
      rec.bestEndlessLabel = typeof theirs.bestEndlessLabel === 'string'
        ? theirs.bestEndlessLabel : '';
    }
    for (const key of ['maxHandShield', 'maxPoisonStack', ...RECORD_COUNTERS, 'bestEndlessDepth']) {
      rec[key] = Math.max(rec[key] ?? 0, recNum(theirs[key]));
    }
    for (const map of RECORD_TALLIES) {
      for (const [k, v] of Object.entries(recTally(theirs[map]))) {
        rec[map][k] = Math.max(rec[map][k] ?? 0, v);
      }
    }
  }
  // The migration that backfills act trophies from bestAct applies to an
  // imported record for exactly the reason it applies to an old one.
  backfillActTrophies();
  saveProgress();
  return before === JSON.stringify(progress)
    ? 'Nothing new: this browser already had all of it.'
    : `Merged: ${progress.achievements.length} trophies, best act ${progress.bestAct}.`;
}

/** DEV / tests: forget every secret hand again. */
export function resetDiscoveredHands() {
  progress.discoveredHands = [];
  progress.playedHands = [];
  saveProgress();
}
