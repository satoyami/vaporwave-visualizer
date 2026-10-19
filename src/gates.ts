import * as THREE from "three";

/** Where the nearest unscored gate is, relative to the viewer. */
export interface GateNav {
  /** Ground distance to the gate, in units. */
  distance: number;
  /** Compass bearing to the gate in degrees (0 = north, 90 = east). */
  bearing: number;
}

/** Distance between gates, in world units. */
export const GATE_SPACING = 4000;
/** Gates fade out over this range so they don't pop in at the horizon. */
const FADE_START = 1500;
const FADE_END = 5200;
/** Max random offset from each lattice point, so the layout looks scattered. */
const JITTER = GATE_SPACING * 0.1;
/** The first gate sits just ahead of the start so it's in view right away. */
const FIRST_GATE = new THREE.Vector3(0, 0, -160);

// Gate size, in world units (the camera flies at about 2.2 units high).
const WIDTH = 36;
const HEIGHT = 42;
/** Gate height, in world units. */
export const GATE_HEIGHT = HEIGHT;
const BAR = 2.4; // thickness of the metal frame
const DEPTH = 1.8;
const TUBE_RADIUS = 0.45;

const NEON = 0x5fc8ff;
const NEON_CORE = 0xc4efff;

/**
 * Soft glow around the tube: brightest where the surface faces the viewer and
 * fading to nothing at the silhouette, so it reads as light, not a solid band.
 */
function haloMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(NEON) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        gl_FragColor = vec4(uColor, pow(facing, 3.0) * 0.75 * uOpacity);
      }
    `,
  });
}

// Sky beam rising from the top of each gate.
const BEAM_HEIGHT = 2600;
const BEAM_WIDTH = 12; // full width up close, in units
const BEAM_MIN_PIXEL_ANGLE = 0.004; // radians: keeps far beams several pixels wide
export const PULSE_PERIOD = 1.5; // seconds between pulses

/**
 * A vertical light beam drawn on a quad that turns to face the camera around
 * the vertical axis. Brightness flashes every PULSE_PERIOD seconds and a band
 * of light travels up the beam with each pulse.
 */
function beamMaterial(time: { value: number }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: time, // shared by every beam so they pulse together
      uOpacity: { value: 1 },
      uHeight: { value: BEAM_HEIGHT },
      uWidth: { value: BEAM_WIDTH },
      uMinAngle: { value: BEAM_MIN_PIXEL_ANGLE },
    },
    vertexShader: /* glsl */ `
      uniform float uHeight;
      uniform float uWidth;
      uniform float uMinAngle;
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - base;
        toCam.y = 0.0;
        float dist = max(length(toCam), 1.0);
        vDist = dist;
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam / dist));
        float width = max(uWidth, dist * uMinAngle * 2.0);
        vec3 world = base + right * (uv.x - 0.5) * width + vec3(0.0, uv.y * uHeight, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uHeight;
      varying vec2 vUv;
      varying float vDist;

      void main() {
        float x = (vUv.x - 0.5) * 2.0;   // -1..1 across the beam
        float y = vUv.y;                  // 0 at the gate, 1 at the top
        float yWorld = y * uHeight;

        // Bright thin core inside a wider soft glow.
        float core = exp(-x * x * 30.0);
        float glow = exp(-x * x * 4.0) * 0.55;

        // Pulse: quick flash that decays before the next one...
        float phase = fract(uTime / ${PULSE_PERIOD.toFixed(2)});
        float flash = exp(-phase * 5.0);
        // ...plus a band of light shooting up the beam.
        float bandY = phase * uHeight * 0.7;
        float band = exp(-pow((yWorld - bandY) / 60.0, 2.0)) * (1.0 - phase);

        float intensity = 0.35 + 1.1 * flash + 1.0 * band;
        // Fade toward the top, plus a bright spot where it leaves the gate.
        float fade = pow(1.0 - y, 1.6);
        float source = exp(-yWorld / 6.0) * 1.5;

        vec3 coreColor = vec3(0.55, 0.85, 1.0);
        vec3 glowColor = vec3(0.10, 0.45, 1.0);
        vec3 color = coreColor * core + glowColor * glow;
        // Scale the color itself (not just alpha) so the flash can rise well above the resting glow.
        // Far beams are only a few pixels wide, so brighten them to work as beacons.
        float beacon = mix(1.0, 2.6, smoothstep(600.0, 3000.0, vDist));
        float strength = (intensity * fade + source) * uOpacity * beacon;
        gl_FragColor = vec4(color * strength, 1.0);
      }
    `,
  });
}

/** Points of a triangle shrunk toward its incenter by `inset` units. */
function insetTriangle(width: number, height: number, inset: number) {
  const a = new THREE.Vector2(-width / 2, 0);
  const b = new THREE.Vector2(width / 2, 0);
  const c = new THREE.Vector2(0, height);
  const la = b.distanceTo(c);
  const lb = a.distanceTo(c);
  const lc = a.distanceTo(b);
  const perimeter = la + lb + lc;
  const incenter = new THREE.Vector2(
    (la * a.x + lb * b.x + lc * c.x) / perimeter,
    (la * a.y + lb * b.y + lc * c.y) / perimeter,
  );
  // Inradius = area / semi-perimeter.
  const inradius = (width * height) / perimeter;
  const scale = 1 - inset / inradius;
  return [a, b, c].map((p) => p.clone().sub(incenter).multiplyScalar(scale).add(incenter));
}

/** Corners of the gate's outer triangle, in gate-local space (base on the floor, facing ±Z). */
const OUTER = insetTriangle(WIDTH, HEIGHT, 0);

/** True when a gate-local point (x, y) lies inside the gate's triangle. */
export function insideGate(x: number, y: number) {
  const [a, b, c] = OUTER as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
  const side = (p: THREE.Vector2, q: THREE.Vector2) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
  const d1 = side(a, b);
  const d2 = side(b, c);
  const d3 = side(c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** True when the viewer moved from one side of the gate plane to the other (z is gate-local). */
export function crossedPlane(prevZ: number, z: number) {
  return Number.isFinite(prevZ) && prevZ !== 0 && (prevZ > 0) !== (z > 0);
}

/** Only gates this close (in units) are checked for a fly-through. */
const CROSS_CHECK_RANGE = 200;

/** A triangular ring: outer triangle with an inset triangular hole, extruded. */
function frameGeometry(width: number, height: number, bar: number, depth: number) {
  const outer = insetTriangle(width, height, 0);
  const inner = insetTriangle(width, height, bar);
  const shape = new THREE.Shape(outer);
  shape.holes.push(new THREE.Path([...inner].reverse()));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Closed path around a triangle with rounded corners, for the neon tube. */
function roundedTrianglePath(points: THREE.Vector2[], cornerCut: number) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const v = points.map((p) => new THREE.Vector3(p.x, p.y, 0));
  const n = v.length;
  const cut = (i: number, toward: number) =>
    v[i]!.clone().add(v[toward]!.clone().sub(v[i]!).setLength(cornerCut));

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const after = (i + 2) % n;
    const start = cut(i, next); // leaving corner i
    const end = cut(next, i); // arriving at corner i+1
    path.add(new THREE.LineCurve3(start, end));
    path.add(new THREE.QuadraticBezierCurve3(end, v[next]!.clone(), cut(next, after)));
  }
  return path;
}

/** Soft elongated glow used for the light pooling on the floor. */
function floorGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(128, 32);
  ctx.scale(4, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-32, -32, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Small deterministic hash so every lattice cell always gets the same gate. */
function hash(i: number, j: number, salt: number) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ground position (x, z) of the gate in lattice cell (i, j). */
function gateXZ(i: number, j: number): [number, number] {
  if (i === 0 && j === 0) return [FIRST_GATE.x, FIRST_GATE.z];
  return [i * GATE_SPACING + (hash(i, j, 1) * 2 - 1) * JITTER, j * GATE_SPACING + (hash(i, j, 2) * 2 - 1) * JITTER];
}

function gatePlacement(i: number, j: number) {
  const [x, z] = gateXZ(i, j);
  const yaw = i === 0 && j === 0 ? 0 : hash(i, j, 3) * Math.PI * 2;
  return { position: new THREE.Vector3(x, 0, z), yaw };
}

/** Cells searched around the viewer for an unscored gate: (2 * radius + 1)² gates. */
const NAV_SEARCH_RADIUS = 3;

/**
 * Closest gate to ground point (x, z) that `isPassed` doesn't exclude, searching
 * the lattice cells around it. Gates are identified by cell id ("i,j").
 */
export function nearestOpenGate(x: number, z: number, isPassed: (cell: string) => boolean) {
  const ci = Math.round(x / GATE_SPACING);
  const cj = Math.round(z / GATE_SPACING);
  let best: { cell: string; x: number; z: number; distance: number } | null = null;
  for (let i = ci - NAV_SEARCH_RADIUS; i <= ci + NAV_SEARCH_RADIUS; i++) {
    for (let j = cj - NAV_SEARCH_RADIUS; j <= cj + NAV_SEARCH_RADIUS; j++) {
      const cell = `${i},${j}`;
      if (isPassed(cell)) continue;
      const [gx, gz] = gateXZ(i, j);
      const distance = Math.hypot(gx - x, gz - z);
      if (!best || distance < best.distance) best = { cell, x: gx, z: gz, distance };
    }
  }
  return best;
}

/**
 * Neon triangle gates on an endless lattice. Only the 3x3 cells around the
 * camera exist at any time; they're moved along as you travel.
 */
export type Gates = ReturnType<typeof createGates>;

export function createGates() {
  const group = new THREE.Group();

  // Shared geometry
  const frameGeo = frameGeometry(WIDTH, HEIGHT, BAR, DEPTH);
  // Thin secondary rails behind the main frame, like outer struts.
  const railGeo = frameGeometry(WIDTH * 1.14, HEIGHT * 1.07, 0.7, 0.7);
  const tubePath = roundedTrianglePath(insetTriangle(WIDTH, HEIGHT, BAR), 2.2);
  const tubeGeo = new THREE.TubeGeometry(tubePath, 360, TUBE_RADIUS, 10, true);
  const haloGeo = new THREE.TubeGeometry(tubePath, 360, TUBE_RADIUS * 4, 12, true);
  const bracketGeo = new THREE.BoxGeometry(7, 1.0, 2.6);
  const postGeo = new THREE.BoxGeometry(0.5, 2.2, 0.5);
  const footGeo = new THREE.BoxGeometry(5, 1.2, 4.5);
  const glowGeo = new THREE.PlaneGeometry(WIDTH + 30, 34).rotateX(-Math.PI / 2);
  const glowTexture = floorGlowTexture();

  // Shared materials (scene fog fades these into the horizon haze)
  const metal = new THREE.MeshStandardMaterial({
    color: 0x2c3a5e,
    metalness: 0.35,
    roughness: 0.45,
    emissive: 0x08122a,
  });
  const tubeMat = new THREE.MeshBasicMaterial({ color: NEON_CORE });
  const beamTime = { value: 0 };
  const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0); // uv matches position; shader places it

  type Gate = {
    object: THREE.Group;
    halo: ReturnType<typeof haloMaterial>;
    glow: THREE.MeshBasicMaterial;
    beam: ReturnType<typeof beamMaterial>;
    cell: string;
    /** Viewer's gate-local z last frame, NaN when unknown. */
    prevZ: number;
  };
  const gates: Gate[] = [];

  for (let k = 0; k < 9; k++) {
    const object = new THREE.Group();

    const frame = new THREE.Mesh(frameGeo, metal);
    const rails = new THREE.Mesh(railGeo, metal);
    rails.position.z = -DEPTH * 0.9;

    const tube = new THREE.Mesh(tubeGeo, tubeMat);

    // Additive glows fade by hand: fog would tint them instead of dimming them.
    const halo = haloMaterial();
    const haloMesh = new THREE.Mesh(haloGeo, halo);

    const bracket = new THREE.Mesh(bracketGeo, metal);
    bracket.position.y = HEIGHT + 0.9;
    const postL = new THREE.Mesh(postGeo, metal);
    postL.position.set(-2.4, HEIGHT + 2.2, 0);
    const postR = postL.clone();
    postR.position.x = 2.4;

    const footL = new THREE.Mesh(footGeo, metal);
    footL.position.set(-WIDTH / 2 + 1.5, 0.6, 0);
    const footR = footL.clone();
    footR.position.x = WIDTH / 2 - 1.5;

    const glow = new THREE.MeshBasicMaterial({
      color: NEON,
      map: glowTexture,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glow);
    glowMesh.position.y = 0.05;
    glowMesh.renderOrder = 1;

    const beam = beamMaterial(beamTime);
    const beamMesh = new THREE.Mesh(beamGeo, beam);
    beamMesh.position.y = HEIGHT + 1.4; // starts at the top bracket
    beamMesh.frustumCulled = false; // the shader moves the vertices, so bounds are meaningless
    beamMesh.renderOrder = 2;

    object.add(frame, rails, tube, haloMesh, bracket, postL, postR, footL, footR, glowMesh, beamMesh);
    group.add(object);
    gates.push({ object, halo, glow, beam, cell: "", prevZ: NaN });
  }

  // One light that follows the nearest gate, so its frame is lit by its own neon.
  const neonLight = new THREE.PointLight(NEON, 900, 90, 2);
  group.add(neonLight);

  const local = new THREE.Vector3();
  const nav: GateNav = { distance: 0, bearing: 0 };
  /** Cell id of the gate flown through during the last update(), or null. */
  let crossed: string | null = null;

  /**
   * `isPassed` says which gates are already scored; the HUD nav skips them.
   */
  function update(camera: THREE.Vector3, time: number, isPassed: (cell: string) => boolean = () => false) {
    beamTime.value = time;
    const ci = Math.round(camera.x / GATE_SPACING);
    const cj = Math.round(camera.z / GATE_SPACING);
    let nearest: Gate | undefined;
    let nearestDist = Infinity;
    crossed = null;

    let k = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const gate = gates[k++]!;
        const i = ci + di;
        const j = cj + dj;
        const cell = `${i},${j}`;
        if (gate.cell !== cell) {
          const { position, yaw } = gatePlacement(i, j);
          gate.object.position.copy(position);
          gate.object.rotation.y = yaw;
          gate.cell = cell;
          gate.prevZ = NaN;
        }

        const dist = gate.object.position.distanceTo(camera);
        const fade = 1 - THREE.MathUtils.smoothstep(dist, FADE_START, FADE_END);
        gate.object.visible = fade > 0.001;
        gate.halo.uniforms.uOpacity!.value = fade;
        gate.beam.uniforms.uOpacity!.value = fade;
        gate.glow.opacity = fade;

        if (dist < CROSS_CHECK_RANGE) {
          gate.object.updateMatrixWorld();
          gate.object.worldToLocal(local.copy(camera));
          if (crossedPlane(gate.prevZ, local.z) && insideGate(local.x, local.y)) crossed = gate.cell;
          gate.prevZ = local.z;
        } else {
          gate.prevZ = NaN;
        }

        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = gate;
        }
      }
    }

    // HUD nav: the closest gate not scored yet.
    const target = nearestOpenGate(camera.x, camera.z, isPassed);
    if (target) {
      const dx = target.x - camera.x;
      const dz = target.z - camera.z;
      nav.distance = target.distance;
      // North is -Z and east is +X, matching the HUD compass.
      nav.bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    }

    if (nearest) {
      nearest.object.updateMatrixWorld();
      // Sit the light on the viewer's side of the gate so the front face catches it.
      const side = Math.sign(nearest.object.worldToLocal(local.copy(camera)).z) || 1;
      neonLight.position.set(0, HEIGHT * 0.35, side * 8).applyMatrix4(nearest.object.matrixWorld);
    }
  }

  function dispose() {
    for (const geo of [frameGeo, railGeo, tubeGeo, haloGeo, bracketGeo, postGeo, footGeo, glowGeo, beamGeo]) geo.dispose();
    for (const gate of gates) {
      gate.halo.dispose();
      gate.beam.dispose();
      gate.glow.dispose();
    }
    metal.dispose();
    tubeMat.dispose();
    glowTexture.dispose();
  }

  /** Nearest unscored gate as of the last update(). */
  const nearestGate = (): GateNav => nav;

  /** True if the viewer flew through a gate during the last update(). */
  const crossedThisFrame = () => crossed !== null;
  /** Which gate was flown through during the last update(), as its lattice cell ("i,j"), or null. Unique per gate. */
  const crossedGate = () => crossed;

  /** The gate objects (they move to new lattice cells as you travel). */
  const slots = (): readonly THREE.Group[] => gates.map((g) => g.object);

  return { group, update, nearestGate, crossedThisFrame, crossedGate, slots, dispose };
}
