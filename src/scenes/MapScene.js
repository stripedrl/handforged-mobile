/**
 * THE MAP — a Slay-the-Spire-style act chart on living parchment.
 *
 * Scrollable (wheel / drag), branching paths drawn as dotted ink trails,
 * the act boss brooding at the summit (hover it for its signature mechanic).
 * Fights/elites hand off to CombatScene; events, rest sites and shops run as
 * overlays right here. All persistent state lives in core/run.js.
 */

import {
  GAME_W, GAME_H, DEPTH, PARCH, COLORS, CHARACTERS, SUIT_COLORS, PARTICLE_VARIANTS, applyMobileCamera, MOBILE,
  // THE TWO SWITCHES (config.js v3). MOBILE is the finger — every `MOBILE ?` in
  // this file is a thumb-size bump and stays one. TOUCH is the same boolean read
  // by its true name where the TWO-TAP MODEL is what is being asked about; WIDE
  // is the 2340 canvas, which a tablet does NOT get even though it is all
  // finger. SAFE / clearsCorners are the rounded-glass frame.
  TOUCH, WIDE, SAFE, clearsCorners,
} from '../config.js';
import { woodPanel } from '../ui/panels.js';
// THE SHARED DESCRIPTION BOX — the one idiom behind every icon on this screen
// whose information is hidden. See ui/choicebox.js for why hold-to-hover died.
import { twoTap, openChoiceBox } from '../ui/choicebox.js';
import {
  run, chr, advanceAct, newActMap, effectiveArtifacts, removalPrice, boosterPrice, mirrorBlockedBy,
  sellValue, sellArtifact, beltArtifacts, nookArtifacts, slotsUsed, gainGold, enterMapNode,
  // THE MERCHANT'S TILL: every price on his table, through one function, so the
  // Oracle's NEGOTIATOR and COLLECTOR are two numbers instead of five edits.
  shopPrice,
  // ALTERNATE ACTS: which WORLD this run drew for an act index. Rolled once,
  // at run start, and read here rather than indexing ACTS.
  actOf, setActPick,
} from '../core/run.js';
import { autosave } from '../core/save.js';
import { reachable, eliteNodes, FORGED_HP_MULT, FORGED_DMG_MULT } from '../core/map.js';
import {
  actVariants, bossEntry, bossRoster,
  // ENDLESS: the per-loop hue, and the lap number the act plate prints.
  endlessTint, endlessLoop, isEndlessIndex,
} from '../core/acts.js';
import { difficultyOf } from '../core/difficulty.js';
import { rollEvent } from '../core/events.js';
import { ARTIFACT_RARITY, rollShopStock, ARTIFACT_POOL, acquireArtifact } from '../core/artifacts.js';
import { PACK_TYPES, openPack, BOUNTY_REWARDS, rollBountyRewards, rollPackOffer } from '../core/packs.js';
import {
  artifactCeremony, artifactPickerOverlay, packOfferOverlay, packOpenOverlay, deckPickerOverlay, handChartOverlay, deckInfoOverlay,
  addArtifactIcon, personalize, contactPool, dropShadow, viewDeckButton, bountyPackOverlay, noMirrorBadge,
  fitWidth, artifactTipBody, eliteChoiceOverlay, oraclePackOverlay,
} from '../ui/rewards.js';
import { ORACLE_OPTIONS, ORACLE_BY_ID, rollOracleOffer, takeOracle } from '../core/oracle.js';
// THE ORACLE'S RECEIPT, pinned under the hero's face (JC, 2026-08-05).
import { addOracleChip, oracleCardKey } from '../ui/oracleChip.js';
// ...and the hero's PASSIVE, stacked above it — the same chip the combat
// sidebar wears, on the other screen that owns a hero (JC, 2026-08-06).
import { addPassiveChip } from '../ui/passiveChip.js';
import { casinoOverlay } from '../ui/casino.js';
import { rollEliteSpoils, rollElitePotion, FORGED_FLOOR_LABEL } from '../core/elites.js';
import { playMusic, musicDebug } from '../core/music.js';
import { sfx, sfxCapped, suspense } from '../core/sfx.js';
import { MAX_POTIONS, POTION_RARITY, POTION_BY_ID, rollShopPotions, potionUsableIn, drinkSfxKey, applyUniversalEffect, potionSellValue } from '../core/potions.js';
import { addPotionIcon, POTION_MAT, potionSpots, makePotionIconInteractive, MAT_SHADOW } from '../ui/potionIcon.js';
import { fireAchievements } from '../ui/achievements.js';
import { popMessage, rainbowText, legible, INK_DARK } from '../ui/juice.js';
import { addSettingsButton } from '../ui/settingsMenu.js';
import { settings } from '../core/settings.js';
import { getProp } from '../core/artifacts.js';
import { stageForMap, fetchStage } from '../core/stages.js';
import { kineticScroll } from '../ui/kinetic.js';
import { installLongPress, tapBind } from '../ui/touch.js';
import { installPointerPolicy } from '../ui/pointer.js';
import { installCardInspect } from '../ui/inspect.js';
import { CardSprite } from '../ui/CardSprite.js';
// The node art tables, and the read-only chart that shares them. See mapPeek.js
// for why they live over there.
import { NODE_STYLE, FORGED_STYLE } from '../ui/mapPeek.js';
// DEFERRED ART (core/lazyload.js). The board, the banner and the backdrop this
// scene is made of are the biggest single bundle in the game and they belong to
// ONE world, so they are fetched on arrival instead of at boot.
import {
  ensure, missingKeys, evict, actBundle, actFootprint, worldKeysExcept, mapPrefetch,
  eventBg, packCards, MERCHANT_BG, boardKeyFor, BANNER_BY_AMBIENCE, heroCardfaces,
} from '../core/lazyload.js';
import { gateOn } from '../ui/loadingVeil.js';

const ROW_GAP = 150;

/**
 * THE PHONE'S TOP CORNERS ARE NOT SQUARE (JC, 2026-08-06: "map HUD pinched
 * inward for dynamic-island clearance while staying corner-bound").
 *
 * In landscape an iPhone puts the Dynamic Island / notch on one short edge and
 * rounds BOTH top corners, and the map is the one screen whose HUD is built out
 * of those corners: the hero capsule hard against the left edge, the artifact
 * belt hard against the right, the gear in the very corner. So every one of
 * them moves inward by one inset — they stay corner-bound, they just stop being
 * flush. Zero on desktop, where the canvas is a rectangle.
 *
 * 92px is the inset, and it is not a guess: 59pt of landscape safe-area on a
 * notched iPhone, times the 2340/852 the canvas is scaled at, is 162 device px
 * — but that is the inset for a Dynamic Island sitting ON that edge, and only
 * one edge ever has it. 92 clears the ROUNDED CORNER on both sides (radius
 * ~150px, so the curve has eaten the frame by about 5px at x=112) with room for
 * the island's fringe, without carving 324px out of a 2340 HUD.
 *
 * COMBAT DOES NOT GET THIS. Its top-right corner is the potion mat, already
 * 200px in from the edge, and pushing it further would put it on the boss
 * marquee.
 *
 * 2026-08-10: the 92 above was this scene's private guess at the number, and the
 * number is now SHARED — config.js SAFE.x is 96, measured the same way, and the
 * settings cog and the DISCARD/SORT plates in combat are pinched by the same
 * constant. Rebasing on it moves this HUD 4px. SAFE.y (24) is the VERTICAL half
 * the old constant never had: a landscape phone rounds its corners on BOTH axes,
 * so a plate 42px from the top edge and 96 from the side is still inside the arc.
 */
const HUD_SAFE = SAFE.x;
/** Left-column x, pinched. Every plate and glyph in the capsule reads through it. */
const LX = (x) => x + HUD_SAFE;

/**
 * TAP, NOT CLICK (JC, 2026-08-10). Every player-facing verb on this screen forks
 * through here rather than through a `MOBILE ?` at the call site, so the desktop
 * string is provably the byte it always was and a straggler is a grep away.
 */
const say = (mouse, touch) => (TOUCH ? touch : mouse);

/**
 * THE MAP'S TYPE + PLATE SCALE, in ONE table (JC, 2026-08-10: "scale up text and
 * icons wherever real estate allows" — and, explicitly, in a table rather than
 * as thirty magic numbers, the way CombatScene's ENEMY_HUD and BOSS_BAR already
 * work).
 *
 * The desktop column is the shipped number, to the pixel, in every row. The
 * touch column is ~15-25% up, which is what a 2340-wide canvas held at arm's
 * length actually needs, with the hit targets that carry them grown to a thumb.
 * Anything NOT in here is either already thumb-sized (the service plates, the
 * event choices, RESTOCK) or is a heading nobody has trouble reading.
 */
const MAP_TYPE = {
  // ---- the left capsule ----
  heroName: TOUCH ? 30 : 25,
  heroHp: TOUCH ? 28 : 24,
  heroChips: TOUCH ? 27 : 24,
  heroDeck: TOUCH ? 23 : 20,
  heroMode: TOUCH ? 21 : 18,
  // ---- the right column + the mat ----
  beltOrdinal: TOUCH ? 17 : 13,
  gloveLabel: TOUCH ? 16 : 13,
  potionsLabel: TOUCH ? 22 : 15,
  potionIcon: TOUCH ? 72 : 52,
  // ---- the two viewer plates under the capsule ----
  viewerFont: TOUCH ? 23 : 20,
  viewerH: TOUCH ? 60 : 54,
  deckW: TOUCH ? 196 : 180,
  handsW: TOUCH ? 134 : 120,
  handsX: TOUCH ? 288 : 268,
  // ---- the board's own furniture ----
  scrollHint: TOUCH ? 23 : 19,
  devHint: TOUCH ? 17 : 15,
  // ---- the merchant's tent ----
  shopPrice: TOUCH ? 36 : 30,
  shopName: TOUCH ? 25 : 21,
  shopRarity: TOUCH ? 18 : 15,
  shopMatLabel: TOUCH ? 20 : 17,
  // The SELL tab was 14px ink on a 20px plate — unreadable AND untappable. On
  // touch it stops being a button at all (the potion's box carries SELL) and
  // becomes a legible PRICE LABEL; desktop keeps the tab it always had.
  sellTab: TOUCH ? 18 : 14,
  sellTabH: TOUCH ? 30 : 20,
  sellTabPad: TOUCH ? 26 : 14,
};

/**
 * ONE LINE ABOUT EACH ROOM, for the two-tap box. The hover tip could get away
 * with a bare noun ("Fight") because a mouse is already resting on the icon and
 * a click is cheap; a box that exists specifically so nothing commits on first
 * touch has to answer "what am I walking into" before it offers TRAVEL.
 */
const NODE_DESC = {
  fight: 'A monster on the road. Beat it and the spoils are yours.',
  elite: 'A harder fight than the road asks for. Its spoils always hold a relic.',
  event: 'Something is waiting up here. It could go either way.',
  rest: 'A fire to sleep by, a whetstone for one card, or a card to burn.',
  shop: 'The merchant\'s tent: relics on the mat, bottles under them, a booster to buy.',
};
const MYTHIC_DESC = 'Whatever is up here is worse than the road deserves, and pays like it.';

/**
 * THE LEFT CAPSULE — hero, HP, chips, deck, mode, and the chip column under
 * the portrait. Written down as one table on 2026-08-06, when it grew.
 *
 * The passive chip joined THE ORACLE's receipt in the portrait's lane and the
 * lane needed 56px it did not have. Shrinking the portrait to make room would
 * have cost the capsule the one thing it is for, so the capsule grew DOWNWARD
 * instead — the hero block above is untouched to the pixel — and the two
 * viewer buttons that sit under it follow its floor rather than a constant,
 * which is the collision this const exists to make impossible.
 */
const CAPSULE = { x: LX(170), y: 146, w: 300, h: 252 };
CAPSULE.floor = CAPSULE.y + CAPSULE.h / 2;      // 272
/**
 * THE MERCHANT'S RESTOCK LADDER (JC, 2026-07-31): starts at an impulse-buy 25
 * and compounds ~x1.5 a pull, rounded to numbers a merchant would say out loud.
 * Past the printed rungs it keeps compounding (see restockPrice), and the count
 * resets on every shop VISIT — this is a per-visit dig, not a per-run tax.
 * (+25% across the ladder, 2026-08-02 price pass. Same shape, dearer dig.)
 */
export const RESTOCK_LADDER = [25, 40, 55, 90, 130, 200, 300, 450, 675];
/**
 * How many ARTIFACTS rest on the merchant's mat. 4 -> 2 in the 2026-08-02 nerf
 * pass; the Collector's Kerchief adds its `extraStock` on top. Exported so a
 * test reads the number rather than typing it a second time.
 */
export const SHOP_RELIC_STOCK = 2;
/**
 * THE BOARD FILLS THE SCREEN WIDTH — and on the phone the screen is 2340 wide,
 * so it is the WIDE cut of the art that fills it (see boardKeyFor). W_USE is
 * NOT touched by that: Caleb's wide boards keep the node band where it was and
 * spend the extra 420px on decorative wings, so the layout math is untouched
 * and the wings are where the pinched-in HUD (see HUD_SAFE) now sits.
 */
// WIDE, not MOBILE: Caleb's wide cuts are 2340-wide paintings and exist for the
// 2340 canvas alone. A TABLET is every bit as much finger as a phone but takes
// the 1920 canvas, and stretching a wide board across it would letterbox the
// node band off its own frame. (One of the two lines in the tree that genuinely
// meant "the wide canvas"; the other is core/lazyload.js's boardKeyFor.)
const BOARD_W = WIDE ? GAME_W : 1920;
const W_USE = 1500;        // band the nodes actually occupy (clear of frame art)

/**
 * HOW HARD THE INK HAS TO PUSH ON THIS WORLD'S BOARD (JC, 2026-08-06: the
 * legibility pass, "special attention to the two darkest — the gold rings must
 * still pop").
 *
 * Six painted boards is six different grounds under the same four marks: a
 * dotted ink trail, a gold reachable ring, its additive under-glow, and a node
 * icon. Tuned once against the Verdant Forest's cream parchment, those marks
 * are exactly right on four of them and quietly disappear on two:
 *
 *   NOCTURNAL FOREST  a purple-on-purple canopy at ~99 mean luminance. The
 *                     trail's 0x9a835e dots read as texture in the moss and the
 *                     gold ring goes mustard against the mushrooms.
 *   THE ABYSS         pale dirt inside near-black cliffs at ~131. The rings are
 *                     fine; the trail is what vanishes into the floor.
 *
 * So the two of them get a MULTIPLIER on the ink rather than a redesign — the
 * marks are the same marks, pushed. `dot` is the untaken trail's tint, which is
 * the one place a straight alpha bump is not enough (0x9a835e is a brown that
 * is simply too close to both grounds to separate at any opacity).
 *
 * A world with no entry gets the shipped numbers unchanged, which is the other
 * four and every desktop board.
 */
const BOARD_INK = {
  nightwood: { trail: 1.5, ring: 1.6, dot: 0xd8c49a },
  abyss: { trail: 1.45, ring: 1.25, dot: 0xc7a982 },
};
const INK_DEFAULT = { trail: 1, ring: 1, dot: null };

// THE NODE STYLE TABLES MOVED (2026-08-10) to ui/mapPeek.js, which draws the
// same board READ-ONLY from inside a fight. They live there and not here
// because MapScene already imports ui/rewards.js and rewards.js now wants the
// MAP button, so a ui -> scene edge would close that cycle.
const forgedPct = (m) => `${Math.round((m - 1) * 100)}%`;
/** Named the danger first, then the payoff. Both are the reason it exists. */
const FORGED_BLURB =
  `Hardened in the fire: +${forgedPct(FORGED_HP_MULT)} health, +${forgedPct(FORGED_DMG_MULT)} damage.\n`
  + `Its spoils are ${FORGED_FLOOR_LABEL} or better, and every one of them is a relic.`;

export class MapScene extends Phaser.Scene {
  constructor() { super('Map'); }

  get act() { return actOf(run.actIndex); }

  /**
   * THE ONE RECOLOUR the borrowed board and the borrowed banner both take, or
   * null when the world is shown as painted.
   *
   *   ENDLESS  the lap's own hue, and it takes precedence over everything.
   *   secret   the Crucible's scorch (`secretTint`, the Ashen Crucible's cold one).
   */
  worldTint() {
    const loop = endlessTint(run.actIndex);
    if (loop != null) return loop;
    return this.act.secret ? (this.act.secretTint ?? 0xd08070) : null;
  }

  /** Which of this act's bosses THIS run drew (rolled once, in newActMap). */
  get boss() { return bossEntry(this.act, run.map?.bossPick); }

  /**
   * THE ACT'S ART, BEFORE THE BOARD IS PAINTED.
   *
   * Everything below this line used to be create(). It is gated now because the
   * world's backdrop (18.5 MB), its map board (15.4 MB) and its banner are no
   * longer in the boot set — a run walks ONE world at a time, and the five it is
   * not walking were 80% of what killed the tab on iOS.
   *
   * THE GATE IS HERE AND NOT AT THE CALL SITES, deliberately. Every ordinary
   * road into this scene has a transition to hide the fetch behind (the
   * Select→Map fade, DESCEND, a fight coming home) and every one of them
   * prefetches — but the roads that do NOT are the ones that keep the ~78
   * drivers in tools/ alive: `__hf.skipAct()`, `__hf.setBiome()`,
   * `__hf.newAct()`, a straight `scene.start('Map')` out of a CONTINUE. A gate
   * on create() covers all of them at once and cannot be forgotten by the next
   * hook. It resolves SYNCHRONOUSLY when the bundle is already resident, which
   * every restart after the first one is.
   */
  create() {
    const need = [
      ...actBundle(run.actIndex, run),
      // THE ORACLE'S RECEIPT — one of her twenty painted cards, worn under the
      // hero's face for the whole run. A CONTINUE has never fetched it.
      oracleCardKey(run.oracle),
    ].filter(Boolean);
    gateOn(this, need, () => this.buildScene(), {
      label: `Act ${this.act?.numeral ?? ''} · ${this.act?.name ?? ''}`.trim(),
      ensure, missingKeys,
    });
  }

  buildScene() {
    applyMobileCamera(this);   // no-op on desktop
    installLongPress(this);    // hold = hover on touch; no-op on desktop
    installPointerPolicy(this);   // right-click never acts, anywhere
    // The map opens deck pickers (HONE, PURGE, the merchant's removal), pack
    // tables and the deck viewer, and every card on all of them answers the
    // same hold/right-click as a card in the fan does. Nothing on this scene is
    // a HAND card, so the only inspectable sprites are the picker's own.
    installCardInspect(this, (obj) => (obj instanceof CardSprite && obj.getData?.('picker')
      ? { card: obj.card, sprite: obj, depth: obj.depth + 4 }
      : null));
    this.busy = false;   // scenes are reused across restarts — always re-arm input
    // ...and so are these four: all died with the last create()'s display list,
    // and a kept handle would let a pointerout destroy an object that is gone.
    this.oracleChip = null;
    this.oracleTip = null;
    this.passiveChip = null;
    this.passiveTip = null;
    this.cameras.main.fadeIn(300, 20, 16, 28);
    playMusic(this, this.act.music.fight);

    // Biome backdrop, pushed back into the dark so the parchment pops.
    this.add.image(GAME_W / 2, 400, this.act.bgKey)
      .setScale(1920 / 2544).setTint(0x686070).setDepth(DEPTH.bg);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.45).setDepth(DEPTH.bg + 1);

    this.buildScrollingMap();
    this.buildFixedUI();
    this.startAmbience();
    // Above the whole overlay stack (events 50, tips +3, deck info +6, toasts
    // +8), so the gear is live in EVERY room — an event's dimmer used to bury
    // it. The settings panel itself opens at +30, over this.
    // ...pinched in from the top-right corner on the phone, with the belt it
    // sits above (see HUD_SAFE). Desktop passes the shipped default.
    //
    // THE COG WAS THE WORST OFFENDER (JC, 2026-08-10: "basically clipped"), and
    // the reason is that it is the only thing on this screen that lives in the
    // corner ITSELF rather than along an edge — where the glass is cut on the
    // DIAGONAL and an edge inset buys nothing. It is 66px on touch, so its box
    // is 66x66 about the centre passed here; at (GAME_W-SAFE.x-52, SAFE.y+54)
    // that box is 2159..2225 x 45..111 on the 2340 canvas, whose farthest point
    // from the top-right arc's centre (2190,150) is 111px against a 150 radius
    // — comfortably inside the glass. clearsCorners() below is the assertion,
    // and __hf.safe() hands the driver the same numbers.
    const cog = TOUCH
      ? addSettingsButton(this, GAME_W - SAFE.x - 52, SAFE.y + 54, DEPTH.overlay + 20)
      : addSettingsButton(this, GAME_W - 44 - HUD_SAFE, 42, DEPTH.overlay + 20);
    // It names itself for the same reason VIEW DECK does: five drivers had its
    // old coordinates typed into them (see __hf.buttons).
    cog.setData('hfLabel', 'SETTINGS');
    this._cogClear = clearsCorners({
      left: cog.x - cog.displayWidth / 2, right: cog.x + cog.displayWidth / 2,
      top: cog.y - cog.displayHeight / 2, bottom: cog.y + cog.displayHeight / 2,
    });

    // Autonomous-playtest hooks.
    window.__hfScene = 'map';
    window.__hf = {
      run,
      map: run.map,
      scene: this,          // verification runs walk the display list for labels
      reachable: () => reachable(run.map),
      enter: (id) => this.tryEnter(id),
      nodeScreenPos: (id) => {
        const p = this.nodePos(run.map.nodes[id]);
        return { x: p.x, y: p.y + this.mapLayer.y };
      },
      // Deterministic room access for autonomous playtests.
      openRest: () => this.runRest(),
      openShop: () => this.runShop(),
      openEvent: (mythic = false, eventId = null) => this.runEvent({ type: 'event', mythic, eventId }),
      // THE TRAVELING CASINO, straight from the map. `force` pins only the ROLL
      // (which pocket / which duck), never a payout, so a verification run can
      // photograph a BIG WIN and a loss without farming spins while still
      // exercising the real money path. See ui/casino.js.
      openCasino: (id = 'blackjack', force = null) =>
        casinoOverlay(this, run, id, () => this.refreshMap(), { force }),
      skipAct: () => { advanceAct(); this.scene.restart(); },
      // Boss variety: inspect / force this act's rolled boss. Returns the
      // roster ids when called blind (or with an id that isn't in this act).
      bossPick: () => run.map.bossPick,
      // ELITES: what the board drew for each elite room, and a way to pin the
      // FORGED flag so a verification run can stand one next to a plain one
      // instead of farming boards until the 1-in-4 obliges.
      elites: () => eliteNodes(run.map).map(n => ({
        id: n.id, row: n.row, col: n.col, eliteIdx: n.eliteIdx, forged: !!n.forged, visited: !!n.visited,
      })),
      setForged: (id, on = true) => {
        const n = run.map.nodes[id];
        if (!n || n.type !== 'elite') return { ok: false };
        n.forged = !!on;
        this.scene.restart();
        return { ok: true, id, forged: n.forged };
      },
      // Turn a row of ordinary rooms into elites so a verification shot can
      // stand a FORGED node next to a plain one on the same floor. Never used by
      // the game — a real board decides its own rooms.
      makeEliteRow: (forgeFirst = true) => {
        const rows = {};
        for (const n of Object.values(run.map.nodes)) {
          if (n.id === run.map.bossId || n.row < 3 || n.row > run.map.rows - 2) continue;
          (rows[n.row] ??= []).push(n);
        }
        const row = Object.values(rows).filter(r => r.length >= 2)
          .sort((a, b) => a[0].row - b[0].row)[0];
        if (!row) return null;
        row.sort((a, b) => a.col - b.col);
        const pair = row.slice(0, 2);
        pair.forEach((n, i) => {
          n.type = 'elite';
          n.eliteIdx = i % (actOf(run.actIndex).pools.elite.length || 1);
          n.forged = forgeFirst ? i === 0 : i === 1;
          n.visited = false;
        });
        this.scene.restart();
        return pair.map(n => ({ id: n.id, row: n.row, col: n.col, forged: n.forged }));
      },
      // THE 1-IN-4, measured rather than hoped for: roll `n` fresh boards for the
      // act and difficulty we are standing in and count what came out forged.
      // The live board and its boss are put back exactly as they were.
      forgedRate: (n = 400) => {
        const keepMap = run.map;
        const keepBoss = run.bossPicks?.[run.actIndex];
        let elites = 0, forged = 0;
        for (let i = 0; i < n; i++) {
          for (const nd of eliteNodes(newActMap(run.actIndex))) { elites++; if (nd.forged) forged++; }
        }
        run.map = keepMap;
        if (keepBoss !== undefined) run.bossPicks[run.actIndex] = keepBoss;
        return { boards: n, elites, forged, rate: elites ? forged / elites : 0, difficulty: run.difficulty };
      },
      setDifficulty: (i) => { run.difficulty = i; return run.difficulty; },
      /**
       * SWAP THE HERO MID-RUN. Verification only, and it exists because two of
       * the five are LOCKED (Ophelia behind Act IV, Drusky behind 2,000 chips)
       * — a driver auditing the passive chip on all of them would otherwise
       * have to earn both trophies first, which is not a test of the chip.
       *
       * The ids come from the CHARACTERS roster, so a driver can enumerate the
       * heroes rather than keep its own list, and the four per-suit cardfaces
       * are fetched before the restart because they are deferred art and the
       * hand would otherwise deal the previous hero's paintings.
       */
      setHero: (id) => {
        if (!CHARACTERS[id]) return Promise.resolve({ ok: false, ids: Object.keys(CHARACTERS) });
        run.chrId = id;
        return ensure(this, heroCardfaces(id)).then(() => {
          this.scene.restart();
          return { ok: true, id, ids: Object.keys(CHARACTERS) };
        });
      },
      // THE MIXED SHELF, straight from the map: farming elites until a bottle
      // turns up is not a test. `mix` pins the kinds for a layout audit.
      eliteSpoils: (forged = false, mix = null) => {
        const spoils = mix
          ? mix.map(k => (k === 'potion'
            ? { kind: 'potion', def: rollElitePotion(Math.random, [], run.actIndex) }
            : rollEliteSpoils({ ownedIds: run.artifacts.map(a => a.id), count: 1, forged, heroId: run.chrId, actIndex: run.actIndex })[0]))
            .filter(Boolean)
          : rollEliteSpoils({
            ownedIds: run.artifacts.map(a => a.id), count: 3, forged,
            heroId: run.chrId, actIndex: run.actIndex,
          });
        eliteChoiceOverlay(this, run, spoils, () => this.refreshMap(), { forged });
        return spoils.map(s => ({ kind: s.kind, id: s.def.id, name: s.def.name, rarity: s.def.rarity }));
      },
      newAct: () => { run.map = newActMap(run.actIndex); this.scene.restart(); return run.actIndex; },
      // DEV: override the NEXT fight's line-up by enemy-def id (one-shot).
      forceEncounter: (ids) => { run.debugEncounter = ids; return ids; },
      // ALTERNATE ACTS. `biomes()` reports what this run drew and what it could
      // have drawn; `setBiome(id)` pins one and rebuilds the board, because the
      // world owns the elite bag and the boss roster — a pin that kept the old
      // board would leave an eliteIdx pointing into a pool that no longer has
      // that many entries. Verification runs use this to walk a KNOWN world
      // instead of farming runs until the roll obliges.
      biomes: () => ({
        picks: { ...run.actPicks },
        current: this.act.id,
        roster: [0, 1, 2, 3].map(i => actVariants(i).map(a => a.id)),
      }),
      setBiome: (id, actIndex = run.actIndex) => {
        const ids = actVariants(actIndex).map(a => a.id);
        if (!ids.includes(id)) return { ok: false, roster: ids };
        setActPick(actIndex, id);
        if (actIndex === run.actIndex) {
          run.map = newActMap(run.actIndex);
          this.scene.restart();
        }
        return { ok: true, actIndex, biome: id };
      },
      /**
       * WHAT THE BOARD IS DOING TO THE INK, and a way to put a hero token on
       * it. The legibility sweep has to photograph a board with all four marks
       * live — trail, reachable ring, node icon and the hero standing on one —
       * and at act start `currentId` is null, so nothing is standing anywhere.
       */
      boardInk: () => ({ ambience: this.act.ambience, ...this.boardInk }),
      /**
       * THE HOVER TIP, MEASURED. The parchment was being CROPPED — a 36px-tall
       * nineslice with 34px corners is four overlapping corners and no middle —
       * and the shapes that did it are the SHORT ones: a title with no body,
       * which is every node you cannot reach yet. So the audit hands back the
       * panel's box and its content's box and a driver asserts the frame
       * actually contains what is printed on it, for the short case and the
       * long one alike.
       */
      tipAudit: (title, body = null) => {
        this.showTip(GAME_W / 2, 600, title, body);
        const tip = this.mapTip;
        if (!tip) return null;
        // The tip holds TWO panel_wood nineslices — the cast shadow (offset
        // +7/+10, alpha 0.35) and the parchment itself. Pick by opacity: a
        // NineSlice is a mesh, so its tint fields are not the plain Image's and
        // `tintTopLeft !== 0` quietly matched the shadow first.
        const panel = tip.list.filter(o => o.texture?.key === 'panel_wood')
          .find(o => o.alpha >= 0.9);
        const texts = tip.list.filter(o => o.text != null);
        const box = o => {
          const m = o.getWorldTransformMatrix();
          return {
            left: m.tx - o.displayWidth * o.originX, right: m.tx + o.displayWidth * (1 - o.originX),
            top: m.ty - o.displayHeight * o.originY, bottom: m.ty + o.displayHeight * (1 - o.originY),
          };
        };
        const p = box(panel);
        const ink = texts.map(box);
        const out = {
          panel: { ...p, w: Math.round(p.right - p.left), h: Math.round(p.bottom - p.top) },
          ink: {
            left: Math.min(...ink.map(t => t.left)), right: Math.max(...ink.map(t => t.right)),
            top: Math.min(...ink.map(t => t.top)), bottom: Math.max(...ink.map(t => t.bottom)),
          },
          lines: texts.length,
          onScreen: p.top >= 0 && p.bottom <= GAME_H && p.left >= 0 && p.right <= GAME_W,
        };
        this.hideTip();
        return out;
      },
      standOnStart: () => {
        const m = run.map;
        if (!m.currentId) {
          m.currentId = m.starts[0];
          m.nodes[m.currentId].visited = true;
          m.taken = [m.currentId];
        }
        this.scene.restart();
        return m.currentId;
      },
      bossRoster: () => bossRoster(this.act).map(b => b.id),
      setBoss: (id) => {
        const ids = bossRoster(this.act).map(b => b.id);
        if (!ids.includes(id)) return { ok: false, roster: ids };
        run.map.bossPick = id;
        run.bossPicks[run.actIndex] = id;
        this.scene.restart();
        return { ok: true, bossPick: id };
      },
      openBounty: () => this.runBounty(run.actIndex - 1),
      // Skip the reveal and deal an EXACT set of bounty rewards (or a fresh
      // roll). `wheelRoll` pins the Forge Wheel's outcome so a playtest can
      // walk every bucket without stubbing Math.random globally (that breaks
      // Phaser's canvas-texture UUIDs).
      bountyPack: (ids = null, wheelRoll = null) => {
        let opts = ids
          ? ids.map(id => BOUNTY_REWARDS.find(o => o.id === id)).filter(Boolean)
          : rollBountyRewards(run, 3);
        if (wheelRoll != null) {
          opts = opts.map(o => (o.ui === 'wheel' ? { ...o, apply: r => o.apply(r, null, () => wheelRoll) } : o));
        }
        packOpenOverlay(this, run, PACK_TYPES.bounty, opts, () => this.refreshMap());
      },
      giveArtifact: (id) => {
        const def = ARTIFACT_POOL.find(a => a.id === id) ?? ARTIFACT_POOL.find(a => !run.artifacts.some(o => o.id === a.id));
        if (def) acquireArtifact(run, def);
        return run.artifacts.map(a => a.id);
      },
      // WHERE THE PLATES ARE. Overlay buttons used to be fixed-size, so the
      // autonomous walkers could blind-click hard-coded coordinates; since the
      // event panel is sized to its own content (2026-07-31) they have to ask.
      // Returns world-space centres, in display order, for every live button.
      //
      // THE HUD'S OWN PLATES NAME THEMSELVES (2026-08-06). VIEW DECK, HANDS and
      // the two dev buttons hang off the left capsule's FLOOR, and that floor
      // moved 56px the day the passive chip needed a seat below the portrait —
      // at which point five drivers with `page.mouse.click(112, 258)` typed
      // into them broke at once. They carry a `label` now, so a driver can name
      // the button it wants instead of remembering where it used to be.
      // `label` is null for everything else, which is every overlay plate.
      // ...and the same walk now reports the SETTINGS COG, which is not a
      // `btn_` plate but IS the one control a corner-clearance driver has to be
      // able to find by name. Every plate the two-tap box draws is a `btn_`
      // image on the display list, so those come back for free.
      buttons: () => {
        const NAMED = { icon_setting: 'SETTINGS' };
        const out = [];
        const walk = (o) => {
          if (!o) return;
          const key = o.texture?.key ?? '';
          if (o.texture && (/^btn_/.test(key) || key in NAMED) && o.input?.enabled) {
            const m = o.getWorldTransformMatrix();
            out.push({
              key, label: o.getData?.('hfLabel') ?? NAMED[key] ?? null,
              x: Math.round(m.tx), y: Math.round(m.ty),
              w: Math.round(o.displayWidth), h: Math.round(o.displayHeight),
            });
          }
          (o.list ?? []).forEach(walk);
        };
        this.children.list.forEach(walk);
        return out;
      },
      /**
       * THE TWO-TAP BOX, as the driver sees it. ui/choicebox.js publishes
       * `window.__hfBox` whenever one is open (title, body, note, the plate
       * rectangles and a `press(label)` that goes through the same path a
       * finger does); this is just the stable door onto it, so a driver never
       * has to know which module owns the global.
       */
      box: () => window.__hfBox ?? { open: false },
      /**
       * THE FIRST TAP ON A NODE, performed. The whole point of the model is
       * that touching a room does NOT enter it, and a driver cannot prove a
       * negative by clicking a coordinate and hoping. This opens exactly the
       * box `twoTap` would have opened — same spec object, same guard — and
       * travels nowhere, so the assertion is "the box is up AND run.map.currentId
       * did not move".
       *
       * Touch builds only, by construction: on desktop no spec was ever
       * registered, and it says so rather than pretending.
       */
      tapNode: (id) => {
        const taps = this._nodeTaps ?? {};
        const spec = taps[id];
        if (!spec) return { ok: false, touch: TOUCH, ids: Object.keys(taps) };
        if (spec.guard && spec.guard() === false) return { ok: false, id, refused: true };
        openChoiceBox(this, spec);
        return { ok: true, id, box: window.__hfBox };
      },
      /** The rounded-glass frame this scene laid itself out inside. */
      safe: () => ({ ...SAFE, hudSafe: HUD_SAFE, cogClearsCorners: this._cogClear !== false }),
      music: () => musicDebug(),
      sounds: () => this.sound.sounds.map(s => ({ key: s.key, playing: s.isPlaying, volume: s.volume })),
      reforgeNow: () => artifactPickerOverlay(this, run, {}, (a) =>
        (a ? artifactCeremony(this, run, a, () => this.refreshMap()) : this.refreshMap())),
      givePotion: (id) => { run.potions.push({ ...POTION_BY_ID[id] }); this.refreshMap(); },
      // Open a pack TABLE / a single-relic CEREMONY straight from the map, so a
      // verification run can audit their decline buttons without farming a
      // fight for each one.
      // `kinds` pins the shelf (a cover-sizing audit cannot farm tables until the
      // Curator's 10% shows up); blank rolls a real one.
      openPacks: (kinds = null) => packOfferOverlay(this, run,
        kinds ? kinds.map(k => PACK_TYPES[k]).filter(Boolean) : rollPackOffer(run.actIndex),
        () => this.refreshMap()),
      // Deal an EXACT shelf from one pack, and report what each option promises
      // to touch. tools/verify_ux_0802.py drives the card-preview audit through
      // this: farming a Dealer table until Loaded Deal shows up is not a test.
      openPackKind: (kind, ids = null) => {
        const all = openPack(kind, run, 50).options;
        const opts = (ids ? ids.map(id => all.find(o => o.id === id)).filter(Boolean) : all.slice(0, 3));
        packOpenOverlay(this, run, PACK_TYPES[kind], opts, () => this.refreshMap());
        return opts.map(o => ({
          id: o.id,
          preview: o.preview ? {
            mode: o.preview.mode,
            count: o.preview.count ?? null,
            cards: (o.preview.cards ?? []).map(c => `${c.suit}-${c.rank}`),
          } : null,
        }));
      },
      ceremony: (id) => {
        const def = ARTIFACT_POOL.find(a => a.id === id) ?? ARTIFACT_POOL[0];
        artifactCeremony(this, run, def, () => this.refreshMap(), { quiet: true, noRiser: true });
        return def.id;
      },
      // THE ORACLE, for the verification walk. `oracle()` reads the run's
      // receipt and its channels; `openOracle()` replays the whole reveal;
      // `oracleShelf(ids)` skips the reveal and deals an EXACT three, which is
      // the only way to audit all twenty tooltips without restarting the game
      // twenty times over.
      oracle: () => ({
        pending: !!run.pendingOracle, taken: run.oracle ?? null,
        mods: { ...run.oracleMods }, all: ORACLE_OPTIONS.map(o => o.id),
      }),
      // Every rules string, so the driver can measure all twenty against the
      // tooltip's real font instead of eyeballing three of them.
      oracleDescs: () => ORACLE_OPTIONS.map(o => [o.id, o.desc]),
      openOracle: () => { oraclePackOverlay(this, run, () => this.refreshMap()); return run.oracle; },
      oracleShelf: (ids = null) => {
        const opts = ids
          ? ids.map(id => ORACLE_BY_ID[id]).filter(Boolean).map(o => ({
            ...o, apply: (rr = run, c = null, g = Math.random) => takeOracle(rr, o, g),
          }))
          : rollOracleOffer(run);
        packOpenOverlay(this, run, PACK_TYPES.oracle, opts, () => this.refreshMap(), {
          mandatory: true, subtitle: 'Three futures. You MUST take one.',
        });
        return opts.map(o => ({ id: o.id, name: o.name, desc: o.desc }));
      },
    };

    this.scrollToCurrent(false);

    // PREFETCH THE BOSS STAGE (2026-08-04). The act's boss was rolled at map
    // generation, so its painted arena is known the moment the board stands —
    // minutes before it is needed. Fetching it HERE (not in Boot: boot time is
    // the shipping risk, and a run meets one boss per act) means the stage is
    // in the texture cache long before the boss room opens; CombatScene still
    // falls back to the act backdrop and hot-swaps if anyone outruns it.
    // fetchStage, never a raw load.image: this scene restarts on every room,
    // and an unguarded scene-loader fetch here raced CombatScene's for the
    // same key ("Texture key already in use" — the audition caught it, six
    // ways). The raw-Image fetch in stages.js is lifecycle-proof and dedupes.
    fetchStage(this, stageForMap(this.act, run.map?.bossPick));

    /**
     * ...AND THE REST OF THE ACT, in the background and never waited on.
     *
     * The board is standing, the player is reading it, and nothing on screen
     * needs any of this: the world's whole bestiary (so walking into a room is
     * instant even though CombatScene's own gate is what GUARANTEES it), the
     * eight pack covers (so the reward table opens with no beat at all), and
     * THE ORACLE's twenty cards while she is still owed — she deals 420ms from
     * now with no fight in front of her to hide a load behind.
     *
     * Fire-and-forget on purpose. If the player enters a room before this
     * lands, the room's gate waits the difference and nothing is lost.
     */
    ensure(this, mapPrefetch(run.actIndex, run));

    /**
     * GIVE THE LAST ACT BACK. This is the line that keeps the ENDLESS flat.
     *
     * Every act index the run has ever rolled a world for is asked what it owns
     * (backdrop, board, banner, medallions, bestiary, boss arena) and everything
     * that does not belong to the act being STOOD IN is released. Without it,
     * lap two of the endless holds two forests, lap three holds three, and the
     * whole exercise buys a slower death rather than none.
     *
     * It runs AFTER the board is built, not before: `evict` refuses anything
     * still in flight, and the display list that is about to draw the current
     * act's art is already holding it.
     */
    this.evictOtherActs();
    /**
     * ...AND THE ORACLE'S TWENTY, ONCE SHE HAS BEEN READ.
     *
     * Her shelf is the biggest painted set in the game (20 cards, 30 MB) and the
     * only one dealt on ARRIVAL, with no fight in front of it to hide a load
     * behind — so mapPrefetch fetches it up front and checkOracle hands it back
     * the instant a future is taken. This is the SWEEP behind that: `evict`
     * refuses anything still in flight, and twenty images kicked off 420ms
     * before the ceremony opens can easily still have two of them in the air
     * when it closes. Those two would otherwise be resident for the whole run.
     *
     * `run.oracle` is the safe gate rather than `!pendingOracle`: the flag is
     * cleared BEFORE her overlay opens (so a restart cannot deal her twice),
     * but the reading itself is only written when a card is actually taken.
     *
     * ...AND ONE CARD IS KEPT. THE ORACLE'S RECEIPT (ui/oracleChip.js) pins the
     * chosen card's own painting under the hero's face for the whole run —
     * cropped to its portrait, on the map HUD and in every fight. Evicting the
     * whole shelf therefore takes the chip's face with it, and the chip falls
     * back to the wrapper. Caught by tools/verify_qol_0805.py, which reads the
     * chip's texture key by name.
     */
    this.releaseOracleShelf();

    // AUTOSAVE CHOKEPOINT — THE MAP IS STANDING.
    // Every non-combat room resolves through refreshMap(), which restarts this
    // scene, and every fight comes home through returnToMap(). So one call here
    // IS "after arrival, after a fight won, after a shop closed, after an event
    // resolved, after a pack taken, after a rest taken, after an act advanced" —
    // one site instead of eight, and no new room can forget to add itself.
    //
    // It lands BEFORE checkBounty on purpose: the bounty stakes its claim
    // synchronously and opens its pack on a timer, so saving first means a quit
    // during that pack replays the bounty instead of eating it.
    autosave(run);
    // THE ORACLE goes first, and it comes AFTER the autosave above for exactly
    // the same reason the bounty does: the save on disk still says the choice is
    // owed, so a quit taken while her cards are on the table comes back owing it.
    if (this.checkOracle()) return;
    this.checkBounty();
  }

  /**
   * Release every world this run is not standing in.
   *
   * KEEP is the footprint of the act being stood in — its backdrop, board,
   * banner, medallions, whole bestiary and every arena its roster could roll.
   * DROP is every other world-owned texture in the manifest, which is a
   * subtraction rather than a walk over `run.actPicks` for the two reasons
   * spelled out at worldKeysExcept(). A key in both (the Crucible borrows the
   * Abyss's backdrop, the Ashen Crucible the Gallows') is kept, because keep is
   * what is subtracted.
   *
   * @returns {number} textures released — tools/verify_deferred.py reads this
   */
  evictOtherActs() {
    return evict(this, worldKeysExcept(actFootprint(run.actIndex, run)));
  }

  /**
   * THE ORACLE's twenty, minus the one the run is still wearing.
   *
   * Called from her own `done` (immediate) and from every later map arrival (the
   * sweep that catches images still in the air when she closed). Idempotent by
   * construction: `evict` only reports keys it actually released.
   *
   * @returns {number} textures released
   */
  releaseOracleShelf() {
    if (!run.oracle) return 0;
    const worn = oracleCardKey(run.oracle);
    return evict(this, packCards(['oracle']).filter(k => k !== worn));
  }

  // ---------------- THE ORACLE (start-of-run pack) ----------------

  /**
   * The one place THE ORACLE is dealt: on arrival at the first map, which is one
   * beat after the difficulty pick. Returns true when she took the beat, so
   * nothing else on this frame stacks an overlay on top of hers.
   *
   * `run.pendingOracle` is RUN state, not a scene field, because create() re-runs
   * on every refreshMap() — a scene flag would deal her again after the first
   * shop. It is cleared before the overlay opens (the bounty's precedent) so a
   * restart taken mid-ceremony cannot deal a second one, and the autosave that
   * already ran is what preserves the debt across a quit.
   *
   * It deliberately does NOT set `this.busy`, exactly like runBounty: the
   * overlay's own dimmer is interactive and swallows every click a player could
   * aim at the board underneath, so the flag would buy nothing and would leave
   * the map jammed if a ceremony were ever torn down early. It also keeps the
   * autonomous walkers able to drive the board through `__hf.enter()` while she
   * is on screen, which is what they have always done during the bounty pack.
   */
  checkOracle() {
    if (!run.pendingOracle) return false;
    run.pendingOracle = false;
    this.time.delayedCall(420, () => oraclePackOverlay(this, run, () => {
      /**
       * HER NINETEEN OTHER CARDS, GIVEN BACK. THE ORACLE is the one shelf in the
       * game dealt exactly ONCE per run, and hers is the biggest painted set of
       * the six (20 cards, 30 MB) — prefetched on arrival by mapPrefetch because
       * there is no fight in front of her to hide a load behind, and dead weight
       * from the moment a future is taken. The card you actually took stays: the
       * chip under the hero's face wears its portrait for the rest of the run.
       */
      this.releaseOracleShelf();
      this.refreshMap();
    }));
    return true;
  }

  // ---------------- THE BOUNTY HUNTER (act-boss payoff) ----------------

  /**
   * The bounty is COLLECTED in the act-clear ceremony now (CombatScene stages
   * the gold rain and the wrap before the DESCEND button lights up), which is
   * where it records the claim. This arrival check survives as the safety net:
   * if an act somehow lands you here still unclaimed — an old save caught
   * mid-transition, a dev act skip — the payoff still fires on the map.
   *
   * The claim is written BEFORE the overlay opens, so the mid-bounty scene
   * restarts (a merchant visit, a deck edit) can't hand out a second one.
   *
   * Also honours a merchant BOOKED during that ceremony: THE MERCHANT bounty
   * reward has no tent to walk into from a combat scene, so it defers to here.
   */
  checkBounty() {
    if (run.pendingShopVisit) {
      run.pendingShopVisit = false;
      this.busy = true;
      this.time.delayedCall(600, () => this.coinTransition(() => this.runShop()));
      return;
    }
    const cleared = run.actIndex - 1;
    if (cleared < 0) return;
    run.bountiesClaimed ??= [];
    if (run.bountiesClaimed.includes(cleared)) return;
    run.bountiesClaimed.push(cleared);
    this.time.delayedCall(520, () => this.runBounty(cleared));
  }

  runBounty(clearedIndex) {
    this.hideTip();
    const act = actOf(clearedIndex);
    // Name the boss this run actually killed, not the act's default.
    const killed = act ? bossEntry(act, run.bossPicks?.[clearedIndex]).name : null;
    const subtitle = act
      ? `ACT ${act.numeral} CLEARED. ${killed} had a price on its head.`
      : 'A boss is worth something to somebody.';
    bountyPackOverlay(this, run, { subtitle }, () => this.refreshMap());
  }

  // ---------------- Layout helpers ----------------

  get contentH() { return 300 + run.map.rows * ROW_GAP + 300; }

  /**
   * Organic layout: each floor's rooms are spread from the CENTER outward —
   * sparse floors sit wide and lonely, busy floors bunch up, everything
   * funnels toward the centered boss. No strict columns.
   */
  computeLayout() {
    const map = run.map;
    this.layout = {};
    for (let row = 0; row < map.rows; row++) {
      const rowNodes = Object.values(map.nodes)
        .filter(n => n.row === row && n.id !== map.bossId)
        .sort((a, b) => a.col - b.col);
      const n = rowNodes.length;
      const gap = Math.min(430, W_USE / Math.max(n, 2));
      rowNodes.forEach((node, i) => {
        this.layout[node.id] = {
          x: GAME_W / 2 + (i - (n - 1) / 2) * gap + node.jx,
          y: this.contentH - 280 - row * ROW_GAP + node.jy,
        };
      });
    }
    this.layout[map.bossId] = {
      x: GAME_W / 2,
      y: this.contentH - 280 - map.rows * ROW_GAP - 78,
    };
  }

  nodePos(node) { return this.layout[node.id]; }

  // ---------------- The scrolling map body ----------------

  buildScrollingMap() {
    this.mapLayer = this.add.container(0, 0).setDepth(DEPTH.arena);
    // The two-tap specs, by node id — rebuilt with the board, so __hf.tapNode
    // can never hand a driver last restart's dead anchor. Empty on desktop.
    this._nodeTaps = {};

    // Caleb's painted biome board IS the map surface (frame, texture and all).
    // One board per WORLD, keyed off its ambience (which is 1:1 with the world).
    // The lookup moved to core/lazyload.js when the boards left the boot set:
    // the loader has to fetch exactly what this line is about to draw, and two
    // copies of that table is how a seventh world ships with a blank board.
    // ...and on the PHONE it is the WIDE cut of the same board (2340x2100, the
    // 1920 node-band identical down the middle, decorative wings either side),
    // drawn full-bleed instead of floated in 210px of dead canvas. boardKeyFor
    // is the loader's own answer, so the veil cannot lift on a key the map is
    // not about to draw. See BOARD_W.
    const boardKey = boardKeyFor(this.act.ambience) ?? 'map_board_abyss';
    const board = this.add.image(GAME_W / 2, this.contentH / 2, boardKey)
      .setDisplaySize(BOARD_W, this.contentH - 16);
    this.boardImage = board;
    // A secret act SCORCHES the board it borrows. `secretTint` lets each one
    // scorch in its own colour: the Crucible's default pushes the Abyss hotter,
    // and the ASHEN CRUCIBLE overrides it to push the Gallows cold, because a
    // world already on fire cannot be recoloured by setting it on fire.
    // ENDLESS OUTRANKS THE SCORCH. Each lap of the four worlds re-lights them
    // (see ENDLESS_TINTS), and that hue has to win where both apply — an
    // endless Crucible is a Crucible seen by the loop's light, not a Crucible
    // wearing last year's paint over it. worldTint() is the single answer both
    // the board and the banner below ask for, so they can never disagree.
    const worldTint = this.worldTint();
    if (worldTint != null) board.setTint(worldTint);
    this.mapLayer.add(board);

    this.computeLayout();
    this.drawPaths();
    this.buildBossMedallion();
    this.buildNodes();

    // Scroll: wheel + drag, with the shared kinetic float (position runs
    // 0..contentH-GAME_H and the layer hangs at -position, so overshoot at the
    // top shows a sliver above the board and springs back).
    const kin = this._mapKin = kineticScroll(this, {
      max: Math.max(0, this.contentH - GAME_H),
      apply: (v) => { this.mapLayer.y = -v; },
      start: -this.mapLayer.y,
    });
    this.input.on('wheel', (p, o, dx, dy) => kin.wheel(dy));
    let dragging = null;
    this.input.on('pointerdown', p => { dragging = { py: p.y }; kin.grab(p.y); });
    this.input.on('pointermove', p => {
      // Dragging a relic up or down the belt is also a vertical pointer drag.
      // Without this guard the board scrolls out from under the reorder.
      if (this._beltDragging) return;
      if (dragging && p.isDown && Math.abs(p.y - dragging.py) > 8) kin.move(p.y);
    });
    this.input.on('pointerup', () => { dragging = null; kin.release(); });
  }

  /** What this world's ground does to the four marks drawn on it. See BOARD_INK. */
  get boardInk() { return BOARD_INK[this.act.ambience] ?? INK_DEFAULT; }

  /** Dotted ink trails between connected nodes; taken path glows gold. */
  drawPaths() {
    const map = run.map;
    const ink = this.boardInk;
    const takenEdges = new Set();
    for (let i = 0; i < map.taken.length - 1; i++) takenEdges.add(`${map.taken[i]}>${map.taken[i + 1]}`);
    const fromCurrent = new Set((map.currentId ? map.nodes[map.currentId].next : map.starts)
      .map(id => `${map.currentId ?? 'start'}>${id}`));

    for (const node of Object.values(map.nodes)) {
      const a = this.nodePos(node);
      for (const nextId of node.next) {
        const b = this.nodePos(map.nodes[nextId]);
        const taken = takenEdges.has(`${node.id}>${nextId}`);
        const live = map.currentId === node.id;
        const isLeap = node.leaps?.includes(nextId);
        // Leaps arc wide of the floor they skip — reads as a detour trail.
        const bulge = isLeap ? (a.x <= GAME_W / 2 ? -74 : 74) : 0;
        const mx = (a.x + b.x) / 2 + bulge, my = (a.y + b.y) / 2;
        const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const steps = Math.floor(dist / (isLeap ? 32 : 26));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const omt = 1 - t;
          const qx = omt * omt * a.x + 2 * omt * t * mx + t * t * b.x;
          const qy = omt * omt * a.y + 2 * omt * t * my + t * t * b.y;
          // The trail is pushed on the two dark boards (see BOARD_INK): the
          // untaken dots take a paler ink, everything takes more opacity, and
          // the dot itself grows by half the difference so a brighter mark is
          // not also a smaller one.
          const baseTint = isLeap ? 0xc09040 : taken ? 0xb8862c : live ? 0x8a6a3c : 0x9a835e;
          const dot = this.add.image(qx + Math.sin(s * 2.1) * 3, qy, 'map_dot')
            .setTint(!taken && !live && !isLeap && ink.dot != null ? ink.dot : baseTint)
            .setAlpha(Math.min(1, (taken ? 0.95 : live ? 0.9 : isLeap ? 0.7 : 0.55) * ink.trail))
            .setScale((taken || live ? 1.1 : isLeap ? 1.0 : 0.85) * (1 + (ink.trail - 1) * 0.5));
          this.mapLayer.add(dot);
          if (live) {
            this.tweens.add({
              targets: dot, alpha: { from: 0.35, to: 0.95 }, duration: 900,
              delay: t * 700, yoyo: true, repeat: -1,
            });
          }
        }
      }
    }
  }

  /** The act boss looms at the summit. Hover for its signature cruelty. */
  buildBossMedallion() {
    const map = run.map;
    const pos = this.nodePos(map.nodes[map.bossId]);
    const g = this.add.container(pos.x, pos.y);
    this.mapLayer.add(g);

    const glow = this.add.image(0, 10, 'fx_glow_circle').setTint(0xc03040)
      .setScale(1.5).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
    g.add(glow);
    this.tweens.add({ targets: glow, alpha: 0.6, scale: 1.7, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Caleb's boss head icon, disc-free: solid cast shadow under it, bigger.
    // The icon/name/blurb are the ROLLED boss's, not the act's default.
    const boss = this.boss;
    const SIZE = 240;
    const shadow = this.add.image(7, 16, boss.icon).setTint(0x120a06).setAlpha(0.55);
    shadow.setScale(SIZE / Math.max(shadow.width, shadow.height));
    g.add(shadow);
    const sprite = this.add.image(0, 0, boss.icon);
    sprite.setScale(SIZE / Math.max(sprite.width, sprite.height));
    g.add(sprite);
    this.tweens.add({ targets: sprite, y: -8, duration: 2100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Long names (THE DAUGHTERS OF DARKNESS) shrink rather than overrun the board.
    g.add(this.add.text(0, 150, `☠  ${boss.name}  ☠`, {
      fontFamily: 'Lilita One', resolution: 2,
      fontSize: boss.name.length > 20 ? '23px' : '29px', color: '#c02030',
      stroke: '#f6e8c8', strokeThickness: 5,
    }).setOrigin(0.5));

    const canFight = reachable(map).includes(map.bossId);
    if (canFight) {
      this.tweens.add({ targets: sprite, scale: { from: sprite.scale, to: sprite.scale * 1.06 }, duration: 700, yoyo: true, repeat: -1 });
    }

    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerover', () => {
      this.showTip(pos.x, pos.y + this.mapLayer.y + 205,
        `${boss.name}  ·  ${this.act.mechanic}`, boss.blurb);
      this.tweens.add({ targets: g, scale: 1.04, duration: 120 });
    });
    sprite.on('pointerout', () => { this.hideTip(); this.tweens.add({ targets: g, scale: 1, duration: 120 }); });

    // THE MEDALLION IS 240px OF BOSS HEAD and it committed on a RAW pointerdown
    // — it never went through tapBind at all, so on the phone a thumb brushing
    // the summit started the act boss. It gets the two-tap box like every other
    // hidden-information icon: the first touch reads the mechanic, FIGHT is the
    // only thing that walks in. Desktop keeps its raw pointerdown, untouched.
    const commit = () => { if (canFight) this.tryEnter(map.bossId); };
    if (TOUCH) {
      const spec = {
        key: 'node:boss',
        anchor: () => ({ x: pos.x, y: pos.y + this.mapLayer.y, w: SIZE, h: SIZE }),
        title: `${boss.name}  ·  ${this.act.mechanic}`,
        body: boss.blurb,
        accent: 0xc02030,
        guard: () => canFight,
        buttons: [{ label: 'FIGHT', kind: 'danger', onClick: commit }],
      };
      twoTap(this, sprite, spec);
      (this._nodeTaps ??= {})[map.bossId] = spec;
      this._nodeTaps.boss = spec;
    } else {
      sprite.on('pointerdown', commit);
    }
  }

  buildNodes() {
    const map = run.map;
    const open = reachable(map);
    const ink = this.boardInk;
    this.nodeSprites = {};

    for (const node of Object.values(map.nodes)) {
      if (node.id === map.bossId) continue;
      const forged = node.type === 'elite' && !!node.forged;
      const style = forged ? FORGED_STYLE : NODE_STYLE[node.type];
      const pos = this.nodePos(node);
      const g = this.add.container(pos.x, pos.y);
      this.mapLayer.add(g);
      this.nodeSprites[node.id] = g;

      const isOpen = open.includes(node.id);
      const isCurrent = map.currentId === node.id;
      const mythic = node.mythic;
      const r = style.r * (mythic ? 1.25 : 1);

      // Mythic red aura / FORGED ember / elite menace aura.
      if (mythic || node.type === 'elite') {
        const hot = mythic || forged;
        const aura = this.add.image(0, 0, 'fx_glow_circle')
          .setTint(forged ? FORGED_STYLE.aura : mythic ? 0xe03040 : 0xa03040)
          .setScale(forged ? 1.75 : mythic ? 1.0 : 0.62)
          .setAlpha(node.visited ? 0.1 : forged ? 0.62 : 0.3).setBlendMode(Phaser.BlendModes.ADD);
        g.add(aura);
        if (!node.visited) {
          this.tweens.add({
            targets: aura, alpha: hot ? (forged ? 0.95 : 0.75) : 0.5, scale: aura.scale * (forged ? 1.14 : 1.25),
            duration: forged ? 700 : mythic ? 800 : 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          });
        }
      }

      // Disc-free: the icon IS the node, floated on a cast shadow.
      const iconShadow = this.add.image(5, 9, style.icon).setTint(0x140c04).setAlpha(0.45);
      iconShadow.setScale((r * 2.2) / Math.max(iconShadow.width, iconShadow.height));
      const icon = this.add.image(0, 0, style.icon);
      if (mythic) icon.setTint(0xff5050);   // the red one — same '?' scroll, burning
      else if (forged) icon.setTint(FORGED_STYLE.tint);   // ...and the hot one
      icon.setScale((r * 2.2) / Math.max(icon.width, icon.height));
      g.add(iconShadow); g.add(icon);
      if (forged && !node.visited) this.dressForgedNode(g, r);

      if (node.visited && !isCurrent) {
        // Behind you: faded footprints.
        g.setAlpha(0.3);
        icon.setTint(0x7a746c);
      } else if (isOpen) {
        // Next steps: breathing gold ring, soft glow, gentle bob.
        // ADDITIVE under-glow is the mark that carries a dark board — it is
        // free contrast on a low-luminance ground and nearly invisible on a
        // bright one — so BOARD_INK.ring buys most of its help there and the
        // ring's own breath stops fading as far down (0.45 -> 0.66 at 1.6x),
        // because a gold circle at 45% opacity on purple is a brown circle.
        const glowUnder = this.add.image(0, 0, 'fx_glow_circle').setTint(style.ring)
          .setScale((r / 36) * (1 + (ink.ring - 1) * 0.35))
          .setAlpha(Math.min(0.8, 0.38 * ink.ring)).setBlendMode(Phaser.BlendModes.ADD);
        g.addAt(glowUnder, 0);
        const ring = this.add.image(0, 0, 'node_ring').setTint(style.ring)
          .setDisplaySize(r * 2.5, r * 2.5);
        g.add(ring);
        this.tweens.add({
          targets: ring, displayWidth: r * 2.85, displayHeight: r * 2.85,
          alpha: { from: 1, to: Math.min(0.75, 0.45 * ink.ring) },
          duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        this.tweens.add({
          targets: g, y: pos.y - 5, duration: 1200 + node.col * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      } else if (!node.visited) {
        // The road ahead: dimmed until you can walk it.
        icon.setAlpha(0.82);
        g.setAlpha(0.85);
      }

      // Hero token: Caleb's head icon, floated over the node with a cast shadow.
      if (isCurrent) {
        const heroShadow = this.add.image(4, -r - 34, 'hero_icon_' + chr().id).setTint(0x120a06).setAlpha(0.45);
        heroShadow.setScale(84 / Math.max(heroShadow.width, heroShadow.height));
        const hero = this.add.image(0, -r - 42, 'hero_icon_' + chr().id);
        hero.setScale(84 / Math.max(hero.width, hero.height));
        g.add(heroShadow); g.add(hero);
        this.tweens.add({ targets: hero, y: hero.y - 7, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }

      const clickable = () => isOpen || settings.dev;
      icon.setInteractive({ useHandCursor: isOpen });
      const label = mythic ? 'Something glows RED out here...' : style.label;
      icon.on('pointerover', () => {
        if (!node.visited || isCurrent) {
          // A FORGED node is the one hover on the board that has to SELL a
          // decision, so it spends the body text on what it costs and what it
          // pays instead of on "click to travel".
          const travel = isOpen ? say('Click to travel', 'Tap to travel')
            : settings.dev ? say('DEV: click to teleport', 'DEV: tap to teleport') : null;
          const body = forged ? `${FORGED_BLURB}${travel ? `\n${travel}` : ''}` : travel;
          this.showTip(pos.x, pos.y + this.mapLayer.y - r - 18, label, body);
        }
        if (clickable()) this.tweens.add({ targets: g, scale: 1.14, duration: 110 });
      });
      icon.on('pointerout', () => { this.hideTip(); this.tweens.add({ targets: g, scale: 1, duration: 110 }); });

      // TRAVEL IS THE MISCLICK JC NAMED FIRST. The board is a field of 80px
      // icons with a scrolling drag living on top of them, and entering the
      // wrong room is not undoable — so on touch the icon opens the box that
      // says which room it is, and TRAVEL is the only thing that walks. Desktop
      // keeps the exact tapBind it has always had.
      const commit = () => { if (clickable()) this.tryEnter(node.id); };
      if (TOUCH) {
        // The anchor is read at OPEN time, not at build time: the board scrolls
        // under a fixed box, so `pos` alone is a board coordinate and only
        // `+ this.mapLayer.y` makes it the screen rectangle the box sits beside
        // (the same idiom the hover tip above uses).
        const spec = {
          key: `node:${node.id}`,
          anchor: () => ({ x: pos.x, y: pos.y + this.mapLayer.y, w: r * 2.2, h: r * 2.2 }),
          title: label,
          body: forged ? FORGED_BLURB
            : mythic ? MYTHIC_DESC
              : (NODE_DESC[node.type] ?? style.label),
          note: isOpen ? null : settings.dev ? 'DEV: not on your road. Teleporting anyway.' : null,
          accent: style.ring,
          guard: () => clickable(),
          buttons: [{ label: 'TRAVEL', kind: 'go', onClick: commit }],
        };
        twoTap(this, icon, spec);
        this._nodeTaps[node.id] = spec;
      } else {
        tapBind(this, icon, commit);
      }
    }

    // The hero always stands ON TOP of neighboring node discs.
    if (map.currentId && this.nodeSprites[map.currentId]) {
      this.mapLayer.bringToTop(this.nodeSprites[map.currentId]);
    }
  }

  /**
   * The three tells that are DRAWN rather than tinted: the anvil sigil, the
   * printed word, and the embers coming off it. Added to the node's container so
   * they inherit its bob, its hover scale and its fade when it is left behind.
   */
  dressForgedNode(g, r) {
    // THE HEAT INSIDE IT: an additive copy of the same icon breathing over the
    // top, so the skull looks lit from within rather than merely repainted.
    const burn = this.add.image(0, 0, FORGED_STYLE.icon).setTint(0xff8a2a)
      .setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD);
    burn.setScale((r * 2.2) / Math.max(burn.width, burn.height));
    g.add(burn);
    this.tweens.add({ targets: burn, alpha: 0.72, duration: 640, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // THE COLLAR: a hot ring around the node itself. The elite icon is ALREADY a
    // red skull, so tinting it hotter barely registers against its neighbour —
    // the silhouette has to change, and a burning ring is the change that reads
    // at a glance from anywhere on the board.
    const collar = this.add.image(0, 0, 'node_ring').setTint(FORGED_STYLE.ring)
      .setDisplaySize(r * 2.3, r * 2.3).setAlpha(0.95);
    g.add(collar);
    this.tweens.add({
      targets: collar, displayWidth: r * 2.75, displayHeight: r * 2.75, alpha: 0.5,
      duration: 780, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // (2026-08-04, JC: "you can remove the small orange circle with the black
    // ring and anvil attached to it. You can also remove the word FORGED" —
    // the anvil sigil and the nameplate are gone; the red heat, the burning
    // collar and the embers ARE the tell, and the hover tip still spells out
    // the stakes for anyone who wants the numbers.)

    // THE EMBERS: four motes drifting up out of it on staggered loops, so the
    // node reads as burning even in a still screenshot's neighbours.
    for (let k = 0; k < 4; k++) {
      const ex = (k - 1.5) * (r * 0.42);
      const mote = this.add.image(ex, r * 0.2, 'fx_dust').setTint(0xff8a3c)
        .setAlpha(0).setScale(0.16).setBlendMode(Phaser.BlendModes.ADD);
      g.add(mote);
      this.tweens.add({
        targets: mote, y: -r * 1.15, alpha: { from: 0.85, to: 0 },
        duration: 1500 + k * 190, repeat: -1, delay: k * 340, ease: 'Sine.easeOut',
      });
    }
  }

  // ---------------- Travel ----------------

  tryEnter(nodeId) {
    if (this.busy) return;
    const open = reachable(run.map);
    // Dev mode: teleport anywhere on the chart.
    if (!open.includes(nodeId) && !settings.dev) return;
    this.busy = true;
    this.hideTip();
    sfx(this, 'button', { volume: 0.8 });

    // ENCOUNTER CHOKEPOINT. enterMapNode wraps map.enterNode and pays whatever
    // is owed for having advanced — today that is the BANKER'S VAULT's interest,
    // and it is the same one line for a fight, an elite, a boss, an event, a
    // rest and the merchant, because the branch below happens after it.
    const { node, interest } = enterMapNode(nodeId, run, settings.dev);
    if (interest > 0) {
      sfx(this, 'chips_stack', { volume: 0.9 });
      this.hudChips?.setText(`◉ ${run.chips} chips`);
      popMessage(this, GAME_W / 2, 560, `THE VAULT PAYS  +${interest} chips`,
        { color: '#ffd23e', size: 44, rise: 70 });
    }
    // A dividend nobody watches land is a number nobody believes, so a paying
    // node holds the wipe back long enough to read it.
    const hold = interest > 0 ? 900 : 0;
    if (node.type === 'fight' || node.type === 'elite' || node.type === 'boss') {
      this.time.delayedCall(hold, () => {
        this.cameras.main.fadeOut(300, 20, 16, 28);
        this.cameras.main.once('camerafadeoutcomplete', () =>
          this.scene.start('Combat', { nodeId: node.id }));
      });
      return;
    }
    // Non-combat rooms resolve here, then the map refreshes in place.
    if (node.type === 'event') return this.time.delayedCall(hold, () => this.runEvent(node));
    if (node.type === 'rest') return this.time.delayedCall(hold, () => this.runRest(node));
    if (node.type === 'shop') return this.time.delayedCall(hold, () => this.coinTransition(() => this.runShop()));
  }

  /** Re-render the map after an overlay resolves (paths, nodes, HUD). */
  refreshMap() {
    this.busy = false;
    this.scene.restart();
  }

  /**
   * Drink an 'anywhere' potion outside combat — from the map belt, or from the
   * merchant's mat (which passes its own `after`, because a scene restart would
   * take the shop down with it).
   *
   * The belt slot is freed BEFORE the effect resolves: Potion Within a Potion
   * counts its own slot, and that is only true if it is empty by then.
   */
  /**
   * THE TWO-STEP TAP (JC, 2026-08-04, mobile): first tap reads the bottle and
   * offers DRINK; tapping anywhere else lets go.
   *
   * 2026-08-10 — SAME STEP, SHARED BOX. This was the game's FIRST two-step, and
   * it was right; what was wrong is that it was the ONLY one, hand-rolled, with
   * its own panel, its own full-screen catcher and its own idea of where a
   * confirm belongs. Now that every hidden-information icon on this screen wears
   * the same box (ui/choicebox.js), the potion mat has no business wearing a
   * different one — a player who learns "tap reads, the labelled plate acts"
   * on the belt must not have to learn it again on the mat.
   *
   * Two behaviours quietly improve on the way across: the box places itself
   * BESIDE the bottle instead of at a fixed right-edge x (so it never lands
   * under the thumb that summoned it), and browsing bottle-to-bottle is one tap
   * per bottle rather than two, because the shared box has no catcher to eat the
   * press aimed at the next one.
   *
   * THE NAME AND `_potConfirm` SURVIVE ON PURPOSE: tools/verify_mobile.py reads
   * the field and looks for text reading exactly DRINK / CANCEL / USE, and the
   * box prints its labels uppercase, so the driver sees what it always saw.
   */
  confirmMapPotion(pot, x, y) {
    this.hideTip();
    const usable = potionUsableIn(pot, 'map');
    const ov = openChoiceBox(this, {
      key: `potion:${pot.id ?? pot.name}`,
      anchor: { x, y, w: MAP_TYPE.potionIcon, h: MAP_TYPE.potionIcon },
      title: pot.name,
      body: pot.desc,
      note: usable ? null : pot.use === 'passive' ? 'Always working. Nothing to drink.' : 'Combat only.',
      accent: POTION_RARITY[pot.rarity]?.color,
      depth: DEPTH.overlay + 6,
      buttons: [
        { label: 'DRINK', kind: 'go', enabled: usable, onClick: () => this.drinkPotionHere(pot, x, y) },
        // ...and a spelled-out way back (JC, 2026-08-05). Tapping the parchment
        // or anywhere off the box does the same thing; the plate is for the
        // player who wants to be told there IS a way back.
        { label: 'CANCEL', kind: 'off', onClick: () => {} },
      ],
      onClose: () => { if (this._potConfirm === ov) this._potConfirm = null; },
    });
    this._potConfirm = ov;
    return ov;
  }

  drinkPotionHere(pot, x, y, { after = null } = {}) {
    const i = run.potions.indexOf(pot);
    if (i < 0) return false;
    run.potions.splice(i, 1);
    sfx(this, drinkSfxKey(pot), { volume: 0.8 });
    const line = applyUniversalEffect(pot.effect, run);
    if (line) {
      popMessage(this, x, y - 60, line,
        { color: pot.effect.type === 'heal' ? '#37d6a0' : '#ffc542', size: 28 });
    }
    this.hideTip();
    if (after) after();
    else this.time.delayedCall(900, () => this.refreshMap());
    return true;
  }

  /** Rendered width of a string in a style, leaving no Text object behind. */
  measure(str, style) {
    const t = this.add.text(0, 0, str, style);
    const w = t.width;
    t.destroy();
    return w;
  }

  scrollToCurrent(animate = true) {
    const map = run.map;
    const focus = map.currentId ? this.nodePos(map.nodes[map.currentId])
      : this.nodePos(map.nodes[map.starts[0]]);
    const target = Phaser.Math.Clamp(GAME_H * 0.6 - focus.y, GAME_H - this.contentH, 0);
    // Through the kin (position = -layer.y), so the scroll physics and the
    // auto-focus never disagree about where the board is.
    if (animate) this._mapKin?.glide(-target);
    else this._mapKin?.set(-target);
    if (!this._mapKin) this.mapLayer.y = target;
  }

  // ---------------- Fixed HUD ----------------

  buildFixedUI() {
    const hud = this.add.container(0, 0).setDepth(DEPTH.overlay - 1);

    // Act plate: Caleb's ornate world banner with the title fitted to its field.
    // Same single table the board reads (core/lazyload.js), same reason.
    const bannerKey = BANNER_BY_AMBIENCE[this.act.ambience] ?? 'banner_abyss';
    const banner = this.add.image(GAME_W / 2, 88, bannerKey);
    banner.setScale(660 / banner.width);
    // ...and the title plate takes the same scorch as the board, for the same
    // reason and out of the same field (see buildScrollingMap).
    const bannerTint = this.worldTint();
    if (bannerTint != null) banner.setTint(bannerTint);
    hud.add(banner);
    // Each banner's blank field sits slightly off its image center (measured
    // in source px) — nudge the title onto the field, not the image.
    // MEASURED, not guessed (2026-08-01, third pass): tools/verify_banner_center.py
    // shoots each act's header twice — once with the title, once with it hidden —
    // finds the blank field's left/right edges in the BARE shot by scanning the
    // rows the title's ink occupies for the run of field-coloured columns, and
    // reports (field centre - banner centre) / banner scale. The old numbers put
    // Act I 30px and Act II 20px right of their fields.
    // The three 2026-08-03 banners are measured by the same tool, in the same
    // pass, and transcribed here beside the originals.
    const fieldOffset = {
      banner_forest: 12, banner_frozen: 21, banner_abyss: 8,
      // The Plains plate reads 0 because its field is a STARFIELD and the
      // colour walk terminates on the stars rather than on the gold frame, so
      // the tool's own number for it is not to be trusted; its measured
      // RESIDUAL is +4px, which is inside budget, so it is left alone.
      banner_nocturnal: 10, banner_ethereal: 0, banner_gallows: 12,
    }[bannerKey] ?? 0;
    // ...and the same, VERTICALLY. The shipped three are wide and shallow and
    // their fields land close enough to the image's own middle that the title's
    // hard-coded y was always fine. The 2026-08-03 plates are 461-514px tall
    // against 376-420, and their fields sit well BELOW their image centre, so a
    // title on the old y floats over the top rim of its own field. Measured by
    // the same tool in the same pass (verify_banner_center.py reports
    // `fieldOffsetY SHOULD BE`), in the banner's own source px.
    const fieldOffsetY = {
      banner_nocturnal: 44, banner_ethereal: 16, banner_gallows: 52,
    }[bannerKey] ?? 0;
    const titleX = GAME_W / 2 + fieldOffset * banner.scaleX;
    const titleY = 86 + fieldOffsetY * banner.scaleY;
    // Title color matches each banner's field: parchment/ice = dark ink,
    // the Abyss's black stone slab needs pale lettering.
    // Which banners carry a DARK field and therefore need pale lettering. The
    // Abyss's black stone slab, the Plains' deep starfield and the Gallows'
    // scorched plate all do; the Nocturnal Forest's is pale parchment, so it
    // takes the same dark ink the Verdant Forest's does.
    const darkField = ['abyss', 'motes', 'ash'].includes(this.act.ambience);
    // ENDLESS names the lap on the plate. The title already shrinks to fit its
    // painted field (below), which is what pays for the extra token.
    const plateAct = isEndlessIndex(run.actIndex)
      ? `L${endlessLoop(run.actIndex)} · ACT ${this.act.numeral}`
      : `ACT ${this.act.numeral}`;
    const plateTitle = this.add.text(titleX, titleY, `${plateAct} · ${this.act.name.toUpperCase()}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '31px',
      color: darkField ? '#d8f0dc' : PARCH.text,
      stroke: darkField ? '#0a1410' : undefined,
      strokeThickness: darkField ? 5 : 0,
    }).setOrigin(0.5);
    // The banners' blank fields differ slightly — shrink to fit inside ~56% width.
    const maxW = banner.displayWidth * 0.56;
    if (plateTitle.width > maxW) plateTitle.setScale(maxW / plateTitle.width);
    hud.add(plateTitle);

    // Left capsule: hero, HP, chips, deck count — and, in the portrait's own
    // lane beneath it, the two chips. See CAPSULE for why it is 56px taller
    // than it was; everything that extra height buys goes to the chip column.
    const parts = woodPanel(this, CAPSULE.x, CAPSULE.y, CAPSULE.w, CAPSULE.h);
    hud.add([parts.shadow, parts.panel]);
    // Every x inside the capsule goes through LX so the whole column pinches
    // inward together on the phone (see HUD_SAFE) and is untouched on desktop.
    const heroIconShadow = this.add.image(LX(78), 100, 'hero_icon_' + chr().id).setTint(0x120a06).setAlpha(0.4);
    heroIconShadow.setScale(92 / Math.max(heroIconShadow.width, heroIconShadow.height));
    hud.add(heroIconShadow);
    const hero = this.add.image(LX(74), 96, 'hero_icon_' + chr().id);
    hero.setScale(92 / Math.max(hero.width, hero.height));
    hud.add(hero);
    hud.add(this.add.text(LX(130), 52, chr().name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.heroName}px`, color: PARCH.text,
    }).setOrigin(0, 0.5));
    const p = run.player;
    hud.add(this.add.text(LX(130), 90, `♥ ${p.hp}/${p.maxHp}`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.heroHp}px`, color: '#1d7a56',
    }).setOrigin(0, 0.5));
    // Kept on the scene: the BANKER'S VAULT's dividend lands while the map is
    // still standing, and a purse that pays you 100 chips in front of a counter
    // still reading the old number is a payout nobody believes.
    this.hudChips = this.add.text(LX(130), 126, `◉ ${run.chips} chips`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.heroChips}px`, color: PARCH.accent,
    }).setOrigin(0, 0.5);
    hud.add(this.hudChips);
    hud.add(this.add.text(LX(130), 162, `Deck: ${run.runDeck.length} cards`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.heroDeck}px`, color: PARCH.textDim,
    }).setOrigin(0, 0.5));
    // The mode you chose, quiet and always there. Small on purpose: it is a
    // reminder, not a banner.
    // The extra 4px of drop on touch is the price of the bigger deck row above
    // it: 23px ink on a 26px pitch would have the two lines touching.
    const mode = difficultyOf(run);
    hud.add(this.add.text(LX(130), TOUCH ? 192 : 188, mode.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.heroMode}px`, color: mode.ink,
    }).setOrigin(0, 0.5));
    // THE CHIP COLUMN, under the hero's face — the one box inside the capsule
    // that nothing in the hero block reaches: the portrait bottoms out at y
    // 142 and the text column starts at x 130. Both chips are measured UP from
    // the capsule's floor, so the column and the panel can never disagree.
    // Same coordinates on both builds; the capsule has no mobile branch, and
    // the wider canvas only adds empty air to its right.
    //
    // The PASSIVE is the upper chip and THE ORACLE the lower, exactly as they
    // are stacked in the combat sidebar — one order to learn, on both screens
    // that own a hero.
    this.passiveChip = addPassiveChip(this, LX(74), CAPSULE.floor - 98, run.chrId, { size: 46 });
    if (this.passiveChip) hud.add(this.passiveChip);
    this.oracleChip = addOracleChip(this, LX(74), CAPSULE.floor - 42, run.oracle, { size: 46 });
    if (this.oracleChip) hud.add(this.oracleChip);

    // Artifact belt (right) with hover tooltips — below the settings gear.
    // The column is as long as it needs to be: one cell per SLOT, but never
    // shorter than the row actually owned (weightless relics like The Phantom
    // Cast ride in the row for free and can push it past the slot count).
    // NOOK relics — the Sixth Finger's glove — are not in the row at all; they
    // hang in their own pouch under the column.
    // MOBILE (v2): same right-edge column, a size up for thumbs.
    // ...and the RIGHT column pinches by the same inset, for the same corner.
    // ...and DOWN by SAFE.y as well as in by SAFE.x (2026-08-10). The column was
    // pinched horizontally only, which left the topmost 72px cell with its lid
    // 96px from the top edge — fine along a flat edge, and 24px inside the arc
    // in the corner it actually lives in. At (GAME_W-180, 156) on the 2340
    // canvas the top cell's box is 2124..2196 x 120..192, whose farthest point
    // from the corner centre (2190,150) is 31px against a 150 radius.
    const beltX = (MOBILE ? GAME_W - 84 : GAME_W - 68) - HUD_SAFE;
    const beltY0 = 132 + SAFE.y;
    const BELT_PITCH = MOBILE ? 84 : 64;
    const belt = beltArtifacts();
    const cells = Math.max(run.artifactSlots, belt.length);
    const beltCellY = i => beltY0 + i * BELT_PITCH;

    // ------------------------------------------------------------------------
    // DRAG TO REORDER THE BELT (JC, 2026-08-02) — the same feel as the combat
    // mat (CombatScene.renderArtifactPanel), one axis instead of two.
    //
    // Relics resolve LEFT TO RIGHT, which on this vertical column is top to
    // bottom, so the belt's order is a real decision and the map is where you
    // have the time to make it. Lift, close ranks, 140ms Quad.easeOut slides
    // (no Back overshoot: that bounce is what read as unnatural), an insertion
    // index taken from slot midpoints WITH HYSTERESIS so a pointer on a
    // boundary cannot flicker, and a settle tween on drop.
    //
    // Deliberately NOT a scene restart on drop: refreshMap() is a full restart,
    // which re-scrolls the board and re-fires its sounds. The icons are already
    // where they belong when the drag lands, so the drop just re-dresses the
    // slots in place. Mirror verdicts DO depend on order, so they are recomputed
    // there rather than moved.
    // ------------------------------------------------------------------------
    const SLIDE = 140, SLIDE_EASE = 'Quad.easeOut';
    const HYST = 0.18;      // fractions of a slot
    this.input.dragDistanceThreshold = 14;   // a click to sell must not be a drag
    this._beltDragging = false;              // scenes are singletons: reset it
    const beltEntries = [];
    const beltBoxes = [];
    const beltPlace = () => {
      beltEntries.forEach((e, idx) => {
        if (e.dragging) return;
        this.tweens.killTweensOf(e.icon);
        this.tweens.add({ targets: e.icon, x: beltX, y: beltCellY(idx), duration: SLIDE, ease: SLIDE_EASE });
      });
    };
    const beltIndexAt = (py, cur, n) => {
      const t = (py - beltY0) / BELT_PITCH;
      if (t > cur + 0.5 + HYST || t < cur - 0.5 - HYST) return Phaser.Math.Clamp(Math.round(t), 0, n - 1);
      return cur;
    };
    /** Re-dress the slots after a reorder: rarity rings and the ⊘ mirror badges. */
    const beltRedress = () => {
      for (const e of beltEntries) { e.badge?.destroy(true); e.badge = null; }
      beltEntries.forEach((e, idx) => {
        beltBoxes[idx]?.setStrokeStyle(3, ARTIFACT_RARITY[e.art.rarity].color);
        if (mirrorBlockedBy(e.art)) {
          e.badge = noMirrorBadge(this, beltX + 20, beltCellY(idx) - 19, 9);
          hud.add(e.badge);
        }
      });
    };

    // ------------------------------------------------------------------------
    // THE CHAIN, SHOWN (2026-08-02). A tooltip that says "top to bottom" is a
    // rule you were told; a new player who skims it loses damage for hours and
    // never learns why. So the column is built to READ as a sequence: a chevron
    // is set into every SEAM between two cells, pointing the way the chain runs,
    // and each cell carries its ordinal in the corner the mirror badge leaves
    // free. Six cells stop being a stack and become first through sixth.
    //
    // A continuous strap threaded behind the whole column was the first try and
    // it was wrong: the cells are 0.85 alpha, so the strap ghosted THROUGH every
    // one of them as a vertical smear. The seams are the only place a thread can
    // honestly live here, so that is where it lives — a 10px plate of the box's
    // own edge colour, with the chevron cut into it.
    //
    // Drawn from the GRID, not from the relics, and added BEFORE the boxes — so
    // it is identical empty, full and mid-drag, the marks hold still while a
    // carried relic slides between them, and it owns no hit area of its own.
    // The glove pouch below the buckle strap gets none of this: it is worn, not
    // slotted, and it is not in the chain.
    // ------------------------------------------------------------------------
    if (cells > 1) {
      const ch = this.add.graphics();
      for (let i = 0; i + 1 < cells; i++) {
        const cy = beltCellY(i) + 32;               // the seam between two cells
        ch.fillStyle(0x1d1629, 0.92); ch.fillRect(beltX - 11, cy - 6, 22, 12);
        ch.lineStyle(1, 0x4a3c60, 0.7); ch.strokeRect(beltX - 11, cy - 6, 22, 12);
        for (const [color, alpha, w, oy] of [[0x0e0916, 0.8, 3, 0], [0x9a89c6, 0.55, 1.5, -1.5]]) {
          ch.lineStyle(w, color, alpha);
          ch.beginPath();
          ch.moveTo(beltX - 6, cy - 2.5 + oy); ch.lineTo(beltX, cy + 3 + oy); ch.lineTo(beltX + 6, cy - 2.5 + oy);
          ch.strokePath();
        }
      }
      hud.add(ch);
    }

    for (let i = 0; i < cells; i++) {
      const y = beltCellY(i);
      const box = this.add.rectangle(beltX, y, MOBILE ? 72 : 54, MOBILE ? 72 : 54, 0x241b31, 0.85).setStrokeStyle(3, 0x4a3c60);
      hud.add(box);
      beltBoxes.push(box);
      const art = belt[i];
      if (art) {
        box.setStrokeStyle(3, ARTIFACT_RARITY[art.rarity].color);
        const icon = addArtifactIcon(this, beltX, y, art, MOBILE ? 60 : 44);
        hud.add(icon);
        const entry = { art, icon, badge: null, dragging: false };
        if (mirrorBlockedBy(art)) { entry.badge = noMirrorBadge(this, beltX + 20, y - 19, 9); hud.add(entry.badge); }
        beltEntries.push(entry);

        // Hover reads it, click sells it — the tip dies on the click so the two
        // never argue over the same corner of the screen.
        const artRar = ARTIFACT_RARITY[art.rarity];
        const REORDER_HINT = 'Drag to reorder. The top of this column resolves first.';
        const showBeltTip = () => this.showTip(beltX - 40, icon.y, art.name,
          `${artRar?.label ?? ''}\n` + artifactTipBody(art)
          + (art.onSell ? `\n\n${say('Click', 'Tap')} to sell for ◉ ${sellValue(art)}. Its gift leaves with it.`
            : `\n\n${say('Click', 'Tap')} to sell for ◉ ${sellValue(art)}`)
          + `\n\n${REORDER_HINT}`, 1, !!artRar?.rainbow);
        // A carried relic sweeps over its neighbours; while something is in the
        // air the column holds still and says nothing.
        const quiet = () => !this._beltDragging;
        box.setInteractive({ useHandCursor: true });
        box.on('pointerover', () => quiet() && showBeltTip());
        box.on('pointerout', () => this.hideTip());

        /**
         * THE BELT'S ONE COMMIT, and its two triggers.
         *
         * The cell and the relic painting sitting on it are two hit areas over
         * one object, and BOTH of them sold. On touch they now open the same
         * box instead — one key, so tapping the icon and then the cell under it
         * is not two boxes but one.
         *
         * THE BOX DOES NOT SELL. Its SELL plate opens `sellPrompt`, which is the
         * full-screen "Relics never come back" confirm the shop shelf already
         * uses, and that is deliberately NOT one step too many: on desktop the
         * flow is hover-to-read → click → confirm, and here it is tap-to-read →
         * SELL → confirm. The reading step replaces the hover; the number of
         * DECISIONS is identical, and the thing being protected is a Legendary.
         */
        const beltSell = () => { this.hideTip(); this.sellPrompt(art); };
        const beltSpec = {
          key: `belt:${art.id}`,
          anchor: () => ({ x: beltX, y: icon.y, w: MOBILE ? 72 : 54, h: MOBILE ? 72 : 54 }),
          title: `${art.name}  ·  ${artRar?.label ?? ''}`,
          body: artifactTipBody(art),
          note: REORDER_HINT,
          accent: artRar?.color,
          guard: quiet,
          buttons: [{ label: `SELL ◉${sellValue(art)}`, kind: 'buy', onClick: beltSell }],
        };
        if (TOUCH) twoTap(this, box, beltSpec);
        else box.on('pointerdown', () => { if (quiet()) beltSell(); });

        // The icon sits ON the box, so it owns both gestures: a click through it
        // still sells, a drag reorders. `_justDragged` keeps the two apart.
        const base = icon.scale;
        icon.setInteractive({ useHandCursor: true, draggable: true });
        icon.on('pointerover', () => quiet() && showBeltTip());
        icon.on('pointerout', () => this.hideTip());
        icon.on('dragstart', () => {
          entry.dragging = true;
          icon._justDragged = true;
          this.hideTip();
          this._beltDragging = true;   // the board must not pan under the drag
          icon.setDepth(DEPTH.overlay + 2);
          this.tweens.killTweensOf(icon);
          this.tweens.add({ targets: icon, scale: base * 1.18, duration: 110, ease: SLIDE_EASE });
        });
        icon.on('drag', (pointer, dragX, dragY) => {
          // One axis (it is a column), but stepped OUT of it: the slot the
          // relic is aimed at has to stay visible underneath the relic.
          icon.setPosition(beltX - 30, dragY);
          const cur = beltEntries.indexOf(entry);
          const to = beltIndexAt(dragY, cur, beltEntries.length);
          if (to !== cur) {
            beltEntries.splice(cur, 1);
            beltEntries.splice(to, 0, entry);
            beltPlace();
            sfx(this, 'card_hover', { volume: 0.42, jitter: 0.08 });
          }
        });
        icon.on('dragend', () => {
          entry.dragging = false;
          this._beltDragging = false;
          icon.setDepth(0);
          const to = beltEntries.indexOf(entry);
          if (beltEntries.some((e, k) => e.art !== belt[k])) {
            // The belt is a VIEW of run.artifacts (nook relics are filtered out),
            // so write the new order back THROUGH the belt slots.
            const order = beltEntries.map(e => e.art);
            let k = 0;
            for (let j = 0; j < run.artifacts.length; j++) {
              if (!run.artifacts[j].props?.nook) run.artifacts[j] = order[k++];
            }
            sfx(this, 'card_deal', { volume: 0.56 });
            // FENG SHUI: the map belt and the combat mat are two views of one
            // row, so both drag handlers count. Only a change that actually
            // moved something counts, same rule as combat's.
            run.counters.reorders = (run.counters.reorders ?? 0) + 1;
            fireAchievements(this, 'state', { run });
          }
          this.tweens.killTweensOf(icon);
          this.tweens.add({
            targets: icon, x: beltX, y: beltCellY(to), scale: base,
            duration: SLIDE, ease: SLIDE_EASE,
            onComplete: () => { if (icon.scene) beltRedress(); },
          });
        });
        /**
         * ...AND THE ICON'S OWN COMMIT.
         *
         * On DESKTOP this stays exactly as it shipped: a raw pointerup guarded
         * only by `_justDragged`, because the icon is draggable and a plain
         * `pointerdown` would sell on the first frame of every reorder.
         *
         * ON TOUCH IT HAD TO GO. It was a raw pointerup with NO
         * `_touchHoldFired` check, so long-pressing a relic TO READ IT sold it
         * on release — the one gesture the touch model tells you is safe was the
         * one that emptied your belt. `tapBind` (inside `twoTap`) refuses both a
         * hold and anything that drifted past SLOP, and SLOP is the same 14px as
         * `dragDistanceThreshold` above, so drag-to-reorder is untouched: a
         * gesture is either a drag or a tap and can never be read as both.
         */
        if (TOUCH) twoTap(this, icon, beltSpec);
        else {
          icon.on('pointerup', () => {
            if (icon._justDragged) { icon._justDragged = false; return; }
            this.hideTip();
            this.sellPrompt(art);
          });
        }
      }
    }
    // The ordinals go on LAST, in the corner the mirror badge leaves free, so a
    // full-bleed relic painting cannot swallow its own cell's number. Stroked,
    // because a dragged relic can pass under one.
    for (let i = 0; i < cells; i++) {
      hud.add(this.add.text(beltX - 20, beltCellY(i) - 19, String(i + 1), {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.beltOrdinal}px`, color: '#a99cd0',
        stroke: '#150e22', strokeThickness: 4,
      }).setOrigin(0.5).setAlpha(0.75));
    }

    // THE GLOVE NOOK: a matching pouch hung under the relic column, separated
    // from it by a strap so it never reads as a seventh slot. Hover and sell
    // work exactly as they do on the belt (selling the glove hands the sixth
    // slot back, which is what onSell is for).
    const nook = nookArtifacts();
    if (nook.length) {
      // BELT_PITCH, not a hard-coded 64 (fixed 2026-08-10). The two numbers were
      // the same until the phone's cells went to 84, at which point the buckle
      // strap was drawn 120px UP INSIDE the last relic instead of below it — the
      // desktop board never showed it because 64 is still 64 there.
      const strapY = beltY0 + cells * BELT_PITCH - 12;
      hud.add(this.add.rectangle(beltX, strapY, 44, 4, 0x5f4324, 0.8));
      nook.forEach((art, k) => {
        const y = strapY + 40 + k * 68;
        hud.add(this.add.text(beltX, y - 36, 'GLOVE', {
          fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.gloveLabel}px`, color: '#e8d3a4',
          stroke: '#241505', strokeThickness: 4,
        }).setOrigin(0.5));
        const pouch = this.add.rectangle(beltX, y, 54, 54, 0x2f2416, 0.92)
          .setStrokeStyle(3, ARTIFACT_RARITY[art.rarity].color);
        // A folded flap across the pouch's mouth — the mat's leather language,
        // shrunk to belt scale.
        const flap = this.add.rectangle(beltX, y - 22, 46, 12, 0x4a3018, 1).setStrokeStyle(2, 0x2a1808);
        hud.add(pouch); hud.add(flap);
        hud.add(addArtifactIcon(this, beltX, y + 4, art, 40));
        const rar = ARTIFACT_RARITY[art.rarity];
        const WORN = '(worn, not slotted. It costs you no slot.)';
        pouch.setInteractive({ useHandCursor: true });
        pouch.on('pointerover', () => this.showTip(beltX - 40, y, art.name,
          `${rar?.label ?? ''}\n` + artifactTipBody(art)
          + `\n${WORN}`
          + `\n\n${say('Click', 'Tap')} to sell for ◉ ${sellValue(art)}. Its gift leaves with it.`,
          1, !!rar?.rainbow));
        pouch.on('pointerout', () => this.hideTip());
        // The pouch never had a MOBILE branch at all: it sold a Sixth Finger on
        // a raw first touch, with no tapBind, no hold check and no confirm in
        // front of it but sellPrompt's. Same box as the belt above it.
        const nookSell = () => { this.hideTip(); this.sellPrompt(art); };
        if (TOUCH) {
          twoTap(this, pouch, {
            key: `nook:${art.id}`,
            anchor: { x: beltX, y, w: 54, h: 54 },
            title: `${art.name}  ·  ${rar?.label ?? ''}`,
            body: `${artifactTipBody(art)}\n${WORN}`,
            note: 'Its gift leaves with it.',
            accent: rar?.color,
            buttons: [{ label: `SELL ◉${sellValue(art)}`, kind: 'buy', onClick: nookSell }],
          });
        } else {
          pouch.on('pointerdown', nookSell);
        }
      });
    }

    // Potion mat — Caleb's stitched-parchment strip, bottom-right, well clear
    // of the artifact column above it and the scroll hint at bottom-centre.
    // Drinkable-anywhere potions (heals) can be sipped right here while
    // planning; combat brews sit dim.
    // MOBILE (v2): same bottom-right home, just bigger. cx derives from the
    // right edge (1680 was GAME_W-240 all along).
    //
    // ...AND IT WAS THE ONE PIECE OF HUD THAT NEVER LEARNED ABOUT HUD_SAFE
    // (2026-08-10). At cx = GAME_W-240 with w=350 the mat's right lip sat 65px
    // from the glass and its rightmost potion's hit circle reached to 104 — both
    // inside the 96 every other corner-bound thing on this screen respects.
    //
    // BEFORE (touch)  cx GAME_W-240, w 350: mat spans GAME_W-415 .. GAME_W-65
    // AFTER  (touch)  cx GAME_W-306, w 400: mat spans GAME_W-506 .. GAME_W-106
    //
    // The 50px of growth is free: the belt column above it stops at y≈690 even
    // with a full six slots and a glove, the mat's top lip is at 908, and the
    // scroll hint is centred 800px to its left. The rightmost potion's hit
    // circle now reaches x = GAME_W-151 and y = 1020 — clear of the bottom-right
    // arc, whose centre is (GAME_W-150, 930) with a 150 radius. Desktop is the
    // shipped rectangle to the pixel.
    const mat = TOUCH
      ? { cx: GAME_W - SAFE.x - 210, cy: 978, w: 400 }
      : { cx: GAME_W - 240, cy: 986, w: 290 };
    const matImg = this.add.image(mat.cx, mat.cy, 'potion_mat');
    matImg.setDisplaySize(mat.w, mat.w * POTION_MAT.aspect);
    hud.add(dropShadow(this, matImg, MAT_SHADOW));
    hud.add(matImg);
    // Labelled like the ARTIFACTS mat (JC) — obvious at a glance.
    hud.add(this.add.text(mat.cx, mat.cy - (mat.w * POTION_MAT.aspect) / 2 - 11, 'POTIONS', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.potionsLabel}px`,
      color: '#e8d3a4', stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5));
    // MAT CLEANUP (JC, 2026-08-01): the mat's PAINTED worn circles are the only
    // slot indicators now. No code-drawn empty rings, no rarity rings, no glow
    // discs — a potion just sits on its painted spot with a drop shadow.
    const spots = potionSpots(mat.cx, mat.cy, mat.w);
    run.potions.slice(0, MAX_POTIONS).forEach((pot, i) => {
      const { x, y, r } = spots[i];
      const icon = addPotionIcon(this, x, y, pot, MAP_TYPE.potionIcon);
      hud.add(icon);
      const usable = potionUsableIn(pot, 'map');
      if (!usable) icon.setAlpha(0.55);
      const hit = this.add.circle(x, y, r, 0xffffff, 0.001).setInteractive({ useHandCursor: usable });
      hud.add(hit);
      hit.on('pointerover', () => this.showTip(x, y - 56, pot.name,
        pot.desc + (usable ? say('\nClick to drink.', '\nTap to drink.')
          : pot.use === 'passive' ? '\n(always working)' : '\n(combat only)')));
      hit.on('pointerout', () => this.hideTip());
      if (usable) {
        // TWO STEPS ON TOUCH (JC): tap opens the description with a DRINK
        // plate; tapping anywhere else lets go. Desktop keeps one-click.
        if (MOBILE) tapBind(this, hit, () => this.confirmMapPotion(pot, x, y));
        else hit.on('pointerdown', () => this.drinkPotionHere(pot, x, y));
      }
    });

    // Deck + hand-chart viewers, hung off the CAPSULE'S FLOOR rather than off a
    // constant: the capsule grew 56px on 2026-08-06 to seat the chip column,
    // and a pair of buttons that stayed at y 258 would have been buried under
    // its own panel.
    //
    // ...which is also why every plate in this column NAMES ITSELF, with a
    // 'hfLabel' the existing __hf.buttons() hook reads back. Five verification
    // drivers had these coordinates typed into them and all five broke on a
    // 56px move. A driver that asks for the button by name cannot break that
    // way again.
    // ...and both plates grow on touch (MAP_TYPE.deckW / handsW / viewerH). HANDS
    // slides 20px right with them, because the pair is laid out from two fixed
    // centres and two wider plates about the same centres would overlap by 23px.
    const btnY = CAPSULE.floor + 42;
    const deckBtn = this.add.image(LX(112), btnY + 3, 'btn_dark')
      .setDisplaySize(MAP_TYPE.deckW, MAP_TYPE.viewerH).setInteractive({ useHandCursor: true });
    hud.add(deckBtn);
    hud.add(this.add.text(LX(112), btnY, 'VIEW DECK', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.viewerFont}px`, color: '#cfc8e8',
    }).setOrigin(0.5));
    deckBtn.setData('hfLabel', 'VIEW DECK');
    deckBtn.on('pointerdown', () => {
      sfx(this, 'button', { volume: 0.7 });
      deckInfoOverlay(this, run);
    });
    const handsBtn = this.add.image(LX(MAP_TYPE.handsX), btnY + 3, 'btn_dark')
      .setDisplaySize(MAP_TYPE.handsW, MAP_TYPE.viewerH).setInteractive({ useHandCursor: true });
    hud.add(handsBtn);
    hud.add(this.add.text(LX(MAP_TYPE.handsX), btnY, 'HANDS', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.viewerFont}px`, color: '#cfc8e8',
    }).setOrigin(0.5));
    handsBtn.setData('hfLabel', 'HANDS');
    handsBtn.on('pointerdown', () => {
      sfx(this, 'button', { volume: 0.7 });
      handChartOverlay(this, run);
    });

    // The scroll hint belongs to the BOARD, not to a room — an overlay that
    // reaches the bottom edge (the event canvas) hides it while it is open.
    // ...lifted off the bottom glass by SAFE.y on touch, like everything else
    // that was pinned flush to an edge.
    this.mapHint = this.add.text(GAME_W / 2, GAME_H - 22 - SAFE.y, 'scroll or drag to survey the path, then choose your next step', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.scrollHint}px`, color: '#d8c9a8', stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5).setAlpha(0.85);
    hud.add(this.mapHint);

    if (settings.dev) {
      // The dev column keeps its own spacing but hangs off the same anchor as
      // the two viewer buttons, so the capsule's height is still one number.
      const devY = btnY + 64;
      const devBtn = this.add.image(LX(112), devY + 3, 'btn_green').setDisplaySize(180, 48).setInteractive({ useHandCursor: true });
      hud.add(devBtn);
      hud.add(this.add.text(LX(112), devY, '+500 CHIPS', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: '#0c3d18',
      }).setOrigin(0.5));
      // A flat dev cheat, deliberately outside gainGold — the GOLD slider is
      // for testing the real economy, and this button is for skipping it.
      devBtn.setData('hfLabel', '+500 CHIPS');
      devBtn.on('pointerdown', () => { run.chips += 500; sfx(this, 'chips_stack', { volume: 0.8 }); this.scene.restart(); });

      // DEV: jump straight to the next act's map (or note there's nowhere deeper).
      const skipBtn = this.add.image(LX(112), devY + 61, 'btn_green').setDisplaySize(180, 48).setInteractive({ useHandCursor: true });
      hud.add(skipBtn);
      hud.add(this.add.text(LX(112), devY + 58, 'SKIP ACT ▶', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '20px', color: '#0c3d18',
      }).setOrigin(0.5));
      skipBtn.setData('hfLabel', 'SKIP ACT');
      skipBtn.on('pointerdown', () => {
        // The ENDLESS has no final act, so the guard only applies to a finite run.
        if (!run.endless && run.actIndex >= run.totalActs - 1) {
          popMessage(this, 112, devY + 8, 'FINAL ACT', { color: '#ffd23e', size: 24 });
          return;
        }
        sfx(this, 'button', { volume: 0.8 });
        advanceAct();
        this.scene.restart();
      });
      // LX(), like every other x in this column. It was the one line in the
      // capsule that missed the pinch, so on the phone the dev hint sat 96px
      // left of the two buttons it belongs to.
      hud.add(legible(this.add.text(LX(112), devY + 102, say('dev: click ANY node to teleport', 'dev: tap ANY node to teleport'), {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: `${MAP_TYPE.devHint}px`, color: '#8fe098', fontStyle: 'bold',
      })).setOrigin(0.5));
    }
  }

  // ---------------- Tooltip ----------------

  /**
   * THE PARCHMENT WAS BEING CROPPED (JC, 2026-08-06), and the reason was
   * arithmetic rather than art.
   *
   * The panel is a NINESLICE with 34px corners, so it needs 68px in each axis
   * before its middle strip exists at all — below that the four corners overlap
   * and the frame reads as a torn-off scrap. The old height was
   * `30 + (body ? body.height + 26 : 6)`, which is 36px for a title-only tip:
   * every hover on a node you cannot reach yet ("Fight", "Merchant", with no
   * "Click to travel" line under it) drew a 36px-tall parchment, and so did
   * every short label on the belt. The width had the same hole for anything
   * under 22 characters.
   *
   * So both axes now carry a floor, the title's height is MEASURED instead of
   * assumed to be 30, and the padding is symmetric — the title used to be
   * pinned 6px from the panel's top edge and the body 26px from its bottom,
   * which is why a two-line body always looked bottom-heavy.
   */
  showTip(x, y, title, body, originX = 0.5, rainbow = false) {
    this.hideTip();
    const PAD = 16, GAP = 8, MIN_W = 150, MIN_H = 76;
    const tip = this.add.container(0, 0).setDepth(DEPTH.overlay + 3);
    const t = this.add.text(0, 0, title, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '22px', color: PARCH.text,
      wordWrap: { width: 420 }, align: 'center',
    }).setOrigin(0.5, 0);
    if (rainbow) rainbowText(this, t);
    const b = body ? this.add.text(0, t.height + GAP, body, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '19px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: 340 }, align: 'center', lineSpacing: 3,
    }).setOrigin(0.5, 0) : null;
    const contentH = t.height + (b ? GAP + b.height : 0);
    const h = Math.max(MIN_H, contentH + PAD * 2);
    const w = Math.max(MIN_W, Math.max(t.width, b ? b.width : 0) + PAD * 3);
    // The panel is centred on the CONTENT, so whatever slack the two floors
    // introduce is shared evenly above and below it rather than hung off one
    // edge — a 36px-tall tip is now a 76px tip with its title in the middle.
    const parts = woodPanel(this, 0, contentH / 2, w, h, { shadow: true });
    tip.add([parts.shadow, parts.panel, t]);
    if (b) tip.add(b);
    const top = contentH / 2 - h / 2;          // the panel's top edge, tip-local
    const tx = Phaser.Math.Clamp(x, w / 2 + 8 + (originX === 1 ? w / 2 : 0), GAME_W - w / 2 - 8);
    tip.setPosition(originX === 1 ? x - w / 2 : tx,
      Phaser.Math.Clamp(y - contentH / 2 - h / 2 - 8, 8 - top, GAME_H - 8 - top - h));
    this.mapTip = tip;
  }

  hideTip() { if (this.mapTip) { this.mapTip.destroy(true); this.mapTip = null; } }

  /**
   * THE BELT MOVED — a relic was taken, swapped or sold by an overlay running
   * over the map (see rewards.beltChanged). The merchant's tent draws its own
   * copy of the belt and re-renders it itself; out on the board the HUD is what
   * has to catch up, and refreshMap is the one call that re-lays it.
   */
  onBeltChanged() {
    if (this.shopBeltRefresh) this.shopBeltRefresh();
    else this.refreshMap();
  }

  // ---------------- Selling a relic (map only — never mid-fight) ----------------

  /**
   * A relic is worth a quarter of its mat price on the way out. Small confirm
   * over the belt: no misclick should ever cost a Legendary. Selling re-lays the
   * belt through refreshMap, which is also what re-resolves the mirrors — a
   * Forgery left pointing at empty air quietly becomes a Forgery pointing at
   * whatever slid left into that slot.
   */
  sellPrompt(art, { after = null } = {}) {
    if (this.sellOv) { this.sellOv.destroy(true); this.sellOv = null; }
    const paid = sellValue(art);
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay + 6);
    this.sellOv = ov;
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.55).setInteractive();
    dim.on('pointerdown', () => close());
    ov.add(dim);

    const cx = GAME_W / 2, cy = GAME_H / 2;
    const w = 620, h = 306;   // tall enough that the buttons clear the bottom lip
    const parts = woodPanel(this, cx, cy, w, h, { accent: ARTIFACT_RARITY[art.rarity].color, shadow: true });
    ov.add([parts.shadow, parts.panel, parts.line]);
    ov.add(addArtifactIcon(this, cx - 222, cy - 28, art, 104));
    ov.add(this.add.text(cx + 44, cy - 96, art.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px', color: PARCH.text,
      wordWrap: { width: 330 }, align: 'center',
    }).setOrigin(0.5, 0));
    // The tier, spelled out — a HERO EXCLUSIVE cycles the rainbow here too, so
    // nobody sells one thinking it was a Legendary they can re-roll into.
    const rar = ARTIFACT_RARITY[art.rarity];
    if (rar) {
      const rarText = this.add.text(cx + 44, cy - 126, rar.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
        color: '#' + rar.color.toString(16).padStart(6, '0'), stroke: '#241505', strokeThickness: 4,
      }).setOrigin(0.5, 0);
      if (rar.rainbow) rainbowText(this, rarText);
      ov.add(rarText);
    }
    // Gold keeps its meaning (it is a price) but takes the outline the rarity
    // label above it already had: #ffc542 on the panel's cream is 1.25:1, which
    // is not dim, it is gone.
    ov.add(legible(this.add.text(cx + 44, cy - 26, `Sell it for  ◉ ${paid}?`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: '#ffc542',
    }), { shadow: false }).setOrigin(0.5, 0));
    // ...and the warning under it goes to parchment ink. A warm grey was never
    // going to read on a warm cream panel, and no stroke fixes a wrong colour.
    ov.add(this.add.text(cx + 44, cy + 10, 'Relics never come back.', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: PARCH.textDim, fontStyle: 'bold',
    }).setOrigin(0.5, 0));

    const close = () => { if (this.sellOv) { this.sellOv.destroy(true); this.sellOv = null; } };
    // A matched pair: both plates take the WIDER of the two labels, so SELL and
    // KEEP read as one decision rather than two differently-sized offers.
    const pairW = fitWidth(
      this.measure(`SELL  ◉ ${paid}`, { fontFamily: 'Lilita One', resolution: 2, fontSize: '24px' }),
      { pad: 56, min: 170, max: 280 });
    const btn = (x, key, label, color, onClick) => {
      const img = this.add.image(x, cy + 96, key).setDisplaySize(pairW, 60).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, cy + 93, label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color,
      }).setOrigin(0.5);
      ov.add([img, txt]);
      img.on('pointerdown', () => { sfx(this, 'button', { volume: 0.8 }); onClick(); });
      return img;
    };
    btn(cx - pairW / 2 - 18, 'btn_yellow', `SELL  ◉ ${paid}`, '#5b3a00', () => {
      // PAWNBROKER counts every sale (banked inside sellArtifact, the only door
      // a relic leaves through). BUYER'S REMORSE asks the narrower question, and
      // the answer is only ever yes while you are still standing at the table
      // you bought it at: _boughtThisVisit is torn down when the tent closes.
      const regret = this._boughtThisVisit?.has(art.id) === true;
      const got = sellArtifact(art);
      close();
      fireAchievements(this, 'sell', { run, boughtThisVisit: regret });
      sfx(this, 'chips_stack', { volume: 0.9 });
      popMessage(this, GAME_W / 2, GAME_H / 2, `+${got} chips`, { color: '#ffc542', size: 44, rise: 70 });
      // `after` = the caller repaints itself in place (the merchant's tent, so
      // selling inside the shop doesn't tear the shop down). Without it the
      // whole map re-lays, which is what the belt out on the board wants.
      if (after) this.time.delayedCall(500, after);
      else this.time.delayedCall(800, () => this.refreshMap());
    });
    btn(cx + pairW / 2 + 18, 'btn_dark', 'KEEP', '#cfc8e8', close);
    ov.setAlpha(0);
    this.tweens.add({ targets: ov, alpha: 1, duration: 140 });
  }

  // ---------------- Rooms: EVENT ----------------

  /**
   * Paper grain for the event canvas — the same sparse fleck/fibre/pulp recipe
   * the combat sidebar uses, generated locally so the map owes CombatScene
   * nothing. Drawn once and reused; the scene is restarted constantly.
   */
  ensurePaperTexture() {
    if (this.textures.exists('map_paper')) return;
    const S = 200;
    const p = this.make.graphics({ x: 0, y: 0 }, false);
    for (let i = 0; i < 520; i++) {                 // flecks, two parchment tones
      const light = i % 3 === 0;
      p.fillStyle(light ? 0xf6e8c8 : 0xcbb083, light ? 0.16 : 0.14);
      const w = Math.random() < 0.7 ? 1 : 2;
      p.fillRect(Math.floor(Math.random() * S), Math.floor(Math.random() * S), w, w);
    }
    for (let i = 0; i < 24; i++) {                  // long fibres, kept off the
      const len = 24 + Math.random() * 70;          // seams so the repeat hides
      p.fillStyle(i % 2 ? 0xcbb083 : 0xf6e8c8, 0.09);
      p.fillRect(8 + Math.random() * (S - len - 16), Math.floor(Math.random() * S), len, 1);
    }
    for (let c = 0; c < 18; c++) {                  // pulp specks, clustered
      const cx = 8 + Math.random() * (S - 16), cy = 8 + Math.random() * (S - 16);
      p.fillStyle(0xbfa273, 0.13);
      for (let k = 0; k < 5; k++) p.fillRect(cx + (Math.random() - 0.5) * 10, cy + (Math.random() - 0.5) * 10, 1, 1);
    }
    p.generateTexture('map_paper', S, S);
    p.destroy();
  }

  /**
   * The speaking panel: Caleb's wood frame, its beige canvas field dressed with
   * paper grain. Sized by its caller to whatever it has to hold. Returns the
   * pieces in draw order — add them to a container yourself.
   */
  canvasPanel(x, y, w, h, accent) {
    this.ensurePaperTexture();
    const parts = woodPanel(this, x, y, w, h, { accent, shadow: true });
    // The nineslice's parchment field starts 14px inside the frame at every
    // size (corner region is 1:1), so the grain sits comfortably at 20.
    const grain = this.add.tileSprite(x, y, w - 40, h - 40, 'map_paper').setAlpha(0.55);
    grain.tilePositionX = Math.random() * 200;
    grain.tilePositionY = Math.random() * 200;
    return [parts.shadow, parts.panel, grain, parts.line];
  }

  /**
   * AMBIENT MOTES over the painting — 6-10 soft drifting lights, tinted to the
   * event's own weather: warm for anything with a fire in it, cool for the ice,
   * green for the woods, violet for sorcery. Subtle by construction; they read
   * as air, never as particles.
   */
  eventMotes(layer, ev) {
    const MOTES = {
      crimsonForge: { tint: 0xff5a2a, key: 'fx_dust' },   // the mythic forge burns RED
      travelingSmith: { tint: 0xffa040, key: 'fx_dust' },
      bloodAltar: { tint: 0xff4a58, key: 'fx_dust' },
      chest: { tint: 0xffd06a, key: 'fx_dust' },
      cache: { tint: 0xd8a060, key: 'fx_dust' },
      tinker: { tint: 0xe0c080, key: 'fx_dust' },
      frozenTraveler: { tint: 0xa8e4ff, key: 'fx_glow' },
      tollBridge: { tint: 0x9ab4d8, key: 'fx_glow' },
      sharper: { tint: 0xdfe4f0, key: 'fx_glow' },
      cursedWell: { tint: 0x6ad8c0, key: 'fx_glow' },
      shrine: { tint: 0x8fd070, key: 'fx_glow' },         // the woods reclaim it
      witchHut: { tint: 0xb478ff, key: 'fx_glow' },
      echoCavern: { tint: 0x9a7cff, key: 'fx_glow' },
      gambler: { tint: 0xff7a9a, key: 'fx_glow' },
    };
    const biome = {
      forest: 0x8fd070, snow: 0xa8e4ff, abyss: 0xff8c50,
      nightwood: 0x9ad4ff, motes: 0xdfe4f0, ash: 0xff7a40,
    }[this.act.ambience] ?? 0xe0c080;
    // Anything mythic that hasn't claimed a colour of its own drifts violet.
    const spec = MOTES[ev.id] ?? { tint: ev.mythic ? 0xc060ff : biome, key: 'fx_glow' };
    const n = Phaser.Math.Between(6, 10);
    for (let i = 0; i < n; i++) {
      const m = this.add.image(
        Phaser.Math.Between(120, GAME_W - 120),
        Phaser.Math.Between(90, GAME_H - 260),
        spec.key,
      ).setTint(spec.tint).setBlendMode(Phaser.BlendModes.ADD)
        .setScale(Phaser.Math.FloatBetween(0.18, 0.5)).setAlpha(0);
      layer.add(m);
      const hi = Phaser.Math.FloatBetween(0.10, 0.20);
      this.tweens.add({ targets: m, alpha: hi, duration: 1200, delay: 260 + i * 90 });
      this.tweens.add({
        targets: m, y: m.y - Phaser.Math.Between(70, 150), x: m.x + Phaser.Math.Between(-60, 60),
        duration: Phaser.Math.Between(7000, 12000), yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: i * 240,
      });
      this.tweens.add({
        targets: m, alpha: hi * 0.35, duration: Phaser.Math.Between(2200, 4200),
        yoyo: true, repeat: -1, delay: 1400 + i * 180, ease: 'Sine.easeInOut',
      });
    }
  }

  /**
   * THE EVENT ROOM — a full-screen painting you stand inside, with the wood and
   * canvas panel doing the talking underneath it (JC, 2026-07-31: events get
   * the plate BACK; only the map's own HUD is allowed over the art).
   *
   * Two layers: the painting sits BELOW the fixed HUD so the act banner, hero
   * capsule and relic belt stay legible over it; the panel and its choices sit
   * above everything. The result screen re-uses the same living painting, so
   * the room never blinks between the question and the answer.
   */
  runEvent(node) {
    this.hideTip();
    const ev = rollEvent(run, node);
    // YOU WERE HERE (2026-08-04). Two packs are locked behind meeting a room:
    // THE DEALER behind the Traveling Casino, the FORGE behind pulling a
    // mythical out of the Crimson Forge. This is the arrival half — walking in
    // is the whole ask for the casino, and the forge's second condition is
    // fired below, when the fire actually gives something up.
    fireAchievements(this, 'visit', { eventId: ev.id, run });
    /**
     * THE PAINTING, FETCHED ON ENTRY. Fifteen backdrops at 5 MB each; you meet
     * one room at a time and most runs never see half of them.
     *
     * The ROLL happens above the gate on purpose — `rollEvent` writes to
     * `run.seenEvents` and the gate has to know WHICH painting to ask for, so
     * rolling inside it would either roll twice or ask for the wrong file. The
     * rest of the room is unchanged and still reads `textures.exists(evbg_…)`:
     * several of these have never been painted, and the wood panel fallback is
     * the feature, not a failure.
     */
    gateOn(this, eventBg(ev.id), () => this.buildEvent(ev),
      { label: ev.name, ensure, missingKeys });
  }

  buildEvent(ev) {
    // ---- Layer 1: the painting (under the HUD at DEPTH.overlay - 1) --------
    const art = this.add.container(0, 0).setDepth(DEPTH.overlay - 2);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0810, 0).setInteractive();
    art.add(dim);
    this.tweens.add({ targets: dim, fillAlpha: 0.9, duration: 180 });   // the quick dim

    const evbgKey = 'evbg_' + ev.id;
    const themed = this.textures.exists(evbgKey);
    const kb = { k: 1.06 };                         // entry + Ken Burns driver
    if (themed) {
      const src = this.textures.get(evbgKey).getSourceImage();
      const cover = Math.max(GAME_W / (src.width || 1536), GAME_H / (src.height || 864));
      const painting = this.add.image(GAME_W / 2, GAME_H / 2, evbgKey).setAlpha(0);
      const apply = () => painting.setScale(cover * kb.k);
      apply();
      art.add(painting);
      // ENTRY: it settles in — a fast fade over a slow, decelerating push-in.
      this.tweens.add({ targets: painting, alpha: 1, duration: 260 });
      this.tweens.add({
        targets: kb, k: 1, duration: 700, ease: 'Cubic.easeOut', onUpdate: apply,
        onComplete: () => {
          // LIVING PAINTING: it never quite holds still again.
          this.tweens.add({
            targets: kb, k: 1.045, duration: 14000, yoyo: true, repeat: -1,
            ease: 'Sine.easeInOut', onUpdate: apply,
          });
        },
      });
      this.eventMotes(art, ev);
    }
    if (ev.mythic) {
      const redGlow = this.add.image(GAME_W / 2, GAME_H / 2, 'fx_glow_circle')
        .setTint(0xe03040).setScale(3).setAlpha(0.2).setBlendMode(Phaser.BlendModes.ADD);
      art.add(redGlow);
      this.tweens.add({ targets: redGlow, alpha: 0.45, duration: 900, yoyo: true, repeat: -1 });
      suspense(this, { volume: 0.75 });
    }
    // Everything the painting spawned dies with it — no tween outlives its target.
    this.mapHint?.setVisible(false);
    art.once('destroy', () => {
      this.tweens.killTweensOf(kb);
      this.mapHint?.setVisible(true);
    });

    // ---- Layer 2: the panel + the choices ---------------------------------
    const accent = ev.mythic ? 0xe03040 : 0x8a6a3c;
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay);

    const title = this.add.text(0, 0, ev.name, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '44px',
      color: ev.mythic ? '#c02030' : PARCH.text,
    }).setOrigin(0.5, 0);
    const flavor = this.add.text(0, 0, ev.flavor, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '23px', color: PARCH.textDim,
      fontStyle: 'bold', wordWrap: { width: 840 }, align: 'center', lineSpacing: 2,
    }).setOrigin(0.5, 0);

    // Every choice wears its own name: the plate is the label's width plus a
    // thumb of padding, never a 620px slab behind the word 'Leave'.
    const rows = ev.choices.map((choice) => {
      const label = this.add.text(0, 0, choice.labelOf ? choice.labelOf(run) : choice.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '25px', color: '#5b3a00',
      }).setOrigin(0.5);
      // TRANSFORMATION TRANSPARENCY: a choice that touches a card RELATIVE to
      // your deck ('your highest', 'your lowest') resolves it here, at offer
      // time, and its hint names the actual card. hintOf(run) is read-only.
      const hintText = choice.hintOf ? choice.hintOf(run) : choice.hint;
      const hint = hintText ? this.add.text(0, 0, hintText, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '18px', color: '#7a5a20', fontStyle: 'bold',
        align: 'center', lineSpacing: 1,
      }).setOrigin(0.5) : null;
      // A HINT THAT TAKES TWO LINES NEEDS TWO LINES OF PLATE (2026-08-03). The
      // row was a fixed 68 and every hint in the game happened to be one line,
      // so a Traveling Casino choice ("what it pays" AND "what you may stake")
      // printed its second line off the bottom edge of its own button. A single
      // line still measures under 30 and still gets exactly 68, so nothing that
      // shipped before this moves by a pixel.
      const h = hint && hint.height > 30 ? Math.round(46 + hint.height) : 68;
      return { choice, label, hint, w: fitWidth([label, hint]), h };
    });

    // Measure, then place: the panel is exactly as tall and wide as it needs.
    const ROW_GAP_Y = 14;
    const bodyH = rows.reduce((s, r) => s + r.h + ROW_GAP_Y, 0) - ROW_GAP_Y;
    const panelH = 30 + title.height + 12 + flavor.height + 26 + bodyH + 28;
    const panelW = Phaser.Math.Clamp(
      Math.max(title.width, flavor.width, ...rows.map(r => r.w)) + 96, 720, 1160);
    const panelCY = GAME_H - 26 - panelH / 2;       // lower-centre: the art breathes above
    const top = panelCY - panelH / 2;

    const panel = this.add.container(GAME_W / 2, 0);
    panel.add(this.canvasPanel(0, panelCY, panelW, panelH, accent));
    title.setPosition(0, top + 30);
    flavor.setPosition(0, top + 30 + title.height + 12);
    panel.add([title, flavor]);

    // The sigil floats free ABOVE the panel, on the painting, with a cast copy
    // pinning it to the scene.
    // (Container-local coordinates — a container scaled from 0 pulls its
    // children toward its OWN origin, so the sigil must live at 0,0 inside it.)
    const icon = this.add.image(0, 0, ev.icon).setTint(ev.tint);
    icon.setScale(84 / Math.max(icon.width, icon.height));
    const iconShadow = dropShadow(this, icon, { dx: 6, dy: 8, alpha: 0.42 });
    // A painted room is busy; without a pool of its own light behind it the
    // sigil disappears into the scenery it is supposed to name.
    const sigilGlow = this.add.image(0, 0, 'fx_glow_circle').setTint(ev.tint)
      .setAlpha(0.34).setDisplaySize(230, 230).setBlendMode(Phaser.BlendModes.ADD);
    const sigil = this.add.container(GAME_W / 2, top - 62).setScale(0);
    sigil.add([sigilGlow, iconShadow, icon]);
    ov.add(sigil);
    this.tweens.add({ targets: sigilGlow, alpha: 0.6, duration: 1500, yoyo: true, repeat: -1, delay: 760, ease: 'Sine.easeInOut' });

    const finish = (outcome) => {
      // THE FIRE GAVE SOMETHING UP. Delayed so the trophy lands ON the ceremony
      // rather than under the panel that is still closing, and fired here rather
      // than in the ceremony's callback because that callback ends in
      // refreshMap(), which restarts the scene and would take the toast with it.
      if (outcome.mythical) {
        this.time.delayedCall(600, () =>
          fireAchievements(this, 'visit', { eventId: ev.id, mythical: outcome.mythical, run }));
      }
      // THE TRAVELING CASINO takes the whole room rather than printing a line:
      // the outcome of "I will play blackjack" is the game itself, not a
      // sentence about it. The painting leaves with the panel, because the
      // table brings its own room.
      if (outcome.casino) {
        ov.destroy(true);
        art.destroy(true);
        return casinoOverlay(this, run, outcome.casino, () => this.refreshMap());
      }
      const closeout = () => {
        art.destroy(true);   // the painting leaves before any ceremony arrives
        if (outcome.mythical) return artifactCeremony(this, run, outcome.mythical, () => this.refreshMap());
        // A relic you PAID for and then declined has to give the chips back:
        // the ceremony's LEAVE IT is a real answer, and an event that charged
        // up front (the Wandering Tinker's 50) has to honour it.
        if (outcome.artifact) {
          return artifactCeremony(this, run, outcome.artifact, (taken) => {
            if (!taken && outcome.refund) {
              run.chips += outcome.refund;
              popMessage(this, GAME_W / 2, GAME_H / 2, `He shrugs and gives the ${outcome.refund} back.`,
                { color: '#ffd23e', size: 28, rise: 50 });
            }
            this.refreshMap();
          });
        }
        if (outcome.reforge) {
          return artifactPickerOverlay(this, run, {}, (a) =>
            (a ? artifactCeremony(this, run, a, () => this.refreshMap()) : this.refreshMap()));
        }
        if (outcome.pack) {
          const { pack, options } = openPack(outcome.pack, run, getProp(effectiveArtifacts(), 'packExtra'));
          return packOpenOverlay(this, run, pack, options, () => this.refreshMap());
        }
        this.refreshMap();
      };
      ov.destroy(true);      // the panel is replaced; the painting stays put

      // The answer, on the same canvas over the same living painting.
      const res = this.add.container(0, 0).setDepth(DEPTH.overlay);
      const body = this.add.text(0, 0, outcome.text, {
        fontFamily: '"Baloo 2"', resolution: 2, fontSize: '27px', color: PARCH.text,
        fontStyle: 'bold', wordWrap: { width: 760 }, align: 'center', lineSpacing: 3,
      }).setOrigin(0.5, 0);
      const onwardLabel = this.add.text(0, 0, 'ONWARD', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '27px', color: '#5b3a00',
      }).setOrigin(0.5);
      const rw = Phaser.Math.Clamp(Math.max(body.width, 300) + 110, 620, 1000);
      const rh = 34 + body.height + 30 + 70 + 30;
      const rcy = GAME_H - 26 - rh / 2;
      const rtop = rcy - rh / 2;
      const rp = this.add.container(GAME_W / 2, 0);
      rp.add(this.canvasPanel(0, rcy, rw, rh, outcome.good ? 0x5aa860 : 0x8a6a3c));
      body.setPosition(0, rtop + 34);
      rp.add(body);
      // ONWARD is a six-letter word — it gets a six-letter button.
      const btn = this.add.image(0, rtop + 34 + body.height + 30 + 35, 'btn_yellow')
        .setDisplaySize(fitWidth(onwardLabel), 70).setInteractive({ useHandCursor: true });
      onwardLabel.setPosition(0, btn.y - 4);
      rp.add([btn, onwardLabel]);
      res.add(rp);
      // The choice screen carried a deck button and was destroyed with it, so
      // the outcome screen re-hangs one: an event that just rewrote the deck is
      // exactly when you want to look at it.
      viewDeckButton(this, res, run);
      sfx(this, outcome.good ? 'take' : 'button', { volume: 0.8 });
      rp.setAlpha(0).setY(26);
      this.tweens.add({ targets: rp, alpha: 1, y: 0, duration: 260, ease: 'Cubic.easeOut' });
      btn.on('pointerdown', () => { sfx(this, 'button', { volume: 0.8 }); res.destroy(true); closeout(); });
    };

    let y = top + 30 + title.height + 12 + flavor.height + 26;
    rows.forEach((row, i) => {
      const cy = y + row.h / 2;
      const btn = this.add.image(0, cy, 'btn_yellow')
        .setDisplaySize(row.w, row.h).setInteractive({ useHandCursor: true });
      // Label and hint are STACKED and centred in the plate, measured rather
      // than offset by hand, so a two line hint sits inside the button instead
      // of hanging off it. A one line hint lands within a pixel of the old
      // -12 / +17 it was hard coded to.
      if (row.hint) {
        const contentH = row.label.height + 2 + row.hint.height;
        const contentTop = cy - contentH / 2;
        row.label.setPosition(0, contentTop + row.label.height / 2);
        row.hint.setPosition(0, contentTop + row.label.height + 2 + row.hint.height / 2);
      } else {
        row.label.setPosition(0, cy - 3);
      }
      panel.add([btn, row.label]);
      if (row.hint) panel.add(row.hint);
      // Hover puffs the plate — and lets go back to ITS OWN width, not a
      // hard-coded one (that stale 620 was a real bug waiting to happen).
      btn.on('pointerover', () => this.tweens.add({ targets: btn, displayWidth: row.w * 1.03, displayHeight: row.h * 1.06, duration: 100 }));
      btn.on('pointerout', () => this.tweens.add({ targets: btn, displayWidth: row.w, displayHeight: row.h, duration: 100 }));
      btn.on('pointerdown', () => {
        sfx(this, 'button', { volume: 0.8 });
        finish(row.choice.resolve(run));
      });
      y += row.h + ROW_GAP_Y;
    });

    ov.add(panel);
    // CASCADE: the painting settles first, then the sigil pops and the panel
    // slides up under it.
    panel.setAlpha(0).setY(40);
    this.tweens.add({ targets: panel, alpha: 1, y: 0, duration: 320, delay: 380, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: sigil, scale: 1, duration: 340, delay: 380, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: [iconShadow, icon], scale: icon.scale * 1.1, duration: 1400,
      yoyo: true, repeat: -1, delay: 760, ease: 'Sine.easeInOut',
    });

    // Bottom-left, clear of the panel: know your deck before you gamble it (JC).
    viewDeckButton(this, ov, run);
  }

  // ---------------- Rooms: REST ----------------

  runRest() {
    this.hideTip();
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay);
    ov.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.85).setInteractive());

    // The campfire: painted fire + warm breathing glow + spark motes. The art
    // is a 512px square with generous margin, so it's sized by DISPLAY box
    // (never a raw setScale — that's what made the old 52x64 glyph fit).
    const glow = this.add.image(GAME_W / 2, GAME_H / 2 - 165, 'fx_glow')
      .setTint(0xff9a40).setScale(4.0).setAlpha(0.3).setBlendMode(Phaser.BlendModes.ADD);
    ov.add(glow);
    this.tweens.add({ targets: glow, alpha: 0.48, scale: 4.5, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const fire = this.add.image(GAME_W / 2, GAME_H / 2 - 140, 'icon_campfire');
    const fireBase = 460 / Math.max(fire.width, fire.height);
    fire.setScale(fireBase);
    ov.add(fire);
    this.tweens.add({
      targets: fire, scaleY: fireBase * 1.055, scaleX: fireBase * 0.965,
      duration: 340, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.restSparks = this.time.addEvent({
      delay: 260, loop: true,
      callback: () => {
        if (!ov.active) { this.restSparks.remove(); return; }
        const s = this.add.image(GAME_W / 2 + Phaser.Math.Between(-52, 52), GAME_H / 2 - 288, 'fx_dust')
          .setTint(0xffb050).setScale(0.12).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.overlay + 1);
        this.tweens.add({
          targets: s, y: s.y - Phaser.Math.Between(90, 170), x: s.x + Phaser.Math.Between(-24, 24),
          alpha: 0, duration: 1400, onComplete: () => s.destroy(),
        });
      },
    });

    ov.add(this.add.text(GAME_W / 2, GAME_H / 2 - 330, 'REST SITE', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '54px', color: '#ffc542', stroke: '#241505', strokeThickness: 10,
    }).setOrigin(0.5));
    // Sits on the campfire art and its additive bloom, the brightest and most
    // animated patch on the screen. The title above it was stroked; this was not.
    ov.add(legible(this.add.text(GAME_W / 2, GAME_H / 2 - 272, 'The fire crackles. For a moment, nothing is hunting you.', {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: '#d8c9a8', fontStyle: 'bold',
    })).setOrigin(0.5));

    const heal = Math.round(run.player.maxHp * 0.3);
    const options = [
      {
        label: 'REST', desc: `Sleep by the fire. Heal ${heal} HP.`, icon: 'icon_heart_small', tint: 0xe0434f,
        act: (done) => {
          run.player.hp = Math.min(run.player.maxHp, run.player.hp + heal);
          sfx(this, 'heal', { volume: 0.9 });
          popMessage(this, GAME_W / 2, GAME_H / 2 - 120, `+${heal} HP`, { color: '#50e090', size: 44 });
          this.time.delayedCall(800, done);
        },
      },
      {
        label: 'HONE', desc: 'Sharpen a chosen card: +2 rank (up to Ace)', icon: 'icon_sword_small', tint: 0x8898b8,
        act: (done) => {
          // optional: the picker's CONFIRM works with nothing chosen, so
          // opening HONE by mistake is no longer a one-way door.
          deckPickerOverlay(this, run, { count: 1, optional: true, title: 'Hone which card?' }, (cards) => {
            if (cards[0]) {
              cards[0].rank = Math.min(14, cards[0].rank + 2);
              sfx(this, 'purchase_upgrade', { volume: 0.85 });
            }
            done();
          });
        },
      },
      {
        label: 'PURGE', desc: 'Burn a chosen card out of your deck', icon: 'icon_fire', tint: 0xe06828,
        act: (done) => {
          deckPickerOverlay(this, run, { count: 1, optional: true, title: 'Burn which card?' }, (cards) => {
            if (cards[0]) {
              run.runDeck.splice(run.runDeck.indexOf(cards[0]), 1);
              sfx(this, 'poison', { volume: 0.8 });
            }
            done();
          });
        },
      },
    ];

    // Measure first: the three cards share ONE size (a row of options must read
    // as a row), but that size comes from the longest description, not from a
    // number typed in 2026.
    const descs = options.map(opt => this.add.text(0, 0, opt.desc, {
      fontFamily: '"Baloo 2"', resolution: 2, fontSize: '21px', color: PARCH.textDim, fontStyle: 'bold',
      wordWrap: { width: 280 }, align: 'center',
    }).setOrigin(0.5));
    const cardW = Phaser.Math.Clamp(
      Math.max(...descs.map(d => d.width), ...options.map(o => this.measure(o.label,
        { fontFamily: 'Lilita One', resolution: 2, fontSize: '31px' }))) + 56, 260, 360);
    // 26 pad + 52 icon + 22 + 40 label + 14 + desc + 26 pad
    const cardH = 180 + Math.max(...descs.map(d => d.height));

    options.forEach((opt, i) => {
      const x = GAME_W / 2 + (i - 1) * (cardW + 40);
      const card = this.add.container(x, GAME_H / 2 + 170);
      const parts = woodPanel(this, 0, 0, cardW, cardH, { accent: opt.tint });
      card.add([parts.shadow, parts.panel, parts.line]);
      const top = -cardH / 2;
      const icon = this.add.image(0, top + 26 + 26, opt.icon).setTint(opt.tint);
      icon.setScale(52 / Math.max(icon.width, icon.height));
      card.add(contactPool(this, 2, icon.y + 26, 66, { alpha: 0.28 }));   // grounded on the parchment
      card.add(icon);
      card.add(this.add.text(0, top + 26 + 52 + 22 + 20, opt.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '31px', color: PARCH.text,
      }).setOrigin(0.5));
      descs[i].setPosition(0, top + 26 + 52 + 22 + 40 + 14 + descs[i].height / 2);
      card.add(descs[i]);
      ov.add(card);
      parts.panel.setInteractive({ useHandCursor: true });
      parts.panel.on('pointerover', () => this.tweens.add({ targets: card, scale: 1.06, duration: 110 }));
      parts.panel.on('pointerout', () => this.tweens.add({ targets: card, scale: 1, duration: 110 }));
      parts.panel.on('pointerdown', () => {
        ov.destroy(true);
        opt.act(() => this.refreshMap());
      });
    });

    // Every choice surface carries its decline on its FIRST screen (JC,
    // 2026-08-01). The campfire had none: three cards, all of them commit, and
    // HONE's picker is not optional — opening it was a one-way door.
    const skipTxt = this.add.text(GAME_W / 2, GAME_H - 62, 'MOVE ON', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '26px', color: '#a898c4',
    }).setOrigin(0.5);
    const skipBtn = this.add.image(GAME_W / 2, GAME_H - 59, 'btn_dark')
      .setDisplaySize(fitWidth(skipTxt, { min: 250, max: 320 }), 56)
      .setInteractive({ useHandCursor: true });
    ov.add(skipBtn); ov.add(skipTxt);
    // HONE and PURGE both open the deck picker, so being able to read the deck
    // before choosing between them is the missing half of the decision.
    viewDeckButton(this, ov, run);
    skipBtn.on('pointerover', () => sfx(this, 'menu_select', { volume: 0.25, jitter: 0.06 }));
    skipBtn.on('pointerdown', () => {
      sfx(this, 'button', { volume: 0.8 });
      ov.destroy(true);
      this.refreshMap();
    });
  }

  // ---------------- Rooms: SHOP ----------------

  /** A spinning-coin wipe into the merchant's tent. */
  coinTransition(onMid) {
    // THE 480ms LEAD. This wipe exists to cover the moment the tent is built,
    // and it now covers the moment the tent is FETCHED as well: the merchant's
    // table is an 18.5 MB painting for a room you meet once or twice an act, so
    // it left the boot set. Kicking it here rather than in runShop() means the
    // gate down there is almost always already satisfied.
    ensure(this, [MERCHANT_BG]);
    const t = this.add.container(0, 0).setDepth(DEPTH.overlay + 8);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0).setInteractive();
    t.add(dim);
    const glow = this.add.image(GAME_W / 2, GAME_H / 2, 'fx_glow_circle')
      .setTint(0xffd23e).setScale(0).setAlpha(0.7).setBlendMode(Phaser.BlendModes.ADD);
    // Caleb's flat gold chip, at the same on-screen size the old 64px coin
    // icon drew (K = 64/256) — every scale below is the original × K, so the
    // tumble reads exactly as before, just four times the detail.
    const K = 0.25;
    const coin = this.add.image(GAME_W / 2, GAME_H / 2, 'chip_flat').setScale(0.2 * K);
    t.add(glow); t.add(coin);
    sfx(this, 'chips_stack', { volume: 0.9 });
    this.tweens.add({ targets: dim, fillAlpha: 1, duration: 420, ease: 'Sine.easeIn' });
    this.tweens.add({ targets: glow, scale: 3.4, duration: 460, ease: 'Sine.easeIn' });
    // The tumble: it grows and turns while its face squashes edge-on and back,
    // two and a half flips that LAND face-up. (One driver, not two tweens
    // fighting over scaleX — that fight kept the old coin permanently edge-on,
    // which mattered less when it was a 64px glyph than it does now.)
    const spin = { p: 0 };
    this.tweens.add({
      targets: spin, p: 1, duration: 460, ease: 'Sine.easeIn',
      onUpdate: () => {
        const s = (0.2 + 4 * spin.p) * K;
        coin.setScale(Math.max(0.05, Math.abs(Math.cos(spin.p * Math.PI * 5))) * s, s);
        coin.setAngle(40 * spin.p);
      },
    });
    this.time.delayedCall(480, () => {
      onMid();                                    // build the shop underneath
      sfxCapped(this, 'buy', { volume: 0.8 }, 600);
      this.tweens.add({ targets: [coin, glow], scale: 0, alpha: 0, angle: '+=120', duration: 340, ease: 'Back.easeIn' });
      this.tweens.add({
        targets: dim, fillAlpha: 0, duration: 420, delay: 120,
        onComplete: () => t.destroy(true),
      });
    });
  }

  /** THE MERCHANT — artifacts laid out on the mat, prices hanging over each. */
  runShop() {
    this.hideTip();
    // His table is deferred art (see coinTransition, which gives it a 480ms
    // head start). `__hf.openShop()` and the bounty's BOOKED MERCHANT both come
    // in without that lead, which is exactly why the gate is here too.
    gateOn(this, [MERCHANT_BG], () => this.buildShop(), { ensure, missingKeys, label: 'The Merchant' });
  }

  buildShop() {
    // WINDOW SHOPPING (achievement): this is the only line in the game that
    // knows you walked up to his table, and it also sweeps the state trophies
    // that a shopping trip is most likely to have just earned (a full belt, a
    // full relic row). One call, both jobs.
    fireAchievements(this, 'shop', { run });
    playMusic(this, 'shop');
    const ov = this.add.container(0, 0).setDepth(DEPTH.overlay);

    // His table (cover-fit at 1920 wide; the red mat spans ~x260-1670, y130-1070).
    const bg = this.add.image(GAME_W / 2, GAME_H / 2, 'bg_merchant');
    bg.setScale(Math.max(GAME_W / bg.width, GAME_H / bg.height));
    bg.setInteractive();   // swallow map clicks
    ov.add(bg);
    // THE MERCHANT was the overlay JC named first (PATCH 0803-B §4.3): every
    // service on this table is a question about the deck — a booster to add to
    // it, a removal to take from it — and the map's own deck plate is buried
    // under this bg. Bottom-left, clear of the mat and of the service row.
    viewDeckButton(this, ov, run);

    // Hanging sign + purse.
    const sign = woodPanel(this, GAME_W / 2, 62, 520, 86, { accent: 0xffd23e });
    ov.add([sign.shadow, sign.panel, sign.line]);
    ov.add(this.add.text(GAME_W / 2, 46, 'THE MERCHANT', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '35px', color: PARCH.text,
    }).setOrigin(0.5));
    const chipsLabel = this.add.text(GAME_W / 2, 82, `◉ ${run.chips} chips`, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: PARCH.accent,
    }).setOrigin(0.5);
    ov.add(chipsLabel);
    const updateChips = () => chipsLabel.setText(`◉ ${run.chips} chips`);

    // The goods, resting on the mat — rebuilt by RESTOCK.
    const goods = this.add.container(0, 0);
    ov.add(goods);
    let restocks = 0;
    // ONE CARD REMOVAL PER SHOP VISIT (JC, 2026-08-02). The price ladder is
    // still run-long, so thinning stays expensive; this stops a single fat purse
    // from deleting half a deck at one table. Scoped to runShop(), so the next
    // tent starts fresh.
    let removedThisVisit = false;

    // SPREE / BUYER'S REMORSE. Both are questions about ONE VISIT, so both
    // ledgers open empty here and the relic set is torn down on the way out
    // (see leaveShop), so a sale from the map belt two rooms later is not
    // remorse, it is just a sale. Every paid thing on this table counts: the
    // relics, the potions, a booster pack and the removal service.
    run.counters.shopBuys = 0;
    this._boughtThisVisit = new Set();
    const noteBuy = (relicId = null) => {
      run.counters.shopBuys = (run.counters.shopBuys ?? 0) + 1;
      if (relicId) this._boughtThisVisit.add(relicId);
      fireAchievements(this, 'buy', { run });
    };
    const leaveShop = () => { this._boughtThisVisit = null; };

    // Free-floating price: no more black tag plate — big gold numerals with a
    // real drop shadow, hanging over the item (JC: de-diamond the merchant).
    // Live price tags. Drinking a PAYDAY BRINE on the mat changes what you can
    // afford, so the gold/grey has to be able to change its mind.
    const priceTags = [];
    const priceColor = (price) => (run.chips >= price ? '#ffd23e' : '#8a8078');
    const refreshPrices = () => {
      for (const tag of priceTags) {
        if (!tag.sold) tag.t.setColor(priceColor(tag.price));
      }
    };
    const makePrice = (price) => {
      const t = this.add.text(0, 0, `◉ ${price}`, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.shopPrice}px`,
        color: priceColor(price),
        stroke: '#241505', strokeThickness: 6,
      }).setOrigin(0.5);
      t.setShadow(0, 5, '#0c0804', 10, true, true);
      return t;
    };

    /**
     * One spot on the mat — shared by relics (row 1) and potions (row 2), and
     * therefore THE ONE COMMIT POINT for everything the merchant sells. Both
     * rows get their two-tap box from this single seam.
     *
     * `opts.key`     the box identity, so the two rows cannot collide.
     * `opts.refuse`  why the BUY plate is dead right now, as a sentence, or null.
     *                It is the caller's to answer because only the caller knows
     *                whether a full potion belt is a thing (relics have slots,
     *                and a full relic row is a SWAP, not a refusal).
     */
    const makeSpot = (x, y, icon, price, name, rar, iconH, onBuy, tipTitle, tipBody, opts = {}) => {
      const rarCss = '#' + rar.color.toString(16).padStart(6, '0');
      const spot = this.add.container(x, y);
      spot.add(this.add.image(0, iconH * 0.42, 'fx_glow').setTint(0x401010).setAlpha(0.45)
        .setDisplaySize(iconH + 10, Math.round(iconH * 0.3)));
      spot.add(icon);
      this.tweens.add({ targets: icon, y: -6, duration: 1700 + (x % 500), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const priceText = makePrice(price);
      priceText.setPosition(0, -(iconH / 2 + 34));
      spot.add(priceText);
      const tag = { t: priceText, price, sold: false };
      priceTags.push(tag);
      spot.add(this.add.text(0, iconH / 2 + 16, name, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.shopName}px`, color: '#fff2d8',
        stroke: '#241505', strokeThickness: 5, wordWrap: { width: 240 }, align: 'center',
      }).setOrigin(0.5, 0));
      const rarText = this.add.text(0, iconH / 2 + 48 + (name.length > 18 ? 26 : 0), rar.label, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.shopRarity}px`, color: rarCss, stroke: '#241505', strokeThickness: 4,
      }).setOrigin(0.5, 0);
      // HERO EXCLUSIVE burns through the whole spectrum on the mat.
      if (rar.rainbow) rainbowText(this, rarText);
      spot.add(rarText);
      goods.add(spot);

      // Potion icons come back as shadow CONTAINERS, relics as Images — the
      // helper gives each the right hit area.
      makePotionIconInteractive(icon, iconH);
      icon.on('pointerover', () => {
        sfx(this, 'menu_select', { volume: 0.25, jitter: 0.06 });
        this.tweens.add({ targets: spot, scale: 1.08, duration: 110 });
        this.showTip(x, y - iconH / 2 - 64, tipTitle, tipBody, 0.5, !!rar.rainbow);
      });
      icon.on('pointerout', () => { this.hideTip(); this.tweens.add({ targets: spot, scale: 1, duration: 110 }); });
      const commitBuy = () => {
        const fail = (msg) => {
          this.tweens.add({ targets: spot, x: x + 8, duration: 50, yoyo: true, repeat: 2 });
          popMessage(this, x, y - iconH / 2 - 20, msg, { color: '#ff6a76', size: 26 });
        };
        // THE CHARGE IS A SEPARATE ACT FROM THE DECISION TO OPEN THE GOODS.
        //
        // `onBuy` returning true used to MEAN "sold", which was true while
        // everything on this mat resolved on the click. It stopped being true
        // when artifactCeremony grew LEAVE IT / NEVER MIND: a relic's onBuy
        // returns as soon as the ceremony is on screen, so the chips came off
        // the purse and the slot said SOLD while the player was still being
        // asked whether they wanted it — and declining refunded nothing.
        //
        // So a spot may now answer 'defer' and settle itself later. Everything
        // that resolves on the click (the potions) is unchanged: it returns
        // true and settles here, exactly as before.
        const settle = () => {
          this.hideTip();
          run.chips -= price;
          updateChips();
          sfx(this, 'purchase_upgrade', { volume: 0.85 });
          tag.sold = true;
          priceText.setText('SOLD').setColor('#5aa860');
          refreshPrices();
          icon.disableInteractive();
          this.tweens.add({ targets: spot, alpha: 0.4, duration: 200 });
        };
        const verdict = onBuy(fail, settle);
        if (verdict === 'defer' || !verdict) return;
        settle();
      };
      /**
       * THE MERCHANT'S GOODS ARE ICONS WITH PRICES OVER THEM, which is exactly
       * the shape the two-tap rule was written for: what a relic DOES is not on
       * the mat, it is in a tooltip a finger cannot summon without covering it,
       * and the tap that revealed it also spent the chips.
       *
       * The box's plate calls the SAME closure the pointerdown called, so the
       * whole false/'defer'/truthy contract is untouched — a relic still defers
       * to its ceremony and charges nothing until LEAVE IT is not pressed, and a
       * potion still settles on the spot and lands on the belt to be drunk later
       * by a separate tap. Nothing about the buy-then-drink loop moves.
       */
      if (TOUCH) {
        twoTap(this, icon, {
          key: opts.key ?? `spot:${x},${y}`,
          anchor: { x, y, w: iconH, h: iconH },
          title: tipTitle,
          body: tipBody,
          // A DEAD BUTTON STILL DRAWS (choicebox's rule): "you cannot pay for
          // this" is information, and a missing plate is not.
          note: () => opts.refuse?.() ?? `He wants ◉ ${price} for it.`,
          accent: rar.color,
          owner: ov,
          guard: () => !tag.sold,
          buttons: () => [{
            label: `BUY ◉${price}`, kind: 'buy', onClick: commitBuy,
            enabled: !tag.sold && !opts.refuse?.(),
          }],
        });
      } else {
        icon.on('pointerdown', commitBuy);
      }
      return spot;
    };

    // Two rows: 2 relics up top, 3 potions on the lower shelf.
    // 4 -> 2 RELICS (JC, 2026-08-02 nerf pass). Two items would rattle around a
    // four-slot mat, so the pair is laid out as its own deliberate row: wider
    // apart (SHOP_RELIC_GAP) and bigger (SHOP_RELIC_ICON) than the old four, so
    // the top shelf still reads as full and the relics still out-weigh the
    // potions under them.
    const SHOP_RELIC_ICON = 190;
    const SHOP_RELIC_GAP = 420;
    /** Widest the relic row may span, centre to centre, and still sit on the mat. */
    const SHOP_RELIC_ROW_W = 1100;
    /** ...and the shelf it stands on, named so the verification driver can tap
     *  the relic it means instead of keeping a copy of this number. */
    const SHOP_RELIC_ROW_Y = 372;
    const renderStock = () => {
      goods.removeAll(true);
      priceTags.length = 0;   // those Text objects just died with the goods

      // COLLECTOR'S KERCHIEF: one more relic on the mat, per copy held. THE
      // ORACLE'S COLLECTOR asks the merchant the same question from the other
      // direction, so it answers in the same line rather than growing a second.
      const stockCount = SHOP_RELIC_STOCK + getProp(effectiveArtifacts(), 'extraStock')
        + (run.oracleMods?.shopExtraStock ?? 0);
      const stock = rollShopStock(run.artifacts.map(a => a.id), stockCount, Math.random, run.chrId, run.actIndex);
      // What is actually ON the mat, for the verification runs — counting art
      // images off the display list cannot tell a relic on the mat apart from
      // the same relic on your own shelf two feet to the left.
      this._shopStock = stock.map(a => a.id);
      // THE ROW HAS TO FIT THE MAT. SHOP_RELIC_GAP was tuned for the two-relic
      // shelf and applied as a fixed pitch with no clamp, which was fine while
      // two was the only number. THE COLLECTOR'S KERCHIEF (a 55-chip common)
      // and THE ORACLE'S COLLECTOR both add a slot, and either one on its own
      // pushes the outer relics off the mat and through the RESTOCK button and
      // the your-relics shelf; both together reach five. So the pitch tightens
      // to the widest row the mat can hold and is otherwise unchanged: two and
      // three relics still stand exactly where they always have.
      const gap = Math.min(SHOP_RELIC_GAP, Math.floor(SHOP_RELIC_ROW_W / Math.max(1, stock.length - 1)));
      const axs = stock.map((_, i) => GAME_W / 2 + (i - (stock.length - 1) / 2) * gap);
      // ...and WHERE they ended up, beside the ids, so a verification run can
      // click the relic it means instead of guessing a pitch that now moves.
      this._shopStockXs = [...axs];
      this._shopStockIconH = SHOP_RELIC_ICON;
      this._shopRelicRowY = SHOP_RELIC_ROW_Y;
      stock.forEach((art, i) => {
        const rar = ARTIFACT_RARITY[art.rarity];
        // Through the till (run.shopPrice), so THE ORACLE'S NEGOTIATOR and
        // COLLECTOR move this number without the mat knowing either exists.
        const price = shopPrice(art.shopPrice ?? art.price);
        const icon = addArtifactIcon(this, 0, 0, art, SHOP_RELIC_ICON);
        const spot = makeSpot(axs[i], SHOP_RELIC_ROW_Y, icon, price, art.name, rar, SHOP_RELIC_ICON, (fail, settle) => {
          if (run.chips < price) { fail('NOT ENOUGH CHIPS'); return false; }
          // PAID ON TAKE, NOT ON OPEN. LEAVE IT / NEVER MIND are real answers,
          // and a relic you did not take costs nothing and leaves the mat: the
          // spot stays live so you can change your mind. `noteBuy` moves with
          // the money, so a declined relic no longer counts toward SPREE or
          // BUYER'S REMORSE either.
          artifactCeremony(this, run, art, (taken) => {
            if (taken) { settle(); noteBuy(art.id); }
            updateChips();
          }, { quiet: true });
          return 'defer';
        }, `${art.name}  ·  ${rar.label}`, artifactTipBody(art, { own: false }), {
          key: `shopbuy:relic:${art.id}`,
          refuse: () => (run.chips < price ? `Not enough chips. He wants ◉ ${price}.` : null),
        });
        if (art.rarity === 'mythical' || art.rarity === 'heroExclusive') {
          const aura = this.add.image(0, 0, 'fx_glow_circle').setTint(rar.color)
            .setScale(0.9).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD);
          spot.addAt(aura, 1);
          this.tweens.add({ targets: aura, alpha: 0.75, scale: 1.1, duration: 800, yoyo: true, repeat: -1 });
        }
      });

      const potions = rollShopPotions(3);
      const pxs = potions.map((_, i) => GAME_W / 2 + (i - (potions.length - 1) / 2) * 280);
      potions.forEach((def, i) => {
        const rar = POTION_RARITY[def.rarity];
        const icon = addPotionIcon(this, 0, 0, def, 116);
        const price = shopPrice(def.price);   // the same till the relics ring up on
        const spot = makeSpot(pxs[i], 700, icon, price, def.name, rar, 116, (fail) => {
          if (run.potions.length >= MAX_POTIONS) { fail(`BELT FULL: ${MAX_POTIONS} MAX`); return false; }
          if (run.chips < price) { fail('NOT ENOUGH CHIPS'); return false; }
          run.potions.push({ ...def });
          updateBelt();
          noteBuy();
          return true;
        }, `${def.name}  ·  ${rar.label} Potion`, def.desc, {
          key: `shopbuy:potion:${def.id}:${i}`,
          refuse: () => (run.potions.length >= MAX_POTIONS ? `Your belt is full. ${MAX_POTIONS} bottles is the lot.`
            : run.chips < price ? `Not enough chips. He wants ◉ ${price}.` : null),
        });
        if (def.rarity === 'mythical') {
          // Same red-aura fanfare as a mythical relic — the label alone drowns
          // against the red mat (rarity agent's flag).
          const aura = this.add.image(0, 0, 'fx_glow_circle').setTint(0xe03040)
            .setScale(0.7).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD);
          spot.addAt(aura, 1);
          this.tweens.add({ targets: aura, alpha: 0.75, scale: 0.85, duration: 800, yoyo: true, repeat: -1 });
        }
      });
    };

    // THE BELT, ON THE MERCHANT'S MAT (JC, 2026-08-01). It used to be a text
    // readout ("Potion belt: 2/3"). Now it is the real mat, and every
    // drinkable-ANYWHERE potion on it can be drunk right here — which is what
    // makes the loop the player asked for real: buy PAYDAY BRINE, drink it, the
    // slot frees AND the chips land, buy the next thing with them.
    const beltMat = { cx: 236, cy: 172, w: 290 };
    const beltMatH = beltMat.w * POTION_MAT.aspect;
    const beltImg = this.add.image(beltMat.cx, beltMat.cy, 'potion_mat')
      .setDisplaySize(beltMat.w, beltMatH);
    ov.add(dropShadow(this, beltImg, MAT_SHADOW));
    ov.add(beltImg);
    const beltLabel = this.add.text(beltMat.cx, beltMat.cy - beltMatH / 2 - 13, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.shopMatLabel}px`, color: '#e8d3a4',
      stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5);
    ov.add(beltLabel);
    const beltSlots = this.add.container(0, 0);
    ov.add(beltSlots);
    const updateBelt = () => {
      beltLabel.setText(`YOUR POTION BELT  ${run.potions.length}/${MAX_POTIONS}`);
      beltSlots.removeAll(true);
      const beltSpots = potionSpots(beltMat.cx, beltMat.cy, beltMat.w);
      // Painted spots only — no code-drawn rings here either.
      run.potions.slice(0, MAX_POTIONS).forEach((pot, i) => {
        const { x, y, r } = beltSpots[i];
        const icon = addPotionIcon(this, x, y, pot, 52);
        beltSlots.add(icon);
        const drinkable = potionUsableIn(pot, 'map');
        if (!drinkable) icon.setAlpha(0.55);
        const hit = this.add.circle(x, y, r, 0xffffff, 0.001)
          .setInteractive({ useHandCursor: true });
        beltSlots.add(hit);
        // SELLING A BOTTLE (JC, 2026-08-01). The merchant buys potions back at
        // the relics' quarter rate — which is what makes a belt full of
        // combat-only brews a problem you can SOLVE at his table instead of a
        // wall you stare at. A left click still drinks (where legal); the SELL
        // tab under the bottle is the deliberate second affordance, so nobody
        // liquidates a Mythical brew by fumbling a drink.
        const sellFor = potionSellValue(pot);
        hit.on('pointerover', () => this.showTip(x, y + 70, pot.name,
          pot.desc + (drinkable ? say('\nClick to drink it right here.', '\nTap to drink it right here.')
            : pot.use === 'passive' ? '\n(always working)' : '\n(combat only)')
          + `\n${say('Or press SELL. He pays', 'He pays')} ◉ ${sellFor}.`));
        hit.on('pointerout', () => this.hideTip());
        const drink = () => this.drinkPotionHere(pot, x, y, {
          after: () => { updateBelt(); updateChips(); refreshPrices(); refreshServices(); },
        });
        const sell = () => {
          const k = run.potions.indexOf(pot);
          if (k < 0) return;
          run.potions.splice(k, 1);
          run.chips += sellFor;      // a refund, not income — same rule as sellArtifact
          sfx(this, 'chips_stack', { volume: 0.85 });
          popMessage(this, x, y - 30, `+${sellFor} chips`, { color: '#ffc542', size: 30, rise: 50 });
          this.hideTip();
          updateBelt(); updateChips(); refreshPrices(); refreshServices();
        };
        // DESKTOP: a left click drinks, the tab under the bottle sells. Both
        // exactly as they shipped.
        if (drinkable && !TOUCH) hit.on('pointerdown', drink);
        // The tab: small, plain, and it says the number out loud.
        const tabTxt = this.add.text(x, y + 33, `SELL ◉${sellFor}`, {
          fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.sellTab}px`, color: '#ffd23e',
          stroke: '#241505', strokeThickness: 4,
        }).setOrigin(0.5);
        const tab = this.add.rectangle(x, y + 34, tabTxt.width + MAP_TYPE.sellTabPad, MAP_TYPE.sellTabH, 0x2a1a10, 0.92)
          .setStrokeStyle(2, 0x8a6a3c);
        if (!TOUCH) tab.setInteractive({ useHandCursor: true });
        beltSlots.add(tab); beltSlots.add(tabTxt);
        /**
         * TWO HAZARDS, ONE BOX (2026-08-10).
         *
         * This mat had the worst pair of touch targets in the game. The bottle's
         * hit circle DRANK on a bare `pointerdown` — no tapBind, no hold check,
         * no confirm — which is the map mat's own two-step model contradicted on
         * the very next screen. And the SELL tab under it was a 20px-tall plate
         * carrying 14px ink: too small to read, too small to hit deliberately,
         * and it liquidated a Mythical brew on first contact.
         *
         * On touch neither is a target any more. The bottle opens ONE box that
         * spells the potion out and offers both verbs as full plates, and the tab
         * becomes what it should always have been on a phone — a legible PRICE
         * LABEL, not a button. Desktop keeps both handlers to the letter.
         */
        if (TOUCH) {
          twoTap(this, hit, {
            key: `shopbelt:${i}`,
            anchor: { x, y, w: r * 2, h: r * 2 },
            title: pot.name,
            body: pot.desc,
            note: drinkable ? `He pays ◉ ${sellFor} for it.`
              : pot.use === 'passive' ? `Always working, nothing to drink. He pays ◉ ${sellFor}.`
                : `Combat only. He pays ◉ ${sellFor}.`,
            accent: POTION_RARITY[pot.rarity]?.color,
            owner: ov,
            buttons: [
              { label: 'DRINK', kind: 'go', enabled: drinkable, onClick: drink },
              { label: `SELL ◉${sellFor}`, kind: 'buy', onClick: sell },
            ],
          });
        } else {
          tab.on('pointerover', () => { tab.setFillStyle(0x4a2f18, 0.96); sfx(this, 'menu_select', { volume: 0.22, jitter: 0.06 }); });
          tab.on('pointerout', () => tab.setFillStyle(0x2a1a10, 0.92));
          tab.on('pointerdown', sell);
        }
      });
    };
    updateBelt();

    // ---- YOUR RELICS, ON HIS TABLE (JC, 2026-08-01) ------------------------
    // The potion mat came to the merchant first; the artifact belt follows it
    // for the same reason — you cannot decide what to BUY without seeing what
    // you already HOLD. It sits directly under the potion mat on the left edge
    // (the mat's bottom lip is ~y=250, the goods start at x≈560, so the column
    // is clear of both). Hover reads the relic WITH its running total; click
    // opens the same sell confirm the map belt uses, and selling repaints the
    // shelf, the purse and the price tags in place — you can sell a relic and
    // spend the chips without leaving the tent.
    const relicShelf = this.add.container(0, 0);
    ov.add(relicShelf);
    const relicLabel = this.add.text(beltMat.cx, beltMat.cy + beltMatH / 2 + 18, '', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: `${MAP_TYPE.shopMatLabel}px`, color: '#e8d3a4',
      stroke: '#241505', strokeThickness: 4,
    }).setOrigin(0.5);
    ov.add(relicLabel);
    const renderRelicShelf = () => {
      relicShelf.removeAll(true);
      const owned = [...beltArtifacts(), ...nookArtifacts()];
      relicLabel.setText(`YOUR RELICS  ${slotsUsed()}/${run.artifactSlots}`);
      const cols = 4;
      const x0 = beltMat.cx - ((cols - 1) / 2) * 68;
      // +66, not +52: the mat is only ~101px tall, so the label sat at +18 and
      // the first row of 58px slots opened at +52 — the top of the slots ate the
      // bottom of the words. Six pixels of daylight, and nothing below moves
      // (the second row still finishes ~600px clear of the priced services).
      const top = beltMat.cy + beltMatH / 2 + 66;
      const cells = Math.max(run.artifactSlots, owned.length);
      for (let i = 0; i < cells; i++) {
        const x = x0 + (i % cols) * 68;
        const y = top + Math.floor(i / cols) * 68;
        const art = owned[i];
        const box = this.add.rectangle(x, y, 58, 58, 0x241b31, 0.85)
          .setStrokeStyle(3, art ? ARTIFACT_RARITY[art.rarity].color : 0x4a3c60);
        relicShelf.add(box);
        if (!art) continue;
        relicShelf.add(addArtifactIcon(this, x, y, art, 46));
        if (mirrorBlockedBy(art)) relicShelf.add(noMirrorBadge(this, x + 21, y - 20, 9));
        const rar = ARTIFACT_RARITY[art.rarity];
        box.setInteractive({ useHandCursor: true });
        box.on('pointerover', () => {
          sfx(this, 'menu_select', { volume: 0.22, jitter: 0.06 });
          this.showTip(x, y - 40, art.name, `${rar?.label ?? ''}\n` + artifactTipBody(art)
            + `\n\n${say('Click', 'Tap')} to sell it for ◉ ${sellValue(art)}`, 0.5, !!rar?.rainbow);
        });
        box.on('pointerout', () => this.hideTip());
        // A grid of 58px squares whose only tell is a 46px painting, and the
        // first touch on any of them opened a sell confirm. Same box, same
        // rule: read first, then SELL, then the confirm.
        const shelfSell = () => {
          this.hideTip();
          this.sellPrompt(art, { after: () => { renderRelicShelf(); updateChips(); refreshPrices(); refreshServices(); } });
        };
        if (TOUCH) {
          twoTap(this, box, {
            key: `shopsell:${art.id}`,
            anchor: { x, y, w: 58, h: 58 },
            title: `${art.name}  ·  ${rar?.label ?? ''}`,
            body: artifactTipBody(art),
            accent: rar?.color,
            owner: ov,
            buttons: [{ label: `SELL ◉${sellValue(art)}`, kind: 'buy', onClick: shelfSell }],
          });
        } else {
          box.on('pointerdown', shelfSell);
        }
      }
    };
    renderRelicShelf();
    // Anything that changes the belt while the tent is open (a purchase's
    // ceremony, a full-slots swap) repaints the shelf in place instead of
    // kicking the whole map over — see rewards.beltChanged / onBeltChanged.
    this.shopBeltRefresh = () => { renderRelicShelf(); updateChips(); refreshPrices(); };
    ov.once('destroy', () => { this.shopBeltRefresh = null; });

    renderStock();

    // RESTOCK: hunt for the missing puzzle piece — price climbs per pull.
    // JC, 2026-07-31: the old 40 + 30n LADDER opened too dear and then went
    // flat — by the fourth pull it was cheaper than the relics it was showing
    // you. The new one opens at 25 (an impulse) and compounds ~x1.5, rounded to
    // numbers the merchant would actually say out loud, so browsing is free-ish
    // and DIGGING is the thing you pay for. `restocks` is scoped to runShop(),
    // so the ladder resets on every VISIT — the merchant has no memory.
    //
    // FREE COUPON (2026-08-02): the first restock of each VISIT costs nothing,
    // and it still advances the ladder — the coupon buys you the dig, it does
    // not reset the price of the next one. Scoped to runShop() like `restocks`
    // itself, so every tent honours one coupon per relic held.
    let freeRestocks = getProp(effectiveArtifacts(), 'freeFirstRestock');
    const restockPrice = () => {
      if (freeRestocks > 0) return 0;
      const last = RESTOCK_LADDER[RESTOCK_LADDER.length - 1];
      const base = restocks < RESTOCK_LADDER.length
        ? RESTOCK_LADDER[restocks]
        : Math.round(last * Math.pow(1.5, restocks - RESTOCK_LADDER.length + 1) / 10) * 10;
      const dug = getProp(effectiveArtifacts(), 'restockHalf') > 0 ? Math.round(base / 2) : base;
      return shopPrice(dug);   // digging is a purchase, so the till applies here too
    };
    const restockLabel = () => (restockPrice() === 0 ? 'RESTOCK: FREE' : `RESTOCK: ◉ ${restockPrice()}`);
    const restockBtn = this.add.image(GAME_W - 230, 210, 'btn_blue').setInteractive({ useHandCursor: true });
    const restockTxt = this.add.text(GAME_W - 230, 206, restockLabel(), {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: '#0a2a4a',
    }).setOrigin(0.5);
    restockBtn.setDisplaySize(fitWidth(restockTxt, { pad: 56, min: 200, max: 320 }), 60);
    ov.add(restockBtn); ov.add(restockTxt);
    restockBtn.on('pointerover', () => sfx(this, 'menu_select', { volume: 0.25, jitter: 0.06 }));
    restockBtn.on('pointerdown', () => {
      const cost = restockPrice();
      if (run.chips < cost) {
        this.tweens.add({ targets: [restockBtn, restockTxt], x: '+=8', duration: 50, yoyo: true, repeat: 2 });
        return;
      }
      run.chips -= cost;
      if (cost === 0 && freeRestocks > 0) freeRestocks -= 1;
      restocks += 1;
      updateChips();
      this.hideTip();
      sfxCapped(this, 'buy', { volume: 0.8 }, 600);
      restockTxt.setText(restockLabel());
      restockBtn.setDisplaySize(fitWidth(restockTxt, { pad: 56, min: 200, max: 320 }), 60);
      renderStock();
    });

    // Services on the lower boards. BOTH priced services climb a per-RUN ladder
    // (run.counters), so their labels are LIVE — re-read after every purchase
    // made without leaving the tent.
    const services = [
      {
        label: () => `BOOSTER PACK: ◉ ${boosterPrice(run)}`, color: '#5b3a00', key: 'btn_yellow',
        act: () => {
          const cost = boosterPrice(run);
          if (run.chips < cost) return false;
          run.chips -= cost;
          run.counters.packsBought += 1;
          noteBuy();
          updateChips();
          refreshServices();
          sfx(this, 'purchase_upgrade', { volume: 0.85 });
          const kinds = ['witch', 'smith', 'artisan'];
          packOfferOverlay(this, run, kinds.map(k => PACK_TYPES[k]), () => { updateChips(); refreshServices(); });
          return true;
        },
      },
      {
        label: () => (removedThisVisit
          ? 'REMOVED  ·  ONE PER VISIT'
          : `REMOVE A CARD: ◉ ${removalPrice(run)}`),
        disabled: () => removedThisVisit,
        color: '#4a0a10', key: 'btn_red',
        act: () => {
          if (removedThisVisit) return false;
          const cost = removalPrice(run);
          if (run.chips < cost) return false;
          deckPickerOverlay(this, run, { count: 1, optional: true, title: 'Remove which card?' }, (cards) => {
            if (cards[0]) {
              run.chips -= cost;
              run.counters.shopRemovals += 1;
              run.runDeck.splice(run.runDeck.indexOf(cards[0]), 1);
              removedThisVisit = true;
              noteBuy();
              sfx(this, 'poison', { volume: 0.8 });
              updateChips();
            }
            refreshServices();
          });
          return true;
        },
      },
      {
        label: () => 'BACK TO THE TRAIL', color: '#cfc8e8', key: 'btn_dark',
        act: () => {
          // THE INTEREST RELIC used to pay here, on the way out of the tent. It
          // is a PER-ENCOUNTER dividend now and lives on the door every advance
          // goes through (run.enterMapNode, called from tryEnter), so the
          // merchant pays exactly like every other room and this button is back
          // to being a door.
          leaveShop();
          ov.destroy(true);
          playMusic(this, this.act.music.fight);
          this.refreshMap();
          return true;
        },
      },
    ];
    const svcTexts = [];
    const svcBtns = [];
    // A spent service greys out in place: cold text, dimmed plate, and the
    // label itself says why (the button still shakes if you press it).
    const refreshServices = () => services.forEach((svc, i) => {
      const off = !!svc.disabled?.();
      svcTexts[i]?.setText(svc.label());
      // Light grey on a dimmed plate: over a RED mat, dark-on-dark would read
      // as a rendering bug rather than as a service that is closed.
      svcTexts[i]?.setColor(off ? '#d8cec4' : svc.color);
      // ...and the pale state takes an outline, because the plate under it drops
      // to 55% and the merchant's mat behind THAT is bright red. The live label
      // is dark ink on an opaque plate and wants no stroke at all.
      svcTexts[i]?.setStroke(INK_DARK, off ? 4 : 0);
      svcBtns[i]?.setAlpha(off ? 0.55 : 1);
      svc.fit?.();
    });
    services.forEach((svc, i) => {
      const x = GAME_W / 2 + (i - 1) * 430;
      const btn = this.add.image(x, 986, svc.key).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, 982, svc.label(), {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: svc.color,
      }).setOrigin(0.5);
      // The board is priced live, so the plate is re-fitted whenever the label
      // changes — a service never wears yesterday's width.
      const fitSvc = () => btn.setDisplaySize(fitWidth(txt, { min: 280, max: 420 }), 70);
      fitSvc();
      svc.fit = fitSvc;
      svcTexts[i] = txt;
      svcBtns[i] = btn;
      ov.add([btn, txt]);
      btn.on('pointerover', () => sfx(this, 'menu_select', { volume: 0.25, jitter: 0.06 }));
      btn.on('pointerdown', () => {
        sfx(this, 'button', { volume: 0.8 });
        if (!svc.act()) this.tweens.add({ targets: [btn, txt], x: '+=8', duration: 50, yoyo: true, repeat: 2 });
      });
    });
  }

  // ---------------- Ambience ----------------

  startAmbience() {
    // Biome weather over the board — sparse and calm (JC: ~65% fewer), using
    // Caleb's particle variants. This is the ONLY particle system on the map.
    //
    // SIX WORLDS NOW. Rather than grow a six-armed if/else, each world declares
    // what falls on it: which texture family, how big, how fast, how much it
    // tumbles and whether it glows. Adding a seventh world is a row.
    const kind = this.act.ambience;
    const WEATHER = {
      forest: { every: 1900, tex: 'leaf', scale: [0.45, 0.8], alpha: [0.35, 0.6], dur: [8000, 12000], spin: 'tumble' },
      snow: { every: 1300, tex: 'snow', scale: [0.3, 0.6], alpha: [0.3, 0.55], dur: [10000, 16000], spin: 'drift' },
      abyss: { every: 1900, tex: 'ash', spark: 'ember', sparkRate: 0.22, scale: [0.28, 0.62], alpha: [0.35, 0.6], dur: [11000, 17000], spin: 'drift' },
      // NOCTURNAL FOREST: JC's own painted night leaves, with green witch-fire
      // wisps in the spark slot. These were borrowed-and-tinted leaves until
      // 2026-08-04; the tints are gone because the art is the right colour now.
      nightwood: { every: 1500, tex: 'nightleaf', spark: 'nightwisp', sparkRate: 0.28, scale: [0.34, 0.6], alpha: [0.4, 0.72], dur: [12000, 18000], spin: 'tumble' },
      // ETHEREAL PLAINS: painted motes and crystal shards, still slowed to a
      // crawl because nothing on the Plains is in a hurry.
      motes: { every: 1700, tex: 'mote', scale: [0.3, 0.55], alpha: [0.4, 0.7], dur: [15000, 22000], spin: 'drift' },
      // BURNING GALLOWS: its own ash, with live coals in the spark slot. One
      // ash variant and two embers, which is why the emitter reads the count.
      ash: { every: 1200, tex: 'gallowsash', spark: 'gallowsember', sparkRate: 0.34, scale: [0.34, 0.72], alpha: [0.45, 0.75], dur: [9000, 15000], spin: 'drift' },
    };
    const w = WEATHER[kind] ?? WEATHER.abyss;
    this.time.addEvent({
      delay: w.every, loop: true,
      callback: () => {
        const x = Phaser.Math.Between(30, GAME_W - 30);
        const spark = !!w.spark && Math.random() < (w.sparkRate ?? 0);
        // Pick the variant AFTER deciding spark-or-body: the two families
        // can have different counts (the Gallows ships one ash, two embers),
        // so a shared roll would ask for a texture that does not exist.
        const fam = spark ? w.spark : w.tex;
        const v = Phaser.Math.Between(1, PARTICLE_VARIANTS[fam] ?? 3);
        const p = this.add.image(x, -40, `particle_${fam}_${v}`)
          .setScale(Phaser.Math.FloatBetween(w.scale[0], spark ? w.scale[1] * 0.8 : w.scale[1]))
          .setAlpha(Phaser.Math.FloatBetween(w.alpha[0], w.alpha[1]));
        if (spark) {
          p.setBlendMode(Phaser.BlendModes.ADD);
          if (w.sparkTint) p.setTint(w.sparkTint);
        } else if (w.tint) {
          p.setTint(w.tint);
        }
        if (w.spin === 'tumble') p.setAngle(Phaser.Math.Between(0, 360));
        p.setDepth(DEPTH.overlay - 3);
        const dur = Phaser.Math.Between(w.dur[0], w.dur[1]);
        this.tweens.add({
          targets: p, y: GAME_H + 60,
          angle: p.angle + (w.spin === 'tumble' ? Phaser.Math.Between(140, 420) : Phaser.Math.Between(-70, 70)),
          duration: dur, ease: 'Linear',
          onComplete: () => p.destroy(),
        });
        this.tweens.add({
          targets: p, x: x + Phaser.Math.Between(-150, -40),
          duration: dur / 4, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
        });
      },
    });
  }
}
