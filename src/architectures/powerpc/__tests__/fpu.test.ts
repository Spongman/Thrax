import { describe, expect, it } from 'vitest'
import type { CpuContext } from '../../../core/configuredCpu'
import { decode, encode } from '../isa'
import { CLASS, FEX, FI, FPR, FPSCR, FPRF, FR, FX, OX, UX, VE, VX, VXCVI, VXIMZ, VXISI, VXSNAN, VXVC, XX, ZX, getF, setF } from '../fpu'
import powerpc from '../index'

function cpu(): CpuContext {
	const memory = new Uint8Array(0x10000), view = new DataView(memory.buffer)
	const context: CpuContext = {
		state: new Uint32Array(), writeState() { throw new Error('Unused internal state') },
		r: new Uint32Array(101), w: new BigUint64Array(), memory, instructionAddress: 0x1000, pc: 0x1004,
		read(a, n = 4, le = false) { return n === 1 ? view.getUint8(a) : n === 2 ? view.getUint16(a, le) : view.getUint32(a, le) },
		write(a, v, n = 4, le = false) { if (n === 1) view.setUint8(a, v); else if (n === 2) view.setUint16(a, v, le); else view.setUint32(a, v, le) },
		readWide(a, le) { return view.getBigUint64(a, le) }, writeWide(a, v, le) { view.setBigUint64(a, v, le) },
		call() {}, ret() {}, halt() {}, output() {}, inputInteger() { return 0 },
		branch() {}, segmentAddress(segment, offset) { return segment * 16 + offset },
		readSegment() { throw new Error('unused') }, writeSegment() { throw new Error('unused') },
	}
	return context
}
function run(c: CpuContext, name: string, operands: string[]) {
	c.memory.set(encode(name, operands, { address: 0x1000, value: Number }), 0x1000)
	decode(c.memory, 0x1000).execute(c)
}
const view = new DataView(new ArrayBuffer(8))
const bitsOf = (value: number) => { view.setFloat64(0, value); return view.getBigUint64(0) }
const valueOf = (bits: bigint) => { view.setBigUint64(0, bits); return view.getFloat64(0) }
const set = (c: CpuContext, n: number, value: number) => setF(c, n, bitsOf(value))
const get = (c: CpuContext, n: number) => valueOf(getF(c, n))
const fprf = (c: CpuContext) => (c.r[FPSCR] & FPRF) >>> 12
const cr = (c: CpuContext, field: number) => c.r[32] >>> (7 - field) * 4 & 15
const QNAN = 0x7ff8000000000001n, SNAN = 0x7ff0000000000001n

describe('PowerPC floating-point encodings', () => {
	// Words assembled by hand from the Programming Environments Manual field layouts
	// (D/X/A forms, primary opcodes 31/48-55/59/63 and the listed extended opcodes).
	it.each([
		['lfs', ['f1', '8(r3)'], 0xc0230008], ['lfsu', ['f1', '8(r3)'], 0xc4230008],
		['lfsx', ['f1', 'r3', 'r4'], 0x7c23242e], ['lfsux', ['f1', 'r3', 'r4'], 0x7c23246e],
		['lfd', ['f1', '8(r3)'], 0xc8230008], ['lfdu', ['f1', '8(r3)'], 0xcc230008],
		['lfdx', ['f1', 'r3', 'r4'], 0x7c2324ae], ['lfdux', ['f1', 'r3', 'r4'], 0x7c2324ee],
		['stfs', ['f1', '8(r3)'], 0xd0230008], ['stfsu', ['f1', '8(r3)'], 0xd4230008],
		['stfsx', ['f1', 'r3', 'r4'], 0x7c23252e], ['stfsux', ['f1', 'r3', 'r4'], 0x7c23256e],
		['stfd', ['f1', '8(r3)'], 0xd8230008], ['stfdu', ['f1', '8(r3)'], 0xdc230008],
		['stfd', ['f31', '-8(r1)'], 0xdbe1fff8],
		['stfdx', ['f1', 'r3', 'r4'], 0x7c2325ae], ['stfdux', ['f1', 'r3', 'r4'], 0x7c2325ee],
		['stfiwx', ['f1', 'r3', 'r4'], 0x7c2327ae], ['stfiwx', ['f0', '0', 'r3'], 0x7c001fae],
		['fadd', ['f1', 'f2', 'f3'], 0xfc22182a], ['fadds', ['f1', 'f2', 'f3'], 0xec22182a], ['fadd.', ['f1', 'f2', 'f3'], 0xfc22182b],
		['fsub', ['f1', 'f2', 'f3'], 0xfc221828], ['fsubs', ['f1', 'f2', 'f3'], 0xec221828],
		['fdiv', ['f1', 'f2', 'f3'], 0xfc221824], ['fdivs', ['f1', 'f2', 'f3'], 0xec221824],
		['fmul', ['f1', 'f2', 'f4'], 0xfc220132], ['fmuls', ['f1', 'f2', 'f4'], 0xec220132],
		['fmadd', ['f1', 'f2', 'f4', 'f3'], 0xfc22193a], ['fmadds', ['f1', 'f2', 'f4', 'f3'], 0xec22193a],
		['fmsub', ['f1', 'f2', 'f4', 'f3'], 0xfc221938], ['fmsubs', ['f1', 'f2', 'f4', 'f3'], 0xec221938],
		['fnmadd', ['f1', 'f2', 'f4', 'f3'], 0xfc22193e], ['fnmadds', ['f1', 'f2', 'f4', 'f3'], 0xec22193e],
		['fnmsub', ['f1', 'f2', 'f4', 'f3'], 0xfc22193c], ['fnmsubs', ['f1', 'f2', 'f4', 'f3'], 0xec22193c],
		['fsqrt', ['f1', 'f3'], 0xfc20182c], ['fsqrts', ['f1', 'f3'], 0xec20182c],
		['fres', ['f1', 'f3'], 0xec201830], ['frsqrte', ['f1', 'f3'], 0xfc201834], ['fsel', ['f1', 'f2', 'f4', 'f3'], 0xfc22192e],
		['fmr', ['f1', 'f3'], 0xfc201890], ['fmr', ['f1', 'f31'], 0xfc20f890], ['fmr.', ['f1', 'f3'], 0xfc201891],
		['fneg', ['f1', 'f3'], 0xfc201850], ['fabs', ['f1', 'f3'], 0xfc201a10], ['fnabs', ['f1', 'f3'], 0xfc201910],
		['frsp', ['f1', 'f1'], 0xfc200818], ['fctiw', ['f1', 'f3'], 0xfc20181c], ['fctiwz', ['f0', 'f1'], 0xfc00081e],
		['fcmpu', ['cr7', 'f1', 'f2'], 0xff811000], ['fcmpo', ['cr0', 'f1', 'f2'], 0xfc011040],
		['mffs', ['f0'], 0xfc00048e], ['mffs.', ['f0'], 0xfc00048f], ['mcrfs', ['cr1', 'cr2'], 0xfc880080],
		['mtfsf', ['255', 'f0'], 0xfdfe058e], ['mtfsfi', ['7', '1'], 0xff80110c],
		['mtfsb0', ['31'], 0xffe0008c], ['mtfsb1', ['31'], 0xffe0004c],
	] as const)('%s %j encodes 0x%s', (name, operands, word) => {
		const bytes = encode(name, operands, { address: 0x1000, value: Number })
		expect(bytes).toEqual([word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255])
		const memory = new Uint8Array(8)
		memory.set(bytes)
		expect(decode(memory, 0).text.split(' ')[0]).toBe(name)
	})
	it('disassembles operands and rejects invalid forms', () => {
		const memory = new Uint8Array([0xfc, 0x22, 0x19, 0x3a, 0xc8, 0x23, 0xff, 0xf8])
		expect(decode(memory, 0).text).toBe('fmadd f1, f2, f4, f3')
		expect(decode(memory, 4).text).toBe('lfd f1, -8(r3)')
		const context = { address: 0x1000, value: Number }
		expect(() => encode('fadd', ['f1', 'f2', 'f32'], context)).toThrow(/f0–f31/)
		expect(() => encode('lfdu', ['f1', '8(r0)'], context)).toThrow(/update/)
		expect(() => encode('mtfsfi', ['7', '16'], context)).toThrow(/IMM/)
	})
})

describe('PowerPC floating-point semantics', () => {
	it('rounds single-precision results once from the exact value', () => {
		const c = cpu()
		set(c, 1, 1); set(c, 2, 2 ** -24 + 2 ** -60)
		run(c, 'fadds', ['f3', 'f1', 'f2'])
		// Double rounding (to double, then to single) would tie to even and give 1.
		expect(get(c, 3)).toBe(1 + 2 ** -23)
		expect(c.r[FPSCR] & (XX | FI | FR | FX)).toBe(XX | FI | FR | FX)
		run(c, 'fadd', ['f4', 'f1', 'f1'])
		expect(get(c, 4)).toBe(2)
		expect(c.r[FPSCR] & (FI | FR)).toBe(0)
		expect(c.r[FPSCR] & XX).toBe(XX)
		set(c, 5, 0.1); set(c, 6, 0.7)
		run(c, 'fmuls', ['f7', 'f5', 'f6'])
		expect(get(c, 7)).toBe(Math.fround(0.1 * 0.7))
	})
	it('fuses multiply-add with a single rounding and negates after rounding', () => {
		const c = cpu()
		set(c, 1, 1 + 2 ** -27); set(c, 2, -(1 + 2 ** -26))
		run(c, 'fmadd', ['f3', 'f1', 'f1', 'f2'])
		expect(get(c, 3)).toBe(2 ** -54)
		run(c, 'fnmadd', ['f4', 'f1', 'f1', 'f2'])
		expect(get(c, 4)).toBe(-(2 ** -54))
		run(c, 'fmul', ['f5', 'f1', 'f1']); run(c, 'fadd', ['f5', 'f5', 'f2'])
		expect(get(c, 5)).toBe(0)
	})
	it('honours every FPSCR[RN] rounding mode', () => {
		const c = cpu()
		set(c, 1, 1); set(c, 2, 3); set(c, 3, -1)
		const quotient = (mode: number, a = 1) => { run(c, 'mtfsfi', ['7', String(mode)]); run(c, 'fdiv', ['f4', `f${a}`, 'f2']); return getF(c, 4) }
		expect(quotient(0)).toBe(0x3fd5555555555555n)
		expect(quotient(1)).toBe(0x3fd5555555555555n)
		expect(quotient(2)).toBe(0x3fd5555555555556n)
		expect(quotient(3)).toBe(0x3fd5555555555555n)
		expect(quotient(3, 3)).toBe(0xbfd5555555555556n)
		expect(quotient(1, 3)).toBe(0xbfd5555555555555n)
		set(c, 5, 1); run(c, 'mtfsfi', ['7', '3']); run(c, 'fsub', ['f6', 'f5', 'f5'])
		expect(getF(c, 6)).toBe(1n << 63n) // x - x is -0 rounding toward minus infinity
	})
	it('classifies every result in FPRF', () => {
		const c = cpu()
		set(c, 1, 1); set(c, 2, -1); set(c, 3, 0); set(c, 4, 2 ** -1022); set(c, 5, 0.5); set(c, 6, Infinity)
		const cases: [string, string[], number][] = [
			['fadd', ['f7', 'f1', 'f1'], CLASS.positiveNormal], ['fadd', ['f7', 'f2', 'f2'], CLASS.negativeNormal],
			['fsub', ['f7', 'f1', 'f1'], CLASS.positiveZero], ['fmul', ['f7', 'f2', 'f3'], CLASS.negativeZero],
			['fmul', ['f7', 'f4', 'f5'], CLASS.positiveDenormal], ['fnmadd', ['f7', 'f4', 'f5', 'f3'], CLASS.negativeDenormal],
			['fdiv', ['f7', 'f1', 'f3'], CLASS.positiveInfinity], ['fdiv', ['f7', 'f2', 'f3'], CLASS.negativeInfinity],
			['fsub', ['f7', 'f6', 'f6'], CLASS.qnan],
		]
		for (const [name, operands, expected] of cases) { run(c, name, operands); expect(fprf(c), `${name} ${operands}`).toBe(expected) }
		// An exact tiny result does not underflow while UE is disabled.
		expect(c.r[FPSCR] & (UX | ZX | VXISI)).toBe(ZX | VXISI)
	})
	it('compares unordered NaNs differently in FCMPU and FCMPO', () => {
		const c = cpu()
		setF(c, 1, QNAN); set(c, 2, 1); set(c, 3, 2)
		run(c, 'fcmpu', ['cr3', 'f2', 'f3'])
		expect(cr(c, 3)).toBe(8); expect(fprf(c) & 15).toBe(8)
		run(c, 'fcmpu', ['cr3', 'f1', 'f2'])
		expect(cr(c, 3)).toBe(1); expect(c.r[FPSCR] & (FX | VX | VXVC)).toBe(0)
		run(c, 'fcmpo', ['cr2', 'f1', 'f2'])
		expect(cr(c, 2)).toBe(1); expect(c.r[FPSCR] & (FX | VX | VXVC | VXSNAN)).toBe(FX | VX | VXVC)
		const s = cpu(); setF(s, 1, SNAN); set(s, 2, 1)
		run(s, 'fcmpu', ['cr0', 'f1', 'f2'])
		expect(s.r[FPSCR] & (VXSNAN | VXVC)).toBe(VXSNAN)
		run(s, 'fcmpo', ['cr0', 'f1', 'f2'])
		expect(s.r[FPSCR] & (VXSNAN | VXVC)).toBe(VXSNAN | VXVC)
		const enabled = cpu(); enabled.r[FPSCR] = VE; setF(enabled, 1, SNAN)
		run(enabled, 'fcmpo', ['cr0', 'f1', 'f2'])
		expect(enabled.r[FPSCR] & (VXSNAN | VXVC | FEX)).toBe(VXSNAN | FEX)
	})
	it('propagates and quiets NaN operands in A, B, C order', () => {
		const c = cpu()
		setF(c, 1, 0x7ff0000000000123n); setF(c, 2, 0xfff8000000000456n); set(c, 3, 1)
		run(c, 'fmadd', ['f4', 'f3', 'f2', 'f1'])
		expect(getF(c, 4)).toBe(0x7ff8000000000123n)
		expect(c.r[FPSCR] & VXSNAN).toBe(VXSNAN)
		run(c, 'fadd', ['f4', 'f2', 'f1'])
		expect(getF(c, 4)).toBe(0xfff8000000000456n)
		set(c, 5, 0); set(c, 6, Infinity)
		run(c, 'fmul', ['f4', 'f5', 'f6'])
		expect(getF(c, 4)).toBe(0x7ff8000000000000n)
		expect(c.r[FPSCR] & VXIMZ).toBe(VXIMZ)
	})
	it('converts to words with rounding, truncation and saturation', () => {
		const c = cpu()
		const word = (name: string, value: number) => { c.r[FPSCR] = 0; set(c, 1, value); run(c, name, ['f2', 'f1']); return c.r[FPR + 5] | 0 }
		expect(word('fctiw', 2.5)).toBe(2)
		expect(word('fctiw', 3.5)).toBe(4)
		expect(c.r[FPSCR] & (XX | FI | FR)).toBe(XX | FI | FR)
		expect(word('fctiwz', -2.7)).toBe(-2)
		expect(word('fctiw', 7)).toBe(7)
		expect(c.r[FPSCR]).toBe(0)
		expect(word('fctiw', 3e9)).toBe(0x7fffffff)
		expect(c.r[FPSCR] & (VXCVI | VX | FX)).toBe(VXCVI | VX | FX)
		expect(word('fctiw', -3e9)).toBe(-0x80000000)
		expect(word('fctiw', -Infinity)).toBe(-0x80000000)
		expect(word('fctiw', NaN)).toBe(-0x80000000)
		c.r[FPSCR] = 3; set(c, 1, 2.5); run(c, 'fctiw', ['f2', 'f1'])
		expect(c.r[FPR + 5]).toBe(2)
	})
	it('keeps sticky bits, sets FX only on new exceptions and copies FX/FEX/VX/OX to CR1', () => {
		const c = cpu()
		set(c, 1, 1); set(c, 2, 3); set(c, 3, Infinity)
		run(c, 'fdiv', ['f4', 'f1', 'f2'])
		expect(c.r[FPSCR] & (FX | XX)).toBe(FX | XX)
		run(c, 'mtfsb0', ['0'])
		run(c, 'fdiv', ['f4', 'f1', 'f2'])
		expect(c.r[FPSCR] & (FX | XX)).toBe(XX)
		run(c, 'fsub.', ['f4', 'f3', 'f3'])
		expect(cr(c, 1)).toBe(0b1010)
		run(c, 'fmr.', ['f5', 'f1'])
		expect(cr(c, 1)).toBe(0b1010)
		run(c, 'mtfsfi', ['6', '1']) // field 6 holds VE, OE, UE, ZE: enable only ZE
		set(c, 6, 0); set(c, 7, 42)
		run(c, 'fdiv.', ['f7', 'f1', 'f6'])
		expect(get(c, 7)).toBe(42)
		expect(c.r[FPSCR] & (ZX | FEX)).toBe(ZX | FEX)
		expect(cr(c, 1)).toBe(0b1110)
	})
	it('adjusts overflow exponents when OE is enabled', () => {
		const c = cpu()
		set(c, 1, 2 ** 1000)
		run(c, 'fmul', ['f2', 'f1', 'f1'])
		expect(get(c, 2)).toBe(Infinity)
		expect(c.r[FPSCR] & (OX | XX)).toBe(OX | XX)
		run(c, 'mtfsb1', ['25'])
		run(c, 'fmul', ['f2', 'f1', 'f1'])
		expect(get(c, 2)).toBe(2 ** 464)
		const u = cpu()
		set(u, 1, 2 ** -600); set(u, 2, 2 ** -600 * (1 + 2 ** -52))
		run(u, 'fmul', ['f3', 'f1', 'f2'])
		expect(u.r[FPSCR] & (UX | XX)).toBe(UX | XX)
		u.r[FPSCR] = 0x20 // UE
		run(u, 'fmul', ['f3', 'f1', 'f2'])
		expect(get(u, 3)).toBe(2 ** 336 * (1 + 2 ** -52))
		expect(u.r[FPSCR] & (UX | XX | FEX)).toBe(UX | FEX)
	})
	it('writes FPSCR fields with MTFSF, MTFSFI, MTFSB1 and MCRFS', () => {
		const c = cpu()
		setF(c, 1, 0x60000003n) // FEX and VX cannot be set explicitly
		run(c, 'mtfsf', ['255', 'f1'])
		expect(c.r[FPSCR]).toBe(3)
		setF(c, 1, 0x90000000n)
		run(c, 'mtfsf', ['1', 'f1']) // field 7 only
		expect(c.r[FPSCR]).toBe(0)
		run(c, 'mtfsf', ['128', 'f1']) // field 0 sets FX and OX explicitly
		expect(c.r[FPSCR]).toBe((FX | OX) >>> 0)
		run(c, 'mtfsb1', ['7']) // VXSNAN: a new exception sets FX
		expect(c.r[FPSCR] & (VXSNAN | VX)).toBe(VXSNAN | VX)
		run(c, 'mcrfs', ['cr4', 'cr0'])
		expect(cr(c, 4)).toBe(0b1011)
		expect(c.r[FPSCR] & (FX | OX)).toBe(0)
		expect(c.r[FPSCR] & VX).toBe(VX)
		run(c, 'mcrfs', ['cr5', 'cr1'])
		expect(c.r[FPSCR]).toBe(0)
		c.r[FPSCR] = 0x1234
		run(c, 'mffs', ['f8'])
		expect(c.r[FPR + 17]).toBe(0x1234)
	})
	it('loads, stores and converts singles without rounding', () => {
		const c = cpu()
		c.r[3] = 0x2000
		c.write(0x2000, 0x00000001) // smallest single denormal
		run(c, 'lfs', ['f1', '0(r3)'])
		expect(get(c, 1)).toBe(2 ** -149)
		c.write(0x2000, 0x7f800001) // SNaN payload survives conversion
		run(c, 'lfs', ['f2', '0(r3)'])
		expect(getF(c, 2)).toBe(0x7ff0000020000000n)
		set(c, 3, 1 + 2 ** -23 + 2 ** -24 + 2 ** -30) // stfs truncates
		run(c, 'stfs', ['f3', '4(r3)'])
		expect(c.read(0x2004)).toBe(0x3f800001)
		set(c, 4, 2 ** -140)
		run(c, 'stfs', ['f4', '8(r3)'])
		expect(c.read(0x2008)).toBe(0x00000200)
		c.r[4] = 16
		run(c, 'stfdux', ['f3', 'r3', 'r4'])
		expect(c.r[3]).toBe(0x2010)
		expect(c.readWide(0x2010)).toBe(bitsOf(1 + 2 ** -23 + 2 ** -24 + 2 ** -30))
		run(c, 'lfd', ['f5', '0(r3)'])
		expect(getF(c, 5)).toBe(getF(c, 3))
		setF(c, 3, 0xfff80000deadbeefn)
		run(c, 'stfiwx', ['f3', '0', 'r3'])
		expect(c.read(0x2010)).toBe(0xdeadbeef)
		c.r[3] = 0x2002
		expect(() => run(c, 'lfs', ['f1', '0(r3)'])).toThrow(/aligned/)
	})
	it('implements moves, select, square root and estimates', () => {
		const c = cpu()
		setF(c, 1, SNAN); set(c, 2, -0); set(c, 3, 10); set(c, 4, 20); set(c, 5, 2); set(c, 6, -4)
		run(c, 'fneg', ['f7', 'f1'])
		expect(getF(c, 7)).toBe(SNAN | 1n << 63n)
		expect(c.r[FPSCR]).toBe(0)
		run(c, 'fsel', ['f7', 'f2', 'f3', 'f4'])
		expect(get(c, 7)).toBe(10)
		run(c, 'fsel', ['f7', 'f1', 'f3', 'f4'])
		expect(get(c, 7)).toBe(20)
		run(c, 'fsqrt', ['f7', 'f5'])
		expect(get(c, 7)).toBe(Math.SQRT2)
		run(c, 'fsqrts', ['f7', 'f5'])
		expect(get(c, 7)).toBe(Math.fround(Math.SQRT2))
		run(c, 'fsqrt', ['f7', 'f6'])
		expect(Number.isNaN(get(c, 7))).toBe(true)
		run(c, 'fres', ['f7', 'f3'])
		expect(get(c, 7)).toBe(Math.fround(0.1))
		set(c, 8, 4); run(c, 'frsqrte', ['f7', 'f8'])
		expect(get(c, 7)).toBe(0.5)
		run(c, 'frsp', ['f7', 'f3'])
		expect(get(c, 7)).toBe(10)
	})
})

describe('PowerPC floating-point machine', () => {
	const services = () => powerpc.createServices()
	const load = (code: string) => {
		const s = services(), settings = powerpc.settings.defaults
		const program = s.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics).toEqual([])
		return { s, machine: s.createMachine(program, settings, { speed: null, historyLimit: 1000 }) }
	}
	it('steps back to the exact FPR and FPSCR state', () => {
		const { s, machine } = load(`
.text
	lis r9, 1
	lfd f1, 0(r9)
	lfd f2, 8(r9)
	fdiv. f3, f1, f2
	fsub f4, f3, f3
	mtfsfi 7, 3
	fdivs f5, f1, f2
	fsqrt f6, f2
	fctiw f7, f6
	stfd f5, 16(r9)
	mtfsb1 24
	fsub f8, f6, f6
	li r0, 10
	sc
.data
	.long 0x3ff00000, 0, 0xc0080000, 0, 0, 0
`)
		try {
			const snapshots = [{ registers: machine.registerValues(), word: machine.inspectMemory().word(0x10014) }]
			while (!machine.halted) { machine.step(); snapshots.push({ registers: machine.registerValues(), word: machine.inspectMemory().word(0x10014) }) }
			const final = machine.registerValues()
			expect(final.f3).toBe(0xbfd5555555555555n)
			expect(Number(final.fpscr) & 3).toBe(3)
			expect(Number(final.fpscr) & 0x80).toBe(0x80)
			for (let i = snapshots.length - 2; i >= 0; i--) {
				expect(machine.stepBack()).toBe(true)
				expect(machine.registerValues(), `step ${i}`).toEqual(snapshots[i].registers)
				expect(machine.inspectMemory().word(0x10014)).toBe(snapshots[i].word)
			}
			expect(machine.registerValues().fpscr).toBe(0)
		} finally { s.dispose() }
	})
	it('exposes 64-bit float registers and normalizes FPSCR edits', () => {
		const { s, machine } = load('li r0, 10\nsc')
		try {
			const f1 = powerpc.registers.find(register => register.id === 'f1')!
			expect(f1).toMatchObject({ bits: 64, bank: 'float' })
			expect(machine.writeRegister('f1', 0x400921fb54442d18n)).toBe(true)
			expect(machine.registerValues().f1).toBe(0x400921fb54442d18n)
			expect(machine.writeRegister('fpscr', 0x60000000 | VE)).toBe(true)
			expect(machine.registerValues().fpscr).toBe(VE)
		} finally { s.dispose() }
	})
	it('runs the floating-point example', () => {
		const { s, machine } = load(powerpc.examples.floatingpoint.code)
		try {
			for (let i = 0; i < 1000 && !machine.halted; i++) machine.step()
			expect(machine.halted).toBe(true)
			expect(machine.console).toBe('45 1')
			expect(powerpc.examples.floatingpoint.name).toBe('Floating-point Arithmetic')
		} finally { s.dispose() }
	})
})
