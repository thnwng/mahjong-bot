"use client";

// Shared SG mahjong scoring catalog — the winning-hand TYPES, their schematic
// tile demos, and the default tai values. Imported by both the standalone
// reference page (SGTaiHands) and each group's scoring settings (GroupSettings)
// so there's ONE source of truth for the hand list and defaults.
//
// Sourced from the Singaporean Mahjong scoring rules (Wikipedia). "限" = the
// agreed limit; "限+1" = one above the limit (the owner's house rule for the
// whole Special & limit section).

const TILE_BASE = (process.env.NEXT_PUBLIC_BASE_PATH || "") + "/tiles/sg/";
export const src = (code: string) => `${TILE_BASE}sg${code}.png`;

// A schematic demo of a hand's SHAPE: tile groups, "×N" multipliers, and text
// labels laid out in a row — never a specific winning combination.
export type Seg = { t: string[] } | { x: string } | { lbl: string };

export type Hand = {
  id: string;
  en: string;
  zh: string;
  py?: string;
  def: string; // default tai (a number, "限" = limit, or "限+1" = special)
  demo: Seg[];
  note?: string;
};

export function Demo({ segs }: { segs: Seg[] }) {
  return (
    <div className="hand-demo">
      {segs.map((s, i) =>
        "t" in s ? (
          <span key={i} className="demo-seg">
            {s.t.map((c, j) => (
              <span key={j} className="tile-schem">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(c)} alt={c} draggable={false} />
              </span>
            ))}
          </span>
        ) : "x" in s ? (
          <span key={i} className="demo-x">{s.x}</span>
        ) : (
          <span key={i} className="demo-lbl">{s.lbl}</span>
        )
      )}
    </div>
  );
}

// ── Standard scoring hands (fixed tai) ───────────────────────────────
export const STANDARD: Hand[] = [
  {
    id: "dragon", en: "Dragon triplet", zh: "元", py: "yuán", def: "1",
    demo: [{ t: ["RD", "RD", "RD"] }, { lbl: "any 1 dragon" }],
    note: "Triplet of red / green / white dragon — pong, kong, or concealed. +1 tai each.",
  },
  {
    id: "wind", en: "Seat / prevailing wind triplet", zh: "风", py: "fēng", def: "1",
    demo: [{ t: ["EW", "EW", "EW"] }],
    note: "Triplet of your seat wind or the prevailing wind. +1 each. If your seat wind IS the prevailing wind, that triplet scores 2.",
  },
  {
    id: "pengpeng", en: "Triplets hand", zh: "对对胡 / 碰碰胡", py: "pèng-pèng-hú", def: "2",
    demo: [{ t: ["1C", "1C", "1C"] }, { x: "×4" }, { t: ["5D", "5D"] }, { lbl: "eye" }],
    note: "Four triplets + a pair, any suits — melded pongs or concealed.",
  },
  {
    id: "halfflush", en: "Half flush", zh: "混一色 / 半色", py: "hùn-yī-sè", def: "2",
    demo: [{ t: ["2B", "3B", "4B"] }, { t: ["7B", "8B", "9B"] }, { lbl: "+" }, { t: ["RD", "RD", "RD"] }],
    note: "One suit + any winds / dragons.",
  },
  {
    id: "fullflush", en: "Full flush", zh: "清一色", py: "qīng-yī-sè", def: "4",
    demo: [{ t: ["1D", "2D", "3D"] }, { t: ["4D", "5D", "6D"] }, { lbl: "one suit only" }],
    note: "A single suit, no honours.",
  },
  {
    id: "mixedterm", en: "Mixed terminals", zh: "混么九 / 混老头", py: "hùn-yāo-jiǔ", def: "4",
    demo: [{ t: ["1C", "1C", "1C"] }, { t: ["9D", "9D", "9D"] }, { t: ["EW", "EW", "EW"] }, { lbl: "eye" }],
    note: "All-triplet hand of 1s / 9s and / or honour tiles (2 for triplets + 2 for terminals).",
  },
  {
    id: "pinghu", en: "Sequence hand", zh: "平胡", py: "píng-hú", def: "4",
    demo: [{ t: ["2C", "3C", "4C"] }, { x: "×4" }, { t: ["5C", "5C"] }, { lbl: "eye" }],
    note: "Four sequences + eye. Must be waiting on 2+ tiles — a single / edge / closed / pair wait only counts if you 自摸. Otherwise it drops to a Lesser sequence hand (below).",
  },
  {
    id: "xiaopinghu", en: "Lesser sequence hand", zh: "小平胡 / 臭平胡", py: "xiǎo-píng-hú", def: "1",
    demo: [{ t: ["2C", "3C", "4C"] }, { x: "×4" }, { t: ["5C", "5C"] }, { lbl: "but drew a flower / animal" }],
    note: "A sequence-hand shape where you drew any flower / animal — scores just 1 tai, on top of the flower / animal points.",
  },
  {
    id: "puregreen", en: "Pure green suit", zh: "绿一色", py: "lǜ-yī-sè", def: "4",
    demo: [{ t: ["2B", "3B", "4B"] }, { t: ["6B", "6B", "6B"] }, { t: ["8B", "8B", "8B"] }, { t: ["GD", "GD"] }],
    note: "Only 2, 3, 4, 6, 8 of bamboo + Green Dragon. (Many SG circles just treat this as a Half flush.)",
  },
  {
    id: "lessscholars", en: "Three lesser scholars", zh: "小三元", py: "xiǎo-sān-yuán", def: "3",
    demo: [{ t: ["RD", "RD", "RD"] }, { t: ["GD", "GD", "GD"] }, { t: ["WD", "WD"] }, { lbl: "dragon eye" }],
    note: "Two dragon triplets + a pair of the third dragon.",
  },
  {
    id: "lessblessings", en: "Four lesser blessings", zh: "小四喜", py: "xiǎo-sì-xǐ", def: "3",
    demo: [{ t: ["EW", "EW", "EW"] }, { t: ["SW", "SW", "SW"] }, { t: ["WW", "WW", "WW"] }, { t: ["NW", "NW"] }],
    note: "Three wind triplets + a pair of the fourth wind. 3–4 tai (a seat / prevailing-wind triplet adds its bonus).",
  },
  {
    id: "menqing", en: "Fully concealed hand", zh: "门清", py: "mén-qīng", def: "1",
    demo: [{ t: ["2C", "3C", "4C"] }, { t: ["6D", "7D", "8D"] }, { t: ["8B", "8B", "8B"] }, { lbl: "self-draw" }],
    note: "No chow / pong, and you self-draw the winning tile. +1 tai. (House rule — confirm before playing.)",
  },
];

// ── Bonus events (+tai on top of the hand) ───────────────────────────
export const EVENTS: Hand[] = [
  {
    id: "huashang", en: "Win on flower replacement", zh: "花上", py: "huā-shàng", def: "1",
    demo: [{ t: ["F1"] }, { lbl: "→ replacement is the winning tile" }],
    note: "A ready hand draws a flower / animal and the 补花 replacement completes the win. +1.",
  },
  {
    id: "gangshang", en: "Win on kong replacement", zh: "杠上", py: "gàng-shàng", def: "1",
    demo: [{ t: ["5B", "5B", "5B", "5B"] }, { lbl: "→ replacement wins" }],
    note: "The 补杠 replacement tile drawn after a kong completes the win. +1.",
  },
  {
    id: "qianggang", en: "Robbing the kong", zh: "抢杠", py: "qiǎng-gàng", def: "1",
    demo: [{ t: ["3C", "3C", "3C"] }, { lbl: "+ robbed 3C" }],
    note: "Win on the tile another player adds to their exposed pong to make a kong. +1.",
  },
  {
    id: "haidi", en: "Win on the last tile", zh: "海底捞月", py: "hǎi-dǐ-lāo-yuè", def: "1",
    demo: [{ t: ["1D"] }, { lbl: "last drawable tile" }],
    note: "Win on the last drawable (16th-from-back) tile. +1.",
  },
  {
    id: "huashanghua", en: "Flower on flower", zh: "花上花", py: "huā-shàng-huā", def: "5",
    demo: [{ t: ["F1"] }, { t: ["F2"] }, { lbl: "→ 2nd replacement wins" }],
    note: "Two flowers / animals in a row and the second 补花 replacement is the winning tile. Variant: 5 tai, or +1 per consecutive 补花 — agree beforehand.",
  },
];

// ── Flowers & animals (tai; also have instant payouts) ───────────────
export const FLOWERS: Hand[] = [
  {
    id: "zhenghua", en: "Flower matching your seat", zh: "正花", py: "zhèng-huā", def: "1",
    demo: [{ t: ["F1"] }, { lbl: "matches seat wind" }],
    note: "Each flower / season that matches your seat number. +1 tai each. (Off-seat flowers 偏花 score nothing.)",
  },
  {
    id: "animal", en: "Animal tile", zh: "禽兽牌", py: "qín-shòu", def: "1",
    demo: [{ lbl: "cat · rat · rooster · centipede" }],
    note: "Each animal +1 tai; all four = 5 tai. (No SG animal art in this tile set — shown as text.)",
  },
  {
    id: "yitaihua", en: "Complete flower group", zh: "一台花", py: "yī-tái-huā", def: "2",
    demo: [{ t: ["F1", "F2", "F3", "F4"] }],
    note: "All four flowers (or all four seasons) of one colour. +2 tai (1 seat-match + 1 set) plus an instant payout.",
  },
];

// ── Special / limit hands (owner's house rule: whole section = 限+1) ──
export const SPECIAL: Hand[] = [
  {
    id: "hidden", en: "Hidden treasure", zh: "四暗刻 / 坎坎胡", py: "sì-àn-kè", def: "限+1",
    demo: [{ t: ["1C", "1C", "1C"] }, { x: "×4" }, { lbl: "all concealed, 自摸" }, { t: ["9D", "9D"] }],
    note: "Four concealed triplets, completed by self-pick.",
  },
  {
    id: "ninegates", en: "Nine gates", zh: "九连宝灯", py: "jiǔ-lián-bǎo-dēng", def: "限+1",
    demo: [{ t: ["1D", "1D", "1D", "2D", "3D", "4D", "5D", "6D", "7D", "8D", "9D", "9D", "9D"] }],
    note: "1112345678999 of one suit, then win on any tile of that suit.",
  },
  {
    id: "pureterm", en: "Pure terminals", zh: "清么九 / 清老头", py: "qīng-yāo-jiǔ", def: "限+1",
    demo: [{ t: ["1C", "1C", "1C"] }, { t: ["9C", "9C", "9C"] }, { t: ["1D", "1D", "1D"] }, { t: ["9B", "9B"] }],
    note: "Only 1s and 9s, no honours.",
  },
  {
    id: "allhonours", en: "All honours", zh: "字一色", py: "zì-yī-sè", def: "限+1",
    demo: [{ t: ["EW", "EW", "EW"] }, { t: ["WW", "WW", "WW"] }, { t: ["RD", "RD", "RD"] }, { t: ["GD", "GD"] }],
    note: "Only winds and dragons.",
  },
  {
    id: "thirteen", en: "Thirteen wonders", zh: "十三幺", py: "shí-sān-yāo", def: "限+1",
    demo: [{ t: ["1C", "9C", "1D", "9D", "1B", "9B"] }, { t: ["EW", "SW", "WW", "NW"] }, { t: ["RD", "GD", "WD"] }, { lbl: "+ any duplicate" }],
    note: "One of each terminal & honour + a pair of any one of them. Pays DOUBLE the limit.",
  },
  {
    id: "greatscholars", en: "Three great scholars", zh: "大三元", py: "dà-sān-yuán", def: "限+1",
    demo: [{ t: ["RD", "RD", "RD"] }, { t: ["GD", "GD", "GD"] }, { t: ["WD", "WD", "WD"] }],
    note: "All three dragon triplets. Often 10 tai; SG rule scores 5 if only the 3 triplets are collected.",
  },
  {
    id: "greatblessings", en: "Four great blessings", zh: "大四喜", py: "dà-sì-xǐ", def: "限+1",
    demo: [{ t: ["EW", "EW", "EW"] }, { t: ["SW", "SW", "SW"] }, { t: ["WW", "WW", "WW"] }, { t: ["NW", "NW", "NW"] }],
    note: "All four wind triplets. SG rule variant scores 10.",
  },
  {
    id: "arhats", en: "Eighteen arhats (four kongs)", zh: "十八罗汉", py: "shí-bā-luó-hàn", def: "限+1",
    demo: [{ t: ["1C", "1C", "1C", "1C"] }, { x: "×4 kongs" }, { lbl: "+ eye" }],
    note: "Kong four times (18 tiles excluding flowers / animals).",
  },
  {
    id: "heavenly", en: "Heavenly hand", zh: "天胡", py: "tiān-hú", def: "限+1",
    demo: [{ lbl: "dealer wins on the opening deal" }],
    note: "The dealer completes the hand on the initial deal (after any replacements).",
  },
  {
    id: "earthly", en: "Earthly hand", zh: "地胡", py: "dì-hú", def: "限+1",
    demo: [{ lbl: "win on dealer's first discard" }],
    note: "A non-dealer wins on the dealer's very first discard / their own first draw.",
  },
  {
    id: "humanly", en: "Humanly hand", zh: "人胡", py: "rén-hú", def: "限+1",
    demo: [{ lbl: "win in the first go-around" }],
    note: "A non-dealer wins on a discard in the first go-around, before their first draw.",
  },
  {
    id: "eightflowers", en: "Two complete flower groups", zh: "花胡 / 八仙过海", py: "huā-hú", def: "限+1",
    demo: [{ t: ["F1", "F2", "F3", "F4", "S1", "S2", "S3", "S4"] }],
    note: "All 8 flowers + seasons: 八仙过海 (self-pick) or 七抢一 (rob the 8th).",
  },
  {
    id: "ff_pinghu", en: "Full-flush sequence hand", zh: "清一色平胡", py: "qīng-yī-sè píng-hú", def: "限+1",
    demo: [{ t: ["1D", "2D", "3D"] }, { x: "×4" }, { t: ["5D", "5D"] }, { lbl: "one suit" }],
    note: "Full flush that is also a sequence hand — usually 10 tai / limit. (With flowers/animals: Full-flush lesser sequence = 5.)",
  },
  {
    id: "ff_pengpeng", en: "Full-flush triplets hand", zh: "清一色碰碰胡", py: "qīng-yī-sè pèng-pèng-hú", def: "限+1",
    demo: [{ t: ["2B", "2B", "2B"] }, { x: "×4" }, { t: ["5B", "5B"] }, { lbl: "one suit" }],
    note: "Full flush + triplets hand — 8 tai (2 + 2 + 4), or the limit.",
  },
  {
    id: "ganggang", en: "Kong on kong", zh: "杠杠胡", py: "gàng-gàng-hú", def: "限+1",
    demo: [{ t: ["5B", "5B", "5B", "5B"] }, { lbl: "→ kong again → win" }],
    note: "Two kong-replacements in a row complete the win. Usually 10 tai / limit.",
  },
];

// ── Instant payments & self-pick (the 相公 pay-for-all scenario) ──────
export type Instant = { id: string; en: string; zh: string; py?: string; unit: "$" | "note"; def: string; note: string };
export const INSTANT: Instant[] = [
  {
    id: "zimo", en: "Self-pick", zh: "自摸", py: "zì-mō", unit: "note", def: "×2",
    note: "Winner draws the winning tile themselves → every player pays and the payout is doubled.",
  },
  {
    id: "yao", en: "Bitten (咬到)", zh: "咬到", py: "yǎo-dào", unit: "$", def: "2",
    note: "cat + rat, rooster + centipede, all 4 animals, or the matching seat-wind flower pair → instant one-time payout from everyone (doubled if before 补花 / at the very start).",
  },
  {
    id: "gang", en: "Kong payout", zh: "杠", py: "gàng", unit: "$", def: "2",
    note: "Exposed kong 明杠 → instant payout at the bitten rate; concealed kong 暗杠 → double.",
  },
];

// Every tai-scoring hand (not the $ instant payments), in display order.
export const TAI_HANDS: Hand[] = [...STANDARD, ...EVENTS, ...FLOWERS, ...SPECIAL];

export const ALL: Hand[] = [...STANDARD, ...EVENTS, ...FLOWERS, ...SPECIAL];
export const DEFAULTS: Record<string, string> = Object.fromEntries([
  ...ALL.map((h) => [h.id, h.def]),
  ...INSTANT.filter((i) => i.unit === "$").map((i) => [i.id, i.def]),
]);

// Tai values the per-group dropdown offers: 0–10, the limit, and one above it.
export const TAI_OPTIONS: { value: string; label: string }[] = [
  ...Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: String(i) })),
  { value: "限", label: "Max tai (限)" },
  { value: "限+1", label: "Special (限+1)" },
];

export const SEATS = [
  { k: "E", label: "East 东" },
  { k: "S", label: "South 南" },
  { k: "W", label: "West 西" },
  { k: "N", label: "North 北" },
];
