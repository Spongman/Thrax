/**
 * The MARS dialect of the common assembler.
 *
 * MARS syntax (lexer, macros, parser), pseudo-instruction lowering and the
 * MIPS encodings are supplied here; source traversal, sections and layout,
 * symbol scopes, label resolution, byte emission, source mappings and
 * diagnostic ordering are the engine's (`src/core/assembly`).
 */

import { assembleStatements, defaultLimits, StatementKind, type AssemblerConfig, type HookContext, type Statement } from '../../../core/assembly/assembler'
import { DiagnosticLog } from '../../../core/assembly/diagnosticLog'
import type { AssemblyImage, Provenance } from '../../../core/assembly/emitter'
import { ExprKind, Op, type Arithmetic, type Expr } from '../../../core/assembly/expressions'
import { expandSources, type AssemblySource } from '../../../core/assembly/sources'
import type { Position } from '../../../core/assembly/tokens'
import { AssemblyError, at, atInstruction } from '../../../core/diagnostics'
import { buildSourceIndex, EMPTY_SOURCE_INDEX } from '../../../core/sourceIndex'
import type { DataEntry, DataValue, Diagnostic, LabelArgument, LabelRef, MipsInstruction, MipsProgram, Segment, SymbolTables, TokenData } from '../../../core/types'
import { MEMORY_CONFIGURATIONS, type MemoryConfigurationValues } from '../memoryConfigurations'
import { Encoder } from './encoder'
import { Lexer } from './lexer'
import { expandMacros } from './macros'
import { highHalf, validateInstruction } from './operands'
import { ItemKind, Parser, type Item, type ParseResult } from './parser'
import { expandInstruction, type ExpansionSettings } from './pseudo'

/** One translation unit; several are assembled together into one program. */
export type SourceFile = AssemblySource

/** What one assembly produced; `program` and `machineCode` stand only when no diagnostic is an error. */
export interface AssembleResult {
	program: MipsProgram
	machineCode: number[]
	diagnostics: Diagnostic[]
	/** The engine's addressed bytes and instruction mappings; null when nothing was laid out. */
	image: AssemblyImage | null
}

export interface AssemblerOptions {
	/** Pseudo-ops that branch over a delay slot of their own emit one. Off by default. */
	delayedBranching?: boolean
	/**
	 * Extended assembly, on by default.  Off, only the basic forms of the isa
	 * table assemble: a pseudo-instruction or an extended operand form is an
	 * error.
	 */
	extendedAssembler?: boolean
	/** Off by default.  On, a warning fails the assembly the way an error does. */
	warningsAreErrors?: boolean
	/** Where each segment lays out; the SPIM-derived default when unset. */
	memory?: MemoryConfigurationValues
}

/**
 * The order a sequential MARS assembler finds faults in: the lexer's warnings,
 * then expansion, then the `la` halves, data labels, and encoding.  Layout
 * interleaves the last three, so diagnostics are logged by phase.
 */
class Phase {
	static readonly Lex = 0
	static readonly Expand = 1
	static readonly Halves = 2
	static readonly Data = 3
	static readonly Encode = 4
}

/** Engine location counters, one per MARS segment plus the extern region. */
const Text = 0
const Data = 1
const KernelText = 2
const KernelData = 3
const Extern = 4
const SECTION: Record<Segment, number> = { text: Text, data: Data, ktext: KernelText, kdata: KernelData }

const { Label, Origin, Align, Section, Scope, Fragment } = StatementKind
const number = (value: number): Expr => ({ kind: ExprKind.Number, value })
const DOT_PLUS = (size: number): Expr => ({ kind: ExprKind.Binary, op: Op.Add, left: { kind: ExprKind.Dot }, right: number(size), at: NOWHERE })
const NOWHERE: Position = { file: '', line: 0, column: 0 }

/** MARS adds label offsets as plain numbers; nothing else reaches the engine. */
const marsArithmetic: Arithmetic = {
	unary(op, value) {
		if (op === Op.Neg) return -value
		if (op === Op.Plus) return value
		throw new Error(`Unsupported unary operator ${op}`)
	},
	binary(op, left, right) {
		if (op === Op.Add) return left + right
		if (op === Op.Sub) return left - right
		throw new Error(`Unsupported binary operator ${op}`)
	},
}

/**
 * The engine configured for MARS: four segments and the extern region,
 * little-endian, data alignment padding left unwritten, and no limit beyond
 * the ones MARS itself has, so no source is newly rejected.
 */
export function marsConfig(memory: MemoryConfigurationValues): AssemblerConfig {
	const sections = []
	sections[Text] = { start: memory.textBaseAddress }
	// Data is loaded after text, so data wins where the two overlap.
	sections[Data] = { start: memory.dataBaseAddress, layer: 1 }
	sections[KernelText] = { start: memory.kernelTextBaseAddress }
	sections[KernelData] = { start: memory.kernelDataBaseAddress, layer: 1 }
	sections[Extern] = { start: memory.externBaseAddress }
	return {
		arithmetic: marsArithmetic,
		checkValue: (value) => value,
		littleEndian: true,
		defaultAlignment: 4,
		originMayDecrease: true,
		entryAddress: memory.textBaseAddress,
		isInstructionMacro: () => false,
		limits: {
			...defaultLimits,
			addressBase: Number.MIN_SAFE_INTEGER,
			addressLimit: Number.MAX_SAFE_INTEGER,
			fractionalOrigins: true,
			maxBytes: Infinity,
			diagnostics: Infinity,
		},
		sections,
		overwrite: true,
		addressModulus: 2 ** 32,
	}
}

/** The program of a source that never got as far as being parsed. */
function emptyProgram(): MipsProgram {
	return {
		instructions: [],
		labels: new Map(),
		symbols: { locals: new Map(), globals: new Map() },
		symbolSites: new Map(),
		data: [],
		sourceIndex: EMPTY_SOURCE_INDEX,
	}
}

/**
 * Every symbol in one map, for naming an address and for finding the entry
 * point.  A global name wins, since it is the one every file agrees on.
 */
function flattenSymbols(symbols: SymbolTables): Map<string, number> {
	const flat = new Map<string, number>()
	for (const table of symbols.locals.values()) {
		for (const [name, address] of table) if (!flat.has(name)) flat.set(name, address)
	}
	for (const [name, address] of symbols.globals) flat.set(name, address)
	return flat
}

/** Lexes every entry file using the MARS include policy and shared source traversal. */
export function tokenizeFiles(files: readonly SourceFile[], entries: readonly SourceFile[], log = new DiagnosticLog()): TokenData[] {
	const tokens = expandSources<TokenData>(entries, {
		identity: (file) => file.name,
		includeOnce: true,
		// Include-once limits expansion to the available files without imposing
		// a new source restriction or depending on the host recursion limit.
		maxFileExpansions: files.length,
		tokenize: (file, root) => {
			const lexer = new Lexer(file.code, file.name)
			const tokens = lexer.tokenize()
			for (const diagnostic of lexer.diagnostics) log.add(diagnostic, Phase.Lex, false)
			return tokens.filter((token) => token.type !== 'EOF').map((token) => ({ ...token, unit: root.name }))
		},
		readInclude: (tokens, index) => {
			const token = tokens[index]
			if (token.type !== 'DIRECTIVE' || token.value.toLowerCase() !== '.include') return null
			const target = tokens[index + 1]
			if (!target || target.type !== 'STRING') {
				throw new AssemblyError('.include expects a file name', at(token))
			}
			return { name: target.value, nextIndex: index + 2 }
		},
		resolve: (name, _source, token) => {
			const basename = (name: string) => name.toLowerCase().replace(/^.*[\\/]/, '')
			const file = files.find((candidate) => candidate.name === name) ??
				files.find((candidate) => basename(candidate.name) === basename(name))
			if (!file) {
				const available = files.map((candidate) => candidate.name).join(', ')
				throw new AssemblyError(`Cannot include "${name}"; open files are: ${available}`, at(token))
			}
			return file
		},
		cycle: (file, chain, token) => new AssemblyError(`Recursive include of file ${file.name}: ${chain.join(' -> ')}`, at(token)),
		limit: (_file, token) => new AssemblyError('Source expansion exceeds the available file count', token ? at(token) : undefined),
		// Statements must not run together across a file boundary.
		boundary: (file, root) => [{ type: 'NEWLINE', value: '\n', line: 1, column: 1, file: file.name, unit: root.name }],
	})
	const last = tokens[tokens.length - 1]
	const entryFile = entries[0]?.name ?? ''
	tokens.push({ type: 'EOF', value: '', line: last ? last.line : 1, column: 1, file: last?.file ?? entryFile, unit: last?.unit ?? entryFile })
	return tokens
}

/**
 * Assembles MARS source.  A bare string is a single unnamed file; of several
 * files, all are assembled together unless `entryNames` narrows the set, and
 * the rest are reachable by `.include`.
 *
 * A fault in the source is reported, not thrown.  Lexing, macro expansion and
 * parsing stop at their first error, since nothing downstream of a broken
 * token stream is trustworthy; past that, every bad instruction is reported.
 */
export function assembleMips(source: string | SourceFile[], entryNames?: string[], options: AssemblerOptions = {}): AssembleResult {
	const files = typeof source === 'string' ? [{ name: '', code: source }] : source
	const entries = entryNames ? files.filter((file) => entryNames.includes(file.name)) : files
	const memory = options.memory ?? MEMORY_CONFIGURATIONS.default
	const promoteWarnings = options.warningsAreErrors ?? false
	const log = new DiagnosticLog()

	let parsed: ParseResult
	try {
		const tokens = expandMacros(tokenizeFiles(files, entries, log))
		// The entry files are the ones assembled in their own right; an
		// `.include` belongs to its includer.
		parsed = new Parser(tokens, new Set(entries.map((file) => file.name))).parse()
	} catch (error) {
		log.record(error, Phase.Expand)
		return { program: emptyProgram(), machineCode: [], diagnostics: log.collect({ promoteWarnings, sort: false }), image: null }
	}

	const settings: ExpansionSettings = { delayedBranching: options.delayedBranching ?? false, adjustedHighHalves: new Set() }
	const lowering = new Lowering(parsed, settings, options.extendedAssembler ?? true, log)
	for (const item of parsed.items) lowering.lower(item)
	const outcome = assembleStatements(lowering.statements, marsConfig(memory))
	for (const diagnostic of outcome.diagnostics) log.add(diagnostic, Phase.Encode)

	const own = (unit: string, name: string) => outcome.scopes.get(unit)?.own(name)
	const symbols: SymbolTables = { locals: new Map(parsed.units.map((unit) => [unit, new Map()])), globals: new Map() }
	for (const { name, unit } of [...lowering.dataBindings, ...lowering.textBindings]) {
		const address = own(unit, name)
		if (address !== undefined) symbols.locals.get(unit)!.set(name, address)
	}
	for (const name of lowering.externs) {
		const address = outcome.symbols.own(name)
		if (address !== undefined) symbols.globals.set(name, address)
	}
	// `.globl` moves a name out of its own file's table into the one every file sees.
	for (const [name, unit] of parsed.globalNames) {
		const table = symbols.locals.get(unit)
		const address = table?.get(name)
		if (address === undefined) continue
		table!.delete(name)
		symbols.globals.set(name, address)
	}

	const entryFile = entries[0]?.name ?? ''
	const program: MipsProgram = {
		instructions: lowering.instructions,
		labels: flattenSymbols(symbols),
		symbols,
		symbolSites: parsed.symbolSites,
		data: lowering.data,
		sourceIndex: buildSourceIndex(entryFile, lowering.instructions, lowering.data),
	}
	return { program, machineCode: lowering.machineCode, diagnostics: log.collect({ promoteWarnings, sort: true }), image: outcome.image }
}

/** Little-endian bytes of `width` from `value`, as memory holds them. */
function pushWord(bytes: number[], value: number, width: number) {
	for (let offset = 0; offset < width; offset++) bytes.push((value >>> (offset * 8)) & 0xff)
}

/**
 * Turns parsed MARS items into engine statements.  Labels are placed where
 * MARS binds them, at the next emission in their own segment; text expands to
 * basic instructions here, since expansion needs no label values.
 */
class Lowering {
	readonly statements: Statement[] = []
	readonly instructions: MipsInstruction[] = []
	readonly machineCode: number[] = []
	readonly data: DataEntry[] = []
	/** Labels in the order MARS binds them: data during parsing, text after expansion. */
	readonly dataBindings: LabelRef[] = []
	readonly textBindings: LabelRef[] = []
	readonly externs: string[] = []
	private section = -1
	private scope: string | null | undefined = undefined
	private context: HookContext | null = null
	private readonly encoder: Encoder

	constructor(
		private readonly parsed: ParseResult,
		private readonly settings: ExpansionSettings,
		private readonly extendedAssembler: boolean,
		private readonly log: DiagnosticLog,
	) {
		this.encoder = new Encoder((instruction, arg) => this.labelAddress(arg, () => atInstruction(this.encoder.currentInstruction)))
	}

	lower(item: Item) {
		switch (item.kind) {
			case ItemKind.Data: return this.lowerData(item.segment, item.align, item.labels, item.entry)
			case ItemKind.Align:
				this.enterSection(SECTION[item.segment])
				this.statements.push({ kind: Align, boundary: number(item.boundary), carry: true, skip: true, at: NOWHERE })
				return
			case ItemKind.Origin:
				this.enterSection(SECTION[item.segment])
				this.statements.push({ kind: Origin, value: number(item.address), at: item.at })
				return
			case ItemKind.Instruction: return this.lowerInstruction(item.instruction)
			case ItemKind.Extern:
				this.enterSection(Extern)
				this.enterScope(null)
				this.externs.push(item.name)
				this.statements.push({ kind: Label, name: item.name, at: NOWHERE })
				this.statements.push({ kind: Origin, value: DOT_PLUS(item.size), at: NOWHERE })
				return
			case ItemKind.EndLabels: {
				const text = item.segment === 'text' || item.segment === 'ktext'
				this.enterSection(SECTION[item.segment])
				this.bind(item.labels, !text)
				for (const label of item.labels) (text ? this.textBindings : this.dataBindings).push(label)
			}
		}
	}

	private enterSection(section: number) {
		if (section === this.section) return
		this.section = section
		this.statements.push({ kind: Section, section, at: NOWHERE })
	}

	private enterScope(scope: string | null) {
		if (scope === this.scope) return
		this.scope = scope
		this.statements.push({ kind: Scope, scope, at: NOWHERE })
	}

	/** Each label in its own unit's scope; a `.globl` name is also global. */
	private bind(labels: readonly LabelRef[], movable: boolean) {
		for (const { name, unit } of labels) {
			this.enterScope(unit)
			const exported = this.parsed.globalNames.get(name) === unit
			this.statements.push({ kind: Label, name, exported, movable, at: NOWHERE })
		}
	}

	/** A label operand's address in the current unit, or a positioned fault. */
	private labelAddress(arg: LabelArgument, position: () => ReturnType<typeof atInstruction>): number {
		const expr: Expr = { kind: ExprKind.Symbol, name: arg.value, at: NOWHERE }
		const address = this.context!.value(expr, false)
		if (address === undefined) throw new AssemblyError(`Undefined label: ${arg.value}`, position())
		return address + (arg.offset ?? 0)
	}

	private lowerData(segment: Segment, align: number, labels: LabelRef[], entry: DataEntry) {
		this.enterSection(SECTION[segment])
		// Automatic alignment carries labels already bound at the old address.
		if (align) this.statements.push({ kind: Align, boundary: number(align), carry: true, skip: true, at: NOWHERE })
		this.bind(labels, true)
		for (const label of labels) this.dataBindings.push(label)
		this.enterScope(entry.unit ?? '')
		this.data.push(entry)
		const size = entry.bytes.reduce<number>((total, item) => total + (typeof item === 'number' ? 1 : item.width), 0)
		this.statements.push({
			kind: Fragment,
			size,
			provenance: null,
			at: NOWHERE,
			encode: (context) => {
				this.context = context
				entry.address = context.dot
				return this.encodeData(entry, size)
			},
		})
	}

	/** Resolves a `.word label` operand where the file it was written in is still known. */
	private encodeData(entry: DataEntry, size: number): number[] {
		const position = { file: entry.sourceFile || undefined, line: entry.sourceLine }
		const bytes: number[] = []
		entry.bytes = entry.bytes.map((item): number | DataValue => {
			if (typeof item === 'number') {
				bytes.push(item & 0xff)
				return item
			}
			if (item.value.type !== 'label') {
				pushWord(bytes, item.value.value, item.width)
				return item
			}
			let address: number
			try {
				address = this.labelAddress(item.value, () => position)
			} catch (error) {
				this.log.record(error, Phase.Data)
				pushWord(bytes, 0, item.width)
				return item
			}
			pushWord(bytes, address, item.width)
			return { ...item, value: { type: 'immediate', value: address } }
		})
		if (bytes.length !== size) throw new Error('Data size changed after layout')
		return bytes
	}

	private lowerInstruction(instruction: MipsInstruction) {
		let sequence: MipsInstruction[]
		try {
			const expand = (target: MipsInstruction) => expandInstruction(target, this.settings)
			validateInstruction(instruction, this.extendedAssembler, expand)
			sequence = expand(instruction)
		} catch (error) {
			// The instruction emits nothing, and its labels are never bound.
			this.log.record(error, Phase.Expand)
			return
		}
		const segment = instruction.segment ?? 'text'
		this.enterSection(SECTION[segment])
		this.bind(instruction.labels, false)
		for (const label of instruction.labels) this.textBindings.push(label)
		this.enterScope(instruction.unit ?? '')
		sequence.forEach((item, index) => {
			item.labels = index === 0 ? [...instruction.labels] : []
			item.segment = segment
			item.sourceFile = instruction.sourceFile ?? ''
			item.unit = instruction.unit ?? ''
			item.sourceColumn = instruction.sourceColumn
			const slot = this.instructions.push(item) - 1
			this.machineCode.push(0)
			const provenance: Provenance = { kind: 'instruction', source: { file: item.sourceFile, line: item.sourceLine }, expansion: [] }
			this.statements.push({
				kind: Fragment,
				size: 4,
				provenance,
				at: NOWHERE,
				encode: (context) => {
					this.context = context
					item.address = context.dot
					const word = this.encode(item)
					this.machineCode[slot] = word
					const bytes: number[] = []
					pushWord(bytes, word, 4)
					return bytes
				},
			})
		})
	}

	/**
	 * `la` and the extended loads and stores leave `lui`/`ori` halves as labels
	 * until layout; they resolve first, so the encoder sees constants.
	 */
	private encode(instruction: MipsInstruction): number {
		const encoder = this.encoder
		encoder.currentInstruction = instruction
		try {
			if (instruction.name === 'LUI' && instruction.args[1]?.type === 'label') {
				const address = this.labelAddress(instruction.args[1], () => atInstruction(instruction))
				const value = this.settings.adjustedHighHalves.has(instruction) ? highHalf(address) : address >>> 16
				instruction.args[1] = { type: 'immediate', value }
			}
			if (instruction.name === 'ORI' && instruction.args[2]?.type === 'label') {
				instruction.args[2] = { type: 'immediate', value: this.labelAddress(instruction.args[2], () => atInstruction(instruction)) & 0xffff }
			}
		} catch (error) {
			this.log.record(error, Phase.Halves)
		}
		try {
			return encoder.encodeInstruction(instruction)
		} catch (error) {
			this.log.record(error, Phase.Encode)
			// One word per instruction either way, so the two stay in step.
			return 0
		}
	}
}
