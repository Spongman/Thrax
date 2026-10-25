import { binaryInteger, binaryZero } from '../../core/binaryFloat'
import { encodeEA, type EncodingContext } from './encoding'
import { EXTENDED, pack80, parseDecimal, round, toIeee, toMemory96, toPacked } from './extended'
import { DOUBLE, FORMAT_BYTES, FP_CONDITIONS, integerFormat, OPMODES, PACKED, reverseByte, SINCOS, SINGLE, TEST } from './fpuIsa'
import { dataRegister, longWords, type EffectiveAddress } from './isa'

const FORMATS: Readonly<Record<string, number>> = { l: 0, s: 1, x: 2, p: 3, w: 4, d: 5, b: 6 }
const CONTROL: Readonly<Record<string, number>> = { fpcr: 4, fpsr: 2, fpiar: 1 }
const fpRegister = (text: string) => (/^fp[0-7]$/i.test(text.trim()) ? Number(text.trim()[2]) : -1)
const isDataRegister = (text: string) => /^d[0-7]$/i.test(text.trim())
const conditionOf = (text: string) => FP_CONDITIONS.indexOf(text)
const eaBits = (ea: EffectiveAddress) => ea.mode * 8 + ea.reg

/** Mnemonics handled here: arithmetic opmodes, transfers and the FBcc/FScc/FDBcc/FTRAPcc families. */
export function isFpuMnemonic(name: string) {
	if (name in OPMODES || ['fmovecr', 'fmovem', 'fnop', 'fsave', 'frestore', 'fdbra'].includes(name)) return true
	const match = /^f(b|s|db|trap)([a-z]+)$/.exec(name)
	return !!match && conditionOf(match[2]) >= 0
}
/** A slash/dash FP register list in architectural order: bit 7 is FP0. */
function fpList(text: string): number {
	let mask = 0
	for (const part of text.toLowerCase().split('/')) {
		const [from, to = from] = part.split('-').map(fpRegister)
		if (from < 0 || to < from) return -1
		for (let r = from; r <= to; r++) mask |= 0x80 >> r
	}
	return mask
}
function controlMask(text: string): number {
	let mask = 0
	for (const part of text.toLowerCase().split('/')) {
		if (!CONTROL[part.trim()]) return 0
		mask |= CONTROL[part.trim()]
	}
	return mask
}
function range(value: number, low: number, high: number, c: EncodingContext, what: string) {
	if (c.emitting && (!Number.isInteger(value) || value < low || value > high)) throw new Error(`${what} out of range (${value})`)
	return value
}
const words = (bits: bigint, count: number) => Array.from({ length: count }, (_, i) => Number((bits >> BigInt((count - 1 - i) * 16)) & 0xffffn))

/** Immediates for S/D/X/P accept decimal literals such as `#-1.25e3`; integers convert exactly. */
function immediate(text: string, format: number, c: EncodingContext): number[] {
	const literal = text.slice(1).trim()
	if (integerFormat(format)) return encodeEA(text, FORMAT_BYTES[format], c, 0).extension
	const parsed = /[.e]/i.test(literal) && !/^\$|^0x/i.test(literal) ? parseDecimal(literal) : null
	if (/[.]/.test(literal) && !parsed) throw new Error(`Invalid floating-point literal '${literal}'`)
	const integer = parsed ? null : c.value(literal),
		value = parsed ? parsed.value : integer ? binaryInteger(BigInt(integer)) : binaryZero()
	if (format === SINGLE || format === DOUBLE) return words(toIeee(0n, value, format === DOUBLE, 'nearest').bits, format === DOUBLE ? 4 : 2)
	const raw = pack80(round(value, EXTENDED, 'nearest').value)
	return words(format === PACKED ? toPacked(raw, value, 17, 'nearest').bits : toMemory96(raw), 6)
}
function source(text: string, format: number, c: EncodingContext, extensionPc: number): EffectiveAddress {
	if (text.trim().startsWith('#')) return { mode: 7, reg: 4, extension: immediate(text.trim(), format, c) }
	const ea = encodeEA(text, Math.min(4, FORMAT_BYTES[format]), c, extensionPc)
	if (ea.mode === 1 || (ea.mode === 0 && !(integerFormat(format) || format === SINGLE)))
		throw new Error('FPU source must be memory, an immediate, or a data register with .B/.W/.L/.S')
	return ea
}
function destination(text: string, format: number, c: EncodingContext, extensionPc: number): EffectiveAddress {
	const ea = encodeEA(text, Math.min(4, FORMAT_BYTES[format]), c, extensionPc)
	if (ea.mode === 1 || (ea.mode === 7 && ea.reg >= 2) || (ea.mode === 0 && !(integerFormat(format) || format === SINGLE)))
		throw new Error('Expected a data-alterable FPU destination')
	return ea
}

export function encodeFpu(operation: string, args: string[], c: EncodingContext): number[] | null {
	const [name, suffix = '', extra] = operation.toLowerCase().split('.')
	if (!isFpuMnemonic(name)) return null
	if (extra !== undefined) throw new Error('Invalid instruction size')
	if (!c.fpu) throw new Error(`${name.toUpperCase()} needs an MC68881/MC68882 coprocessor on the MC68020`)
	if (name === 'fsave' || name === 'frestore') throw new Error(`Privileged ${name.toUpperCase()} is outside this profile`)
	const need = (count: number) => {
		if (args.length !== count) throw new Error(`${name} expects ${count} operand${count === 1 ? '' : 's'}`)
	}
	const sized = (...allowed: string[]) => {
		if (suffix && !allowed.includes(suffix)) throw new Error(`${name.toUpperCase()} does not take .${suffix.toUpperCase()}`)
	}
	if (name === 'fnop') {
		need(0)
		sized()
		return [0xf280, 0]
	}
	const conditional = /^f(db|trap|b|s)([a-z]+)$/.exec(name === 'fdbra' ? 'fdbf' : name)
	if (conditional && !(name in OPMODES)) {
		const cc = conditionOf(conditional[2])
		if (conditional[1] === 'b') {
			need(1)
			sized('w', 'l')
			const offset = c.value(args[0]) - (c.pc + 2)
			if (suffix === 'l') return [0xf2c0 | cc, ...longWords(range(offset, -0x80000000, 0x7fffffff, c, 'FBcc displacement'))]
			return [0xf280 | cc, range(offset, -32768, 32767, c, 'FBcc displacement') & 0xffff]
		}
		if (conditional[1] === 'db') {
			need(2)
			sized('w')
			return [0xf248 | dataRegister(args[0]), cc, range(c.value(args[1]) - (c.pc + 4), -32768, 32767, c, 'FDBcc displacement') & 0xffff]
		}
		if (conditional[1] === 'trap') {
			sized('w', 'l')
			if (!suffix) {
				need(0)
				return [0xf27c, cc]
			}
			need(1)
			if (!args[0].startsWith('#')) throw new Error('Expected #immediate')
			const value = c.value(args[0].slice(1))
			return suffix === 'w'
				? [0xf27a, cc, range(value, -32768, 65535, c, 'FTRAPcc operand') & 0xffff]
				: [0xf27b, cc, ...longWords(value)]
		}
		need(1)
		sized('b')
		const ea = destination(args[0], 6, c, c.pc + 4)
		return [0xf240 | eaBits(ea), cc, ...ea.extension]
	}
	if (name === 'fmovecr') {
		need(2)
		sized('x')
		const register = fpRegister(args[1])
		if (!args[0].startsWith('#') || register < 0) throw new Error('FMOVECR expects #offset,FPn')
		return [0xf200, 0x5c00 | (register << 7) | range(c.value(args[0].slice(1)), 0, 0x7f, c, 'ROM offset')]
	}
	const control = (a: string, b: string) => controlMask(b) && !controlMask(a)
	if (name === 'fmovem' || (name === 'fmove' && (controlMask(args[0] ?? '') || controlMask(args[1] ?? '')))) {
		need(2)
		if (controlMask(args[0]) || controlMask(args[1])) {
			sized('l')
			const toControl = control(args[0], args[1]),
				mask = controlMask(args[toControl ? 1 : 0]),
				count = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1)
			if (name === 'fmove' && count > 1) throw new Error('Use FMOVEM for several control registers')
			const text = args[toControl ? 0 : 1].trim()
			let ea: EffectiveAddress
			if (toControl && text.startsWith('#')) {
				if (count !== 1) throw new Error('Immediate control transfers take one register')
				ea = { mode: 7, reg: 4, extension: longWords(c.value(text.slice(1))) }
			} else ea = encodeEA(text, 4, c, c.pc + 4)
			if ((ea.mode === 1 && mask !== 1) || (ea.mode === 0 && count > 1) || (!toControl && ea.mode === 7 && ea.reg >= 2))
				throw new Error('Invalid FPU control register operand')
			return [0xf200 | eaBits(ea), (toControl ? 0x8000 : 0xa000) | (mask << 10), ...ea.extension]
		}
		sized('x')
		const store = fpList(args[0]) > 0 || (isDataRegister(args[0]) && fpList(args[1]) <= 0),
			listText = args[store ? 0 : 1],
			dynamic = isDataRegister(listText),
			list = dynamic ? 0 : fpList(listText)
		if (!dynamic && list <= 0) throw new Error('Expected an FP register list or data register')
		const ea = encodeEA(args[store ? 1 : 0], 4, c, c.pc + 4),
			predecrement = ea.mode === 4
		if (store ? !predecrement && (![2, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 1)) : ![2, 3, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 3))
			throw new Error(`Invalid FMOVEM ${store ? 'store' : 'load'} mode`)
		// Predecrement masks list FP7 in bit 7.
		let bits = list
		if (predecrement) bits = reverseByte(list)
		const command = (store ? 0xe000 : 0xc000) | (predecrement ? 0 : 0x1000) | (dynamic ? 0x800 | (dataRegister(listText) << 4) : bits)
		return [0xf200 | eaBits(ea), command, ...ea.extension]
	}
	const opmode = OPMODES[name],
		format = FORMATS[suffix || 'x']
	if (format === undefined) throw new Error('Invalid FPU operand format')
	const fpSource = fpRegister(args[0] ?? '')
	if (name === 'fmove' && args.length === 2 && fpSource >= 0 && fpRegister(args[1]) < 0) {
		// FMOVE FPn,<ea>{k}: a k-factor is only for packed decimal.
		const kMatch = /^(.*?)\{\s*(#[^}]+|d[0-7])\s*\}$/i.exec(args[1].trim())
		if (kMatch && format !== PACKED) throw new Error('A k-factor needs .P')
		const ea = destination(kMatch ? kMatch[1] : args[1], format, c, c.pc + 4)
		let k = format === PACKED ? 17 : 0,
			code = format
		if (kMatch && isDataRegister(kMatch[2])) {
			code = 7
			k = dataRegister(kMatch[2]) << 4
		} else if (kMatch) k = range(c.value(kMatch[2].slice(1)), -64, 63, c, 'k-factor') & 0x7f
		return [0xf200 | eaBits(ea), 0x6000 | (code << 10) | (fpSource << 7) | k, ...ea.extension]
	}
	if (name === 'ftst') {
		need(1)
		if (fpSource >= 0) return [0xf200, (fpSource << 10) | TEST]
		const ea = source(args[0], format, c, c.pc + 4)
		return [0xf200 | eaBits(ea), 0x4000 | (format << 10) | TEST, ...ea.extension]
	}
	let target: number,
		extra7 = 0
	if (name === 'fsincos') {
		need(2)
		const pair = /^(fp[0-7])\s*:\s*(fp[0-7])$/i.exec(args[1].trim())
		if (!pair) throw new Error('FSINCOS expects <ea>,FPc:FPs')
		target = fpRegister(pair[2])
		extra7 = fpRegister(pair[1])
	} else if (args.length === 1 && opmode < 0x20 && name !== 'fmove' && fpSource >= 0) target = fpSource
	else {
		need(2)
		target = fpRegister(args[1])
		if (target < 0) throw new Error(`Expected FP register destination, got '${args[1]}'`)
	}
	const command = (target << 7) | (opmode === SINCOS ? SINCOS | extra7 : opmode)
	if (fpSource >= 0) {
		if (suffix && suffix !== 'x') throw new Error('Register-to-register FPU operations use .X')
		return [0xf200, (fpSource << 10) | command]
	}
	const ea = source(args[0], format, c, c.pc + 4)
	return [0xf200 | eaBits(ea), 0x4000 | (format << 10) | command, ...ea.extension]
}

/** `dc.s`, `dc.d` and `dc.x` take decimal literals, rounded to nearest. */
export function realData(args: string[], kind: string): Uint8Array {
	const bytes = kind === 's' ? 4 : kind === 'd' ? 8 : 12,
		out = new Uint8Array(args.length * bytes)
	args.forEach((text, i) => {
		const parsed = parseDecimal(text)
		if (!parsed) throw new Error(`Expected a decimal literal, got '${text}'`)
		const bits = kind === 'x' ? toMemory96(pack80(round(parsed.value, EXTENDED, 'nearest').value)) : toIeee(0n, parsed.value, kind === 'd', 'nearest').bits
		for (let b = 0; b < bytes; b++) out[i * bytes + b] = Number((bits >> BigInt((bytes - 1 - b) * 8)) & 255n)
	})
	return out
}
