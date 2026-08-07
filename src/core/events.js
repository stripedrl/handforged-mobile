/**
 * MAP EVENTS — the '?' nodes. Pure data/logic; MapScene renders them on parchment.
 *
 * Event: { id, name, icon, tint, flavor, biome?, choices }
 * Choice: { label, hint?, resolve(run) -> outcome }
 * Outcome: { text, good?, artifact?: def, mythical?: def, pack?: kind }
 *   (artifact/mythical/pack are directives — the scene runs the ceremony/UI.)
 *
 * THE CRIMSON FORGE is the red-glow mythic node: the only map-side source of
 * Mythical relics.
 */

import { rollEliteDrop, rollMythical } from './artifacts.js';
import { gainGold } from './run.js';
import { HAND_DEFS, offerableHandTypes } from './poker.js';
import { cardLabel } from './deck.js';
import { CASINO_GAMES, MIN_WAGER, MAX_WAGER, casinoAvailable, affordableWagers } from './casino.js';
import { actSlotFor } from './acts.js';

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

/**
 * TRANSFORMATION TRANSPARENCY (JC, 2026-08-01) — the event half.
 *
 * A choice that names a card RELATIVE to your deck ("your highest", "your
 * lowest") now resolves it AT OFFER TIME through labelOf(run) / hintOf(run),
 * which MapScene.runEvent reads in place of the static label/hint. Both are
 * strictly READ-ONLY: these helpers copy before they sort, where the old
 * resolve() bodies sorted run.runDeck in place and quietly reordered the deck.
 *
 * THE GAMBLER is deliberately NOT resolved. Knowing the card before you wager
 * is the whole bet; what it shows instead is the ODDS your actual deck gives
 * you, which is the honest version of the same information.
 */
const highestCard = deck => [...(deck ?? [])].sort((a, b) => b.rank - a.rank)[0] ?? null;
const lowestCard = deck => [...(deck ?? [])].sort((a, b) => a.rank - b.rank)[0] ?? null;

export const EVENTS = [
  {
    id: 'tinker', name: 'The Wandering Tinker', icon: 'icon_setting', tint: 0xc8a860,
    flavor: 'A cart of clinking oddities blocks the path. The tinker grins: "Everything works. Mostly."',
    choices: [
      {
        label: 'Buy a mystery relic (50 chips)', hint: 'A random relic, any rarity',
        resolve(run) {
          if (run.chips < 50) return { text: 'Your pockets echo. The tinker\'s grin fades. (Not enough chips.)' };
          run.chips -= 50;
          const def = rollEliteDrop(run.artifacts.map(a => a.id), 0, Math.random, run.chrId);
          // The line promised a refund and never paid one. It pays now, at face
          // value: gainGold would apply earn multipliers to money you already had.
          if (!def) { run.chips += 50; return { text: 'He rummages, and finds nothing you don\'t own. He refunds the 50, embarrassed.' }; }
          // `refund` is what the 50 costs if you look at the thing and say no.
          // The relic ceremony grew a LEAVE IT door and this line did not know
          // about it, so declining paid the tinker and carried nothing away.
          return { text: 'He presses it into your hands, still warm from the cart.', artifact: def, refund: 50, good: true };
        },
      },
      {
        label: 'Trade stories', hint: 'Free. He likes company.',
        resolve() { return { text: 'He tells you of a red-glowing forge deep in the world. You feel wiser, not richer.' }; },
      },
      { label: 'Walk on by', resolve() { return { text: 'The clinking follows you for a while, then gives up.' }; } },
    ],
  },
  {
    id: 'cursedWell', name: 'The Cursed Well', icon: 'icon_drop', tint: 0x58c0a8,
    flavor: 'Black water, perfectly still. Something at the bottom glitters.',
    choices: [
      {
        label: 'Drink deep', hint: '50%: heal to full · 50%: 4 Poison next fight',
        resolve(run) {
          if (Math.random() < 0.5) {
            run.player.hp = run.player.maxHp;
            return { text: 'Cold, clean, impossibly sweet. You are WHOLE again.', good: true };
          }
          run.pending.poisonSelf += 4;
          return { text: 'It tastes like old coins. 4 Poison next fight.' };
        },
      },
      {
        label: 'Fish out the glitter', hint: 'Take 6 damage, gain 45 chips',
        resolve(run) {
          run.player.hp = Math.max(1, run.player.hp - 6);
          gainGold(45, run);
          return { text: 'Something bites your arm, but your fist comes up full of chips. −6 HP, +45 chips.', good: true };
        },
      },
      { label: 'Leave it be', resolve() { return { text: 'The water never moves. You do.' }; } },
    ],
  },
  {
    id: 'cache', name: 'Abandoned Cache', icon: 'icon_coins', tint: 0xb87333,
    flavor: 'A half-buried strongbox, lock already broken. Someone left in a hurry.',
    choices: [
      {
        label: 'Take what you see', hint: '+35 chips, guaranteed',
        resolve(run) { gainGold(35, run); return { text: 'Easy money. +35 chips.', good: true }; },
      },
      {
        label: 'Dig deeper', hint: '50%: +100 chips · 50%: a trap, 8 damage',
        resolve(run) {
          if (Math.random() < 0.5) { gainGold(100, run); return { text: 'A false bottom. +100 chips.', good: true }; }
          run.player.hp = Math.max(1, run.player.hp - 8);
          return { text: 'SNAP. A rusted jaw-trap. −8 HP and your pride.' };
        },
      },
      { label: 'Leave it buried', resolve() { return { text: 'Someone left in a hurry. You decide not to find out why.' }; } },
    ],
  },
  {
    id: 'gambler', name: 'The Gambler', icon: 'icon_dice', tint: 0xd04870,
    flavor: '"One flip," says the man in the immaculate coat. "Your deck, your odds."',
    choices: [
      {
        label: 'Wager 40 chips', hint: 'Draw a card from YOUR deck: 8+ doubles it, else it\'s gone',
        // NOT pre-resolved — see the note at the top of this file. What it CAN
        // honestly tell you is what your own deck says your chances are.
        hintOf(run) {
          const deck = run.runDeck ?? [];
          const good = deck.filter(c => c.rank >= 8).length;
          const pct = deck.length ? Math.round((good / deck.length) * 100) : 0;
          return `Draw one card from YOUR deck: 8+ doubles it, else it's gone\n${good} of your ${deck.length} cards win, ${pct}%`;
        },
        resolve(run) {
          if (run.chips < 40) return { text: '"Come back when you can afford to lose." (Not enough chips.)' };
          run.chips -= 40;
          const card = rand(run.runDeck);
          if (card.rank >= 8) { gainGold(80, run); return { text: `He flips your ${cardLabel(card)}. "House loses." +80 chips.`, good: true }; }
          return { text: `A miserable little ${cardLabel(card)}. He pockets your wager without smiling.` };
        },
      },
      { label: 'Walk away', resolve() { return { text: 'He nods, almost approving.' }; } },
    ],
  },
  {
    id: 'shrine', name: 'The Old Shrine', icon: 'icon_magic', tint: 0x8878c8,
    flavor: 'Moss-eaten stone, older than any act of this world. It hums when you kneel.',
    choices: [
      {
        label: 'Offer blood (8 HP)', hint: 'Two random cards become ENHANCED (+10 value)',
        resolve(run) {
          run.player.hp = Math.max(1, run.player.hp - 8);
          const pool = run.runDeck.filter(c => !c.mod);
          for (let i = 0; i < 2 && pool.length; i++) {
            pool.splice(Math.floor(Math.random() * pool.length), 1)[0].mod = 'enhanced';
          }
          return { text: 'The stone drinks. Two of your cards shine PURPLE.', good: true };
        },
      },
      {
        label: 'Pray quietly', hint: 'Heal 15 HP',
        resolve(run) {
          run.player.hp = Math.min(run.player.maxHp, run.player.hp + 15);
          return { text: 'Warmth spreads through your hands. +15 HP.', good: true };
        },
      },
      { label: 'Do not kneel', resolve() { return { text: 'The humming stops the moment you turn your back.' }; } },
    ],
  },
  {
    id: 'sharper', name: 'The Card Sharper', icon: 'icon_star', tint: 0xc8c8d8,
    flavor: 'Quick fingers, quicker eyes. "That top card of yours. Name a price."',
    choices: [
      {
        label: 'Sell your highest card (+90 chips)',
        // He is not buying "a card", he is buying THAT card — so the offer says
        // which one before you shake on it.
        labelOf(run) { return `Sell your ${cardLabel(highestCard(run.runDeck))} (+90 chips)`; },
        hintOf() { return 'your highest card, gone for good'; },
        resolve(run) {
          const top = highestCard(run.runDeck);
          run.runDeck.splice(run.runDeck.indexOf(top), 1);
          gainGold(90, run);
          return { text: `Your ${cardLabel(top)} vanishes into his sleeve. +90 chips.`, good: true };
        },
      },
      { label: 'Refuse', resolve() { return { text: '"Wise. Or sentimental." He shuffles away.' }; } },
    ],
  },
  {
    id: 'travelingSmith', name: 'The Traveling Smith', icon: 'icon_anvil', tint: 0xd07028,
    flavor: 'A portable anvil rings in the wilderness. "Free sample. First one\'s always free."',
    choices: [
      {
        label: 'Hold out a hand', hint: 'A random hand type gains a level, free',
        resolve(run) {
          // Never a SECRET hand you have not made THIS RUN (2026-08-06, was the
          // lifetime ledger). Two reasons, and the second is the bigger one:
          // his free sample prints the hand's NAME, which would spoil a
          // discovery — and a free level in a hand this deck cannot make is a
          // free level in nothing at all.
          const t = rand(offerableHandTypes(run));
          run.handLevels[t] = (run.handLevels[t] ?? 0) + 1;
          // Levels read 1-BASED everywhere else (handLevels 0 = "Lv.1"), so the
          // hammer used to announce a level one lower than the hands chart shows.
          return { text: `${HAND_DEFS[t].name} rings out at Lv.${run.handLevels[t] + 1}.`, good: true };
        },
      },
    ],
  },
  {
    id: 'chest', name: 'A Mysterious Chest', icon: 'icon_key', tint: 0xb8862c,
    flavor: 'Unlocked. Unattended. Unreasonably inviting.',
    choices: [
      {
        label: 'Open it', hint: '55%: a relic · 30%: 55 chips · 15%: a trap, 7 damage',
        resolve(run) {
          const roll = Math.random();
          if (roll < 0.55) {
            const def = rollEliteDrop(run.artifacts.map(a => a.id), 0, Math.random, run.chrId);
            if (def) return { text: 'Inside, wrapped in oilcloth...', artifact: def, good: true };
            gainGold(70, run);
            return { text: 'Just chips, a lot of them. +70.', good: true };
          }
          if (roll < 0.85) { gainGold(55, run); return { text: 'A tidy stack of chips. +55.', good: true }; }
          run.player.hp = Math.max(1, run.player.hp - 7);
          return { text: 'A needle in the latch. Of course. −7 HP.' };
        },
      },
      { label: 'Too obvious. Leave.', resolve() { return { text: 'You swear you hear it sigh as you go.' }; } },
    ],
  },
  {
    id: 'witchHut', name: "The Witch's Hut", icon: 'icon_magic', tint: 0x8a5cd0,
    flavor: 'Chicken legs. The hut has chicken legs. The door is already open.',
    choices: [
      {
        label: 'Step inside', hint: 'Open a free WITCH pack',
        resolve() { return { text: 'She never looks up from her cauldron: "Take one. Only one."', pack: 'witch', good: true }; },
      },
      { label: 'Absolutely not', resolve() { return { text: 'The hut shrugs and walks off.' }; } },
    ],
  },
  {
    id: 'tollBridge', name: 'The Toll Bridge', icon: 'icon_shield', tint: 0x8898b8,
    flavor: 'A troll the size of a shed holds out a hand the size of a door.',
    choices: [
      {
        label: 'Pay 25 chips', hint: 'If you cannot pay, it costs 6 HP instead',
        resolve(run) {
          if (run.chips < 25) { run.player.hp = Math.max(1, run.player.hp - 6); return { text: 'You can\'t pay. The handshake costs 6 HP instead.' }; }
          run.chips -= 25; return { text: 'It counts every chip. Twice. You pass.' };
        },
      },
      {
        label: 'Shove past', hint: 'Take 6 damage',
        resolve(run) { run.player.hp = Math.max(1, run.player.hp - 6); return { text: 'Worth it, you tell yourself, rubbing your shoulder. −6 HP.' }; },
      },
    ],
  },
  /**
   * THE TRAVELING CASINO (PATCH ORACLE, workstream 2).
   *
   * The only event with an `available` gate, and it needs two: the once-per-act
   * cap (mystery nodes recur several times an act, and an uncapped table is a
   * chip farm) and a purse that can cover the minimum. Both live in
   * core/casino.js; rollEvent simply asks.
   *
   * Every game choice resolves to a DIRECTIVE, `{ casino: id }`, exactly like
   * the Witch's Hut resolves to `{ pack: 'witch' }`. MapScene reads it and hands
   * off to the casino overlay, which owns the wager screen and the money. The
   * act's game is spent when a wager is actually placed, so backing out of the
   * wager screen (and walking away from the wagon entirely) costs nothing.
   */
  {
    id: 'travelingCasino', name: 'THE TRAVELING CASINO', icon: 'icon_dice', tint: 0xd8b830,
    available: (run) => casinoAvailable(run),
    flavor: 'A painted wagon, folded open into a floor. Three tables, a wheel still turning, and a crate of ducks complaining about the wait.\n"One game a town," says the woman with the rake. "House rules."',
    choices: [
      ...CASINO_GAMES.map(g => ({
        label: g.name,
        hint: g.payoff,
        // The hint prints the stakes you can actually make, not the ones on the
        // painted sign: a purse holding 120 is told it may bet 50 or 100.
        hintOf(run) {
          const can = affordableWagers(run.chips);
          const top = can.length ? can[can.length - 1] : 0;
          const stakes = top >= MAX_WAGER
            ? `Wager ${MIN_WAGER} to ${MAX_WAGER}`
            : `Wager ${MIN_WAGER} to ${top}, on what you are holding`;
          return `${g.payoff}\n${stakes}`;
        },
        // `text` is the dealer's greeting, printed by the betting slip. It is
        // also what keeps this outcome honest for the pool-wide invariant that
        // EVERY event choice hands back a sentence: a surface that does not
        // know what `casino` means still has something to say.
        resolve() { return { casino: g.id, text: g.greeting }; },
      })),
      {
        label: 'Keep your chips in your pocket',
        resolve() { return { text: 'You walk past the wheel without slowing down. The woman with the rake respects it, briefly.' }; },
      },
    ],
  },
  // --- biome-flavored ---
  {
    id: 'bloodAltar', name: 'The Blood Altar', icon: 'icon_drop', tint: 0xd82838, biome: 0,
    flavor: 'The forest goes silent around a rust-stained stone. The trees are watching.',
    choices: [
      {
        label: 'Bleed for power (10 HP)', hint: 'A rare-or-better artifact',
        resolve(run) {
          run.player.hp = Math.max(1, run.player.hp - 10);
          const def = rollEliteDrop(run.artifacts.map(a => a.id), 1, Math.random, run.chrId);
          if (!def) { gainGold(90, run); return { text: 'The altar takes your blood and pays in chips. +90.', good: true }; }
          return { text: 'The stone drinks, and something surfaces...', artifact: def, good: true };
        },
      },
      { label: 'Back away slowly', resolve() { return { text: 'The birdsong returns one tree at a time.' }; } },
    ],
  },
  {
    id: 'frozenTraveler', name: 'The Frozen Traveler', icon: 'icon_snow', tint: 0x9adcff, biome: 1,
    flavor: 'A figure in the ice, hand outstretched. Still breathing. Barely.',
    choices: [
      {
        label: 'Thaw him out (15 chips)', hint: '+70 chips and heal 10 HP',
        resolve(run) {
          if (run.chips < 15) return { text: 'You have nothing to burn. His eyes follow you as you leave.' };
          run.chips -= 15;
          gainGold(70, run);
          run.player.hp = Math.min(run.player.maxHp, run.player.hp + 10);
          return { text: 'He presses his purse into your hands: +70 chips, and his soup heals 10 HP.', good: true };
        },
      },
      { label: 'The ice keeps what it takes', resolve() { return { text: 'You don\'t look back. The wind does it for you.' }; } },
    ],
  },
  {
    id: 'echoCavern', name: 'The Echoing Cavern', icon: 'icon_volume', tint: 0x7a58c8, biome: 2,
    flavor: 'Your heartbeat comes back to you doubled. The dark is acoustically perfect.',
    choices: [
      {
        label: 'SHOUT', hint: 'A random card is duplicated',
        resolve(run) {
          const c = rand(run.runDeck);
          run.runDeck.push({ ...c, id: `${c.id}#echo${run.runDeck.length}` });
          // It used to print the raw fields ("another swords 14"); cardLabel is
          // the spelling every other surface uses.
          return { text: `The cavern answers: another ${cardLabel(c)} lands in your deck.`, good: true };
        },
      },
      {
        label: 'Whisper', hint: 'Your lowest card fades away',
        hintOf(run) { return `Your ${cardLabel(lowestCard(run.runDeck))} fades away`; },
        resolve(run) {
          // Takes the named card out by identity — the old body sorted the
          // master deck in place and shifted the front off it.
          const gone = lowestCard(run.runDeck);
          const i = run.runDeck.indexOf(gone);
          if (i >= 0) run.runDeck.splice(i, 1);
          return { text: `The dark swallows your ${cardLabel(gone)}. The deck feels lighter.`, good: true };
        },
      },
      { label: 'Say nothing at all', resolve() { return { text: 'The cavern waits. You give it nothing to keep.' }; } },
    ],
  },
];

/** The red node. Mythicals live here. */
export const CRIMSON_FORGE = {
  id: 'crimsonForge', name: 'THE CRIMSON FORGE', icon: 'icon_fire', tint: 0xe03040, mythic: true,
  flavor: 'The tinker\'s story was true. A forge older than the acts, burning without fuel, the exact red of the mark on your map.',
  choices: [
    {
      label: 'Reach into the fire', hint: '60%: a MYTHICAL relic or a RE-FORGE · 40%: burned (−15 HP, +100 chips)',
      resolve(run) {
        if (Math.random() < 0.6) {
          if (run.artifacts.length > 0 && Math.random() < 0.2) {
            return { text: 'The fire shows you a relic you already carry, and offers to strike it TWICE.', reforge: true, good: true };
          }
          const def = rollMythical(run.artifacts.map(a => a.id), Math.random, run.chrId);
          if (def) return { text: 'Your hand closes around something impossible...', mythical: def, good: true };
          gainGold(250, run);
          return { text: 'The forge finds nothing left to give you. It pays tribute instead. +250 chips.', good: true };
        }
        run.player.hp = Math.max(1, run.player.hp - 15);
        gainGold(100, run);
        return { text: 'The fire snaps at you like a living thing. −15 HP... but slag gold sticks to your glove. +100 chips.' };
      },
    },
    {
      label: 'Feed it 200 chips and 10 HP', hint: '80%: a MYTHICAL relic · 20%: RE-FORGE a relic you own',
      resolve(run) {
        if (run.chips < 200) return { text: 'The forge dims, unimpressed by your purse. (Need 200 chips.)' };
        run.chips -= 200;
        run.player.hp = Math.max(1, run.player.hp - 10);
        if (run.artifacts.length > 0 && Math.random() < 0.2) {
          return { text: 'The forge accepts, then turns its hammer on YOUR belt. Choose a relic to strike anew.', reforge: true, good: true };
        }
        const def = rollMythical(run.artifacts.map(a => a.id), Math.random, run.chrId);
        if (def) return { text: 'The forge accepts. The fire turns WHITE...', mythical: def, good: true };
        gainGold(300, run);
        return { text: 'Every myth is already yours. The forge returns your offering with interest. +300 chips.', good: true };
      },
    },
    { label: 'Some fires are better left burning', resolve() { return { text: 'The glow follows you to the edge of sight.' }; } },
  ],
};

/**
 * May this event be offered on THIS run, right now? Biome, plus the optional
 * `available(run)` gate an event may carry (the Traveling Casino is the only
 * one today: once per act, and only to a purse that can cover the table).
 *
 * Exported because the RESHUFFLE below has to ask the same question a second
 * time, and because a test should be able to prove the gate without farming
 * boards until it fires.
 */
export function eventOffered(ev, run) {
  // BIOME IS CONTENT, so it resolves through the CYCLE and not through the raw
  // index (ENDLESS, 2026-08-05). An Abyss-only event is offered in endless act
  // 6 for the same reason its enemies are: that act IS the Abyss again.
  if (ev.biome !== undefined && ev.biome !== actSlotFor(run.actIndex)) return false;
  return ev.available ? !!ev.available(run) : true;
}

/** Pick an event for a node — mythic nodes always get the Forge. */
export function rollEvent(run, node) {
  if (node.mythic) return CRIMSON_FORGE;
  // DEV/VERIFICATION ONLY: a node may NAME the event it wants. Nothing in the
  // game ever sets this; it exists so a verification run can photograph one
  // specific room instead of farming boards until it turns up.
  if (node.eventId) {
    const forced = EVENTS.find(e => e.id === node.eventId);
    if (forced) return forced;
  }
  run.seenEvents ??= [];
  let pool = EVENTS.filter(e => eventOffered(e, run) && !run.seenEvents.includes(e.id));
  // Everything seen: forget the history and deal again. The `available` gate is
  // re-applied here rather than only above, or clearing the log would hand back
  // a casino this act has already played.
  if (!pool.length) { run.seenEvents = []; pool = EVENTS.filter(e => eventOffered(e, run)); }
  const ev = rand(pool);
  run.seenEvents.push(ev.id);
  return ev;
}
