"""Render the common T1 representation to one neutral 1024x1024 PNG."""
import base64
import gzip
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 512
COLORS = [
    (198, 210, 169),  # grass
    (224, 202, 153),  # desert
    (123, 158, 119),  # forest
    (139, 180, 157),  # marsh
    (190, 195, 185),  # tundra
    (226, 233, 231),  # ice
    (167, 159, 143),  # rock
]
SEA = (145, 188, 204)
LAKE = (122, 173, 192)
RIVER = (45, 111, 145)


def font(size):
    for name in ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simsun.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def load(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        rep = json.load(handle)
    for key in ["sea", "lake", "dryLand", "mountain", "biome", "riverMask"]:
        rep[key] = base64.b64decode(rep[key])
    return rep


def label(draw, text, x, y, chosen, ft):
    if not text:
        return
    x, y = max(5, min(930, int(x))), max(5, min(1000, int(y)))
    box = draw.textbbox((x, y), text, font=ft, stroke_width=2)
    if any(not (box[2] < a[0] or box[0] > a[2] or box[3] < a[1] or box[1] > a[3]) for a in chosen):
        y = max(5, min(1000, y + 22))
        box = draw.textbbox((x, y), text, font=ft, stroke_width=2)
    chosen.append(box)
    draw.text((x, y), text, fill=(32, 45, 49), font=ft, stroke_width=2, stroke_fill=(244, 241, 226))


def render(rep, output):
    sea, lake, mountain, biome, river = (rep[k] for k in ("sea", "lake", "mountain", "biome", "riverMask"))
    pixels = bytearray(SIZE * SIZE * 3)
    for i in range(SIZE * SIZE):
        c = SEA if sea[i] else LAKE if lake[i] else COLORS[min(biome[i], len(COLORS) - 1)]
        if mountain[i] and not sea[i] and not lake[i]:
            c = tuple(max(0, int(v * .72)) for v in c)
        if river[i] and not sea[i] and not lake[i]:
            c = RIVER
        pixels[3*i:3*i+3] = bytes(c)
    img = Image.frombytes("RGB", (SIZE, SIZE), bytes(pixels)).resize((1024, 1024), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(img)
    chosen, ft = [], font(19)
    for group in (rep.get("mountainFeatures", []), rep.get("lakeFeatures", [])):
        for feature in group:
            cells = feature.get("cells", [])
            if not cells or not feature.get("name"):
                continue
            x = 2 * sum(i % SIZE for i in cells) / len(cells)
            y = 2 * sum(i // SIZE for i in cells) / len(cells)
            label(draw, feature["name"], x, y, chosen, ft)
    for r in rep.get("rivers", []):
        path = r.get("path", [])
        if path and r.get("name"):
            i = path[len(path) // 2]
            label(draw, r["name"], 2 * (i % SIZE) + 5, 2 * (i // SIZE) - 20, chosen, ft)
    for s in rep.get("settlements", []):
        x, y = int(s["x"] * 2 + 1), int(s["y"] * 2 + 1)
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(248, 244, 231), outline=(29, 45, 51), width=2)
        label(draw, s.get("name", ""), x + 10, y - 13, chosen, ft)
    img.save(output, "PNG")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: render.py INPUT.rep.json.gz OUTPUT.png")
    render(load(sys.argv[1]), sys.argv[2])
