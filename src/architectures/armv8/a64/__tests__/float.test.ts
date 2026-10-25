import { describe, expect, it } from 'vitest'
import { assembleA64 } from '../assembler'
import { FAULT_UNDEFINED, STEP_FAULT, STEP_HALT } from '../cpu'
import { decode, Op } from '../decode'
import { disassemble } from '../disassemble'
import { FLAG_C, FLAG_N, FLAG_V, FLAG_Z } from '../isa'
import { TEXT_BASE } from '../layout'
import { A64Machine } from '../machine'
import { a64RegisterValues } from '../registers'
import { A64Runtime } from '../runtime'
import { A64Assembly } from '../program'
import { DOUBLE, numberToBits, SINGLE } from '../../shared/fp'

const MEMORY = 1 << 20

function assemble(code: string, floatingPoint = true) {
	return assembleA64({ name: 'test.s', code }, { floatingPoint })
}

function words(code: string): number[] {
	const result = assemble(code)
	expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const text = result.image!.sections.find((section) => section.address === TEXT_BASE)!
	const view = new DataView(text.bytes.buffer, text.bytes.byteOffset, text.bytes.byteLength)
	return Array.from({ length: text.bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true))
}

function machineFor(code: string, historyLimit = 0, floatingPoint = true): A64Machine {
	const result = assemble(code)
	expect(result.diagnostics).toEqual([])
	const machine = new A64Machine({ memoryBytes: MEMORY, historyLimit, floatingPoint })
	machine.load(result.image!)
	return machine
}

function run(code: string): A64Machine {
	const machine = machineFor(`${code}\n\t.text\n\thlt #0\n`)
	expect(machine.run(100_000)).toBe(STEP_HALT)
	return machine
}

const s = (machine: A64Machine, n: number) => Number(machine.cpu.v[2 * n] & 0xFFFF_FFFFn)
const d = (machine: A64Machine, n: number) => machine.cpu.v[2 * n]
const single = (value: number) => Number(numberToBits(value, SINGLE))
const double = (value: number) => numberToBits(value, DOUBLE)

/**
 * Worked out by hand from the encoding diagrams of the Arm ARM (DDI 0487,
 * C4.1.96 scalar floating-point, C4.1.94 loads and stores of SIMD&FP
 * registers, C5.2 MRS/MSR), not by this assembler.
 */
const CASES: [string, number][] = [
	['fmov s0, s1', 0x1E204020],
	['fabs s0, s1', 0x1E20C020],
	['fneg d0, d1', 0x1E614020],
	['fsqrt d0, d1', 0x1E61C020],
	['fcvt d0, s1', 0x1E22C020],
	['fcvt s0, d1', 0x1E624020],
	['frintn s0, s1', 0x1E244020],
	['frintp s0, s1', 0x1E24C020],
	['frintm s0, s1', 0x1E254020],
	['frintz s0, s1', 0x1E25C020],
	['frinta s0, s1', 0x1E264020],
	['frintx s0, s1', 0x1E274020],
	['frinti s0, s1', 0x1E27C020],
	['fmul d0, d1, d2', 0x1E620820],
	['fdiv s0, s1, s2', 0x1E221820],
	['fadd s0, s1, s2', 0x1E222820],
	['fadd d0, d1, d2', 0x1E622820],
	['fsub s0, s1, s2', 0x1E223820],
	['fmax s0, s1, s2', 0x1E224820],
	['fmin s0, s1, s2', 0x1E225820],
	['fmaxnm s0, s1, s2', 0x1E226820],
	['fminnm s0, s1, s2', 0x1E227820],
	['fnmul s0, s1, s2', 0x1E228820],
	['fmadd s0, s1, s2, s3', 0x1F020C20],
	['fmadd d0, d1, d2, d3', 0x1F420C20],
	['fmsub s0, s1, s2, s3', 0x1F028C20],
	['fnmadd s0, s1, s2, s3', 0x1F220C20],
	['fnmsub s0, s1, s2, s3', 0x1F228C20],
	['fcmp s0, s1', 0x1E212000],
	['fcmp d0, #0.0', 0x1E602008],
	['fcmpe s0, s1', 0x1E212010],
	['fcmpe d0, #0.0', 0x1E602018],
	['fccmp s0, s1, #0, eq', 0x1E210400],
	['fccmpe d0, d1, #8, ne', 0x1E611418],
	['fcsel s0, s1, s2, eq', 0x1E220C20],
	['fcsel d0, d1, d2, ne', 0x1E621C20],
	['fmov d0, #1.0', 0x1E6E1000],
	['fmov s0, #-2.5', 0x1E309000],
	['fmov s0, #0.0', 0x1E2703E0],
	['scvtf s0, w1', 0x1E220020],
	['scvtf d0, x1', 0x9E620020],
	['ucvtf s0, w1', 0x1E230020],
	['fcvtns w0, s1', 0x1E200020],
	['fcvtnu w0, s1', 0x1E210020],
	['fcvtps w0, s1', 0x1E280020],
	['fcvtpu w0, s1', 0x1E290020],
	['fcvtms w0, s1', 0x1E300020],
	['fcvtmu w0, s1', 0x1E310020],
	['fcvtzs w0, s1', 0x1E380020],
	['fcvtzs x0, d1', 0x9E780020],
	['fcvtzu w0, d1', 0x1E790020],
	['fcvtas w0, s1', 0x1E240020],
	['fcvtau w0, s1', 0x1E250020],
	['scvtf s0, w1, #16', 0x1E02C020],
	['ucvtf d0, x1, #32', 0x9E438020],
	['fcvtzs w0, s1, #16', 0x1E18C020],
	['fmov w0, s1', 0x1E260020],
	['fmov s0, w1', 0x1E270020],
	['fmov x0, d1', 0x9E660020],
	['fmov d0, x1', 0x9E670020],
	['ldr s0, [x1]', 0xBD400020],
	['ldr d0, [x1, #8]', 0xFD400420],
	['str q0, [x1, #16]', 0x3D800420],
	['ldr q0, [sp]', 0x3DC003E0],
	['ldr b0, [x1]', 0x3D400020],
	['ldr h0, [x1]', 0x7D400020],
	['ldur s0, [x1, #-4]', 0xBC5FC020],
	['stur d0, [x1, #-8]', 0xFC1F8020],
	['ldr d0, [x1], #8', 0xFC408420],
	['str d0, [sp, #-16]!', 0xFC1F0FE0],
	['ldr s0, [x1, x2, lsl #2]', 0xBC627820],
	['stp d8, d9, [sp, #-16]!', 0x6DBF27E8],
	['ldp d8, d9, [sp], #16', 0x6CC127E8],
	['ldp s0, s1, [x2]', 0x2D400440],
	['stp q0, q1, [sp, #32]', 0xAD0107E0],
	['mrs x0, fpcr', 0xD53B4400],
	['msr fpcr, x0', 0xD51B4400],
	['mrs x1, fpsr', 0xD53B4421],
	['msr fpsr, x2', 0xD51B4422],
	['mrs x0, nzcv', 0xD53B4200],
]

describe('A64 floating point: encoding', () => {
	it.each(CASES)('assembles %s', (line, expected) => {
		expect(words(`\t${line}\n`)[0].toString(16)).toBe(expected.toString(16))
	})

	it.each(CASES.filter(([line]) => line !== 'fmov s0, #0.0'))('disassembles %s', (line, word) => {
		expect(disassemble(word, TEXT_BASE)).toBe(line)
	})

	it('disassembles the zero move and literal loads', () => {
		expect(disassemble(0x1E2703E0, TEXT_BASE)).toBe('fmov s0, wzr')
		const [load] = words('\tldr d2, value\n\tnop\nvalue:\t.double 1.5\n')
		expect(load).toBe(0x5C000042)
		expect(disassemble(load, TEXT_BASE)).toBe('ldr d2, 0x00400008')
	})

	it('lays out .float and .double data', () => {
		const result = assemble('\t.data\n\t.float 1.5, -2\n\t.double 0.1\n\t.single 3.0e-2\n')
		const data = result.image!.sections.find((section) => section.address !== TEXT_BASE)!
		const view = new DataView(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength)
		expect(view.getUint32(0, true)).toBe(0x3FC00000)
		expect(view.getUint32(4, true)).toBe(0xC0000000)
		expect(view.getBigUint64(8, true)).toBe(0x3FB999999999999An)
		expect(view.getFloat32(16, true)).toBe(Math.fround(0.03))
	})

	it('rejects what does not encode', () => {
		const error = (line: string) => assemble(`\t${line}\n`).diagnostics.map((diagnostic) => diagnostic.message).join()
		expect(error('fmov s0, #0.1')).toMatch(/load it from memory/)
		expect(error('fadd s0, s1, d2')).toMatch(/Expected an S register/)
		expect(error('fcmp s0, #1.0')).toMatch(/#0.0/)
		expect(error('ldrsw s0, [x1]')).toMatch(/not loaded or stored/)
		expect(error('scvtf s0, w1, #33')).toMatch(/out of range/)
	})

	it('decodes Advanced SIMD vector words as undefined', () => {
		// fadd v0.4s, v1.4s, v2.4s
		expect(decode(0x4E22D420).op).toBe(Op.UNDEFINED)
	})
})

describe('A64 floating point: semantics', () => {
	it('computes in single and double precision', () => {
		const machine = run(`
	fmov s1, #1.5
	fmov s2, #2.0
	fadd s0, s1, s2
	fmul s3, s1, s2
	fdiv s4, s1, s2
	fsub s5, s1, s2
	fmov d6, #10.0
	fsqrt d7, d6
	fnmul d8, d6, d6
	fabs s9, s5
	fneg d10, d6
`)
		expect(s(machine, 0)).toBe(single(3.5))
		expect(s(machine, 3)).toBe(single(3))
		expect(s(machine, 4)).toBe(single(0.75))
		expect(s(machine, 5)).toBe(single(-0.5))
		expect(d(machine, 7)).toBe(double(Math.sqrt(10)))
		expect(d(machine, 8)).toBe(double(-100))
		expect(s(machine, 9)).toBe(single(0.5))
		expect(d(machine, 10)).toBe(double(-10))
		// FSQRT of 10 is inexact.
		expect(machine.cpu.fpsr).toBe(0x10)
	})

	it('clears the upper bits of the V register on a scalar write', () => {
		const machine = run('\tadr x0, value\n\tldr q0, [x0]\n\tfmov s0, #1.0\n\t.data\n\t.balign 16\nvalue:\t.quad -1, -1\n')
		expect(machine.cpu.v[0]).toBe(0x3F800000n)
		expect(machine.cpu.v[1]).toBe(0n)
	})

	it('rounds in the FPCR mode', () => {
		// 1 + 2^-24 in single: one ulp up only toward +inf.
		const program = (rmode: number) => run(`
	mov x0, #${rmode << 22}
	msr fpcr, x0
	fmov s1, #1.0
	mov w2, #0x33800000
	fmov s2, w2
	fadd s0, s1, s2
	fneg s3, s1
	fneg s4, s2
	fadd s5, s3, s4
`)
		const modes = [[0, 0x3F800000, 0xBF800000], [1, 0x3F800001, 0xBF800000], [2, 0x3F800000, 0xBF800001], [3, 0x3F800000, 0xBF800000]]
		for (const [rmode, up, down] of modes) {
			const machine = program(rmode)
			expect(s(machine, 0), `rmode ${rmode}`).toBe(up)
			expect(s(machine, 5), `rmode ${rmode}`).toBe(down)
			expect(machine.cpu.fpsr & 0x10).toBe(0x10)
		}
	})

	it('propagates NaNs, or the default NaN under DN', () => {
		const program = (dn: boolean) => run(`
	mov x0, #${dn ? 1 << 25 : 0}
	msr fpcr, x0
	ldr w1, =0x7F800001
	fmov s1, w1
	fmov s2, #1.0
	fadd s0, s2, s1
	ldr w3, =0xFFC00005
	fmov s3, w3
	fmul s4, s3, s2
`)
		let machine = program(false)
		// The signalling NaN comes out quiet, and raises IOC.
		expect(s(machine, 0)).toBe(0x7FC00001)
		expect(s(machine, 4)).toBe(0xFFC00005)
		expect(machine.cpu.fpsr & 1).toBe(1)
		machine = program(true)
		expect(s(machine, 0)).toBe(0x7FC00000)
		expect(s(machine, 4)).toBe(0x7FC00000)
	})

	it('flushes denormals under FZ', () => {
		const machine = run(`
	mov x0, #${1 << 24}
	msr fpcr, x0
	mov w1, #1
	fmov s1, w1
	fmov s2, #1.0
	fmul s0, s1, s2
	mrs x3, fpsr
`)
		expect(s(machine, 0)).toBe(0)
		// IDC: the denormal input was flushed.
		expect(Number(machine.cpu.x[3])).toBe(0x80)
	})

	it('tells FMAXNM from FMAX on a quiet NaN', () => {
		const machine = run(`
	ldr w1, =0x7FC00000
	fmov s1, w1
	fmov s2, #-3.0
	fmax s3, s1, s2
	fmaxnm s4, s1, s2
	fminnm s5, s2, s1
	fmov s6, wzr
	fneg s7, s6
	fmax s8, s6, s7
	fmin s9, s6, s7
`)
		expect(s(machine, 3)).toBe(0x7FC00000)
		expect(s(machine, 4)).toBe(single(-3))
		expect(s(machine, 5)).toBe(single(-3))
		expect(s(machine, 8)).toBe(0)
		expect(s(machine, 9)).toBe(0x80000000)
	})

	it('converts to integers with rounding and saturation', () => {
		const machine = run(`
	fmov d0, #-2.5
	fcvtns x1, d0
	fcvtas x2, d0
	fcvtms x3, d0
	fcvtps x4, d0
	fcvtzs x5, d0
	fcvtzu x6, d0
	mov x7, #0x41F0000000000000
	fmov d7, x7
	fcvtzs w8, d7
	fcvtzu w9, d7
	fmov d10, #1.75
	fcvtzs w10, d10, #4
	mov w11, #-7
	scvtf s11, w11
	ucvtf s12, w11
	mov w13, #28
	scvtf d13, w13, #4
`)
		const signed = (n: number) => BigInt.asIntN(64, machine.cpu.x[n])
		expect(signed(1)).toBe(-2n)
		expect(signed(2)).toBe(-3n)
		expect(signed(3)).toBe(-3n)
		expect(signed(4)).toBe(-2n)
		expect(signed(5)).toBe(-2n)
		expect(signed(6)).toBe(0n)
		// 2^32 saturates in 32 bits.
		expect(machine.cpu.x[8]).toBe(0x7FFFFFFFn)
		expect(machine.cpu.x[9]).toBe(0xFFFFFFFFn)
		expect(machine.cpu.x[10]).toBe(28n)
		expect(s(machine, 11)).toBe(single(-7))
		expect(s(machine, 12)).toBe(single(4294967289))
		expect(d(machine, 13)).toBe(double(1.75))
		// IOC from saturation, IXC from the inexact ones.
		expect(machine.cpu.fpsr).toBe(0x11)
	})

	it('compares into NZCV and selects with FCSEL and FCCMP', () => {
		const machine = run(`
	fmov s0, #1.0
	fmov s1, #2.0
	fcmp s0, s1
	mrs x10, nzcv
	fcsel s2, s0, s1, mi
	fcmp s1, s0
	fcsel s3, s0, s1, mi
	fccmp s0, s0, #0b0011, eq
	mrs x11, nzcv
	fccmp s0, s1, #0b0011, gt
	mrs x12, nzcv
	ldr w4, =0x7FC00000
	fmov s4, w4
	fcmp s4, s0
	mrs x13, nzcv
	mrs x14, fpsr
	fcmpe s4, #0.0
	mrs x15, fpsr
`)
		const flags = (n: number) => Number(machine.cpu.x[n] >> 28n)
		expect(flags(10)).toBe(FLAG_N)
		expect(s(machine, 2)).toBe(single(1))
		expect(s(machine, 3)).toBe(single(2))
		// fcmp s1, s0 left C (greater): eq fails, so FCCMP sets #0b0011.
		expect(flags(11)).toBe(FLAG_C | FLAG_V)
		// gt fails under 0011 too: the immediate again.
		expect(flags(12)).toBe(FLAG_C | FLAG_V)
		expect(flags(13)).toBe(FLAG_C | FLAG_V)
		// FCMP of a quiet NaN is silent; FCMPE raises IOC.
		expect(Number(machine.cpu.x[14]) & 1).toBe(0)
		expect(Number(machine.cpu.x[15]) & 1).toBe(1)
	})

	it('runs FCCMP when its condition holds', () => {
		const machine = run('\tfmov s0, #1.0\n\tfmov s1, #1.0\n\tcmp x5, x5\n\tfccmp s0, s1, #0, eq\n\tmrs x0, nzcv\n')
		expect(Number(machine.cpu.x[0] >> 28n)).toBe(FLAG_Z | FLAG_C)
	})

	it('fuses FMADD into one rounding', () => {
		const machine = run(`
	ldr x0, =0x3FF0000000400000
	fmov d1, x0
	fmov d2, #-1.0
	fmadd d0, d1, d1, d2
	fmul d3, d1, d1
	fadd d3, d3, d2
	fmsub d4, d1, d1, d2
	fnmadd d5, d1, d1, d2
	fnmsub d6, d1, d1, d2
`)
		const a = 1 + 2 ** -30
		expect(d(machine, 0)).toBe(double(2 ** -29 + 2 ** -60))
		expect(d(machine, 3)).toBe(double(2 ** -29))
		expect(d(machine, 4)).toBe(double(-1 - a * a))
		expect(d(machine, 5)).toBe(double(-(2 ** -29 + 2 ** -60)))
		expect(d(machine, 6)).toBe(double(2 + 2 ** -29))
	})

	it('rounds to integral and converts precision', () => {
		const machine = run(`
	fmov d0, #2.5
	frintn d1, d0
	frinta d2, d0
	frintm d3, d0
	frintp d4, d0
	frintz d5, d0
	fneg d6, d0
	frinti d7, d6
	fcvt s8, d0
	fcvt d9, s8
	mrs x10, fpsr
	frintx d11, d0
	mrs x12, fpsr
`)
		expect([1, 2, 3, 4, 5, 7].map((n) => d(machine, n))).toEqual([2, 3, 2, 3, 2, -2].map(double))
		expect(s(machine, 8)).toBe(single(2.5))
		expect(d(machine, 9)).toBe(double(2.5))
		expect(Number(machine.cpu.x[10])).toBe(0)
		expect(Number(machine.cpu.x[12])).toBe(0x10)
	})

	it('loads and stores S, D, Q and pairs', () => {
		const machine = run(`
	adr x0, buffer
	fmov d0, #3.0
	fmov s1, #-1.0
	stp d0, d0, [x0]
	str s1, [x0, #16]
	ldr q2, [x0]
	str q2, [x0, #32]
	ldp s3, s4, [x0, #16]
	ldr d5, [x0, #40]
	ldur s6, [x0, #20]
	.data
	.balign 16
buffer:	.space 64
`)
		const three = double(3)
		expect(machine.cpu.v[4]).toBe(three)
		expect(machine.cpu.v[5]).toBe(three)
		expect(s(machine, 3)).toBe(single(-1))
		expect(s(machine, 4)).toBe(0)
		expect(d(machine, 5)).toBe(three)
		expect(s(machine, 6)).toBe(0)
	})

	it('keeps FPCR to the bits it implements', () => {
		const machine = run('\tmov x0, #-1\n\tmsr fpcr, x0\n\tmrs x1, fpcr\n\tmsr fpsr, x0\n\tmrs x2, fpsr\n')
		expect(machine.cpu.x[1]).toBe(0x07C00000n)
		expect(machine.cpu.x[2]).toBe(0xF800009Fn)
	})
})

describe('A64 floating point: history and settings', () => {
	it('steps back to every earlier FP state exactly', () => {
		const machine = machineFor(`
	mov x0, #${1 << 22}
	msr fpcr, x0
	adr x1, buffer
	fmov d0, #1.5
	ldr q1, [x1]
	fmov s2, #0.5
	fdiv s3, s2, s2
	ldr w4, =0x7F800001
	fmov s4, w4
	fadd s5, s4, s2
	fsqrt d6, d0
	str q1, [x1, #16]
	stp d0, d6, [x1, #32]
	fcvtzs w7, d6
	fcmp d6, d0
	hlt #0
	.data
	.balign 16
buffer:	.quad 0x0123456789ABCDEF, 0xFEDCBA9876543210
	.space 48
`, 1000)
		const snapshot = () => ({
			v: Array.from(machine.cpu.v), fpcr: machine.cpu.fpcr, fpsr: machine.cpu.fpsr, nzcv: machine.cpu.nzcv,
			x: Array.from(machine.cpu.x), pc: machine.cpu.pc, memory: Array.from(machine.cpu.memory.slice(0x20000, 0x20000 + 64)),
		})
		const states = [snapshot()]
		// The HLT records its halt as an entry too.
		for (let status = 0; status !== STEP_HALT;) {
			status = machine.step()
			states.push(snapshot())
		}
		expect(machine.cpu.fpsr).not.toBe(0)
		const history = machine.history!
		for (let index = states.length - 1; index > 0; index--) {
			expect(history.stepBack()).toBe(true)
			expect(snapshot()).toEqual(states[index - 1])
		}
		while (history.stepForward()) { /* replay */ }
		expect(snapshot()).toEqual(states[states.length - 1])
	})

	it('shows V registers as S and D in the panel values', () => {
		const machine = run('\tfmov d0, #-2.0\n\tfmov s1, #1.0\n\tmov x0, #0x00C00000\n\tmsr fpcr, x0\n')
		const values = a64RegisterValues(machine.cpu)
		expect(values.V0).toBe(0)
		expect(values['V0:hi']).toBe(0xC0000000)
		expect(values.V1).toBe(single(1))
		expect(values.FPCR).toBe(0x00C00000)
	})

	it('edits V registers, FPCR and FPSR as undoable edits', () => {
		const result = assemble('\thlt #0\n')
		const program = new A64Assembly('test.s', result.image, result.diagnostics, result.values)
		const runtime = new A64Runtime(program, { memoryBytes: MEMORY, historyLimit: 100, speed: null })
		expect(runtime.writeRegister('V3', single(2.5))).toBe(true)
		expect(runtime.writeRegister('V3:hi', 0x12345678)).toBe(true)
		expect(runtime.writeRegister('FPCR', 0xFFFFFFFF)).toBe(true)
		expect(runtime.machine.cpu.v[6]).toBe((0x12345678n << 32n) | BigInt(single(2.5)))
		expect(runtime.registerValues().FPCR).toBe(0x07C00000)
		expect(runtime.stepBack()).toBe(true)
		expect(runtime.registerValues().FPCR).toBe(0)
	})

	it('refuses FP when the setting is off', () => {
		const errors = assemble('\tfadd s0, s1, s2\n\tldr d0, [x0]\n\tmrs x0, fpcr\n\tmrs x1, nzcv\n', false).diagnostics.map((diagnostic) => diagnostic.message)
		expect(errors).toHaveLength(3)
		for (const message of errors) expect(message).toMatch(/floating point, which is off/)
		// The CPU treats the words as undefined too.
		const machine = machineFor('\tfadd s0, s1, s2\n', 0, false)
		expect(machine.step()).toBe(STEP_FAULT)
		expect(machine.cpu.fault).toBe(FAULT_UNDEFINED)
		const flagsOnly = machineFor('\tmrs x0, nzcv\n\thlt #0\n', 0, false)
		expect(flagsOnly.run(10)).toBe(STEP_HALT)
	})
})
