/**
 * Source locations in console text, so an error line can be clicked.
 *
 * A diagnostic is printed the way gcc prints one, `file:line:column: error:`,
 * and that prefix at the start of a line is what is picked out.  Split out
 * from the component so the matching is testable without a DOM.
 */

export interface SourceLocation {
	file: string
	line: number
	column?: number
}

export type ConsolePart =
	| { kind: 'text', text: string }
	| { kind: 'location', text: string, location: SourceLocation }

/** `file:line:` or `file:line:column:` at the start of a line, before a message. */
const LOCATION = /^([^\s:]+):(\d+)(?::(\d+))?:(?= )/gm

export function splitLocations(output: string): ConsolePart[] {
	const parts: ConsolePart[] = []
	let last = 0
	for (const match of output.matchAll(LOCATION)) {
		const index = match.index
		if (index > last) parts.push({ kind: 'text', text: output.slice(last, index) })
		const [text, file, line, column] = match
		parts.push({ kind: 'location', text, location: { file, line: Number(line), column: column === undefined ? undefined : Number(column) } })
		last = index + text.length
	}
	if (last < output.length) parts.push({ kind: 'text', text: output.slice(last) })
	return parts
}
