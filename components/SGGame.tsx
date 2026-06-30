"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  Transfer,
  PayoutConfig,
  discardValue,
  zimoEachValue,
  maxTaiOf,
  settleDiscardWin,
  settleSelfDraw,
  settleYao,
  settleGang,
  applyTransfers,
} from "@/lib/sg/payout";
import {
  syncEnabled,
  startParamCode,
  createTracker,
  setupGroup,
  getState,
  addRemoteAction,
  BOT_APP_LINK,
  TrackerState,
} from "@/lib/sg/remote";

type Bases = PayoutConfig;
type LogEntry = { summary: string; transfers: Transfer[]; actioner?: string };
const money = (n: number) => n.toFixed(2);

function computeBalances(players: string[], log: { transfers: Transfer[] }[]): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  for (const e of log) applyTransfers(b, e.transfers);
  return b;
}

// ---------------------------------------------------------------- router

export default function SGGame({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<"choose" | "local" | "sync">("choose");
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);

  // Deep-link join: t.me/<bot>/<app>?startapp=<code>
  useEffect(() => {
    const c = startParamCode();
    if (c) {
      setJoinCode(c);
      setView("sync");
    }
    setAutoChecked(true);
  }, []);

  if (!autoChecked) return null;

  if (view === "local") return <LocalGame onBack={() => setView("choose")} />;
  if (view === "sync") return <SyncGame initialCode={joinCode} onBack={() => setView("choose")} />;

  return (
    <div>
      <h1>Singaporean</h1>
      <h2>How do you want to track?</h2>
      <div className="choices" style={{ gridTemplateColumns: "1fr" }}>
        {syncEnabled() && (
          <div className="choice-btn" onClick={() => { setJoinCode(null); setView("sync"); }}>
            Synced group
            <small>Everyone sees the same balances on their own phone</small>
          </div>
        )}
        <div className="choice-btn" onClick={() => setView("local")}>
          This device only
          <small>Track on this phone, nothing shared</small>
        </div>
      </div>
      <button className="link-btn" onClick={onBack}>← Back to menu</button>
    </div>
  );
}

// ---------------------------------------------------------------- local

interface LocalState extends Bases {
  players: string[];
  log: LogEntry[];
}

function LocalGame({ onBack }: { onBack: () => void }) {
  const [game, setGame, loaded] = useLocalStorage<LocalState | null>("mahjong-sg", null);
  if (!loaded) return null;
  if (!game)
    return (
      <Setup
        title="Singaporean — this device"
        onStart={(name, players, bases) => setGame({ players, ...bases, log: [] })}
        onBack={onBack}
      />
    );
  const bases: Bases = game;
  const balances = computeBalances(game.players, game.log);
  return (
    <Dashboard
      players={game.players}
      bases={bases}
      balances={balances}
      log={game.log}
      onRecord={(summary, transfers) => setGame({ ...game, log: [...game.log, { summary, transfers }] })}
      onEnd={() => { if (confirm("End game and clear balances?")) setGame(null as unknown as LocalState); }}
      onBack={onBack}
    />
  );
}

// ---------------------------------------------------------------- synced

function SyncGame({ initialCode, onBack }: { initialCode: string | null; onBack: () => void }) {
  const [state, setState] = useState<TrackerState | null>(null);
  const [mode, setMode] = useState<"pick" | "create" | "join">(initialCode ? "join" : "pick");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Auto-join when arriving via a deep link.
  useEffect(() => {
    if (initialCode && !state) {
      setBusy(true);
      getState(initialCode)
        .then(setState)
        .catch((e) => setError(String(e.message || e)))
        .finally(() => setBusy(false));
    }
  }, [initialCode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state) {
    // Configured group/tracker -> straight to the dashboard.
    if (state.tracker.players.length >= 2) return <SyncPlay initial={state} onBack={onBack} />;
    // Bot-created group stub nobody has set up yet -> Create New Group.
    return (
      <Setup
        title="Create New Group"
        startLabel="Create group"
        onStart={async (name, players, bases) => {
          setBusy(true); setError("");
          try { setState(await setupGroup(state.tracker.code, name, players, bases)); }
          catch (e) { setError(String((e as Error).message || e)); }
          finally { setBusy(false); }
        }}
        onBack={onBack}
        busy={busy}
        error={error}
      />
    );
  }

  if (mode === "create")
    return (
      <Setup
        title="Synced tracker — new"
        onStart={async (name, players, bases) => {
          setBusy(true); setError("");
          try { setState(await createTracker(name, players, bases)); }
          catch (e) { setError(String((e as Error).message || e)); }
          finally { setBusy(false); }
        }}
        onBack={() => setMode("pick")}
        busy={busy}
        error={error}
      />
    );

  if (mode === "join") return <JoinForm initialCode={initialCode} busy={busy} onBack={() => setMode("pick")} onJoined={setState} />;

  return (
    <div>
      <h1>Synced tracker</h1>
      <div className="choices" style={{ gridTemplateColumns: "1fr" }}>
        <div className="choice-btn" onClick={() => setMode("create")}>Create a tracker<small>Set players + values, get a share link</small></div>
        <div className="choice-btn" onClick={() => setMode("join")}>Join with a code<small>Enter a code someone shared</small></div>
      </div>
      {error && <p style={{ color: "#e54848" }}>{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}

function JoinForm({
  initialCode,
  busy,
  onBack,
  onJoined,
}: {
  initialCode: string | null;
  busy: boolean;
  onBack: () => void;
  onJoined: (s: TrackerState) => void;
}) {
  const [code, setCode] = useState(initialCode || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const join = async () => {
    setLoading(true); setError("");
    try { onJoined(await getState(code.trim().toUpperCase())); }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setLoading(false); }
  };
  return (
    <div>
      <h1>Join a tracker</h1>
      <h2>Code</h2>
      <input className="text-input" placeholder="e.g. K7P2QM" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="primary-btn" disabled={!code.trim() || loading || busy} onClick={join}>
        {loading ? "Joining…" : "Join"}
      </button>
      {error && <p style={{ color: "#e54848" }}>{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}

function SyncPlay({ initial, onBack }: { initial: TrackerState; onBack: () => void }) {
  const [state, setState] = useState<TrackerState>(initial);
  const [syncing, setSyncing] = useState(false);
  const code = state.tracker.code;
  const players = state.tracker.players;
  const bases = state.tracker.bases;
  const busyRef = useRef(false);

  // Poll for others' changes.
  useEffect(() => {
    const id = setInterval(async () => {
      if (busyRef.current) return;
      try { setState(await getState(code)); } catch { /* keep last */ }
    }, 2500);
    return () => clearInterval(id);
  }, [code]);

  const log: LogEntry[] = state.actions.map((a) => ({ summary: a.summary, transfers: a.transfers, actioner: a.actioner }));
  const balances = computeBalances(players, log);
  const shareLink = `${BOT_APP_LINK}?startapp=${code}`;

  const record = async (summary: string, transfers: Transfer[]) => {
    busyRef.current = true;
    setSyncing(true);
    try { setState(await addRemoteAction(code, summary, transfers)); }
    catch (e) { alert("Couldn't record: " + (e as Error).message); }
    finally { busyRef.current = false; setSyncing(false); }
  };

  return (
    <Dashboard
      players={players}
      bases={bases}
      balances={balances}
      log={log}
      onRecord={record}
      onBack={onBack}
      banner={
        <div className="result" style={{ marginTop: 0, marginBottom: 14 }}>
          <div className="line"><strong>Code {code}</strong> {syncing ? "· syncing…" : "· live"}</div>
          <div className="line" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{shareLink}</div>
        </div>
      }
    />
  );
}

// ---------------------------------------------------------------- shared UI

function Setup({
  title,
  onStart,
  onBack,
  busy,
  error,
  startLabel,
}: {
  title: string;
  onStart: (name: string, players: string[], bases: Bases) => void;
  onBack: () => void;
  busy?: boolean;
  error?: string;
  startLabel?: string;
}) {
  const [name, setName] = useState("");
  const [names, setNames] = useState(["", "", "", ""]);
  // Payouts (per session). discard = what a single shooter pays at 1 tai;
  // zimo = what EACH other player pays on a self-draw at 1 tai. Both double per
  // tai. Defaults follow the sgmahjong.club 10¢/20¢ table (self-draw = half the
  // shooter; bite & kong a flat 0.10). Blank self-draw falls back to 2× shooter.
  const [discard, setDiscard] = useState("0.40");
  const [zimo, setZimo] = useState("0.20");
  const [yao, setYao] = useState("0.10");
  const [gang, setGang] = useState("0.10");
  const [maxTai, setMaxTai] = useState("10");
  const [advanced, setAdvanced] = useState(false);
  const [cap, setCap] = useState("");
  const [customOn, setCustomOn] = useState(false);
  const [rows, setRows] = useState<{ d: string; z: string }[]>([]);

  const num = (s: string, d: number) => { const v = parseFloat(s); return isFinite(v) ? v : d; };
  const pos = (s: string, d: number) => { const v = parseFloat(s); return isFinite(v) && v >= 0 ? v : d; };
  const shooter = pos(discard, 0.1);          // discard base; must be > 0
  const selfDraw = pos(zimo, shooter * 2);    // blank -> auto 2× shooter (house rule)
  const ready = names.every((n) => n.trim()) && shooter > 0;
  const mt = Math.max(1, Math.min(20, Math.floor(num(maxTai, 10))));
  const capN = Math.floor(num(cap, mt));
  const useCap = cap.trim() !== "" && capN >= 1 && capN < mt;

  // A config built from the current fields (without custom tables) — used to
  // show the doubling preview/placeholders.
  const previewCfg: PayoutConfig = {
    tai: shooter, zimo: selfDraw,
    yao: pos(yao, 0.1), gang: pos(gang, 0.1), maxTai: mt, ...(useCap ? { cap: capN } : {}),
  };

  // Keep the per-tai custom rows in sync with max tai (drop hidden stale rows).
  useEffect(() => { setRows((arr) => (arr.length > mt ? arr.slice(0, mt) : arr)); }, [mt]);

  const setRow = (i: number, k: "d" | "z", v: string) =>
    setRows((arr) => {
      const next = arr.slice();
      while (next.length < mt) next.push({ d: "", z: "" });
      next[i] = { ...next[i], [k]: v };
      return next;
    });

  const usePreset = () => {
    // sgmahjong.club 10¢/20¢: shooter $0.40 / self-draw each $0.20 at 1 tai,
    // doubling to 10 tai; bite & kong $0.10.
    setDiscard("0.40"); setZimo("0.20"); setYao("0.10"); setGang("0.10");
    setMaxTai("10"); setAdvanced(false); setCap(""); setCustomOn(false); setRows([]);
  };

  const submit = () => {
    const cfg: PayoutConfig = {
      tai: shooter,
      zimo: selfDraw,
      yao: pos(yao, 0.1),
      gang: pos(gang, 0.1),
      maxTai: mt,
    };
    if (useCap) cfg.cap = capN;
    if (customOn) {
      const col = (k: "d" | "z") =>
        Array.from({ length: mt }, (_, i) => {
          const raw = rows[i]?.[k]?.trim();
          if (!raw) return null;
          const v = parseFloat(raw);
          return isFinite(v) && v >= 0 ? v : null;
        });
      const dTab = col("d");
      const zTab = col("z");
      if (dTab.some((v) => v != null)) cfg.discardTable = dTab;
      if (zTab.some((v) => v != null)) cfg.zimoTable = zTab;
    }
    onStart(name.trim() || "Mahjong", names.map((n) => n.trim()), cfg);
  };

  return (
    <div>
      <h1>{title}</h1>
      <h2>Game name</h2>
      <input className="text-input" placeholder="e.g. Friday mahjong" value={name} onChange={(e) => setName(e.target.value)} />
      <h2>Players</h2>
      {names.map((n, i) => (
        <input key={i} className="text-input" placeholder={`Player ${i + 1}`} value={n}
          onChange={(e) => setNames((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} />
      ))}

      <h2>Payouts</h2>
      <p style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: -4 }}>
        Defaults follow the sgmahjong.club table. Win values are at 1 tai and double each tai;
        bite &amp; kong are flat. Change them to match your table.
      </p>
      <div className="row" style={{ alignItems: "center" }}>
        <label className="vlabel">shooter pays<input className="text-input small" inputMode="decimal" min="0" value={discard} onChange={(e) => setDiscard(e.target.value)} /></label>
        <label className="vlabel">self-draw (each)<input className="text-input small" inputMode="decimal" min="0" placeholder={money(shooter * 2)} value={zimo} onChange={(e) => setZimo(e.target.value)} /></label>
        <label className="vlabel">max tai<input className="text-input small" inputMode="numeric" min="1" value={maxTai} onChange={(e) => setMaxTai(e.target.value)} /></label>
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <label className="vlabel">bite (yao)<input className="text-input small" inputMode="decimal" min="0" value={yao} onChange={(e) => setYao(e.target.value)} /></label>
        <label className="vlabel">kong (gang)<input className="text-input small" inputMode="decimal" min="0" value={gang} onChange={(e) => setGang(e.target.value)} /></label>
      </div>
      <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>
        e.g. 1 tai → shooter pays {money(discardValue(previewCfg, 1))}, self-draw {money(zimoEachValue(previewCfg, 1))} each ·
        {" "}{mt} tai → {money(discardValue(previewCfg, mt))} / {money(zimoEachValue(previewCfg, mt))}
      </p>
      <p style={{ fontSize: "0.78rem", opacity: 0.6 }}>
        On sgmahjong.club the self-draw amount is half the shooter (3 people pay it). Leave self-draw blank to use
        2× the shooter instead (the classic rule). “Max tai” is the highest tai you can pick; bigger wins are
        charged at the max-tai amount. Bite &amp; kong are a flat amount each other player pays.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="chip" onClick={usePreset}>Reset to sgmahjong.club (10¢/20¢)</button>
        <button type="button" className="chip" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Hide advanced" : "Advanced…"}</button>
      </div>

      {advanced && (
        <div style={{ marginTop: 10 }}>
          <label className="vlabel">doubling cap (tai where value stops doubling — blank = max tai)
            <input className="text-input small" inputMode="numeric" placeholder={String(mt)} value={cap} onChange={(e) => setCap(e.target.value)} />
          </label>
          <div className="row" style={{ alignItems: "center", marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
              <input type="checkbox" checked={customOn} onChange={(e) => setCustomOn(e.target.checked)} />
              Type the exact amount for each tai (overrides doubling)
            </label>
          </div>
          {customOn && (
            <div style={{ marginTop: 6 }}>
              <div className="row" style={{ fontSize: "0.75rem", opacity: 0.6 }}>
                <span style={{ width: 48 }}>tai</span><span style={{ flex: 1 }}>shooter</span><span style={{ flex: 1 }}>self-draw each</span>
              </div>
              {Array.from({ length: mt }, (_, i) => (
                <div key={i} className="row" style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span style={{ width: 48 }}>{i + 1}</span>
                  <input className="text-input small" style={{ flex: 1 }} inputMode="decimal"
                    placeholder={money(discardValue(previewCfg, i + 1))}
                    value={rows[i]?.d ?? ""} onChange={(e) => setRow(i, "d", e.target.value)} />
                  <input className="text-input small" style={{ flex: 1 }} inputMode="decimal"
                    placeholder={money(zimoEachValue(previewCfg, i + 1))}
                    value={rows[i]?.z ?? ""} onChange={(e) => setRow(i, "z", e.target.value)} />
                </div>
              ))}
              <p style={{ fontSize: "0.78rem", opacity: 0.6 }}>Blank rows fall back to the doubling values above.</p>
            </div>
          )}
        </div>
      )}

      <button className="primary-btn" disabled={!ready || busy} onClick={submit}>
        {busy ? "Creating…" : startLabel || "Start game"}
      </button>
      {error && <p style={{ color: "#e54848" }}>{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}

type Action = "hu" | "zimo" | "gang" | "yao";

function Dashboard({
  players,
  bases,
  balances,
  log,
  onRecord,
  onEnd,
  onBack,
  banner,
}: {
  players: string[];
  bases: Bases;
  balances: Record<string, number>;
  log: LogEntry[];
  onRecord: (summary: string, transfers: Transfer[]) => void;
  onEnd?: () => void;
  onBack: () => void;
  banner?: React.ReactNode;
}) {
  const [action, setAction] = useState<Action | null>(null);

  if (action) return <ActionForm action={action} players={players} bases={bases} onCancel={() => setAction(null)}
    onConfirm={(s, t) => { onRecord(s, t); setAction(null); }} />;

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
      <div className="choices">
        <div className="choice-btn" onClick={() => setAction("hu")}>Hu<small>win off discard</small></div>
        <div className="choice-btn" onClick={() => setAction("zimo")}>Zimo<small>self-draw</small></div>
        <div className="choice-btn" onClick={() => setAction("gang")}>Gang<small>kong</small></div>
        <div className="choice-btn" onClick={() => setAction("yao")}>Yao<small>bite</small></div>
      </div>

      {log.length > 0 && (
        <>
          <h2>Log</h2>
          <div className="log">
            {log.map((e, i) => (
              <div key={i} className="log-row">{i + 1}. {e.summary}{e.actioner ? ` — ${e.actioner}` : ""}</div>
            ))}
          </div>
        </>
      )}

      {onEnd && <button className="link-btn" onClick={onEnd}>End game</button>}
      <span style={{ margin: "0 8px" }} />
      <button className="link-btn" onClick={onBack}>← Menu</button>
    </div>
  );
}

function Chips({ options, value, onChange }: { options: { v: string; label: string }[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="row">
      {options.map((o) => (
        <div key={o.v} className={"chip" + (value === o.v ? " selected" : "")} onClick={() => onChange(o.v)}>{o.label}</div>
      ))}
    </div>
  );
}

function ActionForm({
  action,
  players,
  bases,
  onCancel,
  onConfirm,
}: {
  action: Action;
  players: string[];
  bases: Bases;
  onCancel: () => void;
  onConfirm: (summary: string, transfers: Transfer[]) => void;
}) {
  const playerOpts = players.map((p) => ({ v: p, label: p }));
  const tais = Array.from({ length: maxTaiOf(bases) }, (_, i) => i + 1);
  const [s, setS] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setS((prev) => ({ ...prev, [k]: v }));

  let ready = false;
  let build: (() => { summary: string; transfers: Transfer[] }) | null = null;

  if (action === "hu") {
    ready = !!(s.tai && s.winner && s.discarder && s.winner !== s.discarder);
    build = () => {
      const tai = parseInt(s.tai); const value = discardValue(bases, tai);
      return { summary: `Hu: ${s.winner} wins off ${s.discarder} (${tai} tai)`, transfers: settleDiscardWin(s.winner, s.discarder, value) };
    };
  } else if (action === "zimo") {
    ready = !!(s.tai && s.winner);
    build = () => {
      const tai = parseInt(s.tai); const perPlayer = zimoEachValue(bases, tai);
      return { summary: `Zimo: ${s.winner} self-draws (${tai} tai)`, transfers: settleSelfDraw(s.winner, perPlayer, players) };
    };
  } else if (action === "gang") {
    ready = !!(s.konger && s.gscope && (s.gscope !== "one" || (s.gpayer && s.gpayer !== s.konger)));
    build = () => {
      const payer = s.gscope === "one" ? s.gpayer : null;
      return { summary: `Gang: ${s.konger} kong${payer ? ` off ${payer}` : " (all pay)"}`,
        transfers: settleGang(s.konger, bases.gang, players, payer) };
    };
  } else {
    ready = !!(s.biter && s.scope && (s.scope !== "one" || (s.target && s.target !== s.biter)));
    build = () => {
      const target = s.scope === "one" ? s.target : null;
      return { summary: `Yao: ${s.biter} bite${target ? ` on ${target}` : " (all pay)"}`,
        transfers: settleYao(s.biter, bases.yao, players, target) };
    };
  }

  return (
    <div>
      {action === "hu" && (<>
        <h2>Tai</h2><Chips options={tais.map((n) => ({ v: String(n), label: String(n) }))} value={s.tai ?? null} onChange={(v) => set("tai", v)} />
        <h2>Winner</h2><Chips options={playerOpts} value={s.winner ?? null} onChange={(v) => set("winner", v)} />
        <h2>Discarder</h2><Chips options={playerOpts} value={s.discarder ?? null} onChange={(v) => set("discarder", v)} />
      </>)}
      {action === "zimo" && (<>
        <h2>Winner</h2><Chips options={playerOpts} value={s.winner ?? null} onChange={(v) => set("winner", v)} />
        <h2>Tai</h2><Chips options={tais.map((n) => ({ v: String(n), label: String(n) }))} value={s.tai ?? null} onChange={(v) => set("tai", v)} />
      </>)}
      {action === "gang" && (<>
        <h2>Konger</h2><Chips options={playerOpts} value={s.konger ?? null} onChange={(v) => set("konger", v)} />
        <h2>Paid by</h2>
        <Chips options={[{ v: "everyone", label: "Everyone" }, { v: "one", label: "Off a discard" }]} value={s.gscope ?? null} onChange={(v) => set("gscope", v)} />
        {s.gscope === "one" && (<><h2>Whose discard</h2><Chips options={playerOpts} value={s.gpayer ?? null} onChange={(v) => set("gpayer", v)} /></>)}
      </>)}
      {action === "yao" && (<>
        <h2>Biter</h2><Chips options={playerOpts} value={s.biter ?? null} onChange={(v) => set("biter", v)} />
        <h2>Paid by</h2>
        <Chips options={[{ v: "everyone", label: "Everyone" }, { v: "one", label: "One person" }]} value={s.scope ?? null} onChange={(v) => set("scope", v)} />
        {s.scope === "one" && (<><h2>Who pays</h2><Chips options={playerOpts} value={s.target ?? null} onChange={(v) => set("target", v)} /></>)}
      </>)}

      <button className="primary-btn" disabled={!ready} onClick={() => build && onConfirm(build().summary, build().transfers)}>
        Confirm {action.toUpperCase()}
      </button>
      <button className="link-btn" onClick={onCancel}>← Cancel</button>
    </div>
  );
}
