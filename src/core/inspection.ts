import type { MemoryInspector, RegisterValue } from '../architectures/contracts'
import { formatAddress, formatRegister, isAddress } from './format'

export function labelAt(labels: ReadonlyMap<string, number>, address: number): string | undefined {
	for (const [name, at] of labels) if (at === address) return name
	return undefined
}

export function formatIntegerValue(value: RegisterValue, bits: number): string {
	const unsigned = BigInt.asUintN(bits, BigInt(value))
	return `${formatRegister(bits > 32 ? unsigned : Number(unsigned), bits)} (${BigInt.asIntN(bits, unsigned)}, unsigned ${unsigned})`
}

/** Inspection never uses a CPU load or reads a device with side effects. */
export function inspectInteger(memory: MemoryInspector, address: number, size: number): bigint | undefined {
	if (!isAddress(address) || !Number.isInteger(size) || size < 1 || !isAddress(address + size - 1)) return undefined
	let value = 0n
	if (memory.wordBytes === 4 && address % 4 === 0 && size % 4 === 0) {
		for (let offset = 0; offset < size; offset += 4) {
			const word = memory.word(address + offset)
			if (word === undefined) return undefined
			value |= BigInt(word >>> 0) << BigInt((memory.littleEndian ? offset : size - 4 - offset) * 8)
		}
		return value
	}
	for (let index = 0; index < size; index++) {
		const byte = memory.byte(address + index)
		if (byte === undefined) return undefined
		value |= BigInt(byte) << BigInt((memory.littleEndian ? index : size - 1 - index) * 8)
	}
	return value
}

export function memoryTip(address: number, value: RegisterValue | undefined, formatValue: (value: RegisterValue) => string, addressText = formatAddress(address)): string[] {
	return value === undefined ? [] : [`\`[${addressText}]\` = \`${formatValue(value)}\``]
}
