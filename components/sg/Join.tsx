"use client";

// Joining a group: enter a code (JoinForm), then pick which seat you are
// (JoinGroup — mirrors CoconutSplit: take over an unclaimed seat, or join as a
// brand-new player).

import { useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { openGroup, claimSeat, joinNew, TrackerState } from "@/lib/sg/remote";

export function JoinForm({
  initialCode,
  busy,
  onBack,
  onJoined,
}: {
  initialCode: string | null;
  busy: boolean;
  onBack: () => void;
  onJoined: (s: TrackerState) => void;
}) {
  useBackButton(onBack);
  const [code, setCode] = useState(initialCode || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const join = async () => {
    setLoading(true); setError("");
    try { onJoined(await openGroup(code.trim().toUpperCase())); }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setLoading(false); }
  };
  return (
    <div>
      <h1>Join a group</h1>
      <h2>Code</h2>
      <input className="text-input" placeholder="e.g. K7P2QM" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="primary-btn" disabled={!code.trim() || loading || busy} onClick={join}>
        {loading ? "Joining…" : "Join"}
      </button>
      {error && <p className="err">{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}

// Pick which player you are when entering a group you haven't joined:
// take over an unclaimed seat, or join as a new player.
export function JoinGroup({
  state,
  busy,
  defaultName,
  onClaimed,
  onBack,
}: {
  state: TrackerState;
  busy: boolean;
  defaultName: string;
  onClaimed: (s: TrackerState) => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const code = state.tracker.code;
  const roster = new Set(state.tracker.players || []); // every seat name in this group
  const claimed = new Set(state.claimedNames || []);
  const unclaimed = (state.tracker.players || []).filter((p) => !claimed.has(p));
  const isFull = (state.tracker.players || []).length >= 4;
  // Pre-fill the new-player name from your app username — but never a name
  // already taken as a seat here (else "Join as X" would 409 on the unique
  // (group, name)). Suffix a number on collision so the field is never blank.
  const base = (defaultName || "").trim();
  let suggestedName = base && !roster.has(base) ? base : "";
  if (!suggestedName && base) {
    for (let i = 2; i < 99 && !suggestedName; i++) if (!roster.has(`${base}${i}`)) suggestedName = `${base}${i}`;
  }
  const [newName, setNewName] = useState(suggestedName);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn: () => Promise<TrackerState>) => {
    setWorking(true); setErr("");
    try { onClaimed(await fn()); haptic("success"); }
    catch (e) {
      haptic("error");
      setErr(String((e as Error).message || e));
      // Lost the seat to someone else -> refresh so the taken seat disappears.
      try { onClaimed(await openGroup(code)); } catch { /* keep the error shown */ }
    }
    finally { setWorking(false); }
  };
  return (
    <div>
      <h1>Join {state.tracker.name || "group"}</h1>
      <p style={{ opacity: 0.75, fontSize: "0.9rem" }}>Which player are you? This links your Telegram account to that seat.</p>
      {unclaimed.length > 0 && (
        <>
          <h2>Take a seat</h2>
          <div className="choices">
            {unclaimed.map((p) => (
              <div key={p} className="choice-btn" onClick={() => !working && run(() => claimSeat(code, p))}>{p}</div>
            ))}
          </div>
        </>
      )}
      {isFull ? (
        <p style={{ opacity: 0.65, fontSize: "0.88rem" }}>
          This group is full (4 players). You can only take an unclaimed seat above.
        </p>
      ) : (
        <>
          <h2>Or join as a new player</h2>
          <input className="text-input" placeholder="Your name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="primary-btn" disabled={!newName.trim() || working || busy} onClick={() => run(() => joinNew(code, newName.trim()))}>
            {working ? "Joining…" : `Join as ${newName.trim() || "new player"}`}
          </button>
        </>
      )}
      {err && <p className="err">{err}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
