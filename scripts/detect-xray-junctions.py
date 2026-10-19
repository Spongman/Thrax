"""Reads the MARS 4.5 datapath images and records where a junction dot was painted.

The vertex graph says which wire carries a value next; it does not say whether
two wires that cross are joined.  The drawing answered that, with a dot
at every real junction and a bare crossing elsewhere, so the drawing is the
authority and this pulls the answer out of it.

Every place two wires could join -- a crossing, or one wire's end landing on
another -- is measured against the image.  A three-pixel wire leaves about a
line's worth of ink in a small window, a bare crossing about two lines' worth,
and a dot a good deal more, so the cases separate.

Run from the repository root, with a checkout of MARS 4.5 in BASE:
    python scripts/detect-xray-junctions.py
Needs pillow and numpy, which the app itself does not.
"""
import io
import re

import numpy as np
from PIL import Image

BASE = 'C:/Users/PiersH/AppData/Local/Temp/thraxorig/images/'
SOURCE = 'src/architectures/mips/tools/xray/datapaths.ts'
OUT = 'src/architectures/mips/tools/xray/junctions.ts'

IMAGES = [
    ('datapath', 'datapath.png'),
    ('control', 'control.png'),
    ('aluControl', 'ALUcontrol.png'),
    ('register', 'register.png'),
]

# How near a wire's end has to be to another wire to be a candidate joint.
REACH = 16
# Half the window ink is measured in.
HALF = 4
# A crossing already holds about twice what a plain wire does, so a dot has to
# clear more than that; the exact line is found per drawing, below.
CROSSING_RATIO = 1.5

source = io.open(SOURCE, encoding='utf-8').read()

VERTEX = re.compile(
    r"\{ index: (\d+), name: '([^']*)', init: (-?\d+), end: (-?\d+), "
    r"otherAxis: (-?\d+), movingXaxis: (true|false), targets: \[([^\]]*)\], isText: (true|false)")


def wires_of(diagram):
    start = source.index('\t%s: {' % diagram)
    end = source.index('\n\t},', start)
    out = []
    for match in VERTEX.finditer(source[start:end]):
        index, name, init, finish, axis, moving, _targets, is_text = match.groups()
        if is_text == 'true':
            continue
        out.append(dict(index=int(index), name=name, horizontal=moving == 'true', axis=int(axis),
                        low=min(int(init), int(finish)), high=max(int(init), int(finish))))
    return out


def candidates(wires):
    """Every point where two wires cross or one ends against another."""
    points = set()
    for a in wires:
        for b in wires:
            if b['index'] <= a['index'] or a['horizontal'] == b['horizontal']:
                continue
            horizontal, vertical = (a, b) if a['horizontal'] else (b, a)
            x, y = vertical['axis'], horizontal['axis']
            # Both have to reach the crossing, give or take a wire's end.
            if not (horizontal['low'] - REACH <= x <= horizontal['high'] + REACH):
                continue
            if not (vertical['low'] - REACH <= y <= vertical['high'] + REACH):
                continue
            points.add((x, y))
    return sorted(points)


def ink_at(dark, cx, cy):
    best = 0
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            x, y = cx + dx, cy + dy
            patch = dark[max(0, y - HALF):y + HALF + 1, max(0, x - HALF):x + HALF + 1]
            best = max(best, int(patch.sum()))
    return best


blocks = []
for diagram, filename in IMAGES:
    pixels = np.asarray(Image.open(BASE + filename).convert('RGB')).astype(int)
    dark = pixels.max(axis=2) < 110
    wires = wires_of(diagram)
    points = candidates(wires)

    # What a plain length of wire leaves, measured well away from any candidate.
    plain = []
    for wire in wires:
        middle = (wire['low'] + wire['high']) // 2
        x, y = (middle, wire['axis']) if wire['horizontal'] else (wire['axis'], middle)
        if all(abs(x - px) + abs(y - py) > 20 for px, py in points):
            plain.append(ink_at(dark, x, y))
    plain.sort()
    typical = plain[len(plain) // 2] if plain else 9

    # Dotted and undotted points separate into two clear groups, so the line
    # goes in the widest gap between them rather than at a guessed ratio.
    inks = {point: ink_at(dark, *point) for point in points}
    ordered = sorted(set(inks.values()))
    upper = [value for value in ordered if value >= typical * CROSSING_RATIO]
    gap, cut = 0, max(ordered, default=0) + 1
    for lower, higher in zip(upper, upper[1:]):
        if higher - lower > gap:
            gap, cut = higher - lower, (lower + higher) / 2
    dots = sorted(point for point, value in inks.items() if value >= cut)
    print('%-11s %4d candidates, %3d dotted (plain wire holds %d, dot above %.1f)'
          % (diagram, len(points), len(dots), typical, cut))
    rows = ',\n'.join('\t\t[%d, %d]' % (x, y) for x, y in dots)
    blocks.append('\t%s: [\n%s,\n\t],' % (diagram, rows))

header = """/**
 * Where a junction dot is painted.
 *
 * The vertex graph records which wire carries a value next, not whether two
 * wires that cross are joined; the drawing answered that, with a dot at a real
 * junction and a bare crossing everywhere else.  These are those dots, read
 * back out of the images by `scripts/detect-xray-junctions.py` and given in the
 * same coordinates as the vertices.
 *
 * Generated, not written.
 */

import type { XrayDiagram } from './datapaths'

export const XRAY_DOTS: Record<XrayDiagram, [number, number][]> = {
"""

io.open(OUT, 'w', encoding='utf-8', newline='').write(header + '\n'.join(blocks) + '\n}\n')
print('wrote', OUT)
