"use client";

// Create-a-group screen. A group now starts as just a NAME + a share code with
// an empty roster — players' names are added on the group page afterwards, and
// payouts are chosen per session. So this screen is deliberately tiny.

import { useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { GameType } from "@/lib/sg/remote";

export function Setup({
  title,
  onStart,
  onBack,
  busy,
  error,
  startLabel,
  note,
}: {
  title: string;
  onStart: (name: string, defaultType: GameType) => void;
  onBack: () => void;
  busy?: boolean;
  error?: string;
  startLabel?: string;
  note?: string;
}) {
  useBackButton(onBack);
  const [name, setName] = useState("");
  const [dtype, setDtype] = useState<GameType>("sg4"); // what this group usually plays

  return (
    <div>
      <h1>{title}</h1>
      {note && <p className="hint">{note}</p>}

      <h2>Group name</h2>
      <input className="text-input" placeholder="e.g. Friday mahjong" value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) onStart(name.trim() || "Mahjong", dtype); }} />

      <h2>Usually plays</h2>
      <div className="row">
        {[{ v: "sg4" as GameType, label: "Singaporean (4p)" }, { v: "my3" as GameType, label: "Malaysian (3p) — WIP" }].map((o) => (
          <button type="button" key={o.v} className={"chip" + (dtype === o.v ? " selected" : "")}
            onClick={() => { haptic("selection"); setDtype(o.v); }}>{o.label}</button>
        ))}
      </div>

      <p className="hint" style={{ marginTop: 10 }}>
        You&apos;ll get a share link. On the next screen, add everyone&apos;s names (or let them add their own),
        then set the payouts when you start a session.
      </p>

      <button className="primary-btn" disabled={busy} onClick={() => onStart(name.trim() || "Mahjong", dtype)}>
        {busy ? "Creating…" : startLabel || "Create group"}
      </button>
      {error && <p className="err">{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
