/**
 * Float readings of register bits that are not IEEE-754, named by
 * `RegisterDescriptor.floatEncoding`.  A double spans a register pair: `high`
 * is the register holding the sign and exponent, `low` its partner.
 */
import { DEC_D, DEC_F, decToNumber, numberToDec } from './decFloat'
import { HFP_LONG, HFP_SHORT, hexFloatFromNumber, hexFloatToNumber, longHexFloat, longHexFloatBits, shortHexFloat, shortHexFloatBits } from './hexFloat'
import { formatDouble } from './ieee754'

export interface FloatEncoding {
	/** Null where the bits are no number, such as a reserved operand. */
	single(bits: number): number | null
	double(low: number, high: number): number | null
	encodeSingle(value: number): number | null
	encodeDouble(value: number): { low: number, high: number } | null
}

const dec: FloatEncoding = {
	single: bits => decToNumber(BigInt(bits >>> 0), DEC_F),
	double: (low, high) => decToNumber(BigInt(high >>> 0) | BigInt(low >>> 0) << 32n, DEC_D),
	encodeSingle: value => { const image = numberToDec(value, DEC_F); return image === null ? null : Number(image) },
	encodeDouble: value => { const image = numberToDec(value, DEC_D); return image === null ? null : { high: Number(image & 0xffffffffn), low: Number(image >> 32n) } },
}

/** IBM hexadecimal short/long; a long register holds the sign and characteristic in its high word. */
const ibm: FloatEncoding = {
	single: bits => hexFloatToNumber(shortHexFloat(bits), HFP_SHORT),
	double: (low, high) => hexFloatToNumber(longHexFloat(high, low), HFP_LONG),
	encodeSingle: value => { const image = hexFloatFromNumber(value, HFP_SHORT); return image === null ? null : shortHexFloatBits(image) },
	encodeDouble: value => { const image = hexFloatFromNumber(value, HFP_LONG); return image === null ? null : longHexFloatBits(image) },
}

/** DEC F/D as the little-endian longword image of their 16-bit words: VAX registers and PDP-11/VAX memory. */
export const FLOAT_ENCODINGS: Readonly<Record<string, FloatEncoding>> = { dec, ibm }

/** Shortest decimal that encodes back to the same bits. */
export function formatEncodedFloat(encoding: FloatEncoding, bits: number, high?: number): string {
	const value = high === undefined ? encoding.single(bits) : encoding.double(bits, high)
	if (value === null) return 'reserved'
	const same = (text: string) => {
		const typed = Number(text)
		if (high === undefined) return encoding.encodeSingle(typed) === bits >>> 0
		const pair = encoding.encodeDouble(typed)
		return pair !== null && pair.low === bits >>> 0 && pair.high === high >>> 0
	}
	for (let digits = 1; digits <= 17; digits++) {
		const text = value.toPrecision(digits)
		if (same(text)) return Number(text).toString()
	}
	return formatDouble(value)
}
