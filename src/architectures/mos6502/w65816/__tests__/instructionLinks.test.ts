import { describe, expect, it } from 'vitest'
import type { DebugInspection } from '../../../contracts'
import w65816 from '../index'
import { instructionLink } from '../instructionHelp'

const MANUAL = 'https://www.pagetable.com/c64ref/6502/?cpu=65c816&tab=2'

describe('65C816 instruction links', () => {
	it('links mnemonics to their HTML mnemonic anchor', () => {
		for (const mnemonic of ['adc', 'lda', 'lda.b', 'ldx', 'stx', 'sty', 'xce']) expect(instructionLink(mnemonic), mnemonic).toBe(`${MANUAL}#${mnemonic.split('.')[0].toUpperCase()}`)
		expect(instructionLink('foo')).toBeUndefined()
	})

	it('links the mnemonic in the hover', () => {
		const services = w65816.createServices()
		const help = services.describeToken!('xba', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[XBA](${MANUAL}#XBA`)
		services.dispose()
	})
})
