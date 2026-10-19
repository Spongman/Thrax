/**
 * Machine-word decoding.
 *
 * The selection is the isa table's: `findByBinary` resolves a word to the same
 * form the assembler encoded it from, longest mask first, so encode and decode
 * cannot drift apart and a reserved encoding (opcode 1 with an `rt` no form
 * claims) decodes to nothing rather than to a neighbouring branch.  This module
 * adds only what execution and formatting need on top: the MIPS32 field layout,
 * and each operand read out of its own field.
 */

import { type BasicInstruction, basicForms, findByBinary, type IsaField, type IsaOperandKind } from './isa'
import { opFor } from './ops'
import type { InstructionInfo } from '../../contracts'

/**
 * How a decoded instruction's operands are laid out, for formatting.  Derived
 * from the form's operand kinds and their field positions, except for the three
 * mnemonics whose shape names the instruction (`jr`, `jalr`, `break`).
 */
export type OperandShape =
	| 'rd,rs,rt'
	| 'rd,rt,shamt'
	| 'rd,rt,rs'
	| 'rs,rt'
	| 'rd'
	| 'rs'
	| 'jr'
	| 'jalr'
	| 'rd,rs'
	| 'rd,rs,cc'
	| 'none'
	| 'rt,rs,imm'
	| 'rt,rs,uimm'
	| 'rt,uimm'
	| 'rs,imm'
	| 'rt,offset(rs)'
	| 'ft,offset(rs)'
	| 'rs,rt,branch'
	| 'rs,branch'
	| 'branch'
	| 'cc,branch'
	| 'jump'
	| 'break'
	| 'rt,cp0'
	| 'rt,fs'
	| 'fd,fs,ft'
	| 'fd,fs,rt'
	| 'fd,fs,cc'
	| 'fd,fs'
	| 'fs,ft'
	| 'cc,fs,ft'

/** One operand read out of the word, in the order the source spells it. */
export interface DecodedOperand {
	kind: IsaOperandKind
	/** The field's value, sign-extended where the kind is signed. */
	value: number
	/** A `mem` operand's base register; its offset is `value`. */
	base?: number
}

export interface Decoded {
	/** Which instruction this is; `OP_NAMES` spells it. */
	op: number
	shape: OperandShape
	rs: number
	rt: number
	rd: number
	shamt: number
	/** CP1 operands: `ft` and `fs` and `fd` occupy rt, rd, and shamt. */
	ft: number
	fs: number
	fd: number
	/** FP condition code, 0-7; zero for the forms that name none. */
	cc: number
	/** Sign-extended 16-bit immediate. */
	imm: number
	/** Zero-extended 16-bit immediate. */
	uimm: number
	/** 26-bit jump index; also the 20-bit `break` code, shifted up by six. */
	index: number
	word: number
	/** The isa form this word matched. */
	form: BasicInstruction
	/** Its operands, in source order. */
	operands: readonly DecodedOperand[]
	/** What the tools read of it, filled in the first time one asks. */
	info: InstructionInfo | undefined
}

/** Kinds whose field is signed. */
const SIGNED_KINDS: ReadonlySet<IsaOperandKind> = new Set<IsaOperandKind>(['imm16s', 'label'])

/** The name one operand contributes to the shape. */
type OperandSlot = string

/** Where a general-purpose operand's field puts it. */
const GPR_SLOTS: Record<number, OperandSlot> = { 21: 'rs', 16: 'rt', 11: 'rd' }

/** Where a CP1 operand's field puts it: `ft` and `fs` and `fd` low bits first. */
const FPR_SLOTS: Record<number, OperandSlot> = { 16: 'ft', 11: 'fs', 6: 'fd' }

/** Shapes that name the instruction rather than its fields, because consumers key on them. */
const SHAPE_BY_MNEMONIC: Record<string, OperandShape> = { jr: 'jr', jalr: 'jalr', break: 'break' }

function fieldValue(word: number, field: IsaField): number {
	return ((word >>> field.shift) & ((1 << field.width) - 1)) >>> 0
}

function signExtend(value: number, width: number): number {
	const sign = 1 << (width - 1)
	return value & sign ? value - (1 << width) : value
}

/** Each operand of `form`, read from `word`; a `mem` operand spends two fields. */
function readOperands(word: number, form: BasicInstruction): DecodedOperand[] {
	const operands: DecodedOperand[] = []
	let next = 0
	for (const kind of form.operands) {
		const field = form.fields[next++]
		if (kind === 'mem') {
			const base = form.fields[next++]
			operands.push({ kind, value: signExtend(fieldValue(word, field), field.width), base: fieldValue(word, base) })
			continue
		}
		const raw = fieldValue(word, field)
		operands.push({ kind, value: SIGNED_KINDS.has(kind) ? signExtend(raw, field.width) : raw })
	}
	return operands
}

/** The slot one operand occupies, or null for a kind no basic form uses. */
function operandSlot(kind: IsaOperandKind, field: IsaField): OperandSlot | null {
	switch (kind) {
		case 'gpr': return GPR_SLOTS[field.shift] ?? null
		case 'fpr':
		case 'fpr-even': return FPR_SLOTS[field.shift] ?? null
		case 'cp0': return 'cp0'
		case 'imm5': return 'shamt'
		case 'imm3': return 'cc'
		case 'imm16s': return 'imm'
		case 'imm16u': return 'uimm'
		case 'imm20': return 'code'
		case 'label': return 'branch'
		case 'target26': return 'jump'
		case 'mem': return 'offset(rs)'
		default: return null
	}
}

/** The form's operand slots joined, which is what the formatter switches on. */
function deriveShape(form: BasicInstruction): OperandShape {
	const named = SHAPE_BY_MNEMONIC[form.mnemonic]
	if (named) return named
	const slots: OperandSlot[] = []
	let next = 0
	for (const kind of form.operands) {
		const slot = operandSlot(kind, form.fields[next])
		next += kind === 'mem' ? 2 : 1
		if (slot === null) return 'none'
		slots.push(slot)
	}
	return (slots.length === 0 ? 'none' : slots.join(',')) as OperandShape
}

/** One shape per form, derived once. */
const SHAPES = new WeakMap<BasicInstruction, OperandShape>()

function shapeOf(form: BasicInstruction): OperandShape {
	const cached = SHAPES.get(form)
	if (cached !== undefined) return cached
	const shape = deriveShape(form)
	SHAPES.set(form, shape)
	return shape
}

/**
 * `nop` and `sll $zero,$zero,0` are one word, so the shift is what runs; the
 * disassembler is where the word is spelled `nop` again.
 */
const SHIFT_FORM = basicForms('sll')[0]

/** Decodes one machine word, or returns null when it encodes no known instruction. */
export function decode(word: number): Decoded | null {
	const value = word >>> 0
	const matched = findByBinary(value)
	if (!matched) return null
	const form = matched.mnemonic === 'nop' ? SHIFT_FORM : matched

	const operands = readOperands(value, form)
	const condition = operands.find((operand) => operand.kind === 'imm3')
	const immediate = value & 0xffff
	return {
		op: opFor(form.mnemonic) ?? -1,
		shape: shapeOf(form),
		rs: (value >>> 21) & 0x1f,
		rt: (value >>> 16) & 0x1f,
		rd: (value >>> 11) & 0x1f,
		shamt: (value >>> 6) & 0x1f,
		// A CP1 operation names ft, fs, and fd from low bits to high.
		ft: (value >>> 16) & 0x1f,
		fs: (value >>> 11) & 0x1f,
		fd: (value >>> 6) & 0x1f,
		cc: condition?.value ?? 0,
		imm: immediate & 0x8000 ? immediate - 0x10000 : immediate,
		uimm: immediate,
		index: value & 0x3ffffff,
		word: value,
		form,
		operands,
		info: undefined,
	}
}
