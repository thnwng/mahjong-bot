"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTelegram } from "@/lib/telegram";
import RiichiCalculator from "@/components/RiichiCalculator";
import SGTaiHands from "@/components/sg/SGTaiHands";
import SGGame from "@/components/SGGame";
import { OFFLINE } from "@/lib/sg/remote";

// Dev-only components: lazy-loaded so they compile into separate chunks the
// production bundle (OFFLINE=false, riichigame route OFFLINE-gated) never loads.
const DevBar = dynamic(() => import("@/components/DevBar"), { ssr: false });
const RiichiGame = dynamic(() => import("@/components/riichi/RiichiGame"), { ssr: false });

type Screen = "home" | "riichi" | "sgtai" | "riichigame";

export default function Page() {
  useTelegram(); // initialise the Telegram Mini App SDK (no-op in a plain browser)
  const [screen, setScreen] = useState<Screen | null>(null);

  // The landing is the Singaporean groups home (it reads any ?startapp deep
  // link itself). ?type=riichi opens the Riichi calculator directly. Resolved
  // in an effect so the prerender and first client render match.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    setScreen(
      t === "riichi" ? "riichi"
        : t === "sgtai" ? "sgtai"
        : t === "riichigame" && OFFLINE ? "riichigame" // dev-only route
        : "home"
    );
  }, []);

  if (screen === null) return null;
  const body =
    screen === "riichi"
      ? <RiichiCalculator onBack={() => setScreen("home")} />
      : screen === "sgtai"
        ? <SGTaiHands onBack={() => setScreen("home")} />
        : screen === "riichigame"
          ? <RiichiGame players={["Alice", "Bob", "Cara", "Dave"]} onBack={() => setScreen("home")} />
          : <SGGame onOpenRiichi={() => setScreen("riichi")} />;

  // OFFLINE dev mode: show the dev toolbar (switch fake player / reset) above the app.
  return OFFLINE ? <>{<DevBar />}{body}</> : body;
}
