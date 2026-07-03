"use client";

// First-run display-name gate + the game-types checklist. The display name is
// the account's one label (profiles table; not unique); per-group seat names are
// separate and renamed from inside a group.

import { useState } from "react";
import { haptic } from "@/lib/telegram";
import { Profile, setDisplayName, setPrefs, GameType, GAME_TYPES, validDisplayName, NAME_MAX, NAME_HINT } from "@/lib/sg/remote";

// Multi-select checklist of mahjong types (first-run gate + settings reuse it).
export function GameTypeChecklist({ value, onChange }: { value: GameType[]; onChange: (v: GameType[]) => void }) {
  const toggle = (t: GameType) => {
    haptic("selection");
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  };
  return (
    <div className="choices">
      {GAME_TYPES.map((g) => (
        <div key={g.v} className={"choice-btn" + (value.includes(g.v) ? " selected-choice" : "")}
          onClick={() => toggle(g.v)}>
          {g.label}
          <small>{value.includes(g.v) ? "selected" : "tap to select"}{g.wip ? " · coming soon" : ""}</small>
        </div>
      ))}
    </div>
  );
}

// First-run step 2: what will you use this app for? Gates which tabs the home
// screen offers (changeable later in Settings).
export function GameTypesGate({ onDone }: { onDone: (types: GameType[]) => void }) {
  const [picked, setPicked] = useState<GameType[]>(["sg4"]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!picked.length) { setErr("Pick at least one."); haptic("error"); return; }
    setSaving(true); setErr("");
    try { const { gameTypes } = await setPrefs(picked); haptic("success"); onDone(gameTypes); }
    catch (e) {
      const msg = String((e as Error).message || e);
      // Older server without set-prefs (mid-deploy): don't strand the user on
      // this screen — carry on with their picks; the choice re-asks next boot.
      if (/unknown op/i.test(msg)) { onDone(picked); return; }
      haptic("error"); setErr(msg);
    }
    finally { setSaving(false); }
  };
  return (
    <div>
      <h1>What do you play?</h1>
      <p style={{ opacity: 0.8, fontSize: "0.9rem" }}>
        Pick everything you&apos;ll use this app for — it decides which tabs you see. You can change this any time in Settings.
      </p>
      <GameTypeChecklist value={picked} onChange={setPicked} />
      <button className="primary-btn" disabled={!picked.length || saving} onClick={submit}>
        {saving ? "Saving…" : "Continue"}
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

// First-run gate: confirm your display name (pre-filled with your Telegram
// name). Not unique — just a label. Blocks the app until set — there's no back.
export function UsernameGate({ suggested, onDone }: { suggested: string; hasHandle?: boolean; onDone: (p: Profile) => void }) {
  const [name, setName] = useState(suggested);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = validDisplayName(name);
  const submit = async () => {
    if (!valid) { setErr(NAME_HINT); haptic("error"); return; }
    setSaving(true); setErr("");
    try { const { profile } = await setDisplayName(name.trim()); haptic("success"); onDone(profile); }
    catch (e) { haptic("error"); setErr(String((e as Error).message || e)); }
    finally { setSaving(false); }
  };
  return (
    <div>
      <h1>Your display name</h1>
      <p style={{ opacity: 0.8, fontSize: "0.9rem" }}>
        This is how you show up across the app. We filled in your Telegram name — keep it (it&apos;ll update if you rename on Telegram) or type your own.
      </p>
      <input className="text-input" autoFocus value={name} maxLength={NAME_MAX} placeholder="your name"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <button className="primary-btn" disabled={!valid || saving} onClick={submit}>
        {saving ? "Saving…" : "Continue"}
      </button>
      {err && <p className="err">{err}</p>}
      <p style={{ opacity: 0.55, fontSize: "0.78rem" }}>{NAME_HINT} Doesn&apos;t have to be unique.</p>
    </div>
  );
}

// (The old inline "Signed in as X" editor moved into the Settings tab.)
