/**
 * MIPS Assembler - Converts assembly code to machine code
 */

import { doubleToBits, fpRegisterNumber, cp0RegisterNumber, FP_REGISTER_COUNT, singleToBits } from './coprocessor'
import { AssemblyError, at, atInstruction, type SourcePosition } from './diagnostics'
import { basicForms, pseudoForms, type IsaOperandKind } from './isa'
import { Lexer } from './lexer'
import { expandMacros } from './macros'
import { Parser, type ParseResult } from './parser'
import { REGISTER_NAMES, registerNumber } from './registers'
import { MEMORY_CONFIGURATIONS, type MemoryConfigurationValues } from './settings'
import { buildSourceIndex, EMPTY_SOURCE_INDEX } from './sourceIndex'
import type { Diagnostic, ImmediateArgument, LabelArgument, MipsArgument, MipsInstruction, MipsProgram, SymbolTables, TextSegment, TokenData } from './types'

/** Instructions whose two-operand form repeats the destination as a source. */
const TWO_OPERAND_FORMS = new Set([
	'ADD', 'ADDU', 'ADDI', 'ADDIU', 'SUB', 'SUBU', 'SUBI', 'SUBIU',
	'AND', 'ANDI', 'OR', 'ORI', 'XOR', 'XORI', 'NOR', 'MUL', 'MULU',
	'SLT', 'SLTU', 'SLTI', 'SLTIU', 'ROL', 'ROR',
])

/** Instructions taking an `rt, offset(base)` operand pair. */
const LOAD_STORE_NAMES = new Set([
	'LW', 'LH', 'LHU', 'LB', 'LBU', 'SW', 'SH', 'SB',
	'LWL', 'LWR', 'SWL', 'SWR', 'LL', 'SC',
])

const COP0_OPCODE = 0x10
const COP1_OPCODE = 0x11

/** CP1 format field: single, double, and 32-bit integer. */
const FP_FORMAT_CODES: Record<string, number> = { S: 16, D: 17, W: 20 }
const FP_ARITHMETIC_FUNCTIONS: Record<string, number> = { ADD: 0, SUB: 1, MUL: 2, DIV: 3, SQRT: 4, ABS: 5, MOV: 6, NEG: 7 }
const FP_UNARY_OPERATIONS = new Set(['SQRT', 'ABS', 'MOV', 'NEG'])
const FP_CONVERT_FUNCTIONS: Record<string, number> = {
	'ROUND.W': 12,
	'TRUNC.W': 13,
	'CEIL.W': 14,
	'FLOOR.W': 15,
	'CVT.S': 32,
	'CVT.D': 33,
	'CVT.W': 36,
}
const FP_MEMORY_OPCODES: Record<string, number> = { LWC1: 0x31, LDC1: 0x35, SWC1: 0x39, SDC1: 0x3d }

/** One translation unit; several are assembled together into one program. */
export interface SourceFile { name: string; code: string }

/** What one assembly produced; `program` and `machineCode` stand only when no diagnostic is an error. */
export interface AssembleResult {
	program: MipsProgram
	machineCode: number[]
	diagnostics: Diagnostic[]
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

export interface AssemblerOptions {
	/**
	 * The delayed branching setting, off by default.  It only reaches the assembler through the pseudo-ops that branch over a delay
	 * slot of their own.
	 */
	delayedBranching?: boolean
	/**
	 * Extended assembly, on by default.  Off, only the basic forms of the isa
	 * table assemble: a pseudo-instruction or an extended operand form is an
	 * error.
	 */
	extendedAssembler?: boolean
	/**
	 * Off by default.  On, a warning fails the assembly the way an error does
	 *.
	 */
	warningsAreErrors?: boolean
	/** Where each segment lays out; the SPIM-derived default when unset. */
	memory?: MemoryConfigurationValues
}

/** Writes an operand back out the way it was written, for a diagnostic. */
function formatArgument(arg: MipsArgument): string {
	switch (arg.type) {
		case 'register': return arg.value
		case 'immediate': return String(arg.value)
		case 'label': return arg.offset ? `${arg.value}+${arg.offset}` : arg.value
		case 'string': return JSON.stringify(arg.value)
		case 'memory': return `${formatArgument(arg.offset)}(${arg.register})`
	}
}

/** An expanded instruction as source, so a diagnostic can name it. */
function formatInstruction(instruction: MipsInstruction): string {
	const args = instruction.args.map(formatArgument).join(',')
	return args ? `${instruction.name.toLowerCase()} ${args}` : instruction.name.toLowerCase()
}

/** Names an operand in an error message, without dumping its internals. */
function describeArgument(arg: MipsArgument | string | undefined): string {
	if (arg === undefined) return 'nothing'
	if (typeof arg === 'string') return arg
	if (arg.type === 'register') return `the register ${arg.value}`
	if (arg.type === 'immediate') return `the value ${arg.value}`
	if (arg.type === 'label') return `the label ${arg.value}`
	if (arg.type === 'string') return 'a string'
	if (arg.type === 'memory') return 'a memory operand'
	return 'that operand'
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

/** One accepted way of writing an instruction, from the isa table. */
interface Signature { operands: readonly IsaOperandKind[]; example: string }

/**
 * Operand forms THRAX accepts beyond the standard table.  Every instruction with a
 * two-operand form also takes a full 32-bit immediate, in the last slot of the
 * three-operand form and in the two-operand form itself, where `PseudoOps.txt`
 * enumerates only some of the combinations (`:96-124`).  `extendedAssembler`
 * off rejects them (A4).
 */
function thraxSignatures(name: string): Signature[] {
	if (!TWO_OPERAND_FORMS.has(name.toUpperCase())) return []
	const spelling = name.toLowerCase()
	return [
		{ operands: ['gpr', 'gpr', 'imm32'], example: `${spelling} $t1,$t2,100000` },
		{ operands: ['gpr', 'imm32'], example: `${spelling} $t1,100000` },
	]
}

/** Every form `name` accepts, basic ones first, as the isa table orders them. */
function signaturesFor(name: string): Signature[] {
	return [...basicForms(name), ...pseudoForms(name), ...thraxSignatures(name)]
}

/**
 * Inclusive range of each integer operand kind, following how an integer
 * literal: a shift amount is 0-31, and a value
 * outside a 16-bit field falls through to the 32-bit pseudo form instead.
 */
const IMMEDIATE_RANGES: Partial<Record<IsaOperandKind, readonly [number, number]>> = {
	imm3: [0, 7],
	imm5: [0, 31],
	imm16s: [-0x8000, 0x7fff],
	imm16u: [0, 0xffff],
	imm20: [0, 0xfffff],
	imm32: [-0x80000000, 0xffffffff],
}

/**
 * The halves an extended address is built from.  A load adds the low half back
 * signed, so bit 15 of the address borrows from the high half
 *.
 */
function highHalf(value: number): number {
	return (((value >> 16) + ((value >> 15) & 1)) & 0xffff) >>> 0
}

function lowHalf(value: number): number {
	return (value << 16) >> 16
}

function isGpr(name: string): boolean {
	return registerNumber(name) !== null
}

/** `$f0`-`$f31`; a bare number names a general register, not this file. */
function isFpr(name: string): boolean {
	const match = /^\$f(\d{1,2})$/i.exec(name)
	return match !== null && Number(match[1]) < FP_REGISTER_COUNT
}

function isCp0(name: string): boolean {
	try {
		cp0RegisterNumber(name)
		return true
	} catch {
		return false
	}
}

/** Whether `arg` can stand in an operand slot of this kind. */
function matchesKind(kind: IsaOperandKind, arg: MipsArgument | undefined): boolean {
	if (!arg) return false
	switch (kind) {
		case 'gpr': return arg.type === 'register' && isGpr(arg.value)
		case 'fpr': return arg.type === 'register' && isFpr(arg.value)
		case 'fpr-even': return arg.type === 'register' && isFpr(arg.value) && fpRegisterNumber(arg.value) % 2 === 0
		// A CP0 register is written by number, or by one of its aliases.
		case 'cp0': return arg.type === 'register' && (isGpr(arg.value) || isCp0(arg.value))
		case 'float': return arg.type === 'immediate'
		case 'label':
		case 'label-offset':
		case 'target26': return arg.type === 'label'
		case 'mem':
		case 'base':
		case 'mem32':
		case 'label-mem':
		case 'label-offset-mem': return arg.type === 'memory'
		default: {
			const range = IMMEDIATE_RANGES[kind]
			if (!range) return false
			return arg.type === 'immediate' && Number.isInteger(arg.value) && arg.value >= range[0] && arg.value <= range[1]
		}
	}
}

function matchesSignature(signature: Signature, args: MipsArgument[]): boolean {
	return signature.operands.length === args.length &&
		signature.operands.every((kind, index) => matchesKind(kind, args[index]))
}

/** What an operand slot wants, named the way the encoders name it. */
function describeKind(kind: IsaOperandKind): string {
	if (kind === 'gpr' || kind === 'cp0') return 'a register'
	if (kind === 'fpr' || kind === 'fpr-even') return 'a floating-point register'
	if (kind === 'label' || kind === 'target26' || kind === 'label-offset') return 'a label'
	if (kind === 'mem' || kind === 'base' || kind === 'mem32' || kind === 'label-mem' || kind === 'label-offset-mem') {
		return 'a memory operand'
	}
	return 'an immediate value'
}

export class Assembler {
	files: SourceFile[]
	/** Files assembled into the program; the rest are reachable by `.include`. */
	entries: SourceFile[]
	program: MipsProgram | null
	machineCode: number[]
	currentAddress: number
	delayedBranching: boolean
	extendedAssembler: boolean
	warningsAreErrors: boolean
	memory: MemoryConfigurationValues
	/** Faults found in the source, rather than bugs in the assembler. */
	diagnostics: Diagnostic[]
	/** Instruction being expanded or encoded, which positions its diagnostics. */
	currentInstruction: MipsInstruction | null
	/**
	 * `lui` instructions whose label half is the high half of a load or store
	 * address, and so carries the bit-15 adjustment.  `la` resolves with `ori`
	 * and must not.
	 */
	adjustedHighHalves: Set<MipsInstruction>

	/**
	 * A bare string assembles as a single unnamed file.  Given several files,
	 * all of them are assembled together unless `entryNames` narrows the set.
	 */
	constructor(public source: string | SourceFile[], entryNames?: string[], options: AssemblerOptions = {}) {
		this.files = typeof source === 'string' ? [{ name: '', code: source }] : source
		this.entries = entryNames ? this.files.filter((file) => entryNames.includes(file.name)) : this.files
		this.program = null
		this.machineCode = []
		this.memory = options.memory ?? MEMORY_CONFIGURATIONS.default
		this.currentAddress = this.memory.textBaseAddress
		this.delayedBranching = options.delayedBranching ?? false
		this.extendedAssembler = options.extendedAssembler ?? true
		this.warningsAreErrors = options.warningsAreErrors ?? false
		this.diagnostics = []
		this.currentInstruction = null
		this.adjustedHighHalves = new Set()
	}

	get entryFile(): string {
		return this.entries[0]?.name ?? ''
	}

	/**
	 * A fault in the source is reported, not thrown: the per-instruction passes
	 * carry on past one, so a single assembly names every bad instruction it
	 * finds.  Lexing, macro expansion and parsing still stop at their first
	 * error, since nothing downstream of a broken token stream is trustworthy.
	 */
	assemble(): AssembleResult {
		// Every pass accumulates into a field, so a second call starts clean rather
		// than appending its output to the first one's.
		this.diagnostics = []
		this.machineCode = []
		this.program = null
		this.currentInstruction = null

		let parsed: ParseResult
		try {
			// Lexical analysis, across every file of the program
			const tokens = expandMacros(this.tokenizeFiles())

			// Parse
			// The entry files are the ones assembled in their own right; an
			// `.include` belongs to its includer.
			parsed = new Parser(tokens, new Set(this.entries.map((file) => file.name)), this.memory).parse()
		} catch (error) {
			this.record(error)
			this.promoteWarnings()
			return { program: emptyProgram(), machineCode: [], diagnostics: this.diagnostics }
		}

		this.program = this.expandPseudoInstructions(parsed)

		// Generate machine code
		this.generateMachineCode()

		this.promoteWarnings()
		this.sortDiagnostics()
		return {
			program: this.program,
			machineCode: this.machineCode,
			diagnostics: this.diagnostics,
		}
	}

	/**
	 * Records a source fault.  Anything else is a bug in the assembler and keeps
	 * propagating, rather than being reported as the user's mistake.
	 */
	record(error: unknown) {
		if (!(error instanceof AssemblyError)) throw error
		const diagnostic = error.diagnostic
		// One fault can surface twice, such as in both halves of an expanded `la`.
		const seen = this.diagnostics.some((existing) =>
			existing.message === diagnostic.message && existing.file === diagnostic.file && existing.line === diagnostic.line)
		if (!seen) this.diagnostics.push(diagnostic)
	}

	/**
	 * With `warningsAreErrors`, a warning fails the assembly exactly as an error
	 * does.  The message and code are kept, so the reader
	 * still sees which warning it was.
	 */
	promoteWarnings() {
		if (!this.warningsAreErrors) return
		this.diagnostics = this.diagnostics.map((diagnostic) =>
			diagnostic.severity === 'warning' ? { ...diagnostic, severity: 'error' } : diagnostic)
	}

	/**
	 * Puts the diagnostics in reading order: the passes find them out of order,
	 * since a pseudo-instruction is expanded before anything is encoded.
	 */
	sortDiagnostics() {
		const fileOrder = new Map<string, number>()
		for (const diagnostic of this.diagnostics) {
			if (!fileOrder.has(diagnostic.file ?? '')) fileOrder.set(diagnostic.file ?? '', fileOrder.size)
		}
		this.diagnostics.sort((left, right) =>
			(fileOrder.get(left.file ?? '')! - fileOrder.get(right.file ?? '')!) ||
			((left.line ?? Infinity) - (right.line ?? Infinity)) ||
			((left.column ?? 0) - (right.column ?? 0)))
	}

	/** Position of the instruction being worked on, for the encoding helpers. */
	instructionPosition(): SourcePosition {
		return atInstruction(this.currentInstruction)
	}

	/** Lexes every file, splicing in each `.include`, into one token stream. */
	tokenizeFiles(): TokenData[] {
		const tokens: TokenData[] = []
		const included = new Set<string>()

		for (const file of this.entries) {
			if (included.has(file.name)) continue
			included.add(file.name)
			tokens.push(...this.tokenizeFile(file, included, [file.name]))
		}

		const last = tokens[tokens.length - 1]
		tokens.push({ type: 'EOF', value: '', line: last ? last.line : 1, column: 1, file: last?.file ?? this.entryFile, unit: last?.unit ?? this.entryFile })
		return tokens
	}

	/** `open` is the chain of files being spliced, innermost last, for cycle reporting. */
	tokenizeFile(file: SourceFile, included: Set<string>, open: string[]): TokenData[] {
		// An included file's tokens belong to the unit that opened the chain.
		const unit = open[0] ?? file.name
		const lexer = new Lexer(file.code, file.name)
		const tokens = lexer.tokenize().map((token) => ({ ...token, unit }))
		// The lexer's warnings are the assembly's, so they reach the same channel.
		this.diagnostics.push(...lexer.diagnostics)
		const output: TokenData[] = []

		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index]
			if (token.type === 'EOF') break
			if (token.type !== 'DIRECTIVE' || token.value.toLowerCase() !== '.include') {
				output.push(token)
				continue
			}

			const target = tokens[index + 1]
			if (!target || target.type !== 'STRING') {
				throw new AssemblyError('.include expects a file name', at(token))
			}
			index += 1
			output.push(...this.includeFile(target.value, included, open, token))
		}

		// Statements must not run together across a file boundary.
		output.push({ type: 'NEWLINE', value: '\n', line: 1, column: 1, file: file.name, unit })
		return output
	}

	includeFile(name: string, included: Set<string>, open: string[], token: TokenData): TokenData[] {
		const wanted = name.toLowerCase().replace(/^.*[\\/]/, '')
		const file = this.files.find((candidate) => candidate.name === name) ??
			this.files.find((candidate) => candidate.name.toLowerCase().replace(/^.*[\\/]/, '') === wanted)
		if (!file) {
			const available = this.files.map((candidate) => candidate.name).join(', ')
			throw new AssemblyError(`Cannot include "${name}"; open files are: ${available}`, at(token))
		}

		// A file that is still being spliced cannot include itself again, directly
		// or through another.
		const cycle = open.indexOf(file.name)
		if (cycle >= 0) {
			const chain = [...open.slice(cycle), file.name].join(' -> ')
			throw new AssemblyError(`Recursive include of file ${file.name}: ${chain}`, at(token))
		}
		// A file already assembled, or already included, is not repeated.  Upstream
		// calls that recursive too, since its seen-set is never unwound; splicing
		// once instead keeps a header shared by two includers usable.
		if (included.has(file.name)) return []
		included.add(file.name)
		return this.tokenizeFile(file, included, [...open, file.name])
	}

	generateMachineCode() {
		for (const instr of this.program!.instructions) {
			try {
				this.machineCode.push(this.encodeInstruction(instr))
			} catch (error) {
				this.record(error)
				// One word per instruction either way, so the two stay in step.
				this.machineCode.push(0)
			}
		}
	}

	/**
	 * Turn source-level conveniences into the instructions a MIPS processor
	 * actually executes, and lay them out.  Expansion comes first: a branch
	 * following (for example) `blt` must see the two words emitted for it.  This
	 * is the only pass that assigns a text address, so its source index is the
	 * one every consumer reads.
	 */
	expandPseudoInstructions(parsed: ParseResult): MipsProgram {
		const expanded: MipsInstruction[] = []
		// The parser leaves only data labels resolved; text labels ride on the
		// instructions they precede, so expansion keeps them in step.
		const symbols: SymbolTables = {
			locals: new Map([...parsed.symbols.locals].map(([unit, table]) => [unit, new Map(table)])),
			globals: new Map(parsed.symbols.globals),
		}
		const bind = (unit: string, name: string, address: number) => {
			let table = symbols.locals.get(unit)
			if (!table) {
				table = new Map()
				symbols.locals.set(unit, table)
			}
			table.set(name, address)
		}

		for (const instruction of parsed.instructions) {
			try {
				this.validateInstruction(instruction)
				const sequence = this.expandInstruction(instruction)
				sequence.forEach((item, index) => {
					item.labels = index === 0 ? [...instruction.labels] : []
					item.segment = instruction.segment ?? 'text'
					item.sourceFile = instruction.sourceFile ?? ''
					item.unit = instruction.unit ?? ''
					item.sourceColumn = instruction.sourceColumn
					expanded.push(item)
				})
			} catch (error) {
				// The instruction emits nothing; the ones after it still assemble.
				this.record(error)
			}
		}

		const nextAddress: Record<TextSegment, number> = { ...parsed.segmentStarts }
		for (const instruction of expanded) {
			const segment = instruction.segment ?? 'text'
			const address = nextAddress[segment]
			instruction.address = address
			for (const { name, unit } of instruction.labels) bind(unit, name, address)
			nextAddress[segment] = address + 4
		}

		// A label after the final instruction of a text segment names the end of
		// that segment, which only the finished layout knows.
		for (const { segment, labels: endLabels } of parsed.segmentEndLabels) {
			for (const { name, unit } of endLabels) bind(unit, name, nextAddress[segment])
		}

		this.transferGlobals(symbols, parsed.globalNames)

		const program: MipsProgram = {
			instructions: expanded,
			labels: flattenSymbols(symbols),
			symbols,
			symbolSites: parsed.symbolSites,
			data: parsed.data,
			sourceIndex: buildSourceIndex(this.entryFile, expanded, parsed.data),
		}
		this.program = program

		// `la` uses LUI/ORI, so materialize the two halves only after the final
		// label layout is known.  Keeping branches as labels lets their normal
		// PC-relative resolver calculate offsets from each expanded instruction.
		for (const instruction of expanded) {
			this.currentInstruction = instruction
			try {
				if (instruction.name === 'LUI' && instruction.args[1]?.type === 'label') {
					const address = this.labelAddress(instruction.unit ?? '', instruction.args[1])
					const value = this.adjustedHighHalves.has(instruction) ? highHalf(address) : address >>> 16
					instruction.args[1] = { type: 'immediate', value }
				}
				if (instruction.name === 'ORI' && instruction.args[2]?.type === 'label') {
					instruction.args[2] = { type: 'immediate', value: this.labelAddress(instruction.unit ?? '', instruction.args[2]) & 0xffff }
				}
			} catch (error) {
				this.record(error)
			}
		}

		this.resolveDataLabels(program)
		return program
	}

	/**
	 * Moves each `.globl` name out of its own file's table into the one every
	 * file can see.  The parser has already rejected a name its file never
	 * defined, and one two files both claim.
	 */
	transferGlobals(symbols: SymbolTables, globalNames: Map<string, string>) {
		for (const [name, unit] of globalNames) {
			const table = symbols.locals.get(unit)
			const address = table?.get(name)
			if (address === undefined) continue
			table!.delete(name)
			symbols.globals.set(name, address)
		}
	}

	/**
	 * A `.word label` operand becomes its address here, where the file it was
	 * written in is still known and an undefined name is a diagnostic rather
	 * than a failure to load.
	 */
	resolveDataLabels(program: MipsProgram) {
		for (const entry of program.data) {
			const unit = entry.unit ?? ''
			const position = { file: entry.sourceFile || undefined, line: entry.sourceLine }
			entry.bytes = entry.bytes.map((item) => {
				if (typeof item === 'number' || item.value.type !== 'label') return item
				const label = item.value
				const address = this.symbolAddress(unit, label.value)
				if (address === undefined) {
					this.record(new AssemblyError(`Undefined label: ${label.value}`, position))
					return item
				}
				const value: ImmediateArgument = { type: 'immediate', value: address + (label.offset ?? 0) }
				return { ...item, value }
			})
		}
	}

	/** A name in the referring file's own table, or failing that a global one. */
	symbolAddress(unit: string, name: string): number | undefined {
		const symbols = this.program?.symbols
		return symbols?.locals.get(unit)?.get(name) ?? symbols?.globals.get(name)
	}

	/**
	 * Address of a label reference, including the constant of `label+4`.  A name
	 * is looked for in the referring file's own table first, then among the
	 * global ones.
	 */
	labelAddress(unit: string, arg: LabelArgument): number {
		const address = this.symbolAddress(unit, arg.value)
		if (address === undefined) throw new AssemblyError(`Undefined label: ${arg.value}`, this.instructionPosition())
		return address + (arg.offset ?? 0)
	}

	/**
	 * Rejects an instruction no form of its mnemonic accepts, before expansion
	 * or encoding can drop an operand or truncate it to zero.  Matching follows the
	 * same way, over its own operand token types
	 * (`OperandFormat.tokenOperandMatch`,).
	 */
	validateInstruction(instruction: MipsInstruction) {
		const signatures = signaturesFor(instruction.name)
		// A mnemonic with no form is one the encoder reports as unknown.
		if (signatures.length === 0) return

		const args = instruction.args
		const position = atInstruction(instruction)
		for (const arg of args) {
			if (arg.type === 'register' && !isGpr(arg.value) && !isFpr(arg.value) && !isCp0(arg.value)) {
				throw new AssemblyError(`Unknown register: ${arg.value}`, position)
			}
		}
		if (signatures.some((signature) => matchesSignature(signature, args))) {
			// What is rejected is the form the operands matched, not the mnemonic: an
			// instruction with both a basic and a pseudo form is fine written the
			// basic way.
			if (!this.extendedAssembler && !basicForms(instruction.name).some((form) => matchesSignature(form, args))) {
				throw new AssemblyError(this.extendedFormMessage(instruction), position)
			}
			return
		}

		// Only forms of the right length can say anything about an operand.
		const sized = signatures.filter((signature) => signature.operands.length === args.length)
		if (sized.length === 0) {
			const fewest = Math.min(...signatures.map((signature) => signature.operands.length))
			const relation = args.length < fewest ? 'Too few' : 'Too many'
			throw new AssemblyError(`${relation} operands for ${instruction.name}; expected: ${signatures[0].example}`, position)
		}

		// The form that got furthest names the operand actually at fault.
		const matched = (signature: Signature) =>
			signature.operands.findIndex((kind, slot) => !matchesKind(kind, args[slot]))
		const signature = sized.reduce((best, next) => (matched(next) > matched(best) ? next : best))
		const index = matched(signature)
		const kind = signature.operands[index]
		const arg = args[index]
		if (kind === 'fpr-even' && arg.type === 'register' && isFpr(arg.value)) {
			throw new AssemblyError(`${arg.value} must be an even-numbered floating-point register`, position)
		}
		if (IMMEDIATE_RANGES[kind] && arg.type === 'immediate' && Number.isInteger(arg.value)) {
			throw new AssemblyError(
				`Operand ${index + 1} of ${instruction.name} is out of range; expected: ${signature.example}`,
				position,
			)
		}
		throw new AssemblyError(`Expected ${describeKind(kind)}, found ${describeArgument(arg)}`, position)
	}

	/**
	 * The standard wording, extended with the basic sequence
	 * the form would have expanded to, which is what the author has to write
	 * instead.  An expansion that needs the final layout is left unnamed.
	 */
	extendedFormMessage(instruction: MipsInstruction): string {
		const refusal = 'Extended (pseudo) instruction or format not permitted'
		let basic = ''
		try {
			basic = this.expandInstruction(instruction).map(formatInstruction).join('; ')
		} catch {
			basic = ''
		}
		return basic ? `${refusal}; it expands to: ${basic}.  See Settings.` : `${refusal}.  See Settings.`
	}

	expandInstruction(instruction: MipsInstruction): MipsInstruction[] {
		const make = (name: string, args: MipsArgument[]): MipsInstruction => ({
			name,
			args,
			labels: [],
			address: null,
			sourceLine: instruction.sourceLine,
			sourceColumn: instruction.sourceColumn,
		})
		const reg = (value: string): MipsArgument => ({ type: 'register', value })
		const immediate = (value: number): MipsArgument => ({ type: 'immediate', value })
		const memory = (offset: number, register: string): MipsArgument =>
			({ type: 'memory', offset: { type: 'immediate', value: offset }, register })
		// The three-operand arithmetic and logical instructions also take a
		// two-operand form, where the destination is also the first source.
		const [first, second, third] = TWO_OPERAND_FORMS.has(instruction.name) && instruction.args.length === 2
			? [instruction.args[0], instruction.args[0], instruction.args[1]]
			: instruction.args
		/** Materializes a full 32-bit word in `$at`, for the `li.s`/`li.d` bit patterns. */
		const loadAt = (bits: number): MipsInstruction[] => [
			make('LUI', [reg('$at'), immediate(bits >>> 16)]),
			make('ORI', [reg('$at'), reg('$at'), immediate(bits & 0xffff)]),
		]
		const isImmediate = (arg: MipsArgument | undefined): arg is ImmediateArgument =>
			typeof arg === 'object' && arg?.type === 'immediate'
		const fitsSigned16 = (value: number) => value >= -0x8000 && value <= 0x7fff
		const fitsUnsigned16 = (value: number) => value >= 0 && value <= 0xffff
		/**
		 * Puts `value` in `$at`, in one instruction when it fits the immediate
		 * field.
		 */
		const valueInAt = (value: number): MipsInstruction[] =>
			fitsSigned16(value)
				? [make('ADDI', [reg('$at'), reg('$zero'), immediate(value)])]
				: loadAt(value >>> 0)
		/**
		 * `op rd, rs, imm`.  The immediate folds into the I-type form when
		 * one exists and the value fits its field, and otherwise routes the value
		 * through `$at` and uses the register form.
		 */
		const withImmediate = (
			registerOp: string,
			immediateOp: string | null,
			unsigned: boolean,
			destination: MipsArgument,
			source: MipsArgument,
			operand: MipsArgument,
		): MipsInstruction[] => {
			if (!isImmediate(operand)) return [make(registerOp, [destination, source, operand])]
			const fits = unsigned ? fitsUnsigned16(operand.value) : fitsSigned16(operand.value)
			if (immediateOp && fits) return [make(immediateOp, [destination, source, operand])]
			return [...valueInAt(operand.value), make(registerOp, [destination, source, reg('$at')])]
		}
		/**
		 * Presents `arg` as a register, materializing a constant into `$at` first.
		 * The set and branch pseudo-ops are written against registers, so this is
		 * how a constant stands in one of their operand positions.
		 */
		const materialize = (arg: MipsArgument): { setup: MipsInstruction[]; operand: MipsArgument } =>
			isImmediate(arg) ? { setup: valueInAt(arg.value), operand: reg('$at') } : { setup: [], operand: arg }
		/** The constant the `set` pseudo-ops invert a comparison against. */
		const one = (): MipsInstruction[] => [make('ORI', [reg('$at'), reg('$zero'), immediate(1)])]
		/**
		 * A branch over `body`, which the checked pseudo-ops use to skip a
		 * `break`.  The offset is in words and counts the delay slot when there
		 * is one, which the expansion table spells `BROFFnm`.
		 */
		const skipping = (branch: MipsInstruction, body: MipsInstruction[]): MipsInstruction[] => {
			const delaySlot = this.delayedBranching ? [make('NOP', [])] : []
			branch.args.push(immediate(delaySlot.length + body.length))
			return [branch, ...delaySlot, ...body]
		}
		/**
		 * `div`/`rem` in their three-operand form: divide, then take a result.
		 * A register divisor is checked against zero first;
		 * a constant one is known (`:226`).
		 */
		const divideInto = (divide: string, take: string): MipsInstruction[] => {
			if (!isImmediate(third)) {
				return [
					...skipping(make('BNE', [third, reg('$zero')]), [make('BREAK', [])]),
					make(divide, [second, third]),
					make(take, [first]),
				]
			}
			return [...valueInAt(third.value), make(divide, [second, reg('$at')]), make(take, [first])]
		}
		/** Rotate by assembling the two halves of the shift and merging them. */
		const rotate = (towardsHigh: string, towardsLow: string): MipsInstruction[] => {
			if (isImmediate(third)) {
				const places = third.value & 31
				return [
					make(towardsLow, [reg('$at'), second, immediate((32 - places) & 31)]),
					make(towardsHigh, [first, second, immediate(places)]),
					make('OR', [first, first, reg('$at')]),
				]
			}
			return [
				make('SUBU', [reg('$at'), reg('$zero'), third]),
				make(`${towardsLow}V`, [reg('$at'), second, reg('$at')]),
				make(`${towardsHigh}V`, [first, second, third]),
				make('OR', [first, first, reg('$at')]),
			]
		}
		/** The register one past `arg`, which the doubleword forms pair with. */
		const nextRegister = (arg: MipsArgument): MipsArgument => {
			if (typeof arg !== 'object' || arg.type !== 'register') throw new AssemblyError('Expected a register', atInstruction(instruction))
			const number = registerNumber(arg.value)
			if (number === null) return { type: 'register', value: `$f${fpRegisterNumber(arg.value) + 1}` }
			return reg(REGISTER_NAMES[(number + 1) % 32])
		}
		/**
		 * A load/store target as an offset(base) operand, `delta` bytes on.
		 *
		 * Every extended address form in has the same
		 * shape: the high half of the address goes in `$at`, the base register is
		 * added to it when there is one, and the low half stays in the
		 * instruction's own offset field.  The high half carries a 1 when bit 15
		 * of the address is set, since the low half is added back signed
		 *.
		 *
		 * The unaligned transfers touch one address several times and clobber
		 * `$at` in between, so the setup is re-emitted per access rather than
		 * kept.
		 */
		const addressParts = (target: MipsArgument, delta: number): { setup: MipsInstruction[]; operand: MipsArgument } => {
			const addBase = (base?: string) => (base ? [make('ADDU', [reg('$at'), reg('$at'), reg(base)])] : [])
			/** `lui $at, high; op rt, low($at)`, the general form. */
			const split = (value: number, base?: string) => ({
				setup: [make('LUI', [reg('$at'), immediate(highHalf(value))]), ...addBase(base)],
				operand: memory(lowHalf(value), '$at'),
			})
			/** The same for a label, whose halves are only known after layout. */
			const splitLabel = (label: LabelArgument, base?: string) => {
				const shifted: LabelArgument = { ...label, offset: (label.offset ?? 0) + delta }
				const lui = make('LUI', [reg('$at'), shifted])
				this.adjustedHighHalves.add(lui)
				const operand: MipsArgument = { type: 'memory', offset: shifted, register: '$at' }
				return { setup: [lui, ...addBase(base)], operand }
			}
			/** A 16-bit unsigned address needs no `lui`. */
			const throughOri = (value: number, base?: string) => ({
				setup: [make('ORI', [reg('$at'), reg('$zero'), immediate(value)]), ...addBase(base)],
				operand: memory(0, '$at'),
			})
			const value = (amount: number, base?: string) => {
				if (delta === 0 && !base && fitsSigned16(amount)) return { setup: [], operand: memory(amount, '$zero') }
				if (delta === 0 && fitsUnsigned16(amount)) return throughOri(amount, base)
				return split(amount + delta, base)
			}

			if (typeof target === 'object' && target.type === 'memory') {
				if (target.offset.type === 'label') return splitLabel(target.offset, target.register)
				const offset = target.offset.value
				// An offset the field already holds stays there, and so do the
				// three bytes past a `($t2)` operand.
				if (fitsSigned16(offset) && (delta === 0 || offset === 0)) {
					return { setup: [], operand: memory(offset + delta, target.register) }
				}
				return value(offset, target.register)
			}
			if (isImmediate(target)) return value(target.value)
			if (typeof target === 'object' && target.type === 'label') return splitLabel(target)
			throw new AssemblyError(`${instruction.name} needs an address operand`, atInstruction(instruction))
		}
		/** `ld`/`sd` move a register pair to or from two consecutive words. */
		const doubleword = (transfer: string): MipsInstruction[] => {
			const start = addressParts(second, 0)
			const next = addressParts(second, 4)
			return [
				...start.setup, make(transfer, [first, start.operand]),
				...next.setup, make(transfer, [nextRegister(first), next.operand]),
			]
		}
		/** `ulw`/`usw`: the halves of a word that straddles an alignment boundary. */
		const unalignedWord = (high: string, low: string): MipsInstruction[] => {
			const end = addressParts(second, 3)
			const start = addressParts(second, 0)
			return [...end.setup, make(high, [first, end.operand]), ...start.setup, make(low, [first, start.operand])]
		}
		/** `ulh`/`ulhu`: two bytes, the upper one carrying the sign when signed. */
		const unalignedHalf = (loadHigh: string): MipsInstruction[] => {
			const high = addressParts(second, 1)
			const low = addressParts(second, 0)
			return [
				...high.setup, make(loadHigh, [first, high.operand]),
				...low.setup, make('LBU', [reg('$at'), low.operand]),
				make('SLL', [first, first, immediate(8)]),
				make('OR', [first, first, reg('$at')]),
			]
		}
		/**
		 * `ush`: store two bytes.  Between them the source is rotated right by
		 * eight and back again, which brings the second byte into position
		 * without a scratch register beyond `$at`.
		 */
		const unalignedStoreHalf = (): MipsInstruction[] => {
			const low = addressParts(second, 0)
			const high = addressParts(second, 1)
			const rotate = (out: string, back: string): MipsInstruction[] => [
				make(out, [reg('$at'), first, immediate(24)]),
				make(back, [first, first, immediate(8)]),
				make('OR', [first, first, reg('$at')]),
			]
			return [
				...low.setup, make('SB', [first, low.operand]),
				...rotate('SLL', 'SRL'),
				...high.setup, make('SB', [first, high.operand]),
				...rotate('SRL', 'SLL'),
			]
		}
		/**
		 * `mulo`/`mulou`: multiply, then `break` when the product does not fit
		 * 32 bits.  The branch skips the delay slot too when it exists.
		 */
		const multiplyChecked = (multiply: string, overflowed: MipsInstruction[]): MipsInstruction[] => {
			const { setup, operand } = materialize(third)
			const delaySlot = this.delayedBranching ? [make('NOP', [])] : []
			return [
				...setup,
				make(multiply, [second, operand]),
				make('MFHI', [reg('$at')]),
				...overflowed,
				make('BEQ', [reg('$at'), overflowed.length > 0 ? first : reg('$zero'), immediate(delaySlot.length + 1)]),
				...delaySlot,
				make('BREAK', []),
				make('MFLO', [first]),
			]
		}
		/** One load or store, with whatever it takes to reach its address. */
		const transfer = (name: string): MipsInstruction[] => {
			const { setup, operand } = addressParts(second, 0)
			return [...setup, make(name, [first, operand])]
		}
		/**
		 * `la`, which computes an address rather than using one.  Its low half is
		 * added back by `ori`, unsigned, so its high half never carries the bit-15
		 * adjustment a load's does.
		 */
		const loadAddress = (): MipsInstruction[] => {
			const based = typeof second === 'object' && second.type === 'memory'
			const base = based ? (second as { register: string }).register : null
			const target = based ? (second as { offset: MipsArgument }).offset : second
			// With a base register the halves land in $at and are added to it.
			const destination = base ? reg('$at') : first
			const withBase = (built: MipsInstruction[]) =>
				base ? [...built, make('ADD', [first, reg(base), reg('$at')])] : built
			if (isImmediate(target)) {
				// `la $t1,($t2)` is the base register itself.
				if (base && target.value === 0) return [make('ADDI', [first, reg(base), immediate(0)])]
				if (!base && fitsSigned16(target.value)) return [make('ADDIU', [first, reg('$zero'), target])]
				if (fitsUnsigned16(target.value)) return withBase([make('ORI', [destination, reg('$zero'), target])])
				return withBase([
					make('LUI', [reg('$at'), immediate(target.value >>> 16)]),
					make('ORI', [destination, reg('$at'), immediate(target.value & 0xffff)]),
				])
			}
			if (typeof target === 'object' && target.type === 'label') {
				return withBase([make('LUI', [reg('$at'), target]), make('ORI', [destination, reg('$at'), target])])
			}
			throw new AssemblyError('la needs an address operand', atInstruction(instruction))
		}

		switch (instruction.name) {
			case 'NOP': return [make('SLL', [reg('$zero'), reg('$zero'), immediate(0)])]
			case 'MOVE': return [make('ADDU', [first, reg('$zero'), second])]
			case 'LI': {
				if (second?.type !== 'immediate') throw new AssemblyError('li requires an immediate value', atInstruction(instruction))
				if (fitsSigned16(second.value)) return [make('ADDIU', [first, reg('$zero'), second])]
				if (fitsUnsigned16(second.value)) return [make('ORI', [first, reg('$zero'), second])]
				return [
					make('LUI', [reg('$at'), immediate(second.value >>> 16)]),
					make('ORI', [first, reg('$at'), immediate(second.value & 0xffff)]),
				]
			}
			case 'LA': return loadAddress()
			case 'B': return [make('BGEZ', [reg('$zero'), first])]
			case 'BAL': return [make('JAL', [first])]
			case 'BEQZ': return [make('BEQ', [first, reg('$zero'), second])]
			case 'BNEZ': return [make('BNE', [first, reg('$zero'), second])]
			case 'BLT':
			case 'BGE':
			case 'BLTU':
			case 'BGEU': {
				const unsigned = instruction.name.endsWith('U')
				const branch = instruction.name.startsWith('BLT') ? 'BNE' : 'BEQ'
				const test = isImmediate(second) && fitsSigned16(second.value)
					// A 16-bit constant compares in the `slti` field itself.
					? [make(unsigned ? 'SLTIU' : 'SLTI', [reg('$at'), first, second])]
					: (({ setup, operand }) => [...setup, make(unsigned ? 'SLTU' : 'SLT', [reg('$at'), first, operand])])(materialize(second))
				return [...test, make(branch, [reg('$at'), reg('$zero'), third])]
			}
			case 'BLEU':
			case 'BGTU': {
				const { setup, operand } = materialize(second)
				const branch = instruction.name === 'BGTU' ? 'BNE' : 'BEQ'
				return [...setup, make('SLTU', [reg('$at'), operand, first]), make(branch, [reg('$at'), reg('$zero'), third])]
			}
			// The signed pair compares the other way round for a 32-bit constant:
			// `x > c` is `!(x < c+1)`.
			case 'BLE':
			case 'BGT': {
				const greater = instruction.name === 'BGT'
				if (isImmediate(second) && !fitsSigned16(second.value)) {
					return [
						...loadAt((second.value + 1) >>> 0),
						make('SLT', [reg('$at'), first, reg('$at')]),
						make(greater ? 'BEQ' : 'BNE', [reg('$at'), reg('$zero'), third]),
					]
				}
				// `x <= c` is `x - 1 < c` for a 16-bit constant (`:214`).
				if (!greater && isImmediate(second)) {
					return [
						make('ADDI', [reg('$at'), first, immediate(-1)]),
						make('SLTI', [reg('$at'), reg('$at'), second]),
						make('BNE', [reg('$at'), reg('$zero'), third]),
					]
				}
				const { setup, operand } = materialize(second)
				return [...setup, make('SLT', [reg('$at'), operand, first]), make(greater ? 'BNE' : 'BEQ', [reg('$at'), reg('$zero'), third])]
			}
			case 'NOT': return [make('NOR', [first, second, reg('$zero')])]
			case 'NEG': return [make('SUB', [first, reg('$zero'), second])]
			case 'NEGU': return [make('SUBU', [first, reg('$zero'), second])]
			case 'ABS': return [
				make('SRA', [reg('$at'), second, immediate(31)]),
				make('XOR', [first, reg('$at'), second]),
				make('SUBU', [first, first, reg('$at')]),
			]
			case 'SEQ':
			case 'SNE': {
				const { setup, operand } = materialize(third)
				// The difference is zero exactly when the two are equal.
				const finish = instruction.name === 'SEQ'
					? [...one(), make('SLTU', [first, first, reg('$at')])]
					: [make('SLTU', [first, reg('$zero'), first])]
				return [...setup, make('SUBU', [first, second, operand]), ...finish]
			}
			case 'SGT':
			case 'SGTU': {
				const { setup, operand } = materialize(third)
				return [...setup, make(instruction.name === 'SGTU' ? 'SLTU' : 'SLT', [first, operand, second])]
			}
			case 'SGE':
			case 'SGEU':
			case 'SLE':
			case 'SLEU': {
				const { setup, operand } = materialize(third)
				const compare = instruction.name.endsWith('U') ? 'SLTU' : 'SLT'
				// `x >= y` is `!(x < y)`; `x <= y` is `!(y < x)`.
				const args = instruction.name.startsWith('SGE') ? [first, second, operand] : [first, operand, second]
				return [...setup, make(compare, args), ...one(), make('SUBU', [first, reg('$at'), first])]
			}
			case 'L.S': return transfer('LWC1')
			case 'L.D': return transfer('LDC1')
			case 'S.S': return transfer('SWC1')
			case 'S.D': return transfer('SDC1')
			case 'LWC1':
			case 'LDC1':
			case 'SWC1':
			case 'SDC1':
			case 'LW':
			case 'LH':
			case 'LHU':
			case 'LB':
			case 'LBU':
			case 'SW':
			case 'SH':
			case 'SB':
			case 'LL':
			case 'SC':
			case 'LWL':
			case 'LWR':
			case 'SWL':
			case 'SWR':
				return transfer(instruction.name)
			case 'ULW': return unalignedWord('LWL', 'LWR')
			case 'USW': return unalignedWord('SWL', 'SWR')
			case 'ULH': return unalignedHalf('LB')
			case 'ULHU': return unalignedHalf('LBU')
			case 'USH': return unalignedStoreHalf()
			// The signed form compares the high word against the sign of the low
			// one; the unsigned form only needs the high word to be zero.
			case 'MULO': return multiplyChecked('MULT', [make('MFLO', [first]), make('SRA', [first, first, immediate(31)])])
			case 'MULOU': return multiplyChecked('MULTU', [])
			case 'LI.S': {
				if (second?.type !== 'immediate') throw new AssemblyError('li.s requires an immediate value', atInstruction(instruction))
				return [...loadAt(singleToBits(second.value)), make('MTC1', [reg('$at'), first])]
			}
			case 'LI.D': {
				if (second?.type !== 'immediate') throw new AssemblyError('li.d requires an immediate value', atInstruction(instruction))
				if (first?.type !== 'register') throw new AssemblyError('li.d requires a floating-point register', atInstruction(instruction))
				const index = fpRegisterNumber(first.value)
				if (index % 2 !== 0) throw new AssemblyError(`li.d requires an even register, not ${first.value}`, atInstruction(instruction))
				const { low, high } = doubleToBits(second.value)
				return [
					...loadAt(low), make('MTC1', [reg('$at'), first]),
					...loadAt(high), make('MTC1', [reg('$at'), reg(`$f${index + 1}`)]),
				]
			}
			// Three-operand div/rem are pseudo-ops; the two-operand forms are real.
			case 'REM': return divideInto('DIV', 'MFHI')
			case 'REMU': return divideInto('DIVU', 'MFHI')
			case 'DIV': return instruction.args.length < 3 ? [instruction] : divideInto('DIV', 'MFLO')
			case 'DIVU': return instruction.args.length < 3 ? [instruction] : divideInto('DIVU', 'MFLO')
			case 'MULU': return [
				...(isImmediate(third) ? valueInAt(third.value) : []),
				make('MULTU', [second, isImmediate(third) ? reg('$at') : third]),
				make('MFLO', [first]),
			]

			// An immediate where a register belongs.  These are accepted and
			// widened; dropping the operand would assemble a wrong answer.
			case 'ADD': return withImmediate('ADD', 'ADDI', false, first, second, third)
			case 'ADDU': return withImmediate('ADDU', 'ADDIU', false, first, second, third)
			case 'ADDI': return withImmediate('ADD', 'ADDI', false, first, second, third)
			case 'ADDIU': return withImmediate('ADDU', 'ADDIU', false, first, second, third)
			case 'SUB':
			case 'SUBI': return withImmediate('SUB', null, false, first, second, third)
			case 'SUBU':
			case 'SUBIU': return withImmediate('SUBU', null, false, first, second, third)
			case 'AND': return withImmediate('AND', 'ANDI', true, first, second, third)
			case 'OR': return withImmediate('OR', 'ORI', true, first, second, third)
			case 'XOR': return withImmediate('XOR', 'XORI', true, first, second, third)
			case 'ANDI': return withImmediate('AND', 'ANDI', true, first, second, third)
			case 'ORI': return withImmediate('OR', 'ORI', true, first, second, third)
			case 'XORI': return withImmediate('XOR', 'XORI', true, first, second, third)
			case 'SLT': return withImmediate('SLT', 'SLTI', false, first, second, third)
			case 'SLTU': return withImmediate('SLTU', 'SLTIU', false, first, second, third)
			case 'SLTI': return withImmediate('SLT', 'SLTI', false, first, second, third)
			case 'SLTIU': return withImmediate('SLTU', 'SLTIU', false, first, second, third)
			case 'MUL': return withImmediate('MUL', null, false, first, second, third)

			// A branch may compare against a constant, which goes through $at.
			case 'BEQ':
			case 'BNE': {
				if (!isImmediate(second)) return [instruction]
				// The comparison is `$at` against the register, in that order
				//.
				return [...valueInAt(second.value), make(instruction.name, [reg('$at'), first, third])]
			}

			case 'ROL': return rotate('SLL', 'SRL')
			case 'ROR': return rotate('SRL', 'SLL')

			case 'LD': return doubleword('LW')
			case 'SD': return doubleword('SW')
			case 'MFC1.D': return [make('MFC1', [first, second]), make('MFC1', [nextRegister(first), nextRegister(second)])]
			case 'MTC1.D': return [make('MTC1', [first, second]), make('MTC1', [nextRegister(first), nextRegister(second)])]
			default: return [{ ...instruction, args: [...instruction.args], labels: [] }]
		}
	}

	encodeInstruction(instr: MipsInstruction): number {
		const name = instr.name
		this.currentAddress = instr.address ?? 0
		this.currentInstruction = instr

		// Resolve labels in arguments
		const args = instr.args.map((arg) => this.resolveArgument(arg))
		// The simulator executes the parsed instruction objects, so preserve the
		// resolved addresses there as well as in the encoded instruction.
		instr.args = args

		// R-type instructions (func-based)
		const rTypeInstructions: Record<string, { opcode: number; func: number }> = {
			ADD: { opcode: 0, func: 0x20 },
			ADDU: { opcode: 0, func: 0x21 },
			SUB: { opcode: 0, func: 0x22 },
			SUBU: { opcode: 0, func: 0x23 },
			AND: { opcode: 0, func: 0x24 },
			OR: { opcode: 0, func: 0x25 },
			XOR: { opcode: 0, func: 0x26 },
			NOR: { opcode: 0, func: 0x27 },
			SLT: { opcode: 0, func: 0x2a },
			SLTU: { opcode: 0, func: 0x2b },
		MULT: { opcode: 0, func: 0x18 },
		MULTU: { opcode: 0, func: 0x19 },
		MUL: { opcode: 0x1c, func: 0x02 },
			DIV: { opcode: 0, func: 0x1a },
			DIVU: { opcode: 0, func: 0x1b },
			MFHI: { opcode: 0, func: 0x10 },
			MFLO: { opcode: 0, func: 0x12 },
			MTHI: { opcode: 0, func: 0x11 },
			MTLO: { opcode: 0, func: 0x13 },
			SLL: { opcode: 0, func: 0x00 },
			SRL: { opcode: 0, func: 0x02 },
			SRA: { opcode: 0, func: 0x03 },
			SLLV: { opcode: 0, func: 0x04 },
			SRLV: { opcode: 0, func: 0x06 },
			SRAV: { opcode: 0, func: 0x07 },
			JR: { opcode: 0, func: 0x08 },
			JALR: { opcode: 0, func: 0x09 },
		}

		// I-type instructions
		const iTypeInstructions: Record<string, number> = {
			ADDI: 0x08,
			ADDIU: 0x09,
			SLTI: 0x0a,
			SLTIU: 0x0b,
			ANDI: 0x0c,
			ORI: 0x0d,
			XORI: 0x0e,
			LUI: 0x0f,
			BEQ: 0x04,
			BNE: 0x05,
			BGEZ: 0x01,
			BGTZ: 0x07,
			BLEZ: 0x06,
			BLTZ: 0x01,
			LW: 0x23,
			LH: 0x21,
			LHU: 0x25,
			LB: 0x20,
			LBU: 0x24,
			SW: 0x2b,
			SH: 0x29,
			SB: 0x28,
			LWL: 0x22,
			LWR: 0x26,
			SWL: 0x2a,
			SWR: 0x2e,
			LL: 0x30,
			SC: 0x38,
		}

		// J-type instructions
		const jTypeInstructions: Record<string, number> = {
			J: 0x02,
			JAL: 0x03,
		}

		const coprocessorCode = this.encodeCoprocessor(name, args)
		if (coprocessorCode !== null) return coprocessorCode

		if (rTypeInstructions[name]) {
			return this.encodeRType(name, args, rTypeInstructions[name])
		}
		if (iTypeInstructions[name]) {
			return this.encodeIType(name, args, iTypeInstructions[name])
		}
		if (jTypeInstructions[name]) {
			return this.encodeJType(name, args, jTypeInstructions[name])
		}

		// Pseudo-instructions should have been expanded before encoding.
		switch (name) {
			case 'NOP':
				return 0x00000000
			case 'MOVE':
				// move $rd, $rs -> addu $rd, $rs, $zero
				return this.encodeRType('ADDU', args, { opcode: 0, func: 0x21 })
		case 'SYSCALL':
			return 0x0000000c
			case 'BREAK':
				return (((this.getImmediateValue(args[0]) & 0xfffff) << 6) | 0x0d) >>> 0
			default: {
				const encoded = this.encodeFromTable(name, args)
				if (encoded !== null) return encoded
				throw new AssemblyError(`Unknown instruction: ${name}`, this.instructionPosition())
			}
		}
	}

	/**
	 * Encodes straight from the isa table: the form's fixed bits, then each
	 * operand into the run of `f`, `s` or `t` its bit pattern names.  The letters
	 * bind to the operands in order, and a `mem` operand spends two of them, its
	 * offset then its base register.  Null when
	 * no form of `name` fits these operands.
	 */
	encodeFromTable(name: string, args: MipsArgument[]): number | null {
		const form = basicForms(name).find((candidate) => matchesSignature(candidate, args))
		if (!form) return null

		const values = form.operands.flatMap((kind, index) => this.operandBits(kind, args[index]))
		let word = form.match
		form.fields.forEach((field, index) => {
			const mask = (2 ** field.width - 1) >>> 0
			word = (word | (((values[index] ?? 0) & mask) << field.shift)) >>> 0
		})
		return word >>> 0
	}

	/** The bits one operand contributes, in the order its pattern letters run. */
	operandBits(kind: IsaOperandKind, arg: MipsArgument): number[] {
		switch (kind) {
			case 'gpr': return [this.getRegisterNumber(arg)]
			case 'cp0': return [this.getCp0RegisterNumber(arg)]
			case 'fpr':
			case 'fpr-even': return [this.getFpRegisterNumber(arg)]
			// A basic form spells a label only as a branch target.
			case 'label': return [this.getBranchOffset(arg)]
			case 'target26': return [this.getJumpAddress(arg) >>> 2]
			case 'mem': return arg.type === 'memory'
				? [this.getImmediateValue(arg.offset), this.getRegisterNumber(arg.register)]
				: [this.getImmediateValue(arg), 0]
			default: return [this.getImmediateValue(arg)]
		}
	}

	/** Encodes a CP0 or CP1 instruction, or returns null when `name` is neither. */
	encodeCoprocessor(name: string, args: MipsArgument[]): number | null {
		if (name === 'ERET') return ((COP0_OPCODE << 26) | (1 << 25) | 0x18) >>> 0

		if (name === 'MFC0' || name === 'MTC0') {
			const rt = this.getRegisterNumber(args[0])
			const rd = this.getCp0RegisterNumber(args[1])
			return ((COP0_OPCODE << 26) | ((name === 'MTC0' ? 4 : 0) << 21) | (rt << 16) | (rd << 11)) >>> 0
		}

		if (FP_MEMORY_OPCODES[name] !== undefined) {
			const ft = this.getFpRegisterNumber(args[0])
			const target = args[1]
			const isMemory = typeof target === 'object' && target.type === 'memory'
			const base = isMemory ? this.getRegisterNumber(target.register) : 0
			const offset = (isMemory ? this.getImmediateValue(target.offset) : this.getImmediateValue(target)) & 0xffff
			return ((FP_MEMORY_OPCODES[name] << 26) | (base << 21) | (ft << 16) | offset) >>> 0
		}

		if (name === 'MFC1' || name === 'MTC1') {
			const rt = this.getRegisterNumber(args[0])
			const fs = this.getFpRegisterNumber(args[1])
			return ((COP1_OPCODE << 26) | ((name === 'MTC1' ? 4 : 0) << 21) | (rt << 16) | (fs << 11)) >>> 0
		}

		const parts = name.split('.')
		const format = FP_FORMAT_CODES[parts[parts.length - 1]]
		if (format === undefined) return null

		if (parts.length === 2 && FP_ARITHMETIC_FUNCTIONS[parts[0]] !== undefined) {
			const unary = FP_UNARY_OPERATIONS.has(parts[0])
			return this.encodeCop1(
				format,
				unary ? 0 : this.getFpRegisterNumber(args[2]),
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				FP_ARITHMETIC_FUNCTIONS[parts[0]],
			)
		}

		if (parts.length === 3 && FP_CONVERT_FUNCTIONS[`${parts[0]}.${parts[1]}`] !== undefined) {
			return this.encodeCop1(
				format,
				0,
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				FP_CONVERT_FUNCTIONS[`${parts[0]}.${parts[1]}`],
			)
		}

		return null
	}

	encodeCop1(format: number, ft: number, fs: number, fd: number, func: number): number {
		return ((COP1_OPCODE << 26) | (format << 21) | (ft << 16) | (fs << 11) | (fd << 6) | func) >>> 0
	}

	getFpRegisterNumber(arg: MipsArgument | undefined): number {
		if (typeof arg === 'object' && arg.type === 'register') return fpRegisterNumber(arg.value)
		throw new AssemblyError('Expected a floating-point register', this.instructionPosition())
	}

	getCp0RegisterNumber(arg: MipsArgument | undefined): number {
		if (typeof arg === 'object' && arg.type === 'register') return cp0RegisterNumber(arg.value)
		throw new AssemblyError('Expected a coprocessor 0 register', this.instructionPosition())
	}

	encodeRType(name: string, args: MipsArgument[], { opcode, func }: { opcode: number; func: number }): number {
		let rs = 0,
			rt = 0,
			rd = 0,
			shamt = 0

		// Determine argument positions based on instruction
		if (['SLL', 'SRL', 'SRA'].includes(name)) {
			// rd, rt, shamt format
			rd = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			shamt = this.getImmediateValue(args[2])
		} else if (['SLLV', 'SRLV', 'SRAV'].includes(name)) {
			// rd, rt, rs format
			rd = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			rs = this.getRegisterNumber(args[2])
		} else if (['MFHI', 'MFLO'].includes(name)) {
			// rd only
			rd = this.getRegisterNumber(args[0])
		} else if (['MTHI', 'MTLO', 'JR'].includes(name)) {
			// rs only
			rs = this.getRegisterNumber(args[0])
		} else if (['MULT', 'MULTU', 'DIV', 'DIVU'].includes(name)) {
			// rs, rt format
			rs = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
		} else if (['JALR'].includes(name)) {
			// rd, rs format, or rs alone with $ra as the implied link register
			if (args.length === 2) {
				rd = this.getRegisterNumber(args[0])
				rs = this.getRegisterNumber(args[1])
			} else {
				rd = 31
				rs = this.getRegisterNumber(args[0])
			}
		} else {
			// Standard rd, rs, rt format (or variants)
			rd = this.getRegisterNumber(args[0])
			rs = this.getRegisterNumber(args[1])
			rt = this.getRegisterNumber(args[2])
		}

		return ((opcode << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (shamt << 6) | func) >>> 0
	}

	encodeIType(name: string, args: MipsArgument[], opcode: number): number {
		let rs = 0,
			rt = 0,
			imm = 0

		// Load/Store instructions: rt, offset(rs)
		if (LOAD_STORE_NAMES.has(name)) {
			rt = this.getRegisterNumber(args[0])
			if (args[1].type === 'memory') {
				rs = this.getRegisterNumber(args[1].register)
				imm = this.getImmediateValue(args[1].offset) & 0xffff
			} else {
				imm = this.getImmediateValue(args[1]) & 0xffff
			}
		}
		// Branch instructions: rs, rt, offset
		else if (['BEQ', 'BNE'].includes(name)) {
			rs = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			imm = this.getBranchOffset(args[2]) & 0xffff
		}
		// Branch against zero: rs, offset.  bltz and bgez share opcode 1 and are
		// told apart by rt.
		else if (['BGEZ', 'BGTZ', 'BLEZ', 'BLTZ'].includes(name)) {
			rs = this.getRegisterNumber(args[0])
			rt = name === 'BGEZ' ? 1 : 0
			imm = this.getBranchOffset(args[1]) & 0xffff
		}
		// LUI: rt, imm
		else if (name === 'LUI') {
			rt = this.getRegisterNumber(args[0])
			imm = this.getImmediateValue(args[1]) & 0xffff
		}
		// Standard: rt, rs, imm
		else {
			rt = this.getRegisterNumber(args[0])
			rs = this.getRegisterNumber(args[1])
			imm = this.getImmediateValue(args[2]) & 0xffff
		}

		return ((opcode << 26) | (rs << 21) | (rt << 16) | imm) >>> 0
	}

	encodeJType(name: string, args: MipsArgument[], opcode: number): number {
		const address = this.getJumpAddress(args[0]) >> 2
		return ((opcode << 26) | (address & 0x3ffffff)) >>> 0
	}

	getRegisterNumber(arg: MipsArgument | string | undefined): number {
		const name = typeof arg === 'string'
			? arg
			: typeof arg === 'object' && arg.type === 'register' ? arg.value : null
		// Falling back to register 0 here silently drops the operand, which turns
		// `add $t0, $t1, 5` into `add $t0, $t1, $zero` and assembles a wrong answer.
		if (name === null) throw new AssemblyError(`Expected a register, found ${describeArgument(arg)}`, this.instructionPosition())

		const number = registerNumber(name)
		if (number === null) throw new AssemblyError(`Unknown register: ${name}`, this.instructionPosition())
		return number
	}

	getImmediateValue(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) return arg.address
		if (typeof arg === 'object' && 'value' in arg && typeof arg.value === 'number') return arg.value
		return 0
	}

	getBranchOffset(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		// A number in a branch's target position is an offset in words.
		if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) {
			// Offset is relative to PC+4, in words (divide by 4)
			return (arg.address - (this.currentAddress + 4)) >> 2
		}
		return 0
	}

	getJumpAddress(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) {
			return arg.address
		}
		return 0
	}

	resolveArgument(arg: MipsArgument): MipsArgument {
		if (arg.type === 'label') {
			return { ...arg, address: this.labelAddress(this.currentInstruction?.unit ?? '', arg) }
		}
		if (arg.type === 'memory') {
			const offset = this.resolveArgument(arg.offset)
			if (offset.type !== 'immediate' && offset.type !== 'label') throw new AssemblyError('Invalid memory offset', this.instructionPosition())
			return { ...arg, offset }
		}
		return arg
	}
}
