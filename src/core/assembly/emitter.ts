import type { ProgramImage, SourceLocation } from '../../architectures/contracts'
import type { ExpansionFrame } from './macroEngine'

export type MappingKind = 'instruction' | 'data'

/** A program-image mapping that also records the macro expansion that produced it. */
export interface SourceMapping {
	address: number
	byteLength: number
	kind: MappingKind
	source: SourceLocation
	/** Outermost invocation first; empty for bytes written directly in source. */
	expansion: readonly ExpansionFrame[]
}

/** Shared by every byte of one instruction or one data statement. */
export interface Provenance {
	kind: MappingKind
	source: SourceLocation
	expansion: readonly ExpansionFrame[]
}

export interface AssemblyImage extends ProgramImage {
	sourceMappings: readonly SourceMapping[]
}

interface Run { address: number; bytes: number[]; layer: number }

/** Collects bytes into address-ordered runs; contiguous bytes of one provenance share a mapping. */
export class ByteEmitter {
	private readonly runs: Run[] = []
	private run: Run | null = null
	private readonly mappings: SourceMapping[] = []
	private mapping: SourceMapping | null = null
	private provenance: Provenance | null = null
	count = 0

	/**
	 * `provenance` null marks fill, such as alignment padding, with no mapping.
	 * Where bytes overlap and may replace each other, a higher `layer` wins, then
	 * the later write.
	 */
	emit(address: number, byte: number, provenance: Provenance | null, layer = 0) {
		this.count += 1
		const run = this.run
		if (run && run.layer === layer && run.address + run.bytes.length === address) {
			run.bytes.push(byte & 0xFF)
		} else {
			this.runs.push(this.run = { address, bytes: [byte & 0xFF], layer })
		}
		if (!provenance) {
			this.mapping = null
			return
		}
		const mapping = this.mapping
		if (mapping && this.provenance === provenance && mapping.address + mapping.byteLength === address) {
			mapping.byteLength += 1
			return
		}
		this.provenance = provenance
		this.mappings.push(this.mapping = { address, byteLength: 1, ...provenance })
	}

	/** Bytes written contiguously from `address` with one provenance. */
	emitBytes(address: number, bytes: ArrayLike<number>, provenance: Provenance | null, layer = 0) {
		const count = bytes.length
		if (count === 0) return
		this.count += count
		let run = this.run
		if (!run || run.layer !== layer || run.address + run.bytes.length !== address) {
			this.runs.push(run = this.run = { address, bytes: [], layer })
		}
		const target = run.bytes
		for (let index = 0; index < count; index++) target.push(bytes[index] & 0xFF)
		if (!provenance) {
			this.mapping = null
			return
		}
		const mapping = this.mapping
		if (mapping && this.provenance === provenance && mapping.address + mapping.byteLength === address) {
			mapping.byteLength += count
			return
		}
		this.provenance = provenance
		this.mappings.push(this.mapping = { address, byteLength: count, ...provenance })
	}

	/**
	 * Returns sections in address order, or the first overlapping address.  With
	 * `overwrite`, overlapping bytes resolve by layer, then by write order.
	 */
	sections(overwrite = false): { sections: ProgramImage['sections']; overlap: number | null } {
		const merged = this.merge()
		if (merged.overlap === null || !overwrite) return merged
		const bytes = new Map<number, number>()
		const layered = this.runs.map((run, index) => ({ run, index })).sort((a, b) => (a.run.layer - b.run.layer) || (a.index - b.index))
		for (const { run } of layered) run.bytes.forEach((byte, offset) => bytes.set(run.address + offset, byte))
		const addresses = [...bytes.keys()].sort((a, b) => a - b)
		const sections: { address: number; bytes: Uint8Array }[] = []
		let start = 0
		for (let index = 1; index <= addresses.length; index++) {
			if (index < addresses.length && addresses[index] === addresses[index - 1] + 1) continue
			sections.push({ address: addresses[start], bytes: Uint8Array.from(addresses.slice(start, index), (address) => bytes.get(address)!) })
			start = index
		}
		return { sections, overlap: null }
	}

	private merge(): { sections: ProgramImage['sections']; overlap: number | null } {
		const runs = [...this.runs].sort((a, b) => a.address - b.address)
		const sections: { address: number; bytes: Uint8Array }[] = []
		let pending: Run | null = null
		for (const run of runs) {
			if (pending && pending.address + pending.bytes.length > run.address) return { sections: [], overlap: run.address }
			if (pending && pending.address + pending.bytes.length === run.address) {
				for (const byte of run.bytes) pending.bytes.push(byte)
				continue
			}
			if (pending) sections.push({ address: pending.address, bytes: Uint8Array.from(pending.bytes) })
			pending = { address: run.address, bytes: [...run.bytes], layer: run.layer }
		}
		if (pending) sections.push({ address: pending.address, bytes: Uint8Array.from(pending.bytes) })
		return { sections, overlap: null }
	}

	sourceMappings(): readonly SourceMapping[] {
		return [...this.mappings].sort((a, b) => a.address - b.address)
	}
}
