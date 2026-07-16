"use client";

// A Riichi GAME screen: live standings driven by lib/riichi/game.ts, plus a
// record-a-hand wizard that reuses the tile/yaku calculator (embedded, seeded
// with the winner's seat wind + round wind + honba) to get han/fu. Points only
// — the optional money layer is a later phase. Game state is held in React
// state here (persistence is Phase 35).

import { useEffect, useMemo, useState } from "react";
import { haptic, useBackButton, useClosingConfirmation } from "@/lib/telegram";
import RiichiCalculator, { PickResult } from "../RiichiCalculator";
import {
  RiichiConfig, DEFAULT_CONFIG, Hand, GameState,
  newGame, applyHand, reduce, dealerOf, roundOf, seatWind, placements,
} from "@/lib/riichi/game";
import { IconBack } from "../sg/icons";

const WIND_LABEL: Record<string, string> = { E: "East", S: "South", W: "West", N: "North" };
const WIND_CODE: Record<string, string> = { E: "EW", S: "SW", W: "WW", N: "NW" }; // game -> calculator tile codes
// Points formatting matches ResultCard: thousands separators, explicit +/-.
const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toLocaleString();

export default function RiichiGame({
  players, config, onBack,
}: {
  players: string[];
  config?: Partial<RiichiConfig>;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const [cfg] = useState<RiichiConfig>(() => ({ ...DEFAULT_CONFIG, ...config, players: players.length }));
  const [hands, setHands] = useState<Hand[]>([]);
  const [recording, setRecording] = useState(false);
  const [endedEarly, setEndedEarly] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const state = useMemo(() => reduce(cfg, hands), [cfg, hands]);
  const done = state.finished || endedEarly;
  const round = roundOf(state);
  const dealer = dealerOf(state);

  // A game in progress lives only in memory — guard against an accidental close
  // (the SG action wizard does the same for one half-entered hand).
  useClosingConfirmation(hands.length > 0 && !done);

  // Ending early is irreversible: two-tap confirm, the app's standard.
  const endNow = () => {
    if (!confirmEnd) { setConfirmEnd(true); haptic("warning"); return; }
    setEndedEarly(true);
  };

  // Each recorded hand, tagged with the round it was played in (by re-replaying).
  const log = useMemo(() => {
    const rows: { h: Hand; label: string }[] = [];
    let s = newGame(cfg);
    for (const h of hands) {
      const r = roundOf(s);
      rows.push({ h, label: `${WIND_LABEL[r.wind]} ${r.kyoku}${s.honba ? `-${s.honba}` : ""}` });
      s = applyHand(s, h);
    }
    return rows.reverse();
  }, [cfg, hands]);

  const record = (h: Hand) => { setHands((hs) => [...hs, h]); setRecording(false); haptic("success"); };
  const undo = () => setHands((hs) => hs.slice(0, -1));

  if (recording) {
    return <RecordHand state={state} players={players} onDone={record} onCancel={() => setRecording(false)} />;
  }

  return (
    <div>
      <h1>{done ? "Final result" : "Riichi game"}</h1>

      {!done && (
        <div className="result banner">
          <div className="line">
            <strong>{WIND_LABEL[round.wind]} {round.kyoku}</strong>
            {state.honba > 0 ? ` · ${state.honba} honba` : ""}
            {state.pot > 0 ? ` · pot ${state.pot.toLocaleString()}` : ""}
          </div>
          <div className="line meta">
            Dealer: <strong>{players[dealer]}</strong> · {cfg.length === "hanchan" ? "hanchan" : "tonpuusen"}
          </div>
        </div>
      )}

      <h2>{done ? "Placements" : "Standings"}</h2>
      <div className="balances">
        {(done ? placements(state).map((p) => ({ seat: p.seat, place: p.place })) : players.map((_, i) => ({ seat: i, place: 0 })))
          .map(({ seat, place }) => {
            const pts = state.points[seat];
            const start = cfg.startPoints;
            return (
              <div key={seat} className="bal-row" style={{ alignItems: "center" }}>
                <span>
                  {done && <strong>{place}. </strong>}
                  {players[seat]}
                  {!done && seat === dealer && <strong style={{ color: "var(--button)" }}> · dealer</strong>}
                  {!done && <span className="meta"> · {WIND_LABEL[seatWind(state, seat)]}</span>}
                </span>
                <span>
                  <strong>{pts.toLocaleString()}</strong>
                  <span className={"bal " + (pts - start >= 0 ? "pos" : "neg")} style={{ fontSize: "0.8rem", marginLeft: 6 }}>
                    {fmt(pts - start)}
                  </span>
                </span>
              </div>
            );
          })}
      </div>

      {!done ? (
        <>
          <button className="primary-btn" style={{ marginTop: 14 }} onClick={() => { haptic("light"); setRecording(true); }}>
            Record a hand
          </button>
          {hands.length > 0 && (
            <button className="link-btn" onClick={endNow}>{confirmEnd ? "Tap again to end the game" : "End game now"}</button>
          )}
        </>
      ) : (
        <p className="hint" style={{ marginTop: 12 }}>
          Game over. Points are final{cfg.tobi && state.points.some((p) => p < 0) ? " (someone busted)" : ""}.
        </p>
      )}

      {log.length > 0 && (
        <>
          <h2>Hands</h2>
          <div className="log">
            {log.map((row, i) => (
              <div key={i} className="log-row">
                <span className="meta" style={{ marginRight: 6 }}>{row.label}</span>
                {describeHand(row.h, players)}
                {i === 0 && !done && (
                  <button className="link-btn inline" style={{ marginLeft: 8 }} onClick={undo}>undo</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <button className="link-btn with-ico" onClick={onBack}><IconBack size={16} />Back</button>
    </div>
  );
}

function describeHand(h: Hand, players: string[]): string {
  if (h.kind === "ron") return `${players[h.winner]} ron ${players[h.discarder]} · ${h.yakuman ? h.yakuman + "× yakuman" : h.han + " han"}`;
  if (h.kind === "tsumo") return `${players[h.winner]} tsumo · ${h.yakuman ? h.yakuman + "× yakuman" : h.han + " han"}`;
  if (h.kind === "draw") return `draw · tenpai: ${h.tenpai.length ? h.tenpai.map((s) => players[s]).join(", ") : "none"}`;
  if (h.kind === "abort") return "abortive draw";
  return `chombo · ${players[h.offender]}`;
}

// ------------------------------------------------------------ record-hand wizard

const OUTCOMES: { v: Hand["kind"]; label: string }[] = [
  { v: "ron", label: "Ron" },
  { v: "tsumo", label: "Tsumo" },
  { v: "draw", label: "Draw" },
  { v: "abort", label: "Abort" },
  { v: "chombo", label: "Chombo" },
];

function RecordHand({
  state, players, onDone, onCancel,
}: {
  state: GameState;
  players: string[];
  onDone: (h: Hand) => void;
  onCancel: () => void;
}) {
  useBackButton(onCancel);
  const [kind, setKind] = useState<Hand["kind"]>("ron");
  const [winner, setWinner] = useState<number | null>(null);
  const [discarder, setDiscarder] = useState<number | null>(null);
  const [tenpai, setTenpai] = useState<number[]>([]);
  const [offender, setOffender] = useState<number | null>(null);
  const [riichi, setRiichi] = useState<number[]>([]);
  const [scored, setScored] = useState<PickResult | null>(null);
  const [calc, setCalc] = useState(false);

  useEffect(() => { setScored(null); }, [winner, kind]); // stale score guard
  useClosingConfirmation(true); // guard the half-entered hand, like the SG wizard

  const isWin = kind === "ron" || kind === "tsumo";

  // The score step: embed the calculator, seeded from game state.
  if (calc && isWin && winner != null) {
    return (
      <RiichiCalculator
        onBack={() => setCalc(false)}
        embed={{
          onPick: (r) => { setScored(r); setCalc(false); haptic("success"); },
          tsumo: kind === "tsumo",
          players: state.config.players as 3 | 4,
          honba: state.honba,
          seatWind: WIND_CODE[seatWind(state, winner)],
          roundWind: WIND_CODE[roundOf(state).wind],
        }}
      />
    );
  }

  const valid =
    kind === "ron" ? winner != null && discarder != null && discarder !== winner && scored != null :
    kind === "tsumo" ? winner != null && scored != null :
    kind === "chombo" ? offender != null :
    true; // draw / abort always valid

  const submit = () => {
    let h: Hand;
    if (kind === "ron") h = { kind, winner: winner!, discarder: discarder!, han: scored!.han, fu: scored!.fu, yakuman: scored!.yakuman, riichi };
    else if (kind === "tsumo") h = { kind, winner: winner!, han: scored!.han, fu: scored!.fu, yakuman: scored!.yakuman, riichi };
    else if (kind === "draw") h = { kind, tenpai, riichi };
    else if (kind === "abort") h = { kind, riichi };
    else h = { kind: "chombo", offender: offender! };
    onDone(h);
  };

  return (
    <div>
      <h1>Record a hand</h1>

      <h2>Outcome</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {OUTCOMES.map((o) => (
          <button type="button" key={o.v} className={"chip" + (kind === o.v ? " selected" : "")}
            onClick={() => { haptic("selection"); setKind(o.v); }}>{o.label}</button>
        ))}
      </div>

      {isWin && (<><h2>Winner</h2><SeatPicker players={players} value={winner} onPick={setWinner} /></>)}
      {kind === "ron" && (<><h2>Dealt in (discarder)</h2><SeatPicker players={players} value={discarder} onPick={setDiscarder} exclude={winner} /></>)}
      {kind === "draw" && (<><h2>Who&apos;s tenpai?</h2><MultiPicker players={players} sel={tenpai} set={setTenpai} /></>)}
      {kind === "chombo" && (<><h2>Who fouled?</h2><SeatPicker players={players} value={offender} onPick={setOffender} /></>)}

      {kind !== "chombo" && (<><h2>Declared riichi this hand</h2><MultiPicker players={players} sel={riichi} set={setRiichi} /></>)}

      {isWin && (
        <>
          <h2>Hand value</h2>
          {scored ? (
            <div className="result banner">
              <div className="line"><strong>{scored.yakuman ? scored.yakuman + "× yakuman" : scored.han + " han" + (scored.han < 5 ? ` / ${scored.fu} fu` : "")}</strong></div>
              <button className="link-btn" disabled={winner == null} onClick={() => setCalc(true)}>change</button>
            </div>
          ) : (
            <button className="primary-btn" disabled={winner == null} onClick={() => setCalc(true)}>
              {winner == null ? "Pick the winner first" : "Score the hand →"}
            </button>
          )}
        </>
      )}

      <button className="primary-btn" style={{ marginTop: 14 }} disabled={!valid} onClick={submit}>Record hand</button>
      <button className="link-btn" onClick={onCancel}>← Cancel</button>
    </div>
  );
}

// Stable module-level pickers (defining these inside RecordHand would give them a
// new identity each render and remount them on every click, dropping selections).
function SeatPicker({ players, value, onPick, exclude }: {
  players: string[]; value: number | null; onPick: (i: number) => void; exclude?: number | null;
}) {
  return (
    <div className="choices">
      {players.map((n, i) => (
        <div key={i} className={"choice-btn" + (value === i ? " selected-choice" : "") + (exclude === i ? " locked" : "")}
          onClick={() => { haptic("selection"); onPick(i); }}>{n}</div>
      ))}
    </div>
  );
}

function MultiPicker({ players, sel, set }: {
  players: string[]; sel: number[]; set: (v: number[]) => void;
}) {
  return (
    <div className="choices">
      {players.map((n, i) => (
        <div key={i} className={"choice-btn" + (sel.includes(i) ? " selected-choice" : "")}
          onClick={() => { haptic("selection"); set(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]); }}>{n}</div>
      ))}
    </div>
  );
}
