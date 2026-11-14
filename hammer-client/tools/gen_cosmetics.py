#!/usr/bin/env python3
"""Draws the moving Hammer+ capes and the cosmetics Hammer Client puts on players (wings, a halo, hats).

    python3 tools/gen_cosmetics.py

Moving capes are vertical strips: FRAMES pictures of the standard cape layout (64×32 at 4×, so 256×128 each), one
under the other, the first one at the top, played FPS frames per second in a loop. The mod cuts a strip into one
texture per frame; the launcher shows the same strip frame by frame. Both learn frames and fps from the cape lists
(capes.json, written by gen_capes.py – this script runs it at the end).
    common/src/main/resources/assets/hammerclient/textures/capes/<id>.png     (mod)
    ../hammer-launcher/src/renderer/assets/capes/<id>.png                      (launcher)

Cosmetics are a few boxes on the head or the body, built the way Minecraft builds its models: the six faces of a
box come from one unfolded area of the texture (top and bottom in the first row, then right, front, left and back
side by side). This script places those areas in the texture, paints them and writes where they are:
    common/src/main/resources/assets/hammerclient/cosmetics.json               (boxes, textures, animations)
    common/src/main/resources/assets/hammerclient/textures/cosmetics/<id>.png
The launcher gets flat pictures of the same things for its tiles and its skin preview (front and back view, placed in
skin pixels: the head is x 4–12, y 0–8, the figure is 16×32):
    ../hammer-launcher/src/renderer/assets/cosmetics/cosmetics.json + <id>-front.png / <id>-back.png
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, 'common/src/main/resources/assets/hammerclient')
LAUNCHER = os.path.join(ROOT, '..', 'hammer-launcher', 'src', 'renderer', 'assets')
LOGO = os.path.join(MOD, 'textures', 'logo.png')

# ───────────────────────────── moving capes ─────────────────────────────
S = 4  # pixels per texel of the 64×32 cape layout
FRAMES = 16
FPS = 10
# id: (Polish name, English name, the still cape older Hammer Clients show instead)
ANIMATED = {
    'flame': ('Płomień', 'Flame', 'ember'),
    'sparks': ('Iskry', 'Sparks', 'royal'),
    'waves': ('Fale', 'Waves', 'frost'),
}


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


class Noise:
    """Value noise that repeats every `px` × `py` cells – so a picture made from it moves in a seamless loop."""

    def __init__(self, seed, px, py):
        rnd = random.Random(seed)
        self.px, self.py = px, py
        self.v = [[rnd.random() for _ in range(px)] for _ in range(py)]

    def at(self, x, y):
        x0, y0 = math.floor(x), math.floor(y)
        fx, fy = x - x0, y - y0
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        v = self.v
        a = v[y0 % self.py][x0 % self.px]
        b = v[y0 % self.py][(x0 + 1) % self.px]
        c = v[(y0 + 1) % self.py][x0 % self.px]
        d = v[(y0 + 1) % self.py][(x0 + 1) % self.px]
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy


def palette(stops, t):
    """A colour from a list of (position, rgb) stops – picked, not blended, so it stays pixel art."""
    t = clamp01(t)
    best = stops[0][1]
    for pos, col in stops:
        if t >= pos:
            best = col
    return best


def logo_mark(width, tint):
    src = Image.open(LOGO).convert('RGBA')
    src = src.crop(src.getbbox())
    h = round(src.height * width / src.width)
    src = src.resize((width, h), Image.LANCZOS)
    # pixel art: hard edges
    a = src.getchannel('A').point(lambda v: 255 if v > 110 else 0)
    solid = Image.new('RGBA', src.size, (*tint, 255))
    solid.putalpha(a)
    return solid


def outline(mark, color):
    """The mark with a one-pixel outline around it."""
    w, h = mark.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    a = mark.getchannel('A')
    ring = Image.new('RGBA', mark.size, (*color, 255))
    ring.putalpha(a)
    for dx, dy in ((0, 1), (2, 1), (1, 0), (1, 2)):
        out.alpha_composite(ring, (dx, dy))
    out.alpha_composite(mark, (1, 1))
    return out


class Flame:
    """Fire licking up the cape: tongues of flame sway and rise from the bottom edge, embers fly up past the logo."""
    stops = [(0.0, None), (0.36, (82, 16, 6)), (0.46, (150, 30, 8)), (0.56, (212, 66, 12)), (0.66, (244, 122, 24)), (0.77, (255, 178, 54)), (0.88, (255, 226, 122)), (0.97, (255, 248, 214))]

    def __init__(self):
        self.n1 = Noise('flame-1', 8, 8)
        self.n2 = Noise('flame-2', 16, 16)
        rnd = random.Random('flame-embers')
        self.embers = [(rnd.random(), rnd.random(), 1 + rnd.randrange(2)) for _ in range(12)]
        self.mark = outline(logo_mark(16, (255, 214, 140)), (120, 28, 6))

    def back(self, y, h):
        return lerp((22, 9, 7), (52, 15, 6), y / h)

    def heat(self, x, y, w, h, t, base):
        """0…1+: how hot this spot is – the colour comes from the stops."""
        cx, cy = x / w, y / h
        loop = 2 * math.pi * t
        # tongues: columns of fire that sway; between them the flames are lower
        sway = math.sin(loop + cx * 4.0) * 0.06 + math.sin(loop * 2 + cx * 9.0) * 0.025
        tongue = 0.5 + 0.5 * math.sin((cx + sway) * 2 * math.pi * 2.5)
        # noise in tall cells rising one period per loop (seamless), finer noise on top
        n = 0.7 * self.n1.at(x / 5.0, y / 9.0 + t * 8) + 0.3 * self.n2.at(x / 2.5, y / 4.5 + t * 16)
        return (cy * 0.86 - 0.47 + tongue * 0.24 + (n - 0.5) * 0.62) * base + 0.42

    def paint(self, im, x0, y0, w, h, t, base=1.0, logo=True):
        px = im.load()
        for y in range(0, h, 2):  # two by two pixels: chunky like the game's own fire
            for x in range(0, w, 2):
                c = palette(self.stops, self.heat(x + 1, y + 1, w, h, t, base)) or self.back(y, h)
                for dy in (0, 1):
                    for dx in (0, 1):
                        if x + dx < w and y + dy < h:
                            px[x0 + x + dx, y0 + y + dy] = (*c, 255)
        # embers drifting up and flickering
        for ex, phase, speed in self.embers:
            p = (t * speed + phase) % 1.0
            x = int(ex * (w - 2) + math.sin((p * speed + ex) * 6.28) * 2)
            y = int(h * 0.75 - p * h * 0.7)
            if 0 <= x < w - 1 and 0 <= y < h:
                glow = (255, 236, 160) if int(p * 32) % 4 else (255, 150, 50)
                px[x0 + x, y0 + y] = (*glow, 255)
                if p < 0.6:
                    px[x0 + x + 1, y0 + y] = (*glow, 255)
        if logo:
            gx = x0 + (w - self.mark.width) // 2
            im.alpha_composite(self.mark, (gx, y0 + 7))


class Sparks:
    """A night-sky cape full of twinkling stars and sparkles drifting up."""

    def __init__(self):
        rnd = random.Random('sparks')
        spots = [(rnd.randrange(3, 37), rnd.randrange(3, 61)) for _ in range(60)]
        spots = [(x, y) for x, y in spots if not (y < 21 and 9 < x < 31)][:22]  # none over the logo
        self.stars = [(x, y, rnd.random(), rnd.choice([(255, 255, 255), (255, 226, 140), (170, 230, 255), (255, 190, 250)])) for x, y in spots]
        self.dust = [(rnd.random(), rnd.random(), rnd.choice([1, 2])) for _ in range(18)]
        self.n = Noise('sparks-sky', 8, 12)
        self.mark = outline(logo_mark(14, (255, 230, 160)), (60, 24, 110))

    def back(self, x, y, w, h):
        g = int(y / h * 7) / 6  # in bands, like pixel art
        neb = self.n.at(x / 6, y / 6)
        base = lerp((12, 10, 44), (52, 16, 84), g)
        if neb > 0.62:
            base = lerp(base, (110, 40, 150), 0.35)
        elif neb > 0.52:
            base = lerp(base, (80, 30, 130), 0.25)
        return base

    def star(self, px, x0, y0, w, h, sx, sy, size, col):
        def put(x, y, c):
            if 0 <= x < w and 0 <= y < h:
                px[x0 + x, y0 + y] = (*c, 255)
        dim = lerp(col, (40, 30, 90), 0.55)
        if size <= 0:
            put(sx, sy, dim)
            return
        put(sx, sy, (255, 255, 255))
        for d in range(1, size + 1):
            c = col if d < size else dim
            for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
                put(sx + dx, sy + dy, c)
        if size >= 2:
            for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
                put(sx + dx, sy + dy, dim)

    def paint(self, im, x0, y0, w, h, t, base=1.0, logo=True):
        px = im.load()
        for y in range(h):
            for x in range(w):
                px[x0 + x, y0 + y] = (*self.back(x * 40 / w, y * 64 / h, 40, 64), 255)
        for dx, phase, size in self.dust:
            p = (t + phase) % 1.0
            x = int(dx * (w - 1))
            y = int((1 - p) * (h - 1))
            c = lerp((255, 220, 255), (90, 60, 160), abs(p - 0.5) * 2)
            if size == 2 and x + 1 < w:
                px[x0 + x + 1, y0 + y] = (*c, 255)
            px[x0 + x, y0 + y] = (*c, 255)
        for sx, sy, phase, col in self.stars:
            sx, sy = int(sx * w / 40), int(sy * h / 64)
            # each star grows to a sparkle and shrinks back once per loop, at its own moment
            p = (t + phase) % 1.0
            size = (0, 0, 1, 2, 3, 2, 1, 0)[int(p * 8)] if base >= 1 else (0, 1, 1, 0)[int(p * 4)]
            self.star(px, x0, y0, w, h, sx, sy, size, col)
        if logo:
            gx = x0 + (w - self.mark.width) // 2
            im.alpha_composite(self.mark, (gx, y0 + 6))


class Waves:
    """The sea: rounded waves with white crests roll across the cape (each row the other way), under a bright sky."""
    sky = [(0, (132, 216, 242)), (5, (104, 200, 236)), (8, (80, 184, 228))]
    water = [(52, 170, 212), (34, 136, 192), (24, 106, 168), (16, 80, 142), (10, 56, 112), (6, 36, 84)]

    def __init__(self):
        self.mark = outline(logo_mark(14, (255, 255, 255)), (16, 90, 140))
        rnd = random.Random('waves')
        # rows of waves, in cells of two pixels: (top row, phase, wave length, height, direction)
        self.bands = [(10.5 + i * 4.6, rnd.random() * 6.28, 8 + rnd.random() * 5, 1.1 + rnd.random() * 0.6, 1 if i % 2 else -1) for i in range(5)]

    def paint(self, im, x0, y0, w, h, t, base=1.0, logo=True):
        px = im.load()
        cw, ch = w // 2, h // 2  # cells
        k = ch / 32
        cells = [[None] * cw for _ in range(ch)]
        for cy in range(ch):
            c = self.sky[0][1]
            for pos, col in self.sky:
                if cy / k >= pos:
                    c = col
            for cx in range(cw):
                cells[cy][cx] = c
        for i, (top, ph, lam, amp, direction) in enumerate(self.bands):
            for cx in range(cw):
                xx = cx / k
                # a rounded wave: the crest is the top of a sine raised to a power, moving one wave length per loop
                s1 = 0.5 + 0.5 * math.sin(2 * math.pi * (xx / lam + direction * t) + ph)
                crest = top - amp * (s1 ** 2) * 1.6 + 0.4 * math.sin(2 * math.pi * (xx / (lam * 0.5) - direction * t * 2) + ph)
                row = int(round(crest * k))
                for cy in range(max(0, row), ch):
                    cells[cy][cx] = self.water[min(i, len(self.water) - 1)]
                if 0 <= row < ch:
                    band = self.water[min(i, len(self.water) - 1)]
                    # white caps on the tops of the waves, a lighter edge everywhere else
                    cells[row][cx] = (238, 252, 255) if s1 > 0.5 else lerp(band, (255, 255, 255), 0.35)
                    if row + 1 < ch and s1 > 0.8:
                        cells[row + 1][cx] = (184, 236, 252)
        for cy in range(ch):
            for cx in range(cw):
                c = cells[cy][cx]
                for dy in (0, 1):
                    for dx in (0, 1):
                        px[x0 + cx * 2 + dx, y0 + cy * 2 + dy] = (*c, 255)
        if logo:
            gx = x0 + (w - self.mark.width) // 2
            im.alpha_composite(self.mark, (gx, y0 + 3))


EFFECTS = {'flame': Flame, 'sparks': Sparks, 'waves': Waves}
TRIM = {'flame': (255, 150, 40), 'sparks': (255, 214, 110), 'waves': (226, 250, 255)}


def darker(im, box, amount):
    region = im.crop(box)
    shade = Image.new('RGBA', region.size, (0, 0, 0, round(255 * amount)))
    region.alpha_composite(shade)
    im.paste(region, box[:2])


def cape_frame(cid, effect, t):
    im = Image.new('RGBA', (64 * S, 32 * S), (0, 0, 0, 0))
    trim = TRIM[cid]
    # outside – what others see from behind
    effect.paint(im, 1 * S, 1 * S, 10 * S, 16 * S, t)
    d = ImageDraw.Draw(im)
    d.rectangle((1 * S, 1 * S, 11 * S - 1, 17 * S - 1), outline=(*trim, 255), width=1)
    # inside, the edges and the elytra (which use the cape texture) – the same effect, quieter
    effect.paint(im, 12 * S, 1 * S, 10 * S, 16 * S, t, base=0.8, logo=False)
    darker(im, (12 * S, 1 * S, 22 * S, 17 * S), 0.35)
    effect.paint(im, 22 * S, 0, 24 * S, 22 * S, t, base=0.9, logo=False)
    d.rectangle((22 * S, 0, 46 * S - 1, 22 * S - 1), outline=(*trim, 255), width=1)
    for box in ((1, 0, 11, 1), (11, 0, 21, 1), (0, 1, 1, 17), (11, 1, 12, 17)):
        d.rectangle((box[0] * S, box[1] * S, box[2] * S - 1, box[3] * S - 1), fill=(*lerp(trim, (0, 0, 0), 0.45), 255))
    return im


def save_small(im, path):
    """Pixel art with few colours: saved with a palette (4× smaller files, the same picture)."""
    if len(im.getcolors(1 << 16) or ()) > 256 or not im.getcolors(1 << 16):
        im = im.quantize(256, method=Image.Quantize.FASTOCTREE).convert('RGBA')
    colours = im.getcolors(256)
    pal = Image.new('P', im.size)
    lookup = {c: i for i, (_, c) in enumerate(colours)}
    pal.putpalette([v for _, c in colours for v in c[:3]] + [0] * (768 - 3 * len(colours)))
    pixels = im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata()
    pal.putdata([lookup[c] for c in pixels])
    alpha = bytes(c[3] for _, c in colours)
    pal.save(path, optimize=True, transparency=alpha)


def cape_strip(cid):
    effect = EFFECTS[cid]()
    strip = Image.new('RGBA', (64 * S, 32 * S * FRAMES), (0, 0, 0, 0))
    for f in range(FRAMES):
        strip.paste(cape_frame(cid, effect, f / FRAMES), (0, f * 32 * S))
    return strip


# ───────────────────────────── cosmetics ─────────────────────────────
# Boxes: origin and size in model pixels (the head is x −4…4, y −8…0, z −4…4 around the neck; the body is x −4…4,
# y 0…12, z −2…2; −z is the front, y grows downwards), `inflate` makes a box bigger without changing its texture
# (like the second skin layer), `mirror` flips its texture (the right wing uses the left one's), `tex` names a texture
# area several boxes share. A part hangs on a bone ("head" / "body") at `pivot`, turned by `rot` (degrees, applied
# z, then y, then x – like Minecraft), scaled by `scale`, and moved by its animation:
#   flapL / flapR – a wing: open a little and beating slowly, wide open and beating fast while flying or falling
#   bob           – floats up and down
# `density` = texture pixels per model pixel. `glow`: drawn at full brightness, see-through where the texture is.

def box(origin, size, tex=None, inflate=0.0, mirror=False):
    return {'origin': list(origin), 'size': list(size), 'tex': tex, 'inflate': inflate, 'mirror': mirror}


def wing_parts(width=16, height=20, top=-5):
    return [
        {'bone': 'body', 'pivot': [1.0, 2.5, 3.2], 'anim': 'flapL', 'boxes': [box((0, top, 0), (width, height, 0), 'wing')]},
        {'bone': 'body', 'pivot': [-1.0, 2.5, 3.2], 'anim': 'flapR', 'boxes': [box((-width, top, 0), (width, height, 0), 'wing', mirror=True)]},
    ]


HALO_Y = -12.5
HALO_R = 4.2
HALO_SEG = 0.5


def halo_parts():
    parts = []
    n = 12
    seg = 2 * math.pi * HALO_R / n / HALO_SEG + 0.6  # a little longer than the gap, so the ring is closed
    for i in range(n):
        parts.append({'bone': 'head', 'pivot': [0, HALO_Y, 0], 'rot': [0, i * 360 / n, 0], 'scale': HALO_SEG, 'anim': 'bob',
                      'boxes': [box((-seg / 2, -1, HALO_R / HALO_SEG - 1), (round(seg), 2, 2), 'ring')]})
    parts.append({'bone': 'head', 'pivot': [0, HALO_Y, 0], 'scale': 0.8, 'anim': 'bob', 'boxes': [box((-8, 0.25, -8), (16, 0, 16), 'glow')]})
    return parts


ITEMS = {
    'angel': {'slot': 'wings', 'name': 'Anielskie', 'nameEn': 'Angel', 'density': 2, 'parts': wing_parts()},
    'dragon': {'slot': 'wings', 'name': 'Smocze', 'nameEn': 'Dragon', 'density': 2, 'parts': wing_parts(16, 20, -6)},
    'halo': {'slot': 'halo', 'name': 'Aureola', 'nameEn': 'Halo', 'density': 1, 'glow': True, 'parts': halo_parts()},
    'crown': {'slot': 'hat', 'name': 'Korona', 'nameEn': 'Crown', 'density': 1, 'parts': [
        {'bone': 'head', 'pivot': [0, 0, 0], 'boxes': [box((-4, -10.5, -4), (8, 3, 8), 'band', inflate=0.62)]
         + [box((x - 0.5, -13.6, z - 0.5), (1, 3, 1), 'spike', inflate=0.12) for x, z in ((-4.1, -4.1), (0, -4.1), (4.1, -4.1), (4.1, 0), (4.1, 4.1), (0, 4.1), (-4.1, 4.1), (-4.1, 0))]},
    ]},
    'tophat': {'slot': 'hat', 'name': 'Cylinder', 'nameEn': 'Top hat', 'density': 1, 'parts': [
        {'bone': 'head', 'pivot': [0, 0, 0], 'boxes': [
            box((-6, -9.6, -6), (12, 1, 12), 'brim'),
            box((-3.5, -15.6, -3.5), (7, 6, 7), 'crown'),
            box((-3.5, -11.6, -3.5), (7, 2, 7), 'ribbon', inflate=0.12),
        ]},
    ]},
    'santa': {'slot': 'hat', 'name': 'Czapka Mikołaja', 'nameEn': 'Santa hat', 'density': 1, 'parts': [
        {'bone': 'head', 'pivot': [0, 0, 0], 'boxes': [
            box((-4.5, -10, -4.5), (9, 2, 9), 'fur', inflate=0.2),
            box((-4, -13, -4), (8, 3, 8), 'cone1'),
            box((-3, -15, -2.5), (6, 2, 6), 'cone2'),
            box((-2, -16, -0.5), (4, 2, 4), 'cone3'),
            box((-1.5, -15.5, 3), (3, 2, 3), 'tip'),
            box((-1.5, -14.5, 5), (3, 3, 3), 'pompom'),
        ]},
    ]},
}


def unfold(size, density):
    """The unfolded area of a box in texture pixels: (width, height) – Minecraft's layout."""
    w, h, d = size
    return math.ceil((2 * d + 2 * w) * density), math.ceil((d + h) * density)


def faces(u, v, size, density):
    """Where each face of a box sits in the texture: name → (x0, y0, x1, y1) in texture pixels."""
    w, h, d = size
    k = density
    return {
        'top': (u + d * k, v, u + (d + w) * k, v + d * k),
        'bottom': (u + (d + w) * k, v, u + (d + 2 * w) * k, v + d * k),
        'right': (u, v + d * k, u + d * k, v + (d + h) * k),
        'front': (u + d * k, v + d * k, u + (d + w) * k, v + (d + h) * k),
        'left': (u + (d + w) * k, v + d * k, u + (2 * d + w) * k, v + (d + h) * k),
        'back': (u + (2 * d + w) * k, v + d * k, u + (2 * d + 2 * w) * k, v + (d + h) * k),
    }


def pack(item):
    """Places the texture areas of an item's boxes (shelves, 64 pixels wide or more); returns (areas, width, height)."""
    areas, sizes = {}, {}
    for part in item['parts']:
        for b in part['boxes']:
            key = b['tex']
            if key not in sizes:
                sizes[key] = (unfold(b['size'], item['density']), b['size'])
    width = 64
    while width < max(w for (w, _), _ in sizes.values()):
        width *= 2
    x = y = row = 0
    for key, ((w, h), size) in sorted(sizes.items(), key=lambda kv: -kv[1][0][1]):
        if x + w > width:
            x, y, row = 0, y + row + 1, 0
        areas[key] = {'uv': (x, y), 'size': size}
        x += w + 1
        row = max(row, h)
    height = 32
    while height < y + row:
        height *= 2
    return areas, width, height


def shade(c, k):
    return tuple(max(0, min(255, round(v * k))) for v in c[:3])


def fill_face(px, rect, fn):
    x0, y0, x1, y1 = (round(v) for v in rect)
    for y in range(y0, y1):
        for x in range(x0, x1):
            c = fn(x - x0, y - y0, x1 - x0, y1 - y0)
            if c is not None:
                px[x, y] = c if len(c) == 4 else (*c, 255)


def paint_box(px, area, density, fns):
    """Paints the six faces of a box; fns: face name (or 'side' for the four sides, 'all') → fn(x, y, w, h) → rgb(a)."""
    rects = faces(*area['uv'], area['size'], density)
    for name, rect in rects.items():
        fn = fns.get(name) or (fns.get('side') if name in ('right', 'front', 'left', 'back') else None) or fns.get('all')
        if fn:
            fill_face(px, rect, fn)


def wing_shape(kind, w, h):
    """A wing as seen from behind with its root on the left: feathers (angel) or a bat-like membrane (dragon)."""
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    X = lambda f: f * (w - 1)  # noqa: E731 – fractions of the picture
    Y = lambda f: f * (h - 1)  # noqa: E731
    if kind == 'angel':
        white, light, mid, shadow, line = (255, 255, 255), (240, 244, 252), (214, 222, 238), (178, 190, 214), (140, 152, 184)
        # long flight feathers, from the tip inwards so the inner ones lie on top; they get longer towards the tip
        n = 9
        for i in range(n - 1, -1, -1):
            f = i / (n - 1)
            x = X(0.06 + f * 0.8)
            top = Y(0.22 - f * 0.08)
            bottom = Y(0.55 + f * 0.43)
            lean = 1.5 + f * 2.5  # tips lean outwards
            col = white if i % 2 else light
            d.polygon([(x - 2.2, top), (x + 2.2, top), (x + 2.4 + lean, bottom - 3), (x + 1 + lean, bottom), (x - 1.6 + lean * 0.6, bottom - 3)], fill=(*col, 255), outline=(*line, 255))
            d.line([(x, top + 2), (x + lean * 0.7, bottom - 3)], fill=(*shadow, 255))
        # the arm of the wing: rises from the root to the wrist, then falls to the tip – covered in small feathers
        arm = [(0, Y(0.3)), (X(0.25), Y(0.1)), (X(0.6), 0), (X(0.82), Y(0.03)), (w - 1, Y(0.12)), (X(0.86), Y(0.3)), (X(0.5), Y(0.34)), (X(0.2), Y(0.42)), (0, Y(0.48))]
        d.polygon(arm, fill=(*mid, 255))
        for row in range(3):
            for j in range(9 - row * 2):
                x = X(0.03 + j * 0.105 + row * 0.06)
                y = Y(0.1 + row * 0.1) + abs(j - 5) * 0.6 - (j * 0.5 if row == 0 else 0)
                d.ellipse((x, y, x + 4, y + 3.2), fill=(*(white if (j + row) % 2 else light), 255), outline=(*shadow, 255))
        d.line([(0, Y(0.3)), (X(0.25), Y(0.1)), (X(0.6), 0), (X(0.82), Y(0.03)), (w - 1, Y(0.12))], fill=(*line, 255))
    else:
        bone, bone_light = (58, 40, 48), (96, 70, 80)
        skin_light, skin, skin_dark = (124, 58, 80), (86, 36, 58), (54, 20, 38)
        claw = (226, 216, 196)
        root, elbow, tip = (0, Y(0.2)), (X(0.55), 0), (w - 1, Y(0.1))
        # finger tips along the bottom, scalloped membrane between them
        fingers = [(X(0.1), Y(0.78)), (X(0.32), Y(0.98)), (X(0.55), Y(0.94)), (X(0.78), Y(0.8)), (w - 1, Y(0.55))]
        pts = [root, elbow, tip] + list(reversed(fingers)) + [(0, Y(0.55))]
        d.polygon(pts, fill=(*skin, 255))
        prev = (0, Y(0.55))
        for f in fingers:
            mid = ((prev[0] + f[0]) / 2, (prev[1] + f[1]) / 2 - Y(0.13))
            d.polygon([prev, mid, f], fill=(0, 0, 0, 0))
            d.line([prev, mid, f], fill=(*skin_dark, 255))
            prev = f
        # light from above on the upper membrane
        d.polygon([root, elbow, tip, (X(0.8), Y(0.2)), (X(0.4), Y(0.14)), (0, Y(0.3))], fill=(*skin_light, 255))
        # finger bones from the elbow, the arm along the top
        for f in fingers:
            d.line([elbow, f], fill=(*bone, 255), width=1)
        d.line([root, elbow, tip], fill=(*bone_light, 255), width=2)
        d.line([(0, Y(0.2) + 2), (elbow[0], 2)], fill=(*bone, 255))
        # claws on the elbow and the tip
        d.polygon([(elbow[0] - 1, 2), (elbow[0] + 2, 2), (elbow[0] + 1, -1)], fill=(*claw, 255))
        d.polygon([(w - 3, Y(0.1)), (w - 1, Y(0.1) - 1), (w - 1, Y(0.1) + 2)], fill=(*claw, 255))
    return im


def paint_item(iid, item):
    areas, tw, th = pack(item)
    k = item['density']
    im = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    px = im.load()
    rnd = random.Random(iid)
    if item['slot'] == 'wings':
        a = areas['wing']
        w, h, _ = a['size']
        pic = wing_shape(iid, w * k, h * k)
        f = faces(*a['uv'], a['size'], k)
        im.alpha_composite(pic, (round(f['front'][0]), round(f['front'][1])))
        im.alpha_composite(pic.transpose(Image.FLIP_LEFT_RIGHT), (round(f['back'][0]), round(f['back'][1])))
    elif iid == 'halo':
        gold = [(255, 244, 170), (255, 222, 90), (240, 180, 40)]
        paint_box(px, areas['ring'], k, {'top': lambda x, y, w, h: gold[0], 'bottom': lambda x, y, w, h: gold[2],
                                          'all': lambda x, y, w, h: gold[1] if y == 0 else gold[2]})
        g = faces(*areas['glow']['uv'], areas['glow']['size'], k)
        for name in ('top', 'bottom'):
            x0, y0, x1, y1 = (round(v) for v in g[name])
            for y in range(y0, y1):
                for x in range(x0, x1):
                    dx, dy = x - (x0 + x1 - 1) / 2, y - (y0 + y1 - 1) / 2
                    r = math.hypot(dx, dy) / ((x1 - x0) / 2)
                    ring = 1 - abs(r - 0.66) / 0.3
                    if ring > 0:
                        alpha = (0, 40, 70, 100)[min(3, int(ring * 4))]
                        if alpha:
                            px[x, y] = (255, 226, 120, alpha)
    elif iid == 'crown':
        gold, gold_l, gold_d, velvet, velvet_d = (246, 196, 52), (255, 236, 130), (186, 128, 20), (170, 24, 40), (120, 14, 28)
        gems = [(220, 30, 50), (40, 120, 230), (40, 190, 90)]

        def band_side(x, y, w, h):
            if y == 0:
                return gold_l
            if y == h - 1:
                return gold_d
            if x % 4 == 2:
                return gems[(x // 4) % 3]
            return gold

        def velvet_top(x, y, w, h):
            edge = x == 0 or y == 0 or x == w - 1 or y == h - 1
            return gold_d if edge else (velvet if (x + y) % 3 else velvet_d)

        paint_box(px, areas['band'], k, {'side': band_side, 'top': velvet_top, 'bottom': lambda x, y, w, h: gold_d})
        paint_box(px, areas['spike'], k, {'top': lambda x, y, w, h: (255, 250, 220), 'side': lambda x, y, w, h: gold_l if y == 0 else gold if y == 1 else gold_d,
                                           'bottom': lambda x, y, w, h: gold_d})
    elif iid == 'tophat':
        black, black_l, black_d, red, red_l = (30, 28, 34), (58, 54, 66), (16, 14, 18), (176, 28, 36), (226, 70, 70)
        paint_box(px, areas['brim'], k, {'top': lambda x, y, w, h: black_l if (x in (0, w - 1) or y in (0, h - 1)) else black,
                                          'bottom': lambda x, y, w, h: black_d, 'side': lambda x, y, w, h: black_l})
        paint_box(px, areas['crown'], k, {'top': lambda x, y, w, h: black_l if (x in (0, w - 1) or y in (0, h - 1)) else black,
                                           'side': lambda x, y, w, h: black_l if x == 1 else black if x < w - 1 else black_d, 'bottom': lambda x, y, w, h: black_d})
        paint_box(px, areas['ribbon'], k, {'side': lambda x, y, w, h: red_l if y == 0 else red, 'top': lambda x, y, w, h: None,
                                            'bottom': lambda x, y, w, h: None})
        # a little golden buckle on the front of the ribbon
        fr = faces(*areas['ribbon']['uv'], areas['ribbon']['size'], k)['front']
        bx = round(fr[0]) + 3
        px[bx, round(fr[1])] = (255, 214, 90, 255)
        px[bx, round(fr[1]) + 1] = (210, 160, 40, 255)
    elif iid == 'santa':
        red, red_l, red_d = (204, 30, 38), (236, 70, 64), (150, 18, 28)
        white, white_d = (250, 250, 246), (214, 218, 226)

        def fur(x, y, w, h):
            return white if (x * 7 + y * 3 + rnd.randrange(3)) % 5 else white_d

        def cloth(x, y, w, h):
            return red_l if y == 0 and x % 3 == 0 else red_d if (x + y * 2) % 7 == 0 else red

        paint_box(px, areas['fur'], k, {'all': fur})
        for key in ('cone1', 'cone2', 'cone3', 'tip'):
            paint_box(px, areas[key], k, {'all': cloth, 'top': lambda x, y, w, h: red_l})
        paint_box(px, areas['pompom'], k, {'all': fur})
    return im, areas, tw, th


# ───────────── flat pictures for the launcher (skin pixels; PX picture pixels per skin pixel) ─────────────
PX = 4


def project_hat(item, tex, areas, view):
    """A hat seen straight from the front or from behind: the front (back) faces of its boxes, far ones first."""
    k = item['density']
    boxes = []
    for part in item['parts']:
        for b in part['boxes']:
            (ox, oy, oz), (w, h, d), g = b['origin'], b['size'], b['inflate']
            boxes.append((ox - g, oy - g, oz - g, ox + w + g, oy + h + g, oz + d + g, b))
    x0 = min(b[0] for b in boxes)
    x1 = max(b[3] for b in boxes)
    y0 = min(b[1] for b in boxes)
    y1 = max(b[4] for b in boxes)
    width, height = math.ceil((x1 - x0) * PX), math.ceil((y1 - y0) * PX)
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    # far faces first: seen from the front a box's face is at its smallest z, seen from behind at its largest
    order = sorted(boxes, key=lambda b: -b[2] if view == 'front' else b[5])
    for bx0, by0, bz0, bx1, by1, bz1, b in order:
        f = faces(*areas[b['tex']]['uv'], b['size'], k)['front' if view == 'front' else 'back']
        face = tex.crop(tuple(round(v) for v in f))
        if face.width == 0 or face.height == 0:
            continue
        w, h = round((bx1 - bx0) * PX), round((by1 - by0) * PX)
        face = face.resize((max(1, w), max(1, h)), Image.NEAREST)
        left = bx0 - x0 if view == 'front' else x1 - bx1  # seen from behind, left and right swap
        out.alpha_composite(face, (round(left * PX), round((by0 - y0) * PX)))
    # skin pixels of the figure: the head's x 0 is the figure's 8, its y 0 the figure's 8
    place = {'x': round(8 + (x0 if view == 'front' else -x1), 3), 'y': round(8 + y0, 3), 'w': round(x1 - x0, 3), 'h': round(y1 - y0, 3)}
    return out, place


def halo_picture():
    w, h = 11, 4
    out = Image.new('RGBA', (w * PX, h * PX), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    glow = Image.new('RGBA', out.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((2, 2, w * PX - 3, h * PX - 3), outline=(255, 220, 110, 150), width=5)
    out.alpha_composite(glow.filter(ImageFilter.GaussianBlur(2)))
    d.ellipse((3, 3, w * PX - 4, h * PX - 4), outline=(255, 214, 80, 255), width=3)
    d.arc((3, 3, w * PX - 4, h * PX - 4), 190, 350, fill=(255, 246, 190, 255), width=2)
    place = {'x': 8 - w / 2, 'y': round(8 + HALO_Y - h / 2, 3), 'w': w, 'h': h}
    return out, place


def wings_picture(iid, tex, areas, item, under):
    """Both wings seen from behind, raised a little – they fit next to the figure (and above its shoulders)."""
    k = item['density']
    a = areas['wing']
    f = faces(*a['uv'], a['size'], k)
    pic = tex.crop(tuple(round(v) for v in f['back']))  # as seen from behind: tip on the left, root on the right
    # skin pixels: each wing 9 wide; the figure is 16 wide, the canvas has one pixel of room on each side
    span_w, span_h = 9.0, a['size'][1] * 9.0 / a['size'][0]
    wing = pic.resize((round(span_w * PX), round(span_h * PX)), Image.NEAREST)
    wing = wing.rotate(-14, resample=Image.NEAREST, expand=True)
    total_w = 18 * PX
    out = Image.new('RGBA', (total_w, wing.height), (0, 0, 0, 0))
    # seen from behind the player's left wing is on the left of the picture
    out.alpha_composite(wing.transpose(Image.FLIP_LEFT_RIGHT), (total_w // 2 - wing.width + PX // 2, 0))
    out.alpha_composite(wing, (total_w // 2 - PX // 2, 0))
    if under:
        dark = Image.new('RGBA', out.size, (0, 0, 0, 0))
        dark.paste((20, 14, 24, 255), mask=out.getchannel('A'))
        out = Image.blend(out, dark, 0.45)
        out.putalpha(dark.getchannel('A'))
    place = {'x': -1, 'y': round(8 + 2.5 - wing.height / PX * 0.6, 3), 'w': 18, 'h': round(wing.height / PX, 3)}
    return out, place


def main():
    # moving capes
    for out in (os.path.join(MOD, 'textures', 'capes'), os.path.join(LAUNCHER, 'capes')):
        os.makedirs(out, exist_ok=True)
    for cid in ANIMATED:
        strip = cape_strip(cid)
        for out in (os.path.join(MOD, 'textures', 'capes'), os.path.join(LAUNCHER, 'capes')):
            save_small(strip, os.path.join(out, cid + '.png'))

    # cosmetics: textures and boxes for the mod, flat pictures for the launcher
    tex_dir = os.path.join(MOD, 'textures', 'cosmetics')
    ui_dir = os.path.join(LAUNCHER, 'cosmetics')
    os.makedirs(tex_dir, exist_ok=True)
    os.makedirs(ui_dir, exist_ok=True)
    mod_items, ui_items = [], []
    for iid, item in ITEMS.items():
        tex, areas, tw, th = paint_item(iid, item)
        tex.save(os.path.join(tex_dir, iid + '.png'), optimize=True)
        parts = []
        for p in item['parts']:
            boxes = []
            for b in p['boxes']:
                u, v = areas[b['tex']]['uv']
                boxes.append({'origin': [round(c, 4) for c in b['origin']], 'size': b['size'], 'uv': [u, v], 'inflate': b['inflate'], 'mirror': b['mirror']})
            parts.append({'bone': p['bone'], 'pivot': p['pivot'], 'rot': p.get('rot', [0, 0, 0]), 'scale': p.get('scale', 1), 'anim': p.get('anim', ''), 'boxes': boxes})
        mod_items.append({'id': iid, 'slot': item['slot'], 'texture': [tw, th], 'density': item['density'], 'glow': item.get('glow', False), 'parts': parts})
        entry = {'id': iid, 'slot': item['slot'], 'name': item['name'], 'nameEn': item['nameEn']}
        if item['slot'] == 'hat':
            for view in ('front', 'back'):
                pic, place = project_hat(item, tex, areas, view)
                pic.save(os.path.join(ui_dir, f'{iid}-{view}.png'), optimize=True)
                entry[view] = place
        elif item['slot'] == 'halo':
            pic, place = halo_picture()
            pic.save(os.path.join(ui_dir, f'{iid}-front.png'), optimize=True)
            pic.save(os.path.join(ui_dir, f'{iid}-back.png'), optimize=True)
            entry['front'] = place
            entry['back'] = place
        else:
            pic, place = wings_picture(iid, tex, areas, item, under=False)
            pic.save(os.path.join(ui_dir, f'{iid}-back.png'), optimize=True)
            entry['back'] = place
            pic, place = wings_picture(iid, tex, areas, item, under=True)
            pic.save(os.path.join(ui_dir, f'{iid}-front.png'), optimize=True)
            entry['front'] = {**place, 'under': True}
        ui_items.append(entry)
    capes = [{'id': cid, 'frames': FRAMES, 'fps': FPS, 'fallback': fallback} for cid, (_, _, fallback) in ANIMATED.items()]
    with open(os.path.join(MOD, 'cosmetics.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'capes': capes, 'items': mod_items}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    with open(os.path.join(ui_dir, 'cosmetics.json'), 'w', encoding='utf-8') as f:
        json.dump(ui_items, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{len(ANIMATED)} moving capes ({FRAMES} frames, {FPS} fps), {len(ITEMS)} cosmetics → mod and launcher')

    # the cape lists (still and moving) for the mod and the launcher
    sys.dont_write_bytecode = True  # the two generators import each other – no __pycache__ in the repository
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import gen_capes  # noqa: E402 – the same folder
    gen_capes.write_lists()


if __name__ == '__main__':
    main()
