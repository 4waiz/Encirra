"""Side-by-side comparison of the reference design and a captured screenshot.

Usage:
    python scripts/qa/compare.py <capture.png> [--out tests/e2e/output/qa/compare.png]

The reference is scaled to the capture's width so layout proportions can be compared directly.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "Encirra Smart City Resilience Dashboard.png"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--out", default=str(ROOT / "tests/e2e/output/qa/compare.png"))
    ap.add_argument("--stack", action="store_true", help="stack vertically instead of side by side")
    a = ap.parse_args()

    cap = Image.open(a.capture).convert("RGB")
    ref = Image.open(REFERENCE).convert("RGB")
    w = 1200
    cap = cap.resize((w, round(cap.height * w / cap.width)), Image.LANCZOS)
    ref = ref.resize((w, round(ref.height * w / ref.width)), Image.LANCZOS)
    label_h = 26
    if a.stack:
        canvas = Image.new("RGB", (w, ref.height + cap.height + 2 * label_h), "white")
        canvas.paste(ref, (0, label_h))
        canvas.paste(cap, (0, ref.height + 2 * label_h))
        spots = [(8, 4, "REFERENCE"), (8, ref.height + label_h + 4, "CURRENT BUILD")]
    else:
        h = max(ref.height, cap.height)
        canvas = Image.new("RGB", (2 * w + 12, h + label_h), "white")
        canvas.paste(ref, (0, label_h))
        canvas.paste(cap, (w + 12, label_h))
        spots = [(8, 4, "REFERENCE"), (w + 20, 4, "CURRENT BUILD")]
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("arial.ttf", 16)
    except OSError:
        font = ImageFont.load_default()
    for x, y, t in spots:
        d.text((x, y), t, fill=(21, 40, 60), font=font)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(a.out)
    print(a.out)


if __name__ == "__main__":
    main()
