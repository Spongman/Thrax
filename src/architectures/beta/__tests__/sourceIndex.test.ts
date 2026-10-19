import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { BetaSourceIndex, EMPTY_BETA_SOURCE_INDEX } from '../sourceIndex'
import { assembleUasm, betaLibrary } from '../uasm'

const CODE = `.include "beta.uasm"
.macro TWICE(X) { ADDC(X, 1, X) ADDC(X, 1, X) }

start:
	PUSH(R1)

	TWICE(R2)
	HALT()
data: LONG(7) LONG(8)
`

function index(code = CODE) {
	const { image, diagnostics } = assembleUasm({ name: 'main.uasm', code })
	expect(diagnostics).toEqual([])
	return new BetaSourceIndex(image!)
}

describe('Beta source index', () => {
	it('maps every word of a macro invocation to the invocation line', () => {
		const source = index()
		expect(source.addressesForLine('main.uasm', 5)).toEqual([0, 4])
		expect(source.addressesForLine('main.uasm', 7)).toEqual([8, 12])
		expect(source.lineForAddress(4)).toEqual({ file: 'main.uasm', line: 5 })
		// The supervisor bit is ignored.
		expect(source.lineForAddress(0x80000008)).toEqual({ file: 'main.uasm', line: 7 })
		expect(source.lineIdAt(0)).toBe(source.lineIdAt(4))
		expect(source.lineIdAt(4)).not.toBe(source.lineIdAt(8))
		expect(source.lineIdAt(0x1000)).toBe(-1)
	})

	it('exposes the expansion chain, outermost first', () => {
		const source = index()
		expect(source.expansionAt(4).map((frame) => frame.macro)).toEqual(['PUSH', 'ST', 'betaopc'])
		expect(source.expansionAt(12).map((frame) => frame.macro)).toEqual(['TWICE', 'ADDC', 'betaopc'])
		expect(source.expansionAt(12)[0].definition.line).toBe(2)
		expect(source.macroDefinition('PUSH')?.file).toBe(betaLibrary.name)
		expect(source.macroDefinition('TWICE')).toMatchObject({ file: 'main.uasm', line: 2 })
		expect(source.macroDefinition('NOPE')).toBeNull()
	})

	it('aims breakpoints at code and past blank lines', () => {
		const source = index()
		expect(source.codeLines('main.uasm')).toEqual([5, 7, 8])
		expect(source.codeAddressForLine('main.uasm', 7)).toBe(8)
		expect(source.codeAddressAtOrAfter('main.uasm', 6)).toBe(8)
		expect(source.codeAddressAtOrAfter('main.uasm', 1)).toBe(0)
		expect(source.codeAddressAtOrAfter('main.uasm', 9)).toBeUndefined()
		expect(source.codeLineAtOrAfter('other.uasm', 1)).toBeUndefined()
	})

	it('maps data without counting it as code', () => {
		const source = index()
		expect(source.isCode(16)).toBe(true)
		expect(source.isCode(20)).toBe(false)
		expect(source.lineForAddress(26)).toEqual({ file: 'main.uasm', line: 9 })
	})

	it('answers symbol queries both ways', () => {
		const source = index()
		expect(source.symbolAt(0)).toBe('start')
		expect(source.addressOf('data')).toBe(20)
		expect(source.symbolFor(26)).toEqual({ name: 'data', offset: 6 })
		expect(source.symbolFor(8)).toEqual({ name: 'start', offset: 8 })
		expect(EMPTY_BETA_SOURCE_INDEX.symbolFor(0)).toBeNull()
	})

	it('indexes every example', () => {
		for (const example of Object.values(EXAMPLES)) {
			const source = index(example.code)
			expect(source.codeLines('main.uasm').length).toBeGreaterThan(0)
			expect(source.codeAddressAtOrAfter('main.uasm', 1)).toBe(0)
		}
	})
})
