/** Packed decimal (GA22-6821, "Decimal Instructions"): digits 0-9, then a sign in the rightmost half byte. */
import { DATA, interrupt } from './interruption'

export const isPlus = (sign: number) => sign === 0xa || sign === 0xc || sign === 0xe || sign === 0xf
export const isSign = (nibble: number) => nibble >= 0xa

/** A signed operand; invalid digits or signs raise a data exception. */
export function unpackDecimal(bytes: readonly number[]): bigint {
	let value = 0n
	for (let i = 0; i < bytes.length; i++) {
		const high = bytes[i] >> 4, low = bytes[i] & 15
		if (high > 9) interrupt(DATA, 'invalid decimal digit')
		value = value * 10n + BigInt(high)
		if (i < bytes.length - 1) {
			if (low > 9) interrupt(DATA, 'invalid decimal digit')
			value = value * 10n + BigInt(low)
		} else if (!isSign(low)) interrupt(DATA, 'invalid decimal sign')
	}
	return isPlus(bytes[bytes.length - 1] & 15) ? value : -value
}

/** Preferred signs C and D; `overflow` reports lost high-order digits. A zero result is positive unless `negativeZero`. */
export function packDecimal(value: bigint, length: number, negativeZero = false): { bytes: number[], overflow: boolean } {
	const negative = value < 0n || (value === 0n && negativeZero)
	let magnitude = value < 0n ? -value : value
	const bytes = new Array<number>(length).fill(0)
	bytes[length - 1] = Number(magnitude % 10n) << 4 | (negative ? 0xd : 0xc)
	magnitude /= 10n
	for (let i = length - 2; i >= 0; i--) {
		const low = Number(magnitude % 10n); magnitude /= 10n
		const high = Number(magnitude % 10n); magnitude /= 10n
		bytes[i] = high << 4 | low
	}
	return { bytes, overflow: magnitude !== 0n }
}

/** The value kept after high-order truncation to `length` bytes. */
export const truncateDecimal = (value: bigint, length: number) => {
	const limit = 10n ** BigInt(2 * length - 1)
	return value < 0n ? -(-value % limit) : value % limit
}
