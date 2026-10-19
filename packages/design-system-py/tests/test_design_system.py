from fuzefront_design_system import (
    COLOR_CYAN,
    COLOR_ELECTRIC_INDIGO,
    SEAM_GRADIENT,
    StatusPillData,
    ThemeContext,
)


def test_tokens():
    assert COLOR_ELECTRIC_INDIGO == "#6e5cff"
    assert COLOR_CYAN == "#29d3e6"
    assert "linear-gradient" in SEAM_GRADIENT

def test_theme_context():
    dark_ctx = ThemeContext("dark")
    assert dark_ctx.is_dark is True
    assert dark_ctx.palette.bg_primary == "#0b0e15"

    light_ctx = ThemeContext("light")
    assert light_ctx.is_light is True
    assert light_ctx.palette.bg_primary == "#f6f8fb"

    css_vars = dark_ctx.to_css_variables()
    assert "--seam" in css_vars
    assert "--accent-color" in css_vars

def test_components():
    pill = StatusPillData(status="online", label="⚡ Live WebSocket Bus")
    d = pill.to_dict()
    assert d["status"] == "online"
    assert "Live" in d["label"]
