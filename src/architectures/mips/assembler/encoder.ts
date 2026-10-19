/**
 * MIPS instruction encodings: the basic instructions, once expanded and laid
 * out, as machine words.  Label operands resolve through the caller, which
 * looks them up in the referring unit's scope.
 */

import { cp0RegisterNumber, fpRegisterNumber } from '../core/coprocessor'
import { basicForms, type IsaOperandKind } from '../core/isa'
import { registerNumber } from '../core/registers'
import { AssemblyError, atInstruction, type SourcePosition } from '../../../core/diagnostics'
import type { LabelArgument, MipsArgument, MipsInstruction } from '../../../core/types'
import { describeArgument, matchesSignature } from './operands'

/** Instructions taking an `rt, offset(base)` operand pair. */
const LOAD_STORE_NAMES = new Set([
	'LW', 'LH', 'LHU', 'LB', 'LBU', 'SW', 'SH', 'SB',
	'LWL', 'LWR', 'SWL', 'SWR', 'LL', 'SC',
])

const COP0_OPCODE = 0x10
const COP1_OPCODE = 0x11

/** CP1 format field: single, double, and 32-bit integer. */
const FP_FORMAT_CODES: Record<string, number> = { S: 16, D: 17, W: 20 }
const FP_ARITHMETIC_FUNCTIONS: Record<string, number> = { ADD: 0, SUB: 1, MUL: 2, DIV: 3, SQRT: 4, ABS: 5, MOV: 6, NEG: 7 }
const FP_UNARY_OPERATIONS = new Set(['SQRT', 'ABS', 'MOV', 'NEG'])
const FP_CONVERT_FUNCTIONS: Record<string, number> = {
	'ROUND.W': 12,
	'TRUNC.W': 13,
	'CEIL.W': 14,
	'FLOOR.W': 15,
	'CVT.S': 32,
	'CVT.D': 33,
	'CVT.W': 36,
}
const FP_MEMORY_OPCODES: Record<string, number> = { LWC1: 0x31, LDC1: 0x35, SWC1: 0x39, SDC1: 0x3d }

/** Address of a label operand, including the constant of `label+4`; throws when undefined. */
export type LabelResolver = (instruction: MipsInstruction, arg: LabelArgument) => number

export class Encoder {
	currentAddress = 0
	/** Instruction being encoded, which positions its diagnostics. */
	currentInstruction: MipsInstruction | null = null

	constructor(private readonly labelAddress: LabelResolver) {}

	/** Position of the instruction being worked on, for the encoding helpers. */
	instructionPosition(): SourcePosition {
		return atInstruction(this.currentInstruction)
	}

	encodeInstruction(instr: MipsInstruction): number {
		const name = instr.name
		this.currentAddress = instr.address ?? 0
		this.currentInstruction = instr

		// Resolve labels in arguments
		const args = instr.args.map((arg) => this.resolveArgument(arg))
		// The simulator executes the parsed instruction objects, so preserve the
		// resolved addresses there as well as in the encoded instruction.
		instr.args = args

		// R-type instructions (func-based)
		const rTypeInstructions: Record<string, { opcode: number; func: number }> = {
			ADD: { opcode: 0, func: 0x20 },
			ADDU: { opcode: 0, func: 0x21 },
			SUB: { opcode: 0, func: 0x22 },
			SUBU: { opcode: 0, func: 0x23 },
			AND: { opcode: 0, func: 0x24 },
			OR: { opcode: 0, func: 0x25 },
			XOR: { opcode: 0, func: 0x26 },
			NOR: { opcode: 0, func: 0x27 },
			SLT: { opcode: 0, func: 0x2a },
			SLTU: { opcode: 0, func: 0x2b },
		MULT: { opcode: 0, func: 0x18 },
		MULTU: { opcode: 0, func: 0x19 },
		MUL: { opcode: 0x1c, func: 0x02 },
			DIV: { opcode: 0, func: 0x1a },
			DIVU: { opcode: 0, func: 0x1b },
			MFHI: { opcode: 0, func: 0x10 },
			MFLO: { opcode: 0, func: 0x12 },
			MTHI: { opcode: 0, func: 0x11 },
			MTLO: { opcode: 0, func: 0x13 },
			SLL: { opcode: 0, func: 0x00 },
			SRL: { opcode: 0, func: 0x02 },
			SRA: { opcode: 0, func: 0x03 },
			SLLV: { opcode: 0, func: 0x04 },
			SRLV: { opcode: 0, func: 0x06 },
			SRAV: { opcode: 0, func: 0x07 },
			JR: { opcode: 0, func: 0x08 },
			JALR: { opcode: 0, func: 0x09 },
		}

		// I-type instructions
		const iTypeInstructions: Record<string, number> = {
			ADDI: 0x08,
			ADDIU: 0x09,
			SLTI: 0x0a,
			SLTIU: 0x0b,
			ANDI: 0x0c,
			ORI: 0x0d,
			XORI: 0x0e,
			LUI: 0x0f,
			BEQ: 0x04,
			BNE: 0x05,
			BGEZ: 0x01,
			BGTZ: 0x07,
			BLEZ: 0x06,
			BLTZ: 0x01,
			LW: 0x23,
			LH: 0x21,
			LHU: 0x25,
			LB: 0x20,
			LBU: 0x24,
			SW: 0x2b,
			SH: 0x29,
			SB: 0x28,
			LWL: 0x22,
			LWR: 0x26,
			SWL: 0x2a,
			SWR: 0x2e,
			LL: 0x30,
			SC: 0x38,
		}

		// J-type instructions
		const jTypeInstructions: Record<string, number> = {
			J: 0x02,
			JAL: 0x03,
		}

		const coprocessorCode = this.encodeCoprocessor(name, args)
		if (coprocessorCode !== null) return coprocessorCode

		if (rTypeInstructions[name]) {
			return this.encodeRType(name, args, rTypeInstructions[name])
		}
		if (iTypeInstructions[name]) {
			return this.encodeIType(name, args, iTypeInstructions[name])
		}
		if (jTypeInstructions[name]) {
			return this.encodeJType(name, args, jTypeInstructions[name])
		}

		// Pseudo-instructions should have been expanded before encoding.
		switch (name) {
			case 'NOP':
				return 0x00000000
			case 'MOVE':
				// move $rd, $rs -> addu $rd, $rs, $zero
				return this.encodeRType('ADDU', args, { opcode: 0, func: 0x21 })
		case 'SYSCALL':
			return 0x0000000c
			case 'BREAK':
				return (((this.getImmediateValue(args[0]) & 0xfffff) << 6) | 0x0d) >>> 0
			default: {
				const encoded = this.encodeFromTable(name, args)
				if (encoded !== null) return encoded
				throw new AssemblyError(`Unknown instruction: ${name}`, this.instructionPosition())
			}
		}
	}

	/**
	 * Encodes straight from the isa table: the form's fixed bits, then each
	 * operand into the run of `f`, `s` or `t` its bit pattern names.  The letters
	 * bind to the operands in order, and a `mem` operand spends two of them, its
	 * offset then its base register.  Null when
	 * no form of `name` fits these operands.
	 */
	encodeFromTable(name: string, args: MipsArgument[]): number | null {
		const form = basicForms(name).find((candidate) => matchesSignature(candidate, args))
		if (!form) return null

		const values = form.operands.flatMap((kind, index) => this.operandBits(kind, args[index]))
		let word = form.match
		form.fields.forEach((field, index) => {
			const mask = (2 ** field.width - 1) >>> 0
			word = (word | (((values[index] ?? 0) & mask) << field.shift)) >>> 0
		})
		return word >>> 0
	}

	/** The bits one operand contributes, in the order its pattern letters run. */
	operandBits(kind: IsaOperandKind, arg: MipsArgument): number[] {
		switch (kind) {
			case 'gpr': return [this.getRegisterNumber(arg)]
			case 'cp0': return [this.getCp0RegisterNumber(arg)]
			case 'fpr':
			case 'fpr-even': return [this.getFpRegisterNumber(arg)]
			// A basic form spells a label only as a branch target.
			case 'label': return [this.getBranchOffset(arg)]
			case 'target26': return [this.getJumpAddress(arg) >>> 2]
			case 'mem': return arg.type === 'memory'
				? [this.getImmediateValue(arg.offset), this.getRegisterNumber(arg.register)]
				: [this.getImmediateValue(arg), 0]
			default: return [this.getImmediateValue(arg)]
		}
	}

	/** Encodes a CP0 or CP1 instruction, or returns null when `name` is neither. */
	encodeCoprocessor(name: string, args: MipsArgument[]): number | null {
		if (name === 'ERET') return ((COP0_OPCODE << 26) | (1 << 25) | 0x18) >>> 0

		if (name === 'MFC0' || name === 'MTC0') {
			const rt = this.getRegisterNumber(args[0])
			const rd = this.getCp0RegisterNumber(args[1])
			return ((COP0_OPCODE << 26) | ((name === 'MTC0' ? 4 : 0) << 21) | (rt << 16) | (rd << 11)) >>> 0
		}

		if (FP_MEMORY_OPCODES[name] !== undefined) {
			const ft = this.getFpRegisterNumber(args[0])
			const target = args[1]
			const isMemory = typeof target === 'object' && target.type === 'memory'
			const base = isMemory ? this.getRegisterNumber(target.register) : 0
			const offset = (isMemory ? this.getImmediateValue(target.offset) : this.getImmediateValue(target)) & 0xffff
			return ((FP_MEMORY_OPCODES[name] << 26) | (base << 21) | (ft << 16) | offset) >>> 0
		}

		if (name === 'MFC1' || name === 'MTC1') {
			const rt = this.getRegisterNumber(args[0])
			const fs = this.getFpRegisterNumber(args[1])
			return ((COP1_OPCODE << 26) | ((name === 'MTC1' ? 4 : 0) << 21) | (rt << 16) | (fs << 11)) >>> 0
		}

		const parts = name.split('.')
		const format = FP_FORMAT_CODES[parts[parts.length - 1]]
		if (format === undefined) return null

		if (parts.length === 2 && FP_ARITHMETIC_FUNCTIONS[parts[0]] !== undefined) {
			const unary = FP_UNARY_OPERATIONS.has(parts[0])
			return this.encodeCop1(
				format,
				unary ? 0 : this.getFpRegisterNumber(args[2]),
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				FP_ARITHMETIC_FUNCTIONS[parts[0]],
			)
		}

		if (parts.length === 3 && FP_CONVERT_FUNCTIONS[`${parts[0]}.${parts[1]}`] !== undefined) {
			return this.encodeCop1(
				format,
				0,
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				FP_CONVERT_FUNCTIONS[`${parts[0]}.${parts[1]}`],
			)
		}

		return null
	}

	encodeCop1(format: number, ft: number, fs: number, fd: number, func: number): number {
		return ((COP1_OPCODE << 26) | (format << 21) | (ft << 16) | (fs << 11) | (fd << 6) | func) >>> 0
	}

	getFpRegisterNumber(arg: MipsArgument | undefined): number {
		if (typeof arg === 'object' && arg.type === 'register') return fpRegisterNumber(arg.value)
		throw new AssemblyError('Expected a floating-point register', this.instructionPosition())
	}

	getCp0RegisterNumber(arg: MipsArgument | undefined): number {
		if (typeof arg === 'object' && arg.type === 'register') return cp0RegisterNumber(arg.value)
		throw new AssemblyError('Expected a coprocessor 0 register', this.instructionPosition())
	}

	encodeRType(name: string, args: MipsArgument[], { opcode, func }: { opcode: number; func: number }): number {
		let rs = 0,
			rt = 0,
			rd = 0,
			shamt = 0

		// Determine argument positions based on instruction
		if (['SLL', 'SRL', 'SRA'].includes(name)) {
			// rd, rt, shamt format
			rd = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			shamt = this.getImmediateValue(args[2])
		} else if (['SLLV', 'SRLV', 'SRAV'].includes(name)) {
			// rd, rt, rs format
			rd = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			rs = this.getRegisterNumber(args[2])
		} else if (['MFHI', 'MFLO'].includes(name)) {
			// rd only
			rd = this.getRegisterNumber(args[0])
		} else if (['MTHI', 'MTLO', 'JR'].includes(name)) {
			// rs only
			rs = this.getRegisterNumber(args[0])
		} else if (['MULT', 'MULTU', 'DIV', 'DIVU'].includes(name)) {
			// rs, rt format
			rs = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
		} else if (['JALR'].includes(name)) {
			// rd, rs format, or rs alone with $ra as the implied link register
			if (args.length === 2) {
				rd = this.getRegisterNumber(args[0])
				rs = this.getRegisterNumber(args[1])
			} else {
				rd = 31
				rs = this.getRegisterNumber(args[0])
			}
		} else {
			// Standard rd, rs, rt format (or variants)
			rd = this.getRegisterNumber(args[0])
			rs = this.getRegisterNumber(args[1])
			rt = this.getRegisterNumber(args[2])
		}

		return ((opcode << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (shamt << 6) | func) >>> 0
	}

	encodeIType(name: string, args: MipsArgument[], opcode: number): number {
		// Only `rs` has a default: the load/store and LUI forms leave it at zero.
		let rs = 0
		let rt: number
		let imm: number

		// Load/Store instructions: rt, offset(rs)
		if (LOAD_STORE_NAMES.has(name)) {
			rt = this.getRegisterNumber(args[0])
			if (args[1].type === 'memory') {
				rs = this.getRegisterNumber(args[1].register)
				imm = this.getImmediateValue(args[1].offset) & 0xffff
			} else {
				imm = this.getImmediateValue(args[1]) & 0xffff
			}
		}
		// Branch instructions: rs, rt, offset
		else if (['BEQ', 'BNE'].includes(name)) {
			rs = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			imm = this.getBranchOffset(args[2]) & 0xffff
		}
		// Branch against zero: rs, offset.  bltz and bgez share opcode 1 and are
		// told apart by rt.
		else if (['BGEZ', 'BGTZ', 'BLEZ', 'BLTZ'].includes(name)) {
			rs = this.getRegisterNumber(args[0])
			rt = name === 'BGEZ' ? 1 : 0
			imm = this.getBranchOffset(args[1]) & 0xffff
		}
		// LUI: rt, imm
		else if (name === 'LUI') {
			rt = this.getRegisterNumber(args[0])
			imm = this.getImmediateValue(args[1]) & 0xffff
		}
		// Standard: rt, rs, imm
		else {
			rt = this.getRegisterNumber(args[0])
			rs = this.getRegisterNumber(args[1])
			imm = this.getImmediateValue(args[2]) & 0xffff
		}

		return ((opcode << 26) | (rs << 21) | (rt << 16) | imm) >>> 0
	}

	encodeJType(name: string, args: MipsArgument[], opcode: number): number {
		const address = this.getJumpAddress(args[0]) >> 2
		return ((opcode << 26) | (address & 0x3ffffff)) >>> 0
	}

	getRegisterNumber(arg: MipsArgument | string | undefined): number {
		const name = typeof arg === 'string'
			? arg
			: typeof arg === 'object' && arg.type === 'register' ? arg.value : null
		// Falling back to register 0 here silently drops the operand, which turns
		// `add $t0, $t1, 5` into `add $t0, $t1, $zero` and assembles a wrong answer.
		if (name === null) throw new AssemblyError(`Expected a register, found ${describeArgument(arg)}`, this.instructionPosition())

		const number = registerNumber(name)
		if (number === null) throw new AssemblyError(`Unknown register: ${name}`, this.instructionPosition())
		return number
	}

	getImmediateValue(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) return arg.address
		if (typeof arg === 'object' && 'value' in arg && typeof arg.value === 'number') return arg.value
		return 0
	}

	getBranchOffset(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		// A number in a branch's target position is an offset in words.
		if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) {
			// Offset is relative to PC+4, in words (divide by 4)
			return (arg.address - (this.currentAddress + 4)) >> 2
		}
		return 0
	}

	getJumpAddress(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) {
			return arg.address
		}
		return 0
	}

	resolveArgument(arg: MipsArgument): MipsArgument {
		if (arg.type === 'label') {
			return { ...arg, address: this.labelAddress(this.currentInstruction!, arg) }
		}
		if (arg.type === 'memory') {
			const offset = this.resolveArgument(arg.offset)
			if (offset.type !== 'immediate' && offset.type !== 'label') throw new AssemblyError('Invalid memory offset', this.instructionPosition())
			return { ...arg, offset }
		}
		return arg
	}
}
