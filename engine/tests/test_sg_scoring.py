from engine.sg.payout import (
    fan_to_value,
    settle_discard_win,
    settle_gang,
    settle_self_draw,
    settle_yao,
)
from engine.sg.scoring import HandContext, score_hand
from engine.tiles import parse_tiles


def test_chicken_hand():
    tiles = parse_tiles(
        ["1B", "2B", "3B", "4C", "5C", "6C", "7D", "8D", "9D", "2B", "3B", "4B", "5D", "5D"]
    )
    ctx = HandContext(seat_wind="EW", round_wind="EW")
    result = score_hand(tiles, ctx)
    assert result.is_chicken_hand
    assert result.fan == 0


def test_full_flush():
    tiles = parse_tiles(
        ["1B", "2B", "3B", "4B", "5B", "6B", "7B", "8B", "9B", "2B", "3B", "4B", "5B", "5B"]
    )
    ctx = HandContext(seat_wind="EW", round_wind="EW")
    result = score_hand(tiles, ctx)
    assert "Full Flush" in result.breakdown
    assert result.fan == 6


def test_seven_pairs():
    tiles = parse_tiles(
        ["1B", "1B", "2B", "2B", "3B", "3B", "4C", "4C", "5C", "5C", "6D", "6D", "RD", "RD"]
    )
    ctx = HandContext(seat_wind="EW", round_wind="EW")
    result = score_hand(tiles, ctx)
    assert result.fan == 6
    assert "All Pairs (Seven Pairs)" in result.breakdown


def test_fan_to_value_doubling():
    assert fan_to_value(0, base_unit=1) == 1
    assert fan_to_value(1, base_unit=1) == 1
    assert fan_to_value(2, base_unit=1) == 2
    assert fan_to_value(3, base_unit=1) == 4
    assert fan_to_value(10, base_unit=1) == 512
    assert fan_to_value(20, base_unit=1) == 512  # capped at LIMIT_FAN


def test_settle_discard_win():
    transfers = settle_discard_win("Alice", "Bob", value=4)
    assert len(transfers) == 1
    assert transfers[0].payer == "Bob"
    assert transfers[0].payee == "Alice"
    assert transfers[0].amount == 4


def test_settle_self_draw():
    players = ["Alice", "Bob", "Carol", "Dave"]
    transfers = settle_self_draw("Alice", value=2, players=players)
    assert len(transfers) == 3
    assert all(t.amount == 4 for t in transfers)  # 2x discard rate


PLAYERS = ["Alice", "Bob", "Carol", "Dave"]


def test_yao_an_everyone():
    # an yao = 2x, split among the 3 others -> 2x/3 each
    transfers = settle_yao("Alice", "an", x=3, players=PLAYERS)
    assert len(transfers) == 3
    assert all(t.payee == "Alice" and t.amount == 2 for t in transfers)  # 6/3


def test_yao_hou_everyone():
    # hou yao = x, split 3 ways -> x/3 each
    transfers = settle_yao("Alice", "hou", x=3, players=PLAYERS)
    assert len(transfers) == 3
    assert all(t.amount == 1 for t in transfers)  # 3/3


def test_yao_one_person():
    # one named target pays the whole amount alone (an yao = 2x)
    transfers = settle_yao("Alice", "an", x=3, players=PLAYERS, target="Bob")
    assert len(transfers) == 1
    assert transfers[0].payer == "Bob" and transfers[0].amount == 6


def test_gang_an():
    # concealed kong = 2y, split 3 ways -> 2y/3 each
    transfers = settle_gang("Alice", "an", y=3, players=PLAYERS)
    assert len(transfers) == 3
    assert all(t.amount == 2 for t in transfers)  # 6/3


def test_gang_shoot_shooter_pays():
    # shoot gang, shooter named -> discarder pays full y alone
    transfers = settle_gang("Alice", "shoot", y=3, players=PLAYERS, shooter="Carol")
    assert len(transfers) == 1
    assert transfers[0].payer == "Carol" and transfers[0].amount == 3


def test_gang_shoot_everyone():
    # shoot gang, no shooter named -> y split 3 ways
    transfers = settle_gang("Alice", "shoot", y=3, players=PLAYERS)
    assert len(transfers) == 3
    assert all(t.amount == 1 for t in transfers)


def test_gang_after_peng():
    # added kong = y, split 3 ways
    transfers = settle_gang("Alice", "peng", y=3, players=PLAYERS)
    assert len(transfers) == 3
    assert all(t.amount == 1 for t in transfers)


def run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"\n{len(tests)} tests passed")


if __name__ == "__main__":
    run_all()
