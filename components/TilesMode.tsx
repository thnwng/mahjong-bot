"use client";

import { useEffect, useMemo, useState } from "react";
import { haptic } from "@/lib/telegram";
import { analyze, WinContext, CalledMeld } from "@/lib/riichi/analyze";
import { chiStep } from "@/lib/riichi/chi";
import ResultCard from "./ResultCard";
import { NumberPicker } from "./NumberPicker";

// Meld types the builder offers, and the engine `kind` each maps to (analyze.ts
// depends on "chow"/"pung"/"kan"; the UI standardises on chi/pon/kong).
type BuildType = "chi" | "pon" | "kong";
const KIND_OF: Record<BuildType, "chow" | "pung" | "kan"> = { chi: "chow", pon: "pung", kong: "kan" };
const targetOf = (t: BuildType) => (t === "kong" ? 4 : 3);

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
const isSuited = (code: string) => "BCD".includes(code[1]);

const meldLabel = (m: CalledMeld) => {
  if (m.kind === "chow") return "chi";
  if (m.kind === "pung") return m.concealed ? "pon · closed" : "pon";
  return m.concealed ? "kong · closed" : "kong";
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
  fixedSeatWind,
  fixedRoundWind,
  onResult,
}: {
  tsumo: boolean;
  players: number;
  honba: number;
  // When embedded in the game's record-hand wizard, the winner's seat wind and
  // the round wind are known from game state — seed them and hide the pickers,
  // and lift the computed {han, fu, yakuman} up so the wizard can capture it.
  fixedSeatWind?: string;
  fixedRoundWind?: string;
  onResult?: (r: { han: number; fu: number; yakuman: number } | null) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [winTile, setWinTile] = useState<string | null>(null);
  const [seatWindState, setSeatWind] = useState("EW");
  const [roundWindState, setRoundWind] = useState("EW");
  const seatWind = fixedSeatWind ?? seatWindState;
  const roundWind = fixedRoundWind ?? roundWindState;
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [dora, setDora] = useState(0);
  const [melds, setMelds] = useState<CalledMeld[]>([]);
  // bld = meld currently being built (its type fixes what tiles are legal)
  const [bld, setBld] = useState<{ type: BuildType; codes: string[]; open: boolean } | null>(null);

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

  // ── Meld builder ──────────────────────────────────────────────────────────
  // Chi builds a run in one suit (only x+-2 stays pickable; the sequence auto-
  // fills once it's forced). Pon/kong take one tile and auto-fill 3/4 copies.
  const startBuild = (type: BuildType) => setBld({ type, codes: [], open: type !== "chi" });

  // Which tiles the builder currently accepts (everything else is greyed out).
  const canBuild = (code: string): boolean => {
    if (!bld) return false;
    if (bld.codes.length >= targetOf(bld.type)) return false;
    if (bld.type !== "chi") return bld.codes.length === 0; // pon/kong: one pick, any tile
    if (!isSuited(code)) return false;                     // chi: no honors
    if (bld.codes.length === 0) return true;               // chi: any suited tile first
    if (code[1] !== bld.codes[0][1]) return false;         // same suit only
    const ranks = bld.codes.map(c => parseInt(c[0]));
    const rank = parseInt(code[0]);
    return !ranks.includes(rank) && chiStep(ranks).candidates.includes(rank);
  };

  const tapBuild = (code: string) => {
    if (!bld || !canBuild(code)) return;
    if (bld.type === "pon") { setBld({ ...bld, codes: [code, code, code] }); return; }
    if (bld.type === "kong") { setBld({ ...bld, codes: [code, code, code, code] }); return; }
    // chi: add this rank, then auto-fill if only one sequence remains
    const suit = code[1];
    const ranks = bld.codes.map(c => parseInt(c[0]));
    const rank = parseInt(code[0]);
    const step = chiStep([...ranks, rank]);
    const finalRanks = [...new Set([...ranks, rank, ...step.autofill])].sort((a, b) => a - b);
    setBld({ ...bld, codes: finalRanks.map(r => `${r}${suit}`) });
  };

  const bldComplete = bld ? bld.codes.length === targetOf(bld.type) : false;

  const confirmMeld = () => {
    if (!bld || !bldComplete) return;
    const kind = KIND_OF[bld.type];
    let codes = [...bld.codes];
    if (kind === "chow") codes = codes.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const newMelds = [...melds, { kind, codes, concealed: !bld.open }];
    setMelds(newMelds);
    setBld(null);
    const newTarget = 14 - newMelds.length * 3;
    if (total > newTarget) { setCounts({}); setWinTile(null); }
  };
  const removeMeld = (i: number) => setMelds(prev => prev.filter((_, j) => j !== i));

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

  // Lift the computed hand value to an embedding parent (the game wizard). `score`
  // carries the raw han/fu; the game re-derives the payment from its own state.
  useEffect(() => {
    if (!onResult) return;
    if (result && result.ok && result.score) {
      onResult({ han: result.score.han, fu: result.score.fu, yakuman: result.yakuman?.length ?? 0 });
    } else {
      onResult(null);
    }
  }, [result, onResult]);

  // A builder tile grid cell: highlighted if already in the meld, greyed if not
  // currently pickable.
  const buildCell = (c: string) => {
    const cnt = bld ? bld.codes.filter(x => x === c).length : 0;
    return (
      <TileBtn key={c} code={c} count={cnt} selected={cnt > 0}
        disabled={cnt === 0 && !canBuild(c)} onClick={() => tapBuild(c)} />
    );
  };

  return (
    <div>
      {!fixedSeatWind && (
        <>
          <h2>Seat wind <small>(East = dealer)</small></h2>
          <div className="row">
            {WINDS.map(([v, l]) => (
              <button type="button" key={v} className={"chip" + (seatWind === v ? " selected" : "")}
                onClick={() => { haptic("selection"); setSeatWind(v); }}>{l}</button>
            ))}
          </div>
        </>
      )}

      {!fixedRoundWind && (
        <>
          <h2>Round wind</h2>
          <div className="row">
            {WINDS.slice(0, 2).map(([v, l]) => (
              <button type="button" key={v} className={"chip" + (roundWind === v ? " selected" : "")}
                onClick={() => { haptic("selection"); setRoundWind(v); }}>{l}</button>
            ))}
          </div>
        </>
      )}

      <h2>Flags</h2>
      <div className="row">
        {FLAGS.map(([f, l]) => {
          const blocked = hasOpen && (f === "riichi" || f === "double_riichi" || f === "ippatsu");
          return (
            <button type="button" key={f}
              className={"chip" + (flags.has(f) ? " selected" : "")} disabled={blocked}
              onClick={() => { haptic("selection"); toggleFlag(f); }}>
              {l}
            </button>
          );
        })}
      </div>

      <h2>Dora (incl. aka / ura)</h2>
      <NumberPicker value={dora} onChange={setDora} max={20} />

      {/* ── Declared sets: one wrapping row of meld chips ── */}
      <h2>Declared sets</h2>
      {melds.length > 0 ? (
        <div className="declared-row">
          {melds.map((m, i) => (
            <div key={i} className="meld-chip">
              {m.codes.map((c, j) => (
                <div key={j} className="tile-btn tile-pic sm"><TileImg code={c} /></div>
              ))}
              <span className="meld-label">{meldLabel(m)}</span>
              <button className="link-btn inline" style={{ marginLeft: 2 }}
                onClick={() => removeMeld(i)}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">No called sets yet.</p>
      )}

      {bld ? (
        /* ── Meld builder ── */
        <div className="meld-builder">
          <div className="meld-builder-preview">
            <span className="meta">
              {bld.type} ({bld.codes.length}/{targetOf(bld.type)})
            </span>
            {bld.codes.length > 0 && (
              <span className="meld-preview-tiles">
                {bld.codes.map((c, i) => <div key={i} className="tile-btn tile-pic sm"><TileImg code={c} /></div>)}
              </span>
            )}
            {bldComplete && (
              <span style={{ fontSize: "0.78rem", color: "var(--button)" }}>→ {bld.type}</span>
            )}
          </div>
          {SUITS.map(s => (
            <div className="tiles-grid" key={s} style={{ marginBottom: 4 }}>
              {RANGE(9).map(i => buildCell(`${i + 1}${s}`))}
            </div>
          ))}
          <div className="tiles-grid" style={{ marginBottom: 8 }}>
            {HONORS.map(c => buildCell(c))}
          </div>
          <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
            {bld.codes.length > 0 && (
              <button type="button" className="chip" onClick={() => { haptic("selection"); setBld(b => b ? { ...b, codes: [] } : null); }}>Clear</button>
            )}
            {/* Chi is always an open call; pon/kong can be concealed. */}
            {bld.type !== "chi" && (
              <>
                <button type="button" className={"chip" + (bld.open ? " selected" : "")}
                  onClick={() => { haptic("selection"); setBld(b => b ? { ...b, open: true } : null); }}>Open</button>
                <button type="button" className={"chip" + (!bld.open ? " selected" : "")}
                  onClick={() => { haptic("selection"); setBld(b => b ? { ...b, open: false } : null); }}>Closed</button>
              </>
            )}
            <button type="button" className="chip" disabled={!bldComplete}
              onClick={() => { haptic("selection"); confirmMeld(); }}>Add set</button>
            <button type="button" className="chip" onClick={() => { haptic("selection"); setBld(null); }}>Cancel</button>
          </div>
        </div>
      ) : melds.length < 4 ? (
        <div className="row" style={{ marginBottom: 4 }}>
          <button type="button" className="chip" onClick={() => { haptic("selection"); startBuild("chi"); }}>+ Chi</button>
          <button type="button" className="chip" onClick={() => { haptic("selection"); startBuild("pon"); }}>+ Pon</button>
          <button type="button" className="chip" onClick={() => { haptic("selection"); startBuild("kong"); }}>+ Kong</button>
        </div>
      ) : null}

      {/* ── Your concealed hand (selected tiles), wraps if long ── */}
      <h2>Your hand ({total}/{handTarget}) <small>tap to remove</small></h2>
      {total > 0 ? (
        <div className="row" style={{ gap: 4 }}>
          {Object.entries(counts).flatMap(([c, n]) =>
            RANGE(n).map(i => (
              <div key={`${c}-${i}`} className="tile-btn tile-pic sm rack-tile" onClick={() => remove(c)}>
                <TileImg code={c} />
              </div>
            ))
          )}
        </div>
      ) : (
        <p className="hint">No tiles yet — add them below.</p>
      )}

      {/* ── Tile picker: tap to add to your hand ── */}
      <h2>Add tiles</h2>
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
