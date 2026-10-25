import { instructionHelpGroups } from '../../../core/instructionHelp'
import { instructions } from './isa'

export const instructionHelp = instructionHelpGroups([
	['lda', '#immediate | memory', 'Load the accumulator using the width selected by P.M; update N/Z. In 8-bit mode the hidden high accumulator byte is preserved.'],
	['ldx ldy', '#immediate | memory', 'Load X or Y using the width selected by P.X; update N/Z. In 8-bit index mode the high byte is zero.'],
	['sta stx sty', 'memory', 'Store A, X or Y using its current native width. Addressing mode selects direct-page, data-bank, long, indexed, indirect or stack-relative addressing.'],
	['stz', 'memory', 'Store zero using the accumulator width selected by M; flags are unchanged.'],
	['adc', '#immediate | memory', 'Add the operand and C to A at the current accumulator width; update N/V/Z/C. Decimal mode applies packed-BCD correction.'],
	['sbc', '#immediate | memory', 'Subtract the operand and inverse carry/borrow from A; update N/V/Z/C. Decimal mode applies packed-BCD correction.'],
	['cmp cpx cpy', '#immediate | memory', 'Compare A, X or Y with the operand without storing the result. Set N/Z and C (no unsigned borrow); use the register’s selected width.'],
	['and ora eor', '#immediate | memory', 'AND, OR or XOR the operand into A at its current width; update N/Z.'],
	['bit', '#immediate | memory', 'Set Z from A AND the operand. Memory forms also copy operand sign/overflow bits into N/V; immediate BIT leaves N/V unchanged.'],
	['trb tsb', 'memory', 'Test A AND memory into Z, then reset or set memory bits selected by A.'],
	['asl lsr', 'A | memory', 'Shift left or logically right at accumulator width, putting the shifted-out bit into C and updating N/Z.'],
	['rol ror', 'A | memory', 'Rotate left or right through carry at accumulator width; update N/Z/C.'],
	['inc dec', 'A | memory', 'Increment or decrement an accumulator-width value; update N/Z and preserve carry.'],
	['inx dex iny dey', '', 'Increment or decrement X or Y at the selected index width; update N/Z.'],
	['tax tay', '', 'Transfer A to X or Y, applying index width and updating N/Z.'],
	['txa tya', '', 'Transfer X or Y into A, applying accumulator width and updating N/Z.'],
	['txy tyx', '', 'Transfer X to Y or Y to X using index width; update N/Z.'],
	['tsx txs', '', 'Transfer S to X (updating N/Z at index width), or X to S (without changing flags). Emulation mode forces the stack to page one.'],
	['tcd tdc', '', 'Transfer the full 16-bit accumulator to direct-page register D or D to the full accumulator; update N/Z as a 16-bit result.'],
	['tcs tsc', '', 'Transfer the full accumulator to S without changing flags, or S to the full accumulator and update N/Z.'],
	['xba', '', 'Exchange the two accumulator bytes and set N/Z from the new low byte, regardless of M.'],
	['xce', '', 'Exchange C and emulation flag E. Entering emulation forces M/X set, clears high index bytes and selects page-one stack wrapping.'],
	['rep sep', '#mask8', 'Reset or set selected P bits. M/X select accumulator/index widths in native mode; emulation constrains both to eight bits.'],
	['clc sec', '', 'Clear or set carry C.'],
	['cld sed', '', 'Clear or set decimal arithmetic flag D.'],
	['cli sei', '', 'Clear or set interrupt-disable flag I. External interrupt delivery is not modeled.'],
	['clv', '', 'Clear signed-overflow flag V.'],
	['pha phx phy', '', 'Push A, X or Y using the register’s current width. Native mode uses a 16-bit descending stack; emulation wraps within page one.'],
	['pla plx ply', '', 'Pull A, X or Y using the current width and update N/Z.'],
	['php plp', '', 'Push or pull processor status P, respecting native/emulation width constraints.'],
	['phb plb', '', 'Push or pull data-bank register DBR. PLB updates N/Z from the byte result.'],
	['phd pld', '', 'Push or pull the 16-bit direct-page register D. PLD updates N/Z from the word result.'],
	['phk', '', 'Push the current program-bank register PBR.'],
	['pea', 'address16', 'Push the encoded 16-bit immediate effective address; no memory operand is read.'],
	['pei', '(direct)', 'Read a 16-bit pointer from the direct page and push it.'],
	['per', 'target', 'Push the 16-bit address formed by adding a signed relative displacement to the following PC.'],
	['jmp', 'address | (address) | (address,X)', 'Jump within the program bank using an absolute or indirect target.'],
	['jml', 'address24 | [address]', 'Jump long, loading both program bank and 16-bit PC from an immediate or indirect 24-bit address.'],
	['jsr', 'address | (address,X)', 'Push the native near return address and call a subroutine in the program bank.'],
	['jsl', 'address24', 'Push the program bank and native return address, then call a long 24-bit target.'],
	['rts rtl', '', 'Pull a near return address (RTS), or return address and bank (RTL), then advance past the saved call operand.'],
	['rti', '', 'Restore status and PC, plus PBR in native mode, from a native interrupt stack frame.'],
	['brk cop', '[signature8]', 'Execute the native software trap. This environment reserves the documented zero-signature BRK monitor ABI; other supported vectors use native stack/context handling.'],
	['bra brl', 'target', 'Always take an 8-bit or 16-bit signed PC-relative branch within the current program bank.'],
	['bcc bcs', 'target', 'Branch when C is clear or set.'],
	['beq bne', 'target', 'Branch when Z is set or clear.'],
	['bmi bpl', 'target', 'Branch when N is set or clear.'],
	['bvc bvs', 'target', 'Branch when V is clear or set.'],
	['mvn mvp', 'sourceBank,destinationBank', 'Move a block through X/Y, incrementing (MVN) or decrementing (MVP) the offsets and decrementing the 16-bit accumulator byte count. DBR becomes the destination bank.'],
	['nop', '', 'No operation; advance without changing processor state.'],
	['wdm', '[signature8]', 'Reserved two-byte extension prefix. THRAX consumes the signature without assigning a new instruction meaning.'],
	['wai', '', 'Wait for an interrupt. This environment has no external wake source and reports that limitation.'],
	['stp', '', 'Stop the processor until reset or an explicit debugger recovery action.'],
])
for (const name of instructions) if (/\.[BW]$/.test(name)) {
	const base = instructionHelp[name.slice(0, -2).toLowerCase()]
	if (base) instructionHelp[name.toLowerCase()] = { ...base, syntax: base.syntax.replace(/^\S+/, name), details: [`Assembler width suffix: encode a ${name.endsWith('.B') ? 'byte' : 'word'} immediate. Execution still follows the live M/X flags; set them consistently.`] }
}

export const reference = 'https://www.pagetable.com/c64ref/6502/?cpu=65c816&tab=2'
const MNEMONICS = new Set('adc and asl bcc bcs beq bit bmi bne bpl bra brk brl bvc bvs clc cld cli clv cmp cop cpx cpy dec dex dey eor inc inx iny jml jmp jsl jsr lda ldx ldy lsr mvn mvp nop ora pea pei per pha phb phd phk php phx phy pla plb pld plp plx ply rep rol ror rti rtl rts sbc sec sed sei sep sta stp stx sty stz tax tay tcd tcs tdc trb tsb tsc tsx txa txs txy tya tyx wai wdm xba xce'.split(' '))

/** Width suffixes select encodings of the same documented operation. */
export const instructionLink = (mnemonic: string) => {
	const name = mnemonic.toLowerCase().replace(/\.[bw]$/, '')
	return MNEMONICS.has(name) ? `${reference}#${name === 'jml' ? 'JMP' : name.toUpperCase()}` : undefined
}
