/**
 * Execution events the tools observe.
 *
 * Tools watch a run rather than take part in it: nothing an observer does can
 * change what an instruction means.  The simulator holds a list of these and
 * skips the calls entirely when the list is empty, so an unopened tool costs
 * nothing.
 */

import type { Decoded } from './decoder'
import type { ServiceHost } from './service'

/**
 * A memory-mapped device's way of answering the program.
 *
 * The observer interface stays read-only, since its contract is that nothing a
 * tool does changes what an instruction means.  A device is not an observer in
 * that sense: it has state of its own that a program polls, so it needs to put
 * values where the program will read them.
 *
 * A write is queued rather than applied where it is asked for.  The simulator
 * drains the queue at the top of the next step, before the fetch, so a device
 * write is a distinct event at an instruction boundary instead of an untracked
 * change in the middle of another instruction's effects.  The drain goes
 * through the ordinary byte writer, so it is recorded and rolls back with
 * everything else.
 */
export interface DevicePort {
	/** Reads a word past the protections, without reporting it to the observers. */
	read(address: number): number
	/** Queues a word, applied at the start of the next instruction. */
	write(address: number, value: number): void
	/**
	 * Asks for an external interrupt, taken in place of the next instruction.
	 * `cause` is shifted two places into the cause register, so a device names
	 * itself by the pending bit it lands on rather than by an exception code.
	 *
	 * Refused while the machine is already in a handler, since the interrupt
	 * would overwrite the return address the handler has yet to use.  A refused
	 * request is dropped rather than held.
	 */
	interrupt(cause: number): boolean
}

/** One instruction the machine has run, as a tool replaying them reads it. */
export interface ExecutedInstruction {
	address: number
	/** The word executed, which a tool decodes for itself. */
	word: number | null
	/** The count before this instruction ran. */
	instructionCount: number
	kind: 'instruction' | 'edit'
}

/**
 * The instructions that have run, in order.  A tool rebuilds itself from these
 * rather than keeping a copy of its own state for every step, which is the
 * bargain the machine's own history already makes.
 */
export interface InstructionHistory {
	readonly length: number
	at(index: number): ExecutedInstruction | undefined
}

/** What a tool needs to know about the machine, as opposed to the run on it. */
export interface MachineConfig {
	/** Delayed branching: the instruction after a branch runs first. */
	delayedBranching: boolean
	/**
	 * How a memory-mapped device reads and answers the program.  Absent for a
	 * tool attached to something that offers no device port.
	 */
	device?: DevicePort
	/**
	 * The log of instructions the machine keeps anyway, for a tool that rewinds
	 * by replaying them.  Absent where whatever the tool watches keeps none.
	 */
	history?: InstructionHistory
	/**
	 * Where a tool holding state of its own signs up to be rolled back with the
	 * machine.  A device with a position cannot be replayed out of the log the
	 * way a tally can, so it says what changed instead; see `core/service`.
	 */
	services?: ServiceHost
}

export interface ExecutionObserver {
	/**
	 * Before `decoded` at `address` runs.  `instructionCount` is how many have
	 * retired, which is what a tool tags its own checkpoints with so a step back
	 * can find them.
	 */
	onInstruction?(address: number, decoded: Decoded, instructionCount: number): void
	/** A data read of `size` bytes; instruction fetches are not reported. */
	onMemoryRead?(address: number, size: number): void
	/**
	 * A data write of `size` bytes.  `value` is what the instruction wrote: a
	 * memory-mapped device tool is driven by the value, so the address alone
	 * tells it nothing.
	 */
	onMemoryWrite?(address: number, size: number, value: number): void
	/**
	 * A conditional branch resolved.  `target` is where it would go when taken,
	 * whether or not it was.
	 */
	onBranch?(address: number, taken: boolean, target: number): void
	/** Execution restarted, so accumulated counts belong to the previous run. */
	onReset?(): void
	/**
	 * The machine has moved to just before instruction `toInstructionCount`,
	 * backwards or forwards.  A tool's numbers are an accumulation over the
	 * instructions that ran, so without this they keep climbing across a step
	 * back and count the same instruction twice on the way forward.
	 */
	onSeek?(toInstructionCount: number): void
	/**
	 * The machine the coming run is on, dispatched once as the tool is attached.
	 * It describes the hardware rather than the run, so a reset does not undo it.
	 */
	onConfigure?(machine: MachineConfig): void
}
