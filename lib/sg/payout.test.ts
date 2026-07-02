// Unit tests for the Singaporean payout engine — the money math that settles
// real cash at the table. Reference values follow the sgmahjong.club 10¢/20¢
// table (shooter 0.40 / self-draw 0.20 each at 1 tai, doubling per tai; bite &
// kong a flat 0.10).

import { describe, it, expect } from "vitest";
import {
  PayoutConfig,
  DEFAULT_PAYOUT,
  discardValue,
  zimoEachValue,
  settleDiscardWin,
  settleSelfDraw,
  settleYao,
  settleGang,
  applyTransfers,
  Transfer,
} from "./payout";

const P4 = ["A", "B", "C", "D"];
const sum = (ts: Transfer[]) => ts.reduce((s, t) => s + t.amount, 0);
const zeroSum = (ts: Transfer[]) => {
  const b: Record<string, number> = {};
  applyTransfers(b, ts);
  return Object.values(b).reduce((s, v) => s + v, 0);
};

describe("discardValue / zimoEachValue (sgmahjong.club 10¢/20¢ defaults)", () => {
  it("matches the published 1-tai values", () => {
    expect(discardValue(DEFAULT_PAYOUT, 1)).toBeCloseTo(0.4, 10);
    expect(zimoEachValue(DEFAULT_PAYOUT, 1)).toBeCloseTo(0.2, 10);
  });

  it("doubles per tai", () => {
    expect(discardValue(DEFAULT_PAYOUT, 2)).toBeCloseTo(0.8, 10);
    expect(discardValue(DEFAULT_PAYOUT, 3)).toBeCloseTo(1.6, 10);
    expect(discardValue(DEFAULT_PAYOUT, 5)).toBeCloseTo(6.4, 10);
    expect(discardValue(DEFAULT_PAYOUT, 10)).toBeCloseTo(204.8, 10);
    expect(zimoEachValue(DEFAULT_PAYOUT, 5)).toBeCloseTo(3.2, 10);
    expect(zimoEachValue(DEFAULT_PAYOUT, 10)).toBeCloseTo(102.4, 10);
  });

  it("charges above max tai at the max-tai amount, and below 1 at the 1-tai amount", () => {
    expect(discardValue(DEFAULT_PAYOUT, 15)).toBeCloseTo(discardValue(DEFAULT_PAYOUT, 10), 10);
    expect(discardValue(DEFAULT_PAYOUT, 0)).toBeCloseTo(0.4, 10);
    expect(discardValue(DEFAULT_PAYOUT, -3)).toBeCloseTo(0.4, 10);
  });

  it("stops doubling at the cap when one is set", () => {
    const cfg: PayoutConfig = { tai: 0.4, zimo: 0.2, yao: 0.1, gang: 0.1, maxTai: 10, cap: 5 };
    expect(discardValue(cfg, 5)).toBeCloseTo(6.4, 10);
    expect(discardValue(cfg, 6)).toBeCloseTo(6.4, 10);
    expect(discardValue(cfg, 10)).toBeCloseTo(6.4, 10);
    expect(zimoEachValue(cfg, 10)).toBeCloseTo(3.2, 10);
  });

  it("falls back to 2x the shooter when no self-draw value is set (classic rule)", () => {
    const cfg: PayoutConfig = { tai: 0.5, yao: 0.1, gang: 0.1 };
    expect(zimoEachValue(cfg, 1)).toBeCloseTo(1.0, 10);
    expect(zimoEachValue(cfg, 3)).toBeCloseTo(4.0, 10);
  });

  it("uses an exact per-tai table entry when present, doubling for blank rows", () => {
    const cfg: PayoutConfig = {
      tai: 0.4, zimo: 0.2, yao: 0.1, gang: 0.1, maxTai: 3,
      discardTable: [null, 1.5, null],
      zimoTable: [0.25, null, null],
    };
    expect(discardValue(cfg, 1)).toBeCloseTo(0.4, 10);  // blank row -> doubling
    expect(discardValue(cfg, 2)).toBeCloseTo(1.5, 10);  // exact override
    expect(discardValue(cfg, 3)).toBeCloseTo(1.6, 10);  // blank row -> doubling
    expect(zimoEachValue(cfg, 1)).toBeCloseTo(0.25, 10);
    expect(zimoEachValue(cfg, 2)).toBeCloseTo(0.4, 10);
  });
});

describe("settlements", () => {
  it("hu (discard win): the shooter alone pays the winner", () => {
    const ts = settleDiscardWin("A", "B", 1.6);
    expect(ts).toEqual([{ payer: "B", payee: "A", amount: 1.6 }]);
    expect(zeroSum(ts)).toBeCloseTo(0, 10);
  });

  it("zimo (self-draw): every other player pays the winner", () => {
    const ts = settleSelfDraw("A", 0.8, P4);
    expect(ts).toHaveLength(3);
    expect(ts.every((t) => t.payee === "A" && t.payer !== "A")).toBe(true);
    expect(sum(ts)).toBeCloseTo(2.4, 10);
    expect(zeroSum(ts)).toBeCloseTo(0, 10);
  });

  it("yao (bite): everyone pays, or one chosen person pays", () => {
    expect(settleYao("B", 0.1, P4)).toHaveLength(3);
    expect(settleYao("B", 0.1, P4, "D")).toEqual([{ payer: "D", payee: "B", amount: 0.1 }]);
  });

  it("gang (kong): everyone pays, or the discarder alone pays", () => {
    expect(settleGang("C", 0.1, P4)).toHaveLength(3);
    expect(settleGang("C", 0.1, P4, "A")).toEqual([{ payer: "A", payee: "C", amount: 0.1 }]);
  });

  it("balances always reconcile to zero after any mix of actions", () => {
    const b: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    applyTransfers(b, settleDiscardWin("A", "B", discardValue(DEFAULT_PAYOUT, 3)));
    applyTransfers(b, settleSelfDraw("C", zimoEachValue(DEFAULT_PAYOUT, 2), P4));
    applyTransfers(b, settleYao("D", 0.1, P4));
    applyTransfers(b, settleGang("B", 0.1, P4, "A"));
    expect(Object.values(b).reduce((s, v) => s + v, 0)).toBeCloseTo(0, 10);
  });
});
