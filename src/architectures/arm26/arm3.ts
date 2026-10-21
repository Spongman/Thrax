/** VL86C020 CP15 and the unified 4 KB, 64-way, write-through cache. */
import { READ_EXTERNAL, READ_FILL, READ_HIT } from './busTiming'
export type Arm26Model = 'arm2' | 'arm3'

export const ARM3_ID = 0x41560300
export const CACHE_CONTROL = 2
export const CACHEABLE = 3
export const UPDATEABLE = 4
export const DISRUPTIVE = 5
const TAGS = 6
const DATA = TAGS + 256
const RANDOM = DATA + 1024

/** All mutable state is typed and each replacement can be logged as an ordinary effect. */
export class Arm3Cache {
	lastRead = READ_EXTERNAL
	readonly state = new Int32Array(RANDOM + 1)
	beforeWrite: ((index: number, old: number) => void) | null = null

	constructor(private readonly memory: DataView) {
		this.reset()
	}

	reset() {
		this.state.fill(0)
		this.state[RANDOM] = 1
	}

	readRegister(index: number): number {
		return index === 0 ? ARM3_ID : this.state[index]
	}

	writeRegister(index: number, value: number) {
		if (index === 1) this.flush()
		else this.set(index, index === CACHE_CONTROL ? value & 7 : value)
	}

	flush() {
		for (let index = TAGS; index < DATA; index++) if (this.state[index]) this.set(index, 0)
	}

	readWord(address: number, user: boolean): number {
		this.lastRead = READ_EXTERNAL
		const aligned = address & ~3
		if (!(this.state[CACHE_CONTROL] & 1)) return this.memory.getInt32(aligned, true)
		let line = this.find(address, user)
		if (line >= 0) this.lastRead = READ_HIT
		if (line < 0) {
			if (!(this.state[CACHEABLE] & (1 << (address >>> 21)))) return this.memory.getInt32(aligned, true)
			const base = address & ~15
			if (base + 16 > this.memory.byteLength) return this.memory.getInt32(aligned, true)
			this.lastRead = READ_FILL
			// Deterministic pseudo-random replacement, rather than a per-instruction allocation.
			const random = (Math.imul(this.state[RANDOM], 1664525) + 1013904223) | 0
			this.set(RANDOM, random)
			line = ((address >>> 4) & 3) * 64 + (random >>> 26)
			this.set(TAGS + line, this.tag(address, user))
			for (let word = 0; word < 4; word++) this.set(DATA + line * 4 + word, this.memory.getInt32(base + word * 4, true))
		}
		return this.state[DATA + line * 4 + ((address >>> 2) & 3)]
	}

	/** Debugger prediction of the next fetch, without filling or changing replacement state. */
	peekWord(address: number, user: boolean): number {
		const line = this.state[CACHE_CONTROL] & 1 ? this.find(address, user) : -1
		return line < 0 ? this.memory.getInt32(address & ~3, true) : this.state[DATA + line * 4 + ((address >>> 2) & 3)]
	}

	/** Called after a CPU write; update and disruptive rules also apply with the cache off. */
	written(address: number, value: number, bytes: number, user: boolean) {
		const area = 1 << (address >>> 21)
		if (this.state[DISRUPTIVE] & area) {
			this.flush()
			return
		}
		if (!(this.state[UPDATEABLE] & area)) return
		const line = this.find(address, user)
		if (line < 0) return
		const index = DATA + line * 4 + ((address >>> 2) & 3)
		const shift = (address & 3) * 8
		this.set(index, bytes === 4 ? value : (this.state[index] & ~(255 << shift)) | ((value & 255) << shift))
	}

	private tag(address: number, user: boolean) {
		return (address & ~15) | 2 | (user && !(this.state[CACHE_CONTROL] & 2) ? 1 : 0)
	}

	private find(address: number, user: boolean): number {
		const tag = this.tag(address, user)
		const first = ((address >>> 4) & 3) * 64
		for (let line = first; line < first + 64; line++) if (this.state[TAGS + line] === tag) return line
		return -1
	}

	private set(index: number, value: number) {
		if (this.state[index] === (value | 0)) return
		this.beforeWrite?.(index, this.state[index])
		this.state[index] = value
	}
}
