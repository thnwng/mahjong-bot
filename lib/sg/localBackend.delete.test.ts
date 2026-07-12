// Money-safety tests for settle + delete-session (offline backend mirrors the
// server track function). Covers the 2026-07-11 delete-session review findings
// AND the per-session settlement model (0008): a repayment clears one session's
// debt and carries its session_id, so deleting that session removes its games
// and its repayments together, cleanly. Balances are derived from the action
// log, so a correct op leaves the remaining log summing to the true debt.

import { beforeEach, describe, expect, it } from "vitest";
import type { PayoutConfig } from "./payout";

// --- localStorage + window shim so the client-only backend runs under node ---
const store = new Map<string, string>();
(globalThis as unknown as { window?: unknown }).window = globalThis;
(globalThis as unknown as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
};

import { localCall, setActiveUser } from "./localBackend";

type Tr = { payer: string; payee: string; amount: number };
type Sess = { id: string; net?: Record<string, number>; outstanding?: Record<string, number> };
type State = { debts: Record<string, number>; settlements: unknown[]; sessions: Sess[] };
type Action = { session_id: string | null; meta: { k?: string } | null };

const BASES: PayoutConfig = { tai: 0.4, zimo: 0.2, yao: 0.1, gang: 0.1, maxTai: 10 };
const PAST = "2020-01-01T00:00:00.000Z";
const round2 = (n: number | undefined) => Math.round((n || 0) * 100) / 100;
const game = (id: string, session_id: string | null, transfers: Tr[], k = "hu") =>
  ({ id, tracker_id: "t1", session_id, actioner: "A", summary: "", transfers, meta: { k }, created_at: PAST });

function seed(actions: ReturnType<typeof game>[], sessionIds: string[]) {
  store.clear();
  store.set("mahjong-offline-db", JSON.stringify({
    trackers: [{ id: "t1", code: "TEST01", game: "sg", name: "T", players: ["A", "B", "C", "D"], bases: BASES, tg_chat_id: null, default_type: "sg4", created_at: PAST }],
    members: [{ tracker_id: "t1", user_id: 1, name: "A", created_at: PAST }],
    actions,
    sessions: sessionIds.map((id) => ({ id, tracker_id: "t1", mahjong_type: "sg4", players: ["A", "B", "C", "D"], bases: BASES, settle: true, name: id, started_by: "A", started_at: PAST, ended_at: PAST })),
    profiles: {},
  }));
  setActiveUser(1); // uid 1 is seated as "A"
}
const readActions = (): Action[] => (JSON.parse(store.get("mahjong-offline-db")!).actions as Action[]);

describe("delete-session money safety (regressions)", () => {
  beforeEach(() => store.clear());

  it("does not erase an unrelated debt or a legacy settlement audit trail", async () => {
    // S1: A owes B 5, then a LEGACY aggregate repayment (session_id null). S2: B
    // owes A 5 (unpaid). S3: A owes B 5 -> group nets 0. Deleting the duplicate S3
    // must leave the real debt (B owes A 5), not silently show everyone square.
    seed([
      game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }]),
      game("a2", null, [{ payer: "B", payee: "A", amount: 5 }], "settle"),
      game("a3", "s2", [{ payer: "B", payee: "A", amount: 5 }]),
      game("a4", "s3", [{ payer: "A", payee: "B", amount: 5 }]),
    ], ["s1", "s2", "s3"]);
    const res = await localCall<State>("delete-session", { code: "TEST01", sessionId: "s3" });
    expect(round2(res.debts.A)).toBe(5);
    expect(round2(res.debts.B)).toBe(-5);
    expect(res.settlements.length).toBe(1); // the legacy repayment survives
  });

  it("deletes an ended session that offsets another (no permanent lockout)", async () => {
    seed([
      game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }]),
      game("a2", "s2", [{ payer: "B", payee: "A", amount: 5 }]),
    ], ["s1", "s2"]);
    const res = await localCall<State>("delete-session", { code: "TEST01", sessionId: "s1" });
    expect(res.sessions.find((s) => s.id === "s1")).toBeUndefined();
    expect(round2(res.debts.A)).toBe(5);
  });

  it("refuses to delete an ended session whose own debt is unsettled", async () => {
    seed([game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }])], ["s1"]);
    await expect(localCall("delete-session", { code: "TEST01", sessionId: "s1" }))
      .rejects.toThrow(/settle this session's debts first/);
  });
});

describe("per-session settlement (0008)", () => {
  beforeEach(() => store.clear());

  it("settles only the named session's debt and stamps its session_id", async () => {
    // S1: A owes B 5. S2: A owes B 5. Settling S1 must clear S1 only, not S2.
    seed([
      game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }]),
      game("a2", "s2", [{ payer: "A", payee: "B", amount: 5 }]),
    ], ["s1", "s2"]);
    const res = await localCall<State>("settle", { code: "TEST01", from: "A", to: "B", amount: 5, sessionId: "s1" });
    const s1 = res.sessions.find((s) => s.id === "s1")!;
    const s2 = res.sessions.find((s) => s.id === "s2")!;
    expect(round2(s1.outstanding!.A)).toBe(0);   // S1 squared up
    expect(round2(s2.outstanding!.A)).toBe(-5);  // S2 still owes
    const settle = readActions().find((a) => a.meta?.k === "settle")!;
    expect(settle.session_id).toBe("s1");        // stamped, not null
  });

  it("clamps a per-session repayment to that session's outstanding", async () => {
    seed([game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }])], ["s1"]);
    // Try to overpay: only 5 is outstanding in s1.
    await localCall("settle", { code: "TEST01", from: "A", to: "B", amount: 999, sessionId: "s1" });
    const res = await localCall<State>("state", { code: "TEST01" });
    const s1 = res.sessions.find((s) => s.id === "s1")!;
    expect(round2(s1.outstanding!.A)).toBe(0);
    expect(Object.values(res.debts).every((v) => Math.abs(v) < 0.004)).toBe(true);
  });

  it("deletes a per-session-settled session cleanly (no refund debt, repayment gone)", async () => {
    seed([game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }])], ["s1"]);
    await localCall("settle", { code: "TEST01", from: "A", to: "B", amount: 5, sessionId: "s1" });
    const res = await localCall<State>("delete-session", { code: "TEST01", sessionId: "s1" });
    expect(res.sessions.find((s) => s.id === "s1")).toBeUndefined();
    expect(Object.values(res.debts).every((v) => Math.abs(v) < 0.004)).toBe(true); // truly square
    expect(res.settlements.length).toBe(0); // the s1 repayment was removed with it
  });

  it("lets a settled session be deleted even while another session is unsettled", async () => {
    // S1: A owes B 5 (will settle). S2: C owes D 5 (left unsettled).
    seed([
      game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }]),
      game("a2", "s2", [{ payer: "C", payee: "D", amount: 5 }]),
    ], ["s1", "s2"]);
    await localCall("settle", { code: "TEST01", from: "A", to: "B", amount: 5, sessionId: "s1" });
    const res = await localCall<State>("delete-session", { code: "TEST01", sessionId: "s1" });
    expect(res.sessions.find((s) => s.id === "s1")).toBeUndefined(); // deleted despite s2 owing
    expect(round2(res.debts.C)).toBe(-5); // s2's debt untouched
    expect(round2(res.debts.D)).toBe(5);
  });
});
