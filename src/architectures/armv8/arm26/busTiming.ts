/** VL86C020 timing flowchart, in configurable reference-clock ticks (DDI/VTI pp. 3-63–66). */
export interface Arm26BusTiming {
	/** A: one sequential memory transfer. */
	sequential: number
	/** L: memory latency/internal cycle with the cache disabled. N = L + A. */
	latency: number
}

export const DEFAULT_BUS_TIMING: Readonly<Arm26BusTiming> = Object.freeze({ sequential: 1, latency: 1 })
export const READ_EXTERNAL = 0
export const READ_HIT = 1
export const READ_FILL = 2

const NOW = 0, MEMORY = 1, LINE = 2, FIRST = 3, NEXT = 4, ACTIVE = 5, MODE = 6

/** Small reversible state: no trace arrays or per-operation objects on the execution path. */
export class Arm26BusClock {
	readonly state = new Float64Array(7)

	constructor(readonly timing: Readonly<Arm26BusTiming> = DEFAULT_BUS_TIMING) {
		if (!Number.isSafeInteger(timing.sequential) || timing.sequential < 1 ||
			!Number.isSafeInteger(timing.latency) || timing.latency < 1) throw new RangeError('Memory timing must use positive integer clock ticks')
		this.reset()
	}

	get ticks() { return this.state[NOW] }
	set ticks(value: number) { this.state[NOW] = value }

	reset() {
		this.state.fill(0)
		this.state[MEMORY] = 1
	}

	/** The requested word can arrive before the rest of a cache line. */
	read(address: number, sequential: boolean, kind: number, cacheOn: boolean, monitor = false) {
		this.configure(cacheOn, monitor)
		const s = this.state
		const a = this.timing.sequential, l = this.timing.latency
		if (s[ACTIVE] && sequential && kind === READ_HIT && (address & ~15) === s[LINE] && ((address >>> 2) & 3) === s[NEXT]) {
			this.beat()
			return
		}
		this.finishLine()
		if (!cacheOn || monitor) {
			s[MEMORY] = 1
			if (kind === READ_HIT && monitor) s[NOW] += l
			else if (kind === READ_FILL) this.line(address)
			else s[NOW] += sequential ? a : l + a
			return
		}
		if (kind === READ_HIT) {
			this.fast()
			s[NOW]++
		} else {
			this.memory()
			if (kind === READ_FILL) this.line(address)
			else s[NOW] += sequential ? a : l + a
		}
	}

	write(sequential: boolean, cacheOn: boolean, monitor = false) {
		this.configure(cacheOn, monitor)
		this.finishLine()
		if (cacheOn && !monitor) this.memory()
		else this.state[MEMORY] = 1
		this.state[NOW] += this.timing.sequential + (sequential ? 0 : this.timing.latency)
	}

	internal(cacheOn: boolean, monitor = false) {
		this.configure(cacheOn, monitor)
		if (this.state[ACTIVE] && this.state[NEXT] < 4) {
			this.beat()
			return
		}
		this.finishLine()
		if (cacheOn && !monitor) {
			this.fast()
			this.state[NOW]++
		} else {
			this.state[MEMORY] = 1
			this.state[NOW] += this.timing.latency
		}
	}

	/** Coprocessor transfers cannot be absorbed by a line fill. */
	transfer(cacheOn: boolean, monitor = false) {
		this.finishLine()
		this.internal(cacheOn, monitor)
	}

	private memory() {
		if (!this.state[MEMORY]) this.state[NOW] += 1 + 2 * this.timing.latency
		this.state[MEMORY] = 1
	}

	private configure(cacheOn: boolean, monitor: boolean) {
		const mode = +cacheOn | (+monitor << 1)
		if (cacheOn && !monitor && this.state[MODE] !== 1) this.state[MEMORY] = 0
		if (!cacheOn || monitor) this.state[MEMORY] = 1
		this.state[MODE] = mode
	}

	private fast() {
		if (this.state[MEMORY]) this.state[NOW]++
		this.state[MEMORY] = 0
	}

	private line(address: number) {
		const s = this.state
		s[ACTIVE] = 1
		s[LINE] = address & ~15
		s[FIRST] = s[NOW] + this.timing.latency + this.timing.sequential
		s[NEXT] = (address >>> 2) & 3
		this.beat()
	}

	private beat() {
		const s = this.state
		s[NOW] = Math.max(s[NOW], s[FIRST] + s[NEXT] * this.timing.sequential)
		s[NEXT]++
		// Clocked on the fourth beat: resume the fast clock. Otherwise a stalled
		// CPU can chain another external access directly after the remaining fill.
		if (s[NEXT] === 4) s[MEMORY] = 0
	}

	private finishLine() {
		const s = this.state
		if (!s[ACTIVE]) return
		s[NOW] = Math.max(s[NOW], s[FIRST] + 3 * this.timing.sequential)
		s[ACTIVE] = 0
	}
}
