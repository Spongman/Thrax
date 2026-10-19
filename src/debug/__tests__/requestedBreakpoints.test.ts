import { describe, expect, it } from 'vitest'
import type { RunControl } from '../../architectures/contracts'
import { SourceIndex } from '../../core/sourceIndex'
import { DebugSession } from '../session'

/** Only the breakpoint half of a machine, which is all rebind touches. */
function stub(): RunControl {
	const breakpoints = new Set<number>()
	return {
		breakpoints,
		addBreakpoint: (address: number) => { breakpoints.add(address) },
		removeBreakpoint: (address: number) => { breakpoints.delete(address) },
		getBreakpoints: () => [...breakpoints],
		configure: () => {},
	} as unknown as RunControl
}

const index = new SourceIndex('main.uasm', [
	{ file: 'main.uasm', line: 2, address: 0, instruction: 0 },
	{ file: 'main.uasm', line: 4, address: 4, instruction: 1 },
])

describe('breakpoints a program asks for', () => {
	it('become line breakpoints when the program is bound', () => {
		const session = new DebugSession()
		const machine = stub()
		session.rebind(machine, index, [4, 0x100])
		expect(session.view().breakpointLines).toEqual(new Map([['main.uasm', new Set([4])]]))
		expect(machine.getBreakpoints()).toEqual([4])
	})

	it('leave a session without any alone', () => {
		const session = new DebugSession()
		session.rebind(stub(), index)
		expect(session.view().breakpointLines.size).toBe(0)
	})
})
