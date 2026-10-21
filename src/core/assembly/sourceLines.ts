import { expandSources, type AssemblySource } from './sources'
import type { Position } from './tokens'
import { AssemblyError } from '../diagnostics'

export interface SourceLine { text: string, at: Position }

export function resolveRelativeSource(files: readonly AssemblySource[], name: string, from: AssemblySource): AssemblySource | undefined {
	const path = from.name.slice(0, from.name.lastIndexOf('/') + 1) + name
	return files.find(file => file.name === path) ?? files.find(file => file.name === name)
}

/** Statement frontends can request an include after reading labels/directives.
 * They share the same iterative traversal and safeguards as token frontends. */
export function visitSourceLines(
	files: readonly AssemblySource[], entry: string,
	limits: { expansions: number, depth: number, lines: number },
	visit: (line: SourceLine) => string | undefined,
): void {
	const source = files.find(file => file.name === entry)
	if (!source) throw new Error(`Source '${entry}' not found`)
	let lines = 0
	expandSources<SourceLine>([source], {
		tokenize: source => source.code.split(/\r?\n/).map((text, index) => ({ text, at: { file: source.name, line: index + 1, column: 1 } })),
		readInclude: (tokens, index) => {
			if (++lines > limits.lines) throw new Error('Expanded source line limit exceeded')
			const name = visit(tokens[index])
			return name === undefined ? null : { name, nextIndex: index + 1 }
		},
		resolve: (name, from, token) => {
			const target = resolveRelativeSource(files, name, from)
			if (!target) throw new AssemblyError(`Source '${name}' not found`, token.at)
			return target
		},
		identity: source => source.name,
		includeOnce: false,
		maxFileExpansions: limits.expansions,
		maxDepth: limits.depth,
		cycle: (source, _chain, token) => new AssemblyError(`Recursive include '${source.name}'`, token?.at),
		limit: (_source, token) => new AssemblyError('Source include expansion/depth limit exceeded', token?.at),
		boundary: () => [],
		emit: () => {},
	})
}
