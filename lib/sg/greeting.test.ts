import { describe, it, expect } from "vitest";
import { greeting } from "./greeting";

describe("greeting", () => {
  it("morning across 04:00–11:59", () => {
    for (const h of [4, 5, 9, 11]) expect(greeting(h)).toBe("Good Morning");
  });
  it("afternoon across 12:00–17:59", () => {
    for (const h of [12, 13, 15, 17]) expect(greeting(h)).toBe("Good Afternoon");
  });
  it("evening across 18:00–03:59 (wraps past midnight)", () => {
    for (const h of [18, 20, 23, 0, 1, 3]) expect(greeting(h)).toBe("Good Evening");
  });
  it("holds exactly at each boundary", () => {
    expect(greeting(3)).toBe("Good Evening");   // last evening hour
    expect(greeting(4)).toBe("Good Morning");   // first morning hour
    expect(greeting(11)).toBe("Good Morning");  // last morning hour
    expect(greeting(12)).toBe("Good Afternoon"); // first afternoon hour
    expect(greeting(17)).toBe("Good Afternoon"); // last afternoon hour
    expect(greeting(18)).toBe("Good Evening");  // first evening hour
  });
});
