/** The shared ARM assembler set up for the 26-bit machine. */

import type { AssemblySource } from '../../../core/assembly/sources'
import { assembleArm, type ArmAssemblyResult } from '../shared/assembler'
import { KBD_BASE, KBD_DATA, KBD_STATUS, TTY_DATA, TTY_STATUS } from './keyboard'
import { TEXT_BASE } from './machine'
import { SWI_NAMES } from './os'
import { FORMAT_COPROCESSOR, FORMAT_SWAP, formatOf } from '../shared/a32/isa'
import type { Arm26Model } from './arm3'

/** The keyboard's addresses, predefined beside the SWI names. */
const DEVICE_NAMES: readonly [string, number][] = [['KBD_STATUS', KBD_STATUS], ['KBD_DATA', KBD_DATA], ['TTY_STATUS', TTY_STATUS], ['TTY_DATA', TTY_DATA]]

export const ARM26_PREDEFINED: ReadonlyMap<string, number> = new Map([...SWI_NAMES, ...DEVICE_NAMES])

/** Programs live below the keyboard's words. */
const ADDRESS_LIMIT = KBD_BASE

export interface Arm26AssemblyOptions {
	cpuModel?: Arm26Model
	files?: readonly AssemblySource[]
	/** Dialect of a file its name and content leave open. */
	fallbackDialect?: number
}

export function assembleArm26(main: AssemblySource, options: Arm26AssemblyOptions = {}): ArmAssemblyResult {
	const result = assembleArm(main, {
		files: options.files,
		fallbackDialect: options.fallbackDialect,
		textBase: TEXT_BASE,
		addressLimit: ADDRESS_LIMIT,
		predefined: ARM26_PREDEFINED,
	})
	if (options.cpuModel === 'arm2' && result.image) {
		for (const mapping of result.image.sourceMappings) {
			if (mapping.kind !== 'instruction') continue
			for (let offset = 0; offset < mapping.byteLength; offset += 4) {
				const address = mapping.address + offset
				const section = result.image.sections.find((section) => address >= section.address && address + 4 <= section.address + section.bytes.length)
				if (!section) continue
				const bytes = section.bytes
				const at = address - section.address
				const format = formatOf(bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24)
				if (format === FORMAT_SWAP || format === FORMAT_COPROCESSOR)
					result.diagnostics.push({ severity: 'error', ...mapping.source, message: 'This instruction requires ARM3; ARM2 has no SWP or CP15' })
			}
		}
	}
	return result
}
