import { describe, expect, it } from 'vitest'
import { build, withExit } from '../../architectures/mips/core/__tests__/helpers'
import {
	colorForCount,
	DEFAULT_MEMORY_REFERENCE_SETTINGS,
	isMemoryReferenceSettings,
	MemoryReferenceVisualizer,
	type MemoryReferenceSettings,
} from '../memoryReference'

/** A small, easy-to-index grid: base 0x10010000, 1 word/unit, 2x2. */
const SMALL: MemoryReferenceSettings = {
	...DEFAULT_MEMORY_REFERENCE_SETTINGS,
	baseAddress: 0x10010000,
	wordsPerUnit: 1,
	rows: 2,
	columns: 2,
}

describe('memory reference visualizer', () => {
	it('counts an access into the unit for its address, given the base', () => {
		const tool = new MemoryReferenceVisualizer(SMALL)
		tool.onMemoryRead(0x10010000, 4) // row 0, col 0
		tool.onMemoryWrite(0x10010004, 4) // row 0, col 1
		tool.onMemoryRead(0x10010004, 4) // row 0, col 1 again

		const snapshot = tool.snapshot()
		expect(snapshot.counts).toEqual([1, 2, 0, 0])
		expect(snapshot.max).toBe(2)
	})

	it('groups several words into one unit when wordsPerUnit > 1', () => {
		const tool = new MemoryReferenceVisualizer({ ...SMALL, wordsPerUnit: 4 })
		// Four consecutive words all land in unit 0 (row 0, col 0).
		tool.onMemoryRead(0x10010000, 4)
		tool.onMemoryRead(0x10010004, 4)
		tool.onMemoryRead(0x10010008, 4)
		tool.onMemoryRead(0x1001000c, 4)
		// The next word starts unit 1 (row 0, col 1).
		tool.onMemoryRead(0x10010010, 4)

		const snapshot = tool.snapshot()
		expect(snapshot.counts).toEqual([4, 1, 0, 0])
	})

	it('ignores an address below the base address', () => {
		const tool = new MemoryReferenceVisualizer(SMALL)
		tool.onMemoryRead(0x10010000 - 4, 4)

		expect(tool.snapshot().counts).toEqual([0, 0, 0, 0])
		expect(tool.snapshot().max).toBe(0)
	})

	it('ignores an address past the end of the grid', () => {
		const tool = new MemoryReferenceVisualizer(SMALL)
		// 2x2 grid of 1-word units covers 4 words; the 5th word is out of range.
		tool.onMemoryWrite(0x10010000 + 4 * 4, 4)

		expect(tool.snapshot().counts).toEqual([0, 0, 0, 0])
	})

	it('does not distinguish reads from writes, matching processMIPSUpdate', () => {
		// MemoryReferenceVisualization.java:202-205 increments on any AccessNotice,
		// with no branch on its access type.
		const reads = new MemoryReferenceVisualizer(SMALL)
		reads.onMemoryRead(0x10010000, 4)
		reads.onMemoryRead(0x10010000, 4)

		const writes = new MemoryReferenceVisualizer(SMALL)
		writes.onMemoryWrite(0x10010000, 4)
		writes.onMemoryWrite(0x10010000, 4)

		expect(reads.snapshot().counts).toEqual(writes.snapshot().counts)
	})

	it('resets its grid on onReset, and on a fresh configure', () => {
		const tool = new MemoryReferenceVisualizer(SMALL)
		tool.onMemoryRead(0x10010000, 4)
		tool.onReset()
		expect(tool.snapshot().counts).toEqual([0, 0, 0, 0])
		expect(tool.snapshot().max).toBe(0)

		tool.onMemoryRead(0x10010000, 4)
		tool.configure({ ...SMALL, rows: 3, columns: 3 })
		expect(tool.snapshot().counts).toEqual(new Array(9).fill(0))
	})

	it('counts the data accesses of a running program', async () => {
		const simulator = build(withExit('li $t0, 1\nsw $t0, 0($sp)\nlw $t1, 0($sp)\nlw $t2, 0($sp)'))
		// $sp starts at 0x7fffeffc (simulator.ts), so the grid is based there.
		const tool = new MemoryReferenceVisualizer({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, baseAddress: 0x7fffeffc, rows: 1, columns: 1 })
		simulator.observers.push(tool)
		await simulator.run()

		const total = tool.snapshot().counts.reduce((sum, count) => sum + count, 0)
		expect(total).toBe(3)
	})

	it('validates settings field by field', () => {
		expect(isMemoryReferenceSettings(DEFAULT_MEMORY_REFERENCE_SETTINGS)).toBe(true)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, rows: 0 })).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, columns: -1 })).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, wordsPerUnit: 0 })).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, baseAddress: -1 })).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, baseAddress: 0x100000000 })).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, unitPixelWidth: 0 })).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, colorRamp: [] })).toBe(false)
		// First stop must start the scale at zero.
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, colorRamp: [{ count: 1, color: '#000000' }] })).toBe(false)
		// Stops must strictly ascend.
		expect(isMemoryReferenceSettings({
			...DEFAULT_MEMORY_REFERENCE_SETTINGS,
			colorRamp: [{ count: 0, color: '#000000' }, { count: 0, color: '#ffffff' }],
		})).toBe(false)
		expect(isMemoryReferenceSettings({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, colorRamp: [{ count: 0, color: 'red' }] })).toBe(false)
		expect(isMemoryReferenceSettings(null)).toBe(false)
		expect(isMemoryReferenceSettings('nope')).toBe(false)
	})

	it('picks the highest ramp stop at or below a count', () => {
		const ramp = DEFAULT_MEMORY_REFERENCE_SETTINGS.colorRamp
		expect(colorForCount(0, ramp)).toBe('#000000')
		expect(colorForCount(1, ramp)).toBe('#0000ff')
		expect(colorForCount(4, ramp)).toBe('#ffff00') // between the count-3 and count-5 stops
		expect(colorForCount(9999, ramp)).toBe('#ff0000')
	})
})
