/**
 * Where a drawing's wires actually sit.
 *
 * Two things have to be undone before the vertex numbers can be drawn as
 * lines.
 *
 * The first is registration.  A wire was painted by filling a three-pixel
 * block at every step with the coordinate at the block's top-left corner, so a
 * wire's centre line runs one and a half pixels below and to the right of the
 * numbers in `datapaths.ts`.  The blocks in `blocks.ts` were measured off the
 * finished image, so a stroke centred on the raw numbers sits out of true
 * against them by that much.
 *
 * The second is that the vertex graph is a propagation graph.  Which wire
 * carries the value next is definitive; where the two touch is not.  Some of
 * its edges are logical hops rather than drawn joints -- the adder feeds the
 * program counter through a route the drawing takes elsewhere -- and even the
 * real joints are a few pixels out, because the wiring the reader saw was
 * painted into the bitmap underneath rather than plotted from these numbers.
 * So the joints here are used to close those gaps, by stretching wires until
 * they meet.
 *
 * Which of those meetings is a junction and which is two wires crossing over is
 * a question the graph cannot answer at all.  The drawings answered it, with a
 * dot at one and nothing at the other, so those dots are read back out of the
 * images into `junctions.ts` and that is what gets drawn.
 */

import { XRAY_DATAPATHS } from './datapaths'
import type { XrayDiagram } from './datapaths'
import { insideShape, XRAY_DRAWINGS, XRAY_REROUTES } from './blocks'
import type { XrayBlock } from './blocks'
import { XRAY_DOTS } from './junctions'
import { BRUSH_OFFSET, DOT_RADIUS } from './drawing'

/** What a run points at when it goes nowhere else, rather than a vertex. */
const TERMINAL = 0

/**
 * How far a wire may be stretched to reach a joint.  Measured across all four
 * drawings, the edges that are drawn joints need at most twenty-four pixels and
 * most need under eight, while the logical hops need upwards of forty: the cut
 * sits in the gap between the two.
 */
const JOINT_STRETCH = 24

/** Two parallel wires only join if they are on the same line to begin with. */
const SAME_AXIS = 3

/** Half the wire's own width, so a corner is filled rather than notched. */
const OVERSHOOT = 1.5

/**
 * A tip this close to another wire is touching it as far as the drawing is
 * concerned, whether or not the graph records the connection.
 */
const TOUCHING = 7

/** How close a wire has to come to a block to count as running into it. */
const BLOCK_REACH = 26

/** How far a wire left hanging may be carried to reach the next thing in line. */
const LOOSE_REACH = 48

/** Edge wires start and end a few pixels inside the drawing. */
const EDGE_MARGIN = 8

/** How far from a dot a wire may run and still be one of the wires it joins. */
const DOT_REACH = 4

/** How far a block may be slid to balance it, so nothing lurches across the page. */
const BALANCE_LIMIT = 28

/** How far apart two gates may be measured and still be drawn as one row. */
const ROW_TOLERANCE = 8

/** How far a block may be stretched to spread its wires evenly across a face. */
const FIT_RANGE = 0.2

/** Clearance kept between a block's edge and a wire that has to stay on its face. */
const FACE_MARGIN = 4

/**
 * How far apart the halves of a staggered crossing sit.  Wide enough that the
 * two dots read as separate, which means wider than one of them.
 */
const STAGGER = 9

export interface XrayWire {
	index: number
	name: string
	horizontal: boolean
	/** Centre of the wire on the axis it does not travel along. */
	axis: number
	/** Travel coordinate at the end the value arrives from. */
	from: number
	/** Travel coordinate at the end the value leaves by. */
	to: number
}

export interface XrayArrow {
	/** Vertex the arrow belongs to, so it lights with its wire. */
	index: number
	/** Where the wire meets the block: the point of the arrow. */
	x: number
	y: number
	/** Which way it points, one step along the wire's travel. */
	dx: number
	dy: number
}

export interface XrayJunction {
	x: number
	y: number
	/** Vertex indices of the wires that meet here. */
	wires: number[]
}

export interface XrayGeometry {
	wires: XrayWire[]
	junctions: XrayJunction[]
	/** Where a value arrives at a block, as the drawings mark it. */
	arrows: XrayArrow[]
	byIndex: Map<number, XrayWire[]>
	/** The blocks as drawn, which is not quite where they were measured. */
	blocks: XrayBlock[]
}

/** Which face of a block a wire arrives at. */
export type XraySide = 'left' | 'right' | 'top' | 'bottom'

export interface XrayAttachment {
	wire: XrayWire
	end: 'from' | 'to'
	block: XrayBlock
	side: XraySide
}

const low = (wire: XrayWire) => Math.min(wire.from, wire.to)
const high = (wire: XrayWire) => Math.max(wire.from, wire.to)

const insideBlock = (block: XrayBlock, x: number, y: number) => insideShape(block, x, y)

/** Whether a point lies on a wire, and so is not a loose end. */
const covers = (wire: XrayWire, x: number, y: number) =>
	Math.abs((wire.horizontal ? y : x) - wire.axis) <= OVERSHOOT
	&& (wire.horizontal ? x : y) >= low(wire) - OVERSHOOT
	&& (wire.horizontal ? x : y) <= high(wire) + OVERSHOOT

const atEdge = (diagram: XrayDiagram, x: number, y: number) => {
	const { width, height } = XRAY_DATAPATHS[diagram]
	return x <= EDGE_MARGIN || y <= EDGE_MARGIN || x >= width - EDGE_MARGIN || y >= height - EDGE_MARGIN
}

/** Whether a point sits on the wall of the board the gates stand on. */
export const onPanel = (blocks: XrayBlock[], x: number, y: number) =>
	blocks.some((block) => block.shape === 'panel'
		&& x >= block.x - EDGE_MARGIN && x <= block.x + block.width + EDGE_MARGIN
		&& y >= block.y - EDGE_MARGIN && y <= block.y + block.height + EDGE_MARGIN
		&& (Math.abs(x - block.x) <= EDGE_MARGIN || Math.abs(x - block.x - block.width) <= EDGE_MARGIN
			|| Math.abs(y - block.y) <= EDGE_MARGIN || Math.abs(y - block.y - block.height) <= EDGE_MARGIN))

/** The point at one end of a wire. */
const tipOf = (wire: XrayWire, end: 'from' | 'to'): [number, number] =>
	wire.horizontal ? [wire[end], wire.axis] : [wire.axis, wire[end]]

/** How far past its own ends a coordinate lies, or zero if already on the wire. */
function overshoot(wire: XrayWire, coordinate: number): number {
	if (coordinate < low(wire)) return low(wire) - coordinate
	if (coordinate > high(wire)) return coordinate - high(wire)
	return 0
}

/**
 * Ends a reroute gives a coordinate for.  Those are where the drawing was
 * drawn to end, so the passes that close gaps leave them where they are.
 */
let pinned = new Set<string>()

/** Stretches one end of a wire out to `coordinate`, never pulling it back. */
function stretch(wire: XrayWire, end: 'from' | 'to', coordinate: number) {
	if (pinned.has(`${wire.index}.${end}`)) return
	// `from` lies behind `to`, so which way is further out depends on direction.
	const outward = end === 'from' ? Math.sign(wire.from - wire.to) : Math.sign(wire.to - wire.from)
	if (outward >= 0) wire[end] = Math.max(wire[end], coordinate)
	else wire[end] = Math.min(wire[end], coordinate)
}

/** Whichever end of `wire` is nearer to `coordinate`. */
const nearerEnd = (wire: XrayWire, coordinate: number): 'from' | 'to' =>
	Math.abs(wire.from - coordinate) <= Math.abs(wire.to - coordinate) ? 'from' : 'to'

/** Carries the nearer end of a wire out to `coordinate`, and a little past it. */
function reach(wire: XrayWire, coordinate: number) {
	const end = nearerEnd(wire, coordinate)
	const outward = end === 'from' ? Math.sign(wire.from - wire.to) : Math.sign(wire.to - wire.from)
	stretch(wire, end, coordinate + (outward >= 0 ? OVERSHOOT : -OVERSHOOT))
}

/**
 * The block a wire runs into, if any.  Running into one means being lined up
 * with the face it enters: a wire passing a few pixels above a block is going
 * by, not arriving, and dragging its end into the block would bend the drawing.
 */
function blockAt(blocks: XrayBlock[], wire: XrayWire, end: 'from' | 'to'): XrayBlock | null {
	const [x, y] = tipOf(wire, end)
	const [otherX, otherY] = tipOf(wire, end === 'from' ? 'to' : 'from')
	const inside = (block: XrayBlock, px: number, py: number) => insideShape(block, px, py)

	let best: XrayBlock | null = null
	let closest = Infinity
	for (const block of blocks) {
		if (block.shape === 'panel') continue
		// Lined up with the face, and short of it by no more than the reach.
		const alignedAcross = wire.horizontal
			? y >= block.y && y <= block.y + block.height
			: x >= block.x && x <= block.x + block.width
		if (!alignedAcross) continue
		const along = wire.horizontal ? x : y
		const near = wire.horizontal ? block.x : block.y
		const far = near + (wire.horizontal ? block.width : block.height)
		if (along < near - BLOCK_REACH || along > far + BLOCK_REACH) continue
		// A wire whose other end is inside the block is leaving it, not arriving.
		if (inside(block, otherX, otherY)) continue

		const distance = Math.max(0, near - along, along - far)
		if (distance < closest) {
			closest = distance
			best = block
		}
	}
	return best
}

/**
 * Where a wire should stop once it reaches `block`: half way across whatever
 * the block covers at the height the wire arrives at.  Going only as far as
 * the border leaves a gap against anything round, whose edge is inside its own
 * bounding box everywhere but the widest point, and the block is drawn over
 * the wire anyway so the extra length never shows.  Measuring it at the wire's
 * own height is what keeps the end under the block where the block is an arrow
 * or a nose, and so narrower there than the box around it.
 */
function insideOf(block: XrayBlock, wire: XrayWire): number {
	const across = wire.axis
	const start = wire.horizontal ? block.x : block.y
	const end = start + (wire.horizontal ? block.width : block.height)
	let near = Infinity
	let far = -Infinity
	for (let along = start; along <= end; along++) {
		if (!insideShape(block, ...(wire.horizontal ? [along, across] : [across, along]) as [number, number])) continue
		near = Math.min(near, along)
		far = Math.max(far, along)
	}
	// A wire lined up with nothing but the corner of the box has no such point.
	return far < near ? (start + end) / 2 : (near + far) / 2
}

/** Every wire end that runs into a block, and the face it arrives at. */
export function attachmentsOf(wires: XrayWire[], blocks: XrayBlock[]): XrayAttachment[] {
	const found: XrayAttachment[] = []
	for (const wire of wires) {
		for (const end of ['from', 'to'] as const) {
			// An end that already meets another wire has arrived; a block a little
			// further on is not what it was heading for.  This is what keeps the
			// address line into the lower multiplexer from being drawn up into
			// the upper one.
			const [tipX, tipY] = tipOf(wire, end)
			if (wires.some((other) => other.index !== wire.index && covers(other, tipX, tipY))) continue
			const block = blockAt(blocks, wire, end)
			if (!block) continue
			const tip = tipOf(wire, end)
			const side: XraySide = wire.horizontal
				? (tip[0] < block.x + block.width / 2 ? 'left' : 'right')
				: (tip[1] < block.y + block.height / 2 ? 'top' : 'bottom')
			found.push({ wire, end, block, side })
		}
	}
	return found
}

/**
 * The gates a drawing repeats as a row or a column.  Each was measured on its
 * own, so they come in a few pixels apart; balancing them separately then
 * pulls them further apart, since each follows its own wires.  Held as a group
 * they keep the one line the drawing reads as.
 */
function rowsOf(blocks: XrayBlock[]): { members: XrayBlock[]; origin: 'x' | 'y'; size: 'width' | 'height' }[] {
	const rows: { members: XrayBlock[]; origin: 'x' | 'y'; size: 'width' | 'height' }[] = []
	const taken = new Set<XrayBlock>()
	for (const [origin, size] of [['y', 'height'], ['x', 'width']] as const) {
		for (const block of blocks) {
			if (taken.has(block) || block.shape === 'panel' || block.shape === 'rows') continue
			const members = blocks.filter((other) => !taken.has(other)
				&& other.shape === block.shape && other.facing === block.facing
				&& Math.abs(other[origin] - block[origin]) <= ROW_TOLERANCE
				&& Math.abs(other[size] - block[size]) <= ROW_TOLERANCE)
			if (members.length < 2) continue
			for (const member of members) taken.add(member)
			rows.push({ members, origin, size })
		}
	}
	return rows
}

/**
 * Slides a block along the axis its wiring leaves it free to move on, until it
 * sits half way between whatever the wires run to on either side.
 *
 * A wire entering one face and leaving the opposite one pins nothing: the block
 * can slide along it, and its drawn placement is wherever the draughtsman left
 * it.  Wires arriving at the two faces across that axis do pin it, since they
 * have to keep landing on the block, so those set the range it may move in.
 */
function balance(wires: XrayWire[], blocks: XrayBlock[], attachments: XrayAttachment[]) {
	// The sizes to measure any stretch against, before anything is stretched,
	// and the rows to hold together, read off the drawing as it was measured.
	const measured = new Map(blocks.map((block) => [block, { width: block.width, height: block.height }]))
	const rows = rowsOf(blocks)
	/** The axis a block shares with the rest of its row, and may not leave. */
	const held = new Map(rows.flatMap(({ members, origin }) => members.map((member) => [member, origin] as const)))
	/** Applies a move, unless it collides or changes what meets the block. */
	const settle = (block: XrayBlock, origin: 'x' | 'y', to: number, mine: XrayAttachment[]) => {
		const was = block[origin]
		if (Math.abs(to - was) < 0.5) return
		const moved = { ...block, [origin]: to }
		const collides = blocks.some((other) => other !== block && other.shape !== 'panel'
			&& moved.x < other.x + other.width && other.x < moved.x + moved.width
			&& moved.y < other.y + other.height && other.y < moved.y + moved.height)
		if (collides) return

		// A block may not slide over a wire end it was clear of: the corner where
		// two wires meet is a joint, and a block drawn on top of one hides it.
		const swallowed = wires.some((wire) => (['from', 'to'] as const).some((end) => {
			const [x, y] = tipOf(wire, end)
			return insideShape(moved, x, y) && !insideShape(block, x, y)
		}))
		if (swallowed) return

		// Balancing tidies the drawing; it must not rewire it.
		const before = mine.map((a) => `${a.wire.index}.${a.end}`).sort().join()
		block[origin] = to
		const after = attachmentsOf(wires, blocks)
			.filter((a) => a.block === block)
			.map((a) => `${a.wire.index}.${a.end}`).sort().join()
		if (after !== before) block[origin] = was
	}

	/**
	 * Stretches a block so the wires meeting one of its faces land on even
	 * fractions of it: one centred, two either side of the middle, and so on.
	 *
	 * The wires cannot be moved to do this.  Where one runs between two blocks
	 * it would have to sit at an even fraction of both, and two blocks of
	 * different heights in different places cannot both be satisfied.  Fitting
	 * the block to its wires asks nothing of the other end.
	 */
	const fit = (block: XrayBlock, mine: XrayAttachment[], horizontal: boolean): boolean => {
		const origin = horizontal ? 'y' : 'x'
		const size = horizontal ? 'height' : 'width'
		const places = [...new Set(mine
			.filter((attachment) => attachment.wire.horizontal === horizontal)
			.map((attachment) => attachment.wire.axis))].sort((a, b) => a - b)
		if (places.length < 3) return false

		// Least squares through (even fraction, where the wire actually is).
		const fractions = places.map((_, index) => (index + 1) / (places.length + 1))
		const meanFraction = fractions.reduce((total, f) => total + f, 0) / places.length
		const meanPlace = places.reduce((total, place) => total + place, 0) / places.length
		const spread = fractions.reduce((total, f) => total + (f - meanFraction) ** 2, 0)
		if (spread < 1e-6) return false
		const covariance = fractions
			.reduce((total, f, index) => total + (f - meanFraction) * (places[index] - meanPlace), 0)

		// A fit the block cannot stretch far enough to make is not worth half
		// making: it would leave the wires no better spread and the block the
		// wrong size.  The decoder's outputs spread nearly corner to corner,
		// which no even sixths of its face can match.
		const wanted = covariance / spread
		const original = measured.get(block)?.[size] ?? block[size]
		if (wanted < original * (1 - FIT_RANGE) || wanted > original * (1 + FIT_RANGE)) return false
		const length = wanted
		const start = meanPlace - length * meanFraction

		const was = { origin: block[origin], size: block[size] }
		block[size] = length
		settle(block, origin, start, mine)
		// Undo the stretch too if the move was refused.
		if (block[origin] !== start) {
			block[size] = was.size
			return false
		}
		return true
	}

	// First, sit each block square on the wires that meet its faces, so two
	// inputs arrive either side of its middle rather than up in one corner.
	for (const block of blocks) {
		if (block.fixed || block.shape === 'panel' || block.shape === 'rows' || block.shape === 'pill') continue
		const mine = attachments.filter((attachment) => attachment.block === block)
		for (const horizontal of [true, false]) {
			// A horizontal wire meets a left or right face, and where it sits on
			// that face is the block's own position across it.
			const facing = mine.filter((attachment) => attachment.wire.horizontal === horizontal)
			if (facing.length === 0) continue
			const origin = horizontal ? 'y' : 'x'
			const size = horizontal ? 'height' : 'width'
			// A gate in a row keeps the drawing's own placement across the row.
			if (held.get(block) === origin) continue
			const places = facing.map((attachment) => attachment.wire.axis)
			const middle = places.reduce((total, place) => total + place, 0) / places.length

			// A block fitted to its wires is already where it should be.
			if (fit(block, mine, horizontal)) continue
			const room = Math.max(...places) - Math.min(...places)
			if (room > block[size] - FACE_MARGIN * 2) continue
			const wanted = middle - block[size] / 2
			const lowest = Math.max(...places) - block[size] + FACE_MARGIN
			const highest = Math.min(...places) - FACE_MARGIN
			settle(block, origin, Math.max(
				block[origin] - BALANCE_LIMIT, lowest,
				Math.min(block[origin] + BALANCE_LIMIT, highest, wanted),
			), mine)
		}
	}

	for (const block of blocks) {
		// The register file stays where it was measured: the gates, their wires
		// and the pin captions are all placed from it, so moving it would shift
		// the pins away from the traces that run into them.
		if (block.fixed || block.shape === 'panel' || block.shape === 'rows') continue
		const mine = attachments.filter((attachment) => attachment.block === block)

		for (const horizontal of [true, false]) {
			const [before, after]: XraySide[] = horizontal ? ['left', 'right'] : ['top', 'bottom']
			const origin = horizontal ? 'x' : 'y'
			const size = horizontal ? 'width' : 'height'
			if (held.get(block) === origin) continue

			// What the wires leaving each face run to: the nearest is the limit.
			const reachOf = (side: XraySide) => mine
				.filter((attachment) => attachment.side === side && attachment.wire.horizontal === horizontal)
				.map((attachment) => attachment.wire[attachment.end === 'from' ? 'to' : 'from'])
			const behind = reachOf(before)
			const ahead = reachOf(after)
			if (behind.length === 0 || ahead.length === 0) continue

			// Wires landing on the faces across this axis already fix the block
			// along it -- an address line arriving at the top of a multiplexer
			// says where its middle is -- so there is nothing to slide.
			const crossing = mine.filter((attachment) => attachment.wire.horizontal !== horizontal)
			if (crossing.length > 0) continue
			const lowest = -Infinity
			const highest = Infinity

			// A block may not slide out of reach of the wires that meet it.
			const tipsOf = (side: XraySide) => mine
				.filter((attachment) => attachment.side === side && attachment.wire.horizontal === horizontal)
				.map((attachment) => attachment.wire[attachment.end])
			const nearest = Math.min(...tipsOf(before).map((tip) => tip + BLOCK_REACH), highest)
			const furthest = Math.max(...tipsOf(after).map((tip) => tip - block[size] - BLOCK_REACH), lowest)
			if (furthest > nearest) continue

			const middle = (Math.max(...behind) + Math.min(...ahead)) / 2
			const wanted = middle - block[size] / 2
			const settled = Math.max(
				block[origin] - BALANCE_LIMIT, furthest,
				Math.min(block[origin] + BALANCE_LIMIT, nearest, wanted),
			)
			if (!Number.isFinite(settled)) continue

			settle(block, origin, settled, mine)
		}
	}

	// Balancing works a block at a time, so a row of gates comes out of it
	// ragged.  Putting one back on a single line is a change to the whole row
	// at once: if it costs any member what its wires meet, the row keeps what
	// balancing gave it instead.
	for (const { members, origin, size } of rows) {
		const mean = (of: 'x' | 'y' | 'width' | 'height') =>
			members.reduce((total, member) => total + member[of], 0) / members.length
		const was = members.map((member) => ({ ...member }))
		const before = attachmentsOf(wires, blocks).map((a) => `${a.wire.index}.${a.end}`).sort().join()
		const place = mean(origin)
		const span = mean(size)
		for (const member of members) {
			member[origin] = place
			member[size] = span
		}
		const after = attachmentsOf(wires, blocks).map((a) => `${a.wire.index}.${a.end}`).sort().join()
		if (after !== before) members.forEach((member, index) => Object.assign(member, was[index]))
	}
}

/**
 * The point two connected wires meet at, or null when the edge is a hop the
 * drawing never joined up.
 */
function meetingPoint(wire: XrayWire, next: XrayWire): [number, number] | null {
	if (wire.horizontal !== next.horizontal) {
		// Perpendicular wires can only meet where their two axes cross.
		const [horizontal, vertical] = wire.horizontal ? [wire, next] : [next, wire]
		const point: [number, number] = [vertical.axis, horizontal.axis]
		const needed = Math.max(overshoot(horizontal, point[0]), overshoot(vertical, point[1]))
		return needed <= JOINT_STRETCH ? point : null
	}

	// Parallel wires can only join end to end, and only along the same line.
	if (Math.abs(wire.axis - next.axis) > SAME_AXIS) return null
	// A pixel or two out would show as a step, so bring the shorter one across.
	if (wire.axis !== next.axis) {
		const [shorter, longer] = Math.abs(wire.to - wire.from) < Math.abs(next.to - next.from)
			? [wire, next]
			: [next, wire]
		shorter.axis = longer.axis
	}
	const gap = Math.min(
		...[wire.from, wire.to].flatMap((a) => [next.from, next.to].map((b) => Math.abs(a - b))),
	)
	if (gap > JOINT_STRETCH) return null
	const travel = (wire.to + next.from) / 2
	const axis = (wire.axis + next.axis) / 2
	return wire.horizontal ? [travel, axis] : [axis, travel]
}

function build(diagram: XrayDiagram): XrayGeometry {
	const vertices = XRAY_DATAPATHS[diagram].vertices
	const drawn = vertices.filter((vertex) => !vertex.isText)

	// Every coordinate moves by the brush offset, which is what brings the wires
	// back into register with the blocks.
	const reroute = XRAY_REROUTES[diagram]
	const wires: XrayWire[] = drawn
		.filter((vertex) => !reroute?.drop.includes(vertex.index))
		.flatMap((vertex) => {
			const piece: XrayWire = {
				index: vertex.index,
				name: vertex.name,
				horizontal: vertex.movingXaxis,
				axis: (reroute?.moveAxis[vertex.index] ?? vertex.otherAxis) + BRUSH_OFFSET,
				from: (reroute?.span?.[vertex.index]?.from ?? vertex.init) + BRUSH_OFFSET,
				to: (reroute?.span?.[vertex.index]?.to ?? vertex.end) + BRUSH_OFFSET,
			}
			const step = reroute?.step?.[vertex.index]
			if (!step) return [piece]
			// Along its first lane, across to the second, then along that one.
			const at = step.at + BRUSH_OFFSET
			const onward = step.axis + BRUSH_OFFSET
			return [
				{ ...piece, to: at },
				{ ...piece, horizontal: !piece.horizontal, axis: at, from: piece.axis, to: onward },
				{ ...piece, axis: onward, from: at },
			]
		})
	// A wire drawn with a step in it arrives by its first piece and leaves by
	// its last, so which piece a joint is with depends on the way the value goes.
	const arrivesAt = new Map(wires.map((wire) => [wire.index, wire]))
	const leavesBy = new Map([...wires].reverse().map((wire) => [wire.index, wire]))
	pinned = new Set(Object.entries(reroute?.span ?? {}).flatMap(([index, span]) =>
		(['from', 'to'] as const).filter((end) => span[end] !== undefined).map((end) => `${index}.${end}`)))
	const drawable = new Set(drawn.map((vertex) => vertex.index))

	// Settle the blocks before anything is stretched to meet them, so the passes
	// that close gaps all work against where the blocks finally sit.  The
	// measured drawing is copied rather than moved about.
	const blocks = XRAY_DRAWINGS[diagram].blocks.map((block) => ({ ...block }))
	balance(wires, blocks, attachmentsOf(wires, blocks))

	// Whether the joint lands in the middle of a wire rather than on its end
	// decides if it gets a dot: a tap needs one, a plain corner does not.
	const joints: { point: [number, number]; wires: number[]; tap: boolean }[] = []
	const found = new Map<string, (typeof joints)[number]>()

	const addJunction = (point: [number, number], meeting: number[], tap: boolean) => {
		const key = `${Math.round(point[0])},${Math.round(point[1])}`
		const existing = found.get(key)
		if (existing) {
			existing.tap = existing.tap || tap
			for (const index of meeting) {
				if (!existing.wires.includes(index)) existing.wires.push(index)
			}
			return
		}
		const joint = { point, wires: [...meeting], tap }
		found.set(key, joint)
		joints.push(joint)
	}

	for (const vertex of drawn) {
		const wire = leavesBy.get(vertex.index)
		// A vertex a reroute leaves undrawn has no wire to join anything to.
		if (!wire) continue
		for (const target of vertex.targets) {
			// A run ends by pointing at zero, which is not vertex zero.
			if (target === TERMINAL) continue
			const next = arrivesAt.get(target)
			if (!next || next.index === wire.index || !drawable.has(target)) continue

			const point = meetingPoint(wire, next)
			if (!point) continue

			const wireCoordinate = wire.horizontal ? point[0] : point[1]
			const nextCoordinate = next.horizontal ? point[0] : point[1]
			// A joint inside a wire's run is a tap off it; note it before the
			// stretching below makes every joint look like an end.
			const tap = (overshoot(wire, wireCoordinate) === 0 && Math.min(
				Math.abs(wireCoordinate - wire.from), Math.abs(wireCoordinate - wire.to)) > SAME_AXIS)
				|| (overshoot(next, nextCoordinate) === 0 && Math.min(
					Math.abs(nextCoordinate - next.from), Math.abs(nextCoordinate - next.to)) > SAME_AXIS)

			reach(wire, wireCoordinate)
			reach(next, nextCoordinate)

			addJunction(point, [wire.index, next.index], tap)
		}
	}

	// The graph records how a value travels, not everything the drawing joins
	// up, so a tip left stopping just short of another wire is taken as meeting
	// it.  A perpendicular pair meets at the crossing of their two axes.
	for (const wire of wires) {
		for (const end of ['from', 'to'] as const) {
			const tip = wire[end]
			const crossed = wires.filter((other) => {
				if (other.index === wire.index || other.horizontal === wire.horizontal) return false
				// Lined up to cross this wire, and only just out of reach of it.
				if (wire.axis < low(other) - SAME_AXIS || wire.axis > high(other) + SAME_AXIS) return false
				const gap = Math.abs(tip - other.axis)
				return gap > 0 && gap <= TOUCHING
			})
			if (crossed.length === 0) continue

			// Reaching the furthest of them reaches all of them, where stopping at
			// the nearest would leave the rest still short.
			const furthest = crossed.reduce((far, other) =>
				Math.abs(tip - other.axis) > Math.abs(tip - far.axis) ? other : far)
			stretch(wire, end, furthest.axis + Math.sign(furthest.axis - tip) * OVERSHOOT)

			for (const other of crossed) {
				// A wire landing along another's run taps off it, so it gets a dot.
				if (wire.axis <= low(other) + SAME_AXIS || wire.axis >= high(other) - SAME_AXIS) continue
				const point: [number, number] = wire.horizontal ? [other.axis, wire.axis] : [wire.axis, other.axis]
				addJunction(point, [wire.index, other.index], true)
			}
		}
	}

	// Anything running into a block is carried to the middle of it, where the
	// block is drawn over the join.
	for (const wire of wires) {
		for (const end of ['from', 'to'] as const) {
			// An end that already turns off along another wire has arrived, so a
			// block a little further on is not what it was heading for: the
			// select line into a gate stops on its own feed, short of the gate.
			// Only a wire crossing it can stop it: one running alongside is the
			// next piece of the same run, still on its way to the block.
			const [tipX, tipY] = tipOf(wire, end)
			if (wires.some((other) => other.index !== wire.index
				&& other.horizontal !== wire.horizontal && covers(other, tipX, tipY))) continue
			const block = blockAt(blocks, wire, end)
			if (!block) continue
			const target = insideOf(block, wire)
			const other = wire[end === 'from' ? 'to' : 'from']
			// A block that has settled toward its wiring draws the ends in, just
			// as one that settled away pushes them out; either way the wire has
			// to keep a length.
			if (pinned.has(`${wire.index}.${end}`)) continue
			if (Math.abs(target - other) > 8) wire[end] = target
			else stretch(wire, end, target)
		}
	}

	// Whatever is still hanging in mid-air is carried on to the nearest thing in
	// line with it.  The drawing has gaps the graph knows nothing about, such as
	// the top bus, which it splits into pieces it never says are one wire.
	for (const wire of wires) {
		for (const end of ['from', 'to'] as const) {
			const [x, y] = tipOf(wire, end)
			const settled = blocks.some((block) => block.shape !== 'panel' && insideBlock(block, x, y))
				|| onPanel(blocks, x, y)
				|| joints.some((joint) => Math.abs(joint.point[0] - x) <= OVERSHOOT * 2 && Math.abs(joint.point[1] - y) <= OVERSHOOT * 2)
				|| wires.some((other) => other.index !== wire.index && covers(other, x, y))
				|| atEdge(diagram, x, y)
			if (settled) continue

			const outward = Math.sign(wire[end] - wire[end === 'from' ? 'to' : 'from']) || 1
			let nearest: number | null = null
			const consider = (coordinate: number) => {
				const distance = (coordinate - wire[end]) * outward
				if (distance <= 0 || distance > LOOSE_REACH) return
				if (nearest === null || distance < (nearest - wire[end]) * outward) nearest = coordinate
			}

			for (const other of wires) {
				if (other.index === wire.index) continue
				if (other.horizontal !== wire.horizontal) {
					// A wire it would cross, if it went far enough.
					if (wire.axis >= low(other) - SAME_AXIS && wire.axis <= high(other) + SAME_AXIS) consider(other.axis)
				} else if (Math.abs(other.axis - wire.axis) <= SAME_AXIS) {
					// A piece of the same run, further along.
					consider(low(other))
					consider(high(other))
				}
			}
			for (const block of blocks) {
				const alignedAcross = wire.horizontal
					? wire.axis >= block.y && wire.axis <= block.y + block.height
					: wire.axis >= block.x && wire.axis <= block.x + block.width
				if (!alignedAcross) continue
				if (block.shape === 'panel') {
					// A wire runs up to the board's wall, not through to its middle.
					consider(wire.horizontal ? block.x : block.y)
					consider(wire.horizontal ? block.x + block.width : block.y + block.height)
				} else {
					consider(insideOf(block, wire))
				}
			}
			if (nearest !== null) stretch(wire, end, nearest + outward * OVERSHOOT)
		}
	}

	// Which wires the graph says are joined, for telling one of two wires running
	// alongside each other from the other.
	const connected = new Set<string>()
	for (const vertex of drawn) {
		for (const target of vertex.targets) {
			if (target !== TERMINAL) connected.add(`${vertex.index},${target}`)
		}
	}

	// The painted dots decide which meetings are junctions.  A dot is placed at
	// the crossing of the wires it belongs to, so it sits exactly where they
	// cross rather than a pixel or two off it.
	const junctions: XrayJunction[] = []
	for (const [dotX, dotY] of XRAY_DOTS[diagram]) {
		const x = dotX + BRUSH_OFFSET
		const y = dotY + BRUSH_OFFSET
		// The wires that could be meeting here: one of each direction, close
		// enough that the dot is on them.  Neighbours running a pixel away are
		// candidates too, which is why the graph gets a say below.
		const candidates = (horizontal: boolean) => wires.filter((wire) => {
			if (wire.horizontal !== horizontal) return false
			const along = wire.horizontal ? x : y
			if (along < low(wire) - DOT_REACH || along > high(wire) + DOT_REACH) return false
			return Math.abs((wire.horizontal ? y : x) - wire.axis) <= DOT_REACH
		})
		const across = (wire: XrayWire) => Math.abs((wire.horizontal ? y : x) - wire.axis)
		const flat = candidates(true).sort((a, b) => across(a) - across(b))
		const upright = candidates(false).sort((a, b) => across(a) - across(b))

		// Where two wires run alongside each other the nearest is not always the
		// one that joins, so a pair the graph connects wins over a closer pair.
		let horizontal = flat[0] ?? null
		let vertical = upright[0] ?? null
		for (const a of flat) {
			const partner = upright.find((b) => connected.has(`${a.index},${b.index}`) || connected.has(`${b.index},${a.index}`))
			if (partner) {
				horizontal = a
				vertical = partner
				break
			}
		}
		const meeting = [horizontal, vertical].filter((wire): wire is XrayWire => wire !== null)
		if (meeting.length < 2) continue

		// Put the dot where those wires actually run, and bring them to it.
		const point: [number, number] = [vertical!.axis, horizontal!.axis]
		if (junctions.some((made) => made.x === point[0] && made.y === point[1])) continue
		for (const wire of meeting) reach(wire, wire.horizontal ? point[0] : point[1])

		// A bus drawn in segments has one ending here and the next starting, as
		// well as the wire tapping off it, so the joint is more than the pair
		// that placed it.  A wire only belongs to it if it reaches the dot and
		// the graph joins it to something already there: others merely cross.
		const reaches = (wire: XrayWire) => {
			const along = wire.horizontal ? point[0] : point[1]
			return Math.abs((wire.horizontal ? point[1] : point[0]) - wire.axis) <= OVERSHOOT
				&& along >= low(wire) - OVERSHOOT && along <= high(wire) + OVERSHOOT
		}
		const joined = [...meeting]
		for (const wire of wires) {
			if (joined.includes(wire) || !reaches(wire)) continue
			const linked = joined.some((other) =>
				connected.has(`${wire.index},${other.index}`) || connected.has(`${other.index},${wire.index}`))
			if (linked) joined.push(wire)
		}
		junctions.push({ x: point[0], y: point[1], wires: joined.map((wire) => wire.index) })
	}

	// An arrow goes where a value arrives: at the block it runs into, and
	// at the dot where it joins what carries it on.  A wire runs from where its
	// value comes from to where it goes, so the arrow is on the `to` end, and it
	// points the way the wire travels.
	const arrows: XrayArrow[] = []
	for (const wire of XRAY_DRAWINGS[diagram].arrowheads ? wires : []) {
		const [tipX, tipY] = tipOf(wire, 'to')
		const forwardStep = Math.sign(wire.to - wire.from) || 1
		const dot = junctions.find((junction) =>
			Math.abs(junction.x - tipX) <= DOT_RADIUS + OVERSHOOT && Math.abs(junction.y - tipY) <= DOT_RADIUS + OVERSHOOT)
		if (dot) {
			arrows.push({
				index: wire.index,
				x: dot.x - (wire.horizontal ? forwardStep * DOT_RADIUS : 0),
				y: dot.y - (wire.horizontal ? 0 : forwardStep * DOT_RADIUS),
				dx: wire.horizontal ? forwardStep : 0,
				dy: wire.horizontal ? 0 : forwardStep,
			})
			continue
		}
		const block = blocks.find((candidate) => candidate.shape !== 'panel' && insideShape(candidate, tipX, tipY))
		if (!block) continue
		// A run carried in by its last two pieces arrives once, and a wire that
		// starts under the block never arrives at all.
		const [backX, backY] = tipOf(wire, 'from')
		if (insideShape(block, backX, backY)) continue
		const forward = Math.sign(wire.to - wire.from) || 1
		const [dx, dy] = wire.horizontal ? [forward, 0] : [0, forward]
		// Back out of the block to where the wire crosses its edge.
		let along = wire.to
		while (insideShape(block, ...(wire.horizontal ? [along - forward, wire.axis] : [wire.axis, along - forward]) as [number, number])) {
			along -= forward
			if (Math.abs(along - wire.from) < 1) break
		}
		const arrow: XrayArrow = wire.horizontal
			? { index: wire.index, x: along, y: wire.axis, dx, dy }
			: { index: wire.index, x: wire.axis, y: along, dx, dy }
		if (arrows.some((made) => made.x === arrow.x && made.y === arrow.y && made.dx === dx && made.dy === dy)) continue
		arrows.push(arrow)
	}

	const pieces = new Map<number, XrayWire[]>()
	for (const wire of wires) {
		const known = pieces.get(wire.index)
		if (known) known.push(wire)
		else pieces.set(wire.index, [wire])
	}

	return { wires, junctions, arrows, byIndex: pieces, blocks }
}

const cache = new Map<XrayDiagram, XrayGeometry>()

/** The wires and joints of one drawing, worked out once. */
export function geometryOf(diagram: XrayDiagram): XrayGeometry {
	const known = cache.get(diagram)
	if (known) return known
	const built = build(diagram)
	cache.set(diagram, built)
	return built
}
