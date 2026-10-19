/** The AArch32 machine as the shared panels see it: the AArch64 state's layout, with R0-R15 and the CPSR. */

import type { MachineProfile, Registers } from '../../contracts'
import { a64Profile } from '../a64/profile'
import { memoryTop, TEXT_BASE } from '../a64/layout'
import { A32_REGISTERS } from './registers'
import { MODE_USR } from './cpu'

const profiles = new Map<number, MachineProfile>()

/** One profile per memory size, so its identity only changes with it. */
export function a32Profile(memoryBytes: number): MachineProfile {
	let profile = profiles.get(memoryBytes)
	if (profile) return profile
	const resetRegisters: Registers = Object.freeze(Object.fromEntries(A32_REGISTERS.map((register) => {
		if (register.id === 'R13') return [register.id, memoryTop(memoryBytes)]
		if (register.id === 'PC') return [register.id, TEXT_BASE]
		if (register.id === 'CPSR') return [register.id, MODE_USR]
		return [register.id, 0]
	})))
	profile = Object.freeze({ ...a64Profile(memoryBytes), resetRegisters })
	profiles.set(memoryBytes, profile)
	return profile
}
