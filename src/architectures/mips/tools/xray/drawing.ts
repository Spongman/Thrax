/**
 * The pen the X-Ray drawings are drawn with.
 *
 * Three things draw them: the view, the geometry that works out where a wire
 * stops, and the SVG export.  They have to agree on how wide a track is and how
 * big a junction dot is drawn, or a wire ends short of a dot in one and through
 * it in another, so the sizes live here rather than in each of them.
 */

/** The three-pixel brush is anchored at the coordinate, not around it. */
export const BRUSH_OFFSET = 1.5

/** A line meant to sit at `place` is recorded at the brush's corner, behind it. */
export const brush = (place: number) => place - BRUSH_OFFSET

/** Width of a filled track, in diagram pixels. */
export const TRACK_WIDTH = 2.5

/**
 * The junction dot as it is drawn, wide enough to cover the wires meeting under
 * it, which is also how far short of one an arrow stops.
 */
export const DOT_RADIUS = 3

/** The head drawn where a value arrives at a block: length, then width. */
export const ARROW = { length: 9, width: 8 }

/** The two pins on a register row, as fractions of its height. */
export const ROW_PIN = { ctrl: 0.35, data: 0.75 }

/** Where an arrowhead points, and which way. */
export interface XrayHead {
	x: number
	y: number
	dx: number
	dy: number
}

/** The head as a triangle, its point on the block and its back along the wire. */
export function arrowCorners({ x, y, dx, dy }: XrayHead): [number, number][] {
	const [backX, backY] = [x - dx * ARROW.length, y - dy * ARROW.length]
	const [sideX, sideY] = [(dy * ARROW.width) / 2, (dx * ARROW.width) / 2]
	return [[x, y], [backX + sideX, backY + sideY], [backX - sideX, backY - sideY]]
}
