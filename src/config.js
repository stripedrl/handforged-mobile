// HANDFORGED — layout + palette constants (desktop-first 1920x1080, locked)

// Build stamp — shown on the title screen so playtest feedback can name a
// version. Bump this string every time a build goes out to testers.
export const BUILD = 'alpha 0.25';

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
 * spreads to fill the phone naturally. Elements that need to be finger-
 * sized carry their own `MOBILE ?` bumps at their definitions.
 */
export const MOBILE = (typeof window !== 'undefined')
  && (window.__HF_MOBILE === true
    || new URLSearchParams(window.location?.search ?? '').has('mobile'));

export const GAME_W = MOBILE ? 2340 : 1920;
export const GAME_H = 1080;
export const VIEW_W = GAME_W;   // the canvas IS the world now, both builds

/** V1's camera shift, retired: the world fills the canvas. Kept as a no-op
 *  so the scenes' create() calls stay harmless. */
export function applyMobileCamera() {}

export const SIDEBAR_W = MOBILE ? 420 : 340;

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

export const CARD = {
  w: 140, h: 210,          // display size — true 2:3, matches Caleb's painted card faces
  fanY: 938,               // hand fan baseline (raised for the taller cards)
  fanCenterX: (SIDEBAR_W + GAME_W) / 2,
  fanSpread: MOBILE ? 112 : 96,   // px between card centers (wider fan on the wide screen)
  hoverLift: 34,
  selectLift: 56,
  playedY: 668,
  // Painted-face safe zone: the ornate frame eats ~9-13% per side, and the
  // corner filigree bites further in on the diagonal. Everything printed on
  // the card is anchored off these so a frame swap never needs a code change.
  padX: 30,                // corner cluster: x inset from the card's side edge
  padY: 24,                // corner cluster: y inset from the card's top/bottom
  cornerColW: 26,          // width of the rank/pip column ('10' shrinks to fit)
  cornerPip: 24,           // corner pip display box
  cornerGap: 3,            // px between the rank's painted ink and the pip below it
  pipY: 10,                // center pip offset from card center (down is +)
  bannerY: 34,             // mod banner text: distance up from the card's bottom edge
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
    kit: 'Fewer cards, bigger hits: 1-card hands ×4 mult, 2-card ×3, 3-card ×2.',
    status: 'bleed', statusLabel: 'Bleed',
    sprite: 'hero_duelist',
    suitNotes: [...SUIT_NOTES],
  },
  zealot: {
    id: 'zealot', suit: 'hearts', name: 'ZELUS', title: 'The Cleric',
    kit: 'Overhealing charges ZEAL. Your next damaging hand spends every point of it, +2% damage each.',
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
    kit: 'Diamonds strike twice as hard: every Diamond card you play deals DOUBLE damage.',
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
