import type { DebugInspection, TokenDescription } from '../../contracts'
import { describeArmToken } from '../../arm/editor/dataTips'
import { m0InstructionHelp } from './instructionHelp'

export function describeM0Token(text: string, column: number, inspection: DebugInspection, value?: (name: string) => number | undefined): TokenDescription | null {
	const comment = text.search(/@|;|\/\//)
	if (comment >= 0 && column >= comment) return null
	for (const match of text.matchAll(/\b(?:apsr|xpsr|msp|psp|control|primask)\b/gi)) {
		if (column < match.index || column >= match.index + match[0].length) continue
		const id = match[0].toUpperCase(), current = inspection.registers[id]
		return current === undefined ? null : {
			start: match.index, length: match[0].length, register: id,
			contents: [`**${id}** = ${current} (0x${current.toString(16)})`],
		}
	}
	return describeArmToken(text, column, inspection, { value, instructionHelp: m0InstructionHelp })
}
