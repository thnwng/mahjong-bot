# Tile image assets

Cropped from Wikipedia *Mahjong tiles* › Regional design (full-res 2811×2109 photos).
Each filename = the engine tile code from [`engine/tiles.py`](../../../engine/tiles.py), with a
per-set prefix. Served over HTTPS by the GitHub Pages Mini App, e.g. `…/assets/tiles/sg/sg1D.png`.

- **sg/** — Singapore / Ningbo style (default set). Files prefixed `sg`.
- **jp/** — Japan style, peacock on the 1-bamboo. Files prefixed `jp`.

## Code convention (suffix after the set prefix)
| Group | Codes | Notes |
|-------|-------|-------|
| Dots | `1D`–`9D` | |
| Bamboo | `1B`–`9B` | `1B` = bird (sg) / peacock (jp) |
| Characters | `1C`–`9C` | |
| Winds | `EW SW WW NW` | East, South, West, North |
| Dragons | `RD GD WD` | red, green, white |
| Flowers | `F1`–`F4` | plum, orchid, chrysanthemum, bamboo (seat-matched E→N) |
| Seasons | `S1`–`S4` | spring, summer, autumn, winter (seat-matched E→N) |
| Blanks | `BLANK1`… | spare/blank tiles from the tray (not real tiles) |

## sg/  (all files prefixed `sg`)
45 tiles: `sg1D`–`sg9D`, `sg1B`–`sg9B`, `sg1C`–`sg9C`, `sgEW sgSW sgWW sgNW`,
`sgRD sgGD sgWD`, `sgS1`–`sgS4`, `sgF1`–`sgF4`, plus `sgBLANK1`–`sgBLANK3`.
Source photo: `sg_source_full.jpg`.

## jp/  (all files prefixed `jp`)
Same suits/winds + `jpGD jpRD`. Differences from the sg set:
- `jp1B` — peacock design on the one-bamboo (set's signature).
- Only seasons `jpS1`–`jpS4` (no separate flower tiles in this tray).
- Red-five tiles: `jpR5D jpR5B jpR5C`.
- `jpWD` — the white dragon, drawn with the central gem (the "dora white dragon" in the caption).
- Blanks `jpBLANK1`–`jpBLANK4`. Source photo: `jp_source_full.jpg`.
