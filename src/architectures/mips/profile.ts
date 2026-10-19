/** MARS memory layouts, as the shared panels need them. */

import { CP0_REGISTERS, CP0_STATUS_INITIAL } from './core/coprocessor'
import { isMappedAddress, MEMORY_CONFIGURATIONS, type MemoryConfigurationName, type MemoryConfigurationValues } from './memoryConfigurations'
import type { MachineProfile, MemorySection, Registers } from '../contracts'
import { MIPS_REGISTERS } from './registers'

/**
 * Memory map segments, ordered as they appear in the address space.  The
 * configuration draws every boundary but one: it gives the heap and the stack a
 * single region, since they grow towards each other.  They are shown apart, so
 * the stack takes the top eighth of that span and the heap the rest.
 */
export function sectionsFor(layout: MemoryConfigurationValues): MemorySection[] {
	// Unsigned: a bitwise AND alone would turn the top of the address space negative.
	const word = (address: number) => (address & ~3) >>> 0
	const stackStart = word(layout.stackBaseAddress - (layout.stackBaseAddress - layout.heapBaseAddress) / 8)
	return [
		{ id: 'text', label: '.text', start: layout.textBaseAddress, end: layout.textLimitAddress, code: true },
		{ id: 'data', label: '.data', start: layout.dataBaseAddress, end: layout.heapBaseAddress - 4 },
		{ id: 'heap', label: 'heap', start: layout.heapBaseAddress, end: stackStart - 4 },
		{ id: 'stack', label: 'stack', start: stackStart, end: layout.stackBaseAddress },
		{ id: 'kdata', label: 'kernel', start: layout.kernelBaseAddress, end: layout.memoryMapBaseAddress - 4 },
		{ id: 'mmio', label: 'MMIO', start: layout.memoryMapBaseAddress, end: word(layout.memoryMapLimitAddress) },
	]
}

/** Every register as a reset leaves it, under `layout`. */
function resetRegisters(layout: MemoryConfigurationValues): Registers {
	const registers: Registers = Object.fromEntries(MIPS_REGISTERS.map((register) => [register.id, 0]))
	registers.$gp = layout.globalPointer
	registers.$sp = layout.stackPointer
	registers.$pc = layout.textBaseAddress
	const status = CP0_REGISTERS.find((register) => register.index === 12)
	if (status) registers[status.name] = CP0_STATUS_INITIAL
	return registers
}

const profiles = new Map<MemoryConfigurationName, MachineProfile>()

/** One profile per configuration, so its identity only changes with it. */
export function mipsProfile(configuration: MemoryConfigurationName): MachineProfile {
	let profile = profiles.get(configuration)
	if (profile) return profile
	const layout = MEMORY_CONFIGURATIONS[configuration]
	profile = Object.freeze({
		resetRegisters: Object.freeze(resetRegisters(layout)),
		resetPc: layout.textBaseAddress,
		memorySections: Object.freeze(sectionsFor(layout)),
		dataBase: layout.dataBaseAddress,
		isMappedAddress: (value: number) => isMappedAddress(value, layout),
	})
	profiles.set(configuration, profile)
	return profile
}
