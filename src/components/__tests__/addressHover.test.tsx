import { m68kProfile, REGISTERS as M68K_REGISTERS } from '../../architectures/m68k/profile'
import { historyFormatter } from '../../architectures/mips/history/format'
import { WordMemory } from '../../architectures/mips/machine'
import { mipsProfile } from '../../architectures/mips/profile'
import { MIPS_REGISTER_BANKS, MIPS_REGISTERS } from '../../architectures/mips/registers'
import { describe, expect, it } from 'vitest'
import { Kind } from '../../architectures/mips/core/effectKind'
import { renderToStaticMarkup } from 'react-dom/server'
import { historyWith } from '../../architectures/mips/core/__tests__/historyFixture'
import HistoryView from '../HistoryView'
import MemoryView from '../MemoryView'
import RegisterView from '../RegisterView'
import SymbolTableView from '../SymbolTableView'

/**
 * One address under the pointer, lit in every window that shows it.  Each of
 * these renders the same address in a different window and asserts it wears the
 * one shared class, since four windows drifting into four highlights is the
 * thing worth catching.
 */

const ADDRESS = 0x00400004

const memory = () => new WordMemory(new Map([
	[0x00400000 >>> 2, 0x21080001],
	// A word whose value is the hovered address, not just the word at it.
	[ADDRESS >>> 2, ADDRESS],
]))

const layout = mipsProfile('default')

// Most of a register file is zero, which is why an address hover has to mean an
// address: thirty registers share that value.
const registers = () => ({ $zero: 0, $t0: ADDRESS, $t1: 0, $t2: 0 })


/** Two names, one of them at the address every window here is pointing at. */
const symbols = () => ({
	globals: new Map([['buffer', ADDRESS], ['elsewhere', 0x10010000]]),
	locals: new Map(),
})

describe('the address under the pointer', () => {
	it('lights the word at it, and any word holding it, in memory', () => {
		const markup = renderToStaticMarkup(
			<MemoryView memory={memory()} sections={layout.memorySections} pc={null} returnAddresses={new Set()} focusAddress={null}
				hoveredAddress={ADDRESS} onHoverAddress={() => {}} onEditByte={() => true} />
		)
		expect(markup).toContain('address-hovered')
	})

	it('lights only registers whose value is an address, not every zero', () => {
		// Zero is in most of the file and is not a mapped address, so pointing at
		// it must light nothing: the whole file lighting up says nothing at all.
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} descriptors={MIPS_REGISTERS} banks={MIPS_REGISTER_BANKS} isAddress={layout.isMappedAddress}
				hoveredAddress={0} onHoverAddress={() => {}} />
		)
		expect(markup).not.toContain('address-hovered')
	})

	it('lights a register holding it', () => {
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} descriptors={MIPS_REGISTERS} banks={MIPS_REGISTER_BANKS} isAddress={layout.isMappedAddress}
				hoveredAddress={ADDRESS} onHoverAddress={() => {}} />
		)
		expect(markup).toContain('address-hovered')
	})

	it('leaves a register holding something else alone', () => {
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} descriptors={MIPS_REGISTERS} banks={MIPS_REGISTER_BANKS} isAddress={layout.isMappedAddress}
				hoveredAddress={0x7fffeffc} onHoverAddress={() => {}} />
		)
		expect(markup).not.toContain('address-hovered')
	})

	it('lights the symbol that names it', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols()} hoveredAddress={ADDRESS} />)
		expect(markup).toContain('address-hovered')
		// One row, not the whole table: the other symbol is somewhere else.
		expect(markup.match(/address-hovered/g)).toHaveLength(1)
	})

	it('prefers a named symbol over other labels at the same address', () => {
		const markup = renderToStaticMarkup(
			<SymbolTableView symbols={{ globals: new Map([['first', ADDRESS], ['alias', ADDRESS]]), locals: new Map() }}
				hoveredAddress={ADDRESS} hoveredSymbol="first" />
		)
		expect(markup.match(/address-hovered/g)).toHaveLength(1)
		const row = /<tr class="address-hovered">([\s\S]*?)<\/tr>/.exec(markup)![1]
		expect(row).toContain('first')
		expect(row).not.toContain('alias')
	})

	it('uses the address to distinguish identical local names in different files', () => {
		const markup = renderToStaticMarkup(
			<SymbolTableView symbols={{ globals: new Map(), locals: new Map([
				['first.asm', new Map([['loop', ADDRESS]])],
				['second.asm', new Map([['loop', ADDRESS + 4]])],
			]) }} hoveredAddress={ADDRESS} hoveredSymbol="loop" />
		)
		expect(markup.match(/address-hovered/g)).toHaveLength(1)
	})

	it('still finds every symbol at an address when no symbol is named', () => {
		const markup = renderToStaticMarkup(
			<SymbolTableView symbols={{ globals: new Map([['first', ADDRESS], ['alias', ADDRESS]]), locals: new Map() }}
				hoveredAddress={ADDRESS} />
		)
		expect(markup.match(/address-hovered/g)).toHaveLength(2)
	})

	it('leaves the symbols alone when it names none of them', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols()} hoveredAddress={0x7fffeffc} />)
		expect(markup).not.toContain('address-hovered')
	})

	it('lights a symbol row by name, for a hover that came from its own window', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols()} hoveredSymbol="elsewhere" />)
		expect(markup).toContain('address-hovered')
	})

	it('lights the history rows that ran it', () => {
		const entries = historyWith(ADDRESS, (effects) => {
			effects.push(Kind.MEMORY, ADDRESS >>> 2, 0, [1])
		})
		const effects = entries.effects
		const markup = renderToStaticMarkup(
			<HistoryView entries={entries} format={historyFormatter(effects)} cursor={1} version={1}
				sourceOf={() => null} selectedId={null} onSelect={() => {}} onSetNow={() => {}}
				onSelectAddress={() => {}} onSelectSource={() => {}} onSelectRegister={() => {}}
				onHoverAddress={() => {}} hoveredAddress={ADDRESS}
				onHoverRegister={() => {}} hoveredRegister={null} />
		)
		// Both the row's own address and the memory chip naming it.
		expect(markup.match(/address-hovered/g)?.length).toBe(2)
	})
})

describe('the register under the pointer', () => {
	it('lights exactly the register the history names, and no other', () => {
		// The history points at a register by name: the value on the chip is the
		// one from back then, so only the name can be matched against the file.
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} descriptors={MIPS_REGISTERS} banks={MIPS_REGISTER_BANKS} isAddress={layout.isMappedAddress}
				hoveredRegister="$t0" onHoverRegister={() => {}} />
		)
		expect(markup.match(/register-hovered/g)?.length).toBe(1)
		expect(/register-hovered[^>]*>[\s\S]{0,80}\$t0/.test(markup)).toBe(true)
	})

	it.each([0, 0x1000])('keeps a named register hover distinct from other registers holding %i', value => {
		const markup = renderToStaticMarkup(
			<RegisterView registers={{ ...m68kProfile.resetRegisters, D0: value, D1: value, A0: value }} descriptors={M68K_REGISTERS}
				isAddress={m68kProfile.isMappedAddress} hoveredAddress={value} hoveredRegister="D0" />
		)
		expect(markup.match(/register-hovered/g)).toHaveLength(1)
		expect(/register-hovered[^>]*>[\s\S]{0,80}D0/.test(markup)).toBe(true)
		expect(markup).not.toContain('address-hovered')
	})

	it('still highlights registers holding valid address zero when no register is named', () => {
		const markup = renderToStaticMarkup(
			<RegisterView registers={m68kProfile.resetRegisters} descriptors={M68K_REGISTERS}
				isAddress={m68kProfile.isMappedAddress} hoveredAddress={0} />
		)
		expect(markup.match(/address-hovered/g)!.length).toBeGreaterThan(1)
	})

	it('lights nothing when the register is on a tab this one is not showing', () => {
		// An FPU register is named the same way but lives on another tab, so the
		// integer file has nothing of its to light.
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} descriptors={MIPS_REGISTERS} banks={MIPS_REGISTER_BANKS} isAddress={layout.isMappedAddress}
				hoveredRegister="$f3" onHoverRegister={() => {}} />
		)
		expect(markup).not.toContain('register-hovered')
	})

	it('lights the history chips that name it', () => {
		const entries = historyWith(ADDRESS, (effects) => {
			effects.push(Kind.REGISTER, 8, 5)
			effects.push(Kind.REGISTER, 9, 5)
		})
		const effects = entries.effects
		const markup = renderToStaticMarkup(
			<HistoryView entries={entries} format={historyFormatter(effects)} cursor={1} version={1}
				sourceOf={() => null} selectedId={null} onSelect={() => {}} onSetNow={() => {}}
				onSelectAddress={() => {}} onSelectSource={() => {}} onSelectRegister={() => {}}
				onHoverAddress={() => {}} hoveredAddress={null}
				onHoverRegister={() => {}} hoveredRegister="$t1" />
		)
		// Only the chip for $t1, not the one beside it for $t0.
		expect(markup.match(/register-hovered/g)?.length).toBe(1)
	})
})
