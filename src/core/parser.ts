/**
 * MIPS Parser - Converts tokens into an AST
 */

import { doubleToBits, singleToBits } from './coprocessor'
import { AssemblyError, at } from './diagnostics'
import { MEMORY_CONFIGURATIONS, type MemoryConfigurationValues } from './settings'
import type { SourceLocation } from './sourceIndex'
import type {
	DataEntry,
	DataValue,
	ImmediateArgument,
	LabelArgument,
	LabelRef,
	MemoryArgument,
	MipsArgument,
	Segment,
	SegmentEndLabels,
	SymbolTables,
	TextSegment,
	TokenData,
} from './types'

/** Base address each segment lays out from, under the selected configuration. */
function segmentStarts(memory: MemoryConfigurationValues): Record<Segment, number> {
	return {
		text: memory.textBaseAddress,
		data: memory.dataBaseAddress,
		ktext: memory.kernelTextBaseAddress,
		kdata: memory.kernelDataBaseAddress,
	}
}

/** Data segments lay out here; the assembler places the text segments. */
type DataSegment = 'data' | 'kdata'

const DATA_DIRECTIVES = ['.word', '.half', '.byte', '.float', '.double', '.ascii', '.asciiz', '.space']

/**
 * Natural boundary each datum is aligned to before it is emitted
 *.  `.byte`, `.ascii` and `.space` align to nothing.
 */
const DATA_ALIGNMENT: Record<string, number> = { '.half': 2, '.word': 4, '.float': 4, '.double': 8 }

function isTextSegment(segment: Segment): segment is TextSegment {
	return segment === 'text' || segment === 'ktext'
}

/** Little-endian IEEE 754 bytes for a `.float` or `.double` initializer. */
function floatBytes(value: number, width: number): number[] {
	if (width === 4) {
		const bits = singleToBits(value)
		return [0, 1, 2, 3].map((index) => (bits >>> (index * 8)) & 0xff)
	}
	const { low, high } = doubleToBits(value)
	return [...[0, 1, 2, 3].map((index) => (low >>> (index * 8)) & 0xff), ...[0, 1, 2, 3].map((index) => (high >>> (index * 8)) & 0xff)]
}

export class Instruction {
	address: number | null = null

	constructor(
		public name: string,
		public args: MipsArgument[] = [],
		public labels: LabelRef[] = [],
		public sourceLine = 0,
		public sourceFile = '',
		public segment: TextSegment = 'text',
		public sourceColumn = 0,
		public unit = '',
	) {}
}

/**
 * What one parse produced.  Instructions arrive without addresses: they only
 * get them once the assembler has expanded the pseudo-instructions between
 * them, so text layout is the assembler's alone.
 */
export interface ParseResult {
	instructions: Instruction[]
	symbols: SymbolTables
	/** Names `.globl` moved out of their file's table, and the file each came from. */
	globalNames: Map<string, string>
	/** Where each name was written, per unit: the line the label itself is on. */
	symbolSites: Map<string, Map<string, SourceLocation>>
	data: DataEntry[]
	/** Text labels with no instruction after them; the assembler places them. */
	segmentEndLabels: SegmentEndLabels[]
	/** Base address of each text segment, which `.text 0x...` may override. */
	segmentStarts: Record<TextSegment, number>
}

export class Parser {
	pos: number
	instructions: Instruction[]
	/** Per-unit tables, populated as data labels bind; text labels bind later. */
	locals: Map<string, Map<string, number>>
	/** `.extern` allocates here directly; `.globl` names arrive after the layout. */
	globals: Map<string, number>
	/** Every `.globl` declaration, checked once the whole program has been read. */
	globalDeclarations: Array<{ name: string, unit: string, token: TokenData }>
	data: DataEntry[]
	segment: Segment
	/** Where the next data directive lands; data labels bind to final addresses. */
	addresses: Record<DataSegment, number>
	/** Labels awaiting the next emission in their own segment. */
	pendingLabels: Record<Segment, LabelRef[]>
	segmentStarts: Record<TextSegment, number>
	segmentEndLabels: SegmentEndLabels[]
	/** Names each unit has defined, so the same name can occur in two files. */
	definedLabels: Map<string, Set<string>>
	/** The line each of those names is written on, which is where it is defined. */
	symbolSites: Map<string, Map<string, SourceLocation>>
	/** Automatic data alignment, off from `.align 0` until the next `.data`. */
	autoAlign: boolean
	/** `.extern` allocates here; the cursor spans the whole assembly, not one file. */
	externAddress: number
	seenFiles: Set<string>
	currentFile: string | null
	/** Unit of the token being read, which is the file that owns its labels. */
	currentUnit: string

	/**
	 * `topLevelFiles` names the files assembled in their own right, so that an
	 * `.include`, which is spliced into its includer, is not taken for one.
	 */
	constructor(
		public tokens: TokenData[],
		public topLevelFiles: ReadonlySet<string> = new Set(),
		public memory: MemoryConfigurationValues = MEMORY_CONFIGURATIONS.default,
	) {
		const starts = segmentStarts(memory)
		this.tokens = tokens
		this.pos = 0
		this.instructions = []
		this.locals = new Map()
		this.globals = new Map()
		this.globalDeclarations = []
		this.data = []
		this.segment = 'text'
		this.addresses = { data: starts.data, kdata: starts.kdata }
		this.pendingLabels = { text: [], data: [], ktext: [], kdata: [] }
		this.segmentStarts = { text: starts.text, ktext: starts.ktext }
		this.segmentEndLabels = []
		this.definedLabels = new Map()
		this.symbolSites = new Map()
		this.autoAlign = true
		// Initialized once per assembly, not once per file.
		this.externAddress = memory.externBaseAddress
		this.seenFiles = new Set()
		this.currentFile = null
		this.currentUnit = ''
	}

	/** The unit's table, created on first use so an empty file still has one. */
	localTable(unit: string): Map<string, number> {
		let table = this.locals.get(unit)
		if (!table) {
			table = new Map()
			this.locals.set(unit, table)
		}
		return table
	}

	/**
	 * Where a name is written.  An `.include` keeps its own file, so the site
	 * names the file the text is in rather than the unit that owns the name.
	 */
	recordSite(unit: string, name: string, token: TokenData) {
		let sites = this.symbolSites.get(unit)
		if (!sites) {
			sites = new Map()
			this.symbolSites.set(unit, sites)
		}
		sites.set(name, { file: token.file ?? '', line: token.line })
	}

	parse(): ParseResult {
		while (!this.isAtEnd()) {
			this.skipNewlines()
			if (this.isAtEnd()) break

			const token = this.peek()
			this.currentUnit = token.unit ?? token.file ?? ''
			this.enterFile(token.file ?? '')

			if (token.type === 'LABEL') {
				this.defineLabel(token.value, token)
				this.advance() // consume label
				this.consume('COLON', 'Expected ":" after label')
				this.skipNewlines()
				continue
			}

			if (token.type === 'DIRECTIVE') {
				this.parseDirective()
				continue
			}

			if (token.type === 'INSTRUCTION') {
				this.parseInstruction()
				continue
			}

			throw new AssemblyError(`Unexpected token "${token.value}"`, at(token))
		}

		this.flushPendingLabels()
		const globalNames = this.checkGlobalDeclarations()

		return {
			instructions: this.instructions,
			symbols: { locals: this.locals, globals: this.globals },
			globalNames,
			symbolSites: this.symbolSites,
			data: this.data,
			segmentEndLabels: this.segmentEndLabels,
			segmentStarts: this.segmentStarts,
		}
	}

	parseInstruction() {
		const instructionToken = this.consume('INSTRUCTION')
		const segment = this.segment
		if (!isTextSegment(segment)) {
			throw new AssemblyError(`Instruction in .${segment} segment`, at(instructionToken))
		}
		const args = this.parseArguments()
		const file = instructionToken.file ?? ''
		this.instructions.push(new Instruction(instructionToken.value.toUpperCase(), args, this.takePendingLabels(segment), instructionToken.line, file, segment, instructionToken.column, this.currentUnit))
		this.skipNewlines()
	}

	parseDirective() {
		const directiveToken = this.consume('DIRECTIVE')
		const name = directiveToken.value.toLowerCase()
		const args = this.parseArguments()

		if (name === '.text' || name === '.data' || name === '.ktext' || name === '.kdata') {
			this.segment = name.slice(1) as Segment
			// Only a data segment restores automatic alignment.
			if (name === '.data' || name === '.kdata') this.autoAlign = true
			// An explicit base address is allowed, as in `.ktext 0x80000180`.
			if (args.length > 0) this.setSegmentAddress(this.segment, this.requireImmediate(args[0], name, directiveToken), directiveToken)
		} else if (name === '.globl' || name === '.global') {
			this.addGlobalDeclarations(name, args, directiveToken)
		} else if (name === '.set') {
			// An assembler option, which emits nothing.
		} else if (name === '.extern') {
			this.addExtern(name, args, directiveToken)
		} else if (name === '.align') {
			if (this.segment !== 'data' && this.segment !== 'kdata') {
				throw new AssemblyError(`${name} is only supported in .data`, at(directiveToken))
			}
			const exponent = this.requireImmediate(args[0], name, directiveToken)
			if (exponent < 0 || exponent > 30) throw new AssemblyError(`Invalid alignment for ${name}`, at(directiveToken))
			// `.align 0` turns automatic alignment off instead of aligning.
			if (exponent === 0) this.autoAlign = false
			else this.alignTo(this.segment as DataSegment, 2 ** exponent)
		} else if (DATA_DIRECTIVES.includes(name)) {
			if (this.segment !== 'data' && this.segment !== 'kdata') {
				throw new AssemblyError(`${name} is only supported in .data`, at(directiveToken))
			}
			this.addDataDirective(name, args, directiveToken)
		} else {
			throw new AssemblyError(`Unsupported directive: ${name}`, at(directiveToken))
		}
		this.skipNewlines()
	}

	setSegmentAddress(segment: Segment, address: number, token: TokenData) {
		// Pseudo-instructions expand after parsing, so a text segment can only be
		// based once: later instructions follow the ones already emitted.
		if (isTextSegment(segment)) {
			if (this.instructions.some((instruction) => instruction.segment === segment)) {
				throw new AssemblyError(`.${segment} cannot be restarted at a new address`, at(token))
			}
			this.segmentStarts[segment] = address
			return
		}
		this.addresses[segment] = address
	}

	/**
	 * `.extern name, size` names `size` bytes of the extern region.  It emits
	 * nothing, and a name already known allocates nothing and leaves the cursor
	 * where it was.
	 */
	addExtern(name: string, args: MipsArgument[], token: TokenData) {
		const label = args[0]
		if (!label || label.type !== 'label') throw new AssemblyError(`${name} expects a label`, at(token))
		const size = this.requireImmediate(args[1], name, token)
		if (size < 0) throw new AssemblyError(`${name} size must be non-negative`, at(token))

		// A name already global names the same storage, and allocates nothing more.
		if (this.globals.has(label.value)) return
		this.recordSite(this.currentUnit, label.value, token)
		this.globals.set(label.value, this.externAddress)
		this.externAddress += size
	}

	/**
	 * Rounds the cursor up to `alignment`, carrying any label already bound to the
	 * old address forward with it, as `fixSymbolTableAddress` does
	 *.
	 */
	alignTo(segment: DataSegment, alignment: number) {
		const address = this.addresses[segment]
		const aligned = Math.ceil(address / alignment) * alignment
		if (aligned === address) return
		for (const table of this.locals.values()) {
			for (const [label, bound] of table) if (bound === address) table.set(label, aligned)
		}
		this.addresses[segment] = aligned
	}

	/**
	 * Automatic alignment is restored at the start of each source file
	 *.  An included file is part of its includer there, so
	 * only a file assembled in its own right, and only on first entry, resets it.
	 */
	enterFile(file: string) {
		if (file === this.currentFile) return
		this.currentFile = file
		if (this.topLevelFiles.has(file) && !this.seenFiles.has(file)) this.autoAlign = true
		this.seenFiles.add(file)
	}

	addDataDirective(name: string, args: MipsArgument[], token: TokenData) {
		const segment = this.segment as DataSegment
		const alignment = DATA_ALIGNMENT[name]
		if (this.autoAlign && alignment) this.alignTo(segment, alignment)
		const start = this.addresses[segment]
		this.bindPendingLabels(segment, start)
		let bytes: Array<number | DataValue> = []

		if (name === '.space') {
			const length = this.requireImmediate(args[0], name, token)
			if (length < 0) throw new AssemblyError('.space length must be non-negative', at(token))
			bytes = new Array(length).fill(0)
		} else if (name === '.ascii' || name === '.asciiz') {
			for (const arg of args) {
				if (arg.type !== 'string') throw new AssemblyError(`${name} expects string operands`, at(token))
				for (let i = 0; i < arg.value.length; i++) bytes.push(arg.value.charCodeAt(i) & 0xff)
			}
			if (name === '.asciiz') bytes.push(0)
		} else if (name === '.float' || name === '.double') {
			for (const arg of args) {
				if (arg.type !== 'immediate') throw new AssemblyError(`${name} expects numeric operands`, at(token))
				bytes.push(...floatBytes(arg.value, name === '.float' ? 4 : 8))
			}
		} else {
			const width = name === '.word' ? 4 : name === '.half' ? 2 : 1
			for (const arg of args) {
				if (arg.type !== 'immediate' && arg.type !== 'label') {
					throw new AssemblyError(`${name} expects numeric or label operands`, at(token))
				}
				if (arg.type === 'immediate' && !Number.isInteger(arg.value)) {
					throw new AssemblyError(`${name} expects integer operands; use .float or .double`, at(token))
				}
				bytes.push({ value: arg, width })
			}
		}

		this.data.push({ address: start, bytes, directive: name, sourceLine: token.line, sourceFile: token.file ?? '', unit: this.currentUnit })
		this.addresses[segment] = start + bytes.reduce<number>((size, item) => size + (typeof item === 'number' ? 1 : item.width), 0)
	}

	/** A name is unique within its own file; two files may each define it. */
	defineLabel(name: string, token: TokenData) {
		const unit = this.currentUnit
		let defined = this.definedLabels.get(unit)
		if (!defined) {
			defined = new Set()
			this.definedLabels.set(unit, defined)
		}
		if (defined.has(name)) throw new AssemblyError(`Duplicate label: ${name}`, at(token))
		defined.add(name)
		this.recordSite(unit, name, token)
		this.localTable(unit)
		this.pendingLabels[this.segment].push({ name, unit })
	}

	takePendingLabels(segment: Segment): LabelRef[] {
		const labels = this.pendingLabels[segment]
		this.pendingLabels[segment] = []
		return labels
	}

	bindPendingLabels(segment: Segment, address: number) {
		for (const { name, unit } of this.takePendingLabels(segment)) this.localTable(unit).set(name, address)
	}

	/**
	 * `.globl name, ...` declares names its file defines and every other file
	 * may reference.  The move happens once the whole program is read, since a
	 * declaration is free to precede the definition it names.
	 */
	addGlobalDeclarations(name: string, args: MipsArgument[], token: TokenData) {
		if (args.length === 0) throw new AssemblyError(`${name} expects a label`, at(token))
		for (const arg of args) {
			if (arg.type !== 'label') throw new AssemblyError(`${name} expects a label`, at(token))
			this.globalDeclarations.push({ name: arg.value, unit: this.currentUnit, token })
		}
	}

	/**
	 * Which names become global, rejecting a declaration its own file never
	 * defines and a name two files both claim.
	 */
	checkGlobalDeclarations(): Map<string, string> {
		const globalNames = new Map<string, string>()
		for (const { name, unit, token } of this.globalDeclarations) {
			if (!this.definedLabels.get(unit)?.has(name)) {
				throw new AssemblyError(`Global label is not defined in this file: ${name}`, at(token))
			}
			if (globalNames.has(name) || this.globals.has(name)) {
				throw new AssemblyError(`Global label is already defined in another file: ${name}`, at(token))
			}
			globalNames.set(name, unit)
		}
		return globalNames
	}

	/**
	 * Labels left over at the end of input name the end of their segment.  Data
	 * addresses are already final; text addresses shift as pseudo-instructions
	 * expand, so the assembler resolves those once the layout is known.
	 */
	flushPendingLabels() {
		for (const segment of ['data', 'kdata'] as const) this.bindPendingLabels(segment, this.addresses[segment])
		for (const segment of ['text', 'ktext'] as const) {
			const labels = this.takePendingLabels(segment)
			if (labels.length > 0) this.segmentEndLabels.push({ segment, labels })
		}
	}

	requireImmediate(arg: MipsArgument | undefined, directive: string, token: TokenData): number {
		if (!arg || arg.type !== 'immediate') throw new AssemblyError(`${directive} expects an immediate value`, at(token))
		return arg.value
	}

	parseArguments(): MipsArgument[] {
		const args: MipsArgument[] = []

		while (!this.isAtEnd() && this.peek().type !== 'NEWLINE' && this.peek().type !== 'EOF') {
			const position = this.pos
			const arg = this.parseArgument()
			if (arg) args.push(arg)

			if (this.peek().type === 'COMMA') {
				this.advance()
			}
			// An argument that consumes nothing would spin here forever.
			if (this.pos === position) break
		}

		return args
	}

	parseArgument(): MipsArgument | null {
		const token = this.peek()

		if (token.type === 'DOLLAR') {
			this.advance()
			// Registers may be named by number, as in `$8` or `mfc0 $t0, $13`.
			if (this.peek().type === 'NUMBER') return { type: 'register', value: '$' + this.consume('NUMBER').value }
			const regToken = this.consume('IDENTIFIER', 'Expected register name')
			return { type: 'register', value: '$' + regToken.value }
		}

		if (['MINUS', 'PLUS', 'NUMBER', 'IDENTIFIER', 'INSTRUCTION'].includes(token.type)) {
			return this.parseMemoryOperand(this.parseExpression())
		}

		if (token.type === 'LPAREN') {
			this.advance()
			this.consume('DOLLAR', 'Expected $ in memory operand')
			const register = this.consume('IDENTIFIER').value
			this.consume('RPAREN', 'Expected )')
			return { type: 'memory', offset: { type: 'immediate', value: 0 }, register: '$' + register }
		}

		if (token.type === 'STRING') {
			return { type: 'string', value: this.consume('STRING').value }
		}

		return null
	}

	/**
	 * A sum of constants and at most one label, as in `4`, `-1`, `arr+4`, or
	 * `end-start`... which the single label restriction rejects.
	 */
	parseExpression(): ImmediateArgument | LabelArgument {
		let label: string | null = null
		let value = 0
		let sign = 1

		// A leading sign, as in `-16`, precedes the first term.
		const leading = this.peek()
		if (leading.type === 'PLUS' || leading.type === 'MINUS') {
			sign = leading.type === 'MINUS' ? -1 : 1
			this.advance()
		}

		for (;;) {
			const token = this.peek()
			// An instruction name in operand position is a label: a mnemonic may
			// name one, and an identifier is substituted here.
			if (token.type === 'IDENTIFIER' || token.type === 'INSTRUCTION') {
				if (label !== null) throw new AssemblyError('Only one label is allowed per expression', at(token))
				if (sign < 0) throw new AssemblyError('A label cannot be negated', at(token))
				label = token.value
				this.advance()
			} else if (token.type === 'NUMBER') {
				value += sign * this.parseNumber(token.value, token)
				this.advance()
			} else {
				throw new AssemblyError('Expected a number or label', at(token))
			}

			const operator = this.peek()
			if (operator.type !== 'PLUS' && operator.type !== 'MINUS') break
			sign = operator.type === 'MINUS' ? -1 : 1
			this.advance()
		}

		return label === null ? { type: 'immediate', value } : { type: 'label', value: label, offset: value }
	}

	parseMemoryOperand(offset: ImmediateArgument | LabelArgument): ImmediateArgument | LabelArgument | MemoryArgument {
		if (this.peek().type !== 'LPAREN') return offset
		this.advance()
		this.consume('DOLLAR', 'Expected $ in memory operand')
		const register = this.peek().type === 'NUMBER'
			? this.consume('NUMBER').value
			: this.consume('IDENTIFIER', 'Expected register name').value
		this.consume('RPAREN', 'Expected )')
		return { type: 'memory', offset, register: '$' + register }
	}

	parseNumber(str: string, token: TokenData): number {
		if (str.startsWith('0x') || str.startsWith('0X')) {
			return parseInt(str, 16)
		}
		// A leading zero means octal, as Java's Integer.decode reads it.
		if (/^0[0-7]+$/.test(str)) {
			return parseInt(str, 8)
		}
		const value = Number(str)
		if (Number.isNaN(value)) throw new AssemblyError(`Invalid number: ${str}`, at(token))
		return value
	}

	skipNewlines() {
		while (this.peek().type === 'NEWLINE') {
			this.advance()
		}
	}

	peek(offset = 0): TokenData {
		const pos = this.pos + offset
		return pos < this.tokens.length ? this.tokens[pos] : this.tokens[this.tokens.length - 1]
	}

	advance() {
		if (!this.isAtEnd()) this.pos++
	}

	consume(type: TokenData['type'], message = ''): TokenData {
		if (this.peek().type !== type) {
			throw new AssemblyError(message || `Expected ${type}`, at(this.peek()))
		}
		const token = this.peek()
		this.advance()
		return token
	}

	isAtEnd() {
		return this.peek().type === 'EOF'
	}
}
