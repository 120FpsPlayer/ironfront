#!/usr/bin/env python3
"""Generates Hammer Client's UI textures: smooth font atlases (Montserrat) with metrics and the ui.png sprite sheet.

    python3 tools/gen_assets.py

Needs Pillow with FreeType. The outputs are committed, so this only runs when the fonts or sprites change.
"""
import json
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'common/src/main/resources/assets/hammerclient')
TEX = os.path.join(OUT, 'textures')
FONT_DIR = os.path.join(OUT, 'font')

CHARS = ''.join(chr(c) for c in range(32, 127)) + 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż' + '„”‚’“–—…•·×°±€«»¿¡§' + 'ÄÖÜäöüßÉÈÊéèêÀÁáàÍíÚúÑñÇç' + '←→↑↓✓✕'
FONTS = [
    ('medium', 'Montserrat_500Medium.ttf', [18, 36]),
    ('bold', 'Montserrat_700Bold.ttf', [18, 36, 72]),
]
PAD = 2


def render(font, ch):
    x0, y0, x1, y1 = font.getbbox(ch)
    img = Image.new('L', (max(1, x1 - x0) + 2, max(1, y1 - y0) + 2), 0)
    ImageDraw.Draw(img).text((1 - x0, 1 - y0), ch, font=font, fill=255)
    return img


def has_glyph(font, ch):
    # A missing glyph renders as the .notdef box; compare with a certainly-missing code point.
    if ch == ' ':
        return True
    img = render(font, ch)
    missing = render(font, '\uffff')
    return img.getbbox() is not None and not (img.size == missing.size and img.tobytes() == missing.tobytes())


def font_atlas(name, file, size):
    font = ImageFont.truetype(os.path.join(ROOT, 'tools/fonts', file), size)
    ascent, descent = font.getmetrics()
    glyphs = []
    for ch in CHARS:
        if size >= 72 and not (ch.isalnum() or ch in ' .,!?-–:'):
            continue  # the big atlas is for titles only
        if not has_glyph(font, ch):
            continue
        x0, y0, x1, y1 = font.getbbox(ch)
        w, h = max(0, x1 - x0), max(0, y1 - y0)
        img = None
        if w and h:
            img = Image.new('L', (w + 2, h + 2), 0)
            ImageDraw.Draw(img).text((1 - x0, 1 - y0), ch, font=font, fill=255)
        glyphs.append((ch, img, x0 - 1, y0 - 1, font.getlength(ch)))
    # Shelf packing, tallest first.
    width = 512 if size <= 36 else 1024
    order = sorted([g for g in glyphs if g[1] is not None], key=lambda g: -g[1].height)
    x = y = PAD
    row = 0
    pos = {}
    for ch, img, *_ in order:
        if x + img.width + PAD > width:
            x, y, row = PAD, y + row + PAD, 0
        pos[ch] = (x, y)
        x += img.width + PAD
        row = max(row, img.height)
    height = 1
    while height < y + row + PAD:
        height *= 2
    alpha = Image.new('L', (width, height), 0)
    meta = {}
    for ch, img, xoff, yoff, adv in glyphs:
        if img is None:
            meta[str(ord(ch))] = [0, 0, 0, 0, 0, 0, round(adv, 2)]
            continue
        px, py = pos[ch]
        alpha.paste(img, (px, py))
        meta[str(ord(ch))] = [px, py, img.width, img.height, xoff, yoff, round(adv, 2)]
    atlas = Image.new('RGBA', (width, height), (255, 255, 255, 0))
    atlas.putalpha(alpha)
    base = f'{name}_{size}'
    atlas.save(os.path.join(TEX, 'font', base + '.png'), optimize=True)
    write_mcmeta(os.path.join(TEX, 'font', base + '.png'))
    with open(os.path.join(FONT_DIR, base + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'size': size, 'ascent': ascent, 'descent': descent, 'texW': width, 'texH': height, 'glyphs': meta}, f, separators=(',', ':'))
    print(f'font {base}: {len(meta)} glyphs, {width}x{height}')


def write_mcmeta(png):
    # blur = linear filtering, so sprites and glyphs scale smoothly.
    with open(png + '.mcmeta', 'w') as f:
        json.dump({'texture': {'blur': True, 'clamp': True}}, f)


def ui_sheet():
    """ui.png 256x256 (white + alpha, tinted when drawn):
       circle  (0,0)   64x64   disc, radius 32 – rounded corners, knobs, dots
       shadow  (64,0)  96x96   soft shadow, 9-slice with 40 px corners
       glow    (160,0) 96x96   radial glow
       fade    (0,64)  64x16   horizontal fade, opaque left → transparent right
       hue     (0,80)  64x16   hue spectrum (coloured, draw untinted)
       ring    (0,96)  64x64   circle outline, 5 px
       check   (64,96) 64x64   check mark
       fadeR   (128,96) 64x16  horizontal fade, transparent left → opaque right
    """
    S = 4  # supersampling
    sheet = Image.new('RGBA', (256, 256), (255, 255, 255, 0))

    def aa(size, draw_fn):
        big = Image.new('L', (size[0] * S, size[1] * S), 0)
        draw_fn(ImageDraw.Draw(big), S)
        return big.resize(size, Image.LANCZOS)

    def put(alpha, xy):
        tile = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
        tile.putalpha(alpha)
        sheet.paste(tile, xy)

    put(aa((64, 64), lambda d, s: d.ellipse([0, 0, 64 * s - 1, 64 * s - 1], fill=255)), (0, 0))

    shadow = Image.new('L', (96, 96), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([24, 24, 71, 71], radius=10, fill=255)
    put(shadow.filter(ImageFilter.GaussianBlur(11)), (64, 0))

    glow = Image.new('L', (96, 96), 0)
    for yy in range(96):
        for xx in range(96):
            d = math.hypot(xx - 47.5, yy - 47.5) / 48
            glow.putpixel((xx, yy), int(255 * max(0.0, 1 - d) ** 2))
    put(glow, (160, 0))

    fade = Image.new('L', (64, 16), 0)
    for xx in range(64):
        for yy in range(16):
            fade.putpixel((xx, yy), int(255 * (1 - xx / 63)))
    put(fade, (0, 64))

    put(fade.transpose(Image.FLIP_LEFT_RIGHT), (128, 96))  # fade, transparent left → opaque right

    hue = Image.new('RGBA', (64, 16))
    for xx in range(64):
        import colorsys
        r, g, b = colorsys.hsv_to_rgb(xx / 63, 1, 1)
        for yy in range(16):
            hue.putpixel((xx, yy), (int(r * 255), int(g * 255), int(b * 255), 255))
    sheet.paste(hue, (0, 80))

    put(aa((64, 64), lambda d, s: d.ellipse([3 * s, 3 * s, 61 * s - 1, 61 * s - 1], outline=255, width=5 * s)), (0, 96))
    put(aa((64, 64), lambda d, s: d.line([(14 * s, 34 * s), (27 * s, 46 * s), (50 * s, 19 * s)], fill=255, width=8 * s, joint='curve')), (64, 96))

    sheet.save(os.path.join(TEX, 'ui.png'), optimize=True)
    write_mcmeta(os.path.join(TEX, 'ui.png'))
    print('ui.png')


if __name__ == '__main__':
    os.makedirs(os.path.join(TEX, 'font'), exist_ok=True)
    os.makedirs(FONT_DIR, exist_ok=True)
    for name, file, sizes in FONTS:
        for size in sizes:
            font_atlas(name, file, size)
    ui_sheet()
