import type { Kind } from './effectKind'

import type { SourceIndex, SourceLocation } from './sourceIndex'

export type TokenType =
	| 'COMMA'
	| 'COLON'
	| 'DIRECTIVE'
	| 'DOLLAR'
	| 'EOF'
	| 'IDENTIFIER'
	| 'INSTRUCTION'
	| 'LABEL'
	| 'LPAREN'
	| 'MINUS'
	| 'NEWLINE'
	| 'NUMBER'
	| 'PLUS'
	| 'RPAREN'
	| 'STRING'

export interface TokenData {
	type: TokenType
	value: string
	line: number
	column: number
	/** Source file the token came from, for multi-file assembly. */
	file?: string
	/**
	 * Translation unit the token belongs to: the file assembled in its own
	 * right.  An `.include` is spliced into its includer, so its tokens keep
	 * their own `file` but take the includer's `unit`.
	 */
	unit?: string
}

/** One problem found while assembling, positioned where the editor can mark it. */
export interface Diagnostic {
	severity: 'error' | 'warning'
	message: string
	file?: string
	line?: number
	column?: number
	endColumn?: number
	/** Stable identifier so `warningsAreErrors` can promote some warnings and not others. */
	code?: string
}

export interface RegisterArgument { type: 'register'; value: string }
export interface ImmediateArgument { type: 'immediate'; value: number }
/** `offset` carries the constant of an expression such as `arr+4`. */
export interface LabelArgument { type: 'label'; value: string; offset?: number; address?: number }
export interface StringArgument { type: 'string'; value: string }
export interface MemoryArgument { type: 'memory'; offset: ImmediateArgument | LabelArgument; register: string }

export type MipsArgument = RegisterArgument | ImmediateArgument | LabelArgument | StringArgument | MemoryArgument

export interface DataValue { value: ImmediateArgument | LabelArgument; width: number }

/** A label definition, tagged with the translation unit whose table owns it. */
export interface LabelRef { name: string; unit: string }

export interface DataEntry {
	address: number
	bytes: Array<number | DataValue>
	/** The directive that wrote these bytes, such as `.word` or `.float`. */
	directive?: string
	/** Line and file of the directive, for the editor's gutter. */
	sourceLine?: number
	sourceFile?: string
	/** Translation unit whose symbols a label operand here resolves against. */
	unit?: string
}
/** Segments an instruction can live in; `.data` and `.kdata` hold no instructions. */
export type TextSegment = 'text' | 'ktext'
export type Segment = TextSegment | 'data' | 'kdata'

export interface MipsInstruction {
	name: string
	args: MipsArgument[]
	labels: LabelRef[]
	address: number | null
	sourceLine: number
	/** Column of the mnemonic, so an error here can be marked in the editor. */
	sourceColumn?: number
	sourceFile?: string
	/** Translation unit whose symbols this instruction's labels resolve against. */
	unit?: string
	segment?: TextSegment
}

/** Labels left dangling at the end of a text segment, resolved after layout. */
export interface SegmentEndLabels { segment: TextSegment; labels: LabelRef[] }

/**
 * Symbols are scoped to the file that defined them.  `.globl` moves a name out
 * of its file's table into the one every file can see, and a reference resolves
 * against its own file first, then the global table.
 */
export interface SymbolTables {
	/** Per translation unit, the names only that unit can see. */
	locals: Map<string, Map<string, number>>
	/** Names declared `.globl`, and the `.extern` region, visible everywhere. */
	globals: Map<string, number>
}

export interface MipsProgram {
	instructions: MipsInstruction[]
	/**
	 * Every symbol in one map, for naming an address and for finding the entry
	 * point.  Resolution uses `symbols`, since a name here may belong to a file
	 * the reference cannot see.
	 */
	labels: Map<string, number>
	symbols: SymbolTables
	/**
	 * Where each name was written, per unit, which is not where the word it names
	 * ended up: a label on a line of its own belongs to that line, not to the
	 * instruction beneath it.
	 */
	symbolSites: Map<string, Map<string, SourceLocation>>
	data: DataEntry[]
	/** Which line of which file every machine word came from. */
	sourceIndex: SourceIndex
}

/** One gutter row: the bytes at `address`, and the instruction word when it is code. */
export interface CodeWord {
	address: number
	word: number | null
	bytes: number[]
	/** Directive that wrote a data row's bytes, which is how it reads back. */
	directive?: string
	/** Byte offset of a data row within that directive's data. */
	offset?: number
	/** Set on the last row of data too long to show in full. */
	truncated?: boolean
}

export type Registers = Record<string, number>

/** Coprocessor register files, held as raw 32-bit words. */
export interface CoprocessorState {
	/** `$f0`-`$f31` raw bit patterns; doubles occupy an even/odd pair. */
	fpRegisters: number[]
	/** The eight CP1 condition codes set by `c.eq.s` and friends. */
	fpConditionFlags: boolean[]
	/** CP0 registers, of which vaddr, status, cause, and epc are shown. */
	cp0Registers: number[]
}

/**
 * The machine's memory, as panels read it: words by word address.
 *
 * The map is the simulator's own, handed over rather than copied.  There is one
 * memory and it is written in place, so a copy bought nothing except a fresh
 * identity for React to compare, and it bought that at the price of rebuilding
 * every written word on every publish.  The wrapper is that identity, and costs
 * one object.
 */
export interface MemoryView {
	readonly words: ReadonlyMap<number, number>
}

/** State exposed by the THRAX Keyboard and Display MMIO tool. */
export interface KeyboardDisplayState {
	queuedInput: string
	displayOutput: string
}

/** Serialized state of the syscall 13-16 file table, produced by `FileTable.snapshot`. */
export interface FilesSnapshot {
	contents: Array<{ name: string, bytes: number[] }>
	open: Array<{ descriptor: number, name: string, writable: boolean, position: number }>
	/** Descriptors are handed out in order and never reused, so this restores too. */
	nextDescriptor: number
}

/** Serialized state of the syscall 40-44 random streams, produced by `RandomStreams.snapshot`. */
export interface RandomSnapshot {
	/** Per-stream LCG state, as a string since the generator's state is a bigint. */
	streams: Array<{ id: number, seed: string }>
}

export interface CallFrame {
	callAddress: number
	returnAddress: number
	targetAddress: number
}

export interface PendingInput {
	type: 'integer' | 'string' | 'character' | 'float' | 'double' | 'confirm'
	maximumLength?: number
	/** Where a string read is stored; syscall 8 and 54 disagree on the register. */
	bufferAddress?: number
	/** Shown instead of the generic prompt, for the dialog syscalls. */
	prompt?: string
	/** Dialog reads report an outcome in `$a1` and can be cancelled. */
	dialog?: boolean
}

/** How far along a delayed branch is when an instruction begins. */
export type DelayState = 'none' | 'registered' | 'triggered'

/**
 * One thing an instruction changed.
 *
 * An effect holds the value that is **not** in the machine.  Behind the present
 * that is what the instruction destroyed, which is what a step back needs.
 * Ahead of it, once the effect has been applied, it holds what the instruction
 * produced, which is what running forward needs and what nothing else can
 * reproduce for a syscall that read the console or the clock.
 *
 * Applying an effect exchanges the two, so one operation serves both
 * directions and neither value is ever stored twice.
 */
export type Effect =
	| { kind: typeof Kind.REGISTER, name: string, value: number }
	| { kind: typeof Kind.FP, index: number, value: number }
	| { kind: typeof Kind.FLAG, index: number, value: boolean }
	| { kind: typeof Kind.CP0, index: number, value: number }
	/** A run of words from `wordAddress` up, `undefined` where a word did not exist. */
	| { kind: typeof Kind.MEMORY, wordAddress: number, words: Array<number | undefined> }
	/** Text appended to the console: dropped going back, appended going forward. */
	| { kind: typeof Kind.CONSOLE, text: string }
	/** Syscall 60 empties the console, so the whole of it has to be kept. */
	| { kind: typeof Kind.CONSOLE_RESET, value: string }
	| { kind: typeof Kind.DISPLAY, value: string }
	/** A read of the receiver register took a character out of the queue. */
	| { kind: typeof Kind.QUEUED_INPUT, value: string }
	/** A call frame: taken off going one way, put back going the other. */
	| { kind: typeof Kind.CALL, frame: CallFrame }
	| { kind: typeof Kind.HI_LO, hi: number, lo: number }
	| { kind: typeof Kind.HEAP_POINTER, value: number }
	| { kind: typeof Kind.HALTED, value: boolean }
	| { kind: typeof Kind.EXIT_CODE, value: number | null }
	| { kind: typeof Kind.SLEEP, value: number }
	/**
	 * A change to something the machine holds and does not understand, named by
	 * the service that owns it and the slot within it.  Nothing outside that
	 * service can say what it was, which is the point of it.
	 */
	| { kind: typeof Kind.SERVICE, name: string, service: number, slot: number, value: number }
	/**
	 * What the user typed at a console or dialog read.  The registers and memory
	 * it landed in are effects of their own, so this changes nothing on the way
	 * back or forward; it is here so the history panel can show the answer.
	 */
	| { kind: typeof Kind.INPUT, value: string }

/** One executed instruction, or one edit the user made, and what it did. */
export interface HistoryEntry {
	/**
	 * Monotonic, and distinct from an array index: the log is a ring that drops
	 * its oldest entry past the limit, so an index the panel captured would
	 * slide out from under it.
	 */
	id: number
	/** The count before this instruction ran. */
	instructionCount: number
	address: number
	/** The word executed, for the panel to disassemble. */
	word: number | null
	/** Source metadata for that word, when the debugger has any. */
	instruction: MipsInstruction | null
	kind: 'instruction' | 'edit'
	/**
	 * Where execution stood, exchanged like an effect: behind the present this
	 * is where the instruction started, ahead of it where it went.  These live
	 * on the entry rather than in `effects` because every instruction moves the
	 * pc, and an effect object of its own costs more than three fields here.
	 */
	pc: number
	delayState: DelayState
	delayedTarget: number
	/**
	 * The run of effects this entry owns, in the shared store.  Held as an index
	 * rather than an array of its own: an array per entry costs more in empty
	 * slots than the effects themselves.
	 */
	effectStart: number
	effectCount: number
	/**
	 * Copied whole, but only by the instructions that touch them: a file syscall
	 * and a random draw are rare, and neither inverts from its effects.
	 */
	files?: FilesSnapshot
	random?: RandomSnapshot
}

export interface SimulatorState extends CoprocessorState {
	registers: Registers
	memory: MemoryView
	console: string
	pc: number
	hi: number
	lo: number
	instructionCount: number
	paused: boolean
	halted: boolean
	callStack: CallFrame[]
	pendingInput: PendingInput | null
	heapPointer: number
	keyboardDisplay: KeyboardDisplayState
}
