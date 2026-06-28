import json
import logging
import os
from urllib.parse import quote

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

from engine.riichi.analyze import CalledMeld, WinContext, analyze as riichi_analyze
from engine.riichi.scoring import score as riichi_score
from engine.sg.payout import (
    Transfer,
    fan_to_value,
    settle_discard_win,
    settle_gang,
    settle_self_draw,
    settle_yao,
)
from game_session import end_session, get_session, start_session

# override=True so this bot's .env token wins over any global TELEGRAM_BOT_TOKEN
# (the machine has a global one for a different bot - without this it would clash).
load_dotenv(override=True)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

WEBAPP_URL = os.environ.get("WEBAPP_URL")
DEFAULT_BASE = float(os.environ.get("BASE_UNIT", "0.10"))


# --- helpers ------------------------------------------------------------

def _fmt_transfers(session, transfers) -> str:
    fmt = (lambda a: f"{a:,.0f}") if session.game_type == "riichi" else (lambda a: f"{a:.2f}")
    return "\n".join(f"  {t.payer} → {t.payee}: {fmt(t.amount)}" for t in transfers)


def _fmt_balances(session) -> str:
    fmt = (lambda a: f"{a:+,.0f}") if session.game_type == "riichi" else (lambda a: f"{a:+.2f}")
    return "\n".join(f"  {p}: {fmt(session.balances[p])}" for p in session.players)


def _actioner_name(update: Update) -> str:
    u = update.effective_user
    return (u.full_name or u.username or str(u.id)) if u else "?"


def _parse_values(text: str) -> dict:
    """Parse 'tai 0.1 yao 0.2 gang 0.2' (any subset, any order) into a dict."""
    out = {}
    tokens = text.replace(",", " ").split()
    for i in range(len(tokens) - 1):
        key = tokens[i].lower()
        if key in ("tai", "yao", "gang"):
            try:
                out[f"{key}_base"] = float(tokens[i + 1])
            except ValueError:
                pass
    return out


# --- commands -----------------------------------------------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("Welcome to Mahjong Bot! Use /help to see available commands.")


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "Commands:\n"
        "/newgame Alice, Bob, Carol, Dave - start a SG session (4 players)\n"
        "   optional values: /newgame Alice, Bob, Carol, Dave | tai 0.1 yao 0.2 gang 0.2\n"
        "/newriichi Alice, Bob, Carol, Dave - start a riichi session (3 or 4 players)\n"
        "/play - open the input form (SG action menu / riichi win entry)\n"
        "/balances - show current running balances\n"
        "/log - show the chronological action log\n"
        "/endgame - end the session\n"
        "/help - show this message"
    )


async def newgame(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    raw = update.message.text.partition(" ")[2]
    players_part, _, values_part = raw.partition("|")
    players = [p.strip() for p in players_part.split(",") if p.strip()]
    if len(players) != 4:
        await update.message.reply_text(
            "Usage: /newgame Alice, Bob, Carol, Dave (exactly 4 players for SG mahjong)\n"
            "Optional: ... | tai 0.1 yao 0.2 gang 0.2"
        )
        return

    values = _parse_values(values_part)
    session = start_session(
        update.effective_chat.id,
        players,
        tai_base=values.get("tai_base", DEFAULT_BASE),
        yao_base=values.get("yao_base", DEFAULT_BASE),
        gang_base=values.get("gang_base", DEFAULT_BASE),
    )
    await update.message.reply_text(
        f"Session started with: {', '.join(players)}\n"
        f"Values - tai: {session.tai_base:.2f}  yao(x): {session.yao_base:.2f}  "
        f"gang(y): {session.gang_base:.2f}\n"
        "Use /play to open the action menu."
    )


async def newriichi(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    raw = update.message.text.partition(" ")[2]
    players = [p.strip() for p in raw.split(",") if p.strip()]
    if len(players) not in (3, 4):
        await update.message.reply_text(
            "Usage: /newriichi Alice, Bob, Carol, Dave (3 players for sanma, 4 for yonma)"
        )
        return

    start_session(update.effective_chat.id, players, game_type="riichi")
    await update.message.reply_text(
        f"Riichi session started ({len(players)} players): {', '.join(players)}\n"
        "Use /play to record a win (han + fu)."
    )


async def play(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not WEBAPP_URL:
        await update.message.reply_text(
            "WEBAPP_URL is not set yet. Add it to .env once the Mini App is hosted."
        )
        return

    session = get_session(update.effective_chat.id)
    if not session:
        await update.message.reply_text("No active session. Start one with /newgame first.")
        return

    type_param = "&type=riichi" if session.game_type == "riichi" else ""
    url = f"{WEBAPP_URL}?players={quote(','.join(session.players))}{type_param}"
    label = "🀄 Open Win Entry" if session.game_type == "riichi" else "🀄 Open Action Menu"
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]]
    )
    await update.message.reply_text("Tap below to record an action:", reply_markup=keyboard)


async def balances(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    session = get_session(update.effective_chat.id)
    if not session:
        await update.message.reply_text("No active session. Start one with /newgame first.")
        return
    await update.message.reply_text("Current balances:\n" + _fmt_balances(session))


async def show_log(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    session = get_session(update.effective_chat.id)
    if not session:
        await update.message.reply_text("No active session. Start one with /newgame first.")
        return
    if not session.log:
        await update.message.reply_text("No actions recorded yet.")
        return
    lines = [f"{i + 1}. [{e.actioner}] {e.summary}" for i, e in enumerate(session.log)]
    await update.message.reply_text("Action log:\n" + "\n".join(lines))


async def endgame(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    session = get_session(update.effective_chat.id)
    if not session:
        await update.message.reply_text("No active session.")
        return
    out = _fmt_balances(session)
    end_session(update.effective_chat.id)
    await update.message.reply_text("Session ended. Final balances:\n" + out)


# --- action dispatch ----------------------------------------------------

def _build_action(session, data: dict):
    """Return (summary, transfers) for a submitted action, or raise ValueError."""
    action = data.get("action")

    if action == "hu":
        tai = int(data["tai"])
        winner, discarder = data["winner"], data["discarder"]
        value = fan_to_value(tai, base_unit=session.tai_base)
        transfers = settle_discard_win(winner, discarder, value)
        return f"Hu: {winner} wins off {discarder} ({tai} tai, {value:.2f})", transfers

    if action == "zimo":
        tai = int(data["tai"])
        winner = data["winner"]
        value = fan_to_value(tai, base_unit=session.tai_base)
        transfers = settle_self_draw(winner, value, players=session.players)
        return f"Zimo: {winner} self-draws ({tai} tai)", transfers

    if action == "gang":
        gtype = data["gang_type"]  # an | shoot | peng
        konger = data["konger"]
        shooter = data.get("shooter") if gtype == "shoot" else None
        transfers = settle_gang(konger, gtype, session.gang_base, session.players, shooter=shooter)
        label = {"an": "an gang", "shoot": "shoot gang", "peng": "gang after peng"}[gtype]
        who = f" off {shooter}" if shooter else ""
        return f"Gang: {konger} {label}{who}", transfers

    if action == "yao":
        ytype = data["yao_type"]  # an | hou
        biter = data["biter"]
        target = data.get("target") if data.get("scope") == "one" else None
        transfers = settle_yao(biter, ytype, session.yao_base, session.players, target=target)
        label = {"an": "an yao", "hou": "hou yao"}[ytype]
        who = f" on {target}" if target else " on everyone"
        return f"Yao: {biter} {label}{who}", transfers

    raise ValueError(f"unknown action: {action!r}")


def _build_riichi(session, data: dict):
    """Settle a riichi win.  Two paths:
    - Auto: payload has 'tiles' (list of tile codes) + optional 'called' melds
      => calls the analyzer to detect yaku/fu automatically.
    - Manual: payload has 'han' + 'fu' => uses them directly.
    Both paths share the same transfer-building logic.
    """
    winner = data["winner"]
    dealer = data["dealer"]
    tsumo = bool(data["tsumo"])
    discarder = data.get("discarder")
    honba = int(data.get("honba", 0))
    players = session.players
    is_dealer = winner == dealer

    if "tiles" in data:
        # --- auto path: analyze from tile codes ---
        seat_wind = data.get("seat_wind", "SW")   # winner's seat wind
        round_wind = data.get("round_wind", "EW")
        win_tile = data["win_tile"]
        # The analyzer scores dealer-ness from the seat wind (East = dealer),
        # but payouts are routed by the dealer field; they must agree or the
        # settlement won't balance.
        if (seat_wind == "EW") != is_dealer:
            raise ValueError(
                "winner's seat wind must be East iff the winner is the dealer"
            )
        ctx = WinContext(
            seat_wind=seat_wind,
            round_wind=round_wind,
            win_tile=win_tile,
            tsumo=tsumo,
            riichi=bool(data.get("riichi", False)),
            double_riichi=bool(data.get("double_riichi", False)),
            ippatsu=bool(data.get("ippatsu", False)),
            dora=int(data.get("dora", 0)),
            aka=int(data.get("aka", 0)),
            players=len(players),
            honba=honba,
        )
        called_raw = data.get("called", [])
        called = [CalledMeld(m["kind"], tuple(m["codes"]), m.get("concealed", False))
                  for m in called_raw]
        result = riichi_analyze(data["tiles"], called, ctx)
        if not result.ok:
            raise ValueError(f"invalid hand: {result.error}")
        s = result.score
        han, fu = result.han, result.fu
        yaku_str = ", ".join(
            (n if h == 0 else f"{n} {h}han") for n, h in result.yaku
        )
        if result.yakuman:
            yaku_str = " + ".join(result.yakuman)
        auto_note = f"\nYaku: {yaku_str}"
    else:
        # --- manual path: user supplied han + fu ---
        han = int(data["han"]) + int(data.get("dora", 0))
        fu = int(data.get("fu", 30))
        s = riichi_score(han, fu, dealer=is_dealer, tsumo=tsumo,
                         players=len(players), honba=honba)
        auto_note = ""

    transfers: list[Transfer] = []
    if not tsumo:
        if not discarder or discarder == winner:
            raise ValueError("ron needs a discarder who isn't the winner")
        transfers.append(Transfer(payer=discarder, payee=winner, amount=s.payments[0].amount))
        win_desc = f"ron off {discarder}"
    else:
        others = [p for p in players if p != winner and p != dealer]
        for p in s.payments:
            if p.role == "dealer":
                transfers.append(Transfer(payer=dealer, payee=winner, amount=p.amount))
            else:  # non-dealer payers: everyone except winner and dealer
                for pl in others:
                    transfers.append(Transfer(payer=pl, payee=winner, amount=p.amount))
        win_desc = "tsumo"

    limit = f" {s.limit}" if s.limit else ""
    fu_note = f" {fu}fu" if han > 0 and han < 5 else ""
    summary = (f"Riichi: {winner} {win_desc} - {han} han{fu_note}{limit} "
               f"({s.from_payments:,} pts){auto_note}")
    return summary, transfers


async def handle_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    session = get_session(update.effective_chat.id)
    if not session:
        await update.message.reply_text("No active session. Start one with /newgame first.")
        return

    data = json.loads(update.effective_message.web_app_data.data)
    try:
        if data.get("action") == "riichi":
            summary, transfers = _build_riichi(session, data)
        else:
            summary, transfers = _build_action(session, data)
    except (KeyError, ValueError) as e:
        await update.message.reply_text(f"Invalid action: {e}")
        return

    actioner = _actioner_name(update)
    session.record(actioner, summary, transfers)

    await update.message.reply_text(
        f"🀄 {summary}\n"
        f"(entered by {actioner})\n\n"
        f"Payouts:\n{_fmt_transfers(session, transfers)}\n\n"
        f"Balances:\n{_fmt_balances(session)}"
    )


def main() -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("newgame", newgame))
    application.add_handler(CommandHandler("newriichi", newriichi))
    application.add_handler(CommandHandler("play", play))
    application.add_handler(CommandHandler("balances", balances))
    application.add_handler(CommandHandler("log", show_log))
    application.add_handler(CommandHandler("endgame", endgame))
    application.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_webapp_data))

    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
