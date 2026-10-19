/** The BSim machine as the shared panels see it: one flat memory from address 0. */

import type { MachineProfile, Registers } from '../contracts'
import { SUPERVISOR } from './cpu'
import { BETA_REGISTERS } from './registers'

const resetRegisters: Registers = Object.freeze(Object.fromEntries(BETA_REGISTERS.map((register) => [register.id, register.id === 'PC' ? SUPERVISOR : 0])))

const profiles = new Map<number, MachineProfile>()

/** One profile per memory size, so its identity only changes with it. */
export function betaProfile(memoryBytes: number): MachineProfile {
	let profile = profiles.get(memoryBytes)
	if (profile) return profile
	profile = Object.freeze({
		resetRegisters,
		// Reset is supervisor mode at address 0; the editor knows the address alone.
		resetPc: 0,
		memorySections: Object.freeze([{ id: 'memory', label: 'memory', start: 0, end: memoryBytes - 4, code: true }]),
		// Where the Bitmap Display looks first, past the code.
		dataBase: 0x1000,
		isMappedAddress: (value: number) => value >= 0 && value < memoryBytes,
	})
	profiles.set(memoryBytes, profile)
	return profile
}
