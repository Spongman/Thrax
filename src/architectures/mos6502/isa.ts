/**
 * The 151 documented NMOS 6502 opcodes as tables indexed by opcode byte, from
 * the MOS MCS6500 programming manual (appendix A) and its cycle tables.
 * Undocumented opcodes are absent: OPCODE_INSN holds -1 for them.
 */

/** Addressing modes, in the order MODE_BYTES and MODE_NAMES index. */
export const IMP = 0
export const ACC = 1
export const IMM = 2
export const ZP = 3
export const ZPX = 4
export const ZPY = 5
export const ABS = 6
export const ABX = 7
export const ABY = 8
export const IND = 9
export const IZX = 10
export const IZY = 11
export const REL = 12
export const MODE_COUNT = 13

/** Instruction length by mode, opcode included. */
export const MODE_BYTES: readonly number[] = Object.freeze([1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2])

export const MODE_NAMES: readonly string[] = Object.freeze([
	'implied', 'accumulator', 'immediate', 'zero page', 'zero page,X', 'zero page,Y',
	'absolute', 'absolute,X', 'absolute,Y', 'indirect', '(indirect,X)', '(indirect),Y', 'relative',
])

/** Mnemonics, by instruction id. */
export const MNEMONICS: readonly string[] = Object.freeze([
	'ADC', 'AND', 'ASL', 'BCC', 'BCS', 'BEQ', 'BIT', 'BMI', 'BNE', 'BPL', 'BRK', 'BVC', 'BVS', 'CLC',
	'CLD', 'CLI', 'CLV', 'CMP', 'CPX', 'CPY', 'DEC', 'DEX', 'DEY', 'EOR', 'INC', 'INX', 'INY', 'JMP',
	'JSR', 'LDA', 'LDX', 'LDY', 'LSR', 'NOP', 'ORA', 'PHA', 'PHP', 'PLA', 'PLP', 'ROL', 'ROR', 'RTI',
	'RTS', 'SBC', 'SEC', 'SED', 'SEI', 'STA', 'STX', 'STY', 'TAX', 'TAY', 'TSX', 'TXA', 'TXS', 'TYA',
])

// Instruction ids, MNEMONICS' indices.
export const ADC = 0, AND = 1, ASL = 2, BCC = 3, BCS = 4, BEQ = 5, BIT = 6, BMI = 7, BNE = 8, BPL = 9, BRK = 10, BVC = 11, BVS = 12, CLC = 13
export const CLD = 14, CLI = 15, CLV = 16, CMP = 17, CPX = 18, CPY = 19, DEC = 20, DEX = 21, DEY = 22, EOR = 23, INC = 24, INX = 25, INY = 26, JMP = 27
export const JSR = 28, LDA = 29, LDX = 30, LDY = 31, LSR = 32, NOP = 33, ORA = 34, PHA = 35, PHP = 36, PLA = 37, PLP = 38, ROL = 39, ROR = 40, RTI = 41
export const RTS = 42, SBC = 43, SEC = 44, SED = 45, SEI = 46, STA = 47, STX = 48, STY = 49, TAX = 50, TAY = 51, TSX = 52, TXA = 53, TXS = 54, TYA = 55

/**
 * `opcode:mode:cycles` per mnemonic; `+` adds a cycle when indexing crosses a
 * page. Branches add one cycle when taken and another when the target is on
 * a different page from the next instruction.
 */
const TABLE = `
ADC 69:IMM:2 65:ZP:3 75:ZPX:4 6D:ABS:4 7D:ABX:4+ 79:ABY:4+ 61:IZX:6 71:IZY:5+
AND 29:IMM:2 25:ZP:3 35:ZPX:4 2D:ABS:4 3D:ABX:4+ 39:ABY:4+ 21:IZX:6 31:IZY:5+
ASL 0A:ACC:2 06:ZP:5 16:ZPX:6 0E:ABS:6 1E:ABX:7
BCC 90:REL:2
BCS B0:REL:2
BEQ F0:REL:2
BIT 24:ZP:3 2C:ABS:4
BMI 30:REL:2
BNE D0:REL:2
BPL 10:REL:2
BRK 00:IMP:7
BVC 50:REL:2
BVS 70:REL:2
CLC 18:IMP:2
CLD D8:IMP:2
CLI 58:IMP:2
CLV B8:IMP:2
CMP C9:IMM:2 C5:ZP:3 D5:ZPX:4 CD:ABS:4 DD:ABX:4+ D9:ABY:4+ C1:IZX:6 D1:IZY:5+
CPX E0:IMM:2 E4:ZP:3 EC:ABS:4
CPY C0:IMM:2 C4:ZP:3 CC:ABS:4
DEC C6:ZP:5 D6:ZPX:6 CE:ABS:6 DE:ABX:7
DEX CA:IMP:2
DEY 88:IMP:2
EOR 49:IMM:2 45:ZP:3 55:ZPX:4 4D:ABS:4 5D:ABX:4+ 59:ABY:4+ 41:IZX:6 51:IZY:5+
INC E6:ZP:5 F6:ZPX:6 EE:ABS:6 FE:ABX:7
INX E8:IMP:2
INY C8:IMP:2
JMP 4C:ABS:3 6C:IND:5
JSR 20:ABS:6
LDA A9:IMM:2 A5:ZP:3 B5:ZPX:4 AD:ABS:4 BD:ABX:4+ B9:ABY:4+ A1:IZX:6 B1:IZY:5+
LDX A2:IMM:2 A6:ZP:3 B6:ZPY:4 AE:ABS:4 BE:ABY:4+
LDY A0:IMM:2 A4:ZP:3 B4:ZPX:4 AC:ABS:4 BC:ABX:4+
LSR 4A:ACC:2 46:ZP:5 56:ZPX:6 4E:ABS:6 5E:ABX:7
NOP EA:IMP:2
ORA 09:IMM:2 05:ZP:3 15:ZPX:4 0D:ABS:4 1D:ABX:4+ 19:ABY:4+ 01:IZX:6 11:IZY:5+
PHA 48:IMP:3
PHP 08:IMP:3
PLA 68:IMP:4
PLP 28:IMP:4
ROL 2A:ACC:2 26:ZP:5 36:ZPX:6 2E:ABS:6 3E:ABX:7
ROR 6A:ACC:2 66:ZP:5 76:ZPX:6 6E:ABS:6 7E:ABX:7
RTI 40:IMP:6
RTS 60:IMP:6
SBC E9:IMM:2 E5:ZP:3 F5:ZPX:4 ED:ABS:4 FD:ABX:4+ F9:ABY:4+ E1:IZX:6 F1:IZY:5+
SEC 38:IMP:2
SED F8:IMP:2
SEI 78:IMP:2
STA 85:ZP:3 95:ZPX:4 8D:ABS:4 9D:ABX:5 99:ABY:5 81:IZX:6 91:IZY:6
STX 86:ZP:3 96:ZPY:4 8E:ABS:4
STY 84:ZP:3 94:ZPX:4 8C:ABS:4
TAX AA:IMP:2
TAY A8:IMP:2
TSX BA:IMP:2
TXA 8A:IMP:2
TXS 9A:IMP:2
TYA 98:IMP:2
`

const MODE_IDS: Readonly<Record<string, number>> = { IMP, ACC, IMM, ZP, ZPX, ZPY, ABS, ABX, ABY, IND, IZX, IZY, REL }

/** Instruction id by opcode, -1 where the opcode is undocumented. */
export const OPCODE_INSN = new Int8Array(256).fill(-1)
/** Addressing mode by opcode. */
export const OPCODE_MODE = new Uint8Array(256)
/** Base cycles by opcode. */
export const OPCODE_CYCLES = new Uint8Array(256)
/** 1 where indexing across a page costs a cycle. */
export const OPCODE_PAGE_PENALTY = new Uint8Array(256)
/** Opcode by instruction id and mode, -1 where the pair does not exist. */
export const INSN_OPCODE: readonly Int16Array[] = MNEMONICS.map(() => new Int16Array(MODE_COUNT).fill(-1))

for (const line of TABLE.trim().split('\n')) {
	const [mnemonic, ...forms] = line.split(' ')
	const insn = MNEMONICS.indexOf(mnemonic)
	for (const form of forms) {
		const [hex, mode, cycles] = form.split(':')
		const opcode = Number.parseInt(hex, 16)
		OPCODE_INSN[opcode] = insn
		OPCODE_MODE[opcode] = MODE_IDS[mode]
		OPCODE_CYCLES[opcode] = Number.parseInt(cycles, 10)
		OPCODE_PAGE_PENALTY[opcode] = cycles.endsWith('+') ? 1 : 0
		INSN_OPCODE[insn][MODE_IDS[mode]] = opcode
	}
}

/** Mnemonic id by upper-case name. */
export const INSN_BY_NAME: ReadonlyMap<string, number> = new Map(MNEMONICS.map((name, index) => [name, index]))

/** Branches, all relative. */
export const isBranch = (insn: number) => INSN_OPCODE[insn][REL] >= 0

/** Shifts and rotates, whose accumulator operand may be left out. */
export const takesAccumulator = (insn: number) => INSN_OPCODE[insn][ACC] >= 0
