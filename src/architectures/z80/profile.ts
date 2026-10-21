import { TEACHING_BITMAP } from '../../core/bitmapFormats'
/** The Z80 machine as the shared panels see it: 64 KiB from address 0, the framebuffer and the device page. */

import type { MachineProfile, Registers } from '../contracts'
import { MEMORY_BYTES } from './cpu'
import { DEVICE_BASE, DEVICE_SIZE } from './machine'
import { REGISTER_FIELDS, T_STATES } from './registers'

/** Where the bitmap examples draw, and where the Bitmap Display looks first. */
export const FRAMEBUFFER = 0xC000

/** AF and SP read all ones after reset; everything else zero. */
const resetRegisters: Registers = Object.freeze({
	...Object.fromEntries(Object.keys(REGISTER_FIELDS).map((id) => [id, 0])),
	A: 0xFF, F: 0xFF, AF: 0xFFFF, AF2: 0xFFFF, SP: 0xFFFF,
	FS: 1, FZ: 1, FH: 1, FPV: 1, FN: 1, FC: 1,
	[T_STATES]: 0,
})

export const z80Profile: MachineProfile = Object.freeze({
	bitmap: TEACHING_BITMAP,
	resetRegisters,
	resetPc: 0,
	memorySections: Object.freeze([
		{ id: 'memory', label: 'memory', start: 0, end: MEMORY_BYTES - 1, code: true },
		{ id: 'framebuffer', label: 'framebuffer', start: FRAMEBUFFER, end: FRAMEBUFFER + 0x03FF },
		{ id: 'devices', label: 'devices', start: DEVICE_BASE, end: DEVICE_BASE + DEVICE_SIZE - 1 },
	]),
	dataBase: FRAMEBUFFER,
	isMappedAddress: (value: number) => value >= 0 && value < MEMORY_BYTES,
})
