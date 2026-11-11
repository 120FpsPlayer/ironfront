#!/usr/bin/env python3
"""Draws the Hammer+ capes (the standard Minecraft cape layout, 8× the usual 64×32 so the logo stays sharp).

    python3 tools/gen_capes.py

Writes the textures and the list (id, Polish and English name) for the mod and for the launcher's cape picker:
    common/src/main/resources/assets/hammerclient/textures/capes/<id>.png + assets/hammerclient/capes.json
    ../hammer-launcher/src/renderer/assets/capes/<id>.png + capes.json
"""
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, 'common/src/main/resources/assets/hammerclient')
LAUNCHER = os.path.join(ROOT, '..', 'hammer-launcher', 'src', 'renderer', 'assets', 'capes')
LOGO = os.path.join(MOD, 'textures', 'logo.png')
S = 8  # pixels per texel of the 64×32 layout

# id: (Polish name, English name, top colour, bottom colour, logo tint or None = the logo's own gold, trim colour)
CAPES = {
    'hammer': ('Hammer', 'Hammer', (16, 13, 9), (34, 24, 10), None, (255, 196, 0)),
    'gold': ('Złota', 'Gold', (255, 214, 60), (224, 132, 0), (38, 22, 0), (70, 40, 0)),
    'ember': ('Żar', 'Ember', (20, 10, 6), (232, 96, 10), (255, 232, 170), (255, 150, 40)),
    'royal': ('Królewska', 'Royal', (44, 16, 92), (18, 8, 44), None, (255, 205, 70)),
    'frost': ('Mróz', 'Frost', (10, 26, 60), (60, 190, 235), (240, 250, 255), (190, 240, 255)),
    'crimson': ('Karmazyn', 'Crimson', (120, 10, 18), (16, 6, 8), None, (255, 196, 0)),
}


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w, h, top, bottom):
    im = Image.new('RGBA', (w, h))
    px = im.load()
    for y in range(h):
        c = lerp(top, bottom, y / max(1, h - 1))
        for x in range(w):
            px[x, y] = (*c, 255)
    return im


def logo(width, tint):
    src = Image.open(LOGO).convert('RGBA')
    box = src.getbbox()
    src = src.crop(box)
    h = round(src.height * width / src.width)
    src = src.resize((width, h), Image.LANCZOS)
    if tint is not None:
        solid = Image.new('RGBA', src.size, (*tint, 255))
        solid.putalpha(src.getchannel('A'))
        src = solid
    return src


def cape(cid):
    _, _, top, bottom, tint, trim = CAPES[cid]
    im = Image.new('RGBA', (64 * S, 32 * S), (0, 0, 0, 0))
    rnd = random.Random(cid)

    def paste(x, y, w, h, t0=0.0, t1=1.0):
        im.paste(gradient(w * S, h * S, lerp(top, bottom, t0), lerp(top, bottom, t1)), (x * S, y * S))

    paste(1, 0, 10, 1, 0, 0)        # top edge
    paste(11, 0, 10, 1, 1, 1)       # bottom edge
    paste(0, 1, 1, 16)              # right edge
    paste(11, 1, 1, 16)             # left edge
    paste(1, 1, 10, 16)             # outside – what others see from behind
    inner = gradient(10 * S, 16 * S, lerp(top, (0, 0, 0), 0.35), lerp(bottom, (0, 0, 0), 0.45))
    im.paste(inner, (12 * S, 1 * S))  # inside
    paste(22, 0, 24, 22)            # elytra wings use this part of the cape texture

    d = ImageDraw.Draw(im)
    x0, y0, w, h = 1 * S, 1 * S, 10 * S, 16 * S
    # a few sparks in the cape's trim colour
    for _ in range(26):
        sx, sy = x0 + rnd.randrange(4, w - 4), y0 + rnd.randrange(h // 2, h - 6)
        d.point((sx, sy), fill=(*trim, rnd.randrange(90, 200)))
    # trim: a frame and a double bar at the bottom
    d.rectangle((x0 + 2, y0 + 2, x0 + w - 3, y0 + h - 3), outline=(*trim, 255), width=2)
    d.rectangle((x0 + 8, y0 + h - 16, x0 + w - 9, y0 + h - 14), fill=(*trim, 255))
    d.rectangle((x0 + 14, y0 + h - 11, x0 + w - 15, y0 + h - 10), fill=(*trim, 200))
    # the logo, with a soft glow behind it
    mark = logo(w - 22, tint)
    glow = Image.new('RGBA', im.size, (0, 0, 0, 0))
    gx, gy = x0 + (w - mark.width) // 2, y0 + 16
    halo = Image.new('RGBA', mark.size, (*trim, 150))
    halo.putalpha(mark.getchannel('A').point(lambda a: a * 150 // 255))
    glow.paste(halo, (gx, gy), halo)
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(5)))
    im.alpha_composite(mark, (gx, gy))
    # elytra: the same frame so wings match the cape
    ex, ey, ew, eh = 22 * S, 0, 24 * S, 22 * S
    d.rectangle((ex + 2, ey + 2, ex + ew - 3, ey + eh - 3), outline=(*trim, 255), width=2)
    return im


def main():
    listing = [{'id': cid, 'name': CAPES[cid][0], 'nameEn': CAPES[cid][1]} for cid in CAPES]
    for out, index in ((os.path.join(MOD, 'textures', 'capes'), os.path.join(MOD, 'capes.json')), (LAUNCHER, os.path.join(LAUNCHER, 'capes.json'))):
        os.makedirs(out, exist_ok=True)
        for cid in CAPES:
            cape(cid).save(os.path.join(out, cid + '.png'), optimize=True)
        with open(index, 'w', encoding='utf-8') as f:
            json.dump(listing, f, ensure_ascii=False, indent=2)
            f.write('\n')
    print(f'{len(CAPES)} capes → mod and launcher')


if __name__ == '__main__':
    main()
