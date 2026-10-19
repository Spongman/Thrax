import { describe, expect, it } from 'vitest'

import { assembleMips, type AssemblerOptions } from '../../assembler'
import { hasErrors } from '../../../../core/diagnostics'
import { BASIC_INSTRUCTIONS } from '../isa'

/** Assembles one text-segment body, under the given settings. */
function assembleWith(source: string, options: AssemblerOptions = {}) {
	return assembleMips(`.text\nmain:\n${source}\n`, undefined, options)
}

const messages = (source: string, options: AssemblerOptions = {}) =>
	assembleWith(source, options).diagnostics.map((diagnostic) => diagnostic.message)

const OFF: AssemblerOptions = { extendedAssembler: false }

describe('extendedAssembler off (Assembler.java:589)', () => {
	it('rejects a pseudo-instruction and names the basic alternative', () => {
		const [message] = messages('move $t1, $t2', OFF)
		expect(message).toMatch(/Extended \(pseudo\) instruction or format not permitted/)
		expect(message).toContain('addu $t1,$zero,$t2')
	})

	it('rejects the three mnemonics MARS does not define', () => {
		expect(messages('bal main', OFF)[0]).toMatch(/not permitted/)
		expect(messages('li.s $f0, 1.5', OFF)[0]).toMatch(/not permitted/)
		expect(messages('li.d $f2, 1.5', OFF)[0]).toMatch(/not permitted/)
	})

	it('rejects the operand forms PseudoOps.txt does not list', () => {
		expect(messages('slt $t4, $t1, 20', OFF)[0]).toMatch(/not permitted/)
		expect(messages('xor $t2, $zero, 0x12345', OFF)[0]).toMatch(/not permitted/)
		expect(messages('add $t1, 3', OFF)[0]).toMatch(/not permitted/)
	})

	it('rejects an immediate form PseudoOps.txt does list', () => {
		expect(messages('add $t1, $t2, 100', OFF)[0]).toMatch(/not permitted/)
	})

	it('still assembles a basic instruction', () => {
		const { diagnostics, machineCode } = assembleWith('add $t1, $t2, $t3', OFF)
		expect(diagnostics).toEqual([])
		expect(machineCode).toHaveLength(1)
	})

	// The gate must turn on the form the operands matched, so every example the
	// isa table calls basic has to survive it.
	it('permits every basic form of the isa table', () => {
		const refused = BASIC_INSTRUCTIONS.flatMap((form) => {
			const { diagnostics } = assembleMips(`.text\nlabel: ${form.example}\n`, undefined, OFF)
			return diagnostics.filter((diagnostic) => diagnostic.message.includes('not permitted'))
				.map((diagnostic) => `${form.example}: ${diagnostic.message}`)
		})
		expect(refused).toEqual([])
	})
})

describe('extendedAssembler on, the default', () => {
	const forms = [
		'move $t1, $t2', 'bal main', 'li.s $f0, 1.5', 'li.d $f2, 1.5',
		'slt $t4, $t1, 20', 'xor $t2, $zero, 0x12345', 'add $t1, 3', 'add $t1, $t2, 100',
	]

	it.each(forms)('assembles %s', (source) => {
		expect(assembleWith(source).diagnostics).toEqual([])
	})
})

describe('warningsAreErrors (Assembler.java:412)', () => {
	it('leaves a warning a warning when off', () => {
		const { diagnostics } = assembleWith('li $t0, 0129')
		expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['warning'])
		expect(hasErrors(diagnostics)).toBe(false)
	})

	it('fails the assembly when on', () => {
		const { diagnostics } = assembleWith('li $t0, 0129', { warningsAreErrors: true })
		expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['error'])
		expect(diagnostics[0].code).toBe('leading-zero-literal')
	})
})
