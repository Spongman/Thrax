import type * as Monaco from 'monaco-editor'
import type { ArchitectureDefinition, AssemblySources, CharacterSet, Diagnostic, Example, MemorySection, RegisterDescriptor, RegisterValue } from '../architectures/contracts'
import type { AssemblyImage } from './assembly/emitter'
import type { HistoryBufferSchema } from './historyBuffers'
import type { InstructionLink } from './instructionHelp'

/** Native instruction semantics; shared workbench control stays outside this callback. */
export interface CpuContext {
	readonly r: Uint32Array
	readonly w: BigUint64Array
	readonly memory: Uint8Array
	/** Architecture-owned internal words, recorded sparsely without guest memory events. */
	readonly state: Uint32Array
	writeState(index: number, value: number): void
	/** Address of the current instruction; pc already names its fall-through. */
	readonly instructionAddress: number
	pc: number
	read(address: number, bytes?: number, littleEndian?: boolean): number
	write(address: number, value: number, bytes?: number, littleEndian?: boolean): void
	readWide(address: number, littleEndian?: boolean): bigint
	writeWide(address: number, value: bigint, littleEndian?: boolean): void
	call(target: number, returnAddress?: number): void
	ret(target: number): void
	halt(): void
	output(text: string): void
	/** Suspends without retiring until accepted input can replay this instruction. */
	inputInteger(bits?: number): number
	/** Segment arithmetic is shared; native code selects segment/default/override. */
	segmentAddress(segment: number, offset: number, shift?: number, addressBits?: number, offsetBits?: number): number
	readSegment(segment: number, offset: number, bytes?: number, shift?: number, addressBits?: number, offsetBits?: number, littleEndian?: boolean): number
	writeSegment(segment: number, offset: number, value: number, bytes?: number, shift?: number, addressBits?: number, offsetBits?: number, littleEndian?: boolean): void
	branch(target: number, taken: boolean): void
}

export interface CpuInstruction {
	size: number
	text: string
	execute(cpu: CpuContext): void
	/** Shared Step Over uses this metadata, not mnemonic tests. */
	call?: boolean
	/** Static tool metadata; native execution reports actual branch/memory accesses. */
	kind?: 'alu' | 'load' | 'store' | 'branch' | 'jump' | 'call' | 'return' | 'system'
	reads?: readonly string[]
	writes?: readonly string[]
}

export interface CpuEncodingContext {
	address: number
	/** Evaluate a dialect expression, including forward labels during emission. */
	value(text: string): number
}

export interface CpuConfiguration {
	id: string
	name: string
	language: string
	reference: string
	/** Native stored registers, in r/w index order; PC is supplied separately. */
	registers: readonly RegisterDescriptor[]
	/** Optional logical register view over native u32 columns, for mixed-width files. */
	registerView?: {
		registers: readonly RegisterDescriptor[]
		read(words: Uint32Array, index: number): RegisterValue
		write(cpu: CpuContext, index: number, value: RegisterValue): void
	}
	wideRegisters?: boolean
	pcBits: number
	memoryBytes: number
	textBase: number
	dataBase: number
	wordBytes: number
	instructionAlignment: number
	/** Split pseudo-op mappings into fixed native instruction boundaries. */
	fixedInstructionBytes?: number
	directiveWidths?: Readonly<Record<string, 1 | 2 | 4>>
	stateWords?: number
	delayedBranching?: boolean
	littleEndian: boolean
	/** Radix the register and memory panels first show integers in; 16 when absent. */
	displayRadix?: 8 | 16
	/** Every family explicitly chooses its typed column schema. */
	historySchema: HistoryBufferSchema
	examples: Readonly<Record<string, Example>>
	instructions: readonly string[]
	instructionHelp: Readonly<Record<string, { syntax: string, description: string, details?: readonly string[] }>>
	/** Where each instruction is described in the manual. */
	instructionLink?: InstructionLink
	comments?: readonly string[]
	/** Native compound tokens, such as numbered stack-register names. */
	tokenPattern?: RegExp
	/** A dialect's own editor grammar, directive completions and symbol definitions, replacing the GNU-style defaults. */
	editor?: {
		tokens: Monaco.languages.IMonarchLanguage
		directives: readonly string[]
		/** Definition patterns of a symbol (a regex source): prefix in group 1, name in group 2. */
		definitions(name: string): readonly RegExp[]
	}
	/** Memory text encoding for the memory panel; ASCII when absent. */
	characterSet?: CharacterSet
	memorySections?: readonly MemorySection[]
	/** Physical byte aliases of native stored registers, such as MCU SFRs. */
	memoryAliases?: readonly { address: number, register: number, bytes: number, littleEndian?: boolean }[]
	/** Restricts bulk debugger byte shifts to one native memory space. */
	memoryRegion?(address: number): { start: number, end: number } | null
	readRegister?(cpu: CpuContext, index: number): RegisterValue
	writeRegister?(cpu: CpuContext, index: number, value: RegisterValue): void
	/** Normalize native derived bits after a debugger edit, never per CPU step. */
	afterEdit?(cpu: CpuContext): void
	reset?(cpu: CpuContext): void
	instructionSize(mnemonic: string, operands: readonly string[]): number
	encode(mnemonic: string, operands: readonly string[], context: CpuEncodingContext): ArrayLike<number>
	decode(memory: Uint8Array, address: number, cpu?: CpuContext, sourceBytes?: number): CpuInstruction
	/** Mode-dependent instruction widths select separate cached decodes. */
	decodeKey?(cpu: CpuContext, address: number): number
	/** Native PC wrapping/banking; otherwise the shared PC advances by size. */
	advance?(cpu: CpuContext, size: number): void
	/** Finish native delayed state transitions inside the same reversible instruction. */
	afterInstruction?(cpu: CpuContext): void
	/** Command-time return address, including native bank/offset wrapping. */
	fallThrough?(cpu: CpuContext, size: number): number
	/** Physical instruction-byte address, including native segment/bank wrapping. */
	fetchAddress?(cpu: CpuContext, address: number, offset: number): number
	setProgramCounter?(cpu: CpuContext, address: number): void
	/** Optional dialect-specific frontend; otherwise the shared configurable one. */
	assemble?(sources: AssemblySources): { image: AssemblyImage | null, diagnostics: Diagnostic[] }
}

/** Explicit reusable schema builder: no architecture extension columns are implicit. */
export { cpuHistorySchema, createConfiguredArchitecture } from './configuredRuntime'
export type ConfiguredArchitecture = ArchitectureDefinition
