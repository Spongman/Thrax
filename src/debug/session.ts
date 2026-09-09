/**
 * Stepping and breakpoint policy for one assembled program.
 *
 * The simulator owns the mechanism: it steps, runs, and stops where a
 * breakpoint says to.  This session owns the policy around it - which addresses
 * are worth stopping at, and where the breakpoints live - so the workspace
 * store drives the debugger through one object and publishes `view()` rather
 * than reaching into the runtime itself.
 */

import type { MipsSimulator } from '../core/simulator'
import { EMPTY_SOURCE_INDEX, type SourceIndex } from '../core/sourceIndex'

/** Breakpoint state as the workspace shows it. */
export interface DebugView {
	/**
	 * Whether there is a program loaded to debug.  A panel offering to edit the
	 * machine needs it: with no machine an edit has nowhere to land, and a cell
	 * that takes the value anyway can only refuse it, which reads as the value
	 * being wrong rather than as there being no program.
	 */
	hasMachine: boolean
	/** Lines holding a breakpoint, keyed by the file they were set in. */
	breakpointLines: Map<string, Set<number>>
	/** Breakpoints on addresses with no source line, such as a pseudo-instruction tail. */
	breakpointAddresses: Set<number>
	/** Every address the program will stop at. */
	breakpoints: Set<number>
}

const NO_ADDRESSES: ReadonlySet<number> = new Set<number>()

/** How many wordless words one Step will pass through before giving up. */
const MAX_HIDDEN_WORDS_PER_STEP = 100

/**
 * Every address the editor can point at: the first word of each line of code,
 * across every file the program was assembled from.  A run reaches all of them,
 * so stepping stops in a library exactly as it does in the file that called it.
 */
export function visibleAddresses(index: SourceIndex): ReadonlySet<number> {
	const addresses = new Set<number>()
	for (const file of index.files()) for (const address of index.codeAddresses(file)) addresses.add(address)
	return addresses
}

/** Builds the program a control was pressed before there was one, if it assembles. */
export type AssembleProgram = () => MipsSimulator | null

export class DebugSession {
	private simulator: MipsSimulator | null = null
	private index: SourceIndex = EMPTY_SOURCE_INDEX
	private lines = new Map<string, Set<number>>()
	private addresses = new Set<number>()
	/** The union `visible()` returns, rebuilt only when the program is. */
	private visibleSet: ReadonlySet<number> = NO_ADDRESSES
	/** While the editor shows a row per machine word, every word is worth stopping at. */
	private wordRows = false

	/**
	 * `assemble` is expected to call `rebind` with what it built, and to return
	 * null when the source does not assemble.
	 */
	constructor(private readonly assemble: AssembleProgram = () => null) {}

	/** The runtime being debugged, or null until a program assembles. */
	get machine(): MipsSimulator | null {
		return this.simulator
	}

	/** Takes on a freshly assembled program, carrying the breakpoints across. */
	rebind(simulator: MipsSimulator, index: SourceIndex) {
		this.simulator = simulator
		this.index = index
		this.visibleSet = visibleAddresses(index)
		// Lines move as the source is edited, and a line that now holds no code
		// hands its breakpoint to the next line that does.  A file this build left
		// out keeps its lines untouched, so they come back with it.
		const assembled = new Set(index.files())
		const carried = [...this.lines].map(([file, lines]): [string, Set<number>] => [file, assembled.has(file)
			? new Set([...lines].flatMap((line) => {
				const target = index.codeLineAtOrAfter(file, line)
				return target === undefined ? [] : [target]
			}))
			: lines])
		this.lines = new Map(carried.filter(([, lines]) => lines.size > 0))
		this.apply()
	}

	/** Drops the program an edit invalidated; the breakpoints wait for the next one. */
	detach() {
		this.simulator = null
		this.index = EMPTY_SOURCE_INDEX
		this.visibleSet = NO_ADDRESSES
	}

	/** Forgets the breakpoints too, which is what a reset asks for. */
	clear() {
		this.lines = new Map()
		this.addresses = new Set()
		this.detach()
	}

	/** Whether the editor is showing a row per machine word. */
	setWordRows(shown: boolean) {
		this.wordRows = shown
		this.apply()
	}

	view(): DebugView {
		return {
			hasMachine: this.simulator !== null,
			breakpointLines: new Map([...this.lines].map(([file, lines]) => [file, new Set(lines)])),
			breakpointAddresses: new Set(this.addresses),
			breakpoints: new Set(this.simulator?.getBreakpoints() ?? []),
		}
	}

	/** Addresses the editor can point at, in every file the program was built from. */
	private visible(): ReadonlySet<number> {
		return this.visibleSet
	}

	/**
	 * Rebuilds what the simulator stops at from the breakpoints this session
	 * holds, and tells a paced run to animate the same words stepping stops on.
	 */
	private apply() {
		const simulator = this.simulator
		if (!simulator) return
		for (const address of simulator.getBreakpoints()) simulator.removeBreakpoint(address)
		for (const [file, lines] of this.lines) {
			for (const line of lines) {
				const address = this.index.codeAddressForLine(file, line)
				if (address !== undefined) simulator.addBreakpoint(address)
			}
		}
		for (const address of this.addresses) simulator.addBreakpoint(address)
		simulator.configure({ pacedAddresses: this.wordRows ? null : this.visible() })
	}

	/**
	 * A word with no line of its own - the tail of a pseudo-instruction - is
	 * worth stopping at only while the word rows show it.  A breakpoint on one
	 * always is.
	 */
	private hidden(simulator: MipsSimulator, address: number): boolean {
		return !this.wordRows && !this.visible().has(address) && !simulator.breakpoints.has(address)
	}

	/**
	 * Whether a step should carry on past the word it just landed on.  Halting,
	 * a pause, and input the program is waiting for all end it.
	 *
	 * `skipped` bounds the one case that would not end by itself, a jump into a
	 * stretch of hidden words.  The bound is its own number rather than the
	 * machine's history size: one press of Step should not run thousands of
	 * instructions just because the workspace is willing to remember them.
	 */
	private skipping(simulator: MipsSimulator, skipped: number): boolean {
		if (skipped >= MAX_HIDDEN_WORDS_PER_STEP) return false
		if (simulator.halted || simulator.paused || simulator.pendingInput) return false
		return this.hidden(simulator, simulator.pc)
	}

	/**
	 * Every control needs a program.  Most assemble one if there is none yet;
	 * those that only make sense mid-run pass the attached program instead, and
	 * do nothing without it.
	 */
	private control(action: (simulator: MipsSimulator) => void, on: MipsSimulator | null = this.required()): boolean {
		if (!on) return false
		action(on)
		return true
	}

	private async controlAsync(action: (simulator: MipsSimulator) => Promise<void>, on: MipsSimulator | null = this.required()): Promise<boolean> {
		if (!on) return false
		await action(on)
		return true
	}

	private required(): MipsSimulator | null {
		return this.simulator ?? this.assemble()
	}

	step(): boolean {
		return this.control((simulator) => {
			let skipped = 0
			do {
				simulator.step()
			} while (this.skipping(simulator, skipped++))
		})
	}

	/** Steps back to the previous word the editor can point at. */
	stepBack(): boolean {
		// History is finite and each step back consumes one snapshot, so this ends
		// on its own; with no program there is nothing to step back through.
		return this.control((simulator) => {
			let more = simulator.stepBack()
			while (more && this.hidden(simulator, simulator.pc)) more = simulator.stepBack()
		}, this.simulator)
	}

	async stepOver(): Promise<boolean> {
		return this.controlAsync(async (simulator) => {
			let skipped = 0
			do {
				await simulator.stepOver()
			} while (this.skipping(simulator, skipped++))
		})
	}

	async stepToReturn(): Promise<boolean> {
		return this.controlAsync((simulator) => simulator.stepToReturn())
	}

	/** Runs on from where the program stands, stopping at the next breakpoint. */
	async continue(): Promise<boolean> {
		return this.controlAsync((simulator) => simulator.continue(), this.simulator)
	}

	/** Runs to `address` without leaving a breakpoint there. */
	async runTo(address: number): Promise<boolean> {
		return this.controlAsync((simulator) => simulator.runTo(address))
	}

	pause(): boolean {
		return this.control((simulator) => simulator.pause(), this.simulator)
	}

	/** Moves execution to `address` without running anything. */
	setProgramCounter(address: number): boolean {
		return this.control((simulator) => simulator.setProgramCounter(address))
	}

	/**
	 * A breakpoint asked for on a blank or comment line belongs to the next line
	 * of code.  A file the current program was not built from takes the line as
	 * it was asked for; the next build that reaches the file settles it.
	 */
	toggleBreakpointLine(file: string, line: number): boolean {
		const target = this.index.hasCode(file) ? this.index.codeLineAtOrAfter(file, line) : line
		if (target === undefined) return false
		const lines = this.lines.get(file)
		if (!lines) this.lines.set(file, new Set([target]))
		else if (!lines.delete(target)) lines.add(target)
		else if (lines.size === 0) this.lines.delete(file)
		this.apply()
		return true
	}

	toggleBreakpointAddress(address: number): boolean {
		if (!this.addresses.delete(address)) this.addresses.add(address)
		this.apply()
		return true
	}

	/**
	 * The editor reports where its markers moved to as the source is edited,
	 * which is raw geometry; the next `rebind` settles them onto lines of code.
	 */
	setBreakpointLines(file: string, lines: Iterable<number>) {
		const kept = new Set([...lines].filter((line) => Number.isInteger(line) && line > 0))
		if (kept.size === 0) this.lines.delete(file)
		else this.lines.set(file, kept)
		this.apply()
	}
}
