"use client";

import { useMemo, useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { score } from "@/lib/riichi/scoring";
import { YAKU, totalHan } from "@/lib/riichi/yaku";
import ResultCard from "./ResultCard";
import TilesMode from "./TilesMode";
import { NumberPicker } from "./NumberPicker";
import { IconBack } from "./sg/icons";

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
        <button type="button" key={String(o.v)} className={"chip" + (value === o.v ? " selected" : "")} onClick={() => { haptic("selection"); onChange(o.v); }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type PickResult = { han: number; fu: number; yakuman: number };
// When embedded in the game's record-hand wizard, the win type / players / honba
// / seat & round wind are all known from game state, so they're supplied (and
// their pickers hidden); the picked {han, fu, yakuman} is returned via onPick.
export interface CalcEmbed {
  onPick: (r: PickResult) => void;
  tsumo: boolean;
  players: 3 | 4;
  honba: number;
  seatWind: string;
  roundWind: string;
}

export default function RiichiCalculator({ onBack, embed }: { onBack: () => void; embed?: CalcEmbed }) {
  useBackButton(onBack);
  const [mode, setMode] = useState<Mode>("tiles");
  const [tsumoState, setTsumo] = useState(false);
  const [playersState, setPlayers] = useState<3 | 4>(4);
  const [honbaState, setHonba] = useState(0);
  const tsumo = embed ? embed.tsumo : tsumoState;
  const players = embed ? embed.players : playersState;
  const honba = embed ? embed.honba : honbaState;
  const [tilesResult, setTilesResult] = useState<PickResult | null>(null);

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

  // The hand value to hand back to an embedding wizard: tiles mode lifts it via
  // onResult; manual/yaku read it off the computed score (yakuman via 13+ han).
  const pick: PickResult | null =
    mode === "tiles"
      ? tilesResult
      : result && !("error" in result) ? { han: result.score.han, fu: result.score.fu, yakuman: 0 } : null;

  return (
    <div>
      <h1>Riichi calculator</h1>

      <div className="row" style={{ marginBottom: 8 }}>
        {(["tiles", "manual", "yaku"] as Mode[]).map((m) => (
          <button type="button" key={m} className={"chip" + (mode === m ? " selected" : "")} onClick={() => { haptic("selection"); setMode(m); }}>
            {m === "tiles" ? "Pick tiles" : m === "manual" ? "Han + Fu" : "Pick yaku"}
          </button>
        ))}
      </div>

      {!embed && (
        <>
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
        </>
      )}

      {mode === "tiles" ? (
        <TilesMode tsumo={tsumo} players={players} honba={honba}
          fixedSeatWind={embed?.seatWind} fixedRoundWind={embed?.roundWind}
          onResult={embed ? setTilesResult : undefined} />
      ) : (
        <>
          {!embed && (
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
            </>
          )}

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

          {!embed && result && ("error" in result ? <ResultCard error={result.error} /> : <ResultCard score={result.score} />)}
        </>
      )}

      {embed ? (
        <>
          <button className="primary-btn" style={{ marginTop: 12 }} disabled={!pick}
            onClick={() => pick && embed.onPick(pick)}>
            {pick
              ? `Use this hand · ${pick.yakuman ? pick.yakuman + "× yakuman" : pick.han + " han" + (pick.han < 5 ? " / " + pick.fu + " fu" : "")}`
              : "Build a valid hand first"}
          </button>
          <button className="link-btn" onClick={onBack}>← Cancel</button>
        </>
      ) : (
        <button className="link-btn with-ico" onClick={onBack}><IconBack size={16} />Back</button>
      )}
    </div>
  );
}
