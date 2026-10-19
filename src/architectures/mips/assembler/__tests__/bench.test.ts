import { appendFileSync } from 'node:fs'
import { it } from 'vitest'
import { assembleMips } from '../index'
import { loadCorpus } from './corpus'

const log = (line: string) => appendFileSync(process.env.THRAX_BENCH!, line + String.fromCharCode(10))

/** Warm, repeated assembly of the largest corpus sources; THRAX_BENCH names the file results append to. */
it.runIf(process.env.THRAX_BENCH)('measures assembly time', () => {
	const { cases } = loadCorpus()
	const size = (files: (typeof cases)[number]['files']) => typeof files === 'string' ? files.length : files.reduce((total, file) => total + file.code.length, 0)
	const largest = cases.filter((item) => !item.options || Object.keys(item.options).length === 0)
		.sort((left, right) => size(right.files) - size(left.files)).slice(0, 6)
	const run = (item: (typeof cases)[number]) => assembleMips(item.files, item.entries ?? undefined, {})
	for (const item of largest) {
		for (let index = 0; index < 50; index++) run(item)
		const samples: number[] = []
		for (let round = 0; round < 15; round++) {
			const start = performance.now()
			for (let index = 0; index < 20; index++) run(item)
			samples.push((performance.now() - start) / 20)
		}
		samples.sort((left, right) => left - right)
		log(`${item.name.padEnd(40)} ${String(size(item.files)).padStart(6)} chars  median ${samples[7].toFixed(3)} ms  min ${samples[0].toFixed(3)} ms`)
	}
	const all = cases.filter((item) => !item.options || Object.keys(item.options).length === 0)
	for (const item of all) run(item)
	const start = performance.now()
	for (const item of all) run(item)
	log(`all ${all.length} default-option cases: ${(performance.now() - start).toFixed(1)} ms`)
}, 600000)
