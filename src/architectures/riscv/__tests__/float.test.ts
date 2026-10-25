import { describe, expect, it } from 'vitest'
import { assembleRiscv } from '../assembler'
import { decode, disassemble, TEXT_BASE } from '../isa'
import { RiscvRuntime } from '../runtime'
import { DOUBLE_EXAMPLES, FLOAT_EXAMPLES } from '../examples'
import { riscvIsa } from '../variants'
import definition from '../index'
import * as fp from '../float'

const assemble = (code: string, flen: number, compressed = false) =>
	assembleRiscv({ files: [{ name: 'main.s', code }], entries: ['main.s'] }, compressed, flen)
function machine(code: string, flen = 64, compressed = false) {
	const program = assemble(code, flen, compressed)
	expect(program.diagnostics).toEqual([])
	return new RiscvRuntime(program, { historyLimit: 100000, speed: null })
}
function finish(m: RiscvRuntime) {
	let count = 0
	while (!m.halted && count++ < 2_000_000) m.step()
	expect(m.halted).toBe(true)
}
function words(code: string, flen = 64) {
	const program = assemble(code, flen)
	expect(program.diagnostics).toEqual([])
	const bytes = program.image().sections.find((s) => s.address === TEXT_BASE)!.bytes
	return Array.from({ length: bytes.length / 4 }, (_, i) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(i * 4, true))
}
const halves = (code: string, flen = 64) => {
	const program = assemble(`.option rvc\n${code}`, flen, true)
	expect(program.diagnostics).toEqual([])
	const bytes = program.image().sections.find((s) => s.address === TEXT_BASE)!.bytes
	return Array.from({ length: bytes.length / 2 }, (_, i) => bytes[i * 2] | (bytes[i * 2 + 1] << 8))
}
const errors = (code: string, flen: number, compressed = false) =>
	assemble(code, flen, compressed).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

describe('RV32F/D encodings', () => {
	// Words assembled by hand from the unprivileged spec's opcode map: funct7/funct5+fmt, rs3, rs2, rs1, rm, rd, opcode.
	it.each([
		['fadd.s fa0, fa0, fa1', 0x00b57553],
		['fadd.s f1, f2, f3', 0x003170d3],
		['fsub.d f1, f2, f3, rtz', 0x0a3110d3],
		['fmul.s f1, f2, f3, rne', 0x103100d3],
		['fdiv.d f1, f2, f3, rdn', 0x1a3120d3],
		['fsqrt.s f1, f2', 0x580170d3],
		['fsqrt.d f1, f2, rup', 0x5a0130d3],
		['fmadd.s f1, f2, f3, f4', 0x203170c3],
		['fmsub.d f1, f2, f3, f4, rmm', 0x223140c7],
		['fnmsub.s f1, f2, f3, f4', 0x203170cb],
		['fnmadd.d f1, f2, f3, f4', 0x223170cf],
		['fsgnj.s f1, f2, f3', 0x203100d3],
		['fsgnjn.d f1, f2, f3', 0x223110d3],
		['fsgnjx.s f1, f2, f3', 0x203120d3],
		['fmv.s f1, f2', 0x202100d3],
		['fneg.d f1, f2', 0x222110d3],
		['fabs.s f1, f2', 0x202120d3],
		['fmin.d f1, f2, f3', 0x2a3100d3],
		['fmax.s f1, f2, f3', 0x283110d3],
		['feq.s a0, f2, f3', 0xa0312553],
		['flt.d a0, f2, f3', 0xa2311553],
		['fle.s a0, f2, f3', 0xa0310553],
		['fcvt.w.s a0, f2, rtz', 0xc0011553],
		['fcvt.wu.d a0, f2', 0xc2117553],
		['fcvt.s.w f1, a0', 0xd00570d3],
		['fcvt.d.wu f1, a0', 0xd21500d3],
		['fcvt.s.d f1, f2', 0x401170d3],
		['fcvt.d.s f1, f2', 0x420100d3],
		['fmv.x.w a0, f2', 0xe0010553],
		['fclass.s a0, f2', 0xe0011553],
		['fclass.d a0, f2', 0xe2011553],
		['fmv.w.x f1, a0', 0xf00500d3],
		['flw f1, 8(a0)', 0x00852087],
		['fld f1, -8(a0)', 0xff853087],
		['fsw f3, 8(a0)', 0x00352427],
		['fsd f3, -8(a0)', 0xfe353c27],
		['frcsr a0', 0x00302573],
		['fscsr a1', 0x00359073],
		['frrm a0', 0x00202573],
		['fsrm a0, a1', 0x00259573],
		['frflags a0', 0x00102573],
		['fsflags a1', 0x00159073],
		['fsrmi 1', 0x0020d073],
		['fsflagsi a0, 0', 0x00105573],
		['csrrc a0, fflags, a1', 0x0015b573],
		['csrrsi a0, fcsr, 31', 0x003fe573],
		['csrrci zero, frm, 4', 0x00227073]
	])('%s', (source, word) => {
		expect(words(source)).toEqual([word])
	})
	it.each([
		['c.flw f8, 4(x9)', 0x60c0],
		['c.fsw f9, 64(x8)', 0xe024],
		['c.flwsp f1, 12(sp)', 0x60b2],
		['c.fswsp f2, 252(sp)', 0xff8a],
		['c.fld f10, 8(x11)', 0x2588],
		['c.fsd f15, 128(x15)', 0xa3dc],
		['c.fldsp f3, 8(sp)', 0x21a2],
		['c.fsdsp f4, 504(sp)', 0xbf92]
	])('%s', (source, half) => {
		expect(halves(source)).toEqual([half])
		// Each expands to the 32-bit form it abbreviates.
		const long = source.slice(2).replace('sp ', ' ').replace(/^(f[ls][wd])sp/, '$1')
		expect(decode(half, true, 64).opcodeWord).toBe(words(long)[0])
	})
	it('disassembles float words with their rounding modes and CSR names', () => {
		expect(disassemble(0x0a3110d3, 0, false, 64)).toBe('fsub.d f1, f2, f3, rtz')
		expect(disassemble(0x203170c3, 0, false, 64)).toBe('fmadd.s f1, f2, f3, f4')
		expect(disassemble(0xc0011553, 0, false, 64)).toBe('fcvt.w.s x10, f2, rtz')
		expect(disassemble(0x420100d3, 0, false, 64)).toBe('fcvt.d.s f1, f2')
		expect(disassemble(0xfe353c27, 0, false, 64)).toBe('fsd f3, -8(x10)')
		expect(disassemble(0x00302573, 0, false, 64)).toBe('csrrs x10, fcsr, x0')
		expect(disassemble(0x60c0, 0, true, 32)).toBe('c.flw f8, 4(x9)')
		// Without F the same words are not instructions; RV32F has no D.
		expect(disassemble(0x003170d3, 0, false, 0)).toBe('.word 0x3170d3')
		expect(disassemble(0x0a3110d3, 0, false, 32)).toBe('.word 0xa3110d3')
		// Reserved rounding modes 5 and 6 are illegal.
		expect(decode(0x003150d3, false, 64).name).toBe('')
	})
})

describe('F and D availability', () => {
	it('rejects float instructions without F, doubles without D and compressed floats without C', () => {
		expect(errors('fadd.s f1, f2, f3', 0)[0]).toContain('F extension')
		expect(errors('frcsr a0', 0)[0]).toContain('F extension')
		expect(errors('fadd.s f1, f2, f3', 32)).toEqual([])
		expect(errors('fadd.s x1, x2, x3', 32).length).toBe(1)
		expect(errors('fadd.d f1, f2, f3', 32)[0]).toContain('D extension')
		expect(errors('fld f1, 0(a0)', 32)[0]).toContain('D extension')
		expect(errors('.option rvc\nc.fld f8, 0(x8)', 32, true)[0]).toContain('D extension')
		expect(errors('c.flw f8, 0(x8)', 64)[0]).toContain('C extension')
		expect(errors('fadd.s f1, f2, f3, rxx', 32)[0]).toContain('Rounding mode')
	})
	it('offers float registers, the variant and the example only with F or D', () => {
		expect(definition.settings.fields.map((field) => field.key)).toEqual(['isa', 'float'])
		const none = riscvIsa({ isa: 'rv32imc', float: 'none' }),
			single = riscvIsa({ isa: 'rv32im', float: 'f' }),
			double = riscvIsa({ isa: 'rv32imc', float: 'fd' })
		expect([none.id, single.id, double.id]).toEqual(['rv32imc', 'rv32imf', 'rv32imfdc'])
		expect(none.view.examples.floatingpoint).toBeUndefined()
		expect(single.view.examples.floatingpoint.name).toBe('Floating-point Arithmetic')
		expect(none.view.examples.mandelbrot.code).not.toContain('fmul.s')
		expect(single.view.examples.mandelbrot.code).toContain('fmul.s')
		expect(none.view.registers.some((r) => r.id === 'f0')).toBe(false)
		expect(single.view.registers.find((r) => r.id === 'f10')).toMatchObject({ bits: 32, aliases: ['fa0'], pairsWith: undefined })
		expect(double.view.registers.find((r) => r.id === 'f10')?.pairsWith).toBe('f10.hi')
		expect(double.view.examples.compressed).toBeDefined()
	})
})

const S = (value: number) => {
	const view = new DataView(new ArrayBuffer(4))
	view.setFloat32(0, value)
	return BigInt(view.getUint32(0))
}
const D = (value: number) => {
	const view = new DataView(new ArrayBuffer(8))
	view.setFloat64(0, value)
	return view.getBigUint64(0)
}
const env = (rm = fp.RNE): fp.FloatEnv => ({ rm, flags: 0 })

describe('IEEE 754 semantics', () => {
	it('rounds single-precision sums in every mode', () => {
		const one = S(1),
			tie = 0x33800000n, // 2^-24, half an ulp of 1.0
			above = 0x33800001n
		const results = [fp.RNE, fp.RTZ, fp.RDN, fp.RUP, fp.RMM].map((rm) => fp.add(env(rm), fp.SINGLE, one, tie))
		expect(results).toEqual([0x3f800000n, 0x3f800000n, 0x3f800000n, 0x3f800001n, 0x3f800001n])
		expect(fp.add(env(), fp.SINGLE, one, above)).toBe(0x3f800001n)
		const negative = [fp.RNE, fp.RTZ, fp.RDN, fp.RUP, fp.RMM].map((rm) => fp.add(env(rm), fp.SINGLE, S(-1), tie | 0x80000000n))
		expect(negative).toEqual([0xbf800000n, 0xbf800000n, 0xbf800001n, 0xbf800000n, 0xbf800001n])
		const e = env()
		fp.add(e, fp.SINGLE, one, tie)
		expect(e.flags).toBe(fp.NX)
	})
	it('rounds doubles exactly where JavaScript only offers nearest-even', () => {
		const third = fp.divide(env(fp.RTZ), fp.DOUBLE, D(1), D(3)),
			up = fp.divide(env(fp.RUP), fp.DOUBLE, D(1), D(3))
		expect(third).toBe(D(1 / 3))
		expect(up).toBe(D(1 / 3) + 1n)
		expect(fp.squareRoot(env(), fp.DOUBLE, D(2))).toBe(D(Math.SQRT2))
		// The nearest double to sqrt(2) lies above it.
		expect(fp.squareRoot(env(fp.RTZ), fp.DOUBLE, D(2))).toBe(D(Math.SQRT2) - 1n)
		expect(fp.squareRoot(env(fp.RUP), fp.DOUBLE, D(2))).toBe(D(Math.SQRT2))
		const exact = env()
		expect(fp.squareRoot(exact, fp.DOUBLE, D(0.25))).toBe(D(0.5))
		expect(exact.flags).toBe(0)
	})
	it('fuses multiply-add with one rounding', () => {
		// (1 + 2^-23)^2 - (1 + 2^-22) = 2^-46 exactly; unfused it is 0.
		const a = 0x3f800001n,
			c = 0x3f800002n
		expect(fp.fusedMultiplyAdd(env(), fp.SINGLE, a, a, c, false, true)).toBe(S(2 ** -46))
		expect(fp.fusedMultiplyAdd(env(), fp.SINGLE, a, a, c, true, false)).toBe(S(-(2 ** -46)))
		const e = env()
		expect(fp.fusedMultiplyAdd(e, fp.SINGLE, S(Infinity), S(0), fp.canonicalNaN(fp.SINGLE), false, false)).toBe(0x7fc00000n)
		expect(e.flags).toBe(fp.NV)
		// An exact zero sum is +0, or -0 rounding down.
		expect(fp.fusedMultiplyAdd(env(), fp.DOUBLE, D(1), D(1), D(-1), false, false)).toBe(0n)
		expect(fp.fusedMultiplyAdd(env(fp.RDN), fp.DOUBLE, D(1), D(1), D(-1), false, false)).toBe(1n << 63n)
	})
	it('produces canonical NaNs and signals only where IEEE requires', () => {
		const quiet = 0x7fc12345n,
			signaling = 0x7f800001n
		let e = env()
		expect(fp.add(e, fp.SINGLE, quiet, S(1))).toBe(0x7fc00000n)
		expect(e.flags).toBe(0)
		expect(fp.multiply(e, fp.SINGLE, signaling, S(1))).toBe(0x7fc00000n)
		expect(e.flags).toBe(fp.NV)
		e = env()
		expect(fp.divide(e, fp.SINGLE, S(0), S(0))).toBe(0x7fc00000n)
		expect(fp.squareRoot(e, fp.DOUBLE, D(-1))).toBe(0x7ff8000000000000n)
		expect(fp.add(e, fp.DOUBLE, D(Infinity), D(-Infinity))).toBe(0x7ff8000000000000n)
		expect(e.flags).toBe(fp.NV)
		e = env()
		expect(fp.divide(e, fp.SINGLE, S(-3), S(0))).toBe(S(-Infinity))
		expect(e.flags).toBe(fp.DZ)
		expect(fp.squareRoot(env(), fp.SINGLE, S(-0))).toBe(0x80000000n)
		expect(fp.convert(env(), fp.DOUBLE, fp.SINGLE, 0x7ff0000000000001n)).toBe(0x7fc00000n)
	})
	it('flags overflow and tininess after rounding', () => {
		let e = env()
		expect(fp.multiply(e, fp.SINGLE, 0x7f7fffffn, S(2))).toBe(S(Infinity))
		expect(e.flags).toBe(fp.OF | fp.NX)
		expect(fp.multiply(env(fp.RTZ), fp.SINGLE, 0x7f7fffffn, S(2))).toBe(0x7f7fffffn)
		expect(fp.multiply(env(fp.RDN), fp.SINGLE, 0x7f7fffffn, S(2))).toBe(0x7f7fffffn)
		expect(fp.multiply(env(fp.RUP), fp.SINGLE, 0xff7fffffn, S(2))).toBe(0xff7fffffn)
		e = env()
		expect(fp.multiply(e, fp.SINGLE, 0x00800001n, S(0.5))).toBe(0x00400000n)
		expect(e.flags).toBe(fp.UF | fp.NX)
		e = env()
		expect(fp.multiply(e, fp.SINGLE, 0x00800000n, S(0.5))).toBe(0x00400000n)
		expect(e.flags).toBe(0)
		// 0x007fffff + 2^-150 rounds to the smallest normal, but stays tiny at 24 bits: UF.
		e = env()
		expect(fp.fusedMultiplyAdd(e, fp.SINGLE, 0x1a000000n, 0x1a000000n, 0x007fffffn, false, false)).toBe(0x00800000n)
		expect(e.flags).toBe(fp.UF | fp.NX)
		// + 3 * 2^-151 rounds to 2^-126 at 24 bits with an unbounded exponent: not tiny, NX only.
		e = env()
		expect(fp.fusedMultiplyAdd(e, fp.SINGLE, 0x1a400000n, 0x1a000000n, 0x007fffffn, false, false)).toBe(0x00800000n)
		expect(e.flags).toBe(fp.NX)
	})
	it('orders signed zeros and ignores a single NaN in fmin and fmax', () => {
		let e = env()
		expect(fp.minMax(e, fp.SINGLE, S(-0), S(0), false)).toBe(0x80000000n)
		expect(fp.minMax(e, fp.SINGLE, S(0), S(-0), false)).toBe(0x80000000n)
		expect(fp.minMax(e, fp.SINGLE, S(-0), S(0), true)).toBe(0n)
		expect(fp.minMax(e, fp.SINGLE, 0x7fc00000n, S(1), false)).toBe(S(1))
		expect(fp.minMax(e, fp.SINGLE, S(2), 0x7fc00000n, true)).toBe(S(2))
		expect(e.flags).toBe(0)
		expect(fp.minMax(e, fp.SINGLE, 0x7f800001n, S(1), false)).toBe(S(1))
		expect(e.flags).toBe(fp.NV)
		e = env()
		expect(fp.minMax(e, fp.DOUBLE, 0x7ff0000000000123n, 0x7ff8000000000456n, true)).toBe(0x7ff8000000000000n)
		expect(e.flags).toBe(fp.NV)
		expect(fp.minMax(env(), fp.DOUBLE, D(-1), D(3), true)).toBe(D(3))
	})
	it('compares quietly for feq and signals for flt and fle', () => {
		let e = env()
		expect(fp.compare(e, fp.SINGLE, S(-0), S(0), 'eq')).toBe(1)
		expect(fp.compare(e, fp.SINGLE, 0x7fc00000n, S(0), 'eq')).toBe(0)
		expect(e.flags).toBe(0)
		expect(fp.compare(e, fp.SINGLE, 0x7fc00000n, S(0), 'lt')).toBe(0)
		expect(e.flags).toBe(fp.NV)
		e = env()
		expect(fp.compare(e, fp.DOUBLE, D(1), D(2), 'lt')).toBe(1)
		expect(fp.compare(e, fp.DOUBLE, D(2), D(2), 'le')).toBe(1)
		expect(fp.compare(e, fp.SINGLE, 0x7f800001n, S(0), 'eq')).toBe(0)
		expect(e.flags).toBe(fp.NV)
	})
	it('classifies every kind of value', () => {
		const single = [S(-Infinity), S(-1), 0x80000001n, S(-0), S(0), 0x00000001n, S(1), S(Infinity), 0x7f800001n, 0x7fc00000n]
		expect(single.map((bits) => fp.classify(bits, fp.SINGLE))).toEqual(single.map((_, i) => 1 << i))
		expect(fp.classify(0x000fffffffffffffn, fp.DOUBLE)).toBe(1 << 5)
		expect(fp.classify(0x7ff4000000000000n, fp.DOUBLE)).toBe(1 << 8)
	})
	it('converts to integers with rounding and saturation', () => {
		const convert = (bits: bigint, unsigned: boolean, rm = fp.RNE, f = fp.SINGLE) => {
			const e = env(rm)
			return [fp.toInteger(e, f, bits, unsigned), e.flags]
		}
		expect([fp.RNE, fp.RTZ, fp.RDN, fp.RUP, fp.RMM].map((rm) => convert(S(2.5), false, rm)[0])).toEqual([2, 2, 2, 3, 3])
		expect([fp.RNE, fp.RTZ, fp.RDN, fp.RUP, fp.RMM].map((rm) => convert(S(-2.5), false, rm)[0])).toEqual([-2, -2, -3, -2, -3])
		expect(convert(S(2.5), false)[1]).toBe(fp.NX)
		expect(convert(S(3e9), false)).toEqual([0x7fffffff, fp.NV])
		expect(convert(S(-3e9), false)).toEqual([-0x80000000, fp.NV])
		expect(convert(0x7fc00000n, false)).toEqual([0x7fffffff, fp.NV])
		expect(convert(S(-Infinity), false)).toEqual([-0x80000000, fp.NV])
		expect(convert(S(Infinity), true)).toEqual([-1, fp.NV])
		expect(convert(0x7fc00000n, true)).toEqual([-1, fp.NV])
		expect(convert(S(-1), true)).toEqual([0, fp.NV])
		expect(convert(S(-0.5), true, fp.RTZ)).toEqual([0, fp.NX])
		expect(convert(S(-0), true)).toEqual([0, 0])
		expect(convert(D(4294967295), true, fp.RNE, fp.DOUBLE)).toEqual([-1, 0])
		expect(convert(D(-2147483648.5), false, fp.RTZ, fp.DOUBLE)).toEqual([-0x80000000, fp.NX])
		expect(convert(D(-2147483648.5), false, fp.RDN, fp.DOUBLE)).toEqual([-0x80000000, fp.NV])
	})
	it('converts between widths and from integers with rounding', () => {
		let e = env()
		expect(fp.fromInteger(e, fp.SINGLE, 16777217)).toBe(S(16777216))
		expect(e.flags).toBe(fp.NX)
		expect(fp.fromInteger(env(fp.RUP), fp.SINGLE, 16777217)).toBe(S(16777218))
		expect(fp.fromInteger(env(), fp.DOUBLE, 0xffffffff)).toBe(D(4294967295))
		e = env()
		expect(fp.convert(e, fp.DOUBLE, fp.SINGLE, D(1e39))).toBe(S(Infinity))
		expect(e.flags).toBe(fp.OF | fp.NX)
		// The nearest single to 1/3 lies above it.
		expect(fp.convert(env(fp.RTZ), fp.DOUBLE, fp.SINGLE, D(1 / 3))).toBe(S(1 / 3) - 1n)
		expect(fp.convert(env(fp.RUP), fp.DOUBLE, fp.SINGLE, D(1 / 3))).toBe(S(1 / 3))
		expect(fp.convert(env(), fp.SINGLE, fp.DOUBLE, 0x00000001n)).toBe(D(2 ** -149))
	})
})

describe('RV32F/D execution', () => {
	it('NaN-boxes singles under D and treats unboxed values as the canonical NaN', () => {
		const m = machine(`
			li a0, 0x3f800000
			fmv.w.x f1, a0
			la t0, wide
			fld f2, 0(t0)
			fadd.s f3, f1, f2
			fmv.x.w a1, f2
			fsw f2, 8(t0)
			fsgnj.s f4, f2, f1
			ebreak
			.data
			wide: .double 2.0
			.word 0x12345678, 0`)
		finish(m)
		const v = m.registerValues()
		expect([v.f1, v['f1.hi']]).toEqual([0x3f800000, -1])
		expect([v.f3, v['f3.hi']]).toEqual([0x7fc00000, -1])
		expect(v.f4).toBe(0x7fc00000)
		// Transfers keep the low word unchanged.
		expect(m.registers[11]).toBe(0)
		expect(m.inspectMemory().word(0x10008)).toBe(0)
		expect([v.f2, v['f2.hi']]).toEqual([0, 0x40000000])
	})
	it('keeps 32-bit registers without boxing under F only', () => {
		const m = machine('li a0, 0x40490fdb\nfmv.w.x f1, a0\nfadd.s f2, f1, f1\nebreak', 32)
		finish(m)
		const v = m.registerValues()
		expect([v.f1, v.f2, v['f1.hi']]).toEqual([0x40490fdb, 0x40c90fdb, undefined])
		expect(m.fregs[3]).toBe(0)
	})
	it('accrues flags in fcsr and honours the dynamic rounding mode', () => {
		const m = machine(`
			li a0, 5
			li a1, 2
			fcvt.s.w f1, a0
			fcvt.s.w f2, a1
			fdiv.s f3, f1, f2
			fcvt.w.s a2, f3
			fsrmi 3
			fcvt.w.s a3, f3
			fcvt.w.s a4, f3, rtz
			frflags a5
			fmv.w.x f4, zero
			fdiv.s f5, f1, f4
			frcsr a6
			ebreak`)
		finish(m)
		expect(Array.from(m.registers.slice(12, 17))).toEqual([2, 3, 2, fp.NX, (3 << 5) | fp.DZ | fp.NX])
		expect(m.registerValues()).toMatchObject({ frm: 3, fflags: fp.DZ | fp.NX, fcsr: 0x69 })
	})
	it('faults on an invalid dynamic rounding mode and on reserved rm encodings without changing state', () => {
		const m = machine('fsrmi 5\nfadd.s f1, f1, f1\nebreak')
		m.step()
		const before = m.registerValues(),
			length = m.history.length
		expect(() => m.step()).toThrow('rounding mode')
		expect(m.registerValues()).toEqual(before)
		expect(m.history.length).toBe(length)
		const reserved = machine('.word 0x003150d3')
		expect(() => reserved.step()).toThrow('Illegal RV32IMFD instruction')
	})
	it('restores float registers and fcsr exactly on step back', () => {
		const m = machine(`
			li a0, 0x3f800001
			fmv.w.x f1, a0
			fmul.s f2, f1, f1
			fcvt.d.s f3, f2
			fsqrt.d f4, f3
			fsflagsi 31
			fsrmi 2
			fmadd.d f5, f4, f4, f3
			fmv.x.w a1, f5
			ebreak`)
		const states = [m.registerValues()]
		while (!m.halted) {
			m.step()
			states.push(m.registerValues())
		}
		expect(states[states.length - 1].fcsr).toBe((2 << 5) | 31)
		for (let i = states.length - 2; i >= 0; i--) {
			expect(m.stepBack()).toBe(true)
			expect(m.registerValues()).toEqual(states[i])
		}
		finish(m)
		expect(m.registerValues()).toEqual(states[states.length - 1])
		const effects = m.historyFormat.effects(m.history.at(3)!, true)
		expect(effects).toEqual([expect.objectContaining({ register: 'f2', value: 0 }), expect.objectContaining({ register: 'f2.hi', value: 0 }), expect.objectContaining({ register: 'fcsr', value: 0 })])
	})
	it('edits float registers, NaN-boxing a typed single, and the CSR fields', () => {
		const m = machine('ebreak')
		expect(m.writeRegister('f1', 0x40000000)).toBe(true)
		expect(m.writeRegister('f2.hi', 0x40000000)).toBe(true)
		expect(m.writeRegister('frm', 4)).toBe(true)
		expect(m.writeRegister('fflags', 1)).toBe(true)
		expect(m.writeRegister('f1', 1.5)).toBe(false)
		expect(m.registerValues()).toMatchObject({ f1: 0x40000000, 'f1.hi': -1, 'f2.hi': 0x40000000, fcsr: 0x81 })
		expect(m.stepBack()).toBe(true)
		expect(m.registerValues().fcsr).toBe(0x80)
		const single = machine('ebreak', 32)
		expect(single.writeRegister('f1.hi', 1)).toBe(false)
	})
	it('executes compressed float loads and stores', () => {
		const m = machine('.option rvc\nla x8, buffer\nc.flw f8, 0(x8)\nc.fsd f8, 8(x8)\nc.fswsp f8, 0(sp)\nc.fldsp f9, 0(sp)\nebreak\n.data\nbuffer: .float 1.5\n.word 0\n.word 0, 0', 64, true)
		finish(m)
		expect(m.inspectMemory().word(0x10008)).toBe(0x3fc00000)
		expect(m.inspectMemory().word(0x1000c)).toBe(-1 >>> 0)
		expect(m.registerValues()).toMatchObject({ f8: 0x3fc00000, 'f8.hi': -1, f9: 0x3fc00000 })
	})
})

describe('float examples', () => {
	it.each([
		['F', FLOAT_EXAMPLES, 32, '5\n314\n2\n3\n8\n128\n'],
		['D', DOUBLE_EXAMPLES, 64, '5\n314\n2\n3\n8\n128\n333333333\n333333343\n0\n']
	] as const)('runs floatingpoint under %s', (_, examples, flen, output) => {
		const m = machine(examples.floatingpoint.code, flen)
		finish(m)
		expect(m.console).toBe(output)
	})
	it.each([32, 64])('draws the single-precision Mandelbrot under flen %i to the MIPS reference', (flen) => {
		const palette = [
			0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
			0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb, 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0x000000
		]
		const m = machine(FLOAT_EXAMPLES.mandelbrot.code, flen)
		finish(m)
		const actual: number[] = [],
			expected: number[] = []
		for (let row = 0; row < 32; row++)
			for (let col = 0; col < 32; col++) {
				// The MIPS program's binary32 recurrence, step by step.
				const step = Math.fround(2.5 / 32),
					cy = Math.fround(Math.fround(row * step) - 1.25),
					cx = Math.fround(Math.fround(col * step) - 2)
				let x = 0,
					y = 0,
					iteration = 0
				for (; iteration < 16; iteration++) {
					const xx = Math.fround(x * x),
						yy = Math.fround(y * y)
					if (Math.fround(xx + yy) > 4) break
					y = Math.fround(Math.fround(Math.fround(x * y) * 2) + cy)
					x = Math.fround(Math.fround(xx - yy) + cx)
				}
				expected.push(iteration)
				actual.push(palette.indexOf(m.inspectMemory().word(0x10000 + (row * 32 + col) * 4)!))
			}
		expect(actual).toEqual(expected)
		expect(new Set(expected).size).toBeGreaterThan(10)
	})
})
