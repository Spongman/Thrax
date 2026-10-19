/**
 * Which assembler dialect reads a file.  The extension decides: `.s` and `.S`
 * are GNU as, `.armasm` is armasm.  Any other name (`.asm`, a new file) is read
 * by its content when that is unmistakable, an indented AREA for armasm or a
 * GNU section or data directive, and otherwise by the architecture's setting.
 */

export const DIALECT_GNU = 0
export const DIALECT_ARMASM = 1

/** Setting values, indexed by dialect. */
export const DIALECT_IDS: readonly string[] = Object.freeze(['gnu', 'armasm'])
export const DIALECT_NAMES: readonly string[] = Object.freeze(['GNU as', 'armasm'])

export const dialectId = (id: string) => Math.max(0, DIALECT_IDS.indexOf(id))

export const GNU_EXTENSIONS: readonly string[] = Object.freeze(['.s', '.S'])
export const ARMASM_EXTENSION = '.armasm'

const AREA = /^[ \t]+AREA\b/im
const GNU_DIRECTIVE = /^[ \t]*(?:[A-Za-z_.$][\w.$]*:)?[ \t]*\.(?:text|data|bss|section|global|globl|word|long|ascii|asciz|string|byte|equ|set|ltorg)\b/m

export function dialectFor(name: string, code: string, fallback: number): number {
	const lower = name.toLowerCase()
	if (lower.endsWith(ARMASM_EXTENSION)) return DIALECT_ARMASM
	if (lower.endsWith('.s')) return DIALECT_GNU
	if (AREA.test(code)) return DIALECT_ARMASM
	if (GNU_DIRECTIVE.test(code)) return DIALECT_GNU
	return fallback
}
