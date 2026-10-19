import * as THREE from "three";
import { BUSES, SOUNDS, type Bus, type SoundDef, type SoundId, type SpatialDef } from "./sounds.ts";

/**
 * Audio engine: three.js handles the listener (attached to the camera) and
 * positional loops attached to scene objects; plain Web Audio handles the
 * mixer buses, file loading, overlapping one-shots and ambience beds.
 *
 *   PositionalAudio / one-shot voices → bus (sfx | ambience | ui)
 *     → compressor → listener master gain → speakers
 */

/** Used when a sound without `spatial` settings is placed in the world. */
export const DEFAULT_SPATIAL: SpatialDef = { refDistance: 30, maxDistance: 1000, rolloff: 1 };

/** One-shots that can't start within this many ms (still loading) are dropped. */
const ONE_SHOT_LATENCY_MS = 250;

export interface PlayOptions {
  /** World position: plays through its own HRTF panner. Omit for a flat (non-positional) sound. */
  position?: THREE.Vector3;
  /** Multiplies the sound's manifest volume. */
  volume?: number;
  /** Playback rate (pitch), before pitch jitter. */
  rate?: number;
  /** Override the manifest's loop flag. */
  loop?: boolean;
  /** Fade in over this many seconds. */
  fadeIn?: number;
}

/** A playing sound started by play(). */
export interface Voice {
  /** Stop, optionally fading out over `fade` seconds. */
  stop(fade?: number): void;
  /** Set the gain (multiplies the manifest volume). */
  setVolume(volume: number, fade?: number): void;
  setRate(rate: number): void;
  readonly ended: boolean;
}

export interface AudioStats {
  state: AudioContextState;
  loaded: number;
  failed: number;
  voices: number;
  positional: number;
}

export type AudioEngine = ReturnType<typeof createAudioEngine>;
export type SoundRef = SoundId | SoundDef;

const resolve = (ref: SoundRef): SoundDef => (typeof ref === "string" ? SOUNDS[ref] : ref);

/** Copies spatial settings onto a PannerNode (also used for PositionalAudio.panner). */
export function applySpatial(panner: PannerNode, spatial: SpatialDef) {
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = spatial.refDistance;
  panner.maxDistance = spatial.maxDistance;
  panner.rolloffFactor = spatial.rolloff;
  panner.coneInnerAngle = spatial.cone?.inner ?? 360;
  panner.coneOuterAngle = spatial.cone?.outer ?? 360;
  panner.coneOuterGain = spatial.cone?.outerGain ?? 0;
}

export function createAudioEngine(camera: THREE.Camera) {
  // three.js shares one global context; give each engine its own so it can be
  // closed on hot reload without breaking the next one.
  const context = new globalThis.AudioContext();
  THREE.AudioContext.setContext(context);

  // The camera isn't part of the scene, but WebGLRenderer.render() updates its
  // matrix (and so this listener's position/orientation) every frame.
  const listener = new THREE.AudioListener();
  camera.add(listener);

  // Keeps many overlapping sounds from clipping.
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.connect(listener.getInput());

  const busVolumes = Object.fromEntries(BUSES.map((b) => [b, 1])) as Record<Bus, number>;
  const buses = Object.fromEntries(
    BUSES.map((b) => {
      const gain = context.createGain();
      gain.connect(compressor);
      return [b, gain];
    }),
  ) as Record<Bus, GainNode>;

  let masterVolume = 1;
  let muted = false;
  let disposed = false;

  // Browsers keep audio suspended until the user interacts with the page.
  const unlock = () => {
    if (context.state !== "running" && !disposed) void context.resume();
  };
  const unlockEvents = ["keydown", "pointerdown", "touchstart"] as const;
  for (const type of unlockEvents) window.addEventListener(type, unlock, { capture: true });

  // ---------------------------------------------------------------- loading

  const cache = new Map<string, Promise<AudioBuffer | null>>();
  let loaded = 0;
  let failed = 0;

  /** Fetch and decode a file once; resolves to null (with one warning) if it's missing or broken. */
  function loadUrl(url: string): Promise<AudioBuffer | null> {
    let pending = cache.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          loaded++;
          return buffer;
        })
        .catch((err: unknown) => {
          failed++;
          console.warn(`[audio] couldn't load ${url}: ${err instanceof Error ? err.message : err}`);
          return null;
        });
      cache.set(url, pending);
    }
    return pending;
  }

  const load = (ref: SoundRef) => loadUrl(resolve(ref).url);
  const preload = (ids: readonly SoundId[]) => Promise.all(ids.map(load));

  // -------------------------------------------------------------- one-shots

  const voices = new Set<Voice>();

  /** Play a sound now. Loops keep going until stop(); one-shots clean up after themselves. */
  function play(ref: SoundRef, opts: PlayOptions = {}): Voice {
    const def = resolve(ref);
    const loop = opts.loop ?? def.loop ?? false;
    const baseVolume = def.volume ?? 1;
    let volume = opts.volume ?? 1;
    const requestedAt = performance.now();

    const out = context.createGain();
    out.gain.value = opts.fadeIn ? 0 : baseVolume * volume;
    let panner: PannerNode | null = null;
    if (opts.position) {
      panner = context.createPanner();
      applySpatial(panner, def.spatial ?? DEFAULT_SPATIAL);
      panner.positionX.value = opts.position.x;
      panner.positionY.value = opts.position.y;
      panner.positionZ.value = opts.position.z;
      out.connect(panner).connect(buses[def.bus]);
    } else {
      out.connect(buses[def.bus]);
    }

    let source: AudioBufferSourceNode | null = null;
    let ended = false;
    let stopping = false;

    const cleanup = () => {
      if (ended) return;
      ended = true;
      voices.delete(voice);
      out.disconnect();
      panner?.disconnect();
    };

    const voice: Voice = {
      stop(fade = 0) {
        if (ended || stopping) return;
        if (!source) return cleanup();
        stopping = true;
        const now = context.currentTime;
        if (fade > 0) {
          out.gain.cancelScheduledValues(now);
          out.gain.setValueAtTime(out.gain.value, now);
          out.gain.linearRampToValueAtTime(0, now + fade);
        }
        source.stop(now + fade);
      },
      setVolume(v, fade = 0.05) {
        volume = v;
        out.gain.setTargetAtTime(baseVolume * v, context.currentTime, fade / 3);
      },
      setRate(rate) {
        source?.playbackRate.setTargetAtTime(rate, context.currentTime, 0.02);
      },
      get ended() {
        return ended;
      },
    };
    voices.add(voice);

    void loadUrl(def.url).then((buffer) => {
      if (ended || stopping) return cleanup();
      // A one-shot only makes sense right away: skip it if audio is still locked or it loaded late.
      const late = performance.now() - requestedAt > ONE_SHOT_LATENCY_MS;
      if (!buffer || (!loop && (context.state !== "running" || late))) return cleanup();

      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      const jitter = def.pitchJitter ? (Math.random() * 2 - 1) * def.pitchJitter : 0;
      source.playbackRate.value = (opts.rate ?? 1) * (1 + jitter);
      source.connect(out);
      source.onended = cleanup;
      const now = context.currentTime;
      if (opts.fadeIn) {
        out.gain.setValueAtTime(0, now);
        out.gain.linearRampToValueAtTime(baseVolume * volume, now + opts.fadeIn);
      }
      source.start(now);
    });

    return voice;
  }

  // ----------------------------------------------------- positional (three.js)

  const positionals = new Set<THREE.PositionalAudio>();

  /**
   * A looping three.js PositionalAudio attached to `parent`: it follows the
   * object around the scene. Starts once its file has loaded.
   */
  function positional(ref: SoundRef, parent: THREE.Object3D, opts: { randomStart?: boolean } = {}) {
    const def = resolve(ref);
    const audio = new THREE.PositionalAudio(listener);
    applySpatial(audio.panner, def.spatial ?? DEFAULT_SPATIAL);
    // Route through our mixer bus instead of straight into the listener.
    audio.gain.disconnect();
    audio.gain.connect(buses[def.bus]);
    audio.setVolume(def.volume ?? 1);
    audio.setLoop(def.loop ?? true);
    parent.add(audio);
    positionals.add(audio);

    void loadUrl(def.url).then((buffer) => {
      if (!buffer || !positionals.has(audio)) return;
      audio.setBuffer(buffer);
      // Different start points so identical loops don't play in lockstep.
      if (opts.randomStart) audio.offset = Math.random() * buffer.duration;
      audio.play();
    });
    return audio;
  }

  /** Stop a PositionalAudio from positional() and detach it. */
  function release(audio: THREE.PositionalAudio) {
    if (!positionals.delete(audio)) return;
    if (audio.isPlaying) audio.stop();
    audio.panner.disconnect();
    audio.gain.disconnect();
    audio.removeFromParent();
  }

  // --------------------------------------------------------------- ambience

  let ambience: { id: SoundId; voice: Voice } | null = null;

  /** Crossfade to another background bed, or to silence with null. */
  function setAmbience(id: SoundId | null, fade = 2) {
    if ((ambience?.id ?? null) === id) return;
    ambience?.voice.stop(fade);
    ambience = id ? { id, voice: play(id, { loop: true, fadeIn: fade }) } : null;
  }

  // ------------------------------------------------------------------ mixer

  const ramp = (param: AudioParam, value: number) => param.setTargetAtTime(value, context.currentTime, 0.03);

  function setBusVolume(bus: Bus, volume: number) {
    busVolumes[bus] = volume;
    ramp(buses[bus].gain, volume);
  }

  function setMasterVolume(volume: number) {
    masterVolume = volume;
    if (!muted) listener.setMasterVolume(volume);
  }

  function setMuted(value: boolean) {
    muted = value;
    listener.setMasterVolume(muted ? 0 : masterVolume);
  }

  function stats(): AudioStats {
    let playing = 0;
    for (const p of positionals) if (p.isPlaying) playing++;
    return { state: context.state, loaded, failed, voices: voices.size, positional: playing };
  }

  function dispose() {
    disposed = true;
    for (const type of unlockEvents) window.removeEventListener(type, unlock, { capture: true });
    for (const voice of [...voices]) voice.stop();
    for (const audio of [...positionals]) release(audio);
    camera.remove(listener);
    void context.close();
  }

  return {
    context,
    listener,
    load,
    loadUrl,
    preload,
    play,
    positional,
    release,
    setAmbience,
    ambience: () => ambience?.id ?? null,
    setBusVolume,
    busVolume: (bus: Bus) => busVolumes[bus],
    setMasterVolume,
    masterVolume: () => masterVolume,
    setMuted,
    muted: () => muted,
    stats,
    dispose,
  };
}
