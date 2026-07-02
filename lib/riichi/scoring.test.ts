// Unit tests for the Riichi scoring engine, against the standard published
// score table (han/fu -> points, dealer/non-dealer, ron/tsumo, honba, limits).

import { describe, it, expect } from "vitest";
import { score } from "./scoring";

const pay = (s: ReturnType<typeof score>, role: string) =>
  s.payments.find((p) => p.role === role);

describe("ron (win off a discard)", () => {
  it("non-dealer 3 han 30 fu = 3900 from the discarder", () => {
    const s = score(3, 30, { dealer: false, tsumo: false });
    expect(s.total).toBe(3900);
    expect(pay(s, "discarder")).toEqual({ role: "discarder", amount: 3900, count: 1 });
  });

  it("dealer 3 han 30 fu = 5800", () => {
    expect(score(3, 30, { dealer: true, tsumo: false }).total).toBe(5800);
  });

  it("non-dealer 4 han 30 fu = 7700 (no kiriage)", () => {
    expect(score(4, 30, { dealer: false, tsumo: false }).total).toBe(7700);
  });

  it("kiriage mangan rounds 4 han 30 fu up to 8000", () => {
    expect(score(4, 30, { dealer: false, tsumo: false, kiriage: true }).total).toBe(8000);
    expect(score(3, 60, { dealer: false, tsumo: false, kiriage: true }).total).toBe(8000);
  });

  it("1 han 40 fu non-dealer = 1300", () => {
    expect(score(1, 40, { dealer: false, tsumo: false }).total).toBe(1300);
  });
});

describe("tsumo (self-draw)", () => {
  it("non-dealer 3 han 30 fu = 1000/2000 (total 4000)", () => {
    const s = score(3, 30, { dealer: false, tsumo: true });
    expect(pay(s, "dealer")).toEqual({ role: "dealer", amount: 2000, count: 1 });
    expect(pay(s, "non-dealer")).toEqual({ role: "non-dealer", amount: 1000, count: 2 });
    expect(s.total).toBe(4000);
  });

  it("dealer 3 han 30 fu = 2000 all (total 6000)", () => {
    const s = score(3, 30, { dealer: true, tsumo: true });
    expect(pay(s, "non-dealer")).toEqual({ role: "non-dealer", amount: 2000, count: 3 });
    expect(s.total).toBe(6000);
  });

  it("pinfu tsumo (2 han 20 fu, non-dealer) = 400/700", () => {
    const s = score(2, 20, { dealer: false, tsumo: true });
    expect(pay(s, "dealer")?.amount).toBe(700);
    expect(pay(s, "non-dealer")?.amount).toBe(400);
    expect(s.total).toBe(1500);
  });

  it("3-player: the missing non-dealer's share simply disappears", () => {
    const s = score(3, 30, { dealer: false, tsumo: true, players: 3 });
    expect(s.total).toBe(3000); // 2000 (dealer) + 1000 (one non-dealer)
    const d = score(3, 30, { dealer: true, tsumo: true, players: 3 });
    expect(d.total).toBe(4000); // 2000 x 2
  });
});

describe("limits", () => {
  const ron = (han: number, opts = {}) => score(han, 30, { dealer: false, tsumo: false, ...opts });

  it("mangan / haneman / baiman / sanbaiman / kazoe yakuman (non-dealer ron)", () => {
    expect(ron(5).total).toBe(8000);
    expect(ron(6).total).toBe(12000);
    expect(ron(7).total).toBe(12000);
    expect(ron(8).total).toBe(16000);
    expect(ron(11).total).toBe(24000);
    expect(ron(13).total).toBe(32000);
  });

  it("high fu clamps to mangan (4 han 70 fu)", () => {
    expect(score(4, 70, { dealer: false, tsumo: false }).total).toBe(8000);
  });

  it("yakuman: 32000 non-dealer, 48000 dealer; double yakuman doubles", () => {
    expect(score(0, 0, { dealer: false, tsumo: false, yakuman: 1 }).total).toBe(32000);
    expect(score(0, 0, { dealer: true, tsumo: false, yakuman: 1 }).total).toBe(48000);
    expect(score(0, 0, { dealer: false, tsumo: false, yakuman: 2 }).total).toBe(64000);
  });
});

describe("honba (repeat counters)", () => {
  it("ron adds 300 per honba to the discarder's payment", () => {
    expect(score(3, 30, { dealer: false, tsumo: false, honba: 1 }).total).toBe(4200);
    expect(score(3, 30, { dealer: false, tsumo: false, honba: 3 }).total).toBe(4800);
  });

  it("tsumo adds 100 per honba to each payer", () => {
    const s = score(3, 30, { dealer: false, tsumo: true, honba: 2 });
    expect(pay(s, "dealer")?.amount).toBe(2200);
    expect(pay(s, "non-dealer")?.amount).toBe(1200);
    expect(s.total).toBe(4600);
  });
});
