/**
 * The X-Ray drawings, out to SVG and back.
 *
 * The drawings are not SVG files: they are the vertex graph in
 * `datapaths.ts`, the blocks measured off its images in `blocks.ts`, and the
 * rules in `geometry.ts` that turn the two into lines.  Editing them by eye
 * still wants a picture, so this writes one out with every part carrying the
 * name of the thing it came from, and reads a moved one back as the changes
 * that would produce it.
 *
 *     npm run xray:svg -- out datapath           writes the drawing
 *     npm run xray:svg -- in datapath edited.svg says what moved
 *
 * Reading back reports rather than patches: what it prints goes into
 * `XRAY_REROUTES` for a wire, or the block list for a block.
 *
 * Only move things.  Adding, deleting or grouping loses the identity the
 * round trip runs on, and a wire's own colour is not editable here: it belongs
 * to the instruction format, not the drawing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { XRAY_DATAPATHS } from '../src/architectures/mips/tools/xray/datapaths'
import type { XrayDiagram } from '../src/architectures/mips/tools/xray/datapaths'
import { outlineOf, XRAY_DRAWINGS } from '../src/architectures/mips/tools/xray/blocks'
import { geometryOf } from '../src/architectures/mips/tools/xray/geometry'
import { arrowCorners, brush, DOT_RADIUS, TRACK_WIDTH } from '../src/architectures/mips/tools/xray/drawing'

/** Close enough that the difference is rounding, not an edit. */
const MOVED = 0.75

const round = (value: number) => Math.round(value * 10) / 10

function exportSvg(diagram: XrayDiagram): string {
	const { width, height } = XRAY_DATAPATHS[diagram]
	const { wires, junctions, arrows, blocks } = geometryOf(diagram)
	const drawing = XRAY_DRAWINGS[diagram]
	const parts: string[] = []

	// Inkscape shows `inkscape:label` in its objects panel and keeps it through
	// an edit, so every part says what it is there as well as in its id.
	parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"`
		+ ` viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-diagram="${diagram}">`)
	parts.push(`<rect id="ground" x="0" y="0" width="${width}" height="${height}" fill="#1e2128"/>`)

	// The blocks where the drawing settles them, which is where the app puts
	// them; a move is read back as the same move applied to the measured box.
	parts.push('<g id="blocks" inkscape:groupmode="layer" inkscape:label="blocks" fill="#3a3f4a" stroke="#8c92a0" stroke-width="1.5">')
	blocks.forEach((block, index) => {
		const { shape, x, y, width: w, height: h } = block
		const named = (block.label ?? []).join(' ') || shape
		const common = `id="block-${index}" inkscape:label="block ${index} ${named}"`
			+ ` data-kind="block" data-block="${index}" data-shape="${shape}"`
			+ (block.facing ? ` data-facing="${block.facing}"` : '')
		if (shape === 'ellipse') {
			parts.push(`<ellipse ${common} cx="${round(x + w / 2)}" cy="${round(y + h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}"/>`)
		} else if (shape === 'pill') {
			parts.push(`<rect ${common} x="${x}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(w / 2)}"/>`)
		} else if (shape === 'rect' || shape === 'rows' || shape === 'panel') {
			const fill = shape === 'panel' ? ' fill="none"' : ''
			parts.push(`<rect ${common}${fill} x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}"/>`)
		} else {
			const points = outlineOf(block).map(([px, py]) => `${round(px)},${round(py)}`).join(' ')
			parts.push(`<polygon ${common} points="${points}"/>`)
		}
		const label = (block.label ?? []).join(' ')
		if (label) parts.push(`<text data-kind="block-label" data-block="${index}" x="${round(x + w / 2)}" y="${round(y + h / 2)}" fill="#cdd0d7" font-size="${block.labelSize ?? 10}" text-anchor="middle" pointer-events="none">${label}</text>`)
	})
	parts.push('</g>')

	// One line per drawn wire, named for the vertex it came from.
	parts.push(`<g id="wires" inkscape:groupmode="layer" inkscape:label="wires" stroke="#9aa0ad" stroke-width="${TRACK_WIDTH}">`)
	for (const wire of wires) {
		const [x1, y1, x2, y2] = wire.horizontal
			? [wire.from, wire.axis, wire.to, wire.axis]
			: [wire.axis, wire.from, wire.axis, wire.to]
		const name = wire.name.replace(/[<>&"]/g, '')
		parts.push(`<line id="wire-${wire.index}" inkscape:label="wire ${wire.index} ${name}"`
			+ ` data-kind="wire" data-wire="${wire.index}" data-name="${name}"`
			+ ` data-run="${wire.horizontal ? 'horizontal' : 'vertical'}"`
			+ ` x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}">`
			+ `<title>${wire.index} ${name}</title></line>`)
	}
	parts.push('</g>')

	parts.push('<g id="captions" inkscape:groupmode="layer" inkscape:label="captions" fill="#cdd0d7">')
	drawing.texts.forEach((entry, index) => {
		parts.push(`<text id="text-${index}" inkscape:label="caption ${index} ${entry.text}"`
			+ ` data-kind="caption" data-caption="${index}"`
			+ ` x="${round(entry.x)}" y="${round(entry.y)}" font-size="${entry.size ?? 12}" text-anchor="${entry.anchor ?? 'start'}"${entry.strong ? ' font-weight="700"' : ''}>${entry.text}</text>`)
	})
	parts.push('</g>')

	// Worked out from the wires, so an edit here is not read back.
	parts.push('<g id="derived" inkscape:groupmode="layer" inkscape:label="derived (not read back)" pointer-events="none">')
	for (const junction of junctions) {
		parts.push(`<circle fill="#ffffff" cx="${round(junction.x)}" cy="${round(junction.y)}" r="${DOT_RADIUS}"/>`)
	}
	for (const arrow of arrows) {
		const points = arrowCorners(arrow).map(([x, y]) => `${round(x)},${round(y)}`).join(' ')
		parts.push(`<polygon fill="#9aa0ad" points="${points}"/>`)
	}
	parts.push('</g>')

	parts.push('</svg>')
	return parts.join('\n')
}

/** Every attribute of one tag. */
function attributesOf(tag: string): Record<string, string> {
	const found: Record<string, string> = {}
	for (const [, key, value] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) found[key] = value
	return found
}

/** A 2x3 affine transform, as SVG writes it. */
type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const times = (outer: Matrix, inner: Matrix): Matrix => [
	outer[0] * inner[0] + outer[2] * inner[1],
	outer[1] * inner[0] + outer[3] * inner[1],
	outer[0] * inner[2] + outer[2] * inner[3],
	outer[1] * inner[2] + outer[3] * inner[3],
	outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
	outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
]

const applied = (matrix: Matrix, [x, y]: [number, number]): [number, number] =>
	[matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]

/** Whatever an editor left in `transform`, as one matrix. */
function transformOf(tag: string): Matrix {
	const value = /transform\s*=\s*"([^"]*)"/.exec(tag)?.[1]
	if (!value) return IDENTITY
	let matrix = IDENTITY
	for (const [, name, args] of value.matchAll(/(\w+)\(([^)]*)\)/g)) {
		const numbers = args.trim().split(/[\s,]+/).map(Number)
		if (name === 'matrix' && numbers.length === 6) matrix = times(matrix, numbers as Matrix)
		else if (name === 'translate') matrix = times(matrix, [1, 0, 0, 1, numbers[0], numbers[1] ?? 0])
		else if (name === 'scale') matrix = times(matrix, [numbers[0], 0, 0, numbers[1] ?? numbers[0], 0, 0])
	}
	return matrix
}

/**
 * What a tag draws, as the corners of its outline.  A drawing that has been
 * through an editor holds every wire as a path, so the straight runs read back
 * here come out of `d` rather than the `x1`/`y1` they went out as.
 */
function pointsOf(tag: string): [number, number][] {
	const name = /^<(\w+)/.exec(tag)?.[1]
	const attributes = attributesOf(tag)
	const number = (key: string) => Number(attributes[key] ?? 0)
	if (name === 'line') return [[number('x1'), number('y1')], [number('x2'), number('y2')]]
	if (name === 'rect') return [[number('x'), number('y')], [number('x') + number('width'), number('y') + number('height')]]
	if (name === 'ellipse') {
		return [[number('cx') - number('rx'), number('cy') - number('ry')],
			[number('cx') + number('rx'), number('cy') + number('ry')]]
	}
	if (name === 'polygon' || name === 'polyline') {
		return (attributes.points ?? '').trim().split(/\s+/).filter(Boolean)
			.map((pair) => pair.split(',').map(Number) as [number, number])
	}
	if (name !== 'path') return []
	// The point each command leaves the pen at.  A curve is only ever a rounded
	// corner here, whose ends are the corners of the box around it, so its
	// control points are not needed to measure one.
	const ENDS: Record<string, number> = { M: 2, L: 2, T: 2, S: 4, Q: 4, C: 6, A: 7 }
	const points: [number, number][] = []
	let at: [number, number] = [0, 0]
	for (const [, letter, args] of (attributes.d ?? '').matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
		const numbers = args.trim().split(/[\s,]+/).filter(Boolean).map(Number)
		const relative = letter === letter.toLowerCase()
		if (letter.toUpperCase() === 'Z') continue
		if (letter.toUpperCase() === 'H') {
			for (const value of numbers) at = [relative ? at[0] + value : value, at[1]]
			points.push(at)
		} else if (letter.toUpperCase() === 'V') {
			for (const value of numbers) at = [at[0], relative ? at[1] + value : value]
			points.push(at)
		} else {
			const step = ENDS[letter.toUpperCase()]
			if (!step) continue
			for (let i = 0; i + step <= numbers.length; i += step) {
				const [x, y] = [numbers[i + step - 2], numbers[i + step - 1]]
				at = relative ? [at[0] + x, at[1] + y] : [x, y]
				points.push(at)
			}
		}
	}
	return points
}

/**
 * The part of the model a tag belongs to, from its own name or an ancestor's.
 * An editor rewrites an id to suit itself -- `wire-17--MUXB3` for the fourth
 * copy of one -- so the number in it is the handle, not the whole string.
 */
function identityOf(labels: string[]): { kind: string; index: number } | null {
	for (const label of labels) {
		const match = /\b(wire|block|text|caption)[\s-]+(\d+)\b/.exec(label)
		if (match) return { kind: match[1] === 'caption' ? 'text' : match[1], index: Number(match[2]) }
	}
	return null
}

interface Drawn {
	kind: string
	index: number
	points: [number, number][]
}

/** Every named shape in the file, back in the drawing's own coordinates. */
function readSvg(svg: string): Drawn[] {
	const drawn: Drawn[] = []
	const stack: { matrix: Matrix; labels: string[] }[] = [{ matrix: IDENTITY, labels: [] }]
	for (const [tag, , name, closed] of svg.matchAll(/<(\/?)(\w+)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
		const shut = tag.startsWith('</')
		if (shut) {
			if (name === 'g' && stack.length > 1) stack.pop()
			continue
		}
		const attributes = attributesOf(tag)
		const labels = [attributes['serif:id'], attributes['inkscape:label'], attributes.id].filter(Boolean)
		const here = stack[stack.length - 1]
		const matrix = times(here.matrix, transformOf(tag))
		if (name === 'g') {
			if (closed !== '/') stack.push({ matrix, labels: [...labels, ...here.labels] })
			continue
		}
		if (!['path', 'line', 'rect', 'ellipse', 'polygon', 'polyline'].includes(name)) continue
		const identity = identityOf([...labels, ...here.labels])
		if (!identity) continue
		const points = pointsOf(tag).map((point) => applied(matrix, point))
		if (points.length > 0) drawn.push({ ...identity, points })
	}
	return drawn
}

function importSvg(diagram: XrayDiagram, file: string): string[] {
	const svg = readFileSync(file, 'utf8')
	const { wires, blocks } = geometryOf(diagram)
	const drawing = XRAY_DRAWINGS[diagram]
	const report: string[] = []
	const moveAxis: string[] = []
	const spans: string[] = []

	const drawn = readSvg(svg)
	const shapesOf = (kind: string, index: number) =>
		drawn.filter((shape) => shape.kind === kind && shape.index === index)

	/** The runs a shape draws, with the specks an editor leaves thrown away. */
	const runsOf = (shapes: Drawn[]) => shapes
		.flatMap((shape) => shape.points.slice(1).map((point, at) => [shape.points[at], point] as const))
		.filter(([one, other]) => Math.hypot(other[0] - one[0], other[1] - one[1]) > 1)

	// A wire with a step in it is several pieces of one vertex, so it is looked
	// at once, as the run of pieces it is.
	const seen = new Set<number>()
	for (const wire of wires) {
		if (seen.has(wire.index)) continue
		seen.add(wire.index)
		const pieces = wires.filter((other) => other.index === wire.index)
		const shapes = shapesOf('wire', wire.index)
		if (shapes.length === 0) {
			report.push(`wire ${wire.index} ${wire.name}: gone from the drawing`)
			continue
		}
		// Two copies of one wire left on top of each other are still one wire.
		const runs = runsOf(shapes).filter((run, at, all) => all.findIndex((other) =>
			Math.abs(other[0][0] - run[0][0]) < 0.5 && Math.abs(other[0][1] - run[0][1]) < 0.5
			&& Math.abs(other[1][0] - run[1][0]) < 0.5 && Math.abs(other[1][1] - run[1][1]) < 0.5) === at)
		if (runs.length === 0) continue
		// Drawn as the same pieces the model already holds: nothing has moved.
		if (runs.length === pieces.length && pieces.every((piece) => runs.some(([one, other]) => {
			const [x1, y1, x2, y2] = piece.horizontal
				? [piece.from, piece.axis, piece.to, piece.axis]
				: [piece.axis, piece.from, piece.axis, piece.to]
			const near = Math.abs(one[0] - x1) + Math.abs(one[1] - y1) + Math.abs(other[0] - x2) + Math.abs(other[1] - y2)
			const swapped = Math.abs(one[0] - x2) + Math.abs(one[1] - y2) + Math.abs(other[0] - x1) + Math.abs(other[1] - y1)
			return Math.min(near, swapped) <= MOVED * 4
		}))) continue
		if (runs.length > 1) {
			const drawnAs = runs.map(([one, other]) =>
				`${round(one[0])},${round(one[1])} to ${round(other[0])},${round(other[1])}`)
			report.push(`wire ${wire.index} ${wire.name}: drawn as ${runs.length} runs, which one vertex cannot hold`
				+ `\n\t${drawnAs.join('\n\t')}`)
			continue
		}
		const [[x1, y1], [x2, y2]] = runs[0]
		const horizontal = Math.abs(y2 - y1) <= Math.abs(x2 - x1)
		if (horizontal !== wire.horizontal) {
			report.push(`wire ${wire.index} ${wire.name}: turned through a right angle, which one vertex cannot hold`)
			continue
		}
		const axis = horizontal ? (y1 + y2) / 2 : (x1 + x2) / 2
		const [from, to] = horizontal ? [x1, x2] : [y1, y2]
		if (Math.abs(axis - wire.axis) > MOVED) {
			report.push(`wire ${wire.index} ${wire.name}: ${horizontal ? 'y' : 'x'} ${round(wire.axis)} -> ${round(axis)}`)
			moveAxis.push(`${wire.index}: ${round(brush(axis))},`)
		}
		const ends: string[] = []
		if (Math.abs(from - wire.from) > MOVED) ends.push(`from: ${round(brush(from))}`)
		if (Math.abs(to - wire.to) > MOVED) ends.push(`to: ${round(brush(to))}`)
		if (ends.length > 0) {
			report.push(`wire ${wire.index} ${wire.name}: ends ${round(wire.from)}..${round(wire.to)} -> ${round(from)}..${round(to)}`)
			spans.push(`${wire.index}: { ${ends.join(', ')} },`)
		}
	}

	const boxes: string[] = []
	blocks.forEach((block, index) => {
		const shapes = shapesOf('block', index)
		if (shapes.length === 0) {
			report.push(`block ${index} ${(block.label ?? []).join(' ')}: gone from the drawing`)
			return
		}
		const points = shapes.flatMap((shape) => shape.points)
		const xs = points.map((point) => point[0])
		const ys = points.map((point) => point[1])
		const box: [number, number, number, number] =
			[Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
		const was: [number, number, number, number] = [block.x, block.y, block.width, block.height]
		if (box.every((value, at) => Math.abs(value - was[at]) <= MOVED)) return
		// The move is off where the block settled, so the same move goes on the
		// box it was measured at; settling then runs again from there.
		const source = drawing.blocks[index]
		const measured: [number, number, number, number] = [source.x, source.y, source.width, source.height]
		const moved = box.map((value, at) => round(measured[at] + value - was[at]))
		report.push(`block ${index} ${(block.label ?? []).join(' ') || block.shape}: ${was.map(round).join(',')} -> ${box.map(round).join(',')}`)
		boxes.push(`{ shape: '${block.shape}', x: ${moved[0]}, y: ${moved[1]}, width: ${moved[2]}, height: ${moved[3]} }, // block ${index}, as measured`)
	})

	if (moveAxis.length > 0) report.push('', `moveAxis: {\n\t${moveAxis.join('\n\t')}\n}`)
	if (spans.length > 0) report.push('', `span: {\n\t${spans.join('\n\t')}\n}`)
	if (boxes.length > 0) report.push('', `blocks:\n\t${boxes.join('\n\t')}`)
	return report
}

const [mode, diagram, file] = process.argv.slice(2)
const known = Object.keys(XRAY_DATAPATHS) as XrayDiagram[]
if (!known.includes(diagram as XrayDiagram)) {
	console.error(`usage: xray-svg out|in <${known.join('|')}> [file.svg]`)
	process.exit(1)
}
if (mode === 'out') {
	const out = file ?? `${diagram}.svg`
	writeFileSync(out, exportSvg(diagram as XrayDiagram))
	console.log(`wrote ${out}`)
} else if (mode === 'in') {
	const changes = importSvg(diagram as XrayDiagram, file)
	console.log(changes.length > 0 ? changes.join('\n') : 'nothing moved')
} else {
	console.error(`usage: xray-svg out|in <${known.join('|')}> [file.svg]`)
	process.exit(1)
}
