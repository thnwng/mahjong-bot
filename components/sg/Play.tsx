"use client";

// The live game screen: balances + log + the record-action wizard.
//
// Recording an action is a step WIZARD — one question per screen (who won, off
// whose discard, how many tai, ...), each answer advancing to the next screen,
// with a back button (on-screen and the native Telegram one) at every step, and
// a final confirm screen that shows the exact money before anything is saved.

import { useEffect, useRef, useState } from "react";
import { haptic, useBackButton, useClosingConfirmation } from "@/lib/telegram";
import {
  Transfer,
  PayoutConfig,
  discardValue,
  zimoEachValue,
  maxTaiOf,
  money,
  settleDiscardWin,
  settleSelfDraw,
  settleYao,
  settleGang,
  applyTransfers,
} from "@/lib/sg/payout";
import { getState, addRemoteAction, renameSeat, TrackerState, ActionMeta, BOT_APP_LINK } from "@/lib/sg/remote";

type LogEntry = { summary: string; transfers: Transfer[]; actioner?: string; meta?: ActionMeta | null };

// Render a log line from structured meta so it reflects the CURRENT seat names
// (rename rewrites the names in meta). Falls back to the frozen summary for
// pre-meta rows or anything unrecognized.
function renderLogLine(e: LogEntry): string {
  const m = e.meta;
  if (!m) return e.summary;
  switch (m.k) {
    case "hu": return `Hu: ${m.winner} wins off ${m.discarder} (${m.tai} tai)`;
    case "zimo": return `Zimo: ${m.winner} self-draws (${m.tai} tai)`;
    case "gang": return `Gang: ${m.konger} kong${m.payer ? ` off ${m.payer}` : " (all pay)"}`;
    case "yao": return `Yao: ${m.biter} bite${m.target ? ` on ${m.target}` : " (all pay)"}`;
    default: return e.summary;
  }
}

function computeBalances(players: string[], log: { transfers: Transfer[] }[]): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  for (const e of log) applyTransfers(b, e.transfers);
  return b;
}

// ------------------------------------------------------------- action wizard

type Action = "hu" | "zimo" | "gang" | "yao";

const ACTION_TITLES: Record<Action, { title: string; sub: string }> = {
  hu: { title: "Hu", sub: "win off a discard" },
  zimo: { title: "Zimo", sub: "self-draw" },
  gang: { title: "Gang", sub: "kong" },
  yao: { title: "Yao", sub: "bite" },
};

type Opt = { v: string; label: string; hint?: string };
type StepDef = {
  key: string;
  title: string;
  kind: "people" | "nums" | "choice";
  options: Opt[];
  crumb: (v: string) => string;
};

// The ordered questions for an action, given the answers so far. Later steps
// depend on earlier answers (a discarder list excludes the winner; the
// "whose discard" step only exists when one person pays), so this recomputes
// each render — going back re-derives everything consistently.
function stepsFor(action: Action, picks: Record<string, string>, players: string[], bases: PayoutConfig): StepDef[] {
  const people = (exclude?: string): Opt[] =>
    players.filter((p) => p !== exclude).map((p) => ({ v: p, label: p }));
  const taiOpts = (value: (n: number) => string): Opt[] =>
    Array.from({ length: maxTaiOf(bases) }, (_, i) => ({ v: String(i + 1), label: String(i + 1), hint: value(i + 1) }));

  if (action === "hu") {
    return [
      { key: "winner", title: "Who won?", kind: "people", options: people(), crumb: (v) => v },
      { key: "discarder", title: "Off whose discard?", kind: "people", options: people(picks.winner), crumb: (v) => `off ${v}` },
      { key: "tai", title: "How many tai?", kind: "nums", options: taiOpts((n) => money(discardValue(bases, n))), crumb: (v) => `${v} tai` },
    ];
  }
  if (action === "zimo") {
    return [
      { key: "winner", title: "Who self-drew?", kind: "people", options: people(), crumb: (v) => v },
      { key: "tai", title: "How many tai?", kind: "nums", options: taiOpts((n) => `${money(zimoEachValue(bases, n))} each`), crumb: (v) => `${v} tai` },
    ];
  }
  if (action === "gang") {
    const steps: StepDef[] = [
      { key: "konger", title: "Who konged?", kind: "people", options: people(), crumb: (v) => v },
      {
        key: "scope", title: "Who pays?", kind: "choice",
        options: [
          { v: "everyone", label: "Everyone", hint: "self-drawn or concealed kong" },
          { v: "one", label: "One player", hint: "kong off a discard" },
        ],
        crumb: (v) => (v === "everyone" ? "everyone pays" : "one pays"),
      },
    ];
    if (picks.scope === "one") {
      steps.push({ key: "payer", title: "Whose discard?", kind: "people", options: people(picks.konger), crumb: (v) => `off ${v}` });
    }
    return steps;
  }
  // yao
  const steps: StepDef[] = [
    { key: "biter", title: "Who bit?", kind: "people", options: people(), crumb: (v) => v },
    {
      key: "scope", title: "Who pays?", kind: "choice",
      options: [
        { v: "everyone", label: "Everyone", hint: "each other player pays" },
        { v: "one", label: "One player", hint: "bite on one person" },
      ],
      crumb: (v) => (v === "everyone" ? "everyone pays" : "one pays"),
    },
  ];
  if (picks.scope === "one") {
    steps.push({ key: "target", title: "Who pays?", kind: "people", options: people(picks.biter), crumb: (v) => `on ${v}` });
  }
  return steps;
}

function buildResult(
  action: Action,
  picks: Record<string, string>,
  players: string[],
  bases: PayoutConfig,
): { summary: string; transfers: Transfer[]; meta: ActionMeta } {
  if (action === "hu") {
    const tai = parseInt(picks.tai);
    return {
      summary: `Hu: ${picks.winner} wins off ${picks.discarder} (${tai} tai)`,
      transfers: settleDiscardWin(picks.winner, picks.discarder, discardValue(bases, tai)),
      meta: { k: "hu", tai, winner: picks.winner, discarder: picks.discarder },
    };
  }
  if (action === "zimo") {
    const tai = parseInt(picks.tai);
    return {
      summary: `Zimo: ${picks.winner} self-draws (${tai} tai)`,
      transfers: settleSelfDraw(picks.winner, zimoEachValue(bases, tai), players),
      meta: { k: "zimo", tai, winner: picks.winner },
    };
  }
  if (action === "gang") {
    const payer = picks.scope === "one" ? picks.payer : null;
    return {
      summary: `Gang: ${picks.konger} kong${payer ? ` off ${payer}` : " (all pay)"}`,
      transfers: settleGang(picks.konger, bases.gang, players, payer),
      meta: { k: "gang", konger: picks.konger, payer: payer ?? null },
    };
  }
  const target = picks.scope === "one" ? picks.target : null;
  return {
    summary: `Yao: ${picks.biter} bite${target ? ` on ${target}` : " (all pay)"}`,
    transfers: settleYao(picks.biter, bases.yao, players, target),
    meta: { k: "yao", biter: picks.biter, target: target ?? null },
  };
}

function ActionWizard({
  action,
  players,
  bases,
  onCancel,
  onConfirm,
}: {
  action: Action;
  players: string[];
  bases: PayoutConfig;
  onCancel: () => void;
  onConfirm: (summary: string, transfers: Transfer[], meta: ActionMeta) => void;
}) {
  useClosingConfirmation(true); // guard the half-entered action against an accidental close
  const [picks, setPicks] = useState<Record<string, string>>({});
  const steps = stepsFor(action, picks, players, bases);
  const answered = steps.filter((st) => picks[st.key] !== undefined);
  const current = steps.find((st) => picks[st.key] === undefined) ?? null; // null -> confirm screen

  // Back = undo the LAST answer (both buttons); with nothing answered, cancel
  // the whole action and return to the dashboard.
  const goBack = () => {
    if (answered.length === 0) { onCancel(); return; }
    const last = answered[answered.length - 1].key;
    setPicks((prev) => { const n = { ...prev }; delete n[last]; return n; });
  };
  useBackButton(goBack);

  const pick = (k: string, v: string) => { haptic("selection"); setPicks((p) => ({ ...p, [k]: v })); };

  const head = (
    <>
      <h1>{ACTION_TITLES[action].title} <small>{ACTION_TITLES[action].sub}</small></h1>
      {answered.length > 0 && (
        <p className="wizard-crumb">{answered.map((st) => st.crumb(picks[st.key])).join(" · ")}</p>
      )}
    </>
  );

  if (!current) {
    const r = buildResult(action, picks, players, bases);
    return (
      <div>
        {head}
        <h2>Confirm</h2>
        <div className="result" style={{ marginTop: 0 }}>
          <div className="line"><strong>{r.summary}</strong></div>
          {r.transfers.map((t, i) => (
            <div key={i} className="line">{t.payer} pays {t.payee} <strong>{money(t.amount)}</strong></div>
          ))}
        </div>
        <button className="primary-btn" onClick={() => onConfirm(r.summary, r.transfers, r.meta)}>
          Record {ACTION_TITLES[action].title}
        </button>
        <button className="link-btn" onClick={goBack}>← Back</button>
      </div>
    );
  }

  return (
    <div>
      {head}
      <h2>{current.title}</h2>
      {current.kind === "nums" ? (
        <div className="num-grid">
          {current.options.map((o) => (
            <div key={o.v} className="num-btn" onClick={() => pick(current.key, o.v)}>
              {o.label}
              {o.hint && <small>{o.hint}</small>}
            </div>
          ))}
        </div>
      ) : (
        <div className="choices">
          {current.options.map((o) => (
            <div key={o.v} className="choice-btn" onClick={() => pick(current.key, o.v)}>
              {o.label}
              {o.hint && <small>{o.hint}</small>}
            </div>
          ))}
        </div>
      )}
      <button className="link-btn" onClick={goBack}>← Back</button>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function Dashboard({
  players,
  bases,
  balances,
  log,
  recordError,
  onRecord,
  onBack,
  banner,
}: {
  players: string[];
  bases: PayoutConfig;
  balances: Record<string, number>;
  log: LogEntry[];
  recordError?: string;
  onRecord: (summary: string, transfers: Transfer[], meta?: ActionMeta) => void;
  onBack: () => void;
  banner?: React.ReactNode;
}) {
  useBackButton(onBack);
  const [action, setAction] = useState<Action | null>(null);
  const openAction = (a: Action) => { haptic("light"); setAction(a); };

  if (action)
    return <ActionWizard action={action} players={players} bases={bases} onCancel={() => setAction(null)}
      onConfirm={(s, t, m) => { onRecord(s, t, m); setAction(null); }} />;

  return (
    <div>
      <h1>Singaporean</h1>
      {banner}
      <h2>Balances</h2>
      <div className="balances">
        {players.map((p) => (
          <div key={p} className="bal-row">
            <span>{p}</span>
            <span className={"bal " + ((balances[p] || 0) >= 0 ? "pos" : "neg")}>
              {(balances[p] || 0) >= 0 ? "+" : ""}{(balances[p] || 0).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.78rem", opacity: 0.65 }}>
        Payouts · 1 tai: shooter {money(discardValue(bases, 1))} / self-draw {money(zimoEachValue(bases, 1))} each ·
        {" "}bite {money(bases.yao)} · kong {money(bases.gang)} each · up to {maxTaiOf(bases)} tai
      </p>

      <h2>Record action</h2>
      {recordError && <p className="err" style={{ marginTop: 0 }}>{recordError}</p>}
      <div className="choices">
        <div className="choice-btn" onClick={() => openAction("hu")}>Hu<small>win off discard</small></div>
        <div className="choice-btn" onClick={() => openAction("zimo")}>Zimo<small>self-draw</small></div>
        <div className="choice-btn" onClick={() => openAction("gang")}>Gang<small>kong</small></div>
        <div className="choice-btn" onClick={() => openAction("yao")}>Yao<small>bite</small></div>
      </div>

      {log.length > 0 && (
        <>
          <h2>Log</h2>
          <div className="log">
            {log.map((e, i) => (
              <div key={i} className="log-row">{i + 1}. {renderLogLine(e)}{e.actioner ? ` — ${e.actioner}` : ""}</div>
            ))}
          </div>
        </>
      )}

      <button className="link-btn" onClick={onBack}>← Menu</button>
    </div>
  );
}

// ------------------------------------------------------------- synced player

export function Play({ initial, onBack }: { initial: TrackerState; onBack: () => void }) {
  const [state, setState] = useState<TrackerState>(initial);
  const [syncing, setSyncing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newSeat, setNewSeat] = useState("");
  const [renameErr, setRenameErr] = useState("");
  const [recErr, setRecErr] = useState("");
  const code = state.tracker.code;
  const players = state.tracker.players;
  const bases = state.tracker.bases;
  const busyRef = useRef(false);
  const renamingRef = useRef(false); // pause polling while the rename editor is open
  // Monotonic epoch bumped on every local mutation. A poll started under an
  // older epoch must NOT overwrite state written by a newer mutation that
  // resolved first (a late-resolving getState would otherwise revert it).
  const epochRef = useRef(0);

  // Poll for others' changes — but not while the app is backgrounded (a hidden
  // phone would otherwise burn ~24 function calls/min); refresh once on return.
  useEffect(() => {
    const tick = async () => {
      if (busyRef.current || renamingRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const e = epochRef.current;
      try { const s = await getState(code); if (epochRef.current === e) setState(s); } catch { /* keep last */ }
    };
    const id = setInterval(tick, 2500);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [code]);

  const log: LogEntry[] = state.actions.map((a) => ({ summary: a.summary, transfers: a.transfers, actioner: a.actioner, meta: a.meta }));
  const balances = computeBalances(players, log);
  const shareLink = `${BOT_APP_LINK}?startapp=${code}`;

  const record = async (summary: string, transfers: Transfer[], meta?: ActionMeta) => {
    busyRef.current = true; epochRef.current++;
    setSyncing(true); setRecErr("");
    try { setState(await addRemoteAction(code, summary, transfers, meta)); haptic("success"); }
    catch (e) {
      haptic("error");
      setRecErr("Couldn't record: " + String((e as Error).message || e));
      // The roster may have changed under us (e.g. a rename) -> refresh so the
      // user re-picks against the current seats.
      try { const s = await getState(code); epochRef.current++; setState(s); } catch { /* keep last */ }
    }
    finally { busyRef.current = false; setSyncing(false); }
  };

  const openRename = () => { setNewSeat(state.me || ""); setRenameErr(""); setRenaming(true); renamingRef.current = true; };
  const closeRename = () => { setRenaming(false); setRenameErr(""); renamingRef.current = false; };

  // Rename your own seat (your display name in this group). The server rewrites
  // the roster + past transfers so your balance follows the new name.
  const doRename = async () => {
    const nm = newSeat.trim();
    if (!nm || nm === state.me) { closeRename(); return; }
    busyRef.current = true; epochRef.current++;
    setRenameErr("");
    try { setState(await renameSeat(code, nm)); haptic("success"); closeRename(); }
    catch (e) { haptic("error"); setRenameErr(String((e as Error).message || e)); }
    finally { busyRef.current = false; }
  };

  return (
    <Dashboard
      players={players}
      bases={bases}
      balances={balances}
      log={log}
      recordError={recErr}
      onRecord={record}
      onBack={onBack}
      banner={
        <div className="result" style={{ marginTop: 0, marginBottom: 14 }}>
          <div className="line">
            <strong>Code {code}</strong> {syncing ? "· syncing…" : "· live"}
            {state.me && !renaming && (
              <> · you are{" "}
                <button className="link-btn" style={{ padding: 0, fontSize: "inherit", verticalAlign: "baseline" }}
                  onClick={openRename}>
                  {state.me} ✎
                </button>
              </>
            )}
          </div>
          {renaming && (
            <div className="line" style={{ marginTop: 6 }}>
              <input className="text-input small" autoFocus value={newSeat} maxLength={40}
                onChange={(e) => setNewSeat(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doRename(); }} />
              <button className="chip" onClick={doRename}>Save</button>
              <button className="chip" onClick={closeRename}>Cancel</button>
              {renameErr && <span className="err" style={{ fontSize: "0.8rem" }}> {renameErr}</span>}
            </div>
          )}
          <div className="line" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{shareLink}</div>
        </div>
      }
    />
  );
}
