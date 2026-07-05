// Riichi yaku reference data (ported from engine/riichi/yaku.py).
// Used by the manual "yaku checklist" mode to sum han.

export interface Yaku {
  key: string;
  name: string;
  en: string;
  closedHan: number;
  openHan: number | null; // null => closed-only
}

export const YAKU: Yaku[] = [
  // 1 han
  { key: "riichi", name: "Riichi", en: "Riichi declaration", closedHan: 1, openHan: null },
  { key: "ippatsu", name: "Ippatsu", en: "One-shot", closedHan: 1, openHan: null },
  { key: "menzen_tsumo", name: "Menzen Tsumo", en: "Closed self-draw", closedHan: 1, openHan: null },
  { key: "pinfu", name: "Pinfu", en: "All-sequences no-fu hand", closedHan: 1, openHan: null },
  { key: "iipeikou", name: "Iipeikou", en: "One set of identical sequences", closedHan: 1, openHan: null },
  { key: "tanyao", name: "Tanyao", en: "All simples", closedHan: 1, openHan: 1 },
  { key: "yakuhai", name: "Yakuhai", en: "Dragon / seat / round wind triplet (each)", closedHan: 1, openHan: 1 },
  { key: "haitei", name: "Haitei", en: "Win on the last tile (tsumo)", closedHan: 1, openHan: 1 },
  { key: "houtei", name: "Houtei", en: "Win on the last discard (ron)", closedHan: 1, openHan: 1 },
  { key: "rinshan", name: "Rinshan Kaihou", en: "Win on the dead-wall replacement", closedHan: 1, openHan: 1 },
  { key: "chankan", name: "Chankan", en: "Robbing a kan", closedHan: 1, openHan: 1 },
  // 2 han
  { key: "double_riichi", name: "Double Riichi", en: "Riichi on the first discard", closedHan: 2, openHan: null },
  { key: "chiitoitsu", name: "Chiitoitsu", en: "Seven pairs", closedHan: 2, openHan: null },
  { key: "sanshoku", name: "Sanshoku Doujun", en: "Three-colour straight", closedHan: 2, openHan: 1 },
  { key: "ittsuu", name: "Ittsuu", en: "Pure straight 1-9", closedHan: 2, openHan: 1 },
  { key: "chanta", name: "Chanta", en: "Terminal/honor in every set", closedHan: 2, openHan: 1 },
  { key: "toitoi", name: "Toitoi", en: "All triplets", closedHan: 2, openHan: 2 },
  { key: "sanankou", name: "San Ankou", en: "Three concealed triplets", closedHan: 2, openHan: 2 },
  { key: "sanshoku_doukou", name: "Sanshoku Doukou", en: "Three-colour triplets", closedHan: 2, openHan: 2 },
  { key: "sankantsu", name: "San Kantsu", en: "Three quads", closedHan: 2, openHan: 2 },
  { key: "honroutou", name: "Honroutou", en: "All terminals and honors", closedHan: 2, openHan: 2 },
  { key: "shousangen", name: "Shousangen", en: "Little three dragons", closedHan: 2, openHan: 2 },
  // 3 han
  { key: "honitsu", name: "Honitsu", en: "Half flush", closedHan: 3, openHan: 2 },
  { key: "junchan", name: "Junchan", en: "Terminal in every set (no honors)", closedHan: 3, openHan: 2 },
  { key: "ryanpeikou", name: "Ryanpeikou", en: "Two sets of identical sequences", closedHan: 3, openHan: null },
  // 6 han
  { key: "chinitsu", name: "Chinitsu", en: "Full flush", closedHan: 6, openHan: 5 },
];

export const YAKU_BY_KEY: Record<string, Yaku> = Object.fromEntries(YAKU.map((y) => [y.key, y]));

export interface Yakuman {
  key: string;
  name: string;
  en: string;
  multiplier: number;
}

export const YAKUMAN: Yakuman[] = [
  { key: "kokushi", name: "Kokushi Musou", en: "Thirteen orphans", multiplier: 1 },
  { key: "kokushi_13", name: "Kokushi 13-men", en: "Thirteen orphans, 13-wait", multiplier: 2 },
  { key: "suuankou", name: "Suu Ankou", en: "Four concealed triplets", multiplier: 1 },
  { key: "suuankou_tanki", name: "Suu Ankou Tanki", en: "Four concealed triplets, pair wait", multiplier: 2 },
  { key: "daisangen", name: "Daisangen", en: "Big three dragons", multiplier: 1 },
  { key: "shousuushii", name: "Shousuushii", en: "Little four winds", multiplier: 1 },
  { key: "daisuushii", name: "Daisuushii", en: "Big four winds", multiplier: 2 },
  { key: "tsuuiisou", name: "Tsuuiisou", en: "All honors", multiplier: 1 },
  { key: "chinroutou", name: "Chinroutou", en: "All terminals", multiplier: 1 },
  { key: "ryuuiisou", name: "Ryuuiisou", en: "All green", multiplier: 1 },
  { key: "suukantsu", name: "Suu Kantsu", en: "Four quads", multiplier: 1 },
  { key: "chuuren", name: "Chuuren Poutou", en: "Nine gates", multiplier: 1 },
  { key: "chuuren_pure", name: "Junsei Chuuren", en: "Pure nine gates", multiplier: 2 },
  { key: "tenhou", name: "Tenhou", en: "Blessing of heaven (dealer)", multiplier: 1 },
  { key: "chiihou", name: "Chiihou", en: "Blessing of earth (non-dealer)", multiplier: 1 },
];

export const YAKUMAN_BY_KEY: Record<string, Yakuman> = Object.fromEntries(YAKUMAN.map((y) => [y.key, y]));

/** Common English name for a romaji yaku name (what the analyzer emits in its
 *  yaku list), so the result card can show "Riichi (Riichi declaration)". Keyed
 *  by a normalized form (lowercase, no spaces) because the analyzer and the
 *  table sometimes differ in spacing/case (e.g. "Suukantsu" vs "Suu Kantsu"). */
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const EN_TABLE: Record<string, string> = Object.fromEntries(
  [...YAKU, ...YAKUMAN].map((y) => [normName(y.name), y.en]),
);
export const englishName = (name: string): string | undefined => EN_TABLE[normName(name)];

/** Sum han for the chosen yaku at the right open/closed value, plus dora. */
export function totalHan(keys: string[], closed: boolean, dora = 0): number {
  let han = 0;
  for (const key of keys) {
    const y = YAKU_BY_KEY[key];
    if (!y) continue;
    if (closed) han += y.closedHan;
    else {
      if (y.openHan === null) throw new Error(`${y.name} is closed-only`);
      han += y.openHan;
    }
  }
  return han + dora;
}

export const totalYakuman = (keys: string[]): number =>
  keys.reduce((s, k) => s + (YAKUMAN_BY_KEY[k]?.multiplier ?? 0), 0);
