"use client";

import { useEffect, useMemo, useState } from "react";
import { analyze, WinContext, CalledMeld } from "@/lib/riichi/analyze";
import ResultCard from "./ResultCard";

// Tile images (Japanese / Riichi set) served from public/tiles/jp. The file
// name is the engine code with a "jp" prefix (jp1C.png, jpEW.png, ...). basePath
// is prefixed so assets resolve both locally ("") and on GitHub Pages
// ("/mahjong-bot"). Swap TILE_BASE / prefix to use a different tile art set.
const TILE_BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/tiles/jp/";
const tileSrc = (code: string) => `${TILE_BASE}jp${code}.png`;

function TileImg({ code, className }: { code: string; className?: string }) {
  // Plain <img> is intentional: the app is a static export (next/image's loader
  // is disabled via images.unoptimized) and these are tiny local PNGs.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={"tile-img" + (className ? " " + className : "")} src={tileSrc(code)} alt={code} draggable={false} />;
}

const SUITS = ["C", "D", "B"];
const HONORS = ["EW", "SW", "WW", "NW", "WD", "GD", "RD"];

const WINDS: [string, string][] = [
  ["EW", "East"], ["SW", "South"], ["WW", "West"], ["NW", "North"],
];
const FLAGS: [string, string][] = [
  ["riichi", "Riichi"],
  ["double_riichi", "Dbl Riichi"],
  ["ippatsu", "Ippatsu"],
  ["haitei", "Haitei/Houtei"],
  ["rinshan", "Rinshan"],
  ["chankan", "Chankan"],
];
const RANGE = (n: number) => Array.from({ length: n }, (_, i) => i);

function detectKind(codes: string[]): "chow" | "pung" | "kan" | null {
  if (codes.length === 3) {
    if (codes.every(c => c === codes[0])) return "pung";
    const s = codes[0]?.[1];
    if (s && "BCD".includes(s) && codes.every(c => c[1] === s)) {
      const ranks = codes.map(c => parseInt(c[0])).sort((a, b) => a - b);
      if (ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1) return "chow";
    }
    return null;
  }
  if (codes.length === 4 && codes.every(c => c === codes[0])) return "kan";
  return null;
}

const meldLabel = (m: CalledMeld) => {
  if (m.kind === "chow") return "Chi · open";
  if (m.kind === "pung") return m.concealed ? "Pon · closed" : "Pon · open";
  return m.concealed ? "Kong · closed" : "Kong · open";
};

function TileBtn({
  code, count, disabled, selected, onClick,
}: {
  code: string; count?: number; disabled?: boolean; selected?: boolean; onClick: () => void;
}) {
  return (
    <div
      className={"tile-btn tile-pic" + (selected ? " has" : "") + (disabled ? " tile-dim" : "")}
      onClick={disabled ? undefined : onClick}
    >
      <TileImg code={code} />
      {(count ?? 0) > 0 && <span className="tile-badge">{count}</span>}
    </div>
  );
}

export default function TilesMode({
  tsumo,
  players,
  honba,
}: {
  tsumo: boolean;
  players: number;
  honba: number;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [winTile, setWinTile] = useState<string | null>(null);
  const [seatWind, setSeatWind] = useState("EW");
  const [roundWind, setRoundWind] = useState("EW");
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [dora, setDora] = useState(0);
  const [melds, setMelds] = useState<CalledMeld[]>([]);
  // bld = meld currently being built
  const [bld, setBld] = useState<{ codes: string[]; open: boolean; target: 3 | 4 } | null>(null);

  // Each meld (incl. kong) occupies 3 slots in the concealed count
  const meldSlots = melds.length * 3;
  const handTarget = 14 - meldSlots;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Auto-clear riichi flags when any open meld exists
  useEffect(() => {
    if (melds.some(m => !m.concealed)) {
      setFlags(prev => {
        const n = new Set(prev);
        n.delete("riichi"); n.delete("double_riichi"); n.delete("ippatsu");
        return n;
      });
    }
  }, [melds]);

  const add = (code: string) => {
    if (total >= handTarget || (counts[code] ?? 0) >= 4) return;
    setCounts(c => ({ ...c, [code]: (c[code] ?? 0) + 1 }));
  };
  const remove = (code: string) => {
    setCounts(c => {
      const n = (c[code] ?? 0) - 1;
      const next = { ...c };
      if (n <= 0) { delete next[code]; if (winTile === code) setWinTile(null); }
      else next[code] = n;
      return next;
    });
  };
  const toggleFlag = (f: string) =>
    setFlags(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else {
        next.add(f);
        if (f === "riichi") next.delete("double_riichi");
        if (f === "double_riichi") next.delete("riichi");
      }
      return next;
    });

  const startBuild = (target: 3 | 4) => setBld({ codes: [], open: true, target });
  const addToBld = (code: string) => {
    if (!bld || bld.codes.length >= bld.target) return;
    setBld(b => b ? { ...b, codes: [...b.codes, code] } : null);
  };
  const confirmMeld = () => {
    if (!bld) return;
    let codes = [...bld.codes];
    const kind = detectKind(codes);
    if (!kind) return;
    if (kind === "chow") codes = codes.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const newMelds = [...melds, { kind, codes, concealed: !bld.open }];
    setMelds(newMelds);
    setBld(null);
    const newTarget = 14 - newMelds.length * 3;
    if (total > newTarget) { setCounts({}); setWinTile(null); }
  };
  const removeMeld = (i: number) => setMelds(prev => prev.filter((_, j) => j !== i));

  const bldKind = bld ? detectKind(bld.codes) : null;
  const bldValid = bld !== null && bld.codes.length === bld.target && bldKind !== null;
  const hasOpen = melds.some(m => !m.concealed);

  const result = useMemo(() => {
    if (total !== handTarget || !winTile) return null;
    const concealed: string[] = [];
    for (const [code, n] of Object.entries(counts)) for (let i = 0; i < n; i++) concealed.push(code);
    const last = flags.has("haitei");
    const ctx: WinContext = {
      seatWind, roundWind, winTile, tsumo, players, honba,
      riichi: flags.has("riichi"), doubleRiichi: flags.has("double_riichi"),
      ippatsu: flags.has("ippatsu"), haitei: last && tsumo, houtei: last && !tsumo,
      rinshan: flags.has("rinshan"), chankan: flags.has("chankan"), dora,
    };
    return analyze(concealed, melds, ctx);
  }, [counts, winTile, seatWind, roundWind, flags, dora, tsumo, players, honba, total, melds, handTarget]);

  return (
    <div>
      <h2>Seat wind <small>(East = dealer)</small></h2>
      <div className="row">
        {WINDS.map(([v, l]) => (
          <div key={v} className={"chip" + (seatWind === v ? " selected" : "")} onClick={() => setSeatWind(v)}>{l}</div>
        ))}
      </div>

      <h2>Round wind</h2>
      <div className="row">
        {WINDS.slice(0, 2).map(([v, l]) => (
          <div key={v} className={"chip" + (roundWind === v ? " selected" : "")} onClick={() => setRoundWind(v)}>{l}</div>
        ))}
      </div>

      <h2>Flags</h2>
      <div className="row">
        {FLAGS.map(([f, l]) => {
          const blocked = hasOpen && (f === "riichi" || f === "double_riichi" || f === "ippatsu");
          return (
            <div key={f}
              className={"chip" + (flags.has(f) ? " on" : "") + (blocked ? " tile-dim" : "")}
              onClick={() => !blocked && toggleFlag(f)}>
              {l}
            </div>
          );
        })}
      </div>

      <h2>Dora (incl. aka / ura)</h2>
      <div className="row">
        {RANGE(11).map(n => (
          <div key={n} className={"chip" + (dora === n ? " selected" : "")} onClick={() => setDora(n)}>{n}</div>
        ))}
      </div>

      {/* ── Declared melds ── */}
      <h2>Declared sets</h2>
      {melds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {melds.map((m, i) => (
            <div key={i} className="meld-row">
              {m.codes.map((c, j) => (
                <div key={j} className="tile-btn tile-pic sm"><TileImg code={c} /></div>
              ))}
              <span className="meld-label">{meldLabel(m)}</span>
              <button className="link-btn" style={{ marginTop: 0, marginLeft: 6, fontSize: "0.8rem" }}
                onClick={() => removeMeld(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {bld ? (
        /* ── Meld builder ── */
        <div className="meld-builder">
          <div className="meld-builder-preview">
            <span style={{ fontSize: "0.82rem", color: "var(--hint)" }}>
              {bld.target === 4 ? "Kong" : "Set"} ({bld.codes.length}/{bld.target})
            </span>
            {bld.codes.length > 0 && (
              <span className="meld-preview-tiles">
                {bld.codes.map((c, i) => <TileImg key={i} code={c} className="sm" />)}
              </span>
            )}
            {bld.codes.length === bld.target && (
              <span style={{ fontSize: "0.78rem", color: bldKind ? "var(--button)" : "var(--neg)" }}>
                → {bldKind ?? "invalid — try different tiles"}
              </span>
            )}
          </div>
          {SUITS.map(s => (
            <div className="tiles-grid" key={s} style={{ marginBottom: 4 }}>
              {RANGE(9).map(i => {
                const c = `${i + 1}${s}`;
                const cnt = bld.codes.filter(x => x === c).length;
                return (
                  <TileBtn key={c} code={c} count={cnt}
                    disabled={bld.codes.length >= bld.target || cnt >= 4}
                    onClick={() => addToBld(c)} />
                );
              })}
            </div>
          ))}
          <div className="tiles-grid" style={{ marginBottom: 8 }}>
            {HONORS.map(c => {
              const cnt = bld.codes.filter(x => x === c).length;
              return (
                <TileBtn key={c} code={c} count={cnt}
                  disabled={bld.codes.length >= bld.target || cnt >= 4}
                  onClick={() => addToBld(c)} />
              );
            })}
          </div>
          <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
            {bld.codes.length > 0 && (
              <div className="chip" onClick={() => setBld(b => b ? { ...b, codes: b.codes.slice(0, -1) } : null)}>← Undo</div>
            )}
            <div className={"chip" + (bld.open ? " selected" : "")}
              onClick={() => setBld(b => b ? { ...b, open: true } : null)}>Open</div>
            <div className={"chip" + (!bld.open ? " selected" : "")}
              onClick={() => setBld(b => b ? { ...b, open: false } : null)}>Closed</div>
            <div className={"chip" + (bldValid ? " on" : " tile-dim")}
              onClick={() => bldValid && confirmMeld()}>Add set</div>
            <div className="chip" onClick={() => setBld(null)}>Cancel</div>
          </div>
        </div>
      ) : melds.length < 4 ? (
        <div className="row" style={{ marginBottom: 4 }}>
          <div className="chip" onClick={() => startBuild(3)}>+ Set of 3</div>
          <div className="chip" onClick={() => startBuild(4)}>+ Kong (4)</div>
        </div>
      ) : null}

      {/* ── Main hand tile picker ── */}
      <h2>Hand tiles ({total} / {handTarget})</h2>
      {SUITS.map(s => (
        <div className="tiles-grid" key={s}>
          {RANGE(9).map(i => {
            const c = `${i + 1}${s}`;
            const n = counts[c] ?? 0;
            return (
              <TileBtn key={c} code={c} count={n}
                selected={n > 0}
                disabled={total >= handTarget && n === 0}
                onClick={() => add(c)} />
            );
          })}
        </div>
      ))}
      <div className="tiles-grid">
        {HONORS.map(c => {
          const n = counts[c] ?? 0;
          return (
            <TileBtn key={c} code={c} count={n}
              selected={n > 0}
              disabled={total >= handTarget && n === 0}
              onClick={() => add(c)} />
          );
        })}
      </div>

      {/* ── Rack ── */}
      {total > 0 && (
        <>
          <h2>Rack — tap to remove</h2>
          <div className="row" style={{ gap: 4 }}>
            {Object.entries(counts).flatMap(([c, n]) =>
              RANGE(n).map(i => (
                <div key={`${c}-${i}`} className="tile-btn tile-pic sm rack-tile" onClick={() => remove(c)}>
                  <TileImg code={c} />
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── Winning tile ── */}
      {total === handTarget && (
        <>
          <h2>Winning tile</h2>
          <div className="row" style={{ gap: 4 }}>
            {Object.keys(counts).map(c => (
              <div key={c}
                className={"tile-btn tile-pic sm" + (winTile === c ? " has" : "")}
                onClick={() => setWinTile(c === winTile ? null : c)}>
                <TileImg code={c} />
              </div>
            ))}
          </div>
        </>
      )}

      {result && (
        result.ok
          ? <ResultCard score={result.score} yaku={result.yaku} yakuman={result.yakuman} />
          : <ResultCard error={result.error} />
      )}
    </div>
  );
}
