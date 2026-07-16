"use client";

// Per-group settings menu. Tab strip; the "Scoring" subtab lists every tai hand
// (from the shared taiCatalog) with a dropdown value — 0-10, Max tai (限), or
// Special (限+1). Scoring is stored ON THE GROUP (trackers.tai_scores) so every
// member shares one config: loaded read-only via getState, saved with an
// explicit Save button (one write, not a call per dropdown change — the Supabase
// free tier). Seeded from the shared DEFAULTS when the group has none yet.

import { useEffect, useState } from "react";
import { useBackButton, haptic } from "@/lib/telegram";
import { BOT_APP_LINK, getState, setGroupTai, settleAll } from "@/lib/sg/remote";
import {
  Hand, Demo, STANDARD, EVENTS, FLOWERS, SPECIAL, TAI_HANDS, TAI_OPTIONS,
} from "./taiCatalog";
import { IconBack, IconRefresh, IconRestart } from "./icons";

const TAI_DEFAULTS: Record<string, string> = Object.fromEntries(TAI_HANDS.map((h) => [h.id, h.def]));
const errMsg = (e: unknown) => String((e as Error)?.message || e);

export default function GroupSettings({ code, name, onBack }: { code: string; name: string; onBack: () => void }) {
  useBackButton(onBack);
  const [tab, setTab] = useState<"about" | "scoring">("about");
  const [settleState, setSettleState] = useState<"" | "confirm" | "busy" | "done">("");
  const [settleErr, setSettleErr] = useState(""); // separate from the scoring-load `err`
  const [values, setValues] = useState<Record<string, string>>(TAI_DEFAULTS);
  const [saved, setSaved] = useState<Record<string, string>>(TAI_DEFAULTS); // last-persisted snapshot
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "error">("loading");
  const [err, setErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Load this group's scoring from the server (read-only "state" op — no join).
  // On failure go to a TERMINAL 'error' state that keeps the form disabled — never
  // let the user edit + Save from an unknown baseline, or a failed load would
  // overwrite the group's real (possibly customized) scoring with defaults.
  useEffect(() => {
    let alive = true;
    setStatus("loading"); setErr("");
    getState(code)
      .then((st) => {
        if (!alive) return;
        const s = { ...TAI_DEFAULTS, ...(st.tracker.tai_scores || {}) };
        setValues(s); setSaved(s); setStatus("idle");
      })
      .catch((e) => { if (alive) { setErr(errMsg(e)); setStatus("error"); } });
    return () => { alive = false; };
  }, [code, reloadKey]);

  const dirty = TAI_HANDS.some((h) => (values[h.id] ?? h.def) !== (saved[h.id] ?? h.def));

  const setVal = (id: string, v: string) => setValues((m) => ({ ...m, [id]: v }));
  const resetDefaults = () => setValues(TAI_DEFAULTS);

  const save = async () => {
    setStatus("saving"); setErr(""); haptic("light");
    try {
      const st = await setGroupTai(code, values);
      const s = { ...TAI_DEFAULTS, ...(st.tracker.tai_scores || {}) };
      setValues(s); setSaved(s); setStatus("idle"); haptic("success");
    } catch (e) {
      // Save failure is safe: the edits stay in the form, so we return to 'idle'
      // (editable, Save enabled) — no clobbering happened.
      setErr(errMsg(e)); setStatus("idle"); haptic("error");
    }
  };

  // Settle every outstanding debt at once (two-tap confirm).
  const doSettleAll = async () => {
    if (settleState !== "confirm") { setSettleState("confirm"); haptic("warning"); return; }
    setSettleState("busy"); setSettleErr(""); haptic("light");
    try { await settleAll(code); setSettleState("done"); haptic("success"); }
    catch (e) { setSettleErr(errMsg(e)); setSettleState(""); haptic("error"); }
  };

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
              disabled={status !== "idle"}
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
        <button type="button" className={"tab" + (tab === "about" ? " on" : "")} onClick={() => setTab("about")}>About</button>
        <button type="button" className={"tab" + (tab === "scoring" ? " on" : "")} onClick={() => setTab("scoring")}>Scoring</button>
      </div>

      {tab === "scoring" ? (
        status === "error" ? (
          <>
            <p className="err">Couldn&apos;t load this group&apos;s scoring — {err}</p>
            <p className="hint">Not editing until it loads, so nothing gets overwritten.</p>
            <button className="chip with-ico" onClick={() => setReloadKey((k) => k + 1)}><IconRefresh />Retry</button>
          </>
        ) : (
          <>
            <p className="hint">
              The tai each winning hand is worth in <strong>{name}</strong>, shared by everyone in the
              group. Pick a number 0–10, <strong>Max tai (限)</strong> for the agreed limit, or
              <strong> Special (限+1)</strong> for one above it.
            </p>
            {status === "loading" && <p className="fine">Loading this group&apos;s scoring…</p>}
            {err && <p className="err">{err}</p>}

            <h2>Standard hands</h2>
            <div className="hand-list">{STANDARD.map(card)}</div>

            <h2>Bonus events <small>+ tai on top of the hand</small></h2>
            <div className="hand-list">{EVENTS.map(card)}</div>

            <h2>Flowers &amp; animals</h2>
            <div className="hand-list">{FLOWERS.map(card)}</div>

            <h2>Special &amp; limit hands</h2>
            <div className="hand-list">{SPECIAL.map(card)}</div>

            <div style={{ marginTop: 18 }}>
              <button className="link-btn with-ico" onClick={resetDefaults} disabled={status !== "idle"}><IconRestart />Reset to defaults</button>
            </div>

            {/* Fixed Save button — one write for the whole map, enabled only when changed. */}
            <button className="primary-btn" disabled={!dirty || status !== "idle"} onClick={save}>
              {status === "saving" ? "Saving…" : dirty ? "Save scoring" : "Saved"}
            </button>
          </>
        )
      ) : (
        <>
          <div className="result banner">
            <div className="line"><strong>Code {code}</strong></div>
            <div className="line meta" style={{ wordBreak: "break-all" }}>{shareLink}</div>
            <div className="line meta">Share this link (or the code) so others can join.</div>
          </div>

          <h2>Debts</h2>
          <p className="fine">
            Record a repayment for every outstanding &ldquo;who owes who&rdquo; line at once, clearing the
            group&apos;s debt counter to zero.
          </p>
          {settleState === "done" ? (
            <p className="hint">All debts settled.</p>
          ) : (
            <button className="chip" disabled={settleState === "busy"} onClick={doSettleAll}>
              {settleState === "busy" ? "Settling…" : settleState === "confirm" ? "Tap again to settle all" : "Settle all debts"}
            </button>
          )}
          {settleErr && <p className="err">{settleErr}</p>}

          <h2>More</h2>
          <p className="hint">
            <strong>Scoring</strong> (next tab) is the main per-group setting — each group runs its own tai
            values, shared by all its members.
          </p>
        </>
      )}

      <button className="link-btn with-ico" onClick={onBack}><IconBack />Back</button>
    </div>
  );
}
