import { describe, expect, it } from 'vitest'
import { BranchHistoryTable } from '../branchHistory'
import { MemoryReferenceVisualizer, DEFAULT_MEMORY_REFERENCE_SETTINGS } from '../memoryReference'

describe('architecture supplied tool address units', () => {
	it.each([1, 2, 4])('indexes branches at %s-byte instruction alignment without losing high addresses', unit => {
		const table = new BranchHistoryTable({ entryCount: 8, historyBits: 2, initiallyTaken: false })
		table.onConfigure({ delayedBranching: false, addressing: { instructionBytes: unit, memoryWordBytes: 1 } })
		table.onBranch(0x1_0000_0000 + unit, true)
		table.onBranch(0x1_0000_0000 + 2 * unit, false)
		const snapshot = table.snapshot()
		expect(snapshot.addressUnitBytes).toBe(unit)
		expect(snapshot.entries[1].addresses).toEqual([0x1_0000_0000 + unit])
		expect(snapshot.entries[2].addresses).toEqual([0x1_0000_0000 + 2 * unit])
	})
	it.each([1, 2, 4])('groups memory using %s-byte words', unit => {
		const tool = new MemoryReferenceVisualizer({ ...DEFAULT_MEMORY_REFERENCE_SETTINGS, baseAddress: 0x1_0000_0000, rows: 1, columns: 3, wordsPerUnit: 2 })
		tool.onConfigure({ delayedBranching: false, addressing: { instructionBytes: 1, memoryWordBytes: unit } })
		tool.onMemoryRead(0x1_0000_0000 + 2 * unit - 1, 1)
		tool.onMemoryRead(0x1_0000_0000 + 2 * unit, 1)
		expect(tool.snapshot()).toMatchObject({ wordBytes: unit, counts: [1, 1, 0] })
	})
	it('uses bytes when no machine has configured the tools', () => {
		expect(new BranchHistoryTable().snapshot().addressUnitBytes).toBe(1)
		expect(new MemoryReferenceVisualizer().snapshot().wordBytes).toBe(1)
	})
	it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid units %s', unit => {
		expect(() => new BranchHistoryTable(undefined, unit)).toThrow(RangeError)
		expect(() => new MemoryReferenceVisualizer(undefined, unit)).toThrow(RangeError)
	})
})
