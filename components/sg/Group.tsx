"use client";

// The group page (between home and the live session): running debt counter
// tallied from ended sessions, the active-session banner, and the
// start-a-session setup screen (mahjong type + payout structure).

import { useMemo, useState } from "react";
import { haptic, useBackButton } from "@/lib/telegram";
import { PayoutConfig, money } from "@/lib/sg/payout";
import {
  TrackerState,
  PayoutPreset,
  GAME_TYPES,
  savePreset,
  BOT_APP_LINK,
} from "@/lib/sg/remote";

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

const typeLabel = (v: string) => GAME_TYPES.find((g) => g.v === v)?.label || v;

const hoursLeft = (startedAt: string) => {
  const ms = new Date(startedAt).getTime() + 24 * 3600 * 1000 - Date.now();
  return Math.max(0, Math.round(ms / 3600000));
};

export function GroupScreen({
  state,
  busy,
  onNewSession,
  onEnterSession,
  onBack,
}: {
  state: TrackerState;
  busy?: boolean;
  onNewSession: () => void;
  onEnterSession: () => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const t = state.tracker;
  const session = state.session || null;
  const debts = state.debts || {};
  const players = t.players || [];
  const net = players.map((p) => ({ p, v: debts[p] || 0 }));
  const anyDebt = net.some((x) => Math.abs(x.v) > 0.004);
  const suggestions = useMemo(() => settleUp(debts), [debts]);
  const shareLink = `${BOT_APP_LINK}?startapp=${t.code}`;

  return (
    <div>
      <h1>{t.name || t.code}</h1>
      <div className="result" style={{ marginTop: 0, marginBottom: 14 }}>
        <div className="line"><strong>Code {t.code}</strong>{state.me ? <> · you are <strong>{state.me}</strong></> : null}</div>
        <div className="line" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{shareLink}</div>
      </div>

      {session ? (
        <>
          <h2>Session running</h2>
          <div className="result" style={{ marginTop: 0 }}>
            <div className="line">
              <strong>{typeLabel(session.mahjong_type)}</strong>
              {session.settle === false ? " · no payouts (ownself settle)" : ""}
            </div>
            <div className="line" style={{ fontSize: "0.85rem", opacity: 0.75 }}>
              Started by {session.started_by || "?"} · auto-ends in about {hoursLeft(session.started_at)}h (or end it manually inside)
            </div>
          </div>
          <button className="primary-btn" disabled={busy} onClick={() => { haptic("light"); onEnterSession(); }}>
            Enter session
          </button>
        </>
      ) : (
        <>
          <h2>No session running</h2>
          <p style={{ opacity: 0.7, fontSize: "0.88rem", marginTop: 0 }}>
            Start one when you sit down — it tallies into the debt counter when it ends (manually, or automatically after 24h).
          </p>
          <button className="primary-btn" disabled={busy || !state.me} onClick={() => { haptic("light"); onNewSession(); }}>
            Start a session
          </button>
          {!state.me && <p className="err">Join the group (pick your seat) before starting a session.</p>}
        </>
      )}

      <h2>Debt counter</h2>
      {!anyDebt ? (
        <p style={{ opacity: 0.7, fontSize: "0.88rem" }}>All square — nothing owed from past sessions.</p>
      ) : (
        <>
          <div className="balances">
            {net.map(({ p, v }) => (
              <div key={p} className="bal-row">
                <span>{p}</span>
                <span className={"bal " + (v >= 0 ? "pos" : "neg")}>{v >= 0 ? "+" : ""}{v.toFixed(2)}</span>
              </div>
            ))}
          </div>
          {suggestions.length > 0 && (
            <>
              <h2>To settle up</h2>
              <div className="log">
                {suggestions.map((s, i) => (
                  <div key={i} className="log-row">{s.from} pays {s.to} <strong>{money(s.amount)}</strong></div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <button className="link-btn" onClick={onBack}>← Home</button>
    </div>
  );
}

// ------------------------------------------------------------ session setup

// Built-in payout presets. "Group default" (the payouts chosen at group
// creation) is added dynamically in front.
const BUILTINS: PayoutPreset[] = [
  { name: "sgmahjong.club (10¢/20¢)", cfg: { tai: 0.4, zimo: 0.2, yao: 0.1, gang: 0.1, maxTai: 10 } },
];
const NONE = "__none__"; // "don't need, ownself settle"

const cfgToFields = (c: PayoutConfig) => ({
  discard: String(c.tai ?? 0.4),
  zimo: String(c.zimo ?? (c.tai ?? 0.4) * 2),
  yao: String(c.yao ?? 0.1),
  gang: String(c.gang ?? 0.1),
  maxTai: String(c.maxTai ?? 10),
});

export function NewSession({
  state,
  presets,
  busy,
  error,
  onStart,
  onPresets,
  onBack,
}: {
  state: TrackerState;
  presets: PayoutPreset[];
  busy?: boolean;
  error?: string;
  onStart: (opts: { mahjongType: string; settle: boolean; bases?: PayoutConfig }) => void;
  onPresets: (p: PayoutPreset[]) => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const t = state.tracker;
  const options: PayoutPreset[] = useMemo(
    () => [{ name: "Group default", cfg: t.bases || BUILTINS[0].cfg }, ...BUILTINS, ...presets],
    [t.bases, presets],
  );

  const [mtype, setMtype] = useState(t.default_type === "my3" ? "my3" : "sg4");
  const [mode, setMode] = useState(options[0].name); // preset name, or NONE
  const [fields, setFields] = useState(cfgToFields(options[0].cfg));
  const [yaoOn, setYaoOn] = useState(t.bases?.yaoOn !== false);
  const [gangOn, setGangOn] = useState(t.bases?.gangOn !== false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetErr, setPresetErr] = useState("");
  const [presetMsg, setPresetMsg] = useState("");

  const settle = mode !== NONE;
  const num = (s: string, d: number) => { const v = parseFloat(s); return isFinite(v) && v >= 0 ? v : d; };
  const mt = Math.max(1, Math.min(20, Math.floor(num(fields.maxTai, 10))));

  const picked = options.find((o) => o.name === mode);
  // Did the user edit the numbers / toggles away from the picked preset?
  const fieldsDirty = picked ? JSON.stringify(cfgToFields(picked.cfg)) !== JSON.stringify(fields) : false;
  const togglesDirty = picked
    ? (picked.cfg.yaoOn !== false) !== yaoOn || (picked.cfg.gangOn !== false) !== gangOn
    : false;
  const dirty = settle && (fieldsDirty || togglesDirty);

  const currentCfg = (): PayoutConfig => {
    // A preset can carry more than the five editable fields — the doubling cap
    // and exact per-tai tables from the group's Advanced setup. Keep them as
    // long as the numbers weren't edited; once they are, the edited doubling
    // values ARE the new rule and stale tables would contradict them.
    const keep: Partial<PayoutConfig> = picked && !fieldsDirty
      ? {
          ...(picked.cfg.cap != null ? { cap: picked.cfg.cap } : {}),
          ...(picked.cfg.discardTable ? { discardTable: picked.cfg.discardTable } : {}),
          ...(picked.cfg.zimoTable ? { zimoTable: picked.cfg.zimoTable } : {}),
        }
      : {};
    return {
      ...keep,
      tai: num(fields.discard, 0.4),
      zimo: num(fields.zimo, num(fields.discard, 0.4) * 2),
      yao: num(fields.yao, 0.1),
      gang: num(fields.gang, 0.1),
      maxTai: mt,
      yaoOn,
      gangOn,
    };
  };

  const pickMode = (name: string) => {
    haptic("selection");
    setMode(name); setPresetMsg(""); setPresetErr("");
    if (name === NONE) return;
    const opt = options.find((o) => o.name === name);
    if (opt) {
      setFields(cfgToFields(opt.cfg));
      setYaoOn(opt.cfg.yaoOn !== false);
      setGangOn(opt.cfg.gangOn !== false);
    }
  };

  const halve = () => {
    haptic("light");
    const h = (s: string, d: number) => String(Math.round(num(s, d) / 2 * 100) / 100);
    setFields((f) => ({ ...f, discard: h(f.discard, 0.4), zimo: h(f.zimo, 0.2), yao: h(f.yao, 0.1), gang: h(f.gang, 0.1) }));
  };

  const doSavePreset = async () => {
    const nm = presetName.trim();
    if (!nm) { setPresetErr("Give it a name."); return; }
    setSavingPreset(true); setPresetErr(""); setPresetMsg("");
    try {
      const { presets: next } = await savePreset(nm, currentCfg());
      haptic("success"); onPresets(next); setMode(nm); setPresetName(""); setPresetMsg(`Saved "${nm}".`);
    } catch (e) { haptic("error"); setPresetErr(String((e as Error).message || e)); }
    finally { setSavingPreset(false); }
  };

  const start = () => onStart(settle ? { mahjongType: mtype, settle: true, bases: currentCfg() } : { mahjongType: mtype, settle: false });

  const disabledStyle = settle ? undefined : { opacity: 0.35, pointerEvents: "none" as const };

  return (
    <div>
      <h1>Start a session</h1>
      <p style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: 0 }}>
        One sitting at the table. It ends when you end it — or automatically 24 hours after starting — and the money tallies into the group&apos;s debt counter.
      </p>

      <h2>Mahjong type</h2>
      <div className="row">
        {[{ v: "sg4", label: "Singaporean (4p)" }, { v: "my3", label: "Malaysian (3p) — WIP" }].map((o) => (
          <div key={o.v} className={"chip" + (mtype === o.v ? " selected" : "")}
            onClick={() => { haptic("selection"); setMtype(o.v); }}>{o.label}</div>
        ))}
      </div>
      {mtype === "my3" && (
        <p style={{ opacity: 0.65, fontSize: "0.8rem" }}>
          Malaysian scoring isn&apos;t built yet — the session will run with the Singaporean actions for now. (WIP)
        </p>
      )}

      <h2>Payout structure</h2>
      <select className="text-input" value={mode} onChange={(e) => pickMode(e.target.value)}>
        {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
        <option value={NONE}>Don&apos;t need — ownself settle</option>
      </select>

      <div style={disabledStyle}>
        <div className="row" style={{ alignItems: "center" }}>
          <label className="vlabel">shooter pays
            <input className="text-input small" inputMode="decimal" value={fields.discard} disabled={!settle}
              onChange={(e) => setFields((f) => ({ ...f, discard: e.target.value }))} /></label>
          <label className="vlabel">self-draw (each)
            <input className="text-input small" inputMode="decimal" value={fields.zimo} disabled={!settle}
              onChange={(e) => setFields((f) => ({ ...f, zimo: e.target.value }))} /></label>
          <label className="vlabel">max tai
            <input className="text-input small" inputMode="numeric" value={fields.maxTai} disabled={!settle}
              onChange={(e) => setFields((f) => ({ ...f, maxTai: e.target.value }))} /></label>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <label className="vlabel">bite (yao)
            <input className="text-input small" inputMode="decimal" value={fields.yao} disabled={!settle || !yaoOn}
              onChange={(e) => setFields((f) => ({ ...f, yao: e.target.value }))} /></label>
          <label className="vlabel">kong (gang)
            <input className="text-input small" inputMode="decimal" value={fields.gang} disabled={!settle || !gangOn}
              onChange={(e) => setFields((f) => ({ ...f, gang: e.target.value }))} /></label>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <button type="button" className="chip" onClick={halve}>Halve payouts</button>
          <div className={"chip" + (yaoOn ? " on" : "")} onClick={() => { haptic("selection"); setYaoOn(!yaoOn); }}>
            {yaoOn ? "Bite payouts: on" : "Bite payouts: off"}
          </div>
          <div className={"chip" + (gangOn ? " on" : "")} onClick={() => { haptic("selection"); setGangOn(!gangOn); }}>
            {gangOn ? "Kong payouts: on" : "Kong payouts: off"}
          </div>
        </div>

        {dirty && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: "0.82rem", opacity: 0.75, marginBottom: 4 }}>
              You changed the numbers — save them as your own payout type?
            </p>
            <div className="row" style={{ alignItems: "center" }}>
              <input className="text-input" style={{ width: 180, marginBottom: 0 }} placeholder="preset name"
                maxLength={30} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <button className="chip" disabled={savingPreset} onClick={doSavePreset}>
                {savingPreset ? "Saving…" : "Save preset"}
              </button>
            </div>
            {presetErr && <p className="err">{presetErr}</p>}
          </div>
        )}
        {presetMsg && <p style={{ fontSize: "0.82rem", opacity: 0.75 }}>{presetMsg}</p>}
      </div>

      {!settle && (
        <p style={{ opacity: 0.7, fontSize: "0.85rem" }}>
          No payout tracking: the session just logs who won what; no balances, no debt tally.
        </p>
      )}

      <button className="primary-btn" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start session"}</button>
      {error && <p className="err">{error}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}
