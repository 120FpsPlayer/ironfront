#!/usr/bin/env python3
"""Draws the badges Hammer Client puts in front of names in the player list (Tab): the big H of the logo, and H+ for
Hammer+. They are glyphs of the game font "hammerclient:badge" (assets/hammerclient/font/badge.json): 8 GUI pixels
tall like the player's head next to them, kept at 4× so they stay sharp on big GUI scales.

    python3 tools/gen_badges.py [preview.png]

Needs Pillow. The source is the shop's logo (../hammershop-bot/assets/brand/logo-h.png). The outputs are committed.
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(os.path.dirname(ROOT), 'hammershop-bot', 'assets', 'brand', 'logo-h.png')
OUT = os.path.join(ROOT, 'common/src/main/resources/assets/hammerclient/textures/font')
SCALE = 4  # texture pixels per GUI pixel
H = 8 * SCALE


def outlined(shape, fill, rim, width):
    """A flat shape (alpha mask) with a darker rim around it, like the logo's own edge."""
    grown = shape.filter(ImageFilter.MaxFilter(width * 2 + 1))
    out = Image.new('RGBA', shape.size, (0, 0, 0, 0))
    out.paste(Image.new('RGBA', shape.size, rim), (0, 0), grown)
    out.paste(Image.new('RGBA', shape.size, fill), (0, 0), shape)
    return out


def letter():
    """The H of the logo, cut to its outline and brought down to 8 GUI pixels."""
    logo = Image.open(LOGO).convert('RGBA')
    logo = logo.crop(logo.getbbox())
    w = round(logo.width * H / logo.height)
    small = logo.resize((w, H), Image.LANCZOS)
    # Half-transparent edge pixels would turn into a grey fringe in the game's font atlas: make the edge firm.
    r, g, b, a = small.split()
    a = a.point(lambda v: 0 if v < 96 else 255)
    return Image.merge('RGBA', (r, g, b, a))


def plus(size, arm):
    """The + of Hammer+: the logo's yellow with its dark-gold rim."""
    mask = Image.new('L', (size + 4, size + 4), 0)
    d = ImageDraw.Draw(mask)
    c = (size + 4) // 2
    d.rectangle([c - arm // 2, 2, c - arm // 2 + arm - 1, size + 1], fill=255)
    d.rectangle([2, c - arm // 2, size + 1, c - arm // 2 + arm - 1], fill=255)
    return outlined(mask, (255, 214, 10, 255), (148, 96, 0, 255), 1)


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name), optimize=True)
    print(name, img.size)


def main():
    h = letter()
    save(h, 'badge_h.png')
    p = plus(4 * SCALE - 2, 6)
    both = Image.new('RGBA', (h.width + p.width - 2, H), (0, 0, 0, 0))
    both.alpha_composite(h, (0, 0))
    both.alpha_composite(p, (h.width - 2, 0))
    save(both, 'badge_plus.png')

    if len(sys.argv) > 1:
        # How the game shows them: point-sampled at GUI scales 2, 3 and 4, with the drop shadow text gets.
        rows = []
        for gui in (2, 3, 4):
            row = Image.new('RGBA', (220, 12 * gui), (30, 30, 34, 255))
            x = 4 * gui
            for img in (h, both):
                size = (round(img.width * gui / SCALE), round(img.height * gui / SCALE))
                shown = img.resize(size, Image.NEAREST)
                shadow = Image.new('RGBA', size, (0, 0, 0, 0))
                dark = ImageChops.multiply(shown, Image.new('RGBA', size, (64, 64, 64, 255)))
                shadow.alpha_composite(dark)
                row.alpha_composite(shadow, (x + gui, 2 * gui + gui))
                row.alpha_composite(shown, (x, 2 * gui))
                ImageDraw.Draw(row).rectangle([x + size[0] + 3 * gui, 3 * gui, x + size[0] + 3 * gui + 22 * gui, 9 * gui], fill=(235, 235, 235, 255))
                x += size[0] + 32 * gui
            rows.append(row)
        sheet = Image.new('RGBA', (max(r.width for r in rows), sum(r.height for r in rows) + 8 * len(rows)), (18, 18, 20, 255))
        y = 4
        for r in rows:
            sheet.alpha_composite(r, (0, y))
            y += r.height + 8
        sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
        sheet.save(sys.argv[1])


if __name__ == '__main__':
    main()
