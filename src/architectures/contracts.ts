/**
 * The neutral contract between the shared workbench and an architecture.
 *
 * Shared code (store, debugger, panels, tools) depends only on these types and
 * on whatever the active architecture supplies through them.  An architecture
 * implements them over its own CPU, assembler and history; nothing here names a
 * concrete instruction set.
 */

import type { ComponentType, ReactElement } from 'react'
import type * as Monaco from 'monaco-editor'
import type { ExecutionObserver, MachineConfig } from '../core/observer'
import type { ArchitectureSettings, TargetSettings } from '../core/settings'
import type { SourceIndex } from '../core/sourceIndex'

/** Source identities are workspace paths, independent of editor model URIs. */
export interface SourceFile { name: string; code: string }

export interface SourceLocation { file: string; line: number; column?: number }

/** Byte-oriented output shared by assemblers and debugger adapters. */
export interface ProgramImage {
	sections: readonly { address: number; bytes: Uint8Array }[]
	entryAddress: number | null
	symbols: readonly { name: string; address: number; scope?: string }[]
	sourceMappings: readonly {
		address: number
		byteLength: number
		kind: 'instruction' | 'data'
		source: SourceLocation
	}[]
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

export interface Disposable { dispose(): void }

/** A bundled program offered in the Examples menu. */
export interface Example {
	name: string
	description: string
	code: string
}

/* ---------------------------------------------------------------- registers */

/** How a register's bits read: as an integer, IEEE-754 bits, or one flag bit. */
export class RegisterFormat {
	static readonly INTEGER = 0
	static readonly FLOAT = 1
	static readonly FLAG = 2
}

export interface RegisterDescriptor {
	/** Stable key: register values, edits, hover and navigation all use it. */
	id: string
	name: string
	/** The register panel tab it is shown on. */
	bank: string
	/** Heading it is listed under within the bank; the bank's label when absent. */
	group?: string
	bits: number
	editable: boolean
	aliases?: readonly string[]
	role?: 'programCounter' | 'stackPointer' | 'link' | 'flags'
	/** A `RegisterFormat`; integer when absent. */
	format?: number
	/** The register holding the high half when this one starts a double. */
	pairsWith?: string
}

export interface RegisterBank { id: string; label: string }

/**
 * A register's bits: a number for a register of 32 bits or fewer, and for a
 * wider one a bigint, unsigned and below 2^bits, so every bit stays exact.
 */
export type RegisterValue = number | bigint

/** Register values by descriptor id. */
export type Registers = Record<string, RegisterValue>

/* ------------------------------------------------------------------- memory */

/**
 * Debugger reads of memory.  Never faults, never reaches a device, never tells
 * an observer: inspecting the machine must not change it.
 */
export interface MemoryInspector {
	readonly wordBytes: number
	readonly littleEndian: boolean
	/** The byte at `address`, or undefined where nothing was ever written. */
	byte(address: number): number | undefined
	/** The aligned word holding `address`, or undefined where nothing was ever written. */
	word(address: number): number | undefined
}

export const EMPTY_MEMORY: MemoryInspector = Object.freeze({
	wordBytes: 4,
	littleEndian: true,
	byte: () => undefined,
	word: () => undefined,
})

/** A region the memory view offers to jump to. */
export interface MemorySection {
	id: string
	label: string
	start: number
	end: number
	/** Holds instructions, so a hovered word there is disassembled. */
	code?: boolean
}

/** Layout facts the panels need, under the settings in force. */
export interface MachineProfile {
	/** Registers as a reset leaves them, before any program loads. */
	readonly resetRegisters: Registers
	readonly resetPc: number
	readonly memorySections: readonly MemorySection[]
	/** Where program data usually starts, which views addressing memory default to. */
	readonly dataBase?: number
	/** Whether a value names memory, so only real addresses light across panels. */
	isMappedAddress(value: number): boolean
}

/* -------------------------------------------------------------- program data */

export interface CallFrame {
	callAddress: number
	returnAddress: number
	targetAddress: number
}

export interface PendingInput {
	type: 'integer' | 'string' | 'character' | 'float' | 'double' | 'confirm'
	maximumLength?: number
	/** Where a string read is stored. */
	bufferAddress?: number
	/** Shown instead of the generic prompt. */
	prompt?: string
	/** Dialog reads report an outcome and can be cancelled. */
	dialog?: boolean
}

/**
 * Symbols are scoped to the unit that defined them; globals are visible
 * everywhere.
 */
export interface SymbolTables {
	locals: Map<string, Map<string, number>>
	globals: Map<string, number>
}

/** A run of bytes a data directive laid out. */
export interface DataDeclaration {
	address: number
	bytes: ArrayLike<unknown>
	directive?: string
}

/** What the debugger and panels read of an assembled program. */
export interface LoadedProgram {
	readonly sourceIndex: SourceIndex
	readonly symbols: SymbolTables
	readonly symbolSites: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>>
	readonly labels: ReadonlyMap<string, number>
	readonly data: readonly DataDeclaration[]
	/** Addresses the source asks to stop at, set as breakpoints when the program is built. */
	readonly breakpoints?: readonly number[]
}

/** Assembly output; errors come back as diagnostics, never as a partial machine. */
export interface AssembledProgram extends LoadedProgram {
	readonly diagnostics: Diagnostic[]
	/** The program as addressed bytes, built on request. */
	image(): ProgramImage
}

export interface AssemblySources {
	files: SourceFile[]
	/** Files assembled in their own right; the rest are only visible to includes. */
	entries: string[]
}

/* ------------------------------------------------------------- disassembly */

/** One gutter row: an instruction, or a run of data bytes. */
export interface CodeRow {
	address: number
	/** An instruction's encoding as conventionally written, or data bytes in address order. */
	bytes: number[]
	instruction: boolean
	/** Directive that wrote a data row's bytes, which is how it reads back. */
	directive?: string
	/** Byte offset of a data row within that directive's data. */
	offset?: number
	/** Set on the last row of data too long to show in full. */
	truncated?: boolean
}

export interface Disassembly {
	/** A gutter row as assembly; `next` follows it in address order. */
	row(row: CodeRow, next?: CodeRow): string
	/** The instruction held at `address`, or null where none decodes. */
	at(memory: MemoryInspector, address: number): string | null
}

/* ----------------------------------------------------------------- history */

/** One executed instruction, or one edit the user made. */
export interface HistoryRecord {
	readonly id: number
	/** The count before this instruction ran. */
	readonly instructionCount: number
	readonly address: number
	readonly kind: 'instruction' | 'edit'
}

/** The machine's history log, oldest first. */
export interface MachineHistory {
	readonly length: number
	at(index: number): HistoryRecord | undefined
	slice(from: number, to: number): HistoryRecord[]
	indexOfId(id: number): number
}

export const EMPTY_HISTORY: MachineHistory = Object.freeze({
	length: 0,
	at: () => undefined,
	slice: () => [],
	indexOfId: () => -1,
})

/**
 * What one recorded effect did, taken apart for the history panel.  `applied`
 * puts the value after the arrow: ahead of the present it is what the
 * instruction produced, behind it what it destroyed.
 */
export interface DescribedEffect {
	/** What changed: a register name, a bracketed address, `console`. */
	subject: string
	/** The register id this names, when a click should go to one. */
	register?: string
	/** An address this names, when a click should go to the memory view. */
	address?: number
	value?: RegisterValue
	/** A second word, for registers that move together. */
	second?: RegisterValue
	/** What is held when it is not a word. */
	text?: string
	/** What the effect carries rather than what it replaced. */
	detail?: string
	applied: boolean
	/** The whole of it as one string. */
	label: string
}

/** Renders history entries; built only for the rows on screen. */
export interface HistoryFormatter {
	instruction(entry: HistoryRecord): string
	effects(entry: HistoryRecord, applied: boolean): DescribedEffect[]
}

/* -------------------------------------------------------- instruction events */

/** Neutral instruction classes; counted by index, so keep them dense. */
export class InstructionCategory {
	static readonly ALU = 0
	static readonly JUMP = 1
	static readonly BRANCH = 2
	static readonly MEMORY = 3
	static readonly COPROCESSOR = 4
	static readonly TRAP = 5
	static readonly OTHER = 6
}

/** What tools know of an instruction, computed once per decoded form. */
export interface InstructionInfo {
	readonly mnemonic: string
	/** An `InstructionCategory`. */
	readonly category: number
	/** Index into `InstructionSet.encodings`. */
	readonly encoding: number
	/** Integer registers read, by bank index; the hardwired zero is left out. */
	readonly reads: readonly number[]
	/** Integer register written, or -1. */
	readonly writes: number
	readonly isLoad: boolean
	readonly isBranch: boolean
	readonly isJump: boolean
}

/**
 * How tools read the opaque decoded instruction an observer is handed.  The
 * architecture caches `describe`, so a tool calling it per instruction pays a
 * lookup rather than a classification.
 */
export interface InstructionSet {
	/** Labels of the encoding classes `InstructionInfo.encoding` indexes. */
	readonly encodings: readonly string[]
	/** Names of the integer registers, by index. */
	readonly registerNames: readonly string[]
	describe(instruction: unknown): InstructionInfo
	/** The instruction a history entry ran, decoded for replay, or null. */
	decodeExecuted(entry: HistoryRecord): unknown
	/** The pipeline the timing tool models; no pipeline view without it. */
	readonly pipeline?: PipelineModel
}

/* ---------------------------------------------------------------- pipeline */

export interface PipelineStage {
	/** Column label, e.g. `IF`. */
	label: string
	name: string
	/** Colour slot of the timeline, `if` `id` `ex` `mem` or `wb`. */
	kind: string
}

/** Bit flags of the results a bypass carries. */
export class PipelineResult {
	/** Anything an ALU or the PC + 4 path computes. */
	static readonly ALU = 1
	/** Data a load brings back from memory. */
	static readonly LOAD = 2
}

/**
 * A path delivering a result held in stage `from` to an instruction using its
 * operands in the policy's `useStage` on the same cycle.
 */
export interface PipelineBypass {
	from: number
	/** `PipelineResult` flags. */
	results: number
}

/**
 * One option for a choice the user makes.  `value` is the persisted setting,
 * so it stays the same across models offering the same idea.
 */
export interface PipelineOption {
	value: string
	label: string
}

/** A way of handling read-after-write hazards. */
export interface PipelineHazardPolicy extends PipelineOption {
	/** Stage on whose cycle the operands must be present. */
	useStage: number
	bypasses: readonly PipelineBypass[]
	/** The register file returns a value written on the same cycle it is read. */
	writeThenRead: boolean
}

/** Where a control transfer redirects the fetch. */
export interface PipelineResolution extends PipelineOption {
	stage: number
}

/**
 * An in-order, single-issue pipeline as data.  Stage 0 fetches; an instruction
 * waiting for an operand is held in `readStage`, and every stage after that
 * takes one cycle.  A setting naming no option of a list takes its first.
 */
export interface PipelineModel {
	stages: readonly PipelineStage[]
	/** Stage that reads the register file and holds an instruction that stalls. */
	readStage: number
	/** Stage at whose end the register file is written. */
	writeStage: number
	hazards: readonly PipelineHazardPolicy[]
	/** Where a taken conditional branch is decided. */
	branches: readonly PipelineResolution[]
	/** Where an unconditional jump is decided. */
	jumps: readonly PipelineResolution[]
	/**
	 * Instructions after a transfer the machine runs anyway when it reports
	 * delayed branching; the rest fetched before resolution are annulled.
	 */
	delaySlots: number
}

/* ----------------------------------------------------------------- machine */

/** What the debugger drives.  Faults are thrown as errors. */
export interface RunControl {
	readonly pc: number
	readonly halted: boolean
	readonly paused: boolean
	readonly pendingInput: PendingInput | null
	readonly instructionCount: number
	readonly breakpoints: ReadonlySet<number>
	run(): Promise<void>
	continue(): Promise<void>
	step(): void
	stepBack(): boolean
	stepOver(): Promise<void>
	stepToReturn(): Promise<void>
	runTo(address: number): Promise<void>
	pause(): void
	stop(): void
	setProgramCounter(address: number): void
	configure(options: { speed?: number | null, pacedAddresses?: ReadonlySet<number> | null }): void
	addBreakpoint(address: number): void
	removeBreakpoint(address: number): void
	getBreakpoints(): Iterable<number>
}

/** State of an optional memory-mapped keyboard and display. */
export interface KeyboardDisplayState {
	queuedInput: string
	displayOutput: string
}

export interface KeyboardDisplayDevice {
	state(): KeyboardDisplayState
	queue(input: string): void
}

/** One running instance of a program.  Owns its CPU, devices and history. */
export interface Machine extends RunControl, Disposable {
	readonly console: string
	readonly callStack: readonly CallFrame[]
	readonly program: LoadedProgram
	/** Called between batches of a paced run. */
	onProgress: (() => void) | null
	provideInput(input: string, cancelled?: boolean): boolean
	/** Every register by descriptor id, as a fresh record. */
	registerValues(): Registers
	/** A user edit, recorded as a history entry; false when refused. */
	writeRegister(id: string, value: RegisterValue): boolean
	/** Side-effect-free memory reads, under a fresh identity per call. */
	inspectMemory(): MemoryInspector
	writeByte(address: number, value: number): boolean
	insertByte(address: number, limit: number, value: number): boolean
	deleteByte(address: number, limit: number): boolean
	readonly history: MachineHistory
	/** How many entries stand behind the present. */
	readonly historyCursor: number
	readonly historyFormat: HistoryFormatter
	/** Steps back until the entry with `id` has been undone. */
	rewindTo(id: number): boolean
	/** Called per instruction only while non-empty. */
	readonly observers: ExecutionObserver[]
	/** What a tool attached to this machine is configured with. */
	toolConfig(): MachineConfig
	readonly keyboardDisplay?: KeyboardDisplayDevice
}

export interface MachineOptions {
	speed: number | null
	/** Instructions the history keeps, and so how far back a run can be stepped. */
	historyLimit: number
}

/* ----------------------------------------------------------- editor and tips */

/** What the debugger can show about a token: registers, memory and labels as they stand. */
export interface DebugInspection {
	registers: Registers
	memory: MemoryInspector
	labels: ReadonlyMap<string, number>
}

/** One token of a line, and what it is worth. */
export interface TokenDescription {
	start: number
	length: number
	/** Markdown, one paragraph per entry. */
	contents: string[]
	register?: string
	address?: number
}

/** What the editor integration reads from the workspace. */
export interface EditorHost {
	files(): readonly { title: string, code: string }[]
	active(): string | undefined
	open(file: string, line: number): void
	inspection(): DebugInspection
}

/* ------------------------------------------------------------ contributions */

/** A dock panel an architecture supplies; shown as unavailable elsewhere. */
export interface PanelContribution {
	id: string
	icon: () => ReactElement
	title: string
	menuTitle?: string
	description?: string
	group: 'window' | 'tool'
	dock: 'side' | 'bottom'
	load: () => Promise<{ default: ComponentType }>
}

/** A tool an architecture supplies; shown and run like the shared tools. */
export interface ToolContribution {
	/** Names the tool, the field its snapshot lands in, and the panel that consumes it. */
	key: string
	tool: ExecutionObserver & { snapshot(): unknown }
}

/* ------------------------------------------------------------ the services */

/**
 * The configured facade the store and panels use for the active target.  Each
 * call takes the architecture's own settings, as its definition declares them.
 */
export interface ArchitectureServices<Settings extends TargetSettings = TargetSettings> extends Disposable {
	assemble(sources: AssemblySources, settings: Settings): AssembledProgram
	/** A machine over a program that assembled without errors. */
	createMachine(program: AssembledProgram, settings: Settings, options: MachineOptions): Machine
	profile(settings: Settings): MachineProfile
	readonly disassembly: Disassembly
	/** Text-segment words for HexText export, where the target has them. */
	exportWords?(program: AssembledProgram): readonly number[]
	/** Describes a token of disassembly under the pointer. */
	describeToken?(text: string, column: number, state: DebugInspection): TokenDescription | null
	installEditor(monaco: typeof Monaco, host: EditorHost): Promise<Disposable>
	/** Fresh tools for each activation, run only while a panel of the same key is open. */
	createTools?(): readonly ToolContribution[]
}

/** What of a definition its settings can change. */
export interface ArchitectureVariant {
	/** Monaco language id its sources are edited in. */
	language?: string
	registers: readonly RegisterDescriptor[]
	registerBanks?: readonly RegisterBank[]
	examples: Readonly<Record<string, Example>>
}

/** Factories own mutable state; definitions hold only configuration. */
export interface ArchitectureDefinition<Services = ArchitectureServices> {
	id: string
	name: string
	/** Monaco language id its sources are edited in. */
	language?: string
	/** Source file extensions, the one new files take first; `.asm` and `.s` when absent. */
	fileExtensions?: readonly string[]
	registers: readonly RegisterDescriptor[]
	registerBanks?: readonly RegisterBank[]
	examples: Readonly<Record<string, Example>>
	/** Its own settings, persisted apart from every other architecture's. */
	settings: ArchitectureSettings
	/** Assembles several entry files at once, so "assemble all" is offered. */
	multipleEntries?: boolean
	panels?: readonly PanelContribution[]
	/**
	 * The language, registers and examples under `settings`, where they differ
	 * from the definition's own; only settings that rebuild may change them.
	 * The same settings give the same object.
	 */
	variant?(settings: TargetSettings): ArchitectureVariant
	createServices(): Services & Disposable
}

/** The variant `settings` select: the definition's own fields unless it varies. */
export function variantOf(definition: ArchitectureDefinition<unknown>, settings: TargetSettings): ArchitectureVariant {
	return definition.variant?.(settings) ?? definition
}

export interface ArchitectureActivation<Services = ArchitectureServices> extends Disposable {
	readonly definition: ArchitectureDefinition<Services>
	readonly services: Services
	/** Guards callbacks that may complete after this activation has been replaced. */
	isCurrent(): boolean
}
