import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync, strFromU8 } from 'fflate'
import type { AssemblySource } from '../../../../core/assembly/sources'
import { MEMORY_CONFIGURATIONS, type MemoryConfigurationName } from '../../memoryConfigurations'
import type { ProgramImage } from '../../../contracts'
import type { AssembleResult, AssemblerOptions } from '../index'
import type { CaseOptions, CorpusCase } from './fixtures/negative'

export const CORPUS_FILE = new URL('./fixtures/corpus.json.gz', import.meta.url)

/** Stored form: file contents are indices into `strings`. */
export interface StoredCase {
	name: string
	files: number | { name: string; code: number }[]
	entries: string[] | null
	options: CaseOptions
	hash: string
}

export interface StoredCorpus {
	strings: string[]
	cases: StoredCase[]
}

export function loadCorpus(): { cases: CorpusCase[]; hashes: string[] } {
	const stored = JSON.parse(strFromU8(gunzipSync(readFileSync(CORPUS_FILE)))) as StoredCorpus
	const cases = stored.cases.map((item) => ({
		name: item.name,
		files: typeof item.files === 'number'
			? stored.strings[item.files]
			: item.files.map((file) => ({ name: file.name, code: stored.strings[file.code] })),
		entries: item.entries,
		options: item.options,
	}))
	return { cases, hashes: stored.cases.map((item) => item.hash) }
}

export function assemblerOptions(options: CaseOptions = {}): AssemblerOptions {
	const { memory, ...rest } = options
	return { ...rest, memory: memory === undefined ? undefined : MEMORY_CONFIGURATIONS[memory as MemoryConfigurationName] }
}

export type Assemble = (files: string | AssemblySource[], entries: string[] | undefined, options: AssemblerOptions) =>
	{ result: Omit<AssembleResult, 'image'>; image: ProgramImage }

const entriesOf = <K, V>(map: ReadonlyMap<K, V>) => [...map]

/** Every product of one assembly in a canonical, key-sorted form. */
export function snapshot(item: CorpusCase, assemble: Assemble): string {
	const options = assemblerOptions(item.options)
	const { result, image } = assemble(item.files, item.entries ?? undefined, options)
	const { program } = result
	const index = program.sourceIndex
	return canonical({
		machineCode: result.machineCode,
		diagnostics: result.diagnostics,
		instructions: program.instructions,
		labels: entriesOf(program.labels),
		locals: entriesOf(program.symbols.locals).map(([unit, table]) => [unit, entriesOf(table)]),
		globals: entriesOf(program.symbols.globals),
		symbolSites: entriesOf(program.symbolSites).map(([unit, sites]) => [unit, entriesOf(sites)]),
		data: program.data,
		sourceIndex: {
			entryFile: index.entryFile,
			files: [...index.files()].map((file) => [file, [...index.lines(file)]]),
		},
		image: {
			sections: image.sections.map((section) => ({ address: section.address, bytes: [...section.bytes] })),
			entryAddress: image.entryAddress,
			symbols: image.symbols,
			// Address order: the contract does not fix an order, and the engine sorts.
			sourceMappings: image.sourceMappings.map(({ address, byteLength, kind, source }) => ({ address, byteLength, kind, source }))
				.sort((left, right) => left.address - right.address),
		},
	})
}

export function hash(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 24)
}

/** JSON with sorted object keys, so construction order does not matter but values do. */
export function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item: unknown) => {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
		const sorted: Record<string, unknown> = {}
		for (const key of Object.keys(item).sort()) sorted[key] = (item as Record<string, unknown>)[key]
		return sorted
	})
}
