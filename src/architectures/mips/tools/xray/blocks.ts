/**
 * The functional units of each X-Ray drawing.
 *
 * The source datapaths are photographs of a diagram: gradient-filled ovals
 * on a teal panel, with the wiring baked into the bitmap.  The wiring is
 * already described by the vertex graph in `datapaths.ts`, so all that is left
 * to redraw is the blocks the wires run between.  Geometry here was measured
 * off those images, in the same pixel space the vertices use, so the two
 * still line up.
 */

import type { XrayDiagram } from './datapaths'
import { brush, ROW_PIN } from './drawing'

export type XrayShape =
	/** A plain box: the register file, the memories, the program counter. */
	| 'rect'
	/** The units drawn as ovals, such as the control unit. */
	| 'ellipse'
	/** A multiplexer, drawn as a tall stadium. */
	| 'pill'
	/** The notched arrow of an adder or the ALU. */
	| 'alu'
	| 'and'
	| 'or'
	/** An or gate with its inputs inverted. */
	| 'nor'
	/** The board a control diagram's gates sit on. */
	| 'panel'
	/** The register file's stack of identical rows. */
	| 'rows'

export interface XrayBlock {
	shape: XrayShape
	x: number
	y: number
	width: number
	height: number
	/** Centred text, one entry per line. */
	label?: string[]
	labelSize?: number
	/** Gates take their inputs from the left unless this says otherwise. */
	facing?: 'right' | 'down'
	/** Rows of a `rows` block, top to bottom. */
	rows?: string[]
	/** Set where other things are placed from the block, so it may not move. */
	fixed?: boolean
	/** A caption in the top-right corner, for the ALU's zero output. */
	note?: string
}

export interface XrayText {
	x: number
	y: number
	text: string
	anchor?: 'start' | 'middle' | 'end'
	size?: number
	/** Set for the headings drawn in bold. */
	strong?: boolean
}

export interface XrayDrawing {
	blocks: XrayBlock[]
	texts: XrayText[]
	/**
	 * Whether the drawing marks where a value arrives with an arrow.  Only the
	 * main datapath does: the three logic diagrams are plain lines.
	 */
	arrowheads?: boolean
}

const mux = (x: number, y: number, width = 19, height = 46): XrayBlock =>
	({ shape: 'pill', x, y, width, height, label: ['M', 'U', 'X'], labelSize: 7 })

/** The six control signals a decoded instruction drives, top to bottom. */
const CONTROL_SIGNALS = ['RegDst', 'ALUSrc', 'MemToReg', 'WriteReg', 'ReadMem', 'WriteMem', 'Branch', 'opALU1', 'opALU0']
const CONTROL_SIGNAL_Y = [226, 257, 297, 336, 374, 395, 415, 438, 461]

const datapath: XrayDrawing = {
	blocks: [
		{ shape: 'rect', x: 120, y: 353, width: 39, height: 41, label: ['PC'], labelSize: 12, fixed: true },
		// Moved left of its drawn position, to open up the lane the instruction
		// fields drop through.  It can go no further: the adder's feed off the
		// program counter runs down at x = 193.
		{ shape: 'rect', x: 202, y: 330, width: 87, height: 91, label: ['INSTRUCTION', 'MEMORY'], labelSize: 9, fixed: true },
		{ shape: 'rect', x: 426, y: 294, width: 95, height: 133, label: ['REGISTERS'], labelSize: 11 },
		{ shape: 'rect', x: 723, y: 316, width: 88, height: 91, label: ['DATA', 'MEMORY'], labelSize: 10 },
		{ shape: 'alu', x: 605, y: 301, width: 64, height: 112, label: ['ALU'], labelSize: 15, note: 'ZERO' },
		{ shape: 'alu', x: 228, y: 80, width: 46, height: 81, label: ['ADD'], labelSize: 10, fixed: true },
		{ shape: 'alu', x: 662, y: 106, width: 46, height: 80, label: ['ADD'], labelSize: 10 },
		{ shape: 'ellipse', x: 391, y: 52, width: 47, height: 50, label: ['SHIFT', 'LEFT 2'], labelSize: 8 },
		{ shape: 'ellipse', x: 561, y: 130, width: 47, height: 51, label: ['SHIFT', 'LEFT 2'], labelSize: 8 },
		{ shape: 'ellipse', x: 356, y: 179, width: 61, height: 103, label: ['CONTROL'], labelSize: 9 },
		{ shape: 'ellipse', x: 439, y: 435, width: 61, height: 66, label: ['SIGN', 'EXTEND'], labelSize: 8 },
		{ shape: 'ellipse', x: 561, y: 454, width: 62, height: 66, label: ['ALU', 'CONTROL'], labelSize: 8 },
		mux(770, 97),
		mux(814, 98),
		mux(847, 341, 19, 45),
		mux(372, 364),
		mux(557, 365),
		{ shape: 'and', x: 727, y: 183, width: 16, height: 22, facing: 'right' },
	],
	texts: [],
	arrowheads: true,
}

const control: XrayDrawing = {
	blocks: [
		{ shape: 'panel', x: 35, y: 3, width: 653, height: 490 },
		{ shape: 'and', x: 209, y: 169, width: 56, height: 48, facing: 'down' },
		{ shape: 'and', x: 314, y: 169, width: 56, height: 48, facing: 'down' },
		{ shape: 'and', x: 409, y: 168, width: 56, height: 48, facing: 'down' },
		{ shape: 'and', x: 504, y: 168, width: 56, height: 48, facing: 'down' },
		{ shape: 'or', x: 572, y: 245, width: 51, height: 50, facing: 'right' },
		{ shape: 'or', x: 578, y: 324, width: 50, height: 50, facing: 'right' },
	],
	texts: [
		...[19, 44, 68, 91, 115, 137].map((y, index) => ({ x: 2, y, text: `BIT ${5 - index}`, size: 13, strong: true })),
		...CONTROL_SIGNALS.map((text, index) => ({ x: 706, y: CONTROL_SIGNAL_Y[index], text, size: 13, strong: true })),
	],
}

const aluControl: XrayDrawing = {
	blocks: [
		{ shape: 'panel', x: 57, y: 37, width: 678, height: 420 },
		{ shape: 'or', x: 153, y: 317, width: 76, height: 72, facing: 'right' },
		{ shape: 'and', x: 298, y: 123, width: 71, height: 80, facing: 'right' },
		{ shape: 'and', x: 302, y: 289, width: 68, height: 80, facing: 'right' },
		{ shape: 'or', x: 561, y: 101, width: 77, height: 72, facing: 'right' },
		{ shape: 'nor', x: 569, y: 212, width: 75, height: 72, facing: 'right' },
	],
	texts: [
		{ x: 3, y: 90, text: 'bit 3', size: 18, strong: true },
		{ x: 3, y: 163, text: 'bit 2', size: 18, strong: true },
		{ x: 3, y: 267, text: 'bit 1', size: 18, strong: true },
		{ x: 5, y: 352, text: 'bit 0', size: 18, strong: true },
		// The drawings label these inconsistently -- "Op 1" beside "op 2", "Op
		// ALU1" beside "OpALU2" -- so they are spelled one way here.
		{ x: 744, y: 118, text: 'op 1', size: 18, strong: true },
		{ x: 744, y: 228, text: 'op 2', size: 18, strong: true },
		{ x: 746, y: 312, text: 'op 3', size: 18, strong: true },
		{ x: 167, y: 15, text: 'opALU1', size: 18, strong: true },
		{ x: 315, y: 15, text: 'opALU2', size: 18, strong: true },
	],
}

/**
 * The register file, which everything else in this drawing lines up against.
 * Its rows set where the write-enable gates sit and where their outputs land,
 * so those are worked out from it rather than measured separately.
 */
const REGISTER_NAMES = ['REGISTER 1', 'REGISTER 2', '...', 'REGISTER 31', 'REGISTER 32']
const REGISTER_FILE = { x: 377, y: 104, width: 143, height: 153 }
const ROW_HEIGHT = REGISTER_FILE.height / REGISTER_NAMES.length

/** The two pins on a row: control above, data below. */
export const registerPin = (row: number, pin: 'ctrl' | 'data') =>
	REGISTER_FILE.y + ROW_HEIGHT * (row + ROW_PIN[pin])

/**
 * A multiplexer sized to the lines arriving at it, so they land on even
 * fractions of its left edge.  The lines cannot be moved to achieve that --
 * they leave the register file where its rows are -- so the block is fitted to
 * them instead, by least squares through (even fraction, where the line is).
 */
function fitToLines(x: number, width: number, lines: number[]) {
	const places = [...lines].sort((a, b) => a - b)
	const fractions = places.map((_, index) => (index + 1) / (places.length + 1))
	const meanFraction = fractions.reduce((total, f) => total + f, 0) / places.length
	const meanPlace = places.reduce((total, place) => total + place, 0) / places.length
	const spread = fractions.reduce((total, f) => total + (f - meanFraction) ** 2, 0)
	const height = fractions
		.reduce((total, f, index) => total + (f - meanFraction) * (places[index] - meanPlace), 0) / spread
	return { x, y: meanPlace - height * meanFraction, width, height }
}

/**
 * The two output multiplexers: the register lines that reach each, top to
 * bottom, where those lines sit, and the address line that selects between them.
 */
const READ_PORTS = [
	// The upper multiplexer is fed straight off the register file's outputs, so
	// its lines are where the rows put them and the block is fitted to those.
	{ mux: fitToLines(665, 70, [121.5, 152.5, 183.5, 211.5, 243.5]), lines: [55, 53, 49, 46, 43], address: 58, fitted: true },
	// The lower one is fed by drops that can be any length, so its lines are
	// free to be spread evenly and the block keeps the size it was measured at.
	{ mux: { x: 666, y: 292, width: 71, height: 162 }, lines: [57, 54, 51, 48, 45], address: 59, fitted: false },
]

/**
 * The lane between the two read multiplexers, which the second read address
 * runs along on its way to the lower one's select input.  It was drawn hard up
 * against the upper multiplexer; it belongs half way between the two.
 */
const READ_PORT_GAP = (READ_PORTS[0].mux.y + READ_PORTS[0].mux.height + READ_PORTS[1].mux.y) / 2

/** How far above and below its line each half of a caption sits. */
const CAPTION_RISE = 9.7

const GATE = { x: 313, width: 20, height: 25 }
/** How far above and below its middle a gate takes its two inputs. */
const GATE_INPUT_SPREAD = 6

const register: XrayDrawing = {
	blocks: [
		{ shape: 'panel', x: 83, y: 38, width: 689, height: 440 },
		// Held where it was measured: the row numbers down its right edge are
		// placed from it, so sliding it would leave them off the block.
		{ shape: 'rect', x: 112, y: 92, width: 121, height: 152, label: ['N TO 1', 'DECODER'], labelSize: 13, fixed: true },
		{ shape: 'rows', ...REGISTER_FILE, rows: REGISTER_NAMES, labelSize: 12 },
		// A gate sits centred on the control pin it drives, so its output runs
		// straight across, and they are as evenly spread as the rows are.
		...REGISTER_NAMES.map((_, row): XrayBlock => ({
			shape: 'and',
			...GATE,
			y: registerPin(row, 'ctrl') - GATE.height / 2,
			facing: 'right',
		})),
		...READ_PORTS.map(({ mux }): XrayBlock => ({ shape: 'pill', ...mux, label: ['M', 'U', 'X'], labelSize: 13 })),
	],
	texts: [
		{ x: 10, y: 59, text: 'REGISTER', size: 13, strong: true },
		{ x: 8, y: 83, text: 'ADDRESS 1', size: 13, strong: true },
		// The caption straddles the line it names, so it follows it down.
		{ x: 2, y: READ_PORT_GAP - CAPTION_RISE, text: 'REGISTER', size: 13, strong: true },
		{ x: 0, y: READ_PORT_GAP + CAPTION_RISE, text: 'ADDRESS 2', size: 13, strong: true },
		{ x: 2, y: 337, text: 'REGISTER', size: 13, strong: true },
		{ x: 3, y: 358, text: 'WRITE', size: 13, strong: true },
		{ x: 8, y: 418, text: 'WRITING', size: 13, strong: true },
		{ x: 8, y: 438, text: 'DATA', size: 13, strong: true },
		// Above the straightened write-control line, not its old corner.
		{ x: 266, y: 6, text: 'WRITE', size: 13, strong: true },
		{ x: 266, y: 25, text: 'CONTROL', size: 13, strong: true },
		...REGISTER_NAMES.map((_, row) => ({
			x: 228,
			y: registerPin(row, 'ctrl') - GATE_INPUT_SPREAD,
			text: ['1', '2', '...', '31', '32'][row],
			anchor: 'end' as const,
			size: 13,
			strong: true,
		})),
	],
}

export const XRAY_DRAWINGS: Record<XrayDiagram, XrayDrawing> = { datapath, control, aluControl, register }

type Point = [number, number]

/**
 * One run of a block's outline, from wherever the last one ended.
 *
 * A nose carries the straight run into it as well as the half circle, because
 * the two share a corner and the circle is the one that names it: the outline
 * takes that corner off the circle, as it always has, while the path lines to
 * the corner arithmetic gives.  The two agree to the last bit.
 */
type XrayRun =
	/** Straight to a corner. */
	| { to: Point }
	/** A quadratic curve, dished or rounded. */
	| { control: Point; to: Point }
	/** A gate's nose: straight to `from`, then a half circle round to `to`. */
	| { centre: Point; radius: number; start: number; from: Point; to: Point }

/** Where a block's outline starts, and the runs that close it. */
interface XrayOutline {
	from: Point
	runs: XrayRun[]
}

/** How many points a curved run is sampled at. */
const SAMPLES = 12

/**
 * The one description of each block's outline, which the view draws as a path,
 * the geometry hit-tests against, and the SVG export writes out.
 */
function shapeOf({ shape, x, y, width: w, height: h, facing }: XrayBlock): XrayOutline {
	switch (shape) {
		// The notched arrow MIPS diagrams use for an adder or the ALU.
		case 'alu':
			return {
				from: [x, y],
				runs: [
					{ to: [x + w, y + h * 0.3] },
					{ to: [x + w, y + h * 0.7] },
					{ to: [x, y + h] },
					{ to: [x, y + h * 0.62] },
					{ to: [x + w * 0.3, y + h * 0.5] },
					{ to: [x, y + h * 0.38] },
				],
			}
		// A flat back and a half-round nose, pointing right or down.  The nose is
		// rounded the way it is drawn: rightward from the top, or downward from
		// the right.
		case 'and':
			if (facing === 'down') {
				const radius = w / 2
				return {
					from: [x, y],
					runs: [
						{ to: [x + w, y] },
						{ centre: [x + w / 2, y + h - radius], radius, start: 0, from: [x + w, y + h - radius], to: [x, y + h - radius] },
					],
				}
			} else {
				const radius = h / 2
				return {
					from: [x, y],
					runs: [
						{ centre: [x + w - radius, y + h / 2], radius, start: -Math.PI / 2, from: [x + w - radius, y], to: [x + w - radius, y + h] },
						{ to: [x, y + h] },
					],
				}
			}
		// A dished back and a pointed nose.
		case 'or':
		case 'nor':
			return {
				from: [x, y],
				runs: [
					{ control: [x + w * 0.4, y + h / 2], to: [x, y + h] },
					{ control: [x + w * 0.7, y + h * 0.92], to: [x + w, y + h / 2] },
					{ control: [x + w * 0.7, y + h * 0.08], to: [x, y] },
				],
			}
		default:
			return { from: [x, y], runs: [{ to: [x + w, y] }, { to: [x + w, y + h] }, { to: [x, y + h] }] }
	}
}

/** The points one run passes through, the corner it starts at excepted. */
function pointsOf(run: XrayRun, from: Point): Point[] {
	if ('centre' in run) {
		return Array.from({ length: SAMPLES + 1 }, (_, step) => {
			const angle = run.start + (step / SAMPLES) * Math.PI
			return [run.centre[0] + run.radius * Math.cos(angle), run.centre[1] + run.radius * Math.sin(angle)] as Point
		})
	}
	if ('control' in run) {
		return Array.from({ length: SAMPLES }, (_, step) => {
			const at = (step + 1) / SAMPLES
			const rest = 1 - at
			return [
				rest * rest * from[0] + 2 * rest * at * run.control[0] + at * at * run.to[0],
				rest * rest * from[1] + 2 * rest * at * run.control[1] + at * at * run.to[1],
			] as Point
		})
	}
	return [run.to]
}

/** The outline of a block, as the view draws it, sampled into straight runs. */
export function outlineOf(block: XrayBlock): Point[] {
	const { from, runs } = shapeOf(block)
	const points: Point[] = [from]
	let at = from
	for (const run of runs) {
		points.push(...pointsOf(run, at))
		at = run.to
	}
	return points
}

/** The same outline as SVG path data, with the curves kept as curves. */
export function svgPathOf(block: XrayBlock): string {
	const { from, runs } = shapeOf(block)
	const parts = [`M ${from[0]} ${from[1]}`]
	for (const run of runs) {
		if ('centre' in run) {
			parts.push(`L ${run.from[0]} ${run.from[1]}`)
			parts.push(`A ${run.radius} ${run.radius} 0 0 1 ${run.to[0]} ${run.to[1]}`)
		} else if ('control' in run) {
			parts.push(`Q ${run.control[0]} ${run.control[1]} ${run.to[0]} ${run.to[1]}`)
		} else {
			parts.push(`L ${run.to[0]} ${run.to[1]}`)
		}
	}
	parts.push('Z')
	return parts.join(' ')
}

/**
 * Whether a point is on the block as drawn, rather than merely inside the box
 * it was measured in.  An adder is an arrow and a gate is a nose: the corners
 * of the box around either are empty drawing, and a wire that stops in one is
 * hanging in mid-air however close the block looks.
 */
export function insideShape(block: XrayBlock, x: number, y: number): boolean {
	const { shape, x: bx, y: by, width: w, height: h } = block
	if (x < bx || x > bx + w || y < by || y > by + h) return false
	if (shape === 'ellipse') {
		const across = (x - bx - w / 2) / (w / 2)
		const down = (y - by - h / 2) / (h / 2)
		return across * across + down * down <= 1
	}
	if (shape === 'pill') {
		// A stadium: square in the middle, round at both ends.
		const radius = w / 2
		const near = Math.min(Math.max(y, by + radius), by + h - radius)
		return (x - bx - radius) ** 2 + (y - near) ** 2 <= radius * radius
	}
	const points = outlineOf(block)
	let inside = false
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const [ix, iy] = points[i]
		const [jx, jy] = points[j]
		if ((iy > y) === (jy > y)) continue
		if (x < ix + ((y - iy) / (jy - iy)) * (jx - ix)) inside = !inside
	}
	return inside
}

/**
 * Deliberate departures from the drawn routing, where a wire went the long way
 * round for no reason the diagram explains.
 */
export interface XrayReroute {
	/** Vertices left undrawn, because the straightened route replaces them. */
	drop: number[]
	/** Vertices whose line moves, given as vertex index to its new axis. */
	moveAxis: Record<number, number>
	/** Vertices whose run is cut back or carried on, to meet a moved line. */
	span?: Record<number, { from?: number; to?: number }>
	/**
	 * Vertices drawn with a step in them: where along the run it crosses over,
	 * and the line it carries on down.  A wire is one straight segment, so a
	 * route that has to change lane part way along is drawn as three pieces of
	 * the one wire and lights up as one.
	 */
	step?: Record<number, { at: number; axis: number }>
}

/**
 * The address line comes down the middle of its multiplexer.  The register
 * lines are left where the register file put them: they cannot be evenly spread
 * here and still leave the rows where they leave them, so the multiplexer is
 * fitted to them instead, in `geometry.ts`.
 */
const readPortWires = () => Object.fromEntries(READ_PORTS.flatMap(({ mux, lines, address, fitted }) => [
	[address, brush(mux.x + mux.width / 2)] as const,
	...(fitted ? [] : lines.map((wire, index) =>
		[wire, brush(mux.y + (mux.height * (index + 1)) / (lines.length + 1))] as const)),
]))

/** The writing-data bus, moved to the clear lane between gates and registers. */
const DATA_BUS = brush(GATE.x + GATE.width + (REGISTER_FILE.x - GATE.x - GATE.width) / 2)

/** Gates, top to bottom: the decoder input, the write-control input, the output. */
const GATE_WIRES = [
	{ fromDecoder: 28, fromControl: 20, output: 33, data: 15 },
	{ fromDecoder: 29, fromControl: 21, output: 34, data: 12 },
	{ fromDecoder: 30, fromControl: 23, output: 35, data: 13 },
	{ fromDecoder: 31, fromControl: 26, output: 36, data: 10 },
	{ fromDecoder: 32, fromControl: 27, output: 37, data: 8 },
]

/** The pieces of the writing-data bus, which used to run up the left of the gates. */
const DATA_BUS_WIRES = [6, 7, 9, 11, 14]


export const XRAY_REROUTES: Partial<Record<XrayDiagram, XrayReroute>> = {
	datapath: {
		// The ends of those lanes, as they were redrawn.  A wire pinned here is
		// not stretched to close a gap, so what is left out is what the rules
		// still work out for themselves.
		span: {
			// Drawn short of the adder's upper input; carried back up to it.
			1: { from: 373, to: 92.5 },
			// Drawn 21 pixels left of the feed it comes off; brought back to it.
			2: { from: 176 },
			3: { from: 176 },
			5: { from: 249.2 },
			6: { from: 190.5 },
			8: { from: 224.2, to: 302.5 },
			9: { from: 373, to: 75 },
			10: { from: 302.5, to: 329 },
			11: { from: 302.5 },
			15: { to: 91 },
			17: { from: 600.5, to: 780 },
			18: { to: 799 },
			19: { from: 379.5 },
			20: { from: 376.5 },
			22: { to: 466 },
			23: { from: 329 },
			26: { to: 352.3 },
			27: { from: 357.5, to: 371 },
			28: { from: 354 },
			29: { from: 346.5 },
			30: { to: 230 },
			31: { from: 326.5 },
			32: { from: 329 },
			35: { from: 589, to: 650 },
			36: { from: 485 },
			37: { to: 532 },
			38: { from: 466, to: 379 },
			39: { from: 379 },
			40: { from: 533.5 },
			42: { to: 105.8 },
			43: { from: 799 },
			46: { to: 778 },
			57: { to: 365.3 },
			59: { from: 263 },
			60: { to: 485.5 },
			61: { from: 243, to: 360.5 },
			64: { to: 360.5 },
			66: { from: 477.5, to: 542.5 },
			67: { from: 532 },
			68: { from: 397, to: 437 },
			69: { from: 542.5, to: 680 },
			70: { from: 437, to: 387 },
			71: { from: 680 },
			73: { from: 542.5, to: 564 },
			75: { to: 741.5 },
			76: { to: 430 },
			78: { from: 692 },
			80: { to: 371 },
			81: { from: 824.5, to: 856 },
			84: { to: 823 },
			85: { from: 193 },
			86: { from: 209, to: 120 },
			91: { to: 373 },
			92: { from: 85 },
		},
		// The multiplexer's feed changes lane half way along, to come in level
		// with the input it drives.
		step: { 17: { at: 739, axis: 105.8 } },
		// Three wires drawn over another: `*nodeIMrepeated` is `nodeIM`
		// twice over, as its name says; `notUsed` is `*REGinput1` a pixel away,
		// which nothing points at and so never lights; and the data memory's
		// address arrives as two segments two pixels apart.
		drop: [7, 25, 77],
		// The lanes the drawing was rearranged onto: the instruction fields drop
		// down a column of their own with the memory clear of it, and the
		// program counter's row runs under the adder's feed, not across it.
		moveAxis: {
			0: 373,
			1: 176,
			6: 373,
			8: 373,
			9: 302.5,
			10: 373,
			24: 329,
			27: 354,
			30: 329,
			35: 485,
			38: 532,
			39: 532,
			42: 799,
			43: 105.8,
			66: 397,
			68: 542.5,
			73: 397,
			81: 371,
			17: 91,
			84: 193,
			86: 778,
			92: 373,
		},
	},
	control: {
		// The second and third gates' outputs run on down the board past the
		// signal they drive, ending in mid-air.  Each output stops at
		// the signal it feeds; the wire that carried on is not drawn.
		drop: [67, 73],
		moveAxis: {},
	},
	register: {
		// Write control came down at x=392, stepped left along y=52 and only
		// then went down into the register column.  It now goes straight down.
		drop: [17],
		moveAxis: {
			16: 257,
			// The writing-data bus ran up the left of the gates, so every branch
			// off it crossed them to reach the registers.  It now runs up the
			// lane between the two, and the branches are short and clear.
			...Object.fromEntries(DATA_BUS_WIRES.map((index) => [index, DATA_BUS])),
			// The register lines arrive evenly down each multiplexer's left edge,
			// and the address that selects between them comes in at its top.
			...readPortWires(),
			2: brush(READ_PORT_GAP),
			...Object.fromEntries(GATE_WIRES.flatMap((gate, row) => [
				[gate.fromDecoder, brush(registerPin(row, 'ctrl') - GATE_INPUT_SPREAD)],
				[gate.fromControl, brush(registerPin(row, 'ctrl') + GATE_INPUT_SPREAD)],
				[gate.output, brush(registerPin(row, 'ctrl'))],
				[gate.data, brush(registerPin(row, 'data'))],
			])),
		},
		span: {
			// The bus is fed along the bottom, so that run reaches its new lane.
			4: { to: DATA_BUS },
			...Object.fromEntries(GATE_WIRES.map((gate) => [gate.data, { from: DATA_BUS }])),
		},
	},
}
