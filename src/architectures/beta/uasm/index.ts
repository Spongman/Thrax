import { assembleStatements, defaultLimits, StatementKind, type AssemblerConfig, type AssemblerLimits, type AssemblyOutcome, type Statement } from '../../../core/assembly/assembler'
import type { AssemblyImage } from '../../../core/assembly/emitter'
import { ExprKind, Op, type Arithmetic } from '../../../core/assembly/expressions'
import { expandSources, type AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, makeToken, positionOf, type Position, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../../core/types'
import betaLibraryCode from './beta.uasm?raw'
import { parseUasm, type UasmDirectives, type UasmRelocation, type UasmSegment } from './parser'
import { tokenizeUasm } from './tokenizer'

export { parseUasm, uasmExpressionSyntax, type UasmDirectives } from './parser'
export { tokenizeUasm } from './tokenizer'

export const betaLibrary: AssemblySource = { name: 'bundled/beta.uasm', code: betaLibraryCode }

const { Add, Sub, Mul, Div, Mod, And, Or, Shl, Shr, Neg, Not, Plus } = Op

const unsigned = (value: number) => value < 0 ? value + 2 ** 32 : value

/**
 * BSim arithmetic: negative operands are read as unsigned 32-bit, + - * / wrap
 * to signed 32-bit, >> is logical, and % is therefore never negative.  Division
 * by zero is diagnosed where BSim yields 0 or NaN.
 */
export const uasmArithmetic: Arithmetic = {
	unary(op, value) {
		switch (op) {
			case Neg: return -value
			case Not: return ~value
			case Plus: return value
		}
		throw new Error(`Unsupported unary operator ${op}`)
	},
	binary(op, left, right, at) {
		const a = unsigned(left)
		const b = unsigned(right)
		switch (op) {
			case Add: return (a + b) | 0
			case Sub: return (a - b) | 0
			case Mul: return Math.imul(a, b)
			case Div:
				if (b === 0) throw new AssemblyError('Division by zero', at)
				return (a / b) | 0
			case Mod:
				if (b === 0) throw new AssemblyError('Modulo by zero', at)
				return a % b
			case And: return a & b
			case Or: return a | b
			case Shl: return a << b
			case Shr: return a >>> b
		}
		throw new Error(`Unsupported binary operator ${op}`)
	},
}

const instructionMacros = new Set(['betaop', 'betaopc'])

export function uasmConfig(limits: AssemblerLimits = defaultLimits): AssemblerConfig {
	return {
		arithmetic: uasmArithmetic,
		checkValue(value, _size, at) {
			if (value > 255) throw new AssemblyError(`Expression results must fit within one byte; ${value} is too large`, at)
			if (value < -128) throw new AssemblyError(`Expression results must fit within one byte; interpreted as a signed integer, ${value} is too negative`, at)
			return value
		},
		littleEndian: true,
		defaultAlignment: 4,
		originMayDecrease: false,
		// The Beta resets to address 0 in supervisor mode.
		entryAddress: 0,
		isInstructionMacro: (macro) => instructionMacros.has(macro.name),
		limits,
	}
}

export interface UasmOptions {
	/** Workspace documents that `.include` may name; they are not assembled unless included. */
	files?: readonly AssemblySource[]
	/** Bundled libraries, matched by base name after workspace paths. */
	libraries?: readonly AssemblySource[]
	maxFileExpansions?: number
	limits?: AssemblerLimits
}

export interface UasmResult {
	image: AssemblyImage | null
	diagnostics: Diagnostic[]
	directives: UasmDirectives
	/** Every kernel symbol's value, labels and assignments alike. */
	values: ReadonlyMap<string, number>
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const directory = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

function normalize(path: string): string {
	const parts: string[] = []
	for (const part of path.split('/')) {
		if (part === '..') parts.pop()
		else if (part !== '.' && part !== '') parts.push(part)
	}
	return parts.join('/')
}

/** Assemble one UASM translation unit; other files take part only through `.include`. */
export function assembleUasm(main: AssemblySource, options: UasmOptions = {}): UasmResult {
	const directives: UasmDirectives = { breakpoints: [], protection: [], options: {} }
	const files = new Map((options.files ?? []).map((file) => [normalize(file.name), file]))
	const libraries = options.libraries ?? [betaLibrary]
	files.set(normalize(main.name), main)

	const resolve = (name: string, from: AssemblySource, token: Token) => {
		const found = files.get(normalize(name))
			?? files.get(normalize(directory(from.name) + name))
			?? libraries.find((library) => baseName(library.name) === baseName(name))
		if (!found) throw new AssemblyError(`File not found: ${name}`, positionOf(token))
		return found
	}

	let tokens: Token[]
	try {
		tokens = expandSources<Token>([main], {
			tokenize: (source) => tokenizeUasm(source),
			readInclude: (stream, index) => {
				const token = stream[index]
				const name = stream[index + 1]
				if (token.kind !== TokenKind.Identifier || token.text !== '.include' || name?.kind !== TokenKind.String) return null
				return { name: name.string!, nextIndex: index + 2 }
			},
			resolve,
			identity: (source) => source.name,
			// BSim re-reads a file at every .include.
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
		return { image: null, diagnostics: [error.diagnostic], directives, values: new Map() }
	}

	const parsed = parseUasm(tokens, directives)
	if (parsed.diagnostics.length) return { image: null, diagnostics: parsed.diagnostics, directives, values: new Map() }
	const config = uasmConfig(options.limits)
	if (parsed.segments.length) {
		const { image, diagnostics, values } = assembleSegments(parsed.statements, parsed.segments, parsed.relocation, config)
		return { image, diagnostics, directives, values }
	}
	const outcome = assembleStatements(parsed.statements, config)
	return { image: outcome.image, diagnostics: outcome.diagnostics, directives, values: valuesOf(outcome) }
}

const { Label, Assign, Define, Align, Hook } = StatementKind

function valuesOf(outcome: AssemblyOutcome): Map<string, number> {
	const values = new Map<string, number>()
	for (const [name, value] of outcome.symbols.entries()) if (value !== undefined) values.set(name, value)
	return values
}

const assign = (name: string, value: number, at: Position): Statement => ({ kind: Assign, name, value: { kind: ExprKind.Number, value }, at })

/**
 * BSim's `.segment NAME` (bsim_workbook.min.js, the assembler's segment
 * statement): the kernel is everything before the first, and each segment
 * after it is a user-mode address space assembled from virtual address 0,
 * loaded at the next word-aligned physical address after the last. Segments
 * get their own symbols and fall back to the kernel's. The kernel gains
 * NAME_base, the physical address, and NAME_bounds, the size including the
 * alignment to the next segment, plus kernel_bounds.
 *
 * Here the kernel and each segment assemble separately: a segment sees the
 * macros defined before it and the kernel's symbols as assignments, and its
 * bytes and labels move to its base. Sizes cannot depend on symbol values, so
 * one round measures every base and bounds and a second assembles with them.
 * Labels appear in the image at their physical address; a segment's label
 * whose name another part also uses is listed as `NAME:label`.
 */
function assembleSegments(statements: readonly Statement[], segments: readonly UasmSegment[], relocation: UasmRelocation, config: AssemblerConfig) {
	const parts = [
		{ name: 'kernel', at: statements[0]?.at ?? segments[0].at, statements: statements.slice(0, segments[0].index) },
		...segments.map((segment, index) => ({ name: segment.name, at: segment.at, statements: statements.slice(segment.index, segments[index + 1]?.index ?? statements.length) })),
	]
	const layout = new Map<string, number>()
	for (const part of parts) {
		layout.set(`${part.name}_bounds`, 0)
		if (part.name !== 'kernel') layout.set(`${part.name}_base`, 0)
	}
	const fail = (diagnostics: Diagnostic[]) => ({ image: null, diagnostics, values: new Map<string, number>() })

	let outcomes: { outcome: AssemblyOutcome, base: number, size: number }[] = []
	for (const record of [false, true]) {
		relocation.record = record
		const sizes = outcomes.map((part) => part.size)
		outcomes = []
		let kernel = new Map<string, number>()
		let base = 0
		for (let index = 0; index < parts.length; index++) {
			const part = parts[index]
			const prefix: Statement[] = []
			if (index > 0) {
				// Earlier macros, then the kernel's symbols that the segment does not define.
				for (const earlier of parts.slice(0, index)) for (const statement of earlier.statements) if (statement.kind === Define) prefix.push(statement)
				const own = new Set(part.statements.flatMap((statement) => statement.kind === Label || statement.kind === Assign ? [statement.name] : []))
				for (const [name, value] of kernel) if (!own.has(name)) prefix.push(assign(name, value, part.at))
			} else {
				for (const [name, value] of layout) prefix.push(assign(name, value, part.at))
			}
			let end = 0
			const suffix: Statement[] = [{ kind: Hook, run: (context) => { if (context.emitting) end = context.dot }, at: part.at }]
			// BSim aligns at each `.segment`, so a segment's bounds include its padding.
			if (index < parts.length - 1) suffix.unshift({ kind: Align, boundary: null, at: part.at })
			relocation.offset = base
			const outcome = assembleStatements([...prefix, ...part.statements, ...suffix], config)
			if (!outcome.image) {
				relocation.offset = 0
				relocation.record = true
				return fail(outcome.diagnostics)
			}
			if (record && end !== sizes[index]) return fail([new AssemblyError(`Segment ${part.name} changed size between passes; layout did not converge`, part.at).diagnostic])
			if (index === 0) kernel = valuesOf(outcome)
			layout.set(`${part.name}_bounds`, end)
			outcomes.push({ outcome, base, size: end })
			base += end
			const next = parts[index + 1]
			if (next) layout.set(`${next.name}_base`, base)
		}
	}
	relocation.offset = 0

	const uses = new Map<string, number>()
	for (const { outcome } of outcomes) for (const { name } of outcome.image!.symbols) uses.set(name, (uses.get(name) ?? 0) + 1)
	const sections: AssemblyImage['sections'][number][] = []
	const symbols: AssemblyImage['symbols'][number][] = []
	const sourceMappings: AssemblyImage['sourceMappings'][number][] = []
	const diagnostics: Diagnostic[] = []
	// Kernel values, then what each segment defines that nothing before it did.
	const values = valuesOf(outcomes[0].outcome)
	outcomes.forEach(({ outcome, base }, index) => {
		const image = outcome.image!
		if (index === 0) {
			symbols.push(...image.symbols)
		} else {
			const scope = parts[index].name
			for (const { name, address } of image.symbols) {
				symbols.push({ name: uses.get(name)! > 1 ? `${scope}:${name}` : name, address: address + base, scope })
			}
			const own = new Set(parts[index].statements.flatMap((statement) => statement.kind === Label || statement.kind === Assign ? [statement.name] : []))
			for (const [name, value] of valuesOf(outcome)) if (own.has(name) && !values.has(name)) values.set(name, value)
		}
		for (const section of image.sections) sections.push({ address: section.address + base, bytes: section.bytes })
		for (const mapping of image.sourceMappings) sourceMappings.push({ ...mapping, address: mapping.address + base })
		diagnostics.push(...outcome.diagnostics)
	})
	const image: AssemblyImage = { sections, entryAddress: config.entryAddress, symbols, sourceMappings }
	return { image, diagnostics, values }
}
