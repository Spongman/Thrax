/**
 * MIPS X-Ray: the animated datapath.
 *
 * One instruction's journey is a graph of wire segments over a drawing of the
 * datapath.  A segment grows a pixel at a time from `init` to `end` along one
 * axis; when it arrives, the segments it points at start growing in turn.  The
 * colour of every wire is chosen by the format of the instruction, so a load
 * and a branch light the same drawing up differently.
 *
 * The vertex graph is generated into `datapaths.ts`; the engine here does the
 * stepping and propagation.  The drawing is redrawn rather
 * than photographed: see `blocks.ts`.
 */

import { XRAY_DATAPATHS, XRAY_FUNCTIONS, XRAY_OPCODES, XRAY_PALETTE, XRAY_REGISTERS } from './datapaths'
import type { XrayColorKey, XrayDatapath, XrayDiagram, XrayVertex } from './datapaths'
import { geometryOf } from './geometry'
import type { XrayGeometry } from './geometry'

/** The default wire colour, for a vertex whose diagram names none. */
const DEFAULT_COLOR = '#009900'

/** How bright a wire has to be to read against the workspace's dark ground. */
const MINIMUM_LUMINANCE = 0.5

/** Perceived brightness, which is mostly green and hardly any blue. */
const luminance = ([red, green, blue]: number[]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue

/**
 * The wire colours were chosen against white, so several of them are navies
 * that vanish here.  Mixing toward white lifts one until it reads while leaving its
 * hue alone, so the colour still codes for what it did.
 */
export function nightColor(hex: string): string {
	const value = parseInt(hex.slice(1), 16)
	const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((part) => part / 255)
	const brightness = luminance(channels)
	if (brightness >= MINIMUM_LUMINANCE) return hex

	// Luminance is linear in the channels, so this is the exact mix needed.
	const mix = (MINIMUM_LUMINANCE - brightness) / (1 - brightness)
	const lifted = channels.map((part) => Math.round((part + (1 - part) * mix) * 255))
	return `#${lifted.map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

/** The whole wiring of a drawing, unlit, as its background. */
export function staticWires(diagram: XrayDiagram): XraySegment[] {
	return geometryOf(diagram).wires.map((wire) => ({
		index: wire.index,
		name: wire.name,
		color: '',
		...(wire.horizontal
			? { x1: wire.from, y1: wire.axis, x2: wire.to, y2: wire.axis }
			: { x1: wire.axis, y1: wire.from, x2: wire.axis, y2: wire.to }),
	}))
}

/** Which set of wire colours an instruction lights up. */
export function xrayColorKey(word: number, diagram: XrayDiagram): XrayColorKey {
	const opcode = (word >>> 26) & 0x3f
	if (opcode === 0) {
		if (diagram !== 'aluControl') return 'rtype'
		// The ALU control diagram colours by the operation the function field asks
		// for, which its low four bits name.
		switch (word & 0xf) {
			case 0x0: return 'alu010'
			case 0x2: return 'alu110'
			case 0x4: return 'alu000'
			case 0x5: return 'alu001'
			default: return 'alu111'
		}
	}
	if (opcode === 2 || opcode === 3) return 'jtype'
	if (opcode >= 0x20 && opcode <= 0x27) return 'load'
	if (opcode >= 0x28 && opcode <= 0x2f) return 'store'
	if (opcode >= 0x04 && opcode <= 0x07) return 'branch'
	return 'itype'
}

/** A length of wire the animation has lit so far. */
export interface XraySegment {
	/** The vertex it came from; names repeat across a drawing, indices do not. */
	index: number
	name: string
	color: string
	x1: number
	y1: number
	x2: number
	y2: number
}

interface Track {
	vertex: XrayVertex
	color: string
	/** Where the head has reached, which runs past `last` once it arrives. */
	current: number
	active: boolean
	started: boolean
}

export class DatapathAnimation {
	readonly datapath: XrayDatapath
	readonly geometry: XrayGeometry
	readonly colorKey: XrayColorKey
	private tracks: Track[] = []
	/** Vertex index to its track, so a target is only started once. */
	private started = new Map<number, Track>()

	constructor(readonly diagram: XrayDiagram, readonly word: number) {
		this.datapath = XRAY_DATAPATHS[diagram]
		this.geometry = geometryOf(diagram)
		this.colorKey = xrayColorKey(word, diagram)
		this.reset()
	}

	/** Back to the program counter, which is where every instruction starts. */
	reset() {
		this.tracks = []
		this.started.clear()
		const first = this.datapath.vertices[0]
		if (first) this.begin(first)
	}

	private begin(vertex: XrayVertex) {
		if (this.started.has(vertex.index)) return
		const index = vertex.colors[this.colorKey] ?? vertex.colors.itype
		const track: Track = {
			vertex,
			color: nightColor(index === undefined ? DEFAULT_COLOR : XRAY_PALETTE[index]),
			current: vertex.init,
			// A segment with nowhere to go is complete before it starts.
			active: vertex.init !== vertex.end,
			started: true,
		}
		this.started.set(vertex.index, track)
		this.tracks.push(track)
	}

	/** The last pixel a segment covers, one short of the vertex it points at. */
	private static lastOf(vertex: XrayVertex): number {
		return vertex.init < vertex.end ? vertex.end - 1 : vertex.end + 1
	}

	/** Moves every live wire on by one pixel, and starts whatever they reach. */
	advance(steps = 1) {
		for (let step = 0; step < steps; step++) {
			// The list grows as targets start, and those animate in the same pass,
			// so this walks the array rather than a copy of it.
			for (let i = 0; i < this.tracks.length; i++) {
				const track = this.tracks[i]
				if (track.active) {
					const last = DatapathAnimation.lastOf(track.vertex)
					if (track.current === last) track.active = false
					track.current += track.vertex.init < track.vertex.end ? 1 : -1
				}
				if (!track.active) {
					for (const target of track.vertex.targets) {
						// Pointing at zero means pointing nowhere.
						if (target === 0) continue
						const vertex = this.datapath.vertices[target]
						if (vertex) this.begin(vertex)
					}
				}
			}
		}
	}

	/** Runs the animation out, for a step the user did not watch. */
	finish() {
		// No vertex starts twice, so the graph cannot take longer to light up
		// than the total length of its wires.
		let guard = this.datapath.vertices.reduce((total, vertex) => total + Math.abs(vertex.end - vertex.init) + 1, 0)
		while (!this.done && guard-- > 0) this.advance()
	}

	get done(): boolean {
		return this.tracks.every((track) => !track.active)
	}

	/** How much of a wire the head has covered, from nothing to all of it. */
	private static progressOf(track: Track): number {
		const { vertex } = track
		if (!track.active) return 1
		const last = DatapathAnimation.lastOf(vertex)
		if (last === vertex.init) return 1
		return Math.min(1, Math.max(0, (track.current - vertex.init) / (last - vertex.init)))
	}

	/**
	 * What to draw: one line per wire the animation has reached, along the same
	 * stretched geometry the unlit background uses, so a lit wire covers its own
	 * background exactly rather than sitting beside it.
	 */
	segments(): XraySegment[] {
		const segments: XraySegment[] = []
		for (const track of this.tracks) {
			// A label has no track of its own, only the wires that lead to it.
			if (track.vertex.isText) continue
			const pieces = this.geometry.byIndex.get(track.vertex.index)
			if (!pieces) continue

			// A staggered crossing leaves a wire in two pieces, which the head
			// crosses in turn so the whole run still fills at one rate.
			const total = pieces.reduce((sum, piece) => sum + Math.abs(piece.to - piece.from), 0)
			let covered = total * DatapathAnimation.progressOf(track)
			for (const wire of pieces) {
				const length = Math.abs(wire.to - wire.from)
				const reached = length === 0 ? 1 : Math.max(0, Math.min(1, covered / length))
				covered -= length
				// The first piece is drawn even before it has grown, so a wire
				// just starting shows as a point at its origin.
				if (reached <= 0 && wire !== pieces[0]) continue
				const head = wire.from + (wire.to - wire.from) * reached
				const common = { index: wire.index, name: wire.name, color: track.color }
				segments.push(wire.horizontal
					? { ...common, x1: wire.from, y1: wire.axis, x2: head, y2: wire.axis }
					: { ...common, x1: wire.axis, y1: wire.from, x2: wire.axis, y2: head })
			}
		}
		return segments
	}

	/**
	 * Arrows whose wire has finished, so the head fills in as the value lands
	 * rather than the moment it sets off.
	 */
	litArrows(): { x: number; y: number; dx: number; dy: number; color: string }[] {
		const arrived = new Map<number, string>()
		for (const track of this.tracks) {
			if (!track.vertex.isText && !track.active) arrived.set(track.vertex.index, track.color)
		}
		return this.geometry.arrows
			.filter((arrow) => arrived.has(arrow.index))
			.map((arrow) => ({ ...arrow, color: arrived.get(arrow.index)! }))
	}

	/** Joints whose wires are lit, so a junction takes the colour running through it. */
	litJunctions(): { x: number; y: number; color: string }[] {
		const lit = new Map<number, string>()
		for (const track of this.tracks) {
			if (!track.vertex.isText) lit.set(track.vertex.index, track.color)
		}
		const dots: { x: number; y: number; color: string }[] = []
		for (const junction of this.geometry.junctions) {
			const carrying = junction.wires.find((index) => lit.has(index))
			if (carrying !== undefined) dots.push({ x: junction.x, y: junction.y, color: lit.get(carrying)! })
		}
		return dots
	}
}

/** The instruction layout the drawing is annotated for. */
export type XrayFormat = 'register' | 'jump' | 'load' | 'store' | 'branch' | 'immediate'

export function xrayFormat(word: number): XrayFormat {
	const key = xrayColorKey(word, 'datapath')
	if (key === 'rtype') return 'register'
	if (key === 'jtype') return 'jump'
	if (key === 'load') return 'load'
	if (key === 'store') return 'store'
	if (key === 'branch') return 'branch'
	return 'immediate'
}

export interface XrayLabel {
	x: number
	y: number
	text: string
	color: string
	/** Point size, and whether the label is a heading. */
	size: number
	bold?: boolean
}

const TITLES: Record<XrayFormat, string> = {
	register: 'REGISTER TYPE INSTRUCTION',
	jump: 'JUMP TYPE INSTRUCTION',
	load: 'LOAD TYPE INSTRUCTION',
	store: 'STORE TYPE INSTRUCTION',
	branch: 'BRANCH TYPE INSTRUCTION',
	immediate: 'IMMEDIATE TYPE INSTRUCTION',
}

/** The bit fields of each format, laid out along the bottom. */
const FIELDS: Record<XrayFormat, { x: number; name: string; from: number; to: number; color: string }[]> = {
	register: [
		{ x: 25, name: 'opcode', from: 0, to: 6, color: 'var(--xray-field-opcode)' },
		{ x: 90, name: 'rs', from: 6, to: 11, color: 'var(--xray-field-rs)' },
		{ x: 150, name: 'rt', from: 11, to: 16, color: 'var(--xray-field-rt)' },
		{ x: 210, name: 'rd', from: 16, to: 21, color: 'var(--xray-field-rd)' },
		{ x: 270, name: 'shamt', from: 21, to: 26, color: 'var(--text-primary)' },
		{ x: 330, name: 'function', from: 26, to: 32, color: 'var(--xray-field-immediate)' },
	],
	jump: [
		{ x: 25, name: 'opcode', from: 0, to: 6, color: 'var(--xray-field-opcode)' },
		{ x: 95, name: 'address', from: 6, to: 32, color: 'var(--xray-field-immediate)' },
	],
	load: [
		{ x: 25, name: 'opcode', from: 0, to: 6, color: 'var(--xray-field-opcode)' },
		{ x: 90, name: 'rs', from: 6, to: 11, color: 'var(--xray-field-rs)' },
		{ x: 145, name: 'rt', from: 11, to: 16, color: 'var(--xray-field-rt)' },
		{ x: 200, name: 'Immediate', from: 16, to: 32, color: 'var(--xray-field-immediate)' },
	],
	store: [
		{ x: 25, name: 'opcode', from: 0, to: 6, color: 'var(--xray-field-opcode)' },
		{ x: 90, name: 'rs', from: 6, to: 11, color: 'var(--xray-field-rs)' },
		{ x: 145, name: 'rt', from: 11, to: 16, color: 'var(--xray-field-rt)' },
		{ x: 200, name: 'Immediate', from: 16, to: 32, color: 'var(--xray-field-immediate)' },
	],
	branch: [
		{ x: 25, name: 'opcode', from: 0, to: 6, color: 'var(--xray-field-opcode)' },
		{ x: 90, name: 'rs', from: 6, to: 11, color: 'var(--xray-field-rs)' },
		{ x: 145, name: 'rt', from: 11, to: 16, color: 'var(--xray-field-rt)' },
		{ x: 200, name: 'Immediate', from: 16, to: 32, color: 'var(--xray-field-rd)' },
	],
	immediate: [
		{ x: 25, name: 'opcode', from: 0, to: 6, color: 'var(--xray-field-opcode)' },
		{ x: 90, name: 'rs', from: 6, to: 11, color: 'var(--xray-field-rs)' },
		{ x: 145, name: 'rt', from: 11, to: 16, color: 'var(--xray-field-rt)' },
		{ x: 200, name: 'Immediate', from: 16, to: 32, color: 'var(--xray-field-rd)' },
	],
}

/** The 32 bits of the word, which the field labels take slices of. */
function bits(word: number): string {
	return ((word >>> 0).toString(2)).padStart(32, '0')
}

const signed = (value: number) => (value & 0x8000 ? value - 0x10000 : value)

/**
 * What the instruction reads as, drawn above the bit fields.  The load and
 * store forms name the base register and offset the instruction actually uses.
 */
function description(word: number, format: XrayFormat, code: string): XrayLabel[] {
	const at = (x: number, text: string): XrayLabel => ({ x, y: 500, text, color: 'var(--text-primary)', size: 15 })
	const opcode = XRAY_OPCODES[code.slice(0, 6)] ?? ''
	const register = (from: number, to: number) => XRAY_REGISTERS[code.slice(from, to)] ?? ''
	const immediate = signed(word & 0xffff)

	switch (format) {
		case 'register':
			return [
				at(25, XRAY_FUNCTIONS[code.slice(26, 32)] ?? ''),
				at(65, register(6, 11)),
				at(105, register(16, 21)),
				at(145, register(11, 16)),
			]
		case 'jump':
			return [
				{ ...at(65, opcode), color: 'var(--xray-field-rd)' },
				{ ...at(105, 'LABEL'), color: 'var(--xray-field-rd)' },
			]
		case 'load':
		case 'store':
			return [
				at(25, opcode),
				at(65, register(11, 16)),
				at(105, `M[ ${register(6, 11)} + ${immediate} ]`),
			]
		default:
			return [
				at(25, opcode),
				at(65, register(11, 16)),
				at(105, register(6, 11)),
				at(155, `${immediate}`),
			]
	}
}

/**
 * Everything written over the drawing for one instruction: the format, its bit
 * fields, and what it reads as.  There is no click-through hint, since the
 * diagrams are chosen from a list here rather than by clicking.
 */
export function xrayLabels(word: number): XrayLabel[] {
	const format = xrayFormat(word)
	const code = bits(word)
	const labels: XrayLabel[] = [
		{ x: format === 'branch' || format === 'immediate' ? 250 : 280, y: 30, text: TITLES[format], color: 'var(--text-bright)', size: 25, bold: true },
		{ x: 25, y: 480, text: 'Instruction', color: 'var(--danger-text)', size: 10 },
		{ x: 25, y: 440, text: 'Control Signals', color: 'var(--danger-text)', size: 10 },
		{ x: 25, y: 455, text: 'Active', color: 'var(--danger-text)', size: 10 },
		{ x: 75, y: 455, text: 'Inactive', color: 'var(--text-disabled)', size: 10 },
	]

	for (const field of FIELDS[format]) {
		labels.push({ x: field.x, y: 530, text: field.name, color: 'var(--danger-text)', size: 10 })
		labels.push({ x: field.x, y: 550, text: code.slice(field.from, field.to), color: field.color, size: 15 })
	}

	return [...labels, ...description(word, format, code)]
}
