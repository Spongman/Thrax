import { literalField, opcodeField, raField, rbField, rcField } from './decode'
import { FORMAT_BRANCH, FORMAT_JMP, FORMAT_LD, FORMAT_LDR, FORMAT_OP, FORMAT_OPC, FORMAT_ST, OPCODE_FORMAT, OPCODE_MNEMONIC } from './isa'

const hex = (value: number) => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

/** Target of a branch or LDR at `address`: the updated PC plus the word offset. */
export function relativeTarget(word: number, address: number): number {
	return (address + 4 + literalField(word) * 4) >>> 0
}

/**
 * Formats a word in UASM's destination-last syntax, e.g. `ADDC(R1, 5, R3)`.
 * Branch and LDR targets use `symbolAt` when it names one, else the numeric
 * address. Illegal opcodes come out as the `LONG` that would assemble them.
 */
export function disassemble(word: number, address = 0, symbolAt?: (address: number) => string | undefined): string {
	const opcode = opcodeField(word)
	const name = OPCODE_MNEMONIC[opcode]
	const rc = `R${rcField(word)}`
	const ra = `R${raField(word)}`
	const target = () => {
		const at = relativeTarget(word, address)
		return symbolAt?.(at) ?? hex(at)
	}
	switch (OPCODE_FORMAT[opcode]) {
		case FORMAT_OP: return `${name}(${ra}, R${rbField(word)}, ${rc})`
		case FORMAT_OPC:
		case FORMAT_LD: return `${name}(${ra}, ${literalField(word)}, ${rc})`
		case FORMAT_ST: return `${name}(${rc}, ${literalField(word)}, ${ra})`
		case FORMAT_JMP: return `${name}(${ra}, ${rc})`
		case FORMAT_BRANCH: return `${name}(${ra}, ${target()}, ${rc})`
		case FORMAT_LDR: return `${name}(${target()}, ${rc})`
		default: return `LONG(${hex(word)})`
	}
}
