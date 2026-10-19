import * as THREE from "three";
import { GATE_HEIGHT, PULSE_PERIOD, type Gates } from "../gates.ts";
import { MAX_SPEED, type MovementState } from "../movement.ts";
import type { AudioEngine } from "./engine.ts";
import { DEFAULT_AMBIENCE, SOUNDS } from "./sounds.ts";

/** Pulse sounds play on at most this many of the nearest gates. */
const PULSE_VOICES = 2;

/**
 * Connects the scene to sound: a humming emitter on every gate, a pulse in
 * time with the beam flash, a whoosh when flying through a gate, and clicks
 * for gear shifts and boost.
 */
export function createWorldAudio(engine: AudioEngine, gates: Gates) {
  // One hum per gate, at the height of the neon tube so it sounds like it comes from the frame.
  const hums = gates.slots().map((gate) => {
    const anchor = new THREE.Object3D();
    anchor.position.y = GATE_HEIGHT * 0.4;
    gate.add(anchor);
    const audio = engine.positional("gateHum", anchor, { randomStart: true });
    return { anchor, audio, distance: 0 };
  });

  // Starts silently while audio is locked and fades in after the first key press.
  engine.setAmbience(DEFAULT_AMBIENCE, 4);

  let lastPulse = -1;
  let lastGear: number | null = null;
  let lastBoost = false;
  const pulseRange = SOUNDS.gatePulse.spatial.maxDistance;

  function update(state: MovementState, elapsed: number, listenerPos: THREE.Vector3) {
    // Beam flashes when elapsed crosses a multiple of PULSE_PERIOD (see gates.ts).
    const pulse = Math.floor(elapsed / PULSE_PERIOD);
    if (pulse !== lastPulse) {
      if (lastPulse >= 0) {
        for (const hum of hums) hum.distance = hum.anchor.getWorldPosition(new THREE.Vector3()).distanceTo(listenerPos);
        const near = hums.filter((h) => h.distance < pulseRange).sort((a, b) => a.distance - b.distance);
        for (const hum of near.slice(0, PULSE_VOICES)) {
          engine.play("gatePulse", { position: hum.anchor.getWorldPosition(new THREE.Vector3()) });
        }
      }
      lastPulse = pulse;
    }

    if (gates.crossedThisFrame()) {
      // A little higher pitch the faster you go through.
      const speed = Math.min(Math.abs(state.speed) / MAX_SPEED, 1);
      engine.play("gatePass", { rate: 0.9 + speed * 0.3 });
    }

    if (lastGear !== null && state.gear !== lastGear) {
      engine.play(state.gear > lastGear ? "gearUp" : "gearDown");
    }
    lastGear = state.gear;

    if (state.boost !== lastBoost) engine.play(state.boost ? "boostOn" : "boostOff");
    lastBoost = state.boost;
  }

  /** The gate hum emitters (for debug helpers in the sound lab). */
  const emitters = () => hums.map((h) => h.audio);

  function dispose() {
    engine.setAmbience(null, 0);
    for (const hum of hums) {
      engine.release(hum.audio);
      hum.anchor.removeFromParent();
    }
  }

  return { update, emitters, dispose };
}

export type WorldAudio = ReturnType<typeof createWorldAudio>;
