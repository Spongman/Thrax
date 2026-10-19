import { describe, expect, it } from 'vitest'
import { words } from '../../../core/__tests__/helpers'
import { DatapathAnimation, nightColor, staticWires, xrayColorKey, xrayFormat, xrayLabels } from '../animation'
import { XRAY_DRAWINGS, XRAY_REROUTES } from '../blocks'
import { geometryOf } from '../geometry'
import { XRAY_DATAPATHS } from '../datapaths'

const encode = (source: string) => words(source)[0]

describe('instruction colouring', () => {
	it('picks a colour set from the opcode', () => {
		expect(xrayColorKey(encode('add $t0, $t1, $t2'), 'datapath')).toBe('rtype')
		expect(xrayColorKey(encode('here: j here'), 'datapath')).toBe('jtype')
		expect(xrayColorKey(encode('lw $t0, 0($sp)'), 'datapath')).toBe('load')
		expect(xrayColorKey(encode('sw $t0, 0($sp)'), 'datapath')).toBe('store')
		expect(xrayColorKey(encode('here: beq $t0, $t1, here'), 'datapath')).toBe('branch')
		expect(xrayColorKey(encode('addi $t0, $t1, 4'), 'datapath')).toBe('itype')
	})

	// The ALU control drawing colours by the operation the function field names.
	it('reads the ALU operation out of an R-type on the ALU drawing', () => {
		expect(xrayColorKey(encode('add $t0, $t1, $t2'), 'aluControl')).toBe('alu010')
		expect(xrayColorKey(encode('sub $t0, $t1, $t2'), 'aluControl')).toBe('alu110')
		expect(xrayColorKey(encode('and $t0, $t1, $t2'), 'aluControl')).toBe('alu000')
		expect(xrayColorKey(encode('or $t0, $t1, $t2'), 'aluControl')).toBe('alu001')
		expect(xrayColorKey(encode('slt $t0, $t1, $t2'), 'aluControl')).toBe('alu111')
	})

	it('leaves the other formats alone on that drawing', () => {
		expect(xrayColorKey(encode('lw $t0, 0($sp)'), 'aluControl')).toBe('load')
	})
})

describe('datapath animation', () => {
	const word = encode('add $t0, $t1, $t2')

	it('starts at the program counter and nowhere else', () => {
		const animation = new DatapathAnimation('datapath', word)
		const segments = animation.segments()
		expect(segments).toHaveLength(1)
		expect(segments[0].name).toBe('*Program_counter')
		// Nothing has moved yet, so the wire is a point at its origin.
		const wire = geometryOf('datapath').byIndex.get(0)![0]
		expect(segments[0].x1).toBe(wire.from)
		expect(segments[0].x2).toBe(wire.from)
	})

	it('grows the wire as it steps', () => {
		const animation = new DatapathAnimation('datapath', word)
		const wire = geometryOf('datapath').byIndex.get(0)![0]
		animation.advance(5)
		const head = animation.segments()[0].x2
		expect(head).toBeGreaterThan(wire.from)
		expect(head).toBeLessThan(wire.to)
	})

	it('reaches the end of its wire, and starts what it feeds', () => {
		const vertex = XRAY_DATAPATHS.datapath.vertices[0]
		const animation = new DatapathAnimation('datapath', word)
		animation.advance(vertex.end - vertex.init)

		expect(animation.segments()[0].x2).toBe(geometryOf('datapath').byIndex.get(0)![0].to)
		// Its two targets are now on the board.
		expect(animation.segments()).toHaveLength(1 + vertex.targets.length)
	})

	it('runs every reachable wire out and then stops', () => {
		const animation = new DatapathAnimation('datapath', word)
		animation.finish()
		expect(animation.done).toBe(true)

		// A finished wire covers exactly the wire the background drew, piece for
		// piece: a wire with a step in it is drawn as more than one.
		const drawn = new Map<number, number>()
		for (const segment of animation.segments()) {
			const at = drawn.get(segment.index) ?? 0
			drawn.set(segment.index, at + 1)
			const wire = geometryOf('datapath').byIndex.get(segment.index)![at]
			expect(wire.horizontal ? segment.x2 : segment.y2).toBe(wire.to)
			expect(wire.horizontal ? segment.x1 : segment.y1).toBe(wire.from)
			expect(wire.horizontal ? segment.y1 : segment.x1).toBe(wire.axis)
		}
	})

	it('draws no track for a label vertex', () => {
		const animation = new DatapathAnimation('datapath', word)
		animation.finish()
		const labels = XRAY_DATAPATHS.datapath.vertices.filter((vertex) => vertex.isText)
		expect(labels.length).toBeGreaterThan(0)
		for (const label of labels) {
			expect(animation.segments().some((segment) => segment.name === label.name)).toBe(false)
		}
	})

	it('lights a different set of wires for a load than for an R-type', () => {
		const rtype = new DatapathAnimation('datapath', word)
		const load = new DatapathAnimation('datapath', encode('lw $t0, 0($sp)'))
		rtype.finish()
		load.finish()
		const colorsOf = (animation: DatapathAnimation) => animation.segments().map((segment) => segment.color).join()
		expect(colorsOf(rtype)).not.toBe(colorsOf(load))
	})

	it('animates the other three drawings too', () => {
		for (const diagram of ['control', 'aluControl', 'register'] as const) {
			const animation = new DatapathAnimation(diagram, word)
			animation.finish()
			expect(animation.done).toBe(true)
			expect(animation.segments().length).toBeGreaterThan(1)
		}
	})
})

describe('instruction annotations', () => {
	it('names the format', () => {
		expect(xrayFormat(encode('add $t0, $t1, $t2'))).toBe('register')
		expect(xrayFormat(encode('sw $t0, 0($sp)'))).toBe('store')
	})

	it('lays out the six fields of an R-type', () => {
		const labels = xrayLabels(encode('add $t0, $t1, $t2'))
		const text = labels.map((label) => label.text)
		expect(text).toContain('REGISTER TYPE INSTRUCTION')
		expect(text).toEqual(expect.arrayContaining(['opcode', 'rs', 'rt', 'rd', 'shamt', 'function']))
		// The bit fields themselves, in the order the word holds them.
		expect(text).toContain('000000')
		expect(text).toContain('add')
		expect(text).toEqual(expect.arrayContaining(['$t1', '$t2', '$t0']))
	})

	it('reads a load as the memory address it forms', () => {
		const labels = xrayLabels(encode('lw $t0, -8($sp)'))
		const text = labels.map((label) => label.text)
		expect(text).toContain('LOAD TYPE INSTRUCTION')
		expect(text).toContain('M[ $sp + -8 ]')
		expect(text).toContain('$t0')
	})

	it('shows a jump as an address rather than registers', () => {
		const text = xrayLabels(encode('here: j here')).map((label) => label.text)
		expect(text).toContain('JUMP TYPE INSTRUCTION')
		expect(text).toContain('address')
		expect(text).toContain('LABEL')
	})
})

describe('drawing on a dark ground', () => {
	it('lifts a colour too dark to see, and leaves a bright one alone', () => {
		// Several signals are wired in navy, which disappears against #1e1e1e.
		expect(nightColor('#0000ff')).not.toBe('#0000ff')
		expect(nightColor('#ffff00')).toBe('#ffff00')
		expect(nightColor('#00ff00')).toBe('#00ff00')
	})

	it('keeps the hue, so the colour still codes for the same thing', () => {
		const lifted = nightColor('#0a0a96')
		const [red, green, blue] = [1, 3, 5].map((at) => parseInt(lifted.slice(at, at + 2), 16))
		expect(blue).toBeGreaterThan(green)
		expect(red).toBe(green)
	})

	it('lights the wires it lifted', () => {
		const animation = new DatapathAnimation('datapath', 0x8d090000)
		animation.finish()
		for (const segment of animation.segments()) {
			const channels = [1, 3, 5].map((at) => parseInt(segment.color.slice(at, at + 2), 16))
			// Nothing is left dark enough to vanish into the background.
			expect(Math.max(...channels)).toBeGreaterThan(0x60)
		}
	})

	it('offers the whole wiring as an unlit background', () => {
		for (const diagram of ['datapath', 'control', 'aluControl', 'register'] as const) {
			const wires = staticWires(diagram)
			expect(wires.length).toBeGreaterThan(20)
			// Every wire spans its full length, unlike an animated one.
			for (const wire of wires) expect(wire.x1 !== wire.x2 || wire.y1 !== wire.y2).toBe(true)
		}
	})
})

describe('drawn units', () => {
	it('gives every diagram its blocks', () => {
		for (const diagram of ['datapath', 'control', 'aluControl', 'register'] as const) {
			expect(XRAY_DRAWINGS[diagram].blocks.length).toBeGreaterThan(5)
		}
	})

	it('keeps every block inside the drawing it belongs to', () => {
		for (const diagram of ['datapath', 'control', 'aluControl', 'register'] as const) {
			const { width, height } = XRAY_DATAPATHS[diagram]
			for (const block of XRAY_DRAWINGS[diagram].blocks) {
				expect(block.x).toBeGreaterThanOrEqual(0)
				expect(block.y).toBeGreaterThanOrEqual(0)
				expect(block.x + block.width).toBeLessThanOrEqual(width)
				expect(block.y + block.height).toBeLessThanOrEqual(height)
			}
		}
	})

	it('names the units the datapath animation runs between', () => {
		const labels = XRAY_DRAWINGS.datapath.blocks.flatMap((block) => block.label ?? []).join(' ')
		for (const unit of ['PC', 'INSTRUCTION', 'REGISTERS', 'ALU', 'DATA', 'CONTROL', 'SIGN']) {
			expect(labels).toContain(unit)
		}
	})
})

describe('wire geometry', () => {
	const DIAGRAMS = ['datapath', 'control', 'aluControl', 'register'] as const

	it('puts a wire where it was painted, not where the number says', () => {
		// A three-pixel brush was anchored at the coordinate, so the centre line
		// of the wire it drew is a pixel and a half past it.  A wire joined to a
		// near-parallel neighbour is brought onto its line as well, which is the
		// only thing allowed to move it further.
		for (const diagram of DIAGRAMS) {
			const moved = XRAY_REROUTES[diagram]?.moveAxis ?? {}
			const stepped = XRAY_REROUTES[diagram]?.step ?? {}
			for (const wire of geometryOf(diagram).wires) {
				// A wire a reroute straightened is where the reroute put it, and
				// one it gave a step to runs on two lines with a crossing between.
				const step = stepped[wire.index]
				const lanes = [moved[wire.index] ?? XRAY_DATAPATHS[diagram].vertices[wire.index].otherAxis]
				if (step) lanes.push(step.axis, step.at)
				const painted = lanes.map((lane) => Math.abs(wire.axis - lane - 1.5))
				expect(Math.min(...painted)).toBeLessThanOrEqual(3)
			}
		}
	})

	/**
	 * The rule the drawing has to obey: a wire may only end somewhere that
	 * explains why it stops.  Anything else is a loose end the reader sees as a
	 * gap, which is what the vertex graph's slack used to leave behind.
	 */
	it('marks joints with a junction, and not every corner', () => {
		for (const diagram of DIAGRAMS) {
			const { junctions, wires } = geometryOf(diagram)
			expect(junctions.length).toBeGreaterThan(0)
			for (const junction of junctions) expect(junction.wires.length).toBeGreaterThanOrEqual(2)
			expect(junctions.length).toBeLessThan(wires.length * 2)
		}
	})

	it('keeps every wire within the drawing', () => {
		for (const diagram of DIAGRAMS) {
			const { width, height } = XRAY_DATAPATHS[diagram]
			for (const wire of geometryOf(diagram).wires) {
				const across = wire.horizontal ? height : width
				const along = wire.horizontal ? width : height
				expect(wire.axis).toBeGreaterThanOrEqual(0)
				expect(wire.axis).toBeLessThanOrEqual(across)
				expect(Math.min(wire.from, wire.to)).toBeGreaterThanOrEqual(0)
				// The brush overhung the right and bottom edges by its width.
				expect(Math.max(wire.from, wire.to)).toBeLessThanOrEqual(along + 3)
			}
		}
	})
})
