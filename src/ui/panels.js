/** Cartoon parchment/wood panel factory — bold lines, drop shadow, optional accent ring. */
export function woodPanel(scene, x, y, w, h, { accent = null, shadow = true } = {}) {
  const parts = {};
  if (shadow) {
    parts.shadow = scene.add.nineslice(x + 7, y + 10, 'panel_wood', 0, w, h, 34, 34, 34, 34)
      .setTint(0x000000).setAlpha(0.35);
  }
  parts.panel = scene.add.nineslice(x, y, 'panel_wood', 0, w, h, 34, 34, 34, 34);
  if (accent != null) {
    parts.line = scene.add.nineslice(x, y, 'panel_line', 0, w, h, 34, 34, 34, 34).setTint(accent);
  }
  return parts;
}
