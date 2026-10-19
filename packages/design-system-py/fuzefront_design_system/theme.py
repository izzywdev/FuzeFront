"""
Theme models and contextual theme detection for FuzeFront microservices.
"""

from dataclasses import dataclass
from enum import Enum

from . import tokens


class FuzeTheme(str, Enum):
    DARK = "dark"
    LIGHT = "light"


@dataclass(frozen=True)
class ThemePalette:
    bg_primary: str
    bg_secondary: str
    bg_tertiary: str
    bg_quaternary: str
    border_color: str
    border_subtle: str
    border_strong: str
    text_primary: str
    text_secondary: str
    text_tertiary: str
    accent: str
    accent_2: str
    seam: str


DARK_PALETTE = ThemePalette(
    bg_primary=tokens.DARK_BG_PRIMARY,
    bg_secondary=tokens.DARK_BG_SECONDARY,
    bg_tertiary=tokens.DARK_BG_TERTIARY,
    bg_quaternary=tokens.DARK_BG_QUATERNARY,
    border_color=tokens.DARK_BORDER_COLOR,
    border_subtle=tokens.DARK_BORDER_SUBTLE,
    border_strong=tokens.DARK_BORDER_STRONG,
    text_primary=tokens.DARK_TEXT_PRIMARY,
    text_secondary=tokens.DARK_TEXT_SECONDARY,
    text_tertiary=tokens.DARK_TEXT_TERTIARY,
    accent=tokens.COLOR_ELECTRIC_INDIGO,
    accent_2=tokens.COLOR_CYAN,
    seam=tokens.SEAM_GRADIENT,
)

LIGHT_PALETTE = ThemePalette(
    bg_primary=tokens.LIGHT_BG_PRIMARY,
    bg_secondary=tokens.LIGHT_BG_SECONDARY,
    bg_tertiary=tokens.LIGHT_BG_TERTIARY,
    bg_quaternary=tokens.LIGHT_BG_QUATERNARY,
    border_color=tokens.LIGHT_BORDER_COLOR,
    border_subtle=tokens.LIGHT_BORDER_SUBTLE,
    border_strong=tokens.LIGHT_BORDER_STRONG,
    text_primary=tokens.LIGHT_TEXT_PRIMARY,
    text_secondary=tokens.LIGHT_TEXT_SECONDARY,
    text_tertiary=tokens.LIGHT_TEXT_TERTIARY,
    accent=tokens.COLOR_ELECTRIC_INDIGO,
    accent_2=tokens.COLOR_CYAN,
    seam=tokens.SEAM_GRADIENT,
)


class ThemeContext:
    def __init__(self, theme: str | None = None):
        self.theme: FuzeTheme = (
            FuzeTheme.LIGHT if theme == "light" else FuzeTheme.DARK
        )

    @property
    def palette(self) -> ThemePalette:
        return LIGHT_PALETTE if self.theme == FuzeTheme.LIGHT else DARK_PALETTE

    @property
    def is_dark(self) -> bool:
        return self.theme == FuzeTheme.DARK

    @property
    def is_light(self) -> bool:
        return self.theme == FuzeTheme.LIGHT

    def to_css_variables(self) -> dict[str, str]:
        p = self.palette
        return {
            "--bg-primary": p.bg_primary,
            "--bg-secondary": p.bg_secondary,
            "--bg-tertiary": p.bg_tertiary,
            "--bg-quaternary": p.bg_quaternary,
            "--border-color": p.border_color,
            "--border-color-subtle": p.border_subtle,
            "--border-color-strong": p.border_strong,
            "--text-primary": p.text_primary,
            "--text-secondary": p.text_secondary,
            "--text-tertiary": p.text_tertiary,
            "--accent-color": p.accent,
            "--accent-2": p.accent_2,
            "--seam": p.seam,
        }
