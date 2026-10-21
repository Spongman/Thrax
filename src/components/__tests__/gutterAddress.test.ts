import { describe, expect, it } from 'vitest'
import { addressRuns, gutterAddressClass } from '../SourcePane'

/**
 * The source gutter spells an address the way every other panel spells one.
 *
 * Monaco injects one span per decoration, so an address that dims its leading
 * zeros has to arrive as several runs.  The order they are given in is the
 * order they are drawn in, which is what these pin: a swapped pair would put
 * the zeros after the digits.
 */

describe('the runs a gutter address is drawn as', () => {
	it('retains high address bits and aligns a mixed-width file', () => {
		expect(addressRuns(0x1_0000_0004, 'off').map(run => run.text).join('')).toBe('0x100000004')
		expect(addressRuns(4, 'off', 11).map(run => run.text).join('')).toBe('0x000000004')
	})
	it('leads with the prefix, then the zeros to dim, then the value', () => {
		expect(addressRuns(0x00400000, 'bytes')).toEqual([
			{ text: '0x', dim: false },
			{ text: '00', dim: true },
			{ text: '400000', dim: false },
		])
	})

	it('spells the whole address, whatever it is split into', () => {
		for (const address of [0x00400000, 0x10010000, 0xffffffff, 0]) {
			for (const mode of ['off', 'nibbles', 'bytes', 'halfwords', 'pow2'] as const) {
				expect(addressRuns(address, mode).map((run) => run.text).join('')).toBe(
					`0x${(address >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
				)
			}
		}
	})

	it('spends no run on nothing', () => {
		// A decoration per run, so an empty one would be a decoration drawing air.
		expect(addressRuns(0xffffffff, 'bytes')).toEqual([
			{ text: '0x', dim: false },
			{ text: 'FFFFFFFF', dim: false },
		])
		expect(addressRuns(0x00400000, 'off')).toEqual([
			{ text: '0x', dim: false },
			{ text: '00400000', dim: false },
		])
	})

	it('keeps a digit of an all-zero address readable', () => {
		expect(addressRuns(0, 'nibbles')).toEqual([
			{ text: '0x', dim: false },
			{ text: '0000000', dim: true },
			{ text: '0', dim: false },
		])
	})
})

describe('the classes a gutter address wears', () => {
	it('is the same whether or not the word has a source line', () => {
		// One is text injected into a line, the other a row of a view zone.  They
		// were built from separate strings and drifted: the zone rows never took
		// the class marking the instruction about to run.
		expect(gutterAddressClass(0x00400000, 0x00400000)).toBe(
			'code-word code-word-gutter-address code-word-address code-word-current'
		)
		expect(gutterAddressClass(0x00400004, 0x00400000)).toBe(
			'code-word code-word-gutter-address code-word-address'
		)
	})

	it('leaves a line with no word unclickable', () => {
		expect(gutterAddressClass(undefined, 0x00400000)).toBe('code-word code-word-gutter-address')
	})

	it('says nothing about the hover', () => {
		// A zone row is rebuilt whenever its classes are recomputed, and rebuilding
		// the node under the pointer is how the highlight went missing: the hover
		// is toggled on the row in place instead.
		expect(gutterAddressClass(0x00400000, null)).not.toContain('address-hovered')
	})
})
