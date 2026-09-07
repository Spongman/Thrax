/**
 * One thing under the pointer, named for the whole workspace.
 *
 * Hovering a word of memory lights the line that assembled it, the rows of the
 * history that ran it, the registers holding it and the symbol that names it.
 * None of those panels knows about any other: whichever one the pointer is over
 * says what it is over, and the rest answer if they have it.
 *
 * A hover has a kind, because "0x10010000" and "$t0" and "buffer" are different
 * questions and a panel that shows all three must not light the wrong one.  A
 * panel may say more than one thing at once, since one thing can be several: a
 * symbol name is also the address it stands for, and lights both.
 */

import { useTHRAXStore } from './thraxStore'

export const HOVER_KINDS = ['address', 'register', 'symbol'] as const

export type HoverKind = (typeof HOVER_KINDS)[number]

/** What each kind of hover carries. */
export interface HoverValues {
	address: number
	register: string
	symbol: string
}

export type Hovered = { [Kind in HoverKind]: HoverValues[Kind] | null }

export const NOTHING_HOVERED: Hovered = { address: null, register: null, symbol: null }

/**
 * What is under the pointer of this kind, anywhere in the workspace, or null.
 * Subscribed one kind at a time, so a panel that shows addresses does not
 * redraw when a register is hovered somewhere else.
 */
export function useHovered<Kind extends HoverKind>(kind: Kind): HoverValues[Kind] | null {
	return useTHRAXStore((state) => state.hovered[kind]) as HoverValues[Kind] | null
}

/**
 * How a panel says what is under the pointer over it.  Kinds left out are left
 * alone, so a panel speaks only for what it knows; a kind given as null is
 * cleared, which is what a pointer leaving says.
 */
export function useHover(): (values: Partial<Hovered>) => void {
	return useTHRAXStore((state) => state.hover)
}
