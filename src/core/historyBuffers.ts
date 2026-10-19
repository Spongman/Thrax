/** Shared allocation only: the schema gives no meaning to architecture columns. */
export const HISTORY_BLOCK_SIZE = 2048

export const HISTORY_BUFFER_TYPES = Object.freeze({
	u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array,
	u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array,
})

export type HistoryBufferType = keyof typeof HISTORY_BUFFER_TYPES
export type HistoryBuffer = InstanceType<typeof HISTORY_BUFFER_TYPES[HistoryBufferType]>
export type HistoryScope = 'entry' | 'effect'

export interface HistoryColumn {
	readonly name: string
	readonly type: HistoryBufferType
	readonly elements: number
}

export interface HistoryBufferSchema {
	readonly entry: readonly HistoryColumn[]
	readonly effect: readonly HistoryColumn[]
	/** Scopes whose records may carry one sparse object payload each. */
	readonly payloads?: readonly HistoryScope[]
}

/** Ids and positions use exact JS integers rather than silently wrapping at 32 bits. */
export const HISTORY_ENTRY_BASE: readonly HistoryColumn[] = Object.freeze([
	Object.freeze({ name: 'id', type: 'f64' as const, elements: 1 }),
	Object.freeze({ name: 'effectStart', type: 'f64' as const, elements: 1 }),
])

/**
 * Positions of the base columns in every entry block's `arrays`. Runs are
 * contiguous, so a run ends where the next begins and needs no count column.
 */
export const ENTRY_ID = 0
export const ENTRY_EFFECT_START = 1

export interface HistoryBufferBlock {
	readonly scope: HistoryScope
	readonly capacity: number
	readonly columns: Readonly<Record<string, HistoryBuffer>>
	/** The same buffers in declaration order, indexed by `HistoryBufferLayout.column`. */
	readonly arrays: readonly HistoryBuffer[]
	readonly byteLength: number
}

/** Validated once per machine; callers bind columns once per block, outside recording. */
export class HistoryBufferLayout {
	private readonly declarations: Record<HistoryScope, readonly HistoryColumn[]>
	readonly bytesPerRecord: Readonly<Record<HistoryScope, number>>
	readonly payloads: Readonly<Record<HistoryScope, boolean>>

	constructor(schema: HistoryBufferSchema) {
		const validate = (columns: readonly HistoryColumn[]) => {
			const names = new Set<string>()
			return Object.freeze(columns.map(column => {
				if (!column.name || names.has(column.name)) throw new Error(`Duplicate or empty history column: ${column.name}`)
				if (!Object.prototype.hasOwnProperty.call(HISTORY_BUFFER_TYPES, column.type)) throw new Error(`Unknown history buffer type: ${column.type}`)
				if (!Number.isSafeInteger(column.elements) || column.elements <= 0) throw new Error(`Invalid history cardinality: ${column.name}`)
				names.add(column.name)
				return Object.freeze({ ...column })
			}))
		}
		this.declarations = {
			entry: validate([...HISTORY_ENTRY_BASE, ...schema.entry]),
			effect: validate(schema.effect),
		}
		const bytes = (scope: HistoryScope) => this.declarations[scope].reduce((sum, column) => sum + HISTORY_BUFFER_TYPES[column.type].BYTES_PER_ELEMENT * column.elements, 0)
		this.bytesPerRecord = Object.freeze({ entry: bytes('entry'), effect: bytes('effect') })
		const payloads = schema.payloads ?? []
		if (payloads.some(scope => scope !== 'entry' && scope !== 'effect')) throw new Error('Unknown history payload scope')
		this.payloads = Object.freeze({ entry: payloads.includes('entry'), effect: payloads.includes('effect') })
	}

	/** Binds a codec's column once, checking it was declared as the codec expects. */
	column(scope: HistoryScope, name: string, type: HistoryBufferType, elements = 1): number {
		const index = this.declarations[scope].findIndex(column => column.name === name)
		const column = this.declarations[scope][index]
		if (!column || column.type !== type || column.elements !== elements) throw new Error(`History codec requires ${scope} ${name}:${type}[${elements}]`)
		return index
	}

	allocate(scope: HistoryScope, capacity: number): HistoryBufferBlock {
		if (!Number.isSafeInteger(capacity) || capacity <= 0 || !Number.isSafeInteger(capacity * this.bytesPerRecord[scope])) {
			throw new Error('Invalid history block capacity')
		}
		const columns: Record<string, HistoryBuffer> = Object.create(null)
		// Not frozen: V8 indexes a frozen array of typed arrays several times slower.
		const arrays = this.declarations[scope].map(column => columns[column.name] = new HISTORY_BUFFER_TYPES[column.type](capacity * column.elements))
		return Object.freeze({ scope, capacity, columns: Object.freeze(columns), arrays, byteLength: capacity * this.bytesPerRecord[scope] })
	}

	/** Bulk movement preserves every extension column, including multi-element records. */
	copy(from: HistoryBufferBlock, to: HistoryBufferBlock, start: number, count: number, destination = 0) {
		if (from.scope !== to.scope || ![start, count, destination].every(value => Number.isSafeInteger(value) && value >= 0)
			|| start + count > from.capacity || destination + count > to.capacity) throw new Error('Invalid history buffer copy range')
		for (const column of this.declarations[from.scope]) {
			const width = column.elements
			to.columns[column.name].set(from.columns[column.name].subarray(start * width, (start + count) * width), destination * width)
		}
	}
}
