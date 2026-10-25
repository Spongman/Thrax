import type { MemoryInspector } from '../architectures/contracts'

export interface RamInspection {
	wordBytes: 1 | 2 | 4
	littleEndian: boolean
	base?: number
}

/** Side-effect-free debugger reads of a contiguous byte buffer, including live edits. */
export class RamInspector implements MemoryInspector {
	readonly wordBytes: 1 | 2 | 4
	readonly littleEndian: boolean
	private readonly base: number

	constructor(private readonly bytes: Uint8Array, config: RamInspection) {
		this.wordBytes = config.wordBytes
		this.littleEndian = config.littleEndian
		this.base = config.base ?? 0
	}

	private offset(address: number): number {
		if (!Number.isSafeInteger(address) || address < 0) return -1
		const offset = address - this.base
		return offset >= 0 && offset < this.bytes.length ? offset : -1
	}

	byte(address: number): number | undefined {
		const offset = this.offset(address)
		return offset < 0 ? undefined : this.bytes[offset]
	}

	word(address: number): number | undefined {
		const offset = this.offset(address)
		if (offset < 0) return undefined
		const at = offset - offset % this.wordBytes
		if (at + this.wordBytes > this.bytes.length) return undefined
		const bytes = this.bytes
		if (this.wordBytes === 1) return bytes[at]
		// Compose directly: observer notifications also use inspectors, so avoid
		// allocating a DataView for every inspected store instruction.
		if (this.wordBytes === 2) return this.littleEndian ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]
		return this.littleEndian
			? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
			: ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
	}
}
