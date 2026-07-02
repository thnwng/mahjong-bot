"use client";

// Router + home for the Singaporean group tracker. The screens themselves live
// in components/sg/ (Identity, Join, Setup, Play); this file owns boot (profile
// gate, deep links, launch-into-chat-group) and which screen is showing.

import { useEffect, useRef, useState } from "react";
import { UsernameGate, ProfileHeader } from "@/components/sg/Identity";
import { JoinForm, JoinGroup } from "@/components/sg/Join";
import { Setup } from "@/components/sg/Setup";
import { Play } from "@/components/sg/Play";
import {
  syncEnabled,
  parseStartParam,
  createTracker,
  listByChat,
  openGroup,
  myGroups,
  rememberGroup,
  rememberGroupForChat,
  lastGroupForChat,
  localGroups,
  setLocalGroups,
  getMe,
  Profile,
  GroupSummary,
  TrackerState,
} from "@/lib/sg/remote";

// Exactly one screen is showing at a time; every screen's data rides along in
// its variant, so illegal combinations (e.g. "joining" with no group) can't be
// represented.
type Screen =
  | { t: "home" }
  | { t: "create" }
  | { t: "join" }                            // type a group code
  | { t: "joining"; state: TrackerState }    // pick which seat you are
  | { t: "play"; state: TrackerState };

const sumOf = (s: TrackerState): GroupSummary => ({ code: s.tracker.code, name: s.tracker.name, players: s.tracker.players.length });

export default function SGGame({ onOpenRiichi }: { onOpenRiichi: () => void }) {
  const [screen, setScreen] = useState<Screen>({ t: "home" });
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

  // Enter a group: if you've claimed a seat -> the game; if not -> the Join
  // screen (take a seat / join as new). Only claimed groups become "yours".
  const enter = (s: TrackerState) => {
    noteChatGroup(s.tracker.code);
    if (s.me) { rememberGroup(sumOf(s)); setScreen({ t: "play", state: s }); }
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

  // Boot: load this account's profile first. No username yet -> first-run gate;
  // otherwise resolve the launch. Kept in a function so a transient failure can
  // be retried instead of stranding the user.
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
        <p className="err">Couldn&apos;t load: {bootError}</p>
        <button className="primary-btn" onClick={runBoot}>Try again</button>
      </div>
    );
  if (needUsername)
    return <UsernameGate suggested={gate.suggested} hasHandle={gate.hasHandle} onDone={finishGate} />;

  // Re-read the cache on returning home so a just-created/joined/opened group
  // shows in "Your groups" — and drops out of the chat's "to join" list.
  const goHome = () => {
    setScreen({ t: "home" }); setError("");
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

  switch (screen.t) {
    case "play":
      return <Play initial={screen.state} onBack={goHome} />;

    case "joining":
      return <JoinGroup state={screen.state} busy={busy} defaultName={profile?.username || ""} onClaimed={enter}
        onBack={goHome} />;

    case "create":
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
          onBack={goHome} busy={busy} error={error}
        />
      );

    case "join":
      return <JoinForm initialCode={null} busy={busy} onBack={goHome} onJoined={enter} />;

    case "home":
      return (
        <div>
          <h1>Mahjong</h1>
          {profile && <ProfileHeader profile={profile} onChange={setProfile} />}
          {!inTelegram && <p className="err">Open this inside Telegram to use shared groups.</p>}
          {error && <p className="err">{error}</p>}

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
            <div className="choice-btn" onClick={() => canSync && setScreen({ t: "create" })}
              style={canSync ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>Create a new group<small>Set players + payouts</small></div>
            <div className="choice-btn" onClick={() => canSync && setScreen({ t: "join" })}
              style={canSync ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>Join with a code<small>Enter a shared code</small></div>
          </div>

          <button className="link-btn" onClick={onOpenRiichi}>Riichi hand calculator →</button>
        </div>
      );
  }
}
