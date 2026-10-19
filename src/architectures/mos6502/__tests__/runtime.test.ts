import { describe, expect, it } from 'vitest'
import { InstructionCategory } from '../../contracts'
import definition from '../index'
import { REG_A, REG_X } from '../instructions'
import type { Mos6502Runtime } from '../runtime'
import { DEFAULT_MOS6502_SETTINGS } from '../settings'

function machineFor(code: string, decimalMode = true): Mos6502Runtime {
	const services = definition.createServices()
	const program = services.assemble({ files: [{ name: 'main.s', code }], entries: ['main.s'] }, DEFAULT_MOS6502_SETTINGS)
	expect(program.diagnostics).toEqual([])
	return services.createMachine(program, { decimalMode }, { speed: null, historyLimit: 1000 }) as Mos6502Runtime
}

describe('6502 runtime', () => {
	it('tells observers each instruction, its data accesses and branches', async () => {
		const machine = machineFor('ldx #2\nloop: lda $10,x\nsta $F000\ndex\nbne loop\ninc $20\nbrk')
		const seen = { instructions: [] as number[], reads: [] as number[], writes: [] as [number, number][], branches: [] as boolean[] }
		machine.observers.push({
			onInstruction: (address) => seen.instructions.push(address),
			onMemoryRead: (address) => seen.reads.push(address),
			onMemoryWrite: (address, _size, value) => seen.writes.push([address, value]),
			onBranch: (_address, taken) => seen.branches.push(taken),
		})
		await machine.run()
		expect(machine.halted).toBe(true)
		expect(seen.instructions.length).toBe(machine.instructionCount)
		expect(seen.reads).toEqual([0x12, 0x11, 0x20])
		expect(seen.writes).toEqual([[0xF000, 0], [0xF000, 0], [0x20, 1]])
		expect(seen.branches).toEqual([true, false])
	})

	it('describes opcodes to the tools', () => {
		const { instructions } = machineFor('nop').toolConfig()
		const lda = instructions!.describe(0xBD)
		expect(lda).toMatchObject({ mnemonic: 'LDA', category: InstructionCategory.MEMORY, encoding: 7, writes: REG_A, isLoad: true })
		expect(lda.reads).toEqual([REG_X])
		expect(instructions!.encodings[lda.encoding]).toBe('absolute,X')
		expect(instructions!.describe(0xD0)).toMatchObject({ mnemonic: 'BNE', category: InstructionCategory.BRANCH, isBranch: true })
		expect(instructions!.describe(0x02).mnemonic).toBe('ILLEGAL')
	})

	it('edits registers and flags, refusing B', () => {
		const machine = machineFor('nop')
		expect(machine.writeRegister('A', 0x1FF)).toBe(true)
		expect(machine.writeRegister('D', 1)).toBe(true)
		expect(machine.writeRegister('B', 1)).toBe(false)
		expect(machine.writeRegister('PC', 0x1234)).toBe(true)
		const values = machine.registerValues()
		expect([values.A, values.D, values.B, values.PC, values.P]).toEqual([0xFF, 1, 0, 0x1234, 0x2C])
	})

	it('takes decimal mode from the settings', async () => {
		const code = 'sed\nclc\nlda #$19\nadc #$01\nbrk'
		const bcd = machineFor(code, true)
		await bcd.run()
		expect(bcd.registerValues().A).toBe(0x20)
		const binary = machineFor(code, false)
		await binary.run()
		expect(binary.registerValues().A).toBe(0x1A)
	})

	it('reads memory as bytes, a word a byte wide', () => {
		const memory = machineFor('lda #1').inspectMemory()
		expect([memory.wordBytes, memory.byte(0x0600), memory.word(0x0601), memory.byte(0x10000)]).toEqual([1, 0xA9, 0x01, undefined])
	})
})
