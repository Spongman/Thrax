/** Segment:offset translation without signed 32-bit coercion or ISA decisions. */
export function segmentAddress(segment: number, offset: number, shift = 4, addressBits = 20, offsetBits = 16): number {
	if (!Number.isSafeInteger(segment) || !Number.isSafeInteger(offset) || !Number.isInteger(shift) || shift < 0 || shift > 32 || !Number.isInteger(addressBits) || addressBits < 1 || addressBits > 52 || !Number.isInteger(offsetBits) || offsetBits < 1 || offsetBits > 32) throw new RangeError('Invalid segmented address')
	const modulus = 2 ** addressBits, offsets = 2 ** offsetBits
	const logicalOffset = ((offset % offsets) + offsets) % offsets
	return (((segment * 2 ** shift + logicalOffset) % modulus) + modulus) % modulus
}
