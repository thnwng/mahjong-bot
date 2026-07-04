"use client";

// Router + home for the tracker. The screens live in components/sg/ (Identity,
// Join, Setup, Group, Play, Settings); this file owns boot (username gate ->
// game-types gate -> launch), the home screen, and which screen is showing.

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/telegram";
import { UsernameGate, GameTypesGate } from "@/components/sg/Identity";
import { JoinForm, JoinGroup } from "@/components/sg/Join";
import { Setup } from "@/components/sg/Setup";
import { GroupScreen, NewSession } from "@/components/sg/Group";
import { Play } from "@/components/sg/Play";
import { Settings } from "@/components/sg/Settings";
import { SGTiles } from "@/components/sg/SGTiles";
import {
  syncEnabled,
  parseStartParam,
  createTracker,
  listByChat,
  openGroup,
  myGroups,
  startSession,
  rememberGroup,
  rememberGroupForChat,
  lastGroupForChat,
  localGroups,
  setLocalGroups,
  getMe,
  Profile,
  GameType,
  GAME_TYPES,
  GroupSummary,
  TrackerState,
} from "@/lib/sg/remote";

// Exactly one screen is showing at a time; every screen's data rides along in
// its variant, so illegal combinations can't be represented.
type Screen =
  | { t: "home" }
  | { t: "settings" }
  | { t: "tiles" }                             // SG/Msia tile picker (tai helper)
  | { t: "create" }
  | { t: "join" }                              // type a group code
  | { t: "joining"; state: TrackerState }      // pick which seat you are
  | { t: "group"; state: TrackerState }        // debts + session banner
  | { t: "newSession"; state: TrackerState }   // session setup
  | { t: "play"; state: TrackerState };        // the live session

const sumOf = (s: TrackerState): GroupSummary => ({ code: s.tracker.code, name: s.tracker.name, players: s.tracker.players.length });

// Manual home ordering (the default is recent-activity from the server; a tap
// on the up-arrow pins your own order). Per Telegram account, on-device.
function orderKey(): string {
  const uid = typeof window !== "undefined" ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : undefined;
  return `mahjong-order:${uid ?? "anon"}`;
}
function applyOrder(gs: GroupSummary[]): GroupSummary[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(orderKey()) || "[]");
    if (!Array.isArray(saved) || !saved.length) return gs;
    const codes = saved.map(String);
    const by = new Map(gs.map((g) => [g.code, g]));
    const first = codes.map((c) => by.get(c)).filter((g): g is GroupSummary => !!g);
    const rest = gs.filter((g) => !codes.includes(g.code));
    return [...first, ...rest];
  } catch { return gs; }
}

export default function SGGame({ onOpenRiichi }: { onOpenRiichi: () => void }) {
  const [screen, setScreen] = useState<Screen>({ t: "home" });
  const [tgChatId, setTgChatId] = useState<number | undefined>(undefined);
  const [active, setActive] = useState<GroupSummary[]>([]);   // groups THIS account is in
  const [chatGroups, setChatGroups] = useState<GroupSummary[]>([]); // this chat's groups you can join
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<GameType>("sg4");
  // Inside Telegram we have a validated account; outside (plain browser) we
  // don't. canSync also needs the backend URL configured.
  const inTelegram = typeof window !== "undefined" && Boolean(window.Telegram?.WebApp?.initData);
  const canSync = inTelegram && syncEnabled();

  // First-run gates: username, then the what-do-you-play checklist.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needUsername, setNeedUsername] = useState(false);
  const [needPrefs, setNeedPrefs] = useState(false);
  const [gate, setGate] = useState<{ suggested: string; hasHandle: boolean }>({ suggested: "", hasHandle: true });
  const [bootError, setBootError] = useState("");
  const startRef = useRef<{ cid?: number; code?: string }>({});

  // When launched from a Telegram group chat we remember which tracker-group the
  // account opened there, so a return trip jumps straight back into it.
  const chatIdRef = useRef<number | undefined>(undefined);
  const chatCodesRef = useRef<Set<string>>(new Set());
  const noteChatGroup = (code: string) => {
    const cid = chatIdRef.current;
    if (cid !== undefined && chatCodesRef.current.has(code)) rememberGroupForChat(cid, code);
  };

  // Enter a group: claimed a seat -> the group page (debts + session); not yet
  // -> the Join screen. Only claimed groups become "yours".
  const enter = (s: TrackerState) => {
    noteChatGroup(s.tracker.code);
    if (s.me) { rememberGroup(sumOf(s)); setScreen({ t: "group", state: s }); }
    else setScreen({ t: "joining", state: s });
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
    const yours = mine.status === "fulfilled" ? mine.value.groups : localGroups();
    if (mine.status === "fulfilled") { setActive(applyOrder(yours)); setLocalGroups(yours); }
    const chatAll = chat.status === "fulfilled" ? chat.value.groups : [];
    chatCodesRef.current = new Set(chatAll.map((g) => g.code));
    const mineCodes = new Set(yours.map((g) => g.code));
    setChatGroups(chatAll.filter((g) => !mineCodes.has(g.code)));
    // Launched from a Telegram group chat: jump straight into that chat's group.
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
        // just run the app without profiles so nobody is locked out.
        if (/unknown op/i.test(String((e as Error).message || e))) { await resolveLaunch(cid, code); return; }
        throw e; // genuine failure -> retryable bootError screen
      }
      if (!me.profile) {
        setGate({ suggested: me.suggested || "", hasHandle: me.hasHandle !== false });
        setNeedUsername(true);
        return;
      }
      setProfile(me.profile);
      // gameTypes === null means the checklist was never done (undefined =
      // older server that doesn't know about it -> skip, don't gate).
      if (me.profile.gameTypes === null) { setNeedPrefs(true); return; }
      await resolveLaunch(cid, code);
    } catch (e) {
      setBootError(String((e as Error).message || e));
    } finally {
      setBooting(false);
    }
  };

  // Username picked -> ask what they play. Gate ONLY on null (the new server
  // says "never chosen"); undefined means an older server that doesn't know
  // about game types — same skew rule as runBoot, never strand a first-run
  // user on a checklist the server can't save.
  const finishGate = (p: Profile) => {
    setProfile(p); setNeedUsername(false);
    if (p.gameTypes === null || (Array.isArray(p.gameTypes) && p.gameTypes.length === 0)) { setNeedPrefs(true); return; }
    finishPrefs(p.gameTypes || ["sg4"]);
  };

  const finishPrefs = async (types: GameType[]) => {
    setProfile((prev) => (prev ? { ...prev, gameTypes: types } : prev));
    setNeedPrefs(false); setBooting(true);
    const { cid, code } = startRef.current;
    try { await resolveLaunch(cid, code); }
    finally { setBooting(false); }
  };

  useEffect(() => {
    setActive(applyOrder(localGroups())); // instant paint from the on-device cache
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
        <p className="err">Couldn&apos;t load: {bootError}</p>
        <button className="primary-btn" onClick={runBoot}>Try again</button>
      </div>
    );
  if (needUsername)
    return <UsernameGate suggested={gate.suggested} hasHandle={gate.hasHandle} onDone={finishGate} />;
  if (needPrefs)
    return <GameTypesGate onDone={finishPrefs} />;

  // Re-read the cache on returning home so a just-created/joined/opened group
  // shows in "Your groups" — and drops out of the chat's "to join" list.
  const goHome = () => {
    setScreen({ t: "home" }); setError("");
    const yours = localGroups();
    setActive(applyOrder(yours));
    const codes = new Set(yours.map((g) => g.code));
    setChatGroups((prev) => prev.filter((g) => !codes.has(g.code)));
    if (canSync) { myGroups().then(({ groups }) => { setActive(applyOrder(groups)); setLocalGroups(groups); }).catch(() => { /* cache stays */ }); }
  };
  const openByCode = async (code: string) => {
    setBusy(true); setError("");
    try { enter(await openGroup(code)); }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    haptic("selection");
    setActive((prev) => {
      const next = prev.slice();
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      try { localStorage.setItem(orderKey(), JSON.stringify(next.map((g) => g.code))); } catch { /* ignore */ }
      return next;
    });
  };

  switch (screen.t) {
    case "play":
      return <Play initial={screen.state} onBack={() => setScreen({ t: "group", state: screen.state })}
        onEnded={(s) => setScreen({ t: "group", state: s })} />;

    case "group":
      return (
        <GroupScreen
          state={screen.state}
          busy={busy}
          onNewSession={() => setScreen({ t: "newSession", state: screen.state })}
          onEnterSession={() => setScreen({ t: "play", state: screen.state })}
          onBack={goHome}
        />
      );

    case "newSession":
      return (
        <NewSession
          state={screen.state}
          presets={profile?.presets || []}
          busy={busy}
          error={error}
          onPresets={(presets) => setProfile((p) => (p ? { ...p, presets } : p))}
          onStart={async (opts) => {
            setBusy(true); setError("");
            try { const s = await startSession(screen.state.tracker.code, opts); haptic("success"); setScreen({ t: "play", state: s }); }
            catch (e) {
              haptic("error");
              const msg = String((e as Error).message || e);
              // Someone beat us to it -> show the running session instead.
              if (/already running/i.test(msg)) {
                try { const s = await openGroup(screen.state.tracker.code); setScreen({ t: "group", state: s }); return; } catch { /* fall through */ }
              }
              setError(msg);
            }
            finally { setBusy(false); }
          }}
          onBack={() => { setError(""); setScreen({ t: "group", state: screen.state }); }}
        />
      );

    case "joining":
      return <JoinGroup state={screen.state} busy={busy} defaultName={profile?.username || ""} onClaimed={enter}
        onBack={goHome} />;

    case "create":
      return (
        <Setup
          title="Create a new group" startLabel="Create group" presets={profile?.presets || []}
          note={tgChatId !== undefined
            ? "When you create it, I'll post a join button in your Telegram group so everyone can tap to join — then pick which player you are."
            : "After creating, pick which player you are."}
          onStart={async (name, players, bases, defaultType) => {
            setBusy(true); setError("");
            try {
              const st = await createTracker(name, players, bases, tgChatId, defaultType);
              if (tgChatId !== undefined) chatCodesRef.current.add(st.tracker.code);
              enter(st);
            }
            catch (e) { setError(String((e as Error).message || e)); }
            finally { setBusy(false); }
          }}
          onBack={goHome} busy={busy} error={error}
        />
      );

    case "join":
      return <JoinForm initialCode={null} busy={busy} onBack={goHome} onJoined={enter} />;

    case "settings":
      return profile
        ? <Settings profile={profile} onProfile={setProfile} onBack={goHome} />
        : <div><h1>Settings</h1><p className="err">Open this inside Telegram to manage your profile.</p>
            <button className="link-btn" onClick={goHome}>← Back</button></div>;

    case "tiles":
      return <SGTiles onBack={goHome} />;

    case "home": {
      const types: GameType[] = profile?.gameTypes?.length ? profile.gameTypes : ["sg4"];
      const shownTab: GameType = types.includes(tab) ? tab : (types.find((t) => t !== "riichi") ?? types[0]);
      return (
        <div>
          <h1>Mahjong</h1>
          {profile ? (
            <p style={{ opacity: 0.75, fontSize: "0.85rem", marginTop: 0 }}>
              Welcome back, <strong>{profile.username}</strong>{" · "}
              <button className="link-btn" style={{ padding: 0, fontSize: "inherit", verticalAlign: "baseline" }}
                onClick={() => setScreen({ t: "settings" })}>Settings</button>
            </p>
          ) : null}
          {!inTelegram && <p className="err">Open this inside Telegram to use shared groups.</p>}
          {error && <p className="err">{error}</p>}

          {types.length > 1 && (
            <select className="text-input" value={shownTab}
              onChange={(e) => {
                const v = e.target.value as GameType;
                haptic("selection");
                if (v === "riichi") { onOpenRiichi(); return; }
                setTab(v);
              }}>
              {types.map((t) => (
                <option key={t} value={t}>{GAME_TYPES.find((g) => g.v === t)?.label || t}</option>
              ))}
            </select>
          )}

          {shownTab === "riichi" ? (
            <div className="choices" style={{ marginTop: 8 }}>
              <div className="choice-btn" onClick={onOpenRiichi}>Riichi calculator<small>score a hand</small></div>
            </div>
          ) : shownTab === "my3" ? (
            <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>
              Malaysian 3-player is coming soon — its groups and sessions will live here. (WIP)
            </p>
          ) : (
            <>
              <h2>Your groups</h2>
              {active.length === 0 ? (
                <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>You haven&apos;t joined any groups yet.</p>
              ) : (
                <>
                <div className="balances">
                  {active.map((g, i) => (
                    <div key={g.code} className="bal-row" style={{ cursor: canSync ? "pointer" : "default", alignItems: "center" }}
                      onClick={() => canSync && openByCode(g.code)}>
                      <span>
                        {g.name || g.code}
                        {g.hasActive && <span style={{ color: "var(--button)", fontSize: "0.75rem" }}> · session on</span>}
                        <span style={{ opacity: 0.5, fontSize: "0.75rem" }}> · {g.code}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {typeof g.myNet === "number" && (
                          <span className={"bal " + (g.myNet >= 0 ? "pos" : "neg")} style={{ fontSize: "0.85rem" }}>
                            {g.myNet >= 0 ? "+" : ""}{g.myNet.toFixed(2)}
                          </span>
                        )}
                        {i > 0 && (
                          <button className="chip" style={{ padding: "2px 8px", fontSize: "0.8rem" }}
                            onClick={(e) => { e.stopPropagation(); moveUp(i); }}>↑</button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <p style={{ opacity: 0.55, fontSize: "0.75rem", marginTop: 4 }}>
                  Ordered by recent activity — use ↑ to pin your own order. Tap a group to enter it and start a session.
                </p>
                </>
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
                <div className="choice-btn" onClick={() => canSync && setScreen({ t: "create" })}
                  style={canSync ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>Create a new group<small>players + defaults</small></div>
                <div className="choice-btn" onClick={() => canSync && setScreen({ t: "join" })}
                  style={canSync ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>Join with a code<small>enter a shared code</small></div>
              </div>
            </>
          )}

          {(shownTab === "sg4" || shownTab === "my3") && (
            <div style={{ marginTop: 12 }}>
              <button className="link-btn" onClick={() => setScreen({ t: "tiles" })}>Tai calculator (tiles) →</button>
            </div>
          )}

          {!types.includes("riichi") || types.length === 1 ? (
            <button className="link-btn" onClick={onOpenRiichi}>Riichi hand calculator →</button>
          ) : null}
        </div>
      );
    }
  }
}
