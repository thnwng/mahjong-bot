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
  zimoBonusOf,
  money,
  applyTransfers,
} from "@/lib/sg/payout";
import { Action, stepsFor, buildResult, shootValue } from "@/lib/sg/actions";
import { getState, addRemoteAction, renameSeat, endSession, TrackerState, ActionMeta, BOT_APP_LINK } from "@/lib/sg/remote";

type LogEntry = { summary: string; transfers: Transfer[]; actioner?: string; meta?: ActionMeta | null };

// Render a log line from structured meta so it reflects the CURRENT seat names
// (rename rewrites the names in meta). Falls back to the frozen summary for
// pre-meta rows or anything unrecognized.
function renderLogLine(e: LogEntry): string {
  const m = e.meta;
  if (!m) return e.summary;
  switch (m.k) {
    case "hu": return `Hu: ${m.winner} wins off ${m.discarder}${m.tai ? ` (${m.tai} tai)` : ""}`;
    case "zimo": return `Zimo: ${m.winner} self-draws${m.tai ? ` (${m.tai} tai)` : ""}`;
    case "gang": {
      const how = m.mode === "an" ? "concealed gang (angang)" : m.payer ? `gang off ${m.payer}` : "self-gang (all pay)";
      return `Gang: ${m.konger} ${how}`;
    }
    case "yao": {
      const kind = m.concealed ? "concealed bite (anyao)" : "bite";
      return `${m.concealed ? "Anyao" : "Yao"}: ${m.biter} ${kind}${m.target ? ` on ${m.target}` : " (all pay)"}`;
    }
    default: return e.summary;
  }
}

function computeBalances(players: string[], log: { transfers: Transfer[] }[]): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  for (const e of log) applyTransfers(b, e.transfers);
  return b;
}

// ------------------------------------------------------------- action wizard

const ACTION_TITLES: Record<Action, { title: string; sub: string }> = {
  hu: { title: "Hu", sub: "win off a discard" },
  zimo: { title: "Zimo", sub: "self-draw" },
  gang: { title: "Gang", sub: "four of a kind" },
  yao: { title: "Yao", sub: "bite" },
};

// The "X shoot Y" transfer bubble: a payer dropdown, the word "shoot", and the
// receiver. When `fixedReceiver` is set (Gang/Yao — the konger/biter is already
// chosen) that side is locked; for Hu both ends are picked here. The payer list
// excludes the receiver, so a player can never shoot themselves. As soon as a
// valid (different) pair is chosen it commits and the wizard advances.
function ShootSelect({
  players,
  fixedReceiver,
  onPick,
}: {
  players: string[];
  fixedReceiver?: string;
  onPick: (v: string) => void;
}) {
  const [payer, setPayer] = useState("");
  const [freeReceiver, setFreeReceiver] = useState("");
  const rcv = fixedReceiver ?? freeReceiver;
  const payerOpts = players.filter((p) => p !== rcv);
  const receiverOpts = players.filter((p) => p !== payer);
  const tryCommit = (pa: string, re: string) => { if (pa && re && pa !== re) onPick(shootValue(pa, re)); };

  return (
    <div>
      <div className="shoot-box">
        <select className="text-input shoot-sel" value={payer}
          onChange={(e) => { haptic("selection"); setPayer(e.target.value); tryCommit(e.target.value, rcv); }}>
          <option value="">— who —</option>
          {payerOpts.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="shoot-word">shoot</span>
        {fixedReceiver ? (
          <select className="text-input shoot-sel" value={fixedReceiver} disabled aria-label="receiver (fixed)">
            <option value={fixedReceiver}>{fixedReceiver}</option>
          </select>
        ) : (
          <select className="text-input shoot-sel" value={freeReceiver}
            onChange={(e) => { haptic("selection"); setFreeReceiver(e.target.value); tryCommit(payer, e.target.value); }}>
            <option value="">— who —</option>
            {receiverOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginTop: 6 }}>
        The player on the left pays the one on the right. A player can&apos;t shoot themselves.
      </p>
    </div>
  );
}

function ActionWizard({
  action,
  players,
  bases,
  settle,
  onCancel,
  onConfirm,
}: {
  action: Action;
  players: string[];
  bases: PayoutConfig;
  settle: boolean;
  onCancel: () => void;
  onConfirm: (summary: string, transfers: Transfer[], meta: ActionMeta) => void;
}) {
  useClosingConfirmation(true); // guard the half-entered action against an accidental close
  const [picks, setPicks] = useState<Record<string, string>>({});
  const steps = stepsFor(action, picks, players, bases, settle);
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
    const r = buildResult(action, picks, players, bases, settle);
    return (
      <div>
        {head}
        <h2>Confirm</h2>
        <div className="result" style={{ marginTop: 0 }}>
          <div className="line"><strong>{r.summary}</strong></div>
          {r.transfers.map((t, i) => (
            <div key={i} className="line">{t.payer} pays {t.payee} <strong>{money(t.amount)}</strong></div>
          ))}
          {!settle && <div className="line" style={{ opacity: 0.7, fontSize: "0.85rem" }}>Log only — no payouts in this session.</div>}
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
      ) : current.kind === "shoot" ? (
        <ShootSelect players={players} fixedReceiver={current.fixedReceiver} onPick={(v) => pick(current.key, v)} />
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
  settle,
  title,
  balances,
  log,
  recordError,
  onRecord,
  onBack,
  banner,
}: {
  players: string[];
  bases: PayoutConfig;
  settle: boolean;
  title: string;
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
  // Payout-only actions disappear when their toggle is off / payouts are off.
  const yaoOn = settle && bases.yaoOn !== false;
  const gangOn = settle && bases.gangOn !== false;

  if (action)
    return <ActionWizard action={action} players={players} bases={bases} settle={settle} onCancel={() => setAction(null)}
      onConfirm={(s, t, m) => { onRecord(s, t, m); setAction(null); }} />;

  return (
    <div>
      <h1>{title}</h1>
      {banner}
      {settle ? (
        <>
          <h2>Session balances</h2>
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
            Payouts · 1 tai: shooter {money(discardValue(bases, 1))} / self-draw {money(zimoEachValue(bases, 1))} each
            {zimoBonusOf(bases) > 0 ? ` (+${money(zimoBonusOf(bases))} zimo bonus)` : ""}
            {yaoOn ? ` · bite ${money(bases.yao)}` : ""}{gangOn ? ` · gang ${money(bases.gang)} each` : ""} · up to {maxTaiOf(bases)} tai
          </p>
        </>
      ) : (
        <p style={{ fontSize: "0.85rem", opacity: 0.7 }}>No payouts this session — wins are logged, nothing is tallied.</p>
      )}

      <h2>Record action</h2>
      {recordError && <p className="err" style={{ marginTop: 0 }}>{recordError}</p>}
      <div className="choices">
        <div className="choice-btn" onClick={() => openAction("hu")}>Hu<small>win off discard</small></div>
        <div className="choice-btn" onClick={() => openAction("zimo")}>Zimo<small>self-draw</small></div>
        {gangOn && <div className="choice-btn" onClick={() => openAction("gang")}>Gang<small>four of a kind</small></div>}
        {yaoOn && <div className="choice-btn" onClick={() => openAction("yao")}>Yao<small>bite</small></div>}
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

export function Play({ initial, onBack, onEnded }: { initial: TrackerState; onBack: () => void; onEnded: (s: TrackerState) => void }) {
  const [state, setState] = useState<TrackerState>(initial);
  const [syncing, setSyncing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newSeat, setNewSeat] = useState("");
  const [renameErr, setRenameErr] = useState("");
  const [recErr, setRecErr] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const code = state.tracker.code;
  const session = state.session || null;
  // The players for THIS sitting are the session's chosen subset; fall back to
  // the full roster only when there's no session (shouldn't happen on this screen).
  const players = session?.players?.length ? session.players : state.tracker.players;
  // Money rules come from the SESSION (chosen on the start screen); the group's
  // bases are only the fallback for anything session-less.
  const bases = session?.bases || state.tracker.bases;
  const settle = session ? session.settle !== false : true;
  const title = session?.mahjong_type === "my3" ? "Malaysian (WIP)" : "Singaporean";
  const busyRef = useRef(false);
  const renamingRef = useRef(false); // pause polling while the rename editor is open
  // Monotonic epoch bumped on every local mutation. A poll started under an
  // older epoch must NOT overwrite state written by a newer mutation that
  // resolved first (a late-resolving getState would otherwise revert it).
  const epochRef = useRef(0);
  const endedRef = useRef(false); // fire onEnded exactly once

  const sessionGone = (s: TrackerState) => {
    if (endedRef.current) return true;
    if (!s.session) { endedRef.current = true; onEnded(s); return true; }
    return false;
  };

  // Poll for others' changes — but not while the app is backgrounded (a hidden
  // phone would otherwise burn ~24 function calls/min); refresh once on return.
  // If the session ended under us (someone else ended it / the 24h timeout),
  // hand the fresh state back to the group screen.
  useEffect(() => {
    const tick = async () => {
      if (busyRef.current || renamingRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const e = epochRef.current;
      try {
        const s = await getState(code);
        if (epochRef.current !== e) return;
        if (sessionGone(s)) return;
        setState(s);
      } catch { /* keep last */ }
    };
    const id = setInterval(tick, 2500);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const log: LogEntry[] = state.actions.map((a) => ({ summary: a.summary, transfers: a.transfers, actioner: a.actioner, meta: a.meta }));
  const balances = computeBalances(players, log);
  const shareLink = `${BOT_APP_LINK}?startapp=${code}`;

  const record = async (summary: string, transfers: Transfer[], meta?: ActionMeta) => {
    busyRef.current = true; epochRef.current++;
    setSyncing(true); setRecErr("");
    try { const s = await addRemoteAction(code, summary, transfers, meta, session?.id); if (!sessionGone(s)) setState(s); haptic("success"); }
    catch (e) {
      haptic("error");
      setRecErr("Couldn't record: " + String((e as Error).message || e));
      // The roster/session may have changed under us -> refresh so the user
      // re-picks against the current state (or lands back on the group page).
      try { const s = await getState(code); epochRef.current++; if (!sessionGone(s)) setState(s); } catch { /* keep last */ }
    }
    finally { busyRef.current = false; setSyncing(false); }
  };

  // End the sitting: freezes this session's money into the group debt counter.
  // Two-tap confirm (misclicks end a whole evening otherwise).
  const doEnd = async () => {
    if (!confirmEnd) { setConfirmEnd(true); haptic("warning"); return; }
    busyRef.current = true; epochRef.current++;
    setRecErr("");
    try { const s = await endSession(code); haptic("success"); endedRef.current = true; onEnded(s); }
    catch (e) {
      haptic("error");
      setRecErr("Couldn't end: " + String((e as Error).message || e));
      try { const s = await getState(code); epochRef.current++; if (!sessionGone(s)) setState(s); } catch { /* keep last */ }
    }
    finally { busyRef.current = false; setConfirmEnd(false); }
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
      settle={settle}
      title={title}
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
            {session && (
              <> ·{" "}
                <button className="link-btn" style={{ padding: 0, fontSize: "inherit", verticalAlign: "baseline" }}
                  onClick={doEnd}>
                  {confirmEnd ? "tap again to end session" : "end session"}
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
