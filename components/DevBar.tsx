"use client";

// OFFLINE TEST FORK only. A small toolbar to switch which fake player you're
// "signed in" as (so you can create as one, join/claim seats as others, and see
// shared balances) and to wipe all offline data. Switching or resetting reloads
// the app so it re-boots cleanly as the chosen player.

import { OFFLINE_USERS, activeUserId, setActiveUser, resetOffline } from "@/lib/sg/localBackend";

export default function DevBar() {
  const active = typeof window !== "undefined" ? activeUserId() : OFFLINE_USERS[0].id;

  const switchTo = (id: number) => {
    if (id === active) return;
    setActiveUser(id);
    window.location.reload();
  };

  const reset = () => {
    if (!window.confirm("Wipe all offline test data (groups, sessions, actions, profiles)?")) return;
    resetOffline();
    // Also clear the per-player on-device caches.
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("mahjong-groups:") || k.startsWith("mahjong-lastgroup:") || k.startsWith("mahjong-order:"))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    window.location.reload();
  };

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "8px 10px",
        border: "1px dashed var(--accent-border)",
        borderRadius: "var(--radius-card)",
        background: "var(--accent-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-wider)", textTransform: "uppercase", color: "var(--accent-text)" }}>
          Offline test build
        </span>
        <button className="chip" onClick={reset}>Reset data</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Acting as</span>
        {OFFLINE_USERS.map((u) => (
          <div key={u.id} className={"chip" + (u.id === active ? " selected" : "")} onClick={() => switchTo(u.id)}>
            {u.first_name}
          </div>
        ))}
      </div>
    </div>
  );
}
