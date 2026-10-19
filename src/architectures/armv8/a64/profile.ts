/** The AArch64 machine as the shared panels see it: code, data and stack in one bounded region. */

import type { MachineProfile, Registers } from '../../contracts'
import { DATA_BASE, memoryTop, TEXT_BASE } from './layout'
import { A64_REGISTERS } from './registers'

/** Shown as the stack: the top of memory, down this far. */
const STACK_VIEW_BYTES = 64 * 1024

const profiles = new Map<number, MachineProfile>()

/** One profile per memory size, so its identity only changes with it. */
export function a64Profile(memoryBytes: number): MachineProfile {
	let profile = profiles.get(memoryBytes)
	if (profile) return profile
	const top = memoryTop(memoryBytes)
	const resetRegisters: Registers = Object.freeze(Object.fromEntries(A64_REGISTERS.map((register) => {
		if (register.id === 'SP') return [register.id, BigInt(top)]
		if (register.id === 'PC') return [register.id, BigInt(TEXT_BASE)]
		return [register.id, register.bits === 64 ? 0n : 0]
	})))
	profile = Object.freeze({
		resetRegisters,
		resetPc: TEXT_BASE,
		memorySections: Object.freeze([
			{ id: 'text', label: '.text', start: TEXT_BASE, end: DATA_BASE - 4, code: true },
			{ id: 'data', label: '.data', start: DATA_BASE, end: top - STACK_VIEW_BYTES - 4 },
			{ id: 'stack', label: 'stack', start: top - STACK_VIEW_BYTES, end: top - 4 },
		]),
		dataBase: DATA_BASE,
		isMappedAddress: (value: number) => value >= TEXT_BASE && value < top,
	})
	profiles.set(memoryBytes, profile)
	return profile
}
