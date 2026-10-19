import { describe, expect, it } from 'vitest'
import { XRAY_DATAPATHS } from '../datapaths'
import type { XrayDiagram } from '../datapaths'
import { insideShape, outlineOf, svgPathOf, XRAY_DRAWINGS } from '../blocks'
import type { XrayBlock } from '../blocks'
import { DOT_RADIUS } from '../drawing'
import { geometryOf, onPanel } from '../geometry'
import type { XrayWire } from '../geometry'

/**
 * The rules the redrawn datapaths have to obey.
 *
 * The vertex graph was never meant to be a drawing on its own: the wiring
 * the reader saw was painted into a bitmap underneath it, so the numbers are a
 * few pixels loose everywhere and nobody noticed.  Drawing them directly puts
 * every one of those slips on show, so `geometry.ts` tidies them up, and these
 * are the checks that say when it has finished.
 */

const DIAGRAMS: XrayDiagram[] = ['datapath', 'control', 'aluControl', 'register']

/** Radius of the drawn junction dot, from the view. */
const JUNCTION_RADIUS = DOT_RADIUS

/** Half a wire's width: two things this close are touching once drawn. */
const TOUCH = 2

/**
 * A wire is carried a little past every joint it makes, so its own width fills
 * the corner.  An end within this much of a junction stops there; it is not
 * running through it.
 */
const PAST_END = 4

/** The junctions with more than three traces fanned out of them. */
const FANNED_OUT: string[] = [
	'datapath 4 arms at 330.5,400.5',
	'datapath 4 arms at 498.5,120.5',
	'datapath 4 arms at 533.5,398.5',
	'datapath 4 arms at 601.5,120.5',
	'control 4 arms at 533.5,426.5',
	'register 4 arms at 258.5,120.71',
	'register 4 arms at 258.5,181.91000000000003',
	'register 4 arms at 617.5,152.5',
]

/** Pairs drawn a pixel apart, which are different signals. */
const COINCIDENT: string[] = []

/** Edge wires start and end a few pixels inside the drawing. */
const EDGE_MARGIN = 8

/** How far two pieces of one run may be carried past the joint between them. */
const JOINT_OVERLAP = 16

/** Every wire is carried a little past a joint, so two may share that much. */
const CORNER_OVERLAP = 4

const low = (wire: XrayWire) => Math.min(wire.from, wire.to)
const high = (wire: XrayWire) => Math.max(wire.from, wire.to)

const tipOf = (wire: XrayWire, end: 'from' | 'to'): [number, number] =>
	wire.horizontal ? [wire[end], wire.axis] : [wire.axis, wire[end]]

const solid = (blocks: XrayBlock[]) => blocks.filter((block) => block.shape !== 'panel')

/**
 * On the block as drawn, not merely inside the box it was measured in: an
 * adder is an arrow and a gate is a nose, so a trace that stops in the corner
 * of either box stops in empty drawing.
 */
const within = (block: XrayBlock, x: number, y: number) => insideShape(block, x, y)

describe('datapath drawing rules', () => {
	/**
	 * A wire may only stop where something explains why it stopped.  Anything
	 * else reads as a broken line.
	 */
	it('ends every wire on a component, a junction, another wire, or the edge', () => {
		for (const diagram of DIAGRAMS) {
			const { wires, junctions } = geometryOf(diagram)
			const { width, height } = XRAY_DATAPATHS[diagram]
			const blocks = solid(geometryOf(diagram).blocks)

			const loose: string[] = []
			for (const wire of wires) {
				for (const end of ['from', 'to'] as const) {
					const [x, y] = tipOf(wire, end)
					const onBlock = blocks.some((block) => within(block, x, y))
					const onJunction = junctions.some((junction) =>
						Math.abs(junction.x - x) <= JUNCTION_RADIUS && Math.abs(junction.y - y) <= JUNCTION_RADIUS)
					const atEdge = x <= EDGE_MARGIN || y <= EDGE_MARGIN || x >= width - EDGE_MARGIN || y >= height - EDGE_MARGIN
						|| onPanel(geometryOf(diagram).blocks, x, y)
					// Another piece of the same wire counts: a step is two pieces
					// meeting at a corner, and the corner is not a loose end.
					const onWire = wires.some((other) => other !== wire
						&& Math.abs((other.horizontal ? y : x) - other.axis) <= TOUCH
						&& (other.horizontal ? x : y) >= low(other) - TOUCH
						&& (other.horizontal ? x : y) <= high(other) + TOUCH)
					if (!onBlock && !onJunction && !atEdge && !onWire) loose.push(`${diagram} ${wire.name}.${end} at ${x},${y}`)
				}
			}
			expect(loose).toEqual([])
		}
	})

	/** Every wire at a junction reaches its centre, so the dot covers the join. */
	it('brings the wires of a junction under the middle of its dot', () => {
		for (const diagram of DIAGRAMS) {
			const { junctions, byIndex } = geometryOf(diagram)
			const adrift: string[] = []
			for (const junction of junctions) {
				for (const index of junction.wires) {
					const wire = byIndex.get(index)?.[0]
					if (!wire) continue
					const along = wire.horizontal ? junction.x : junction.y
					const across = wire.horizontal ? junction.y : junction.x
					// Square on to the dot, and running through its middle.
					if (Math.abs(wire.axis - across) > TOUCH) adrift.push(`${diagram} ${wire.name} off the dot's line`)
					if (along < low(wire) - TOUCH || along > high(wire) + TOUCH) {
						adrift.push(`${diagram} ${wire.name} stops before the dot`)
					}
				}
			}
			expect(adrift).toEqual([])
		}
	})

	/**
	 * Four traces meeting in one place is ambiguous; two threes are not.  What
	 * counts is arms, not wires: a wire running through a junction leaves by
	 * both sides of it and so contributes two.
	 *
	 * Several signals fan out from a single dot, which is what the list below is.
	 * Splitting each into a chain of tees would read better but changes the
	 * drawing, so they are pinned here instead: the check is that no new one
	 * appears.
	 */
	it('runs no more than three traces into a junction that is not fanned out', () => {
		const crowded: string[] = []
		for (const diagram of DIAGRAMS) {
			const { junctions, byIndex } = geometryOf(diagram)
			for (const junction of junctions) {
				let arms = 0
				for (const index of junction.wires) {
					const wire = byIndex.get(index)?.[0]
					if (!wire) continue
					const along = wire.horizontal ? junction.x : junction.y
					const passesThrough = along > Math.min(wire.from, wire.to) + PAST_END
						&& along < Math.max(wire.from, wire.to) - PAST_END
					arms += passesThrough ? 2 : 1
				}
				if (arms > 3) crowded.push(`${diagram} ${arms} arms at ${junction.x},${junction.y}`)
			}
		}
		expect(crowded).toEqual(FANNED_OUT)
	})


	/**
	 * Two traces on one line read as a single thicker trace, so the drawing
	 * silently loses one of them.  Pieces of the same run do overlap, by the
	 * little each is carried past the joint between them; anything longer, or
	 * between wires the graph never joins, is one trace drawn over another.
	 */
	it('draws no trace along another', () => {
		const doubled: string[] = []
		for (const diagram of DIAGRAMS) {
			const { wires } = geometryOf(diagram)
			const blocks = solid(geometryOf(diagram).blocks)
			const joined = new Set<string>()
			for (const vertex of XRAY_DATAPATHS[diagram].vertices) {
				for (const target of vertex.targets) joined.add(`${vertex.index},${target}`)
			}
			for (let i = 0; i < wires.length; i++) {
				for (let j = i + 1; j < wires.length; j++) {
					const [one, other] = [wires[i], wires[j]]
					if (one.index === other.index || one.horizontal !== other.horizontal) continue
					if (Math.abs(one.axis - other.axis) > TOUCH) continue
					// Only what shows counts: two runs both carried into a block are
					// hidden under it, which is what carrying them in is for.
					const from = Math.max(low(one), low(other))
					const to = Math.min(high(one), high(other))
					let along = 0
					for (let at = from; at < to; at++) {
						const [x, y] = one.horizontal ? [at, one.axis] : [one.axis, at]
						if (!blocks.some((block) => within(block, x, y))) along++
					}
					if (along <= 0) continue
					const consecutive = joined.has(`${one.index},${other.index}`) || joined.has(`${other.index},${one.index}`)
					if (along <= (consecutive ? JOINT_OVERLAP : CORNER_OVERLAP)) continue
					doubled.push(`${diagram} ${one.name} over ${other.name} for ${along}`)
				}
			}
		}
		expect(doubled).toEqual([])
	})

	/**
	 * Wires meeting one side of a component should be spread along it, one
	 * centred, two either side of the middle, and so on.  That cannot be had
	 * while the wires are straight.
	 *
	 * Three of the wires leaving the right of the instruction memory are the
	 * same three that arrive at the left of the register file, and the two
	 * blocks are different heights in different places: spacing five wires
	 * evenly down the memory's 91 pixels puts them at y = 333.2, 348.3 and
	 * 363.5, while spacing the same five down the register file's 133 puts them
	 * at 316.2, 338.3 and 360.5.  A straight horizontal wire has one y, so it
	 * cannot sit at both.  Spreading them would mean routing each wire as a
	 * polyline with a step near one end.
	 *
	 * What can hold is the weaker rule, that no two wires land within a pixel
	 * of each other on the same face, where one would hide behind the other.
	 */
	it('lands no two wires on one place of a component face', () => {
		const coincident: string[] = []
		for (const diagram of DIAGRAMS) {
			const { wires } = geometryOf(diagram)
			for (const block of solid(geometryOf(diagram).blocks)) {
				// Two wires at the same height on opposite faces of a block never
				// overlap, so each face is looked at on its own.
				for (const face of [[true, true], [true, false], [false, true], [false, false]]) {
					const [horizontal, near] = face
					const landing = wires.filter((wire) => wire.horizontal === horizontal
						&& (['from', 'to'] as const).some((end) => {
							const [x, y] = tipOf(wire, end)
							if (!within(block, x, y)) return false
							const away = tipOf(wire, end === 'from' ? 'to' : 'from')
							const middle = horizontal ? block.x + block.width / 2 : block.y + block.height / 2
							return ((horizontal ? away[0] : away[1]) < middle) === near
						}))
					const places = [...new Set(landing.map((wire) => wire.axis))].sort((a, b) => a - b)
					for (let i = 1; i < places.length; i++) {
						if (places[i] - places[i - 1] >= 2) continue
						const names = landing
							.filter((wire) => wire.axis === places[i] || wire.axis === places[i - 1])
							.map((wire) => wire.name)
						coincident.push([...new Set(names)].sort().join(' + '))
					}
				}
			}
		}
		expect([...new Set(coincident)].sort()).toEqual(COINCIDENT)
	})
})

/** The corner each command of a path leaves the pen at. */
const cornersOf = (path: string): [number, number][] =>
	[...path.matchAll(/[MLQA][^A-Z]*/g)].map(([command]) => {
		const numbers = command.slice(1).trim().split(/\s+/).map(Number)
		return [numbers[numbers.length - 2], numbers[numbers.length - 1]] as [number, number]
	})

const near = (one: [number, number], other: [number, number]) =>
	Math.abs(one[0] - other[0]) < 1e-9 && Math.abs(one[1] - other[1]) < 1e-9

/**
 * The drawing the reader sees and the outline a wire is stopped against have to
 * be the same shape, or a wire ends in a gap the picture does not show.  Both
 * come out of the one definition in `blocks.ts`, and these say so: every corner
 * the path names is a point of the sampled outline.
 */
describe('block shapes', () => {
	const shaped = DIAGRAMS
		.flatMap((diagram) => geometryOf(diagram).blocks)
		.filter((block) => ['alu', 'and', 'or', 'nor'].includes(block.shape))

	it('draws every path corner on the outline it is hit-tested against', () => {
		expect(shaped.length).toBeGreaterThan(0)
		for (const block of shaped) {
			const points = outlineOf(block)
			const stray = cornersOf(svgPathOf(block))
				.filter((corner) => !points.some((point) => near(point, corner)))
			expect(stray, `${block.shape} at ${block.x},${block.y}`).toEqual([])
		}
	})

	/** The ALU is all straight runs, so the two are the same list of vertices. */
	it('gives the ALU one set of vertices', () => {
		const alu = shaped.filter((block) => block.shape === 'alu')
		expect(alu.length).toBeGreaterThan(0)
		for (const block of alu) expect(cornersOf(svgPathOf(block))).toEqual(outlineOf(block))
	})
})
