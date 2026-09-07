/**
 * Dragging the marker that says where the machine stands.
 *
 * The history is the run laid out as a list, so where the present sits in it is
 * a position rather than a setting: taking hold of the marker and pulling it up
 * or down is the plainest way to move through a run, and it lands on the same
 * seek a double-click on a row does.
 *
 * Two rules make it work past the edge of the panel.  The marker is held to the
 * rows on screen, so it cannot be dragged somewhere the eye cannot follow it;
 * and the list scrolls under it while the pointer is outside, faster the
 * further out it is, so a long run can be crossed without letting go.
 */

/** Where the pointer is, in rows, held to the list and to what is on screen. */
export function rowAt(clientY: number, top: number, bottom: number, scrollTop: number, rowHeight: number, count: number): number {
	if (count === 0) return 0
	// Beyond the panel the marker stays at the edge, and the scrolling below is
	// what brings new rows to it.
	const inside = Math.min(Math.max(clientY, top), bottom - 1)
	const row = Math.floor((inside - top + scrollTop) / rowHeight)
	return Math.min(Math.max(row, 0), count - 1)
}

/** Pixels a frame moves at the furthest out the pointer usefully goes. */
const MAX_STEP = 48
/** How far past the edge counts as one unit of urgency. */
const SCALE = 6
/** Above one, so twice as far out is more than twice as fast. */
const CURVE = 1.4

/**
 * How far the list should scroll this frame, in pixels: nothing while the
 * pointer is over the panel, and away from the edge it has passed otherwise.
 */
export function scrollStep(clientY: number, top: number, bottom: number): number {
	const beyond = clientY < top ? clientY - top : clientY > bottom ? clientY - bottom : 0
	if (beyond === 0) return 0
	const speed = Math.min(MAX_STEP, Math.max(1, (Math.abs(beyond) / SCALE) ** CURVE))
	return Math.sign(beyond) * speed
}

/**
 * The row the scrollbar thumb points at, with the whole run mapped over the
 * track: the top of the track is the first instruction and the bottom the last,
 * whatever part of the list is on screen.
 *
 * That is the same as the row a fraction of the way down the visible rows, the
 * two being one and the same for a list scrolled the ordinary way, so the
 * marker travels with the thumb rather than lagging a screenful behind it.
 */
export function rowForScroll(scrollTop: number, scrollHeight: number, clientHeight: number, count: number): number {
	if (count === 0) return 0
	const track = scrollHeight - clientHeight
	const fraction = track > 0 ? Math.min(Math.max(scrollTop / track, 0), 1) : 0
	return Math.round(fraction * (count - 1))
}
