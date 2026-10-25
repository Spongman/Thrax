import {
	BinaryException as E,
	calculateBinary,
	compareBinary,
	integerBinary,
	roundBinary,
	sqrtBinary,
	type BinaryFloat,
	type BinaryFormat,
	type BinaryResult,
	type BinaryRounding
} from '../../core/binaryFloat'
import type { M68kCpu } from './cpu'
import type { Decoded, Operand } from './decode'
import {
	binaryInfinity,
	binaryInteger,
	binaryZero,
	DEFAULT_NAN,
	fromDouble,
	fromIeee,
	fromMemory96,
	fromPacked,
	isSignalingNaN80,
	pack80,
	precisionFormat,
	quietNaN80,
	romConstant,
	round,
	toDouble,
	toIeee,
	toMemory96,
	toPacked,
	unpack80
} from './extended'
import {
	BRANCH,
	BYTE,
	CC_I,
	CC_N,
	CC_NAN,
	CC_Z,
	CONSTANT,
	CONTROL_IN,
	CONTROL_OUT,
	DECREMENT,
	DOUBLE,
	DYADIC,
	EXTENDED,
	FORMAT_BYTES,
	fpCondition,
	FPCR,
	FPIAR,
	FPSR,
	kFactor,
	LONG,
	MOVE_OUT,
	MOVEM_IN,
	MOVEM_OUT,
	PACKED,
	PACKED_DYNAMIC,
	reverseByte,
	SET,
	SINGLE,
	TEST,
	TRAP,
	WORD
} from './fpuIsa'

// FPSR exception status bits; the enable byte of FPCR uses the same positions.
export const BSUN = 0x8000,
	SNAN = 0x4000,
	OPERR = 0x2000,
	OVFL = 0x1000,
	UNFL = 0x0800,
	DZ = 0x0400,
	INEX2 = 0x0200,
	INEX1 = 0x0100
const EXCEPTION_NAMES = ['INEX1', 'INEX2', 'DZ', 'UNFL', 'OVFL', 'OPERR', 'SNAN', 'BSUN']
// FPCR bits 15-4 and FPSR bits 27-3 are defined; the rest read as zero.
export const FPCR_MASK = 0xfff0,
	FPSR_MASK = 0x0ffffff8

/** Reset state: FP0-FP7 hold non-signaling NaNs and the control registers are zero. */
export function resetFpu(fp: Int32Array) {
	for (let i = 0; i < 8; i++) setRegister(fp, i, DEFAULT_NAN)
	fp[FPCR] = fp[FPSR] = fp[FPIAR] = 0
}
export const fpRegister = (fp: Int32Array, index: number) =>
	(BigInt((fp[index * 3] >>> 16) & 0xffff) << 64n) | (BigInt(fp[index * 3 + 1] >>> 0) << 32n) | BigInt(fp[index * 3 + 2] >>> 0)
export function setRegister(fp: Int32Array, index: number, raw: bigint) {
	fp[index * 3] = Number((raw >> 64n) & 0xffffn) << 16
	fp[index * 3 + 1] = Number((raw >> 32n) & 0xffffffffn)
	fp[index * 3 + 2] = Number(raw & 0xffffffffn)
}

const MODES: readonly BinaryRounding[] = ['nearest', 'zero', 'down', 'up']
const rounding = (fp: Int32Array) => MODES[(fp[FPCR] >> 4) & 3]
/** Rounding precision narrows the mantissa only; the extended exponent range is kept. */
const format = (fp: Int32Array) => precisionFormat([64, 24, 53, 64][(fp[FPCR] >> 6) & 3])
const fromBinaryFlags = (flags: number) =>
	(flags & E.invalid ? OPERR : 0) |
	(flags & E.zeroDivide ? DZ : 0) |
	(flags & E.overflow ? OVFL : 0) |
	(flags & E.underflow ? UNFL : 0) |
	(flags & E.inexact ? INEX2 : 0)

interface Value {
	raw: bigint
	value: BinaryFloat
}
const value80 = (raw: bigint): Value => ({ raw, value: unpack80(raw) })

class Operation {
	exceptions = 0
	constructor(readonly cpu: M68kCpu) {}
	get fp() {
		return this.cpu.fp
	}
	/** Merge into FPSR: status byte, accrued byte, then an enabled exception faults. */
	finish(clearStatus: boolean) {
		const fp = this.fp,
			x = this.exceptions
		if (clearStatus) fp[FPSR] &= ~0xff00
		fp[FPSR] |= x
		fp[FPSR] |=
			(x & (BSUN | SNAN | OPERR) ? 0x80 : 0) |
			(x & OVFL ? 0x40 : 0) |
			(x & UNFL && x & INEX2 ? 0x20 : 0) |
			(x & DZ ? 0x10 : 0) |
			(x & (INEX1 | INEX2 | OVFL) ? 0x08 : 0)
		const enabled = x & fp[FPCR] & 0xff00
		if (enabled) {
			const names = EXCEPTION_NAMES.filter((_, bit) => enabled & (0x100 << bit)).join(', ')
			throw new Error(`Enabled FPU exception ${names}: coprocessor exception processing is not simulated`)
		}
	}
	readBits(ea: Operand, bytes: number): bigint {
		if (ea.mode === 7 && ea.reg === 4) {
			const bits = ea.extension.reduce((value, word) => (value << 16n) | BigInt(word), 0n)
			return bytes === 1 ? bits & 255n : bits
		}
		const location = this.cpu.resolve(ea, bytes)
		return this.readAt(location, bytes)
	}
	readAt(location: { kind: string; index: number }, bytes: number) {
		if (location.kind !== 'memory') return BigInt(this.cpu.read(location as never, bytes))
		let bits = 0n
		for (let offset = 0; offset < bytes; offset += 4) {
			const size = Math.min(4, bytes - offset)
			bits = (bits << BigInt(size * 8)) | BigInt(this.cpu.readMemory(location.index + offset, size))
		}
		return bits
	}
	writeAt(location: { kind: string; index: number }, bytes: number, bits: bigint) {
		if (location.kind !== 'memory') {
			this.cpu.write(location as never, bytes, Number(bits & 0xffffffffn) | 0)
			return
		}
		for (let offset = 0; offset < bytes; offset += 4) {
			const size = Math.min(4, bytes - offset)
			this.cpu.writeMemory(location.index + offset, Number((bits >> BigInt((bytes - offset - size) * 8)) & ((1n << BigInt(size * 8)) - 1n)), size)
		}
	}
	/** Convert a source operand to extended; packed decimal sets INEX1 rather than INEX2. */
	load(formatCode: number, bits: bigint): Value {
		const fp = this.fp
		if (formatCode === LONG || formatCode === WORD || formatCode === BYTE) {
			const integer = BigInt.asIntN(FORMAT_BYTES[formatCode] * 8, bits),
				value = integer ? binaryInteger(integer) : binaryZero()
			return { raw: pack80(value), value }
		}
		if (formatCode === SINGLE || formatCode === DOUBLE) return fromIeee(bits, formatCode === DOUBLE)
		if (formatCode === EXTENDED) return value80(fromMemory96(bits))
		const packed = fromPacked(bits, rounding(fp), precisionFormat(64))
		if (packed.flags & E.invalid) this.exceptions |= OPERR
		if (packed.flags & E.inexact) this.exceptions |= INEX1
		return { raw: packed.raw ?? pack80(packed.value), value: packed.value }
	}
	/** Round to the FPCR precision and store, setting the condition codes. */
	store(index: number, computed: BinaryResult | Value, precision: BinaryFormat = format(this.fp)) {
		let raw: bigint
		if ('raw' in computed) raw = computed.raw
		else {
			const rounded = computed.value.special ? computed : round(computed.value, precision, rounding(this.fp))
			this.exceptions |= fromBinaryFlags(computed.flags | rounded.flags)
			raw = pack80(rounded.value)
		}
		setRegister(this.fp, index, raw)
		this.conditionCodes(raw)
	}
	conditionCodes(raw: bigint) {
		const value = unpack80(raw)
		this.fp[FPSR] =
			(this.fp[FPSR] & 0x00ffffff) |
			(value.negative ? CC_N : 0) |
			(value.special === 'nan' ? CC_NAN : value.special === 'infinity' ? CC_I : value.significand ? 0 : CC_Z)
	}
	/** NaN operands propagate: the destination's NaN wins, made quiet; a signaling NaN sets SNAN. */
	nan(...operands: Value[]): Value | null {
		const nans = operands.filter((operand) => operand.value.special === 'nan')
		if (!nans.length) return null
		if (nans.some((operand) => isSignalingNaN80(operand.raw))) this.exceptions |= SNAN
		return value80(quietNaN80(nans[nans.length - 1].raw))
	}
	invalid(): Value {
		this.exceptions |= OPERR
		return value80(DEFAULT_NAN)
	}
}

export function executeFpu(cpu: M68kCpu, d: Decoded, address: number) {
	const f = d.fpu!,
		op = new Operation(cpu),
		fp = cpu.fp
	const condition = () => {
		const result = fpCondition(f.condition, fp[FPSR])
		// IEEE-nonaware predicates 16-31 signal BSUN on an unordered result.
		if (f.condition & 16 && fp[FPSR] & CC_NAN) op.exceptions |= BSUN
		fp[FPSR] &= ~BSUN
		op.finish(false)
		return result
	}
	switch (f.kind) {
		case BRANCH: {
			if (d.name === 'fnop') return
			const target = (address + 2 + d.value!) >>> 0,
				taken = condition()
			if (taken) {
				cpu.range(target, 2, true)
				cpu.pc = target
			}
			if (f.condition !== 0 && f.condition !== 15) for (const observer of cpu.observers) observer.onBranch?.(address, taken, target)
			return
		}
		case DECREMENT: {
			const target = (address + 4 + d.value!) >>> 0
			let taken = false
			if (!condition()) {
				const value = (cpu.registers[d.reg!] - 1) & 65535
				cpu.registers[d.reg!] = (cpu.registers[d.reg!] & 0xffff0000) | value
				taken = value !== 65535
				if (taken) {
					cpu.range(target, 2, true)
					cpu.pc = target
				}
			}
			for (const observer of cpu.observers) observer.onBranch?.(address, taken, target)
			return
		}
		case SET:
			cpu.write(cpu.resolve(d.destination!, 1), 1, condition() ? 255 : 0)
			return
		case TRAP:
			if (condition()) throw new Error(`${d.name.toUpperCase()} trap taken: exception processing is not simulated`)
			return
		case CONTROL_IN:
		case CONTROL_OUT: {
			const mask = (f.command >> 10) & 7,
				registers = [FPCR, FPSR, FPIAR].filter((_, i) => mask & (4 >> i)),
				operand = (f.kind === CONTROL_IN ? d.source : d.destination)!
			if (operand.mode <= 1) {
				const register = cpu.registers[operand.reg + operand.mode * 8]
				if (f.kind === CONTROL_IN) fp[registers[0]] = register
				else cpu.registers[operand.reg + operand.mode * 8] = fp[registers[0]]
			} else if (f.kind === CONTROL_IN) {
				const bits = op.readBits(operand, 4 * registers.length)
				registers.forEach((register, i) => {
					fp[register] = Number((bits >> BigInt((registers.length - 1 - i) * 32)) & 0xffffffffn)
				})
			} else {
				const location = cpu.resolve(operand, 4 * registers.length)
				registers.forEach((register, i) => cpu.writeMemory(location.index + i * 4, fp[register], 4))
			}
			fp[FPCR] &= FPCR_MASK
			fp[FPSR] &= FPSR_MASK
			return
		}
		case MOVEM_IN:
		case MOVEM_OUT: {
			const operand = (f.kind === MOVEM_IN ? d.source : d.destination)!,
				// A dynamic predecrement list in Dn has FP7 in bit 7, like the static form.
				dynamic = cpu.registers[d.reg ?? 0] & 255,
				list = f.list >= 0 ? f.list : operand.mode === 4 ? reverseByte(dynamic) : dynamic,
				selected = Array.from({ length: 8 }, (_, i) => i).filter((i) => list & (0x80 >> i)),
				location = cpu.resolve(operand, 12 * selected.length, operand.mode !== 3 && operand.mode !== 4)
			selected.forEach((register, i) => {
				const at = { kind: 'memory', index: location.index + i * 12 }
				if (f.kind === MOVEM_IN) setRegister(fp, register, fromMemory96(op.readAt(at, 12)))
				else op.writeAt(at, 12, toMemory96(fpRegister(fp, register)))
			})
			return
		}
	}
	fp[FPIAR] = address
	const command = f.command,
		destination = (command >> 7) & 7,
		mode = rounding(fp)
	if (f.kind === CONSTANT) {
		const constant = romConstant(command & 0x7f, format(fp), mode)
		if (!constant) throw new Error(`Undefined FMOVECR offset $${(command & 0x7f).toString(16)}`)
		op.store(destination, constant)
		op.finish(true)
		return
	}
	if (f.kind === MOVE_OUT) {
		const source = value80(fpRegister(fp, destination)),
			bytes = FORMAT_BYTES[f.format],
			location = cpu.resolve(d.destination!, bytes)
		if (isSignalingNaN80(source.raw)) {
			op.exceptions |= SNAN
			source.raw = quietNaN80(source.raw)
		}
		let bits: bigint
		if (f.format === EXTENDED) bits = toMemory96(source.raw)
		else if (f.format === SINGLE || f.format === DOUBLE) {
			const converted = toIeee(source.raw, source.value, f.format === DOUBLE, mode)
			op.exceptions |= fromBinaryFlags(converted.flags)
			bits = converted.bits
		} else if (f.format === PACKED || f.format === PACKED_DYNAMIC) {
			const k = f.format === PACKED ? kFactor(command) : (cpu.registers[(command >> 4) & 7] << 25) >> 25,
				converted = toPacked(source.raw, source.value, k, mode)
			op.exceptions |= fromBinaryFlags(converted.flags)
			bits = converted.bits
		} else {
			const width = BigInt(bytes * 8),
				converted = integerBinary(source.value, mode),
				fits = converted && BigInt.asIntN(Number(width), converted.value) === converted.value
			if (fits) {
				if (converted.inexact) op.exceptions |= INEX2
				bits = converted.value
			} else {
				// Out of range or NaN: OPERR and the largest integer of the operand's sign.
				op.exceptions |= OPERR
				bits = source.value.negative ? -(1n << (width - 1n)) : (1n << (width - 1n)) - 1n
				if (source.value.special === 'nan') bits = (1n << (width - 1n)) - 1n
			}
			bits = BigInt.asUintN(Number(width), bits)
		}
		op.finish(true)
		op.writeAt(location, bytes, bits)
		return
	}
	// General arithmetic: operand from FPm or memory, result in FPn.
	const opmode = command & 0x7f,
		source = d.source
			? op.load(f.format, op.readBits(d.source, FORMAT_BYTES[f.format]))
			: value80(fpRegister(fp, (command >> 10) & 7)),
		target = value80(fpRegister(fp, destination)),
		precision = format(fp)
	if (opmode === TEST) {
		op.nan(source)
		op.conditionCodes(source.raw)
		op.finish(true)
		return
	}
	if (DYADIC[opmode]) {
		dyadic(op, opmode, source, target, destination, precision, mode)
		op.finish(true)
		return
	}
	if (opmode >> 3 === 6) {
		const nan = op.nan(source)
		const [sine, cosine] = nan ? [nan, nan] : [transcendental(op, 'fsin', source.value), transcendental(op, 'fcos', source.value)]
		op.store(opmode & 7, cosine, precision)
		op.store(destination, sine, precision)
		op.finish(true)
		return
	}
	const nan = op.nan(source)
	op.store(destination, nan ?? monadic(op, d.name, source, mode, precision), precision)
	op.finish(true)
}

function monadic(op: Operation, name: string, source: Value, mode: BinaryRounding, precision: BinaryFormat): BinaryResult | Value {
	const x = source.value,
		exact = (value: BinaryFloat): BinaryResult => ({ value, flags: 0, roundedUp: false })
	const top = x.special || !x.significand ? 0 : x.significand.toString(2).length - 1 + x.exponent
	switch (name) {
		case 'fmove':
			return exact(x)
		case 'fabs':
			return exact({ ...x, negative: false })
		case 'fneg':
			return exact({ ...x, negative: !x.negative })
		case 'fint':
		case 'fintrz': {
			const converted = integerBinary(x, name === 'fintrz' ? 'zero' : mode)
			if (!converted) return exact(x)
			return {
				value: converted.value ? binaryInteger(converted.value) : binaryZero(x.negative),
				flags: converted.inexact ? E.inexact : 0,
				roundedUp: false
			}
		}
		case 'fsqrt':
			return sqrtBinary(x, precision, mode)
		case 'fgetexp':
			if (x.special === 'infinity') return op.invalid()
			return exact(x.significand ? binaryInteger(BigInt(top)) : x)
		case 'fgetman':
			if (x.special === 'infinity') return op.invalid()
			return exact(x.significand ? { ...x, exponent: x.exponent - top } : x)
	}
	return transcendental(op, name, x)
}

function dyadic(op: Operation, opmode: number, source: Value, target: Value, destination: number, precision: BinaryFormat, mode: BinaryRounding) {
	const name = DYADIC[opmode],
		s = source.value,
		t = target.value,
		nan = op.nan(source, target)
	if (name === 'fcmp') {
		if (nan) {
			op.conditionCodes(nan.raw)
			return
		}
		const relation = compareBinary(t, s)
		const negativeZero = relation === 0 && (t.special ? t.negative : !t.significand && t.negative && !s.negative)
		op.fp[FPSR] = (op.fp[FPSR] & 0x00ffffff) | (relation! < 0 || negativeZero ? CC_N : 0) | (relation === 0 ? CC_Z : 0)
		return
	}
	if (nan) {
		op.store(destination, nan)
		return
	}
	if (name === 'fmod' || name === 'frem') {
		op.store(destination, remainder(op, t, s, name === 'frem'), precision)
		return
	}
	if (name === 'fscale') {
		if (s.special) {
			op.store(destination, op.invalid())
			return
		}
		const scale = integerBinary(s, 'zero')!.value
		if (t.special || !t.significand) {
			op.store(destination, { value: t, flags: 0, roundedUp: false })
			return
		}
		const clamped = Number(scale > 70000n ? 70000n : scale < -70000n ? -70000n : scale)
		op.store(destination, roundBinary(t.negative, t.significand, t.exponent + clamped, 1n, precision, mode), precision)
		return
	}
	const single = name === 'fsgldiv' || name === 'fsglmul',
		chosen = single ? precisionFormat(24) : precision
	const computed =
		name === 'fadd' || name === 'fsub'
			? calculateBinary('add', t, name === 'fsub' ? { ...s, negative: !s.negative } : s, chosen, mode)
			: calculateBinary(name === 'fmul' || name === 'fsglmul' ? 'multiply' : 'divide', t, s, chosen, mode)
	op.store(destination, computed, chosen)
}

/** FMOD truncates the quotient; FREM rounds it to nearest even (IEEE remainder). FPSR keeps its sign and low 7 bits. */
function remainder(op: Operation, dividend: BinaryFloat, divisor: BinaryFloat, ieee: boolean): BinaryResult | Value {
	const quotient = (sign: boolean, low: bigint) => {
		op.fp[FPSR] = (op.fp[FPSR] & ~0x00ff0000) | (sign ? 0x00800000 : 0) | (Number(low & 0x7fn) << 16)
	}
	const sign = dividend.negative !== divisor.negative
	if (dividend.special || (!divisor.special && !divisor.significand)) {
		quotient(sign, 0n)
		return op.invalid()
	}
	if (divisor.special || !dividend.significand) {
		quotient(sign, 0n)
		return { value: dividend, flags: 0, roundedUp: false }
	}
	const exponent = Math.min(dividend.exponent, divisor.exponent),
		a = dividend.significand << BigInt(dividend.exponent - exponent),
		b = divisor.significand << BigInt(divisor.exponent - exponent)
	let q = a / b,
		r = a - q * b
	if (ieee && (r * 2n > b || (r * 2n === b && q & 1n))) {
		q++
		r -= b
	}
	quotient(sign, q)
	if (!r) return { value: binaryZero(dividend.negative), flags: 0, roundedUp: false }
	return { value: { negative: dividend.negative !== r < 0n, significand: r < 0n ? -r : r, exponent }, flags: 0, roundedUp: false }
}

// Transcendentals evaluate in IEEE double (about 53 significant bits), then round to the FPCR precision.
const ODD_TINY = new Set(['fsin', 'ftan', 'fasin', 'fatan', 'fsinh', 'ftanh', 'fatanh', 'fetoxm1', 'flognp1'])
const ONE_AT_ZERO = new Set(['fcos', 'fcosh', 'fetox', 'ftwotox', 'ftentox'])
function transcendental(op: Operation, name: string, x: BinaryFloat): BinaryResult | Value {
	const inexact = (value: BinaryFloat): BinaryResult => ({ value, flags: E.inexact, roundedUp: false })
	const zero = !x.special && !x.significand,
		top = x.special || zero ? 0 : x.significand.toString(2).length - 1 + x.exponent
	if (zero) {
		if (ODD_TINY.has(name)) return { value: x, flags: 0, roundedUp: false }
		if (ONE_AT_ZERO.has(name)) return { value: binaryInteger(1n), flags: 0, roundedUp: false }
		if (name === 'facos') return transcendentalDouble(op, name, 0)
		if (['flogn', 'flog2', 'flog10'].includes(name)) {
			op.exceptions |= DZ
			return { value: binaryInfinity(true), flags: 0, roundedUp: false }
		}
	}
	// Below double's range, odd functions return their argument and the rest their value at zero.
	if (!x.special && top < -60) {
		if (ODD_TINY.has(name)) return inexact(x)
		if (ONE_AT_ZERO.has(name)) return inexact(binaryInteger(1n))
	}
	if (!x.special && ['flogn', 'flog2', 'flog10'].includes(name) && !x.negative) {
		// Split the exponent so logs of any extended value stay finite.
		const mantissa = toDouble({ ...x, exponent: x.exponent - top }),
			result = name === 'flog2' ? Math.log2(mantissa) + top : name === 'flogn' ? Math.log(mantissa) + top * Math.LN2 : Math.log10(mantissa) + top * Math.log10(2)
		const exactLog = (name === 'flog2' && mantissa === 1) || (name === 'flog10' && powerOfTen(x) !== null) || (mantissa === 1 && top === 0)
		return { value: fromDouble(name === 'flog10' && exactLog ? powerOfTen(x)! : result), flags: exactLog ? 0 : E.inexact, roundedUp: false }
	}
	if (!x.special && ['fetox', 'ftwotox', 'ftentox', 'fsinh', 'fcosh'].includes(name) && top > 8) {
		// Large arguments: 2^(x·log2 b) with the integer part applied exactly to the exponent.
		// Overflow and underflow then come from rounding the exact result.
		const hyperbolic = name === 'fsinh' || name === 'fcosh',
			base = name === 'ftwotox' ? 1 : name === 'ftentox' ? Math.log2(10) : Math.LOG2E,
			argument = hyperbolic ? Math.abs(toDouble(x)) : toDouble(x),
			scaled = Number.isFinite(argument) ? argument * base : Math.sign(argument) * 1e6,
			whole = Math.floor(scaled),
			fraction = fromDouble(2 ** (scaled - whole))
		if (name === 'ftentox' && !x.negative && top < 5) {
			const integer = integerBinary(x, 'zero')!
			if (!integer.inexact && integer.value <= 27n) return { value: binaryInteger(10n ** integer.value), flags: 0, roundedUp: false }
		}
		return {
			value: { ...fraction, negative: name === 'fsinh' && x.negative, exponent: fraction.exponent + whole - (hyperbolic ? 1 : 0) },
			flags: name === 'ftwotox' && scaled === whole ? 0 : E.inexact,
			roundedUp: false
		}
	}
	return transcendentalDouble(op, name, toDouble(x))
}
function powerOfTen(x: BinaryFloat): number | null {
	if (x.special || x.negative || x.exponent < 0) return null
	const value = x.significand << BigInt(x.exponent)
	for (let n = 0, power = 1n; power <= value; n++, power *= 10n) if (power === value) return n
	return null
}
const FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
	fsin: Math.sin, fcos: Math.cos, ftan: Math.tan, fasin: Math.asin, facos: Math.acos, fatan: Math.atan,
	fsinh: Math.sinh, fcosh: Math.cosh, ftanh: Math.tanh, fatanh: Math.atanh, fetox: Math.exp, fetoxm1: Math.expm1,
	ftwotox: (x) => 2 ** x, ftentox: (x) => 10 ** x, flogn: Math.log, flognp1: Math.log1p, flog10: Math.log10, flog2: Math.log2
}
function transcendentalDouble(op: Operation, name: string, x: number): BinaryResult | Value {
	const result = FUNCTIONS[name](x)
	if (Number.isNaN(result)) return op.invalid()
	if (!Number.isFinite(result)) {
		if (Number.isFinite(x)) op.exceptions |= DZ
		return { value: binaryInfinity(result < 0), flags: 0, roundedUp: false }
	}
	const exact = (name === 'ftwotox' && Number.isInteger(x)) || (name === 'ftentox' && Number.isInteger(x) && x >= 0 && x <= 22) || (name === 'flognp1' && x === 0)
	return { value: fromDouble(result), flags: exact || !Number.isFinite(x) ? 0 : E.inexact, roundedUp: false }
}
