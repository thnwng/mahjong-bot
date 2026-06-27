"""In-memory per-chat game session state (players, base values, balances, log).

Lost on bot restart - fine for a first version; swap for persistent storage
later if sessions need to survive restarts.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class LogEntry:
    """One recorded action. `actioner` is whoever entered it (not necessarily a
    player in the action) - kept so the log shows who logged what, in order."""

    actioner: str
    summary: str
    transfers: list  # list[Transfer]


@dataclass
class GameSession:
    players: list[str]
    # Base values fixed at game start (see /newgame).
    tai_base: float = 0.10   # 1-tai value for hu/zimo (doubles per tai)
    yao_base: float = 0.10   # x: an yao = 2x, hou yao = x
    gang_base: float = 0.10  # y: an gang = 2y, shoot/peng gang = y
    balances: dict[str, float] = field(default_factory=dict)
    log: list[LogEntry] = field(default_factory=list)

    def __post_init__(self) -> None:
        for p in self.players:
            self.balances.setdefault(p, 0.0)

    def apply_transfers(self, transfers) -> None:
        for t in transfers:
            self.balances[t.payer] -= t.amount
            self.balances[t.payee] += t.amount

    def record(self, actioner: str, summary: str, transfers) -> None:
        """Apply the transfers to balances and append to the chronological log."""
        self.apply_transfers(transfers)
        self.log.append(LogEntry(actioner=actioner, summary=summary, transfers=list(transfers)))


_sessions: dict[int, GameSession] = {}


def start_session(
    chat_id: int,
    players: list[str],
    tai_base: float = 0.10,
    yao_base: float = 0.10,
    gang_base: float = 0.10,
) -> GameSession:
    session = GameSession(
        players=players, tai_base=tai_base, yao_base=yao_base, gang_base=gang_base
    )
    _sessions[chat_id] = session
    return session


def get_session(chat_id: int) -> GameSession | None:
    return _sessions.get(chat_id)


def end_session(chat_id: int) -> None:
    _sessions.pop(chat_id, None)
