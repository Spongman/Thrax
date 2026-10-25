import { expect, it } from 'vitest'
import type { DebugInspection } from '../../architectures/contracts'
import { describeRiscvToken } from '../../architectures/riscv/editor'
import { describeToken as describeM68kToken } from '../../architectures/m68k/editor'
import { describeAvrToken } from '../../architectures/avr/editor'

const state = { registers: { x1: 17, A7: 32, r0: 9 }, labels: new Map([['target', 1234]]) } as unknown as DebugInspection

it.each([
	[describeRiscvToken, '.ascii "#" target', '#'],
	[describeM68kToken, '.ascii ";" target', ';'],
	[describeAvrToken, '.db ";" target', ';'],
] as const)('keeps quoted comment markers literal and suppresses actual comments', (describe, line, comment) => {
	const offset = line.indexOf('target')
		expect(describe(line, offset, state)).toMatchObject({ start: offset, length: 6, address: 1234 })
		const commented = comment + ' target'
		expect(describe(commented, commented.indexOf('target'), state)).toBeNull()
})

it('retains native register alias resolution and exact token ranges', () => {
		expect(describeRiscvToken('add ra,zero,zero', 4, state)).toMatchObject({ start: 4, length: 2, register: 'x1' })
		expect(describeM68kToken('move.l sp,d0', 7, state)).toMatchObject({ start: 7, length: 2, register: 'A7' })
		expect(describeAvrToken('ldi R0,9', 4, state)).toMatchObject({ start: 4, length: 2, register: 'r0' })
})
