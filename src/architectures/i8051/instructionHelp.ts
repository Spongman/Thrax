import { htmlInstructionLink } from './htmlReferences'
import { instructionHelpGroups, instructionLinks, preferInstructionLinks } from '../../core/instructionHelp'
import { reference } from './isa'

/** PDF page indexes of each Instruction Definitions entry in the MCS-51 User's Manual's Programmer's Guide chapter. */
const pages: Record<number, string> = {
	59: 'acall', 60: 'add', 61: 'addc', 63: 'ajmp anl', 66: 'cjne', 68: 'clr', 69: 'cpl', 70: 'da', 72: 'dec', 73: 'div', 74: 'djnz', 75: 'inc',
	77: 'jb jbc', 78: 'jc', 79: 'jmp', 80: 'jnb jnc', 81: 'jnz jz', 82: 'lcall ljmp', 83: 'mov', 88: 'movc', 89: 'movx', 91: 'mul nop', 92: 'orl',
	95: 'pop push', 96: 'ret reti', 97: 'rl rlc', 98: 'rr rrc', 99: 'setb', 100: 'sjmp', 101: 'subb', 102: 'swap', 103: 'xch', 104: 'xchd xrl',
}
const pdfInstructionLink = instructionLinks(reference, Object.fromEntries(Object.entries(pages).flatMap(([page, names]) => names.split(' ').map(name => [name, Number(page)]))))

export const instructionHelp = instructionHelpGroups([
	['nop', '', 'Advance to the next instruction without changing processor state.'],
	['mov', 'destination, source', 'Copy a byte between the accumulator, registers, direct or indirect internal RAM, immediate data or bit/carry operands. MOV DPTR,#data16 loads the data pointer.', ['Direct addresses 0x80–0xFF select SFRs; indirect @R0/@R1 addresses select internal RAM. Register banks are selected by PSW.RS1:RS0.']],
	['movx', 'A,@DPTR | @DPTR,A | A,@Ri | @Ri,A', 'Transfer a byte between A and external data memory. @Ri forms use the P2 latch as the high address byte.'],
	['movc', 'A,@A+DPTR | A,@A+PC', 'Read a byte from code memory, indexed by the unsigned accumulator and DPTR or the address after this instruction.'],
	['add', 'A,source', 'Add an 8-bit register, direct/indirect byte or immediate to A. Update carry, auxiliary carry, overflow and accumulator parity.'],
	['addc', 'A,source', 'Add the source and PSW.CY to A; update CY, AC, OV and parity.'],
	['subb', 'A,source', 'Subtract the source and carry/borrow from A. CY reports unsigned borrow; AC and OV report nibble borrow and signed overflow.'],
	['inc dec', 'A | Rn | direct | @Ri', 'Increment or decrement an 8-bit operand with wrapping; arithmetic carry and overflow are unchanged. INC DPTR increments the 16-bit data pointer.'],
	['mul', 'AB', 'Multiply unsigned A by unsigned B; store the low byte in A and high byte in B. Clear CY; OV reports a nonzero high byte.'],
	['div', 'AB', 'Divide unsigned A by B, producing quotient A and remainder B. Clear CY; division by zero sets OV.'],
	['da', 'A', 'Decimal-adjust A after packed-BCD addition using CY and AC; preserve decimal carry as specified by the MCS-51.'],
	['anl', 'A,source | direct,A | direct,#data | C,bit | C,/bit', 'Bitwise AND the destination with the source. Carry forms operate on a bit or its complement.'],
	['orl', 'A,source | direct,A | direct,#data | C,bit | C,/bit', 'Bitwise OR the destination with the source. Carry forms operate on a bit or its complement.'],
	['xrl', 'A,source | direct,A | direct,#data', 'Bitwise XOR the source into the accumulator or direct byte.'],
	['clr', 'A | C | bit', 'Clear the accumulator, carry flag or addressed bit.'],
	['setb', 'C | bit', 'Set the carry flag or addressed bit.'],
	['cpl', 'A | C | bit', 'Complement the accumulator, carry flag or addressed bit.'],
	['rr rl', 'A', 'Rotate A one bit right or left, wrapping within its eight bits; CY is unchanged.'],
	['rrc rlc', 'A', 'Rotate A one bit right or left through CY; the shifted-out bit becomes the new CY.'],
	['swap', 'A', 'Exchange the high and low four-bit nibbles of A.'],
	['xch', 'A,Rn | A,direct | A,@Ri', 'Exchange the accumulator and an internal register or RAM/SFR byte.'],
	['xchd', 'A,@Ri', 'Exchange only the low nibbles of A and the indirectly addressed internal RAM byte.'],
	['push', 'direct', 'Increment the internal 8-bit stack pointer and push the direct-addressed byte into internal RAM.'],
	['pop', 'direct', 'Pop an internal stack byte into the direct destination, then decrement SP.'],
	['ajmp', 'target', 'Jump within the 2 KiB code page containing the address after this instruction.'],
	['ljmp', 'target', 'Jump to a 16-bit absolute code address.'],
	['sjmp', 'target', 'Jump to a signed 8-bit PC-relative code target.'],
	['jmp', '@A+DPTR', 'Jump to the 16-bit code address formed by DPTR plus unsigned A.'],
	['acall', 'target', 'Push the return address and call within the current 2 KiB code page.'],
	['lcall', 'target', 'Push the return address and call any 16-bit code address.', ['LCALL 0xFF00 selects the documented THRAX educational monitor; other targets use the native stack and call semantics.']],
	['ret', '', 'Pop the return address from internal RAM and return from a subroutine.'],
	['reti', '', 'Pop the return address from an interrupt service routine. External interrupt delivery is not modeled in this environment.'],
	['jc', 'target', 'Branch by a signed 8-bit displacement if CY is set.'],
	['jnc', 'target', 'Branch by a signed 8-bit displacement if CY is clear.'],
	['jz', 'target', 'Branch if A is zero; no zero flag is used.'],
	['jnz', 'target', 'Branch if A is nonzero; no zero flag is used.'],
	['jb jnb', 'bit,target', 'Branch when the addressed bit is set (JB) or clear (JNB).'],
	['jbc', 'bit,target', 'If the addressed bit is set, clear it and take the relative branch.'],
	['cjne', 'A,source,target | Rn,#data,target | @Ri,#data,target', 'Compare bytes and branch if unequal. CY is set when the unsigned first operand is smaller than the second.'],
	['djnz', 'Rn,target | direct,target', 'Decrement a byte and branch if its wrapped result is nonzero; CY is unchanged.'],
])

export const instructionLink = preferInstructionLinks(htmlInstructionLink, pdfInstructionLink)
