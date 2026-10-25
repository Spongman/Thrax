import { describe, expect, it } from 'vitest'
import { assembleRiscv } from '../assembler'
import { EXAMPLES } from '../examples'
import { decode, MEMORY_BYTES, TEXT_BASE } from '../isa'
import { riscvDisassembly } from '../program'
import { RiscvRuntime } from '../runtime'

function assemble(code: string) {
	return assembleRiscv({ files: [{ name: 'main.s', code }], entries: ['main.s'] })
}
function runtime(code: string) {
	const program = assemble(code)
	expect(program.diagnostics).toEqual([])
	return new RiscvRuntime(program, { historyLimit: 10000, speed: null })
}
function finish(machine: RiscvRuntime) {
	let count = 0
	while (!machine.halted && !machine.pendingInput && count++ < 200_000) machine.step()
	expect(count).toBeLessThan(200_000)
}
function encodings(code: string) {
	const program = assemble(code)
	expect(program.diagnostics).toEqual([])
	const bytes = program.image().sections.find((s) => s.address === TEXT_BASE)!.bytes
	return Array.from({ length: bytes.length / 4 }, (_, i) =>
		new DataView(bytes.buffer, bytes.byteOffset).getUint32(i * 4, true)
	)
}
describe('RV32IM assembly', () => {
	it('rejects misaligned debugger PC edits without changing state or history', () => {
		const machine = runtime('nop\nebreak')
		try {
			const pc = machine.pc
			for (const address of [pc + 1, pc + 2, MEMORY_BYTES]) expect(machine.writeRegister('PC', address)).toBe(false)
			expect(machine.pc).toBe(pc)
			expect(machine.history.length).toBe(0)
		} finally { machine.dispose() }
	})

	it('matches independent instruction encodings', () => {
		expect(
			encodings(
				'addi x1, x0, -1\nadd x3,x1,x2\nsub x3,x1,x2\nsw x3,-4(x2)\nlw x4,-4(x2)\nmul x3,x1,x2\nret\necall\nebreak'
			)
		).toEqual([
			0xfff00093, 0x002081b3, 0x402081b3, 0xfe312e23, 0xffc12203, 0x022081b3, 0x00008067,
			0x00000073, 0x00100073
		])
	})
	it('encodes forward and negative branch/jump offsets independently', () => {
		expect(encodings('start: beq x1,x2,end\njal x1,start\nend: bne x1,x2,start')).toEqual([
			0x00208463, 0xffdff0ef, 0xfe209ce3
		])
	})
	it('materializes signed low halves for li and label addresses', () => {
		const m = runtime('li t0,0x12345fff\nli t1,0xffffffff\nli t2,0x80000000\nebreak')
		finish(m)
		expect(m.registers[5]).toBe(0x12345fff)
		expect(m.registers[6]).toBe(-1)
		expect(m.registers[7]).toBe(-2147483648)
	})
	it('uses independent text/data counters and preserves actual data bytes', () => {
		const p = assemble('.data\nx: .word 0x12345678\nmsg: .asciz "a#b"\n.text\n_start: ebreak')
		expect(p.diagnostics).toEqual([])
		expect(p.labels.get('x')).toBe(0x10000)
		expect(Array.from(p.data[0].bytes)).toEqual([0x78, 0x56, 0x34, 0x12])
		expect(Array.from(p.data[1].bytes)).toEqual([97, 35, 98, 0])
		expect(
			riscvDisassembly.row({ address: 0x1000, bytes: [0xff, 0xf0, 0, 0x93], instruction: true })
		).toBe('addi x1, x0, -1')
	})
	it.each([
		'addi x1,x0,2048',
		'slli x1,x0,32',
		'.option rvc',
		'fadd.s x1,x2,x3',
		'.word 0x100000000',
		'.org 1048576\nebreak'
	])('diagnoses invalid source %s', (code) => {
		expect(assemble(code).diagnostics.some((d) => d.severity === 'error')).toBe(true)
	})
	it('supports relative includes and detects cycles', () => {
		const p = assembleRiscv({
			files: [
				{ name: 'src/main.s', code: '.include "constants.s"\naddi a0,zero,N\nebreak' },
				{ name: 'src/constants.s', code: '.equ N, 42' }
			],
			entries: ['src/main.s']
		})
		expect(p.diagnostics).toEqual([])
		expect(
			assembleRiscv({ files: [{ name: 'a', code: '.include "a"' }], entries: ['a'] }).diagnostics[0]
				.message
		).toContain('Recursive')
	})
})
describe('RV32IM runtime', () => {
	it.each(Object.keys(EXAMPLES))('runs the %s example', (key) => {
		const m = runtime(EXAMPLES[key].code)
		finish(m)
		if (key === 'input') {
			expect(m.pendingInput?.type).toBe('integer')
			expect(m.provideInput('-17')).toBe(true)
			finish(m)
		}
		const expected: Record<string, string> = {
			hello: 'Hello, THRAX!\n',
			factorial: '120',
			sum: '8',
			fibonacci: '55',
			loop: '1\n2\n3\n4\n5\n',
			bitwise: '8\n14\n6\n',
			input: '-17',
			memory: '-128',
			bitmap: '',
			mandelbrot: '',
			ackermann: '61'
		}
		expect(m.console).toBe(expected[key])
		expect(m.halted).toBe(true)
		if (key === 'sum') expect(m.registers[10]).toBe(8)
		if (key === 'fibonacci') expect(m.registers[10]).toBe(55)
		if (key === 'loop') expect(m.registers[5]).toBe(6)
	})
	it('hardwires x0 and uses 32-bit signed/unsigned arithmetic', () => {
		const m = runtime(
			'li x0,123\nli t0,-1\nsltiu t1,t0,-1\nslti t2,t0,0\nsrli t3,t0,31\nsrai t4,t0,31\nebreak'
		)
		finish(m)
		expect(Array.from(m.registers).filter((_, i) => [0, 6, 7, 28, 29].includes(i))).toEqual([
			0, 0, 1, 1, -1
		])
		expect(m.registerValues().x5).toBe(-1)
	})
	it('implements M overflow, divide zero, signed high and unsigned high exactly', () => {
		const m = runtime(
			'li t0,0x80000000\nli t1,-1\ndiv a0,t0,t1\nrem a1,t0,t1\ndiv a2,t0,zero\nrem a3,t0,zero\ndivu a4,t1,zero\nremu a5,t1,zero\nmulh a6,t0,t1\nmulhu s2,t1,t1\nmulhsu s3,t0,t1\nebreak'
		)
		finish(m)
		expect(Array.from(m.registers.slice(10, 17))).toEqual([
			-2147483648, 0, -1, -2147483648, -1, -1, 0
		])
		expect(m.registers[18]).toBe(-2)
		expect(m.registers[19]).toBe(-2147483648)
	})
	it('rejects misaligned stores transactionally and enforces RAM limits', () => {
		const m = runtime('li t0,0x10000\nli t1,42\nsw t1,1(t0)')
		for (let i = 0; i < 4; i++) m.step()
		const pc = m.pc,
			count = m.instructionCount,
			length = m.history.length
		expect(() => m.step()).toThrow('Misaligned')
		expect([m.pc, m.instructionCount, m.history.length, m.memory[0x10001]]).toEqual([
			pc,
			count,
			length,
			0
		])
		expect(() => m.setProgramCounter(MEMORY_BYTES)).toThrow('outside RAM')
	})
	it('faults on taken misaligned branches, permits untaken ones', () => {
		const m = runtime('addi t0,zero,1\nbeq t0,zero,0x1006\nbeq zero,zero,0x100a')
		m.step()
		m.step()
		expect(() => m.step()).toThrow('Misaligned')
		expect(m.pc).toBe(0x1008)
	})
	it('rewinds registers, memory, output, stop and call frames', () => {
		const m = runtime(EXAMPLES.factorial.code)
		finish(m)
		const end = m.instructionCount
		expect(m.callStack).toEqual([])
		expect(m.historyFormat.effects(m.history.at(0)!, true)).toEqual([])
		while (m.stepBack()) {
			/* rewind the entire machine */
		}
		expect(m.pc).toBe(TEXT_BASE)
		expect(m.instructionCount).toBe(0)
		expect(m.console).toBe('')
		expect(m.halted).toBe(false)
		expect(m.callStack).toEqual([])
		finish(m)
		expect(m.instructionCount).toBe(end)
		expect(m.console).toBe('120')
	})
	it('reports input instruction once and rewinds to pending input', () => {
		const m = runtime('addi a7,zero,5\necall\nebreak'),
			words: string[] = []
		m.observers.push({
			onInstruction: (_a, d) => words.push(decode((d as { word: number }).word).name)
		})
		m.step()
		m.step()
		expect(m.pendingInput?.type).toBe('integer')
		expect(m.provideInput('oops')).toBe(false)
		expect(m.provideInput('-42')).toBe(true)
		expect(words).toEqual(['addi', 'ecall'])
		expect(m.registers[10]).toBe(-42)
		expect(m.stepBack()).toBe(true)
		expect(m.pendingInput?.type).toBe('integer')
		expect(m.registers[10]).toBe(0)
	})
	it('records edits and memory shifts spanning effect blocks', () => {
		const m = runtime('ebreak')
		m.writeByte(0x10000, 42)
		m.insertByte(0x10000, 0x12000, 7)
		expect(m.memory[0x10001]).toBe(42)
		expect(m.stepBack()).toBe(true)
		expect(m.memory[0x10000]).toBe(42)
		expect(m.memory[0x10001]).toBe(0)
		expect(m.insertByte(NaN, 3, 1)).toBe(false)
		expect(m.historyFormat.effects(m.history.at(0)!, true)[0].address).toBe(0x10000)
	})
	it('describes register and output changes from the typed log', () => {
		const m = runtime('addi a0,zero,42\naddi a7,zero,1\necall\nebreak')
		finish(m)
		expect(m.historyFormat.effects(m.history.at(0)!, true)).toEqual([
			expect.objectContaining({ register: 'x10', value: 0 })
		])
		expect(m.historyFormat.effects(m.history.at(2)!, true)).toEqual([
			expect.objectContaining({ subject: 'console', detail: '"42"' })
		])
	})
	it('bounds data gutter rows for large reservations', () => {
		const p = assemble('.data\n.space 900000\n.text\nebreak')
		expect(p.diagnostics).toEqual([])
		expect(p.sourceIndex.rowsForLine('main.s', 2)).toHaveLength(4)
		expect(p.sourceIndex.rowsForLine('main.s', 2)[3].truncated).toBe(true)
	})
	it('stops a running loop on disposal without later progress', async () => {
		const m = runtime('loop: j loop')
		const running = m.run()
		m.dispose()
		await running
		const count = m.instructionCount
		m.step()
		expect(m.instructionCount).toBe(count)
	})
})
