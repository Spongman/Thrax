/** IEEE-754 bit patterns and their shortest readable decimals, independent of any CPU. */

const scratch = new DataView(new ArrayBuffer(8))

export function singleToBits(value: number): number {
	scratch.setFloat32(0, value, true)
	return scratch.getUint32(0, true)
}

export function bitsToSingle(bits: number): number {
	scratch.setUint32(0, bits >>> 0, true)
	return scratch.getFloat32(0, true)
}

export function doubleToBits(value: number): { low: number; high: number } {
	scratch.setFloat64(0, value, true)
	return { low: scratch.getUint32(0, true), high: scratch.getUint32(4, true) }
}

export function bitsToDouble(low: number, high: number): number {
	scratch.setUint32(0, low >>> 0, true)
	scratch.setUint32(4, high >>> 0, true)
	return scratch.getFloat64(0, true)
}

function formatSpecial(value: number): string {
	if (Number.isNaN(value)) return 'NaN'
	return value > 0 ? 'Infinity' : '-Infinity'
}

/** Shortest decimal that reads back as the same single-precision value. */
export function formatSingle(value: number): string {
	if (!Number.isFinite(value)) return formatSpecial(value)
	const target = Math.fround(value)
	for (let digits = 1; digits < 9; digits++) {
		const text = target.toPrecision(digits)
		if (Math.fround(Number(text)) === target) return Number(text).toString()
	}
	return Number(target.toPrecision(9)).toString()
}

export function formatDouble(value: number): string {
	if (!Number.isFinite(value)) return formatSpecial(value)
	return value.toString()
}
