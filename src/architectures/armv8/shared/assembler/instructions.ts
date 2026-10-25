/**
 * A32 instructions as both dialects write them: the mnemonic with its
 * condition and suffixes in divided (`addeqs`, `ldmeqfd`) or unified
 * (`addseq`, `ldmfdeq`) order, then operands.  Parsing happens once; the
 * returned encoder evaluates expressions when the engine emits.
 *
 * Supported: data processing (with TSTP/TEQP/CMPP/CMNP), MUL/MLA, LDR/STR
 * with B and T, LDM/STM in every mode with ! and ^, SWP, B/BL, SWI/SVC, and
 * the conveniences ADR, NOP, PUSH, POP, LSL/LSR/ASR/ROR/RRX and NEG.  An
 * immediate no rotation fits is retried on the complementary operation
 * (MOV/MVN, ADD/SUB, CMP/CMN, AND/BIC, ADC/SBC), as GNU as does.
 *
 * ARMv8 adds LDRH STRH LDRSB LDRSH LDRD STRD, MRS MSR, BX BLX, CLZ, MOVW MOVT
 * (and MOV of a 16-bit value as MOVW), MLS and the long multiplies, SDIV
 * UDIV, the bitfield, reversal and extend instructions, LDREX STREX, BKPT,
 * UDF, PLD, the hints and barriers; it drops SWP and the P forms.
 */

import type { HookContext } from '../../../../core/assembly/assembler'
import { ExprKind, parseExpression, type Expr, type ExpressionSyntax } from '../../../../core/assembly/expressions'
import { TokenKind, positionOf, type Position, type Token, type TokenCursor } from '../../../../core/assembly/tokens'
import { AssemblyError } from '../../../../core/diagnostics'
import {
	BLOCK_DA, BLOCK_DB, BLOCK_IA, BLOCK_IB, EXTEND_SXTB, EXTEND_SXTH, EXTEND_UXTB, EXTEND_UXTH, EXTRA_LDRD, EXTRA_LDRH, EXTRA_LDRSB, EXTRA_LDRSH,
	EXTRA_STRD, EXTRA_STRH, LONG_SMLAL, LONG_SMULL, LONG_UMLAL, LONG_UMULL, PSR_FIELD_C, PSR_FIELD_F, PSR_FIELD_S, PSR_FIELD_X,
	REVERSE_RBIT, REVERSE_REV, REVERSE_REV16, REVERSE_REVSH,
	encodeBitfieldExtract, encodeBitfieldInsert, encodeBlock, encodeBlxImmediate, encodeBranch, encodeBranchExchange, encodeBreakpoint, encodeClz,
	encodeDataProcessing, encodeDivide, encodeExtend, encodeExtraTransfer, encodeHint, encodeLoadExclusive, encodeMrs, encodeMsr, encodeMultiply,
	encodeMultiplyLong, encodeMultiplySubtract, encodePreload, encodeReverse, encodeStoreExclusive, encodeSwap, encodeSwi, encodeTransfer,
	encodeUdf, encodeWideMove, registerShiftField, shiftedRegisterField,
} from '../a32/encode'
import {
	ARCH_V2A, ARCH_V8, CONDITIONS, COND_AL, DP_NAMES, OP_ADC, OP_ADD, OP_AND, OP_BIC, OP_CMN, OP_CMP, OP_MOV, OP_MVN, OP_RSB, OP_SBC, OP_SUB,
	R_LR, R_PC, R_SP, REGISTER_ALIASES, SHIFT_ASR, SHIFT_LSL, SHIFT_LSR, SHIFT_ROR, SHIFT_RRX, encodeImmediate, isMoveOp, isTestOp,
} from '../a32/isa'
import { LITERAL_MOV, LITERAL_MVN, LiteralSite, type LiteralPool } from './pool'
import { word32 } from './syntax'
import { parseVfp } from './vfp'

const { Identifier, String: StringToken } = TokenKind

/** Mnemonic families. */
const K_DATA = 0
const K_MUL = 1
const K_MLA = 2
const K_LDR = 3
const K_STR = 4
const K_LDM = 5
const K_STM = 6
const K_SWP = 7
const K_B = 8
const K_BL = 9
const K_SWI = 10
const K_ADR = 11
const K_NOP = 12
const K_PUSH = 13
const K_POP = 14
const K_SHIFT = 15
const K_RRX = 16
const K_NEG = 17
const K_COPROCESSOR = 38
// ARMv8 only from here.
/** LDRH STRH LDRSB LDRSH LDRD STRD; `op` is the EXTRA_* kind. */
const K_EXTRA = 18
const K_MLS = 19
/** `op` is the LONG_* kind. */
const K_MULL = 20
/** `op` is 1 for signed. */
const K_DIV = 21
const K_MRS = 22
const K_MSR = 23
/** `op` is 1 for BLX. */
const K_BX = 24
const K_CLZ = 25
/** `op` is 1 for MOVT. */
const K_MOVW = 26
/** `op` is the REVERSE_* word. */
const K_REV = 27
/** `op` is the EXTEND_* word. */
const K_EXTEND = 28
/** `op` is 1 for signed. */
const K_BFX = 29
/** `op` is 1 for BFC. */
const K_BFI = 30
const K_BKPT = 31
const K_UDF = 32
const K_PLD = 33
/** `op` is 1 for STREX. */
const K_EXCLUSIVE = 34
/** `op` is the hint number. */
const K_HINT = 35
/** `op` is the barrier's bits 7-4. */
const K_BARRIER = 36
/** SXTAB and the like: an extend added to Rn; `op` is the EXTEND_* word. */
const K_EXTEND_ADD = 37

/** What a mnemonic's suffixes said. */
export interface Mnemonic {
	/** Canonical operation, before condition and flag suffixes. */
	base: string
	kind: number
	cond: number
	/** Data-processing opcode, or shift type for K_SHIFT. */
	op: number
	setFlags: boolean
	/** TSTP and the like: the result goes to the status bits. */
	psr: boolean
	byte: boolean
	user: boolean
	/** Block mode as BLOCK_* (P and U bits). */
	mode: number
}

type Slot = 'cond' | 's' | 'p' | 'b' | 't' | 'mode' | 'load' | 'store'

const BLOCK_MODE_NAMES = ['ia', 'ib', 'da', 'db', 'fd', 'ed', 'fa', 'ea']
const LOAD_MODES: Record<string, number> = { ia: BLOCK_IA, ib: BLOCK_IB, da: BLOCK_DA, db: BLOCK_DB, fd: BLOCK_IA, ed: BLOCK_IB, fa: BLOCK_DA, ea: BLOCK_DB }
const STORE_MODES: Record<string, number> = { ia: BLOCK_IA, ib: BLOCK_IB, da: BLOCK_DA, db: BLOCK_DB, fd: BLOCK_DB, ed: BLOCK_DA, fa: BLOCK_IB, ea: BLOCK_IA }
const SHIFT_MNEMONICS: Record<string, number> = { lsl: SHIFT_LSL, asl: SHIFT_LSL, lsr: SHIFT_LSR, asr: SHIFT_ASR, ror: SHIFT_ROR }

const SLOT_OPTIONS: Record<Slot, readonly string[]> = {
	cond: [...CONDITIONS.keys()],
	s: ['s'],
	p: ['p', 's'],
	b: ['b'],
	t: ['t'],
	mode: BLOCK_MODE_NAMES,
	load: ['sb', 'sh', 'h', 'd'],
	store: ['h', 'd'],
}

const LOAD_KINDS: Record<string, number> = { h: EXTRA_LDRH, sb: EXTRA_LDRSB, sh: EXTRA_LDRSH, d: EXTRA_LDRD }
const STORE_KINDS: Record<string, number> = { h: EXTRA_STRH, d: EXTRA_STRD }

interface Family {
	base: string
	kind: number
	op?: number
	/** Suffix orders accepted: divided first, then unified. */
	orders: readonly (readonly Slot[])[]
	/** A suffix that must be there, so the family is told from its base's. */
	required?: Slot
}

const COND_ONLY = [['cond']] as const
const COND_S = [['cond', 's'], ['s', 'cond']] as const

/** Longer bases first, so `bl` is tried before `b` and `bic`'s suffix check fails for `b`. */
const FAMILIES: readonly Family[] = [
	...DP_NAMES.map((base, op): Family => ({ base, kind: K_DATA, op, orders: isTestOp(op) ? [['cond', 'p'], ['p', 'cond']] : COND_S })),
	{ base: 'mul', kind: K_MUL, orders: COND_S },
	{ base: 'mla', kind: K_MLA, orders: COND_S },
	{ base: 'mrc', kind: K_COPROCESSOR, op: 1, orders: COND_ONLY },
	{ base: 'mcr', kind: K_COPROCESSOR, op: 0, orders: COND_ONLY },
	{ base: 'ldr', kind: K_LDR, orders: [['cond', 'b', 't'], ['b', 't', 'cond']] },
	{ base: 'str', kind: K_STR, orders: [['cond', 'b', 't'], ['b', 't', 'cond']] },
	{ base: 'ldm', kind: K_LDM, orders: [['cond', 'mode'], ['mode', 'cond']] },
	{ base: 'stm', kind: K_STM, orders: [['cond', 'mode'], ['mode', 'cond']] },
	{ base: 'swp', kind: K_SWP, orders: [['cond', 'b'], ['b', 'cond']] },
	{ base: 'swi', kind: K_SWI, orders: COND_ONLY },
	{ base: 'svc', kind: K_SWI, orders: COND_ONLY },
	{ base: 'adr', kind: K_ADR, orders: COND_ONLY },
	{ base: 'nop', kind: K_NOP, orders: [[]] },
	{ base: 'push', kind: K_PUSH, orders: COND_ONLY },
	{ base: 'pop', kind: K_POP, orders: COND_ONLY },
	...Object.entries(SHIFT_MNEMONICS).map(([base, op]): Family => ({ base, kind: K_SHIFT, op, orders: COND_S })),
	{ base: 'rrx', kind: K_RRX, orders: COND_S },
	{ base: 'neg', kind: K_NEG, orders: COND_S },
	{ base: 'bl', kind: K_BL, orders: COND_ONLY },
	{ base: 'b', kind: K_B, orders: COND_ONLY },
]

/** What ARMv8 adds, tried first; ARMv8 has no SWP, and its NOP is a hint. */
const V8_FAMILIES: readonly Family[] = [
	{ base: 'ldrex', kind: K_EXCLUSIVE, op: 0, orders: COND_ONLY },
	{ base: 'strex', kind: K_EXCLUSIVE, op: 1, orders: COND_ONLY },
	{ base: 'ldr', kind: K_EXTRA, orders: [['cond', 'load'], ['load', 'cond']], required: 'load' },
	{ base: 'str', kind: K_EXTRA, orders: [['cond', 'store'], ['store', 'cond']], required: 'store' },
	{ base: 'mls', kind: K_MLS, orders: COND_ONLY },
	{ base: 'umull', kind: K_MULL, op: LONG_UMULL, orders: COND_S },
	{ base: 'umlal', kind: K_MULL, op: LONG_UMLAL, orders: COND_S },
	{ base: 'smull', kind: K_MULL, op: LONG_SMULL, orders: COND_S },
	{ base: 'smlal', kind: K_MULL, op: LONG_SMLAL, orders: COND_S },
	{ base: 'sdiv', kind: K_DIV, op: 1, orders: COND_ONLY },
	{ base: 'udiv', kind: K_DIV, op: 0, orders: COND_ONLY },
	{ base: 'mrs', kind: K_MRS, orders: COND_ONLY },
	{ base: 'msr', kind: K_MSR, orders: COND_ONLY },
	{ base: 'blx', kind: K_BX, op: 1, orders: COND_ONLY },
	{ base: 'bx', kind: K_BX, op: 0, orders: COND_ONLY },
	{ base: 'clz', kind: K_CLZ, orders: COND_ONLY },
	{ base: 'movw', kind: K_MOVW, op: 0, orders: COND_ONLY },
	{ base: 'movt', kind: K_MOVW, op: 1, orders: COND_ONLY },
	{ base: 'rev16', kind: K_REV, op: REVERSE_REV16, orders: COND_ONLY },
	{ base: 'revsh', kind: K_REV, op: REVERSE_REVSH, orders: COND_ONLY },
	{ base: 'rev', kind: K_REV, op: REVERSE_REV, orders: COND_ONLY },
	{ base: 'rbit', kind: K_REV, op: REVERSE_RBIT, orders: COND_ONLY },
	{ base: 'sxtab', kind: K_EXTEND_ADD, op: EXTEND_SXTB, orders: COND_ONLY },
	{ base: 'sxtah', kind: K_EXTEND_ADD, op: EXTEND_SXTH, orders: COND_ONLY },
	{ base: 'uxtab', kind: K_EXTEND_ADD, op: EXTEND_UXTB, orders: COND_ONLY },
	{ base: 'uxtah', kind: K_EXTEND_ADD, op: EXTEND_UXTH, orders: COND_ONLY },
	{ base: 'sxtb', kind: K_EXTEND, op: EXTEND_SXTB, orders: COND_ONLY },
	{ base: 'sxth', kind: K_EXTEND, op: EXTEND_SXTH, orders: COND_ONLY },
	{ base: 'uxtb', kind: K_EXTEND, op: EXTEND_UXTB, orders: COND_ONLY },
	{ base: 'uxth', kind: K_EXTEND, op: EXTEND_UXTH, orders: COND_ONLY },
	{ base: 'sbfx', kind: K_BFX, op: 1, orders: COND_ONLY },
	{ base: 'ubfx', kind: K_BFX, op: 0, orders: COND_ONLY },
	{ base: 'bfi', kind: K_BFI, op: 0, orders: COND_ONLY },
	{ base: 'bfc', kind: K_BFI, op: 1, orders: COND_ONLY },
	{ base: 'bkpt', kind: K_BKPT, orders: [[]] },
	{ base: 'udf', kind: K_UDF, orders: [[]] },
	{ base: 'pld', kind: K_PLD, orders: [[]] },
	{ base: 'nop', kind: K_HINT, op: 0, orders: COND_ONLY },
	{ base: 'yield', kind: K_HINT, op: 1, orders: COND_ONLY },
	{ base: 'wfe', kind: K_HINT, op: 2, orders: COND_ONLY },
	{ base: 'wfi', kind: K_HINT, op: 3, orders: COND_ONLY },
	{ base: 'sev', kind: K_HINT, op: 4, orders: COND_ONLY },
	{ base: 'clrex', kind: K_BARRIER, op: 1, orders: [[]] },
	{ base: 'dsb', kind: K_BARRIER, op: 4, orders: [[]] },
	{ base: 'dmb', kind: K_BARRIER, op: 5, orders: [[]] },
	{ base: 'isb', kind: K_BARRIER, op: 6, orders: [[]] },
]

const FAMILIES_V8: readonly Family[] = [...V8_FAMILIES, ...FAMILIES.filter((family) => family.kind !== K_SWP && family.kind !== K_NOP && family.kind !== K_COPROCESSOR)]

/** Fills `found` with the suffixes `rest` spells in `order`, or returns false. */
function matchSlots(rest: string, order: readonly Slot[], found: Map<Slot, string>): boolean {
	if (order.length === 0) return rest === ''
	const [slot, ...later] = order
	if (matchSlots(rest, later, found)) return true
	for (const option of SLOT_OPTIONS[slot]) {
		if (!rest.startsWith(option)) continue
		found.set(slot, option)
		if (matchSlots(rest.slice(option.length), later, found)) return true
		found.delete(slot)
	}
	return false
}

/** Reads a mnemonic of `arch`, any case; null when it is no instruction. */
export function parseMnemonic(text: string, arch = ARCH_V2A): Mnemonic | null {
	const lower = text.toLowerCase()
	for (const family of arch === ARCH_V8 ? FAMILIES_V8 : FAMILIES) {
		if (!lower.startsWith(family.base)) continue
		const rest = lower.slice(family.base.length)
		for (const order of family.orders) {
			const found = new Map<Slot, string>()
			if (!matchSlots(rest, order, found)) continue
			if (family.required && !found.has(family.required)) continue
			const modeName = found.get('mode')
			const extra = found.get('load') ?? found.get('store')
			const op = extra !== undefined ? (found.has('load') ? LOAD_KINDS : STORE_KINDS)[extra] : family.op ?? 0
			return {
				base: family.base + (extra ?? ''),
				kind: family.kind,
				cond: CONDITIONS.get(found.get('cond') ?? 'al')!,
				op,
				// TST, TEQ, CMP and CMN always set the flags.
				setFlags: found.has('s') || found.has('p') || (family.kind === K_DATA && isTestOp(op)),
				psr: found.get('p') === 'p',
				byte: found.has('b'),
				user: found.has('t'),
				mode: modeName === undefined ? BLOCK_IA : (family.kind === K_LDM ? LOAD_MODES : STORE_MODES)[modeName],
			}
		}
	}
	return null
}

/** What an instruction line needs from the parser around it. */
export interface InstructionScope {
	/** The ARCH_* profile whose instructions are accepted. */
	arch: number
	syntax: ExpressionSyntax
	/** The pool `LDR rd, =value` adds to. */
	pool(): LiteralPool
	/** SWI names a quoted string may give. */
	swiNames: ReadonlyMap<string, number>
	warn(message: string, at: Position): void
	/** VFP instructions assemble (ARMv8 only); on when absent. */
	floatingPoint?: boolean
}

export interface ParsedInstruction {
	/** The word, at the emitting pass. */
	encode(context: HookContext): number
	/** Run in both passes before the word is laid out. */
	prepare?(context: HookContext): void
}

type Encoder = (context: HookContext) => number

/** Operand 2 of a data-processing instruction. */
type Operand2 =
	| { immediate: true; expr: Expr; at: Position }
	| { immediate: false; field: (context: HookContext) => number }

const isRegisterToken = (token: Token) => token.kind === Identifier && REGISTER_ALIASES.has(token.text.toLowerCase())

class Operands {
	constructor(readonly cursor: TokenCursor, readonly scope: InstructionScope) {}

	at(): Position {
		return positionOf(this.cursor.peek())
	}

	register(what = 'a register'): number {
		const token = this.cursor.peek()
		if (!isRegisterToken(token)) throw new AssemblyError(`Expected ${what}, not '${token.text || 'end of line'}'`, positionOf(token))
		this.cursor.next()
		return REGISTER_ALIASES.get(token.text.toLowerCase())!
	}

	comma() {
		this.cursor.expect(',', `Expected ',', not '${this.cursor.peek().text || 'end of line'}'`)
	}

	expression(message = 'Expected an expression'): Expr {
		const expr = parseExpression(this.cursor, this.scope.syntax)
		if (!expr) throw new AssemblyError(message, this.at())
		return expr
	}

	/** `#expr`, or a bare expression. */
	immediate(): { expr: Expr; at: Position } {
		this.cursor.accept('#')
		const at = this.at()
		return { expr: this.expression('Expected an immediate value'), at }
	}

	end() {
		const token = this.cursor.peek()
		if (!this.cursor.atLineEnd()) throw new AssemblyError(`Unexpected '${token.text}' after the operands`, positionOf(token))
	}

	atRegister(): boolean {
		return isRegisterToken(this.cursor.peek())
	}

	/**
	 * A shift after `rm,`: `lsl #n`, `lsr rs`, `rrx`.  Register shifts only
	 * where `registerShift`, as LDR and STR offsets allow immediates alone.
	 */
	shift(rm: number, registerShift: boolean): (context: HookContext) => number {
		const token = this.cursor.peek()
		const name = token.kind === Identifier ? token.text.toLowerCase() : ''
		if (name === 'rrx') {
			this.cursor.next()
			return () => shiftedRegisterField(rm, SHIFT_RRX, 0)
		}
		const type = SHIFT_MNEMONICS[name]
		if (type === undefined) throw new AssemblyError(`Expected a shift (LSL, LSR, ASR, ROR or RRX), not '${token.text || 'end of line'}'`, positionOf(token))
		this.cursor.next()
		if (!this.cursor.isOperator('#') && this.atRegister()) {
			if (!registerShift) throw new AssemblyError('A load or store offset shifts by an immediate only', this.at())
			const rs = this.register()
			return () => registerShiftField(rm, type, rs)
		}
		const { expr, at } = this.immediate()
		return (context) => shiftedRegisterField(rm, type, shiftAmount(type, context.value(expr, true)!, at))
	}

	/** `#imm`, `rm`, `rm, shift`. */
	operand2(): Operand2 {
		if (!this.atRegister()) return { immediate: true, ...this.immediate() }
		const rm = this.register()
		if (!this.cursor.accept(',')) return { immediate: false, field: () => rm }
		return { immediate: false, field: this.shift(rm, true) }
	}

	/** `{r0-r3, lr}` as a mask. */
	registerList(): number {
		this.cursor.expect('{', 'Expected a register list in braces')
		let mask = 0
		do {
			const first = this.register()
			let last = first
			if (this.cursor.accept('-')) last = this.register()
			if (last < first) throw new AssemblyError('A register range must ascend', this.at())
			for (let index = first; index <= last; index++) mask |= 1 << index
		} while (this.cursor.accept(','))
		this.cursor.expect('}', `Expected ',' or '}' in the register list, not '${this.cursor.peek().text || 'end of line'}'`)
		return mask
	}
}

/** An encoded shift amount for `type`, checked; LSR and ASR #32 encode as 0. */
function shiftAmount(type: number, amount: number, at: Position): number {
	const [low, high] = type === SHIFT_LSL ? [0, 31] : type === SHIFT_ROR ? [1, 31] : [1, 32]
	if (!Number.isInteger(amount) || amount < low || amount > high) {
		throw new AssemblyError(`Shift amount ${amount} is out of range (${low} to ${high})`, at)
	}
	return amount & 31
}

/** The opcode that computes the same with the complementary immediate, and that immediate. */
const COMPLEMENTS: Record<number, [number, (value: number) => number]> = {
	[OP_MOV]: [OP_MVN, (value) => ~value], [OP_MVN]: [OP_MOV, (value) => ~value],
	[OP_AND]: [OP_BIC, (value) => ~value], [OP_BIC]: [OP_AND, (value) => ~value],
	[OP_ADD]: [OP_SUB, (value) => -value], [OP_SUB]: [OP_ADD, (value) => -value],
	[OP_CMP]: [OP_CMN, (value) => -value], [OP_CMN]: [OP_CMP, (value) => -value],
	[OP_ADC]: [OP_SBC, (value) => ~value], [OP_SBC]: [OP_ADC, (value) => ~value],
}

const hex = (value: number) => `0x${(value >>> 0).toString(16)}`

/** `wide`: a MOV of a 16-bit value no rotation fits may be a MOVW, as on ARMv8. */
function dataWord(m: Mnemonic, op: number, rd: number, rn: number, operand: Operand2, context: HookContext, wide = false): number {
	if (!operand.immediate) return encodeDataProcessing(m.cond, op, m.setFlags, rd, rn, operand.field(context), false)
	const value = word32(context.value(operand.expr, true)!, operand.at)
	const field = encodeImmediate(value)
	if (field >= 0) return encodeDataProcessing(m.cond, op, m.setFlags, rd, rn, field, true)
	const complement = COMPLEMENTS[op]
	if (complement) {
		const alternative = encodeImmediate(complement[1](value))
		if (alternative >= 0) return encodeDataProcessing(m.cond, complement[0], m.setFlags, rd, rn, alternative, true)
	}
	if (wide && op === OP_MOV && !m.setFlags && value <= 0xFFFF && rd !== R_PC) return encodeWideMove(m.cond, false, rd, value)
	throw new AssemblyError(`Immediate ${hex(value)} is not an 8-bit value rotated by an even amount`, operand.at)
}

function dataProcessing(m: Mnemonic, operands: Operands): Encoder {
	const op = m.op
	if (isMoveOp(op)) {
		const rd = operands.register()
		operands.comma()
		const operand = operands.operand2()
		const wide = operands.scope.arch === ARCH_V8
		return (context) => dataWord(m, op, rd, 0, operand, context, wide)
	}
	if (isTestOp(op)) {
		if (m.psr && operands.scope.arch !== ARCH_V2A) throw new AssemblyError(`${DP_NAMES[op].toUpperCase()}P is ARMv2's; use MSR`, operands.at())
		const rn = operands.register()
		operands.comma()
		const operand = operands.operand2()
		// TSTP and friends write the result's flags, mode and all, to the status bits.
		const rd = m.psr ? R_PC : 0
		return (context) => dataWord(m, op, rd, rn, operand, context)
	}
	const rd = operands.register()
	operands.comma()
	// `add r0, r1` is `add r0, r0, r1`.
	const second = operands.atRegister() ? operands.register() : -1
	if (second >= 0 && !operands.cursor.accept(',')) {
		return (context) => dataWord(m, op, rd, rd, { immediate: false, field: () => second }, context)
	}
	if (second < 0) {
		const operand = operands.operand2()
		return (context) => dataWord(m, op, rd, rd, operand, context)
	}
	// A shift right after the second register means it was operand 2.
	const next = operands.cursor.peek()
	if (next.kind === Identifier && (SHIFT_MNEMONICS[next.text.toLowerCase()] !== undefined || next.text.toLowerCase() === 'rrx')) {
		const field = operands.shift(second, true)
		return (context) => dataWord(m, op, rd, rd, { immediate: false, field }, context)
	}
	const operand = operands.operand2()
	return (context) => dataWord(m, op, rd, second, operand, context)
}

function multiply(m: Mnemonic, operands: Operands): Encoder {
	const at = operands.at()
	const rd = operands.register()
	operands.comma()
	const rm = operands.register()
	operands.comma()
	const rs = operands.register()
	let rn = 0
	if (m.kind === K_MLA) {
		operands.comma()
		rn = operands.register()
	}
	if (rd === R_PC) throw new AssemblyError('A multiply cannot write PC', at)
	if (rd === rm && operands.scope.arch === ARCH_V2A) operands.scope.warn('ARMv2 gives an unpredictable result when Rd and Rm of a multiply are the same register', at)
	return () => encodeMultiply(m.cond, m.kind === K_MLA, m.setFlags, rd, rm, rs, rn)
}

/** The 12-bit offset and its direction for an immediate offset. */
function immediateOffset(value: number, at: Position): { up: boolean; offset: number } {
	if (!Number.isInteger(value) || value < -4095 || value > 4095) throw new AssemblyError(`Offset ${value} is out of range (-4095 to 4095)`, at)
	return { up: value >= 0, offset: Math.abs(value) }
}

function transfer(m: Mnemonic, operands: Operands): ParsedInstruction {
	const load = m.kind === K_LDR
	const { cursor } = operands
	const rd = operands.register()
	operands.comma()
	const base = { load, byte: m.byte, rd }
	if (cursor.isOperator('=')) {
		const at = operands.at()
		cursor.next()
		if (!load) throw new AssemblyError('Only LDR loads a literal', at)
		if (m.byte || m.user) throw new AssemblyError('A literal loads with LDR alone', at)
		const start = cursor.index
		const expr = operands.expression('Expected a value after =')
		const key = cursor.tokens.slice(start, cursor.index).map((token) => token.text).join(' ')
		const site = new LiteralSite(operands.scope.pool(), expr, key, at)
		return {
			prepare: (context) => site.prepare(context),
			encode(context) {
				if (site.kind === LITERAL_MOV || site.kind === LITERAL_MVN) {
					return encodeDataProcessing(m.cond, site.kind === LITERAL_MOV ? OP_MOV : OP_MVN, false, rd, 0, site.field, true)
				}
				const { up, offset } = immediateOffset(site.offsetFrom(context.dot), at)
				return encodeTransfer(m.cond, { ...base, pre: true, up, writeback: false, rn: R_PC, offset, register: false })
			},
		}
	}
	if (!cursor.isOperator('[')) {
		// A label: PC-relative.
		const at = operands.at()
		if (m.user) throw new AssemblyError('The T form needs post-indexed addressing', at)
		const expr = operands.expression('Expected an address in brackets, a label or =value')
		return {
			encode(context) {
				const target = word32(context.value(expr, true)!, at)
				const { up, offset } = immediateOffset(target - (context.dot + 8), at)
				return encodeTransfer(m.cond, { ...base, pre: true, up, writeback: false, rn: R_PC, offset, register: false })
			},
		}
	}
	cursor.next()
	const rn = operands.register('a base register')
	let pre = true
	let writeback = false
	let offset: { register: false; expr: Expr | null; at: Position } | { register: true; up: boolean; field: (context: HookContext) => number }
	const readOffset = (): typeof offset => {
		const at = operands.at()
		const sign = cursor.isOperator('-') ? -1 : cursor.isOperator('+') ? 1 : 0
		const signedRegister = sign !== 0 && isRegisterToken(cursor.peek(1))
		if (!signedRegister && !operands.atRegister()) return { register: false, ...operands.immediate() }
		if (sign !== 0) cursor.next()
		const rm = operands.register()
		if (rm === R_PC) throw new AssemblyError('PC cannot be an offset register', at)
		const field = cursor.accept(',') ? operands.shift(rm, false) : () => rm
		return { register: true, up: sign >= 0, field }
	}
	if (cursor.accept(']')) {
		if (cursor.accept(',')) {
			pre = false
			offset = readOffset()
		} else {
			offset = { register: false, expr: null, at: operands.at() }
			// `ldrt r0, [r1]` is post-indexed by nothing.
			if (m.user) pre = false
			else writeback = cursor.accept('!')
		}
	} else {
		operands.comma()
		offset = readOffset()
		cursor.expect(']', `Expected ']', not '${cursor.peek().text || 'end of line'}'`)
		writeback = cursor.accept('!')
	}
	if (m.user && pre) throw new AssemblyError('The T form needs post-indexed addressing', operands.at())
	// Post-indexed always writes back; there W selects the T form.
	const w = pre ? writeback : m.user
	const chosen = offset
	return {
		encode(context) {
			if (chosen.register) {
				return encodeTransfer(m.cond, { ...base, pre, up: chosen.up, writeback: w, rn, offset: chosen.field(context), register: true })
			}
			const value = chosen.expr ? context.value(chosen.expr, true)! : 0
			const { up, offset: amount } = immediateOffset(value, chosen.at)
			return encodeTransfer(m.cond, { ...base, pre, up, writeback: w, rn, offset: amount, register: false })
		},
	}
}

function block(m: Mnemonic, operands: Operands): Encoder {
	const load = m.kind === K_LDM || m.kind === K_POP
	let rn = R_SP
	let writeback = true
	let mode = load ? BLOCK_IA : BLOCK_DB
	if (m.kind === K_LDM || m.kind === K_STM) {
		rn = operands.register('a base register')
		writeback = operands.cursor.accept('!')
		operands.comma()
		mode = m.mode
	}
	const at = operands.at()
	const mask = operands.registerList()
	const psr = operands.cursor.accept('^')
	if (writeback && rn === R_PC) throw new AssemblyError('PC cannot be written back', at)
	return () => encodeBlock(m.cond, load, mode, writeback, psr, rn, mask)
}

function branch(m: Mnemonic, operands: Operands): Encoder {
	const at = operands.at()
	const expr = operands.expression('Expected a branch target')
	return (context) => {
		const target = word32(context.value(expr, true)!, at)
		if (target & 3) throw new AssemblyError(`Branch target ${hex(target)} is not word aligned`, at)
		const offset = target - (context.dot + 8)
		if (offset < -(2 ** 25) || offset >= 2 ** 25) throw new AssemblyError(`Branch target ${hex(target)} is out of range`, at)
		return encodeBranch(m.cond, m.kind === K_BL, offset)
	}
}

function swi(m: Mnemonic, operands: Operands): Encoder {
	const token = operands.cursor.peek()
	if (token.kind === StringToken) {
		operands.cursor.next()
		const value = operands.scope.swiNames.get(token.string!)
		if (value === undefined) throw new AssemblyError(`Unknown SWI name "${token.string}"`, positionOf(token))
		return () => encodeSwi(m.cond, value)
	}
	const { expr, at } = operands.immediate()
	return (context) => {
		const value = context.value(expr, true)!
		if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFF) throw new AssemblyError(`SWI number ${value} does not fit 24 bits`, at)
		return encodeSwi(m.cond, value)
	}
}

function adr(m: Mnemonic, operands: Operands): Encoder {
	const rd = operands.register()
	operands.comma()
	const at = operands.at()
	const expr = operands.expression('Expected an address')
	return (context) => {
		const offset = (word32(context.value(expr, true)!, at) - (context.dot + 8)) | 0
		const op = offset < 0 ? OP_SUB : OP_ADD
		const field = encodeImmediate(Math.abs(offset))
		if (field < 0) throw new AssemblyError(`ADR cannot reach an offset of ${offset} bytes in one instruction`, at)
		return encodeDataProcessing(m.cond, op, false, rd, R_PC, field, true)
	}
}

/** `lsl rd, rm, #n` and the like, which are MOVs. */
function shiftInstruction(m: Mnemonic, operands: Operands): Encoder {
	const rd = operands.register()
	operands.comma()
	let rm = rd
	if (operands.atRegister()) {
		rm = operands.register()
		if (m.kind === K_RRX) return () => encodeDataProcessing(m.cond, OP_MOV, m.setFlags, rd, 0, shiftedRegisterField(rm, SHIFT_RRX, 0), false)
		if (!operands.cursor.accept(',')) {
			// `lsl rd, rs`: rd shifted by rs.
			const rs = rm
			return () => encodeDataProcessing(m.cond, OP_MOV, m.setFlags, rd, 0, registerShiftField(rd, m.op, rs), false)
		}
	}
	if (!operands.cursor.isOperator('#') && operands.atRegister()) {
		const rs = operands.register()
		return () => encodeDataProcessing(m.cond, OP_MOV, m.setFlags, rd, 0, registerShiftField(rm, m.op, rs), false)
	}
	const { expr, at } = operands.immediate()
	return (context) => encodeDataProcessing(m.cond, OP_MOV, m.setFlags, rd, 0, shiftedRegisterField(rm, m.op, shiftAmount(m.op, context.value(expr, true)!, at)), false)
}

/* ------------------------------------------------------------ ARMv8 */

/** A register other than PC, as most ARMv8 forms need. */
function plainRegister(operands: Operands, what = 'a register'): number {
	const at = operands.at()
	const index = operands.register(what)
	if (index === R_PC) throw new AssemblyError('PC is not allowed here', at)
	return index
}

/** Registers separated by commas, none of them PC. */
function plainRegisters(operands: Operands, count: number): number[] {
	const registers: number[] = []
	for (let index = 0; index < count; index++) {
		if (index > 0) operands.comma()
		registers.push(plainRegister(operands))
	}
	return registers
}

/** An immediate in `low` to `high`, evaluated when the word is encoded. */
function boundedImmediate(operands: Operands, low: number, high: number, what: string): (context: HookContext) => number {
	const { expr, at } = operands.immediate()
	return (context) => {
		const value = context.value(expr, true)!
		if (!Number.isInteger(value) || value < low || value > high) throw new AssemblyError(`${what} ${value} is out of range (${low} to ${high})`, at)
		return value
	}
}

/** LDRH STRH LDRSB LDRSH LDRD STRD: an 8-bit offset or a register, no shift. */
function extraTransfer(m: Mnemonic, operands: Operands): Encoder {
	const { cursor } = operands
	const kind = m.op
	const double = kind === EXTRA_LDRD || kind === EXTRA_STRD
	const at = operands.at()
	const rt = operands.register()
	operands.comma()
	if (double) {
		if (rt & 1 || rt === R_LR) throw new AssemblyError('LDRD and STRD need an even first register below LR', at)
		// The second register may be written out; it has to be the next one.
		if (operands.atRegister()) {
			const second = operands.register()
			if (second !== rt + 1) throw new AssemblyError(`The second register must be r${rt + 1}`, at)
			operands.comma()
		}
	} else if (rt === R_PC) {
		throw new AssemblyError('PC is not allowed here', at)
	}
	const fields = { kind, rt }
	if (!cursor.isOperator('[')) {
		const where = operands.at()
		const expr = operands.expression('Expected an address in brackets or a label')
		return (context) => {
			const { up, offset } = byteOffset(word32(context.value(expr, true)!, where) - (context.dot + 8), where)
			return encodeExtraTransfer(m.cond, { ...fields, pre: true, up, writeback: false, rn: R_PC, offset, register: false })
		}
	}
	cursor.next()
	const rn = operands.register('a base register')
	let pre = true
	let writeback = false
	type Offset = { register: false; expr: Expr | null; at: Position } | { register: true; up: boolean; rm: number }
	const readOffset = (): Offset => {
		const where = operands.at()
		const sign = cursor.isOperator('-') ? -1 : cursor.isOperator('+') ? 1 : 0
		if (!(sign !== 0 && isRegisterToken(cursor.peek(1))) && !operands.atRegister()) return { register: false, ...operands.immediate() }
		if (sign !== 0) cursor.next()
		const rm = operands.register()
		if (rm === R_PC) throw new AssemblyError('PC cannot be an offset register', where)
		return { register: true, up: sign >= 0, rm }
	}
	let offset: Offset
	if (cursor.accept(']')) {
		if (cursor.accept(',')) {
			pre = false
			offset = readOffset()
		} else {
			offset = { register: false, expr: null, at: operands.at() }
			writeback = cursor.accept('!')
		}
	} else {
		operands.comma()
		offset = readOffset()
		cursor.expect(']', `Expected ']', not '${cursor.peek().text || 'end of line'}'`)
		writeback = cursor.accept('!')
	}
	if ((writeback || !pre) && rn === R_PC) throw new AssemblyError('PC cannot be written back', at)
	const chosen = offset
	return (context) => {
		if (chosen.register) return encodeExtraTransfer(m.cond, { ...fields, pre, up: chosen.up, writeback, rn, offset: chosen.rm, register: true })
		const { up, offset: amount } = byteOffset(chosen.expr ? context.value(chosen.expr, true)! : 0, chosen.at)
		return encodeExtraTransfer(m.cond, { ...fields, pre, up, writeback, rn, offset: amount, register: false })
	}
}

/** An 8-bit offset and its direction. */
function byteOffset(value: number, at: Position): { up: boolean; offset: number } {
	if (!Number.isInteger(value) || value < -255 || value > 255) throw new AssemblyError(`Offset ${value} is out of range (-255 to 255)`, at)
	return { up: value >= 0, offset: Math.abs(value) }
}

/** `[rn]` or `[rn, #0]`, as the exclusives take. */
function bareAddress(operands: Operands): number {
	const { cursor } = operands
	cursor.expect('[', 'Expected [rn]')
	const rn = plainRegister(operands, 'a base register')
	if (cursor.accept(',')) {
		const at = operands.at()
		const { expr } = operands.immediate()
		if (expr.kind !== ExprKind.Number || expr.value !== 0) throw new AssemblyError('The only offset allowed here is #0', at)
	}
	cursor.expect(']', `Expected ']', not '${cursor.peek().text || 'end of line'}'`)
	return rn
}

const PSR_LETTERS: Record<string, number> = { c: PSR_FIELD_C, x: PSR_FIELD_X, s: PSR_FIELD_S, f: PSR_FIELD_F }
const APSR_MASKS: Record<string, number> = { nzcvq: PSR_FIELD_F, g: PSR_FIELD_S, nzcvqg: PSR_FIELD_F | PSR_FIELD_S }

/** `cpsr`, `spsr` or `apsr`, with MSR's field suffix when `fields`. */
function statusRegister(operands: Operands, fields: boolean): { spsr: boolean; mask: number } {
	const token = operands.cursor.peek()
	const at = positionOf(token)
	const match = token.kind === Identifier ? /^(cpsr|spsr|apsr)(?:_([a-z]+))?$/.exec(token.text.toLowerCase()) : null
	if (!match || (!fields && match[2])) throw new AssemblyError(`Expected ${fields ? 'CPSR_fields, APSR_nzcvq or the like' : 'APSR, CPSR or SPSR'}, not '${token.text || 'end of line'}'`, at)
	operands.cursor.next()
	const [, name, suffix] = match
	const spsr = name === 'spsr'
	if (!fields) return { spsr, mask: 0 }
	if (name === 'apsr') {
		const mask = APSR_MASKS[suffix ?? 'nzcvq']
		if (mask === undefined) throw new AssemblyError(`APSR takes _nzcvq, _g or _nzcvqg, not _${suffix}`, at)
		return { spsr, mask }
	}
	// No suffix writes the flags and control fields, as GNU as reads it.
	if (!suffix) return { spsr, mask: PSR_FIELD_F | PSR_FIELD_C }
	let mask = 0
	for (const letter of suffix) {
		const bit = PSR_LETTERS[letter]
		if (bit === undefined || mask & bit) throw new AssemblyError(`Unknown or repeated status field '${letter}' in _${suffix}`, at)
		mask |= bit
	}
	return { spsr, mask }
}

/** The 16-bit value of MOVW or MOVT: `#value`, or a half of a word by `#:lower16:expr` or `#:upper16:expr`. */
function wideValue(operands: Operands): (context: HookContext) => number {
	const { cursor } = operands
	cursor.accept('#')
	let half = -1
	const part = cursor.peek(1)
	if (cursor.isOperator(':') && part.kind === Identifier && /^(lower|upper)16$/i.test(part.text) && cursor.isOperator(':', 2)) {
		half = part.text.toLowerCase() === 'upper16' ? 16 : 0
		cursor.next()
		cursor.next()
		cursor.next()
	}
	const at = operands.at()
	const expr = operands.expression('Expected an immediate value')
	return (context) => {
		const value = context.value(expr, true)!
		if (half >= 0) return (word32(value, at) >>> half) & 0xFFFF
		if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new AssemblyError(`${value} does not fit 16 bits; use :lower16: or :upper16:`, at)
		return value
	}
}

/** The ARMv8 forms; null for a kind that is not one of them. */
function v8Instruction(m: Mnemonic, operands: Operands): Encoder | null {
	const { cursor } = operands
	const cond = m.cond
	switch (m.kind) {
		case K_EXTRA: return extraTransfer(m, operands)
		case K_MLS: {
			const [rd, rn, rm, ra] = plainRegisters(operands, 4)
			return () => encodeMultiplySubtract(cond, rd, rn, rm, ra)
		}
		case K_MULL: {
			const at = operands.at()
			const [rdLo, rdHi, rn, rm] = plainRegisters(operands, 4)
			if (rdLo === rdHi) throw new AssemblyError('RdLo and RdHi must be different registers', at)
			return () => encodeMultiplyLong(cond, m.op, m.setFlags, rdLo, rdHi, rn, rm)
		}
		case K_DIV: {
			const [rd, rn, rm] = plainRegisters(operands, 3)
			return () => encodeDivide(cond, m.op === 1, rd, rn, rm)
		}
		case K_MRS: {
			const rd = plainRegister(operands)
			operands.comma()
			const { spsr } = statusRegister(operands, false)
			return () => encodeMrs(cond, spsr, rd)
		}
		case K_MSR: {
			const { spsr, mask } = statusRegister(operands, true)
			operands.comma()
			if (operands.atRegister()) {
				const rm = plainRegister(operands)
				return () => encodeMsr(cond, spsr, mask, rm, false)
			}
			const { expr, at } = operands.immediate()
			return (context) => {
				const field = encodeImmediate(word32(context.value(expr, true)!, at))
				if (field < 0) throw new AssemblyError('The value is not an 8-bit value rotated by an even amount', at)
				return encodeMsr(cond, spsr, mask, field, true)
			}
		}
		case K_BX: {
			if (operands.atRegister()) {
				const rm = operands.register()
				return () => encodeBranchExchange(cond, m.op === 1, rm)
			}
			const at = operands.at()
			if (m.op !== 1) throw new AssemblyError('BX takes a register', at)
			if (cond !== COND_AL) throw new AssemblyError('BLX to a label cannot be conditional', at)
			const expr = operands.expression('Expected a branch target or a register')
			return (context) => {
				const target = word32(context.value(expr, true)!, at)
				const offset = target - (context.dot + 8)
				if (target & 1) throw new AssemblyError(`BLX target ${hex(target)} is not halfword aligned`, at)
				if (offset < -(2 ** 25) || offset >= 2 ** 25) throw new AssemblyError(`Branch target ${hex(target)} is out of range`, at)
				return encodeBlxImmediate(offset)
			}
		}
		case K_CLZ: {
			const [rd, rm] = plainRegisters(operands, 2)
			return () => encodeClz(cond, rd, rm)
		}
		case K_MOVW: {
			const rd = plainRegister(operands)
			operands.comma()
			const value = wideValue(operands)
			return (context) => encodeWideMove(cond, m.op === 1, rd, value(context))
		}
		case K_REV: {
			const [rd, rm] = plainRegisters(operands, 2)
			return () => encodeReverse(cond, m.op, rd, rm)
		}
		case K_EXTEND:
		case K_EXTEND_ADD: {
			const [rd, ...sources] = plainRegisters(operands, m.kind === K_EXTEND_ADD ? 3 : 2)
			const rn = sources.length === 2 ? sources[0] : R_PC
			const rm = sources[sources.length - 1]
			if (!cursor.accept(',')) return () => encodeExtend(cond, m.op, rd, rn, rm, 0)
			const token = cursor.peek()
			if (token.kind !== Identifier || token.text.toLowerCase() !== 'ror') throw new AssemblyError(`Expected ROR, not '${token.text || 'end of line'}'`, positionOf(token))
			cursor.next()
			const { expr, at } = operands.immediate()
			return (context) => {
				const rotation = context.value(expr, true)!
				if (rotation !== 0 && rotation !== 8 && rotation !== 16 && rotation !== 24) throw new AssemblyError('The rotation is 0, 8, 16 or 24', at)
				return encodeExtend(cond, m.op, rd, rn, rm, rotation)
			}
		}
		case K_BFX:
		case K_BFI: {
			const rd = plainRegister(operands)
			let rn = R_PC
			if (!(m.kind === K_BFI && m.op === 1)) {
				operands.comma()
				rn = plainRegister(operands)
			}
			operands.comma()
			const lsb = boundedImmediate(operands, 0, 31, 'Bit position')
			operands.comma()
			const at = operands.at()
			const width = boundedImmediate(operands, 1, 32, 'Width')
			return (context) => {
				const low = lsb(context)
				const bits = width(context)
				if (low + bits > 32) throw new AssemblyError(`A field of ${bits} bits from bit ${low} runs past bit 31`, at)
				return m.kind === K_BFX ? encodeBitfieldExtract(cond, m.op === 1, rd, rn, low, bits) : encodeBitfieldInsert(cond, rd, rn, low, bits)
			}
		}
		case K_BKPT:
		case K_UDF: {
			const value = cursor.atLineEnd() ? () => 0 : boundedImmediate(operands, 0, 0xFFFF, 'The value')
			return (context) => m.kind === K_BKPT ? encodeBreakpoint(value(context)) : encodeUdf(value(context))
		}
		case K_PLD: {
			cursor.expect('[', 'Expected [rn, offset]')
			const rn = operands.register('a base register')
			if (cursor.accept(']')) return () => encodePreload(true, rn, 0, false)
			operands.comma()
			const sign = cursor.isOperator('-') ? -1 : cursor.isOperator('+') ? 1 : 0
			if ((sign !== 0 && isRegisterToken(cursor.peek(1))) || operands.atRegister()) {
				if (sign !== 0) cursor.next()
				const rm = plainRegister(operands)
				const field = cursor.accept(',') ? operands.shift(rm, false) : () => rm
				cursor.expect(']', 'Expected ]')
				return (context) => encodePreload(sign >= 0, rn, field(context), true)
			}
			const { expr, at } = operands.immediate()
			cursor.expect(']', 'Expected ]')
			return (context) => {
				const { up, offset } = immediateOffset(context.value(expr, true)!, at)
				return encodePreload(up, rn, offset, false)
			}
		}
		case K_EXCLUSIVE: {
			if (m.op === 0) {
				const rt = plainRegister(operands)
				operands.comma()
				const rn = bareAddress(operands)
				return () => encodeLoadExclusive(cond, rt, rn)
			}
			const at = operands.at()
			const [rd, rt] = plainRegisters(operands, 2)
			operands.comma()
			const rn = bareAddress(operands)
			if (rd === rt || rd === rn) throw new AssemblyError('STREX needs a status register apart from the others', at)
			return () => encodeStoreExclusive(cond, rd, rt, rn)
		}
		case K_HINT: return () => encodeHint(cond, m.op)
		case K_BARRIER: {
			if (m.op === 1) return () => 0xF57FF01F
			let option = 15
			const token = cursor.peek()
			if (!cursor.atLineEnd()) {
				const named = token.kind === Identifier ? BARRIER_OPTIONS[token.text.toLowerCase()] : undefined
				if (named === undefined) throw new AssemblyError(`Unknown barrier option '${token.text}'`, positionOf(token))
				cursor.next()
				option = named
			}
			return () => (0xF57FF000 | (m.op << 4) | option) >>> 0
		}
	}
	return null
}

const BARRIER_OPTIONS: Record<string, number> = { sy: 15, st: 14, ish: 11, ishst: 10, nsh: 7, nshst: 6, osh: 3, oshst: 2 }

/** Parses the operands of `mnemonic`; null when the mnemonic is no instruction. */
export function parseInstruction(mnemonic: Token, cursor: TokenCursor, scope: InstructionScope): ParsedInstruction | null {
	if (scope.arch === ARCH_V8) {
		const vfp = parseVfp(mnemonic, cursor, scope)
		if (vfp) return vfp
	}
	const m = parseMnemonic(mnemonic.text, scope.arch)
	if (!m) return null
	const operands = new Operands(cursor, scope)
	let parsed: ParsedInstruction
	const v8 = scope.arch === ARCH_V8 ? v8Instruction(m, operands) : null
	if (v8) {
		operands.end()
		return { encode: v8 }
	}
	switch (m.kind) {
		case K_COPROCESSOR: {
			const named = (prefix: RegExp, maximum: number, what: string): number => {
				const token = cursor.next()
				const text = token.text.toLowerCase().replace(prefix, '')
				if (!/^\d+$/.test(text) || Number(text) > maximum) throw new AssemblyError(`Expected ${what}`, positionOf(token))
				return Number(text)
			}
			const cp = named(/^(?:cp|p)/, 15, 'a coprocessor number from 0 to 15')
			operands.comma()
			const op = named(/^#/, 7, 'an opcode from 0 to 7')
			operands.comma()
			const rd = operands.register()
			operands.comma()
			const crn = named(/^(?:cr|c)/, 15, 'a coprocessor register from c0 to c15')
			operands.comma()
			const crm = named(/^(?:cr|c)/, 15, 'a coprocessor register from c0 to c15')
			const op2 = cursor.accept(',') ? named(/^#/, 7, 'an opcode from 0 to 7') : 0
			parsed = { encode: () => ((m.cond << 28) | 0x0E000010 | (op << 21) | (m.op << 20) | (crn << 16) | (rd << 12) | (cp << 8) | (op2 << 5) | crm) >>> 0 }
			break
		}
		case K_DATA: parsed = { encode: dataProcessing(m, operands) }; break
		case K_MUL:
		case K_MLA: parsed = { encode: multiply(m, operands) }; break
		case K_LDR:
		case K_STR: parsed = transfer(m, operands); break
		case K_LDM:
		case K_STM:
		case K_PUSH:
		case K_POP: parsed = { encode: block(m, operands) }; break
		case K_SWP: {
			const rd = operands.register()
			operands.comma()
			const rm = operands.register()
			operands.comma()
			cursor.expect('[', 'Expected [rn]')
			const rn = operands.register('a base register')
			cursor.expect(']', 'Expected ]')
			parsed = { encode: () => encodeSwap(m.cond, m.byte, rd, rm, rn) }
			break
		}
		case K_B:
		case K_BL: parsed = { encode: branch(m, operands) }; break
		case K_SWI: parsed = { encode: swi(m, operands) }; break
		case K_ADR: parsed = { encode: adr(m, operands) }; break
		case K_NOP: parsed = { encode: () => encodeDataProcessing(COND_AL, OP_MOV, false, 0, 0, 0, false) }; break
		case K_NEG: {
			const rd = operands.register()
			operands.comma()
			const rm = operands.register()
			parsed = { encode: () => encodeDataProcessing(m.cond, OP_RSB, m.setFlags, rd, rm, 0, true) }
			break
		}
		default: parsed = { encode: shiftInstruction(m, operands) }
	}
	operands.end()
	return parsed
}

/** Every base mnemonic, for the editor. */
export const MNEMONICS: readonly string[] = Object.freeze(FAMILIES.map((family) => family.base))
export const MNEMONICS_V8: readonly string[] = Object.freeze([...new Set(FAMILIES_V8.map((family) => family.base))])
