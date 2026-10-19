import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MEMORY_CONFIGURATIONS } from '../../memoryConfigurations'
import { MipsAssembly } from '../../program'
import { assembleMips } from '../index'
import { hash, loadCorpus, snapshot, type Assemble } from './corpus'

const assemble: Assemble = (files, entries, options) => {
	const result = assembleMips(files, entries, options)
	return { result, image: new MipsAssembly(result, options.memory ?? MEMORY_CONFIGURATIONS.default).image() }
}

/**
 * Every MIPS example, every source the test suite assembled, and the negative
 * fixtures, each under the settings that change assembly, against the products
 * the MARS assembler gave them before it moved onto the common engine.
 */
describe('MIPS known-output corpus', () => {
	const { cases, hashes } = loadCorpus()

	it(`reproduces all ${cases.length} cases`, () => {
		const failures: string[] = []
		const outputs: string[] = []
		cases.forEach((item, index) => {
			const text = snapshot(item, assemble)
			outputs.push(text)
			if (hash(text) !== hashes[index]) failures.push(`${index}: ${item.name}`)
		})
		if (process.env.THRAX_CORPUS_OUT) writeFileSync(process.env.THRAX_CORPUS_OUT, outputs.join('\n'))
		expect(failures.slice(0, 20)).toEqual([])
		expect(failures).toHaveLength(0)
	// About 4 s alone, so the default 5 s fails under a loaded full run.
	}, 30_000)
})
