"use client";

import { useMemo, useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { score } from "@/lib/riichi/scoring";
import { YAKU, totalHan } from "@/lib/riichi/yaku";
import ResultCard from "./ResultCard";
import TilesMode from "./TilesMode";
import { NumberPicker } from "./NumberPicker";

type Mode = "manual" | "yaku" | "tiles";

const HAN = Array.from({ length: 13 }, (_, i) => i + 1);
const FU = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];

function Chips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="row">
      {options.map((o) => (
        <div key={String(o.v)} className={"chip" + (value === o.v ? " selected" : "")} onClick={() => { haptic("selection"); onChange(o.v); }}>
          {o.label}
        </div>
      ))}
    </div>
  );
}

export default function RiichiCalculator({ onBack }: { onBack: () => void }) {
  useBackButton(onBack);
  const [mode, setMode] = useState<Mode>("tiles");
  const [tsumo, setTsumo] = useState(false);
  const [players, setPlayers] = useState<3 | 4>(4);
  const [honba, setHonba] = useState(0);

  // manual / yaku state
  const [dealer, setDealer] = useState(false);
  const [dora, setDora] = useState(0);
  const [fu, setFu] = useState(30);
  const [hanInput, setHanInput] = useState<number | null>(3);
  const [closed, setClosed] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggleYaku = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const result = useMemo(() => {
    if (mode === "tiles") return null;
    try {
      let han: number;
      if (mode === "manual") {
        if (hanInput == null) return null;
        han = hanInput + dora;
      } else {
        const keys = [...picked];
        if (keys.length === 0) return null;
        han = totalHan(keys, closed, dora);
      }
      return { score: score(han, fu, { dealer, tsumo, players, honba }) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [mode, hanInput, dora, picked, closed, fu, dealer, tsumo, players, honba]);

  const hanForFu = mode === "manual" ? (hanInput ?? 0) + dora : totalHan([...picked], closed, dora);
  const showFu = mode !== "tiles" && hanForFu < 5;

  return (
    <div>
      <h1>Riichi calculator</h1>

      <div className="row" style={{ marginBottom: 8 }}>
        {(["tiles", "manual", "yaku"] as Mode[]).map((m) => (
          <div key={m} className={"chip" + (mode === m ? " selected" : "")} onClick={() => { haptic("selection"); setMode(m); }}>
            {m === "tiles" ? "Pick tiles" : m === "manual" ? "Han + Fu" : "Pick yaku"}
          </div>
        ))}
      </div>

      <h2>Win type</h2>
      <Chips
        options={[
          { v: "ron", label: "Ron" },
          { v: "tsumo", label: "Tsumo" },
        ]}
        value={tsumo ? "tsumo" : "ron"}
        onChange={(v) => setTsumo(v === "tsumo")}
      />

      <h2>Players</h2>
      <Chips
        options={[
          { v: 4, label: "4 (yonma)" },
          { v: 3, label: "3 (sanma)" },
        ]}
        value={players}
        onChange={(v) => setPlayers(v as 3 | 4)}
      />

      <h2>Honba</h2>
      <NumberPicker value={honba} onChange={setHonba} max={10} />

      {mode === "tiles" ? (
        <TilesMode tsumo={tsumo} players={players} honba={honba} />
      ) : (
        <>
          <h2>Seat</h2>
          <Chips
            options={[
              { v: "nondealer", label: "Non-dealer" },
              { v: "dealer", label: "Dealer" },
            ]}
            value={dealer ? "dealer" : "nondealer"}
            onChange={(v) => setDealer(v === "dealer")}
          />

          {mode === "manual" ? (
            <>
              <h2>Han</h2>
              <Chips options={HAN.map((n) => ({ v: n, label: n === 13 ? "13+" : String(n) }))} value={hanInput} onChange={setHanInput} />
            </>
          ) : (
            <>
              <h2>Hand</h2>
              <Chips
                options={[
                  { v: "closed", label: "Closed" },
                  { v: "open", label: "Open" },
                ]}
                value={closed ? "closed" : "open"}
                onChange={(v) => setClosed(v === "closed")}
              />
              <h2>Yaku</h2>
              <div className="choices">
                {YAKU.filter((y) => closed || y.openHan !== null).map((y) => (
                  <div key={y.key} className={"choice-btn" + (picked.has(y.key) ? " selected-choice" : "")}
                    onClick={() => { haptic("selection"); toggleYaku(y.key); }}>
                    {y.name} · {closed ? y.closedHan : y.openHan}
                    <small>{y.en}</small>
                  </div>
                ))}
              </div>
            </>
          )}

          {showFu && (
            <>
              <h2>Fu</h2>
              <Chips options={FU.map((n) => ({ v: n, label: String(n) }))} value={fu} onChange={setFu} />
            </>
          )}

          <h2>Dora (incl. aka / ura)</h2>
          <NumberPicker value={dora} onChange={setDora} max={20} />

          {result && ("error" in result ? <ResultCard error={result.error} /> : <ResultCard score={result.score} />)}
        </>
      )}

      <button className="link-btn" onClick={onBack}>
        ← Back to menu
      </button>
    </div>
  );
}
