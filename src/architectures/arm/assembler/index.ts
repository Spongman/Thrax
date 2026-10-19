/**
 * The ARM assembler: either dialect, through the shared engine.
 *
 * Code assembles from `textBase`.  The data section follows the code: it is
 * placed at a probe address first, then at the first word after the code the
 * probe measured, and again if the code grew (a literal that a MOV built at
 * one address can need a pool word at another).  A target with a fixed data
 * address gives it as `dataBase` instead.
 */

import { assembleStatements, defaultLimits, StatementKind, type AssemblerConfig, type AssemblyOutcome, type Statement } from '../../../core/assembly/assembler'
import type { AssemblyImage } from '../../../core/assembly/emitter'
import { expandSources, type AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, positionOf, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../../core/types'
import { DIALECT_ARMASM, DIALECT_GNU, dialectFor } from './dialect'
import { newlineAfter, parseArm, SECTION_TEXT } from './parser'
import { armArithmetic, checkDataValue } from './syntax'
import { tokenizeArm } from './tokenizer'

export { DIALECT_ARMASM, DIALECT_GNU, dialectFor } from './dialect'

export interface ArmAssemblyOptions {
	/** Workspace files `.include` may name. */
	files?: readonly AssemblySource[]
	/** Forces a dialect; otherwise the main file's name and content choose. */
	dialect?: number
	/** The dialect for a file neither its name nor its content decides. */
	fallbackDialect?: number
	/** Where code starts. */
	textBase: number
	/** Exclusive end of the address space. */
	addressLimit: number
	/** Symbols defined before the program, which SWI "name" also looks up. */
	predefined?: ReadonlyMap<string, number>
	/** The symbol whose address is the entry in GNU code, when defined; `_start` by default. */
	entrySymbol?: string
	/** The ARCH_* profile whose instructions are accepted; ARMv2a when absent. */
	arch?: number
	/** A fixed start for the data section; after the code when absent. */
	dataBase?: number
}

export interface ArmAssemblyResult {
	image: AssemblyImage | null
	diagnostics: Diagnostic[]
	/** Every symbol's value, labels and assignments alike. */
	values: ReadonlyMap<string, number>
	dialect: number
	/** Where the data section was placed, or null with none. */
	dataBase: number | null
}

const { Hook, Section } = StatementKind

/** Rounds of placing the data section before giving up. */
const MAX_ROUNDS = 4

const normalize = (path: string) => path.split('/').filter((part) => part && part !== '.').join('/')
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function valuesOf(outcome: AssemblyOutcome): Map<string, number> {
	const values = new Map<string, number>()
	for (const [name, value] of outcome.symbols.entries()) if (value !== undefined) values.set(name, value)
	return values
}

/** Assembles one translation unit: `main` and what it includes. */
export function assembleArm(main: AssemblySource, options: ArmAssemblyOptions): ArmAssemblyResult {
	const dialect = options.dialect ?? dialectFor(main.name, main.code, options.fallbackDialect ?? DIALECT_GNU)
	const failed = (diagnostics: Diagnostic[]): ArmAssemblyResult => ({ image: null, diagnostics, values: new Map(), dialect, dataBase: null })
	const files = new Map((options.files ?? []).map((file) => [normalize(file.name), file]))
	files.set(normalize(main.name), main)
	const sources = new Map([...files.values()].map((file) => [file.name, file]))

	let tokens: Token[]
	try {
		tokens = expandSources<Token>([main], {
			tokenize: (source) => tokenizeArm(source, dialect),
			readInclude: (stream, index) => {
				const token = stream[index]
				const name = stream[index + 1]
				if (dialect === DIALECT_ARMASM || token.kind !== TokenKind.Identifier || token.text.toLowerCase() !== '.include' || name?.kind !== TokenKind.String) return null
				return { name: name.string!, nextIndex: index + 2 }
			},
			resolve: (name, from, token) => {
				const directory = from.name.slice(0, from.name.lastIndexOf('/') + 1)
				const found = files.get(normalize(name)) ?? files.get(normalize(directory + name)) ?? [...files.values()].find((file) => baseName(file.name) === baseName(name))
				if (!found) throw new AssemblyError(`File not found: ${name}`, positionOf(token))
				return found
			},
			identity: (source) => source.name,
			includeOnce: false,
			maxFileExpansions: 256,
			cycle: (source, chain, token) => new AssemblyError(`Recursive include of ${source.name}: ${chain.join(' -> ')}`, positionOf(token)),
			limit: (source, token) => new AssemblyError(`Too many included files at ${source.name}`, token ? positionOf(token) : undefined),
			boundary: (source) => [newlineAfter(source)],
		})
	} catch (error) {
		if (!(error instanceof AssemblyError)) throw error
		return failed([error.diagnostic])
	}

	const parsed = parseArm(tokens, { dialect, sources, predefined: options.predefined ?? new Map(), arch: options.arch })
	if (parsed.diagnostics.length) return failed(parsed.diagnostics)

	let textEnd = options.textBase
	const at = parsed.statements[0].at
	const statements: Statement[] = [
		...parsed.statements,
		{ kind: Section, section: SECTION_TEXT, at },
		{ kind: Hook, run: (context) => { if (context.emitting) textEnd = context.dot }, at },
	]
	const config = (dataBase: number): AssemblerConfig => ({
		arithmetic: armArithmetic,
		checkValue: checkDataValue,
		littleEndian: true,
		defaultAlignment: 4,
		originMayDecrease: true,
		entryAddress: null,
		isInstructionMacro: () => false,
		limits: { ...defaultLimits, addressLimit: options.addressLimit },
		sections: [{ start: options.textBase }, { start: dataBase }],
	})

	// With no data the second section is never used; anywhere will do.
	const fixed = options.dataBase !== undefined
	let dataBase = options.dataBase ?? (parsed.usesData ? Math.floor(options.addressLimit / 2) : options.textBase)
	let outcome = assembleStatements(statements, config(dataBase))
	// A failed layout leaves textEnd alone, which ends the rounds; an overlap moves it on.
	for (let round = 0; parsed.usesData && !fixed && round < MAX_ROUNDS; round++) {
		const placed = (textEnd + 3) & ~3
		if (round > 0 && placed <= dataBase) break
		dataBase = placed
		outcome = assembleStatements(statements, config(dataBase))
	}
	if (!outcome.image) return failed(outcome.diagnostics)
	if (parsed.usesData && textEnd > dataBase) {
		const message = fixed ? `The code runs past the data section at 0x${dataBase.toString(16)}` : `The code grew past the data section at 0x${dataBase.toString(16)}; layout did not settle`
		return failed([new AssemblyError(message).diagnostic])
	}

	const values = valuesOf(outcome)
	const entrySymbol = outcome.symbols.own(options.entrySymbol ?? '_start')
	const entryAddress = parsed.state.entry ?? (dialect === DIALECT_GNU ? entrySymbol : undefined) ?? options.textBase
	return {
		image: { ...outcome.image, entryAddress },
		diagnostics: [...outcome.diagnostics, ...parsed.warnings],
		values,
		dialect,
		dataBase: parsed.usesData ? dataBase : null,
	}
}
