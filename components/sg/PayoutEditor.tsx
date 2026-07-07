"use client";

// The per-session payout editor: a scheme dropdown (built-in tables + your saved
// presets, or Custom) that fills an editable per-tai table (Zimo = self-draw
// each, Shoot = shooter pays), plus flat bite/gang and a self-draw bonus.
// Whatever the table shows is exactly what gets charged. Extracted so the
// session-start screen owns payouts (they used to live at group creation). The
// built config is reported up via onChange — null while any field is invalid.

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/telegram";
import { PayoutConfig, discardValue, zimoEachValue, money } from "@/lib/sg/payout";
import { PayoutPreset, BUILTIN_PRESETS } from "@/lib/sg/remote";
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

export function PayoutEditor({
  presets,
  onChange,
}: {
  presets?: PayoutPreset[];
  onChange: (cfg: PayoutConfig | null) => void;
}) {
  const schemes: PayoutPreset[] = [...BUILTIN_PRESETS, ...(presets || [])];
  const [scheme, setScheme] = useState(schemes[0].name);
  const [rows, setRows] = useState<Row[]>(() => fillRows(schemes[0].cfg, schemes[0].cfg.maxTai ?? 10));
  const [yao, setYao] = useState(money(schemes[0].cfg.yao ?? 0.1));
  const [gang, setGang] = useState(money(schemes[0].cfg.gang ?? 0.1));
  const [zbonus, setZbonus] = useState(money(schemes[0].cfg.zimoBonus ?? 0)); // flat self-draw bonus

  const num = (s: string) => parseFloat(s);
  const okNum = (s: string) => { const v = num(s); return isFinite(v) && v >= 0; };
  const mt = rows.length;
  const rowsValid = rows.length >= 1 && rows.every((r) => okNum(r.z) && okNum(r.d));

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

  // Grow/shrink the tai rows; new rows continue the doubling of the last row.
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

  // Report the built config upward on every change. The ref keeps a fresh parent
  // callback without re-running the effect when the parent re-renders.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!rowsValid) { onChangeRef.current(null); return; }
    const zTab = rows.map((r) => num(r.z));
    const dTab = rows.map((r) => num(r.d));
    onChangeRef.current({
      tai: dTab[0],
      zimo: zTab[0],
      yao: okNum(yao) ? num(yao) : 0.1,
      gang: okNum(gang) ? num(gang) : 0.1,
      zimoBonus: okNum(zbonus) ? num(zbonus) : 0,
      maxTai: rows.length,
      discardTable: dTab,
      zimoTable: zTab,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, yao, gang, zbonus]);

  return (
    <div>
      <p style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: -4 }}>
        Pick a scheme to fill the table, then edit any amount. Whatever the table shows is exactly what gets charged.
      </p>
      <label className="vlabel" style={{ marginBottom: 8 }}>Payout scheme
        <select className="text-input" value={scheme} onChange={(e) => pickScheme(e.target.value)}>
          {schemes.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          <option value={CUSTOM}>Custom</option>
        </select>
      </label>

      <h2 className="info-head">Bite, gang &amp; self-draw bonus <PayoutScaleInfo /></h2>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="vlabel">bite (yao)
          <input className="text-input small" inputMode="decimal" value={yao}
            onChange={(e) => { setYao(e.target.value); setScheme(CUSTOM); }} />
          <span className="unit">per pax</span></label>
        <label className="vlabel">gang (kong)
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
        the single discarder pays. Bite &amp; gang are a flat amount each other player pays.
      </p>
      {!rowsValid && <p className="err">Every tai needs a Zimo and Shoot amount (numbers, 0 or more).</p>}
    </div>
  );
}
