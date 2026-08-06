import { IMG_EXT } from '../config.js';

/**
 * THE IMG_EXT OVERRIDE, in one place — the whole of the dist's image-format story.
 *
 * Every image the game owns is asked for by a `.png` path at its call site, and
 * the shipped build carries WebP transcodes of all of them instead (see
 * config.js IMG_EXT and tools/build_dist.py). Rather than teach 200+ call sites
 * about a build flag, the LOADER is wrapped once per scene that loads images: a
 * `.png` suffix on any url becomes IMG_EXT, which in the dev tree is '.png' and
 * so is a no-op. Deliberately UNCONDITIONAL — the dev tree runs the exact same
 * code path the shipped build does, so this can never be the thing that only
 * breaks after a build.
 *
 * It lives here, rather than inline in BootScene where it was born, because
 * BootScene stopped being the only scene that loads files the moment PrebootScene
 * arrived (it grabs the logo + embers so the loading screen has something to draw
 * with). A second copy of the rewrite is exactly the kind of thing that gets
 * forgotten and ships a 404 that only the dist can see.
 *
 * `load.image` is the only image loader this project uses (no spritesheet, atlas
 * or svg anywhere in src/ — the generated textures are Graphics/canvas, not
 * files), and `load.audio` is untouched: music stays .mp3 under the same names
 * and the sfx list is rewritten in the dist copy of core/sfx.js by the build.
 * Non-string urls (array/config forms) pass through unchanged.
 *
 * NB tools/build_dist.py's verify() greps the SCENES that call this for their
 * `${A}/....png` literals and proves each one resolves under the new extension.
 * A new scene that loads images must be added to that list.
 */
export function wrapImageLoader(scene) {
  const loadImage = scene.load.image.bind(scene.load);
  scene.load.image = (key, url, ...rest) => loadImage(
    key, typeof url === 'string' ? url.replace(/\.png$/i, IMG_EXT) : url, ...rest);
}
