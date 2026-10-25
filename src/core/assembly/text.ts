export interface CommentSyntax {
	line: readonly string[]
	block?: readonly [open: string, close: string]
	/** GNU character constants permit an omitted closing apostrophe. */
	singleQuotes?: 'string' | 'character'
	/** Z80 register names may end in an apostrophe. */
	identifierApostrophes?: boolean
}

function quotedEnd(text: string, start: number, syntax: CommentSyntax): number {
	const quote = text[start]
	let end = start + 1
	if (quote === "'" && syntax.singleQuotes === 'character') {
		if (text[end] === '\\') end++
		end++
		if (text[end] === "'") end++
	} else {
		while (end < text.length && text[end] !== quote && text[end] !== '\n' && text[end] !== '\r') end += text[end] === '\\' ? 2 : 1
		if (text[end] === quote) end++
	}
	return Math.min(end, text.length)
}

/** Shared lexical walk; callers choose truncation or offset-preserving masking. */
function scanComments(text: string, syntax: CommentSyntax, mask: boolean): string {
	const parts: string[] = []
	let index = 0, copied = 0
	while (index < text.length) {
		const char = text[index]
		if (char === '"' || (char === "'" && !(syntax.identifierApostrophes && /\w/.test(text[index - 1] ?? '')))) {
			index = quotedEnd(text, index, syntax)
			continue
		}
		let end: number
		if (syntax.line.some(marker => text.startsWith(marker, index))) {
			if (!mask) return text.slice(0, index)
			end = index
			while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++
		} else if (syntax.block && text.startsWith(syntax.block[0], index)) {
			const close = text.indexOf(syntax.block[1], index + syntax.block[0].length)
			end = close < 0 ? text.length : close + syntax.block[1].length
		} else {
			index++
			continue
		}
		parts.push(text.slice(copied, index), text.slice(index, end).replace(/[^\r\n]/g, ' '))
		copied = index = end
	}
	return parts.length ? parts.join('') + text.slice(copied) : text
}

/** Dialect-selected comments; quoted markers and escaped quotes remain literal. */
export function stripAssemblyComment(text: string, markers: readonly string[], identifierApostrophes = false): string {
	return scanComments(text, { line: markers, identifierApostrophes }, false)
}

/** Blank comments without moving source offsets, columns or line endings. */
export function maskAssemblyComments(text: string, syntax: CommentSyntax): string {
	return scanComments(text, syntax, true)
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
