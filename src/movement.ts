import * as THREE from "three";

const KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
type Key = (typeof KEYS)[number];

const MOVE_SPEED = 48; // units per second in 1st gear
const GEAR_STEP = 40; // extra units per second for each gear above 1st
export const GEARS = 5;
const BOOST = 2.5; // multiplier while Shift is held
const TURN_SPEED = 1.6; // radians per second
const SMOOTHING = 6; // higher = snappier start/stop

/** Top speed with boost held, in units per second. */
export const MAX_SPEED = gearSpeed(GEARS) * BOOST;

/** Cruising speed (no boost) for a gear from 1 to GEARS. */
export function gearSpeed(gear: number) {
  return MOVE_SPEED + (gear - 1) * GEAR_STEP;
}

export interface MovementState {
  /** Signed speed in units per second (negative when backing up). */
  speed: number;
  /** Compass heading in degrees: 0 = north (-Z), 90 = east (+X). */
  heading: number;
  /** Total distance moved since load, in units, forward or backward. */
  distance: number;
  /** True while Shift is held. */
  boost: boolean;
  /** Current gear, 1 to GEARS. */
  gear: number;
}

/**
 * Arrow-key movement: Up/Down move forward/back, Left/Right turn.
 * Q / W shift down / up through the gears. Hold Shift to go faster. Velocity is eased so motion glides like a cruise.
 */
export function createMovement(camera: THREE.PerspectiveCamera, eyeHeight: number) {
  const pressed = new Set<Key>();
  let boost = false;
  let yaw = 0;
  let speed = 0;
  let turn = 0;
  let distance = 0;
  let gear = 1;

  const isKey = (code: string): code is Key => (KEYS as readonly string[]).includes(code);

  const onKeyDown = (e: KeyboardEvent) => {
    boost = e.shiftKey;
    // One shift per key press: ignore auto-repeat and browser shortcuts like Cmd+W.
    const letter = e.key.toLowerCase();
    if ((letter === "q" || letter === "w") && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
      gear = THREE.MathUtils.clamp(gear + (letter === "w" ? 1 : -1), 1, GEARS);
      return;
    }
    if (!isKey(e.code)) return;
    e.preventDefault(); // keep arrows from scrolling the page
    pressed.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    boost = e.shiftKey;
    if (isKey(e.code)) pressed.delete(e.code);
  };
  // Releasing a key while the tab is unfocused never fires keyup, so reset.
  const onBlur = () => pressed.clear();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  const forward = new THREE.Vector3();

  function update(dt: number, time: number) {
    const moveInput = (pressed.has("ArrowUp") ? 1 : 0) - (pressed.has("ArrowDown") ? 1 : 0);
    const turnInput = (pressed.has("ArrowLeft") ? 1 : 0) - (pressed.has("ArrowRight") ? 1 : 0);

    // Exponential easing toward the target, frame-rate independent.
    const k = 1 - Math.exp(-SMOOTHING * dt);
    speed += (moveInput * gearSpeed(gear) * (boost ? BOOST : 1) - speed) * k;
    turn += (turnInput * TURN_SPEED - turn) * k;

    yaw += turn * dt;
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    camera.position.addScaledVector(forward, speed * dt);
    distance += Math.abs(speed * dt);

    // Gentle hover bob and a slight bank into turns.
    camera.position.y = eyeHeight + Math.sin(time * 1.2) * 0.05;
    camera.rotation.set(0, yaw, -turn * 0.06, "YXZ");
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  }

  function state(): MovementState {
    // Turning left increases yaw, which swings the heading toward west.
    const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    return { speed, heading, distance, boost, gear };
  }

  return { update, dispose, state };
}
