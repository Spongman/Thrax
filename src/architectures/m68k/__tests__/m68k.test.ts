import { describe, expect, it } from 'vitest'
import { assembleM68k } from '../assembler'
import { decodeInstruction, disassemble } from '../decode'
import { EXAMPLES, EXAMPLES_68010, EXAMPLES_68020 } from '../examples'
import { C, MEMORY_BYTES, N, V, X, Z } from '../isa'
import { M68kRuntime } from '../runtime'
import type { CpuModel } from '../settings'

function assemble(code: string, model: CpuModel = '68000') {
	return assembleM68k({ files: [{ name: 'main.s', code }], entries: ['main.s'] }, model)
}
function runtime(code: string, model: CpuModel = '68000') {
	const program = assemble(code, model)
	expect(program.diagnostics).toEqual([])
	return new M68kRuntime(program, { historyLimit: 10000, speed: null })
}
function finish(machine: M68kRuntime, limit = 20_000) {
	let steps = 0
	while (!machine.halted && !machine.pendingInput && steps++ < limit) machine.step()
	expect(steps).toBeLessThan(limit)
}
function words(code: string, model: CpuModel = '68000') {
	const p = assemble(code, model)
	expect(p.diagnostics).toEqual([])
	const bytes = p.image().sections[0].bytes,
		view = new DataView(bytes.buffer, bytes.byteOffset)
	return Array.from({ length: bytes.length / 2 }, (_, i) => view.getUint16(i * 2, false))
}

describe('Motorola 68k encodings', () => {
	it('matches independent move/effective-address words', () => {
		expect(
			words('move.l #$12345678,d0\nmove.b d0,(a0)+\nmove.w (a0)+,d1\nmovea.w #$ffff,a0\nlea $10000,a0\njsr (a0)')
		).toEqual([0x203c, 0x1234, 0x5678, 0x10c0, 0x3218, 0x307c, 0xffff, 0x41f9, 1, 0, 0x4e90])
	})
	it('matches independent arithmetic/multiply/shift words', () => {
		expect(
			words(
				'addi.b #1,d0\nadd.w d1,d0\nsub.l d1,d0\ncmpi.l #1,d0\nlsl.l #1,d0\nasr.w #1,d0\nmulu.w d1,d0\ndivs.w d1,d0'
			)
		).toEqual([0x0600, 1, 0xd041, 0x9081, 0x0c80, 0, 1, 0xe388, 0xe240, 0xc0c1, 0x81c1])
	})
	it('encodes MOVEM reversed predecrement masks and normal postincrement masks', () => {
		expect(words('movem.l d0-d2/a0,-(sp)\nmovem.l (sp)+,d0-d2/a0\nlink a6,#-8\nunlk a6\nrts')).toEqual([
			0x48e7, 0xe080, 0x4cdf, 0x0107, 0x4e56, 0xfff8, 0x4e5e, 0x4e75
		])
	})
	it('encodes static and dynamic bit numbers', () => {
		expect(words('btst #3,d0\nbset d1,(a0)')).toEqual([0x0800, 3, 0x03d0])
	})
	it('encodes PC-relative offsets at the extension word address', () => {
		expect(words('lea target(pc),a0\nbeq target\nnop\ntarget:nop')).toEqual([0x41fa, 8, 0x6700, 4, 0x4e71, 0x4e71])
	})
	it('gates later-model encodings and long branch sizing', () => {
		expect(words('rtd #8\nbkpt #3', '68010')).toEqual([0x4e74, 8, 0x484b])
		expect(words('extb.l d2\nbra.l target\nnop\ntarget:nop', '68020')).toEqual([0x49c2, 0x60ff, 0, 6, 0x4e71, 0x4e71])
		expect(words('move.l 4(a0,d1.l*4),d0', '68020')).toEqual([0x2030, 0x1c04])
		for (const [code, model] of [
			['rtd #0', '68000'],
			['bkpt #1', '68000'],
			['extb.l d0', '68010'],
			['bra.l $1000', '68010'],
			['move.l 0(a0,d0.l*2),d1', '68000']
		] as [string, CpuModel][])
			expect(assemble(code, model).diagnostics.some((d) => d.severity === 'error')).toBe(true)
	})
	it.each([
		'move.b a0,d0',
		'moveq #128,d0',
		'addq #9,d0',
		'move.w #65536,d0',
		'bra.s $1002',
		'move.l 128(a0,d0),d1',
		'fmove.x fp0,fp1',
		'.space 1048576\n.space 1048576'
	])('rejects invalid or unavailable source %s', (code) => {
		expect(assemble(code).diagnostics.some((d) => d.severity === 'error')).toBe(true)
	})
})
describe('Motorola 68k integer execution', () => {
	it('offers the common example names as data without architecture icon components', () => {
		const names = {
			hello: 'Hello, THRAX!',
			sum: 'Sum of Numbers',
			factorial: 'Factorial',
			fibonacci: 'Fibonacci',
			loop: 'Loop Counter',
			bitwise: 'Bitwise Operations',
			input: 'Interactive Input',
			bitmap: 'Bitmap Display'
		}
		for (const examples of [EXAMPLES, EXAMPLES_68010, EXAMPLES_68020]) {
			for (const [key, name] of Object.entries(names)) expect(examples[key].name).toBe(name)
			for (const example of Object.values(examples)) expect('icon' in example).toBe(false)
		}
	})
	it.each([
		...Object.keys(EXAMPLES).map((key) => ['68000', key] as const),
		...Object.keys(EXAMPLES_68010).map((key) => ['68010', key] as const),
		...Object.keys(EXAMPLES_68020).map((key) => ['68020', key] as const)
	])('runs MC%s example %s with the expected registers, memory and output', (model, key) => {
		const examples = model === '68020' ? EXAMPLES_68020 : model === '68010' ? EXAMPLES_68010 : EXAMPLES
		const m = runtime(examples[key].code, model)
		finish(m, key === 'mandelbrot' ? 500_000 : 20_000)
		if (key === 'input') {
			expect(m.pendingInput?.type).toBe('integer')
			expect(m.provideInput('-42')).toBe(true)
			finish(m)
		}
		const outputs: Record<string, string> = {
			hello: 'Hello, THRAX!\n',
			factorial: '120',
			stack: '42',
			sum: '8',
			fibonacci: '55',
			loop: '1\n2\n3\n4\n5\n',
			bitwise: '8\n14\n6\n',
			input: '-42',
			bitmap: '',
			mandelbrot: '',
			ackermann: '61',
			returnArguments: '42',
			scaledTable: '30'
		}
		expect(m.console).toBe(outputs[key])
		expect(m.halted).toBe(true)
		expect(m.pendingInput).toBe(null)
		expect(m.callStack).toEqual([])
		expect(m.cpu.registers[0]).toBe(9)
		expect(m.cpu.registers[15]).toBe(MEMORY_BYTES - 16)
		const word = (address: number) => m.cpu.view.getInt32(address, false)
		if (key === 'hello') {
			expect(m.cpu.registers[9]).toBe(m.program.labels.get('message'))
			expect(Array.from(m.cpu.memory.subarray(0x10000, 0x1000f))).toEqual([
				...new TextEncoder().encode('Hello, THRAX!\n'),
				0
			])
		} else if (key === 'factorial') {
			expect(m.cpu.registers[1]).toBe(120)
			expect(m.cpu.registers[2] & 65535).toBe(65535)
			expect(word(MEMORY_BYTES - 20)).toBe(0x1006)
		} else if (key === 'sum') {
			expect(m.cpu.registers[1]).toBe(8)
			expect(word(0x10000)).toBe(8)
		} else if (key === 'fibonacci') {
			expect([m.cpu.registers[1], m.cpu.registers[2], m.cpu.registers[3]]).toEqual([55, 55, 89])
			expect(word(0x10000)).toBe(55)
		} else if (key === 'loop') {
			expect(m.cpu.registers[2]).toBe(6)
			expect(word(0x10000)).toBe(5)
		} else if (key === 'bitwise') {
			expect(Array.from(m.cpu.registers.subarray(2, 5))).toEqual([8, 14, 6])
			expect([word(0x10000), word(0x10004), word(0x10008)]).toEqual([8, 14, 6])
		} else if (key === 'input') {
			expect(m.cpu.registers[1]).toBe(-42)
			expect(word(0x10000)).toBe(-42)
		} else if (key === 'bitmap') {
			expect(m.cpu.registers[8]).toBe(0x11000)
			expect([word(0x10000), word(0x10ffc)]).toEqual([0, 0xf800f8])
		} else if (key === 'stack') {
			expect([m.cpu.registers[1], m.cpu.registers[2]]).toEqual([42, -7])
			expect(word(MEMORY_BYTES - 28)).toBe(42)
		} else if (key === 'returnArguments') {
			expect(m.cpu.registers[1]).toBe(42)
			expect(word(MEMORY_BYTES - 20)).toBe(42)
		} else if (key === 'scaledTable') {
			expect([m.cpu.registers[1], m.cpu.registers[2]]).toEqual([30, -128])
			expect([word(0x10000), word(0x10004), word(0x10008), word(0x1000c)]).toEqual([10, 20, 30, 40])
		}
	})
	it('preserves high data-register bits on byte/word moves and sign extends MOVEA.W', () => {
		const m = runtime('move.l #$12345678,d0\nmove.b #$ff,d0\nmove.w #$8000,d0\nmovea.w #$ffff,a0\nmoveq #9,d1')
		for (let i = 0; i < 5; i++) m.step()
		expect(m.registerValues().D0).toBe(0x12348000)
		expect(m.registerValues().A0).toBe(-1)
	})
	it('updates arithmetic NZVCX and compare preserves X', () => {
		const m = runtime('moveq #127,d0\naddq.b #1,d0\nmoveq #-1,d0\naddq.b #1,d0\ncmpi.b #1,d0')
		m.step()
		m.step()
		expect(m.cpu.sr & 31).toBe(N | V)
		m.step()
		m.step()
		expect(m.cpu.sr & 31).toBe(Z | C | X)
		m.step()
		expect(m.cpu.sr & 31).toBe(N | C | X)
	})
	it('uses word address arithmetic without changing CCR', () => {
		const m = runtime('movea.l #$10000,a0\nmove #$15,ccr\nadda.w #-2,a0\naddq.w #1,a0\nsuba.l #1,a0')
		for (let i = 0; i < 5; i++) m.step()
		expect(m.cpu.registers[8]).toBe(0xfffe)
		expect(m.cpu.sr & 31).toBe(0x15)
	})
	it('performs big-endian transfers and SP byte postincrement uses two bytes', () => {
		const m = runtime('movea.l #$10000,a0\nmove.l #$12345678,(a0)\nmove.b (a0)+,d0\nmove.w (a0)+,d1', '68020')
		for (let i = 0; i < 4; i++) m.step()
		expect(Array.from(m.cpu.memory.slice(0x10000, 0x10004))).toEqual([0x12, 0x34, 0x56, 0x78])
		expect(m.cpu.registers[0]).toBe(0x12)
		expect(m.cpu.registers[1]).toBe(0x3456)
		expect(m.cpu.registers[8]).toBe(0x10003)
		const sp = m.cpu.registers[15]
		const p = runtime('move.b #1,-(sp)\nmove.b (sp)+,d0')
		p.step()
		expect(p.cpu.registers[15]).toBe(sp - 2)
		p.step()
		expect(p.cpu.registers[15]).toBe(sp)
	})
	it('faults atomically on 68000 odd data and supports it on 68020', () => {
		for (const model of ['68000', '68010', '68020'] as CpuModel[]) {
			const m = runtime('movea.l #$10001,a0\nmove.l #$12345678,(a0)+', model)
			m.step()
			const pc = m.pc,
				a0 = m.cpu.registers[8]
			if (model === '68020') {
				m.step()
				expect(m.cpu.memory[0x10001]).toBe(0x12)
			} else {
				expect(() => m.step()).toThrow('Address error')
				expect(m.pc).toBe(pc)
				expect(m.cpu.registers[8]).toBe(a0)
				expect(m.history.length).toBe(1)
				expect(m.cpu.memory[0x10001]).toBe(0)
			}
		}
	})
	it('uses all condition codes through Scc and DBcc preserves flags', () => {
		const m = runtime('moveq #1,d0\nmove #4,ccr\nseq d1\nsne d2\ndbra d0,loop\nloop:nop')
		for (let i = 0; i < 5; i++) m.step()
		expect(m.cpu.registers[1] & 255).toBe(255)
		expect(m.cpu.registers[2]).toBe(0)
		expect(m.cpu.sr & 31).toBe(Z)
		expect(m.cpu.registers[0]).toBe(0)
	})
	it('computes signed division remainder and reports overflow without replacing dividend', () => {
		const m = runtime('moveq #-7,d0\nmoveq #3,d1\ndivs.w d1,d0\nmove.l #$7fffffff,d2\ndivs.w d1,d2')
		for (let i = 0; i < 5; i++) m.step()
		expect(m.cpu.registers[0] >>> 0).toBe(0xfffffffe)
		expect(m.cpu.registers[2]).toBe(0x7fffffff)
		expect(m.cpu.sr & V).toBe(V)
	})
	it('executes scaled brief indices and EXTB on 68020', () => {
		const m = runtime(
			'movea.l #$10000,a0\nmoveq #2,d1\nmove.l #42,8(a0)\nmove.l 0(a0,d1.l*4),d2\nmoveq #-1,d3\nextb.l d3\nbkpt #0',
			'68020'
		)
		finish(m)
		expect(m.cpu.registers[2]).toBe(42)
		expect(m.cpu.registers[3]).toBe(-1)
	})
	it('RTD returns and deallocates arguments on 68010', () => {
		const m = runtime('move.l #123,-(sp)\nbsr fn\nmoveq #9,d0\ntrap #15\nfn:rtd #4', '68010')
		const sp = m.cpu.registers[15]
		finish(m)
		expect(m.cpu.registers[15]).toBe(sp)
		expect(m.callStack).toEqual([])
	})
	it('rewinds registers/memory/output/flags/stop and call-stack deltas exactly', () => {
		const m = runtime(EXAMPLES.factorial.code),
			reset = m.registerValues()
		finish(m)
		const count = m.instructionCount
		while (m.stepBack()) {
			/* undo every instruction */
		}
		expect(m.registerValues()).toEqual(reset)
		expect(m.console).toBe('')
		expect(m.callStack).toEqual([])
		expect(m.history.log.payloadCount).toBe(0)
		finish(m)
		expect(m.instructionCount).toBe(count)
		expect(m.console).toBe('120')
	})
	it('captures original variable-length words for history despite self modification', () => {
		const m = runtime('move.l #42,d1\nmoveq #9,d0\ntrap #15')
		m.step()
		const entry = m.history.at(0)!
		m.writeByte(0x1000, 0x4e)
		m.writeByte(0x1001, 0x71)
		expect(m.historyFormat.instruction(entry)).toContain('move.l')
		expect(m.historyFormat.effects(entry, true)).toEqual(
			expect.arrayContaining([expect.objectContaining({ register: 'D1', value: 0 })])
		)
		expect(entry.length).toBe(6)
	})
	it('rewinds waiting input and reports its retired instruction once', () => {
		const m = runtime('moveq #5,d0\ntrap #15\nmoveq #9,d0\ntrap #15'),
			seen: string[] = []
		m.observers.push({ onInstruction: (_address, instruction) => seen.push((instruction as { name: string }).name) })
		m.step()
		m.step()
		expect(m.pendingInput?.type).toBe('integer')
		expect(m.provideInput('bad')).toBe(false)
		expect(m.provideInput('-42')).toBe(true)
		expect(seen).toEqual(['moveq', 'trap'])
		expect(m.cpu.registers[1]).toBe(-42)
		expect(m.stepBack()).toBe(true)
		expect(m.pendingInput?.type).toBe('integer')
		expect(m.cpu.registers[1]).toBe(0)
	})
	it('handles debugger edits and multi-block byte shift history', () => {
		const m = runtime('nop')
		m.writeRegister('D0', 42)
		m.writeByte(0x10000, 123)
		m.insertByte(0x10000, 0x12000, 7)
		expect(m.cpu.memory[0x10001]).toBe(123)
		m.stepBack()
		expect(m.cpu.memory[0x10000]).toBe(123)
		expect(m.cpu.memory[0x10001]).toBe(0)
		m.stepBack()
		m.stepBack()
		expect(m.cpu.registers[0]).toBe(0)
		expect(m.insertByte(NaN, 10, 2)).toBe(false)
		expect(() => m.setProgramCounter(MEMORY_BYTES)).toThrow('Bus fault')
	})
	it('yields an unpaced loop and stops it on disposal', async () => {
		const m = runtime('loop:bra loop')
		const run = m.run()
		m.dispose()
		await run
		const count = m.instructionCount
		m.step()
		expect(m.instructionCount).toBe(count)
	})
	it('decodes variable lengths independently of assembly source', () => {
		const data = [0x203c, 0x1234, 0x5678]
		const d = decodeInstruction((address) => data[(address - 0x1000) / 2], 0x1000, '68000')
		expect(d.length).toBe(6)
		expect(disassemble(d)).toBe('move.l #$12345678,d0')
	})
	it.each(['swap.b d0', 'seq.l d0', 'move.l #1,ccr', 'btst.b #1,d0', 'btst.l #1,(a0)', 'nop.l'])(
		'rejects misleading size suffixes: %s',
		(code) => {
			expect(assemble(code).diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
		}
	)
	it('preserves symbol and character case through effective addresses', () => {
		const m = runtime(".data\nCamelCase: dc.b 'A'\n.text\nlea CamelCase,a0\nmove.b (a0),d1\nmove.b #'Z',d2")
		m.step()
		m.step()
		m.step()
		expect(m.cpu.registers[1]).toBe(65)
		expect(m.cpu.registers[2]).toBe(90)
	})
	it('executes static bit operations and preserves unrelated flags', () => {
		const m = runtime('move #$13,ccr\nbset #31,d0\nbtst #31,d0\nbclr #31,d0\nbtst #31,d0')
		m.step()
		m.step()
		expect(m.cpu.registers[0]).toBe(-2147483648)
		m.step()
		expect(m.cpu.sr & 31).toBe(0x13)
		m.step()
		expect(m.cpu.registers[0]).toBe(0)
		m.step()
		expect(m.cpu.sr & 31).toBe(0x17)
	})
	it.each([0xd100, 0xb108, 0x43d8, 0x1040, 0x4c80])(
		'rejects excluded raw opcode $%s without modifying state',
		(opcode) => {
			const m = runtime(`dc.w $${opcode.toString(16)},0`),
				before = m.registerValues()
			expect(() => m.step()).toThrow()
			expect(m.registerValues()).toEqual(before)
			expect(m.history.length).toBe(0)
		}
	)
	it('rolls back partial MOVEM writes and seeks observers on faults', () => {
		const m = runtime('movea.l #$ffffc,a0\nmoveq #42,d0\nmoveq #7,d1\nmovem.l d0-d1,(a0)'),
			sought: number[] = []
		m.observers.push({ onSeek: (count) => sought.push(count) })
		m.step()
		m.step()
		m.step()
		const pc = m.pc
		expect(() => m.step()).toThrow('Bus fault')
		expect(m.pc).toBe(pc)
		expect(Array.from(m.cpu.memory.slice(MEMORY_BYTES - 4))).toEqual([0, 0, 0, 0])
		expect(m.history.length).toBe(3)
		expect(sought).toEqual([3])
	})
	it('runs examples supplied only by their CPU model', () => {
		const m10 = runtime(EXAMPLES_68010.returnArguments.code, '68010')
		finish(m10)
		expect(m10.console).toBe('42')
		const m20 = runtime(EXAMPLES_68020.scaledTable.code, '68020')
		finish(m20)
		expect(m20.console).toBe('30')
		expect(m20.cpu.registers[2]).toBe(-128)
	})
	it('keeps recursive call history in typed constant-size deltas', () => {
		const m = runtime('again: bsr again')
		for (let i = 0; i < 200; i++) m.step()
		expect(m.callStack.length).toBe(200)
		expect(m.history.log.payloadCount).toBe(0)
		for (let i = 0; i < 200; i++) expect(m.stepBack()).toBe(true)
		expect(m.callStack.length).toBe(0)
		expect(m.pc).toBe(0x1000)
	})
	it('classifies unconditional branches as jumps and compare as read-only', () => {
		const m = runtime('bra $1000'),
			instructions = m.toolConfig().instructions!
		const jump = instructions.describe(m.cpu.decode())
		expect([jump.isBranch, jump.isJump, jump.category]).toEqual([false, true, 1])
		const cmp = runtime('cmpi.w #1,d0')
		expect(cmp.toolConfig().instructions!.describe(cmp.cpu.decode()).writes).toEqual([16])
	})
})
