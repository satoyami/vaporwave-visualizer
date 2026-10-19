import { GEARS, MAX_SPEED, type MovementState } from "./movement.ts";
import type { GateNav } from "./gates.ts";

const PX_PER_DEGREE = 1.5;
// The tape covers one extra half turn on each side so it never runs out while scrolling.
const TAPE_START = -180;
const TAPE_END = 540;

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const TAPE_LABELS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };

const MARKUP = `
  <section class="hud-score" data-hud="scoreBox">
    <span class="hud-label">GATES</span>
    <span class="hud-score-value"><span class="hud-star">★</span><span data-hud="score">0</span></span>
  </section>
  <div class="hud-divider"></div>
  <section>
    <div class="hud-label">HEADING</div>
    <div class="hud-tape">
      <div class="hud-tape-strip"></div>
      <div class="hud-tape-marker"></div>
      <div class="hud-tape-gate" data-hud="tapeGate"></div>
    </div>
    <div class="hud-heading"><span data-hud="deg">000</span>°<span class="hud-cardinal" data-hud="card">N</span></div>
  </section>
  <div class="hud-divider"></div>
  <section>
    <div class="hud-row">
      <span class="hud-label">SPEED</span>
      <span class="hud-tag boost" data-hud="boost">BOOST</span>
      <span class="hud-tag rev" data-hud="rev">REV</span>
    </div>
    <div class="hud-value"><span data-hud="speed">0.0</span><small>u/s</small></div>
    <div class="hud-bar"><div class="hud-bar-fill" data-hud="bar"></div></div>
    <div class="hud-gearbox">
      <span class="hud-label">GEAR</span>
      <div class="hud-gears" data-hud="gears">
        ${Array.from({ length: GEARS }, (_, i) => `<span class="hud-gear">${i + 1}</span>`).join("")}
      </div>
    </div>
  </section>
  <section>
    <div class="hud-label">DISTANCE</div>
    <div class="hud-value"><span data-hud="dist">0.0</span><small>u</small></div>
  </section>
  <div class="hud-divider"></div>
  <section class="hud-nav" data-hud="nav">
    <div class="hud-label">NEAREST GATE</div>
    <div class="hud-nav-body">
      <div class="hud-nav-dial">
        <svg class="hud-nav-arrow" data-hud="navArrow" viewBox="0 0 40 40" width="40" height="40">
          <path d="M20 5 L29 27 L20 22 L11 27 Z" />
        </svg>
      </div>
      <div>
        <div class="hud-value"><span data-hud="navDist">0</span><small>u</small></div>
        <div class="hud-nav-dir" data-hud="navDir">AHEAD</div>
      </div>
    </div>
  </section>
`;

// Centered crosshair: four ticks around a gap, a center dot and a broken ring.
const CROSSHAIR = `
  <svg viewBox="-24 -24 48 48" width="62" height="62">
    <circle class="ring" r="17" />
    <path class="ticks" d="M0 -12 V-5 M0 5 V12 M-12 0 H-5 M5 0 H12" />
    <circle class="dot" r="1.4" />
  </svg>
`;

/**
 * Screen-space HUD: a top-right panel (gate score, heading tape, speedometer, gears,
 * odometer, nearest gate) and a crosshair in the middle of the screen.
 */
export function createHud(parent: HTMLElement = document.body) {
  const root = document.createElement("div");
  root.className = "hud";
  root.setAttribute("aria-hidden", "true"); // visual only; it changes every frame
  root.innerHTML = MARKUP;
  parent.appendChild(root);

  const crosshair = document.createElement("div");
  crosshair.className = "crosshair";
  crosshair.setAttribute("aria-hidden", "true");
  crosshair.innerHTML = CROSSHAIR;
  parent.appendChild(crosshair);

  const get = <T extends HTMLElement = HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-hud="${name}"]`)!;
  const el = {
    strip: root.querySelector<HTMLElement>(".hud-tape-strip")!,
    tape: root.querySelector<HTMLElement>(".hud-tape")!,
    deg: get("deg"),
    card: get("card"),
    speed: get("speed"),
    bar: get("bar"),
    boost: get("boost"),
    rev: get("rev"),
    dist: get("dist"),
    gears: [...get("gears").children] as HTMLElement[],
    tapeGate: get("tapeGate"),
    nav: get("nav"),
    navArrow: root.querySelector<SVGElement>("[data-hud=navArrow]")!,
    navDist: get("navDist"),
    navDir: get("navDir"),
    score: get("score"),
    scoreBox: get("scoreBox"),
  };
  let shownGear = 0;
  let shownScore = 0;

  // Build the tape ticks once: small every 15°, labelled every 45°.
  const ticks = document.createDocumentFragment();
  for (let deg = TAPE_START; deg <= TAPE_END; deg += 15) {
    const x = (deg - TAPE_START) * PX_PER_DEGREE;
    const wrapped = ((deg % 360) + 360) % 360;
    const label = TAPE_LABELS[wrapped];
    const tick = document.createElement("div");
    tick.className = label ? "hud-tick major" : "hud-tick";
    tick.style.left = `${x}px`;
    ticks.appendChild(tick);
    if (label) {
      const text = document.createElement("div");
      text.className = wrapped === 0 ? "hud-tick-label north" : "hud-tick-label";
      text.style.left = `${x}px`;
      text.textContent = label;
      ticks.appendChild(text);
    }
  }
  el.strip.appendChild(ticks);

  // Only touch the DOM when a value actually changes.
  const last = new Map<HTMLElement, string>();
  const setText = (node: HTMLElement, text: string) => {
    if (last.get(node) === text) return;
    last.set(node, text);
    node.textContent = text;
  };
  const distanceFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const gateFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

  function update(state: MovementState, gate: GateNav, score: number) {
    const { heading, speed, distance, boost, gear } = state;

    if (score !== shownScore) {
      const gained = score > shownScore;
      shownScore = score;
      setText(el.score, String(score));
      if (gained) {
        // Restart the flash animation.
        el.scoreBox.classList.remove("bump");
        void el.scoreBox.offsetWidth;
        el.scoreBox.classList.add("bump");
      }
    }

    const tapeCenter = el.tape.clientWidth / 2;
    const offset = tapeCenter - (heading - TAPE_START) * PX_PER_DEGREE;
    el.strip.style.transform = `translateX(${offset.toFixed(1)}px)`;
    setText(el.deg, String(Math.round(heading) % 360).padStart(3, "0"));
    setText(el.card, CARDINALS[Math.round(heading / 22.5) % 16]!);

    const absSpeed = Math.abs(speed);
    setText(el.speed, absSpeed < 0.05 ? "0.0" : absSpeed.toFixed(1));
    el.bar.style.transform = `scaleX(${Math.min(absSpeed / MAX_SPEED, 1).toFixed(3)})`;
    root.classList.toggle("boosting", boost);
    el.boost.classList.toggle("on", boost);
    el.rev.classList.toggle("on", speed < -0.5);

    setText(el.dist, distanceFormat.format(distance));

    if (gear !== shownGear) {
      shownGear = gear;
      el.gears.forEach((node, i) => {
        node.classList.toggle("lit", i < gear); // gears up to the current one
        node.classList.toggle("current", i === gear - 1);
      });
    }

    // Nearest gate: angle to turn, from -180 (left) to 180 (right); 0 is dead ahead.
    const relative = ((gate.bearing - heading + 540) % 360) - 180;
    el.navArrow.style.transform = `rotate(${relative.toFixed(1)}deg)`;
    setText(el.navDist, gateFormat.format(gate.distance));
    const turn = Math.round(Math.abs(relative));
    setText(el.navDir, turn < 2 ? "AHEAD" : turn > 178 ? "BEHIND" : `${turn}° ${relative > 0 ? "RIGHT" : "LEFT"}`);
    // On target when the crosshair is over the gate opening (about 18 units each side of center).
    const halfWidth = (Math.atan2(18, Math.max(gate.distance, 1)) * 180) / Math.PI;
    const onTarget = Math.abs(relative) < Math.max(halfWidth, 1);
    el.nav.classList.toggle("on-target", onTarget);
    crosshair.classList.toggle("on-target", onTarget);

    // Gate marker on the compass tape, placed on the copy of the bearing nearest the heading.
    el.tapeGate.style.left = `${(offset + (heading + relative - TAPE_START) * PX_PER_DEGREE).toFixed(1)}px`;
  }

  function dispose() {
    root.remove();
    crosshair.remove();
  }

  return { update, dispose };
}
