import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RegisterDescriptor } from '../../architectures/contracts'
import { formatRegister } from '../../core/format'
import { parseEditedWide } from '../editValue'
import { HexWord } from '../HexNumber'
import { movedEntries } from '../highlight'
import RegisterView from '../RegisterView'

/** 64-bit registers hold bigints, which every panel shows exactly. */

const WIDE: readonly RegisterDescriptor[] = [
	{ id: 'X0', name: 'X0', bank: 'integer', bits: 64, editable: true },
	{ id: 'X1', name: 'X1', bank: 'integer', bits: 64, editable: true },
]

const ALL_ONES = 0xFFFF_FFFF_FFFF_FFFFn
/** Past 2^53, where a number would lose the low bit. */
const ODD = 0x1234_5678_9ABC_DEF1n

describe('64-bit register values', () => {
	it('format as sixteen hex digits, exactly', () => {
		expect(formatRegister(ALL_ONES, 64)).toBe('0xFFFFFFFFFFFFFFFF')
		expect(formatRegister(ODD, 64)).toBe('0x123456789ABCDEF1')
		expect(formatRegister(-1n, 64)).toBe('0xFFFFFFFFFFFFFFFF')
		expect(formatRegister(0x400000n, 64)).toBe('0x0000000000400000')
		// A number is still a word.
		expect(formatRegister(-1, 32)).toBe('0xFFFFFFFF')
	})

	it('parse an edit at the register width', () => {
		expect(parseEditedWide('0xFFFFFFFFFFFFFFFF', '0n', 64)).toBe(ALL_ONES)
		expect(parseEditedWide('123456789abcdef1', '0x', 64)).toBe(ODD)
		expect(parseEditedWide('18446744073709551615', '0n', 64)).toBe(ALL_ONES)
		expect(parseEditedWide('-1', '0n', 64)).toBe(ALL_ONES)
		expect(parseEditedWide('-2', '0n', 64)).toBe(ALL_ONES - 1n)
		expect(parseEditedWide('ff', '0n', 64)).toBeNull()
		expect(parseEditedWide('', '0x', 64)).toBeNull()
	})

	it('show in the register panel without losing bits', () => {
		const markup = renderToStaticMarkup(<RegisterView registers={{ X0: ALL_ONES, X1: ODD }} descriptors={WIDE} />)
		expect(markup).toContain('FFFFFFFFFFFFFFFF')
		expect(markup).toContain('123456789ABCDEF1')
	})

	it('light a 64-bit register holding the hovered address', () => {
		const render = (hovered: number) => renderToStaticMarkup(
			<RegisterView registers={{ X0: 0x400010n, X1: ALL_ONES }} descriptors={WIDE} isAddress={(value) => value >= 0x400000 && value < 0x500000}
				hoveredAddress={hovered} onHoverAddress={() => {}} />,
		)
		expect(render(0x400010)).toContain('address-hovered')
		expect(render(0x400014)).not.toContain('address-hovered')
	})

	it('render as a history chip value', () => {
		expect(renderToStaticMarkup(<HexWord value={ODD} mode="off" />)).toBe('0x123456789ABCDEF1')
	})

	it('count as moved when only a bit past 2^53 changes', () => {
		const before = new Map([['X0', ODD]])
		expect(movedEntries(before, new Map([['X0', ODD - 1n]]))).toEqual(new Set(['X0']))
		expect(movedEntries(before, new Map([['X0', ODD]]))).toEqual(new Set())
	})
})
