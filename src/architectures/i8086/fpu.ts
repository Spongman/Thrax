import type { RegisterDescriptor } from '../contracts'
import type { CpuConfiguration, CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { BinaryException as E, EXTENDED_FORMAT, binaryInteger, binaryNaN, binaryNegate, binaryZero, calculateBinary, compareBinary, integerBinary, packBinary, roundBinary, sqrtBinary, unpackBinary, type BinaryFloat, type BinaryResult, type BinaryRounding } from '../../core/binaryFloat'

export const FCW = 38, FSW = 39, FTW = 40, FIP = 41, FCS = 42, FDP = 43, FDS = 44, FOP = 45
export const fpuWords = 46
const C0 = 0x100, C1 = 0x200, C2 = 0x400, C3 = 0x4000
const operations = ['FADD', 'FMUL', 'FCOM', 'FCOMP', 'FSUB', 'FSUBR', 'FDIV', 'FDIVR']
const fixed: Record<string, number> = { FNOP: 0xd9d0, FCHS: 0xd9e0, FABS: 0xd9e1, FTST: 0xd9e4, FXAM: 0xd9e5, FLD1: 0xd9e8, FLDL2T: 0xd9e9, FLDL2E: 0xd9ea, FLDPI: 0xd9eb, FLDLG2: 0xd9ec, FLDLN2: 0xd9ed, FLDZ: 0xd9ee, FPREM: 0xd9f8, FDECSTP: 0xd9f6, FINCSTP: 0xd9f7, FSQRT: 0xd9fa, FRNDINT: 0xd9fc, FSCALE: 0xd9fd, FXTRACT: 0xd9f4, FCOMPP: 0xded9, FNCLEX: 0xdbe2, FNINIT: 0xdbe3, FNENI: 0xdbe0, FNDISI: 0xdbe1 }
// 80387 additions the 80187 executes; FSETPM is accepted and ignored as on the 80387.
const fixed387: Record<string, number> = { FSIN: 0xd9fe, FCOS: 0xd9ff, FSINCOS: 0xd9fb, FPREM1: 0xd9f5, FUCOMPP: 0xdae9, FSETPM: 0xdbe4 }
export type Coprocessor = '8087' | '80187'
const waiting: Record<string, string> = { FINIT: 'FNINIT', FCLEX: 'FNCLEX', FENI: 'FNENI', FDISI: 'FNDISI', FSTCW: 'FNSTCW', FSTSW: 'FNSTSW', FSTENV: 'FNSTENV', FSAVE: 'FNSAVE' }
export const fpuInstructions = [...Object.keys(fixed), ...Object.keys(waiting), ...operations, 'FADDP', 'FMULP', 'FSUBP', 'FSUBRP', 'FDIVP', 'FDIVRP', 'FIADD', 'FIMUL', 'FICOM', 'FICOMP', 'FISUB', 'FISUBR', 'FIDIV', 'FIDIVR', 'FLD', 'FST', 'FSTP', 'FILD', 'FIST', 'FISTP', 'FBLD', 'FBSTP', 'FXCH', 'FFREE', 'FLDCW', 'FNSTCW', 'FNSTSW', 'FLDENV', 'FNSTENV', 'FRSTOR', 'FNSAVE']
export const fpu387Instructions = [...Object.keys(fixed387), 'FUCOM', 'FUCOMP']
const st = (text: string) => { const match = /^ST(?:\(?([0-7])\)?)?$/i.exec(text.trim()); return match ? Number(match[1] ?? 0) : -1 }
const top = (words: Uint32Array) => words[FSW] >>> 11 & 7
const physical = (words: Uint32Array, index: number) => (top(words) + index) & 7
const raw = (words: Uint32Array, index: number) => { const p = 14 + physical(words, index) * 3; return BigInt(words[p]) | BigInt(words[p + 1]) << 32n | BigInt(words[p + 2] & 65535) << 64n }
const setRaw = (words: Uint32Array, index: number, value: bigint) => { const p = 14 + physical(words, index) * 3; words[p] = Number(value & 0xffffffffn); words[p + 1] = Number(value >> 32n & 0xffffffffn); words[p + 2] = Number(value >> 64n & 65535n) }
const tag = (words: Uint32Array, index: number) => words[FTW] >>> (physical(words, index) * 2) & 3
const setTag = (words: Uint32Array, index: number, value: number) => { const shift = physical(words, index) * 2; words[FTW] = words[FTW] & ~(3 << shift) | value << shift }
const setTop = (c: CpuContext, index: number) => { c.r[FSW] = c.r[FSW] & ~0x3800 | (index & 7) << 11 }
const rounding = (c: CpuContext): BinaryRounding => (['nearest', 'down', 'up', 'zero'] as const)[c.r[FCW] >>> 10 & 3]
const format = (c: CpuContext) => ({ ...EXTENDED_FORMAT, precision: [24, 64, 53, 64][c.r[FCW] >>> 8 & 3] })
const classify = (value: bigint) => { const exponent = value >> 64n & 0x7fffn, significand = value & 0xffffffffffffffffn; return exponent === 0x7fffn || exponent && !(significand & 1n << 63n) ? 2 : exponent === 0n ? significand === 0n ? 1 : 2 : 0 }
const put = (c: CpuContext, index: number, value: BinaryFloat) => { const bits = packBinary(value, 63, 15, true); setRaw(c.r, index, bits); setTag(c.r, index, classify(bits)) }
function exception(c: CpuContext, flags: number) {
	c.r[FSW] |= flags
	if (flags & ~c.r[FCW] & 63) { c.r[FSW] |= 0x80; return false }
	return true
}
function accept(c: CpuContext, computed: BinaryResult, index = 0) {
	c.r[FSW] = c.r[FSW] & ~C1 | (computed.roundedUp ? C1 : 0)
	if (!exception(c, computed.flags)) return false
	put(c, index, computed.value); return true
}
function get(c: CpuContext, index: number): BinaryFloat {
	if (tag(c.r, index) === 3) { c.r[FSW] &= ~C1; exception(c, E.invalid); return binaryNaN() }
	const bits = raw(c.r, index), value = unpackBinary(bits, 63, 15, true)
	if (value.special === 'nan' && !(bits & 1n << 62n) || (bits >> 64n & 0x7fffn) !== 0n && !(bits & 1n << 63n)) exception(c, E.invalid)
	if (value.significand && !(bits >> 64n & 0x7fffn)) exception(c, E.denormal)
	return value
}
const pending = (c: CpuContext) => !!(c.r[FSW] & 0x80)
export function wait8087(c: CpuContext) { if (pending(c)) throw new Error('Coprocessor has a pending unmasked exception; external coprocessor interrupt delivery is unavailable') }
/** FNINIT state; the 80187 initializes the 80387 control word, without the 8087's IEM bit. */
export function reset8087(c: CpuContext, coprocessor: Coprocessor = '8087') { for (let i = 14; i < fpuWords; i++) c.r[i] = 0; c.r[FCW] = coprocessor === '80187' ? 0x037f : 0x03ff; c.r[FTW] = 0xffff }
function push(c: CpuContext, value: BinaryFloat) {
	const destination = top(c.r) - 1 & 7, overflow = (c.r[FTW] >>> (destination * 2) & 3) !== 3
	if (overflow) { c.r[FSW] |= C1; if (!exception(c, E.invalid)) return }
	if (pending(c)) return
	setTop(c, destination); put(c, 0, overflow ? binaryNaN() : value)
}
function pop(c: CpuContext) { setTag(c.r, 0, 3); setTop(c, top(c.r) + 1) }
/** Affine-only comparison on the 80187; `quiet` is FUCOM, where only signaling NaNs are invalid. */
function compare(c: CpuContext, left: BinaryFloat, right: BinaryFloat, affine: boolean, quiet = false) {
	const relation = left.special === 'infinity' && right.special === 'infinity' && !affine && !(c.r[FCW] & 0x1000) ? 0 : compareBinary(left, right)
	if (relation === null && !quiet && !exception(c, E.invalid)) return false
	if (pending(c)) return false
	c.r[FSW] = c.r[FSW] & ~(C0 | C1 | C2 | C3) | (relation === null ? C0 | C2 | C3 : relation < 0 ? C0 : relation === 0 ? C3 : 0)
	return true
}

// Machin's formula at `bits` fraction bits, cached at the widest precision requested.
let piBits = 0, piFixed = 0n
function pi(bits: number) {
	if (bits > piBits) {
		const guard = bits + 64, one = 1n << BigInt(guard)
		const atan = (n: bigint) => { let sum = 0n, power = one / n, k = 1n; for (let sign = 1n; power; sign = -sign, k += 2n, power /= n * n) sum += sign * power / k; return sum }
		piFixed = 16n * atan(5n) - 4n * atan(239n); piBits = guard
	}
	return piFixed >> BigInt(piBits - bits)
}
function series(r: bigint, bits: number, sine: boolean) {
	const shift = BigInt(bits), square = r * r >> shift
	let term = sine ? r : 1n << shift, sum = term
	for (let n = sine ? 1 : 0; term; n += 2) { term = -(term * square >> shift) / BigInt((n + 1) * (n + 2)); sum += term }
	return sum
}
/** Sine and cosine of a finite |x| < 2^63, from an exact reduction by pi/2 rounded once to extended. */
function sinCos(x: BinaryFloat, mode: BinaryRounding): [BinaryResult, BinaryResult] {
	if (!x.significand) return [{ value: x, flags: 0, roundedUp: false }, { value: binaryInteger(1n), flags: 0, roundedUp: false }]
	const bits = Math.max(0, -(x.significand.toString(2).length + x.exponent)) + 340, guard = 80
	const fixed = x.significand << BigInt(x.exponent + bits + guard), half = pi(bits + guard) >> 1n
	const k = (fixed + (half >> 1n)) / half, r = fixed - k * half >> BigInt(guard)
	const sine = series(r, bits, true), cosine = series(r, bits, false), quadrant = Number(k & 3n)
	const round = (value: bigint, negative: boolean) => roundBinary(negative !== value < 0n, (value < 0n ? -value : value) * 2n + 1n, -bits - 1, 1n, EXTENDED_FORMAT, mode)
	return [round([sine, cosine, -sine, -cosine][quadrant], x.negative), round([cosine, -sine, -cosine, sine][quadrant], false)]
}

export function fpuRegisterView(integer: readonly RegisterDescriptor[], editInteger: (cpu: CpuContext, index: number, value: number) => void, bank = '8087'): NonNullable<CpuConfiguration['registerView']> {
	const controls = ['FCW', 'FSW', 'FTW', 'FIP', 'FCS', 'FDP', 'FDS', 'FOP']
	return {
		registers: [...integer, ...Array.from({ length: 8 }, (_, i) => ({ id: `st${i}`, name: `ST(${i})`, aliases: i === 0 ? ['ST'] : [], bits: 80, bank, group: 'Register stack (raw 80-bit)', editable: true })), ...controls.map(name => ({ id: name.toLowerCase(), name, bits: name === 'FOP' ? 11 : 16, bank, group: 'Control and environment', editable: true }))],
		read: (words, index) => index < 14 ? words[index] : index < 22 ? raw(words, index - 14) : words[FCW + index - 22],
		write(cpu, index, value) {
			if (index < 14) editInteger(cpu, index, Number(value))
			else if (index < 22) { setRaw(cpu.r, index - 14, BigInt(value)); setTag(cpu.r, index - 14, classify(BigInt(value))) }
			else cpu.r[FCW + index - 22] = Number(value) & 65535
		},
	}
}

export function encode8087(name: string, texts: readonly string[], context: CpuEncodingContext, memory: (text: string, field: number) => number[], coprocessor: Coprocessor = '8087'): number[] {
	if (name in waiting) return [0x9b, ...encode8087(waiting[name], texts, context, memory, coprocessor)]
	if (coprocessor !== '80187' && fpu387Instructions.includes(name)) throw new Error(`${name} requires the 80187 coprocessor`)
	const code = fixed[name] ?? fixed387[name]
	if (code !== undefined && !texts.length) return [code >>> 8, code & 255]
	const a = st(texts[0] ?? ''), b = st(texts[1] ?? ''), checked = (byte: number) => [0xd9, byte]
	if (name === 'FUCOM' || name === 'FUCOMP') {
		if (texts.length > 2 || texts.length === 2 && a !== 0 || texts.length && (texts.length === 2 ? b : a) < 0) throw new Error(`${name} compares ST(0) with ST(i)`)
		return [0xdd, (name === 'FUCOM' ? 0xe0 : 0xe8) + (texts.length === 2 ? b : texts.length ? a : 1)]
	}
	if (texts.length === 1 && a >= 0) {
		if (name === 'FLD') return checked(0xc0 + a)
		if (name === 'FXCH') return checked(0xc8 + a)
		if (name === 'FFREE') return [0xdd, 0xc0 + a]
		if (name === 'FST' || name === 'FSTP') return [0xdd, (name === 'FST' ? 0xd0 : 0xd8) + a]
	}
	if (name === 'FXCH' && !texts.length) return checked(0xc9)
	const popNames: Record<string, string> = { FADDP: 'FADD', FMULP: 'FMUL', FSUBP: 'FSUB', FSUBRP: 'FSUBR', FDIVP: 'FDIV', FDIVRP: 'FDIVR' }
	const popping = name in popNames, operation = operations.indexOf(popNames[name] ?? name)
	if (operation >= 0 && (a >= 0 || !texts.length)) {
		if (operation === 2 || operation === 3) {
			if (texts.length > 2 || texts.length === 2 && (a !== 0 || b < 0)) throw new Error('FCOM/FCOMP compares ST(0) with ST(i)')
			const source = texts.length === 2 ? b : texts.length ? a : 1
			return [0xd8, 0xc0 + operation * 8 + source]
		}
		if (texts.length > 2 || !texts.length && !popping) throw new Error('FPU arithmetic requires explicit operands')
		const destination = texts.length === 2 ? a : popping ? texts.length ? a : 1 : 0
		const source = texts.length === 2 ? b : popping ? 0 : a
		if (source < 0 || destination !== 0 && source !== 0 || popping && source !== 0) throw new Error('One FPU arithmetic operand must be ST(0); popping forms use ST(i),ST(0)')
		const field = destination !== 0 || popping ? operation >= 4 ? operation ^ 1 : operation : operation
		return [popping ? 0xde : destination !== 0 ? 0xdc : 0xd8, 0xc0 + field * 8 + (destination || source)]
	}
	if (texts.length !== 1 || a >= 0) throw new Error(`Unsupported 8087 operands for ${name}`)
	const match = /^(WORD|DWORD|QWORD|TWORD)\s+(?:PTR\s+)?(.+)$/i.exec(texts[0]), size = match ? ({ WORD: 2, DWORD: 4, QWORD: 8, TWORD: 10 }[match[1].toUpperCase()] ?? 0) : 0, operand = match?.[2] ?? texts[0]
	let opcode: number, field: number
	if (['FLDCW', 'FNSTCW', 'FNSTSW', 'FLDENV', 'FNSTENV', 'FRSTOR', 'FNSAVE'].includes(name)) {
		if (size && size !== 2) throw new Error(`${name} uses a word or environment memory operand`)
		opcode = ['FNSTSW', 'FRSTOR', 'FNSAVE'].includes(name) ? 0xdd : 0xd9
		field = ({ FLDCW: 5, FNSTCW: 7, FNSTSW: 7, FLDENV: 4, FNSTENV: 6, FRSTOR: 4, FNSAVE: 6 })[name]!
	} else if (name === 'FBLD' || name === 'FBSTP') { if (size !== 10) throw new Error('Packed BCD needs TWORD'); opcode = 0xdf; field = name === 'FBLD' ? 4 : 6 }
	else if (['FILD', 'FIST', 'FISTP'].includes(name)) {
		if (![2, 4, 8].includes(size) || size === 8 && name === 'FIST') throw new Error('Integer FPU transfers need WORD/DWORD, or QWORD FILD/FISTP')
		opcode = size === 4 ? 0xdb : 0xdf; field = size === 8 ? name === 'FILD' ? 5 : 7 : name === 'FILD' ? 0 : name === 'FIST' ? 2 : 3
	} else if (['FLD', 'FST', 'FSTP'].includes(name)) {
		if (![4, 8, 10].includes(size) || size === 10 && name === 'FST') throw new Error('Real transfers need DWORD/QWORD, or TWORD FLD/FSTP')
		opcode = size === 4 ? 0xd9 : size === 8 ? 0xdd : 0xdb; field = size === 10 ? name === 'FLD' ? 5 : 7 : name === 'FLD' ? 0 : name === 'FST' ? 2 : 3
	} else {
		const integer = name.startsWith('FI'), arithmetic = operations.indexOf(integer ? `F${name.slice(2)}` : name)
		if (arithmetic < 0 || !(integer ? [2, 4] : [4, 8]).includes(size)) throw new Error('FPU memory arithmetic needs an explicit supported operand width')
		opcode = integer ? size === 2 ? 0xde : 0xda : size === 4 ? 0xd8 : 0xdc; field = arithmetic
	}
	return [opcode, ...memory(operand, field)]
}

interface MemoryOperand { encoding: number; reg: number; r: number; mode: number; label: string; location(cpu: CpuContext): number; segment(cpu: CpuContext): number; offset(cpu: CpuContext): number }
export function decode8087(opcode: number, operand: MemoryOperand, coprocessor: Coprocessor = '8087'): Omit<CpuInstruction, 'size'> {
	const field = operand.reg, register = operand.r, encoded = operand.encoding, instructionWord = opcode << 8 | encoded
	const later = coprocessor === '80187', table = later ? { ...fixed, ...fixed387 } : fixed
	const width = opcode === 0xd8 || opcode === 0xda ? 4 : opcode === 0xdc ? 8 : 2
	let text = '', action: (cpu: CpuContext) => void, control = false, kind: CpuInstruction['kind'] = 'alu'
	const readBits = (c: CpuContext, size: number, offset = 0) => { let value = 0n; const first = operand.location(c); for (let i = 0; i < size; i++) value |= BigInt(c.read((first + offset + i) & 0xfffff)) << BigInt(i * 8); return value }
	const writeBits = (c: CpuContext, size: number, value: bigint, offset = 0) => { const first = operand.location(c); for (let i = 0; i < size; i++) c.write((first + offset + i) & 0xfffff, Number(value >> BigInt(i * 8) & 255n)) }
	const loadReal = (c: CpuContext, size: number) => {
		const bits = readBits(c, size), value = size === 10 ? unpackBinary(bits, 63, 15, true) : unpackBinary(bits, size === 4 ? 23 : 52, size === 4 ? 8 : 11)
		const fractionBits = size === 10 ? 64 : size === 4 ? 23 : 52, exponentBits = size === 10 ? 15 : size === 4 ? 8 : 11
		if (value.significand && !(bits >> BigInt(fractionBits) & (1n << BigInt(exponentBits)) - 1n)) exception(c, E.denormal)
		if (value.special === 'nan' && !(bits & 1n << BigInt(size === 10 ? 62 : fractionBits - 1))) exception(c, E.invalid)
		return value
	}
	const arithmetic = (c: CpuContext, operation: number, destination: number, source: BinaryFloat, popResult = false) => {
		const left = get(c, destination)
		if (operation === 2 || operation === 3) { if (compare(c, left, source, later) && operation === 3) pop(c); return }
		if (pending(c)) return
		const a = operation === 5 || operation === 7 ? source : left, b = operation === 5 || operation === 7 ? left : source
		const computed = calculateBinary(operation === 1 ? 'multiply' : operation >= 6 ? 'divide' : 'add', a, operation === 4 || operation === 5 ? binaryNegate(b) : b, format(c), rounding(c))
		if (accept(c, computed, destination) && popResult) pop(c)
	}
	const environment = (c: CpuContext, load: boolean, full: boolean) => {
		if (load) {
			for (let i = 0; i < 3; i++) c.r[FCW + i] = Number(readBits(c, 2, i * 2))
			const instruction = Number(readBits(c, 2, 8)), data = Number(readBits(c, 2, 12))
			c.r[FIP] = Number(readBits(c, 2, 6)); c.r[FCS] = instruction & 0xf000; c.r[FOP] = instruction & 0x7ff
			c.r[FDP] = Number(readBits(c, 2, 10)); c.r[FDS] = data & 0xf000
		} else {
			const instruction = c.segmentAddress(c.r[FCS], c.r[FIP]), data = c.segmentAddress(c.r[FDS], c.r[FDP])
			const words = [c.r[FCW], c.r[FSW], c.r[FTW], instruction & 65535, instruction >>> 16 << 12 | c.r[FOP], data & 65535, data >>> 16 << 12]
			for (let i = 0; i < words.length; i++) writeBits(c, 2, BigInt(words[i]), i * 2)
		}
		if (full) for (let i = 0; i < 8; i++) { if (load) setRaw(c.r, i, readBits(c, 10, 14 + i * 10)); else writeBits(c, 10, raw(c.r, i), 14 + i * 10) }
		if (!load) { if (full) reset8087(c, coprocessor); else c.r[FCW] |= 63 }
	}
	if (operand.mode !== 3) {
		const label = (bytes: number) => `${({ 2: 'WORD', 4: 'DWORD', 8: 'QWORD', 10: 'TWORD' })[bytes as 2]} ${operand.label}`
		if ([0xd8, 0xda, 0xdc, 0xde].includes(opcode)) {
			const integer = opcode === 0xda || opcode === 0xde
			text = `${integer ? `FI${operations[field].slice(1)}` : operations[field]} ${label(width)}`
			action = c => arithmetic(c, field, 0, integer ? binaryInteger(BigInt.asIntN(width * 8, readBits(c, width))) : loadReal(c, width))
		} else if (opcode === 0xd9 && field >= 4 || opcode === 0xdd && [4, 6, 7].includes(field)) {
			control = true; kind = field === 4 || field === 5 ? 'load' : 'store'
			const name = opcode === 0xd9 ? ({ 4: 'FLDENV', 5: 'FLDCW', 6: 'FNSTENV', 7: 'FNSTCW' })[field as 4] : ({ 4: 'FRSTOR', 6: 'FNSAVE', 7: 'FNSTSW' })[field as 4]
			text = `${name} ${operand.label}`
			action = c => { if (name === 'FLDCW') { c.r[FCW] = Number(readBits(c, 2)); if (c.r[FSW] & ~c.r[FCW] & 63) c.r[FSW] |= 0x80; else c.r[FSW] &= ~0x80 } else if (name === 'FNSTCW' || name === 'FNSTSW') writeBits(c, 2, BigInt(c.r[name === 'FNSTCW' ? FCW : FSW])); else environment(c, name === 'FLDENV' || name === 'FRSTOR', name === 'FRSTOR' || name === 'FNSAVE') }
		} else {
			const real = opcode === 0xd9 || opcode === 0xdd || opcode === 0xdb && (field === 5 || field === 7), bcd = opcode === 0xdf && (field === 4 || field === 6)
			const size = real ? opcode === 0xd9 ? 4 : opcode === 0xdd ? 8 : 10 : bcd ? 10 : opcode === 0xdb ? 4 : field === 5 || field === 7 ? 8 : 2
			const loading = field === 0 || field === 5 || bcd && field === 4, popping = field === 3 || field === 7 || bcd && field === 6
			if (!(real ? [0, 2, 3, 5, 7] : bcd ? [4, 6] : [0, 2, 3, 5, 7]).includes(field) || opcode === 0xdd && field >= 5) throw new Error('Unsupported 8087 memory encoding')
			text = `${bcd ? loading ? 'FBLD' : 'FBSTP' : real ? loading ? 'FLD' : popping ? 'FSTP' : 'FST' : loading ? 'FILD' : popping ? 'FISTP' : 'FIST'} ${label(size)}`; kind = loading ? 'load' : 'store'
			action = c => {
				if (loading) {
					let value: BinaryFloat
					if (real) value = loadReal(c, size)
					else if (bcd) { const bits = readBits(c, 10); let integer = 0n, multiplier = 1n; for (let i = 0; i < 18; i++) { const digit = bits >> BigInt(i * 4) & 15n; if (digit > 9n) { exception(c, E.invalid); push(c, binaryNaN()); return } integer += digit * multiplier; multiplier *= 10n } value = integer === 0n ? binaryZero(!!(bits >> 79n)) : binaryInteger(bits >> 79n ? -integer : integer) }
					else value = binaryInteger(BigInt.asIntN(size * 8, readBits(c, size)))
					push(c, value); return
				}
				const value = get(c, 0)
				if (pending(c)) return
				if (real) {
					if (size === 10) writeBits(c, 10, packBinary(value, 63, 15, true))
					else { const f = size === 4 ? { precision: 24, minExponent: -126, maxExponent: 127 } : { precision: 53, minExponent: -1022, maxExponent: 1023 }, computed = value.special ? { value, flags: 0, roundedUp: false } : roundBinary(value.negative, value.significand, value.exponent, 1n, f, rounding(c)); c.r[FSW] = c.r[FSW] & ~C1 | (computed.roundedUp ? C1 : 0); if (!exception(c, computed.flags)) return; writeBits(c, size, packBinary(computed.value, f.precision - 1, size === 4 ? 8 : 11)) }
				} else {
					const converted = integerBinary(value, rounding(c)), valid = converted && (bcd ? converted.value > -1000000000000000000n && converted.value < 1000000000000000000n : BigInt.asIntN(size * 8, converted.value) === converted.value)
					c.r[FSW] = c.r[FSW] & ~C1 | (valid && converted.roundedUp ? C1 : 0)
					if (!exception(c, valid ? converted.inexact ? E.inexact : 0 : E.invalid)) return
					if (bcd) { let magnitude = valid ? converted.value < 0n ? -converted.value : converted.value : 0n, bits = value.negative ? 1n << 79n : 0n; for (let i = 0; i < 18; i++) { bits |= magnitude % 10n << BigInt(i * 4); magnitude /= 10n } writeBits(c, 10, valid ? bits : 0xffffc000000000000000n) }
					else writeBits(c, size, valid ? converted.value : 1n << BigInt(size * 8 - 1))
				}
				if (popping) pop(c)
			}
		}
	} else if (Object.values(table).includes(instructionWord)) {
		text = Object.entries(table).find(([, code]) => code === instructionWord)![0]
		control = text.startsWith('FN') && text !== 'FNOP' || text === 'FSETPM'
		action = c => {
			if (text === 'FNINIT') { reset8087(c, coprocessor); return }
			if (text === 'FNCLEX') { c.r[FSW] &= ~0x80ff; return }
			// The 80187 has no IEM bit: FENI/FDISI execute as no-ops.
			if (text === 'FNENI' || text === 'FNDISI') { if (!later) c.r[FCW] = text === 'FNENI' ? c.r[FCW] & ~128 : c.r[FCW] | 128; return }
			if (text === 'FNOP' || text === 'FSETPM') return
			if (text === 'FINCSTP' || text === 'FDECSTP') { setTop(c, top(c.r) + (text === 'FINCSTP' ? 1 : -1)); c.r[FSW] &= ~C1; return }
			if (text.startsWith('FLD')) { const constants: Record<string, bigint> = { FLD1: 0x3fff8000000000000000n, FLDZ: 0n, FLDPI: 0x4000c90fdaa22168c235n, FLDL2T: 0x4000d49a784bcd1b8afen, FLDL2E: 0x3fffb8aa3b295c17f0bcn, FLDLG2: 0x3ffd9a209a84fbcff799n, FLDLN2: 0x3ffeb17217f7d1cf79acn }; push(c, unpackBinary(constants[text], 63, 15, true)); return }
			if (text === 'FXAM') { const value = unpackBinary(raw(c.r, 0), 63, 15, true), category = tag(c.r, 0) === 3 ? C3 | C0 : value.special === 'nan' ? C0 : value.special === 'infinity' ? C2 | C0 : value.significand === 0n ? C3 : value.exponent === -16445 && !(value.significand & 1n << 63n) ? C3 | C2 : C2; c.r[FSW] = c.r[FSW] & ~(C0 | C1 | C2 | C3) | category | (value.negative ? C1 : 0); return }
			const value = get(c, 0)
			if (pending(c)) return
			if (text === 'FCHS' || text === 'FABS') { put(c, 0, { ...value, negative: text === 'FCHS' ? !value.negative : false }); return }
			if (text === 'FTST') { compare(c, value, binaryZero(), later); return }
			if (text === 'FCOMPP' || text === 'FUCOMPP') { if (compare(c, value, get(c, 1), later, text === 'FUCOMPP')) { pop(c); pop(c) } return }
			if (text === 'FSIN' || text === 'FCOS' || text === 'FSINCOS') {
				const both = text === 'FSINCOS'
				if (both && tag(c.r, 7) !== 3) { c.r[FSW] |= C1; if (exception(c, E.invalid)) { put(c, 0, binaryNaN()); setTop(c, top(c.r) - 1); put(c, 0, binaryNaN()) } return }
				if (value.special === 'infinity') { if (exception(c, E.invalid)) { put(c, 0, binaryNaN()); if (both) push(c, binaryNaN()) } return }
				// Operands outside |x| < 2^63 set C2 and are left unchanged.
				const outside = !value.special && value.significand.toString(2).length + value.exponent > 63
				c.r[FSW] = c.r[FSW] & ~C2 | (outside ? C2 : 0)
				if (outside) return
				const [sine, cosine] = value.special ? [{ value, flags: 0, roundedUp: false }, { value, flags: 0, roundedUp: false }] : sinCos(value, rounding(c))
				if (!both) { accept(c, text === 'FSIN' ? sine : cosine); return }
				c.r[FSW] = c.r[FSW] & ~C1 | (cosine.roundedUp ? C1 : 0)
				if (!exception(c, sine.flags | cosine.flags)) return
				put(c, 0, sine.value); push(c, cosine.value); return
			}
			if (text === 'FSQRT') { accept(c, sqrtBinary(value, format(c), rounding(c))); return }
			if (text === 'FRNDINT') { const converted = integerBinary(value, rounding(c)); if (!converted) { put(c, 0, value); return } accept(c, { value: converted.value === 0n ? binaryZero(value.negative) : binaryInteger(converted.value), flags: converted.inexact ? E.inexact : 0, roundedUp: converted.roundedUp }); return }
			if (text === 'FSCALE') { const scale = integerBinary(get(c, 1), 'zero'); if (pending(c)) return; if (!scale) { exception(c, E.invalid); if (!pending(c)) put(c, 0, binaryNaN()); return } if (value.special || !value.significand) return; accept(c, roundBinary(value.negative, value.significand, value.exponent + Number(scale.value > 65536n ? 65536n : scale.value < -65536n ? -65536n : scale.value), 1n, EXTENDED_FORMAT, rounding(c))); return }
			if (text === 'FXTRACT') {
				if (value.special === 'nan') { put(c, 0, value); push(c, value); return }
				if (value.special === 'infinity') { put(c, 0, { ...value, negative: false }); push(c, value); return }
				if (!value.significand) { if (exception(c, E.zeroDivide)) { put(c, 0, { ...binaryZero(true), special: 'infinity' }); push(c, value) } return }
				const exponent = value.significand.toString(2).length - 1 + value.exponent
				put(c, 0, binaryInteger(BigInt(exponent))); push(c, { ...value, exponent: value.exponent - exponent }); return
			}
			if (text === 'FPREM' || text === 'FPREM1') {
				const divisor = get(c, 1)
				if (pending(c)) return
				if (value.special === 'nan' || divisor.special === 'nan') { put(c, 0, binaryNaN()); return }
				if (value.special || !divisor.special && !divisor.significand) { if (exception(c, E.invalid)) put(c, 0, binaryNaN()); return }
				if (divisor.special || !value.significand) { c.r[FSW] &= ~(C0 | C1 | C2 | C3); return }
				const difference = value.significand.toString(2).length - divisor.significand.toString(2).length + value.exponent - divisor.exponent
				const reduction = difference >= 64 ? difference - 32 : 0, shift = value.exponent - divisor.exponent - reduction
				const [dividend, scaled] = shift >= 0 ? [value.significand << BigInt(shift), divisor.significand] : [value.significand, divisor.significand << BigInt(-shift)]
				let quotient = dividend / scaled
				// FPREM1 completes with the IEEE quotient rounded to nearest, ties to even.
				const twice = (dividend - quotient * scaled) * 2n
				if (text === 'FPREM1' && !reduction && (twice > scaled || twice === scaled && quotient & 1n)) quotient++
				const product = { negative: value.negative, significand: divisor.significand * quotient, exponent: divisor.exponent + reduction }
				const remainder = calculateBinary('add', value, binaryNegate(product)).value
				put(c, 0, remainder.significand === 0n ? binaryZero(value.negative) : remainder)
				if (reduction) c.r[FSW] |= C2
				else { const q = Number(quotient & 7n); c.r[FSW] = c.r[FSW] & ~(C0 | C1 | C2 | C3) | (q & 4 ? C0 : 0) | (q & 2 ? C3 : 0) | (q & 1 ? C1 : 0) }
				return
			}
		}
	} else if (later && opcode === 0xdd && (field === 4 || field === 5)) {
		text = `FUCOM${field === 5 ? 'P' : ''} ST(${register})`
		action = c => { if (compare(c, get(c, 0), get(c, register), true, true) && field === 5) pop(c) }
	} else if (opcode === 0xd9 && field <= 1 || opcode === 0xdd && field <= 3) {
		text = `${opcode === 0xd9 ? field === 0 ? 'FLD' : 'FXCH' : ['FFREE', 'FXCH', 'FST', 'FSTP'][field]} ST(${register})`
		action = c => { if (text.startsWith('FFREE')) { setTag(c.r, register, 3); return } const value = get(c, opcode === 0xd9 && field === 0 ? register : 0); if (pending(c)) return; if (text.startsWith('FLD')) push(c, value); else if (text.startsWith('FXCH')) { const other = get(c, register); if (!pending(c)) { put(c, register, value); put(c, 0, other) } } else { put(c, register, value); if (field === 3) pop(c) } }
	} else if ([0xd8, 0xdc, 0xde].includes(opcode) && field !== 2 && field !== 3 || opcode === 0xd8 && (field === 2 || field === 3)) {
		const destination = opcode === 0xd8 ? 0 : register, source = opcode === 0xd8 ? register : 0, operation = opcode !== 0xd8 && field >= 4 ? field ^ 1 : field
		text = `${operations[operation]}${opcode === 0xde ? 'P' : ''} ST(${destination}), ST(${source})`
		action = c => arithmetic(c, operation, destination, get(c, source), opcode === 0xde)
	} else throw new Error(`Unsupported 8087 encoding 0x${instructionWord.toString(16)}`)
	return { text, kind, reads: ['st0', 'st1', 'fcw', 'fsw', 'ftw', 'ds', 'ss'], writes: ['st0', 'st1', 'st2', 'st3', 'st4', 'st5', 'st6', 'st7', 'fsw', 'ftw'], execute(c) {
		if (!control) { wait8087(c); c.r[FIP] = c.instructionAddress - (c.r[9] << 4) & 65535; c.r[FCS] = c.r[9]; c.r[FOP] = (opcode & 7) << 8 | encoded; if (operand.mode !== 3) { c.r[FDP] = operand.offset(c); c.r[FDS] = operand.segment(c) } }
		action(c)
	} }
}
