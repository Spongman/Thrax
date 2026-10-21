/**
 * What a symbol was declared as, and what is there now.
 *
 * The assembler already writes down which directive laid out each run of bytes,
 * so a name in the data segment can say more than an address: `.word` reads
 * back as a number, `.float` as a number with a point in it, `.asciiz` as the
 * string it holds.  The bytes are read from memory as it stands rather than
 * from the program, so a value written while the program runs is the value the
 * table shows.
 */

import type { DataDeclaration, MemoryInspector } from '../architectures/contracts'
import { bitsToDouble, bitsToSingle } from '../core/ieee754'

/** One run of bytes a directive laid out, as the table looks them up. */
export interface DataRun {
	address: number
	directive: string
	length: number
}

/**
 * The runs in address order, which is how they are searched.  Entries without a
 * directive are laid out by nothing in particular and say nothing about a name.
 */
export function dataRuns(entries: readonly DataDeclaration[]): DataRun[] {
	return entries
		.filter((entry) => entry.directive !== undefined)
		.map((entry) => ({ address: entry.address, directive: entry.directive!, length: entry.bytes.length }))
		.sort((left, right) => left.address - right.address)
}

/** The run `address` falls in, or undefined where nothing declared it. */
export function runAt(runs: readonly DataRun[], address: number): DataRun | undefined {
	const wanted = address
	let low = 0
	let high = runs.length - 1
	while (low <= high) {
		const middle = (low + high) >> 1
		const run = runs[middle]
		if (wanted < run.address) high = middle - 1
		else if (wanted >= run.address + run.length) low = middle + 1
		else return run
	}
	return undefined
}

/** A byte of memory, or undefined where nothing was written. */
const byteAt = (memory: MemoryInspector, address: number) => memory.byte(address)

/** `size` bytes from `address`, or null where memory does not hold them all. */
function readInteger(memory: MemoryInspector, address: number, size: number, signed: boolean): number | null {
	let value = 0
	for (let offset = 0; offset < size; offset++) {
		const byte = byteAt(memory, address + offset)
		if (byte === undefined) return null
		value += byte * 2 ** ((memory.littleEndian ? offset : size - 1 - offset) * 8)
	}
	if (!signed) return value
	const limit = 2 ** (size * 8)
	return value >= limit / 2 ? value - limit : value
}

/** The characters from `address`, stopping at a NUL or the end of the run. */
function readText(memory: MemoryInspector, address: number, length: number): string | null {
	let text = ''
	for (let offset = 0; offset < length; offset++) {
		const byte = byteAt(memory, address + offset)
		if (byte === undefined) return text.length > 0 ? text : null
		if (byte === 0) break
		text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.'
	}
	return text
}

/** How many decimals a float is worth showing before it reads as noise. */
const FLOAT_DIGITS = 6

/**
 * What is stored at `address`, read the way its directive says.  Null where the
 * bytes are not in memory, so the table can leave the column empty rather than
 * show a zero nothing wrote.
 */
export function valueOf(memory: MemoryInspector, run: DataRun, address: number): string | null {
	const remaining = run.address + run.length - address
	switch (run.directive) {
		case '.byte': return readInteger(memory, address, 1, true)?.toString() ?? null
		case '.half': return readInteger(memory, address, 2, true)?.toString() ?? null
		case '.word': return readInteger(memory, address, 4, true)?.toString() ?? null
		case '.float': {
			const bits = readInteger(memory, address, 4, false)
			return bits === null ? null : trim(bitsToSingle(bits))
		}
		case '.double': {
			const low = readInteger(memory, address, 4, false)
			const high = readInteger(memory, address + 4, 4, false)
			return low === null || high === null ? null : trim(bitsToDouble(low, high))
		}
		case '.ascii':
		case '.asciiz': {
			const text = readText(memory, address, remaining)
			return text === null ? null : JSON.stringify(text)
		}
		// Reserved rather than written: what is in it is whatever put it there.
		case '.space': return null
		default: return null
	}
}

function trim(value: number): string {
	if (!Number.isFinite(value)) return String(value)
	if (Number.isInteger(value)) return value.toFixed(1)
	return String(Number(value.toPrecision(FLOAT_DIGITS)))
}
