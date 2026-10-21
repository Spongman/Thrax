import type { CallFrame, Diagnostic, KeyboardDisplayState, PendingInput, Registers, SymbolTables } from '../../contracts'
import type { Kind } from './effectKind'

export type { CallFrame, Diagnostic, KeyboardDisplayState, PendingInput, Registers, SymbolTables }

import type { SourceIndex, SourceLocation } from '../../../core/sourceIndex'

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

/**
 * One executed instruction, or one edit the user made, decoded from the history
 * columns for inspection.  A copy: later exchanges do not change it.
 */
export interface HistoryEntry {
	/**
	 * Monotonic, and distinct from an array index: the log drops its oldest
	 * entries past the limit, so an index the panel captured would slide out
	 * from under it.
	 */
	id: number
	/** The count before this instruction ran. */
	instructionCount: number
	address: number
	/** The word executed, for the panel to disassemble. */
	word: number | null
	kind: 'instruction' | 'edit'
	/**
	 * Where execution stood, exchanged like an effect: behind the present this
	 * is where the instruction started, ahead of it where it went.
	 */
	pc: number
	delayState: DelayState
	delayedTarget: number
	/** The run of effects this entry owns, in the shared store. */
	effectStart: number
	effectCount: number
	/**
	 * Copied whole, but only by the instructions that touch them: a file syscall
	 * and a random draw are rare, and neither inverts from its effects.
	 */
	files?: FilesSnapshot
	random?: RandomSnapshot
}

/** MIPS registers by name; every one is a word, so a number. */
export type WordRegisters = Record<string, number>

export interface SimulatorState extends CoprocessorState {
	registers: WordRegisters
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
