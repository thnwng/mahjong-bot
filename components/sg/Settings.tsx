"use client";

// Settings tab: change your display name and which mahjong types the home screen
// offers. Payout presets are saved from the session-setup screen; managing
// (renaming/deleting) them here is still WIP.

import { useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { Profile, setDisplayName, setPrefs, GameType, validDisplayName, NAME_MAX, NAME_HINT } from "@/lib/sg/remote";
import { GameTypeChecklist } from "./Identity";

export function Settings({
  profile,
  onProfile,
  onBack,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const [name, setName] = useState(profile.username);
  const [nameErr, setNameErr] = useState("");
  const [nameMsg, setNameMsg] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [types, setTypes] = useState<GameType[]>(profile.gameTypes || ["sg4"]);
  const [typesErr, setTypesErr] = useState("");
  const [typesMsg, setTypesMsg] = useState("");
  const [savingTypes, setSavingTypes] = useState(false);

  const saveName = async () => {
    const nm = name.trim();
    setNameMsg("");
    if (nm === profile.username) { setNameErr(""); return; }
    if (!validDisplayName(nm)) { setNameErr(NAME_HINT); return; }
    setSavingName(true); setNameErr("");
    try {
      const { profile: p } = await setDisplayName(nm);
      haptic("success"); setNameMsg("Saved.");
      onProfile({ ...profile, ...p });
    } catch (e) { haptic("error"); setNameErr(String((e as Error).message || e)); }
    finally { setSavingName(false); }
  };

  const saveTypes = async () => {
    setTypesMsg("");
    if (!types.length) { setTypesErr("Pick at least one."); return; }
    setSavingTypes(true); setTypesErr("");
    try {
      const { gameTypes } = await setPrefs(types);
      haptic("success"); setTypesMsg("Saved.");
      onProfile({ ...profile, gameTypes });
    } catch (e) { haptic("error"); setTypesErr(String((e as Error).message || e)); }
    finally { setSavingTypes(false); }
  };

  return (
    <div>
      <h1>Settings</h1>

      <h2>Display name</h2>
      <p style={{ opacity: 0.7, fontSize: "0.82rem", marginTop: 0 }}>
        How you show up across the app. Typing a custom one stops it mirroring your Telegram name. Doesn&apos;t have to be unique.
      </p>
      <input className="text-input" value={name} maxLength={NAME_MAX}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveName(); }} />
      <div className="row">
        <button className="chip" disabled={savingName} onClick={saveName}>{savingName ? "Saving…" : "Save name"}</button>
        {nameMsg && <span style={{ fontSize: "0.85rem", opacity: 0.7, alignSelf: "center" }}>{nameMsg}</span>}
      </div>
      {nameErr && <p className="err">{nameErr}</p>}

      <h2>Mahjong types</h2>
      <p style={{ opacity: 0.7, fontSize: "0.82rem", marginTop: 0 }}>
        What the home screen offers you.
      </p>
      <GameTypeChecklist value={types} onChange={setTypes} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="chip" disabled={savingTypes || !types.length} onClick={saveTypes}>
          {savingTypes ? "Saving…" : "Save types"}
        </button>
        {typesMsg && <span style={{ fontSize: "0.85rem", opacity: 0.7, alignSelf: "center" }}>{typesMsg}</span>}
      </div>
      {typesErr && <p className="err">{typesErr}</p>}

      <h2>Payout presets</h2>
      <p style={{ opacity: 0.7, fontSize: "0.82rem", marginTop: 0 }}>
        {profile.presets?.length
          ? `You have ${profile.presets.length} saved: ${profile.presets.map((p) => p.name).join(", ")}.`
          : "None saved yet."}
        {" "}Presets are saved from the start-session screen when you tweak the numbers. Managing them here is coming soon (WIP).
      </p>

      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
