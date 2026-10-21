import { describe, expect, it, vi } from 'vitest'
import { MemoryEdits } from '../memoryEdits'

describe('shared memory edit transactions', () => {
	it('refuses holes and boundary crossings before committing an edit', () => {
		const commit = vi.fn(() => true)
		const edits = new MemoryEdits({
			region: (a) => a < 16 ? { start: 0, end: 15 } : null,
			read: () => 0,
			commit,
		})
		expect(edits.insert(15, 16, 1)).toBe(false)
		expect(edits.insert(0.5, 15, 1)).toBe(false)
		expect(edits.insert(0, 15, NaN)).toBe(false)
		expect(edits.delete(16, 20)).toBe(false)
		expect(commit).not.toHaveBeenCalled()
	})

	it('uses a sparse tail lookup instead of scanning an enormous address space', () => {
		const read = vi.fn((address: number) => address === 4 ? 42 : 0)
		const commit = vi.fn(() => true)
		const edits = new MemoryEdits({
			region: () => ({ start: 0, end: 0xFFFFFFFF }),
			lastWritten: () => 4,
			read,
			commit,
		})
		expect(edits.insert(0, 0xFFFFFFFF, 99)).toBe(true)
		expect(commit).toHaveBeenCalledWith(0, Uint8Array.of(99, 0, 0, 0, 0, 42))
		expect(read).toHaveBeenCalledTimes(5)
	})

	it('handles an all-zero region and insertion/deletion at the last byte', () => {
		const bytes = new Uint8Array(4)
		const edits = new MemoryEdits({
			region: () => ({ start: 0, end: 3 }),
			read: (a) => bytes[a],
			commit: (a, values) => { bytes.set(values, a); return true },
		})
		expect(edits.insert(3, 3, 42)).toBe(true)
		expect(bytes).toEqual(Uint8Array.of(0, 0, 0, 42))
		expect(edits.delete(3, 3)).toBe(true)
		expect(bytes).toEqual(new Uint8Array(4))
	})
})
