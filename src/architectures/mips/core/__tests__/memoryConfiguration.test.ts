import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MEMORY_CONFIGURATIONS, type MemoryConfigurationValues } from '../../memoryConfigurations'
import { MipsSimulator } from '../simulator'
import { sectionsFor } from '../../profile'

const SOURCE = `
	.data
msg:	.asciiz "hi"
here:	.word msg
	.extern shared, 8
	.text
main:	la $t0, msg
	nop
	.ktext
	nop
`

function build(name: keyof typeof MEMORY_CONFIGURATIONS) {
	const memory = MEMORY_CONFIGURATIONS[name]
	const result = assembleMips(SOURCE, undefined, { memory })
	expect(firstError(result.diagnostics)?.message).toBeUndefined()
	return { memory, ...result, simulator: new MipsSimulator(result.machineCode, result.program, memory, { historySchema: mipsHistorySchema }) }
}

/** Every address a program is laid out at, for one configuration. */
function layoutOf(name: keyof typeof MEMORY_CONFIGURATIONS) {
	const { program, simulator } = build(name)
	const text = program.instructions.filter((instruction) => (instruction.segment ?? 'text') === 'text')
	const ktext = program.instructions.filter((instruction) => instruction.segment === 'ktext')
	return {
		text: text[0].address,
		ktext: ktext[0].address,
		data: program.data[0].address,
		extern: program.symbols.globals.get('shared'),
		gp: simulator.registers.$gp,
		sp: simulator.registers.$sp,
		pc: simulator.pc,
		heap: simulator.heapPointer,
	}
}

describe('the memory configuration reaches every segment base', () => {
	it('lays the default configuration out where SPIM does', () => {
		expect(layoutOf('default')).toEqual({
			text: 0x00400000,
			ktext: 0x80000000,
			data: 0x10010000,
			extern: 0x10000000,
			gp: 0x10008000,
			sp: 0x7fffeffc,
			pc: 0x00400000,
			heap: 0x10040000,
		})
	})

	it('moves every one of them under the compact configurations', () => {
		expect(layoutOf('dataBasedCompact')).toEqual({
			text: 0x00003000,
			ktext: 0x00004000,
			data: 0x00000000,
			extern: 0x00001000,
			gp: 0x00001800,
			sp: 0x00002ffc,
			pc: 0x00003000,
			heap: 0x00002000,
		})

		expect(layoutOf('textBasedCompact')).toEqual({
			text: 0x00000000,
			ktext: 0x00004000,
			data: 0x00002000,
			extern: 0x00001000,
			gp: 0x00001800,
			sp: 0x00003ffc,
			pc: 0x00000000,
			heap: 0x00003000,
		})
	})

	it('resolves a data label to the configured data segment', () => {
		for (const name of ['default', 'dataBasedCompact', 'textBasedCompact'] as const) {
			const { memory, program } = build(name)
			// `here: .word msg` holds the address `msg` was laid out at.
			const pointer = program.data.find((entry) => entry.directive === '.word')!
			expect(pointer.bytes[0]).toMatchObject({ value: { value: memory.dataBaseAddress } })
		}
	})
})

describe('the memory-mapped devices move with the configuration', () => {
	it('puts the transmitter where the configuration says', () => {
		for (const name of ['default', 'dataBasedCompact'] as const) {
			const { memory, simulator } = build(name)
			simulator.writeMemoryRaw(memory.memoryMapBaseAddress + 12, 'A'.charCodeAt(0), 1)
			expect(simulator.keyboardDisplay.displayOutput).toBe('A')

			// And the default base is no longer a device under a compact layout.
			if (name !== 'default') {
				simulator.writeMemoryRaw(0xffff000c, 'B'.charCodeAt(0), 1)
				expect(simulator.keyboardDisplay.displayOutput).toBe('A')
			}
		}
	})
})

describe('the memory view follows the configuration', () => {
	const startsOf = (layout: MemoryConfigurationValues) =>
		Object.fromEntries(sectionsFor(layout).map((section) => [section.id, section.start]))

	it('names the same six sections at the configured addresses', () => {
		expect(startsOf(MEMORY_CONFIGURATIONS.default)).toMatchObject({
			text: 0x00400000, data: 0x10010000, heap: 0x10040000, kdata: 0x80000000, mmio: 0xffff0000,
		})
		expect(startsOf(MEMORY_CONFIGURATIONS.textBasedCompact)).toMatchObject({
			text: 0x00000000, data: 0x00002000, heap: 0x00003000, kdata: 0x00004000, mmio: 0x00007f00,
		})
	})

	it('leaves no gap or overlap between the sections', () => {
		for (const layout of Object.values(MEMORY_CONFIGURATIONS)) {
			const sections = sectionsFor(layout)
			for (const section of sections) expect(section.end).toBeGreaterThan(section.start)
			// The heap and stack split one region, so those two must still meet.
			const [, , heap, stack] = sections
			expect(heap.end + 4).toBe(stack.start)
		}
	})
})
