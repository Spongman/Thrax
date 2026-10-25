import { htmlInstructionLink, htmlReference as arm26Reference } from './arm26HtmlReferences'
import { preferInstructionLinks, formatInstructionHelp, instructionLinks, type InstructionHelp, type InstructionLink, type InstructionTable } from '../../../core/instructionHelp'
import { ARCH_V2A, ARCH_V8 } from './a32/isa'
import { parseMnemonic } from './assembler/instructions'
import { parseVfpMnemonic } from './assembler/vfp'

/** Shared semantic descriptions for the ARM instruction families. */
export const ARM_INSTRUCTION_DOCS: InstructionTable = {
	and: ['Rd, Rn, operand2', 'Bitwise AND of Rn and operand2.'],
	eor: ['Rd, Rn, operand2', 'Bitwise exclusive OR of Rn and operand2.'],
	sub: ['Rd, Rn, operand2', 'Subtract operand2 from Rn.'],
	rsb: ['Rd, Rn, operand2', 'Subtract Rn from operand2 (reverse subtraction).'],
	add: ['Rd, Rn, operand2', 'Add Rn and operand2.'],
	adc: ['Rd, Rn, operand2', 'Add Rn, operand2 and carry.'],
	sbc: ['Rd, Rn, operand2', 'Subtract operand2 and NOT carry from Rn.'],
	rsc: ['Rd, Rn, operand2', 'Subtract Rn and NOT carry from operand2.'],
	tst: ['Rn, operand2', 'Test the AND of Rn and operand2 into flags without storing the result.'],
	teq: ['Rn, operand2', 'Test the exclusive OR of Rn and operand2 into flags without storing the result.'],
	cmp: ['Rn, operand2', 'Compare Rn with operand2 by subtraction; update flags without storing a result.'],
	cmn: ['Rn, operand2', 'Compare by adding Rn and operand2; update flags without storing a result.'],
	orr: ['Rd, Rn, operand2', 'Bitwise OR of Rn and operand2.'],
	mov: ['Rd, operand2', 'Copy operand2 into Rd.'],
	bic: ['Rd, Rn, operand2', 'Clear the bits of Rn selected by operand2.'],
	mvn: ['Rd, operand2', 'Complement operand2 into Rd.'],
	mul: ['Rd, Rm, Rs', 'Multiply two registers, keeping the low 32 bits.'],
	mla: ['Rd, Rm, Rs, Rn', 'Multiply Rm by Rs and add Rn, keeping the low 32 bits.'],
	mls: ['Rd, Rm, Rs, Rn', 'Subtract the product Rm × Rs from Rn.'],
	mrc: ['coprocessor, opcode1, Rd, CRn, CRm, opcode2', 'Read a coprocessor register; ARM3 uses CP15 for cache control.'],
	mcr: ['coprocessor, opcode1, Rd, CRn, CRm, opcode2', 'Write a coprocessor register; ARM3 uses CP15 for cache control.'],
	ldr: ['Rd, [Rn, offset]', 'Load a 32-bit word; pre-index, post-index and literal forms are also available.'],
	str: ['Rd, [Rn, offset]', 'Store a 32-bit word; pre-index and post-index forms can update the base.'],
	ldrb: ['Rd, [Rn, offset]', 'Load a byte and zero-extend it.'],
	strb: ['Rd, [Rn, offset]', 'Store the low byte of Rd.'],
	ldrh: ['Rd, [Rn, offset]', 'Load a halfword and zero-extend it.'],
	strh: ['Rd, [Rn, offset]', 'Store the low halfword of Rd.'],
	ldrsb: ['Rd, [Rn, offset]', 'Load a byte and sign-extend it.'],
	ldrsh: ['Rd, [Rn, offset]', 'Load a halfword and sign-extend it.'],
	ldrd: ['Rd, Rd2, [Rn, offset]', 'Load two consecutive words into a register pair.'],
	strd: ['Rd, Rd2, [Rn, offset]', 'Store a register pair as two consecutive words.'],
	ldm: ['Rn{!}, {registers}', 'Load multiple registers; the addressing suffix selects increment/decrement and before/after.'],
	stm: ['Rn{!}, {registers}', 'Store multiple registers; the addressing suffix selects increment/decrement and before/after.'],
	swp: ['Rd, Rm, [Rn]', 'Exchange a memory word (or byte with B suffix) with Rm, returning the old value in Rd.'],
	swi: ['#number', 'Invoke a software interrupt; the selected machine environment supplies its service behavior.'],
	svc: ['#number', 'Invoke a supervisor call; the selected machine environment supplies its service behavior.'],
	adr: ['Rd, label', 'Compute the address of a nearby label relative to PC.'],
	nop: ['', 'Do nothing.'],
	push: ['{registers}', 'Push registers onto the full descending stack.'],
	pop: ['{registers}', 'Pop registers from the full descending stack; loading PC returns or branches.'],
	lsl: ['Rd, Rm, shift', 'Shift left, filling with zeros.'],
	asl: ['Rd, Rm, shift', 'Alias of LSL: shift left, filling with zeros.'],
	lsr: ['Rd, Rm, shift', 'Shift right, filling with zeros.'],
	asr: ['Rd, Rm, shift', 'Shift right, retaining the sign bit.'],
	ror: ['Rd, Rm, shift', 'Rotate right within the 32-bit register.'],
	rrx: ['Rd, Rm', 'Rotate right by one through carry.'],
	neg: ['Rd, Rm', 'Negate Rm using two’s complement.'],
	b: ['target', 'Branch to target.'],
	bl: ['target', 'Branch with link, saving the return address in LR.'],
	bx: ['Rm', 'Branch through Rm; bit 0 selects ARM or Thumb state where supported.'],
	blx: ['Rm | target', 'Branch with link and exchange instruction state where supported.'],
	ldrex: ['Rt, [Rn]', 'Load a word and mark the address for an exclusive store.'],
	strex: ['Rd, Rt, [Rn]', 'Attempt an exclusive word store; write 0 to Rd on success, 1 on failure.'],
	umull: ['RdLo, RdHi, Rm, Rs', 'Unsigned multiplication with the full 64-bit result in RdHi:RdLo.'],
	umlal: ['RdLo, RdHi, Rm, Rs', 'Add an unsigned 64-bit product to RdHi:RdLo.'],
	smull: ['RdLo, RdHi, Rm, Rs', 'Signed multiplication with the full 64-bit result in RdHi:RdLo.'],
	smlal: ['RdLo, RdHi, Rm, Rs', 'Add a signed 64-bit product to RdHi:RdLo.'],
	sdiv: ['Rd, Rn, Rm', 'Signed integer quotient, rounded toward zero.'],
	udiv: ['Rd, Rn, Rm', 'Unsigned integer quotient.'],
	mrs: ['Rd, status-register', 'Read a processor status register.'],
	msr: ['status-register, Rm', 'Write selected processor status fields.'],
	clz: ['Rd, Rm', 'Count leading zero bits.'],
	movw: ['Rd, #imm16', 'Load a 16-bit immediate and zero the upper half of Rd.'],
	movt: ['Rd, #imm16', 'Replace the upper half of Rd with a 16-bit immediate; preserve the lower half.'],
	rev: ['Rd, Rm', 'Reverse the byte order of a 32-bit word.'],
	rev16: ['Rd, Rm', 'Reverse bytes within each halfword.'],
	revsh: ['Rd, Rm', 'Reverse the low two bytes and sign-extend the resulting halfword.'],
	rbit: ['Rd, Rm', 'Reverse all 32 bits.'],
	sxtb: ['Rd, Rm', 'Sign-extend the low byte to 32 bits.'],
	sxth: ['Rd, Rm', 'Sign-extend the low halfword to 32 bits.'],
	uxtb: ['Rd, Rm', 'Zero-extend the low byte to 32 bits.'],
	uxth: ['Rd, Rm', 'Zero-extend the low halfword to 32 bits.'],
	sxtab: ['Rd, Rn, Rm', 'Add a sign-extended byte from Rm to Rn.'],
	sxtah: ['Rd, Rn, Rm', 'Add a sign-extended halfword from Rm to Rn.'],
	uxtab: ['Rd, Rn, Rm', 'Add a zero-extended byte from Rm to Rn.'],
	uxtah: ['Rd, Rn, Rm', 'Add a zero-extended halfword from Rm to Rn.'],
	sbfx: ['Rd, Rn, #lsb, #width', 'Extract and sign-extend a bit field.'],
	ubfx: ['Rd, Rn, #lsb, #width', 'Extract and zero-extend a bit field.'],
	bfi: ['Rd, Rn, #lsb, #width', 'Insert low bits of Rn into a field of Rd, preserving other bits.'],
	bfc: ['Rd, #lsb, #width', 'Clear a bit field, preserving other bits.'],
	bkpt: ['#immediate', 'Trigger a software breakpoint.'],
	udf: ['#immediate', 'Execute an explicitly undefined instruction.'],
	pld: ['[Rn, offset]', 'Hint that data at an address will be needed; no architectural register result.'],
	yield: ['', 'Hint that execution resources may be yielded.'],
	wfe: ['', 'Wait for an event; exact wait behavior depends on the simulated environment.'],
	wfi: ['', 'Wait for an interrupt; exact wait behavior depends on the simulated environment.'],
	sev: ['', 'Send an event to processors waiting for events.'],
	clrex: ['', 'Clear the local exclusive-access reservation.'],
	dsb: ['sy', 'Complete preceding memory accesses before subsequent execution.'],
	dmb: ['sy', 'Order memory accesses across the barrier.'],
	isb: ['sy', 'Synchronize instruction execution after changes to the execution environment.'],
}

export const ARM_CONDITIONS = ['equal (Z = 1)', 'not equal (Z = 0)', 'unsigned higher or same (C = 1)',
	'unsigned lower (C = 0)', 'minus (N = 1)', 'plus (N = 0)', 'overflow (V = 1)', 'no overflow (V = 0)',
	'unsigned higher (C = 1 and Z = 0)', 'unsigned lower or same (C = 0 or Z = 1)', 'signed greater or equal (N = V)',
	'signed less (N ≠ V)', 'signed greater (Z = 0 and N = V)', 'signed less or equal (Z = 1 or N ≠ V)', 'always', 'never']

/** VFPv4-D16, for the ARMv8 profile's A32 only. */
export const VFP_INSTRUCTION_DOCS: InstructionTable = {
	vadd: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Floating-point add, rounded as FPSCR says.'],
	vsub: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Floating-point subtract.'],
	vmul: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Floating-point multiply.'],
	vnmul: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Floating-point multiply, negated.'],
	vdiv: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Floating-point divide; dividing a number by zero gives infinity and sets DZC.'],
	vmla: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Multiply and add to Sd, with the product rounded first (not fused).'],
	vmls: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Multiply and subtract from Sd, with the product rounded first (not fused).'],
	vnmla: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Negated multiply-accumulate: -Sd - Sn × Sm, the product rounded first.'],
	vnmls: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Negated multiply-subtract: -Sd + Sn × Sm, the product rounded first.'],
	vfma: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Fused multiply-add: Sd + Sn × Sm, rounded once.'],
	vfms: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Fused multiply-subtract: Sd - Sn × Sm, rounded once.'],
	vfnma: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Fused negated multiply-add: -Sd - Sn × Sm, rounded once.'],
	vfnms: ['Sd, Sn, Sm | Dd, Dn, Dm', 'Fused negated multiply-subtract: -Sd + Sn × Sm, rounded once.'],
	vsqrt: ['Sd, Sm | Dd, Dm', 'Floating-point square root.'],
	vabs: ['Sd, Sm | Dd, Dm', 'Absolute value: clears the sign bit.'],
	vneg: ['Sd, Sm | Dd, Dm', 'Negate: flips the sign bit.'],
	vmov: ['Sd, #imm | Sd, Sm | Sn, Rt | Rt, Sn | Dm, Rt, Rt2 | Rt, Rt2, Dm', 'Copy a constant or register between VFP and core registers, bits unchanged.'],
	vcmp: ['Sd, Sm | Sd, #0', 'Compare into FPSCR NZCV: unordered (a NaN) sets C and V; read it with VMRS APSR_nzcv, FPSCR.'],
	vcmpe: ['Sd, Sm | Sd, #0', 'Compare as VCMP, also raising Invalid Operation for a quiet NaN.'],
	vcvt: ['.S32.F32 Sd, Sm | .F64.F32 Dd, Sm | .F32.S32 Sd, Sm | .S32.F32 Sd, Sd, #fbits', 'Convert between precisions, integers and fixed point; to an integer it rounds toward zero and saturates.'],
	vcvtr: ['.S32.F32 Sd, Sm | .U32.F64 Sd, Dm', 'Convert to an integer, rounding as FPSCR says.'],
	vmrs: ['Rt, FPSCR | APSR_nzcv, FPSCR', 'Read FPSCR; to APSR_nzcv it copies the comparison flags for a conditional instruction.'],
	vmsr: ['FPSCR, Rt', 'Write FPSCR: flags, rounding mode, flush-to-zero and default NaN.'],
	vldr: ['Sd, [Rn, #offset] | Dd, label', 'Load an S or D register from a word-aligned address.'],
	vstr: ['Sd, [Rn, #offset]', 'Store an S or D register to a word-aligned address.'],
	vldm: ['Rn{!}, {registers}', 'Load consecutive S or D registers; IA, or DB with writeback.'],
	vstm: ['Rn{!}, {registers}', 'Store consecutive S or D registers; IA, or DB with writeback.'],
	vpush: ['{registers}', 'Push consecutive S or D registers onto the full descending stack.'],
	vpop: ['{registers}', 'Pop consecutive S or D registers from the full descending stack.'],
}

/**
 * Links into an Arm instruction-set manual on developer.arm.com, whose page slugs start `MNEMONIC--`: `pages` holds
 * the rest of each slug, or `/` and a whole slug, and `section` names the manual's chapter.
 */
export function armManualLinks(document: string, pages: Readonly<Record<string, string>>, section: (name: string) => string): InstructionLink {
	return instructionLinks(`https://developer.arm.com/documentation/${document}/`, (name) => {
		const page = Object.prototype.hasOwnProperty.call(pages, name) ? pages[name] : undefined
		return page && `${section(name)}-Instructions/${page.startsWith('/') ? page.slice(1) : `${name.toUpperCase()}--${page}`}`
	})
}

/** Arm A-profile A32/T32 ISA (DDI 0597) pages, one encoding chosen per mnemonic. */
export const a32InstructionLink = armManualLinks('ddi0597/2026-09', {
	ldrex: 'Load-Register-Exclusive-', strex: 'Store-Register-Exclusive-', ldr: 'immediate---Load-Register--immediate--',
	str: 'immediate---Store-Register--immediate--', mls: 'Multiply-and-Subtract-', umull: 'UMULLS--Unsigned-Multiply-Long-',
	umlal: 'UMLALS--Unsigned-Multiply-Accumulate-Long-', smull: 'SMULLS--Signed-Multiply-Long-', smlal: 'SMLALS--Signed-Multiply-Accumulate-Long-',
	sdiv: 'Signed-Divide-', udiv: 'Unsigned-Divide-', mrs: 'Move-Special-register-to-general-purpose-register-',
	msr: 'register---Move-general-purpose-register-to-Special-register-', blx: 'register---Branch-with-Link-and-Exchange--register--',
	bx: 'Branch-and-Exchange-', clz: 'Count-Leading-Zeros-', movt: 'Move-Top-', rev16: 'Byte-Reverse-Packed-Halfword-',
	revsh: 'Byte-Reverse-Signed-Halfword-', rev: 'Byte-Reverse-Word-', rbit: 'Reverse-Bits-', sxtab: 'Signed-Extend-and-Add-Byte-',
	sxtah: 'Signed-Extend-and-Add-Halfword-', uxtab: 'Unsigned-Extend-and-Add-Byte-', uxtah: 'Unsigned-Extend-and-Add-Halfword-',
	sxtb: 'Signed-Extend-Byte-', sxth: 'Signed-Extend-Halfword-', uxtb: 'Unsigned-Extend-Byte-', uxth: 'Unsigned-Extend-Halfword-',
	sbfx: 'Signed-Bit-Field-Extract-', ubfx: 'Unsigned-Bit-Field-Extract-', bfi: 'Bit-Field-Insert-', bfc: 'Bit-Field-Clear-', bkpt: 'Breakpoint-',
	udf: 'Permanently-Undefined-', pld: 'PLDW--immediate---Preload-Data--immediate--', nop: 'No-Operation-', yield: 'Yield-hint-', wfe: 'Wait-For-Event-',
	wfi: 'Wait-For-Interrupt-', sev: 'Send-Event-', clrex: 'Clear-Exclusive-', dsb: 'Data-Synchronization-Barrier-', dmb: 'Data-Memory-Barrier-',
	isb: 'Instruction-Synchronization-Barrier-', and: 'ANDS--register---Bitwise-AND--register--', eor: 'EORS--register---Bitwise-Exclusive-OR--register--',
	sub: 'SUBS--register---Subtract--register--', rsb: 'RSBS--register---Reverse-Subtract--register--', add: 'ADDS--register---Add--register--',
	adc: 'ADCS--register---Add-with-Carry--register--', sbc: 'SBCS--register---Subtract-with-Carry--register--',
	rsc: 'RSCS--register---Reverse-Subtract-with-Carry--register--', tst: 'register---Test--register--', teq: 'register---Test-Equivalence--register--',
	cmp: 'register---Compare--register--', cmn: 'register---Compare-Negative--register--', orr: 'ORRS--register---Bitwise-OR--register--',
	mov: 'MOVS--register---Move--register--', bic: 'BICS--register---Bitwise-Bit-Clear--register--', mvn: 'MVNS--register---Bitwise-NOT--register--',
	mul: 'MULS--Multiply-', mla: 'MLAS--Multiply-Accumulate-', ldm: 'LDMIA--LDMFD--Load-Multiple--Increment-After--Full-Descending--',
	stm: 'STMIA--STMEA--Store-Multiple--Increment-After--Empty-Ascending--', svc: 'Supervisor-Call-', adr: 'Form-PC-relative-address-',
	push: 'Push-Multiple-Registers-to-Stack-', pop: 'Pop-Multiple-Registers-from-Stack-',
	lsl: 'immediate---Logical-Shift-Left--immediate---an-alias-of-MOV--MOVS--register--',
	lsr: 'immediate---Logical-Shift-Right--immediate---an-alias-of-MOV--MOVS--register--',
	asr: 'immediate---Arithmetic-Shift-Right--immediate---an-alias-of-MOV--MOVS--register--',
	ror: 'immediate---Rotate-Right--immediate---an-alias-of-MOV--MOVS--register--', rrx: 'Rotate-Right-with-Extend--an-alias-of-MOV--MOVS--register--',
	bl: 'BLX--immediate---Branch-with-Link-and-optional-Exchange--immediate--', b: 'Branch-', ldrb: 'immediate---Load-Register-Byte--immediate--',
	strb: 'immediate---Store-Register-Byte--immediate--', ldrh: 'immediate---Load-Register-Halfword--immediate--',
	strh: 'immediate---Store-Register-Halfword--immediate--', ldrsb: 'immediate---Load-Register-Signed-Byte--immediate--',
	ldrsh: 'immediate---Load-Register-Signed-Halfword--immediate--', ldrd: 'immediate---Load-Register-Dual--immediate--',
	strd: 'immediate---Store-Register-Dual--immediate--',
	vadd: 'floating-point---Vector-Add--floating-point--',
	vsub: 'floating-point---Vector-Subtract--floating-point--', vmul: 'floating-point---Vector-Multiply--floating-point--',
	vnmul: 'Vector-Negate-Multiply-', vdiv: 'Divide-', vmla: 'floating-point---Vector-Multiply-Accumulate--floating-point--',
	vmls: 'floating-point---Vector-Multiply-Subtract--floating-point--', vnmla: 'Vector-Negate-Multiply-Accumulate-',
	vnmls: 'Vector-Negate-Multiply-Subtract-', vfma: 'Vector-Fused-Multiply-Accumulate-', vfms: 'Vector-Fused-Multiply-Subtract-',
	vfnma: 'Vector-Fused-Negate-Multiply-Accumulate-', vfnms: 'Vector-Fused-Negate-Multiply-Subtract-', vsqrt: 'Square-Root-', vabs: 'Vector-Absolute-',
	vneg: 'Vector-Negate-', vmov: 'register---Copy-between-FP-registers-', vcmp: 'Vector-Compare-',
	vcmpe: 'Vector-Compare--raising-Invalid-Operation-on-NaN-',
	vcvt: 'floating-point-to-integer--floating-point---Convert-floating-point-to-integer-with-Round-towards-Zero-',
	vcvtr: 'Convert-floating-point-to-integer-', vmrs: 'Move-SIMD-FP-Special-register-to-general-purpose-register-',
	vmsr: 'Move-general-purpose-register-to-SIMD-FP-Special-register-', vldr: 'immediate---Load-SIMD-FP-register--immediate--',
	vstr: 'Store-SIMD-FP-register-', vldm: 'VLDMDB--VLDMIA--Load-Multiple-SIMD-FP-registers-', vstm: 'VSTMDB--VSTMIA--Store-multiple-SIMD-FP-registers-',
	vpush: 'Push-SIMD-FP-registers-to-stack--an-alias-of-VSTM--VSTMDB--VSTMIA-',
	vpop: 'Pop-SIMD-FP-registers-from-stack--an-alias-of-VLDM--VLDMDB--VLDMIA-', swi: '/SVC--Supervisor-Call-',
	asl: '/LSL--immediate---Logical-Shift-Left--immediate---an-alias-of-MOV--MOVS--register--',
	neg: '/RSB--RSBS--immediate---Reverse-Subtract--immediate--', movw: '/MOV--MOVS--immediate---Move--immediate--',
}, (name) => name.startsWith('v') ? 'SIMD-FP' : 'Base')

// Mirrors: https://archive.org/download/bitsavers_vti1990AcoDataManual_14512698/1990_Acorn_RISC_Machine_Family_Data_Manual.pdf (byte-identical)
// Mirrors: https://bitsavers.org/pdf/acorn/VTI_ARM_Databook_1990.pdf (another scan, no text layer; page numbers differ)
// Mirrors: https://www.chiark.greenend.org.uk/~theom/riscos/docs/ARM3-datasheet_ARM-Family-Data-Manual-VLSI.pdf (VL86C020 extract; page numbers differ)
/** VLSI ARM family data manual, VL86C020 (ARM3) section: PDF page per instruction class. */
const arm26InstructionLinkFallback = instructionLinks('https://bitsavers.org/components/vti/1990_Acorn_RISC_Machine_Family_Data_Manual.pdf', Object.fromEntries(Object.entries({
	128: 'b bl', 130: 'and eor sub rsb add adc sbc rsc tst teq cmp cmn orr mov bic mvn lsl asl lsr asr ror rrx neg adr nop', 135: 'mul mla',
	137: 'ldr str ldrb strb', 140: 'ldm stm push pop', 144: 'swp', 146: 'swi svc', 151: 'mrc mcr',
}).flatMap(([page, names]) => names.split(' ').map(name => [name, Number(page)]))))
export const arm26InstructionLink = preferInstructionLinks(htmlInstructionLink, arm26InstructionLinkFallback)

function vfpHelp(text: string): InstructionHelp | null {
	const parsed = parseVfpMnemonic(text)
	if (!parsed) return null
	const name = parsed.base.replace(/(?:ia|db)$/, '')
	const entry = VFP_INSTRUCTION_DOCS[name]
	if (!entry) return null
	return formatInstructionHelp(text, {
		summary: entry[1], forms: [`${text.toLowerCase()} ${entry[0]}`],
		details: parsed.cond !== 14 ? [`Executes when ${ARM_CONDITIONS[parsed.cond]}.`] : [],
		reference: 'https://developer.arm.com/documentation/ddi0487/latest',
		link: a32InstructionLink(name),
	})
}

export function armInstructionHelp(text: string, arch = ARCH_V2A): InstructionHelp | null {
	if (arch === ARCH_V8 && /^v/i.test(text)) {
		const help = vfpHelp(text)
		if (help) return help
	}
	const parsed = parseMnemonic(text, arch)
	if (!parsed) return null
	const base = parsed.base + (parsed.byte ? 'b' : '')
	const name = ARM_INSTRUCTION_DOCS[base] ? base : parsed.base
	const entry = ARM_INSTRUCTION_DOCS[name]
	if (!entry) return null
	return formatInstructionHelp(text, {
		summary: entry[1], forms: [`${text.toLowerCase()}${entry[0] ? ` ${entry[0]}` : ''}`],
		details: [
			...(parsed.cond !== 14 ? [`Executes when ${ARM_CONDITIONS[parsed.cond]}.`] : []),
			...(parsed.setFlags ? ['Updates condition flags.'] : []),
			...(parsed.psr ? ['P form writes the result to processor status bits.'] : []),
			...(parsed.user ? ['T form uses user-mode memory access permissions.'] : []),
		],
		reference: arch === ARCH_V8 ? 'https://developer.arm.com/documentation/ddi0487/latest' : arm26Reference,
		link: (arch === ARCH_V8 ? a32InstructionLink : arm26InstructionLink)(name),
	})
}
