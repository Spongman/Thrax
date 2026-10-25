import { instructionCatalog, instructionLinks, type InstructionHelp, type InstructionTable } from '../../core/instructionHelp'

const REFERENCE = 'https://riscv.github.io/riscv-isa-manual/snapshot/spec/'
/** Normative-rule anchors shared by several mnemonics; any other mnemonic's rule is `norm:<mnemonic>_op`. */
const SHARED_RULES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries({
	addi_op: 'li mv', slti_sltiu_op: 'slti sltiu', andi_ori_xori_op: 'andi ori xori not', slt_sltu_op: 'slt sltu',
	and_or_xor_op: 'and or xor', sll_srl_sra_op: 'sll srl sra', sub_op: 'neg', auipc_op: 'la', jal_op: 'j',
	jalr_op: 'call ret', beq_bne_op: 'beq bne beqz bnez', blt_bltu_op: 'blt bltu', bge_bgeu_op: 'bge bgeu',
	lb_lbu_op: 'lb lbu', sw_sh_sb_op: 'sw sh sb', ecall_op1: 'ecall', ebreak_op1: 'ebreak',
	mulh_mulhu_mulhsu_op: 'mulh mulhu mulhsu', div_divu_op: 'div divu', rem_remu_op: 'rem remu',
	fsw_flw_op: 'flw fsw', 'fadd-s_fmul-s_op': 'fadd.s fmul.s', 'fmin-s_fmax-s_op': 'fmin.s fmax.s',
	'fcvt-l-s_fcvt-w-s_op': 'fcvt.w.s', 'fcvt-s-w_fcvt-s-l_op': 'fcvt.s.w', 'fcvt-wu-s_fcvt-lu-s_fcvt-s-wu_fcvt-s-lu_op': 'fcvt.wu.s fcvt.s.wu',
	'fsgnj-s_fsgnjn-s_fsgnjx-s_op': 'fsgnj.s fsgnjn.s fsgnjx.s fmv.s fneg.s fabs.s', 'feq-s_flt-s_fle-s_op': 'feq.s flt.s fle.s',
	fcsr_op_sz_acc: 'frcsr fscsr', fflags_frm_op_sz_acc: 'frrm fsrm fsrmi frflags fsflags fsflagsi',
	D_computational_instrs: 'fadd.d fsub.d fmul.d fdiv.d fsqrt.d fmin.d fmax.d fmadd.d fmsub.d fnmsub.d fnmadd.d',
	'fcvt-w-d_fcvt-l-d_op': 'fcvt.w.d', 'fcvt-d-w_fcvt-d-l_op': 'fcvt.d.w', 'fcvt-wu-d_fcvt-lu-d_fcvt-d-wu_fcvt-d-lu_op': 'fcvt.wu.d fcvt.d.wu',
	'fcvt-s-d_fcvt-d-s_op': 'fcvt.s.d fcvt.d.s', 'fsgnj-d_fsgnjn-d_fsgnjx-d_op': 'fsgnj.d fsgnjn.d fsgnjx.d fmv.d fneg.d fabs.d',
	D_compare_instrs: 'feq.d flt.d fle.d', 'c-fsdwsp_op': 'c.fsdsp', csrrw_op: 'csrw', csrrs_op: 'csrr csrs', csrrc_op: 'csrc',
	csrrwi_csrrsi_csrrci_ops: 'csrrwi csrrsi csrrci csrwi csrsi csrci',
}).flatMap(([rule, names]) => names.split(' ').map(name => [name, rule])))
/** The ratified manual's chapter that holds a mnemonic's rule. */
function chapter(name: string): string {
	return name.startsWith('c.') ? 'c-st-ext' : /\.d|^f[ls]d$/.test(name) ? 'd-st-ext' : /^f(?!ence)/.test(name) ? 'f-st-ext'
		: name.startsWith('csr') ? 'zicsr' : /^(mul|div|rem)/.test(name) ? 'm-st-ext' : 'rv32'
}
const LINK = instructionLinks('https://docs.riscv.org/reference/isa/v20260120/unpriv/', (name) =>
	`${chapter(name)}.html#norm:${SHARED_RULES[name] ?? `${name.replace(/\./g, '-')}_op`}`)
/** Variant ids each extension appears in. */
const C = ['rv32imc', 'rv32imfc', 'rv32imfdc']
const F = ['rv32imf', 'rv32imfc', 'rv32imfd', 'rv32imfdc']
const D = ['rv32imfd', 'rv32imfdc']
const CF = ['rv32imfc', 'rv32imfdc']
const CD = ['rv32imfdc']
const ROUNDED = ' An optional final operand selects rne, rtz, rdn, rup, rmm or dyn (the default, from frm).'
function floatDocs(suffix: 's' | 'd'): InstructionTable {
	const kind = suffix === 's' ? 'single' : 'double',
		tags = suffix === 's' ? F : D,
		exact = suffix === 's' ? ROUNDED : ' Always exact.'
	const docs: Record<string, readonly [string, string]> = {
		fadd: ['rd, rs1, rs2', `Add two ${kind}-precision values.${ROUNDED}`],
		fsub: ['rd, rs1, rs2', `Subtract rs2 from rs1 in ${kind} precision.${ROUNDED}`],
		fmul: ['rd, rs1, rs2', `Multiply two ${kind}-precision values.${ROUNDED}`],
		fdiv: ['rd, rs1, rs2', `Divide rs1 by rs2 in ${kind} precision; a finite value over zero sets DZ.${ROUNDED}`],
		fsqrt: ['rd, rs1', `Square root in ${kind} precision; a negative operand gives the canonical NaN and sets NV.${ROUNDED}`],
		fmadd: ['rd, rs1, rs2, rs3', `rs1 × rs2 + rs3 with a single rounding.${ROUNDED}`],
		fmsub: ['rd, rs1, rs2, rs3', `rs1 × rs2 − rs3 with a single rounding.${ROUNDED}`],
		fnmsub: ['rd, rs1, rs2, rs3', `−(rs1 × rs2) + rs3 with a single rounding.${ROUNDED}`],
		fnmadd: ['rd, rs1, rs2, rs3', `−(rs1 × rs2) − rs3 with a single rounding.${ROUNDED}`],
		fsgnj: ['rd, rs1, rs2', 'The magnitude of rs1 with the sign of rs2.'],
		fsgnjn: ['rd, rs1, rs2', 'The magnitude of rs1 with the opposite of the sign of rs2.'],
		fsgnjx: ['rd, rs1, rs2', 'rs1 with its sign exclusive-ORed with the sign of rs2.'],
		fmv: ['rd, rs', 'Copy a float register. Alias of FSGNJ rd, rs, rs.'],
		fneg: ['rd, rs', 'Negate a float register. Alias of FSGNJN rd, rs, rs.'],
		fabs: ['rd, rs', 'Absolute value. Alias of FSGNJX rd, rs, rs.'],
		fmin: ['rd, rs1, rs2', 'The smaller operand; a single NaN operand is ignored, −0 is below +0, and two NaNs give the canonical NaN.'],
		fmax: ['rd, rs1, rs2', 'The larger operand; a single NaN operand is ignored, +0 is above −0, and two NaNs give the canonical NaN.'],
		feq: ['rd, rs1, rs2', 'Write 1 to integer rd if the operands are equal; NaN compares unequal and only a signaling NaN sets NV.'],
		flt: ['rd, rs1, rs2', 'Write 1 to integer rd if rs1 < rs2; any NaN operand gives 0 and sets NV.'],
		fle: ['rd, rs1, rs2', 'Write 1 to integer rd if rs1 ≤ rs2; any NaN operand gives 0 and sets NV.'],
		fclass: ['rd, rs1', 'Write a one-hot class mask to integer rd: bits 0-9 are −∞, −normal, −subnormal, −0, +0, +subnormal, +normal, +∞, signaling NaN, quiet NaN.'],
		'fcvt.w': ['rd, rs1', `Convert ${kind} to a signed 32-bit integer, saturating out-of-range values and NaN with NV.${ROUNDED}`],
		'fcvt.wu': ['rd, rs1', `Convert ${kind} to an unsigned 32-bit integer, saturating out-of-range values and NaN with NV.${ROUNDED}`],
		[`fcvt.${suffix}.w`]: ['rd, rs1', `Convert a signed integer to ${kind} precision.${exact}`],
		[`fcvt.${suffix}.wu`]: ['rd, rs1', `Convert an unsigned integer to ${kind} precision.${exact}`],
	}
	const width = suffix === 's' ? 'w' : 'd',
		table: Record<string, readonly [string, string, readonly string[]]> = {
			[`fl${width}`]: ['rd, offset(rs1)', `Load a ${kind}-precision value into a float register${suffix === 's' ? ', NaN-boxing it when D is present' : ''}.`, tags],
			[`fs${width}`]: ['rs2, offset(rs1)', `Store the ${kind}-precision bits of a float register unchanged.`, tags],
		}
	for (const [name, [operands, summary]] of Object.entries(docs))
		table[name.startsWith(`fcvt.${suffix}.`) ? name : `${name}.${suffix}`] = [operands, summary, tags]
	return table
}
const DOCS: InstructionTable = {
	add: ['rd, rs1, rs2', 'Add registers, keeping the low 32 bits.'],
	sub: ['rd, rs1, rs2', 'Subtract rs2 from rs1, keeping the low 32 bits.'],
	addi: ['rd, rs1, imm', 'Add a sign-extended 12-bit immediate to rs1.'],
	slt: ['rd, rs1, rs2', 'Set rd to 1 if rs1 is less than rs2 as signed integers; otherwise set it to 0.'],
	sltu: ['rd, rs1, rs2', 'Set rd to 1 if rs1 is less than rs2 as unsigned integers; otherwise set it to 0.'],
	slti: ['rd, rs1, imm', 'Compare rs1 with a sign-extended immediate as signed integers; write 1 if less, otherwise 0.'],
	sltiu: ['rd, rs1, imm', 'Compare rs1 with a sign-extended immediate as unsigned integers; write 1 if less, otherwise 0.'],
	and: ['rd, rs1, rs2', 'Bitwise AND of two registers.'],
	or: ['rd, rs1, rs2', 'Bitwise OR of two registers.'],
	xor: ['rd, rs1, rs2', 'Bitwise exclusive OR of two registers.'],
	andi: ['rd, rs1, imm', 'Bitwise AND with a sign-extended 12-bit immediate.'],
	ori: ['rd, rs1, imm', 'Bitwise OR with a sign-extended 12-bit immediate.'],
	xori: ['rd, rs1, imm', 'Bitwise exclusive OR with a sign-extended 12-bit immediate.'],
	sll: ['rd, rs1, rs2', 'Shift left by the low 5 bits of rs2, filling with zeros.'],
	srl: ['rd, rs1, rs2', 'Shift right by the low 5 bits of rs2, filling with zeros.'],
	sra: ['rd, rs1, rs2', 'Shift right by the low 5 bits of rs2, preserving the sign bit.'],
	slli: ['rd, rs1, shamt', 'Shift left by an immediate count from 0 to 31, filling with zeros.'],
	srli: ['rd, rs1, shamt', 'Shift right by an immediate count from 0 to 31, filling with zeros.'],
	srai: ['rd, rs1, shamt', 'Shift right by an immediate count from 0 to 31, preserving the sign bit.'],
	mul: ['rd, rs1, rs2', 'Multiply registers and keep the low 32 bits.'],
	mulh: ['rd, rs1, rs2', 'Keep the high 32 bits of the signed × signed 64-bit product.'],
	mulhsu: ['rd, rs1, rs2', 'Keep the high 32 bits of the signed rs1 × unsigned rs2 64-bit product.'],
	mulhu: ['rd, rs1, rs2', 'Keep the high 32 bits of the unsigned × unsigned 64-bit product.'],
	div: ['rd, rs1, rs2', 'Signed quotient, rounded toward zero. Division by zero produces -1; overflow produces the dividend.'],
	divu: ['rd, rs1, rs2', 'Unsigned quotient. Division by zero produces 0xFFFFFFFF.'],
	rem: ['rd, rs1, rs2', 'Signed remainder, with the sign of the dividend. Division by zero produces the dividend.'],
	remu: ['rd, rs1, rs2', 'Unsigned remainder. Division by zero produces the dividend.'],
	beq: ['rs1, rs2, target', 'Branch to target if rs1 equals rs2.'],
	bne: ['rs1, rs2, target', 'Branch to target if rs1 differs from rs2.'],
	blt: ['rs1, rs2, target', 'Branch to target if rs1 is less than rs2 as signed integers.'],
	bge: ['rs1, rs2, target', 'Branch to target if rs1 is greater than or equal to rs2 as signed integers.'],
	bltu: ['rs1, rs2, target', 'Branch to target if rs1 is less than rs2 as unsigned integers.'],
	bgeu: ['rs1, rs2, target', 'Branch to target if rs1 is greater than or equal to rs2 as unsigned integers.'],
	lui: ['rd, imm20', 'Place the 20-bit immediate in bits 31:12; clear the low 12 bits.'],
	auipc: ['rd, imm20', 'Add the immediate shifted left by 12 to the address of this instruction.'],
	lb: ['rd, offset(rs1)', 'Load a byte and sign-extend it to 32 bits.'],
	lh: ['rd, offset(rs1)', 'Load a halfword and sign-extend it to 32 bits.'],
	lw: ['rd, offset(rs1)', 'Load a 32-bit word.'],
	lbu: ['rd, offset(rs1)', 'Load a byte and zero-extend it to 32 bits.'],
	lhu: ['rd, offset(rs1)', 'Load a halfword and zero-extend it to 32 bits.'],
	sb: ['rs2, offset(rs1)', 'Store the low byte of rs2.'],
	sh: ['rs2, offset(rs1)', 'Store the low halfword of rs2.'],
	sw: ['rs2, offset(rs1)', 'Store the 32-bit value of rs2.'],
	jal: ['rd, target', 'Jump to target and write PC + 4 to rd. With rd omitted, use ra.'],
	jalr: ['rd, offset(rs1)', 'Jump to rs1 + offset with bit 0 cleared; write PC + 4 to rd.'],
	fence: ['', 'Order memory accesses. This single-core simulator completes accesses in instruction order.'],
	ecall: ['', 'Invoke the simulator console or exit service selected by a7.'],
	ebreak: ['', 'Stop execution at a software breakpoint.'],
	li: ['rd, imm', 'Load a 32-bit constant; the assembler emits one or two instructions.'],
	la: ['rd, symbol', 'Load the address of a symbol.'],
	mv: ['rd, rs', 'Copy rs to rd. Alias of ADDI with immediate 0.'],
	not: ['rd, rs', 'Complement every bit of rs. Alias of XORI with immediate -1.'],
	neg: ['rd, rs', 'Negate rs. Alias of SUB from zero.'],
	j: ['target', 'Jump without saving a return address.'],
	call: ['target', 'Call target, leaving the return address in ra.'],
	ret: ['', 'Return to the address in ra.'],
	nop: ['', 'Do nothing. Alias of ADDI zero, zero, 0.'],
	beqz: ['rs, target', 'Branch to target if rs is zero.'],
	bnez: ['rs, target', 'Branch to target if rs is nonzero.'],
	'c.addi4spn': ['rd, sp, imm', 'Add a nonzero unsigned stack offset to sp, writing a compact register (x8–x15).', C],
	'c.addi16sp': ['sp, imm', 'Add a nonzero signed multiple of 16 to sp.', C],
	'c.nop': ['', 'Compressed no operation.', C],
	'c.addi': ['rd, imm', 'Add a signed 6-bit immediate to rd.', C],
	'c.li': ['rd, imm', 'Load a signed 6-bit immediate.', C],
	'c.lui': ['rd, imm', 'Load a nonzero signed 6-bit immediate into bits 17:12, sign-extending above.', C],
	'c.lw': ['rd, offset(rs1)', 'Load a word using compact registers (x8–x15) and an unsigned word-aligned offset.', C],
	'c.sw': ['rs2, offset(rs1)', 'Store a word using compact registers (x8–x15) and an unsigned word-aligned offset.', C],
	'c.lwsp': ['rd, offset(sp)', 'Load a word relative to sp using an unsigned word-aligned offset.', C],
	'c.swsp': ['rs2, offset(sp)', 'Store a word relative to sp using an unsigned word-aligned offset.', C],
	'c.slli': ['rd, shamt', 'Shift rd left by an immediate count, filling with zeros.', C],
	'c.srli': ['rd, shamt', 'Shift a compact register right by an immediate count, filling with zeros.', C],
	'c.srai': ['rd, shamt', 'Shift a compact register right by an immediate count, preserving its sign.', C],
	'c.andi': ['rd, imm', 'AND a compact register with a signed 6-bit immediate.', C],
	'c.sub': ['rd, rs2', 'Subtract one compact register from another.', C],
	'c.xor': ['rd, rs2', 'Exclusive OR of two compact registers, written to rd.', C],
	'c.or': ['rd, rs2', 'OR of two compact registers, written to rd.', C],
	'c.and': ['rd, rs2', 'AND of two compact registers, written to rd.', C],
	'c.j': ['target', 'Jump without saving a return address.', C],
	'c.jal': ['target', 'Jump and save PC + 2 in ra (RV32 only).', C],
	'c.beqz': ['rs1, target', 'Branch if the compact register is zero.', C],
	'c.bnez': ['rs1, target', 'Branch if the compact register is nonzero.', C],
	'c.jr': ['rs1', 'Jump to rs1 with bit 0 cleared, without linking.', C],
	'c.jalr': ['rs1', 'Jump to rs1 with bit 0 cleared and save PC + 2 in ra.', C],
	'c.mv': ['rd, rs2', 'Copy rs2 to rd.', C],
	'c.add': ['rd, rs2', 'Add rs2 to rd, keeping the low 32 bits.', C],
	'c.ebreak': ['', 'Compressed software breakpoint.', C],
	'c.flw': ['rd, offset(rs1)', 'Load a single into f8–f15 using a compact base register and a word-aligned offset.', CF],
	'c.fsw': ['rs2, offset(rs1)', 'Store a single from f8–f15 using a compact base register and a word-aligned offset.', CF],
	'c.flwsp': ['rd, offset(sp)', 'Load a single relative to sp using a word-aligned offset.', CF],
	'c.fswsp': ['rs2, offset(sp)', 'Store a single relative to sp using a word-aligned offset.', CF],
	'c.fld': ['rd, offset(rs1)', 'Load a double into f8–f15 using a compact base register and a doubleword-aligned offset.', CD],
	'c.fsd': ['rs2, offset(rs1)', 'Store a double from f8–f15 using a compact base register and a doubleword-aligned offset.', CD],
	'c.fldsp': ['rd, offset(sp)', 'Load a double relative to sp using a doubleword-aligned offset.', CD],
	'c.fsdsp': ['rs2, offset(sp)', 'Store a double relative to sp using a doubleword-aligned offset.', CD],
	...floatDocs('s'),
	...floatDocs('d'),
	'fmv.x.w': ['rd, rs1', 'Copy the low 32 bits of a float register to an integer register unchanged.', F],
	'fmv.w.x': ['rd, rs1', 'Copy an integer register to a float register as single-precision bits, NaN-boxed when D is present.', F],
	'fcvt.s.d': ['rd, rs1', `Round a double to single precision.${ROUNDED}`, D],
	'fcvt.d.s': ['rd, rs1', 'Widen a single to double precision; always exact.', D],
	csrrw: ['rd, csr, rs1', 'Swap a CSR with rs1. Only fflags, frm and fcsr exist.', F],
	csrrs: ['rd, csr, rs1', 'Read a CSR and set the bits given in rs1.', F],
	csrrc: ['rd, csr, rs1', 'Read a CSR and clear the bits given in rs1.', F],
	csrrwi: ['rd, csr, uimm', 'Swap a CSR with a 5-bit immediate.', F],
	csrrsi: ['rd, csr, uimm', 'Read a CSR and set the bits of a 5-bit immediate.', F],
	csrrci: ['rd, csr, uimm', 'Read a CSR and clear the bits of a 5-bit immediate.', F],
	csrr: ['rd, csr', 'Read a CSR. Alias of CSRRS rd, csr, zero.', F],
	csrw: ['csr, rs', 'Write a CSR. Alias of CSRRW zero, csr, rs.', F],
	csrs: ['csr, rs', 'Set CSR bits. Alias of CSRRS zero, csr, rs.', F],
	csrc: ['csr, rs', 'Clear CSR bits. Alias of CSRRC zero, csr, rs.', F],
	csrwi: ['csr, uimm', 'Write a CSR from an immediate.', F],
	csrsi: ['csr, uimm', 'Set CSR bits from an immediate.', F],
	csrci: ['csr, uimm', 'Clear CSR bits from an immediate.', F],
	frcsr: ['rd', 'Read fcsr: frm in bits 7:5 and the NV, DZ, OF, UF, NX flags in bits 4:0.', F],
	fscsr: ['[rd,] rs', 'Write fcsr, optionally returning its old value.', F],
	frrm: ['rd', 'Read the dynamic rounding mode frm.', F],
	fsrm: ['[rd,] rs', 'Write frm, optionally returning its old value. Values 5-7 fault when a dynamic operation uses them.', F],
	fsrmi: ['[rd,] uimm', 'Write frm from an immediate.', F],
	frflags: ['rd', 'Read the accrued exception flags: NV 16, DZ 8, OF 4, UF 2, NX 1.', F],
	fsflags: ['[rd,] rs', 'Write the accrued exception flags, optionally returning the old ones.', F],
	fsflagsi: ['[rd,] uimm', 'Write the accrued exception flags from an immediate.', F],
}

export const RISCV_INSTRUCTIONS = instructionCatalog(DOCS, REFERENCE, LINK)

export const BASE_MNEMONICS = RISCV_INSTRUCTIONS.names('rv32im')
export const COMPRESSED_MNEMONICS = RISCV_INSTRUCTIONS.names('rv32imc').filter(name => name.startsWith('c.'))

const SINGLE_MNEMONICS = RISCV_INSTRUCTIONS.names('rv32imfc')
export const FLOAT_MNEMONICS = RISCV_INSTRUCTIONS.names('rv32imfdc').filter(name => !RISCV_INSTRUCTIONS.names('rv32imc').includes(name))

export function riscvInstructionHelp(name: string): InstructionHelp | null {
	const help = RISCV_INSTRUCTIONS.help(name),
		lower = name.toLowerCase()
	if (!help) return help
	const extension = !FLOAT_MNEMONICS.includes(lower) ? '' : SINGLE_MNEMONICS.includes(lower) ? 'the F extension' : 'the D extension'
	if (lower.startsWith('c.')) help.contents.push(`Requires ${extension ? `the C extension with ${extension}` : 'RV32IMC'}; encoded in 16 bits.`)
	else if (extension) help.contents.push(`Requires ${extension}.`)
	return help
}
