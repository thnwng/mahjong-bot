"use client";

// SG / Malaysian mahjong — standalone winning-combinations reference & tai table.
//
// The GLOBAL reference list: every scoring hand type shown schematically, with
// an editable tai value + a per-hand "note for me" field. The hand catalog and
// defaults live in ./taiCatalog (shared with each group's GroupSettings). Values
// here persist under their own key and act as the master defaults new groups
// start from.

import { useEffect, useState } from "react";
import { useBackButton } from "@/lib/telegram";
import {
  Hand, Demo, STANDARD, EVENTS, FLOWERS, SPECIAL, INSTANT, DEFAULTS, SEATS,
} from "./taiCatalog";
import { IconBack, IconRestart } from "./icons";

const STORE = "sgTai_v1";

type Saved = { values: Record<string, string>; xg: { on: boolean; seat: string }; notes?: Record<string, string> };

export default function SGTaiHands({ onBack }: { onBack: () => void }) {
  useBackButton(onBack);
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [xg, setXg] = useState<{ on: boolean; seat: string }>({ on: false, seat: "E" });
  // Per-hand freeform notes the player types for me (Claude) to read back and
  // process — house-rule tweaks, corrections, questions — keyed by hand id.
  // Persisted so it survives reloads and I can read it from the running preview.
  // Kept out of resetAll (resetting the tai values shouldn't wipe your notes).
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  // Hydrate from localStorage after mount (keeps prerender === first render).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        if (s.values) setValues({ ...DEFAULTS, ...s.values });
        if (s.xg) setXg(s.xg);
        if (s.notes && typeof s.notes === "object") setNotes(s.notes);
      }
    } catch {
      /* ignore corrupt storage */
    }
    setLoaded(true);
  }, []);

  // Persist on change (only after the initial hydrate).
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ values, xg, notes } satisfies Saved));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [values, xg, notes, loaded]);

  const setVal = (id: string, v: string) => setValues((m) => ({ ...m, [id]: v }));
  const setNote = (id: string, v: string) => setNotes((m) => ({ ...m, [id]: v }));
  const resetAll = () => {
    setValues(DEFAULTS);
    setXg({ on: false, seat: "E" });
  };

  // A per-hand note the player types for me to read and act on.
  const noteField = (id: string, label: string) => (
    <input
      className="text-input hand-inp"
      value={notes[id] ?? ""}
      onChange={(e) => setNote(id, e.target.value)}
      placeholder="note for me…"
      aria-label={`${label} note`}
    />
  );

  const card = (h: Hand, unit: string) => (
    <div key={h.id} className="hand-card">
      <div className="hand-top">
        <div>
          <span className="hand-name">{h.en}</span>
          <span className="hand-zh">{h.zh}{h.py ? ` · ${h.py}` : ""}</span>
        </div>
        <div className="hand-tai">
          <input
            className="text-input tai-in"
            value={values[h.id] ?? ""}
            onChange={(e) => setVal(h.id, e.target.value)}
            aria-label={`${h.en} value`}
            inputMode="text"
          />
          <span className="unit">{unit}</span>
        </div>
      </div>
      <Demo segs={h.demo} />
      {h.note && <p className="fine" style={{ margin: 0 }}>{h.note}</p>}
      {noteField(h.id, h.en)}
    </div>
  );

  return (
    <div>
      <h1>Winning hands <small>SG tai table</small></h1>
      <p className="hint">
        Every scoring hand type in Singaporean mahjong. These are the <strong>master defaults</strong> new
        groups start from — set the tai each is worth, where <strong>限</strong> is the agreed limit
        (typically 5) and <strong>限+1</strong> is one above. Each card also has a
        <strong> note for me</strong> field — type anything there (a house-rule tweak, a correction,
        a question) and tell me to read your notes.
      </p>

      <h2>Standard hands</h2>
      <div className="hand-list">{STANDARD.map((h) => card(h, "tai"))}</div>

      <h2>Bonus events <small>+ tai on top of the hand</small></h2>
      <div className="hand-list">{EVENTS.map((h) => card(h, "tai"))}</div>

      <h2>Flowers &amp; animals</h2>
      <div className="hand-list">{FLOWERS.map((h) => card(h, "tai"))}</div>

      <h2>Special &amp; limit hands</h2>
      <div className="hand-list">{SPECIAL.map((h) => card(h, "tai"))}</div>

      <h2>Instant payments &amp; self-pick</h2>
      <p className="fine">
        One-time payouts and the self-pick modifier — separate from a hand&apos;s tai.
      </p>
      <div className="hand-list">
        {INSTANT.map((i) => (
          <div key={i.id} className="hand-card">
            <div className="hand-top">
              <div>
                <span className="hand-name">{i.en}</span>
                <span className="hand-zh">{i.zh}{i.py ? ` · ${i.py}` : ""}</span>
              </div>
              <div className="hand-tai">
                {i.unit === "$" ? (
                  <>
                    <input
                      className="text-input tai-in"
                      value={values[i.id] ?? ""}
                      onChange={(e) => setVal(i.id, e.target.value)}
                      aria-label={`${i.en} payout`}
                      inputMode="numeric"
                    />
                    <span className="unit">$</span>
                  </>
                ) : (
                  <span className="unit" style={{ fontFamily: "var(--font-mono)" }}>{i.def}</span>
                )}
              </div>
            </div>
            <p className="fine" style={{ margin: 0 }}>{i.note}</p>
            {noteField(i.id, i.en)}
          </div>
        ))}
      </div>

      {/* 乱相公 (dead hand) pays on behalf of everyone for these events. */}
      <div className="scenario-box">
        <label className="check-row">
          <input
            type="checkbox"
            checked={xg.on}
            onChange={(e) => setXg((s) => ({ ...s, on: e.target.checked }))}
          />
          <span>乱相公 — a player has a dead hand (小相公 short / 大相公 long)</span>
        </label>
        {xg.on && (
          <div style={{ marginTop: 10 }}>
            <label className="vlabel">
              Offending player
              <select
                className="text-input"
                value={xg.seat}
                onChange={(e) => setXg((s) => ({ ...s, seat: e.target.value }))}
              >
                {SEATS.map((s) => (
                  <option key={s.k} value={s.k}>{s.label}</option>
                ))}
              </select>
            </label>
            <p className="fine" style={{ margin: "4px 0 0" }}>
              For the 咬到 / 杠 / 自摸 payments above, <strong>{SEATS.find((s) => s.k === xg.seat)?.label}</strong> pays
              on behalf of every player who would otherwise owe — they cover all the shares.
            </p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 16, alignItems: "center" }}>
        <button className="link-btn with-ico" onClick={onBack}><IconBack />Back</button>
        <button className="link-btn with-ico" onClick={resetAll}><IconRestart />Reset to defaults</button>
      </div>
    </div>
  );
}
