"use client";

// Two screens for a group:
//  - GroupScreen: the group's share link, its ROSTER of names (add placeholders,
//    claim a seat = "join as this name"), the debt counter, and the entry point
//    to start a session.
//  - NewSession: one page that walks type -> who's playing (a subset of the
//    roster) -> payouts, with later sections greyed until the earlier one's done.

import { useMemo, useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { PayoutConfig, money } from "@/lib/sg/payout";
import { PayoutEditor } from "./PayoutEditor";
import {
  TrackerState,
  PayoutPreset,
  GAME_TYPES,
  addName,
  claimSeat,
  joinNew,
  settleDebt,
  BOT_APP_LINK,
} from "@/lib/sg/remote";

const seatsFor = (mahjongType: string) => (mahjongType === "my3" ? 3 : 4);
const typeLabel = (v: string) => GAME_TYPES.find((g) => g.v === v)?.label || v;

// Greedy "who pays who" suggestion from net balances: biggest debtor pays
// biggest creditor until everyone is square. Not unique, but minimal-ish.
export function settleUp(net: Record<string, number>): { from: string; to: string; amount: number }[] {
  const EPS = 0.004;
  const debtors = Object.entries(net).filter(([, v]) => v < -EPS).map(([n, v]) => ({ n, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = Object.entries(net).filter(([, v]) => v > EPS).map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].v, creditors[j].v);
    out.push({ from: debtors[i].n, to: creditors[j].n, amount: pay });
    debtors[i].v -= pay; creditors[j].v -= pay;
    if (debtors[i].v <= EPS) i++;
    if (creditors[j].v <= EPS) j++;
  }
  return out;
}

const hoursLeft = (startedAt: string) => {
  const ms = new Date(startedAt).getTime() + 24 * 3600 * 1000 - Date.now();
  return Math.max(0, Math.round(ms / 3600000));
};

export function GroupScreen({
  state,
  onState,
  busy,
  onNewSession,
  onEnterSession,
  onOpenSettings,
  onBack,
}: {
  state: TrackerState;
  onState: (s: TrackerState) => void;
  busy?: boolean;
  onNewSession: () => void;
  onEnterSession: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const t = state.tracker;
  const session = state.session || null;
  const debts = state.debts || {};
  const roster = t.players || [];
  const claimed = new Set(state.claimedNames || []);
  const me = state.me || null;
  const shareLink = `${BOT_APP_LINK}?startapp=${t.code}`;

  const [work, setWork] = useState(false);
  const [gErr, setGErr] = useState("");
  const [newName, setNewName] = useState("");
  const [mine, setMine] = useState(false); // "the name I'm adding is me" (join + claim)

  const run = async (fn: () => Promise<TrackerState>) => {
    setWork(true); setGErr("");
    try { onState(await fn()); haptic("success"); }
    catch (e) { haptic("error"); setGErr(String((e as Error).message || e)); }
    finally { setWork(false); }
  };
  const addPlayer = () => {
    const n = newName.trim();
    if (!n) return;
    setNewName("");
    const code = t.code;
    run(() => (mine && !me ? joinNew(code, n) : addName(code, n)));
    setMine(false);
  };
  const claim = (name: string) => run(() => claimSeat(t.code, name));

  const net = roster.map((p) => ({ p, v: debts[p] || 0 }));
  const anyDebt = net.some((x) => Math.abs(x.v) > 0.004);
  const suggestions = useMemo(() => settleUp(debts), [debts]);
  const enoughToStart = roster.length >= 3;

  // All-time tally: career win/loss per player (union of everyone who's won/lost
  // money or sat in a finished session), biggest winner first.
  const career = useMemo(() => {
    const at = state.allTime || {};
    const gm = state.games || {};
    const names = new Set([...Object.keys(at), ...Object.keys(gm)]);
    return [...names]
      .map((p) => ({ p, v: at[p] || 0, g: gm[p] || 0 }))
      .filter((x) => x.g > 0 || Math.abs(x.v) > 0.004)
      .sort((a, b) => b.v - a.v);
  }, [state.allTime, state.games]);
  const settlements = state.settlements || [];

  // Only a party to a debt can settle it (you can settle whether you owe or are
  // owed). Two-tap confirm — the app's standard for irreversible money actions
  // (same as end-session in Play; window.confirm is unreliable in Telegram
  // WebViews). One confirmed tap clears the whole pairwise line from the tally.
  const [confirmSettle, setConfirmSettle] = useState<string | null>(null);
  const doSettle = (from: string, to: string, amount: number) => {
    const key = `${from}>${to}`;
    if (confirmSettle !== key) { setConfirmSettle(key); haptic("warning"); return; }
    setConfirmSettle(null);
    run(() => settleDebt(t.code, from, to, amount));
  };

  return (
    <div>
      <h1>{t.name || t.code}</h1>
      <div className="result banner">
        <div className="line"><strong>Code {t.code}</strong>{me ? <> · you are <strong>{me}</strong></> : null}</div>
        <div className="line meta" style={{ wordBreak: "break-all" }}>{shareLink}</div>
        <div className="line meta">Share this link (or the code) so others can join.</div>
      </div>

      <button className="link-btn" style={{ marginTop: 0 }} onClick={onOpenSettings}>Group settings (scoring) →</button>

      {/* Roster: every name in the group. Anyone can add names; if you haven't
          claimed a seat, tap "This is me" on a name (or add your own). */}
      <h2>Players <small>({roster.length})</small></h2>
      {roster.length === 0 ? (
        <p className="hint">No names yet — add everyone who&apos;ll play (you can add placeholders and let people claim them).</p>
      ) : (
        <div className="balances">
          {roster.map((p) => (
            <div key={p} className="bal-row" style={{ alignItems: "center" }}>
              <span>
                {p}
                {me === p ? <strong style={{ color: "var(--button)" }}> · you</strong>
                  : claimed.has(p) ? <span className="meta"> · joined</span>
                  : <span className="meta"> · open</span>}
              </span>
              {!me && !claimed.has(p) && (
                <button className="chip" disabled={work || busy} onClick={() => claim(p)}>This is me</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ alignItems: "center", gap: 8, marginTop: 8 }}>
        <input className="text-input" style={{ marginBottom: 0 }} placeholder={mine ? "your name" : "add a name"}
          maxLength={30} value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addPlayer(); }} />
        <button className="chip" disabled={work || busy || !newName.trim()} onClick={addPlayer}>
          {mine && !me ? "Join" : "+ Add"}
        </button>
      </div>
      {!me && (
        <label className="row" style={{ alignItems: "center", gap: 6, marginTop: 4, fontSize: "0.8rem", opacity: 0.8, cursor: "pointer" }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>This name is me (join as it)</span>
        </label>
      )}
      {gErr && <p className="err">{gErr}</p>}

      {/* Session */}
      {session ? (
        <>
          <h2>Session running</h2>
          <div className="result banner">
            <div className="line">
              <strong>{typeLabel(session.mahjong_type)}</strong>
              {session.settle === false ? " · no payouts (ownself settle)" : ""}
            </div>
            <div className="line meta">
              {(session.players || []).join(", ")}
            </div>
            <div className="line meta">
              Started by {session.started_by || "?"} · auto-ends in about {hoursLeft(session.started_at)}h (or end it inside)
            </div>
          </div>
          <button className="primary-btn" disabled={busy} onClick={() => { haptic("light"); onEnterSession(); }}>
            Enter session
          </button>
        </>
      ) : (
        <>
          <h2>No session running</h2>
          <p className="hint">
            Start one when you sit down — pick who&apos;s playing and the payouts. It tallies into the debt counter when it ends.
          </p>
          <button className="primary-btn" disabled={busy || work || !enoughToStart} onClick={() => { haptic("light"); onNewSession(); }}>
            Start a session
          </button>
          {!enoughToStart && <p className="hint">Add at least 3 names above to start a session.</p>}
        </>
      )}

      <h2>Debt counter</h2>
      {!anyDebt ? (
        <p className="hint">All square — nothing outstanding from past sessions.</p>
      ) : (
        <>
          <div className="balances">
            {net.filter((x) => Math.abs(x.v) > 0.004).map(({ p, v }) => (
              <div key={p} className="bal-row">
                <span>{p}</span>
                <span className={"bal " + (v >= 0 ? "pos" : "neg")}>{v >= 0 ? "+" : ""}{money(v)}</span>
              </div>
            ))}
          </div>
          {suggestions.length > 0 && (
            <>
              {/* Who owes who: each pairwise payment. If you're a party to a
                  line, a Settle up button records the repayment and clears it. */}
              <h2>Who owes who</h2>
              <div className="balances">
                {suggestions.map((s, i) => {
                  const mineLine = me != null && (s.from === me || s.to === me);
                  const arming = confirmSettle === `${s.from}>${s.to}`;
                  return (
                    <div key={i} className="bal-row" style={{ alignItems: "center" }}>
                      <span>{s.from} pays {s.to} <strong>{money(s.amount)}</strong></span>
                      {mineLine && (
                        <button className="chip" disabled={work || busy} onClick={() => doSettle(s.from, s.to, s.amount)}>
                          {arming ? "Tap again to settle" : "Settle up"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {!me && (
                <p className="fine">
                  Tap &ldquo;This is me&rdquo; on your name above to settle debts you&apos;re part of.
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* All-time tally: total won/lost across every finished session (settling
          up doesn't move these — a repayment isn't a win or a loss). */}
      <h2>All-time tally</h2>
      {career.length === 0 ? (
        <p className="hint">No finished sessions yet — it fills in as sessions end.</p>
      ) : (
        <div className="balances">
          {career.map(({ p, v, g }) => (
            <div key={p} className="bal-row">
              <span>
                {p}
                {g > 0 && <span className="meta"> · {g} game{g === 1 ? "" : "s"}</span>}
              </span>
              <span className={"bal " + (v >= 0 ? "pos" : "neg")}>{v >= 0 ? "+" : ""}{money(v)}</span>
            </div>
          ))}
        </div>
      )}

      {settlements.length > 0 && (
        <>
          <h2>Settled up</h2>
          <div className="log">
            {settlements.map((s, i) => (
              <div key={i} className="log-row" style={{ opacity: 0.85 }}>
                {s.from} paid {s.to} <strong>{money(s.amount)}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}

// ------------------------------------------------------------ session setup

// A locked (not-yet-relevant) section gets the shared .locked class.
const lockCls = (locked: boolean) => (locked ? " locked" : "");

export function NewSession({
  state,
  presets,
  busy,
  error,
  onStart,
  onBack,
}: {
  state: TrackerState;
  presets: PayoutPreset[];
  busy?: boolean;
  error?: string;
  onStart: (opts: { mahjongType: string; players: string[]; settle: boolean; bases?: PayoutConfig }) => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const t = state.tracker;
  const roster = t.players || [];

  const [mtype, setMtype] = useState(t.default_type === "my3" ? "my3" : "sg4");
  const need = seatsFor(mtype);
  const [selected, setSelected] = useState<string[]>([]);
  const [payCfg, setPayCfg] = useState<PayoutConfig | null>(null);

  const enoughNames = roster.length >= need;
  const playersPicked = selected.length === need;
  const ready = enoughNames && playersPicked && payCfg !== null;

  const toggle = (name: string) => {
    haptic("selection");
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((p) => p !== name);
      if (prev.length >= need) return prev; // can't pick more than the table seats
      return [...prev, name];
    });
  };

  // Switching type changes how many seats there are; drop selections that no
  // longer fit so we never start with the wrong count.
  const pickType = (v: string) => {
    haptic("selection");
    setMtype(v);
    setSelected((prev) => prev.slice(0, seatsFor(v)));
  };

  const start = () => {
    if (!ready) return;
    onStart({ mahjongType: mtype, players: selected, settle: true, bases: payCfg! });
  };

  return (
    <div>
      <h1>Start a session</h1>
      <p className="hint">
        One sitting at the table. Pick the type, who&apos;s playing, and the payouts. It tallies into the group&apos;s debt counter when it ends.
      </p>

      {/* 1. Type */}
      <h2>Mahjong type</h2>
      <div className="row">
        {[{ v: "sg4", label: "Singaporean (4p)" }, { v: "my3", label: "Malaysian (3p) — WIP" }].map((o) => (
          <button type="button" key={o.v} className={"chip" + (mtype === o.v ? " selected" : "")}
            onClick={() => pickType(o.v)}>{o.label}</button>
        ))}
      </div>
      {mtype === "my3" && (
        <p className="fine">
          Malaysian scoring isn&apos;t built yet — the session runs with the Singaporean actions for now. (WIP)
        </p>
      )}

      {/* 2. Who's playing */}
      <h2>Who&apos;s playing <small>({selected.length}/{need})</small></h2>
      {!enoughNames ? (
        <p className="err">This group has {roster.length} name{roster.length === 1 ? "" : "s"} — add {need - roster.length} more on the group page to play {need}-player.</p>
      ) : (
        <>
          <p className="hint">Tick exactly {need} players for this session.</p>
          <div className="choices">
            {roster.map((p) => {
              const on = selected.includes(p);
              const full = !on && selected.length >= need;
              return (
                <div key={p} className={"choice-btn" + (on ? " selected-choice" : "") + lockCls(full)}
                  onClick={() => (!full || on) && toggle(p)}>
                  {p}{on && <small>playing</small>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 3. Payouts — the same table as the old create screen (greyed until the
          right number of players is picked). */}
      <h2 className={playersPicked ? undefined : "locked"}>Payouts</h2>
      <div className={playersPicked ? undefined : "locked"}>
        <PayoutEditor presets={presets} onChange={setPayCfg} />
      </div>

      <button className="primary-btn" disabled={busy || !ready} onClick={start}>{busy ? "Starting…" : "Start session"}</button>
      {error && <p className="err">{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
