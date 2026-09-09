/**
 * MIPS Runtime Simulator with Breakpoint & Step-Through Support
 */

import {
	bitsToDouble,
	bitsToSingle,
	CP0_REGISTER_COUNT,
	CP0_STATUS_EXL,
	CP0_STATUS_INITIAL,
	cp0RegisterNumber,
	doubleToBits,
	EXCEPTION_BREAKPOINT,
	EXCEPTION_RESERVED_INSTRUCTION,
	EXCEPTION_SYSCALL,
	FP_CONDITION_FLAG_COUNT,
	FP_REGISTER_COUNT,
	formatDouble,
	formatSingle,
	fpRegisterNumber,
	roundToNearestEven,
	singleToBits,
} from './coprocessor'
import { decode, type Decoded } from './decoder'
import { Op, OP_NAMES } from './ops'

/**
 * The ops the dispatch below switches on, as bindings of this module.
 *
 * `case Op.ADD:` reads a property of a class carrying a hundred and forty of
 * them, which puts it in dictionary mode: each case becomes a hash lookup, and
 * eighty-two of those per instruction cost twice what switching on the mnemonic
 * string did.  Bound here once, the cases are plain reads and the switch runs
 * as fast as if the numbers were written into it: 47ms against 65ms for the
 * strings and 130ms for the properties, over the mandelbrot example.
 */
const { ADD, ADDI, ADDIU, ADDU, AND, ANDI, BC1F, BC1T, BEQ, BGEZ, BGEZAL, BGTZ, BLEZ, BLTZ, BLTZAL, BNE, BREAK, CLO, CLZ, DIV, DIVU, ERET, J, JAL, JALR, JR, LB, LBU, LDC1, LH, LHU, LL, LUI, LW, LWC1, LWL, LWR, MADD, MADDU, MFC0, MFC1, MFHI, MFLO, MOVF, MOVN, MOVT, MOVZ, MSUB, MSUBU, MTC0, MTC1, MTHI, MTLO, MUL, MULT, MULTU, NOR, OR, ORI, SB, SC, SDC1, SH, SLL, SLLV, SLT, SLTI, SLTIU, SLTU, SRA, SRAV, SRL, SRLV, SUB, SUBU, SW, SWC1, SWL, SWR, SYSCALL, XOR, XORI } = Op

import { formatWordDigits } from './format'
import { FileTable, STDERR, STDOUT } from './files'
import type { DevicePort, ExecutionObserver } from './observer'
import { RandomStreams } from './random'
import { EffectStore } from './effectStore'
import { packService, serviceOf, slotOf, type MachineService, type ServiceRecorder } from './service'
import { KIND_REGISTER, KIND_FP, KIND_FLAG, KIND_CP0, KIND_MEMORY, KIND_CONSOLE, KIND_CONSOLE_RESET, KIND_DISPLAY, KIND_QUEUED_INPUT, KIND_CALL, KIND_HI_LO, KIND_HEAP_POINTER, KIND_HALTED, KIND_EXIT_CODE, KIND_SLEEP, KIND_INPUT, KIND_SERVICE } from './effectKind'

import { HistoryLog } from './historyLog'
import { REGISTER_FILE_NAMES, REGISTER_NAMES, registerFileIndex } from './registers'
import { DEFAULT_BACKSTEP_LIMIT, MEMORY_CONFIGURATIONS, type MemoryConfigurationValues } from './settings'
import type { CallFrame, DelayState, Effect, HistoryEntry, KeyboardDisplayState, MemoryView, MipsInstruction, MipsProgram, PendingInput, Registers, SimulatorState } from './types'

/** Cause codes for a bad address, by whether it was a load or a store. */
const EXCEPTION_ADDRESS_LOAD = 4
const EXCEPTION_ADDRESS_STORE = 5

/** Cause code for a signed add, subtract or addi that overflowed. */
const EXCEPTION_ARITHMETIC_OVERFLOW = 12

/** Cause code for a trap instruction whose condition held. */
const EXCEPTION_TRAP = 13

/** The CP1 moves that copy on a condition rather than unconditionally. */
const FP_CONDITIONAL_MOVES: ReadonlySet<string> = new Set(['movn', 'movz', 'movt', 'movf'])

/**
 * The twelve traps, each a comparison against a register or a sign-extended
 * immediate.  The unsigned comparisons are spelled as a sign test upstream;
 * comparing the two words unsigned is the same thing.
 */
const TRAP_FORMS: Record<string, TrapForm> = {
	teq: { immediate: false, holds: (left, right) => left === right },
	teqi: { immediate: true, holds: (left, right) => left === right },
	tne: { immediate: false, holds: (left, right) => left !== right },
	tnei: { immediate: true, holds: (left, right) => left !== right },
	tge: { immediate: false, holds: (left, right) => left >= right },
	tgei: { immediate: true, holds: (left, right) => left >= right },
	tgeu: { immediate: false, holds: (left, right) => (left >>> 0) >= (right >>> 0) },
	tgeiu: { immediate: true, holds: (left, right) => (left >>> 0) >= (right >>> 0) },
	tlt: { immediate: false, holds: (left, right) => left < right },
	tlti: { immediate: true, holds: (left, right) => left < right },
	tltu: { immediate: false, holds: (left, right) => (left >>> 0) < (right >>> 0) },
	tltiu: { immediate: true, holds: (left, right) => (left >>> 0) < (right >>> 0) },
}

type TrapForm = { immediate: boolean, holds: (left: number, right: number) => boolean }

/**
 * What a dotted CP1 mnemonic asks for, and what a trap compares, worked out
 * once per op rather than at every execution.
 *
 * Which format a dotted mnemonic names, and what a trap compares, are both a
 * property of the op and never change for it.  Settling them here means an
 * execution indexes a table rather than taking a name apart.
 */
type FpForm =
	| { form: 'arithmetic', operation: string, format: string }
	| { form: 'conditionalMove', operation: string, format: string }
	| { form: 'compare', comparison: string, format: string }
	| { form: 'convert', target: string, source: string }
	| { form: 'round', operation: string, format: string }

/** The order these are tried in is the order the mnemonics disambiguate in. */
function fpFormOf(name: string): FpForm | undefined {
	const [first, second, third, ...rest] = name.split('.')
	if (rest.length > 0) return undefined
	if (third === undefined) {
		if (second === undefined) return undefined
		return FP_CONDITIONAL_MOVES.has(first)
			? { form: 'conditionalMove', operation: first, format: second }
			: { form: 'arithmetic', operation: first, format: second }
	}
	if (first === 'c') return { form: 'compare', comparison: second, format: third }
	if (first === 'cvt') return { form: 'convert', target: second, source: third }
	if (second === 'w') return { form: 'round', operation: first, format: third }
	return undefined
}

/** One entry per op, so the form is an index rather than a parse or a hash. */
const FP_FORMS: readonly (FpForm | undefined)[] = OP_NAMES.map(fpFormOf)
const OP_TRAP_FORMS: readonly (TrapForm | undefined)[] = OP_NAMES.map((name) => TRAP_FORMS[name])

/**
 * Where instructions may live, under the selected memory configuration.
 */
function inTextSegment(address: number, layout: MemoryConfigurationValues): boolean {
	const value = address >>> 0
	return (value >= layout.textBaseAddress && value < layout.textLimitAddress) ||
		(value >= layout.kernelTextBaseAddress && value < layout.kernelTextLimitAddress)
}

/**
 * Whether an address names storage at all.  A sparse map has no bounds of its
 * own, so without this a load from nowhere reads zero and a store to nowhere
 * quietly succeeds, both of which hide the mistake that caused them.
 */
function inAddressSpace(address: number, layout: MemoryConfigurationValues): boolean {
	const value = address >>> 0
	return inTextSegment(value, layout) ||
		(value >= layout.dataSegmentBaseAddress && value <= layout.dataSegmentLimitAddress) ||
		(value >= layout.kernelDataBaseAddress && value <= layout.kernelDataSegmentLimitAddress) ||
		(value >= layout.memoryMapBaseAddress && value <= layout.memoryMapLimitAddress)
}

/**
 * Abandons the rest of the faulting instruction once a handler has taken the
 * pc, so `add` raises before it writes its destination.
 */
class ExceptionAbort extends Error {}

/** How a message dialog labels itself, by the type in `$a1`. */
const DIALOG_LABELS: Record<number, string> = { 0: 'Error: ', 1: '', 2: 'Warning: ', 3: 'Question: ' }

const DIALOG_OK = 0
const DIALOG_BAD_INPUT = -1
const DIALOG_CANCELLED = -2
/** OK with an empty field, which is reported apart from unparseable input. */
const DIALOG_NO_INPUT = -3
/** The string did not fit the buffer. */
const DIALOG_TRUNCATED = -4

const NEWLINE_BYTE = 10

/** Fallbacks for an out-of-range MIDI argument. */
const MIDI_DEFAULT_PITCH = 60
const MIDI_DEFAULT_DURATION = 1000
const MIDI_DEFAULT_INSTRUMENT = 0
const MIDI_DEFAULT_VOLUME = 100

/** MARS replaces a MIDI value outside 0-127 with its default, not its low bits. */
function midiArgument(value: number, fallback: number): number {
	return value < 0 || value > 127 ? fallback : value
}

/** A note the MIDI syscalls ask for; the browser adapter turns it into sound. */
export interface MidiNote {
	pitch: number
	durationMs: number
	instrument: number
	volume: number
}

export interface MidiPlayer {
	play(note: MidiNote): void
}

/** `backstepLimit`'s default, from `Config.properties:7`. */

/** Instructions run between yields to the browser. */
const DEFAULT_BATCH_SIZE = 20_000

/** Redraws per second when execution is paced, which sets the batch size. */
const ANIMATION_FRAMES_PER_SECOND = 30

/** Longest a paced run sleeps without looking at the speed control again. */
const FRAME_SLICE_MS = 50

/** How much of a stalled run a paced run will make up once it resumes. */
const MAX_CATCH_UP_SECONDS = 0.25

/**
 * Bit 1 of either control register enables that device's interrupt.  The
 * receiver's fires when a character arrives, the transmitter's when it has
 * finished sending one.
 */
const MMIO_INTERRUPT_ENABLE = 0x2
/** Bit 0 of a control register: the receiver has a character, or the transmitter is free. */
const MMIO_READY = 0x1

/** A form feed clears the display; ASCII 7 places the cursor on it. */
const DISPLAY_CLEAR = 12
const DISPLAY_SET_CURSOR = 7

/** The field a positioned display writes into. */
const DISPLAY_COLUMNS = 80
const DISPLAY_ROWS = 24

/** A field of spaces, one row per line, for a display being written by position. */
function blankDisplay(columns: number, rows: number): string {
	return Array.from({ length: rows }, () => ' '.repeat(columns)).join('\n')
}

/**
 * Cause codes the memory-mapped devices raise.  An external interrupt has one
 * exception code, zero, so a code here carries the device's pending bit instead:
 * shifted two places into the cause register it lands on bit 8 for the receiver
 * and bit 9 for the transmitter, which is how a handler tells them apart.
 */
const EXCEPTION_RECEIVER_INTERRUPT = 0x40
const EXCEPTION_TRANSMITTER_INTERRUPT = 0x80

/** The four memory-mapped device registers, from the configuration's base. */
const RECEIVER_CONTROL_OFFSET = 0
const RECEIVER_DATA_OFFSET = 4
const TRANSMITTER_CONTROL_OFFSET = 8
const TRANSMITTER_DATA_OFFSET = 12

/** Settings the machine needs before it can pick where a run starts. */
export interface SimulatorOptions {
	startAtMain?: boolean
	/** Placed on the stack at reset, as `argc` and `argv`. */
	programArguments?: readonly string[]
}

export class MipsSimulator {
	machineCode: number[]
	program: MipsProgram
	/** Where the segments sit; `memory` below is the sparse contents, not the map. */
	layout: MemoryConfigurationValues
	registers: Registers
	memory: Map<number, number>
	pc: number
	hi: number = 0
	lo: number = 0
	console: string
	running: boolean
	halted: boolean
	paused: boolean
	instructionCount: number
	/** Source-level metadata for the debugger, keyed by address. */
	addressToInstructionMap: Map<number, number>
	/** Decoded form of each executed word, dropped when that word is written. */
	decodeCache: Map<number, Decoded | null>
	/** Where the current instruction leaves the program counter. */
	nextPc: number
	/** Memory the running instruction has overwritten, for stepping back. */
	/** Open files for syscalls 13-16, held in memory for the run. */
	files: FileTable
	/** Pseudo-random streams for syscalls 40-44. */
	random: RandomStreams
	/** Syscall 32 and 33 ask execution to wait; the run loop honours this. */
	pendingSleepMs: number
	/** The code syscall 17 exited with, or null while the program is running. */
	exitCode: number | null
	/** Nothing attaches a player, so the MIDI syscalls run silently. */
	midi: MidiPlayer | null
	/** Wall-clock source for syscall 30, replaceable so tests stay deterministic. */
	clock: () => number
	/** Instructions per second while running, or null to run flat out. */
	speed: number | null
	/** Addresses a paced run animates; null paces every instruction. */
	pacedAddresses: ReadonlySet<number> | null
	/** Called after each batch so a paced run can be watched. */
	onProgress: (() => void) | null
	/** Tools watching this run.  Empty is the fast path. */
	observers: ExecutionObserver[]
	breakpoints: Set<number>
	readonly executionHistory = new HistoryLog()
	/**
	 * Whatever has asked to be rolled back with the machine, in the order they
	 * asked: a record names one by its place here, so the machine needs to know
	 * nothing else about any of them.
	 */
	private readonly services: MachineService[] = []
	/**
	 * The `backstepLimit` setting, which the workspace assigns as it assigns
	 * `delayedBranching`.  MARS counts *backstep operations* and notes that one
	 * instruction may produce several, where THRAX
	 * keeps one entry per instruction, so 2000 here is close parity, not exact.
	 */
	maxHistorySize: number
	callStack: CallFrame[]
	pendingInput: PendingInput | null
	heapPointer: number
	keyboardDisplay: KeyboardDisplayState
	/** Coprocessor 1 register file, held as raw words. */
	fpRegisters: number[]
	fpConditionFlags: boolean[]
	/** Coprocessor 0 register file: vaddr, status, cause, and epc. */
	cp0Registers: number[]
	/**
	 * The delayed branching setting, off by default.  On, the instruction after
	 * a branch or jump runs before control transfers.
	 */
	delayedBranching: boolean
	/**
	 * The self-modifying code setting, off by default.  It gates both writes into
	 * a text segment and instruction fetches from outside one.
	 */
	selfModifyingCode: boolean
	/**
	 * Start at the global `main` rather than the text base, off by default.  It
	 * has to be read before the constructor picks the entry address, so it is
	 * set from the options rather than assigned afterwards.
	 */
	startAtMain: boolean
	/** Set by writing bit 1 of the matching control register. */
	receiverInterruptEnabled: boolean
	transmitterInterruptEnabled: boolean
	/**
	 * Instructions the transmitter is still busy for.  Zero sends at once, which
	 * is what a program that never polls the control register expects.
	 */
	transmitterDelay: number
	private transmitterBusy: number
	/**
	 * The display is a grid once a program has placed the cursor on it, and a
	 * stream of text until then.
	 */
	private displayGrid: boolean
	private displayCursor: number
	displayColumns: number
	displayRows: number
	/** Where a pending delayed branch is going, and how close it is to landing. */
	delayState: DelayState
	delayedTarget: number
	/**
	 * Words a memory-mapped device asked to write, applied at the top of the next
	 * instruction so each lands as its own recorded event.
	 */
	private deviceWrites: Array<{ address: number, value: number }>
	/**
	 * A cause code a device asked to interrupt with, taken in place of the next
	 * instruction.  One at a time, as the machine has one cause register: a
	 * second request before the first is taken replaces it.
	 */
	private deviceInterrupt: number | null
	/** The entry being filled in, or null when nothing is being recorded. */
	private entry: HistoryEntry | null
	/** Every entry's effects, in columns the entries index into. */
	readonly effects = new EffectStore()
	/** Hands out `HistoryEntry.id`; never reset, so an id is unique for the session. */
	private nextEntryId: number
	/**
	 * How many entries stand behind the present.  A step back moves this rather
	 * than dropping the entry, since the entries ahead of it hold the values
	 * that came from outside the machine and nothing else can reproduce those.
	 */
	private cursor: number


	constructor(machineCode: number[], program: MipsProgram, layout: MemoryConfigurationValues = MEMORY_CONFIGURATIONS.default, options: SimulatorOptions = {}) {
		this.machineCode = machineCode
		this.program = program
		this.layout = layout
		// Read before the entry address is picked, since it decides it.
		this.startAtMain = options.startAtMain ?? false
		this.registers = this.initializeRegisters()
		// Sparse, word-addressed virtual memory allows the standard data and stack
		// addresses (for example 0x10010000 and 0x7fffeffc) without allocating a
		// multi-gigabyte browser array.
		this.memory = new Map()
		this.pc = this.entryAddress()
		this.setHiLo(0, 0)
		this.console = ''
		this.running = false
		this.halted = false
		this.paused = false
		this.instructionCount = 0
		this.addressToInstructionMap = new Map()
		this.decodeCache = new Map()
		this.nextPc = this.pc
		this.files = new FileTable()
		this.random = new RandomStreams()
		this.pendingSleepMs = 0
		this.exitCode = null
		this.midi = null
		this.clock = () => Date.now()
		this.speed = null
		this.pacedAddresses = null
		this.onProgress = null
		this.observers = []
		this.breakpoints = new Set() // Set of addresses with breakpoints
		this.receiverInterruptEnabled = false
		this.transmitterInterruptEnabled = false
		this.transmitterDelay = 0
		this.transmitterBusy = 0
		this.displayGrid = false
		this.displayCursor = 0
		this.displayColumns = DISPLAY_COLUMNS
		this.displayRows = DISPLAY_ROWS
		this.deviceWrites = []
		this.deviceInterrupt = null
		this.entry = null
		this.nextEntryId = 1
		this.cursor = 0
		this.maxHistorySize = DEFAULT_BACKSTEP_LIMIT
		this.callStack = []
		this.pendingInput = null
		this.heapPointer = layout.heapBaseAddress
		this.keyboardDisplay = { queuedInput: '', displayOutput: '' }
		this.fpRegisters = new Array(FP_REGISTER_COUNT).fill(0)
		this.fpConditionFlags = new Array(FP_CONDITION_FLAG_COUNT).fill(false)
		this.cp0Registers = new Array(CP0_REGISTER_COUNT).fill(0)
		this.writeCp0(12, CP0_STATUS_INITIAL)
		this.delayedBranching = false
		this.selfModifyingCode = false
		this.delayState = 'none'
		this.delayedTarget = 0
		this.writeRegNamed('$pc', this.pc)
		this.buildAddressMap()
		this.loadTextSegment()
		this.loadDataSegment()
		if (options.programArguments) this.loadProgramArguments(options.programArguments)
	}

	initializeRegisters(): Registers {
		return {
			$zero: 0,
			$at: 0,
			$v0: 0,
			$v1: 0,
			$a0: 0,
			$a1: 0,
			$a2: 0,
			$a3: 0,
			$t0: 0,
			$t1: 0,
			$t2: 0,
			$t3: 0,
			$t4: 0,
			$t5: 0,
			$t6: 0,
			$t7: 0,
			$s0: 0,
			$s1: 0,
			$s2: 0,
			$s3: 0,
			$s4: 0,
			$s5: 0,
			$s6: 0,
			$s7: 0,
			$t8: 0,
			$t9: 0,
			$k0: 0,
			$k1: 0,
			$gp: this.layout.globalPointer,
			$sp: this.layout.stackPointer,
			$fp: 0,
			$ra: 0,
			$pc: this.layout.textBaseAddress,
			$hi: 0,
			$lo: 0,
		}
	}

	/**
	 * Where a run starts.  `main` has to be global for this, since it is a name
	 * every file of the program agrees on rather than one file's own label, and
	 * the fallback is the configuration's text base whether or not anything was
	 * assembled there.
	 */
	entryAddress(): number {
		if (!this.startAtMain) return this.layout.textBaseAddress
		const main = this.program.symbols?.globals.get('main')
		const usable = main !== undefined && inTextSegment(main, this.layout)
		return usable ? main : this.layout.textBaseAddress
	}

	/** Instructions live in .text or .ktext, so they are indexed by their own address. */
	buildAddressMap() {
		this.program.instructions.forEach((instruction, index) => {
			if (instruction.address !== null) this.addressToInstructionMap.set(instruction.address, index)
		})
	}

	/** Assembled words are readable memory, so loads and the memory view see them. */
	loadTextSegment() {
		this.machineCode.forEach((word, index) => {
			const address = this.program.instructions[index]?.address
			if (address !== null && address !== undefined) this.memory.set(address >>> 2, word >>> 0)
		})
	}

	loadDataSegment() {
		for (const entry of this.program.data || []) {
			let address = entry.address
			for (const item of entry.bytes) {
				if (typeof item === 'number') {
					this.writeMemoryRaw(address++, item, 1)
					continue
				}
				// The assembler resolves a label operand against the file it was
				// written in, so only a value reaches here.
				const target = item.value
				if (target.type !== 'immediate') throw new Error(`Unresolved label: ${target.value}`)
				this.writeMemoryRaw(address, target.value, item.width)
				address += item.width
			}
		}
	}

	async run(batchSize?: number) {
		await this.runUntil(() => false, batchSize)
	}

	/**
	 * How many instructions to run before handing control back.  A paced run
	 * aims for a steady redraw rate, so slow speeds step one instruction at a
	 * time and fast ones still yield often enough to stay responsive.
	 */
	batchSize(): number {
		if (this.speed === null) return DEFAULT_BATCH_SIZE
		return Math.max(1, Math.round(this.speed / ANIMATION_FRAMES_PER_SECOND))
	}

	/** The pause that holds a paced run to `speed` instructions per second. */
	batchDelayMs(batchSize: number): number {
		return this.speed === null ? 0 : (batchSize / this.speed) * 1000
	}

	/**
	 * Waits out a frame in slices, so moving the speed control or pausing is felt
	 * within a slice rather than after a whole slow frame.
	 */
	async waitFrame(ms: number) {
		const deadline = performance.now() + ms
		const speed = this.speed
		while (this.running && !this.halted && this.speed === speed) {
			const remaining = deadline - performance.now()
			if (remaining <= 0) return
			await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, FRAME_SLICE_MS)))
		}
	}

	/** Runs until `shouldStop()` holds after an instruction, a breakpoint is hit, or execution ends. */
	async runUntil(shouldStop: () => boolean, fixedBatchSize?: number) {
		this.running = true
		this.paused = false
		// A run never stops on the breakpoint it starts on: continuing while the
		// pc sits on one has to make progress, or the button does nothing.
		let firstInstruction = true
		// Timers overshoot, so a paced run measures the clock and makes up what it
		// owes on the next pass instead of falling behind the speed that was asked for.
		let lastTick = performance.now()
		let owed = 0

		try {
			while (this.running && !this.halted) {
				const frameStarted = performance.now()
				// Read every pass: the speed control moves while a run is going.
				const batchSize = fixedBatchSize ?? this.batchSize()
				const frameMs = this.batchDelayMs(batchSize)
				let allowance = batchSize
				if (this.speed === null) {
					owed = 0
					lastTick = frameStarted
				} else {
					const arrears = ((frameStarted - lastTick) * this.speed) / 1000
					// A long stall (a hidden tab, a slow syscall) must not burst afterwards.
					owed = Math.min(owed + arrears, this.speed * MAX_CATCH_UP_SECONDS)
					lastTick = frameStarted
					allowance = Math.max(1, Math.floor(owed))
				}
				let executed = 0
				while (this.running && !this.halted && executed < allowance) {
					if (!firstInstruction && this.breakpoints.has(this.pc)) {
						this.paused = true
						this.running = false
						break
					}
					firstInstruction = false
					this.step()
					if (shouldStop()) {
						this.paused = true
						this.running = false
						break
					}
					// A word the editor cannot point at gets no frame of its own, so a
					// paced run animates the same instructions stepping would stop on.
					if (this.speed !== null && this.pacedAddresses && !this.halted && !this.pacedAddresses.has(this.pc)) continue
					executed++
				}
				owed -= executed
				this.onProgress?.()
				if (this.pendingSleepMs > 0) {
					const delay = this.pendingSleepMs
					this.pendingSleepMs = 0
					await new Promise((resolve) => setTimeout(resolve, delay))
					// A syscall sleep is the program's own wait, not time to make up.
					lastTick = performance.now()
				}
				if (this.running && !this.halted) {
					await this.waitFrame(Math.max(0, frameMs - (performance.now() - frameStarted)))
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.writeConsole(`\nError: ${message}\n`)
			this.halted = true // Outside any instruction, so nothing records it.
		}

		this.running = false
	}

	/**
	 * Fetches the word at the program counter, decodes it, and runs it.  Nothing
	 * here consults the parsed program, so a jump into data or a word the program
	 * wrote itself executes exactly like assembled text.
	 */
	step() {
		if (this.pendingInput) return
		this.drainDeviceWrites()
		if (this.transmitterBusy > 0) this.transmitterBusy -= 1
		// Ground the log already covers is replayed rather than re-run, which is
		// what lets a syscall that read the console be passed a second time in
		// silence.  It can also bring the machine back out of `halted`.
		if (this.stepForwardFromLog()) return
		if (this.halted) return

		// A fetch faults before it can return anything.
		const fetchFault = this.fetchFault(this.pc)

		// Untouched memory is not code; reaching it means the run went off the end.
		if (fetchFault === null && !this.memory.has(this.pc >>> 2)) {
			// Nothing was fetched, so there is no entry to record this on; a step
			// back onto the last real instruction clears it anyway.
			this.halted = true
			return
		}

		const decoded = fetchFault === null ? this.decodeAt(this.pc) : null

		// Everything written from here on belongs to this instruction.
		this.openEntry(this.pc, this.memory.get(this.pc >>> 2) ?? null, this.instructionAt(this.pc))

		// Unsigned: a kernel handler sits above 0x80000000, and a signed increment
		// turns its addresses negative, where nothing that keys on an address can
		// find them.
		this.nextPc = (this.pc + 4) >>> 0
		try {
			// An interrupt is taken in place of the instruction, not after it: EPC
			// names the instruction, so returning from the handler runs it.  Inside
			// the entry, so the handler's cause and epc roll back with everything
			// else, and inside the catch, since dispatch abandons the instruction.
			const interrupt = this.pendingInterruptCause()
			if (interrupt !== null) {
				this.deviceInterrupt = null
				this.signalException(interrupt)
			}

			if (fetchFault !== null) this.raiseAddressError(fetchFault, this.pc, false)

			if (decoded === null) {
				this.signalException(EXCEPTION_RESERVED_INSTRUCTION)
				throw new Error(`Undecodable instruction 0x${formatWordDigits(this.memory.get(this.pc >>> 2) ?? 0)}`)
			}

			if (this.observers.length > 0) {
				for (const observer of this.observers) observer.onInstruction?.(this.pc, decoded, this.instructionCount)
			}

			this.execute(decoded)
		} catch (error) {
			// A dispatched exception has already pointed nextPc at the handler;
			// anything else ends the run.
			if (!(error instanceof ExceptionAbort)) throw error
		}
		// A syscall waiting on input suspends this instruction part-way; only
		// `provideInput` may finish it, delay transition included.
		if (this.pendingInput) return
		this.finishStep()
		this.closeEntry()
	}

	/**
	 * Ends the instruction in hand: takes its next pc, then advances the delayed
	 * branch, so a branch registered here lands after the next instruction, its
	 * delay slot, has run.
	 */
	private finishStep() {
		this.pc = this.nextPc
		if (this.delayState === 'triggered') {
			this.pc = this.delayedTarget
			this.delayState = 'none'
		} else if (this.delayState === 'registered') {
			this.delayState = 'triggered'
		}
		// The entry holds the pc this replaces, so it is not recorded again.
		this.registers.$pc = this.pc
		this.instructionCount++
	}

	stepBack() {
		if (this.cursor === 0) return false
		// An instruction suspended on input is still being recorded, and it is
		// the one about to be undone, so its effects have to be settled first.
		this.closeEntry()
		const entry = this.executionHistory.at(--this.cursor)!

		// In reverse, so an instruction that wrote the same place twice ends up
		// holding the value it found there; the control state goes last, as it
		// was taken first.
		for (let offset = entry.effectCount - 1; offset >= 0; offset--) this.applyEffect(entry.effectStart + offset)
		this.exchangeControl(entry)
		this.exchangeSubsystems(entry)
		this.instructionCount = entry.instructionCount
		this.pendingInput = null
		this.paused = true
		this.running = false
		this.seekObservers()
		return true
	}

	/**
	 * Runs the instruction the log already holds, by applying its effects rather
	 * than executing anything.  That is what lets a syscall that read the
	 * console or the clock be passed over a second time in silence: the values
	 * it produced are in the effects, and nothing has to be asked again.
	 */
	private stepForwardFromLog(): boolean {
		if (this.cursor >= this.executionHistory.length) return false
		const entry = this.executionHistory.at(this.cursor++)!

		this.exchangeControl(entry)
		for (let offset = 0; offset < entry.effectCount; offset++) this.applyEffect(entry.effectStart + offset)
		this.exchangeSubsystems(entry)
		this.instructionCount = entry.instructionCount + (entry.kind === 'instruction' ? 1 : 0)
		this.seekObservers()
		return true
	}

	/**
	 * The cause code an interrupt is owed before the instruction in hand runs, or
	 * null when nothing is pending.  A character waiting to be read is the
	 * receiver's event, the transmitter having finished is its own, and a tool
	 * holding the device port raises whatever its own device reports.
	 */
	private pendingInterruptCause(): number | null {
		// Masked off in the status register means the program is not listening,
		// and being in a handler already means it cannot be told.
		const status = this.cp0Registers[12]
		if ((status & 1) === 0 || (status & CP0_STATUS_EXL) !== 0) return null

		if (this.deviceInterrupt !== null) return this.deviceInterrupt
		if (this.receiverInterruptEnabled && this.keyboardDisplay.queuedInput.length > 0) {
			return EXCEPTION_RECEIVER_INTERRUPT
		}
		if (this.transmitterInterruptEnabled && this.transmitterBusy === 0) {
			return EXCEPTION_TRANSMITTER_INTERRUPT
		}
		return null
	}

	/**
	 * How a memory-mapped device reads the machine and answers it.  Reads go past
	 * the protections and do not reach the observers, so a device does not hear
	 * its own traffic; writes are queued for the top of the next instruction.
	 */
	devicePort(): DevicePort {
		return {
			read: (address) => this.readWordRaw(address),
			write: (address, value) => { this.deviceWrites.push({ address: address >>> 0, value }) },
			interrupt: (cause) => {
				// Already in a handler: taking another would lose the return
				// address the first one still needs.
				if ((this.cp0Registers[12] & CP0_STATUS_EXL) !== 0) return false
				this.deviceInterrupt = cause
				return true
			},
		}
	}

	/** One word straight out of memory, past the protections and the observers. */
	readWordRaw(address: number): number {
		return (this.memory.get((address >>> 0) >>> 2) ?? 0) >>> 0
	}

	/**
	 * Applies what the devices asked for, as an entry of its own.  Doing it here
	 * rather than where it was asked for keeps a device write out of the middle
	 * of another instruction'''s effects, and puts it in the log like any other.
	 */
	private drainDeviceWrites() {
		if (this.deviceWrites.length === 0) return
		const pending = this.deviceWrites
		this.deviceWrites = []
		this.openEntry(this.pc, null, null, 'edit')
		try {
			for (const { address, value } of pending) this.writeMemoryRaw(address, value, 4)
		} finally {
			this.closeEntry()
		}
	}

	/**
	 * Tells the tools where the machine now stands.  A replayed instruction does
	 * not run, so nothing reports it to them; this is how their numbers keep up
	 * with a machine that moved without executing anything.
	 */
	private seekObservers() {
		for (const observer of this.observers) observer.onSeek?.(this.instructionCount)
	}

	/** Swaps where execution stands with where the entry says it stood. */
	private exchangeControl(entry: HistoryEntry) {
		const pc = this.pc
		const delayState = this.delayState
		const delayedTarget = this.delayedTarget
		this.pc = entry.pc
		this.registers.$pc = entry.pc
		this.delayState = entry.delayState
		this.delayedTarget = entry.delayedTarget
		entry.pc = pc
		entry.delayState = delayState
		entry.delayedTarget = delayedTarget
	}

	/**
	 * The file table and the random streams do not invert from their effects, so
	 * the entry holds a copy of them and takes the current one in exchange.
	 */
	private exchangeSubsystems(entry: HistoryEntry) {
		if (entry.files) {
			const current = this.files.snapshot()
			this.files.restore(entry.files)
			entry.files = current
		}
		if (entry.random) {
			const current = this.random.snapshot()
			this.random.restore(entry.random)
			entry.random = current
		}
	}

	/**
	 * Exchanges an effect's value with the machine's, which undoes it going back
	 * and redoes it going forward.  Applying it twice is the identity, so one
	 * operation serves both directions.
	 */
	private applyEffect(index: number) {
		const effects = this.effects
		const { kind, a, b, value } = effects.slotAt(index)

		/** Puts `held` in the column and hands back what was there. */
		const swapB = (held: number) => {
			effects.setB(index, held)
			return b
		}

		switch (kind) {
			case KIND_REGISTER: {
				const name = REGISTER_FILE_NAMES[a]
				this.registers[name] = swapB(this.registers[name])
				return
			}
			case KIND_FP:
				this.fpRegisters[a] = swapB(this.fpRegisters[a])
				return
			case KIND_FLAG: {
				const held = this.fpConditionFlags[a]
				this.fpConditionFlags[a] = b !== 0
				effects.setB(index, held ? 1 : 0)
				return
			}
			case KIND_CP0:
				this.cp0Registers[a] = swapB(this.cp0Registers[a])
				return
			case KIND_MEMORY: {
				const words = value as Array<number | undefined>
				for (let offset = 0; offset < words.length; offset++) {
					const address = a + offset
					const held = this.memory.get(address)
					const word = words[offset]
					if (word === undefined) this.memory.delete(address)
					else this.memory.set(address, word)
					// The word now here may decode differently than the one it replaced.
					this.decodeCache.delete(address << 2)
					words[offset] = held
				}
				return
			}
			// Going back drops the text; going forward puts it back on the end.
			case KIND_CONSOLE: {
				const text = value as string
				this.console = this.console.endsWith(text)
					? this.console.slice(0, this.console.length - text.length)
					: this.console + text
				return
			}
			case KIND_CONSOLE_RESET: {
				const held = this.console
				this.console = value as string
				effects.setValue(index, held)
				return
			}
			case KIND_DISPLAY: {
				const held = this.keyboardDisplay.displayOutput
				this.keyboardDisplay.displayOutput = value as string
				effects.setValue(index, held)
				return
			}
			case KIND_QUEUED_INPUT: {
				const held = this.keyboardDisplay.queuedInput
				this.keyboardDisplay.queuedInput = value as string
				effects.setValue(index, held)
				return
			}
			// On top means it was put there, so this takes it off, and the other
			// way round; that is what makes a push and a pop one effect.
			case KIND_CALL: {
				const frame = value as CallFrame
				if (this.callStack[this.callStack.length - 1] === frame) this.callStack.pop()
				else this.callStack.push(frame)
				return
			}
			case KIND_HI_LO: {
				const hi = this.hi
				const lo = this.lo
				this.hi = a
				this.lo = b
				this.registers.$hi = this.hi
				this.registers.$lo = this.lo
				effects.setA(index, hi)
				effects.setB(index, lo)
				return
			}
			case KIND_HEAP_POINTER:
				this.heapPointer = swapB(this.heapPointer)
				return
			case KIND_HALTED: {
				const held = this.halted
				this.halted = b !== 0
				effects.setB(index, held ? 1 : 0)
				return
			}
			case KIND_EXIT_CODE: {
				const held = this.exitCode
				this.exitCode = a === 0 ? null : b
				effects.setA(index, held === null ? 0 : 1)
				effects.setB(index, held ?? 0)
				return
			}
			case KIND_SLEEP:
				this.pendingSleepMs = swapB(this.pendingSleepMs)
				return
			// The registers and memory the answer landed in carry it both ways.
			case KIND_INPUT:
				return
			// Whatever this means is the service's own: the machine hands back
			// what was kept and files what the service hands over instead.
			case KIND_SERVICE: {
				const service = this.services[serviceOf(a)]
				if (!service) return
				const held = service.exchange(slotOf(a), b, value)
				effects.setB(index, held.value)
				if (held.payload !== undefined || value !== undefined) effects.setValue(index, held.payload)
				return
			}
		}
	}

	/**
	 * Starts recording an instruction.  The control effect goes on first, so a
	 * branch taken part-way through still restores where execution stood.
	 */
	private openEntry(address: number, word: number | null, instruction: MipsInstruction | null, kind: HistoryEntry['kind'] = 'instruction') {
		this.reclaimAhead()
		const entry: HistoryEntry = {
			id: this.nextEntryId++,
			instructionCount: this.instructionCount,
			address,
			word,
			instruction,
			kind,
			pc: this.pc,
			delayState: this.delayState,
			delayedTarget: this.delayedTarget,
			effectStart: this.effects.beginRun(),
			effectCount: 0,
		}
		this.entry = entry
		this.executionHistory.push(entry)
		this.cursor = this.executionHistory.length
		const { dropped, oldest } = this.executionHistory.evict(this.maxHistorySize)
		if (dropped > 0) {
			this.cursor -= dropped
			// The oldest entry still held decides which blocks of effects are.
			if (oldest) this.effects.dropBefore(oldest.effectStart)
		}
	}

	/**
	 * Execution is about to leave the path the log recorded, so what it holds
	 * ahead of the present describes a future that will not happen.
	 */
	private reclaimAhead() {
		if (this.cursor >= this.executionHistory.length) return
		this.effects.truncate(this.executionHistory.at(this.cursor)!.effectStart)
		this.executionHistory.truncate(this.cursor)
	}

	/** Steps back until the entry with `id` has been undone. */
	rewindTo(id: number): boolean {
		const target = this.executionHistory.indexOfId(id)
		if (target === -1 || target >= this.cursor) return false
		while (this.cursor > target && this.stepBack()) { /* back to that entry */ }
		return true
	}

	/** How many entries stand behind the present; the rest are ahead of it. */
	getHistoryCursor(): number {
		return this.cursor
	}

	/**
	 * Runs `change` as an entry of its own, so a change the user made shows in
	 * the panel as its own row and steps back like anything else.  Anything the
	 * log held ahead of the present is rebuilt from here, since execution is
	 * about to leave the path it took before.
	 */
	private edit(change: () => void): HistoryEntry {
		this.openEntry(this.pc, null, null, 'edit')
		const entry = this.entry!
		try {
			change()
		} finally {
			this.closeEntry()
		}
		return entry
	}

	/**
	 * Sets a register by name, `$pc`, `$hi` and `$lo` included.  `$zero` is
	 * hardwired and stays read-only.
	 */
	setRegister(name: string, value: number): boolean {
		if (name === '$zero' || !(name in this.registers)) return false
		this.edit(() => {
			if (name === '$hi') this.setHiLo(value, this.lo)
			else if (name === '$lo') this.setHiLo(this.hi, value)
			else if (name === '$pc') {
				// The entry already holds where execution stood, so moving the pc
				// needs nothing recorded beyond it.
				this.pc = value >>> 0
				this.registers.$pc = this.pc
			} else this.writeRegNamed(name, value | 0)
		})
		return true
	}

	/** One raw `$f0`-`$f31` word; a double is the two halves of an even pair. */
	setFpRegister(index: number, value: number): boolean {
		if (index < 0 || index >= this.fpRegisters.length) return false
		this.edit(() => this.writeFpWord(index, value))
		return true
	}

	setCp0Register(index: number, value: number): boolean {
		if (index < 0 || index >= this.cp0Registers.length) return false
		this.edit(() => this.writeCp0(index, value))
		return true
	}

	/**
	 * One word of memory, past the protections a running instruction obeys: an
	 * edit to `.text` is the point of the self-modifying-code exercises.
	 */
	setMemoryWord(address: number, value: number): boolean {
		if (address % 4 !== 0) return false
		this.edit(() => this.writeMemoryRaw(address >>> 0, value, 4))
		return true
	}

	/** One byte, past the same protections, which is what the hex editor writes. */
	setMemoryByte(address: number, value: number): boolean {
		this.edit(() => this.writeByte(address >>> 0, value & 0xff))
		return true
	}

	/**
	 * The highest address in `[from, to]` whose word has ever been written.
	 *
	 * A shift only has to move the bytes as far as this: past it the region is
	 * zero, and moving zeros over zeros changes nothing.  The whole word map is
	 * walked to find it, which costs one pass per keystroke and is what keeps a
	 * shift over a region gigabytes wide from being a loop over all of it.
	 */
	private lastWrittenByte(from: number, to: number): number {
		const firstWord = from >>> 2
		const lastWord = to >>> 2
		let highest = -1
		for (const word of this.memory.keys()) {
			if (word >= firstWord && word <= lastWord && word > highest) highest = word
		}
		return highest < 0 ? from : Math.min(to, highest * 4 + 3)
	}

	/** The byte at an address, read from the word map rather than from a device. */
	private byteRaw(address: number): number {
		return ((this.memory.get(address >>> 2) || 0) >>> ((address & 3) * 8)) & 0xff
	}

	/**
	 * Inserts `value` at `address`, moving every byte up to `limit` one place up
	 * and dropping the one that reaches the end.  The region is bounded because
	 * memory is not a file: something has to be the end that a byte falls off,
	 * and the section the window is showing is what the user can see it fall off.
	 */
	insertMemoryByte(address: number, limit: number, value: number): boolean {
		const start = address >>> 0
		const end = limit >>> 0
		if (end < start) return false
		// One place past the last written byte is where that byte moves to.
		const top = Math.min(end, this.lastWrittenByte(start, end) + 1)
		this.edit(() => {
			for (let target = top; target > start; target--) this.writeByte(target, this.byteRaw(target - 1))
			this.writeByte(start, value & 0xff)
		})
		return true
	}

	/** Removes the byte at `address`, moving the region down and zeroing `limit`. */
	deleteMemoryByte(address: number, limit: number): boolean {
		const start = address >>> 0
		const end = limit >>> 0
		if (end < start) return false
		const top = Math.min(end, this.lastWrittenByte(start, end))
		this.edit(() => {
			for (let target = start; target < top; target++) this.writeByte(target, this.byteRaw(target + 1))
			this.writeByte(top, 0)
		})
		return true
	}

	/**
	 * Notes one change on the entry in flight; a no-op when nothing is recording.
	 * Effects go straight into the shared store, since an entry's are written in
	 * one unbroken run.
	 */
	private record(kind: number, a: number, b: number, value?: unknown) {
		if (this.entry) this.effects.push(kind, a, b, value)
	}

	/**
	 * Signs a service up to be rolled back with the machine, and hands back the
	 * way it says what it changed.  What the records mean is the service's; the
	 * machine only files them against the instruction in hand.
	 */
	register(service: MachineService): ServiceRecorder {
		// Signing up twice is the same service, not a second one: a tool is told
		// about the machine again whenever its panel is reopened.
		const existing = this.services.indexOf(service)
		const id = existing >= 0 ? existing : this.services.length
		if (existing < 0) this.services.push(service)
		this.effects.nameService(id, service.name)
		return {
			keep: (slot: number, value: number, payload?: unknown) => {
				this.record(KIND_SERVICE, packService(id, slot), value, payload)
			},
		}
	}

	/** Closes the entry in flight, which owns everything recorded since it opened. */
	private closeEntry() {
		if (!this.entry) return
		// A block that filled part-way through moved the run, so where it starts
		// is the store's to say rather than what the entry was opened with.
		const { start, count } = this.effects.endRun()
		this.entry.effectStart = start
		this.entry.effectCount = count
		this.entry = null
	}

	/**
	 * Notes a memory word about to be written.  A word already covered by the
	 * run being built is left alone, since the first value recorded is the one a
	 * step back has to put back; a word just past the end extends that run, so a
	 * write over a buffer costs one effect rather than one per word.
	 */
	private recordMemory(wordAddress: number) {
		const entry = this.entry
		if (!entry) return
		const last = this.effects.position - 1
		// The kind first, on its own: this runs on every word a program stores, and
		// reading the whole slot to find out it is not a memory effect would build
		// an object and look up a value for nothing.
		if (last >= this.effects.openRunStart && this.effects.kindAt(last) === KIND_MEMORY) {
			const words = this.effects.valueAt(last) as Array<number | undefined>
			const offset = wordAddress - this.effects.aAt(last)
			if (offset >= 0 && offset < words.length) return
			if (offset === words.length) {
				words.push(this.memory.get(wordAddress))
				return
			}
		}
		this.effects.push(KIND_MEMORY, wordAddress, 0, [this.memory.get(wordAddress)])
	}

	/**
	 * Copies the file table onto the entry in flight, once, before the syscall
	 * about to run changes it.  A file table does not invert from its effects,
	 * and a file syscall is rare, so only those instructions pay (bug 14).
	 */
	private captureFiles() {
		if (this.entry && this.entry.files === undefined) this.entry.files = this.files.snapshot()
	}

	/** The same, for the random streams: a replayed draw must not advance twice. */
	private captureRandom() {
		if (this.entry && this.entry.random === undefined) this.entry.random = this.random.snapshot()
	}

	/**
	 * Runs with a breakpoint at `address` that the caller never asked for, leaving
	 * the breakpoint set exactly as it was found however the run ends.  Stepping
	 * over a call also has to lift the breakpoint it is standing on, or the run
	 * would stop before it started.
	 */
	async runToTemporaryBreakpoint(address: number, liftCurrent: boolean) {
		const currentAddress = this.pc
		const restoreCurrent = liftCurrent && this.breakpoints.delete(currentAddress)
		const wanted = this.breakpoints.has(address)
		this.breakpoints.add(address)
		try {
			await this.run()
		} finally {
			if (restoreCurrent) this.breakpoints.add(currentAddress)
			if (!wanted) this.breakpoints.delete(address)
		}
	}

	/** Runs until `address` is reached, without leaving a breakpoint behind. */
	async runTo(address: number) {
		this.paused = false
		await this.runToTemporaryBreakpoint(address, false)
	}

	async stepOver() {
		// A call runs to completion; anything else is a plain step.
		const decoded = this.decodeAt(this.pc)
		if (decoded?.op === JAL || decoded?.op === JALR) {
			// The return address the call itself links, which skips the delay slot.
			await this.runToTemporaryBreakpoint((this.pc + (this.delayedBranching ? 8 : 4)) | 0, true)
			return
		}
		this.step()
	}

	/** Runs until the current subroutine returns (call depth drops below the current depth). */
	async stepToReturn() {
		const targetDepth = this.callStack.length
		if (targetDepth === 0) {
			await this.run()
			return
		}
		await this.runUntil(() => this.callStack.length < targetDepth)
	}

	async continue() {
		this.paused = false
		await this.run()
	}

	/** Stops a run where it stands, leaving it able to continue. */
	pause() {
		this.paused = true
		this.running = false
	}

	/** Moves execution to `address` without running anything. */
	setProgramCounter(address: number) {
		// Moving the pc by hand leaves the path the log recorded, so what it
		// holds ahead of the present describes a future that will not happen.
		this.reclaimAhead()
		this.pc = address >>> 0
		this.halted = false
		this.writeRegNamed('$pc', this.pc)
	}

	/** Applies the run-pacing settings the workspace holds. */
	configure(options: { speed?: number | null, pacedAddresses?: ReadonlySet<number> | null }) {
		if (options.speed !== undefined) this.speed = options.speed
		if (options.pacedAddresses !== undefined) this.pacedAddresses = options.pacedAddresses
	}

	addBreakpoint(address: number) {
		this.breakpoints.add(address)
	}

	removeBreakpoint(address: number) {
		this.breakpoints.delete(address)
	}

	toggleBreakpoint(address: number) {
		if (this.breakpoints.has(address)) {
			this.removeBreakpoint(address)
			return false
		} else {
			this.addBreakpoint(address)
			return true
		}
	}

	getBreakpoints() {
		return Array.from(this.breakpoints)
	}

	getCallStack() {
		return this.callStack.map((frame) => ({ ...frame }))
	}

	getExecutionHistory() {
		return this.executionHistory
	}

	/** The parsed instruction assembled to `address`, when the debugger has one. */
	instructionAt(address: number): MipsInstruction | null {
		const index = this.addressToInstructionMap.get(address)
		return index === undefined ? null : this.program.instructions[index] ?? null
	}

	/**
	 * Why fetching at `address` faults, or null when it may proceed.  Fetching
	 * outside a text segment is a fault only while self-modifying code is off,
	 * which is the same setting that gates text writes.
	 */
	fetchFault(address: number): string | null {
		if ((address & 3) !== 0) return 'fetch address for text segment not aligned to word boundary'
		if (!this.selfModifyingCode && !inTextSegment(address, this.layout)) return 'fetch address for text segment out of range'
		return null
	}

	/** The word at `address`, decoded, cached until that word is overwritten. */
	decodeAt(address: number): Decoded | null {
		const cached = this.decodeCache.get(address)
		if (cached !== undefined) return cached
		const decoded = decode(this.memory.get(address >>> 2) ?? 0)
		this.decodeCache.set(address, decoded)
		return decoded
	}

	readReg(number: number): number {
		return this.registers[REGISTER_NAMES[number]] | 0
	}

	writeReg(number: number, value: number) {
		if (number !== 0) this.writeRegNamed(REGISTER_NAMES[number], value | 0)
	}

	/**
	 * Every register-file write ends here, so one place sees them all.
	 * `writeReg` reaches only the 32 numbered GPRs, while the syscall and input
	 * paths name their result register and `$pc`, `$hi` and `$lo` have no
	 * number at all.  The value is stored as given: `$pc` holds a kernel
	 * handler address as an unsigned word, which `| 0` would turn negative.
	 */
	writeRegNamed(name: string, value: number) {
		this.record(KIND_REGISTER, registerFileIndex(name), this.registers[name])
		this.registers[name] = value
	}

	/** Hi and Lo are register-file entries as well as fields, so they move together. */
	private setHiLo(hi: number, lo: number) {
		this.record(KIND_HI_LO, this.hi, this.lo)
		this.hi = hi | 0
		this.lo = lo | 0
		// One effect covers both the fields and their register-file entries.
		this.registers.$hi = this.hi
		this.registers.$lo = this.lo
	}

	/** Every coprocessor 0 write ends here; the value is stored as given. */
	writeCp0(register: number, value: number) {
		this.record(KIND_CP0, register, this.cp0Registers[register])
		this.cp0Registers[register] = value
	}

	/** Everything the program prints passes through here. */
	writeConsole(text: string) {
		if (text.length === 0) return
		this.record(KIND_CONSOLE, 0, text.length, text)
		this.console += text
	}

	/** Syscall 60 empties the console rather than adding to it. */
	clearConsole() {
		this.record(KIND_CONSOLE_RESET, 0, 0, this.console)
		this.console = ''
	}

	/**
	 * One word out of the transmitter.  The low byte is the character; two of
	 * them are commands rather than text.  A form feed clears the display, and
	 * ASCII 7 places the cursor, taking its column from bits 20-31 of the whole
	 * word and its row from bits 8-19 -- which is why this takes the word and
	 * not just the byte.
	 *
	 * A program that has placed the cursor is writing to a grid rather than a
	 * stream, so the display becomes a fixed field of spaces it can write
	 * anywhere in; one that never does keeps the plain running text.
	 */
	transmit(word: number) {
		this.transmitterBusy = this.transmitterDelay
		const character = word & 0xff

		if (character === DISPLAY_CLEAR) {
			this.writeDisplayOutput(this.displayGrid ? blankDisplay(this.displayColumns, this.displayRows) : '')
			this.displayCursor = 0
			return
		}

		if (character === DISPLAY_SET_CURSOR) {
			const column = (word >>> 20) & 0xfff
			const row = (word >>> 8) & 0xfff
			if (!this.displayGrid) {
				this.displayGrid = true
				this.writeDisplayOutput(blankDisplay(this.displayColumns, this.displayRows))
			}
			this.displayCursor = this.cursorOffset(column, row)
			return
		}

		const text = this.keyboardDisplay.displayOutput
		if (!this.displayGrid) {
			this.writeDisplayOutput(text + String.fromCharCode(character))
			return
		}

		// In grid mode a character replaces the one under the cursor, so the
		// field keeps its shape however much is written into it.
		const at = this.displayCursor
		if (at >= text.length) return
		this.writeDisplayOutput(text.slice(0, at) + String.fromCharCode(character) + text.slice(at + 1))
		this.displayCursor = Math.min(text.length - 1, at + 1)
	}

	/** Where a column and row land in the display, rows separated by newlines. */
	private cursorOffset(column: number, row: number): number {
		const clampedRow = Math.max(0, Math.min(this.displayRows - 1, row))
		const clampedColumn = Math.max(0, Math.min(this.displayColumns - 1, column))
		return clampedRow * (this.displayColumns + 1) + clampedColumn
	}

	/** The memory-mapped display's text; a form feed clears it rather than adding. */
	writeDisplayOutput(text: string) {
		this.record(KIND_DISPLAY, 0, 0, this.keyboardDisplay.displayOutput)
		this.keyboardDisplay.displayOutput = text
	}

	/**
	 * Puts the program arguments on the stack, as `argc` in `$a0` and a vector of
	 * pointers in `$a1`.  The strings go above the stack pointer, the vector
	 * below them, and `$sp` ends up under the lot.
	 */
	loadProgramArguments(argv: readonly string[]) {
		if (argv.length === 0) return
		let top = this.layout.stackBaseAddress
		const pointers: number[] = []
		for (const argument of argv) {
			const bytes = [...argument].map((character) => character.charCodeAt(0) & 0xff)
			top -= bytes.length + 1
			// Each string starts on a word boundary, as the loader would leave it.
			top &= ~3
			pointers.push(top)
			bytes.forEach((byte, offset) => this.writeMemoryRaw(top + offset, byte, 1))
			this.writeMemoryRaw(top + bytes.length, 0, 1)
		}

		let vector = (top - 4 * pointers.length) & ~3
		const argvAddress = vector
		for (const pointer of pointers) {
			this.writeMemoryRaw(vector, pointer, 4)
			vector += 4
		}

		this.writeRegNamed('$a0', pointers.length)
		this.writeRegNamed('$a1', argvAddress)
		this.writeRegNamed('$sp', (argvAddress - 4) & ~3)
	}

	/** Where the next syscall 9 allocation starts. */
	/** Ends the run; a step back has to be able to bring it out of that. */
	halt() {
		this.record(KIND_HALTED, 0, this.halted ? 1 : 0)
		this.halted = true
	}

	/** Syscall 17 exits with a status; `null` means the program never exited. */
	setExitCode(code: number | null) {
		this.record(KIND_EXIT_CODE, this.exitCode === null ? 0 : 1, this.exitCode ?? 0)
		this.exitCode = code
	}

	/** How long the run pauses for syscall 32, or a MIDI note's duration. */
	setPendingSleep(milliseconds: number) {
		this.record(KIND_SLEEP, 0, this.pendingSleepMs)
		this.pendingSleepMs = milliseconds
	}

	writeHeapPointer(address: number) {
		this.record(KIND_HEAP_POINTER, 0, this.heapPointer)
		this.heapPointer = address
	}

	/** Branches are relative to the instruction after this one. */
	branch(offset: number) {
		this.transferTo((this.pc + 4 + offset * 4) | 0)
	}

	/** Takes a conditional branch or not, and tells the observers which. */
	conditionalBranch(taken: boolean, offset: number) {
		const target = (this.pc + 4 + offset * 4) | 0
		if (taken) this.transferTo(target)
		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onBranch?.(this.pc, taken, target)
		}
	}

	/**
	 * Redirects execution, immediately or after the delay slot.  Registering
	 * keeps the target of the branch already pending, so a branch
	 * inside a delay slot does not steal the transfer.
	 */
	transferTo(target: number) {
		if (!this.delayedBranching) {
			this.nextPc = target
			return
		}
		if (this.delayState === 'none') this.delayedTarget = target
		this.delayState = 'registered'
	}

	/** A jump keeps the top four bits of the address it came from. */
	jumpTarget(index: number): number {
		return ((((this.pc + 4) & 0xf0000000) >>> 0) | (index << 2)) >>> 0
	}

	/**
	 * `left + right`, raising before the caller can write a destination.
	 * Overflow is when the addends share a sign and the sum has the other.
	 */
	private checkedSum(left: number, right: number): number {
		const sum = (left + right) | 0
		if ((left >= 0 && right >= 0 && sum < 0) || (left < 0 && right < 0 && sum >= 0)) {
			this.signalException(EXCEPTION_ARITHMETIC_OVERFLOW)
			throw new Error('arithmetic overflow')
		}
		return sum
	}

	/**
	 * `left - right`, raising when they have opposite signs and the difference
	 * has `right`'s sign.
	 */
	private checkedDifference(left: number, right: number): number {
		const difference = (left - right) | 0
		if ((left >= 0 && right < 0 && difference < 0) || (left < 0 && right >= 0 && difference >= 0)) {
			this.signalException(EXCEPTION_ARITHMETIC_OVERFLOW)
			throw new Error('arithmetic overflow')
		}
		return difference
	}

	execute(decoded: Decoded) {
		const { op, rs, rt, rd, shamt, imm, uimm } = decoded

		try {
			switch (op) {
				// Arithmetic
				case ADD:
					this.writeReg(rd, this.checkedSum(this.readReg(rs), this.readReg(rt)))
					return
				case ADDU:
					this.writeReg(rd, (this.readReg(rs) + this.readReg(rt)) | 0)
					return
				case SUB:
					this.writeReg(rd, this.checkedDifference(this.readReg(rs), this.readReg(rt)))
					return
				case SUBU:
					this.writeReg(rd, (this.readReg(rs) - this.readReg(rt)) | 0)
					return
				case ADDI:
					this.writeReg(rt, this.checkedSum(this.readReg(rs), imm))
					return
				case ADDIU:
					this.writeReg(rt, (this.readReg(rs) + imm) | 0)
					return
				case MUL:
					this.writeReg(rd, Math.imul(this.readReg(rs), this.readReg(rt)))
					return

				// Logical
				case AND:
					this.writeReg(rd, this.readReg(rs) & this.readReg(rt))
					return
				case OR:
					this.writeReg(rd, this.readReg(rs) | this.readReg(rt))
					return
				case XOR:
					this.writeReg(rd, this.readReg(rs) ^ this.readReg(rt))
					return
				case NOR:
					this.writeReg(rd, ~(this.readReg(rs) | this.readReg(rt)))
					return
				case ANDI:
					this.writeReg(rt, this.readReg(rs) & uimm)
					return
				case ORI:
					this.writeReg(rt, this.readReg(rs) | uimm)
					return
				case XORI:
					this.writeReg(rt, this.readReg(rs) ^ uimm)
					return

				// Shifts
				case SLL:
					this.writeReg(rd, this.readReg(rt) << shamt)
					return
				case SRL:
					this.writeReg(rd, this.readReg(rt) >>> shamt)
					return
				case SRA:
					this.writeReg(rd, this.readReg(rt) >> shamt)
					return
				case SLLV:
					this.writeReg(rd, this.readReg(rt) << (this.readReg(rs) & 31))
					return
				case SRLV:
					this.writeReg(rd, this.readReg(rt) >>> (this.readReg(rs) & 31))
					return
				case SRAV:
					this.writeReg(rd, this.readReg(rt) >> (this.readReg(rs) & 31))
					return

				// Comparison
				case SLT:
					this.writeReg(rd, this.readReg(rs) < this.readReg(rt) ? 1 : 0)
					return
				case SLTU:
					this.writeReg(rd, (this.readReg(rs) >>> 0) < (this.readReg(rt) >>> 0) ? 1 : 0)
					return
				case SLTI:
					this.writeReg(rt, this.readReg(rs) < imm ? 1 : 0)
					return
				case SLTIU:
					// The immediate is sign-extended, then compared as unsigned.
					this.writeReg(rt, (this.readReg(rs) >>> 0) < (imm >>> 0) ? 1 : 0)
					return

				// Multiply and divide
				case MULT: {
					const product = BigInt(this.readReg(rs)) * BigInt(this.readReg(rt))
					this.setHiLo(Number(BigInt.asIntN(32, product >> 32n)), Number(BigInt.asIntN(32, product)))
					return
				}
				case MULTU: {
					const product = BigInt(this.readReg(rs) >>> 0) * BigInt(this.readReg(rt) >>> 0)
					this.setHiLo(Number(BigInt.asIntN(32, product >> 32n)), Number(BigInt.asIntN(32, product)))
					return
				}
				// Multiply-accumulate: the 64-bit HI/LO pair moves by the product
				//.
				case MADD:
				case MADDU:
				case MSUB:
				case MSUBU: {
					const unsigned = op === MADDU || op === MSUBU
					const left = BigInt(unsigned ? this.readReg(rs) >>> 0 : this.readReg(rs))
					const right = BigInt(unsigned ? this.readReg(rt) >>> 0 : this.readReg(rt))
					const product = left * right
					const accumulator = (BigInt(this.hi) << 32n) | BigInt(this.lo >>> 0)
					const result = BigInt.asIntN(64, op === MSUB || op === MSUBU
						? accumulator - product
						: accumulator + product)
					this.setHiLo(Number(BigInt.asIntN(32, result >> 32n)), Number(BigInt.asIntN(32, result)))
					return
				}

				// Counting leading bits.  MARS codes `rt` as zero rather than
				// repeating `rd`, so the word differs from real MIPS32
				//.
				case CLO:
				case CLZ: {
					const wanted = op === CLO ? 1 : 0
					const value = this.readReg(rs)
					let count = 0
					while (count < 32 && ((value >>> (31 - count)) & 1) === wanted) count++
					this.writeReg(rd, count)
					return
				}

				case DIV: {
					const dividend = this.readReg(rs)
					const divisor = this.readReg(rt)
					// Deliberate: MIPS32 raises nothing on a zero divisor and leaves
					// HI/LO undefined, and MARS follows it.  Do not "fix" this into a divide-by-zero exception.
					if (divisor === 0) return
					// MIPS truncates the quotient toward zero.
					this.setHiLo(dividend % divisor, dividend / divisor)
					return
				}
				case DIVU: {
					const dividend = this.readReg(rs) >>> 0
					const divisor = this.readReg(rt) >>> 0
					if (divisor === 0) return
					this.setHiLo(dividend % divisor, Math.floor(dividend / divisor))
					return
				}
				case MFHI:
					this.writeReg(rd, this.hi)
					return
				case MFLO:
					this.writeReg(rd, this.lo)
					return
				case MTHI:
					this.setHiLo(this.readReg(rs), this.lo)
					return
				case MTLO:
					this.setHiLo(this.hi, this.readReg(rs))
					return

				// Load and store
				case LW:
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 4))
					return
				case LH:
					this.writeReg(rt, (this.readMemory(this.effectiveAddress(rs, imm), 2) << 16) >> 16)
					return
				case LHU:
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 2))
					return
				case LB:
					this.writeReg(rt, (this.readMemory(this.effectiveAddress(rs, imm), 1) << 24) >> 24)
					return
				case LBU:
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 1))
					return
				case SW:
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 4)
					return
				case SH:
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 2)
					return
				case SB:
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 1)
					return

				// One processor is simulated, so the store always succeeds and
				// `ll`/`sc` are `lw`/`sw` with a success code.
				case LL:
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 4))
					return
				case SC:
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 4)
					this.writeReg(rt, 1)
					return

				// Unaligned word transfers.  Each moves the bytes between the
				// effective address and the near end of its word.
				case LWL:
				case LWR: {
					const address = this.effectiveAddress(rs, imm)
					const towardsLow = op === LWL
					let result = this.readReg(rt)
					for (let i = 0; i <= (towardsLow ? address & 3 : 3 - (address & 3)); i++) {
						const byte = this.readMemory(towardsLow ? address - i : address + i, 1)
						const shift = (towardsLow ? 3 - i : i) * 8
						result = ((result & ~(0xff << shift)) | (byte << shift)) >>> 0
					}
					this.writeReg(rt, result | 0)
					return
				}
				case SWL:
				case SWR: {
					const address = this.effectiveAddress(rs, imm)
					const towardsLow = op === SWL
					const source = this.readReg(rt) >>> 0
					for (let i = 0; i <= (towardsLow ? address & 3 : 3 - (address & 3)); i++) {
						const shift = (towardsLow ? 3 - i : i) * 8
						this.writeMemory(towardsLow ? address - i : address + i, (source >>> shift) & 0xff, 1)
					}
					return
				}
				case LUI:
					this.writeReg(rt, uimm << 16)
					return

				// Branches
				case BEQ:
					this.conditionalBranch(this.readReg(rs) === this.readReg(rt), imm)
					return
				case BNE:
					this.conditionalBranch(this.readReg(rs) !== this.readReg(rt), imm)
					return
				case BGEZ:
					this.conditionalBranch(this.readReg(rs) >= 0, imm)
					return
				case BGTZ:
					this.conditionalBranch(this.readReg(rs) > 0, imm)
					return
				case BLEZ:
					this.conditionalBranch(this.readReg(rs) <= 0, imm)
					return
				case BLTZ:
					this.conditionalBranch(this.readReg(rs) < 0, imm)
					return

				// Branch and link.  MARS links only on the taken path
				//, and the link skips the delay
				// slot exactly as a call does (`:3309-3313`).
				case BGEZAL:
				case BLTZAL: {
					const taken = op === BGEZAL ? this.readReg(rs) >= 0 : this.readReg(rs) < 0
					if (taken) this.writeReg(31, (this.pc + (this.delayedBranching ? 8 : 4)) | 0)
					this.conditionalBranch(taken, imm)
					return
				}

				// Jumps
				case J:
					this.transferTo(this.jumpTarget(decoded.index))
					return
				case JAL:
					this.enterCall(31, this.jumpTarget(decoded.index))
					return
				case JALR:
					this.enterCall(rd, this.readReg(rs) >>> 0)
					return
				case JR: {
					const target = this.readReg(rs) >>> 0
					this.leaveCall(target)
					this.transferTo(target)
					return
				}

				case SYSCALL:
					this.handleSyscall()
					return

				// A `.ktext` handler takes `break`; without one it stops the program.
				case BREAK: {
					const code = decoded.index >>> 6
					this.signalException(EXCEPTION_BREAKPOINT)
					throw new Error(code ? `break instruction executed; code = ${code}.` : 'break instruction executed; no code given.')
				}

				// Coprocessor 0
				case MFC0:
					this.writeReg(rt, this.cp0Registers[rd] | 0)
					return
				case MTC0:
					this.writeCp0(rd, this.readReg(rt))
					return
				case ERET:
					this.writeCp0(12, this.cp0Registers[12] & ~CP0_STATUS_EXL)
					this.nextPc = this.cp0Registers[14] >>> 0
					return

				// Coprocessor 1 moves, loads, stores, and branches
				case MFC1:
					this.writeReg(rt, this.fpRegisters[decoded.fs] | 0)
					return
				case MTC1:
					this.writeFpWord(decoded.fs, this.readReg(rt))
					return
				case LWC1:
					this.writeFpWord(decoded.ft, this.readMemory(this.effectiveAddress(rs, imm), 4))
					return
				case SWC1:
					this.writeMemory(this.effectiveAddress(rs, imm), this.fpRegisters[decoded.ft], 4)
					return
				case LDC1: {
					const index = this.evenRegister(decoded.ft)
					const address = this.effectiveAddress(rs, imm)
					this.writeFpWord(index, this.readMemory(address, 4))
					this.writeFpWord(index + 1, this.readMemory(address + 4, 4))
					return
				}
				case SDC1: {
					const index = this.evenRegister(decoded.ft)
					const address = this.effectiveAddress(rs, imm)
					this.writeMemory(address, this.fpRegisters[index], 4)
					this.writeMemory(address + 4, this.fpRegisters[index + 1], 4)
					return
				}
				// The branch and the moves name their own condition flag, 0-7
				//.
				case BC1T:
				case BC1F:
					this.conditionalBranch(this.fpConditionFlags[decoded.cc] === (op === BC1T), imm)
					return
				case MOVT:
				case MOVF:
					if (this.fpConditionFlags[decoded.cc] === (op === MOVT)) this.writeReg(rd, this.readReg(rs))
					return

				// Conditional moves on a register.
				case MOVN:
					if (this.readReg(rt) !== 0) this.writeReg(rd, this.readReg(rs))
					return
				case MOVZ:
					if (this.readReg(rt) === 0) this.writeReg(rd, this.readReg(rs))
					return

				default:
					if (this.executeTrap(decoded)) return
					if (this.executeFpOperation(decoded)) return
					this.signalException(EXCEPTION_RESERVED_INSTRUCTION)
					throw new Error(`Unsupported instruction: ${OP_NAMES[op] ?? op}`)
			}
		} catch (error) {
			if (error instanceof ExceptionAbort) throw error
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Error executing ${op}: ${message}`)
		}
	}

	/**
	 * Links `linkRegister` to the following instruction and records the frame.
	 * With delayed branching the link skips the delay slot, which has already
	 * run by the time the call returns.
	 */
	enterCall(linkRegister: number, target: number) {
		const returnAddress = (this.pc + (this.delayedBranching ? 8 : 4)) | 0
		this.writeReg(linkRegister, returnAddress)
		const frame = { callAddress: this.pc, returnAddress, targetAddress: target }
		this.record(KIND_CALL, 0, 0, frame)
		this.callStack.push(frame)
		this.transferTo(target)
	}

	/** A `jr` back to the top frame's return address leaves that call. */
	leaveCall(target: number) {
		const frame = this.callStack[this.callStack.length - 1]
		if (frame?.returnAddress !== target) return
		this.record(KIND_CALL, 0, 0, frame)
		this.callStack.pop()
	}

	effectiveAddress(base: number, offset: number): number {
		return (this.readReg(base) + offset) >>> 0
	}

	/**
	 * Runs one of the twelve traps, or returns false for anything else.  A trap
	 * that fires raises `TRAP` like any other exception, so a `.ktext` handler
	 * takes it and a program without one stops.
	 */
	executeTrap(decoded: Decoded): boolean {
		const form = OP_TRAP_FORMS[decoded.op]
		if (!form) return false
		const right = form.immediate ? decoded.imm : this.readReg(decoded.rt)
		if (form.holds(this.readReg(decoded.rs), right)) {
			this.signalException(EXCEPTION_TRAP)
			throw new Error('trap')
		}
		return true
	}

	/** Executes the dotted CP1 mnemonics; returns false for anything else. */
	executeFpOperation(decoded: Decoded): boolean {
		const asked = FP_FORMS[decoded.op]
		if (asked === undefined) return false
		const { ft, fs, fd } = decoded
		switch (asked.form) {
			case 'conditionalMove': return this.executeFpConditionalMove(asked.operation, asked.format, decoded)
			case 'arithmetic': return this.executeFpArithmetic(asked.operation, asked.format, fd, fs, ft)
			case 'compare': return this.executeFpCompare(asked.comparison, asked.format, fs, ft, decoded.cc)
			case 'convert': return this.executeFpConvert(asked.target, asked.source, fd, fs)
			case 'round': return this.executeFpRound(asked.operation, asked.format, fd, fs)
		}
	}

	executeFpArithmetic(operation: string, format: string, fd: number, fs: number, ft: number): boolean {
		if (format !== 's' && format !== 'd') return false
		const double = format === 'd'
		const read = (index: number) => double ? this.readFpDouble(index) : this.readFpSingle(index)
		const write = (index: number, value: number) => double ? this.writeFpDouble(index, value) : this.writeFpSingle(index, value)

		switch (operation) {
			case 'add': write(fd, read(fs) + read(ft)); return true
			case 'sub': write(fd, read(fs) - read(ft)); return true
			case 'mul': write(fd, read(fs) * read(ft)); return true
			case 'div': write(fd, read(fs) / read(ft)); return true
			case 'sqrt': write(fd, Math.sqrt(read(fs))); return true
			case 'abs': write(fd, Math.abs(read(fs))); return true
			case 'neg': write(fd, -read(fs)); return true
			case 'mov': {
				// A raw copy keeps NaN payloads and signed zeroes intact.
				const target = double ? this.evenRegister(fd) : fd
				const source = double ? this.evenRegister(fs) : fs
				this.writeFpWord(target, this.fpRegisters[source])
				if (double) this.writeFpWord(target + 1, this.fpRegisters[source + 1])
				return true
			}
			default: return false
		}
	}

	/**
	 * `movn.fmt`, `movz.fmt`, `movt.fmt` and `movf.fmt`: a raw register copy, so
	 * NaN payloads survive, and the even-register check runs before the condition.
	 */
	executeFpConditionalMove(operation: string, format: string, decoded: Decoded): boolean {
		if (format !== 's' && format !== 'd') return false
		const double = format === 'd'
		const target = double ? this.evenRegister(decoded.fd) : decoded.fd
		const source = double ? this.evenRegister(decoded.fs) : decoded.fs

		const moves = operation === 'movn' ? this.readReg(decoded.rt) !== 0
			: operation === 'movz' ? this.readReg(decoded.rt) === 0
				: this.fpConditionFlags[decoded.cc] === (operation === 'movt')
		if (!moves) return true

		this.writeFpWord(target, this.fpRegisters[source])
		if (double) this.writeFpWord(target + 1, this.fpRegisters[source + 1])
		return true
	}

	executeFpCompare(comparison: string, format: string, fs: number, ft: number, cc: number): boolean {
		const value = this.readFpFormatted(format, fs)
		const other = this.readFpFormatted(format, ft)
		if (value === null || other === null) return false

		const result = comparison === 'eq' ? value === other
			: comparison === 'lt' ? value < other
				: comparison === 'le' ? value <= other
					: null
		if (result === null) return false
		this.writeFpFlag(cc, result)
		return true
	}

	executeFpConvert(target: string, source: string, fd: number, fs: number): boolean {
		const value = this.readFpFormatted(source, fs)
		if (value === null) return false

		if (target === 's') this.writeFpSingle(fd, value)
		else if (target === 'd') this.writeFpDouble(fd, value)
		else if (target === 'w') this.writeFpWord(fd, roundToNearestEven(value))
		else return false
		return true
	}

	executeFpRound(operation: string, format: string, fd: number, fs: number): boolean {
		const value = this.readFpFormatted(format, fs)
		if (value === null) return false

		const rounded = operation === 'round' ? roundToNearestEven(value)
			: operation === 'trunc' ? Math.trunc(value)
				: operation === 'ceil' ? Math.ceil(value)
					: operation === 'floor' ? Math.floor(value)
						: null
		if (rounded === null) return false
		this.writeFpWord(fd, rounded)
		return true
	}

	/** Reads one CP1 operand in the given format, or null for an unknown format. */
	readFpFormatted(format: string, index: number): number | null {
		if (format === 's') return this.readFpSingle(index)
		if (format === 'd') return this.readFpDouble(index)
		if (format === 'w') return this.readFpWord(index)
		return null
	}

	/** Doubles occupy an even/odd register pair, so the operand must be even. */
	evenRegister(index: number): number {
		if (index % 2 !== 0) throw new Error(`Double-precision operands require an even register, not $f${index}`)
		return index
	}

	readFpWord(index: number): number {
		return this.fpRegisters[index] | 0
	}

	writeFpWord(index: number, value: number) {
		this.record(KIND_FP, index, this.fpRegisters[index])
		this.fpRegisters[index] = value >>> 0
	}

	/** Every CP1 condition-code write ends here. */
	writeFpFlag(index: number, value: boolean) {
		this.record(KIND_FLAG, index, this.fpConditionFlags[index] ? 1 : 0)
		this.fpConditionFlags[index] = value
	}

	readFpSingle(index: number): number {
		return bitsToSingle(this.fpRegisters[index])
	}

	writeFpSingle(index: number, value: number) {
		this.writeFpWord(index, singleToBits(value))
	}

	readFpDouble(index: number): number {
		const even = this.evenRegister(index)
		return bitsToDouble(this.fpRegisters[even], this.fpRegisters[even + 1])
	}

	writeFpDouble(index: number, value: number) {
		const even = this.evenRegister(index)
		const { low, high } = doubleToBits(value)
		this.writeFpWord(even, low)
		this.writeFpWord(even + 1, high)
	}

	/**
	 * Records a trap in CP0 and hands the pc to the `.ktext` handler when the
	 * program defines one, throwing `ExceptionAbort` to abandon the rest of the
	 * faulting instruction.  Dispatch depends only on the handler address
	 * holding a statement, with no enabling setting.
	 * Returning instead means there is no handler, so the caller reports the
	 * fault and the run ends.
	 */
	signalException(code: number, badVirtualAddress?: number): void {
		// EPC is the faulting instruction: MARS stores PC-4 because it has
		// already incremented.
		// The code is shifted two places into the exception-code field.  A device
		// code is wide enough to reach past that field into the pending bits, so
		// it is not masked to five bits, and those bits are cleared here rather
		// than left standing from the interrupt before.
		this.writeCp0(13, ((this.cp0Registers[13] & 0xfffffc83) | (code << 2)) >>> 0)
		this.writeCp0(14, this.pc)
		this.writeCp0(12, this.cp0Registers[12] | CP0_STATUS_EXL)
		if (badVirtualAddress !== undefined) this.writeCp0(8, badVirtualAddress >>> 0)

		if (!this.addressToInstructionMap.has(this.layout.exceptionHandlerAddress)) return
		// The delayed-branch transition runs after this and may still win, so a
		// fault in a delay slot does not reach the handler.
		this.nextPc = this.layout.exceptionHandlerAddress
		throw new ExceptionAbort()
	}

	/** A null-terminated string in memory, as the string syscalls read them. */
	readString(address: number, limit = 4096): string {
		let cursor = address >>> 0
		let text = ''
		for (let index = 0; index < limit; index++) {
			const byte = this.readMemory(cursor, 1)
			if (byte === 0) break
			text += String.fromCharCode(byte)
			cursor += 1
		}
		return text
	}

	handleSyscall() {
		const code = this.registers['$v0'] | 0
		const a0 = this.registers['$a0'] | 0
		const a1 = this.registers['$a1'] | 0
		const a2 = this.registers['$a2'] | 0

		switch (code) {
			case 1:
				this.writeConsole(String(a0))
				break
			case 4:
				this.writeConsole(this.readString(a0 >>> 0))
				break
			case 5:
				this.requestInput({ type: 'integer' })
				break
			case 8:
				this.requestInput({ type: 'string', maximumLength: a1, bufferAddress: a0 >>> 0 })
				break
			case 9:
				this.allocateHeap(a0)
				break
			case 10:
				this.halt()
				break
			case 11:
				this.writeConsole(String.fromCharCode(a0 & 0xff))
				break
			case 12:
				this.requestInput({ type: 'character' })
				break
			case 17:
				this.setExitCode(a0)
				this.halt()
				break
			case 2:
				this.writeConsole(formatSingle(bitsToSingle(this.fpRegisters[12])))
				break
			case 3:
				this.writeConsole(formatDouble(bitsToDouble(this.fpRegisters[12], this.fpRegisters[13])))
				break
			case 6:
				this.requestInput({ type: 'float' })
				break
			case 7:
				this.requestInput({ type: 'double' })
				break

			// File operations.  Descriptors 1 and 2 are the console.
			case 13:
				this.captureFiles()
				this.writeRegNamed('$v0', this.files.openFile(this.readString(a0 >>> 0), a1))
				break
			case 14: {
				this.captureFiles()
				const bytes = this.files.read(a0, a2)
				if (bytes === -1) {
					this.writeRegNamed('$v0', -1)
					break
				}
				for (let index = 0; index < bytes.length; index++) this.writeMemory((a1 >>> 0) + index, bytes[index], 1)
				this.writeRegNamed('$v0', bytes.length)
				break
			}
			case 15: {
				const bytes: number[] = []
				for (let index = 0; index < a2; index++) bytes.push(this.readMemory((a1 >>> 0) + index, 1))
				if (a0 === STDOUT || a0 === STDERR) {
					this.writeConsole(bytes.map((byte) => String.fromCharCode(byte)).join(''))
					this.writeRegNamed('$v0', bytes.length)
					break
				}
				this.captureFiles()
				this.writeRegNamed('$v0', this.files.write(a0, bytes))
				break
			}
			// A close reports no status: $v0 is left as the program set it.
			case 16:
				this.captureFiles()
				this.files.close(a0)
				break

			case 30: {
				// Milliseconds since the epoch, low half in $a0 and high half in $a1.
				const now = this.clock()
				this.writeRegNamed('$a0', now | 0)
				this.writeRegNamed('$a1', Math.floor(now / 0x100000000) | 0)
				break
			}
			case 32:
				this.setPendingSleep(Math.max(0, a0))
				break

			// MIDI.  31 returns at once; 33 waits out the note.  An out-of-range
			// argument falls back to its default rather than being masked
			//.
			case 31:
			case 33: {
				const note = {
					pitch: midiArgument(a0, MIDI_DEFAULT_PITCH),
					durationMs: a1 < 0 ? MIDI_DEFAULT_DURATION : a1,
					instrument: midiArgument(a2, MIDI_DEFAULT_INSTRUMENT),
					volume: midiArgument(this.registers['$a3'] | 0, MIDI_DEFAULT_VOLUME),
				}
				this.midi?.play(note)
				if (code === 33) this.setPendingSleep(note.durationMs)
				break
			}

			case 34:
				this.writeConsole(`0x${(a0 >>> 0).toString(16).padStart(8, '0')}`)
				break
			case 35:
				this.writeConsole((a0 >>> 0).toString(2).padStart(32, '0'))
				break
			case 36:
				this.writeConsole((a0 >>> 0).toString(10))
				break

			// Pseudo-random streams, one per identifier in $a0.
			case 40:
				this.captureRandom()
				this.random.setSeed(a0, a1)
				break
			case 41:
				this.captureRandom()
				this.writeRegNamed('$a0', this.random.stream(a0).nextInt())
				break
			case 42:
				if (a1 <= 0) throw new Error(`Random upper bound (${a1}) must be positive`)
				this.captureRandom()
				this.writeRegNamed('$a0', this.random.stream(a0).nextIntBounded(a1))
				break
			case 43:
				this.captureRandom()
				this.writeFpSingle(0, this.random.stream(a0).nextFloat())
				break
			case 44:
				this.captureRandom()
				this.writeFpDouble(0, this.random.stream(a0).nextDouble())
				break

			// Dialogs.  A browser tab has no modal window, so these prompt in the
			// console; the status codes a program checks are unchanged.
			case 50:
				this.requestInput({ type: 'confirm', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 51:
				this.requestInput({ type: 'integer', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 52:
				this.requestInput({ type: 'float', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 53:
				this.requestInput({ type: 'double', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 54:
				this.requestInput({ type: 'string', prompt: this.readString(a0 >>> 0), dialog: true, maximumLength: a2, bufferAddress: a1 >>> 0 })
				break
			case 55:
				this.writeConsole(`${DIALOG_LABELS[a1] ?? ''}${this.readString(a0 >>> 0)}\n`)
				break
			case 56:
				this.writeConsole(`${this.readString(a0 >>> 0)}${a1}\n`)
				break
			case 57:
				this.writeConsole(`${this.readString(a0 >>> 0)}${formatSingle(bitsToSingle(this.fpRegisters[12]))}\n`)
				break
			case 58:
				this.writeConsole(`${this.readString(a0 >>> 0)}${formatDouble(bitsToDouble(this.fpRegisters[12], this.fpRegisters[13]))}\n`)
				break
			case 59:
				this.writeConsole(`${this.readString(a0 >>> 0)}${this.readString(a1 >>> 0)}\n`)
				break

			// Empties the run console.
			case 60:
				this.clearConsole()
				break

			default:
				this.signalException(EXCEPTION_SYSCALL)
				throw new Error(`Unsupported syscall: ${code}`)
		}
	}

	allocateHeap(requestedBytes: number) {
		if (requestedBytes < 0) throw new Error(`Heap allocation request (${requestedBytes}) is negative`)
		const address = this.heapPointer
		this.writeHeapPointer((this.heapPointer + requestedBytes + 3) & ~3)
		this.writeRegNamed('$v0', address)
	}

	requestInput(request: PendingInput) {
		this.pendingInput = request
		this.paused = true
		this.running = false
	}

	/**
	 * Resumes a program waiting on input.  `cancelled` is how a dialog reports
	 * that the user dismissed it, which is distinct from empty input.
	 */
	provideInput(input: string, cancelled = false) {
		const request = this.pendingInput
		if (!request) return false

		// Kept so the panel can show what was answered; the registers and memory
		// it lands in are effects of their own.
		this.record(KIND_INPUT, 0, 0, cancelled ? '' : input)
		this.completeInput(request, input, cancelled)

		this.pendingInput = null
		// Finish the suspended instruction rather than re-deriving a pc: in a
		// delay slot the next pc is the branch target, not the next word.
		this.finishStep()
		this.closeEntry()
		return true
	}

	/** Puts an answer where the syscall wanted it, without ending the instruction. */
	private completeInput(request: PendingInput, input: string, cancelled: boolean) {
		if (request.dialog) this.completeDialog(request, input, cancelled)
		else this.completeConsoleInput(request, input)
	}

	completeConsoleInput(request: PendingInput, input: string) {
		if (request.type === 'integer') {
			const value = Number.parseInt(input.trim(), 10)
			this.writeRegNamed('$v0', Number.isNaN(value) ? 0 : value)
		} else if (request.type === 'character') {
			this.writeRegNamed('$v0', input.charCodeAt(0) || 0)
		} else if (request.type === 'float') {
			this.writeFpSingle(0, Number.parseFloat(input) || 0)
		} else if (request.type === 'double') {
			this.writeFpDouble(0, Number.parseFloat(input) || 0)
		} else {
			this.writeInputString(input, request.maximumLength || 0, request.bufferAddress)
		}
	}

	/** Dialog syscalls report an outcome in $a1 alongside the value they read. */
	completeDialog(request: PendingInput, input: string, cancelled: boolean) {
		if (request.type === 'confirm') {
			// 0 yes, 1 no, 2 cancel.
			this.writeRegNamed('$a0', cancelled ? 2 : /^\s*(y|yes|1|true)\s*$/i.test(input) ? 0 : 1)
			return
		}

		if (request.type === 'string') {
			// Neither a cancel nor an empty field writes the buffer
			//.
			if (cancelled) this.writeRegNamed('$a1', DIALOG_CANCELLED)
			else if (input.length === 0) this.writeRegNamed('$a1', DIALOG_NO_INPUT)
			else this.writeRegNamed('$a1', this.writeDialogString(input, request.maximumLength ?? 0, (request.bufferAddress ?? 0) >>> 0))
			return
		}

		// The value register is zeroed before the input is read, so a cancelled or
		// unparseable dialog reads back zero rather than the prompt address.
		this.storeDialogValue(request.type, 0)
		if (cancelled) {
			this.writeRegNamed('$a1', DIALOG_CANCELLED)
			return
		}
		// OK on an empty field is its own outcome.
		if (input.length === 0) {
			this.writeRegNamed('$a1', DIALOG_NO_INPUT)
			return
		}

		const value = request.type === 'integer' ? Number.parseInt(input.trim(), 10) : Number.parseFloat(input.trim())
		if (Number.isNaN(value)) {
			this.writeRegNamed('$a1', DIALOG_BAD_INPUT)
			return
		}

		this.storeDialogValue(request.type, value)
		this.writeRegNamed('$a1', DIALOG_OK)
	}

	/** Where each numeric dialog leaves what it read: $a0 for 51, $f0 for 52-53. */
	private storeDialogValue(type: PendingInput['type'], value: number) {
		if (type === 'integer') this.writeRegNamed('$a0', value | 0)
		else if (type === 'float') this.writeFpSingle(0, value)
		else if (type === 'double') this.writeFpDouble(0, value)
	}

	/**
	 * Stores a syscall 54 string and returns the status for $a1: -4 when the
	 * input did not fit.  Unlike syscall
	 * 8 the buffer size is $a2 itself, and the newline goes in whenever the
	 * string leaves room for it.
	 */
	private writeDialogString(input: string, maximumLength: number, address: number): number {
		const length = input.length
		for (let index = 0; index < length && index < maximumLength - 1; index++) {
			this.writeMemory(address + index, input.charCodeAt(index), 1)
		}
		if (length < maximumLength - 1) this.writeMemory(address + length, NEWLINE_BYTE, 1)
		const terminator = Math.min(length + 1, maximumLength - 1)
		if (terminator >= 0) this.writeMemory(address + terminator, 0, 1)
		return length > maximumLength - 1 ? DIALOG_TRUNCATED : DIALOG_OK
	}

	/** Syscall 8's buffer rules: $a1 counts the terminator. */
	writeInputString(input: string, maximumLength: number, bufferAddress?: number) {
		if (maximumLength <= 0) return
		const address = (bufferAddress ?? this.registers['$a0']) >>> 0
		const value = input.slice(0, Math.max(0, maximumLength - 1))
		for (let index = 0; index < value.length; index++) {
			this.writeMemory(address + index, value.charCodeAt(index), 1)
		}
		let length = value.length
		if (length < maximumLength - 1) {
			this.writeMemory(address + length, '\n'.charCodeAt(0), 1)
			length++
		}
		this.writeMemory(address + length, 0, 1)
	}

	/**
	 * Faults an access before any byte moves.  Alignment is checked only by the
	 * word and halfword forms, so `LWL`, `LWR`, `SWL` and `SWR`, which move one
	 * byte at a time, stay exempt by
	 * construction.  Writing into a text segment needs self-modifying code
	 * enabled, whatever the width.
	 */
	checkAccess(address: number, size: number, store: boolean) {
		if ((size === 4 && (address & 3) !== 0) || (size === 2 && (address & 1) !== 0)) {
			const boundary = size === 4 ? 'word' : 'halfword'
			const verb = store ? 'store' : 'fetch'
			this.raiseAddressError(`${verb} address not aligned on ${boundary} boundary`, address, store)
		}
		if (!inAddressSpace(address, this.layout)) {
			this.raiseAddressError('address out of range', address, store)
		}
		// Text is code, not data: reading it is as much a mistake as writing it,
		// and the same setting is what allows a program to treat it as data.
		if (!this.selfModifyingCode && inTextSegment(address, this.layout)) {
			const message = store ? 'Cannot write directly to text segment!' : 'Cannot read directly from text segment!'
			this.raiseAddressError(message, address, store)
		}
	}

	/**
	 * Signals a bad address and abandons the access.  With a handler loaded
	 * `signalException` throws, so the rest of the instruction never runs; with
	 * none the thrown message ends the run.
	 */
	raiseAddressError(message: string, address: number, store: boolean): never {
		this.signalException(store ? EXCEPTION_ADDRESS_STORE : EXCEPTION_ADDRESS_LOAD, address)
		throw new Error(`${message}: 0x${formatWordDigits(address)}`)
	}

	readMemory(addr: number, size: number): number {
		this.checkAccess(addr >>> 0, size, false)
		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onMemoryRead?.(addr >>> 0, size)
		}
		let value = 0
		for (let i = 0; i < size; i++) value |= this.readByte((addr + i) >>> 0) << (i * 8)
		return value >>> 0
	}

	writeMemory(addr: number, value: number, size: number) {
		this.checkAccess(addr >>> 0, size, true)
		// The transmitter's command word carries a cursor position above the
		// character, which a byte-at-a-time write would take apart.
		if (size === 4 && (addr >>> 0) === this.layout.memoryMapBaseAddress + TRANSMITTER_DATA_OFFSET) {
			if (this.observers.length > 0) {
				for (const observer of this.observers) observer.onMemoryWrite?.(addr >>> 0, size, value)
			}
			this.transmit(value >>> 0)
			return
		}
		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onMemoryWrite?.(addr >>> 0, size, value)
		}
		for (let i = 0; i < size; i++) this.writeByte((addr + i) >>> 0, value >>> (i * 8))
	}

	/**
	 * Writes past the protection checks.  Program loading and deliberate debugger
	 * edits use this; a running instruction never does.
	 */
	writeMemoryRaw(addr: number, value: number, size: number) {
		for (let i = 0; i < size; i++) this.writeByte((addr + i) >>> 0, value >>> (i * 8))
	}

	readByte(addr: number): number {
		const mmio = this.layout.memoryMapBaseAddress
		if (addr === mmio + RECEIVER_CONTROL_OFFSET) {
			return (this.keyboardDisplay.queuedInput.length > 0 ? MMIO_READY : 0) | (this.receiverInterruptEnabled ? MMIO_INTERRUPT_ENABLE : 0)
		}
		if (addr === mmio + RECEIVER_DATA_OFFSET) {
			const character = this.keyboardDisplay.queuedInput.charCodeAt(0) || 0
			// Reading this register consumes the character, so the read is a write
			// as far as the log is concerned.
			if (character) {
				this.record(KIND_QUEUED_INPUT, 0, 0, this.keyboardDisplay.queuedInput)
				this.keyboardDisplay.queuedInput = this.keyboardDisplay.queuedInput.slice(1)
			}
			return character
		}
		if (addr === mmio + TRANSMITTER_CONTROL_OFFSET) {
			// The transmitter is busy until the delay it was given has run out, so
			// a program that polls this sees it clear the way real hardware would.
			return (this.transmitterBusy > 0 ? 0 : MMIO_READY) | (this.transmitterInterruptEnabled ? MMIO_INTERRUPT_ENABLE : 0)
		}
		const wordAddr = addr >>> 2
		return ((this.memory.get(wordAddr) || 0) >>> ((addr & 3) * 8)) & 0xff
	}

	writeByte(addr: number, value: number) {
		const mmio = this.layout.memoryMapBaseAddress
		// A byte written on its own carries no position, so it is the character.
		if (addr === mmio + TRANSMITTER_DATA_OFFSET) {
			this.transmit(value & 0xff)
			return
		}
		// The two control registers are written to enable an interrupt; the rest
		// of either is the device's to report, not the program's to set.
		if (addr === mmio + RECEIVER_CONTROL_OFFSET) {
			this.receiverInterruptEnabled = (value & MMIO_INTERRUPT_ENABLE) !== 0
			return
		}
		if (addr === mmio + TRANSMITTER_CONTROL_OFFSET) {
			this.transmitterInterruptEnabled = (value & MMIO_INTERRUPT_ENABLE) !== 0
			return
		}
		if (addr === mmio + RECEIVER_DATA_OFFSET) return
		const wordAddr = addr >>> 2
		const shift = (addr & 3) * 8
		const previous = this.memory.get(wordAddr)
		const oldWord = previous || 0
		const word = ((oldWord & ~(0xff << shift)) | ((value & 0xff) << shift)) >>> 0
		if (word === oldWord && previous !== undefined) return
		this.recordMemory(wordAddr)
		this.memory.set(wordAddr, word)
		// Self-modifying code: the previous decoding of this word no longer holds.
		this.decodeCache.delete(wordAddr << 2)
	}

	getState(): SimulatorState {
		return {
			registers: { ...this.registers },
			memory: this.getMemoryView(),
			console: this.console,
			pc: this.pc,
			hi: this.hi,
			lo: this.lo,
			instructionCount: this.instructionCount,
			paused: this.paused,
			halted: this.halted,
			callStack: this.getCallStack(),
			pendingInput: this.pendingInput,
			heapPointer: this.heapPointer,
			keyboardDisplay: { ...this.keyboardDisplay },
			fpRegisters: [...this.fpRegisters],
			fpConditionFlags: [...this.fpConditionFlags],
			cp0Registers: [...this.cp0Registers],
		}
	}

	queueKeyboardInput(input: string) {
		this.keyboardDisplay.queuedInput += input
	}

	getMemoryView(): MemoryView {
		return { words: this.memory }
	}
}
