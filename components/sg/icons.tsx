// Material Symbols (Outlined, weight 400, 24dp) — icon geometry from Google's
// material-design-icons, Apache License 2.0.
//
// WHY INLINE SVG AND NOT THE ICON FONT: this is a Telegram Mini App that boots on
// mobile data inside a webview. Both font routes are worse here:
//   • Google Fonts CDN — a blocking third-party round-trip before any icon paints,
//     and Material Symbols renders its ligature names as the LITERAL WORDS
//     ("delete", "settings") until the font arrives. Very visible on a slow boot.
//   • self-hosted variable font — hundreds of KB-plus of glyphs to ship ~7 icons.
// Each path below is ~100–650 bytes, needs no network, can't FOUT, and inherits
// colour through currentColor so .icon-btn/.chip styling just works.
//
// Material Symbols use a "0 -960 960 960" viewBox and ONE filled path.
// TO ADD AN ICON: fetch the official SVG and paste its path `d` — never
// hand-author or guess the geometry.
//   https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/default/24px.svg

import type { CSSProperties } from "react";

type IconProps = { size?: number; className?: string; style?: CSSProperties };

// Decorative by default: every caller pairs the icon with an aria-label on the
// button (icon-only) or with visible text, so the glyph itself stays hidden from
// screen readers.
const Sym = ({ d, size = 18, className, style }: IconProps & { d: string }) => (
  <svg viewBox="0 -960 960 960" width={size} height={size} fill="currentColor"
    className={className} style={style} aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <Sym {...p} d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z" />
);

export const IconEdit = (p: IconProps) => (
  <Sym {...p} d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
);

export const IconCopy = (p: IconProps) => (
  <Sym {...p} d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
);

export const IconClose = (p: IconProps) => (
  <Sym {...p} d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
);

export const IconDelete = (p: IconProps) => (
  <Sym {...p} d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
);

// Available for the "← Back" buttons (currently a literal arrow character).
export const IconBack = (p: IconProps) => (
  <Sym {...p} d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z" />
);

// Alternative to IconClose for removing a player from the roster.
export const IconPersonRemove = (p: IconProps) => (
  <Sym {...p} d="M640-520v-80h240v80H640Zm-393-7q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm80-80h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q440-607 440-640t-23.5-56.5Q393-720 360-720t-56.5 23.5Q280-673 280-640t23.5 56.5Q327-560 360-560t56.5-23.5ZM360-640Zm0 400Z" />
);
