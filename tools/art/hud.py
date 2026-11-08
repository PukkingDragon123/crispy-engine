import math, sys, json
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from px import *

S = {}  # name -> Spr
META = {}


def add(name, s):
    S[name] = s
    return s


def tex(x, y, k=1):
    """cheap stable hash 0..1"""
    v = math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453
    return v - math.floor(v)


# ------------------------------------------------------------------ revolver cylinder
def cylinder(size=34):
    s = Spr(size, size)
    c = (size - 1) / 2
    r = size / 2 - 1.2

    def f(x, y):
        dx, dy = x - c, y - c
        d = math.hypot(dx, dy)
        n = (dx / max(d, 1e-3), dy / max(d, 1e-3))
        L = lit_dir(*n)
        if d > r - 2.6:  # rolled bevel, clean light bands
            if d > r - 1.0 and L > 0.5:
                return 'e'
            return 'e' if L > 0.72 else 'd' if L > 0.15 else 'c' if L > -0.45 else 'b'
        if abs(d - (r - 3.1)) < 0.55:
            return 'a' if L < 0.3 else 'b'
        # the rear face: flat steel, a lit crescent on the high side
        if r - 6.2 < d < r - 3.8 and L > 0.55:
            return 'd'
        return 'c' if L * d / r > -0.12 else 'b'
    s.each(lambda x, y: (x - c - 0.5) ** 2 + (y - c - 0.5) ** 2 <= r * r, lambda x, y: f(x + 0.0, y + 0.0))
    # ratchet star and centre pin
    for i in range(6):
        a = i / 6 * math.tau
        for k in range(1, 4):
            s.set(round(c + math.cos(a) * k), round(c + math.sin(a) * k), 'd' if k < 3 else 'c')
    s.set(round(c) - 1, round(c) - 1, 'e')
    s.set(round(c), round(c), 'e')
    s.set(round(c) + 1, round(c) + 1, 'b')
    # two deliberate scratches catching the light
    for t in range(4):
        s.set(round(c - 10 + t), round(c + 5 - t // 2), 'd')
        s.set(round(c + 6 + t // 2), round(c - 9 + t), 'd')
    s.outline('k')
    return s


def socket():
    s = Spr(7, 7)

    def f(x, y):
        dx, dy = x - 3, y - 3
        d = math.hypot(dx, dy)
        if d < 1.6:
            return '0'
        L = lit_dir(dx / max(d, 1e-3), dy / max(d, 1e-3))
        return 'a' if L > 0 else 'c'  # the bore: its far (lower-right) wall catches the light
    s.each(disc(3.5, 3.5, 3.3), f)
    return s


def round_head(primer='brass'):
    s = Spr(7, 7)

    def f(x, y):
        dx, dy = x - 3, y - 3
        d = math.hypot(dx, dy)
        L = lit_dir(dx / max(d, 1e-3), dy / max(d, 1e-3))
        if d > 2.2:  # the rim
            return 'j' if L > 0.6 else 'i' if L > 0.0 else 'h' if L > -0.6 else 'g'
        if d < 0.9:  # the primer
            if primer == 'venom':
                return 'I'
            return 'f' if primer == 'spent' else 'g'
        if primer == 'venom':
            return 'J' if L > 0.5 else 'H' if L > -0.3 else 'G'
        return 'i' if L > 0.4 else 'h' if L > -0.4 else 'g'
    s.each(disc(3.5, 3.5, 3.3), f)
    return s


def notch():
    s = Spr(2, 2)
    s.rect(0, 0, 2, 2, 'a')
    s.set(1, 1, 'k')
    return s


def casing(angle):
    """a spent case tumbling: a brass tube 3 px wide, 8 long, at 0 or 45 degrees"""
    s = Spr(11, 11)
    ca, sa = math.cos(angle), math.sin(angle)
    for t in range(-4, 4):
        for w in (-1, 0, 1):
            x = 5 + t * ca - w * sa
            y = 5 + t * sa + w * ca
            ch = 'i' if w == -1 else 'h' if w == 0 else 'g'
            if t == 3:
                ch = 'j' if w == -1 else 'h'  # the rim
            if t == -4:
                ch = 'f'  # the open mouth
            s.set(round(x), round(y), ch)
    s.outline('k')
    return s


# ------------------------------------------------------------------ shotgun shell
def shell(w=11, h=28):
    s = Spr(w, h)
    head = round(h * 0.27)
    body_w = w - 2
    for y in range(h):
        top = y < 3
        if y >= h - 2:  # the rim
            x0, x1 = 0, w
        else:
            x0, x1 = 1, 1 + body_w
        if top:  # rounded crimp
            inset = [3, 1, 0][y]
            x0 += inset
            x1 -= inset
        for x in range(x0, x1):
            u = (x - x0) / max(1, x1 - x0 - 1)
            if y >= h - head:
                ch = 'j' if u < 0.18 else 'i' if u < 0.42 else 'h' if u < 0.78 else 'g'
                if y == h - head:
                    ch = 'g' if u > 0.2 else 'h'
                if y >= h - 2:
                    ch = 'i' if y == h - 2 and u < 0.5 else 'h' if y == h - 2 else 'g'
            else:
                ch = 'E' if u < 0.15 else 'D' if u < 0.38 else 'C' if u < 0.75 else 'B'
                if top:
                    ch = 'D' if u < 0.4 else 'C'
                    if y == 0:
                        ch = 'C'
                    if y == 1 and abs(u - 0.5) < 0.2:
                        ch = 'B'
                elif y in (round(h * 0.42), round(h * 0.42) + 1):
                    ch = 'B' if u > 0.2 else 'C'  # the printed band
            s.set(x, y, ch)
    s.outline('k')
    return s


# ------------------------------------------------------------------ Thompson drum
def drum(size=36):
    s = Spr(size, size + 4)
    c = (size - 1) / 2
    cy = c + 4
    r = size / 2 - 1.4

    def f(x, y):
        dx, dy = x - c, y - cy
        d = math.hypot(dx, dy)
        n = (dx / max(d, 1e-3), dy / max(d, 1e-3))
        L = lit_dir(*n)
        if d > r - 2.2:
            return 'W' if L > 0.6 else 'V' if L > 0.1 else 'U' if L > -0.45 else 'T'
        if abs(d - r * 0.62) < 0.6:
            return 'T'
        if abs(d - r * 0.62 - 1.2) < 0.6 and L > 0.25:
            return 'W'
        if r * 0.62 + 1.6 < d < r - 2.6 and L > 0.62:
            return 'V'
        return 'U' if L * d / r > -0.3 else 'T'
    # feed lips at 12 o'clock
    s.rect(round(c) - 3, 0, 7, 6, 'U')
    s.rect(round(c) - 3, 0, 7, 1, 'V')
    s.rect(round(c) + 2, 1, 1, 5, 'T')
    s.each(lambda x, y: (x - c - 0.5) ** 2 + (y - cy - 0.5) ** 2 <= r * r, f)
    # rivets
    for i in range(12):
        a = i / 12 * math.tau
        rx, ry = round(c + math.cos(a) * (r - 3.4)), round(cy + math.sin(a) * (r - 3.4))
        s.set(rx, ry, 'i')
        s.set(rx + 1, ry + 1, 'f')
    # brass winding key over the hub
    kx = round(c)
    for y in range(round(cy) - 6, round(cy) + 7):
        s.set(kx - 1, y, 'i')
        s.set(kx, y, 'h')
        s.set(kx + 1, y, 'g')
    for ey in (round(cy) - 6, round(cy) + 6):
        for dx in range(-2, 3):
            for dy in (-1, 0, 1):
                if abs(dx) + abs(dy) <= 2:
                    s.set(kx + dx, ey + dy, 'i' if dx < 0 and dy <= 0 else 'h' if dx <= 0 else 'g')
    s.set(kx, round(cy), 'j')
    s.outline('k')
    return s


# ------------------------------------------------------------------ tin star
def star(size=26):
    s = Spr(size, size)
    c = (size - 1) / 2
    R, r0 = size / 2 - 2.6, size / 2 * 0.47
    pts = []
    for i in range(12):
        a = -math.pi / 2 + i * math.pi / 6
        rr = R if i % 2 == 0 else r0
        pts.append((c + 0.5 + math.cos(a) * rr, c + 0.5 + math.sin(a) * rr))

    def inside(x, y):
        o = False
        j = len(pts) - 1
        for i in range(len(pts)):
            xi, yi = pts[i]
            xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                o = not o
            j = i
        return o

    def f(x, y):
        dx, dy = x + 0.5 - c - 0.5, y + 0.5 - c - 0.5
        d = math.hypot(dx, dy)
        if d < size * 0.17:  # the raised boss
            n = (dx / max(d, 1e-3), dy / max(d, 1e-3))
            L = lit_dir(*n) * (d / (size * 0.17))
            return 'S' if L > 0.35 else 'R' if L > -0.25 else 'Q'
        if abs(d - size * 0.19) < 0.5:
            return 'P'
        a = math.atan2(dy, dx) + math.pi / 2
        k = round(a / (math.pi / 3))
        axis = -math.pi / 2 + k * math.pi / 3
        side = math.sin(math.atan2(dy, dx) - axis)
        # each point is two facets: the one turned to the upper-left light is bright
        fn = (math.cos(axis + math.pi / 2) * (1 if side > 0 else -1), math.sin(axis + math.pi / 2) * (1 if side > 0 else -1))
        L = lit_dir(*fn)
        return 'S' if L > 0.5 else 'R' if L > 0.0 else 'Q' if L > -0.55 else 'P'
    s.each(inside, f)
    # ball tips
    for i in range(6):
        a = -math.pi / 2 + i * math.pi / 3
        bx, by = c + math.cos(a) * (R + 0.6), c + math.sin(a) * (R + 0.6)
        for yy in range(-2, 3):
            for xx in range(-2, 3):
                if xx * xx + yy * yy <= 3:
                    L = -(xx * 0.6 + yy * 0.8)
                    s.set(round(bx + xx), round(by + yy), 'S' if L > 0.8 else 'R' if L > -0.5 else 'Q')
    s.outline('k')
    return s


# ------------------------------------------------------------------ coin (spin frames)
def coin(frame):
    w = [11, 9, 5, 3][frame]
    s = Spr(13, 13)
    c = 6
    rx, ry = w / 2, 5.3

    def f(x, y):
        dx, dy = (x - c) / rx, (y - c) / ry
        d = math.hypot(dx, dy)
        if frame == 3:
            return 'h' if x == c else 'g' if x > c else 'i'
        if d > 0.78:
            return 'j' if (dx < -0.2 and dy < -0.2) else 'i' if dx + dy < 0 else 'g'
        star = math.hypot(dx * rx, dy * ry)
        a = math.atan2(dy, dx)
        kk = math.cos(((a + math.pi / 2) * 5) % math.tau) * 0.5 + 0.5
        if star < 1.2 + kk * 1.8 and frame < 2:
            return 'j' if dx + dy < 0 else 'i'
        return 'i' if (dx + dy < -0.6) else 'h'
    s.each(lambda x, y: ((x - c - 0.5) / rx) ** 2 + ((y - c - 0.5) / ry) ** 2 <= 1.0, lambda x, y: f(x, y))
    s.outline('k')
    return s


# ------------------------------------------------------------------ the heart
def heart(beat=0, wraps=3):
    """a wrapped anatomical heart, lit from the upper left; beat 1 = swollen; wraps 3..0 linen bands left"""
    s = Spr(24, 24)
    k = 1 + beat * 0.08
    cx, cy = 11.5, 13.0

    def inside(x, y):
        X, Y = (x - cx) / k, (y - cy) / k
        L = (X + 2.4) ** 2 / 34 + (Y + 0.5) ** 2 / 30 <= 1          # left ventricle (big)
        R = (X - 3.4) ** 2 / 20 + (Y + 2.6) ** 2 / 17 <= 1          # right side
        T = Y > 0 and Y < 9.6 and abs(X + 0.6 + Y * 0.22) < (9.6 - Y) * 0.72  # apex, down and to the left
        return L or R or T

    def f(x, y):
        X, Y = (x - cx) / k, (y - cy) / k
        L = -((X + 1.5) * 0.08 + (Y + 1.2) * 0.1)
        ch = 'E' if L > 0.42 else 'D' if L > 0.12 else 'C' if L > -0.42 else 'B'
        if abs(X - 1.2 + Y * 0.36) < 0.5 and -2 < Y < 7:
            ch = 'A' if L < 0 else 'B'  # the groove between the ventricles
        return ch
    s.each(inside, f)
    # the great vessels: the aorta rising and arching left, the pulmonary trunk and vena in vein-blue
    top = round(cy - 6.6 * k)
    for yy in range(0, 5):
        for xx in range(-2, 2):
            s.set(round(cx - 1.5 + xx), top - yy, 'D' if xx == -2 else 'C' if xx < 1 else 'B')
    for xx in range(-4, 0):
        s.set(round(cx - 1.5 + xx), top - 5, 'C' if xx > -4 else 'B')
        s.set(round(cx - 1.5 + xx), top - 4, 'D' if xx > -4 else 'C')
    s.set(round(cx - 5.5), top - 3, 'B')
    s.set(round(cx - 0.5), top - 5, 'A')
    for yy in range(0, 4):
        s.set(round(cx + 2), top - yy + 1, 'V')
        s.set(round(cx + 3), top - yy + 1, 'U')
    s.set(round(cx + 2), top - 3, 'T')
    s.set(round(cx + 5), top + 1, 'U')
    s.set(round(cx + 5), top, 'T')
    # resin-stained linen wraps: three bands round the ventricles; they come off from the top
    bands = [(-3.4, 0.38), (1.0, 0.32), (5.0, 0.28)]
    for i, (by, slope) in enumerate(bands):
        if i < 3 - wraps:
            continue
        for x in range(s.w):
            yb = cy + (by + (x - cx) * slope) * k
            for w in (0, 1):
                y = round(yb) + w
                c0 = s.get(x, y)
                if c0 is not None and c0 not in ('V', 'U', 'T'):
                    s.set(x, y, ('O' if x < cx - 3 else 'N') if w == 0 else 'M')
    if wraps < 3:
        # the loose band hangs off the right side, frayed
        by = bands[2 - wraps][0]
        for t in range(3 + (3 - wraps)):
            s.set(round(cx + 8.5 * k + (1 if t > 2 else 0)), round(cy + by * k + t), 'N' if t < 2 else 'M')
    s.outline('k')
    return s


# ------------------------------------------------------------------ soul jar
JAR_W, JAR_H = 28, 46


def jar_profile(y):
    """inner glass radius by row from the bottom of the glass (0) to the lip"""
    pts = [(0, 6.2), (3, 8.6), (7, 10.2), (12, 10.6), (17, 10.0), (20, 8.0), (22, 5.6), (24, 4.6), (26, 4.8)]
    for i in range(len(pts) - 1):
        (y0, r0), (y1, r1) = pts[i], pts[i + 1]
        if y0 <= y <= y1:
            return r0 + (r1 - r0) * (y - y0) / (y1 - y0)
    return 0


def jar_layers():
    c = (JAR_W - 1) / 2
    base = JAR_H - 6  # bottom of the glass
    back, mask, front = Spr(JAR_W, JAR_H), Spr(JAR_W, JAR_H), Spr(JAR_W, JAR_H)
    top = base - 26
    for y in range(top, base + 1):
        r = jar_profile(base - y)
        for x in range(JAR_W):
            dx = x + 0.5 - c - 0.5
            if abs(dx) <= r:
                u = dx / max(r, 1)
                ch = '@'
                if u < -0.62:
                    ch = '#' if -0.86 < u < -0.68 and base - y > 3 else '@'
                if u > 0.55:
                    ch = '%'
                if abs(dx) > r - 1:
                    ch = '&'
                back.set(x, y, ch)
                if abs(dx) <= r - 1 and y > top + 1:
                    mask.set(x, y, '@')
    # the brass foot with lotus petals
    for y in range(base + 1, JAR_H):
        hw = [7, 9, 10, 10, 9][min(4, y - base - 1)]
        for x in range(round(c - hw), round(c + hw) + 1):
            u = (x - c + hw) / (2 * hw)
            ch = 'i' if u < 0.3 else 'h' if u < 0.7 else 'g'
            if y == base + 1 and (x % 3 == 0):
                ch = 'g'
            back.set(x, y, ch)
    # the collar round the neck and the stopper seat
    for y in range(top - 2, top + 2):
        for x in range(round(c - 6), round(c + 6) + 1):
            u = (x - c + 6) / 12
            front.set(x, y, 'j' if (u < 0.25 and y == top - 2) else 'i' if u < 0.35 else 'h' if u < 0.75 else 'g')
    # cage: a shoulder band and a low band, two front straps with rivets
    for yb in (top + 6, base - 3):
        r = jar_profile(base - yb)
        for x in range(round(c - r), round(c + r) + 1):
            u = (x - c + r) / (2 * r)
            front.set(x, yb, 'i' if u < 0.3 else 'h' if u < 0.72 else 'g')
            front.set(x, yb + 1, 'g' if u < 0.72 else 'f')
    for sx in (-5, 5):
        for y in range(top + 6, base - 2):
            r = jar_profile(base - y)
            xx = round(c + sx * (r / 10.6))
            front.set(xx, y, 'h' if sx < 0 else 'g')
            if (y - top) % 5 == 0:
                front.set(xx, y, 'j' if sx < 0 else 'i')
    # the jade soul-gem cartouche on the belly
    gy = base - 11
    for dy in range(-3, 4):
        for dx in range(-2, 3):
            if abs(dx) / 2.6 + abs(dy) / 3.6 <= 1:
                front.set(round(c) + dx, gy + dy, 'h' if abs(dx) / 2.6 + abs(dy) / 3.6 > 0.62 else ('J' if dx < 0 and dy < 0 else 'I' if dx <= 0 else 'H'))
    back.outline('k')
    # front pieces sit on the glass: outline only where they leave the jar
    return back, mask, front, top


def lid(pose=0):
    """the gadrooned stopper with Pinch on guard: pose 0 idle, 1 claws snapping, 2 dozing"""
    s = Spr(JAR_W, 22)
    c = (JAR_W - 1) / 2
    base = 21
    rows = [3, 5, 6, 6, 5]
    for i, hw in enumerate(rows):
        y = base - i
        for x in range(round(c - hw), round(c + hw) + 1):
            u = (x - c + hw) / (2 * hw + 1)
            g = (x % 2 == 0) and 0 < i < 4
            s.set(x, y, 'j' if (u < 0.25 and i >= 3) else ('h' if g else 'i') if u < 0.45 else ('g' if g else 'h') if u < 0.78 else 'g')
    s.set(round(c), base - 5, 'i')
    s.set(round(c), base - 6, 'j')
    # Pinch: body, tail curling over, claws forward (facing left)
    py = base - 8
    body = [(c - 1, py), (c, py), (c + 1, py), (c + 2, py), (c - 1, py + 1), (c, py + 1), (c + 1, py + 1), (c + 2, py + 1)]
    for x, y in body:
        s.set(round(x), y, 'z' if y == py else 'y')
    tail = [(c + 3, py), (c + 4, py - 1), (c + 5, py - 2), (c + 5, py - 3), (c + 4, py - 4), (c + 3, py - 4)]
    if pose == 1:
        tail = [(c + 3, py), (c + 4, py - 1), (c + 4, py - 2), (c + 4, py - 3), (c + 3, py - 4), (c + 2, py - 5)]
    for i, (x, y) in enumerate(tail):
        s.set(round(x), y, 'z' if i % 2 == 0 else 'y')
    sx, sy = tail[-1]
    s.set(round(sx) - 1, sy, 'x')
    s.set(round(sx) - 1, sy + 1, 'J' if pose != 2 else 'x')  # the sting catches the light
    # legs
    for lx in (c - 1, c + 1, c + 2):
        s.set(round(lx), py + 2, 'x')
    # claws
    open_ = 1 if pose == 1 else 0
    for cl, dy in ((-1, -1 - open_), (-1, 2 + open_)):
        s.set(round(c - 2), py + (0 if dy < 0 else 1), 'y')
        s.set(round(c - 3), py + dy + (1 if dy < 0 else -1), 'z')
        s.set(round(c - 4), py + dy, 'z')
        s.set(round(c - 4), py + dy + (1 if dy < 0 else -1), 'y')
    # its eye: a tiny bead (the model's eye stays a model; here a lit bead)
    s.set(round(c - 1), py, 'k' if pose != 2 else 'x')
    s.outline('k')
    return s


# ------------------------------------------------------------------ the tally plank
def plank(W=92, H=30, small=False):
    s = Spr(W, H)
    ph = (H - 4) // 2
    planks = [(1, 2, W - 3, ph, 1.7), (3, 2 + ph + 1, W - 3, ph, 5.3)]
    for (x0, y0, w, h, seed) in planks:
        for y in range(y0, y0 + h):
            # splintered, uneven ends
            l = x0 + (1 if tex(y, seed, 2) > 0.6 else 0) + (1 if y == y0 or y == y0 + h - 1 else 0)
            r = x0 + w - (1 if tex(y, seed, 5) > 0.55 else 0) - (1 if y == y0 or y == y0 + h - 1 else 0)
            for x in range(l, r):
                v = (y - y0) / max(1, h - 1)
                grain = math.sin((y * 1.7 + math.sin(x * 0.11 + seed) * 2.2 + seed * 3) * 1.25)
                ch = 'n'
                if grain > 0.82:
                    ch = 'm'
                elif grain < -0.9 and v > 0.2:
                    ch = 'o'
                if y == y0:
                    ch = 'p'
                elif y == y0 + 1 and ch == 'n':
                    ch = 'o'
                if y == y0 + h - 1:
                    ch = 'l'
                s.set(x, y, ch)
        # a knot
        kx = x0 + (int(w * 0.68) if seed > 3 else int(w * 0.22))
        ky = y0 + h // 2
        for dx in range(-2, 3):
            for dy in (-1, 0, 1):
                if abs(dx) / 2.5 + abs(dy) / 1.5 <= 1:
                    s.set(kx + dx, ky + dy, 'l' if (dx, dy) == (0, 0) else 'm')
        # nails
        for nx in (x0 + 3, x0 + w - 5):
            ny = y0 + h // 2 - 1
            s.rect(nx, ny, 2, 2, 'c')
            s.set(nx, ny, 'e')
            s.set(nx + 1, ny + 1, 'a')
    # a crack in the upper plank
    for x in range(planks[0][0] + 2, planks[0][0] + 14):
        s.set(x, planks[0][1] + 3 + (1 if x % 5 == 0 else 0), 'l')
    # a bent nail standing proud on the lower plank
    bx = planks[1][0] + int(planks[1][2] * 0.8)
    by = planks[1][1] + 2
    for i, (dx, dy) in enumerate([(0, 0), (1, -1), (2, -1), (3, -2)]):
        s.set(bx + dx, by + dy, 'd' if i % 2 else 'c')
    s.outline('k')
    return s


# ------------------------------------------------------------------ leather plaque, links, tag
def plaque(W=136, H=32):
    s = Spr(W, H + 8)
    y0 = 8
    rr = 5

    def inside(x, y):
        X, Y = x - 0.5, y - 0.5 - y0
        if not (0 <= Y < H and 0 <= X < W):
            return False
        cx = min(max(X, rr), W - rr)
        cy = min(max(Y, rr), H - rr)
        if math.hypot(X - cx, Y - cy) > rr:
            return False
        # V notches mid-sides
        if (X < 4 or X > W - 5) and abs(Y - H / 2) < 4 - min(X, W - X):
            return False
        return True

    def f(x, y):
        X, Y = x, y - y0
        e = min(X, W - 1 - X, Y, H - 1 - Y)
        if e < 2:
            return 'w' if e == 1 else 'v'
        if e == 4 and (X + Y) % 4 < 2:
            return 'N'  # saddle stitching
        if e == 4:
            return 'w'
        ch = 'x'
        if Y < 7:
            ch = 'y'
        if Y == 2:
            ch = 'z'
        if tex(x, y, 9) > 0.92:
            ch = 'w' if ch == 'x' else 'x'
        return ch
    s.each(inside, f)
    for tx, ty in ((7, y0 + 6), (W - 8, y0 + 6), (7, y0 + H - 7), (W - 8, y0 + H - 7)):
        s.rect(tx - 1, ty - 1, 3, 3, 'h')
        s.set(tx - 1, ty - 1, 'j')
        s.set(tx + 1, ty + 1, 'g')
    # D-rings on riveted tabs, where the chains hook in
    for rx in (W // 2 - round(W * 0.34), W // 2 + round(W * 0.34)):
        s.rect(rx - 2, y0 - 1, 5, 4, 'x')
        s.rect(rx - 2, y0 - 1, 5, 1, 'y')
        for (dx, dy) in [(-2, -2), (-2, -3), (-2, -4), (-1, -5), (0, -6), (1, -5), (2, -4), (2, -3), (2, -2)]:
            s.set(rx + dx, y0 + dy, 'd' if dx <= 0 else 'b')
        s.set(rx, y0, 'i')
    s.outline('k')
    return s


def link(edge=False):
    if edge:
        s = from_rows(['d', 'c', 'c', 'c', 'c', 'b'])
    else:
        s = from_rows(['.dd.', 'd..c', 'd..b', 'c..b', '.bb.'])
    s.outline('k')
    return s


def tag(W=38, H=14):
    s = Spr(W, H + 5)
    y0 = 5
    for y in range(y0, y0 + H):
        for x in range(W):
            e = min(x, W - 1 - x, y - y0, y0 + H - 1 - y)
            if e == 0 and (x in (0, W - 1)) and (y in (y0, y0 + H - 1)):
                continue
            ch = 'h'
            if y == y0:
                ch = 'j' if x < W * 0.4 else 'i'
            elif y == y0 + 1:
                ch = 'i'
            elif y >= y0 + H - 2:
                ch = 'g'
            if tex(x, y, 4) > 0.985 and 1 < y - y0 < H - 2:
                ch = 'G'  # a fleck of verdigris
            s.set(x, y, ch)
    for x in range(2, W - 2):
        s.set(x, y0 + 2, 'g')
        s.set(x, y0 + H - 3, 'i')
    for y in range(y0 + 2, y0 + H - 2):
        s.set(2, y, 'g')
        s.set(W - 3, y, 'i')
    for rx in (4, W - 5):
        s.set(rx, y0 + H // 2 - 1, 'j')
        s.set(rx, y0 + H // 2, 'g')
    # the leather strap tying it to the plaque
    s.rect(W // 2 - 2, 0, 5, y0 + 2, 'x')
    s.rect(W // 2 - 2, 0, 1, y0 + 2, 'y')
    s.set(W // 2, 1, 'N')
    s.set(W // 2, 3, 'N')
    s.outline('k')
    return s


# ------------------------------------------------------------------ pocket stopwatch
def watch(R=17):
    W = 2 * R + 4
    s = Spr(W, W + 10)
    c = (W - 1) / 2
    cy = c + 10
    dial = Spr(W, W + 10)

    def f(x, y):
        dx, dy = x - c, y - cy
        d = math.hypot(dx, dy)
        n = (dx / max(d, 1e-3), dy / max(d, 1e-3))
        L = lit_dir(*n)
        if d > R - 2.2:  # knurled bezel
            k = 1 if (int(math.atan2(dy, dx) * 9) % 2 == 0) else 0
            base = 0.45 + L * 0.42
            return ramp('brass', base + (0.12 if k else 0), x, y, 0.1)
        if d > R - 3.2:
            return 'g'
        # enamel dial
        ch = 'u' if L > -0.2 else 't'
        a = (math.atan2(dy, dx) + math.pi / 2) % math.tau
        tick = (a / math.tau * 60) % 1
        if d > R - 5.6:
            maj = round(a / math.tau * 12) % 12 == round(a / math.tau * 12 * 1.0) % 12 and abs((a / math.tau * 12) - round(a / math.tau * 12)) < 0.08
            if maj:
                ch = 'K'
            elif (tick < 0.18 or tick > 0.82) and d > R - 4.5:
                ch = 'r'
        return ch
    s.each(lambda x, y: (x - c - 0.5) ** 2 + (y - cy - 0.5) ** 2 <= (R + 0.3) ** 2, f)
    dial.each(lambda x, y: (x - c - 0.5) ** 2 + (y - cy - 0.5) ** 2 <= (R - 5.8) ** 2, lambda x, y: 'u')
    # pendant, crown, bow
    for y in range(int(cy - R) - 3, int(cy - R) + 1):
        s.rect(round(c) - 1, y, 3, 1, 'h')
        s.set(round(c) - 1, y, 'i')
    for y in range(int(cy - R) - 6, int(cy - R) - 3):
        for x in range(round(c) - 2, round(c) + 3):
            s.set(x, y, 'i' if (x + y) % 2 == 0 else 'g')
    for a in range(0, 360, 8):
        rad = math.radians(a)
        bx, by = c + math.cos(rad) * 4.6, (cy - R - 9) + math.sin(rad) * 3.6
        if by < cy - R - 6:
            s.set(round(bx), round(by), 'i' if math.cos(rad) < 0 else 'g')
    s.outline('k')
    return s, dial


def watch_lid(R=17):
    W = 2 * R + 4
    s = Spr(W, W)
    c = (W - 1) / 2

    def f(x, y):
        dx, dy = x - c, y - c
        d = math.hypot(dx, dy)
        L = lit_dir(dx / max(d, 1e-3), dy / max(d, 1e-3))
        if d > R - 1.6:
            return ramp('brass', 0.45 + L * 0.4, x, y, 0.1)
        # engraved guilloche rings round a sheriff-star boss
        if d < 4:
            return 'j' if L > 0.2 else 'i'
        ring = int(d * 0.9 + math.sin(math.atan2(dy, dx) * 12) * 0.7) % 2
        return 'h' if ring else 'g'
    s.each(lambda x, y: (x - c - 0.5) ** 2 + (y - c - 0.5) ** 2 <= (R + 0.3) ** 2, f)
    s.outline('k')
    return s


# ------------------------------------------------------------------ nail, gear socket, gems, slot icons
def nail():
    s = from_rows(['.cd.', 'cede', 'dccb', '.bb.'])
    s.outline('k')
    return s


def gear_socket():
    s = Spr(16, 19)

    def inside(x, y):
        X, Y = x - 0.5, y - 0.5
        if X < 0 or X > 16 or Y < 1 or Y > 19:
            return False
        if Y < 3 and abs(X - 8) > 3 + Y * 2:
            return False
        e = min(X, 16 - X, Y - 1, 19 - Y)
        return not (min(X, 16 - X) + min(Y - 1, 19 - Y) < 2.2)
    s.each(inside, lambda x, y: 'h' if min(x, 15 - x, y - 1, 18 - y) < 2 and (x + y < 12) else 'g' if min(x, 15 - x, y - 1, 18 - y) < 2 else 'l' if (x + y) % 5 else 'm')
    for (x, y) in ((2, 3), (13, 3), (2, 16), (13, 16)):
        s.set(x, y, 'j')
    s.outline('k')
    return s


def gem():
    s = from_rows(['.ab.', 'abbc', '.cc.'])
    return s


def slot_icon(kind):
    rows = {
        'head': ['....kkkk....', '...knnnnk...', '...knoonk...', '.kknnnnnnkk.', 'kooooooooook', '.kkkkkkkkkk.'],
        'body': ['.kk....kk.', 'kxykkkkyxk', 'kxyyNNyyxk', 'kxyyNNyyxk', '.kyyNNyyk.', '.kyyNNyyk.', '.kxxNNxxk.', '..kkkkkk..'],
        'hands': ['.k.k.k..', 'kykykyk.', 'kyyyyyk.', 'kyyyyykk', 'kyyyyyyk', '.kyyyyk.', '.kxxxxk.', '..kkkk..'],
        'feet': ['..kkk...', '..kyk...', '..kyk...', '..kyk...', '..kyykk.', '.kyyyyyk', 'kxxxxxxk', '.kkkkkk.'],
        'tool': ['...kkk..', '..kdddk.', '.kdeek..', 'kdk.knk.', 'k...knk.', '....knk.', '...knk..', '...kk...'],
        'charm': ['..kkk...', '.k..k...', '..kkkk..', '.khiihk.', 'khijjihk', 'khiiiihk', '.khhhhk.', '..kkkk..'],
        'turbo': ['..kk....', '.kddk...', 'kdeddkk.', 'kdddddkk', 'kcccccDk', 'kcccccEk', '.kbbbkk.', '..kk....'],
        'wings': ['k.......', 'kok.....', 'kpook...', 'kpooook.', '.kpooook', '..kpoook', '...kkkk.'],
        'blades': ['......kk', '.....kek', '....kedk', '...kedk.', '..kedk..', '.kxdk...', 'kxxk....', '.kk.....'],
    }[kind]
    return from_rows(rows)


# ------------------------------------------------------------------ guns (side views, facing right)
def gun(kind):
    if kind == 'revolver':
        s = Spr(30, 15)
        s.rect(13, 4, 16, 3, 'c')
        s.rect(13, 4, 16, 1, 'd')
        s.rect(13, 6, 16, 1, 'b')
        s.set(28, 3, 'd')
        s.rect(7, 3, 8, 6, 'b')
        s.rect(9, 2, 6, 7, 'c')
        for y in range(2, 9):
            s.set(9, y, 'd')
        s.rect(9, 5, 6, 1, 'a')
        s.rect(5, 1, 3, 3, 'b')
        s.set(5, 1, 'd')
        for i in range(6):
            s.rect(3 + 0 - i // 2, 8 + i, 5, 1, 'n' if i < 4 else 'm')
            s.set(3 - i // 2, 8 + i, 'o')
        for (x, y) in ((10, 9), (11, 10), (12, 10), (13, 10), (14, 9)):
            s.set(x, y, 'b')
        s.set(11, 9, 'a')
    elif kind == 'shotgun':
        s = Spr(38, 11)
        s.rect(14, 2, 23, 2, 'c')
        s.rect(14, 2, 23, 1, 'd')
        s.rect(14, 4, 23, 2, 'b')
        s.rect(14, 4, 23, 1, 'c')
        s.rect(10, 2, 5, 5, 'b')
        s.rect(10, 2, 5, 1, 'd')
        s.rect(20, 6, 12, 2, 'n')
        s.rect(20, 6, 12, 1, 'o')
        for i in range(10):
            s.rect(i, 4 + (i < 4) * 0 + (2 if i < 6 else 1) - (1 if i > 6 else 0), 1, 4 - (i // 5), 'n')
        s.rect(0, 5, 10, 3, 'n')
        s.rect(0, 5, 10, 1, 'o')
        s.rect(0, 7, 10, 1, 'm')
        s.rect(0, 4, 2, 5, 'm')
        for (x, y) in ((11, 7), (12, 8), (13, 8), (14, 7)):
            s.set(x, y, 'b')
    else:  # tommy
        s = Spr(36, 16)
        s.rect(16, 4, 19, 2, 'c')
        s.rect(16, 4, 19, 1, 'd')
        for x in range(18, 28, 2):
            s.rect(x, 3, 1, 4, 'b')
        s.rect(9, 3, 9, 4, 'b')
        s.rect(9, 3, 9, 1, 'd')
        s.rect(0, 4, 9, 3, 'n')
        s.rect(0, 4, 9, 1, 'o')
        s.rect(0, 6, 9, 1, 'm')
        s.rect(0, 3, 2, 5, 'm')
        s.rect(29, 7, 3, 5, 'n')
        s.rect(29, 7, 1, 5, 'o')
        s.rect(7, 7, 3, 5, 'n')
        s.set(7, 7, 'o')
        for y in range(7, 16):
            for x in range(10, 19):
                if (x - 14) ** 2 + (y - 11) ** 2 <= 14:
                    s.set(x, y, 'U' if (x - 14) + (y - 11) > 0 else 'V')
        s.set(14, 11, 'h')
    s.outline('k')
    return s


# ------------------------------------------------------------------ treasure + sign arrows
def x_marker():
    s = Spr(18, 13)
    for y in range(5, 13):
        hw = [4, 6, 7, 8, 8, 8, 7, 6][y - 5]
        for x in range(9 - hw, 9 + hw):
            s.set(x, y, '5' if y < 8 and x < 9 else '4' if y < 11 else 'r')
    for i in range(7):
        for (x, y) in ((5 + i, 1 + i), (11 - i, 1 + i)):
            s.set(x, y, 'D')
            s.set(x + 1, y, 'C')
    s.outline('k')
    return s


def map_scrap():
    s = Spr(17, 14)
    for y in range(1, 13):
        for x in range(1, 16):
            if (x in (1, 15) and tex(x, y, 7) > 0.5) or (y in (1, 12) and tex(x, y, 8) > 0.6):
                continue
            s.set(x, y, 't' if (x + y) % 7 else 's')
    for (x, y) in ((3, 10), (5, 9), (7, 9), (8, 7), (10, 6), (11, 4)):
        s.set(x, y, 'C')
    for (x, y) in ((12, 2), (14, 4), (12, 4), (14, 2), (13, 3)):
        s.set(x, y, 'B')
    s.set(4, 4, 'r')
    s.set(5, 4, 'r')
    s.set(5, 5, 'r')
    s.outline('k')
    return s


def blueprint():
    s = Spr(20, 13)
    s.rect(3, 2, 14, 9, 'U')
    for x in range(4, 16, 3):
        s.rect(x, 3, 1, 7, 'V')
    for y in (4, 7):
        s.rect(4, y, 12, 1, 'V')
    s.rect(6, 5, 6, 1, 'W')
    s.set(6, 6, 'W')
    s.set(11, 6, 'W')
    for rx in (1, 17):
        s.rect(rx, 1, 3, 11, 'V')
        s.rect(rx, 1, 1, 11, 'W')
        s.set(rx + 1, 6, 'T')
    s.outline('k')
    return s


def arrow(diag=False):
    if not diag:
        s = Spr(20, 11)
        s.rect(1, 3, 12, 5, 'n')
        s.rect(1, 3, 12, 1, 'p')
        s.rect(1, 7, 12, 1, 'm')
        for i in range(6):
            s.rect(13 + i, 0 + i, 1, 11 - 2 * i, 'D' if i < 3 else 'C')
            s.set(13 + i, i, 'E')
        s.set(4, 5, 'c')
        s.set(4, 4, 'e')
        s.set(0, 4, 'n')
        s.set(0, 6, 'n')
    else:
        src = arrow(False)
        s = Spr(17, 17)
        ca = math.cos(-math.pi / 4)
        sa = math.sin(-math.pi / 4)
        for y in range(17):
            for x in range(17):
                X, Y = x - 8, y - 8
                sx, sy = X * ca + Y * sa + 10, -X * sa + Y * ca + 5.5
                ch = src.get(int(math.floor(sx)), int(math.floor(sy)))
                if ch and ch != 'k':
                    s.set(x, y, ch)
        s.outline('k')
        return s
    s.outline('k')
    return s


# ------------------------------------------------------------------ gun belt segments
def belt(slot=32, h=14):
    mid = Spr(slot, h)
    for y in range(h):
        for x in range(slot):
            ch = 'x'
            if y == 0:
                ch = 'z'
            elif y == 1:
                ch = 'y'
            elif y >= h - 2:
                ch = 'w' if y == h - 2 else 'v'
            if y in (2, h - 4) and x % 3 != 2:
                ch = 'N'
            if tex(x, y, 11) > 0.93 and 2 < y < h - 4:
                ch = 'w'
            mid.set(x, y, ch)
    for ry in (4, h - 6):
        mid.set(0, ry, 'i')
        mid.set(1, ry, 'h')
        mid.set(1, ry + 1, 'g')
    end = Spr(5, h)
    for y in range(h):
        for x in range(5):
            if (x == 0 and y in (0, h - 1)):
                continue
            end.set(x, y, mid.p[y][x + 3])
    return mid, end


# ------------------------------------------------------------------ tarot card frames
SCORP = [
    '...i...i...',
    '..ig...gi..',
    '..i.....i..',
    '...gihig...',
    '....iji....',
    '...giiig...',
    '..g.iii.g..',
    '...giiig...',
    '..g.hih.g..',
    '....hgh....',
    '.....h.....',
    '.....hi....',
    '......ih...',
    '......gi...',
    '.....ig....',
]


def card(w, h, back=False):
    s = Spr(w, h)
    small = w < 34
    bw = 1 if small else 2
    wx0, wx1 = round(w * 7 / 80), round(w * 73 / 80)
    wy0, wy1 = round(h * 18 / 130), round(h * 106 / 130)
    for y in range(h):
        for x in range(w):
            e = min(x, y, w - 1 - x, h - 1 - y)
            if e == 0 and (x in (0, w - 1)) and (y in (0, h - 1)):
                continue
            if e < bw:  # gilt border
                ch = ('i' if x + y < w + h * 0.35 else 'g') if e == 0 else 'h'
            elif e == bw:
                ch = 'f'
            else:
                if back:
                    lat = (x + y) % 5 == 0 or (x - y) % 5 == 0
                    ch = 'g' if lat else ('3' if (x + y) % 2 == 0 and e < bw + 3 else '2')
                    if (x + y) % 5 == 0 and (x - y) % 5 == 0:
                        ch = 'i'
                else:
                    ch = 'O' if (x + y) % 9 else 'N'
                    if y > h - bw - 3:
                        ch = 'N'
            s.set(x, y, ch)
    # corner ornaments
    if not small:
        for (cx, cy) in ((bw + 2, bw + 2), (w - bw - 3, bw + 2), (bw + 2, h - bw - 3), (w - bw - 3, h - bw - 3)):
            for (dx, dy) in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                s.set(cx + dx, cy + dy, 'h')
            s.set(cx, cy, 'j')
    if back:
        # the lapis medallion with Serket's scorpion, rayed in gilt
        mx, my = (w - 1) / 2, (h - 1) / 2
        rx, ry = w * 0.3, h * 0.2
        for y in range(h):
            for x in range(w):
                d = math.hypot((x - mx) / rx, (y - my) / ry)
                if d < 1.32 and d > 1.12 and int(math.degrees(math.atan2(y - my, x - mx)) / 15) % 2 == 0:
                    s.set(x, y, 'h')
                if d <= 1.0:
                    ch = 'V' if (x - mx) / rx + (y - my) / ry < -0.7 else 'U'
                    if d > 0.86:
                        ch = 'i' if x - mx + y - my < 0 else 'g'
                    s.set(x, y, ch)
        if not small:
            em = from_rows(SCORP)
            s.blit(em, round(mx - em.w / 2 + 0.5), round(my - em.h / 2 + 0.5))
        else:
            for (dx, dy) in ((0, -2), (0, -1), (0, 0), (0, 1), (-1, -1), (1, -1), (1, 2)):
                s.set(round(mx) + dx, round(my) + dy, 'i')
    else:
        # the art window's gilt lip, an inner shadow; numeral and title plaques
        for y in range(wy0 - 1, wy1 + 1):
            for x in range(wx0 - 1, wx1 + 1):
                if wx0 <= x < wx1 and wy0 <= y < wy1:
                    s.set(x, y, '0')
                elif y == wy0 - 1 or x == wx0 - 1:
                    s.set(x, y, 'g')
                else:
                    s.set(x, y, 'i')
        if not small:
            for (py0, py1, pw) in ((bw + 2, wy0 - 2, round(w * 0.42)), (wy1 + 2, h - bw - 2, round(w * 0.74))):
                x0 = round((w - pw) / 2)
                for y in range(py0, py1):
                    for x in range(x0, x0 + pw):
                        edge = y in (py0, py1 - 1) or x in (x0, x0 + pw - 1)
                        s.set(x, y, ('h' if y == py0 or x == x0 else 'g') if edge else ('3' if y == py0 + 1 else '2'))
    s.outline('k')
    META[f'card_win_{w}x{h}'] = [wx0 + 1, wy0 + 1, wx1 - wx0, wy1 - wy0]  # +1: the outline grows the sprite? (no: outline is inside bounds)
    META[f'card_win_{w}x{h}'] = [wx0, wy0, wx1 - wx0, wy1 - wy0]
    return s


# ------------------------------------------------------------------ 9-slice frames
def nine_parch(seed=1):
    """a torn parchment note, 9-slice 24x24 (corners 8): edges ragged, fibres in the field"""
    s = Spr(24, 24)
    for y in range(24):
        for x in range(24):
            e = min(x, y, 23 - x, 23 - y)
            rag = 1 if tex(x, y, seed) > 0.62 else 0
            if e < rag:
                continue
            ch = 't'
            if e <= rag + 0:
                ch = 'r'
            elif e <= rag + 1:
                ch = 's'
            elif (x * 7 + y * 3) % 11 == 0:
                ch = 's'
            elif (x * 5 + y * 9) % 17 == 0:
                ch = 'u'
            s.set(x, y, ch)
    s.outline('k')
    return s


def nine_toast():
    """a clean parchment slip with a brass inner rule and rivets, 9-slice 18x18 (corners 6)"""
    s = Spr(18, 18)
    for y in range(18):
        for x in range(18):
            e = min(x, y, 17 - x, 17 - y)
            if e == 0 and (x in (0, 17)) and (y in (0, 17)):
                continue
            ch = 't'
            if e == 0:
                ch = 'u' if y == 0 or x == 0 else 'r'
            elif e == 2:
                ch = 'h' if (y == 2 or x == 2) else 'g'
            elif y >= 16:
                ch = 's'
            s.set(x, y, ch)
    for (x, y) in ((3, 3), (14, 3), (3, 14), (14, 14)):
        s.set(x, y, 'j')
        s.set(x + 1, y + 1, 'g')
    s.outline('k')
    return s


def ribbon_end(h=18):
    """the forked tail of a title banner (left end; mirror for the right)"""
    s = Spr(12, h)
    for y in range(2, h - 1):
        for x in range(12):
            notch = x < 6 and abs(y - (h + 1) / 2) < (6 - x) * 1.4
            if notch:
                continue
            ch = 'C' if y > 3 else 'D'
            if y >= h - 3:
                ch = 'B'
            if x > 8:
                ch = 'B' if y > 3 else 'C'
            s.set(x, y, ch)
    s.outline('k')
    return s


def ribbon_mid(h=18):
    s = Spr(4, h)
    for y in range(h):
        for x in range(4):
            ch = 'C'
            if y == 0:
                ch = 'h'
            elif y == 1:
                ch = 'D'
            elif y == h - 1:
                ch = 'g'
            elif y == h - 2:
                ch = 'B'
            elif y in (3, h - 4) and x % 2 == 0:
                ch = 'i'
            s.set(x, y, ch)
    return s


# ------------------------------------------------------------------ the god of knowledge
def cartouche(h=56):
    """Thoth's cartouche: a gold-rope rounded frame on night lapis; left cap, a tile, right cap with the tie bar"""
    R = 10

    def px_at(X, Y, W):
        """distance inside the rounded rect [0,W]x[0,h] with corner radius R (negative = outside)"""
        cx = min(max(X, R), W - R)
        cy = min(max(Y, R), h - R)
        return R - math.hypot(X - cx, Y - cy) if (X < R or X > W - R) and (Y < R or Y > h - R) else min(X, Y, W - X, h - Y)

    def paint(c, x, y, e):
        if e < 0:
            return
        if e < 2.2:
            k = (x + y) % 3
            ch = ('j' if k == 0 else 'i') if e < 1.2 else ('h' if k else 'g')
        elif e < 3.2:
            ch = 'f'
        else:
            ch = 'T' if (x * 3 + y * 7) % 29 else 'U'
        c.set(x, y, ch)

    W = 1000
    left = Spr(R + 2, h)
    for y in range(h):
        for x in range(R + 2):
            paint(left, x, y, px_at(x + 0.5, y + 0.5, W))
    left.outline('k')
    mid = Spr(4, h)
    for y in range(h):
        for x in range(4):
            paint(mid, x, y, px_at(500 + x + 0.5, y + 0.5, W))
    mid.p[0] = ['k'] * 4
    mid.p[h - 1] = ['k'] * 4
    right = Spr(R + 6, h)
    for y in range(h):
        for x in range(R + 6):
            paint(right, x, y, px_at(W - (R + 6) + x + 0.5, y + 0.5, W))
    for y in range(5, h - 5):
        right.set(R - 1, y, 'i' if y % 3 else 'j')
        right.set(R, y, 'g')
        right.set(R + 1, y, 'k')
    right.outline('k')
    return left, mid, right


THOTH = [
    # Thoth, the ibis-headed scribe, in profile facing right: the lunar disc on its crescent,
    # the lapis tripartite wig banded in gold, the ibis head and long curved beak, a broad
    # collar of gold and jade, a pleated white kilt; he holds a scribe's tablet (the writing
    # arm is drawn over it from THOTH_ARM)
    '...........kkk................',
    '..........kijjk...............',
    '.........kijjjik..............',
    '......kk.kiiiiik.kk...........',
    '......kik.khhhk.kik...........',
    '.......kikkkkkkkik............',
    '........kkiiiiikk.............',
    '........kUUUccck..............',
    '.......kUVUcdddck.............',
    '.......kUiUccdidckkkk.........',
    '......kUUUUcccccbbbbbkk.......',
    '......kUiUUUccckkkkkkbbkk.....',
    '......kUUUUUUcbk.....kkbbk....',
    '.....kUiUUUUUUk.........kbk...',
    '.....kUUUUUUUUk..........kk...',
    '.....kUiUUUUUiUk..............',
    '....kkUUUUUUUUUk.kkkkkk.......',
    '...kiiiHiiHiiiiikkuuuuuk......',
    '..kiHiiHiiHiiHiiiktttttk......',
    '..kyiiiiiiiiiiiigktrrrtk......',
    '..kyyyyyyyyyyyyyyktttttk......',
    '..kyyyyyyyyyyyyyxktrrtsk......',
    '...kyyyyyyyyyyyyxktttttk......',
    '...kyyyyyyyyyyyxk.ksssk.......',
    '...kiiiiiiiiiiiik..kkk........',
    '...kSSSSSSSSSSSSk.............',
    '...kSSRSSSRSSSSSk.............',
    '...kSSRSSSRSSSSSSk............',
    '...kSSRSSSRSSSSSSk............',
    '...kSSSRSSSSRSSSSk............',
    '....kRRRRRRRRRRRRk............',
    '.....kyyk...kyyk..............',
    '.....kyyk...kyyk..............',
    '.....kyyk....kyyk.............',
    '.....kxyk....kyyk.............',
    '....kyyyk....kyyyk............',
    '...kyyyyk....kyyyyk...........',
    '...kkkkkk....kkkkkk...........',
]
THOTH_ARM = [
    # the writing arm from the shoulder to the tablet, the reed pen in hand: three poses
    ['.........kk.', '........kik.', 'kkkk...kik..', 'kyyykkkyk...', '.kxyyyyyk...', '..kkkkkk....'],
    ['...........', '.........kk', 'kkkk....kik', 'kyyykkkkik.', '.kxyyyyyyk.', '..kkkkkkk..'],
    ['...........', '...........', 'kkkk.......', 'kyyykkkkkk.', '.kxyyyyyyik', '..kkkkkkkjk'],
]
GLYPHS = {
    # gold ink hieroglyphs, 7 x 9: ibis, eye, ankh, feather, scarab, reed, water, sun, djed
    'ibis': ['..iii..', '.i..ii.', '....i.i', '...i...', '..iii..', '.iiiii.', '..iii..', '..i.i..', '..i.i..'],
    'eye': ['.......', '.iiiii.', 'i.....i', 'i..ii.i', '.iiiii.', '...i...', '..i..i.', '.i....i', '.......'],
    'ankh': ['..iii..', '.i...i.', '.i...i.', '..i.i..', 'iiiiiii', '...i...', '...i...', '...i...', '...i...'],
    'feather': ['....i..', '...ii..', '..iii..', '..iii..', '..iii..', '.iiii..', '.iii...', '..ii...', '..i....'],
    'scarab': ['..i.i..', '.iiiii.', 'i.iii.i', '.iiiii.', 'iiiiiii', '.iiiii.', 'i.iii.i', '..iii..', '.......'],
    'reed': ['...i...', '..iii..', '...i...', '..iii..', '...i...', '..iii..', '...i...', '...i...', '..iii..'],
    'water': ['.......', '.......', 'i..i..i', '.i.i.i.', '..i.i..', '.......', 'i..i..i', '.i.i.i.', '..i.i..'],
    'sun': ['.......', '..iii..', '.iiiii.', 'iiijiii', 'iijjjii', 'iiijiii', '.iiiii.', '..iii..', '.......'],
    'djed': ['iiiiiii', '.......', 'iiiiiii', '.......', 'iiiiiii', '..iii..', '..iii..', '..iii..', '.iiiii.'],
}


# ------------------------------------------------------------------ trail ledger pieces
def strap_v(w=12, h=24):
    s = Spr(w, h)
    for y in range(h):
        for x in range(w):
            ch = 'x'
            if x == 0:
                ch = 'z'
            elif x == 1:
                ch = 'y'
            elif x >= w - 2:
                ch = 'w' if x == w - 2 else 'v'
            if x in (2, w - 4) and y % 3 != 2:
                ch = 'N'
            if y % 8 == 4 and 4 <= x <= w - 6:
                ch = 'v' if x == 4 or x == w - 6 else 'w'  # a punched notch
            s.set(x, y, ch)
    return s


def buckle():
    s = Spr(16, 13)
    for y in range(13):
        for x in range(16):
            e = min(x, y, 15 - x, 12 - y)
            if e > 2:
                continue
            if e == 0 and (x in (0, 15)) and (y in (0, 12)):
                continue
            s.set(x, y, 'j' if (e == 0 and (y == 0 or x == 0)) else 'i' if e < 2 and x + y < 14 else 'h' if e < 2 else 'g')
    for y in range(3, 10):
        s.set(7, y, 'd')
        s.set(8, y, 'b')
    for y in range(3, 10):
        for x in range(3, 13):
            if x not in (7, 8):
                s.p[y][x] = None
    s.outline('k')
    return s


def concho(size=18):
    s = Spr(size, size)
    c = (size - 1) / 2
    r = size / 2 - 1.3

    def f(x, y):
        dx, dy = x - c, y - c
        d = math.hypot(dx, dy)
        L = lit_dir(dx / max(d, 1e-3), dy / max(d, 1e-3))
        if d > r - 2:
            a = int((math.atan2(dy, dx) + math.pi) / math.tau * 16) % 2
            return ('j' if L > 0.5 else 'i' if L > -0.2 else 'h') if a else ('h' if L > 0 else 'g')
        if d > r - 3:
            return 'f'
        return 'h' if L * d / r > -0.1 else 'g'
    s.each(disc(c + 0.5, c + 0.5, r), f)
    st = from_rows(['....k....', '...kSk...', 'kkkkSkkkk', 'kSSSSSRRk', '.kRSSSRk.', '..kSRRk..', '.kRRkQRk.', '.kQk.kQk.', '.kk...kk.'])
    s.blit(st, round(c - st.w / 2 + 0.5), round(c - st.h / 2 + 0.5))
    s.outline('k')
    return s


def compass(R=12):
    W = 2 * R + 3
    s = Spr(W, W + 5)
    c = (W - 1) / 2
    cy = c + 5
    dial = Spr(W, W + 5)

    def f(x, y):
        dx, dy = x - c, y - cy
        d = math.hypot(dx, dy)
        L = lit_dir(dx / max(d, 1e-3), dy / max(d, 1e-3))
        if d > R - 2:
            return 'j' if L > 0.6 else 'i' if L > 0.05 else 'h' if L > -0.5 else 'g'
        if d > R - 3:
            return 'f'
        a = (math.atan2(dy, dx) + math.pi / 2) % math.tau
        q = abs(((a / (math.pi / 2)) % 1) - 0.5)
        if d > R - 5 and q > 0.45:
            return 'K'
        return 'u' if L > -0.2 else 't'
    s.each(lambda x, y: (x - c - 0.5) ** 2 + (y - cy - 0.5) ** 2 <= (R + 0.3) ** 2, f)
    dial.each(lambda x, y: (x - c - 0.5) ** 2 + (y - cy - 0.5) ** 2 <= (R - 5) ** 2, lambda x, y: 'u')
    for y in range(round(cy - R) - 4, round(cy - R) + 1):
        for x in range(round(c) - 1, round(c) + 2):
            s.set(x, y, 'i' if x <= round(c) else 'g')
    s.set(round(c), round(cy - R) - 5, 'h')
    s.outline('k')
    return s, dial


def turtle_house():
    rows = [
        '.....kkkkk......',
        '....kpooonk.....',
        '...kpokkkonk....',
        '..kpooooooonk...',
        '.kpoonnnnnoonk..',
        'kkkkkkkkkkkkkkk.',
        '.kmmtmmmmmtmmk..',
        '.kmmtmmkkmtmmk..',
        '.kmmmmmkukmmmk..',
        'kHHGHHGHHGHHGk..',
        'kGHHGHHGHHGHHGk.',
        '.kGGGGGGGGGGGkHk',
        '..kHk.....kHkkk.',
        '..kkk.....kkk...',
    ]
    return from_rows(rows)


def signpost():
    s = Spr(24, 26)
    # the post
    for y in range(4, 26):
        s.set(11, y, 'o')
        s.set(12, y, 'n')
        s.set(13, y, 'm')
    s.set(12, 3, 'n')
    # two pointing boards, one each way
    for (y0, right) in ((6, True), (14, False)):
        for y in range(y0, y0 + 5):
            for x in range(3, 21):
                tip = (x >= 18) if right else (x <= 5)
                if tip and abs(y - (y0 + 2)) > (20 - x if right else x - 3) * 0.9:
                    continue
                ch = 'p' if y == y0 else 'm' if y == y0 + 4 else 'o' if (x + y) % 6 else 'n'
                s.set(x, y, ch)
        s.set(12, y0 + 2, 'c')
        s.set(12, y0 + 1, 'e')
    s.outline('k')
    return s


def cartridge():
    s = from_rows(['.Q.', 'QRS', 'QRR', 'QQR', 'hij', 'hij', 'hii', 'hii', 'ghh', 'ghh', 'fgg', 'jii'])
    s.outline('k')
    return s


def niche(n=30):
    s = Spr(n, n)
    for y in range(n):
        for x in range(n):
            e = min(x, y, n - 1 - x, n - 1 - y)
            ch = 'T'
            if e == 0:
                ch = 'j' if (x == 0 or y == 0) else 'g'
            elif e == 1:
                ch = 'i' if (x + y) % 3 else 'h'
            elif e == 2:
                ch = 'f'
            s.set(x, y, ch)
    return s


def nine_key():
    """a key cap: bone face lit on top, a deep bottom lip, rounded ink corners (9-slice, corners 5)"""
    w, h = 14, 18
    s = Spr(w, h)
    for y in range(h):
        for x in range(w):
            corner = (x in (0, w - 1)) and (y in (0, h - 1))
            if corner:
                continue
            if x in (0, w - 1) or y in (0, h - 1):
                ch = 'k'
            elif y >= h - 4:
                ch = 'r' if y < h - 2 else 'q'
                if x in (1, w - 2):
                    ch = 'q'
            elif y == 1:
                ch = 'u'
            elif x == 1:
                ch = 'u' if y < h - 6 else 't'
            elif x == w - 2:
                ch = 's'
            else:
                ch = 't'
            s.set(x, y, ch)
    s.set(1, 1, 'k')
    s.set(w - 2, 1, 'k')
    s.set(1, h - 2, 'k')
    s.set(w - 2, h - 2, 'k')
    return s


def nine_track():
    """a gauge well: dark leather sunk in a brass-riveted frame (9-slice, corners 5)"""
    w, h = 16, 14
    s = Spr(w, h)
    for y in range(h):
        for x in range(w):
            e = min(x, y, w - 1 - x, h - 1 - y)
            if e == 0 and (x in (0, w - 1)) and (y in (0, h - 1)):
                continue
            if e == 0:
                ch = 'k'
            elif e == 1:
                ch = 'i' if (y == 1 or x == 1) else 'g'
            elif e == 2:
                ch = 'f'
            else:
                ch = 'v' if y == 3 else 'w'
            s.set(x, y, ch)
    for (x, y) in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)):
        s.set(x, y, 'j')
    return s


def build(small=False):
    pass
def signpost():
    s = Spr(24, 26)
    # the post
    for y in range(4, 26):
        s.set(11, y, 'o')
        s.set(12, y, 'n')
        s.set(13, y, 'm')
    s.set(12, 3, 'n')
    # two pointing boards, one each way
    for (y0, right) in ((6, True), (14, False)):
        for y in range(y0, y0 + 5):
            for x in range(3, 21):
                tip = (x >= 18) if right else (x <= 5)
                if tip and abs(y - (y0 + 2)) > (20 - x if right else x - 3) * 0.9:
                    continue
                ch = 'p' if y == y0 else 'm' if y == y0 + 4 else 'o' if (x + y) % 6 else 'n'
                s.set(x, y, ch)
        s.set(12, y0 + 2, 'c')
        s.set(12, y0 + 1, 'e')
    s.outline('k')
    return s


def cartridge():
    s = from_rows(['.Q.', 'QRS', 'QRR', 'QQR', 'hij', 'hij', 'hii', 'hii', 'ghh', 'ghh', 'fgg', 'jii'])
    s.outline('k')
    return s


def niche(n=30):
    s = Spr(n, n)
    for y in range(n):
        for x in range(n):
            e = min(x, y, n - 1 - x, n - 1 - y)
            ch = 'T'
            if e == 0:
                ch = 'j' if (x == 0 or y == 0) else 'g'
            elif e == 1:
                ch = 'i' if (x + y) % 3 else 'h'
            elif e == 2:
                ch = 'f'
            s.set(x, y, ch)
    return s


def nine_key():
    """a key cap: bone face lit on top, a deep bottom lip, rounded ink corners (9-slice, corners 5)"""
    w, h = 14, 18
    s = Spr(w, h)
    for y in range(h):
        for x in range(w):
            corner = (x in (0, w - 1)) and (y in (0, h - 1))
            if corner:
                continue
            if x in (0, w - 1) or y in (0, h - 1):
                ch = 'k'
            elif y >= h - 4:
                ch = 'r' if y < h - 2 else 'q'
                if x in (1, w - 2):
                    ch = 'q'
            elif y == 1:
                ch = 'u'
            elif x == 1:
                ch = 'u' if y < h - 6 else 't'
            elif x == w - 2:
                ch = 's'
            else:
                ch = 't'
            s.set(x, y, ch)
    s.set(1, 1, 'k')
    s.set(w - 2, 1, 'k')
    s.set(1, h - 2, 'k')
    s.set(w - 2, h - 2, 'k')
    return s


def nine_track():
    """a gauge well: dark leather sunk in a brass-riveted frame (9-slice, corners 5)"""
    w, h = 16, 14
    s = Spr(w, h)
    for y in range(h):
        for x in range(w):
            e = min(x, y, w - 1 - x, h - 1 - y)
            if e == 0 and (x in (0, w - 1)) and (y in (0, h - 1)):
                continue
            if e == 0:
                ch = 'k'
            elif e == 1:
                ch = 'i' if (y == 1 or x == 1) else 'g'
            elif e == 2:
                ch = 'f'
            else:
                ch = 'v' if y == 3 else 'w'
            s.set(x, y, ch)
    for (x, y) in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)):
        s.set(x, y, 'j')
    return s


def build(small=False):
    pass


def main():
    add('cyl', cylinder(34))
    add('cyl_socket', socket())
    add('round_brass', round_head('brass'))
    add('round_venom', round_head('venom'))
    add('round_spent', round_head('spent'))
    add('cyl_notch', notch())
    add('casing0', casing(0))
    add('casing1', casing(math.pi / 4))
    add('shell', shell())
    add('shell_s', shell(8, 19))
    add('drum', drum(36))
    add('drum_s', drum(24))
    add('star', star(26))
    add('star_s', star(17))
    for f in range(4):
        add(f'coin{f}', coin(f))
    for w in range(4):
        for b in range(2):
            add(f'heart{3 - w}_{b}', heart(b, 3 - w))
    back, mask, front, top = jar_layers()
    add('jar_back', back)
    add('jar_mask', mask)
    add('jar_front', front)
    META['jar_top'] = top
    for p in range(3):
        add(f'jar_lid{p}', lid(p))
    add('plank', plank(92, 30))
    add('plank_s', plank(58, 20))
    add('plaque', plaque(136, 32))
    add('plaque_s', plaque(84, 22))
    add('link_f', link(False))
    add('link_e', link(True))
    add('tag', tag(38, 14))
    add('tag_s', tag(26, 11))
    w, dial = watch(17)
    add('watch', w)
    add('watch_dial', dial)
    add('watch_lid', watch_lid(17))
    ws, dials = watch(11)
    add('watch_s', ws)
    add('watch_dial_s', dials)
    add('watch_lid_s', watch_lid(11))
    add('nail', nail())
    add('gear_socket', gear_socket())
    add('gem', gem())
    for k in ['head', 'body', 'hands', 'feet', 'tool', 'charm', 'turbo', 'wings', 'blades']:
        add('slot_' + k, slot_icon(k))
    for g in ('revolver', 'shotgun', 'tommy'):
        add('gun_' + g, gun(g))
    add('prize_x', x_marker())
    add('prize_map', map_scrap())
    add('prize_blueprint', blueprint())
    add('arrow', arrow(False))
    add('arrow_d', arrow(True))
    mid, end = belt()
    add('belt_mid', mid)
    add('belt_end', end)
    mid, end = belt(20, 10)
    add('belt_mid_s', mid)
    add('belt_end_s', end)
    for (w, h) in ((46, 75), (56, 92), (24, 39), (29, 47)):
        add(f'card_face_{w}x{h}', card(w, h, False))
        add(f'card_back_{w}x{h}', card(w, h, True))
    add('nine_parch', nine_parch(1))
    add('nine_parch2', nine_parch(4))
    add('nine_toast', nine_toast())
    add('ribbon_end', ribbon_end(28))
    add('ribbon_mid', ribbon_mid(28))
    l, m, r = cartouche(56)
    add('cart_l', l)
    add('cart_m', m)
    add('cart_r', r)
    add('thoth', from_rows(THOTH))
    for i, a in enumerate(THOTH_ARM):
        add(f'thoth_arm{i}', from_rows(a))
    for k, g in GLYPHS.items():
        add('glyph_' + k, from_rows(g))
    add('strap', strap_v())
    add('buckle', buckle())
    add('concho', concho())
    cp, cd = compass()
    add('compass', cp)
    add('compass_dial', cd)
    add('turtle_house', turtle_house())
    add('concho_l', concho(26))
    add('signpost', signpost())
    add('cart', cartridge())
    add('niche', niche(30))
    add('nine_key', nine_key())
    add('nine_track', nine_track())


def export(path):
    names = sorted(S.keys())
    out = ['// GENERATED pixel-art data for the run HUD, the trail ledger, toasts and the codex (Thoth) card.',
           '// Each sprite is a palette-indexed grid authored for the HUD\'s pixel scale: one char per pixel,',
           "// '.' transparent, every other char a colour of HUD_PAL (PixelUI.ts). Drawn by PixelUI.sprite().",
           "import type { PixelSprite } from './PixelUI';", '',
           'export const HUD_ART: Record<string, PixelSprite> = {']
    for n in names:
        sp = S[n]
        out.append(f"  {n}: {{ w: {sp.w}, h: {sp.h}, rows: [")
        for r in sp.rows():
            out.append(f"    '{r}',")
        out.append('  ] },')
    out.append('};')
    out.append('')
    out.append('/** measured layout facts of the authored art (art windows, the jar\'s glass top row) */')
    out.append('export const HUD_ART_META = ' + json.dumps(META) + ' as const;')
    out.append('')
    open(path, 'w').write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
    out = sys.argv[1] if len(sys.argv) > 1 else 'preview.png'
    sheet(list(S.items()), out, scale=int(sys.argv[2]) if len(sys.argv) > 2 else 5)
    if len(sys.argv) > 3:
        export(sys.argv[3])
    print(len(S), 'sprites', META)
