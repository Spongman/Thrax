/** Workbench scheduling and debugger completion policy, independent of the ISA. */
import { yieldToHost } from './yieldToHost'
import type { MachineHistory, MachineStopReason, RegisterValue } from '../architectures/contracts'
import { rewindHistoryTo } from './historyCursor'

export class ExecutionStep {
	static readonly ADVANCED = 0
	static readonly WAIT = 1
	static readonly HIDDEN = 2
}

interface ExecutionHost {
	readonly pc: number
	readonly halted: boolean
	paused: boolean
	readonly breakpoints: ReadonlySet<number>
	onProgress: (() => void) | null
	step(): void
}

interface ExecutionBackend {
	speed(): number | null
	pacedAddresses(): ReadonlySet<number> | null
	depth(): number
	/** Translate native execution results; no allocated event per instruction. */
	step?(): number
	ready?(): boolean
	breakpointEnabled?(): boolean
	/** Consume a guest-requested sleep, rather than workbench pacing. */
	takeSleep?(): number
}

export interface ExecutionClock {
	now(): number
	yield(): Promise<void>
	sleep(ms: number): Promise<void>
}

const HOST_CLOCK: ExecutionClock = {
	now: () => performance.now(),
	yield: yieldToHost,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
const RAW_BATCH = 20_000
const HOST_SLICE_MS = 16
const FRAME_SLICE_MS = 50
const MAX_CATCH_UP_SECONDS = 0.25
const PROGRAM_HALT: MachineStopReason = Object.freeze({ kind: 'halt' })
const DEBUGGER_STOP: MachineStopReason = Object.freeze({ kind: 'stop' })
type FaultReason = Extract<MachineStopReason, { kind: 'fault' }>

export class ExecutionController {
	running = false
	private debuggerStopped = false
	private disposed = false
	private generation = 0
	private fault: FaultReason | null = null
	private faultRows: Map<number, FaultReason> | null = null
	private historySource?: { history(): MachineHistory, cursor(): number }

	get stopped() { return this.debuggerStopped }
	set stopped(value: boolean) {
		this.debuggerStopped = value
		if (!value) this.fault = null
	}

	constructor(
		private readonly host: ExecutionHost,
		private readonly backend: ExecutionBackend,
		private readonly clock: ExecutionClock = HOST_CLOCK,
	) {}

	/** Debugger edits require a live session and an integer before native coercion. */
	canEdit(value: unknown): value is RegisterValue {
		return !this.disposed && (typeof value === 'bigint' || (typeof value === 'number' && Number.isInteger(value)))
	}

	/** Called only when execution faults, never on the normal instruction path. */
	recordFault(error: unknown, address = this.host.pc) {
		this.fault = { kind: 'fault', message: error instanceof Error ? error.message : String(error), address }
		this.stopped = true
		this.running = false
		if (this.historySource) {
			const history = this.historySource.history()
			const row = history.at(history.length - 1)
			if (row) {
				this.faultRows ??= new Map()
				for (const id of this.faultRows.keys()) if (history.indexOfId(id) < 0) this.faultRows.delete(id)
				this.faultRows.set(row.id, this.fault)
			}
		}
	}

	/** Rare terminal replay metadata; lookup is unnecessary for ordinary instructions. */
	faultForEntry(id: number): FaultReason | undefined { return this.faultRows?.get(id) }

	/** Command-time decoding (for Step Over) can fault before a CPU step begins. */
	inspectInstruction<T>(inspect: () => T): T {
		try { return inspect() }
		catch (error) { this.recordFault(error); throw error }
	}

	/** A UI query; native messages remain native and normal history columns stay unchanged. */
	reason(halted: boolean, nativeFault?: string | null, address = this.host.pc): MachineStopReason | null {
		if (nativeFault) return { kind: 'fault', message: nativeFault, address }
		if (this.fault) return this.fault
		if (this.stopped) return DEBUGGER_STOP
		if (!halted) return null
		if (this.faultRows && this.historySource) {
			const row = this.historySource.history().at(this.historySource.cursor() - 1)
			const fault = row && this.faultRows.get(row.id)
			if (fault) return fault
		}
		return PROGRAM_HALT
	}

	batchSize(): number {
		const speed = this.backend.speed()
		return speed === null ? RAW_BATCH : Math.max(1, Math.round(speed / 30))
	}

	batchDelayMs(batch: number): number {
		const speed = this.backend.speed()
		return speed === null ? 0 : batch * 1000 / Math.max(1, speed)
	}

	pause() {
		this.running = false
		this.host.paused = true
	}

	/** Stop ends the run; rewind or a new program can make it runnable again. */
	stop() {
		this.running = false
		this.host.paused = false
		this.stopped = true
	}

	dispose(cleanup?: () => void) {
		if (this.disposed) return
		this.disposed = true
		this.running = false
		this.generation++
		this.host.onProgress = null
		this.faultRows = null
		cleanup?.()
	}

	/** Command-level history policy; the backend exchanges its native state. */
	private sought(after: () => void) {
		this.stopped = false
		this.pause()
		after()
	}

	stepBack(undo: () => boolean, after: () => void): boolean {
		if (this.disposed || !undo()) return false
		this.sought(after)
		return true
	}

	/** Bind native callbacks once, so repeated Step Back creates no command closures. */
	historyCommands(backend: { history(): MachineHistory, cursor(): number, undo(): boolean, after(): void }) {
		this.historySource = backend
		return {
			stepBack: this.stepBack.bind(this, backend.undo, backend.after),
			rewindTo: (id: number) => this.rewindTo(backend.history(), backend.cursor, id, backend.undo, backend.after),
		}
	}

	rewindTo(history: MachineHistory, cursor: () => number, id: number, undo: () => boolean, after: () => void): boolean {
		return !this.disposed && rewindHistoryTo(history, cursor, id, undo, () => this.sought(after))
	}

	runTo(address: number): Promise<void> {
		return this.runUntil(() => this.host.pc === address)
	}

	stepOver(returnAddress: number | null): Promise<void> {
		if (this.running || this.disposed || this.stopped || this.host.halted) return Promise.resolve()
		if (returnAddress === null) {
			this.host.step()
			return Promise.resolve()
		}
		const depth = this.backend.depth()
		return this.runUntil(() => this.host.pc === returnAddress && this.backend.depth() <= depth, undefined, this.host.pc)
	}

	stepToReturn(): Promise<void> {
		const depth = this.backend.depth()
		return this.runUntil(() => depth > 0 && this.backend.depth() < depth)
	}

	private ready(): boolean {
		return !this.disposed && !this.stopped && !this.host.halted && (this.backend.ready?.() ?? true)
	}

	/** Sliced waits also cancel promptly and respond to speed changes. */
	async waitFrame(ms: number, generation = this.generation, guest = false) {
		if (ms <= 0) return this.clock.yield()
		const deadline = this.clock.now() + ms
		const speed = this.backend.speed()
		while (this.running && generation === this.generation && this.ready() && (guest || this.backend.speed() === speed)) {
			const remaining = deadline - this.clock.now()
			if (remaining <= 0) return
			await this.clock.sleep(Math.min(remaining, FRAME_SLICE_MS))
		}
	}

	async runUntil(done: () => boolean, fixedBatchSize?: number, ignoredBreakpoint?: number): Promise<void> {
		if (this.running || !this.ready()) return
		const generation = ++this.generation
		this.running = true
		this.host.paused = false
		let first = true
		let lastTick = this.clock.now()
		let owed = 0
		// Cache the ISA boundary once per run; retain its zero-observer fast path.
		const step = this.backend.step ?? (() => { this.host.step(); return ExecutionStep.ADVANCED })
		try {
			while (this.running && generation === this.generation && this.ready()) {
				const started = this.clock.now()
				const speed = this.backend.speed()
				const batch = fixedBatchSize ?? this.batchSize()
				let allowance = batch
				if (speed === null) owed = 0
				else {
					owed = Math.min(owed + (started - lastTick) * speed / 1000, speed * MAX_CATCH_UP_SECONDS)
					allowance = Math.max(1, Math.floor(owed))
				}
				lastTick = started
				let visible = 0
				let raw = 0
				while (this.running && generation === this.generation && this.ready() && visible < allowance && raw < RAW_BATCH) {
					// Check host time in blocks to avoid a clock read on every fast CPU step.
					if (raw > 0 && (raw & 63) === 0 && this.clock.now() - started >= HOST_SLICE_MS) break
					if (!first && this.host.pc !== ignoredBreakpoint && this.host.breakpoints.has(this.host.pc) && (this.backend.breakpointEnabled?.() ?? true)) {
						this.pause()
						break
					}
					first = false
					const status = step()
					raw++
					if (status === ExecutionStep.WAIT || done()) {
						this.pause()
						break
					}
					const paced = this.backend.pacedAddresses()
					if (status !== ExecutionStep.HIDDEN && (speed === null || !paced || paced.has(this.host.pc))) visible++
				}
				owed -= visible
				if (this.disposed || generation !== this.generation) break
				this.host.onProgress?.()
				if (this.disposed || generation !== this.generation) break
				const sleep = this.backend.takeSleep?.() ?? 0
				if (this.running && this.ready()) {
					// Every batch yields, including a run consisting entirely of hidden code.
					await this.clock.yield()
					if (sleep > 0) {
						await this.waitFrame(sleep, generation, true)
						lastTick = this.clock.now()
					} else if (speed !== null && this.backend.speed() === speed) {
						await this.waitFrame(Math.max(0, batch * 1000 / Math.max(1, speed) - (this.clock.now() - started)), generation)
					}
				}
			}
		} catch (error) {
			this.recordFault(error)
			throw error
		} finally {
			// A cancelled run must not clear the state of a newer run after its await.
			if (generation === this.generation) this.running = false
		}
	}
}
