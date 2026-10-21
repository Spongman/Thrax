/** A named source document; resolution and include syntax belong to the dialect. */
export interface AssemblySource { name: string; code: string }

export interface SourceExpansionPolicy<Token> {
	/** Tokens exclude end-of-file markers. The root identifies the translation unit. */
	tokenize(source: AssemblySource, root: AssemblySource): readonly Token[]
	/** Return the first token index after the include, or null for an ordinary token. */
	readInclude(tokens: readonly Token[], index: number): { name: string; nextIndex: number } | null
	/** Resolve a name or throw a positioned dialect diagnostic. */
	resolve(name: string, source: AssemblySource, token: Token): AssemblySource
	/** Stable identity used for deduplication and cycle detection. */
	identity(source: AssemblySource): string
	includeOnce: boolean
	/** Bounds repeated expansion even for acyclic graphs. Must be a nonnegative safe integer. */
	maxFileExpansions: number
	/** Optional dialect depth bound in addition to the expansion count. */
	maxDepth?: number
	cycle(source: AssemblySource, chain: readonly string[], token: Token): Error
	limit(source: AssemblySource, token: Token | undefined): Error
	/** Separates statements across file boundaries when the dialect requires it. */
	boundary(source: AssemblySource, root: AssemblySource): readonly Token[]
	/** Streaming statement visitors can consume ordinary tokens without retaining them. */
	emit?(token: Token): void
}

/**
 * Splice source streams without depending on an ISA, token grammar, or symbol scope.
 * An explicit stack avoids host call-stack limits for deep include chains. Cycles
 * are checked before include-once suppression, so recursive input is diagnosed.
 */
export function expandSources<Token>(
	entries: readonly AssemblySource[],
	policy: SourceExpansionPolicy<Token>,
): Token[] {
	if (!Number.isSafeInteger(policy.maxFileExpansions) || policy.maxFileExpansions < 0) {
		throw new RangeError('maxFileExpansions must be a nonnegative safe integer')
	}
	if (policy.maxDepth !== undefined && (!Number.isSafeInteger(policy.maxDepth) || policy.maxDepth < 0)) throw new RangeError('maxDepth must be a nonnegative safe integer')
	interface Frame {
		source: AssemblySource
		root: AssemblySource
		id: string
		tokens: readonly Token[]
		index: number
	}
	const output: Token[] = []
	const seen = new Set<string>()
	const active = new Set<string>()
	const stack: Frame[] = []
	let expansions = 0

	const enter = (source: AssemblySource, root: AssemblySource, token?: Token) => {
		const id = policy.identity(source)
		if (active.has(id)) {
			const start = stack.findIndex((frame) => frame.id === id)
			throw policy.cycle(source, [...stack.slice(start).map((frame) => frame.id), id], token!)
		}
		if (policy.includeOnce && seen.has(id)) return
		if (expansions >= policy.maxFileExpansions || (policy.maxDepth !== undefined && stack.length >= policy.maxDepth)) throw policy.limit(source, token)
		expansions += 1
		seen.add(id)
		active.add(id)
		stack.push({ source, root, id, tokens: policy.tokenize(source, root), index: 0 })
	}

	for (const entry of entries) {
		enter(entry, entry)
		while (stack.length) {
			const frame = stack[stack.length - 1]
			if (frame.index === frame.tokens.length) {
				for (const token of policy.boundary(frame.source, frame.root)) {
					if (policy.emit) policy.emit(token)
					else output.push(token)
				}
				active.delete(frame.id)
				stack.pop()
				continue
			}
			const token = frame.tokens[frame.index]
			const include = policy.readInclude(frame.tokens, frame.index)
			if (!include) {
				if (policy.emit) policy.emit(token)
				else output.push(token)
				frame.index += 1
				continue
			}
			if (!Number.isInteger(include.nextIndex) || include.nextIndex <= frame.index || include.nextIndex > frame.tokens.length) {
				throw new RangeError('Include parser must advance within the token stream')
			}
			frame.index = include.nextIndex
			enter(policy.resolve(include.name, frame.source, token), frame.root, token)
		}
	}
	return output
}
