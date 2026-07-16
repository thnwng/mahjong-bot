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

export const IconBack = (p: IconProps) => (
  <Sym {...p} d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z" />
);

export const IconChevronRight = (p: IconProps) => (
  <Sym {...p} d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" />
);

export const IconAdd = (p: IconProps) => (
  <Sym {...p} d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
);

export const IconSend = (p: IconProps) => (
  <Sym {...p} d="M120-160v-640l760 320-760 320Zm80-120 474-200-474-200v140l240 60-240 60v140Zm0 0v-400 400Z" />
);

export const IconShare = (p: IconProps) => (
  <Sym {...p} d="M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T720-200q0-17-11.5-28.5T680-240q-17 0-28.5 11.5T640-200q0 17 11.5 28.5T680-160ZM200-440q17 0 28.5-11.5T240-480q0-17-11.5-28.5T200-520q-17 0-28.5 11.5T160-480q0 17 11.5 28.5T200-440Zm508.5-291.5Q720-743 720-760t-11.5-28.5Q697-800 680-800t-28.5 11.5Q640-777 640-760t11.5 28.5Q663-720 680-720t28.5-11.5ZM680-200ZM200-480Zm480-280Z" />
);

export const IconPlay = (p: IconProps) => (
  <Sym {...p} d="M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z" />
);

export const IconLogin = (p: IconProps) => (
  <Sym {...p} d="M480-120v-80h280v-560H480v-80h280q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H480Zm-80-160-55-58 102-102H120v-80h327L345-622l55-58 200 200-200 200Z" />
);

export const IconCheck = (p: IconProps) => (
  <Sym {...p} d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
);

export const IconRefresh = (p: IconProps) => (
  <Sym {...p} d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
);

export const IconRestart = (p: IconProps) => (
  <Sym {...p} d="M440-122q-121-15-200.5-105.5T160-440q0-66 26-126.5T260-672l57 57q-38 34-57.5 79T240-440q0 88 56 155.5T440-202v80Zm80 0v-80q87-16 143.5-83T720-440q0-100-70-170t-170-70h-3l44 44-56 56-140-140 140-140 56 56-44 44h3q134 0 227 93t93 227q0 121-79.5 211.5T520-122Z" />
);

export const IconPersonCheck = (p: IconProps) => (
  <Sym {...p} d="M80-160v-112q0-33 17-62t47-44q51-26 115-44t141-18q30 0 58.5 3t55.5 9l-70 70q-11-2-21.5-2H400q-71 0-127.5 17T180-306q-9 5-14.5 14t-5.5 20v32h250l80 80H80Zm542 16L484-282l56-56 82 82 202-202 56 56-258 258ZM287-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm123 287Zm46.5-343.5Q480-607 480-640t-23.5-56.5Q433-720 400-720t-56.5 23.5Q320-673 320-640t23.5 56.5Q367-560 400-560t56.5-23.5ZM400-640Z" />
);

// Alternative to IconClose for removing a player from the roster.
export const IconPersonRemove = (p: IconProps) => (
  <Sym {...p} d="M640-520v-80h240v80H640Zm-393-7q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM40-160v-112q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v112H40Zm80-80h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q440-607 440-640t-23.5-56.5Q393-720 360-720t-56.5 23.5Q280-673 280-640t23.5 56.5Q327-560 360-560t56.5-23.5ZM360-640Zm0 400Z" />
);
