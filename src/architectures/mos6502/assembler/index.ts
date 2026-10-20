/**
 * The 6502 dialect on the shared engine: ca65's syntax for what it covers,
 * one translation unit with `.include`, and the RESET vector filled in when
 * the program leaves it out.
 */

import { assembleStatements, defaultLimits, type AssemblerConfig, type AssemblerLimits } from '../../../core/assembly/assembler'
import type { AssemblyImage } from '../../../core/assembly/emitter'
import { Op, type Arithmetic } from '../../../core/assembly/expressions'
import { expandSources, type AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, makeToken, positionOf, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../../core/types'
import { VECTOR_RESET } from '../cpu'
import { OP_HIGH, OP_LOW, parseMos6502, type Mos6502ParseState } from './parser'
import { tokenizeMos6502 } from './tokenizer'
import type { CpuModel } from '../isa'

export { mos6502ExpressionSyntax, parseMos6502 } from './parser'
export { tokenizeMos6502 } from './tokenizer'

/** Where code goes when the program sets no origin: past the zero page, stack and display. */
export const DEFAULT_ORIGIN = 0x0600

const { Add, Sub, Mul, Div, And, Or, Xor, Shl, Shr, Neg, Not, Plus } = Op

/** Integers of any size; ranges are checked where a value is stored. */
export const mos6502Arithmetic: Arithmetic = {
	unary(op, value) {
		switch (op) {
			case Neg: return -value
			case Not: return ~value
			case Plus: return value
			case OP_LOW: return value & 0xFF
			case OP_HIGH: return (value >> 8) & 0xFF
		}
		throw new Error(`Unsupported unary operator ${op}`)
	},
	binary(op, left, right, at) {
		switch (op) {
			case Add: return left + right
			case Sub: return left - right
			case Mul: return left * right
			case Div:
				if (right === 0) throw new AssemblyError('Division by zero', at)
				return Math.trunc(left / right)
			case And: return left & right
			case Or: return left | right
			case Xor: return left ^ right
			case Shl: return left << right
			case Shr: return left >> right
		}
		throw new Error(`Unsupported binary operator ${op}`)
	},
}

export function mos6502Config(limits: AssemblerLimits = { ...defaultLimits, addressLimit: 0x10000, maxBytes: 0x20000 }): AssemblerConfig {
	return {
		arithmetic: mos6502Arithmetic,
		checkValue(value, size, at) {
			const bits = 8 * size
			if (!Number.isInteger(value) || value < -(2 ** (bits - 1)) || value >= 2 ** bits) {
				throw new AssemblyError(`${value} does not fit in ${size === 1 ? 'a byte' : `${size} bytes`}`, at)
			}
			return value < 0 ? value + 2 ** bits : value
		},
		littleEndian: true,
		defaultAlignment: 1,
		originMayDecrease: true,
		entryAddress: null,
		isInstructionMacro: () => false,
		limits,
		sections: [{ start: DEFAULT_ORIGIN }],
	}
}

export interface Mos6502AssemblyOptions {
	model?: CpuModel
	/** Workspace documents that `.include` may name; they are not assembled unless included. */
	files?: readonly AssemblySource[]
	maxFileExpansions?: number
}

export interface Mos6502AssemblyResult {
	image: AssemblyImage | null
	diagnostics: Diagnostic[]
	/** Every symbol's value, labels and assignments alike. */
	values: ReadonlyMap<string, number>
	breakpoints: number[]
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

const covers = (sections: AssemblyImage['sections'], address: number) =>
	sections.some((section) => address >= section.address && address < section.address + section.bytes.length)

/** Assemble one translation unit; other files take part only through `.include`. */
export function assembleMos6502(main: AssemblySource, options: Mos6502AssemblyOptions = {}): Mos6502AssemblyResult {
	const state: Mos6502ParseState = { breakpoints: [], firstInstruction: null }
	const fail = (diagnostics: Diagnostic[]): Mos6502AssemblyResult => ({ image: null, diagnostics, values: new Map(), breakpoints: [] })
	const files = new Map((options.files ?? []).map((file) => [normalize(file.name), file]))
	files.set(normalize(main.name), main)

	let tokens: Token[]
	try {
		tokens = expandSources<Token>([main], {
			tokenize: (source) => tokenizeMos6502(source),
			readInclude: (stream, index) => {
				const token = stream[index]
				const name = stream[index + 1]
				if (token.kind !== TokenKind.Identifier || token.text.toLowerCase() !== '.include' || name?.kind !== TokenKind.String) return null
				return { name: name.string!, nextIndex: index + 2 }
			},
			resolve: (name, from, token) => {
				const found = files.get(normalize(directory(from.name) + name)) ?? files.get(normalize(name))
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

	const parsed = parseMos6502(tokens, state, options.model)
	if (parsed.diagnostics.length) return fail(parsed.diagnostics)
	const outcome = assembleStatements(parsed.statements, mos6502Config())
	if (!outcome.image) return fail(outcome.diagnostics)
	const values = new Map<string, number>()
	for (const [name, value] of outcome.symbols.entries()) if (value !== undefined) values.set(name, value)

	const image = outcome.image
	let sections = image.sections
	// A program that sets no RESET vector starts at its first instruction.
	if (!covers(sections, VECTOR_RESET) && !covers(sections, VECTOR_RESET + 1)) {
		const entry = state.firstInstruction ?? DEFAULT_ORIGIN
		sections = [...sections, { address: VECTOR_RESET, bytes: Uint8Array.of(entry & 0xFF, entry >> 8) }].sort((left, right) => left.address - right.address)
	}
	const reset = (address: number) => {
		const section = sections.find((candidate) => address >= candidate.address && address < candidate.address + candidate.bytes.length)
		return section ? section.bytes[address - section.address] : 0
	}
	const entryAddress = reset(VECTOR_RESET) | (reset(VECTOR_RESET + 1) << 8)
	return {
		image: { ...image, sections, entryAddress },
		diagnostics: outcome.diagnostics,
		values,
		breakpoints: state.breakpoints,
	}
}
