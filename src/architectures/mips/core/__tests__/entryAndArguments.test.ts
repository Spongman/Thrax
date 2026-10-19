import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator, type SimulatorOptions } from '../simulator'
import { splitProgramArguments } from '../../settings'

function build(source: string, options: Omit<SimulatorOptions, 'historySchema'> = {}) {
	const { program, machineCode, diagnostics } = assembleMips(source)
	expect(firstError(diagnostics)?.message).toBeUndefined()
	return new MipsSimulator(machineCode, program, undefined, { ...options, historySchema: mipsHistorySchema })
}

/** `main` sits a word into the text, so starting there is visible in the pc. */
const WITH_MAIN = '\tnop\n\t.globl main\nmain:\tli $t0, 1\n'
const LOCAL_MAIN = '\tnop\nmain:\tli $t0, 1\n'

describe('where a run starts', () => {
	it('starts at the text base by default, whatever is labelled', () => {
		expect(build(WITH_MAIN).pc).toBe(0x00400000)
	})

	it('starts at a global main when the setting asks for it', () => {
		expect(build(WITH_MAIN, { startAtMain: true }).pc).toBe(0x00400004)
	})

	it('falls back to the text base when main is one file`s own label', () => {
		// A local `main` is not the program's entry point; only a global one is.
		expect(build(LOCAL_MAIN, { startAtMain: true }).pc).toBe(0x00400000)
	})

	it('falls back when nothing is labelled main at all', () => {
		expect(build('\tnop\n', { startAtMain: true }).pc).toBe(0x00400000)
	})
})

describe('program arguments', () => {
	it('places argc and argv where a program looks for them', () => {
		const simulator = build('\tnop\n', { programArguments: ['one', 'two'] })

		expect(simulator.registers.$a0).toBe(2)
		const argv = simulator.registers.$a1 >>> 0
		const read = (address: number) => simulator.memory.get(address >>> 2) ?? 0

		const first = read(argv)
		expect(String.fromCharCode(read(first) & 0xff, (read(first) >> 8) & 0xff, (read(first) >> 16) & 0xff)).toBe('one')

		// The stack pointer ends up below the vector it just wrote.
		expect(simulator.registers.$sp >>> 0).toBeLessThan(argv)
	})

	it('leaves the stack alone when there are none', () => {
		const plain = build('\tnop\n')
		expect(plain.registers.$a0).toBe(0)
		expect(plain.registers.$sp >>> 0).toBe(0x7fffeffc)
	})

	it('splits the settings field into words, keeping a quoted one whole', () => {
		expect(splitProgramArguments('one two')).toEqual(['one', 'two'])
		expect(splitProgramArguments('  spaced   out  ')).toEqual(['spaced', 'out'])
		expect(splitProgramArguments('"two words" alone')).toEqual(['two words', 'alone'])
		expect(splitProgramArguments('')).toEqual([])
	})
})
