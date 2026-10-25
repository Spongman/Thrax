import type { DebugInspection, TokenDescription } from '../../contracts'
import { describeArmToken } from '../shared/editor/dataTips'
import { m0InstructionHelp } from './instructionHelp'
import { stripAssemblyComment } from '../../../core/assembly/text'

export function describeM0Token(text: string, column: number, inspection: DebugInspection, value?: (name: string) => number | undefined): TokenDescription | null {
	if (column >= stripAssemblyComment(text, ['@', ';', '//']).length) return null
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
