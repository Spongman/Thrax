/**
 * The AArch32 execution state: A32 in GNU as or armasm syntax, assembled by
 * the shared ARM library under its ARMv8 profile and run in User mode under
 * Linux EABI system calls, in the AArch64 state's memory layout.
 */

import type { AssemblySource } from '../../../core/assembly/sources'
import { assembleArm, type ArmAssemblyResult } from '../../arm/assembler'
import { describeArmToken } from '../../arm/editor/dataTips'
import { ARCH_V8 } from '../../arm/a32/isa'
import { a32Disassembly, ArmAssembly } from '../../arm/program'
import type { AssembledProgram } from '../../contracts'
import { DATA_BASE, memoryTop, TEXT_BASE } from '../a64/layout'
import type { ExecutionState } from '../executionState'
import { a32Profile } from './profile'
import { A32Runtime } from './runtime'

export const a32DisassemblyV8 = a32Disassembly(ARCH_V8)

/** One translation unit, laid out as the AArch64 state lays out its programs. */
export function assembleA32(main: AssemblySource, files: readonly AssemblySource[] = [], memoryBytes = 4 << 20): ArmAssemblyResult {
	return assembleArm(main, { files, arch: ARCH_V8, textBase: TEXT_BASE, dataBase: DATA_BASE, addressLimit: memoryTop(memoryBytes) })
}

function a32Assembly(program: AssembledProgram): ArmAssembly {
	if (!(program instanceof ArmAssembly) || program.arch !== ARCH_V8) throw new Error('Not an AArch32 program')
	return program
}

/** A fresh state per activation, holding the last program for data tips. */
export function createA32State(): ExecutionState {
	let latest: ArmAssembly | null = null
	return {
		id: 'aarch32',
		// The entry file, with the rest reached by `.include`.
		assemble({ files, entries }, settings) {
			const main = files.find((file) => file.name === entries[0]) ?? files[0]
			const result = assembleA32(main, files, settings.memoryBytes)
			const failed = result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
			const program = new ArmAssembly(main.name, failed ? null : result.image, result.diagnostics, result.values, result.dialect, ARCH_V8)
			if (!failed && result.image) latest = program
			return program
		},
		createMachine: (program, settings, options) => new A32Runtime(a32Assembly(program), {
			memoryBytes: settings.memoryBytes,
			historyLimit: options.historyLimit,
			speed: options.speed,
		}),
		profile: (settings) => a32Profile(settings.memoryBytes),
		disassembly: a32DisassemblyV8,
		describeToken: (text, column, inspection) => describeArmToken(text, column, inspection, { value: (name) => latest?.values.get(name) }),
		values: () => latest?.values ?? null,
	}
}
