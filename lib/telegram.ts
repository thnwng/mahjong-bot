"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing for the bits of the Telegram WebApp SDK we use. These are all
// methods exposed by the official telegram-web-app.js the app already loads —
// no extra dependency. Everything is optional so calls degrade gracefully when
// a method is missing (older Telegram client) or we're in a plain browser.
interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name?: string; username?: string };
    start_param?: string;
  };
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  setHeaderColor?: (c: string) => void;
  isVersionAtLeast?: (v: string) => boolean;
  BackButton?: {
    isVisible?: boolean;
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred?: (type: "error" | "success" | "warning") => void;
    selectionChanged?: () => void;
  };
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function webApp(): TelegramWebApp | undefined {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export interface TelegramState {
  ready: boolean;
  inTelegram: boolean;
  initData: string; // raw initData string - send to a backend to validate (HMAC) when one exists
  user: { id: number; name: string } | null;
}

/**
 * Initialises the Telegram Mini App SDK (ready/expand) and surfaces initData +
 * the current user. Works outside Telegram too (inTelegram=false) so the app
 * is usable in a plain browser during development.
 */
export function useTelegram(): TelegramState {
  const [state, setState] = useState<TelegramState>({
    ready: false,
    inTelegram: false,
    initData: "",
    user: null,
  });

  useEffect(() => {
    const wa = webApp();
    if (wa) {
      try {
        wa.ready();
        wa.expand();
      } catch {
        /* ignore */
      }
      const u = wa.initDataUnsafe?.user;
      setState({
        ready: true,
        inTelegram: Boolean(wa.initData),
        initData: wa.initData || "",
        user: u ? { id: u.id, name: u.first_name || u.username || String(u.id) } : null,
      });
    } else {
      setState((s) => ({ ...s, ready: true }));
    }
  }, []);

  return state;
}

// -------------------------------------------------------------- haptic feedback

export type Haptic =
  | "light" | "medium" | "heavy" | "rigid" | "soft" // taps
  | "success" | "error" | "warning"                 // outcomes
  | "selection";                                     // picking an option

/**
 * Fire native haptic feedback. No-ops silently outside Telegram or on clients
 * too old to support it.
 */
export function haptic(kind: Haptic): void {
  const hf = webApp()?.HapticFeedback;
  if (!hf) return;
  try {
    if (kind === "success" || kind === "error" || kind === "warning") hf.notificationOccurred?.(kind);
    else if (kind === "selection") hf.selectionChanged?.();
    else hf.impactOccurred?.(kind);
  } catch {
    /* unsupported on this client */
  }
}

// ---------------------------------------------------------------- back button
//
// Telegram gives one native back button in the header. The app has several
// nested screens, so we keep a small stack of back handlers: whichever screen
// mounted last (the deepest one on screen) owns the button. When the stack is
// empty (the home screen) the button hides itself. Each screen registers via
// useBackButton(); unmounting pops it off automatically.

type BackEntry = { id: number; fn: () => void };
const backStack: BackEntry[] = [];
let backSeq = 0;
let backBound = false;

function syncBackButton(): void {
  const bb = webApp()?.BackButton;
  if (!bb) return;
  if (backStack.length > 0) bb.show?.();
  else bb.hide?.();
}

function onBackClicked(): void {
  const top = backStack[backStack.length - 1];
  if (top) top.fn();
}

function pushBackHandler(fn: () => void): () => void {
  const bb = webApp()?.BackButton;
  // Bind the click listener once, globally; it routes to the top of the stack.
  if (bb && !backBound && bb.onClick) {
    bb.onClick(onBackClicked);
    backBound = true;
  }
  const id = ++backSeq;
  backStack.push({ id, fn });
  syncBackButton();
  return () => {
    const i = backStack.findIndex((e) => e.id === id);
    if (i !== -1) backStack.splice(i, 1);
    syncBackButton();
  };
}

/**
 * Show the native Telegram back button while this component is mounted and run
 * `handler` when it's tapped. The latest handler is always used (kept in a ref)
 * so passing a fresh arrow each render doesn't churn the subscription.
 */
export function useBackButton(handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => pushBackHandler(() => ref.current()), []);
}

// ------------------------------------------------------- closing confirmation

/**
 * While `enabled` is true, Telegram asks "Are you sure?" before the user closes
 * or swipes the mini app away — used to guard unsaved input (e.g. a half-entered
 * hand). No-ops outside Telegram.
 */
export function useClosingConfirmation(enabled: boolean): void {
  useEffect(() => {
    const wa = webApp();
    if (!wa?.enableClosingConfirmation) return;
    if (enabled) wa.enableClosingConfirmation();
    else wa.disableClosingConfirmation?.();
    return () => wa.disableClosingConfirmation?.();
  }, [enabled]);
}
