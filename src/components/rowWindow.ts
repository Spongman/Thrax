import React from 'react'

/**
 * Drawing only the rows a scroller actually shows.
 *
 * The memory window and the history are both far longer than any panel: memory
 * windows thousands of rows of an address space, the history one row per
 * instruction ever run.  Both keep a spacer the full height of the list so the
 * scrollbar reads true, and fill only the band under the viewport.
 *
 * The rows are placed by hand rather than laid out, and placed `fixed` rather
 * than `absolute`: a fixed row is out of flow entirely, so a scroll moves the
 * pool by rewriting three numbers per row instead of reflowing a column of
 * them.  That costs the three things below, which is why this is one module
 * rather than a technique each panel reimplements.
 *
 * - The scroller has to become the containing block for its own rows, which
 *   `clip-path: inset(0)` does, and which also clips them to it.
 * - Fixed positioning then resolves from that element's padding box, so where
 *   it resolves from has to be measured rather than assumed: a probe reports it.
 * - Fixed rows sit outside the scroll chain, so the wheel never reaches the
 *   scroller and has to be handed to it.
 */

/** A scroller's own size, in pixels. */
export interface Viewport { width: number, height: number }

export interface RowWindow {
	/** Index of the first row to draw. */
	first: number
	/** How many rows to draw, which is a fixed count away from the ends. */
	count: number
}

/** Where row zero sits, and how wide a row is, in the coordinates fixed rows use. */
export interface RowFrame { top: number, left: number, width: number }

/**
 * The band of rows to draw for a scroller of `height` sitting at `scrollTop`.
 *
 * `overscan` rows are drawn past each edge so a scroll of less than a row does
 * not expose blank space.  `count` is the same on every scroll except at the
 * ends of the list, which is what lets a caller hold a pool of row elements and
 * rewrite them rather than mount and unmount one per scroll.
 *
 * `first` is clamped to leave `count` rows behind it, so the last screenful is
 * a full one rather than a few rows against the bottom.
 */
export function rowWindow(scrollTop: number, height: number, rowHeight: number, total: number, overscan: number): RowWindow {
	const count = Math.min(total, Math.ceil(height / rowHeight) + overscan * 2)
	const first = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - overscan, total - count))
	return { first, count }
}

/**
 * Where a row at index zero belongs, from the scroller's box and the probe's.
 *
 * The probe is pinned to the origin fixed positioning resolves from, so the
 * difference between the two is the offset every row is placed at.  The border
 * is stepped over: rows belong inside it, against the padding box.
 */
export function rowFrame(
	grid: { top: number, left: number, clientTop: number, clientLeft: number, clientWidth: number },
	origin: { top: number, left: number },
): RowFrame {
	return {
		top: grid.top + grid.clientTop - origin.top,
		left: grid.left + grid.clientLeft - origin.left,
		width: grid.clientWidth,
	}
}

/** Where the row at `index` is pinned, for a scroller at `scrollTop`. */
export const rowTop = (frame: RowFrame, index: number, rowHeight: number, scrollTop: number) =>
	frame.top + index * rowHeight - scrollTop

const sameFrame = (a: RowFrame, b: RowFrame) => a.top === b.top && a.left === b.left && a.width === b.width

/**
 * A scroller whose rows are placed by hand: it reports its size, where it is
 * scrolled to, and the frame its rows are pinned against.
 *
 * Measuring the size is a layout effect and a `ResizeObserver` together: the
 * first tells the panel its size before anything is painted, the second keeps
 * it right as the panel is resized or a hidden tab is shown.  Both need the
 * element in the tree on every render, so a panel with nothing to show must
 * still render its scroller and put the message inside it.
 *
 * `deps` is for anything else that moves the frame and is not a resize of the
 * scroller itself.
 */
export function useFixedRowScroller<E extends HTMLElement = HTMLDivElement>(rowHeight: number, deps: React.DependencyList = []): {
	/** Goes on the scroller, which must carry `clip-path: inset(0)`. */
	ref: React.RefObject<E | null>
	/** Goes on an empty `position: fixed` span inside the scroller. */
	originRef: React.RefObject<HTMLSpanElement | null>
	viewport: Viewport
	scrollTop: number
	frame: RowFrame
	onScroll: (event: React.UIEvent<E>) => void
} {
	const ref = React.useRef<E>(null)
	const originRef = React.useRef<HTMLSpanElement>(null)
	const [viewport, setViewport] = React.useState<Viewport>({ width: 0, height: 0 })
	const [scrollTop, setScrollTop] = React.useState(0)
	const [frame, setFrame] = React.useState<RowFrame>({ top: 0, left: 0, width: 0 })
	const [layoutTick, setLayoutTick] = React.useState(0)

	React.useLayoutEffect(() => {
		const element = ref.current
		if (!element) return
		const measure = () => setViewport((current) => (
			current.width === element.clientWidth && current.height === element.clientHeight
				? current
				: { width: element.clientWidth, height: element.clientHeight }
		))
		const observer = new ResizeObserver(measure)
		observer.observe(element)
		measure()
		return () => observer.disconnect()
	}, [])

	// Where fixed positioning resolves from is whichever ancestor took the role of
	// containing block, so it is measured rather than assumed.
	React.useLayoutEffect(() => {
		const grid = ref.current
		const origin = originRef.current
		if (!grid || !origin) return
		const gridRect = grid.getBoundingClientRect()
		const next = rowFrame({
			top: gridRect.top,
			left: gridRect.left,
			clientTop: grid.clientTop,
			clientLeft: grid.clientLeft,
			clientWidth: grid.clientWidth,
		}, origin.getBoundingClientRect())
		setFrame((current) => (sameFrame(current, next) ? current : next))
	}, [layoutTick, viewport, scrollTop, ...deps])

	// Fixed rows sit outside the scroller's scroll chain, so the wheel never
	// reaches it on its own.
	React.useEffect(() => {
		const grid = ref.current
		if (!grid) return
		const onWheel = (event: WheelEvent) => {
			const factor = event.deltaMode === 1 ? rowHeight : event.deltaMode === 2 ? grid.clientHeight : 1
			grid.scrollTop += event.deltaY * factor
			grid.scrollLeft += event.deltaX * factor
			event.preventDefault()
		}
		grid.addEventListener('wheel', onWheel, { passive: false })
		return () => grid.removeEventListener('wheel', onWheel)
	}, [rowHeight])

	// A move of an ancestor does not resize the scroller, so re-measure on those too.
	React.useEffect(() => {
		const remeasure = (event?: Event) => {
			// The scroller's own scrolling already re-measures through the effect above.
			if (event?.target === ref.current) return
			setLayoutTick((tick) => tick + 1)
		}
		window.addEventListener('resize', remeasure)
		window.addEventListener('scroll', remeasure, true)
		return () => {
			window.removeEventListener('resize', remeasure)
			window.removeEventListener('scroll', remeasure, true)
		}
	}, [])

	const onScroll = React.useCallback((event: React.UIEvent<E>) => setScrollTop(event.currentTarget.scrollTop), [])

	return { ref, originRef, viewport, scrollTop, frame, onScroll }
}
