/**
 * Every sound the scene uses. To add one: drop the .wav into public/sounds/
 * (sfx/ or ambience/), add an entry here, then trigger it from world-audio.ts.
 * Use the sound lab (backtick key) to audition files and tune these values.
 */

/** Mixer groups, each with its own volume slider. */
export type Bus = "sfx" | "ambience" | "ui";
export const BUSES: readonly Bus[] = ["sfx", "ambience", "ui"];

export interface SpatialDef {
  /** Distance (world units) where the sound is at full volume. */
  refDistance: number;
  /** Past this distance the sound stops getting quieter. */
  maxDistance: number;
  /** How fast volume drops with distance (inverse model). */
  rolloff: number;
  /** Optional directional cone, angles in degrees. */
  cone?: { inner: number; outer: number; outerGain: number };
}

export interface SoundDef {
  /** Path served by index.ts, e.g. "/sounds/sfx/gate-pass.wav". */
  url: string;
  bus: Bus;
  /** Linear gain, default 1. */
  volume?: number;
  loop?: boolean;
  /** Random ± playback rate applied to each one-shot, so repeats don't sound identical. */
  pitchJitter?: number;
  /** Present when the sound is placed in the world. */
  spatial?: SpatialDef;
}

export const SOUNDS = {
  // Ambience
  spaceBed: { url: "/sounds/ambience/Deep Ambience.wav", bus: "ambience", volume: 0.6, loop: true },
  gateHum: {
    url: "/sounds/ambience/Bluezone_BC0253_ambience_texture_synth_02.wav",
    bus: "ambience",
    volume: 0.8,
    loop: true,
    spatial: { refDistance: 40, maxDistance: 1200, rolloff: 1.2 },
  },

  // In-world effects
  gatePulse: {
    url: "/sounds/sfx/Hollow Tone Riser.wav",
    bus: "sfx",
    volume: 0.5,
    pitchJitter: 0.03,
    spatial: { refDistance: 120, maxDistance: 2500, rolloff: 0.8 },
  },
  gatePass: { url: "/sounds/sfx/Bluezone_BC0253_texture_synth_12.wav", bus: "sfx", volume: 0.9 },

  // Ship / interface
  gearUp: { url: "/sounds/sfx/Bluezone-ISE-soundFX-083.wav", bus: "ui", volume: 0.7, pitchJitter: 0.02 },
  gearDown: { url: "/sounds/sfx/Bluezone-ISE-soundFX-135.wav", bus: "ui", volume: 0.7, pitchJitter: 0.02 },
  boostOn: { url: "/sounds/sfx/Bluezone-ISE-soundFX-101.wav", bus: "ui", volume: 0.8 },
  boostOff: { url: "/sounds/sfx/Bluezone-ISE-soundFX-139.wav", bus: "ui", volume: 0.6 },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];

/** Background beds the sound lab can switch between. */
export const AMBIENCES: readonly SoundId[] = ["spaceBed"];
export const DEFAULT_AMBIENCE: SoundId = "spaceBed";

export function soundDef(id: SoundId): SoundDef {
  return SOUNDS[id];
}
