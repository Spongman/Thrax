import { describe, expect, it } from 'vitest'
import type { DebugInspection, MemoryInspector } from '../../contracts'
import { describeUasmToken, libraryMacros, macroTable } from '../editor/dataTips'
import definition from '../index'
import { DEFAULT_BETA_SETTINGS } from '../settings'

const memory: MemoryInspector = {
	wordBytes: 4,
	littleEndian: true,
	byte: () => undefined,
	word: (address) => address === 0x40 ? 0xCAFE : undefined,
}

const state: DebugInspection = {
	registers: { R1: 5, R29: 0x100, R31: 0 },
	memory,
	labels: new Map([['loop', 0x40]]),
}

const at = (line: string, text: string) => line.indexOf(text) + 1
const tip = (line: string, text: string, sources = {}) => describeUasmToken(line, at(line, text), state, sources)

describe('UASM data tips', () => {
	it('shows registers by number and by convention name', () => {
		const line = '\tADDC(r1, 4, SP)'
		expect(tip(line, 'r1')).toMatchObject({ start: 6, length: 2, register: 'R1', contents: ['**R1**\n\n`0x00000005 (5, unsigned 5)`'] })
		expect(tip(line, 'SP')).toMatchObject({ register: 'R29', contents: [expect.stringContaining('R29 (SP)')] })
		expect(tip('MOVE(R31, R2)', 'R31')?.contents[0]).toContain('always 0')
	})

	it('shows a label with the word it addresses', () => {
		expect(tip('\tBR(loop)', 'loop')).toMatchObject({ address: 0x40, contents: ['**Label loop**\n\n`0x00000040`', expect.stringContaining('0x0000CAFE')] })
		// Disassembly names branch targets in hex.
		expect(tip('BEQ(R31, 0x00000040, R31)', '0x00000040')).toMatchObject({ address: 0x40, contents: [expect.stringContaining('**loop**'), expect.stringContaining('0x0000CAFE')] })
		expect(tip('ADDC(R1, 64, R1)', '64')).toMatchObject({ contents: ['**Number**\n\n`0x00000040 (64, unsigned 64)`'] })
	})

	it('shows assigned symbols and macros from the sources it is given', () => {
		const sources = { value: (name: string) => name === 'VEC_KBD' ? 16 : undefined, macro: (name: string) => libraryMacros().get(name) ?? [] }
		expect(tip('\t. = VEC_KBD', 'VEC_KBD', sources)?.contents[0]).toBe('**VEC_KBD**\n\n`0x00000010 (16, unsigned 16)`')
		const cmove = tip('\tCMOVE(3, R2)', 'CMOVE', sources)
		expect(cmove?.contents).toEqual(['**CMOVE** — (UASM macro)', 'Load a sign-extended 16-bit constant into RC.', 'Syntax: `CMOVE(CC,RC)`', '`.macro CMOVE(CC,RC) ADDC(R31,CC,RC)`'])
		expect(tip('\tBR(loop)', 'BR', sources)?.contents).toContain('Syntax: `BR(LABEL,RC)` · `BR(LABEL)`')
	})

	it('says nothing in a comment or about an unknown name', () => {
		expect(tip('\tHALT() // R1 is done', 'R1')).toBeNull()
		expect(tip('\tunknown', 'unknown')).toBeNull()
	})

	it('reads workspace macros, comments trimmed', () => {
		expect(macroTable([{ name: 'a.uasm', code: '.macro TWICE(x) x x  // doubled\n' }]).get('TWICE')).toEqual(['.macro TWICE(x) x x'])
	})

	it('is what the gutter asks the services for', () => {
		const services = definition.createServices()
		expect(services.describeToken?.('ADDC(R1, 5, R3)', 6, state)?.register).toBe('R1')
		expect(services.describeToken?.('ADDC(R1, 5, R3)', 1, state)?.contents[0]).toBe('**ADDC** — (UASM macro)')
	})
})

describe('Beta HexText export', () => {
	it('exports memory from address 0 as little-endian words, gaps zero', () => {
		const services = definition.createServices()
		const code = '.include "beta.uasm"\n\tCMOVE(5, R1)\n\tHALT()\n. = 16\n\tLONG(0x12345678)\n\t1 2\n'
		const program = services.assemble({ files: [{ name: 'main.uasm', code }], entries: ['main.uasm'] }, DEFAULT_BETA_SETTINGS)
		expect(program.diagnostics).toEqual([])
		expect(services.exportWords?.(program)).toEqual([0xC03F0005, 0, 0, 0, 0x12345678, 0x0201])
	})
})

describe('Beta definition', () => {
	it('names new files .uasm', () => {
		expect(definition.fileExtensions?.[0]).toBe('.uasm')
	})
})
