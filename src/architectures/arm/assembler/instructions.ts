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
 */

import type { HookContext } from '../../../core/assembly/assembler'
import { parseExpression, type Expr, type ExpressionSyntax } from '../../../core/assembly/expressions'
import { TokenKind, positionOf, type Position, type Token, type TokenCursor } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import {
	BLOCK_DA, BLOCK_DB, BLOCK_IA, BLOCK_IB, encodeBlock, encodeBranch, encodeDataProcessing, encodeMultiply, encodeSwap, encodeSwi, encodeTransfer,
	registerShiftField, shiftedRegisterField,
} from '../a32/encode'
import {
	CONDITIONS, COND_AL, DP_NAMES, OP_ADC, OP_ADD, OP_AND, OP_BIC, OP_CMN, OP_CMP, OP_MOV, OP_MVN, OP_RSB, OP_SBC, OP_SUB,
	R_PC, R_SP, REGISTER_ALIASES, SHIFT_ASR, SHIFT_LSL, SHIFT_LSR, SHIFT_ROR, SHIFT_RRX, encodeImmediate, isMoveOp, isTestOp,
} from '../a32/isa'
import { LITERAL_MOV, LITERAL_MVN, LiteralSite, type LiteralPool } from './pool'
import { word32 } from './syntax'

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

/** What a mnemonic's suffixes said. */
export interface Mnemonic {
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

type Slot = 'cond' | 's' | 'p' | 'b' | 't' | 'mode'

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
}

interface Family {
	base: string
	kind: number
	op?: number
	/** Suffix orders accepted: divided first, then unified. */
	orders: readonly (readonly Slot[])[]
}

const COND_ONLY = [['cond']] as const
const COND_S = [['cond', 's'], ['s', 'cond']] as const

/** Longer bases first, so `bl` is tried before `b` and `bic`'s suffix check fails for `b`. */
const FAMILIES: readonly Family[] = [
	...DP_NAMES.map((base, op): Family => ({ base, kind: K_DATA, op, orders: isTestOp(op) ? [['cond', 'p'], ['p', 'cond']] : COND_S })),
	{ base: 'mul', kind: K_MUL, orders: COND_S },
	{ base: 'mla', kind: K_MLA, orders: COND_S },
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

/** Reads a mnemonic, any case; null when it is no instruction. */
export function parseMnemonic(text: string): Mnemonic | null {
	const lower = text.toLowerCase()
	for (const family of FAMILIES) {
		if (!lower.startsWith(family.base)) continue
		const rest = lower.slice(family.base.length)
		for (const order of family.orders) {
			const found = new Map<Slot, string>()
			if (!matchSlots(rest, order, found)) continue
			const modeName = found.get('mode')
			const op = family.op ?? 0
			return {
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
	syntax: ExpressionSyntax
	/** The pool `LDR rd, =value` adds to. */
	pool(): LiteralPool
	/** SWI names a quoted string may give. */
	swiNames: ReadonlyMap<string, number>
	warn(message: string, at: Position): void
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

function dataWord(m: Mnemonic, op: number, rd: number, rn: number, operand: Operand2, context: HookContext): number {
	if (!operand.immediate) return encodeDataProcessing(m.cond, op, m.setFlags, rd, rn, operand.field(context), false)
	const value = word32(context.value(operand.expr, true)!, operand.at)
	const field = encodeImmediate(value)
	if (field >= 0) return encodeDataProcessing(m.cond, op, m.setFlags, rd, rn, field, true)
	const complement = COMPLEMENTS[op]
	if (complement) {
		const alternative = encodeImmediate(complement[1](value))
		if (alternative >= 0) return encodeDataProcessing(m.cond, complement[0], m.setFlags, rd, rn, alternative, true)
	}
	throw new AssemblyError(`Immediate ${hex(value)} is not an 8-bit value rotated by an even amount`, operand.at)
}

function dataProcessing(m: Mnemonic, operands: Operands): Encoder {
	const op = m.op
	if (isMoveOp(op)) {
		const rd = operands.register()
		operands.comma()
		const operand = operands.operand2()
		return (context) => dataWord(m, op, rd, 0, operand, context)
	}
	if (isTestOp(op)) {
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
	if (rd === rm) operands.scope.warn('ARMv2 gives an unpredictable result when Rd and Rm of a multiply are the same register', at)
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

/** Parses the operands of `mnemonic`; null when the mnemonic is no instruction. */
export function parseInstruction(mnemonic: Token, cursor: TokenCursor, scope: InstructionScope): ParsedInstruction | null {
	const m = parseMnemonic(mnemonic.text)
	if (!m) return null
	const operands = new Operands(cursor, scope)
	let parsed: ParsedInstruction
	switch (m.kind) {
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
