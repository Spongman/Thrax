/** The shared ARM assembler set up for the 26-bit machine. */

import type { AssemblySource } from '../../core/assembly/sources'
import { assembleArm, type ArmAssemblyResult } from '../arm/assembler'
import { KBD_BASE, KBD_DATA, KBD_STATUS, TTY_DATA, TTY_STATUS } from './keyboard'
import { TEXT_BASE } from './machine'
import { SWI_NAMES } from './os'

/** The keyboard's addresses, predefined beside the SWI names. */
const DEVICE_NAMES: readonly [string, number][] = [['KBD_STATUS', KBD_STATUS], ['KBD_DATA', KBD_DATA], ['TTY_STATUS', TTY_STATUS], ['TTY_DATA', TTY_DATA]]

export const ARM26_PREDEFINED: ReadonlyMap<string, number> = new Map([...SWI_NAMES, ...DEVICE_NAMES])

/** Programs live below the keyboard's words. */
const ADDRESS_LIMIT = KBD_BASE

export interface Arm26AssemblyOptions {
	files?: readonly AssemblySource[]
	/** Dialect of a file its name and content leave open. */
	fallbackDialect?: number
}

export function assembleArm26(main: AssemblySource, options: Arm26AssemblyOptions = {}): ArmAssemblyResult {
	return assembleArm(main, {
		files: options.files,
		fallbackDialect: options.fallbackDialect,
		textBase: TEXT_BASE,
		addressLimit: ADDRESS_LIMIT,
		predefined: ARM26_PREDEFINED,
	})
}
