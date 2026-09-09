import { describe, expect, it } from 'vitest'
import { Kind } from '../../core/effectKind'
import { renderToStaticMarkup } from 'react-dom/server'
import { EffectStore } from '../../core/effectStore'
import { HistoryLog } from '../../core/historyLog'
import type { HistoryEntry } from '../../core/types'
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

const memory = () => ({
	words: new Map([
		[0x00400000 >>> 2, 0x21080001],
		// A word whose value is the hovered address, not just the word at it.
		[ADDRESS >>> 2, ADDRESS],
	]),
})

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
			<MemoryView memory={memory()} pc={null} returnAddresses={new Set()} focusAddress={null}
				hoveredAddress={ADDRESS} onHoverAddress={() => {}} onEditByte={() => true} />
		)
		expect(markup).toContain('address-hovered')
	})

	it('lights only registers whose value is an address, not every zero', () => {
		// Zero is in most of the file and is not a mapped address, so pointing at
		// it must light nothing: the whole file lighting up says nothing at all.
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} fpRegisters={[]} fpConditionFlags={[]} cp0Registers={[]}
				hoveredAddress={0} onHoverAddress={() => {}} />
		)
		expect(markup).not.toContain('address-hovered')
	})

	it('lights a register holding it', () => {
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} fpRegisters={[]} fpConditionFlags={[]} cp0Registers={[]}
				hoveredAddress={ADDRESS} onHoverAddress={() => {}} />
		)
		expect(markup).toContain('address-hovered')
	})

	it('leaves a register holding something else alone', () => {
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} fpRegisters={[]} fpConditionFlags={[]} cp0Registers={[]}
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

	it('leaves the symbols alone when it names none of them', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols()} hoveredAddress={0x7fffeffc} />)
		expect(markup).not.toContain('address-hovered')
	})

	it('lights a symbol row by name, for a hover that came from its own window', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols()} hoveredSymbol="elsewhere" />)
		expect(markup).toContain('address-hovered')
	})

	it('lights the history rows that ran it', () => {
		const effects = new EffectStore()
		const start = effects.beginRun()
		effects.push(Kind.MEMORY, ADDRESS >>> 2, 0, [1])
		const { count } = effects.endRun()
		const entry: HistoryEntry = {
			id: 1, instructionCount: 0, address: ADDRESS, word: 0, instruction: null,
			kind: 'instruction', pc: ADDRESS, delayState: 'none', delayedTarget: 0,
			effectStart: start, effectCount: count,
		}
		const entries = new HistoryLog()
		entries.push(entry)
		const markup = renderToStaticMarkup(
			<HistoryView entries={entries} effects={effects} cursor={1} version={1}
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
			<RegisterView registers={registers()} fpRegisters={[]} fpConditionFlags={[]} cp0Registers={[]}
				hoveredRegister="$t0" onHoverRegister={() => {}} />
		)
		expect(markup.match(/register-hovered/g)?.length).toBe(1)
		expect(/register-hovered[^>]*>[\s\S]{0,80}\$t0/.test(markup)).toBe(true)
	})

	it('lights nothing when the register is on a tab this one is not showing', () => {
		// An FPU register is named the same way but lives on another tab, so the
		// integer file has nothing of its to light.
		const markup = renderToStaticMarkup(
			<RegisterView registers={registers()} fpRegisters={[]} fpConditionFlags={[]} cp0Registers={[]}
				hoveredRegister="$f3" onHoverRegister={() => {}} />
		)
		expect(markup).not.toContain('register-hovered')
	})

	it('lights the history chips that name it', () => {
		const effects = new EffectStore()
		const start = effects.beginRun()
		effects.push(Kind.REGISTER, 8, 5)
		effects.push(Kind.REGISTER, 9, 5)
		const { count } = effects.endRun()
		const entry: HistoryEntry = {
			id: 1, instructionCount: 0, address: ADDRESS, word: 0, instruction: null,
			kind: 'instruction', pc: ADDRESS, delayState: 'none', delayedTarget: 0,
			effectStart: start, effectCount: count,
		}
		const entries = new HistoryLog()
		entries.push(entry)
		const markup = renderToStaticMarkup(
			<HistoryView entries={entries} effects={effects} cursor={1} version={1}
				sourceOf={() => null} selectedId={null} onSelect={() => {}} onSetNow={() => {}}
				onSelectAddress={() => {}} onSelectSource={() => {}} onSelectRegister={() => {}}
				onHoverAddress={() => {}} hoveredAddress={null}
				onHoverRegister={() => {}} hoveredRegister="$t1" />
		)
		// Only the chip for $t1, not the one beside it for $t0.
		expect(markup.match(/register-hovered/g)?.length).toBe(1)
	})
})
