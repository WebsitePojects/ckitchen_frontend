"""Generate ORION's five-class size scale as CSS custom properties.

Usage: python scripts/gen-scale.py  -> paste the output over the scale block in src/index.css.

Each token has a value (px) at each device anchor. Between two anchors the value slides
linearly with the viewport width (clamp), so in-between widths never jump. Output is rem.
"""
ANCHORS = [360, 640, 1024, 1440, 1920]  # phone, tablet, laptop, small monitor, big monitor

TOKENS = {
    # text
    "--fs-micro":   [11, 11, 11, 12, 12],
    "--fs-small":   [13, 13, 13, 13.5, 14.5],
    "--fs-body":    [15, 15, 14.5, 15, 16],
    "--fs-input":   [16, 16, 14.5, 15, 16],  # 16px up to tablet: iOS zooms smaller inputs
    "--fs-section": [17, 18, 18, 19, 21],
    "--fs-figure":  [22, 24, 26, 28, 32],
    "--fs-title":   [22, 24, 25, 27, 31],
    "--fs-display": [24, 28, 30, 34, 40],
    # sizing and spacing
    "--control-h":  [44, 44, 40, 40, 44],  # 44px touch target on phones and tablets
    "--sp-gutter":  [16, 24, 32, 40, 48],
    "--sp-gap":     [12, 16, 16, 20, 24],
    "--sp-section": [32, 40, 44, 52, 64],
    "--form-max":   [360, 400, 400, 420, 460],
}


def rem(px: float) -> str:
    return f"{px / 16:.4f}".rstrip("0").rstrip(".") + "rem"


def segment(a: float, b: float, w0: int, w1: int) -> str:
    if a == b:
        return rem(a)
    slope = (b - a) / (w1 - w0)
    intercept = a - slope * w0
    lo, hi = min(a, b), max(a, b)
    sign = "-" if slope < 0 else "+"
    return f"clamp({rem(lo)}, {rem(intercept)} {sign} {abs(slope) * 100:.4f}vw, {rem(hi)})"


blocks = []
for i in range(len(ANCHORS)):
    lines = []
    for name, values in TOKENS.items():
        if i < len(ANCHORS) - 1:
            lines.append(f"    {name}: {segment(values[i], values[i + 1], ANCHORS[i], ANCHORS[i + 1])};")
        else:
            lines.append(f"    {name}: {rem(values[i])};")
    body = "\n".join(lines)
    if i == 0:
        blocks.append(f"  :root {{\n{body}\n  }}")
    else:
        blocks.append(f"  @media (min-width: {ANCHORS[i]}px) {{\n    :root {{\n" + "\n".join("  " + l for l in lines) + "\n    }\n  }")
print("\n".join(blocks))
