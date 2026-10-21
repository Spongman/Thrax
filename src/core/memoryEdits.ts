/** Byte shifting for debugger edits. CPU adapters own maps and atomic recording. */
export interface MemoryEditBackend {
	/** Inclusive bounds of one editable region; null denotes a hole or a device. */
	region(address: number): { start: number; end: number } | null
	read(address: number): number
	/** Commit all bytes as one history edit, including any cache invalidation. */
	commit(address: number, bytes: Uint8Array): boolean
	/** Sparse stores can find their tail without scanning gigabytes of zeroes. */
	lastWritten?(from: number, to: number): number
	/** Legacy flat stores accept a panel limit beyond their physical memory. */
	clampLimit?: boolean
}

export class MemoryEdits {
	constructor(private readonly backend: MemoryEditBackend) {}

	insert(address: number, limit: number, value: number): boolean {
		if (!Number.isFinite(value)) return false
		return this.shift(address, limit, value & 255)
	}

	delete(address: number, limit: number): boolean {
		return this.shift(address, limit)
	}

	private shift(address: number, limit: number, value?: number): boolean {
		if (!Number.isSafeInteger(address) || !Number.isSafeInteger(limit) || address < 0 || limit < address) return false
		const region = this.backend.region(address)
		if (!region || address < region.start) return false
		if (limit > region.end) {
			if (!this.backend.clampLimit) return false
			limit = region.end
		}
		let last = limit
		if (this.backend.lastWritten) last = this.backend.lastWritten(address, limit)
		else while (last >= address && this.backend.read(last) === 0) last--
		const inserting = value !== undefined
		const top = Math.max(address, Math.min(limit, last + Number(inserting)))
		const bytes = new Uint8Array(top - address + 1)
		if (inserting) {
			bytes[0] = value
			for (let at = address; at < top; at++) bytes[at - address + 1] = this.backend.read(at)
		} else {
			for (let at = address; at < top; at++) bytes[at - address] = this.backend.read(at + 1)
		}
		return this.backend.commit(address, bytes)
	}
}
