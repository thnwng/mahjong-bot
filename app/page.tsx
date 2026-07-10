"use client";

import { useEffect, useState } from "react";
import { useTelegram } from "@/lib/telegram";
import RiichiCalculator from "@/components/RiichiCalculator";
import SGTaiHands from "@/components/sg/SGTaiHands";
import SGGame from "@/components/SGGame";

type Screen = "home" | "riichi" | "sgtai";

export default function Page() {
  useTelegram(); // initialise the Telegram Mini App SDK (no-op in a plain browser)
  const [screen, setScreen] = useState<Screen | null>(null);

  // The landing is the Singaporean groups home (it reads any ?startapp deep
  // link itself). ?type=riichi opens the Riichi calculator directly. Resolved
  // in an effect so the prerender and first client render match.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    setScreen(t === "riichi" ? "riichi" : t === "sgtai" ? "sgtai" : "home");
  }, []);

  if (screen === null) return null;
  if (screen === "riichi") return <RiichiCalculator onBack={() => setScreen("home")} />;
  if (screen === "sgtai") return <SGTaiHands onBack={() => setScreen("home")} />;
  return <SGGame onOpenRiichi={() => setScreen("riichi")} />;
}
