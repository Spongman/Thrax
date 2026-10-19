/**
 * MIT Beta opcode table.
 *
 * Opcodes are from the Beta documentation's instruction summary (beta.pdf section 4)
 * and agree with the course's reference beta.uasm. Every opcode not listed is illegal.
 */

/** Opcodes, the instruction's bits 31:26. */
/** Privileged operations (beta.pdf section 6.5); their meaning belongs to the machine profile. */
export const OP_PRIV = 0x00
export const OP_LD = 0x18
export const OP_ST = 0x19
export const OP_JMP = 0x1B
export const OP_BEQ = 0x1C
export const OP_BNE = 0x1D
export const OP_LDR = 0x1F

export const OP_ADD = 0x20
export const OP_SUB = 0x21
export const OP_MUL = 0x22
export const OP_DIV = 0x23
export const OP_CMPEQ = 0x24
export const OP_CMPLT = 0x25
export const OP_CMPLE = 0x26
export const OP_AND = 0x28
export const OP_OR = 0x29
export const OP_XOR = 0x2A
export const OP_XNOR = 0x2B
export const OP_SHL = 0x2C
export const OP_SHR = 0x2D
export const OP_SRA = 0x2E

export const OP_ADDC = 0x30
export const OP_SUBC = 0x31
export const OP_MULC = 0x32
export const OP_DIVC = 0x33
export const OP_CMPEQC = 0x34
export const OP_CMPLTC = 0x35
export const OP_CMPLEC = 0x36
export const OP_ANDC = 0x38
export const OP_ORC = 0x39
export const OP_XORC = 0x3A
export const OP_XNORC = 0x3B
export const OP_SHLC = 0x3C
export const OP_SHRC = 0x3D
export const OP_SRAC = 0x3E

/** Operand layouts, which decide decoding and disassembly. */
export const FORMAT_ILLEGAL = 0
/** OP(Ra, Rb, Rc) */
export const FORMAT_OP = 1
/** OPC(Ra, literal, Rc) */
export const FORMAT_OPC = 2
/** LD(Ra, literal, Rc) */
export const FORMAT_LD = 3
/** ST(Rc, literal, Ra) */
export const FORMAT_ST = 4
/** JMP(Ra, Rc) */
export const FORMAT_JMP = 5
/** BEQ(Ra, label, Rc) */
export const FORMAT_BRANCH = 6
/** LDR(label, Rc) */
export const FORMAT_LDR = 7

const OPCODES: readonly (readonly [number, string, number])[] = [
	[OP_LD, 'LD', FORMAT_LD],
	[OP_ST, 'ST', FORMAT_ST],
	[OP_JMP, 'JMP', FORMAT_JMP],
	[OP_BEQ, 'BEQ', FORMAT_BRANCH],
	[OP_BNE, 'BNE', FORMAT_BRANCH],
	[OP_LDR, 'LDR', FORMAT_LDR],
	[OP_ADD, 'ADD', FORMAT_OP],
	[OP_SUB, 'SUB', FORMAT_OP],
	[OP_MUL, 'MUL', FORMAT_OP],
	[OP_DIV, 'DIV', FORMAT_OP],
	[OP_CMPEQ, 'CMPEQ', FORMAT_OP],
	[OP_CMPLT, 'CMPLT', FORMAT_OP],
	[OP_CMPLE, 'CMPLE', FORMAT_OP],
	[OP_AND, 'AND', FORMAT_OP],
	[OP_OR, 'OR', FORMAT_OP],
	[OP_XOR, 'XOR', FORMAT_OP],
	[OP_XNOR, 'XNOR', FORMAT_OP],
	[OP_SHL, 'SHL', FORMAT_OP],
	[OP_SHR, 'SHR', FORMAT_OP],
	[OP_SRA, 'SRA', FORMAT_OP],
	[OP_ADDC, 'ADDC', FORMAT_OPC],
	[OP_SUBC, 'SUBC', FORMAT_OPC],
	[OP_MULC, 'MULC', FORMAT_OPC],
	[OP_DIVC, 'DIVC', FORMAT_OPC],
	[OP_CMPEQC, 'CMPEQC', FORMAT_OPC],
	[OP_CMPLTC, 'CMPLTC', FORMAT_OPC],
	[OP_CMPLEC, 'CMPLEC', FORMAT_OPC],
	[OP_ANDC, 'ANDC', FORMAT_OPC],
	[OP_ORC, 'ORC', FORMAT_OPC],
	[OP_XORC, 'XORC', FORMAT_OPC],
	[OP_XNORC, 'XNORC', FORMAT_OPC],
	[OP_SHLC, 'SHLC', FORMAT_OPC],
	[OP_SHRC, 'SHRC', FORMAT_OPC],
	[OP_SRAC, 'SRAC', FORMAT_OPC],
]

/** Format of each of the 64 opcodes; FORMAT_ILLEGAL where none is assigned. */
export const OPCODE_FORMAT = new Uint8Array(64)

/** Mnemonic of each of the 64 opcodes; empty where none is assigned. */
export const OPCODE_MNEMONIC: readonly string[] = (() => {
	const names: string[] = new Array(64).fill('')
	for (const [opcode, name, format] of OPCODES) {
		names[opcode] = name
		OPCODE_FORMAT[opcode] = format
	}
	return names
})()

/** Opcode for a mnemonic, or -1 when it names no instruction. */
export function opcodeOf(mnemonic: string): number {
	return mnemonic ? OPCODE_MNEMONIC.indexOf(mnemonic.toUpperCase()) : -1
}
