/**
 * SAVE / RESUME — one parked run, in localStorage.
 *
 * DEPTH: CHECKPOINT AT FIGHT START (JC, 2026-08-02). We do not serialize a live
 * combat — no hand, no intents, no half-resolved scoring. Instead the run is
 * written twice per room: once when the map is standing (a node has fully
 * resolved) and once the instant a fight's line-up is rolled, BEFORE a card is
 * played. Quit mid-fight and you come back to the top of that same fight,
 * against the same enemies, with the state you walked in carrying. Losing a
 * fight and quitting can therefore never reroll it into an easier one.
 *
 * WHAT IS HARD HERE: artifacts and potions are not data. A relic def carries
 * `mods` (often a FUNCTION), `hooks`, `onSell`, `active.use` — JSON would
 * quietly eat all of it and hand back a pretty corpse. So an owned relic is
 * stored as `{ id, state, ...instance overrides }` and REHYDRATED off
 * ARTIFACT_POOL / POTION_BY_ID: the def supplies the behaviour, the save
 * supplies the receipts (Echo Bell's rung count, Kingmaker's crowns, the Suit
 * Prism's conversion list, an egg's fight counter, a shop's marked-up price).
 *
 * ORDER IS LOAD-BEARING: relics resolve LEFT TO RIGHT, so `run.artifacts` must
 * round-trip in exactly the order it was saved — including the nook relics
 * (the Sixth Finger's glove) that acquireArtifact parks at the END of the
 * array. We never re-sort on load.
 *
 * REFUSING CLEANLY: a save from an older build, a bad JSON blob, an artifact id
 * that no longer exists — every one of those returns null instead of throwing.
 * The Title shows one line about it and behaves as if there were no save. A
 * black screen is never an acceptable outcome of loading a file.
 */

import { BUILD, CHARACTERS } from '../config.js';
import { ACTS, actEntry, actSlotFor, endlessLoop, isEndlessIndex } from './acts.js';
import { artifactById } from './artifacts.js';
import { difficultyOf } from './difficulty.js';
import { ENEMY_DEFS } from './enemies.js';
import { POTION_BY_ID } from './potions.js';
import { installRunRng, uninstallRunRng } from './rng.js';
import { freshOracleMods, run } from './run.js';

export const SAVE_KEY = 'handforged_save_v1';
export const SAVE_VERSION = 1;

/**
 * Everything on the run that is honest plain data and round-trips as itself.
 * `artifacts` and `potions` are deliberately absent — they get the instance
 * treatment below. A field missing from a save is left alone on load rather
 * than blanked, so a run that predates a new field keeps whatever the live
 * object had (and `newRun` is the only thing that ever builds those defaults).
 */
const PLAIN_FIELDS = [
  'chrId', 'actIndex', 'totalActs', 'difficulty',
  // ENDLESS: without this a run parked at act index 7 would resume as a
  // finite run standing one act past its own finale — the ceremony would fire
  // recordWin() again and the end screen would say VICTORY. `run.stats` is
  // already here, so the endless depth and its label round trip with it.
  'endless',
  'player', 'runDeck', 'chips', 'artifactSlots', 'handLevels',
  'discardsPerFightBonus', 'startShield',
  // `actPicks` is WHICH WORLD each act turned out to be (Verdant or Nocturnal,
  // Wayside or Plains, Abyss or Gallows). It is rolled once at run start and it
  // has to round trip, or a quit taken in the Nocturnal Forest would resume in
  // the Verdant one — the same class of bug `bossPicks` exists to prevent, one
  // level further out. Plain {index: string}, so it travels as itself.
  'map', 'bossPicks', 'actPicks', 'counters', 'stats', 'seenEvents',
  'bountiesClaimed', 'pendingShopVisit', 'pending', 'bonusMods',
  'pendingFight',
  // THE ORACLE, in both of its states. `pendingOracle` is what makes a run saved
  // BEFORE the choice resume still owing it; `oracle` and `oracleMods` are what
  // make a run saved AFTER it remember what was taken and every channel it set.
  // All three are plain data, so they round trip as themselves.
  'pendingOracle', 'oracle', 'oracleMods',
  // The SEED must round trip or a resumed seeded run silently stops being one.
  'seed',
  // The EGG's queued hatch: plain {id,index,table,mythicChance} rows, never
  // instances, so a quit taken between the last blow and the ceremony still
  // hatches. `mythicChance` is the pre-ladder shape and is still written, so a
  // save moves in both directions between builds.
  'pendingHatch',
];

// ---------------------------------------------------------------------------
// Storage. Node has no localStorage, and a browser in private mode can throw on
// every single call, so every access goes through here and every access can
// fail without taking the game with it. The in-memory fallback is what makes
// `node --test` able to exercise the real write/read/clear path.
// ---------------------------------------------------------------------------

const memoryStore = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
})();

function store() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* private mode: touching it is the error */ }
  return memoryStore;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Is this value safe to put in a save AND get back unchanged? Functions, class
 * instances, Maps and Sets all answer no. Used to decide which INSTANCE
 * OVERRIDES on a relic may travel: a key holding a function must never be
 * written, because on load it would override the def's real function with the
 * hollow thing JSON left behind.
 */
function isPlainData(v, depth = 0) {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (t !== 'object') return false;
  if (depth > 6) return false;
  if (Array.isArray(v)) return v.every(x => isPlainData(x, depth + 1));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v).every(x => isPlainData(x, depth + 1));
}

// ---------------------------------------------------------------------------
// Artifact / potion instances
// ---------------------------------------------------------------------------

/**
 * An owned instance -> `{ id, state, ...overrides }`.
 *
 * An instance is `{ ...def, state }`, so every key it shares with its def is
 * the SAME REFERENCE and gets skipped by identity. What survives the filter is
 * exactly what makes this copy different from the pool entry: `state` (all the
 * growth), and any field a source rewrote on the way in — the shop's
 * `shopPrice` on a mythical being the one that ships today.
 */
function packInstance(inst, def) {
  const out = { id: inst.id };
  if (inst.state && Object.keys(inst.state).length) out.state = clone(inst.state);
  for (const k of Object.keys(inst)) {
    if (k === 'id' || k === 'state') continue;
    const v = inst[k];
    if (def && Object.is(def[k], v)) continue;          // untouched: the def owns it
    if (!isPlainData(v)) continue;                      // a function; the def owns it
    if (def && JSON.stringify(def[k]) === JSON.stringify(v)) continue;
    out[k] = clone(v);
  }
  return out;
}

/**
 * ...and back. The DEF supplies behaviour, the save supplies receipts. State is
 * merged over the def's starting state so a relic that grows a new counter in a
 * later build still gets its default instead of `undefined`.
 */
function unpackInstance(saved, def) {
  const { id, state, ...overrides } = saved;
  return {
    ...def,
    ...overrides,
    id: def.id,
    state: { ...clone(def.state ?? {}), ...clone(state ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

/** Is there a blob under our key at all? True even for one we cannot read. */
export function hasSave() {
  try { return !!store().getItem(SAVE_KEY); } catch { return false; }
}

export function clearSave() {
  try { store().removeItem(SAVE_KEY); } catch { /* nothing we can do, nothing we need to */ }
}

/**
 * Park the run. Returns true when a save was actually written.
 * A run that is not active, or has no hero or no map, is not a run yet.
 */
export function writeSave(r = run) {
  if (!r?.active || !r.chrId || !r.map) return false;
  try {
    const saved = {};
    for (const f of PLAIN_FIELDS) if (r[f] !== undefined) saved[f] = clone(r[f]);
    saved.artifacts = (r.artifacts ?? []).map(a => packInstance(a, artifactById(a.id)));
    saved.potions = (r.potions ?? []).map(p => packInstance(p, POTION_BY_ID[p.id]));
    const payload = { version: SAVE_VERSION, savedAt: Date.now(), build: BUILD, run: saved };
    store().setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;   // quota, private mode, a cycle someone snuck onto the run
  }
}

/** writeSave, but only ever from a live run — the shape every hook site wants. */
export function autosave(r = run) {
  return r?.active ? writeSave(r) : false;
}

/**
 * The validated payload, or null when there is nothing we are willing to load.
 * Null covers all of: no save, bad JSON, wrong version, a hero/act/relic/potion
 * id this build no longer knows. It never throws and never clears — the caller
 * decides whether a refusal deserves a message.
 */
export function readSave() {
  let raw = null;
  try { raw = store().getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;

  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SAVE_VERSION) return null;

  const s = data.run;
  if (!s || typeof s !== 'object') return null;
  if (!CHARACTERS[s.chrId]) return null;
  // The act index is validated through the CYCLE, not through ACTS directly:
  // an endless run is parked at 4, 11, 37... and every one of those is a real
  // act. What is still refused is anything that is not a whole index at all.
  if (!Number.isInteger(s.actIndex) || s.actIndex < 0 || !ACTS[actSlotFor(s.actIndex)]) return null;
  if (!s.player || !s.map?.nodes || typeof s.map.nodes !== 'object') return null;
  if (!Array.isArray(s.runDeck) || !Array.isArray(s.artifacts) || !Array.isArray(s.potions)) return null;
  for (const a of s.artifacts) if (!a?.id || !artifactById(a.id)) return null;
  for (const p of s.potions) if (!p?.id || !POTION_BY_ID[p.id]) return null;
  return data;
}

/**
 * The one line the CONTINUE button wears: "DEXTRA · Act II · Floor 6 · BRONZE".
 * Null when there is no readable save.
 */
export function saveSummary() {
  const data = readSave();
  if (!data) return null;
  const s = data.run;
  const act = actEntry(s.actIndex, s.actPicks?.[s.actIndex]);
  // Mid-fight, WHERE you are is the fight you are standing in, not the last
  // node the map remembers finishing.
  const nodeId = s.pendingFight?.nodeId ?? s.map?.currentId ?? null;
  const node = nodeId ? s.map?.nodes?.[nodeId] : null;
  const floor = node ? node.row + 1 : 0;
  // ENDLESS: "Act I" alone would be a lie on a run seven acts past the finale,
  // so the parked line says which lap it is. Built HERE rather than on the
  // Title screen so the one string has one home and the menu reads a field.
  const actLabel = !act ? 'Act ?'
    : isEndlessIndex(s.actIndex)
      ? `ENDLESS · Loop ${endlessLoop(s.actIndex)} · Act ${act.numeral}`
      : `Act ${act.numeral}`;
  return {
    chrName: CHARACTERS[s.chrId]?.name ?? '?',
    actLabel,
    floor,
    floorLabel: node?.type === 'boss' ? 'THE BOSS' : `Floor ${Math.max(1, floor)}`,
    difficultyLabel: difficultyOf(s).name,
    savedAt: data.savedAt ?? 0,
  };
}

/**
 * Wake the parked run up INSIDE the live `run` object — every scene, every
 * relic hook and every test holds a reference to that one module-level object,
 * so replacing it would strand all of them. Mutating it in place is the point.
 *
 * Returns where to go: `{ scene: 'Combat', nodeId }` when the save was taken at
 * a fight's opening bell, else `{ scene: 'Map' }`. Null when the save was
 * refused (and in that case the unreadable blob is cleared on the way out).
 */
export function resumeRun(r = run) {
  const data = readSave();
  if (!data) { clearSave(); return null; }
  const s = data.run;

  for (const f of PLAIN_FIELDS) if (f in s) r[f] = clone(s[f]);
  // THE ORACLE IS DEFAULTED, NOT INHERITED. Every other field above can safely
  // keep whatever the live object held for a save that predates it, because the
  // live object is only ever written by newRun or by a previous resume. The
  // Oracle's channels are the exception: `run` is a module singleton, so a save
  // written before they existed would otherwise resume holding the LAST run's
  // shop discount. A clean bag, with whatever the save actually recorded merged
  // over it — which also gives a channel added in a later build its default
  // instead of undefined, exactly as unpackInstance does for relic state.
  r.oracleMods = { ...freshOracleMods(), ...(s.oracleMods ?? {}) };
  if (!('pendingOracle' in s)) r.pendingOracle = false;
  if (!('oracle' in s)) r.oracle = null;
  // THE SEED IS DEFAULTED TOO, for the same singleton reason: a save written
  // before seeds existed must not resume wearing the LAST run's seed. When one
  // IS recorded, the Math.random swap is reinstalled — SALTED by the act, so a
  // reload cannot scout the next shop by replaying the stream from the top.
  // The run's SKELETON needs no such care: maps and bosses are per-context
  // streams and are already sitting in the save besides.
  if (!('seed' in s)) r.seed = null;
  // ...and the ENDLESS flag, for the same singleton reason: a save written
  // before the endless existed (or by a finite run) must not resume wearing the
  // LAST run's continuation.
  if (!('endless' in s)) r.endless = false;
  if (r.seed) installRunRng(r.seed, `load${r.actIndex ?? 0}`);
  else uninstallRunRng();
  // ORDER PRESERVED EXACTLY: relics resolve left to right and nook relics stay
  // parked at the end, precisely as they were saved. No re-sinking, no sorting.
  r.artifacts = s.artifacts.map(a => unpackInstance(a, artifactById(a.id)));
  r.potions = s.potions.map(p => unpackInstance(p, POTION_BY_ID[p.id]));
  r.active = true;
  r.debugEncounter = null;

  const pf = r.pendingFight;
  if (pf?.nodeId && r.map?.nodes?.[pf.nodeId]) {
    // SAME ENEMIES, NOT A NEW ROLL. CombatScene already has a path that fields
    // an exact list of def ids (the dev forceEncounter hook); we reuse it
    // rather than growing a second way to say the same thing.
    //
    // ALL OR NOTHING on the line-up: if a build has retired even one of these
    // enemies, fielding the survivors would hand back an easier fight than the
    // one that was quit. Better to let the room roll itself fresh. Either way
    // you still have to fight it — the room is not skippable.
    const known = Array.isArray(pf.defIds) && pf.defIds.length && pf.defIds.every(id => ENEMY_DEFS[id]);
    r.debugEncounter = known ? [...pf.defIds] : null;
    return { scene: 'Combat', nodeId: pf.nodeId };
  }
  r.pendingFight = null;
  return { scene: 'Map', nodeId: r.map?.currentId ?? null };
}
