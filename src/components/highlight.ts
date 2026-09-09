import React from 'react'
import { useTHRAXStore } from '../store/thraxStore'
import './highlight.css'

/**
 * The two fading highlights, and when a panel wears one.
 *
 * They answer different questions and so are different colours: navigation says
 * *where a click sent you*, and change says *what the last step moved*. One
 * navigation lights one thing in one panel; a step can light several at once.
 *
 * A highlight fades rather than latching, so nothing has to decide when to take
 * it off, and a second navigation to the same place lights it again.
 */

export type FlashKind = 'navigation' | 'change'

export const flashClass = (kind: FlashKind) => `flash-${kind}`

/** How much of the chosen colour a fade starts at, so text stays readable under it. */
const FLASH_ALPHA = 0.55

/** `#rrggbb` with an alpha, since a colour input cannot carry one. */
export function withAlpha(hex: string, alpha: number): string {
	const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
	if (!match) return hex
	const [red, green, blue] = match.slice(1).map((pair) => parseInt(pair, 16))
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/**
 * Puts the chosen duration and colours where the stylesheet reads them.  The
 * animation itself stays in CSS; only what it runs for and what it starts at
 * are settings, so nothing has to re-render for a colour to change.
 */
export function useHighlightTheme() {
	const { highlightChangeColor, highlightNavigationColor, highlightSeconds } = useTHRAXStore((state) => state.settings)
	React.useEffect(() => {
		const root = document.documentElement.style
		root.setProperty('--flash-duration', `${highlightSeconds}s`)
		root.setProperty('--flash-navigation', withAlpha(highlightNavigationColor, FLASH_ALPHA))
		root.setProperty('--flash-change', withAlpha(highlightChangeColor, FLASH_ALPHA))
		// The colour a fade ends on, which is the same colour: fading towards a
		// different one tints the cell on its way out.
		root.setProperty('--flash-navigation-clear', withAlpha(highlightNavigationColor, 0))
		root.setProperty('--flash-change-clear', withAlpha(highlightChangeColor, 0))
	}, [highlightChangeColor, highlightNavigationColor, highlightSeconds])
}

/** How long the class stays on, which has to outlast the fade it triggers. */
function useFlashMilliseconds(): number {
	return useTHRAXStore((state) => state.settings.highlightSeconds) * 1000
}

/**
 * A value that is shown and then cleared once the fade has run.
 *
 * The timer belongs to the flash rather than to the effect that started it.  As
 * a cleanup it was cancelled whenever a dependency changed, and the effect that
 * re-ran had nothing new to light and so scheduled nothing: scrolling a panel
 * mid-fade, or changing the fade duration, left the highlight on for good.
 */
function useFading<T>(empty: T): [T, (next: T, milliseconds: number) => void] {
	const [value, setValue] = React.useState<T>(empty)
	const handle = React.useRef(0)
	React.useEffect(() => () => window.clearTimeout(handle.current), [])
	const show = React.useCallback((next: T, milliseconds: number) => {
		window.clearTimeout(handle.current)
		setValue(next)
		handle.current = window.setTimeout(() => setValue(empty), milliseconds)
	}, [empty])
	return [value, show]
}

/**
 * Whether the thing this is called for should be wearing `kind` right now.
 *
 * `token` is whatever changes when there is something new to show: a request
 * counter for a navigation, the value itself for a change.  A null token, or
 * the setting being off, means no highlight at all.
 */
export function useFlash(kind: FlashKind, token: number | string | null): boolean {
	const enabled = useTHRAXStore((state) => (
		kind === 'navigation' ? state.settings.highlightNavigation : state.settings.highlightChanges
	))
	const milliseconds = useFlashMilliseconds()
	const [lit, flash] = useFading(false)
	// A change flash starts from what it finds, so opening a panel does not light
	// everything in it.  A navigation starts from nothing, because a panel that
	// opens holding a destination was opened to show it: clicking an address with
	// the memory window shut brought it back, scrolled to the word, and left the
	// word unlit.  The panel reveals a pending destination on mount either way, so
	// lighting it is what makes the two agree.
	const previous = React.useRef<number | string | null>(kind === 'navigation' ? null : token)

	React.useEffect(() => {
		if (previous.current === token) return
		previous.current = token
		if (!enabled || token === null) return
		flash(true, milliseconds)
	}, [enabled, flash, milliseconds, token])

	return lit && enabled
}

/** Names whose value is not what it was, which is what a change flash lights. */
export function movedEntries(
	before: ReadonlyMap<string, number> | null,
	now: ReadonlyMap<string, number>,
): Set<string> {
	const moved = new Set<string>()
	// A name that was not there before has not moved: it has only just appeared,
	// which is what switching panels looks like and is not worth a flash.
	if (before === null) return moved
	for (const [name, value] of now) {
		if (before.has(name) && before.get(name) !== value) moved.add(name)
	}
	return moved
}

const NOTHING: ReadonlySet<string> = new Set()

/**
 * The entries that moved since the last render, held for as long as the flash
 * lasts and then let go.
 *
 * A panel showing a file of values needs the whole file diffed rather than a
 * token per value, and the first render reports nothing: arriving at a panel is
 * not a change to what it shows.
 *
 * `edits` counts the changes the panel made itself.  A change flash says what
 * the machine did; what the user just typed is already under their caret, so a
 * diff that follows a bump of this counter is recorded without being lit.  The
 * counter is a dependency as well as a signal, so an edit that writes back the
 * value already there still clears it rather than leaving it to swallow the
 * next real change.
 */
export function useChangedEntries(entries: ReadonlyArray<readonly [string, number]>, edits = 0): ReadonlySet<string> {
	const enabled = useTHRAXStore((state) => state.settings.highlightChanges)
	const milliseconds = useFlashMilliseconds()
	const previous = React.useRef<ReadonlyMap<string, number> | null>(null)
	const lastEdits = React.useRef(edits)
	const [changed, flash] = useFading<ReadonlySet<string>>(NOTHING)
	// The values themselves are the dependency; the array holding them is rebuilt
	// every render and would fire this on every one.
	const signature = entries.map(([name, value]) => `${name}:${value}`).join(',')

	React.useEffect(() => {
		const before = previous.current
		const now = new Map(entries)
		previous.current = now
		const typed = lastEdits.current !== edits
		lastEdits.current = edits
		if (!enabled || typed) return
		const moved = movedEntries(before, now)
		if (moved.size === 0) return
		flash(moved, milliseconds)
	}, [signature, edits, enabled, flash, milliseconds])

	return enabled ? changed : NOTHING
}
