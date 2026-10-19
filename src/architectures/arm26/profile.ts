/** The 26-bit machine as the shared panels see it: the vectors, then RAM. */

import type { MachineProfile, Registers } from '../contracts'
import { MODE_SVC, PSR_F, PSR_I } from './cpu'
import { TEXT_BASE } from './machine'
import { ARM26_REGISTERS } from './registers'

const RESET_PSR = (MODE_SVC | PSR_I | PSR_F) >>> 0

const resetRegisters: Registers = Object.freeze(Object.fromEntries(ARM26_REGISTERS.map((register) => {
	if (register.id === 'PSR') return [register.id, RESET_PSR]
	if (register.id === 'I' || register.id === 'F') return [register.id, 1]
	return [register.id, 0]
})))

const profiles = new Map<number, MachineProfile>()

/** One profile per memory size, so its identity only changes with it. */
export function arm26Profile(memoryBytes: number): MachineProfile {
	let profile = profiles.get(memoryBytes)
	if (profile) return profile
	profile = Object.freeze({
		resetRegisters,
		resetPc: TEXT_BASE,
		memorySections: Object.freeze([
			{ id: 'vectors', label: 'vectors', start: 0, end: 0x1C, code: true },
			{ id: 'program', label: 'program', start: TEXT_BASE, end: memoryBytes - 4, code: true },
		]),
		dataBase: TEXT_BASE,
		isMappedAddress: (value: number) => value >= 0 && value < memoryBytes,
	})
	profiles.set(memoryBytes, profile)
	return profile
}
