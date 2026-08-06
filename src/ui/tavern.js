import { GAME_W, GAME_H } from '../config.js';

/**
 * WHERE THE PAINTING'S FURNITURE ACTUALLY IS.
 *
 * `bg_menu_tavern` is 2544 wide and is cover-fitted to GAME_W, so every landmark
 * inside it — the hearth, the floorboards the heroes stand on — moves when
 * GAME_W does. The desktop numbers (fire at x=384, floor at y=950) were read off
 * the 1920 build by eye; expressed as offsets from the image's own centre in
 * SOURCE pixels they hold for the 2340-wide mobile build too, where the same
 * painting zooms and the hearth slides right.
 *
 * Anything that has to sit ON the painting (the fire glow, the embers, the title
 * screen's hero lineup) asks here rather than typing 384 again.
 */
export function tavernAnchors() {
  const scale = GAME_W / 2544;
  return {
    scale,
    // 763 source px left of the painting's centre = x 384 on a 1920 canvas.
    fireX: GAME_W / 2 - 763 * scale,
    fireY: 580,
    // 609 source px below the painting's centre (which sits at y 490) = y 950 on
    // desktop. Clamped, because the mobile zoom would otherwise push the floor
    // line down onto the footer copy.
    floorY: Math.min(984, 490 + 609 * scale),
  };
}

/**
 * Caleb's forge-tavern, alive: Ken Burns drift, fire flicker, embers, window glow.
 *
 * `opts.beforeDim` is called with the scene after the painting and its lights
 * are down but BEFORE the dim rectangle, which is the only seam where something
 * can be added that reads as part of the painting rather than as furniture
 * standing in front of it (the title screen's drifting cards live there).
 */
export function addTavernBackdrop(scene, dimAlpha = 0.45, opts = {}) {
  const anchor = tavernAnchors();
  const bg = scene.add.image(GAME_W / 2, 490, 'bg_menu_tavern').setScale(anchor.scale);
  scene.tweens.add({
    targets: bg, scale: anchor.scale * 1.05, y: 470, duration: 22000,
    yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });

  // The hearth breathes a little harder than it used to (0.16-0.34 -> 0.15-0.40)
  // and reaches a touch further. Still a glow on a painting, not a light source.
  const fireGlow = scene.add.image(anchor.fireX, anchor.fireY, 'fx_glow')
    .setBlendMode(Phaser.BlendModes.ADD).setTint(0xff8830).setAlpha(0.22).setScale(2.2, 1.6);
  scene.tweens.add({
    targets: fireGlow, alpha: { from: 0.15, to: 0.40 }, scale: 2.62,
    duration: 360, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  const windowGlow = scene.add.image(1016, 300, 'fx_glow')
    .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd890).setAlpha(0.12).setScale(2.4, 2.0);
  scene.tweens.add({
    targets: windowGlow, alpha: 0.2, duration: 3400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });

  // Embers, 340ms apart rather than 420, and roughly one in four now leaves the
  // coals GOLD instead of orange — the flecks that make a real fire look hot.
  scene.time.addEvent({
    delay: 340, loop: true,
    callback: () => {
      const gold = Phaser.Math.Between(0, 3) === 0;
      const e = scene.add.image(
        anchor.fireX + Phaser.Math.Between(-90, 90), anchor.fireY + 40,
        `particle_ember_${Phaser.Math.Between(1, 3)}`,
      )
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0).setScale(Phaser.Math.FloatBetween(gold ? 0.10 : 0.16, gold ? 0.22 : 0.34))
        .setAngle(Phaser.Math.Between(-30, 30)).setDepth(1);
      if (gold) e.setTint(0xffd23e);
      scene.tweens.add({
        targets: e, alpha: { from: gold ? 1 : 0.85, to: 0 },
        y: e.y - Phaser.Math.Between(160, gold ? 400 : 320), x: e.x + Phaser.Math.Between(-30, 50),
        duration: Phaser.Math.Between(1800, 3200), ease: 'Sine.easeOut',
        onComplete: () => e.destroy(),
      });
    },
  });

  opts.beforeDim?.(scene, anchor);

  const dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x140c06, dimAlpha);
  return { bg, fireGlow, windowGlow, dim, anchor };
}
