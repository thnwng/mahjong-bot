"use client";

// A small round "?" button that reveals a help bubble on tap. Tap the dot to
// toggle it; tap the dot again, or anywhere outside, to dismiss. Used to explain
// payout conventions inline (e.g. how bites/kongs scale) without cluttering the
// form. Content is passed as children so each call site sets its own text.

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/telegram";

export function InfoDot({ label, children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // Close when tapping/clicking anywhere outside the dot + its bubble.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <span className="info-dot-wrap" ref={wrap}>
      <button
        type="button"
        className="info-dot"
        aria-label={label || "More info"}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); haptic("selection"); setOpen((o) => !o); }}
      >
        ?
      </button>
      {open && <span className="info-bubble" role="tooltip">{children}</span>}
    </span>
  );
}

// Shared "?" bubble explaining how bite (yao) and kong (gang) scale. x = the
// per-pax base you set; an- (concealed) hands pay double; "everybody" = all
// three other players each pay. Used next to the flats in both payout forms.
export function PayoutScaleInfo() {
  return (
    <InfoDot label="How bites & kongs scale">
      <span className="bub-row">yao / anyao, one person = <span className="bub-x">x / 2x</span></span>
      <span className="bub-row">yao / anyao, everybody = <span className="bub-x">3x / 6x</span></span>
      <span className="bub-row">gang (shoot or zimo after pong) / angang = <span className="bub-x">3x / 6x</span></span>
      <span className="bub-note">
        x = the bite or kong amount you set (per pax). &ldquo;Everybody&rdquo; = all three others each pay;
        an- (concealed) hands pay double.
      </span>
    </InfoDot>
  );
}
