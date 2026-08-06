/**
 * BOOSTER PACKS — after every regular fight you choose 1 of 3 packs, then pick
 * one thing from inside it. Pure logic here; presentation lives in ui/rewards.js.
 *
 *   THE WITCH   — tarot rites: deck magic, gambles, boons (incl. the Wheel of Fortune spin)
 *   THE SMITH   — hand-type upgrades (Balatro planets): +mult levels, forever
 *   THE ARTISAN — new cards, often with mods (enhanced/wild/gilded/echo)
 *   THE FORGE   — rare pack, mostly late acts: big boons, tiny chance of a
 *                 MYTHIC EMBER that summons a random Mythical relic
 *
 * Option contract: { id, name, desc, icon, tint, ui?, card?, apply(run, choice) }
 *   ui: 'pickCards' {count, optional} · 'pickSuit' · 'pickCardsThenSuit' · 'wheel'
 *   apply may return a directive for the UI: { mythical: def } | { artifact: def } | { wheel: outcome }
 */

import { CHARACTERS, SUIT_GLYPH } from '../config.js';
import { SUITS, cardLabel, cardList } from './deck.js';
import { HAND_DEFS, HAND_TYPES, mostPlayedHandType } from './poker.js';
import { rollMythical, rollEliteDrop, rollLegendaryPlus, rollOfRarity, getProp } from './artifacts.js';
import { isHandDiscovered, isAchievementUnlocked } from './progress.js';
// The ETHEREAL numbers, so the Ethereal Rite quotes the engine and not a memory
// of it. scoring.js reaches only config/deck/poker, so this edge cannot cycle.
import { MOD_MULT_FACTOR, ETHEREAL_VANISH_CHANCE } from './scoring.js';
import { ORACLE_OPTIONS } from './oracle.js';
// ENDLESS clamp only (the Smith's double-tempering ladder tops out at Act IV).
// Safe edge: acts.js reaches enemies/map/progress and none of them reach back.
import { ACTS } from './acts.js';
import { run as liveRun, effectiveArtifacts, gainGold } from './run.js';

/**
 * The relic belt to read for pack-time props. For the LIVE run that means the
 * mirror-resolved belt (a Forgery pointed at a Worn Anvil remembers too); a
 * test's hand-built run object is read straight.
 */
function ownedArtifacts(r) {
  return r === liveRun ? effectiveArtifacts() : (r?.artifacts ?? []);
}

export const PACK_TYPES = {
  witch: {
    kind: 'witch', label: 'THE WITCH', color: 0x8a5cd0, icon: 'icon_magic',
    blurb: 'Strange magics for your deck. Some kind, some hungry.',
  },
  smith: {
    kind: 'smith', label: 'THE SMITH', color: 0xd07028, icon: 'icon_anvil',
    blurb: 'Hammer a hand type stronger. Permanent, this run.',
  },
  artisan: {
    kind: 'artisan', label: 'THE ARTISAN', color: 0x4aa8ff, icon: 'icon_star',
    blurb: 'Fresh-crafted cards for your deck, some with a twist.',
  },
  dealer: {
    kind: 'dealer', label: 'THE DEALER', color: 0x2e8b57, icon: 'icon_dice',
    blurb: 'Every prize has a price. Read the fine print.',
  },
  forge: {
    kind: 'forge', label: 'THE FORGE', color: 0xe03040, icon: 'icon_fire',
    blurb: 'The old fire. Great boons, and sometimes the impossible.',
  },
  // THE CURATOR (JC, 2026-07-31) — the rarest table. No cards, no deals: he
  // opens a case, and three relics are standing on it. Take one, free.
  curator: {
    kind: 'curator', label: 'THE CURATOR', color: 0xc9a24a, titleColor: 0xf0dfae,
    icon: 'icon_gem',
    blurb: 'Three relics under glass. He lets you take exactly one.',
  },
  // Awarded, already open, for a dead act boss — and, if THE ORACLE'S HUNTER was
  // taken, a wrapper that can also turn up on the ordinary pack table.
  bounty: {
    kind: 'bounty', label: 'THE BOUNTY HUNTER', color: 0x3fae62, titleColor: 0xffd23e,
    icon: 'icon_coins',
    blurb: 'A boss is worth something to somebody. Collect.',
  },
  // THE ORACLE — never at the pack table. It is opened ONCE, on arrival at the
  // first map, and it is the only pack in the game you cannot walk away from.
  oracle: {
    kind: 'oracle', label: 'THE ORACLE', color: 0x9a5cff, titleColor: 0xd8b0ff,
    icon: 'icon_magic',
    blurb: 'She saw your run before you did. Three futures. Choose one.',
  },
};

/** Forge pack appearance chance per act index; the Dealer is a steady drifter. */
export const FORGE_CHANCE = [0.05, 0.10, 0.16, 0.2];
/**
 * CLAMPED AT THE LAST RUNG (ENDLESS, 2026-08-05). An endless act is never
 * shallower than the Crucible, so it keeps the Crucible's Forge rate instead of
 * dropping to the old 0.12 default the moment the index ran off the table.
 */
export const forgeChance = (actIndex) =>
  FORGE_CHANCE[Math.min(Math.max(Math.floor(actIndex) || 0, 0), FORGE_CHANCE.length - 1)];
const DEALER_CHANCE = 0.22;

/**
 * THE SMITH'S DOUBLE TEMPERING: +25% chance per act, and CLAMPED at Act IV's
 * 75% (ENDLESS, 2026-08-05). Un-clamped, act index 4 would have made the double
 * level a certainty and index 5 a probability greater than one — the ladder
 * tops out where the game's acts do, and every endless act keeps the top rung.
 */
export const SMITH_DOUBLE_PER_ACT = 0.25;
export const smithDoubleChance = (actIndex) =>
  Math.min(Math.max(Math.floor(actIndex) || 0, 0), ACTS.length - 1) * SMITH_DOUBLE_PER_ACT;

/**
 * TWO PACKS ARE LOCKED (JC, 2026-08-04).
 *
 * "Forge packs appearing should be locked behind an achievement: visit The
 * Forge event and summon a mythical artifact. Once that achievement is
 * completed, Forge packs are back in the pool. Same thing with The Dealer
 * pack, it should be locked behind visiting The Traveling Casino event."
 *
 * The gate lives HERE and only here — one map from pack kind to trophy id, read
 * by rollPackOffer. core/achievements.js declares the trophies and what they
 * say; it does not know what they open, and this file does not know what they
 * are called. A unit test walks both tables so the two can never drift.
 *
 * NEITHER GATE CAN DEADLOCK. The Crimson Forge is a MAP NODE (the red mark) and
 * the Traveling Casino is a mystery room, so both doors are open on run one
 * without owning anything — which is the whole point of choosing these two.
 */
export const PACK_GATES = { forge: 'forgeSummoner', dealer: 'casinoPatron' };

/** Is this pack kind allowed at the table yet? Ungated kinds are always yes. */
export function packUnlocked(kind) {
  const need = PACK_GATES[kind];
  return !need || isAchievementUnlocked(need);
}

/** Every pack kind still behind a trophy, for the shelf and the recap. */
export function lockedPackKinds() {
  return Object.keys(PACK_GATES).filter(k => !packUnlocked(k));
}
/**
 * THE CURATOR: ~10% of pack tables, every act. He rolls LAST and takes only a
 * BASE seat (witch / smith / artisan) — he never displaces the Dealer and never
 * displaces the Forge. Two rare wrappers can therefore sit on the same table,
 * which is a moment rather than a problem; what can't happen is a rare pack
 * eating another rare pack, so each one's advertised odds are the real odds.
 */
const CURATOR_CHANCE = 0.10;
/** Relics the Curator puts under glass. 5 -> 3 (JC, 2026-08-02 nerf pass). */
export const CURATOR_RELICS = 3;

// ---------------------------------------------------------------------------
// OPTION CARD ART (JC, 2026-07-31; the BOUNTY HUNTER joined 2026-08-01). The
// Witch, the Dealer, the Forge, the Smith and the Bounty Hunter all deal their
// options as PHYSICAL CARDS:
// assets/ui/packcards/<kind>_<slug>.png, where the slug is the option NAME in
// kebab-case (the Smith's are pinned per hand type — see SMITH_ART). The
// TITLE IS BAKED INTO THE ART,
// so the renderer draws no name and no rules text on the face — the description
// moves to a hover tooltip. An option whose art is missing falls back to the
// old icon panel on its own, so a half-delivered set mixes cleanly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TRANSFORMATION TRANSPARENCY (JC, 2026-08-01)
//
// A deal that says "your 2 lowest cards become copies of your highest" is a
// price you cannot read. Every option that picks cards RELATIVE to your deck
// now carries a `resolve(run)` that runs the SAME selection its apply() will
// run, at OFFER time, and returns the desc with the actual cards named:
//
//   GAIN: your 2♣ and 4♦ become copies of your K♠.
//   PRICE: 50 chips and 5 HP.
//
// The rules:
//   · resolve() is READ-ONLY. It must never sort run.runDeck in place (three
//     of these used to) — every selection below copies the deck first.
//   · apply() is untouched and still re-derives its own targets. Nothing can
//     change the deck between the shelf being dealt and an option being
//     clicked, so the two always agree; and a test calling apply() straight off
//     DEALER_DEALS keeps working exactly as it did.
//   · resolveOptions() below stamps the resolved desc onto a CLONE, so the
//     shared definition objects stay pristine between opens.
// ---------------------------------------------------------------------------

/**
 * THE DESTRUCTION SPELL's bite: 3 -> 2 (JC, 0803). Exported so the copy test,
 * the unit test and the spell itself all read one number.
 */
export const DESTRUCTION_COUNT = 2;

/** Deck copies, sorted, never touching the caller's array. */
const lowest = (deck, n) => [...deck].sort((a, b) => a.rank - b.rank).slice(0, n);
const highest = (deck, n) => [...deck].sort((a, b) => b.rank - a.rank).slice(0, n);

// ---------------------------------------------------------------------------
// CARD PREVIEWS (JC, 2026-08-02: "see card offerings during packs like the
// witch and dealer and forge and bounty hunter... if it has any upgrades
// pertaining to card manipulation")
//
// THREE HONEST MODES AND NO FOURTH. An option that touches specific deck cards
// declares which of these it is, and the shelf's hover tooltip says so:
//
//   fixed   the exact cards are already known (resolve() drew them at offer
//           time) -> they render as MINI CARDS under the rules text.
//   choose  YOU pick them, in the picker that opens after you take it -> the
//           tip says how many, and whether you may take fewer.
//   random  genuinely rolled at resolution -> the tip SAYS random and shows
//           nothing. Never fake a preview: a mini card the option might not
//           actually touch is worse than no preview at all.
//
// An option that touches no deck cards (a chip payout, a relic, a hand level)
// gets NO preview and no clutter. That is why previewFor can return null.
// ---------------------------------------------------------------------------

/**
 * Which preview an option earns, if any.
 * @param {object} opt          the (possibly already resolved) option
 * @param {object[]|null} cards the cards resolve() named, if it named any
 * @returns {{mode:'fixed'|'choose'|'random', cards?:object[], count?:number, optional?:boolean}|null}
 */
export function previewFor(opt, cards = null) {
  const named = (cards ?? []).filter(Boolean);
  if (named.length) return { mode: 'fixed', cards: named };
  if (opt.ui === 'pickCards' || opt.ui === 'pickCardsThenSuit') {
    return { mode: 'choose', count: opt.pick ?? 1, optional: !!opt.optional };
  }
  if (opt.randomCards > 0) return { mode: 'random', count: opt.randomCards };
  return null;
}

/** The one line a non-fixed preview prints. `fixed` speaks in cards, not words. */
export function previewLabel(pv) {
  if (!pv) return null;
  const n = pv.count ?? 0;
  const cards = `card${n === 1 ? '' : 's'}`;
  if (pv.mode === 'choose') return `You choose ${pv.optional ? 'up to ' : ''}${n} ${cards}.`;
  if (pv.mode === 'random') return `${n} random ${cards}, rolled when you take it.`;
  return null;
}

/**
 * Clone each option that knows how to name its own targets, with the resolved
 * text baked into `desc`, and stamp every option with its `preview`.
 *
 * resolve(run) may return either:
 *   a STRING                 — the resolved description (the deterministic cases)
 *   { desc, apply, cards }   — the description, an apply() that commits to
 *                       exactly what was named, and the CARDS it named. That
 *                       second form is how the "3 RANDOM cards vanish" prices
 *                       become readable: the roll happens once, when the shelf
 *                       is dealt, and the clone's apply spends the roll instead
 *                       of making a new one. The base definition keeps its
 *                       original random apply(), so a unit test calling
 *                       DEALER_DEALS[i].apply() is unaffected.
 *
 * `cards` is what turns a resolve into a FIXED preview, so a resolve that only
 * rewrites text (and cannot promise which cards it lands on) simply omits it.
 */
export function resolveOptions(options, run) {
  return options.map((opt) => {
    let out = opt;
    let named = null;
    if (typeof opt.resolve === 'function') {
      try {
        const r = opt.resolve(run);
        if (r && typeof r === 'string') out = { ...opt, desc: r };
        else if (r) {
          out = { ...opt, ...(r.desc ? { desc: r.desc } : {}), ...(r.apply ? { apply: r.apply } : {}) };
          named = r.cards ?? null;
        }
      } catch { out = opt; named = null; }
    }
    const preview = previewFor(out, named);
    return preview ? { ...out, preview } : out;
  });
}

/** "Pit Boss's Favor" -> "pit-boss-s-favor" · "Hex & Ward" -> "hex-and-ward". */
export function slugifyOption(name) {
  return (name ?? '').toLowerCase().replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** An option's art slug — `art` wins, for the files whose spelling wandered. */
export function optionArtSlug(opt) {
  return opt.art ?? slugifyOption(opt.name);
}

/**
 * The 3 packs offered after a regular fight. (The Dealer used to be nudged by
 * the old Lodestone's dealerBonus; that relic is now the Bonded Stone and the
 * Dealer answers to nobody.)
 */
export function rollPackOffer(actIndex, rng = Math.random, r = liveRun) {
  const offer = [PACK_TYPES.witch, PACK_TYPES.smith, PACK_TYPES.artisan]
    .sort(() => rng() - 0.5);
  // THE TWO LOCKED DOORS. The roll still happens either way, so a locked pack
  // costs exactly the same random draw as an open one and every other pack's
  // advertised odds are untouched by whether you have earned these yet.
  if (rng() < DEALER_CHANCE && packUnlocked('dealer')) {
    offer[Math.floor(rng() * offer.length)] = PACK_TYPES.dealer;
  }
  if (rng() < forgeChance(actIndex) && packUnlocked('forge')) {
    // The Forge muscles in — but never over the Dealer's table.
    const spots = offer.map((p, i) => (p.kind === 'dealer' ? -1 : i)).filter(i => i >= 0);
    if (spots.length) offer[spots[Math.floor(rng() * spots.length)]] = PACK_TYPES.forge;
  }
  // THE ORACLE'S HUNTER. The bounty wrapper joins the ordinary table for the
  // rest of the run, at the Forge pack's own rate for this act (the spec's
  // words), and it takes a BASE seat only — the house rule for every rare
  // wrapper is that no rare pack may eat another rare pack, so its advertised
  // odds stay the real odds. Reads the run's channel, never the option id.
  if (r?.oracleMods?.hunterPacks && rng() < forgeChance(actIndex)) {
    const spots = offer.map((p, i) => (p.kind === 'dealer' || p.kind === 'forge' ? -1 : i)).filter(i => i >= 0);
    if (spots.length) offer[spots[Math.floor(rng() * spots.length)]] = PACK_TYPES.bounty;
  }
  if (rng() < CURATOR_CHANCE) {
    // The Curator takes a BASE seat only: never the Dealer's, never the Forge's,
    // and never the Hunter's.
    const spots = offer.map((p, i) =>
      (p.kind === 'dealer' || p.kind === 'forge' || p.kind === 'bounty' ? -1 : i)).filter(i => i >= 0);
    if (spots.length) offer[spots[Math.floor(rng() * spots.length)]] = PACK_TYPES.curator;
  }
  return offer;
}

/**
 * The Curator's case: `count` DISTINCT relics, rolled on the ordinary rarity
 * weights (rollEliteDrop), excluding what you already own AND each other, with
 * hero-exclusive gating intact. A short case (every eligible relic already
 * yours) is honest — the overlay just shows fewer pedestals.
 */
export function rollCuratorRelics(run, count = CURATOR_RELICS, rng = Math.random) {
  const owned = (run.artifacts ?? []).map(a => a.id);
  // COLLECTOR'S KERCHIEF: one more pedestal under the glass, per copy held.
  // It lands HERE rather than at the call site so every surface that opens the
  // case (the pack table, the dev harness, a test) honours it for free.
  count += getProp(ownedArtifacts(run), 'extraStock');
  const out = [];
  for (let i = 0; i < count; i++) {
    const def = rollEliteDrop([...owned, ...out.map(d => d.id)], 0, rng, run.chrId);
    if (!def) break;
    out.push(def);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE WITCH
// ---------------------------------------------------------------------------

/**
 * Exactly TEN rites, curated 2026-07-31 (docs/REQUESTS_CARD_MODS.txt): the
 * Witch does CARD MAGIC and nothing else. Elixir of Life, Health Potion,
 * Sleight of Hand, Alchemist's Gold and Blood Pact were cut — stat porridge
 * and a relic vending machine belong to other tables. Three are offered
 * per open (+ Collector's Ledger's extra).
 */
const WITCH_RITES = [
  {
    id: 'moon', name: 'Transmutation Circle', icon: 'icon_magic', tint: 0x9adcff,
    desc: 'Transmute up to 3 chosen cards into a suit of your choice.',
    ui: 'pickCardsThenSuit', pick: 3, optional: true,
    apply(run, { cards, suit }) {
      for (const c of cards) { c.suit = suit; }
    },
  },
  {
    id: 'lovers', name: 'Mirror Image', icon: 'icon_heart_small', tint: 0xe0434f,
    desc: 'Duplicate a chosen card, mods and all.',
    ui: 'pickCards', pick: 1,
    apply(run, { cards }) {
      const c = cards[0];
      if (c) run.runDeck.push({ ...c, id: `${c.id}#love${run.runDeck.length}` });
    },
  },
  {
    id: 'death', name: 'Disintegrate', icon: 'icon_skull', tint: 0x8898b8,
    desc: 'Destroy up to 2 chosen cards. A thinner deck draws better.',
    ui: 'pickCards', pick: 2, optional: true,
    apply(run, { cards }) {
      for (const c of cards) {
        const i = run.runDeck.indexOf(c);
        if (i >= 0) run.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'star', name: 'Arcane Infusion', icon: 'icon_star', tint: 0xffd23e,
    desc: 'Two random cards become ENHANCED (+10 value).',
    // The two cards are DRAWN when the rite is dealt, not when it is taken, so
    // the shelf can name them. Same odds, same pool — you just get to see them.
    resolve(run, rng = Math.random) {
      const pool = run.runDeck.filter(c => !c.mod);
      const picks = [];
      for (let i = 0; i < 2 && pool.length; i++) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      if (!picks.length) return null;
      return {
        desc: `Your ${cardList(picks)} become ENHANCED (+10 value).`,
        cards: picks,
        apply() { for (const c of picks) c.mod = 'enhanced'; },
      };
    },
    apply(run) {
      const pool = run.runDeck.filter(c => !c.mod);
      for (let i = 0; i < 2 && pool.length; i++) {
        const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        c.mod = 'enhanced';
      }
    },
  },
  {
    // art: JC's file reads 'etherial-rite' — the painting wins over the spelling.
    id: 'hanged', name: 'Ethereal Rite', art: 'etherial-rite', icon: 'icon_magic', tint: 0x7fe0d0,
    // The two numbers are READ, not typed. This line said ×1.5 for a day after
    // the 0803 pass took ETHEREAL to ×2, which is the exact failure the copy
    // guide calls worse than no pass at all.
    desc: `A chosen card turns ETHEREAL: ×${MOD_MULT_FACTOR.ethereal} mult when it scores, and ${Math.round(ETHEREAL_VANISH_CHANCE * 100)}% each time to vanish from your deck forever.`,
    ui: 'pickCards', pick: 1,
    apply(run, { cards }) { if (cards[0]) cards[0].mod = 'ethereal'; },
  },
  {
    id: 'judgement', name: 'Blood Seal', icon: 'icon_heart_small', tint: 0x8a1830,
    // The seal is a STAMP, not a mod (see scoring.js's three layers): it presses
    // onto a card that already carries something and takes nothing away from it.
    desc: 'A chosen card is BLOOD SEALED: it heals you 2 HP every time it scores. The wax stacks. It keeps whatever the card already was.',
    ui: 'pickCards', pick: 1,
    apply(run, { cards }) { if (cards[0]) cards[0].stamp = 'blood'; },
  },
  {
    // THE MULTIPLICATIVE SEAL (JC, 2026-08-01). The Blood Seal's twin on the
    // other side of the equation, on the same layer: one stamp per card, so
    // the two compete with each other and with nothing else. Takes the Witch to
    // ELEVEN rites — deliberately, and at JC's request; nothing was cut for it.
    id: 'multSeal', name: 'Multiplicative Seal', icon: 'icon_star', tint: 0x7a3ab8,
    desc: 'A chosen card takes the MULTIPLICATIVE SEAL: +3 mult every time it scores. The wax stacks. It keeps whatever the card already was.',
    ui: 'pickCards', pick: 1,
    apply(run, { cards }) { if (cards[0]) cards[0].stamp = 'mult'; },
  },
  {
    id: 'wheel', name: 'WHEEL OF FATE', icon: 'icon_dice', tint: 0xb45cff,
    desc: 'Spin it. 30% wondrous · 45% fine · 25% the witch cackles.',
    // The jackpot wedge turns two cards WILD, and which two is not decided until
    // the wheel stops. Honest label, no mini cards: see previewFor.
    ui: 'wheel', randomCards: 2,
    apply(run, _, rng = Math.random) {
      const roll = rng();
      if (roll < 0.30) {
        const pool = run.runDeck.filter(c => !c.mod);
        for (let i = 0; i < 2 && pool.length; i++) {
          const c = pool.splice(Math.floor(rng() * pool.length), 1)[0];
          c.mod = 'wild';
        }
        gainGold(80, run);
        return { wheel: 'jackpot', text: 'JACKPOT. 2 cards turn WILD, and +80 chips.' };
      }
      if (roll < 0.75) {
        gainGold(40, run);
        return { wheel: 'mid', text: 'A fair spin. +40 chips.' };
      }
      return { wheel: 'bust', text: 'The wheel wheezes to a stop. Nothing. The witch cackles.' };
    },
  },
  {
    // 3 -> 2 (JC, 0803): three cards off the bottom was most of a thinning
    // route in one card. DESTRUCTION_COUNT is quoted by the copy, the resolve
    // and the apply, so the spell can never promise a number it does not cast.
    id: 'tower', name: 'Destruction Spell', icon: 'icon_shield', tint: 0xb87838,
    desc: `Your ${DESTRUCTION_COUNT} lowest cards are destroyed. A word of unmaking, spent on the dregs.`,
    resolve(run) {
      const doomed = lowest(run.runDeck, DESTRUCTION_COUNT);
      return { desc: `Your ${cardList(doomed)} are destroyed.`, cards: doomed };
    },
    // Removes exactly the cards resolve() named. (It used to sort run.runDeck
    // IN PLACE and splice the front, which silently reordered the master deck
    // as a side effect of casting a spell.)
    apply(run) {
      for (const c of lowest(run.runDeck, DESTRUCTION_COUNT)) {
        const i = run.runDeck.indexOf(c);
        if (i >= 0) run.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'magician', name: 'Polymorph', icon: 'icon_magic', tint: 0xf0e8ff,
    desc: 'A chosen card becomes WILD: every suit at once, scoring as your suit ({SUIT}).',
    ui: 'pickCards', pick: 1,
    apply(run, { cards }) { if (cards[0]) cards[0].mod = 'wild'; },
  },
  {
    id: 'priestess', name: 'Hex & Ward', icon: 'icon_magic', tint: 0x7fe0f4,
    desc: 'Next fight opens with +20 Shield, and 4 Poison on every enemy.',
    apply(run) { run.pending.shield += 20; run.pending.enemyPoison += 4; },
  },
];

// ---------------------------------------------------------------------------
// THE SMITH
// ---------------------------------------------------------------------------

/**
 * THE SMITH'S CARD ART. His 12 paintings are named for the HAND, not for the
 * option (whose name grows a '×2' on a double tempering), so the slug is
 * pinned per hand type rather than slugified. 'high-crad' is the artist's typo,
 * kept as-shipped alongside the Witch's 'etherial-rite' and the Forge's
 * 'total-tramutation'. (smith_royal-flush.png is drawn but unused — HANDFORGED
 * has no separate Royal Flush hand; a royal IS a straight flush here.)
 */
export const SMITH_ART = {
  highCard: 'high-crad',
  pair: 'pair',
  twoPair: '2-pair',
  trips: '3-of-a-kind',
  straight: 'straight',
  flush: 'flush',
  fullHouse: 'full-house',
  quads: '4-of-a-kind',
  straightFlush: 'straight-flush',
  fiveOfAKind: 'five-of-a-kind',
  flushFive: 'flush-five',
};

/**
 * One hammer-blow on the shelf. The painted card carries the hand's NAME, so
 * everything the pick actually does lives in `desc` — the hover tooltip under
 * the row — spelled out with live numbers (JC: "it should tell you what it does
 * in terms of how much mult it'll increase that hand by"):
 *
 *   Lv.2 → Lv.3   ·   ×4 → ×6 mult
 *   +2 mult, forever, every time you play Full House.
 *
 * Levels display 1-based (level 0 = "Lv.1"), matching the hands chart and the
 * combat equation banner.
 */
function smithOption(type, run, rng = Math.random) {
  const def = HAND_DEFS[type];
  const lvl = run.handLevels?.[type] ?? 0;
  const now = def.mult + lvl * def.levelStep;
  // Deeper acts hammer harder: growing chance of a DOUBLE-level tempering.
  const jumps = rng() < smithDoubleChance(run.actIndex) ? 2 : 1;
  const after = now + def.levelStep * jumps;
  return {
    id: `smith-${type}`, name: jumps > 1 ? `${def.name} ×2` : def.name,
    icon: 'icon_anvil', tint: jumps > 1 ? 0xff8c28 : 0xd07028,
    art: SMITH_ART[type],
    // Plain scalars so the UI (and the tests) never re-derive the math.
    handType: type, levels: jumps, multNow: now, multAfter: after,
    desc: `Lv.${lvl + 1} → Lv.${lvl + 1 + jumps}   ·   ×${now} → ×${after} mult`
      + (jumps > 1 ? '\nDOUBLE TEMPERING: two levels in one strike.' : '')
      + `\n+${after - now} mult every time you play ${def.name}.`,
    apply(r) { r.handLevels[type] = (r.handLevels[type] ?? 0) + jumps; },
  };
}

/**
 * THE SMITH'S SHELF WEIGHTS (JC, 2026-08-01, off the god-run).
 *
 * The Smith used to deal a FLAT shuffle of every discovered hand, which meant
 * a third of his offerings were levels in hands you play twice a run. He now
 * leans on the BREAD AND BUTTER — the hands a deck actually makes — and treats
 * the top of the ladder as the rare treat it should be:
 *
 *   1.5  high card · pair · two pair · straight · flush · full house
 *   0.8  three of a kind        (slightly reduced — it is a fine hand, just
 *                                not one you build a run around)
 *   0.4  four of a kind
 *   0.3  straight flush
 *   0.3  five of a kind · flush five   (secrets; the DISCOVERY gate is
 *                                unchanged and still runs first — a weight
 *                                only matters for a hand you have played)
 *
 * A missing entry weighs 1, so a future hand type appears at par instead of
 * vanishing from the shelf.
 */
export const SMITH_WEIGHTS = {
  highCard: 1.5, pair: 1.5, twoPair: 1.5, straight: 1.5, flush: 1.5, fullHouse: 1.5,
  trips: 0.8,
  quads: 0.4, straightFlush: 0.3,
  fiveOfAKind: 0.3, flushFive: 0.3,
};

/** Weighted, DISTINCT sample of `count` hand types off SMITH_WEIGHTS. */
export function pickSmithTypes(pool, count, rng = Math.random) {
  const left = [...pool];
  const out = [];
  while (out.length < count && left.length) {
    const total = left.reduce((s, t) => s + (SMITH_WEIGHTS[t] ?? 1), 0);
    let r = rng() * total;
    let idx = left.length - 1;
    for (let i = 0; i < left.length; i++) { r -= SMITH_WEIGHTS[left[i]] ?? 1; if (r <= 0) { idx = i; break; } }
    out.push(left.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * THE WORN ANVIL (veryRare): the hand you play most is always on the Smith's
 * shelf. Returns the hand type to force in, or null — no relic, no hands played
 * yet, or the mode is a secret hand this save has never uncovered (impossible
 * in practice: playing one discovers it, but a wiped ledger shouldn't leak).
 * @returns {string|null}
 */
export function anvilForcedType(run) {
  if (!getProp(ownedArtifacts(run), 'anvilMemory')) return null;
  const type = mostPlayedHandType(run);
  if (!type || !isHandDiscovered(type)) return null;
  return type;
}

// ---------------------------------------------------------------------------
// THE ARTISAN
// ---------------------------------------------------------------------------

/**
 * What the Artisan can press into a card. `layer` says WHICH of the card's three
 * layers the entry writes: 'mod' for the identity layer, 'stamp' for the wax.
 * ECHO moved to the stamp layer in 0803-B, so it is written there and the
 * artisan's card is built one layer at a time rather than assuming a mod.
 */
const ARTISAN_MODS = [
  { mod: null, w: 30 },
  { mod: 'enhanced', w: 24 },
  { mod: 'gilded', w: 16 },
  { mod: 'wild', w: 14 },
  { mod: 'echo', w: 16, layer: 'stamp' },
];
const MOD_BLURB = {
  enhanced: '+10 value', gilded: 'pays 4 chips when scored',
  wild: 'every suit at once', echo: 'scores twice',
};

function artisanCard(run, rng) {
  const total = ARTISAN_MODS.reduce((s, m) => s + m.w, 0);
  let r = rng() * total;
  let pick = ARTISAN_MODS[0];
  for (const m of ARTISAN_MODS) { r -= m.w; if (r <= 0) { pick = m; break; } }
  const mod = pick.mod;
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 11, 12, 13, 14]; // face/ace lean
  const rank = ranks[Math.floor(rng() * ranks.length)];
  const suit = SUITS[Math.floor(rng() * SUITS.length)];
  const card = { id: `artisan-${suit}-${rank}-${Math.floor(rng() * 1e6)}`, suit, rank };
  if (mod) card[pick.layer ?? 'mod'] = mod;
  return {
    id: card.id, name: '', card,
    desc: mod ? MOD_BLURB[mod] : 'a solid, honest card',
    apply(r) { r.runDeck.push(card); },
  };
}

// ---------------------------------------------------------------------------
// THE DEALER — every prize has a price. Options declare available(run);
// apply() pays the cost AND grants the prize. Descriptions carry the terms.
// ---------------------------------------------------------------------------

/**
 * Exactly TEN deals (2026-07-31): Insurance Policy was cut so the Dealer and
 * the Witch both sit at a clean 10, and THE HOUSE SPINS took its seat. Every
 * id here is also an ART SLOT — assets/ui/deals/<id>.png, drawn as a physical
 * card in the spread the moment the file lands (see rewards.js / BootScene).
 */
export const DEALER_DEALS = [
  {
    id: 'deal-loan', name: 'High-Stakes Loan', icon: 'icon_coins', tint: 0xffd23e,
    desc: 'GAIN 200 chips.\nPRICE: 20 HP, up front.',
    available: r => r.player.hp > 21,
    apply(r) { r.player.hp -= 20; gainGold(200, r); },
  },
  {
    id: 'deal-pockets', name: 'Bigger Pockets', icon: 'icon_star', tint: 0xe8d8a0,
    desc: 'GAIN +1 Hand size.\nPRICE: 3 random cards vanish from your deck.',
    // The three are DRAWN when the deal hits the table. A price you cannot see
    // is not a price, it is a surprise.
    resolve(r, rng = Math.random) {
      const pool = [...r.runDeck];
      const doomed = [];
      for (let i = 0; i < 3 && pool.length; i++) doomed.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      if (!doomed.length) return null;
      return {
        desc: `GAIN +1 Hand size.\nPRICE: your ${cardList(doomed)} vanish from your deck.`,
        cards: doomed,
        apply(run) {
          run.player.handSize += 1;
          for (const c of doomed) {
            const i = run.runDeck.indexOf(c);
            if (i >= 0) run.runDeck.splice(i, 1);
          }
        },
      };
    },
    available: r => r.runDeck.length >= 20,
    apply(r) {
      r.player.handSize += 1;
      for (let i = 0; i < 3 && r.runDeck.length; i++) {
        r.runDeck.splice(Math.floor(Math.random() * r.runDeck.length), 1);
      }
    },
  },
  {
    id: 'deal-discount', name: 'House Discount', icon: 'icon_trash', tint: 0x9a4030,
    desc: 'GAIN +1 Discard every fight.\nPRICE: 100 chips.',
    available: r => r.chips >= 100,
    apply(r) { r.chips -= 100; r.discardsPerFightBonus += 1; },
  },
  {
    id: 'deal-racket', name: 'Suit Racket', icon: 'icon_gem', tint: 0x2bb3d6,
    desc: 'GAIN: a chosen suit is worth +2 value all run.\nPRICE: your 3 highest cards.',
    resolve(r) {
      const paid = highest(r.runDeck, 3);
      return { desc: `GAIN: a chosen suit is worth +2 value all run.\nPRICE: your ${cardList(paid)}.`, cards: paid };
    },
    ui: 'pickSuit',
    available: r => r.runDeck.length >= 15,
    apply(r, { suit }) {
      r.bonusMods.suitValue[suit] = (r.bonusMods.suitValue[suit] ?? 0) + 2;
      // Same three cards resolve() named, taken out by identity rather than by
      // sorting the master deck in place.
      for (const c of highest(r.runDeck, 3)) {
        const i = r.runDeck.indexOf(c);
        if (i >= 0) r.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'deal-marked', name: 'Marked Cards', icon: 'icon_star', tint: 0xc060c0,
    desc: 'GAIN: two copies of your highest card.\nPRICE: 12 HP.',
    resolve(r) {
      const top = highest(r.runDeck, 1)[0];
      return { desc: `GAIN: two more copies of your ${cardLabel(top)}.\nPRICE: 12 HP.`, cards: [top] };
    },
    available: r => r.player.hp > 13,
    apply(r) {
      r.player.hp -= 12;
      const top = highest(r.runDeck, 1)[0];
      if (top) {
        r.runDeck.push({ ...top, id: `${top.id}#mk1${r.runDeck.length}` });
        r.runDeck.push({ ...top, id: `${top.id}#mk2${r.runDeck.length}` });
      }
    },
  },
  {
    // Priced ON THE CURVE with the other chip deals: Cheap Trick's one gilded
    // card is 15, Loaded Deal's two rewrites are 50 + 5 HP, Card Laundering's
    // three removals are 60. Two ROULETTE cards is a swingy two-card rewrite,
    // so it sits exactly with Loaded Deal — 50, no blood.
    id: 'deal-spins', name: 'The House Spins', icon: 'icon_dice', tint: 0x2e8b57,
    desc: 'GAIN: 2 chosen cards become ROULETTE, spinning again every activation for chips, mult, value or nothing.\nPRICE: 50 chips.',
    ui: 'pickCards', pick: 2,
    available: r => r.chips >= 50 && r.runDeck.length >= 2,
    apply(r, { cards }) {
      r.chips -= 50;
      for (const c of cards) c.mod = 'roulette';
    },
  },
  {
    id: 'deal-launder', name: 'Card Laundering', icon: 'icon_skull', tint: 0x8898b8,
    desc: 'GAIN: remove up to 3 chosen cards.\nPRICE: 60 chips.',
    ui: 'pickCards', pick: 3, optional: true,
    available: r => r.chips >= 60,
    apply(r, { cards }) {
      r.chips -= 60;
      for (const c of cards) {
        const i = r.runDeck.indexOf(c);
        if (i >= 0) r.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'deal-loaded', name: 'Loaded Deal', icon: 'icon_refresh', tint: 0x50b888,
    desc: 'GAIN: your 2 lowest cards become copies of your highest.\nPRICE: 50 chips and 5 HP.',
    resolve(r) {
      const low = lowest(r.runDeck, 2);
      const high = highest(r.runDeck, 1)[0];
      // Preview order matches the sentence order: the two that CHANGE, then the
      // one they are copied from.
      return {
        desc: `GAIN: your ${cardList(low)} become copies of your ${cardLabel(high)}.\nPRICE: 50 chips and 5 HP.`,
        cards: [...low, high],
      };
    },
    available: r => r.chips >= 50 && r.player.hp > 6 && r.runDeck.length >= 3,
    // Uses the SAME helpers resolve() used, so the cards the tooltip named are
    // exactly the cards that change — ties included (an ascending sort's last
    // element and a descending sort's first are different cards when ranks tie).
    apply(r) {
      r.chips -= 50; r.player.hp -= 5;
      const low = lowest(r.runDeck, 2);
      const high = highest(r.runDeck, 1)[0];
      low.forEach((c, k) => {
        const i = r.runDeck.indexOf(c);
        if (i >= 0) r.runDeck[i] = { ...high, id: `${high.suit}-${high.rank}#ld${k}${r.runDeck.length}` };
      });
    },
  },
  {
    id: 'deal-favor', name: "Pit Boss's Favor", icon: 'icon_magic', tint: 0x8a5cd0,
    desc: 'GAIN: a random artifact.\nPRICE: 150 chips. No refunds.',
    available: r => r.chips >= 150,
    apply(r) {
      r.chips -= 150;
      const def = rollEliteDrop(r.artifacts.map(a => a.id), 0, Math.random, r.chrId);
      return def ? { artifact: def } : { text: 'The Pit Boss owns nothing you lack. He returns your chips, insulted.', chips: gainGold(150, r) };
    },
  },
  {
    id: 'deal-trick', name: 'Cheap Trick', icon: 'icon_coins', tint: 0xd8b830,
    desc: 'GAIN: a random card becomes GILDED (pays 4 chips when scored).\nPRICE: 15 chips.',
    resolve(r, rng = Math.random) {
      const pool = r.runDeck.filter(c => !c.mod);
      const c = pool[Math.floor(rng() * pool.length)];
      if (!c) return null;
      return {
        desc: `GAIN: your ${cardLabel(c)} becomes GILDED (pays 4 chips when scored).\nPRICE: 15 chips.`,
        cards: [c],
        apply(run) { run.chips -= 15; c.mod = 'gilded'; },
      };
    },
    available: r => r.chips >= 15,
    apply(r) {
      r.chips -= 15;
      const pool = r.runDeck.filter(c => !c.mod);
      const c = pool[Math.floor(Math.random() * pool.length)];
      if (c) c.mod = 'gilded';
    },
  },
];

// ---------------------------------------------------------------------------
// THE FORGE
// ---------------------------------------------------------------------------

const MYTHIC_EMBER_CHANCE = 0.10;
/** The game's namesake. JC 2026-07-31: "1/20 is solid." */
const REFORGE_CHANCE = 0.05;

/** RE-FORGE and MYTHIC EMBER — built here so the art listing can see them too. */
const FORGE_SPECIALS = {
  reforge: {
    id: 'forge-reforge', name: 'RE-FORGE', art: 'reforge', icon: 'icon_refresh', tint: 0xe03040, mythic: true,
    desc: 'Choose a relic you own. It is HAND-FORGED ANEW: an exact copy, growth and all.',
    ui: 'pickArtifact',
    apply(r, { artifact }) {
      return artifact ? { reforge: artifact } : { text: 'The forge cools, unchosen.' };
    },
  },
  ember: {
    id: 'forge-ember', name: 'MYTHIC EMBER', icon: 'icon_fire', tint: 0xe03040, mythic: true,
    desc: 'Summon a MYTHICAL relic. A coal that never cooled.',
    apply(r) {
      const def = rollMythical(r.artifacts.map(a => a.id), Math.random, r.chrId);
      return def ? { mythical: def } : { text: 'The ember gutters. Every myth is already yours. +200 chips.', chips: gainGold(200, r) };
    },
  },
};

/**
 * THE FORGE, spectral edition (JC, 2026-07-29): no stat porridge — every
 * option warps the deck or the run. Think Balatro spectrals.
 * 2026-07-31: Spectral Temper CUT (Foil Press took its seat; the SPECTRAL card
 * mod itself lives on elsewhere), Ritual of Ash pays +3, Total Transmutation
 * became a five-card suit rewrite.
 * Hoisted out of forgeOptions so the option-card art listing can read it.
 */
function forgePool(chrSuit) {
  return [
    {
      id: 'forge-triplicate', name: 'Triplicate', icon: 'icon_star', tint: 0xffc542,
      desc: 'Choose a card. The forge hammers out TWO MORE of it, mods and all.',
      ui: 'pickCards', pick: 1,
      apply(r, { cards }) {
        const c = cards[0];
        if (!c) return;
        r.runDeck.push({ ...c, id: `${c.id}#tri1${r.runDeck.length}` });
        r.runDeck.push({ ...c, id: `${c.id}#tri2${r.runDeck.length}` });
      },
    },
    {
      id: 'forge-wildsurge', name: 'Wild Surge', icon: 'icon_magic', tint: 0xc9a2ff,
      desc: 'FIVE random WILD cards erupt into your deck: every suit at once, scoring as your suit ({SUIT}).',
      apply(r) {
        for (let i = 0; i < 5; i++) {
          const rank = 2 + Math.floor(Math.random() * 13);
          const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
          r.runDeck.push({ id: `wildsurge-${rank}-${i}-${r.runDeck.length}`, suit, rank, mod: 'wild' });
        }
      },
    },
    {
      id: 'forge-nuke', name: 'THE NUKE', icon: 'icon_fire', tint: 0xff5030,
      desc: `Adds THE NUKE to your deck: a ${SUIT_GLYPH[chrSuit]} card worth 100 raw value.`,
      apply(r) {
        r.runDeck.push({ id: `nuke-${r.runDeck.length}`, suit: chrSuit, rank: 10, mod: 'nuke' });
      },
    },
    {
      id: 'forge-foil', name: 'Foil Press', icon: 'icon_star', tint: 0xbfd8ff,
      // SHINY is a WRAPPER now, not a mod — the press lays foil OVER whatever
      // the card already is, so a shiny stamped roulette card is legal.
      desc: 'Choose a card. It becomes SHINY: ×1.25 mult every time it scores, on top of whatever it already is.',
      ui: 'pickCards', pick: 1,
      apply(r, { cards }) { if (cards[0]) cards[0].wrap = 'shiny'; },
    },
    {
      id: 'forge-echo', name: 'Echo Strike', icon: 'icon_refresh', tint: 0x4aa8ff,
      // ECHO is a SEAL now (0803-B), pressed into the wax like blood and mult:
      // it takes nothing away from whatever the card already IS, and it competes
      // with the other two seals rather than with the card's mod.
      desc: 'A chosen card takes the ECHO SEAL: it scores TWICE every time it plays, and its LEFTOVER-in-hand effects fire one extra time. It keeps whatever the card already was.',
      ui: 'pickCards', pick: 1,
      apply(r, { cards }) { if (cards[0]) cards[0].stamp = 'echo'; },
    },
    {
      id: 'forge-ash', name: 'Ritual of Ash', icon: 'icon_skull', tint: 0xe06828,
      desc: 'Burn 3 chosen cards forever. EVERY hand type gains +3 mult, permanently.',
      ui: 'pickCards', pick: 3,
      apply(r, { cards }) {
        for (const c of cards) {
          const i = r.runDeck.indexOf(c);
          if (i >= 0) r.runDeck.splice(i, 1);
        }
        r.bonusMods.handMult ??= {};
        for (const t of HAND_TYPES) r.bonusMods.handMult[t] = (r.bonusMods.handMult[t] ?? 0) + 3;
      },
    },
    {
      // art: JC's file reads 'total-tramutation'.
      id: 'forge-transmute', name: 'Total Transmutation', art: 'total-tramutation',
      icon: 'icon_gem', tint: 0xb45cff,
      desc: 'Choose up to 5 cards and a suit. All of them become that suit.',
      ui: 'pickCardsThenSuit', pick: 5, optional: true,
      apply(r, { cards, suit }) {
        if (!suit) return;
        for (const c of cards) c.suit = suit;
      },
    },
  ];
}

function forgeOptions(run, rng) {
  // THE HERO'S OWN SUIT, off the character table rather than a hand-kept copy
  // of it. The copy went stale the moment DRUSKY shipped: `hoarder` was not in
  // it, so every "your suit" offer on the Crimson Forge's shelf was built for
  // SWORDS on a Drusky run when his suit is GEMS. CHARACTERS is the one place
  // that knows, so a sixth hero cannot break this again.
  const chrSuit = CHARACTERS[run.chrId]?.suit ?? 'swords';
  const out = forgePool(chrSuit).sort(() => rng() - 0.5).slice(0, 3);
  // The game's namesake, 1/20: RE-FORGE duplicates a relic you already own.
  if (run.artifacts.length > 0 && rng() < REFORGE_CHANCE) {
    out[Math.floor(rng() * out.length)] = FORGE_SPECIALS.reforge;
  }
  if (rng() < MYTHIC_EMBER_CHANCE) {
    // Never overwrite a RE-FORGE that already claimed a slot.
    const open = out.map((o, i) => (o.mythic ? -1 : i)).filter(i => i >= 0);
    if (open.length) out[open[Math.floor(rng() * open.length)]] = FORGE_SPECIALS.ember;
  }
  return out;
}

/**
 * Every option-card texture the game should preload: [kind, slug] pairs for all
 * FIVE packs that deal painted cards. The Smith's are keyed by hand type (his
 * slugs are pinned in SMITH_ART), and the two SECRET hands are loaded like any
 * other — the gate on them is the offer pool, not the texture cache.
 *
 * BOUNTY (JC, 2026-08-01) joined the family: the act-boss payoff deals its 11
 * rewards as painted cards too. It is declared below this function, which is
 * fine — nothing calls packCardArtList() until BootScene's preload, long after
 * the module has finished evaluating.
 */
export function packCardArtList() {
  const out = [];
  for (const slug of Object.values(SMITH_ART)) out.push(['smith', slug]);
  for (const o of WITCH_RITES) out.push(['witch', optionArtSlug(o)]);
  for (const o of DEALER_DEALS) out.push(['dealer', optionArtSlug(o)]);
  for (const o of forgePool('swords')) out.push(['forge', optionArtSlug(o)]);
  for (const o of Object.values(FORGE_SPECIALS)) out.push(['forge', optionArtSlug(o)]);
  for (const o of BOUNTY_REWARDS) out.push(['bounty', optionArtSlug(o)]);
  // THE ORACLE's twenty are painted too, and all twenty must be in the cache
  // before the first map paints: the pack opens on ARRIVAL, with no fight in
  // front of it to hide a late load behind.
  for (const o of ORACLE_OPTIONS) out.push(['oracle', optionArtSlug(o)]);
  return out;
}

// ---------------------------------------------------------------------------
// THE BOUNTY HUNTER — the act-boss payoff. Not offered at the pack table and
// never chosen: it arrives already open, once per act cleared. Three distinct
// rewards, weight-rolled (RARE entries at 0.3 against the standard 1.0).
// ---------------------------------------------------------------------------

/**
 * THE FORGE WHEEL, laid out as 20 wedges so the odds are legible ON the wheel:
 *   25% MYTHIC relic · 50% fair (+100 chips / heal 20 / a common relic)
 *   20% sour (nothing / −25 chips) · 5% RE-FORGE a relic you own.
 * Segment counts are exactly 5 / 4+3+3 / 2+2 / 1, interleaved so no bucket
 * clumps. spinBountyWheel() rolls the same distribution the layout shows.
 */
export const BOUNTY_WHEEL_SEGMENTS = [
  { label: 'MYTHIC', color: 0xc08a2a, bucket: 'mythic' },
  { label: '+100', color: 0x4a6a52, bucket: 'chips' },
  { label: 'BUST', color: 0x5a2a34, bucket: 'nothing' },
  { label: 'HEAL', color: 0x3f6b57, bucket: 'heal' },
  { label: 'MYTHIC', color: 0xc08a2a, bucket: 'mythic' },
  { label: 'RELIC', color: 0x46607a, bucket: 'relic' },
  { label: '-25', color: 0x4a2430, bucket: 'lose' },
  { label: '+100', color: 0x4a6a52, bucket: 'chips' },
  { label: 'MYTHIC', color: 0xc08a2a, bucket: 'mythic' },
  { label: 'HEAL', color: 0x3f6b57, bucket: 'heal' },
  { label: 'BUST', color: 0x5a2a34, bucket: 'nothing' },
  { label: 'RELIC', color: 0x46607a, bucket: 'relic' },
  { label: 'MYTHIC', color: 0xc08a2a, bucket: 'mythic' },
  { label: '+100', color: 0x4a6a52, bucket: 'chips' },
  { label: '-25', color: 0x4a2430, bucket: 'lose' },
  { label: 'HEAL', color: 0x3f6b57, bucket: 'heal' },
  { label: 'FORGE', color: 0xe03040, bucket: 'reforge' },
  { label: 'RELIC', color: 0x46607a, bucket: 'relic' },
  { label: 'MYTHIC', color: 0xc08a2a, bucket: 'mythic' },
  { label: '+100', color: 0x4a6a52, bucket: 'chips' },
];

/** bucket -> the wedge indices that show it (what the pointer may land on). */
export const BOUNTY_WHEEL_LANDS = BOUNTY_WHEEL_SEGMENTS.reduce((m, s, i) => {
  (m[s.bucket] ??= []).push(i);
  return m;
}, {});

function randomCommonRelic(ownedIds, rng, heroId = null) {
  // rollOfRarity filters through eligibleFor, which is belt AND braces here: no
  // COMMON is hero-gated today, but every other roll path in the game filters,
  // and this one used not to.
  return rollOfRarity('common', ownedIds, rng, heroId) ?? rollEliteDrop(ownedIds, 0, rng, heroId);
}

/**
 * Spin. Mutates `run` for the immediate buckets and returns a directive the UI
 * finishes: { wheel: bucket, text, mythical? | artifact? | pickReforge? }.
 */
export function spinBountyWheel(run, rng = Math.random) {
  const owned = run.artifacts.map(a => a.id);
  const roll = rng();
  if (roll < 0.25) {
    const def = rollMythical(owned, rng, run.chrId);
    if (def) return { wheel: 'mythic', mythical: def };
    gainGold(300, run);
    return { wheel: 'mythic', text: 'Every myth is already yours. +300 chips.' };
  }
  if (roll < 0.45) {
    gainGold(100, run);
    return { wheel: 'chips', text: 'The hunter counts it out. +100 chips.' };
  }
  if (roll < 0.60) {
    const before = run.player.hp;
    run.player.hp = Math.min(run.player.maxHp, run.player.hp + 20);
    return { wheel: 'heal', text: `Field dressing. +${run.player.hp - before} HP.` };
  }
  if (roll < 0.75) {
    const def = randomCommonRelic(owned, rng, run.chrId);
    return def ? { wheel: 'relic', artifact: def }
      : { wheel: 'relic', text: 'Nothing left in the sack. +100 chips.', chips: gainGold(100, run) };
  }
  if (roll < 0.85) return { wheel: 'nothing', text: 'The wheel stops on nothing. The hunter shrugs.' };
  if (roll < 0.95) {
    const lost = Math.min(25, run.chips);
    run.chips -= lost;
    return { wheel: 'lose', text: `A finder's fee, apparently. −${lost} chips.` };
  }
  if (run.artifacts.length) return { wheel: 'reforge', pickReforge: true };
  const def = rollEliteDrop(owned, 1, rng, run.chrId);
  return def ? { wheel: 'reforge', artifact: def }
    : { wheel: 'reforge', text: 'Nothing to copy. +200 chips.', chips: gainGold(200, run) };
}

/** w: roll weight (RARE entries sit at 0.3 against everyone else's 1.0). */
export const BOUNTY_REWARDS = [
  {
    id: 'bounty-chips', name: 'BLOOD MONEY', icon: 'icon_coins', tint: 0xffd23e, w: 1,
    desc: 'Gain 200 chips.\nThe board pays for a dead boss.',
    apply(r) { gainGold(200, r); },
  },
  {
    id: 'bounty-relic', name: "HUNTER'S CACHE", icon: 'icon_gem', tint: 0xff8c28, w: 1,
    // UPGRADED (JC, 2026-07-31): it used to be a random relic off the ordinary
    // curve, which meant a dead act boss regularly paid a common. The cache is
    // VERY RARE OR BETTER — 50% very rare · 30% legendary · 13% hero exclusive
    // · 7% mythical (artifacts.js CACHE_TIER_WEIGHTS), stepping down a tier only
    // if the whole top of the pool is already yours. (The floor was a Legendary
    // until the 2026-08-02 nerf pass; three bosses a run made that most of a
    // build before Act III.)
    desc: 'A VERY RARE or better relic.\nWhatever the last hunter died carrying.',
    apply(r) {
      const def = rollLegendaryPlus(r.artifacts.map(a => a.id), Math.random, r.chrId);
      return def ? { artifact: def } : { text: 'The cache is empty. +150 chips.', chips: gainGold(150, r) };
    },
  },
  {
    id: 'bounty-wheel', name: 'THE FORGE WHEEL', icon: 'icon_dice', tint: 0xb45cff, w: 1,
    desc: 'One spin.\n25% MYTHIC · 50% fair · 20% sour · 5% RE-FORGE.',
    ui: 'wheel', segments: BOUNTY_WHEEL_SEGMENTS, landPools: BOUNTY_WHEEL_LANDS, wheelFont: 15,
    apply(r, _, rng = Math.random) { return spinBountyWheel(r, rng); },
  },
  {
    id: 'bounty-purge', name: 'CLEAN SWEEP', icon: 'icon_trash', tint: 0x9a4030, w: 1,
    desc: 'Remove 2 cards from your deck, free.',
    ui: 'pickCards', pick: 2, optional: true, sample: 0,
    apply(r, { cards }) {
      for (const c of cards) {
        const i = r.runDeck.indexOf(c);
        if (i >= 0) r.runDeck.splice(i, 1);
      }
    },
  },
  {
    id: 'bounty-wild', name: 'WILD PAPERS', icon: 'icon_magic', tint: 0xc9a2ff, w: 1,
    desc: 'Turn 3 cards WILD: every suit at once, scoring as your suit ({SUIT}).',
    ui: 'pickCards', pick: 3, optional: true, sample: 0, cardFilter: c => !c.mod,
    apply(r, { cards }) { for (const c of cards) if (!c.mod) c.mod = 'wild'; },
  },
  {
    id: 'bounty-dupe', name: 'FORGED PAPERS', icon: 'icon_refresh', tint: 0xffc542, w: 0.3, rare: true,
    desc: 'Duplicate one card, mods and all.',
    ui: 'pickCards', pick: 1, sample: 0,
    apply(r, { cards }) {
      const c = cards[0];
      if (c) r.runDeck.push({ ...c, id: `${c.id}#bounty${r.runDeck.length}` });
    },
  },
  {
    id: 'bounty-discard', name: 'SLEIGHT OF HAND', icon: 'icon_trash', tint: 0x50b888, w: 1,
    desc: '+1 Discard in every fight, forever.',
    apply(r) { r.discardsPerFightBonus += 1; },
  },
  {
    id: 'bounty-handsize', name: 'BIGGER GRIP', icon: 'icon_star', tint: 0xe8d8a0, w: 0.3, rare: true,
    desc: '+1 Hand size for the rest of the run.',
    apply(r) { r.player.handSize += 1; },
  },
  {
    id: 'bounty-merchant', name: 'THE MERCHANT', icon: 'icon_coins', tint: 0xd8b830, w: 1,
    desc: 'Visit a shop right now.\nHe set up camp on the way down.',
    apply() { return { shop: true }; },
  },
  {
    id: 'bounty-maxhp', name: 'HOT MEAL', icon: 'icon_heart_small', tint: 0x50e090, w: 1,
    desc: '+15 Max HP, and heal 15. Eat it while it is hot.',
    apply(r) {
      r.player.maxHp += 15;
      r.player.hp = Math.min(r.player.maxHp, r.player.hp + 15);
    },
  },
  {
    id: 'bounty-slot', name: 'SPARE HOOK', icon: 'icon_key', tint: 0xffd23e, w: 0.3, rare: true,
    desc: '+1 Relic slot. It is a hook. It was going spare.',
    apply(r) { r.artifactSlots += 1; },
  },
];

/**
 * DEV / drivers: an EXACT bounty shelf, by id, resolved exactly as a real roll
 * is. THE MERCHANT is one weight in a pool of a dozen, so the only way a driver
 * could see him in the ceremony was to clear the act over and over and hope —
 * a coin flip dressed up as a test, and one that runs out of acts. Same idea as
 * run.debugEncounter: name what you want, once. Unknown ids are dropped.
 */
export function bountyRewardsById(run, ids) {
  const picked = (ids ?? [])
    .map(id => BOUNTY_REWARDS.find(o => o.id === id))
    .filter(Boolean);
  return resolveOptions(picked, run);
}

/** Weighted, distinct roll of `count` bounty rewards. */
export function rollBountyRewards(run, count = 3, rng = Math.random) {
  const pool = BOUNTY_REWARDS.filter(o => !o.available || o.available(run));
  const out = [];
  const left = [...pool];
  while (out.length < count && left.length) {
    const total = left.reduce((s, o) => s + (o.w ?? 1), 0);
    let r = rng() * total;
    let idx = left.length - 1;
    for (let i = 0; i < left.length; i++) { r -= left[i].w ?? 1; if (r <= 0) { idx = i; break; } }
    out.push(left.splice(idx, 1)[0]);
  }
  return resolveOptions(out, run);
}

// ---------------------------------------------------------------------------

/**
 * Open a pack: returns { pack, options } — options.length = base + packExtra.
 * Witch/Smith show 3 (+extra), Artisan shows 4 (+extra) actual cards.
 */
export function openPack(kind, run, extra = 0, rng = Math.random) {
  const pack = PACK_TYPES[kind];
  let options;
  if (kind === 'witch') {
    options = [...WITCH_RITES].sort(() => rng() - 0.5).slice(0, 3 + extra);
  } else if (kind === 'dealer') {
    options = [...DEALER_DEALS].sort(() => rng() - 0.5).slice(0, 3 + extra);
  } else if (kind === 'smith') {
    // Secret hands are not on the shelf until you've played one — the Smith
    // won't temper a hand you don't know exists.
    const pool = HAND_TYPES.filter(isHandDiscovered);
    const count = Math.min(3 + extra, pool.length);
    // Weighted toward the hands you actually make — see SMITH_WEIGHTS.
    const types = pickSmithTypes(pool, count, rng);
    // THE WORN ANVIL: your most-played hand is always among the offerings. If
    // the shuffle already dealt it, it just gets the badge.
    const forced = anvilForcedType(run);
    if (forced && !types.includes(forced)) types[types.length - 1] = forced;
    options = types.map((t) => {
      const opt = smithOption(t, run, rng);
      if (t === forced) opt.anvil = true;
      return opt;
    });
  } else if (kind === 'artisan') {
    options = Array.from({ length: 4 + extra }, () => artisanCard(run, rng));
  } else if (kind === 'bounty') {
    // THE ORACLE'S HUNTER can seat the bounty wrapper at the ordinary pack
    // table, so the table has to know how to open it: the same weighted roll the
    // act-boss payoff deals, already resolved.
    return { pack, options: rollBountyRewards(run, 3 + extra, rng) };
  } else {
    options = forgeOptions(run, rng);
    if (extra > 0) options.push({
      id: 'forge-bonus-gold', name: 'Spare Ingot', icon: 'icon_coins', tint: 0xffd23e,
      desc: 'Gain 60 chips.', apply(r) { gainGold(60, r); },
    });
  }
  // Last step, always: any option that can name the cards it is about to touch
  // does so NOW, against the deck the player is looking at.
  return { pack, options: resolveOptions(options, run) };
}
