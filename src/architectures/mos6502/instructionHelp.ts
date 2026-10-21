import { formatInstructionHelp, type InstructionHelp } from '../../core/instructionHelp'
import { ALL_MNEMONICS, INSN_BY_NAME, MODE_NAMES, NMOS_MODEL, type CpuModel } from './isa'

/** What each instruction does, and the flags it sets. */
const SUMMARIES: Readonly<Record<string, string>> = {
	ADC: 'Add memory and carry to A (NVZC)', AND: 'AND memory into A (NZ)', ASL: 'Shift left, bit 7 into C (NZC)',
	BCC: 'Branch if C is clear', BCS: 'Branch if C is set', BEQ: 'Branch if Z is set', BIT: 'Test A AND memory; N and V from memory (NVZ)',
	BMI: 'Branch if N is set', BNE: 'Branch if Z is clear', BPL: 'Branch if N is clear', BRK: 'Software interrupt through $FFFE (I)',
	BVC: 'Branch if V is clear', BVS: 'Branch if V is set', CLC: 'Clear carry', CLD: 'Clear decimal mode', CLI: 'Enable IRQ',
	CLV: 'Clear overflow', CMP: 'Compare A with memory (NZC)', CPX: 'Compare X with memory (NZC)', CPY: 'Compare Y with memory (NZC)',
	DEC: 'Decrement memory (NZ)', DEX: 'Decrement X (NZ)', DEY: 'Decrement Y (NZ)', EOR: 'Exclusive-OR memory into A (NZ)',
	INC: 'Increment memory (NZ)', INX: 'Increment X (NZ)', INY: 'Increment Y (NZ)', JMP: 'Jump', JSR: 'Push the return address less one and jump',
	LDA: 'Load A (NZ)', LDX: 'Load X (NZ)', LDY: 'Load Y (NZ)', LSR: 'Shift right, bit 0 into C (NZC)', NOP: 'No operation',
	ORA: 'OR memory into A (NZ)', PHA: 'Push A', PHP: 'Push P, with B set', PLA: 'Pull A (NZ)', PLP: 'Pull P',
	ROL: 'Rotate left through C (NZC)', ROR: 'Rotate right through C (NZC)', RTI: 'Return from interrupt: pull P, then PC',
	RTS: 'Return from subroutine: pull PC, plus one', SBC: 'Subtract memory and borrow from A (NVZC)', SEC: 'Set carry',
	SED: 'Set decimal mode', SEI: 'Disable IRQ', STA: 'Store A', STX: 'Store X', STY: 'Store Y', TAX: 'Copy A to X (NZ)',
	TAY: 'Copy A to Y (NZ)', TSX: 'Copy SP to X (NZ)', TXA: 'Copy X to A (NZ)', TXS: 'Copy X to SP', TYA: 'Copy Y to A (NZ)',
	LAX: 'Load A and X (NZ); the immediate form uses the unstable NMOS mask', SAX: 'Store A AND X',
	DCP: 'Decrement memory, then compare A (NZC)', ISC: 'Increment memory, then subtract with borrow (NVZC)',
	SLO: 'Shift memory left, then OR into A (NZC)', RLA: 'Rotate memory left, then AND into A (NZC)',
	SRE: 'Shift memory right, then XOR into A (NZC)', RRA: 'Rotate memory right, then add with carry (NVZC)',
	ANC: 'AND into A, copy N into C (NZC)', ALR: 'AND into A, then shift right (NZC)',
	ARR: 'AND into A, then rotate right with special carry, overflow and decimal rules (NVZC)',
	AXS: 'Subtract immediate from A AND X into X, ignoring carry-in (NZC)', XAA: 'Unstable NMOS AND of A, X, operand and magic mask (NZ)',
	LAS: 'Load memory AND SP into A, X and SP (NZ)', AHX: 'Masked store of A AND X using address high byte + 1',
	SHX: 'Masked store of X using address high byte + 1', SHY: 'Masked store of Y using address high byte + 1',
	TAS: 'Copy A AND X into SP, then masked store', KIL: 'Jam the CPU until reset; IRQ and NMI cannot resume it',
	BRA: 'Branch unconditionally', STZ: 'Store zero', TRB: 'Test A AND memory into Z, then clear memory bits selected by A',
	TSB: 'Test A AND memory into Z, then set memory bits selected by A', PHX: 'Push X', PLX: 'Pull X (NZ)',
	PHY: 'Push Y', PLY: 'Pull Y (NZ)', WAI: 'Wait for an interrupt', STP: 'Stop until reset',
}

// These shapes follow the addressing-mode order in isa.ts.
const OPERANDS = ['', 'A', '#value', '$zp', '$zp,X', '$zp,Y', '$address', '$address,X', '$address,Y',
	'($address)', '($zp,X)', '($zp),Y', 'target', '($zp)', '($address,X)', '$zp, target']

export function mos6502InstructionHelp(text: string, model: CpuModel = NMOS_MODEL): InstructionHelp | null {
	const insn = INSN_BY_NAME.get(text.toUpperCase())
	if (insn === undefined || !model.opcodes[insn].some((opcode) => opcode >= 0)) return null
	const name = ALL_MNEMONICS[insn]
	const bit = /^(RMB|SMB|BBR|BBS)([0-7])$/.exec(name)
	const summary = bit ? ({
		RMB: `Clear bit ${bit[2]} in zero-page memory`, SMB: `Set bit ${bit[2]} in zero-page memory`,
		BBR: `Branch if bit ${bit[2]} in zero-page memory is clear`, BBS: `Branch if bit ${bit[2]} in zero-page memory is set`,
	})[bit[1]] : SUMMARIES[name]
	if (!summary) return null
	const modes = MODE_NAMES.flatMap((_, mode) => model.opcodes[insn][mode] >= 0 ? [mode] : [])
	return formatInstructionHelp(text, {
		summary,
		kind: !model.cmos && insn >= 98 ? 'undocumented NMOS instruction' : undefined,
		forms: modes.map((mode) => `${text.toUpperCase()}${OPERANDS[mode] ? ` ${OPERANDS[mode]}` : ''}`),
		details: [`Modes: ${modes.map((mode) => MODE_NAMES[mode]).join(', ')}`],
		reference: model.cmos ? 'https://wdc65xx.com/support/documentation/' : undefined,
	})
}
