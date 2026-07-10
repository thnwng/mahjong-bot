import { describe, it, expect } from "vitest";
import { newGame, applyHand, reduce, dealerOf, roundOf, seatWind, placements, DEFAULT_CONFIG, GameState, Hand } from "./game";

const sum = (p: number[]) => p.reduce((a, b) => a + b, 0);
// A state with overrides on top of a fresh 4p game (for honba/pot cases).
const withState = (o: Partial<GameState>): GameState => ({ ...newGame(), ...o });

describe("newGame + navigation", () => {
  it("starts 4x25000, dealer 0, East 1", () => {
    const g = newGame();
    expect(g.points).toEqual([25000, 25000, 25000, 25000]);
    expect(dealerOf(g)).toBe(0);
    expect(roundOf(g)).toEqual({ wind: "E", kyoku: 1 });
    expect(seatWind(g, 0)).toBe("E");
    expect(seatWind(g, 1)).toBe("S");
    expect(sum(g.points)).toBe(100000);
  });
  it("derives dealer/round from completed deals", () => {
    expect(roundOf(withState({ deal: 3 }))).toEqual({ wind: "E", kyoku: 4 });
    expect(dealerOf(withState({ deal: 3 }))).toBe(3);
    expect(roundOf(withState({ deal: 4 }))).toEqual({ wind: "S", kyoku: 1 });
    expect(dealerOf(withState({ deal: 5 }))).toBe(1);
  });
});

describe("ron (§1.2, §1.3 — 3 han 30 fu, base 960)", () => {
  it("non-dealer ron = 3900; honba resets, dealer rotates", () => {
    const g = applyHand(newGame(), { kind: "ron", winner: 1, discarder: 0, han: 3, fu: 30, riichi: [] });
    expect(g.points).toEqual([25000 - 3900, 25000 + 3900, 25000, 25000]);
    expect(g.honba).toBe(0);
    expect(g.deal).toBe(1); // rotated
    expect(sum(g.points)).toBe(100000);
  });
  it("dealer ron = 5800; renchan (deal stays), honba +1", () => {
    const g = applyHand(newGame(), { kind: "ron", winner: 0, discarder: 1, han: 3, fu: 30, riichi: [] });
    expect(g.points).toEqual([25000 + 5800, 25000 - 5800, 25000, 25000]);
    expect(g.honba).toBe(1);
    expect(g.deal).toBe(0);
  });
  it("honba adds 300 per counter to the discarder only (§2.3)", () => {
    const g = applyHand(withState({ honba: 2 }), { kind: "ron", winner: 1, discarder: 0, han: 3, fu: 30, riichi: [] });
    // 3900 + 2*300 = 4500
    expect(g.points).toEqual([25000 - 4500, 25000 + 4500, 25000, 25000]);
    expect(g.honba).toBe(0); // non-dealer win resets
  });
});

describe("tsumo (§1.2 — per-payment rounding differs from ron)", () => {
  it("non-dealer tsumo 3 han 30 fu = 1000 each / 2000 dealer (total 4000)", () => {
    const g = applyHand(newGame(), { kind: "tsumo", winner: 1, han: 3, fu: 30, riichi: [] });
    expect(g.points).toEqual([25000 - 2000, 25000 + 4000, 25000 - 1000, 25000 - 1000]);
    expect(sum(g.points)).toBe(100000);
    expect(g.deal).toBe(1);
  });
  it("dealer tsumo 3 han 30 fu = 2000 all (total 6000); renchan", () => {
    const g = applyHand(newGame(), { kind: "tsumo", winner: 0, han: 3, fu: 30, riichi: [] });
    expect(g.points).toEqual([25000 + 6000, 25000 - 2000, 25000 - 2000, 25000 - 2000]);
    expect(g.honba).toBe(1);
    expect(g.deal).toBe(0);
  });
  it("honba on tsumo: 100 from each other player", () => {
    const g = applyHand(withState({ honba: 1 }), { kind: "tsumo", winner: 1, han: 3, fu: 30, riichi: [] });
    // dealer 2000+100=2100, others 1000+100=1100 each; winner +4300
    expect(g.points).toEqual([25000 - 2100, 25000 + 4300, 25000 - 1100, 25000 - 1100]);
  });
});

describe("riichi sticks (§2.1)", () => {
  it("declaring pays 1000 into the pot; the next winner sweeps it", () => {
    // Hand A: draw, seat 2 declares riichi, nobody tenpai -> pot 1000, rotate.
    const a = applyHand(newGame(), { kind: "draw", tenpai: [], riichi: [2] });
    expect(a.points[2]).toBe(24000);
    expect(a.pot).toBe(1000);
    expect(a.honba).toBe(1);
    expect(a.deal).toBe(1); // dealer noten -> rotate
    // Hand B: dealer now 1; seat 3 rons seat 1 (3/30 = 3900) + the carried honba
    // (+300) and sweeps the 1000 pot. Verifies honba-carry AND pot-sweep together.
    const b = applyHand(a, { kind: "ron", winner: 3, discarder: 1, han: 3, fu: 30, riichi: [] });
    expect(b.pot).toBe(0);
    expect(b.points[3]).toBe(25000 + 3900 + 300 + 1000); // 30200
    expect(b.points[1]).toBe(25000 - 3900 - 300);        // 20800
    expect(b.honba).toBe(0); // non-dealer win resets the counter
    expect(sum(b.points)).toBe(100000);
  });
});

describe("exhaustive draw noten batsufu (§3.1)", () => {
  it("1 tenpai: +3000 / -1000 x3", () => {
    const g = applyHand(newGame(), { kind: "draw", tenpai: [0], riichi: [] });
    expect(g.points).toEqual([28000, 24000, 24000, 24000]);
  });
  it("2 tenpai: +1500 each / -1500 each", () => {
    const g = applyHand(newGame(), { kind: "draw", tenpai: [0, 1], riichi: [] });
    expect(g.points).toEqual([26500, 26500, 23500, 23500]);
  });
  it("3 tenpai: +1000 each / lone noten -3000", () => {
    const g = applyHand(newGame(), { kind: "draw", tenpai: [0, 1, 2], riichi: [] });
    expect(g.points).toEqual([26000, 26000, 26000, 22000]);
  });
  it("all or none tenpai: no exchange", () => {
    expect(applyHand(newGame(), { kind: "draw", tenpai: [], riichi: [] }).points).toEqual([25000, 25000, 25000, 25000]);
    expect(applyHand(newGame(), { kind: "draw", tenpai: [0, 1, 2, 3], riichi: [] }).points).toEqual([25000, 25000, 25000, 25000]);
  });
  it("tenpai renchan: dealer tenpai keeps the deal, honba +1", () => {
    const keep = applyHand(newGame(), { kind: "draw", tenpai: [0], riichi: [] });
    expect(keep.deal).toBe(0);
    expect(keep.honba).toBe(1);
    const rot = applyHand(newGame(), { kind: "draw", tenpai: [1], riichi: [] });
    expect(rot.deal).toBe(1); // dealer noten -> rotate
    expect(rot.honba).toBe(1);
  });
});

describe("chombo (§3.4)", () => {
  it("non-dealer offender pays 4000 to dealer + 2000 to each other (-8000)", () => {
    const g = applyHand(newGame(), { kind: "chombo", offender: 1 });
    expect(g.points).toEqual([25000 + 4000, 25000 - 8000, 25000 + 2000, 25000 + 2000]);
    expect(g.deal).toBe(0); // no rotation
    expect(g.honba).toBe(0); // unchanged
  });
  it("dealer offender pays 4000 to each (-12000)", () => {
    const g = applyHand(newGame(), { kind: "chombo", offender: 0 });
    expect(g.points).toEqual([25000 - 12000, 25000 + 4000, 25000 + 4000, 25000 + 4000]);
  });
});

describe("abortive draw (§3.2)", () => {
  it("moves no points; honba +1; dealer keeps", () => {
    const g = applyHand(newGame(), { kind: "abort", riichi: [] });
    expect(g.points).toEqual([25000, 25000, 25000, 25000]);
    expect(g.honba).toBe(1);
    expect(g.deal).toBe(0);
  });
});

describe("game length + placements", () => {
  it("tonpuusen finishes after 4 deals", () => {
    const draws: Hand[] = Array.from({ length: 4 }, () => ({ kind: "draw", tenpai: [], riichi: [] }));
    const g = reduce({ ...DEFAULT_CONFIG, length: "tonpuusen" }, draws);
    expect(g.deal).toBe(4);
    expect(g.finished).toBe(true);
  });
  it("hanchan is not finished after 4 deals", () => {
    const draws: Hand[] = Array.from({ length: 4 }, () => ({ kind: "draw", tenpai: [], riichi: [] }));
    const g = reduce({ ...DEFAULT_CONFIG, length: "hanchan" }, draws);
    expect(g.finished).toBe(false);
  });
  it("placements rank best-first, ties by seat order", () => {
    const g = withState({ points: [30000, 20000, 25000, 25000] });
    expect(placements(g)).toEqual([
      { seat: 0, points: 30000, place: 1 },
      { seat: 2, points: 25000, place: 2 }, // tie 25000: seat 2 before seat 3
      { seat: 3, points: 25000, place: 3 },
      { seat: 1, points: 20000, place: 4 },
    ]);
  });
  it("tobi ends the game when a score goes below 0", () => {
    const g = applyHand(withState({ config: { ...DEFAULT_CONFIG, tobi: true }, points: [25000, 25000, 25000, 3000] }),
      { kind: "ron", winner: 0, discarder: 3, han: 4, fu: 30, riichi: [] }); // dealer ron 4/30 = 11600
    expect(g.points[3]).toBeLessThan(0);
    expect(g.finished).toBe(true);
  });
});
