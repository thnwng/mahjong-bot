"""Singaporean 4-player mahjong fan scoring.

Covers the common house-rule fan list used in most SG home games. Not yet
covered (left as a follow-up): kong-related fans (concealed/exposed kong
count, all kongs), nine gates, thirteen wonders / heavenly & earthly hands.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..decompose import TileSet, find_decompositions, is_seven_pairs
from ..tiles import DRAGONS, FLOWERS, SEASONS, WINDS, Tile, split_bonus

LIMIT_FAN = 10  # fan count at which a hand is capped ("limit hand")


@dataclass
class HandContext:
    seat_wind: str  # one of WINDS, e.g. "EW"
    round_wind: str  # one of WINDS
    self_drawn: bool = False


@dataclass
class ScoreResult:
    fan: int
    breakdown: dict[str, int] = field(default_factory=dict)
    is_chicken_hand: bool = False

    @property
    def capped_fan(self) -> int:
        return min(self.fan, LIMIT_FAN)


def _is_full_flush(sets: list[TileSet], pair: TileSet) -> bool:
    suits = set()
    for s in sets + [pair]:
        for t in s.tiles:
            if t.is_honor:
                return False
            suits.add(t.suit)
    return len(suits) == 1


def _is_half_flush(sets: list[TileSet], pair: TileSet) -> bool:
    suits = set()
    has_honor = False
    for s in sets + [pair]:
        for t in s.tiles:
            if t.is_honor:
                has_honor = True
            else:
                suits.add(t.suit)
    return has_honor and len(suits) == 1


def _all_groups(decomposition: list[TileSet]) -> tuple[list[TileSet], TileSet]:
    pair = next(s for s in decomposition if s.kind == "pair")
    sets = [s for s in decomposition if s.kind != "pair"]
    return sets, pair


def _score_decomposition(decomposition: list[TileSet], ctx: HandContext) -> dict[str, int]:
    sets, pair = _all_groups(decomposition)
    fan: dict[str, int] = {}

    pung_like = [s for s in sets if s.kind in ("pung", "kong")]

    if all(s.kind in ("pung", "kong") for s in sets):
        fan["All Triplets (Toitoi)"] = 3

    if _is_full_flush(sets, pair):
        fan["Full Flush"] = 6
    elif _is_half_flush(sets, pair):
        fan["Half Flush"] = 3

    dragon_pungs = [s for s in pung_like if s.tiles[0].code in DRAGONS]
    wind_pungs = [s for s in pung_like if s.tiles[0].code in WINDS]

    if len(dragon_pungs) == 3:
        fan["Big Three Dragons"] = 8
    elif len(dragon_pungs) == 2 and pair.tiles[0].code in DRAGONS:
        fan["Little Three Dragons"] = 5
    elif dragon_pungs:
        fan["Dragon Pung"] = len(dragon_pungs)

    if len(wind_pungs) == 4:
        fan["Big Four Winds"] = LIMIT_FAN
    elif len(wind_pungs) == 3 and pair.tiles[0].code in WINDS:
        fan["Little Four Winds"] = 6
    else:
        for s in wind_pungs:
            code = s.tiles[0].code
            if code == ctx.seat_wind:
                fan["Own Wind Pung"] = fan.get("Own Wind Pung", 0) + 1
            if code == ctx.round_wind:
                fan["Round Wind Pung"] = fan.get("Round Wind Pung", 0) + 1

    return fan


def score_hand(tiles: list[Tile], ctx: HandContext) -> ScoreResult:
    playing, bonus = split_bonus(tiles)

    bonus_fan: dict[str, int] = {}
    flower_count = sum(1 for t in bonus if t.code in FLOWERS)
    season_count = sum(1 for t in bonus if t.code in SEASONS)
    animal_count = sum(1 for t in bonus if t.code in ("AN1", "AN2", "AN3", "AN4"))
    if flower_count:
        bonus_fan["Flowers"] = flower_count
    if flower_count == 4:
        bonus_fan["All Flowers"] = 1
    if season_count:
        bonus_fan["Seasons"] = season_count
    if season_count == 4:
        bonus_fan["All Seasons"] = 1
    if animal_count:
        bonus_fan["Animals"] = animal_count
    if animal_count == 4:
        bonus_fan["All Animals"] = 1
    # Self-draw is not an extra fan here - it doubles the payout value instead
    # (see engine/sg/payout.py settle_self_draw), matching common SG house rules.

    if is_seven_pairs(playing):
        breakdown = {"All Pairs (Seven Pairs)": 6, **bonus_fan}
        return ScoreResult(fan=sum(breakdown.values()), breakdown=breakdown)

    decompositions = find_decompositions(playing)
    if not decompositions:
        raise ValueError("Tiles do not form a valid 14-tile mahjong hand")

    best: dict[str, int] | None = None
    best_total = -1
    for decomposition in decompositions:
        fan = _score_decomposition(decomposition, ctx)
        total = sum(fan.values())
        if total > best_total:
            best_total = total
            best = fan

    breakdown = {**(best or {}), **bonus_fan}
    total_fan = sum(breakdown.values())
    is_chicken = total_fan == 0
    return ScoreResult(fan=total_fan, breakdown=breakdown, is_chicken_hand=is_chicken)
