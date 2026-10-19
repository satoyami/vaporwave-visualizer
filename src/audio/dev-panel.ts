import * as THREE from "three";
import { PositionalAudioHelper } from "three/examples/jsm/helpers/PositionalAudioHelper.js";
import { applySpatial, DEFAULT_SPATIAL, type AudioEngine, type Voice } from "./engine.ts";
import { AMBIENCES, BUSES, SOUND_IDS, SOUNDS, type SoundDef, type SpatialDef } from "./sounds.ts";
import type { WorldAudio } from "./world-audio.ts";

/** How far ahead of the camera the test emitter is placed. */
const EMITTER_DISTANCE = 40;

interface Entry {
  /** Manifest key, or a camelCase name made from the file name for unregistered files. */
  key: string;
  def: SoundDef;
  registered: boolean;
  loop: Voice | null;
}

const camelCase = (url: string) =>
  url
    .replace(/^.*\//, "")
    .replace(/\.wav$/i, "")
    .replace(/[^a-z0-9]+(.)/gi, (_, c: string) => c.toUpperCase())
    .replace(/^./, (c) => c.toLowerCase());

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** TypeScript for a manifest entry, ready to paste into sounds.ts. */
function entrySource(key: string, def: SoundDef) {
  const parts = [`url: "${def.url}"`, `bus: "${def.bus}"`, `volume: ${fmt(def.volume ?? 1)}`];
  if (def.loop) parts.push("loop: true");
  if (def.pitchJitter) parts.push(`pitchJitter: ${fmt(def.pitchJitter)}`);
  if (def.spatial) {
    const s = def.spatial;
    const cone = s.cone
      ? `, cone: { inner: ${fmt(s.cone.inner)}, outer: ${fmt(s.cone.outer)}, outerGain: ${fmt(s.cone.outerGain)} }`
      : "";
    parts.push(`spatial: { refDistance: ${fmt(s.refDistance)}, maxDistance: ${fmt(s.maxDistance)}, rolloff: ${fmt(s.rolloff)}${cone} }`);
  }
  return `${key}: { ${parts.join(", ")} },`;
}

/**
 * Sound lab: a dev panel (backtick key, or ?dev in the URL) to audition every
 * sound, mix the buses, switch ambience, and place a test emitter in the world
 * to tune its spatial settings by flying around it.
 */
export function createDevPanel(opts: {
  engine: AudioEngine;
  worldAudio: WorldAudio;
  scene: THREE.Scene;
  camera: THREE.Camera;
}) {
  const { engine, worldAudio, scene, camera } = opts;

  const root = document.createElement("div");
  root.className = "sound-lab";
  root.hidden = true;
  // Keep typing/sliders from steering the ship (window listeners in movement.ts).
  root.addEventListener("keydown", (e) => {
    if (e.code !== "Backquote") e.stopPropagation();
  });
  document.body.appendChild(root);

  const entries: Entry[] = SOUND_IDS.map((id) => ({
    key: id,
    def: structuredClone(SOUNDS[id]) as SoundDef,
    registered: true,
    loop: null,
  }));
  let selected: Entry = entries[0]!;

  // ---------------------------------------------------------------- markup

  root.innerHTML = `
    <header>
      <span class="sl-title">SOUND LAB</span>
      <span class="sl-status" data-sl="status"></span>
      <button class="sl-close" data-sl="close" title="Close (\`)">×</button>
    </header>

    <section>
      <div class="sl-label">MIXER</div>
      <label class="sl-slider">master <input type="range" min="0" max="1.5" step="0.01" data-bus="master"><output></output></label>
      ${BUSES.map((b) => `<label class="sl-slider">${b} <input type="range" min="0" max="1.5" step="0.01" data-bus="${b}"><output></output></label>`).join("")}
      <label class="sl-check"><input type="checkbox" data-sl="mute"> mute (M)</label>
    </section>

    <section>
      <div class="sl-label">AMBIENCE</div>
      <select data-sl="ambience">
        <option value="">none</option>
        ${AMBIENCES.map((id) => `<option value="${id}">${id}</option>`).join("")}
      </select>
    </section>

    <section>
      <div class="sl-label">SOUNDS <span class="sl-dim">click a name to select</span></div>
      <ul class="sl-list" data-sl="list"></ul>
    </section>

    <section>
      <div class="sl-label">TEST EMITTER · <span data-sl="selected"></span></div>
      <div class="sl-row">
        <button data-sl="place">Place ${EMITTER_DISTANCE}u ahead</button>
        <button data-sl="remove">Remove</button>
      </div>
      <label class="sl-slider">volume <input type="range" min="0" max="2" step="0.01" data-sp="volume"><output></output></label>
      <label class="sl-slider">refDist <input type="range" min="1" max="400" step="1" data-sp="refDistance"><output></output></label>
      <label class="sl-slider">maxDist <input type="range" min="50" max="5000" step="10" data-sp="maxDistance"><output></output></label>
      <label class="sl-slider">rolloff <input type="range" min="0" max="5" step="0.05" data-sp="rolloff"><output></output></label>
      <label class="sl-slider">cone in <input type="range" min="0" max="360" step="5" data-sp="inner"><output></output></label>
      <label class="sl-slider">cone out <input type="range" min="0" max="360" step="5" data-sp="outer"><output></output></label>
      <label class="sl-slider">out gain <input type="range" min="0" max="1" step="0.01" data-sp="outerGain"><output></output></label>
      <label class="sl-check"><input type="checkbox" data-sl="helpers"> show gate emitters</label>
      <div class="sl-row">
        <button data-sl="copy">Copy entry</button>
        <span class="sl-dim" data-sl="copied"></span>
      </div>
    </section>
  `;

  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const el = {
    status: q("[data-sl=status]"),
    list: q("[data-sl=list]"),
    selected: q("[data-sl=selected]"),
    ambience: q<HTMLSelectElement>("[data-sl=ambience]"),
    mute: q<HTMLInputElement>("[data-sl=mute]"),
    helpers: q<HTMLInputElement>("[data-sl=helpers]"),
    copied: q("[data-sl=copied]"),
  };

  /** Wire a range input to a getter/setter and show its value next to it. */
  function slider(input: HTMLInputElement, get: () => number, set: (v: number) => void) {
    const output = input.nextElementSibling as HTMLOutputElement;
    const sync = () => {
      input.value = String(get());
      output.value = fmt(get());
    };
    input.addEventListener("input", () => {
      set(Number(input.value));
      output.value = fmt(Number(input.value));
    });
    sync();
    return sync;
  }

  // ----------------------------------------------------------------- mixer

  slider(q("[data-bus=master]"), engine.masterVolume, engine.setMasterVolume);
  for (const bus of BUSES) {
    slider(q(`[data-bus=${bus}]`), () => engine.busVolume(bus), (v) => engine.setBusVolume(bus, v));
  }
  el.mute.addEventListener("change", () => engine.setMuted(el.mute.checked));
  el.ambience.value = engine.ambience() ?? "";
  el.ambience.addEventListener("change", () => {
    engine.setAmbience((el.ambience.value || null) as Parameters<AudioEngine["setAmbience"]>[0]);
  });

  // ------------------------------------------------------------ sound list

  function renderList() {
    el.list.replaceChildren(
      ...entries.map((entry) => {
        const li = document.createElement("li");
        li.classList.toggle("selected", entry === selected);
        li.classList.toggle("unregistered", !entry.registered);
        li.innerHTML = `
          <button class="sl-name" title="${entry.def.url}">${entry.key}${entry.registered ? "" : " *"}</button>
          <span class="sl-meta">${entry.def.bus}${entry.def.spatial ? " · 3d" : ""}</span>
          <button data-act="play" title="Play once">▶</button>
          <button data-act="loop" title="Loop" class="${entry.loop ? "on" : ""}">⟳</button>
        `;
        li.querySelector(".sl-name")!.addEventListener("click", () => select(entry));
        li.querySelector("[data-act=play]")!.addEventListener("click", () => {
          engine.play(entry.def, { loop: false });
        });
        li.querySelector("[data-act=loop]")!.addEventListener("click", () => {
          if (entry.loop) {
            entry.loop.stop(0.2);
            entry.loop = null;
          } else {
            entry.loop = engine.play(entry.def, { loop: true });
          }
          renderList();
        });
        return li;
      }),
    );
  }

  /** Pull .wav files from the server that aren't in the manifest yet (dev server only). */
  async function loadUnregistered() {
    try {
      const res = await fetch("/api/sounds");
      if (!res.ok) return;
      const urls = (await res.json()) as string[];
      const known = new Set(entries.map((e) => e.def.url));
      for (const url of urls) {
        if (known.has(url)) continue;
        const bus = url.includes("/ambience/") ? "ambience" : "sfx";
        entries.push({ key: camelCase(url), def: { url, bus, volume: 1 }, registered: false, loop: null });
      }
      renderList();
    } catch {
      // Static builds have no /api/sounds; the manifest list is enough.
    }
  }

  // ---------------------------------------------------------- test emitter

  /** Spatial settings for reading (falls back to defaults without changing the entry). */
  const spatialOf = (entry: Entry): SpatialDef => entry.def.spatial ?? DEFAULT_SPATIAL;
  /** Spatial settings for editing: tuning a sound makes it a 3D sound. */
  const editSpatial = (entry: Entry): SpatialDef => (entry.def.spatial ??= structuredClone(DEFAULT_SPATIAL));
  const coneOf = (entry: Entry) => (editSpatial(entry).cone ??= { inner: 360, outer: 360, outerGain: 0 });

  let emitter: { marker: THREE.Mesh; audio: THREE.PositionalAudio; helper: PositionalAudioHelper } | null = null;

  function placeEmitter() {
    removeEmitter();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const marker = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.6, 1),
      new THREE.MeshBasicMaterial({ color: 0xff5fd2, wireframe: true, fog: false }),
    );
    marker.position.copy(camera.position).addScaledVector(forward, EMITTER_DISTANCE);
    marker.position.y = 4;
    marker.lookAt(camera.position.x, 4, camera.position.z); // cone faces the viewer
    scene.add(marker);

    const spatial = spatialOf(selected);
    const audio = engine.positional({ ...selected.def, spatial, loop: true }, marker);
    const helper = new PositionalAudioHelper(audio, spatial.refDistance);
    audio.add(helper);
    emitter = { marker, audio, helper };
  }

  function removeEmitter() {
    if (!emitter) return;
    engine.release(emitter.audio);
    emitter.helper.dispose();
    emitter.marker.removeFromParent();
    emitter.marker.geometry.dispose();
    (emitter.marker.material as THREE.Material).dispose();
    emitter = null;
  }

  /** Push the selected entry's spatial settings to the live emitter. */
  function updateEmitter() {
    if (!emitter) return;
    const spatial = spatialOf(selected);
    applySpatial(emitter.audio.panner, spatial);
    emitter.audio.setVolume(selected.def.volume ?? 1);
    emitter.helper.range = spatial.refDistance;
    emitter.helper.update();
  }

  q("[data-sl=place]").addEventListener("click", placeEmitter);
  q("[data-sl=remove]").addEventListener("click", removeEmitter);

  const spatialSliders: (() => void)[] = [];
  const bindSpatial = (name: string, get: () => number, set: (v: number) => void) =>
    spatialSliders.push(
      slider(q(`[data-sp=${name}]`), get, (v) => {
        set(v);
        updateEmitter();
      }),
    );
  bindSpatial("volume", () => selected.def.volume ?? 1, (v) => (selected.def.volume = v));
  bindSpatial("refDistance", () => spatialOf(selected).refDistance, (v) => (editSpatial(selected).refDistance = v));
  bindSpatial("maxDistance", () => spatialOf(selected).maxDistance, (v) => (editSpatial(selected).maxDistance = v));
  bindSpatial("rolloff", () => spatialOf(selected).rolloff, (v) => (editSpatial(selected).rolloff = v));
  bindSpatial("inner", () => selected.def.spatial?.cone?.inner ?? 360, (v) => (coneOf(selected).inner = v));
  bindSpatial("outer", () => selected.def.spatial?.cone?.outer ?? 360, (v) => (coneOf(selected).outer = v));
  bindSpatial("outerGain", () => selected.def.spatial?.cone?.outerGain ?? 0, (v) => (coneOf(selected).outerGain = v));

  function select(entry: Entry) {
    selected = entry;
    el.selected.textContent = entry.key;
    for (const sync of spatialSliders) sync();
    renderList();
    if (emitter) placeEmitter(); // swap the emitter's sound in place
  }

  q("[data-sl=copy]").addEventListener("click", async () => {
    const text = entrySource(selected.key, selected.def);
    try {
      await navigator.clipboard.writeText(text);
      el.copied.textContent = "copied";
    } catch {
      el.copied.textContent = "see console";
    }
    console.log(text);
    setTimeout(() => (el.copied.textContent = ""), 1500);
  });

  // ---------------------------------------------------- gate emitter helpers

  let gateHelpers: PositionalAudioHelper[] = [];
  el.helpers.addEventListener("change", () => {
    for (const h of gateHelpers) {
      h.removeFromParent();
      h.dispose();
    }
    gateHelpers = [];
    if (!el.helpers.checked) return;
    for (const audio of worldAudio.emitters()) {
      const helper = new PositionalAudioHelper(audio, audio.getRefDistance());
      audio.add(helper);
      gateHelpers.push(helper);
    }
  });

  // ---------------------------------------------------------------- status

  const tick = () => {
    const s = engine.stats();
    const lock = s.state === "running" ? "" : " · press any key";
    el.status.textContent = `${s.state}${lock} · ${s.loaded} loaded${s.failed ? ` · ${s.failed} missing` : ""} · ${s.voices + s.positional} voices`;
  };
  let timer = 0;
  let isOpen = false;

  function setOpen(open: boolean) {
    isOpen = open;
    root.hidden = !open;
    clearInterval(timer);
    if (open) {
      el.mute.checked = engine.muted();
      el.ambience.value = engine.ambience() ?? "";
      tick();
      timer = window.setInterval(tick, 250);
    }
  }
  const toggle = () => setOpen(!isOpen);
  q("[data-sl=close]").addEventListener("click", () => setOpen(false));

  select(selected);
  void loadUnregistered();

  function dispose() {
    clearInterval(timer);
    removeEmitter();
    for (const entry of entries) entry.loop?.stop();
    for (const h of gateHelpers) {
      h.removeFromParent();
      h.dispose();
    }
    root.remove();
  }

  /** Call when mute changes elsewhere (M key) so the checkbox stays in sync. */
  const refresh = () => (el.mute.checked = engine.muted());

  return { toggle, setOpen, refresh, dispose };
}
