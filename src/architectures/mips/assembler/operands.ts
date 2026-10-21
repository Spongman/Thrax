/**
 * MIPS operand forms: which operands each mnemonic accepts, from the isa table
 * plus the THRAX extensions, and how a rejected operand is described.
 */

import { cp0RegisterNumber, fpRegisterNumber, FP_REGISTER_COUNT } from '../core/coprocessor'
import { basicForms, pseudoForms, type IsaOperandKind } from '../core/isa'
import { registerNumber } from '../core/registers'
import { AssemblyError, atInstruction } from '../../../core/diagnostics'
import type { MipsArgument, MipsInstruction } from '../core/types'

/** Instructions whose two-operand form repeats the destination as a source. */
export const TWO_OPERAND_FORMS = new Set([
	'ADD', 'ADDU', 'ADDI', 'ADDIU', 'SUB', 'SUBU', 'SUBI', 'SUBIU',
	'AND', 'ANDI', 'OR', 'ORI', 'XOR', 'XORI', 'NOR', 'MUL', 'MULU',
	'SLT', 'SLTU', 'SLTI', 'SLTIU', 'ROL', 'ROR',
])

/** Writes an operand back out the way it was written, for a diagnostic. */
function formatArgument(arg: MipsArgument): string {
	switch (arg.type) {
		case 'register': return arg.value
		case 'immediate': return String(arg.value)
		case 'label': return arg.offset ? `${arg.value}+${arg.offset}` : arg.value
		case 'string': return JSON.stringify(arg.value)
		case 'memory': return `${formatArgument(arg.offset)}(${arg.register})`
	}
}

/** An expanded instruction as source, so a diagnostic can name it. */
export function formatInstruction(instruction: MipsInstruction): string {
	const args = instruction.args.map(formatArgument).join(',')
	return args ? `${instruction.name.toLowerCase()} ${args}` : instruction.name.toLowerCase()
}

/** Names an operand in an error message, without dumping its internals. */
export function describeArgument(arg: MipsArgument | string | undefined): string {
	if (arg === undefined) return 'nothing'
	if (typeof arg === 'string') return arg
	if (arg.type === 'register') return `the register ${arg.value}`
	if (arg.type === 'immediate') return `the value ${arg.value}`
	if (arg.type === 'label') return `the label ${arg.value}`
	if (arg.type === 'string') return 'a string'
	if (arg.type === 'memory') return 'a memory operand'
	return 'that operand'
}

/** One accepted way of writing an instruction, from the isa table. */
export interface Signature { operands: readonly IsaOperandKind[]; example: string }

/**
 * Operand forms THRAX accepts beyond the standard table.  Every instruction with a
 * two-operand form also takes a full 32-bit immediate, in the last slot of the
 * three-operand form and in the two-operand form itself, where `PseudoOps.txt`
 * enumerates only some of the combinations (`:96-124`).  `extendedAssembler`
 * off rejects them (A4).
 */
function thraxSignatures(name: string): Signature[] {
	if (!TWO_OPERAND_FORMS.has(name.toUpperCase())) return []
	const spelling = name.toLowerCase()
	return [
		{ operands: ['gpr', 'gpr', 'imm32'], example: `${spelling} $t1,$t2,100000` },
		{ operands: ['gpr', 'imm32'], example: `${spelling} $t1,100000` },
	]
}

/** Every form `name` accepts, basic ones first, as the isa table orders them. */
function signaturesFor(name: string): Signature[] {
	return [...basicForms(name), ...pseudoForms(name), ...thraxSignatures(name)]
}

/**
 * Inclusive range of each integer operand kind, following how an integer
 * literal: a shift amount is 0-31, and a value
 * outside a 16-bit field falls through to the 32-bit pseudo form instead.
 */
export const IMMEDIATE_RANGES: Partial<Record<IsaOperandKind, readonly [number, number]>> = {
	imm3: [0, 7],
	imm5: [0, 31],
	imm16s: [-0x8000, 0x7fff],
	imm16u: [0, 0xffff],
	imm20: [0, 0xfffff],
	imm32: [-0x80000000, 0xffffffff],
}

/**
 * The halves an extended address is built from.  A load adds the low half back
 * signed, so bit 15 of the address borrows from the high half
 *.
 */
export function highHalf(value: number): number {
	return (((value >> 16) + ((value >> 15) & 1)) & 0xffff) >>> 0
}

export function lowHalf(value: number): number {
	return (value << 16) >> 16
}

export function isGpr(name: string): boolean {
	return registerNumber(name) !== null
}

/** `$f0`-`$f31`; a bare number names a general register, not this file. */
export function isFpr(name: string): boolean {
	const match = /^\$f(\d{1,2})$/i.exec(name)
	return match !== null && Number(match[1]) < FP_REGISTER_COUNT
}

export function isCp0(name: string): boolean {
	try {
		cp0RegisterNumber(name)
		return true
	} catch {
		return false
	}
}

/** Whether `arg` can stand in an operand slot of this kind. */
export function matchesKind(kind: IsaOperandKind, arg: MipsArgument | undefined): boolean {
	if (!arg) return false
	switch (kind) {
		case 'gpr': return arg.type === 'register' && isGpr(arg.value)
		case 'fpr': return arg.type === 'register' && isFpr(arg.value)
		case 'fpr-even': return arg.type === 'register' && isFpr(arg.value) && fpRegisterNumber(arg.value) % 2 === 0
		// A CP0 register is written by number, or by one of its aliases.
		case 'cp0': return arg.type === 'register' && (isGpr(arg.value) || isCp0(arg.value))
		case 'float': return arg.type === 'immediate'
		case 'label':
		case 'label-offset':
		case 'target26': return arg.type === 'label'
		case 'mem':
		case 'base':
		case 'mem32':
		case 'label-mem':
		case 'label-offset-mem': return arg.type === 'memory'
		default: {
			const range = IMMEDIATE_RANGES[kind]
			if (!range) return false
			return arg.type === 'immediate' && Number.isInteger(arg.value) && arg.value >= range[0] && arg.value <= range[1]
		}
	}
}

export function matchesSignature(signature: Signature, args: MipsArgument[]): boolean {
	return signature.operands.length === args.length &&
		signature.operands.every((kind, index) => matchesKind(kind, args[index]))
}

/** What an operand slot wants, named the way the encoders name it. */
export function describeKind(kind: IsaOperandKind): string {
	if (kind === 'gpr' || kind === 'cp0') return 'a register'
	if (kind === 'fpr' || kind === 'fpr-even') return 'a floating-point register'
	if (kind === 'label' || kind === 'target26' || kind === 'label-offset') return 'a label'
	if (kind === 'mem' || kind === 'base' || kind === 'mem32' || kind === 'label-mem' || kind === 'label-offset-mem') {
		return 'a memory operand'
	}
	return 'an immediate value'
}

/**
 * Rejects an instruction no form of its mnemonic accepts, before expansion
 * or encoding can drop an operand or truncate it to zero.  Matching follows the
 * same way, over its own operand token types
 * (`OperandFormat.tokenOperandMatch`,).
 */
export function validateInstruction(instruction: MipsInstruction, extendedAssembler: boolean, expand: (instruction: MipsInstruction) => MipsInstruction[]) {
	const signatures = signaturesFor(instruction.name)
	// A mnemonic with no form is one the encoder reports as unknown.
	if (signatures.length === 0) return

	const args = instruction.args
	const position = atInstruction(instruction)
	for (const arg of args) {
		if (arg.type === 'register' && !isGpr(arg.value) && !isFpr(arg.value) && !isCp0(arg.value)) {
			throw new AssemblyError(`Unknown register: ${arg.value}`, position)
		}
	}
	if (signatures.some((signature) => matchesSignature(signature, args))) {
		// What is rejected is the form the operands matched, not the mnemonic: an
		// instruction with both a basic and a pseudo form is fine written the
		// basic way.
		if (!extendedAssembler && !basicForms(instruction.name).some((form) => matchesSignature(form, args))) {
			throw new AssemblyError(extendedFormMessage(instruction, expand), position)
		}
		return
	}

	// Only forms of the right length can say anything about an operand.
	const sized = signatures.filter((signature) => signature.operands.length === args.length)
	if (sized.length === 0) {
		const fewest = Math.min(...signatures.map((signature) => signature.operands.length))
		const relation = args.length < fewest ? 'Too few' : 'Too many'
		throw new AssemblyError(`${relation} operands for ${instruction.name}; expected: ${signatures[0].example}`, position)
	}

	// The form that got furthest names the operand actually at fault.
	const matched = (signature: Signature) =>
		signature.operands.findIndex((kind, slot) => !matchesKind(kind, args[slot]))
	const signature = sized.reduce((best, next) => (matched(next) > matched(best) ? next : best))
	const index = matched(signature)
	const kind = signature.operands[index]
	const arg = args[index]
	if (kind === 'fpr-even' && arg.type === 'register' && isFpr(arg.value)) {
		throw new AssemblyError(`${arg.value} must be an even-numbered floating-point register`, position)
	}
	if (IMMEDIATE_RANGES[kind] && arg.type === 'immediate' && Number.isInteger(arg.value)) {
		throw new AssemblyError(
			`Operand ${index + 1} of ${instruction.name} is out of range; expected: ${signature.example}`,
			position,
		)
	}
	throw new AssemblyError(`Expected ${describeKind(kind)}, found ${describeArgument(arg)}`, position)
}

/**
 * The standard wording, extended with the basic sequence
 * the form would have expanded to, which is what the author has to write
 * instead.  An expansion that needs the final layout is left unnamed.
 */
function extendedFormMessage(instruction: MipsInstruction, expand: (instruction: MipsInstruction) => MipsInstruction[]): string {
	const refusal = 'Extended (pseudo) instruction or format not permitted'
	let basic: string
	try {
		basic = expand(instruction).map(formatInstruction).join('; ')
	} catch {
		basic = ''
	}
	return basic ? `${refusal}; it expands to: ${basic}.  See Settings.` : `${refusal}.  See Settings.`
}
