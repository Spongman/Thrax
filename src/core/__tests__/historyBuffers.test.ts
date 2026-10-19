import { describe, expect, it } from 'vitest'
import { HistoryBufferLayout, HISTORY_ENTRY_BASE } from '../historyBuffers'
import type { HistoryBufferSchema } from '../historyBuffers'
import { BLOCK_SIZE } from '../../architectures/mips/core/effectStore'
import { MipsHistory } from '../../architectures/mips/core/history'
import { mipsHistorySchema } from '../../architectures/mips/history/schema'

const schema: HistoryBufferSchema = {
	entry: [{ name: 'mode', type: 'u8', elements: 1 }],
	effect: [
		{ name: 'address', type: 'u16', elements: 1 },
		{ name: 'vector', type: 'f64', elements: 3 },
	],
}

describe('explicit history buffer layouts', () => {
	it('allocates only common entry bookkeeping and explicitly declared target columns', () => {
		const layout = new HistoryBufferLayout(schema)
		const entry = layout.allocate('entry', 4)
		const effect = layout.allocate('effect', 7)
		expect(Object.keys(entry.columns)).toEqual([...HISTORY_ENTRY_BASE.map(column => column.name), 'mode'])
		expect(Object.keys(effect.columns)).toEqual(['address', 'vector'])
		expect(effect.columns.vector).toBeInstanceOf(Float64Array)
		expect(effect.columns.vector.length).toBe(21)
		expect(effect.byteLength).toBe(7 * 26)
		entry.columns.id[0] = 2 ** 40
		expect(entry.columns.id[0]).toBe(2 ** 40)
		const empty = new HistoryBufferLayout({ entry: [], effect: [] })
		expect(Object.keys(empty.allocate('effect', 1).columns)).toEqual([])
	})

	it('copies complete multi-element records when blocks rotate', () => {
		const layout = new HistoryBufferLayout(schema)
		const from = layout.allocate('effect', 4)
		const to = layout.allocate('effect', 4)
		from.columns.address.set([1, 2, 65535, 4])
		from.columns.vector.set([1, 2, 3, 4, 5, 6, 7.5, 8.5, 9.5, 10, 11, 12])
		layout.copy(from, to, 2, 2)
		expect([...to.columns.address]).toEqual([65535, 4, 0, 0])
		expect([...to.columns.vector]).toEqual([7.5, 8.5, 9.5, 10, 11, 12, 0, 0, 0, 0, 0, 0])
		expect(() => layout.copy(from, to, 3, 2)).toThrow('range')
	})

	it('freezes declarations and rejects ambiguous or invalid schemas before recording', () => {
		const columns = [{ name: 'value', type: 'u8' as const, elements: 1 }]
		const layout = new HistoryBufferLayout({ entry: [], effect: columns })
		columns[0].elements = 8
		expect(layout.allocate('effect', 2).columns.value.length).toBe(2)
		expect(() => new HistoryBufferLayout({ entry: [{ name: 'id', type: 'u8', elements: 1 }], effect: [] })).toThrow('Duplicate')
		expect(() => new HistoryBufferLayout({ entry: [], effect: [{ name: 'bad', type: 'u8', elements: 0 }] })).toThrow('cardinality')
		expect(() => layout.allocate('effect', -1)).toThrow('capacity')
	})
})

describe('schema-backed packed effects', () => {
	it('lets one entry run straddle blocks and releases payloads with what is dropped', () => {
		const history = new MipsHistory(mipsHistorySchema)
		const { effects } = history
		history.open(1, 0, 0, 0, false, 0, 'none', 0)
		for (let i = 0; i < BLOCK_SIZE - 2; i++) effects.push(1, i, i)
		history.close()
		history.open(2, 1, 4, 0, false, 4, 'none', 0)
		effects.push(2, 10, 20, 'retained')
		effects.push(2, 11, 21, 'second')
		effects.push(2, 12, 22, 'third')
		history.close()
		expect([history.effectStartAt(1), history.effectCountAt(1)]).toEqual([BLOCK_SIZE - 2, 3])
		expect(effects.slotAt(BLOCK_SIZE)).toEqual({ kind: 2, a: 12, b: 22, value: 'third' })
		expect(effects.payloadCount).toBe(3)
		expect(effects.allocatedBufferBytes).toBe(2 * BLOCK_SIZE * 9)
		// Truncating the second entry takes its effects and their payloads, across both blocks.
		history.truncate(1)
		expect(effects.payloadCount).toBe(0)
		expect(effects.position).toBe(BLOCK_SIZE - 2)
		expect(() => effects.slotAt(BLOCK_SIZE - 2)).toThrow('dropped')
		history.open(3, 1, 4, 0, false, 4, 'none', 0)
		effects.push(3, 30, 40)
		history.close()
		expect(effects.valueAt(BLOCK_SIZE - 2)).toBeUndefined()
		history.clear()
		expect(history.length).toBe(0)
		expect(effects.payloadCount).toBe(0)
	})

	it('accounts extension columns and rejects incompatible codecs', () => {
		const history = new MipsHistory({ ...mipsHistorySchema, effect: [...mipsHistorySchema.effect, { name: 'wide', type: 'f64', elements: 2 }] })
		history.open(1, 0, 0, 0, false, 0, 'none', 0)
		history.effects.push(1, 2, 3)
		history.close()
		expect(history.effects.allocatedBufferBytes).toBe(BLOCK_SIZE * 25)
		expect(() => new MipsHistory({ entry: [], effect: [] })).toThrow('codec requires')
		expect(() => new MipsHistory({ ...mipsHistorySchema, payloads: [] })).toThrow('payloads')
	})

	it('hands back control state exactly as it was held, signed or unsigned', () => {
		const history = new MipsHistory(mipsHistorySchema)
		history.open(1, 0, 0x80000180, null, true, 0x80000180, 'registered', -4)
		history.close()
		expect([history.pcAt(0), history.delayStateAt(0), history.delayedTargetAt(0)]).toEqual([0x80000180, 'registered', -4])
		history.setControl(0, -2147483264, 'triggered', 0xfffffffc)
		expect([history.pcAt(0), history.delayStateAt(0), history.delayedTargetAt(0)]).toEqual([-2147483264, 'triggered', 0xfffffffc])
		expect(history.at(0)).toMatchObject({ kind: 'edit', word: null, address: 0x80000180 })
	})

	it('refuses an effect when no entry is open rather than file it nowhere', () => {
		const history = new MipsHistory(mipsHistorySchema)
		expect(history.effects.push(1, 2, 3)).toBe(false)
		expect(history.effects.position).toBe(0)
	})
})
