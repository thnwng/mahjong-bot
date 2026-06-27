"""Tile representation shared across mahjong variants.

Tile codes:
  Suited:  "<1-9><suit>"  suit in B (bamboo), C (character), D (dot)
  Winds:   "EW", "SW", "WW", "NW"
  Dragons: "RD" (red), "GD" (green), "WD" (white)
  Flowers: "F1".."F4"  (plum, orchid, chrysanthemum, bamboo; seat-matched F1=East..F4=North)
  Seasons: "S1".."S4"  (spring, summer, autumn, winter; seat-matched S1=East..S4=North)
  Animals: "AN1".."AN4" (cat, mouse, rooster, centipede - SG house rule bonus tiles)
"""
from __future__ import annotations

from dataclasses import dataclass

SUITS = ("B", "C", "D")
WINDS = ("EW", "SW", "WW", "NW")
DRAGONS = ("RD", "GD", "WD")
FLOWERS = ("F1", "F2", "F3", "F4")
SEASONS = ("S1", "S2", "S3", "S4")
ANIMALS = ("AN1", "AN2", "AN3", "AN4")

BONUS_TILES = FLOWERS + SEASONS + ANIMALS
HONOR_TILES = WINDS + DRAGONS


@dataclass(frozen=True)
class Tile:
    code: str

    @property
    def is_bonus(self) -> bool:
        return self.code in BONUS_TILES

    @property
    def is_honor(self) -> bool:
        return self.code in HONOR_TILES

    @property
    def is_suited(self) -> bool:
        return len(self.code) == 2 and self.code[1] in SUITS

    @property
    def suit(self) -> str | None:
        return self.code[1] if self.is_suited else None

    @property
    def rank(self) -> int | None:
        return int(self.code[0]) if self.is_suited else None

    def __repr__(self) -> str:
        return self.code


def parse_tiles(codes: list[str]) -> list[Tile]:
    return [Tile(c.upper()) for c in codes]


def split_bonus(tiles: list[Tile]) -> tuple[list[Tile], list[Tile]]:
    """Returns (playing_tiles, bonus_tiles)."""
    playing = [t for t in tiles if not t.is_bonus]
    bonus = [t for t in tiles if t.is_bonus]
    return playing, bonus
