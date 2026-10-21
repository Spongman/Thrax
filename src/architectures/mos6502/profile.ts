import { TEACHING_BITMAP } from '../../core/bitmapFormats'
/** The 6502 machine as the shared panels see it: 64 KiB, its pages named. */

import type { MachineProfile, MemorySection, Registers } from '../contracts'
import { DEFAULT_ORIGIN } from './assembler'
import { FLAG_I, FLAG_U } from './cpu'
import { MOS6502_REGISTERS } from './registers'

/** Where the Bitmap Display reads a 32 x 32 framebuffer, a byte per pixel, as easy6502 does. */
export const DISPLAY_BASE = 0x0200
export const DISPLAY_END = 0x05FF

const RESET: Readonly<Record<string, number>> = { SP: 0xFD, P: FLAG_U | FLAG_I, I: 1, PC: DEFAULT_ORIGIN, CYC: 7 }

const resetRegisters: Registers = Object.freeze(Object.fromEntries(MOS6502_REGISTERS.map((register) => [register.id, RESET[register.id] ?? 0])))

const sections: readonly MemorySection[] = Object.freeze([
	{ id: 'memory', label: 'memory', start: 0x0000, end: 0xFFFF, code: true },
	{ id: 'zeroPage', label: 'zero page', start: 0x0000, end: 0x00FF },
	{ id: 'stack', label: 'stack', start: 0x0100, end: 0x01FF },
	{ id: 'display', label: 'display', start: DISPLAY_BASE, end: DISPLAY_END },
	{ id: 'program', label: 'program', start: DEFAULT_ORIGIN, end: 0xEFFF, code: true },
	{ id: 'io', label: 'I/O', start: 0xF000, end: 0xF0FF },
	{ id: 'vectors', label: 'vectors', start: 0xFFFA, end: 0xFFFF },
].map((section) => Object.freeze(section)))

export const mos6502Profile: MachineProfile = Object.freeze({
	bitmap: TEACHING_BITMAP,
	resetRegisters,
	resetPc: DEFAULT_ORIGIN,
	memorySections: sections,
	dataBase: DISPLAY_BASE,
	isMappedAddress: (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xFFFF,
})
