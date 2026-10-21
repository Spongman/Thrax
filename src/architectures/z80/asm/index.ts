/** Z80 assembly on the shared engine: one translation unit, other files reached by INCLUDE. */

import { assembleStatements, defaultLimits, type AssemblerConfig, type AssemblerLimits } from '../../../core/assembly/assembler'
import type { AssemblyImage } from '../../../core/assembly/emitter'
import { expandSources, type AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, makeToken, positionOf, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../contracts'
import { MEMORY_BYTES } from '../cpu'
import { z80Arithmetic } from './arithmetic'
import { parseZ80 } from './parser'
import { tokenizeZ80 } from './tokenizer'

export { tokenizeZ80 } from './tokenizer'

export const z80Limits: AssemblerLimits = { ...defaultLimits, addressLimit: MEMORY_BYTES }

export function z80Config(limits: AssemblerLimits = z80Limits): AssemblerConfig {
	return {
		arithmetic: z80Arithmetic,
		checkValue(value, size, at) {
			const low = -(2 ** (8 * size - 1))
			const high = 2 ** (8 * size) - 1
			if (value < low || value > high) throw new AssemblyError(`Value ${value} does not fit in ${size * 8} bits`, at)
			return value
		},
		littleEndian: true,
		defaultAlignment: 1,
		originMayDecrease: true,
		// The Z80 resets to address 0.
		entryAddress: 0,
		isInstructionMacro: () => false,
		limits,
	}
}

export interface Z80AssemblyOptions {
	/** Workspace documents that INCLUDE may name; they are not assembled unless included. */
	files?: readonly AssemblySource[]
	maxFileExpansions?: number
	limits?: AssemblerLimits
}

export interface Z80AssemblyResult {
	image: AssemblyImage | null
	diagnostics: Diagnostic[]
	/** Every symbol's value, labels and EQUs alike. */
	values: ReadonlyMap<string, number>
}

const directory = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

function normalize(path: string): string {
	const parts: string[] = []
	for (const part of path.split('/')) {
		if (part === '..') parts.pop()
		else if (part !== '.' && part !== '') parts.push(part)
	}
	return parts.join('/')
}

const isInclude = (token: Token | undefined) => token?.kind === TokenKind.Identifier && /^\.?include$/i.test(token.text)

export function assembleZ80(main: AssemblySource, options: Z80AssemblyOptions = {}): Z80AssemblyResult {
	const files = new Map((options.files ?? []).map((file) => [normalize(file.name), file]))
	files.set(normalize(main.name), main)
	const fail = (diagnostics: Diagnostic[]): Z80AssemblyResult => ({ image: null, diagnostics, values: new Map() })

	let tokens: Token[]
	try {
		tokens = expandSources<Token>([main], {
			tokenize: (source) => tokenizeZ80(source),
			readInclude: (stream, index) => {
				const name = stream[index + 1]
				if (!isInclude(stream[index]) || name?.string === undefined) return null
				return { name: name.string, nextIndex: index + 2 }
			},
			resolve: (name, from, token) => {
				const found = files.get(normalize(name)) ?? files.get(normalize(directory(from.name) + name))
				if (!found) throw new AssemblyError(`File not found: ${name}`, positionOf(token))
				return found
			},
			identity: (source) => source.name,
			includeOnce: false,
			maxFileExpansions: options.maxFileExpansions ?? 256,
			cycle: (source, chain, token) => new AssemblyError(`Recursive include of ${source.name}: ${chain.join(' -> ')}`, positionOf(token)),
			limit: (source, token) => new AssemblyError(`Too many included files at ${source.name}`, token ? positionOf(token) : undefined),
			boundary: (source) => {
				const lines = source.code.split('\n')
				return [makeToken(TokenKind.Newline, '\n', source.name, lines.length, lines[lines.length - 1].length + 1, 1)]
			},
		})
	} catch (error) {
		if (!(error instanceof AssemblyError)) throw error
		return fail([error.diagnostic])
	}

	const parsed = parseZ80(tokens)
	if (parsed.diagnostics.length) return fail(parsed.diagnostics)
	const outcome = assembleStatements(parsed.statements, z80Config(options.limits))
	const values = new Map<string, number>()
	for (const [name, value] of outcome.symbols.entries()) if (value !== undefined) values.set(name, value)
	return { image: outcome.image, diagnostics: outcome.diagnostics, values }
}
