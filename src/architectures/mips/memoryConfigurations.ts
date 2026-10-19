/** MARS memory configurations: where each segment of the address space starts and ends. */

/** The three memory layouts, by identifier. */
export type MemoryConfigurationName = 'default' | 'dataBasedCompact' | 'textBasedCompact'

/**
 * All 21 addresses of one memory configuration, in field order.
 */
export interface MemoryConfigurationValues {
	textBaseAddress: number
	dataSegmentBaseAddress: number
	externBaseAddress: number
	globalPointer: number
	dataBaseAddress: number
	heapBaseAddress: number
	stackPointer: number
	stackBaseAddress: number
	userHighAddress: number
	kernelBaseAddress: number
	kernelTextBaseAddress: number
	exceptionHandlerAddress: number
	kernelDataBaseAddress: number
	memoryMapBaseAddress: number
	kernelHighAddress: number
	dataSegmentLimitAddress: number
	textLimitAddress: number
	kernelDataSegmentLimitAddress: number
	kernelTextLimitAddress: number
	stackLimitAddress: number
	memoryMapLimitAddress: number
}

/**
 * Whether `value` is an address the configuration maps, rather than a number
 * that happens to be in a register.
 *
 * Most registers hold a small integer or nothing at all, so treating every
 * register's contents as an address makes the whole file light the moment one
 * of them is pointed at: zero is in thirty of them at once.  Only a value
 * inside user space or the kernel is worth calling an address.
 */
export function isMappedAddress(value: number, layout: MemoryConfigurationValues): boolean {
	const address = value >>> 0
	return (address >= (layout.textBaseAddress >>> 0) && address <= (layout.userHighAddress >>> 0))
		|| (address >= (layout.kernelBaseAddress >>> 0) && address <= (layout.kernelHighAddress >>> 0))
}

/** SPIM-derived layout, used by default. */
const DEFAULT_CONFIGURATION: MemoryConfigurationValues = {
	textBaseAddress: 0x00400000,
	dataSegmentBaseAddress: 0x10000000,
	externBaseAddress: 0x10000000,
	globalPointer: 0x10008000,
	dataBaseAddress: 0x10010000,
	heapBaseAddress: 0x10040000,
	stackPointer: 0x7fffeffc,
	stackBaseAddress: 0x7ffffffc,
	userHighAddress: 0x7fffffff,
	kernelBaseAddress: 0x80000000,
	kernelTextBaseAddress: 0x80000000,
	exceptionHandlerAddress: 0x80000180,
	kernelDataBaseAddress: 0x90000000,
	memoryMapBaseAddress: 0xffff0000,
	kernelHighAddress: 0xffffffff,
	dataSegmentLimitAddress: 0x7fffffff,
	textLimitAddress: 0x0ffffffc,
	kernelDataSegmentLimitAddress: 0xfffeffff,
	kernelTextLimitAddress: 0x8ffffffc,
	stackLimitAddress: 0x10040000,
	memoryMapLimitAddress: 0xffffffff,
}

/** 16-bit addressing, data segment starts at 0. */
const DATA_BASED_COMPACT_CONFIGURATION: MemoryConfigurationValues = {
	textBaseAddress: 0x00003000,
	dataSegmentBaseAddress: 0x00000000,
	externBaseAddress: 0x00001000,
	globalPointer: 0x00001800,
	dataBaseAddress: 0x00000000,
	heapBaseAddress: 0x00002000,
	stackPointer: 0x00002ffc,
	stackBaseAddress: 0x00002ffc,
	userHighAddress: 0x00003fff,
	kernelBaseAddress: 0x00004000,
	kernelTextBaseAddress: 0x00004000,
	exceptionHandlerAddress: 0x00004180,
	kernelDataBaseAddress: 0x00005000,
	memoryMapBaseAddress: 0x00007f00,
	kernelHighAddress: 0x00007fff,
	dataSegmentLimitAddress: 0x00002fff,
	textLimitAddress: 0x00003ffc,
	kernelDataSegmentLimitAddress: 0x00007eff,
	kernelTextLimitAddress: 0x00004ffc,
	stackLimitAddress: 0x00002000,
	memoryMapLimitAddress: 0x00007fff,
}

/** 16-bit addressing, text segment starts at 0. */
const TEXT_BASED_COMPACT_CONFIGURATION: MemoryConfigurationValues = {
	textBaseAddress: 0x00000000,
	dataSegmentBaseAddress: 0x00001000,
	externBaseAddress: 0x00001000,
	globalPointer: 0x00001800,
	dataBaseAddress: 0x00002000,
	heapBaseAddress: 0x00003000,
	stackPointer: 0x00003ffc,
	stackBaseAddress: 0x00003ffc,
	userHighAddress: 0x00003fff,
	kernelBaseAddress: 0x00004000,
	kernelTextBaseAddress: 0x00004000,
	exceptionHandlerAddress: 0x00004180,
	kernelDataBaseAddress: 0x00005000,
	memoryMapBaseAddress: 0x00007f00,
	kernelHighAddress: 0x00007fff,
	dataSegmentLimitAddress: 0x00003fff,
	textLimitAddress: 0x00000ffc,
	kernelDataSegmentLimitAddress: 0x00007eff,
	kernelTextLimitAddress: 0x00004ffc,
	stackLimitAddress: 0x00003000,
	memoryMapLimitAddress: 0x00007fff,
}

export const MEMORY_CONFIGURATIONS: Record<MemoryConfigurationName, MemoryConfigurationValues> = {
	default: DEFAULT_CONFIGURATION,
	dataBasedCompact: DATA_BASED_COMPACT_CONFIGURATION,
	textBasedCompact: TEXT_BASED_COMPACT_CONFIGURATION,
}

export const MEMORY_CONFIGURATION_NAMES: readonly MemoryConfigurationName[] = ['default', 'dataBasedCompact', 'textBasedCompact']

export const isMemoryConfigurationName = (value: unknown): value is MemoryConfigurationName =>
	typeof value === 'string' && (MEMORY_CONFIGURATION_NAMES as readonly string[]).includes(value)
