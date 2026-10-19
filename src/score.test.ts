import { expect, test } from "bun:test";
import { createScore } from "./score.ts";

test("starts at zero", () => {
  expect(createScore().value()).toBe(0);
});

test("each gate scores once", () => {
  const score = createScore();
  expect(score.pass("0,0")).toBe(true);
  expect(score.pass("0,0")).toBe(false); // flying back through the same gate
  expect(score.pass("1,0")).toBe(true);
  expect(score.pass("-1,2")).toBe(true);
  expect(score.value()).toBe(3);
});

test("has reports scored gates", () => {
  const score = createScore();
  score.pass("2,3");
  expect(score.has("2,3")).toBe(true);
  expect(score.has("0,0")).toBe(false);
});
