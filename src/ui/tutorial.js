import { GAME_W, GAME_H, DEPTH, PARCH, SUIT_COLORS, SUIT_PIP_KEY } from '../config.js';
import { woodPanel } from './panels.js';
import { sfx } from '../core/sfx.js';
import { progress, saveProgress } from '../core/progress.js';
import { ELITE_SPOIL_COUNT } from '../core/elites.js';
import { BASE_ARTIFACT_SLOTS } from '../core/artifacts.js';
import { MAX_POTIONS } from '../core/potions.js';
import { ORACLE_OFFER_SIZE } from '../core/oracle.js';
import { DIFFICULTIES, PREVIEW_MAX_DIFFICULTY } from '../core/difficulty.js';

const PAGES = [
  {
    title: 'PLAY POKER, DEAL DAMAGE',
    body: [
      'Each turn: select up to 5 cards and PLAY them as a poker hand.',
      '',
      'Only the cards that FORM the hand score. Kickers do',
      'nothing, and a junk hand scores a single card.',
      '',
      'Pair ×2 · Two Pair ×2 · Trips ×3 · Straight ×4 · Flush ×4',
      'Full House ×4 · Quads ×7 · Straight Flush ×8. THE SMITH',
      'can forge any of them higher, forever.',
      '',
      'CARDS SCORE FIRST, then RELICS resolve LEFT TO RIGHT,',
      'so a +MULT left of a ×MULT is worth more. Drag to reorder.',
      '',
      'Discards are limited. Spend them on purpose.',
    ],
  },
  {
    title: 'SUITS ARE YOUR TOOLS',
    suits: true,
    body: [
      'Enemies telegraph their next move above their heads.',
      'Shield absorbs damage before HP. Statuses tick every round.',
      'CLUBS reach the whole room: a quarter of what they deal',
      'splashes onto every other foe. Each hero also has a',
      'PASSIVE that rewards its own kind of hand.',
    ],
  },
  {
    title: 'THE RUN',
    body: [
      'Beat 3 ACTS to win. Chart your own path across each',
      'act\'s MAP: fights, events, rest sites, merchants, and',
      // WHAT AN ELITE ACTUALLY DROPS. This used to say "THREE relics", which
      // stopped being true when the spoils became ONE weighted pool of relics
      // AND potions — a real first run got two bottles and one relic and the
      // tutorial had told it otherwise. The count comes off ELITE_SPOIL_COUNT
      // and the guarantee is the one rollEliteSpoils actually applies.
      `ELITES, who drop ${ELITE_SPOIL_COUNT} rewards for you to pick ONE from:`,
      'relics and potions mixed, always at least one relic.',
      `You can carry ${BASE_ARTIFACT_SLOTS} relics at a time.`,
      '',
      'After every fight, choose ONE booster pack:',
      'THE WITCH (magic) · THE SMITH (hand power) ·',
      'THE ARTISAN (new cards), plus rarer visitors.',
      '',
      'WINNING pays CHIPS: 10 for every hand you did NOT need.',
      'Chips do not survive the run, so spend them.',
      'Anything glowing RED on the map is worth the trip.',
    ],
  },
  // ==========================================================================
  // PAGE FOUR (2026-08-04). Three things a new player meets in their first two
  // minutes and was never told about: the pack they cannot refuse, the belt
  // they are carrying, and the ladder they just walked past.
  //
  // No structural change was needed to add it — the page dots are PAGES.map
  // and NEXT becomes DONE on the last index — so this is words in the same
  // shape as the three above it. Every number is imported.
  // ==========================================================================
  {
    title: 'THREE THINGS BEFORE YOU START',
    body: [
      `THE ORACLE opens your run. She deals ${ORACLE_OFFER_SIZE} futures and you`,
      'MUST take one: there is no walking away, and what you',
      'take lasts the whole run. Every one of them gives you',
      // "Hover all three" was the one number on this page that was typed
      // rather than imported, so it would have quietly started lying the day
      // ORACLE_OFFER_SIZE moved off 3.
      'something and charges you for it. Read them all.',
      '',
      `POTIONS ride on the BELT, top right, up to ${MAX_POTIONS} at once.`,
      'Drink one at any point in a fight, even mid-turn. They',
      'are dropped by elites and sold by merchants, and a',
      'bottle you never opened bought you nothing.',
      '',
      `DIFFICULTY is chosen per hero. ${DIFFICULTIES[0].name} is the game as`,
      `written; clearing ACT III opens the next rung for THAT`,
      `hero alone. From ${DIFFICULTIES[PREVIEW_MAX_DIFFICULTY + 1].name} upward you also stop being`,
      'shown what a hand will score before you commit to it.',
    ],
  },
];

const SUIT_LINES = [
  { suit: 'swords', text: 'SWORDS: double damage' },
  { suit: 'hearts', text: 'HEARTS: damage + healing' },
  { suit: 'gems', text: 'DIAMONDS: damage + shield' },
  { suit: 'clovers', text: 'CLUBS: damage, splashing 25% onto every other foe' },
];

/**
 * @param {Phaser.Scene} scene
 * @param {?() => void} [onClose]  fired once the last page is dismissed. The
 *        title screen uses it to walk a first-time player straight into
 *        character select, so the tutorial is a doorway rather than a detour.
 */
export function openTutorial(scene, onClose = null) {
  if (scene.__tutorialOpen) return;
  scene.__tutorialOpen = true;
  // Latched HERE rather than at the title's auto-show call site, so that a
  // player who presses HOW TO PLAY of their own accord is not then shown the
  // same three pages again the moment they press PLAY.
  if (!progress.tutorialSeen) { progress.tutorialSeen = true; saveProgress(); }
  let page = 0;

  const ov = scene.add.container(0, 0).setDepth(DEPTH.overlay + 6);
  const dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x14101c, 0.75).setInteractive();
  ov.add(dim);
  const parts = woodPanel(scene, GAME_W / 2, GAME_H / 2, 920, 660, { accent: 0xffc542 });
  // The panel EATS clicks. Only `dim` was interactive, so a click anywhere at
  // all closed the tutorial, including a click on the page you were reading:
  // a first-time player tapping the panel to advance got dropped into
  // character select having read page one. The nav buttons are added after
  // this and sit above it, so they still take their own clicks.
  parts.panel.setInteractive();
  ov.add([parts.shadow, parts.panel, parts.line]);

  const title = scene.add.text(GAME_W / 2, GAME_H / 2 - 262, '', {
    fontFamily: 'Lilita One', resolution: 2, fontSize: '40px', color: PARCH.text,
  }).setOrigin(0.5);
  ov.add(title);

  const body = scene.add.text(GAME_W / 2, GAME_H / 2 - 40, '', {
    fontFamily: '"Baloo 2"', resolution: 2, fontSize: '24px', color: PARCH.text, fontStyle: 'bold',
    align: 'center', lineSpacing: 6, wordWrap: { width: 820 },
  }).setOrigin(0.5);
  ov.add(body);

  // suit rows (page 2 only)
  const suitRows = scene.add.container(GAME_W / 2, GAME_H / 2 - 150).setAlpha(0);
  SUIT_LINES.forEach((line, i) => {
    const y = i * 44;
    const pip = scene.add.image(-260, y, SUIT_PIP_KEY[line.suit]).setTint(SUIT_COLORS[line.suit]);
    pip.setScale(30 / Math.max(pip.width, pip.height));
    suitRows.add(pip);
    suitRows.add(scene.add.text(-228, y, line.text, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '24px', color: PARCH.text,
    }).setOrigin(0, 0.5));
  });
  ov.add(suitRows);

  // page dots
  const dots = PAGES.map((_, i) =>
    scene.add.circle(GAME_W / 2 - (PAGES.length - 1) * 14 + i * 28, GAME_H / 2 + 236, 7, 0x6b4526));
  dots.forEach(d => ov.add(d));

  const render = () => {
    const p = PAGES[page];
    title.setText(p.title);
    if (p.suits) {
      // The suit page is short and shares the panel with the pip rows, so it
      // stays CENTRED in the gap left under them.
      suitRows.setAlpha(1);
      body.setOrigin(0.5, 0.5).setPosition(GAME_W / 2, GAME_H / 2 + 100).setText(p.body.join('\n'));
    } else {
      // Every other page hangs from a FIXED TOP rather than being centred on a
      // fixed middle, so the gap under the title is the same on all of them.
      // Centring meant a page's first line crept upward as the page got longer:
      // the three original pages cleared the title by 21px and the fourth, two
      // lines longer, was clearing it by five. Growing downward is also the
      // safe direction — there is far more empty panel above the page dots than
      // there is between the body and the header.
      suitRows.setAlpha(0);
      body.setOrigin(0.5, 0).setPosition(GAME_W / 2, GAME_H / 2 - 218).setText(p.body.join('\n'));
    }
    dots.forEach((d, i) => d.setFillStyle(i === page ? 0xa3541c : 0xd9c294));
    backTxt.setAlpha(page > 0 ? 1 : 0.35);
    nextTxt.setText(page === PAGES.length - 1 ? 'DONE' : 'NEXT  ▶');
  };

  const mkNav = (x, label, onClick) => {
    const t = scene.add.text(x, GAME_H / 2 + 282, label, {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '28px', color: PARCH.accent,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerdown', () => { sfx(scene, 'button', { volume: 0.7 }); onClick(); });
    ov.add(t);
    return t;
  };
  const close = () => { scene.__tutorialOpen = false; ov.destroy(true); onClose?.(); };
  const backTxt = mkNav(GAME_W / 2 - 330, '◀  BACK', () => { if (page > 0) { page--; render(); } });
  const nextTxt = mkNav(GAME_W / 2 + 330, 'NEXT  ▶', () => {
    if (page < PAGES.length - 1) { page++; render(); } else close();
  });
  dim.on('pointerdown', close);

  render();
}
