/**
 * Every basic instruction as a small integer, and the mnemonic each one spells.
 *
 * The simulator dispatches on one of these per instruction.  A switch over
 * integers compares small numbers; a switch over strings compares characters,
 * because the mnemonic the decoder hands over is not the same object as the
 * string literal in a `case`.  Measured over the cases the dispatch reaches,
 * that is 54ns against 13ns.
 *
 * The names are the ISA's own spelling, in its own case, and are the only
 * spelling the workspace uses: a mnemonic is never re-cased on its way to a
 * panel or back.  The numbering is the order of the ISA table and means nothing
 * else; nothing persists it, so it is free to move when an instruction is added.
 */
export class Op {
	static readonly NOP = 0
	static readonly ADD = 1
	static readonly SUB = 2
	static readonly ADDI = 3
	static readonly ADDU = 4
	static readonly SUBU = 5
	static readonly ADDIU = 6
	static readonly MULT = 7
	static readonly MULTU = 8
	static readonly MUL = 9
	static readonly MADD = 10
	static readonly MADDU = 11
	static readonly MSUB = 12
	static readonly MSUBU = 13
	static readonly DIV = 14
	static readonly DIVU = 15
	static readonly MFHI = 16
	static readonly MFLO = 17
	static readonly MTHI = 18
	static readonly MTLO = 19
	static readonly AND = 20
	static readonly OR = 21
	static readonly ANDI = 22
	static readonly ORI = 23
	static readonly NOR = 24
	static readonly XOR = 25
	static readonly XORI = 26
	static readonly SLL = 27
	static readonly SLLV = 28
	static readonly SRL = 29
	static readonly SRA = 30
	static readonly SRAV = 31
	static readonly SRLV = 32
	static readonly LW = 33
	static readonly LL = 34
	static readonly LWL = 35
	static readonly LWR = 36
	static readonly SW = 37
	static readonly SC = 38
	static readonly SWL = 39
	static readonly SWR = 40
	static readonly LUI = 41
	static readonly BEQ = 42
	static readonly BNE = 43
	static readonly BGEZ = 44
	static readonly BGEZAL = 45
	static readonly BGTZ = 46
	static readonly BLEZ = 47
	static readonly BLTZ = 48
	static readonly BLTZAL = 49
	static readonly SLT = 50
	static readonly SLTU = 51
	static readonly SLTI = 52
	static readonly SLTIU = 53
	static readonly MOVN = 54
	static readonly MOVZ = 55
	static readonly MOVF = 56
	static readonly MOVT = 57
	static readonly BREAK = 58
	static readonly SYSCALL = 59
	static readonly J = 60
	static readonly JR = 61
	static readonly JAL = 62
	static readonly JALR = 63
	static readonly LB = 64
	static readonly LH = 65
	static readonly LHU = 66
	static readonly LBU = 67
	static readonly SB = 68
	static readonly SH = 69
	static readonly CLO = 70
	static readonly CLZ = 71
	static readonly MFC0 = 72
	static readonly MTC0 = 73
	static readonly ADD_S = 74
	static readonly SUB_S = 75
	static readonly MUL_S = 76
	static readonly DIV_S = 77
	static readonly SQRT_S = 78
	static readonly FLOOR_W_S = 79
	static readonly CEIL_W_S = 80
	static readonly ROUND_W_S = 81
	static readonly TRUNC_W_S = 82
	static readonly ADD_D = 83
	static readonly SUB_D = 84
	static readonly MUL_D = 85
	static readonly DIV_D = 86
	static readonly SQRT_D = 87
	static readonly FLOOR_W_D = 88
	static readonly CEIL_W_D = 89
	static readonly ROUND_W_D = 90
	static readonly TRUNC_W_D = 91
	static readonly BC1T = 92
	static readonly BC1F = 93
	static readonly C_EQ_S = 94
	static readonly C_LE_S = 95
	static readonly C_LT_S = 96
	static readonly C_EQ_D = 97
	static readonly C_LE_D = 98
	static readonly C_LT_D = 99
	static readonly ABS_S = 100
	static readonly ABS_D = 101
	static readonly CVT_D_S = 102
	static readonly CVT_D_W = 103
	static readonly CVT_S_D = 104
	static readonly CVT_S_W = 105
	static readonly CVT_W_D = 106
	static readonly CVT_W_S = 107
	static readonly MOV_D = 108
	static readonly MOVF_D = 109
	static readonly MOVT_D = 110
	static readonly MOVN_D = 111
	static readonly MOVZ_D = 112
	static readonly MOV_S = 113
	static readonly MOVF_S = 114
	static readonly MOVT_S = 115
	static readonly MOVN_S = 116
	static readonly MOVZ_S = 117
	static readonly MFC1 = 118
	static readonly MTC1 = 119
	static readonly NEG_D = 120
	static readonly NEG_S = 121
	static readonly LWC1 = 122
	static readonly LDC1 = 123
	static readonly SWC1 = 124
	static readonly SDC1 = 125
	static readonly TEQ = 126
	static readonly TEQI = 127
	static readonly TNE = 128
	static readonly TNEI = 129
	static readonly TGE = 130
	static readonly TGEU = 131
	static readonly TGEI = 132
	static readonly TGEIU = 133
	static readonly TLT = 134
	static readonly TLTU = 135
	static readonly TLTI = 136
	static readonly TLTIU = 137
	static readonly ERET = 138
}

/** The mnemonic each op spells, indexed by the op. */
export const OP_NAMES: readonly string[] = [
	'nop',
	'add',
	'sub',
	'addi',
	'addu',
	'subu',
	'addiu',
	'mult',
	'multu',
	'mul',
	'madd',
	'maddu',
	'msub',
	'msubu',
	'div',
	'divu',
	'mfhi',
	'mflo',
	'mthi',
	'mtlo',
	'and',
	'or',
	'andi',
	'ori',
	'nor',
	'xor',
	'xori',
	'sll',
	'sllv',
	'srl',
	'sra',
	'srav',
	'srlv',
	'lw',
	'll',
	'lwl',
	'lwr',
	'sw',
	'sc',
	'swl',
	'swr',
	'lui',
	'beq',
	'bne',
	'bgez',
	'bgezal',
	'bgtz',
	'blez',
	'bltz',
	'bltzal',
	'slt',
	'sltu',
	'slti',
	'sltiu',
	'movn',
	'movz',
	'movf',
	'movt',
	'break',
	'syscall',
	'j',
	'jr',
	'jal',
	'jalr',
	'lb',
	'lh',
	'lhu',
	'lbu',
	'sb',
	'sh',
	'clo',
	'clz',
	'mfc0',
	'mtc0',
	'add.s',
	'sub.s',
	'mul.s',
	'div.s',
	'sqrt.s',
	'floor.w.s',
	'ceil.w.s',
	'round.w.s',
	'trunc.w.s',
	'add.d',
	'sub.d',
	'mul.d',
	'div.d',
	'sqrt.d',
	'floor.w.d',
	'ceil.w.d',
	'round.w.d',
	'trunc.w.d',
	'bc1t',
	'bc1f',
	'c.eq.s',
	'c.le.s',
	'c.lt.s',
	'c.eq.d',
	'c.le.d',
	'c.lt.d',
	'abs.s',
	'abs.d',
	'cvt.d.s',
	'cvt.d.w',
	'cvt.s.d',
	'cvt.s.w',
	'cvt.w.d',
	'cvt.w.s',
	'mov.d',
	'movf.d',
	'movt.d',
	'movn.d',
	'movz.d',
	'mov.s',
	'movf.s',
	'movt.s',
	'movn.s',
	'movz.s',
	'mfc1',
	'mtc1',
	'neg.d',
	'neg.s',
	'lwc1',
	'ldc1',
	'swc1',
	'sdc1',
	'teq',
	'teqi',
	'tne',
	'tnei',
	'tge',
	'tgeu',
	'tgei',
	'tgeiu',
	'tlt',
	'tltu',
	'tlti',
	'tltiu',
	'eret',
]

/**
 * Every spelling of a mnemonic that anything hands us, mapped to its op.
 *
 * The ISA writes its mnemonics in lower case and so does everything that shows
 * one, but assembly source is written either way.  Holding both spellings here
 * means a lookup is a hash of the string as it arrived: nothing re-cases a
 * mnemonic on the way in, and nothing re-cases it on the way back out.
 */
const BY_NAME = new Map<string, number>()
for (const [code, name] of OP_NAMES.entries()) {
	BY_NAME.set(name, code)
	BY_NAME.set(name.toUpperCase(), code)
}

/** The op a mnemonic names, in either case, or null where the ISA has none. */
export function opFor(mnemonic: string): number | null {
	return BY_NAME.get(mnemonic) ?? null
}
