import { RGB32_LE } from '../../../core/bitmapFormats'
/** The 26-bit machine as the shared panels see it: the vectors, then RAM. */

import type { MachineProfile, Registers } from '../../contracts'
import { MODE_SVC, PSR_F, PSR_I } from './cpu'
import { DISPLAY_BASE, TEXT_BASE } from './machine'
import { ARM26_REGISTERS } from './registers'
import { ARM3_ID, type Arm26Model } from './arm3'

const RESET_PSR = (MODE_SVC | PSR_I | PSR_F) >>> 0

const resetRegisters: Registers = Object.freeze(Object.fromEntries(ARM26_REGISTERS.map((register) => {
	if (register.id === 'CYCLES') return [register.id, 0n]
	if (register.id === 'PSR') return [register.id, RESET_PSR]
	if (register.id === 'I' || register.id === 'F') return [register.id, 1]
	return [register.id, 0]
})))

const profiles = new Map<string, MachineProfile>()

/** Stable profiles per memory size and CPU model. */
export function arm26Profile(memoryBytes: number, cpuModel: Arm26Model = 'arm3'): MachineProfile {
	const key = `${memoryBytes}:${cpuModel}`
	let profile = profiles.get(key)
	if (profile) return profile
	profile = Object.freeze({
		bitmap: RGB32_LE,
		resetRegisters: cpuModel === 'arm3' ? { ...resetRegisters, CP15_0: ARM3_ID, CP15_2: 0, CP15_3: 0, CP15_4: 0, CP15_5: 0 } : resetRegisters,
		resetPc: TEXT_BASE,
		memorySections: Object.freeze([
			{ id: 'vectors', label: 'vectors', start: 0, end: 0x1C, code: true },
			{ id: 'program', label: 'program', start: TEXT_BASE, end: memoryBytes - 4, code: true },
		]),
		dataBase: DISPLAY_BASE,
		isMappedAddress: (value: number) => value >= 0 && value < memoryBytes,
	})
	profiles.set(key, profile)
	return profile
}
