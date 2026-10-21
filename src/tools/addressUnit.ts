export function addressUnit(bytes: number): number {
	if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError('Address unit must be a positive safe integer')
	return bytes
}
