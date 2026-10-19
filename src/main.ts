import * as THREE from "three";
import { createGround, createSky, createStars } from "./world.ts";
import { createMovement } from "./movement.ts";
import { createHud } from "./hud.ts";
import { createGates } from "./gates.ts";
import { createScore } from "./score.ts";
import { createPopups } from "./popups.ts";
import { createAudioEngine } from "./audio/engine.ts";
import { createWorldAudio } from "./audio/world-audio.ts";
import { createDevPanel } from "./audio/dev-panel.ts";
import { SOUND_IDS } from "./audio/sounds.ts";

const EYE_HEIGHT = 2.2;

const container = document.getElementById("app")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Far plane reaches past the gate fade distance (see gates.ts).
const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 6000);
camera.position.set(0, EYE_HEIGHT, 0);

const sky = createSky();
const stars = createStars();
const ground = createGround();
stars.material.uniforms.uPixelRatio!.value = renderer.getPixelRatio();
const gates = createGates();
scene.add(sky.mesh, stars.points, ground.mesh, gates.group);

// Only the gates use built-in materials, so fog and lights affect just them.
// The fog color matches the violet horizon glow they fade into.
scene.fog = new THREE.Fog(0x5a2fb0, 600, 5200);
scene.add(new THREE.HemisphereLight(0xb45cff, 0x0b6f86, 1.6));

const movement = createMovement(camera, EYE_HEIGHT);
const hud = createHud();
const score = createScore();
const popups = createPopups(scene, camera);

// Sound: the listener rides on the camera; gates get positional hums.
const audio = createAudioEngine(camera);
void audio.preload(SOUND_IDS);
const worldAudio = createWorldAudio(audio, gates);

// Sound lab dev panel: backtick toggles it, ?dev opens it on load.
let devPanel: ReturnType<typeof createDevPanel> | null = null;
const soundLab = () => (devPanel ??= createDevPanel({ engine: audio, worldAudio, scene, camera }));
if (new URLSearchParams(location.search).has("dev")) soundLab().setOpen(true);

const onAudioKey = (e: KeyboardEvent) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Backquote") soundLab().toggle();
  if (e.code === "KeyM") {
    audio.setMuted(!audio.muted());
    devPanel?.refresh();
  }
};
window.addEventListener("keydown", onAudioKey);

function resize() {
  const { clientWidth: width, clientHeight: height } = container;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
const observer = new ResizeObserver(resize);
observer.observe(container);
resize();

const heading = new THREE.Vector3();
const timer = new THREE.Timer();
timer.connect(document);

renderer.setAnimationLoop((time) => {
  timer.update(time);
  // Cap the step so a long pause (tab switch) doesn't teleport the camera.
  const dt = Math.min(timer.getDelta(), 0.1);
  const elapsed = timer.getElapsed();

  movement.update(dt, elapsed);

  // Sky and stars are infinitely far away: keep them centered on the camera.
  sky.mesh.position.copy(camera.position);
  stars.points.position.copy(camera.position);
  stars.material.uniforms.uTime!.value = elapsed;
  camera.getWorldDirection(heading);
  sky.material.uniforms.uForward!.value.set(heading.x, heading.z).normalize();

  // The floor plane follows the camera; the grid lines are drawn in world space,
  // so the floor looks endless and the lines still scroll past as you move.
  ground.mesh.position.set(camera.position.x, 0, camera.position.z);
  ground.material.uniforms.uCamPos!.value.copy(camera.position);
  gates.update(camera.position, elapsed);

  const passed = gates.crossedGate();
  if (passed && score.pass(passed)) popups.spawn("GATES +1");
  popups.update(dt);

  renderer.render(scene, camera);
  hud.update(movement.state(), gates.nearestGate(), score.value());
  worldAudio.update(movement.state(), elapsed, camera.position);
});

// Exposed for automated browser tests.
(window as unknown as { __vaporwave: unknown }).__vaporwave = { camera, renderer, scene, audio, score };

// Bun requires the literal `import.meta.hot.<api>` form (no `?.`).
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    movement.dispose();
    hud.dispose();
    timer.dispose();
    window.removeEventListener("keydown", onAudioKey);
    devPanel?.dispose();
    worldAudio.dispose();
    audio.dispose();
    popups.dispose();
    gates.dispose();
    for (const obj of [sky.mesh, stars.points, ground.mesh]) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
    renderer.dispose();
    renderer.domElement.remove();
  });
}
