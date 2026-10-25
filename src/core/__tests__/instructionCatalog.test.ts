import { describe, expect, it, vi } from 'vitest'
import { instructionCatalog, instructionLinks, preferInstructionLinks } from '../instructionHelp'
import { RISCV_INSTRUCTIONS } from '../../architectures/riscv/catalog'
import { M68K_INSTRUCTIONS } from '../../architectures/m68k/catalog'

describe('native instruction catalogs', () => {
	it('derives completion names and help from the same table', () => {
		const catalog = instructionCatalog({ nop: ['', 'Do nothing.'], extra: ['rd', 'Extra operation.', ['new']] }, 'https://example.test/reference')
		expect(catalog.names('old')).toEqual(['nop'])
		expect(catalog.names('new')).toEqual(['nop', 'extra'])
		expect(catalog.help('EXTRA')).toEqual({ reference: 'https://example.test/reference', contents: ['**EXTRA**', 'Extra operation.', 'Syntax: `extra rd`'] })
		expect(catalog.help('__proto__')).toBeNull()
	})

	it('limits compressed RISC-V completions to the C variant', () => {
		expect(RISCV_INSTRUCTIONS.names('rv32im')).toContain('mul')
		expect(RISCV_INSTRUCTIONS.names('rv32im').some(name => name.startsWith('c.'))).toBe(false)
		expect(RISCV_INSTRUCTIONS.names('rv32imc')).toContain('c.jalr')
	})

	it('keeps 68k instruction model restrictions in the completion catalog', () => {
		expect(M68K_INSTRUCTIONS.names('68000')).not.toContain('bkpt')
		expect(M68K_INSTRUCTIONS.names('68010')).toContain('bkpt')
		expect(M68K_INSTRUCTIONS.names('68010')).not.toContain('extb')
		expect(M68K_INSTRUCTIONS.names('68020')).toContain('extb')
		for (const name of M68K_INSTRUCTIONS.names()) expect(M68K_INSTRUCTIONS.help(name)).not.toBeNull()
	})
})

describe('instruction reference preference', () => {
	it('uses known HTML entries and evaluates the PDF fallback only for gaps', () => {
		const fallback = vi.fn(instructionLinks('https://example.test/manual.pdf', { old: 42 }))
		const link = preferInstructionLinks(instructionLinks('https://example.test/', { add: 'add.html' }), fallback)
		expect(link('ADD')).toBe('https://example.test/add.html')
		expect(fallback).not.toHaveBeenCalled()
		expect(link('old')).toBe('https://example.test/manual.pdf#page=42')
		expect(link('unknown')).toBeUndefined()
		expect(link('__proto__')).toBeUndefined()
	})
})
