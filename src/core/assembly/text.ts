/** Dialect-selected comments; quoted markers and escaped quotes remain literal. */
export function stripAssemblyComment(text: string, markers: readonly string[], identifierApostrophes = false): string {
	let quote = ''
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		if (quote) {
			if (char === '\\') index++
			else if (char === quote) quote = ''
		} else if (char === '"' || (char === "'" && !(identifierApostrophes && /[\w]/.test(text[index - 1] ?? '')))) quote = char
		else if (markers.some(marker => text.startsWith(marker, index))) return text.slice(0, index)
	}
	return text
}

export interface OperandSyntax {
	/** Pairs whose contents may contain commas. */
	brackets: readonly string[]
	/** Dialects can supply their established diagnostic text. */
	unclosed: string
}

export function splitOperands(text: string, syntax: OperandSyntax): string[] {
	const result: string[] = [], stack: string[] = []
	let quote = '', start = 0
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		if (quote) {
			if (char === '\\') index++
			else if (char === quote) quote = ''
			continue
		}
		if (char === '"' || char === "'") quote = char
		else {
			const pair = syntax.brackets.find(pair => pair[0] === char)
			if (pair) stack.push(pair[1])
			else if (syntax.brackets.some(pair => pair[1] === char)) {
				if (stack.pop() !== char) throw new Error(syntax.unclosed)
			} else if (char === ',' && stack.length === 0) {
				result.push(text.slice(start, index).trim())
				start = index + 1
			}
		}
	}
	if (quote || stack.length) throw new Error(syntax.unclosed)
	if (text.trim()) result.push(text.slice(start).trim())
	return result
}
