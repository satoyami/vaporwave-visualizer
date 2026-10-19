import * as THREE from "three";

// Colors are written straight into the shaders as sRGB values and the renderer
// does no tone mapping, so what you see is exactly the palette written here.

const SKY_RADIUS = 1000;

/** Indigo sky dome with a thin neon grid and a glowing horizon. Follows the camera. */
export function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      // Camera heading on the ground plane (x, z). Set every frame.
      uForward: { value: new THREE.Vector2(0, -1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uForward;
      varying vec3 vDir;

      void main() {
        float h = vDir.y;
        // Height on an imaginary upright backdrop in front of the camera.
        // Constant values of s are straight horizontal lines on screen, which
        // is how the sky's scanlines should look (constant h would curve).
        float s = h / max(dot(vDir.xz, uForward), 0.05);

        float t = clamp(s / 0.6, 0.0, 1.0); // 0 at the horizon, 1 at the top of the view

        // Background: deep indigo, a little brighter near the horizon.
        vec3 col = mix(vec3(0.14, 0.03, 0.30), vec3(0.07, 0.01, 0.17), smoothstep(0.0, 0.6, t));

        // Grid cells. Columns follow world direction (they slide past as you turn);
        // rows use the same spacing so the cells stay roughly square.
        const float PI = 3.14159265;
        const float COLUMNS = 120.0;
        vec2 cell = vec2(atan(vDir.z, vDir.x) / (2.0 * PI) * COLUMNS, s * COLUMNS / (2.0 * PI));
        // atan wraps at -PI/PI, which spikes fwidth along one column. Measure the
        // derivative with a second angle that wraps on the opposite side and keep the smaller.
        float colAlt = atan(-vDir.z, -vDir.x) / (2.0 * PI) * COLUMNS;
        vec2 fw = max(vec2(min(fwidth(cell.x), fwidth(colAlt)), fwidth(cell.y)), vec2(1e-4));

        // Distance to the nearest line, in pixels.
        vec2 px = abs(fract(cell - 0.5) - 0.5) / fw;
        float d = min(px.x, px.y);
        float lineCore = 1.0 - clamp(d, 0.0, 1.0);        // about 1px wide
        float lineGlow = exp(-d * 1.3) * 0.15;            // faint neon bloom

        // Faint half-step sub-grid of dim inner lines.
        vec2 subPx = abs(fract(cell * 2.0 - 0.5) - 0.5) / (fw * 2.0);
        float sub = (1.0 - clamp(min(subPx.x, subPx.y) - 0.25, 0.0, 1.0)) * 0.12;

        // Line color shifts with height: hot pink at the horizon, purple, a dim
        // violet band, then pink again and cyan at the top.
        vec3 pink   = vec3(1.0, 0.30, 0.80);
        vec3 purple = vec3(0.62, 0.32, 0.95);
        vec3 dim    = vec3(0.36, 0.12, 0.62);
        vec3 cyan   = vec3(0.25, 0.85, 1.0);
        vec3 lineCol = mix(pink, purple, smoothstep(0.0, 0.25, t));
        lineCol = mix(lineCol, dim, smoothstep(0.2, 0.45, t));
        lineCol = mix(lineCol, pink, smoothstep(0.5, 0.75, t));
        lineCol = mix(lineCol, cyan, smoothstep(0.75, 1.0, t));

        // Fade lines out where they would get denser than a few pixels (moire).
        float density = max(fw.x, fw.y);
        float visible = 1.0 - smoothstep(0.25, 0.6, density);
        // Let the horizon glow take over right at the horizon.
        visible *= smoothstep(0.0, 0.015, s);

        col += lineCol * (lineCore * 0.75 + lineGlow + sub) * visible;

        // Horizon glow: thin bright core plus a wide soft halo.
        float core = exp(-abs(s) * 260.0);
        float halo = exp(-abs(s) * 25.0);
        col += vec3(0.80, 0.30, 1.0) * core * 1.2 + vec3(0.55, 0.08, 0.90) * halo * 0.45;

        // Below the horizon (only visible past the ground edge).
        if (s < 0.0) {
          vec3 under = vec3(0.05, 0.40, 0.52);
          col = mix(under, col, exp(s * 80.0));
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 64, 48), material);
  mesh.renderOrder = -2;
  mesh.frustumCulled = false;
  return { mesh, material };
}

/** Twinkling stars scattered across the upper sky. Follows the camera. */
export function createStars(count = 1400) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const r = SKY_RADIUS * 0.95;

  for (let i = 0; i < count; i++) {
    // Uniform direction on the upper hemisphere, kept a little above the horizon.
    const y = 0.04 + Math.random() * 0.96;
    const theta = Math.random() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    positions.set([Math.cos(theta) * ring * r, y * r, Math.sin(theta) * ring * r], i * 3);
    // Mostly tiny stars, a few bright ones.
    sizes[i] = Math.random() < 0.06 ? 3.5 + Math.random() * 2.5 : 1.2 + Math.random() * 1.6;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aPhase;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * (1.5 + fract(aPhase) * 2.0) + aPhase);
        gl_PointSize = aSize * uPixelRatio * (0.8 + 0.4 * vTwinkle);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.92, 1.0) * a * vTwinkle, a);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = -1;
  points.frustumCulled = false;
  return { points, material };
}

const GROUND_SIZE = 1800;

/** Endless neon grid floor. The plane follows the camera; lines are computed in world space. */
export function createGround() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCell: { value: 4.0 },
      uCamPos: { value: new THREE.Vector3() },
      uFadeDistance: { value: GROUND_SIZE * 0.45 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uCell;
      uniform vec3 uCamPos;
      uniform float uFadeDistance;
      varying vec3 vWorld;

      void main() {
        vec2 coord = vWorld.xz / uCell;
        vec2 fw = fwidth(coord);
        vec2 g = abs(fract(coord - 0.5) - 0.5) / max(fw, vec2(1e-4));
        float line = 1.0 - clamp(min(g.x, g.y) - 0.6, 0.0, 1.0);

        float dist = length(vWorld.xz - uCamPos.xz);
        float far = clamp(dist / uFadeDistance, 0.0, 1.0);
        float haze = 1.0 - exp(-dist / 90.0);

        // Lines get thinner than a pixel in the distance: fade them out to avoid moire.
        float density = max(fw.x, fw.y);
        line *= 1.0 - smoothstep(0.6, 1.2, density);

        // Base: deep blue-black close up, teal toward the horizon.
        vec3 nearBase = vec3(0.01, 0.09, 0.12);
        vec3 farBase  = vec3(0.06, 0.45, 0.58);
        vec3 base = mix(nearBase, farBase, haze);

        vec3 lineCol = vec3(0.18, 0.80, 1.0);
        float lineStrength = mix(0.9, 0.35, haze);
        vec3 col = mix(base, lineCol, line * lineStrength);

        // Soft violet haze where the floor meets the sky glow.
        vec3 horizon = vec3(0.35, 0.30, 0.85);
        col = mix(col, horizon, smoothstep(0.6, 1.0, far) * 0.5);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}
