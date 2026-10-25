/** ARM2/ARM3 core operation counts, with one unit per S/N/I operation, before PC refill. */
import { FORMAT_BLOCK, FORMAT_COPROCESSOR, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_SWAP, FORMAT_TRANSFER, formatOf, popCount } from '../shared/a32/isa'

/** Early ARM's radix-four multiplier stops after the highest significant unsigned pair. */
export function multiplyCycles(rs: number): number {
	const bits = 32 - Math.clz32(rs >>> 0)
	return 1 + Math.min(16, Math.max(1, Math.ceil((bits + 1) / 2)))
}

export function operationCycles(word: number, rs: number): number {
	switch (formatOf(word)) {
		case FORMAT_DATA: return !(word & 0x02000000) && word & 0x10 ? 2 : 1
		case FORMAT_MULTIPLY: return multiplyCycles(rs)
		case FORMAT_TRANSFER: return word & 0x00100000 ? 3 : 2
		case FORMAT_BLOCK: return Math.max(1, popCount(word)) + (word & 0x00100000 ? 2 : 1)
		case FORMAT_SWAP: return 4
		case FORMAT_COPROCESSOR: return word & 0x00100000 ? 4 : 3
		default: return 1
	}
}
