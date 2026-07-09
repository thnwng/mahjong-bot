<!-- Generated 2026-07-08 from a multi-agent research + adversarial-verification pass.
Reference for the Riichi tracker build. Values flagged CONFIRMED / RULESET-DEPENDENT / UNCERTAIN. -->

# Riichi (Japanese / Reach) Mahjong — Authoritative Payout & Money-Settlement Reference

*Engineering reference for a money-tracking application. Every load-bearing number is cited. Values are flagged as CONFIRMED (multi-source agreement), RULESET-DEPENDENT (must be a configurable setting), or UNCERTAIN (not primary-source-verified — do not hard-code).*

## Source legend (all citations reference these URLs)

- **[W]** https://en.wikipedia.org/wiki/Japanese_mahjong_scoring_rules
- **[MJDF]** https://majandofu.com/en-mahjong-scoring-table
- **[RW-score]** https://riichi.wiki/Japanese_mahjong_scoring_rules
- **[RW-oka]** https://riichi.wiki/Oka_and_uma
- **[RW-var]** https://riichi.wiki/Scoring_variations
- **[RW-ryu]** https://riichi.wiki/Ryuukyoku
- **[RW-toch]** https://riichi.wiki/Tochuu_ryuukyoku
- **[RW-ren]** https://riichi.wiki/Renchan
- **[RW-chombo]** https://riichi.wiki/Chombo
- **[RW-nag]** https://riichi.wiki/Nagashi_mangan
- **[RW-yak]** https://riichi.wiki/Yakitori
- **[RW-WRC]** https://riichi.wiki/World_Riichi_Championship_rules
- **[RW-EMA]** https://riichi.wiki/EMA_Riichi_Competition_Rules
- **[WRC-PDF]** https://static1.squarespace.com/static/634a7884c297a25f06589b79/t/6834d67360e19c1da6c0d12c/1748293243651/WRC+Rules+2025.pdf
- **[BGA]** https://en.doc.boardgamearena.com/Gamehelpriichimahjong
- **[PET-std]** https://peterish.com/riichi-docs/standard-ruleset/
- **[PET-shu]** https://peterish.com/riichi-docs/shuugi-house-rules/
- **[OSA]** https://osamuko.com/overview-of-mahjong-parlors-and-why-you-cant-really-win/
- **[MASS]** https://massriichi.org/2025/08/27/how-does-a-riichi-tournament-work/
- **[TOR]** https://www.torontoriichi.club/rules/
- **[RMN]** https://riichimahjong.net/rules/
- **[SG-chombo]** https://sgriichimahjong.com/2014/01/21/handling-of-chombo-situations/
- **[SG-nag]** https://sgriichimahjong.com/2017/08/11/about-nagashi-mangan/
- **[SG-rules]** https://sgriichimahjong.com/rules/
- **[SG-rleague]** https://sgriichimahjong.com/2024/04/08/r-league-24-25-ruleset-and-penalties/
- **[OOYA]** https://ooyamaneko.net/en/mahjong/rratw/index.php
- **[RR]** https://riichireporter.com/parlor-abroad/
- **[SAKI]** https://saki.fandom.com/wiki/Riichi_mahjong

---

## 1. Per-hand scoring: han/fu → base → payments

### 1.1 Base points (the single primitive everything derives from)

```
base = fu × 2^(2 + han)
```

Worked check: 40 fu, 2 han → 40 × 2^4 = 640 base. CONFIRMED [W][MJDF].

**Mangan cap:** once `base > 2000`, clamp `base = 2000`. CONFIRMED [W]. Equivalently, replace `base` with a fixed limit value once the hand reaches a limit tier (§1.5).

### 1.2 Payment multipliers on the base

| Win type | Formula (each payment rounded separately) |
|---|---|
| Non-dealer ron | discarder pays `base × 4` |
| Dealer ron | discarder pays `base × 6` |
| Non-dealer tsumo | each non-dealer pays `base × 1`; dealer pays `base × 2` (total `base × 4`) |
| Dealer tsumo | each of the three opponents pays `base × 2` (total `base × 6`) |

CONFIRMED [W]. Dealer-tsumo is a single "X all" figure (all three pay equal) [W][MJDF].

### 1.3 Rounding (critical — round each payment independently)

Every individual payment is **rounded UP to the nearest 100** [W]: `roundUp100(x) = ceil(x/100)*100`.

Worked check (non-dealer, 40 fu 3 han, base 1280): ron 5120 → **5200**; tsumo each non-dealer 1280 → **1300**, dealer 2560 → **2600**. Each payer rounds separately [W].

### 1.4 Core algorithm (engineer-ready)

```
function payments(han, fu, isDealer, isTsumo, kiriageMangan=false):
    base = limitBase(han, fu, kiriageMangan)   // see §1.5; else fu*2^(2+han) capped at 2000
    if isTsumo:
        if isDealer:
            each = roundUp100(base * 2)         // "each all"
            return { fromEachOpponent: each, total: 3*each }
        else:
            ko  = roundUp100(base * 1)          // from each non-dealer
            oya = roundUp100(base * 2)           // from dealer
            return { fromEachNonDealer: ko, fromDealer: oya, total: 2*ko + oya }
    else: // ron
        total = roundUp100(base * (isDealer ? 6 : 4))
        return { fromDiscarder: total, total: total }
```

### 1.5 Limit tiers (replace `base`)

Triggered by high han/fu. **Mangan** occurs at 5 han; or 4 han with fu ≥ 40 (40×2^6 = 2560 > 2000); or 3 han with fu ≥ 70 (70×2^5 = 2240 > 2000) [W][MJDF]. Note **4 han 30 fu = 1920** and **3 han 60 fu = 1920** fall *below* 2000, so by default they score 7700/11600, **NOT** mangan [W][MJDF] (see kiriage mangan, §1.7).

| Tier | Han | base | Non-dealer ron | Dealer ron | Non-dealer tsumo (each / dealer) | Dealer tsumo (all) |
|---|---|---|---|---|---|---|
| Mangan | 5 (or 4≥40fu / 3≥70fu) | 2000 | 8000 | 12000 | 2000 / 4000 | 4000 |
| Haneman | 6–7 | 3000 | 12000 | 18000 | 3000 / 6000 | 6000 |
| Baiman | 8–10 | 4000 | 16000 | 24000 | 4000 / 8000 | 8000 |
| Sanbaiman | 11–12 | 6000 | 24000 | 36000 | 6000 / 12000 | 12000 |
| Yakuman / Kazoe-yakuman | 13+ (kazoe) or true yakuman | 8000 | 32000 | 48000 | 8000 / 16000 | 16000 |

CONFIRMED [W][MJDF]. (Kazoe-yakuman = 13+ counted han; pays same as true yakuman under most rulesets [W]. Whether kazoe is allowed at all is itself a ruleset toggle.)

### 1.6 Full standard han/fu tables (below limit)

Notation for tsumo: **non-dealer = "each-non-dealer / dealer"**; **dealer = "each (all)"**.

**Non-dealer (ko):**

| Fu | 1 han | 2 han | 3 han | 4 han |
|---|---|---|---|---|
| 20 (tsumo only) | — | 400/700 | 700/1300 | 1300/2600 |
| 25 (chiitoitsu) | — | ron 1600 | ron 3200 (t 800/1600) | ron 6400 (t 1600/3200) |
| 30 | 1000 (300/500) | 2000 (500/1000) | 3900 (1000/2000) | 7700 (2000/3900) |
| 40 | 1300 (400/700) | 2600 (700/1300) | 5200 (1300/2600) | **Mangan** 8000 (2000/4000) |
| 50 | 1600 (400/800) | 3200 (800/1600) | 6400 (1600/3200) | Mangan |
| 60 | 2000 (500/1000) | 3900 (1000/2000) | 7700 (2000/3900) | Mangan |
| 70 | 2300 (600/1200) | 4500 (1200/2300) | Mangan | Mangan |

**Dealer (oya):**

| Fu | 1 han | 2 han | 3 han | 4 han |
|---|---|---|---|---|
| 20 (tsumo only) | — | 700 all | 1300 all | 2600 all |
| 25 (chiitoitsu) | — | ron 2400 | ron 4800 (t 1600) | ron 9600 (t 3200) |
| 30 | 1500 (500) | 2900 (1000) | 5800 (2000) | 11600 (3900) |
| 40 | 2000 (700) | 3900 (1300) | 7700 (2600) | **Mangan** 12000 (4000) |
| 50 | 2400 (800) | 4800 (1600) | 9600 (3200) | Mangan |
| 60 | 2900 (1000) | 5800 (2000) | 11600 (3900) | Mangan |
| 70 | 3400 (1200) | 6800 (2300) | Mangan | Mangan |

All cells CONFIRMED against [MJDF] and recomputed from the base formula [W]. (20 fu arises only on pinfu tsumo; 25 fu only on chiitoitsu.)

### 1.7 Kiriage mangan (rounded mangan) — RULESET-DEPENDENT toggle

Rounds exactly the two just-below-mangan hands — **4 han 30 fu** and **3 han 60 fu** (both base 1920, normally 7700/11600) — up to full mangan: 8000/12000, tsumo non-dealer 2000/4000, dealer 4000 all. Default **ON** on Tenhou; **OFF** ("nashi") on most other clients [RW-var]. Implement as a boolean setting.

---

## 2. In-hand extras: riichi sticks & honba

These are added **on top of** the hand value in §1, and are what an engineer most often gets wrong.

### 2.1 Riichi sticks (reach deposits)

- Declaring riichi places a **1,000-point** bet (one tenbou stick) on the table. CONFIRMED [WRC-PDF §8.9][W][BGA][TOR].
- The **next player to win collects ALL sticks** currently on the table, added on top of hand value + honba. Sticks **accumulate across draws** until swept. CONFIRMED [WRC-PDF §9.2, §11.2][BGA][RMN].
- **Shared ron (where multiple ron is allowed):** sticks go to the winner **nearest the discarder in turn order** (head-bump / atamahane) [BGA]. Many tournament rulesets (incl. WRC) use head-bump to disallow multiple ron entirely, so there is only one winner.

### 2.2 Riichi sticks left on the table at game end — RULESET-DEPENDENT (do not assume)

- **Tournament default = FORFEITED.** WRC 2025 §10.2: leftover deposits "stay on the table. Nobody collects them." Toronto: "Any riichi bets left after the final hand are lost." CONFIRMED [WRC-PDF][TOR].
- **Variation:** awarded to the **1st-place** player (placement tie broken by seat-wind order). This is a documented house variation, **not** the tournament default [RW-var].
- **"Returned to depositor"** — plausible casual rule but **UNCERTAIN** (not primary-source-confirmed). Do not hard-code; expose as a setting.

### 2.3 Honba (bonus / continuance counters) — flat 300 per counter

Each honba adds exactly **300 points total** to the win, flat, independent of fu/han. CONFIRMED [W][BGA][RMN][WRC-PDF §11.2]. `n` = honba count:

- **Ron:** the **discarder alone** pays `n × 300` extra [W][WRC-PDF §11.2].
- **Tsumo:** each of the three others pays `n × 100` (total `n × 300`) [W][WRC-PDF §11.2].

Worked example: base-1000 ron with 3 honba + 1 riichi stick on the table = 1000 + 900 (honba) + 1000 (stick) = **2900** [W].

**Counter state machine** (CONFIRMED [W][WRC-PDF §9.4][BGA][TOR]):
- `+1` on a **dealer win**, OR **any draw** (exhaustive or abortive), OR dealer renchan.
- **Reset to 0** when a **non-dealer wins**.

---

## 3. Draws & penalties

### 3.1 Exhaustive draw (ryuukyoku) — noten batsufu

Fixed **3,000-point pool** from noten players to tenpai players, always totalling 3,000. CONFIRMED [W][BGA][RW-ryu].

| Tenpai count | Each tenpai receives | Each noten pays |
|---|---|---|
| 1 | +3,000 | −1,000 (×3 noten) |
| 2 | +1,500 | −1,500 (×2 noten) |
| 3 | +1,000 | −3,000 (×1 noten) |
| 0 or 4 | no exchange | no exchange |

On the draw: **honba +1**, riichi sticks **carry to the next hand**, and the dealer keeps the deal if tenpai under tenpai renchan (§3.3) [RW-ryu].

### 3.2 Abortive draws (tochuu ryuukyoku) — NO points move

No points exchanged; **honba +1** (mainstream default — a few rulesets skip this); riichi sticks stay; **dealer keeps the deal**; seats do not rotate. CONFIRMED [RW-toch][BGA]. Triggers (all CONFIRMED [RW-toch]):
- **Kyuushu kyuuhai:** a player holds **9+ distinct** terminal/honor types after their first draw, on an uninterrupted first go-around (optional declaration).
- **Suufon renda:** all four players' first discards are the identical wind, no calls.
- **Suucha riichi:** all four have declared riichi; aborts once the fourth riichi's discard passes unclaimed; sticks stay.
- **Suukaikan:** four kans by **2+ different** players aborts; four kans by a **single** player does **not** (may pursue suukantsu).
- **Sanchahou (triple ron):** under rulesets that use it, three ron on one discard aborts. (Others resolve via head-bump or multi-ron — RULESET-DEPENDENT.)

### 3.3 Dealer repeat (renchan) variants — RULESET-DEPENDENT

CONFIRMED [RW-ren][W]. A dealer **win always repeats**; the draw behaviour differs:
- **Agari renchan:** dealer keeps deal on **dealer win only**.
- **Tenpai renchan** (most common): dealer win **or** dealer tenpai at exhaustive draw.
- **Ryuukyoku renchan:** dealer win **or any** exhaustive draw.

### 3.4 Chombo (foul / illegal win)

Standard casual/parlor default: a **mangan-sized reverse-tsumo** paid by the offender. CONFIRMED [W][RW-chombo]:
- **Non-dealer offender:** pays **4,000 to the dealer + 2,000 to each other two** = net **−8,000** (mirrors a non-dealer mangan tsumo 2000/2000/4000).
- **Dealer offender:** pays **4,000 to each of the three** = net **−12,000** (mirrors a dealer mangan tsumo 4000-all).

After chombo: **no-count redeal** — dealer does **not** rotate, honba does **not** increase, riichi sticks are **returned** to depositors. CONFIRMED [SG-chombo][RW-chombo].

**Tournament variation:** many association rulesets (EMA/WRC-family) replace the table payment with a **fixed score penalty** instead — treat as a per-event setting, not a fixed number. CONFIRMED-qualitative [RW-chombo][SG-chombo]. (Concrete example: SgRiichi R.League uses a 30-point tournament-standing deduction, hanchan scores unchanged — see §5.)

### 3.5 Nagashi mangan

Pays as a **self-drawn mangan**: non-dealer receives 2000/2000/4000 = **8,000** (4,000 from dealer, 2,000 from each other); dealer receives 4,000 from each = **12,000**. CONFIRMED [RW-nag][W][SG-nag].
- **Standard treatment:** it **replaces** the tenpai/noten exchange for that draw; no extra honba/riichi paid [SG-nag].
- **Variation:** some rulesets apply the noten exchange **on top** [RW-nag]. RULESET-DEPENDENT — make it an explicit setting.
- Dealer-repeat is decided by the dealer's own tenpai status under tenpai renchan, except where a ruleset treats nagashi as a "win" (then it forces renchan).

---

## 4. END-OF-GAME MONEY SETTLEMENT (most important)

### 4.1 Definitions

- **Start points** — each player's starting stack. Commonly **25,000**. CONFIRMED [W][PET-std][RW-oka].
- **Return / target (kaeshi / genten)** — the score you must reach to "get your points back". Commonly **30,000** [PET-std][RW-oka].
- **Oka** — bonus paid **entirely to 1st place**, equal to `(return − start) × 4`. For 25k/30k → **20,000 points = +20 units** to 1st. CONFIRMED [RW-oka][PET-std][MASS]. If a ruleset uses **no oka**, set start = return (e.g. WRC/EMA 30k/30k) and the four `(raw − return)` figures already sum to zero.
- **Uma** — fixed placement bonus/penalty (§4.3), zero-sum.
- **Unit** — 1,000 points. End scores are expressed in units.

### 4.2 Settlement pipeline (CONFIRMED verbatim [W][RW-oka])

```
EndScore_units[player] = (raw[player] − return)/1000 + uma[place]
EndScore_units[firstPlace] += oka/1000          // full oka pool added to 1st only
```

Both oka and uma are zero-sum, so the four End scores **sum to 0**. Verify this invariant in code:
`sum(raw) = 4·start`; `sum(raw − return) = 4·start − 4·return = −oka`; `+oka` to 1st cancels it; `sum(uma) = 0`.

**Point → money:** multiply End score (in units) by the rate:

| Rate name | Yen per 1,000 pts (per unit) | Source |
|---|---|---|
| tenpin (1.0) | ¥100 | [OSA][RR] |
| tengo (0.5) | ¥50 | [OSA][RR] |
| tensan (0.3) | ~¥30 (osamuko: ≈1/3 of tenpin ≈ ¥33; ¥30 is common rounding) | [OSA] |
| tenni (0.2) | ¥20 | [RR] |

Parlors additionally levy a **table fee (ba-dai)** ~¥300–600/player, sometimes with 1st paying extra (e.g. ¥1,550), applied **outside** the zero-sum table [OSA][RR].

### 4.3 Uma variants (exact +/− per place, 1st/2nd/3rd/4th)

| Variant | 1st | 2nd | 3rd | 4th | Notes / source |
|---|---|---|---|---|---|
| 5-10 (gotto) | +10 | +5 | −5 | −10 | [OSA][RW-oka] |
| 10-20 | +20 | +10 | −10 | −20 | Tenhou in-game rank bonus [RW-oka] |
| 10-30 | +30 | +10 | −10 | −30 | "standard" spread; Mahjong Soul-family [MASS][RW-oka] |
| 20-30 | +30 | +20 | −20 | −30 | steeper variant [RW-oka] |
| 5-15 (WRC/EMA) | +15 | +5 | −5 | −15 | competition: **oka OFF**, start = return = 30,000 [RW-WRC][RW-EMA][WRC-PDF] |

General form is `+A/+B/−B/−A`. Online clients (Tenhou, Mahjong Soul) layer **separate ladder/rank promotion points** on top of uma — those are a distinct layer, **not** settlement uma, and must not be conflated with money [RW-oka].

### 4.4 Tie-breaking — RULESET-DEPENDENT (money-critical)

- **Parlor / many online:** equal scores ranked by **starting seat wind**, East > South > West > North (closest to the initial dealer ranks higher). CONFIRMED [SAKI].
- **Competition (WRC / EMA):** uma is **averaged/shared** among tied players; ties are explicitly **NOT** resolved by seat order. E.g. two tied for 1st under 10-20 each get `(20+10)/2 = +15`. CONFIRMED [RW-WRC][RW-EMA]. Peterish's "standard" ruleset also splits uma on ties [PET-std].

Fix the tie convention in advance; it changes real money.

### 4.5 Rounding of non-1000 raw scores — RULESET-DEPENDENT

Common convention: **go-sha-roku-nyuu (五捨六入)** — 500-and-below rounds **down**, 600-and-up rounds **up** — with the residual assigned to 1st place so the four End scores still sum to zero. The distinguishing "500 rounds down" behaviour and the residual-to-winner rule are corroborated, **but no single authoritative English source names this as universal**, and competition PDFs specify their own. UNCERTAIN as a default — expose as a setting [RW-score][W]. (In practice, with 100-point riichi/honba granularity, raw scores are usually already multiples of 100, and the /1000 step is where rounding bites.)

### 4.6 FULL worked example (four final scores → money, summing to zero)

Config: **25k start, 30k return, oka +20, uma 10-20, tenpin ¥100**. Final raw scores: **A 42,000 · B 31,000 · C 18,000 · D 9,000** (sum 100,000). Independently recomputed and CONFIRMED [RW-oka][W][MASS].

| Step | A (1st) | B (2nd) | C (3rd) | D (4th) | Row sum |
|---|---|---|---|---|---|
| 1. `(raw − 30,000)/1000` | +12 | +1 | −12 | −21 | −20 |
| 2. `+oka (+20)` to 1st | +32 | +1 | −12 | −21 | 0 |
| 3. `+uma 10-20` (+20/+10/−10/−20) | **+52** | **+11** | **−22** | **−41** | **0** |
| 4. Money at tenpin (×¥100) | **+¥5,200** | **+¥1,100** | **−¥2,200** | **−¥4,100** | **¥0** |

Swap to uma 10-30 → A becomes **+62** (+¥6,200) and D becomes **−51** (−¥5,100), B/C unchanged.

**Second worked example (parlor, verifies oka is applied even when "hidden"):** tengo 0.5, uma 5-10, raw 35,000/30,000/20,000/15,000 → after `(raw−30k)/1000` = +5/0/−10/−15 (sum −20), **+oka +20 to 1st** = +25/0/−10/−15, +uma 5-10 = **+35/+5/−15/−25** → **+¥1,750/+¥250/−¥750/−¥1,250** (sum ¥0). CONFIRMED [OSA]. **Implementation warning:** this classic osamuko example **does apply oka** — omitting it makes the four End scores sum to −20 and mis-pays every non-identical distribution.

---

## 5. Money-game house rules (and where they vary)

Almost every dial below is set **per parlor/club/league** — confirm the exact ruleset before money play [SG-rules][OOYA]. The settlement *structure* (§4) is invariant; the *values* are not.

### 5.1 Game length
- **Hanchan** (East + South rounds, ~8+ hands) — the default.
- **Tonpuusen** (East round only, ~4+ hands) — roughly half length. CONFIRMED [W][MJDF].
Online uma/oka often differ between hanchan and tonpuusen — key on game length.

### 5.2 Tobi / bust (game-ending on negative score) — optional
No separate cash fine; its money effect flows entirely through **placement** (last place captures the bottom uma). CONFIRMED [W][BGA][OOYA]. Threshold is RULESET-DEPENDENT:
- Ends when a player drops **below 0** [BGA] (most tobi rulesets, e.g. USPML).
- Some end at **≤ 0** (e.g. ZOO) [OOYA].
- Competition rules mostly have **no tobi** [OOYA].

### 5.3 Agari-yame / tenpai-yame — optional
The dealer, if in **1st place** at the final hand, may **end the game** and waive the normal dealer-repeat. CONFIRMED [BGA]. On/off and the 1st-place condition vary by ruleset [OOYA]; SgRiichi sets **Agari-yame = No** [SG-rules].

### 5.4 Yakitori (penalty for never winning a hand) — optional
A player who wins **no hand all game** pays a pre-agreed penalty, typically **≈ −20 (i.e. −20,000 points)**, sometimes −10,000; Peter Gao's shuugi ruleset sets it at **3 chips = 15,000 points** (at 5,000/chip). Range ≈ 15,000–20,000. Value **must be pre-agreed**. CONFIRMED [RW-yak][PET-shu]; competition rulesets set yakitori **off** [OOYA].

### 5.5 Aka dora (red fives)
Extra dora tiles, typically **ON** for casual/SEA money play, **OFF** for WRC. RULESET-DEPENDENT [SG-rules][OOYA].

### 5.6 Shuugi (chips) — separate immediate side-pot
Where used, chips settle **immediately**, valued **~5,000 pts (~¥500) per chip at tenpin**, ~2,000 pts (~¥100) at tengo. Typical awards: 1 chip each per aka / ippatsu / ura-dora; yakuman = 10 chips on ron, 5 chips each on tsumo. Peter Gao pays hanchan uma as **+6/+2/−2/−6 chips** (= +30k/+10k/−10k/−30k at 5,000/chip). CONFIRMED [PET-shu][RR][OSA]. Track chips as a **separate ledger** from the points→money conversion.

### 5.7 Session tallying
Each game yields a zero-sum, oka+uma-adjusted `±units` per player; **sum units across games**, then `× rate` (+ chips, − table rake). CONFIRMED [OSA][W]. The per-game table is zero-sum **before** rake; the rake makes the *table* net negative (the parlor's cut).

### 5.8 Concrete real-world ruleset (worked reference — SgRiichi / R.League 24/25)
Every figure CONFIRMED verbatim [SG-rleague][SG-rules]: hanchan; **25,000 start**; **20K oka**; **base uma [30/10/−10/−30]**; **aka dora ON**; **tobi OFF**; **agari-yame OFF**; **chombo = 30-point deduction from tournament score** (hanchan score unchanged — penalties hit standing only, not the table money). The **effective placement spread is [45/5/−15/−35]**, which is exactly `return −5/player + oka +20 to 1st + base uma`:
- 1st: −5 + 20 + 30 = **+45**; 2nd: −5 + 10 = **+5**; 3rd: −5 − 10 = **−15**; 4th: −5 − 30 = **−35** (sums to 0).
SgRiichi states it "mainly follow[s] the World Riichi Championship Rules with the exception of Aka-Dora" [SG-rules].

---

## Engineering checklist (what MUST be configurable, not hard-coded)

1. **start / return points** (25k/30k default; WRC/EMA 30k/30k) — drives oka.
2. **oka on/off** (derived from start≠return).
3. **uma table** (5-10 / 10-20 / 10-30 / 20-30 / 5-15 / 30-10 …).
4. **tie-break mode** (seat-wind order vs averaged uma).
5. **rate** (tenpin/tengo/tensan/tenni) and **table rake**.
6. **kiriage mangan** on/off; **kazoe yakuman** allowed/not.
7. **renchan variant** (agari / tenpai / ryuukyoku); **agari-yame** on/off.
8. **tobi** off / <0 / ≤0.
9. **chombo mode** (reverse-mangan table payment vs fixed point penalty) and its value.
10. **nagashi mangan**: replaces vs stacks-with noten exchange.
11. **abortive-draw honba** +1 vs +0.
12. **leftover riichi sticks at game end**: forfeited (tournament default) / to 1st place / to depositor(uncertain).
13. **yakitori** on/off + value; **aka dora** on/off; **shuugi** ledger (separate).
14. **game length** hanchan/tonpuusen (may switch uma/oka).

Invariant to assert in tests: after oka+uma, the four End scores **sum to exactly 0**; and the §4.6 example must reproduce **+52/+11/−22/−41 → +¥5,200/+¥1,100/−¥2,200/−¥4,100**.