/** Workbench scheduling and debugger completion policy, independent of the ISA. */
import { yieldToHost } from './yieldToHost'

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

export class ExecutionController {
	running = false
	stopped = false
	private disposed = false
	private generation = 0

	constructor(
		private readonly host: ExecutionHost,
		private readonly backend: ExecutionBackend,
		private readonly clock: ExecutionClock = HOST_CLOCK,
	) {}

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

	dispose() {
		this.disposed = true
		this.running = false
		this.generation++
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
		} finally {
			// A cancelled run must not clear the state of a newer run after its await.
			if (generation === this.generation) this.running = false
		}
	}
}
