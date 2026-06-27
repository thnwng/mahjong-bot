"""Fan-to-value table and payout settlement for SG 4-player mahjong.

Value table reference: doubling per fan, self-draw paid at 2x the discard
rate by each of the other three players (per common SG house-rule apps,
e.g. sgmahjong.club's payout table).
"""
from __future__ import annotations

from dataclasses import dataclass

from .scoring import LIMIT_FAN

SELF_DRAW_MULTIPLIER = 2


def fan_to_value(fan: int, base_unit: float) -> float:
    """Value doubles per fan, starting at 1x base for a chicken hand (fan 0 or 1)."""
    effective_fan = max(fan, 1)
    capped_fan = min(effective_fan, LIMIT_FAN)
    return base_unit * (2 ** (capped_fan - 1))


@dataclass
class Transfer:
    payer: str
    payee: str
    amount: float


def settle_discard_win(winner: str, discarder: str, value: float) -> list[Transfer]:
    """Discarder pays the full value; everyone else pays nothing."""
    return [Transfer(payer=discarder, payee=winner, amount=value)]


def settle_self_draw(winner: str, value: float, players: list[str]) -> list[Transfer]:
    """Self-draw: every other player pays the winner at 2x the discard rate."""
    others = [p for p in players if p != winner]
    amount = value * SELF_DRAW_MULTIPLIER
    return [Transfer(payer=p, payee=winner, amount=amount) for p in others]


def _split_equally(payee: str, total: float, payers: list[str]) -> list[Transfer]:
    """Spread `total` evenly across `payers` (each pays total / len(payers))."""
    share = total / len(payers)
    return [Transfer(payer=p, payee=payee, amount=share) for p in payers]


# --- Yao (bite: flower / animal) ----------------------------------------
# Side-payment: moves chips between pots, total unchanged. Base unit = x.
#   an yao  = 2x   hou yao = x
# Either everyone splits the total equally, or one named person pays it all.
YAO_MULTIPLIER = {"an": 2, "hou": 1}


def settle_yao(
    biter: str,
    yao_type: str,
    x: float,
    players: list[str],
    target: str | None = None,
) -> list[Transfer]:
    """Bite payment to `biter`.

    yao_type: "an" (=2x) or "hou" (=x).
    target:   if given, that one player pays the whole amount; otherwise the
              three other players split it equally.
    """
    total = YAO_MULTIPLIER[yao_type] * x
    if target is not None:
        return [Transfer(payer=target, payee=biter, amount=total)]
    others = [p for p in players if p != biter]
    return _split_equally(biter, total, others)


# --- Gang (kong) --------------------------------------------------------
# Side-payment, total unchanged. Base unit = y.
#   an gang (concealed)      = 2y, split 3 ways
#   shoot gang (off discard) = y, shooter pays alone OR split 3 ways
#   gang after peng (added)  = y, split 3 ways
GANG_MULTIPLIER = {"an": 2, "shoot": 1, "peng": 1}


def settle_gang(
    konger: str,
    gang_type: str,
    y: float,
    players: list[str],
    shooter: str | None = None,
) -> list[Transfer]:
    """Kong payment to `konger`.

    gang_type: "an" (concealed, =2y), "shoot" (off a discard, =y), or
               "peng" (added kong after a pung, =y).
    shooter:   only meaningful for "shoot" gang. If given, the discarder pays
               the whole y alone; otherwise the three others split it equally.
    """
    total = GANG_MULTIPLIER[gang_type] * y
    if gang_type == "shoot" and shooter is not None:
        return [Transfer(payer=shooter, payee=konger, amount=total)]
    others = [p for p in players if p != konger]
    return _split_equally(konger, total, others)


def net_balances(transfers: list[Transfer], players: list[str]) -> dict[str, float]:
    balances = {p: 0.0 for p in players}
    for t in transfers:
        balances[t.payer] -= t.amount
        balances[t.payee] += t.amount
    return balances
