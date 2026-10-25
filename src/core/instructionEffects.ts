import type { InstructionInfo } from '../architectures/contracts'

export interface PredicatedInstruction { readonly word: number, readonly passed: boolean }

/** Cache both outcomes without inventing data traffic for a failed predicate. */
export function predicatedInstructions(describeWord: (word: number) => InstructionInfo, predicateReads: readonly number[]) {
	const cache = new Map<number, { instruction: PredicatedInstruction, info: InstructionInfo }>()
	const entry = (word: number, passed: boolean) => {
		const key = (word >>> 0) * 2 + Number(passed)
		let cached = cache.get(key)
		if (!cached) {
			if (cache.size >= 8192) cache.clear()
			const info = describeWord(word)
			cached = { instruction: { word, passed }, info: passed ? info : {
				...info, reads: predicateReads, writes: [], loadWrites: [], isLoad: false, isJump: false, controlResult: undefined,
			} }
			cache.set(key, cached)
		}
		return cached
	}
	return {
		executed: (word: number, passed: boolean) => entry(word, passed).instruction,
		describe: (instruction: unknown) => {
			if (typeof instruction === 'number') return describeWord(instruction)
			const { word, passed } = instruction as PredicatedInstruction
			return entry(word, passed).info
		},
	}
}
