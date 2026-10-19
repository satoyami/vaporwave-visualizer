import { expect, test } from "bun:test";
import { crossedPlane, GATE_HEIGHT, insideGate, nearestOpenGate } from "./gates.ts";

test("insideGate: points inside the triangle", () => {
  expect(insideGate(0, 2.2)).toBe(true); // eye height, dead center
  expect(insideGate(0, GATE_HEIGHT - 1)).toBe(true); // near the apex
  expect(insideGate(15, 2)).toBe(true); // near a bottom corner
});

test("insideGate: points outside the triangle", () => {
  expect(insideGate(20, 2)).toBe(false); // past the side
  expect(insideGate(0, GATE_HEIGHT + 1)).toBe(false); // above the apex
  expect(insideGate(0, -1)).toBe(false); // below the floor
  expect(insideGate(15, 30)).toBe(false); // beside the slanted edge
});

test("crossedPlane: sign flips count as crossings", () => {
  expect(crossedPlane(1, -1)).toBe(true);
  expect(crossedPlane(-0.5, 0.2)).toBe(true);
});

test("crossedPlane: same side or unknown history is not a crossing", () => {
  expect(crossedPlane(1, 0.5)).toBe(false);
  expect(crossedPlane(-3, -1)).toBe(false);
  expect(crossedPlane(NaN, -1)).toBe(false);
  expect(crossedPlane(0, -1)).toBe(false);
});

test("nearestOpenGate: picks the first gate when nothing is scored", () => {
  const gate = nearestOpenGate(0, 0, () => false);
  expect(gate?.cell).toBe("0,0");
  expect(gate?.distance).toBeCloseTo(160);
});

test("nearestOpenGate: skips scored gates", () => {
  const passed = new Set(["0,0"]);
  const gate = nearestOpenGate(0, -200, (cell) => passed.has(cell));
  expect(gate).not.toBeNull();
  expect(gate!.cell).not.toBe("0,0");
  expect(gate!.distance).toBeGreaterThan(2000); // the next lattice gate, not the one just passed
});

test("nearestOpenGate: null when every nearby gate is scored", () => {
  expect(nearestOpenGate(0, 0, () => true)).toBeNull();
});
