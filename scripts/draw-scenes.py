#!/usr/bin/env python3
"""Writes src/today/scenes.css: the Today banner's scenes, 3 places x 4 times of day, as SVG background images,
and the weather layers drawn over them (cloudy, rain, storm x 4 times of day).

Seeded, so the same drawing every run. Run from the repo root after changing a scene:
    python3 scripts/draw-scenes.py
"""
import math
import random
from pathlib import Path

W, H = 1600, 520

PAL = {
    'dawn': dict(sky=['#1c2748', '#54497f', '#c47a80', '#f7c592'], orb='#ffe6b8', glow='#ffc48a', far='#8a6f9b', mid='#3f3a68',
                 lit='#f3a98a', near='#1e1f3e', road='#f8bd90', sea=['#a57f96', '#2a2a52'], land='#2d4a4a', cloud='#f3b7a0'),
    'day': dict(sky=['#2b74c2', '#5aa5de', '#a7d6ee', '#e8f4f1'], orb='#fffbe6', glow='#fff4c4', far='#93bad2', mid='#50818f',
                lit='#dcebe0', near='#2c5a49', road='#ecdcb4', sea=['#58b4cf', '#176a8c'], land='#3c7a56', cloud='#ffffff'),
    'dusk': dict(sky=['#0e1016', '#2b1a1c', '#8f401f', '#f28c3d'], orb='#ffd590', glow='#ff9a4a', far='#5e3026', mid='#1d1312',
                 lit='#ea863a', near='#0c0a0b', road='#f79c4b', sea=['#c0602b', '#171012'], land='#1a1412', cloud='#d9692f'),
    'night': dict(sky=['#060914', '#0c1428', '#18233f', '#2c3c5f'], orb='#eef2f8', glow='#9fb4d8', far='#1c2b49', mid='#0f1831',
                  lit='#7e94be', near='#070b18', road='#7089b9', sea=['#22345a', '#060a16'], land='#0b1226', cloud='#2c3b5e'),
}
# Where the sun or moon sits, as a share of width and height.
ORB = {'dawn': (.93, .56, 42), 'day': (.66, .33, 30), 'dusk': (.88, .56, 46), 'night': (.66, .29, 22)}
GLOW = {'dawn': .8, 'day': .7, 'dusk': .9, 'night': .28}


def pts(p):
    return ' '.join(f'{round(x)},{round(y)}' for x, y in p)


def closed(line, bottom=H):
    return [(line[0][0], bottom)] + line + [(line[-1][0], bottom)]


def noise(rng, n, rough):
    """Midpoint displacement: n+1 values, jagged like a ridge line."""
    v = [0.0] * (n + 1)
    step, amp = n, 1.0
    while step > 1:
        half = step // 2
        for i in range(half, n, step):
            v[i] = (v[i - half] + v[i + half]) / 2 + rng.uniform(-amp, amp)
        step, amp = half, amp * rough
    return v


def ridge(seed, base, peaks, jag, n=128, rough=.56):
    """A skyline: peaks are (x, height, half-width); jag is how rough it is."""
    rng = random.Random(seed)
    nz = noise(rng, n, rough)
    line = []
    for i in range(n + 1):
        x = W * i / n
        env = max([h * max(0, 1 - abs(x - px) / w) ** 1.15 for px, h, w in peaks] + [0])
        line.append((x, base - env + nz[i] * jag * (.35 + min(env, 200) / 200)))
    return line


def facets(seed, line, base, lit_right, gap=14):
    """Sunlit rock faces, cut down from each summit on the line."""
    rng = random.Random(seed)
    step = 1 if lit_right else -1
    out = []
    for i in range(gap, len(line) - gap):
        x, y = line[i]
        if y > base - 40 or y != min(p[1] for p in line[i - gap:i + gap + 1]):
            continue
        j = i
        while 0 < j + step < len(line) and abs(j - i) < 36 and line[j + step][1] >= line[j][1] - 5:
            j += step
        spine, sx, sy = [(x, y)], x, y
        drop = (base - y) / 7
        for _ in range(7):
            sx += rng.uniform(-24, 10) * step
            sy += drop
            spine.append((sx, sy))
        out.append(line[min(i, j):max(i, j) + 1][::step] + [(line[j][0] + 22 * step, base)] + spine[::-1])
    return out


def streaks(seed, line, base, summits, lit_right, fill_lit, fill_dark):
    """Thin gullies of light and shadow, so the rock reads as rock up close."""
    rng = random.Random(seed)
    s = ''
    for x, y in line[::2]:
        room = base - y
        if room < 45:
            continue
        near = min(summits, key=lambda p: abs(p[0] - x))[0]
        sunny = (x > near) == lit_right
        down = rng.uniform(.28, .78) * room
        lean = (1 if x > near else -1) * rng.uniform(.12, .5) * down
        wide = rng.uniform(3, 11)
        pts_ = [(x, y + 2), (x + lean, y + down), (x + wide + lean * .5, y + down * .55)]
        fill = fill_lit if sunny else fill_dark
        s += f'<polygon points="{pts(pts_)}" fill="{fill}" opacity="{rng.uniform(.25, .7):.2f}"/>'
    return s


def sky(p, key):
    stops = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in zip((0, .4, .72, 1), p['sky']))
    return f'<linearGradient id="{key}s" x2="0" y2="1">{stops}</linearGradient><rect width="{W}" height="{H}" fill="url(#{key}s)"/>'


def orb(p, key, time, y_share=None):
    ox, oy, r = ORB[time]
    cx, cy = ox * W, (y_share if y_share is not None else oy) * H
    s = (f'<radialGradient id="{key}g"><stop offset="0" stop-color="{p["glow"]}" stop-opacity="{GLOW[time]}"/>'
         f'<stop offset="1" stop-color="{p["glow"]}" stop-opacity="0"/></radialGradient>'
         f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r * 7}" fill="url(#{key}g)"/>'
         f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{r}" fill="{p["orb"]}"/>')
    if time == 'night':  # A crescent: the sky colour bites the moon.
        s += f'<circle cx="{cx + r * .45:.0f}" cy="{cy - r * .2:.0f}" r="{r * .85:.0f}" fill="{p["sky"][1]}"/>'
    return s, cx, cy


def extras(p, time, seed):
    rng = random.Random(seed)
    s = ''
    if time == 'night':
        for _ in range(70):
            s += f'<circle cx="{rng.uniform(0, W):.0f}" cy="{rng.uniform(0, H * .55):.0f}" r="{rng.choice((.8, 1, 1.3, 1.8))}" fill="#fff" opacity="{rng.uniform(.3, .95):.2f}"/>'
    else:
        for _ in range(5):
            cx, cy, rx, ry = rng.uniform(820, W), rng.uniform(70, 200), rng.uniform(70, 190), rng.uniform(1.5, 4.5)
            s += f'<path d="M{cx - rx:.0f} {cy:.0f}Q{cx:.0f} {cy - ry * 2:.0f} {cx + rx:.0f} {cy:.0f}Q{cx:.0f} {cy + ry:.0f} {cx - rx:.0f} {cy:.0f}Z" fill="{p["cloud"]}" opacity="{rng.uniform(.18, .38):.2f}"/>'
    return s


def mountains(key, time):
    p = PAL[time]
    orb_svg, _, _ = orb(p, key, time)
    s = sky(p, key) + extras(p, time, 3) + orb_svg
    far = ridge(11, 345, [(420, 70, 380), (900, 95, 300), (1500, 120, 340)], 24)
    s += f'<polygon points="{pts(closed(far))}" fill="{p["far"]}" opacity=".85"/>'
    summits = [(1190, 285, 420), (1450, 190, 300), (860, 120, 280), (560, 58, 240)]
    line = ridge(5, 425, summits, 34, n=256, rough=.6)
    s += f'<polygon points="{pts(closed(line))}" fill="{p["mid"]}"/>'
    s += (f'<linearGradient id="{key}l" gradientUnits="userSpaceOnUse" x1="0" y1="130" x2="0" y2="425">'
          f'<stop offset="0" stop-color="{p["lit"]}" stop-opacity=".95"/><stop offset=".62" stop-color="{p["lit"]}" stop-opacity=".12"/>'
          f'<stop offset="1" stop-color="{p["lit"]}" stop-opacity="0"/></linearGradient>')
    # The light always comes from the orb's side; high sun and moon light the left faces.
    for f in facets(7, line, 425, ORB[time][0] > .8):
        s += f'<polygon points="{pts(f)}" fill="url(#{key}l)"/>'
    s += streaks(8, line, 425, summits, ORB[time][0] > .8, f'url(#{key}l)', p['near'])
    near = ridge(21, 462, [(1050, 42, 620), (240, 26, 520), (1560, 34, 340)], 9, rough=.5)
    s += f'<polygon points="{pts(closed(near))}" fill="{p["near"]}"/>'
    s += road(p, key)
    return s


def road(p, key):
    """A winding road narrowing to the mountains."""
    left, right = [], []
    for i in range(41):
        t = i / 40
        y = 520 - t * 92
        x = 1040 + 150 * t + 88 * math.sin(t * 8.4) * (1 - t) ** 1.25
        half = 30 * (1 - t) ** 1.7 + 1.1
        left.append((x - half, y))
        right.append((x + half, y))
    grad = (f'<linearGradient id="{key}r" x2="0" y2="1"><stop offset="0" stop-color="{p["road"]}" stop-opacity=".95"/>'
            f'<stop offset="1" stop-color="{p["road"]}" stop-opacity=".55"/></linearGradient>')
    return grad + f'<polygon points="{pts(left + right[::-1])}" fill="url(#{key}r)"/>'


def palm(x, y, h, lean, color, seed):
    rng = random.Random(seed)
    tx, ty = x + lean, y - h
    s = (f'<path d="M{x - 6} {y}Q{x + lean * .25:.0f} {y - h * .55:.0f} {tx - 2:.0f} {ty:.0f}L{tx + 2:.0f} {ty:.0f}'
         f'Q{x + lean * .25 + 6:.0f} {y - h * .55:.0f} {x + 7} {y}Z" fill="{color}"/>')
    for k in range(9):
        a = math.radians(-172 + k * 21 + rng.uniform(-6, 6))
        r = h * rng.uniform(.42, .56)
        ex, ey = tx + r * math.cos(a), ty + r * math.sin(a) * .55 + r * .34
        mx, my = tx + r * .55 * math.cos(a), ty + r * .62 * math.sin(a) - r * .16
        s += f'<path d="M{tx:.0f} {ty:.0f}Q{mx:.0f} {my:.0f} {ex:.0f} {ey:.0f}Q{mx:.0f} {my + r * .17:.0f} {tx:.0f} {ty:.0f}Z" fill="{color}"/>'
    return s


def coast(key, time):
    p = PAL[time]
    horizon = 322
    orb_svg, cx, _ = orb(p, key, time, .5 if time in ('dawn', 'dusk') else None)
    s = sky(p, key) + extras(p, time, 9) + orb_svg
    s += (f'<linearGradient id="{key}w" x2="0" y2="1"><stop offset="0" stop-color="{p["sea"][0]}"/>'
          f'<stop offset="1" stop-color="{p["sea"][1]}"/></linearGradient>'
          f'<rect y="{horizon}" width="{W}" height="{H - horizon}" fill="url(#{key}w)"/>')
    # The orb's path of light on the water, in broken strokes.
    rng = random.Random(4)
    for i in range(30):
        t = i / 29
        y = horizon + 4 + t * 170
        half = rng.uniform(.45, 1) * (18 + 84 * t)
        s += f'<rect x="{cx - half + rng.uniform(-14, 14):.0f}" y="{y:.0f}" width="{half * 2:.0f}" height="{1.6 + 3 * t:.1f}" rx="2" fill="{p["orb"]}" opacity="{.55 - .3 * t:.2f}"/>'
    head = ridge(31, horizon + 3, [(1540, 150, 300), (1240, 54, 150)], 12)
    s += f'<polygon points="{pts(closed(head, horizon + 3))}" fill="{p["far"]}"/>'
    head2 = ridge(33, horizon + 12, [(1640, 120, 240)], 8)
    s += f'<polygon points="{pts(closed(head2, horizon + 24))}" fill="{p["mid"]}"/>'
    sand = [(x, 508 - 62 * math.exp(-((x - 1600) / 520) ** 2) + 4 * math.sin(x / 90)) for x in range(0, W + 1, 40)]
    s += f'<polygon points="{pts(closed(sand))}" fill="{p["near"]}"/>'
    s += palm(1490, 480, 230, -56, p['near'], 1) + palm(1395, 498, 168, 34, p['near'], 2) + palm(1570, 470, 280, -30, p['near'], 6)
    return s


def volcano(key, time):
    p = PAL[time]
    orb_svg, _, _ = orb(p, key, time)
    s = sky(p, key) + extras(p, time, 14) + orb_svg
    # A far volcano cone, for the Costa Rican skyline.
    cone = ridge(41, 372, [(1120, 230, 370)], 5)
    s += f'<polygon points="{pts(closed(cone))}" fill="{p["far"]}"/>'
    s += streaks(42, cone, 372, [(1120, 230, 370)], ORB[time][0] > .8, p['lit'], p['mid'])
    s += f'<ellipse cx="1125" cy="150" rx="88" ry="7" fill="{p["cloud"]}" opacity=".55"/><ellipse cx="1180" cy="168" rx="56" ry="5" fill="{p["cloud"]}" opacity=".4"/>'
    layers = [(370, 26, p['mid'], .55, 0), (405, 30, p['mid'], 1, 2), (448, 26, p['land'], 1, 4), (488, 20, p['near'], 1, 6)]
    for n, (base, amp, col, op, ph) in enumerate(layers):
        rng = random.Random(50 + n)
        line = []
        for x in range(0, W + 1, 6):
            roll = amp * math.sin(x / (250 - n * 25) + ph) + amp * .5 * math.sin(x / 83 + ph * 2)
            bump = rng.uniform(0, 5 + n * 2.2) if n else 0  # treetops
            line.append((x, base - roll - bump))
        s += f'<polygon points="{pts(closed(line))}" fill="{col}" opacity="{op}"/>'
    return s


SCENES = {'mountains': mountains, 'coast': coast, 'volcano': volcano}


# Cloud colours per time of day: (deep, mid, light), toned to each scene palette.
CLOUD = {
    'dawn': ('#2f2a44', '#5a4f6c', '#a07f8f'),
    'day': ('#55616d', '#7c8893', '#aab4bc'),
    'dusk': ('#1c1416', '#3d2824', '#7a4430'),
    'night': ('#080c18', '#141c31', '#26324d'),
}
# How heavy each weather is: sky wash at the top, at the horizon and on the land, clouds, rain.
LOOK = {
    'cloudy': dict(top=.6, mid=.35, low=.08, clouds=7, rain=0),
    'rain': dict(top=.97, mid=.72, low=.3, clouds=11, rain=.5),
    'storm': dict(top=1, mid=.85, low=.45, clouds=14, rain=.7),
}


def cloud(rng, cx, base, w, fill, op):
    """A flat-bottomed cumulus: a row of round bumps, tallest in the middle."""
    n = rng.randint(4, 6)
    step = w / n
    d = f'M{cx - w / 2:.0f} {base:.0f}'
    for i in range(n):
        mid = 1 - abs((i + .5) / n - .5) * 1.2
        r = step * rng.uniform(.52, .62) * (.8 + mid * .5)
        d += f'A{r:.0f} {r * .75:.0f} 0 1 1 {cx - w / 2 + step * (i + 1):.0f} {base:.0f}'
    return f'<path d="{d}Z" fill="{fill}" opacity="{op:.2f}"/>'


def overlay(weather, time):
    look, (deep, mid, light) = LOOK[weather], CLOUD[time]
    rng = random.Random(f'{weather}{time}')
    k = f'w{weather[0]}{time[:2]}'
    # The wash: thick at the top (hides the sun or moon in rain), thinner over the land so the scene still shows.
    s = (f'<linearGradient id="{k}" x2="0" y2="1"><stop offset="0" stop-color="{deep}" stop-opacity="{look["top"]}"/>'
         f'<stop offset=".45" stop-color="{mid}" stop-opacity="{look["mid"]}"/>'
         f'<stop offset="1" stop-color="{deep}" stop-opacity="{look["low"]}"/></linearGradient>'
         f'<rect width="{W}" height="{H}" fill="url(#{k})"/>')
    # Clouds back to front: far ones low and dark, near ones high, big and lit on top.
    for i in range(look['clouds']):
        t = i / max(1, look['clouds'] - 1)
        fill = (mid, mid, light)[min(2, int(t * 3))]
        w = rng.uniform(300, 560) * (.7 + t * .5)
        s += cloud(rng, rng.uniform(-80, W + 80), 250 - t * 160 + rng.uniform(-20, 20), w, fill, rng.uniform(.8, .97))
    if look['rain']:  # The sun or moon goes behind a cloud of its own.
        ox, oy, r = ORB[time]
        s += (f'<radialGradient id="{k}o"><stop offset=".45" stop-color="{mid}" stop-opacity=".97"/>'
              f'<stop offset="1" stop-color="{mid}" stop-opacity="0"/></radialGradient>')
        for y in (oy * H, .5 * H):  # coast draws a low sun at dawn and dusk at half height
            s += f'<circle cx="{ox * W:.0f}" cy="{y:.0f}" r="{r * 4:.0f}" fill="url(#{k}o)"/>'
        s += cloud(rng, ox * W, oy * H + r * 2, r * 16, mid, 1)
    if look['rain']:  # Rain as one small tile, repeated: keeps the file small.
        drops = ''
        for _ in range(26):
            x, y, ln = rng.uniform(0, 240), rng.uniform(0, 200), rng.uniform(30, 70)
            drops += (f'<line x1="{x:.0f}" y1="{y:.0f}" x2="{x - ln * .22:.0f}" y2="{y + ln:.0f}" stroke="{light}" '
                      f'stroke-width="{rng.choice((1.2, 1.6, 2))}" stroke-linecap="round" opacity="{rng.uniform(.4, 1):.2f}"/>')
        s += (f'<pattern id="{k}r" width="240" height="200" patternUnits="userSpaceOnUse" overflow="visible">{drops}</pattern>'
              f'<rect y="120" width="{W}" height="{H - 120}" fill="url(#{k}r)" opacity="{look["rain"]}"/>')
    if weather == 'storm':  # A thin forked bolt from the cloud base, away from the greeting on the left.
        main = [(1230, 150), (1214, 205), (1232, 214), (1206, 285), (1220, 292), (1198, 360)]
        fork = [(1232, 214), (1262, 250), (1255, 280)]
        line = lambda p: ' '.join(f'{x},{y}' for x, y in p)
        s += (f'<radialGradient id="{k}b"><stop offset="0" stop-color="#dfe4ff" stop-opacity=".35"/>'
              f'<stop offset="1" stop-color="#dfe4ff" stop-opacity="0"/></radialGradient>'
              f'<circle cx="1220" cy="240" r="190" fill="url(#{k}b)"/>'
              f'<polyline points="{line(main)}" fill="none" stroke="#f4f6ff" stroke-width="3.5" stroke-linejoin="round"/>'
              f'<polyline points="{line(fork)}" fill="none" stroke="#f4f6ff" stroke-width="2" stroke-linejoin="round"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMaxYMid slice">{s}</svg>'


def svg(scene, time):
    key = f'{scene[0]}{time[:2]}'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{SCENES[scene](key, time)}</svg>'


def data_url(text):
    text = text.replace('%', '%25').replace('"', "'").replace('#', '%23').replace('<', '%3C').replace('>', '%3E')
    return f'url("data:image/svg+xml,{text}")'


if __name__ == '__main__':
    rules = ['/* Written by scripts/draw-scenes.py; change the scenes there. */']
    for scene in SCENES:
        for time in PAL:
            rules.append(f'html:not(#a4t-guard) .a4t-root[data-a4t-scene="{scene}"][data-a4t-time="{time}"] .a4t-scene {{ background-image: {data_url(svg(scene, time))}; }}')
    for weather in LOOK:
        for time in PAL:
            rules.append(f'html:not(#a4t-guard) .a4t-root[data-a4t-scene][data-a4t-weather="{weather}"][data-a4t-time="{time}"] .a4t-scene::before {{ background-image: {data_url(overlay(weather, time))}; }}')
    out = '\n'.join(rules) + '\n'
    Path('src/today/scenes.css').write_text(out)
    print(f'{len(out.encode()) / 1000:.0f} KB')
