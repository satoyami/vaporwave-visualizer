import * as THREE from "three";

/** Seconds a popup lives. */
const DURATION = 1.6;
/** Distance ahead of the camera (units) where a popup appears, and where it has faded out. */
const START_DISTANCE = 60;
const END_DISTANCE = 4;
/** Popup height in world units (width follows the text). */
const HEIGHT = 3.6;
/** Lift above the crosshair, as a fraction of the distance (keeps a constant screen offset). */
const LIFT = 0.1;

/** Draws neon text (pink glow, cyan-to-pink fill, white core) into a texture. */
function neonTexture(text: string) {
  const fontSize = 140;
  const font = `italic 900 ${fontSize}px "Avenir Next", "Trebuchet MS", "Arial Black", sans-serif`;
  const pad = 60; // room for the glow
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + pad * 2;
  const height = fontSize + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const x = width / 2;
  const y = height / 2 + fontSize * 0.05;

  // Wide soft glow, then a tighter one.
  ctx.shadowColor = "#ff3fd0";
  for (const blur of [48, 24, 10]) {
    ctx.shadowBlur = blur;
    ctx.strokeStyle = "rgba(255, 80, 210, 0.9)";
    ctx.lineWidth = 8;
    ctx.strokeText(text, x, y);
  }

  const fill = ctx.createLinearGradient(0, y - fontSize / 2, 0, y + fontSize / 2);
  fill.addColorStop(0, "#9ff4ff");
  fill.addColorStop(0.55, "#5fc8ff");
  fill.addColorStop(1, "#ff6fe0");
  ctx.shadowColor = "#5fd8ff";
  ctx.shadowBlur = 16;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);

  // Bright core line, like a neon tube.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.strokeText(text, x, y);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/**
 * Neon text notifications in the 3D scene. Each one appears ahead of the
 * camera, drifts toward the viewer (growing as it nears) and fades out.
 * It's positioned relative to the camera every frame, so it reads the same at any speed.
 */
export function createPopups(scene: THREE.Scene, camera: THREE.Camera) {
  type Popup = { sprite: THREE.Sprite; material: THREE.SpriteMaterial; texture: THREE.Texture; age: number };
  const active: Popup[] = [];

  // Each popup gets its own texture (the text usually changes, e.g. a running total).
  function spawn(text: string) {
    const tex = neonTexture(text);
    const material = new THREE.SpriteMaterial({
      map: tex.texture,
      transparent: true,
      opacity: 0,
      depthTest: false, // always on top of the gates
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(HEIGHT * tex.aspect, HEIGHT, 1);
    sprite.renderOrder = 10;
    scene.add(sprite);
    active.push({ sprite, material, texture: tex.texture, age: 0 });
  }

  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();

  /** Call after the camera has moved for this frame. */
  function update(dt: number) {
    camera.getWorldDirection(forward);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    for (let i = active.length - 1; i >= 0; i--) {
      const popup = active[i]!;
      popup.age += dt;
      const t = Math.min(popup.age / DURATION, 1);
      if (t >= 1) {
        remove(popup);
        active.splice(i, 1);
        continue;
      }
      const distance = THREE.MathUtils.lerp(START_DISTANCE, END_DISTANCE, easeInOut(t));
      popup.sprite.position
        .copy(camera.position)
        .addScaledVector(forward, distance)
        .addScaledVector(up, distance * LIFT);
      // Quick fade in, hold, then fade out over the second half as it closes in.
      const fadeIn = Math.min(t / 0.08, 1);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(t, 0.45, 1);
      popup.material.opacity = fadeIn * fadeOut;
    }
  }

  function remove(popup: Popup) {
    popup.sprite.removeFromParent();
    popup.material.dispose();
    popup.texture.dispose();
  }

  function dispose() {
    for (const popup of active) remove(popup);
    active.length = 0;
  }

  return { spawn, update, dispose };
}
