import { describe, expect, it } from 'vitest'
import { BASIC_INSTRUCTIONS } from '../isa'
import { Op, OP_NAMES, opFor } from '../ops'

/**
 * An op is written three ways: the ISA's mnemonic, the constant the dispatch
 * switches on, and the name a panel prints.  They are one list, so they are
 * pinned to each other here rather than trusted to stay in step.
 *
 * A slip is silent and total: every instruction from the offending one on would
 * execute as its neighbour.
 */

/** `add.s` names `ADD_S`: a `case` label cannot carry the dot. */
const identifierFor = (mnemonic: string) => mnemonic.toUpperCase().replace(/\./g, '_')

describe('the ops', () => {
	it('give every constant the number of the mnemonic it spells', () => {
		const codes = Op as unknown as Record<string, number | undefined>
		for (const [code, mnemonic] of OP_NAMES.entries()) {
			expect(codes[identifierFor(mnemonic)]).toBe(code)
		}
	})

	it('declare a constant for every mnemonic and no more', () => {
		// One left behind after its instruction was removed would number the rest
		// correctly and still be wrong.
		const declared = Object.getOwnPropertyNames(Op).filter((key) => /^[A-Z]/.test(key))
		expect(declared.sort()).toEqual(OP_NAMES.map(identifierFor).sort())
	})

	it('number them from zero without a gap, which is what the dispatch needs', () => {
		const codes = OP_NAMES.map((name) => (Op as unknown as Record<string, number>)[identifierFor(name)])
		expect(codes).toEqual(OP_NAMES.map((unused, index) => index))
	})

	it(`names the ISA's instructions and no others`, () => {
		// Checking only that every ISA form has an op lets an op that names no
		// instruction through: a stray `f` sat here, read out of a `for` loop in
		// the table by the generator that wrote this file.  The two lists have to
		// match both ways.
		const mnemonics = [...new Set(BASIC_INSTRUCTIONS.map((instruction) => instruction.mnemonic))]
		expect([...OP_NAMES].sort()).toEqual([...mnemonics].sort())
	})

	it('gives the decoder an op for every form it can match', () => {
		// `decode` hands back `opFor(form.mnemonic)`, so a form with no op would
		// decode as nothing at all.
		for (const instruction of BASIC_INSTRUCTIONS) {
			expect(opFor(instruction.mnemonic)).not.toBeNull()
		}
	})

	it('answers to either spelling of a mnemonic, and to nothing else', () => {
		expect(opFor('add.s')).toBe(Op.ADD_S)
		expect(opFor('ADD.S')).toBe(Op.ADD_S)
		expect(opFor('ADD_S')).toBeNull()
		expect(opFor('nonsense')).toBeNull()
	})
})
