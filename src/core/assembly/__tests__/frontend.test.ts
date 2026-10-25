import { expect, it } from 'vitest'
import { dataStatements, integerSyntax, quotedBytes, reservationBytes } from '../frontend'
import { Op } from '../expressions'

it('keeps dialect shift/modulo/unary choices explicit', () => {
	const arithmetic = integerSyntax(Op.Sar, true), avr = integerSyntax(Op.Shr, false, [['lo8', 100]])
		expect(arithmetic.binary.get('>>')?.op).toBe(Op.Sar)
		expect(avr.binary.get('>>')?.op).toBe(Op.Shr)
		expect(arithmetic.binary.has('%')).toBe(true)
		expect(avr.binary.has('%')).toBe(false)
		expect(avr.unary.get('lo8')).toBe(100)
})

it('preserves UTF-8 strings, optional termination and bounded reservations', () => {
		expect([...quotedBytes(['"A"', '"\\n"'], true)]).toEqual([65, 10, 0])
		expect([...quotedBytes(['"\u00e9"'], false)]).toEqual([195, 169])
		expect(() => quotedBytes(['123'], false)).toThrow('Expected quoted strings')
		expect(reservationBytes(3, 2, 6, 'range').length).toBe(6)
		for (const count of [-1, 0.5, Infinity, 4]) expect(() => reservationBytes(count, 1, 3, 'range')).toThrow('range')
})

it('accounts string bytes and rejects empty data directives', () => {
	let reserved = 0
	const at = { file: 'data.s', line: 1, column: 1 }
	const parse = () => ({ kind: 0 as const, value: 7 })
	const rows = [...dataStatements(['"AB"', '7'], 1, at, parse, bytes => { reserved += bytes }, true)]
		expect(reserved).toBe(3)
		expect(rows).toMatchObject([{ kind: 7, bytes: new Uint8Array([65, 66]) }, { kind: 3, size: 1, value: { value: 7 } }])
	expect(() => [...dataStatements([], 1, at, parse, () => {})]).toThrow('Data directive needs values')
})
