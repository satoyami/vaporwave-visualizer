/** Length of a round, in seconds. */
export const ROUND_SECONDS = 180;

export type RoundPhase = "ready" | "running" | "over";

/**
 * A timed round: waits in "ready" until start(), counts down while
 * "running", then stays "over" until reset().
 */
export function createRound(duration = ROUND_SECONDS) {
  let phase: RoundPhase = "ready";
  let left = duration;

  /** Begin the countdown (only from "ready"). */
  function start() {
    if (phase === "ready") phase = "running";
  }

  /** Advance the clock; returns true on the frame time runs out. */
  function update(dt: number) {
    if (phase !== "running") return false;
    left = Math.max(left - dt, 0);
    if (left > 0) return false;
    phase = "over";
    return true;
  }

  /** Back to a full clock, waiting for start(). */
  function reset() {
    phase = "ready";
    left = duration;
  }

  return {
    start,
    update,
    reset,
    phase: () => phase,
    /** Seconds left, unrounded. */
    timeLeft: () => left,
    /** Whole seconds shown on the clock: counts 180 … 1, then 0 when over. */
    secondsShown: () => Math.ceil(left),
    duration,
  };
}

export type Round = ReturnType<typeof createRound>;

/** Seconds as M:SS. */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
