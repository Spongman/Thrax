import { describe, expect, it } from 'vitest'
import { assembleMips } from '../index'
import { assemblerOptions } from './corpus'
import expected from './fixtures/negative.expected.json'
import { NEGATIVE_CASES } from './fixtures/negative'

type Expected = Record<string, { words: number; diagnostics: (string | number | null)[][] }>

/** Rejected and edge-case MARS sources keep the diagnostics the MARS assembler gave them. */
describe('MIPS negative fixtures', () => {
	it.each(NEGATIVE_CASES.map((item) => [item.name, item] as const))('%s', (name, item) => {
		const result = assembleMips(item.files, item.entries ?? undefined, assemblerOptions(item.options))
		expect({
			words: result.machineCode.length,
			diagnostics: result.diagnostics.map(({ severity, message, file, line, column }) => [severity, message, file ?? null, line ?? null, column ?? null]),
		}).toEqual((expected as Expected)[name])
	})
})
