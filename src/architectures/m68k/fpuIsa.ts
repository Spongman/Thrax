import type { Decoded, Operand } from './decode'
import { describe80, fromIeee, fromMemory96, toDouble } from './extended'

export type Coprocessor = 'none' | '68881' | '68882'
/** FP0-FP7 occupy three longs each in their 96-bit memory layout, then the control registers. */
export const FPCR = 24,
	FPSR = 25,
	FPIAR = 26,
	FP_WORDS = 27

// Instruction kinds.
export const GENERAL = 0,
	MOVE_OUT = 1,
	CONSTANT = 2,
	CONTROL_IN = 3,
	CONTROL_OUT = 4,
	MOVEM_IN = 5,
	MOVEM_OUT = 6,
	BRANCH = 7,
	SET = 8,
	DECREMENT = 9,
	TRAP = 10
export interface FpuFields {
	kind: number
	/** The command word; zero for conditional instructions. */
	command: number
	format: number
	condition: number
	/** FMOVEM register mask in architectural FP0..FP7 order, or -1 when dynamic. */
	list: number
}
// Formats by source/destination specifier.
export const LONG = 0,
	SINGLE = 1,
	EXTENDED = 2,
	PACKED = 3,
	WORD = 4,
	DOUBLE = 5,
	BYTE = 6,
	PACKED_DYNAMIC = 7
export const FORMAT_BYTES = [4, 4, 12, 12, 2, 8, 1, 12]
export const FORMAT_SUFFIX = ['l', 's', 'x', 'p', 'w', 'd', 'b', 'p']
export const integerFormat = (format: number) => format === LONG || format === WORD || format === BYTE

export const MONADIC: Readonly<Record<number, string>> = {
	0x00: 'fmove', 0x01: 'fint', 0x02: 'fsinh', 0x03: 'fintrz', 0x04: 'fsqrt', 0x06: 'flognp1', 0x08: 'fetoxm1',
	0x09: 'ftanh', 0x0a: 'fatan', 0x0c: 'fasin', 0x0d: 'fatanh', 0x0e: 'fsin', 0x0f: 'ftan', 0x10: 'fetox',
	0x11: 'ftwotox', 0x12: 'ftentox', 0x14: 'flogn', 0x15: 'flog10', 0x16: 'flog2', 0x18: 'fabs', 0x19: 'fcosh',
	0x1a: 'fneg', 0x1c: 'facos', 0x1d: 'fcos', 0x1e: 'fgetexp', 0x1f: 'fgetman'
}
export const DYADIC: Readonly<Record<number, string>> = {
	0x20: 'fdiv', 0x21: 'fmod', 0x22: 'fadd', 0x23: 'fmul', 0x24: 'fsgldiv', 0x25: 'frem', 0x26: 'fscale',
	0x27: 'fsglmul', 0x28: 'fsub', 0x38: 'fcmp'
}
export const SINCOS = 0x30,
	TEST = 0x3a
export const OPMODES: Readonly<Record<string, number>> = Object.fromEntries([
	...Object.entries(MONADIC).map(([code, name]) => [name, Number(code)]),
	...Object.entries(DYADIC).map(([code, name]) => [name, Number(code)]),
	['fsincos', SINCOS],
	['ftst', TEST]
])
/** IEEE-aware predicates 0-15; 16-31 repeat them and also signal BSUN on NaN. */
export const FP_CONDITIONS = [
	'f', 'eq', 'ogt', 'oge', 'olt', 'ole', 'ogl', 'or', 'un', 'ueq', 'ugt', 'uge', 'ult', 'ule', 'ne', 't',
	'sf', 'seq', 'gt', 'ge', 'lt', 'le', 'gl', 'gle', 'ngle', 'ngl', 'nle', 'nlt', 'nge', 'ngt', 'sne', 'st'
]
export const CC_N = 0x08000000,
	CC_Z = 0x04000000,
	CC_I = 0x02000000,
	CC_NAN = 0x01000000
export function fpCondition(code: number, fpsr: number): boolean {
	const n = !!(fpsr & CC_N),
		z = !!(fpsr & CC_Z),
		nan = !!(fpsr & CC_NAN)
	switch (code & 15) {
		case 0: return false
		case 1: return z
		case 2: return !(nan || z || n)
		case 3: return z || !(nan || n)
		case 4: return n && !(nan || z)
		case 5: return z || (n && !nan)
		case 6: return !(nan || z)
		case 7: return !nan
		case 8: return nan
		case 9: return nan || z
		case 10: return nan || !(n || z)
		case 11: return nan || z || !n
		case 12: return nan || (n && !z)
		case 13: return nan || z || n
		case 14: return !z
		default: return true
	}
}

const CONTROL_NAMES = ['fpiar', 'fpsr', 'fpcr']
export const controlList = (mask: number) =>
	[4, 2, 1].filter((bit) => mask & bit).map((bit) => CONTROL_NAMES[Math.log2(bit)]).join('/')
const memoryOnly = (ea: Operand) => ea.mode >= 2
const alterable = (ea: Operand) => ea.mode !== 1 && !(ea.mode === 7 && ea.reg >= 2)
const controlMode = (ea: Operand) => [2, 5, 6, 7].includes(ea.mode) && !(ea.mode === 7 && ea.reg > 3)

/** Coprocessor ID 1 (MC68881/MC68882) F-line words; other IDs and FSAVE/FRESTORE are rejected. */
export function decodeFpu(
	first: number,
	d: Decoded,
	word: () => number,
	ea: (mode: number, reg: number, size: number) => Operand
) {
	const type = (first >> 6) & 7,
		mode = (first >> 3) & 7,
		reg = first & 7
	const fields: FpuFields = { kind: GENERAL, command: 0, format: EXTENDED, condition: 0, list: 0 }
	d.fpu = fields
	if (type === 2 || type === 3) {
		fields.kind = BRANCH
		fields.condition = first & 0x3f
		if (fields.condition > 31) throw new Error('Undefined FBcc predicate')
		d.value = type === 3 ? (word() * 65536 + word()) | 0 : (word() << 16) >> 16
		d.size = type === 3 ? 4 : 2
		d.name = !fields.condition && type === 2 && d.value === 0 ? 'fnop' : `fb${FP_CONDITIONS[fields.condition]}`
		return
	}
	if (type === 1) {
		const extension = word()
		if (extension & 0xffc0 || extension > 31) throw new Error('Undefined FPU predicate')
		fields.condition = extension
		if (mode === 1) {
			fields.kind = DECREMENT
			d.name = `fdb${FP_CONDITIONS[extension]}`
			d.reg = reg
			d.value = (word() << 16) >> 16
			d.size = 2
		} else if (mode === 7 && reg >= 2) {
			if (reg > 4) throw new Error('Illegal FTRAPcc operand mode')
			fields.kind = TRAP
			d.name = `ftrap${FP_CONDITIONS[extension]}`
			d.size = reg === 2 ? 2 : reg === 3 ? 4 : 0
			if (reg === 2) d.value = word()
			else if (reg === 3) d.value = (word() * 65536 + word()) >>> 0
		} else {
			fields.kind = SET
			d.name = `fs${FP_CONDITIONS[extension]}`
			d.size = 1
			d.destination = ea(mode, reg, 1)
		}
		return
	}
	if (type === 4 || type === 5) throw new Error('FSAVE/FRESTORE are privileged and outside this profile')
	if (type !== 0) throw new Error('Unsupported coprocessor instruction')
	const command = word(),
		opclass = command >>> 13,
		spec = (command >> 10) & 7,
		opmode = command & 0x7f
	fields.command = command
	if (opclass === 0 || opclass === 2) {
		if (opclass === 2 && spec === 7) {
			if (first & 0x3f) throw new Error('FMOVECR has no effective address')
			fields.kind = CONSTANT
			d.name = 'fmovecr'
			d.size = 12
			return
		}
		const name = MONADIC[opmode] ?? DYADIC[opmode] ?? (opmode >> 3 === 6 ? 'fsincos' : opmode === TEST ? 'ftst' : '')
		if (!name) throw new Error(`Undefined FPU opmode $${opmode.toString(16)}`)
		d.name = name
		if (opclass === 0) {
			if (first & 0x3f) throw new Error('Illegal FPU register-to-register encoding')
			d.size = 12
			return
		}
		fields.format = spec
		d.size = FORMAT_BYTES[spec]
		d.source = ea(mode, reg, d.size)
		if (mode === 1 || (mode === 0 && !(integerFormat(spec) || spec === SINGLE)))
			throw new Error('Illegal FPU source operand')
		return
	}
	if (opclass === 3) {
		fields.kind = MOVE_OUT
		fields.format = spec
		d.name = 'fmove'
		d.size = FORMAT_BYTES[spec]
		d.destination = ea(mode, reg, d.size)
		if (!alterable(d.destination) || (mode === 0 && !(integerFormat(spec) || spec === SINGLE)))
			throw new Error('Illegal FMOVE destination')
		if (spec === PACKED_DYNAMIC && opmode & 0x0f) throw new Error('Illegal dynamic k-factor field')
		if (spec !== PACKED && spec !== PACKED_DYNAMIC && opmode) throw new Error('Unexpected k-factor field')
		return
	}
	if (opclass === 4 || opclass === 5) {
		const mask = spec,
			count = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1)
		if (command & 0x3ff || !mask) throw new Error('Illegal FPU control register transfer')
		fields.kind = opclass === 4 ? CONTROL_IN : CONTROL_OUT
		d.name = count > 1 ? 'fmovem' : 'fmove'
		d.size = 4 * count
		const operand = ea(mode, reg, d.size)
		if (opclass === 4) d.source = operand
		else d.destination = operand
		if ((mode === 1 && mask !== 1) || (mode === 0 && count > 1) || (opclass === 5 && !alterable(operand) && mode !== 1))
			throw new Error('Illegal FPU control register operand')
		return
	}
	if (opclass === 6 || opclass === 7) {
		const predecrement = !(command & 0x1000),
			dynamic = !!(command & 0x800)
		if (command & 0x0700 || (dynamic && command & 0x8f)) throw new Error('Illegal FMOVEM encoding')
		fields.kind = opclass === 6 ? MOVEM_IN : MOVEM_OUT
		fields.format = EXTENDED
		d.name = 'fmovem'
		d.size = 12
		let list = command & 0xff
		// Predecrement masks list FP7 first; store the architectural order.
		if (predecrement) list = reverseByte(list)
		fields.list = dynamic ? -1 : list
		if (dynamic) d.reg = (command >> 4) & 7
		const operand = ea(mode, reg, 12)
		if (opclass === 6) d.source = operand
		else d.destination = operand
		const valid =
			memoryOnly(operand) &&
			(predecrement
				? opclass === 7 && mode === 4
				: opclass === 6
					? mode === 3 || controlMode(operand)
					: controlMode(operand) && !(mode === 7 && reg > 1))
		if (!valid) throw new Error('Illegal FMOVEM addressing mode')
		return
	}
	throw new Error('Undefined FPU command class')
}

/** FMOVEM list bits in architectural order (bit 7 = FP0). */
export function fpList(list: number) {
	const names: string[] = []
	for (let i = 0; i < 8; i++) if (list & (0x80 >> i)) names.push(`fp${i}`)
	return names.join('/')
}
function immediateText(ea: Operand, format: number) {
	const words = ea.extension
	const bits = words.reduce((value, word) => (value << 16n) | BigInt(word), 0n)
	if (integerFormat(format)) return `#${Number(BigInt.asIntN(FORMAT_BYTES[format] * 8, format === BYTE ? bits & 255n : bits))}`
	if (format === SINGLE || format === DOUBLE) {
		const { value } = fromIeee(bits, format === DOUBLE)
		if (!value.special) return `#${describe80Value(toDouble(value))}`
	}
	if (format === EXTENDED) {
		const raw = fromMemory96(bits),
			text = describe80(raw)
		if (!/[N×]/.test(text)) return `#${text}`
	}
	return `#$${bits.toString(16)}`
}
/** The static k-factor is a 7-bit signed field. */
export const kFactor = (command: number) => ((command & 0x7f) << 25) >> 25
const describe80Value = (value: number) => (Object.is(value, -0) ? '-0.0' : Number.isInteger(value) ? `${value}.0` : String(value))

export function disassembleFpu(d: Decoded, operandText: (ea: Operand) => string): string {
	const f = d.fpu!,
		command = f.command,
		source = (command >> 10) & 7,
		destination = (command >> 7) & 7,
		ea = (operand: Operand) =>
			operand.mode === 7 && operand.reg === 4 ? immediateText(operand, f.format) : operandText(operand)
	const target = (base: number) => `$${((base + d.value!) >>> 0).toString(16)}`
	switch (f.kind) {
		case BRANCH:
			return d.name === 'fnop' ? 'fnop' : `${d.name}${d.size === 4 ? '.l' : '.w'} ${target(d.address + 2)}`
		case DECREMENT:
			return `${d.name} d${d.reg},${target(d.address + 4)}`
		case TRAP:
			return d.size ? `${d.name}.${d.size === 2 ? 'w' : 'l'} #${d.value}` : d.name
		case SET:
			return `${d.name} ${operandText(d.destination!)}`
		case CONSTANT:
			return `fmovecr.x #$${(command & 0x7f).toString(16)},fp${destination}`
		case CONTROL_IN:
		case CONTROL_OUT: {
			const list = controlList(source),
				operand = f.kind === CONTROL_IN ? ea(d.source!) : operandText(d.destination!)
			return `${d.name}.l ${f.kind === CONTROL_IN ? `${operand},${list}` : `${list},${operand}`}`
		}
		case MOVEM_IN:
		case MOVEM_OUT: {
			const list = f.list < 0 ? `d${d.reg}` : fpList(f.list)
			return f.kind === MOVEM_IN
				? `fmovem.x ${operandText(d.source!)},${list}`
				: `fmovem.x ${list},${operandText(d.destination!)}`
		}
		case MOVE_OUT: {
			const k =
				f.format === PACKED ? `{#${kFactor(command)}}` : f.format === PACKED_DYNAMIC ? `{d${(command >> 4) & 7}}` : ''
			return `fmove.${FORMAT_SUFFIX[f.format]} fp${destination},${operandText(d.destination!)}${k}`
		}
	}
	const suffix = d.source ? FORMAT_SUFFIX[f.format] : 'x',
		from = d.source ? ea(d.source) : `fp${source}`
	if (d.name === 'ftst') return `ftst.${suffix} ${from}`
	if (d.name === 'fsincos') return `fsincos.${suffix} ${from},fp${command & 7}:fp${destination}`
	if (!d.source && source === destination && MONADIC[command & 0x7f] && d.name !== 'fmove') return `${d.name}.x fp${destination}`
	return `${d.name}.${suffix} ${from},fp${destination}`
}
/** Predecrement FMOVEM masks list FP7 in bit 7; others list FP0 there. */
export const reverseByte = (bits: number) => {
	let reversed = 0
	for (let i = 0; i < 8; i++) reversed |= ((bits >> i) & 1) << (7 - i)
	return reversed
}
