import { describe, expect, it } from 'vitest'
import { Kind } from '../effectKind'
import type { Effect, HistoryEntry } from '../types'

describe('the history entry shape', () => {
	it('covers every kind of change an instruction can make', () => {
		const effects: Effect[] = [
			{ kind: Kind.REGISTER, name: '$t0', value: 0 },
			{ kind: Kind.FP, index: 0, value: 0 },
			{ kind: Kind.FLAG, index: 0, value: false },
			{ kind: Kind.CP0, index: 12, value: 0 },
			{ kind: Kind.MEMORY, wordAddress: 0x04004000, words: [undefined, 7] },
			{ kind: Kind.CONSOLE, text: 'hi' },
			{ kind: Kind.CONSOLE_RESET, value: 'hi' },
			{ kind: Kind.DISPLAY, value: '' },
			{ kind: Kind.QUEUED_INPUT, value: 'ab' },
			{ kind: Kind.CALL, frame: { callAddress: 0, returnAddress: 4, targetAddress: 8 } },
			{ kind: Kind.HI_LO, hi: 0, lo: 0 },
			{ kind: Kind.HEAP_POINTER, value: 0x10040000 },
			{ kind: Kind.HALTED, value: false },
			{ kind: Kind.EXIT_CODE, value: null },
			{ kind: Kind.SLEEP, value: 0 },
			{ kind: Kind.INPUT, value: '42' },
		]

		// A memory effect covers a run of words, so one buffer write is one row.
		const memory = effects.find((effect) => effect.kind === Kind.MEMORY)!
		expect(memory).toMatchObject({ words: [undefined, 7] })
	})

	it('carries the subsystem copies only when an instruction took one', () => {
		const entry: HistoryEntry = {
			id: 1,
			instructionCount: 0,
			address: 0x00400000,
			word: 0x21080005,
			kind: 'instruction',
			pc: 0x00400000,
			delayState: 'none',
			delayedTarget: 0,
			effectStart: 0,
			effectCount: 0,
		}

		expect(entry.files).toBeUndefined()
		expect(entry.random).toBeUndefined()
	})
})
