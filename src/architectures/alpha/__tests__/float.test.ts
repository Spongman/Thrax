import { describe, expect, it } from 'vitest'
import type { CpuContext } from '../../../core/configuredCpu'
import { decode, encode } from '../isa'
import { FPCR, FPCR_RESET, TWO } from '../float'
import definition from '../index'

function cpu(): CpuContext {
	const memory = new Uint8Array(0x10000), view = new DataView(memory.buffer)
	const context: CpuContext = {
		state: new Uint32Array(), writeState() { throw new Error('Unused internal state') },
		r: new Uint32Array(), w: new BigUint64Array(65), memory, instructionAddress: 0x1000, pc: 0x1004,
		read(a, n = 4, le = true) { return n === 1 ? view.getUint8(a) : n === 2 ? view.getUint16(a, le) : view.getUint32(a, le) },
		write(a, v, n = 4, le = true) { if (n === 1) view.setUint8(a, v); else if (n === 2) view.setUint16(a, v, le); else view.setUint32(a, v, le) },
		readWide(a, le) { return view.getBigUint64(a, le) }, writeWide(a, v, le) { view.setBigUint64(a, v, le) },
		call(target) { context.pc = target }, ret(target) { context.pc = target }, halt() {}, output() {}, inputInteger() { return 0 },
		branch(target, taken) { context.pc = taken ? target : 0x1004 }, segmentAddress(segment, offset) { return segment * 16 + offset },
		readSegment() { throw new Error('Unused') }, writeSegment() { throw new Error('Unused') },
	}
	context.w[FPCR] = FPCR_RESET
	return context
}
function run(c: CpuContext, name: string, operands: string[]) {
	c.memory.set(encode(name, operands, { address: 0x1000, value: Number }), 0x1000)
	c.pc = 0x1004
	decode(c.memory, 0x1000).execute(c)
}
const F = 32
const scratch = new DataView(new ArrayBuffer(8))
/** Host doubles give independent T bits; Math.fround gives independent S values. */
function t(value: number): bigint { scratch.setFloat64(0, value); return scratch.getBigUint64(0) }
const s = (value: number) => t(Math.fround(value))
const bit = (n: number) => 1n << BigInt(n)
const INV = bit(52), DZE = bit(53), OVF = bit(54), UNF = bit(55), INE = bit(56), IOV = bit(57), SUM = bit(63)
const INVD = bit(49), DZED = bit(50), OVFD = bit(51), UNDZ = bit(60), UNFD = bit(61)

describe('Alpha floating-point encodings', () => {
	// Opcode/function codes from Alpha Architecture Handbook v4, appendix C.
	it.each([
		['adds', ['$f1', '$f2', '$f3'], 0x58221003],
		['subs', ['$f1', '$f2', '$f3'], 0x58221023],
		['muls', ['$f1', '$f2', '$f3'], 0x58221043],
		['divs', ['$f1', '$f2', '$f3'], 0x58221063],
		['addt', ['$f1', '$f2', '$f3'], 0x58221403],
		['subt', ['$f1', '$f2', '$f3'], 0x58221423],
		['mult', ['$f1', '$f2', '$f3'], 0x58221443],
		['divt', ['$f1', '$f2', '$f3'], 0x58221463],
		['cmptun', ['$f1', '$f2', '$f3'], 0x58221483],
		['cmpteq', ['$f1', '$f2', '$f3'], 0x582214a3],
		['cmptlt', ['$f1', '$f2', '$f3'], 0x582214c3],
		['cmptle', ['$f1', '$f2', '$f3'], 0x582214e3],
		['addt/c', ['$f1', '$f2', '$f3'], 0x58220403],
		['addt/m', ['$f1', '$f2', '$f3'], 0x58220c03],
		['addt/d', ['$f1', '$f2', '$f3'], 0x58221c03],
		['addt/u', ['$f1', '$f2', '$f3'], 0x58223403],
		['addt/uc', ['$f1', '$f2', '$f3'], 0x58222403],
		['addt/um', ['$f1', '$f2', '$f3'], 0x58222c03],
		['addt/ud', ['$f1', '$f2', '$f3'], 0x58223c03],
		['addt/su', ['$f1', '$f2', '$f3'], 0x5822b403],
		['addt/suc', ['$f1', '$f2', '$f3'], 0x5822a403],
		['addt/sum', ['$f1', '$f2', '$f3'], 0x5822ac03],
		['addt/sud', ['$f1', '$f2', '$f3'], 0x5822bc03],
		['addt/sui', ['$f1', '$f2', '$f3'], 0x5822f403],
		['addt/suic', ['$f1', '$f2', '$f3'], 0x5822e403],
		['addt/suim', ['$f1', '$f2', '$f3'], 0x5822ec03],
		['addt/suid', ['$f1', '$f2', '$f3'], 0x5822fc03],
		['divs/sui', ['$f1', '$f2', '$f3'], 0x5822f063],
		['cmpteq/su', ['$f1', '$f2', '$f3'], 0x5822b4a3],
		['cmptlt/su', ['$f1', '$f2', '$f3'], 0x5822b4c3],
		['cpys', ['$f1', '$f2', '$f3'], 0x5c220403],
		['cpysn', ['$f1', '$f2', '$f3'], 0x5c220423],
		['cpyse', ['$f1', '$f2', '$f3'], 0x5c220443],
		['fcmoveq', ['$f1', '$f2', '$f3'], 0x5c220543],
		['fcmovne', ['$f1', '$f2', '$f3'], 0x5c220563],
		['fcmovlt', ['$f1', '$f2', '$f3'], 0x5c220583],
		['fcmovge', ['$f1', '$f2', '$f3'], 0x5c2205a3],
		['fcmovle', ['$f1', '$f2', '$f3'], 0x5c2205c3],
		['fcmovgt', ['$f1', '$f2', '$f3'], 0x5c2205e3],
		['cvtts', ['$f1', '$f2'], 0x5be11582],
		['cvtts/sui', ['$f1', '$f2'], 0x5be1f582],
		['cvtst', ['$f1', '$f2'], 0x5be15582],
		['cvtst/s', ['$f1', '$f2'], 0x5be1d582],
		['cvttq', ['$f1', '$f2'], 0x5be115e2],
		['cvttq/c', ['$f1', '$f2'], 0x5be105e2],
		['cvttq/m', ['$f1', '$f2'], 0x5be10de2],
		['cvttq/d', ['$f1', '$f2'], 0x5be11de2],
		['cvttq/v', ['$f1', '$f2'], 0x5be135e2],
		['cvttq/vc', ['$f1', '$f2'], 0x5be125e2],
		['cvttq/sv', ['$f1', '$f2'], 0x5be1b5e2],
		['cvttq/svc', ['$f1', '$f2'], 0x5be1a5e2],
		['cvttq/svi', ['$f1', '$f2'], 0x5be1f5e2],
		['cvttq/svic', ['$f1', '$f2'], 0x5be1e5e2],
		['cvtqs', ['$f1', '$f2'], 0x5be11782],
		['cvtqs/c', ['$f1', '$f2'], 0x5be10782],
		['cvtqs/sui', ['$f1', '$f2'], 0x5be1f782],
		['cvtqt', ['$f1', '$f2'], 0x5be117c2],
		['cvtqt/m', ['$f1', '$f2'], 0x5be10fc2],
		['cvtqt/d', ['$f1', '$f2'], 0x5be11fc2],
		['cvtqt/suid', ['$f1', '$f2'], 0x5be1ffc2],
		['sqrts', ['$f1', '$f2'], 0x53e11162],
		['sqrtt', ['$f1', '$f2'], 0x53e11562],
		['sqrtt/sui', ['$f1', '$f2'], 0x53e1f562],
		['mf_fpcr', ['$f1'], 0x5c2104a1],
		['mt_fpcr', ['$f1'], 0x5c210481],
		['itofs', ['$1', '$f2'], 0x503f0082],
		['itoft', ['$1', '$f2'], 0x503f0482],
		['ftois', ['$f1', '$2'], 0x703f0f02],
		['ftoit', ['$f1', '$2'], 0x703f0e02],
		['fmov', ['$f1', '$f2'], 0x5c210402],
		['fneg', ['$f1', '$f2'], 0x5c210422],
		['fabs', ['$f1', '$f2'], 0x5fe10402],
		['fclr', ['$f2'], 0x5fff0402],
		['fnop', [], 0x5fff041f],
		['lds', ['$f1', '-8($30)'], 0x883efff8],
		['ldt', ['$f1', '-8($30)'], 0x8c3efff8],
		['sts', ['$f1', '-8($30)'], 0x983efff8],
		['stt', ['$f1', '-8($30)'], 0x9c3efff8],
		['fbeq', ['$f1', '0xff8'], 0xc43ffffd],
		['fblt', ['$f1', '0xff8'], 0xc83ffffd],
		['fble', ['$f1', '0xff8'], 0xcc3ffffd],
		['fbne', ['$f1', '0xff8'], 0xd43ffffd],
		['fbge', ['$f1', '0xff8'], 0xd83ffffd],
		['fbgt', ['$f1', '0xff8'], 0xdc3ffffd],
	] as const)('encodes %s as the manual word', (name, operands, word) => {
		const bytes = encode(name, operands, { address: 0x1000, value: Number })
		expect(bytes).toEqual([word & 255, word >>> 8 & 255, word >>> 16 & 255, word >>> 24])
		// Aliases disassemble as their native instruction.
		const text = decode(Uint8Array.from([...new Uint8Array(0x1000), ...bytes]), 0x1000).text
		expect(text.split(' ')[0]).toBe(['fmov', 'fabs', 'fclr', 'fnop'].includes(name) ? 'cpys' : name === 'fneg' ? 'cpysn' : name)
	})
	it('disassembles operands and rejects integer registers in float positions', () => {
		const at = (bytes: number[]) => decode(Uint8Array.from([...new Uint8Array(0x1000), ...bytes]), 0x1000).text
		expect(at(encode('cvttq/svc', ['$f1', '$f2'], { address: 0x1000, value: Number }))).toBe('cvttq/svc $f1, $f2')
		expect(at(encode('lds', ['$f1', '-8($30)'], { address: 0x1000, value: Number }))).toBe('lds $f1, -8($30)')
		expect(at(encode('ftois', ['$f1', '$2'], { address: 0x1000, value: Number }))).toBe('ftois $f1, $2')
		expect(() => encode('addt', ['$1', '$f2', '$f3'], { address: 0x1000, value: Number })).toThrow(/floating-point register/)
		expect(() => encode('cmpteq/c', ['$f1', '$f2', '$f3'], { address: 0x1000, value: Number })).toThrow(/Unsupported/)
	})
})

describe('Alpha floating-point semantics', () => {
	it('maps S_floating memory to and from the T register layout', () => {
		const c = cpu()
		c.w[30] = 0x8000n
		for (const [memory, register] of [[0x3fc00000, 0x3ff8000000000000n], [0x00800000, 0x3810000000000000n], [0x7f7fffff, 0x47efffffe0000000n], [0xff800000, 0xfff0000000000000n], [0x00000001, 0x0000000020000000n], [0x80000000, 0x8000000000000000n]] as const) {
			c.write(0x8000, memory, 4, true)
			run(c, 'lds', ['$f1', '0($30)'])
			expect(c.w[F + 1]).toBe(register)
			c.write(0x8000, 0, 4, true)
			run(c, 'sts', ['$f1', '0($30)'])
			expect(c.read(0x8000, 4, true)).toBe(memory)
		}
		c.writeWide(0x8000, 0x400921fb54442d18n, true)
		run(c, 'ldt', ['$f2', '0($30)'])
		expect(c.w[F + 2]).toBe(0x400921fb54442d18n)
		run(c, 'stt', ['$f2', '8($30)'])
		expect(c.readWide(0x8008, true)).toBe(0x400921fb54442d18n)
		expect(() => run(c, 'ldt', ['$f2', '4($30)'])).toThrow(/Unaligned/)
	})
	it('rounds S results to single precision and honours rounding qualifiers', () => {
		const c = cpu()
		c.w[F + 1] = t(1); c.w[F + 2] = t(3)
		run(c, 'divs', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(s(1 / 3))
		scratch.setFloat32(0, 1 / 3)
		const nearest = scratch.getUint32(0)
		expect(nearest).toBe(0x3eaaaaab)
		scratch.setUint32(0, nearest - 1)
		run(c, 'divs/c', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(t(scratch.getFloat32(0)))
		run(c, 'divt', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(0x3fd5555555555555n)
		run(c, 'divt/m', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(0x3fd5555555555555n)
		c.w[FPCR] = 3n << 58n
		run(c, 'divt/d', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(0x3fd5555555555556n)
		c.w[F + 1] = t(-1)
		run(c, 'divt/m', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(0xbfd5555555555556n)
		c.w[F + 1] = t(1.5); c.w[F + 2] = t(2.25)
		for (const [name, value] of [['adds', 3.75], ['subs', -0.75], ['muls', 3.375], ['addt', 3.75], ['subt', -0.75], ['mult', 3.375]] as const) {
			run(c, name, ['$f1', '$f2', '$f3'])
			expect(c.w[F + 3], name).toBe(t(value))
		}
		c.w[F + 1] = t(2)
		run(c, 'sqrtt', ['$f1', '$f3'])
		expect(c.w[F + 3]).toBe(t(Math.SQRT2))
		run(c, 'sqrts', ['$f1', '$f3'])
		expect(c.w[F + 3]).toBe(s(Math.SQRT2))
	})
	it('compares to 2.0 or 0.0, with NaN unordered and LT/LE invalid', () => {
		const c = cpu(), nan = 0x7ff8000000000001n
		c.w[F + 1] = t(1); c.w[F + 2] = t(2); c.w[F + 4] = nan; c.w[F + 5] = t(-0); c.w[F + 6] = t(0)
		const compare = (name: string, a: number, b: number) => { run(c, name, [`$f${a}`, `$f${b}`, '$f3']); return c.w[F + 3] }
		expect(compare('cmptlt', 1, 2)).toBe(TWO)
		expect(TWO).toBe(t(2))
		expect(compare('cmptle', 2, 1)).toBe(0n)
		expect(compare('cmpteq', 5, 6)).toBe(TWO)
		expect(compare('cmptun', 1, 2)).toBe(0n)
		expect(compare('cmptun', 4, 1)).toBe(TWO)
		expect(compare('cmpteq', 4, 4)).toBe(0n)
		expect(c.w[FPCR]).toBe(FPCR_RESET)
		expect(() => compare('cmptlt', 4, 1)).toThrow(/invalid operation/)
		c.w[FPCR] |= INVD
		expect(compare('cmptle/su', 1, 4)).toBe(0n)
		expect(c.w[FPCR]).toBe(FPCR_RESET | INVD | INV | SUM)
	})
	it('converts T to quadword with truncation, rounding and overflow', () => {
		const c = cpu()
		const convert = (name: string, value: number) => { c.w[F + 1] = t(value); run(c, name, ['$f1', '$f2']); return c.w[F + 2] }
		expect(convert('cvttq/c', 2.75)).toBe(2n)
		expect(convert('cvttq/c', -2.75)).toBe(0xfffffffffffffffen)
		expect(convert('cvttq', 2.5)).toBe(2n)
		expect(convert('cvttq', 3.5)).toBe(4n)
		expect(convert('cvttq/m', -2.25)).toBe(0xfffffffffffffffdn)
		expect(c.w[FPCR] & (IOV | INE)).toBe(INE)
		c.w[FPCR] = FPCR_RESET
		expect(convert('cvttq/c', 2 ** 64 + 2 ** 13)).toBe(0x2000n)
		expect(c.w[FPCR]).toBe(FPCR_RESET | IOV | INE | SUM)
		expect(() => convert('cvttq/vc', 2 ** 63)).toThrow(/integer overflow/)
		expect(convert('cvttq/vc', -(2 ** 63))).toBe(0x8000000000000000n)
		expect(() => convert('cvttq/c', NaN)).toThrow(/invalid operation/)
		expect(() => convert('cvttq/svic', 0.5)).toThrow(/inexact/)
		c.w[F + 1] = 0xfffffffffffffffbn
		run(c, 'cvtqt', ['$f1', '$f2'])
		expect(c.w[F + 2]).toBe(t(-5))
		c.w[F + 1] = 0x1000001n
		run(c, 'cvtqs/c', ['$f1', '$f2'])
		expect(c.w[F + 2]).toBe(t(0x1000000))
		c.w[F + 1] = t(1 / 3)
		run(c, 'cvtts', ['$f1', '$f2'])
		expect(c.w[F + 2]).toBe(s(1 / 3))
		c.w[F + 1] = 0x0000000020000000n
		run(c, 'cvtst', ['$f1', '$f2'])
		expect(c.w[F + 2]).toBe(t(2 ** -149))
	})
	it('copies signs and exponents, and moves conditionally on bit tests', () => {
		const c = cpu()
		c.w[F + 1] = t(-1); c.w[F + 2] = t(2); c.w[F + 4] = t(-4); c.w[F + 5] = t(1.5)
		run(c, 'cpys', ['$f1', '$f2', '$f3']); expect(c.w[F + 3]).toBe(t(-2))
		run(c, 'cpysn', ['$f1', '$f2', '$f3']); expect(c.w[F + 3]).toBe(t(2))
		run(c, 'cpyse', ['$f4', '$f5', '$f3']); expect(c.w[F + 3]).toBe(t(-6))
		run(c, 'fneg', ['$f2', '$f3']); expect(c.w[F + 3]).toBe(t(-2))
		run(c, 'fabs', ['$f1', '$f3']); expect(c.w[F + 3]).toBe(t(1))
		run(c, 'fmov', ['$f4', '$f3']); expect(c.w[F + 3]).toBe(t(-4))
		run(c, 'fclr', ['$f3']); expect(c.w[F + 3]).toBe(0n)
		c.w[F + 6] = t(-0)
		for (const [name, moved] of [['fcmoveq', true], ['fcmovne', false], ['fcmovlt', false], ['fcmovge', true], ['fcmovle', true], ['fcmovgt', false]] as const) {
			c.w[F + 3] = t(7)
			run(c, name, ['$f6', '$f2', '$f3'])
			expect(c.w[F + 3], name).toBe(moved ? t(2) : t(7))
		}
		c.w[F + 3] = t(7)
		run(c, 'fcmovgt', ['$f5', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(t(2))
		run(c, 'addt', ['$f1', '$f2', '$f31'])
		expect(c.w[F + 31]).toBe(0n)
		c.w[F + 31] = t(9)
		run(c, 'fmov', ['$f31', '$f3'])
		expect(c.w[F + 3]).toBe(0n)
	})
	it('branches on -0.0 as zero', () => {
		const c = cpu()
		c.w[F + 1] = t(-0)
		for (const [name, taken] of [['fbeq', true], ['fbne', false], ['fblt', false], ['fbge', true], ['fble', true], ['fbgt', false]] as const) {
			run(c, name, ['$f1', '0x2000'])
			expect(c.pc, name).toBe(taken ? 0x2000 : 0x1004)
		}
		c.w[F + 1] = t(-1)
		run(c, 'fblt', ['$f1', '0x2000'])
		expect(c.pc).toBe(0x2000)
	})
	it('keeps sticky FPCR status, disables, dynamic rounding and NaN payloads', () => {
		const c = cpu()
		c.w[F + 1] = 0xffffffffffffffffn
		run(c, 'mt_fpcr', ['$f1'])
		expect(c.w[FPCR]).toBe(0xffff000000000000n)
		run(c, 'mf_fpcr', ['$f2'])
		expect(c.w[F + 2]).toBe(0xffff000000000000n)
		c.w[FPCR] = FPCR_RESET
		c.w[F + 1] = t(1); c.w[F + 2] = t(0)
		expect(() => run(c, 'divt', ['$f1', '$f2', '$f3'])).toThrow(/division by zero/)
		expect(c.w[FPCR]).toBe(FPCR_RESET)
		c.w[FPCR] |= DZED
		expect(() => run(c, 'divt', ['$f1', '$f2', '$f3'])).toThrow(/division by zero/)
		run(c, 'divt/su', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(t(Infinity))
		expect(c.w[FPCR]).toBe(FPCR_RESET | DZED | DZE | SUM)
		c.w[F + 1] = t(1e300)
		expect(() => run(c, 'mult/su', ['$f1', '$f1', '$f3'])).toThrow(/overflow/)
		c.w[FPCR] |= OVFD
		run(c, 'mult/su', ['$f1', '$f1', '$f3'])
		expect(c.w[F + 3]).toBe(t(Infinity))
		expect(c.w[FPCR] & (OVF | INE)).toBe(OVF | INE)
		run(c, 'mult/suc', ['$f1', '$f1', '$f3'])
		expect(c.w[F + 3]).toBe(t(Number.MAX_VALUE))
		c.w[FPCR] = FPCR_RESET
		c.w[F + 1] = t(1e-300)
		run(c, 'mult', ['$f1', '$f1', '$f3'])
		expect(c.w[F + 3]).toBe(0n)
		expect(c.w[FPCR]).toBe(FPCR_RESET | UNF | INE | SUM)
		c.w[F + 1] = t(2 ** -1000); c.w[F + 2] = t(2 ** -60)
		expect(() => run(c, 'mult/u', ['$f1', '$f2', '$f3'])).toThrow(/underflow/)
		c.w[FPCR] |= UNFD
		run(c, 'mult/su', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(t(2 ** -1060))
		c.w[FPCR] |= UNDZ
		run(c, 'mult/su', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(0n)
		c.w[FPCR] = FPCR_RESET
		c.w[F + 1] = t(1); c.w[F + 2] = t(3)
		expect(() => run(c, 'divt/sui', ['$f1', '$f2', '$f3'])).toThrow(/inexact/)
		run(c, 'addt/sui', ['$f1', '$f2', '$f3'])
		expect(c.w[F + 3]).toBe(t(4))
		c.w[F + 4] = 0x7ff8000000000123n; c.w[F + 5] = 0x7ff0000000000456n
		run(c, 'addt', ['$f1', '$f4', '$f3'])
		expect(c.w[F + 3]).toBe(0x7ff8000000000123n)
		expect(() => run(c, 'addt', ['$f1', '$f5', '$f3'])).toThrow(/invalid operation/)
		c.w[FPCR] |= INVD
		run(c, 'addt/su', ['$f5', '$f4', '$f3'])
		expect(c.w[F + 3]).toBe(0x7ff8000000000456n)
		expect(c.w[FPCR] & INV).toBe(INV)
		c.w[F + 6] = t(Infinity)
		run(c, 'subt/su', ['$f6', '$f6', '$f3'])
		expect(c.w[F + 3]).toBe(0x7ff8000000000000n)
	})
	it('moves between register files with the FIX extension', () => {
		const c = cpu()
		c.w[1] = 0x3fc00000n
		run(c, 'itofs', ['$1', '$f1'])
		expect(c.w[F + 1]).toBe(t(1.5))
		c.w[F + 2] = t(-1.5)
		run(c, 'ftois', ['$f2', '$3'])
		expect(c.w[3]).toBe(0xffffffffbfc00000n)
		c.w[1] = 0x400921fb54442d18n
		run(c, 'itoft', ['$1', '$f4'])
		expect(c.w[F + 4]).toBe(0x400921fb54442d18n)
		run(c, 'ftoit', ['$f4', '$5'])
		expect(c.w[5]).toBe(0x400921fb54442d18n)
		c.w[F + 1] = t(-1)
		expect(() => run(c, 'sqrtt', ['$f1', '$f2'])).toThrow(/invalid operation/)
	})
})

describe('Alpha floating-point workbench', () => {
	const load = (code: string) => {
		const services = definition.createServices(), settings = definition.settings.defaults
		const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics).toEqual([])
		return { services, machine: services.createMachine(program, settings, { speed: null, historyLimit: 100000 }) }
	}
	it('steps back to the exact float registers and FPCR', () => {
		const { services, machine } = load('.text\nldah $1, 1($31)\nldt $f1, 0($1)\ncvtqt $f1, $f1\nlda $2, 3($31)\nitoft $2, $f2\ncvtqt $f2, $f2\ndivt $f1, $f2, $f3\ncvtts $f3, $f4\nmult/d $f3, $f4, $f5\ncmptlt $f4, $f3, $f6\ncall_pal 0\n.data\n.quad 1')
		try {
			const snapshots = []
			expect(machine.registerValues().fpcr).toBe(FPCR_RESET)
			while (!machine.halted) { snapshots.push(machine.registerValues()); machine.step() }
			const final = machine.registerValues()
			expect(final.f3).toBe(t(1 / 3))
			expect(final.f4).toBe(s(1 / 3))
			expect(final.f5).toBe(t(1 / 3 * Math.fround(1 / 3)))
			expect(final.fpcr).toBe(FPCR_RESET | INE | SUM)
			for (let i = snapshots.length - 1; i >= 0; i--) { machine.stepBack(); expect(machine.registerValues(), `step ${i}`).toEqual(snapshots[i]) }
			while (!machine.halted) machine.step()
			expect(machine.registerValues()).toEqual(final)
			expect(machine.writeRegister('f31', 1n)).toBe(false)
			expect(machine.writeRegister('fpcr', 0xffffffffffffffffn)).toBe(true)
			expect(machine.registerValues().fpcr).toBe(0xffff000000000000n)
		} finally { services.dispose() }
	})
	it('shows float registers as IEEE values in data tips', () => {
		const services = definition.createServices()
		try {
			const state = { registers: { f1: t(-2.5), fpcr: FPCR_RESET | DZE | SUM }, labels: new Map() } as never
			expect(services.describeToken!('addt $f1, $f1, $f2', 6, state)!.contents).toEqual(['**$f1** = -2.5 (0xc004000000000000)'])
			expect(services.describeToken!('mf_fpcr fpcr', 9, state)!.contents[1]).toBe('dynamic rounding normal; status DZE; disables none')
		} finally { services.dispose() }
	})
	it('runs the floating-point example', () => {
		const { services, machine } = load(definition.examples.floatingpoint.code)
		try {
			while (!machine.halted) machine.step()
			expect(machine.console).toBe('45')
		} finally { services.dispose() }
	})
	it('draws the MIPS single-precision Mandelbrot iteration counts', () => {
		const { services, machine } = load(definition.examples.mandelbrot.code)
		try {
			for (let steps = 0; !machine.halted && steps < 2_000_000; steps++) machine.step()
			expect(machine.halted).toBe(true)
			const memory = machine.inspectMemory(), palette = Array.from({ length: 17 }, (_, i) => memory.word(0x11000 + i * 4))
			const actual: number[] = [], expected: number[] = []
			// The MIPS program's binary32 operations, in order.
			const step = Math.fround(2.5 / 32)
			for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
				const cy = Math.fround(Math.fround(row * step) - 1.25), cx = Math.fround(Math.fround(col * step) - 2)
				let x = 0, y = 0, iteration = 0
				for (; iteration < 16; iteration++) {
					const xx = Math.fround(x * x), yy = Math.fround(y * y)
					if (4 < Math.fround(xx + yy)) break
					y = Math.fround(Math.fround(Math.fround(x * y) * 2) + cy)
					x = Math.fround(Math.fround(xx - yy) + cx)
				}
				expected.push(iteration)
				actual.push(palette.indexOf(memory.word(0x10000 + (row * 32 + col) * 4)))
			}
			expect(actual).toEqual(expected)
			expect(new Set(expected).size).toBeGreaterThan(10)
		} finally { services.dispose() }
	}, 30_000)
})
