import { htmlInstructionLink, htmlReference } from './htmlReferences'
import { instructionCatalog, instructionLinks, preferInstructionLinks, type InstructionHelp, type InstructionTable } from '../../core/instructionHelp'

const DOCS: InstructionTable = {
	ld: ['destination, source', 'Copy a byte or register pair, or transfer to or from memory. Most forms preserve flags; LD A,I and LD A,R update flags.'],
	push: ['rr', 'Push a register pair onto the descending stack.'],
	pop: ['rr', 'Pop a register pair from the stack.'],
	ex: ['DE, HL | AF, AF′ | (SP), HL/IX/IY', 'Exchange register pairs, alternate AF, or a pair with the top of the stack.'],
	exx: ['', 'Exchange BC, DE and HL with their alternate register sets.'],
	add: ['A, source | HL/IX/IY, rr', 'Add to A or a 16-bit register pair.'],
	adc: ['A, source | HL, rr', 'Add with carry to A or HL.'],
	sub: ['source', 'Subtract from A, updating arithmetic flags.'],
	sbc: ['A, source | HL, rr', 'Subtract with carry (borrow) from A or HL.'],
	and: ['source', 'Bitwise AND into A.'],
	xor: ['source', 'Bitwise exclusive OR into A.'],
	or: ['source', 'Bitwise OR into A.'],
	cp: ['source', 'Compare A with source by subtraction; leave A unchanged.'],
	inc: ['operand', 'Increment a byte or register pair; preserve carry. Pair forms preserve all flags.'],
	dec: ['operand', 'Decrement a byte or register pair; preserve carry. Pair forms preserve all flags.'],
	daa: ['', 'Decimal-adjust A after packed BCD addition or subtraction.'],
	cpl: ['', 'Complement A; set H and N.'],
	neg: ['', 'Negate A using two’s complement, updating arithmetic flags.'],
	ccf: ['', 'Complement carry; copy its old value into H and clear N.'],
	scf: ['', 'Set carry and clear H and N.'],
	nop: ['', 'Do nothing.'],
	halt: ['', 'Halt instruction execution until an accepted interrupt or reset.'],
	di: ['', 'Disable maskable interrupts.'],
	ei: ['', 'Enable maskable interrupts after the following instruction.'],
	im: ['0 | 1 | 2', 'Select interrupt mode 0, 1 or 2.'],
	rlca: ['', 'Rotate A left, moving bit 7 to bit 0 and carry; preserve S, Z and P/V.'],
	rla: ['', 'Rotate A left through carry; preserve S, Z and P/V.'],
	rrca: ['', 'Rotate A right, moving bit 0 to bit 7 and carry; preserve S, Z and P/V.'],
	rra: ['', 'Rotate A right through carry; preserve S, Z and P/V.'],
	rlc: ['operand', 'Rotate a byte left, moving bit 7 to bit 0 and carry.'],
	rl: ['operand', 'Rotate a byte left through carry.'],
	rrc: ['operand', 'Rotate a byte right, moving bit 0 to bit 7 and carry.'],
	rr: ['operand', 'Rotate a byte right through carry.'],
	sla: ['operand', 'Shift left, inserting zero and moving bit 7 to carry.'],
	sra: ['operand', 'Shift right, retaining the sign bit and moving bit 0 to carry.'],
	srl: ['operand', 'Shift right, inserting zero and moving bit 0 to carry.'],
	sll: ['operand', 'Undocumented shift left, inserting one and moving bit 7 to carry.'],
	sl1: ['operand', 'Alias of undocumented SLL: shift left, inserting one.'],
	sli: ['operand', 'Alias of undocumented SLL: shift left, inserting one.'],
	rld: ['', 'Rotate nibbles left between A and (HL); leave the upper nibble of A unchanged.'],
	rrd: ['', 'Rotate nibbles right between A and (HL); leave the upper nibble of A unchanged.'],
	bit: ['bit, operand', 'Test a bit into Z; leave the operand unchanged and preserve carry.'],
	set: ['bit, operand', 'Set a bit without changing flags.'],
	res: ['bit, operand', 'Clear a bit without changing flags.'],
	jp: ['[condition,] target | (HL/IX/IY)', 'Jump to an absolute or indirect address, optionally testing a condition.'],
	jr: ['[NZ/Z/NC/C,] target', 'Branch relatively, optionally testing Z or carry.'],
	djnz: ['target', 'Decrement B and branch relatively if B is nonzero; preserve flags.'],
	call: ['[condition,] target', 'Push the return address and call target if the optional condition passes.'],
	ret: ['[condition]', 'Pop PC from the stack if the optional condition passes.'],
	retn: ['', 'Return from a nonmaskable interrupt and copy IFF2 into IFF1.'],
	reti: ['', 'Return from an interrupt and signal interrupt completion to compatible peripherals.'],
	rst: ['vector', 'Call one of the eight restart vectors 0, 8, …, 56.'],
	in: ['A, (port) | r, (C)', 'Read a byte from an I/O port. Register-indirect forms update flags.'],
	out: ['(port), A | (C), r', 'Write a byte to an I/O port.'],
}
const block: Record<string, readonly [string, string]> = {}
for (const [base, action, counter] of [
	['ld', 'Copy (HL) to (DE), updating both pointers and decrementing BC.', 'BC becomes zero'],
	['cp', 'Compare A with (HL), update HL and decrement BC.', 'BC becomes zero or a match is found'],
	['in', 'Read port (C) into (HL), update HL and decrement B.', 'B becomes zero'],
	['out', 'Write (HL) to port (C), update HL and decrement B.', 'B becomes zero'],
]) {
	for (const [suffix, direction, repeat] of [['i', 'increment', false], ['d', 'decrement', false], ['ir', 'increment', true], ['dr', 'decrement', true]] as const) {
		// Repeating OUT instructions use OTIR/OTDR, unlike OUTI/OUTD.
		const name = base === 'out' && repeat ? `ot${suffix}` : `${base}${suffix}`
		block[name] = ['', `${action} Pointers ${direction}.${repeat ? ` Repeat until ${counter}.` : ''}`]
	}
}

const reference = 'https://www.zilog.com/docs/z80/UM0080.pdf'
/** PDF page indexes of each mnemonic's first entry in UM0080; undocumented SLL has none. */
const pages: Record<string, number> = {
	ld: 85, push: 129, pop: 133, ex: 138, exx: 140, ldi: 144, ldir: 146, ldd: 148, lddr: 150, cpi: 152, cpir: 153, cpd: 155, cpdr: 156, add: 159,
	adc: 165, sub: 167, sbc: 169, and: 171, or: 173, xor: 175, cp: 177, inc: 179, dec: 184, daa: 187, cpl: 189, neg: 190, ccf: 192, scf: 193, nop: 194,
	halt: 195, di: 196, ei: 197, im: 198, rlca: 219, rla: 221, rrca: 223, rra: 225, rlc: 227, rl: 235, rrc: 238, rr: 241, sla: 244, sra: 247, srl: 250,
	rld: 252, rrd: 254, bit: 257, set: 265, res: 273, jp: 276, jr: 279, djnz: 292, call: 295, ret: 299, reti: 302, retn: 304, rst: 306, in: 309,
	ini: 312, inir: 314, ind: 316, indr: 318, out: 320, outi: 323, otir: 325, outd: 327, otdr: 329,
}

export const Z80_INSTRUCTIONS = instructionCatalog({ ...DOCS, ...block }, htmlReference, preferInstructionLinks(name => htmlInstructionLink(/^(sl1|sli)$/i.test(name) ? 'sll' : name), instructionLinks(reference, pages)))
export const Z80_MNEMONICS = Z80_INSTRUCTIONS.names().map(name => name.toUpperCase())
export const z80InstructionHelp = Z80_INSTRUCTIONS.help
