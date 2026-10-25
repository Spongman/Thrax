import { formatInstructionHelp, instructionLinks, type InstructionHelp, type InstructionTable } from '../../../core/instructionHelp'
import { ARM_CONDITIONS, ARM_INSTRUCTION_DOCS } from '../shared/instructionHelp'
import { ALU, CONDITIONS, MNEMONICS } from './isa'

const OVERRIDES: InstructionTable = {
	movs: ['Rd, Rm | Rd, #imm8', 'Copy a low register or immediate and update N and Z; register form uses LSL #0.'],
	mov: ['Rd, Rm', 'Copy a register without changing flags; high registers are allowed.'],
	add: ['Rdn, Rm | SP, #imm | Rd, SP, #imm', 'Add registers or a stack-relative immediate without changing flags.'],
	sub: ['SP, #imm', 'Subtract a multiple-of-four immediate from SP without changing flags.'],
	adds: ['Rd, Rn, Rm | Rd, Rn, #imm3 | Rdn, #imm8', 'Add registers or an immediate and update NZCV.'],
	subs: ['Rd, Rn, Rm | Rd, Rn, #imm3 | Rdn, #imm8', 'Subtract registers or an immediate and update NZCV.'],
	lsls: ['Rd, Rm, #shift | Rdn, Rm', 'Shift left by an immediate or register count; update N, Z and C.'],
	lsrs: ['Rd, Rm, #shift | Rdn, Rm', 'Shift right logically; update N, Z and C.'],
	asrs: ['Rd, Rm, #shift | Rdn, Rm', 'Shift right preserving the sign; update N, Z and C.'],
	rors: ['Rdn, Rm', 'Rotate right by a register count; update N, Z and C.'],
	adcs: ['Rdn, Rm', 'Add Rm and carry to Rdn; update NZCV.'],
	sbcs: ['Rdn, Rm', 'Subtract Rm and NOT carry from Rdn; update NZCV.'],
	rsbs: ['Rd, Rn, #0', 'Subtract Rn from zero (negate); update NZCV.'],
	negs: ['Rd, Rn', 'Negate Rn and update NZCV; alias of RSBS with immediate zero.'],
	muls: ['Rdn, Rm', 'Multiply low registers, keeping 32 bits; update N and Z.'],
	cmp: ['Rn, Rm | Rn, #imm8', 'Compare registers or an immediate by subtraction; update NZCV.'],
	cmn: ['Rn, Rm', 'Compare by addition; update NZCV without storing a result.'],
	tst: ['Rn, Rm', 'Test the bitwise AND into N and Z, leaving operands unchanged.'],
	ldmia: ['Rn{!}, {registers}', 'Load low registers with increment-after addressing; write back unless Rn is in the list.'],
	stmia: ['Rn!, {registers}', 'Store low registers with increment-after addressing and base writeback.'],
	ldr: ['Rt, [Rn, offset] | Rt, =value', 'Load a word; PC-relative literals and SP-relative loads are supported.'],
	str: ['Rt, [Rn, offset]', 'Store a word; low-register and SP-relative addressing are supported.'],
	ldrsb: ['Rt, [Rn, Rm]', 'Load a byte with register offset and sign-extend to 32 bits.'],
	ldrsh: ['Rt, [Rn, Rm]', 'Load a halfword with register offset and sign-extend to 32 bits.'],
	mrs: ['Rd, special-register', 'Read an ARMv6-M special register, such as APSR, MSP or PRIMASK.'],
	msr: ['special-register, Rn', 'Write a supported ARMv6-M special register.'],
	cpsid: ['i', 'Set PRIMASK to disable configurable-priority interrupts.'],
	cpsie: ['i', 'Clear PRIMASK to enable configurable-priority interrupts.'],
	bx: ['Rm', 'Branch through Rm; bit 0 must select Thumb state. Recognized EXC_RETURN values return from exceptions.'],
	blx: ['Rm', 'Call through Rm, saving a Thumb return address in LR. ARM state is unavailable on Cortex-M0.'],
}
const ALIASES: Readonly<Record<string, string>> = { ldm: 'ldmia', stm: 'stmia' }

/** Cortex-M0 Devices Generic User Guide (DUI 0497A) pages; a page ending in `/` is followed by the mnemonic. */
export const m0InstructionLink = instructionLinks('https://developer.arm.com/documentation/dui0497/a/the-cortex-m0-instruction-set/', Object.fromEntries(Object.entries({
	'memory-access-instructions/adr': 'adr', 'memory-access-instructions/ldr-and-str--immediate-offset': 'ldr str ldrb strb ldrh strh',
	'memory-access-instructions/ldr-and-str--register-offset': 'ldrsb ldrsh', 'memory-access-instructions/ldm-and-stm': 'ldm stm ldmia stmia',
	'memory-access-instructions/push-and-pop': 'push pop',
	'general-data-processing-instructions/adc--add--rsb--sbc--and-sub': 'adcs add adds rsbs negs sbcs sub subs',
	'general-data-processing-instructions/and--orr--eor--and-bic': 'ands orrs eors bics',
	'general-data-processing-instructions/asr--lsl--lsr--and-ror': 'asrs lsls lsrs rors',
	'general-data-processing-instructions/cmp-and-cmn': 'cmp cmn', 'general-data-processing-instructions/mov-and-mvn': 'mov movs mvns',
	'general-data-processing-instructions/muls': 'muls', 'general-data-processing-instructions/rev--rev16--and-revsh': 'rev rev16 revsh',
	'general-data-processing-instructions/sxt-and-uxt': 'sxtb sxth uxtb uxth', 'general-data-processing-instructions/tst': 'tst',
	'branch-and-control-instructions/b--bl--bx--and-blx': 'b bl bx blx beq bne bcs bcc bmi bpl bvs bvc bhi bls bge blt bgt ble bhs blo',
	'miscellaneous-instructions/cps': 'cpsid cpsie', 'miscellaneous-instructions/': 'bkpt dmb dsb isb mrs msr nop sev svc wfe wfi',
}).flatMap(([page, names]) => names.split(' ').map(name => [name, page.endsWith('/') ? page + name : page]))))

export function m0InstructionHelp(name: string): InstructionHelp | null {
	const lower = name.toLowerCase()
	if (!MNEMONICS.includes(lower)) return null
	const cc = /^b(eq|ne|cs|cc|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|hs|lo)$/.exec(lower)
	const condition = cc && CONDITIONS.indexOf(cc[1] === 'hs' ? 'cs' : cc[1] === 'lo' ? 'cc' : cc[1])
	const base = ALIASES[lower] ?? (ALU.includes(lower) && lower.endsWith('s') ? lower.slice(0, -1) : lower)
	const entry = condition !== null && condition >= 0
		? ['target', `Branch when ${ARM_CONDITIONS[condition]}; flags are unchanged.`]
		: OVERRIDES[lower] ?? OVERRIDES[base] ?? ARM_INSTRUCTION_DOCS[base]
	if (!entry) return null
	const logical = ['ands', 'eors', 'orrs', 'bics', 'mvns'].includes(lower)
	return formatInstructionHelp(name, {
		summary: entry[1] + (logical ? ' Updates N and Z; C and V are preserved.' : ''),
		forms: [`${lower} ${logical ? (lower === 'mvns' ? 'Rd, Rm' : 'Rdn, Rm') : entry[0]}`.trim()],
		reference: 'https://developer.arm.com/documentation/dui0497/a/BABHCHGB',
		link: m0InstructionLink(lower),
	})
}
