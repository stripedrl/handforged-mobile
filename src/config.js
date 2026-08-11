// HANDFORGED — layout + palette constants (desktop-first 1920x1080, locked)

// Build stamp — shown on the title screen so playtest feedback can name a
// version. Bump this string every time a build goes out to testers.
export const BUILD = 'alpha 0.30d';

/**
 * IMAGE EXTENSION — the one knob the shipped build turns.
 *
 * `assets/` is and stays the LOSSLESS source of truth: every image on disk here
 * is a .png and every call site in BootScene asks for one by name. itch.io caps
 * an HTML5 game at 500MB and the raw tree is 800MB, so tools/build_dist.py
 * transcodes the DIST COPY of every png to WebP and flips THIS CONSTANT in the
 * dist's copy of this file — nothing else in the source changes, and nothing in
 * the dev tree degrades. BootScene.preload wraps its loader once (see the
 * IMG_EXT override there) so all 200+ `${A}/....png` call sites keep reading
 * as the files that are actually on disk.
 *
 * Re-encoding at a different quality later is a build-flag change, not an
 * asset migration: the masters were never thrown away.
 */
export const IMG_EXT = '.webp';

/**
 * THE MOBILE BUILD (JC, 2026-08-04, v2 2026-08-05). One codebase, one flag:
 * the mobile package's index.html sets `window.__HF_MOBILE = true` before
 * main.js loads (and `?mobile` on the dev server flips it for testing).
 * Flag OFF means the desktop build is bit-for-bit the game it always was.
 *
 * V2 IS THE DESKTOP GAME, WIDER (JC: "make the desktop version ported to
 * mobile with some width increase on the UI in addition to some zooming
 * in"). No side rails, no relocated panels: GAME_W itself becomes the
 * iPhone's 19.5:9 (2340) and the SIDEBAR thickens to 420, so every layout
 * that derives from the two constants — the arena centre, the hand fan, the
 * marquee, the backgrounds (which cover-fit GAME_W and therefore ZOOM) —
 * spreads to fill the phone naturally.
 *
 * ===========================================================================
 * V3, 2026-08-10 — TWO SWITCHES, NOT ONE (JC wants to play on an iPad Pro)
 * ===========================================================================
 * `MOBILE` used to decide two completely different questions at once:
 *
 *   1. IS THE PLAYER USING A FINGER?  — thumb-sized targets, hold-to-hover,
 *      the two-tap commit model, bigger type, a thicker sidebar.
 *   2. HOW WIDE IS THE CANVAS?        — 2340 (19.5:9) versus 1920 (16:9).
 *
 * On a phone the two answers happen to coincide. On a TABLET they do not: an
 * iPad Pro is 4:3 (1.333) and wants every one of the touch affordances while
 * a 2340x1080 canvas stretched onto it would be a 60% vertical squash. So the
 * questions are now asked separately:
 *
 *   TOUCH  the touch model. Driven by the FLAG, exactly as MOBILE always was,
 *          so the desktop package cannot flip into it by owning a touchscreen.
 *   WIDE   the canvas shape, chosen AT BOOT from the device's own aspect —
 *          whichever of the two canvases is closer to the screen it must fill.
 *          Everything downstream is already GAME_W-derived (the mobile-v2 wave
 *          proved it), so this one boolean re-lays the whole game out.
 *
 * `MOBILE` survives as an alias for TOUCH because that is what all ~76 of its
 * call sites were actually asking (they are finger-size bumps to a man). The
 * two places that genuinely meant "the wide canvas" — the wide map boards in
 * core/lazyload.js and MapScene's BOARD_W — read WIDE.
 */
const HF_QS = (typeof window !== 'undefined')
  ? new URLSearchParams(window.location?.search ?? '')
  : new URLSearchParams('');

export const TOUCH = (typeof window !== 'undefined')
  && (window.__HF_MOBILE === true || HF_QS.has('mobile'));

/** The two canvases this game knows how to be, as aspect ratios. */
export const CANVAS_ASPECT_WIDE = 2340 / 1080;    // 2.1667 — a 19.5:9 phone
export const CANVAS_ASPECT_NARROW = 1920 / 1080;  // 1.7778 — 16:9, and the desktop

/**
 * The line between them: the midpoint of the two aspects. A screen is handed
 * whichever canvas it is CLOSER to, which is the same rule as "letterbox the
 * least" and needs no device list to maintain.
 *
 *   iPhone 16 Pro landscape  874x402   2.174  -> WIDE   (fills, 0.3% warp)
 *   Galaxy 20:9              2.222            -> WIDE
 *   iPad Pro 13"            1376x1032  1.333  -> narrow (1920, letterboxed)
 *   iPad Pro 11"            1210x834   1.451  -> narrow (1920, letterboxed)
 *   a 16:9 tablet            1.778            -> narrow (1920, exact fit)
 */
export const WIDE_PICK_ASPECT = (CANVAS_ASPECT_WIDE + CANVAS_ASPECT_NARROW) / 2;  // 1.9722

/**
 * Chosen ONCE, here, at module evaluation — which is before main.js builds the
 * Phaser config, because config.js is the first thing every scene imports.
 *
 * `window.__HF_WIDE` is the override the PWA shell writes: the shell has to
 * know the canvas aspect anyway (it is what decides fill-vs-letterbox), so it
 * decides first and tells us, and the two can never disagree about which
 * canvas is on screen. `?wide=0` / `?wide=1` is the dev-server equivalent.
 */
function chooseWide() {
  if (!TOUCH) return false;                     // the desktop game is 1920, always
  if (typeof window === 'undefined') return false;
  if (window.__HF_WIDE === true) return true;
  if (window.__HF_WIDE === false) return false;
  if (HF_QS.has('wide')) return HF_QS.get('wide') !== '0';
  const w = window.innerWidth || window.screen?.width || 0;
  const h = window.innerHeight || window.screen?.height || 0;
  if (!(w > 0 && h > 0)) return true;           // unmeasurable: the phone is the default
  // Orientation-agnostic on purpose. The game is landscape-locked but the page
  // can very easily be evaluated while the device is still held upright, and a
  // boot-time decision that flips with the wrist is not a decision.
  return (Math.max(w, h) / Math.min(w, h)) >= WIDE_PICK_ASPECT;
}

export const WIDE = chooseWide();

/** Legacy name. Every existing `MOBILE ?` in the tree is a finger-size bump. */
export const MOBILE = TOUCH;

export const GAME_W = WIDE ? 2340 : 1920;
export const GAME_H = 1080;
export const VIEW_W = GAME_W;   // the canvas IS the world now, both builds

/** V1's camera shift, retired: the world fills the canvas. Kept as a no-op
 *  so the scenes' create() calls stay harmless. */
export function applyMobileCamera() {}

/**
 * THE SIDEBAR follows the FINGER, not the canvas: its extra 80px pays for
 * thumb-sized relic sockets, which a tablet wants every bit as much as a phone
 * does. On the 1920 tablet canvas it is 80px out of the arena, and the arena
 * derives from these two constants, so nothing else has to be told.
 */
export const SIDEBAR_W = TOUCH ? 420 : 340;

/** The arena's width — everything between the sidebar and the right edge. */
export const PLAY_W = GAME_W - SIDEBAR_W;   // 1920 phone / 1500 tablet / 1580 desktop

/**
 * THE SAFE FRAME (JC, 2026-08-10: "the settings cog is basically clipped; the
 * DISCARD and SORT plates are slightly clipped").
 *
 * A phone's glass is not a rectangle. In LANDSCAPE, iOS reports a 62pt inset on
 * both long edges (the Dynamic Island lives on one of them and swaps sides with
 * the wrist) and the four corners are cut by a ~55pt radius, which bites hardest
 * on the DIAGONAL — which is exactly why the cog, alone in a corner, read as
 * clipped while the potion mat 9pt from the same edge read fine.
 *
 * The shell deliberately does NOT letterbox the phone away from all of that
 * (JC: "I'm okay if things are slightly distorted... I want it to fill the whole
 * screen"), so the clearance is bought in GAME coordinates instead:
 *
 *   x / y   how far in from each edge anything corner-pinned is pulled. 96 game
 *           px is ~36pt on the phone — a real margin against the 7-9pt the
 *           plates were shipping — without spending the 166px a full 62pt
 *           inset would cost on a 2340-wide canvas that has to hold a fan.
 *   corner  the radius of the CORNER BITE: no interactive element may have a
 *           bounding box inside the quarter-disc this cuts out of each corner.
 *           The verification driver asserts exactly that.
 */
export const SAFE = {
  x: TOUCH ? 96 : 0,
  y: TOUCH ? 24 : 0,
  corner: TOUCH ? 150 : 0,
};

/**
 * Is `box` ({left,right,top,bottom}) wholly clear of all four corner bites?
 *
 * THIS TEST IS STRICT, AND THE FIRST DRAFT OF IT WAS NOT. The first version
 * measured the box's point NEAREST each arc centre, which answers "is any of
 * this box on the glass" — a question every box on a 2340x1080 canvas answers
 * yes to. The shipped settings cog PASSED it while being visibly clipped on
 * JC's phone, which is the exact failure the whole check exists to catch.
 *
 * So it asks about the box's own four CORNERS, because the corner is the point
 * that sticks furthest into the arc, and a rectangle is clipped exactly when
 * one of its corners falls outside the quarter-circle. `outX && outY` is what
 * confines the test to the quadrant actually cut away: a box directly below an
 * arc centre is in the safe vertical band and is never bitten.
 */
export function clearsCorners(box, r = SAFE.corner) {
  if (!(r > 0)) return true;
  const pts = [[box.left, box.top], [box.right, box.top],
    [box.left, box.bottom], [box.right, box.bottom]];
  for (const [cx, cy] of [[r, r], [GAME_W - r, r], [r, GAME_H - r], [GAME_W - r, GAME_H - r]]) {
    for (const [px, py] of pts) {
      // Only the quarter that faces the actual screen corner is cut away.
      const outX = cx <= r ? px < cx : px > cx;
      const outY = cy <= r ? py < cy : py > cy;
      if (outX && outY && Math.hypot(px - cx, py - cy) > r) return false;
    }
  }
  return true;
}

export const SUIT_COLORS = {
  swords:  0x4a5a7a,
  hearts:  0xe0434f,
  gems:    0x2bb3d6,
  clovers: 0x3fa64b,
};

export const SUIT_PIP_KEY = {
  swords:  'pip_sword',
  hearts:  'pip_heart',
  gems:    'pip_gem',
  clovers: 'pip_club',
};

export const SUIT_GLYPH = {
  // Display names only — the `gems` / `clovers` ids stay in code forever.
  swords: 'SWORDS', hearts: 'HEARTS', gems: 'DIAMONDS', clovers: 'CLUBS',
};

export const FONTS = {
  display: 'Lilita One',   // chunky carved headers, numbers, buttons — cousins with the logo
  body: 'Baloo 2',         // friendly rounded body text
};

export const PARCH = {
  fill: 0xecd9b0,
  fillLight: 0xf6e8c8,
  wood: 0x6b4526,
  woodDark: 0x38220f,
  text: '#42280e',
  textDim: '#6b4a26',
  accent: '#a3541c',
};

export const COLORS = {
  bgDark: 0x1a1424,
  panel: 0x241b31,
  panelLine: 0x4a3c60,
  textMain: '#f2ecff',
  textDim: '#a898c4',
  gold: '#ffc542',
  hp: 0x37d6a0,
  hpBack: 0x143028,
  shield: 0x2bb3d6,
  enemyHp: 0xe0434f,
  zeal: '#ffd166',
};

export const DEPTH = {
  bg: 0, arena: 10, panel: 20, cards: 30, played: 35, fx: 40, overlay: 50,
};

/**
 * FALLING PARTICLE FAMILIES, and how many variants each one actually has.
 *
 * The original four shipped three variants apiece, so BootScene's loader and
 * both emitters simply hard-coded `1..3`. JC's biome particles do not: the
 * Nocturnal Forest came with two leaves and two wisps, the Gallows with one ash
 * and two embers. Rather than duplicate files to fit a magic number, the count
 * lives here and everything reads it, so the next drop can be any size at all.
 */
export const PARTICLE_VARIANTS = {
  leaf: 3, snow: 3, ash: 3, ember: 3,          // the shipped four
  nightleaf: 2, nightwisp: 2,                  // Nocturnal Forest
  mote: 3,                                     // Ethereal Plains
  gallowsash: 1, gallowsember: 2,              // Burning Gallows
};

/**
 * THE PHONE'S BIGGER CARD (JC, 2026-08-06: "bigger hand cards with more
 * vertical room"; 2026-08-10: "bigger still"). V2 widened the WORLD and left
 * the card at its desktop 140x210, so the fan read as a strip of postage stamps
 * across a screen with 420 more pixels than it needed. ONE scalar grows the
 * whole card — face, corner cluster, pip, banner, and the lifts that move it —
 * because every number printed on a card is an inset from its own edge (see
 * ui/CardSprite.js) and scaling the frame without its insets is how you get a
 * rank floating in the middle of painted filigree.
 *
 * 180x270, up from 164x246. Both are EXACTLY 2:3 (a fractional card is a blurry
 * card), and 180 is the honest maximum: the budget is VERTICAL, and it was paid
 * for by moving the two things above the fan rather than by shaving the card.
 *
 *   fan bottom   912 + 135 + 26 arc = 1073, against a 1080 canvas
 *   fan top      912 - 135          =  777
 *   played row   630 + 135          =  765, four px of daylight under the fan
 *   equation     playedY - 200 = 430, and its caption at 474, which clears the
 *                played row's own ceiling (495) by four
 *
 * The band the equation vacated was dead air: the enemy stack bottoms out around
 * y 250 even on a tall body, so 430 is nowhere near a health bar.
 */
const CARD_SCALE = TOUCH ? 180 / 140 : 1;
const cs = (n) => Math.round(n * CARD_SCALE);

export const CARD = {
  w: cs(140), h: cs(210), // display size — true 2:3, matches Caleb's painted card faces
  // TOUCH sits 26px higher than desktop's 938: the card grew 60px taller and
  // the arc still has to land inside 1080. See fanArcMax.
  fanY: TOUCH ? 912 : 938,
  fanCenterX: (SIDEBAR_W + GAME_W) / 2,
  /**
   * PX BETWEEN CARD CENTRES — how much of each card you can actually see.
   *
   * Derived from the ARENA'S width rather than hard-coded, because the touch
   * build now has two of them (a 1920 phone arena, a 1500 tablet arena) and a
   * spacing tuned for one is a fan that overruns the button lanes on the other.
   * 0.0682 reproduces the shipped phone number (1920 -> 131) exactly.
   *
   * Note it did NOT grow with the card: a wider card at the same spacing is
   * more overlap, not a wider fan, so the bigger card costs the lanes nothing.
   */
  fanSpread: TOUCH ? Math.round(PLAY_W * 0.0682) : 96,
  /**
   * HOW WIDE THE FAN MAY EVER GET, centre to centre. This used to live as
   * fanSlots' own `maxWidth = 740` default and nothing passed it, so the phone
   * drew a 740px fan in the middle of a 2340px screen with 400px of dead air
   * either side. The 740 it reserves is measured, not guessed: it is what both
   * button lanes (see BTN_LANE in CombatScene) need at their full size, so a
   * twelve-card hand is the first one that makes a plate step aside.
   */
  fanMaxWidth: TOUCH ? PLAY_W - 740 : 740,
  /**
   * THE ARC'S CEILING. The fan bows by arc² — fine at eight cards (27px), off
   * the bottom of the screen at twelve (67px, and the card is 270 tall). The
   * cap is set ABOVE the nine-card bow (35.2) on desktop so nothing that reads
   * right today moves; it only ever bites on the ten-plus hands (Handy, the
   * Overstuffed Satchel) that put it there.
   */
  fanArcMax: TOUCH ? 26 : 36,
  hoverLift: cs(34),
  selectLift: cs(56),
  // The played row moved UP on touch to pay for the taller card. Desktop's 668
  // is untouched, and every offset in the scene derives from this one number.
  playedY: TOUCH ? 630 : 668,
  // Painted-face safe zone: the ornate frame eats ~9-13% per side, and the
  // corner filigree bites further in on the diagonal. Everything printed on
  // the card is anchored off these so a frame swap never needs a code change.
  padX: cs(30),            // corner cluster: x inset from the card's side edge
  padY: cs(24),            // corner cluster: y inset from the card's top/bottom
  cornerColW: cs(26),      // width of the rank/pip column ('10' shrinks to fit)
  cornerPip: cs(24),       // corner pip display box
  cornerGap: cs(3),        // px between the rank's painted ink and the pip below it
  pipY: cs(10),            // center pip offset from card center (down is +)
  bannerY: cs(34),         // mod banner text: distance up from the card's bottom edge
};

/**
 * The suit rules EVERY hero shares (2026-08-01 overhaul). Clubs used to read
 * differently on all four sheets because they carried that hero's status; they
 * now say one thing to everybody, so the default list is shared and only the
 * two heroes who genuinely bend a suit (the Bull's Diamonds, Zelus's Hearts)
 * spell their own out.
 */
const SUIT_NOTES = [
  { suit: 'swords', text: '2× damage' },
  { suit: 'hearts', text: '1× damage + heal' },
  { suit: 'gems', text: '1× damage + shield' },
  { suit: 'clovers', text: '1× damage, splashing 25%' },
];

/**
 * DRUSKY, THE HOARDER — every number his kit is made of, written once. The kit
 * text, the shared scoring channels, the unlock predicate and the tests all
 * read these, so the printed promise and the arithmetic cannot drift apart.
 *
 *   HOARD_CHIP_STEP / HOARD_MULT_PER_STEP  the chips-to-mult rate. Read LIVE at
 *     play time, never banked: spend the pile and the mult goes with it. It
 *     rides mods.chipMultAdd (see run.collectMods), which is the shared channel
 *     the Solid Gold Sack rewrites into mods.chipMultFactor.
 *   HOARD_LEFTOVER_BONUS  what a hand he did not need is worth on top, applied
 *     at the END of the purse, after every relic (see CombatScene.chipsPerHandLeft).
 *   HOARD_UNLOCK_CHIPS  held AT ONCE in one run. See the `theHoard` achievement.
 */
export const HOARD_CHIP_STEP = 100;
export const HOARD_MULT_PER_STEP = 1;
export const HOARD_LEFTOVER_BONUS = 0.5;
export const HOARD_UNLOCK_CHIPS = 2000;

export const CHARACTERS = {
  highRoller: {
    id: 'highRoller', suit: 'swords', name: 'DEXTRA', title: 'The Shortblade',
    kit: '1-card hands ×4 mult, 2-card hands ×3, 3-card hands ×2.',
    status: 'bleed', statusLabel: 'Bleed',
    sprite: 'hero_duelist',
    suitNotes: [...SUIT_NOTES],
  },
  zealot: {
    id: 'zealot', suit: 'hearts', name: 'ZELUS', title: 'The Cleric',
    kit: 'Overheal banks as ZEAL. Your next damaging hand spends all of it, +2% damage per point.',
    status: 'smite', statusLabel: 'Smite',
    sprite: 'hero_cleric',
    suitNotes: [
      { suit: 'swords', text: '2× damage' },
      { suit: 'hearts', text: '1× damage + heal → Zeal' },
      { suit: 'gems', text: '1× damage + shield' },
      { suit: 'clovers', text: '1× damage, splashing 25%' },
    ],
  },
  bulwark: {
    id: 'bulwark', suit: 'gems', name: 'THE BULL', title: 'Mighty Wall',
    kit: 'Every Diamond card you play deals DOUBLE damage.',
    status: 'brittle', statusLabel: 'Brittle',
    sprite: 'hero_diamond_knight',
    suitNotes: [
      { suit: 'swords', text: '2× damage' },
      { suit: 'hearts', text: '1× damage + heal' },
      { suit: 'gems', text: '2× damage + shield' },
      { suit: 'clovers', text: '1× damage, splashing 25%' },
    ],
  },
  /**
   * OPHELIA — LOCKED as of 2026-08-03, the second hero to be (see `hoarder`).
   *
   * `unlock` points at the EXISTING 'actFour' trophy rather than a trophy minted
   * for the job, and that is deliberate on both counts. JC's brief was
   * "status-effect flavoured, or beating act IV, difficult but not crazy", and
   * a status-effect gate is the one thing that cannot work here: POISON is
   * essentially hers, so any trophy asking for poison would ask you to play the
   * hero you are trying to unlock. THE CRUCIBLE has no such circle — it opens
   * the moment anybody clears Act III, it can be run on BRONZE, and it is the
   * one door in the game that is already framed as "the act that is not on the
   * map", which is exactly where a Doctor of Poison should be waiting.
   *
   * Reusing the trophy also means the shelf explains itself for free:
   * achievementHero() derives its answer from this field, so THE CRUCIBLE's tile
   * now says it opens a hero without a line of UI changing.
   *
   * With Drusky also locked this leaves three heroes at the start, which is the
   * intent. A run already IN PROGRESS as Ophelia is untouched: the gate is read
   * by the character-select screen only, and core/save.js checks CHARACTERS for
   * the hero's EXISTENCE, never for their unlock, so a parked run resumes.
   */
  venomancer: {
    id: 'venomancer', suit: 'clovers', name: 'OPHELIA', title: 'Doctor of Poison',
    kit: 'Half the damage she deals seeps in as POISON.',
    status: 'poison', statusLabel: 'Poison',
    sprite: 'hero_ophelia',
    unlock: 'actFour',
    // THE RIDDLE STAYS ON THE TROPHY; THE INSTRUCTIONS GO ON THE CARD.
    // "Clear the act that is not on the map" is exactly right on a trophy tile,
    // where teasing is the genre — and exactly wrong on the screen where a
    // first-timer is deciding who to play, because it gives them no thread to
    // pull. `unlockHint` is read ONLY by the character-select card and falls
    // back to the achievement's own hint for every other locked hero (Drusky's
    // "Hold 2,000 chips at once, in one run." is already actionable and gets
    // no override), so the shelf keeps its riddle and the door gets a sign.
    unlockHint: 'Beat ACT III once to reveal the secret fourth act. Clear THAT, and she is yours.',
    suitNotes: [...SUIT_NOTES],
  },
  /**
   * DRUSKY, THE HOARDER — the fifth hero, and the first LOCKED one.
   *
   * SUIT: DIAMONDS, shared with The Bull. The four suits were spoken for and
   * there is no fifth, so the question was which one he could share without
   * stepping on its owner. Diamonds, because his kit never touches a suit rule
   * at all: The Bull BENDS Diamonds (they hit twice as hard) while Drusky only
   * ever bends the CHIP economy, so the two sit side by side without either
   * one's sheet needing an exception. Diamonds is also the game's treasure
   * suit, which is the whole of what a hoarder is about, and it pays Shield
   * alongside its damage, which is exactly what a man who needs time to pile
   * chips up wants. His `suitNotes` are therefore the shared defaults,
   * unedited: nothing about a suit reads differently for him.
   *
   * `unlock` names an ACHIEVEMENT id (see progress.isCharacterUnlocked). It is
   * the only field of its kind today; a hero without one is open from the start,
   * which is every other hero.
   */
  hoarder: {
    id: 'hoarder', suit: 'gems', name: 'DRUSKY', title: 'The Hoarder',
    // "pays 50% more" never said more of WHAT. The leftover bonus is paid in
    // chips (run.leftoverHandChips), so the line says chips.
    kit: `Chips are power. Every ${HOARD_CHIP_STEP} chips he is holding add +${HOARD_MULT_PER_STEP} mult, and every hand he did not need pays ${Math.round(HOARD_LEFTOVER_BONUS * 100)}% more chips.`,
    status: 'greed', statusLabel: 'Greed',
    // What a hand he did NOT need is worth on top, applied at the end of the
    // purse (CombatScene.chipsPerHandLeft). Carried on the def rather than
    // special-cased in the scene, so a future hero needs no code edit.
    leftoverChipPct: HOARD_LEFTOVER_BONUS,
    sprite: 'hero_drusky',
    unlock: 'theHoard',
    suitNotes: [...SUIT_NOTES],
  },
};

export const PLAYER_BASE = {
  // 2026-08-01 BALANCE PASS (JC, post-friend-playtest "the game pulls you in a
  // lot of directions"): the run got roomier to think in. 80 -> 100 max HP and
  // 3 -> 4 discards a fight. Every percentage heal in the game (Second Wind
  // 25%, Fairy in a Bottle 50%, the act-clear 30%) reads run.player.maxHp live,
  // so they all follow this number without a second edit.
  maxHp: 100, handSize: 8, discardsPerFight: 4,
};
