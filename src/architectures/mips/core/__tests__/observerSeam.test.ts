import { describe, expect, it } from 'vitest'
import type { ExecutionObserver } from '../../../../core/observer'
import { build, withExit } from './helpers'

describe('the observer seam', () => {
	it('reports the value an instruction wrote, not only where it wrote', async () => {
		const writes: Array<{ address: number, size: number, value: number }> = []
		const observer: ExecutionObserver = {
			onMemoryWrite(address, size, value) {
				writes.push({ address, size, value })
			},
		}
		const simulator = build(withExit('li $t0, 0x2a\nli $t1, 0x10010000\nsw $t0, 0($t1)\nsb $t0, 8($t1)'))
		simulator.observers.push(observer)
		await simulator.run()

		expect(writes).toEqual([
			{ address: 0x10010000, size: 4, value: 0x2a },
			{ address: 0x10010008, size: 1, value: 0x2a },
		])
	})
})
