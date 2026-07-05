"use client";

import { RiichiScore } from "@/lib/riichi/scoring";
import { englishName } from "@/lib/riichi/yaku";

// "Riichi" -> "Riichi (Riichi declaration)". Names the analyzer adds that aren't
// yaku (Dora, Aka dora, Ura dora) have no English gloss and pass through as-is.
const withEn = (name: string) => { const en = englishName(name); return en ? `${name} (${en})` : name; };

export default function ResultCard({
  score,
  yaku,
  yakuman,
  error,
}: {
  score?: RiichiScore | null;
  yaku?: [string, number][];
  yakuman?: string[];
  error?: string;
}) {
  if (error) return <div className="result">{error}</div>;
  if (!score) return null;

  const seat = score.dealer ? "Dealer" : "Non-dealer";
  const win = score.tsumo ? "tsumo" : "ron";
  const fuNote = score.han > 0 && score.han < 5 ? ` ${score.fu} fu` : "";

  const yakuLines: string[] =
    yakuman && yakuman.length
      ? yakuman.map(withEn)
      : yaku && yaku.length
        ? yaku.map(([n, h]) => (h ? `${withEn(n)} — ${h} han` : withEn(n)))
        : [];

  return (
    <div className="result">
      {score.limit && <div className="limit">{score.limit}</div>}
      <div className="total">{score.total.toLocaleString()} pts</div>
      <div className="line">
        {seat} {win}
        {yakuman && yakuman.length ? "" : ` · ${score.han} han${fuNote}`}
      </div>
      {score.payments.map((p, i) => (
        <div className="line" key={i}>
          {p.role === "discarder" && `Discarder pays ${p.amount.toLocaleString()}`}
          {p.role === "dealer" && `Dealer pays ${p.amount.toLocaleString()}`}
          {p.role === "non-dealer" &&
            `${p.count} non-dealer${p.count > 1 ? "s" : ""} ${p.count > 1 ? "pay" : "pays"} ${p.amount.toLocaleString()}${p.count > 1 ? " each" : ""}`}
        </div>
      ))}
      {yakuLines.length > 0 && (
        <div className="yaku">
          {yakuLines.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  );
}
