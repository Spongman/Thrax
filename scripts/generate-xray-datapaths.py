"""Turns the four X-Ray datapath XML files of MARS 4.5 into one TypeScript module.

Run from the repository root with a checkout of MARS 4.5 in BASE:
    python scripts/generate-xray-datapaths.py
"""
import io
import re
import xml.etree.ElementTree as ET

BASE = 'C:/Users/PiersH/AppData/Local/Temp/thraxorig/'
OUT = 'src/architectures/mips/tools/xray/datapaths.ts'

# Name, source XML, and the size of the drawing its coordinates are in.
DIAGRAMS = [
    ('datapath', 'MipsXRayOpcode.xml', 1000, 574),
    ('control', 'controlDatapath.xml', 800, 498),
    ('aluControl', 'ALUcontrolDatapath.xml', 800, 457),
    ('register', 'registerDatapath.xml', 800, 480),
]

# The XML tag for each colour, and the key it becomes here.
COLOR_KEYS = [
    ('color_Itype', 'itype'),
    ('color_Rtype', 'rtype'),
    ('color_Jtype', 'jtype'),
    ('color_LOADtype', 'load'),
    ('color_STOREtype', 'store'),
    ('color_BRANCHtype', 'branch'),
    ('ALU_out010', 'alu010'),
    ('ALU_out110', 'alu110'),
    ('ALU_out000', 'alu000'),
    ('ALU_out001', 'alu001'),
    ('ALU_out111', 'alu111'),
]


def parse(name):
    text = io.open(BASE + name, encoding='utf-8').read()
    text = re.sub(r'<!DOCTYPE.*?\]>', '', text, flags=re.S)
    return ET.fromstring(text)


def table(root, tree):
    """The <bits>/<mnemonic> pairs under one equivalence element."""
    pairs = {}
    for item in root.findall(tree):
        bits = [node.text.strip() for node in item.findall('bits')]
        names = [node.text.strip() for node in item.findall('mnemonic')]
        for key, value in zip(bits, names):
            pairs[key] = value
    return pairs


palette = []


def color(text):
    red, green, blue = (int(part) for part in text.strip().split('#'))
    value = '#%02x%02x%02x' % (red, green, blue)
    if value not in palette:
        palette.append(value)
    return palette.index(value)


def vertices(root):
    item = root.find('datapath_map')
    lists = {tag: [node.text for node in item.findall(tag)]
             for tag in ['num_vertex', 'name', 'init', 'end', 'other_axis', 'isMovingXaxis', 'target_vertex', 'is_text']}
    colors = {key: [node.text for node in item.findall(tag)] for tag, key in COLOR_KEYS if item.find(tag) is not None}
    out = []
    for i in range(len(lists['num_vertex'])):
        out.append({
            'index': int(lists['num_vertex'][i]),
            'name': lists['name'][i].strip(),
            'init': int(lists['init'][i]),
            'end': int(lists['end'][i]),
            'otherAxis': int(lists['other_axis'][i]),
            'movingXaxis': lists['isMovingXaxis'][i].strip() == 'true',
            'targets': [int(part) for part in lists['target_vertex'][i].strip().split('#')],
            'isText': lists['is_text'][i].strip() == 'true',
            'colors': {key: color(values[i]) for key, values in colors.items()},
        })
    return out


def ts_string(text):
    return "'%s'" % text.replace('\\', '\\\\').replace("'", "\\'")


def emit_table(name, pairs):
    if not pairs:
        return ''
    rows = ',\n'.join('\t%s: %s' % (ts_string(bits), ts_string(value)) for bits, value in pairs.items())
    return 'export const %s: Record<string, string> = {\n%s,\n}\n\n' % (name, rows)


chunks = []
diagram_bodies = []
tables = []

for key, xml, width, height in DIAGRAMS:
    root = parse(xml)
    verts = vertices(root)
    rows = []
    for v in verts:
        colors = ', '.join('%s: %d' % (name, index) for name, index in v['colors'].items())
        rows.append(
            '\t\t{ index: %d, name: %s, init: %d, end: %d, otherAxis: %d, movingXaxis: %s, targets: [%s], isText: %s, colors: { %s } }'
            % (v['index'], ts_string(v['name']), v['init'], v['end'], v['otherAxis'],
               'true' if v['movingXaxis'] else 'false', ', '.join(str(t) for t in v['targets']),
               'true' if v['isText'] else 'false', colors))
    diagram_bodies.append('\t%s: {\n\t\twidth: %d,\n\t\theight: %d,\n\t\tvertices: [\n%s,\n\t\t],\n\t},'
                          % (key, width, height, ',\n'.join(rows)))

opcodes = table(parse('MipsXRayOpcode.xml'), 'equivalence')
functions = table(parse('MipsXRayOpcode.xml'), 'function_equivalence')
registers = table(parse('MipsXRayOpcode.xml'), 'register_equivalence')

header = """/**
 * Datapath drawings for the MIPS X-Ray, generated from the four X-Ray datapath
 * XML files.  Each vertex is one wire segment:
 * it grows from `init` to `end` along one axis at `otherAxis`, and when it
 * arrives its `targets` start growing in turn.  Coordinates are pixels in the
 * space the drawing in `blocks.ts` is measured in.
 *
 * Generated, not written.  Edit the source XML and regenerate instead.
 */

/** How a wire is coloured, chosen by the instruction being animated. */
export type XrayColorKey = 'itype' | 'rtype' | 'jtype' | 'load' | 'store' | 'branch'
	| 'alu010' | 'alu110' | 'alu000' | 'alu001' | 'alu111'

export interface XrayVertex {
	index: number
	name: string
	init: number
	end: number
	/** The coordinate on the axis the segment does not travel along. */
	otherAxis: number
	movingXaxis: boolean
	targets: number[]
	/** A label rather than a wire; these have no track. */
	isText: boolean
	/** Palette index per colour key. */
	colors: Partial<Record<XrayColorKey, number>>
}

export interface XrayDatapath {
	width: number
	height: number
	vertices: XrayVertex[]
}

export type XrayDiagram = 'datapath' | 'control' | 'aluControl' | 'register'

"""

body = 'export const XRAY_PALETTE: string[] = [\n%s,\n]\n\n' % ',\n'.join('\t%s' % ts_string(c) for c in palette)
body += 'export const XRAY_DATAPATHS: Record<XrayDiagram, XrayDatapath> = {\n%s\n}\n\n' % '\n'.join(diagram_bodies)
body += emit_table('XRAY_OPCODES', opcodes)
body += emit_table('XRAY_FUNCTIONS', functions)
body += emit_table('XRAY_REGISTERS', registers)

io.open(OUT, 'w', encoding='utf-8', newline='').write(header + body)
print('wrote %s: %d palette entries, %d opcodes, %d functions, %d registers'
      % (OUT, len(palette), len(opcodes), len(functions), len(registers)))
