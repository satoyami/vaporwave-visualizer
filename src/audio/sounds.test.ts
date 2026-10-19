import { expect, test } from "bun:test";
import { AMBIENCES, BUSES, DEFAULT_AMBIENCE, SOUNDS, soundDef, type SoundDef } from "./sounds.ts";

const defs = Object.entries(SOUNDS) as [string, SoundDef][];

test("every sound has a unique .wav url under /sounds/", () => {
  const urls = defs.map(([, d]) => d.url);
  expect(new Set(urls).size).toBe(urls.length);
  for (const url of urls) expect(url).toMatch(/^\/sounds\/.+\.wav$/);
});

test("buses and volumes are valid", () => {
  for (const [, d] of defs) {
    expect(BUSES).toContain(d.bus);
    expect(d.volume ?? 1).toBeGreaterThanOrEqual(0);
  }
});

test("spatial settings are positive and ordered", () => {
  for (const [, d] of defs) {
    if (!d.spatial) continue;
    expect(d.spatial.refDistance).toBeGreaterThan(0);
    expect(d.spatial.maxDistance).toBeGreaterThan(d.spatial.refDistance);
    expect(d.spatial.rolloff).toBeGreaterThanOrEqual(0);
  }
});

test("ambience beds are looping, non-positional sounds", () => {
  expect(AMBIENCES).toContain(DEFAULT_AMBIENCE);
  for (const id of AMBIENCES) {
    expect(soundDef(id).loop).toBe(true);
    expect(soundDef(id).spatial).toBeUndefined();
  }
});
