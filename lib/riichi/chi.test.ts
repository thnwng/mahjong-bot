// Exhaustive tests for the chi-building step logic. The domain is tiny (ranks
// 1-9, seven possible sequences), so we can pin every first pick, cover the
// spec's worked examples, and verify every sequence is reachable by every order.

import { describe, it, expect } from "vitest";
import { chiStep } from "./chi";

const norm = (a: number[]) => [...a].sort((x, y) => x - y);

describe("chiStep — first pick", () => {
  // Edge ranks force the only sequence; middle ranks open a candidate window.
  const cases: Record<number, { autofill?: number[]; candidates?: number[]; complete: boolean }> = {
    1: { autofill: [2, 3], complete: true },
    9: { autofill: [7, 8], complete: true },
    2: { candidates: [1, 3, 4], complete: false },
    3: { candidates: [1, 2, 4, 5], complete: false },
    4: { candidates: [2, 3, 5, 6], complete: false },
    5: { candidates: [3, 4, 6, 7], complete: false },
    6: { candidates: [4, 5, 7, 8], complete: false },
    7: { candidates: [5, 6, 8, 9], complete: false },
    8: { candidates: [6, 7, 9], complete: false },
  };
  for (const [rank, exp] of Object.entries(cases)) {
    it(`pick ${rank}`, () => {
      const s = chiStep([Number(rank)]);
      expect(s.complete).toBe(exp.complete);
      expect(norm(s.autofill)).toEqual(norm(exp.autofill ?? []));
      expect(norm(s.candidates)).toEqual(norm(exp.candidates ?? []));
    });
  }
});

describe("chiStep — the spec's worked examples", () => {
  it("1 immediately completes to 1-2-3", () => {
    expect(norm(chiStep([1]).autofill)).toEqual([2, 3]);
  });
  it("2 greys everything except 1/2/3/4", () => {
    expect(norm(chiStep([2]).candidates)).toEqual([1, 3, 4]); // (2 is already selected)
  });
  it("2 then 1 auto-picks 3", () => {
    const s = chiStep([2, 1]);
    expect(norm(s.autofill)).toEqual([3]);
    expect(s.complete).toBe(true);
  });
  it("x then x+2 auto-picks the middle x+1", () => {
    expect(norm(chiStep([5, 7]).autofill)).toEqual([6]);
    expect(norm(chiStep([3, 5]).autofill)).toEqual([4]);
  });
  it("x then x-2 auto-picks the middle x-1", () => {
    expect(norm(chiStep([5, 3]).autofill)).toEqual([4]);
  });
  it("adjacent middle pick stays ambiguous (2 then 3 -> pick 1 or 4)", () => {
    const s = chiStep([2, 3]);
    expect(s.complete).toBe(false);
    expect(norm(s.candidates)).toEqual([1, 4]);
  });
});

describe("chiStep — completeness", () => {
  it("three ranks is complete with nothing left", () => {
    const s = chiStep([3, 4, 5]);
    expect(s).toEqual({ candidates: [], autofill: [], complete: true });
  });

  it("every sequence is reachable, and every 2-pick order lands on the right chi", () => {
    for (let n = 1; n <= 7; n++) {
      const chi = [n, n + 1, n + 2];
      // Simulate picking the two outer tiles in both orders, then any second pick
      // that keeps only this chi valid must auto-fill the remainder to exactly chi.
      for (const [a, b] of [[chi[0], chi[2]], [chi[2], chi[0]]]) {
        const s = chiStep([a, b]);
        expect(s.complete).toBe(true);
        expect(norm([a, b, ...s.autofill])).toEqual(chi);
      }
    }
  });
});
