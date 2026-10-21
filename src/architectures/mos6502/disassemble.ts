import { ABS, ABX, ABY, ACC, IMM, IND, IZX, IZY, ALL_MNEMONICS, MODE_BYTES, OPCODE_INSN, OPCODE_MODE, REL, ZP, ZPX, ZPY } from './isa'
import { AIX, NMOS_MODEL, ZPI, ZPR, type CpuModel } from './isa'

export const hex2 = (value: number) => `$${(value & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`
export const hex4 = (value: number) => `$${(value & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`

/** Instruction length under the selected CPU's decode table. */
export const instructionLength = (opcode: number, model: CpuModel = NMOS_MODEL) => model.instructions[opcode] < 0 ? 1 : MODE_BYTES[model.modes[opcode]]

/**
 * The instruction `bytes` spell at `address` in ca65 syntax, e.g. `LDA ($10),Y`.
 * Branch targets are absolute; `symbolAt` names jump and branch targets where
 * it can. NMOS unintended instructions use their canonical mnemonics; the
 * W65C02S table decodes the same bytes as its CMOS replacements.
 */
export function disassemble(bytes: readonly number[], address = 0, symbolAt?: (address: number) => string | undefined, model: CpuModel = NMOS_MODEL): string {
	const opcode = bytes[0] & 0xFF
	const insn = model.instructions[opcode]
	if (insn < 0) return `.byte ${hex2(opcode)}`
	const mode = model.modes[opcode]
	const mnemonic = ALL_MNEMONICS[insn]
	const low = bytes[1] ?? 0
	const word = low | ((bytes[2] ?? 0) << 8)
	const named = (target: number) => symbolAt?.(target) ?? hex4(target)
	switch (mode) {
		case ZPI: return `${mnemonic} (${hex2(low)})`
		case AIX: return `${mnemonic} (${hex4(word)},X)`
		case ZPR: return `${mnemonic} ${hex2(low)},${named((address + 3 + (((bytes[2] ?? 0) << 24) >> 24)) & 0xFFFF)}`
		case ACC: return `${mnemonic} A`
		case IMM: return `${mnemonic} #${hex2(low)}`
		case ZP: return `${mnemonic} ${hex2(low)}`
		case ZPX: return `${mnemonic} ${hex2(low)},X`
		case ZPY: return `${mnemonic} ${hex2(low)},Y`
		case ABS: return `${mnemonic} ${named(word)}`
		case ABX: return `${mnemonic} ${hex4(word)},X`
		case ABY: return `${mnemonic} ${hex4(word)},Y`
		case IND: return `${mnemonic} (${hex4(word)})`
		case IZX: return `${mnemonic} (${hex2(low)},X)`
		case IZY: return `${mnemonic} (${hex2(low)}),Y`
		case REL: return `${mnemonic} ${named((address + 2 + ((low << 24) >> 24)) & 0xFFFF)}`
		default: return mnemonic
	}
}
