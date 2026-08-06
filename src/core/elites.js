/**
 * @file elites.js
 * ELITE SPOILS — what comes off the body, and what a FORGED elite pays instead.
 *
 * PATCH 0803 §2. An elite used to drop three RELICS and nothing else. It now
 * drops three THINGS: one weighted pool holding artifacts AND potions, each
 * rolled at its own rarity odds, still offered as the usual pick-1-of-3.
 *
 * THE DESIGNER'S RULING (marked [ANSWERED] in docs/PATCH_0803.txt): at least one
 * of the three is ALWAYS an artifact; the other two roll freely. That ruling
 * lands on top of the earlier line about three potions being "possible, just
 * unlikely" and overrides it — three potions is now impossible by construction,
 * which is the point of a guarantee. The guarantee is applied AFTER the free
 * roll and replaces a RANDOM slot rather than reserving slot 0, so the shelf
 * never leaks which pedestal was the promised one.
 *
 * WHY THIS FILE EXISTS AT ALL: the roll needs both ARTIFACT_POOL and
 * POTION_POOL, and neither of those two modules should learn about the other.
 * A leaf module that reads both keeps the mixing rule in one place and, being
 * free of Phaser, stays unit-testable in plain Node.
 */

import { ARTIFACT_POOL, ARTIFACT_RARITY, eligibleFor, rarityWeight, rollEliteDrop } from './artifacts.js';
import { POTION_POOL, POTION_RARITY_ORDER } from './potions.js';

/** How many things stand on the shelf. */
export const ELITE_SPOIL_COUNT = 3;

/**
 * THE MIX. The share of each free slot that rolls a POTION instead of a relic.
 *
 * Not 50/50, deliberately. Artifact and potion rarity weights are near-identical
 * by design (potions.js: "RARITY IS ONE SYSTEM"), so pooling them raw would make
 * a potion as likely as a relic and the elite shelf would stop being the place
 * builds come from. At 0.30 a potion turns up on roughly one pedestal in three,
 * both free slots come up potions about 9% of the time, and the shelf still
 * reads as a relic shelf that sometimes has a bottle on it.
 */
export const ELITE_POTION_SHARE = 0.30;

/**
 * A FORGED elite pays RARE OR BETTER, ARTIFACTS ONLY. The floor is absolute: if
 * every relic at every one of these tiers is already yours the shelf comes up
 * SHORT rather than quietly handing you a common. An advertised floor is a
 * promise (the Hunter's Cache precedent), and this one is painted on the map
 * before you commit to walking into it.
 *
 * THE FLOOR DROPPED FROM VERY RARE TO RARE (0805 nerf). RARE is deliberately
 * first in the list, and deliberately the one tier here that ARTIFACT_RARITY
 * does NOT act-scale: the dampener shrinks veryRare and up in the early acts
 * while rare's 34 stands still, so an Act I Forged shelf is rare-heavy and an
 * Act IV one still reads like the old promise. That skew IS the nerf. Do not
 * "fix" it by adding rare to the act curve.
 */
export const FORGED_TIERS = ['rare', 'veryRare', 'legendary', 'heroExclusive', 'mythical'];

/**
 * The floor, and the word the game is allowed to print for it. Every piece of
 * player-facing copy that advertises the Forged promise reads THIS rather than
 * typing a rarity out, so the copy can never drift from the table above.
 */
export const FORGED_FLOOR = FORGED_TIERS[0];
export const FORGED_FLOOR_LABEL = ARTIFACT_RARITY[FORGED_FLOOR].label;

/**
 * Weights come off the ordinary ELITE curve (ARTIFACT_RARITY.eliteWeight), not
 * a second hand-typed table — so a retune of the elite curve moves the Forged
 * shelf with it. The act dampener multiplies veryRare and above by the same
 * factor, so those four still cancel out of the ratio against each other; RARE
 * is not damped at all, which is what tilts an early-act Forged shelf toward the
 * floor and levels out by Act IV.
 */
function pickWeighted(entries, rng) {
  const total = entries.reduce((s, e) => s + e.w, 0);
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (const e of entries) { r -= e.w; if (r <= 0) return e; }
  return entries[entries.length - 1];
}

/** One unowned, hero-legal relic at RARE or better. Null if there is none. */
export function rollForgedArtifact(ownedIds = [], rng = Math.random, heroId = null, actIndex = null) {
  const ok = a => !ownedIds.includes(a.id) && eligibleFor(a, heroId);
  const tiers = FORGED_TIERS
    .map(r => ({ r, w: rarityWeight(r, 'eliteWeight', actIndex), pool: ARTIFACT_POOL.filter(a => a.rarity === r && ok(a)) }))
    .filter(t => t.w > 0 && t.pool.length);
  const pick = pickWeighted(tiers, rng);
  if (!pick) return null;
  return pick.pool[Math.floor(rng() * pick.pool.length)];
}

/**
 * One potion, rolled on the SAME elite rarity curve the relics use, minus the
 * tiers potions do not have (there is no HERO EXCLUSIVE bottle). Reading the
 * artifact table is the point: it means the act-scaled rarity dampener applies
 * to whatever rolls, bottles included, without potions.js growing a second
 * opinion about how rare a Very Rare is.
 */
export function rollElitePotion(rng = Math.random, exclude = [], actIndex = null) {
  const tiers = POTION_RARITY_ORDER
    .map(r => ({ r, w: rarityWeight(r, 'eliteWeight', actIndex), pool: POTION_POOL.filter(p => p.rarity === r && !exclude.includes(p.id)) }))
    .filter(t => t.w > 0 && t.pool.length);
  const pick = pickWeighted(tiers, rng);
  if (!pick) return null;
  return pick.pool[Math.floor(rng() * pick.pool.length)];
}

/**
 * THE SHELF. Returns up to `count` entries of `{ kind, def }`, kind being
 * 'artifact' or 'potion'. Artifacts are distinct and unowned and hero-gated
 * exactly as they always were; potions are distinct within the offer (you may
 * already be carrying one, that is fine, a bottle is spent).
 *
 * `forged` swaps the whole thing for the Forged table: artifacts only, RARE or
 * better, and no guarantee logic needed because every slot is already one.
 */
export function rollEliteSpoils({
  ownedIds = [],
  count = ELITE_SPOIL_COUNT,
  forged = false,
  rarityBoost = 0,
  rng = Math.random,
  heroId = null,
  actIndex = null,
} = {}) {
  const out = [];
  const takenArt = [...ownedIds];
  const takenPot = [];

  const artifact = () => {
    const def = forged
      ? rollForgedArtifact(takenArt, rng, heroId, actIndex)
      // The Bounty Board's rarityBoost still applies to an ordinary elite, and
      // is still not act-scaled: it is a promise the relic makes out loud.
      : rollEliteDrop(takenArt, rarityBoost, rng, heroId, actIndex);
    if (!def) return null;
    takenArt.push(def.id);
    return { kind: 'artifact', def };
  };
  const potion = () => {
    const def = rollElitePotion(rng, takenPot, actIndex);
    if (!def) return null;
    takenPot.push(def.id);
    return { kind: 'potion', def };
  };

  for (let i = 0; i < count; i++) {
    let entry;
    if (forged) entry = artifact();                                  // no bottles, ever
    else if (rng() < ELITE_POTION_SHARE) entry = potion() ?? artifact();
    else entry = artifact() ?? potion();
    if (!entry) break;
    out.push(entry);
  }

  // THE GUARANTEE, applied last and to a random pedestal.
  if (out.length && !out.some(e => e.kind === 'artifact')) {
    const art = artifact();
    if (art) out[Math.floor(rng() * out.length)] = art;
  }
  return out;
}
