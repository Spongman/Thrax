/**
 * VFPv4-D16 instructions in UAL, for the ARMv8 profile only: the mnemonic,
 * an optional condition, then data types, as in `vaddeq.f32` or
 * `vcvt.s32.f64`. armasm's tokens split `vadd` from `.f32`; adjacent
 * pieces are joined again here. Registers are S0-S31 and D0-D15.
 *
 * Floating-point constants are read from the shared tokens as they lie,
 * since the tokenizer has no float syntax: `1.5e-3` arrives as `1`, `.5e`,
 * `-` and `3`, all touching, and is joined back into its text.
 */

import type { HookContext } from '../../../../core/assembly/assembler'
import { parseExpression, type Expr } from '../../../../core/assembly/expressions'
import { TokenKind, positionOf, type Position, type Token, type TokenCursor } from '../../../../core/assembly/tokens'
import { AssemblyError } from '../../../../core/diagnostics'
import { DOUBLE, SINGLE, encodeImm8, numberToBits } from '../fp'
import { CONDITIONS, COND_AL, R_PC, REGISTER_ALIASES } from '../a32/isa'
import { ARITH_NAMES } from '../a32/vfp'
import type { InstructionScope, ParsedInstruction } from './instructions'
import { word32 } from './syntax'

const { Identifier, Number: NumberToken, Operator } = TokenKind

const ARITH = new Map(ARITH_NAMES.flatMap((name, key) => name ? [[name, key] as const] : []))
const UNARY: Readonly<Record<string, number>> = { vabs: 0x0EB00AC0, vneg: 0x0EB10A40, vsqrt: 0x0EB10AC0 }

/** Every VFP base mnemonic, longest first so a condition is never read as part of one. */
export const VFP_MNEMONICS: readonly string[] = Object.freeze([
	...ARITH.keys(), ...Object.keys(UNARY), 'vmov', 'vcmp', 'vcmpe', 'vcvt', 'vcvtr', 'vmrs', 'vmsr', 'vldr', 'vstr',
	'vldm', 'vldmia', 'vldmdb', 'vstm', 'vstmia', 'vstmdb', 'vpush', 'vpop',
].sort((left, right) => right.length - left.length))

export interface VfpMnemonic {
	base: string
	cond: number
	/** Data types after the dots, lower case. */
	types: string[]
}

/** Reads a VFP mnemonic, any case; null when it is none. */
export function parseVfpMnemonic(text: string): VfpMnemonic | null {
	const [stem, ...types] = text.toLowerCase().split('.')
	for (const base of VFP_MNEMONICS) {
		if (!stem.startsWith(base)) continue
		const rest = stem.slice(base.length)
		const cond = rest === '' ? COND_AL : CONDITIONS.get(rest)
		if (cond !== undefined) return { base, cond, types }
	}
	return null
}

interface FpRegister {
	double: boolean
	index: number
}

const touching = (left: Token, right: Token) => left.line === right.line && left.file === right.file && right.column === left.column + left.length

/** The mnemonic token's text with any touching `.type` pieces armasm split off. */
function mnemonicText(head: Token, cursor: TokenCursor): string {
	let text = head.text
	let last = head
	for (;;) {
		const next = cursor.peek()
		if (next.kind !== Identifier || !next.text.startsWith('.') || !touching(last, next)) return text
		text += next.text
		last = cursor.next()
	}
}

/** Fields of S`index` or D`index` in the D (12, 22), N (16, 7) or M (0, 5) position. */
function field(register: FpRegister, at: 'd' | 'n' | 'm'): number {
	const [four, one] = register.double ? [register.index & 15, register.index >> 4] : [register.index >> 1, register.index & 1]
	switch (at) {
		case 'd': return (four << 12) | (one << 22)
		case 'n': return (four << 16) | (one << 7)
		default: return four | (one << 5)
	}
}

/** A floating-point constant, with or without its `#`. */
export function floatLiteral(cursor: TokenCursor): { value: number, at: Position } {
	cursor.accept('#')
	const at = positionOf(cursor.peek())
	let text = ''
	let last: Token | null = null
	while (!cursor.atLineEnd()) {
		const token = cursor.peek()
		if (last && !touching(last, token)) break
		const sign = token.kind === Operator && (token.text === '-' || token.text === '+')
		const part = token.kind === NumberToken || (token.kind === Identifier && /^\.?[0-9]*(?:e[0-9]*)?$/i.test(token.text))
		if (!sign && !part) break
		text += token.text
		last = cursor.next()
	}
	if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new AssemblyError('Expected a floating-point constant such as #1.5', at)
	return { value: Number(text), at }
}

class VfpOperands {
	constructor(readonly cursor: TokenCursor, readonly scope: InstructionScope) {}

	at(): Position {
		return positionOf(this.cursor.peek())
	}

	comma() {
		this.cursor.expect(',', `Expected ',', not '${this.cursor.peek().text || 'end of line'}'`)
	}

	isFp(): boolean {
		const token = this.cursor.peek()
		return token.kind === Identifier && /^[sd]\d+$/i.test(token.text)
	}

	fp(kind?: 'single' | 'double'): FpRegister {
		const token = this.cursor.peek()
		const match = token.kind === Identifier ? /^([sd])(\d+)$/i.exec(token.text) : null
		const index = match ? Number(match[2]) : -1
		const double = match?.[1].toLowerCase() === 'd'
		if (!match || index > 31) throw new AssemblyError(`Expected ${kind === 'double' ? 'a D register' : kind === 'single' ? 'an S register' : 'an S or D register'}, not '${token.text || 'end of line'}'`, positionOf(token))
		if (double && index > 15) throw new AssemblyError(`${token.text.toUpperCase()} is not available: this core has VFPv4-D16, D0-D15`, positionOf(token))
		if (kind && double !== (kind === 'double')) throw new AssemblyError(`Expected ${kind === 'double' ? 'a D' : 'an S'} register, not ${token.text}`, positionOf(token))
		this.cursor.next()
		return { double, index }
	}

	isCore(): boolean {
		const token = this.cursor.peek()
		return token.kind === Identifier && REGISTER_ALIASES.has(token.text.toLowerCase())
	}

	core(allowPc = false): number {
		const token = this.cursor.peek()
		const index = token.kind === Identifier ? REGISTER_ALIASES.get(token.text.toLowerCase()) : undefined
		if (index === undefined) throw new AssemblyError(`Expected a core register, not '${token.text || 'end of line'}'`, positionOf(token))
		if (index === R_PC && !allowPc) throw new AssemblyError('PC is not allowed here', positionOf(token))
		this.cursor.next()
		return index
	}

	name(text: string): boolean {
		const token = this.cursor.peek()
		if (token.kind !== Identifier || token.text.toLowerCase() !== text) return false
		this.cursor.next()
		return true
	}

	expression(): Expr {
		const expr = parseExpression(this.cursor, this.scope.syntax)
		if (!expr) throw new AssemblyError('Expected an expression', this.at())
		return expr
	}

	/** `{s0-s3}` or `{d8, d9}`: consecutive registers of one kind. */
	list(): { first: FpRegister, count: number } {
		const at = this.at()
		this.cursor.expect('{', 'Expected a register list in braces')
		const registers: FpRegister[] = []
		do {
			const first = this.fp()
			registers.push(first)
			if (this.cursor.accept('-')) {
				const last = this.fp(first.double ? 'double' : 'single')
				if (last.index < first.index) throw new AssemblyError('A register range must ascend', at)
				for (let index = first.index + 1; index <= last.index; index++) registers.push({ double: first.double, index })
			}
		} while (this.cursor.accept(','))
		this.cursor.expect('}', `Expected ',' or '}' in the register list, not '${this.cursor.peek().text || 'end of line'}'`)
		const first = registers[0]
		for (const [offset, register] of registers.entries()) {
			if (register.double !== first.double || register.index !== first.index + offset) throw new AssemblyError('A VFP register list is consecutive registers of one kind', at)
		}
		if (registers.length > 16 && first.double) throw new AssemblyError('A list holds at most 16 D registers', at)
		return { first, count: registers.length }
	}

	end() {
		const token = this.cursor.peek()
		if (!this.cursor.atLineEnd()) throw new AssemblyError(`Unexpected '${token.text}' after the operands`, positionOf(token))
	}
}

const sz = (double: boolean) => double ? 0x100 : 0

/** The one `.f32` or `.f64` an operation takes, checked against its registers; none is read from them. */
function precision(m: VfpMnemonic, register: FpRegister, at: Position): boolean {
	const types = m.types.filter(type => type !== '')
	if (types.length > 1 || (types.length === 1 && types[0] !== 'f32' && types[0] !== 'f64')) throw new AssemblyError(`${m.base.toUpperCase()} takes .F32 or .F64`, at)
	if (types.length === 1 && (types[0] === 'f64') !== register.double) throw new AssemblyError(`.${types[0].toUpperCase()} needs ${types[0] === 'f64' ? 'D' : 'S'} registers`, at)
	return register.double
}

/** An integer data type: signed and its size, or null. */
function integerType(type: string): { signed: boolean, size: number } | null {
	const match = /^([su])(16|32)$/.exec(type)
	return match ? { signed: match[1] === 's', size: Number(match[2]) } : null
}

type Encoder = (context: HookContext) => number

/** The word, before its condition, and anything left to work out at emission. */
function operands(m: VfpMnemonic, ops: VfpOperands): Encoder {
	const at = ops.at()
	const { cursor } = ops
	const arith = ARITH.get(m.base)
	if (arith !== undefined) {
		const d = ops.fp()
		ops.comma()
		const n = ops.fp(d.double ? 'double' : 'single')
		ops.comma()
		const mm = ops.fp(d.double ? 'double' : 'single')
		const double = precision(m, d, at)
		const opcode = ((arith >> 3) << 23) | (((arith >> 1) & 3) << 20) | ((arith & 1) << 6)
		return () => 0x0E000A00 | opcode | sz(double) | field(d, 'd') | field(n, 'n') | field(mm, 'm')
	}
	if (UNARY[m.base] !== undefined) {
		const d = ops.fp()
		ops.comma()
		const mm = ops.fp(d.double ? 'double' : 'single')
		return () => UNARY[m.base] | sz(precision(m, d, at)) | field(d, 'd') | field(mm, 'm')
	}
	switch (m.base) {
		case 'vmov': return move(m, ops, at)
		case 'vcmp': case 'vcmpe': {
			const d = ops.fp()
			ops.comma()
			const signal = m.base === 'vcmpe' ? 0x80 : 0
			const double = precision(m, d, at)
			if (ops.isFp()) {
				const mm = ops.fp(d.double ? 'double' : 'single')
				return () => 0x0EB40A40 | signal | sz(double) | field(d, 'd') | field(mm, 'm')
			}
			const zero = floatLiteral(cursor)
			if (zero.value !== 0) throw new AssemblyError('VCMP compares with a register or #0', zero.at)
			return () => 0x0EB50A40 | signal | sz(double) | field(d, 'd')
		}
		case 'vcvt': case 'vcvtr': return convert(m, ops, at)
		case 'vmrs': {
			const rt = ops.name('apsr_nzcv') ? R_PC : ops.core()
			ops.comma()
			if (!ops.name('fpscr')) throw new AssemblyError('Only FPSCR is readable here', ops.at())
			return () => 0x0EF10A10 | (rt << 12)
		}
		case 'vmsr': {
			if (!ops.name('fpscr')) throw new AssemblyError('Only FPSCR is writable here', ops.at())
			ops.comma()
			const rt = ops.core()
			return () => 0x0EE10A10 | (rt << 12)
		}
		case 'vldr': case 'vstr': return transfer(m.base === 'vldr', ops)
		case 'vpush': case 'vpop': {
			const { first, count } = ops.list()
			const load = m.base === 'vpop'
			return () => (load ? 0x0CBD0A00 : 0x0D2D0A00) | sz(first.double) | field(first, 'd') | (first.double ? count * 2 : count)
		}
		default: {
			// VLDM and VSTM: IA, or DB with writeback.
			const load = m.base.startsWith('vldm')
			const decrement = m.base.endsWith('db')
			const rn = ops.core()
			const writeback = cursor.accept('!')
			if (decrement && !writeback) throw new AssemblyError(`${m.base.toUpperCase()} needs writeback (!)`, at)
			ops.comma()
			const { first, count } = ops.list()
			return () => (decrement ? 0x0D000A00 : 0x0C800A00) | (writeback ? 0x00200000 : 0) | (load ? 0x00100000 : 0) | (rn << 16)
				| sz(first.double) | field(first, 'd') | (first.double ? count * 2 : count)
		}
	}
}

function move(m: VfpMnemonic, ops: VfpOperands, at: Position): Encoder {
	if (ops.isCore()) {
		// To core registers: `vmov rt, sn`, `vmov rt, rt2, dm` or `vmov rt, rt2, sm, sm1`.
		const rt = ops.core()
		ops.comma()
		if (ops.isFp()) {
			const n = ops.fp('single')
			return () => 0x0E100A10 | (rt << 12) | field(n, 'n')
		}
		const rt2 = ops.core()
		if (rt === rt2) throw new AssemblyError('VMOV to two core registers needs two different ones', at)
		ops.comma()
		const pair = pairOperand(ops)
		return () => 0x0C500A10 | (rt2 << 16) | (rt << 12) | sz(pair.double) | field(pair, 'm')
	}
	const d = ops.fp()
	ops.comma()
	if (ops.isCore()) {
		const rt = ops.core()
		if (!d.double) {
			if (!ops.cursor.accept(',')) return () => 0x0E000A10 | (rt << 12) | field(d, 'n')
			throw new AssemblyError('VMOV from two core registers writes a D register or two S registers listed first', at)
		}
		ops.comma()
		const rt2 = ops.core()
		return () => 0x0C400B10 | (rt2 << 16) | (rt << 12) | field(d, 'm')
	}
	if (ops.isFp()) {
		const next = ops.fp()
		if (!d.double && !next.double && ops.cursor.accept(',')) {
			// `vmov sm, sm1, rt, rt2`.
			if (next.index !== d.index + 1 || d.index > 30) throw new AssemblyError('The two S registers must be consecutive', at)
			const rt = ops.core()
			ops.comma()
			const rt2 = ops.core()
			return () => 0x0C400A10 | (rt2 << 16) | (rt << 12) | field(d, 'm')
		}
		if (next.double !== d.double) throw new AssemblyError('VMOV copies between registers of one kind', at)
		const double = precision(m, d, at)
		return () => 0x0EB00A40 | sz(double) | field(d, 'd') | field(next, 'm')
	}
	const literal = floatLiteral(ops.cursor)
	const double = precision(m, d, at)
	const fmt = double ? DOUBLE : SINGLE
	const imm8 = encodeImm8(numberToBits(literal.value, fmt), fmt)
	if (imm8 < 0 || !(double || Math.fround(literal.value) === literal.value)) {
		throw new AssemblyError(`${literal.value} is not a VMOV immediate: ±n/16 × 2^e for n 16-31 and e -3 to 4`, literal.at)
	}
	return () => 0x0EB00A00 | sz(double) | field(d, 'd') | ((imm8 >> 4) << 16) | (imm8 & 15)
}

function pairOperand(ops: VfpOperands): FpRegister {
	const first = ops.fp()
	if (first.double) return first
	ops.comma()
	const second = ops.fp('single')
	if (second.index !== first.index + 1 || first.index > 30) throw new AssemblyError('The two S registers must be consecutive', ops.at())
	return first
}

function convert(m: VfpMnemonic, ops: VfpOperands, at: Position): Encoder {
	const types = m.types
	if (types.length !== 2) throw new AssemblyError(`${m.base.toUpperCase()} names two data types, such as .S32.F64 or .F64.F32`, at)
	const [to, from] = types
	const toInteger = integerType(to)
	const fromInteger = integerType(from)
	const d = ops.fp()
	ops.comma()
	const mm = ops.fp()
	const kind = (type: string, register: FpRegister) => {
		const wanted = type === 'f64'
		if (register.double !== wanted) throw new AssemblyError(`.${type.toUpperCase()} needs ${wanted ? 'a D' : 'an S'} register`, at)
	}
	if (ops.cursor.accept(',')) {
		// Fixed point, in place.
		if (m.base === 'vcvtr') throw new AssemblyError('VCVTR has no fixed-point form', at)
		const integer = toInteger ?? fromInteger
		const float = toInteger ? from : to
		if (!integer || (float !== 'f32' && float !== 'f64') || (toInteger && fromInteger)) throw new AssemblyError('Fixed-point VCVT converts between .F32 or .F64 and .S16, .U16, .S32 or .U32', at)
		kind(float, d)
		if (d.double !== mm.double || d.index !== mm.index) throw new AssemblyError('Fixed-point VCVT converts a register in place: both operands are the same', at)
		ops.cursor.accept('#')
		const valueAt = ops.at()
		const expr = ops.expression()
		const low = integer.size === 16 ? 0 : 1
		return (context) => {
			const fbits = context.value(expr, true)!
			if (!Number.isInteger(fbits) || fbits < low || fbits > integer.size) throw new AssemblyError(`Fraction bits ${fbits} are out of range (${low} to ${integer.size})`, valueAt)
			const imm5 = integer.size - fbits
			return 0x0EBA0A40 | (toInteger ? 0x40000 : 0) | (integer.signed ? 0 : 0x10000) | sz(d.double) | (integer.size === 32 ? 0x80 : 0) | ((imm5 & 1) << 5) | (imm5 >> 1) | field(d, 'd')
		}
	}
	if (toInteger || fromInteger) {
		const integer = (toInteger ?? fromInteger)!
		const float = toInteger ? from : to
		if (integer.size !== 32 || (float !== 'f32' && float !== 'f64') || (toInteger && fromInteger)) throw new AssemblyError('VCVT converts between .F32 or .F64 and .S32 or .U32', at)
		if (toInteger) {
			kind('f32', d)
			kind(float, mm)
			const roundZero = m.base === 'vcvt' ? 0x80 : 0
			return () => 0x0EBC0A40 | roundZero | (integer.signed ? 0x10000 : 0) | sz(mm.double) | field(d, 'd') | field(mm, 'm')
		}
		if (m.base === 'vcvtr') throw new AssemblyError('VCVTR converts to an integer', at)
		kind(float, d)
		kind('f32', mm)
		return () => 0x0EB80A40 | (integer.signed ? 0x80 : 0) | sz(d.double) | field(d, 'd') | field(mm, 'm')
	}
	if (m.base === 'vcvtr' || !((to === 'f64' && from === 'f32') || (to === 'f32' && from === 'f64'))) throw new AssemblyError(`Unsupported conversion .${to}.${from}`, at)
	kind(to, d)
	kind(from, mm)
	return () => 0x0EB70AC0 | sz(mm.double) | field(d, 'd') | field(mm, 'm')
}

function transfer(load: boolean, ops: VfpOperands): Encoder {
	const d = ops.fp()
	ops.comma()
	const base = (load ? 0x0D100A00 : 0x0D000A00) | sz(d.double) | field(d, 'd')
	const offsetWord = (rn: number, offset: number, at: Position) => {
		if (offset % 4 !== 0 || Math.abs(offset) > 1020) throw new AssemblyError(`Offset ${offset} is not a multiple of 4 from -1020 to 1020`, at)
		return base | (offset >= 0 ? 0x00800000 : 0) | (rn << 16) | (Math.abs(offset) / 4)
	}
	const { cursor } = ops
	if (!cursor.isOperator('[')) {
		// A label, reached from the PC, which reads as Align(PC, 4) + 8.
		const at = ops.at()
		const expr = ops.expression()
		return (context) => offsetWord(R_PC, word32(context.value(expr, true)!, at) - ((context.dot & ~3) + 8), at)
	}
	cursor.next()
	const rn = ops.core(true)
	let expr: Expr | null = null
	const at = ops.at()
	if (cursor.accept(',')) {
		cursor.accept('#')
		expr = ops.expression()
	}
	cursor.expect(']', 'Expected ]')
	if (cursor.isOperator('!')) throw new AssemblyError('VLDR and VSTR do not write back; use VLDM or VSTM', ops.at())
	return (context) => offsetWord(rn, expr ? context.value(expr, true)! : 0, at)
}

/** Parses a VFP instruction; null when `head` names none. */
export function parseVfp(head: Token, cursor: TokenCursor, scope: InstructionScope): ParsedInstruction | null {
	const start = cursor.index
	const text = mnemonicText(head, cursor)
	const m = parseVfpMnemonic(text)
	if (!m) {
		cursor.index = start
		return null
	}
	if (scope.floatingPoint === false) throw new AssemblyError(`${text.toUpperCase()} is a VFP instruction; turn on the Floating point setting to use it`, positionOf(head))
	const ops = new VfpOperands(cursor, scope)
	const encode = operands(m, ops)
	ops.end()
	return { encode: (context) => (((m.cond << 28) | encode(context)) >>> 0) }
}

/** `.float` and `.double` values, little-endian. */
export function floatBytes(value: number, size: number): number[] {
	const bits = numberToBits(value, size === 8 ? DOUBLE : SINGLE)
	return Array.from({ length: size }, (_unused, index) => Number((bits >> BigInt(index * 8)) & 0xFFn))
}
