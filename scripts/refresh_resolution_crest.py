#!/usr/bin/env python3
"""Refresh the Resolution crest and local, offline-ready installation icons.

Run with a verified PNG path, or download the owner-supplied public PNG.
Requires Pillow. Does not deploy, change settings, or access private data.
"""
from pathlib import Path
import argparse
import io
import math
import urllib.request

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
URL = "https://i.ibb.co/bMDBZBRJ/Resolution-Heavy-Works-Heraldic-Crest.png"
OLD_URL = "https://phytehq.github.io/RHW/assets/rhw-forum-logo.png"
BG = (12, 12, 11, 255)


def read_crest(path):
    if path:
        raw = Path(path).read_bytes()
    else:
        request = urllib.request.Request(URL, headers={"User-Agent": "Resolution crest asset build/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(12 * 1024 * 1024 + 1)
    if len(raw) > 12 * 1024 * 1024 or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Expected the supplied PNG (maximum 12 MiB)")
    with Image.open(io.BytesIO(raw)) as image:
        if image.format != "PNG" or not 320 <= image.width <= 4096 or not 320 <= image.height <= 4096:
            raise ValueError("Unexpected source image dimensions or format")
        image.load()
        rgba = image.convert("RGBA")
    a = rgba.getchannel("A")
    bounds = a.point(lambda x: 255 if x >= 24 else 0).getbbox()
    if not bounds or a.getextrema() != (0, 255):
        raise ValueError("Source must contain a real transparent background and opaque crest")
    crop = rgba.crop(bounds)
    if not 0.70 <= crop.width / crop.height <= 0.90:
        raise ValueError("Unexpected crest aspect ratio")
    return crop


def save_crest(crest, filename, width, height):
    canvas = Image.new("RGBA", (width, height))
    fitted = ImageOps.contain(crest, canvas.size, method=Image.Resampling.LANCZOS)
    canvas.alpha_composite(fitted, ((width-fitted.width)//2, (height-fitted.height)//2))
    canvas.save(ROOT / "assets" / filename, optimize=True)


def save_icon(crest, filename, size, maskable=False, transparent=False):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent else BG)
    # The maskable safe zone is a centred circle of radius 40% of the icon.
    # Fit the entire crest rectangle within that circle, not merely its centre.
    max_height = int(size * 0.90)
    if maskable:
        max_height = min(max_height, int(size * 0.78 / math.hypot(1, crest.width / crest.height)))
    fitted = ImageOps.contain(crest, (size, max_height), method=Image.Resampling.LANCZOS)
    canvas.alpha_composite(fitted, ((size-fitted.width)//2, (size-fitted.height)//2))
    (canvas if transparent else canvas.convert("RGB")).save(ROOT / "assets" / filename, optimize=True)


def update_forum_url():
    for name in ("js/core/config.js", "scripts/smoke_interface_foundation.py"):
        path = ROOT / name
        original = path.read_text()
        if original.count(OLD_URL) == 1:
            path.write_text(original.replace(OLD_URL, URL))
        elif original.count(URL) != 1 or OLD_URL in original:
            raise ValueError(f"Unexpected forum URL configuration: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Local copy of the exact approved crest PNG")
    args = parser.parse_args()
    crest = read_crest(args.source)
    save_crest(crest, "rhw-crest.png", 433, 540)
    save_crest(crest, "rhw-forum-logo.png", 320, 399)
    save_icon(crest, "favicon.png", 64, transparent=True)
    save_icon(crest, "apple-touch-icon.png", 180)
    save_icon(crest, "pwa-icon-192.png", 192)
    save_icon(crest, "pwa-icon-512.png", 512)
    save_icon(crest, "pwa-icon-maskable-512.png", 512, maskable=True)
    update_forum_url()
    print("Crest, forum preview and all five app icon sizes refreshed.")


if __name__ == "__main__":
    main()
