import { CARD, SUIT_COLORS, SUIT_PIP_KEY } from '../config.js';
import { rankLabel } from '../core/deck.js';
import { WILD_MODS } from '../core/poker.js';
import { cardMod, cardStamp, cardWrap } from '../core/scoring.js';
import { run } from '../core/run.js';
import { settings } from '../core/settings.js';
import { brightness, INK_DARK } from './juice.js';

/**
 * A card ribbon's outline. The card face is LIGHT, so a pale ribbon colour needs
 * a dark halo and a dark one needs the cream halo the painted filigree wants.
 * 0.5 splits the table exactly where it should: gilded, star and forged (the
 * warm golds and orange) go dark, everything else keeps the cream.
 */
function bannerStroke(css) {
  return brightness(css) > 0.5 ? INK_DARK : '#ffffff';
}

/**
 * Shrink a legend printed ON a card until it fits inside the painted frame's
 * safe zone. The same rule the mod ribbons have always used, hoisted so the
 * biome overlays (FACE DOWN, BURNED, SPENT, FADED) obey it too — a word that
 * runs off onto the card beside it reads as a rendering bug, not as a stamp.
 */
function fitToCard(text, maxW = CARD.w - 2 * CARD.padX + 16) {
  if (text.width > maxW) text.setScale(maxW / text.width);
  return text;
}

/**
 * Card-mod look table: border texture/tint + optional badge icon + banner.
 * EVERY mod carries a visible banner so a modded card never masquerades as
 * a plain one (JC: the +10 queen must LOOK like a +10 queen).
 */
const MOD_LOOKS = {
  enhanced: { border: 'card_border_purple', banner: '+10', bannerColor: '#8a5cd0', faceTint: 0xb45cff },
  forged: { border: 'card_border_purple', badge: { key: 'icon_coins', tint: 0xffffff }, banner: 'FORGED', bannerColor: '#d07028', faceTint: 0xff8c28 },
  gilded: { borderTint: 0xffd23e, badge: { key: 'icon_coins', tint: 0xffffff }, banner: 'PAYS ◉', bannerColor: '#b8862c', faceTint: 0xffd23e },
  wild: { borderTint: 0xf0e8ff, banner: 'WILD', bannerColor: '#8a5cd0', faceTint: 0xc898ff },
  star: { borderTint: 0xf0e8ff, banner: 'STAR', bannerColor: '#c09018', faceTint: 0xffd23e },
  joker: { border: 'card_border_purple', banner: 'JOKER', bannerColor: '#d02868', faceTint: 0xd02868 },
  // (echo is NOT here any more — the ECHO SEAL stopped being a mod on 0803-B and
  // became a STAMP LAYER, `card.stamp`, so it is pressed on TOP of whatever the
  // card already is. See STAMP_LOOKS below. cardMod() answers null for a legacy
  // `mod: 'echo'` card, so an old save's echo cards wear the wax too.)
  spectral: { borderTint: 0xbfe8ff, banner: 'SPECTRAL ×2', bannerColor: '#2878c0', faceTint: 0x9adcff },
  nuke: { borderTint: 0xff9080, banner: 'THE NUKE', bannerColor: '#c02030', badge: { key: 'icon_fire', tint: 0xff5030 }, faceTint: 0xff5030 },
  // --- the 2026-07-31 wave -------------------------------------------------
  // ROULETTE's NEUTRAL face: dealer green felt washed with casino gold, and a
  // slowly turning wheel where the badge goes. Every other state is a RESULT,
  // painted on at scoring time by setRouletteResult() — the deck picker and the
  // fan only ever show this one.
  roulette: {
    borderTint: 0x2e8b57, banner: 'ROULETTE', bannerColor: '#1f7a46', faceTint: 0x46a86a,
    badge: { key: 'icon_dice', tint: 0xffd23e }, spinBadge: true,
  },
  // (bloodSealed is NOT here any more — the BLOOD SEAL stopped being a mod on
  // 2026-08-01 and became a STAMP LAYER, `card.stamp`. It is pressed by
  // addStamp() on top of whatever mod the card is already wearing, so a
  // ROULETTE card can be sealed, an ETHEREAL card can be sealed, and neither
  // one loses its own identity to say so.)
  // ETHEREAL: transparency IS the identity, so the look is mostly `ghost` —
  // the face and the big pip go see-through and breathe, while the rank glyph
  // and corner pips stay at full ink so the card is still a readable 7♥.
  ethereal: { borderTint: 0x7fe0d0, banner: 'ETHEREAL', bannerColor: '#2f8f8a', faceTint: 0x74dcd8, ghost: true },
  // (shiny is NOT here any more either — SHINY became a WRAPPER on 2026-08-01,
  // card.wrap, drawn by addFoilWrap() over whatever mod the card carries.)
};

/**
 * THE STAMP LAYER'S LOOK. A blob of wax pressed into the card's lower-left
 * quarter: CRIMSON for the Blood Seal, VIOLET for the Multiplicative Seal. That
 * patch is chosen deliberately — the badge owns the top-right on a painted
 * card, the banner ribbon runs across the bottom centre and the rank cluster
 * holds the top-left — so a stamp can stack over any mod without covering a
 * number the player needs to read.
 *
 * PAINTED ART, 2026-08-01 (Caleb): `seal_blood` / `seal_mult` are real painted
 * wax blobs that carry their OWN struck legend — the crimson one reads "+2" over
 * a heart (SEAL_HEAL), the violet one reads "+3" (STAMP_MULT). So they are drawn
 * UNTINTED and WITHOUT the old text legend on top; the number IS the legend, and
 * it matches the number scoring.js actually pays out. `tint` survives only as
 * the tint applied to the generated grey `fx_wax_seal` blob, which is still the
 * fallback if the painted texture ever fails to load.
 */
const STAMP_LOOKS = {
  // CRIMSON wax, struck "+2♥" — the Blood Seal.
  blood: { tex: 'seal_blood', tint: 0xe02a40, legend: '♥', color: '#fff0f3', fallback: 'icon_heart_small' },
  // VIOLET wax, struck "+3" — the Multiplicative Seal. (Violet, not gold: it
  // matches the 0x7a3ab8 the scoring tables have always used for this seal.)
  mult: { tex: 'seal_mult', tint: 0xffc22e, legend: '×', color: '#fffaea', fallback: 'icon_star' },
  // BLUE wax, struck with the loop — the ECHO SEAL (0803-B). Same slot, same
  // patch of card, so echo now visibly COMPETES with the other two seals, which
  // is exactly what moving it off the mod layer was for. The generated-blob
  // fallback wears the ↻ the card used to carry as a badge.
  echo: { tex: 'seal_echo', tint: 0x2878c0, legend: '↻', color: '#eaf6ff', fallback: 'icon_refresh' },
};

/** THE WRAP LAYER'S LOOK. One wrapper today: foil. */
const WRAP_LOOKS = {
  shiny: { sheen: 0xbfe8ff, banner: 'SHINY', bannerColor: '#7a5cd0' },
};

/** The four faces of the wheel, once it has stopped. */
const ROULETTE_LOOK = {
  gold: { tint: 0xffd23e, alpha: 0.62, label: 'GOLD ◉+15', color: '#b8862c', blend: 'NORMAL' },
  red: { tint: 0xe0434f, alpha: 0.60, label: 'RED +2 MULT', color: '#b02030', blend: 'NORMAL' },
  black: { tint: 0x1a1220, alpha: 0.74, label: 'BLACK', color: '#2a2030', blend: 'MULTIPLY' },
  green: { tint: 0x3fa64b, alpha: 0.58, label: 'GREEN +10', color: '#1d7a36', blend: 'NORMAL' },
};

/** Dark warm ink for rank/pips printed over a suit-COLOURED face. */
const INK = 0x2a2030;
const INK_CSS = '#2a2030';

/**
 * Which painted face this card wears, and whether that face already carries
 * the suit's colour. With CARD COLORS on we prefer the per-suit painting;
 * fallback chain is suit variant -> neutral hero face -> legacy generated.
 */
function paintedFace(scene, card) {
  const cid = run.chrId;
  if (!cid) return { key: null, colored: false };
  if (settings.cardColors) {
    const k = `cardface_${cid}_${card.suit}`;
    if (scene.textures.exists(k)) return { key: k, colored: true };
  }
  const neutral = 'cardface_' + cid;
  return scene.textures.exists(neutral) ? { key: neutral, colored: false } : { key: null, colored: false };
}

/**
 * Bottom edge of a rank glyph's actually-painted pixels, measured off the
 * Text object's own 2D canvas and cached per (label, size, stroke). Fixed
 * offsets can't work here: 'Q' hangs a tail below the baseline while '10'
 * and 'A' stop dead on it, which is what used to shove the corner pip into
 * the glyph. Returns px from the Text's top edge, in display units.
 */
const INK_BOTTOM_CACHE = new Map();
function rankInkBottom(text, label) {
  const key = `${label}|${text.style.fontSize}|${text.style.strokeThickness}`;
  const hit = INK_BOTTOM_CACHE.get(key);
  if (hit !== undefined) return hit;
  let bottom = text.height * 0.86;   // fallback if the canvas can't be read
  try {
    const cw = text.canvas.width, ch = text.canvas.height;
    const res = ch / text.height || 1;
    const data = text.context.getImageData(0, 0, cw, ch).data;
    for (let y = ch - 1; y >= 0; y--) {
      let hitRow = false;
      for (let x = 0; x < cw; x++) {
        if (data[(y * cw + x) * 4 + 3] > 24) { hitRow = true; break; }
      }
      if (hitRow) { bottom = (y + 1) / res; break; }
    }
  } catch { /* tainted or unavailable canvas — keep the fallback */ }
  INK_BOTTOM_CACHE.set(key, bottom);
  return bottom;
}

/**
 * Repeating idle-FX driver: fires `cb` on a period re-rolled inside
 * [min,max] EVERY time, after a randomised first delay. Cards therefore
 * never march in lockstep — each one keeps its own lazy rhythm.
 */
function jitterLoop(scene, owner, min, max, cb) {
  let ev = null;
  const schedule = (d) => {
    ev = scene.time.delayedCall(d, () => {
      if (!owner.active) return;
      cb();
      schedule(Phaser.Math.Between(min, max));
    });
  };
  schedule(Phaser.Math.Between(Math.round(min * 0.15), max));
  owner.once('destroy', () => { if (ev) ev.remove(); });
}

/**
 * A composited playing card: the run hero's painted face (Caleb's per-hero
 * `cardface_<chrId>`, or the per-suit `cardface_<chrId>_<suit>` when CARD
 * COLORS is on — ornate frame + field baked in) — or, for a hero without
 * art, the legacy CardFrame_01 border over a cream fill — plus tinted
 * silhouette pips and rank text inset inside CARD's safe zone.
 * card.mod ('enhanced'|'wild'|'star'|'joker'|'gilded'|'forged'|'echo') restyles it.
 */
export class CardSprite extends Phaser.GameObjects.Container {
  /** @param {{suit:string, rank:number, id:string, mod?:string}} card */
  constructor(scene, x, y, card, { enhanced = false } = {}) {
    super(scene, x, y);
    this.card = card;
    this.selected = false;
    this.baseX = x;
    this.baseY = y;
    this.baseAngle = 0;

    // THE THREE LAYERS, resolved once and composed in order: the MOD paints the
    // card (wash, border, banner, badge), the STAMP presses wax into its corner,
    // the WRAP lays foil over the finished thing. Legacy spellings (a
    // `bloodSealed` or `shiny` mod) resolve onto the right layer, so an old
    // card built before the split still draws correctly.
    const mod = cardMod(card);
    const stamp = cardStamp(card);
    const wrap = cardWrap(card);
    const wild = WILD_MODS.has(mod);
    const look = MOD_LOOKS[mod] ?? (enhanced ? MOD_LOOKS.enhanced : {});

    // --- Face ------------------------------------------------------------
    // Caleb's painted per-hero face when the run's hero has art (it IS the
    // frame — ornate border + field in one opaque-inside PNG).
    // Otherwise the legacy cream fill + pack frame.
    const face = paintedFace(scene, card);
    this.painted = !!face.key;
    this.coloredFace = face.colored;

    // On a suit-coloured face the artwork already codes the suit, so the
    // rank and pips switch to dark ink — a red pip on a red heart face is
    // double-coding that just costs legibility.
    const color = wild ? 0xb08cd8 : (face.colored ? INK : SUIT_COLORS[card.suit]);
    const colorCss = face.colored ? INK_CSS
      : '#' + (wild ? 0xb08cd8 : SUIT_COLORS[card.suit]).toString(16).padStart(6, '0');

    if (face.key) {
      this.faceImg = scene.add.image(0, 0, face.key).setDisplaySize(CARD.w, CARD.h);
      this.add(this.faceImg);
      // Mod tell: colour-wash the painted frame in the mod's hue instead of
      // slapping the pack border over the art (which fights the filigree).
      // MULTIPLY, not ADD — the parchment field is already near-white, so an
      // additive pass just blows the card out and erases Caleb's painting.
      const wash = look.faceTint ?? look.borderTint;
      if (wash) {
        this.washImg = scene.add.image(0, 0, face.key).setDisplaySize(CARD.w, CARD.h)
          .setTint(wash).setAlpha(0.5).setBlendMode(Phaser.BlendModes.MULTIPLY);
        this.add(this.washImg);
      }
    } else {
      const bg = scene.add.image(0, 0, 'card_face').setDisplaySize(CARD.w - 6, CARD.h - 6)
        .setTint(0xfdf7e8);
      this.add(bg);
      this.faceImg = bg;
      const border = scene.add.image(0, 0, look.border ?? 'card_border')
        .setDisplaySize(CARD.w, CARD.h);
      border.setTint(look.borderTint ?? 0xd8cfc2);
      this.add(border);
    }

    // Big center pip — tinted suit silhouette (wilds get the star).
    const pip = scene.add.image(0, CARD.pipY, wild ? 'icon_star' : SUIT_PIP_KEY[card.suit])
      .setTint(wild ? 0xd8b830 : color).setAlpha(0.92);
    const pipScale = (CARD.w * 0.50) / Math.max(pip.width, pip.height);
    pip.setScale(pipScale);
    this.add(pip);
    this.pip = pip;
    if (wild) {
      scene.tweens.add({ targets: pip, angle: { from: -8, to: 8 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // --- Corner clusters --------------------------------------------------
    // Rank glyph with the suit pip tucked directly beneath it, both centred
    // on one column so wide glyphs ('10') and narrow ones ('A') still read as
    // the same stack. The pip's Y comes from the rank's MEASURED ink bottom,
    // which is why Q's descender no longer collides with it.
    const label = rankLabel(card.rank);
    const style = {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '34px', color: colorCss,
      stroke: '#fdf7e8', strokeThickness: this.painted ? 3 : 0,
    };
    const colX = -CARD.w / 2 + CARD.padX + CARD.cornerColW / 2;
    const topY = -CARD.h / 2 + CARD.padY;
    // The banner the card ends up wearing: the MOD's if it has one, else the
    // WRAP's ('SHINY' on an otherwise plain card). A card with both keeps the
    // mod's ribbon — the foil is already announced by the sheen and the glint.
    const bannerText = look.banner ?? (wrap ? WRAP_LOOKS[wrap]?.banner : null);
    const bannerColor = look.banner ? look.bannerColor : WRAP_LOOKS[wrap]?.bannerColor;
    const showBR = !(this.painted && bannerText);

    const tl = scene.add.text(colX, topY, label, style).setOrigin(0.5, 0);
    if (tl.width > CARD.cornerColW) tl.setScale(CARD.cornerColW / tl.width);  // '10' shrinks to fit its column
    this.add(tl);
    if (showBR) this.add(scene.add.text(-colX, -topY, label, style).setOrigin(0.5, 0)
      .setScale(tl.scaleX).setAngle(180));

    const cornerKey = wild ? 'icon_star' : SUIT_PIP_KEY[card.suit];
    const cornerPip = scene.add.image(0, 0, cornerKey).setTint(wild ? 0xd8b830 : color);
    const cScale = CARD.cornerPip / Math.max(cornerPip.width, cornerPip.height);
    cornerPip.setScale(cScale);
    // The pip PNGs pad their silhouette, so measure the visible ink height
    // rather than trusting the display box, else the gap balloons.
    const pipInk = cornerPip.displayHeight * 0.62;
    const inkBottomY = topY + rankInkBottom(tl, label) * tl.scaleY;
    const cpy = inkBottomY + CARD.cornerGap + pipInk / 2;
    cornerPip.setPosition(colX, cpy);
    this.add(cornerPip);
    // Exposed for the layout verifier: pipTopY - rankBottomY IS the gap.
    this.rankTL = tl;
    this.rankBottomY = inkBottomY;
    this.cornerPipTopY = cpy - pipInk / 2;
    if (showBR) {
      this.add(scene.add.image(-colX, -cpy, cornerKey).setTint(wild ? 0xd8b830 : color)
        .setScale(cScale).setAngle(180));
    }

    // Mod badge (coin/echo icon, bottom-left) + banner ribbon under the pip.
    if (look.badge) {
      // Painted cards stamp the badge top-right (mirror of the rank cluster);
      // the bottom belongs to the banner ribbon there.
      const b = this.painted
        ? scene.add.image(CARD.w / 2 - CARD.padX - 3, -CARD.h / 2 + CARD.padY + 15, look.badge.key)
        : scene.add.image(-CARD.w / 2 + 24, CARD.h / 2 - 26, look.badge.key);
      b.setTint(look.badge.tint);
      b.setScale((this.painted ? 24 : 26) / Math.max(b.width, b.height));
      this.add(b);
      // The wheel turns, slowly, forever — the neutral ROULETTE tell.
      if (look.spinBadge) scene.tweens.add({ targets: b, angle: 360, duration: 9000, repeat: -1 });
    }
    if (bannerText) {
      // THE STROKE PICKS ITSELF (2026-08-02). A white halo lifts a DARK ribbon
      // (spectral purple, blood red, tide blue) off the card's painted filigree,
      // and does the exact opposite to a pale one: gilded gold and star gold on a
      // cream card face were pale-on-pale wearing a pale outline. Same relative
      // brightness switch the difficulty plates use to choose their own ink.
      const bn = scene.add.text(0, CARD.h / 2 - CARD.bannerY, bannerText, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
        color: bannerColor, stroke: bannerStroke(bannerColor), strokeThickness: 3,
      }).setOrigin(0.5);
      // Long ribbons (SPECTRAL ×2) shrink rather than bleed onto the filigree.
      const maxW = CARD.w - 2 * CARD.padX + 16;
      if (bn.width > maxW) bn.setScale(maxW / bn.width);
      this.add(bn);
      this.banner = bn;
      this.bannerBaseScale = bn.scaleX;
    }

    if (!wild) this.addSuitAura(scene, card, pip);

    // Selection glow (hidden until selected) + the always-on drop shadow,
    // both slid under the face art.
    this.glow = scene.add.image(0, 0, 'card_halo')
      .setDisplaySize(CARD.w + 26, CARD.h + 26).setTint(0xffd23e).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.addAt(this.glow, 0);
    this.shadow = scene.add.image(5, 8, 'card_shadow')
      .setDisplaySize(CARD.w + 18, CARD.h + 18).setAlpha(0.51);
    this.addAt(this.shadow, 0);

    // --- the layers compose, in order ---------------------------------------
    // Both of these read the finished stack (shadow included), so they run last.
    if (look.ghost) this.makeGhostly(scene);
    if (wrap === 'shiny') this.addFoilWrap(scene);
    // ...and the WAX STAMP last of all, so it is pressed on TOP of a ghost's
    // transparency and a foil's sheen rather than under either.
    if (stamp) this.addStamp(scene, stamp);

    this.setSize(CARD.w, CARD.h);
    this.setInteractive({ useHandCursor: true });
    scene.add.existing(this);
  }

  /**
   * Subtle always-on tells for what each suit DOES (per JC feedback).
   * Deliberately LAZY: every loop re-rolls a long, wide period and starts on
   * a random offset, so a fanned hand shimmers occasionally rather than
   * strobing in unison. Only daggers and shields keep a sparkle.
   */
  addSuitAura(scene, card, pip) {
    // Auras slot in directly BEHIND the pip — the child index differs between
    // the painted face (1 background layer, or 2 with a mod wash) and the
    // legacy fill+border pair, so derive it instead of hard-coding.
    const under = this.getIndex(pip);
    if (card.suit === 'hearts') {
      // Beating heart, but at resting pulse: one soft double-thump now and
      // then over a faint red bloom.
      const bloom = scene.add.image(0, CARD.pipY, 'fx_glow')
        .setTint(0xe0434f).setAlpha(0.10).setScale(0.35).setBlendMode(Phaser.BlendModes.ADD);
      this.addAt(bloom, under);
      jitterLoop(scene, this, 8000, 14000, () => {
        scene.tweens.chain({
          targets: pip,
          tweens: [
            { scale: pip.scale * 1.06, duration: 130, yoyo: true, ease: 'Sine.easeOut' },
            { scale: pip.scale * 1.03, duration: 110, yoyo: true, ease: 'Sine.easeOut', delay: 50 },
          ],
        });
        scene.tweens.add({ targets: bloom, alpha: 0.17, duration: 180, yoyo: true });
      });
    } else if (card.suit === 'swords') {
      // Gleaming blade: a rare metallic flash + sparkle over a faint red glow.
      const glow = scene.add.image(0, CARD.pipY, 'fx_glow')
        .setTint(0x9a1428).setAlpha(0.16).setScale(0.44).setBlendMode(Phaser.BlendModes.ADD);
      this.addAt(glow, under);
      scene.tweens.add({
        targets: glow, alpha: 0.20, scale: 0.47, duration: Phaser.Math.Between(3200, 3900),
        delay: Phaser.Math.Between(0, 2600), yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      jitterLoop(scene, this, 9000, 16000, () => {
        // A light sweep, not a blink: brief brightness swell on the blade.
        scene.tweens.add({ targets: pip, alpha: { from: 0.92, to: 1 }, scale: pip.scale * 1.04, duration: 220, yoyo: true });
        scene.tweens.add({ targets: pip, angle: { from: -2.5, to: 2.5 }, duration: 90, yoyo: true, repeat: 1, onComplete: () => pip.setAngle(0) });
        // sparkle star sliding down the edge (daggers keep theirs)
        const s = scene.add.image(Phaser.Math.Between(-14, 6), Phaser.Math.Between(-10, 20), 'fx_star')
          .setTint(0xffffff).setScale(0.10).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
        this.add(s);
        scene.tweens.add({
          targets: s, alpha: { from: 0.95, to: 0 }, scale: 0.22, x: s.x + 16, y: s.y + 18, angle: 90,
          duration: 420, ease: 'Cubic.easeOut', onComplete: () => s.destroy(),
        });
      });
    } else if (card.suit === 'gems') {
      // Bold gold shield (Bazaar-style): warm bloom + tinted shield icon
      // breathing behind the pip, punctuated — rarely — by a guard flash.
      const bloom = scene.add.image(0, CARD.pipY, 'fx_glow')
        .setTint(0xffd23e).setAlpha(0.16).setDisplaySize(126, 126).setBlendMode(Phaser.BlendModes.ADD);
      this.addAt(bloom, under);
      // Sized past the diamond pip's actual (padded) silhouette so its
      // notched crown and pointed base read past the pip's edges instead
      // of hiding fully behind it.
      const shield = scene.add.image(0, CARD.pipY, 'icon_shield').setTint(0xffd23e).setAlpha(0.38);
      const shieldScale = 100 / Math.max(shield.width, shield.height);
      shield.setScale(shieldScale);
      this.addAt(shield, under + 1);
      scene.tweens.add({
        targets: shield, alpha: 0.44, duration: Phaser.Math.Between(3200, 3900),
        delay: Phaser.Math.Between(0, 2600), yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      jitterLoop(scene, this, 12000, 20000, () => {
        scene.tweens.add({ targets: shield, scale: shieldScale * 1.18, duration: 220, yoyo: true, ease: 'Back.easeOut' });
        const s = scene.add.image(Phaser.Math.Between(-20, -6), Phaser.Math.Between(0, 30), 'fx_star')
          .setTint(0xffffff).setScale(0.10).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
        this.add(s);
        scene.tweens.add({
          targets: s, alpha: { from: 0.95, to: 0 }, scale: 0.22, x: s.x + 40, y: s.y - 4, angle: 90,
          duration: 420, ease: 'Cubic.easeOut', onComplete: () => s.destroy(),
        });
      });
    } else if (card.suit === 'clovers') {
      // Quietly enchanted (JC: "spell-type enchant, a little smoke or poofs,
      // not overwhelming"): no ring, no sparkle — just an occasional violet
      // breath behind the pip and the odd wisp of arcane smoke curling off.
      const aura = scene.add.image(0, CARD.pipY, 'fx_glow')
        .setTint(0xa070e0).setAlpha(0).setScale(0.52).setBlendMode(Phaser.BlendModes.ADD);
      this.addAt(aura, under);
      jitterLoop(scene, this, 7000, 14000, () => {
        scene.tweens.add({ targets: aura, alpha: 0.16, duration: 1200, yoyo: true, ease: 'Sine.easeInOut' });
      });
      jitterLoop(scene, this, 10000, 18000, () => {
        const puffs = Phaser.Math.Between(1, 2);
        for (let i = 0; i < puffs; i++) {
          const p = scene.add.image(Phaser.Math.Between(-26, 26), CARD.pipY + Phaser.Math.Between(10, 34), 'fx_dust')
            .setTint(0x9a80c0).setAlpha(0).setScale(0.06);
          this.add(p);
          scene.tweens.add({
            targets: p, alpha: { from: 0.42, to: 0 }, y: p.y - 26, x: p.x + Phaser.Math.Between(-8, 8),
            scale: 0.11, angle: Phaser.Math.Between(-30, 30),
            duration: 1600, delay: i * 260, ease: 'Sine.easeOut', onComplete: () => p.destroy(),
          });
        }
      });
    }
  }

  /**
   * THE BLOOD SEAL, as a physical object. Not a border, not a wash, not a
   * banner — a blob of crimson wax pressed into the card's LOWER-LEFT corner,
   * tilted a few degrees off square the way a hand-pressed seal always is.
   * That corner is the one place no mod owns: the badge sits top-right on a
   * painted card, the banner runs across the bottom centre, the rank cluster
   * holds the top-left. So the stamp stacks over ROULETTE, ETHEREAL, SHINY,
   * JOKER — anything — and never covers a number you need to read.
   *
   * It breathes, slowly, like wax that has not quite finished setting, and it
   * carries its own little pool of shadow so it reads as sitting ON the card.
   */
  addStamp(scene, kind) {
    const look = STAMP_LOOKS[kind] ?? STAMP_LOOKS.blood;
    this.stamp = kind;
    this.sealed = kind === 'blood';   // legacy flag some call sites still read
    // Lower-left, but ABOVE the banner ribbon (which lives at h/2 - bannerY):
    // the wax must not sit on the mod's own name. Left edge, so it also clears
    // the badge's top-right corner and the rank cluster's top-left.
    // Painted wax first; the generated grey blob (tinted) is the fallback, and
    // an icon the last resort. Only the generated blob wants a tint — the
    // painted seals are already the right colour and carry their own legend.
    const painted = scene.textures.exists(look.tex);
    // The painted blob is wider than the generated one, so its anchor steps in
    // by the same few px: the wax overlaps the gilt frame by a hair (a seal
    // pressed at a corner should), but it never hangs off the card.
    const x = -CARD.w / 2 + (painted ? 33 : 29);
    const y = CARD.h / 2 - CARD.bannerY - 30;
    const key = painted ? look.tex
      : scene.textures.exists('fx_wax_seal') ? 'fx_wax_seal' : look.fallback;
    const shadow = scene.add.image(x + 2, y + 3, key).setTint(0x1a0308).setAlpha(0.42);
    const seal = scene.add.image(x, y, key);
    if (!painted) seal.setTint(look.tint);
    // The painted blobs carry a black keyline that eats ~8% of the bounding box
    // per side, so they sit a touch larger than the generated blob did to land
    // on the same visual footprint in the fan and in every picker.
    const s = (painted ? 52 : 44) / Math.max(seal.width, seal.height);
    shadow.setScale(s); seal.setScale(s);
    seal.setAngle(-11); shadow.setAngle(-11);
    this.add(shadow); this.add(seal);
    // Fallback only: the generated blob is blank, so it needs a struck legend
    // drawn on to tell the two seals apart by what they SAY and not just hue.
    if (!painted) {
      const legend = scene.add.text(x, y - 1, look.legend, {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '21px', color: look.color,
        stroke: '#2a0308', strokeThickness: 4,
      }).setOrigin(0.5).setAngle(-11);
      this.add(legend);
    }
    this.waxSeal = seal;
    scene.tweens.add({
      targets: [seal, shadow], scale: s * 1.07, duration: 1500, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 1200),
    });
  }

  /**
   * ETHEREAL. Transparency IS the identity — but a card you cannot READ is a
   * bug, not a ghost. Only the SHEET goes see-through (face, mod wash, big pip,
   * cast shadow); the rank glyph, the corner pips and the banner keep full ink
   * over it, so a half-here 7♥ is still unmistakably a 7♥.
   */
  makeGhostly(scene) {
    this.ghostly = true;
    this.faceImg?.setAlpha(0.56);
    this.washImg?.setAlpha(0.34);
    this.pip?.setAlpha(0.46);
    this.shadow?.setAlpha(0.2);
    // A wisp of blue-green cold hanging in the middle of it.
    const wisp = scene.add.image(0, CARD.pipY, 'fx_glow')
      .setTint(0x7fe0d0).setAlpha(0.13).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.addAt(wisp, this.getIndex(this.pip));
    // ...and it breathes, the way something only half here would.
    if (this.faceImg) {
      scene.tweens.add({
        targets: this.faceImg, alpha: 0.7, duration: 2400, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 2000),
      });
    }
    scene.tweens.add({
      targets: wisp, alpha: 0.22, scale: 0.58, duration: 2600, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 2200),
    });
  }

  /**
   * SHINY, ×1.5 MULT AND UNMISTAKABLE (PATCH 0803 §3).
   *
   * The wrapper used to be nothing but an occasional glint on a long re-rolled
   * period, and JC's report is exact: in a fanned hand that reads as the DIAMOND
   * suit's own sparkle rather than as foil, so shiny cards were hard to find at
   * a glance. Since the wrap was buffed to ×1.5 on the same patch, missing one
   * costs real damage.
   *
   * So the foil is now ALWAYS ON, in three layers that no other card wears:
   *   · a cool prismatic RIM around the whole card, breathing slowly. The
   *     diamond tell is a WARM gold bloom behind the pip; this is cold, and it
   *     is on the outline rather than in the middle, so the two never read as
   *     the same thing even side by side in the fan.
   *   · three permanent twinkles, out of phase with each other so at least one
   *     is always lit and no two cards blink together.
   *   · the original sweeping glint on top, unchanged, as the flourish.
   *
   * The three spots deliberately avoid everything a card needs you to read: the
   * rank cluster owns the top-left, the banner the bottom centre, the wax stamp
   * the lower-left.
   */
  addFoilWrap(scene) {
    this.wrap = 'shiny';

    // --- the permanent rim: cold light on the edge, never on the face --------
    const rim = scene.add.image(0, 0, 'card_halo')
      .setDisplaySize(CARD.w + 36, CARD.h + 36).setTint(0xbfd8ff).setAlpha(0.34)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.addAt(rim, 1);   // above the drop shadow, below the gold selection glow
    this.foilRim = rim;
    const rimScale = rim.scaleX;
    scene.tweens.add({
      targets: rim, alpha: 0.58, scaleX: rimScale * 1.05, scaleY: rim.scaleY * 1.05,
      duration: Phaser.Math.Between(1300, 1750),
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 900),
    });

    // --- the permanent twinkles ---------------------------------------------
    const SPOTS = [
      [CARD.w * 0.30, -CARD.h * 0.33],
      [-CARD.w * 0.33, CARD.h * 0.02],
      [CARD.w * 0.24, CARD.h * 0.29],
    ];
    this.foilSparks = SPOTS.map(([sx, sy], i) => {
      const s = scene.add.image(sx, sy, 'fx_star')
        .setTint(i === 1 ? 0xe6c8ff : 0xffffff).setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.03).setAlpha(0);
      this.add(s);
      scene.tweens.add({
        targets: s, alpha: { from: 0, to: 0.95 }, scale: 0.17, angle: 100,
        duration: 560, hold: 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: i * 280, repeatDelay: 340 + i * 190,
      });
      return s;
    });

    const sheen = scene.add.image(0, 0, 'card_face')
      .setDisplaySize(CARD.w - 10, CARD.h - 10).setTint(0xbfe8ff).setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.addAt(sheen, this.getIndex(this.pip));
    jitterLoop(scene, this, 6500, 12000, () => {
      scene.tweens.add({ targets: sheen, alpha: 0.16, duration: 260, yoyo: true, ease: 'Sine.easeInOut' });
      // The glint itself: a small star riding diagonally across the foil.
      const s = scene.add.image(-CARD.w * 0.34, CARD.h * 0.22, 'fx_star')
        .setTint(0xffffff).setScale(0.1).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      this.add(s);
      scene.tweens.add({
        targets: s, alpha: { from: 0.9, to: 0 }, scale: 0.26,
        x: CARD.w * 0.3, y: -CARD.h * 0.26, angle: 120,
        duration: 620, ease: 'Sine.easeInOut', onComplete: () => s.destroy(),
      });
    });
  }

  /**
   * ROULETTE, resolved. The wheel has stopped: the card takes its result's
   * colour for the rest of the beat (BLACK darkens through MULTIPLY, the other
   * three wash on top) and the banner is rewritten to say what it paid. Called
   * by CombatScene at the card's scoring beat — nowhere else, which is why the
   * fan and the deck picker only ever show the neutral wheel.
   */
  setRouletteResult(result) {
    const look = ROULETTE_LOOK[result];
    if (!look || !this.scene) return;
    const scene = this.scene;
    const ov = scene.add.image(0, 0, 'card_face')
      .setDisplaySize(CARD.w - 8, CARD.h - 8).setTint(look.tint).setAlpha(0)
      .setBlendMode(Phaser.BlendModes[look.blend]);
    // Under the pip and the rank cluster: the card changes COLOUR, it does not
    // stop being a card you can read.
    this.addAt(ov, this.getIndex(this.pip));
    this.rouletteOverlay = ov;
    scene.tweens.add({ targets: ov, alpha: look.alpha, duration: 150, ease: 'Sine.easeOut' });
    // One hot flash on the way in, so the reveal reads as a STOP, not a fade.
    const flash = scene.add.image(0, 0, 'card_face')
      .setDisplaySize(CARD.w, CARD.h).setTint(look.tint).setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.add(flash);
    scene.tweens.add({ targets: flash, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
    if (this.banner) {
      // ...and it re-picks on the roulette result, whose GOLD lands on a card
      // that has just been washed gold.
      this.banner.setText(look.label).setColor(look.color)
        .setStroke(bannerStroke(look.color), 3).setScale(this.bannerBaseScale ?? 1);
      const maxW = CARD.w - 2 * CARD.padX + 16;
      if (this.banner.width * this.banner.scaleX > maxW) this.banner.setScale(maxW / this.banner.width);
      const to = this.banner.scaleX;
      this.banner.setScale(to * 1.5);
      scene.tweens.add({ targets: this.banner, scaleX: to, scaleY: to, duration: 220, ease: 'Back.easeOut' });
    }
    return result;
  }

  /**
   * Debuff lock states. 'frozen' and 'banned' make the card unplayable
   * (with an overlay); 'hypno' force-selects it. null clears.
   */
  setLockState(state) {
    if (this.lockOverlay) { this.lockOverlay.destroy(true); this.lockOverlay = null; }
    this.lockState = state ?? null;
    this.hypno = state === 'hypno';
    if (state === 'frozen' || state === 'banned') {
      const ov = this.scene.add.container(0, 0);
      // Tucked a few px inside on painted cards so the square-ish sheet never
      // pokes out past the frame's rounded corners.
      const sheet = this.scene.add.image(0, 0, state === 'frozen' ? 'fx_frost_card' : 'fx_veil_card')
        .setDisplaySize(CARD.w - (this.painted ? 8 : 0), CARD.h - (this.painted ? 10 : 0));
      ov.add(sheet);
      const icon = this.scene.add.image(0, 0, state === 'frozen' ? 'icon_snow' : 'icon_magic')
        .setAlpha(0.9);
      if (state === 'banned') icon.setTint(0xb080ff);
      icon.setScale(54 / Math.max(icon.width, icon.height));
      ov.add(icon);
      this.add(ov);
      this.lockOverlay = ov;
      if (this.selected) this.setSelected(false);
    } else if (state === 'hypno') {
      this.glowPulse?.remove(); this.glowPulse = null;
      this.glow.setTint(0xff70c0);
      this.scene.tweens.add({ targets: this.glow, alpha: 0.85, duration: 200 });
    } else {
      this.glow.setTint(0xffd23e);
      if (!this.selected) this.scene.tweens.add({ targets: this.glow, alpha: 0, duration: 150 });
    }
  }

  get playLocked() { return this.lockState === 'frozen' || this.lockState === 'banned'; }

  /**
   * GRIMWATCH'S MARK (JC, 2026-08-04: "put an Eye effect on the card itself
   * that's attached to the card until the effect wears off"). The old gold
   * halo was a free-floating image at the card's position — the first re-fan
   * left it hanging over empty felt. The eye is a CHILD of the sprite now, so
   * wherever the card goes (sort, drag, a suit scramble's rebuild), the gaze
   * goes with it. Not a lock: the card stays perfectly playable — playing it
   * is exactly what he wants.
   */
  setMarked(on) {
    if (this.markOverlay) { this.markOverlay.destroy(true); this.markOverlay = null; }
    this.marked = !!on;
    if (!on || !this.scene) return;
    const scene = this.scene;
    const ov = scene.add.container(0, 0);
    const glow = scene.add.image(0, 0, 'fx_glow_circle').setTint(0xffd23e)
      .setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    glow.setScale(66 / Math.max(glow.width, glow.height));
    ov.add(glow);
    // The watcher's own sigil, if Caleb's icon has landed; the arcane eye
    // placeholder otherwise.
    const key = scene.textures.exists('boss_icon_grimwatch') ? 'boss_icon_grimwatch' : 'icon_magic';
    const eye = scene.add.image(0, 0, key).setAlpha(0.95);
    eye.setScale(50 / Math.max(eye.width, eye.height));
    ov.add(eye);
    scene.tweens.add({
      targets: glow, alpha: 0.9, scale: glow.scale * 1.18,
      duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.add(ov);
    this.markOverlay = ov;
  }

  // =========================================================================
  // THE BIOME RENDER STATES (2026-08-03) — BLIND and FADE
  // -------------------------------------------------------------------------
  // Neither is a lock. BLIND turns the card OVER and it stays perfectly
  // playable; FADE makes it ethereal-looking and it stays perfectly playable.
  // That is why they live here beside setLockState rather than inside it: the
  // denial gate must never learn about either of them.
  // =========================================================================

  /**
   * BLIND — the Nocturnal Forest. The card renders FACE DOWN, on top of
   * everything it is wearing, and is still entirely playable. It denies
   * INFORMATION, never the card.
   */
  setBlinded(on) {
    if (this.blindOverlay) { this.blindOverlay.destroy(true); this.blindOverlay = null; }
    this.blinded = !!on;
    if (!on || !this.scene) return;
    const scene = this.scene;
    const ov = scene.add.container(0, 0);
    // Opaque back plate. It covers the WHOLE card, corners included, so there
    // is no sliver of the face left to read at the edges.
    ov.add(scene.add.image(0, 0, scene.textures.exists('fx_back_card') ? 'fx_back_card' : 'card_face')
      .setDisplaySize(CARD.w, CARD.h)
      .setTint(scene.textures.exists('fx_back_card') ? 0xffffff : 0x141026));
    // The moon behind the mark.
    const moon = scene.add.image(0, CARD.pipY, 'fx_glow_circle')
      .setTint(0x9fb4ff).setAlpha(0.30).setScale(0.42).setBlendMode(Phaser.BlendModes.ADD);
    ov.add(moon);
    scene.tweens.add({
      targets: moon, alpha: 0.5, scale: 0.5, duration: 1500,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    // ...and the mark itself. A question mark is the one glyph nobody has to be
    // taught, and it is what makes a screenshot of a blinded hand unambiguous.
    const q = scene.add.text(0, CARD.pipY - 4, '?', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '96px',
      color: '#dfe6ff', stroke: '#0d0a1c', strokeThickness: 9,
    }).setOrigin(0.5);
    ov.add(q);
    const ribbon = scene.add.text(0, CARD.h / 2 - CARD.bannerY, 'FACE DOWN', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
      color: '#aab8ee', stroke: '#0d0a1c', strokeThickness: 4,
    }).setOrigin(0.5);
    fitToCard(ribbon);
    ov.add(ribbon);
    this.add(ov);
    this.blindOverlay = ov;
    // The flip: the card turns over rather than fading into a back, so the
    // player sees WHICH card the moonlight took.
    ov.setAlpha(0);
    const half = CARD.w * 0.02;
    scene.tweens.chain({
      targets: this,
      tweens: [
        { scaleX: half / CARD.w, duration: 110, ease: 'Sine.easeIn' },
        { scaleX: this.selected ? 1.06 : 1, duration: 130, ease: 'Sine.easeOut' },
      ],
    });
    scene.time.delayedCall(110, () => ov.active && ov.setAlpha(1));
  }

  /**
   * FADE — the Ethereal Plains. The card takes the ghost's transparency and
   * says FADED on the ribbon, because it carries the ethereal RISK and none of
   * the ethereal reward and the player has to be able to tell the two apart at
   * a glance. Irreversible for the fight, so there is no `off` branch.
   */
  setFaded() {
    if (this.faded || !this.scene) return;
    this.faded = true;
    if (!this.ghostly) this.makeGhostly(this.scene);
    const scene = this.scene;
    if (this.banner) {
      this.banner.setText('FADED').setColor('#6f7fa8')
        .setStroke('#ffffff', 3).setScale(this.bannerBaseScale ?? 1);
    } else {
      const bn = fitToCard(scene.add.text(0, CARD.h / 2 - CARD.bannerY, 'FADED', {
        fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
        color: '#6f7fa8', stroke: '#ffffff', strokeThickness: 3,
      }).setOrigin(0.5));
      this.add(bn);
      this.banner = bn;
      this.bannerBaseScale = bn.scaleX;
    }
    // A pale cold flare as it lets go of its edges.
    const flash = scene.add.image(0, 0, 'card_face')
      .setDisplaySize(CARD.w, CARD.h).setTint(0xcfd8ee).setAlpha(0.8)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.add(flash);
    scene.tweens.add({
      targets: flash, alpha: 0, duration: 480, ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  /**
   * BURNED — Act III. The card is spent for the rest of the fight, and the
   * denial gate has already locked it ('banned'); this is only the LOOK, so a
   * burned card never gets mistaken for a sealed suit. Charred, ash-grey, and
   * it says SPENT where its ribbon goes.
   */
  setBurnedLook() {
    if (this.burnedLook || !this.scene) return;
    this.burnedLook = true;
    const scene = this.scene;
    const ov = scene.add.container(0, 0);
    // Char: a dark warm wash over the whole card, opaque enough that the face
    // reads as ruined rather than merely tinted.
    // 0.92 / near-black since 2026-08-04 (JC: "blacken it") — the face has to
    // read as CHARCOAL, not as a card seen through smoke.
    ov.add(scene.add.image(0, 0, 'card_face')
      .setDisplaySize(CARD.w - 6, CARD.h - 6).setTint(0x1c100c).setAlpha(0.92));
    const ember = scene.add.image(0, CARD.pipY, 'fx_glow')
      .setTint(0xff6a20).setAlpha(0.4).setDisplaySize(CARD.w * 0.9, CARD.h * 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    ov.add(ember);
    scene.tweens.add({
      targets: ember, alpha: 0.12, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    const mark = scene.add.text(0, CARD.pipY - 4, 'BURNED', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '30px',
      color: '#ffb070', stroke: '#1a0c06', strokeThickness: 7,
    }).setOrigin(0.5);
    // FIT FIRST, THEN TILT. The word is wider than a 140px card at 30px, and a
    // stamp that runs off onto the card beside it reads as a rendering bug
    // rather than as a brand. The rotation is applied after the fit so the
    // measured width is the horizontal one.
    fitToCard(mark);
    mark.setAngle(-14);
    ov.add(mark);
    const spent = scene.add.text(0, CARD.h / 2 - CARD.bannerY, 'SPENT', {
      fontFamily: 'Lilita One', resolution: 2, fontSize: '19px',
      color: '#c08050', stroke: '#1a0c06', strokeThickness: 4,
    }).setOrigin(0.5);
    fitToCard(spent);
    ov.add(spent);
    this.add(ov);
    this.burnOverlay = ov;
  }

  setSelected(on) {
    this.selected = on;
    // The lift owns y and scale on its own. A SWEEP can toggle the same card
    // twice inside 140ms (cross it, cross it back), and two Back.easeOut tweens
    // running on one target fight over the overshoot and leave the card parked
    // a few px off its slot. So the previous lift is retired before the new one
    // starts, which is also why a rapid click-click has stopped wobbling.
    this._liftTween?.remove();
    this._liftTween = this.scene.tweens.add({
      targets: this,
      y: this.baseY - (on ? CARD.selectLift : 0),
      scale: on ? 1.06 : 1,
      duration: 140, ease: 'Back.easeOut',
    });
    // Gold halo in, then a slow breath while it stays picked — enough life to
    // feel chosen without turning the fan into a neon sign. Half the old
    // strength (JC: the select glow was blowing out the arena around it).
    this.glowPulse?.remove();
    this.glowPulse = null;
    this.scene.tweens.add({
      targets: this.glow, alpha: on ? 0.31 : 0, duration: 140,
      onComplete: () => {
        if (!on || !this.active || !this.selected) return;
        this.glowPulse = this.scene.tweens.add({
          targets: this.glow, alpha: 0.20, duration: 950, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      },
    });
  }

  hover(on) {
    if (this.selected) return;
    this.scene.tweens.add({
      targets: this,
      y: this.baseY - (on ? CARD.hoverLift : 0),
      duration: 110, ease: 'Sine.easeOut',
    });
  }
}
