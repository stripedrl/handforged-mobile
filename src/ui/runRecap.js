/**
 * THE RUN RECAP — the report card that fills the end screen under
 * DEFEATED / VICTORY. Reads the ledger CombatScene kept on run.stats (see
 * core/run.js freshStats) and prints it as clean two-column parchment rows.
 *
 * Split in two on purpose:
 *   recapRows()   pure — the ledger turned into printable rows. Node-testable.
 *   drawRecap()   the Phaser half — head icon, rows, stagger, count-ups.
 *
 * A row whose stat never happened (no discards spent, no poison ever applied)
 * simply isn't in the list: the recap reports the run you played, and a wall of
 * zeroes is not that run.
 */

import { PARCH, CHARACTERS } from '../config.js';
import { run, topEntry, fmtDuration, reachedLabel } from '../core/run.js';
import { difficultyOf, DIFFICULTIES, MAX_DIFFICULTY } from '../core/difficulty.js';
import { ORACLE_BY_ID } from '../core/oracle.js';
import { fmtNum, legible } from './juice.js';
// --- THE UNLOCKS SECTION (JC, 2026-08-04) ---------------------------------
// The ledger records IDS only (core/unlocks.js imports nothing, on purpose);
// this is the half that knows what they MEAN, and it is free to import the
// world because it is a UI module and nothing in core imports it back.
import { runUnlocks } from '../core/unlocks.js';
import { ACHIEVEMENT_BY_ID, achievementHero, achievementReward } from '../core/achievements.js';
import { SKINS } from '../core/skins.js';
import { ALT_ACTS, ALT_UNLOCK } from '../core/acts.js';
import { PACK_GATES, PACK_TYPES } from '../core/packs.js';
import { HAND_DEFS } from '../core/poker.js';

/**
 * @typedef {Object} RecapRow
 * @property {string} label   left column, dim
 * @property {string} value   right column, inked
 * @property {number} [num]   count-up target (the drawer tweens 0 -> num)
 * @property {boolean} [big]  format the count-up through fmtNum (1.2k, 3.4M)
 * @property {boolean} [best] this row just beat a LIFETIME record — wear the tag
 */

/**
 * The ledger, turned into printable rows.
 * @param {typeof run} r
 * @param {number} now  clock reading for the duration (injectable for tests)
 * @returns {RecapRow[]}
 */
export function recapRows(r = run, now = Date.now()) {
  const st = r?.stats ?? {};
  const rows = [];
  const hands = r?.counters?.handsPlayed ?? 0;
  const bestHand = topEntry(st.handTypeCounts);
  const bestCard = topEntry(st.cardPlays);
  // WHICH ROWS JUST BEAT A LIFETIME RECORD. Written onto the run's own stats by
  // showEnd (progress.foldRunIntoRecords returns the list), so this stays a pure
  // function of the run and node can test it without a profile on disk. Absent
  // on every run that has not ended yet, which reads as "nothing beaten".
  const beaten = new Set(Array.isArray(st.recordsBeaten) ? st.recordsBeaten : []);

  rows.push({ label: 'Difficulty', value: difficultyOf(r).name });
  // THE SEED, when one was worn: the row IS the share button — read it off the
  // screenshot, type it in, walk the same worlds. (Seeded runs earn no trophies,
  // which the seed panel already said at pick time.)
  if (r?.seed) rows.push({ label: 'Seed', value: r.seed });
  // THE FUTURE YOU TOOK. Once her card is chosen, THE ORACLE vanishes from the
  // game: her modifiers quietly move your hands, your discards, the merchant's
  // prices and your slot count for the rest of the run, and there was nowhere
  // left that named the thing doing it. A first-timer who takes HANDY and then
  // reads '12 hands' off a BRONZE plate that promised 10 has no way to connect
  // the two. It is the first decision of every run, so it belongs beside the
  // other one made before the first fight. Omitted when she was never dealt
  // (an old save), same rule as every other row here.
  const future = ORACLE_BY_ID[r?.oracle];
  if (future) rows.push({ label: 'The Oracle', value: future.name });
  rows.push({ label: 'Reached', value: reachedLabel(r) });
  rows.push({ label: 'Time', value: fmtDuration(now - (st.startedAt ?? now)) });
  rows.push({ label: 'Hands Played', value: `${hands}`, num: hands });
  if (st.discardsUsed > 0) {
    rows.push({ label: 'Discards Used', value: `${st.discardsUsed}`, num: st.discardsUsed });
  }
  if (bestHand) rows.push({ label: 'Most Played Hand', value: `${bestHand.key}  ×${bestHand.count}` });
  if (bestCard) rows.push({ label: 'Most Played Card', value: `${bestCard.key}  ×${bestCard.count}` });
  if (st.maxHandDamage > 0) {
    rows.push({ label: 'Highest Hand Damage', value: fmtNum(st.maxHandDamage), num: st.maxHandDamage, big: true, best: beaten.has('maxHandDamage') });
  }
  if (st.maxHandShield > 0) {
    rows.push({ label: 'Highest Hand Shield', value: fmtNum(st.maxHandShield), num: st.maxHandShield, big: true, best: beaten.has('maxHandShield') });
  }
  if (st.maxPoisonStack > 0) {
    rows.push({ label: 'Highest Poison Stack', value: `${st.maxPoisonStack}`, num: st.maxPoisonStack, best: beaten.has('maxPoisonStack') });
  }
  return rows;
}

/**
 * THE UNLOCKS, turned into printable rows.
 *
 * JC, 2026-08-04: "At the end of a reach there should be an 'unlocks' section
 * that lists new things you've unlocked during your playthrough... If you
 * unlocked nothing then the section shouldn't appear."
 *
 * ONE TROPHY CAN OPEN FOUR THINGS. An act-clear trophy is also a biome gate; a
 * CHAMPIONS trophy also dresses a hero; two of them open a booster pack; five
 * gate a relic; one opens Ophelia. A player does not care that all of those
 * arrived on the same id — they care WHAT is new — so every consequence gets
 * its own row and the trophy itself is only one of them.
 *
 * Nothing here is a lookup table of its own: the hero comes off CHARACTERS, the
 * relic off RELIC_GATE_BY_ACHIEVEMENT, the world off ALT_UNLOCK, the pack off
 * PACK_GATES and the skins off SKINS. Add a trophy that opens something new and
 * it appears here without this file being touched.
 *
 * @returns {RecapRow[]} label = what KIND of thing, value = its name
 */
export function unlockRows(entries = runUnlocks()) {
  const rows = [];
  const seen = new Set();
  const push = (label, value) => {
    const key = `${label}|${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push({ label, value });
  };
  // Which pack (if any) a trophy id opens — PACK_GATES read backwards.
  const packByTrophy = Object.fromEntries(
    Object.entries(PACK_GATES).map(([kind, id]) => [id, kind]));

  for (const e of entries) {
    if (e.kind === 'achievement') {
      const def = ACHIEVEMENT_BY_ID[e.id];
      if (!def) continue;
      push('Trophy', def.name);
      const hero = achievementHero(e.id);
      if (hero) push('New Hero', hero.name);
      const relic = achievementReward(e.id);
      if (relic) push('New Relic', relic.name);
      const world = ALT_ACTS[ALT_UNLOCK.indexOf(e.id)];
      if (world) push('New World', world.name);
      const pack = packByTrophy[e.id];
      if (pack) push('New Pack', PACK_TYPES[pack]?.label ?? pack.toUpperCase());
      for (const s of SKINS) if (s.unlock === e.id) push('New Skin', s.name);
    } else if (e.kind === 'difficulty') {
      // The rung ABOVE the one just cleared is what opened for this hero...
      const next = DIFFICULTIES[Math.min(e.to + 1, MAX_DIFFICULTY)];
      const who = CHARACTERS[e.chrId]?.name ?? '';
      if (next && e.to < MAX_DIFFICULTY) push('New Difficulty', `${next.name}  ·  ${who}`);
      // ...and every LADDER skin at or below the rung just CLEARED. The ladder
      // only ever rises, so anything in (from, to] is new this run.
      for (const s of SKINS) {
        if (s.chr !== e.chrId || typeof s.rung !== 'number') continue;
        if (s.rung > e.from && s.rung <= e.to) push('New Skin', s.name);
      }
    } else if (e.kind === 'hand') {
      push('Secret Hand', HAND_DEFS[e.id]?.name ?? e.id);
    } else if (e.kind === 'mode') {
      if (e.id === 'act4') push('New Act', 'THE CRUCIBLE');
      if (e.id === 'endless') push('New Mode', 'ENDLESS');
    }
  }
  return rows;
}

/** Row metrics — the drawer and showEnd's panel sizing read the same numbers. */
export const RECAP = {
  headerH: 78,     // head icon + name band
  rowStep: 40,     // px between stat rows
  gutter: 20,      // half-gap between the label column and the value column
  stagger: 60,     // ms between one row landing and the next
  // THE UNLOCKS BLOCK: its own rule + label, then its own rows, tighter than
  // the stat rows because the list can run long on a good run.
  sectionGap: 46,  // last stat row -> the UNLOCKS rule
  unlockStep: 36,  // px between unlock rows
  ruleDrop: 30,    // rule -> the first row under it
  // NEW BEST sits at a FIXED offset from the column axis rather than beside the
  // value, because the value is still counting up when the tag lands — chasing
  // its live width would make the tag jitter for half a second. cx+206 clears
  // the longest value this panel can print ('1.23e14' at 27px) with air to
  // spare, and stays well inside the 900px panel.
  bestTagX: 206,
};

/**
 * HOW TALL THE WHOLE REPORT CARD IS, rows and all — the one function showEnd
 * sizes its panel from, so the panel and the drawing can never disagree about
 * where the last line lands.
 */
export function recapHeight(r = run, unlocks = runUnlocks()) {
  const stats = recapRows(r).length;
  const opened = unlockRows(unlocks).length;
  let h = RECAP.headerH / 2 + 22 + Math.max(0, stats - 1) * RECAP.rowStep;
  if (opened) h += RECAP.sectionGap + RECAP.ruleDrop + Math.max(0, opened - 1) * RECAP.unlockStep;
  return h;
}

/**
 * Draw the recap into an existing overlay container.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Container} ov  the end-screen overlay
 * @param {number} cx     column axis: labels end here, values begin here
 * @param {number} topY   y of the header band's center
 * @param {Object} [opts]
 * @param {number} [opts.delay]  ms before the cascade starts
 * @param {number} [opts.accent] tint for the divider rules
 * @returns {number} the y just below the last row
 */
export function drawRecap(scene, ov, cx, topY, { delay = 0, accent = 0xffc542 } = {}) {
  const rows = recapRows(run);
  const chrDef = CHARACTERS[run.chrId];
  const fade = (obj, at) => {
    obj.setAlpha(0);
    scene.tweens.add({ targets: obj, alpha: obj._targetAlpha ?? 1, duration: 220, delay: at, ease: 'Sine.easeOut' });
    return obj;
  };

  // --- the section rule + label ---
  const ruleY = topY - RECAP.headerH / 2 - 16;
  const ruleL = scene.add.rectangle(cx - 300, ruleY, 250, 3, accent).setOrigin(0.5);
  const ruleR = scene.add.rectangle(cx + 300, ruleY, 250, 3, accent).setOrigin(0.5);
  ruleL._targetAlpha = ruleR._targetAlpha = 0.55;
  const tag = scene.add.text(cx, ruleY, 'RUN RECAP', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.accent,
  }).setOrigin(0.5);
  ov.add([fade(ruleL, delay), fade(ruleR, delay), fade(tag, delay)]);

  // --- the hero who did all this: head icon, name, title, centered as a group ---
  if (chrDef) {
    const iconKey = `hero_icon_${chrDef.id}`;
    const hasIcon = scene.textures.exists(iconKey);
    const name = scene.add.text(0, topY, chrDef.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: PARCH.text,
    }).setOrigin(0, 0.5);
    const title = scene.add.text(0, topY + 7, chrDef.title, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '22px', color: PARCH.textDim,
    }).setOrigin(0, 0.5);
    const iconW = hasIcon ? 64 + 16 : 0;
    const total = iconW + name.width + 14 + title.width;
    let x = cx - total / 2;
    if (hasIcon) {
      const icon = scene.add.image(x + 32, topY, iconKey).setDisplaySize(64, 64);
      ov.add(fade(icon, delay + 60));
      scene.tweens.add({
        targets: icon, scale: icon.scale * 1.06, duration: 900,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      x += iconW;
    }
    name.setX(x);
    title.setX(x + name.width + 14);
    ov.add([fade(name, delay + 60), fade(title, delay + 60)]);
  }

  // --- the stat rows, cascading in ---
  const firstY = topY + RECAP.headerH / 2 + 22;
  rows.forEach((row, i) => {
    const y = firstY + i * RECAP.rowStep;
    const at = delay + 180 + i * RECAP.stagger;
    const lbl = scene.add.text(cx - RECAP.gutter, y, row.label, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: PARCH.textDim,
    }).setOrigin(1, 0.5);
    const val = scene.add.text(cx + RECAP.gutter, y, row.num != null ? '0' : row.value, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: PARCH.text,
    }).setOrigin(0, 0.5);
    lbl.setAlpha(0).setX(lbl.x - 24);
    val.setAlpha(0).setX(val.x + 24);
    scene.tweens.add({ targets: lbl, alpha: 1, x: cx - RECAP.gutter, duration: 260, delay: at, ease: 'Cubic.easeOut' });
    scene.tweens.add({
      targets: val, alpha: 1, x: cx + RECAP.gutter, duration: 260, delay: at, ease: 'Cubic.easeOut',
      onComplete: () => {
        // Count-up on the numbers worth savouring; strings just stand there.
        if (row.num == null || !val.active) return;
        if (row.num <= 1) { val.setText(row.value); return; }
        scene.tweens.addCounter({
          from: 0, to: row.num, duration: Math.min(160 + row.num * 6, 620), ease: 'Cubic.easeOut',
          onUpdate: (t) => {
            if (!val.active) return;
            const n = Math.round(t.getValue());
            val.setText(row.big ? fmtNum(n) : `${n}`);
          },
          onComplete: () => val.active && val.setText(row.value),
        });
      },
    });
    ov.add([lbl, val]);

    // --- NEW BEST: this run beat a LIFETIME record on this row -------------
    //
    // It lands AFTER the count-up has had its moment (the number is the thing
    // being celebrated; a tag that beats it to the screen steals the beat), it
    // never moves once it is there, and it keeps a slow heartbeat so the eye
    // finds it on a card with ten other rows. Gold through legible(), same as
    // every other "you now own this" line on this parchment.
    if (!row.best) return;
    const tag = legible(scene.add.text(cx + RECAP.bestTagX, y, '★ NEW BEST!', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '19px', color: '#ffd23e',
    }), { shadow: false }).setOrigin(0, 0.5).setAlpha(0).setScale(0.5);
    scene.tweens.add({
      targets: tag, alpha: 1, scale: 1, duration: 300, delay: at + 380, ease: 'Back.easeOut',
      onComplete: () => scene.tweens.add({
        targets: tag, scale: 1.09, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      }),
    });
    ov.add(tag);
  });

  let lastY = firstY + Math.max(0, rows.length - 1) * RECAP.rowStep;

  // --- UNLOCKS: what this run opened that was shut when it began -----------
  // Absent entirely when nothing opened, which is JC's rule and also the only
  // way the section stays meaningful: a heading over an empty list teaches a
  // player to stop reading it.
  const opened = unlockRows();
  if (opened.length) {
    const ruleY = lastY + RECAP.sectionGap;
    const at0 = delay + 180 + rows.length * RECAP.stagger;
    const uL = scene.add.rectangle(cx - 300, ruleY, 250, 3, accent).setOrigin(0.5);
    const uR = scene.add.rectangle(cx + 300, ruleY, 250, 3, accent).setOrigin(0.5);
    uL._targetAlpha = uR._targetAlpha = 0.55;
    const uTag = scene.add.text(cx, ruleY, 'UNLOCKED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.accent,
    }).setOrigin(0.5);
    ov.add([fade(uL, at0), fade(uR, at0), fade(uTag, at0)]);

    const uFirst = ruleY + RECAP.ruleDrop;
    opened.forEach((row, i) => {
      const y = uFirst + i * RECAP.unlockStep;
      const at = at0 + 140 + i * RECAP.stagger;
      const lbl = scene.add.text(cx - RECAP.gutter, y, row.label, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim,
      }).setOrigin(1, 0.5);
      // Gold, because every one of these is a thing you now OWN — the same
      // colour the trophy toast and the ceremony use for exactly that reason.
      // Through legible() (JC: "unreadable yellow text"): bare #ffd23e on the
      // parchment panel is the exact gold-on-cream failure this codebase has
      // fixed four times now, and legible() is the one treatment for it.
      const val = legible(scene.add.text(cx + RECAP.gutter, y, row.value, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: '#ffd23e',
      }), { shadow: false }).setOrigin(0, 0.5);
      lbl.setAlpha(0).setX(lbl.x - 24);
      val.setAlpha(0).setX(val.x + 24);
      scene.tweens.add({ targets: lbl, alpha: 1, x: cx - RECAP.gutter, duration: 260, delay: at, ease: 'Cubic.easeOut' });
      scene.tweens.add({ targets: val, alpha: 1, x: cx + RECAP.gutter, duration: 260, delay: at, ease: 'Cubic.easeOut' });
      ov.add([lbl, val]);
    });
    lastY = uFirst + Math.max(0, opened.length - 1) * RECAP.unlockStep;
  }

  return lastY;
}
