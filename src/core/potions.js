/**
 * @file potions.js
 * POTIONS — Balatro tarot × Slay the Spire potions. Bought at shops (they
 * share the mat with artifacts), held in a 3-slot belt, drunk for one-shot
 * effects: this turn, this fight, or instant (heal / revive).
 *
 * Pure data + rolling helpers, no Phaser. The scenes interpret `effect`
 * descriptors (same philosophy as enemy intent effect-lists):
 *   CombatScene → combat effects (damage, shield, draw, dupes, echo...)
 *   MapScene    → 'anywhere' potions usable while planning (heal)
 *   run/death   → 'passive' potions (Fairy in a Bottle checks on death)
 *
 * RARITY IS ONE SYSTEM (JC): potions use the exact same five tiers, labels,
 * colors and shop-frequency philosophy as ARTIFACT_RARITY — a Very Rare potion
 * is purple next to a Very Rare relic, and a Mythical potion is as rare on the
 * mat as a Mythical relic. Price tracks power and sits one notch under the
 * relic of the same tier, because a potion is spent and a relic is forever.
 */

import { gainGold } from './run.js';
// The two numbers the Phantom Phial quotes live in the scoring engine, so the
// bottle READS them rather than restating them: its label said x1.5 and 25%, and
// by 2026-08-04 both of those were wrong.
import { MOD_MULT_FACTOR, ETHEREAL_VANISH_CHANCE, SEAL_HEAL } from './scoring.js';

export const MAX_POTIONS = 3;

/**
 * Mirrors ARTIFACT_RARITY (same keys, labels, colors, shopWeight shape).
 * Mythicals are weight 0 — they never come out of the weighted roll and only
 * reach the mat through the ~1% sneak in rollShopPotions(), exactly like relics.
 */
export const POTION_RARITY = {
  common:    { label: 'COMMON',    color: 0xdadada, shopWeight: 40 },
  rare:      { label: 'RARE',      color: 0x4aa8ff, shopWeight: 34 },
  veryRare:  { label: 'VERY RARE', color: 0xa855f7, shopWeight: 18 },
  legendary: { label: 'LEGENDARY', color: 0xff8c28, shopWeight: 8  },
  mythical:  { label: 'MYTHICAL',  color: 0xe03040, shopWeight: 0  },
};

export const POTION_RARITY_ORDER = ['common', 'rare', 'veryRare', 'legendary', 'mythical'];

/**
 * SELLING A BOTTLE BACK (JC, 2026-08-01). Only at the merchant's table, and on
 * the same quarter-of-price basis relics use (run.SELL_FRACTION) — a belt of
 * three combat-only brews should never be the reason you cannot buy the potion
 * that would actually win the run. Floored at 5 so the cheapest common is still
 * worth the walk. Deliberately NOT available out on the map: the merchant is
 * the one who buys things.
 */
export const POTION_SELL_FRACTION = 0.25;
export function potionSellValue(pot) {
  return Math.max(5, Math.round((pot?.price ?? 20) * POTION_SELL_FRACTION));
}

/** Once in a hundred restocks a Mythical potion sneaks onto the lower shelf. */
export const SHOP_MYTHIC_POTION_CHANCE = 0.01;

/**
 * LIQUID ICE, the only potion on the FLAT VALUE channel — buffed 10 -> 20 by
 * THE HANDS OVERHAUL (2026-08-06) alongside the flat value relics. Both the
 * effect and the label read this, so the bottle cannot lie about itself.
 */
export const LIQUID_ICE_VALUE = 20;

/**
 * Effect descriptor cheat-sheet (interpreted by the scenes):
 *  { type:'shield', value }           — gain shield now (combat)
 *  { type:'draw', value }             — draw N extra cards into this hand
 *  { type:'discard', value }          — +N discards this fight
 *  { type:'heal', value }             — heal HP (usable anywhere)
 *  { type:'redraw' }                  — toss this hand, deal a fresh one (free)
 *  { type:'cleanse' }                 — clear player debuffs (bleed/poison/brittle/fear/freeze/hypnotize)
 *  { type:'damage', value, actTable } — hit one enemy for value × actTable[actIndex],
 *                                       CLAMPED at the table's last rung, so an
 *                                       ENDLESS act pays the Act IV number and
 *                                       never falls off the end into ×1
 *  { type:'poison', hpFrac }          — poison one enemy; stacks sized so the
 *                                       full tick-down ≈ hpFrac of its max HP
 *  { type:'dupeHand', permanent }     — pick a hand card, copy it (fight-only or forever)
 *  { type:'summonDraw' }              — pick ANY card from the draw pile → hand
 *  { type:'nextHandFactor', value }   — next played hand scores ×value
 *  { type:'echoHand' }                — your next hand plays TWICE
 *  { type:'handSize', value }         — +N hand size this fight
 *  { type:'makeWild' }                — pick a hand card, it becomes Wild PERMANENTLY
 *  { type:'modCards', mod, count }    — pick `count` hand cards; each takes `mod`
 *                                       PERMANENTLY (the pick-2 mod bottles). The
 *                                       potion is drunk on the FIRST pick, so a
 *                                       cancel after it costs you the rest.
 *  { type:'revive', frac }            — passive: on death, revive at frac × maxHp
 *  { type:'refillBelt', value }       — fill every EMPTY belt slot (up to value)
 *                                       with a random potion. The drinker's own
 *                                       slot has already been freed, so it
 *                                       counts; filled slots are never touched.
 *  { type:'chips', value }            — +value chips (usable anywhere)
 *  { type:'doubleChips', cap }        — chips ×2, gain capped at `cap`
 *
 * The 2026-08-02 wave (five new interpreters, all in CombatScene):
 *  { type:'playAll' }                 — GO-GO GOO. Plays every card in hand as
 *                                       ONE hand and SUSPENDS THE KICKER RULE
 *                                       for that play: every card contributes
 *                                       its value, while the best hand present
 *                                       still sets the type and the mult. It
 *                                       spends a hand off the clock like any
 *                                       other play. The only place in the game
 *                                       where a kicker scores — see
 *                                       scoreHand's `state.allScore`.
 *  { type:'transform' }               — becomes a DIFFERENT random potion in
 *                                       the SAME belt slot, rarity-weighted,
 *                                       never itself. NOT auto-drunk.
 *  { type:'destroyCard' }             — pick a hand card; it leaves the RUN
 *                                       DECK forever (burnCardForever).
 *  { type:'handValue', value }        — +value on your next played hand, PRE-mult
 *                                       (a fight-local flag beside potionNextFactor)
 *  { type:'nothing' }                 — nothing. On purpose.
 */
export const POTION_POOL = [
  // ---- COMMON (9) — cheap tempo sips: a sip of shield, a heal, a do-over --
  {
    id: 'ironbarkTonic', name: 'Ironbark Tonic', rarity: 'common', price: 25,
    tint: 0xc8a050, use: 'combat',
    desc: 'Drink: gain 30 Shield.',
    effect: { type: 'shield', value: 30 },
  },
  {
    id: 'mulliganBrew', name: 'Mulligan Brew', rarity: 'common', price: 25,
    tint: 0xa8e8b0, use: 'combat',
    desc: 'Drink: gain 1 extra discard this fight.',
    effect: { type: 'discard', value: 1 },
  },
  {
    id: 'honeyMead', name: 'Honeyed Mead', rarity: 'common', price: 25,
    tint: 0xe8b030, use: 'anywhere',
    desc: 'Drink: heal 25 HP. Usable anywhere.',
    effect: { type: 'heal', value: 25 },
  },
  {
    id: 'clarityTonic', name: 'Tonic of Clarity', rarity: 'common', price: 25,
    tint: 0xe8e8ff, use: 'combat',
    desc: 'Drink: throw away this hand and deal a fresh one. No discard spent.',
    effect: { type: 'redraw' },
  },
  {
    id: 'cleansingTea', name: 'Cleansing Tea', rarity: 'common', price: 25,
    tint: 0x88d8a0, use: 'combat',
    desc: 'Drink: purge ALL your debuffs. Bleed, poison, brittle, fear, freeze, hypnosis.',
    effect: { type: 'cleanse' },
  },
  {
    id: 'grabJuice', name: 'Grab Juice', rarity: 'common', price: 25,
    tint: 0x7fd8a0, use: 'combat',
    desc: 'Drink: draw 1 more card into this hand.',
    effect: { type: 'draw', value: 1 },
  },
  {
    /**
     * GO-GO GOO (JC's call, 2026-08-02). The ONE place the Balatro kicker rule
     * is suspended: every card in the hand contributes its value, while the
     * best hand present still sets the type and the mult. Narrow on purpose —
     * scoreHand only does this when the scene passes state.allScore, which only
     * this bottle ever sets.
     */
    id: 'goGoGoo', name: 'Go-Go Goo', rarity: 'common', price: 25,
    tint: 0x9ae04a, use: 'combat',
    desc: 'Drink: play your whole hand at once. Every card scores, kickers included, and the best hand present sets the type. Costs a hand.',
    effect: { type: 'playAll' },
  },
  {
    id: 'bandAid', name: 'Bottled Band Aid', rarity: 'common', price: 25,
    tint: 0xffd6d0, use: 'anywhere',
    desc: 'Drink: heal 5 HP. Usable anywhere.',
    effect: { type: 'heal', value: 5 },
  },
  {
    id: 'jarredCoin', name: 'Jarred Coin', rarity: 'common', price: 25,
    tint: 0xffc542, use: 'anywhere',
    desc: 'Drink: gain 5 chips. Usable anywhere.',
    effect: { type: 'chips', value: 5 },
  },

  // ---- RARE (8) — real card advantage, real removal -----------------------
  {
    id: 'focusDraught', name: 'Draught of Focus', rarity: 'rare', price: 50,
    tint: 0x58c8e8, use: 'combat',
    desc: 'Drink: draw 3 more cards into this hand.',
    effect: { type: 'draw', value: 3 },
  },
  {
    id: 'emberVial', name: 'Ember Vial', rarity: 'rare', price: 55,
    tint: 0xff6028, use: 'combat', target: 'enemy',
    desc: 'Throw: 100 damage to one enemy, scaled up in later acts.',
    effect: { type: 'damage', value: 100, actTable: [1, 3, 10, 30] },
  },
  {
    id: 'venomFlask', name: 'Venom Flask', rarity: 'rare', price: 50,
    tint: 0x60d040, use: 'combat', target: 'enemy',
    desc: 'Throw: Poison one enemy, scaled to its max HP.',
    effect: { type: 'poison', hpFrac: 0.08 },
  },
  {
    id: 'giantsBrew', name: "Giant's Brew", rarity: 'rare', price: 60,
    tint: 0xd08040, use: 'combat',
    desc: 'Drink: your next hand scores ×1.5.',
    effect: { type: 'nextHandFactor', value: 1.5 },
  },
  {
    id: 'bloodWax', name: 'Blood Wax', rarity: 'rare', price: 55,
    tint: 0x8a1830, use: 'combat',
    desc: `Pour: 2 cards in your hand take the BLOOD SEAL forever: heal ${SEAL_HEAL} HP whenever they score.`,
    // `stamp` rather than `mod`: the wax is its own LAYER and stacks on top of
    // a card's existing mod instead of replacing it (see scoring.js).
    effect: { type: 'modCards', stamp: 'blood', count: 2 },
  },
  {
    // NOT auto-drunk: it turns into a bottle you still have to decide about,
    // in the slot it was already sitting in.
    id: 'potionPotion', name: 'Potion-Flavored Potion', rarity: 'rare', price: 50,
    tint: 0xd070e8, use: 'combat',
    desc: 'Drink: this bottle becomes a different random potion in the same slot, undrunk.',
    effect: { type: 'transform' },
  },
  {
    // 10 -> 20 (THE HANDS OVERHAUL, 2026-08-06). Same dilution that hit every
    // flat VALUE relic: hands now bring their own base value to the score side,
    // so a flat bottle bought a much smaller share than it was priced for.
    id: 'liquidIce', name: 'Liquid Ice', rarity: 'rare', price: 55,
    tint: 0x9fe8ff, use: 'combat',
    desc: `Drink: your next played hand is worth +${LIQUID_ICE_VALUE} value.`,
    effect: { type: 'handValue', value: LIQUID_ICE_VALUE },
  },
  {
    id: 'potionOfPoof', name: 'Potion of Poof', rarity: 'rare', price: 60,
    tint: 0xc0b8d8, use: 'combat',
    desc: 'Drink: pick a card in your hand. It leaves your deck forever.',
    effect: { type: 'destroyCard' },
  },

  // ---- VERY RARE (7) — purple shelf: they change the shape of a hand ------
  {
    id: 'mirrorTonic', name: 'Mirror Tonic', rarity: 'veryRare', price: 95,
    tint: 0xb0c8e0, use: 'combat',
    desc: 'Drink: duplicate a card in your hand for this fight.',
    effect: { type: 'dupeHand', permanent: false },
  },
  {
    id: 'summonersInk', name: "Summoner's Ink", rarity: 'veryRare', price: 100,
    tint: 0x8060e0, use: 'combat',
    desc: 'Drink: call ANY card from your draw pile into your hand.',
    effect: { type: 'summonDraw' },
  },
  {
    id: 'bottledFrenzy', name: 'Bottled Frenzy', rarity: 'veryRare', price: 105,
    tint: 0xe84860, use: 'combat',
    desc: 'Drink: +2 hand size for the rest of this fight.',
    effect: { type: 'handSize', value: 2 },
  },
  {
    id: 'feelinLuckyBrew', name: "Feelin' Lucky Brew", rarity: 'veryRare', price: 100,
    tint: 0x2e8b57, use: 'combat',
    desc: 'Pour: 2 cards in your hand become ROULETTE, permanently. Every activation spins again for gold, red, black or green.',
    effect: { type: 'modCards', mod: 'roulette', count: 2 },
  },
  {
    id: 'phantomPhial', name: 'Phantom Phial', rarity: 'veryRare', price: 100,
    tint: 0x7fe0d0, use: 'combat',
    desc: `Pour: 2 cards in your hand turn ETHEREAL: ×${MOD_MULT_FACTOR.ethereal} mult when they score, and ${Math.round(ETHEREAL_VANISH_CHANCE * 100)}% to vanish forever every time they do.`,
    effect: { type: 'modCards', mod: 'ethereal', count: 2 },
  },
  {
    // The joke that pays: drinking it frees its own slot, and that slot is one
    // of the ones it fills. Never overwrites a potion you are still holding.
    id: 'potionWithinAPotion', name: 'Potion Within a Potion', rarity: 'veryRare', price: 95,
    tint: 0xb060e8, use: 'anywhere',
    desc: 'Drink: every EMPTY slot on your belt fills with a random potion, its own slot included. Usable anywhere.',
    effect: { type: 'refillBelt', value: MAX_POTIONS },
  },
  {
    // ECONOMY POTION. It must pay for itself and then some or nobody ever buys
    // it: 80 chips in, 200 out, +120 clear. Drinkable ON THE MERCHANT'S MAT,
    // which is the whole point — buy, drink, buy again.
    id: 'paydayBrine', name: 'Payday Brine', rarity: 'veryRare', price: 100,
    tint: 0xf0c030, use: 'anywhere',
    desc: 'Drink: +200 chips. Usable anywhere.',
    effect: { type: 'chips', value: 200 },
  },

  // ---- LEGENDARY (3) — one sip decides the fight -------------------------
  {
    id: 'chronoElixir', name: 'Chrono Elixir', rarity: 'legendary', price: 170,
    tint: 0x50e0d0, use: 'combat',
    desc: 'Drink: your next hand plays TWICE.',
    effect: { type: 'echoHand' },
  },
  {
    id: 'alchemistsSeal', name: "Alchemist's Seal", rarity: 'legendary', price: 155,
    tint: 0xf0e060, use: 'combat',
    desc: 'Drink: a card in your hand becomes WILD. Permanently.',
    effect: { type: 'makeWild' },
  },
  {
    /**
     * THE JOKE THAT COSTS 155 CHIPS. It is a LEGENDARY that does nothing, and
     * the joke only works if the game plays it completely straight: the bottle
     * empties, a beat of silence, no number pops (see CombatScene's 'nothing').
     * Drinking it is the only way to earn the `spendingHabit` achievement,
     * which is the actual payout.
     */
    id: 'potionOfNothing', name: 'Potion of Nothing', rarity: 'legendary', price: 155,
    tint: 0xdedede, use: 'combat',
    desc: 'Drink: nothing happens. On purpose.',
    effect: { type: 'nothing' },
  },

  // ---- MYTHICAL (3) — permanence and second lives. Weight 0: these only
  //      appear via the ~1% shop sneak, and they cost like it.
  {
    id: 'fairyBottle', name: 'Fairy in a Bottle', rarity: 'mythical', price: 255,
    tint: 0xffd0f0, use: 'passive',
    desc: 'Passive: the first time you would die, revive at half Max HP. The bottle is then spent.',
    effect: { type: 'revive', frac: 0.5 },
  },
  {
    id: 'philosophersDraught', name: "Philosopher's Draught", rarity: 'mythical', price: 240,
    tint: 0xe0e0e8, use: 'combat',
    desc: 'Drink: permanently duplicate a card in your hand, mods and all.',
    effect: { type: 'dupeHand', permanent: true },
  },
  {
    /**
     * BANK ERROR IN YOUR FAVOUR. Doubles the purse — but the bank only ever
     * loses so much.
     *
     * !!! INTERPRETATION FLAG (JC, 2026-08-01): the brief said "Up to 1000".
     * That is read here as a cap on the GAIN, not on the resulting total: you
     * gain min(chips, 1000). So 400 chips -> 800 (+400), and 4,000 chips ->
     * 5,000 (+1000), never 1,000. The other reading ("your total is capped at
     * 1000") would make the potion actively worthless above 500 chips, which
     * cannot be the intent for a Mythical. Say the word and it flips.
     */
    id: 'bankErrorStew', name: 'Bank Error Stew', rarity: 'mythical', price: 240,
    tint: 0x7ad8a0, use: 'anywhere',
    desc: 'Drink: your chips DOUBLE, gaining at most 1000. Usable anywhere.',
    effect: { type: 'doubleChips', cap: 1000 },
  },
];

/** BANK ERROR STEW: the chips gained by doubling `chips`, capped. */
export function bankErrorGain(chips, cap = 1000) {
  return Math.max(0, Math.min(Math.floor(chips), cap));
}

/**
 * The rung of a damage potion's `actTable` for an act index, CLAMPED at both
 * ends (ENDLESS, 2026-08-05). A bottle whose payout ladder stops at Act IV
 * keeps paying the Act IV rung forever rather than silently reverting to ×1 the
 * moment the run walks past the end of the game.
 *
 * Lives here, beside the tables it reads, so the endless test can derive the
 * expectation from the real data instead of copying [1, 3, 10, 30] into itself.
 */
export function actTableRung(actTable, actIndex = 0) {
  if (!Array.isArray(actTable) || !actTable.length) return 1;
  const i = Math.min(Math.max(Math.floor(Number(actIndex) || 0), 0), actTable.length - 1);
  return actTable[i] ?? 1;
}

export const POTION_BY_ID = Object.fromEntries(POTION_POOL.map(p => [p.id, p]));

/**
 * Weighted random potion def (uniform within rarity). Mythicals have
 * shopWeight 0, so this never returns one — see rollShopPotions' sneak.
 */
export function rollPotion(rng = Math.random, exclude = []) {
  const pool = POTION_POOL.filter(p => !exclude.includes(p.id) && POTION_RARITY[p.rarity].shopWeight > 0);
  if (!pool.length) return null;
  const total = pool.reduce((s, p) => s + POTION_RARITY[p.rarity].shopWeight, 0);
  let r = rng() * total;
  for (const p of pool) {
    r -= POTION_RARITY[p.rarity].shopWeight;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

/** A random Mythical potion (the shop sneak; also usable by future drops). */
export function rollMythicalPotion(rng = Math.random, exclude = []) {
  const pool = POTION_POOL.filter(p => p.rarity === 'mythical' && !exclude.includes(p.id));
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Roll the shop's potion row — distinct ids, weighted, no Mythicals... except
 * once in a hundred restocks, when one takes over a slot. Same idiom as
 * rollShopStock(): the mat is where a Mythical potion is *sellable*, and its
 * price already carries that (240-255 after the 2026-08-02 +25% pass).
 */
export function rollDistinctPotions(count, rng = Math.random, exclude = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = rollPotion(rng, [...exclude, ...out.map(x => x.id)]);
    if (p) out.push(p);
  }
  return out;
}

export function rollShopPotions(count = 3, rng = Math.random) {
  const out = rollDistinctPotions(count, rng);
  if (out.length && rng() < SHOP_MYTHIC_POTION_CHANCE) {
    const myth = rollMythicalPotion(rng, out.map(x => x.id));
    if (myth) out[Math.floor(rng() * out.length)] = myth;
  }
  return out;
}

/**
 * POTION WITHIN A POTION's payload: `count` distinct potions, weighted like the
 * shop and — crucially — never another Potion Within a Potion, which would turn
 * a belt into a self-refilling perpetual-motion machine.
 */
export function rollRefillPotions(count, rng = Math.random) {
  return rollDistinctPotions(count, rng, ['potionWithinAPotion']);
}

/**
 * POTION-FLAVORED POTION. Rolls what the bottle turns INTO: the ordinary
 * weighted shop roll, minus the bottle itself, so it can never hand you another
 * copy of the thing you just drank (a transform loop is not a joke, it is a
 * softlock waiting for a slow rng).
 */
export function rollTransformPotion(currentId, rng = Math.random) {
  return rollPotion(rng, currentId ? [currentId] : []);
}

/**
 * ...and the swap itself, IN PLACE. The whole point is that the new bottle
 * lands in the SAME belt slot, so this replaces the array entry rather than
 * splicing and pushing (which would quietly shuffle the belt).
 *
 * @returns {object|null} the new potion instance, or null if nothing rolled
 */
export function transformPotionAt(index, r, rng = Math.random) {
  const belt = r?.potions ?? [];
  const old = belt[index];
  if (!old) return null;
  const def = rollTransformPotion(old.id, rng);
  if (!def) return null;
  const fresh = { ...def };
  belt[index] = fresh;
  return fresh;
}

/** Venom Flask sizing: stacks whose full tick-down ≈ hpFrac of maxHp. */
export function poisonStacksFor(maxHp, hpFrac) {
  // total of s + (s-1) + ... + 1 = s(s+1)/2 ≈ hpFrac × maxHp
  return Math.max(4, Math.round(Math.sqrt(2 * hpFrac * maxHp)));
}

/** Drink sound: Very Rare and above get the fancy gulp. */
export function drinkSfxKey(def) {
  return POTION_RARITY_ORDER.indexOf(def.rarity) >= POTION_RARITY_ORDER.indexOf('veryRare')
    ? 'potion_drink_big'
    : 'potion_drink';
}

/**
 * The 'anywhere' effects that are PURE RUN STATE — no scene, no arena, no
 * cards. Combat, the map and the merchant's mat all call this instead of each
 * growing its own copy, which is what kept 'anywhere' potions from actually
 * working everywhere before now.
 *
 * IMPORTANT: the caller must remove the potion from the belt FIRST. Potion
 * Within a Potion counts its own freed slot, and that only works if the slot
 * is already free when this runs.
 *
 * @returns {string|null} a short line to pop, or null if this effect is not one
 *          of the universal ones (the caller then handles it itself).
 */
export function applyUniversalEffect(effect, run, rng = Math.random) {
  switch (effect?.type) {
    case 'heal': {
      const p = run.player;
      if (!p) return null;
      const applied = Math.max(0, Math.min(effect.value, p.maxHp - p.hp));
      p.hp += applied;
      return `+${applied} HP`;
    }
    case 'chips': {
      const paid = gainGold(effect.value, run);
      return `+${paid} chips`;
    }
    case 'doubleChips': {
      const gain = gainGold(bankErrorGain(run.chips, effect.cap ?? 1000), run);
      return gain > 0 ? `+${gain} chips` : 'the ledger balances';
    }
    case 'refillBelt': {
      const room = Math.min(MAX_POTIONS - run.potions.length, effect.value ?? MAX_POTIONS);
      if (room <= 0) return null;
      const got = rollRefillPotions(room, rng);
      for (const def of got) run.potions.push({ ...def });
      return got.length === 1 ? '+1 POTION' : `+${got.length} POTIONS`;
    }
    default: return null;
  }
}

/** Can this potion be drunk in the given context ('combat' | 'map')? */
export function potionUsableIn(def, context) {
  if (def.use === 'passive') return false;
  if (def.use === 'anywhere') return true;
  return context === 'combat';
}
