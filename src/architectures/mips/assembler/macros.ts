/**
 * MARS macro syntax over the common macro table: `.macro name(%a, %b)` ...
 * `.end_macro`, and `.eqv`.  MARS macros are textual, so expansion rewrites
 * the token stream before parsing: definitions are removed and invocations are
 * replaced by their body with arguments substituted.
 */

import { MacroTable, type MacroDefinition } from '../../../core/assembly/macroEngine'
import { AssemblyError, at } from '../../../core/diagnostics'
import type { TokenData } from '../../../core/types'

const MAX_EXPANSION_DEPTH = 32
const ARGUMENT_SEPARATORS = ['COMMA', 'LPAREN', 'RPAREN', 'NEWLINE']

/** Splits a token stream into statements, each ending with its NEWLINE. */
function splitStatements(tokens: TokenData[]): TokenData[][] {
	const statements: TokenData[][] = []
	let current: TokenData[] = []

	for (const token of tokens) {
		if (token.type === 'EOF') break
		current.push(token)
		if (token.type === 'NEWLINE') {
			statements.push(current)
			current = []
		}
	}
	if (current.length > 0) statements.push(current)

	return statements
}

/** Index of the first token after any leading `label:` pairs. */
function skipLabels(tokens: TokenData[]): number {
	let index = 0
	while (tokens[index]?.type === 'LABEL' && tokens[index + 1]?.type === 'COLON') index += 2
	return index
}

/** One entry per macro argument; registers and negative numbers stay two tokens. */
function collectArguments(tokens: TokenData[]): TokenData[][] {
	const args: TokenData[][] = []

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		if (ARGUMENT_SEPARATORS.includes(token.type)) continue
		const next = tokens[index + 1]
		if ((token.type === 'DOLLAR' || token.type === 'MINUS') && next) {
			args.push([token, next])
			index += 1
			continue
		}
		args.push([token])
	}

	return args
}

const positionOf = (token: TokenData) => ({ file: token.file ?? '', line: token.line, column: token.column })

class MacroExpander {
	// A later definition with the same name and parameter count is ignored.
	private readonly macros = new MacroTable<TokenData>({ keepFirst: true, uniqueParameters: false })
	private readonly equivalences = new Map<string, TokenData[]>()
	private expansions = 0

	run(statements: TokenData[][], depth: number, site?: TokenData): TokenData[] {
		if (depth > MAX_EXPANSION_DEPTH) throw new AssemblyError('Macro expansion nested too deeply', site ? at(site) : {})
		const output: TokenData[] = []

		for (let index = 0; index < statements.length; index += 1) {
			const statement = statements[index]
			const head = statement[0]

			if (head?.type === 'DIRECTIVE' && head.value === '.macro') {
				index = this.defineMacro(statements, index)
			} else if (head?.type === 'DIRECTIVE' && head.value === '.end_macro') {
				throw new AssemblyError('.end_macro without .macro', at(head))
			} else if (head?.type === 'DIRECTIVE' && head.value === '.eqv') {
				this.defineEquivalence(statement)
			} else {
				for (const token of this.emit(statement, depth)) output.push(token)
			}
		}

		return output
	}

	/** Emits one statement, expanding it when it invokes a known macro. */
	private emit(statement: TokenData[], depth: number): TokenData[] {
		const tokens = this.substituteEquivalences(statement)
		const start = skipLabels(tokens)
		const head = tokens[start]
		if (head?.type !== 'IDENTIFIER') return tokens

		const args = collectArguments(tokens.slice(start + 1))
		const macro = this.macros.find(head.value, args.length)
		if (!macro) return tokens

		const labels = tokens.slice(0, start)
		const body = this.run(splitStatements(this.expandBody(macro, args, head)), depth + 1, head)
		return labels.length > 0 ? [...labels, { ...head, type: 'NEWLINE', value: '\n' }, ...body] : body
	}

	private expandBody(macro: MacroDefinition<TokenData>, args: TokenData[][], site: TokenData): TokenData[] {
		this.expansions += 1
		const suffix = `_M${this.expansions}`
		const localLabels = new Set(macro.body.filter((token) => token.type === 'LABEL').map((token) => token.value))
		const substitutions = new Map(macro.parameters.map((param, index) => [param, args[index]]))
		const output: TokenData[] = []

		for (const token of macro.body) {
			const argument = token.type === 'IDENTIFIER' ? substitutions.get(token.value) : undefined
			if (argument) {
				for (const item of argument) output.push({ ...item, line: site.line, column: site.column })
				continue
			}
			// Body labels are made unique per expansion.
			const local = (token.type === 'LABEL' || token.type === 'IDENTIFIER') && localLabels.has(token.value)
			output.push({ ...token, value: local ? token.value + suffix : token.value, line: site.line, column: site.column })
		}

		return output
	}

	/** Consumes a definition and returns the index of its `.end_macro` statement. */
	private defineMacro(statements: TokenData[][], index: number): number {
		const header = statements[index]
		const nameToken = header[1]
		if (nameToken?.type !== 'IDENTIFIER') throw new AssemblyError('.macro requires a name', at(header[0]))

		const parameters: string[] = []
		for (const token of header.slice(2)) {
			if (ARGUMENT_SEPARATORS.includes(token.type)) continue
			if (token.type !== 'IDENTIFIER' || !token.value.startsWith('%')) {
				throw new AssemblyError('Macro parameters must begin with %', at(token))
			}
			parameters.push(token.value)
		}

		const body: TokenData[] = []
		let cursor = index + 1
		for (; cursor < statements.length; cursor += 1) {
			const head = statements[cursor][0]
			if (head?.type === 'DIRECTIVE' && head.value === '.end_macro') break
			if (head?.type === 'DIRECTIVE' && head.value === '.macro') throw new AssemblyError('Nested .macro', at(head))
			for (const token of statements[cursor]) body.push(token)
		}
		if (cursor >= statements.length) throw new AssemblyError(`Unterminated .macro "${nameToken.value}"`, at(nameToken))

		this.macros.define({ name: nameToken.value, parameters, body, at: positionOf(nameToken) })
		return cursor
	}

	private defineEquivalence(statement: TokenData[]) {
		const nameToken = statement[1]
		if (nameToken?.type !== 'IDENTIFIER') throw new AssemblyError('.eqv requires a name', at(statement[0]))
		const value = statement.slice(2).filter((token) => token.type !== 'NEWLINE')
		if (value.length === 0) throw new AssemblyError('.eqv requires a replacement', at(nameToken))
		this.equivalences.set(nameToken.value, this.substituteEquivalences(value))
	}

	private substituteEquivalences(tokens: TokenData[]): TokenData[] {
		if (this.equivalences.size === 0) return tokens
		const output: TokenData[] = []

		for (const token of tokens) {
			const replacement = token.type === 'IDENTIFIER' ? this.equivalences.get(token.value) : undefined
			if (replacement) for (const item of replacement) output.push({ ...item, line: token.line, column: token.column })
			else output.push(token)
		}

		return output
	}
}

export function expandMacros(tokens: TokenData[]): TokenData[] {
	const expanded = new MacroExpander().run(splitStatements(tokens), 0)
	const last = tokens[tokens.length - 1]
	if (last?.type === 'EOF') expanded.push(last)
	return expanded
}
