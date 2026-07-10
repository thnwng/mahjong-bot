// Riichi GAME engine: a pure reducer over a hand-by-hand log -> live game state
// (per-seat points, whose deal it is, the round, honba counter, and the riichi
// stick pot). This is the score-tracking layer on TOP of the per-hand point
// math in scoring.ts. Money is intentionally NOT modelled here (a later,
// optional layer converts final standings via uma/oka); this is a pure
// point/score keeper.
//
// Every rule below is cited to docs/riichi-scoring-reference.md (§ numbers).
// Seats are fixed player indices 0..3 in the order seated at game start; the
// dealer (oya) marker rotates. All amounts are POINTS.

import { score } from "./scoring";

export type Seat = number; // 0..3 (or 0..2 for sanma, later)
export type Wind = "E" | "S" | "W" | "N";

export interface RiichiConfig {
  startPoints: number;                 // 25000 standard (§4.1)
  length: "tonpuusen" | "hanchan";     // East only vs East+South (§5.1)
  players: number;                     // 4 (yonma); sanma later
  renchan: "agari" | "tenpai" | "ryuukyoku"; // dealer-repeat rule (§3.3); tenpai = common
  kiriage: boolean;                    // rounded mangan (§1.7)
  tobi: boolean;                       // end the game if a score goes below 0 (§5.2)
}

export const DEFAULT_CONFIG: RiichiConfig = {
  startPoints: 25000,
  length: "hanchan",
  players: 4,
  renchan: "tenpai",
  kiriage: false,
  tobi: false,
};

// One recorded hand's INPUT. Dealer, honba and round are NOT stored on a hand —
// they are derived by replaying the log, so the log is the single source of
// truth (same philosophy as the SG balance engine). `riichi` = seats that
// declared riichi THIS hand (each pays 1000 into the pot).
export type Hand =
  | { kind: "ron"; winner: Seat; discarder: Seat; han: number; fu: number; yakuman?: number; riichi: Seat[] }
  | { kind: "tsumo"; winner: Seat; han: number; fu: number; yakuman?: number; riichi: Seat[] }
  | { kind: "draw"; tenpai: Seat[]; riichi: Seat[] }  // exhaustive draw (ryuukyoku)
  | { kind: "abort"; riichi: Seat[] }                 // abortive draw (tochuu ryuukyoku)
  | { kind: "chombo"; offender: Seat };               // foul / illegal win

export interface GameState {
  config: RiichiConfig;
  points: number[];    // per seat, current
  deal: number;        // completed deals so far = rotations; dealer = deal % players
  honba: number;       // bonus counters (§2.3)
  pot: number;         // riichi sticks on the table, in points (§2.1)
  finished: boolean;
}

const seats = (n: number): Seat[] => Array.from({ length: n }, (_, i) => i);
const maxDeals = (c: RiichiConfig) => (c.length === "hanchan" ? 2 : 1) * c.players;

/** The dealer (oya) seat for a given number of completed deals. */
export const dealerOf = (state: GameState): Seat => state.deal % state.config.players;

/** Round wind + kyoku number (1-based) for display, e.g. East 2. */
export function roundOf(state: GameState): { wind: Wind; kyoku: number } {
  const n = state.config.players;
  const roundIdx = Math.floor(state.deal / n); // 0 = East, 1 = South, ...
  const wind: Wind = roundIdx === 0 ? "E" : roundIdx === 1 ? "S" : roundIdx === 2 ? "W" : "N";
  return { wind, kyoku: (state.deal % n) + 1 };
}

/** A player's seat wind this hand (relative to the dealer): dealer = East. */
export function seatWind(state: GameState, seat: Seat): Wind {
  const n = state.config.players;
  const rel = ((seat - dealerOf(state)) % n + n) % n;
  return (["E", "S", "W", "N"] as Wind[])[rel];
}

export function newGame(config: Partial<RiichiConfig> = {}): GameState {
  const c: RiichiConfig = { ...DEFAULT_CONFIG, ...config };
  return { config: c, points: seats(c.players).map(() => c.startPoints), deal: 0, honba: 0, pot: 0, finished: false };
}

// Exhaustive-draw noten batsufu: a fixed 3000 pool from noten to tenpai (§3.1).
function tenpaiPayments(points: number[], tenpai: Seat[], all: Seat[]): void {
  const t = tenpai.length;
  if (t === 0 || t === all.length) return; // all or nobody tenpai -> no exchange
  const noten = all.filter((s) => !tenpai.includes(s));
  const each = 3000 / t;        // 3000 / 1500 / 1000 to each tenpai
  const pay = 3000 / noten.length; // 1000 / 1500 / 3000 from each noten
  for (const s of tenpai) points[s] += each;
  for (const s of noten) points[s] -= pay;
}

// Apply one hand to a state, returning the next state. Pure.
export function applyHand(state: GameState, hand: Hand): GameState {
  const c = state.config;
  const all = seats(c.players);
  const points = [...state.points];
  const dealer = dealerOf(state);
  let { honba, pot, deal } = state;
  let rotate = false;

  // Riichi deposits: each declarer pays 1000 into the pot (§2.1). Not on a
  // chombo (the hand is voided).
  if (hand.kind !== "chombo") {
    for (const d of hand.riichi || []) { points[d] -= 1000; pot += 1000; }
  }

  if (hand.kind === "ron" || hand.kind === "tsumo") {
    const dealerWin = hand.winner === dealer;
    const s = score(hand.han, hand.fu, {
      dealer: dealerWin, tsumo: hand.kind === "tsumo", players: c.players,
      honba, kiriage: c.kiriage, yakuman: hand.yakuman || 0,
    });
    if (hand.kind === "ron") {
      // Discarder alone pays the whole value incl. honba (§2.3).
      points[hand.discarder] -= s.total;
      points[hand.winner] += s.total;
    } else {
      // Tsumo: map scoring roles to actual seats (§1.2). Dealer-win = all pay
      // the same; non-dealer-win = dealer pays double, others single.
      const dealerAmt = s.payments.find((p) => p.role === "dealer")?.amount ?? 0;
      const nonAmt = s.payments.find((p) => p.role === "non-dealer")?.amount ?? 0;
      let received = 0;
      for (const seat of all) {
        if (seat === hand.winner) continue;
        const amt = dealerWin ? nonAmt : seat === dealer ? dealerAmt : nonAmt;
        points[seat] -= amt; received += amt;
      }
      points[hand.winner] += received;
    }
    // Winner sweeps the pot (§2.1).
    points[hand.winner] += pot; pot = 0;
    // Honba: +1 and repeat on a dealer win; reset + rotate on a non-dealer win (§2.3).
    if (dealerWin) honba += 1; else { honba = 0; rotate = true; }
  } else if (hand.kind === "draw") {
    tenpaiPayments(points, hand.tenpai || [], all);
    honba += 1;                                   // any draw increments honba (§2.3)
    const dealerTenpai = (hand.tenpai || []).includes(dealer);
    const keeps = c.renchan === "ryuukyoku" || (c.renchan === "tenpai" && dealerTenpai);
    rotate = !keeps;                              // renchan on dealer tenpai (§3.3)
    // pot carries to the next hand (§2.1, §3.1)
  } else if (hand.kind === "abort") {
    honba += 1;                                   // abortive draw: honba +1, no points, dealer keeps (§3.2)
  } else if (hand.kind === "chombo") {
    // Reverse mangan tsumo penalty; no rotation, honba unchanged, pot untouched (§3.4).
    if (hand.offender === dealer) {
      for (const s2 of all) if (s2 !== dealer) { points[s2] += 4000; points[dealer] -= 4000; }
    } else {
      for (const s2 of all) if (s2 !== hand.offender) {
        const amt = s2 === dealer ? 4000 : 2000;
        points[s2] += amt; points[hand.offender] -= amt;
      }
    }
  }

  if (rotate) deal += 1;
  const finished = deal >= maxDeals(c) || (c.tobi && points.some((p) => p < 0));
  return { config: c, points, deal, honba, pot, finished };
}

/** Replay a whole hand log into the final state (the single source of truth). */
export function reduce(config: RiichiConfig, hands: Hand[]): GameState {
  let state = newGame(config);
  for (const h of hands) {
    if (state.finished) break; // ignore hands past the end
    state = applyHand(state, h);
  }
  return state;
}

export interface Placement { seat: Seat; points: number; place: number }

/** Final standings, best first. Ties broken by seat order (earlier = higher),
 *  the common parlor convention (§4.4); money/uma is a later layer. */
export function placements(state: GameState): Placement[] {
  const ranked = state.points
    .map((points, seat) => ({ seat, points }))
    .sort((a, b) => b.points - a.points || a.seat - b.seat);
  return ranked.map((r, i) => ({ ...r, place: i + 1 }));
}
