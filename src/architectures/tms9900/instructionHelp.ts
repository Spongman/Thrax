import { htmlInstructionLink } from './htmlReferences'
import { preferInstructionLinks, instructionHelpGroups, instructionLinks } from '../../core/instructionHelp'

export const instructionHelp = instructionHelpGroups([
	['li', 'Rn,immediate16', 'Load a 16-bit immediate into a memory-resident workspace register; update LGT/AGT/EQ.'],
	['ai', 'Rn,immediate16', 'Add a 16-bit immediate to a workspace register; update LGT/AGT/EQ/C/OV.'],
	['andi ori', 'Rn,immediate16', 'AND or OR an immediate into a workspace register; update LGT/AGT/EQ.'],
	['ci', 'Rn,immediate16', 'Compare a workspace register with an immediate without storing the result; update logical and arithmetic comparison status.'],
	['mov movb', 'source,destination', 'Copy a word or byte and set LGT/AGT/EQ; MOVB also sets odd parity. Byte operations on registers use their high byte.', ['Operands may be Rn, *Rn, *Rn+, @address or @displacement(Rn). Registers occupy RAM at WP+2*n; source evaluation precedes destination evaluation.']],
	['a ab', 'source,destination', 'Add a word or byte into the destination; update logical/arithmetic result flags, carry and signed overflow. Byte operations also update parity.'],
	['s sb', 'source,destination', 'Subtract a word or byte from the destination; update result, carry/no-borrow, overflow and byte parity status.'],
	['c cb', 'source,destination', 'Compare source and destination without storing a result; update signed and unsigned comparison status, plus byte parity for CB.'],
	['soc socb', 'source,destination', 'Set destination bits that are one in the source (bitwise OR); update result status and byte parity when applicable.'],
	['szc szcb', 'source,destination', 'Clear destination bits that are one in the source; update result status and byte parity when applicable.'],
	['coc czc', 'source,Rn', 'Set EQ when all source one-bits correspond to ones (COC) or zeros (CZC) in the destination register.'],
	['xor', 'source,Rn', 'XOR a word into a workspace register; update LGT/AGT/EQ.'],
	['clr seto', 'destination', 'Store zero or all one-bits to a word destination; these instructions do not change status.'],
	['neg abs', 'destination', 'Negate a word or take its signed absolute value; update result and signed-overflow status, with NEG also affecting carry.'],
	['inv', 'destination', 'Complement every bit in a word; update LGT/AGT/EQ.'],
	['inc inct dec dect', 'destination', 'Add or subtract one, or two for the T forms, updating result/carry/overflow status.'],
	['swpb', 'destination', 'Swap the high and low bytes of a word without changing status.'],
	['sra srl sla src', 'Rn,count', 'Arithmetic-right, logical-right, left shift or right circular rotation. A zero count uses R0’s low nibble, with zero representing sixteen. Update result/carry flags; SLA also reports overflow.'],
	['mpy', 'source,Rn', 'Multiply unsigned 16-bit operands; store the 32-bit product in Rn:R(n+1), high word first.'],
	['div', 'source,Rn', 'Divide the unsigned 32-bit Rn:R(n+1) by a 16-bit operand, yielding quotient and remainder. On overflow, set OV and leave the pair unchanged.'],
	['b', 'destination', 'Branch to the operand’s effective address. B *R11 is the usual return encoding.'],
	['bl', 'destination', 'Save the next PC in R11 and branch to the destination’s effective address. Nested calls must preserve R11 in software.'],
	['rt', '', 'Return through R11; an alias of B *R11.'],
	['blwp', 'vector', 'Load WP and PC from a two-word vector and save the old WP, PC and ST in the new workspace’s R13–R15.'],
	['rtwp', '', 'Restore WP, PC and ST from workspace registers R13–R15.'],
	['xop', 'source,trap', 'Use the vector at 0x40+4*trap for a workspace context switch, saving the source effective address in the new R11 and setting ST.X.', ['A zero XOP 15 vector selects THRAX’s educational console ABI; a nonzero vector retains native XOP behavior.']],
	['stwp stst', 'Rn', 'Store the workspace pointer or status register in a workspace register.'],
	['lwpi', 'address', 'Load a word-aligned workspace pointer; all R0–R15 references then select the new RAM workspace.'],
	['limi', 'mask', 'Replace the low interrupt-mask bits of ST. This environment has no external interrupt delivery.'],
	['idle', '', 'Enter the native idle state. THRAX stops because this environment has no interrupt source that can wake the CPU.'],
	['nop', '', 'No operation; encodes a relative jump with zero displacement.'],
	['jmp', 'target', 'Always take a signed 8-bit relative word displacement.'],
	['jlt jle jgt', 'target', 'Branch on signed less-than, less-or-equal or greater-than using AGT and EQ.'],
	['jl jhe jh', 'target', 'Branch on unsigned lower, higher-or-equal or higher using LGT and EQ.'],
	['jeq jne', 'target', 'Branch if EQ is set or clear.'],
	['jnc joc', 'target', 'Branch if carry is clear or set.'],
	['jno', 'target', 'Branch if signed overflow is clear.'],
	['jop', 'target', 'Branch if odd-parity status is set.'],
])

// TMS 9900 Data Manual section 3.5: the PDF page holding each mnemonic's table row.
const PAGES: Readonly<Record<number, string>> = {
	25: 'a ab c cb s sb soc socb szc szcb mov movb coc czc xor mpy div',
	26: 'xop b bl blwp clr seto inv neg abs swpb inc inct dec dect x rt',
	27: 'ldcr stcr sbo sbz tb',
	28: 'jeq jgt jh jhe jl jle jlt jmp jnc jne jno joc jop nop sla sra src srl ai andi ci li ori',
	29: 'lwpi limi stst stwp rtwp idle rset ckof ckon lrex',
}
// Mirrors: https://archive.org/download/bitsavers_tiTMS9900TrDataManualMay76_1365285/TMS_9900_Microprocessor_Data_Manual_May76.pdf (not byte-identical: 64 bytes of one image differ; same 39 pages)
// Mirrors: https://datasheets.chipdb.org/TI/9900/TMS9900_DataManual.pdf (another scan, 41 pages, no text layer; page numbers may differ)
export const reference = 'https://bitsavers.org/components/ti/TMS9900/TMS_9900_Microprocessor_Data_Manual_May76.pdf'
const instructionLinkFallback = instructionLinks(reference,
	Object.fromEntries(Object.entries(PAGES).flatMap(([page, names]) => names.split(' ').map((name) => [name, Number(page)]))))
export const instructionLink = preferInstructionLinks(htmlInstructionLink, instructionLinkFallback)
