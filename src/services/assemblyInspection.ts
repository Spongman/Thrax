import type { DebugInspection, RegisterValue, TokenDescription } from '../architectures/contracts'
import { stripAssemblyComment } from '../core/assembly/text'

export interface TokenInspection {
	tokens: RegExp
	comments: readonly string[]
	ignoreLine?(text: string): boolean
	register(token: string): string | undefined
	registerText(token: string, id: string, value: RegisterValue): string
	labelText(token: string, address: number): string
	help(token: string): Pick<TokenDescription, 'contents' | 'reference'> | null
}

/** Token/range selection and lookup are shared; spelling, widths and syntax are native. */
export function inspectAssemblyToken(text: string, offset: number, state: DebugInspection, syntax: TokenInspection): TokenDescription | null {
	if (syntax.ignoreLine?.(text) || offset >= stripAssemblyComment(text, syntax.comments).length) return null
	for (const match of text.matchAll(syntax.tokens)) {
		if (offset < match.index || offset >= match.index + match[0].length) continue
		const token = match[0], span = { start: match.index, length: token.length }
		const register = syntax.register(token)
		const value = register === undefined ? undefined : state.registers[register]
		if (value !== undefined) return { ...span, register, contents: [syntax.registerText(token, register!, value)] }
		const address = state.labels.get(token)
		if (address !== undefined) return { ...span, address, contents: [syntax.labelText(token, address)] }
		const help = syntax.help(token)
		return help ? { ...span, ...help } : null
	}
	return null
}
