/**
 * SFX engine. File list is EMBEDDED (no runtime fetch — a cached/failed manifest
 * fetch once made all sfx silently vanish). Queue from Boot.preload so sounds
 * load with the main asset batch. Missing/failed files are silent no-ops.
 */
import { settings } from './settings.js';

export const SFX_FILES = [
  'button.mp3', 'buy.mp3', 'card_deal.mp3', 'card_deselect.mp3', 'card_hover.mp3',
  'card_select.mp3', 'chest_open.mp3', 'chips.mp3', 'chips_stack.mp3',
  'hand_play.mp3', 'heal.mp3', 'hit_big.mp3', 'hit_small.mp3',
  'hit_stab.mp3', 'hit_taken.mp3', 'poison.mp3', 'score_tick.mp3', 'shield.mp3',
  'take.mp3', 'warning.mp3',
  'heartbeat.mp3', 'wheel_spin.mp3', 'fear_placed.mp3', 'poison_hit.mp3', 'frozen_placed.mp3',
  'riser.mp3', 'hype.mp3',
  // Caleb's 2026-07-29 drop:
  'menu_select.mp3', 'minor_upgrade.mp3', 'purchase_upgrade.mp3', 'drop_hit.mp3',
  'legendary_appears.mp3', 'mythical_appears.mp3',
  'pack_open_witch.mp3', 'pack_open_smith.mp3', 'pack_open_artisan.mp3',
  'pack_open_dealer.mp3', 'pack_open_forge.mp3',
  'elite_victory.mp3', 'general_victory.mp3', 'game_over.mp3',
  'die_beast_1.mp3', 'die_beast_2.mp3', 'die_creature_1.mp3', 'die_creature_2.mp3',
  'die_humanoid.mp3', 'die_large.mp3', 'die_keeper.mp3',
  // Caleb's 2026-07-30 drop: epic-moment stings (replace riser/warning) + potion.
  'suspense_1.mp3', 'suspense_2.mp3', 'suspense_3.mp3', 'suspense_4.mp3',
  'potion_drink.mp3', 'potion_drink_big.mp3',
  // PAYOFF TIER STINGS — one per damage tier on the score TOTAL (juice.js
  // PAYOFF_TIERS). Delivered 2026-07-30 ("Number effects" drop, color-named
  // sources → tier names; all wav except Fire.mp3).
  'payoff_300.mp3', 'payoff_500.mp3', 'payoff_750.mp3', 'payoff_1000.mp3',
  'payoff_1500.mp3', 'payoff_2500.mp3', 'payoff_5000.mp3', 'payoff_12500.mp3',
  'payoff_50000.mp3', 'payoff_100000.mp3',
  // JC, 2026-08-02: the ACHIEVEMENT unlock chime. Its own sound rather than the
  // secret-hand sting, because an achievement can fire in the middle of a fight
  // and must not be mistaken for something the hand just did.
  'achievement.mp3',
  // Still requested (docs/REQUESTS_AUDIO.txt): 'map_travel.mp3', 'seal_suit.mp3',
];

/** Call from Boot.preload() — queues sfx with the rest of the preload batch. */
export function queueSfx(scene) {
  for (const f of SFX_FILES) {
    scene.load.audio('sfx_' + f.replace(/\.[^.]+$/, ''), 'assets/audio/sfx/' + f);
  }
}

/**
 * Play a sound effect. rate jitter keeps rapid repeats (card hovers!) organic.
 */
export function sfx(scene, key, { volume = 1, rate = 1, jitter = 0 } = {}) {
  const k = 'sfx_' + key;
  if (!scene.cache.audio.exists(k)) return false;
  return scene.sound.play(k, {
    volume: volume * settings.master * settings.sfx,
    rate: jitter ? rate + (Math.random() * 2 - 1) * jitter : rate,
  });
}

const SUSPENSE_KEYS = ['suspense_1', 'suspense_2', 'suspense_3', 'suspense_4'];
let lastSuspense = null;
let lastSuspenseAt = 0;
const SUSPENSE_COOLDOWN_MS = 6000;

/**
 * The "epic moment" sting — mythic drops, suspense stings, big reveals.
 * Picks randomly among 4 variants (never repeating the last one) and
 * enforces a once-per-event cooldown: if a suspense moment already fired
 * within the last 6s, this call is a silent no-op (returns null). That kills
 * the historical double-sting where a map event and the follow-up ceremony
 * both tried to play their own epic hit for what is really ONE event.
 */
export function suspense(scene, { volume = 0.75, rate = 1 } = {}) {
  const now = Date.now();
  if (now - lastSuspenseAt < SUSPENSE_COOLDOWN_MS) return null;
  lastSuspenseAt = now;

  let key = SUSPENSE_KEYS[Phaser.Math.Between(0, SUSPENSE_KEYS.length - 1)];
  if (SUSPENSE_KEYS.length > 1) {
    while (key === lastSuspense) key = SUSPENSE_KEYS[Phaser.Math.Between(0, SUSPENSE_KEYS.length - 1)];
  }
  lastSuspense = key;

  return sfx(scene, key, { volume, rate });
}

/**
 * Play a sound but cut it off after capMs (fade 90ms). For long source files
 * that need to FEEL short (buy cha-ching, victory sting) until trimmed
 * versions arrive.
 */
export function sfxCapped(scene, key, { volume = 1, rate = 1 } = {}, capMs = 700) {
  const k = 'sfx_' + key;
  if (!scene.cache.audio.exists(k)) return null;
  const snd = scene.sound.add(k, { volume: volume * settings.master * settings.sfx, rate });
  snd.play();
  scene.time.delayedCall(capMs, () => {
    if (!snd.isPlaying) { snd.destroy(); return; }
    scene.tweens.add({
      targets: snd, volume: 0, duration: 90,
      onComplete: () => { snd.stop(); snd.destroy(); },
    });
  });
  return snd;
}

/**
 * LOOPING SFX RE-READ THE SLIDER (JC, 2026-08-06).
 *
 * A one-shot takes `settings.master * settings.sfx` at the moment it is played
 * and is gone before anyone can change it. A LOOP is different: the low-health
 * heartbeat (CombatScene.updateHeartbeat) is started once, at whatever the
 * volume was then, and then runs for the rest of the fight — so turning SFX
 * down in the settings menu while you are at 12 HP turned everything down
 * EXCEPT the sound you were trying to silence. There is no Phaser-side "sfx
 * bus" to ride: `scene.sound.volume` is the master and music shares it.
 *
 * So a live loop registers a re-apply callback here and the volume rows call
 * refreshSfxVolume() alongside refreshMusicVolume(). Callbacks, not sound
 * objects, because the owner knows its own base level and whether a fade is in
 * flight that has to be killed first.
 */
const SFX_LOOPS = new Set();

/** The bus level a looping sfx should be sitting at right now. */
export function sfxBusVolume() { return settings.master * settings.sfx; }

/** Register a live loop. Returns the unregister function — call it on shutdown. */
export function registerSfxLoop(apply) {
  SFX_LOOPS.add(apply);
  return () => SFX_LOOPS.delete(apply);
}

/** Re-apply the bus level to every registered loop. Called when a slider moves. */
export function refreshSfxVolume() {
  for (const apply of [...SFX_LOOPS]) {
    try { apply(sfxBusVolume()); } catch { SFX_LOOPS.delete(apply); }
  }
}

/** Diagnostic used by the settings menu's SFX TEST row. */
export function sfxDiagnostic(scene) {
  const cached = SFX_FILES.filter(f => scene.cache.audio.exists('sfx_' + f.replace(/\.[^.]+$/, ''))).length;
  const ctx = scene.sound.context ? scene.sound.context.state : 'html5';
  return `${cached}/${SFX_FILES.length} loaded · audio ${ctx} · vol ${Math.round(settings.master * settings.sfx * 100)}%`;
}
