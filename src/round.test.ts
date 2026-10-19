import { expect, test } from "bun:test";
import { createRound, formatClock, ROUND_SECONDS } from "./round.ts";

test("starts ready at 3:00 and doesn't tick until started", () => {
  const round = createRound();
  expect(ROUND_SECONDS).toBe(180);
  expect(round.phase()).toBe("ready");
  round.update(5);
  expect(round.secondsShown()).toBe(180);
  expect(formatClock(round.secondsShown())).toBe("3:00");
});

test("counts down in whole seconds once started", () => {
  const round = createRound();
  round.start();
  round.update(0.5);
  expect(formatClock(round.secondsShown())).toBe("3:00"); // still in the first second
  round.update(0.6);
  expect(formatClock(round.secondsShown())).toBe("2:59");
  round.update(118.9);
  expect(formatClock(round.secondsShown())).toBe("1:00");
});

test("ends exactly once at 0:00 and stops", () => {
  const round = createRound(2);
  round.start();
  expect(round.update(1.5)).toBe(false);
  expect(round.update(1)).toBe(true);
  expect(round.phase()).toBe("over");
  expect(round.secondsShown()).toBe(0);
  expect(round.update(1)).toBe(false);
  round.start(); // can't restart without reset
  expect(round.phase()).toBe("over");
});

test("reset returns to a full clock", () => {
  const round = createRound(10);
  round.start();
  round.update(20);
  round.reset();
  expect(round.phase()).toBe("ready");
  expect(round.secondsShown()).toBe(10);
});

test("formatClock pads seconds", () => {
  expect(formatClock(65)).toBe("1:05");
  expect(formatClock(9)).toBe("0:09");
  expect(formatClock(0)).toBe("0:00");
});
