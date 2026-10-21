import { describe, expect, it } from 'vitest'
import type { ProgramImage } from '../../architectures/contracts'
import { ImageProgram, imageBytes } from '../imageProgram'

const image: ProgramImage = {
	entryAddress: 0x1000,
	symbols: [{ name: 'main', address: 0x1000 }, { name: '.Ltemp', address: 0x1002 }],
	sections: [{ address: 0x1000, bytes: Uint8Array.of(1, 0, 0x13, 0, 0, 0) }, { address: 0x2000, bytes: Uint8Array.from({ length: 20 }, (_, i) => i) }],
	sourceMappings: [
		{ address: 0x2000, byteLength: 20, kind: 'data', source: { file: 'main.s', line: 1 } },
		{ address: 0x1000, byteLength: 6, kind: 'instruction', source: { file: 'lib.s', line: 3 } },
	],
}

describe('shared image program adapter', () => {
	it('indexes mixed instruction widths and included files independently of data mappings', () => {
		const program = new ImageProgram('main.s', image, [], { instructionBytes: (address) => address === 0x1000 ? 2 : 4 })
		expect(program.sourceIndex.rowsForLine('lib.s', 3)).toEqual([
			{ address: 0x1000, length: 2, instruction: 0 }, { address: 0x1002, length: 4, instruction: 1 },
		])
		expect(program.sourceIndex.lineForAddress(0x1002)).toEqual({ file: 'lib.s', line: 3 })
	})

	it('limits visible data rows without discarding declared bytes', () => {
		const program = new ImageProgram('main.s', image, [], { instructionBytes: 'mapping' })
		const rows = program.sourceIndex.rowsForLine('main.s', 1)
		expect(rows).toHaveLength(4)
		expect(rows[3]).toMatchObject({ address: 0x200C, offset: 12, length: 4, truncated: true })
		expect(program.data[0].bytes).toEqual(Uint8Array.from({ length: 20 }, (_, i) => i))
	})

	it('reads sparse sections with zero gaps and preserves later overlap precedence', () => {
		const sparse = { ...image, sections: [{ address: 2, bytes: Uint8Array.of(1, 2, 3) }, { address: 4, bytes: Uint8Array.of(9, 8) }] }
		expect(imageBytes(sparse, 0, 7)).toEqual(Uint8Array.of(0, 0, 1, 2, 9, 8, 0))
	})

	it('accepts symbol visibility policy while retaining the original addressed image', () => {
		const program = new ImageProgram('main.s', image, [], { instructionBytes: 'mapping', includeSymbol: (name) => !name.startsWith('.L') })
		expect([...program.labels]).toEqual([['main', 0x1000]])
		expect(program.image()).toBe(image)
		expect(program.end()).toBe(0x2014)
	})

	it('rejects invalid instruction spans rather than looping or indexing beyond their mapping', () => {
		for (const size of [0, -1, 4, NaN]) expect(() => new ImageProgram('main.s', image, [], { instructionBytes: size })).toThrow('Invalid instruction span')
		const failed = new ImageProgram('main.s', null, [], { instructionBytes: 4 })
		expect([...failed.sourceIndex.files()]).toEqual([])
		expect(() => failed.image()).toThrow('did not assemble')
	})
})
