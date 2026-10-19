/**
 * Gate score: +1 the first time you fly through each gate. Gates are
 * identified by their lattice cell, so looping back through one doesn't count.
 * Resets on every page load.
 */
export function createScore() {
  const passed = new Set<string>();

  /** Record a fly-through; returns true if it scored (first pass through this gate). */
  function pass(gateId: string) {
    if (passed.has(gateId)) return false;
    passed.add(gateId);
    return true;
  }

  /** True if this gate has already scored. */
  const has = (gateId: string) => passed.has(gateId);

  /** Back to 0 for a new round; every gate can score again. */
  const reset = () => passed.clear();

  return { pass, has, reset, value: () => passed.size };
}

export type Score = ReturnType<typeof createScore>;
