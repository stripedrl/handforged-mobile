/**
 * @file passives.js
 * THE HERO PASSIVE, TURNED INTO SOMETHING YOU CAN POINT AT (JC, 2026-08-06).
 *
 * Until now a hero's passive was the one power in the game with no OBJECT. A
 * relic sits in a socket on the mat, swells when it fires and floats the number
 * it just added; THE ORACLE's future wears a chip; a potion is a bottle on the
 * belt. The passive was a sentence printed under the status rows — read once on
 * the first fight, never read again, and completely silent during the cascade
 * that it was, on some hands, quietly winning.
 *
 * So the sentence is gone and the passive is a CHIP (ui/passiveChip.js), and
 * this file is the half of that job which is not drawing: given a finished
 * scoring result, did the passive contribute to THIS hand, and by exactly how
 * much.
 *
 * TWO RULES THIS FILE KEEPS, and they are the same two the oracle chip keeps:
 *
 *   1. ATTRIBUTION IS MEASURED, NEVER RE-DERIVED. Every branch below reads a
 *      number the SCORING ENGINE reported (passiveMultFactor, passiveGemFactor,
 *      zealConsumed/zealFactor, chipMultAdd, damageBySuit) — never the card
 *      count, never a table of its own. A hand where the passive did nothing
 *      returns null and the chip stays still, which is the whole feature: a
 *      Dextra FIVE-card hand must show nothing at all.
 *
 *   2. THE COPY IS NEVER RE-TYPED. `passiveText` returns the character def's
 *      OWN kit string — the exact string the sidebar used to print, the one
 *      whose numbers are template literals over the constants the engine pays
 *      (see CHARACTERS.hoarder). Retune the kit and the tooltip moves with it.
 *
 * WHERE EACH PASSIVE LANDS IN THE EQUATION — `when` is not decoration. The
 * cascade animates the mult in the order scoring.js actually walked it, so a
 * passive job has to be inserted at the passive's own position or the running
 * total the player watches is a number the arithmetic never held:
 *
 *   'open'  before the relic walk         Drusky's hoard mult (scoring step 3)
 *   'late'  after the walk and residual   Dextra's few-card ×N (step 5)
 *   'zeal'  the discharge beat itself     Zelus (rides the existing ZEAL job)
 *   null    not in the equation at all    Ophelia (per damage event, in scene)
 */

import { CHARACTERS, SUIT_COLORS } from '../config.js';
import { fmtNum } from './fmt.js';

/** The character def a chip is drawn from, or null for an unknown id. */
export function passiveDef(chrId) {
  return (chrId && CHARACTERS[chrId]) || null;
}

/**
 * The chip's border colour: the hero's SUIT, from the one table the whole game
 * tints suits with (config.SUIT_COLORS — the pips on the cards, the rows on the
 * character sheet, the burst when a card scores). A hero's chip is therefore
 * the same colour as the cards they care about, and a retune of a suit moves
 * every one of those surfaces together.
 */
export function passiveAccent(chrId) {
  const def = passiveDef(chrId);
  return SUIT_COLORS[def?.suit] ?? 0xffc542;
}

/** The passive's rules, in the character def's own words. See rule 2 above. */
export function passiveText(chrId) {
  return passiveDef(chrId)?.kit ?? '';
}

/** 2dp, and never a trailing '.0' — the label idiom the relic pulses use. */
function fmtF(n) {
  return String(Math.round(n * 100) / 100);
}

/**
 * THE TWO NUMBERS ON A CHIP ARE DIFFERENT ANIMALS, and they are formatted by
 * different functions on purpose (JC, 2026-08-11: "ZEAL 4200000").
 *
 * A FACTOR is small and its precision is the whole point — ×1.24 must not
 * become ×1.2, so factors keep `fmtF`. A TOTAL is unbounded: Zeal genuinely
 * reaches e6 on a Mythril Infinite-Heart run and Drusky's hoard goes further,
 * and the chip's label clamps to its own ink lane, so an eight-digit total did
 * not overflow the chip — it SHRANK it, to 0.44 scale. That is not a readout.
 * Totals therefore go through the same `fmtNum` the equation and every float
 * already use, so the chip says `ZEAL 4.2M ×1.24` and lands legible.
 */

/**
 * DID THE PASSIVE CONTRIBUTE, AND BY HOW MUCH.
 *
 * @param {?string} chrId              run.chrId
 * @param {?object} res                a finished scoreHand() result
 * @param {{poisonSeep?: number}} ctx  what the SCENE knows and scoring cannot:
 *   Ophelia's seepage is one damage event's worth of poison, applied inside
 *   damageEnemy long after the equation has slammed, so it is handed in.
 * @returns {?{id: string, when: ?string, label: string, color: string,
 *             amount: number, eqAdd: number, eqMul: number}}
 *   null when the passive did NOT move this hand — the chip's silence.
 */
export function passiveAttribution(chrId, res, ctx = {}) {
  const def = passiveDef(chrId);
  if (!def) return null;
  // `color` is the ink the floating label is struck in, and every value used
  // below is one the CASCADE already speaks: the one-card red, ZEAL's gold, the
  // Diamond cyan, the chip gold, the poison violet. A passive's bow should be
  // indistinguishable in language from a relic's.
  const row = (o) => ({ id: def.id, when: null, amount: 0, eqAdd: 0, eqMul: 1, color: '#ffd23e', ...o });

  // OPHELIA is answered first and without a result, because her passive is not
  // part of the equation: half of every point of damage she deals seeps in as
  // poison, per damage event, after the slam. The scene measures it off the
  // stacks it actually applied and hands them in.
  if (def.id === 'venomancer') {
    const seep = Math.round(ctx.poisonSeep ?? 0);
    return seep > 0 ? row({ label: `☠ +${seep}`, amount: seep, color: '#7a58c8' }) : null;
  }

  if (!res) return null;

  switch (def.id) {
    // DEXTRA. Fewer cards, bigger hits — a straight × on the mult side, at step
    // 5, after every relic has had its say. It only exists at 1-3 cards, and
    // only counts when the MULT owns the hand's total at all.
    case 'highRoller': {
      const f = res.passiveMultFactor ?? 1;
      if (!(f > 1) || !res.multApplies) return null;
      const n = res.breakdown?.length ?? 0;
      return row({
        when: 'late', eqMul: f, amount: f, color: '#ff5060',
        label: `${n} CARD${n === 1 ? '' : 'S'}  ×${fmtF(f)}`,
      });
    }

    // ZELUS. The battery discharges into the blow. scoring.js has already
    // multiplied by it and the cascade already owns a ZEAL beat for it — the
    // chip RIDES that beat rather than adding a second one, so the mult moves
    // exactly once (see CombatScene.scheduleArtifactPulses).
    case 'zealot': {
      const f = res.zealFactor ?? 1;
      const spent = res.zealConsumed ?? 0;
      if (!(spent > 0) || !(f > 1)) return null;
      return row({ when: 'zeal', eqMul: f, amount: spent, color: '#ffd166', label: `ZEAL ${fmtNum(spent)}  ×${fmtF(f)}` });
    }

    // THE BULL. His Diamonds hit twice as hard, which happens on the SCORE side
    // inside the card walk — the doubled value has already ticked onto the
    // equation card by card, so his beat moves no number and only takes a bow.
    // `amount` is the share of the hand's raw Diamond damage that is HIS:
    // whatever survives after dividing his factor back out.
    case 'bulwark': {
      const f = res.passiveGemFactor ?? 1;
      const gems = res.damageBySuit?.gems ?? 0;
      if (!(f > 1) || !(gems > 0) || !(res.damage > 0)) return null;
      return row({ when: 'late', color: '#7fe0f4', label: `◆ ×${fmtF(f)}`, amount: Math.round(gems * (1 - 1 / f)) });
    }

    // DRUSKY. The hoard read LIVE at play time, paid as flat mult at step 3 —
    // BEFORE the relic walk, which is exactly the position the Solid Gold Sack
    // exists to trade away, so his beat opens the cascade rather than closing
    // it.
    case 'hoarder': {
      const add = res.chipMultAdd ?? 0;
      if (!(add > 0) || !res.multApplies) return null;
      return row({
        when: 'open', eqAdd: add, amount: add,
        // The HOARD is the other unbounded total on a chip — it is Drusky's
        // whole bank, read live, and it outgrows Zeal. Same treatment.
        label: `◉ ${fmtNum(res.chipsRead ?? 0)}  +${fmtF(add)} mult`,
      });
    }

    default:
      return null;
  }
}
