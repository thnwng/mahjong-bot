// Pure logic for the record-action wizard (Singaporean tracker): the ordered
// questions per action, and the money each action settles to. Kept free of React
// and Telegram imports so it can be unit-tested (see actions.test.ts) — the money
// paths here are the ones that decide who owes whom, so they're covered directly.

import {
  Transfer,
  PayoutConfig,
  discardValue,
  zimoEachValue,
  maxTaiOf,
  zimoBonusOf,
  money,
  settleDiscardWin,
  settleSelfDraw,
  settleYao,
  settleGang,
} from "./payout";
import type { ActionMeta } from "./remote";

export type Action = "hu" | "zimo" | "gang" | "yao";

export type Opt = { v: string; label: string; hint?: string };
export type StepDef = {
  key: string;
  title: string;
  kind: "people" | "nums" | "choice" | "shoot";
  options: Opt[];
  crumb: (v: string) => string;
  // For a "shoot" step: the receiver is fixed to this seat (the winner/konger/
  // biter already chosen). When undefined (Hu), the receiver is picked too.
  fixedReceiver?: string;
};

// A "shoot" step packs both ends of the transfer into one pick value. The
// separator is U+0001, a control char that validated seat names can never
// contain (validDisplayName rejects code points < 0x20), so a name with a
// literal "|" or space can't corrupt the split.
const SHOOT_SEP = "\u0001";
export const shootValue = (payer: string, receiver: string): string => `${payer}${SHOOT_SEP}${receiver}`;
export const parseShoot = (v: string): { payer: string; receiver: string } => {
  const [payer, receiver] = (v || "").split(SHOOT_SEP);
  return { payer: payer || "", receiver: receiver || "" };
};

// The ordered questions for an action, given the answers so far. Later steps
// depend on earlier answers (the "who shot the kong" step only exists when the
// kong is off a discard), so this recomputes each render — going back re-derives
// everything consistently.
export function stepsFor(action: Action, picks: Record<string, string>, players: string[], bases: PayoutConfig, settle: boolean): StepDef[] {
  const people = (exclude?: string): Opt[] =>
    players.filter((p) => p !== exclude).map((p) => ({ v: p, label: p }));
  const taiOpts = (value: (n: number) => string): Opt[] =>
    Array.from({ length: maxTaiOf(bases) }, (_, i) => ({ v: String(i + 1), label: String(i + 1), hint: value(i + 1) }));

  const shootCrumb = (v: string) => { const { payer, receiver } = parseShoot(v); return `${payer} shoot ${receiver}`; };
  const nOther = players.length - 1; // how many others (3 in a 4-player game)

  if (action === "hu") {
    // Win off a discard: pick discarder -> winner in one "X shoot Y" step.
    return [
      { key: "shoot", title: "Who shot whom?", kind: "shoot", options: [], crumb: shootCrumb },
      // No-payout sessions just log the win — tai doesn't matter.
      ...(settle ? [{ key: "tai", title: "How many tai?", kind: "nums", options: taiOpts((n) => money(discardValue(bases, n))), crumb: (v: string) => `${v} tai` } as StepDef] : []),
    ];
  }
  if (action === "zimo") {
    return [
      { key: "winner", title: "Who self-drew?", kind: "people", options: people(), crumb: (v) => v },
      ...(settle ? [{ key: "tai", title: "How many tai?", kind: "nums", options: taiOpts((n) => `${money(zimoEachValue(bases, n) + zimoBonusOf(bases))} each`), crumb: (v: string) => `${v} tai` } as StepDef] : []),
    ];
  }
  if (action === "gang") {
    const g = bases.gang;
    const steps: StepDef[] = [
      { key: "konger", title: "Who konged?", kind: "people", options: people(), crumb: (v) => v },
      {
        key: "mode", title: "What kind of kong?", kind: "choice",
        options: [
          { v: "zimo", label: "Self-draw / added", hint: `everyone pays ${money(g)} each` },
          { v: "shoot", label: "Off a discard (shoot)", hint: `that one pays ${money(nOther * g)}` },
          { v: "an", label: "Concealed (angang)", hint: `everyone pays ${money(2 * g)} each` },
        ],
        crumb: (v) => (v === "an" ? "concealed" : v === "shoot" ? "shot" : "self-draw"),
      },
    ];
    // "Shoot" needs the one discarder who pays; the konger is the receiver.
    if (picks.mode === "shoot") {
      steps.push({ key: "shoot", title: "Who shot the kong?", kind: "shoot", options: [], crumb: shootCrumb, fixedReceiver: picks.konger });
    }
    return steps;
  }
  // yao (bite): open (yao) or concealed (anyao), then who pays.
  const y = bases.yao;
  const steps: StepDef[] = [
    { key: "biter", title: "Who bit?", kind: "people", options: people(), crumb: (v) => v },
    {
      key: "conceal", title: "Open or concealed?", kind: "choice",
      options: [
        { v: "open", label: "Bite (yao)", hint: `${money(y)} per pax` },
        { v: "an", label: "Concealed (anyao)", hint: `${money(2 * y)} per pax — double` },
      ],
      crumb: (v) => (v === "an" ? "concealed" : "open"),
    },
    {
      key: "scope", title: "Who pays?", kind: "choice",
      options: [
        { v: "everyone", label: "Everyone", hint: "each other player pays" },
        { v: "one", label: "One player", hint: "just one person pays" },
      ],
      crumb: (v) => (v === "everyone" ? "everyone pays" : "one pays"),
    },
  ];
  if (picks.scope === "one") {
    steps.push({ key: "shoot", title: "Who pays the bite?", kind: "shoot", options: [], crumb: shootCrumb, fixedReceiver: picks.biter });
  }
  return steps;
}

export function buildResult(
  action: Action,
  picks: Record<string, string>,
  players: string[],
  bases: PayoutConfig,
  settle: boolean,
): { summary: string; transfers: Transfer[]; meta: ActionMeta } {
  const nOther = players.length - 1;
  if (action === "hu") {
    const { payer: discarder, receiver: winner } = parseShoot(picks.shoot);
    const tai = settle ? parseInt(picks.tai) : 0;
    return {
      summary: `Hu: ${winner} wins off ${discarder}${tai ? ` (${tai} tai)` : ""}`,
      transfers: settle ? settleDiscardWin(winner, discarder, discardValue(bases, tai)) : [],
      meta: { k: "hu", tai, winner, discarder },
    };
  }
  if (action === "zimo") {
    const tai = settle ? parseInt(picks.tai) : 0;
    return {
      summary: `Zimo: ${picks.winner} self-draws${tai ? ` (${tai} tai)` : ""}`,
      transfers: settle ? settleSelfDraw(picks.winner, zimoEachValue(bases, tai) + zimoBonusOf(bases), players) : [],
      meta: { k: "zimo", tai, winner: picks.winner },
    };
  }
  if (action === "gang") {
    const konger = picks.konger;
    const mode = (picks.mode as "zimo" | "shoot" | "an") || "zimo";
    const g = bases.gang;
    if (mode === "shoot") {
      // Pao (responsibility): the single discarder covers the whole kong — i.e.
      // every other player's share — so they pay nOther x the base.
      const { payer } = parseShoot(picks.shoot);
      return {
        summary: `Gang: ${konger} kong off ${payer} (${money(nOther * g)})`,
        transfers: settleGang(konger, nOther * g, players, payer),
        meta: { k: "gang", konger, payer, mode },
      };
    }
    const each = mode === "an" ? 2 * g : g; // concealed pays double each
    return {
      summary: `Gang: ${konger} ${mode === "an" ? "concealed kong (angang)" : "self-kong"} — all pay ${money(each)}`,
      transfers: settleGang(konger, each, players, null),
      meta: { k: "gang", konger, payer: null, mode },
    };
  }
  // yao (bite): concealed (anyao) doubles the per-pax amount.
  const biter = picks.biter;
  const concealed = picks.conceal === "an";
  const perPax = concealed ? 2 * bases.yao : bases.yao;
  const target = picks.scope === "one" ? parseShoot(picks.shoot).payer : null;
  return {
    summary: `${concealed ? "Anyao" : "Yao"}: ${biter} ${concealed ? "concealed bite" : "bite"}${target ? ` on ${target}` : " (all pay)"}`,
    transfers: settleYao(biter, perPax, players, target),
    meta: { k: "yao", biter, target, concealed },
  };
}
