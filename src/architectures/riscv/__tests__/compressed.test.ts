import { describe, expect, it } from 'vitest'
import { codeRowOf } from '../../../core/sourceIndex'
import { assembleRiscv } from '../assembler'
import { encodeCompressed, expandCompressed } from '../compressed'
import { COMPRESSED_EXAMPLES } from '../examples'
import definition from '../index'
import { decode, disassemble, MEMORY_BYTES, register } from '../isa'
import { createRiscvDisassembly } from '../program'
import { RiscvRuntime, instructionSet } from '../runtime'

const assemble = (code: string, compressed = true) =>
	assembleRiscv({ files: [{ name: 'main.s', code }], entries: ['main.s'] }, compressed)
const machine = (code: string) => {
	const program = assemble(code)
	expect(program.diagnostics).toEqual([])
	return new RiscvRuntime(program, { speed: null, historyLimit: 10000 })
}
const finish = (runtime: RiscvRuntime) => {
	for (let count = 0; count < 10000 && !runtime.halted && !runtime.pendingInput; count++) runtime.step()
	expect(runtime.halted).toBe(true)
}

describe('RV32C encodings', () => {
	// Independently specified bit fields; jump/stack vectors also match LLVM MC's RV32C fixtures.
	it.each([
		['c.nop', [], 0x0001],
		['c.ebreak', [], 0x9002],
		['c.addi', ['a1', '-1'], 0x15fd],
		['c.addi16sp', ['sp', '-352'], 0x710d],
		['c.jal', ['2046'], 0x2ffd],
		['c.beqz', ['a2', '-256'], 0xd201],
		['c.addi4spn', ['a0', 'sp', '16'], 0x0808],
		['c.lw', ['a0', '124(a1)'], 0x5de8],
		['c.sw', ['a0', '124(a1)'], 0xdde8],
		['c.li', ['a0', '21'], 0x4555],
		['c.lui', ['a0', '-1'], 0x757d],
		['c.lwsp', ['a0', '0(sp)'], 0x4502],
		['c.swsp', ['a0', '0(sp)'], 0xc02a],
		['c.jr', ['ra'], 0x8082],
		['c.jalr', ['ra'], 0x9082],
		['c.mv', ['a0', 'a1'], 0x852e],
		['c.add', ['a0', 'a1'], 0x952e],
		['c.srai', ['a0', '31'], 0x857d],
		['c.andi', ['a0', '-32'], 0x9901],
		['c.sub', ['a0', 'a1'], 0x8d0d]
	] as [string, string[], number][])('encodes %s %j', (name, args, expected) => {
		expect(encodeCompressed(name, args, 0, register, Number)).toBe(expected)
	})

	it('expands independent binary instructions into the shared integer operations', () => {
		expect(decode(0x15fd, true)).toMatchObject({ name: 'addi', rd: 11, rs1: 11, imm: -1, size: 2 })
		expect(decode(0x710d, true)).toMatchObject({ name: 'addi', rd: 2, rs1: 2, imm: -352 })
		expect(decode(0x2ffd, true)).toMatchObject({ name: 'jal', rd: 1, imm: 2046 })
		expect(decode(0xd201, true)).toMatchObject({ name: 'beq', rs1: 12, rs2: 0, imm: -256 })
		expect(decode(0x5de8, true)).toMatchObject({ name: 'lw', rd: 10, rs1: 11, imm: 124 })
		expect(decode(0xdde8, true)).toMatchObject({ name: 'sw', rs2: 10, rs1: 11, imm: 124 })
		expect(decode(0xc02a, true)).toMatchObject({ name: 'sw', rs1: 2, rs2: 10, imm: 0 })
		expect(decode(0x757d, true)).toMatchObject({ name: 'lui', rd: 10, imm: -4096 })
	})

	it.each([0x0000, 0x4002, 0x6001, 0x6101, 0x8002, 0x1002, 0x9001, 0x9c01, 0x2000, 0x6000])(
		'rejects reserved, RV64 or floating encoding 0x%s',
		(word) => {
			expect(expandCompressed(word)).toBeNull()
			expect(decode(word, true).name).toBe('')
		}
	)

	it.each([
		'c.addi4spn a0,sp,0',
		'c.addi16sp sp,0',
		'c.lui sp,1',
		'c.lui a0,0',
		'c.lwsp zero,0(sp)',
		'c.slli a0,32',
		'c.srli a0,32',
		'c.lw a0,2(a1)',
		'c.sw a0,128(a1)',
		'c.jr zero',
		'c.j 0x1001',
		'c.beqz t0,0x1000'
	])('diagnoses invalid compressed source %s', (code) => {
		expect(assemble(code).diagnostics.some((d) => d.severity === 'error')).toBe(true)
	})

	it('keeps RV32IM strict and handles local .option choices without changing the machine ISA', () => {
		expect(assemble('c.nop', false).diagnostics[0].message).toContain('RV32IMC')
		expect(assemble('.option rvc\nnop', false).diagnostics).not.toEqual([])
		expect(assemble('.option norvc\nc.nop').diagnostics).not.toEqual([])
		expect(assemble('.option norvc\nnop\n.option rvc\nc.nop').diagnostics).toEqual([])
		expect(definition.settings.defaults).toEqual({ isa: 'rv32im', float: 'none' })
	})
})

describe('mixed RV32IMC execution and debugging', () => {
	it('runs mixed-size code at halfword boundaries and maps each source instruction', () => {
		const runtime = machine('c.li a0,5\naddi a0,a0,7\nc.addi a0,-1\nc.ebreak')
		runtime.step()
		expect(runtime.pc).toBe(0x1002)
		runtime.step()
		expect(runtime.pc).toBe(0x1006)
		runtime.step()
		expect(runtime.registers[10]).toBe(11)
		expect(runtime.program.sourceIndex.addressesForLine('main.s', 2)).toEqual([0x1002])
		expect(runtime.program.sourceIndex.rowsForLine('main.s', 1)[0].length).toBe(2)
		const memory = runtime.inspectMemory(),
			disassembly = createRiscvDisassembly(true)
		for (const line of [1, 2, 3, 4]) {
			const row = codeRowOf(runtime.program.sourceIndex.rowsForLine('main.s', line)[0], memory)
			expect(disassembly.row(row)).toBe(disassembly.at(memory, row.address))
		}
		expect(disassembly.at(memory, 0x1002)).toBe('addi x10, x10, 7')
		expect(disassemble(0x4555, 0x1000, true)).toBe('c.li x10, 21')
	})

	it('uses PC+2 links for compressed calls and rewinds memory, stack, output and frames', () => {
		const runtime = machine(COMPRESSED_EXAMPLES.compressed.code)
		finish(runtime)
		expect(runtime.console).toBe('42')
		expect(runtime.registers[1]).toBe(0x1008)
		expect(runtime.callStack).toEqual([])
		expect(runtime.registers[2]).toBe(MEMORY_BYTES - 16)
		const words = runtime.history.slice(0, runtime.history.length)
		expect(words.map((entry) => runtime.historyFormat.instruction(entry))).toContain('c.jal 0x1018')
		while (runtime.stepBack()) {
			/* undo every mixed-size instruction */
		}
		expect(runtime.pc).toBe(0x1000)
		expect(runtime.console).toBe('')
		expect(runtime.memory[MEMORY_BYTES - 32]).toBe(0)
		expect(runtime.callStack).toEqual([])
	})

	it('steps over a compressed call and stops at compressed instruction breakpoints', async () => {
		const runtime = machine('c.jal function\nc.li a0,3\nc.ebreak\nfunction: c.li a0,7\nc.jr ra')
		await runtime.stepOver()
		expect(runtime.pc).toBe(0x1002)
		expect(runtime.registers[1]).toBe(0x1002)
		expect(runtime.registers[10]).toBe(7)
		expect(runtime.callStack).toEqual([])
		runtime.addBreakpoint(0x1004)
		await runtime.continue()
		expect(runtime.pc).toBe(0x1004)
		expect(runtime.halted).toBe(false)
	})

	it('links indirect compressed calls at PC+2 and executes all compact ALU forms', () => {
		const runtime = machine(`la t0,function
c.jalr t0
c.ebreak
function: c.li a0,12
c.li a1,10
c.sub a0,a1
c.xor a0,a1
c.or a0,a1
c.and a0,a1
c.andi a0,7
c.slli a0,2
c.srli a0,1
c.srai a0,1
c.mv a1,a0
c.add a0,a1
c.lui a2,-1
c.jr ra`)
		finish(runtime)
		expect(runtime.registers[1]).toBe(0x100a)
		expect(runtime.registers[10]).toBe(4)
		expect(runtime.registers[12]).toBe(-4096)
		expect(runtime.callStack).toEqual([])
	})

	it('allows hints, rejects illegal compressed words without state changes, and checks fetch boundaries', () => {
		const runtime = machine('c.li zero,31\nc.addi a0,0\nc.slli a0,0\nc.ebreak')
		finish(runtime)
		expect(runtime.registers[0]).toBe(0)
		runtime.setProgramCounter(MEMORY_BYTES - 2)
		runtime.writeByte(MEMORY_BYTES - 2, 2)
		runtime.writeByte(MEMORY_BYTES - 1, 0x90)
		runtime.step()
		expect(runtime.halted).toBe(true)
		runtime.setProgramCounter(0x2000)
		const count = runtime.instructionCount,
			length = runtime.history.length
		expect(() => runtime.step()).toThrow('Illegal RV32IMC')
		expect([runtime.pc, runtime.instructionCount, runtime.history.length]).toEqual([0x2000, count, length])
		runtime.setProgramCounter(MEMORY_BYTES - 2)
		runtime.writeByte(MEMORY_BYTES - 2, 0x13)
		expect(() => runtime.step()).toThrow('outside RAM')
	})

	it('classifies and replays compressed instructions through the shared observer seam', () => {
		const runtime = machine('c.li a0,2\nc.addi a0,-1\nc.bnez a0,0x1002\nc.ebreak')
		const branches: boolean[] = [],
			mnemonics: string[] = []
		runtime.observers.push({
			onBranch: (_address, taken) => branches.push(taken),
			onInstruction: (_address, instruction) => mnemonics.push(instructionSet.describe(instruction).mnemonic)
		})
		finish(runtime)
		expect(branches).toEqual([true, false])
		expect(mnemonics).toEqual(['c.li', 'c.addi', 'c.bnez', 'c.addi', 'c.bnez', 'c.ebreak'])
		expect(instructionSet.describe(instructionSet.decodeExecuted(runtime.history.at(0)!))).toMatchObject({
			mnemonic: 'c.li',
			writes: [10]
		})
	})
})
