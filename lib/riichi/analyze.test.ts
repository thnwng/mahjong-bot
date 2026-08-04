// Unit tests for the riichi hand analyzer (decomposition -> yaku -> fu -> score).
// Oracle: the standard published riichi tables (same chart scoring.test.ts uses)
// plus canonical yaku definitions. Tile codes: <rank><B|C|D> suits, EW/SW/WW/NW
// winds, RD/GD/WD dragons. Every hand below lists its 14 tiles (concealed +
// called) so a reviewer can recount; the win tile is always among them.
import { describe, expect, it } from "vitest";
import { analyze, WinContext } from "./analyze";

const ctx = (over: Partial<WinContext> & { winTile: string }): WinContext => ({
  seatWind: "SW",
  roundWind: "EW",
  tsumo: false,
  ...over,
});

const names = (r: { yaku: [string, number][] }) => r.yaku.map(([n]) => n);

describe("standard hands and fu", () => {
  // 2B3B4B 5B6B7B 2C3C4C 6D7D8D 5D5D, ron 4B (ryanmen). All simples, closed.
  const pinfuTiles = ["2B", "3B", "4B", "5B", "6B", "7B", "2C", "3C", "4C", "6D", "7D", "8D", "5D", "5D"];

  it("closed ryanmen all-chows: Pinfu + Tanyao, 30 fu ron = 2000", () => {
    const r = analyze(pinfuTiles, [], ctx({ winTile: "4B" }));
    expect(r.ok).toBe(true);
    expect(names(r).sort()).toEqual(["Pinfu", "Tanyao"]);
    expect(r.han).toBe(2);
    expect(r.fu).toBe(30);
    expect(r.score!.total).toBe(2000);
  });

  it("same hand tsumo: +Menzen Tsumo, pinfu fu drops to 20 (700/1300)", () => {
    const r = analyze(pinfuTiles, [], ctx({ winTile: "4B", tsumo: true }));
    expect(names(r).sort()).toEqual(["Menzen Tsumo", "Pinfu", "Tanyao"]);
    expect(r.fu).toBe(20);
    expect(r.score!.total).toBe(2700);
    // Payments are per ROLE with a count (the scoring.ts contract): two
    // non-dealers pay 700 each, the dealer pays 1300.
    const byRole = Object.fromEntries(r.score!.payments.map((p) => [p.role, p]));
    expect(byRole["dealer"]).toMatchObject({ amount: 1300, count: 1 });
    expect(byRole["non-dealer"]).toMatchObject({ amount: 700, count: 2 });
  });

  it("yakuhai dragon pung + kanchan wait: 1 han 40 fu ron = 1300", () => {
    // RDRDRD 2B3B4B 6C7C8C 3D4D5D 9B9B, ron 4D (kanchan). 20+10(menzen)+8(honor anko)+2(kanchan)=40.
    const tiles = ["RD", "RD", "RD", "2B", "3B", "4B", "6C", "7C", "8C", "3D", "4D", "5D", "9B", "9B"];
    const r = analyze(tiles, [], ctx({ winTile: "4D" }));
    expect(names(r)).toEqual(["Yakuhai (RD)"]);
    expect(r.han).toBe(1);
    expect(r.fu).toBe(40);
    expect(r.score!.total).toBe(1300);
  });

  it("double east pung scores seat + double wind (2 han), dealer ron 40 fu = 3900", () => {
    // EWEWEW 2B3B4B 5B6B7B 3C4C5C 5D5D, ron 7B (ryanmen), seat EW round EW.
    const tiles = ["EW", "EW", "EW", "2B", "3B", "4B", "5B", "6B", "7B", "3C", "4C", "5C", "5D", "5D"];
    const r = analyze(tiles, [], ctx({ winTile: "7B", seatWind: "EW", roundWind: "EW" }));
    expect(names(r).sort()).toEqual(["Yakuhai (double wind)", "Yakuhai (seat wind)"]);
    expect(r.han).toBe(2);
    expect(r.fu).toBe(40); // 20 + 10 menzen + 8 concealed honor pung, rounded
    expect(r.score!.total).toBe(3900); // dealer 2 han 40 fu
  });

  it("open all-simples hand: Tanyao only, bare 20 fu becomes 30 (open pinfu rule) = 1000", () => {
    // Called chow 3B4B5B; concealed 3C4C5C 6C7C8C 4D5D6D 2D2D, ron 6D (ryanmen).
    const concealed = ["3C", "4C", "5C", "6C", "7C", "8C", "4D", "5D", "6D", "2D", "2D"];
    const r = analyze(concealed, [{ kind: "chow", codes: ["3B", "4B", "5B"] }], ctx({ winTile: "6D" }));
    expect(names(r)).toEqual(["Tanyao"]);
    expect(r.fu).toBe(30);
    expect(r.score!.total).toBe(1000);
  });
});

describe("special hand shapes", () => {
  it("chiitoitsu: 2 han 25 fu ron = 1600", () => {
    const tiles = ["1B", "1B", "3B", "3B", "5C", "5C", "7C", "7C", "9D", "9D", "EW", "EW", "RD", "RD"];
    const r = analyze(tiles, [], ctx({ winTile: "RD" }));
    expect(names(r)).toEqual(["Chiitoitsu"]);
    expect(r.han).toBe(2);
    expect(r.fu).toBe(25);
    expect(r.score!.total).toBe(1600);
  });

  it("ryanpeikou shape beats its chiitoitsu reading (best interpretation wins)", () => {
    // 2B2B3B3B4B4B 6C6C7C7C8C8C 9D9D is both 7 pairs AND two iipeikou pairs + pinfu.
    const tiles = ["2B", "2B", "3B", "3B", "4B", "4B", "6C", "6C", "7C", "7C", "8C", "8C", "9D", "9D"];
    const r = analyze(tiles, [], ctx({ winTile: "4B" }));
    expect(names(r)).toContain("Ryanpeikou");
    expect(names(r)).toContain("Pinfu");
    expect(names(r)).not.toContain("Chiitoitsu");
    expect(r.han).toBe(4);
    expect(r.score!.total).toBe(7700); // non-dealer 4 han 30 fu, no kiriage
  });

  it("kokushi musou is detected as a yakuman (32000 non-dealer)", () => {
    const tiles = ["1B", "9B", "1C", "9C", "1D", "9D", "EW", "SW", "WW", "NW", "RD", "GD", "WD", "RD"];
    const r = analyze(tiles, [], ctx({ winTile: "RD" }));
    expect(r.yakuman).toEqual(["Kokushi Musou"]);
    expect(r.score!.total).toBe(32000);
  });
});

describe("triplet-family yaku and the tsumo/ron concealment split", () => {
  // 2B2B2B 3C3C3C 4D4D4D 6B6B6B 8D8D, winning on 6B (shanpon).
  const fourPungs = ["2B", "2B", "2B", "3C", "3C", "3C", "4D", "4D", "4D", "6B", "6B", "6B", "8D", "8D"];

  it("tsumo keeps the 4th triplet concealed: Suuankou yakuman", () => {
    const r = analyze(fourPungs, [], ctx({ winTile: "6B", tsumo: true }));
    expect(r.yakuman).toContain("Suuankou");
    expect(r.score!.total).toBe(32000);
  });

  it("ron opens the completed triplet: Sanankou + Toitoi (+ Tanyao), NOT suuankou", () => {
    const r = analyze(fourPungs, [], ctx({ winTile: "6B" }));
    expect(r.yakuman).toEqual([]);
    // All five tile kinds are simples, so Tanyao rightly stacks on top -
    // the first draft of this test forgot it and the engine corrected us.
    expect(names(r).sort()).toEqual(["Sanankou", "Tanyao", "Toitoi"]);
    expect(r.han).toBe(5);
    expect(r.fu).toBe(50); // 20 + 10 menzen + 4+4+4 concealed simples + 2 open simple, rounded
    expect(r.score!.total).toBe(8000); // 5 han = mangan
  });

  it("honroutou stacks with toitoi and sanankou (haneman on ron)", () => {
    // 1B1B1B 9C9C9C EWEWEW NWNWNW RDRD, ron 1B (shanpon; EW = round wind).
    const tiles = ["1B", "1B", "1B", "9C", "9C", "9C", "EW", "EW", "EW", "NW", "NW", "NW", "RD", "RD"];
    const r = analyze(tiles, [], ctx({ winTile: "1B" }));
    expect(names(r)).toContain("Honroutou");
    expect(names(r)).toContain("Toitoi");
    expect(names(r)).toContain("Sanankou");
    expect(names(r)).toContain("Yakuhai (round wind)");
    expect(r.han).toBe(7);
    expect(r.score!.total).toBe(12000);
  });
});

describe("dragon and flush families", () => {
  it("shousangen: two dragon pungs + dragon pair, capped at mangan here", () => {
    // RDRDRD GDGDGD WDWD 2B3B4B 5C6C7C, ron 4B. Yakuhai x2 + Shousangen 2 = 4 han 50 fu.
    const tiles = ["RD", "RD", "RD", "GD", "GD", "GD", "WD", "WD", "2B", "3B", "4B", "5C", "6C", "7C"];
    const r = analyze(tiles, [], ctx({ winTile: "4B" }));
    expect(names(r)).toContain("Shousangen");
    expect(r.han).toBe(4);
    expect(r.score!.total).toBe(8000);
  });

  it("daisangen: three dragon pungs is a yakuman", () => {
    const tiles = ["RD", "RD", "RD", "GD", "GD", "GD", "WD", "WD", "WD", "2B", "3B", "4B", "5C", "5C"];
    const r = analyze(tiles, [], ctx({ winTile: "4B" }));
    expect(r.yakuman).toContain("Daisangen");
    expect(r.score!.total).toBe(32000);
  });

  it("chinitsu closed + tsumo = haneman (12000 non-dealer)", () => {
    // 1B1B1B 2B3B4B 5B6B7B 7B8B9B 9B9B, tsumo 1B. Chinitsu 6 + Menzen Tsumo 1.
    const tiles = ["1B", "1B", "1B", "2B", "3B", "4B", "5B", "6B", "7B", "7B", "8B", "9B", "9B", "9B"];
    const r = analyze(tiles, [], ctx({ winTile: "1B", tsumo: true }));
    expect(names(r)).toContain("Chinitsu");
    expect(r.han).toBe(7);
    expect(r.score!.total).toBe(12000);
  });
});

describe("sequence-family yaku", () => {
  it("sanshoku (closed) + tanyao: 3 han 40 fu = 5200", () => {
    // 2B3B4B 2C3C4C 2D3D4D 6C6C6C 8D8D, ron 3D (kanchan). 20+10+4(anko)+2=36->40.
    const tiles = ["2B", "3B", "4B", "2C", "3C", "4C", "2D", "3D", "4D", "6C", "6C", "6C", "8D", "8D"];
    const r = analyze(tiles, [], ctx({ winTile: "3D" }));
    expect(names(r).sort()).toEqual(["Sanshoku", "Tanyao"]);
    expect(r.han).toBe(3);
    expect(r.fu).toBe(40);
    expect(r.score!.total).toBe(5200);
  });

  it("ittsuu (closed) rides with pinfu: 3 han 30 fu = 3900", () => {
    // 1C2C3C 4C5C6C 7C8C9C 2B3B4B 6D6D, ron 4B (ryanmen).
    const tiles = ["1C", "2C", "3C", "4C", "5C", "6C", "7C", "8C", "9C", "2B", "3B", "4B", "6D", "6D"];
    const r = analyze(tiles, [], ctx({ winTile: "4B" }));
    expect(names(r).sort()).toEqual(["Ittsuu", "Pinfu"]);
    expect(r.han).toBe(3);
    expect(r.score!.total).toBe(3900);
  });

  it("chanta (with honors) closed + penchan: 2 han 40 fu = 2600", () => {
    // 1B2B3B 7C8C9C 1D2D3D NWNWNW 9D9D, ron 3D (penchan). NW is neither seat nor round.
    const tiles = ["1B", "2B", "3B", "7C", "8C", "9C", "1D", "2D", "3D", "NW", "NW", "NW", "9D", "9D"];
    const r = analyze(tiles, [], ctx({ winTile: "3D" }));
    expect(names(r)).toEqual(["Chanta"]);
    expect(r.han).toBe(2);
    expect(r.fu).toBe(40);
    expect(r.score!.total).toBe(2600);
  });

  it("junchan (terminals only, no honors) closed: 3 han", () => {
    // 1B2B3B 7C8C9C 1D2D3D 9B9B9B 9D9D, ron 3D (penchan).
    const tiles = ["1B", "2B", "3B", "7C", "8C", "9C", "1D", "2D", "3D", "9B", "9B", "9B", "9D", "9D"];
    const r = analyze(tiles, [], ctx({ winTile: "3D" }));
    expect(names(r)).toEqual(["Junchan"]);
    expect(r.han).toBe(3);
    expect(r.score!.total).toBe(5200); // 3 han 40 fu
  });
});

describe("context passthrough (dora, honba, riichi chain, sanma)", () => {
  const pinfuTiles = ["2B", "3B", "4B", "5B", "6B", "7B", "2C", "3C", "4C", "6D", "7D", "8D", "5D", "5D"];

  it("dora/aka join the han count and the yaku list: 2 + 3 dora = mangan", () => {
    const r = analyze(pinfuTiles, [], ctx({ winTile: "4B", dora: 2, aka: 1 }));
    expect(r.han).toBe(5);
    expect(r.yaku).toContainEqual(["Dora", 2]);
    expect(r.yaku).toContainEqual(["Aka dora", 1]);
    expect(r.score!.total).toBe(8000);
  });

  it("honba reaches the score: 1 han 40 fu ron + 2 honba = 1900", () => {
    const tiles = ["RD", "RD", "RD", "2B", "3B", "4B", "6C", "7C", "8C", "3D", "4D", "5D", "9B", "9B"];
    const r = analyze(tiles, [], ctx({ winTile: "4D", honba: 2 }));
    expect(r.score!.total).toBe(1900);
  });

  it("riichi + ippatsu + tsumo stack on pinfu/tanyao to a mangan tsumo", () => {
    const r = analyze(pinfuTiles, [], ctx({ winTile: "4B", tsumo: true, riichi: true, ippatsu: true }));
    expect(names(r).sort()).toEqual(["Ippatsu", "Menzen Tsumo", "Pinfu", "Riichi", "Tanyao"]);
    expect(r.han).toBe(5);
    expect(r.score!.total).toBe(8000);
  });

  it("players: 3 drops one non-dealer payment (2000 instead of 2700)", () => {
    const r = analyze(pinfuTiles, [], ctx({ winTile: "4B", tsumo: true, players: 3 }));
    expect(r.score!.total).toBe(2000);
  });
});

describe("rejections", () => {
  it("a valid shape with zero yaku returns the no-yaku error", () => {
    // Called chow 1B2B3B (open); concealed 4B5B6B 5C6C7C 7D8D9D 2D2D, ron 5C.
    const concealed = ["4B", "5B", "6B", "5C", "6C", "7C", "7D", "8D", "9D", "2D", "2D"];
    const r = analyze(concealed, [{ kind: "chow", codes: ["1B", "2B", "3B"] }], ctx({ winTile: "5C" }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no yaku (hand has no scoring element)");
  });

  it("14 unconnectable tiles are rejected as not a winning hand", () => {
    const tiles = ["1B", "4B", "7B", "2C", "5C", "8C", "3D", "6D", "9D", "EW", "SW", "WW", "RD", "GD"];
    const r = analyze(tiles, [], ctx({ winTile: "1B" }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not a valid winning hand");
  });
});
