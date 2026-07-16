"use client";

// Singaporean / Malaysian tile picker — build a hand from the sg tile art. This
// is the PICKER ONLY for now: automatic tai (doubles) scoring isn't wired up
// yet (the SG scoring rules will be supplied later), so the output area shows a
// placeholder. Kept self-contained and decoupled from the money/session flow so
// it can't affect recorded balances.

import { useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { IconBack } from "./icons";

const TILE_BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/tiles/sg/";
const src = (code: string) => `${TILE_BASE}sg${code}.png`;

function Tile({ code, count, dim, onClick }: { code: string; count?: number; dim?: boolean; onClick?: () => void }) {
  return (
    <div className={"tile-btn tile-pic" + ((count ?? 0) > 0 ? " has" : "") + (dim ? " tile-dim" : "")}
      onClick={dim ? undefined : onClick}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="tile-img" src={src(code)} alt={code} draggable={false} />
      {(count ?? 0) > 0 && <span className="tile-badge">{count}</span>}
    </div>
  );
}

const RANGE9 = Array.from({ length: 9 }, (_, i) => i + 1);
const SUITS: [string, string][] = [["C", "Characters (wan)"], ["D", "Dots (tong)"], ["B", "Bamboo (sok)"]];
const HONORS = ["EW", "SW", "WW", "NW", "RD", "GD", "WD"];
const BONUS = ["F1", "F2", "F3", "F4", "S1", "S2", "S3", "S4"];
const MAX_TOTAL = 18; // a 14-tile hand plus up to 4 flower/season tiles

export function SGTiles({ onBack }: { onBack: () => void }) {
  useBackButton(onBack);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const full = total >= MAX_TOTAL;

  const add = (c: string) => {
    if ((counts[c] ?? 0) >= 4 || full) return;
    haptic("light");
    setCounts((m) => ({ ...m, [c]: (m[c] ?? 0) + 1 }));
  };
  const remove = (c: string) => setCounts((m) => {
    const n = (m[c] ?? 0) - 1; const next = { ...m };
    if (n <= 0) delete next[c]; else next[c] = n;
    return next;
  });
  const clear = () => { haptic("warning"); setCounts({}); };

  const rack = Object.entries(counts).flatMap(([c, n]) => Array.from({ length: n }, (_, i) => `${c}#${i}`));

  return (
    <div>
      <h1>Tai calculator <small>build a hand</small></h1>
      <p className="hint">
        Tap tiles to build a hand. Automatic tai (doubles) scoring is coming — for now this is the tile picker.
      </p>

      {SUITS.map(([s, label]) => (
        <div key={s}>
          <h2>{label}</h2>
          <div className="tiles-grid">
            {RANGE9.map((i) => {
              const c = `${i}${s}`;
              return <Tile key={c} code={c} count={counts[c] ?? 0} dim={full && !counts[c]} onClick={() => add(c)} />;
            })}
          </div>
        </div>
      ))}

      <h2>Winds &amp; dragons</h2>
      <div className="tiles-grid">
        {HONORS.map((c) => <Tile key={c} code={c} count={counts[c] ?? 0} dim={full && !counts[c]} onClick={() => add(c)} />)}
      </div>

      <h2>Flowers &amp; seasons</h2>
      <div className="tiles-grid">
        {BONUS.map((c) => <Tile key={c} code={c} count={counts[c] ?? 0} dim={full && !counts[c]} onClick={() => add(c)} />)}
      </div>

      {total > 0 && (
        <>
          <h2>Your hand ({total}) <small>tap to remove</small></h2>
          <div className="tiles-grid">
            {rack.map((k) => {
              const c = k.split("#")[0];
              return (
                <div key={k} className="tile-btn tile-pic sm" onClick={() => remove(c)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="tile-img" src={src(c)} alt={c} draggable={false} />
                </div>
              );
            })}
          </div>
          <button className="chip" style={{ marginTop: 8 }} onClick={clear}>Clear hand</button>
        </>
      )}

      <div className="result">
        <div className="line"><strong>Tai: —</strong></div>
        <div className="line meta">
          Scoring isn&apos;t wired up yet. Once you give me the tai for each hand type, this will work it out automatically.
        </div>
      </div>

      <button className="link-btn with-ico" onClick={onBack}><IconBack size={16} />Back</button>
    </div>
  );
}
