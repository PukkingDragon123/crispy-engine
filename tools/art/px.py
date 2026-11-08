# Pixel-art authoring kit: sprites are grids of palette chars; export to TS data.
import math

PAL = {
    'k': '#1a0e08', 'K': '#3a2414', '0': '#0c0806',
    'a': '#22262c', 'b': '#3a424c', 'c': '#56616e', 'd': '#7c8a98', 'e': '#b4c0ca',
    'f': '#4a300c', 'g': '#7c5214', 'h': '#b88426', 'i': '#e2b24a', 'j': '#fff0a6',
    'l': '#3a200e', 'm': '#5a3418', 'n': '#7a4a22', 'o': '#9a6430', 'p': '#c08848',
    'q': '#7a5430', 'r': '#a9844e', 's': '#d6b985', 't': '#efdcb0', 'u': '#fff4d8',
    'v': '#2e180c', 'w': '#4e2a16', 'x': '#6e3c20', 'y': '#8e5430', 'z': '#b07040',
    'A': '#3a0806', 'B': '#6a120c', 'C': '#a8221a', 'D': '#dc4430', 'E': '#ff8a6a',
    'F': '#0b3d2c', 'G': '#1d6a4a', 'H': '#2fbf7e', 'I': '#7cf2b4', 'J': '#eafff2',
    'L': '#6e5a40', 'M': '#b8a07a', 'N': '#e0cfa8', 'O': '#f6ead0',
    'P': '#4e4a44', 'Q': '#8a867c', 'R': '#bdb9ae', 'S': '#f2efe6',
    'T': '#141c3a', 'U': '#283a7a', 'V': '#4468c0', 'W': '#8ab0e8',
    'X': '#5a2a12', 'Y': '#8a4a22', 'Z': '#c06a2e',
    '#': '#ffffff', '@': '#d4ebe0', '%': '#a2c8b8', '&': '#6e9a8a',
    '1': '#2a0806', '2': '#4a0e0a', '3': '#6a1a14',
    '4': '#c8a070', '5': '#e8c890',
}
RAMPS = {
    'iron': 'abcde', 'brass': 'fghij', 'wood': 'lmnop', 'parch': 'qrstu', 'leather': 'vwxyz',
    'blood': 'ABCDE', 'jade': 'FGHIJ', 'linen': 'LMNO', 'tin': 'PQRS', 'blue': 'TUVW', 'rust': 'XYZ',
    'glass': '&%@', 'ox': '123',
}
BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def ramp(name, t, x=0, y=0, dither=0.0):
    r = RAMPS[name]
    t = max(0.0, min(0.999, t + (BAYER4[int(y) % 4][int(x) % 4] / 16 - 0.5) * dither))
    return r[int(t * len(r))]


class Spr:
    def __init__(s, w, h):
        s.w, s.h = w, h
        s.p = [[None] * w for _ in range(h)]

    def get(s, x, y):
        if 0 <= x < s.w and 0 <= y < s.h:
            return s.p[y][x]
        return None

    def set(s, x, y, c):
        x, y = int(x), int(y)
        if 0 <= x < s.w and 0 <= y < s.h:
            s.p[y][x] = c

    def each(s, mask, fn):
        for y in range(s.h):
            for x in range(s.w):
                if mask(x + 0.5, y + 0.5):
                    c = fn(x, y)
                    if c:
                        s.p[y][x] = c
        return s

    def rect(s, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                s.set(xx, yy, c)
        return s

    def line(s, x0, y0, x1, y1, c):
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            s.set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
        return s

    def outline(s, c='k', diag=False):
        add = []
        for y in range(s.h):
            for x in range(s.w):
                if s.p[y][x] is not None:
                    continue
                nb = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (-1, -1), (1, -1), (-1, 1)] if diag else [])
                if any(s.get(x + dx, y + dy) not in (None,) and s.get(x + dx, y + dy) != c for dx, dy in nb):
                    add.append((x, y))
        for x, y in add:
            s.p[y][x] = c
        return s

    def blit(s, o, ox, oy, skip=None):
        for y in range(o.h):
            for x in range(o.w):
                c = o.p[y][x]
                if c is not None and c != skip:
                    s.set(ox + x, oy + y, c)
        return s

    def recolor(s, m):
        for y in range(s.h):
            for x in range(s.w):
                c = s.p[y][x]
                if c in m:
                    s.p[y][x] = m[c]
        return s

    def copy(s):
        o = Spr(s.w, s.h)
        o.p = [r[:] for r in s.p]
        return o

    def flipx(s):
        o = Spr(s.w, s.h)
        o.p = [r[::-1] for r in s.p]
        return o

    def rows(s):
        return [''.join(c if c else '.' for c in r) for r in s.p]

    def opaque(s, x, y):
        return s.get(x, y) is not None


def from_rows(rows):
    h = len(rows)
    w = max(len(r) for r in rows)
    o = Spr(w, h)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch not in '. ':
                o.p[y][x] = ch
    return o


def lit_dir(nx, ny):
    """light from the upper left: +1 facing it, -1 away"""
    return -(nx * 0.62 + ny * 0.78)


def disc(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def preview(sprites, path, scale=4, cols=8, bg=(108, 128, 148)):
    from PIL import Image, ImageDraw
    cell_w = max(s.w for _, s in sprites) * scale + 12
    cell_h = max(s.h for _, s in sprites) * scale + 22
    rows = (len(sprites) + cols - 1) // cols
    im = Image.new('RGB', (cols * cell_w, rows * cell_h), bg)
    dr = ImageDraw.Draw(im)
    for i, (name, s) in enumerate(sprites):
        ox, oy = (i % cols) * cell_w + 6, (i // cols) * cell_h + 4
        for y in range(s.h):
            for x in range(s.w):
                c = s.p[y][x]
                if c is None:
                    continue
                hx = PAL[c]
                col = tuple(int(hx[k:k + 2], 16) for k in (1, 3, 5))
                dr.rectangle([ox + x * scale, oy + y * scale, ox + x * scale + scale - 1, oy + y * scale + scale - 1], fill=col)
        dr.text((ox, oy + s.h * scale + 3), name[:22], fill=(0, 0, 0))
    im.save(path)


def export_ts(sprites, path, header):
    out = [header, "import type { PixelSprite } from './PixelUI';", '', '/* eslint-disable */', 'export const HUD_ART: Record<string, PixelSprite> = {']
    for name, s in sprites:
        rows = s.rows()
        out.append(f"  '{name}': {{ w: {s.w}, h: {s.h}, rows: [")
        for r in rows:
            out.append(f"    '{r}',")
        out.append('  ] },')
    out.append('};')
    open(path, 'w').write('\n'.join(out) + '\n')


def sheet(sprites, path, scale=5, maxw=1900, bg=(108, 128, 148)):
    """shelf-packed preview, names under each sprite"""
    from PIL import Image, ImageDraw
    placed = []
    x = y = 6
    rowh = 0
    for name, s in sprites:
        w, h = s.w * scale, s.h * scale + 12
        cw = max(w, len(name) * 6) + 10
        if x + cw > maxw:
            x = 6
            y += rowh + 6
            rowh = 0
        placed.append((name, s, x, y))
        x += cw
        rowh = max(rowh, h)
    im = Image.new('RGB', (maxw, y + rowh + 8), bg)
    dr = ImageDraw.Draw(im)
    for name, s, ox, oy in placed:
        for yy in range(s.h):
            for xx in range(s.w):
                c = s.p[yy][xx]
                if c is None:
                    continue
                hx = PAL[c]
                col = tuple(int(hx[k:k + 2], 16) for k in (1, 3, 5))
                dr.rectangle([ox + xx * scale, oy + yy * scale, ox + xx * scale + scale - 1, oy + yy * scale + scale - 1], fill=col)
        dr.text((ox, oy + s.h * scale + 1), name, fill=(0, 0, 0))
    im.save(path)
