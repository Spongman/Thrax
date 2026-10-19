import { describe, expect, it } from 'vitest'
import { HistoryBufferLayout, HISTORY_ENTRY_BASE, type HistoryBufferSchema } from '../historyBuffers'
import { HistoryLog } from '../historyLog'

/**
 * A synthetic target, deliberately unlike MIPS or Beta: multi-element columns
 * of odd widths, payloads on effects only, and tiny blocks so every policy
 * crosses block boundaries.
 */
const schema: HistoryBufferSchema = {
	entry: [
		{ name: 'mode', type: 'u8', elements: 1 },
		{ name: 'vector', type: 'i16', elements: 3 },
		{ name: 'weight', type: 'f32', elements: 2 },
	],
	effect: [
		{ name: 'pair', type: 'f64', elements: 2 },
		{ name: 'tag', type: 'u16', elements: 1 },
		{ name: 'bytes', type: 'u8', elements: 5 },
	],
	payloads: ['effect'],
}

const CAPACITY = 4
const layout = new HistoryBufferLayout(schema)
const MODE = layout.column('entry', 'mode', 'u8')
const VECTOR = layout.column('entry', 'vector', 'i16', 3)
const WEIGHT = layout.column('entry', 'weight', 'f32', 2)
const PAIR = layout.column('effect', 'pair', 'f64', 2)
const TAG = layout.column('effect', 'tag', 'u16')
const BYTES = layout.column('effect', 'bytes', 'u8', 5)

/** Records entry `id` with `effects` effects, each derived from the id. */
function record(log: HistoryLog, id: number, effects: number): boolean {
	const slot = log.openEntryWith(id)
	const columns = log.entries.tail!.arrays
	columns[MODE][slot] = id & 0xff
	for (let k = 0; k < 3; k++) columns[VECTOR][slot * 3 + k] = -id * (k + 1)
	columns[WEIGHT][slot * 2] = id / 4
	columns[WEIGHT][slot * 2 + 1] = -id / 8
	for (let n = 0; n < effects; n++) {
		const at = log.pushEffect()
		if (at < 0) return false
		const block = log.effects.tail!
		block.arrays[PAIR][at * 2] = id
		block.arrays[PAIR][at * 2 + 1] = n + 0.5
		block.arrays[TAG][at] = n
		for (let k = 0; k < 5; k++) block.arrays[BYTES][at * 5 + k] = (id + n + k) & 0xff
		if (n % 2 === 0) log.effects.setPayload(log.effects.end - 1, { id, n })
	}
	log.close()
	return true
}

/** Reads entry `index` back and checks every column and effect against its id. */
function verify(log: HistoryLog, index: number) {
	const id = log.id(index)
	const position = log.first + index
	const block = log.entries.block(position)
	const slot = position % CAPACITY
	expect(block.arrays[MODE][slot]).toBe(id & 0xff)
	expect([0, 1, 2].map(k => block.arrays[VECTOR][slot * 3 + k])).toEqual([-id, -id * 2, -id * 3])
	expect([block.arrays[WEIGHT][slot * 2], block.arrays[WEIGHT][slot * 2 + 1]]).toEqual([id / 4, -id / 8])
	const start = log.effectStart(index)
	for (let n = 0; n < log.effectCount(index); n++) {
		const at = start + n
		const effect = log.effects.block(at)
		const s = at % CAPACITY
		expect([effect.arrays[PAIR][s * 2], effect.arrays[PAIR][s * 2 + 1], effect.arrays[TAG][s]]).toEqual([id, n + 0.5, n])
		expect([...effect.arrays[BYTES].subarray(s * 5, s * 5 + 5)]).toEqual([0, 1, 2, 3, 4].map(k => (id + n + k) & 0xff))
		expect(log.effects.payload(at)).toEqual(n % 2 === 0 ? { id, n } : undefined)
	}
}

describe('the shared history engine on a synthetic schema', () => {
	it('allocates the base bookkeeping and exactly the declared columns', () => {
		const log = new HistoryLog(layout, CAPACITY)
		record(log, 1, 1)
		const entry = log.entries.block(0).buffers
		expect(Object.keys(entry.columns)).toEqual([...HISTORY_ENTRY_BASE.map(column => column.name), 'mode', 'vector', 'weight'])
		expect(Object.keys(log.effects.block(0).buffers.columns)).toEqual(['pair', 'tag', 'bytes'])
		expect(entry.columns.vector).toBeInstanceOf(Int16Array)
		expect(entry.columns.vector.length).toBe(CAPACITY * 3)
		expect(layout.bytesPerRecord).toEqual({ entry: 16 + 1 + 6 + 8, effect: 16 + 2 + 5 })
		expect(log.allocatedBufferBytes).toBe(CAPACITY * (31 + 23))
		expect(() => layout.column('entry', 'vector', 'i16')).toThrow('codec requires')
		expect(() => log.entries.setPayload(0, 'x')).toThrow('no payload')
	})

	it('round-trips multi-element columns and runs that straddle blocks', () => {
		const log = new HistoryLog(layout, CAPACITY)
		for (let id = 1; id <= 13; id++) record(log, id, id % 7)
		expect(log.length).toBe(13)
		for (let index = 0; index < 13; index++) verify(log, index)
		expect(log.effectCount(5)).toBe(6)
		expect(log.indexOfId(9)).toBe(8)
	})

	it('evicts whole entry blocks past the limit, with the effects and payloads only they reached', () => {
		const log = new HistoryLog(layout, CAPACITY)
		log.limit = 5
		for (let id = 1; id <= 40; id++) {
			record(log, id, 3)
			expect(log.length).toBeGreaterThanOrEqual(Math.min(5, id))
			expect(log.length).toBeLessThan(5 + CAPACITY)
		}
		expect(log.first % CAPACITY).toBe(0)
		expect(log.effects.first).toBe(log.effectStart(0))
		for (let index = 0; index < log.length; index++) verify(log, index)
		// Two of every three effects carry a payload; nothing dropped keeps one.
		expect(log.payloadCount).toBe(log.length * 2)
		expect(() => log.effects.block(log.effects.first - 1)).toThrow('dropped')
	})

	it('truncates entries, effects and payloads across every buffer', () => {
		const log = new HistoryLog(layout, CAPACITY)
		for (let id = 1; id <= 9; id++) record(log, id, 5)
		log.truncate(3)
		expect(log.length).toBe(3)
		expect(log.effects.end).toBe(15)
		expect(log.payloadCount).toBe(9)
		expect(log.entries.blockCount).toBe(1)
		expect(log.effects.blockCount).toBe(4)
		record(log, 100, 2)
		verify(log, 3)
		for (let index = 0; index < 3; index++) verify(log, index)
	})

	it('drops a step that recorded nothing', () => {
		const log = new HistoryLog(layout, CAPACITY)
		record(log, 1, 2)
		log.openEntryWith(2)
		log.discard()
		expect(log.length).toBe(1)
		expect(log.effectCount(0)).toBe(2)
	})

	it('keeps live blocks within the byte limit by evicting complete entries', () => {
		const log = new HistoryLog(layout, CAPACITY)
		const minimum = 2 * CAPACITY * (31 + 23)
		expect(() => { log.byteLimit = minimum - 1 }).toThrow('at least')
		log.byteLimit = minimum * 2
		for (let id = 1; id <= 200; id++) {
			expect(record(log, id, id % 9)).toBe(true)
			expect(log.liveBufferBytes).toBeLessThanOrEqual(log.byteLimit)
		}
		expect(log.overflows).toBe(0)
		expect(log.length).toBeLessThan(200)
		expect(log.effects.first).toBe(log.effectStart(0))
		for (let index = 0; index < log.length; index++) verify(log, index)
	})

	it('empties the log and reports an entry too large for the byte limit, rather than keep part of it', () => {
		const log = new HistoryLog(layout, CAPACITY)
		log.byteLimit = 2 * CAPACITY * (31 + 23)
		record(log, 1, 1)
		expect(record(log, 2, 100)).toBe(false)
		expect(log.overflows).toBe(1)
		expect(log.length).toBe(0)
		expect(log.openEntry).toBe(-1)
		expect(log.pushEffect()).toBe(-1)
		expect(log.liveBufferBytes).toBeLessThanOrEqual(log.byteLimit)
		// Recording carries on afterwards, and ids and positions do not go back.
		expect(record(log, 3, 2)).toBe(true)
		expect(log.length).toBe(1)
		expect(log.first).toBeGreaterThan(1)
		verify(log, 0)
	})

	it('needs no columns beyond the base', () => {
		const bare = new HistoryLog(new HistoryBufferLayout({ entry: [], effect: [] }), CAPACITY)
		for (let id = 1; id <= 6; id++) {
			bare.openEntryWith(id)
			bare.pushEffect()
		}
		bare.close()
		expect(bare.length).toBe(6)
		expect([bare.effectStart(5), bare.effectCount(5)]).toEqual([5, 1])
		expect(bare.allocatedBufferBytes).toBe(2 * CAPACITY * 16)
	})
})
