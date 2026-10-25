import { describe, expect, it } from 'vitest'
import * as dec from '../decFloat'
import { FIS, FP11, load, reg, run, word } from './helpers'

// DEC F and D words as the PDP-11 Architecture Handbook (Chapter 6) lays
// them out: sign, excess-200 (octal) exponent, then the fraction without its
// hidden bit. 1.0 is 0.5 x 2^1, exponent 201: 040200 000000.
describe('DEC F and D formats', () => {
	const f = (text: string) => dec.toWords(dec.parseDecimal(text, false)!.raw, false).map(w => w.toString(8).padStart(6, '0'))
	const d = (text: string) => dec.toWords(dec.parseDecimal(text, true)!.raw, true).map(w => w.toString(8).padStart(6, '0'))
	it('encodes known values', () => {
		expect(f('1')).toEqual(['040200', '000000'])
		expect(f('-1')).toEqual(['140200', '000000'])
		expect(f('0.5')).toEqual(['040000', '000000'])
		expect(f('4')).toEqual(['040600', '000000'])
		expect(f('-2.5')).toEqual(['140440', '000000'])
		// 0.1 is 0.110011... x 2^-3; the 25th bit is 1, so the last fraction word rounds up to 146315.
		expect(f('0.1')).toEqual(['037314', '146315'])
		expect(d('0.1')).toEqual(['037314', '146314', '146314', '146315'])
		expect(f('0')).toEqual(['000000', '000000'])
	})
	it('rounds half away from zero, or chops', () => {
		const third = dec.divide(dec.fromInteger(1n), dec.fromInteger(3n))
		expect(dec.toWords(dec.round(third, false).raw, false)).toEqual([0o37652, 0o125253])
		expect(dec.toWords(dec.round(third, false, true).raw, false)).toEqual([0o37652, 0o125252])
		expect(dec.toWords(dec.round(third, true).raw, true)).toEqual([0o37652, 0o125252, 0o125252, 0o125253])
		// 1 + 2^-24 is exactly half an F unit above 1: it rounds away, where IEEE would round to even.
		expect(dec.toWords(dec.round({ negative: false, m: (1n << 24n) + 1n, e: -24 }, false).raw, false)).toEqual([0o40200, 1])
	})
	it('reports the exponent range: about 1.7e38 down to 2.9e-39', () => {
		expect(dec.parseDecimal('1.7e38', false)!.overflow).toBe(false)
		expect(dec.parseDecimal('1.8e38', false)!.overflow).toBe(true)
		expect(dec.parseDecimal('1e-39', false)!.underflow).toBe(true)
	})
	it('formats the shortest decimal that reads back', () => {
		expect(dec.formatDecimal(dec.parseDecimal('0.1', false)!.raw, false)).toBe('0.1')
		expect(dec.formatDecimal(dec.parseDecimal('-1234.5', true)!.raw, true)).toBe('-1234.5')
		expect(dec.formatDecimal(dec.parseDecimal('1e30', false)!.raw, false)).toBe('1e+30')
		expect(dec.formatDecimal(1n << 63n, false)).toBe('-0 (undefined)')
	})
})

const floats = (machine: Awaited<ReturnType<typeof load>>, address: number, count = 2) => Array.from({ length: count }, (_, i) => word(machine, address + i * 2))

describe('FP11', () => {
	it('adds, multiplies and stores in F', async () => {
		const machine = run(await load('SETF\nLDF A, AC0\nADDF B, AC0\nSTF AC0, @#2000\nMULF #4, AC0\nSTF AC0, @#2004\nHALT\nA: .FLT2 1.5\nB: .FLT2 2.25', FP11))
		// 3.75 = 0.9375 x 2^2: exponent 202, fraction .1110 after the hidden bit gives 040560.
		expect(floats(machine, 0o2000)).toEqual([0o40560, 0])
		expect(floats(machine, 0o2004)).toEqual([0o41160, 0])
	})
	it('rounds or chops with FT, and keeps 56 bits in D', async () => {
		const third = async (setup: string) => floats(run(await load(`${setup}\nLDF #1, AC0\nDIVF #3, AC0\nSTF AC0, @#2000\nHALT`, FP11)), 0o2000, 4)
		expect(await third('SETF')).toEqual([0o37652, 0o125253, 0, 0])
		expect(await third('SETF\nLDFPS #40')).toEqual([0o37652, 0o125252, 0, 0])
		expect(await third('SETD')).toEqual([0o37652, 0o125252, 0o125252, 0o125253])
	})
	it('compares into FN/FZ and copies them to the CPU with CFCC', async () => {
		const machine = run(await load('SETF\nLDF #2, AC1\nCMPF #1, AC1\nCFCC\nMOV @#177776, R0\nCMPF #2, AC1\nCFCC\nMOV @#177776, R1\nHALT', FP11))
		expect(reg(machine, 'r0') & 15).toBe(8)
		expect(reg(machine, 'r1') & 15).toBe(4)
	})
	it('converts to and from integers', async () => {
		const machine = run(await load('SETF\nSETI\nLDCIF #-7, AC0\nDIVF #2, AC0\nSTCFI AC0, R0\nSETL\nLDF big, AC1\nSTCFI AC1, @#2000\nSETI\nSTCFI AC1, R1\nMOV @#177776, R2\nHALT\nbig: .FLT2 100000.', FP11))
		expect(reg(machine, 'r0')).toBe(0o177775)
		expect(floats(machine, 0o2000)).toEqual([1, 100000 - 65536])
		expect([reg(machine, 'r1'), reg(machine, 'r2') & 1]).toEqual([0, 1])
	})
	it('splits with MODF, moves exponents and converts precision', async () => {
		const machine = run(await load('SETF\nLDF #2.5, AC0\nMODF #1, AC0\nSTF AC0, @#2000\nSTF AC1, @#2004\nSTEXP AC1, R3\nLDEXP #3, AC1\nSTF AC1, @#2010\nSTCFD AC1, @#2020\nHALT', FP11))
		expect(floats(machine, 0o2000)).toEqual([0o40000, 0])
		expect(floats(machine, 0o2004)).toEqual([0o40400, 0])
		expect(reg(machine, 'r3')).toBe(2)
		expect(floats(machine, 0o2010)).toEqual([0o40600, 0])
		expect(floats(machine, 0o2020, 4)).toEqual([0o40600, 0, 0, 0])
	})
	it('raises floating exceptions through vector 244 unless FID is set', async () => {
		const unhandled = await load('SETF\nLDF #1, AC0\nDIVF zero, AC0\nHALT\nzero: .FLT2 0', FP11)
		unhandled.step(); unhandled.step()
		expect(() => unhandled.step()).toThrow(/FEC 4.*division by zero.*vector 244/)
		const disabled = run(await load('LDFPS #40000\nLDF #1, AC0\nDIVF zero, AC0\nSTST R0\nHALT\nzero: .FLT2 0', FP11))
		expect([disabled.halted, reg(disabled, 'r0'), reg(disabled, 'fps') & 0o100000]).toEqual([true, 4, 0o100000])
		const handled = run(await load('MOV #H, @#244\nLDF #1, AC0\nDIVF zero, AC0\nHALT\nH: STST R0\nHALT\nzero: .FLT2 0', FP11))
		expect(reg(handled, 'r0')).toBe(4)
	})
	it('shows accumulators as DEC memory images and accepts edits through them', async () => {
		const machine = await load('SETD\nLDF #1, AC0\nLDF tenth, AC1\nSTF AC1, AC5\nSTF AC2, @#2000\nHALT\ntenth: .FLT4 0.1', FP11)
		for (let i = 0; i < 4; i++) machine.step()
		// The image holds the first word lowest: 1.0 is just 040200 in the low halfword.
		expect(machine.registerValues().ac0).toBe(0o40200n)
		expect(machine.registerValues().ac5).toBe(0o146315n << 48n | 0o146314n << 32n | 0o146314n << 16n | 0o37314n)
		expect(machine.writeRegister('ac2', 0o40600n)).toBe(true)
		machine.step()
		expect(floats(machine, 0o2000, 4)).toEqual([0o40600, 0, 0, 0])
		expect(machine.stepBack()).toBe(true)
		expect(floats(machine, 0o2000, 4)).toEqual([0, 0, 0, 0])
	})
	it('steps back over accumulator and status changes', async () => {
		const machine = await load('SETD\nLDF #2, AC1\nHALT', FP11)
		machine.step()
		const before = machine.registerValues()
		machine.step()
		expect(machine.registerValues().ac1).toBe(0o40400n)
		expect(machine.stepBack()).toBe(true)
		expect(machine.registerValues()).toEqual(before)
	})
})

describe('FIS', () => {
	it('operates on F values on the stack and pops the operand', async () => {
		const machine = run(await load('MOV #S, R1\nFADD R1\nMOV R1, R2\nHALT\nS: .FLT2 1.5, 2.25', FIS))
		expect(reg(machine, 'r2')).toBe(machine.program.labels.get('S')! + 4)
		expect(floats(machine, machine.program.labels.get('S')! + 4)).toEqual([0o40560, 0])
	})
	it('traps division by zero', async () => {
		const machine = await load('MOV #S, R1\nFDIV R1\nHALT\nS: .FLT2 0, 1', FIS)
		machine.step()
		expect(() => machine.step()).toThrow(/FIS division by zero.*vector 244/)
	})
})
