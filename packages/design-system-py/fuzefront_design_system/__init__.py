"""
FuzeFront Design System Python Package.
"""

from .components import ChatBubbleData, StatusPillData
from .terminal import format_cli_status, get_ansi_seam_banner, get_rich_theme_dict
from .theme import DARK_PALETTE, LIGHT_PALETTE, FuzeTheme, ThemeContext, ThemePalette
from .tokens import (
    COLOR_CYAN,
    COLOR_ELECTRIC_INDIGO,
    DARK_BG_PRIMARY,
    DARK_BG_SECONDARY,
    DARK_BG_TERTIARY,
    DARK_BORDER_COLOR,
    DARK_TEXT_PRIMARY,
    DARK_TEXT_SECONDARY,
    FONT_DISPLAY,
    FONT_MONO,
    FONT_SANS,
    LIGHT_BG_PRIMARY,
    LIGHT_BG_SECONDARY,
    LIGHT_BORDER_COLOR,
    LIGHT_TEXT_PRIMARY,
    SEAM_GRADIENT,
)

__version__ = "1.0.0"

__all__ = [
    "ChatBubbleData",
    "COLOR_CYAN",
    "COLOR_ELECTRIC_INDIGO",
    "DARK_BG_PRIMARY",
    "DARK_BG_SECONDARY",
    "DARK_BG_TERTIARY",
    "DARK_BORDER_COLOR",
    "DARK_PALETTE",
    "DARK_TEXT_PRIMARY",
    "DARK_TEXT_SECONDARY",
    "FONT_DISPLAY",
    "FONT_MONO",
    "FONT_SANS",
    "format_cli_status",
    "FuzeTheme",
    "get_ansi_seam_banner",
    "get_rich_theme_dict",
    "LIGHT_BG_PRIMARY",
    "LIGHT_BG_SECONDARY",
    "LIGHT_BORDER_COLOR",
    "LIGHT_PALETTE",
    "LIGHT_TEXT_PRIMARY",
    "SEAM_GRADIENT",
    "StatusPillData",
    "ThemeContext",
    "ThemePalette",
]
