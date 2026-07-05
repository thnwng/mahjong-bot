// Chi (sequence) building logic for the Riichi tile picker. A chi is three
// consecutive ranks in ONE suit: {n, n+1, n+2}, n in 1..7. Given the ranks
// picked so far (0-2 of them, all one suit), decide which ranks may be picked
// next (grey out the rest) and which — when only one sequence is still possible
// — should be auto-filled to complete it. Pure + exhaustively unit-tested.

const CHIS: number[][] = Array.from({ length: 7 }, (_, i) => [i + 1, i + 2, i + 3]);

export interface ChiStep {
  candidates: number[]; // ranks (1-9) that may be picked next
  autofill: number[];   // ranks to add immediately (the rest of the only chi left)
  complete: boolean;    // three ranks are now fixed (a full chi)
}

/**
 * @param selected ranks (1-9) already chosen for the chi being built, one suit.
 * Rules (from the spec):
 *  - Pick 1 -> only 1-2-3 is possible, so 2 and 3 auto-fill.
 *  - Pick 2 -> 1-2-3 or 2-3-4 possible; pickable = {1,3,4}.
 *  - Then pick 1 -> only 1-2-3 left, so 3 auto-fills.
 *  - Pick x then x+-2 -> the middle x+-1 auto-fills (only one sequence spans them).
 */
export function chiStep(selected: number[]): ChiStep {
  const sel = [...new Set(selected)].sort((a, b) => a - b);
  if (sel.length >= 3) return { candidates: [], autofill: [], complete: true };
  const valid = CHIS.filter((c) => sel.every((r) => c.includes(r)));
  if (valid.length === 1) {
    return { candidates: [], autofill: valid[0].filter((r) => !sel.includes(r)), complete: true };
  }
  const union = [...new Set(valid.flat())].sort((a, b) => a - b);
  return { candidates: union.filter((r) => !sel.includes(r)), autofill: [], complete: false };
}
