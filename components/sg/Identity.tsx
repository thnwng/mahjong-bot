"use client";

// First-run username gate + the "Signed in as" header with its inline editor.
// The username is the account's one global handle (profiles table); per-group
// seat names are separate and renamed from inside a group.

import { useState } from "react";
import { haptic } from "@/lib/telegram";
import { Profile, setUsername, USERNAME_RE, USERNAME_HINT } from "@/lib/sg/remote";

// First-run gate: choose a unique app username (pre-filled with the Telegram
// handle when there is one). Blocks the app until set — there's no back.
export function UsernameGate({ suggested, hasHandle, onDone }: { suggested: string; hasHandle: boolean; onDone: (p: Profile) => void }) {
  const [name, setName] = useState(hasHandle ? suggested : "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = USERNAME_RE.test(name.trim());
  const submit = async () => {
    if (!valid) { setErr(USERNAME_HINT); haptic("error"); return; }
    setSaving(true); setErr("");
    try { const { profile } = await setUsername(name.trim()); haptic("success"); onDone(profile); }
    catch (e) { haptic("error"); setErr(String((e as Error).message || e)); }
    finally { setSaving(false); }
  };
  return (
    <div>
      <h1>Pick a username</h1>
      <p style={{ opacity: 0.8, fontSize: "0.9rem" }}>
        {hasHandle
          ? "This is your name across the app. We suggested your Telegram handle — keep it and it stays in sync when you rename on Telegram, or type your own to fix it."
          : "This is your name across the app. You don't have a Telegram username, so choose one."}
      </p>
      <input className="text-input" autoFocus value={name} maxLength={20} placeholder="username"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <button className="primary-btn" disabled={!valid || saving} onClick={submit}>
        {saving ? "Saving…" : "Continue"}
      </button>
      {err && <p className="err">{err}</p>}
      <p style={{ opacity: 0.55, fontSize: "0.78rem" }}>{USERNAME_HINT} Must be unique.</p>
    </div>
  );
}

// Home header: shows your username with an inline editor. Changing it away from
// your Telegram handle stops the auto-mirroring (handled server-side).
export function ProfileHeader({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.username);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = USERNAME_RE.test(name.trim());
  const save = async () => {
    const nm = name.trim();
    if (nm === profile.username) { setEditing(false); return; }
    if (!valid) { setErr(USERNAME_HINT); return; }
    setSaving(true); setErr("");
    try { const { profile: p } = await setUsername(nm); haptic("success"); onChange(p); setEditing(false); }
    catch (e) { haptic("error"); setErr(String((e as Error).message || e)); }
    finally { setSaving(false); }
  };
  if (!editing)
    return (
      <p style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: 0 }}>
        Signed in as <strong>{profile.username}</strong>{" "}
        <button className="link-btn" style={{ padding: 0, fontSize: "inherit", verticalAlign: "baseline" }}
          onClick={() => { setName(profile.username); setErr(""); setEditing(true); }}>✎</button>
      </p>
    );
  return (
    <div style={{ marginBottom: 8 }}>
      <input className="text-input small" autoFocus value={name} maxLength={20}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <button className="chip" disabled={saving} onClick={save}>Save</button>
      <button className="chip" onClick={() => setEditing(false)}>Cancel</button>
      {err && <span className="err" style={{ fontSize: "0.8rem" }}> {err}</span>}
    </div>
  );
}
