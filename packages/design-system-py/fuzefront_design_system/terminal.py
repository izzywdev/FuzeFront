"""
Terminal & CLI styling adhering to FuzeFront Design System fuse seam tokens.
"""

from . import tokens


def get_ansi_seam_banner(text: str = "FUZEFRONT") -> str:
    """Returns ANSI gradient formatted banner"""
    return f"\033[38;2;110;92;255mFuze\033[38;2;41;211;230mFront\033[0m: {text}"


def format_cli_status(label: str, status: str = "online") -> str:
    """Format a status badge for terminal output using FuzeFront tokens"""
    if status.lower() in ("online", "running", "success"):
        color = "\033[38;2;16;185;129m"  # Success green
    elif status.lower() in ("executing", "processing", "pending"):
        color = "\033[38;2;110;92;255m"  # Indigo
    elif status.lower() in ("warning", "booting"):
        color = "\033[38;2;245;158;11m"  # Amber
    else:
        color = "\033[38;2;104;117;141m"  # Slate
    return f"{color}[{status.upper()}]\033[0m {label}"


def get_rich_theme_dict() -> dict[str, str]:
    """Provides style dictionary for Rich console"""
    return {
        "fuze.indigo": tokens.COLOR_ELECTRIC_INDIGO,
        "fuze.cyan": tokens.COLOR_CYAN,
        "fuze.bg": tokens.DARK_BG_PRIMARY,
        "fuze.border": tokens.DARK_BORDER_COLOR,
        "fuze.text": tokens.DARK_TEXT_PRIMARY,
        "fuze.muted": tokens.DARK_TEXT_SECONDARY,
        "fuze.success": tokens.COLOR_SUCCESS,
        "fuze.warning": tokens.COLOR_WARNING,
        "fuze.danger": tokens.COLOR_DANGER,
    }
