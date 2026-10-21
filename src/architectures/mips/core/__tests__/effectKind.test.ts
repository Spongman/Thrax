import { describe, expect, it } from 'vitest'
import { EFFECT_KINDS, Kind } from '../effectKind'

/**
 * The codes and the names are two spellings of one list, and the store writes
 * the code into a `Uint8Array` that outlives nothing but is read back through
 * the names.  If the two ever slip, every effect materialises as the wrong kind
 * and the history reads as a plausible lie rather than failing.
 */

/** `consoleReset` names `CONSOLE_RESET`, and so on. */
const identifierFor = (name: string) => name.replace(/(?<!^)(?=[A-Z])/, '_').toUpperCase()

describe('the effect kinds', () => {
	it('line up with the codes that stand for them', () => {
		const codes = Kind as unknown as Record<string, number | undefined>
		for (const [code, name] of EFFECT_KINDS.entries()) {
			expect(codes[identifierFor(name)]).toBe(code)
		}
	})

	it('has a code for every name and no more', () => {
		// A constant left behind after its kind was removed would number the rest
		// correctly and still be wrong.
		const declared = Object.getOwnPropertyNames(Kind).filter((key) => /^[A-Z]/.test(key))
		expect(declared.sort()).toEqual(EFFECT_KINDS.map(identifierFor).sort())
	})

	it('numbers them from zero without a gap, so the column stays a byte', () => {
		const codes = EFFECT_KINDS.map((name) => (Kind as unknown as Record<string, number>)[identifierFor(name)])
		expect(codes).toEqual(EFFECT_KINDS.map((unused, index) => index))
		expect(Math.max(...codes)).toBeLessThan(256)
	})
})
