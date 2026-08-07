/**
 * THE GLEAM. A gold shine bar walks across a target every `period` ms, masked
 * to the target's own painted pixels so it reads as light moving over metal
 * rather than a rectangle sliding past.
 *
 * The mask is built ONCE and reused: a bitmap mask allocates a render texture,
 * and one per sweep every nine seconds is a slow leak on a screen people leave
 * open. Everything is torn down with the scene.
 */
export function gleamSweep(scene, target, { period = 9000, delay = 2400, tint = 0xfff3c4, speed = 900 } = {}) {
  const w = target.displayWidth;
  const h = target.displayHeight;
  const bar = scene.add.image(target.x, target.y, 'fx_glow')
    .setBlendMode(Phaser.BlendModes.ADD)
    .setTint(tint)
    .setDisplaySize(w * 0.20, h * 2.6)
    .setAngle(-20)
    .setAlpha(0);
  const mask = target.createBitmapMask();
  bar.setMask(mask);

  const sweep = () => {
    if (!bar.active) return;
    bar.setPosition(target.x - w * 0.72, target.y);
    bar.setAlpha(0);
    scene.tweens.add({ targets: bar, alpha: 0.68, duration: speed * 0.28, ease: 'Sine.easeOut' });
    scene.tweens.add({
      targets: bar, x: target.x + w * 0.72, duration: speed, ease: 'Sine.easeInOut',
      onComplete: () => scene.tweens.add({ targets: bar, alpha: 0, duration: 200 }),
    });
  };
  const timer = scene.time.addEvent({ delay: period, startAt: Math.max(0, period - delay), loop: true, callback: sweep });
  scene.events.once('shutdown', () => { timer.remove(); mask.destroy(); });
  return { bar, sweep, timer };
}
