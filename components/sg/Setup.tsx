"use client";

// Create-a-group form: name, players, usual game type, and the group's default
// payout table. Payouts are a SCHEME dropdown (sgmahjong.club + your saved
// presets, or Custom) that fills a per-tai table with a Zimo (self-draw each)
// and a Shoot (shooter pays) column; every cell is editable. Bite & kong are
// flat amounts below. Whatever the table shows is exactly what gets charged.

import { useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { PayoutConfig, discardValue, zimoEachValue, money } from "@/lib/sg/payout";
import { GameType, PayoutPreset, BUILTIN_PRESETS } from "@/lib/sg/remote";
import { PayoutScaleInfo } from "./InfoDot";

type Row = { z: string; d: string }; // z = zimo (self-draw each), d = shoot (shooter pays)
const CUSTOM = "__custom__";
const MAXTAI_CAP = 20;

// Fill the table from a payout config (honours its per-tai tables / cap / doubling).
function fillRows(cfg: PayoutConfig, mt: number): Row[] {
  return Array.from({ length: mt }, (_, i) => ({
    z: money(zimoEachValue(cfg, i + 1)),
    d: money(discardValue(cfg, i + 1)),
  }));
}

export function Setup({
  title,
  presets,
  onStart,
  onBack,
  busy,
  error,
  startLabel,
  note,
}: {
  title: string;
  presets?: PayoutPreset[];
  onStart: (name: string, players: string[], bases: PayoutConfig, defaultType: GameType) => void;
  onBack: () => void;
  busy?: boolean;
  error?: string;
  startLabel?: string;
  note?: string;
}) {
  useBackButton(onBack);
  const [name, setName] = useState("");
  const [names, setNames] = useState(["", "", "", ""]);
  const [dtype, setDtype] = useState<GameType>("sg4"); // what this group usually plays

  // Scheme dropdown = builtins + your saved presets. Editing a cell flips it to
  // "Custom". The default group scheme is the first sgmahjong builtin.
  const schemes: PayoutPreset[] = [...BUILTIN_PRESETS, ...(presets || [])];
  const [scheme, setScheme] = useState(schemes[0].name);
  const [rows, setRows] = useState<Row[]>(() => fillRows(schemes[0].cfg, schemes[0].cfg.maxTai ?? 10));
  const [yao, setYao] = useState(money(schemes[0].cfg.yao ?? 0.1));
  const [gang, setGang] = useState(money(schemes[0].cfg.gang ?? 0.1));
  const [zbonus, setZbonus] = useState(money(schemes[0].cfg.zimoBonus ?? 0)); // flat self-draw bonus

  const num = (s: string) => parseFloat(s);
  const okNum = (s: string) => { const v = num(s); return isFinite(v) && v >= 0; };
  const mt = rows.length;

  // Pick a scheme from the dropdown: refill the whole table + flats from it.
  const pickScheme = (nm: string) => {
    haptic("selection");
    setScheme(nm);
    if (nm === CUSTOM) return; // keep the current numbers, just edit freely
    const s = schemes.find((x) => x.name === nm);
    if (!s) return;
    setRows(fillRows(s.cfg, s.cfg.maxTai ?? 10));
    setYao(money(s.cfg.yao ?? 0.1));
    setGang(money(s.cfg.gang ?? 0.1));
    setZbonus(money(s.cfg.zimoBonus ?? 0));
  };

  // Editing any cell means the table no longer matches a named scheme.
  const setCell = (i: number, k: "z" | "d", v: string) => {
    setScheme(CUSTOM);
    setRows((arr) => arr.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };

  // Grow/shrink the number of tai rows. New rows continue the doubling of the
  // last row so the table stays sensible; existing (possibly edited) rows stay.
  // Changing the row count deviates from a named scheme -> flip to Custom (also
  // makes re-picking that scheme from the dropdown a real change that reloads it).
  const setMaxTai = (n: number) => {
    setScheme(CUSTOM);
    const target = Math.max(1, Math.min(MAXTAI_CAP, Math.floor(n)));
    setRows((arr) => {
      if (target <= arr.length) return arr.slice(0, target);
      const next = arr.slice();
      let lastZ = num(next[next.length - 1]?.z) || 0.2;
      let lastD = num(next[next.length - 1]?.d) || 0.4;
      while (next.length < target) { lastZ *= 2; lastD *= 2; next.push({ z: money(lastZ), d: money(lastD) }); }
      return next;
    });
  };

  const rowsValid = rows.length >= 1 && rows.every((r) => okNum(r.z) && okNum(r.d));
  const ready = names.every((n) => n.trim()) && rowsValid;

  const submit = () => {
    // Store the table verbatim as per-tai tables so the charged amount always
    // equals exactly what's shown. tai/zimo (the 1-tai bases) are kept too for
    // display + back-compat.
    const zTab = rows.map((r) => num(r.z));
    const dTab = rows.map((r) => num(r.d));
    const cfg: PayoutConfig = {
      tai: dTab[0],
      zimo: zTab[0],
      yao: okNum(yao) ? num(yao) : 0.1,
      gang: okNum(gang) ? num(gang) : 0.1,
      zimoBonus: okNum(zbonus) ? num(zbonus) : 0,
      maxTai: mt,
      discardTable: dTab,
      zimoTable: zTab,
    };
    onStart(name.trim() || "Mahjong", names.map((n) => n.trim()), cfg, dtype);
  };

  return (
    <div>
      <h1>{title}</h1>
      {note && <p style={{ fontSize: "0.85rem", opacity: 0.75 }}>{note}</p>}
      <h2>Game name</h2>
      <input className="text-input" placeholder="e.g. Friday mahjong" value={name} onChange={(e) => setName(e.target.value)} />
      <h2>Players</h2>
      {names.map((n, i) => (
        <input key={i} className="text-input" placeholder={`Player ${i + 1}`} value={n}
          onChange={(e) => setNames((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} />
      ))}

      <h2>What does your group usually play?</h2>
      <div className="row">
        {[{ v: "sg4" as GameType, label: "Singaporean (4p)" }, { v: "my3" as GameType, label: "Malaysian (3p) — WIP" }].map((o) => (
          <div key={o.v} className={"chip" + (dtype === o.v ? " selected" : "")}
            onClick={() => { haptic("selection"); setDtype(o.v); }}>{o.label}</div>
        ))}
      </div>

      <h2>Default payouts</h2>
      <p style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: -4 }}>
        Pick a scheme to fill the table, then edit any amount. Whatever the table shows is what gets charged.
        These prefill each session (a session can still change them when it starts).
      </p>

      <label className="vlabel" style={{ marginBottom: 8 }}>Payout scheme
        <select className="text-input" value={scheme} onChange={(e) => pickScheme(e.target.value)}>
          {schemes.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          <option value={CUSTOM}>Custom</option>
        </select>
      </label>

      <h2 className="info-head">Bite, kong &amp; self-draw bonus <PayoutScaleInfo /></h2>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="vlabel">bite (yao)
          <input className="text-input small" inputMode="decimal" value={yao}
            onChange={(e) => { setYao(e.target.value); setScheme(CUSTOM); }} />
          <span className="unit">per pax</span></label>
        <label className="vlabel">kong (gang)
          <input className="text-input small" inputMode="decimal" value={gang}
            onChange={(e) => { setGang(e.target.value); setScheme(CUSTOM); }} />
          <span className="unit">per pax</span></label>
        <label className="vlabel">self-draw (zimo) bonus
          <input className="text-input small" inputMode="decimal" value={zbonus}
            onChange={(e) => { setZbonus(e.target.value); setScheme(CUSTOM); }} />
          <span className="unit">per pax</span></label>
      </div>
      <div className="row" style={{ alignItems: "center", gap: 6, marginTop: 4, marginBottom: 4 }}>
        <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>Self-draw bonus · frequently used</span>
        {[2, 3, 5].map((v) => (
          <div key={v} className="chip" onClick={() => { setZbonus(money(v)); setScheme(CUSTOM); }}>{`$${v}`}</div>
        ))}
      </div>

      {/* Per-tai table: Tai | Zimo (self-draw each) | Shoot (shooter pays) */}
      <div className="pay-table">
        <div className="pay-row pay-head">
          <span className="pay-tai">tai</span>
          <span>Zimo <small>(self-draw, each)</small></span>
          <span>Shoot <small>(shooter pays)</small></span>
        </div>
        {rows.map((r, i) => (
          <div className="pay-row" key={i}>
            <span className="pay-tai">{i + 1}</span>
            <input className={"text-input small" + (okNum(r.z) ? "" : " bad")} inputMode="decimal"
              value={r.z} onChange={(e) => setCell(i, "z", e.target.value)} />
            <input className={"text-input small" + (okNum(r.d) ? "" : " bad")} inputMode="decimal"
              value={r.d} onChange={(e) => setCell(i, "d", e.target.value)} />
          </div>
        ))}
      </div>
      <div className="row" style={{ alignItems: "center", gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>Max tai</span>
        <button type="button" className="chip" onClick={() => setMaxTai(mt - 1)} disabled={mt <= 1}>−</button>
        <span style={{ minWidth: 20, textAlign: "center" }}>{mt}</span>
        <button type="button" className="chip" onClick={() => setMaxTai(mt + 1)} disabled={mt >= MAXTAI_CAP}>+</button>
      </div>

      <p style={{ fontSize: "0.78rem", opacity: 0.6 }}>
        Zimo is what EACH other player pays on a self-draw (plus the self-draw bonus, if set); Shoot is what
        the single discarder pays. Bite &amp; kong are a flat amount each other player pays.
      </p>

      <button className="primary-btn" disabled={!ready || busy} onClick={submit}>
        {busy ? "Creating…" : startLabel || "Start game"}
      </button>
      {error && <p className="err">{error}</p>}
      {!rowsValid && <p className="err">Every tai needs a Zimo and Shoot amount (numbers, 0 or more).</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
