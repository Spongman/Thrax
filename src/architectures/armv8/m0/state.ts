import { RGB32_LE } from '../../../core/bitmapFormats'
import { describeM0Token } from './dataTips'
import { REGISTERS } from './metadata'
import { memoryTop } from '../a64/layout'
import type { ExecutionState } from '../executionState'
import { assembleM0 } from './assembler'
import { DATA_BASE, TEXT_BASE } from './isa'
import { disassembly, M0Program } from './program'
import { M0Runtime } from './runtime'

export function createM0State(): ExecutionState {
	return {
		id: 'cortex-m0',
		assemble(sources, settings) {
			const program = assembleM0(sources, settings.memoryBytes)
			return program
		},
		createMachine(program, settings, options) {
			if (!(program instanceof M0Program)) throw new Error('Not a Cortex-M0 Thumb program')
			return new M0Runtime(program, settings.memoryBytes, options)
		},
		profile(settings) {
			const top = memoryTop(settings.memoryBytes)
			return {
				bitmap: RGB32_LE,
				resetPc: TEXT_BASE,
				resetRegisters: {
					...Object.fromEntries(REGISTERS.map((r) => [r.id, 0])),
					R13: top & ~7,
					MSP: top & ~7,
					PSP: top & ~7,
					XPSR: 1 << 24,
					PC: TEXT_BASE,
				},
				dataBase: DATA_BASE,
				memorySections: [
					{ id: 'text', label: 'Thumb code', start: TEXT_BASE, end: DATA_BASE - 1, code: true },
					{ id: 'data', label: 'Data and stack', start: DATA_BASE, end: top - 1 },
				],
				isMappedAddress: (value) => Number.isInteger(value) && value >= TEXT_BASE && value < top,
			}
		},
		disassembly,
		describeToken: (text, column, inspection, program) => describeM0Token(text, column, inspection, (name) => (program as M0Program | null)?.values.get(name)),
		values: program => (program as M0Program | null)?.values ?? null,
	}
}

export { REGISTERS, M0_VARIANT } from './metadata'
