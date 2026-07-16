"use client";

// The group screen: header (name + rename pencil + settings gear), an invite box,
// the players roster (claim / remove / add), then a tabbed subsection —
// Sessions (history + start/enter/delete) and $ (debts, who-owes-who, all-time).
// NewSession = one page: type -> who's playing -> optional name -> payouts.

import { useMemo, useState } from "react";
import { haptic, useBackButton, copyToClipboard, shareToChat } from "@/lib/telegram";
import { PayoutConfig, money } from "@/lib/sg/payout";
import { PayoutEditor } from "./PayoutEditor";
import {
  TrackerState,
  PayoutPreset,
  SessionSummary,
  GAME_TYPES,
  addName,
  claimSeat,
  joinNew,
  settleDebt,
  renameGroup,
  removePlayer,
  deleteSession,
  sendInviteToChat,
  BOT_APP_LINK,
} from "@/lib/sg/remote";
import { IconSettings, IconEdit, IconCopy, IconClose, IconDelete, IconBack, IconSend, IconShare, IconPersonCheck, IconLogin, IconPlay, IconAdd } from "./icons";

const seatsFor = (mahjongType: string) => (mahjongType === "my3" ? 3 : 4);
const typeLabel = (v: string) => GAME_TYPES.find((g) => g.v === v)?.label || v;
const ROSTER_MAX = 12;

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
const sessDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch { return ""; }
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

  const [tab, setTab] = useState<"history" | "money">("history");
  const [work, setWork] = useState(false);
  const [gErr, setGErr] = useState("");
  const [addFields, setAddFields] = useState<string[]>([""]);
  const [mine, setMine] = useState(false); // "the first name I'm adding is me" (join + claim)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(t.name || "");
  const [copied, setCopied] = useState(false);
  const [confirmDelSess, setConfirmDelSess] = useState<string | null>(null);
  const [delNotice, setDelNotice] = useState<string | null>(null); // session id whose delete was blocked

  const run = async (fn: () => Promise<TrackerState>) => {
    setWork(true); setGErr("");
    try { onState(await fn()); haptic("success"); return true; }
    catch (e) { haptic("error"); setGErr(String((e as Error).message || e)); return false; }
    finally { setWork(false); }
  };
  const claim = (name: string) => run(() => claimSeat(t.code, name));

  // Add-name fields auto-grow: typing in the last one spawns another empty field.
  const setAddField = (i: number, v: string) => setAddFields((prev) => {
    const next = [...prev]; next[i] = v;
    if (i === next.length - 1 && v.trim() && next.length < ROSTER_MAX - roster.length) next.push("");
    return next;
  });
  const commitAdds = async () => {
    const names = [...new Set(addFields.map((s) => s.trim()).filter(Boolean))]; // dedupe within the batch
    if (!names.length) return;
    let ok = true;
    for (let i = 0; i < names.length && ok; i++) {
      const n = names[i];
      const inRoster = roster.includes(n);
      if (i === 0 && mine && !me) {
        // "first name is me": claim it if the seat already exists, else join as new.
        ok = await run(() => (inRoster ? claimSeat(t.code, n) : joinNew(t.code, n)));
      } else if (!inRoster) {
        ok = await run(() => addName(t.code, n));
      }
    }
    if (ok) { setAddFields([""]); setMine(false); }
  };

  const doRemove = (name: string) => {
    if (confirmRemove !== name) { setConfirmRemove(name); haptic("warning"); return; }
    setConfirmRemove(null);
    run(() => removePlayer(t.code, name));
  };

  const doRename = async () => {
    const n = renameVal.trim();
    if (!n || n === t.name) { setRenaming(false); return; }
    if (await run(() => renameGroup(t.code, n))) setRenaming(false);
  };

  const copyLink = async () => {
    haptic("selection");
    if (await copyToClipboard(shareLink)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  const net = roster.map((p) => ({ p, v: debts[p] || 0 }));
  const anyDebt = net.some((x) => Math.abs(x.v) > 0.004);
  const enoughToStart = roster.length >= 3;

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
  const sessions = state.sessions || [];
  const endedSessions = sessions.filter((s) => s.ended_at);
  // Per-session outstanding for the $ tab (0008): each ended session that still
  // owes gets its own who-owes-who + settle buttons (settling clears just that
  // session). `legacyResidual` = aggregate debt not tied to any session (pre-0008
  // repayments), which settles the old aggregate way (no sessionId).
  const sessionDebts = endedSessions
    .map((s) => ({ s, pairs: settleUp(s.outstanding || {}) }))
    .filter((x) => x.pairs.length > 0);
  const legacyResidual = (() => {
    const r: Record<string, number> = { ...debts };
    for (const s of endedSessions) for (const [p, v] of Object.entries(s.outstanding || {})) r[p] = (r[p] || 0) - v;
    return settleUp(r);
  })();

  const [confirmSettle, setConfirmSettle] = useState<string | null>(null);
  const doSettle = (from: string, to: string, amount: number, sessionId?: string) => {
    const key = `${sessionId || ""}:${from}>${to}`;
    if (confirmSettle !== key) { setConfirmSettle(key); haptic("warning"); return; }
    setConfirmSettle(null);
    run(() => settleDebt(t.code, from, to, amount, sessionId));
  };
  // One who-owes-who row (+ Settle button if I'm a party). sessionId scopes the
  // repayment to that session; omitted = legacy aggregate settle.
  const payRow = (pair: { from: string; to: string; amount: number }, i: number, sessionId?: string) => {
    const mineLine = me != null && (pair.from === me || pair.to === me);
    const arming = confirmSettle === `${sessionId || ""}:${pair.from}>${pair.to}`;
    return (
      <div key={i} className="bal-row" style={{ alignItems: "center" }}>
        <span>{pair.from} pays {pair.to} <strong>{money(pair.amount)}</strong></span>
        {mineLine && (
          <button className="chip" disabled={work || busy} onClick={() => doSettle(pair.from, pair.to, pair.amount, sessionId)}>
            {arming ? "Tap again to settle" : "Settle up"}
          </button>
        )}
      </div>
    );
  };

  const doDeleteSession = (id: string, ended: boolean) => {
    // Rule: an ended session can only be deleted once ITS OWN debt is settled
    // (unless the whole group is already square). Advise settling first — the
    // notice renders next to this session, not off-screen.
    if (ended) {
      const s = endedSessions.find((x) => x.id === id);
      const sessOwed = Object.values(s?.outstanding || {}).some((v) => Math.abs(v) > 0.004);
      if (sessOwed && anyDebt) { setDelNotice(id); setConfirmDelSess(null); haptic("warning"); return; }
    }
    if (confirmDelSess !== id) { setConfirmDelSess(id); setDelNotice(null); haptic("warning"); return; }
    setConfirmDelSess(null);
    run(() => deleteSession(t.code, id));
  };

  // Switching tabs disarms any pending delete — a stale two-tap arm or notice
  // must not survive navigation (it wouldn't name which session it targets).
  const goTab = (x: "history" | "money") => { setTab(x); setConfirmDelSess(null); setDelNotice(null); };

  const netLine = (n: Record<string, number>) => Object.entries(n)
    .filter(([, v]) => Math.abs(v) > 0.004)
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => `${name} ${v >= 0 ? "+" : ""}${money(v)}`)
    .join(" · ");

  return (
    <div>
      {/* Header: name + rename pencil, settings gear top-right */}
      <div className="group-head">
        {renaming ? (
          <div className="row" style={{ flex: 1, alignItems: "center" }}>
            <input className="text-input" style={{ marginBottom: 0, flex: 1 }} autoFocus maxLength={40}
              value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setRenaming(false); }} />
            <button className="chip" disabled={work} onClick={doRename}>Save</button>
            <button className="link-btn inline" onClick={() => { setRenaming(false); setRenameVal(t.name || ""); }}>Cancel</button>
          </div>
        ) : (
          <h1 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {t.name || t.code}
            <button className="icon-btn" aria-label="Rename group" onClick={() => { setRenameVal(t.name || ""); setRenaming(true); }}><IconEdit /></button>
          </h1>
        )}
        <button className="icon-btn" aria-label="Group settings" onClick={onOpenSettings}><IconSettings /></button>
      </div>

      {/* Invite box (above players) */}
      <div className="result banner">
        <div className="line"><strong>Code {t.code}</strong>{me ? <> · you are <strong>{me}</strong></> : null}</div>
        <div className="invite-row">
          <span className="invite-link">{shareLink}</span>
          <button className="icon-btn" aria-label="Copy invite link" onClick={copyLink}><IconCopy /></button>
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <button className="chip with-ico" disabled={work || busy} onClick={() => run(() => sendInviteToChat(t.code))}><IconSend size={16} />Send to the group</button>
          <button className="chip with-ico" onClick={() => { haptic("selection"); shareToChat(shareLink, `Join "${t.name || "our"}" mahjong group`); }}><IconShare size={16} />Forward to a chat</button>
        </div>
        {copied && <div className="line meta">Link copied.</div>}
      </div>

      {/* Players */}
      <h2>Players <small>({roster.length})</small></h2>
      {roster.length === 0 ? (
        <p className="hint">No names yet — add everyone who&apos;ll play (placeholders are fine; people can claim them).</p>
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
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!me && !claimed.has(p) && (
                  <button className="chip with-ico" disabled={work || busy} onClick={() => claim(p)}><IconPersonCheck size={16} />This is me</button>
                )}
                <button className="icon-btn danger" aria-label={`Remove ${p}`} disabled={work || busy} onClick={() => doRemove(p)}><IconClose /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      {confirmRemove && (
        <p className="warn">
          Remove <strong>{confirmRemove}</strong>? Settle their money first — you can only remove someone whose
          balance is zero. Tap the ✕ again to confirm.
        </p>
      )}

      {/* Add names — fields auto-spawn as you fill them */}
      {roster.length < ROSTER_MAX && (
        <div style={{ marginTop: 8 }}>
          {addFields.map((v, i) => (
            <input key={i} className="text-input" style={{ marginBottom: 6 }} maxLength={30}
              placeholder={i === 0 ? (mine && !me ? "your name" : "add a name") : "add a name"}
              value={v} onChange={(e) => setAddField(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitAdds(); }} />
          ))}
          <div className="row" style={{ alignItems: "center" }}>
            <button className="chip with-ico" disabled={work || busy || !addFields.some((s) => s.trim())} onClick={commitAdds}>
              <IconAdd size={16} />{mine && !me ? "Join / add" : "Add"}
            </button>
            {!me && (
              <label className="row" style={{ alignItems: "center", gap: 6, fontSize: "0.8rem", opacity: 0.8, cursor: "pointer" }}>
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
                <span>first name is me</span>
              </label>
            )}
          </div>
        </div>
      )}
      {gErr && <p className="err">{gErr}</p>}

      <hr className="section-break" />

      {/* Tabbed subsection: Sessions | $ */}
      <div className="tabs">
        <button type="button" className={"tab" + (tab === "history" ? " on" : "")} onClick={() => goTab("history")}>Sessions</button>
        <button type="button" className={"tab" + (tab === "money" ? " on" : "")} onClick={() => goTab("money")}>$</button>
      </div>

      {tab === "history" ? (
        <>
          {session ? (
            <div className="result banner">
              <div className="line">
                <strong>Running{session.name ? `: ${session.name}` : ""}</strong>
                {" · "}{typeLabel(session.mahjong_type)}{session.settle === false ? " · no payouts" : ""}
              </div>
              <div className="line meta">{(session.players || []).join(", ")}</div>
              <div className="line meta">Started by {session.started_by || "?"} · auto-ends in ~{hoursLeft(session.started_at)}h</div>
              <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
                <button className="chip on with-ico" disabled={busy} onClick={() => { haptic("light"); onEnterSession(); }}><IconLogin size={16} />Enter session</button>
                <button className="icon-btn danger" aria-label="Delete running session" disabled={work || busy} onClick={() => doDeleteSession(session.id, false)}><IconDelete /></button>
              </div>
              {confirmDelSess === session.id && <p className="warn">Delete the running session and its money? Tap the trash again to confirm.</p>}
            </div>
          ) : (
            <>
              <p className="hint">Start one when you sit down — pick who&apos;s playing, name it, set payouts. It tallies into $ when it ends.</p>
              <button className="chip on with-ico" disabled={busy || work || !enoughToStart} onClick={() => { haptic("light"); onNewSession(); }}><IconPlay size={16} />Start a session</button>
              {!enoughToStart && <p className="fine">Add at least 3 names above to start a session.</p>}
            </>
          )}

          <h2>Past sessions</h2>
          {endedSessions.length === 0 ? (
            <p className="hint">No finished sessions yet.</p>
          ) : (
            <div className="balances">
              {endedSessions.map((s: SessionSummary) => {
                const sessOwed = Object.values(s.outstanding || {}).some((v) => Math.abs(v) > 0.004);
                return (
                  <div key={s.id}>
                    <div className="bal-row" style={{ alignItems: "flex-start" }}>
                      <span style={{ flex: 1 }}>
                        <strong>{s.name || sessDate(s.started_at)}</strong>
                        <span className="meta"> · {(s.players || []).join(", ")}</span>
                        {netLine(s.net) && <div className="log" style={{ marginTop: 2 }}>{netLine(s.net)}</div>}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button className="icon-btn danger" aria-label={`Delete session ${s.name || sessDate(s.started_at)}`} disabled={work || busy} onClick={() => doDeleteSession(s.id, true)}><IconDelete /></button>
                      </span>
                    </div>
                    {delNotice === s.id && sessOwed && <p className="warn">Settle this session&apos;s debt first — see the <strong>$</strong> tab.</p>}
                    {confirmDelSess === s.id && <p className="warn">Delete this session? Tap the trash again to confirm.</p>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
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
              <h2>Who owes who</h2>
              {sessionDebts.map(({ s, pairs }) => (
                <div key={s.id} style={{ marginBottom: 8 }}>
                  <div className="line meta" style={{ marginBottom: 2 }}>{s.name || sessDate(s.started_at)}</div>
                  <div className="balances">{pairs.map((pair, i) => payRow(pair, i, s.id))}</div>
                </div>
              ))}
              {legacyResidual.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div className="line meta" style={{ marginBottom: 2 }}>Earlier</div>
                  <div className="balances">{legacyResidual.map((pair, i) => payRow(pair, i))}</div>
                </div>
              )}
              {!me && <p className="fine">Tap &ldquo;This is me&rdquo; on your name above to settle debts you&apos;re part of.</p>}
            </>
          )}

          <h2>All-time tally</h2>
          {career.length === 0 ? (
            <p className="hint">No finished sessions yet — it fills in as sessions end.</p>
          ) : (
            <div className="balances">
              {career.map(({ p, v, g }) => (
                <div key={p} className="bal-row">
                  <span>{p}{g > 0 && <span className="meta"> · {g} game{g === 1 ? "" : "s"}</span>}</span>
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
                  <div key={i} className="log-row" style={{ opacity: 0.85 }}>{s.from} paid {s.to} <strong>{money(s.amount)}</strong></div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <button className="link-btn with-ico" onClick={onBack}><IconBack size={16} />Back</button>
    </div>
  );
}

// ------------------------------------------------------------ session setup

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
  onStart: (opts: { mahjongType: string; players: string[]; settle: boolean; bases?: PayoutConfig; name?: string }) => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const t = state.tracker;
  const roster = t.players || [];

  const [mtype, setMtype] = useState(t.default_type === "my3" ? "my3" : "sg4");
  const need = seatsFor(mtype);
  const [selected, setSelected] = useState<string[]>([]);
  const [payCfg, setPayCfg] = useState<PayoutConfig | null>(null);
  const [sessName, setSessName] = useState("");

  const enoughNames = roster.length >= need;
  const playersPicked = selected.length === need;
  const ready = enoughNames && playersPicked && payCfg !== null;

  const toggle = (name: string) => {
    haptic("selection");
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((p) => p !== name);
      if (prev.length >= need) return prev;
      return [...prev, name];
    });
  };

  const pickType = (v: string) => {
    haptic("selection");
    setMtype(v);
    setSelected((prev) => prev.slice(0, seatsFor(v)));
  };

  const start = () => {
    if (!ready) return;
    onStart({ mahjongType: mtype, players: selected, settle: true, bases: payCfg!, name: sessName.trim() || undefined });
  };

  return (
    <div>
      <h1>Start a session</h1>
      <p className="hint">One sitting at the table. Pick the type, who&apos;s playing, name it, and the payouts. It tallies into the group&apos;s debts when it ends.</p>

      <h2>Mahjong type</h2>
      <div className="row">
        {[{ v: "sg4", label: "Singaporean (4p)" }, { v: "my3", label: "Malaysian (3p) — WIP" }].map((o) => (
          <button type="button" key={o.v} className={"chip" + (mtype === o.v ? " selected" : "")} onClick={() => pickType(o.v)}>{o.label}</button>
        ))}
      </div>
      {mtype === "my3" && <p className="fine">Malaysian scoring isn&apos;t built yet — the session runs with the Singaporean actions for now. (WIP)</p>}

      <h2>Session name <small>optional</small></h2>
      <input className="text-input" maxLength={40} placeholder='e.g. "Friday night"' value={sessName} onChange={(e) => setSessName(e.target.value)} />

      <h2>Who&apos;s playing <small>({selected.length}/{need})</small></h2>
      {!enoughNames ? (
        <p className="err">This group has {roster.length} name{roster.length === 1 ? "" : "s"} — add {need - roster.length} more to play {need}-player.</p>
      ) : (
        <>
          <p className="hint">Tick exactly {need} players for this session.</p>
          <div className="choices">
            {roster.map((p) => {
              const on = selected.includes(p);
              const full = !on && selected.length >= need;
              return (
                <div key={p} className={"choice-btn" + (on ? " selected-choice" : "") + lockCls(full)} onClick={() => (!full || on) && toggle(p)}>
                  {p}{on && <small>playing</small>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 className={playersPicked ? undefined : "locked"}>Payouts</h2>
      <div className={playersPicked ? undefined : "locked"}>
        <PayoutEditor presets={presets} onChange={setPayCfg} />
      </div>

      <button className="primary-btn" disabled={busy || !ready} onClick={start}>{busy ? "Starting…" : "Start session"}</button>
      {error && <p className="err">{error}</p>}
      <button className="link-btn with-ico" onClick={onBack}><IconBack size={16} />Back</button>
    </div>
  );
}
