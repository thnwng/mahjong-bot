// Unit tests for buildResult — the record-action wizard's money output. These
// pin the exact transfers for the concealed (anyao/angang) and shoot paths added
// on top of the base payout engine, so a later refactor can't silently change who
// pays whom. Reference table: sgmahjong.club 10¢/20¢ (yao & kong base = 0.10).

import { describe, it, expect } from "vitest";
import { buildResult, shootValue } from "./actions";
import { DEFAULT_PAYOUT, PayoutConfig, Transfer, applyTransfers } from "./payout";

const P4 = ["A", "B", "C", "D"]; // 4-player SG (nOther = 3)
const P3 = ["A", "B", "C"];      // 3-player MY (nOther = 2)
const CFG: PayoutConfig = DEFAULT_PAYOUT; // tai 0.4 / zimo 0.2 / yao 0.1 / gang 0.1

const zeroSum = (ts: Transfer[]) => {
  const b: Record<string, number> = {};
  applyTransfers(b, ts);
  return Object.values(b).reduce((s, v) => s + v, 0);
};
const toA = (ts: Transfer[]) => ts.filter((t) => t.payee === "A");
const paidBy = (ts: Transfer[], payer: string) => ts.find((t) => t.payer === payer);

describe("hu (win off a discard) via the shoot selector", () => {
  it("B shoots A at 1 tai -> B pays A the shooter value", () => {
    const r = buildResult("hu", { shoot: shootValue("B", "A"), tai: "1" }, P4, CFG, true);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]).toMatchObject({ payer: "B", payee: "A" });
    expect(r.transfers[0].amount).toBeCloseTo(0.4, 10);
    expect(r.meta).toMatchObject({ k: "hu", winner: "A", discarder: "B", tai: 1 });
    expect(zeroSum(r.transfers)).toBeCloseTo(0, 10);
  });

  it("log-only session records the win but no transfers", () => {
    const r = buildResult("hu", { shoot: shootValue("C", "D") }, P4, CFG, false);
    expect(r.transfers).toHaveLength(0);
    expect(r.meta).toMatchObject({ k: "hu", winner: "D", discarder: "C" });
  });
});

describe("gang (kong) — three kinds", () => {
  it("self-draw / added kong: everyone pays the base each", () => {
    const r = buildResult("gang", { konger: "A", mode: "zimo" }, P4, CFG, true);
    expect(toA(r.transfers)).toHaveLength(3);
    for (const t of r.transfers) expect(t.amount).toBeCloseTo(0.1, 10);
    expect(r.meta).toMatchObject({ k: "gang", konger: "A", payer: null, mode: "zimo" });
    expect(zeroSum(r.transfers)).toBeCloseTo(0, 10);
  });

  it("off a discard (shoot): the one discarder alone pays 3x (pao) in a 4p game", () => {
    const r = buildResult("gang", { konger: "A", mode: "shoot", shoot: shootValue("B", "A") }, P4, CFG, true);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]).toMatchObject({ payer: "B", payee: "A" });
    expect(r.transfers[0].amount).toBeCloseTo(0.3, 10); // 3 * 0.10
    expect(r.meta).toMatchObject({ k: "gang", konger: "A", payer: "B", mode: "shoot" });
  });

  it("shoot generalises to (players-1)x — 2x in a 3p game", () => {
    const r = buildResult("gang", { konger: "A", mode: "shoot", shoot: shootValue("C", "A") }, P3, CFG, true);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0].amount).toBeCloseTo(0.2, 10); // 2 * 0.10
  });

  it("concealed (angang): everyone pays double each -> 6x total in a 4p game", () => {
    const r = buildResult("gang", { konger: "A", mode: "an" }, P4, CFG, true);
    expect(toA(r.transfers)).toHaveLength(3);
    for (const t of r.transfers) expect(t.amount).toBeCloseTo(0.2, 10); // 2 * 0.10
    expect(zeroSum(r.transfers)).toBeCloseTo(0, 10);
    expect(r.meta).toMatchObject({ k: "gang", konger: "A", payer: null, mode: "an" });
  });
});

describe("yao (bite) — open vs concealed, everyone vs one", () => {
  it("open bite, everyone: each other player pays the base", () => {
    const r = buildResult("yao", { biter: "A", conceal: "open", scope: "everyone" }, P4, CFG, true);
    expect(toA(r.transfers)).toHaveLength(3);
    for (const t of r.transfers) expect(t.amount).toBeCloseTo(0.1, 10);
    expect(r.meta).toMatchObject({ k: "yao", biter: "A", target: null, concealed: false });
  });

  it("concealed bite (anyao), everyone: each pays double", () => {
    const r = buildResult("yao", { biter: "A", conceal: "an", scope: "everyone" }, P4, CFG, true);
    for (const t of r.transfers) expect(t.amount).toBeCloseTo(0.2, 10);
    expect(r.meta).toMatchObject({ k: "yao", concealed: true, target: null });
  });

  it("open bite on one person: that one pays the base only (not 3x)", () => {
    const r = buildResult("yao", { biter: "A", conceal: "open", scope: "one", shoot: shootValue("B", "A") }, P4, CFG, true);
    expect(r.transfers).toHaveLength(1);
    expect(paidBy(r.transfers, "B")!.amount).toBeCloseTo(0.1, 10);
    expect(r.meta).toMatchObject({ k: "yao", biter: "A", target: "B", concealed: false });
  });

  it("concealed bite on one person: that one pays double", () => {
    const r = buildResult("yao", { biter: "A", conceal: "an", scope: "one", shoot: shootValue("C", "A") }, P4, CFG, true);
    expect(r.transfers).toHaveLength(1);
    expect(paidBy(r.transfers, "C")!.amount).toBeCloseTo(0.2, 10);
    expect(r.meta).toMatchObject({ target: "C", concealed: true });
  });
});

describe("zimo (self-draw) still stacks the self-draw bonus", () => {
  it("each other player pays zimo-each + bonus", () => {
    const cfg: PayoutConfig = { ...CFG, zimoBonus: 0.5 };
    const r = buildResult("zimo", { winner: "A", tai: "1" }, P4, cfg, true);
    expect(toA(r.transfers)).toHaveLength(3);
    for (const t of r.transfers) expect(t.amount).toBeCloseTo(0.2 + 0.5, 10);
  });
});
