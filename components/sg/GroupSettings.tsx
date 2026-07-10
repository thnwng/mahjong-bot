"use client";

// Per-group settings menu. Tab strip; the "Scoring" subtab lists every tai
// hand (from the shared taiCatalog) with a dropdown value — 0-10, Max tai (限),
// or Special (限+1). Each group stores its own scoring, keyed by group code,
// seeded from the shared DEFAULTS (the same values the standalone tai page
// shows). Offline-tester storage is a plain localStorage map; a live port would
// move this into the group row (tracker) so it syncs to every member.

import { useEffect, useState } from "react";
import { useBackButton } from "@/lib/telegram";
import { BOT_APP_LINK } from "@/lib/sg/remote";
import {
  Hand, Demo, STANDARD, EVENTS, FLOWERS, SPECIAL, TAI_HANDS, TAI_OPTIONS,
} from "./taiCatalog";

const STORE = "sgTaiGroups_v1";
type Store = Record<string, Record<string, string>>; // code -> { handId -> value }

const TAI_DEFAULTS: Record<string, string> = Object.fromEntries(TAI_HANDS.map((h) => [h.id, h.def]));

function loadAll(): Store {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* corrupt -> defaults */
  }
  return {};
}

export default function GroupSettings({ code, name, onBack }: { code: string; name: string; onBack: () => void }) {
  useBackButton(onBack);
  const [tab, setTab] = useState<"scoring" | "about">("scoring");
  const [values, setValues] = useState<Record<string, string>>(TAI_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // Hydrate this group's scoring after mount.
  useEffect(() => {
    const mine = loadAll()[code];
    if (mine) setValues({ ...TAI_DEFAULTS, ...mine });
    setLoaded(true);
  }, [code]);

  // Persist just this group's entry, leaving other groups' scoring untouched.
  useEffect(() => {
    if (!loaded) return;
    try {
      const all = loadAll();
      all[code] = values;
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch {
      /* ignore quota */
    }
  }, [values, loaded, code]);

  const setVal = (id: string, v: string) => setValues((m) => ({ ...m, [id]: v }));
  const resetAll = () => setValues(TAI_DEFAULTS);

  // Always show the current value as an option even if it's outside 0–10/限/限+1.
  const optionsFor = (v: string) =>
    TAI_OPTIONS.some((o) => o.value === v) ? TAI_OPTIONS : [{ value: v, label: v }, ...TAI_OPTIONS];

  const card = (h: Hand) => {
    const v = values[h.id] ?? h.def;
    return (
      <div key={h.id} className="hand-card">
        <div className="hand-top">
          <div>
            <span className="hand-name">{h.en}</span>
            <span className="hand-zh">{h.zh}{h.py ? ` · ${h.py}` : ""}</span>
          </div>
          <div className="hand-tai">
            <select
              className="text-input tai-sel"
              value={v}
              onChange={(e) => setVal(h.id, e.target.value)}
              aria-label={`${h.en} tai`}
            >
              {optionsFor(v).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <Demo segs={h.demo} />
        {h.note && <p className="fine" style={{ margin: 0 }}>{h.note}</p>}
      </div>
    );
  };

  const shareLink = `${BOT_APP_LINK}?startapp=${code}`;

  return (
    <div>
      <h1>{name} <small>settings</small></h1>

      <div className="tabs">
        <button type="button" className={"tab" + (tab === "scoring" ? " on" : "")} onClick={() => setTab("scoring")}>Scoring</button>
        <button type="button" className={"tab" + (tab === "about" ? " on" : "")} onClick={() => setTab("about")}>About</button>
      </div>

      {tab === "scoring" ? (
        <>
          <p className="hint">
            The tai each winning hand is worth in <strong>{name}</strong>. Pick a number 0–10,
            <strong> Max tai (限)</strong> for the agreed limit, or <strong>Special (限+1)</strong> for one
            above it. Saved for this group only.
          </p>

          <h2>Standard hands</h2>
          <div className="hand-list">{STANDARD.map(card)}</div>

          <h2>Bonus events <small>+ tai on top of the hand</small></h2>
          <div className="hand-list">{EVENTS.map(card)}</div>

          <h2>Flowers &amp; animals</h2>
          <div className="hand-list">{FLOWERS.map(card)}</div>

          <h2>Special &amp; limit hands</h2>
          <div className="hand-list">{SPECIAL.map(card)}</div>

          <div style={{ marginTop: 18 }}>
            <button className="link-btn" onClick={resetAll}>Reset to defaults</button>
          </div>
        </>
      ) : (
        <>
          <div className="result banner">
            <div className="line"><strong>Code {code}</strong></div>
            <div className="line meta" style={{ wordBreak: "break-all" }}>{shareLink}</div>
            <div className="line meta">Share this link (or the code) so others can join.</div>
          </div>
          <p className="hint">
            More per-group settings will live here. For now, <strong>Scoring</strong> is the main one —
            each group can run its own tai values.
          </p>
        </>
      )}

      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
