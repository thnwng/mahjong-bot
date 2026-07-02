"use client";

// Create-a-group form: name, players, and the payout table for the session.

import { useEffect, useState } from "react";
import { useBackButton } from "@/lib/telegram";
import { PayoutConfig, discardValue, zimoEachValue, money } from "@/lib/sg/payout";

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
  onStart: (name: string, players: string[], bases: PayoutConfig) => void;
  onBack: () => void;
  busy?: boolean;
  error?: string;
  startLabel?: string;
  note?: string;
}) {
  useBackButton(onBack);
  const [name, setName] = useState("");
  const [names, setNames] = useState(["", "", "", ""]);
  // Payouts (per session). discard = what a single shooter pays at 1 tai;
  // zimo = what EACH other player pays on a self-draw at 1 tai. Both double per
  // tai. Defaults follow the sgmahjong.club 10¢/20¢ table (self-draw = half the
  // shooter; bite & kong a flat 0.10). Blank self-draw falls back to 2× shooter.
  const [discard, setDiscard] = useState("0.40");
  const [zimo, setZimo] = useState("0.20");
  const [yao, setYao] = useState("0.10");
  const [gang, setGang] = useState("0.10");
  const [maxTai, setMaxTai] = useState("10");
  const [advanced, setAdvanced] = useState(false);
  const [cap, setCap] = useState("");
  const [customOn, setCustomOn] = useState(false);
  const [rows, setRows] = useState<{ d: string; z: string }[]>([]);

  const num = (s: string, d: number) => { const v = parseFloat(s); return isFinite(v) ? v : d; };
  const pos = (s: string, d: number) => { const v = parseFloat(s); return isFinite(v) && v >= 0 ? v : d; };
  const shooter = pos(discard, 0.1);          // discard base; must be > 0
  const selfDraw = pos(zimo, shooter * 2);    // blank -> auto 2× shooter (house rule)
  const ready = names.every((n) => n.trim()) && shooter > 0;
  const mt = Math.max(1, Math.min(20, Math.floor(num(maxTai, 10))));
  const capN = Math.floor(num(cap, mt));
  const useCap = cap.trim() !== "" && capN >= 1 && capN < mt;

  // A config built from the current fields (without custom tables) — used to
  // show the doubling preview/placeholders.
  const previewCfg: PayoutConfig = {
    tai: shooter, zimo: selfDraw,
    yao: pos(yao, 0.1), gang: pos(gang, 0.1), maxTai: mt, ...(useCap ? { cap: capN } : {}),
  };

  // Keep the per-tai custom rows in sync with max tai (drop hidden stale rows).
  useEffect(() => { setRows((arr) => (arr.length > mt ? arr.slice(0, mt) : arr)); }, [mt]);

  const setRow = (i: number, k: "d" | "z", v: string) =>
    setRows((arr) => {
      const next = arr.slice();
      while (next.length < mt) next.push({ d: "", z: "" });
      next[i] = { ...next[i], [k]: v };
      return next;
    });

  const usePreset = () => {
    // sgmahjong.club 10¢/20¢: shooter $0.40 / self-draw each $0.20 at 1 tai,
    // doubling to 10 tai; bite & kong $0.10.
    setDiscard("0.40"); setZimo("0.20"); setYao("0.10"); setGang("0.10");
    setMaxTai("10"); setAdvanced(false); setCap(""); setCustomOn(false); setRows([]);
  };

  const submit = () => {
    const cfg: PayoutConfig = {
      tai: shooter,
      zimo: selfDraw,
      yao: pos(yao, 0.1),
      gang: pos(gang, 0.1),
      maxTai: mt,
    };
    if (useCap) cfg.cap = capN;
    if (customOn) {
      const col = (k: "d" | "z") =>
        Array.from({ length: mt }, (_, i) => {
          const raw = rows[i]?.[k]?.trim();
          if (!raw) return null;
          const v = parseFloat(raw);
          return isFinite(v) && v >= 0 ? v : null;
        });
      const dTab = col("d");
      const zTab = col("z");
      if (dTab.some((v) => v != null)) cfg.discardTable = dTab;
      if (zTab.some((v) => v != null)) cfg.zimoTable = zTab;
    }
    onStart(name.trim() || "Mahjong", names.map((n) => n.trim()), cfg);
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

      <h2>Payouts</h2>
      <p style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: -4 }}>
        Defaults follow the sgmahjong.club table. Win values are at 1 tai and double each tai;
        bite &amp; kong are flat. Change them to match your table.
      </p>
      <div className="row" style={{ alignItems: "center" }}>
        <label className="vlabel">shooter pays<input className="text-input small" inputMode="decimal" min="0" value={discard} onChange={(e) => setDiscard(e.target.value)} /></label>
        <label className="vlabel">self-draw (each)<input className="text-input small" inputMode="decimal" min="0" placeholder={money(shooter * 2)} value={zimo} onChange={(e) => setZimo(e.target.value)} /></label>
        <label className="vlabel">max tai<input className="text-input small" inputMode="numeric" min="1" value={maxTai} onChange={(e) => setMaxTai(e.target.value)} /></label>
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <label className="vlabel">bite (yao)<input className="text-input small" inputMode="decimal" min="0" value={yao} onChange={(e) => setYao(e.target.value)} /></label>
        <label className="vlabel">kong (gang)<input className="text-input small" inputMode="decimal" min="0" value={gang} onChange={(e) => setGang(e.target.value)} /></label>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>
        e.g. 1 tai → shooter pays {money(discardValue(previewCfg, 1))}, self-draw {money(zimoEachValue(previewCfg, 1))} each ·
        {" "}{mt} tai → {money(discardValue(previewCfg, mt))} / {money(zimoEachValue(previewCfg, mt))}
      </p>
      <p style={{ fontSize: "0.78rem", opacity: 0.6 }}>
        On sgmahjong.club the self-draw amount is half the shooter (3 people pay it). Leave self-draw blank to use
        2× the shooter instead (the classic rule). “Max tai” is the highest tai you can pick; bigger wins are
        charged at the max-tai amount. Bite &amp; kong are a flat amount each other player pays.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="chip" onClick={usePreset}>Reset to sgmahjong.club (10¢/20¢)</button>
        <button type="button" className="chip" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Hide advanced" : "Advanced…"}</button>
      </div>

      {advanced && (
        <div style={{ marginTop: 10 }}>
          <label className="vlabel">doubling cap (tai where value stops doubling — blank = max tai)
            <input className="text-input small" inputMode="numeric" placeholder={String(mt)} value={cap} onChange={(e) => setCap(e.target.value)} />
          </label>
          <div className="row" style={{ alignItems: "center", marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
              <input type="checkbox" checked={customOn} onChange={(e) => setCustomOn(e.target.checked)} />
              Type the exact amount for each tai (overrides doubling)
            </label>
          </div>
          {customOn && (
            <div style={{ marginTop: 6 }}>
              <div className="row" style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                <span style={{ width: 48 }}>tai</span><span style={{ flex: 1 }}>shooter</span><span style={{ flex: 1 }}>self-draw each</span>
              </div>
              {Array.from({ length: mt }, (_, i) => (
                <div key={i} className="row" style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ width: 48 }}>{i + 1}</span>
                  <input className="text-input small" style={{ flex: 1 }} inputMode="decimal"
                    placeholder={money(discardValue(previewCfg, i + 1))}
                    value={rows[i]?.d ?? ""} onChange={(e) => setRow(i, "d", e.target.value)} />
                  <input className="text-input small" style={{ flex: 1 }} inputMode="decimal"
                    placeholder={money(zimoEachValue(previewCfg, i + 1))}
                    value={rows[i]?.z ?? ""} onChange={(e) => setRow(i, "z", e.target.value)} />
                </div>
              ))}
              <p style={{ fontSize: "0.78rem", opacity: 0.6 }}>Blank rows fall back to the doubling values above.</p>
            </div>
          )}
        </div>
      )}

      <button className="primary-btn" disabled={!ready || busy} onClick={submit}>
        {busy ? "Creating…" : startLabel || "Start game"}
      </button>
      {error && <p className="err">{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
