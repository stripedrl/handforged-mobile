/**
 * @file unlocks.js
 * THE RUN'S UNLOCK LEDGER — what this playthrough opened that was shut when it
 * started.
 *
 * JC, 2026-08-04: "At the end of a reach there should be an 'unlocks' section
 * that lists new things you've unlocked during your playthrough: new biomes,
 * new skins, etc. If you unlocked nothing then the section shouldn't appear."
 *
 * ------------------------------------------------------------------------
 * WHY IT IS ITS OWN FILE, AND WHY IT IMPORTS NOTHING
 * ------------------------------------------------------------------------
 * Every unlock in HANDFORGED already routes through exactly one function in
 * core/progress.js — unlockAchievement, recordDifficultyClear, recordActClear,
 * discoverHand — and those four are the only places anything is ever written to
 * the profile. So the ledger hangs off THEM rather than off the dozen scenes
 * that call them, and it cannot miss one.
 *
 * progress.js sits near the bottom of the import graph, so this module holds no
 * imports at all: it records IDS and nothing else. What an id MEANS (which skin
 * a trophy dresses, which biome an act clear opened, what a difficulty rung is
 * called) is resolved at READ time by ui/runRecap.js, which is free to import
 * the whole world. That split is deliberate — the recording half must never be
 * able to close a cycle through the file it is recording from.
 *
 * IT IS PER RUN, IN MEMORY, AND NEVER SAVED. The end screen is the only reader,
 * and a run that ends is over: nothing wants yesterday's list.
 */

/**
 * @typedef {Object} UnlockEntry
 * @property {'achievement'|'difficulty'|'hand'|'mode'} kind
 * @property {string} [id]      achievement id · hand type · mode id
 * @property {string} [chrId]   which hero a difficulty rung belongs to
 * @property {number} [from]    the rung they had cleared before (-1 = none)
 * @property {number} [to]      ...and the rung they cleared now
 */

/** @type {UnlockEntry[]} */
let ledger = [];

/** Wipe it. Called by newRun, so a second run never inherits the first's news. */
export function resetRunUnlocks() {
  ledger = [];
}

/**
 * Record one. Deduped on kind+id+chrId, because several of these fire from
 * predicates that are swept on every event and would otherwise repeat.
 * @param {UnlockEntry} entry
 */
export function noteUnlock(entry) {
  if (!entry?.kind) return null;
  const key = `${entry.kind}:${entry.id ?? ''}:${entry.chrId ?? ''}`;
  if (ledger.some(e => `${e.kind}:${e.id ?? ''}:${e.chrId ?? ''}` === key)) return null;
  ledger.push(entry);
  return entry;
}

/** Everything this run opened, in the order it happened. */
export function runUnlocks() {
  return ledger.slice();
}

/** Did it open anything at all? The end screen's whole test. */
export function anyUnlocks() {
  return ledger.length > 0;
}
