import { describe, expect, it } from 'vitest'
import { InstructionCategory } from '../../../contracts'
import { assembleA64 } from '../assembler'
import { A64InstructionInfo, classifyA64, INSN_BRANCH, INSN_LOAD, INSN_STORE, INSN_TAKEN } from '../classify'
import { decode } from '../decode'
import { a64InstructionSet } from '../instructions'
import { TEXT_BASE } from '../layout'
import { A64Machine } from '../machine'

const word = (line: string) => {
	const bytes = assembleA64({ name: 'x.s', code: `\t${line}\n` }).image!.sections[0].bytes
	return new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)
}

describe('A64 instruction metadata', () => {
	it.each([
		['add x0, x1, x2', 'add', InstructionCategory.ALU, [1, 2], [0]],
		['add sp, sp, #16', 'add', InstructionCategory.ALU, [31], [31]],
		['mov x0, x1', 'mov', InstructionCategory.ALU, [1], [0]],
		['cmp x3, #1', 'cmp', InstructionCategory.ALU, [3], [32]],
		['ldr x0, [x1, x2]', 'ldr', InstructionCategory.MEMORY, [1, 2], [0]],
		['stp x29, x30, [sp, #-16]!', 'stp', InstructionCategory.MEMORY, [31, 29, 30], [31]],
		['bl .', 'bl', InstructionCategory.JUMP, [], [30]],
		['ret', 'ret', InstructionCategory.JUMP, [30], []],
		['cbz x5, .', 'cbz', InstructionCategory.BRANCH, [5], []],
		['svc #0', 'svc', InstructionCategory.TRAP, [8, 0, 1, 2], [0]],
	] as const)('%s', (line, mnemonic, category, reads, writes) => {
		const info = a64InstructionSet.describe(word(line))
		expect(info).toMatchObject({ mnemonic, category, writes })
		expect(info.reads).toEqual(reads)
	})

	it('decodes what a history entry ran', () => {
		expect(a64InstructionSet.decodeExecuted({ id: 0, instructionCount: 0, address: TEXT_BASE, kind: 'instruction', word: 5 } as never)).toBe(5)
		expect(a64InstructionSet.decodeExecuted({ id: 0, instructionCount: 0, address: TEXT_BASE, kind: 'edit', word: 5 } as never)).toBeNull()
	})
})

describe('classifyA64', () => {
	it('works out addresses and outcomes from the state before the step', () => {
		const result = assembleA64({ name: 'x.s', code: '\tmov x1, #0x420000\n\tmov x2, #3\n\tcmp x2, #3\n\tb.eq .\n\tldr x0, [x1, x2, lsl #3]\n\tstp x0, x1, [x1], #16\n' })
		const machine = new A64Machine({ memoryBytes: 1 << 20 })
		machine.load(result.image!)
		machine.run(3)
		const out = new A64InstructionInfo()
		const at = (offset: number) => decode(new DataView(machine.cpu.memory.buffer).getUint32(offset, true))
		expect(classifyA64(at(12), machine.cpu, out)).toMatchObject({ flags: INSN_BRANCH | INSN_TAKEN, target: TEXT_BASE + 12 })
		machine.cpu.pc += 4
		expect(classifyA64(at(16), machine.cpu, out)).toMatchObject({ flags: INSN_LOAD, memoryAddress: 0x420018, memorySize: 8 })
		machine.cpu.pc += 4
		expect(classifyA64(at(20), machine.cpu, out)).toMatchObject({ flags: INSN_STORE, memoryAddress: 0x420000, memorySize: 16 })
	})
})
