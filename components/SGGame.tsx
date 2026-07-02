"use client";

import { useEffect, useRef, useState } from "react";
import { haptic, useBackButton, useClosingConfirmation } from "@/lib/telegram";
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
  parseStartParam,
  createTracker,
  listByChat,
  getState,
  openGroup,
  claimSeat,
  joinNew,
  myGroups,
  addRemoteAction,
  renameSeat,
  rememberGroup,
  rememberGroupForChat,
  lastGroupForChat,
  localGroups,
  setLocalGroups,
  getMe,
  setUsername,
  Profile,
  GroupSummary,
  BOT_APP_LINK,
  TrackerState,
  ActionMeta,
} from "@/lib/sg/remote";

type Bases = PayoutConfig;
type LogEntry = { summary: string; transfers: Transfer[]; actioner?: string; meta?: ActionMeta | null };
const money = (n: number) => n.toFixed(2);

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

// ---------------------------------------------------------------- router / home

const sumOf = (s: TrackerState): GroupSummary => ({ code: s.tracker.code, name: s.tracker.name, players: s.tracker.players.length });

export default function SGGame({ onOpenRiichi }: { onOpenRiichi: () => void }) {
  const [open, setOpen] = useState<TrackerState | null>(null);
  const [joining, setJoining] = useState<TrackerState | null>(null); // group whose "Join" screen is showing
  const [view, setView] = useState<"home" | "create" | "join">("home");
  const [tgChatId, setTgChatId] = useState<number | undefined>(undefined);
  const [active, setActive] = useState<GroupSummary[]>([]);   // groups THIS account is in
  const [chatGroups, setChatGroups] = useState<GroupSummary[]>([]); // this chat's groups you can join
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Inside Telegram we have a validated account; outside (plain browser) we
  // don't. canSync also needs the backend URL configured. Anything that hits
  // the server (loading, create/join, opening a group) requires canSync.
  const inTelegram = typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);
  const canSync = inTelegram && syncEnabled();

  // First-run profile / username gate.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needUsername, setNeedUsername] = useState(false);
  const [gate, setGate] = useState<{ suggested: string; hasHandle: boolean }>({ suggested: "", hasHandle: true });
  const [bootError, setBootError] = useState("");
  const startRef = useRef<{ cid?: number; code?: string }>({});

  // When launched from a Telegram group chat we remember which tracker-group the
  // account opened there, so a return trip jumps straight back into it. chatIdRef
  // is the launching chat; chatCodesRef is every group bound to that chat.
  const chatIdRef = useRef<number | undefined>(undefined);
  const chatCodesRef = useRef<Set<string>>(new Set());
  const noteChatGroup = (code: string) => {
    const cid = chatIdRef.current;
    if (cid !== undefined && chatCodesRef.current.has(code)) rememberGroupForChat(cid, code);
  };

  // Enter a group: if you've claimed a seat -> dashboard; if not -> the Join
  // screen (take a seat / join as new). Only claimed groups become "yours".
  const enter = (s: TrackerState) => {
    noteChatGroup(s.tracker.code);
    if (s.me) { rememberGroup(sumOf(s)); setJoining(null); setOpen(s); }
    else { setOpen(null); setJoining(s); }
  };

  // Open a direct code link, else load home + auto-open this chat's group.
  const resolveLaunch = async (cid?: number, code?: string) => {
    if (code) {
      setBusy(true);
      try { enter(await openGroup(code)); }
      catch (e) { setError(String((e as Error).message || e)); }
      finally { setBusy(false); }
      return;
    }
    const [mine, chat] = await Promise.allSettled([
      myGroups(),
      cid !== undefined ? listByChat(cid) : Promise.resolve({ groups: [] as GroupSummary[] }),
    ]);
    // "Your groups" = the groups THIS account has claimed a seat in. The server
    // is the source of truth; we don't resurrect stale cache.
    const yours = mine.status === "fulfilled" ? mine.value.groups : localGroups();
    if (mine.status === "fulfilled") { setActive(yours); setLocalGroups(yours); }
    // Every group bound to this Telegram chat (joined or not).
    const chatAll = chat.status === "fulfilled" ? chat.value.groups : [];
    chatCodesRef.current = new Set(chatAll.map((g) => g.code));
    const mineCodes = new Set(yours.map((g) => g.code));
    setChatGroups(chatAll.filter((g) => !mineCodes.has(g.code)));
    // Launched from a Telegram group chat: jump straight into that chat's group.
    // Prefer the last group opened here; else the chat's only one.
    if (cid !== undefined && chatAll.length) {
      const remembered = lastGroupForChat(cid);
      const target =
        remembered && chatCodesRef.current.has(remembered)
          ? remembered
          : chatAll.length === 1
            ? chatAll[0].code
            : null;
      if (target) { try { enter(await openGroup(target)); } catch { /* stay on home */ } }
    }
  };

  // Boot: load this account's profile first. No username yet -> first-run gate;
  // otherwise resolve the launch. Kept in a function so a transient failure can
  // be retried instead of stranding the user.
  // Fetch the profile, retrying transient failures. An "unknown op" error means
  // this front-end is newer than the deployed edge function; rethrow so the
  // caller can degrade gracefully instead of bricking on a stale bundle / race.
  const getMeRetry = async (tries = 3): Promise<Awaited<ReturnType<typeof getMe>>> => {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await getMe(); }
      catch (e) {
        last = e;
        if (/unknown op/i.test(String((e as Error).message || e))) throw e; // won't change on retry
        if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw last;
  };

  const runBoot = async () => {
    setBooting(true); setBootError("");
    const { cid, code } = startRef.current;
    try {
      let me: Awaited<ReturnType<typeof getMe>>;
      try {
        me = await getMeRetry();
      } catch (e) {
        // Function not upgraded yet (old cached bundle / mid-deploy): don't gate,
        // just run the app without usernames so nobody is locked out.
        if (/unknown op/i.test(String((e as Error).message || e))) { await resolveLaunch(cid, code); return; }
        throw e; // genuine failure -> retryable bootError screen
      }
      if (!me.profile) {
        setGate({ suggested: me.suggested || "", hasHandle: me.hasHandle !== false });
        setNeedUsername(true);
        return;
      }
      setProfile(me.profile);
      await resolveLaunch(cid, code);
    } catch (e) {
      setBootError(String((e as Error).message || e));
    } finally {
      setBooting(false);
    }
  };

  // Finish the first-run gate: keep the username, then resolve the launch.
  const finishGate = async (p: Profile) => {
    setProfile(p); setNeedUsername(false); setBooting(true);
    const { cid, code } = startRef.current;
    try { await resolveLaunch(cid, code); }
    finally { setBooting(false); }
  };

  useEffect(() => {
    setActive(localGroups()); // instant paint from the on-device cache
    const { tgChatId: cid, code } = parseStartParam();
    startRef.current = { cid, code };
    chatIdRef.current = cid;
    if (cid !== undefined) setTgChatId(cid);
    if (!canSync) { setBooting(false); return; } // outside Telegram / unconfigured
    runBoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (booting) return null;
  if (bootError)
    return (
      <div>
        <h1>Mahjong</h1>
        <p style={{ color: "#e54848" }}>Couldn&apos;t load: {bootError}</p>
        <button className="primary-btn" onClick={runBoot}>Try again</button>
      </div>
    );
  if (needUsername)
    return <UsernameGate suggested={gate.suggested} hasHandle={gate.hasHandle} onDone={finishGate} />;

  // Re-read the cache on returning home so a just-created/joined/opened group
  // shows in "Your groups" — and drops out of the chat's "to join" list.
  const goHome = () => {
    setOpen(null); setView("home"); setError("");
    const yours = localGroups();
    setActive(yours);
    const codes = new Set(yours.map((g) => g.code));
    setChatGroups((prev) => prev.filter((g) => !codes.has(g.code)));
  };
  const openByCode = async (code: string) => {
    setBusy(true); setError("");
    try { enter(await openGroup(code)); }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  if (open) return <SyncPlay initial={open} onBack={goHome} />;

  if (joining)
    return <JoinGroup state={joining} busy={busy} defaultName={profile?.username || ""} onClaimed={enter}
      onBack={() => { setJoining(null); goHome(); }} />;

  if (view === "create")
    return (
      <Setup
        title="Create a new group" startLabel="Create group"
        note={tgChatId !== undefined
          ? "When you create it, I'll post a join button in your Telegram group so everyone can tap to join — then pick which player you are."
          : "After creating, pick which player you are."}
        onStart={async (name, players, bases) => {
          setBusy(true); setError("");
          try {
            const st = await createTracker(name, players, bases, tgChatId);
            if (tgChatId !== undefined) chatCodesRef.current.add(st.tracker.code);
            enter(st);
          }
          catch (e) { setError(String((e as Error).message || e)); }
          finally { setBusy(false); }
        }}
        onBack={() => { setView("home"); setError(""); }} busy={busy} error={error}
      />
    );

  if (view === "join")
    return <JoinForm initialCode={null} busy={busy} onBack={() => { setView("home"); setError(""); }}
      onJoined={enter} />;

  // HOME
  return (
    <div>
      <h1>Mahjong</h1>
      {profile && <ProfileHeader profile={profile} onChange={setProfile} />}
      {!inTelegram && <p style={{ color: "#e54848", fontSize: "0.85rem" }}>Open this inside Telegram to use shared groups.</p>}
      {error && <p style={{ color: "#e54848" }}>{error}</p>}

      <h2>Your groups</h2>
      {active.length === 0 ? (
        <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>You haven&apos;t joined any groups yet.</p>
      ) : (
        <div className="balances">
          {active.map((g) => (
            <div key={g.code} className="bal-row" style={{ cursor: canSync ? "pointer" : "default" }} onClick={() => canSync && openByCode(g.code)}>
              <span>{g.name || g.code}</span>
              <span style={{ opacity: 0.55, fontSize: "0.8rem" }}>{g.code}{g.players ? ` · ${g.players}p` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {chatGroups.length > 0 && (
        <>
          <h2 style={{ marginBottom: 2 }}>In this chat</h2>
          <p style={{ opacity: 0.6, fontSize: "0.78rem", marginTop: 0 }}>Tap to join — it&apos;ll be added to your groups.</p>
          <div className="balances">
            {chatGroups.map((g) => (
              <div key={g.code} className="bal-row" style={{ cursor: canSync ? "pointer" : "default" }} onClick={() => canSync && openByCode(g.code)}>
                <span>{g.name || g.code}</span>
                <span style={{ opacity: 0.55, fontSize: "0.8rem" }}>{g.code}{g.players ? ` · ${g.players}p` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="choices" style={{ marginTop: 14 }}>
        <div className="choice-btn" onClick={() => canSync && setView("create")}
          style={canSync ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>Create a new group<small>Set players + payouts</small></div>
        <div className="choice-btn" onClick={() => canSync && setView("join")}
          style={canSync ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>Join with a code<small>Enter a shared code</small></div>
      </div>

      <button className="link-btn" onClick={onOpenRiichi}>Riichi hand calculator →</button>
    </div>
  );
}

// First-run gate: choose a unique app username (pre-filled with the Telegram
// handle when there is one). Blocks the app until set — there's no back.
function UsernameGate({ suggested, hasHandle, onDone }: { suggested: string; hasHandle: boolean; onDone: (p: Profile) => void }) {
  const [name, setName] = useState(hasHandle ? suggested : "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = /^[A-Za-z0-9_]{3,20}$/.test(name.trim());
  const submit = async () => {
    if (!valid) { setErr("3–20 letters, numbers or underscores."); haptic("error"); return; }
    setSaving(true); setErr("");
    try { const { profile } = await setUsername(name.trim()); haptic("success"); onDone(profile); }
    catch (e) { haptic("error"); setErr(String((e as Error).message || e)); }
    finally { setSaving(false); }
  };
  return (
    <div>
      <h1>Pick a username</h1>
      <p style={{ opacity: 0.8, fontSize: "0.9rem" }}>
        {hasHandle
          ? "This is your name across the app. We suggested your Telegram handle — keep it and it stays in sync when you rename on Telegram, or type your own to fix it."
          : "This is your name across the app. You don't have a Telegram username, so choose one."}
      </p>
      <input className="text-input" autoFocus value={name} maxLength={20} placeholder="username"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <button className="primary-btn" disabled={!valid || saving} onClick={submit}>
        {saving ? "Saving…" : "Continue"}
      </button>
      {err && <p style={{ color: "#e54848" }}>{err}</p>}
      <p style={{ opacity: 0.55, fontSize: "0.78rem" }}>3–20 letters, numbers or underscores. Must be unique.</p>
    </div>
  );
}

// Home header: shows your username with an inline editor. Changing it away from
// your Telegram handle stops the auto-mirroring (handled server-side).
function ProfileHeader({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.username);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = /^[A-Za-z0-9_]{3,20}$/.test(name.trim());
  const save = async () => {
    const nm = name.trim();
    if (nm === profile.username) { setEditing(false); return; }
    if (!valid) { setErr("3–20 letters, numbers or underscores."); return; }
    setSaving(true); setErr("");
    try { const { profile: p } = await setUsername(nm); haptic("success"); onChange(p); setEditing(false); }
    catch (e) { haptic("error"); setErr(String((e as Error).message || e)); }
    finally { setSaving(false); }
  };
  if (!editing)
    return (
      <p style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: 0 }}>
        Signed in as <strong>{profile.username}</strong>{" "}
        <button className="link-btn" style={{ padding: 0, fontSize: "inherit", verticalAlign: "baseline" }}
          onClick={() => { setName(profile.username); setErr(""); setEditing(true); }}>✎</button>
      </p>
    );
  return (
    <div style={{ marginBottom: 8 }}>
      <input className="text-input small" autoFocus value={name} maxLength={20}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <button className="chip" disabled={saving} onClick={save}>Save</button>
      <button className="chip" onClick={() => setEditing(false)}>Cancel</button>
      {err && <span style={{ color: "#e54848", fontSize: "0.8rem" }}> {err}</span>}
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
  useBackButton(onBack);
  const [code, setCode] = useState(initialCode || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const join = async () => {
    setLoading(true); setError("");
    try { onJoined(await openGroup(code.trim().toUpperCase())); }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setLoading(false); }
  };
  return (
    <div>
      <h1>Join a group</h1>
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

// Pick which player you are when entering a group you haven't joined (mirrors
// CoconutSplit): take over an unclaimed seat, or join as a new player.
function JoinGroup({
  state,
  busy,
  defaultName,
  onClaimed,
  onBack,
}: {
  state: TrackerState;
  busy: boolean;
  defaultName: string;
  onClaimed: (s: TrackerState) => void;
  onBack: () => void;
}) {
  useBackButton(onBack);
  const code = state.tracker.code;
  const roster = new Set(state.tracker.players || []); // every seat name in this group
  const claimed = new Set(state.claimedNames || []);
  const unclaimed = (state.tracker.players || []).filter((p) => !claimed.has(p));
  const isFull = (state.tracker.players || []).length >= 4;
  // Pre-fill the new-player name from your app username — but never a name
  // already taken as a seat here (else "Join as X" would 409 on the unique
  // (group, name)). Suffix a number on collision so the field is never blank.
  const base = (defaultName || "").trim();
  let suggestedName = base && !roster.has(base) ? base : "";
  if (!suggestedName && base) {
    for (let i = 2; i < 99 && !suggestedName; i++) if (!roster.has(`${base}${i}`)) suggestedName = `${base}${i}`;
  }
  const [newName, setNewName] = useState(suggestedName);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn: () => Promise<TrackerState>) => {
    setWorking(true); setErr("");
    try { onClaimed(await fn()); haptic("success"); }
    catch (e) {
      haptic("error");
      setErr(String((e as Error).message || e));
      // Lost the seat to someone else -> refresh so the taken seat disappears.
      try { onClaimed(await openGroup(code)); } catch { /* keep the error shown */ }
    }
    finally { setWorking(false); }
  };
  return (
    <div>
      <h1>Join {state.tracker.name || "group"}</h1>
      <p style={{ opacity: 0.75, fontSize: "0.9rem" }}>Which player are you? This links your Telegram account to that seat.</p>
      {unclaimed.length > 0 && (
        <>
          <h2>Take a seat</h2>
          <div className="choices">
            {unclaimed.map((p) => (
              <div key={p} className="choice-btn" onClick={() => !working && run(() => claimSeat(code, p))}>{p}</div>
            ))}
          </div>
        </>
      )}
      {isFull ? (
        <p style={{ opacity: 0.65, fontSize: "0.88rem" }}>
          This group is full (4 players). You can only take an unclaimed seat above.
        </p>
      ) : (
        <>
          <h2>Or join as a new player</h2>
          <input className="text-input" placeholder="Your name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="primary-btn" disabled={!newName.trim() || working || busy} onClick={() => run(() => joinNew(code, newName.trim()))}>
            {working ? "Joining…" : `Join as ${newName.trim() || "new player"}`}
          </button>
        </>
      )}
      {err && <p style={{ color: "#e54848" }}>{err}</p>}
      <button className="link-btn" onClick={onBack}>← Back</button>
    </div>
  );
}

function SyncPlay({ initial, onBack }: { initial: TrackerState; onBack: () => void }) {
  const [state, setState] = useState<TrackerState>(initial);
  const [syncing, setSyncing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newSeat, setNewSeat] = useState("");
  const [renameErr, setRenameErr] = useState("");
  const code = state.tracker.code;
  const players = state.tracker.players;
  const bases = state.tracker.bases;
  const busyRef = useRef(false);
  const renamingRef = useRef(false); // pause polling while the rename editor is open
  // Monotonic epoch bumped on every local mutation. A poll started under an
  // older epoch must NOT overwrite state written by a newer mutation that
  // resolved first (a late-resolving getState would otherwise revert it).
  const epochRef = useRef(0);

  // Poll for others' changes.
  useEffect(() => {
    const id = setInterval(async () => {
      if (busyRef.current || renamingRef.current) return;
      const e = epochRef.current;
      try { const s = await getState(code); if (epochRef.current === e) setState(s); } catch { /* keep last */ }
    }, 2500);
    return () => clearInterval(id);
  }, [code]);

  const log: LogEntry[] = state.actions.map((a) => ({ summary: a.summary, transfers: a.transfers, actioner: a.actioner, meta: a.meta }));
  const balances = computeBalances(players, log);
  const shareLink = `${BOT_APP_LINK}?startapp=${code}`;

  const record = async (summary: string, transfers: Transfer[], meta?: ActionMeta) => {
    busyRef.current = true; epochRef.current++;
    setSyncing(true);
    try { setState(await addRemoteAction(code, summary, transfers, meta)); haptic("success"); }
    catch (e) {
      haptic("error");
      alert("Couldn't record: " + (e as Error).message);
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
              {renameErr && <span style={{ color: "#e54848", fontSize: "0.8rem" }}> {renameErr}</span>}
            </div>
          )}
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
  note,
}: {
  title: string;
  onStart: (name: string, players: string[], bases: Bases) => void;
  onBack: () => void;
  busy?: boolean;
  error?: string;
  startLabel?: string;
  note?: string;
}) {
  useBackButton(onBack);
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
      {note && <p style={{ fontSize: "0.85rem", opacity: 0.75 }}>{note}</p>}
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
  onRecord: (summary: string, transfers: Transfer[], meta?: ActionMeta) => void;
  onEnd?: () => void;
  onBack: () => void;
  banner?: React.ReactNode;
}) {
  useBackButton(onBack);
  const [action, setAction] = useState<Action | null>(null);
  const openAction = (a: Action) => { haptic("light"); setAction(a); };

  if (action) return <ActionForm action={action} players={players} bases={bases} onCancel={() => setAction(null)}
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
        <div key={o.v} className={"chip" + (value === o.v ? " selected" : "")} onClick={() => { haptic("selection"); onChange(o.v); }}>{o.label}</div>
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
  onConfirm: (summary: string, transfers: Transfer[], meta: ActionMeta) => void;
}) {
  useBackButton(onCancel);            // native back cancels the half-entered hand
  useClosingConfirmation(true);       // guard against losing it to an accidental close
  const playerOpts = players.map((p) => ({ v: p, label: p }));
  const tais = Array.from({ length: maxTaiOf(bases) }, (_, i) => i + 1);
  const [s, setS] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setS((prev) => ({ ...prev, [k]: v }));

  let ready = false;
  let build: (() => { summary: string; transfers: Transfer[]; meta: ActionMeta }) | null = null;

  if (action === "hu") {
    ready = !!(s.tai && s.winner && s.discarder && s.winner !== s.discarder);
    build = () => {
      const tai = parseInt(s.tai); const value = discardValue(bases, tai);
      return { summary: `Hu: ${s.winner} wins off ${s.discarder} (${tai} tai)`, transfers: settleDiscardWin(s.winner, s.discarder, value),
        meta: { k: "hu", tai, winner: s.winner, discarder: s.discarder } };
    };
  } else if (action === "zimo") {
    ready = !!(s.tai && s.winner);
    build = () => {
      const tai = parseInt(s.tai); const perPlayer = zimoEachValue(bases, tai);
      return { summary: `Zimo: ${s.winner} self-draws (${tai} tai)`, transfers: settleSelfDraw(s.winner, perPlayer, players),
        meta: { k: "zimo", tai, winner: s.winner } };
    };
  } else if (action === "gang") {
    ready = !!(s.konger && s.gscope && (s.gscope !== "one" || (s.gpayer && s.gpayer !== s.konger)));
    build = () => {
      const payer = s.gscope === "one" ? s.gpayer : null;
      return { summary: `Gang: ${s.konger} kong${payer ? ` off ${payer}` : " (all pay)"}`,
        transfers: settleGang(s.konger, bases.gang, players, payer),
        meta: { k: "gang", konger: s.konger, payer: payer ?? null } };
    };
  } else {
    ready = !!(s.biter && s.scope && (s.scope !== "one" || (s.target && s.target !== s.biter)));
    build = () => {
      const target = s.scope === "one" ? s.target : null;
      return { summary: `Yao: ${s.biter} bite${target ? ` on ${target}` : " (all pay)"}`,
        transfers: settleYao(s.biter, bases.yao, players, target),
        meta: { k: "yao", biter: s.biter, target: target ?? null } };
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

      <button className="primary-btn" disabled={!ready} onClick={() => { if (build) { const r = build(); onConfirm(r.summary, r.transfers, r.meta); } }}>
        Confirm {action.toUpperCase()}
      </button>
      <button className="link-btn" onClick={onCancel}>← Cancel</button>
    </div>
  );
}
