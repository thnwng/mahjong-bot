// Regression tests for the delete-session money op (offline backend mirrors the
// server track function). These guard the 2026-07-11 review findings: deleting a
// session must NEVER erase an unrelated debt or wipe settlements, and must not
// permanently lock offsetting sessions. Balances are derived from the action log,
// so a correct op leaves the remaining log summing to the true outstanding debt.

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
type State = { debts: Record<string, number>; settlements: unknown[]; sessions: { id: string }[] };

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

describe("delete-session money safety", () => {
  beforeEach(() => store.clear());

  it("does not erase an unrelated debt or the settlement audit trail", async () => {
    // S1: A owes B 5, then A settles up (reverse transfer). S2: B owes A 5 (unpaid).
    // S3: A owes B 5, so the group nets to 0. Deleting the duplicate S3 must leave
    // the real outstanding debt (B owes A 5), NOT silently show everyone square.
    seed([
      game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }]),
      game("a2", null, [{ payer: "B", payee: "A", amount: 5 }], "settle"),
      game("a3", "s2", [{ payer: "B", payee: "A", amount: 5 }]),
      game("a4", "s3", [{ payer: "A", payee: "B", amount: 5 }]),
    ], ["s1", "s2", "s3"]);
    const res = await localCall<State>("delete-session", { code: "TEST01", sessionId: "s3" });
    expect(round2(res.debts.A)).toBe(5);   // A is owed 5
    expect(round2(res.debts.B)).toBe(-5);  // B owes 5
    expect(res.settlements.length).toBe(1); // the S1 repayment record survives
  });

  it("deletes an ended session that offsets another (no permanent lockout)", async () => {
    // Two offsetting ended sessions, no settlements -> group nets to 0.
    seed([
      game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }]),
      game("a2", "s2", [{ payer: "B", payee: "A", amount: 5 }]),
    ], ["s1", "s2"]);
    const res = await localCall<State>("delete-session", { code: "TEST01", sessionId: "s1" });
    expect(res.sessions.find((s) => s.id === "s1")).toBeUndefined(); // it actually deleted
    expect(round2(res.debts.A)).toBe(5); // S2's real debt is now exposed (correct)
  });

  it("refuses to delete an ended session while the group still owes money", async () => {
    seed([game("a1", "s1", [{ payer: "A", payee: "B", amount: 5 }])], ["s1"]);
    await expect(localCall("delete-session", { code: "TEST01", sessionId: "s1" }))
      .rejects.toThrow(/settle the debts first/);
  });
});
