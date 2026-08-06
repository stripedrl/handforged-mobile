/**
 * The acts, rebuilt for the map era. Each act is a WORLD that owns a mechanic,
 * a music set, and ENCOUNTER POOLS instead of a fixed gauntlet — the map decides
 * when you fight; we decide who shows up and how hard they hit.
 *
 * Difficulty: per-act EXPONENTIAL HP curve (A·G^row) for ordinary rooms, and
 * FLAT per-act anchors for the set-pieces — `bossHpMult` for bosses and (acts
 * II+) `eliteHpMult` for elites. A boss/elite is a fixed test of your deck at
 * that point in the run, not a function of which floor the map happened to
 * put it on.
 *
 * RE-ANCHOR (JC, 2026-07-31, post-playtest: "arguably solid, couldn't scale
 * fast enough against the HP pools"). The synergy-era raise overshot — Act III
 * asked for 100,000 and Act IV for 273,600, which no honest deck reaches. The
 * whole ladder above Act I was re-anchored on TWO numbers the player named:
 *
 *     Act II elites ~1,500 · Act II final bosses ~3,500
 *
 * Act III was then re-derived (JC's amendment: harder than the pure geometric
 * step) onto a 30k boss anchor with elites on the same elite:boss ratio Act II
 * runs (~0.43), and Act IV keeps its approved 45-55k combined finale — a
 * deliberately COMPRESSED 1.68x jump off Act III, which is the point.
 *
 * Room totals below are WHOLE ENCOUNTERS (every body in the group added up),
 * lightest row-0 to heaviest row-8, as of the 2026-08-02 pass. Recomputed from
 * the live tables, not remembered: the old copy of this block had drifted.
 *
 *            regular room          elite room      bosses
 *   Act I     89 → 614             284 - 561       945 / 898 / 851      (FROZEN)
 *   Act II    200 → 2.3k           1.4k - 2.2k     3.7k / 2.8k / 4.6k
 *   Act III   1.2k → 19k           11k - 22k       38k / 38k / 26k
 *   Act IV    5.7k → 44k           37k - 48k       71k (the double finale)
 *
 * 2026-08-02 NERF PASS: Act III's boss took +20%; Act IV's boss, ordinary rooms
 * AND elites all took +35%. The elites were briefly left out on the reading that
 * JC named "the boss and enemies" separately, which inverted the act: elite
 * ROOMS sat BELOW a deep corridor, the exact shape the flat anchors exist to
 * prevent. An elite is an enemy. Flagged for sign-off.
 *
 * Every act keeps its own INTERNAL shape: the deepest ordinary room reads at
 * 0.50-0.65 of that act's heaviest boss, exactly as before, and no elite room
 * ever out-HPs the boss. Act I is deliberately untouched — it is the tutorial
 * and it already reads right.
 */
import { ENEMY_DEFS as E, hasWaveMechanic } from './enemies.js';
import { MAP_ROWS, FORGED_HP_MULT, FORGED_DMG_MULT } from './map.js';
// THE GATE (2026-08-03). An alternate world is EARNED, and the record of what
// you earned is the trophy shelf — see ALT_UNLOCK below. This edge is safe and
// deliberately shallow: progress.js reaches only poker/deck/config/difficulty,
// none of which reach back here, so the module graph stays acyclic even though
// run.js -> acts.js -> enemies.js already is not.
import { isAchievementUnlocked } from './progress.js';

export const ACTS = [
  {
    id: 'verdant',
    num: 1, numeral: 'I', name: 'Verdant Forest', mechanic: 'Bleed',
    bgKey: 'bg_forest_verdant', bgTint: 0xffffff, ambience: 'forest',
    music: { fight: 'fight_forest', boss: 'boss_forest' },
    // FROZEN (JC, 2026-07-31): Act I is exactly right and is never retuned.
    // It also declares no `eliteHpMult`, so its elites keep riding the row
    // curve — byte-for-byte the act that shipped.
    curve: { A: 0.85, G: 1.09 }, dmgBase: 1.0, fx: 0, bossHpMult: 1.8,
    bossIcon: 'boss_icon_wolfowl',
    bossName: 'WOLFOWL',
    bossBlurb: 'Hypnotic Gaze: one card in your hand is marked and must be played with your next hand. Discarding it only marks another.',
    bosses: [
      {
        id: 'wolfowl', defs: [E.wolfowl], icon: 'boss_icon_wolfowl', name: 'WOLFOWL',
        blurb: 'Hypnotic Gaze: one card in your hand is marked and must be played with your next hand. Discarding it only marks another.',
      },
      {
        id: 'fairyKing', defs: [E.fairyKing], icon: 'boss_icon_fairy_king', name: 'THE FAIRY KING',
        blurb: 'Rooted: you are dealt two fewer cards, for the whole fight.',
      },
      {
        id: 'sabreRabbit', defs: [E.sabreRabbit], icon: 'boss_icon_sabre_rabbit', name: 'SABRE-TOOTHED RABBIT',
        blurb: 'Hopquake: every card in your hand is given a random suit.',
      },
    ],
    pools: {
      early: [
        [E.wolfCub, E.greenSlime],
        [E.wolfCub, E.wolfCub],
        [E.wildBoar],
        [E.greenSlime, E.greenSlime],
        [E.wildBoar, E.wolfCub],
        [E.woodlingImp, E.woodlingImp],
        [E.shroomFiend],
        [E.knightHawk],
        [E.woodlingImp, E.shroomFiend],
        [E.wolfCub, E.greenSlime, E.wolfCub],
      ],
      late: [
        [E.wildBoar, E.wildBoar],
        [E.greenSlime, E.wildBoar, E.greenSlime],
        [E.wolfCub, E.wolfCub, E.wolfCub],
        [E.wildBoar, E.greenSlime, E.wolfCub],
        [E.knightHawk, E.knightHawk],
        [E.shroomFiend, E.woodlingImp, E.woodlingImp],
        [E.knightHawk, E.shroomFiend],
        [E.wildBoar, E.knightHawk],
        [E.wolfCub, E.wildBoar, E.wolfCub],
        // CUT AND RUN, one entry per act and only in the LATE pool.
        [E.woodlingCutpurse, E.woodlingImp],
      ],
      elite: [
        [E.alphaWolf],
        [E.alphaBoar],
        [E.treeBlight],
        [E.bearMauler],
        [E.alphaWolf, E.wolfCub],
        [E.bearMauler, E.woodlingImp],
        [E.treeBlight, E.shroomFiend],
      ],
      boss: [E.wolfowl],   // legacy default; the live pick comes from `bosses` above
    },
  },
  {
    id: 'frozen',
    num: 2, numeral: 'II', name: 'Frozen Wayside', mechanic: 'Freeze & Brittle',
    bgKey: 'bg_frozen', bgTint: 0xffffff, ambience: 'snow',
    music: { fight: 'fight_frozen', boss: 'boss_frozen' },
    // THE REFERENCE ACT (JC, 2026-07-31 re-anchor). Everything above Act I is
    // measured from here: bossHpMult 5.46875 puts the Phoenix on exactly 3,500
    // and eliteHpMult 4.5 lands the three Wayside elites on 1,350 / 1,530 /
    // 1,710 — the "~1.5k elite, ~3.5k boss" the player asked for. The row
    // curve was pulled down with them (A 5.2 → 2.0) so the deepest ordinary
    // room still reads at ~0.63 of the Phoenix, the ratio it always had.
    curve: { A: 2.0, G: 1.12 }, dmgBase: 1.2, fx: 1, bossHpMult: 5.46875, eliteHpMult: 4.5,
    bossIcon: 'boss_icon_phoenix',
    bossName: 'THE WINTER PHOENIX',
    bossBlurb: 'Blizzard: cards in your hand freeze solid and cannot be played for a turn.',
    bosses: [
      {
        id: 'winterPhoenix', defs: [E.winterPhoenix], icon: 'boss_icon_phoenix', name: 'THE WINTER PHOENIX',
        blurb: 'Blizzard: cards in your hand freeze solid and cannot be played for a turn.',
      },
      {
        id: 'frostSummoner', defs: [E.frostSummoner], icon: 'boss_icon_frost_summoner', name: 'THE FROSTBITTEN SUMMONER',
        blurb: 'Frozen Rite: he raises the frozen dead to fight beside him, three at a time.',
      },
      {
        id: 'polarGuardian', defs: [E.polarGuardian], icon: 'boss_icon_polar_guardian', name: 'THE POLAR GUARDIAN',
        blurb: "Winter's Force: every hand you play must be exactly five cards.",
      },
    ],
    pools: {
      early: [
        [E.northernFighter, E.iceElemental],
        [E.northernFighter, E.northernFighter],
        [E.iceElemental],
        [E.yeti],
        [E.iceElemental, E.northernFighter],
        [E.iceOwl],
        [E.iceOwl, E.iceOwl],
        [E.iceMage],
        [E.resurrectedEskimo],
        [E.iceOwl, E.iceMage],
        [E.northernFighter, E.yeti],
      ],
      late: [
        [E.northernFighter, E.northernFighter, E.northernFighter],   // the waddle squad
        [E.woolyMammoth],
        [E.woolyMammoth, E.yeti],
        [E.yeti, E.iceElemental],
        [E.woolyMammoth, E.northernFighter],
        [E.subZeroSerpent],
        [E.resurrectedEskimo, E.resurrectedEskimo],
        [E.iceMage, E.subZeroSerpent],
        [E.iceOwl, E.resurrectedEskimo, E.iceOwl],
        [E.subZeroSerpent, E.iceMage],
        [E.yeti, E.yeti],
        [E.iceElemental, E.woolyMammoth, E.northernFighter],
        [E.iceElemental, E.iceMage, E.iceElemental],                 // the cold front
        [E.iceOwlBandit, E.iceOwl],                                  // CUT AND RUN
      ],
      elite: [
        [E.frostGuardian],
        [E.alphaMammoth],
        [E.frostTitan],
        // E6 RIME THORNS lives on an ELITE body (JC's table named the Sub-Zero
        // Serpent, which is a regular; the regular keeps its 2-spike turn and
        // the Elder is its elite tier). 320 x the act's flat elite anchor puts
        // it on 1,512 — inside the same 1.2k-1.8k band as the other three.
        [E.subZeroElder],
        [E.alphaMammoth, E.northernFighter],
        [E.frostGuardian, E.iceElemental],
        [E.frostTitan, E.iceOwl],
        [E.subZeroElder, E.iceOwl],
        [E.frostGuardian, E.northernFighter, E.northernFighter],
      ],
      boss: [E.winterPhoenix],   // legacy default; the live pick comes from `bosses` above
    },
  },
  {
    id: 'abyss',
    num: 3, numeral: 'III', name: 'Abyss', mechanic: 'Poison & Fear',
    bgKey: 'bg_abyss', bgTint: 0xffffff, ambience: 'abyss',
    music: { fight: 'fight_abyss', boss: 'boss_abyss' },
    // THE SUMMIT, re-anchored to 30,000 (JC's amendment: the Abyss should bite
    // HARDER than a straight geometric step off Act II's 3,500 would give).
    // bossHpMult 37.5 puts the Keeper on exactly 30,000; eliteHpMult 32 lands
    // the four Abyss elites on 10.2k-14.7k, which is the SAME elite:boss ratio
    // band Act II runs (0.34-0.49, mean ~0.43). The row curve rides up with
    // them (A 32 → 9.6, G unchanged) so the deepest ordinary room is 0.59 of
    // the Keeper and the late floors ramp straight into elite territory.
    // 2026-08-02 nerf pass: the Abyss BOSS took +20% (37.5 -> 45, the Keeper
    // 30,000 -> 36,000 before the global +5% lever). Rows and elites are
    // untouched, so the act's shape is the same fight, one notch taller at the
    // top.
    curve: { A: 9.6, G: 1.15 }, dmgBase: 1.5, fx: 1, bossHpMult: 45, eliteHpMult: 32,
    bossIcon: 'boss_icon_keeper',
    bossName: 'THE KEEPER',
    bossBlurb: 'Eternal Keep: the wheel spins and seals one suit. Those cards are unplayable until it spins again.',
    bosses: [
      {
        id: 'theKeeper', defs: [E.theKeeper], icon: 'boss_icon_keeper', name: 'THE KEEPER',
        blurb: 'Eternal Keep: the wheel spins and seals one suit. Those cards are unplayable until it spins again.',
      },
      {
        // ONE entry, TWO bodies — the map names them together, the arena names
        // them apart (each def carries its own nameplate).
        id: 'daughters', defs: [E.agatha, E.sinastra], icon: 'boss_icon_daughters',
        name: 'THE DAUGHTERS OF DARKNESS',
        blurb: 'Agatha cuts cards out of your hand. Sinastra shields them both. Kill Sinastra and the shields stop.',
      },
      {
        id: 'depthKnight', defs: [E.depthKnight], icon: 'boss_icon_depth_knight', name: 'THE DEPTH KNIGHT',
        blurb: 'It is immune every other turn, and its power compounds each time.',
      },
    ],
    pools: {
      early: [
        [E.lonelyWraith, E.abyssalWarrior],
        [E.deepSerpent],
        [E.lonelyWraith, E.lonelyWraith],
        [E.abyssalWarrior],
        [E.deepSerpent, E.lonelyWraith],
        [E.corruptedCrow],
        [E.corruptedCrow, E.corruptedCrow],
        [E.ancientSlime],
        [E.ancientNecromancer],
        [E.corruptedCrow, E.ancientSlime],
        [E.abyssalWarrior, E.lonelyWraith],
      ],
      late: [
        [E.undeadGuardian, E.deepSerpent],
        [E.abyssalWarrior, E.abyssalWarrior],
        [E.undeadGuardian, E.lonelyWraith, E.lonelyWraith],
        [E.deepSerpent, E.abyssalWarrior],
        [E.ancientNecromancer, E.ancientSlime],
        [E.ancientNecromancer, E.corruptedCrow],
        [E.ancientSlime, E.ancientSlime],
        [E.ancientNecromancer, E.ancientNecromancer],
        [E.corruptedCrow, E.undeadGuardian, E.corruptedCrow],
        [E.undeadGuardian, E.undeadGuardian],
        [E.lonelyWraith, E.abyssalWarrior, E.lonelyWraith],
        [E.deepSerpent, E.undeadGuardian, E.deepSerpent],
        [E.coinsnatchCrow, E.corruptedCrow],                         // CUT AND RUN
      ],
      elite: [
        [E.ancientGuardian],
        [E.wellOfSouls],
        [E.twinsOfDarkness],
        [E.acidicMonstrosity],
        [E.ancientGuardian, E.lonelyWraith],
        [E.acidicMonstrosity, E.ancientSlime],
        [E.twinsOfDarkness, E.corruptedCrow],
        [E.wellOfSouls, E.lonelyWraith, E.lonelyWraith],
      ],
      boss: [E.theKeeper],   // legacy default; the live pick comes from `bosses` above
    },
  },
  {
    id: 'crucible',
    num: 4, numeral: 'IV', name: 'Crucible', mechanic: 'Everything, harder',
    bgKey: 'bg_abyss', bgTint: 0xd08070, ambience: 'abyss', secret: true,
    music: { fight: 'fight_abyss', boss: 'boss_abyss' },
    // THE COMPRESSED FINALE (JC's explicit call): only 1.68x Act III on the
    // boss, not the old 2.74x. The Twin Calamity's two bodies come to 50,400
    // (Phoenix 22,400 + Keeper 28,000) — the 45k-55k band he approved. Its
    // elite pools field TWO elites each, so the elite anchor is per-BODY and
    // the encounters land 24k-34k: a little over half the finale, matching
    // Act III's elite:boss shape. The Crucible therefore OPENS softer than the
    // Abyss closed (row-0 ~5.6k against the Abyss's ~12.7k summit) — that is
    // the compression showing, and it is deliberate: the Crucible's test is
    // its elites and its finale, not its corridors.
    // 2026-08-02 nerf pass: the Crucible's BOSS and its ORDINARY ROOMS both took
    // +35% (curve A 17 -> 22.95, bossHpMult 35 -> 47.25). The finale is one
    // roster entry with TWO bodies, so both halves ride the same multiplier and
    // both move: the Twin Calamity goes 50,400 -> 68,040 before the +5% lever.
    // ELITES ride the same +35% (46 -> 62). The first pass left them alone on the
    // reading that JC named "the boss and enemies", but an elite IS an enemy, and
    // holding them back inverted the act's shape: 27.5k-35.7k elite rooms sat
    // BELOW a 44.3k deep corridor, which is the same bug the flat anchors were
    // introduced to kill. They stay a little over half the finale, as designed.
    curve: { A: 22.95, G: 1.155 }, dmgBase: 1.9, fx: 2, bossHpMult: 47.25, eliteHpMult: 62,
    bossIcon: 'boss_icon_phoenix',
    bossName: 'THE TWIN CALAMITY',
    bossBlurb: 'The Phoenix and the Keeper fight as one. Blizzard and the Eternal Keep, both at once.',
    pools: {
      early: [
        [E.alphaWolf, E.iceElemental],
        [E.yeti, E.abyssalWarrior],
        [E.woolyMammoth, E.lonelyWraith],
        [E.iceMage, E.corruptedCrow],
        [E.bearMauler, E.iceOwl],
        [E.wildBoar, E.deepSerpent, E.northernFighter],
      ],
      late: [
        [E.alphaMammoth, E.abyssalWarrior],
        [E.undeadGuardian, E.frostGuardian],
        [E.treeBlight, E.deepSerpent],
        [E.subZeroSerpent, E.ancientNecromancer],
        [E.ancientSlime, E.resurrectedEskimo, E.corruptedCrow],
        [E.wellOfSouls, E.yeti],
      ],
      elite: [
        [E.frostGuardian, E.wellOfSouls],
        [E.ancientGuardian, E.treeBlight],
        [E.frostTitan, E.twinsOfDarkness],
        [E.acidicMonstrosity, E.iceMage],
        [E.alphaMammoth, E.alphaWolf],
      ],
      boss: [E.winterPhoenix, E.theKeeper],   // the double-boss finale
    },
  },
];

// ---------------------------------------------------------------------------
// ALTERNATE ACTS (2026-08-03) — run variety without a longer run
// ---------------------------------------------------------------------------
/**
 * FOUR ALTERNATE WORLDS, NOT FOUR EXTRA ONES. A run rolls either the Verdant
 * Forest or the NOCTURNAL FOREST for Act I, either the Frozen Wayside or the
 * ETHEREAL PLAINS for Act II, either the Abyss or the BURNING GALLOWS for Act
 * III, and — since the unlocks patch — either the Crucible or THE ASHEN
 * CRUCIBLE for Act IV. The run is exactly as long as it always was; it is just
 * never the same run twice.
 *
 * ALT_ACTS is INDEX-ALIGNED to ACTS, so ALT_ACTS[0] replaces ACTS[0] and the
 * whole system is one lookup (actEntry) rather than a fifth act index that
 * every consumer would have to learn about. That alignment is the entire reason
 * the Ashen Crucible cost nothing outside this file: `run.totalActs` still tops
 * out at 4, the save still validates `ACTS[actIndex]`, and the map board, the
 * banner and the boss medallion all resolve off fields the act already carries.
 *
 * THEY ARE EARNED. See ALT_UNLOCK below: until an act's clear is banked, its
 * alternate is not in the bag at all and `rollActVariant` returns the primary
 * every single time.
 *
 * TUNING IS INHERITED, NOT INVENTED. Each alternate copies the curve, dmgBase,
 * fx, bossHpMult and eliteHpMult of the act it replaces, character for
 * character — Act I is declared FROZEN and the Nocturnal Forest is Act I, so it
 * is frozen too. That is what makes "either one" an honest offer: the run does
 * not get easier or harder for which world it drew, only different.
 *
 * MUSIC. Every alternate now has its OWN set — 34 tracks, delivered 2026-08-03
 * ("cant believe i left out music for new acts, just threw them all in"). The
 * borrowing this block used to describe is gone, including the flag raised here
 * that the Nocturnal Forest most wanted its own music: it has it.
 *
 * Each world declares THREE pools rather than two, because the drop included
 * ELITE tracks and the game had nowhere to put them — an elite room used to
 * play ordinary corridor music. See music.musicFor(), which is also what keeps
 * the four ORIGINAL acts untouched: they declare no `music.elite`, so they fall
 * back to their fight pool and are exactly the acts that shipped. No elite music
 * was invented for them out of a boss pool. They are waiting on tracks.
 */
export const ALT_ACTS = [
  {
    id: 'nocturnal',
    num: 1, numeral: 'I', name: 'Nocturnal Forest', mechanic: 'Blind',
    bgKey: 'bg_nocturnal', bgTint: 0xffffff, ambience: 'nightwood',
    // ITS OWN SET at last (2026-08-03). The wood at night used to borrow the
    // Verdant Forest's pools, which is the BRIGHTEST music in the game — the one
    // borrowing this file flagged as least defensible. Six nocturnal fight
    // tracks, two for an elite and three for the Night Mother's court.
    music: { fight: 'fight_nocturnal', elite: 'elite_nocturnal', boss: 'boss_nocturnal' },
    // ACT I IS FROZEN, so this is ACTS[0]'s tuning transcribed, not re-derived.
    // No eliteHpMult on purpose: Act I's elites ride the row curve.
    curve: { A: 0.85, G: 1.09 }, dmgBase: 1.0, fx: 0, bossHpMult: 1.8,
    bossIcon: 'boss_icon_night_mother',
    bossName: 'THE NIGHT MOTHER',
    bossBlurb: 'Scale Dust: her wings shed light and your cards come to hand face down. You can still play them. You just cannot read them.',
    bosses: [
      {
        id: 'nightMother', defs: [E.nightMother], icon: 'boss_icon_night_mother', name: 'THE NIGHT MOTHER',
        blurb: 'Scale Dust: her wings shed light and your cards come to hand FACE DOWN. Still playable, just unread.',
      },
      {
        id: 'hollowKing', defs: [E.hollowKing], icon: 'boss_icon_hollow_king', name: 'THE HOLLOW KING',
        blurb: 'The Court Sleeps: no face card may be played while he lives. You may still discard them.',
      },
      {
        id: 'grimwatch', defs: [E.grimwatch], icon: 'boss_icon_grimwatch', name: 'GRIMWATCH, THE THOUSAND-EYED',
        blurb: 'He Sees It Coming: each turn he marks your highest-VALUE card. Play it and your whole hand deals him nothing.',
      },
    ],
    pools: {
      early: [
        [E.mothling, E.mothling],
        [E.mothling, E.nightjar],
        [E.lanternToad],
        [E.nightjar, E.nightjar],
        [E.hollowFawn],
        [E.brambleStalker],
        [E.hollowFawn, E.mothling],
        [E.glowcapShambler],
        [E.dreamweaverSpider],
        [E.lanternToad, E.mothling],
        [E.nightjar, E.hollowFawn],
        // The heaviest opening room the wood offers, matched to the Verdant
        // Forest's own ceiling so an early floor never reads lighter for having
        // drawn the night.
        [E.lanternToad, E.hollowFawn, E.mothling],
      ],
      late: [
        [E.glowcapShambler, E.lanternToad],
        [E.brambleStalker, E.hollowFawn, E.mothling],
        [E.lanternToad, E.dreamweaverSpider, E.mothling],
        [E.glowcapShambler, E.brambleStalker],
        [E.hollowFawn, E.hollowFawn, E.nightjar],
        [E.dreamweaverSpider, E.dreamweaverSpider],
        [E.glowcapShambler, E.nightjar, E.nightjar],
        [E.lanternToad, E.lanternToad],
        [E.brambleStalker, E.dreamweaverSpider],
        // CUT AND RUN, one entry per act and only in the LATE pool.
        [E.pocketMoth, E.mothling],
      ],
      elite: [
        [E.sleeplessStag],
        [E.widowCanopy],
        [E.strixursa],
        [E.moonwellHorror],
        [E.sleeplessStag, E.mothling],
        [E.moonwellHorror, E.dreamweaverSpider],
        [E.widowCanopy, E.mothling],
      ],
      boss: [E.nightMother],   // legacy default; the live pick comes from `bosses`
    },
  },
  {
    id: 'ethereal',
    num: 2, numeral: 'II', name: 'Ethereal Plains', mechanic: 'Fade',
    bgKey: 'bg_ethereal', bgTint: 0xffffff, ambience: 'motes',
    // ITS OWN SET (2026-08-03), eight fight tracks deep — the largest pool in
    // the game. It no longer stands in the Wayside's cold crystalline music;
    // this set is the drifting, weightless one written for the Plains.
    music: { fight: 'fight_ethereal', elite: 'elite_ethereal', boss: 'boss_ethereal' },
    // ACTS[1]'s tuning, transcribed. The Plains ARE Act II.
    curve: { A: 2.0, G: 1.12 }, dmgBase: 1.2, fx: 1, bossHpMult: 5.46875, eliteHpMult: 4.5,
    bossIcon: 'boss_icon_pale_architect',
    bossName: 'THE PALE ARCHITECT',
    bossBlurb: 'Scaffold: he raises a wall each turn and shows the one hand type that breaks it. Nothing reaches him until it does.',
    bosses: [
      {
        id: 'paleArchitect', defs: [E.paleArchitect], icon: 'boss_icon_pale_architect', name: 'THE PALE ARCHITECT',
        blurb: 'Scaffold: he raises a wall each turn and shows the one hand type that breaks it. Nothing reaches him until it does.',
      },
      {
        id: 'seraphStill', defs: [E.seraphStill], icon: 'boss_icon_seraph_still', name: 'SERAPH OF THE STILL',
        blurb: 'Nothing Twice: she only takes damage from hand types you have not played yet this fight.',
      },
      {
        id: 'theUnmade', defs: [E.theUnmade], icon: 'boss_icon_the_unmade', name: 'THE UNMADE',
        blurb: 'Weightless: any card still in your hand at the end of the turn drifts away and is gone for the fight.',
      },
    ],
    pools: {
      early: [
        [E.veilkin, E.moteSwarm],
        [E.moteSwarm, E.moteSwarm],
        [E.veilkin],
        [E.glassSylph],
        [E.echoKnight],
        [E.thoughtlessOne],
        [E.glassSylph, E.moteSwarm],
        [E.prismStag],
        [E.veilkin, E.glassSylph],
        [E.driftbeast],
        [E.thoughtlessOne, E.moteSwarm],
      ],
      late: [
        [E.driftbeast, E.echoKnight],
        [E.driftbeast, E.prismStag],
        [E.prismStag, E.echoKnight, E.glassSylph],
        [E.thoughtlessOne, E.thoughtlessOne],
        [E.echoKnight, E.echoKnight],
        [E.veilkin, E.driftbeast, E.moteSwarm],
        [E.prismStag, E.prismStag],
        [E.glassSylph, E.thoughtlessOne, E.veilkin],
        [E.driftbeast, E.moteSwarm, E.moteSwarm],
        [E.echoKnight, E.prismStag],
        [E.veilkin, E.echoKnight, E.veilkin],
        [E.thoughtlessOne, E.glassSylph, E.glassSylph],
        // CUT AND RUN.
        [E.whisperThief, E.moteSwarm],
      ],
      elite: [
        [E.mirrorwalker],
        [E.choirOfMotes],
        [E.longSleeper],
        [E.weftWarden],
        [E.mirrorwalker, E.echoKnight],
        [E.choirOfMotes, E.glassSylph],
        [E.longSleeper, E.veilkin],
        [E.weftWarden, E.moteSwarm],
        [E.choirOfMotes, E.moteSwarm, E.moteSwarm],
      ],
      boss: [E.paleArchitect],
    },
  },
  {
    id: 'gallows',
    num: 3, numeral: 'III', name: 'Burning Gallows', mechanic: 'Burned',
    bgKey: 'bg_gallows', bgTint: 0xffffff, ambience: 'ash',
    // ITS OWN SET (2026-08-03). Delivered as "3 ashlands", which is this world:
    // the drop's own track titles name it — Burn, Exile, Devil's Own, SPARKS,
    // Demolition Crew — and there is no fourth biome for them to belong to. It
    // no longer borrows the Abyss's dread; it brings its own fire.
    music: { fight: 'fight_gallows', elite: 'elite_gallows', boss: 'boss_gallows' },
    // ACTS[2]'s tuning, transcribed. The Gallows ARE Act III.
    curve: { A: 9.6, G: 1.15 }, dmgBase: 1.5, fx: 1, bossHpMult: 45, eliteHpMult: 32,
    bossIcon: 'boss_icon_magistrate',
    bossName: 'THE MAGISTRATE',
    bossBlurb: 'Double Jeopardy: each hand type may be played once for the whole fight. Play a Pair and you have played your only Pair.',
    bosses: [
      {
        id: 'magistrate', defs: [E.magistrate], icon: 'boss_icon_magistrate', name: 'THE MAGISTRATE',
        blurb: 'Double Jeopardy: each hand type may be played once for the whole fight. Play a Pair and you have played your only Pair.',
      },
      {
        id: 'pyreheart', defs: [E.pyreheart], icon: 'boss_icon_pyreheart', name: 'PYREHEART, THE UNBURNT',
        blurb: 'Struck From The Record: every card you play is burned and can never be played again this fight.',
      },
      {
        id: 'ropemaker', defs: [E.ropemaker], icon: 'boss_icon_ropemaker', name: 'THE ROPEMAKER',
        blurb: 'The Queue: each turn it hangs one of your relics, left to right. A hanged relic does nothing for the rest of the fight.',
      },
    ],
    pools: {
      early: [
        [E.ashCrow],
        [E.ashCrow, E.pyreZealot],
        [E.gallowsHound],
        [E.ashCrow, E.ashCrow],
        [E.emberWisp],
        [E.theCondemned],
        [E.pyreZealot],
        [E.smokeWeaver],
        [E.pyreZealot, E.ashCrow],
        [E.cinderGolem],
        [E.gallowsHound, E.ashCrow],
        [E.theCondemned, E.pyreZealot],
      ],
      late: [
        [E.cinderGolem, E.gallowsHound],
        [E.cinderGolem, E.cinderGolem],
        [E.theCondemned, E.theCondemned, E.gallowsHound],
        [E.cinderGolem, E.emberWisp, E.ashCrow],
        [E.gallowsHound, E.pyreZealot, E.smokeWeaver],
        [E.smokeWeaver, E.cinderGolem],
        [E.pyreZealot, E.pyreZealot, E.emberWisp],
        [E.theCondemned, E.cinderGolem],
        [E.ashCrow, E.gallowsHound, E.ashCrow],
        [E.emberWisp, E.smokeWeaver, E.theCondemned],
        [E.gallowsHound, E.gallowsHound],
        [E.smokeWeaver, E.emberWisp],
        // CUT AND RUN.
        [E.ashArcher, E.ashCrow],
      ],
      elite: [
        [E.hangman],
        [E.brazierTitan],
        [E.gallowsTree],
        [E.wardenCoals],
        [E.hangman, E.ashCrow],
        [E.brazierTitan, E.pyreZealot],
        [E.wardenCoals, E.smokeWeaver],
        [E.gallowsTree, E.ashCrow],
      ],
      boss: [E.magistrate],
    },
  },
  /**
   * =====================================================================
   * THE ASHEN CRUCIBLE — the fourth alternate, and the only remix one
   * =====================================================================
   * JC: "act IV probably needs some love... a reskinned (or recolored) version
   * of the burned gallows where mixes and matches from different enemy types
   * can appear up until a final dual boss of some sort. The enemies are
   * generally mashes from the new biomes."
   *
   * IT IS THE GALLOWS, GONE OUT. Every piece of furniture is borrowed from the
   * Burning Gallows and recoloured, exactly the way the shipped Crucible
   * borrows the Abyss's: the same battle backdrop (`bg_gallows`), the same map
   * board and title plate (both keyed off `ambience: 'ash'`), the same music.
   * `secret: true` is what scorches the borrowed board and banner, and
   * `secretTint` is what makes THIS one's scorch cold — the Crucible's 0xd08070
   * pushes its Abyss red HOTTER, but the Gallows are already on fire, so the
   * only recolour that says anything new is the fire going OUT.
   *
   * THE POOLS ARE THE POINT. Every room draws from all three new biomes at
   * once, and not one group is monobiome: a Gallows Hound stands beside a
   * Veilkin, an Ash Crow beside a Hollow Fawn. That mixing IS this act's
   * identity, precisely as remixing the three ORIGINAL worlds is the shipped
   * Crucible's — which is also why this world fields no biome MECHANIC of its
   * own. BLIND, FADE and BURNED all walk in on the bodies that own them, and
   * meeting all three in one corridor is the act.
   *
   * TUNING IS INHERITED, CHARACTER FOR CHARACTER, from ACTS[3]. Not one handle
   * is re-derived. The rooms were then built to land inside the Crucible's own
   * measured bands (see tests/patch_unlocks.test.js), so drawing the Ashen
   * Crucible is a different act and not a harder or softer one.
   *
   * THE CHOIR OF MOTES IS DELIBERATELY NOT IN THESE POOLS. It is the one
   * creature of the 45 with no art (it wears a luminance re-map of the Mote
   * Swarm), and a brand-new act is not the place to double how often the
   * placeholder is on screen. Put it back the day the painting lands.
   */
  {
    id: 'ashen',
    num: 4, numeral: 'IV', name: 'Ashen Crucible', mechanic: 'All three, at once',
    bgKey: 'bg_gallows', bgTint: 0x98a0c8, ambience: 'ash', secret: true,
    // The scorch on the borrowed board and banner. See `secretTint` in MapScene:
    // the Crucible's own default is 0xd08070 and is untouched.
    secretTint: 0x9c9ec0,
    // THE GALLOWS' SET, inherited exactly the way the board, the backdrop and
    // the ambience already are — including its ELITE pool, which matters here
    // more than anywhere: every elite room in this act fields TWO elites, so it
    // is the act that stands in an elite room longest.
    music: { fight: 'fight_gallows', elite: 'elite_gallows', boss: 'boss_gallows' },
    // ACTS[3]'s tuning, transcribed. The Ashen Crucible IS Act IV, so it rides
    // the same compressed finale curve, the same +35% nerf-pass anchors and the
    // same per-BODY elite anchor (its elite rooms field two elites each, exactly
    // as the Crucible's do).
    curve: { A: 22.95, G: 1.155 }, dmgBase: 1.9, fx: 2, bossHpMult: 47.25, eliteHpMult: 62,
    // THE MEDALLION wears the CROWN, not the gavel. The Magistrate's disc is
    // already the face of the Burning Gallows, and an Act IV whose medallion is
    // pixel-identical to Act III's would read as a bug rather than as a callback.
    bossIcon: 'boss_icon_hollow_king',
    bossName: 'THE LAST COURT',
    // RULES FIRST. This blurb is what the boss medallion prints on hover, and it
    // used to open on who is sitting there rather than on what they do to you.
    bossBlurb: 'No face card may be played, and each hand type may be played once for the whole fight. The Hollow King and the Magistrate sit as one bench.',
    pools: {
      early: [
        [E.lanternToad, E.moteSwarm],
        [E.gallowsHound, E.veilkin],
        [E.ashCrow, E.hollowFawn, E.nightjar],
        [E.pyreZealot, E.glassSylph],
        [E.emberWisp, E.dreamweaverSpider],
        [E.theCondemned, E.echoKnight, E.mothling],
      ],
      late: [
        [E.cinderGolem, E.driftbeast],
        [E.brambleStalker, E.smokeWeaver, E.prismStag],
        [E.glowcapShambler, E.thoughtlessOne, E.gallowsHound],
        [E.theCondemned, E.prismStag],
        [E.dreamweaverSpider, E.cinderGolem, E.ashCrow],
        [E.emberWisp, E.echoKnight, E.glowcapShambler],
      ],
      elite: [
        [E.hangman, E.mirrorwalker],
        [E.brazierTitan, E.sleeplessStag],
        [E.gallowsTree, E.longSleeper],
        [E.wardenCoals, E.moonwellHorror],
        [E.weftWarden, E.widowCanopy],
        [E.strixursa, E.wardenCoals],
      ],
      /**
       * THE LAST COURT — ONE roster entry, TWO bodies, balanced the way THE TWIN
       * CALAMITY already is. Both halves ride the act's single `bossHpMult`, so
       * the PAIR lands on the Crucible's combined finale number instead of
       * double it, and both signatures run at once because that is the fight.
       *
       * THE COURT SLEEPS (every face card locked) stacked on DOUBLE JEOPARDY
       * (each hand type spent permanently) is the two harshest denials in the
       * game running together, and it took a real repair to make legal — see
       * biomes.mistrialDue and CombatScene.checkMistrial. The MISTRIAL now
       * measures the hand you can actually PLAY rather than the cards you happen
       * to be holding, and the King's death really does wake the court.
       */
      boss: [E.hollowKing, E.magistrate],
    },
  },
];

// ---------------------------------------------------------------------------
// THE GATE (2026-08-03) — an alternate world is EARNED
// ---------------------------------------------------------------------------
/**
 * WHICH TROPHY OPENS WHICH WORLD, index-aligned to ALT_ACTS.
 *
 * The unlock is the act's OWN CLEAR, and the record of that clear already
 * exists: `actOne`..`actFour` fire from bossDefeated on exactly this event and
 * have since long before alternate worlds did. Reusing them rather than minting
 * four more achievements that fire off the same kill is deliberate (PATCH
 * UNLOCKS §1): two trophies toasting off one boss is noise, and one trophy that
 * grants two things is the shape the Crucible's own achievement already has,
 * since that one opens Ophelia as well.
 *
 * Clearing the ALTERNATE counts too, and needs no code to do so: the fire path
 * is `{ act: this.act.num }`, and an alternate carries the same `num` as the
 * world it replaces. That only ever matters for the Ashen Crucible's gate (you
 * cannot unlock what is already unlocked), and it matters there because Act IV
 * can be cleared in either Crucible.
 */
export const ALT_UNLOCK = ['actOne', 'actTwo', 'actThree', 'actFour'];

/**
 * Is act `actIndex`'s alternate in the bag yet? A fresh profile answers FALSE
 * for all four, which is the whole point: until you have beaten a world once,
 * you have never seen anything but it.
 */
export function isVariantUnlocked(actIndex) {
  const slot = actSlotFor(actIndex);
  if (!ALT_ACTS[slot]) return false;
  const trophy = ALT_UNLOCK[slot];
  return !trophy || isAchievementUnlocked(trophy);
}

/**
 * The worlds this act may actually ROLL right now — the primary alone until its
 * alternate is earned, both of them forever after.
 *
 * Deliberately NOT the same function as actVariants(). That one answers "what
 * could this act ever be", and it has to keep answering that even for a locked
 * world, because it is what actEntry resolves a SAVED pick through: a run
 * carried across an update, or pinned by a verification driver, must still
 * resume into the world it was actually built in.
 */
export function rollableVariants(actIndex) {
  const v = actVariants(actIndex);
  return isVariantUnlocked(actIndex) ? v : v.slice(0, 1);
}

/**
 * Both worlds an act index may turn out to be, primary first — EARNED OR NOT.
 * An act with no alternate declared hands back a one-entry list and every
 * caller keeps working without a special case.
 *
 * This is the LOOKUP, not the bag. Use rollableVariants() to ask what may be
 * drawn; use this to ask what an id could possibly mean.
 */
export function actVariants(actIndex) {
  // ENDLESS cycles: act index 4 is Act I's world again, 5 is Act II's, and so
  // on forever. actSlotFor is the ONE place that arithmetic lives, so every
  // consumer of actVariants/actEntry/actOf inherits the cycle for free.
  const slot = actSlotFor(actIndex);
  return [ACTS[slot], ALT_ACTS[slot]].filter(Boolean);
}

/**
 * Roll ONE world for this act index. Called once per run, at run start.
 *
 * GATED (PATCH UNLOCKS §1): until the act's clear is banked, the bag holds only
 * the primary and this returns it 100% of the time — not 50/50, not "usually".
 * From the next run after that clear it is a straight 50/50, every run, forever.
 */
export function rollActVariant(actIndex, rng = Math.random) {
  const v = rollableVariants(actIndex);
  return v[Math.floor(rng() * v.length)].id;
}

/**
 * The act this run is actually walking, by index and pick id. Falls back to the
 * PRIMARY world for an unknown id, a missing pick, or a save written before
 * alternate acts existed — so an old save resumes into the world it was built
 * in rather than into undefined.
 */
export function actEntry(actIndex, pickId = null) {
  const v = actVariants(actIndex);
  return v.find(a => a.id === pickId) ?? v[0];
}

/** Every world in the game, primaries then alternates. Verification sweeps. */
export function allActs() {
  return [...ACTS, ...ALT_ACTS];
}

// ---------------------------------------------------------------------------
// ENDLESS (2026-08-05) — the run that does not stop
// ---------------------------------------------------------------------------
/**
 * ENDLESS IS A CONTINUATION, NOT A MODE. It is offered at the moment an Act IV
 * boss dies on a profile that has ALREADY cleared Act IV once, and taking it
 * simply lets `run.actIndex` keep counting: 4, 5, 6, 7, 8...
 *
 * WHAT AN ENDLESS INDEX MEANS. Two numbers fall out of one index and nothing
 * else in the game has to learn a third:
 *
 *   actSlotFor(i)     WHICH WORLD you are walking. 4 -> Act I's slot, 5 -> II,
 *                     6 -> III, 7 -> IV, 8 -> I again. Content only: the
 *                     pools, the music, the board, the banner, the bosses and
 *                     the alternate-world roll all resolve through it, so the
 *                     Nocturnal Forest still turns up on its normal 50/50 the
 *                     moment its trophy is on the shelf.
 *   endlessLoop(i)    HOW MANY TIMES AROUND. Loop 1 is indices 4-7, loop 2 is
 *                     8-11. Drives the per-loop hue and every label.
 *
 * ...and one more, the one that actually hurts:
 *
 *   endlessDepth(i)   k, the endless act number, 1-based. THE SCALING KEY.
 *
 * THE WALL IS HP, AND IT IS EXPONENTIAL (JC's number, exactly): the boss of
 * endless act k must land on 1,000,000 x 10^(k-1). Endless Act I's boss is a
 * flat million; endless Act III's is a hundred million; endless Act IV's is a
 * billion. Loop 2 ends at ten trillion.
 *
 * It is implemented as a RATIO, never as a table of measured numbers: the
 * target divided by what THIS world's rolled boss would naturally have weighed
 * at BRONZE. Everything in the act rides the same ratio, so an ordinary
 * corridor and an elite room stay in exactly the proportion to the boss that
 * the act was tuned to have. The DIFFICULTY's own enemyHp multiplier then
 * stacks on top, untouched — a MYTHRIL endless act really is 2x this wall.
 *
 * ENEMY DAMAGE IS DELIBERATELY NOT ON THAT CURVE. The endless is meant to kill
 * you by attrition, not by a one-shot on the opening turn, so damage grows at
 * 1.12^k and stops dead at 4x.
 *
 * !!! FIRST-PASS TUNE !!! The 1.12 and the 4x cap are a starting guess and
 * have never been played. The HP curve is the player's own number and is not.
 */

/** The first act index that is ENDLESS. Act IV is index 3, so the endless opens here. */
export const ENDLESS_START_INDEX = ACTS.length;

/** Is this act index past the end of the ordinary game? */
export function isEndlessIndex(actIndex) {
  return Number.isFinite(actIndex) && actIndex >= ENDLESS_START_INDEX;
}

/**
 * WHICH ACT SLOT (0-3) an index resolves to. Ordinary indices are themselves;
 * endless indices wrap. This is the ONLY place the cycle is computed.
 */
export function actSlotFor(actIndex) {
  const i = Math.floor(Number(actIndex) || 0);
  const n = ACTS.length;
  return ((i % n) + n) % n;
}

/** k: the endless act number, 1-based. 0 for an ordinary act. */
export function endlessDepth(actIndex) {
  return isEndlessIndex(actIndex) ? Math.floor(actIndex) - ENDLESS_START_INDEX + 1 : 0;
}

/** L: which lap of the four worlds this is, 1-based. 0 for an ordinary act. */
export function endlessLoop(actIndex) {
  return isEndlessIndex(actIndex)
    ? Math.floor((Math.floor(actIndex) - ENDLESS_START_INDEX) / ACTS.length) + 1
    : 0;
}

/** Target boss HP for endless act k. T(1) = 1e6, x10 every act after. */
export const ENDLESS_BOSS_HP_BASE = 1e6;
export const ENDLESS_BOSS_HP_STEP = 10;
export function endlessBossTarget(k) {
  return ENDLESS_BOSS_HP_BASE * Math.pow(ENDLESS_BOSS_HP_STEP, Math.max(0, k - 1));
}

/**
 * What the boss ROOM of this world weighs before difficulty and before endless
 * — every body in the entry (the Twin Calamity is two), on the act's own flat
 * boss anchor, through the global lever. Derived from the live tables; nothing
 * measured is written down.
 */
export function naturalBossHp(act, bossPickId = null) {
  const defs = bossEntry(act, bossPickId)?.defs ?? [];
  const printed = defs.reduce((s, d) => s + (d?.maxHp ?? 0), 0);
  return printed * (act?.bossHpMult ?? 1) * ENEMY_HP_SCALE;
}

/**
 * The multiplier EVERY body in an endless act rides — boss, elite, escort and
 * trash alike. 1 outside the endless, so the ordinary game is byte-for-byte
 * the game that shipped.
 */
export function endlessHpFactor(actIndex, act, bossPickId = null) {
  const k = endlessDepth(actIndex);
  if (k < 1) return 1;
  const natural = naturalBossHp(act, bossPickId);
  return natural > 0 ? endlessBossTarget(k) / natural : 1;
}

/** The gentle half: enemy damage in endless act k. Capped, on purpose. */
export const ENDLESS_DMG_STEP = 1.12;
export const ENDLESS_DMG_CAP = 4;
export function endlessDmgFactor(actIndex) {
  const k = endlessDepth(actIndex);
  if (k < 1) return 1;
  return Math.min(ENDLESS_DMG_CAP, Math.pow(ENDLESS_DMG_STEP, k));
}

/**
 * THE PER-LOOP HUE. Each full lap of the four worlds re-lights them, exactly
 * the way the Crucible scorches the Abyss it borrows — spectral violet,
 * abyssal teal, molten gold, blood crimson, ghost green, frost blue, and then
 * around again. Same world, different light.
 */
export const ENDLESS_TINTS = [0xb89ce0, 0x7fc8c0, 0xd8b060, 0xc87878, 0x9cc89c, 0x8cacd8];

/** The loop's colour for an act index, or null outside the endless. */
export function endlessTint(actIndex) {
  const loop = endlessLoop(actIndex);
  return loop ? ENDLESS_TINTS[(loop - 1) % ENDLESS_TINTS.length] : null;
}

/** "Loop 2 · Act III" — the depth label every surface prints. */
export function endlessLabel(actIndex) {
  if (!isEndlessIndex(actIndex)) return '';
  const act = ACTS[actSlotFor(actIndex)];
  return `Loop ${endlessLoop(actIndex)} · Act ${act?.numeral ?? '?'}`;
}

// ---------------------------------------------------------------------------
// BOSS VARIETY (JC, 2026-07-31)
// ---------------------------------------------------------------------------
/**
 * Every act (except the Crucible finale, which is its fixed remix) fields a
 * ROSTER of possible bosses. One is rolled per run when the act's map is
 * generated and stored on the map as `bossPick` — so it survives every scene
 * restart, and the medallion can advertise exactly who is waiting up there.
 *
 * Act IV has no `bosses` array; `bossRoster()` synthesises its single entry
 * from the act's legacy bossIcon/bossName/bossBlurb + pools.boss, which keeps
 * the double-boss finale byte-for-byte what it was.
 */
export function bossRoster(act) {
  if (act?.bosses?.length) return act.bosses;
  return [{
    id: 'default', defs: act?.pools?.boss ?? [], icon: act?.bossIcon,
    name: act?.bossName, blurb: act?.bossBlurb,
  }];
}

/** Roll ONE boss entry for this act. Call once, at map generation. */
export function rollBoss(act, rng = Math.random) {
  const roster = bossRoster(act);
  return roster[Math.floor(rng() * roster.length)];
}

/** The rolled entry by id, with a safe fallback to the roster's first. */
export function bossEntry(act, id) {
  const roster = bossRoster(act);
  return roster.find(b => b.id === id) ?? roster[0];
}

/**
 * THE GLOBAL HP LEVER (JC, 2026-08-01, off the god-run).
 *
 * +5% on EVERY enemy pool in the game — trash, escorts, elites and bosses, in
 * every act — because the SCALER relics raised the player's ceiling and the
 * bodies had to come up to meet it. One constant, applied to the row curve and
 * to both flat set-piece multipliers, so the shape of every curve is untouched
 * and the whole change is one number to turn.
 *
 * !!! ACT I WAS PREVIOUSLY DECLARED FROZEN !!! JC asked for "general hp pools
 * +5%" without naming an exception, so this applies to Act I too — the Wolf Cub
 * goes 159 -> 167 at the summit of its curve, which is imperceptible. If the
 * freeze was meant to hold, gate this on `act.num > 1` and nothing else changes.
 */
export const ENEMY_HP_SCALE = 1.05;

/**
 * The last Act I ORDINARY row that stays mechanically clean (0-indexed, so 1 =
 * floors 1 and 2 on the HUD). Elites and the boss are exempt — they are the
 * tier where mechanics live.
 */
export const WARMUP_ROWS = 1;

/**
 * Roll the encounter for a map node. Deeper rows spawn from the 'late' pool
 * and scale up; elites/bosses use their own pools.
 * @param bossPickId which of the act's bosses this run drew (map.bossPick)
 * @param actIndex   the run's act index — 0-3 is the ordinary game and changes
 *                   nothing; 4+ is ENDLESS and applies that act's HP wall and
 *                   damage curve to every body in the room. Defaults to 0 so
 *                   every existing caller and test is untouched.
 * @returns {{ defs: object[], scaling: { hp: number, hpMinor?: number, dmg: number, fx: number } }}
 */
export function rollEncounter(act, node, rng = Math.random, bossPickId = null, actIndex = 0) {
  let pool;
  if (node.type === 'boss') pool = [bossEntry(act, bossPickId).defs];
  else if (node.type === 'elite') pool = act.pools.elite;
  else pool = node.row >= 5 ? act.pools.late : act.pools.early;
  // THE WARM-UP (JC, 2026-08-02): "some fights should just be simple like the
  // first one or two in Act I". So Act I's opening ordinary floors field only
  // plain attackers — the mechanics wave is filtered out rather than curated
  // into a second pool that would drift the moment anyone edited the first.
  if (act?.num === 1 && node.type === 'fight' && node.row <= WARMUP_ROWS) {
    const clean = pool.filter(group => group.every(d => !hasWaveMechanic(d)));
    if (clean.length) pool = clean;
  }
  // NO REPEAT ELITES WITHIN AN ACT (JC, PATCH 0803 §2). The map already drew
  // WHICH group stands in this room, without replacement, when the board was
  // generated (see map.assignEliteEncounters) — so the room answers the same way
  // every time it is asked, and two elite rooms in one act are never the same
  // fight until the bag has been round. A board from an older build carries no
  // index and simply rolls, exactly as it always did.
  const drawn = node.type === 'elite' ? node.eliteIdx : null;
  const defs = Number.isInteger(drawn) && drawn >= 0 && drawn < pool.length
    ? pool[drawn]
    : pool[Math.floor(rng() * pool.length)];

  // v3 curve (JC, synergy era): player damage grows multiplicatively, so enemy
  // HP grows EXPONENTIALLY per floor — the Keeper's 100k is the summit the
  // whole game scales toward. Enemy DAMAGE stays near-linear (player HP flat).
  //
  // Set-pieces are FLAT: a boss uses act.bossHpMult, and an elite uses
  // act.eliteHpMult where the act declares one (Act I omits it on purpose and
  // keeps its elites on the row curve — that act is frozen). `hpMinor` is the
  // row-curve factor handed to an elite's non-elite escort, so a tag-along
  // wraith stays a wraith instead of being inflated to mini-boss size.
  const rowFactor = act.curve.A * Math.pow(act.curve.G, node.row) * ENEMY_HP_SCALE;
  const eliteFlat = node.type === 'elite' ? (act.eliteHpMult == null ? null : act.eliteHpMult * ENEMY_HP_SCALE) : null;
  const hpFactor = node.type === 'boss' ? act.bossHpMult * ENEMY_HP_SCALE : (eliteFlat ?? rowFactor);
  // FORGED (IRON and up): the same elite, hardened in the fire. It rides on TOP
  // of whatever that act's elites already were — flat anchor or row curve — and
  // the escort's hpMinor comes up with it, because the promise on the map is
  // that the whole ROOM is worse, not just the body wearing the name.
  const forged = node.type === 'elite' && !!node.forged;
  const fHp = forged ? FORGED_HP_MULT : 1;
  const fDmg = forged ? FORGED_DMG_MULT : 1;
  // THE ENDLESS WALL. One ratio, applied to every body in the act so the room
  // shapes the act was tuned to keep are the room shapes you actually fight.
  // Exactly 1 outside the endless. See the ENDLESS block above.
  const eHp = endlessHpFactor(actIndex, act, bossPickId);
  const eDmg = endlessDmgFactor(actIndex);
  return {
    defs,
    forged,
    scaling: {
      hp: hpFactor * fHp * eHp,
      ...(eliteFlat ? { hpMinor: rowFactor * fHp * eHp } : {}),
      dmg: act.dmgBase * (node.type === 'boss' ? 1.15 : 1 + node.row * 0.05) * fDmg * eDmg,
      // Deeper acts sharpen their debuffs too (bleed/freeze/poison/fear +fx).
      fx: act.fx ?? 0,
    },
  };
}
